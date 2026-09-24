import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createService, affectedRoutes } from '../src/service.js';

test('service rejects invalid input and missing authentication without a network call', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Must not fetch'); });
  const service = createService({ token: async () => { throw new Error('Sign in first'); } }, () => {}, () => ({}));
  await assert.rejects(service.run('bad-route', 'send', 'Hello'), /Unknown integration/);
  await assert.rejects(service.run('rest', 'send', ' '), /Enter a question/);
  await assert.rejects(service.run('rest', 'send', 'x'.repeat(12_001)), /Enter a question/);
  await assert.rejects(service.run('rest', 'connect'), /Sign in first/);
  await assert.rejects(service.run('mcp-local', 'connect'), /harness model/);
  const keyless = createService({}, () => {}, () => ({ llmEndpoint: 'https://test.openai.azure.com', llmDeployment: 'test', llmAuth: 'key', llmApiKey: '' }));
  await assert.rejects(keyless.run('mcp-remote', 'connect'), /model API key/);
  assert.equal(fetch.mock.callCount(), 0);
  assert.equal(service.busy, false);
});

test('service closes only the routes a settings change affects', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => new Response('{"id":"test-conversation"}', { status: 201 }));
  const service = createService({ token: async () => 'test-token' }, () => {}, () => ({}));
  await service.run('rest', 'connect');
  await service.close(false, ['mcp-local', 'mcp-remote', 'a2a']);
  await service.run('rest', 'connect');
  assert.equal(fetch.mock.callCount(), 1, 'REST stays connected');
  await service.close(false, ['rest']);
  await service.run('rest', 'connect');
  assert.equal(fetch.mock.callCount(), 2, 'REST creates a new conversation after its own close');
});

test('service isolates contexts, serializes requests, supports abort and waits for shutdown', async t => {
  let requests = 0;
  let entered;
  const fetching = new Promise(resolve => { entered = resolve; });
  t.mock.method(globalThis, 'fetch', async (_url, { signal }) => {
    requests++;
    if (requests === 1) return new Response('{"id":"first-conversation"}', { status: 201 });
    entered();
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  });
  const traces = [];
  const service = createService({ token: async () => 'private-test-token' }, trace => traces.push(trace), () => ({}));
  await service.run('rest', 'connect');
  const sending = service.run('rest', 'send', 'Question');
  const stopped = assert.rejects(sending, /Stopped waiting.*may still be processing/);
  await fetching;
  await assert.rejects(service.run('a2a', 'connect'), /current request/);
  await assert.rejects(service.close(), /current request/);
  await service.close(true);
  await stopped;
  assert.equal(service.busy, false);
  assert.ok(!JSON.stringify(traces).includes('private-test-token'));
  assert.equal(traces.at(-1).direction, 'error');
});

test('a settings change closes only the routes that use the changed setting', () => {
  const base = { tenantId: 'tenant', clientId: 'client', mcpTenantId: '', mcpClientId: '', agentId: '', localAccount: '',
    llmEndpoint: 'https://test.openai.azure.com', llmDeployment: 'test', llmApi: 'responses', llmReasoning: '', llmAuth: 'entra', llmApiKey: '' };
  assert.deepEqual(affectedRoutes(base, { ...base }), []);
  assert.deepEqual(affectedRoutes(base, { ...base, agentId: 'agent' }), ['a2a']);
  assert.deepEqual(affectedRoutes(base, { ...base, clientId: 'other' }), ['a2a', 'rest']);
  assert.deepEqual(affectedRoutes(base, { ...base, localAccount: 'test@example.com' }), ['mcp-local']);
  assert.deepEqual(affectedRoutes(base, { ...base, mcpClientId: 'other' }), ['mcp-remote']);
  assert.deepEqual(affectedRoutes(base, { ...base, llmReasoning: 'low' }), ['mcp-local', 'mcp-remote']);
  assert.deepEqual(affectedRoutes(base, { ...base, llmApi: 'chat' }), ['mcp-local', 'mcp-remote']);
  // An API key counts only while the model uses it: a key kept in memory under Entra ID changes nothing.
  assert.deepEqual(affectedRoutes({ ...base, llmApiKey: 'test-key' }, { ...base, agentId: 'agent' }), ['a2a']);
  const keyed = { ...base, llmAuth: 'key', llmApiKey: 'test-key' };
  assert.deepEqual(affectedRoutes(keyed, { ...keyed }), []);
  assert.deepEqual(affectedRoutes(keyed, { ...keyed, llmApiKey: 'other-key' }), ['mcp-local', 'mcp-remote']);
  assert.deepEqual(affectedRoutes(keyed, { ...keyed, llmAuth: 'entra' }), ['mcp-local', 'mcp-remote']);
});
