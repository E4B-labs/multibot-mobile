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
  it("uses the same 28px circled icon slot for every user-menu row", () => {
    const sidebar = readFileSync(new URL("./Sidebar.tsx", import.meta.url), "utf8");
    const slots = sidebar.match(
      /className="inline-flex size-7 shrink-0 items-center justify-center rounded-full border border-white\/10 bg-\[#151515\]/g,
    );

    // Wtyczki + Ustawienia + Prześlij zdjęcie profilowe + Usuń zdjęcie profilowe.
    expect(slots).toHaveLength(4);
    expect(sidebar).toContain('<Settings size={15} />');
  });

  it("sizes the user menu to its content instead of a fixed w-64", () => {
    const sidebar = readFileSync(new URL("./Sidebar.tsx", import.meta.url), "utf8");
    expect(sidebar).toContain("w-max min-w-44 max-w-[calc(100vw-16px)]");
    expect(sidebar).not.toContain("z-[90] w-64");
  });
});

describe("profile photo", () => {
  const sidebar = readFileSync(new URL("./Sidebar.tsx", import.meta.url), "utf8");

  it("shows the uploaded photo instead of initials in the header bubble", () => {
    expect(sidebar).toContain("state.config?.profile?.avatar");
    expect(sidebar).toContain('className="size-full rounded-full object-cover"');
  });

  it("uploads through the same hidden-input + AvatarCropper flow as bot avatars", () => {
    expect(sidebar).toContain("<AvatarCropper");
    expect(sidebar).toContain('type="file"');
    expect(sidebar).toContain('accept="image/*"');
    expect(sidebar).toContain('"/api/profile/avatar"');
    expect(sidebar).toContain('method: "POST"');
    expect(sidebar).toContain('method: "DELETE"');
    // Odpowiedź serwera ({user:{…}}) idzie przez czysty parser (testowany
    // jednostkowo w lib/profileAvatar.test.ts) i dokleja się do bieżącego
    // configu — `configStatus` podmienia cały config.
    expect(sidebar).toContain("profileFromAvatarResponse");
    expect(sidebar).toContain('dispatch({ type: "configStatus", config: { ...state.config, profile } })');
  });
});

describe("sidebar avatar", () => {
  const bot = (over: Partial<Bot>): Bot =>
    ({ id: "b1", name: "Bot", color: "#fff", messages: [], ...over }) as Bot;

  // Od portu desktopu 12.09: roster animuje TYLKO zywy stan (pracuje, mysli,
  // czeka na czlowieka) — bezczynny bot stoi. Pasek nad composerem ma
  // wlasna, oddzielna regule (mascotStatic.test.ts).
  it("idle bot stands still, busy bot animates", () => {
    const still = { state: "idle", motion: "none", animated: false, motionKey: 0 };
    expect(sidebarAvatarProps(bot({ busy: false }))).toEqual(still);
    expect(sidebarAvatarProps(bot({ busy: true })).animated).toBe(true);
  });
});

describe("sidebar group row avatars", () => {
  const member = (over: Partial<Bot>): Bot =>
    ({ id: "m1", name: "Member", color: "#fff", messages: [], ...over }) as Bot;

  it("group members follow the same rule as a single bot avatar", () => {
    expect(groupMemberAvatarProps(member({ busy: false })).animated).toBe(false);
    expect(groupMemberAvatarProps(member({ busy: true })).animated).toBe(true);
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

  // Klaster ma się NAKŁADAĆ: sąsiednie sloty stoją co 20 px przy elemencie 28 px,
  // czyli części wspólne po 8 px, a cały klaster 48×48 siedzi wyśrodkowany w
  // kafelku 56 px. Wcześniej sloty stały po rogach kafelka, więc nakładania nie
  // było wcale, a od czterech botów zostawał pusty prawy górny róg.
  it("overlaps the cluster slots and centres them in the tile", () => {
    const sidebar = readFileSync(new URL("./Sidebar.tsx", import.meta.url), "utf8");
    const slots = sidebar.slice(
      sidebar.indexOf("const GROUP_AVATAR_SLOTS"),
      sidebar.indexOf("function GroupRow"),
    );
    expect(slots).toContain('pair: ["left-1 top-3.5", "left-6 top-3.5"]');
    expect(slots).toContain('trio: ["left-1 top-1", "left-6 top-1", "left-3.5 top-6"]');
    // Układ „stack" zniknął — od czterech botów klaster ma te same trzy sloty co
    // trójka, więc wiersz nie zmienia kształtu między 3 a 12 botami.
    expect(slots).not.toContain("stack:");
    // `flex` na slocie jest obowiązkowe: inline slot łapie zejście linii pod
    // awatarem, więc awatar 28 px zajmował 28×34 i rozjeżdżał się z plakietką.
    expect(sidebar).toContain('cn("absolute flex", GROUP_AVATAR_SLOTS[layout][index])');
  });

  // Plakietka „+N" to kolejny element klastra: ten sam rozmiar 28 px co awatar i
  // slot za ostatnim awatarem, a nie własny róg kafelka. Obwódka z `shadow`
  // rysowała się NA ZEWNĄTRZ, przez co plakietka miała 32 px.
  it("puts the overflow badge in the slot after the last avatar", () => {
    const sidebar = readFileSync(new URL("./Sidebar.tsx", import.meta.url), "utf8");
    expect(sidebar).toContain("GROUP_AVATAR_SLOTS[layout][shown.length]");
    expect(sidebar).toContain("size-7 items-center justify-center rounded-full border border-hairline");
    expect(sidebar).not.toContain("shadow-[0_0_0_2px_var(--color-app)]");
    expect(sidebar).not.toContain('layout === "stack"');
  });
});
