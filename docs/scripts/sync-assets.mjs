// Copies the app's illustrations and How to screenshots into the site before each build, so the docs show the
// same files as the app without a second copy in Git.
import { cp, mkdir, readdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const from = fileURLToPath(new URL('../../src/assets/', import.meta.url));
const to = fileURLToPath(new URL('../src/assets/app/', import.meta.url));
await rm(to, { recursive: true, force: true });
await mkdir(to, { recursive: true });
for (const name of await readdir(from)) {
  if (name.endsWith('.jpg')) await cp(from + name, to + name);
}
