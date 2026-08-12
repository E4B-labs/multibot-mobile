# Faza 6 — Rutyny (cron + triggery + webhook) — plan wykonawczy

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.
> Backend: **Opus 5**; frontend: **Fable 5**. Task 1 → Task 2 (backend) + Task 3
> (frontend) równolegle. Subagenty NIE commitują. Fakty: docs/HERMES-FACTS.md §7
> (cron per profil, `cron/jobs.py::create_job`, gateway tickuje co 60 s;
> `gateway/platforms/webhook.py` = generic webhook adapter, HMAC).

**Goal (gate PLAN.md §5 fazy 6):** "Scheduled routine fires with app closed;
webhook trigger fires". UI-SPEC §4 (Routines section + Routine detail), §13
(routine detail filled), #29-32 z §2.

**Architecture:** Rutyny = cron joby Hermesa per profil (`~/.hermes/cron/jobs.json`
profilu, wykonanie: ticker w gatewayu co 60 s — więc "z zamkniętą apką" = nasz
serwer trzyma gateway żywy). Triggery = gotowy `gateway/platforms/webhook.py`
Hermesa: włączamy platformę `webhook` w config roota, routy per rutyna
(`platforms.webhook.extra.routes`), sekret HMAC. Nasz serwer: REST nad cron jobami
(create/list/update/delete/run-now) proxy do `hermes cron` albo `cron/jobs.py`
przez HERMES_HOME profilu + endpoint rejestracji webhooka. Zero własnego
schedulera — Hermes ma cały.

## Global Constraints

- ZAKAZ C:. Gateway żywy = wykonanie z zamkniętym UI; nasz serwer nie ubija
  gatewaya po chacie (już tak jest — ensure_running idempotentny).
- Sekret webhooka HMAC, nigdy w repo/logach.
- Nie psuć dotychczasowych testów.

---

### Task 1 (Opus 5): warstwa rutyn (cron per profil) + webhook

**Files:** Create: `server/routines.py`; Modify: `server/gateway.py`; Test: `tests/test_routines.py`

**Interfaces (PINOWANE):**
- `routines.list(bot_id) -> list[dict]` — {id, name, schedule, prompt, enabled, trigger?, last_runs: list}. Czyta cron jobs profilu (import `cron.jobs` z HERMES_HOME profilu albo subprocess `hermes -p <bot> cron list --json` — wybierz pewniejsze na Windows; zbadaj `hermes_cli/cron.py`).
- `routines.create(bot_id, name, prompt, schedule=None, trigger=None) -> dict` — `cron.jobs.create_job` (schedule 5-polowy cron lub interwał; trigger = webhook route). PINOWANE pola z HERMES-FACTS §7.
- `routines.update(bot_id, id, **fields)`, `routines.delete(bot_id, id)`, `routines.run_now(bot_id, id) -> dict` (akcja run z `cronjob` tool / `hermes cron run`).
- `routines.enable_webhook_trigger(bot_id, routine_id, events) -> {url, secret}` — dopisz route do `platforms.webhook.extra.routes` w config roota (webhook adapter jest globalny), route odpala prompt rutyny; zwróć URL `/<nasz_host>/webhooks/<id>` i sekret HMAC. Włącz platformę webhook w config roota (ensure_running).
- TDD: create routine w profilu → cron jobs.json profilu ma wpis → list zwraca → update zmienia → delete usuwa; enable_webhook_trigger dopisuje route + zwraca sekret.

### Task 2 (Opus 5): REST rutyn + webhook inbound

**Files:** Modify: `server/app.py`; Test: `tests/test_routines_api.py`

**Interfaces (PINOWANE — UI Taska 3):**
- `GET /api/bots/{id}/routines` → routines.list
- `POST /api/bots/{id}/routines {name, prompt, schedule?, trigger?}` → create (201)
- `PATCH /api/bots/{id}/routines/{rid}`, `DELETE .../{rid}`
- `POST /api/bots/{id}/routines/{rid}/run` → run_now (zwraca wynik/handle)
- `POST /api/bots/{id}/routines/{rid}/webhook` → enable_webhook_trigger → {url, secret}
- `POST /webhooks/{rid}` — inbound: zweryfikuj HMAC (nagłówek), odpal prompt rutyny przez gateway.chat (albo bezpośrednio cron run), 200. To jest nasz generic webhook (możemy proxy do webhook adaptera Hermesa albo obsłużyć wprost — wybierz prostsze; jeśli Hermes webhook adapter słucha na swoim porcie, proxy; jeśli łatwiej samemu policzyć HMAC i odpalić rutynę, zrób to). Opisz decyzję.
- TDD: create routine przez API, run-now, webhook enable → POST /webhooks/{rid} z poprawnym HMAC odpala (mock gateway.chat, sprawdź wywołanie), zły HMAC → 401.

### Task 3 (Fable 5): panel rutyn + detal (UI-SPEC §4, §13)

**Files:** Create: `ui/src/components/RoutinesSection.tsx`, `ui/src/components/RoutineDetail.tsx`; Modify: `ui/src/components/RightPanel.tsx`, `ui/src/lib/api.ts`

- RightPanel Routines section (dziś disabled placeholder) → żywa lista:
  caption "Routines are recurring tasks this agent runs on a schedule",
  `Create Routine` button + `+`; rows: zielona kropka + name + schedule/trigger
  line ("Every day at 9:01 AM", "On any message in #channel").
- RoutineDetail (UI-SPEC §13): ‹ back + "Routine" + ✕; `Active` toggle,
  `Delete`, `Test run` (blue filled) buttons; pola Name, Instruction (multiline);
  "When to run": trigger row + `+ Add another`; "Run history": lista last_runs
  albo "No runs yet".
- Create flow: `Create Routine` → formularz (name, instruction, schedule picker
  — prosty: cron string albo presety "codziennie o HH:MM"/"co N godzin";
  ponytail: bez pełnego cron builder) → POST. Test run → POST run → pokaż wynik.
  Webhook trigger: przycisk "Add trigger" → enable_webhook → pokaż URL+secret do
  skopiowania (UI-SPEC §4 trigger row).
- Gates: tsc + build zielone.

### Task 4: Gate fazy 6

**Files:** Test: `tests/test_gate_faza6.py`

- Scenariusz A (scheduled fires app-closed): utwórz rutynę z interwałem ~sekundowym
  (albo cron na najbliższą minutę), uruchom gateway (bez UI), poczekaj na tick,
  sprawdź że job się wykonał (output w cron/output profilu albo wpis w
  hermes_state) — "z zamkniętą apką" = tylko gateway, żadnego klienta web.
  Jeśli czekanie na realny tick za wolne/kruche: użyj run_now jako dowodu
  wykonania + osobno asercja że jobs.json ma wpis schedulowany (ticker Hermesa
  jest jego przetestowanym kodem — nie retestujemy cudzego schedulera; dowodzimy
  że NASZA rutyna trafia do jego mechanizmu). Opisz wybór.
- Scenariusz B (webhook fires): enable webhook trigger → POST /webhooks/{rid} z
  poprawnym HMAC → rutyna odpala (asercja wywołania). Zły HMAC → 401.
- Pełny pytest + specy Playwright zielone. LOOP.md: #29-32 (odhacz: #29
  konwersacyjne tworzenie — jeśli tylko formularz, zanotuj; #30 schedule+trigger;
  #31 rekomendacje rutyn — faza 13; #32 cloud/app-closed). FAZA: 7.
