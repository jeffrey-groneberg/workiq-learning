# Work IQ integration lab

A minimal desktop app (Electron, plain JavaScript) that shows three ways to build
Work IQ into your own tools. Each tab is a live chat over real Microsoft 365 data,
next to the code that powers it.

| Tab | What runs | Who reasons |
| --- | --- | --- |
| **MCP server** (Local or Remote) | A [Deep Agents](https://docs.langchain.com/oss/javascript/deepagents/overview) harness with your model calls Work IQ tools, through the Work IQ CLI (stdio) or `https://workiq.svc.cloud.microsoft/mcp`. The answer streams in as the model writes it. | Your harness and model |
| **A2A** | Reads the agent card, then sends a task with `SendMessage` (A2A 1.0). | The Work IQ agent |
| **REST API** | `POST /rest/conversations`, then `POST /rest/conversations/{id}/chat`. | Work IQ |

Beside the chat, **Code** shows the source files the app runs. **Flow** shows every
step between you, the model and Work IQ, with latency, tokens, a Copilot Credits
estimate and the raw payloads. **How it works** explains each route. Under **Learn
more**, the header opens **Capabilities** (read, create, update and delete per route),
**Work IQ vs. Graph** and **Authentication**, each with **Export PDF**. A How to with
five annotated screenshots and a table of what each route needs (sign-in, admin consent,
model, with links to Microsoft Learn) opens on the first start, and **?** opens it again.
Each tab's **Connect** starts with that route's row. The app
only makes live calls; it has no sample answers. Only the How to screenshots show
example data (`npm run screenshots` retakes them), and the illustrations are
AI-generated (MAI-Image-2.6).

## Start

You need Node.js 22.12 or later and a Microsoft 365 tenant with Work IQ enabled,
where you're assigned to its usage-based billing plan. To run the app without Node.js,
use a [download](#download) instead.

```sh
./startup.sh          # macOS, Linux or Git Bash: installs dependencies on first run, then starts
npm ci && npm start   # the same, on any platform
```

Click **Connect** on a tab and enter what that route needs:

- **MCP, local:** nothing for Work IQ. The Work IQ CLI signs you in with Microsoft's
  own registration; accept its EULA in the dialog if you haven't yet. From source, the CLI
  comes with the dependencies.
- **MCP, remote:** nothing, to use Microsoft's published MCP client (callback port
  12798), or your own app registration.
- **A2A and REST:** the tenant ID and client ID of your public-client app registration
  with the delegated `WorkIQAgent.Ask` permission and admin consent.
- **Both MCP routes** also need the harness model: Azure OpenAI, a Microsoft Foundry
  model, or any OpenAI-compatible endpoint with tool calling, through the Responses or
  Chat Completions API. It signs in with Microsoft Entra ID (`DefaultAzureCredential`,
  for example `az login`; Azure endpoints only) or an API key. **Test model** checks
  the settings with one short call.

To pre-fill these fields, copy `.env.example` to `.env`; settings you save in the app take precedence. `npm run package` builds a
standalone app for your platform that runs without Node.js. Its options go after `--`: `--arch x64` or `--arch arm64`
for another CPU, and `--without-cli` to leave out the Work IQ CLI, as the downloads do.

## Download

[Releases](https://github.com/jeffrey-groneberg/workiq-learning/releases) has the app for Windows, macOS and Linux,
each for x64 and arm64 (on a Mac with Apple silicon, take `macos-arm64`). It runs without Node.js, and
`SHA256SUMS.txt` lists each file's checksum. The builds aren't signed with a publisher certificate, so the first
start takes one extra step:

- **Windows:** extract the `.zip` and run `Work IQ Showcase.exe`. If SmartScreen says it protected your PC, choose
  **More info**, then **Run anyway**.
- **macOS:** unzip, move `Work IQ Showcase.app` to Applications and open it. macOS blocks the first start; allow it under
  **System Settings > Privacy & Security > Open Anyway**, or run
  `xattr -dr com.apple.quarantine "/Applications/Work IQ Showcase.app"` once.
- **Linux:** extract the `.tar.gz` and run `./work-iq-showcase`. Where Ubuntu restricts user namespaces (24.04 and
  later), Chromium's sandbox helper must belong to root first:
  `sudo chown root:root chrome-sandbox && sudo chmod 4755 chrome-sandbox`.

The Work IQ CLI's license doesn't allow redistributing it, so the downloads leave it out. For **MCP, local**, install
it once with `npm install -g @microsoft/workiq` (this needs Node.js). The app finds it on your PATH and, on macOS and
Linux, also on your login shell's PATH, for example with nvm. The other routes don't use it.

## Release

`.github/workflows/release.yml` builds the downloads on Windows, macOS and Linux runners, runs the tests, and starts
each runner's own build to check it. To publish a release, push a version tag that matches `package.json`:

```sh
npm version minor         # or patch or major: updates package.json, commits and tags it, for example v0.2.0
git push --follow-tags    # to release the current version instead: git tag v0.1.0 && git push origin v0.1.0
```

The workflow attaches the six archives and `SHA256SUMS.txt` to a new release with generated notes; a tag with a
suffix, such as `v0.2.0-beta.1`, becomes a pre-release. Pull requests that change the app or its packaging, and
**Run workflow** in the Actions tab, run the same builds and keep them as workflow artifacts for a week.
