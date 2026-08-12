// Built-in driver registration — upstream builtInDrivers.ts: a static
// array, nothing more. Adding a driver = write drivers/<x>.ts, append.
import type { AnyProviderDriver } from "../contracts.ts";
import { BoxAgentDriver } from "./boxagent.ts";
import { ClaudeDriver } from "./claude.ts";
import { CodexDriver } from "./codex.ts";
import { GrokDriver } from "./grok.ts";
import { GrokAgentDriver } from "./acp/grok.ts";
import { GeminiAgentDriver } from "./acp/gemini.ts";
// multibot: driver silnika slafy (sidecar Pythona) — patrz drivers/slafy.ts
import { SlafyDriver } from "./slafy.ts";

export const BUILT_IN_DRIVERS: readonly AnyProviderDriver[] = [
  SlafyDriver, // multibot
  GrokDriver,
  GrokAgentDriver,
  GeminiAgentDriver,
  ClaudeDriver,
  CodexDriver,
  BoxAgentDriver,
];
