# Alpha validation

Version: `0.2.0-alpha.1`. Validation date: 2026-10-20.

This is an experimental consultation bridge. It is not a replacement model provider or a complete agent tool loop. Implementation and independent adversarial review used separate GPT-6 Luna agents with Max reasoning. Findings were repaired and rechecked within the bounded scope below.

## Local results

| Check | Result | Scope |
| --- | --- | --- |
| Node regression suite | 16/16 passed | CLI, core safety and MCP protocol checks |
| Real-browser fixture | 27/27 passed | Installed Chrome, isolated temporary profile, synthetic HTML and intercepted network; no provider queries |
| Independent rich-text checks | 6/6 passed | Paragraphs, blank lines, BR, indentation and Unicode serialization |
| Clean package installation | Passed | Path containing spaces, CLI from another working directory, installed runtime hashes matched source |
| Package contents | Reviewed | Allowlisted runtime, adapters, skill and user documentation; excludes audit logs, browser profiles and credentials |

Local testing used Windows, Node.js 24 and Chrome. GitHub Actions is configured for Windows and Ubuntu with Node.js 20 and 24; the Actions run on the published commit is the authority for that matrix. The optional browser fixture is not part of the hosted CI matrix.

## Live Gemini checks

Four synthetic queries completed through real child-process CLI/MCP calls while the page displayed Argon Cao. One additional attempt was blocked before submission by the input-integrity check and is not counted as a successful query.

| Query | Transport | Result | Wall time |
| --- | --- | --- | --- |
| JSON, arithmetic and Vietnamese | CLI | Passed | 8.484 s |
| Algorithm with seven held test cases | CLI | Passed | 18.242 s |
| Dependency reasoning | MCP stdio | Passed | 14.495 s |
| Retrieve two values from 100 records | MCP stdio | Passed after serializer fix | 24.151 s |

These checks span the repair cycle. The first three used the core before the final rich-text serializer fix; only the final multiline retry used the final core. The final source also passed automated regressions and independent serializer checks. This is not a four-query rerun on one identical final source revision.

The results demonstrate bounded transport and answer checks. They do not establish comparative model strength, productivity improvement, broad long-context performance or backend model identity. The model label is observed UI evidence only. Full account-session logs and internal coordination documents remain local.

## Remaining limits

- Only the exact HTTPS Gemini Web hostname and supported model/completion controls are accepted. AI Studio and Arena are unsupported.
- Claude Code, Cursor, Codex and Antigravity adapters are configuration examples; complete sessions in those hosts have not been certified.
- Ambiguous, missing or malformed lock-owner metadata and an abandoned recovery guard fail closed. Manual recovery may be necessary after verifying all relevant processes have stopped.
- DOM changes, quotas, account state, localization and browser versions may prevent operation. A tab lock only coordinates this package's processes, not manual browser use.
- CI success is not evidence that live Google behavior or every harness works.
