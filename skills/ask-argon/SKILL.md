---
name: ask-argon
description: "Use the experimental local bridge to consult the Argon selection in Gemini Web when the user asks for it."
---

# Ask Gemini Argon

Use this skill only when the user requests a consultation with Gemini Argon or explicitly authorizes the bridge for the current task.

## Runtime and permission

The skill file alone is not the bridge runtime. Install Node.js 20 or newer, then install the package globally from its absolute package path:

```sh
npm install --global "<absolute-path-to-gemini-argon-bridge>"
```

The commands `ask-argon` and `argon-mcp` should then be available on `PATH`. If the package manager's global executable directory is not on `PATH`, use the full executable path returned by `npm bin -g` on older npm versions or `npm prefix -g` and the platform's global `bin` directory.

The bridge sends the prompt and context you pass to the Gemini Web tab and Google account currently active in the CDP browser. Send only content covered by the user's request and permission. Do not include secrets, private files, or unrelated source code. The bridge does not upload files automatically.

## Prepare the browser

1. Start Chrome or Edge with CDP enabled and open `https://gemini.google.com/`.
2. Select the Argon model with the Cao/High setting. The bridge checks the visible UI label; that label is not backend verification.
3. Run `ask-argon --list-tabs` to list eligible Gemini Web tabs. If more than one is listed, choose the correct `tabId` and pass it with `--tab`.

## Ask

Use a focused prompt and only relevant, authorized context:

```sh
ask-argon --prompt "<Question>" --context "<Relevant authorized context>" --tab "<CDP_TARGET_ID>"
```

For a UTF-8 prompt file, use `--file <path>`. Use `--json` for structured output. `ARGON_CDP_ENDPOINT` sets the browser endpoint and `ARGON_TIMEOUT_SEC` sets the total deadline; CLI flags override environment defaults.

## Review

Inspect `modelLabelObserved`, `thinkingLabelObserved`, and `completionEvidence` when using `--json`. Explain that the result is based on the visible Gemini Web UI, assess suggestions independently, and do not describe the model as backend-verified. Current adapter support is limited to Gemini Web; Google AI Studio and Arena are not supported.
