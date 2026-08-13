"""Boty = profile Hermesa. 1 bot = 1 profil w $SLAFY_DATA_DIR/profiles/<bot_id>.

Metadane bota trzymamy w profilu (`bot.json`), nie w osobnej bazie — profil jest
jedynym źródłem prawdy, więc restart i backup działają za darmo (HERMES-FACTS §2).
"""

import hermes_bootstrap  # noqa: F401  # MUSI być pierwszym importem Hermesa (HERMES-FACTS §1)

import json
import os
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path

from hermes_cli import profiles as hermes_profiles

# Ten sam regex co `_PROFILE_ID_RE` Hermesa — bot_id JEST nazwą profilu (HERMES-FACTS §2).
# Walidujemy sami zamiast przez `normalize_profile_name()`, bo tamto po cichu
# lowercase'uje zamiast odrzucić — a bot_id wchodzi z HTTP i trafia do ścieżki.
_BOT_ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")

_DEFAULT_DATA_DIR = r"G:\Projects\slafy-bot-data"

# Tryb pracy bota (faza F4): `approval` = narzędzia z kategorii ryzykownych czekają
# na zgodę człowieka, `autonomous` = lecą bez pytania. BRAK klucza w `bot.json`
# znaczy `approval` — dlatego `create_bot` go nie wpisuje: nowy bot jest ostrożny
# z definicji, a kształt zwrotki CRUD-u zostaje bez zmian.
AUTONOMY = ("approval", "autonomous")

_SOUL = """# {name}

**Rola:** {title}

{description}
"""


def data_dir() -> Path:
    """Katalog danych (= `HERMES_HOME` dla wszystkich botów). Czytany przy każdym
    wywołaniu, nie przy imporcie — testy podmieniają go per test."""
    return Path(os.environ.get("SLAFY_DATA_DIR") or _DEFAULT_DATA_DIR)


def profile_dir(bot_id: str) -> Path:
    """Katalog profilu bota. Jedyne miejsce składania ścieżki, więc też jedyny
    punkt walidacji id — reszta CRUD-u przechodzi tędy."""
    if not _BOT_ID_RE.match(bot_id):
        raise ValueError(f"invalid bot_id: {bot_id!r} (oczekiwane {_BOT_ID_RE.pattern})")
    return data_dir() / "profiles" / bot_id


def _write(bot: dict) -> None:
    d = profile_dir(bot["id"])
    (d / "SOUL.md").write_text(_SOUL.format(**bot), encoding="utf-8")
    (d / "bot.json").write_text(json.dumps(bot, indent=2, ensure_ascii=False), encoding="utf-8")


def create_bot(bot_id: str, name: str, title: str = "", description: str = "") -> dict:
    profile_dir(bot_id)  # walidacja przed jakimkolwiek efektem ubocznym
    # `create_profile()` kotwiczy się na `get_default_hermes_root()`, które czyta
    # WYŁĄCZNIE env `HERMES_HOME` (nie contextvar `set_hermes_home_override`).
    # Bez tego przy nieustawionym env profil poleciałby do %LOCALAPPDATA% na C:.
    os.environ["HERMES_HOME"] = str(data_dir())
    # Używamy funkcji Hermesa zamiast własnego bootstrapu, żeby `_PROFILE_DIRS`,
    # `.env` i migracja configu zostały zrobione jego regułami. Kasowanie już nie:
    # `delete_profile()` pyta interaktywnie i sprząta wrappery w ~/.local/bin (C:).
    hermes_profiles.create_profile(bot_id)
    # Lokalny import: `plugins` czyta `list_bots()` stąd, więc na górze pliku
    # byłby cykl. Nowy bot od razu dostaje wspólne tokeny (junction) i pełny
    # zestaw serwerów MCP — o to chodzi w "drugi bot bez reconnectu".
    from server import plugins

    plugins.ensure_bot(bot_id)
    bot = {
        "id": bot_id,
        "name": name,
        "title": title,
        "description": description,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    _write(bot)  # nadpisuje domyślny SOUL.md Hermesa naszym, z tożsamością bota
    return bot


def list_bots() -> list[dict]:
    profiles_root = data_dir() / "profiles"
    bots = [json.loads(p.read_text(encoding="utf-8")) for p in profiles_root.glob("*/bot.json")]
    return sorted(bots, key=lambda b: b["id"])


def get_bot(bot_id: str) -> dict | None:
    path = profile_dir(bot_id) / "bot.json"
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None


def update_bot(bot_id: str, **fields) -> dict:
    bot = get_bot(bot_id)
    if bot is None:
        raise KeyError(bot_id)
    # `autonomy` czyta plugin `slafy_approvals` PROSTO Z `bot.json` profilu
    # (faza F4) — dlatego walidujemy wartość tutaj, a nie tylko w warstwie HTTP:
    # literówka w trybie znaczyłaby "pytaj o zgodę" albo "nie pytaj", w zależności
    # od tego, jak plugin ją zinterpretuje.
    if "autonomy" in fields and fields["autonomy"] not in AUTONOMY:
        raise ValueError(f"invalid autonomy: {fields['autonomy']!r} (oczekiwane {AUTONOMY})")
    bot.update(
        {k: v for k, v in fields.items()
         if k in ("name", "title", "description", "avatar", "autonomy")}
    )
    _write(bot)  # SOUL.md odtwarzany razem z bot.json — inaczej zostaje nieaktualna tożsamość
    return bot


def delete_bot(bot_id: str) -> None:
    shutil.rmtree(profile_dir(bot_id), ignore_errors=True)
