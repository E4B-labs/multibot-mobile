import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DATA_DIR } from "./config.js";
import { newId } from "./contracts.js";
const FILE = join(DATA_DIR, "groups.json");
/** Small durable shadow for engine groups; engine remains source of turn execution. */
export class GroupStore {
    groups;
    file;
    constructor(file = FILE) {
        this.file = file;
        mkdirSync(dirname(file), { recursive: true });
        try {
            const parsed = JSON.parse(readFileSync(file, "utf8"));
            this.groups = Array.isArray(parsed) ? parsed : [];
        }
        catch {
            this.groups = [];
        }
        this.groups = this.groups.filter((g) => g && typeof g.id === "string");
    }
    save() {
        writeFileSync(this.file, JSON.stringify(this.groups, null, 2));
    }
    list() {
        return this.groups.map((g) => ({ ...g, bot_ids: [...g.bot_ids], messages: [...g.messages] }));
    }
    get(id) {
        const group = this.groups.find((g) => g.id === id);
        return group ? { ...group, bot_ids: [...group.bot_ids], messages: [...group.messages] } : null;
    }
    delete(id) {
        const before = this.groups.length;
        this.groups = this.groups.filter((group) => group.id !== id);
        if (this.groups.length === before)
            return false;
        this.save();
        return true;
    }
    upsert(input) {
        const existing = input.id ? this.groups.find((g) => g.id === input.id) : undefined;
        if (existing) {
            existing.name = input.name;
            existing.bot_ids = [...input.bot_ids];
            this.save();
            return this.get(existing.id);
        }
        const group = {
            id: input.id || newId(),
            name: input.name,
            bot_ids: [...input.bot_ids],
            createdAt: Date.now(),
            messages: [],
        };
        this.groups.unshift(group);
        this.save();
        return this.get(group.id);
    }
    append(id, message) {
        const group = this.groups.find((g) => g.id === id);
        if (!group)
            return null;
        const full = { id: newId(), at: message.at ?? Date.now(), ...message };
        group.messages.push(full);
        this.save();
        return full;
    }
}
