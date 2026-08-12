# Recon warstwy approvals Hermesa pod fazę 13 (2026-08-12)

Ścieżki bez prefiksu = `G:\Projects\hermes-agent\`.

## 0. Sprostowania do założeń zadania

1. **Approvals NIE są jak `clarify`.** `clarify` jest martwy na api_server; approvals
   **działają natywnie — ale tylko na `/v1/runs`**, nie na `/v1/chat/completions`.
2. **Dwa niezależne systemy approvali**, nie jeden: `tools/approval.py` (blokujący gate
   niebezpiecznych komend/kodu) i `tools/write_approval.py` (staging writeów). Nic ich nie łączy.
3. **`memory_tool._apply_write_gate` to NIE generyczny approval toola** — gate wyłącznie
   dla `memory` i `skills`, domyślnie **wyłączony** (`config_defaults.py:1728, 1902`).
4. **Nasza obecna ścieżka (`/v1/chat/completions`) NIE pauzuje agenta.** Kończy się
   martwym `submit_pending()` bez czytelnika (§2.3). To główny wniosek dla fazy 13.
5. Tylko **dwa toole** przechodzą przez gate: `terminal` i `execute_code` — jedyni
   wołający `check_all_command_guards`/`check_execute_code_guard` to
   `tools/terminal_tool.py` i `tools/code_execution_tool.py`.
6. **`tool_loop_guardrails` to czerwony śledź** — anty-pętla, nie approvals:
   `agent/tool_guardrails.py:64` (config), bloki po N identycznych porażek
   (`exact_failure_block_after: 5` `:75`, `no_progress_block_after: 5` `:79`),
   akcje `allow|warn|block|halt` `:197`. Zero interakcji z człowiekiem.

## 1. System A — gate niebezpiecznych akcji (`tools/approval.py`)

Rdzeń: `_run_approval_gate` (`:3147`), wspólny dla `check_dangerous_command` i
`request_tool_approval`. Kolejność: yolo → cache sesji → gałąź
interactive/gateway/cron → prompt → persist `deny|session|always`.

| Rozpoznanie kontekstu | Funkcja | Zachowanie |
|---|---|---|
| interactive CLI | `_is_interactive_cli` `:85` | prompt `input()` |
| gateway/API | `_is_gateway_approval_context` `:244` | true gdy `HERMES_SESSION_PLATFORM` niepuste **lub** `HERMES_GATEWAY_SESSION` |
| cron | `_is_cron_approval_context` `:228` | nigdy nie gateway; rządzi `approvals.cron_mode` |
| brak człowieka | `:3218-3260` | dangerous-command **fail-open** (auto-approve + warning); `request_tool_approval` **fail-closed** (`:3486`, `fail_closed_when_no_human=True`) |

### 1.1 Config `approvals:` (`hermes_cli/config_defaults.py:2117`)

| Klucz | Default | Uwaga |
|---|---|---|
| `approvals.mode` | `"smart"` | `:2118`; `manual` / `smart` (aux-LLM auto-approve) / `off` (=yolo) |
| `approvals.timeout` | `300` | `:2119`; wspólny dla CLI i gateway/API |
| `approvals.cron_mode` | `"deny"` | `:2120`; `approve` = auto-approve w cronie |
| `approvals.smart_policy` | `""` | `:2127`; dopisywany do SYSTEM prompta strażnika |
| `approvals.denial_breaker_threshold` | `3` | `:2134`; po N deny z rzędu twardy stop |
| `approvals.deny` | `[]` | `:2144`; **fnmatch globy blokujące BEZWARUNKOWO, przed yolo** |
| `command_allowlist` | `[]` | `:2165`; wpisy dodane przez „always" |
| `security.protected_instruction_files` | `True` | `:2212`; AGENTS.md/CLAUDE.md/SOUL.md zawsze wymagają zgody, nawet pod yolo |

### 1.2 Detekcja „wrażliwych" akcji

- `HARDLINE_PATTERNS` (`:434`) — twardy blok, nie da się zatwierdzić.
- `DANGEROUS_PATTERNS` (`:693`, skompilowane `:957`) → `detect_dangerous_command` (`:2175`).
  Klasy: `rm -rf`, `chmod -R 777`, `curl|sh`, zapisy do `~/.ssh`, `.env`, `~/.hermes/config.yaml` (`:272-294`).
- Tirith (external scanner, `security.tirith_enabled` `:2214`) → `_format_tirith_description`.
- **Zakres = tylko stringi komend i kod.** Płatności, wysyłanie wiadomości, browser —
  **Hermes ich NIE klasyfikuje**. Zero detekcji „sensitive" poza shellem.

Uwaga: `plugins/security-guidance/__init__.py:202` skanuje zapisy plików, ale domyślnie
tylko **ostrzega** (dokleja blok do wyniku `:227`); `block`-mode odmawia, nie pyta.

### 1.3 Generyczny approval dowolnego toola — `request_tool_approval`

`tools/approval.py:3486`. Wejście: plugin hook `pre_tool_call` zwracający
`{"action": "approve", "message": ..., "rule_key": ...}` (`hermes_cli/plugins.py:2495-2496`,
walidacja `:2541`, wywołanie `:2656`). Przechwytuje **przed** wykonaniem, LLM nie ominie.
`rule_key` steruje ziarnem „always"; bez niego klucz = `tool_name` + hash `reason`.

**To jedyna droga do „per-tool approval" w Hermesie.** Wymaga napisania pluginu.

## 2. Jak pending płynie na ścieżkach NIE-interaktywnych

### 2.1 Kolejka gateway (Telegram/Discord/Slack/WhatsApp/QQ/**`/v1/runs`**)

```
tool → _run_approval_gate (:3147) → notify_cb zarejestrowany? (:3277)
     → _await_gateway_decision (:3604)
        ├ _gateway_queues[session_key].append(_ApprovalEntry)   :2457 / klasa :2443
        ├ notify_cb(approval_data)          → platforma renderuje przyciski
        └ blokuje wątek agenta w pętli 1 s, do approvals.timeout (300 s)
user → /approve|/deny (gateway/slash_commands.py:5422, :5477)
     → resolve_gateway_approval(session_key, choice)  (approval.py:2486)
     → entry.event.set() → agent wznawia, terminal_tool wykonuje inline
```

Stan: `_gateway_queues` (`:2457`), `_gateway_notify_cbs` (`:2458`), oba **in-memory**.
`has_blocking_approval` `:2522`. `unregister_gateway_notify` `:2473` zwalnia WSZYSTKIE
wpisy sesji (koniec runu = deny). Timeout → `"BLOCKED: … Silence is not consent."` (`:3290`).

### 2.2 `/v1/runs` — DZIAŁA w pełni (api_server)

| Element | Lokalizacja |
|---|---|
| `approval_session_key = run_id` | `gateway/platforms/api_server.py:6574` |
| `register_gateway_notify(...)` | `:6707` — **tylko tutaj, w `_handle_runs` (`:6481`)** |
| callback `_approval_notify` → event SSE `approval.request`, status `waiting_for_approval` | `:6647-6668` (komenda redagowana `:6656`) |
| `POST /v1/runs/{run_id}/approval` | route `:2093`, handler `_handle_run_approval` `:6955` |
| `choice`: `once|session|always|deny` (+ alias `approve`), `all`/`resolve_all` | `:6977` |
| event `approval.responded`, status → `running` | `:7022`, `:7027` |
| SSE stream `GET /v1/runs/{run_id}/events`; capability flagi | `:2092`; `:3130-3132`, `:3159` |

### 2.3 `/v1/chat/completions` + `/v1/responses` — **ŚLEPY ZAUŁEK**

Obie trasy idą przez `_run_agent` (`api_server.py:6128`), który wiąże sesję przez
`_bind_api_server_session` (`:6096`, wywołanie `:6184`) z `platform="api_server"`.

Skutek: `_is_gateway_approval_context()` → **True**, ale `register_gateway_notify`
**nigdy nie jest wołane** dla tych tras (jedyne wywołanie: `:6707`, w `_handle_runs`).

Trafiamy więc w gałąź „No notify callback" (`tools/approval.py:3321-3338`):

```python
submit_pending(session_key, {...})           # approval.py:2528 → _pending[session_key] = ...
return {"approved": False, "status": "approval_required",
        "message": "⚠️ This action is potentially dangerous (...). Asking the user..."}
```

- **Agent NIE blokuje.** Dostaje tekst jako wynik toola i relacjonuje go userowi.
- `_pending` (`:2203`) jest **write-only**: zapis `:2531`, jedyny inny dostęp to
  `pop` przy czyszczeniu sesji (`:2585`). **Nikt tego nie czyta** — sprawdzone też
  globalnie: zero importów `_pending` z `tools.approval` w `gateway/` i `hermes_cli/`
  (trafienia `get_pending` należą do innych modułów: `slash_confirm`, `clarify`, `write_approval`).
- Brak endpointu HTTP do rozwiązania (`_run_approval_sessions` zapełniane tylko w `_handle_runs` `:6581`).
  Ten sam ślepy zaułek dla `execute_code` (`:4124`, `:4376`).
- api_server **nie ma obsługi slash-commands** (`rg 'slash' gateway/platforms/api_server.py` → 0 trafień),
  więc `/approve` i `/memory pending` są tam niedostępne.

### 2.4 System B — staging writeów (`tools/write_approval.py`)

Osobny mechanizm, **file-backed**, dla `memory` i `skills`.

| Element | Lokalizacja |
|---|---|
| włącznik `memory.write_approval` / `skills.write_approval` (default `False`) | `config_defaults.py:1728`, `:1902` |
| decyzja `evaluate_gate` | `write_approval.py:253` — off→allow; skills lub background→stage; memory+CLI→prompt inline; reszta→stage |
| zapis pending | `stage_write :114` → `~/.hermes/pending/<subsystem>/<id>.json` (`_pending_dir :110`) |
| odczyt/kasowanie | `list_pending :154`, `get_pending :169`, `discard_pending :180`, `pending_count :192` |
| wpięcie w memory tool | `tools/memory_tool.py:1114` → `_apply_write_gate :919`; aplikacja: `apply_memory_pending :1138` (omija gate); store bez agenta: `load_on_disk_store :887` |
| UI przeglądu | CLI `hermes_cli/write_approval_commands.py:54`; gateway `gateway/slash_commands.py:3584` (`/memory`), `:3628` (`/skills`) |

**Nasza ścieżka:** staged write wyląduje na dysku, ale **nie ma jak go zatwierdzić przez
api_server** — tylko host CLI / desktop / inna platforma gateway. Gate nigdy nie blokuje
na twardo, tylko odracza (`:270` — „no config-driven blocked outcome").

## 3. Per-tool permission config — ziarno = TOOLSET, nie tool

| Klucz | Gdzie | Znaczenie |
|---|---|---|
| `platform_toolsets.<platform>: [lista]` | `hermes_cli/tools_config.py:2279` (`_get_platform_tools`), przykłady `cli-config.yaml.example:991-1028` | biała lista toolsetów per platforma; nasza to `api_server` (`api_server.py:2652, 2873, 3231`) |
| `agent.disabled_toolsets: [lista]` | `config_defaults.py:277`, odejmowane `tools_config.py:2544`, `model_tools.py:438` | globalne odejmowanie, po wszystkim |
| lista toolsetów | `hermes_cli/tools_config.py:96-124` (`CONFIGURABLE_TOOLSETS`, 27 pozycji: `web`, `browser`, `terminal`, `file`, `image_gen`, `memory`, `skills`, `delegation`, `cronjob`, `computer_use`, …) | |
| własny toolset z dowolną listą toolów | `toolsets.py:950` (`create_custom_toolset`), rozwijanie `resolve_toolset :755` | najdrobniejsze ziarno osiągalne configiem |

**Nie ma klucza `disabled_tools`/`allowed_tools` per pojedynczy tool** — sprawdzone we
wszystkich pięciu plikach wyżej, jedyne trafienia to `disabled_toolset`**s**.

**„terminal wymaga zgody, browser wolny"** = *domyślne zachowanie* (tylko terminal
i execute_code mają gate). Odwrotnie („bramkuj browser") **nie da się configiem** —
potrzebny plugin `pre_tool_call` → `request_tool_approval` (§1.3).

## 4. Co Hermes daje, a co jest nasze

| Potrzeba | Hermes | Nasze |
|---|---|---|
| pauza agenta na zgodę | ✅ `/v1/runs` (§2.2) | ❌ na `/v1/chat/completions` |
| kolejka pending + timeout + fail-closed | ✅ `approval.py:2455, 3604` | — |
| endpoint rozwiązania | ✅ `POST /v1/runs/{id}/approval` | relay z naszego FastAPI |
| powiadomienie usera | ✅ event SSE `approval.request` | render w UI + POST wyboru |
| twarde on/off toolsetów per bot | ✅ `platform_toolsets` / `disabled_toolsets` | wpis w profilu |
| „ta akcja jest wrażliwa" poza shellem | ❌ | plugin `pre_tool_call` (§1.3) |
| kolejka review z historią/audytem | ❌ (in-memory, ginie z runem) | nasza tabela, jeśli potrzebna |

**Rekomendacja (najmniejszy uczciwy projekt):** przełączyć turę agenta z
`/v1/chat/completions` na **`POST /v1/runs` + SSE `/v1/runs/{id}/events`**. Nasz serwer
konsumuje `approval.request`, pokazuje userowi, odsyła `POST /v1/runs/{id}/approval`.
Hermes wnosi pauzę, kolejkę, timeout i endpoint — my piszemy tylko relay i UI.
Własna interception na chat/completions duplikuje całą tę maszynerię.
Uprawnienia per bot: `platform_toolsets.api_server` + globy `approvals.deny`. Własna
kolejka review dopiero przy wymogu audytu — wzorzec: `write_approval.stage_write` (§2.4).

## Konsekwencje dla fazy 13

1. Gate „bot wraca tylko po zgodę" **przechodzi bez pisania kolejki approvali** —
   pod warunkiem migracji na `/v1/runs`. Na obecnej ścieżce nie przejdzie wcale.
2. „Permission rules" = `platform_toolsets.api_server` + `approvals.deny` w config.yaml
   profilu bota. Ziarno toolsetowe; per-tool wymaga własnego toolsetu (`create_custom_toolset`).
3. „Sensitive actions routed through review" poza shellem = plugin `pre_tool_call`.
   Bez niego bramkujemy wyłącznie terminal i execute_code.

### Top 3 pułapki

1. **`approvals.mode: smart` jest DOMYŚLNY** (`config_defaults.py:2118`) — pomocniczy LLM
   sam zatwierdza „low-risk" niebezpieczne komendy. Dla floty botów ustawić `manual`
   (albo świadomie napisać `smart_policy`), inaczej „wraca po zgodę" jest cichą fikcją.
2. **`approval_session_key = run_id`** (`api_server.py:6574`) — `choice: "session"` umiera
   razem z runem; tylko `always` przeżywa (dysk, `save_permanent_allowlist`, `approval.py:2694`).
   Wybór „session" w UI będzie mylący dla usera.
3. **Cisza = deny, run-end = deny.** Timeout 300 s (`:2119`) oraz `unregister_gateway_notify`
   (`:2473`) rozwiązują wszystkie wpisy jako odmowę, a agent leci dalej z `BLOCKED`.
   Nasz serwer musi konsumować SSE natychmiast i trzymać połączenie — inaczej approvale
   wygasają po cichu, a bot raportuje „user odmówił", choć user nic nie widział.
