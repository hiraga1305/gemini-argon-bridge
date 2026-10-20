# Antigravity Adapter

This adapter provides full integration with Google Antigravity as a **Plugin**, **Skill / Slash Command (`/argon`, `/ask-argon`)**, and **MCP Tool**.

---

## 1. Slash Command (`/argon` & `/ask-argon`)

Antigravity natively maps installed skills to chat slash commands:
- Type **`/argon <câu hỏi hoặc nhiệm vụ>`** or **`/ask-argon <prompt>`** directly in the Antigravity chat input box.
- The agent automatically:
  1. Checks if browser CDP port 9222 is alive; if not, automatically launches Chrome or Edge with remote debugging and the isolated profile.
  2. Resolves eligible Gemini Web tabs.
  3. Transmits your prompt and context to Gemini 4 Argon via `ask-argon`.
  4. Returns the deep reasoning synthesis directly into the conversation.

### Setup as Skill:
- Workspace-scoped: Place in `.agents/skills/argon/SKILL.md` (and `.agents/skills/ask-argon/SKILL.md`).
- Global: Place in `~/.gemini/config/skills/argon/SKILL.md`.

---

## 2. Model Context Protocol (MCP) Tool

Expose `ask_gemini_argon` as a native MCP tool across all projects:

1. Install this package globally:
   ```sh
   npm install --global "<absolute-package-path>"
   ```
2. Merge [`mcp_config.json`](../../mcp_config.json) into your workspace `.agents/mcp_config.json` or Antigravity's global MCP configuration (`~/.gemini/config/mcp_config.json`):
   ```json
   {
     "mcpServers": {
       "gemini-argon-bridge": {
         "command": "node",
         "args": ["<absolute-path-to-gemini-argon-bridge>/src/mcp-server.js"]
       }
     }
   }
   ```
3. Verify `ask_gemini_argon` is listed in your Antigravity MCP tool catalog.

---

## 3. Plugin Deployment

Deploy the entire bundle (`skills/`, `rules/`, `mcp_config.json`, `plugin.json`):
- Place under `.agents/plugins/gemini-argon-bridge/` or declare in `.agents/plugins.json` / `~/.gemini/config/plugins.json`.
- The Language Server automatically registers the skills, rules, and tools.

> [!IMPORTANT]
> The bridge sends the prompt and context supplied by the agent to the Gemini Web account open in the browser. Include only context authorized by the user.
