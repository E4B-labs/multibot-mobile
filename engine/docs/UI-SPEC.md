# UI-SPEC v2 — Grok Bot interface, frame-verified

Sources: 1024px frames in `docs/reference/frames-hd/<video>/` (scene + transcript-cue),
512px overview set in `docs/reference/frames/`, transcripts in `docs/reference/*.clean.txt`.
Videos: Nate Herk = Windows build, Paul Lipsky + Riley Brown = macOS build, official
intro = product shots. Cue frames cited as `video/cue_NNNN`.
Every claim below is read off an actual frame unless marked (transcript).

## 1. Shell

Three-column messenger, dark theme. Windows: custom title bar with – □ ✕. macOS:
native menu bar, app name **Grok Bot**, traffic lights inside sidebar top (riley/cue_0002).

```
┌────────────┬──────────────────────────────┬──────────────┐
│ SIDEBAR    │ CHAT                         │ RIGHT PANEL  │
│ ~230px     │ fluid, bubbles max ~560px    │ ~280px       │
└────────────┴──────────────────────────────┴──────────────┘
```

- Background near-black; sidebar slightly lighter panel; bubbles dark-gray
  (#2a2a2a-ish); user bubbles a step lighter than bot bubbles.
- Accent blue (links, NEW divider, focus rings, unread dots, scroll-to-new pill).
- Green = success/connected/active-routine dot. Red-pink monospace chips for
  code/paths/channels (`#youtube-testing-nate`, `/invite @Cursor`, `python -m
  http.server 5173`) — nate/cue_0019.

## 2. Sidebar

(nate/cue_0011, riley/cue_0002, paul/cue_0003)
- Top row: `+` (new chat) right; macOS keeps traffic lights here.
- Search field: rounded, dark, magnifier.
- Bot row: avatar 36px (colored glyph) + name (white semibold) + **role tag pill**
  next to name (gray bg, e.g. `EA`, `AI Engineer`, `Morning Planner`, `My leader`,
  `Build Apps and Stuff`, `LinkedIn`) + preview line (gray, truncated) + timestamp
  top-right (gray) + blue unread dot (nate/cue_0017) + green online/working dot on
  avatar (riley/cue_0002).
- Working bot: avatar animates; "**Klaus is working**" status line under last
  message in chat (nate/cue_0017); "New Agent is working" (riley/cue_0002).
- Bottom: `Plugins` row (puzzle icon) + user row (initials avatar + full name).
- **User menu popup** (click user row; nate/cue_0018): `Weekly usage 2% ›` (submenu:
  "Weekly usage — Resets in 7 days — 2%", "On-demand — Spend this cycle — $0/$200",
  "Change limit"), `Get Grok Bot for iOS`, `Settings`, `About`, `Help Center`,
  `Send Feedback`, separator, `Log out`.

## 3. Chat thread

(nate/cue_0011,0013,0014,0019; paul/cue_0003,0006; riley/cue_0004,0015)
- Bot messages: left, dark bubbles, rich markdown (numbered lists, bullets, bold).
- User messages: right, lighter bubbles; short confirmations render as small chips
  (`yes`, `Hey there`).
- Hover actions on bubble edge: 😀 react, ↩ reply, ⋯ more (nate/cue_0013, paul/cue_0006).
- Centered system events, small gray: `Renamed to Money`, `Created routine 🕓 Morning
  day plan`, `Messaged ● Dev`, `Message from ● Money`, `2 messages with ● Klaus`,
  `NEW` blue divider, date headers (`Today 12:40 PM`).
- Scroll-to-new floating pill bottom-center: `↓ 6 new messages ✕` blue (nate/cue_0011).
- Onboarding Q&A: bot question bubble contains embedded reply field / option rows
  (`7:00am / 8:00am / 9:00am`); chosen answer shows as grayed chip with ✓
  (nate/cue_0011); answers editable via pencil (riley/cue_0004).
- Inline plugin card: icon + name + description + tools count (`53 tools`, `19 tools`)
  + green `✓ Added` (riley/cue_0004); connect card pair → OAuth in default browser →
  `Authorization complete! You can close this tab.`
- **Computer card** (paul/cue_0006): rounded card, header `Computer` + green pill
  `⚙ Action needed`, caption (`Sign in to LinkedIn, then hand it back`), live
  browser screenshot, buttons `Take over` (filled) / `I'm done` (outline) / `Skip`.
- `🖥 Learn from demonstration` chip after teach recording (paul/cue_0011).
- Composer: rounded pill, `+` left, `Message <Bot>` / `Ask <Bot>` placeholder, mic
  right; send arrow appears when text present (riley/cue_0004). `@` popup roster
  (paul/cue_0011): sections Agents (avatar + name + `Agent` label) then Plugins
  (`Gmail — connected`, `Notion — needs auth`, label `Plugin`).

## 4. Right panel

(nate/cue_0013, riley/cue_0013,0015,0016)
- Header icons: settings gear + ✕ close; panel toggled by monitor icon in chat header.
- **Computer section**: `<Bot>'s screen` thumbnail, live; hover `⤢ Open` (paul/cue_0011).
- **Routines section**: caption "Routines are recurring tasks this agent runs on a
  schedule", `Create Routine` button, `+`; rows: green dot + name + schedule/trigger
  line (`Every day at 9:01 AM`, `On any message in #longform-videos`).
- **Routine detail** (riley/cue_0016): ‹ back + `Routine` + ✕; `Active` toggle,
  `Delete`, `Test run` buttons; fields `Name`, `Instruction` (multiline); `When to
  run`: trigger row (`⨳ New messages in shor-form-videos`) + `+ Add another`;
  `Run history`: `No runs yet`.
- **Bot settings** (nate/cue_0011, paul/cue_0016): ‹ `Settings` ✕; large avatar;
  `Name` input; `Title` ("Describe what your agent does"); `Description` ("What this
  agent is for", multiline); `Notifications` toggle — "Get notified when this agent
  finishes or needs input".

## 5. Inter-bot threads

(riley/cue_0013)
- Header: `● Developer ✕ ● Content Agent` chips; footer caption:
  **"Read-only conversation between two agents"**.
- Entered by clicking `Messaged ●X` / `Message from ●X` events.
- Transparency: bot reports being pinged by another bot in its own chat (transcript
  nate 13:01).

## 6. Cmd+K palette

(riley/cue_0020,0021)
- Centered modal: search field top; tabs `All | Messages | Agents | Groups | Files |
  Links | Routines | Actions`.
- All tab: agent rows (avatar + name + tag + one-line description, right label
  `Agent`), then action rows (`Chat Settings — Current chat`, `Settings: General`,
  right label `Action`).
- Files tab: paper-plane icon + `No files yet` (feature present, empty at launch).

## 7. Plugins

(nate/cue_0020, riley/cue_0006, 512px nate 46 / paul 27)
- Modal: `Plugins` title, tabs `Marketplace` | `Yours`, filter icon, `Search plugins`.
- Marketplace: sections (`Featured`, `Agent Orchestration`, **`MCP`**), 2-col grid:
  icon + name + 1-line description + `Add` / green `✓ Added`.
- Confirmed entries: Gmail, Google Calendar, Google Drive, Granola, Notion, Slack,
  Arize, Atlan, AWS Agents, AWS SageMaker, Browserbase Browse, Composio, Context7,
  Twilio, Vantage, Vercel, WorkOS, Zscaler, 1Password, Agent Compatibility,
  AgentMail, Aikido, AMD, Apollo.io, AtScale, Ashby, Auth0, Linear, **Create Plugin**
  (scaffold custom). Descriptions confirm plugins = MCP servers + skill packs
  ("…via Google's remote MCP server", "Slack MCP server…", "1Password Developer
  Environments for Cursor: MCP…").
- `Yours` tab: `Installed` list — icon + name + `1 connector` (+ `· 6 skills`) +
  green `Connected`; below, per-skill rows with enable **toggles** and "Use when…"
  descriptions (nate/cue_0020).
- Multi-account: conversational flow "What should I call this second Slack account?"
  (nate/cue_0014) — named connections (default/work).

## 8. Computer view

(512px nate 44/46, paul 31/32; paul/cue_0006)
- Window: light-gray gradient wallpaper, dock bottom-center (Chrome, display
  settings, terminal), `Teach a task` top-right.
- Teach mode: red border, title `New Bot is watching and learning`; finish →
  `The recording is finished. Lear…` + `Learn from demonstration` chip + skill
  created (slash-command, shared across bots).
- Live screenshots stream into chat as cards; localhost apps runnable on bot's
  computer (riley 512 frames 10:00).

## 9. iOS app

(paul/cue_0013,0014; nate/cue_0016; riley/cue_0012)
- List view: `PL` initials top-left, search + `+` top-right; rows identical to
  desktop sidebar (avatar, name, tag, preview, time, blue dot).
- `+` menu: `New Bot` / `New Group Chat`.
- Chat: ‹ back + avatar + name + monitor icon (opens/takes over bot computer from
  phone); composer `+ Ask <Bot> 🎙`; voice dictation produces long transcribed
  bubbles (riley/cue_0012).
- Official intro shows playful emoji-avatar bots on phone (users can upload/generate
  any avatar).

## 10. Voice

- Composer mic = dictation (all platforms). Official intro (F1_0Lkp16Rc/cue_0004):
  active voice pill = green waveform bars + collapse ^ + stop ■, placeholder
  `Ask anything`. No live conversation mode at launch (transcript paul 11:01).

## 11. Onboarding

(512px nate 10; transcripts alex 0:02, nate 3:00)
- Full-screen black wizard: `Give each Bot a job` heading, big glyph, `Next` (white
  pill) / `Back` (dark pill) stacked bottom-center. First bot pre-created with a
  name (e.g. "Slate" — alex).
- Post-create, bot self-onboards in chat: "What do you want me around for? Work
  stuff, personal admin, research, coding, something…" (paul/cue_0016) + asks
  follow-ups, proposes plugins to connect, proposes first routine + sample run.

## 12. Avatars & branding

- Bot avatars: flat colored glyphs — hexagon (orange), drop (blue/green), triangle
  (green/purple), blob (red/pink/brown) with tiny eyes; ~7 shape families, saturated
  palette. Generate-from-description or upload also supported (transcript nate 5:00).
- Product glyph: white robot face on light-blue rounded card; tagline "A new kind
  of colleague".
- Fun creation animation (transcript riley 1:01).

## 13. Attention & handoff states (alex/cue_0000,0012,0013)

- Sidebar bot status lines replace preview when bot is blocked: `Waiting for you:
  Sign in to T…` with **orange dot** on row.
- Right panel **"Needs your attention"** card (orange header): instruction
  (`Sign in to Tella (Google or email), then hand back`) + `Skip this step` /
  `I'm done, continue` buttons.
- Human 2FA handoff: bot posts screenshot of 2-Step Verification prompt in chat
  ("approve 93 on your iPhone, then hand it back and I'll keep editing").
- First-run: brain-dump onboarding — user pastes self-description, bot summarizes
  ("Saving that so I remember"), proposes highest-leverage first connection (Gmail),
  embedded option chips with ✎ edit (`Something else first`, `App / Academy growth`).
- Routine detail filled example (alex/cue_0012): Name `Weekly video → X /
  newsletter / Skool`; long multiline Instruction with URLs; When to run `Every
  Tuesday at 9:00 AM` + `+ Add another`; `Test run` = blue filled button.
- User profile row can show plain email (`finna27@gmail.com`).
- Inter-agent header chips also `Slate ⇄ Barry ✕` (alex/cue_0010).

## 14. Still missing (Kacper screenshots / build-time)

1. Avatar picker UI itself (shape+color grid) — transcript-only.
2. Global Settings screen (theme, timezone, local execution, permission rules).
3. Group chat multi-bot thread view (feature gated at launch; Groups tab exists).
4. Exact hex palette + font (looks like Inter/SF; confirm) — needs lossless PNG.
