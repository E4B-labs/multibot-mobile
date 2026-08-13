// multibot (G3): tiny durable background runner for provisioning and known CLI
// installers. Fixed commands only, shell=false, no elevation.
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { dirname } from "node:path";
import { newId } from "./contracts.js";
import { resolveCliSpawn } from "./env-path.js";
export const jobProgress = (job) => ({
    id: job.id,
    step: job.title,
    message: job.output.at(-1) ?? job.title,
    done: job.status === "succeeded",
    ...(job.kind === "cli-login" ? { output: [...job.output] } : {}),
    ...(job.status === "failed" ? { error: job.error ?? "setup failed" } : {}),
});
export class SetupJobs {
    jobs = [];
    listeners = new Map();
    file;
    onUpdate;
    spawnFn;
    interactive = new Map();
    constructor(file, onUpdate = () => { }, spawnFn = spawn) {
        this.file = file;
        this.onUpdate = onUpdate;
        this.spawnFn = spawnFn;
        try {
            this.jobs = JSON.parse(readFileSync(file, "utf8"));
        }
        catch {
            this.jobs = [];
        }
        let recovered = false;
        for (const job of this.jobs) {
            if (job.status !== "running")
                continue;
            job.status = "failed";
            job.finishedAt = Date.now();
            job.error = "server restarted before the job finished";
            job.output.push(job.error);
            recovered = true;
        }
        if (recovered)
            this.persist();
    }
    list() {
        return this.jobs.map((job) => ({ ...job, output: [...job.output] }));
    }
    get(id) {
        const job = this.jobs.find((item) => item.id === id);
        return job ? { ...job, output: [...job.output] } : null;
    }
    subscribe(id, listener) {
        const listeners = this.listeners.get(id) ?? new Set();
        listeners.add(listener);
        this.listeners.set(id, listeners);
        return () => {
            listeners.delete(listener);
            if (!listeners.size)
                this.listeners.delete(id);
        };
    }
    start(spec) {
        const running = this.jobs.find((job) => job.key === spec.key && job.status === "running");
        if (running)
            return { ...running, output: [...running.output] };
        const command = [spec.command, ...spec.args].join(" ");
        const job = {
            id: newId(),
            key: spec.key,
            kind: spec.kind,
            title: spec.title,
            command,
            status: "running",
            output: [`$ ${command}`],
            createdAt: Date.now(),
        };
        this.jobs.unshift(job);
        this.jobs = this.jobs.slice(0, 20);
        this.emit(job);
        const resolved = resolveCliSpawn(spec.command, spec.args);
        let child;
        try {
            child = this.spawnFn(resolved.command, resolved.args, {
                cwd: spec.cwd,
                env: { ...process.env, ...spec.env },
                shell: false,
                windowsHide: true,
                windowsVerbatimArguments: resolved.windowsVerbatimArguments,
                stdio: ["ignore", "pipe", "pipe"],
            });
        }
        catch (error) {
            this.finish(job, null, error instanceof Error ? error.message : String(error));
            return this.get(job.id);
        }
        for (const stream of [child.stdout, child.stderr]) {
            if (!stream)
                continue;
            const lines = createInterface({ input: stream });
            lines.on("line", (line) => this.append(job, line));
        }
        let settled = false;
        child.once("error", (error) => {
            if (settled)
                return;
            settled = true;
            this.finish(job, null, error.message);
        });
        child.once("exit", (code) => {
            if (settled)
                return;
            settled = true;
            this.finish(job, code, code === 0 ? undefined : `${spec.command} exited with code ${code}`);
        });
        return this.get(job.id);
    }
    /** Start fixed CLI login command with stdin kept open for OAuth prompts. */
    startInteractive(spec) {
        const running = this.jobs.find((job) => job.key === spec.key && job.status === "running");
        if (running)
            return { ...running, output: [...running.output] };
        const command = [spec.command, ...spec.args].join(" ");
        const job = {
            id: newId(), key: spec.key, kind: spec.kind, title: spec.title, command,
            status: "running", output: [`$ ${command}`], createdAt: Date.now(),
        };
        this.jobs.unshift(job);
        this.jobs = this.jobs.slice(0, 20);
        this.emit(job);
        const resolved = resolveCliSpawn(spec.command, spec.args);
        let child;
        try {
            child = this.spawnFn(resolved.command, resolved.args, {
                cwd: spec.cwd,
                env: { ...process.env, ...spec.env },
                shell: false,
                windowsHide: true,
                windowsVerbatimArguments: resolved.windowsVerbatimArguments,
                stdio: ["pipe", "pipe", "pipe"],
            });
        }
        catch (error) {
            this.finish(job, null, error instanceof Error ? error.message : String(error));
            return this.get(job.id);
        }
        this.interactive.set(job.id, child);
        for (const stream of [child.stdout, child.stderr]) {
            if (!stream)
                continue;
            createInterface({ input: stream }).on("line", (line) => this.append(job, line));
        }
        let settled = false;
        const done = (code, error) => {
            if (settled)
                return;
            settled = true;
            this.interactive.delete(job.id);
            this.finish(job, code, error);
        };
        child.once("error", (error) => done(null, error.message));
        child.once("exit", (code) => done(code, code === 0 ? undefined : `${spec.command} exited with code ${code}`));
        return this.get(job.id);
    }
    input(id, text) {
        if (text.length > 20_000)
            throw new Error("input too large");
        const child = this.interactive.get(id);
        if (!child?.stdin?.writable)
            return false;
        child.stdin.write(text.endsWith("\n") ? text : `${text}\n`);
        return true;
    }
    stop(id) {
        const child = this.interactive.get(id);
        if (!child)
            return false;
        child.kill();
        return true;
    }
    append(job, line) {
        const text = line.trimEnd();
        if (!text)
            return;
        job.output.push(text.slice(0, 2_000));
        if (job.output.length > 200)
            job.output.splice(1, job.output.length - 200);
        this.emit(job);
    }
    finish(job, exitCode, error) {
        job.status = error ? "failed" : "succeeded";
        job.exitCode = exitCode;
        job.finishedAt = Date.now();
        if (error) {
            job.error = error;
            job.output.push(error);
        }
        this.emit(job);
    }
    emit(job) {
        this.persist();
        const copy = { ...job, output: [...job.output] };
        this.onUpdate(copy);
        for (const listener of this.listeners.get(job.id) ?? [])
            listener(copy);
    }
    persist() {
        mkdirSync(dirname(this.file), { recursive: true });
        writeFileSync(this.file, JSON.stringify(this.jobs, null, 2));
    }
}
