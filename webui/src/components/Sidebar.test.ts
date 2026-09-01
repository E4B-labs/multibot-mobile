import { describe, expect, it } from "vitest";
import { hiddenBotsForSidebar } from "./Sidebar";

describe("hidden bot recovery", () => {
  it("keeps hidden bots available for sidebar recovery", () => {
    const hidden = { id: "hidden", hidden: true } as any;
    const visible = { id: "visible", hidden: false } as any;
    expect(hiddenBotsForSidebar([visible, hidden])).toEqual([hidden]);
  });
});
