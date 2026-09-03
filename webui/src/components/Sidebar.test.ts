import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { busyMascotMotion } from "@/lib/mascot";
import type { Bot } from "@/state/store";
import { hiddenBotsForSidebar, sidebarAvatarProps } from "./Sidebar";

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

describe("sidebar avatar", () => {
  const bot = (over: Partial<Bot>): Bot =>
    ({ id: "b1", name: "Bot", color: "#fff", messages: [], ...over }) as Bot;

  it("freezes idle bots and animates only while busy", () => {
    expect(sidebarAvatarProps(bot({ busy: false }))).toEqual({
      state: "idle",
      motion: "none",
      animated: false,
      motionKey: 0,
    });
    const busy = sidebarAvatarProps(bot({ busy: true }));
    expect(busy.animated).toBe(true);
    expect(busy.motion).not.toBe("none");
    expect(busy).toEqual({ ...busyMascotMotion("b1"), animated: true, motionKey: 1 });
  });
});

describe("sidebar group row avatars", () => {
  const member = (over: Partial<Bot>): Bot =>
    ({ id: "m1", name: "Member", color: "#fff", messages: [], ...over }) as Bot;

  it("freezes idle group members and animates only the busy ones", () => {
    expect(sidebarAvatarProps(member({ busy: false })).animated).toBe(false);
    expect(sidebarAvatarProps(member({ busy: false })).motion).toBe("none");
    expect(sidebarAvatarProps(member({ busy: true })).animated).toBe(true);
  });

  it("wires every sidebar avatar through sidebarAvatarProps", () => {
    const sidebar = readFileSync(new URL("./Sidebar.tsx", import.meta.url), "utf8");
    // Grupowy stos składu, ukryte boty, przypięte boty i lista w oknie
    // tworzenia grupy — każdy z nich brał wcześniej `busyMascotMotion`
    // inline i przez to animował bota, który nie pracuje.
    expect(sidebar).not.toContain("busy ? busyMascotMotion(");
    expect(sidebar.match(/\{\.\.\.sidebarAvatarProps\(/g)?.length).toBe(4);
  });
});
