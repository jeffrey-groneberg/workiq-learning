import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, readFile } from 'node:fs/promises';
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
  // Scrolled to the bottom, a dialog keeps its heading pinned to the top edge, with Close in it, uncovered and clickable.
  const assertCloseOnTop = async (dialog, name) => {
    const scrolled = await dialog.evaluate(element => { element.scrollTop = element.scrollHeight; return element.scrollTop > 0; });
    assert.ok(scrolled, `${name} should be long enough to scroll in this test`);
    await page.waitForFunction(element => element.classList.contains('scrolled'), await dialog.elementHandle());
    const close = await dialog.evaluate(element => {
      const heading = element.querySelector('.dialog-heading').getBoundingClientRect();
      const button = element.querySelector('.dialog-heading button[aria-label^="Close"]');
      const box = button.getBoundingClientRect();
      const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      return { pinned: Math.round(heading.top - element.getBoundingClientRect().top), inside: box.top >= heading.top && box.bottom <= heading.bottom, uncovered: hit === button || button.contains(hit) };
    });
    assert.ok(close.pinned >= 0 && close.pinned <= 2 && close.inside && close.uncovered, `${name}: Close must stay on top (${JSON.stringify(close)})`);
  };
  // Export PDF writes each chapter to a file; this test replaces only the save dialog, in this process.
  await desktop.evaluate(({ dialog }, directory) => {
    dialog.showSaveDialog = async (_window, options) => ({ canceled: false, filePath: `${directory}/${options.defaultPath.split(/[\\/]/).pop()}` });
  }, screenshots);
  const exportPdf = async (chapter, name) => {
    await chapter.locator('[data-export]').click();
    await page.waitForFunction(status => status.textContent.startsWith('Saved'), await chapter.locator('.export-status').elementHandle());
    assert.equal(await chapter.locator('.export-status').textContent(), `Saved Work IQ - ${name}.pdf. Open`);
    assert.equal(await page.locator('#print-root').count(), 0, 'The print copy is removed afterwards');
    const pdf = await readFile(join(screenshots, `Work IQ - ${name}.pdf`), 'latin1');
    assert.ok(pdf.startsWith('%PDF-'));
    return { pages: pdf.match(/\/Type\s*\/Page\b(?!s)/g)?.length ?? 0, images: pdf.match(/\/Subtype\s*\/Image/g)?.length ?? 0 };
  };
  assert.match(await page.title(), /Work IQ/);
  // The first start opens How to: one screenshot per step, moved through with the arrows, the dots or the arrow keys.
  // After Start it stays closed, also after a reload; ? opens it again at step 1.
  const howto = page.locator('#howto-dialog');
  await howto.waitFor({ state: 'visible' });
  assert.equal(await page.evaluate(() => document.activeElement.id), 'howto-title', 'How to opens on its title, so no control carries a rose focus ring');
  const howtoState = () => howto.evaluate(dialog => {
    const steps = [...dialog.querySelectorAll('.howto-steps > li')];
    return {
      step: steps.findIndex(step => !step.inert), shown: steps.filter(step => !step.inert).length,
      dot: dialog.querySelector('.howto-dots [aria-current="step"]').dataset.step,
      previous: dialog.querySelector('[data-step-by="-1"]').disabled, next: dialog.querySelector('[data-step-by="1"]').disabled,
    };
  });
  const focused = () => page.evaluate(() => document.activeElement.getAttribute('aria-label') || document.activeElement.textContent);
  assert.deepEqual(await howto.locator('.howto-steps h3').allTextContents(), ['Pick a route.', 'Check what it needs.', 'Connect.', 'Chat and watch.', 'Follow the data.', 'Learn more.']);
  assert.deepEqual(await howtoState(), { step: 0, shown: 1, dot: '0', previous: true, next: false });
  await page.waitForFunction(() => [...document.querySelectorAll('.howto-shot')].every(image => image.complete && image.naturalWidth === 1920));
  // At the default window size the whole step fits, and the arrows sit centred on the screenshot's edges.
  assert.deepEqual(await howto.evaluate(dialog => {
    const shot = dialog.querySelector('.howto-steps > li:not([inert]) img').getBoundingClientRect();
    const next = dialog.querySelector('[data-step-by="1"]').getBoundingClientRect();
    return { fits: dialog.scrollHeight <= dialog.clientHeight, centred: Math.abs(next.top + next.height / 2 - (shot.top + shot.height / 2)) < 2, onEdge: next.left < shot.right && next.right > shot.right };
  }), { fits: true, centred: true, onEdge: true });
  await page.screenshot({ path: join(screenshots, 'workiq-howto.png'), animations: 'disabled' });
  await howto.getByRole('button', { name: 'Next step' }).click();
  assert.equal((await howtoState()).step, 1);
  // Step 2 is what each route needs: a row per route, each need linked to its Microsoft Learn page, inside the screenshot frame.
  const matrix = howto.locator('.howto-steps .needs');
  assert.deepEqual(await matrix.locator('tbody tr').evaluateAll(rows => rows.map(row => row.dataset.route)), ['mcp', 'a2a', 'rest']);
  assert.deepEqual(await matrix.locator('thead th').allTextContents(), ['Sign-in', 'Admin, once', 'Model']);
  assert.deepEqual(await matrix.locator('.none').allTextContents(), ['None. Microsoft 365 Copilot, or the agent you name, answers.Agent discovery', 'None. Microsoft 365 Copilot answers.REST API overview']);
  const learnLinks = await howto.locator('li:not([inert]) a').evaluateAll(links => links.map(link => link.href));
  assert.equal(learnLinks.length, 14);
  assert.ok(learnLinks.every(href => href.startsWith('https://learn.microsoft.com/en-us/')), learnLinks.join(' '));
  assert.ok(await howto.locator('.needs-panel').evaluate(panel => Math.abs(panel.offsetWidth / panel.offsetHeight - 1.6) < 0.01 && panel.scrollWidth <= panel.clientWidth), 'The matrix fits the 16:10 frame without growing it');
  assert.ok(await howto.evaluate(dialog => dialog.scrollHeight <= dialog.clientHeight), 'How to still fits with the matrix');
  await page.screenshot({ path: join(screenshots, 'workiq-howto-needs.png'), animations: 'disabled' });
  await page.keyboard.press('ArrowRight');
  assert.equal((await howtoState()).step, 2);
  await howto.getByRole('button', { name: 'Step 5: Follow the data' }).click();
  assert.equal((await howtoState()).dot, '4');
  await howto.getByRole('button', { name: 'Next step' }).focus();
  await page.keyboard.press('Enter');
  assert.deepEqual(await howtoState(), { step: 5, shown: 1, dot: '5', previous: false, next: true });
  assert.equal(await focused(), 'Start', 'The focus moves to Start when Next hides on the last step');
  await page.keyboard.press('ArrowRight');
  assert.equal((await howtoState()).step, 5);
  await page.screenshot({ path: join(screenshots, 'workiq-howto-last.png'), animations: 'disabled' });
  await page.keyboard.press('ArrowLeft');
  assert.equal((await howtoState()).step, 4);
  await howto.getByRole('button', { name: 'Start' }).click();
  assert.ok(await howto.isHidden());
  await page.reload();
  await page.waitForSelector('#source-code span');
  assert.ok(await howto.isHidden(), 'How to opens only on the first start');
  await page.getByRole('button', { name: 'How to use this app' }).click();
  await howto.waitFor({ state: 'visible' });
  assert.equal((await howtoState()).step, 0);
  await howto.getByRole('button', { name: 'Next step' }).click();
  await howto.getByRole('button', { name: 'Previous step' }).focus();
  await page.keyboard.press('Enter');
  assert.deepEqual(await howtoState(), { step: 0, shown: 1, dot: '0', previous: true, next: false });
  assert.equal(await focused(), 'Next step', 'The focus moves to Next when Previous hides on the first step');
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('link', { name: 'Source code on GitHub' }).getAttribute('href'), 'https://github.com/jeffrey-groneberg/workiq-learning');
  assert.doesNotMatch(await page.locator('header').textContent(), /Live connections only/);
  // Learn more groups the explanatory dialogs; every illustration file loads.
  assert.deepEqual(await page.locator('.learn-more button').allTextContents(), ['Capabilities', 'Work IQ vs. Graph', 'Authentication']);
  await page.waitForFunction(() => [...document.images].every(image => image.complete));
  assert.deepEqual(await page.evaluate(() => [...document.images].filter(image => !image.naturalWidth).map(image => image.src)), []);
  assert.equal(await page.evaluate(() => document.images.length), 17);
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
  // Each tab's Connect opens a dialog with only that route's settings. Invalid input never connects.
  const connectDialog = page.locator('#connect-dialog');
  const sections = () => connectDialog.locator('fieldset:not([hidden])').evaluateAll(sets => sets.map(set => set.dataset.for));
  // What you need: the route's row of the How to matrix; for MCP, only the chosen transport's lines. The dialog opens on it.
  const needs = () => connectDialog.evaluate(dialog => {
    const panel = dialog.querySelector('#connect-needs'), shows = phrase => panel.innerText.includes(phrase);
    return {
      rows: [...panel.querySelectorAll('tbody tr')].filter(row => !row.hidden).map(row => row.dataset.route),
      local: shows('bundled Work IQ CLI'), remote: shows('published MCP client'), everyRoute: shows('Every route also needs'),
      inView: dialog.scrollTop === 0 && panel.getBoundingClientRect().bottom <= dialog.getBoundingClientRect().bottom,
    };
  });
  await page.locator('#connect').click();
  await connectDialog.waitFor({ state: 'visible' });
  assert.equal(await page.locator('#connect-title').textContent(), 'Connect to Work IQ · A2A');
  assert.deepEqual(await sections(), ['api', 'agent']);
  assert.deepEqual(await needs(), { rows: ['a2a'], local: false, remote: false, everyRoute: true, inView: true });
  assert.equal(await page.evaluate(() => document.activeElement.id), 'tenant-id');
  await page.locator('#connect-start').click();
  assert.equal(await page.locator('#connect-feedback').textContent(), 'Directory (tenant) ID is required.');
  await page.locator('#tenant-id').fill('00000000-0000-0000-0000-000000000001');
  await page.locator('#client-id').fill('not-a-guid');
  await page.locator('#connect-start').click();
  await page.waitForFunction(() => document.querySelector('#connect-feedback').textContent.includes('Entra GUID'));
  assert.ok(await page.locator('#connect-progress').isHidden());
  await page.screenshot({ path: join(screenshots, 'workiq-connect-a2a.png'), animations: 'disabled' });
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: 'REST API', exact: true }).click();
  await page.locator('#connect').click();
  assert.deepEqual(await sections(), ['api']);
  assert.deepEqual(await needs(), { rows: ['rest'], local: false, remote: false, everyRoute: true, inView: true });
  assert.equal(await page.locator('#tenant-id').inputValue(), '', 'Rejected input is not saved');
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: 'MCP server', exact: true }).click();
  await page.locator('#connect').click();
  assert.equal(await page.locator('#connect-title').textContent(), 'Connect to Work IQ · local MCP');
  assert.deepEqual(await sections(), ['cli', 'model']);
  assert.deepEqual(await needs(), { rows: ['mcp'], local: true, remote: false, everyRoute: true, inView: true });
  assert.ok(await page.locator('#llm-key-row').isHidden());
  await page.locator('#llm-endpoint').fill('https://example.com');
  await page.locator('#llm-deployment').fill('gpt-test');
  await page.locator('#llm-auth').selectOption('key');
  assert.ok(await page.locator('#llm-key-row').isVisible());
  assert.ok(await page.locator('#llm-entra-help').isHidden());
  await page.locator('#connect-start').click();
  assert.equal(await page.locator('#connect-feedback').textContent(), 'API key is required.');
  assert.ok(await page.locator('#connect-feedback').evaluate(element => {
    const box = element.getBoundingClientRect(), view = element.closest('dialog').getBoundingClientRect();
    return box.top >= view.top && box.bottom <= view.bottom;
  }), 'The message is visible without scrolling');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'llm-api-key');
  assert.ok(await page.locator('#llm-api-key').evaluate(input => {
    const box = input.getBoundingClientRect();
    return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2) === input;
  }), 'The sticky footer does not cover the field that needs input');
  await page.screenshot({ path: join(screenshots, 'workiq-connect-mcp.png'), animations: 'disabled' });
  await page.getByRole('button', { name: 'Test model' }).click();
  assert.deepEqual(await page.locator('#llm-test-result li').allTextContents(), ['API key is required.']);
  await page.locator('#llm-auth').selectOption('entra');
  assert.ok(await page.locator('#llm-test-result').isHidden(), 'A changed model setting hides the old result');
  // Validation runs in main before any call, so these checks make no network request.
  await page.getByRole('button', { name: 'Test model' }).click();
  await page.waitForFunction(() => document.querySelector('#llm-test-result [data-state="fail"]')?.textContent.includes('Entra ID works only with Azure OpenAI and Microsoft Foundry endpoints'));
  await page.locator('#connect-start').click();
  await page.waitForFunction(() => document.querySelector('#connect-feedback').textContent.includes('Entra ID works only with Azure OpenAI and Microsoft Foundry endpoints'));
  await page.locator('#connect-close').click();
  assert.ok(await connectDialog.isHidden());
  await page.getByRole('button', { name: 'Remote', exact: true }).click();
  await page.locator('#connect').click();
  assert.deepEqual(await needs(), { rows: ['mcp'], local: false, remote: true, everyRoute: true, inView: true });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Local', exact: true }).click();
  const capabilities = page.locator('#capabilities-dialog');
  await page.getByRole('tab', { name: 'How it works' }).click();
  await page.getByRole('button', { name: 'Compare what MCP, A2A and REST can do' }).click();
  await capabilities.waitFor({ state: 'visible' });
  const cells = await capabilities.locator('tbody tr').evaluateAll(rows => rows.map(row => [...row.cells].map(cell => cell.textContent)));
  assert.deepEqual(cells.map(row => row[0]), ['Answers in natural language', 'Structured data by path', 'Download a file', 'Create', 'Update', 'Delete', 'Actions, such as sending mail']);
  for (const [row, tool] of [[3, 'create_entity'], [4, 'update_entity'], [5, 'delete_entity'], [6, 'do_action']]) {
    assert.deepEqual(cells[row].slice(1), [`Off by default · ${tool}`, 'tbd', 'tbd']);
  }
  assert.deepEqual(cells[1].slice(2), ['tbd', 'tbd']);
  assert.doesNotMatch(await page.locator('body').textContent(), /further research/i, 'Open questions are marked tbd');
  await page.screenshot({ path: join(screenshots, 'workiq-capabilities.png'), animations: 'disabled' });
  const capabilitiesPdf = await exportPdf(capabilities, 'Capabilities');
  assert.ok(capabilitiesPdf.pages >= 1 && capabilitiesPdf.images >= 1, JSON.stringify(capabilitiesPdf));
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
  for (const fact of ['az ad sp create --id fdcc1f02-fc51-4226-8753-f668596af7f7', 'ba081686-5d24-4bc6-a0d6-d034ecffed87', 'redirectPort: 12798', 'redirect http://localhost', 'allow 15 to 30 minutes', 'On-Behalf-Of', 'Application-only access isn\'t supported', 'For the published MCP client in a new tenant: tbd', 'scope api://workiq.svc.cloud.microsoft/WorkIQAgent.Ask', 'register the app as multitenant', 'Not yet tested in this app with a custom registration']) {
    assert.ok(authText.includes(fact), fact);
  }
  await page.screenshot({ path: join(screenshots, 'workiq-authentication.png'), animations: 'disabled' });
  const authenticationPdf = await exportPdf(authentication, 'Authentication');
  assert.ok(authenticationPdf.pages >= 2 && authenticationPdf.images >= 6, JSON.stringify(authenticationPdf));
  await assertCloseOnTop(authentication, 'Authentication');
  await page.screenshot({ path: join(screenshots, 'workiq-authentication-bottom.png'), animations: 'disabled' });
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: 'REST API', exact: true }).click();
  assert.match(await page.locator('#source-code').textContent(), /locationHint/);
  await page.getByRole('tab', { name: 'How it works' }).click();
  assert.match(await page.locator('#guide-summary').textContent(), /conversation ID/);
  assert.match(await page.locator('#guide-art').getAttribute('src'), /route-rest\.jpg$/);
  assert.ok(await page.locator('#guide-pricing').isVisible(), 'The pricing guide is linked on every route');
  assert.equal(await page.locator('#guide-pricing').getAttribute('href'), 'https://go.microsoft.com/fwlink/?linkid=2368800');
  await page.screenshot({ path: join(screenshots, 'workiq-how-it-works.png'), animations: 'disabled' });
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
  for (const fact of ['17,870 operations on 11,546 paths', '9.72 million', '1,209 for the 6 tool definitions', '4,402 for all 14', 'at most 128 functions per request', 'returns 21 paths', 'commit 4963f95']) {
    assert.ok(whyText.includes(fact), fact);
  }
  assert.ok(await why.locator('pre .hljs-keyword').count() > 3);
  await page.screenshot({ path: join(screenshots, 'workiq-why.png'), animations: 'disabled' });
  const whyPdf = await exportPdf(why, 'Work IQ vs Graph');
  assert.ok(whyPdf.pages >= 2 && whyPdf.images >= 3, JSON.stringify(whyPdf));
  await assertCloseOnTop(why, 'Work IQ vs. Graph');
  await page.screenshot({ path: join(screenshots, 'workiq-why-bottom.png'), animations: 'disabled' });
  await page.getByRole('button', { name: 'Try it in the MCP tab' }).click();
  assert.ok(await why.isHidden());
  assert.equal(await page.locator('#tab-mcp').getAttribute('aria-selected'), 'true');
  assert.match(await page.locator('#question').inputValue(), /^Which Planner tasks are assigned to me/);
  await page.locator('#question').fill('');
  await page.getByRole('button', { name: 'Local', exact: true }).click();
  await page.getByRole('tab', { name: 'Code', exact: true }).click();

  // Above 740 px the workspace fills the window below the route intro, so the page itself never scrolls.
  for (const width of [760, 1024, 1280]) {
    await page.setViewportSize({ width, height: 860 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, `No sideways scroll at ${width} px`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight), false, `No page scroll at ${width} px`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
  // Paint the code pane below the fold once, so the full-page screenshot includes it.
  await page.locator('#source-code').scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: join(screenshots, 'workiq-narrow.png'), fullPage: true, animations: 'disabled' });
  // Narrow screens keep Learn more as three icon buttons; their names stay available to screen readers.
  assert.deepEqual(await page.locator('.learn-more button').evaluateAll(buttons => buttons.map(button => [button.getBoundingClientRect().width < 48, button.textContent])), [[true, 'Capabilities'], [true, 'Work IQ vs. Graph'], [true, 'Authentication']]);
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
  await page.locator('#connect').click();
  await connectDialog.waitFor({ state: 'visible' });
  assert.ok(await connectDialog.evaluate(dialog => dialog.scrollWidth <= dialog.clientWidth), 'The connect dialog must not scroll sideways at 390 px');
  await assertCloseOnTop(connectDialog, 'Connect');
  await page.screenshot({ path: join(screenshots, 'workiq-connect-narrow.png'), animations: 'disabled' });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'How to use this app' }).click();
  await howto.waitFor({ state: 'visible' });
  assert.ok(await howto.evaluate(dialog => dialog.scrollWidth <= dialog.clientWidth), 'How to must not scroll sideways at 390 px');
  await page.screenshot({ path: join(screenshots, 'workiq-howto-narrow.png'), animations: 'disabled' });
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
      if (action === 'settings') {
        const { llmApiKey, ...settings } = payload;
        return { ok: true, data: { settings: { ...settings, hasApiKey: Boolean(llmApiKey) }, auth: { api: {}, mcp: {} }, closed: [] } };
      }
      if (action === 'testModel') {
        await new Promise(resolve => setTimeout(resolve, 300));
        return { ok: true, data: [
          { ok: true, text: 'Microsoft Entra ID: DefaultAzureCredential returned a token.' },
          { ok: true, text: `${payload.llmDeployment} answered in 0.3 s: POST ${payload.llmEndpoint}/openai/v1/${payload.llmApi === 'chat' ? 'chat/completions' : 'responses'}, 58 tokens.` },
          { ok: true, text: 'Tool calling works: the model called the test tool.' },
        ] };
      }
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
        // A long thread's summary call streams first, under its own id; the answer's call replaces it.
        trace({ direction: 'delta', body: { id: 'test-summary', text: 'Test fixture summary.', reasoning: '' } });
        trace({ direction: 'delta', body: { id: 'test-answer', text: '', reasoning: 'Test fixture: streamed reasoning.', part: 0 } });
        trace({ direction: 'delta', body: { id: 'test-answer', text: '', reasoning: 'Second part.', part: 1 } });
        trace({ direction: 'delta', body: { id: 'test-answer', text: 'Test fixture: **streamed** ', reasoning: '' } });
        trace({ direction: 'delta', body: { id: 'test-answer', text: 'draft.', reasoning: '' } });
        await new Promise(resolve => setTimeout(resolve, 1500));
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
  await page.locator('#connect').click();
  await page.locator('#llm-endpoint').fill('https://test-resource.openai.azure.com');
  await page.locator('#llm-deployment').fill('gpt-test');
  // Test model uses the form's values, unsaved, and lists each check.
  await page.locator('#llm-api').selectOption('chat');
  await page.getByRole('button', { name: 'Test model' }).click();
  await page.waitForFunction(() => document.querySelector('#llm-test-result li')?.dataset.state === 'pending');
  await page.waitForFunction(() => document.querySelectorAll('#llm-test-result [data-state="ok"]').length === 3);
  assert.equal((await page.locator('#llm-test-result li').allTextContents())[1], 'gpt-test answered in 0.3 s: POST https://test-resource.openai.azure.com/openai/v1/chat/completions, 58 tokens.');
  await page.locator('#llm-test-result').scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(screenshots, 'workiq-model-test.png'), animations: 'disabled' });
  await page.locator('#llm-api').selectOption('responses');
  assert.ok(await page.locator('#llm-test-result').isHidden());
  await page.locator('#connect-start').click();
  await page.waitForFunction(() => document.querySelector('#chat-error').textContent.includes('consent is missing'));
  assert.ok(await connectDialog.isVisible());
  assert.equal(await page.locator('#connect-title').textContent(), 'Connection failed');
  assert.match(await page.locator('#connect-summary').textContent(), /consent is missing/);
  assert.ok(await page.locator('#connect-done').isHidden());
  await page.getByRole('button', { name: 'Change settings' }).click();
  assert.ok(await page.locator('#connect-form').isVisible());
  assert.equal(await page.locator('#llm-endpoint').inputValue(), 'https://test-resource.openai.azure.com');
  await page.locator('#connect-close').click();
  assert.ok(await connectDialog.isHidden());
  assert.ok(await page.locator('#send').isDisabled());
  await page.locator('#connect').click();
  assert.equal(await page.locator('#llm-deployment').inputValue(), 'gpt-test');
  await page.locator('#connect-start').click();
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
  // Tokens stream into the chat while the model writes; the final reply then replaces them.
  await page.waitForFunction(() => document.querySelector('#pending .message-body')?.textContent.trim() === 'Test fixture: streamed draft.');
  assert.equal(await page.locator('#pending .message-body strong').textContent(), 'streamed');
  assert.equal(await page.locator('#pending .reasoning-text').textContent(), 'Test fixture: streamed reasoning.\n\nSecond part.');
  assert.match(await page.locator('#pending .pending-status').textContent(), /The model is writing…/);
  assert.equal(await page.locator('.flow-step.pending .flow-action').textContent(), 'The model is writing…');
  await page.screenshot({ path: join(screenshots, 'workiq-streaming.png'), animations: 'disabled' });
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
  assert.match(metrics, /Total 2\.3 s · Work IQ latency 1\.1 s \(3 calls\) · Model latency 1\.6 s \(2 steps\) · Model tokens: 2,860 \(2,700 in, 160 out incl\. 25 reasoning\)/);
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
  // A kept API key is used again only for its host: another host makes the key required again.
  await page.locator('#connect').click();
  await page.waitForFunction(() => document.querySelector('#connect').textContent === 'Connect');
  await page.locator('#connect').click();
  await page.locator('#llm-endpoint').fill('https://api.example.com/v1');
  await page.locator('#llm-auth').selectOption('key');
  await page.locator('#llm-api-key').fill('test-key-value');
  await page.locator('#connect-start').click();
  await page.getByRole('button', { name: 'Start chatting' }).click();
  await page.locator('#connect').click();
  await page.waitForFunction(() => document.querySelector('#connect').textContent === 'Connect');
  await page.locator('#connect').click();
  const key = page.locator('#llm-api-key');
  assert.deepEqual(await key.evaluate(input => [input.required, input.placeholder]), [false, 'Kept in memory until you quit. Leave empty to keep it.']);
  await page.locator('#llm-endpoint').fill('https://api.other.example/v1');
  assert.deepEqual(await key.evaluate(input => [input.required, input.placeholder]), [true, '']);
  await page.keyboard.press('Escape');
  assert.deepEqual(errors, []);
});
