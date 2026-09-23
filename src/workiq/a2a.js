import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const textOf = (parts = []) => parts.filter(part => typeof part.text === 'string').map(part => part.text).join('\n');
const active = new Set(['TASK_STATE_SUBMITTED', 'TASK_STATE_WORKING']);

export function readA2AReply(result) {
  const task = result.task || result;
  const state = task.status?.state;
  if (!result.message && !state) throw new Error('A2A returned a task without a status.');
  if (state && !['TASK_STATE_COMPLETED', 'TASK_STATE_INPUT_REQUIRED'].includes(state)) {
    throw new Error(`A2A task ${state}: ${textOf(task.status.message?.parts) || 'Inspect the task response.'}`);
  }
  const text = result.message
    ? textOf(result.message.parts)
    : (task.artifacts || []).map(artifact => textOf(artifact.parts)).filter(Boolean).join('\n\n')
      || textOf(task.status?.message?.parts);
  if (!text.trim()) throw new Error('A2A returned no text. Inspect the task; no answer was substituted.');
  return {
    text, conversationId: task.contextId || result.message?.contextId,
    taskId: task.id, taskState: state,
    notice: state === 'TASK_STATE_INPUT_REQUIRED' ? 'The agent needs your input. Reply to continue.' : undefined,
  };
}

export function a2a(request, agentId = '') {
  const path = `/a2a/${agentId ? `${encodeURIComponent(agentId)}/` : ''}`;
  const headers = { 'A2A-Version': '1.0' };
  let contextId;
  let inputTaskId;
  async function rpc(method, params, signal) {
    const data = await request(path, {
      headers, signal, body: { jsonrpc: '2.0', id: randomUUID(), method, params },
    });
    if (data.error) throw new Error(`A2A ${data.error.code}: ${data.error.message}`);
    if (!data.result) throw new Error('A2A response is missing its JSON-RPC result.');
    return data.result;
  }
  return {
    async connect(signal) {
      const card = await request(`${path}.well-known/agent-card.json`, { headers, signal });
      if (!card.name) throw new Error('The A2A endpoint returned no agent name.');
      return { description: card.name, agentCard: card };
    },
    async send(question, signal) {
      let result = await rpc('SendMessage', {
        message: {
          role: 'ROLE_USER', messageId: randomUUID(),
          ...(contextId ? { contextId } : {}),
          ...(inputTaskId ? { taskId: inputTaskId } : {}),
          parts: [{ text: question }],
          metadata: {
            Location: {
              timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
              timeZoneOffset: -new Date().getTimezoneOffset(),
            },
          },
        },
      }, signal);
      let task = result.task || result;
      contextId = task.contextId || result.message?.contextId || contextId;
      while (active.has(task.status?.state)) {
        if (!task.id) throw new Error('A2A returned an active task without an ID.');
        await delay(750, undefined, { signal });
        result = await rpc('GetTask', { id: task.id }, signal);
        task = result.task || result;
      }
      const reply = readA2AReply(result);
      contextId = reply.conversationId || contextId;
      inputTaskId = reply.taskState === 'TASK_STATE_INPUT_REQUIRED' ? reply.taskId : undefined;
      return { ...reply, conversationId: contextId };
    },
    reset() { contextId = undefined; inputTaskId = undefined; },
  };
}
