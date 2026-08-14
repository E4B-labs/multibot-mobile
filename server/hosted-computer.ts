// multibot (H1/H2): the bot's own computer.
//
// One persistent Linux desktop per bot, in a container, for the bot's whole
// life. No modes, no source picker, no "off" — see PLAN-COMPUTER.md.
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
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

/** Ports the image serves. cdp drives the browser (engine/server/computer.py
 *  and teach.py both speak it); novnc is the screen the user sees and takes
 *  over; api is cua's computer-server for whole-desktop input. */
export const CONTAINER_PORTS = { cdp: 9223, novnc: 6901, api: 8000 } as const;
export type PortName = keyof typeof CONTAINER_PORTS;

export const IMAGE = process.env.MULTIBOT_COMPUTER_IMAGE ?? "multibot-computer:dev";

export interface ComputerLimits {
  /** container CPU quota, e.g. 2 == two cores */
  cpus: number;
  /** container memory cap, docker syntax, e.g. "3g" */
  memory: string;
}

export const DEFAULT_LIMITS: ComputerLimits = {
  cpus: Number(process.env.MULTIBOT_COMPUTER_CPUS ?? 2),
  memory: process.env.MULTIBOT_COMPUTER_MEMORY ?? "3g",
};

/** Short, stable, filesystem-safe id derived from the bot id. Bot ids are
 *  user-facing and may hold characters docker rejects in a container name. */
export function botHash(botId: string): string {
  return createHash("sha256").update(botId).digest("hex").slice(0, 12);
}

export const containerName = (botId: string) => `multibot-computer-${botHash(botId)}`;
export const volumeName = (botId: string) => `multibot-computer-data-${botHash(botId)}`;

/**
 * How to invoke docker. On Windows there is no native daemon — it runs inside
 * the WSL distro — so every call is tunnelled through `wsl -d <distro>`.
 * Exported for tests; nothing else should need it.
 */
export function dockerCommand(argv: string[], platform = process.platform): { file: string; args: string[] } {
  if (platform === "win32") {
    const distro = process.env.MULTIBOT_WSL_DISTRO ?? "Ubuntu";
    return { file: "wsl", args: ["-d", distro, "-e", "docker", ...argv] };
  }
  return { file: "docker", args: argv };
}

/**
 * Hard off switch. Bot computers are real containers with real volumes, so a
 * test run — which boots the harness as a subprocess and creates throwaway bots
 * — must never provision them: the first run of this file's integration left 11
 * live containers behind and exhausted the port range other tests bind to.
 *
 * `VITEST` is inherited by the spawned harness, so this holds for both the
 * in-process and the subprocess tests. `MULTIBOT_COMPUTER=off` is the manual
 * escape hatch for a dev machine without docker.
 */
export function computersDisabled(): boolean {
  return Boolean(process.env.VITEST) || process.env.MULTIBOT_COMPUTER === "off";
}

async function docker(argv: string[], timeoutMs = 120_000): Promise<string> {
  if (computersDisabled()) throw new Error("bot computers are disabled in this process");
  const { file, args } = dockerCommand(argv);
  const { stdout } = await run(file, args, { timeout: timeoutMs, maxBuffer: 8 << 20 });
  return stdout.trim();
}

async function dockerOk(argv: string[], timeoutMs = 120_000): Promise<boolean> {
  try {
    await docker(argv, timeoutMs);
    return true;
  } catch {
    return false;
  }
}

export type ComputerState = "provisioning" | "ready" | "recovering" | "error";

export interface ComputerStatus {
  botId: string;
  state: ComputerState;
  /** host ports, freshly read — only present once the container is up */
  ports?: Record<PortName, number>;
  detail?: string;
}

/** `docker inspect` running-state for one container, or null when absent. */
async function inspectRunning(name: string): Promise<boolean | null> {
  try {
    const out = await docker(["inspect", name, "--format", "{{.State.Running}}"], 30_000);
    return out === "true";
  } catch {
    return null; // no such container
  }
}

/**
 * Pull the host port out of `docker port` output, e.g. "127.0.0.1:32773".
 * Docker may print one line per protocol/family, and an IPv6 binding looks like
 * "[::1]:32773" — hence splitting on the LAST colon rather than the first.
 * Only loopback bindings are accepted: if a line ever came back bound to
 * 0.0.0.0 the computer would be exposed off-box, so we refuse it instead.
 */
export function parsePortOutput(out: string): number | null {
  for (const line of out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
    const idx = line.lastIndexOf(":");
    if (idx < 0) continue;
    const host = line.slice(0, idx);
    if (!/^(127\.0\.0\.1|\[::1\]|localhost)$/.test(host)) continue;
    const port = Number(line.slice(idx + 1));
    if (Number.isInteger(port) && port > 0 && port < 65536) return port;
  }
  return null;
}

/**
 * One port, not all three.
 *
 * The screen proxy resolves a port on EVERY request — each noVNC asset, each
 * websocket — and one `docker port` through WSL costs a second or two. Reading
 * all three ports per request made the websocket upgrade time out. A short
 * cache absorbs the burst of asset requests; it is deliberately brief because
 * the port changes whenever the container restarts, and a stale port must heal
 * on its own within seconds.
 */
const PORT_CACHE_MS = 5_000;
const portCache = new Map<string, { port: number; at: number }>();

export async function readPort(botId: string, name: PortName): Promise<number | null> {
  const key = `${botId}:${name}`;
  const hit = portCache.get(key);
  if (hit && Date.now() - hit.at < PORT_CACHE_MS) return hit.port;
  let out: string;
  try {
    out = await docker(["port", containerName(botId), String(CONTAINER_PORTS[name])], 30_000);
  } catch {
    portCache.delete(key);
    return null;
  }
  const port = parsePortOutput(out);
  if (port === null) portCache.delete(key);
  else portCache.set(key, { port, at: Date.now() });
  return port;
}

/** Drop cached ports for a bot — after a restart they are certainly wrong. */
export function forgetPorts(botId: string): void {
  for (const key of portCache.keys()) if (key.startsWith(`${botId}:`)) portCache.delete(key);
}

/**
 * Read back the host-side ports. MUST be called after every start/restart —
 * docker reassigns them (H0: 32770 before a restart, 32773 after).
 */
export async function readPorts(botId: string): Promise<Record<PortName, number> | null> {
  const name = containerName(botId);
  const ports = {} as Record<PortName, number>;
  for (const [key, containerPort] of Object.entries(CONTAINER_PORTS) as Array<[PortName, number]>) {
    let out: string;
    try {
      out = await docker(["port", name, String(containerPort)], 30_000);
    } catch {
      return null;
    }
    const port = parsePortOutput(out);
    if (port === null) return null;
    ports[key] = port;
  }
  return ports;
}

/** True once the browser inside the computer answers — the readiness signal
 *  that actually matters, since a running container is not a usable desktop. */
export async function probeReady(ports: Record<PortName, number>, timeoutMs = 5_000): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${ports.cdp}/json/version`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function createArgs(botId: string, limits: ComputerLimits): string[] {
  return [
    "run", "-d",
    "--name", containerName(botId),
    // Mandatory: the WSL VM suspends and SIGTERMs everything; only a restart
    // policy brings the computer back when it wakes.
    "--restart", "unless-stopped",
    "-v", `${volumeName(botId)}:/home/cua`,
    // Every port is bound to host loopback. Nothing about the bot's computer is
    // reachable off-box; clients reach it only through the harness proxy.
    ...Object.values(CONTAINER_PORTS).flatMap((p) => ["-p", `127.0.0.1::${p}`]),
    "--shm-size=1g",
    `--cpus=${limits.cpus}`,
    `--memory=${limits.memory}`,
    IMAGE,
  ];
}

/**
 * Bring this bot's computer up and return its status. Idempotent: safe to call
 * on every harness boot and before every turn.
 *
 * Never falls back to "no computer" silently — a machine that cannot be
 * provisioned surfaces as `error` with a reason, because a quiet downgrade to
 * browser-only is exactly the failure mode PLAN-COMPUTER.md forbids.
 */
export function ensureComputer(botId: string, limits = DEFAULT_LIMITS): Promise<ComputerStatus> {
  // The panel polls and turns fire independently, so two `docker run`s for one
  // bot used to race — the loser got "name already in use" and the user saw
  // "Computer error" while the computer was in fact coming up fine.
  const started = inFlight.get(botId) ?? ensureOnce(botId, limits).finally(() => inFlight.delete(botId));
  inFlight.set(botId, started);
  return started;
}

const inFlight = new Map<string, Promise<ComputerStatus>>();

/** Losing a create race means the container exists — which is the goal. */
const isNameConflict = (e: unknown) => /already in use/i.test(e instanceof Error ? e.message : String(e));

async function ensureOnce(botId: string, limits: ComputerLimits): Promise<ComputerStatus> {
  const name = containerName(botId);
  try {
    const running = await inspectRunning(name);
    if (running === null) {
      await docker(["volume", "create", volumeName(botId)], 60_000);
      try {
        await docker(createArgs(botId, limits), 180_000);
      } catch (e) {
        // Another process (or an earlier boot) got there first. Treat it as
        // created and make sure it is up, rather than reporting a failure.
        if (!isNameConflict(e)) throw e;
        await docker(["start", name], 120_000).catch(() => {});
      }
    } else if (!running) {
      await docker(["start", name], 120_000);
    }
    forgetPorts(botId);
  } catch (e) {
    return { botId, state: "error", detail: e instanceof Error ? e.message : String(e) };
  }

  const ports = await readPorts(botId);
  if (!ports) return { botId, state: "provisioning", detail: "ports not published yet" };
  const ready = await probeReady(ports);
  return { botId, state: ready ? "ready" : "provisioning", ports };
}

/** Run a command inside the bot's computer. This is the bot's terminal — the
 *  same filesystem the desktop and the browser see. */
export async function exec(botId: string, command: string, timeoutMs = 60_000): Promise<string> {
  return docker(["exec", containerName(botId), "bash", "-lc", command], timeoutMs);
}

/**
 * Bring back a computer that already exists, without ever creating one.
 *
 * Boot uses this rather than `ensureComputer`: creating containers as a side
 * effect of starting the harness turned every throwaway test bot into a real
 * container (20 of them accumulated before this was caught). A bot gets its
 * computer when someone actually uses it — a turn, or opening the panel.
 */
export async function resumeComputer(botId: string): Promise<boolean> {
  const name = containerName(botId);
  const running = await inspectRunning(name);
  if (running === null) return false; // never created — not our job here
  if (running) return true;
  return dockerOk(["start", name], 120_000);
}

/**
 * Destroy the computer. Only ever called on explicit bot deletion — the volume
 * holds the bot's logins and files, so it dies with the bot and at no other
 * time.
 */
export async function removeComputer(botId: string): Promise<void> {
  await dockerOk(["rm", "-f", containerName(botId)], 120_000);
  await dockerOk(["volume", "rm", volumeName(botId)], 60_000);
}

/**
 * Containers for bots that no longer exist. Deliberately returns names rather
 * than deleting: PLAN-COMPUTER.md only permits removal on an unambiguous match,
 * so the caller passes the authoritative live bot list and nothing else is ever
 * touched — a container whose bot id we cannot account for is left alone.
 */
export async function orphanContainers(liveBotIds: string[]): Promise<string[]> {
  let out: string;
  try {
    out = await docker(["ps", "-a", "--filter", "name=multibot-computer-", "--format", "{{.Names}}"], 60_000);
  } catch {
    return [];
  }
  const live = new Set(liveBotIds.map(containerName));
  return out.split(/\r?\n/).map((l) => l.trim())
    .filter((n) => n.startsWith("multibot-computer-") && !live.has(n));
}

/** Docker reachable at all? Used to tell "no docker installed" apart from
 *  "this bot's computer is broken", which are very different user problems. */
export async function dockerAvailable(): Promise<boolean> {
  return dockerOk(["version", "--format", "{{.Server.Version}}"], 30_000);
}
