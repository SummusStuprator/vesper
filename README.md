# Vesper

A desktop coding agent built on [Refuseless](https://refuseless.com/?ref=dwqxpimh) — hosted open-weight models with refusals removed from the weights — that also works with any OpenAI-compatible provider.

```
npm install
npm start          # npm run dev opens DevTools
npm run check      # offline self-test (23 checks, includes a mock streaming provider)
npm run shortcut   # Windows: Desktop + Start menu shortcut with Vesper's icon
```

The app icon lives in `assets/icon.svg`; `npm run icons` re-renders `icon.png` / `icon.ico` from it.

## Setup
First launch shows the setup flow:
- **Create a Refuseless account** — signup runs *inside* Vesper in a sandboxed browser view with its own cookie jar, using the referral link. When you create a key (`abl_…`) on the page, Vesper detects it, verifies it against `/v1/credits`, and shows your balance.
- **I have a key** — paste and verify.
- **Different provider** — OpenAI, Anthropic, OpenRouter, DeepSeek, Groq, Together, Mistral, Ollama, LM Studio or any custom base URL.

The welcome screen pulls the live public Refuseless lineup (prices, context, abliterated/vision flags).

## What the agent can do
| Area | Details |
|---|---|
| Files | `read_file`, `write_file`, `edit_file`, atomic `multi_edit`, `list_dir`, `glob`, `grep` (ripgrep when present) — every edit shows a diff and can be reverted, individually or per turn |
| Shell | PowerShell 7 / Windows PowerShell / bash, live output, timeouts, background jobs (`shell_output`) |
| Web | `web_search` (DuckDuckGo, Brave or Tavily), `web_fetch` (HTML → readable text, images) |
| Subagents | `task` — parallel explore/general subagents with fresh context, optional cheaper model |
| Computer use | screenshots + mouse/keyboard (Windows SendInput, xdotool, cliclick) — opt-in, vision models only |
| MCP | stdio MCP servers, tools exposed as `mcp__server__tool` |
| Interaction | `ask_user` (inline question cards), `todo_write` (live plan), long-term `memory` |
| Multimodal | paste/drag images, `view_image`, screenshots; images auto-dropped for non-vision models |
| Context | live context meter, auto-compaction at a threshold, manual `/compact [focus]`, overflow recovery |
| Cost | per-request token + USD accounting (incl. cached input), per-session budget, usage by day/model, live Refuseless balance |
| Models | live catalogs, pricing overrides, reasoning-effort picker (`off/low/high/max`), `<think>` splitting |

## Permission ladder
`Plan` (read-only) → `Ask` → `Auto-edit` → `Auto` → `Full access`. Shift+Tab cycles (never into Full access).
In every mode except **Full access**, guards force a prompt for: risky commands (recursive deletes, force pushes, `curl | sh`, registry/firewall edits, sudo, publishing…), secret files (`~/.ssh`, cloud creds, `.env`, browser profiles, keychains…), and writes outside the workspace. "Always allow" never overrides a guard.

## Privacy & security
- No telemetry. Keys encrypted with the OS keychain (`safeStorage`).
- Secret redaction on all tool output (API keys, tokens, private keys, connection strings, dotenv secrets, your configured keys).
- Prompt-injection fencing: web/MCP output wrapped in `<untrusted_content>`; the model is told never to follow it.
- Optional session encryption at rest, incognito sessions (never written to disk), domain allow/block lists.
- Local audit log of every tool call, decision and guard hit. One-click wipe of all local data.
- Electron hardening: sandboxed renderer, context isolation, strict CSP, IPC sender validation, all web permissions denied, no `<webview>`.

## Keys
`Ctrl+K` palette · `Ctrl+N` new · `Ctrl+Shift+N` incognito · `Ctrl+J` theme · `Ctrl+B` sidebar · `Ctrl+.` inspector · `Ctrl+,` settings · `Shift+Tab` mode · `Esc` stop.
Slash: `/plan /compact /clear /incognito /fork /model /mode /init /memory /export /cost /settings`.

Project instructions are read from `AGENTS.md`, `VESPER.md`, `CLAUDE.md`, `.cursorrules` at the workspace root.

Signing up through the in-app flow uses a referral link that helps fund Vesper's development.
