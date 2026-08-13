import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { ensureAccessToken, rotateAccessToken, tokenMatches } from "./auth.ts";
import { DATA_DIR, type AppConfig } from "./config.ts";

describe("access tokens", () => {
  beforeEach(() => rmSync(DATA_DIR, { recursive: true, force: true }));

  it("generates once, persists, and compares without length constraints", () => {
    const cfg: AppConfig = {};
    const first = ensureAccessToken(cfg);
    expect(first).toMatchObject({ created: true });
    expect(first.token).toMatch(/^[a-f0-9]{64}$/);
    expect(ensureAccessToken(cfg)).toEqual({ token: first.token, created: false });
    expect(JSON.parse(readFileSync(join(DATA_DIR, "config.json"), "utf8")).auth.token).toBe(first.token);
    expect(tokenMatches(first.token, first.token)).toBe(true);
    expect(tokenMatches("short", first.token)).toBe(false);
  });

  it("rotation replaces the durable token", () => {
    const cfg: AppConfig = { auth: { token: "old-token" } };
    const next = rotateAccessToken(cfg);
    expect(next).not.toBe("old-token");
    expect(cfg.auth?.token).toBe(next);
    expect(JSON.parse(readFileSync(join(DATA_DIR, "config.json"), "utf8")).auth.token).toBe(next);
  });
});
