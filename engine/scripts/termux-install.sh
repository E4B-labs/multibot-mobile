#!/data/data/com.termux/files/usr/bin/bash
# Instalator slafy-bota na Termuxie (Android). Idempotentny: ponowne odpalenie =
# git pull + reinstall. Zero interakcji (pkg -y). Szczegóły: docs/TERMUX.md.
#
# Shebang absolutny (nie `#!/usr/bin/env bash`): Android nie ma /usr/bin, a
# env-shebang działa tylko przez termux-exec — nie ma gwarancji, że jest.
#
# CZEGO TU NIE MA:
#   * playwright — Playwright nie wspiera Androida. Komputer bota na telefonie
#     NIE działa (endpointy computer/teach oddają 404, UI to obsługuje).
#     `import server.app` przechodzi bez playwrighta (provider importuje go
#     leniwie, w środku funkcji), więc czat/pamięć/rutyny/pluginy/głos żyją.
#   * numpy z pipa — Termux ma prebuilt `python-numpy` (poniżej), a holograf
#     pamięci Hermesa i tak ma czysto-pythonowy fallback bez numpy.
set -euo pipefail

REPO_URL="https://github.com/clewkord/slafy-bot"
SRC="$HOME/slafy-bot"
DATA="$HOME/slafy-data"
VENV="$SRC/.venv"

say() { printf '[slafy] %s\n' "$*"; }

say "pakiety Termuxa"
pkg update -y
# python-cryptography      = dokładnie pin Hermesa (50.0.0) gotowy do użycia —
#                            omija najcięższy build rustowy na telefonie
# python-ensurepip-wheels  = Termux wycina ensurepip z `python`; bez tego
#                            `python -m venv` pada
# python-numpy             = prebuilt, szybszy holograf pamięci
# rust binutils            = źródłowe buildy pydantic-core i jiter
# clang                    = rozszerzenia C (psutil, aiohttp, pyyaml, multidict)
pkg install -y python python-pip python-ensurepip-wheels python-cryptography \
	python-numpy git nodejs-lts rust binutils clang

say "repo -> $SRC"
if [ -d "$SRC/.git" ]; then
	git -C "$SRC" pull --ff-only
else
	git clone "$REPO_URL" "$SRC"
fi

say "venv + zależności serwera (bez playwrighta)"
# --system-site-packages: pip widzi prebuilty z pkg (cryptography, numpy) i
# uznaje piny za spełnione, zamiast budować je od nowa ze źródeł.
[ -d "$VENV" ] || python -m venv --system-site-packages "$VENV"
# Maturin/pyo3 na Termuxie nie zgaduje trójki docelowej — bez tego build
# pydantic-core się wywala.
CARGO_BUILD_TARGET="$(rustc -vV | sed -n 's/^host: //p')"
export CARGO_BUILD_TARGET
# --ignore-requires-python: hermes-agent deklaruje `<3.14`, Termux ma 3.14.
# Powód tamtego capa (brak kół cp314 dla pydantic-core) jest nieaktualny —
# PyPI ma je (sprawdzone 2026-08). Zdjąć flagę, gdy upstream podniesie cap.
"$VENV/bin/pip" install --ignore-requires-python \
	hermes-agent edge-tts aiohttp "mcp==1.28.1" "starlette==1.3.1"

say "UI (npm + build)"
# BEZ --omit=dev: `npm run build` to `tsc -b && vite build`, a vite i typescript
# siedzą w devDependencies — pominięcie ich gwarantuje błąd builda.
(cd "$SRC/ui" && { npm ci || npm install; } && npm run build)

mkdir -p "$DATA"

say "gotowe"
cat <<EOF

  termux-wake-lock          # bez tego Android uśpi serwer
  cd $SRC
  SLAFY_SERVE_UI=1 HERMES_HOME=$DATA SLAFY_DATA_DIR=$DATA \\
    $VENV/bin/uvicorn server.app:app --host 0.0.0.0 --port 8700

  Potem w przeglądarce telefonu: http://127.0.0.1:8700
EOF
