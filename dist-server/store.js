// Bot + thread persistence. bots.json holds bot records (including the
// thread→instance binding and per-instance resume cursors — upstream's
// ProviderSessionDirectory, recipe step 6: persist the binding from day
// one). messages-<threadId>.json holds the folded transcript.
import { readFileSync, writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "./config.js";
import { newId } from "./contracts.js";
const BOTS_FILE = join(DATA_DIR, "bots.json");
const messagesFile = (threadId) => join(DATA_DIR, `messages-${threadId}.json`);
const COLORS = [
    "green",
    "blue",
    "red",
    "orange",
    "purple",
    "cyan",
    "pink",
    "yellow",
    "teal",
    "coral",
];
// multibot (F9): głębokość łańcucha ask_bot. Wołający DEKLARUJE ją w ciele
// żądania (proxy dostaje ją w env przy spawnie), ale deklaracja bywa nieaktualna:
// bot silnika ma agents zamontowane na stałe w profilu, więc jego `OMB_TURN_DEPTH`
// zamarza na 0 i każdy hop resetowałby licznik — A→B→A→… bez dna. Harness zna
// prawdziwą głębokość tury, która u wołającego TERAZ trwa, i to ona wygrywa.
/** Głębokość łańcucha dla żądania ask_bot: większa z deklarowanej i faktycznej.
 * `activeDepth` = `commsDepth` tury trwającej u wołającego (undefined = nie ma). */
export function chainDepth(claimed, activeDepth) {
    return Math.max(Number(claimed ?? 0) || 0, activeDepth ?? 0);
}
/** Resolve @mentions in a message against a bot roster: `@` must start a
 * word, names match case-insensitively, longest name wins (so "@New Bot 2"
 * never half-matches "New Bot"), hidden bots skipped, results deduped.
 * Callers pre-filter the sender out of `peers`. */
export function mentionedBots(text, peers) {
    const candidates = peers
        .filter((p) => !p.hidden && p.name.trim())
        .sort((a, b) => b.name.length - a.name.length);
    const lower = text.toLowerCase();
    const found = [];
    let at = -1;
    while ((at = lower.indexOf("@", at + 1)) !== -1) {
        if (at > 0 && !/\s/.test(text[at - 1]))
            continue; // user@host, not a tag
        const rest = lower.slice(at + 1);
        const hit = candidates.find((p) => rest.startsWith(p.name.toLowerCase()));
        if (hit && !found.includes(hit))
            found.push(hit);
    }
    return found;
}
const onboardingCard = () => ({
    title: "What do you mostly want help with?",
    subtitle: "Pick whatever's closest; we can always expand from there.",
    options: ["Work & projects", "Writing & research", "Life admin", "A bit of everything"],
});
export class Store {
    bots = [];
    messages = new Map();
    defaultSelection;
    constructor(defaultSelection) {
        this.defaultSelection = defaultSelection;
        mkdirSync(DATA_DIR, { recursive: true });
        try {
            this.bots = JSON.parse(readFileSync(BOTS_FILE, "utf8"));
        }
        catch {
            this.bots = [];
        }
        // busy never survives a restart — no turn does either
        for (const b of this.bots)
            b.busy = false;
    }
    saveBots() {
        writeFileSync(BOTS_FILE, JSON.stringify(this.bots, null, 2));
    }
    messagesFor(threadId) {
        let list = this.messages.get(threadId);
        if (!list) {
            try {
                list = JSON.parse(readFileSync(messagesFile(threadId), "utf8"));
            }
            catch {
                list = [];
            }
            this.messages.set(threadId, list);
        }
        return list;
    }
    appendMessage(threadId, message) {
        const full = { id: newId(), at: Date.now(), ...message };
        const list = this.messagesFor(threadId);
        list.push(full);
        writeFileSync(messagesFile(threadId), JSON.stringify(list, null, 2));
        return full;
    }
    patchMessage(threadId, messageId, patch) {
        const list = this.messagesFor(threadId);
        const idx = list.findIndex((m) => m.id === messageId);
        if (idx === -1)
            return null;
        list[idx] = { ...list[idx], ...patch, card: patch.card ?? list[idx].card };
        writeFileSync(messagesFile(threadId), JSON.stringify(list, null, 2));
        return list[idx];
    }
    bot(id) {
        return this.bots.find((b) => b.id === id) ?? null;
    }
    botByThread(threadId) {
        return this.bots.find((b) => b.threadId === threadId) ?? null;
    }
    createBot() {
        const bot = {
            id: newId(),
            threadId: newId(),
            name: "New Bot",
            title: "",
            description: "",
            notifications: true,
            color: COLORS[this.bots.length % COLORS.length],
            unread: false,
            modelSelection: this.defaultSelection(),
            resumeCursors: {},
            createdAt: Date.now(),
        };
        this.bots.unshift(bot);
        this.saveBots();
        this.appendMessage(bot.threadId, {
            role: "bot",
            kind: "text",
            text: "Hey — I'm your new bot. Nice to meet you.",
        });
        this.appendMessage(bot.threadId, { role: "bot", kind: "options", card: onboardingCard() });
        return bot;
    }
    deleteBot(id) {
        const bot = this.bot(id);
        if (!bot)
            return false;
        this.bots = this.bots.filter((b) => b.id !== id);
        this.messages.delete(bot.threadId);
        this.saveBots();
        try {
            unlinkSync(messagesFile(bot.threadId));
        }
        catch { }
        return true;
    }
    patchBot(id, patch) {
        const bot = this.bot(id);
        if (!bot)
            return null;
        Object.assign(bot, patch);
        this.saveBots();
        return bot;
    }
    setResumeCursor(botId, instanceId, cursor) {
        const bot = this.bot(botId);
        if (!bot)
            return;
        bot.resumeCursors[instanceId] = cursor;
        this.saveBots();
    }
    /** multibot (G1): repair selections whose instance disappeared from fleet.
     * Prefer a configured custom model, then any live provider, then an explicit
     * empty selection. One write covers every migrated bot. */
    migrateOrphanedSelections(targets) {
        const known = new Set(targets.map((target) => target.instanceId));
        const fallback = targets.find((target) => target.driverKind === "slafy") ??
            targets.find((target) => target.snapshot.state === "available");
        let changed = 0;
        for (const bot of this.bots) {
            if (known.has(bot.modelSelection.instanceId))
                continue;
            bot.modelSelection = fallback
                ? { instanceId: fallback.instanceId, model: fallback.models.default }
                : { instanceId: "", model: "" };
            changed++;
        }
        if (changed)
            this.saveBots();
        return changed;
    }
    /** First-run seed: one bot so the app never opens empty. */
    seedIfEmpty() {
        if (this.bots.length)
            return;
        const bot = this.createBot();
        this.patchBot(bot.id, { name: "Milind", color: "blue" });
    }
}
