import { packager } from '@electron/packager';
import { basename, dirname } from 'node:path';
import workiq from '@microsoft/workiq/lib/install.js';

const binary = workiq.getBinaryPath();
if (!binary) throw new Error(`No bundled Work IQ CLI for ${process.platform}/${process.arch}.`);
const platformDirectory = basename(dirname(binary));
const outputs = await packager({
  dir: '.', out: 'dist', name: 'Work IQ Showcase',
  platform: process.platform, arch: process.arch, overwrite: true, asar: false,
  ignore: path => {
    const relative = path.replaceAll('\\', '/');
    if (/^\/(?:test|scripts|startup\.sh|\.github|\.impeccable|dist|test-results|playwright-report)(?:\/|$)/.test(relative)
        || /^\/\.env(?:\.|\/|$)/.test(relative)) return true;
    const native = relative.match(/\/node_modules\/@microsoft\/workiq\/bin\/((?:win|osx|linux)-[^/]+)(?:\/|$)/);
    return Boolean(native && native[1] !== platformDirectory);
  },
});
console.log(`Desktop app: ${outputs.join('\n')}`);
