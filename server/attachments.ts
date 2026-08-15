import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";

import { DATA_DIR } from "./config.ts";
import { newId, type AttachmentMeta } from "./contracts.ts";

export const MAX_ATTACHMENTS = 10;
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

interface StoredAttachment extends AttachmentMeta {
  botId: string;
  storedName: string;
}

const cleanName = (value: string) => {
  const name = value.trim();
  if (!name || name.length > 180 || name === "." || name === ".." || /[\\/\0]/.test(name)) {
    throw Object.assign(new Error("invalid file name"), { status: 422 });
  }
  return name;
};

export class AttachmentStore {
  private readonly root: string;
  private readonly manifest: string;
  private data: StoredAttachment[];

  constructor(root = join(DATA_DIR, "attachments")) {
    this.root = resolve(root);
    this.manifest = join(this.root, "attachments.json");
    try {
      this.data = JSON.parse(readFileSync(this.manifest, "utf8"));
    } catch {
      this.data = [];
    }
  }

  add(botId: string, name: string, mime: string, bytes: Buffer): AttachmentMeta {
    const safeName = cleanName(name);
    const safeMime = /^[\w.+-]+\/[\w.+-]+$/i.test(mime) ? mime.toLowerCase() : "application/octet-stream";
    const limit = safeMime.startsWith("image/") ? MAX_IMAGE_BYTES : MAX_FILE_BYTES;
    if (!bytes.length) throw Object.assign(new Error("empty file"), { status: 422 });
    if (bytes.length > limit) throw Object.assign(new Error(`file exceeds ${limit / 1024 / 1024} MB limit`), { status: 413 });
    const id = newId();
    const dir = this.botDir(botId);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const storedName = id;
    writeFileSync(join(dir, storedName), bytes, { mode: 0o600 });
    const record: StoredAttachment = { id, botId, name: safeName, mime: safeMime, size: bytes.length, storedName };
    this.data.push(record);
    this.save();
    return this.public(record);
  }

  resolve(botId: string, id: string): StoredAttachment & { path: string } {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw Object.assign(new Error("invalid attachment id"), { status: 422 });
    const record = this.data.find((item) => item.id === id && item.botId === botId);
    if (!record) throw Object.assign(new Error("no such attachment"), { status: 404 });
    const path = resolve(this.botDir(botId), record.storedName);
    if (!path.startsWith(`${this.botDir(botId)}${sep}`) || !existsSync(path)) {
      throw Object.assign(new Error("attachment file missing"), { status: 404 });
    }
    return { ...record, path };
  }

  resolveMany(botId: string, ids: unknown): Array<StoredAttachment & { path: string }> {
    if (!Array.isArray(ids)) return [];
    if (ids.length > MAX_ATTACHMENTS) throw Object.assign(new Error(`maximum ${MAX_ATTACHMENTS} attachments`), { status: 422 });
    if (new Set(ids).size !== ids.length || ids.some((id) => typeof id !== "string")) {
      throw Object.assign(new Error("invalid attachment ids"), { status: 422 });
    }
    return ids.map((id) => this.resolve(botId, id));
  }

  deleteBot(botId: string): void {
    const dir = this.botDir(botId);
    if (dir.startsWith(`${this.root}${sep}`)) rmSync(dir, { recursive: true, force: true });
    const before = this.data.length;
    this.data = this.data.filter((item) => item.botId !== botId);
    if (this.data.length !== before) this.save();
  }

  private botDir(botId: string): string {
    if (!/^[\w-]+$/.test(botId)) throw Object.assign(new Error("invalid bot id"), { status: 422 });
    return resolve(this.root, botId);
  }

  private public(record: StoredAttachment): AttachmentMeta {
    return { id: record.id, name: record.name, mime: record.mime, size: record.size };
  }

  private save(): void {
    mkdirSync(dirname(this.manifest), { recursive: true, mode: 0o700 });
    writeFileSync(this.manifest, JSON.stringify(this.data, null, 2), { mode: 0o600 });
  }
}
