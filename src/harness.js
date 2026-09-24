import { randomUUID } from 'node:crypto';
import { createDeepAgent } from 'deepagents';
import { ChatOpenAIResponses, ChatOpenAICompletions } from '@langchain/openai';
import { loadMcpTools } from '@langchain/mcp-adapters';
import { MemorySaver } from '@langchain/langgraph';
import { AIMessage, AIMessageChunk } from '@langchain/core/messages';
import { toolErrorMiddleware } from 'langchain';
import { DefaultAzureCredential, getBearerTokenProvider } from '@azure/identity';
import { AZURE_AI } from './auth.js';

// Read-oriented Work IQ tools handed to the model. Write tools (create_entity, update_entity,
// delete_entity, do_action) are withheld. A client-side guard, not an authorization boundary.
export const READ_TOOLS = ['ask', 'fetch', 'call_function', 'search_paths', 'get_schema', 'list_agents'];

// Reasoning, read from content: contentBlocks merges summary parts and repeats them at the end of a stream.
// Chat Completions providers such as DeepSeek return it as reasoning_content instead.
const reasoningOf = message => [
  ...(Array.isArray(message.content) ? message.content.filter(block => block.type === 'reasoning') : []),
  ...(message.additional_kwargs?.reasoning_content ? [{ reasoning: message.additional_kwargs.reasoning_content }] : []),
];

// An Azure OpenAI or Foundry resource or project URL gets its v1 path; any other endpoint is an OpenAI-compatible base URL.
export const modelBaseUrl = endpoint => (AZURE_AI.test(endpoint) && !endpoint.endsWith('/openai/v1') ? `${endpoint}/openai/v1` : endpoint);

// An API key, or an Entra token from DefaultAzureCredential (environment, managed identity, az login and more).
// Foundry project endpoints take a different token scope than resource endpoints.
function credential({ llmEndpoint, llmAuth, llmApiKey }) {
  if (llmAuth === 'key') return llmApiKey;
  const project = new URL(llmEndpoint).pathname.startsWith('/api/projects/');
  return getBearerTokenProvider(new DefaultAzureCredential(), project ? 'https://ai.azure.com/.default' : 'https://cognitiveservices.azure.com/.default');
}

export function chatModel(settings, { apiKey = credential(settings), ...options } = {}) {
  const { llmEndpoint, llmDeployment, llmApi, llmReasoning } = settings;
  const responses = llmApi === 'responses';
  // One class per API, so the choice holds whatever the model is called. The Responses API streams reasoning
  // summaries, and zdrEnabled asks the service not to store responses. Most other providers offer Chat Completions.
  const Model = responses ? ChatOpenAIResponses : ChatOpenAICompletions;
  return new Model({
    model: llmDeployment, apiKey,
    configuration: { baseURL: modelBaseUrl(llmEndpoint) },
    zdrEnabled: responses,
    // Sent whatever the model is called: LangChain sends reasoning options only for model names it recognizes.
    modelKwargs: !llmReasoning ? {} : responses ? { reasoning: { effort: llmReasoning, summary: 'auto' } } : { reasoning_effort: llmReasoning },
    ...options,
  });
}

// The root cause of a failed call, such as ECONNREFUSED or ENOTFOUND for an unreachable endpoint.
const rootCause = error => (error.cause ? rootCause(error.cause) : error.code ?? error.message);

// Test model: the sign-in, then one streamed call with a tool, as the harness makes it. The model must call the tool.
export async function testModel(settings) {
  if (!settings.llmEndpoint || !settings.llmDeployment) throw new Error('Enter the endpoint and the model first.');
  if (settings.llmAuth === 'key' && !settings.llmApiKey) throw new Error('Enter the API key, or choose Microsoft Entra ID.');
  const checks = [];
  const apiKey = credential(settings);
  if (typeof apiKey === 'function') {
    try { await apiKey(); }
    catch (error) {
      return [{ ok: false, text: `Microsoft Entra ID: ${error.name === 'AggregateAuthenticationError' ? 'DefaultAzureCredential found no Azure sign-in. Run az login, or choose API key.' : error.message}` }];
    }
    checks.push({ ok: true, text: 'Microsoft Entra ID: DefaultAzureCredential returned a token.' });
  }
  const url = `${modelBaseUrl(settings.llmEndpoint)}/${settings.llmApi === 'responses' ? 'responses' : 'chat/completions'}`;
  const started = performance.now();
  try {
    const ping = { type: 'function', function: { name: 'ping', description: 'Connection test. Call it once.', parameters: { type: 'object', properties: {} } } };
    let reply;
    // One attempt: retries would hide an unreachable endpoint behind a timeout.
    const model = chatModel(settings, { apiKey, maxRetries: 0 }).bindTools([ping]);
    for await (const chunk of await model.stream('Connection test: call the ping tool.', { signal: AbortSignal.timeout(60_000) })) {
      reply = reply ? reply.concat(chunk) : chunk;
    }
    const usage = reply.usage_metadata;
    const reasoning = usage?.output_token_details?.reasoning;
    checks.push({ ok: true, text: `${reply.response_metadata?.model_name || settings.llmDeployment} answered in ${((performance.now() - started) / 1000).toFixed(1)} s: POST ${url}${usage ? `, ${usage.total_tokens} tokens${reasoning ? ` incl. ${reasoning} reasoning` : ''}` : ''}.` });
    checks.push(reply.tool_calls?.some(call => call.name === 'ping')
      ? { ok: true, text: 'Tool calling works: the model called the test tool.' }
      : { ok: false, text: 'The model answered without calling the test tool. The harness needs a model that calls tools.' });
  } catch (error) {
    checks.push({ ok: false, text: `POST ${url} failed: ${error.message}${error.cause ? ` (${rootCause(error)})` : ''}` });
  }
  return checks;
}

export async function harness({ connection, model, name, trace }) {
  // Work IQ returns tool data in structuredContent with an empty content array. The MCP spec
  // recommends also sending it as text; without this, the adapter gives the model an empty result.
  const callTool = connection.client.callTool.bind(connection.client);
  connection.client.callTool = async (...args) => {
    const result = await callTool(...args);
    return result.content?.length || !result.structuredContent ? result
      : { ...result, content: [{ type: 'text', text: JSON.stringify(result.structuredContent) }] };
  };
  const all = await loadMcpTools('workiq', connection.client, { defaultToolTimeout: 180_000 });
  const tools = all.filter(tool => READ_TOOLS.includes(tool.name));
  if (!tools.length) throw new Error('The MCP server exposed none of the read-oriented Work IQ tools.');
  const withheld = all.filter(tool => !tools.includes(tool)).map(tool => tool.name);
  trace({ direction: 'stage', body: { title: 'Build the Deep Agents harness', detail: `The model gets ${tools.length} of ${all.length} Work IQ tools: ${tools.map(tool => tool.name).join(', ')}.${withheld.length ? ` Withheld: ${withheld.join(', ')}.` : ''}` } });
  const agent = createDeepAgent({
    model, tools, checkpointer: new MemorySaver(),
    // Return Work IQ tool errors (e.g. a missing argument) to the model so it can correct itself,
    // instead of failing the whole turn.
    middleware: [toolErrorMiddleware({ tools: tools.map(tool => tool.name), onError: error => `Work IQ tool error: ${error.message}` })],
    systemPrompt: [
      "You answer questions about the signed-in user's work with Work IQ tools over their Microsoft 365 data.",
      'Use ask for open questions. Use search_paths, get_schema and fetch for precise, structured reads.',
      'State only facts that appear in tool results. If a tool returns nothing or an error, say so; never invent meetings, people, messages or files.',
      'Tool times are often UTC: convert them. A result with @odata.nextLink is incomplete: say that more items exist.',
      'Cite titles and links when tools return them. You can only read: never claim you sent, changed or deleted anything.',
      `Today is ${new Date().toDateString()}. The user's time zone is ${Intl.DateTimeFormat().resolvedOptions().timeZone}.`,
    ].join('\n'),
  });
  let thread = randomUUID();
  return {
    info: {
      description: `${tools.length} Work IQ tools for ${name}`, server: connection.server,
      tools: tools.map(tool => ({ name: tool.name, description: tool.description })),
    },
    async send(question, signal) {
      const config = { configurable: { thread_id: thread }, signal };
      const used = [];
      let last = performance.now();
      // Two stream modes: 'messages' yields the model's tokens as it writes (the chat),
      // 'updates' yields each finished step: model turn or tool call (the Flow).
      const stream = await agent.stream({ messages: [{ role: 'user', content: question }] }, { ...config, streamMode: ['messages', 'updates'] });
      for await (const [mode, chunk] of stream) {
        if (mode === 'messages') {
          const [token, meta] = chunk;
          // Only this agent's model. A subagent started by the task tool streams from a nested namespace.
          if (!AIMessageChunk.isInstance(token) || meta.langgraph_node !== 'model_request' || meta.langgraph_checkpoint_ns?.includes('|')) continue;
          const summary = reasoningOf(token);
          if (token.text || summary.length) {
            // id is per model call. On a very long thread, Deep Agents first summarizes it with an extra call.
            trace({ direction: 'delta', body: { id: token.id, text: token.text, reasoning: summary.map(block => block.reasoning).join(''), part: summary[0]?.index } });
          }
          continue;
        }
        const ms = Math.round(performance.now() - last);
        last = performance.now();
        for (const [step, output] of Object.entries(chunk)) {
          for (const message of Array.isArray(output?.messages) ? output.messages : []) {
            if (!AIMessage.isInstance(message)) continue;
            const calls = (message.tool_calls || []).map(call => ({ name: call.name, args: call.args }));
            const reasoning = reasoningOf(message).map(block => block.reasoning).join('\n\n');
            const usage = message.usage_metadata;
            used.push(...calls.map(call => call.name));
            trace({
              direction: 'model', ms,
              usage: usage && { input: usage.input_tokens, output: usage.output_tokens, reasoning: usage.output_token_details?.reasoning ?? 0 },
              body: { step, ...(reasoning && { reasoning }), ...(calls.length ? { tool_calls: calls } : { answer: message.text }) },
            });
          }
        }
      }
      const text = (await agent.getState(config)).values.messages.at(-1)?.text || '';
      if (!text.trim()) throw new Error('The model returned no answer. Inspect the requests.');
      // The thread id keeps the memory for follow-ups; the chat shows it like A2A's context.
      return { text, tools: [...new Set(used)], author: name, conversationId: thread };
    },
    reset() { thread = randomUUID(); },
    close: () => connection.close(),
  };
}
