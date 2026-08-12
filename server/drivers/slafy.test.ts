// multibot: kontraktowe testy drivera slafy na fake'owym silniku HTTP
// (server/testing/fake-engine.ts). Pozostałe drivery testują się na fake CLI —
// slafy jest driverem HTTP, więc fake'iem jest serwer.
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ProviderInstance } from "../contracts.ts";
import { ensureEngine } from "../engine/supervisor.ts";
import { startFakeEngine, type FakeEngine, type FakeEngineMode } from "../testing/fake-engine.ts";
import { recordEvents, type EventRecorder } from "../testing/events.ts";
import { SlafyDriver } from "./slafy.ts";

describe("SlafyDriver.decodeConfig", () => {
  it("defaults the engine bot-id prefix", () => {
    expect(SlafyDriver.decodeConfig({})).toEqual({ botPrefix: "mb-" });
    expect(SlafyDriver.decodeConfig(undefined)).toEqual({ botPrefix: "mb-" });
    expect(SlafyDriver.decodeConfig({ botPrefix: "x-" }).botPrefix).toBe("x-");
  });
});

describe("SlafyDriver turns (fake engine)", () => {
  let engine: FakeEngine;
  let instance: ProviderInstance;
  let recorder: EventRecorder;

  const create = async (mode: FakeEngineMode = "happy") => {
    engine = await startFakeEngine(mode);
    // ENGINE_URL = silnik zewnętrzny: supervisor tylko sonduje /health, zero spawnu.
    process.env.ENGINE_URL = engine.url;
    instance = await SlafyDriver.create({
      instanceId: "slafy-test",
      displayName: "Slafy Test",
      environment: {},
      enabled: true,
      config: SlafyDriver.defaultConfig(),
    });
    recorder = recordEvents(instance.adapter);
  };

  beforeEach(() => {
    delete process.env.ENGINE_URL;
  });

  afterEach(async () => {
    delete process.env.ENGINE_URL;
    recorder?.stop();
    await instance?.dispose();
    await engine?.close();
  });

  it("normalizes a full streamed turn into canonical events", async () => {
    await create();
    await instance.adapter.sendTurn({ threadId: "t-happy", text: "czesc" });
    await recorder.until((e) => e.type === "turn.completed");

    expect(recorder.events.map((e) => e.type)).toEqual([
      "turn.started",
      "session.started",
      "item.started", // working → pierwsze wystąpienie toolCallId
      "content.delta",
      "content.delta",
      "content.delta",
      "thread.token-usage.updated",
      "item.completed", // assistant_text z eventu `done`
      "turn.completed",
    ]);

    const deltas = recorder.events.filter((e) => e.type === "content.delta");
    expect(deltas.map((e: any) => e.delta).join("")).toBe("Hello, world");
    expect(recorder.events.find((e) => e.type === "thread.token-usage.updated")).toMatchObject({
      input: 11,
      output: 7,
    });
    expect(recorder.events.find((e) => e.type === "item.completed")).toMatchObject({
      itemType: "assistant_text",
      text: "Hello, world",
    });
    expect(recorder.events.at(-1)).toMatchObject({ type: "turn.completed", ok: true });
  });

  it("creates the engine bot once per thread and sends only the new turn", async () => {
    await create();
    await instance.adapter.sendTurn({
      threadId: "t-one",
      text: "pierwsza",
      // D4: transkrypt MUSI zostać zignorowany — silnik jest stanowy.
      transcript: [
        { role: "user", text: "stara tura" },
        { role: "assistant", text: "stara odpowiedz" },
      ],
    });
    await recorder.until((e) => e.type === "turn.completed");
    await instance.adapter.sendTurn({ threadId: "t-one", text: "druga" });
    await recorder.until((e) => e.type === "turn.completed" && recorder.events.filter((x) => x.type === "turn.completed").length === 2);

    expect(engine.createdBots).toEqual(["mb-t-one"]); // drugi raz już nie zakłada
    expect(engine.chats.map((c) => c.message)).toEqual(["pierwsza", "druga"]);
    expect(JSON.stringify(engine.chats)).not.toContain("stara tura");
  });

  it("turns a mid-turn engine kill into a clean runtime.error", async () => {
    await create("kill");
    await instance.adapter.sendTurn({ threadId: "t-kill", text: "czesc" });
    const completed = await recorder.until((e) => e.type === "turn.completed");

    const error = recorder.events.find((e) => e.type === "runtime.error");
    expect(error).toBeDefined();
    expect((error as any).message).toMatch(/stream ended|fetch failed|terminated|socket/i);
    expect(completed).toMatchObject({ ok: false, stopReason: "error" });
    // deltas sprzed zerwania nie giną — user widzi, co zdążyło przyjść
    expect(recorder.events.filter((e) => e.type === "content.delta")).toHaveLength(2);
    expect(instance.adapter.hasSession("t-kill")).toBe(false);
  });

  it("surfaces an engine-reported error event as runtime.error", async () => {
    await create("error");
    await instance.adapter.sendTurn({ threadId: "t-err", text: "czesc" });
    const completed = await recorder.until((e) => e.type === "turn.completed");

    expect(recorder.events.find((e) => e.type === "runtime.error")).toMatchObject({
      message: "engine blew up",
    });
    expect(completed).toMatchObject({ ok: false });
  });

  it("builds the model catalog per instance without touching describe()", async () => {
    await create();
    expect(instance.models).toEqual({
      default: "hermes-agent",
      options: [{ id: "hermes-agent", label: "Hermes Agent (BYOK)" }],
    });
    // per instancja = nie ta sama referencja co katalog drivera (D5)
    expect(instance.models).not.toBe(SlafyDriver.models);
    expect(instance.models).toEqual(SlafyDriver.models);
  });

  it("reports available when the engine answers and unavailable when it does not", async () => {
    await create();
    expect(await instance.snapshot()).toMatchObject({ state: "available" });

    await engine.close();
    const dead = await instance.snapshot();
    expect(dead.state).toBe("unavailable");
    expect(dead.reason).toContain(engine.url);
  });
});

describe("ensureEngine with ENGINE_URL", () => {
  let engine: FakeEngine;

  afterEach(async () => {
    delete process.env.ENGINE_URL;
    await engine?.close();
  });

  it("uses the external engine and never spawns", async () => {
    engine = await startFakeEngine();
    process.env.ENGINE_URL = engine.url;
    expect(await ensureEngine()).toBe(engine.url);
  });

  it("rejects instead of spawning when ENGINE_URL is dead", async () => {
    engine = await startFakeEngine();
    const url = engine.url;
    await engine.close();
    process.env.ENGINE_URL = url;
    await expect(ensureEngine()).rejects.toThrow(/no engine at ENGINE_URL/);
  });
});
