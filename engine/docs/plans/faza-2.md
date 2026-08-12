# Faza 2 — PWA shell 1:1 — plan wykonawczy

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.
> Subagenty frontendowe: model **Fable 5** (zasada Kacpra). Zadania 3–6 równoległe
> po ukończeniu Taska 2 — interfejsy pinowane niżej. Subagenty NIE commitują.

**Goal:** Messenger-UI 1:1 z Grok Botem (UI-SPEC §1–4, §12): sidebar botów, czat,
flow tworzenia bota z avatar pickerem, szkielet prawego panelu. Gate PLAN.md §5:
Playwright smoke (create bot → send message → see reply) + zgodność layoutu z UI-SPEC.

**Architecture:** `ui/` = Vite + React 19 + TS + Tailwind v4 + `@nous-research/ui@0.18.2`
(scaffold z WEB-RECON.md — Task 1). Dane z naszego FastAPI (port 8700, proxy dev `/api`).
Stan: React Context + fetch (wzorzec hermesa, bez bibliotek stanu). Streaming — faza 3;
tu chat non-stream (POST → reply).

**Tech Stack:** react-router 8, lucide-react, cn() z utils.ts, Markdown.tsx (skopiowany),
@playwright/test do smoke.

## Global Constraints

- ZAKAZ zapisu na C:. `PLAYWRIGHT_BROWSERS_PATH=D:\tmp\pw-browsers` przed
  `npx playwright install chromium`. npm cache na D:.
- Kolory/layout z UI-SPEC (frame-verified): tło near-black, sidebar ~230px jaśniejszy
  panel, chat fluid (bubbles max ~560px), right panel ~280px; akcent niebieski
  (focus/unread/NEW), zielony = connected/working, bąbelki bota #2a2a2a-ish, usera
  o stopień jaśniejsze. Dokładne hexy = luka §14.4 — brać najbliższe z tokenów DS
  hermesa, odnotować w LOOP.md.
- Luki §14 (avatar picker, global settings, group chat) NIE blokują — najbliższy
  odpowiednik z klatek; group chat poza fazą 2.
- Komponenty DS z `@nous-research/ui` zamiast pisania własnych (button, input, dialog,
  badge, switch, toast...). Ikony lucide.
- Pliki komponentów < ~300 linii; podział per odpowiedzialność.

---

### Task 1: Scaffold ui/ (W TOKU — osobny subagent)

Vite + deps + skopiowane pliki hermesa (index.css, fonty, utils, Markdown,
ChatSessionList, chatImagePaste, events-reconnect) + build zielony. Patrz WEB-RECON.md.

### Task 2: Shell 3-kolumnowy + theme + API client

**Files:** `ui/src/App.tsx`, `ui/src/layout/Shell.tsx`, `ui/src/lib/api.ts`, `ui/src/lib/types.ts`

**Interfaces (PINOWANE — konsumują Taski 3–6):**
- `types.ts`: `Bot = {id:string; name:string; title:string; description:string; created_at:string; avatar?:{shape:string; color:string}}`; `ChatMessage = {role:"user"|"assistant"|"system"; content:string; ts?:string}`
- `api.ts` (~50 linii, fetch): `listBots(): Promise<Bot[]>`, `createBot(b:{id:string;name:string;title?:string;description?:string;avatar?:Bot["avatar"]}): Promise<Bot>`, `updateBot(id, fields): Promise<Bot>`, `deleteBot(id)`, `sendChat(id, message): Promise<{reply:string; session_id:string}>`, `setProvider(id, cfg)`. Endpointy z server/app.py (`/api/bots`...).
- `Shell.tsx`: grid `[230px_1fr_280px]`, slots `sidebar`/`main`/`panel`; panel
  zwijany (toggle ikoną monitora w headerze czatu); mobile (<768px): sidebar jako
  drawer, panel jako overlay — proste CSS, bez routera stanu.
- Kontekst `BotsProvider` (lista botów + selectedBotId + refresh) w `App.tsx`.

**Steps:** komponenty → `npx tsc --noEmit` czysto → `npm run build` zielony →
weryfikacja wizualna: `npm run dev` + screenshot (Playwright headless) 3 kolumn.

### Task 3: Sidebar (UI-SPEC §2)

**Files:** `ui/src/components/Sidebar.tsx`, `ui/src/components/BotRow.tsx`, `ui/src/components/BotAvatar.tsx`

**Interfaces:**
- Consumes: `BotsProvider`, `Bot`, `BotAvatar`.
- `BotAvatar({avatar, size=36, working=false})` — flat colored glyph: ~7 rodzin
  kształtów (hexagon/drop/triangle/blob/kwadrat/kółko/gwiazda — SVG inline z tiny
  eyes jak UI-SPEC §12), kolor z palety saturowanej; `working` = pulsująca animacja
  CSS. PINOWANE: Task 5 (picker) i 4 (chat header) używają tego samego komponentu.
- Wygląd wiersza: avatar 36px + name (white semibold) + role tag pill (gray bg,
  z `title`) + preview line (gray, truncated) + timestamp top-right + blue unread
  dot + green working dot na avatarze. Top: `+` po prawej, search field (rounded,
  dark, magnifier). Bottom: `Plugins` row (puzzle) + user row (initials avatar).
  Preview/timestamp/unread: na razie z ostatniej lokalnej wiadomości lub puste —
  bez backendu historii (faza 3).

### Task 4: Czat (UI-SPEC §3)

**Files:** `ui/src/components/ChatView.tsx`, `ui/src/components/MessageBubble.tsx`, `ui/src/components/Composer.tsx`

**Interfaces:**
- Consumes: `api.sendChat`, `Markdown.tsx` (streaming prop — tu bez streamu),
  `BotAvatar`, `chatImagePaste.ts` (podpiąć do composera, attachmenty no-op faza 2).
- Stan wiadomości: lokalny `useState<ChatMessage[]>` per bot (Map w BotsProvider);
  persystencja historii = faza 3 (hermes ma ją w state.db — nie duplikować).
- Bąbelki: bot left dark max-w-[560px] markdown; user right jaśniejszy; krótkie
  (<20 znaków) user = mały chip. Centered system events (gray, small). Date header
  `Today 12:40 PM`. Scroll-to-new pill (`↓ N new messages ✕`, niebieski) gdy
  scroll nie na dole. Hover na bąblu: 😀 ↩ ⋯ (wizualnie; akcje no-op, faza 7+).
- Composer: rounded pill, `+` z lewej, placeholder `Message <BotName>`, mic z
  prawej (no-op do fazy 10), strzałka send pojawia się gdy tekst. Enter=send,
  Shift+Enter=newline. Podczas oczekiwania na reply: status "**<Bot> is working**"
  pod ostatnią wiadomością + `working` na avatarze.
- Chat header: avatar + name + ikona monitora (toggle right panel).

### Task 5: Tworzenie bota + avatar picker (UI-SPEC §2 `+`, §12, luka §14.1)

**Files:** `ui/src/components/NewBotDialog.tsx`, `ui/src/components/AvatarPicker.tsx`

**Interfaces:**
- Consumes: `api.createBot`, `BotAvatar`, dialog z `@nous-research/ui`.
- `+` w sidebarze → dialog: Name, Title ("Describe what your agent does"),
  Description (multiline), AvatarPicker = grid 7 kształtów × paleta kolorów
  (kliknięcie = podgląd dużego avatara; luka §14.1 — najbliższy odpowiednik,
  odnotować w LOOP.md). `id` = slug z name (lowercase, `[a-z0-9-]`, walidacja jak
  backend). Submit → createBot → select nowego bota → toast błędu przy 409/422.
- Avatar w `bot.json` przez pole `avatar` (backend update_bot przyjmuje dowolne
  fields — sprawdzone; jeśli create_bot nie przyjmuje `avatar`, dopisać PATCH po
  create — decyzja implementującego, zanotować).

### Task 6: Right panel szkielet (UI-SPEC §4)

**Files:** `ui/src/components/RightPanel.tsx`, `ui/src/components/BotSettings.tsx`

**Interfaces:**
- Consumes: `BotsProvider`, `api.updateBot`, `api.deleteBot`, switch/input z DS.
- Header: gear + ✕. Sekcje: **Computer** — placeholder `<Bot>'s screen` (szary
  prostokąt, "Coming in phase 4"); **Routines** — caption + `Create Routine`
  button (disabled, faza 6) + pusta lista.
- **BotSettings** (gear → ‹ Settings ✕): duży avatar, inputy Name/Title/Description
  (zapis onBlur przez updateBot), toggle Notifications (no-op, zapis w bot.json),
  Delete bot (confirm dialog → deleteBot → wróć do pustego stanu).

### Task 7: Gate fazy 2 — Playwright smoke + visual check

**Files:** `ui/e2e/smoke.spec.ts`, `ui/playwright.config.ts`, Modify: `README.md`, `LOOP.md`

- [ ] `npm i -D @playwright/test`; `$env:PLAYWRIGHT_BROWSERS_PATH="D:\tmp\pw-browsers"; npx playwright install chromium`.
- [ ] Config: webServer odpala backend (uvicorn, SLAFY_DATA_DIR=D:\tmp\slafy-e2e-ui,
  mock LLM jak w tests/test_gate_faza1.py) + `npm run dev`; baseURL vite.
- [ ] Test: otwórz app → klik `+` → wypełnij Name "Smoke Bot" → wybierz avatar →
  Create → bot w sidebarze → wpisz wiadomość → send → reply z mocka widoczny w
  bąblu bota → screenshot `ui/e2e/artifacts/shell.png`.
- [ ] Visual check vs UI-SPEC: 3 kolumny ~230/fluid/~280, dark theme, bąbelki
  side'y i szerokość — asercje bounding-box w teście (tolerancja ±20px).
- [ ] Wszystkie testy repo zielone (pytest + playwright). Odhacz w LOOP.md wiersze
  §2 pokryte: #1 (częściowo — bez collapsed sidebar), #2 (avatar picker bez
  upload/generate — odnotuj), luki. FAZA: 3. Commit + push.
