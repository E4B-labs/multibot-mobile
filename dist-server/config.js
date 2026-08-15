// Config + data dirs. One file, ~/.openmausbot/config.json, env fallbacks:
//   { "xai": {"key":"xai-…"}, "composio": {"key":"ck_…"}, "box": {"token":"…"},
//     "instances": { "<instanceId>": {"driver":"grok", …} } }
import { chmodSync, readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
export const DATA_DIR = join(homedir(), ".openmausbot");
const LEGACY_DATA_DIR = join(homedir(), ".opengrokbot");
export const EVENTS_DIR = join(DATA_DIR, "events");
export const NATIVE_DIR = join(DATA_DIR, "native");
function chmodPrivate(path, mode) {
    if (process.platform !== "win32" && existsSync(path))
        chmodSync(path, mode);
}
export function ensureDirs() {
    // one-time migration from the pre-rename data dir — bots, transcripts,
    // config and keys all carry over
    if (!existsSync(DATA_DIR) && existsSync(LEGACY_DATA_DIR)) {
        try {
            renameSync(LEGACY_DATA_DIR, DATA_DIR);
        }
        catch {
            /* cross-device or busy — fall through to a fresh dir */
        }
    }
    for (const dir of [DATA_DIR, EVENTS_DIR, NATIVE_DIR]) {
        mkdirSync(dir, { recursive: true, mode: 0o700 });
        chmodPrivate(dir, 0o700);
    }
    chmodPrivate(join(DATA_DIR, "config.json"), 0o600);
}
export function loadConfig() {
    let cfg = {};
    try {
        cfg = JSON.parse(readFileSync(join(DATA_DIR, "config.json"), "utf8"));
    }
    catch {
        /* first run — env fallbacks below */
    }
    cfg.xai = { key: process.env.XAI_API_KEY, ...cfg.xai };
    cfg.composio = { key: process.env.COMPOSIO_KEY, ...cfg.composio };
    cfg.box = { token: process.env.BOX_TOKEN, ...cfg.box };
    return cfg;
}
/** Merge a partial config into ~/.openmausbot/config.json (secrets never
 * echoed back — callers report configured-or-not booleans only). */
export function saveConfig(patch) {
    const p = join(DATA_DIR, "config.json");
    let disk = {};
    try {
        disk = JSON.parse(readFileSync(p, "utf8"));
    }
    catch {
        /* first write */
    }
    // multibot (F7): `mcpConnectors` dołącza do listy — merge po kluczu, więc
    // zapis jednego konektora nie kasuje reszty, a `undefined` w wartości kasuje
    // wpis (JSON.stringify pomija takie pole).
    for (const key of [
        "auth",
        "xai",
        "composio",
        "box",
        "profile",
        "mcpConnectors",
        "firebase",
        "deviceSessions",
    ]) {
        if (patch[key] && typeof patch[key] === "object") {
            disk[key] = { ...disk[key], ...patch[key] };
        }
    }
    // multibot (G1): callers replace the complete instance map. This makes
    // DELETE real (object merge cannot remove an instance) while preserving all
    // unrelated top-level config and secrets.
    if (patch.instances !== undefined)
        disk.instances = patch.instances;
    mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
    chmodPrivate(DATA_DIR, 0o700);
    chmodPrivate(p, 0o600);
    writeFileSync(p, JSON.stringify(disk, null, 2), { mode: 0o600 });
    chmodPrivate(p, 0o600);
}
// multibot (G1): stable built-in ids double as reserved custom-model ids and
// the allow-list for CLI toggles. `computer` is not a command-line tool.
export const DEFAULT_INSTANCE_CONFIGS = {
    // multibot: embedded engine is first-class runtime, not a visible vendor.
    // `driver: "slafy"` remains internal; UI label stays neutral.
    local: { driver: "slafy", displayName: "Local model" },
    grok: { driver: "grokAgent" },
    gemini: { driver: "geminiAgent" },
    // multibot (G3): official ACP stdio CLIs.
    kimi: { driver: "kimiAgent" },
    qwen: { driver: "qwenAgent" },
    claude: { driver: "claudeAgent" },
    codex: { driver: "codex" },
    computer: { driver: "boxAgent" },
};
// multibot (G3): Kimi/Qwen share the same durable allow switch API.
export const BUILT_IN_CLI_IDS = ["grok", "gemini", "claude", "codex", "kimi", "qwen"];
// Default fleet: one instance per built-in driver (upstream
// defaultInstanceIdForDriver — instanceId defaults to the driver kind).
// Config-file keys are injected as per-instance environment so drivers
// see them without needing real process env vars.
export function instanceConfigs(cfg) {
    // The default `grok` instance rides the `grokAgent` driver, not the API-key
    // one: like claude and codex it needs no credential from us, just the CLI
    // installed and logged in (it shows up unavailable otherwise). The API-key
    // `grok` driver stays registered but out of the default fleet — that key is
    // a credential Milind doesn't want to manage; an `instances` entry brings
    // it back anytime.
    // multibot (G1): configured instances are an overlay, never a replacement;
    // adding one custom model must not erase the built-in CLI fleet.
    const map = {};
    const configuredInstances = {
        ...DEFAULT_INSTANCE_CONFIGS,
        ...(cfg.instances ?? {}),
    };
    for (const [id, configured] of Object.entries(configuredInstances)) {
        const model = configured.model;
        const entry = {
            ...configured,
            ...(configured.driver === "slafy" && model
                ? { config: { ...(configured.config ?? {}), model } }
                : {}),
        };
        entry.environment = {
            ...(cfg.xai?.key ? { XAI_API_KEY: cfg.xai.key } : {}),
            ...(cfg.box?.token ? { BOX_TOKEN: cfg.box.token } : {}),
            ...entry.environment,
        };
        map[id] = entry;
    }
    return map;
}
