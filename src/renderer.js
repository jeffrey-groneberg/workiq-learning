import { marked } from '../node_modules/marked/lib/marked.esm.js';
import DOMPurify from '../node_modules/dompurify/dist/purify.es.mjs';
import hljs from '../node_modules/@highlightjs/cdn-assets/es/core.min.js';
import javascript from '../node_modules/@highlightjs/cdn-assets/es/languages/javascript.min.js';
import json from '../node_modules/@highlightjs/cdn-assets/es/languages/json.min.js';

hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('json', json);

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const docs = 'https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/work-iq/';
const guides = {
  'mcp-local': {
    title: 'Your harness, with Work IQ as tools.',
    description: 'Deep Agents runs in this app with your model and calls Work IQ tools through the local CLI (stdio).',
    summary: 'A Deep Agents harness runs in this app. Your model reads the Work IQ tools discovered over stdio, decides which to call and writes the answer.',
    path: 'Your question\n  > Deep Agents + your model (this app)\n  > local Work IQ CLI (MCP over stdio)\n  > Microsoft-hosted Work IQ',
    harness: 'This is the harness: tool choice, planning, memory and the final answer happen here; the answer streams in as the model writes it. Work IQ supplies the tools; its ask tool still reasons with Copilot. Only read-oriented tools are exposed: ask, fetch, call_function, search_paths, get_schema, list_agents.',
    auth: "Two sign-ins. The Work IQ CLI uses Microsoft's registration and its own cache (tenant consent applies). The model uses Microsoft Entra ID through DefaultAzureCredential, or an API key.",
    caveat: 'Tool results, your Microsoft 365 data, are sent to your model endpoint. Withholding write tools in code is not an authorization boundary. Deep Agents files live in memory only.',
    cost: 'Two separate charges can apply. Copilot Credits for the Work IQ calls: see What a call costs and the tool list below. Tokens for your model, billed by its provider; with Azure OpenAI, on your Azure bill, and reasoning tokens are billed as output tokens. Microsoft Learn lists a usage-based billing plan, with the user assigned, as a CLI prerequisite. It publishes no CLI-specific meters, so this app applies the same reading to local calls.',
    page: 'cli', source: 'harness.js',
    art: 'route-mcp-local', artAlt: 'A robot at a laptop takes a tool from a toolbox on its own desk; a line runs from the toolbox to a tall cabinet of drawers.',
  },
  'mcp-remote': {
    title: 'The same harness. No local process.',
    description: 'Deep Agents calls the hosted Work IQ MCP endpoint over Streamable HTTP.',
    summary: 'Identical harness code; only the transport changes. Tools are discovered on the hosted server and chosen by your model.',
    path: 'Your question\n  > Deep Agents + your model (this app)\n  > https://workiq.svc.cloud.microsoft/mcp\n  > Work IQ tools',
    harness: 'Same Deep Agents loop and read-oriented tool list as the local tab. In a customer harness, your model can combine these tools with your own systems.',
    auth: "Browser sign-in uses the public client and callback port in Microsoft's published MCP plugin, unless you enter your own registration when you connect. The model uses Microsoft Entra ID through DefaultAzureCredential, or an API key. Tenant consent still applies.",
    caveat: 'This app does not copy credentials from Copilot or other hosts. Tool results are sent to your model endpoint. Direct A2A/REST use your configured app registration.',
    cost: 'Two separate charges can apply, as with local MCP. Copilot Credits for the Work IQ calls: see What a call costs and the tool list below. Tokens for your model, billed by its provider; with Azure OpenAI, on your Azure bill, and reasoning tokens are billed as output tokens. The MCP handshake and tools/list are not documented as billable.',
    page: 'mcp/overview', source: 'harness.js',
    art: 'route-mcp-remote', artAlt: 'A robot at a laptop with nothing else on the desk; one line runs straight to a toolbox mounted on a tall cabinet of drawers.',
  },
  a2a: {
    title: 'Delegate a task to a Work IQ agent.',
    description: 'Discover the agent card, send a task and keep its context for follow-up.',
    summary: 'The desktop app plays the calling-agent role. It sends A2A 1.0 JSON-RPC directly; no multi-agent framework is required.',
    path: 'GET /a2a/.well-known/agent-card.json\nPOST /a2a/  > SendMessage\nFollow-up  > contextId',
    harness: 'The remote Work IQ agent owns its reasoning. A caller harness is optional: use one when deciding which agents should get tasks, not just to demonstrate the protocol.',
    auth: 'A delegated WorkIQAgent.Ask token for your approved Entra public-client app. Local CLI and remote MCP sign-ins are not reused for this route.',
    caveat: 'A2A-Version: 1.0 is required. Active tasks are polled with GetTask. Stop waiting aborts the local wait; it does not promise cancellation of work on the server.',
    cost: "This app calls no model of yours on this route, so it adds no model charge; a harness that adds its own model pays for that model separately. Work IQ is billed in Copilot Credits. This app's reading: each SendMessage is Work IQ Chat, with variable credits, because Microsoft Learn lists A2A under Work IQ Chat; the agent reasons in the background and returns an answer or asks for more input. The Copilot Credits Guide gives no credit figures for Chat. Reading the agent card and GetTask polling are not documented as billable.",
    page: 'a2a/quickstart', source: 'workiq/a2a.js',
    art: 'route-a2a', artAlt: 'One robot hands a sealed envelope to a second robot, who stands in front of a tall cabinet of drawers.',
  },
  rest: {
    title: 'A conversation, with two HTTP calls.',
    description: 'Create a conversation, then post questions to its chat endpoint.',
    summary: 'A direct application integration: your app owns the chat UX and conversation ID; Work IQ generates the grounded reply.',
    path: 'POST /rest/conversations  > {}\nPOST /rest/conversations/{id}/chat\nBody  > message + locationHint',
    harness: 'No model of yours is involved: Work IQ generates the grounded reply. The MCP tab shows the harness pattern for when your application needs its own orchestration.',
    auth: 'Your approved public-client app with delegated WorkIQAgent.Ask consent. No client secret and no application-only authentication.',
    caveat: 'These are the documented stable /rest routes, not /rest/beta or the older Graph Chat API. Source attributions and sensitivity information are shown when returned.',
    cost: "This app calls no model of yours on this route, so it adds no model charge; a harness that adds its own model pays for that model separately. Work IQ is billed in Copilot Credits. This app's reading: each chat call is Work IQ Chat, with variable credits, because Microsoft Learn lists REST under Work IQ Chat; Copilot reasons in the background and returns the answer. The Copilot Credits Guide gives no credit figures for Chat. Creating a conversation is not documented as billable.",
    page: 'rest/copilotconversation-chat', source: 'workiq/rest.js',
    art: 'route-rest', artAlt: 'A developer passes a note through a service window; a robot behind it hands back a reply.',
  },
};
const fresh = () => ({ messages: [], trace: [], connected: false, context: '', error: '', info: null, draft: '', question: '', pending: null, open: new Set() });
const sessions = Object.fromEntries(Object.keys(guides).map(route => [route, fresh()]));
let route = 'mcp-local';
let transport = 'local';
let inspector = 'source';
let busy = false;
let sources = {};
let auth = { api: {}, mcp: {} };
let settings = {};
let connecting = null;

async function call(action, payload) {
  if (!window.workiq) throw new Error('Open the desktop app with npm start. Browser previews cannot call Work IQ.');
  const result = await window.workiq.invoke(action, payload);
  if (!result.ok) throw new Error(result.error);
  return result.data;
}
function text(selector, value) { $(selector).textContent = value || ''; }
function node(tag, content, className) {
  const element = document.createElement(tag);
  if (content !== undefined) element.textContent = content;
  if (className) element.className = className;
  return element;
}
function showError(error) {
  sessions[route].error = error.message;
  renderStatus();
}
function setBusy(value, label = 'Working...') {
  busy = value;
  $$('[data-tab], [data-transport], [data-prompt], #reset, #connect, #why-try, #connect-form button').forEach(button => { button.disabled = value; });
  $('#stop').hidden = !value;
  text('#composer-hint', value ? label : 'Enter to send; Shift+Enter for a new line.');
  renderStatus();
}
function renderStatus() {
  const current = sessions[route];
  text('#connection-status', busy ? 'Working' : current.error ? 'Needs attention' : current.connected ? 'Connected' : 'Not connected');
  $('#connection-status').dataset.state = busy ? 'busy' : current.error ? 'error' : current.connected ? 'ready' : 'idle';
  text('#connect', current.connected ? 'Disconnect' : 'Connect');
  $('#send').disabled = busy || !current.connected || !$('#question').value.trim();
  $('#question').disabled = busy;
  text('#chat-error', current.error);
  $('#chat-error').hidden = !current.error;
  if (!busy) text('#composer-hint', current.connected ? 'Enter to send; Shift+Enter for a new line.' : 'Connect to send a message.');
  text('#conversation-id', current.context ? `Context: ${current.context}` : 'No conversation yet');
  $('#conversation-id').title = current.context;
}
function renderSource() {
  const source = (sources[$('#source-file').value] || '').trimEnd();
  $('#source-code').innerHTML = lineSpans(hljs.highlight(source, { language: 'javascript' }).value);
  text('#line-count', `${source ? source.split('\n').length : 0} lines`);
}
// highlight.js markup can span lines (comments, templates). Reopen and close spans per line for line numbers.
function lineSpans(html) {
  const open = [];
  return html.split('\n').map(line => {
    const prefix = open.join('');
    for (const tag of line.match(/<span[^>]*>|<\/span>/g) || []) tag === '</span>' ? open.pop() : open.push(tag);
    return `<span class="line">${prefix}${line}${'</span>'.repeat(open.length)}</span>`;
  }).join('');
}
const seconds = ms => `${(ms / 1000).toFixed(1)} s`;
const count = value => value.toLocaleString('en-US');
const workiqName = { 'mcp-local': 'Work IQ · local MCP', 'mcp-remote': 'Work IQ · remote MCP', a2a: 'Work IQ · A2A', rest: 'Work IQ · REST' };
const actorName = actor => ({ you: 'You', model: `Model · ${settings.llmDeployment}`, workiq: workiqName[route], app: 'This app', pending: 'In progress' })[actor];
const author = () => (route.startsWith('mcp-') ? `Deep Agents · ${settings.llmDeployment}` : 'Work IQ');
const firstStatus = { 'mcp-local': 'The model is thinking…', 'mcp-remote': 'The model is thinking…', a2a: 'Sending the task to the Work IQ agent…', rest: 'Sending your message to Work IQ…' };

// Plain-language result of the connection steps (handshake, discovery, agent card, conversation).
function explain(request, response) {
  const result = response?.result;
  if (request.body?.method === 'initialize') return result?.serverInfo && `${result.serverInfo.name} ${result.serverInfo.version} · MCP protocol ${result.protocolVersion}`;
  if (request.body?.method === 'tools/list') return result?.tools && `${result.tools.length} tools: ${result.tools.map(tool => tool.name).join(', ')}`;
  if (request.url?.endsWith('agent-card.json')) return response?.name && `Agent: ${response.name}${response.capabilities?.streaming ? ' · streaming supported' : ''}`;
  if (request.url?.endsWith('/rest/conversations')) return response?.id && `Conversation ${response.id}`;
}

// Pair requests with responses (MCP by JSON-RPC id, HTTP in order) and turn trace events into flow steps.
function flowSteps(events) {
  const steps = [];
  const mcpCalls = new Map();
  let http;
  for (const event of events) {
    const body = event.body || {};
    if (event.direction === 'model') {
      const calls = body.tool_calls?.map(call => call.name).join(', ');
      steps.push({ actor: 'model', title: calls ? `Calls ${calls}` : 'Writes the answer', ms: event.ms, usage: event.usage, detail: body.reasoning, events: [event] });
    } else if (event.direction === 'stage') {
      steps.push({ actor: 'app', title: body.title, detail: body.detail });
    } else if (event.direction === 'request') {
      const title = event.url ? `${event.method} ${new URL(event.url).pathname}${body.method ? ` · ${body.method}` : ''}` : [body.method, body.params?.name].filter(Boolean).join(' · ');
      const step = { actor: 'workiq', title, events: [event], billed: billedAs(event), detail: body.method?.startsWith('notifications/') ? 'Confirms the handshake; no response expected.' : undefined };
      if (event.url) http = step; else if (body.id !== undefined) mcpCalls.set(body.id, step);
      steps.push(step);
    } else if (event.direction === 'response') {
      const step = event.status !== undefined ? http : mcpCalls.get(body.id);
      if (!step) { steps.push({ actor: 'workiq', title: body.method || 'Message from Work IQ', events: [event] }); continue; }
      step.events.push(event);
      step.ms = event.ms;
      step.failed = event.status >= 400 || Boolean(body.error || body.result?.isError);
      step.result = event.status ?? (step.failed ? 'error' : 'result');
      step.detail = explain(step.events[0], body);
      if (event.status !== undefined) http = undefined;
    } else {
      const title = { error: 'Error', disconnected: 'Disconnected', diagnostic: 'Work IQ CLI output' }[event.direction] || event.direction;
      steps.push({ actor: 'app', title, detail: String(event.body ?? ''), failed: event.direction === 'error', events: [event] });
    }
  }
  return steps;
}
function statusOf(event) {
  const body = event.body || {};
  if (event.direction === 'model') {
    const calls = body.tool_calls?.map(call => call.name) || [];
    return calls.length ? `The model chose ${calls.join(', ')}…` : 'Writing the answer…';
  }
  if (event.direction === 'request') {
    if (body.method === 'initialize') return 'MCP handshake with Work IQ…';
    if (body.method === 'tools/list') return 'Discovering the Work IQ tools…';
    if (event.url?.endsWith('agent-card.json')) return 'Reading the agent card…';
    if (body.method === 'tools/call') return `Waiting for Work IQ: ${body.params?.name}…`;
    if (body.method === 'SendMessage') return 'The Work IQ agent is working on the task…';
    if (body.method === 'GetTask') return 'Checking the task status…';
    if (event.url?.endsWith('/chat')) return 'Work IQ is writing the answer…';
    if (event.url?.endsWith('/conversations')) return 'Creating a conversation…';
  }
  if (event.direction === 'response' && body.result && 'content' in body.result) return 'Work IQ answered. The model is reading the result…';
  if (event.direction === 'diagnostic') return `Work IQ CLI: ${String(body).trim().slice(0, 120)}`;
  if (event.direction === 'stage') return `${body.title}…`;
}
function metricsOf(events, totalMs) {
  const sum = (list, pick) => list.reduce((total, item) => total + (pick(item) || 0), 0);
  const model = events.filter(event => event.direction === 'model');
  const calls = events.filter(event => event.direction === 'response' && event.ms !== undefined);
  return {
    totalMs, workiqMs: sum(calls, event => event.ms), calls: calls.length,
    model: model.length && {
      ms: sum(model, event => event.ms), steps: model.length,
      input: sum(model, event => event.usage?.input), output: sum(model, event => event.usage?.output), reasoning: sum(model, event => event.usage?.reasoning),
    },
  };
}
// Work IQ meters, per the Copilot Credits Guide (September 2026): Tools API, 0.1 credit per call; Chat or
// Context, variable. Microsoft publishes no per-tool meter table. This app's reading: ask is Chat, the nine
// other tools in Microsoft's ten-tool list are Tools API. Everything else is left unclassified.
const TOOLS_API = ['fetch', 'call_function', 'search_paths', 'get_schema', 'list_agents', 'create_entity', 'update_entity', 'delete_entity', 'do_action'];
function billedAs(request) {
  const body = request?.body || {};
  if (body.method === 'tools/call') return body.params?.name === 'ask' ? 'ask' : TOOLS_API.includes(body.params?.name) ? 'tool' : undefined;
  if (body.method === 'SendMessage') return 'SendMessage';
  if (request?.url?.endsWith('/chat')) return 'chat';
}
function creditNote(step) {
  if (!step.billed) return 'Copilot Credits: not documented as billable';
  const note = `Copilot Credits, app estimate: ${step.billed === 'tool' ? '0.1 (Tools API meter)' : 'variable (Chat meter; background reasoning in Work IQ)'}`;
  return step.failed ? `${note}; billing of failed calls not documented` : note;
}
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
function creditsLine(events) {
  const steps = flowSteps(events).filter(step => step.billed);
  const tools = steps.filter(step => step.billed === 'tool').length;
  const variable = steps.filter(step => step.billed !== 'tool');
  const failed = steps.filter(step => step.failed).length;
  const parts = [
    tools && `${plural(tools, 'Tools API call')} × 0.1 = ${tools / 10} ($${(tools / 1000).toFixed(3)} at the pay-as-you-go list price)`,
    variable.length && `${plural(variable.length, `${variable[0].billed} call`)}: variable (background reasoning in Work IQ), not calculated`,
    failed && `incl. ${plural(failed, 'failed call')}; Microsoft does not document whether failed calls are billed`,
  ].filter(Boolean);
  return `Copilot Credits, app estimate (not a bill): ${parts.join(' · ') || 'no Tools API or Chat call in this answer'}`;
}
// Microsoft 365 entity types, with icons drawn in one consistent stroke.
const ENTITY = {
  meeting: ['meeting', 'meetings', '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>'],
  email: ['email', 'emails', '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>'],
  chat: ['Teams message', 'Teams messages', '<path d="M4 5h16v11H9l-5 4z"/>'],
  file: ['file', 'files', '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>'],
  person: ['person', 'people', '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>'],
  task: ['task', 'tasks', '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="m8 12 3 3 5-6"/>'],
  site: ['site', 'sites', '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>'],
};
// Data tools: the Graph-style path and @odata.context name the entity type exactly.
const PATH_RULES = [[/chats|channels|chatMessage/i, 'chat'], [/events|calendar|onlineMeetings|transcripts/i, 'meeting'], [/messages|mailFolders/i, 'email'],
  [/drive|items|driveItem/i, 'file'], [/people|users|manager|directReports|contacts/i, 'person'], [/planner|todo|tasks/i, 'task'], [/sites/i, 'site']];
// Answers from ask, REST and A2A: classify the links and entity tags they cite (heuristic).
const LINK_RULES = [[/teams\.microsoft\.com\/l\/meeting|path=\/calendar/i, 'meeting'], [/teams\.microsoft\.com\/l\/(message|chat|channel)/i, 'chat'],
  [/path=\/mail|outlook\.office\.com\/mail|\/owa\//i, 'email'], [/sharepoint\.com|onedrive|1drv\.ms/i, 'file'], [/office\.com\/search\?q=/i, 'person'], [/tasks\.office\.com|planner/i, 'task']];
const TAGS = { event: 'meeting', meeting: 'meeting', person: 'person', people: 'person', file: 'file', document: 'file', email: 'email', message: 'email', mail: 'email', chat: 'chat' };
const parse = value => { try { return JSON.parse(value); } catch { return undefined; } };
const toDate = value => {
  const text = typeof value === 'string' ? value : value?.timeZone === 'UTC' ? `${value.dateTime.slice(0, 23)}Z` : null;
  const date = text && new Date(text);
  return date && !Number.isNaN(date.getTime()) ? date : null;
};
const dateTime = date => date?.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
const plain = html => String(html || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

// Details of an item returned by a data tool, by entity type.
function readItem(type, item, key) {
  const start = toDate(item.start);
  const end = toDate(item.end);
  const person = item.organizer?.emailAddress?.name || item.from?.emailAddress?.name || item.from?.user?.displayName || item.lastModifiedBy?.user?.displayName;
  const meta = {
    meeting: [start && `${dateTime(start)}${end ? ` – ${end.toLocaleTimeString([], { timeStyle: 'short' })}` : ''}`, person && `Organizer: ${person}`, item.location?.displayName],
    email: [person && `From ${person}`, dateTime(toDate(item.receivedDateTime)), item.isRead === false && 'Unread'],
    chat: [person, dateTime(toDate(item.createdDateTime)), plain(item.body?.content).slice(0, 160)],
    file: [person && `Modified by ${person}`, dateTime(toDate(item.lastModifiedDateTime)), item.size && `${count(Math.ceil(item.size / 1024))} KB`],
    person: [item.jobTitle, item.department, item.mail || item.userPrincipalName || item.scoredEmailAddresses?.[0]?.address],
    task: [dateTime(toDate(item.dueDateTime)), item.percentComplete !== undefined && `${item.percentComplete}% complete`, item.status],
    site: [item.description],
  }[type];
  const title = item.subject || item.name || item.displayName || item.title || plain(item.body?.content).slice(0, 80) || 'Untitled item';
  return { key: item.id ?? key, title, meta: meta.filter(Boolean), url: item.webLink || item.webUrl };
}
// A readable title for a cited link: the name in a people link, a file name, or the kind of item.
function citedTitle(type, url) {
  try {
    const parsed = new URL(url);
    if (parsed.searchParams.get('q')) return parsed.searchParams.get('q');
    if (type === 'file') return decodeURIComponent(parsed.pathname.split('/').pop()) || parsed.hostname;
    return { meeting: 'Meeting link', chat: 'Teams message link', email: 'Outlook item', task: 'Task link' }[type] || parsed.hostname;
  } catch { return url; }
}

function entitiesOf(events = []) {
  const read = {};
  const cited = {};
  const calls = new Map();
  let http;
  const classify = (rules, value) => rules.find(([pattern]) => pattern.test(value))?.[1];
  const put = (bucket, type, item) => {
    const items = type && (bucket[type] ||= new Map());
    if (items && !items.has(item.key)) items.set(item.key, item);
  };
  const cite = (url, title, source) => {
    const type = classify(LINK_RULES, url);
    put(cited, type, { key: url, title: title || citedTitle(type, url), meta: [], url, source });
  };
  // Each source keeps its request and response events, and the exact characters (needle) to mark.
  const scan = (text, source) => {
    for (const match of text.matchAll(/\[([^\]]{1,200})\]\((https:\/\/[^)\s"]+)\)/g)) cite(match[2], match[1], { ...source, needle: match[0] });
    for (const match of text.matchAll(/https:\/\/[^\s"'<>)\]\\]+/g)) cite(match[0], undefined, { ...source, needle: match[0] });
    for (const match of text.matchAll(/<(\w+)>([^<]{1,200})<\/\1>/g)) {
      put(cited, TAGS[match[1].toLowerCase()], { key: `tag:${match[2]}`, title: match[2], meta: ['Tagged in the answer'], source: { ...source, needle: match[0] } });
    }
  };
  for (const event of events) {
    const body = event.body || {};
    if (event.direction === 'request' && body.method === 'tools/call') calls.set(body.id, event);
    if (event.direction === 'request' && event.url) http = event;
    if (event.direction !== 'response') continue;
    const request = calls.get(body.id);
    const call = request?.body.params;
    if (['fetch', 'call_function'].includes(call?.name)) {
      const structured = Boolean(body.result?.structuredContent);
      const result = body.result?.structuredContent ?? parse(body.result?.content?.[0]?.text) ?? {};
      const paths = call.arguments?.entityUrls ?? [call.arguments?.functionUrl];
      (result.results?.map(entry => entry.data) ?? [result.data]).forEach((data, index) => {
        if (!data) return;
        const path = paths[index] ?? paths[0] ?? '';
        const type = classify(PATH_RULES, `${data['@odata.context'] || ''} ${path}`);
        const at = `result.${structured ? 'structuredContent' : 'content[0].text'}${result.results ? `.results[${index}]` : ''}.data`;
        (Array.isArray(data.value) ? data.value : [data]).forEach((item, n) => type && put(read, type, {
          ...readItem(type, item, `${body.id}.${index}.${n}`),
          source: {
            verb: 'Returned by', tool: call.name, path, ms: event.ms, request, response: event,
            pointer: Array.isArray(data.value) ? `${at}.value[${n}]` : at, ...(structured ? { target: item } : { needle: item.id }),
          },
        }));
      });
    } else if (call?.name === 'ask') {
      const structured = body.result?.structuredContent?.answer !== undefined;
      const text = structured ? body.result.structuredContent.answer : (body.result?.content || []).map(block => block.text || '').join('\n');
      scan(text, {
        verb: 'Cited in', tool: 'ask', ms: event.ms, request, response: event,
        pointer: `result.${structured ? 'structuredContent.answer' : 'content[0].text'}`, anchor: structured ? '"structuredContent"' : '',
      });
    } else if (event.status !== undefined) {
      const index = (body.messages?.length ?? 0) - 1;
      const last = body.messages?.[index];
      const source = { verb: 'Cited in', tool: `${http?.method} ${http ? new URL(http.url).pathname : ''}`, ms: event.ms, request: http, response: event };
      (last?.attributions || []).forEach((attribution, n) => {
        if (attribution.seeMoreWebUrl?.startsWith('https://')) cite(attribution.seeMoreWebUrl, attribution.providerDisplayName, { ...source, pointer: `messages[${index}].attributions[${n}]`, target: attribution });
      });
      scan(last ? last.text || '' : JSON.stringify(body.result ?? ''), { ...source, pointer: last ? `messages[${index}].text` : 'result' });
    }
  }
  const list = bucket => Object.entries(bucket).map(([type, items]) => [type, [...items.values()]]);
  return { read: list(read), cited: list(cited) };
}

// "Show in payload": the call, the full response, and the item's characters marked and scrolled into view.
const highlightJson = value => hljs.highlight(value, { language: 'json', ignoreIllegals: true }).value;
// Character range of the item in the pretty-printed payload: the object itself, or the exact text (needle).
function locate(payload, { target, needle, anchor }) {
  const json = JSON.stringify(payload, null, 2);
  if (target) {
    let found = false;
    const marked = JSON.stringify(payload, (key, value) => (value === target && !found ? ((found = true), 'workiq-showcase-mark') : value), 2);
    const start = marked.indexOf('"workiq-showcase-mark"');
    const indent = json.slice(json.lastIndexOf('\n', start) + 1).match(/^ */)[0];
    if (start >= 0) return { json, start, end: start + JSON.stringify(target, null, 2).replaceAll('\n', `\n${indent}`).length };
  }
  const escaped = needle ? JSON.stringify(needle).slice(1, -1) : '';
  const start = escaped ? json.indexOf(escaped, anchor ? Math.max(0, json.indexOf(anchor)) : 0) : -1;
  return { json, start, end: start + escaped.length };
}
// Wrap characters start..end of the highlighted code in <mark>, per text node, like a text selection.
function markText(root, start, end) {
  const parts = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let at = 0, current; (current = walker.nextNode()); at += current.length) {
    const from = Math.max(0, start - at), to = Math.min(current.length, end - at);
    if (from < to && !/^\s*\n\s*$/.test(current.data.slice(from, to))) parts.push([current, from, to]);
  }
  for (const [current, from, to] of parts) {
    const range = document.createRange();
    range.setStart(current, from); range.setEnd(current, to);
    range.surroundContents(document.createElement('mark'));
  }
}
function showPayload(source) {
  const http = Boolean(source.request?.url);
  const request = http ? { method: source.request.method, url: source.request.url, body: source.request.body } : source.request?.body.params;
  text('#payload-summary', `${source.verb} ${source.tool}${source.path ? ` ${source.path}` : ''}${source.ms !== undefined ? ` · ${seconds(source.ms)}` : ''}`);
  text('#payload-call-title', http ? 'Request' : 'Tool call');
  $('#payload-request').innerHTML = highlightJson(JSON.stringify(request ?? {}, null, 2));
  text('#payload-pointer', source.pointer);
  const { json, start, end } = locate(source.response.body, source);
  $('#payload-response').innerHTML = highlightJson(json);
  if (start >= 0) markText($('#payload-response'), start, end);
  $('#payload-dialog').showModal();
  $('#payload-response').scrollTop = 0;
  $('#payload-response mark')?.scrollIntoView({ block: 'center' });
}

let entityPanels = 0;
function entityChips(events) {
  const { read, cited } = entitiesOf(events);
  if (!read.length && !cited.length) return null;
  const wrapper = node('div', undefined, 'entities');
  const row = node('div', undefined, 'entity-row');
  const panel = node('ul', undefined, 'entity-list');
  panel.id = `entity-panel-${++entityPanels}`;
  panel.hidden = true;
  wrapper.append(row, panel);
  for (const [label, list] of [['Read', read], ['Cited', cited]]) {
    if (!list.length) continue;
    const group = node('div', undefined, 'entity-group');
    group.append(node('span', label, 'entity-label'));
    for (const [type, items] of list) {
      const [one, many, icon] = ENTITY[type];
      const chip = node('button', undefined, 'entity');
      chip.type = 'button';
      chip.setAttribute('aria-expanded', 'false');
      chip.setAttribute('aria-controls', panel.id);
      chip.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${icon}</svg>`;
      chip.append(`${count(items.length)} ${items.length === 1 ? one : many}`);
      chip.addEventListener('click', () => {
        const opening = chip.getAttribute('aria-expanded') !== 'true';
        row.querySelectorAll('.entity').forEach(other => other.setAttribute('aria-expanded', 'false'));
        chip.setAttribute('aria-expanded', String(opening));
        panel.hidden = !opening;
        panel.replaceChildren(...(opening ? items.map(item => {
          const entry = node('li');
          entry.append(node('strong', item.title));
          if (item.meta.length) entry.append(node('span', item.meta.join(' · '), 'entity-meta'));
          const actions = node('div', undefined, 'entity-actions');
          if (item.url?.startsWith('https://')) {
            const link = node('a', label === 'Read' ? 'Open' : 'Open source');
            link.href = item.url;
            actions.append(link);
          }
          if (item.source?.response) {
            const show = node('button', 'Show in payload', 'link-button');
            show.type = 'button';
            show.addEventListener('click', () => showPayload(item.source));
            actions.append(show);
          }
          if (actions.childElementCount) entry.append(actions);
          return entry;
        }) : []));
      });
      group.append(chip);
    }
    row.append(group);
  }
  return wrapper;
}
function metricsLine({ totalMs, workiqMs, calls, model }) {
  const parts = [`Total ${seconds(totalMs)}`, `Work IQ latency ${seconds(workiqMs)} (${calls} ${calls === 1 ? 'call' : 'calls'})`];
  if (!model) return [...parts, 'Tokens not reported by Work IQ'].join(' · ');
  const tokens = `Model tokens: ${count(model.input + model.output)} (${count(model.input)} in, ${count(model.output)} out${model.reasoning ? ` incl. ${count(model.reasoning)} reasoning` : ''})`;
  return [...parts, `Model latency ${seconds(model.ms)} (${model.steps} ${model.steps === 1 ? 'step' : 'steps'})`, tokens].join(' · ');
}
function flowItem(step, index) {
  const current = sessions[route];
  const item = node('li', undefined, `flow-step ${step.actor}${step.failed ? ' failed' : ''}`);
  const head = node('div', undefined, 'flow-head');
  head.append(node('strong', actorName(step.actor)), node('span', step.title, 'flow-action'));
  const meta = [step.ms !== undefined && seconds(step.ms), step.result].filter(Boolean).join(' · ');
  if (meta) head.append(node('span', meta, 'flow-meta'));
  item.append(head);
  // Every billable actor gets a cost line under its title: tokens for the model, credits for Work IQ.
  if (step.usage) item.append(node('p', `${count(step.usage.input)} in · ${count(step.usage.output)} out${step.usage.reasoning ? ` · ${count(step.usage.reasoning)} reasoning` : ''} tokens`, 'flow-detail'));
  if (step.actor === 'workiq' && step.events?.[0].direction === 'request') item.append(node('p', creditNote(step), 'flow-detail'));
  if (step.detail) item.append(node('p', step.detail, 'flow-note'));
  if (step.actor === 'workiq') {
    const chips = entityChips(step.events);
    if (chips) item.append(chips);
  }
  if (step.events) {
    const details = node('details');
    const payload = node('pre', undefined, 'hljs');
    const summary = node('summary', 'Payload');
    details.append(summary, payload);
    const show = () => { if (details.open && !payload.childElementCount) payload.innerHTML = highlightJson(JSON.stringify(step.events, null, 2)); };
    details.open = current.open.has(index);
    // Record on click (synchronous) so a re-render during the async toggle keeps the state.
    summary.addEventListener('click', () => (details.open ? current.open.delete(index) : current.open.add(index)));
    details.addEventListener('toggle', show);
    show();
    item.append(details);
  }
  return item;
}
function renderTrace() {
  const current = sessions[route];
  const steps = flowSteps(current.trace);
  text('#trace-count', steps.length);
  if (!steps.length && !current.pending) {
    $('#trace').replaceChildren(node('p', 'Connect or send a message to see each step between you, the model and Work IQ.', 'placeholder'));
    return;
  }
  const list = node('ol', undefined, 'flow');
  if (current.question) list.append(flowItem({ actor: 'you', title: current.question }));
  list.append(...steps.map(flowItem));
  if (current.pending) list.append(flowItem({ actor: 'pending', title: current.pending.status }));
  $('#trace').replaceChildren(list);
  if (current.pending) $('#trace').scrollTop = $('#trace').scrollHeight;
}
const markdown = value => DOMPurify.sanitize(marked.parse(value), {
  USE_PROFILES: { html: true },
  FORBID_TAGS: ['img', 'video', 'audio', 'style', 'form', 'input', 'button', 'iframe'],
  FORBID_ATTR: ['style', 'id', 'name'], ALLOWED_URI_REGEXP: /^(https:\/\/|#)/i,
});
function renderPending() {
  const pending = sessions[route].pending;
  if (!pending) { $('#pending').replaceChildren(); return; }
  const article = node('article', undefined, 'message assistant pending');
  const heading = node('div', undefined, 'message-header');
  heading.append(node('strong', author()), node('span', seconds(performance.now() - pending.started), 'pending-elapsed'));
  const status = node('div', undefined, 'pending-status');
  status.setAttribute('role', 'status');
  status.append(node('span', undefined, 'spinner'), node('span', pending.status));
  article.append(heading, status);
  const reasoning = pending.reasoning && node('p', pending.reasoning, 'reasoning-text');
  if (reasoning) article.append(reasoning);
  // The answer as the model streams it; the final reply replaces it when the turn ends.
  if (pending.text) {
    const body = node('div', undefined, 'message-body');
    body.innerHTML = markdown(pending.text);
    article.append(body);
  }
  $('#pending').replaceChildren(article);
  if (reasoning) reasoning.scrollTop = reasoning.scrollHeight;
  $('#chat-scroll').scrollTop = $('#chat-scroll').scrollHeight;
}
function renderMessages() {
  const messages = sessions[route].messages;
  $('#empty-state').hidden = messages.length > 0;
  renderPending();
  $('#messages').replaceChildren(...messages.map(message => {
    const article = node('article', undefined, `message ${message.role}`);
    const heading = node('div', undefined, 'message-header');
    heading.append(node('strong', message.role === 'user' ? 'You' : message.author || 'Work IQ'));
    if (message.elapsedMs !== undefined) heading.append(node('span', seconds(message.elapsedMs)));
    const body = node('div', undefined, 'message-body');
    if (message.role === 'user') body.textContent = message.text;
    else body.innerHTML = markdown(message.text);
    const reasoning = message.trace?.map(event => event.direction === 'model' && event.body?.reasoning).filter(Boolean);
    if (reasoning?.length) {
      const details = node('details', undefined, 'reasoning');
      details.append(node('summary', 'Reasoning'), ...reasoning.map(part => node('p', part, 'reasoning-text')));
      article.append(heading, details, body);
    } else article.append(heading, body);
    const chips = message.trace && entityChips(message.trace);
    if (chips) article.append(chips);
    if (message.sensitivity) article.append(node('p', `Sensitivity: ${message.sensitivity}`, 'message-note'));
    if (message.tools) article.append(node('p', message.tools.length ? `Tools called: ${message.tools.join(', ')}` : 'Answered without calling a tool.', 'message-note'));
    if (message.notice) article.append(node('p', message.notice, 'message-note'));
    if (message.trace) article.append(node('p', metricsLine(metricsOf(message.trace, message.elapsedMs)), 'message-metrics'));
    if (message.trace) article.append(node('p', creditsLine(message.trace), 'message-credits'));
    const citations = node('div', undefined, 'citations');
    for (const source of message.citations || []) {
      if (typeof source.seeMoreWebUrl !== 'string' || !source.seeMoreWebUrl.startsWith('https://')) continue;
      const link = node('a', source.providerDisplayName || 'Source');
      link.href = source.seeMoreWebUrl;
      citations.append(link);
    }
    if (citations.childElementCount) article.append(citations);
    return article;
  }));
}
function renderRoute() {
  const guide = guides[route];
  const tab = route.startsWith('mcp-') ? 'mcp' : route;
  $$('[data-tab]').forEach(button => {
    const selected = button.dataset.tab === tab;
    button.setAttribute('aria-selected', selected);
    button.tabIndex = selected ? 0 : -1;
  });
  $('#workspace').setAttribute('aria-labelledby', `tab-${tab}`);
  $('#transport-switch').hidden = tab !== 'mcp';
  $$('[data-transport]').forEach(button => button.setAttribute('aria-pressed', button.dataset.transport === transport));
  for (const [id, key] of [['route-title', 'title'], ['route-description', 'description'], ['guide-title', 'title'], ['guide-summary', 'summary'], ['guide-path', 'path'], ['guide-harness', 'harness'], ['guide-cost', 'cost'], ['guide-auth', 'auth'], ['guide-caveat', 'caveat']]) {
    text(`#${id}`, guide[key]);
  }
  $('#guide-docs').href = docs + guide.page;
  Object.assign($('#guide-art'), { src: `assets/${guide.art}.jpg`, alt: guide.artAlt });
  $('#tool-guide').hidden = tab !== 'mcp';
  $('#discovery').hidden = !sessions[route].info;
  text('#discovery-json', JSON.stringify(sessions[route].info, null, 2));
  $('#source-file').value = guide.source;
  $('#question').value = sessions[route].draft;
  renderSource(); renderMessages(); renderTrace(); renderStatus();
}
function selectRoute(next) {
  sessions[route].draft = $('#question').value;
  route = next;
  renderRoute();
}
function selectInspector(next) {
  inspector = next;
  $$('[data-inspect]').forEach(button => {
    const selected = button.dataset.inspect === inspector;
    button.setAttribute('aria-selected', selected);
    button.tabIndex = selected ? 0 : -1;
  });
  for (const name of ['source', 'wire', 'guide']) $(`#${name}-panel`).hidden = name !== inspector;
}
// Each tab's Connect dialog asks only for what its route needs, then shows the connection steps live.
const routeFields = { 'mcp-local': ['cli', 'model'], 'mcp-remote': ['remote', 'model'], a2a: ['api', 'agent'], rest: ['api'] };
const signInOf = { 'mcp-remote': 'mcp', a2a: 'api', rest: 'api' };
const signedInWith = (scope, account) => `Signed in as ${account.username}${scope === 'mcp' && account.sharedClient ? " with Microsoft's published MCP client" : ' with your app registration'}.`;
const required = () => $$('#connect-form [required]').filter(input => !input.closest('[hidden]'));
function feedback(message, error = false) {
  text('#connect-feedback', message);
  $('#connect-feedback').dataset.error = error;
  $('#connect-feedback').hidden = !message;
}
function toggleKey() {
  const key = $('#llm-auth').value === 'key';
  // A kept key is used again only for the host it was entered for, as in main.
  const origin = url => URL.parse(url)?.origin;
  const kept = settings.hasApiKey && Boolean(origin($('#llm-endpoint').value)) && origin($('#llm-endpoint').value) === origin(settings.llmEndpoint);
  $('#llm-key-row').hidden = !key;
  $('#llm-entra-help').hidden = key;
  $('#llm-api-key').required = key && !kept;
  $('#llm-api-key').placeholder = kept ? 'Kept in memory until you quit. Leave empty to keep it.' : '';
}
function openConnectDialog() {
  const scope = signInOf[route];
  clearInterval(connecting?.ticker);
  connecting = null;
  // What you need: the route's row of the matrix in How to, with only this MCP transport's lines.
  const needs = $('.howto-steps .needs').cloneNode(true);
  needs.deleteCaption();
  needs.querySelectorAll('tbody tr').forEach(row => { row.hidden = !route.startsWith(row.dataset.route); });
  needs.querySelectorAll('[data-mcp]').forEach(line => { line.hidden = route !== `mcp-${line.dataset.mcp}`; });
  $('#connect-needs').replaceChildren(needs, $('.howto-steps .needs-all').cloneNode(true));
  $$('#connect-form fieldset').forEach(fieldset => { fieldset.hidden = !routeFields[route].includes(fieldset.dataset.for); });
  $$('#connect-form [name]').forEach(input => { input.value = settings[input.name] ?? ''; });
  $('#connect-account').hidden = !auth[scope]?.signedIn;
  if (scope && auth[scope].signedIn) text('#connect-account-text', signedInWith(scope, auth[scope]));
  toggleKey(); feedback('');
  $('#llm-test-result').hidden = true;
  text('#connect-title', `Connect to ${workiqName[route]}`);
  $('#connect-form').hidden = false;
  $('#connect-progress').hidden = true;
  $('#connect-elapsed').hidden = true;
  if (!$('#connect-dialog').open) $('#connect-dialog').showModal();
  // Open at the top, so What you need is in view; typing still brings the focused field into view.
  $('#connect-dialog').scrollTop = 0;
  (required().find(input => !input.value) || $('#connect-start')).focus({ preventScroll: true });
}
// Saving closes only the connections a change affects; main reports which.
async function saveSettings() {
  const saved = await call('settings', Object.fromEntries(new FormData($('#connect-form'))));
  settings = saved.settings; auth = saved.auth;
  for (const name of saved.closed) sessions[name] = fresh();
}
async function connect() {
  const current = sessions[route];
  const scope = signInOf[route];
  current.error = ''; current.trace = [];
  openConnect(scope && !auth[scope].signedIn ? 'Complete the Microsoft sign-in in your browser…' : firstConnectStatus[route]);
  setBusy(true, 'Connecting to Work IQ...');
  try {
    if (scope && !auth[scope].signedIn) {
      $('#stop').hidden = true;
      text('#composer-hint', 'Complete the Microsoft sign-in in your browser.');
      auth = await call(scope === 'mcp' ? 'signInMcp' : 'signIn');
      current.trace.push({ route, direction: 'stage', body: { title: 'Sign in with Microsoft', detail: signedInWith(scope, auth[scope]) } });
      if (connecting) { connecting.status = firstConnectStatus[route]; renderConnect(); }
      $('#stop').hidden = false;
    }
    current.info = await call('run', { route, action: 'connect' });
    current.connected = true;
    current.context = current.info.conversationId || '';
    finishConnect(`Connected in ${seconds(performance.now() - (connecting?.started ?? 0))} · ${current.info.description}`);
    renderRoute();
  } catch (error) {
    showError(error);
    finishConnect(error.message, true);
  } finally { setBusy(false); }
}
async function cliAction(action) {
  setBusy(true);
  feedback('Working. Complete any sign-in in your browser.');
  try {
    await saveSettings();
    feedback((await call(action)).message);
  } catch (error) { feedback(error.message, true); }
  finally { setBusy(false); }
}

$$('[data-tab]').forEach(button => button.addEventListener('click', () => selectRoute(button.dataset.tab === 'mcp' ? `mcp-${transport}` : button.dataset.tab)));
$$('[data-transport]').forEach(button => button.addEventListener('click', () => {
  transport = button.dataset.transport;
  selectRoute(`mcp-${transport}`);
}));
$$('[data-inspect]').forEach(button => button.addEventListener('click', () => selectInspector(button.dataset.inspect)));
$$('[role="tablist"]').forEach(list => list.addEventListener('keydown', event => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || busy) return;
  const tabs = [...list.querySelectorAll('[role="tab"]')];
  const index = tabs.indexOf(document.activeElement);
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
  event.preventDefault(); tabs[next].focus(); tabs[next].click();
}));
$$('[data-prompt]').forEach(button => button.addEventListener('click', () => {
  $('#question').value = button.dataset.prompt; $('#question').focus(); renderStatus();
}));
$('#source-file').addEventListener('change', renderSource);
$('#expand-inspector').addEventListener('click', () => {
  const expanded = $('.workspace-grid').classList.toggle('expanded');
  $('#expand-inspector').setAttribute('aria-expanded', expanded);
  text('#expand-inspector', expanded ? 'Split view' : 'Expand');
});
$('#question').addEventListener('input', renderStatus);
$('#question').addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    if (!$('#send').disabled) $('#composer').requestSubmit();
  }
});
$('#connect').addEventListener('click', async () => {
  if (!sessions[route].connected) { openConnectDialog(); return; }
  setBusy(true, 'Disconnecting...');
  try {
    await call('run', { route, action: 'disconnect' });
    sessions[route] = fresh();
    renderRoute();
  } catch (error) { showError(error); }
  finally { setBusy(false); }
});
// The Connect dialog shows the background steps live, as the same timeline as Flow.
const firstConnectStatus = { 'mcp-local': 'Starting the Work IQ CLI…', 'mcp-remote': 'Connecting to the hosted MCP endpoint…', a2a: 'Reading the agent card…', rest: 'Creating a conversation…' };
function openConnect(status) {
  connecting = { route, started: performance.now(), status, done: false, failed: false, summary: '' };
  text('#connect-elapsed', seconds(0));
  connecting.ticker = setInterval(() => text('#connect-elapsed', seconds(performance.now() - connecting.started)), 200);
  $('#connect-form').hidden = true;
  $('#connect-progress').hidden = false;
  if (!$('#connect-dialog').open) $('#connect-dialog').showModal();
  renderConnect();
}
function finishConnect(summary, failed = false) {
  if (!connecting) return;
  clearInterval(connecting.ticker);
  Object.assign(connecting, { done: !failed, failed, summary });
  renderConnect();
  $(failed ? '#connect-back' : '#connect-done').focus();
}
function renderConnect() {
  if (!connecting) return;
  const steps = flowSteps(sessions[connecting.route].trace).map(flowItem);
  const running = !connecting.done && !connecting.failed;
  if (running) steps.push(flowItem({ actor: 'pending', title: connecting.status }));
  $('#connect-steps').replaceChildren(...steps);
  text('#connect-title', connecting.failed ? 'Connection failed' : connecting.done ? 'Connected' : `Connecting to ${workiqName[connecting.route]}`);
  text('#connect-summary', connecting.summary || 'Each step is a real action or call, shown as it happens.');
  $('#connect-summary').classList.toggle('error', connecting.failed);
  $('#connect-elapsed').hidden = !running;
  $('#connect-done').hidden = !connecting.done;
  $('#connect-back').hidden = !connecting.failed;
  $('#connect-scroll').scrollTop = $('#connect-scroll').scrollHeight;
}
$('#connect-close').addEventListener('click', () => $('#connect-dialog').close());
$('#connect-done').addEventListener('click', () => { $('#connect-dialog').close(); $('#question').focus(); });
$('#connect-back').addEventListener('click', openConnectDialog);
$('#llm-auth').addEventListener('change', toggleKey);
$('#llm-endpoint').addEventListener('input', toggleKey);
// Test model checks the form's model settings with one short call, without saving them.
function showChecks(checks) {
  $('#llm-test-result').replaceChildren(...checks.map(({ ok, text: line }) => {
    const item = node('li', line);
    item.dataset.state = ok === undefined ? 'pending' : ok ? 'ok' : 'fail';
    return item;
  }));
  $('#llm-test-result').hidden = false;
}
$('#llm-test').addEventListener('click', async () => {
  const missing = required().find(input => input.closest('[data-for="model"]') && !input.value.trim());
  if (missing) { showChecks([{ ok: false, text: `${missing.labels[0].firstChild.textContent.trim()} is required.` }]); missing.focus(); return; }
  showChecks([{ text: 'Testing the model…' }]);
  setBusy(true, 'Testing the model...');
  try { showChecks(await call('testModel', Object.fromEntries(new FormData($('#connect-form'))))); }
  catch (error) { showChecks([{ ok: false, text: error.message }]); }
  finally { setBusy(false); }
});
// A changed model setting makes the last result stale.
$('[data-for="model"]').addEventListener('input', () => { $('#llm-test-result').hidden = true; });
$('#connect-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (busy) return;
  const missing = required().find(input => !input.value.trim());
  if (missing) { feedback(`${missing.labels[0].firstChild.textContent.trim()} is required.`, true); missing.focus(); return; }
  setBusy(true);
  try { await saveSettings(); }
  catch (error) { feedback(error.message, true); return; }
  finally { setBusy(false); }
  await connect();
});
$('#local-login').addEventListener('click', () => cliAction('localLogin'));
$('#accept-eula').addEventListener('click', () => cliAction('acceptEula'));
$('#connect-signout').addEventListener('click', async () => {
  const target = signInOf[route];
  setBusy(true);
  try {
    auth = await call('signOut', { target });
    for (const name of target === 'mcp' ? ['mcp-remote'] : ['a2a', 'rest']) sessions[name] = fresh();
    $('#connect-account').hidden = true;
    feedback("Signed out of this app. Your browser's Microsoft session is unchanged.");
  } catch (error) { feedback(error.message, true); }
  finally { setBusy(false); }
});
$('#connect-dialog').addEventListener('close', () => { clearInterval(connecting?.ticker); connecting = null; $('#connect-steps').replaceChildren(); });
$('#payload-close').addEventListener('click', () => $('#payload-dialog').close());
// Explanatory dialogs (Capabilities, Work IQ vs. Graph); the Graph comparison's question can be tried live.
$$('[data-open]').forEach(button => button.addEventListener('click', () => $(`#${button.dataset.open}`).showModal()));
$$('[data-close]').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
$$('dialog').forEach(dialog => dialog.addEventListener('scroll', () => dialog.classList.toggle('scrolled', dialog.scrollTop > 0), { passive: true }));
// Export PDF: the chapter's content without its controls goes into #print-root, which only print CSS shows.
async function exportChapter(dialog, button) {
  const status = dialog.querySelector('.export-status');
  const root = Object.assign(document.createElement('div'), { id: 'print-root', className: dialog.className });
  root.append(dialog.querySelector('.dialog-heading h2').cloneNode(true),
    ...[...dialog.children].filter(child => !child.matches('.dialog-heading, .settings-footer')).map(child => child.cloneNode(true)));
  root.querySelectorAll('[id]').forEach(element => element.removeAttribute('id'));
  document.body.append(root);
  button.disabled = true;
  status.hidden = false;
  status.replaceChildren('Exporting…');
  try {
    await Promise.all([...root.querySelectorAll('img')].map(image => image.decode().catch(() => {})));
    const result = await call('exportPdf', { chapter: dialog.id });
    if (result.canceled) { status.hidden = true; return; }
    const open = node('button', 'Open', 'link-button');
    open.type = 'button';
    open.addEventListener('click', () => call('openExport').catch(error => status.replaceChildren(error.message)));
    status.replaceChildren(`Saved ${result.name}. `, open);
  } catch (error) { status.replaceChildren(error.message); }
  finally { root.remove(); button.disabled = false; }
}
$$('[data-export]').forEach(button => button.addEventListener('click', () => exportChapter(button.closest('dialog'), button)));
$('#why-try').addEventListener('click', () => {
  $('#why-dialog').close();
  selectRoute(`mcp-${transport}`);
  $('#question').value = 'Which Planner tasks are assigned to me, and when are they due? Read the exact task data.';
  renderStatus(); $('#question').focus();
});
$$('[data-highlight]').forEach(code => { code.innerHTML = hljs.highlight(code.textContent, { language: code.dataset.highlight }).value; });
$('#composer').addEventListener('submit', async event => {
  event.preventDefault();
  const current = sessions[route];
  const question = $('#question').value.trim();
  if (busy || !current.connected || !question) return;
  current.error = ''; current.trace = []; current.question = question; current.open = new Set();
  current.messages.push({ role: 'user', text: question });
  current.pending = { status: firstStatus[route], reasoning: '', text: '', started: performance.now() };
  current.draft = '';
  $('#question').value = '';
  renderMessages(); renderTrace();
  setBusy(true, 'Waiting for Work IQ...');
  const ticker = setInterval(() => {
    const elapsed = $('.pending-elapsed');
    if (elapsed && current.pending) elapsed.textContent = seconds(performance.now() - current.pending.started);
  }, 200);
  try {
    const reply = await call('run', { route, action: 'send', question });
    // Keep this turn's trace: late IPC events still land in it and re-render the metrics.
    current.messages.push({ role: 'assistant', ...reply, trace: current.trace });
    current.context = reply.conversationId || current.context;
  } catch (error) { current.draft = question; $('#question').value = question; showError(error); }
  finally {
    clearInterval(ticker);
    current.pending = null;
    renderMessages(); renderTrace(); setBusy(false);
    $('#chat-scroll').scrollTop = $('#chat-scroll').scrollHeight;
    $('#question').focus();
  }
});
$('#stop').addEventListener('click', () => call('stop').catch(showError));
$('#reset').addEventListener('click', async () => {
  if (busy) return;
  try {
    await call('run', { route, action: 'reset' });
    sessions[route] = { ...fresh(), connected: sessions[route].connected, info: sessions[route].info };
    renderRoute();
  } catch (error) { showError(error); }
});
$('#clear-trace').addEventListener('click', () => { Object.assign(sessions[route], { trace: [], question: '', open: new Set() }); renderTrace(); });
document.addEventListener('click', event => {
  const link = event.target.closest('a[href]');
  if (!link) return;
  event.preventDefault();
  if (link.getAttribute('href').startsWith('#')) {
    document.getElementById(link.getAttribute('href').slice(1))?.scrollIntoView({ block: 'nearest' });
    return;
  }
  call('openLink', { url: link.href }).catch(error => $('#connect-dialog').open ? feedback(error.message, true) : showError(error));
});

window.workiq?.onTrace(event => {
  const current = sessions[event.route];
  if (!current) return;
  // Streamed model tokens go into the pending answer. They are not steps, so Flow doesn't store them.
  if (event.direction === 'delta') {
    const { pending } = current;
    if (!pending) return;
    const { id, text: delta, reasoning, part } = event.body;
    // A new model call starts a new draft, so only the last call's text remains: the answer.
    if (id !== pending.id) Object.assign(pending, { id, text: '', reasoning: '', part });
    if (reasoning) pending.reasoning += (pending.reasoning && part !== pending.part ? '\n\n' : '') + reasoning;
    pending.part = part ?? pending.part;
    pending.text += delta;
    const status = delta ? 'The model is writing…' : 'The model is reasoning…';
    const changed = status !== pending.status;
    pending.status = status;
    if (event.route === route) { renderPending(); if (changed) renderTrace(); }
    return;
  }
  current.trace.push(event);
  if (event.direction === 'disconnected') current.connected = false;
  if (current.pending) {
    current.pending.status = statusOf(event) || current.pending.status;
    if (event.body?.reasoning) current.pending.reasoning = event.body.reasoning;
    else if (event.usage?.reasoning) current.pending.reasoning = `The model reasoned for ${count(event.usage.reasoning)} tokens but returned no summary.`;
  }
  if (connecting && event.route === connecting.route) {
    connecting.status = statusOf(event) || connecting.status;
    renderConnect();
  }
  if (event.route === route) { renderTrace(); renderStatus(); current.pending ? renderPending() : renderMessages(); }
});
// How to: one step at a time, through the arrows, the dots or the arrow keys. It opens once, on the first start;
// the ? button in the header opens it again at step 1.
const howtoSteps = $$('.howto-steps > li');
const [howtoPrevious, howtoNext] = $$('.howto-arrow');
let howtoStep = 0;
function showHowtoStep(index) {
  howtoStep = Math.min(Math.max(index, 0), howtoSteps.length - 1);
  howtoSteps.forEach((step, i) => { step.inert = i !== howtoStep; });
  $$('.howto-dots button').forEach((dot, i) => i === howtoStep ? dot.setAttribute('aria-current', 'step') : dot.removeAttribute('aria-current'));
  // A disabled arrow hides; keep the focus in the dialog.
  const focused = document.activeElement;
  howtoPrevious.disabled = howtoStep === 0;
  howtoNext.disabled = howtoStep === howtoSteps.length - 1;
  if (focused === howtoPrevious && howtoPrevious.disabled) howtoNext.focus();
  if (focused === howtoNext && howtoNext.disabled) $('#howto-dialog .primary').focus();
}
$$('[data-step-by]').forEach(arrow => arrow.addEventListener('click', () => showHowtoStep(howtoStep + Number(arrow.dataset.stepBy))));
$$('.howto-dots button').forEach(dot => dot.addEventListener('click', () => showHowtoStep(Number(dot.dataset.step))));
$('#howto-dialog').addEventListener('keydown', event => {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
  event.preventDefault();
  showHowtoStep(howtoStep + (event.key === 'ArrowRight' ? 1 : -1));
});
$('#howto-dialog').addEventListener('close', () => { localStorage.setItem('howto-seen', '1'); showHowtoStep(0); });
showHowtoStep(0);
try {
  const initial = await call('initialize');
  sources = initial.sources; settings = initial.settings; auth = initial.auth;
  $('#source-file').replaceChildren(...Object.keys(sources).map(name => {
    const option = node('option', `src/${name}`); option.value = name; return option;
  }));
  renderRoute();
} catch (error) { showError(error); }
if (!localStorage.getItem('howto-seen')) $('#howto-dialog').showModal();
