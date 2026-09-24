// Renders docs/public/demo.gif for the README and the docs site: a short tour of the real app with example data. A camera zooms and pans to
// what each step shows; frames are captured at twice the size, so zoomed text stays sharp.
// npm run demo needs ffmpeg on PATH. It makes no Work IQ or model call.
import { _electron as electron } from 'playwright';
import { mkdtemp, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const output = fileURLToPath(new URL('../docs/public/demo.gif', import.meta.url));
// The app window in CSS pixels and its capture scale; the GIF's picture and caption band in pixels.
const [width, height, scale] = [1100, 800, 2];
const [gifWidth, gifHeight, bandHeight] = [800, 582, 36];
const captions = [
  'Chat with your Microsoft 365 data through Work IQ',
  'See every call, with latency, tokens and estimated Copilot Credits',
  'Read the code that runs it',
  'Compare MCP, A2A and the REST API',
  'Look up what each route can read and change',
  'Try it yourself',
];
try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); } catch { throw new Error('npm run demo needs ffmpeg on PATH.'); }

const work = await mkdtemp(join(tmpdir(), 'workiq-demo-'));
// UTC and US English, so dates and times read the same wherever this runs.
const env = { ...process.env, TZ: 'UTC' };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ['.', `--user-data-dir=${join(work, 'profile')}`, `--force-device-scale-factor=${scale}`, '--lang=en-US'], env });
try {
  const page = await app.firstWindow();
  await page.waitForSelector('#source-code span');
  await page.locator('#howto-dialog').waitFor({ state: 'visible' });
  await page.keyboard.press('Escape');
  await app.evaluate(({ BrowserWindow }, [width, height]) => BrowserWindow.getAllWindows()[0].setContentSize(width, height), [width, height]);
  await page.waitForFunction(([width, height]) => innerWidth === width && innerHeight === height, [width, height]);
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
  await page.emulateMedia({ reducedMotion: 'reduce' });

  // Example data in place of Work IQ and the model, only in this process. Each step of an answer waits for
  // globalThis.demoAdvance(), so every frame shows one step. Returns the number of steps, the reply included.
  const answerSteps = await app.evaluate(({ ipcMain }) => {
    let release;
    const gate = () => new Promise(resolve => { release = resolve; });
    globalThis.demoAdvance = () => {
      if (!release) return false;
      const next = release;
      release = undefined;
      next();
      return true;
    };
    const meeting = {
      id: 'meeting-1', subject: 'Q4 planning review', bodyPreview: 'Agenda: launch timeline, Q4 budget, hiring plan.',
      start: { dateTime: '2026-09-29T14:00:00.0000000', timeZone: 'UTC' }, end: { dateTime: '2026-09-29T15:00:00.0000000', timeZone: 'UTC' },
      organizer: { emailAddress: { name: 'Priya Natarajan' } }, location: { displayName: 'Microsoft Teams Meeting' },
      webLink: 'https://outlook.office365.com/owa/?itemid=example-meeting&path=/calendar/item',
    };
    const read = { entityUrls: ['/me/calendarView?startDateTime=2026-09-29T00:00:00Z&endDateTime=2026-09-30T00:00:00Z&$top=1'] };
    const ask = { question: 'What was decided about the Q4 planning review in the last two weeks, and which actions are open? Include sources.' };
    const found = 'Two decisions: the launch moves to 12 November ([RE: Launch date](https://outlook.office365.com/owa/?itemid=example-mail&path=/mail/item)), and the Q4 budget stays at this year\'s level ([Q4 plan.xlsx](https://contoso.sharepoint.com/sites/finance/Shared%20Documents/Q4%20plan.xlsx)). Open actions: you update the revenue forecast; Alex Chen shares the vendor shortlist.';
    const answer = '**Q4 planning review** is next: Tuesday at 2:00 PM on Teams, organized by Priya Natarajan.\n\n**Agenda:** launch timeline, Q4 budget, hiring plan.\n\n**Decided:** the launch moves to **12 November**; the Q4 budget stays at this year\'s level.\n\n**Your open action:** update the revenue forecast before the meeting.';
    const words = answer.match(/\S+\s*/g);
    const deltas = [];
    for (let index = 0; index < words.length; index += 5) deltas.push({ direction: 'delta', body: { id: 'answer', text: words.slice(index, index + 5).join(''), reasoning: '' } });
    const steps = [
      { direction: 'model', ms: 1240, usage: { input: 5480, output: 62, reasoning: 0 }, body: { step: 'model_request', tool_calls: [{ name: 'fetch', args: read }] } },
      { direction: 'request', body: { jsonrpc: '2.0', id: 21, method: 'tools/call', params: { name: 'fetch', arguments: read } } },
      { direction: 'response', ms: 640, body: { jsonrpc: '2.0', id: 21, result: { content: [], structuredContent: { results: [{ statusCode: 200, data: {
        '@odata.context': "https://graph.microsoft.com/v1.0/$metadata#users('me')/calendarView", value: [meeting],
      } }] } } } },
      { direction: 'model', ms: 1080, usage: { input: 6120, output: 71, reasoning: 0 }, body: { step: 'model_request', tool_calls: [{ name: 'ask', args: ask }] } },
      { direction: 'request', body: { jsonrpc: '2.0', id: 22, method: 'tools/call', params: { name: 'ask', arguments: ask } } },
      { direction: 'response', ms: 2870, body: { jsonrpc: '2.0', id: 22, result: { content: [{ type: 'text', text: found }] } } },
      ...deltas,
      { direction: 'model', ms: 1630, usage: { input: 7310, output: 118, reasoning: 0 }, body: { step: 'model_request', answer } },
    ];
    ipcMain.removeHandler('workiq');
    ipcMain.handle('workiq', async (event, action, payload) => {
      const trace = entry => event.sender.send('workiq:trace', { route: payload.route, ...entry });
      if (action === 'settings') {
        const { llmApiKey, ...settings } = payload;
        return { ok: true, data: { settings: { ...settings, hasApiKey: Boolean(llmApiKey) }, auth: { api: {}, mcp: {} }, closed: [] } };
      }
      if (action === 'findCli') return { ok: true, data: true };
      if (action === 'run' && payload.action === 'connect') return { ok: true, data: { description: '6 Work IQ tools for Deep Agents · gpt-5.1', tools: [] } };
      if (action === 'run' && payload.action === 'send') {
        for (const step of steps) { await gate(); trace(step); }
        await gate();
        return { ok: true, data: { text: answer, tools: ['fetch', 'ask'], author: 'Deep Agents · gpt-5.1', conversationId: '4f7c2d9e-8b1a-4e6f-a3c5-9d2e7b0f1a64', elapsedMs: 7460 } };
      }
      return { ok: true, data: {} };
    });
    return steps.length + 1;
  });

  // Connected before the tour starts, off camera.
  await page.locator('#connect').click();
  await page.locator('#llm-endpoint').fill('https://my-resource.openai.azure.com');
  await page.locator('#llm-deployment').fill('gpt-5.1');
  await page.locator('#connect-start').click();
  await page.locator('#connect-done').click();

  // One caption band per scene, in the app's own fonts; each GIF frame is its band above the camera's view.
  const bandCss = bandHeight * width / gifWidth;
  const bands = [];
  for (const [step, caption] of captions.entries()) {
    await page.evaluate(([caption, step, total, bandCss]) => {
      const band = document.createElement('div');
      band.dataset.demoBand = '';
      Object.assign(band.style, { position: 'fixed', inset: '0 0 auto 0', height: `${bandCss}px`, zIndex: '2147483647', display: 'flex',
        alignItems: 'center', gap: '18px', padding: '0 26px', background: '#242424', color: '#ffffff' });
      const dots = document.createElement('span');
      Object.assign(dots.style, { display: 'flex', gap: '7px' });
      for (let index = 0; index < total; index++) {
        const dot = document.createElement('span');
        Object.assign(dot.style, { width: '9px', height: '9px', borderRadius: '50%', background: index === step ? '#fd8ea1' : '#5f5f5f' });
        dots.append(dot);
      }
      const text = document.createElement('span');
      Object.assign(text.style, { fontSize: '20px', fontWeight: '600' });
      text.textContent = caption;
      const note = document.createElement('span');
      Object.assign(note.style, { marginLeft: 'auto', fontSize: '14px', color: '#b0b0b0' });
      note.textContent = 'Example data';
      band.append(dots, text, note);
      document.body.append(band);
    }, [caption, step, captions.length, bandCss]);
    const file = join(work, `band-${step + 1}.png`);
    await page.screenshot({ path: file, clip: { x: 0, y: 0, width, height: bandCss } });
    await page.evaluate(() => document.querySelector('[data-demo-band]').remove());
    bands.push(file);
  }

  const frames = [];
  let band = bands[0];
  let shot;
  const clamp = (value, low, high) => Math.min(Math.max(value, low), high);
  const ease = t => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);
  // The camera: the part of the window a frame shows, in CSS pixels, always with the window's aspect ratio.
  const view = (x, y, zoom) => {
    const w = width / zoom, h = height / zoom;
    return { x: clamp(x - w / 2, 0, width - w), y: clamp(y - h / 2, 0, height - h), w, h };
  };
  const whole = view(width / 2, height / 2, 1);
  let camera = whole;
  // A frame of the current picture, shown for ms milliseconds; an unchanged one only lengthens the frame before it.
  const record = ms => {
    const last = frames.at(-1);
    if (last?.file === shot.file && last.band === band && last.camera === camera) { last.ms += ms; return; }
    frames.push({ file: shot.file, band, camera, ms });
  };
  const capture = async ms => {
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const image = await page.screenshot({ animations: 'disabled', caret: 'hide' });
    if (!shot?.image.equals(image)) {
      const file = join(work, `shot-${String(frames.length + 1).padStart(4, '0')}.png`);
      await writeFile(file, image);
      shot = { file, image };
    }
    record(ms);
  };
  // Moves the camera, eased, over the current picture.
  const zoom = async (to, steps = 5) => {
    const from = camera;
    for (let step = 1; step <= steps; step++) {
      const t = ease(step / steps);
      camera = Object.fromEntries(['x', 'y', 'w', 'h'].map(key => [key, from[key] + (to[key] - from[key]) * t]));
      record(40);
    }
  };
  // The camera on an element, with room around it, zoomed in at most max times.
  const onto = async (selector, { padding = 24, max = 1.6 } = {}) => {
    const box = await page.locator(selector).first().boundingBox();
    const factor = clamp(Math.min(width / (box.width + 2 * padding), height / (box.height + 2 * padding)), 1, max);
    return view(box.x + box.width / 2, box.y + box.height / 2, factor);
  };
  // Scrolls a pane, eased, to the top computed in the page for it.
  const scroll = async (pane, top, steps = 6) => {
    const from = await page.evaluate(pane => document.querySelector(pane).scrollTop, pane);
    const to = await page.evaluate(top, pane);
    for (let step = 1; step <= steps; step++) {
      await page.evaluate(([pane, top]) => { document.querySelector(pane).scrollTop = top; }, [pane, from + (to - from) * ease(step / steps)]);
      await capture(40);
    }
  };
  // The pointer and its click ring, drawn into the page like the How to marks; in an open dialog, so they stay on top.
  let cursor = { x: 760, y: 470 };
  const draw = (ring = 0) => page.evaluate(([x, y, ring]) => {
    let pointer = document.querySelector('[data-demo-cursor]');
    if (!pointer) {
      pointer = document.createElement('div');
      pointer.dataset.demoCursor = '';
      pointer.innerHTML = '<span></span><svg viewBox="0 0 24 24" width="26" height="26"><path d="M5 3v16.5l4.4-4.2 2.8 6.3 3-1.3-2.8-6.2H18.5z" fill="#fff" stroke="#1f1f1f" stroke-width="1.4" stroke-linejoin="round"/></svg>';
      Object.assign(pointer.style, { position: 'fixed', left: '0', top: '0', width: '26px', height: '26px', pointerEvents: 'none', zIndex: '2147483647' });
      Object.assign(pointer.querySelector('svg').style, { display: 'block', filter: 'drop-shadow(0 1px 2px rgba(0, 0, 0, 0.35))' });
      Object.assign(pointer.firstElementChild.style, { position: 'absolute', left: '5.4px', top: '3.25px', transform: 'translate(-50%, -50%)', borderRadius: '50%', border: '2px solid #b11f4b' });
    }
    (document.querySelector('dialog[open]') ?? document.body).append(pointer);
    // The arrow's tip, at 5, 3 of 24, on the point.
    pointer.style.transform = `translate(${x - 5.4}px, ${y - 3.25}px)`;
    Object.assign(pointer.firstElementChild.style, { display: ring ? 'block' : 'none', width: `${ring * 16}px`, height: `${ring * 16}px`, opacity: ring === 1 ? '0.8' : '0.35' });
  }, [cursor.x, cursor.y, ring]);
  // Moves the pointer to an element's center, or to a point.
  const moveTo = async (target, steps = 7) => {
    const box = typeof target === 'string' ? await page.locator(target).first().boundingBox() : { ...target, width: 0, height: 0 };
    const from = cursor, to = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    for (let step = 1; step <= steps; step++) {
      cursor = { x: from.x + (to.x - from.x) * ease(step / steps), y: from.y + (to.y - from.y) * ease(step / steps) };
      await draw();
      await capture(40);
    }
  };
  const click = async selector => {
    await moveTo(selector);
    await draw(1);
    await capture(80);
    await page.locator(selector).first().click();
    await draw(2);
    await capture(80);
    await draw();
  };
  const advance = async () => {
    const until = Date.now() + 10_000;
    while (!(await app.evaluate(() => globalThis.demoAdvance()))) {
      if (Date.now() > until) throw new Error('The example answer stopped waiting for its next step.');
      await page.waitForTimeout(10);
    }
    await page.waitForTimeout(60);
  };

  // 1. A question about the next meeting, answered from Microsoft 365 data as it streams in; then its meeting.
  await draw();
  await capture(1100);
  await zoom(await onto('.conversation'), 6);
  await click('.suggestions button');
  await capture(600);
  await click('#send');
  const pauses = [380, 220, 420, 360, 220, 520];
  for (let step = 0; step < answerSteps - 1; step++) {
    await advance();
    await capture(pauses[step] ?? 90);
  }
  await advance();
  await page.locator('#messages .message.assistant').waitFor();
  await capture(200);
  await scroll('#chat-scroll', pane => {
    const chat = document.querySelector(pane), answer = document.querySelector('#messages .message.assistant');
    return chat.scrollTop + answer.getBoundingClientRect().top - chat.getBoundingClientRect().top - 8;
  });
  await capture(1300);
  await click('#messages .message.assistant .entity');
  // Out of the way of the meeting details, at the chat's right edge.
  const chat = await page.locator('.conversation').boundingBox();
  await moveTo({ x: chat.x + chat.width - 34, y: cursor.y + 24 }, 5);
  await scroll('#chat-scroll', pane => {
    const chat = document.querySelector(pane), panel = document.querySelector('#messages .message.assistant .entity-list');
    return chat.scrollTop + Math.max(0, panel.getBoundingClientRect().bottom + 12 - chat.getBoundingClientRect().bottom);
  }, 5);
  await capture(1400);

  // 2. Each step between you, the model and Work IQ, with its cost; then the raw payload of one.
  band = bands[1];
  await zoom(await onto('#integration-inspector'));
  await click('#inspect-wire');
  await capture(1300);
  await scroll('#trace', pane => {
    const trace = document.querySelector(pane), step = document.querySelector('.flow-step.workiq');
    return trace.scrollTop + step.getBoundingClientRect().top - trace.getBoundingClientRect().top - 8;
  });
  await click('.flow-step.workiq details > summary');
  await capture(1600);

  // 3. The source the route runs, scrolled to the harness.
  band = bands[2];
  await click('#inspect-source');
  await capture(500);
  await scroll('#source-code', pane => {
    const code = document.querySelector(pane);
    const line = [...code.querySelectorAll('.line')].find(element => element.textContent.startsWith('export async function harness'));
    const { top, height } = line.getBoundingClientRect();
    return code.scrollTop + top - code.getBoundingClientRect().top - 2 * height;
  }, 6);
  await capture(1300);

  // 4. The same app, three routes.
  band = bands[3];
  await zoom(whole);
  await click('#tab-a2a');
  await capture(1100);
  await click('#tab-rest');
  await capture(1100);

  // 5. What each route can read, create, update and delete.
  band = bands[4];
  await click('.learn-more [data-open="capabilities-dialog"]');
  await capture(300);
  await zoom(await onto('#capabilities-dialog', { padding: 12, max: 1.5 }));
  await capture(1700);
  await page.keyboard.press('Escape');

  // 6. The invitation, a cut from the chapter; built with CSSOM styles: the app's content security policy blocks inline style attributes.
  band = bands[5];
  camera = whole;
  await page.evaluate(() => {
    document.querySelector('[data-demo-cursor]')?.remove();
    const element = (tag, text, style = {}, className = '') => {
      const node = document.createElement(tag);
      node.textContent = text;
      node.className = className;
      Object.assign(node.style, style);
      return node;
    };
    const overlay = element('div', '', { position: 'fixed', inset: '0', zIndex: '2147483647', display: 'grid', placeItems: 'center', background: 'rgba(247, 244, 239, 0.94)' });
    const card = element('div', '', { background: '#ffffff', border: '1px solid #dedede', borderRadius: '16px', boxShadow: '0 18px 50px rgba(0, 0, 0, 0.14)',
      padding: '34px 44px', textAlign: 'center', maxWidth: '580px' });
    card.dataset.demoCard = '';
    const brand = element('div', '', { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' });
    brand.append(element('span', 'W', {}, 'brand-mark'), element('strong', 'Work IQ integration lab', { fontSize: '17px' }));
    const download = element('button', 'Download for Windows, macOS or Linux', { fontSize: '15px', padding: '10px 20px' }, 'primary');
    download.type = 'button';
    card.append(brand,
      element('h2', 'Build Work IQ into your own tools', { margin: '20px 0 8px', fontSize: '28px', lineHeight: '1.2' }),
      element('p', 'MCP, A2A and REST, each a live chat with its code and every call beside it.', { margin: '0 0 24px', color: '#5c5c5c', fontSize: '15px', lineHeight: '1.45' }),
      download,
      element('p', 'or run it from source with Node.js', { margin: '12px 0 0', color: '#6f6f6f', fontSize: '13px' }));
    overlay.append(card);
    document.body.append(overlay);
  });
  await capture(300);
  await zoom(await onto('[data-demo-card]', { padding: 90, max: 1.25 }), 6);
  await capture(2600);

  // Each frame: its band above the camera's view, scaled down; then one palette for the whole GIF.
  const run = promisify(execFile);
  const files = [];
  let next = 0;
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (next < frames.length) {
      const index = next++;
      const { file, band, camera } = frames[index];
      const w = Math.round(camera.w * scale), h = Math.round(camera.h * scale);
      const x = Math.min(Math.round(camera.x * scale), width * scale - w), y = Math.min(Math.round(camera.y * scale), height * scale - h);
      files[index] = join(work, `frame-${String(index + 1).padStart(4, '0')}.png`);
      await run('ffmpeg', ['-v', 'error', '-y', '-i', band, '-i', file, '-filter_complex',
        `[0:v]scale=${gifWidth}:${bandHeight}:flags=lanczos[band];[1:v]crop=${w}:${h}:${x}:${y},scale=${gifWidth}:${gifHeight}:flags=lanczos[view];[band][view]vstack=inputs=2`,
        files[index]]);
    }
  }));
  // The concat demuxer takes the last duration only when the last file is listed once more.
  const list = join(work, 'frames.txt');
  await writeFile(list, [...frames.flatMap((frame, index) => [`file '${files[index]}'`, `duration ${(frame.ms / 1000).toFixed(3)}`]), `file '${files.at(-1)}'`, ''].join('\n'));
  await mkdir(dirname(output), { recursive: true });
  // No dithering: the UI's flat colors map to the palette exactly, and dither noise makes every zoom frame larger.
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-filter_complex',
    'split[a][b];[a]palettegen=max_colors=256:stats_mode=full[p];[b][p]paletteuse=dither=none:diff_mode=rectangle',
    '-fps_mode', 'vfr', '-loop', '0', output], { stdio: 'inherit' });
  const seconds = frames.reduce((sum, frame) => sum + frame.ms, 0) / 1000;
  console.log(`docs/public/demo.gif: ${frames.length} frames, ${seconds.toFixed(1)} s, ${((await stat(output)).size / 1e6).toFixed(1)} MB`);
} finally {
  await app.close();
  await rm(work, { recursive: true, force: true });
}
