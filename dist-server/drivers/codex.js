// Codex driver — upstream CodexDriver skeleton over agentcal's
// drivers/codex.js runtime: the official `codex` CLI headless over its
// app-server JSON-RPC protocol (newline-delimited JSON on stdio).
// Completion is a real `turn/completed` notification; approval requests
// arrive as in-process server→client JSON-RPC requests and surface as
// canonical request.opened events (answered via respondToRequest — no MCP
// proxy or unix socket needed, unlike claude). Verified against
// codex-cli 0.144.4 by agentcal.
//
// resumeCursor is the codex thread id; a later turn tries thread/resume
// and falls back to a fresh thread/start.
import { spawn, execFile } from "node:child_process";
import { homedir } from "node:os";
import { newEventId, newId } from "../contracts.js";
import { approvalRule } from "../approval-rules.js";
import { augmentedPath, resolveCliSpawn } from "../env-path.js";
import { COMPUTER_TOOLS_VERSION } from "../engine/computer-mcp.js";
import { killTree } from "../kill-tree.js";
import { approvalRuleAllowed, autoApproveAllowed, toolAllowed, turnPolicy } from "../turn-policy.js";
import { appendNative } from "./native.js";
const DRIVER_KIND = "codex";
// catalog ported from upstream packages/contracts/src/model.ts
const MODELS = {
    default: "gpt-5.6-sol",
    options: [
        { id: "gpt-5.6-sol", label: "GPT-5.6 Sol" },
        { id: "gpt-5.6-terra", label: "GPT-5.6 Terra" },
        { id: "gpt-5.6-luna", label: "GPT-5.6 Luna" },
        { id: "gpt-5.5", label: "GPT-5.5" },
        { id: "gpt-5.4", label: "GPT-5.4" },
        { id: "gpt-5.4-mini", label: "GPT-5.4 Mini" },
    ],
};
function decodeConfig(raw) {
    const o = (raw ?? {});
    return {
        cli: typeof o.cli === "string" ? o.cli : "codex",
        fullAuto: o.fullAuto === true,
    };
}
const QUESTION_TIMEOUT_NOTE = "No answer was given — use your best judgment.";
const DENY_TIMEOUT_NOTE = "MultiBot: nobody answered this permission request in time. Skip this action and finish what you can without it.";
// multibot (H3): Codex's mcp_servers carried only `agents`; the bot's computer
// has to ride along or Codex is the one driver that cannot touch the desktop
// the user is watching. Same stdio contract as every other server here.
export function codexMcpConfig(turn) {
    const mcp_servers = {};
    if (turn.integrations?.agents)
        mcp_servers.agents = turn.integrations.agents;
    if (turn.integrations?.localComputer)
        mcp_servers.computer = turn.integrations.localComputer;
    return Object.keys(mcp_servers).length ? { config: { mcp_servers } } : {};
}
// multibot (H3): serwery MCP wchodzą do wątku codeksa przy `thread/start` i
// `thread/resume` ich NIE dokłada — wątek założony, zanim bot dostał komputer,
// zostaje bez `computer` na zawsze (sprawdzone: świeży wątek woła `navigate`,
// wznowiony odpowiada "nie mam takiego narzędzia"). Dlatego zestaw serwerów
// jedzie w kursorze: zmienił się — wątek zaczyna się od nowa.
//
// ponytail: kursor jako `<id>#<serwery>` zamiast osobnego magazynu — kontrakt
// `resumeCursors` (string) zostaje bez zmian. Cena: przy zmianie zestawu bot
// traci pamięć po stronie codeksa (transkrypt harnessu zostaje). Gdyby to
// zaczęło boleć, następny krok to dosłanie `turn.transcript` w pierwszej turze.
export function cursorMcpKey(cfg) {
    return Object.keys(cfg.config?.mcp_servers ?? {})
        // Codex zapamiętuje w wątku także LISTĘ narzędzi serwera, nie tylko sam
        // serwer — dlatego komputer wchodzi do klucza z wersją swojego zestawu.
        .map((name) => (name === "computer" ? `computer@${COMPUTER_TOOLS_VERSION}` : name))
        .sort()
        .join(",");
}
/** `<codexThreadId>#<serwery>` → części. Stary kursor (bez `#`) ma pusty zestaw,
 *  więc pierwsza tura z komputerem świadomie zakłada nowy wątek. */
export function splitCursor(cursor) {
    const at = cursor.lastIndexOf("#");
    return at < 0 ? { threadId: cursor, mcpKey: "" } : { threadId: cursor.slice(0, at), mcpKey: cursor.slice(at + 1) };
}
/**
 * Co zrobić z kursorem przy tym zestawie serwerów: wznowić wątek czy zacząć nowy,
 * i jaki zestaw zapisać z powrotem.
 *
 * Restart TYLKO wtedy, gdy tura wnosi serwer, którego wątek nie zna — bo tylko
 * takiego `thread/resume` nie dołoży. W drugą stronę (komputer chwilowo nie
 * wstał, więc tura ma mniej serwerów) wątek zostaje: on ma komputer
 * zamontowany, a nieudany spawn psuje jedną turę, nie całą pamięć bota. Zapis
 * zostaje przy szerszym zestawie, żeby kolejna czkawka nie kasowała wątku.
 */
export function cursorPlan(storedCursor, mcpKey) {
    if (typeof storedCursor !== "string" || !storedCursor)
        return { resume: null, key: mcpKey };
    const stored = splitCursor(storedCursor);
    const known = new Set(stored.mcpKey ? stored.mcpKey.split(",") : []);
    const wanted = mcpKey ? mcpKey.split(",") : [];
    if (wanted.some((name) => !known.has(name)))
        return { resume: null, key: mcpKey };
    return { resume: stored.threadId, key: stored.mcpKey };
}
export const CodexDriver = {
    driverKind: DRIVER_KIND,
    metadata: { displayName: "Codex", supportsMultipleInstances: true },
    models: MODELS,
    decodeConfig,
    defaultConfig: () => decodeConfig({}),
    async create(input) {
        const { instanceId, config } = input;
        const listeners = new Set();
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
            const fullAuto = policy ? policy.autonomy === "autonomous" && !Object.values(policy.permissions).includes(false) : config.fullAuto;
            const turnId = newId();
            const requestedReasoning = turn.reasoning;
            const effort = requestedReasoning === "max" && !turn.model?.startsWith("gpt-5.6-") ? "xhigh" : requestedReasoning;
            const env = { ...process.env, PATH: augmentedPath(), NPM_CONFIG_LOGLEVEL: "error" };
            // the CLI owns its own ChatGPT login; a leaked API key silently flips
            // billing to pay-as-you-go (agentcal)
            delete env.OPENAI_API_KEY;
            const cli = resolveCliSpawn(config.cli, ["app-server"]); // multibot
            const child = spawn(cli.command, cli.args, {
                cwd: turn.cwd ?? homedir(),
                env,
                stdio: ["pipe", "pipe", "pipe"],
                windowsVerbatimArguments: cli.windowsVerbatimArguments,
                detached: true,
            });
            const state = { settled: false, lastText: "", sawStreamDelta: false };
            const asks = new Map();
            let codexThreadId = null;
            let providerTurnId = null;
            let cancelled = false;
            let nextId = 1;
            const rpcPending = new Map();
            const send = (obj) => {
                try {
                    child.stdin.write(JSON.stringify(obj) + "\n");
                }
                catch { }
                appendNative(threadId, { dir: "out", source: "codex.app-server", msg: obj });
            };
            const request = (method, params) => new Promise((resolve, reject) => {
                const id = nextId++;
                rpcPending.set(id, { resolve, reject });
                send({ jsonrpc: "2.0", id, method, params });
            });
            let cancelFallback;
            const stop = () => {
                if (state.settled || cancelled)
                    return;
                cancelled = true;
                if (codexThreadId && providerTurnId) {
                    void request("turn/interrupt", { threadId: codexThreadId, turnId: providerTurnId }).catch(() => { });
                    cancelFallback = setTimeout(() => settle(true, "cancelled"), 1500);
                    cancelFallback.unref?.();
                }
                else {
                    settle(true, "cancelled");
                }
            };
            const settle = (ok, stopReason) => {
                if (state.settled)
                    return;
                state.settled = true;
                if (cancelFallback)
                    clearTimeout(cancelFallback);
                for (const finish of [...asks.values()])
                    finish("deny", "MultiBot: the turn ended");
                for (const p of rpcPending.values())
                    p.reject(new Error("turn settled"));
                rpcPending.clear();
                active.delete(threadId);
                emit({ ...base(threadId, turnId), type: "turn.completed", ok, stopReason, cost: null });
                killTree(child); // the per-turn app-server never exits on its own
            };
            // server→client approval request → canonical request.opened
            const handleServerRequest = (msg) => {
                if (state.settled)
                    return;
                const method = msg.method;
                const params = msg.params ?? {};
                const isMcpElicitation = method === "mcpServer/elicitation/request";
                if (isMcpElicitation) {
                    const serverName = String(params.serverName || "mcp");
                    const tool = `mcp__${serverName}`;
                    const remembered = approvalRule(DRIVER_KIND, tool, {});
                    const reply = (action) => send({
                        jsonrpc: "2.0",
                        id: msg.id,
                        result: { action, content: action === "accept" ? {} : null },
                    });
                    if (!toolAllowed(threadId, tool)) {
                        emit({ ...base(threadId, turnId), type: "runtime.error", message: `${tool} blocked by bot permissions` });
                        return reply("decline");
                    }
                    if (autoApproveAllowed(threadId, tool) || approvalRuleAllowed(threadId, remembered))
                        return reply("accept");
                    const requestId = newId();
                    const finish = (behavior) => {
                        if (!asks.delete(requestId))
                            return;
                        clearTimeout(timer);
                        const allowed = behavior === "allow" || behavior === "always";
                        reply(allowed ? "accept" : "decline");
                        emit({ ...base(threadId, turnId), type: "request.resolved", requestId, behavior, source: "user" });
                    };
                    const timer = setTimeout(() => finish("deny"), 15 * 60_000);
                    timer.unref?.();
                    asks.set(requestId, finish);
                    emit({
                        ...base(threadId, turnId),
                        type: "request.opened",
                        requestId,
                        requestType: "permission",
                        tool,
                        summary: String(params.message ?? params._meta?.tool_description ?? tool).slice(0, 200),
                        approvalRule: remembered,
                    });
                    return;
                }
                const legacy = method === "execCommandApproval" || method === "applyPatchApproval";
                const isQuestion = method === "item/tool/requestUserInput";
                const tool = method === "item/fileChange/requestApproval" || method === "applyPatchApproval"
                    ? "edit"
                    : isQuestion
                        ? "ask_user"
                        : "shell";
                const nativeRule = params.proposedExecpolicyAmendment ?? params.proposedExecPolicyAmendment ?? params.execpolicyAmendment;
                const remembered = approvalRule(DRIVER_KIND, tool, { command: params.command }, nativeRule);
                const persistentDecision = Array.isArray(nativeRule)
                    ? { acceptWithExecpolicyAmendment: { execpolicy_amendment: nativeRule } }
                    : "acceptForSession";
                if (!isQuestion && !toolAllowed(threadId, tool)) {
                    emit({ ...base(threadId, turnId), type: "runtime.error", message: `${tool} blocked by bot permissions` });
                    return send({
                        jsonrpc: "2.0",
                        id: msg.id,
                        result: { decision: legacy ? "denied" : "decline" },
                    });
                }
                if (!isQuestion && (autoApproveAllowed(threadId, tool) || (!policy && config.fullAuto))) {
                    return send({ jsonrpc: "2.0", id: msg.id, result: { decision: legacy ? "approved" : "accept" } });
                }
                if (!isQuestion && approvalRuleAllowed(threadId, remembered)) {
                    return send({
                        jsonrpc: "2.0",
                        id: msg.id,
                        result: { decision: legacy ? "approved" : persistentDecision },
                    });
                }
                const requestId = newId();
                const summary = typeof params.command === "string"
                    ? params.command.slice(0, 200)
                    : Array.isArray(params.questions)
                        ? params.questions.map((q) => q.question ?? q.header).filter(Boolean).join(" · ")
                        : typeof params.reason === "string"
                            ? params.reason
                            : tool;
                const choices = isQuestion
                    ? (params.questions?.[0]?.options ?? []).map((o) => o.label).slice(0, 5)
                    : undefined;
                const finish = (behavior, message) => {
                    if (!asks.delete(requestId))
                        return;
                    clearTimeout(timer);
                    if (isQuestion) {
                        const answers = {};
                        for (const q of Array.isArray(params.questions) ? params.questions : []) {
                            answers[q.id] = { answers: [message || QUESTION_TIMEOUT_NOTE] };
                        }
                        send({ jsonrpc: "2.0", id: msg.id, result: { answers } });
                    }
                    else {
                        const allowed = behavior === "allow" || behavior === "always";
                        send({
                            jsonrpc: "2.0",
                            id: msg.id,
                            result: {
                                decision: allowed
                                    ? legacy
                                        ? "approved"
                                        : behavior === "always"
                                            ? persistentDecision
                                            : "accept"
                                    : legacy ? "denied" : "decline",
                            },
                        });
                    }
                    emit({ ...base(threadId, turnId), type: "request.resolved", requestId, behavior, source: "user" });
                };
                const timer = setTimeout(() => (isQuestion ? finish("answer", QUESTION_TIMEOUT_NOTE) : finish("deny", DENY_TIMEOUT_NOTE)), 15 * 60_000);
                timer.unref?.();
                asks.set(requestId, finish);
                emit({
                    ...base(threadId, turnId),
                    type: "request.opened",
                    requestId,
                    requestType: isQuestion ? "question" : "permission",
                    tool,
                    summary,
                    choices,
                    ...(!isQuestion ? { approvalRule: remembered } : {}),
                });
            };
            const handleNotification = (msg) => {
                if (state.settled)
                    return;
                const p = msg.params ?? {};
                switch (msg.method) {
                    // token-level chat text; the item/completed frame follows with the
                    // whole message, so its delta is only a fallback when none streamed
                    case "item/agentMessage/delta": {
                        const delta = typeof p.delta === "string" ? p.delta : "";
                        if (delta) {
                            state.sawStreamDelta = true;
                            emit({ ...base(threadId, turnId), type: "content.delta", streamKind: "assistant_text", delta });
                        }
                        break;
                    }
                    case "item/reasoning/textDelta":
                    case "item/reasoning/summaryTextDelta": {
                        const delta = typeof p.delta === "string" ? p.delta : "";
                        if (delta)
                            emit({ ...base(threadId, turnId), type: "content.delta", streamKind: "reasoning_text", delta });
                        break;
                    }
                    case "item/started": {
                        const item = p.item ?? {};
                        const title = item.type === "commandExecution"
                            ? String(item.command ?? "shell").slice(0, 80)
                            : item.type === "fileChange"
                                ? "edit"
                                : item.type === "mcpToolCall"
                                    ? (item.tool ?? item.name ?? "mcp")
                                    : item.type === "webSearch"
                                        ? "web_search"
                                        : null;
                        if (title)
                            emit({ ...base(threadId, turnId), type: "item.started", itemType: "tool", itemId: item.id, title });
                        break;
                    }
                    case "item/completed": {
                        const item = p.item ?? {};
                        if (item.type === "agentMessage") {
                            if (item.text?.trim()) {
                                state.lastText = item.text;
                                if (!state.sawStreamDelta) {
                                    emit({ ...base(threadId, turnId), type: "content.delta", streamKind: "assistant_text", delta: item.text });
                                }
                                state.sawStreamDelta = false;
                                emit({ ...base(threadId, turnId), type: "item.completed", itemType: "assistant_text", text: item.text });
                            }
                        }
                        else if (["commandExecution", "fileChange", "mcpToolCall"].includes(item.type)) {
                            emit({
                                ...base(threadId, turnId),
                                type: "item.completed",
                                itemType: "tool",
                                itemId: item.id,
                                ok: item.status !== "failed" && item.status !== "declined",
                            });
                        }
                        else if (item.type === "reasoning") {
                            emit({ ...base(threadId, turnId), type: "item.updated", itemType: "reasoning", tokens: null });
                        }
                        break;
                    }
                    case "thread/tokenUsage/updated": {
                        const t = p.tokenUsage?.total;
                        if (t) {
                            emit({
                                ...base(threadId, turnId),
                                type: "thread.token-usage.updated",
                                input: t.inputTokens ?? 0,
                                output: t.outputTokens ?? 0,
                            });
                        }
                        break;
                    }
                    case "turn/completed": {
                        const t = p.turn ?? {};
                        if (cancelled || t.status === "interrupted")
                            settle(true, "cancelled");
                        else
                            settle(t.status === "completed", t.status === "completed" ? null : (t.error?.message ?? t.status ?? "failed"));
                        break;
                    }
                    case "error":
                        if (p.message)
                            emit({ ...base(threadId, turnId), type: "runtime.error", message: p.message });
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
                    if (!line.trim())
                        continue;
                    let msg;
                    try {
                        msg = JSON.parse(line);
                    }
                    catch {
                        continue;
                    }
                    appendNative(threadId, { dir: "in", source: "codex.app-server", msg });
                    if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
                        const pend = rpcPending.get(msg.id);
                        if (pend) {
                            rpcPending.delete(msg.id);
                            msg.error ? pend.reject(new Error(msg.error.message ?? JSON.stringify(msg.error))) : pend.resolve(msg.result);
                        }
                    }
                    else if (msg.id !== undefined && msg.method) {
                        handleServerRequest(msg);
                    }
                    else if (msg.method) {
                        handleNotification(msg);
                    }
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
                if (!state.settled) {
                    if (cancelled)
                        return settle(true, "cancelled");
                    emit({
                        ...base(threadId, turnId),
                        type: "runtime.error",
                        message: `codex exited ${code} before turn/completed${stderr ? `: ${stderr.trim().slice(-300)}` : ""}`,
                    });
                    settle(false, "exit_before_result");
                }
            });
            active.set(threadId, { stop, turnId, asks });
            emit({ ...base(threadId, turnId), type: "turn.started" });
            // handshake + kickoff; any refusal surfaces as failure, not a hang
            (async () => {
                try {
                    await request("initialize", { clientInfo: { name: "openmausbot", version: "1" } });
                    send({ jsonrpc: "2.0", method: "initialized", params: {} });
                    const mcpConfig = codexMcpConfig(turn);
                    const mcpKey = cursorMcpKey(mcpConfig);
                    const plan = cursorPlan(turn.resumeCursor, mcpKey);
                    const cursor = plan.resume;
                    let startedModel = null;
                    if (cursor) {
                        try {
                            const resumed = await request("thread/resume", {
                                threadId: cursor,
                                ...mcpConfig,
                            });
                            codexThreadId = resumed?.thread?.id ?? cursor;
                        }
                        catch {
                            /* resume unsupported or thread gone — start fresh below */
                        }
                    }
                    if (!codexThreadId) {
                        const started = await request("thread/start", {
                            cwd: turn.cwd ?? homedir(),
                            model: turn.model || null,
                            sandbox: fullAuto ? "danger-full-access" : policy?.permissions.file === false ? "read-only" : "workspace-write",
                            approvalPolicy: fullAuto ? "never" : "on-request",
                            ephemeral: false,
                            ...mcpConfig,
                        });
                        codexThreadId = started?.thread?.id ?? null;
                        startedModel = started?.model ?? null;
                    }
                    emit({
                        ...base(threadId, turnId),
                        type: "session.started",
                        // bez serwerów MCP kursor zostaje gołym id — tak wygląda od zawsze
                        sessionId: codexThreadId && plan.key ? `${codexThreadId}#${plan.key}` : codexThreadId,
                        model: startedModel ?? turn.model ?? null,
                    });
                    const turnInput = [
                        { type: "text", text: turn.system ? `${turn.system}\n\n${turn.text}` : turn.text },
                        ...(turn.attachments ?? []).filter((file) => file.mime.startsWith("image/")).map((file) => ({ type: "localImage", path: file.path })),
                    ];
                    const startedTurn = await request("turn/start", {
                        threadId: codexThreadId,
                        input: turnInput,
                        ...(effort ? { effort } : {}),
                    });
                    providerTurnId = startedTurn?.turn?.id ?? startedTurn?.turnId ?? null;
                }
                catch (e) {
                    if (!state.settled) {
                        emit({ ...base(threadId, turnId), type: "runtime.error", message: e.message });
                        settle(false, "rpc_error");
                    }
                }
            })();
            return { turnId };
        };
        const snapshot = async () => {
            const probe = (args) => new Promise((resolve) => {
                const cli = resolveCliSpawn(config.cli, args); // multibot
                execFile(cli.command, cli.args, {
                    timeout: 8000,
                    env: { ...process.env, PATH: augmentedPath() },
                    windowsVerbatimArguments: cli.windowsVerbatimArguments,
                }, (err, stdout, stderr) => resolve({ ok: !err, output: `${stdout}${stderr}`.trim() }));
            });
            const version = await probe(["--version"]);
            if (!version.ok || !version.output)
                return { state: "unavailable", reason: `\`${config.cli}\` CLI not found` };
            const auth = await probe(["login", "status"]);
            return { state: "available", version: version.output, authenticated: auth.ok };
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
                capabilities: { sessionModelSwitch: "unsupported", agentsMcp: true },
                sendTurn,
                interruptTurn: async (threadId) => active.get(threadId)?.stop(),
                respondToRequest: async (threadId, requestId, decision) => {
                    const turn = active.get(threadId);
                    const finish = turn?.asks.get(requestId);
                    if (!finish)
                        throw new Error("no such pending request");
                    finish(decision.behavior, decision.message);
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
            dispose: async () => {
                for (const { stop } of active.values())
                    stop();
                listeners.clear();
            },
        };
    },
};
