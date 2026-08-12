# Recon warstwy skilli Hermesa pod fazę 9 (teach-a-task, 2026-08-12)

Ścieżki bez prefiksu = `G:\Projects\hermes-agent\`.

## 0. Sprostowania do założeń zadania

1. **Skille są PER PROFIL, nie współdzielone.** `SKILLS_DIR = HERMES_HOME/"skills"`
   (`tools/skills_tool.py:144`), a `_skills_dir()` rozwiązuje żywy `HERMES_HOME`
   przy każdym wywołaniu (`:147-159`). Pod multipleksem = katalog bota.
   Feature #19 „shared across ALL bots" **nie jest domyślne** — to główna decyzja
   architektoniczna tej fazy (§1).
2. **Na naszej ścieżce czatu NIE MA `/slash`.** Dispatch slashy jest w
   `_handle_message` (`gateway/run.py:14884`, slashe `:16182-16240`), a
   `api_server` ma własne `_run_agent` → `run_conversation`
   (`gateway/platforms/api_server.py:6128, 6222`) i tamtędy nie przechodzi
   (grep `slash|is_command|startswith("/")` w `api_server.py` = 0). §3.
3. **`clarify` NIE JEST w toolsecie api_server** — wykluczony jawnie
   („no interactive UI tools like clarify or send_message", `toolsets.py:461`),
   a `agent.clarify_callback` nigdy nie jest tam ustawiane. §6.
4. **Nie ma dry-run ani self-critique dla skilli.** `dry_run` tylko w
   `tools/skills_sync.py:1321` i `hermes curator run --dry-run`
   (`agent/curator.py:248`); grep `self_critique|critique` w `agent/`+`tools/` = 0.
5. **Nie ma nagrywania akcji użytkownika.** `browser.record_sessions` produkuje
   `.webm` (`tools/browser_tool.py:4083-4106`), nie listę kroków.

## 1. Format i storage

**Format = standard agentskills.io**, wprost udokumentowany w docstringu
`tools/skills_tool.py:1-66`: katalog `<nazwa>/SKILL.md` + opcjonalne
`references/`, `templates/`, `scripts/`, `assets/`; kategoria = podkatalog
(`skills/<kategoria>/<nazwa>/SKILL.md`). Frontmatter YAML: `name` (wymagane,
≤64 zn. — `MAX_NAME_LENGTH`, `:161`), `description` (wymagane, ≤1024 zn., `:162`),
`version`, `license`, `platforms: [macos|linux|windows]`, `prerequisites`,
`compatibility`, `metadata.hermes.{tags,related_skills}`.
Nazwa katalogu: `^[a-z0-9][a-z0-9._-]*$` (`tools/skill_manager_tool.py:517`),
SKILL.md ≤ 100 000 znaków (`:513`).
Telemetria obok: `$HERMES_HOME/skills/.usage.json` (`tools/skill_usage.py:85-86`).

**Ścieżka.** Zapis zawsze do lokalnego katalogu: `_resolve_skill_dir` =
`_skills_dir()/[kategoria/]nazwa` (`skill_manager_tool.py:638-642`). Odczyt:
`get_all_skills_dirs()` = lokalny + `skills.external_dirs`
(`agent/skill_utils.py:582-591`), przy czym **external_dirs są read-only**
(`cli-config.yaml.example:838-845`, `agent/prompt_builder.py:1700-1704`).

**Dwie drogi do „shared across all bots" (#19):**

| | `skills.external_dirs` | junction `profiles/<bot>/skills` → wspólny |
|---|---|---|
| widoczność | tak (`skill_utils.py:499-577`) | tak |
| `skill_manage create` tam | **NIE** — zawsze lokalnie (`:638-642`) | tak |
| edycja/kasowanie | foreground tak, background review **NIE** (`skill_manager_tool.py:341-352`) | tak |
| `.usage.json`, pin, kurator | osobne per bot | wspólne |

**Wybieramy junction.** Zweryfikowane empirycznie na `.venv` (Python 3.12.10,
`mklink /J`): `Path(junction).rglob("SKILL.md")` i `os.walk(junction,
followlinks=True)` przechodzą, a `os.path.islink()` na junctionie zwraca `False`
— żadna logika pomijania symlinków nie zadziała. Kod skanujący i tak używa
`followlinks=True` (`skill_utils.py:896`, `prompt_builder.py:1493`). Wzorzec
`_link()` mamy w `server/plugins.py:111-141`. **Celem junctiona ma być
`$SLAFY_DATA_DIR/skills`** (katalog skilli głównego `HERMES_HOME` gatewaya) —
wtedy zbindowany w import-time `SKILLS_DIR` (pułapka 1) wskazuje to samo.

## 2. `skill_manage` — pełny kontrakt

Rejestracja: `registry.register(name="skill_manage", toolset="skills", ...)`
(`tools/skill_manager_tool.py:1792-1810`), schemat `SKILL_MANAGE_SCHEMA`
(`:1690-1785`), dispatcher `skill_manage()` (`:1542-1580`).

Akcje (`enum`, `:1710-1712`): **`create`, `patch`, `edit`, `delete`,
`write_file`, `remove_file`**. Wymagane zawsze: `action`, `name` (`:1784`).
`create`/`edit` — `content` = pełny SKILL.md (+ opcjonalne `category` tylko przy
create); `patch` — `old_string`/`new_string` (+ `replace_all`, `file_path`
domyślnie SKILL.md); `delete` — `absorbed_into` (intencja dla kuratora);
`write_file`/`remove_file` — `file_path` MUSI leżeć pod
`references/|templates/|scripts/|assets/` (`:1578-1600, 1758-1762`).

Walidacja `create` (`_create_skill`, `:908-968`): nazwa (`_validate_name` `:527`),
kategoria, frontmatter (`_validate_frontmatter(new_skill=True)` `:566` — dla nowych
skilli `description` musi zmieścić się w 60 zn., `SKILL_PROMPT_DESC_LIMIT`
`skill_utils.py:849`), rozmiar (`:623`), kolizja nazw w całym `get_all_skills_dirs`
(`_find_skill` `:645-662`), atomowy zapis, **skan bezpieczeństwa z rollbackiem**
(`_security_scan_skill`, rmtree przy blokadzie, `:944-948`).
Po sukcesie: `clear_skills_system_prompt_cache(clear_snapshot=True)` (`:1614-1616`).

**Bramka zatwierdzania**: `_apply_skill_write_gate` (`:1431-1461`) czyta
`skills.write_approval` (`tools/write_approval.py:59-67, 74-79`). Domyślnie
`False` = zapisy przechodzą; gdy `True`, **każdy** zapis skilla jest stagowany do
ręcznej akceptacji (nigdy inline — „skills never take the inline path",
`write_approval.py:264-268`). **Nie włączać.**

## 3. Wstrzykiwanie do kontekstu — trzy poziomy

1. **Indeks w system prompcie** (zawsze) — `build_skills_system_prompt`
   (`prompt_builder.py:1686-1935`): `kategoria:` → `- nazwa: opis` (opis ucięty do
   60 zn.). Cache dwupoziomowy: LRU w procesie + snapshot na dysku
   `$HERMES_HOME/.skills_prompt_snapshot.json` walidowany manifestem mtime
   (`:1457-1467, 1517-1551`).
2. **`skills_list`** — metadane (progressive disclosure tier 1).
3. **`skill_view(name[, file_path])`** — pełna treść / plik wsparcia (tier 2-3).

Toolset `skills` = `["skills_list","skill_view","skill_manage"]`
(`toolsets.py:199-203`) i **wszystkie trzy są w `hermes-api-server`**
(`toolsets.py:476`), który jest domyślnym toolsetem naszej platformy
(`hermes_cli/platforms.py:42`). Nasz `_CONFIG_YAML` nie nadpisuje `tools:`
(`server/gateway.py:121-136`) → działa bez zmian.

**`/slash` (#19).** Mechanizm istnieje, ale nie na naszej ścieżce (§0.2). Do
reużycia wprost z Pythona (`agent/skill_commands.py`): `scan_skill_commands()`
(`:402-497`), `resolve_skill_command_key()` (`:578`),
`build_skill_invocation_message()` (`:597-660`), `split_stacked_skill_commands()`
(`:661-692`, `/a /b tekst`), `build_stacked_skill_invocation_message()` (`:693`).
Zwracają gotowy tekst wiadomości użytkownika z wklejonym CAŁYM ciałem skilla —
wystarczy podmienić `message` przed `httpx.post` w `gateway.chat()`.
`_load_skill_payload` (`:210-247`) woła `skill_view()`, który rozwiązuje ścieżkę
**live** (`skills_tool.py:575, 700, 804, 1181`) — bezpieczne pod multipleksem.

## 4. Config — sekcja `skills:`

`cli-config.yaml.example:832-845` — cała sekcja ma **dwa** udokumentowane klucze:
`creation_nudge_interval: 15` (0 = off; co N iteracji narzędziowych przypomnij
o zapisie skilla) i zakomentowane `external_dirs: [...]` (read-only, `~`/`${VAR}`
rozwijane). Klucze wyłącznie w kodzie: `skills.disabled: [nazwy]` +
`skills.platform_disabled.<platforma>: [nazwy]` (`agent/skill_utils.py:436-470`,
ukrywa skill z indeksu i slashy) oraz `skills.write_approval: bool`
(`tools/write_approval.py:67, 74-79`, §2).

**Uwaga na default**: przykład configu mówi 15, kod mówi **10**
(`agent/agent_init.py:1797-1801`) — świeży profil bez sekcji `skills:` = 10.

**Co ustawiamy per profil**: nic obowiązkowego. `creation_nudge_interval`
wolno **podnieść** (ciszej w trakcie demonstracji), ale **nie zerować** — `0`
wyłącza cały trigger background review (`turn_finalizer.py:731-733`), czyli
silnik #20. `external_dirs` NIE ustawiamy — wybieramy junction (§1).

## 5. Pętla samodoskonalenia — co już jest

**Nudge**: po turze, jeśli `_iters_since_skill >= _skill_nudge_interval` i
`skill_manage` jest w toolsecie → `_should_review_skills = True`
(`agent/turn_finalizer.py:731-738`).

**Background review** (`agent/background_review.py`): odpalany z
`turn_finalizer.py:746-765` **po dostarczeniu odpowiedzi**, gdy `final_response
and not interrupted and not skip_background_review`. Forkuje osobnego `AIAgent`
z whitelistą `{memory, skill_manage}` (`:449`). Prompt (`:200-360`) narzuca
kolejność: **1)** zpatchuj skill użyty w tej sesji, **2)** zpatchuj istniejący
umbrella, **3)** dodaj plik wsparcia przez `write_file`, **4)** dopiero nowy
skill klasowy. Sygnały: korekta użytkownika, frustracja, skill okazał się
zły/nieaktualny (`:320-330`). **Tak, potrafi edytować istniejący skill** — to
jego pierwszy wybór. Artefakty: `SKILL.md` + `references/|templates/|scripts/`,
wpisy w `memories/*.md`.

**Ograniczenia forka** (`_background_review_preflight` `:454-460` →
`_background_review_write_guard` `:301-400`): odmawia zapisu do skilli pinned,
external, protected-builtin, hub-installed **oraz do każdego, który nie ma
`created_by: "agent"` w `.usage.json`** (`:381-400`,
`skill_usage._is_curator_managed_record:485-505`). Marker stawia wyłącznie
`create` wykonany **wewnątrz forka** (`skill_provenance.is_background_review()`,
`skill_usage.mark_agent_created:982-989`). `delete` w forku archiwizuje zamiast
kasować (`skill_manager_tool.py:1261-1275`).

**Czego brakuje dla #20**: (a) dry-run — zero kodu; (b) self-critique wiązany z
uruchomieniem konkretnego skilla — background review jest ogólny („czy było się
czegoś nauczyć"), nie ma ścieżki „uruchom → oceń wynik → popraw ten skill";
(c) kurator (`agent/curator.py`) robi konsolidację/prune na skalę — nam
niepotrzebny.

## 6. `clarify` (#21)

Tool istnieje: `tools/clarify_tool.py:256-269`, schemat `:188-247` —
`question` (wymagane), `choices` (≤ `MAX_CHOICES = 4`, `:23`), `multi_select`.
Dispatcher `agent/tool_executor.py:1819-1826` przekazuje `agent.clarify_callback`.
**Gdy callback jest `None` → `tool_error("Clarify tool is not available in this
execution context.")`** (`clarify_tool.py:159-160`).

Na naszej ścieżce callback nie jest ustawiany, a tool jest poza toolsetem
api_server (§0.3). Prymityw blokujący istnieje: `tools/clarify_gateway.py:81-182`
(`register` → `wait_for_response(clarify_id, timeout)` →
`resolve_gateway_clarify(clarify_id, response)`), wzór podpięcia
`gateway/run.py:5172-5254`. Ale api_server świadomie wiąże
`async_delivery=False` — „the stateless HTTP path can never wake the agent after
the turn ends" (`api_server.py:6100-6126`) — więc odpowiedź musiałaby przyjść
drugim requestem, gdy pierwszy wisi.

**Werdykt #21: nie reużywamy `clarify`.** Instrukcja w prompcie skilla („zanim
wykonasz, dopytaj o brakujące parametry") — bot pyta zwykłym tekstem, użytkownik
odpowiada następną turą. Zero kodu.

## 7. Nagrywanie demonstracji

**Ślad narzędziowy agenta (jest).** `hermes_state.db`, tabela `messages`
(`hermes_state_common.py:266-290`): `session_id, role, content, tool_call_id,
tool_calls TEXT, tool_name, timestamp, token_count, api_content, ...` — pełny
JSON wywołań w `tool_calls`. To transkrypt tego, co robił **bot**; nadaje się do
syntezy skilla z sesji, w której bot wykonał zadanie sam.

**Akcje użytkownika (nie ma nic).** `record_sessions` daje wideo (§0.5).
`browser_cdp` **nie nadaje się do nagrywania**: „Each stateless call (without
frame_id) is independent — sessions and event subscriptions do not persist
between calls" (`tools/browser_cdp_tool.py:578-582`).

**Co mamy przez własny mostek.** Provider odpala Chromium z
`--remote-debugging-port` i oddaje `cdp_url = http://127.0.0.1:<port>`
(`server/browser_plugin/provider.py:182-193`) → przez `/json/list` dostajemy
surowy WebSocket i **wszystkie domeny CDP bez ograniczeń**; mostek WS i tak
budujemy na `Page.startScreencast` (BROWSER-RECON.md:37-39, 57).
**CDP nie ma domeny „subskrybuj input użytkownika"** — `Input.*` jest wyłącznie
do wstrzykiwania. Działający wzorzec: `Page.addScriptToEvaluateOnNewDocument`
(listenery `click`/`input`/`change`/`submit` w capture phase, do każdego nowego
dokumentu i ramki) + `Runtime.addBinding` (kanał ze strony do nas) +
`Page.frameNavigated`/`Page.lifecycleEvent` na nawigacje. Selektor liczymy w JS
w momencie kliknięcia (tekst, `aria-label`, rola, `data-testid` — nie XPath).

## 8. Replay — którą drogą do bramki

Bramka: „Recorded 3-step browser task replays successfully as a skill".

| | skill z krokami w języku naturalnym | deterministyczny skrypt akcji |
|---|---|---|
| co pisze `skill_manage create` | `SKILL.md` z listą kroków | `scripts/replay.json` przez `write_file` |
| kto wykonuje | agent swoimi `browser_*` (`toolsets.py:478-483`) | nasz runner po CDP |
| ile kodu Hermesa reużywamy | **wszystko** | prawie nic |
| kruchość | model może zmienić kolejność / halucynować krok | drift selektorów, wyścigi czasowe, brak adaptacji do zmian UI |
| samonaprawa (#20) | `skill_manage patch` działa wprost | trzeba nagrać od nowa |

**Bierzemy wersję NL.** Skill = `SKILL.md` z ponumerowanymi krokami (URL + cel
kroku + selektor/tekst jako *wskazówka*, nie kontrakt), wykonanie = zwykła tura
agenta z toolsetem `browser_*`, czyli ścieżka, którą faza 4 już waliduje. Surowy
log akcji z §7 leci obok jako `references/recording.json` (`write_file`) —
materiał dla promptu syntezy i autopoprawy, nie wejście runnera.

## 9. Pułapki

1. **`scan_skill_commands` czyta `SKILLS_DIR` zbindowany w import-time**
   (`agent/skill_commands.py:412, 420-421`), a nie `_skills_dir()` — i cachuje
   mapę w procesowym globalu `_skill_commands` bez klucza profilu (`:24, 498-510`).
   Pod multipleksem = katalog gatewaya, nie bota. Junction na
   `$SLAFY_DATA_DIR/skills` (§1) sprawia, że oba wskazują to samo; inaczej
   `/slash` pokazywałby skille złego bota.
2. **Skill stworzony przez foreground (nasz flow teach-a-task) jest „user-owned"
   i background review NIE MOŻE go tknąć** (`skill_manager_tool.py:381-400`).
   #20 („bot poprawia własny skill bez proszenia") wymaga świadomego
   `skill_usage.adopt_skill(name)` (`tools/skill_usage.py:596-637`) zaraz po
   utworzeniu, albo pisania własnej pętli poprawy. To dokładny analog buga
   drift-guard z fazy 6: cicha odmowa zapisu, nie wyjątek.
3. **Granica procesu.** Nasz serwer i gateway to DWA procesy (`ensure_running`
   → `Popen` z `HERMES_HOME` tylko dla dziecka, `server/gateway.py:272-288`).
   Każdy helper Hermesa wołany z NASZEGO procesu (`build_skill_invocation_message`,
   `adopt_skill`, `reload_skills`, `clear_skills_system_prompt_cache`) rozwiązuje
   `get_hermes_home()` u siebie — bez `HERMES_HOME=$SLAFY_DATA_DIR` (albo
   `hermes_constants.set_hermes_home_override`, `:45`) trafi w domyślne
   `~/.hermes`. Te same wywołania czyszczą wyłącznie NASZE cache — po stronie
   gatewaya indeks samoleczy się przez sygnaturę mtime + TTL 30 s
   (`skills_tool.py:100-117`) i manifest snapshotu (`prompt_builder.py:1530`),
   ale **system prompt żywej sesji nie** (agent siedzi w cache gatewaya) —
   tam ratuje dopiero `/new`. Analog drift guarda z fazy 8.
4. **`adopt_skill` oddaje skill kuratorowi, a kurator kasuje po bezczynności.**
   `maybe_run_curator` chodzi w pętli housekeepingu gatewaya
   (`gateway/run.py:27365-27373`), `is_enabled()` domyślnie **True**
   (`agent/curator.py:154-157`), interwał 7 dni (`:70`), archiwizacja po
   `archive_after_days = 90` (`:73, 322`). Skill nauczony i nietknięty przez
   kwartał zniknie sam. Albo `curator.enabled: false` w configu profilu, albo
   `hermes curator pin <name>` po utworzeniu.

## Konsekwencje dla fazy 9

**Bierzemy jak stoi (0 linii kodu):** format agentskills.io + `SKILL.md`,
`skill_manage` (6 akcji) z walidacją, skanem bezpieczeństwa i atomowym zapisem,
progressive disclosure (indeks w prompcie → `skills_list` → `skill_view`),
`background_review` jako silnik samopoprawy, toolset `browser_*` jako runner
replayu. `skill_manage` jest już w toolsecie api_server — bot potrafi zapisać
skill **dziś**, bez naszej zmiany.

**Cienka warstwa slafy-bota:**
1. `_ensure_skills_link(bot_id)` w `server/gateway.py` obok
   `_ensure_browser_config` — junction `profiles/<bot>/skills` →
   `$SLAFY_DATA_DIR/skills` (wzorzec `server/plugins.py:111-141`). Robić **przed
   pierwszym startem profilu**, żeby seeding bundled skilli
   (`tools/skills_sync.py:675`) nie zrobił z tego prawdziwego katalogu.
2. Rekorder: WS po istniejącym `cdp_url` —
   `Page.addScriptToEvaluateOnNewDocument` + `Runtime.addBinding` +
   `Page.frameNavigated`, wynik jako JSON kroków (§7). Dzieli połączenie
   z mostkiem screencastu z fazy 4.
3. Synteza: jedna tura promptem „oto nagranie, napisz SKILL.md" → bot woła
   `skill_manage(create)` + `write_file references/recording.json`. Zaraz po tym
   `skill_usage.adopt_skill(name)` (pułapka 2) **+ pin** (pułapka 4).
4. `/slash` w `gateway.chat()`: `message` na `/` → `resolve_skill_command_key` +
   `build_skill_invocation_message` (`skill_commands.py:578, 597`). ~10 linii.
5. REST/UI: CRUD skilli = operacje na plikach we wspólnym katalogu
   (`GET/PUT/DELETE /api/skills[/{name}]`); gateway podchwyci zmianę sam
   (mtime/TTL), sesja w toku dopiero po `/new` (pułapka 3).
6. Dry-run (#20): prefiks „opisz kroki, NIE wykonuj ich" — prompt, nie mechanizm.

Punkty 3-5 wołają kod Hermesa z NASZEGO procesu → `HERMES_HOME` musi tam
wskazywać `$SLAFY_DATA_DIR` (pułapka 3).

**Config per profil:** nic obowiązkowego. Opcjonalnie `skills.creation_nudge_interval`.
**Nie włączać** `skills.write_approval` (zestaguje każdy zapis) ani
`skills.external_dirs` (read-only wyklucza edycję i kasowanie z #19).

**Czego NIE piszemy:** własnego formatu skilli, własnego CRUD-a plików skilli,
własnego runnera replayu, własnego `clarify`.
