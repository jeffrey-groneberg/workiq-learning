import { createHttp, redact, ORIGIN } from './workiq/http.js';
import { mcp } from './workiq/mcp.js';
import { a2a } from './workiq/a2a.js';
import { rest } from './workiq/rest.js';
import { harness, chatModel } from './harness.js';

export const ROUTES = ['mcp-local', 'mcp-remote', 'a2a', 'rest'];

// The routes a settings change affects. Both MCP routes use the model; each sign-in has its own routes.
export function affectedRoutes(before, after) {
  const changed = keys => keys.some(key => after[key] !== before[key]);
  const apiKey = settings => (settings.llmAuth === 'key' ? settings.llmApiKey : '');
  const model = changed(['llmEndpoint', 'llmDeployment', 'llmApi', 'llmReasoning', 'llmAuth']) || apiKey(after) !== apiKey(before);
  return [
    ...(model || changed(['localAccount']) ? ['mcp-local'] : []),
    ...(model || changed(['mcpTenantId', 'mcpClientId']) ? ['mcp-remote'] : []),
    ...(changed(['tenantId', 'clientId']) ? ['a2a', 'rest'] : changed(['agentId']) ? ['a2a'] : []),
  ];
}

// The first Flow step of a connection: what the app does before its first call to Work IQ.
function connectStage(route, user) {
  const token = `Every request sends a delegated WorkIQAgent.Ask token${user ? ` for ${user}` : ''}; no client secret.`;
  return {
    'mcp-local': { title: 'Start the Work IQ CLI', detail: 'Runs the Work IQ CLI as a child process (workiq mcp) that speaks MCP over stdin and stdout. The CLI signs in with its own token cache.' },
    'mcp-remote': { title: 'Connect to the hosted MCP endpoint', detail: `Streamable HTTP to ${ORIGIN}/mcp. ${token}` },
    a2a: { title: 'Use your Microsoft sign-in', detail: token },
    rest: { title: 'Use your Microsoft sign-in', detail: token },
  }[route];
}

export function createService(auth, emit, getSettings, mcpAuth = auth) {
  const sessions = new Map();
  let pending;
  function trace(route, event) {
    emit({ route, time: new Date().toISOString(), ...redact(event) });
  }
  return {
    get busy() { return Boolean(pending); },
    async run(route, action, question) {
      if (!ROUTES.includes(route)) throw new Error('Unknown integration.');
      if (!['connect', 'send', 'reset', 'disconnect'].includes(action)) throw new Error('Unknown integration action.');
      if (pending) throw new Error('Wait for the current request, or stop waiting before starting another.');
      if (action === 'send' && (typeof question !== 'string' || !question.trim() || question.length > 12_000)) {
        throw new Error('Enter a question between 1 and 12,000 characters.');
      }
      const controller = new AbortController();
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(300_000)]);
      let finish;
      pending = { controller, done: new Promise(resolve => { finish = resolve; }) };
      try {
        if (action === 'disconnect') {
          const session = sessions.get(route);
          sessions.delete(route);
          await session?.close?.();
          return {};
        }
        if (action === 'reset') {
          sessions.get(route)?.reset();
          return {};
        }
        if (!sessions.has(route)) {
          const settings = getSettings();
          const record = event => trace(route, event);
          if (route.startsWith('mcp-') && (!settings.llmEndpoint || !settings.llmDeployment)) {
            throw new Error('Set the harness model (endpoint and model) first.');
          }
          if (route.startsWith('mcp-') && settings.llmAuth === 'key' && !settings.llmApiKey) {
            throw new Error('Enter the model API key, or choose Microsoft Entra ID.');
          }
          record({ direction: 'stage', body: connectStage(route, (route === 'mcp-remote' ? mcpAuth : auth).status?.().username) });
          let session;
          if (route.startsWith('mcp-')) {
            const connection = await mcp({
              local: route === 'mcp-local', getToken: () => mcpAuth.token(),
              account: settings.localAccount, trace: record, signal,
              onClose: () => {
                sessions.delete(route);
                trace(route, { direction: 'disconnected', body: 'MCP connection closed. Reconnect to continue.' });
              },
            });
            try {
              session = await harness({
                connection, model: chatModel(settings), trace: record,
                name: `Deep Agents · ${settings.llmDeployment}`,
              });
            } catch (error) {
              await connection.close();
              throw error;
            }
          } else {
            const request = createHttp(() => auth.token(), record);
            session = route === 'a2a' ? a2a(request, settings.agentId) : rest(request);
            session.info = await session.connect(signal);
          }
          if (signal.aborted) {
            await session.close?.();
            signal.throwIfAborted();
          }
          sessions.set(route, session);
        }
        const session = sessions.get(route);
        if (action === 'connect') return session.info;
        const start = performance.now();
        const reply = await session.send(question.trim(), signal);
        return { ...reply, elapsedMs: Math.round(performance.now() - start) };
      } catch (error) {
        const message = signal.aborted
          ? (controller.signal.aborted ? 'Stopped waiting. Work IQ may still be processing the request.' : 'The request did not finish within 5 minutes. Inspect the trace before retrying.')
          : error.message;
        trace(route, { direction: 'error', body: message });
        throw new Error(message);
      } finally {
        pending = undefined;
        finish();
      }
    },
    stop() { pending?.controller.abort(); },
    async close(force = false, routes = ROUTES) {
      if (pending && !force) throw new Error('Finish or stop the current request before changing connections.');
      if (force && pending) {
        pending.controller.abort();
        await pending.done;
      }
      const connections = routes.filter(route => sessions.has(route)).map(route => sessions.get(route));
      routes.forEach(route => sessions.delete(route));
      await Promise.all(connections.map(session => session.close?.()));
    },
  };
}
