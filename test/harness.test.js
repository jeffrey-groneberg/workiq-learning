import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AIMessage } from '@langchain/core/messages';
import { mcp } from '../src/workiq/mcp.js';
import { harness } from '../src/harness.js';

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

  session.reset();
  await session.send('Start over.');
  assert.doesNotMatch(model.requests.at(-1), /Test-only answer\./);
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
