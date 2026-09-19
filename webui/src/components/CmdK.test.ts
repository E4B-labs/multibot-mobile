import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const cmdk = readFileSync(new URL("./CmdK.tsx", import.meta.url), "utf8");

describe("CmdK mobile layout", () => {
  it("keeps the shared palette above the drawer and inside the safe area", () => {
    expect(cmdk).toContain("z-[80]");
    expect(cmdk).toContain("var(--safe-top)");
    expect(cmdk).toContain("var(--safe-bottom)");
  });

  it("uses scrollable touch rows without horizontal overflow", () => {
    expect(cmdk).toContain("overflow-x-hidden overflow-y-auto");
    expect(cmdk).toContain("min-h-12 w-full min-w-0");
    expect(cmdk).toContain("overscroll-x-contain");
  });
});
