import { describe, expect, it } from "vitest";
import { groupAvatarStack, groupRowTitle } from "./groupRow";

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
  it("shows every known member instead of collapsing the rest into +N", () => {
    expect(groupAvatarStack(["a", "b", "c", "d"])).toEqual(["a", "b", "c", "d"]);
  });
  it("returns only known members when the group has unknown bots", () => {
    // Grupa może mieć boty spoza tej aplikacji, ale stos pokazuje każdego znanego.
    expect(groupAvatarStack(["a", "b", "c"])).toEqual(["a", "b", "c"]);
  });
  it("shows a single avatar for a one-member group", () => {
    expect(groupAvatarStack(["a"])).toEqual(["a"]);
  });
});
