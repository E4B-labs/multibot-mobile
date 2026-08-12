# Recon MCP klient + OAuth w Hermesie pod fazę 5 (2026-08-12)

## Co Hermes MA gotowe (bierzemy, nie piszemy)

- **Pełny klient MCP**: `tools/mcp_tool.py` (7731 linii, oficjalny SDK). Transporty
  stdio/Streamable HTTP/SSE, sampling, elicitation, lazy connect, reconnect,
  cooldown, cache schematów, watchdog stdio. Config: klucz `mcp_servers` w
  config.yaml profilu (`_load_mcp_config` :5074); interpolacja `${VAR}`,
  `${env:VAR}`; sekrety z secret scope profilu + `.env`.
- **Rejestracja narzędzi**: `_register_server_tools` :6281 — nazwa
  `mcp__<serwer>__<tool>` w `tools.registry`, auto-toolset `mcp-<serwer>`,
  filtr `tools.include/exclude` (globy). **Hot-reload do żywego agenta**:
  `refresh_agent_mcp_tools()` :7221 (bez restartu; woła to też gateway).
- **OAuth 2.1 + PKCE + DCR per serwer MCP**: `tools/mcp_oauth.py`,
  `tools/mcp_oauth_manager.py` (dedup 401, reload tokenów po mtime —
  cross-process!), flow przez dashboard `tools/mcp_dashboard_oauth.py`.
  Tokeny: **`$HERMES_HOME/mcp-tokens/<serwer>.json`** (0600), per profil.
  CLI: `hermes mcp login <name>`, `hermes mcp reauth`.
- **Katalog/marketplace**: `optional-mcps/` (manifest.yaml, manifest_version 1;
  5 wpisów: comfy-cloud, figma, linear, n8n, unreal-engine);
  `hermes_cli/mcp_catalog.py` (CatalogEntry/TransportSpec/AuthSpec/InstallSpec,
  `install_entry` :722 — git clone z pinem SHA, prompt env, checklist narzędzi);
  env `HERMES_OPTIONAL_MCPS` wskazuje katalog (`_catalog_root` :137).
  **REST już jest**: `hermes_cli/web_routers/mcp.py` — `GET/POST/PUT/DELETE
  /api/mcp/servers`, `/api/mcp/catalog`, `/api/mcp/catalog/install`; UI wzorzec:
  `web/src/pages/McpPage.tsx`.
- **Bezpieczeństwo**: `hermes_cli/mcp_security.py` (walidacja configów),
  trust tiers `trust: untrusted` = approval na write-tools (readOnlyHint),
  skan prompt-injection opisów (:703).
- `mcp.json` w paczce pluginu (`hermes_cli/agent_plugins.py:443`, format
  Claude/Cursor) → merge do configu.

## Czego NIE MA (nasza robota w fazie 5)

1. **Współdzielenie między botami**: `mcp-tokens/` i `mcp_servers` są per profil
   (HERMES_HOME). Brak `mcp.external_dirs` (analog `skills.external_dirs` nie
   istnieje). NAJTAŃSZA droga: wspólny plik `mcp_servers` w $SLAFY_DATA_DIR +
   nasz serwer przepisuje go do config.yaml każdego profilu przy zmianie
   (idempotentny merge — wzorzec `_ensure_browser_config` już mamy) + wspólny
   katalog tokenów przez symlink/junction `profiles/<bot>/mcp-tokens` →
   `$SLAFY_DATA_DIR/mcp-tokens` (manager reloaduje po mtime, więc działa
   cross-process bez restartu).
2. **Broker OAuth dla usług nie-MCP**: `AuthSpec.provider` to zaślepka
   (install_entry :757-764 tylko drukuje hint); `PROVIDER_REGISTRY` = tylko LLM.
   DECYZJA (lazy, rekomendacja reconu): każdy plugin slafy-bota = zdalny serwer
   MCP z natywnym OAuth/DCR — wtedy Hermes ogarnia flow sam, brokera nie piszemy.
3. **Multi-account**: de facto działa przez duplikat wpisu (`gmail-work`,
   `gmail-personal` — ten sam url, osobne tokeny, bo storage kluczowany NAZWĄ
   serwera, `mcp_oauth.py:443-450`). Brakuje tylko UI nazwanych kont.
4. **Własne źródło katalogu**: jeden katalog z `HERMES_OPTIONAL_MCPS`, bez
   remote index. Nasz marketplace = własny katalog manifestów w repo/danych +
   ewentualnie fetch z sieci później.
5. Koszt RAM: serwery stdio per proces bota; sprzątanie
   `_kill_orphaned_mcp_children` :7479.

## Rekomendacja fazy 5

Nie budować własnej warstwy MCP. Zakres: (a) wspólny config `mcp_servers` +
wspólne `mcp-tokens/` (junction) rozprowadzane na profile; (b) własny katalog
manifestów + REST naszego serwera (list/install/connect) + marketplace UI
(modal wg UI-SPEC §7); (c) karta OAuth w czacie = link do flow dashboardowego
Hermesa albo nasz redirect; (d) multi-account = duplikat wpisu + pole label w UI.
mcp_serve.py (Hermes jako serwer MCP) — nieistotny dla fazy 5.
