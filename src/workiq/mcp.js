import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import workiq from '@microsoft/workiq/lib/install.js';
import { ORIGIN } from './http.js';

export async function mcp({ local, getToken, account, trace, signal, transport, onClose }) {
  if (!transport) {
    if (local) {
      const command = workiq.getBinaryPath();
      if (!command) throw new Error(`The pinned Work IQ CLI has no binary for ${process.platform}/${process.arch}. Use remote MCP.`);
      transport = new StdioClientTransport({
        command, args: ['mcp', ...(account ? ['--account', account] : [])], stderr: 'pipe',
      });
      transport.stderr.on('data', chunk => trace({ direction: 'diagnostic', body: chunk.toString() }));
    } else {
      transport = new StreamableHTTPClientTransport(new URL(`${ORIGIN}/mcp`), {
        fetch: async (url, init) => {
          if (new URL(url).origin !== ORIGIN) throw new Error('Refusing to send a Work IQ token to another host.');
          const headers = new Headers(init?.headers);
          headers.set('Authorization', `Bearer ${await getToken()}`);
          return fetch(url, { ...init, headers, redirect: 'error' });
        },
      });
    }
  }
  const send = transport.send.bind(transport);
  const started = new Map();
  transport.send = (message, ...args) => {
    if (message.id !== undefined) started.set(message.id, performance.now());
    trace({ direction: 'request', body: message });
    return send(message, ...args);
  };
  transport.onmessage = message => {
    const start = started.get(message.id);
    started.delete(message.id);
    trace({ direction: 'response', ...(start !== undefined && { ms: Math.round(performance.now() - start) }), body: message });
  };
  const client = new Client({ name: 'workiq-showcase', version: '0.1.0' });
  client.onerror = error => trace({ direction: 'error', body: error.message });
  client.onclose = onClose;
  try {
    await client.connect(transport, { signal, timeout: 180_000 });
    return { client, server: client.getServerVersion(), close: () => client.close() };
  } catch (error) {
    await client.close();
    throw error;
  }
}
