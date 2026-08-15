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
        installStrategy: "claude-native",
        // Official non-TTY flow: prints OAuth URL and accepts pasted callback code
        // on stdin. `/login` belongs to the interactive REPL and is unavailable
        // when the harness owns stdin through HTTP.
        loginCommand: "claude auth login",
        login: { command: "claude", args: ["auth", "login"] },
        install: { command: "npm", args: ["install", "-g", "@anthropic-ai/claude-code@latest"] },
    },
    {
        id: "codex",
        driverKind: "codex",
        displayName: "Codex",
        installStrategy: "codex-native",
        // Official non-TTY OAuth: output carries URL + one-time code, then CLI
        // polls until browser authorization completes. No token crosses harness.
        loginCommand: "codex login --device-auth",
        login: { command: "codex", args: ["login", "--device-auth"] },
        loginMode: "device",
        install: { command: "npm", args: ["install", "-g", "@openai/codex@latest"] },
    },
    {
        id: "kimi",
        driverKind: "kimiAgent",
        displayName: "Kimi",
        loginCommand: "kimi",
        login: { command: "kimi", args: [] },
        install: { command: "uv", args: ["tool", "install", "--python", "3.13", "kimi-cli"] },
    },
    {
        id: "qwen",
        driverKind: "qwenAgent",
        displayName: "Qwen",
        loginCommand: "qwen",
        login: { command: "qwen", args: [] },
        install: { command: "npm", args: ["install", "-g", "@qwen-code/qwen-code@latest"] },
    },
];
export const installCommandText = (install) => install ? [install.command, ...install.args].join(" ") : null;
