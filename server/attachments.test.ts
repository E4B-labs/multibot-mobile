import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { AttachmentStore, MAX_IMAGE_BYTES } from "./attachments.ts";

const roots: string[] = [];
const make = () => {
  const root = mkdtempSync(join(tmpdir(), "multibot-attachments-"));
  roots.push(root);
  return { root, store: new AttachmentStore(root) };
};

afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

describe("attachment store", () => {
  it("persists metadata, enforces ownership and deletes files with bot", () => {
    const { root, store } = make();
    const file = store.add("bot-a", "photo.png", "image/png", Buffer.from("png"));
    expect(store.resolve("bot-a", file.id)).toMatchObject(file);
    expect(() => store.resolve("bot-b", file.id)).toThrow(/no such attachment/);
    expect(new AttachmentStore(root).resolve("bot-a", file.id)).toMatchObject(file);
    store.deleteBot("bot-a");
    expect(existsSync(join(root, "bot-a"))).toBe(false);
  });

  it("rejects traversal, duplicate ids, count and image size limits", () => {
    const { store } = make();
    expect(() => store.add("bot", "../secret", "text/plain", Buffer.from("x"))).toThrow(/invalid file name/);
    expect(() => store.add("bot", "large.png", "image/png", Buffer.alloc(MAX_IMAGE_BYTES + 1))).toThrow(/8 MB/);
    const file = store.add("bot", "one.txt", "text/plain", Buffer.from("x"));
    expect(() => store.resolveMany("bot", [file.id, file.id])).toThrow(/invalid attachment ids/);
    expect(() => store.resolveMany("bot", Array.from({ length: 11 }, () => crypto.randomUUID()))).toThrow(/maximum 10/);
  });
});
