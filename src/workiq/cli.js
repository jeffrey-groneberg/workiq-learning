import { createRequire } from 'node:module';
import { existsSync, realpathSync, statSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { delimiter, dirname, join } from 'node:path';

// The Work IQ CLI's license doesn't allow redistributing it, so release downloads leave it out and each user installs it.
export const INSTALL_CLI = 'npm install -g @microsoft/workiq';
const BUNDLED = fileURLToPath(new URL('../../node_modules/@microsoft/workiq', import.meta.url));

// The folder with a platform's binary in the CLI's npm package. As in the package's lib/install.js, Windows on Arm runs the x64 build.
export const cliFolder = (platform, arch) => (platform === 'win32' ? 'win-x64' : `${platform === 'darwin' ? 'osx' : 'linux'}-${arch}`);
const binaryIn = pkg => {
  const file = join(pkg, 'bin', cliFolder(process.platform, process.arch), process.platform === 'win32' ? 'workiq.exe' : 'workiq');
  return existsSync(file) ? file : null;
};
const isFile = file => Boolean(statSync(file, { throwIfNoEntry: false })?.isFile());

// npm links workiq to the package's launcher, which needs Node.js only to start the native binary, so the app starts that binary itself.
function onPath(path) {
  for (const directory of path.split(delimiter).filter(Boolean)) {
    if (process.platform === 'win32') {
      if (isFile(join(directory, 'workiq.exe'))) return join(directory, 'workiq.exe');
      const binary = isFile(join(directory, 'workiq.cmd')) && binaryIn(join(directory, 'node_modules', '@microsoft', 'workiq'));
      if (binary) return binary;
    } else {
      const command = join(directory, 'workiq');
      if (!isFile(command)) continue;
      const target = realpathSync(command);
      if (!target.endsWith(join('@microsoft', 'workiq', 'bin', 'workiq.js'))) return command;
      const binary = binaryIn(dirname(dirname(target)));
      if (binary) return binary;
    }
  }
  return null;
}

// Started from the Finder or a desktop menu, the app gets a shorter PATH than your terminal, without for example nvm's folders.
// Like VS Code, it then asks your login shell. Detached, the shell can't take over a terminal the app was started from.
export function shellPath(shell = process.env.SHELL || '/bin/sh', timeout = 10_000) {
  const marker = randomUUID();
  return new Promise(resolve => {
    let output = '';
    const child = spawn(shell, ['-ilc', `printf '%s%s%s' ${marker} "$PATH" ${marker}`], { detached: true, stdio: ['ignore', 'pipe', 'ignore'] });
    const done = path => { clearTimeout(timer); resolve(path); };
    // An interactive shell ignores SIGTERM, and its startup files may start jobs, so a timeout ends the whole process group.
    const timer = setTimeout(() => {
      done('');
      try { process.kill(-child.pid, 'SIGKILL'); } catch { /* it has already exited */ }
    }, timeout);
    child.stdout.on('data', chunk => {
      output += chunk;
      const parts = output.split(marker);
      if (parts.length > 2) done(parts[1]);
    });
    child.on('error', () => done(''));
    child.on('close', () => done(''));
  });
}
let loginPath;

// From source, and in builds you package yourself, the CLI comes with the app's dependencies. Otherwise the app runs the one
// npm install -g put on your PATH, or on your login shell's.
export async function findCli({ path = process.env.PATH ?? '', bundled = BUNDLED, login = () => (loginPath ??= shellPath()) } = {}) {
  if (existsSync(join(bundled, 'lib', 'install.js'))) {
    const own = createRequire(import.meta.url)(join(bundled, 'lib', 'install.js')).getBinaryPath() || binaryIn(bundled);
    if (own) return own;
  }
  return onPath(path) ?? (process.platform === 'win32' ? null : onPath(await login()));
}

export async function cliCommand(options) {
  const command = await findCli(options);
  if (!command) throw new Error(`No Work IQ CLI found on your PATH for ${process.platform}/${process.arch}. Install it with ${INSTALL_CLI}, then try again, or use remote MCP.`);
  return command;
}
