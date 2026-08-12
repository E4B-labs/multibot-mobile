/goal

# SLAFY-BOT — GAUNTLET: zbuduj open-source klon Grok Bota od zera do działającej apki

Jesteś autonomicznym budowniczym. Pracujesz w pętli, bez nadzoru, aż projekt
będzie DZIAŁAŁ w całości: backend, frontend, podpięcia, komputery botów,
pluginy, rutyny, pamięć, multi-agent. Pixel-perfect animacje i szlif wizualny
to OSTATNIA faza — nie blokują rdzenia. Wszystko inne 1:1 z Grok Botem.

## KROK 0 — pytania (jedyny moment interakcji)

**Jeśli sekcja DECYZJE w `LOOP.md` jest już wypełniona — pomiń KROK 0 całkowicie
i idź do PĘTLI.** KROK 0 wykonuje się raz, w sesji interaktywnej; w trybie
`claude -p` (runner) nie wolno zadawać pytań.

Zanim cokolwiek zrobisz, zadaj Kacprowi przez AskUserQuestion (możesz w kilku
turach, po polsku):
1. Nazwa finalna produktu (fallback: slafy-bot).
2. Repo GitHub: utworzyć `SlafyGH/slafy-bot` czy `clewkord/slafy-bot`, czy bez remote?
3. Klucze API do developmentu: który provider (OpenRouter / OpenAI / Anthropic /
   xAI / lokalny Ollama)? Poproś o wpisanie do `.env` (NIE do repo).
4. Cel uruchomienia dev: ten PC (Windows) czy VPS? (Tier 1 komputerów botów
   wymaga Playwright/Docker — na tym PC Playwright wystarczy.)
5. Budżet czasowy/tokenowy: pracować bez przerwy do końca, czy checkpoint po
   fazie 3 (rekomendacja z PLAN.md)?
Po odpowiedziach zapisz je w `LOOP.md` sekcja `DECYZJE` i NIE zadawaj więcej
pytań — każdą kolejną niejasność rozstrzygasz sam, wybierasz wariant prostszy,
notujesz w `LOOP.md`.

## KONTEKST — przeczytaj PRZED pierwszą iteracją

Wszystko leży w tym repo (`G:\Projects\slafy-bot`):
- `PLAN.md` — architektura, kontrakt 38 funkcji 1:1 (§2 = checklista
  akceptacyjna), 14 faz budowy (§5), zasady pętli (§6), ryzyka (§7).
- `docs/UI-SPEC.md` — kompletny spec UI zweryfikowany klatkami (14 sekcji).
- `docs/reference/FRAMES-INDEX.md` — mapa ~250 klatek 1024px
  (`docs/reference/frames-hd/`) na ekrany; czytaj klatki Readem gdy budujesz UI.
- `docs/reference/*.clean.txt` — transkrypty 6 filmów źródłowych z timestampami.

Rdzeń architektury (decyzje już podjęte, nie podważaj):
- 1 Bot = 1 profil Hermes Agent (config.yaml + SOUL.md + memory_store.db)
  + 1 komputer + 1 obecność w UI. Fork/embed `github.com/NousResearch/hermes-agent`.
- UI = PWA (jeden codebase: desktop + telefon), sync przez WebSocket.
- Pluginy = serwery MCP + broker OAuth (Grok Bot robi dokładnie tak — dowód w
  UI-SPEC §7). Trigger engine z generic webhookiem.
- Komputery botów: Tier 1 = Playwright persistent context per bot + podgląd
  live + take-over; Tier 2 (telefon) = współdzielona przeglądarka.
- Providerzy: BYOK domyślnie; OAuth subskrypcyjny za flagą ToS-risk.

## PĘTLA

Stan pętli w `LOOP.md` (repo root). Każda iteracja:
1. Przeczytaj `LOOP.md` + wiersz aktualnej fazy w `PLAN.md` §5.
2. Faza bez planu wykonawczego? Wygeneruj go skillem `superpowers:writing-plans`
   do `docs/plans/faza-N.md`, zadania wykonuj przez
   `superpowers:subagent-driven-development` (subagenty: model Opus 5, zawsze).
3. Wykonaj kolejne zadanie/zadania TDD: test → fail → kod → pass → commit
   (conventional: feat/fix/docs/refactor/chore).
4. Gate fazy (kolumna „Gate" w PLAN.md §5): testy jednostkowe + smoke Playwright
   + odhacz pokryte wiersze §2. Gate przechodzi → w `LOOP.md` faza++,
   `NASTĘPNE:` wskaż pierwsze zadanie nowej fazy.
5. Gate padł 2× na tym samym zadaniu → `STATUS: BLOCKED` + sekcja `RAPORT` w
   `LOOP.md` (co padło, logi, co próbowano) i STOP.
6. Wszystkie fazy 0–13 done + checklista §2 kompletna → `STATUS: DONE` +
   `RAPORT` końcowy (jak uruchomić, co gdzie leży, znane ograniczenia) i STOP.

Tryb podstawowy: JEDNA interaktywna sesja Claude Code odpalona komendą
`/goal` w katalogu repo. Nie kończysz tury, dopóki `LOOP.md` nie ma
`STATUS: DONE` albo `STATUS: BLOCKED` — po gate'cie fazy od razu następna
faza, bez pytania „czy kontynuować". Długość sesji i kompresja kontekstu to
nie powód do stopu; stan jest w `LOOP.md` i commitach, więc urwana sesja +
ponowne `/goal` wznawia od miejsca przerwania. Fallback bez nadzoru:
`pwsh -File loop.ps1` (kręci `claude -p` z tym plikiem; wtedy każda sesja
robi minimum jedno zadanie i gate, potem kończy się czysto).

## ZASADY TWARDE (środowisko Kacpra)

- Windows 10. **Zakaz zapisu na C:** — temp wyłącznie `D:\tmp` (ustaw
  `$env:TEMP`/`$env:TMP`), instalacje/cache na D: lub G:.
- Sekrety: `.env` w `.gitignore` od pierwszego commita; przed KAŻDYM pushem
  skan diffa (wzorce: `sk-`, `ghp_`, `AKIA`, `-----BEGIN.*PRIVATE KEY-----`,
  connection stringi z hasłem); trafienie = nie pushuj, zgłoś w LOOP.md.
- Remote na koncie SlafyGH/clewkord → commit + push po każdej skończonej
  zmianie bez pytania. Brak remote → same commity.
- Kod: minimalny (ponytail) — stdlib nad zależnością, najkrótszy działający
  diff, żadnych spekulacyjnych abstrakcji; świadome cięcia oznaczaj
  komentarzem `ponytail:`. Nietrywialna zmiana przed zamknięciem fazy →
  `coderabbit:code-review` jeśli dostępny.
- Biblioteki/frameworki: dokumentacja przez Context7 PRZED pisaniem kodu
  (Hermes Agent, Playwright, MCP SDK — wersje z 2026, nie z treningu).
- Luki UI-SPEC §14 (avatar picker, globalny Settings, group chat, dokładne
  hexy/font) NIE blokują — buduj z klatek najbliższy odpowiednik, lukę odnotuj
  w LOOP.md. Gate fazy 2 „visual diff" = zgodność layoutu i komponentów z
  UI-SPEC, nie pixel-perfect; szlif wizualny i animacje = osobna ostatnia faza.

## DEFINICJA KOŃCA

`STATUS: DONE` wolno wpisać tylko gdy: apka startuje jedną komendą (README),
wszystkie gate'y faz 0–13 zielone, checklista PLAN.md §2 odhaczona w 100%
(poza pozycjami odroczonymi do fazy szlifu — te wypisane w RAPORT), testy
przechodzą, `git status` czysty.
