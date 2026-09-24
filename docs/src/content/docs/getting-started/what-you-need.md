---
title: What you need
description: The tenant setup every route needs, and the sign-in, admin consent and model for each route.
---

Every route needs:

- **Work IQ enabled in your tenant.** See [Enable your tenant for Work IQ](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/work-iq/enable-work-iq).
- **A usage-based billing plan, with each user assigned to it.** See [usage-based billing](https://learn.microsoft.com/en-us/microsoft-365/copilot/usage-based-billing-overview-copilot-credits).

A tenant admin sets both up once; [Authentication](../../concepts/authentication/#admin-once-per-tenant-for-every-route) has the steps.

## By route

| Route | Sign-in | Admin, once | Model |
| --- | --- | --- | --- |
| **MCP, local** | The Work IQ CLI's own registration. Accept its EULA once. [Work IQ CLI](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/work-iq/cli) | Admin consent for the Work IQ application. [CLI prerequisites](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/work-iq/cli#prerequisites) | Yours, with tool calling. |
| **MCP, remote** | The published MCP client, or your own registration. [MCP overview](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/work-iq/mcp/overview) | Admin consent for your client ID; for the published client, tbd. [Grant admin consent](https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/grant-admin-consent) | Yours, with tool calling. |
| **A2A** | Your app registration: a public client with delegated `WorkIQAgent.Ask`. [Register the app](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/work-iq/a2a/quickstart#register-the-application-in-microsoft-entra) | Admin consent for `WorkIQAgent.Ask`, which requires it. [Permissions reference](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/work-iq/permissions) | None: Microsoft 365 Copilot, or the agent you name, answers. [Agent discovery](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/work-iq/a2a/quickstart#agent-discovery) |
| **REST API** | Your app registration: the same public client as for A2A. | Admin consent for `WorkIQAgent.Ask`, as for A2A. | None: Microsoft 365 Copilot answers. [REST API overview](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/work-iq/rest/overview) |

The model for both MCP routes is Azure OpenAI, a Microsoft Foundry model or any OpenAI-compatible endpoint, reached with Microsoft Entra ID or an API key. See the [Azure OpenAI v1 API](https://learn.microsoft.com/en-us/azure/foundry/openai/api-version-lifecycle), [keyless authentication](https://learn.microsoft.com/en-us/azure/foundry/foundry-models/how-to/configure-entra-id), and [Connect settings](../../reference/connect-settings/#the-harness-model) for what to enter.
