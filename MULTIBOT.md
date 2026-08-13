# Multibot

Fork [OpenMausBot](https://github.com/milind-soni/OpenMausBot) (MIT) z silnikiem
[slafy-bot](engine/) — Python FastAPI nad [Hermes Agentem](https://github.com/NousResearch/hermes-agent).
Frontend i harness = OpenMausBot; silnik dokłada: BYOK (OpenRouter/Anthropic/
OpenAI/custom, lokalne modele, bez subskrypcji vendora), komputery Playwright
per bot z take-over, rutyny (cron + webhook, działają przy zamkniętej apce),
multi-agent, pamięć + RAG + graf, skille /slash + teach-a-task, MCP, voice,
import profili Hermesa, Termux.

Wersja silnika: `engine/SLAFY-BOT-SHA.txt` (pełna historia w repo slafy-bot).
Plan scalenia: `G:\ClaudeCode\plans\optimized-brewing-hamming.md` (lokalny).

## Dev (Windows / macOS / Linux)

```sh
pnpm install

# silnik (raz):
cd engine
uv venv .venv --python 3.12
uv pip install --python .venv/Scripts/python.exe -r requirements.txt   # win
#              --python .venv/bin/python                               # mac/linux
# hermes-agent: tylko editable (backend odrzuca wheel), SHA w requirements.txt
git config --global core.longpaths true   # windows
git clone --filter=blob:none https://github.com/NousResearch/hermes-agent ../..​/hermes-agent
git -C ../../hermes-agent checkout 17688f9
uv pip install --python .venv/Scripts/python.exe -e ../../hermes-agent
.venv/Scripts/python.exe -m playwright install chromium
cd ..

# trzy procesy:
pnpm dev:engine    # silnik  → 127.0.0.1:8700
pnpm dev:server    # harness → 127.0.0.1:8799
pnpm dev           # app     → http://127.0.0.1:5199
```

Windows: przeglądarki Playwrighta poza C: — `PLAYWRIGHT_BROWSERS_PATH`.
Dev z lokalnym klonem Hermesa zamiast pinu: `uv pip install -e <ścieżka-klona>`.
`ENGINE_URL` w env = harness używa zewnętrznego silnika (Termux/serwer),
niczego nie spawnuje.

## Termux (stary telefon)

Silnik headless: `engine/docs/TERMUX.md`. Harness: `node server/index.ts`,
UI w przeglądarce telefonu na porcie harnessa; `ENGINE_URL=http://127.0.0.1:8700`.

## Testy

```sh
pnpm test                       # vitest harnessa (bez zmian upstreamu)
cd engine && .venv/Scripts/python.exe -m pytest -q     # 249+ pytest silnika
```

## Higiena upstream

`git fetch upstream && git merge upstream/main`. Zmiany w plikach upstreamu
wyłącznie małymi addytywnymi blokami znaczonymi `// multibot:`; nowe pliki bez
kolizji. Silnik wyłączony = zachowanie stock OpenMausBot.
