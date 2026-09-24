---
title: Copilot Credits
description: How Work IQ calls are metered in Copilot Credits, which call counts on which meter, and how the app estimates it.
---

Work IQ API usage is billed in Copilot Credits. On the MCP routes, your model's tokens are a second, separate charge.

:::caution[An estimate, not a bill]
The meters below are the app's estimate for each call. Confirm them with your account team before you budget.
:::

## Two meters

As set out in the [Copilot Credits Guide](https://go.microsoft.com/fwlink/?linkid=2368800) (September 2026):

- **Work IQ Tools API:** static, "0.1 Copilot Credit per API call for actions and tools".
- **Work IQ Chat or Context API:** variable, for "grounding, retrieval, and reasoning", driven by models, runtime, context and tools. The guide's Light, Medium and Heavy examples give no credit figures.

The pay-as-you-go list price is $0.01 per credit (USD, subject to change); pre-purchase plans list discounts of 5% to 20%. Work IQ APIs are not included in Microsoft Copilot licenses; Work IQ inside Microsoft Copilot's own experiences has no incremental charge.

## Which call counts on which meter

The app estimates each call like this:

| Call | Meter | Credits |
| --- | --- | --- |
| MCP `ask` | Work IQ Chat | Variable |
| MCP `fetch`, `call_function`, `search_paths`, `get_schema`, `list_agents`, `create_entity`, `update_entity`, `delete_entity`, `do_action` | Work IQ Tools API | 0.1 per `tools/call`, however many paths or items it covers |
| MCP `fetch_blob` and the CLI-only tools | Not classified | Not estimated |
| A2A `SendMessage` | Work IQ Chat | Variable |
| REST `chat` | Work IQ Chat | Variable |
| The MCP handshake and `tools/list`, the A2A agent card and `GetTask`, creating a REST conversation | Neither | None |

## Background reasoning

Only `ask` invokes Microsoft 365 Copilot, which reasons in the background and returns a written answer. The other tools read data, look up paths and schemas, or perform actions. On the MCP routes, your model reasons over their results.

## Your model's tokens

On the MCP routes, your model's tokens are billed by its provider. With Azure OpenAI they're on your Azure bill, and reasoning tokens are billed as output tokens. A2A and REST call no model of yours; a harness that adds its own model pays for that model separately.

## How the app estimates

The app records each answer's Work IQ requests, and shows your model's tokens as the model reports them. The Copilot Credits line under an answer counts only the calls the app classifies as Tools API or Chat; other requests stay visible in **Flow**, without an estimate. It multiplies the Tools API calls by 0.1 and doesn't calculate the variable part. Failed calls are counted too.

## Where to check actual usage

- **Microsoft 365 admin center › Copilot › Cost management** shows aggregate usage in credits by user, group, agent and service. It can include non-billable usage and isn't a per-call bill.
- **Azure Cost Management**, under the Microsoft Copilot Studio service, shows the billed amounts. They update daily, and usage can take up to 24 hours to appear.

:::tip[Recommendation]
To size the variable part, run a pilot and compare its aggregate usage in the Microsoft 365 admin center.
:::
