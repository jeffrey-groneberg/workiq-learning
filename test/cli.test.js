import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { cliFolder, findCli, cliCommand, shellPath } from '../src/workiq/cli.js';

const windows = process.platform === 'win32';
const exe = windows ? 'workiq.exe' : 'workiq';
// Tests never start your real login shell; the ones that need it get a PATH from here.
const noLogin = async () => '';
async function scratch(t) {
  const directory = realpathSync(await mkdtemp(join(tmpdir(), 'workiq-cli-')));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('the CLI folder follows the npm package: Windows on Arm runs the x64 build', () => {
  assert.deepEqual(
    [['win32', 'x64'], ['win32', 'arm64'], ['darwin', 'x64'], ['darwin', 'arm64'], ['linux', 'x64'], ['linux', 'arm64']].map(target => cliFolder(...target)),
    ['win-x64', 'win-x64', 'osx-x64', 'osx-arm64', 'linux-x64', 'linux-arm64'],
  );
  // A newer @microsoft/workiq that picks another folder fails here first.
  const { getCurrentPlatform, isWSL } = createRequire(import.meta.url)('@microsoft/workiq/lib/install.js');
  if (!isWSL()) assert.equal(cliFolder(process.platform, process.arch), getCurrentPlatform());
});

test('from source, the CLI comes with the app dependencies', async () => {
  const command = await findCli({ path: '', login: () => assert.fail('The login shell is not needed') });
  assert.ok(command?.includes(join('node_modules', '@microsoft', 'workiq', 'bin')), command);
});

test('without a bundled CLI, the app runs the binary of the one npm install -g put on PATH', async t => {
  const prefix = await scratch(t);
  const pkg = join(prefix, ...(windows ? [] : ['lib']), 'node_modules', '@microsoft', 'workiq');
  const binary = join(pkg, 'bin', cliFolder(process.platform, process.arch), exe);
  await mkdir(dirname(binary), { recursive: true });
  await writeFile(binary, '');
  await writeFile(join(pkg, 'bin', 'workiq.js'), '');
  // npm's layout: workiq.cmd beside node_modules on Windows, a bin/workiq link to the package's launcher elsewhere.
  const bin = windows ? prefix : join(prefix, 'bin');
  await mkdir(bin, { recursive: true });
  if (windows) await writeFile(join(bin, 'workiq.cmd'), '');
  else await symlink(join('..', 'lib', 'node_modules', '@microsoft', 'workiq', 'bin', 'workiq.js'), join(bin, 'workiq'));
  assert.equal(await findCli({ path: [join(prefix, 'missing'), bin].join(delimiter), bundled: join(prefix, 'none'), login: noLogin }), binary);
});

test('a workiq executable on PATH that npm did not install runs as it is', async t => {
  const bin = await scratch(t);
  await writeFile(join(bin, exe), '');
  assert.equal(await findCli({ path: bin, bundled: join(bin, 'none'), login: noLogin }), join(bin, exe));
});

test('started from the Finder or a desktop menu, the app finds a CLI on the login shell PATH', { skip: windows && 'Windows apps get the user PATH' }, async t => {
  const bin = await scratch(t);
  await writeFile(join(bin, exe), '');
  assert.equal(await findCli({ path: '', bundled: join(bin, 'none'), login: async () => bin }), join(bin, exe));
});

test('the login shell reports its PATH, whatever its startup files print first', { skip: windows && 'POSIX shells only' }, async t => {
  const directory = await scratch(t);
  // A stand-in for zsh or bash: a startup file prints a greeting and extends PATH, then the shell runs its -c command.
  const shell = join(directory, 'shell');
  await writeFile(shell, '#!/bin/sh\necho "Welcome back"\nPATH="/from/login/bin:$PATH" exec /bin/sh -c "$2"\n', { mode: 0o755 });
  assert.match(await shellPath(shell), /^\/from\/login\/bin:/);
  assert.equal(await shellPath(join(directory, 'missing')), '', 'A shell that does not start adds nothing');
});

test('a login shell that hangs is stopped with its jobs and adds nothing', { skip: windows && 'POSIX shells only' }, async t => {
  const directory = await scratch(t);
  const shell = join(directory, 'shell');
  const pidFile = join(directory, 'job.pid');
  // A startup file that starts a job and then waits, with SIGTERM ignored as in an interactive shell.
  await writeFile(shell, `#!/bin/sh\ntrap '' TERM\nsleep 30 &\necho $! > '${pidFile}'\nwait\n`, { mode: 0o755 });
  const started = performance.now();
  assert.equal(await shellPath(shell, 500), '');
  assert.ok(performance.now() - started < 5_000, 'The timeout ends the wait');
  const job = Number(readFileSync(pidFile, 'utf8'));
  const gone = async () => {
    for (let tries = 0; tries < 40; tries++) {
      try { process.kill(job, 0); } catch (error) { if (error.code === 'ESRCH') return true; }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    return false;
  };
  assert.ok(await gone(), 'The job the shell started is gone too');
});

test('with no CLI anywhere, the local route says how to install it', async t => {
  const empty = await scratch(t);
  await mkdir(join(empty, 'workiq'));
  const nowhere = { path: empty, bundled: join(empty, 'none'), login: noLogin };
  assert.equal(await findCli(nowhere), null, 'A folder named workiq is not the CLI');
  await assert.rejects(cliCommand(nowhere), /Install it with npm install -g @microsoft\/workiq, then try again/);
});
