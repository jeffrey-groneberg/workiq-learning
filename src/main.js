import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import workiq from '@microsoft/workiq/lib/install.js';
import { createAuth, validateSettings } from './auth.js';
import { createService } from './service.js';
import { redact } from './workiq/http.js';

const root = fileURLToPath(new URL('../', import.meta.url));
if (!app.isPackaged && existsSync(join(root, '.env'))) process.loadEnvFile(join(root, '.env'));
// Microsoft 365 data must not leave via third-party tracing, even if LangSmith is configured globally.
process.env.LANGSMITH_TRACING = process.env.LANGCHAIN_TRACING_V2 = 'false';
// Apps launched from the macOS Finder do not inherit the shell PATH that contains az.
if (process.platform === 'darwin') process.env.PATH = `${process.env.PATH}:/opt/homebrew/bin:/usr/local/bin`;
const sources = ['harness.js', 'workiq/mcp.js', 'workiq/a2a.js', 'workiq/rest.js', 'workiq/http.js', 'auth.js', 'service.js', 'main.js', 'preload.cjs'];
let window;
let settings;
let authenticationPending = false;
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
  if (authenticationPending) throw new Error('Finish the sign-in in your browser before continuing.');
  if (action === 'initialize') {
    return {
      settings, auth: authState(),
      sources: Object.fromEntries(await Promise.all(sources.map(async name => [
        name, await readFile(join(root, 'src', name), 'utf8'),
      ]))),
    };
  }
  if (action === 'run') return service.run(payload.route, payload.action, payload.question);
  if (action === 'settings') {
    const next = validateSettings(payload);
    if (service.busy) throw new Error('Wait for the current request before saving settings.');
    await mkdir(app.getPath('userData'), { recursive: true });
    await writeFile(join(app.getPath('userData'), 'settings.json'), JSON.stringify(next, null, 2), { mode: 0o600 });
    await service.close();
    settings = next;
    auth.configure(settings);
    mcpAuth.configure(settings);
    return { settings, auth: authState() };
  }
  if (['signIn', 'signInMcp', 'signOut'].includes(action)) {
    await service.close();
    if (action === 'signOut') {
      auth.signOut(); mcpAuth.signOut();
      return authState();
    }
    const target = action === 'signInMcp' ? mcpAuth : auth;
    target.signOut();
    authenticationPending = true;
    try { await target.signIn(); return authState(); }
    finally { authenticationPending = false; }
  }
  if (action === 'localLogin' || action === 'acceptEula') {
    await service.close();
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
      const command = workiq.getBinaryPath();
      if (!command) throw new Error('The Work IQ CLI is not available for this platform.');
      const args = action === 'acceptEula' ? ['accept-eula']
        : ['auth', 'login', ...(settings.localAccount ? ['--account', settings.localAccount] : [])];
      const result = await promisify(execFile)(command, args, { timeout: 180_000, maxBuffer: 1_000_000 });
      return { message: redact(result.stdout.trim() || 'Work IQ CLI command completed.') };
    } finally { authenticationPending = false; }
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
    const defaults = {
      tenantId: process.env.WORKIQ_TENANT_ID || '', clientId: process.env.WORKIQ_CLIENT_ID || '',
      agentId: '', localAccount: '',
      llmEndpoint: process.env.WORKIQ_LLM_ENDPOINT || '', llmDeployment: process.env.WORKIQ_LLM_DEPLOYMENT || '',
      llmReasoning: process.env.WORKIQ_LLM_REASONING || '',
    };
    const path = join(app.getPath('userData'), 'settings.json');
    settings = validateSettings({ ...defaults, ...(existsSync(path) ? JSON.parse(await readFile(path, 'utf8')) : {}) });
    auth.configure(settings);
    mcpAuth.configure(settings);
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
