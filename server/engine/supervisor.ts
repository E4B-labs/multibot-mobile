// multibot: sidecar silnika (Python FastAPI z engine/). Harness jest jego
// nadzorcą tylko w sensie "podnieś, jeśli nie stoi" — nie restartuje go, nie
// pilnuje i NIE ubija przy zamknięciu aplikacji.
//
// Trzy ścieżki, w tej kolejności:
//   1. `ENGINE_URL` w env  → silnik zewnętrzny (Termux, serwer, drugi dev).
//      Zero spawnu, wyłącznie health-check. Ta sama umowa co scripts/dev-engine.mjs.
//   2. silnik już odpowiada na /health → reattach, zero spawnu.
//   3. nie odpowiada → spawn DETACHED i czekanie na /health.
//
// DETACHED jest wymogiem, nie optymalizacją: rutyny botów (harmonogramy, webhooki)
// mają chodzić dalej po zamknięciu okna aplikacji, więc proces silnika NIE może
// wisieć na cyklu życia harnessu. Stąd `detached` + `stdio: "ignore"` + `unref()`
// — przytrzymanie stdio dziecka anulowałoby detach.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
/** repo root: server/engine/ → server/ → repo */
const ROOT = join(HERE, "..", "..");
const ENGINE_DIR = join(ROOT, "engine");
const DEFAULT_URL = "http://127.0.0.1:8700";

/** Python z venvu silnika — ten sam wzór resolvingu co scripts/dev-engine.mjs. */
export function venvPython(engineDir = ENGINE_DIR): string {
  return process.platform === "win32"
    ? join(engineDir, ".venv", "Scripts", "python.exe")
    : join(engineDir, ".venv", "bin", "python");
}

async function healthy(baseUrl: string, timeoutMs = 1_500): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(timeoutMs) });
    return res.ok;
  } catch {
    return false;
  }
}

export class EngineUnavailableError extends Error {}

function spawnEngine(baseUrl: string) {
  const python = venvPython();
  if (!existsSync(python)) {
    throw new EngineUnavailableError(
      `engine venv missing at ${python} — create it with: cd engine && uv venv .venv --python 3.12 && ` +
        `uv pip install --python ${process.platform === "win32" ? ".venv\\Scripts\\python.exe" : ".venv/bin/python"} -r requirements.txt`,
    );
  }
  const port = new URL(baseUrl).port || "8700";
  // Domyślne katalogi danych jak w scripts/dev-engine.mjs — silnik trzyma profile
  // botów obok repo, nie w nim.
  const dataDir = process.env.SLAFY_DATA_DIR ?? join(ENGINE_DIR, "..", "engine-data");
  const child = spawn(python, ["-m", "uvicorn", "server.app:app", "--port", port], {
    cwd: ENGINE_DIR,
    env: { ...process.env, SLAFY_DATA_DIR: dataDir, HERMES_HOME: process.env.HERMES_HOME ?? dataDir },
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
  console.log(`[engine] spawned detached (pid ${child.pid}) → ${baseUrl}`);
}

/** Jedno wspólne dojście w locie — N równoległych tur nie odpala N silników. */
let pending: Promise<string> | null = null;

/**
 * Zwraca base URL działającego silnika, podnosząc go w razie potrzeby.
 * Rzuca `EngineUnavailableError`, gdy silnika nie da się mieć — wołający
 * (driver) ma to zamienić w stan "unavailable", nie w wywrotkę harnessu.
 */
export function ensureEngine(): Promise<string> {
  return (pending ??= run().finally(() => {
    pending = null;
  }));
}

async function run(): Promise<string> {
  const external = process.env.ENGINE_URL;
  const baseUrl = (external ?? DEFAULT_URL).replace(/\/$/, "");

  if (await healthy(baseUrl)) return baseUrl;
  if (external) {
    // Zewnętrznego silnika NIE podnosimy — nie nasz proces, nie nasza maszyna.
    throw new EngineUnavailableError(`no engine at ENGINE_URL=${baseUrl} — start it there first`);
  }

  spawnEngine(baseUrl);
  // Start silnika to import FastAPI + Hermesa — na zimno kilkanaście sekund.
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 400));
    if (await healthy(baseUrl)) return baseUrl;
  }
  throw new EngineUnavailableError(`engine did not answer ${baseUrl}/health within 60s`);
}
