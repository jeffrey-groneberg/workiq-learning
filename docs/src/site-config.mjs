// Where the site is published: a GitHub Pages project site. DOCS_SITE and DOCS_BASE retarget a build,
// for example DOCS_BASE=/ to preview it at the root of another host.
const rawBase = process.env.DOCS_BASE || '/workiq-learning/';

export const base = `/${rawBase.replace(/^\/+|\/+$/g, '')}/`.replace(/\/{2,}/g, '/');
export const site = process.env.DOCS_SITE || 'https://jeffrey-groneberg.github.io';
export const repository = 'https://github.com/jeffrey-groneberg/workiq-learning';
