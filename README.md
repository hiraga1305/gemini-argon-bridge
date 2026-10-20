# Gemini Argon Bridge

**Experimental local CLI and MCP bridge for asking the Argon selection in Gemini Web through browser CDP.** The bridge sends the prompt and context you provide to the signed-in Gemini Web tab and returns a newly completed assistant turn.

This package currently supports only `https://gemini.google.com/`. Before it submits anything, it requires one unambiguous Gemini Web tab, a visible model control containing **Argon** and **Cao/High**, an idle page, and an empty prompt box. It accepts a response only from a new top-level `model-response` whose Markdown content and model announcer report `aria-busy="false"`, whose `.response-footer.complete.gap` marker is present, and while no Stop control is visible.

The model label is evidence read from the page UI. It does not verify the backend model. Google AI Studio and LM Arena are not supported by this adapter. The package and the harness examples below are experimental; they have not been tested as integrations in Claude Code, Cursor, Codex, or Antigravity.

## Requirements and install

- Node.js 20 or newer.
- `npm install` in a local checkout, or `npm install --global "<absolute-path-to-this-package>"` to expose `ask-argon` and `argon-mcp` outside the checkout.
- Chrome or Edge launched with CDP enabled, with a Gemini Web tab open and the expected Argon setting selected.

Use a browser profile that you intend to expose through CDP. Anyone who can reach that CDP endpoint may be able to control the browser. When a launcher starts a new browser, it uses a separate `ArgonProfile`; if the configured CDP port is already open, the launcher reuses that existing browser without checking its profile. Review the active profile and account before sending anything.

Start Chrome/Edge with the supplied launcher, or start your own Chromium browser with `--remote-debugging-port=9222`. Then list eligible tabs and copy the target ID:

```sh
ask-argon --list-tabs
```

The list operation only reads open Gemini Web tabs. If more than one is listed, pass the selected target ID with `--tab`.

## CLI

```sh
ask-argon --prompt "Review this failure" --context "Relevant, approved context" --tab "<CDP_TARGET_ID>"
ask-argon --file ./prompt.txt --json
```

The CLI also accepts a positional prompt or UTF-8 input on stdin. `--json` writes one JSON object to stdout; progress goes to stderr. Use `--help` for all options. `ARGON_CDP_ENDPOINT` sets the CDP endpoint and `ARGON_TIMEOUT_SEC` sets the total deadline in seconds; explicit flags take precedence. `--timeout` covers connection, tab selection, lock wait, validation, submit, and response completion.

## MCP

The package exposes one stdio tool, `ask_gemini_argon`. Its arguments are `prompt`, optional `context`, optional positive `timeoutSeconds` (default 600), and optional `tabId`. The server reads `ARGON_CDP_ENDPOINT` from its process environment. It supports JSON-RPC cancellation notifications; callers should set their own tool timeout above the requested bridge deadline.

After installing this package globally, use `argon-mcp` as the command in your MCP host. Adapter files under [`adapters/`](adapters/) are starting-point examples. Replace values only as needed for your host and verify the host can discover and call the tool before relying on it. The Antigravity package manifest and MCP configuration are in [`plugin.json`](plugin.json) and [`mcp_config.json`](mcp_config.json); the plugin host itself has not been tested here.

## Safety and limits

- Only provide prompt and context that you are authorized to send to the Google account active in the browser. The bridge does not upload project files automatically, but supplied context goes to Gemini Web.
- A CDP target lock serializes this package's own processes for the same browser tab. It cannot prevent manual interaction or other software from changing the page.
- An observed UI label is not backend attestation. The response is returned with `modelLabelObserved`, `thinkingLabelObserved`, and `completionEvidence`; it never sets `modelVerified`.
- Browser DOM changes, account state, quotas, localization, network failures, and host-specific MCP behavior can prevent use. Unsupported or ambiguous states fail closed.
- No support claim is made for all operating systems, browser versions, languages, or agent harnesses.

## Checks

Read the [Vietnamese guide](README_VI.md) or the [validation scope and results](docs/VALIDATION.md).

```sh
npm ci
npm test
npm run pack:check
```

An optional real-browser fixture uses an installed Chrome/Edge, a temporary profile, a random CDP port, and an intercept that serves only synthetic local HTML:

```sh
npm run test:browser
```

It does not call Gemini or contact provider sites. Live checks require an explicit user decision and should use only synthetic prompts. See [`docs/USAGE.md`](docs/USAGE.md) for the current scope and setup.

## License

MIT. See [`LICENSE`](LICENSE).
