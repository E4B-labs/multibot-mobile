// Qwen Code official stable ACP stdio entrypoint: `qwen --acp`.
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createAcpDriver } from "./core.js";
export const qwenAcpArgs = (model) => ["--acp", ...(model ? ["--model", model] : [])];
const support = {
    driverKind: "qwenAgent",
    displayName: "Qwen",
    models: { default: "qwen3-coder-plus", options: [{ id: "qwen3-coder-plus", label: "Qwen3 Coder Plus" }] },
    defaultCli: "qwen",
    nativeSource: "qwen.acp",
    loginNote: "Qwen is not signed in — run `qwen` once to log in",
    spawnArgs: (_config, turn) => qwenAcpArgs(turn.model),
    pickAuthMethod: (methods) => methods.find((method) => typeof method.id === "string")?.id ?? null,
    authFailure: "continue",
    isAuthenticated: (env) => Boolean(env.QWEN_API_KEY || env.DASHSCOPE_API_KEY || env.OPENAI_API_KEY) ||
        existsSync(join(homedir(), ".qwen", "oauth_creds.json")),
    buildPromptText: (turn) => (turn.system ? `${turn.system}\n\n${turn.text}` : turn.text),
};
export const QwenAgentDriver = createAcpDriver(support);
