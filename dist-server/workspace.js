// multibot: provider-neutral bot workspace. One durable JSON file holds UI
// memory, reusable instructions, policy switches and normalized usage.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DATA_DIR } from "./config.js";
import { newId } from "./contracts.js";
const DEFAULT_PERMISSIONS = {
    browser: true,
    delegation: true,
    file: true,
    memory: true,
    skills: true,
    terminal: true,
};
const empty = () => ({
    facts: [],
    markdown: "",
    skills: [],
    autonomy: "approval",
    permissions: { ...DEFAULT_PERMISSIONS },
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, turns: 0 },
});
function privateMode(path, mode) {
    if (process.platform !== "win32" && existsSync(path))
        chmodSync(path, mode);
}
function text(value, field, max) {
    const out = String(value ?? "").trim();
    if (!out || out.length > max)
        throw Object.assign(new Error(`${field} required (max ${max})`), { status: 422 });
    return out;
}
export class WorkspaceStore {
    data = {};
    file;
    constructor(file = join(DATA_DIR, "workspace.json")) {
        this.file = file;
        try {
            this.data = JSON.parse(readFileSync(file, "utf8"));
        }
        catch {
            this.data = {};
        }
        privateMode(file, 0o600);
    }
    deleteBot(botId) {
        if (delete this.data[botId])
            this.save();
    }
    facts(botId) {
        return structuredClone(this.get(botId).facts);
    }
    addFact(botId, value) {
        const fact = {
            id: newId(),
            text: text(value.text, "text", 20_000),
            ...(String(value.source ?? "").trim() ? { source: String(value.source).trim().slice(0, 200) } : {}),
            created_at: new Date().toISOString(),
        };
        this.get(botId).facts.unshift(fact);
        this.save();
        return structuredClone(fact);
    }
    patchFact(botId, id, value) {
        const fact = this.get(botId).facts.find((item) => item.id === id);
        if (!fact)
            return null;
        if (value.text !== undefined)
            fact.text = text(value.text, "text", 20_000);
        if (value.source !== undefined) {
            const source = String(value.source ?? "").trim();
            if (source)
                fact.source = source.slice(0, 200);
            else
                delete fact.source;
        }
        this.save();
        return structuredClone(fact);
    }
    deleteFact(botId, id) {
        const workspace = this.get(botId);
        const before = workspace.facts.length;
        workspace.facts = workspace.facts.filter((fact) => fact.id !== id);
        if (workspace.facts.length !== before)
            this.save();
        return workspace.facts.length !== before;
    }
    markdown(botId) {
        return { content: this.get(botId).markdown };
    }
    putMarkdown(botId, content) {
        const value = String(content ?? "");
        if (value.length > 500_000)
            throw Object.assign(new Error("content exceeds 500000 characters"), { status: 422 });
        this.get(botId).markdown = value;
        this.save();
        return { content: value };
    }
    skills(botId) {
        return structuredClone(this.get(botId).skills);
    }
    addSkill(botId, value) {
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
    patchSkill(botId, name, value) {
        const skill = this.get(botId).skills.find((item) => item.name === name);
        if (!skill)
            return null;
        if (value.description !== undefined)
            skill.description = String(value.description).trim().slice(0, 2_000);
        if (value.instructions !== undefined)
            skill.instructions = text(value.instructions, "instructions", 100_000);
        if (value.enabled !== undefined)
            skill.enabled = Boolean(value.enabled);
        this.save();
        return structuredClone(skill);
    }
    deleteSkill(botId, name) {
        const workspace = this.get(botId);
        const before = workspace.skills.length;
        workspace.skills = workspace.skills.filter((skill) => skill.name !== name);
        if (workspace.skills.length !== before)
            this.save();
        return workspace.skills.length !== before;
    }
    autonomy(botId) {
        return { autonomy: this.get(botId).autonomy };
    }
    setAutonomy(botId, value) {
        if (value !== "approval" && value !== "autonomous") {
            throw Object.assign(new Error("autonomy must be approval or autonomous"), { status: 422 });
        }
        this.get(botId).autonomy = value;
        this.save();
        return { autonomy: value };
    }
    permissions(botId) {
        return { ...this.get(botId).permissions };
    }
    setPermissions(botId, patch) {
        if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
            throw Object.assign(new Error("permissions map required"), { status: 422 });
        }
        const workspace = this.get(botId);
        for (const [key, enabled] of Object.entries(patch)) {
            if (!/^[a-z][a-z0-9_]{0,63}$/.test(key) || typeof enabled !== "boolean") {
                throw Object.assign(new Error("permissions must map toolset names to booleans"), { status: 422 });
            }
            workspace.permissions[key] = enabled;
        }
        this.save();
        return { ...workspace.permissions };
    }
    usage(botId) {
        return { ...this.get(botId).usage };
    }
    recordTokens(botId, input, output) {
        const usage = this.get(botId).usage;
        usage.prompt_tokens += Math.max(0, Number(input) || 0);
        usage.completion_tokens += Math.max(0, Number(output) || 0);
        usage.total_tokens = usage.prompt_tokens + usage.completion_tokens;
        this.save();
    }
    recordTurn(botId) {
        this.get(botId).usage.turns++;
        this.save();
    }
    get(botId) {
        return (this.data[botId] ??= empty());
    }
    save() {
        const dir = dirname(this.file);
        mkdirSync(dir, { recursive: true, mode: 0o700 });
        privateMode(dir, 0o700);
        writeFileSync(this.file, JSON.stringify(this.data, null, 2), { mode: 0o600 });
        privateMode(this.file, 0o600);
    }
}
