"""Uprawnienia bota = twarde on/off toolsetów Hermesa (feature #12, faza 13).

Ziarno to TOOLSET, nie pojedyncze narzędzie — Hermes nie ma klucza
`disabled_tools`/`allowed_tools` (APPROVALS-RECON §3). Egzekwuje to sam Hermes
przy budowie agenta, więc wyłączonego narzędzia model NIE DOSTAJE w ofercie;
nasza warstwa tylko zapisuje decyzję do `config.yaml` profilu bota.

DLACZEGO `agent.disabled_toolsets`, A NIE `platform_toolsets.api_server`
    Oba działają i oba dają identyczny wynik na NASZEJ platformie — sprawdzone
    sondą na prawdziwym `hermes_cli.tools_config._get_platform_tools`
    (hermes-agent 0.20.0):

        platform      baseline | platform_toolsets(bez terminal) | disabled_toolsets
        api_server    terminal | terminal WYŁĄCZONY              | terminal WYŁĄCZONY
        cron          terminal | terminal ZOSTAJE                | terminal WYŁĄCZONY

    `platform_toolsets` to biała lista PER PLATFORMA (`tools_config.py:2279`),
    a bot ma w ofercie toolset `cronjob` i nasze rutyny zakładają PRAWDZIWE
    joby crona Hermesa (`server/routines.py::create` → `cron_jobs.create_job`).
    Job wykonuje się na platformie `cron`, gdzie wpis dla `api_server` nie
    obowiązuje — czyli bot z "wyłączonym" terminalem odzyskałby go, planując
    sobie rutynę. `agent.disabled_toolsets` jest ODEJMOWANE NA KOŃCU, dla każdej
    platformy (`tools_config.py:2544`, komentarz "This runs last so it overrides
    everything above"), więc zamyka tę dziurę. 1 bot = 1 profil, więc "globalne
    dla profilu" znaczy dokładnie "per bot".

    Drugi powód: biała lista wymaga MATERIALIZACJI pełnego zestawu. Zapis listy
    węższej niż oferta po cichu wyłącza wszystko spoza niej (sonda: lista
    7 toolsetów zabrała botowi `file`, `todo`, `vision`, `image_gen`,
    `session_search`), a lista zamrożona dziś odcięłaby toolsety, które Hermes
    doda jutro. Odejmowanie nie ma tego problemu — dotyka wyłącznie nazwanych.

ponytail: bez własnej bazy uprawnień — źródłem prawdy jest `config.yaml`
profilu, tak jak przy providerze i pamięci. Ceiling: ziarno toolsetowe. Zgoda
per pojedyncze narzędzie wymaga własnego toolsetu (`toolsets.create_custom_toolset`)
albo pluginu `pre_tool_call` (APPROVALS-RECON §1.3) — dopisać, gdy ktoś poprosi
o "browser tak, ale bez browser_exec".
"""

import yaml

from server.bots import profile_dir

# Zweryfikowane sondą na `_get_platform_tools({}, "api_server")` (hermes-agent
# 0.20.0) — to DOKŁADNIE toolsety, które nasza platforma oferuje modelowi:
#   bfl→bfl_flux3_*, browser→browser_*, code_execution→execute_code,
#   cronjob→cronjob, delegation→delegate_task, file→read_file/write_file/patch/
#   search_files, image_gen→image_generate, memory→memory, session_search→
#   session_search, skills→skill_manage/skill_view/skills_list, terminal→
#   terminal/process, todo→todo, vision→vision_analyze, web→web_search/web_extract.
# NIE MA tu `fact_store` (narzędzie pluginu pamięci holograficznej — jedzie z
# pluginem, biała lista toolsetów go nie dotyka) ani `stt`/`tts`/`clarify`/
# `computer_use`/`x_search`, bo tych api_server domyślnie nie oferuje.
TOOLSETS = [
    "bfl",
    "browser",
    "code_execution",
    "cronjob",
    "delegation",
    "file",
    "image_gen",
    "memory",
    "session_search",
    "skills",
    "terminal",
    "todo",
    "vision",
    "web",
]


def _path(bot_id: str):
    return profile_dir(bot_id) / "config.yaml"  # ValueError na złym id → 422


def _read(bot_id: str) -> dict:
    path = _path(bot_id)
    return (yaml.safe_load(path.read_text(encoding="utf-8")) or {}) if path.exists() else {}


def _disabled(cfg: dict) -> list[str]:
    return [str(t) for t in ((cfg.get("agent") or {}).get("disabled_toolsets") or [])]


def get(bot_id: str) -> dict[str, bool]:
    """`{toolset: włączony?}` dla wszystkich `TOOLSETS`. Brak klucza = wszystkie."""
    off = _disabled(_read(bot_id))
    return {ts: ts not in off for ts in TOOLSETS}


def set(bot_id: str, toolset: str, enabled: bool) -> dict[str, bool]:  # noqa: A001
    """Włącz/wyłącz jeden toolset. Idempotentne, merge do istniejącego configu."""
    if toolset not in TOOLSETS:
        raise ValueError(f"unknown toolset: {toolset!r} (znane: {', '.join(TOOLSETS)})")
    cfg = _read(bot_id)
    off = _disabled(cfg)
    if enabled:
        new = [t for t in off if t != toolset]
    else:
        new = off if toolset in off else [*off, toolset]
    if new != off:
        cfg["agent"] = {**(cfg.get("agent") or {}), "disabled_toolsets": new}
        _path(bot_id).write_text(
            yaml.safe_dump(cfg, sort_keys=False, allow_unicode=True), encoding="utf-8"
        )
    return get(bot_id)
