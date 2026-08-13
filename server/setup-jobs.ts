// multibot (G3): tiny durable background runner for provisioning and known CLI
// installers. Fixed commands only, shell=false, no elevation.
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { dirname } from "node:path";

import { newId } from "./contracts.ts";
import { resolveCliSpawn } from "./env-path.ts";

export type SetupJobStatus = "running" | "succeeded" | "failed";
export interface SetupJob {
  id: string;
  key: string;
  kind: "provision" | "cli-install";
  title: string;
  command: string;
  status: SetupJobStatus;
  output: string[];
  createdAt: number;
  finishedAt?: number;
  exitCode?: number | null;
  error?: string;
}

export interface JobSpec {
  key: string;
  kind: SetupJob["kind"];
  title: string;
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
}

export const jobProgress = (job: SetupJob) => ({
  id: job.id,
  step: job.title,
  message: job.output.at(-1) ?? job.title,
  done: job.status === "succeeded",
  ...(job.status === "failed" ? { error: job.error ?? "setup failed" } : {}),
});

type SpawnFn = (command: string, args: readonly string[], options: Record<string, unknown>) => ChildProcess;
type Listener = (job: SetupJob) => void;

export class SetupJobs {
  private jobs: SetupJob[] = [];
  private listeners = new Map<string, Set<Listener>>();
  private file: string;
  private onUpdate: Listener;
  private spawnFn: SpawnFn;

  constructor(
    file: string,
    onUpdate: Listener = () => {},
    spawnFn: SpawnFn = spawn as SpawnFn,
  ) {
    this.file = file;
    this.onUpdate = onUpdate;
    this.spawnFn = spawnFn;
    try {
      this.jobs = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      this.jobs = [];
    }
    let recovered = false;
    for (const job of this.jobs) {
      if (job.status !== "running") continue;
      job.status = "failed";
      job.finishedAt = Date.now();
      job.error = "server restarted before the job finished";
      job.output.push(job.error);
      recovered = true;
    }
    if (recovered) this.persist();
  }

  list() {
    return this.jobs.map((job) => ({ ...job, output: [...job.output] }));
  }

  get(id: string) {
    const job = this.jobs.find((item) => item.id === id);
    return job ? { ...job, output: [...job.output] } : null;
  }

  subscribe(id: string, listener: Listener) {
    const listeners = this.listeners.get(id) ?? new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(id, listeners);
    return () => {
      listeners.delete(listener);
      if (!listeners.size) this.listeners.delete(id);
    };
  }

  start(spec: JobSpec): SetupJob {
    const running = this.jobs.find((job) => job.key === spec.key && job.status === "running");
    if (running) return { ...running, output: [...running.output] };
    const command = [spec.command, ...spec.args].join(" ");
    const job: SetupJob = {
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
    let child: ChildProcess;
    try {
      child = this.spawnFn(resolved.command, resolved.args, {
        cwd: spec.cwd,
        env: { ...process.env, ...spec.env },
        shell: false,
        windowsHide: true,
        windowsVerbatimArguments: resolved.windowsVerbatimArguments,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      this.finish(job, null, error instanceof Error ? error.message : String(error));
      return this.get(job.id)!;
    }

    for (const stream of [child.stdout, child.stderr]) {
      if (!stream) continue;
      const lines = createInterface({ input: stream });
      lines.on("line", (line) => this.append(job, line));
    }
    let settled = false;
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      this.finish(job, null, error.message);
    });
    child.once("exit", (code) => {
      if (settled) return;
      settled = true;
      this.finish(job, code, code === 0 ? undefined : `${spec.command} exited with code ${code}`);
    });
    return this.get(job.id)!;
  }

  private append(job: SetupJob, line: string) {
    const text = line.trimEnd();
    if (!text) return;
    job.output.push(text.slice(0, 2_000));
    if (job.output.length > 200) job.output.splice(1, job.output.length - 200);
    this.emit(job);
  }

  private finish(job: SetupJob, exitCode: number | null, error?: string) {
    job.status = error ? "failed" : "succeeded";
    job.exitCode = exitCode;
    job.finishedAt = Date.now();
    if (error) {
      job.error = error;
      job.output.push(error);
    }
    this.emit(job);
  }

  private emit(job: SetupJob) {
    this.persist();
    const copy = { ...job, output: [...job.output] };
    this.onUpdate(copy);
    for (const listener of this.listeners.get(job.id) ?? []) listener(copy);
  }

  private persist() {
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(this.jobs, null, 2));
  }
}
