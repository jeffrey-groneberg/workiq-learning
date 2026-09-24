import { PublicClientApplication, InteractionRequiredAuthError } from '@azure/msal-node';
import { SCOPE } from './workiq/http.js';

const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Published by microsoft/work-iq in plugins/workiq/.mcp.json.
export const MCP_CLIENT_ID = 'ba081686-5d24-4bc6-a0d6-d034ecffed87';
export const SETTINGS = ['tenantId', 'clientId', 'mcpTenantId', 'mcpClientId', 'agentId', 'localAccount', 'llmEndpoint', 'llmDeployment', 'llmApi', 'llmReasoning', 'llmAuth', 'llmApiKey'];
// Azure OpenAI and Microsoft Foundry hosts: the only ones that receive the model's Entra token from DefaultAzureCredential.
export const AZURE_AI = /^https:\/\/[a-z0-9-]+\.(openai\.azure\.com|cognitiveservices\.azure\.com|services\.ai\.azure\.com)(\/|$)/i;

export function validateSettings(input) {
  const settings = {};
  for (const name of SETTINGS) {
    if (typeof input?.[name] !== 'string' || input[name].length > 512) {
      throw new Error(`Invalid ${name} setting.`);
    }
    settings[name] = input[name].trim();
  }
  for (const name of ['tenantId', 'clientId', 'mcpTenantId', 'mcpClientId']) {
    if (settings[name] && !guid.test(settings[name])) throw new Error(`${name} must be an Entra GUID, not a secret or token.`);
  }
  if (settings.localAccount && !/^[^\s@]+@[^\s@]+$/.test(settings.localAccount)) {
    throw new Error('The local CLI account must be an email address, or empty to use its existing session.');
  }
  // Any OpenAI-compatible endpoint over https, or over http on this computer for a local server.
  settings.llmEndpoint = settings.llmEndpoint.replace(/\/+$/, '');
  if (settings.llmEndpoint) {
    const url = URL.parse(settings.llmEndpoint);
    const local = url?.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (!url || !(url.protocol === 'https:' || local) || url.username || url.password || url.search || url.hash) {
      throw new Error('The model endpoint must be an https URL without credentials or query, such as https://my-resource.openai.azure.com, or http://localhost for a local server.');
    }
  }
  if (settings.llmDeployment && !/^[\w.:/@-]{1,128}$/.test(settings.llmDeployment)) {
    throw new Error('The model name may only contain letters, numbers and . _ - : / @.');
  }
  if (!['responses', 'chat'].includes(settings.llmApi)) throw new Error('The model API must be Responses or Chat Completions.');
  if (!['', 'low', 'medium', 'high'].includes(settings.llmReasoning)) throw new Error('Reasoning must be off, low, medium or high.');
  if (!['entra', 'key'].includes(settings.llmAuth)) throw new Error('Model authentication must be Microsoft Entra ID or an API key.');
  if (settings.llmAuth === 'entra' && settings.llmEndpoint && !AZURE_AI.test(settings.llmEndpoint)) {
    throw new Error('Microsoft Entra ID works only with Azure OpenAI and Microsoft Foundry endpoints. Choose API key for other endpoints.');
  }
  if (/\s/.test(settings.llmApiKey)) throw new Error('The API key must not contain spaces.');
  return settings;
}

// Whether two URLs share scheme, host and port.
export const sameOrigin = (a, b) => Boolean(URL.parse(a)?.origin) && URL.parse(a).origin === URL.parse(b)?.origin;
// An empty key field reuses the key in memory only for the host it was entered for, so it never reaches another provider.
export const keptKey = (next, previous) => next.llmApiKey || (sameOrigin(next.llmEndpoint, previous.llmEndpoint) ? previous.llmApiKey : '');

// The model API key stays in memory: it is never written to disk or sent back to the window.
export const storable = ({ llmApiKey, ...settings }) => settings;
export const publicSettings = settings => ({ ...storable(settings), hasApiKey: Boolean(settings.llmApiKey) });

export function createAuth(openBrowser, { mcp = false } = {}) {
  let client;
  let account;
  let sharedClient;
  return {
    configure({ tenantId, clientId }) {
      account = undefined;
      sharedClient = mcp && !clientId;
      if (sharedClient) {
        clientId = MCP_CLIENT_ID;
        tenantId ||= 'organizations';
      }
      client = tenantId && clientId ? new PublicClientApplication({
        auth: { clientId, authority: `https://login.microsoftonline.com/${tenantId}` },
      }) : undefined;
    },
    async signIn() {
      if (!client) throw new Error('Enter the tenant ID and client ID of your app registration first.');
      const result = await client.acquireTokenInteractive({
        scopes: [SCOPE], prompt: 'select_account',
        ...(sharedClient ? { preferredPort: 12798 } : {}),
        openBrowser: async url => {
          const redirect = new URL(new URL(url).searchParams.get('redirect_uri'));
          if (sharedClient && redirect.port !== '12798') {
            throw new Error('The published MCP client needs port 12798. Close the other sign-in using that port and try again.');
          }
          await openBrowser(url);
        },
      });
      if (!result.account || !result.accessToken) throw new Error('Microsoft sign-in returned no account or access token.');
      account = result.account;
      return this.status();
    },
    async token() {
      if (!client || !account) {
        throw new Error(mcp
          ? 'Reconnect remote MCP to sign in. The local CLI sign-in is separate.'
          : 'Connect A2A or REST to sign in first. Local CLI sign-in is separate.');
      }
      try {
        const result = await client.acquireTokenSilent({ account, scopes: [SCOPE] });
        if (!result.accessToken) throw new Error('Microsoft did not return an access token.');
        return result.accessToken;
      } catch (error) {
        if (error instanceof InteractionRequiredAuthError) {
          throw new Error(mcp
            ? 'Remote MCP needs a fresh sign-in. Disconnect, then connect again and choose Sign out first.'
            : 'Microsoft requires a new sign-in. Disconnect, then connect again and choose Sign out first.');
        }
        throw error;
      }
    },
    signOut() { client?.clearCache(); account = undefined; },
    status() { return { signedIn: Boolean(account), username: account?.username, tenantId: account?.tenantId, sharedClient }; },
  };
}
