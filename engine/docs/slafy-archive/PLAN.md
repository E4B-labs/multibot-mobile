# slafy-bot — open-source Grok Bot, master plan

> Working name: **slafy-bot** (finalną nazwę potwierdza Kacper w KROKU 0 GOAL.md — nic z "Grok", znak towarowy xAI).
> Status: PLANNING. Nic nie budujemy, dopóki Kacper nie zatwierdzi.
> **For agentic workers:** this is the master spec. Each build phase gets its own
> implementation plan generated at build time via `superpowers:writing-plans`,
> executed via `superpowers:subagent-driven-development`. Phase 0 produces the
> facts (Hermes stack, UI reference) that per-phase plans depend on.

## TL;DR (PL)

Robimy open-source klon **Grok Bota** (xAI/Cursor, premiera 11.08.2026) na bazie
**Hermes Agent** (Nous Research, MIT). Rdzeń pomysłu: **1 Bot = 1 profil Hermesa
(config.yaml + SOUL.md + memory_store.db) + 1 "komputer" + 1 obecność w UI**.
Hermes daje za darmo: runtime, providerów, pamięć, skille, cron, gateway,
learning loop, self-hosting od $5 VPS po telefon. My dopisujemy warstwę
produktową: messenger-UI 1:1, komputery botów, teach-a-task, pluginy z OAuth,
triggery, group chaty, graf pamięci, głos, migrację z Hermesa. Budowa: pętla
Claude Code (jedna komenda, wiele bramkowanych iteracji, weryfikacja po każdej
sekcji), nie dosłowny "one shot".

---

## 1. What Grok Bot is (research, 2026-08-12)

xAI + Cursor product, launched Aug 11 2026, early beta. "AI teammates": named,
always-on agents, each with its own cloud computer, messaged like coworkers in
an iMessage-style app. Pricing: SuperGrok Heavy $300/mo, Cursor Ultra $200/mo,
Cursor Teams Premium $120/seat/mo; weekly usage allowance + token-billed
overage. Desktop (macOS/Win/Linux) + iOS; **no Android, no self-hosting, no
model choice, no live voice** — those four gaps are our wedge.

Sources: official announcement (x.ai/news/introducing-grok-bot), kingy.ai
launch explainer, unite.ai, 6 YouTube videos (Nate Herk PQBYZQqan2g, Grok
F1_0Lkp16Rc, Paul Lipsky QTcZPI-g7is, Alex Finn lc6hKU4BdsA, Riley Brown
8Yf9IoXkROM, Ray Fernando livestream sAoTrUijP4g). Cleaned transcripts with
timestamps: `D:\tmp\watch-hermes\*.clean.txt` — **copy into repo at Phase 0,
they are the 1:1 behavioral reference.**

## 2. Feature contract (the 1:1 checklist)

Every row must exist in the clone and behave identically. Citations =
video-id timestamp. This table is the acceptance checklist for the build loop.

### App shell / UI
| # | Feature | Source |
|---|---------|--------|
| 1 | Messenger-style app: bot list sidebar (left), chat (center), collapsible right panel with Settings / Computer / Routines tabs | Nate 1:00, Paul 0:01, Riley 3:03 |
| 2 | Bot identity: name, title, one-liner description; avatar = shape + color picker, generate-from-description, or upload image | Nate 5:00 |
| 3 | Creation animation; avatar animates while bot is working; collapsed sidebar shows avatars with hover tooltips | Riley 1:01, 12:01 |
| 4 | New chat with one or MANY bots; `@bot` mention pulls another bot into an ongoing chat | Paul 0:01, 1:01 |
| 5 | Group chats: bots coordinate alone, pass work, assign ownership, pull user in only for judgment calls | Riley 18:02, official |
| 6 | Cmd+K switcher: agents, full message search, groups filter, files, routines, shared-links list | Riley 17:00–18:02 |
| 7 | Desktop + mobile, everything synced real-time, same features on both; pick up same thread on either surface | Nate 13:01, Paul 8:02 |
| 8 | Dictation (speech-to-text) button in composer | Paul 11:01 |
| 9 | Bot onboarding interview ("What do you mainly want me around for?"); reverse-prompt: bot recommends tools to connect, tasks, routines | Nate 3:00, Alex 8:00 |
| 10 | Usage meter in settings (% used weekly, resets in 7 days) | Nate 16:00 |
| 11 | Settings: theme, timezone, execution on local computer toggle, permission rules (ask-every-time / auto-allow / never-allow per action) | Nate 16:00 |
| 12 | Approvals: bot works autonomously, returns ONLY when something needs approval; sensitive actions routed through review | official, kingy |

### Computer
| # | Feature | Source |
|---|---------|--------|
| 13 | Each bot has its own persistent computer: browser, terminal, file manager, desktop; logins persist between sessions | Nate 1:00, Riley 8:01 |
| 14 | Live view of bot's screen + "take over" control (also from phone); human handoff for passwords/CAPTCHA ("Take over" → "I'm done, continue") | Nate 1:00, Paul 5:01 |
| 15 | Bot can serve localhost apps on its computer; screenshots posted to chat as it works | Riley 9:01–10:00 |
| 16 | Optional execution on the user's local computer instead of the bot's | Nate 16:00, 17:02 |
| 17 | Browser-first: operates sites with no API/MCP; per-bot browser sessions, per-bot separate accounts possible | official, Ray 46:xx |

### Teach-a-task / skills
| # | Feature | Source |
|---|---------|--------|
| 18 | "Teach a task" button records a user demonstration on the bot's computer → bot summarizes into a reusable skill | Nate 1:00, Alex 2:00 |
| 19 | Skills invoked as `/slash` commands; shared across ALL bots; editable (name/description/instructions); deletable | Nate 11:01, 18:00 |
| 20 | Skill self-improvement: dry-run offer, post-run self-critique, bot edits its own skill without being asked | Nate 6:01–7:01 |
| 21 | Bot asks clarifying questions (multiple-choice style) before running new skills | Alex 4:01 |

### Plugins (connectors)
| # | Feature | Source |
|---|---------|--------|
| 22 | Plugin marketplace: browse, search; in-chat OAuth authorize cards; one-time setup | Nate 3:00–4:00, Riley 2:00 |
| 23 | Plugins shared across all bots (connect once, all bots use it); computers stay per-bot | Nate 12:01, Riley 7:00 |
| 24 | Multiple accounts per service (e.g. "default" + "work" Slack) | Nate 9:01 |
| 25 | `@plugin` mention in chat; bot auto-suggests connecting a plugin mid-conversation when the task needs it | Riley 6:00, Paul 6:03 |
| 26 | Custom plugins installable | Nate 18:00, Ray 5:02 |
| 27 | Launch set includes: Gmail, Google Calendar, Google Drive, Slack, Notion, GitHub, ClickUp, Linear, Teams, Sentry, PagerDuty, Vercel, Cloudflare, Remotion, Revolut, Revel | Nate, Riley, Ray |
| 28 | If no plugin exists, bot falls back to doing it in the browser | Ray 5:02, Paul 5:01 |

### Routines (automations)
| # | Feature | Source |
|---|---------|--------|
| 29 | Routines created conversationally ("run this weekdays 7am") or manually (+ button); listed in right panel per bot; editable instructions; past runs; "run one now" sample | Nate 4:00, Paul 8:02, Alex 7:01 |
| 30 | Schedule-based AND trigger-based; launch triggers: Slack message, GitHub event, Teams message, Linear issue, Sentry alert, PagerDuty incident | Nate 7:01, Riley 16:00 |
| 31 | Bot recommends routines to create ("what routines should we make?") | Alex 7:01 |
| 32 | Routines run in the cloud even with user's devices off | Nate 4:00 |

### Multi-agent
| # | Feature | Source |
|---|---------|--------|
| 33 | Bots message each other by name; delegation by matching other bots' descriptions; user sees view-only inter-bot threads | Nate 2:00, 12:01–13:01 |
| 34 | Transparency: a bot tells you when another bot asked it something (no secrets) | Nate 13:01 |
| 35 | Chief-of-staff pattern: one router bot delegates to specialists | Paul 10:01, official |
| 36 | Context sharing on request ("ask Barry what he already did") instead of re-explaining | Alex 5:00 |

### Memory / learning
| # | Feature | Source |
|---|---------|--------|
| 37 | Persistent per-bot memory: conversations, preferences, edge cases; gets sharper with use | official, Nate 7:01 |
| 38 | External knowledge base ingest (GitHub repo as "second brain"); shared context for new bots | Nate 2:00 |

## 3. Our additions (Kacper's asks)

| ID | Addition | Approach |
|----|----------|----------|
| A | Self-host on any machine incl. old Android phone, with built-in browser | PWA UI + tiered computer backends (see §4); Termux install path like hermes-config setup |
| B | Multi-provider: custom API keys (OpenAI, Anthropic, xAI, OpenRouter, Groq, local/Ollama) + subscription OAuth where officially supported | Hermes already has the provider layer (`hermes model`). Subscription OAuth (ChatGPT/Claude/Grok plans) = per-provider adapters, **shipped behind a ToS-warning flag: reusing subscription tokens outside official clients risks account bans; API-key path is the default** |
| C | Migration from Hermes Agent | Near-free thanks to the core mapping: importer reads existing profile (config.yaml + SOUL.md + memory_store.db + cron defs) → creates a Bot |
| D | Many + custom connectors | Plugin layer = **MCP standard** (instant ecosystem of hundreds of servers) + OAuth broker + **generic webhook trigger** (beats Grok Bot's 6 launch triggers) |
| E | Obsidian-like memory graph per bot | Force-directed graph (Cytoscape.js or D3) over the per-profile memory store; entities/facts as nodes, links as edges; click-through to facts |
| F | Voice | Baseline: Web Speech API in the PWA (free, works on any device = parity with Grok Bot's dictation). Upgrade: whisper.cpp small model server-side for self-hosted STT. Live voice mode = post-v1 (Grok Bot doesn't have it either) |
| G | Bots improve with use, talk to each other, per-bot RAG memory | Hermes learning loop (skill creation after 3+ attempts, self-refinement) + inter-bot bus (§4) + per-profile SQLite FTS5 (+ embeddings when >needed) |

## 4. Architecture

**Core mapping (the one sentence everything hangs on):**
`1 Bot = 1 Hermes profile (config.yaml + SOUL.md + memory_store.db) + 1 computer + 1 UI presence.`

Hermes Agent (MIT, github.com/NousResearch/hermes-agent) supplies: agent
runtime, provider abstraction, profile system, persistent memory (SQLite FTS5),
skills (agentskills.io standard), cron scheduler, multi-platform gateway
(Telegram/Discord/Slack/WhatsApp/Signal/CLI), 6 terminal backends
(local/Docker/SSH/Daytona/Singularity/Modal), voice memo transcription.

New layers (the delta we build):

1. **Web UI (PWA)** — messenger-style, pixel-close to Grok Bot; one codebase
   covers desktop, Android, old phones, iOS-via-browser; optional
   Electron/Tauri wrapper later. Realtime sync via WebSocket to the server.
2. **Sync server** — thin API over Hermes profiles: bot CRUD, chats, presence
   ("working" animation state), routines, usage metering.
3. **Computer abstraction, tiered** (slots into Hermes' terminal-backend
   abstraction):
   - **Tier 1 (desktop/VPS host):** per-bot Docker container or Playwright
     persistent browser context; live view + take-over via CDP screencast or
     noVNC; persistent cookies/logins per bot.
   - **Tier 2 (old phone host):** shared headless browser (or Android WebView),
     no per-bot VM; honest degradation, same API.
4. **Plugin layer** — MCP client + OAuth broker + marketplace UI; connections
   stored globally (shared across bots), multi-account per service.
5. **Trigger engine** — generic inbound webhook + adapters (Slack events,
   GitHub webhooks, …) feeding the routine scheduler.
6. **Inter-bot bus** — message passing between profiles with viewable
   threads, delegation by description matching, group chat rooms.
7. **Memory graph viz** — per-bot graph view over memory store.
8. **Teach-a-task** — ⚠ hardest novel feature, own phase: record user
   demonstration in the bot's browser (DOM events + screenshots/video) → LLM
   synthesizes a skill file → dry-run → self-critique loop (feature #20).
9. **Provider/auth layer** — BYOK default + flagged subscription adapters (B).
10. **Importer** — Hermes profile → Bot (C).

## 5. Build phases (each ends as working software)

| Phase | Deliverable | Gate (must pass to advance) |
|-------|-------------|------------------------------|
| 0 | Recon: clone hermes-agent, document stack + profile format + gateway API in `docs/HERMES-FACTS.md`; UI reference → `docs/UI-SPEC.md` — **v2 DONE 2026-08-12** (~250 klatek 1024px z 5 filmów w `docs/reference/frames-hd/` + katalog `docs/reference/FRAMES-INDEX.md`; zostały tylko luki z UI-SPEC §14: avatar picker, global settings, group chat, hex/font) | `HERMES-FACTS.md` exists; UI-SPEC gaps §9 closed |
| 1 | Core server: embedded Hermes runtime, bot CRUD (profile manager), provider layer BYOK | Create bot via API, chat with it, restart survives |
| 2 | PWA shell 1:1: sidebar, chat, bot creation flow + avatar picker, right panel skeleton | Playwright smoke: create bot, send message, see reply; visual diff vs UI-SPEC |
| 3 | Realtime: WebSocket sync, working-state animations, mobile layout | Two clients see the same thread live |
| 4 | Computer Tier 1: per-bot browser + live view + take-over + persistent logins | Log into a site by take-over, bot continues session after restart |
| 5 | Plugins: MCP client, OAuth broker, marketplace UI, shared-across-bots + multi-account | Connect Gmail via chat card, second bot uses it without reconnect |
| 6 | Routines: conversational creation, panel UI, cron + trigger engine + generic webhook | Scheduled routine fires with app closed; webhook trigger fires |
| 7 | Multi-agent: inter-bot messages, view-only threads, delegation, group chats, chief-of-staff | Bot A delegates to Bot B by description; group chat assigns ownership |
| 8 | Memory: per-bot RAG, learning loop wiring, **memory graph viz (E)** | Fact stored in chat is recalled next session; graph renders and navigates |
| 9 | Teach-a-task: demonstration recording → skill synthesis → dry-run → self-critique | Recorded 3-step browser task replays successfully as a skill |
| 10 | Voice (F): composer dictation + whisper.cpp option | Dictated message sent from phone browser |
| 11 | Hermes migration (C): importer CLI + UI | Real hermes-agent profile imports; memory searchable in-app |
| 12 | Old-phone target (A): Termux install script, Tier 2 computer, perf pass | Full app runs on Android/Termux; documented |
| 13 | Polish: Cmd+K, files tab (better than Grok's broken one), usage meter, permission rules + approval review, onboarding interview, settings | Feature-matrix audit: every row §2 checked off |

## 6. The build loop ("gauntlet")

Honest framing: **one command, many gated iterations** — not one context
window. Unattended one-shot without per-section verification produces garbage;
the gates are what make autonomy real.

Mechanics:
- `LOOP.md` in repo root: current phase, next task pointer, decisions log.
- Runner: `claude -p` in a loop (or `/loop` dynamic mode) on a spare terminal.
  Each iteration: fresh context → read `PLAN.md` + `LOOP.md` + phase plan →
  execute next task(s) TDD-style → run gate checks (unit tests + Playwright
  smoke + relevant §2 matrix rows) → update `LOOP.md` → commit + push (repo on
  clewkord GitHub → auto-push rules apply, secret scan before every push).
- Per-phase implementation plans generated inside the loop with
  `superpowers:writing-plans`; tasks executed with
  `superpowers:subagent-driven-development` (subagents on Opus 5 per Kacper's
  standing rule).
- Failure policy: gate fails twice → loop stops and reports instead of
  thrashing.
- Budget: this is days of runtime and real token spend; phases 0–3 first, then
  review checkpoint with Kacper before unleashing 4–13.

## 7. Risks / honesty

- **Teach-a-task (#18–20)** — hardest novel engineering; nobody ships an OSS
  version of this well yet. Own phase, may slip.
- **Per-bot computers** — resource-heavy; on a $5 VPS expect 2–3 bots with
  browsers, not 10. Tier 2 phone mode = shared browser by design.
- **Subscription OAuth (B)** — ToS ban risk; shipped flagged, API keys default.
- **Trademark** — no "Grok" in product name. Final name = Kacper's call.
- **1:1 pixel fidelity** — needs Kacper's screenshots + video frames (Phase 0);
  transcripts alone describe layout, not pixels.

## 8. Needed from Kacper (non-blocking, before Phase 0)

1. Product name (folder renames trivially).
2. Screenshots of Grok Bot screens he has access to (creation flow, chat,
   computer view, plugins, routines panel, settings, mobile).
3. GitHub repo location (clewkord/...) — creates it or I do at Phase 0.
4. Confirm budget appetite for the loop (token spend, VPS for Tier 1 testing).
