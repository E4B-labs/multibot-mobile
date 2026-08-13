import { describe, expect, it } from "vitest";

import { instanceConfigs, type AppConfig } from "./config.ts";

describe("instanceConfigs", () => {
  it("overlays configured instances on the built-in fleet without a default slafy entry", () => {
    const cfg: AppConfig = {
      instances: {
        codex: { driver: "codex", enabled: false },
        local: {
          driver: "slafy",
          displayName: "Local Qwen",
          environment: { OPENAI_API_KEY: "local-key" },
          model: { default: "qwen2.5", baseUrl: "http://127.0.0.1:11434/v1" },
        },
      },
    };

    const fleet = instanceConfigs(cfg);
    expect(Object.keys(fleet)).toEqual(expect.arrayContaining(["grok", "gemini", "claude", "codex", "computer", "local"]));
    expect(fleet.slafy).toBeUndefined();
    expect(fleet.codex.enabled).toBe(false);
    expect(fleet.local).toMatchObject({
      driver: "slafy",
      displayName: "Local Qwen",
      environment: { OPENAI_API_KEY: "local-key" },
      config: { model: { default: "qwen2.5", baseUrl: "http://127.0.0.1:11434/v1" } },
    });
    // Rendering the fleet must not mutate durable config objects.
    expect(cfg.instances?.local.config).toBeUndefined();
  });
});
