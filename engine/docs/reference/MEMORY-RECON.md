# Recon warstwy pamięci Hermesa pod fazę 8 (2026-08-12)

Ścieżki bez prefiksu = `G:\Projects\hermes-agent\`.

## 0. Sprostowania do założeń zadania

1. **Nie ma tabeli `links`.** Schemat to `facts` / `entities` / `fact_entities` /
   `facts_fts` / `memory_banks` (`plugins/memory/holographic/store.py:16-76`).
   Graf jest dwudzielny fakt↔encja; krawędź nie ma kolumn typu/wagi.
   (HERMES-FACTS.md:82-89 ma to poprawnie — mylił opis zadania.)
2. **Nie ma triggera „skill po 3+ próbach”.** W kodzie: nudge co N iteracji
   narzędziowych + fork review po turze (§5). Grep za „3 attempts / third time”
   nie zwraca nic.
3. **Holograf jest WYŁĄCZONY w świeżym profilu.** `memory.provider` nie
   występuje w domyślnym configu (`cli-config.yaml.example:716-735`), a
   `agent/agent_init.py:1731-1734` aktywuje providera tylko gdy klucz ustawiony.
   Markdownowa pamięć wbudowana jest ON domyślnie.

## 1. Dwie niezależne pamięci

| | wbudowana (markdown) | plugin holograficzny |
|---|---|---|
| storage | `$HERMES_HOME/memories/MEMORY.md`, `USER.md` | `$HERMES_HOME/memory_store.db` |
| kod | `tools/memory_tool.py` (1249 l.) | `plugins/memory/holographic/` (store/retrieval/holographic/__init__) |
| narzędzie | `memory` (`memory_tool.py:1160-1244`) | `fact_store`, `fact_feedback` (`holographic/__init__.py:39-92`) |
| wstrzykiwanie | system prompt (snapshot) | system prompt (licznik) + prefetch per tura |
| domyślnie | **ON** (`memory_enabled: true`) | **OFF** (brak `memory.provider`) |

Providerów pamięci jest 8 (`plugins/memory/`: byterover, hindsight, holographic,
honcho, mem0, openviking, retaindb, supermemory) — **aktywny może być tylko
jeden**, wybierany kluczem `memory.provider` (`plugins/memory/__init__.py:12-13`).
Dla nas liczy się holographic (lokalny SQLite, zero zależności — `is_available()`
zawsze True, numpy opcjonalny: `holographic/__init__.py:126-127`).

## 2. `memory_store.db` — pełny schemat (`store.py:16-76`)

```sql
facts(fact_id INTEGER PK AUTOINCREMENT, content TEXT NOT NULL UNIQUE,
      category TEXT DEFAULT 'general', tags TEXT DEFAULT '',
      trust_score REAL DEFAULT 0.5, retrieval_count INT DEFAULT 0,
      helpful_count INT DEFAULT 0, created_at TS, updated_at TS,
      hrr_vector BLOB)                                    -- :17-28
entities(entity_id PK, name TEXT NOT NULL, entity_type TEXT DEFAULT 'unknown',
      aliases TEXT DEFAULT '', created_at TS)             -- :30-36
fact_entities(fact_id FK, entity_id FK, PRIMARY KEY(fact_id, entity_id))  -- :38-42
facts_fts USING fts5(content, tags, content=facts, content_rowid=fact_id)  -- :48-49
  + triggery facts_ai/facts_ad/facts_au (:51-66) trzymają FTS w synchronie
memory_banks(bank_id PK, bank_name TEXT UNIQUE, vector BLOB NOT NULL,
      dim INT NOT NULL, fact_count INT DEFAULT 0, updated_at TS)  -- :68-75
```
Indeksy: `idx_facts_trust(trust_score DESC)`, `idx_facts_category`,
`idx_entities_name` (:44-46). Migracja `ALTER TABLE facts ADD hrr_vector`
przy starcie (:178-181).

**Kto pisze fakty.** (a) model przez `fact_store(action='add')` →
`_handle_fact_store` (`holographic/__init__.py:271-357`); (b) lustrzany zapis z
wbudowanego `memory` — hook `on_memory_write` (`:245-252`) dodaje ten sam tekst
jako fakt (`category='user_pref'` dla target=user); (c) `on_session_end` gdy
`auto_extract: true` — **czysty regex**, żadnego LLM: wzorce „I prefer/like/use”,
„we decided/agreed”, `content[:400]` (`:371-451`). Domyślnie OFF.
Encje wyciągane regexem z treści faktu (CapitalizedWords, cudzysłowy, „aka”)
`store.py:84-91, 447-521`, dedup faktów po UNIQUE(content) (`:194-198`).

**Jak się czyta.** `FactRetriever.search` (`retrieval.py:48-122`): kandydaci z
FTS5 (`limit*3`), potem
`relevance = 0.4*fts + 0.3*jaccard + 0.3*hrr_sim` → `score = relevance *
trust_score` (+ opcjonalny rozpad czasowy) — `retrieval.py:29-31, 100-110`.
Bez numpy wagi się redystrybuują (0.6/0.4/0.0, `:38-42`) — „holograficzność”
(HRR: bind/unbind na wektorach fazowych, akcje `probe`/`related`/`reason`)
działa **tylko z numpy**, inaczej degraduje do FTS+Jaccard.
`search_facts` sam podbija `retrieval_count` (`store.py:280-287`).

## 3. Kiedy pamięć trafia do tury (recall path)

Trzy niezależne kanały, wszystkie w tym samym `run_conversation`:

1. **prefetch raz na turę, przed pętlą narzędzi** — `agent/turn_context.py:1256-1267`:
   `memory_manager.prefetch_all(user_message)` → `HolographicMemoryProvider.prefetch`
   (`holographic/__init__.py:204-218`, top 5, `min_trust` domyślnie 0.3).
   Pominięte dla trywialnych promptów (`is_trivial_prompt`, `memory_provider.py:61`).
   Wynik ląduje **tylko w kopii API** wiadomości użytkownika (sidecar
   `api_content`, `turn_context.py:1269-1290`) — nie w zapisanej treści.
   Wcześniej leci `on_turn_start` (`:1248-1254`).
2. **blok w system prompcie** — `system_prompt_block()` (`:181-202`): licznik
   faktów + instrukcja „użyj fact_store/probe zanim odpowiesz”, składany przez
   `MemoryManager.build_system_prompt` (`agent/memory_manager.py:486-503`).
3. **jawne wywołanie modelu** — `fact_store(action=search|probe|related|reason|
   contradict|list)`.

Pamięć markdownowa idzie osobno: `agent._memory_store.format_for_system_prompt`
(`agent/context_breakdown.py:65-78`) i jest **zamrożonym snapshotem** z momentu
`load_from_disk()` (`memory_tool.py:682-693`) — zapis w trakcie sesji NIE zmienia
promptu tej sesji (ochrona prefix-cache), widać go dopiero w następnej.
To dokładnie realizuje bramkę fazy 8 „fakt zapisany w czacie wraca w następnej sesji”.

`sync_turn` holografu to no-op (`:220-223`) — po turze nic się samo nie zapisuje.

## 4. Konfiguracja (co ustawić per profil)

`config.yaml` profilu, sekcja `memory:` (`cli-config.yaml.example:716-735`):
`memory_enabled: true`, `user_profile_enabled: true`,
`memory_char_limit: 2200`, `user_char_limit: 1375`, `nudge_interval: 10`
(przypomnienie o zapisie co N tur), `flush_min_turns: 6`.
Limity to **znaki, nie tokeny**; przekroczenie = odrzucony `add` z listą wpisów.

Holograf włącza się **dwoma** kluczami:
```yaml
memory:
  provider: holographic          # agent_init.py:1731-1734
plugins:
  hermes-memory-store:           # holographic/__init__.py:98-106 (cfg_get)
    db_path: $HERMES_HOME/memory_store.db   # rozwijane, :160-166
    auto_extract: "false"        # string enum, is_truthy_value :236-240
    default_trust: "0.5"
    hrr_dim: "1024"
    # niejawne, tylko w kodzie: hrr_weight (:169), temporal_decay_half_life (:170),
    # min_trust_threshold (:120)
```
`memory.provider` da się też przestawić przez REST dashboardu
(`hermes_cli/web_server.py:13128-13143`) — ale to zapis do configu **aktywnego**
profilu, więc dla nas prościej dopisać blok samemu (wzorzec
`server/gateway.py:203-241 _ensure_browser_config`).

## 5. Pętla uczenia (learning loop)

- **Nudge pamięciowy**: `memory.nudge_interval` → `agent/turn_context.py:684-691`
  (`should_review_memory`), niesiony przez `conversation_loop.py:1554`.
- **Nudge skillowy**: `skills.creation_nudge_interval` (domyślnie 15 w przykładzie
  configu `:832-836`, 10 w kodzie `agent/agent_init.py:1798-1801`) — po N
  iteracjach narzędziowych tury (`agent/turn_finalizer.py:732-738`).
- **Background review** (`agent/background_review.py:1-17`): po dostarczeniu
  odpowiedzi forkuje `AIAgent` w wątku demona, odtwarza snapshot rozmowy i pyta
  „czy zapisać skill/pamięć?”. Whitelist narzędzi = `{memory, skill_manage}`
  (`:449, 946-954`), zapisy idą prosto do MEMORY.md i katalogu skilli
  (`_memory_write_origin = "background_review"`, `:829-841`).
  Odpala się z `turn_finalizer.py:752-764`.
- **Artefakty**: wpisy w `memories/*.md` oraz skille w
  `$HERMES_HOME/skills/<nazwa>/SKILL.md` (+ pliki przez `skill_manage
  action=write_file`, `background_review.py:236, 339`).
- **Przez nasz gateway działa** — jedyny wyłącznik to `skip_background_review`
  (`agent/agent_init.py:621`), ustawiany wyłącznie przez cron
  (`cron/scheduler.py:4172`). Czat przez api_server go nie ustawia. Koszt: ~30K
  tokenów na zdarzenie (komentarz `turn_finalizer.py:748-751`).

## 6. Ścieżka przez nasz gateway (api_server, multipleks)

`POST /p/<bot>/v1/chat/completions` → `_run_agent` → `agent.run_conversation`
(`gateway/platforms/api_server.py:6128-6222`) — **ten sam kod co CLI**, więc
prefetch/system prompt/nudge/review działają identycznie.
Scoping profilu: middleware `_make_profile_prefix_middleware`
(`api_server.py:2029-2047`) wchodzi w `_profile_scope` → `_profile_runtime_scope
(get_profile_dir(profile))` (`:2001-2027`), czyli contextvar `HERMES_HOME`
(`hermes_constants.py:17-47`). `MemoryStore` bierze ścieżkę z `get_hermes_home()`
**w momencie `initialize()`** (`holographic/__init__.py:156-160`), a to leci pod
scope'em profilu w `agent_init.py:1785` → baza jest per bot. Do
`initialize_all` idzie też `agent_identity = nazwa profilu`
(`agent_init.py:1776-1781`).

## 7. REST: czego Hermes NIE daje

Dashboard ma tylko konfigurację/status/reset, **zero endpointów na fakty czy graf**:
`GET /api/memory` (aktywny provider + rozmiary MEMORY.md/USER.md,
`web_server.py:13101-13125`), `PUT /api/memory/provider` (:13128), `POST
/api/memory/reset` (kasuje pliki .md, :13146-13167), konfiguracja providerów
(:6125-6170) i OAuth providerów (`hermes_cli/memory_oauth.py:18`).
Wszystko scope'owane do jednego aktywnego profilu. CLI: `hermes memory`
(`hermes_cli/memory_setup.py:566`) = setup, nie odczyt.
**Wniosek: jedyna droga to bezpośredni odczyt `profiles/<bot>/memory_store.db`
z naszego serwera.**

## 8. Graf — zapytania (zwalidowane na `:memory:` + realnym `_SCHEMA`)

Węzły = fakty + encje, krawędzie = `fact_entities` (typ stały „mentions”, waga
pochodna z `facts.trust_score`; fakt↔fakt tylko przez self-join po wspólnej encji):
```sql
-- nodes
SELECT 'f'||fact_id AS id,'fact' AS kind,content AS label,category,
       trust_score AS weight,retrieval_count,created_at FROM facts
UNION ALL
SELECT 'e'||entity_id,'entity',name,entity_type,NULL,NULL,created_at FROM entities;
-- edges
SELECT 'f'||fe.fact_id AS source,'e'||fe.entity_id AS target,'mentions' AS type,
       f.trust_score AS weight
FROM fact_entities fe JOIN facts f ON f.fact_id=fe.fact_id;
-- opcjonalnie: fakt↔fakt po współdzielonych encjach
SELECT a.fact_id AS source,b.fact_id AS target,COUNT(*) AS shared
FROM fact_entities a JOIN fact_entities b
  ON a.entity_id=b.entity_id AND a.fact_id<b.fact_id
GROUP BY a.fact_id,b.fact_id;
```
`memory_banks.vector` to skomponowane wektory HRR per kategoria
(`store.py:547-584`) — do wizualizacji nieprzydatne, pomijamy.

## 9. Pułapki

1. **Snapshot vs. live (analog buga drift-guard z fazy 6)**: `MEMORY.md` w
   system prompcie jest zamrożony przy starcie agenta (`memory_tool.py:682-693`),
   a gateway trzyma agenta w cache między turami — nasz zapis do `MEMORY.md`
   z zewnątrz **nie pojawi się w trwającej sesji**.
2. **Drift guard na `MEMORY.md`**: jeżeli nasz serwer/UI zapisze plik w formacie
   innym niż czysta lista wpisów rozdzielonych `\n§\n` (`ENTRY_DELIMITER`,
   `memory_tool.py:67`) albo pojedynczy wpis przekroczy `char_limit`, kolejny
   zapis agenta **odmawia działania** i robi `.bak.<ts>`
   (`_detect_external_drift :815-869`, `_drift_error :91-118`). Zapis z naszej
   strony musi round-trippować.
3. **SQLite pod żywym gatewayem**: jedno współdzielone, refcountowane połączenie
   na proces i ścieżkę bazy (`resolve()` jako klucz), RLock, `isolation_level=None`,
   `timeout=10s` (`store.py:104-164`); WAL z fallbackiem dla NFS/SMB
   (`:170-176`). Czytamy z naszego serwera **wyłącznie read-only**
   (`sqlite3.connect("file:...?mode=ro", uri=True)`), żeby nie tworzyć plików
   journala ani nie brać locka zapisu.
4. **`on_session_end` (auto_extract) odpala się tylko przy eksmisji agenta z
   cache gatewaya** (`gateway/run.py:24406-24454`, `10019-10052`) — nie po
   każdej turze, a przy `mode=="none"` bywa pominięty. Nie opierać nic na tym
   hooku; fakty zapisane przez `fact_store` lądują w bazie natychmiast.
5. **`memory` w `DELEGATE_BLOCKED_TOOLS`** (`tools/delegate_tool.py:49-57`) —
   dotyczy WYŁĄCZNIE subagentów (`delegate_task`), żeby dzieci nie pisały do
   wspólnego `MEMORY.md`. Główny agent bota ma `memory` normalnie.
   `fact_store` nie jest blokowany.
6. **Trwałość między botami**: `plugins.memory` cache'uje moduły w `sys.modules`,
   ale provider jest ładowany od nowa przy każdej inicjalizacji agenta
   (`load_memory_provider`, `plugins/memory/__init__.py:194-215`), a config czyta
   `load_config_readonly()` pod aktualnym `HERMES_HOME` — czyli per bot. OK.

## Konsekwencje dla fazy 8

**Bierzemy jak stoi (0 linii kodu):** zapis/odczyt faktów (`fact_store`),
trust/feedback, FTS5+HRR retrieval, prefetch per tura, blok w system prompcie,
markdownowe MEMORY.md/USER.md z limitami i nudge'ami, background review
(learning loop), izolację per bot przez `HERMES_HOME`.

**Bramkę „fakt wraca w następnej sesji” zamyka sama pamięć wbudowana** (ON
domyślnie) — holograf jest potrzebny do RAG-u i **do grafu**, nie do bramki.

**Cienka warstwa slafy-bota (nasza robota):**
1. `_ensure_memory_config(bot_id)` w `server/gateway.py` obok
   `_ensure_browser_config` — dopisuje do `profiles/<bot>/config.yaml`:
   `memory.provider: holographic` + `plugins.hermes-memory-store`
   (`db_path: $HERMES_HOME/memory_store.db`, `auto_extract: "false"` — regexowa
   ekstrakcja robi śmieci; fakty ma dodawać model przez tool).
   Idempotentny merge, wołany z `chat()` jak reszta.
2. REST w `server/` (read-only SQLite, `mode=ro`, ścieżka z `bots.profile_dir`):
   `GET /api/bots/{id}/memory` (fakty: filtr po kategorii/min_trust, paginacja),
   `GET /api/bots/{id}/memory/graph` (JSON `{nodes, edges}` z §8),
   `GET /api/bots/{id}/memory/files` (MEMORY.md/USER.md — podgląd; **edycja
   tylko przez czysty format §**, patrz pułapka 2), opcjonalnie
   `DELETE .../memory/{fact_id}` (wtedy zapis, nie `mode=ro`, i trzeba usunąć
   też wiersze `fact_entities`).
3. UI: widok grafu + lista faktów z `trust_score`/`retrieval_count`.
4. **`numpy` BRAKUJE w `slafy-bot/.venv` (zweryfikowane)** — bez niego HRR jest
   wyłączony (wagi 0.6/0.4/0.0), a `probe`/`related`/`reason` zwracają pusto
   (`retrieval.py:38-42, 138, 218`). `pip install numpy` przed demem, inaczej
   „holograficzna” część to samo FTS5+Jaccard.

**Czego NIE piszemy:** własnego store'a, własnego RAG-u, własnego schedulera
uczenia — wszystko to jest w Hermesie i chodzi tą samą ścieżką co CLI.
