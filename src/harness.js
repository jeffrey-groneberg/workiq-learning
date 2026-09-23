import { randomUUID } from 'node:crypto';
import { createDeepAgent } from 'deepagents';
import { ChatOpenAI } from '@langchain/openai';
import { loadMcpTools } from '@langchain/mcp-adapters';
import { MemorySaver } from '@langchain/langgraph';
import { AIMessage } from '@langchain/core/messages';
import { toolErrorMiddleware } from 'langchain';
import { AzureCliCredential, getBearerTokenProvider } from '@azure/identity';

// Read-oriented Work IQ tools handed to the model. Write tools (create_entity, update_entity,
// delete_entity, do_action) are withheld. A client-side guard, not an authorization boundary.
export const READ_TOOLS = ['ask', 'fetch', 'call_function', 'search_paths', 'get_schema', 'list_agents'];

export function azureModel({ llmEndpoint, llmDeployment, llmReasoning }) {
  return new ChatOpenAI({
    model: llmDeployment,
    // Azure OpenAI v1 API, authenticated with an Entra token from your Azure CLI sign-in. No API key.
    configuration: { baseURL: `${llmEndpoint}/openai/v1` },
    apiKey: getBearerTokenProvider(new AzureCliCredential(), 'https://cognitiveservices.azure.com/.default'),
    // The Responses API returns reasoning summaries; zdrEnabled asks Azure not to store responses.
    useResponsesApi: true, zdrEnabled: true,
    ...(llmReasoning ? { reasoning: { effort: llmReasoning, summary: 'auto' } } : {}),
  });
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
      const updates = await agent.stream({ messages: [{ role: 'user', content: question }] }, { ...config, streamMode: 'updates' });
      for await (const update of updates) {
        const ms = Math.round(performance.now() - last);
        last = performance.now();
        for (const [step, output] of Object.entries(update)) {
          for (const message of Array.isArray(output?.messages) ? output.messages : []) {
            if (!AIMessage.isInstance(message)) continue;
            const calls = (message.tool_calls || []).map(call => ({ name: call.name, args: call.args }));
            const reasoning = message.contentBlocks.filter(block => block.type === 'reasoning').map(block => block.reasoning).join('\n\n');
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
      return { text, tools: [...new Set(used)], author: name };
    },
    reset() { thread = randomUUID(); },
    close: () => connection.close(),
  };
}
