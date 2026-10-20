# Gemini Argon Bridge Rules

When the user asks to consult Gemini Argon, runs `/argon` or `/ask-argon`, or explicitly mentions "Gemini 4 Argon" / "Argon":
1. Prepare authorized context only. Avoid leaking credentials or unrelated files.
2. Ensure remote debugging is active on port 9222 and `https://gemini.google.com/` is open with the Argon model selected (auto-launch via skill if not active).
3. Invoke the bridge via `ask-argon` (or `ask-argon.cmd` on Windows) or the `ask_gemini_argon` MCP tool.
4. Synthesize the findings and explain the proposed approach clearly to the user.
