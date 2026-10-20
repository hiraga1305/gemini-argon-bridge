# Antigravity adapter example

This adapter is a configuration example only; the Antigravity host has not been tested with this package.

1. Install this checkout globally with `npm install --global "<absolute-package-path>"` so `argon-mcp` is on `PATH`.
2. Merge [`mcp_config.json`](../../mcp_config.json) into the workspace `.agents/mcp_config.json` or Antigravity's global MCP configuration.
3. Restart/reload MCP servers and verify `ask_gemini_argon` is listed before using it.

The tool sends the prompt and context supplied by the agent to the Gemini Web account open in the browser. Include only context authorized by the user.
