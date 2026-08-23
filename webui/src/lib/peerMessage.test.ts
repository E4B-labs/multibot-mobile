import { describe, expect, it } from "vitest";
import { stripPeerEnvelope } from "./peerMessage";

describe("stripPeerEnvelope", () => {
  it("zdejmuje kopertę bot→bot z początku wiadomości", () => {
    const text =
      "[Message from @Cytrynka, another bot in this MultiBot workspace. Reply to them.]\n\nŁowco Pracy, pilne: potwierdź jednym zdaniem.";
    expect(stripPeerEnvelope(text)).toBe("Łowco Pracy, pilne: potwierdź jednym zdaniem.");
  });

  it("zostawia zwykłą wiadomość bez zmian", () => {
    expect(stripPeerEnvelope("Zwykła wiadomość od bota")).toBe("Zwykła wiadomość od bota");
  });

  it("nie rusza nawiasów w środku treści", () => {
    const text = "Zobacz [Message from @Ktoś] w dokumentacji";
    expect(stripPeerEnvelope(text)).toBe(text);
  });
});
