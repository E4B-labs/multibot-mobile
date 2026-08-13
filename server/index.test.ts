// API smoke test: boots the real harness server (node server/index.ts)
// against a throwaway home directory and exercises the HTTP surface the
// app depends on. A deliberately-unknown overlay pins shadow-instance
// behavior without replacing the built-in fleet.
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(SERVER_DIR, "..");
const PORT = 18800 + Math.floor(Math.random() * 10_000);
const BASE = `http://127.0.0.1:${PORT}`;
const TOKEN = "index-test-access-token";

let child: ChildProcess;
let home: string;
let stderr = "";
let staticDir: string;

const api = async (method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { authorization: `Bearer ${TOKEN}`, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
};

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), "omb-api-test-"));
  staticDir = join(home, "dist");
  mkdirSync(staticDir, { recursive: true });
  writeFileSync(join(staticDir, "index.html"), "<!doctype html><title>Multibot login</title>");
  writeFileSync(join(staticDir, "app.js"), "console.log('login shell')");
  writeFileSync(join(staticDir, "manifest.webmanifest"), JSON.stringify({ name: "Multibot", start_url: "/" }));
  writeFileSync(join(staticDir, "sw.js"), "self.addEventListener('fetch', () => {})");
  mkdirSync(join(staticDir, "assets"));
  writeFileSync(join(staticDir, "assets", "app-abc123.js"), "console.log('fingerprinted')");
  mkdirSync(join(home, ".openmausbot"), { recursive: true });
  writeFileSync(
    join(home, ".openmausbot", "config.json"),
    JSON.stringify({ auth: { token: TOKEN }, instances: { ghost: { driver: "not-a-real-driver", displayName: "Ghost" } } }),
  );
  // Seed a terminal setup job so progress endpoint is covered without
  // launching real provisioning or package installation in this test.
  writeFileSync(
    join(home, ".openmausbot", "setup-jobs.json"),
    JSON.stringify([
      {
        id: "done-job",
        key: "test",
        kind: "provision",
        title: "Install bot server",
        command: "test-only",
        status: "succeeded",
        output: ["browser ready"],
        createdAt: 1,
        finishedAt: 2,
        exitCode: 0,
      },
    ]),
  );

  child = spawn(process.execPath, [join(SERVER_DIR, "index.ts")], {
    cwd: ROOT,
    env: {
      ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
      ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
      HOME: home,
      USERPROFILE: home,
      OMB_PORT: String(PORT),
      OMB_HOST: "0.0.0.0",
      OMB_STATIC_DIR: staticDir,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stderr!.on("data", (c) => (stderr += c));

  const deadline = Date.now() + 20_000;
  for (;;) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) break;
    } catch {
      /* not up yet */
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
  rmSync(home, { recursive: true, force: true });
});

describe("harness HTTP API", () => {
  it("identifies itself on /api/health", async () => {
    const { status, body } = await api("GET", "/api/health");
    expect(status).toBe(200);
    expect(body.app).toBe("openmausbot");
    expect(typeof body.pid).toBe("number");
    expect(body.static).toBe(true);
  });

  it("serves the login shell on the same remote origin but protects every non-static route", async () => {
    const page = await fetch(`${BASE}/`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("Multibot login");
    expect(page.headers.get("cache-control")).toBe("no-cache");
    expect(page.headers.get("x-content-type-options")).toBe("nosniff");
    expect((await fetch(`${BASE}/app.js`)).status).toBe(200);
    expect((await fetch(`${BASE}/api/bots`)).status).toBe(401);
    expect((await fetch(`${BASE}/api/auth/check`)).status).toBe(401);
    expect((await fetch(`${BASE}/webhooks/routine-id`, { method: "POST" })).status).toBe(401);
  });

  it("serves installable PWA files with update-safe MIME and cache headers", async () => {
    const manifest = await fetch(`${BASE}/manifest.webmanifest`);
    expect(manifest.status).toBe(200);
    expect(manifest.headers.get("content-type")).toBe("application/manifest+json");
    expect(manifest.headers.get("cache-control")).toBe("no-cache");

    const worker = await fetch(`${BASE}/sw.js`);
    expect(worker.status).toBe(200);
    expect(worker.headers.get("content-type")).toBe("text/javascript");
    expect(worker.headers.get("cache-control")).toBe("no-cache");
    expect(worker.headers.get("service-worker-allowed")).toBe("/");

    const asset = await fetch(`${BASE}/assets/app-abc123.js`);
    expect(asset.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    const head = await fetch(`${BASE}/manifest.webmanifest`, { method: "HEAD" });
    expect(await head.text()).toBe("");
  });

  it("keeps API data authenticated, JSON, and out of caches", async () => {
    const unauthorized = await fetch(`${BASE}/api/bots`);
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get("cache-control")).toBe("no-store");
    expect(unauthorized.headers.get("content-type")).toBe("application/json");

    const authorized = await fetch(`${BASE}/api/bots`, { headers: { authorization: `Bearer ${TOKEN}` } });
    expect(authorized.status).toBe(200);
    expect(authorized.headers.get("cache-control")).toBe("no-store");
    expect(authorized.headers.get("content-type")).toBe("application/json");
    expect((await authorized.json() as { bots: unknown[] }).bots).toBeDefined();
  });

  it("seeds one starter bot with its greeting", async () => {
    const { status, body } = await api("GET", "/api/bots");
    expect(status).toBe(200);
    expect(body.bots.length).toBeGreaterThanOrEqual(1);
    expect(body.bots[0].messages.length).toBeGreaterThanOrEqual(2);
  });

  it("describes the configured fleet, shadows included", async () => {
    const { status, body } = await api("GET", "/api/instances");
    expect(status).toBe(200);
    expect(body.instances.map((instance: { instanceId: string }) => instance.instanceId)).toEqual(
      expect.arrayContaining(["grok", "gemini", "kimi", "qwen", "claude", "codex", "computer", "ghost"]),
    );
    expect(body.instances.some((instance: { instanceId: string }) => instance.instanceId === "slafy")).toBe(false);
    const ghost = body.instances.find((instance: { instanceId: string }) => instance.instanceId === "ghost");
    expect(ghost).toMatchObject({
      instanceId: "ghost",
      driverKind: "not-a-real-driver",
      displayName: "Ghost",
      snapshot: { state: "unavailable" },
    });
    expect(ghost.snapshot.reason).toContain("not-a-real-driver");
  });

  it("manages custom models without echoing API keys", async () => {
    const bad = await api("PUT", "/api/models/custom/claude", {
      displayName: "Reserved",
      baseUrl: "http://127.0.0.1:11434/v1",
      model: "x",
    });
    expect(bad.status).toBe(409);

    const saved = await api("PUT", "/api/models/custom/local-qwen", {
      displayName: "Local Qwen",
      baseUrl: "http://127.0.0.1:11434/v1/",
      model: "qwen2.5",
      apiKey: "test-secret-value",
    });
    expect(saved.status).toBe(200);
    expect(saved.body.model).toEqual({
      id: "local-qwen",
      displayName: "Local Qwen",
      baseUrl: "http://127.0.0.1:11434/v1",
      model: "qwen2.5",
      hasKey: true,
    });
    expect(JSON.stringify(saved.body)).not.toContain("test-secret-value");

    const listed = await api("GET", "/api/models/custom");
    expect(listed.body.models).toContainEqual(saved.body.model);
    expect(JSON.stringify(listed.body)).not.toContain("test-secret-value");
    const instances = await api("GET", "/api/instances");
    expect(instances.body.instances).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          instanceId: "local-qwen",
          displayName: "Local Qwen",
          models: expect.objectContaining({ default: "qwen2.5" }),
        }),
      ]),
    );

    expect((await api("DELETE", "/api/models/custom/local-qwen")).status).toBe(200);
    expect((await api("GET", "/api/models/custom")).body.models).toEqual([]);
  });

  it("persists command-line tool allow switches", async () => {
    const disabled = await api("PUT", "/api/cli-tools/codex", { enabled: false });
    expect(disabled.status).toBe(200);
    expect(disabled.body.tool).toMatchObject({ id: "codex", enabled: false, detected: false });
    const listed = await api("GET", "/api/cli-tools");
    expect(listed.body.tools.find((tool: { id: string }) => tool.id === "codex")).toMatchObject({
      enabled: false,
      reason: "disabled in settings",
    });
    const instance = (await api("GET", "/api/instances")).body.instances.find(
      (item: { instanceId: string }) => item.instanceId === "codex",
    );
    expect(instance.snapshot).toMatchObject({ state: "unavailable", reason: "disabled in settings" });
    expect((await api("PUT", "/api/cli-tools/codex", { enabled: true })).status).toBe(200);
    expect((await api("PUT", "/api/cli-tools/unknown", { enabled: true })).status).toBe(404);
  });

  it("reports device capabilities for onboarding", async () => {
    const { status, body } = await api("GET", "/api/device");
    expect(status).toBe(200);
    expect(body).toMatchObject({
      platform: process.platform,
      arch: process.arch,
      python: expect.any(Boolean),
      docker: expect.any(Boolean),
      engineInstalled: expect.any(Boolean),
    });
    expect(body.hostname).toBeTruthy();
    expect(body.memoryGb).toBeGreaterThan(0);
    expect(body.ramBytes).toBeGreaterThan(0);
  });

  it("exposes fixed CLI installers without running them", async () => {
    const listed = await api("GET", "/api/cli-tools");
    expect(listed.status).toBe(200);
    expect(listed.body.tools.find((tool: { id: string }) => tool.id === "kimi")).toMatchObject({
      driverKind: "kimiAgent",
      installCommand: "uv tool install --python 3.13 kimi-cli",
    });
    expect(listed.body.tools.find((tool: { id: string }) => tool.id === "qwen")).toMatchObject({
      driverKind: "qwenAgent",
      installCommand: "npm install -g @qwen-code/qwen-code@latest",
    });
    expect((await api("POST", "/api/cli-tools/unknown/install")).status).toBe(404);
    expect((await api("POST", "/api/cli-tools/grok/install")).status).toBe(409);
  });

  it("streams persisted setup progress using the onboarding SSE shape", async () => {
    const response = await fetch(`${BASE}/api/progress/done-job`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(await response.text()).toContain(
      `data: ${JSON.stringify({ id: "done-job", step: "Install bot server", message: "browser ready", done: true })}`,
    );
    expect((await api("GET", "/api/progress/missing-job")).status).toBe(404);
  });

  it("creates, patches, and deletes a bot", async () => {
    const created = await api("POST", "/api/bots");
    expect(created.status).toBe(201);
    const bot = created.body.bot;

    const patched = await api("PATCH", `/api/bots/${bot.id}`, { name: "Renamed", pinned: true });
    expect(patched.status).toBe(200);
    expect(patched.body.bot).toMatchObject({ name: "Renamed", pinned: true });

    const missing = await api("PATCH", "/api/bots/does-not-exist", { name: "x" });
    expect(missing.status).toBe(404);

    const deleted = await api("DELETE", `/api/bots/${bot.id}`);
    expect(deleted.status).toBe(200);
    const after = await api("GET", "/api/bots");
    expect(after.body.bots.find((b: { id: string }) => b.id === bot.id)).toBeUndefined();
  });

  it("persists an answered onboarding card", async () => {
    const { body } = await api("GET", "/api/bots");
    const bot = body.bots[0];
    const card = bot.messages.find((m: { kind: string }) => m.kind === "options");
    const res = await api("PATCH", `/api/bots/${bot.id}/cards/${card.id}`, { answered: card.card.options[0] });
    expect(res.status).toBe(200);
    expect(res.body.message.card.answered).toBe(card.card.options[0]);
  });

  it("rejects an empty message and explains an unavailable provider", async () => {
    const { body } = await api("GET", "/api/bots");
    const bot = body.bots[0];
    await api("PATCH", `/api/bots/${bot.id}`, {
      modelSelection: { instanceId: "ghost", model: "" },
    });

    const empty = await api("POST", `/api/bots/${bot.id}/messages`, { text: "   " });
    expect(empty.status).toBe(400);

    // A bot explicitly bound to the ghost instance must fail loudly, not
    // 202-and-hang.
    const send = await api("POST", `/api/bots/${bot.id}/messages`, { text: "hello?" });
    expect(send.status).toBe(409);
    expect(send.body.error).toContain("unavailable");
  });

  it("saves config keys write-only and reports booleans", async () => {
    const before = await api("GET", "/api/config");
    expect(before.body.box).toEqual({ configured: false });

    const put = await api("PUT", "/api/config", { box: { token: "tok_secret_value" } });
    expect(put.status).toBe(200);
    expect(put.body.box).toEqual({ configured: true });
    expect(JSON.stringify(put.body)).not.toContain("tok_secret_value");

    const after = await api("GET", "/api/config");
    expect(after.body.box).toEqual({ configured: true });
    expect(JSON.stringify(after.body)).not.toContain("tok_secret_value");

    const nothing = await api("PUT", "/api/config", {});
    expect(nothing.status).toBe(400);
  });

  it("stores and echoes the user profile (not write-only, unlike keys)", async () => {
    const put = await api("PUT", "/api/config", { profile: { name: "Ada Lovelace", email: "Ada@Example.com" } });
    expect(put.status).toBe(200);
    expect(put.body.profile).toEqual({ name: "Ada Lovelace", email: "Ada@Example.com" });

    const after = await api("GET", "/api/config");
    expect(after.body.profile).toEqual({ name: "Ada Lovelace", email: "Ada@Example.com" });
  });

  // multibot (F7): własne serwery MCP użytkownika — osobna trasa `/custom/`,
  // wspólny katalog z Composio (karta niesie `source`).
  it("registers a custom MCP connector and tags it in the integrations catalog", async () => {
    const bad = await api("PUT", "/api/connectors/custom/echo", { transport: { type: "stdio" } });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toContain("command required");

    const saved = await api("PUT", "/api/connectors/custom/echo", {
      name: "Echo",
      transport: { type: "stdio", command: "node", args: ["echo.mjs"], env: { TOKEN: "sekret" } },
    });
    expect(saved.status).toBe(200);
    expect(saved.body.connector).toMatchObject({ id: "echo", name: "Echo" });

    const catalog = await api("GET", "/api/connectors/catalog");
    expect(catalog.status).toBe(200);
    const custom = catalog.body.cards.filter((c: { source: string }) => c.source === "custom");
    expect(custom).toEqual([
      { slug: "echo", label: "Echo", blurb: "stdio: node echo.mjs", logo: null, domain: null, source: "custom" },
    ]);
    // Composio zostaje primary: jego karty są w tym samym katalogu, otagowane.
    expect(catalog.body.cards.filter((c: { source: string }) => c.source === "composio").length).toBeGreaterThan(0);
    // sekret konektora nie wychodzi katalogiem
    expect(JSON.stringify(catalog.body)).not.toContain("sekret");

    const gone = await api("DELETE", "/api/connectors/custom/echo");
    expect(gone.status).toBe(200);
    const after = await api("GET", "/api/connectors/catalog");
    expect(after.body.cards.some((c: { source: string }) => c.source === "custom")).toBe(false);
  });

  it("404s unknown routes with the route in the error", async () => {
    const res = await api("GET", "/api/definitely-not-a-route");
    expect(res.status).toBe(404);
    expect(res.body.error).toContain("/api/definitely-not-a-route");
  });

  it("reveals and rotates the token only to an authenticated session", async () => {
    const reveal = await api("GET", "/api/auth/token");
    expect(reveal.body).toEqual({ token: TOKEN });
    const events = await fetch(`${BASE}/api/events`, { headers: { authorization: `Bearer ${TOKEN}` } });
    const reader = events.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain('"kind":"hello"');
    const closed = reader.read().then(({ done }) => done).catch(() => true);
    const rotated = await api("POST", "/api/auth/token/rotate");
    expect(rotated.status).toBe(200);
    expect(rotated.body.token).toMatch(/^[a-f0-9]{64}$/);
    expect(rotated.body.token).not.toBe(TOKEN);
    expect(await Promise.race([closed, new Promise<false>((resolve) => setTimeout(() => resolve(false), 2_000))])).toBe(true);
    expect((await fetch(`${BASE}/api/bots`, { headers: { authorization: `Bearer ${TOKEN}` } })).status).toBe(401);
    expect(
      (await fetch(`${BASE}/api/bots`, { headers: { authorization: `Bearer ${rotated.body.token}` } })).status,
    ).toBe(200);
  });
});
