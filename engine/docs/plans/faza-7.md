# Faza 7 — Multi-agent (inter-bot, group chaty) — plan wykonawczy

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.
> Backend: **Opus 5**; frontend: **Fable 5**. Task 1 → Task 2 (backend) + Task 3
> (frontend) równolegle. Subagenty NIE commitują. Fakty: docs/HERMES-FACTS.md §10
> (delegate_tool: DELEGATE_BLOCKED_TOOLS zawiera send_message; send_message_tool
> dla bot→bot; kanban swarm dla orkiestracji).

**Goal (gate PLAN.md §5 fazy 7):** "Bot A delegates to Bot B by description;
group chat assigns ownership". UI-SPEC §3 (@mention roster, system events
"Messaged ●X"), §5 (inter-bot threads read-only), #33-36 z §2.

**Architecture:** Inter-bot = bot A woła bota B po opisie. Hermes delegate_tool
blokuje send_message w subagentach (izolacja), więc delegacja między PEŁNYMI
botami (nie subagentami) idzie naszą warstwą: `@bot` w czacie albo delegacja po
opisie routuje przez nasz serwer, który woła gateway.chat drugiego bota i zapisuje
inter-bot wątek (read-only dla usera). Group chat = pokój z wieloma botami; nasz
serwer zarządza kolejnością/ownershipem (prosty: round-robin albo router-bot),
bo Hermesowy kanban swarm to cięższa maszyneria niż potrzeba na start. Transparency
(#34): gdy bot B odpowiada na ping bota A, event trafia do czatu A.

## Global Constraints

- ZAKAZ C:. Nie psuć ~86 testów + 4 specy Playwright.
- Inter-bot wątki widoczne dla usera jako read-only (UI-SPEC §5).
- Delegacja: bez nieskończonych pętli (bot A → B → A → ...); limit głębokości.

---

### Task 1 (Opus 5): warstwa inter-bot + delegacja po opisie

**Files:** Create: `server/interbot.py`; Modify: `server/app.py`; Test: `tests/test_interbot.py`

**Interfaces (PINOWANE):**
- `interbot.delegate(from_bot, to_bot, message, depth=0) -> dict` — {reply, thread_id}; woła gateway.chat(to_bot, message z kontekstem "od <from_bot>"); zapisuje wymianę w inter-bot thread; limit depth (np. 3) → RuntimeError.
- `interbot.route_by_description(from_bot, task) -> str` — dopasuj bota po `title`/`description` (proste: match słów kluczowych taska do opisów innych botów; ponytail: bez embeddingów, keyword overlap; upgrade = embeddingi). Zwróć bot_id albo None.
- `interbot.list_threads(bot_id) -> list[dict]`, `interbot.get_thread(thread_id) -> dict` (wiadomości read-only).
- Mention `@bot` w czacie: parser w chat endpoint — jeśli message ma `@<name>`, wciągnij bota do wątku (route + delegate). Zdecyduj: rozszerz POST /chat albo osobny endpoint; opisz.
- Threads w `$SLAFY_DATA_DIR/interbot/<thread_id>.json` (stdlib json) albo w hermes_state (jeśli prościej — zbadaj). 
- TDD: delegate A→B (mock gateway.chat per bot) → thread zapisany, reply wraca; route_by_description dopasowuje bota po opisie; limit depth rzuca; list/get threads.

### Task 2 (Opus 5): group chat + ownership + transparency events

**Files:** Modify: `server/app.py`, `server/interbot.py`; Test: `tests/test_groupchat.py`

**Interfaces (PINOWANE — UI Taska 3):**
- `POST /api/groups {name, bot_ids: list} -> {id, name, bot_ids}` — pokój grupowy (zapis w groups.json).
- `GET /api/groups`, `GET /api/groups/{id}`, `POST /api/groups/{id}/chat {message} -> {turns: [{bot_id, reply}], owner: bot_id}` — router: wyślij do botów, zbierz odpowiedzi, wyznacz ownera (bot którego opis najlepiej pasuje albo pierwszy — prosty; UI-SPEC §2 "assign ownership"). 
- WS eventy (rozszerz istniejący pub-sub z fazy 3): {"type":"interbot","from_bot","to_bot","thread_id"} (transparency #34 — pokazuje w czacie A "Messaged ●B"), {"type":"group","group_id","bot_id","msg"}.
- `GET /api/bots/{id}/interbot` → interbot.list_threads (do UI §5).
- Delegacja po opisie w group chat: bot dostaje zadanie, może przekazać innemu (route_by_description) — ownership przechodzi.
- TDD: create group, group chat zwraca tury wielu botów + ownera; inter-bot event emitowany; endpoint threads.

### Task 3 (Fable 5): UI multi-agent (@mention, inter-bot thread, group chat)

**Files:** Create: `ui/src/components/InterbotThread.tsx`, `ui/src/components/NewGroupDialog.tsx`; Modify: `ui/src/components/Composer.tsx` (@ roster), `ui/src/components/ChatView.tsx` (system events, inter-bot), `ui/src/lib/api.ts`, `ui/src/App.tsx` (group jako "bot" w liście albo osobna sekcja)

- Composer @ roster (UI-SPEC §3): wpisanie `@` → popup lista botów (avatar+name+"Agent") + pluginy ("Gmail — connected", label "Plugin"); wybór wstawia `@name`. Reuse listPlugins z fazy 5.
- ChatView: system event "Messaged ●<Bot>" / "Message from ●<Bot>" (centered gray, UI-SPEC §3) z WS eventu interbot; klik otwiera InterbotThread.
- InterbotThread (UI-SPEC §5): header `● BotA ✕ ● BotB` chipy, footer "Read-only conversation between two agents"; lista wiadomości (reuse MessageBubble, bez composera).
- NewGroupDialog: `+` w sidebarze → menu "New Bot" / "New Group Chat" (UI-SPEC §9 mobile ma to; desktop dodaj); grupa = wybór botów → POST /api/groups; grupa w liście sidebara (ikona zbiorcza) → group chat view.
- Gates: tsc + build zielone.

### Task 4: Gate fazy 7

**Files:** Test: `tests/test_gate_faza7.py`

- Scenariusz A (delegacja po opisie): bot A "Router" + bot B "Researcher" (opis
  "szuka informacji"). A dostaje zadanie badawcze → route_by_description wskazuje
  B → delegate A→B → reply wraca, inter-bot thread zapisany, event transparency
  wyemitowany. Asercja: B wybrany PO OPISIE, nie po nazwie.
- Scenariusz B (group ownership): grupa z 3 botów → group chat → tury wielu botów
  + wyznaczony owner. Asercja: owner ustawiony, wiadomości od różnych botów.
- Pełny pytest + specy Playwright zielone. LOOP.md: #33 (bot→bot po opisie),
  #34 (transparency event), #35 (chief-of-staff = router bot), #36 (context
  sharing — jeśli nie pełne, zanotuj). FAZA: 8.
