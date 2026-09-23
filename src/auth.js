import { PublicClientApplication, InteractionRequiredAuthError } from '@azure/msal-node';
import { SCOPE } from './workiq/http.js';

const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Published by microsoft/work-iq in plugins/workiq/.mcp.json.
export const MCP_CLIENT_ID = 'ba081686-5d24-4bc6-a0d6-d034ecffed87';

export function validateSettings(input) {
  const settings = {};
  for (const name of ['tenantId', 'clientId', 'agentId', 'localAccount', 'llmEndpoint', 'llmDeployment', 'llmReasoning']) {
    if (typeof input?.[name] !== 'string' || input[name].length > 512) {
      throw new Error(`Invalid ${name} setting.`);
    }
    settings[name] = input[name].trim();
  }
  for (const name of ['tenantId', 'clientId']) {
    if (settings[name] && !guid.test(settings[name])) throw new Error(`${name} must be an Entra GUID, not a secret or token.`);
  }
  if (settings.localAccount && !/^[^\s@]+@[^\s@]+$/.test(settings.localAccount)) {
    throw new Error('The local CLI account must be an email address, or empty to use its existing session.');
  }
  // The model's Entra token may only be sent to Azure OpenAI hosts.
  settings.llmEndpoint = settings.llmEndpoint.replace(/\/+$/, '');
  if (settings.llmEndpoint && !/^https:\/\/[a-z0-9-]+\.(openai\.azure\.com|cognitiveservices\.azure\.com|services\.ai\.azure\.com)$/i.test(settings.llmEndpoint)) {
    throw new Error('The model endpoint must be an Azure OpenAI resource URL, such as https://my-resource.openai.azure.com.');
  }
  if (settings.llmDeployment && !/^[\w.-]{1,64}$/.test(settings.llmDeployment)) {
    throw new Error('The model deployment name may only contain letters, numbers, dots, dashes and underscores.');
  }
  if (!['', 'low', 'medium', 'high'].includes(settings.llmReasoning)) throw new Error('Reasoning must be off, low, medium or high.');
  return settings;
}

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
      if (!client) throw new Error('Enter the tenant ID and client ID in Connection settings first.');
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
          : 'Sign in to the remote APIs in Connection settings first. Local CLI sign-in is separate.');
      }
      try {
        const result = await client.acquireTokenSilent({ account, scopes: [SCOPE] });
        if (!result.accessToken) throw new Error('Microsoft did not return an access token.');
        return result.accessToken;
      } catch (error) {
        if (error instanceof InteractionRequiredAuthError) {
          throw new Error(mcp
            ? 'Remote MCP needs a fresh sign-in. In Connections, clear app sign-ins, then reconnect remote MCP.'
            : 'Microsoft requires a new sign-in. Use Save and sign in to APIs in Connections.');
        }
        throw error;
      }
    },
    signOut() { client?.clearCache(); account = undefined; },
    status() { return { signedIn: Boolean(account), username: account?.username, tenantId: account?.tenantId, sharedClient }; },
  };
}
