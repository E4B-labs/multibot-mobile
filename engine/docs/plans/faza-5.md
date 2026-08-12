# Faza 5 — Pluginy (MCP + marketplace + współdzielenie) — plan wykonawczy

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.
> Backend: **Opus 5**; frontend: **Fable 5**. Task 1 → Task 2 (backend) i Task 3
> (frontend) równolegle. Subagenty NIE commitują. FUNDAMENT: docs/reference/MCP-RECON.md
> — przeczytać W CAŁOŚCI. Hermes ma kompletny klient MCP + OAuth 2.1/DCR — NIE piszemy
> tego, tylko warstwę współdzielenia + katalog + UI.

**Goal (gate PLAN.md §5 fazy 5):** "Connect Gmail via chat card, second bot uses
it without reconnect". UI-SPEC §7 (marketplace modal, tabs Marketplace/Yours,
karty OAuth), #22-28 z §2.

**Architecture:** Pluginy = zdalne serwery MCP z natywnym OAuth/DCR (decyzja z
recon — omija broker OAuth dla usług). Współdzielenie między botami: jeden wspólny
`mcp_servers` w `$SLAFY_DATA_DIR/plugins.json` + wspólny katalog tokenów
`$SLAFY_DATA_DIR/mcp-tokens/` podpięty do każdego profilu przez junction
(`profiles/<bot>/mcp-tokens` → wspólny). Nasz serwer rozprowadza `mcp_servers` na
config.yaml każdego profilu (idempotentny merge, wzorzec `_ensure_browser_config`).
Marketplace = własny katalog manifestów w repo. mcp_oauth_manager reloaduje tokeny
po mtime, więc drugi bot widzi grant bez reconnectu.

## Global Constraints

- ZAKAZ C: (junction/symlink na Windows: `os.symlink` wymaga uprawnień — użyj
  junction przez `_winapi`/mklink lub katalog z kopiowaniem+mtime; wybierz
  działające bez admina, opisz).
- Nie psuć 43 pytest + 4 specy Playwright.
- Sekrety pluginów w tokenach 0600, nigdy w repo/logach.

---

### Task 1 (Opus 5): warstwa współdzielenia MCP + rozprowadzanie configu

**Files:** Create: `server/plugins.py`; Modify: `server/gateway.py`; Test: `tests/test_plugins.py`

**Interfaces (PINOWANE):**
- `plugins.list_installed() -> list[dict]` — {name, url, transport, connected: bool, accounts: list[str]} ze wspólnego `$SLAFY_DATA_DIR/plugins.json`.
- `plugins.install(name, spec: dict) -> dict` — dopisz do plugins.json (spec: url/transport/auth/tools.include...); rozprowadź do wszystkich profili (merge do `mcp_servers` w config.yaml).
- `plugins.remove(name)`, `plugins.set_account(name, account_label)` (duplikat wpisu pod `<name>-<label>` dla multi-account).
- `plugins.ensure_shared_tokens(bot_id)` — podepnij `profiles/<bot>/mcp-tokens` do wspólnego katalogu (junction/mtime-sync); wołane przy create_bot i w gateway.chat (jak `_ensure_browser_config`).
- Rozprowadzanie: przy install/remove przejdź po `bots.list_bots()` i zmerguj `mcp_servers` do każdego config.yaml; nowy bot dostaje pełen zestaw przy tworzeniu.
- TDD: install serwer MCP (mock: lokalny serwer MCP stdio echo albo HTTP) → plugins.json ma wpis → dwa profile mają go w config.yaml → wspólny token widoczny z obu (utwórz plik w shared, sprawdź przez junction obu profili).

### Task 2 (Opus 5): REST pluginów + karta OAuth w czacie

**Files:** Modify: `server/app.py`; Test: `tests/test_plugins_api.py`

**Interfaces (PINOWANE — UI Taska 3 konsumuje):**
- `GET /api/plugins` → list_installed. `GET /api/plugins/catalog` → nasz katalog manifestów (`docs/plugins-catalog/*.yaml` lub `server/plugins_catalog/`).
- `POST /api/plugins/install {name}` (z katalogu) → install + zwróć {oauth_url?: str} jeśli serwer wymaga OAuth (użyj flow Hermesa — zbadaj `hermes mcp login`/`mcp_dashboard_oauth.py`, wystaw URL startu).
- `DELETE /api/plugins/{name}`, `PUT /api/plugins/{name}/account {label}`.
- `GET /api/plugins/{name}/status` → {connected, tools: list[str]} (odpytaj gateway/mcp discovery).
- Karta OAuth w czacie: gdy bot w rozmowie zaproponuje plugin (albo user kliknie install wymagający auth) → odpowiedź chatu/WS event niesie plugin card {name, description, oauth_url, tools_count}; front renderuje kartę z UI-SPEC §3/§7.
- TDD: install przez API, status, multi-account, remove — na mocku serwera MCP.

### Task 3 (Fable 5): marketplace UI + karty pluginów

**Files:** Create: `ui/src/components/PluginsModal.tsx`, `ui/src/components/PluginCard.tsx`; Modify: `ui/src/components/Sidebar.tsx` (Plugins row → otwiera modal), `ui/src/lib/api.ts`

- PluginsModal (UI-SPEC §7): tytuł `Plugins`, tabs `Marketplace | Yours`, search.
  - Marketplace: sekcje (Featured, MCP), 2-col grid PluginCard: ikona + name +
    1-linijkowy opis + `Add`/zielony `✓ Added`. Katalog z GET /api/plugins/catalog.
  - Yours: lista zainstalowanych + `Connected` + per-narzędzie toggle (UI-SPEC §7),
    multi-account ("What should I call this second account?" — prosty prompt label).
- PluginCard: install → jeśli oauth_url, otwórz w nowej karcie (OAuth w
  przeglądarce, UI-SPEC §7 "Authorization complete! You can close this tab") →
  poll status aż connected → `✓ Added`.
- Plugins row w sidebarze (już jest no-op) → otwiera PluginsModal.
- Gates: tsc + build zielone.

### Task 4: Gate fazy 5

**Files:** Test: `tests/test_gate_faza5.py`

- Scenariusz: uruchom lokalny serwer MCP (stdio/HTTP, np. echo-tool albo minimalny
  FastMCP w teście) jako "plugin" → install przez API → bot A czatuje i narzędzie
  MCP jest w jego toolsecie (zweryfikuj przez gateway tools discovery / wywołanie) →
  utwórz bota B → BEZ osobnego connect narzędzie jest też u B (wspólny config +
  token). Asercja: token/wpis współdzielony, drugi bot nie autoryzuje ponownie.
- Pełny pytest + specy Playwright zielone. LOOP.md: #22-28 (odhacz co pokryte:
  #22 marketplace+OAuth card, #23 shared across bots, #24 multi-account, #25
  @plugin mention — jeśli nie, zanotuj, #26 custom install, #27 launch set —
  nasz katalog, #28 browser fallback = faza 4 już daje). FAZA: 6.
