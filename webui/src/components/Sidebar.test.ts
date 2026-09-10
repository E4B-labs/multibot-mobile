import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Bot } from "@/state/store";
import { groupMemberAvatarProps, hiddenBotsForSidebar, sidebarAvatarProps } from "./Sidebar";

describe("hidden bot recovery", () => {
  it("keeps hidden bots available for sidebar recovery", () => {
    const hidden = { id: "hidden", hidden: true } as any;
    const visible = { id: "visible", hidden: false } as any;
    expect(hiddenBotsForSidebar([visible, hidden])).toEqual([hidden]);
  });
});

describe("mobile bot sections", () => {
  it("keeps the desktop section workflow available in the mobile drawer", () => {
    const sidebar = readFileSync(new URL("./Sidebar.tsx", import.meta.url), "utf8");
    expect(sidebar).toContain("sectionPicker");
    expect(sidebar).toContain("collapsedSections");
    expect(sidebar).toContain("sectionedBots");
    expect(sidebar).toContain("SectionPicker");
    expect(sidebar).toContain("onMoveToSection");
    expect(sidebar).not.toContain('disabled: true,\n          hint: "Coming soon"');
  });
});

describe("sidebar search", () => {
  it("opens the shared CmdK palette instead of a second local popover", () => {
    const sidebar = readFileSync(new URL("./Sidebar.tsx", import.meta.url), "utf8");
    expect(sidebar).toContain('new CustomEvent("mb:cmdk:open")');
    expect(sidebar).not.toContain("searchOpen");
    expect(sidebar).not.toContain("SearchPalette");
    expect(sidebar).not.toContain("data-search-menu");
  });
});

describe("plugins menu icon", () => {
  it("does not render an escaped newline next to the Plug icon", () => {
    const sidebar = readFileSync(new URL("./Sidebar.tsx", import.meta.url), "utf8");
    expect(sidebar).not.toContain(">\\n");
    expect(sidebar).toContain("<Plug size={15} />");
  });
});

describe("user menu icon alignment", () => {
  it("uses the same 28px icon slot for Plugins and Settings", () => {
    const sidebar = readFileSync(new URL("./Sidebar.tsx", import.meta.url), "utf8");
    const slots = sidebar.match(/className="inline-flex size-7 shrink-0 items-center justify-center/g);

    expect(slots).toHaveLength(2);
    expect(sidebar).toContain('<Settings size={15} />');
  });
});

describe("sidebar avatar", () => {
  const bot = (over: Partial<Bot>): Bot =>
    ({ id: "b1", name: "Bot", color: "#fff", messages: [], ...over }) as Bot;

  // Jeden animowany bot na cala aplikacje stoi na pasku nad composerem, wiec
  // pasek boczny nie rusza sie NIGDY — takze pod bota w trakcie tury.
  it("freezes every bot, busy or not", () => {
    const still = { state: "idle", motion: "none", animated: false, motionKey: 0 };
    expect(sidebarAvatarProps(bot({ busy: false }))).toEqual(still);
    expect(sidebarAvatarProps(bot({ busy: true }))).toEqual(still);
  });
});

describe("sidebar group row avatars", () => {
  const member = (over: Partial<Bot>): Bot =>
    ({ id: "m1", name: "Member", color: "#fff", messages: [], ...over }) as Bot;

  it("freezes group members too", () => {
    expect(groupMemberAvatarProps(member({ busy: false })).animated).toBe(false);
    expect(groupMemberAvatarProps(member({ busy: true })).animated).toBe(false);
    expect(groupMemberAvatarProps(member({ busy: true })).motion).toBe("none");
    expect(groupMemberAvatarProps(member({ busy: true })).state).toBe("idle");
  });

  it("keeps each member's own avatar shape and photo", () => {
    const bot = member({ avatarUrl: "data:image/png;base64,avatar", mascotShape: "triangle" as Bot["mascotShape"] });
    expect(groupMemberAvatarProps(bot)).toEqual(sidebarAvatarProps(bot));
  });

  it("wires every sidebar avatar through sidebarAvatarProps", () => {
    const sidebar = readFileSync(new URL("./Sidebar.tsx", import.meta.url), "utf8");
    // Grupowy stos składu, ukryte boty, przypięte boty i lista w oknie
    // tworzenia grupy — każdy z nich brał wcześniej `busyMascotMotion`
    // inline i przez to animował bota, który nie pracuje.
    expect(sidebar).not.toContain("busyMascotMotion(");
    expect(sidebar).toContain("{shown.map((member, index) => (");
    expect(sidebar).toContain("{...groupMemberAvatarProps(member)}");
    expect(sidebar).toContain("+{hiddenCount}");
    expect(sidebar).toContain("avatarUrl={member.avatarUrl}");
    expect(sidebar).toContain("shape={member.mascotShape}");
    expect(sidebar).not.toContain("className=\"absolute left-0 top-0 flex\"");
    expect(sidebar.match(/\{\.\.\.sidebarAvatarProps\(/g)?.length).toBe(3);
  });
});
