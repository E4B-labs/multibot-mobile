"""Teach-a-task: rekorder CDP, transkrypt NL i synteza skilla (faza 9, Task 2).

Bez przeglądarki. Realne CDP zostaje na gate fazy 9 (Task 4) — tutaj sprawdzamy
to, co da się sprawdzić bez Chromium:
  * JS rekordera jako STRING (binding, listenery w capture phase, kolejność
    preferencji selektora) — kod, który i tak wykonuje się po drugiej stronie,
  * transkrypt liczony z podłożonych zdarzeń (kolejność + scalanie inputów),
  * syntezę z podmienionym `gateway.chat` i skillem położonym na dysku, który
    udaje zapis zrobiony przez `skill_manage` bota,
  * REST + eventy WS przez podmieniony `_broadcast` (wzorzec test_gate_faza7).

ZAKAZ C: dane w `tmp_path`, `SLAFY_DATA_DIR`/`HERMES_HOME` przestawione per test.
"""

import asyncio
import json
import os

os.environ.setdefault("SLAFY_DATA_DIR", r"D:\tmp\slafy-test-data")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from tools import skills_tool  # noqa: E402

from server import app as app_module  # noqa: E402
from server import bots, skills, teach  # noqa: E402

_EVENTS = [
    {"type": "click", "selector": "text=Login", "text": "Login", "ts": 1.0},
    {"type": "input", "selector": '[aria-label="search box"]', "value": "he", "ts": 2.0},
    {"type": "input", "selector": '[aria-label="search box"]', "value": "hel", "ts": 3.0},
    {"type": "input", "selector": '[aria-label="search box"]', "value": "hello", "ts": 4.0},
    {"type": "click", "selector": "#go", "text": "", "ts": 5.0},
    {"type": "input", "selector": '[aria-label="search box"]', "value": "again", "ts": 6.0},
    {"type": "navigate", "url": "https://example.test/results", "ts": 7.0},
]

_SKILL_MD = """---
name: {name}
description: Nagrane zadanie.
---

1. Kliknij Login.
"""


@pytest.fixture
def bot(tmp_path, monkeypatch):
    monkeypatch.setenv("SLAFY_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    bots.create_bot("ala", name="Ala")
    return "ala"


def _put_skill(name: str) -> None:
    """Udaje zapis, który robi bot swoim `skill_manage create`."""
    d = skills.shared_dir() / name
    d.mkdir(parents=True, exist_ok=True)
    (d / "SKILL.md").write_text(_SKILL_MD.format(name=name), encoding="utf-8")


@pytest.fixture
def recording(bot):
    rid = "rec-demo"
    path = teach._path(rid)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(_EVENTS), encoding="utf-8")
    return rid


# --------------------------------------------------------------------------- #
# JS rekordera
# --------------------------------------------------------------------------- #
def test_recorder_js_reports_through_binding_in_capture_phase():
    js = teach._RECORDER_JS

    assert teach._BINDING == "slafyTeach"
    assert f"window.{teach._BINDING}(" in js  # kanał strona → my
    for kind in ("click", "input", "submit"):
        assert f'addEventListener("{kind}"' in js
    # capture: true — klik złapany na drodze W DÓŁ drzewa, więc `stopPropagation`
    # w handlerze strony nie zjada nagrania.
    assert js.count(", true)") >= 3


def test_recorder_js_selector_preference_order():
    js = teach._RECORDER_JS
    block = js[js.index("const RESOLVERS") :]
    order = [block.index(x) for x in ('"aria-label"', "el.id", '"data-testid"', "byText", "cssPath")]

    assert order == sorted(order)


# --------------------------------------------------------------------------- #
# transkrypt
# --------------------------------------------------------------------------- #
def test_transcript_keeps_order_and_merges_inputs():
    assert teach.transcript(_EVENTS).splitlines() == [
        'clicked "Login"',
        'typed "hello" into search box',  # trzy inputy w to samo pole = jedna linia
        'clicked "go"',
        'typed "again" into search box',  # po kliknięciu scalanie startuje od nowa
        "navigated to https://example.test/results",
    ]


def test_transcript_of_empty_recording_is_empty():
    assert teach.transcript([]) == ""


# --------------------------------------------------------------------------- #
# start / stop
# --------------------------------------------------------------------------- #
def test_start_without_browser_raises_keyerror(bot):
    with pytest.raises(KeyError):  # → 404, nie 500
        asyncio.run(teach.start(bot))


def test_stop_reads_recording_from_disk(bot, recording):
    out = asyncio.run(teach.stop(bot, recording))

    assert out["events"] == _EVENTS
    assert out["transcript"].startswith('clicked "Login"')


def test_stop_unknown_recording_raises_keyerror(bot):
    with pytest.raises(KeyError):
        asyncio.run(teach.stop(bot, "nie-ma-takiego"))


# --------------------------------------------------------------------------- #
# synteza
# --------------------------------------------------------------------------- #
@pytest.fixture
def adopted(monkeypatch):
    """Spy na `adopt_skill` — sprawdza też, czy scope profilu był aktywny."""
    calls: dict = {}

    def fake_adopt(skill_name):
        calls["name"] = skill_name
        calls["scope"] = skills_tool.SKILLS_DIR == skills.shared_dir()
        return True, f"adopted '{skill_name}'"

    monkeypatch.setattr(teach.skill_usage, "adopt_skill", fake_adopt)
    return calls


def test_synthesize_finds_new_skill_and_adopts_it(bot, recording, adopted, monkeypatch):
    _put_skill("stary-skill")  # istniał wcześniej — nie może być wynikiem syntezy
    seen: dict = {}

    def fake_chat(bot_id, message):
        seen["bot_id"], seen["message"] = bot_id, message
        _put_skill("book-a-flight")
        return {"reply": "zrobione: /book-a-flight", "session_id": "s"}

    monkeypatch.setattr(teach.gateway, "chat", fake_chat)

    assert teach.synthesize(bot, recording) == {"skill_name": "book-a-flight"}

    # Pułapka 1 (SKILLS-RECON): bez adopt pod scope profilu background review nie
    # tknie skilla utworzonego foregroundem → #20 martwe.
    assert adopted == {"name": "book-a-flight", "scope": True}
    assert seen["bot_id"] == bot
    assert 'clicked "Login"' in seen["message"]  # transkrypt w prompcie
    assert "skill_manage" in seen["message"]
    assert "Before the first run" in seen["message"]  # #21 — pytania doprecyzowujące
    assert "After each run" in seen["message"]  # #20 — samokrytyka po uruchomieniu


def test_synthesize_passes_requested_name(bot, recording, adopted, monkeypatch):
    monkeypatch.setattr(
        teach.gateway,
        "chat",
        lambda bot_id, message: (_put_skill("moj-skill"), {"reply": "ok", "session_id": "s"})[1],
    )

    out = teach.synthesize(bot, recording, name="moj-skill")

    assert out == {"skill_name": "moj-skill"} and adopted["name"] == "moj-skill"


def test_synthesize_raises_when_adopt_refuses(bot, recording, monkeypatch):
    """`adopt_skill` odmawia BEZ wyjątku — cicha odmowa zabiłaby #20 po cichu."""
    monkeypatch.setattr(
        teach.gateway,
        "chat",
        lambda bot_id, message: (_put_skill("bundled-skill"), {"reply": "ok", "session_id": "s"})[1],
    )
    monkeypatch.setattr(teach.skill_usage, "adopt_skill", lambda n: (False, "bundled built-in"))

    with pytest.raises(RuntimeError, match="bundled built-in"):
        teach.synthesize(bot, recording)


def test_synthesize_without_new_skill_raises_keyerror(bot, recording, adopted, monkeypatch):
    _put_skill("stary-skill")
    monkeypatch.setattr(
        teach.gateway, "chat", lambda bot_id, message: {"reply": "nie dam rady", "session_id": "s"}
    )

    with pytest.raises(KeyError):
        teach.synthesize(bot, recording)
    assert adopted == {}


# --------------------------------------------------------------------------- #
# REST + WS
# --------------------------------------------------------------------------- #
@pytest.fixture
def client(bot, monkeypatch):
    events: list[dict] = []

    async def rec(event):
        events.append(event)

    monkeypatch.setattr(app_module, "_broadcast", rec)
    with TestClient(app_module.app) as c:
        yield c, events


def test_rest_teach_flow_broadcasts_states(client, monkeypatch):
    c, events = client

    async def fake_start(bot_id):
        return {"recording_id": "rid1"}

    async def fake_stop(bot_id, recording_id):
        return {"events": _EVENTS, "transcript": teach.transcript(_EVENTS)}

    monkeypatch.setattr(app_module.teach, "start", fake_start)
    monkeypatch.setattr(app_module.teach, "stop", fake_stop)
    monkeypatch.setattr(
        app_module.teach, "synthesize", lambda b, r, n=None: {"skill_name": "book-a-flight"}
    )

    started = c.post("/api/bots/ala/teach/start")
    assert started.status_code == 201 and started.json() == {"recording_id": "rid1"}

    stopped = c.post("/api/bots/ala/teach/stop", json={"recording_id": "rid1"})
    assert stopped.status_code == 200
    assert stopped.json()["transcript"].startswith('clicked "Login"')

    made = c.post("/api/bots/ala/teach/synthesize", json={"recording_id": "rid1"})
    assert made.status_code == 200 and made.json() == {"skill_name": "book-a-flight"}

    assert [e for e in events if e["type"] == "teach"] == [
        {"type": "teach", "bot_id": "ala", "state": "recording"},
        {"type": "teach", "bot_id": "ala", "state": "stopped"},
        {"type": "teach", "bot_id": "ala", "state": "skill_created", "skill_name": "book-a-flight"},
    ]


def test_rest_unknown_bot_is_404(client):
    c, _ = client
    assert c.post("/api/bots/nie-ma/teach/start").status_code == 404
    assert c.post("/api/bots/nie-ma/teach/stop", json={"recording_id": "x"}).status_code == 404
    assert c.post("/api/bots/nie-ma/teach/synthesize", json={"recording_id": "x"}).status_code == 404


def test_rest_synthesize_without_skill_is_404(client, recording, adopted, monkeypatch):
    c, events = client
    monkeypatch.setattr(
        app_module.gateway, "chat", lambda bot_id, message: {"reply": "nic", "session_id": "s"}
    )

    failed = c.post("/api/bots/ala/teach/synthesize", json={"recording_id": recording})

    assert failed.status_code == 404 and recording in failed.json()["detail"]
    assert not [e for e in events if e.get("state") == "skill_created"]
