import { ClaudeDriver } from "./claude.js";
import { CodexDriver } from "./codex.js";
import { GrokDriver } from "./grok.js";
import { GrokAgentDriver } from "./acp/grok.js";
import { GeminiAgentDriver } from "./acp/gemini.js";
// multibot (G3): official ACP stdio integrations.
import { KimiAgentDriver } from "./acp/kimi.js";
import { QwenAgentDriver } from "./acp/qwen.js";
// multibot: driver silnika slafy (sidecar Pythona) — patrz drivers/slafy.ts
import { SlafyDriver } from "./slafy.js";
// multibot (A5): BoxAgentDriver (box.ascii.dev, "on the box") celowo NIE jest
// rejestrowany — MultiBot ma swój komputer (wspólny pulpit na hoście, montowany
// przez integrations.localComputer), a opcja box w model pickerze tylko myliła:
// "Computer / no Box token". Driver zostaje w drzewie (upstream), ale nie
// wystaje w UI. Pliki box.ts / computer-proxy.ts są inertne bez box.token.
export const BUILT_IN_DRIVERS = [
    SlafyDriver, // multibot
    GrokDriver,
    GrokAgentDriver,
    GeminiAgentDriver,
    KimiAgentDriver, // multibot (G3)
    QwenAgentDriver, // multibot (G3)
    ClaudeDriver,
    CodexDriver,
];
