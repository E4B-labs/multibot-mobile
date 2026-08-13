// Agent-to-agent comms MCP proxy — spawned as an MCP server inside a bot's
// agent process (via the "agents" integration). Exposes two tools that let
// one bot talk to another, routed back through the harness so the harness
// stays the single owner of turns, permissions, and recursion limits:
//
//   list_bots()            → the other bots in this workspace + their status
//   ask_bot(bot_id, msg)   → send msg to that bot, wait, return its reply
//
// Speaks raw JSON-RPC 2.0 over stdio (no MCP SDK — house style, matches
// computer-proxy / permission-proxy). All state comes from env, injected by
// the harness when it builds the integration:
//   OMB_HARNESS_URL  base URL of the harness (http://127.0.0.1:8799)
//   OMB_BOT_ID       the calling bot's id (excluded from list_bots; sender)
//   OMB_COMMS_TOKEN  shared secret for the localhost-only internal endpoints
//   OMB_TURN_DEPTH   this turn's comms depth (the harness refuses recursion)
import readline from "node:readline";
const HARNESS = process.env.OMB_HARNESS_URL ?? "http://127.0.0.1:8799";
const BOT_ID = process.env.OMB_BOT_ID ?? "";
const TOKEN = process.env.OMB_COMMS_TOKEN ?? "";
const DEPTH = Number(process.env.OMB_TURN_DEPTH ?? "0") || 0;
const TOOLS = [
    {
        name: "list_bots",
        description: "List the other bots (agents) in this OpenMausBot workspace you can message, with what each one does, its model and whether it's busy. Call this before ask_bot to discover who's available and pick the bot whose description matches the task.",
        inputSchema: { type: "object", properties: {} },
    },
    {
        name: "ask_bot",
        description: "Send a message to another bot in this workspace and wait for its reply. Use it to delegate a subtask to a specialist bot or ask a peer a question. The other bot runs a full turn under its own model and permissions; the reply is returned to you as text. Returns promptly with a note if that bot is busy.",
        inputSchema: {
            type: "object",
            properties: {
                bot_id: { type: "string", description: "The target bot's id (from list_bots)." },
                message: { type: "string", description: "What to say / ask the bot." },
            },
            required: ["bot_id", "message"],
        },
    },
    { name: "get_my_profile", description: "Read your complete bot profile.", inputSchema: { type: "object", properties: {} } },
    { name: "update_my_profile", description: "Update your name, role, description, icon, notifications, computer or model selection.", inputSchema: { type: "object", properties: { name: { type: "string" }, title: { type: "string" }, description: { type: "string" }, computer: { type: "string" }, color: { type: "string" }, mascotShape: { type: "string" }, notifications: { type: "boolean" }, modelSelection: { type: "object" } } } },
    { name: "remember", description: "Save a durable fact to your memory.", inputSchema: { type: "object", properties: { text: { type: "string" }, source: { type: "string" } }, required: ["text"] } },
    { name: "recall", description: "Search your durable memory.", inputSchema: { type: "object", properties: { query: { type: "string" } } } },
    { name: "read_memory", description: "Read your Graph Memory and markdown memory.", inputSchema: { type: "object", properties: {} } },
    { name: "create_skill", description: "Create a reusable skill for yourself.", inputSchema: { type: "object", properties: { name: { type: "string" }, description: { type: "string" }, instructions: { type: "string" } }, required: ["name", "instructions"] } },
    { name: "list_skills", description: "List your skills.", inputSchema: { type: "object", properties: {} } },
    { name: "create_routine", description: "Create a durable scheduled routine for yourself.", inputSchema: { type: "object", properties: { name: { type: "string" }, prompt: { type: "string" }, schedule: { type: "string" } }, required: ["name", "prompt"] } },
    { name: "list_routines", description: "List your routines.", inputSchema: { type: "object", properties: {} } },
    { name: "run_routine", description: "Run one of your routines now.", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
    { name: "create_agent", description: "Create another bot in this workspace.", inputSchema: { type: "object", properties: { name: { type: "string" }, title: { type: "string" }, description: { type: "string" } }, required: ["name"] } },
    { name: "update_agent", description: "Update another bot using its id.", inputSchema: { type: "object", properties: { botId: { type: "string" }, patch: { type: "object" } }, required: ["botId", "patch"] } },
    { name: "list_groups", description: "List bot groups.", inputSchema: { type: "object", properties: {} } },
    { name: "create_group", description: "Create a group conversation from bot ids.", inputSchema: { type: "object", properties: { name: { type: "string" }, bot_ids: { type: "array", items: { type: "string" } } }, required: ["name", "bot_ids"] } },
    { name: "send_group_message", description: "Send a message to a group conversation.", inputSchema: { type: "object", properties: { groupId: { type: "string" }, message: { type: "string" } }, required: ["groupId", "message"] } },
    { name: "read_file", description: "Read a UTF-8 file on the host.", inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
    { name: "write_file", description: "Write a UTF-8 file on the host.", inputSchema: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] } },
    { name: "run_command", description: "Run a host command with arguments.", inputSchema: { type: "object", properties: { command: { type: "string" }, args: { type: "array", items: { type: "string" } }, cwd: { type: "string" } }, required: ["command"] } },
];
const send = (msg) => process.stdout.write(JSON.stringify(msg) + "\n");
const ok = (id, result) => send({ jsonrpc: "2.0", id, result });
const rpcErr = (id, code, message) => send({ jsonrpc: "2.0", id, error: { code, message } });
const textResult = (id, text, isError = false) => ok(id, { content: [{ type: "text", text }], isError });
async function api(path, init) {
    const res = await fetch(HARNESS + path, {
        ...init,
        headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}`, ...(init?.headers ?? {}) },
    });
    const body = (await res.json().catch(() => ({})));
    if (!res.ok)
        throw new Error(String(body.error ?? `HTTP ${res.status}`));
    return body;
}
async function callTool(name, args) {
    if (name === "list_bots") {
        const r = await api(`/api/internal/agents?self=${encodeURIComponent(BOT_ID)}`);
        const bots = r.bots ?? [];
        if (!bots.length)
            return { text: "No other bots in this workspace yet." };
        // multibot (F9): opis bota w linijce — adresata wybiera się po tym, czym się
        // zajmuje, nie po nazwie. Bez opisu delegacja sprowadza się do zgadywania.
        const lines = bots.map((b) => `- ${b.name} (id: ${b.id}, model: ${b.model}${b.busy ? ", busy" : ""})` +
            (b.description ? ` — ${b.description}` : ""));
        return { text: `Other bots you can message with ask_bot:\n${lines.join("\n")}` };
    }
    if (name === "ask_bot") {
        const toBotId = String(args.bot_id ?? "").trim();
        const message = String(args.message ?? "").trim();
        if (!toBotId || !message)
            return { text: "ask_bot needs bot_id and message.", isError: true };
        const r = await api(`/api/internal/ask-bot`, {
            method: "POST",
            body: JSON.stringify({ fromBotId: BOT_ID, toBotId, message, depth: DEPTH }),
        });
        if (r.busy)
            return { text: `That bot is busy right now — try again after it finishes.` };
        if (r.error)
            return { text: `Couldn't reach that bot: ${r.error}`, isError: true };
        return { text: `${r.botName ?? "Bot"} replied:\n${r.text ?? "(no reply)"}` };
    }
    const action = {
        get_my_profile: "profile.get", update_my_profile: "profile.update", remember: "memory.add", recall: "memory.list",
        read_memory: "memory.graph", create_skill: "skills.create", list_skills: "skills.list", create_routine: "routines.create",
        list_routines: "routines.list", run_routine: "routines.run", create_agent: "agent.create", update_agent: "agent.update",
        list_groups: "groups.list", create_group: "groups.create", send_group_message: "groups.send", read_file: "file.read",
        write_file: "file.write", run_command: "terminal.run",
    };
    if (action[name]) {
        const r = await api("/api/internal/agent-action", { method: "POST", body: JSON.stringify({ fromBotId: BOT_ID, action: action[name], ...args, ...(name === "recall" ? { query: args.query } : {}) }) });
        return { text: JSON.stringify(r, null, 2) };
    }
    return { text: `Unknown tool: ${name}`, isError: true };
}
async function handle(msg) {
    const id = msg.id;
    const method = msg.method;
    if (!method)
        return;
    const params = (msg.params ?? {});
    switch (method) {
        case "initialize":
            ok(id, {
                protocolVersion: params.protocolVersion ?? "2024-11-05",
                capabilities: { tools: {} },
                serverInfo: { name: "opengrokbot-agents", version: "0.1.0" },
            });
            return;
        case "notifications/initialized":
        case "notifications/cancelled":
            return;
        case "ping":
            ok(id, {});
            return;
        case "tools/list":
            ok(id, { tools: TOOLS });
            return;
        case "tools/call": {
            const name = params.name;
            if (!TOOLS.some((t) => t.name === name))
                return rpcErr(id, -32602, `Unknown tool: ${name}`);
            try {
                const { text, isError } = await callTool(name, (params.arguments ?? {}));
                textResult(id, text, isError);
            }
            catch (e) {
                textResult(id, e.message, true);
            }
            return;
        }
        default:
            if (id !== undefined)
                rpcErr(id, -32601, `Method not found: ${method}`);
    }
}
const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on("line", (line) => {
    const t = line.trim();
    if (!t)
        return;
    let msg;
    try {
        msg = JSON.parse(t);
    }
    catch {
        return;
    }
    void handle(msg).catch((e) => {
        if (msg.id !== undefined)
            rpcErr(msg.id, -32603, e.message);
    });
});
rl.on("close", () => process.exit(0));
