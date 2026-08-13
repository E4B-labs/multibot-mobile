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
import { engineBotIdFor } from "../drivers/slafy.js";
import { engineBaseUrl, ensureEngine, venvPython } from "./supervisor.js";
/** repo root: server/engine/ → server/ → repo */
const ENGINE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "engine");
/** Kontrakt spawnu serwera MCP komputera dla wątku — bez sprawdzania, czy silnik
 * stoi (to robi `engineComputer`). Wydzielone, żeby dało się je sprawdzić bez sieci. */
export function computerMcpSpawn(threadId, engineDir = ENGINE_DIR) {
    return {
        command: venvPython(engineDir),
        args: ["-m", "server.computer_mcp", "--bot", engineBotIdFor(threadId), "--engine-url", engineBaseUrl()],
        env: {
            PYTHONPATH: engineDir,
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
export async function engineComputer(threadId, engineDir = ENGINE_DIR) {
    const spawn = computerMcpSpawn(threadId, engineDir);
    if (!existsSync(spawn.command))
        return null;
    try {
        await ensureEngine();
    }
    catch {
        return null;
    }
    return spawn;
}
