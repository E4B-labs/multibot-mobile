import { BoxAgentDriver } from "./boxagent.js";
import { ClaudeDriver } from "./claude.js";
import { CodexDriver } from "./codex.js";
import { GrokDriver } from "./grok.js";
import { GrokAgentDriver } from "./acp/grok.js";
import { GeminiAgentDriver } from "./acp/gemini.js";
// multibot: driver silnika slafy (sidecar Pythona) — patrz drivers/slafy.ts
import { SlafyDriver } from "./slafy.js";
export const BUILT_IN_DRIVERS = [
    SlafyDriver, // multibot
    GrokDriver,
    GrokAgentDriver,
    GeminiAgentDriver,
    ClaudeDriver,
    CodexDriver,
    BoxAgentDriver,
];
