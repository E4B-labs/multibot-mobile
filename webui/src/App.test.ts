import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");

describe("mobile host authentication", () => {
  it("offers the same create-server flow as desktop for an unconfigured host", () => {
    expect(app).toContain('type Mode = "login" | "register" | "host" | "recover" | "legacy"');
    expect(app).toContain('const [serverName, setServerName] = useState("")');
    expect(app).toContain('if (mode === "host")');
    expect(app).toContain('"/api/setup/server"');
    expect(app).toContain('setMode("register")');
    expect(app).not.toContain("Finish setup on the PC or VPS that runs MultiBot");
  });
});
