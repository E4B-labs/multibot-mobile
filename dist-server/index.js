// OpenMausBot server — the harness host. Clients hold no transports
// (upstream rule): the React app dispatches typed commands over HTTP and
// folds one SSE event stream; every provider process runs here.
import { randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import * as box from "./box.js";
import { ensureAccessToken, mountAuth, rotateAccessToken } from "./auth.js";
import * as composio from "./composio.js";
import { BUILT_IN_CLI_IDS, DEFAULT_INSTANCE_CONFIGS, ensureDirs, instanceConfigs, loadConfig, saveConfig, DATA_DIR, EVENTS_DIR, NATIVE_DIR, } from "./config.js";
import { CLI_TOOLS, installCommandText } from "./cli-tools.js";
import { deviceInfo } from "./device.js";
import { BUILT_IN_DRIVERS } from "./drivers/builtIn.js";
// multibot: silnik slafy — proxy `/api/engine/*`, pipe WS i uwaga botów (D7)
import { engineBotIdFor, threadIdOfEngineBot } from "./drivers/slafy.js";
import { ensureEngine } from "./engine/supervisor.js";
import { findExistingEngineProfile, importExistingEngineProfile } from "./engine/bootstrap.js";
import { watchEngineAttention } from "./engine/attention.js";
import { configureEngineComputer, engineComputer } from "./engine/computer-mcp.js";
import { mountEngineProxy } from "./engine/proxy.js";
import { EventBus } from "./harness/bus.js";
// multibot (F7): własne serwery MCP użytkownika obok Composio
import * as mcpConnectors from "./mcp-connectors.js";
import { ProviderRegistry } from "./harness/registry.js";
import { HarnessRoutines } from "./routines.js";
import { GroupStore } from "./group-store.js";
import { jobProgress, SetupJobs } from "./setup-jobs.js";
import { chainDepth, mentionedBots, Store } from "./store.js";
import { registerWindowsServerAutostart } from "./windows-autostart.js";
import { WorkspaceStore } from "./workspace.js";
import { canUseIntegration, clearTurnPolicy, setTurnPolicy } from "./turn-policy.js";
const PORT = Number(process.env.OMB_PORT || process.env.OGB_PORT || 8799);
const HOST = process.env.OMB_HOST?.trim() || "127.0.0.1";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REMOTE = !new Set(["127.0.0.1", "::1", "localhost"]).has(HOST.toLowerCase());
// multibot (G2): a remote server owns one origin. Dev keeps Vite separate;
// remote mode serves the built app automatically unless explicitly overridden.
const STATIC_DIR = process.env.OMB_STATIC_DIR || (REMOTE ? join(ROOT, "dist") : null);
const MIME = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".css": "text/css",
    ".webmanifest": "application/manifest+json",
    ".wasm": "application/wasm",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
    ".json": "application/json",
    ".woff2": "font/woff2",
};
// multibot (G5): browser must revalidate install metadata and worker code;
// Vite's fingerprinted assets are safe to retain for the app-shell cache.
function staticHeaders(file) {
    const name = file.toLowerCase().replace(/\\/g, "/");
    const installMetadata = name.endsWith("/index.html") || name.endsWith(".webmanifest") || /\/(?:sw|service-worker)\.js$/.test(name);
    return {
        "content-type": MIME[extname(file).toLowerCase()] ?? "application/octet-stream",
        "cache-control": installMetadata
            ? "no-cache"
            : name.includes("/assets/")
                ? "public, max-age=31536000, immutable"
                : "public, max-age=3600",
        "x-content-type-options": "nosniff",
        ...(/\/(?:sw|service-worker)\.js$/.test(name) ? { "service-worker-allowed": "/" } : {}),
    };
}
ensureDirs();
const cfg = loadConfig();
const access = ensureAccessToken(cfg);
const registry = new ProviderRegistry(BUILT_IN_DRIVERS);
await registry.load(instanceConfigs(cfg));
const groupStore = new GroupStore();
const bus = new EventBus();
bus.attach(registry.instances());
// ── peer-agent comms wiring ────────────────────────────────────────────
// A shared secret guards the localhost-only /api/internal endpoints the
// agents-proxy calls; regenerated each boot (the proxy gets it via env).
const COMMS_TOKEN = randomBytes(24).toString("hex");
// Cap message chains: depth 0 = a user-initiated turn (may ask a peer);
// a peer invoked via ask_bot runs at depth 1 and gets no MCP child, so
// A→B is allowed but B→C (and A→B→A loops) never start.
const MAX_COMMS_DEPTH = 1;
// multibot (F9): głębokość tury, która TERAZ trwa u danego bota — druga (i
// wiarygodniejsza) połowa `chainDepth` w `store.ts`. Upstream ufa `depth` z env
// proxy, co działa, dopóki proxy startuje raz na turę (claude/ACP); bot silnika
// ma agents zamontowane na stałe w profilu (`drivers/slafy.ts`, `syncAgents`),
// więc tam deklaracja zamarza na 0.
const activeCommsDepth = new Map();
// proxy entry: .ts in dev (node type-strips), .js in the packaged dist-server
const agentsProxyPath = (() => {
    const ts = join(dirname(fileURLToPath(import.meta.url)), "drivers", "agents-proxy.ts");
    return existsSync(ts) ? ts : ts.replace(/\.ts$/, ".js");
})();
// in the packaged app process.execPath is Electron — run the proxy as node
const AGENTS_NODE_FLAG = { ELECTRON_RUN_AS_NODE: "1" };
function agentsIntegration(botId, depth) {
    return {
        command: process.execPath,
        args: [agentsProxyPath],
        env: {
            ...AGENTS_NODE_FLAG,
            OMB_HARNESS_URL: `http://127.0.0.1:${PORT}`,
            OMB_BOT_ID: botId,
            OMB_COMMS_TOKEN: COMMS_TOKEN,
            OMB_TURN_DEPTH: String(depth),
        },
    };
}
/** Run a turn on `targetBotId` and resolve with its assistant text — the
 * synchronous half of ask_bot. Subscribes to the bus, folds assistant_text
 * for that thread, resolves on turn.completed (or a 4-min ceiling). */
function askBotAndWait(targetBotId, message, depth) {
    const target = store.bot(targetBotId);
    if (!target)
        return Promise.resolve("(no such bot)");
    const threadId = target.threadId;
    return new Promise((resolve) => {
        let text = "";
        let done = false;
        const finish = (out) => {
            if (done)
                return;
            done = true;
            clearTimeout(timer);
            unsub();
            resolve(out);
        };
        const unsub = bus.subscribe((e) => {
            if (e.threadId !== threadId)
                return;
            if (e.type === "item.completed" && e.itemType === "assistant_text") {
                text += (text ? "\n" : "") + e.text;
            }
            else if (e.type === "turn.completed") {
                finish(text || "(the bot finished without a text reply)");
            }
        });
        const timer = setTimeout(() => finish(text || "(timed out waiting for the bot to reply)"), 4 * 60_000);
        startTurn(targetBotId, message, { commsDepth: depth + 1 }).catch((err) => finish(`(couldn't start that bot: ${err instanceof Error ? err.message : String(err)})`));
    });
}
// default selection for new bots: embedded engine first, then CLI fallback.
async function defaultSelection(described) {
    const fleet = described ?? (await registry.describe());
    const enabled = fleet.filter((d) => d.enabled !== false);
    const available = enabled.filter((d) => d.snapshot.state === "available");
    const pick = available.find((d) => d.driverKind === "slafy") ??
        available.find((d) => d.driverKind === "claudeAgent") ??
        available[0] ??
        enabled.find((d) => d.driverKind === "claudeAgent") ??
        enabled[0] ??
        fleet[0];
    return { instanceId: pick?.instanceId ?? "claude", model: pick?.models.default || "claude-sonnet-5" };
}
let bootSelection = { instanceId: "claude", model: "claude-sonnet-5" };
const store = new Store(() => bootSelection);
const workspace = new WorkspaceStore();
const bootFleet = await registry.describe();
bootSelection = await defaultSelection(bootFleet);
// multibot (G1): legacy bots selected the removed `slafy` default instance.
// Repair before the first API response, preferring a named custom model.
store.migrateOrphanedSelections(bootFleet);
// Keep persisted Claude selections inside four stable UI entries. The driver
// translates these product IDs to Claude Code aliases at execution time.
for (const bot of store.bots) {
    if (bot.modelSelection.instanceId !== "claude")
        continue;
    const model = bot.modelSelection.model;
    const stable = model === "opus" || model.startsWith("claude-opus-") ? "claude-opus-5"
        : model === "haiku" || model.startsWith("claude-haiku-") ? "claude-haiku-4-5"
            : model === "fable" || model.startsWith("claude-fable-") ? "claude-fable-5"
                : model === "sonnet" || model.startsWith("claude-sonnet-") ? "claude-sonnet-5"
                    : model;
    if (stable !== model)
        store.patchBot(bot.id, { modelSelection: { instanceId: "claude", model: stable } });
}
const existingEngineProfile = findExistingEngineProfile(ROOT);
const hadHarnessBots = store.bots.length > 0;
store.seedIfEmpty();
// First launch with an existing engine profile: preserve its SOUL, memory,
// routines and skills by copying it to deterministic thread identity before
// any UI turn can create a blank profile. A seeded "Milind" placeholder is
// also eligible, so a Termux Hermes home discovered after first boot migrates
// without deleting the user's harness data.
const seededPlaceholder = store.bots.length === 1 && store.bots[0]?.name === "Milind" && store.bots[0]?.modelSelection.instanceId === "claude";
// Re-check local first bot on every restart: the engine data directory can be
// new while harness bots.json already exists (fresh Termux/service rebuild).
// Import endpoint is idempotent and returns 409 when target already exists.
const localFirstBot = store.bots.length === 1 && store.bots[0]?.modelSelection.instanceId === "local";
if (existingEngineProfile && (!hadHarnessBots || seededPlaceholder || localFirstBot) && store.bots.length === 1) {
    const first = store.bots[0];
    store.patchBot(first.id, {
        name: existingEngineProfile.name,
        ...(existingEngineProfile.title !== undefined ? { title: existingEngineProfile.title } : {}),
        ...(existingEngineProfile.description !== undefined ? { description: existingEngineProfile.description } : {}),
        modelSelection: { instanceId: "local", model: bootFleet.find((d) => d.instanceId === "local")?.models.default || "hermes-agent" },
    });
    try {
        const baseUrl = await ensureEngine();
        await importExistingEngineProfile(baseUrl, existingEngineProfile, engineBotIdFor(first.threadId));
        console.log(`[multibot] imported existing engine profile "${existingEngineProfile.name}" into first bot`);
    }
    catch (error) {
        console.warn(`[multibot] existing profile import deferred: ${error instanceof Error ? error.message : String(error)}`);
    }
}
// ── SSE fan-out to clients ─────────────────────────────────────────────
const sseClients = new Set();
function broadcast(payload) {
    const frame = `data: ${JSON.stringify(payload)}\n\n`;
    for (const res of [...sseClients]) {
        try {
            res.write(frame);
        }
        catch {
            sseClients.delete(res);
        }
    }
}
// ── server-side event folding (upstream's ingestion worker, miniature) ──
// The canonical stream is the source of truth; the persisted transcript
// and every client view are projections of it.
const toolMessageByItem = new Map(); // itemId -> messageId
const askMessageByRequest = new Map(); // requestId -> messageId
bus.subscribe((event) => {
    broadcast({ kind: "runtime", event });
    const bot = store.botByThread(event.threadId);
    if (!bot)
        return;
    if (event.type === "thread.token-usage.updated") {
        workspace.recordTokens(bot.id, event.input, event.output);
    }
    else if (event.type === "turn.completed") {
        workspace.recordTurn(bot.id);
    }
    const pushMessage = (m) => {
        const message = store.appendMessage(event.threadId, m);
        broadcast({ kind: "message", threadId: event.threadId, message });
        return message;
    };
    switch (event.type) {
        case "session.started":
            if (event.sessionId && event.providerInstanceId) {
                store.setResumeCursor(bot.id, event.providerInstanceId, event.sessionId);
            }
            break;
        case "item.completed":
            if (event.itemType === "assistant_text") {
                pushMessage({ role: "bot", kind: "text", text: event.text });
            }
            else if (event.itemType === "tool" && event.itemId) {
                const messageId = toolMessageByItem.get(event.itemId);
                if (messageId) {
                    const patched = store.patchMessage(event.threadId, messageId, {
                        tool: { name: store.messagesFor(event.threadId).find((m) => m.id === messageId)?.tool?.name ?? "tool", ok: event.ok },
                    });
                    if (patched)
                        broadcast({ kind: "message.patch", threadId: event.threadId, message: patched });
                    toolMessageByItem.delete(event.itemId);
                }
                // the bot just finished acting — refresh its screen preview now
                pokeScreenPoller(bot.id);
            }
            break;
        case "item.started":
            if (event.itemType === "tool") {
                const message = pushMessage({ role: "bot", kind: "activity", tool: { name: event.title ?? "tool" } });
                if (event.itemId)
                    toolMessageByItem.set(event.itemId, message.id);
            }
            break;
        case "request.opened": {
            const permission = event.requestType === "permission";
            const message = pushMessage({
                role: "bot",
                kind: "options",
                card: {
                    title: permission ? "Approval needed" : "Your bot has a question",
                    subtitle: event.summary,
                    options: event.choices?.length ? event.choices : permission ? ["Allow", "Deny"] : [],
                    requestId: event.requestId,
                },
            });
            if (event.requestId)
                askMessageByRequest.set(event.requestId, message.id);
            break;
        }
        case "request.resolved": {
            const messageId = event.requestId ? askMessageByRequest.get(event.requestId) : null;
            if (messageId) {
                const existing = store.messagesFor(event.threadId).find((m) => m.id === messageId);
                if (existing?.card && !existing.card.answered) {
                    const patched = store.patchMessage(event.threadId, messageId, {
                        card: { ...existing.card, answered: event.behavior, dismissed: event.source !== "user" },
                    });
                    if (patched)
                        broadcast({ kind: "message.patch", threadId: event.threadId, message: patched });
                }
                if (event.requestId)
                    askMessageByRequest.delete(event.requestId);
            }
            break;
        }
        case "runtime.error":
            pushMessage({ role: "bot", kind: "activity", tool: { name: `error: ${event.message.slice(0, 160)}`, ok: false } });
            break;
        case "turn.completed": {
            // the last live frame becomes a settled inline screen message —
            // the screenshot-in-chat moment
            const frame = stopScreenPoller(bot.id);
            if (frame)
                pushMessage({ role: "bot", kind: "screen", png: frame.png, mime: frame.mime });
            store.patchBot(bot.id, { busy: false, unread: true });
            clearTurnPolicy(bot.threadId);
            activeCommsDepth.delete(bot.id); // multibot (F9): tura skończona — licznik też
            broadcast({ kind: "bot", bot: store.bot(bot.id) });
            break;
        }
    }
});
const screenPollers = new Map();
function startScreenPoller(botId) {
    if (screenPollers.has(botId) || !box.boxConfigured(cfg))
        return;
    let inFlight = false;
    const capture = async () => {
        if (inFlight)
            return;
        inFlight = true;
        try {
            const { png, format } = await box.screenshotBox(cfg, botId);
            const frame = { png, mime: format === "jpeg" ? "image/jpeg" : "image/png" };
            entry.last = frame;
            broadcast({ kind: "screen", botId, ...frame });
        }
        catch {
            /* box asleep or mid-command — try again next tick */
        }
        finally {
            inFlight = false;
        }
    };
    const entry = {
        timer: setInterval(capture, 4000),
        capture,
        last: null,
    };
    screenPollers.set(botId, entry);
}
/** Event-driven refresh: capture NOW (the bot just acted on its screen)
 * instead of waiting for the next interval tick. */
function pokeScreenPoller(botId) {
    void screenPollers.get(botId)?.capture();
}
function stopScreenPoller(botId) {
    const entry = screenPollers.get(botId);
    if (!entry)
        return null;
    clearInterval(entry.timer);
    screenPollers.delete(botId);
    return entry.last;
}
// multibot: where Electron's app.getPath("userData") lands, per platform —
// the hardcoded macOS path found nothing anywhere else, and threw the
// non-ENOENT errors into the same silent catch.
function userDataRoot() {
    if (process.platform === "win32")
        return process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
    if (process.platform === "darwin")
        return join(homedir(), "Library", "Application Support");
    return process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
}
// Local computer-use contract written by Electron main on startup
// (<userData>/cua-connection.json). Read fresh each turn — Electron may
// restart or permissions may change.
function readCuaConnection() {
    // new name first; pre-rename desktop builds used the old directory
    for (const dir of ["OpenMausBot", "openmausbot", "OpenGrokBot", "opengrokbot"]) {
        try {
            const p = join(userDataRoot(), dir, "cua-connection.json");
            const conn = JSON.parse(readFileSync(p, "utf8"));
            if (!conn || conn.mode === "unavailable" || !conn.mcpCommand)
                continue;
            return { command: conn.mcpCommand, args: conn.mcpArgs ?? ["mcp"], env: conn.mcpEnv ?? {} };
        }
        catch {
            /* try the next location */
        }
    }
    return null;
}
// multibot: Hermes-compatible provider/model switch for chat. `/model` is a
// harness command, not prose sent to whichever provider happens to be active.
// Selection persists on bot, matching the model picker and surviving restart.
async function handleModelCommand(bot, text) {
    if (!bot || !/^\/model(?:\s|$)/i.test(text))
        return null;
    if (bot.busy)
        throw Object.assign(new Error("the bot is already working — interrupt it first"), { status: 409 });
    const raw = text.replace(/^\/model\s*/i, "").trim();
    const providerFlag = raw.match(/(?:^|\s)--provider(?:=|\s+)([^\s]+)/i)?.[1]?.toLowerCase();
    const target = raw
        .replace(/(?:^|\s)--(?:provider(?:=|\s+)[^\s]+|global|session|once|refresh)(?=\s|$)/gi, "")
        .trim();
    const described = (await registry.describe()).filter((item) => item.instanceId !== "local");
    const key = (value) => value.trim().toLowerCase().replace(/\s+/g, "");
    const aliases = {
        anthropic: "claude",
        openai: "codex",
        chatgpt: "codex",
        google: "gemini",
        xai: "grok",
        moonshot: "kimi",
        alibaba: "qwen",
    };
    const findProvider = (value) => {
        const wanted = aliases[key(value)] ?? key(value);
        return described.find((item) => [item.instanceId, item.driverKind, item.displayName].some((candidate) => key(candidate) === wanted));
    };
    const current = described.find((item) => item.instanceId === bot.modelSelection.instanceId);
    if (!raw) {
        const lines = described.map((item) => {
            const models = item.models.options.map((model) => model.id).join(", ") || "no catalog";
            const status = item.snapshot.state === "available" ? "ready" : `unavailable: ${item.snapshot.reason ?? "not ready"}`;
            return `- ${item.displayName ?? item.instanceId}: ${models} (${status})`;
        });
        return `Current model: ${bot.modelSelection.model || "unknown"}\nProvider: ${current?.displayName ?? (bot.modelSelection.instanceId || "unknown")}\n\n${lines.join("\n")}\n\nUse /model <provider>/<model> or /model <model> --provider <provider>.`;
    }
    let provider = providerFlag ? findProvider(providerFlag) : undefined;
    let model = target;
    if (!provider && target.includes("/")) {
        const slash = target.indexOf("/");
        const candidate = findProvider(target.slice(0, slash));
        if (candidate) {
            provider = candidate;
            model = target.slice(slash + 1);
        }
    }
    if (!provider && target.includes(":")) {
        const colon = target.indexOf(":");
        const candidate = findProvider(target.slice(0, colon));
        if (candidate) {
            provider = candidate;
            model = target.slice(colon + 1);
        }
    }
    if (!provider && !providerFlag) {
        provider = described.find((item) => item.instanceId === bot.modelSelection.instanceId &&
            item.models.options.some((option) => option.id === target || option.label.toLowerCase() === target.toLowerCase()));
        provider ??= described.find((item) => item.models.options.some((option) => option.id === target || option.label.toLowerCase() === target.toLowerCase()));
    }
    if (!provider && providerFlag)
        return `Unknown provider: ${providerFlag}. Use /model to list providers.`;
    if (!provider)
        return `Unknown model: ${target}. Use /model to list providers and models.`;
    if (provider.snapshot.state !== "available") {
        return `${provider.displayName ?? provider.instanceId} unavailable: ${provider.snapshot.reason ?? "not ready"}`;
    }
    if (!model)
        model = provider.models.default;
    const known = provider.models.options.some((option) => option.id === model || option.label.toLowerCase() === model.toLowerCase());
    if (!known && provider.models.options.length && provider.driverKind !== "slafy") {
        return `Unknown ${provider.displayName ?? provider.instanceId} model: ${model}. Available: ${provider.models.options.map((option) => option.id).join(", ")}`;
    }
    const selectedModel = provider.models.options.find((option) => option.id === model || option.label.toLowerCase() === model.toLowerCase())?.id ?? model;
    store.patchBot(bot.id, { modelSelection: { instanceId: provider.instanceId, model: selectedModel } });
    broadcast({ kind: "bot", bot: store.bot(bot.id) });
    return `Model switched to: ${selectedModel}\nProvider: ${provider.displayName ?? provider.instanceId}`;
}
const isReasoningLevel = (value) => value === "low" || value === "medium" || value === "high" || value === "xhigh" || value === "max";
async function startTurn(botId, text, opts) {
    const bot = store.bot(botId);
    if (!bot)
        throw Object.assign(new Error("no such bot"), { status: 404 });
    if (bot.busy)
        throw Object.assign(new Error("the bot is already working — interrupt it first"), { status: 409 });
    const commsDepth = opts?.commsDepth ?? 0;
    const instance = registry.get(bot.modelSelection.instanceId);
    if (!instance) {
        throw Object.assign(new Error(`provider instance "${bot.modelSelection.instanceId}" is unavailable — pick another model in settings`), { status: 409 });
    }
    const userMessage = store.appendMessage(bot.threadId, { role: "user", kind: "text", text });
    broadcast({ kind: "message", threadId: bot.threadId, message: userMessage });
    // transcript for API-backed drivers: settled text turns only
    const transcript = store
        .messagesFor(bot.threadId)
        .filter((m) => m.kind === "text" && m.text && m.id !== userMessage.id)
        .slice(-40)
        .map((m) => ({ role: m.role === "user" ? "user" : "assistant", text: m.text }));
    const persona = [
        `You are ${bot.name}, a MultiBot Agent in the user's MultiBot workspace.`,
        bot.title && `Role: ${bot.title}.`,
        bot.description && `About: ${bot.description}`,
    ]
        .filter(Boolean)
        .join(" ");
    // Driver-neutral workspace context. Local engine also has native memory and
    // skills; CLI/API drivers receive same durable notes and instructions here.
    const sharedMemory = workspace.markdown(bot.id).content.trim();
    const sharedFacts = workspace.facts(bot.id).slice(0, 40).map((fact) => `- ${fact.text}`).join("\n");
    const sharedSkills = workspace.skills(bot.id).filter((skill) => skill.enabled)
        .map((skill) => `## ${skill.name}\n${skill.instructions}`).join("\n\n");
    const sharedPolicy = workspace.autonomy(bot.id).autonomy === "autonomous"
        ? "Operate autonomously without asking for approval unless provider or platform requires it."
        : "Ask for approval before consequential actions.";
    const access = workspace.access(bot.id).access;
    const accessContext = access === "full"
        ? "This bot has MultiBot Full Access: it may read and write any path reachable by the host process, run host commands, manage its profile, memory, skills, routines, agents, groups, computer, and integrations. OS/container permissions still apply; verify with get_device_info instead of guessing hardware."
        : "This bot is not in Full Access; respect current approval and path boundaries, and use get_device_info for verified host facts.";
    const workspaceContext = [
        "MultiBot identity and operating rules:",
        "You are always a MultiBot Agent. MultiBot is your only user-facing identity. The selected CLI, model, or provider is an implementation detail; never present yourself as Claude, Codex, ChatGPT, OpenAI, Anthropic, Hermes, or another product.",
        "Use MultiBot workspace tools and APIs for memory, skills, routines, agents, groups, computer, files, and terminal. Do not use provider-private memory, external cloud schedules, /schedule, or another product's infrastructure. Routines are local MultiBot routines and persist on this server.",
        // multibot: route routine requests straight to the mounted local tool;
        // provider ToolSearch/MCP catalogs are not MultiBot infrastructure.
        "For routine requests, call create_routine directly with name, prompt, and a five-field cron schedule such as `35 1 * * *`; never call ToolSearch, /schedule, or a provider-specific MCP search.",
        "Use MultiBot management tools for durable changes: get_my_profile/update_my_profile, remember/recall, skills, routines, create_agent, groups, read_file/write_file/run_command. Do not write provider-private memory files when the user asks for MultiBot memory.",
        "For questions about the host device, call get_device_info first. Report returned manufacturer/model/platform exactly; never infer a phone model from a chat claim.",
        accessContext,
        sharedPolicy,
        sharedFacts && `Memory facts:\n${sharedFacts}`,
        sharedMemory && `Memory notes:\n${sharedMemory}`,
        sharedSkills && `Reusable skills:\n${sharedSkills}`,
    ].filter(Boolean).join("\n\n");
    // multibot (D7): kolejna tura usera JEST odpowiedzią na to, na co bot czekał
    if (bot.needsAttention != null)
        store.patchBot(bot.id, { needsAttention: null });
    // busy flips immediately so the composer locks; the dispatch itself runs
    // in the background — box provisioning can take ~90s and must never
    // hang the HTTP request
    store.patchBot(bot.id, { busy: true, unread: false });
    setTurnPolicy(bot.threadId, {
        autonomy: workspace.autonomy(bot.id).autonomy,
        access: workspace.access(bot.id).access,
        permissions: workspace.permissions(bot.id),
    });
    activeCommsDepth.set(bot.id, commsDepth); // multibot (F9): patrz `activeCommsDepth`
    broadcast({ kind: "bot", bot: store.bot(bot.id) });
    void (async () => {
        try {
            const integrations = {};
            if (cfg.composio?.key && canUseIntegration(bot.threadId, "integrations")) {
                integrations.composio = { key: cfg.composio.key, url: cfg.composio.url };
            }
            const wants = bot.computer; // 'cloud' | 'local' | 'playwright' | 'shared' | 'off' | undefined(auto)
            // multibot (F5): "playwright" = przeglądarka bota w silniku. Wybór jawny,
            // więc wyklucza oba komputery upstreamu — stąd `wants !== "playwright"`
            // w ich warunkach niżej. Driver slafy dostaje ją natywnie (toolset Hermesa
            // nad providerem `slafy`), więc jemu nie montujemy NICZEGO.
            if (canUseIntegration(bot.threadId, "browser") && (wants === "playwright" || wants === "shared") && instance.driverKind !== "slafy") {
                const mcp = await engineComputer(bot.threadId, undefined, wants === "shared" ? "shared" : "own");
                if (mcp)
                    integrations.localComputer = mcp;
            }
            else if (canUseIntegration(bot.threadId, "browser") && (wants === "playwright" || wants === "shared") && instance.driverKind === "slafy") {
                // Native browser tools still run inside this bot's engine profile.
                await configureEngineComputer(bot.threadId, wants === "shared" ? "shared" : "own");
            }
            if (canUseIntegration(bot.threadId, "browser") && wants !== "off" && wants !== "local" && wants !== "playwright" && wants !== "shared" && box.boxConfigured(cfg)) {
                let b = await box.findBox(cfg, bot.id).catch(() => null);
                // the Computer driver runs ON the box — provision it on first use
                if (!b && instance.driverKind === "boxAgent") {
                    broadcast({ kind: "computer", botId: bot.id, state: "provisioning" });
                    await box.provisionBox(cfg, bot.id, bot.name);
                    b = await box.findBox(cfg, bot.id).catch(() => null);
                }
                if (b)
                    integrations.computer = { boxId: b.id, token: cfg.box.token };
            }
            // local computer (this Mac) via the Electron-hosted cua-driver: the
            // Electron main process owns the daemon (TCC attribution) and writes
            // its spawn contract to cua-connection.json; the harness only reads it
            if (canUseIntegration(bot.threadId, "browser") && !integrations.computer && wants !== "off" && wants !== "cloud" && wants !== "playwright" && wants !== "shared") {
                const cua = readCuaConnection();
                if (cua)
                    integrations.localComputer = cua;
            }
            // MultiBot management MCP: same local stdio shape as upstream
            // OpenMausBot. Mount on every user turn, including a one-bot workspace;
            // this proxy also carries memory, skills, routines, profile, device,
            // files and terminal. Depth-limited peer turns get no child to prevent
            // recursion.
            if (commsDepth < MAX_COMMS_DEPTH &&
                instance.adapter.capabilities.agentsMcp === true) {
                integrations.agents = agentsIntegration(bot.id, commsDepth);
            }
            // @mentions in the user's message (the composer's tagging UI) become
            // an explicit delegation nudge — the agent still does the ask_bot call
            // itself, so the harness stays the single owner of turns/permissions
            const tagged = mentionedBots(text, store.bots.filter((b) => b.id !== bot.id));
            // Providers without MCP (currently Codex and API-backed Grok) still
            // get explicit peer delegation. Fetch replies before their turn and
            // attach them to the prompt; native MCP providers keep live tools.
            let taggedReplies = "";
            if ((!integrations.agents || instance.driverKind === "codex") && tagged.length && commsDepth < MAX_COMMS_DEPTH && canUseIntegration(bot.threadId, "delegation")) {
                const replies = await Promise.all(tagged.map(async (peer) => ({
                    peer,
                    reply: await askBotAndWait(peer.id, `[Delegation from @${bot.name}] ${text}`, commsDepth),
                })));
                taggedReplies = replies
                    .map(({ peer, reply }) => `\nPeer ${peer.name} replied:\n${reply || "(no reply)"}`)
                    .join("\n");
            }
            await instance.adapter.sendTurn({
                threadId: bot.threadId,
                text,
                model: bot.modelSelection.model,
                resumeCursor: bot.resumeCursors[bot.modelSelection.instanceId],
                transcript,
                system: persona + "\n\n" + workspaceContext +
                    (integrations.computer && instance.driverKind !== "boxAgent"
                        ? " You have your own cloud computer — use the computer tools (screenshot, computer_exec, open_url) whenever browsing or acting on a desktop helps."
                        : // multibot (F5): komputer silnika to PRZEGLĄDARKA bota, nie pulpit
                            // użytkownika — opis pulpitu wysyłałby agenta po narzędzia, których
                            // ten serwer MCP nie ma (a11y, exec).
                            (wants === "playwright" || wants === "shared") && integrations.localComputer
                                ? ` You have ${wants === "shared" ? "the fleet's shared" : "your own"} browser with a persistent profile — screenshot it first, then click/type_text/key/scroll on what you see, navigate opens a URL and read_page returns the page text.`
                                : integrations.localComputer
                                    ? " You can act on the user's computer through the computer tools — take a screenshot or read the desktop state first, prefer accessibility actions over raw coordinates, and act carefully."
                                    : "") +
                    (integrations.agents
                        ? " You can work with the user's other bots through the agents tools — list_bots shows who's available, ask_bot sends one of them a message and returns their reply."
                        : "") +
                    (tagged.length
                        ? integrations.agents
                            ? ` The user tagged ${tagged
                                .map((t) => `@${t.name} (ask_bot bot_id ${t.id})`)
                                .join(" and ")} in their message — bring them in with ask_bot and fold their reply into your answer.`
                            : " The harness already fetched the tagged peer replies and appended them below."
                        : "") +
                    taggedReplies,
                integrations,
                ...(opts?.reasoning ? { reasoning: opts.reasoning } : {}),
            });
            if (integrations.computer)
                startScreenPoller(bot.id);
        }
        catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            const failure = store.appendMessage(bot.threadId, {
                role: "bot",
                kind: "activity",
                tool: { name: `error: ${message.slice(0, 160)}`, ok: false },
            });
            broadcast({ kind: "message", threadId: bot.threadId, message: failure });
            store.patchBot(bot.id, { busy: false });
            clearTurnPolicy(bot.threadId);
            activeCommsDepth.delete(bot.id); // multibot (F9): tura padła — licznik też
            broadcast({ kind: "bot", bot: store.bot(bot.id) });
        }
    })();
}
// ── config hot-reload ─────────────────────────────────────────────────
function configStatus() {
    return {
        xai: { configured: Boolean(cfg.xai?.key) },
        composio: { configured: Boolean(cfg.composio?.key), apiKeyConfigured: Boolean(cfg.composio?.apiKey) },
        box: { configured: Boolean(cfg.box?.token) },
        // not a secret — the sidebar shows it
        profile: { name: cfg.profile?.name ?? "", email: cfg.profile?.email ?? "" },
    };
}
/** Rebuild the provider fleet after a config change so new keys take
 * effect without a server restart (kills any in-flight turns). */
async function reloadProviders() {
    bus.detachAll();
    await registry.disposeAll();
    await registry.load(instanceConfigs(cfg));
    bus.attach(registry.instances());
    if (store.migrateOrphanedSelections(await registry.describe())) {
        for (const bot of store.bots)
            broadcast({ kind: "bot", bot });
    }
}
// multibot (G3): jobs outlive onboarding panel mounts and persist their output
// across harness restarts. Global events let any open panel update live.
const setupJobs = new SetupJobs(join(DATA_DIR, "setup-jobs.json"), (job) => broadcast({ kind: "setup.job", job }));
// multibot: routines for every driver. The selected instance is resolved by
// startTurn at execution time, so changing model never strands a schedule.
const harnessRoutines = new HarnessRoutines(join(DATA_DIR, "routines.json"), async (routine) => {
    await startTurn(routine.botId, `[Routine: ${routine.name}]\n\n${routine.prompt}`);
});
function routineView(botId, routine) {
    const bot = store.bot(botId);
    const driverKind = bot ? registry.get(bot.modelSelection.instanceId)?.driverKind ?? null : null;
    return {
        ...routine,
        execution: {
            driverKind,
            limitations: driverKind && driverKind !== "slafy"
                ? [
                    "The selected command-line tool must stay installed and signed in on the server.",
                    "A busy bot is not interrupted; the routine records an error and waits for its next run.",
                    "Interactive CLI approvals may wait until a user reconnects.",
                ]
                : [],
        },
    };
}
// multibot (G1): custom-model config stays write-only for API keys. Helpers
// return only display metadata consumed by app settings and model picker.
const RESERVED_INSTANCE_IDS = new Set([
    ...Object.keys(DEFAULT_INSTANCE_CONFIGS),
    ...BUILT_IN_DRIVERS.map((driver) => driver.driverKind),
    "slafy",
    "__proto__",
    "prototype",
    "constructor",
]);
function customModelsStatus() {
    return Object.entries(cfg.instances ?? {}).flatMap(([id, entry]) => entry.driver === "slafy" && !RESERVED_INSTANCE_IDS.has(id) && entry.model?.default
        ? [
            {
                id,
                displayName: entry.displayName ?? id,
                baseUrl: entry.model.baseUrl ?? "",
                model: entry.model.default,
                hasKey: Boolean(entry.environment?.OPENAI_API_KEY),
            },
        ]
        : []);
}
function validBaseUrl(value) {
    try {
        const url = new URL(value);
        return (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password;
    }
    catch {
        return false;
    }
}
async function cliToolsStatus() {
    const described = await registry.describe();
    return CLI_TOOLS.map((tool) => {
        const instance = described.find((item) => item.instanceId === tool.id);
        return {
            id: tool.id,
            driverKind: tool.driverKind,
            displayName: instance?.displayName ?? tool.displayName,
            enabled: cfg.instances?.[tool.id]?.enabled !== false,
            detected: instance?.snapshot.state === "available",
            reason: instance?.snapshot.reason,
            version: instance?.snapshot.version ?? undefined,
            installCommand: tool.installStrategy === "claude-native"
                ? "Native installer for this device"
                : installCommandText(tool.install),
            loginCommand: tool.loginCommand ?? null,
            loginAvailable: Boolean(tool.login),
            loginMode: tool.loginMode ?? "stdin",
        };
    });
}
function cliInstallSpec(tool) {
    if (tool.installStrategy === "claude-native") {
        const scriptInRepo = join(ROOT, "scripts", "install-claude.mjs");
        const script = existsSync(scriptInRepo) ? scriptInRepo : join(ROOT, "install-claude.mjs");
        return existsSync(script)
            ? { command: process.execPath, args: [script] }
            : null;
    }
    return tool.install ?? null;
}
function provisionJob() {
    const target = process.env.OMB_ENGINE_RUNTIME || join(DATA_DIR, "engine-runtime");
    const scriptInRepo = join(ROOT, "scripts", "provision-engine.mjs");
    const script = existsSync(scriptInRepo) ? scriptInRepo : join(ROOT, "provision-engine.mjs");
    const temp = join(target, "tmp");
    mkdirSync(temp, { recursive: true });
    return setupJobs.start({
        key: "engine-provision",
        kind: "provision",
        title: "Install bot server",
        command: process.execPath,
        args: [script, "--target", target, "--requirements", join(ROOT, "engine", "requirements.txt")],
        cwd: ROOT,
        env: {
            TMP: temp,
            TEMP: temp,
            OMB_ENGINE_RUNTIME: target,
            PLAYWRIGHT_BROWSERS_PATH: join(target, "browsers"),
            ELECTRON_RUN_AS_NODE: "1",
        },
    });
}
// ── HTTP plumbing ─────────────────────────────────────────────────────
function json(res, status, body) {
    const data = JSON.stringify(body);
    // API data is never part of the PWA app-shell cache.
    res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(data);
}
function readBody(req) {
    return new Promise((resolve, reject) => {
        let data = "";
        req.on("data", (c) => {
            data += c;
            if (data.length > 1_000_000)
                reject(new Error("body too large"));
        });
        req.on("end", () => {
            try {
                resolve(data ? JSON.parse(data) : {});
            }
            catch {
                reject(new Error("invalid JSON body"));
            }
        });
        req.on("error", reject);
    });
}
const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
    const path = url.pathname;
    const method = req.method ?? "GET";
    try {
        // ── internal peer-agent comms (localhost + shared token only) ──────
        // The agents-proxy (spawned inside a bot's agent process) calls these to
        // discover peers and hand a message to one. Not part of the public API.
        if (path.startsWith("/api/internal/")) {
            if (req.headers.authorization !== `Bearer ${COMMS_TOKEN}`) {
                return json(res, 401, { error: "unauthorized" });
            }
            if (method === "GET" && path === "/api/internal/agents") {
                const self = url.searchParams.get("self");
                const bots = store.bots
                    .filter((b) => b.id !== self && !b.hidden)
                    .map((b) => ({
                    id: b.id,
                    name: b.name,
                    model: b.modelSelection.model,
                    busy: !!b.busy,
                    // multibot (F9): delegacja PO OPISIE. Bez tego pola wołający wybiera
                    // adresata wyłącznie po nazwie — a nazwa nie mówi, czym bot się
                    // zajmuje. To ta sama persona (`title`/`description` z BotRecord),
                    // którą bot dostaje w swoim `system`, więc flota opisuje się floci
                    // dokładnie tak, jak opisał ją użytkownik.
                    description: [b.title, b.description].filter(Boolean).join(" — "),
                }));
                return json(res, 200, { bots });
            }
            if (method === "POST" && path === "/api/internal/agent-action") {
                const body = await readBody(req);
                const fromBotId = String(body.fromBotId ?? "");
                const action = String(body.action ?? "");
                const caller = store.bot(fromBotId);
                if (!caller)
                    return json(res, 404, { error: "no such caller bot" });
                const access = workspace.access(fromBotId).access;
                const readOnlyActions = new Set(["profile.get", "memory.list", "memory.graph", "memory.markdown.get", "skills.list", "routines.list", "groups.list", "device.info", "file.read"]);
                if (access === "read-only" && !readOnlyActions.has(action))
                    return json(res, 403, { error: "read-only access" });
                const requireFull = () => {
                    if (access !== "full")
                        throw Object.assign(new Error("Full Access required for this action"), { status: 403 });
                };
                const bot = () => store.bot(fromBotId);
                switch (action) {
                    case "profile.get": return json(res, 200, bot());
                    case "profile.update": {
                        requireFull();
                        const patch = {};
                        for (const key of ["name", "title", "description", "notifications", "computer", "color", "mascotExpression", "mascotShape", "modelSelection"]) {
                            if (body[key] !== undefined)
                                patch[key] = body[key];
                        }
                        const updated = store.patchBot(fromBotId, patch);
                        broadcast({ kind: "bot", bot: updated });
                        return json(res, 200, updated);
                    }
                    case "memory.list": return json(res, 200, workspace.facts(fromBotId, String(body.query ?? "")));
                    case "memory.graph": return json(res, 200, workspace.graph(fromBotId));
                    case "memory.markdown.get": return json(res, 200, workspace.markdown(fromBotId));
                    case "memory.add": {
                        requireFull();
                        const fact = workspace.addFact(fromBotId, body);
                        broadcast({ kind: "workspace", botId: fromBotId, resource: "memory" });
                        return json(res, 201, fact);
                    }
                    case "memory.markdown.set": {
                        requireFull();
                        const markdown = workspace.putMarkdown(fromBotId, body.content);
                        broadcast({ kind: "workspace", botId: fromBotId, resource: "memory" });
                        return json(res, 200, markdown);
                    }
                    case "skills.list": return json(res, 200, workspace.skills(fromBotId));
                    case "skills.create": {
                        requireFull();
                        const skill = workspace.addSkill(fromBotId, body);
                        broadcast({ kind: "workspace", botId: fromBotId, resource: "skills" });
                        return json(res, 201, skill);
                    }
                    case "skills.update": {
                        requireFull();
                        const skill = workspace.patchSkill(fromBotId, String(body.name), body);
                        broadcast({ kind: "workspace", botId: fromBotId, resource: "skills" });
                        return json(res, 200, skill ?? { error: "no such skill" });
                    }
                    case "skills.delete": {
                        requireFull();
                        const ok = workspace.deleteSkill(fromBotId, String(body.name));
                        broadcast({ kind: "workspace", botId: fromBotId, resource: "skills" });
                        return json(res, 200, { ok });
                    }
                    case "routines.list": return json(res, 200, harnessRoutines.list(fromBotId).map((routine) => routineView(fromBotId, routine)));
                    case "routines.create": {
                        requireFull();
                        const routine = harnessRoutines.create(fromBotId, body);
                        broadcast({ kind: "workspace", botId: fromBotId, resource: "routines" });
                        return json(res, 201, routineView(fromBotId, routine));
                    }
                    case "routines.run": {
                        requireFull();
                        const routine = await harnessRoutines.runNow(fromBotId, String(body.id));
                        broadcast({ kind: "workspace", botId: fromBotId, resource: "routines" });
                        return json(res, 200, routine ? routineView(fromBotId, routine) : { error: "no such routine" });
                    }
                    case "routines.delete": {
                        requireFull();
                        const ok = harnessRoutines.delete(fromBotId, String(body.id));
                        broadcast({ kind: "workspace", botId: fromBotId, resource: "routines" });
                        return json(res, 200, { ok });
                    }
                    case "agent.create": {
                        requireFull();
                        const created = store.createBot();
                        const selection = await defaultSelection();
                        const updated = store.patchBot(created.id, { name: String(body.name ?? created.name), title: String(body.title ?? ""), description: String(body.description ?? ""), modelSelection: selection });
                        if (access === "full")
                            workspace.setAccess(created.id, "full");
                        broadcast({ kind: "bot", bot: updated });
                        return json(res, 201, updated);
                    }
                    case "agent.update": {
                        requireFull();
                        const target = store.bot(String(body.botId ?? ""));
                        if (!target)
                            return json(res, 404, { error: "no such target bot" });
                        const updated = store.patchBot(target.id, { ...(body.patch ?? {}) });
                        broadcast({ kind: "bot", bot: updated });
                        return json(res, 200, updated);
                    }
                    case "groups.list": {
                        return json(res, 200, groupStore.list());
                    }
                    case "groups.delete": {
                        requireFull();
                        const id = String(body.groupId ?? "");
                        if (!groupStore.get(id))
                            return json(res, 404, { error: "no such group" });
                        const base = await ensureEngine();
                        const removed = await fetch(`${base}/api/groups/${encodeURIComponent(id)}`, { method: "DELETE" });
                        if (!removed.ok)
                            return json(res, removed.status, { error: "no such group" });
                        groupStore.delete(id);
                        broadcast({ kind: "group", deleted: id });
                        return json(res, 200, { ok: true });
                    }
                    case "device.info": return json(res, 200, await deviceInfo());
                    case "groups.create": {
                        requireFull();
                        const base = await ensureEngine();
                        const botIds = Array.isArray(body.bot_ids) ? body.bot_ids.map(String) : [];
                        const engineIds = botIds.map((id) => engineBotIdFor(store.bot(id)?.threadId ?? id));
                        for (const id of engineIds)
                            await fetch(`${base}/api/bots`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, name: store.botByThread(threadIdOfEngineBot(id) ?? "")?.name ?? id }) });
                        const created = await fetch(`${base}/api/groups`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: String(body.name ?? "Group"), bot_ids: engineIds }) });
                        const payload = await created.json();
                        if (!created.ok)
                            return json(res, created.status, payload);
                        return json(res, 201, groupStore.upsert({ id: String(payload.id), name: String(body.name ?? "Group"), bot_ids: engineIds }));
                    }
                    case "groups.send": {
                        requireFull();
                        const group = groupStore.get(String(body.groupId));
                        if (!group)
                            return json(res, 404, { error: "no such group" });
                        const message = String(body.message ?? "").trim();
                        if (!message)
                            return json(res, 422, { error: "message required" });
                        groupStore.append(group.id, { from: "you", text: message });
                        const turns = [];
                        for (const engineId of group.bot_ids) {
                            const bot = store.botByThread(threadIdOfEngineBot(engineId) ?? "");
                            if (!bot)
                                continue;
                            const reply = await askBotAndWait(bot.id, `[Group room] ${message}`, 0);
                            turns.push({ bot_id: bot.id, reply });
                            groupStore.append(group.id, { from: bot.id, text: reply });
                        }
                        return json(res, 200, { turns, owner: turns[0]?.bot_id ?? null, messages: groupStore.get(group.id)?.messages ?? [] });
                    }
                    case "file.read": {
                        const file = resolve(String(body.path ?? ""));
                        if (access !== "full" && file !== ROOT && !file.startsWith(`${ROOT}${sep}`)) {
                            return json(res, 403, { error: "read-only access is limited to current workspace" });
                        }
                        return json(res, 200, { path: file, content: readFileSync(file, "utf8") });
                    }
                    case "file.write": {
                        requireFull();
                        const file = resolve(String(body.path ?? ""));
                        mkdirSync(dirname(file), { recursive: true });
                        writeFileSync(file, String(body.content ?? ""));
                        return json(res, 200, { path: file, ok: true });
                    }
                    case "terminal.run": {
                        requireFull();
                        const command = String(body.command ?? "").trim();
                        const args = Array.isArray(body.args) ? body.args.map(String) : [];
                        if (!command)
                            return json(res, 422, { error: "command required" });
                        const result = await new Promise((resolveRun) => execFile(command, args, { cwd: String(body.cwd ?? ROOT), timeout: 120_000, maxBuffer: 2_000_000 }, (error, stdout, stderr) => resolveRun({ code: error ? error.code ?? 1 : 0, stdout, stderr })));
                        return json(res, 200, result);
                    }
                    default: return json(res, 404, { error: `unknown agent action: ${action}` });
                }
            }
            if (method === "POST" && path === "/api/internal/ask-bot") {
                const body = await readBody(req);
                const fromBotId = String(body.fromBotId ?? "");
                const toBotId = String(body.toBotId ?? "");
                const message = String(body.message ?? "").trim();
                // multibot (F9): głębokość bierzemy z WIĘKSZEJ z dwóch — deklaracji proxy
                // i tury, która u wołającego trwa. Proxy bota silnika deklaruje 0 na
                // zawsze (env zamrożony w profilu), więc bez mapy łańcuch nie miałby dna.
                const depth = chainDepth(body.depth, activeCommsDepth.get(fromBotId));
                if (!toBotId || !message)
                    return json(res, 400, { error: "toBotId and message required" });
                if (toBotId === fromBotId)
                    return json(res, 400, { error: "a bot cannot message itself" });
                const from = store.bot(fromBotId);
                if (!from)
                    return json(res, 404, { error: "no such caller bot" });
                if (workspace.permissions(fromBotId).delegation === false) {
                    return json(res, 403, { error: "bot-to-bot delegation is disabled for this bot" });
                }
                if (depth >= MAX_COMMS_DEPTH)
                    return json(res, 200, { error: "message chains are limited to one hop" });
                const target = store.bot(toBotId);
                if (!target)
                    return json(res, 404, { error: "no such bot" });
                if (target.busy)
                    return json(res, 200, { busy: true });
                // visibility: surface the cross-talk on the caller's own thread so
                // bot-to-bot turns are never invisible (they cost the user tokens)
                const fromName = from?.name ?? "another bot";
                if (from) {
                    const note = store.appendMessage(from.threadId, {
                        role: "bot",
                        kind: "activity",
                        tool: { name: `asked @${target.name}: ${message.slice(0, 80)}` },
                    });
                    broadcast({ kind: "message", threadId: from.threadId, message: note });
                }
                const prefixed = `[Message from @${fromName}, another bot in this MultiBot workspace. Reply to them.]\n\n${message}`;
                const reply = await askBotAndWait(toBotId, prefixed, depth);
                return json(res, 200, { botName: target.name, text: reply });
            }
            return json(res, 404, { error: "unknown internal endpoint" });
        }
        // ── events stream ──
        if (method === "GET" && path === "/api/events") {
            res.writeHead(200, {
                "content-type": "text/event-stream",
                "cache-control": "no-cache",
                connection: "keep-alive",
            });
            res.write(`data: ${JSON.stringify({ kind: "hello" })}\n\n`);
            sseClients.add(res);
            const keepalive = setInterval(() => {
                try {
                    res.write(": keepalive\n\n");
                }
                catch { }
            }, 25_000);
            req.on("close", () => {
                clearInterval(keepalive);
                sseClients.delete(res);
            });
            return;
        }
        // multibot: import profile and create matching harness bot in one request.
        // The engine identity is deterministic, so Memory/Routines/Skills resolve
        // to the copied profile immediately after import.
        if (method === "POST" && path === "/api/profiles/import") {
            const body = await readBody(req);
            const source = String(body.source ?? "").trim();
            const name = String(body.name ?? "").trim();
            if (!source)
                return json(res, 400, { error: "profile source required" });
            const bot = store.createBot();
            store.patchBot(bot.id, {
                ...(name ? { name } : {}),
                modelSelection: { instanceId: "local", model: "hermes-agent" },
            });
            try {
                const baseUrl = await ensureEngine();
                await importExistingEngineProfile(baseUrl, { source, id: name || "imported", name: name || "Imported profile" }, engineBotIdFor(bot.threadId));
            }
            catch (error) {
                store.deleteBot(bot.id);
                return json(res, 502, { error: error instanceof Error ? error.message : String(error) });
            }
            const created = { ...store.bot(bot.id), messages: store.messagesFor(bot.threadId) };
            broadcast({ kind: "bot", bot: created });
            return json(res, 201, { bot: created });
        }
        // ── bots ──
        if (method === "GET" && path === "/api/bots") {
            return json(res, 200, {
                bots: store.bots.map((b) => ({ ...b, messages: store.messagesFor(b.threadId) })),
            });
        }
        let m;
        // multibot: durable group rooms. Engine owns execution; harness owns the
        // user-facing roster and transcript so groups survive reload/restart.
        if (method === "GET" && path === "/api/groups") {
            const local = groupStore.list();
            if (local.length)
                return json(res, 200, local);
            try {
                const remote = await fetch(`${await ensureEngine()}/api/groups`);
                if (remote.ok) {
                    const groups = await remote.json();
                    for (const group of groups)
                        groupStore.upsert(group);
                }
            }
            catch { }
            return json(res, 200, groupStore.list());
        }
        if (method === "POST" && path === "/api/groups") {
            const body = await readBody(req);
            const name = String(body.name ?? "Group").trim();
            const rawIds = Array.isArray(body.bot_ids) ? body.bot_ids.map(String) : [];
            const botIds = rawIds.map((id) => store.bot(id)?.id ?? (id.startsWith("mb-") ? store.botByThread(id.slice(3))?.id : undefined)).filter((id) => !!id);
            if (!name || !botIds.length)
                return json(res, 422, { error: "group needs at least one bot" });
            try {
                const base = await ensureEngine();
                const engineIds = botIds.map((id) => engineBotIdFor(store.bot(id).threadId));
                for (const id of engineIds) {
                    const bot = store.botByThread(threadIdOfEngineBot(id) ?? "");
                    await fetch(`${base}/api/bots`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, name: bot?.name ?? id }) });
                }
                const created = await fetch(`${base}/api/groups`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, bot_ids: engineIds }) });
                const payload = await created.json().catch(() => ({}));
                if (!created.ok)
                    return json(res, created.status, payload);
                const group = groupStore.upsert({ id: String(payload.id), name, bot_ids: engineIds });
                broadcast({ kind: "group", group });
                return json(res, 201, group);
            }
            catch (error) {
                return json(res, 502, { error: error instanceof Error ? error.message : String(error) });
            }
        }
        m = path.match(/^\/api\/groups\/([\w-]+)$/);
        if (m && method === "GET") {
            const group = groupStore.get(m[1]);
            return group ? json(res, 200, group) : json(res, 404, { error: "no such group" });
        }
        if (m && method === "DELETE") {
            if (!groupStore.get(m[1]))
                return json(res, 404, { error: "no such group" });
            try {
                const base = await ensureEngine();
                const removed = await fetch(`${base}/api/groups/${encodeURIComponent(m[1])}`, { method: "DELETE" });
                if (!removed.ok)
                    return json(res, removed.status === 404 ? 404 : 502, { error: "no such group" });
                if (!groupStore.delete(m[1]))
                    return json(res, 404, { error: "no such group" });
                broadcast({ kind: "group", deleted: m[1] });
                return json(res, 200, { ok: true });
            }
            catch (error) {
                return json(res, 502, { error: error instanceof Error ? error.message : String(error) });
            }
        }
        // multibot: mixed-provider group rooms. Engine stores membership/shadow
        // ids; harness owns actual turns so Claude/Codex/ACP bots answer through
        // their selected provider instead of being silently replaced by engine.
        m = path.match(/^\/api\/groups\/([\w-]+)\/chat$/);
        if (m && method === "POST") {
            const body = await readBody(req);
            const message = String(body.message ?? "").trim();
            if (!message)
                return json(res, 422, { error: "message required" });
            try {
                const base = await ensureEngine();
                const groupResponse = await fetch(`${base}/api/groups/${encodeURIComponent(m[1])}`);
                if (!groupResponse.ok)
                    return json(res, groupResponse.status === 404 ? 404 : 502, { error: "no such group" });
                const group = await groupResponse.json();
                const durable = groupStore.get(m[1]) ?? groupStore.upsert({ id: m[1], name: String(group.name ?? "Group"), bot_ids: (group.bot_ids ?? []).map(String) });
                groupStore.append(m[1], { from: "you", text: message });
                const turns = [];
                for (const rawId of group.bot_ids ?? []) {
                    const engineId = String(rawId);
                    const threadId = engineId.startsWith("mb-") ? engineId.slice(3) : engineId;
                    const bot = store.botByThread(threadId);
                    if (!bot)
                        continue;
                    const reply = await askBotAndWait(bot.id, `[Group room] ${message}`, 0);
                    turns.push({ bot_id: bot.id, reply });
                    if (durable)
                        groupStore.append(m[1], { from: bot.id, text: reply });
                }
                const current = groupStore.get(m[1]);
                if (current)
                    broadcast({ kind: "group", group: current });
                return json(res, 200, { turns, owner: turns[0]?.bot_id ?? null, messages: current?.messages ?? [] });
            }
            catch (error) {
                return json(res, 502, { error: error instanceof Error ? error.message : String(error) });
            }
        }
        if (method === "POST" && path === "/api/bots") {
            const bot = store.createBot();
            store.patchBot(bot.id, { modelSelection: await defaultSelection() });
            return json(res, 201, { bot: { ...store.bot(bot.id), messages: store.messagesFor(bot.threadId) } });
        }
        m = path.match(/^\/api\/bots\/([\w-]+)$/);
        if (m && method === "PATCH") {
            const body = await readBody(req);
            const patch = {};
            for (const key of ["name", "title", "description", "notifications", "modelSelection", "unread", "computer", "color", "mascotExpression", "mascotShape", "pinned", "hidden"]) {
                if (body[key] !== undefined)
                    patch[key] = body[key];
            }
            const bot = store.patchBot(m[1], patch);
            if (!bot)
                return json(res, 404, { error: "no such bot" });
            if (body.computer === "playwright" || body.computer === "shared") {
                await configureEngineComputer(bot.threadId, body.computer === "shared" ? "shared" : "own").catch(() => { });
            }
            broadcast({ kind: "bot", bot });
            return json(res, 200, { bot });
        }
        m = path.match(/^\/api\/bots\/([\w-]+)$/);
        if (m && method === "DELETE") {
            const bot = store.bot(m[1]);
            if (!bot)
                return json(res, 404, { error: "no such bot" });
            // a running turn dies with its bot
            await registry.get(bot.modelSelection.instanceId)?.adapter.interruptTurn(bot.threadId).catch(() => { });
            stopScreenPoller(bot.id);
            harnessRoutines.deleteBot(bot.id);
            workspace.deleteBot(bot.id);
            store.deleteBot(bot.id);
            for (const dir of [EVENTS_DIR, NATIVE_DIR]) {
                try {
                    unlinkSync(join(dir, `${bot.threadId}.ndjson`));
                }
                catch { }
            }
            broadcast({ kind: "bot.deleted", botId: bot.id });
            return json(res, 200, { ok: true });
        }
        // onboarding/ask cards persist their answered/dismissed state
        m = path.match(/^\/api\/bots\/([\w-]+)\/cards\/([\w-]+)$/);
        if (m && method === "PATCH") {
            const bot = store.bot(m[1]);
            if (!bot)
                return json(res, 404, { error: "no such bot" });
            const existing = store.messagesFor(bot.threadId).find((msg) => msg.id === m[2]);
            if (!existing?.card)
                return json(res, 404, { error: "no such card" });
            const body = await readBody(req);
            const patched = store.patchMessage(bot.threadId, m[2], {
                card: {
                    ...existing.card,
                    ...(body.answered !== undefined ? { answered: body.answered } : {}),
                    ...(body.dismissed !== undefined ? { dismissed: body.dismissed } : {}),
                },
            });
            broadcast({ kind: "message.patch", threadId: bot.threadId, message: patched });
            return json(res, 200, { message: patched });
        }
        m = path.match(/^\/api\/bots\/([\w-]+)\/messages$/);
        if (m && method === "POST") {
            const body = await readBody(req);
            const text = String(body.text ?? "").trim();
            if (!text)
                return json(res, 400, { error: "text required" });
            const reasoning = isReasoningLevel(body.reasoning) ? body.reasoning : undefined;
            const modelReply = await handleModelCommand(store.bot(m[1]), text);
            if (modelReply !== null) {
                const bot = store.bot(m[1]);
                if (!bot)
                    return json(res, 404, { error: "no such bot" });
                const userMessage = store.appendMessage(bot.threadId, { role: "user", kind: "text", text });
                const botMessage = store.appendMessage(bot.threadId, { role: "bot", kind: "text", text: modelReply });
                broadcast({ kind: "message", threadId: bot.threadId, message: userMessage });
                broadcast({ kind: "message", threadId: bot.threadId, message: botMessage });
                return json(res, 200, { ok: true, command: "model" });
            }
            await startTurn(m[1], text, { reasoning });
            return json(res, 202, { ok: true });
        }
        m = path.match(/^\/api\/bots\/([\w-]+)\/respond$/);
        if (m && method === "POST") {
            const bot = store.bot(m[1]);
            if (!bot)
                return json(res, 404, { error: "no such bot" });
            const body = await readBody(req);
            const instance = registry.get(bot.modelSelection.instanceId);
            if (!instance)
                return json(res, 409, { error: "provider unavailable" });
            await instance.adapter.respondToRequest(bot.threadId, String(body.requestId), {
                behavior: body.behavior,
                message: body.message,
            });
            return json(res, 200, { ok: true });
        }
        m = path.match(/^\/api\/bots\/([\w-]+)\/interrupt$/);
        if (m && method === "POST") {
            const bot = store.bot(m[1]);
            if (!bot)
                return json(res, 404, { error: "no such bot" });
            const instance = registry.get(bot.modelSelection.instanceId);
            await instance?.adapter.interruptTurn(bot.threadId);
            return json(res, 200, { ok: true });
        }
        // ── multibot: provider-neutral workspace ───────────────────────────
        m = path.match(/^\/api\/bots\/([\w-]+)\/memory\/facts(?:\/([\w-]+))?$/);
        if (m) {
            if (!store.bot(m[1]))
                return json(res, 404, { error: "no such bot" });
            if (method === "GET" && !m[2])
                return json(res, 200, workspace.facts(m[1], url.searchParams.get("q") ?? ""));
            if (method === "POST" && !m[2]) {
                const body = await readBody(req);
                const fact = workspace.addFact(m[1], body);
                broadcast({ kind: "workspace", botId: m[1], resource: "memory" });
                return json(res, 201, fact);
            }
            if (method === "PATCH" && m[2]) {
                const body = await readBody(req);
                const fact = workspace.patchFact(m[1], m[2], body);
                if (fact)
                    broadcast({ kind: "workspace", botId: m[1], resource: "memory" });
                return fact ? json(res, 200, fact) : json(res, 404, { error: "no such fact" });
            }
            if (method === "DELETE" && m[2]) {
                const ok = workspace.deleteFact(m[1], m[2]);
                if (ok)
                    broadcast({ kind: "workspace", botId: m[1], resource: "memory" });
                return ok ? json(res, 200, { ok: true }) : json(res, 404, { error: "no such fact" });
            }
            return json(res, 405, { error: "method not allowed" });
        }
        m = path.match(/^\/api\/bots\/([\w-]+)\/memory\/markdown$/);
        if (m) {
            if (!store.bot(m[1]))
                return json(res, 404, { error: "no such bot" });
            if (method === "GET")
                return json(res, 200, workspace.markdown(m[1]));
            if (method === "PUT" || method === "PATCH") {
                const body = await readBody(req);
                const markdown = workspace.putMarkdown(m[1], body.content);
                broadcast({ kind: "workspace", botId: m[1], resource: "memory" });
                return json(res, 200, markdown);
            }
            return json(res, 405, { error: "method not allowed" });
        }
        m = path.match(/^\/api\/bots\/([\w-]+)\/memory\/graph$/);
        if (m && method === "GET") {
            if (!store.bot(m[1]))
                return json(res, 404, { error: "no such bot" });
            return json(res, 200, workspace.graph(m[1]));
        }
        m = path.match(/^\/api\/bots\/([\w-]+)\/skills(?:\/(.+))?$/);
        if (m) {
            if (!store.bot(m[1]))
                return json(res, 404, { error: "no such bot" });
            const name = m[2] ? decodeURIComponent(m[2]) : null;
            if (method === "GET" && !name)
                return json(res, 200, workspace.skills(m[1]));
            if (method === "POST" && !name) {
                const body = await readBody(req);
                const skill = workspace.addSkill(m[1], body);
                broadcast({ kind: "workspace", botId: m[1], resource: "skills" });
                return json(res, 201, skill);
            }
            if (method === "PATCH" && name) {
                const body = await readBody(req);
                const skill = workspace.patchSkill(m[1], name, body);
                if (skill)
                    broadcast({ kind: "workspace", botId: m[1], resource: "skills" });
                return skill ? json(res, 200, skill) : json(res, 404, { error: "no such skill" });
            }
            if (method === "DELETE" && name) {
                const ok = workspace.deleteSkill(m[1], name);
                if (ok)
                    broadcast({ kind: "workspace", botId: m[1], resource: "skills" });
                return ok ? json(res, 200, { ok: true }) : json(res, 404, { error: "no such skill" });
            }
            return json(res, 405, { error: "method not allowed" });
        }
        m = path.match(/^\/api\/bots\/([\w-]+)\/(access|autonomy|permissions|usage)$/);
        if (m) {
            if (!store.bot(m[1]))
                return json(res, 404, { error: "no such bot" });
            if (m[2] === "usage") {
                return method === "GET"
                    ? json(res, 200, workspace.usage(m[1]))
                    : json(res, 405, { error: "method not allowed" });
            }
            if (m[2] === "access") {
                if (method === "GET")
                    return json(res, 200, workspace.access(m[1]));
                if (method === "PATCH") {
                    const body = await readBody(req);
                    return json(res, 200, workspace.setAccess(m[1], body.access));
                }
            }
            if (m[2] === "autonomy") {
                if (method === "GET")
                    return json(res, 200, workspace.autonomy(m[1]));
                if (method === "PATCH") {
                    const body = await readBody(req);
                    return json(res, 200, workspace.setAutonomy(m[1], body.autonomy));
                }
            }
            else {
                if (method === "GET")
                    return json(res, 200, workspace.permissions(m[1]));
                if (method === "PATCH") {
                    const body = await readBody(req);
                    const patch = typeof body.toolset === "string" ? { [body.toolset]: body.enabled } : body;
                    return json(res, 200, workspace.setPermissions(m[1], patch));
                }
            }
            return json(res, 405, { error: "method not allowed" });
        }
        // ── multibot: driver-neutral routines ──────────────────────────────
        m = path.match(/^\/api\/bots\/([\w-]+)\/routines$/);
        if (m && method === "GET") {
            if (!store.bot(m[1]))
                return json(res, 404, { error: "no such bot" });
            return json(res, 200, harnessRoutines.list(m[1]).map((routine) => routineView(m[1], routine)));
        }
        if (m && method === "POST") {
            if (!store.bot(m[1]))
                return json(res, 404, { error: "no such bot" });
            const body = await readBody(req);
            try {
                const routine = harnessRoutines.create(m[1], {
                    name: body.name,
                    prompt: body.prompt,
                    schedule: body.schedule,
                });
                broadcast({ kind: "workspace", botId: m[1], resource: "routines" });
                return json(res, 201, routineView(m[1], routine));
            }
            catch (error) {
                return json(res, 422, { error: error instanceof Error ? error.message : String(error) });
            }
        }
        m = path.match(/^\/api\/bots\/([\w-]+)\/routines\/([\w-]+)$/);
        if (m && method === "PATCH") {
            if (!store.bot(m[1]))
                return json(res, 404, { error: "no such bot" });
            const body = await readBody(req);
            const patch = {};
            for (const key of ["name", "prompt", "schedule", "enabled"]) {
                if (body[key] !== undefined)
                    patch[key] = body[key];
            }
            try {
                const routine = harnessRoutines.update(m[1], m[2], patch);
                if (routine)
                    broadcast({ kind: "workspace", botId: m[1], resource: "routines" });
                return routine
                    ? json(res, 200, routineView(m[1], routine))
                    : json(res, 404, { error: "no such routine" });
            }
            catch (error) {
                return json(res, 422, { error: error instanceof Error ? error.message : String(error) });
            }
        }
        if (m && method === "DELETE") {
            const ok = harnessRoutines.delete(m[1], m[2]);
            if (ok)
                broadcast({ kind: "workspace", botId: m[1], resource: "routines" });
            return ok ? json(res, 200, { ok: true }) : json(res, 404, { error: "no such routine" });
        }
        m = path.match(/^\/api\/bots\/([\w-]+)\/routines\/([\w-]+)\/(run|webhook)$/);
        if (m && method === "POST") {
            if (!store.bot(m[1]))
                return json(res, 404, { error: "no such bot" });
            if (m[3] === "webhook") {
                return json(res, 409, {
                    error: "Webhook triggers remain available for engine-native routines; command-line routines support schedules and Run now.",
                });
            }
            const routine = await harnessRoutines.runNow(m[1], m[2]);
            if (!routine)
                return json(res, 404, { error: "no such routine" });
            const run = routine.last_runs[0];
            if (run?.status === "error")
                return json(res, 409, { error: run.error, routine: routineView(m[1], routine) });
            return json(res, 200, routineView(m[1], routine));
        }
        // identity handshake for the packaged app's port fallback: the forked
        // child proves it is OURS by echoing its pid (a stray dev server has
        // the same API shape but a different pid)
        if (method === "GET" && path === "/api/health") {
            return json(res, 200, {
                app: "openmausbot",
                pid: process.pid,
                static: Boolean(STATIC_DIR),
                service: process.env.OMB_SERVER_SERVICE === "1",
            });
        }
        // ── multibot (G2): authenticated token reveal/check/rotation ────────
        if (method === "GET" && path === "/api/auth/check") {
            return json(res, 200, { ok: true });
        }
        if (method === "GET" && path === "/api/auth/token") {
            res.setHeader("cache-control", "no-store");
            return json(res, 200, { token: cfg.auth.token });
        }
        if (method === "POST" && path === "/api/auth/token/rotate") {
            const token = rotateAccessToken(cfg);
            revokeAuthSessions(req.socket);
            res.setHeader("cache-control", "no-store");
            return json(res, 200, { token });
        }
        // ── provider instances (model picker) ──
        if (method === "GET" && path === "/api/instances") {
            return json(res, 200, { instances: await registry.describe() });
        }
        // ── multibot (G3): device scan + background setup progress ─────────
        if (method === "GET" && path === "/api/device") {
            return json(res, 200, await deviceInfo());
        }
        if (method === "POST" && path === "/api/provision") {
            const body = await readBody(req);
            // Packaged Electron passes its trusted absolute executable path. Only an
            // explicit onboarding 24/7 choice installs per-user autostart.
            if (body?.server === true && process.env.OMB_PACKAGED_EXE) {
                await registerWindowsServerAutostart(process.env.OMB_PACKAGED_EXE);
            }
            const job = provisionJob();
            return json(res, 202, { id: job.id, job });
        }
        m = path.match(/^\/api\/progress\/([\w-]+)$/);
        if (m && method === "GET") {
            const job = setupJobs.get(m[1]);
            if (!job)
                return json(res, 404, { error: "no such setup job" });
            res.writeHead(200, {
                "content-type": "text/event-stream",
                "cache-control": "no-cache",
                connection: "keep-alive",
            });
            const send = (next) => res.write(`data: ${JSON.stringify(jobProgress(next))}\n\n`);
            let unsubscribe = () => { };
            const keepalive = setInterval(() => res.write(": keepalive\n\n"), 25_000);
            let ended = false;
            const cleanup = () => {
                if (ended)
                    return;
                ended = true;
                clearInterval(keepalive);
                unsubscribe();
            };
            unsubscribe = setupJobs.subscribe(job.id, (next) => {
                if (ended)
                    return;
                send(next);
                if (next.status !== "running") {
                    cleanup();
                    res.end();
                }
            });
            req.on("close", cleanup);
            // Subscribe before re-reading: a fast installer can otherwise finish
            // between the initial GET and listener registration, leaving SSE open.
            const current = setupJobs.get(job.id);
            send(current);
            if (current.status !== "running") {
                cleanup();
                return res.end();
            }
            return;
        }
        // ── multibot (G1): named custom models + persistent CLI allow switches ──
        if (method === "GET" && path === "/api/models/custom") {
            return json(res, 200, { models: customModelsStatus() });
        }
        m = path.match(/^\/api\/models\/custom\/([a-z0-9-]+)$/);
        if (m && method === "PUT") {
            const id = m[1];
            const body = await readBody(req);
            const displayName = typeof body.displayName === "string" ? body.displayName.trim() : "";
            const baseUrl = typeof body.baseUrl === "string" ? body.baseUrl.trim().replace(/\/$/, "") : "";
            const model = typeof body.model === "string" ? body.model.trim() : "";
            if (!/^[a-z0-9](?:[a-z0-9-]{0,62})$/.test(id))
                return json(res, 400, { error: "invalid model id" });
            if (RESERVED_INSTANCE_IDS.has(id))
                return json(res, 409, { error: "reserved model id" });
            if (!displayName || displayName.length > 80)
                return json(res, 400, { error: "displayName required (max 80)" });
            if (!validBaseUrl(baseUrl))
                return json(res, 400, { error: "baseUrl must be an http(s) URL without credentials" });
            if (!model || model.length > 200)
                return json(res, 400, { error: "model required (max 200)" });
            if (body.apiKey !== undefined && typeof body.apiKey !== "string") {
                return json(res, 400, { error: "apiKey must be a string" });
            }
            const existing = cfg.instances?.[id];
            if (existing && existing.driver !== "slafy")
                return json(res, 409, { error: "instance id already used" });
            const apiKey = body.apiKey === undefined ? existing?.environment?.OPENAI_API_KEY : body.apiKey.trim();
            const environment = {
                ...(existing?.environment ?? {}),
                ...(apiKey ? { OPENAI_API_KEY: apiKey } : {}),
            };
            if (!apiKey)
                delete environment.OPENAI_API_KEY;
            const instances = {
                ...(cfg.instances ?? {}),
                [id]: {
                    driver: "slafy",
                    displayName,
                    environment,
                    model: { default: model, baseUrl },
                },
            };
            saveConfig({ instances });
            Object.assign(cfg, loadConfig());
            await reloadProviders();
            const saved = customModelsStatus().find((item) => item.id === id);
            broadcast({ kind: "config", ...configStatus() });
            return json(res, 200, { model: saved });
        }
        if (m && method === "DELETE") {
            const existing = cfg.instances?.[m[1]];
            if (!existing || existing.driver !== "slafy" || RESERVED_INSTANCE_IDS.has(m[1])) {
                return json(res, 404, { error: "no such custom model" });
            }
            const instances = { ...(cfg.instances ?? {}) };
            delete instances[m[1]];
            saveConfig({ instances });
            Object.assign(cfg, loadConfig());
            await reloadProviders();
            broadcast({ kind: "config", ...configStatus() });
            return json(res, 200, { ok: true });
        }
        if (method === "GET" && path === "/api/cli-tools") {
            return json(res, 200, { tools: await cliToolsStatus() });
        }
        m = path.match(/^\/api\/cli-tools\/([a-z0-9-]+)\/login$/);
        if (m && method === "POST") {
            const toolId = m[1];
            const tool = CLI_TOOLS.find((item) => item.id === toolId);
            if (!tool)
                return json(res, 404, { error: "no such command-line tool" });
            if (!tool.login)
                return json(res, 409, { error: "interactive login unavailable; use official CLI instructions" });
            const temp = join(DATA_DIR, "tmp");
            mkdirSync(temp, { recursive: true });
            const job = setupJobs.startInteractive({
                key: `cli-login:${tool.id}`,
                kind: "cli-login",
                title: `Sign in ${tool.displayName}`,
                command: tool.login.command,
                args: tool.login.args,
                cwd: DATA_DIR,
                env: { TMP: temp, TEMP: temp },
            });
            return json(res, 202, { id: job.id, job });
        }
        m = path.match(/^\/api\/progress\/([\w-]+)\/(input|stop)$/);
        if (m && method === "POST") {
            const job = setupJobs.get(m[1]);
            if (!job)
                return json(res, 404, { error: "no such setup job" });
            if (job.kind !== "cli-login")
                return json(res, 409, { error: "job does not accept interactive input" });
            if (m[2] === "stop")
                return json(res, setupJobs.stop(m[1]) ? 200 : 409, { ok: true });
            const body = await readBody(req);
            if (typeof body.text !== "string")
                return json(res, 400, { error: "text required" });
            return json(res, setupJobs.input(m[1], body.text) ? 200 : 409, { ok: true });
        }
        m = path.match(/^\/api\/cli-tools\/([a-z0-9-]+)\/install$/);
        if (m && method === "POST") {
            const toolId = m[1];
            const tool = CLI_TOOLS.find((item) => item.id === toolId);
            if (!tool)
                return json(res, 404, { error: "no such command-line tool" });
            const install = cliInstallSpec(tool);
            if (!install)
                return json(res, 409, { error: "automatic install unavailable; use official CLI instructions" });
            const temp = join(DATA_DIR, "tmp");
            mkdirSync(temp, { recursive: true });
            const job = setupJobs.start({
                key: `cli-install:${tool.id}`,
                kind: "cli-install",
                title: `Install ${tool.displayName}`,
                command: install.command,
                args: install.args,
                cwd: DATA_DIR,
                env: { TMP: temp, TEMP: temp, ELECTRON_RUN_AS_NODE: "1" },
            });
            return json(res, 202, { id: job.id, job });
        }
        m = path.match(/^\/api\/cli-tools\/([a-z0-9-]+)$/);
        if (m && method === "PUT") {
            if (!BUILT_IN_CLI_IDS.includes(m[1])) {
                return json(res, 404, { error: "no such command-line tool" });
            }
            const body = await readBody(req);
            if (typeof body.enabled !== "boolean")
                return json(res, 400, { error: "enabled must be boolean" });
            const id = m[1];
            const instances = {
                ...(cfg.instances ?? {}),
                [id]: { ...DEFAULT_INSTANCE_CONFIGS[id], ...(cfg.instances?.[id] ?? {}), enabled: body.enabled },
            };
            saveConfig({ instances });
            Object.assign(cfg, loadConfig());
            await reloadProviders();
            const tool = (await cliToolsStatus()).find((item) => item.id === id);
            broadcast({ kind: "config", ...configStatus() });
            return json(res, 200, { tool });
        }
        // ── app config (API keys — never echoed back, booleans only) ──
        if (method === "GET" && path === "/api/config") {
            return json(res, 200, configStatus());
        }
        if ((method === "PUT" || method === "PATCH") && path === "/api/config") {
            const body = await readBody(req);
            const patch = {};
            for (const key of ["xai", "composio", "box", "profile"]) {
                if (body[key] && typeof body[key] === "object")
                    patch[key] = body[key];
            }
            if (!Object.keys(patch).length)
                return json(res, 400, { error: "nothing to save" });
            saveConfig(patch);
            Object.assign(cfg, loadConfig());
            // provider keys change the fleet; a profile edit must not kill
            // in-flight turns with a pointless reload
            if (Object.keys(patch).some((k) => k !== "profile"))
                await reloadProviders();
            const status = configStatus();
            broadcast({ kind: "config", ...status });
            return json(res, 200, status);
        }
        // ── connectors (Composio) ──
        if (method === "GET" && path === "/api/connectors/catalog") {
            const { cards, source } = await composio.listToolkits(cfg);
            // multibot (F7): własne serwery MCP użytkownika doklejone do katalogu
            // Composio; `source` per karta mówi UI, którą trasą je odłączyć.
            const tagged = [
                ...cards.map((c) => ({ ...c, source: "composio" })),
                ...mcpConnectors.connectorCards(cfg).map((c) => ({ ...c, source: "custom" })),
            ];
            return json(res, 200, { configured: Boolean(cfg.composio?.key), source, cards: tagged });
        }
        // multibot (F7): rejestr własnych konektorów. Osobna ścieżka `/custom/`,
        // żeby nie mieszać się z `DELETE /api/connectors/:slug` Composio.
        m = path.match(/^\/api\/connectors\/custom\/([\w-]+)$/);
        if (m && (method === "PUT" || method === "POST")) {
            const body = await readBody(req);
            try {
                const connector = mcpConnectors.saveConnector(m[1], body);
                Object.assign(cfg, loadConfig());
                return json(res, 200, { connector });
            }
            catch (e) {
                return json(res, 400, { error: e instanceof Error ? e.message : String(e) });
            }
        }
        if (m && method === "DELETE") {
            mcpConnectors.removeConnector(m[1]);
            Object.assign(cfg, loadConfig());
            return json(res, 200, { ok: true });
        }
        if (method === "GET" && path === "/api/connectors") {
            const services = (url.searchParams.get("services") ?? "").split(",").filter(Boolean);
            if (!cfg.composio?.key)
                return json(res, 200, { configured: false, services: {} });
            const status = await composio.connectionStatus(cfg, services.length ? services : composio.CURATED_SLUGS);
            return json(res, 200, { configured: true, services: status });
        }
        m = path.match(/^\/api\/connectors\/([\w-]+)\/authorize$/);
        if (m && method === "POST")
            return json(res, 200, await composio.authorizeService(cfg, m[1]));
        m = path.match(/^\/api\/connectors\/([\w-]+)$/);
        if (m && method === "DELETE")
            return json(res, 200, await composio.removeService(cfg, m[1]));
        // ── the bot's cloud computer (Box) ──
        m = path.match(/^\/api\/bots\/([\w-]+)\/computer$/);
        if (m && method === "GET")
            return json(res, 200, await box.boxStatus(cfg, m[1]));
        m = path.match(/^\/api\/bots\/([\w-]+)\/computer\/(provision|join|sleep|exec|screenshot)$/);
        if (m && method === "POST") {
            const botId = m[1];
            const bot = store.bot(botId);
            if (!bot)
                return json(res, 404, { error: "no such bot" });
            switch (m[2]) {
                case "provision":
                    return json(res, 200, await box.provisionBox(cfg, botId, bot.name));
                case "join":
                    return json(res, 200, await box.joinBox(cfg, botId));
                case "sleep":
                    return json(res, 200, await box.sleepBox(cfg, botId));
                case "exec": {
                    const body = await readBody(req);
                    return json(res, 200, await box.execOnBox(cfg, botId, String(body.command ?? "")));
                }
                case "screenshot":
                    return json(res, 200, await box.screenshotBox(cfg, botId));
            }
        }
        // packaged app: the server serves the built UI too (window → :8799 for
        // everything, no dev proxy to die). OMB_STATIC_DIR is set by Electron.
        if ((method === "GET" || method === "HEAD") && !path.startsWith("/api/") && STATIC_DIR) {
            const root = resolve(STATIC_DIR);
            const requested = path === "/" ? "index.html" : decodeURIComponent(path).replace(/^[/\\]+/, "");
            const file = resolve(root, requested);
            if (file !== root && !file.startsWith(root + sep))
                return json(res, 404, { error: "not found" });
            try {
                const data = readFileSync(file);
                res.writeHead(200, staticHeaders(file));
                return res.end(method === "HEAD" ? undefined : data);
            }
            catch {
                // SPA fallback
                try {
                    const data = readFileSync(join(STATIC_DIR, "index.html"));
                    res.writeHead(200, staticHeaders(join(STATIC_DIR, "index.html")));
                    return res.end(method === "HEAD" ? undefined : data);
                }
                catch {
                    /* fall through to 404 */
                }
            }
        }
        return json(res, 404, { error: `no route: ${method} ${path}` });
    }
    catch (e) {
        const status = e?.status ?? 500;
        return json(res, status, { error: e instanceof Error ? e.message : String(e) });
    }
});
// ── multibot: silnik — generyczny proxy `/api/engine/*` + pipe WS ──────
// Wszystkie trasy silnika (łącznie z przelotką BYOK z F2, pod tym samym URL-em)
// obsługuje `server/engine/proxy.ts`; montuje się opakowaniem listenera, więc
// handler wyżej zostaje nietknięty.
mountEngineProxy(server);
// Auth mounts after the proxy so one wrapper covers harness HTTP, proxied
// engine HTTP, and both engine WS upgrade paths.
let revokeAuthSessions = (_except) => { };
revokeAuthSessions = mountAuth(server, () => cfg.auth.token).revokeSessions;
// ── multibot: uwaga bota silnika (D7) ─────────────────────────────────
// Silnik ogłasza `attention` po WS (bot czeka na login/captcha/odpowiedź);
// harness zamienia to na `needsAttention` w store i rozsyła jak każdą inną
// zmianę bota. Gaśnie przy następnej turze usera — patrz `startTurn`.
watchEngineAttention({
    engineBotIds: () => store.bots.map((b) => engineBotIdFor(b.threadId)),
    onAttention: (engineBotId, reason) => {
        const threadId = threadIdOfEngineBot(engineBotId);
        const bot = threadId ? store.botByThread(threadId) : null;
        if (!bot || (bot.needsAttention ?? null) === reason)
            return;
        store.patchBot(bot.id, { needsAttention: reason });
        broadcast({ kind: "bot", bot: store.bot(bot.id) });
    },
});
server.listen(PORT, HOST, () => {
    console.log(`openmausbot server on http://${HOST}:${PORT}`);
    if (access.created)
        console.log(`[multibot] access token (shown once): ${access.token}`);
});
for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
        harnessRoutines.stop();
        // taskkill /T is asynchronous on Windows. Exiting immediately abandoned
        // CLI children (and kept their profile files locked), so give it one
        // short reap window after all adapters requested disposal.
        void registry.disposeAll().finally(() => setTimeout(() => process.exit(0), process.platform === "win32" ? 500 : 0));
    });
}
