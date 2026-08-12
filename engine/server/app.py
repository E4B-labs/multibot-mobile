"""HTTP API serwera rdzenia — cienki wiring nad `bots`, `providers`, `gateway`.

Zero logiki domenowej: routery tylko tłumaczą HTTP na wywołania modułów i wyjątki
na kody. Cały CRUD siedzi w `server/bots.py`, BYOK w `server/providers.py`, a chat
w `server/gateway.py` (proxy do `hermes gateway`, HERMES-FACTS §4a, §8).

Mapowanie wyjątków jest globalne (`exception_handler`), nie per-endpoint:
  * `ValueError`      → 422 — złe `bot_id` (regex profilu Hermesa, bots.py:42-43)
                         albo nieznany provider (providers.py:59-60),
  * `KeyError`        → 404 — PATCH nieistniejącego bota (bots.py:87-88),
  * `FileExistsError` → 409 — duplikat id; leci wprost z Hermesa
                         (hermes_cli/profiles.py:1081-1083).
Tam, gdzie NIC nie leci (GET/DELETE/provider/chat po nieistniejącym bocie),
sprawdzamy istnienie jawnie — `delete_bot` i `set_provider` są ciche na braku.

Realtime (faza 3): `WS /api/ws` to pub-sub w pamięci TEGO procesu — zbiór
`_ws_clients` + `_broadcast()`. Read-only: klient nic nie wysyła, my pushujemy
`message`/`working` z endpointu czatu. `ponytail:` jeden proces, zero brokera —
przy drugim workerze/uvicornie z `--workers` klienci zobaczą tylko eventy swojego
procesu i dopiero wtedy wchodzi Redis pub-sub.

Pluginy (faza 5): `/api/plugins*` to wiring nad `server/plugins.py` + katalog
manifestów `server/plugins_catalog/*.yaml`. Dwie decyzje warstwy HTTP:
  * z manifestu do `plugins.install()` przepuszczamy WYŁĄCZNIE klucze formatu
    Hermesa (`_SPEC_KEYS`); `display_name/description/tools_count/featured/source`
    to meta do UI i zostają w katalogu — obcy klucz w `mcp_servers` potrafi
    wywalić wpis jako "suspicious" (`hermes_cli/mcp_security.py`, `plugins.py` §a),
  * OAuth NIE przechodzi przez nas: `POST /install` oddaje `oauth_url: null`
    (klucz jest ZAWSZE, żeby UI mogło się rozgałęzić), `needs_auth` i `oauth_hint`
    = komenda `hermes --profile <bot> mcp login <name>` — nie redirect. Powód:
    flow dashboardowy Hermesa (`DashboardOAuthFlow`, `_run_dashboard_mcp_oauth`
    w `hermes_cli/web_server.py:12533`) żyje wyłącznie w JEGO aplikacji web
    (router `/api/mcp/servers/{name}/auth`), a my podnosimy `hermes gateway`
    (platforma `api_server`, aiohttp — zero tras `api/mcp`). Wystawienie
    `oauth_url` znaczyłoby: podnieść osobny, auth-gated serwer dashboardu,
    przejąć jego redirect_uri i czekać do 30 s na URL. Za drogo na ten task —
    dochodzi w fazie 13 (plan LOOP.md). Login wystarczy zrobić z JEDNEGO bota:
    token ląduje we wspólnym `mcp-tokens/` (junction), więc reszta widzi grant
    bez reconnectu. Karta pluginu w czacie: `POST /install` broadcastuje po tym
    samym `_broadcast` co czat event `{"type": "plugin", "bot_id": null, ...}` —
    `bot_id` jest `null`, bo instalacja nie należy do żadnej rozmowy, a front
    wstawia kartę do AKTYWNEGO czatu (UI-SPEC §7). Chat sam proponujący plugin
    (bot wywołujący install) to późniejsza faza — wtedy dojdzie tu `bot_id`.

Gateway podnosi się LENIWIE, w handlerze czatu (`gateway.chat` → `ensure_running`),
nie w starcie aplikacji: inaczej każdy import/test/healthcheck ciągnąłby za sobą
kilkunastosekundowy start procesu Hermesa. `GET /health` to nasza żywotność, nie
gatewaya.
"""

import asyncio
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path

import yaml
from fastapi import FastAPI, Request, UploadFile, WebSocket
from fastapi.responses import JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from server import (
    bots, computer, files, gateway, groups, importer, interbot, memory, permissions, plugins,
    providers, routines, skills, teach, usage, voice,
)

app = FastAPI(title="slafy-bot core")

_CATALOG_DIR = Path(__file__).resolve().parent / "plugins_catalog"

# Klucze wpisu `mcp_servers` w formacie Hermesa (docstring `server/plugins.py` §a,
# `website/docs/reference/mcp-config-reference.md`). Wszystko spoza tej listy
# (`display_name`, `description`, `tools_count`, `featured`, `source`) zostaje w
# katalogu i NIE jedzie do config.yaml profilu.
_SPEC_KEYS = frozenset(
    {"url", "headers", "command", "args", "env", "transport",
     "auth", "oauth", "tools", "enabled", "timeout", "trust"}
)

# Zamiast redirectu (patrz docstring modułu). Login robi się RAZ, z dowolnego
# bota — token ląduje we wspólnym `mcp-tokens/`, więc reszta widzi grant bez
# reconnectu.
_OAUTH_HINT = (
    "Autoryzuj raz w terminalu: `hermes --profile <bot> mcp login {name}`. "
    "Token trafia do wspólnego katalogu, więc pozostałe boty nie łączą się ponownie. "
    "Flow z poziomu dashboardu dochodzi w fazie 13."
)


class BotCreate(BaseModel):
    id: str
    name: str
    title: str = ""
    description: str = ""
    avatar: dict | None = None


class BotPatch(BaseModel):
    name: str | None = None
    title: str | None = None
    description: str | None = None
    avatar: dict | None = None


class ProviderIn(BaseModel):
    provider: str
    model: str
    api_key: str | None = None
    base_url: str | None = None


class ChatIn(BaseModel):
    message: str


class SpeakIn(BaseModel):
    text: str
    voice: str | None = None


class GroupCreate(BaseModel):
    name: str
    bot_ids: list[str]


class PluginIn(BaseModel):
    name: str


class AccountIn(BaseModel):
    label: str


class RoutineCreate(BaseModel):
    name: str
    prompt: str
    schedule: str | None = None
    # Task 1 przyjmuje listę eventów ALBO `{"events": [...]}` — nie zawężamy tu,
    # żeby nie 422-ować UI Taska 3, który pisze się równolegle.
    trigger: list[str] | dict | None = None


class RoutinePatch(BaseModel):
    name: str | None = None
    prompt: str | None = None
    schedule: str | None = None
    enabled: bool | None = None


class WebhookIn(BaseModel):
    events: list[str] = []


class SkillPatch(BaseModel):
    name: str | None = None
    description: str | None = None
    instructions: str | None = None


class InspectIn(BaseModel):
    source: str


class ImportIn(BaseModel):
    source: str
    bot_id: str
    name: str | None = None


class TeachStop(BaseModel):
    recording_id: str


class TeachSynthesize(BaseModel):
    recording_id: str
    name: str | None = None


class PermissionIn(BaseModel):
    toolset: str
    enabled: bool


def _error(status: int, exc: Exception) -> JSONResponse:
    return JSONResponse({"detail": str(exc)}, status_code=status)


@app.exception_handler(ValueError)
async def _value_error(request: Request, exc: ValueError) -> JSONResponse:
    return _error(422, exc)


@app.exception_handler(KeyError)
async def _key_error(request: Request, exc: KeyError) -> JSONResponse:
    return _error(404, exc)


@app.exception_handler(FileExistsError)
async def _exists_error(request: Request, exc: FileExistsError) -> JSONResponse:
    return _error(409, exc)


@app.exception_handler(LookupError)
async def _lookup_error(request: Request, exc: LookupError) -> JSONResponse:
    """501 = "serwer tego nie umie" — brak skonfigurowanego providera STT
    (`voice.transcribe`). `KeyError` JEST podklasą `LookupError`, ale zostaje na
    404: Starlette szuka handlera po `type(exc).__mro__`, więc dokładniejszy
    wpis wygrywa niezależnie od kolejności rejestracji."""
    return _error(501, exc)


def _require(bot_id: str) -> dict:
    bot = bots.get_bot(bot_id)
    if bot is None:
        raise KeyError(f"no such bot: {bot_id}")
    return bot


_ws_clients: set[WebSocket] = set()


async def _broadcast(event: dict) -> None:
    """Rozeslij event do wszystkich klientow WS; padniete usun po cichu."""
    for ws in list(_ws_clients):
        try:
            await ws.send_json(event)
        except Exception:  # rozłączony w trakcie wysyłki — nie psuje czatu
            _ws_clients.discard(ws)


def _message_event(bot_id: str, role: str, content: str) -> dict:
    return {
        "type": "message",
        "bot_id": bot_id,
        "msg": {
            "role": role,
            "content": content,
            "ts": datetime.now(timezone.utc).isoformat(),
        },
    }


@app.websocket("/api/ws")
async def ws_events(ws: WebSocket) -> None:
    await ws.accept()
    _ws_clients.add(ws)
    try:
        while True:
            # Kanał jest read-only — czytamy wyłącznie po to, żeby wykryć
            # rozłączenie (bez `receive` ASGI nie zgłasza disconnectu).
            await ws.receive_text()
    except Exception:  # WebSocketDisconnect albo cokolwiek innego = koniec
        pass
    finally:
        _ws_clients.discard(ws)


@app.websocket("/api/bots/{bot_id}/computer")
async def ws_computer(ws: WebSocket, bot_id: str) -> None:
    """Live view + take-over. Handlery wyjątków (`_require`) nie działają na WS,
    więc "nie ma bota"/"nie ma przeglądarki" idzie jednym kanałem: accept, a potem
    close 4404 — kod dociera do klienta wyłącznie po zaakceptowanym handshake'u."""
    await ws.accept()
    if bots.get_bot(bot_id) is None:
        await ws.close(code=4404)
        return
    await computer.serve(bot_id, ws)


@app.get("/api/bots/{bot_id}/computer/status")
async def computer_status(bot_id: str) -> dict:
    _require(bot_id)
    return await computer.status(bot_id)


@app.post("/api/bots/{bot_id}/computer/screenshot")
async def computer_screenshot(bot_id: str) -> dict:
    _require(bot_id)
    return {"data": await computer.screenshot(bot_id)}  # KeyError → 404, gdy brak przeglądarki


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/api/bots", status_code=201)
async def create_bot(body: BotCreate) -> dict:
    # Sync I/O (profil Hermesa na dysku) do wątku — jak `gateway.messages` niżej.
    bot = await asyncio.to_thread(
        bots.create_bot, body.id, name=body.name, title=body.title, description=body.description
    )
    if body.avatar is not None:
        bot = await asyncio.to_thread(bots.update_bot, body.id, avatar=body.avatar)
    # Faza 13 Task 6 (notka z fazy 3): druga karta widzi nowego bota bez reloadu.
    await _broadcast({"type": "bot_created", "bot": bot})
    return bot


@app.get("/api/bots")
def list_bots() -> list[dict]:
    return bots.list_bots()


@app.get("/api/bots/{bot_id}")
def get_bot(bot_id: str) -> dict:
    return _require(bot_id)


@app.patch("/api/bots/{bot_id}")
def update_bot(bot_id: str, body: BotPatch) -> dict:
    return bots.update_bot(bot_id, **body.model_dump(exclude_unset=True))


@app.post("/api/import/inspect")
def import_inspect(body: InspectIn) -> dict:
    """Podgląd źródłowego profilu Hermesa. Nie-profil → 422 (`ValueError`)."""
    return importer.inspect(body.source)


@app.post("/api/import", status_code=201)
async def import_run(body: ImportIn) -> dict:
    """Profil → bot. Zajęte id → 409 (`FileExistsError` z `copytree`).

    Po sukcesie WS `bot_created` (faza 13 Task 6) — inne karty widzą nowego
    bota bez reloadu; sidebar i tak robi refresh po zamknięciu dialogu.
    """
    bot = await asyncio.to_thread(importer.run, body.source, body.bot_id, body.name)
    await _broadcast({"type": "bot_created", "bot": bot})
    return bot


@app.delete("/api/bots/{bot_id}", status_code=204)
def delete_bot(bot_id: str) -> None:
    _require(bot_id)  # `delete_bot` jest ciche na braku (rmtree ignore_errors)
    bots.delete_bot(bot_id)


@app.put("/api/bots/{bot_id}/provider")
def set_provider(bot_id: str, body: ProviderIn) -> dict:
    _require(bot_id)  # inaczej zapisalibyśmy config.yaml w katalogu widmo
    return providers.set_provider(
        bot_id, body.provider, body.model, api_key=body.api_key, base_url=body.base_url
    )


@app.get("/api/bots/{bot_id}/messages")
async def messages(bot_id: str) -> list[dict]:
    _require(bot_id)
    # `gateway.messages` jest sync (httpx) — do wątku, żeby nie blokować pętli
    # razem z WS-ami wiszącymi na tym samym loopie.
    return await asyncio.to_thread(gateway.messages, bot_id)


async def _handle_mentions(from_bot: str, message: str) -> list[dict]:
    """`@<name>` w czacie = delegacja do wspomnianego bota (faza 7). Bieżący bot i
    tak odpowiada normalnie — to UZUPEŁNIA odpowiedź, nie zastępuje jej: `reply`/
    `session_id` zostają odpowiedzią zaadresowanego bota (kontrakt POST /chat
    nietknięty), a pingi lądują w `delegated`. Każda delegacja emituje event WS
    `interbot` (transparency #34 — UI rysuje "Messaged ●B" i otwiera wątek §5)."""
    delegated = []
    for to_bot in interbot.find_mentions(message, from_bot):
        out = await asyncio.to_thread(interbot.delegate, from_bot, to_bot, message)
        await _broadcast(
            {"type": "interbot", "from_bot": from_bot, "to_bot": to_bot,
             "thread_id": out["thread_id"]}
        )
        delegated.append({"to_bot": to_bot, "reply": out["reply"], "thread_id": out["thread_id"]})
    return delegated


# --------------------------------------------------------------------------- #
# Stan uwagi (UI-SPEC §13): "bot czeka na człowieka". ponytail: heurystyka na
# markerach w odpowiedzi, zero klasyfikatora LLM — dodatkowa tura modelu na każdą
# wiadomość kosztowałaby tokeny i sekundy, a fałszywy alarm to jedna pomarańczowa
# kropka do zignorowania. Ceiling: markery są dosłowne i dwujęzyczne; upgrade to
# realny approval przez `/v1/runs` (Hermes pauzuje turę — APPROVALS-RECON §2.2),
# gdy ciągłość sesji na runs zostanie rozwiązana.
# --------------------------------------------------------------------------- #
_ATTENTION_MARKERS = (
    "sign in", "log in", "logging in", "approve", "hand back", "hand it back",
    "need you to", "2fa", "two-factor", "zaloguj", "potwierdź", "czeka na",
)

# Zdanie albo linia — cokolwiek skończy się pierwsze. Wycinek ma trafić do karty
# "Needs your attention", więc bierzemy zdanie z markerem, nie całą odpowiedź.
_SENTENCE_RE = re.compile(r"[^.!?\n]+")


def _attention_reason(reply: str) -> str | None:
    for fragment in _SENTENCE_RE.findall(reply or ""):
        low = fragment.lower()
        if any(marker in low for marker in _ATTENTION_MARKERS):
            return fragment.strip()[:200]
    return None


def _attention_path() -> Path:
    # ponytail: jeden plik JSON na cały serwer, bez locka — zapisy idą z pętli
    # asyncio tego procesu, więc kolizja wymaga drugiego workera; wtedy i tak
    # wchodzi wspólny broker (patrz `_broadcast` w docstringu modułu).
    return bots.data_dir() / "attention.json"


def _attention_all() -> dict[str, str]:
    try:
        return json.loads(_attention_path().read_text(encoding="utf-8"))
    except (OSError, ValueError):  # brak pliku albo śmieci = brak stanu
        return {}


async def _set_attention(bot_id: str, reason: str | None) -> None:
    """Zapisz/skasuj wpis uwagi bota i powiadom UI. Bez zmiany stanu = bez I/O.

    Event leci TAKŻE przy kasowaniu (`reason: null`) — inaczej pomarańczowa kropka
    zapalona w poprzedniej turze wisiałaby do przeładowania strony, mimo że bot
    już nie czeka.
    """
    state = _attention_all()
    if reason is None:
        if state.pop(bot_id, None) is None:
            return
    elif state.get(bot_id) == reason:
        return
    else:
        state[bot_id] = reason
    path = _attention_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(state, ensure_ascii=False), encoding="utf-8")
    await _broadcast({"type": "attention", "bot_id": bot_id, "reason": reason})


@app.get("/api/bots/{bot_id}/attention")
def bot_attention(bot_id: str) -> dict:
    """Stan uwagi przy montowaniu UI (WS łapie tylko zmiany od teraz)."""
    _require(bot_id)
    return {"reason": _attention_all().get(bot_id)}


async def _run_chat(bot_id: str, message: str) -> dict:
    """Jedna tura czatu z pełną obsługą eventów WS. Wspólne dla `POST /chat`
    i `POST /voice` (bez `transcribe_only`) — wiadomość podyktowana jest zwykłą
    wiadomością usera, więc musi emitować dokładnie te same eventy."""
    await _broadcast({"type": "working", "bot_id": bot_id, "working": True})
    await _broadcast(_message_event(bot_id, "user", message))
    try:
        result = await asyncio.to_thread(gateway.chat, bot_id, message)
        await _broadcast(_message_event(bot_id, "assistant", result["reply"]))
        # Po odpowiedzi, przed delegacjami: marker = bot czeka na człowieka, brak
        # markera = czyścimy poprzednie czekanie (tura bez markera znaczy, że bot
        # ruszył dalej).
        await _set_attention(bot_id, _attention_reason(result["reply"]))
        delegated = await _handle_mentions(bot_id, message)
        if delegated:  # pole opcjonalne — brak @mention = kontrakt {reply, session_id} bez zmian
            result = {**result, "delegated": delegated}
        return result
    finally:
        # `finally`, nie po `try` — inaczej padnięty gateway zostawiłby wszystkie
        # otwarte UI z botem w stanie "working" na zawsze.
        await _broadcast({"type": "working", "bot_id": bot_id, "working": False})


@app.post("/api/bots/{bot_id}/chat")
async def chat(bot_id: str, body: ChatIn) -> dict:
    _require(bot_id)  # gateway odpowiedziałby profilem domyślnym albo 404 bez kontekstu
    return await _run_chat(bot_id, body.message)


# --------------------------------------------------------------------------- #
# Uprawnienia (faza 13, #12): egzekwowane on/off toolsetów per bot. Zapis to
# kilka bajtów YAML-a w profilu, więc bez `to_thread` — jak `/api/plugins`.
# --------------------------------------------------------------------------- #
@app.get("/api/bots/{bot_id}/permissions")
def get_permissions(bot_id: str) -> dict[str, bool]:
    _require(bot_id)
    return permissions.get(bot_id)


@app.patch("/api/bots/{bot_id}/permissions")
def set_permissions(bot_id: str, body: PermissionIn) -> dict[str, bool]:
    _require(bot_id)  # inaczej zapisalibyśmy config.yaml w katalogu widmo
    return permissions.set(bot_id, body.toolset, body.enabled)  # ValueError → 422


# --------------------------------------------------------------------------- #
# Głos (faza 10): STT jako FALLBACK dla przeglądarek bez Web Speech API i TTS
# odpowiedzi. Multipart, nie base64 data URL jak Hermes — o 33% mniej bajtów na
# tym samym limicie 25 MB (VOICE-RECON §7.7). Obie funkcje `server/voice.py` są
# blokujące (dysk + sieć), więc lecą przez `to_thread` jak czat.
# --------------------------------------------------------------------------- #
@app.post("/api/bots/{bot_id}/voice")
async def voice_message(bot_id: str, file: UploadFile, transcribe_only: int = 0) -> dict:
    """Nagranie → transkrypt (`transcribe_only=1`) albo → transkrypt + pełna tura
    czatu. Brak providera STT → `LookupError` → 501 (UI gasi wtedy mikrofon)."""
    _require(bot_id)
    audio = await file.read()
    transcript = await asyncio.to_thread(
        voice.transcribe, bot_id, audio, file.filename or "recording.webm"
    )
    # Pusty transkrypt = cisza albo odfiltrowana halucynacja Whispera. Nie ma po
    # co budzić agenta pustą wiadomością (pusty bąbel w wątku + spalona tura), więc
    # odpowiedź ma wtedy samo `transcript` — jak przy `transcribe_only`.
    if transcribe_only or not transcript.strip():
        return {"transcript": transcript}
    return {"transcript": transcript, **await _run_chat(bot_id, transcript)}


@app.post("/api/bots/{bot_id}/speak")
async def speak(bot_id: str, body: SpeakIn) -> Response:
    _require(bot_id)
    try:
        audio = await asyncio.to_thread(voice.tts, body.text, body.voice)
    except RuntimeError as exc:
        # Lokalnie, nie globalnym handlerem: `RuntimeError` → 502 dla całej apki
        # przemalowałoby na 502 każdą inną awarię (np. padnięty gateway w czacie,
        # który ma być 500). edge_tts to usługa Microsoftu — 502 jest tu uczciwe.
        return _error(502, exc)
    return Response(content=audio, media_type="audio/mpeg")


@app.get("/api/bots/{bot_id}/interbot")
async def bot_interbot(bot_id: str) -> list[dict]:
    """Read-only wątki inter-bot bota (UI-SPEC §5). Blokujący `list_threads`
    (glob + read plików) do wątku, jak inne odczyty na tym loopie."""
    _require(bot_id)
    return await asyncio.to_thread(interbot.list_threads, bot_id)


# --------------------------------------------------------------------------- #
# Grupy (faza 7, Task 2): pokoje wielu botów. Cienki REST nad `server/groups.py`.
# --------------------------------------------------------------------------- #
@app.post("/api/groups", status_code=201)
def create_group(body: GroupCreate) -> dict:
    return groups.create(body.name, body.bot_ids)  # ValueError (pusto/nieznany bot) → 422


@app.get("/api/groups")
def list_groups() -> list[dict]:
    return groups.list()


@app.get("/api/groups/{group_id}")
def get_group(group_id: str) -> dict:
    group = groups.get(group_id)
    if group is None:
        raise KeyError(f"no such group: {group_id}")  # → 404
    return group


@app.post("/api/groups/{group_id}/chat")
async def group_chat(group_id: str, body: ChatIn) -> dict:
    """Jedna runda pokoju: `groups.run` odpytuje każdego bota, potem emitujemy
    event `group` na każdą turę (transparency — UI rysuje wypowiedzi w pokoju).
    Nieznany pokój → KeyError z `run` → 404."""
    result = await asyncio.to_thread(groups.run, group_id, body.message)
    # ponytail: eventy lecą PO całej rundzie, nie na żywo per-tura — streaming z
    # wnętrza `to_thread` wymagałby run_coroutine_threadsafe; dołożyć callback
    # per-tura, gdyby UI potrzebowało wypowiedzi w miarę ich powstawania.
    for turn in result["turns"]:
        await _broadcast(
            {"type": "group", "group_id": group_id, "bot_id": turn["bot_id"], "msg": turn["reply"]}
        )
    return result


def _catalog() -> dict[str, dict]:
    """Marketplace = manifesty z repo. Czytane przy każdym żądaniu (kilka plików
    po kilkaset bajtów), więc dołożenie wpisu nie wymaga restartu serwera."""
    entries = {}
    for path in sorted(_CATALOG_DIR.glob("*.yaml")):
        manifest = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        if manifest.get("name"):
            entries[manifest["name"]] = manifest
    return entries


@app.get("/api/plugins")
def list_plugins() -> list[dict]:
    return plugins.list_installed()


@app.get("/api/plugins/catalog")
def plugins_catalog() -> list[dict]:
    # `installed` doklejamy po stronie serwera, żeby marketplace mógł narysować
    # `✓ Added` z JEDNEJ odpowiedzi (UI-SPEC §7); UI i tak trzyma własny zbiór
    # nazw z `GET /api/plugins`, więc to wygoda, nie jedyne źródło prawdy.
    installed = {info["name"] for info in plugins.list_installed()}
    return [{**entry, "installed": name in installed} for name, entry in _catalog().items()]


@app.post("/api/plugins/install")
async def install_plugin(body: PluginIn) -> dict:
    """Instalacja wpisu z katalogu. Nazwa z HTTP musi być W katalogu — nie
    przyjmujemy tu dowolnego specu (własny serwer MCP = osobny endpoint w #26).

    `async`, bo po instalacji leci karta pluginu na WS. Samo `plugins.install()`
    zostaje sync: to zapis kilku plików YAML po profilach, nie I/O sieciowe —
    `to_thread` kosztowałby więcej niż oszczędza (`ponytail:` przenieść, gdyby
    profili zrobiło się tyle, że merge zaczyna blokować pętlę).
    """
    plugins._check(body.name, "plugin name")  # ValueError → 422, ZANIM tkniemy dysk
    manifest = _catalog().get(body.name)
    if manifest is None:
        raise KeyError(f"no such plugin in catalog: {body.name}")
    info = plugins.install(body.name, {k: v for k, v in manifest.items() if k in _SPEC_KEYS})
    # `oauth_required` to STAŁA cecha wpisu (z manifestu), a `needs_auth` — stan
    # TERAZ. Różnią się dokładnie wtedy, gdy token już leży we wspólnym katalogu:
    # drugi bot instaluje plugin z OAuth i nie musi nic autoryzować.
    oauth_required = manifest.get("auth") == "oauth"
    await _broadcast(
        {
            "type": "plugin",
            "bot_id": None,
            "plugin": {
                "name": body.name,
                "description": manifest.get("description", ""),
                "oauth_required": oauth_required,
                "tools_count": manifest.get("tools_count"),
            },
        }
    )
    return {
        **info,
        "installed": True,
        "oauth_required": oauth_required,
        # `connected` z `plugins` = "auth nie jest oauth ALBO token już leży we
        # wspólnym katalogu", więc jego negacja to dokładnie "trzeba autoryzować".
        "needs_auth": not info["connected"],
        # Oba klucze są ZAWSZE (null przy pluginie bez OAuth) — patrz docstring
        # modułu: startu flow nie mamy czym wystawić, więc dajemy komendę CLI.
        "oauth_url": None,
        "oauth_hint": None if info["connected"] else _OAUTH_HINT.format(name=body.name),
    }


@app.delete("/api/plugins/{name}", status_code=204)
def remove_plugin(name: str) -> None:
    plugins.remove(name)  # brak wpisu = no-op (kontrakt `plugins.remove`)


@app.put("/api/plugins/{name}/account")
def set_plugin_account(name: str, body: AccountIn) -> dict:
    # KeyError (nieznany plugin) → 404, ValueError (zła labelka) → 422 — globalne
    # handlery, bez powtarzania walidacji z `plugins.py`.
    return plugins.set_account(name, body.label)


@app.get("/api/plugins/{name}/status")
def plugin_status(name: str) -> dict:
    """Stan pluginu BEZ odpytywania żywego MCP.

    Discovery narzędzi wymagałoby połączenia z serwerem MCP (a przy `auth: oauth`
    także tokena) — czyli podniesienia gatewaya albo własnego klienta MCP na każde
    odpytanie statusu, które UI woła w pętli po instalacji. Dlatego czytamy stan z
    dysku:
      * `connected` — `plugins._connected`: brak `auth: oauth` = połączony (nie ma
        czego autoryzować), a przy OAuth decyduje obecność
        `$SLAFY_DATA_DIR/mcp-tokens/<name>.json`, czyli tego samego pliku, który
        zapisuje Hermes po flow (`tools/mcp_oauth.py`),
      * `tools` — filtr `tools.include` ze specu. Pusty, gdy plugin nie zawęża
        narzędzi: to LISTA DOZWOLONYCH, nie lista dostępnych, więc zgadywanie
        nazw wyłączyłoby resztę narzędzi serwera. Realne nazwy dopisze dopiero
        discovery przez gateway (`refresh_agent_mcp_tools`).
    """
    spec = plugins._read().get(name)
    if spec is None:
        raise KeyError(f"no such plugin: {name}")
    return {
        "connected": plugins._connected(name, spec),
        "tools": list((spec.get("tools") or {}).get("include") or []),
    }


# --------------------------------------------------------------------------- #
# Pamięć (faza 8): read-only odczyt bazy holografu i MEMORY.md profilu.
# `to_thread`, bo to sqlite + I/O plików na tym samym loopie co WS-y czatu.
# --------------------------------------------------------------------------- #
@app.get("/api/bots/{bot_id}/memory/facts")
async def memory_facts(bot_id: str, q: str | None = None, limit: int = 100) -> list[dict]:
    _require(bot_id)
    return await asyncio.to_thread(memory.facts, bot_id, q, limit)


@app.get("/api/bots/{bot_id}/memory/graph")
async def memory_graph(bot_id: str) -> dict:
    _require(bot_id)
    return await asyncio.to_thread(memory.graph, bot_id)


@app.get("/api/bots/{bot_id}/memory/markdown")
async def memory_markdown(bot_id: str) -> dict:
    # Owinięte w obiekt, nie goły string: surowy markdown w body zmuszałby UI do
    # parsowania JSON-owego stringa i zamykał drogę na metadane (mtime, limit).
    _require(bot_id)
    return {"content": await asyncio.to_thread(memory.markdown, bot_id)}


# --------------------------------------------------------------------------- #
# Usage + Files (faza 13): licznik tokenów i read-only listing workspace.
# `usage.*` to odczyt kilku bajtów JSON-a → sync (jak /permissions); `files.list`
# skanuje katalog → `to_thread` (jak /memory). Liczby usage zbierają KAŻDĄ turę
# przez `gateway.chat` — więc też tury delegacji (@mention) i pokojów (grup).
# --------------------------------------------------------------------------- #
@app.get("/api/usage")
def usage_all() -> dict:
    return usage.all()


@app.get("/api/bots/{bot_id}/usage")
def bot_usage(bot_id: str) -> dict:
    _require(bot_id)
    return usage.get(bot_id)


@app.get("/api/bots/{bot_id}/files")
async def bot_files(bot_id: str) -> list[dict]:
    _require(bot_id)
    return await asyncio.to_thread(files.list, bot_id)


# --------------------------------------------------------------------------- #
# Skille (faza 9): CRUD po plikach we WSPÓLNYM katalogu — bez `bot_id` w ścieżce,
# bo junction (`server/skills.py`) daje wszystkim botom jeden katalog (#19).
# Zapis jest lokalny (kilka plików), więc bez `to_thread` — jak `/api/plugins`.
# --------------------------------------------------------------------------- #
@app.get("/api/skills")
def list_skills() -> list[dict]:
    return skills.list()


@app.get("/api/skills/{name}")
def get_skill(name: str) -> dict:
    skill = skills.view(name)
    if skill is None:
        raise KeyError(f"no such skill: {name}")  # → 404
    return skill


@app.patch("/api/skills/{name}")
def update_skill(name: str, body: SkillPatch) -> dict:
    # ValueError (zła nazwa przy zmianie / kolizja) → 422 globalnym handlerem.
    updated = skills.update(name, **body.model_dump(exclude_unset=True))
    if updated is None:
        raise KeyError(f"no such skill: {name}")  # → 404
    return updated


@app.delete("/api/skills/{name}", status_code=204)
def delete_skill(name: str) -> None:
    if not skills.delete(name):
        raise KeyError(f"no such skill: {name}")  # → 404


# --------------------------------------------------------------------------- #
# Teach-a-task (faza 9): nagranie demonstracji → skill. Eventy `teach` sterują
# czerwoną ramką live view i chipem w czacie (UI-SPEC §8), więc lecą PO udanej
# operacji — brak przeglądarki (404) nie może zapalić w UI trybu nagrywania.
# --------------------------------------------------------------------------- #
@app.post("/api/bots/{bot_id}/teach/start", status_code=201)
async def teach_start(bot_id: str) -> dict:
    _require(bot_id)
    started = await teach.start(bot_id)  # KeyError (brak przeglądarki) → 404
    await _broadcast({"type": "teach", "bot_id": bot_id, "state": "recording"})
    return started


@app.post("/api/bots/{bot_id}/teach/stop")
async def teach_stop(bot_id: str, body: TeachStop) -> dict:
    _require(bot_id)
    stopped = await teach.stop(bot_id, body.recording_id)  # KeyError (brak nagrania) → 404
    await _broadcast({"type": "teach", "bot_id": bot_id, "state": "stopped"})
    return stopped


@app.post("/api/bots/{bot_id}/teach/synthesize")
async def teach_synthesize(bot_id: str, body: TeachSynthesize) -> dict:
    _require(bot_id)
    # `to_thread` jak w czacie: synteza to pełna tura agenta (minuty), a tu jedzie
    # ten sam loop, co WS-y live view.
    created = await asyncio.to_thread(teach.synthesize, bot_id, body.recording_id, body.name)
    await _broadcast(
        {
            "type": "teach",
            "bot_id": bot_id,
            "state": "skill_created",
            "skill_name": created["skill_name"],
        }
    )
    return created


# --------------------------------------------------------------------------- #
# Rutyny (faza 6): cienki REST nad `server/routines.py` + publiczny webhook.
# --------------------------------------------------------------------------- #
_WEBHOOK_SIG_HEADER = "X-Slafy-Signature"

# Twarda referencja na fire-and-forget taski webhooka: loop trzyma tylko słabe
# referencje, więc bez tego GC może uprzątnąć task w locie (asyncio footgun).
_bg_tasks: set[asyncio.Task] = set()


@app.get("/api/bots/{bot_id}/routines")
def list_routines(bot_id: str) -> list[dict]:
    _require(bot_id)
    return routines.list(bot_id)


@app.post("/api/bots/{bot_id}/routines", status_code=201)
def create_routine(bot_id: str, body: RoutineCreate) -> dict:
    _require(bot_id)
    return routines.create(
        bot_id, body.name, body.prompt, schedule=body.schedule, trigger=body.trigger
    )


@app.patch("/api/bots/{bot_id}/routines/{rid}")
def update_routine(bot_id: str, rid: str, body: RoutinePatch) -> dict:
    _require(bot_id)
    updated = routines.update(bot_id, rid, **body.model_dump(exclude_unset=True))
    if updated is None:
        raise KeyError(f"no such routine: {rid}")  # → 404
    return updated


@app.delete("/api/bots/{bot_id}/routines/{rid}", status_code=204)
def delete_routine(bot_id: str, rid: str) -> None:
    _require(bot_id)
    routines.delete(bot_id, rid)  # brak wpisu = no-op (jak remove_plugin)


@app.post("/api/bots/{bot_id}/routines/{rid}/run")
def run_routine(bot_id: str, rid: str) -> dict:
    _require(bot_id)
    return routines.run_now(bot_id, rid)  # KeyError (brak rutyny) → 404


@app.post("/api/bots/{bot_id}/routines/{rid}/webhook")
def enable_routine_webhook(bot_id: str, rid: str, body: WebhookIn | None = None) -> dict:
    _require(bot_id)
    return routines.enable_webhook_trigger(bot_id, rid, events=body.events if body else [])


async def _fire_routine(bot_id: str, prompt: str) -> None:
    """Odpal prompt rutyny w tle. Webhook ma zwrócić 200 natychmiast, więc NIE
    czekamy na LLM. Wyjątek nie ma komu wrócić (fire-and-forget) — łykamy, żeby
    nie zawisł jako 'Task exception was never retrieved'."""
    try:
        await asyncio.to_thread(gateway.chat, bot_id, prompt)
    except Exception:  # padnięty gateway/LLM nie może wywrócić już-oddanego 200
        pass


@app.post("/webhooks/{rid}")
async def webhook_inbound(rid: str, request: Request) -> JSONResponse:
    """Publiczny inbound. Brak `_require` — webhook nie zna bota; autoryzacją jest
    HMAC sekretu z `enable_webhook_trigger`. Nieznany rid → 404, zły/brak podpisu
    → 401, ok → fire-and-forget `gateway.chat` i natychmiast 200 (nie czekamy na
    LLM — webhook ma być szybki)."""
    entry = routines.webhook_for(rid)
    if entry is None:
        raise KeyError(f"no such webhook: {rid}")  # → 404
    body = await request.body()
    sig = request.headers.get(_WEBHOOK_SIG_HEADER, "")
    if not routines.verify_signature(entry["secret"], body, sig):
        return _error(401, ValueError("bad or missing signature"))
    task = asyncio.create_task(_fire_routine(entry["bot_id"], entry["prompt"]))
    _bg_tasks.add(task)
    task.add_done_callback(_bg_tasks.discard)
    return JSONResponse({"ok": True})


# Statyczne UI (faza 12, Termux): `SLAFY_SERVE_UI=1` dokłada zbudowane `ui/dist`
# pod "/", żeby telefon podnosił JEDEN proces zamiast uvicorna + node'a. Mount
# stoi NA KOŃCU pliku celowo — router Starlette idzie listą tras po kolei i
# pierwsze dopasowanie wygrywa, więc `/api/*` zarejestrowane wyżej biją mount na
# "/" (dowód: tests/test_termux_script.py).
_UI_DIST = Path(__file__).resolve().parent.parent / "ui" / "dist"


def _mount_ui() -> None:
    """Bez `SLAFY_SERVE_UI=1` no-op. Env czytany przy wywołaniu, nie przy
    imporcie modułu — testy podmieniają go per test."""
    if os.environ.get("SLAFY_SERVE_UI") != "1":
        return
    if not (_UI_DIST / "index.html").exists():
        # Na telefonie ten traceback to całe UX — mówimy wprost czego brakuje.
        raise RuntimeError(f"SLAFY_SERVE_UI=1, a brak builda UI w {_UI_DIST} (npm run build w ui/)")
    app.mount("/", StaticFiles(directory=_UI_DIST, html=True), name="ui")


_mount_ui()
