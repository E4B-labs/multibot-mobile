# Faza 1 — Core server — plan wykonawczy

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Subagenty backendowe: model **Opus 5**.

**Goal:** Serwer rdzenia: boty jako profile Hermesa (CRUD przez HTTP API), chat przez gateway `api_server` Hermesa, BYOK per bot. Gate PLAN.md §5: „Create bot via API, chat with it, restart survives".

**Architecture:** Cienki FastAPI (`server/`) zarządza profilami Hermesa (dane w `G:\Projects\slafy-bot-data` = jeden `HERMES_HOME`, bot = profil `profiles/<bot_id>`) i procesem `hermes gateway` (platforma `api_server`, port 8642, multiplex profili). Chat = proxy do gatewaya. Zero własnej pętli agenta, zero własnej bazy — metadane bota w `profiles/<bot_id>/bot.json`, sesje trzyma `hermes_state.db` Hermesa. Fakty: `docs/HERMES-FACTS.md` §2, §4a, §8.

**Tech Stack:** Python 3.12 (venv `.venv` przez uv), hermes-agent editable z `G:\Projects\hermes-agent`, FastAPI + uvicorn + httpx, pytest. LLM w testach = mock OpenAI-compatible (bez tokenów).

## Global Constraints

- **Zakaz zapisu na C:.** `HERMES_HOME` defaultuje na `%LOCALAPPDATA%\hermes` (C:!) — KAŻDE uruchomienie hermesa (testy, serwer, CLI) z env `HERMES_HOME=G:\Projects\slafy-bot-data`. Temp: `D:\tmp` (`$env:TEMP`/`$env:TMP`). Cache uv: `UV_CACHE_DIR=D:\tmp\uv-cache`.
- Dane botów (`G:\Projects\slafy-bot-data`) POZA repo.
- Sekrety tylko w `.env` (gitignored). W repo `.env.example` z pustymi kluczami.
- Testy nie wołają płatnych API — mock LLM. Realny OpenRouter tylko ręczny smoke, gdy Kacper doda klucz.
- Commit + push po każdym zielonym tasku (conventional); skan sekretów przed pushem.
- Python: `requires-python >=3.11,<3.14` hermesa — mamy 3.12.10, OK.

---

### Task 1: Bootstrap środowiska + instalacja Hermesa

**Files:**
- Create: `.venv/` (gitignored — dopisać do `.gitignore`), `G:\Projects\slafy-bot-data\` (poza repo)
- Create: `.env.example`, `README.md` (sekcja "Dev setup")
- Modify: `.gitignore` (dodać `.venv/`)

**Interfaces:**
- Produces: działający venv z `hermes` CLI; komenda aktywacji dla kolejnych tasków: `G:\Projects\slafy-bot\.venv\Scripts\python.exe`.

- [ ] **Step 1: venv + instalacja**

```powershell
$env:TEMP="D:\tmp"; $env:TMP="D:\tmp"; $env:UV_CACHE_DIR="D:\tmp\uv-cache"
cd G:\Projects\slafy-bot
uv venv .venv --python 3.12
uv pip install --python .venv\Scripts\python.exe -e G:\Projects\hermes-agent aiohttp fastapi uvicorn httpx pytest
```
Expected: instalacja OK (pinowane depsy hermesa z jego pyproject).

- [ ] **Step 2: smoke import**

```powershell
$env:HERMES_HOME="G:\Projects\slafy-bot-data"
.venv\Scripts\python.exe -c "import hermes_bootstrap; from hermes_constants import get_hermes_home; print(get_hermes_home())"
```
Expected: wypisuje `G:\Projects\slafy-bot-data`, zero traceback. Wynik na C: = STOP, popraw env.

- [ ] **Step 3: `.env.example` + `.gitignore` + README**

`.env.example`:
```
OPENROUTER_API_KEY=
API_SERVER_KEY=change-me
SLAFY_DATA_DIR=G:\Projects\slafy-bot-data
```
`.gitignore`: dopisz `.venv/`. README: sekcja instalacji (komendy ze Step 1) + uruchomienia (`uvicorn server.app:app`).

- [ ] **Step 4: Commit**

```bash
git add .gitignore .env.example README.md && git commit -m "chore: bootstrap venv + hermes editable install" && git push
```

### Task 2: Moduł botów (CRUD na profilach Hermesa) — TDD

**Files:**
- Create: `server/__init__.py`, `server/bots.py`
- Test: `tests/test_bots.py`

**Interfaces:**
- Produces (konsumuje Task 3 i 4):
  - `bots.create_bot(bot_id: str, name: str, title: str = "", description: str = "") -> dict`
  - `bots.list_bots() -> list[dict]`
  - `bots.get_bot(bot_id: str) -> dict | None`
  - `bots.update_bot(bot_id: str, **fields) -> dict`
  - `bots.delete_bot(bot_id: str) -> None`
  - dict bota: `{"id", "name", "title", "description", "created_at"}`
  - `bots.profile_dir(bot_id) -> Path` = `$SLAFY_DATA_DIR/profiles/<bot_id>`

**Implementacja (szkic):** profil tworzymy funkcjami `hermes_cli.profiles` (import; jeśli API niewygodne — subprocess `hermes profile create <id>`); metadane zapisujemy w `profiles/<bot_id>/bot.json` (stdlib `json`). Walidacja `bot_id` regexem hermesa `^[a-z0-9][a-z0-9_-]{0,63}$` (`_PROFILE_ID_RE` — HERMES-FACTS §2). SOUL.md bota = `profiles/<bot_id>/SOUL.md` generowany z name/title/description (prosty template f-string).

- [ ] **Step 1: failing test**

```python
# tests/test_bots.py
import os, tempfile, pathlib
os.environ.setdefault("SLAFY_DATA_DIR", r"D:\tmp\slafy-test-data")

from server import bots

def test_create_list_get_delete(tmp_path, monkeypatch):
    monkeypatch.setenv("SLAFY_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    b = bots.create_bot("ala", name="Ala", title="Researcher", description="Szuka rzeczy")
    assert b["id"] == "ala" and b["name"] == "Ala"
    assert (bots.profile_dir("ala") / "bot.json").exists()
    assert (bots.profile_dir("ala") / "SOUL.md").exists()
    assert [x["id"] for x in bots.list_bots()] == ["ala"]
    assert bots.get_bot("ala")["title"] == "Researcher"
    bots.update_bot("ala", title="Boss")
    assert bots.get_bot("ala")["title"] == "Boss"
    bots.delete_bot("ala")
    assert bots.list_bots() == [] and bots.get_bot("ala") is None

def test_invalid_id_rejected(tmp_path, monkeypatch):
    monkeypatch.setenv("SLAFY_DATA_DIR", str(tmp_path))
    import pytest
    with pytest.raises(ValueError):
        bots.create_bot("Złe ID!", name="x")
```

- [ ] **Step 2: run — FAIL** (`.venv\Scripts\python.exe -m pytest tests/test_bots.py -v` — ModuleNotFoundError)
- [ ] **Step 3: implementacja minimalna** (`server/bots.py` wg szkicu; profil przez `hermes_cli.profiles` z `HERMES_HOME=$SLAFY_DATA_DIR`)
- [ ] **Step 4: run — PASS**
- [ ] **Step 5: Commit** `feat: bot CRUD na profilach Hermesa`

### Task 3: Provider BYOK per bot — TDD

**Files:**
- Create: `server/providers.py`
- Test: `tests/test_providers.py`

**Interfaces:**
- Consumes: `bots.profile_dir(bot_id)`
- Produces: `providers.set_provider(bot_id, provider: str, model: str, api_key: str | None = None, base_url: str | None = None) -> dict`; `providers.get_provider(bot_id) -> dict` (bez klucza w odpowiedzi — tylko `has_key: bool`).

**Implementacja (szkic):** zapis sekcji `model:` do `profiles/<bot_id>/config.yaml` (pyyaml — już zainstalowany z hermesem); klucz do `profiles/<bot_id>/.env` jako właściwa zmienna providera (OpenRouter → `OPENROUTER_API_KEY`; mapa providerów minimalna: openrouter/anthropic/openai/custom). Brak klucza w wywołaniu = fallback: skopiuj z globalnego `.env` repo jeśli jest.

- [ ] **Step 1: failing test** — `set_provider("ala","openrouter","openrouter/auto",api_key="sk-or-test")` → `config.yaml` ma `model.provider == "openrouter"`, `.env` ma `OPENROUTER_API_KEY=sk-or-test`, `get_provider` zwraca `has_key=True` i NIE zwraca klucza.
- [ ] **Step 2: FAIL** → **Step 3: implementacja** → **Step 4: PASS**
- [ ] **Step 5: Commit** `feat: BYOK per bot`

### Task 4: Gateway manager + chat proxy — TDD

**Files:**
- Create: `server/gateway.py`, `server/app.py`
- Test: `tests/test_app.py`, `tests/mock_llm.py`

**Interfaces:**
- Consumes: Task 2, 3.
- Produces: FastAPI app `server.app:app` z endpointami:
  - `POST /api/bots` `{id,name,title?,description?}` → 201 + dict bota
  - `GET /api/bots`, `GET /api/bots/{id}`, `PATCH /api/bots/{id}`, `DELETE /api/bots/{id}`
  - `PUT /api/bots/{id}/provider` → `providers.set_provider`
  - `POST /api/bots/{id}/chat` `{message}` → `{reply, session_id}` (non-stream w fazie 1; stream w fazie 3)
  - `GET /health`
- `gateway.ensure_running() -> None` — startuje `hermes gateway` subprocess (env: `HERMES_HOME=$SLAFY_DATA_DIR`, `API_SERVER_KEY`), idempotentne; `gateway.stop()`.

**Implementacja (szkic):** przed startem gatewaya zapisz w `$SLAFY_DATA_DIR/config.yaml` platformę `api_server` + `gateway.multiplex_profiles: true` (dokładne klucze zweryfikuj w `G:\Projects\hermes-agent\cli-config.yaml.example` i `gateway/config.py` — HERMES-FACTS §4a). Chat proxy: httpx do `http://127.0.0.1:8642/p/<bot_id>/...`; ZWERYFIKUJ w `gateway/platforms/api_server.py`, czy multiplex obejmuje `/api/sessions` — jak nie, użyj `/p/<bot_id>/v1/chat/completions` + nagłówka `X-Hermes-Session-Id` (trzymaj `session_id` w `bot.json`). W testach NIE odpalaj prawdziwego gatewaya: `tests/mock_llm.py` = mini-FastAPI udający `/v1/chat/completions` (canned reply); test chatu monkeypatchuje URL gatewaya na mock ALBO odpala prawdziwy gateway z providerem `custom` + `base_url` mocka — wybierz to, co stabilniejsze na Windows; decyzję zapisz w komentarzu testu.
`ponytail:` zarządzanie jednym globalnym procesem gatewaya, bez pul i restart-policy — dodać nadzór gdy faza 4 wymusi.

- [ ] **Step 1: failing testy** — CRUD przez `fastapi.testclient` (create → list → get → patch → delete; 404 po delete; 422 na złe id) + chat happy path na mocku.
- [ ] **Step 2: FAIL** → **Step 3: implementacja** → **Step 4: PASS**
- [ ] **Step 5: Commit** `feat: FastAPI core server + gateway manager + chat proxy`

### Task 5: Gate fazy 1 — E2E restart survives

**Files:**
- Test: `tests/test_gate_faza1.py`
- Modify: `README.md` (uruchomienie jedną komendą), `LOOP.md`

- [ ] **Step 1: E2E test** — skrypt/test: start serwera (subprocess uvicorn, port testowy, `SLAFY_DATA_DIR=D:\tmp\slafy-e2e`), `POST /api/bots` (id `e2e-bot`), `PUT provider` (custom → mock LLM), `POST chat` → reply z mocka; **kill serwera, start ponownie** → `GET /api/bots` nadal zwraca `e2e-bot`, druga wiadomość w tej samej sesji ma dostęp do historii (sprawdź: mock LLM dostaje w messages poprzednią wymianę). Real OpenRouter smoke: tylko jeśli `OPENROUTER_API_KEY` w `.env` — inaczej skip z komunikatem.
- [ ] **Step 2: wszystkie testy zielone** (`.venv\Scripts\python.exe -m pytest -v`)
- [ ] **Step 3: `coderabbit:code-review`** na diffie fazy (jeśli dostępny; w worktree nie działa — wtedy 2 subagenty recenzenckie per pamięć projektu). Napraw findings o severity wyżej niż nit.
- [ ] **Step 4: LOOP.md** — odhacz wiersze §2 pokryte fazą 1 (żadnych z §2 jeszcze w pełni — zanotuj częściowe: #37 zalążek przez hermes_state), FAZA: 2, `NASTĘPNE: plan fazy 2 (PWA shell)`. Commit `chore: gate fazy 1 zielony` + push.
