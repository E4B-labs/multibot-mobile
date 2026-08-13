// multibot: provider-neutral bot workspace. One durable JSON file holds UI
// memory, reusable instructions, policy switches and normalized usage.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { DATA_DIR } from "./config.ts";
import { newId } from "./contracts.ts";

export interface WorkspaceFact {
  id: string;
  text: string;
  source?: string;
  created_at: string;
}

export interface WorkspaceSkill {
  name: string;
  description: string;
  instructions: string;
  enabled: boolean;
}

export interface WorkspaceUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  turns: number;
}

interface BotWorkspace {
  facts: WorkspaceFact[];
  markdown: string;
  skills: WorkspaceSkill[];
  autonomy: "approval" | "autonomous";
  permissions: Record<string, boolean>;
  usage: WorkspaceUsage;
}

const DEFAULT_PERMISSIONS = {
  browser: true,
  delegation: true,
  file: true,
  integrations: true,
  memory: true,
  skills: true,
  terminal: true,
};

const empty = (): BotWorkspace => ({
  facts: [],
  markdown: "",
  skills: [],
  autonomy: "approval",
  permissions: { ...DEFAULT_PERMISSIONS },
  usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, turns: 0 },
});

function privateMode(path: string, mode: number): void {
  if (process.platform !== "win32" && existsSync(path)) chmodSync(path, mode);
}

function text(value: unknown, field: string, max: number): string {
  const out = String(value ?? "").trim();
  if (!out || out.length > max) throw Object.assign(new Error(`${field} required (max ${max})`), { status: 422 });
  return out;
}

export class WorkspaceStore {
  private data: Record<string, BotWorkspace> = {};
  private file: string;

  constructor(file = join(DATA_DIR, "workspace.json")) {
    this.file = file;
    try {
      this.data = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      this.data = {};
    }
    privateMode(file, 0o600);
  }

  deleteBot(botId: string): void {
    if (delete this.data[botId]) this.save();
  }

  facts(botId: string): WorkspaceFact[] {
    return structuredClone(this.get(botId).facts);
  }

  addFact(botId: string, value: { text?: unknown; source?: unknown }): WorkspaceFact {
    const fact: WorkspaceFact = {
      id: newId(),
      text: text(value.text, "text", 20_000),
      ...(String(value.source ?? "").trim() ? { source: String(value.source).trim().slice(0, 200) } : {}),
      created_at: new Date().toISOString(),
    };
    this.get(botId).facts.unshift(fact);
    this.save();
    return structuredClone(fact);
  }

  patchFact(botId: string, id: string, value: { text?: unknown; source?: unknown }): WorkspaceFact | null {
    const fact = this.get(botId).facts.find((item) => item.id === id);
    if (!fact) return null;
    if (value.text !== undefined) fact.text = text(value.text, "text", 20_000);
    if (value.source !== undefined) {
      const source = String(value.source ?? "").trim();
      if (source) fact.source = source.slice(0, 200);
      else delete fact.source;
    }
    this.save();
    return structuredClone(fact);
  }

  deleteFact(botId: string, id: string): boolean {
    const workspace = this.get(botId);
    const before = workspace.facts.length;
    workspace.facts = workspace.facts.filter((fact) => fact.id !== id);
    if (workspace.facts.length !== before) this.save();
    return workspace.facts.length !== before;
  }

  markdown(botId: string): { content: string } {
    return { content: this.get(botId).markdown };
  }

  putMarkdown(botId: string, content: unknown): { content: string } {
    const value = String(content ?? "");
    if (value.length > 500_000) throw Object.assign(new Error("content exceeds 500000 characters"), { status: 422 });
    this.get(botId).markdown = value;
    this.save();
    return { content: value };
  }

  skills(botId: string): WorkspaceSkill[] {
    return structuredClone(this.get(botId).skills);
  }

  addSkill(botId: string, value: Partial<WorkspaceSkill>): WorkspaceSkill {
    const workspace = this.get(botId);
    const name = text(value.name, "name", 80);
    if (workspace.skills.some((skill) => skill.name.toLowerCase() === name.toLowerCase())) {
      throw Object.assign(new Error("skill already exists"), { status: 409 });
    }
    const skill = {
      name,
      description: String(value.description ?? "").trim().slice(0, 2_000),
      instructions: text(value.instructions, "instructions", 100_000),
      enabled: value.enabled !== false,
    };
    workspace.skills.push(skill);
    this.save();
    return structuredClone(skill);
  }

  patchSkill(botId: string, name: string, value: Partial<WorkspaceSkill>): WorkspaceSkill | null {
    const skill = this.get(botId).skills.find((item) => item.name === name);
    if (!skill) return null;
    if (value.description !== undefined) skill.description = String(value.description).trim().slice(0, 2_000);
    if (value.instructions !== undefined) skill.instructions = text(value.instructions, "instructions", 100_000);
    if (value.enabled !== undefined) skill.enabled = Boolean(value.enabled);
    this.save();
    return structuredClone(skill);
  }

  deleteSkill(botId: string, name: string): boolean {
    const workspace = this.get(botId);
    const before = workspace.skills.length;
    workspace.skills = workspace.skills.filter((skill) => skill.name !== name);
    if (workspace.skills.length !== before) this.save();
    return workspace.skills.length !== before;
  }

  autonomy(botId: string): { autonomy: "approval" | "autonomous" } {
    return { autonomy: this.get(botId).autonomy };
  }

  setAutonomy(botId: string, value: unknown): { autonomy: "approval" | "autonomous" } {
    if (value !== "approval" && value !== "autonomous") {
      throw Object.assign(new Error("autonomy must be approval or autonomous"), { status: 422 });
    }
    this.get(botId).autonomy = value;
    this.save();
    return { autonomy: value };
  }

  permissions(botId: string): Record<string, boolean> {
    return { ...this.get(botId).permissions };
  }

  setPermissions(botId: string, patch: unknown): Record<string, boolean> {
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
      throw Object.assign(new Error("permissions map required"), { status: 422 });
    }
    const workspace = this.get(botId);
    for (const [key, enabled] of Object.entries(patch as Record<string, unknown>)) {
      if (!/^[a-z][a-z0-9_]{0,63}$/.test(key) || typeof enabled !== "boolean") {
        throw Object.assign(new Error("permissions must map toolset names to booleans"), { status: 422 });
      }
      workspace.permissions[key] = enabled;
    }
    this.save();
    return { ...workspace.permissions };
  }

  usage(botId: string): WorkspaceUsage {
    return { ...this.get(botId).usage };
  }

  recordTokens(botId: string, input: number, output: number): void {
    const usage = this.get(botId).usage;
    usage.prompt_tokens += Math.max(0, Number(input) || 0);
    usage.completion_tokens += Math.max(0, Number(output) || 0);
    usage.total_tokens = usage.prompt_tokens + usage.completion_tokens;
    this.save();
  }

  recordTurn(botId: string): void {
    this.get(botId).usage.turns++;
    this.save();
  }

  private get(botId: string): BotWorkspace {
    return (this.data[botId] ??= empty());
  }

  private save(): void {
    const dir = dirname(this.file);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    privateMode(dir, 0o700);
    writeFileSync(this.file, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    privateMode(this.file, 0o600);
  }
}
