// Kimi Code official ACP stdio entrypoint: `kimi acp`.
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createAcpDriver } from "./core.js";
export const kimiAcpArgs = () => ["acp"];
const support = {
    driverKind: "kimiAgent",
    displayName: "Kimi",
    models: { default: "kimi-for-coding", options: [{ id: "kimi-for-coding", label: "Kimi for Coding" }] },
    defaultCli: "kimi",
    nativeSource: "kimi.acp",
    loginNote: "Kimi is not signed in — run `kimi` once to log in",
    spawnArgs: () => kimiAcpArgs(),
    pickAuthMethod: (methods) => methods.find((method) => typeof method.id === "string")?.id ?? null,
    authFailure: "continue",
    isAuthenticated: (env) => Boolean(env.KIMI_API_KEY || env.MOONSHOT_API_KEY) || existsSync(join(homedir(), ".kimi", "config.toml")),
    buildPromptText: (turn) => (turn.system ? `${turn.system}\n\n${turn.text}` : turn.text),
};
export const KimiAgentDriver = createAcpDriver(support);
