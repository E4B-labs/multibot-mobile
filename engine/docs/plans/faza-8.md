# Faza 8 — Memory (per-bot RAG, learning loop, graf pamięci) — plan wykonawczy

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.
> Backend: **Opus 5**; frontend: **Fable 5**. Task 1 (backend) + Task 2 (frontend)
> równolegle — kontrakt REST pinowany niżej. Subagenty NIE commitują.
> Fakty: docs/reference/MEMORY-RECON.md (PRZECZYTAJ PRZED PRACĄ — schemat bazy,
> pułapki, ścieżka recall przez gateway).

**Goal (gate PLAN.md §5 fazy 8):** "Fact stored in chat is recalled next session;
graph renders and navigates". PLAN.md idea E: Obsidian-like graf per bot.

**Architecture (z recon):** Pamięć markdown (`memory` tool → `memories/MEMORY.md`,
ON domyślnie, snapshot ładowany przy starcie agenta) zamyka bramkę recall. Holograf
(`memory_store.db`: facts/entities/fact_entities/facts_fts/memory_banks) daje RAG
(prefetch top 5 na turę) + dane grafu — ale jest OFF w świeżym profilu: trzeba
dopisać `memory.provider` per profil. Graf jest DWUDZIELNY fakt↔encja (NIE ma
tabeli links); waga = `facts.trust_score`. Hermes nie ma REST do pamięci — nasz
serwer czyta SQLite profilu read-only. Learning loop (nudge + background review)
działa przez gateway bez naszej pracy — tylko odnotować w gate.

## Global Constraints

- ZAKAZ C:. Nie psuć 108 pytest + 2 specy Playwright.
- SQLite profilu pod żywym gatewayem czytamy WYŁĄCZNIE read-only
  (`file:...?mode=ro` URI) — MEMORY-RECON „Pułapki".
- `memories/MEMORY.md` NIE zapisujemy z naszego serwera (drift guard Hermesa:
  format `\n§\n`, char limit; zły zapis blokuje agentowi pamięć). Tylko odczyt.
- numpy już w venv (HRR aktywny); README zaktualizowane.

---

### Task 1 (Opus 5): warstwa memory + REST read-only + config per profil

**Files:** Create: `server/memory.py`; Modify: `server/gateway.py`, `server/app.py`;
Test: `tests/test_memory.py`

**Interfaces (PINOWANE — UI Taska 2 buduje na tym):**
- `memory.facts(bot_id, q=None, limit=100) -> list[dict]` — z `memory_store.db`
  profilu (mode=ro). Rekord: `{id, text, trust_score, created_at, entities: [name, ...]}`.
  `q` = filtr przez `facts_fts` (MATCH) albo LIKE fallback — zbadaj w recon/store.py
  co pewniejsze; opisz wybór. Brak bazy = `[]` (bot mógł jeszcze nic nie zapisać).
- `memory.graph(bot_id) -> {"nodes": [...], "edges": [...]}` — dwudzielny:
  node `{id: "f<rowid>"|"e<rowid>", type: "fact"|"entity", label, weight}`
  (label faktu = text skrócony do ~80 znaków, label encji = nazwa; weight faktu
  = trust_score, encji = liczba faktów), edge `{source, target}` z `fact_entities`.
  Brak bazy = puste listy.
- `memory.markdown(bot_id) -> str` — zawartość `memories/MEMORY.md` profilu,
  `""` gdy brak. TYLKO odczyt.
- `gateway._ensure_memory_config(bot_id)` — obok istniejącego
  `_ensure_browser_config`: dopisz do config.yaml profilu `memory.provider:
  holographic` + wpis pluginu wg MEMORY-RECON „Konsekwencje" (dokładne klucze
  tam). Idempotentne. Wołane z tej samej ścieżki co `_ensure_browser_config`.
- REST (app.py, styl istniejących endpointów, blokujące przez `asyncio.to_thread`):
  `GET /api/bots/{id}/memory/facts?q=&limit=` , `GET /api/bots/{id}/memory/graph`,
  `GET /api/bots/{id}/memory/markdown` (zwróć `{"content": str}`). `_require(bot_id)`
  na każdym.
- TDD: seeduj `memory_store.db` w tmp profilu PRAWDZIWYM schematem (import
  `_SCHEMA`/`MemoryStore` z `plugins.memory.holographic.store` — nie kopiuj SQL),
  wstaw 2-3 fakty + encje + powiązania; asercje na facts/q/graph/markdown; pusta
  baza i brak bazy → puste wyniki; `_ensure_memory_config` idempotentne (dwa
  wywołania = jeden wpis).

### Task 2 (Fable 5): UI grafu pamięci + sekcja Memory

**Files:** Create: `ui/src/components/MemorySection.tsx`,
`ui/src/components/MemoryGraph.tsx`; Modify: `ui/src/components/RightPanel.tsx`,
`ui/src/lib/api.ts`

**Kontrakt API:** trzy endpointy z Taska 1 (kształty wyżej — koduj do kontraktu,
backend powstaje równolegle).

- `api.ts`: `listMemoryFacts(botId, q?)`, `getMemoryGraph(botId)`,
  `getMemoryMarkdown(botId)` — istniejący helper `req<T>()`.
- RightPanel: sekcja **Memory** (pod Routines): caption, licznik faktów, przycisk
  `Open graph`; lista ostatnich ~5 faktów (text skrócony, searchbox filtrem `q`);
  zakładka/fold z podglądem MEMORY.md (render markdown — reuse istniejącego
  komponentu Markdown z czatu, jeśli jest).
- MemoryGraph (PLAN.md idea E, frames tego NIE mają — projekt własny, dark theme
  jak reszta): force-directed graf dwudzielny; fakty = większe węzły (accent),
  encje = mniejsze; klik węzła = panel z pełnym textem faktu + encjami; zoom/pan;
  pusta pamięć = empty state "No memories yet". Dependency: JEDNA nowa paczka
  dozwolona (`d3-force` preferowane — małe; canvas/SVG sam). Sprawdź najpierw,
  czy coś z zainstalowanych (@observablehq/plot ciągnie d3-*) już wystarczy —
  wtedy zero nowych paczek.
- Otwarcie: `Open graph` → modal/overlay pełnoekranowy (jak PluginsModal).
- Gates: `npm run build` (tsc + vite) zielony.

### Task 3: Gate fazy 8

**Files:** Test: `tests/test_gate_faza8.py`

- Scenariusz A (fact recalled next session): REALNY gateway + mock LLM (wzorzec
  gate 1/6). Sesja 1: mock emituje tool_call `memory` (save faktu-markera) w SSE —
  zbadaj format tool_calls w strumieniu, którego oczekuje pętla Hermesa; agent
  wykonuje zapis (MEMORY.md profilu zawiera marker). Sesja 2 (nowa sesja, ten sam
  bot): asercja, że marker jest w kontekście, który mock LLM dostaje (snapshot
  pamięci ładowany przy starcie agenta — MEMORY-RECON §3). Jeśli emisja tool_call
  przez mock okaże się krucha: fallback = zapis przez PRAWDZIWY `memory` tool
  wywołany bezpośrednio (import narzędzia, scope profilu) + sesja 2 przez gateway
  z asercją recall — opisz wybór w docstringu.
- Scenariusz B (graph renders and navigates): seed bazy jak w test_memory.py,
  `GET /api/bots/{id}/memory/graph` zwraca węzły obu typów + krawędzie spójne
  (każdy edge wskazuje istniejące node'y). UI: spec Playwright — otwórz Memory,
  `Open graph`, asercja że węzły są w DOM/canvas i klik węzła pokazuje fakt
  (jeśli canvas utrudnia klik — asercja na panel po kliku w listę faktów; opisz).
- Pełny pytest + specy Playwright zielone. LOOP.md: #37 (persistent memory —
  pełne z RAG), idea E (graf), learning loop odnotowany (nudge + background
  review przez gateway — bez naszej pracy). FAZA: 9.
