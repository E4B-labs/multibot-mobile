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
    soul = (bots.profile_dir("ala") / "SOUL.md").read_text(encoding="utf-8")
    assert "create_routine" in soul and "ToolSearch" in soul
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
