import { describe, expect, it } from "vitest";
import { groupAvatarOverflow, groupAvatarStack, groupRowTitle } from "./groupRow";

describe("groupRowTitle", () => {
  it("joins member names with a comma", () => {
    expect(groupRowTitle(["Szef sztabu", "Nowy"])).toBe("Szef sztabu, Nowy");
  });
  it("is empty for a group with no known members", () => {
    expect(groupRowTitle([])).toBe("");
  });
});

describe("groupAvatarStack", () => {
  it("stacks both members when the group has exactly two", () => {
    expect(groupAvatarStack(["a", "b"])).toEqual(["a", "b"]);
  });
  it("shows no more than the first three known members", () => {
    expect(groupAvatarStack(["a", "b", "c", "d", "e"])).toEqual(["a", "b", "c"]);
  });
  it("returns only known members when the group has unknown bots", () => {
    // Grupa może mieć boty spoza tej aplikacji, ale stos pokazuje każdego znanego.
    expect(groupAvatarStack(["a", "b", "c"])).toEqual(["a", "b", "c"]);
  });
  it("shows a single avatar for a one-member group", () => {
    expect(groupAvatarStack(["a"])).toEqual(["a"]);
  });
  it("shows all three avatars when the group has exactly three members", () => {
    expect(groupAvatarStack(["a", "b", "c"])).toEqual(["a", "b", "c"]);
  });
});

describe("groupAvatarOverflow", () => {
  it.each([
    [1, 0],
    [2, 0],
    [3, 0],
    [4, 1],
    [5, 2],
    [12, 9],
  ])("a group of %i members has %i hidden avatars", (memberCount, hidden) => {
    expect(groupAvatarOverflow(memberCount)).toBe(hidden);
  });

  it("uses all group ids when 5 members exist but only 4 are locally known", () => {
    const allGroupBotIds = ["a", "b", "c", "d", "remote"];
    const knownMembers = ["a", "b", "c", "d"];

    expect(groupAvatarStack(knownMembers)).toEqual(["a", "b", "c"]);
    expect(groupAvatarOverflow(allGroupBotIds.length)).toBe(2);
  });
});
