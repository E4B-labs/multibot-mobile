// multibot: driver-neutral routines. Scheduling belongs to harness because it
// already owns every provider turn; no CLI-specific daemon or protocol.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { newId } from "./contracts.js";
const EVERY = /^every\s+(\d+)\s*([mhd])$/i;
const FIELD = /^(?:\*|\*\/\d+|\d+(?:-\d+)?)(?:,(?:\*|\*\/\d+|\d+(?:-\d+)?))*$/;
function privateFile(path) {
    if (process.platform !== "win32" && existsSync(path))
        chmodSync(path, 0o600);
}
function privateDir(path) {
    if (process.platform !== "win32" && existsSync(path))
        chmodSync(path, 0o700);
}
function values(field, min, max, sunday = false) {
    if (!FIELD.test(field))
        throw new Error(`invalid cron field: ${field}`);
    if (field === "*")
        return null;
    const out = new Set();
    for (const part of field.split(",")) {
        if (part.startsWith("*/")) {
            const step = Number(part.slice(2));
            if (!Number.isInteger(step) || step < 1)
                throw new Error(`invalid cron step: ${part}`);
            for (let n = min; n <= max; n += step)
                out.add(sunday && n === 7 ? 0 : n);
            continue;
        }
        const [rawStart, rawEnd = rawStart] = part.split("-");
        const start = Number(rawStart);
        const end = Number(rawEnd);
        if (!Number.isInteger(start) || !Number.isInteger(end) || start < min || end > max || start > end) {
            throw new Error(`cron value outside ${min}-${max}: ${part}`);
        }
        for (let n = start; n <= end; n++)
            out.add(sunday && n === 7 ? 0 : n);
    }
    return out;
}
function nextCron(schedule, after) {
    const parts = schedule.trim().split(/\s+/);
    if (parts.length !== 5)
        throw new Error("schedule must be 'every 30m' or a five-field cron expression");
    const minute = values(parts[0], 0, 59);
    const hour = values(parts[1], 0, 23);
    const monthDay = values(parts[2], 1, 31);
    const month = values(parts[3], 1, 12);
    const weekDay = values(parts[4], 0, 7, true);
    const cursor = new Date(after);
    cursor.setSeconds(0, 0);
    cursor.setMinutes(cursor.getMinutes() + 1);
    for (let i = 0; i < 527_040; i++, cursor.setMinutes(cursor.getMinutes() + 1)) {
        const dom = monthDay?.has(cursor.getDate()) ?? true;
        const dow = weekDay?.has(cursor.getDay()) ?? true;
        const dayMatches = monthDay && weekDay ? dom || dow : dom && dow;
        if ((minute?.has(cursor.getMinutes()) ?? true) &&
            (hour?.has(cursor.getHours()) ?? true) &&
            dayMatches &&
            (month?.has(cursor.getMonth() + 1) ?? true))
            return cursor.getTime();
    }
    throw new Error("schedule has no run time within one year");
}
export function nextRun(schedule, after) {
    if (!schedule)
        return null;
    const interval = EVERY.exec(schedule.trim());
    if (interval) {
        const amount = Number(interval[1]);
        if (!Number.isSafeInteger(amount) || amount < 1)
            throw new Error("interval must be positive");
        const unit = interval[2].toLowerCase();
        return after + amount * (unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 86_400_000);
    }
    return nextCron(schedule, after);
}
export class HarnessRoutines {
    jobs = [];
    running = new Set();
    file;
    dispatch;
    now;
    timer = null;
    constructor(file, dispatch, now = Date.now, tickMs = 15_000) {
        this.file = file;
        this.dispatch = dispatch;
        this.now = now;
        try {
            this.jobs = JSON.parse(readFileSync(file, "utf8"));
        }
        catch {
            this.jobs = [];
        }
        privateFile(file);
        if (tickMs > 0) {
            this.timer = setInterval(() => void this.tick(), tickMs);
            this.timer.unref?.();
        }
    }
    list(botId) {
        return this.jobs.filter((job) => job.botId === botId).map((job) => structuredClone(job));
    }
    create(botId, input) {
        const name = String(input.name ?? "").trim();
        const prompt = String(input.prompt ?? "").trim();
        const schedule = input.schedule?.trim() || null;
        if (!name || name.length > 100)
            throw new Error("name required (max 100)");
        if (!prompt || prompt.length > 20_000)
            throw new Error("prompt required (max 20000)");
        const job = {
            id: newId(), botId, name, prompt, schedule, enabled: true, trigger: null,
            last_runs: [], nextRunAt: nextRun(schedule, this.now()),
        };
        this.jobs.push(job);
        this.persist();
        return structuredClone(job);
    }
    update(botId, id, patch) {
        const job = this.jobs.find((item) => item.botId === botId && item.id === id);
        if (!job)
            return null;
        if (patch.name !== undefined) {
            const name = String(patch.name).trim();
            if (!name || name.length > 100)
                throw new Error("name required (max 100)");
            job.name = name;
        }
        if (patch.prompt !== undefined) {
            const prompt = String(patch.prompt).trim();
            if (!prompt || prompt.length > 20_000)
                throw new Error("prompt required (max 20000)");
            job.prompt = prompt;
        }
        if (patch.schedule !== undefined) {
            job.schedule = String(patch.schedule).trim() || null;
            job.nextRunAt = nextRun(job.schedule, this.now());
        }
        if (patch.enabled !== undefined) {
            job.enabled = Boolean(patch.enabled);
            job.nextRunAt = job.enabled ? nextRun(job.schedule, this.now()) : null;
        }
        this.persist();
        return structuredClone(job);
    }
    delete(botId, id) {
        const before = this.jobs.length;
        this.jobs = this.jobs.filter((job) => job.botId !== botId || job.id !== id);
        if (this.jobs.length !== before)
            this.persist();
        return this.jobs.length !== before;
    }
    deleteBot(botId) {
        const before = this.jobs.length;
        this.jobs = this.jobs.filter((job) => job.botId !== botId);
        if (this.jobs.length !== before)
            this.persist();
    }
    async runNow(botId, id) {
        const job = this.jobs.find((item) => item.botId === botId && item.id === id);
        if (!job)
            return null;
        await this.run(job);
        return structuredClone(job);
    }
    async tick() {
        const now = this.now();
        const due = this.jobs.filter((job) => job.enabled && job.nextRunAt !== null && job.nextRunAt <= now);
        await Promise.all(due.map((job) => this.run(job)));
    }
    stop() {
        if (this.timer)
            clearInterval(this.timer);
        this.timer = null;
    }
    async run(job) {
        if (this.running.has(job.id))
            return;
        this.running.add(job.id);
        try {
            // Advance before dispatch: crash/restart cannot replay a token-spending turn.
            job.nextRunAt = job.enabled ? nextRun(job.schedule, this.now()) : null;
            await this.dispatch(job);
            job.last_runs.unshift({ at: new Date(this.now()).toISOString(), status: "queued" });
        }
        catch (error) {
            job.last_runs.unshift({
                at: new Date(this.now()).toISOString(),
                status: "error",
                error: error instanceof Error ? error.message : String(error),
            });
        }
        finally {
            job.last_runs = job.last_runs.slice(0, 20);
            this.running.delete(job.id);
            this.persist();
        }
    }
    persist() {
        mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
        privateDir(dirname(this.file));
        writeFileSync(this.file, JSON.stringify(this.jobs, null, 2), { mode: 0o600 });
        privateFile(this.file);
    }
}
