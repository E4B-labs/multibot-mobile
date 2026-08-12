# HERMES-FACTS — recon frameworka hermes-agent (faza 0)

> Źródło: klon `G:\Projects\hermes-agent` (github.com/NousResearch/hermes-agent, MIT),
> wersja `hermes-agent 0.20.0` (`pyproject.toml`), recon 2026-08-12.
> Wszystkie ścieżki relatywne do roota klonu. Konsumenci: plany faz 1–13.

## 1. Stack & runtime

**Języki i wersje**
- Python: `requires-python = ">=3.11,<3.14"` (`pyproject.toml`); `.python-version` → `3.11`. Górna granica celowa — 3.14 wywala build `pydantic-core` (brak wheela cp314).
- Node: `.nvmrc` → `26`; `package.json` → `"engines": {"node": ">=22.22.0"}`.
- Rust: tylko installer desktopowy (`apps/bootstrap-installer/src-tauri/`, Tauri).

**Entry pointy** (`pyproject.toml` `[project.scripts]`, linie 364–367):
```
hermes       = "hermes_cli.main:main"
hermes-agent = "run_agent:main"
hermes-acp   = "acp_adapter.entry:main"
```
- `cli.py` (898 KB) — interaktywny CLI/chat. `HermesCLI` w `cli.py:4267`, `main` w `cli.py:18359`.
- `run_agent.py` (389 KB) — rdzeń agenta. Klasa `AIAgent` w `run_agent.py:412`, `main` w `run_agent.py:8087` (przez `fire`).
- `hermes_bootstrap.py` — **musi być pierwszym importem**: UTF-8 stdio na Windows + `harden_import_path()` (chroni moduły Hermesa przed przesłonięciem przez lokalne `utils/`, `proxy/`, `ui/` w cwd).
- `gateway/run.py` (~18 tys. linii) — daemon gatewaya (`hermes gateway`).
- `tui_gateway/entry.py` — backend JSON-RPC dla TUI; `mcp_serve.py` — serwer MCP; `batch_runner.py`, `mini_swe_runner.py` — batch/eval.

**Główna pętla agenta**
- `agent/conversation_loop.py::run_conversation` — `agent/conversation_loop.py:1422` (plik 7757 linii). Pętla tool-callingu.
- Wrapper na `AIAgent`: `run_conversation(...)` w `run_agent.py:7895` (deleguje w `run_agent.py:7989`); uproszczone `chat(self, message, stream_callback=None) -> str` w `run_agent.py:8060`.
- Domyślny `max_iterations: int = 90` w `AIAgent.__init__`.

## 2. Profile format

**Gdzie leżą profile** (`hermes_constants.py`, `hermes_cli/profiles.py`)
- `HERMES_HOME` rozwiązywany: context-local override (`set_hermes_home_override`, `hermes_constants.py:30`) → env `HERMES_HOME` → default platformowy (`hermes_constants.py:114` `get_hermes_home()`).
- Default (`hermes_constants.py:53`): POSIX `~/.hermes`; **Windows `%LOCALAPPDATA%\hermes`** (⚠ u nas to C: — MUSIMY ustawiać `HERMES_HOME` na G:/D:).
- Profile nazwane: `~/.hermes/profiles/<name>/`; profil „default" = samo `~/.hermes`.
- Każdy profil = w pełni niezależny `HERMES_HOME`: własny `config.yaml`, `.env`, pamięć, sesje, skille, gateway, cron, logi.

**Tworzenie profilu** (`hermes_cli/profiles.py`):
```
hermes profile create coder              # świeży profil + bundled skills
hermes profile create coder --clone      # + kopia config.yaml, .env, SOUL.md, skills
hermes profile use coder
hermes -p coder chat
hermes profile delete coder
```
Katalogi bootstrapowane (`_PROFILE_DIRS`): `memories`, `sessions`, `skills`, `skins`, `logs`, `plans`, `workspace`, `cron`, `home`.
Pliki klonowane (`_CLONE_CONFIG_FILES`): `config.yaml`, `.env`, `SOUL.md`; plus `memories/MEMORY.md`, `memories/USER.md`.
Walidacja nazwy: `_PROFILE_ID_RE = ^[a-z0-9][a-z0-9_-]{0,63}$`.

**Schema `config.yaml`** — pełny wzorzec `cli-config.yaml.example` (94 KB). Sekcje top-level (linie):
`database:15`, `runtime:28`, `model:34`, `kanban:234`, `terminal:250`, `browser:403`, `tool_loop_guardrails:415`, `compression:445`, `prompt_caching:597`, `memory:716`, `session_reset:757`, `max_concurrent_sessions:769`, `streaming:819`, `skills:832`, `agent:850`, `platform_toolsets:1019`, `stt:1222`, `code_execution:1324`, `delegation:1333`, `display:1372`, `telemetry:1609`, `updates:1617`.

```yaml
model:
  default: "anthropic/claude-opus-4.6"
  provider: "auto"          # auto|openrouter|nous|anthropic|gemini|lmstudio|custom|...
  base_url: "https://openrouter.ai/api/v1"
  max_tokens: 8192
terminal:
  backend: "local"          # local|ssh|docker|singularity|modal|daytona|vercel_sandbox
  cwd: "."
  timeout: 180
skills:
  creation_nudge_interval: 15
stt:
  provider: local           # local|local_command|groq|openai|mistral|xai|elevenlabs|deepinfra
```
Zapis programowy: `hermes config set <section.key> <value>`.

**SOUL.md**
- Leży w korzeniu `HERMES_HOME`. Ładowany w `agent/prompt_builder.py:2089` (`soul_path = get_hermes_home() / "SOUL.md"`).
- Primary identity w system prompcie — slot „stable" (`agent/system_prompt.py:12`, `:189`).
- Default generuje `hermes_cli/default_soul.py`. Cron joby zawsze dziedziczą SOUL.md (`cron/scheduler.py:4165`).

**Bazy SQLite — DWIE różne**

a) `hermes_state.db` — rdzeń, store sesji. Schema `hermes_state_common.py:198+` (`SCHEMA_SQL`); WAL, FTS5.
Tabele: `schema_version`, `system_prompts(hash PK, prompt)`, `sessions(id PK, source, user_id, session_key, chat_id, chat_type, thread_id, display_name, model, system_prompt_hash, parent_session_id, started_at, ended_at, message_count, tool_call_count, input_tokens, output_tokens, profile_name, archived, pinned, …)`, `messages(id PK, session_id FK, role, content, tool_call_id, tool_calls, tool_name, timestamp, reasoning, active, compacted, …)`, `session_model_usage`, `state_meta`, `gateway_routing`, `compression_locks`, `async_delegations`.
FTS5: `messages_fts` (`hermes_state_common.py:417`), `messages_fts_trigram` (`:486`) + triggery.

b) `memory_store.db` — plugin pamięci holograficznej. Ścieżka `$HERMES_HOME/memory_store.db` (`plugins/memory/holographic/store.py:124`). Schema `store.py:16-79`:
```sql
facts(fact_id PK, content UNIQUE, category, tags, trust_score REAL DEFAULT 0.5,
      retrieval_count, helpful_count, created_at, updated_at, hrr_vector BLOB)
entities(entity_id PK, name, entity_type, aliases, created_at)
fact_entities(fact_id, entity_id)
facts_fts  -- FTS5 content=facts + triggery
memory_banks(bank_id PK, bank_name UNIQUE, vector BLOB, dim, fact_count, updated_at)
```
Backup obu baz: `hermes_cli/backup.py:1106`. Pamięć markdownowa: `memories/MEMORY.md`, `memories/USER.md`.

## 3. Provider layer

- Abstrakcja: `providers/base.py` — dataclass `ProviderProfile` + sentinel `OMIT_TEMPERATURE`; rejestr `providers/__init__.py` (`register_provider`, `get_provider_profile`, `list_providers`).
- Profile providerów leżą jako pluginy: `plugins/model-providers/<name>/` (bundled) + `$HERMES_HOME/plugins/model-providers/<name>/` (user). Odkrywane leniwie.
- Pola `ProviderProfile`: `name`, `api_mode` (default `"chat_completions"`), `aliases`, `display_name`, `signup_url`, `env_vars`, `base_url`, `models_url`, `auth_type` (`api_key|oauth_device_code|oauth_external|copilot|aws_sdk`), `supports_vision`, `supports_prompt_cache_key`, `fallback_models`, `default_headers`, `fixed_temperature`, `default_max_tokens`, `default_aux_model`.
- Hooki (`providers/README.md`): `get_hostname()`, `prepare_messages(msgs)`, `build_extra_body(**ctx)`, `build_api_kwargs_extras(**ctx)`, `fetch_models(*, api_key)`.
- Adaptery natywne: `agent/anthropic_adapter.py`, `agent/gemini_native_adapter.py`, `agent/bedrock_adapter.py`, `agent/vertex_adapter.py`, `agent/codex_responses_adapter.py`.
- Wybór per profil: sekcja `model:` w `config.yaml` (`provider`, `default`, `base_url`, opcjonalnie `api_key`). Wartości m.in.: `auto`, `openrouter`, `nous`, `anthropic`, `gemini`, `lmstudio`, `custom`. Aliasy `ollama`/`vllm`/`llamacpp` mapują na `custom` + `base_url`. Override: flagi `--provider`, `--model`.
- **BYOK**: `.env` w profilu (`$HERMES_HOME/.env`, wzorzec `.env.example`); env ma pierwszeństwo nad `config.yaml` dla sekretów. Alternatywy: `hermes auth ...` (`hermes_cli/auth.py`), wprost `model.api_key` (odradzane).
- Provider-specific pakiety NIE są w core dependencies — extras + lazy install przez `tools/lazy_deps.py`.

## 4. Gateway API

Katalog `gateway/` (~50 modułów + `platforms/`, `relay/`, `builtin_hooks/`). Runner `gateway/run.py`, konfiguracja `gateway/config.py`.

### 4a. HTTP `api_server` — DROGA DLA NASZEGO WEB UI

`gateway/platforms/api_server.py` — OpenAI-compatible API server. Endpointy (docstring, linie 1–40):
```
POST   /v1/chat/completions        # stateless; sesja opt-in: X-Hermes-Session-Id;
                                   # scoping pamięci: X-Hermes-Session-Key
POST   /v1/responses               # stateful (previous_response_id)
GET    /v1/models
GET    /v1/capabilities            # capabilities dla zewnętrznych UI
GET    /api/sessions               # lista sesji
POST   /api/sessions               # nowa pusta sesja
GET/PATCH/DELETE /api/sessions/{session_id}
GET    /api/sessions/{session_id}/messages
POST   /api/sessions/{session_id}/fork
POST   /api/sessions/{session_id}/chat
POST   /api/sessions/{session_id}/chat/stream
POST   /v1/runs                    # start runu, 202 + run_id
GET    /v1/runs/{run_id}           # status
GET    /v1/runs/{run_id}/events    # SSE lifecycle
POST   /v1/runs/{run_id}/approval  # pending approval
POST   /v1/runs/{run_id}/stop
GET    /health, /health/detailed
```
- Port domyślny **8642**, auth **`API_SERVER_KEY`** (`api_server.py:28-31`). Wymaga `aiohttp`.
- Multipleks profili: `gateway.multiplex_profiles` → prefiks `/p/<profile>/v1/...` (`api_server.py:34-35`).
- **Rekomendacja dla slafy-bot**: `POST /api/sessions` → `POST /api/sessions/{id}/chat/stream`; długie zadania z approvalami: `/v1/runs` + SSE `/v1/runs/{run_id}/events`.

### 4b. Inne generyczne kanały

- `gateway/platforms/webhook.py` — generic webhook adapter: routes w `platforms.webhook.extra.routes` (`events`, `secret` HMAC wymagany, `prompt` template, `skills`, `deliver`, `deliver_only`). HMAC V2 z timestampem (`X-Webhook-Signature-V2`), rate limiting, idempotencja. **To pokrywa nasz trigger engine (faza 6).**
- `gateway/relay/` — EXPERIMENTAL. `RelayAdapter` (`gateway/relay/adapter.py`) + `CapabilityDescriptor` (`gateway/relay/descriptor.py`); kontrakt `docs/relay-connector-contract.md`. Gateway dial-uje na zewnątrz do WS konektora `/relay`. Protokół może się zmienić bez deprecation — nie budować na tym.

### 4c. WebSocket `tui_gateway`

`tui_gateway/ws.py`: „Reuses `tui_gateway.server.dispatch` verbatim so every RPC method, every slash command, every approval/clarify/sudo flow, and every agent event flows through the same handlers whether the client is Ink over stdio or an iOS / web client over WebSocket."
Pełny protokół czatu (slash, approvals, clarify) po WS. Moduły: `tui_gateway/server.py`, `transport.py`, `ws.py`, `methods_*.py`, `event_publisher.py`. **Kandydat na realtime sync fazy 3.**

### 4d. Platformy + własny adapter

Enum `Platform` (`gateway/config.py:317-348`): `local`, `telegram`, `discord`, `whatsapp`, `slack`, `signal`, `matrix`, `email`, `api_server`, `webhook`, `relay`, … `Platform._missing_()` tworzy pseudo-membery dla adapterów pluginowych bez modyfikacji enuma.
Własna platforma: `gateway/platforms/ADDING_A_PLATFORM.md` — subklasa `BasePlatformAdapter` (`gateway/platforms/base.py`), wymagane: `__init__(config)`, `connect() -> bool`, `disconnect()`, `send(...)`, `get_chat_info(...)` + `check_<platform>_requirements() -> bool`. Opcjonalne: `send_clarify`, `send_exec_approval`, `send_slash_confirm`, `send_model_picker`, `send_choice_picker`. Rejestracja: `gateway/platform_registry.py` (`PlatformEntry` + `platform_registry.register`).
**Routing per-profil**: `gateway/profile_routing.py`, `docs/profile-routing.md` — klucz `profile_routes` w `config.yaml` (`name`, `platform`, `profile`, `guild_id`, `chat_id`, `thread_id`). Jeden gateway = N izolowanych profili. **To jest fundament „1 bot = 1 profil" w fazie 1.**

## 5. Terminal backends

- Interfejs: `tools/environments/base.py`, klasa `BaseEnvironment(ABC)` — `base.py:588`.
- Backendy (`tools/environments/`): `local.py`, `docker.py` (`DockerEnvironment`, `docker.py:852`), `ssh.py` (`SSHEnvironment`, `ssh.py:40`), `singularity.py`, `modal.py`, `daytona.py`, `vercel_sandbox.py`.
- Kontrakt: subklasa implementuje `_run_bash(self, cmd_string, *, login=False, ...)` (`base.py:637`; baza rzuca `NotImplementedError`) + `cleanup(self)` (jedyna `@abstractmethod`, `base.py:652-655`). Baza daje: `execute(...)`, snapshot sesji, CWD tracking, timeout, interrupt.
- Model wykonania: spawn-per-call `bash -c`; snapshot env przy init, re-source przed każdą komendą; CWD przez in-band markery stdout.
- Błędy infrastruktury: `EnvironmentConnectionError(reason, retry_hint=...)` (`base.py:55-79`) → `terminal_tool` daje `status: "degraded"`.
- Fabryka: `tools/terminal_tool.py::_get_env_config` (~`:1570`); wybór przez env `TERMINAL_ENV` (default `local`), mostkowane z `terminal.backend` w `config.yaml` (`terminal_tool.py:1517-1561`). Env konfiguracyjne: `TERMINAL_CWD`, `TERMINAL_TIMEOUT`, `TERMINAL_DOCKER_IMAGE`, `TERMINAL_SSH_HOST/_USER/_PORT/_KEY`, ….
- **⚠ Dla komputerów botów (faza 4): `BaseEnvironment` to abstrakcja SHELLA, nie przeglądarki.** Właściwa warstwa dla Playwright per-bot: `agent/browser_provider.py` + `agent/browser_registry.py` (rejestr browser providerów, rejestracja przez `PluginContext.register_browser_provider`), narzędzia `tools/browser_tool.py`, `tools/browser_cdp_tool.py`, `tools/browser_supervisor.py`, `tools/computer_use/`; sekcja `browser:` w `cli-config.yaml.example:403`; npm dep `agent-browser 0.26.0`. Dokładna sygnatura ABC browser providera — DOCZYTAĆ na starcie fazy 4 (jedyna niedoczytana rzecz z recon).

## 6. Skills

- Format: SKILL.md z YAML frontmatter, **agentskills.io compatible** (`tools/skills_tool.py:1-45`). Wymagane: `name` (max 64), `description` (max 1024); opcjonalne `version`, `license`, `platforms`, `compatibility`, `metadata` (w tym `metadata.hermes`). Struktura: `skills/<skill>/SKILL.md` + `references/` + `templates/` + `assets/`; foldery kategorii.
- Lokalizacje: bundled `skills/` (kategorie: apple, autonomous-ai-agents, creative, devops, email, github, media, productivity, research, software-development, …), `optional-skills/`, per-profil zapisywalne `$HERMES_HOME/skills/`, zewnętrzne read-only `skills.external_dirs` (`cli-config.yaml.example:838-847`). Rozwiązywanie: `hermes_constants.py:201`, `:231`, `:237`.
- Odpalanie: narzędzia `skills_list`/`skill_view` (`tools/skills_tool.py`), `skill_manage` create/patch/archive/pin (`tools/skill_manager_tool.py`); runtime `agent/skill_commands.py`, `agent/skill_preprocessing.py`. **Każdy skill = automatycznie slash-komenda** (`/gif-search funny cats`), działa w CLI i na każdej platformie; skille można stackować.
- **Learning loop — stan faktyczny (mit „3+ prób" NIE ISTNIEJE w kodzie):**
  1. Nudge: `skills.creation_nudge_interval: 15` — co N iteracji tool-callingu przypomnienie o zapisaniu skilla.
  2. `/learn` — `agent/learn_prompt.py::build_learn_prompt`: agent zbiera źródła (pliki, URL przez `web_extract`, bieżąca konwersacja) i pisze skill przez `skill_manage`. Duże korpusy → chudy SKILL.md-indeks + `references/`.
  3. Curator (self-refinement) — `agent/curator.py`: uruchamiany bezczynnością (`maybe_run_curator()` po `interval_hours`), forkuje `AIAgent`, może pin/archive/consolidate/patch tylko skille agent-created; nigdy nie kasuje (archiwum `~/.hermes/skills/.archive/`); pinned nietykalne.
  4. Learning graph: `agent/learning_graph.py`, dataclass `SkillNode(name, category, source, timestamp, use_count, state, created_by, pinned, related)`.
  5. Skills Hub: agentskills.io, klient `tools/skills_hub.py`.
- **Wniosek dla fazy 9 (teach-a-task)**: hooki są (skill_manage, learn_prompt, curator) — nagrywanie demonstracji musimy dopisać sami, synteza skilla przez istniejący `skill_manage`.

## 7. Cron/scheduler

- Definicje: `~/.hermes/cron/jobs.json`; output `~/.hermes/cron/output/{job_id}/{timestamp}.md` (`cron/jobs.py:1-5`). **Cron jest per-profil** (kotwiczy na `get_hermes_home()`, nie default root — izolacja credentiali).
- `create_job()` (`cron/jobs.py:1569-1589`): `prompt` (self-contained), `schedule` (5-polowy cron przez `croniter` lub interwały; parser `parse_schedule`), `name`, `repeat` (None = ∞), `deliver` (`origin|local|telegram|...`), `origin`, `skills`, `model`/`provider`/`base_url` override per job, `script`, `no_agent`, `monitor_script`, `monitor_url`.
- Rejestracja: model tool `cronjob` (`tools/cronjob_tools.py:1443+`, akcje create/list/update/pause/resume/remove/run) albo `hermes cron ...` (`hermes_cli/cron.py`). Lock: advisory file lock na `jobs.json` (`fcntl`/`msvcrt`).
- **Wykonanie: `cron/scheduler.py::tick()` wołany co 60 s z background threada GATEWAYA.** Bez sesji czatu — tak; bez procesu gatewaya — nie. Joby biegną w świeżej sesji (prompt self-contained), dziedziczą SOUL.md. Lock `.tick.lock`. Guard: `cron/lifecycle_guard.py` blokuje joby restartujące własny gateway.
- **Wniosek dla fazy 6 (routines)**: rutyny = cron joby Hermesa per profil + nasz webhook adapter jako triggery. Warunek „działa z zamkniętą apką" = nasz serwer trzyma gateway procesy żywe.

## 8. Osadzenie runtime (faza 1 — kluczowe)

**Da się jako biblioteka:**
```python
import hermes_bootstrap            # MUSI być pierwszym importem
hermes_bootstrap.harden_import_path()

from hermes_constants import set_hermes_home_override, reset_hermes_home_override
token = set_hermes_home_override(profile_path)   # ContextVar, per-context, nie os.environ

from run_agent import AIAgent
agent = AIAgent(base_url=..., api_key=..., provider=..., model=...,
                session_id=..., quiet_mode=True,
                tool_progress_callback=..., thinking_callback=..., clarify_callback=...)
text = agent.chat("cześć")                                   # run_agent.py:8060 -> str
result = agent.run_conversation("...", stream_callback=cb)   # run_agent.py:7895
```
- `AIAgent.__init__` przyjmuje m.in.: `base_url`, `api_key`, `provider`, `api_mode`, `model`, `max_iterations=90`, `enabled_toolsets`, `disabled_toolsets`, `session_id`, `quiet_mode`, `ephemeral_system_prompt` + komplet callbacków (`tool_progress_callback`, `tool_start_callback`, `tool_complete_callback`, `thinking_callback`, `reasoning_callback`, `clarify_callback`).
- Wybór profilu per żądanie: `set_hermes_home_override(path)` → token → `reset_hermes_home_override(token)` (`hermes_constants.py:30-42`). Embedder-aware precedencja opisana w `cron/jobs.py:139-152`.
- Lekkie bezstanowe wywołania LLM: `agent/oneshot.py::run_oneshot` (nie dotyka historii sesji, nie psuje prompt cache).
- Alternatywy nie-CLI: `acp_adapter/` (JSON-RPC po stdio), `tui_gateway/` (stdio lub WS), `mcp_serve.py`.
- `hermes_state.py` (513 KB) — SQLite store sesji: WAL, FTS5, splitowanie sesji przez `parent_session_id`, tagowanie źródła. Mixiny: `hermes_state_portability.py`, `hermes_state_schema.py`, `hermes_state_search.py`; SQL w `hermes_state_common.py`.
- `hermes_constants.py` — import-safe, zero zależności. Kluczowe: `get_hermes_home()` (:114), `get_default_hermes_root()` (:161), `get_bundled_skills_dir()` (:231), zarządzanie portable Node w `$HERMES_HOME/node`.
- **Alternatywa architektoniczna dla fazy 1**: zamiast embedowania AIAgent w naszym procesie — odpalić `hermes gateway` per grupa profili i mówić do `api_server` (HTTP/SSE, §4a). Mniej kodu, lepsza izolacja. Decyzja na starcie fazy 1.

## 9. Wersje zależności

- Python `>=3.11,<3.14`. Polityka: każdy dep exact-pinned `==X.Y.Z` (reakcja na robaka „Mini Shai-Hulud" w `mistralai 2.4.6`, 2026-05-12). Lockfile `uv.lock`; instalacja `uv pip install -e ".[all,dev]"`.
- Core: `openai==2.24.0`, `python-dotenv==1.2.2`, `fire==0.7.1`, `httpx[socks]==0.28.1`, `rich==14.3.3`, `tenacity==9.1.4`, `pyyaml==6.0.3`, `ruamel.yaml==0.18.17`, `requests==2.33.0`, `jinja2==3.1.6`, `pydantic==2.13.4`, `prompt_toolkit==3.0.52`, `croniter==6.0.0`.
- Extras: `messaging` (`python-telegram-bot[webhooks]==22.6`, `discord.py[voice]==2.7.1`, `aiohttp==3.14.3`, `slack-bolt==1.29.0`), `slack`, `matrix`. `aiohttp==3.14.3` potrzebny dla `api_server` i webhook.
- Node: workspaces `apps/*`, `ui-tui`, `web`, `tests-js`.
  - `web/` — dashboard: **Vite + React 19 + TS, Tailwind CSS v4, shadcn-style komponenty**. Dev: backend FastAPI na 9119 (`python -m hermes_cli.main web`) + Vite 5173 proxy `/api`. **Wzorzec stacku dla naszego PWA (faza 2).**
  - `ui-tui/` — Ink/React TUI; `GatewayClient` spawnuje `python -m tui_gateway.entry`, transport newline-delimited JSON-RPC po stdio.
  - `apps/desktop/` — Electron 40.10.2; `apps/bootstrap-installer/` — Tauri.
  - Root deps: `agent-browser 0.26.0` (automatyzacja przeglądarki), `@streamdown/math 1.0.2`.
- Constraints Termux: `constraints-termux.txt` (**faza 12**).

## 10. Multi-agent / inter-bot

1. **Delegacja (subagenty)** — `tools/delegate_tool.py`: spawnuje child `AIAgent` z izolowanym kontekstem, własnym task_id, toolsetami rodzica minus `DELEGATE_BLOCKED_TOOLS = {delegate_task, clarify, memory, send_message, cronjob}` (brak rekurencji, brak side effectów). Wspiera batch/parallel. Async: `tools/async_delegation.py`, tabela `async_delegations` w `hermes_state.db`, sekcja `delegation:` w konfigu.
2. **`send_message`** — `tools/send_message_tool.py`: wiadomość do usera/kanału na dowolnej podpiętej platformie; działa w CLI i gateway. **Droga bot→bot przez wspólny kanał — fundament inter-bot bus (faza 7).**
3. **Routing profili** — jeden gateway, N profili (§4d). 
4. **Inter-agent ping** — webhook `deliver_only: true`: „zero LLM cost, sub-second delivery" — wprost wymieniony use case „inter-agent pings".
5. **Kanban / swarm** — `hermes_cli/kanban_swarm.py`, `tools/kanban_tools.py`, `gateway/kanban_watchers.py`, `docs/kanban/multi-gateway.md`: orkiestracja wielu agentów przez wspólną tablicę. **Kandydat na group chat ownership (faza 7).**
6. **MoA** — `agent/moa_loop.py`, `hermes_cli/moa_cmd.py`.

## 11. Voice

- STT: `tools/transcription_tools.py` — gateway automatycznie transkrybuje voice message z Telegram/Discord/WhatsApp/Slack/Signal. Backendy (`BUILTIN_STT_PROVIDERS`): `local` (**faster-whisper, default, darmowy**, auto-download ~150 MB), `local_command` (env `HERMES_LOCAL_STT_COMMAND`), `groq`, `openai`, `mistral` (Voxtral), `xai`, `elevenlabs`. Formaty: mp3/mp4/m4a/wav/webm/ogg/aac.
- API: `transcribe_audio(path) -> {success, transcript, provider, error?}` (kontrakt w `agent/transcription_provider.py`).
- Pluginowe STT: ABC `TranscriptionProvider` (`agent/transcription_provider.py`), rejestr `agent/transcription_registry.py`, built-ins-always-win.
- TTS też jest: `agent/tts_provider.py`, `tools/tts_tool.py`, `tools/tts_streaming.py`, `gateway/streaming_tts_consumer.py`, `docs/streaming-tts.md`. Voice mode/wake word: `tools/voice_mode.py`, `tools/wake_word.py`.
- **Wniosek dla fazy 10**: dictation w PWA = Web Speech API (nasz plan) LUB upload audio do `transcribe_audio` z providerem `local` — obie drogi tanie.

## Konsekwencje architektoniczne dla slafy-bot (podsumowanie)

1. **Faza 1**: dwie opcje osadzenia — (a) embed `AIAgent` w naszym serwerze z `set_hermes_home_override` per bot, (b) `hermes gateway` + `api_server` HTTP/SSE per grupa profili. Opcja (b) mniej kodu, gotowe endpointy sesji/streamingu/approvals — startować od niej.
2. **`HERMES_HOME` na Windows defaultuje na `%LOCALAPPDATA%\hermes` = C:** — zawsze jawnie ustawiać na `G:\Projects\slafy-bot\D_tmp` lub dedykowany katalog na G:/D:.
3. Boty = profile Hermesa (`hermes profile create <bot>`); routing per profil już jest w gatewayu.
4. Trigger engine fazy 6 = gotowy `gateway/platforms/webhook.py`; routines = cron per profil.
5. Komputery botów fazy 4: wpinać się w `agent/browser_provider.py`/`browser_registry.py` (doczytać ABC), NIE w `BaseEnvironment`.
6. Web UI: wzorować stack na `web/` (Vite + React 19 + Tailwind v4); realtime: `tui_gateway/ws.py` albo SSE z `api_server`.
7. Skills = agentskills.io format, auto slash-komendy, współdzielenie przez `skills.external_dirs` (jeden wspólny katalog dla wszystkich botów = feature #19 za darmo).
