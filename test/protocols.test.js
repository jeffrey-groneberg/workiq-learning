import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHttp, ORIGIN, redact } from '../src/workiq/http.js';
import { rest, readRestReply } from '../src/workiq/rest.js';
import { a2a, readA2AReply } from '../src/workiq/a2a.js';
import { createAuth, validateSettings } from '../src/auth.js';

test('REST uses the stable routes, required locationHint and one conversation per chat', async () => {
  const calls = [];
  let count = 0;
  const adapter = rest(async (path, options) => {
    calls.push({ path, ...options });
    if (path === '/rest/conversations') return { id: `session/${++count}` };
    return { messages: [{ text: options.body.message.text }, {
      id: `reply-${calls.length}`, text: 'Test fixture answer.',
      attributions: [{ providerDisplayName: 'Source', seeMoreWebUrl: 'https://example.com/doc' }],
      sensitivityLabel: { displayName: 'Confidential' },
    }] };
  });
  await adapter.connect();
  const reply = await adapter.send('First question');
  await adapter.send('Follow-up');
  assert.equal(count, 1);
  assert.equal(calls[1].path, '/rest/conversations/session%2F1/chat');
  assert.deepEqual(calls[0].body, {});
  assert.deepEqual(calls[1].body, {
    message: { text: 'First question' },
    locationHint: { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
  });
  assert.equal(reply.conversationId, 'session/1');
  assert.equal(reply.sensitivity, 'Confidential');
  assert.equal(reply.citations.length, 1);
  adapter.reset();
  await adapter.send('New chat');
  assert.equal(count, 2);
});

test('REST refuses empty, echoed, stale and missing answers', async () => {
  for (const data of [{}, { messages: [] }, { messages: [{ text: 'question' }] },
    { messages: [{ text: '  ' }] }, { messages: [{ role: 'user', text: 'different input' }] }]) {
    assert.throws(() => readRestReply(data, 'question'), /no new assistant/);
  }
  assert.throws(() => readRestReply({ messages: [{ id: 'old', text: 'Old answer' }] }, 'question', 'old'), /no new/);
  await assert.rejects(rest(async () => ({})).connect(), /no conversation ID/);
});

const task = (state = 'TASK_STATE_COMPLETED') => ({
  id: 'task-1', contextId: 'context-1', status: { state },
  artifacts: [{ parts: [{ text: 'Test fixture answer.' }] }],
});

test('A2A uses v1.0 JSON-RPC, discovers the agent and carries context and local time', async () => {
  const calls = [];
  const adapter = a2a(async (path, options) => {
    calls.push({ path, ...options });
    if (!options.body) return { name: 'Test agent' };
    return { result: { task: task() } };
  }, 'P_opaque.agent/id');
  await adapter.connect();
  await adapter.send('First question');
  await adapter.send('Follow-up');
  assert.equal(calls[0].path, '/a2a/P_opaque.agent%2Fid/.well-known/agent-card.json');
  assert.equal(calls[1].path, '/a2a/P_opaque.agent%2Fid/');
  for (const call of calls) assert.equal(call.headers['A2A-Version'], '1.0');
  assert.equal(calls[1].body.jsonrpc, '2.0');
  assert.equal(calls[1].body.method, 'SendMessage');
  const message = calls[1].body.params.message;
  assert.equal(message.role, 'ROLE_USER');
  assert.deepEqual(message.parts, [{ text: 'First question' }]);
  assert.equal(message.metadata.Location.timeZoneOffset, -new Date().getTimezoneOffset());
  assert.ok(message.metadata.Location.timeZone);
  assert.equal(calls[2].body.params.message.contextId, 'context-1');
  assert.notEqual(calls[1].body.id, calls[2].body.id);
  adapter.reset();
  await adapter.send('Start over');
  assert.equal(calls[3].body.params.message.contextId, undefined);
});

test('A2A polls active tasks and handles the documented flattened GetTask result', async () => {
  const calls = [];
  const adapter = a2a(async (_path, { body }) => {
    calls.push(body);
    return calls.length === 1
      ? { result: { task: task('TASK_STATE_WORKING') } }
      : { result: task() };
  });
  const reply = await adapter.send('Question', AbortSignal.timeout(5000));
  assert.equal(calls[1].method, 'GetTask');
  assert.deepEqual(calls[1].params, { id: 'task-1' });
  assert.equal(reply.taskState, 'TASK_STATE_COMPLETED');
  assert.equal(reply.text, 'Test fixture answer.');
});

test('A2A input-required replies continue the same task, not a new task', async () => {
  const calls = [];
  const adapter = a2a(async (_path, { body }) => {
    calls.push(body);
    return { result: { task: task(calls.length === 1 ? 'TASK_STATE_INPUT_REQUIRED' : undefined) } };
  });
  const reply = await adapter.send('Question');
  assert.match(reply.notice, /needs your input/);
  await adapter.send('More detail');
  assert.equal(calls[1].params.message.taskId, 'task-1');
  await adapter.send('Next task');
  assert.equal(calls[2].params.message.taskId, undefined);
});

test('A2A surfaces protocol errors, rejected tasks and empty outputs', async () => {
  await assert.rejects(a2a(async () => ({ error: { code: -32601, message: 'Method not found' } })).send('Question'), /-32601/);
  await assert.rejects(a2a(async () => ({})).send('Question'), /missing.*result/);
  for (const state of ['TASK_STATE_FAILED', 'TASK_STATE_REJECTED', 'TASK_STATE_CANCELED', 'TASK_STATE_AUTH_REQUIRED']) {
    assert.throws(() => readA2AReply({ task: task(state) }), new RegExp(state));
  }
  assert.throws(() => readA2AReply({ task: { status: { state: 'TASK_STATE_COMPLETED' } } }), /no text/);
  assert.throws(() => readA2AReply({ task: { artifacts: [] } }), /without a status/);
  assert.equal(readA2AReply({ message: { parts: [{ text: 'Direct response' }], contextId: 'c' } }).text, 'Direct response');
});

test('HTTP authenticates only to Work IQ, redacts credentials and refuses redirects', async () => {
  const traces = [];
  const calls = [];
  const request = createHttp(async () => 'test-access-token', event => traces.push(redact(event)), async (url, options) => {
    calls.push({ url, ...options });
    return new Response(JSON.stringify({ id: 'test-id' }), { status: 201, headers: { 'request-id': 'trace-id' } });
  });
  assert.deepEqual(await request('/rest/conversations', { body: {} }), { id: 'test-id' });
  assert.equal(calls[0].url, `${ORIGIN}/rest/conversations`);
  assert.equal(calls[0].headers.Authorization, 'Bearer test-access-token');
  assert.equal(calls[0].redirect, 'error');
  assert.equal(traces[0].headers.Authorization, '[redacted]');
  assert.ok(!JSON.stringify(traces).includes('test-access-token'));
  assert.equal(traces[1].requestId, 'trace-id');
  await assert.rejects(request('https://example.com', { body: {} }), /Only documented/);
  await assert.rejects(request('/rest/../other', { body: {} }), /Only documented/);
});

test('HTTP reports permission, rate-limit, non-JSON and abort failures without retrying', async () => {
  for (const [status, pattern] of [[401, /Sign in again/], [403, /billing-plan/], [429, /Retry-After: 10/]]) {
    let calls = 0;
    const request = createHttp(async () => 'token', () => {}, async () => {
      calls++;
      return new Response('{"error":{"message":"Denied"}}', { status, headers: { 'retry-after': '10' } });
    });
    await assert.rejects(request('/rest/conversations', { body: {} }), pattern);
    assert.equal(calls, 1);
  }
  await assert.rejects(createHttp(async () => 'token', () => {}, async () => new Response('<html>Error</html>', { status: 502 }))('/a2a/'), /HTTP 502 without valid JSON/);
  const controller = new AbortController();
  controller.abort();
  const request = createHttp(async () => 'token', () => {}, async (_url, { signal }) => { signal.throwIfAborted(); });
  await assert.rejects(request('/a2a/', { signal: controller.signal }), { name: 'AbortError' });
});

test('redaction covers nested credentials, bearer text and JWT strings', () => {
  const value = redact({
    accessToken: 'secret', nested: [{ Authorization: 'Bearer secret', refresh_token: 'secret' }],
    text: 'Bearer opaque-token and eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.signature',
  });
  assert.ok(!JSON.stringify(value).includes('secret'));
  assert.ok(!value.text.includes('opaque-token'));
  assert.ok(!value.text.includes('eyJ'));
});

test('settings accept IDs, not tokens; remote APIs do not silently use CLI credentials', async () => {
  const empty = { tenantId: '', clientId: '', agentId: '', localAccount: '', llmEndpoint: '', llmDeployment: '', llmReasoning: '' };
  assert.equal(validateSettings({ ...empty, llmReasoning: 'low' }).llmReasoning, 'low');
  assert.throws(() => validateSettings({ ...empty, llmReasoning: 'extreme' }), /Reasoning must be/);
  assert.equal(validateSettings({ ...empty, llmEndpoint: 'https://res.openai.azure.com/' }).llmEndpoint, 'https://res.openai.azure.com');
  for (const llmEndpoint of ['https://evil.example.com', 'http://res.openai.azure.com', 'https://res.openai.azure.com/openai/v1']) {
    assert.throws(() => validateSettings({ ...empty, llmEndpoint }), /Azure OpenAI resource URL/);
  }
  assert.throws(() => validateSettings({ ...empty, llmDeployment: '../deployment' }), /deployment name/);
  assert.throws(() => validateSettings({ tenantId: '', clientId: '', agentId: '', localAccount: '' }), /Invalid llmEndpoint/);
  assert.deepEqual(validateSettings(empty), empty);
  assert.throws(() => validateSettings({ ...empty, clientId: 'Bearer token' }), /Entra GUID/);
  assert.throws(() => validateSettings({ ...empty, localAccount: 'not-an-email' }), /email address/);
  assert.throws(() => validateSettings({ ...empty, agentId: 'x'.repeat(513) }), /Invalid/);
  const api = createAuth(async () => { throw new Error('Unexpected browser open'); });
  api.configure(empty);
  await assert.rejects(api.signIn(), /tenant ID and client ID/);
  await assert.rejects(api.token(), /sign-in is separate/);
  const mcp = createAuth(async () => {}, { mcp: true });
  mcp.configure(empty);
  assert.equal(mcp.status().sharedClient, true);
  assert.equal(mcp.status().signedIn, false);
  assert.equal(api.status().sharedClient, false);
});
