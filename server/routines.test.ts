import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HarnessRoutines, nextRun } from "./routines.ts";

const roots: string[] = [];
const file = () => {
  const root = mkdtempSync(join(tmpdir(), "omb-routines-"));
  roots.push(root);
  return join(root, "routines.json");
};

afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

describe("driver-neutral routines", () => {
  it("parses UI interval and cron schedules", () => {
    expect(nextRun("every 30m", 1_000)).toBe(1_801_000);
    const next = new Date(nextRun("15 9 * * 1", new Date(2026, 7, 13, 10).getTime())!);
    expect([next.getDay(), next.getHours(), next.getMinutes()]).toEqual([1, 9, 15]);
    expect(() => nextRun("61 * * * *", Date.now())).toThrow(/outside/);
  });

  it("dispatches due and manual jobs through injected harness turn", async () => {
    let now = 1_000;
    const dispatch = vi.fn(async () => {});
    const routines = new HarnessRoutines(file(), dispatch, () => now, 0);
    routines.create("bot-cli", { name: "Digest", prompt: "summarize", schedule: "every 1m" });

    now = 61_000;
    await routines.tick();
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ botId: "bot-cli", prompt: "summarize" }));
    expect(routines.list("bot-cli")[0].last_runs[0].status).toBe("queued");

    const manual = routines.create("bot-custom", { name: "Check", prompt: "check now" });
    await routines.runNow("bot-custom", manual.id);
    expect(dispatch).toHaveBeenLastCalledWith(expect.objectContaining({ botId: "bot-custom", prompt: "check now" }));
  });

  it("persists jobs and records unavailable or busy driver failures", async () => {
    const path = file();
    const routines = new HarnessRoutines(path, async () => { throw new Error("bot is already working"); }, () => 1_000, 0);
    const job = routines.create("bot-codex", { name: "Work", prompt: "go" });
    await routines.runNow("bot-codex", job.id);
    expect(routines.list("bot-codex")[0].last_runs[0]).toMatchObject({ status: "error", error: "bot is already working" });

    const restored = new HarnessRoutines(path, async () => {}, () => 2_000, 0);
    expect(restored.list("bot-codex")).toHaveLength(1);
    expect(JSON.parse(readFileSync(path, "utf8"))[0].prompt).toBe("go");
  });
});
