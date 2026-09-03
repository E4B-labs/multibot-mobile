import { describe, expect, it } from "vitest";
import { groupAvatarSplit, groupRowTitle } from "./groupRow";

describe("groupRowTitle", () => {
  it("joins member names with a comma", () => {
    expect(groupRowTitle(["Szef sztabu", "Nowy"])).toBe("Szef sztabu, Nowy");
  });
  it("is empty for a group with no known members", () => {
    expect(groupRowTitle([])).toBe("");
  });
});

describe("groupAvatarSplit", () => {
  it("shows at most two avatars and counts the rest", () => {
    expect(groupAvatarSplit(["a", "b", "c", "d"])).toEqual({ shown: ["a", "b"], overflow: 2 });
  });
  it("has no overflow at or below the limit", () => {
    expect(groupAvatarSplit(["a", "b"])).toEqual({ shown: ["a", "b"], overflow: 0 });
    expect(groupAvatarSplit(["a"])).toEqual({ shown: ["a"], overflow: 0 });
  });
  it("respects a custom limit", () => {
    expect(groupAvatarSplit(["a", "b", "c"], 1)).toEqual({ shown: ["a"], overflow: 2 });
  });
  it("counts bots this app does not know via the total", () => {
    // Grupa ma pięciu członków w `bot_ids`, ale tylko trzech jest znanych.
    expect(groupAvatarSplit(["a", "b", "c"], 2, 5)).toEqual({ shown: ["a", "b"], overflow: 3 });
  });
  it("never goes negative when the total is smaller than what is shown", () => {
    expect(groupAvatarSplit(["a", "b"], 2, 1)).toEqual({ shown: ["a", "b"], overflow: 0 });
  });
});
