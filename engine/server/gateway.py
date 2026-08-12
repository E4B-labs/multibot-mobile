"""Zarządzanie procesem `hermes gateway` (platforma `api_server`) + proxy czatu.

Zero własnej pętli agenta — gadamy HTTP-em do gotowego serwera Hermesa
(HERMES-FACTS §4a, §8). Ustalenia z recon `G:\\Projects\\hermes-agent`
(cytaty `plik:linia`, wersja hermes-agent 0.20.0):

(a) JAK WŁĄCZYĆ PLATFORMĘ `api_server`
    Config gatewaya to `$HERMES_HOME/config.yaml` — `gateway/config.py:1339`
    (`config_yaml_path = _home / "config.yaml"`). Bloki:

        platforms:
          api_server:
            enabled: true
            extra: {host: 127.0.0.1, port: 8642}
        multiplex_profiles: true

    - `platforms:` (top-level) i `gateway.platforms:` są scalane —
      `gateway/config.py:1521-1522` (`_merge_platform_map`), a mapowanie na
      `PlatformConfig` leci przez `gateway/config.py:1140-1146`.
    - Klucze `port|key|host|cors_origins|model_name` można pisać zarówno wprost
      pod `platforms.api_server`, jak i w `extra:` — `gateway/config.py:1548-1556`
      przenosi je do `extra` ("Bridge api_server-specific keys ... into extra").
      Adapter czyta je z `extra` w `api_server.py:1377-1385`.
    - Multipleks: top-level `multiplex_profiles` (`gateway/config.py:1410-1411`)
      albo zagnieżdżone `gateway.multiplex_profiles`
      (`gateway/config.py:1435-1437`); pole dataclass ma default `False`
      (`gateway/config.py:972`).
    - Port domyślny 8642, host 127.0.0.1 — `api_server.py:150-151`
      (`DEFAULT_HOST = "127.0.0.1"`, `DEFAULT_PORT = 8642`).

(b) CZY MULTIPLEKS `/p/<profile>/...` OBEJMUJE `/api/sessions`? TAK — WSZYSTKIE
    TRASY. Rejestracja jest jedną pętlą po całej tablicy tras,
    `api_server.py:7212-7214`:

        for method, path, handler in self._http_route_table():
            self._app.router.add_route(method, path, handler)
            self._app.router.add_route(method, f"/p/{{profile}}{path}", handler)

    a `_http_route_table()` (`api_server.py:2055-2095`) zawiera m.in.
    `("GET", "/api/sessions", ...)`, `("POST", "/api/sessions", ...)`,
    `("POST", "/api/sessions/{session_id}/chat", ...)` oraz
    `("POST", "/v1/chat/completions", ...)` i `("GET", "/health", ...)`.
    Prefiks waliduje middleware `api_server.py:2029-2047` → nieznany profil = 404
    (`_resolve_request_profile`, `api_server.py:1962-1998`; przy wyłączonym
    multipleksie prefiks jest IGNOROWANY, nie 404).

    Wybraliśmy mimo to `POST /p/<bot>/v1/chat/completions` + nagłówek
    `X-Hermes-Session-Id` (kontrakt: `api_server.py:4095-4133`, sanityzacja id;
    odpowiedź oddaje ten sam nagłówek — `api_server.py:4327`). Powód: format
    OpenAI jest stabilny i trywialny do zamockowania, a id sesji generujemy
    deterministycznie z `bot_id` (`session_id()` niżej) — więc nie trzymamy
    żadnego stanu i restart serwera niczego nie gubi (historię trzyma
    `hermes_state.db` profilu). `/api/sessions` zostaje na fazę 3 (lista sesji).

(c) API_SERVER_KEY
    - Adapter: `self._api_key = extra.get("key", _get_scoped_secret("API_SERVER_KEY", ""))`
      — `api_server.py:1382`. Czyli: `platforms.api_server.extra.key` w YAML, a
      jak nie ma, to sekret z env / `$HERMES_HOME/.env`. My dajemy env procesu
      (sekret NIE ląduje w pliku configu w katalogu danych).
    - Auth żądania: `Authorization: Bearer <klucz>`, porównanie stałoczasowe —
      `api_server.py:1812-1821`. `GET /health` auth NIE wymaga
      (`api_server.py:2942-2946`) — dlatego to nasza sonda idempotencji.
    - ⚠ Startup guard: `has_usable_secret(self._api_key, min_length=16)` —
      `api_server.py:7154-7164`. Klucz-placeholder albo <16 znaków = gateway
      ODMAWIA startu ("a guessable key is remote code execution").
      `API_SERVER_KEY=change-me` z `.env.example` tego NIE przejdzie.
    - ⚠ Przy multipleksie klucz dla profilu `<bot>` musi być w `.env` TEGO
      profilu: `_expected_api_key()` dla nazwanego profilu czyta
      `get_secret("API_SERVER_KEY")` ze scope'u profilu (`api_server.py:1754-1776`),
      a `agent/secret_scope.py:113-116` mówi wprost: "API_SERVER_KEY is
      deliberately NOT here — it IS a credential and stays profile-scoped",
      więc pod multipleksem NIE ma fallbacku do `os.environ`
      (`agent/secret_scope.py:139-142`). Stąd `_ensure_profile_key()` niżej.
    - ⚠ Kontynuacja sesji przez `X-Hermes-Session-Id` jest bramkowana GLOBALNYM
      kluczem adaptera: `if not self._api_key: ... status=403`
      (`api_server.py:4102-4116`) — bez `API_SERVER_KEY` w env procesu gatewaya
      historia rozmowy nie wczyta się ze `state.db`, mimo poprawnego klucza
      profilu. Czyli klucz musi być w OBU miejscach: env procesu (globalny) i
      `.env` profilu (multipleks). Weryfikacja: gate fazy 1 (Task 5).

(d) PLUGIN BROWSER PROVIDERA `slafy` (faza 4)
    Pliki pluginu żyją w repo (`server/browser_plugin/`), a instalujemy je kopią
    do `$SLAFY_DATA_DIR/plugins/browser/slafy/` — Hermes skanuje WYŁĄCZNIE
    `get_hermes_home()/plugins` (`hermes_cli/plugins.py:1526`). Klucz pluginu
    wyprowadzany jest ze ścieżki, więc to `browser/slafy` (układ kategorii,
    `plugins.py:1617-1622`).
    - `plugins.enabled` jest WYMAGANE: auto-ładują się tylko backendy wbudowane
      w repo Hermesa (`source == "bundled" and kind == "backend"`,
      `plugins.py:1449`); "everything else (standalone, user-installed backends,
      entry-point plugins) is opt-in via plugins.enabled"
      (`plugins.py:1468-1487`). Wpis idzie do configu ROOT-a, bo discovery jest
      jednorazowe na proces i leci JAWNIE na starcie gatewaya
      (`gateway/run.py:11334-11336`), czyli jeszcze przed pierwszym żądaniem —
      pod `HERMES_HOME` procesu, nie pod profilem. Zweryfikowane: bez tego wpisu
      manager melduje "not enabled in config", a `browser_registry.get_provider
      ('slafy')` zwraca `None`.
    - Per profil bota dopisujemy `browser.cloud_provider/backend/inactivity_timeout`
      w `_ensure_browser_config()` — wołanym z `chat()` obok `_ensure_profile_key()`.
      To jedyne pewne miejsce: `write_config()` dotyka wyłącznie configu root-a i
      tylko przy podnoszeniu gatewaya, a `providers.set_provider()` odpala się
      dopiero wtedy, gdy ktoś ustawi BYOK.
"""

import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

import httpx
import yaml

from server import plugins, skills, usage
from server.bots import data_dir, profile_dir

GATEWAY_URL = os.environ.get("SLAFY_GATEWAY_URL", "http://127.0.0.1:8642")

# Config gatewaya. Nadpisujemy w całości: to plik profilu DOMYŚLNEGO
# ($SLAFY_DATA_DIR/config.yaml), a configi botów siedzą w profiles/<id>/config.yaml.
_CONFIG_YAML = """# Generowane przez server/gateway.py — nie edytuj ręcznie.
platforms:
  api_server:
    enabled: true
    extra:
      host: 127.0.0.1
      port: {port}
multiplex_profiles: true
plugins:
  enabled:
    - browser/slafy
browser:
  cloud_provider: slafy
  backend: "off"
  inactivity_timeout: 3600
"""

# Źródło pluginu w repo → kopia w katalogu danych (patrz (d) w docstringu).
_PLUGIN_SRC = Path(__file__).resolve().parent / "browser_plugin"

# Provider jawnie w configu KAŻDEGO profilu — auto-preferencja Hermesa zna tylko
# `("browser-use", "browserbase")`, a `backend: "off"` powstrzymuje auto-przełączkę
# na Browser Use CLI, która ominęłaby providera. `inactivity_timeout` w górę ze
# 120 s, bo reaper woła `close_session` (BROWSER-RECON §Config).
_BROWSER_CFG = {
    "cloud_provider": "slafy",
    "backend": "off",
    "inactivity_timeout": 3600,
    # Bez tego Hermes kieruje URL-e localhost/LAN do WŁASNEGO sidecara Chromium
    # zamiast do komputera bota (browser_tool.py::_auto_local_for_private_urls,
    # default True) — bot serwujący lokalną apkę (#15) przeglądałby ją w innej
    # przeglądarce niż ta, którą widzi i przejmuje user. Jedna przeglądarka
    # bota = provider slafy, zawsze.
    "auto_local_for_private_urls": False,
    # Guard SSRF Hermesa blokuje prywatne adresy na ścieżce "cloud" (default
    # False, browser_tool.py::_allow_private_urls). Nasz "cloud" provider to
    # LOKALNY Playwright na maszynie usera, a localhost apps to feature #15 —
    # bez tego bot nie wejdzie na własnoręcznie postawioną apkę.
    "allow_private_urls": True,
}

# Holograf jest WYŁĄCZONY w świeżym profilu — provider ładuje się wyłącznie, gdy
# `memory.provider` jest ustawione (MEMORY-RECON §0.3, agent_init.py:1731-1734).
# Bez niego nie ma RAG-u ani danych do grafu (pamięć markdownowa działa osobno).
# `db_path` zostaje ŁAŃCUCHEM `$HERMES_HOME/...` — plugin rozwija go sam pod
# scope'em profilu (holographic/__init__.py:160-166), więc baza jest per bot.
# `auto_extract` to string-enum (`is_truthy_value`), a nie bool; trzymamy "false",
# bo regexowa ekstrakcja na koniec sesji robi śmieciowe fakty — fakty ma dodawać
# model przez `fact_store`.
_CURATOR_CFG = {"enabled": False}
_STT_CFG = {"language": "pl"}
# Default Hermesa to `smart` (config_defaults.py:2118) — pomocniczy LLM sam
# zatwierdza "low-risk" niebezpieczne komendy, więc "bot wraca po zgodę" byłoby
# cichą fikcją (APPROVALS-RECON §Top3.1). Dla floty botów: `manual`.
_APPROVALS_CFG = {"mode": "manual"}
_MEMORY_CFG = {"provider": "holographic"}
_MEMORY_PLUGIN_CFG = {
    "hermes-memory-store": {
        "db_path": "$HERMES_HOME/memory_store.db",
        "auto_extract": "false",
    }
}

# Chromium leży poza C: — env musi popłynąć do procesu gatewaya, bo to tam
# provider odpala Playwrighta.
_PW_BROWSERS_PATH = os.environ.get("PLAYWRIGHT_BROWSERS_PATH") or r"D:\tmp\pw-browsers"

# ponytail: jeden globalny proces gatewaya na cały serwer, bez nadzoru i bez
# restartów po crashu — ensure_running() podniesie go dopiero przy następnym
# żądaniu. Ceiling: padnięty gateway = jeden błąd 5xx u użytkownika. Nadzór
# (restart z backoffem, healthcheck w tle) dopisać, gdy faza 4 wymusi ciągłość.
_proc: subprocess.Popen | None = None


def api_key() -> str:
    return os.environ.get("API_SERVER_KEY", "")


def session_id(bot_id: str) -> str:
    """Sesja per bot, wyliczana z id — zero stanu do zapisania, a rozmowa i tak
    przeżywa restart, bo historię trzyma `hermes_state.db` profilu bota."""
    return f"slafy-{bot_id}"


def chat_url(bot_id: str) -> str:
    return f"{GATEWAY_URL}/p/{bot_id}/v1/chat/completions"


def _auth() -> dict:
    # Bez klucza NIE wysyłamy pustego `Bearer ` — httpx odrzuca taką wartość
    # nagłówka (trailing space) jeszcze przed wysłaniem, więc brak konfiguracji
    # objawiłby się LocalProtocolError zamiast czytelnego 401 z gatewaya.
    return {"Authorization": f"Bearer {key}"} if (key := api_key()) else {}


def is_running() -> bool:
    try:
        return httpx.get(f"{GATEWAY_URL}/health", timeout=2.0).status_code == 200
    except httpx.HTTPError:
        return False


def write_config(port: int | None = None) -> None:
    # Port bierzemy z GATEWAY_URL, nie na sztywno: inaczej `SLAFY_GATEWAY_URL`
    # na niestandardowym porcie kazałby gatewayowi słuchać na 8642, a nam sondować
    # gdzie indziej — czyli gwarantowany timeout `ensure_running()`.
    if port is None:
        port = httpx.URL(GATEWAY_URL).port or 8642
    home = data_dir()
    home.mkdir(parents=True, exist_ok=True)
    (home / "config.yaml").write_text(_CONFIG_YAML.format(port=port), encoding="utf-8")
    shutil.copytree(
        _PLUGIN_SRC,
        home / "plugins" / "browser" / "slafy",
        dirs_exist_ok=True,
        ignore=shutil.ignore_patterns("__pycache__"),
    )


def _ensure_browser_config(bot_id: str) -> None:
    """Dopisz blok `browser:` do `config.yaml` profilu bota. Idempotentne."""
    path = profile_dir(bot_id) / "config.yaml"
    if not path.parent.is_dir():
        return
    cfg = (yaml.safe_load(path.read_text(encoding="utf-8")) or {}) if path.exists() else {}
    merged = {**(cfg.get("browser") or {}), **_BROWSER_CFG}
    if merged == cfg.get("browser"):
        return
    cfg["browser"] = merged
    path.write_text(yaml.safe_dump(cfg, sort_keys=False, allow_unicode=True), encoding="utf-8")


def _ensure_memory_config(bot_id: str) -> None:
    """Włącz holograf w `config.yaml` profilu bota. Idempotentne.

    Merge do istniejących bloków `memory:`/`plugins:`, nie podmiana — w `memory:`
    siedzą limity i nudge'e pamięci markdownowej, a w `plugins:` wpisy innych
    pluginów."""
    path = profile_dir(bot_id) / "config.yaml"
    if not path.parent.is_dir():
        return
    cfg = (yaml.safe_load(path.read_text(encoding="utf-8")) or {}) if path.exists() else {}
    mem = {**(cfg.get("memory") or {}), **_MEMORY_CFG}
    plug = {**(cfg.get("plugins") or {}), **_MEMORY_PLUGIN_CFG}
    if mem == cfg.get("memory") and plug == cfg.get("plugins"):
        return
    cfg["memory"], cfg["plugins"] = mem, plug
    path.write_text(yaml.safe_dump(cfg, sort_keys=False, allow_unicode=True), encoding="utf-8")


def _ensure_stt_config(bot_id: str) -> None:
    """Ustaw język STT w `config.yaml` profilu bota. Idempotentne.

    `stt.language` ma default `"en"` i jest GLOBALNYM hintem dla każdego providera
    (config_defaults.py:1580, VOICE-RECON §7.1) — bez tego polskie dyktowanie
    wraca po angielsku. `stt.provider` świadomie NIE jest ustawiany: wybór
    providera to decyzja usera/instalacji (groq wymaga klucza, local wymaga
    faster-whisper + `HF_HOME` na D:), a wpisanie tu czegokolwiek wyłączyłoby
    autodetekcję Hermesa.
    ponytail: język na sztywno "pl" — upgrade to pole w ustawieniach bota.
    """
    path = profile_dir(bot_id) / "config.yaml"
    if not path.parent.is_dir():
        return
    cfg = (yaml.safe_load(path.read_text(encoding="utf-8")) or {}) if path.exists() else {}
    stt = {**(cfg.get("stt") or {}), **_STT_CFG}
    if stt == cfg.get("stt"):
        return
    cfg["stt"] = stt
    path.write_text(yaml.safe_dump(cfg, sort_keys=False, allow_unicode=True), encoding="utf-8")


def _ensure_approvals_config(bot_id: str) -> None:
    """Ustaw `approvals.mode: manual` w `config.yaml` profilu bota. Idempotentne.

    Merge, nie podmiana — w bloku `approvals:` siedzą też `timeout`, `cron_mode`,
    `deny` (globy blokujące bezwarunkowo) i `smart_policy`.

    ponytail: sam `mode` — reszta zostaje na defaultach Hermesa. Ceiling: na
    ścieżce `/v1/chat/completions` `manual` NIE pauzuje tury (kolejka gateway
    istnieje wyłącznie na `/v1/runs` — APPROVALS-RECON §2.3), więc realny efekt
    to "bez auto-zatwierdzania przez aux-LLM": bot zamiast po cichu wykonać
    niebezpieczną komendę relacjonuje, że potrzebuje zgody — i to łapie
    heurystyka uwagi w `app._run_chat`. Pełna pauza dojdzie razem z migracją tury
    na `/v1/runs`.
    """
    path = profile_dir(bot_id) / "config.yaml"
    if not path.parent.is_dir():
        return
    cfg = (yaml.safe_load(path.read_text(encoding="utf-8")) or {}) if path.exists() else {}
    approvals = {**(cfg.get("approvals") or {}), **_APPROVALS_CFG}
    if approvals == cfg.get("approvals"):
        return
    cfg["approvals"] = approvals
    path.write_text(yaml.safe_dump(cfg, sort_keys=False, allow_unicode=True), encoding="utf-8")


def _ensure_skills_config(bot_id: str) -> None:
    """Wyłącz kuratora w `config.yaml` profilu bota. Idempotentne.

    Kurator gatewaya archiwizuje skille po 90 dniach bezczynności
    (`agent/curator.py:73, 322`, domyślnie WŁĄCZONY) — nauczony skill zniknąłby
    sam po kwartale. `skills.creation_nudge_interval` świadomie NIE dotykamy:
    `0` wyłącza cały trigger background review (`turn_finalizer.py:731-733`),
    czyli silnik samopoprawy skilli (#20).
    ponytail: jeden przełącznik zamiast pinowania każdego skilla osobno —
    `hermes curator pin <name>`, gdy kurator zacznie być potrzebny.
    """
    path = profile_dir(bot_id) / "config.yaml"
    if not path.parent.is_dir():
        return
    cfg = (yaml.safe_load(path.read_text(encoding="utf-8")) or {}) if path.exists() else {}
    curator = {**(cfg.get("curator") or {}), **_CURATOR_CFG}
    if curator == cfg.get("curator"):
        return
    cfg["curator"] = curator
    path.write_text(yaml.safe_dump(cfg, sort_keys=False, allow_unicode=True), encoding="utf-8")


def _ensure_profile_key(bot_id: str) -> None:
    """Dopisz `API_SERVER_KEY` do `.env` profilu bota, jeśli go tam nie ma.

    Pod multipleksem gateway czyta ten klucz WYŁĄCZNIE ze scope'u profilu — patrz
    (c) w docstringu modułu. Dopisujemy, nie nadpisujemy: w tym samym `.env`
    siedzi klucz providera od `server/providers.py`.
    """
    key = api_key()
    d = profile_dir(bot_id)
    if not key or not d.is_dir():
        return
    env_path = d / ".env"
    current = env_path.read_text(encoding="utf-8") if env_path.exists() else ""
    if "API_SERVER_KEY=" in current:
        return
    prefix = "" if current.endswith("\n") or not current else "\n"
    with env_path.open("a", encoding="utf-8") as f:
        f.write(f"{prefix}API_SERVER_KEY={key}\n")


def ensure_running(timeout: float = 90.0) -> None:
    """Podnieś gateway, jeśli nie odpowiada. Idempotentne — sondą jest `/health`,
    więc gateway wystartowany ręcznie albo przez inny proces też się liczy."""
    global _proc
    if is_running():
        return
    write_config()
    env = {
        **os.environ,
        "HERMES_HOME": str(data_dir()),
        "API_SERVER_KEY": api_key(),
        "PLAYWRIGHT_BROWSERS_PATH": _PW_BROWSERS_PATH,
    }
    # `hermes gateway run` = foreground (hermes_cli/subcommands/gateway.py:46-49);
    # przez `-m hermes_cli.main`, bo tam `hermes_bootstrap` importuje się pierwszy
    # (hermes_cli/main.py:46-60) — tego wymaga HERMES-FACTS §1.
    _proc = subprocess.Popen(
        [sys.executable, "-m", "hermes_cli.main", "gateway", "run"], env=env
    )
    deadline = time.time() + timeout
    while time.time() < deadline:
        if is_running():
            return
        if _proc.poll() is not None:
            raise RuntimeError(f"hermes gateway padł na starcie (exit {_proc.returncode})")
        time.sleep(0.5)
    raise RuntimeError(f"hermes gateway nie odpowiedział na /health w {timeout} s")


def stop() -> None:
    global _proc
    if _proc is not None and _proc.poll() is None:
        _proc.terminate()
        try:
            _proc.wait(timeout=15)
        except subprocess.TimeoutExpired:
            _proc.kill()
    _proc = None


def chat(bot_id: str, message: str) -> dict:
    """Jedna tura rozmowy z botem. Non-stream — streaming dopiero w fazie 3."""
    ensure_running()
    _ensure_profile_key(bot_id)
    _ensure_browser_config(bot_id)
    _ensure_memory_config(bot_id)
    _ensure_stt_config(bot_id)
    _ensure_approvals_config(bot_id)
    plugins.ensure_bot(bot_id)  # wspólne mcp_servers + junction na wspólne tokeny
    skills.ensure_shared(bot_id)  # junction na wspólne skille — PRZED rozwiązaniem slasha
    _ensure_skills_config(bot_id)
    # `/nazwa` = wywołanie skilla: do gatewaya leci wiadomość z wklejonym ciałem
    # skilla, bo platforma `api_server` nie ma własnego dispatchu slashy.
    message = skills.slash_message(bot_id, message)
    sid = session_id(bot_id)
    response = httpx.post(
        chat_url(bot_id),
        json={
            "model": "hermes-agent",
            "messages": [{"role": "user", "content": message}],
            "stream": False,
        },
        headers={"X-Hermes-Session-Id": sid, **_auth()},
        timeout=300.0,  # tura agenta z tool-callami potrafi trwać minuty
    )
    response.raise_for_status()
    data = response.json()
    # Miernik zużycia siedzi OBOK kontraktu {reply, session_id} — brak bloku
    # `usage` (stary serwer / stream) = no-op, nigdy wyjątek (usage.record).
    usage.record(bot_id, data.get("usage"))
    return {
        "reply": data["choices"][0]["message"]["content"],
        "session_id": sid,
    }


def messages(bot_id: str) -> list[dict]:
    """Historia wątku bota ze `hermes_state.db` profilu.

    `GET /api/sessions/{session_id}/messages` — trasa jest w tablicy tras
    (`api_server.py:2069`), więc łapie ją też prefiks multipleksu `/p/<bot>`
    (`api_server.py:7212-7214`); handler `_handle_session_messages`
    (`api_server.py:3551-3608`) oddaje `{"data": [...]}`, a pola wiadomości to
    `role` / `content` / `timestamp` (`_message_response`, `api_server.py:3302`).
    Bez parametrów dostajemy ostatnie 500 wiadomości w kolejności
    chronologicznej (`hermes_state.py:8393` — `latest` + "still returned in
    chronological order").

    Świadomie BEZ `ensure_running()`: to odczyt do odmalowania wątku, więc brak
    sesji (404), brak gatewaya i każda inna wtopa = pusta lista, nigdy 500 ani
    kilkudziesięciosekundowy start Hermesa w GET-cie.
    """
    sid = session_id(bot_id)
    try:
        r = httpx.get(
            f"{GATEWAY_URL}/p/{bot_id}/api/sessions/{sid}/messages",
            headers=_auth(),
            timeout=10.0,
        )
        if r.status_code != 200:
            return []
        data = r.json()["data"]
    except (httpx.HTTPError, ValueError, KeyError, TypeError):
        return []
    return [
        {"role": m["role"], "content": m["content"], "ts": m.get("timestamp") or ""}
        for m in data
        # Tool-calle i prompt systemowy do czatu nie trafiają; `content` bywa
        # `None` przy wiadomości z samym `tool_calls`.
        if m.get("role") in ("user", "assistant")
        and isinstance(m.get("content"), str)
        and m["content"].strip()
    ]
