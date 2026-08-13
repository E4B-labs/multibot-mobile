export const CLI_TOOLS = [
    {
        id: "grok",
        driverKind: "grokAgent",
        displayName: "Grok",
        // Grok Build distribution changes independently; detection stays, but no
        // guessed package command is executed.
    },
    {
        id: "gemini",
        driverKind: "geminiAgent",
        displayName: "Gemini",
        loginCommand: "gemini",
        login: { command: "gemini", args: [] },
        install: { command: "npm", args: ["install", "-g", "@google/gemini-cli@latest"] },
    },
    {
        id: "claude",
        driverKind: "claudeAgent",
        displayName: "Claude Code",
        loginCommand: "claude",
        login: { command: "claude", args: [] },
        install: { command: "npm", args: ["install", "-g", "@anthropic-ai/claude-code@latest"] },
    },
    {
        id: "codex",
        driverKind: "codex",
        displayName: "Codex",
        loginCommand: "codex --login",
        login: { command: "codex", args: ["--login"] },
        install: { command: "npm", args: ["install", "-g", "@openai/codex@latest"] },
    },
    {
        id: "kimi",
        driverKind: "kimiAgent",
        displayName: "Kimi Code",
        loginCommand: "kimi",
        login: { command: "kimi", args: [] },
        install: { command: "uv", args: ["tool", "install", "--python", "3.13", "kimi-cli"] },
    },
    {
        id: "qwen",
        driverKind: "qwenAgent",
        displayName: "Qwen Code",
        loginCommand: "qwen",
        login: { command: "qwen", args: [] },
        install: { command: "npm", args: ["install", "-g", "@qwen-code/qwen-code@latest"] },
    },
];
export const installCommandText = (install) => install ? [install.command, ...install.args].join(" ") : null;
