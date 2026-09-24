import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { _electron as electron } from 'playwright';

// The release gate for a packaged build (WORKIQ_EXECUTABLE): it starts and shows its real source.
// With WORKIQ_EXPECT_NO_CLI, as in a release download without the CLI on PATH, local MCP says how to install it.
test('packaged app starts, shows its source and explains a missing Work IQ CLI', async t => {
  const executablePath = process.env.WORKIQ_EXECUTABLE;
  assert.ok(executablePath, 'Set WORKIQ_EXECUTABLE to the packaged app.');
  const profile = await mkdtemp(join(tmpdir(), 'workiq-showcase-smoke-'));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  // npm run puts node_modules/.bin, with this checkout's workiq, first on PATH. A user's PATH has no such entry.
  const pathKey = Object.keys(env).find(name => name.toUpperCase() === 'PATH') ?? 'PATH';
  env[pathKey] = (env[pathKey] ?? '').split(delimiter).filter(entry => !/[\\/]node_modules[\\/]/.test(entry)).join(delimiter);
  const desktop = await electron.launch({ executablePath, args: [`--user-data-dir=${profile}`], env, timeout: 60_000 });
  t.after(async () => { await desktop.close(); await rm(profile, { recursive: true, force: true }); });
  assert.equal(await desktop.evaluate(({ app }) => app.isPackaged), true);
  const page = await desktop.firstWindow();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForSelector('#source-code span');
  assert.match(await page.title(), /Work IQ/);
  if (process.env.WORKIQ_EXPECT_NO_CLI) {
    const howto = page.locator('#howto-dialog');
    await howto.waitFor({ state: 'visible' });
    await howto.getByRole('button', { name: 'Start' }).click();
    await page.locator('#connect').click();
    await page.locator('#cli-missing').waitFor({ state: 'visible' });
    assert.match(await page.locator('#cli-missing').textContent(), /npm install -g @microsoft\/workiq/);
  }
  assert.deepEqual(errors, []);
});
