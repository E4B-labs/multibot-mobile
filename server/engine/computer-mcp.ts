// multibot: F5 — komputer "playwright" dla driverów, które NIE są silnikiem.
//
// Bot na driverze slafy ma przeglądarkę natywnie: gateway dopisuje mu
// `browser.cloud_provider: slafy` przy każdej turze (engine/server/gateway.py,
// `_ensure_browser_config`), a toolset Hermesa (`browser_*`) chodzi po tym samym
// profilu. Driver claude/codex/acp nie ma o niej pojęcia, więc dostaje ją tak
// samo jak każdy inny komputer w tym harnessie — jako stdio MCP w
// `integrations.localComputer` (contracts.ts), tyle że serwerem jest silnik:
// `python -m server.computer_mcp` (engine/server/computer_mcp.py).
//
// `localComputer` nie ma pola `cwd` (kontrakt upstreamu, zero zmian) — dlatego
// import pakietu `server.*` bierze się z `PYTHONPATH` wskazanego na `engine/`.
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { engineBotIdFor } from "../drivers/slafy.ts";
import { engineBaseUrl, ensureEngine, venvPython } from "./supervisor.ts";

/** repo root: server/engine/ → server/ → repo */
const ENGINE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "engine");

/** Gdzie ten harness słucha — czytane przy każdym spawnie, bo port bierze się
 *  z env i w testach jest inny niż domyślny. */
export function harnessBaseUrl(): string {
  const port = Number(process.env.OMB_PORT || process.env.OGB_PORT || 8799);
  return `http://127.0.0.1:${port}`;
}

/**
 * Wersja zestawu narzędzi komputera (`engine/server/computer_mcp.py`).
 *
 * Codex ZAPAMIĘTUJE listę narzędzi w wątku: świeży wątek widzi `move`, a wątek
 * założony wcześniej wylicza tylko `click/key/type_text/navigate/read_page` i
 * odmawia — sprawdzone na dwóch botach obok siebie. Numer jedzie w kursorze
 * (`codex.ts::cursorMcpKey`), więc jego zmiana każe zacząć wątek od nowa.
 *
 * PODNIEŚ przy każdej zmianie listy narzędzi tego serwera. Cena podniesienia to
 * pamięć bota po stronie dostawcy (transkrypt harnessu zostaje), więc nie rusza
 * się go przy poprawkach opisów.
 */
export const COMPUTER_TOOLS_VERSION = 2;

export interface McpSpawn {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export type EngineComputerMode = "own" | "shared";

/** Ensure engine-side bot exists and persist which browser profile it uses.
 * Slafy-native bots need this too; their browser tools do not ride this MCP. */
export async function configureEngineComputer(threadId: string, mode: EngineComputerMode): Promise<void> {
  const baseUrl = await ensureEngine();
  const botId = engineBotIdFor(threadId);
  const created = await fetch(`${baseUrl}/api/bots`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: botId, name: botId }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!created.ok && created.status !== 409) throw new Error(`engine computer bot -> HTTP ${created.status}`);
  const configured = await fetch(`${baseUrl}/api/bots/${encodeURIComponent(botId)}/computer/mode`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!configured.ok) throw new Error(`engine computer mode -> HTTP ${configured.status}`);
}

/**
 * multibot (H3): powiedz silnikowi, że przeglądarka tego bota stoi W JEGO
 * KOMPUTERZE, pod tym adresem CDP.
 *
 * Bez tego `ensure_browser` silnika podniósłby drugie, lokalne chromium — agent
 * klikałby po ekranie, którego użytkownik nie widzi. Docker daje kontenerowi
 * nowy port hosta po każdym restarcie, więc adres wysyłamy co turę zamiast
 * zapamiętywać.
 */
/**
 * Kolory botów w hexie — kursor agenta na ekranie komputera ma barwę bota,
 * który właśnie klika, więc przy wspólnym pulpicie widać, czyja to ręka.
 *
 * ponytail: kopia `MAUS_COLORS` z `src/lib/mascot.ts`, bo tamten moduł ciągnie
 * za sobą komponent Reacta i z serwera się go nie zaimportuje. Przed rozjazdem
 * pilnuje test, który czyta oryginał z dysku.
 */
export const CURSOR_COLORS: Record<string, string> = {
  green: "#009957",
  blue: "#377FE6",
  red: "#D94B52",
  orange: "#E78531",
  purple: "#8057C8",
  cyan: "#0EA5C6",
  pink: "#D84F8B",
  yellow: "#D8A729",
  teal: "#01A492",
  coral: "#E5634E",
};

export async function attachExternalBrowser(threadId: string, cdpPort: number, color?: string): Promise<void> {
  // Zakłada bota po stronie silnika, jeśli go jeszcze nie ma — to samo, co robi
  // ścieżka MCP, więc bot slafy (który MCP nie dostaje) też ma gdzie zapisać
  // adres. `own` jest tu bez znaczenia: wyboru trybu już nie ma, liczy się
  // tylko istnienie profilu.
  await configureEngineComputer(threadId, "own");
  const baseUrl = await ensureEngine();
  const botId = engineBotIdFor(threadId);
  const res = await fetch(`${baseUrl}/api/bots/${encodeURIComponent(botId)}/computer/external`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      cdp_url: `http://127.0.0.1:${cdpPort}`,
      ...(color && CURSOR_COLORS[color] ? { cursor_color: CURSOR_COLORS[color] } : {}),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`engine external browser -> HTTP ${res.status}`);
}

/** Kontrakt spawnu serwera MCP komputera dla wątku — bez sprawdzania, czy silnik
 * stoi (to robi `engineComputer`). Wydzielone, żeby dało się je sprawdzić bez sieci. */
export function computerMcpSpawn(threadId: string, engineDir = ENGINE_DIR): McpSpawn {
  return {
    command: venvPython(engineDir),
    args: [
      "-m", "server.computer_mcp",
      "--bot", engineBotIdFor(threadId),
      "--engine-url", engineBaseUrl(),
      // multibot (H3): terminal komputera. Bez tego adresu `computer_exec`
      // odmawia — i to jest właściwe zachowanie, bo jedyną alternatywą byłoby
      // wykonanie polecenia na maszynie użytkownika zamiast w kontenerze.
      "--harness-url", harnessBaseUrl(),
    ],
    env: {
      PYTHONPATH: engineDir,
      // multibot: HOME jawnie, bo serwer MCP nie zawsze startuje w tym samym
      // środowisku, co harness. Na Termuxie `claude`/`codex` to wrappery na
      // `proot-distro login debian`, gdzie HOME=/root — a Python liczy z HOME
      // katalog user-site (`~/.local/lib/pythonX/site-packages`). Bez tego venv
      // silnika traci połowę zależności (`ModuleNotFoundError: idna`), serwer
      // pada przy starcie i CLI melduje `mcp_servers: [{computer, failed}]` —
      // czyli bot cicho zostaje bez komputera.
      ...(process.env.HOME ? { HOME: process.env.HOME } : {}),
      // Trasa `/api/bots/:id/computer/exec` jest za tą samą bramką auth, co
      // reszta harnessu, a serwer MCP jest zwykłym klientem HTTP — dostaje więc
      // token tak samo, jak agents-proxy (env, nie argv: argv widać w `ps`).
      ...(process.env.MULTIBOT_HARNESS_TOKEN ? { MULTIBOT_HARNESS_TOKEN: process.env.MULTIBOT_HARNESS_TOKEN } : {}),
      // Ten sam katalog danych, co reszta silnika — inaczej MCP założyłby bota
      // gdzie indziej niż stoi profil (scripts/dev-engine.mjs, supervisor.ts).
      ...(process.env.SLAFY_DATA_DIR ? { SLAFY_DATA_DIR: process.env.SLAFY_DATA_DIR } : {}),
    },
  };
}

/**
 * Gotowy `integrations.localComputer` albo `null`, gdy komputera nie da się dać:
 * brak venvu silnika (nie ma czym uruchomić MCP) albo silnik nie wstaje. Podnosimy
 * go TUTAJ, bo serwer MCP tego nie potrafi — jest klientem HTTP silnika, nie jego
 * nadzorcą. `null` degraduje turę do bota bez komputera, dokładnie jak brak
 * `cua-connection.json` na ścieżce lokalnego CUA — tura nie może się wywrócić.
 */
export async function engineComputer(
  threadId: string,
  engineDir = ENGINE_DIR,
  mode: EngineComputerMode = "own",
): Promise<McpSpawn | null> {
  const spawn = computerMcpSpawn(threadId, engineDir);
  if (!existsSync(spawn.command)) return null;
  try {
    await configureEngineComputer(threadId, mode);
  } catch {
    return null;
  }
  return spawn;
}
