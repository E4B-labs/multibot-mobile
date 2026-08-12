# Faza 0 — Recon Hermes Agent — plan wykonawczy

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sklonować hermes-agent i udokumentować w `docs/HERMES-FACTS.md` wszystko, co fazy 1–13 konsumują (profile, providerzy, gateway, terminal backends, skille, cron, pamięć).

**Architecture:** Faza czysto badawcza — zero kodu produktu. Klon LĄDUJE POZA repo (`G:\Projects\hermes-agent`), do repo trafia tylko dokument faktów. Ekstrakcja przez subagenta Explore (Opus 5), nie przez surowe Ready całego frameworka.

**Tech Stack:** git, subagent Explore, markdown.

## Global Constraints

- Zakaz zapisu na C: (temp = `D:\tmp`).
- Klon hermes-agent NIE wchodzi do repo slafy-bot (gitignore nie potrzebny — klon jest sibling dir).
- Auto-push na main po każdym skończonym zadaniu; skan sekretów przed pushem.
- Gate fazy 0 (PLAN.md §5): `docs/HERMES-FACTS.md` istnieje; UI-SPEC — v2 DONE 2026-08-12 (połowa gate'a spełniona przed pętlą, luki §14 nie blokują).

---

### Task 1: Klon hermes-agent

**Files:**
- Create: `G:\Projects\hermes-agent\` (klon, poza repo)

**Interfaces:**
- Produces: lokalny klon dla Taska 2; realny URL repo (jeśli `NousResearch/hermes-agent` 404, znaleźć przez `gh search repos hermes-agent` i zanotować).

- [ ] **Step 1: Klon**

```bash
git clone --depth 1 https://github.com/NousResearch/hermes-agent /g/Projects/hermes-agent
```

Expected: klon OK. Przy 404: `gh search repos "hermes agent" --limit 10`, wybrać właściwe, zanotować URL do HERMES-FACTS.md.

- [ ] **Step 2: Szybka weryfikacja zawartości**

```bash
ls /g/Projects/hermes-agent
```

Expected: widoczny kod frameworka (README, katalog źródeł). Brak → STOP, wróć do Step 1.

### Task 2: Ekstrakcja faktów + docs/HERMES-FACTS.md

**Files:**
- Create: `docs/HERMES-FACTS.md`

**Interfaces:**
- Consumes: klon z Taska 1.
- Produces: `docs/HERMES-FACTS.md` z sekcjami dokładnie: Stack & runtime; Profile format (config.yaml schema, SOUL.md konwencje, memory_store.db schema); Provider layer (jak dodaje się providera, BYOK); Gateway API (jak wysłać/odebrać wiadomość programowo); Terminal backends (abstrakcja, jak wpiąć własny — faza 4); Skills format (agentskills.io — fazy 6/9); Cron/scheduler (faza 6); Jak osadzić runtime w naszym serwerze (faza 1); Wersje zależności.

- [ ] **Step 1: Subagent Explore (model Opus 5) przeszukuje klon**

Prompt subagenta: przeczytaj strukturę `G:\Projects\hermes-agent`, README, pliki konfiguracyjne i kod profili/providerów/gateway/terminal-backends/skills/cron; zwróć fakty pod każdą sekcję z listy powyżej, z ścieżkami plików źródłowych.

- [ ] **Step 2: Zapisz `docs/HERMES-FACTS.md`**

Każda sekcja z listy wypełniona konkretami (ścieżki, nazwy klas/funkcji, schematy). Sekcja bez danych = wpis "NIE ZNALEZIONO + gdzie szukano" (nie zmyślać).

- [ ] **Step 3: Commit + push**

```bash
git add docs/HERMES-FACTS.md && git commit -m "docs: HERMES-FACTS — recon fazy 0" && git push
```

### Task 3: Gate fazy 0 + przejście do fazy 1

- [ ] **Step 1: Gate check**

`docs/HERMES-FACTS.md` istnieje i ma wszystkie sekcje; UI-SPEC gate spełniony wcześniej (v2 DONE). Odnotować w LOOP.md DZIENNIK: brak `F1_0Lkp16Rc.clean.txt` (5/6 transkryptów; nie blokuje) oraz notkę: przy fazie 2+ ustawić `PLAYWRIGHT_BROWSERS_PATH` na D:/G: przed `playwright install`.

- [ ] **Step 2: LOOP.md — FAZA: 1, NASTĘPNE: plan fazy 1**

```bash
git add LOOP.md && git commit -m "chore: gate fazy 0 zielony, przejście do fazy 1" && git push
```
