// Renders the How to screenshots: the real app with example data, the step's control ringed and pointed at.
// npm run screenshots writes src/assets/howto-1.jpg to howto-5.jpg. It makes no Work IQ or model call.
import { _electron as electron } from 'playwright';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const assets = fileURLToPath(new URL('../src/assets/', import.meta.url));
const profile = await mkdtemp(join(tmpdir(), 'workiq-screens-'));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ['.', `--user-data-dir=${profile}`, '--force-device-scale-factor=1.5'], env });
try {
  const page = await app.firstWindow();
  await page.waitForSelector('#source-code span');
  await page.locator('#howto-dialog').waitFor({ state: 'visible' });
  await page.keyboard.press('Escape');
  // Sized through the window: Playwright's setViewportSize would reset the 1.5x scale to 1x.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1280, 800));
  await page.waitForFunction(() => innerWidth === 1280 && innerHeight === 800);
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));

  // Example data in place of Work IQ and the model, only in this process.
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('workiq');
    ipcMain.handle('workiq', async (event, action, payload) => {
      const trace = entry => event.sender.send('workiq:trace', { route: payload.route, ...entry });
      if (action === 'settings') {
        const { llmApiKey, ...settings } = payload;
        return { ok: true, data: { settings: { ...settings, hasApiKey: Boolean(llmApiKey) }, auth: { api: {}, mcp: {} }, closed: [] } };
      }
      if (action === 'testModel') {
        return { ok: true, data: [
          { ok: true, text: 'Microsoft Entra ID: DefaultAzureCredential returned a token.' },
          { ok: true, text: `${payload.llmDeployment} answered in 1.6 s: POST ${payload.llmEndpoint}/openai/v1/responses, 85 tokens incl. 25 reasoning.` },
          { ok: true, text: 'Tool calling works: the model called the test tool.' },
        ] };
      }
      if (action === 'run' && payload.action === 'connect') return { ok: true, data: { description: '6 Work IQ tools for Deep Agents · gpt-5.1', tools: [] } };
      if (action === 'run' && payload.action === 'send') {
        const tasks = [
          { id: 'task-1', title: 'Prepare Q4 planning deck', dueDateTime: '2026-09-29T15:00:00Z', percentComplete: 50 },
          { id: 'task-2', title: 'Review vendor contract', dueDateTime: '2026-09-30T15:00:00Z', percentComplete: 0 },
          { id: 'task-3', title: 'Update onboarding guide', dueDateTime: '2026-10-02T15:00:00Z', percentComplete: 25 },
        ];
        const search = { filter: 'planner' };
        const read = { entityUrls: ['/me/planner/tasks?$select=title,dueDateTime,percentComplete'] };
        trace({ direction: 'model', ms: 1380, usage: { input: 5210, output: 61, reasoning: 0 }, body: { step: 'model_request', tool_calls: [{ name: 'search_paths', args: search }] } });
        trace({ direction: 'request', body: { jsonrpc: '2.0', id: 11, method: 'tools/call', params: { name: 'search_paths', arguments: search } } });
        trace({ direction: 'response', ms: 410, body: { jsonrpc: '2.0', id: 11, result: { content: [{ type: 'text', text: '/me/planner/tasks\n/me/planner/plans' }] } } });
        trace({ direction: 'model', ms: 1150, usage: { input: 5630, output: 57, reasoning: 0 }, body: { step: 'model_request', tool_calls: [{ name: 'fetch', args: read }] } });
        trace({ direction: 'request', body: { jsonrpc: '2.0', id: 12, method: 'tools/call', params: { name: 'fetch', arguments: read } } });
        trace({ direction: 'response', ms: 860, body: { jsonrpc: '2.0', id: 12, result: { content: [], structuredContent: { results: [{ statusCode: 200, data: {
          '@odata.context': 'https://graph.microsoft.com/v1.0/$metadata#Collection(microsoft.graph.plannerTask)', value: tasks,
        } }] } } } });
        const text = 'You have **3 Planner tasks** assigned to you:\n\n1. **Prepare Q4 planning deck**, due Tuesday, 29 September, 50% complete\n2. **Review vendor contract**, due Wednesday, 30 September, not started\n3. **Update onboarding guide**, due Friday, 2 October, 25% complete';
        trace({ direction: 'model', ms: 1720, usage: { input: 6490, output: 138, reasoning: 0 }, body: { step: 'model_request', answer: text } });
        return { ok: true, data: { text, tools: ['search_paths', 'fetch'], author: 'Deep Agents · gpt-5.1', conversationId: '8c1f5e2a-4b7d-4c39-9a51-2f6d0e7b3c84', elapsedMs: 5640 } };
      }
      return { ok: true, data: {} };
    });
  });

  // The hint, drawn into the page only for the capture: the rest dimmed, a rose ring around the step's control, a pointer on it.
  const shot = async (step, ring, point) => {
    await page.evaluate(([ring, point]) => {
      const layer = document.querySelector('dialog[open]') ?? document.body;
      // The part of each element its scrolling ancestors leave visible.
      const visible = element => {
        let { left, top, right, bottom } = element.getBoundingClientRect();
        for (let parent = element.parentElement; parent; parent = parent.parentElement) {
          if (getComputedStyle(parent).overflow === 'visible') continue;
          const clip = parent.getBoundingClientRect();
          left = Math.max(left, clip.left); top = Math.max(top, clip.top); right = Math.min(right, clip.right); bottom = Math.min(bottom, clip.bottom);
        }
        return { left, top, right, bottom };
      };
      const boxes = [...document.querySelectorAll(ring)].map(visible);
      const left = Math.min(...boxes.map(box => box.left)) - 6, top = Math.min(...boxes.map(box => box.top)) - 6;
      const width = Math.max(...boxes.map(box => box.right)) + 6 - left, height = Math.max(...boxes.map(box => box.bottom)) + 6 - top;
      const marker = document.createElement('div');
      Object.assign(marker.style, { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px`,
        border: '4px solid #b11f4b', borderRadius: '12px', boxShadow: '0 0 0 6px rgba(177, 31, 75, 0.25), 0 0 0 100vmax rgba(20, 20, 20, 0.45)' });
      const target = document.querySelector(point).getBoundingClientRect();
      const cursor = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      cursor.setAttribute('viewBox', '0 0 24 24');
      cursor.innerHTML = '<path d="M5 3v16.5l4.4-4.2 2.8 6.3 3-1.3-2.8-6.2H18.5z" fill="#fff" stroke="#1f1f1f" stroke-width="1.4" stroke-linejoin="round"/>';
      // The arrow's tip (5, 3 of 24) on the control.
      Object.assign(cursor.style, { left: `${target.left + target.width * 0.55 - 8.75}px`, top: `${target.top + target.height * 0.6 - 5.25}px`,
        width: '42px', height: '42px', filter: 'drop-shadow(0 2px 3px rgba(0, 0, 0, 0.35))' });
      for (const element of [marker, cursor]) {
        Object.assign(element.style, { position: 'fixed', pointerEvents: 'none', zIndex: '2147483647' });
        element.dataset.howtoMark = '';
        layer.append(element);
      }
    }, [ring, point]);
    await page.screenshot({ path: join(assets, `howto-${step}.jpg`), type: 'jpeg', quality: 82, animations: 'disabled', caret: 'hide' });
    await page.evaluate(() => document.querySelectorAll('[data-howto-mark]').forEach(element => element.remove()));
    console.log(`howto-${step}.jpg`);
  };

  await shot(1, '.protocol-tabs [role="tab"]', '#tab-a2a');

  await page.locator('#connect').click();
  await page.locator('#llm-endpoint').fill('https://my-resource.openai.azure.com');
  await page.locator('#llm-deployment').fill('gpt-5.1');
  await page.locator('#llm-api').selectOption('responses');
  await page.locator('#llm-auth').selectOption('entra');
  await page.locator('#llm-reasoning').selectOption('low');
  await page.locator('#llm-test').click();
  await page.waitForFunction(() => document.querySelectorAll('#llm-test-result [data-state="ok"]').length === 3);
  await page.locator('#llm-test-result').evaluate(element => element.scrollIntoView({ block: 'center' }));
  await shot(2, '#llm-test, #llm-test-result', '#llm-test');

  await page.locator('#connect-start').click();
  await page.locator('#connect-done').click();
  await page.locator('#question').fill('Which Planner tasks are assigned to me, and when are they due?');
  await page.locator('#send').click();
  await page.locator('.message.assistant').waitFor();
  await page.locator('[data-inspect="wire"]').click();
  await shot(3, '[data-inspect]', '[data-inspect="wire"]');

  await page.locator('.message.assistant .entity').first().click();
  // Scroll only the chat, so the chip sits at its top and the window stays put.
  await page.evaluate(() => {
    const chat = document.querySelector('#chat-scroll'), entities = document.querySelector('.message.assistant .entities');
    chat.scrollTop += entities.getBoundingClientRect().top - chat.getBoundingClientRect().top - 16;
  });
  await shot(4, '.message.assistant .entities', '.message.assistant .entity-list .link-button');

  await shot(5, '.learn-more', '.learn-more [data-open="auth-dialog"]');
} finally {
  await app.close();
  await rm(profile, { recursive: true, force: true });
}
