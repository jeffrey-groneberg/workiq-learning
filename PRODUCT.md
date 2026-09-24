# Work IQ showcase

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Electron with plain JavaScript, HTML and CSS, selected by the user. The web UI
runs in a cross-platform desktop shell. No frontend framework. The MCP tab uses
the user-requested Deep Agents (LangChain JS) harness, as-is, with a model
configured in the app.

## Users

A presenter and a customer evaluating how to integrate Work IQ into their own
toolchain or agent harness, including a customer meeting on 23 September 2026.

## Product Purpose

Demonstrate real Work IQ conversations and the small amount of code that powers
them. Make the differences between protocols visible without presenting them as
different intelligence products.

## Capabilities and Constraints

- Three integration tabs: MCP server (local and remote), A2A, and REST API.
- Small chat interfaces, actual request/response inspection, and implementation
  source that can be discussed during a meeting.
- Live connections only. No synthetic answers or silent offline fallback.
- Windows, macOS and Linux desktop targets; platform verification is reported
  honestly rather than inferred from Electron support.
- Delegated Microsoft Entra authentication and tenant billing/consent prerequisites.
- Local MCP means a local process, not offline Work IQ intelligence.
- Use MCP tool discovery; do not assume local and remote tool parity.
- The MCP tab runs a Deep Agents harness: a configurable model (Azure OpenAI, a
  Foundry model or any OpenAI-compatible endpoint, set and tested when connecting,
  authenticated with Microsoft Entra ID through DefaultAzureCredential or an API key)
  chooses among read-oriented Work IQ MCP tools and streams its answer. Write tools
  are withheld.
- A2A delegation and the REST conversation use Work IQ's hosted reasoning and
  need no model of the user's own.
- Token optimization is out of scope: use Deep Agents as-is and raise deployment
  capacity when rate-limited.
- Keep tokens and chat state out of source control and persistent application
  logs. Internal research must not become customer-facing source material.

## Brand Commitments

Minimal, practical and easy to walk through. Prioritize the chat and the code,
not a marketing landing page. Text-free illustrations (MAI-Image-2.6, one
consistent style) make each route and explanation recognizable; the facts stay in
the HTML beside them.

## Evidence on Hand

The user's eight-slide integration overview dated 21 September 2026, current
Microsoft Learn API/CLI/MCP/A2A/REST documentation, Microsoft's published samples,
and internal WorkIQ research. The presentation and private research are not
redistributed in this repository.

## Product Principles

- Show the real boundary: transport, authentication, state and hosted reasoning.
- Favor small, readable protocol adapters over a generalized framework.
- Label disconnected, pending, failed and authenticated states truthfully.
- Never claim that an `ask` prompt or client allowlist makes authorization read-only.
