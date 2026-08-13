// multibot: F5 — komputer "playwright" po stronie harnessu. Kontrakt spawnu
// sprawdzamy jednostkowo, a to, ŻE trafia do agenta, na żywym harnessie z fake
// CLI claude'a (jak server/index.test.ts): branch siedzi w `startTurn`
// w index.ts, więc żaden fake driver by go nie ruszył.
import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startFakeEngine, type FakeEngine } from "../testing/fake-engine.ts";
import { computerMcpSpawn, engineComputer } from "./computer-mcp.ts";
import { venvPython } from "./supervisor.ts";

const SERVER_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = join(SERVER_DIR, "..");
const ENGINE_DIR = join(ROOT, "engine");
const FAKE_CLI = join(SERVER_DIR, "testing", "fake-claude-cli.ts");

describe("computerMcpSpawn", () => {
  it("runs the engine's own python on the engine package, per thread", () => {
    process.env.ENGINE_URL = "http://127.0.0.1:9999/";
    const spawnCfg = computerMcpSpawn("t-42");
    expect(spawnCfg.command).toBe(venvPython(ENGINE_DIR));
    expect(spawnCfg.args).toEqual([
      "-m",
      "server.computer_mcp",
      "--bot",
      "mb-t-42", // ten sam mapping wątek→bot silnika co driver slafy
      "--engine-url",
      "http://127.0.0.1:9999", // bez końcowego ukośnika
    ]);
    // `localComputer` nie ma `cwd` (contracts.ts zostaje bez zmian), więc
    // importowalność pakietu `server.*` musi załatwić PYTHONPATH
    expect(spawnCfg.env.PYTHONPATH).toBe(ENGINE_DIR);
    delete process.env.ENGINE_URL;
  });

  it("gives no computer when the engine venv is missing", async () => {
    expect(await engineComputer("t-1", join(tmpdir(), "nie-ma-takiego-silnika"))).toBeNull();
  });

  it("gives no computer when the engine will not come up", async () => {
    process.env.ENGINE_URL = "http://127.0.0.1:1"; // martwy port = ensureEngine rzuca
    try {
      expect(await engineComputer("t-1")).toBeNull();
    } finally {
      delete process.env.ENGINE_URL;
    }
  });
});

describe("computer: playwright on a claude-style driver (live harness)", () => {
  const hasVenv = existsSync(venvPython(ENGINE_DIR));
  const PORT = 18800 + Math.floor(Math.random() * 10_000);
  const BASE = `http://127.0.0.1:${PORT}`;
  let child: ChildProcess;
  let engine: FakeEngine;
  let home: string;
  let dump: string;
  let stderr = "";

  const api = async (method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> => {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };

  beforeAll(async () => {
    if (!hasVenv) return;
    chmodSync(FAKE_CLI, 0o755);
    engine = await startFakeEngine();
    home = mkdtempSync(join(tmpdir(), "omb-f5-test-"));
    dump = join(home, "claude-dump.json");
    mkdirSync(join(home, ".openmausbot"), { recursive: true });
    writeFileSync(
      join(home, ".openmausbot", "config.json"),
      JSON.stringify({
        instances: {
          claude: { driver: "claudeAgent", config: { cli: FAKE_CLI, permissionMode: "acceptEdits" } },
        },
      }),
    );

    child = spawn(process.execPath, [join(SERVER_DIR, "index.ts")], {
      cwd: ROOT,
      env: {
        ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
        ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
        HOME: home,
        USERPROFILE: home,
        OMB_PORT: String(PORT),
        ENGINE_URL: engine.url, // silnik "stoi" = zero spawnu Pythona w teście
        // driver claude'a spawnuje CLI ze SWOIM env (nie z `environment` instancji),
        // więc zrzut argv zamawiamy w środowisku harnessu
        FAKE_CLAUDE_DUMP: dump,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stderr!.on("data", (c) => (stderr += c));

    const deadline = Date.now() + 20_000;
    for (;;) {
      try {
        if ((await fetch(`${BASE}/api/health`)).ok) break;
      } catch {
        /* jeszcze nie wstał */
      }
      if (Date.now() > deadline) throw new Error(`server never came up. stderr:\n${stderr}`);
      if (child.exitCode !== null) throw new Error(`server exited ${child.exitCode}. stderr:\n${stderr}`);
      await new Promise((r) => setTimeout(r, 150));
    }
  }, 30_000);

  afterAll(async () => {
    child?.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      if (!child || child.exitCode !== null) return resolve();
      child.on("close", () => resolve());
      setTimeout(() => (child.kill("SIGKILL"), resolve()), 5_000).unref?.();
    });
    await engine?.close();
    if (home) rmSync(home, { recursive: true, force: true });
  });

  it.skipIf(!hasVenv)("mounts the engine computer as the agent's MCP computer", async () => {
    const bot = (await api("POST", "/api/bots")).body.bot;
    expect((await api("PATCH", `/api/bots/${bot.id}`, { computer: "playwright" })).body.bot.computer).toBe(
      "playwright",
    );

    const sent = await api("POST", `/api/bots/${bot.id}/messages`, { text: "zrób zrzut" });
    expect(sent, JSON.stringify(sent.body)).toMatchObject({ status: 202 });
    const deadline = Date.now() + 20_000;
    while (!existsSync(dump)) {
      if (Date.now() > deadline) throw new Error(`fake claude never ran. stderr:\n${stderr}`);
      await new Promise((r) => setTimeout(r, 100));
    }
    const seen = JSON.parse(readFileSync(dump, "utf8"));
    const mcp = JSON.parse(seen.argv[seen.argv.indexOf("--mcp-config") + 1]).mcpServers.computer;
    expect(mcp.command).toBe(venvPython(ENGINE_DIR));
    expect(mcp.args).toEqual([
      "-m",
      "server.computer_mcp",
      "--bot",
      `mb-${bot.threadId}`,
      "--engine-url",
      engine.url,
    ]);
    expect(mcp.env.PYTHONPATH).toBe(ENGINE_DIR);
    // ani box, ani CUA — wybór "playwright" wyklucza oba komputery upstreamu
    expect(mcp.args.join(" ")).not.toContain("cua");
    expect(mcp.env.OGB_BOX_ID).toBeUndefined();
    // i agent dostaje opis SWOJEJ przeglądarki, nie pulpitu użytkownika
    expect(seen.argv[seen.argv.indexOf("--append-system-prompt") + 1]).toContain("your own browser");
  }, 45_000);
});
