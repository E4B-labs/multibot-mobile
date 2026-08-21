import { describe, expect, it } from "vitest";

import { canCreateGroup, engineBotId } from "./groups";

describe("canCreateGroup", () => {
  // Dokładnie te trzy stany widzi użytkownik z otwartą szufladą tworzenia:
  // pusty formularz, sama nazwa, sam skład. W każdym „Utwórz" ma być martwe.
  it("blokuje przycisk, dopóki brakuje nazwy albo składu", () => {
    expect(canCreateGroup("", 0)).toBe(false);
    expect(canCreateGroup("Zespół", 0)).toBe(false);
    expect(canCreateGroup("", 2)).toBe(false);
  });

  // Sama spacja to nie nazwa — silnik zapisałby grupę bez etykiety i na
  // liście zostałby po niej goły identyfikator.
  it("nie uznaje samych białych znaków za nazwę", () => {
    expect(canCreateGroup("   ", 3)).toBe(false);
  });

  it("przepuszcza nazwę razem z co najmniej jednym botem", () => {
    expect(canCreateGroup("Zespół", 1)).toBe(true);
  });
});

describe("engineBotId", () => {
  it("dokleja prefiks silnika do wątku bota", () => {
    expect(engineBotId("abc123")).toBe("mb-abc123");
  });
});
