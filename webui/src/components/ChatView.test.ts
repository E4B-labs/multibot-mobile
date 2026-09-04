import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// multibot: awatar w pasku nad rozmową ma stać nieruchomo, gdy bot nie
// pracuje. Wcześniej MausAvatar w nagłówku szedł własną ścieżką (stateForBot
// + jednorazowy beat z `state.mascotMotion`, bez `animated`), więc bezczynny
// bot mrugał i oddychał, choć ten sam bot w szufladzie już stał.
const chat = readFileSync(new URL("./ChatView.tsx", import.meta.url), "utf8");

describe("awatar w nagłówku czatu", () => {
  it("liczy propsy tym samym helperem co szuflada", () => {
    expect(chat).toContain("sidebarAvatarProps(bot)");
    expect(chat).toContain("{...headerAvatar}");
  });

  it("nie odtwarza jednorazowego beatu ze store'u", () => {
    expect(chat, "nagłówek znowu animuje bezczynnego bota").not.toContain("state.mascotMotion");
  });
});
