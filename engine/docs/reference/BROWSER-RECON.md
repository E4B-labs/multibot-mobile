# Recon browser providera Hermesa pod fazę 4 (2026-08-12)

## Interfejs

`agent/browser_provider.py` — `class BrowserProvider(abc.ABC)`. Abstrakcyjne:
- `name` (`@property -> str`) — wartość klucza `browser.cloud_provider`
- `is_available() -> bool` — tanie (env/import), ZAKAZ network calls
- `create_session(task_id: str) -> Dict` — zwrotka DOSŁOWNIE:
  `{"session_name": str, "bb_session_id": str, "cdp_url": str, "expires_at": str?, "features": dict, "external_call_id": str?}`
  (`bb_session_id` legacy nazwa — nie zmieniać; `expires_at` NIE ustawiać = nigdy nie wygasa, `_session_has_expired` browser_tool.py:1603)
- `close_session(session_id) -> bool` — dostaje `bb_session_id`; nie wolno rzucać
- `emergency_cleanup(session_id) -> None` — atexit/signal; nie wolno rzucać

Opcjonalne: `display_name`, `get_setup_schema()`.

Rejestracja: plugin `plugins/browser/<name>/` (`plugin.yaml`: `kind: backend`,
`provides_browser_providers: [<name>]`; `__init__.py::register(ctx)` →
`ctx.register_browser_provider(Provider())` — `hermes_cli/plugins.py:818`,
walidacja isinstance, przy błędzie cicho ignoruje). Tutorial 1:1:
`website/docs/developer-guide/browser-provider-plugin.md`.

Aktywacja: `agent/browser_registry.py::_resolve` — jawny config wygrywa ignorując
`is_available()`; auto-preferencja hardcoded `("browser-use", "browserbase")` —
**nasz provider musi być jawnie w configu**.

## Jak toole używają providera

Provider NIE implementuje przeglądania — tylko lifecycle sesji, oddaje `cdp_url`.
Hermes napędza stronę przez npm CLI `agent-browser 0.26.0` (Playwright/Chromium,
daemon+socket; Python odpala subprocessem — `tools/browser_tool.py::_run_browser_command`
:2445, cloud = `["--cdp", url]`). Toolset gotowy: `browser_navigate/snapshot/click/
type/scroll/back/press/get_images/vision/console` + `browser_cdp` (surowy CDP
passthrough). CDP supervisor (dialogi/frames) auto-startuje przy `cdp_url`.
`cdp_url` może być HTTP discovery URL (`http://127.0.0.1:<port>` z
`--remote-debugging-port`) — `_resolve_cdp_override` browser_tool.py:2242.

**Screencast/live view/take-over NIE ISTNIEJE w frameworku** — całość nasza, ale po
tym samym `cdp_url`: `Page.startScreencast` → WS do UI; take-over przy headed =
user klika w okno równolegle (agent działa przez CDP, nie jest właścicielem UI).

## Config `browser:`

Źródło prawdy: `hermes_cli/config_defaults.py:413-464` (cli-config.yaml.example NIE
dokumentuje `cloud_provider`!). Kluczowe: `backend` (""=auto; **pinować `"off"`**,
inaczej auto może przełączyć na Browser Use CLI i ominąć providera),
`cloud_provider` (nasz `name`), `inactivity_timeout` (default 120 s — reaper woła
`close_session`!), `headed`, `record_sessions`, `cdp_url`, `engine`.

## Werdykt — co implementujemy w fazie 4

1. Plugin `slafy`: `plugin.yaml` + `register(ctx)` + `provider.py` z
   Playwright persistent context per bot (`user_data_dir` z profilu bota).
2. Config każdego bota: `browser.cloud_provider: slafy` + `browser.backend: "off"`
   + podniesiony `inactivity_timeout`.
3. Kontrakt close: przeglądarka down, profil na dysku, następny `create_session`
   relaunchuje ten sam `user_data_dir` (persistent logins = za darmo z user_data_dir).
4. Live view + take-over: własny mostek `Page.startScreencast` → WebSocket → UI.

## TRZY PUŁAPKI (architektoniczne)

- **`_get_cloud_provider()` cache'uje wybór na CAŁY proces i czyta jeden config.yaml
  per HERMES_HOME** (`_cloud_provider_resolved`, browser_tool.py:757-759). Per-bot
  provider działa tylko przy osobnych procesach / osobnych HERMES_HOME per bot.
  Konsekwencja: architektura "gateway per profil" (osobny proces per bot) albo
  jeden wspólny provider `slafy` rozróżniający boty po `task_id`/`HERMES_HOME`.
- Reaper 120 s → `close_session`; persistent context musi przeżywać zamknięcie.
- Sesje w pamięci procesu kluczowane `task_id` — persystencja sesji = nasz
  `user_data_dir`, framework nic nie trzyma.
