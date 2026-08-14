// multibot (H2): the parts of the hosted computer that are decidable without a
// daemon. The container lifecycle itself is covered by the H0 spike against a
// real image, not here.
import { describe, expect, it } from "vitest";

import {
  CONTAINER_PORTS,
  botHash,
  computersDisabled,
  containerName,
  dockerCommand,
  orphanContainers,
  parsePortOutput,
  volumeName,
} from "./hosted-computer.ts";

describe("naming", () => {
  it("is stable and docker-safe for ids docker would reject verbatim", () => {
    const messy = "Bot #1 / with spaces";
    expect(containerName(messy)).toMatch(/^multibot-computer-[0-9a-f]{12}$/);
    expect(volumeName(messy)).toMatch(/^multibot-computer-data-[0-9a-f]{12}$/);
    expect(botHash(messy)).toBe(botHash(messy));
  });

  it("gives different bots different computers", () => {
    expect(botHash("a")).not.toBe(botHash("b"));
  });
});

describe("dockerCommand", () => {
  it("tunnels through WSL on Windows — there is no native daemon there", () => {
    const { file, args } = dockerCommand(["ps"], "win32");
    expect(file).toBe("wsl");
    expect(args.slice(0, 2)).toEqual(["-d", "Ubuntu"]);
    expect(args.slice(-2)).toEqual(["docker", "ps"]);
  });

  it("calls docker directly elsewhere", () => {
    expect(dockerCommand(["ps"], "linux")).toEqual({ file: "docker", args: ["ps"] });
  });
});

describe("parsePortOutput", () => {
  it("reads the loopback binding", () => {
    expect(parsePortOutput("127.0.0.1:32773")).toBe(32773);
  });

  it("handles IPv6 loopback, where the last colon is the separator", () => {
    expect(parsePortOutput("[::1]:32780")).toBe(32780);
  });

  it("picks the loopback line when docker prints several", () => {
    expect(parsePortOutput("[::1]:32781\n127.0.0.1:32780")).toBe(32781);
  });

  // The whole security story of the computer is "loopback only". A wildcard
  // binding must fail loudly rather than be used.
  it("refuses a wildcard binding instead of exposing the computer", () => {
    expect(parsePortOutput("0.0.0.0:32773")).toBeNull();
  });

  it("returns null on junk", () => {
    expect(parsePortOutput("")).toBeNull();
    expect(parsePortOutput("no colon here")).toBeNull();
  });
});

describe("orphanContainers", () => {
  it("yields nothing when computers are disabled, rather than a delete list", async () => {
    // Under vitest every docker call is refused (see computersDisabled). The
    // failure path must return "no orphans" — proposing deletions from an
    // unreadable daemon would be the dangerous answer.
    expect(computersDisabled()).toBe(true);
    await expect(orphanContainers(["bot-1"])).resolves.toEqual([]);
  });
});

describe("ports", () => {
  it("publishes exactly the three the image serves", () => {
    expect(CONTAINER_PORTS).toEqual({ cdp: 9223, novnc: 6901, api: 8000 });
  });
});
