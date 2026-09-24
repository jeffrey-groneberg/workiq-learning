import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AIMessage, AIMessageChunk } from '@langchain/core/messages';
import { ChatGenerationChunk } from '@langchain/core/outputs';
import { mcp } from '../src/workiq/mcp.js';
import { harness, chatModel, modelBaseUrl, testModel } from '../src/harness.js';

// Test-only doubles: a scripted chat model and an in-memory MCP server. No live calls.
class ScriptedModel extends BaseChatModel {
  constructor(replies) { super({}); this.replies = replies; this.requests = []; }
  _llmType() { return 'scripted'; }
  bindTools(tools) { this.boundTools = tools.map(tool => tool.name); return this; }
  async _generate(messages) {
    this.requests.push(messages.map(message => (typeof message.content === 'string' ? message.content : JSON.stringify(message.content))).join('\n'));
    const message = this.replies.shift();
    return { generations: [{ message, text: String(message.content) }] };
  }
}

// Streams each reply word by word, as a real model does when LangGraph asks for tokens.
// A reply's response_metadata.reasoning becomes a reasoning-summary chunk, shaped like @langchain/openai's.
class StreamingModel extends ScriptedModel {
  async *_streamResponseChunks(messages, _options, runManager) {
    const [{ message }] = (await this._generate(messages)).generations;
    const calls = (message.tool_calls || []).map((call, index) => ({ type: 'tool_call_chunk', index, id: call.id, name: call.name, args: JSON.stringify(call.args) }));
    const reasoning = message.response_metadata?.reasoning;
    const chunks = [
      ...(reasoning ? [new ChatGenerationChunk({ text: '', message: new AIMessageChunk({ content: [{ type: 'reasoning', reasoning, index: 0 }] }) })] : []),
      ...String(message.content).split(/(?<= )/).map(word => new ChatGenerationChunk({ text: word, message: new AIMessageChunk({ content: word, tool_call_chunks: calls.splice(0) }) })),
    ];
    for (const chunk of chunks) {
      await runManager?.handleLLMNewToken(chunk.text, undefined, undefined, undefined, undefined, { chunk });
      yield chunk;
    }
  }
}

async function testServer(tools, calls) {
  const server = new Server({ name: 'test-only-server', version: '1.0.0' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map(name => ({ name, description: `Test ${name}`, inputSchema: { type: 'object', properties: { question: { type: 'string' } } } })),
  }));
  server.setRequestHandler(CallToolRequestSchema, async request => {
    calls.push(request.params);
    return { content: [{ type: 'text', text: JSON.stringify({ response: 'Test-only tool result.', conversationId: 'c1' }) }] };
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  return { server, clientTransport };
}

test('Deep Agents harness: model chooses a Work IQ tool over MCP, keeps thread memory and resets', async t => {
  const calls = [];
  const traces = [];
  const { server, clientTransport } = await testServer(['ask', 'fetch', 'delete_entity', 'do_action'], calls);
  const connection = await mcp({ transport: clientTransport, trace: event => traces.push(event) });
  const model = new ScriptedModel([
    new AIMessage({ content: '', tool_calls: [{ id: 'call-1', name: 'ask', args: { question: 'What is next?' } }] }),
    new AIMessage('Test-only answer.'),
    new AIMessage('Test-only follow-up.'),
    new AIMessage('Test-only fresh answer.'),
  ]);
  const session = await harness({ connection, model, name: 'Deep Agents · test', trace: event => traces.push(event) });
  t.after(async () => { await session.close(); await server.close(); });

  assert.deepEqual(session.info.tools.map(tool => tool.name), ['ask', 'fetch']);

  const reply = await session.send('Prepare me for my next meeting.');
  assert.ok(model.boundTools.includes('ask'));
  assert.ok(!model.boundTools.includes('delete_entity') && !model.boundTools.includes('do_action'));
  assert.equal(reply.text, 'Test-only answer.');
  assert.deepEqual(reply.tools, ['ask']);
  assert.equal(reply.author, 'Deep Agents · test');
  assert.deepEqual(calls, [{ name: 'ask', arguments: { question: 'What is next?' } }]);
  assert.ok(traces.some(trace => trace.direction === 'request' && trace.body.method === 'initialize'));
  assert.ok(traces.some(trace => trace.direction === 'stage' && trace.body.detail === 'The model gets 2 of 4 Work IQ tools: ask, fetch. Withheld: delete_entity, do_action.'));
  assert.ok(traces.some(trace => trace.direction === 'request' && trace.body.method === 'tools/call'));
  assert.ok(traces.some(trace => trace.direction === 'model' && trace.body.tool_calls?.[0].name === 'ask'));

  const followUp = await session.send('And after that?');
  assert.equal(followUp.text, 'Test-only follow-up.');
  assert.deepEqual(followUp.tools, []);
  assert.match(model.requests.at(-1), /Test-only answer\./);
  assert.match(reply.conversationId, /^[0-9a-f-]{36}$/);
  assert.equal(followUp.conversationId, reply.conversationId);

  session.reset();
  const restart = await session.send('Start over.');
  assert.doesNotMatch(model.requests.at(-1), /Test-only answer\./);
  assert.notEqual(restart.conversationId, reply.conversationId);
});

test('Work IQ data returned only in structuredContent reaches the model (no empty tool result)', async t => {
  // Mirrors the live remote response shape: content is [], the data is in structuredContent.
  const server = new Server({ name: 'test-structured', version: '1' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{ name: 'call_function', inputSchema: { type: 'object', properties: {} } }] }));
  server.setRequestHandler(CallToolRequestSchema, async () => ({
    content: [], isError: false,
    structuredContent: { statusCode: 200, data: { value: [{ subject: 'Test-only meeting subject' }] } },
  }));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const connection = await mcp({ transport: clientTransport, trace: () => {} });
  const model = new ScriptedModel([
    new AIMessage({ content: '', tool_calls: [{ id: 'call-1', name: 'call_function', args: {} }] }),
    new AIMessage('Test-only answer.'),
  ]);
  const session = await harness({ connection, model, name: 'test', trace: () => {} });
  t.after(async () => { await session.close(); await server.close(); });
  await session.send('What meetings do I have today?');
  assert.match(model.requests.at(-1), /Test-only meeting subject/);
  assert.match(model.requests[0], /never invent meetings/);
});

test('Harness traces each model step with duration, token usage and reasoning summary', async t => {
  const { server, clientTransport } = await testServer(['ask'], []);
  const connection = await mcp({ transport: clientTransport, trace: () => {} });
  const traces = [];
  const model = new ScriptedModel([new AIMessage({
    content: [{ type: 'reasoning', reasoning: 'Test-only reasoning.' }, { type: 'text', text: 'Test-only answer.' }],
    usage_metadata: { input_tokens: 10, output_tokens: 5, total_tokens: 15, output_token_details: { reasoning: 2 } },
  })]);
  const session = await harness({ connection, model, name: 'test', trace: event => traces.push(event) });
  t.after(async () => { await session.close(); await server.close(); });
  assert.equal((await session.send('Question')).text, 'Test-only answer.');
  const step = traces.find(event => event.direction === 'model');
  assert.deepEqual(step.usage, { input: 10, output: 5, reasoning: 2 });
  assert.equal(step.body.reasoning, 'Test-only reasoning.');
  assert.equal(step.body.answer, 'Test-only answer.');
  assert.equal(typeof step.ms, 'number');
});

test('A Work IQ tool error goes back to the model, which corrects its arguments', async t => {
  // Mirrors the live get_schema error: operationType is only "required" in its description.
  const server = new Server({ name: 'test-errors', version: '1' }, { capabilities: { tools: {} } });
  const calls = [];
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{ name: 'get_schema', inputSchema: { type: 'object', properties: { operationType: { type: ['string', 'null'] } } } }] }));
  server.setRequestHandler(CallToolRequestSchema, async request => {
    calls.push(request.params.arguments);
    return request.params.arguments.operationType
      ? { content: [{ type: 'text', text: 'Test-only schema.' }] }
      : { isError: true, content: [{ type: 'text', text: "Provide 'operationType'." }] };
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const connection = await mcp({ transport: clientTransport, trace: () => {} });
  const model = new ScriptedModel([
    new AIMessage({ content: '', tool_calls: [{ id: 'call-1', name: 'get_schema', args: {} }] }),
    new AIMessage({ content: '', tool_calls: [{ id: 'call-2', name: 'get_schema', args: { operationType: 'fetch' } }] }),
    new AIMessage('Test-only answer.'),
  ]);
  const session = await harness({ connection, model, name: 'test', trace: () => {} });
  t.after(async () => { await session.close(); await server.close(); });
  assert.equal((await session.send('Question')).text, 'Test-only answer.');
  assert.deepEqual(calls, [{}, { operationType: 'fetch' }]);
  assert.match(model.requests[1], /Work IQ tool error: .*Provide 'operationType'/);
});

test('Deep Agents harness refuses a server with no read-oriented Work IQ tools', async t => {
  const { server, clientTransport } = await testServer(['delete_entity'], []);
  const connection = await mcp({ transport: clientTransport, trace: () => {} });
  t.after(async () => { await connection.close(); await server.close(); });
  await assert.rejects(harness({ connection, model: new ScriptedModel([]), name: 'test', trace: () => {} }), /none of the read-oriented/);
});

test('Deep Agents harness reports an empty model answer instead of inventing one', async t => {
  const { server, clientTransport } = await testServer(['ask'], []);
  const connection = await mcp({ transport: clientTransport, trace: () => {} });
  const session = await harness({ connection, model: new ScriptedModel([new AIMessage('')]), name: 'test', trace: () => {} });
  t.after(async () => { await session.close(); await server.close(); });
  await assert.rejects(session.send('Question'), /no answer/);
});

test('the harness model authenticates with an API key or with an Entra token from DefaultAzureCredential', () => {
  const base = { llmEndpoint: 'https://test-resource.openai.azure.com', llmDeployment: 'test-deployment', llmApi: 'responses', llmReasoning: '' };
  const keyed = chatModel({ ...base, llmAuth: 'key', llmApiKey: 'test-key-value' });
  assert.equal(keyed.clientConfig.apiKey, 'test-key-value');
  assert.equal(keyed.clientConfig.baseURL, 'https://test-resource.openai.azure.com/openai/v1');
  assert.equal(typeof chatModel({ ...base, llmAuth: 'entra', llmApiKey: '' }).clientConfig.apiKey, 'function');
  // Azure resource and project URLs get the v1 path; other endpoints are base URLs as entered.
  for (const [endpoint, baseURL] of [
    ['https://test.services.ai.azure.com/api/projects/test', 'https://test.services.ai.azure.com/api/projects/test/openai/v1'],
    ['https://test.openai.azure.com/openai/v1', 'https://test.openai.azure.com/openai/v1'],
    ['https://api.example.com/v1', 'https://api.example.com/v1'],
    ['http://localhost:11434/v1', 'http://localhost:11434/v1'],
  ]) assert.equal(modelBaseUrl(endpoint), baseURL);
});

test("Deep Agents harness streams its own model's tokens, not a subagent's", async t => {
  const { server, clientTransport } = await testServer(['ask'], []);
  const connection = await mcp({ transport: clientTransport, trace: () => {} });
  const model = new StreamingModel([
    new AIMessage({ content: '', tool_calls: [{ id: 'call-1', name: 'task', args: { description: 'Find the test fact.', subagent_type: 'general-purpose' } }] }),
    new AIMessage('Test-only subagent draft.'),
    new AIMessage({ content: 'Test-only streamed answer.', response_metadata: { reasoning: 'Test-only reasoning.' } }),
  ]);
  const traces = [];
  const session = await harness({ connection, model, name: 'test', trace: event => traces.push(event) });
  t.after(async () => { await session.close(); await server.close(); });
  const reply = await session.send('Question');
  const deltas = traces.filter(event => event.direction === 'delta');
  assert.ok(model.requests.some(request => request.includes('Find the test fact.')), 'the subagent ran');
  assert.equal(reply.text, 'Test-only streamed answer.');
  assert.deepEqual(deltas.map(event => event.body.text), ['', 'Test-only ', 'streamed ', 'answer.']);
  assert.deepEqual(deltas.map(event => [event.body.reasoning, event.body.part]), [['Test-only reasoning.', 0], ['', undefined], ['', undefined], ['', undefined]]);
  assert.equal(new Set(deltas.map(event => event.body.id)).size, 1, 'one model call');
  assert.ok(!JSON.stringify(deltas).includes('subagent draft'));
  assert.deepEqual(reply.tools, ['task']);
  assert.ok(traces.some(event => event.direction === 'model' && event.body.answer === 'Test-only streamed answer.'), 'Flow still gets the finished step');
});

test('reasoning summary parts from the real Azure OpenAI client stream once, in order', async t => {
  // A Responses API event stream with a two-part reasoning summary, then the answer.
  const reasoning = { type: 'reasoning', id: 'rs_1', summary: [{ type: 'summary_text', text: 'Test part A.' }, { type: 'summary_text', text: 'Test part B.' }] };
  const answer = { type: 'message', id: 'msg_1', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Test answer.', annotations: [] }] };
  const events = [
    { type: 'response.created', response: { id: 'resp_test', model: 'gpt-5.1', status: 'in_progress', output: [] } },
    { type: 'response.output_item.added', output_index: 0, item: { type: 'reasoning', id: 'rs_1', summary: [] } },
    ...[0, 1].flatMap(index => [
      { type: 'response.reasoning_summary_part.added', item_id: 'rs_1', output_index: 0, summary_index: index, part: { type: 'summary_text', text: '' } },
      { type: 'response.reasoning_summary_text.delta', item_id: 'rs_1', output_index: 0, summary_index: index, delta: reasoning.summary[index].text },
    ]),
    { type: 'response.output_item.done', output_index: 0, item: reasoning },
    { type: 'response.output_item.added', output_index: 1, item: { ...answer, status: 'in_progress', content: [] } },
    ...['Test ', 'answer.'].map(delta => ({ type: 'response.output_text.delta', item_id: 'msg_1', output_index: 1, content_index: 0, delta })),
    { type: 'response.completed', response: { id: 'resp_test', model: 'gpt-5.1', status: 'completed', output: [reasoning, answer],
      usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 3 } } } },
  ];
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    requests.push({ url: String(url), authorization: new Headers(init.headers).get('authorization') });
    return new Response(events.map((event, n) => `event: ${event.type}\ndata: ${JSON.stringify({ ...event, sequence_number: n })}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });
  });
  const { server, clientTransport } = await testServer(['ask'], []);
  const connection = await mcp({ transport: clientTransport, trace: () => {} });
  const model = chatModel({ llmEndpoint: 'https://test-resource.openai.azure.com', llmDeployment: 'gpt-5.1', llmApi: 'responses', llmReasoning: 'low', llmAuth: 'key', llmApiKey: 'test-key-value' });
  const traces = [];
  const session = await harness({ connection, model, name: 'test', trace: event => traces.push(event) });
  t.after(async () => { await session.close(); await server.close(); });
  const reply = await session.send('Question');
  assert.deepEqual(requests, [{ url: 'https://test-resource.openai.azure.com/openai/v1/responses', authorization: 'Bearer test-key-value' }]);
  const deltas = traces.filter(event => event.direction === 'delta').map(({ body }) => [body.text, body.reasoning, body.part]);
  assert.deepEqual(deltas, [['', 'Test part A.', 0], ['', 'Test part B.', 1], ['Test ', '', undefined], ['answer.', '', undefined]]);
  assert.equal(reply.text, 'Test answer.');
  const step = traces.find(event => event.direction === 'model');
  assert.equal(step.body.reasoning, 'Test part A.\n\nTest part B.', 'the finished step keeps the parts apart');
  assert.deepEqual(step.usage, { input: 10, output: 5, reasoning: 3 });
});

test('on a very long thread, the summary call streams under its own id, before the answer', async t => {
  // Deep Agents summarizes above 85% of the model's input limit; a small limit forces it on the second turn.
  // Its summary call is a single message, without the system prompt.
  class LongThreadModel extends StreamingModel {
    get profile() { return { maxInputTokens: 3000 }; }
    async _generate(messages) {
      const text = messages.length === 1 ? 'Test-only summary.'
        : messages.some(message => String(message.content).includes('Second question')) ? 'Test-only second answer.'
          : `Test-only long answer ${'filler '.repeat(1500)}`;
      return { generations: [{ message: new AIMessage(text), text }] };
    }
  }
  const { server, clientTransport } = await testServer(['ask'], []);
  const connection = await mcp({ transport: clientTransport, trace: () => {} });
  const traces = [];
  const session = await harness({ connection, model: new LongThreadModel([]), name: 'test', trace: event => traces.push(event) });
  t.after(async () => { await session.close(); await server.close(); });
  await session.send('First question');
  traces.length = 0;
  const reply = await session.send('Second question');
  const calls = Map.groupBy(traces.filter(event => event.direction === 'delta'), event => event.body.id);
  const texts = [...calls.values()].map(deltas => deltas.map(event => event.body.text).join(''));
  assert.equal(reply.text, 'Test-only second answer.');
  assert.deepEqual(texts, ['Test-only summary.', 'Test-only second answer.']);
});

// A Chat Completions event stream, as OpenAI-compatible providers send it.
const chatStream = deltas => new Response([
  ...deltas.map(({ delta = {}, finish = null, usage }) => `data: ${JSON.stringify({ id: 'chatcmpl-test', object: 'chat.completion.chunk', created: 1, model: 'test-model',
    choices: usage ? [] : [{ index: 0, delta, finish_reason: finish }], ...(usage && { usage }) })}\n\n`),
  'data: [DONE]\n\n',
].join(''), { headers: { 'content-type': 'text/event-stream' } });
const keySettings = { llmEndpoint: 'https://api.example.com/v1', llmDeployment: 'test-model', llmApi: 'chat', llmReasoning: '', llmAuth: 'key', llmApiKey: 'test-key-value' };
const usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 };

test('any OpenAI-compatible endpoint: Chat Completions streams text and reasoning_content, with the reasoning option sent', async t => {
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    requests.push({ url: String(url), body: JSON.parse(init.body) });
    return chatStream([{ delta: { role: 'assistant', content: '' } }, { delta: { reasoning_content: 'Test reasoning.' } },
      { delta: { content: 'Test ' } }, { delta: { content: 'answer.' } }, { finish: 'stop' }, { usage }]);
  });
  const { server, clientTransport } = await testServer(['ask'], []);
  const connection = await mcp({ transport: clientTransport, trace: () => {} });
  const traces = [];
  // LangChain would drop the reasoning option for a model name it doesn't know; the harness sends it anyway.
  const session = await harness({ connection, model: chatModel({ ...keySettings, llmReasoning: 'low' }), name: 'test', trace: event => traces.push(event) });
  t.after(async () => { await session.close(); await server.close(); });
  const reply = await session.send('Question');
  const [{ url, body }] = requests;
  assert.equal(url, 'https://api.example.com/v1/chat/completions');
  assert.equal(body.model, 'test-model');
  assert.equal(body.reasoning_effort, 'low');
  assert.equal('store' in body, false, 'no Responses-only options');
  assert.ok(body.tools.some(tool => tool.function.name === 'ask'));
  assert.deepEqual(traces.filter(event => event.direction === 'delta').map(({ body: delta }) => [delta.text, delta.reasoning]), [['', 'Test reasoning.'], ['Test ', ''], ['answer.', '']]);
  assert.equal(reply.text, 'Test answer.');
  const step = traces.find(event => event.direction === 'model');
  assert.equal(step.body.reasoning, 'Test reasoning.');
  assert.deepEqual(step.usage, { input: 10, output: 5, reasoning: 0 });
});

test('Test model reports the call and whether the model called the test tool', async t => {
  const replies = [
    [{ delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'call-1', type: 'function', function: { name: 'ping', arguments: '' } }] } },
      { delta: { tool_calls: [{ index: 0, function: { arguments: '{}' } }] } }, { finish: 'tool_calls' }, { usage }],
    [{ delta: { role: 'assistant', content: 'No tool.' } }, { finish: 'stop' }, { usage }],
  ];
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    requests.push({ url: String(url), authorization: new Headers(init.headers).get('authorization'), tools: JSON.parse(init.body).tools.map(tool => tool.function.name) });
    return replies.length ? chatStream(replies.shift()) : new Response('{"error":{"message":"Test-only invalid key."}}', { status: 401, headers: { 'content-type': 'application/json' } });
  });
  const works = await testModel(keySettings);
  assert.deepEqual(works.map(check => check.ok), [true, true]);
  assert.match(works[0].text, /^test-model answered in \d+\.\d s: POST https:\/\/api\.example\.com\/v1\/chat\/completions, 15 tokens\.$/);
  assert.equal(works[1].text, 'Tool calling works: the model called the test tool.');
  assert.deepEqual(requests[0], { url: 'https://api.example.com/v1/chat/completions', authorization: 'Bearer test-key-value', tools: ['ping'] });
  const noTool = await testModel(keySettings);
  assert.deepEqual(noTool.map(check => check.ok), [true, false]);
  assert.match(noTool[1].text, /without calling the test tool/);
  const rejected = await testModel(keySettings);
  assert.equal(rejected.length, 1);
  assert.match(rejected[0].text, /^POST https:\/\/api\.example\.com\/v1\/chat\/completions failed: 401 Test-only invalid key\./);
  await assert.rejects(testModel({ ...keySettings, llmApiKey: '' }), /Enter the API key/);
  assert.equal(requests.length, 3, 'no call without a key');
});

test('the API choice holds whatever the model is called', async t => {
  const urls = [];
  t.mock.method(globalThis, 'fetch', async url => { urls.push(String(url)); throw new Error('Test-only stop.'); });
  // ChatOpenAI would send a model with this name to the Responses API, even with Chat Completions chosen.
  for (const llmApi of ['chat', 'responses']) {
    await assert.rejects(chatModel({ ...keySettings, llmApi, llmDeployment: 'gpt-5.1-codex' }, { maxRetries: 0 }).invoke('Hi'));
  }
  assert.deepEqual(urls, ['https://api.example.com/v1/chat/completions', 'https://api.example.com/v1/responses']);
});

test('Test model reports an unreachable endpoint at once, with its root cause', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => {
    throw new TypeError('fetch failed', { cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:9'), { code: 'ECONNREFUSED' }) });
  });
  const started = performance.now();
  const checks = await testModel({ ...keySettings, llmEndpoint: 'http://127.0.0.1:9/v1' });
  assert.equal(checks.length, 1);
  assert.match(checks[0].text, /^POST http:\/\/127\.0\.0\.1:9\/v1\/chat\/completions failed: .+ \(ECONNREFUSED\)$/);
  assert.equal(fetch.mock.callCount(), 1, 'no retries');
  assert.ok(performance.now() - started < 5000);
});
