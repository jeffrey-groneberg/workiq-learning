import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron } from 'playwright';

test('desktop UI: real source, protocol switching, error states, chat lifecycle and isolation', async t => {
  const profile = await mkdtemp(join(tmpdir(), 'workiq-showcase-ui-'));
  const screenshots = resolve(process.env.WORKIQ_SCREENSHOTS_DIR || 'test-results');
  await mkdir(screenshots, { recursive: true });
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  let desktop;
  t.after(async () => { await desktop?.close(); await rm(profile, { recursive: true, force: true }); });
  const executablePath = process.env.WORKIQ_EXECUTABLE;
  desktop = await electron.launch({
    executablePath, args: [...(executablePath ? [] : ['.']), `--user-data-dir=${profile}`],
    env, timeout: 30_000,
  });
  const page = await desktop.firstWindow();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForSelector('#source-code span');
  // Scrolled to the bottom, a dialog keeps its title and Close at the top, uncovered and clickable.
  const assertCloseOnTop = async (dialog, name) => {
    const scrolled = await dialog.evaluate(element => { element.scrollTop = element.scrollHeight; return element.scrollTop > 0; });
    assert.ok(scrolled, `${name} should be long enough to scroll in this test`);
    await page.waitForFunction(element => element.classList.contains('scrolled'), await dialog.elementHandle());
    const close = await dialog.evaluate(element => {
      const button = element.querySelector('.dialog-heading button');
      const box = button.getBoundingClientRect();
      const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      return { offset: Math.round(box.top - element.getBoundingClientRect().top), uncovered: hit === button || button.contains(hit) };
    });
    assert.ok(close.offset >= 0 && close.offset < 40 && close.uncovered, `${name}: Close must stay on top (${JSON.stringify(close)})`);
  };
  assert.match(await page.title(), /Work IQ/);
  assert.ok(await page.locator('#send').isDisabled());
  assert.match(await page.locator('#source-code').textContent(), /createDeepAgent/);
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
  assert.equal(await page.evaluate(() => typeof window.process), 'undefined');
  await page.screenshot({ path: join(screenshots, 'workiq-desktop.png'), animations: 'disabled' });
  await page.getByRole('button', { name: 'Expand', exact: true }).click();
  assert.ok(await page.locator('.conversation').isHidden());
  assert.ok((await page.locator('#source-code').boundingBox()).width > 1000);
  await page.getByRole('button', { name: 'Split view', exact: true }).click();

  await page.getByRole('tab', { name: 'A2A', exact: true }).click();
  assert.match(await page.locator('#source-code').textContent(), /SendMessage/);
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  assert.ok(await page.locator('#settings-dialog').isVisible());
  assert.match(await page.locator('#settings-feedback').textContent(), /approved app registration/);
  await page.screenshot({ path: join(screenshots, 'workiq-settings.png'), animations: 'disabled' });
  await assertCloseOnTop(page.locator('#settings-dialog'), 'Connections');
  await page.locator('#client-id').fill('not-a-guid');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await page.waitForFunction(() => document.querySelector('#settings-feedback').textContent.includes('Entra GUID'));
  await page.locator('#client-id').fill('');
  await page.locator('#llm-endpoint').fill('https://example.com');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await page.waitForFunction(() => document.querySelector('#settings-feedback').textContent.includes('Azure OpenAI resource URL'));
  await page.locator('#llm-endpoint').fill('https://test-resource.openai.azure.com/');
  await page.locator('#llm-deployment').fill('gpt-test');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await page.waitForFunction(() => document.querySelector('#settings-feedback').textContent.includes('Settings saved'));
  await page.locator('#settings-close').click();
  const capabilities = page.locator('#capabilities-dialog');
  await page.getByRole('tab', { name: 'How it works' }).click();
  await page.getByRole('button', { name: 'Compare what MCP, A2A and REST can do' }).click();
  await capabilities.waitFor({ state: 'visible' });
  const cells = await capabilities.locator('tbody tr').evaluateAll(rows => rows.map(row => [...row.cells].map(cell => cell.textContent)));
  assert.deepEqual(cells.map(row => row[0]), ['Read: answers in natural language', 'Read: structured data by path', 'Download a file', 'Create', 'Update', 'Delete', 'Microsoft 365 actions, such as sending mail', 'Who allows changes']);
  for (const [row, tool] of [[3, 'create_entity'], [4, 'update_entity'], [5, 'delete_entity'], [6, 'do_action']]) {
    assert.equal(cells[row][1], `Off by default: ${tool} requests; tenant admins can enable supported mutation scenarios in MCP policy`);
    assert.deepEqual(cells[row].slice(2), ['Further research needed', 'Further research needed']);
  }
  assert.ok(cells[1].slice(2).every(cell => cell.startsWith('Further research needed: no path-based read is documented')));
  assert.match(cells[7][1], /^Documented layers: Entra sign-in, OAuth permissions.*Further research needed: the policy setting in a given tenant, and which OAuth permissions MCP uses\.$/);
  assert.equal(await capabilities.locator('h3 + ul > li').count(), 4);
  const capabilityText = await capabilities.textContent();
  for (const phrase of ["not the current setting of any tenant", "which doesn't prove it's unavailable", "This proves only that the request wasn't blocked before Graph checked it", "the endpoint's OAuth metadata advertises", "Whether an ask request can change data is further research needed"]) {
    assert.ok(capabilityText.includes(phrase), phrase);
  }
  await page.screenshot({ path: join(screenshots, 'workiq-capabilities.png'), animations: 'disabled' });
  await assertCloseOnTop(capabilities, 'Capabilities');
  await capabilities.getByRole('button', { name: 'Close capabilities' }).click();
  assert.ok(await capabilities.isHidden());
  await page.locator('.privacy-note [data-open="capabilities-dialog"]').click();
  await capabilities.waitFor({ state: 'visible' });
  await page.keyboard.press('Escape');
  const authentication = page.locator('#auth-dialog');
  await page.getByRole('button', { name: 'See what all four routes need to sign in' }).click();
  await authentication.waitFor({ state: 'visible' });
  await page.keyboard.press('Escape');
  await page.locator('.header-actions [data-open="auth-dialog"]').click();
  await authentication.waitFor({ state: 'visible' });
  assert.deepEqual(await authentication.locator('.auth-route h3').allTextContents(), ['MCP, local', 'MCP, remote', 'A2A', 'REST API', 'Your own desktop tool with its own harness: recommended setup']);
  assert.deepEqual(await authentication.locator('.auth-flow').evaluateAll(flows => flows.map(flow => flow.children.length)), [4, 4, 4, 4, 4]);
  assert.equal(await authentication.locator('.auth-admin').count(), 5);
  const authText = await authentication.textContent();
  for (const fact of ['az ad sp create --id fdcc1f02-fc51-4226-8753-f668596af7f7', 'ba081686-5d24-4bc6-a0d6-d034ecffed87', 'redirectPort: 12798', 'redirect http://localhost', 'allow 15 to 30 minutes', 'On-Behalf-Of', 'Application-only access isn\'t supported', 'For the published MCP client in a new tenant: further research needed', 'scope api://workiq.svc.cloud.microsoft/WorkIQAgent.Ask', 'register the app as multitenant', 'Not yet tested in this app with a custom registration']) {
    assert.ok(authText.includes(fact), fact);
  }
  await page.screenshot({ path: join(screenshots, 'workiq-authentication.png'), animations: 'disabled' });
  await assertCloseOnTop(authentication, 'Authentication');
  await page.screenshot({ path: join(screenshots, 'workiq-authentication-bottom.png'), animations: 'disabled' });
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: 'REST API', exact: true }).click();
  assert.match(await page.locator('#source-code').textContent(), /locationHint/);
  await page.getByRole('tab', { name: 'How it works' }).click();
  assert.match(await page.locator('#guide-summary').textContent(), /conversation ID/);
  assert.match(await page.locator('#guide-cost').textContent(), /Creating a conversation is not documented as billable/);
  assert.ok(await page.locator('#tool-guide').isHidden());
  await page.getByRole('tab', { name: 'MCP server', exact: true }).click();
  await page.getByRole('button', { name: 'Remote', exact: true }).click();
  assert.match(await page.locator('#guide-auth').textContent(), /public client/);
  assert.ok(await page.locator('#tool-guide').isVisible());
  assert.equal(await page.locator('#tool-guide dt code').count(), 14);
  assert.deepEqual(await page.locator('#tool-guide .tool-tag.cost').evaluateAll(tags => [...new Set(tags.map(tag => tag.textContent))]), ['App reading: Chat, variable credits', 'App reading: Tools API, 0.1 credit per call', 'Meter not documented']);
  assert.equal(await page.locator('#tool-guide .tool-tag.cost', { hasText: 'App reading: Tools API' }).count(), 9);
  assert.equal(await page.locator('#tool-guide dt', { hasText: 'fetch_blob' }).locator('.tool-tag.cost').textContent(), 'Meter not documented');
  const costGuide = await page.locator('#tool-guide').textContent();
  for (const phrase of ['Microsoft publishes no per-tool meter table', 'Microsoft does not document whether 0.1 also applies', 'is not a bill', 'Microsoft does not document whether they are billed', 'can include non-billable usage']) {
    assert.ok(costGuide.includes(phrase), phrase);
  }
  await page.locator('#tool-guide h4', { hasText: 'What a call costs' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(screenshots, 'workiq-costs.png'), animations: 'disabled' });
  // Work IQ vs. Graph: both entry points, the measured facts, the illustration and "Try it".
  const why = page.locator('#why-dialog');
  await page.locator('#tool-guide [data-open="why-dialog"]').click();
  await why.waitFor({ state: 'visible' });
  await page.keyboard.press('Escape');
  assert.ok(await why.isHidden());
  await page.locator('.header-actions [data-open="why-dialog"]').click();
  await why.waitFor({ state: 'visible' });
  assert.equal(await page.locator('#why-title').textContent(), 'Why not call Microsoft Graph directly?');
  await page.waitForFunction(() => document.querySelector('#why-dialog img').complete && document.querySelector('#why-dialog img').naturalWidth === 1344);
  const whyText = await why.textContent();
  for (const fact of ['17,870 operations on 11,546 paths', '9.72 million', '1,209 for the 6 tool definitions', '4,402 for all 14', 'at most 128 functions per request', 'returns 21 paths', 'commit 4963f95', 'AI-generated illustration (MAI-Image-2.6)']) {
    assert.ok(whyText.includes(fact), fact);
  }
  assert.ok(await why.locator('pre .hljs-keyword').count() > 3);
  await page.screenshot({ path: join(screenshots, 'workiq-why.png'), animations: 'disabled' });
  await assertCloseOnTop(why, 'Work IQ vs. Graph');
  await page.screenshot({ path: join(screenshots, 'workiq-why-bottom.png'), animations: 'disabled' });
  await page.getByRole('button', { name: 'Try it in the MCP tab' }).click();
  assert.ok(await why.isHidden());
  assert.equal(await page.locator('#tab-mcp').getAttribute('aria-selected'), 'true');
  assert.match(await page.locator('#question').inputValue(), /^Which Planner tasks are assigned to me/);
  await page.locator('#question').fill('');
  await page.getByRole('button', { name: 'Local', exact: true }).click();
  await page.getByRole('tab', { name: 'Code', exact: true }).click();

  for (const width of [760, 1024]) {
    await page.setViewportSize({ width, height: 860 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, `No sideways scroll at ${width} px`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
  await page.screenshot({ path: join(screenshots, 'workiq-narrow.png'), fullPage: true, animations: 'disabled' });
  // Narrow screens hide the header's dialog buttons; How it works still opens both dialogs.
  assert.ok(await page.locator('.header-actions [data-open]').first().isHidden());
  await page.getByRole('tab', { name: 'How it works' }).click();
  await page.locator('#tool-guide [data-open="why-dialog"]').click();
  await why.waitFor({ state: 'visible' });
  assert.ok(await why.evaluate(dialog => dialog.scrollWidth <= dialog.clientWidth), 'The comparison dialog must not scroll sideways at 390 px');
  await page.screenshot({ path: join(screenshots, 'workiq-why-narrow.png'), animations: 'disabled' });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Compare what MCP, A2A and REST can do' }).click();
  await capabilities.waitFor({ state: 'visible' });
  assert.ok(await capabilities.evaluate(dialog => dialog.scrollWidth <= dialog.clientWidth), 'Only the matrix may scroll sideways at 390 px');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'See what all four routes need to sign in' }).click();
  await authentication.waitFor({ state: 'visible' });
  assert.ok(await authentication.evaluate(dialog => dialog.scrollWidth <= dialog.clientWidth), 'The authentication dialog must not scroll sideways at 390 px');
  assert.equal(await authentication.locator('.auth-flow').first().evaluate(flow => getComputedStyle(flow).gridTemplateColumns.split(' ').length), 1);
  await page.screenshot({ path: join(screenshots, 'workiq-authentication-narrow.png'), animations: 'disabled' });
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: 'Code', exact: true }).click();
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await page.screenshot({ path: join(screenshots, 'workiq-dark.png'), animations: 'disabled' });
  const contrast = await page.evaluate(() => {
    const luminance = color => {
      const values = color.match(/[\d.]+/g).slice(0, 3).map(Number).map(value => {
        const channel = value / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      });
      return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
    };
    const ratio = (text, background) => {
      const a = luminance(text), b = luminance(background);
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    };
    const style = selector => getComputedStyle(document.querySelector(selector));
    return {
      description: ratio(style('#route-description').color, style('body').backgroundColor),
      metadata: ratio(style('#line-count').color, style('.inspector').backgroundColor),
    };
  });
  assert.ok(contrast.description >= 4.5, `Dark description contrast: ${contrast.description}`);
  assert.ok(contrast.metadata >= 4.5, `Dark metadata contrast: ${contrast.metadata}`);
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));

  // The production app has no demo mode. Test doubles exist only in this test process.
  await desktop.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('workiq');
    let fail = true;
    ipcMain.handle('workiq', async (event, action, payload) => {
      if (action === 'run' && payload.action === 'connect') {
        if (fail) { fail = false; return { ok: false, error: 'Test fixture: consent is missing.' }; }
        const trace = entry => event.sender.send('workiq:trace', { route: payload.route, ...entry });
        trace({ direction: 'stage', body: { title: 'Start the Work IQ CLI', detail: 'Test fixture stage.' } });
        trace({ direction: 'request', body: { jsonrpc: '2.0', id: 0, method: 'initialize', params: {} } });
        await new Promise(resolve => setTimeout(resolve, 1000));
        trace({ direction: 'response', ms: 1000, body: { jsonrpc: '2.0', id: 0, result: { protocolVersion: '2025-06-18', serverInfo: { name: 'test-server', version: '1.0' } } } });
        trace({ direction: 'request', body: { jsonrpc: '2.0', method: 'notifications/initialized' } });
        trace({ direction: 'request', body: { jsonrpc: '2.0', id: 1, method: 'tools/list' } });
        trace({ direction: 'response', ms: 50, body: { jsonrpc: '2.0', id: 1, result: { tools: [{ name: 'ask' }, { name: 'fetch' }] } } });
        trace({ direction: 'stage', body: { title: 'Build the Deep Agents harness', detail: 'The model gets 2 of 2 Work IQ tools: ask, fetch.' } });
        return { ok: true, data: { description: 'Test fixture server', tools: [] } };
      }
      if (action === 'run' && payload.action === 'send') {
        const trace = entry => event.sender.send('workiq:trace', { route: payload.route, ...entry });
        trace({ direction: 'model', ms: 900, usage: { input: 1200, output: 40, reasoning: 25 }, body: { step: 'model_request', reasoning: 'Test fixture reasoning.', tool_calls: [{ name: 'call_function', args: {} }, { name: 'get_schema', args: {} }, { name: 'ask', args: {} }] } });
        trace({ direction: 'request', body: { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'call_function', arguments: { functionUrl: '/me/calendarView?startDateTime=2026-01-01&endDateTime=2026-01-02' } } } });
        trace({ direction: 'request', body: { jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'get_schema', arguments: { path: '/me/events' } } } });
        trace({ direction: 'request', body: { jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'ask', arguments: { question: 'Test question' } } } });
        await new Promise(resolve => setTimeout(resolve, 1500));
        trace({ direction: 'response', ms: 600, body: { jsonrpc: '2.0', id: 7, result: { content: [], structuredContent: { statusCode: 200, data: {
          '@odata.context': "https://graph.microsoft.com/v1.0/$metadata#users('test')/calendarView(subject)",
          value: [
            { id: 'test-a', subject: 'Test meeting A', start: { dateTime: '2026-09-23T07:00:00.0000000', timeZone: 'UTC' }, end: { dateTime: '2026-09-23T07:30:00.0000000', timeZone: 'UTC' },
              organizer: { emailAddress: { name: 'Test Organizer' } }, location: { displayName: 'Test room' }, webLink: 'https://outlook.office365.com/owa/?itemid=test-a&path=/calendar/item' },
            { id: 'test-b', subject: 'Test meeting B' },
          ],
        } } } } });
        trace({ direction: 'response', ms: 100, body: { jsonrpc: '2.0', id: 9, result: { isError: true, content: [{ type: 'text', text: "Provide 'operationType'." }] } } });
        trace({ direction: 'response', ms: 400, body: { jsonrpc: '2.0', id: 8, result: { content: [{ type: 'text', text: 'Organized by <Person>Test Person</Person>: [Test standup](https://teams.microsoft.com/l/meeting/details?eventId=test)' }] } } });
        trace({ direction: 'model', ms: 700, usage: { input: 1500, output: 120, reasoning: 0 }, body: { step: 'model_request', answer: 'Test fixture answer.' } });
        return {
          ok: true, data: {
            text: 'Test fixture: **formatted reply**. <div id="question">Safe text</div><img src="https://example.com/tracker" onerror="window.bad=true"><script>window.bad=true</script>',
            conversationId: 'test-context', elapsedMs: 2300, sensitivity: 'Test label',
            tools: ['call_function', 'get_schema', 'ask'], author: 'Deep Agents · gpt-test',
            citations: [{ providerDisplayName: 'Test source', seeMoreWebUrl: 'https://example.com/source' }],
          },
        };
      }
      return { ok: true, data: {} };
    });
  });
  const connectDialog = page.locator('#connect-dialog');
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#chat-error').textContent.includes('consent is missing'));
  assert.ok(await connectDialog.isVisible());
  assert.equal(await page.locator('#connect-title').textContent(), 'Connection failed');
  assert.match(await page.locator('#connect-summary').textContent(), /consent is missing/);
  assert.ok(await page.locator('#connect-done').isHidden());
  await page.locator('#connect-close').click();
  assert.ok(await connectDialog.isHidden());
  assert.ok(await page.locator('#send').isDisabled());
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#connect-steps .flow-step.pending')?.textContent.includes('MCP handshake with Work IQ'));
  assert.equal(await page.locator('#connect-title').textContent(), 'Connecting to Work IQ · local MCP');
  assert.ok(await page.locator('#connect-elapsed').isVisible());
  await page.screenshot({ path: join(screenshots, 'workiq-connecting.png'), animations: 'disabled' });
  await page.waitForFunction(() => document.querySelector('#connect-title').textContent === 'Connected' && document.querySelectorAll('#connect-steps .flow-note').length === 5);
  assert.match(await page.locator('#connect-summary').textContent(), /^Connected in \d+\.\d s · Test fixture server$/);
  assert.equal(await page.locator('#connect-steps .flow-step.pending').count(), 0);
  assert.equal(await page.locator('#connect-steps .flow-step.app').count(), 2);
  assert.deepEqual(await page.locator('#connect-steps .flow-step.workiq .flow-detail').allTextContents(), Array(3).fill('Copilot Credits: not documented as billable'));
  assert.deepEqual(await page.locator('#connect-steps .flow-note').allTextContents(), [
    'Test fixture stage.', 'test-server 1.0 · MCP protocol 2025-06-18', 'Confirms the handshake; no response expected.',
    '2 tools: ask, fetch', 'The model gets 2 of 2 Work IQ tools: ask, fetch.',
  ]);
  assert.ok(await page.locator('#connect-elapsed').isHidden());
  await page.screenshot({ path: join(screenshots, 'workiq-connected.png'), animations: 'disabled' });
  await page.getByRole('button', { name: 'Start chatting' }).click();
  assert.ok(await connectDialog.isHidden());
  assert.equal(await page.evaluate(() => document.activeElement.id), 'question');
  await page.waitForFunction(() => document.querySelector('#connection-status').textContent === 'Connected');
  await page.locator('[data-prompt]').first().click();
  assert.equal(await page.locator('#messages .message').count(), 0);
  assert.ok((await page.locator('#question').inputValue()).length > 20);
  await page.getByRole('button', { name: 'Send', exact: false }).click();
  await page.waitForSelector('#pending .message.pending .spinner');
  await page.waitForFunction(() => document.querySelector('#pending').textContent.includes('Waiting for Work IQ: ask'));
  assert.match(await page.locator('#pending .reasoning-text').textContent(), /Test fixture reasoning/);
  await page.getByRole('tab', { name: /Flow/ }).click();
  assert.equal(await page.locator('.flow-step.pending').count(), 1);
  await page.screenshot({ path: join(screenshots, 'workiq-live.png'), animations: 'disabled' });
  await page.waitForSelector('#messages .message.assistant');
  assert.equal(await page.locator('#pending .message').count(), 0);
  await page.waitForFunction(() => document.querySelector('.message-metrics')?.textContent.includes('2 steps'));
  assert.equal(await page.locator('.flow-step.you').count(), 1);
  assert.equal(await page.locator('.flow-step.model').count(), 2);
  assert.equal(await page.locator('.flow-step.workiq').count(), 3);
  assert.deepEqual(await page.locator('.flow-step.workiq .flow-meta').allTextContents(), ['0.6 s · result', '0.1 s · error', '0.4 s · result']);
  assert.deepEqual(await page.locator('.flow-step.workiq .flow-detail').allTextContents(), [
    'Copilot Credits, app estimate: 0.1 (Tools API meter)',
    'Copilot Credits, app estimate: 0.1 (Tools API meter); billing of failed calls not documented',
    'Copilot Credits, app estimate: variable (Chat meter; background reasoning in Work IQ)',
  ]);
  assert.equal(await page.locator('.flow-step.model .flow-detail').first().textContent(), '1,200 in · 40 out · 25 reasoning tokens');
  assert.equal(await page.locator('.flow-step.workiq').first().locator('.entity', { hasText: '2 meetings' }).count(), 1);
  await page.locator('.flow-step.workiq summary').first().click();
  await page.waitForSelector('.flow-step.workiq pre .hljs-attr');
  assert.doesNotMatch(await page.locator('.flow-step.workiq pre').first().textContent(), /"seq"/);
  const metrics = await page.locator('.message-metrics').textContent();
  assert.match(metrics, /Total 2\.3 s · Work IQ latency 1\.1 s \(3 calls\) · Model latency 1\.6 s \(2 steps\) · Azure OpenAI: 2,860 tokens \(2,700 in, 160 out incl\. 25 reasoning\)/);
  assert.equal(await page.locator('.message-credits').textContent(), 'Copilot Credits, app estimate (not a bill): 2 Tools API calls × 0.1 = 0.2 ($0.002 at the pay-as-you-go list price) · 1 ask call: variable (background reasoning in Work IQ), not calculated · incl. 1 failed call; Microsoft does not document whether failed calls are billed');
  const read = page.locator('.message.assistant .entity-group', { hasText: 'Read' });
  const cited = page.locator('.message.assistant .entity-group', { hasText: 'Cited' });
  assert.deepEqual(await read.locator('.entity').allTextContents(), ['2 meetings']);
  assert.deepEqual((await cited.locator('.entity').allTextContents()).sort(), ['1 meeting', '1 person']);
  assert.equal(await page.locator('.message.assistant .entity svg').count(), 3);
  const details = page.locator('.message.assistant .entity-list');
  assert.ok(await details.isHidden());
  await read.locator('.entity').click();
  assert.equal(await read.locator('.entity').getAttribute('aria-expanded'), 'true');
  assert.deepEqual(await details.locator('li strong').allTextContents(), ['Test meeting A', 'Test meeting B']);
  assert.match(await details.locator('li').first().textContent(), /Organizer: Test Organizer · Test room/);
  assert.equal(await details.locator('li a').first().getAttribute('href'), 'https://outlook.office365.com/owa/?itemid=test-a&path=/calendar/item');
  const payloadDialog = page.locator('#payload-dialog');
  const marked = async () => (await page.locator('#payload-response mark').allTextContents()).join('');
  await details.locator('li').first().getByRole('button', { name: 'Show in payload' }).click();
  await payloadDialog.waitFor({ state: 'visible' });
  assert.equal(await page.locator('#payload-summary').textContent(), 'Returned by call_function /me/calendarView?startDateTime=2026-01-01&endDateTime=2026-01-02 · 0.6 s');
  assert.equal(await page.locator('#payload-call-title').textContent(), 'Tool call');
  assert.match(await page.locator('#payload-request').textContent(), /"functionUrl": "\/me\/calendarView\?startDateTime=2026-01-01/);
  assert.equal(await page.locator('#payload-pointer').textContent(), 'result.structuredContent.data.value[0]');
  const meeting = await marked();
  assert.match(meeting, /^\{\s*"id": "test-a",[\s\S]*"subject": "Test meeting A"[\s\S]*\}$/);
  assert.doesNotMatch(meeting, /Test meeting B/);
  assert.ok(await page.locator('#payload-response .hljs-attr mark').count() > 3);
  assert.ok(await page.evaluate(() => {
    const view = document.querySelector('#payload-response').getBoundingClientRect();
    const mark = document.querySelector('#payload-response mark').getBoundingClientRect();
    return mark.top >= view.top && mark.top < view.bottom;
  }));
  await page.screenshot({ path: join(screenshots, 'workiq-payload.png'), animations: 'disabled' });
  await page.locator('#payload-close').click();
  assert.ok(await payloadDialog.isHidden());
  await cited.locator('.entity', { hasText: '1 meeting' }).click();
  assert.equal(await read.locator('.entity').getAttribute('aria-expanded'), 'false');
  assert.deepEqual(await details.locator('li strong').allTextContents(), ['Test standup']);
  await details.locator('li').first().getByRole('button', { name: 'Show in payload' }).click();
  await payloadDialog.waitFor({ state: 'visible' });
  assert.equal(await page.locator('#payload-summary').textContent(), 'Cited in ask · 0.4 s');
  assert.equal(await page.locator('#payload-pointer').textContent(), 'result.content[0].text');
  assert.equal(await marked(), '[Test standup](https://teams.microsoft.com/l/meeting/details?eventId=test)');
  await page.keyboard.press('Escape');
  assert.ok(await payloadDialog.isHidden());
  await cited.locator('.entity', { hasText: '1 person' }).click();
  assert.deepEqual(await details.locator('li strong').allTextContents(), ['Test Person']);
  await page.screenshot({ path: join(screenshots, 'workiq-entity-details.png'), animations: 'disabled' });
  await cited.locator('.entity', { hasText: '1 person' }).click();
  assert.ok(await details.isHidden());
  assert.equal(await page.locator('.message.assistant details.reasoning').count(), 1);
  await page.getByRole('tab', { name: 'Code', exact: true }).click();
  assert.ok(await page.locator('#source-code .hljs-keyword').count() > 10);
  await page.screenshot({ path: join(screenshots, 'workiq-answer.png'), animations: 'disabled' });
  assert.equal(await page.locator('.message.assistant strong').filter({ hasText: 'formatted reply' }).count(), 1);
  assert.equal(await page.locator('.message-body img, .message-body script').count(), 0);
  assert.equal(await page.locator('#question').count(), 1);
  assert.equal(await page.evaluate(() => window.bad), undefined);
  assert.match(await page.locator('#conversation-id').textContent(), /test-context/);
  assert.equal(await page.locator('.message-note', { hasText: 'Test label' }).count(), 1);
  assert.equal(await page.locator('.message-note', { hasText: 'Tools called: call_function, get_schema, ask' }).count(), 1);
  assert.equal(await page.locator('.message.assistant .message-header strong', { hasText: 'Deep Agents · gpt-test' }).count(), 1);
  assert.equal(await page.locator('.citations a').getAttribute('href'), 'https://example.com/source');
  await page.getByRole('tab', { name: 'REST API', exact: true }).click();
  assert.equal(await page.locator('#messages .message').count(), 0);
  await page.getByRole('tab', { name: 'MCP server', exact: true }).click();
  assert.equal(await page.locator('#messages .message').count(), 2);
  await page.getByRole('button', { name: 'New chat' }).click();
  await page.waitForFunction(() => document.querySelectorAll('#messages .message').length === 0);
  assert.ok(await page.locator('#empty-state').isVisible());
  assert.deepEqual(errors, []);
});
