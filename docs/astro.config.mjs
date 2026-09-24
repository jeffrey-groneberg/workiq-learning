// @ts-check
import { readFileSync } from 'node:fs';
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import starlight from '@astrojs/starlight';
import starlightThemeTerminal from 'starlight-theme-terminal';
import { site, base, repository } from './src/site-config.mjs';

// The header's version badge shows the app's version, read from its package.json when the site is built.
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

export default defineConfig({
  site,
  base,
  vite: { define: { 'import.meta.env.APP_VERSION': JSON.stringify(version) } },
  integrations: [
    starlight({
      title: 'Work IQ integration lab',
      description: 'Three ways to build Work IQ into your own tools: MCP, A2A and the REST API, each shown as a live chat next to the code that runs it.',
      favicon: '/favicon.svg',
      plugins: [starlightThemeTerminal()],
      customCss: ['./src/styles/custom.css'],
      // Long commands wrap instead of hiding their end behind a horizontal scroll.
      expressiveCode: { defaultProps: { overridesByLang: { 'bash,sh,shell,console,powershell': { wrap: true } } } },
      components: {
        SiteTitle: './src/components/SiteTitle.astro',
        Footer: './src/components/Footer.astro',
      },
      social: [{ icon: 'github', label: 'Source on GitHub', href: repository }],
      editLink: { baseUrl: `${repository}/edit/main/docs/` },
      sidebar: [
        {
          label: 'Getting started',
          items: [
            { label: 'Download and run', slug: 'getting-started/download' },
            { label: 'What you need', slug: 'getting-started/what-you-need' },
            { label: 'Tour of the app', slug: 'getting-started/tour' },
          ],
        },
        {
          label: 'Routes',
          items: [
            { label: 'Compare the routes', slug: 'routes' },
            { label: 'MCP, local', slug: 'routes/mcp-local' },
            { label: 'MCP, remote', slug: 'routes/mcp-remote' },
            { label: 'A2A', slug: 'routes/a2a' },
            { label: 'REST API', slug: 'routes/rest' },
          ],
        },
        {
          label: 'Concepts',
          items: [
            { label: 'Capabilities', slug: 'concepts/capabilities' },
            { label: 'Work IQ vs. Microsoft Graph', slug: 'concepts/work-iq-vs-graph' },
            { label: 'Authentication', slug: 'concepts/authentication' },
            { label: 'Copilot Credits', slug: 'concepts/copilot-credits' },
          ],
        },
        {
          label: 'Reference',
          items: [
            { label: 'Work IQ MCP tools', slug: 'reference/mcp-tools' },
            { label: 'Connect settings', slug: 'reference/connect-settings' },
          ],
        },
      ],
    }),
    // After Starlight, which then adds no MDX of its own. Astro 6.4 no longer passes its GFM and smart-punctuation
    // defaults to MDX 5, so without these, tables in .mdx pages stay plain text.
    mdx({ gfm: true, smartypants: true, optimize: true }),
  ],
});
