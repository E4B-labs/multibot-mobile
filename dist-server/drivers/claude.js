// Claude driver — upstream ClaudeDriver skeleton over agentcal's
// drivers/claude.js runtime (stream-json both directions, prompt over
// stdin, completion from a real `result` event — verified against
// claude 2.1.211 by agentcal). Per-turn CLI process; the conversation
// continues across turns via --resume <sessionId> (the resumeCursor).
//
// Integrations become MCP servers on the CLI:
//   - Composio Connect (connected apps → tools) over streamable HTTP
//   - the bot's cloud computer (box.ascii.dev) via server/computer-proxy.ts
//     — screenshot/exec/open_url, the CUA-on-the-box bridge
import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { existsSync, unlinkSync } from "node:fs";
import { createServer as createNetServer } from "node:net";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DATA_DIR } from "../config.js";
import { augmentedPath, resolveCliSpawn } from "../env-path.js";
// multibot (F7): wspólny montaż mcpServers (Composio + własne konektory).
import { mcpServers as buildMcpServers } from "../mcp-servers.js";
import { killTree } from "../kill-tree.js";
import { autoApproveAllowed, canUseIntegration, toolAllowed, turnPolicy } from "../turn-policy.js";
import { newEventId, newId } from "../contracts.js";
import { appendNative } from "./native.js";
const DRIVER_KIND = "claudeAgent";
// model catalog ported from upstream packages/contracts/src/model.ts
const MODELS = {
    default: "sonnet",
    options: [
        { id: "sonnet", label: "Claude Sonnet (latest)" },
        { id: "opus", label: "Claude Opus (latest)" },
        { id: "haiku", label: "Claude Haiku (latest)" },
    ],
};
// Claude Code resolves aliases to currently available Anthropic models. Older
// Multibot profiles stored fictional/version-pinned IDs; keep them usable but
// never send unsupported IDs to the official CLI.
const normalizeModel = (model) => {
    if (!model)
        return MODELS.default;
    if (model === "fable" || model.startsWith("claude-fable-"))
        return "sonnet";
    if (model.startsWith("claude-opus-"))
        return "opus";
    if (model.startsWith("claude-sonnet-") || model === "claude-sonnet-5")
        return "sonnet";
    if (model.startsWith("claude-haiku-") || model === "claude-haiku-4-5")
        return "haiku";
    return model;
};
// proxy entry files live next to this one as .ts in dev (node type
// stripping) and .js in the compiled dist-server the packaged app ships
const proxyPath = (basename) => {
    const ts = join(dirname(fileURLToPath(import.meta.url)), "..", `${basename}.ts`);
    return existsSync(ts) ? ts : ts.replace(/\.ts$/, ".js");
};
const PROXY_PATH = proxyPath("computer-proxy");
const PERM_PROXY_PATH = proxyPath("permission-proxy");
// in the packaged app process.execPath is the Electron binary — this env
// makes it behave as plain node for the spawned MCP proxies (harmless in dev)
const NODE_ENV_FLAG = { ELECTRON_RUN_AS_NODE: "1" };
const DENY_TIMEOUT_NOTE = "OpenMausBot: nobody answered this permission request in time. Skip this action and finish what you can without it.";
const QUESTION_TIMEOUT_NOTE = "OpenMausBot: nobody answered in time. Use your best judgment and continue.";
/** One human-readable line for an ask — what the card subtitle shows. */
function askSummary(ask) {
    const input = ask.input ?? {};
    if (typeof input.question === "string")
        return input.question.slice(0, 300);
    if (typeof input.command === "string")
        return input.command.slice(0, 200);
    if (typeof input.url === "string")
        return input.url.slice(0, 200);
    const text = JSON.stringify(input);
    return text === "{}" ? (ask.tool ?? "tool") : text.slice(0, 200);
}
export function permissionSocketPath(threadId) {
    const tag = threadId.replace(/[^\w-]/g, "").slice(0, 8);
    // multibot: Windows has no unix sockets — net.createServer binds a named
    // pipe instead, same API on both ends. The pipe namespace is global and
    // flat (DATA_DIR does not isolate it), so the pid keeps concurrent
    // harnesses off each other's names.
    if (process.platform === "win32")
        return `\\\\.\\pipe\\omb-perm-${process.pid}-${tag}`;
    return join(DATA_DIR, `perm-${tag}.sock`);
}
function createPermissionBroker(opts) {
    const timeoutMs = opts.timeoutMs ?? 15 * 60_000;
    const pending = new Map();
    try {
        unlinkSync(opts.socketPath);
    }
    catch { }
    const server = createNetServer((conn) => {
        conn.on("error", () => { });
        let buf = "";
        conn.on("data", (chunk) => {
            buf += chunk;
            let nl;
            while ((nl = buf.indexOf("\n")) !== -1) {
                const line = buf.slice(0, nl);
                buf = buf.slice(nl + 1);
                let msg;
                try {
                    msg = JSON.parse(line);
                }
                catch {
                    continue;
                }
                if (msg.t !== "ask")
                    continue;
                const askId = String(msg.id ?? newId());
                const kind = msg.kind === "question" ? "question" : "permission";
                const ask = { id: askId, kind, tool: msg.tool ?? "tool", input: msg.input ?? {}, at: Date.now() };
                const finish = (behavior, message, source) => {
                    if (!pending.delete(askId))
                        return;
                    clearTimeout(timer);
                    try {
                        conn.write(JSON.stringify({ t: "answer", id: askId, behavior, message }) + "\n");
                    }
                    catch { }
                    opts.onResolve({ ...ask, behavior, source });
                };
                const timer = setTimeout(() => kind === "question"
                    ? finish("answer", QUESTION_TIMEOUT_NOTE, "timeout")
                    : finish("deny", DENY_TIMEOUT_NOTE, "timeout"), timeoutMs);
                timer.unref?.();
                pending.set(askId, { ask, finish });
                opts.onAsk(ask);
            }
        });
    });
    // multibot: a broker that never came up used to be silent — every
    // approval then timed out into a deny nobody could explain. Say so.
    server.on("error", (e) => {
        console.error(`permission broker unavailable on ${opts.socketPath}: ${e.message}`);
    });
    server.listen(opts.socketPath);
    return {
        answer(askId, behavior, message) {
            const p = pending.get(askId);
            if (!p)
                return false;
            const valid = p.ask.kind === "question" ? ["answer"] : ["allow", "deny"];
            if (!valid.includes(behavior))
                return false;
            p.finish(behavior, message, "user");
            return true;
        },
        close() {
            for (const p of [...pending.values()]) {
                if (p.ask.kind === "question")
                    p.finish("answer", "OpenMausBot: the turn is ending — wrap up.", "shutdown");
                else
                    p.finish("deny", "OpenMausBot: the turn ended", "shutdown");
            }
            try {
                server.close();
            }
            catch { }
            try {
                unlinkSync(opts.socketPath);
            }
            catch { }
        },
    };
}
function decodeConfig(raw) {
    const o = (raw ?? {});
    const mode = o.permissionMode;
    if (mode !== undefined && mode !== "acceptEdits" && mode !== "auto" && mode !== "bypassPermissions") {
        throw new Error(`claude: invalid permissionMode ${JSON.stringify(mode)}`);
    }
    return {
        cli: typeof o.cli === "string" ? o.cli : "claude",
        permissionMode: mode ?? "acceptEdits",
    };
}
function firstText(content) {
    if (typeof content === "string")
        return content;
    if (Array.isArray(content)) {
        return content
            .filter((b) => b?.type === "text" && b.text)
            .map((b) => b.text)
            .join("");
    }
    return "";
}
export const ClaudeDriver = {
    driverKind: DRIVER_KIND,
    metadata: { displayName: "Claude", supportsMultipleInstances: true },
    models: MODELS,
    decodeConfig,
    defaultConfig: () => decodeConfig({}),
    async create(input) {
        const { instanceId, config } = input;
        const listeners = new Set();
        // one active turn per thread; a second send while busy is a caller bug
        const active = new Map();
        const emit = (event) => {
            for (const l of [...listeners])
                l(event);
        };
        const base = (threadId, turnId) => ({
            eventId: newEventId(),
            provider: DRIVER_KIND,
            threadId,
            turnId,
            createdAt: new Date().toISOString(),
        });
        const sendTurn = async (turn) => {
            const { threadId } = turn;
            if (active.has(threadId))
                throw new Error("a turn is already running on this thread");
            const policy = turnPolicy(threadId);
            const turnId = newId();
            const sessionId = typeof turn.resumeCursor === "string" ? turn.resumeCursor : null;
            const newSessionId = sessionId ? null : newId();
            const args = [
                "-p",
                "--output-format", "stream-json",
                "--input-format", "stream-json",
                "--verbose", // required by stream-json output
                // token-level streaming: content_block_delta events between the
                // whole-message frames, so the bubble grows as the model writes
                "--include-partial-messages",
                // Short chat turns should not inherit Claude Code's high default
                // reasoning effort; lower effort reduces latency and token burn.
                "--effort", "low",
                "--permission-mode", policy ? "default" : config.permissionMode === "auto" ? "acceptEdits" : config.permissionMode,
            ];
            if (sessionId)
                args.push("--resume", sessionId);
            else
                args.push("--session-id", newSessionId);
            args.push("--model", normalizeModel(turn.model));
            if (turn.system)
                args.push("--append-system-prompt", turn.system);
            // integrations → MCP servers; pre-allow their tools (a headless
            // acceptEdits run silently denies anything unlisted)
            // multibot (F7): Composio i własne konektory użytkownika montuje wspólny
            // helper — ten sam, z którego korzystają pozostałe drivery.
            const mcpServers = buildMcpServers(turn.integrations, undefined, canUseIntegration(threadId, "integrations"));
            const allowed = Object.keys(mcpServers).map((name) => `mcp__${name}`);
            if (turn.integrations?.computer) {
                mcpServers.computer = {
                    command: process.execPath,
                    args: [PROXY_PATH],
                    env: {
                        ...NODE_ENV_FLAG,
                        OGB_BOX_ID: turn.integrations.computer.boxId,
                        OGB_BOX_TOKEN: turn.integrations.computer.token,
                    },
                };
                allowed.push("mcp__computer");
            }
            else if (turn.integrations?.localComputer) {
                // this Mac, via the Electron-owned cua-driver daemon (spawn config
                // read from cua-connection.json — same "computer" name either way,
                // the agent just sees a computer)
                mcpServers.computer = { ...turn.integrations.localComputer };
                allowed.push("mcp__computer");
            }
            // peer-agent comms (list_bots/ask_bot) — the harness builds the whole
            // spawn contract (command/args/env incl. the boot token) in
            // agentsIntegration(); pre-allowing matters doubly here, or the CLI's
            // own ListAgents look-alike shadows it and "@Bot" asks go nowhere
            if (turn.integrations?.agents) {
                mcpServers.agents = { ...turn.integrations.agents };
                allowed.push("mcp__agents");
            }
            // permission broker: anything acceptEdits would silently deny becomes
            // an Allow/Deny card in chat, and the agent gets ask_user. Skipped in
            // bypassPermissions (fullAuto) — nothing would ever ask.
            let broker;
            if (policy || config.permissionMode !== "bypassPermissions") {
                const socketPath = permissionSocketPath(threadId);
                broker = createPermissionBroker({
                    socketPath,
                    onAsk: (ask) => {
                        if (ask.kind === "permission" && !toolAllowed(threadId, ask.tool)) {
                            queueMicrotask(() => broker?.answer(ask.id, "deny", `${ask.tool} blocked by bot permissions`));
                            return;
                        }
                        if (ask.kind === "permission" && autoApproveAllowed(threadId, ask.tool)) {
                            queueMicrotask(() => broker?.answer(ask.id, "allow"));
                            return;
                        }
                        emit({
                            ...base(threadId, turnId),
                            type: "request.opened",
                            requestId: ask.id,
                            requestType: ask.kind,
                            tool: ask.tool,
                            summary: askSummary(ask),
                            choices: Array.isArray(ask.input?.choices) ? ask.input.choices.slice(0, 5) : undefined,
                        });
                    },
                    onResolve: (resolved) => emit({
                        ...base(threadId, turnId),
                        type: "request.resolved",
                        requestId: resolved.id,
                        behavior: resolved.behavior,
                        source: resolved.source,
                    }),
                });
                args.push("--permission-prompt-tool", "mcp__ogb__approve");
                mcpServers.ogb = { command: process.execPath, args: [PERM_PROXY_PATH, socketPath], env: { ...NODE_ENV_FLAG } };
                allowed.push("mcp__ogb");
            }
            if (policy) {
                const denied = [
                    ...(policy.permissions.terminal === false ? ["Bash"] : []),
                    ...(policy.permissions.file === false ? ["Read", "Edit", "Write", "NotebookEdit", "Glob", "Grep"] : []),
                    ...(policy.permissions.browser === false ? ["WebFetch", "WebSearch"] : []),
                ];
                if (denied.length)
                    args.push("--disallowedTools", denied.join(","));
            }
            if (Object.keys(mcpServers).length) {
                args.push("--mcp-config", JSON.stringify({ mcpServers }));
                args.push("--allowedTools", allowed.join(","));
            }
            const env = { ...process.env, PATH: augmentedPath(), NPM_CONFIG_LOGLEVEL: "error" };
            // subscription users get billed pay-as-you-go if this leaks through;
            // and a nested CLI must not inherit this session's identity (agentcal)
            delete env.ANTHROPIC_API_KEY;
            delete env.CLAUDECODE;
            delete env.CLAUDE_CODE_ENTRYPOINT;
            // multibot: resolve npm shims / shebang scripts to a real spawn
            const cli = resolveCliSpawn(config.cli, args);
            const child = spawn(cli.command, cli.args, {
                cwd: turn.cwd ?? homedir(),
                env,
                stdio: ["pipe", "pipe", "pipe"],
                windowsVerbatimArguments: cli.windowsVerbatimArguments,
                detached: true, // own process group, so killTree reaps child MCP servers (-pid on POSIX, taskkill /T on win32)
            });
            let settled = false;
            const settle = (ok, stopReason, cost = null) => {
                if (settled)
                    return;
                settled = true;
                broker?.close();
                active.delete(threadId);
                emit({ ...base(threadId, turnId), type: "turn.completed", ok, stopReason, cost });
            };
            // token streaming: true while --include-partial-messages is delivering
            // text deltas for the current assistant message, so the whole-message
            // frame that follows doesn't re-emit the same text as one big delta
            let sawStreamDelta = false;
            const handleLine = (line) => {
                let o;
                try {
                    o = JSON.parse(line);
                }
                catch {
                    return;
                }
                appendNative(threadId, { dir: "in", source: "claude.sdk.message", msg: o });
                switch (o.type) {
                    case "system":
                        if (o.subtype === "init") {
                            emit({ ...base(threadId, turnId), type: "session.started", sessionId: o.session_id, model: o.model });
                        }
                        else if (o.subtype === "thinking_tokens") {
                            emit({ ...base(threadId, turnId), type: "item.updated", itemType: "reasoning", tokens: o.estimated_tokens });
                        }
                        break;
                    case "stream_event": {
                        // subagent narration is dropped — N parallel Tasks would
                        // interleave their prose into one bubble (upstream-verified bug)
                        if (o.parent_tool_use_id)
                            break;
                        const ev = o.event ?? {};
                        if (ev.type !== "content_block_delta")
                            break;
                        const d = ev.delta ?? {};
                        if (d.type === "text_delta" && typeof d.text === "string" && d.text) {
                            sawStreamDelta = true;
                            emit({ ...base(threadId, turnId), type: "content.delta", streamKind: "assistant_text", delta: d.text });
                        }
                        else if (d.type === "thinking_delta" && typeof d.thinking === "string" && d.thinking) {
                            emit({ ...base(threadId, turnId), type: "content.delta", streamKind: "reasoning_text", delta: d.thinking });
                        }
                        break;
                    }
                    case "assistant": {
                        const msg = o.message ?? {};
                        const text = firstText(msg.content);
                        if (text.trim()) {
                            // fallback delta for CLIs/paths that never streamed the block
                            if (!sawStreamDelta) {
                                emit({ ...base(threadId, turnId), type: "content.delta", streamKind: "assistant_text", delta: text });
                            }
                            sawStreamDelta = false;
                            emit({ ...base(threadId, turnId), type: "item.completed", itemType: "assistant_text", text });
                        }
                        for (const b of Array.isArray(msg.content) ? msg.content : []) {
                            if (b.type === "tool_use") {
                                emit({ ...base(threadId, turnId), type: "item.started", itemType: "tool", itemId: b.id, title: b.name });
                            }
                        }
                        if (msg.usage) {
                            emit({
                                ...base(threadId, turnId),
                                type: "thread.token-usage.updated",
                                input: (msg.usage.input_tokens || 0) + (msg.usage.cache_read_input_tokens || 0),
                                output: msg.usage.output_tokens || 0,
                            });
                        }
                        break;
                    }
                    case "user":
                        for (const b of Array.isArray(o.message?.content) ? o.message.content : []) {
                            if (b.type === "tool_result") {
                                emit({ ...base(threadId, turnId), type: "item.completed", itemType: "tool", itemId: b.tool_use_id, ok: !b.is_error });
                            }
                        }
                        break;
                    case "result":
                        settle(o.is_error !== true, o.stop_reason ?? o.terminal_reason ?? null, o.total_cost_usd ?? null);
                        break;
                }
            };
            let buf = "";
            child.stdout.on("data", (chunk) => {
                buf += chunk;
                let nl;
                while ((nl = buf.indexOf("\n")) !== -1) {
                    const line = buf.slice(0, nl);
                    buf = buf.slice(nl + 1);
                    if (line.trim())
                        handleLine(line);
                }
            });
            let stderr = "";
            child.stderr.on("data", (c) => {
                stderr += c;
                if (stderr.length > 8192)
                    stderr = stderr.slice(-8192);
            });
            child.on("error", (e) => {
                emit({ ...base(threadId, turnId), type: "runtime.error", message: `spawn failed: ${e.message}` });
                settle(false, "spawn_error");
            });
            child.on("close", (code) => {
                if (!settled) {
                    emit({
                        ...base(threadId, turnId),
                        type: "runtime.error",
                        message: `claude exited ${code} before result${stderr ? `: ${stderr.trim().slice(-300)}` : ""}`,
                    });
                    settle(false, "exit_before_result");
                }
            });
            const stop = () => killTree(child); // multibot: process groups are POSIX-only
            active.set(threadId, { stop, turnId, broker });
            emit({ ...base(threadId, turnId), type: "turn.started" });
            // prompt over stdin as a stream-json message — never argv (ARG_MAX)
            const promptMsg = { type: "user", message: { role: "user", content: turn.text } };
            child.stdin.write(JSON.stringify(promptMsg) + "\n");
            child.stdin.end();
            appendNative(threadId, { dir: "out", source: "claude.sdk.message", msg: promptMsg });
            return { turnId };
        };
        const snapshot = async () => {
            const version = await new Promise((resolve) => {
                const cli = resolveCliSpawn(config.cli, ["--version"]); // multibot
                execFile(cli.command, cli.args, {
                    timeout: 8000,
                    env: { ...process.env, PATH: augmentedPath() },
                    windowsVerbatimArguments: cli.windowsVerbatimArguments,
                }, (err, stdout) => resolve(err ? null : stdout.trim()));
            });
            if (!version)
                return { state: "unavailable", reason: `\`${config.cli}\` CLI not found` };
            const authenticated = existsSync(join(homedir(), ".claude", ".credentials.json"));
            return { state: "available", version, authenticated };
        };
        return {
            instanceId,
            driverKind: DRIVER_KIND,
            displayName: input.displayName,
            enabled: input.enabled,
            models: MODELS,
            snapshot,
            adapter: {
                provider: DRIVER_KIND,
                capabilities: { sessionModelSwitch: "in-session", agentsMcp: true },
                sendTurn,
                interruptTurn: async (threadId) => active.get(threadId)?.stop(),
                respondToRequest: async (threadId, requestId, decision) => {
                    const broker = active.get(threadId)?.broker;
                    if (!broker)
                        throw new Error("no active turn with a permission broker on this thread");
                    const behavior = decision.behavior === "answer" ? "answer" : decision.behavior;
                    if (!broker.answer(requestId, behavior, decision.message)) {
                        throw new Error("no such pending request (it may have timed out)");
                    }
                },
                hasSession: (threadId) => active.has(threadId),
                stopAll: async () => {
                    for (const { stop } of active.values())
                        stop();
                },
                onEvent: (listener) => {
                    listeners.add(listener);
                    return () => listeners.delete(listener);
                },
            },
            generateText: (prompt) => new Promise((resolve, reject) => {
                // multibot
                const cli = resolveCliSpawn(config.cli, ["-p", prompt, "--model", "claude-haiku-4-5", "--output-format", "text"]);
                execFile(cli.command, cli.args, {
                    timeout: 60_000,
                    env: { ...process.env, PATH: augmentedPath() },
                    windowsVerbatimArguments: cli.windowsVerbatimArguments,
                }, (err, stdout) => (err ? reject(err) : resolve(stdout.trim())));
            }),
            dispose: async () => {
                for (const { stop } of active.values())
                    stop();
                listeners.clear();
            },
        };
    },
};
