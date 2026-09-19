import { describe, expect, it } from "vitest";
import { parsePeerEnvelope, stripPeerEnvelope } from "./peerMessage";

describe("parsePeerEnvelope", () => {
  it("zwraca nadawcę i treść bez koperty", () => {
    const text =
      "[Message from @Cytrynka, another bot in this MultiBot workspace. Reply to them.]\n\nŁowco Pracy, pilne: potwierdź jednym zdaniem.";
    expect(parsePeerEnvelope(text)).toEqual({
      from: "Cytrynka",
      rest: "Łowco Pracy, pilne: potwierdź jednym zdaniem.",
    });
  });

  it("zwraca null dla zwykłej wiadomości", () => {
    expect(parsePeerEnvelope("Zwykła wiadomość od bota")).toBeNull();
  });

  it("nie łapie nawiasów w środku treści", () => {
    const text = "Zobacz [Message from @Ktoś] w dokumentacji";
    expect(parsePeerEnvelope(text)).toBeNull();
  });
});

describe("stripPeerEnvelope", () => {
  it("zdejmuje kopertę z początku wiadomości", () => {
    const text =
      "[Message from @Cytrynka, another bot in this MultiBot workspace. Reply to them.]\n\nTreść.";
    expect(stripPeerEnvelope(text)).toBe("Treść.");
  });

  it("zostawia wiadomość bez koperty bez zmian", () => {
    expect(stripPeerEnvelope("Zwykła wiadomość")).toBe("Zwykła wiadomość");
  });
});
