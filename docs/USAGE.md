# Usage

This is an experimental local bridge for consulting the Argon selection in Gemini Web. It uses the browser CDP connection already provided by the user; prompt and context passed to the CLI or MCP tool are sent to the signed-in Google account in that browser.

## Requirements

- Node.js 20 or newer.
- Chrome or Edge launched with remote debugging enabled.
- One Gemini Web tab at `https://gemini.google.com/` with the visible model control showing Argon and Cao/High.
- An empty prompt box and no active response generation.

Install this package globally from a local directory, or use it from a checkout:

```sh
npm install --global "<absolute-path-to-gemini-argon-bridge>"
ask-argon --list-tabs
```

`--list-tabs` is read-only. It returns eligible tabs and their CDP `targetId` values. When multiple Gemini tabs are open, provide the intended ID with `--tab`.

## CLI example

```sh
ask-argon --prompt "Review this error" --context "Relevant approved context" --tab "<CDP_TARGET_ID>" --json
```

The CLI also accepts a positional prompt, `--file <path>`, or UTF-8 stdin. `--timeout` sets one total deadline in seconds. `ARGON_TIMEOUT_SEC` and `ARGON_CDP_ENDPOINT` supply environment defaults; explicit CLI options take precedence. JSON mode writes one result object to stdout and sends progress to stderr.

## MCP

Run `argon-mcp` as a stdio MCP server. The `ask_gemini_argon` tool accepts `prompt`, optional `context`, `timeoutSeconds`, and `tabId`. Configure the MCP host's tool timeout to exceed `timeoutSeconds` so the bridge can return a structured timeout or cancellation result.

Example host configuration files are in [`../adapters/`](../adapters/). They are configuration examples; the listed agent hosts have not been integration-tested with this package. Do not describe the host integration as ready until the host discovers the tool and a synthetic call succeeds.

## Evidence and limits

Successful results include `modelLabelObserved`, `thinkingLabelObserved`, and `completionEvidence`. These values describe visible page evidence. They do not attest the backend model. The bridge does not return `modelVerified`.

Only the exact HTTPS Gemini Web hostname is supported. Google AI Studio and LM Arena are not supported. Unsupported or ambiguous page states fail closed. Browser interface changes, manual page interaction, other CDP clients, account settings, quota, or network errors can interrupt a call. The per-tab lock serializes this package's processes; it cannot stop manual interaction or unrelated tools from changing the page.

Send only prompt and context authorized by the user. The bridge does not upload project files automatically, but any context passed to it is sent to Gemini Web.
