# MultiBot

**One private workspace for a fleet of AI bots.**

MultiBot runs on your device or VPS. Give every bot its own name, model,
memory, routines, browser computer, skills, and connected tools. Use the same
workspace from desktop, phone, or any browser through the authenticated PWA.

> MultiBot is an independent MIT-licensed fork. The historical OpenMausBot
> name remains only in migration paths and internal data directories so existing
> installations do not lose profiles or transcripts.

![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![Node](https://img.shields.io/badge/Node-24+-339933?logo=node.js&logoColor=white)
![Platforms](https://img.shields.io/badge/platforms-Windows%20%C2%B7%20macOS%20%C2%B7%20Linux%20%C2%B7%20Termux-1084fe)
![License](https://img.shields.io/badge/license-MIT-38d591)

## What you get

| Capability | MultiBot behavior |
|---|---|
| Bot fleet | Named bots in one roster; pin, hide, duplicate, rename, and delete them like chats |
| Provider choice | Claude Code, Codex, Grok, Gemini, Kimi Code, Qwen Code, and custom OpenAI-compatible endpoints |
| Custom models | Enter key, base URL, and model id once; the model appears in the top picker |
| Language | English/Polish selector in App Settings, persisted per browser |
| Agent work | Streaming replies, tools, approvals, questions, files, screenshots, and interruptions |
| Memory | Engine-backed facts, graph, markdown view, and retrieval per bot |
| Routines | Cron/manual runs for every selected driver; engine routines also support webhooks |
| Skills | Reusable skills, enable/disable, editing, deletion, and teach-a-task for engine bots |
| Bot groups | `+` → `New group`; select bots and open one shared room |
| Computers | One persistent browser per bot plus one shared browser profile, with live takeover |
| Tools | MCP servers, Composio connectors, plugins, and per-bot permissions |
| Remote use | Token-protected HTTP/WS, one-origin PWA, mobile layout, and Tailscale HTTPS path |
| Always-on server | Windows startup task, Linux systemd, Docker, or Android Termux service |

Full inventory and current limits: [`docs/FEATURES.md`](docs/FEATURES.md).

## Quick start

The repository is private. Authenticate GitHub once before cloning. Every server
generates an access token on first start, prints it once, and stores it locally.
You do not create a token manually.

### Windows PowerShell

Requires Git, Node.js 24+, and pnpm. The packaged path installs a per-user
server task; source mode is better for development.

```powershell
git clone https://github.com/clewkord/multibot.git
Set-Location multibot
corepack enable
pnpm install --frozen-lockfile
pnpm dev:server    # harness → http://127.0.0.1:8799
pnpm dev           # UI → http://127.0.0.1:5199
```

For packaged always-on server:

```powershell
pnpm install:server:windows
Start-Process http://127.0.0.1:8799
```

### macOS

```sh
git clone https://github.com/clewkord/multibot.git
cd multibot
corepack enable
pnpm install --frozen-lockfile
pnpm dev:server & pnpm dev
```

Build desktop package with `pnpm package`. Native dictation requires Electron
and macOS microphone/speech permissions.

### Linux / VPS

Docker path:

```sh
git clone https://github.com/clewkord/multibot.git
cd multibot
bash scripts/install-linux.sh --mode docker
```

No Docker, systemd user service:

```sh
bash scripts/install-linux.sh
```

### Android / Termux

Install Termux and Termux:Boot, then run:

```sh
pkg install -y git openssh
git clone https://github.com/clewkord/multibot.git
cd multibot
bash scripts/install-termux.sh
```

Chat, workspace memory, routines, skills, and PWA shell work on Termux. The
Playwright browser computer is unavailable on Android. CLI installation is
automatic after selection; each provider login stays interactive in its own
terminal (OAuth/subscription credentials never pass through MultiBot).

### Remote HTTPS

Keep harness and engine on loopback. For phone access from another device, use
Tailscale:

```sh
tailscale serve --bg --yes http://127.0.0.1:8799
```

Plain `http://192.168.x.x` can serve chat, but browser security rules disable
service-worker installation and microphone access. HTTPS or `localhost` gives
the full PWA path.

## Development

```sh
pnpm install --frozen-lockfile
pnpm dev:engine    # Python engine → 127.0.0.1:8700
pnpm dev:server    # Node harness → 127.0.0.1:8799
pnpm dev           # React/Vite UI → 127.0.0.1:5199
```

The engine uses `engine/.venv` in development. See [`MULTIBOT.md`](MULTIBOT.md)
for Python/Hermes setup, environment variables, data paths, and installers.

## Security model

- Engine always binds to loopback; only harness is network boundary.
- HTTP and both WebSocket upgrade paths require bearer token.
- API keys are write-only and stay in local config; never API responses, logs,
  commits, or issue reports.
- Static login assets and health are public; protected API requests return `401`.
- First remote deployment should use HTTPS/Tailscale, not unauthenticated LAN.

## Working with teammate

Use short-lived branches and pull requests. Keep `main` releasable:

```sh
git switch main
git pull --ff-only origin main
git switch -c feat/<name>-<topic>
pnpm typecheck && pnpm test && pnpm build
git push -u origin HEAD
gh pr create --base main --fill
```

Detailed ownership, conflict, secrets, and review rules live in
[`docs/TEAM-WORKFLOW.md`](docs/TEAM-WORKFLOW.md) and [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Compare alternatives

See [`docs/COMPARISON.md`](docs/COMPARISON.md) for sourced capability table
against Hermes Agent, OpenClaw, and Grok (xAI). Short version: MultiBot is the
workspace layer; Hermes is embedded agent runtime; OpenClaw is messaging
gateway; Grok is hosted assistant.

## Project status

End-to-end path works: bot → streamed agent turn → tools → approval →
browser/computer → transcript. Current release includes custom models,
authenticated remote access, PWA install, groups, routines, memory, skills,
onboarding, and one-command server installers.

Known limits stay explicit: group rooms currently use shared engine transport
for CLI shadows; engine-only Memory/Skills are not fabricated for CLI bots;
native store apps and arbitrary MCP OAuth are separate work.

## License

[MIT](LICENSE) © 2026 MultiBot contributors.
