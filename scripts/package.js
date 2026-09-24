import { packager } from '@electron/packager';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { cliFolder } from '../src/workiq/cli.js';

// npm run package -- [--arch x64|arm64] [--without-cli]
// Release downloads use --without-cli: the Work IQ CLI's license doesn't allow redistributing it, so each user installs it.
const { values: { arch, 'without-cli': withoutCli } } = parseArgs({
  options: { arch: { type: 'string', default: process.arch }, 'without-cli': { type: 'boolean', default: false } },
});
const folder = cliFolder(process.platform, arch);
if (!withoutCli && !existsSync(join('node_modules', '@microsoft', 'workiq', 'bin', folder))) {
  throw new Error(`No bundled Work IQ CLI for ${process.platform}/${arch}. Use --without-cli to leave it out.`);
}
const outputs = await packager({
  dir: '.', out: 'dist', name: 'Work IQ Showcase',
  // On Linux the app starts from a terminal as often as from a launcher, so its command has no spaces.
  ...(process.platform === 'linux' && { executableName: 'work-iq-showcase' }),
  platform: process.platform, arch, overwrite: true, asar: false,
  // A custom ignore replaces the packager's defaults, so it also leaves out .git, node_modules/.bin and the lockfile.
  ignore: path => {
    const relative = path.replaceAll('\\', '/');
    if (/^\/(?:\.git|test|scripts|startup\.sh|\.github|\.impeccable|dist|release|test-results|playwright-report|package-lock\.json)(?:\/|$)/.test(relative)
        || /^\/\.(?:env|npmrc)(?:\.|\/|$)/.test(relative) || /\/node_modules\/\.bin(?:\/|$)/.test(relative)) return true;
    const native = relative.match(/\/node_modules\/@microsoft\/workiq\/bin\/((?:win|osx|linux)-[^/]+)(?:\/|$)/);
    return Boolean(native && native[1] !== folder);
  },
  // The pruner keeps every production dependency's folder whatever ignore says, so --without-cli removes the CLI's after the copy.
  afterCopy: [async ({ buildPath }) => {
    if (withoutCli) await rm(join(buildPath, 'node_modules', '@microsoft', 'workiq'), { recursive: true, force: true });
  }],
});
// Packaging edits the Electron app and breaks its signature, so macOS would call a downloaded copy damaged.
// An ad-hoc signature seals the bundle again; signing for other people still needs a Developer ID and notarization.
if (process.platform === 'darwin') {
  for (const output of outputs) execFileSync('codesign', ['--force', '--deep', '--sign', '-', join(output, 'Work IQ Showcase.app')]);
}
console.log(`Desktop app: ${outputs.join('\n')}`);
