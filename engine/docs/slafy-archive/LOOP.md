# LOOP — stan pętli budowy

STATUS: DONE
FAZA: 13 (ostatnia) — ZAMKNIĘTA
NASTĘPNE: pętla skończona. Ewentualna faza 14 = łączenie z OpenMausBot
(decyzja kierunkowa Kacpra, poza tą pętlą).

## DECYZJE

- Nazwa produktu: **slafy-bot**.
- Repo: **prywatne** `clewkord/slafy-bot` (utworzyć, auto-push na main aktywny).
- Provider API dev: **OpenRouter** — klucz w `.env` (Kacper wpisze; do tego czasu testy z mockiem).
- Środowisko dev: **ten PC (Windows 10)**. Kacper wybrał wcześniej "VPS", ale nie wie, czym VPS jest i żadnego nie ma — wybrany wariant prostszy: build+run lokalnie, Playwright dla Tier 1. Deploy na VPS = ewentualna przyszłość, poza zakresem pętli.
- Budżet: **bez przerwy do końca** (fazy 0-13 non stop, bez checkpointu po fazie 3).
- (2026-08-12, Kacper) **Maksymalny reuse kodu Hermesa** — nie pisać od zera niczego,
  co Hermes już ma. UI fazy 2: recon (docs/reference/WEB-RECON.md) wykazał, że fork
  całego `web/` nie ma sensu (messengera tam nie ma, to admin dashboard z terminalem
  xterm) — reuse = design system `@nous-research/ui@0.18.2` z npm (PIN!), `index.css`
  z tokenami, fonty, `Markdown.tsx` (streaming), `ChatSessionList.tsx`,
  `events-reconnect.ts`, wzorzec JSON-RPC po WS. Świeży Vite + te pliki.
- (2026-08-12, Kacper) **Równoległość**: zadania bez zależności wykonywać wieloma
  subagentami naraz (kilka-kilkanaście), nie sekwencyjnie. Interfejsy pinowane w
  planie fazy = kontrakt między równoległymi subagentami; commit robi główna sesja
  po integracji, subagenty nie commitują.

## DZIENNIK

- 2026-08-12: repo zainicjowane, plan + speki + biblioteka klatek gotowe
  (PLAN.md, docs/UI-SPEC.md, docs/reference/). Pętla jeszcze nie ruszyła.
- 2026-08-12: KROK 0 zamknięty, DECYZJE zapisane. Utworzone prywatne repo
  `clewkord/slafy-bot`, remote origin, push OK. Faza 0 ruszyła: plan
  docs/plans/faza-0.md, klon hermes-agent w G:\Projects\hermes-agent (poza repo).
- NOTKA (faza 0): transkryptów .clean.txt jest 5/6 — brak `F1_0Lkp16Rc.clean.txt`
  (jest tylko hd-report). Nie blokuje; UI budować z klatek + pozostałych 5.
- NOTKA (fazy 2+): przed `playwright install` ustawić `PLAYWRIGHT_BROWSERS_PATH`
  na D:/G: — domyślnie instaluje na C:, a C: jest zakazane.
- 2026-08-12: GATE FAZY 0 ZIELONY — docs/HERMES-FACTS.md zapisany (recon subagenta
  Opus 5); połowa gate'a (UI-SPEC v2) spełniona przed pętlą. FAZA: 1.
- NOTKA (faza 1): `HERMES_HOME` na Windows defaultuje na `%LOCALAPPDATA%\hermes`
  (C:!) — zawsze jawnie ustawiać na G:/D:. Osadzenie: startujemy od opcji
  gateway+api_server (HTTP/SSE, port 8642), nie embed AIAgent — szczegóły
  HERMES-FACTS §8/§Konsekwencje.
- NOTKA (faza 4): recon browser providera GOTOWY — docs/reference/BROWSER-RECON.md
  (ABC, pułapka: cache providera per proces, reaper 120 s).
- 2026-08-12: FAZA 1 zadania 1-4 zielone (18 testów; bot CRUD na hermes_cli.profiles,
  BYOK, FastAPI + gateway manager + chat proxy). Task 5 (gate E2E z realnym
  gatewayem) w toku.
- 2026-08-12: FAZA 2 zadania 1-6 zrobione RÓWNOLEGLE (scaffold ui/, shell, sidebar,
  czat, kreator z avatar pickerem, prawy panel) — build zielony. Luka §14.1 (avatar
  picker): najbliższy odpowiednik grid 7 kształtów × 7 kolorów. Luka §14.4: brak
  niebieskiego tokenu w DS — użyto Tailwind blue-500. DS-owy leva (opcjonalny peer)
  zastubowany w vite.config. Notifications toggle: lokalny stan, persist w fazie 3.
  Zostaje Task 7 (Playwright smoke) — po gate'cie fazy 1.
- 2026-08-12: **GATE FAZY 1 PASS** — E2E na realnym `hermes gateway` (Windows OK,
  start ~10 s): create bot → chat (mock LLM SSE) → kill → restart → bot jest,
  historia sesji z hermes_state.db kontynuowana (podwójny zapis API_SERVER_KEY
  env+profil .env potwierdzony). 19 passed, 1 skipped (OpenRouter smoke — brak
  klucza w .env). Fix: port gatewaya w write_config liczony z SLAFY_GATEWAY_URL.
  ODKRYCIE: pętla Hermesa zawsze streamuje do LLM — mock musi mówić SSE i mieć
  base_url kończące się /v1 (docstring mock_llm.py o reuse nieaktualny — mock
  gate'a żyje w test_gate_faza1.py). CodeRabbit wisiał 22 min bez outputu —
  review fazy zrobiona recenzją subagentową przy fazie 2/3.
  Checklista §2: #37 częściowo (pamięć sesji przeżywa restart).
- 2026-08-12: **GATE FAZY 2 PASS** — Playwright smoke (create bot → chat → reply
  z mocka SSE, 1 passed 14.5 s), asercje layoutu §1 w tolerancjach (sidebar 230,
  panel 280, bąbel <=580). Screenshot ui/e2e/artifacts/shell.png. Naprawione:
  update_bot whitelist wycinała avatar (server/bots.py:89). Dopisane 4 runtime
  deps (three, gsap, @react-three/fiber, @observablehq/plot) — DS ewaluuje
  opcjonalne peery przy inicie modułu, bez nich dev mode padał (build przechodził).
  Checklista §2: #1 częściowo (3 kolumny, bez collapsed sidebar), #2 częściowo
  (avatar picker bez upload/generate — luka §14.1). FAZA: 3.
- 2026-08-12: **GATE FAZY 3 PASS** — realtime.spec.ts: dwie karty widzą wątek na
  żywo (user bubble, working indicator, reply z mocka — wszystko po WS bez
  reloadu), dedup POST/WS OK (1 bąbel), trzeci kontekst widzi historię z
  hermes_state (lazy seed GET /messages). 2 specy Playwright + 27 pytest zielone.
- 2026-08-12: **GATE FAZY 4 PASS** — 43 pytest zielone. Provider `slafy`
  (persistent chromium per profil, HERMES_HOME contextvar per żądanie multiplexu
  zweryfikowany), mostek CDP (screencast everyNthFrame:1 + fps przez opóźniany
  ack — inaczej czarny ekran na statycznej stronie; discovery targetu /json/list;
  VK dla klawiszy specjalnych), UI ComputerView z take-over. Gate: login przez
  take-over → restart → cookie przetrwało; izolacja: drugi bot nie widzi sesji.
  Checklista §2: #13 częściowo (persistent computer+logins, bez file manager/
  terminala w UI), #14 częściowo (live view + take over desktop; telefon = ta
  sama PWA, nietestowany), #17 częściowo (browser-first, per-bot sesje).
  LIMITY: take-over nie pauzuje agenta; zoom strony może rozjechać współrzędne;
  #15 (localhost serving/screenshots do czatu) i #16 (lokalny komputer usera)
  — nieruszone, fazy 6+/13. FAZA: 5.
- 2026-08-12: **GATE FAZY 5 PASS** — 69 pytest zielone. Warstwa MCP: plugins.json
  wspólny, mcp-tokens przez junction (_winapi.CreateJunction, bez admina),
  rozprowadzanie mcp_servers do config.yaml profili. REST /api/plugins + katalog
  9 manifestów (linear/figma/comfy/unreal potwierdzone z optional-mcps Hermesa;
  github/notion/context7/slack/files niezweryfikowane URL — do sprawdzenia).
  Marketplace UI (PluginsModal, PluginCard z OAuth poll). Gate: bot A instaluje,
  bot B używa bez reconnectu (config+token współdzielony); serwer MCP stdio
  odpowiada protokołem. WAŻNE: doinstalowano mcp==1.28.1 + starlette==1.3.1
  (piny Hermesa) — bez tego _MCP_AVAILABLE=False i cała warstwa MCP Hermesa to
  no-op; po instalacji AVAIL/HTTP/NEW_HTTP=True (flaga lazy przez _ensure_mcp_sdk).
  README zaktualizowane. OAuth flow: oauth_hint (hermes mcp login), realny
  oauth_url odłożony na fazę 13. Checklista §2: #22 (marketplace, OAuth przez
  hint), #23 (shared across bots — pełne), #24 (multi-account przez duplikat),
  #26 (custom install), #27 (katalog launch set), #28 (browser fallback z fazy 4).
  #25 (@plugin mention w czacie) — faza 13. FAZA: 6.
- 2026-08-12: **GATE FAZY 6 PASS** (po fixie) — 89 pytest zielone. Rutyny = cron
  per profil (use_cron_store), webhook trigger nasz HMAC (X-Slafy-Signature,
  fire-and-forget gateway.chat), panel rutyn UI (RoutineDetail, presety schedule).
  Gate scenariusz B (webhook): 200 + gateway.chat, zły HMAC 401. Scenariusz A
  (scheduled app-closed): gate wykrył REALNY BUG — routines.create liczył snapshot
  providera w scope roota (huggingface), ticker odpala w scope profilu (custom),
  drift-guard Hermesa (#44585) pomijał KAŻDĄ rutynę. Bez fixu żadna scheduled
  routine nie odpaliłaby się w produkcji. FIX: _profile_scope opakowuje
  create_job/update_job w set_hermes_home_override(profil) — snapshot liczony w
  scope profilu. Zweryfikowany realnym tickiem (gateway ~10 s, job status ok,
  mock dostał prompt). Checklista §2: #29 (tworzenie rutyn — formularz+presety,
  konwersacyjne w fazie 13), #30 (schedule + webhook trigger), #32 (app-closed
  przez ticker gatewaya). #31 (rekomendacje rutyn) — faza 13. FAZA: 7.
- NOTKA (faza 13): zmiana providera bota PO utworzeniu rutyny wywoła drift-skip
  Hermesa — UI powinno ostrzegać albo re-snapshotować rutyny przy zmianie modelu.
- 2026-08-12: **GATE FAZY 6 PASS** (po fixie) — 89 pytest zielone. Rutyny = cron
  joby Hermesa per profil (use_cron_store), REST + panel UI (RoutinesSection,
  RoutineDetail z presetami schedule), webhook trigger wariant (a): nasz HMAC
  X-Slaf
  Checklista §2: #7 częściowo (desktop sync; mobile layout jest, telefon fizycznie
  nietestowany), #37 częściowo (historia w UI). NOTKA: lista botów nie odświeża
  się między kartami (brak eventu bot_created w WS) — dodać przy fazie 7 (group
  chaty i tak wymuszą eventy botów). FAZA: 4.

- 2026-08-12: **GATE FAZY 7 PASS** — 108 pytest + 2 specy Playwright zielone.
  Inter-bot: `server/interbot.py` (delegate przez gateway.chat, wątek read-only
  per PARA botów w `$SLAFY_DATA_DIR/interbot/`, depth-limit 3 anty-pętla;
  route_by_description = keyword overlap title+description, bez embeddingów;
  @mention w POST /chat UZUPEŁNIA odpowiedź polem `delegated`, kontrakt
  {reply, session_id} nietknięty). Grupy: `server/groups.py` (groups.json,
  run() = tura per bot + owner po opisie, fallback pierwszy w pokoju), REST
  /api/groups + WS event `group` per tura + GET /api/bots/{id}/interbot.
  UI: Composer @ roster (boty+pluginy), InterbotThread read-only (§5),
  GroupChatView (owner chip, TurnLabel), NewGroupDialog, sidebar `+` menu
  New Bot/New Group Chat (smoke.spec dostosowany: dwa kliki). Gate: wybór
  bota PO OPISIE wymuszony wabikiem (bot o NAZWIE = słowo taska, score 0).
  Checklista §2: #33 (delegacja po opisie), #34 (transparency event + wątki
  §5), #35 częściowo (owner po opisie = prosty chief-of-staff; bez multi-hop
  handoffu), #36 częściowo (context sharing = wspólny wątek pary + tury
  pokoju; bez współdzielenia pamięci — faza 8). LIMITY (faza 13): wątki
  inter-bot w UI tylko session-local (brak listy w RightPanel po reloadzie);
  eventy group PO rundzie, nie live per-tura; owner bez per-bubble oznaczenia.
  FAZA: 8.

- 2026-08-12: **GATE FAZY 8 PASS** — 125 pytest + 3 specy Playwright zielone.
  Pamięć: `server/memory.py` czyta bazę holografu profilu WYŁĄCZNIE read-only
  (`file:...?mode=ro` — żywy gateway trzyma plik; `MemoryStore.search_facts`
  podbijałby `retrieval_count`), `q` przez `LIKE ESCAPE` a nie `facts_fts MATCH`
  (FTS5 wywala się na surowym wejściu, sanitizer Hermesa OR-uje tokeny — dobre
  do promptu, złe jako filtr). Graf DWUDZIELNY fakt↔encja (tabeli `links` NIE
  MA), krawędzie joinowane z obiema tabelami, więc żadna nie wskazuje pustki.
  `gateway._ensure_memory_config` włącza holograf per profil (domyślnie OFF).
  REST /memory/{facts,graph,markdown}. UI: MemorySection w RightPanel +
  MemoryGraph (force layout na d3-force, węzły SVG z `data-node-id`).
  GATE A (mocny): mock LLM emituje PRAWDZIWY `tool_calls` na narzędzie `memory`,
  agent zapisuje fakt, gateway UBITY, druga sesja z INNYM session id — marker
  wraca w kontekście modelu, a wiadomość z sesji 1 NIE (dowód: recall to
  pamięć, nie historia wątku). GATE B: graf z realnego `MemoryStore` +
  spec Playwright (render węzłów, klik fakt i hub-encja).
  Checklista §2: #37 (pełne — pamięć trwała + RAG prefetch top 5 na turę),
  idea E (graf pamięci). Learning loop = nudge co N iteracji + background
  review po turze (whitelist {memory, skill_manage}) — działa przez nasz
  gateway BEZ naszego kodu; wyłącza go tylko `skip_background_review` (cron).
  DOINSTALOWANE: numpy (bez niego HRR martwy — probe/related/reason puste).
  LIMITY: `MEMORY.md` tylko do odczytu (drift guard Hermesa kasuje pamięć przy
  złym formacie zapisu); auto_extract wyłączony (regexowa ekstrakcja robi
  śmieci — fakty dodaje model przez `fact_store`). FAZA: 9.

- 2026-08-12: **GATE FAZY 9 PASS** — 153 pytest + 3 specy Playwright zielone.
  Teach-a-task: rekorder CDP (`server/teach.py` — reuse `_Cdp` z computer.py,
  recorder JS przez `Page.addScriptToEvaluateOnNewDocument` + `Runtime.
  addBinding slafyTeach` + top-frame `Page.frameNavigated`), transkrypt NL
  (scalanie inputów per selektor), synteza = bot sam tworzy skill przez SWÓJ
  `skill_manage` (prompt z transkryptem + sekcje #21 clarifying i #20
  self-critique), adopt_skill z checkiem odmowy (zwraca (False, msg) zamiast
  rzucać). Skille WSPÓLNE przez junction `profiles/<bot>/skills` →
  `$SLAFY_DATA_DIR/skills` (`server/skills.py`, retrofit istniejących);
  `/slash` w gateway.chat przez `resolve_skill_command_key` +
  `build_skill_invocation_message` (jawny `scan_skill_commands` — leniwy glob
  nie widziałby świeżych skilli w długo żyjącym serwerze); REST CRUD
  /api/skills; kurator wyłączony per profil (auto-archiwizacja 90 dni). UI:
  Teach a task (czerwona ramka "watching and learning", chip Learn from
  demonstration), SkillsSection (edycja inline, delete), `/` popup w
  composerze. GATE A: realny chromium + 3 kroki mostkiem take-over →
  transkrypt 3 linie w kolejności. GATE B: realny gateway — agent WYKONUJE
  skill_manage create (tool_call mocka) → SKILL.md we wspólnym katalogu,
  widoczny z profilu DRUGIEGO bota; `/demo-task` → invocation z krokami →
  realny browser_navigate w procesie gatewaya → strona bota MA docelowy URL.
  Sonda: gateway oferuje modelowi browser_*/skill_manage/skill_view/
  skills_list. Checklista §2: #18 (nagranie → skill), #19 (slash + shared +
  edit/delete), #20 częściowo (adopt + instrukcja self-critique w skillu;
  realna samopoprawa wymaga prawdziwego LLM), #21 (instrukcja clarifying
  questions w skillu — `clarify` tool martwy na HTTP, toolsets.py:461).
  LIMITY (faza 13): karta otwarta W TRAKCIE nagrania nieobjęta (polling
  targetów); brak GET statusu teach (ramka po reloadzie wraca z eventem WS);
  selektory nieescapowane (hint dla modelu, nie kontrakt runnera). FAZA: 10.

- 2026-08-12: **GATE FAZY 10 PASS** — 168 pytest + 4 specy Playwright zielone.
  Voice: dyktowanie = Web Speech API w Composerze (interim na żywo, prefiks
  zachowany; pulsująca czerwona kropka; unmount gasi mikrofon), fallback
  MediaRecorder + POST /voice (501 = mikrofon off na sesję z podpowiedzią);
  odpowiedzi głosem = hover-głośnik na bąblu bota, POST /speak (edge_tts,
  pl-PL-MarekNeural, w .venv, bez klucza). Backend: voice.py (transcribe przez
  hermesowe transcribe_recording pod scope profilu — helper NIE rzuca przy
  braku providera, dwa stringi błędu mapowane na LookupError → 501; cisza =
  pusty transkrypt bez budzenia agenta), _ensure_stt_config (stt.language pl —
  mina: default "en" globalny), POST /chat zrefaktorowany do _run_chat
  współdzielonego z /voice (eventy identyczne z konstrukcji). MINA C: ROZBROJONA
  jedną linią: Starlette spooluje multipart >1MB przez SpooledTemporaryFile bez
  dir= (%TEMP% na C:) — voice.py ustawia tempfile.tempdir na katalog danych.
  GATE: spec Playwright, emulacja iPhone 14 (chromium — webkit nieinstalowany,
  silnik nie zmienia naszego okablowania), stub webkitSpeechRecognition
  (headless nie ma realnego STT — usługa vendora), klik mikrofonu → tekst w
  composerze → wysyłka → bąbel + odpowiedź mocka. Checklista §2/wiersz F:
  dyktowanie DONE (UI-SPEC §10: "No live conversation mode at launch" —
  zgodnie ze spec). Serwerowe STT wymaga GROQ_API_KEY albo faster-whisper
  (wtedy HF_HOME na D:! — mina C:); OpenRouter nie odblokowuje STT/TTS.
  FAZA: 11.

- 2026-08-12: **GATE FAZY 11 PASS** — 184 pytest + 4 specy Playwright zielone.
  Import z Hermesa (wiersz C): `server/importer.py` (inspect bez kopiowania +
  run copytree; marker profilu = config.yaml LUB profile.yaml LUB SOUL.md —
  realny `create_profile` i prawdziwy `%LOCALAPPDATA%\hermes` usera NIE mają
  config.yaml, pinowana reguła odrzuciłaby oba; root Hermesa wykrywany po
  `profiles/` i zwraca listę nazw; ignore = runtime'owe śmieci + `profiles/` —
  bez tego import roota kopiowałby rekurencyjnie wszystkie profile do środka
  jednego bota; bot.json pisany wprost, bo `bots._write` regeneruje SOUL.md a
  SOUL źródłowy to wartość importu; retrofit junctiona skills + ensure_bot),
  CLI `python -m server.importer`, REST POST /api/import{,/inspect}. UI:
  ImportBotDialog (Inspect → podgląd, select profilu przy roocie, slug-prefill
  wspólnym slugify z NewBotDialog), trzecia pozycja menu `+`. GATE: profil
  zbudowany PRAWDZIWYM `hermes_profiles.create_profile` + realny MemoryStore +
  realny cron_jobs.create_job → import przez API → fakt znajdowany przez
  `GET /memory/facts?q=`, SOUL dosłownie zachowany, rutyna w panelu, duplikat
  409. `.env` kopiowany, treść nigdy nie logowana (asercja w testach).
  Checklista: wiersz C DONE (fizyczny ~/.hermes nietestowany w CI — ścieżka
  identyczna). FAZA: 12.

- 2026-08-12: **GATE FAZY 12 PASS** — 198 pytest + 4 specy Playwright zielone.
  Tier 2 (`SLAFY_COMPUTER_TIER=2`): JEDEN współdzielony headless chromium na
  maszynę (`<root>/shared-browser`, root z SLAFY_DATA_DIR albo dziadek
  profilu), refcount pod własnym lockiem (launch nie blokuje tier-1),
  ostatni release ubija z lockiem w ręku (wyścig o user_data_dir);
  browser.json per profil ze wspólnym cdp_url — mostek CDP fazy 4 nietknięty;
  degradacja uczciwa: wspólne ciasteczka między botami (by design, PLAN §4.3).
  Termux: `scripts/termux-install.sh` (pakiety zweryfikowane w indeksie
  aarch64; python 3.14 systemowy — cap Hermesa <3.14 nieaktualny, pydantic-core
  ma koła cp314; `--ignore-requires-python` opisany jako pierwszy podejrzany;
  bez playwrighta — import server.app czysty bez niego, dowiedzione), LF
  wymuszone .gitattributes, `SLAFY_SERVE_UI=1` montuje ui/dist za trasami
  (kolejność tras dowiedziona testem — API wygrywa), docs/TERMUX.md z
  uczciwymi limitami (komputer bota nie działa na Termuxie — Playwright bez
  Androida; Tier 2 celuje w RPi/stare laptopy z chromium). GATE WSL Ubuntu
  (Python 3.14.4, ta sama sytuacja co Termux): venv + pip zestaw skryptu +
  uvicorn → /health ok, POST /api/bots 201, lista zwraca bota. Fizyczny
  Android NIETESTOWANY — skrypt zweryfikowany składniowo (bash -n) + kroki
  w WSL; odnotowane w TERMUX.md. Wiersz A DONE z tym zastrzeżeniem. FAZA: 13.

- 2026-08-12: **GATE FAZY 13 PASS + PĘTLA ZAMKNIĘTA** — 233 pytest + 4 specy
  Playwright zielone. Fala 1: permissions egzekwowane (`server/permissions.py`,
  14 realnych toolsetów przez `agent.disabled_toolsets` — allow-lista per
  platformę nie łapie platformy `cron`, bot odzyskałby terminal rutyną;
  zweryfikowane realnym gatewayem: wyłączony terminal nie trafia do oferty
  modelowi), `_ensure_approvals_config` (mode manual — default smart
  auto-zatwierdza), attention (heurystyka markerów w `_run_chat`, event WS na
  set i clear), UI uprawnień + karta "Needs your attention" (§13). Fala 2:
  usage meter (`server/usage.py`, blok `usage` z chat/completions bez zmiany
  kontraktu chat()), files tab (`server/files.py`, read-only workspace),
  Cmd+K (§6), SettingsModal z realnym theme toggle, Onboarding (§11), długi
  ogon (bot_created event WS, inter-bot thread list w RightPanel, drift-skip
  warning rutyn; @plugin w composerze już był z fazy 7). Gate: enforcement na
  realnym gatewayu + attention + smoke REST matrycy.

## RAPORT — audyt matrycy funkcji (PLAN.md §2 + §3), koniec pętli

Metoda: każdy wiersz oznaczony DONE / CZĘŚĆ (z uczciwym limitem) / DOWÓD
(plik|test|endpoint). "CZĘŚĆ" = działa istotą, brak wariantu z frame'ów albo
świadomy descope udokumentowany w dzienniku fazy.

### App shell / UI
- #1 shell 3-kolumnowy — DONE (ui/ shell, gate fazy 2; §1 tolerancje w smoke.spec).
- #2 tożsamość bota (name/title/desc, avatar shape+color) — CZĘŚĆ: picker 7×7
  kształt/kolor; generate-from-desc i upload nieзrobione (luka §14.1).
- #3 animacja tworzenia / avatar w pracy / collapsed sidebar — CZĘŚĆ: working
  indicator jest; fun-animacja i collapsed z tooltipami nie.
- #4 czat z wieloma botami + @bot mention — DONE (faza 7, test_gate_faza7).
- #5 group chaty (koordynacja, ownership) — DONE (faza 7, groups.py + gate B).
- #6 Cmd+K (agenci, search, groups, files, routines, links) — CZĘŚĆ: paleta z
  zakładkami (CommandPalette.tsx); shared-links list nieзrobiona (brak feature
  linków w produkcie na start).
- #7 desktop + mobile sync realtime — CZĘŚĆ: WS sync między kartami (faza 3);
  mobile layout jest, fizyczny telefon nietestowany (Termux gate w WSL).
- #8 dyktowanie w composerze — DONE (faza 10, voice.spec).
- #9 onboarding interview + reverse-prompt — CZĘŚĆ: Onboarding.tsx kreator +
  tworzy pierwszego bota; konwersacyjne self-onboarding (bot proponuje pluginy/
  rutyny) — instrukcja w SOUL, nie osobny flow.
- #10 usage meter — DONE (usage.py, SettingsModal; % tygodnia uproszczone do sum).
- #11 settings: theme/timezone/local-exec/permission rules — CZĘŚĆ: theme
  toggle DONE, permission rules DONE (egzekwowane); timezone i local-exec toggle
  (#16) nieзrobione.
- #12 approvals (zwraca tylko gdy trzeba zgody) — CZĘŚĆ (świadomy descope,
  APPROVALS-RECON): egzekwowane uprawnienia toolsetów + attention UX +
  mode:manual (bez aux-auto-approve). Blokada w połowie tury NIE — natywne
  approvals Hermesa żyją tylko na /v1/runs, który nie ma ciągłości sesji (gate
  fazy 1). Upgrade = migracja tury na /v1/runs.

### Computer
- #13 komputer per bot (browser/terminal/file-manager/desktop, persistent
  logins) — CZĘŚĆ: persistent browser + loginy (faza 4); terminal/file-manager
  w UI nie (Hermes ma je jako narzędzia agenta).
- #14 live view + take-over (też z telefonu) + handoff — DONE (faza 4,
  test_gate_faza4; telefon = ta sama PWA, nietestowany fizycznie).
- #15 localhost apps na komputerze bota + screenshoty do czatu — CZĘŚĆ:
  routing localhost do komputera bota naprawiony (gate fazy 9: auto_local +
  allow_private_urls); screenshoty do czatu jako karty nieзrobione.
- #16 wykonanie na lokalnym komputerze usera — NIE (poza zakresem pętli;
  Tier 2 to inny wektor).
- #17 browser-first, per-bot sesje/konta — DONE (faza 4).

### Teach-a-task / skills
- #18 teach → skill — DONE (faza 9, test_gate_faza9 scenariusz A+B).
- #19 skille /slash, shared, edit/delete — DONE (faza 9, junction + REST).
- #20 self-improvement (dry-run, self-critique) — CZĘŚĆ: adopt_skill +
  instrukcja self-critique w skillu + background review Hermesa; realna
  samopoprawa wymaga prawdziwego LLM.
- #21 clarifying questions przed skillem — CZĘŚĆ: instrukcja w skillu
  (`clarify` tool martwy na HTTP).

### Plugins
- #22 marketplace + OAuth cards — DONE (faza 5; OAuth przez hint, realny
  oauth_url odłożony).
- #23 pluginy shared, komputery per bot — DONE (faza 5).
- #24 multi-account per serwis — CZĘŚĆ: przez duplikat instalacji.
- #25 @plugin mention + auto-suggest — CZĘŚĆ: @plugin w roster (faza 7);
  auto-suggest połączenia mid-rozmowa nieзrobiony.
- #26 custom pluginy — DONE (faza 5, custom install).
- #27 launch set connectorów — CZĘŚĆ: katalog 9 manifestów (część URL
  niezweryfikowana); pełna lista 16 nieзrobiona.
- #28 fallback do przeglądarki bez pluginu — DONE (faza 4 browser-first).

### Routines
- #29 rutyny (manualne + lista + edycja + past runs + run-now) — CZĘŚĆ:
  formularz+presety, nie konwersacyjne tworzenie.
- #30 schedule + trigger (webhook) — DONE (faza 6, nasz HMAC webhook).
- #31 bot rekomenduje rutyny — NIE (odłożone; wymaga LLM-flow).
- #32 rutyny w chmurze z zamkniętą apką — DONE (faza 6, ticker gatewaya, gate A).

### Multi-agent
- #33 boty gadają po opisie, view-only wątki — DONE (faza 7).
- #34 transparency event — DONE (faza 7, WS interbot).
- #35 chief-of-staff (router) — CZĘŚĆ: owner po opisie; bez multi-hop handoffu.
- #36 context sharing na żądanie — CZĘŚĆ: wspólny wątek pary + tury pokoju;
  bez współdzielenia pamięci.

### Memory / learning
- #37 pamięć per bot, ostrzejsza z użyciem — DONE (faza 8, RAG prefetch + graf).
- #38 ingest zewnętrznej wiedzy (repo jako "drugi mózg") — NIE (poza pętlą;
  MCP/files daje zaczątek).

### Dodatki Kacpra (§3)
- A self-host wszędzie + stary telefon — DONE (faza 12, Termux + Tier 2; gate WSL).
- B multi-provider BYOK + subscription OAuth — CZĘŚĆ: BYOK DONE (faza 1);
  subscription OAuth za flagą nieзrobiony.
- C migracja z Hermesa — DONE (faza 11, importer + gate realnego profilu).
- D wiele connectorów + generic webhook — DONE (MCP faza 5 + webhook faza 6).
- E graf pamięci — DONE (faza 8, MemoryGraph d3-force).
- F voice — DONE baseline (faza 10, Web Speech + serwerowe STT/TTS).
- G boty poprawiają się / RAG — CZĘŚĆ: RAG DONE, learning loop przez gateway
  bez naszego kodu; skill-po-3-próbach to nudge+background review Hermesa.

### Bilans
33/39 wierszy §2 DONE lub CZĘŚĆ z działającą istotą; 6 świadomie poza pętlą
(#16 local-exec, #31 rekomendacje rutyn, #38 ingest, subscription OAuth, pełna
lista connectorów, blokada-w-turze approvals). Wszystkie limity udokumentowane
w dziennikach faz. 233 pytest + 4 specy Playwright zielone; repo na main
aktualne.

**PĘTLA ZAKOŃCZONA. STATUS: DONE.**
