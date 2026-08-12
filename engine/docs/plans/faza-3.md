# Faza 3 — Realtime — plan wykonawczy

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.
> Backend: subagenty **Opus 5**; frontend: **Fable 5**. Task 1 (backend) najpierw —
> Taski 2-3 równolegle po nim. Subagenty NIE commitują.

**Goal:** Dwóch klientów widzi ten sam wątek na żywo (gate PLAN.md §5 fazy 3):
WebSocket sync, historia z backendu (nie lokalny Map), stany "working" na żywo,
layout mobilny. UI-SPEC §2 (working bot), §7 (desktop+mobile synced).

**Architecture:** Nasz FastAPI dostaje: (a) GET /api/bots/{id}/messages — historia
przez gateway Hermesa (`/p/<bot>/api/sessions/<sid>/messages`, sid z bot.json);
(b) WS /api/ws — prosty pub-sub w pamięci procesu (starlette WebSocket, zero
zależności): eventy `{type: "message", bot_id, msg: ChatMessage}` i
`{type: "working", bot_id, working: bool}`, emitowane z endpointu chatu.
Frontend: klient WS z backoffem z `events-reconnect.ts` (już skopiowany);
BotsProvider konsumuje eventy zamiast być jedynym źródłem. Wzorce z WEB-RECON §Realtime.
`ponytail:` pub-sub w pamięci jednego procesu — multi-worker/Redis dopiero gdy
będzie potrzebny drugi proces.

## Global Constraints

- ZAKAZ C:. Testy jak dotąd (D:\tmp, HERMES_HOME jawnie).
- Streaming odpowiedzi LLM token-po-tokenie NIE wchodzi w fazę 3 (osobno przy
  szlifie) — "live" znaczy: pełne wiadomości + stany working pushowane do
  wszystkich klientów natychmiast.
- Nie psuć istniejących 19 testów + smoke Playwright.

---

### Task 1 (backend, Opus 5): historia + WS pub-sub

**Files:** Modify: `server/app.py`, `server/gateway.py`; Test: `tests/test_realtime.py`

**Interfaces (PINOWANE):**
- `GET /api/bots/{id}/messages -> list[{role, content, ts}]` (mapowanie z formatu
  wiadomości gatewaya; pusta lista gdy brak sesji).
- `WS /api/ws` — server→client JSON: `{"type":"message","bot_id":str,"msg":{"role":str,"content":str,"ts":str}}`
  | `{"type":"working","bot_id":str,"working":bool}`. Client→server: nic (read-only).
- Chat endpoint emituje: working=true przed wywołaniem gatewaya, message(user),
  potem message(assistant) + working=false (także przy błędzie — working=false).
- Moduł: `server/app.py` — zbiór `_ws_clients: set[WebSocket]` + `async def _broadcast(event: dict)`;
  bez osobnego pliku.

**TDD:** test WS przez fastapi.testclient (websocket_connect): connect dwóch
klientów → POST chat (mock gateway monkeypatch) → obaj dostają working/message
eventy w kolejności; test /messages z zamockowanym httpx.

### Task 2 (frontend, Fable 5): WS klient + historia w BotsProvider

**Files:** Modify: `ui/src/App.tsx`; Create: `ui/src/lib/ws.ts`

**Interfaces:**
- `ws.ts`: `connectEvents(onEvent: (e: WsEvent) => void): () => void` (zwraca
  disconnect; reconnect backoffem z `events-reconnect.ts`; URL `/api/ws` przez
  vite proxy `ws: true` — już ustawione).
- `WsEvent = {type:"message";bot_id:string;msg:ChatMessage} | {type:"working";bot_id:string;working:boolean}`.
- BotsProvider: + `working: Set<string>` w kontekście (PINOWANE — Task 3 używa);
  na select bota bez historii: fetch `/api/bots/{id}/messages` → seed Map;
  eventy WS: message → addMessage (dedup: pomiń jeśli identyczna treść+rola co
  ostatnia lokalna — echo własnego POST), working → set/unset.
- ChatView: usuń lokalny stan working (Set z kontekstu); sendChat zostaje
  (odpowiedź przyjdzie też po WS — dedup w providerze).

### Task 3 (frontend, Fable 5): working-animacje + mobile layout

**Files:** Modify: `ui/src/components/Sidebar.tsx`, `ui/src/components/BotRow.tsx`, `ui/src/layout/Shell.tsx`; Create: `ui/src/components/MobileNav.tsx` (jeśli potrzebny)

**Interfaces:** Consumes `working: Set<string>` z useBots().
- BotRow: working bot → avatar pulsuje (BotAvatar working prop) + status line
  "<Name> is working" zamiast preview (UI-SPEC §2).
- Mobile (<768px): sidebar = pełny ekran listy (jak iOS UI-SPEC §9), klik bota →
  widok czatu z ‹ back w headerze; panel = overlay. Breakpoint w Shell już jest —
  dopracować nawigację (stan "który ekran" w App, bez routera).

### Task 4: Gate fazy 3

**Files:** Test: `ui/e2e/realtime.spec.ts`; Modify: `LOOP.md`, `README.md`

- Playwright: dwa konteksty przeglądarki (dwie karty) na tym samym backendzie →
  w karcie A wyślij wiadomość → w karcie B wątek pokazuje user+assistant bez
  odświeżania (expect z timeoutem); working indicator pojawia się w B w trakcie.
- Pełny pytest + oba specy Playwright zielone. Checklista §2: #7 (część desktop
  sync), #37 (historia z hermes_state przez UI). FAZA: 4.
