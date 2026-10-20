# Gemini Argon Bridge example for Claude Code

This is an experimental host configuration example; it has not been tested in Claude Code. Install this package globally first with `npm install --global "<absolute-package-path>"` so `argon-mcp` is available on `PATH`. Then add the local stdio server:
```bash
claude mcp add --transport stdio gemini-argon -- argon-mcp
```

Check the result with `claude mcp get gemini-argon` and `/mcp`. The tool sends supplied prompt/context to the signed-in Gemini Web tab. Only provide context authorized by the user.

For direct CLI use from any working directory:
```bash
ask-argon --prompt "Your question" --context "Code snippet"
```
