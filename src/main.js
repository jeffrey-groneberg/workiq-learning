import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, basename } from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { findCli, cliCommand } from './workiq/cli.js';
import { createAuth, validateSettings, storable, publicSettings, keptKey, sameOrigin, AZURE_AI } from './auth.js';
import { createService, affectedRoutes } from './service.js';
import { testModel } from './harness.js';
import { redact } from './workiq/http.js';

const root = fileURLToPath(new URL('../', import.meta.url));
if (!app.isPackaged && existsSync(join(root, '.env'))) process.loadEnvFile(join(root, '.env'));
// Microsoft 365 data must not leave via third-party tracing, even if LangSmith is configured globally.
process.env.LANGSMITH_TRACING = process.env.LANGCHAIN_TRACING_V2 = 'false';
// Apps launched from the macOS Finder do not inherit the shell PATH that contains az.
if (process.platform === 'darwin') process.env.PATH = `${process.env.PATH}:/opt/homebrew/bin:/usr/local/bin`;
const sources = ['harness.js', 'workiq/mcp.js', 'workiq/cli.js', 'workiq/a2a.js', 'workiq/rest.js', 'workiq/http.js', 'auth.js', 'service.js', 'main.js', 'preload.cjs'];
let window;
let settings;
let authenticationPending = false;
let lastExport;
const openSignIn = async url => {
  if (new URL(url).origin !== 'https://login.microsoftonline.com') throw new Error('Unexpected Microsoft sign-in host.');
  await shell.openExternal(url);
};
const auth = createAuth(openSignIn);
const mcpAuth = createAuth(openSignIn, { mcp: true });
const authState = () => ({ api: auth.status(), mcp: mcpAuth.status() });
const service = createService(auth, event => {
  if (window && !window.isDestroyed()) window.webContents.send('workiq:trace', event);
}, () => settings, mcpAuth);

async function handle(action, payload = {}) {
  if (action === 'stop') { service.stop(); return {}; }
  // The Connect dialog for local MCP asks, so it can say how to install a missing CLI.
  if (action === 'findCli') return Boolean(await findCli());
  if (authenticationPending) throw new Error('Finish the sign-in in your browser before continuing.');
  if (action === 'initialize') {
    return {
      settings: publicSettings(settings), auth: authState(),
      sources: Object.fromEntries(await Promise.all(sources.map(async name => [
        name, await readFile(join(root, 'src', name), 'utf8'),
      ]))),
    };
  }
  if (action === 'run') return service.run(payload.route, payload.action, payload.question);
  if (action === 'settings') {
    const next = validateSettings(payload);
    next.llmApiKey = keptKey(next, settings);
    if (service.busy) throw new Error('Wait for the current request before saving settings.');
    await mkdir(app.getPath('userData'), { recursive: true });
    await writeFile(join(app.getPath('userData'), 'settings.json'), JSON.stringify(storable(next), null, 2), { mode: 0o600 });
    // Close only the connections a change affects, so other tabs stay connected and signed in.
    const closed = affectedRoutes(settings, next);
    await service.close(false, closed);
    const changed = keys => keys.some(key => next[key] !== settings[key]);
    if (changed(['mcpTenantId', 'mcpClientId'])) mcpAuth.configure({ tenantId: next.mcpTenantId, clientId: next.mcpClientId });
    if (changed(['tenantId', 'clientId'])) auth.configure(next);
    settings = next;
    return { settings: publicSettings(settings), auth: authState(), closed };
  }
  if (action === 'testModel') {
    // Tests the form's model settings without saving them.
    const candidate = validateSettings(payload);
    candidate.llmApiKey = keptKey(candidate, settings);
    return redact(await testModel(candidate));
  }
  if (['signIn', 'signInMcp', 'signOut'].includes(action)) {
    const mcp = action === 'signInMcp' || payload.target === 'mcp';
    const target = mcp ? mcpAuth : auth;
    await service.close(false, mcp ? ['mcp-remote'] : ['a2a', 'rest']);
    target.signOut();
    if (action === 'signOut') return authState();
    authenticationPending = true;
    try { await target.signIn(); return authState(); }
    finally { authenticationPending = false; }
  }
  if (action === 'localLogin' || action === 'acceptEula') {
    const command = await cliCommand();
    await service.close(false, ['mcp-local']);
    if (action === 'acceptEula') {
      const result = await dialog.showMessageBox(window, {
        type: 'question', title: 'Work IQ CLI license agreement',
        message: 'Accept the Work IQ CLI EULA?',
        detail: 'Review the license at https://github.com/microsoft/work-iq before accepting. This changes the CLI EULA acceptance for your user account.',
        buttons: ['Cancel', 'I have reviewed and accept'], defaultId: 0, cancelId: 0,
      });
      if (result.response !== 1) return { message: 'The license agreement was not accepted.' };
    }
    authenticationPending = true;
    try {
      const args = action === 'acceptEula' ? ['accept-eula']
        : ['auth', 'login', ...(settings.localAccount ? ['--account', settings.localAccount] : [])];
      const result = await promisify(execFile)(command, args, { timeout: 180_000, maxBuffer: 1_000_000 });
      return { message: redact(result.stdout.trim() || 'Work IQ CLI command completed.') };
    } finally { authenticationPending = false; }
  }
  if (action === 'exportPdf') {
    const chapter = { 'capabilities-dialog': 'Capabilities', 'why-dialog': 'Work IQ vs Graph', 'auth-dialog': 'Authentication' }[payload.chapter];
    if (!chapter) throw new Error('Unknown chapter.');
    const { canceled, filePath } = await dialog.showSaveDialog(window, {
      title: `Export ${chapter}`, defaultPath: join(app.getPath('downloads'), `Work IQ - ${chapter}.pdf`), filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (canceled || !filePath) return { canceled: true };
    // The renderer has copied the chapter into #print-root; print CSS shows only that, in the light palette.
    const pdf = await window.webContents.printToPDF({
      pageSize: 'A4', printBackground: true, margins: { top: 0.5, bottom: 0.65, left: 0.55, right: 0.55 },
      displayHeaderFooter: true, headerTemplate: '<span></span>',
      footerTemplate: `<div style="width: 100%; margin: 0 0.55in; display: flex; justify-content: space-between; color: #5c5c5c; font-family: Helvetica, Arial, sans-serif; font-size: 8px;"><span>Work IQ integration lab · ${chapter} · <span class="date"></span></span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
    });
    await writeFile(filePath, pdf);
    lastExport = filePath;
    return { name: basename(filePath) };
  }
  if (action === 'openExport') {
    if (!lastExport) throw new Error('Export a PDF first.');
    const error = await shell.openPath(lastExport);
    if (error) throw new Error(error);
    return {};
  }
  if (action === 'openLink') {
    const url = new URL(payload.url);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Only HTTPS links without embedded credentials can be opened.');
    await shell.openExternal(url.href);
    return {};
  }
  throw new Error('Unknown application action.');
}

app.whenReady().then(async () => {
  try {
    const env = name => process.env[`WORKIQ_${name}`] || '';
    const defaults = {
      tenantId: env('TENANT_ID'), clientId: env('CLIENT_ID'), mcpTenantId: env('MCP_TENANT_ID'), mcpClientId: env('MCP_CLIENT_ID'),
      agentId: '', localAccount: '',
      llmEndpoint: env('LLM_ENDPOINT'), llmDeployment: env('LLM_DEPLOYMENT'), llmApi: env('LLM_API') || 'responses', llmReasoning: env('LLM_REASONING'),
      // Microsoft Entra ID works only with Azure endpoints, so other endpoints start with an API key.
      llmAuth: env('LLM_API_KEY') || (env('LLM_ENDPOINT') && !AZURE_AI.test(env('LLM_ENDPOINT'))) ? 'key' : 'entra',
      llmApiKey: env('LLM_API_KEY'),
    };
    const path = join(app.getPath('userData'), 'settings.json');
    const merged = { ...defaults, ...(existsSync(path) ? storable(JSON.parse(await readFile(path, 'utf8'))) : {}) };
    // Saved settings override .env. The .env key is used only for the .env endpoint's host, and then selects API-key authentication.
    if (!sameOrigin(merged.llmEndpoint, defaults.llmEndpoint)) merged.llmApiKey = '';
    settings = validateSettings({ ...merged, ...(merged.llmApiKey ? { llmAuth: 'key' } : {}) });
    auth.configure(settings);
    mcpAuth.configure({ tenantId: settings.mcpTenantId, clientId: settings.mcpClientId });
    ipcMain.handle('workiq', async (event, action, payload) => {
      if (!window || event.senderFrame !== window.webContents.mainFrame) throw new Error('Untrusted IPC sender.');
      try { return { ok: true, data: await handle(action, payload) }; }
      catch (error) { return { ok: false, error: redact(error.message) }; }
    });
    window = new BrowserWindow({
      title: 'Work IQ Showcase', width: 1280, height: 860, minWidth: 700, minHeight: 580,
      webPreferences: {
        preload: join(root, 'src/preload.cjs'),
        contextIsolation: true, sandbox: true, nodeIntegration: false,
      },
    });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', event => event.preventDefault());
    window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    await window.loadFile(join(root, 'src/index.html'));
  } catch (error) {
    dialog.showErrorBox('Work IQ could not start', redact(error.message));
    app.quit();
  }
});
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => service.stop());
app.on('will-quit', event => {
  event.preventDefault();
  service.close(true).then(() => app.exit(0), error => {
    console.error('Could not close Work IQ connections:', redact(error.message));
    app.exit(1);
  });
});
