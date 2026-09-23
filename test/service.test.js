import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createService } from '../src/service.js';

test('service rejects invalid input and missing authentication without a network call', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Must not fetch'); });
  const service = createService({ token: async () => { throw new Error('Sign in first'); } }, () => {}, () => ({}));
  await assert.rejects(service.run('bad-route', 'send', 'Hello'), /Unknown integration/);
  await assert.rejects(service.run('rest', 'send', ' '), /Enter a question/);
  await assert.rejects(service.run('rest', 'send', 'x'.repeat(12_001)), /Enter a question/);
  await assert.rejects(service.run('rest', 'connect'), /Sign in first/);
  await assert.rejects(service.run('mcp-local', 'connect'), /harness model/);
  assert.equal(fetch.mock.callCount(), 0);
  assert.equal(service.busy, false);
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
