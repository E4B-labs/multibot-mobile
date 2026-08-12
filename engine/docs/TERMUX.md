# slafy-bot na starym telefonie (Termux)

Cały serwer + UI w jednym procesie na Androidzie. Bez roota, bez chmury.

## Wymagania

- Android 10+, ARM64 (aarch64).
- ~2 GB wolnego miejsca (pip buduje część paczek ze źródeł) i ~2 GB RAM.
- [Termux z F-Droida albo GitHuba](https://github.com/termux/termux-app) —
  **nie** ze Sklepu Play (tamta wersja jest martwa).
- Klucz API providera (OpenRouter) — bez niego bot nie gada.

## Instalacja

```bash
pkg install -y git
git clone https://github.com/clewkord/slafy-bot ~/slafy-bot
bash ~/slafy-bot/scripts/termux-install.sh
```

Repo jest prywatne — `git clone` zapyta o login i token GitHuba (Personal Access
Token, nie hasło).

Skrypt jest idempotentny: kolejne odpalenie robi `git pull` + reinstall, nie
błąd. Pierwszy przebieg trwa **kilkadziesiąt minut** — dla Androida nie ma
gotowych kół na PyPI, więc ze źródeł kompilują się `pydantic-core` i `jiter`
(Rust) oraz `uvloop` i `httptools` (C, z `uvicorn[standard]` Hermesa). To one są
pierwszymi podejrzanymi, gdy `pip install` padnie — Termux nie ma ich prebuiltów
w repo, w przeciwieństwie do `cryptography` i `numpy`.

Co instaluje (i po co):

| Pakiet | Powód |
| --- | --- |
| `python`, `python-pip`, `python-ensurepip-wheels` | Termux wycina `ensurepip` z `python`; bez trzeciego `python -m venv` pada |
| `python-cryptography` | dokładnie pin Hermesa (50.0.0) w wersji prebuilt — omija najcięższy build rustowy |
| `python-numpy` | prebuilt; przyspiesza holograf pamięci (bez numpy Hermes ma czysto-pythonowy fallback, wolniejszy, ale działa) |
| `rust`, `binutils` | źródłowe buildy `pydantic-core` i `jiter` |
| `clang` | rozszerzenia C: `psutil`, `aiohttp`, `pyyaml`, `multidict` |
| `git`, `nodejs-lts` | klon repo i build UI (`vite`) |

Dwa miejsca, w których skrypt świadomie idzie pod prąd:

- **`pip --ignore-requires-python`** — `hermes-agent` deklaruje `python <3.14`, a
  Termux ma 3.14.6. Powód capa (brak kół `cp314` dla `pydantic-core`) jest
  nieaktualny — PyPI ma je (sprawdzone 2026-08). To pierwszy podejrzany, jeśli
  instalacja się wywali; flaga do zdjęcia, gdy upstream podniesie cap.
- **venv z `--system-site-packages`** — inaczej pip nie widzi prebuiltów z `pkg`
  i próbuje zbudować `cryptography` od zera (na telefonie: godziny albo błąd).

## Uruchomienie

```bash
termux-wake-lock                     # bez tego Android uśpi serwer
cd ~/slafy-bot
SLAFY_SERVE_UI=1 HERMES_HOME=$HOME/slafy-data SLAFY_DATA_DIR=$HOME/slafy-data \
  .venv/bin/uvicorn server.app:app --host 0.0.0.0 --port 8700
```

Potem w przeglądarce telefonu: **http://127.0.0.1:8700**.

`SLAFY_SERVE_UI=1` dokłada zbudowane `ui/dist` pod `/` (StaticFiles), więc leci
JEDEN proces — zero osobnego node'a. Trasy `/api/*` są rejestrowane wcześniej niż
mount, więc API wygrywa; bez tej zmiennej serwer zachowuje się jak dotąd (samo
API). `--host 0.0.0.0` wystawia serwer też na Wi-Fi — jak nie chcesz, daj
`127.0.0.1`. Zatrzymanie: `Ctrl+C`, potem `termux-wake-unlock`.

Klucz providera wpisujesz w UI albo w `$HOME/slafy-data/.env`.

## Czego na Termuxie NIE ma (uczciwie)

- **Komputer bota nie działa.** Playwright nie wspiera Androida i nie da się go
  tam zainstalować, więc skrypt go pomija. Endpointy `/api/bots/{id}/computer/*`
  i `/teach/*` oddają **404** ("brak przeglądarki"), a UI pokazuje kartę
  komputera jako niedostępną — to zachowanie z fazy 4, nie awaria. Czat, pamięć,
  rutyny, pluginy, grupy i głos działają w pełni.
- **STT (mowa → tekst) wymaga `GROQ_API_KEY`.** Transkrypcja idzie do Groqa;
  bez klucza mikrofon w UI zwróci błąd. Lokalne whisper-y (`faster-whisper`,
  `ctranslate2`) na Termuxie odpadają.
- **TTS działa** — `edge-tts` to czysty Python i syntezuje po sieci.
- **Tier 2 (`SLAFY_COMPUTER_TIER=2`) to nie jest tryb na Termux.** To wspólna
  headless chromium dla słabych *linuksowych* maszyn z przeglądarką (RPi, stary
  laptop). Na Androidzie chromium dla Playwrighta nie istnieje, więc ustawienie
  tej zmiennej niczego nie odblokuje.

## Weryfikacja bez telefonu

Fizycznego Androida nie ma w pętli budowy, więc skrypt sprawdzamy dwutorowo:

1. `pytest tests/test_termux_script.py` — `bash -n` (składnia), brak `apt `
   (Termux ma `pkg`), brak ścieżek `C:`, końce linii LF (bash na Androidzie
   wywala się na CRLF; pilnuje tego też `.gitattributes`).
2. **WSL Ubuntu** — najbliższe dostępne środowisko. `pkg` tam nie istnieje, więc
   nie odpalamy skryptu, tylko powtarzamy jego kroki ręcznie:

```bash
wsl -d Ubuntu -e bash -lc '
  sudo apt-get install -y python3-venv nodejs npm
  cd ~/slafy-bot && python3 -m venv .venv
  .venv/bin/pip install hermes-agent edge-tts aiohttp "mcp==1.28.1" "starlette==1.3.1"
  (cd ui && npm ci && npm run build)
  SLAFY_SERVE_UI=1 SLAFY_DATA_DIR=$HOME/slafy-data .venv/bin/uvicorn server.app:app --port 8700 &
  sleep 8; curl -s localhost:8700/health; curl -s localhost:8700/api/bots
'
```

To dowodzi "full app runs" na Linuksie bez Playwrighta (`import server.app`
przechodzi bez niego — provider importuje playwright leniwie, w środku funkcji).
Czego to NIE dowodzi: buildów rustowych pod bioniciem Termuxa i pakietów `pkg`.
Te są sprawdzone tylko po indeksie pakietów Termuxa (nazwy i wersje istnieją w
repo aarch64), nie przez realną instalację.
