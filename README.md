<p align="center">
  <img src="assets/icon.png" width="96" alt="Vesper" />
</p>

<h1 align="center">Vesper</h1>

<p align="center">
  <b>A desktop coding agent for long-running work.</b><br/>
  Built around <a href="https://refuseless.com/?ref=dwqxpimh">Refuseless</a>' hosted open-weight models, and works with any OpenAI-compatible provider.
</p>

<p align="center">
  <a href="../../releases/latest">Download</a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="#features">Features</a> ·
  <a href="#privacy--security">Privacy &amp; security</a> ·
  <a href="#building-from-source">Build from source</a>
</p>

---

Vesper is an agent that works on your own machine with real tools. It reads and edits files, runs commands, searches the web, hands work to subagents and can operate the desktop. It is made for long sessions: there is no step cap, the context compacts itself as it fills, cost is tracked to the token, and you can keep talking to it while it works.

## Download

Installers for every release are on the **[Releases page](../../releases/latest)**:

| Platform | File |
|---|---|
| Windows 10/11 (x64, ARM64) | `Vesper-<version>-win-<arch>.exe` |
| macOS 12+ (Apple Silicon, Intel) | `Vesper-<version>-mac-<arch>.dmg` |
| Linux (x64) | `Vesper-<version>-linux-x86_64.AppImage` or `.deb` |

> The builds are not code-signed yet. On Windows, SmartScreen may warn you: choose **More info → Run anyway**. On macOS, right-click the app and choose **Open** the first time. On Linux, `chmod +x` the AppImage before running it.

## Quick start

1. Install and open Vesper.
2. On the welcome screen, either:
   - **Create a Refuseless account.** Signup runs inside Vesper in a sandboxed browser. When you create an API key, Vesper detects it, verifies it and shows your balance.
   - **Use an existing Refuseless key** (it starts with `abl_`).
   - **Use a different provider:** OpenAI, Anthropic, OpenRouter, DeepSeek, Groq, Together, Mistral, Ollama, LM Studio, or any OpenAI-compatible URL.
3. Pick a model and a permission mode, choose a project folder, and describe what you want built.

## Features

### Agent
| | |
|---|---|
| **Files** | `read_file`, `write_file`, `edit_file`, atomic `multi_edit`, `list_dir`, `glob`, `grep` (uses ripgrep when installed). Every edit shows a diff and can be reverted on its own or for the whole turn. |
| **Shell** | PowerShell 7, Windows PowerShell or bash, with live output, timeouts and background jobs (`shell_output`). |
| **Web** | `web_search` (DuckDuckGo, Brave or Tavily) and `web_fetch` (pages converted to readable text). |
| **Subagents** | `task` runs parallel research or general subagents, each with a fresh context. They can use a cheaper model. Their cost counts toward the session. |
| **Computer use** | Screenshots plus mouse and keyboard control (Windows SendInput, xdotool, cliclick). Opt-in, and only with vision models. |
| **MCP** | Connect stdio MCP servers; their tools appear as `mcp__server__tool`. |
| **Interaction** | `ask_user` question cards, a live `todo_write` plan, and long-term `memory` across sessions. |
| **Multimodal** | Paste or drop images. Screenshots and `view_image` also feed images in, and they are dropped automatically for models without vision. |

### Long-running by design
- **No step cap.** A turn runs until the work is done. A loop detector stops a run that repeats the same call with the same result, and you can set an optional step limit.
- **Talk to it while it works.** Messages sent during a run are **queued** and go out when it finishes. You can edit them in place, pull them back into the composer (↑ recalls the last one), or hit **Send now** to deliver one at the agent's next step without stopping it.
- **Readable transcripts.** Each turn's thinking, tool calls, intermediate replies and mid-run messages fold into one collapsible **work block**, with the final answer underneath.
- **Self-recovery.** Replies cut off by the output limit continue automatically. A model that thinks without acting is nudged to act. A run interrupted by closing the app resumes cleanly. Approvals survive a reload.
- **Context management.** A live context meter, automatic compaction at a threshold you choose, manual `/compact [focus]`, and recovery when the context overflows.

### Cost & models
- Per-request token and USD accounting, including cached input. Usage is tracked per session, per day and per model, with an optional per-session budget.
- Live model catalogs, price overrides and a reasoning-effort picker (`off / low / high / max`).
- Live Refuseless credit balance in the title bar, warnings when it runs low, and one-click top-up.

### Refuseless lineup
Refuseless serves open-weight models through an OpenAI-compatible API. Every model has a 1M-token context and adjustable reasoning effort. Vesper loads the live list and adds prices. Prices below are USD per 1M tokens (input / cached / output) at the time of writing; check refuseless.com for current prices.

| Model | Price | Good for |
|---|---|---|
| `glm-5.3-abliterated` | 1.25 / 0.25 / 2.25 | Hardest, longest agentic tasks |
| `kimi-k3.1-pro` | ~0.25 / 0.15 / 2.50 | Frontier open model with vision |
| `glm-5.3-flash-abliterated` | 0.25 / 0.15 / 0.80 | Everyday coding, sees images |
| `deepseek-v4.1-flash-abliterated` | 0.22 / 0.045 / 0.75 | Built for coding agents; Vesper's default |
| `deepseek-v4.1-flash-fast` | 0.05 / 0.003 / 0.15 | Subagents and bulk work; Vesper's default subagent model |
| `minimax-m3.1-flash` | 0.05 / 0.002 / 0.25 | Very long generations |

## Permission modes
`Plan` (read-only) → `Ask` → `Auto-edit` → `Auto` → `Full access`. Shift+Tab cycles through the modes, but never into Full access.

In every mode except **Full access**, guards always ask before:
- risky commands: recursive deletes, force pushes, `curl | sh`, registry and firewall edits, `sudo`, publishing;
- reading or writing secret files: `~/.ssh`, cloud credentials, `.env`, browser profiles, keychains;
- writing outside the workspace.

"Always allow" never overrides a guard.

## Privacy & security
- **No telemetry, no analytics.** Requests go only to the providers you configure and the sites the agent visits.
- API keys are encrypted with the OS keychain (`safeStorage`).
- **Secret redaction** on all tool output: API keys, tokens, private keys, connection strings, dotenv secrets and your own configured keys are removed before the model sees them.
- **Prompt-injection fencing:** web and MCP output is wrapped as untrusted content, and the model is told never to follow instructions inside it.
- Optional **session encryption at rest**, **incognito sessions** that never touch disk, and domain allow and block lists.
- A local **audit log** of every tool call, decision and guard hit, plus one-click wipe of all local data.
- Electron hardening: sandboxed renderer, context isolation, strict CSP, IPC sender validation, every web permission denied, no `<webview>`, and a single instance per profile.

## Keyboard
`Ctrl+K` palette · `Ctrl+N` new session · `Ctrl+Shift+N` incognito · `Ctrl+J` theme · `Ctrl+B` sidebar · `Ctrl+.` inspector · `Ctrl+,` settings · `Shift+Tab` mode · `Esc` stop · `↑` recall the last queued message. (Use `⌘` on macOS.)

Slash commands: `/plan /compact /clear /incognito /fork /model /mode /init /memory /export /cost /settings`.

Vesper follows project instructions in `AGENTS.md`, `VESPER.md`, `CLAUDE.md` or `.cursorrules` at the workspace root.

## Building from source

Requires Node.js 20+.

```bash
git clone <this repository>
cd vesper
npm install
npm start            # run the app (npm run dev opens DevTools)
npm run check        # offline self-test: agent loop, tools, security policy (mock provider)
```

Build installers locally:

```bash
npm run dist:win     # NSIS installer (x64 + ARM64)
npm run dist:mac     # DMG (arm64 + x64), must run on macOS
npm run dist:linux   # AppImage + .deb
```

**Releases:** push a tag like `v0.2.0`. GitHub Actions (`.github/workflows/release.yml`) builds all three platforms and attaches the installers to a draft release. Review the draft, then publish it.

Other scripts: `npm run icons` re-renders `assets/icon.png` / `icon.ico` from `assets/icon.svg`. `npm run shortcut` adds Desktop and Start menu shortcuts for a source checkout on Windows.

### Layout
```
main/         Electron main process: window, IPC, agent loop, providers, security, storage
main/tools/   fs, shell, web, computer use, MCP client
renderer/     UI (vanilla ES modules, no build step)
assets/       icons and logos
scripts/      self-test, icon renderer, shortcut helper, CDP dev driver
```

## Data location
Settings, sessions, usage and the audit log are stored in your user data folder:
`%APPDATA%\Vesper\vesper` (Windows), `~/Library/Application Support/Vesper/vesper` (macOS) and `~/.config/Vesper/vesper` (Linux). **Settings → Privacy & security → Wipe** removes everything.

## Supporting the project
The in-app signup and the top-up buttons use a referral link ([refuseless.com/?ref=dwqxpimh](https://refuseless.com/?ref=dwqxpimh)). Signing up through it supports Vesper's development at no extra cost to you.

## Disclaimer
Vesper is an independent open-source project. It is **not affiliated with, endorsed by or sponsored by Refuseless**. The Refuseless name and logo appear in Vesper's setup flow with the owner's permission, and remain their property. You are responsible for how you use the models and tools Vesper gives you access to.

## License
[MIT](LICENSE)
