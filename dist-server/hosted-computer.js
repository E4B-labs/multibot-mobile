// multibot (H1/H2): the computer.
//
// ONE persistent Linux desktop per installation, shared by every bot. Not one
// per bot: a single machine is set up on the host and all agents act on that
// same desktop, so a login one bot performs is a login every bot already has.
// No modes, no source picker, no "off" — see PLAN-COMPUTER.md.
//
// Because it belongs to the installation rather than to any bot, deleting a bot
// never destroys it.
//
// Three facts learned from the H0 spike drive this file's shape:
//
//  1. The published host port CHANGES on every container restart. Docker picks
//     a fresh ephemeral port each time, so the port must be read back with
//     `docker port` on every use and never cached across a restart.
//  2. On Windows the daemon lives inside WSL, and the WSL VM suspends when no
//     session holds it open — every container gets SIGTERM. Only containers
//     with a restart policy come back when WSL wakes, so `--restart
//     unless-stopped` is mandatory, not a nicety.
//  3. Chrome >= 111 pins CDP to the container's own loopback and ignores
//     --remote-debugging-address, so the image bridges 9222 -> 9223 with socat
//     and we publish 9223. See Dockerfile.computer.
import { execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
const run = promisify(execFile);
/** Ports the image serves. cdp drives the browser (engine/server/computer.py
 *  and teach.py both speak it); novnc is the screen the user sees and takes
 *  over; api is cua's computer-server for whole-desktop input. */
export const CONTAINER_PORTS = { cdp: 9223, novnc: 6901, api: 8000 };
export const IMAGE = process.env.MULTIBOT_COMPUTER_IMAGE ?? "multibot-computer:dev";
export const BACKEND = process.env.MULTIBOT_COMPUTER_BACKEND === "native" ? "native" : "docker";
/** Native backend serves fixed ports — nothing allocates them dynamically. */
const NATIVE_PORTS = {
    cdp: Number(process.env.MULTIBOT_COMPUTER_CDP_PORT ?? 9223),
    novnc: Number(process.env.MULTIBOT_COMPUTER_NOVNC_PORT ?? 6901),
    api: 0, // cua's computer-server is container-only; nothing uses it today
};
const NATIVE_SCRIPT = process.env.MULTIBOT_COMPUTER_SCRIPT
    ?? join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "computer-native.sh");
/** Fixed names: there is exactly one, so nothing is derived from a bot id. */
export const CONTAINER_NAME = "multibot-computer";
export const VOLUME_NAME = "multibot-computer-data";
export const DEFAULT_LIMITS = {
    cpus: Number(process.env.MULTIBOT_COMPUTER_CPUS ?? 2),
    memory: process.env.MULTIBOT_COMPUTER_MEMORY ?? "3g",
};
/**
 * How to invoke docker. On Windows there is no native daemon — it runs inside
 * the WSL distro — so every call is tunnelled through `wsl -d <distro>`.
 * Exported for tests; nothing else should need it.
 */
export function dockerCommand(argv, platform = process.platform) {
    if (platform === "win32") {
        const distro = process.env.MULTIBOT_WSL_DISTRO ?? "Ubuntu";
        return { file: "wsl", args: ["-d", distro, "-e", "docker", ...argv] };
    }
    return { file: "docker", args: argv };
}
/**
 * Hard off switch. The computer is a real container with a real volume, so a
 * test run — which boots the harness as a subprocess — must never provision it:
 * the first run of this file's integration left live containers behind and
 * exhausted the port range other tests bind to.
 *
 * `VITEST` is inherited by the spawned harness, so this holds for both the
 * in-process and the subprocess tests. `MULTIBOT_COMPUTER=off` is the manual
 * escape hatch for a host without docker — a phone in Termux, for instance.
 */
export function computersDisabled() {
    return Boolean(process.env.VITEST) || process.env.MULTIBOT_COMPUTER === "off";
}
async function docker(argv, timeoutMs = 120_000) {
    if (computersDisabled())
        throw new Error("the bot computer is disabled in this process");
    const { file, args } = dockerCommand(argv);
    const { stdout } = await run(file, args, { timeout: timeoutMs, maxBuffer: 8 << 20 });
    return stdout.trim();
}
async function dockerOk(argv, timeoutMs = 120_000) {
    try {
        await docker(argv, timeoutMs);
        return true;
    }
    catch {
        return false;
    }
}
/** `docker inspect` running-state, or null when the container does not exist. */
async function inspectRunning() {
    try {
        return (await docker(["inspect", CONTAINER_NAME, "--format", "{{.State.Running}}"], 30_000)) === "true";
    }
    catch {
        return null;
    }
}
/**
 * Pull the host port out of `docker port` output, e.g. "127.0.0.1:32773".
 * Docker may print one line per protocol/family, and an IPv6 binding looks like
 * "[::1]:32773" — hence splitting on the LAST colon rather than the first.
 * Only loopback bindings are accepted: if a line ever came back bound to
 * 0.0.0.0 the computer would be exposed off-box, so we refuse it instead.
 */
export function parsePortOutput(out) {
    for (const line of out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
        const idx = line.lastIndexOf(":");
        if (idx < 0)
            continue;
        const host = line.slice(0, idx);
        if (!/^(127\.0\.0\.1|\[::1\]|localhost)$/.test(host))
            continue;
        const port = Number(line.slice(idx + 1));
        if (Number.isInteger(port) && port > 0 && port < 65536)
            return port;
    }
    return null;
}
/**
 * One port, read back from docker.
 *
 * The screen proxy resolves a port on EVERY request — each noVNC asset, each
 * websocket — and one `docker port` through WSL costs a second or two. A short
 * cache absorbs the burst of asset requests; it is deliberately brief because
 * the port changes whenever the container restarts, and a stale port must heal
 * on its own within seconds.
 */
const PORT_CACHE_MS = 5_000;
const portCache = new Map();
export async function readPort(name) {
    if (BACKEND === "native")
        return NATIVE_PORTS[name] || null;
    const hit = portCache.get(name);
    if (hit && Date.now() - hit.at < PORT_CACHE_MS)
        return hit.port;
    let out;
    try {
        out = await docker(["port", CONTAINER_NAME, String(CONTAINER_PORTS[name])], 30_000);
    }
    catch {
        portCache.delete(name);
        return null;
    }
    const port = parsePortOutput(out);
    if (port === null)
        portCache.delete(name);
    else
        portCache.set(name, { port, at: Date.now() });
    return port;
}
/** Drop cached ports — after a restart they are certainly wrong. */
export function forgetPorts() {
    portCache.clear();
}
export async function readPorts() {
    const ports = {};
    for (const name of Object.keys(CONTAINER_PORTS)) {
        const port = await readPort(name);
        // `api` is the container image's cua server; the native backend has no
        // equivalent and nothing calls it, so its absence must not mean "down".
        if (port === null) {
            if (name === "api")
                continue;
            return null;
        }
        ports[name] = port;
    }
    return ports;
}
/** True once the browser inside the computer answers — the readiness signal
 *  that actually matters, since a running container is not a usable desktop. */
export async function probeReady(ports, timeoutMs = 5_000) {
    try {
        const res = await fetch(`http://127.0.0.1:${ports.cdp}/json/version`, {
            signal: AbortSignal.timeout(timeoutMs),
        });
        return res.ok;
    }
    catch {
        return false;
    }
}
function createArgs(limits) {
    return [
        "run", "-d",
        "--name", CONTAINER_NAME,
        // Mandatory: the WSL VM suspends and SIGTERMs everything; only a restart
        // policy brings the computer back when it wakes.
        "--restart", "unless-stopped",
        "-v", `${VOLUME_NAME}:/home/cua`,
        // Every port is bound to host loopback. Nothing about the computer is
        // reachable off-box; clients reach it only through the harness proxy.
        ...Object.values(CONTAINER_PORTS).flatMap((p) => ["-p", `127.0.0.1::${p}`]),
        // Ten sam ekran 16:9, co backend native — obraz ma w ENV 1024x768.
        "-e", `VNC_RESOLUTION=${process.env.MULTIBOT_COMPUTER_GEOMETRY ?? "1920x1080"}`,
        "--shm-size=1g",
        `--cpus=${limits.cpus}`,
        `--memory=${limits.memory}`,
        IMAGE,
    ];
}
const inFlight = { current: null };
/** Losing a create race means the container exists — which is the goal. */
const isNameConflict = (e) => /already in use/i.test(e instanceof Error ? e.message : String(e));
/**
 * Bring the computer up and return its status. Idempotent: safe to call before
 * every turn and on every panel poll.
 *
 * Never falls back to "no computer" silently — a machine that cannot be
 * provisioned surfaces as `error` with a reason, because a quiet downgrade to
 * browser-only is exactly the failure mode PLAN-COMPUTER.md forbids.
 */
export function ensureComputer(limits = DEFAULT_LIMITS) {
    // The panel polls and turns fire independently — and now every bot shares one
    // container, so these races are more frequent, not fewer. The loser of a
    // create race used to surface "name already in use" as a user-visible error.
    return (inFlight.current ??= ensureOnce(limits).finally(() => {
        inFlight.current = null;
    }));
}
async function ensureNative() {
    const ports = (await readPorts());
    // Already up? Then starting it again would be pointless work on a phone.
    if (await probeReady(ports))
        return { state: "ready", ports };
    try {
        const { stderr } = await run("bash", [NATIVE_SCRIPT], { timeout: 120_000, maxBuffer: 8 << 20 });
        if (stderr?.trim())
            console.warn("[multibot] native computer:", stderr.trim().slice(0, 200));
    }
    catch (e) {
        return { state: "error", detail: e instanceof Error ? e.message : String(e) };
    }
    return { state: (await probeReady(ports)) ? "ready" : "provisioning", ports };
}
async function ensureOnce(limits) {
    if (BACKEND === "native")
        return ensureNative();
    try {
        const running = await inspectRunning();
        if (running === null) {
            await docker(["volume", "create", VOLUME_NAME], 60_000);
            try {
                await docker(createArgs(limits), 180_000);
            }
            catch (e) {
                // Another process (or an earlier boot) got there first. Treat it as
                // created and make sure it is up, rather than reporting a failure.
                if (!isNameConflict(e))
                    throw e;
                await docker(["start", CONTAINER_NAME], 120_000).catch(() => { });
            }
        }
        else if (!running) {
            await docker(["start", CONTAINER_NAME], 120_000);
        }
        forgetPorts();
    }
    catch (e) {
        return { state: "error", detail: e instanceof Error ? e.message : String(e) };
    }
    const ports = await readPorts();
    if (!ports)
        return { state: "provisioning", detail: "ports not published yet" };
    return { state: (await probeReady(ports)) ? "ready" : "provisioning", ports };
}
/**
 * Bring back a computer that already exists, without ever creating one.
 *
 * Boot uses this rather than `ensureComputer`: creating a container as a side
 * effect of starting the harness turned every throwaway test run into a real
 * container. The computer is created when someone actually uses it — a turn, or
 * opening the panel.
 */
export async function resumeComputer() {
    if (BACKEND === "native") {
        const ports = await readPorts();
        return Boolean(ports && (await probeReady(ports)));
    }
    const running = await inspectRunning();
    if (running === null)
        return false; // never created — not our job here
    if (running)
        return true;
    const started = await dockerOk(["start", CONTAINER_NAME], 120_000);
    forgetPorts();
    return started;
}
/** Run a command inside the computer. This is the shared terminal — the same
 *  filesystem the desktop and the browser see. */
export async function exec(command, timeoutMs = 60_000) {
    if (BACKEND === "native") {
        // No container to step into: this runs as the harness user, on this
        // machine. See the security note at the top of scripts/computer-native.sh.
        if (computersDisabled())
            throw new Error("the bot computer is disabled in this process");
        const { stdout, stderr } = await run("bash", ["-lc", command], { timeout: timeoutMs, maxBuffer: 8 << 20 });
        return (stdout + (stderr ?? "")).trim();
    }
    return docker(["exec", CONTAINER_NAME, "bash", "-lc", command], timeoutMs);
}
/**
 * Destroy the computer and everything on it — logins, files, browser profile.
 *
 * Nothing calls this automatically. It belongs to the installation, not to any
 * bot, so deleting a bot must NOT take it down: the remaining bots are still
 * using it, and its volume holds work that outlives any single bot.
 */
export async function removeComputer() {
    await dockerOk(["rm", "-f", CONTAINER_NAME], 120_000);
    await dockerOk(["volume", "rm", VOLUME_NAME], 60_000);
    forgetPorts();
}
/** Docker reachable at all? Used to tell "no docker installed" apart from
 *  "the computer is broken", which are very different user problems. */
export async function dockerAvailable() {
    // The native backend needs no daemon, so "is docker there" cannot fail it.
    if (BACKEND === "native")
        return true;
    return dockerOk(["version", "--format", "{{.Server.Version}}"], 30_000);
}
