# Codex example instructions for Gemini Argon Bridge

This package is experimental and currently supports Gemini Web only. An MCP example config is in `config.toml`; the Codex host integration has not been tested.

Use the bridge only when the user requests Gemini Argon consultation. Send only prompt/context the user authorized to share with the signed-in Gemini Web account. If the MCP tool `ask_gemini_argon` is available, use it; otherwise install the package globally and run `ask-argon` from any working directory:

```bash
ask-argon --prompt "<Task description>" --context "<Relevant authorized context>"
```

Treat `modelLabelObserved` as UI evidence, not backend attestation. Review the response and its completion evidence before incorporating suggestions.
