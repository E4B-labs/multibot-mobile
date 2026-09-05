import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// multibot: port z desktopu 0.3.31 (panelScale.test.ts) — z desktopowego testu
// skali zostaje to, co dotyczy switchera modeli. Reszta tamtych warunków to
// wymiary panelu na PC, a telefon ma własne. Vitest chodzi w node bez jsdom,
// więc pilnujemy źródła.
const picker = readFileSync(new URL("./ModelPicker.tsx", import.meta.url), "utf8");
const providerIcons = readFileSync(new URL("./ProviderIcons.tsx", import.meta.url), "utf8");

describe("switcher modeli", () => {
  it("OpenCode ma jedną ikonę, grupy Go/Zen i formularz klucza", () => {
    expect(providerIcons).toContain("export function OpenCodeMark");
    expect(providerIcons).toContain('case "opencode":');
    expect(picker).toContain("groupOpenCodeModels");
    expect(picker).toContain('section="opencode"');
    expect(picker).toContain("railInstance.models.updatedAt");
  });

  it("wiersz modelu ma czytelną nazwę, odznaki i bramkę klucza", () => {
    // nazwa zamiast surowego `opencode-go/…` — i w wierszu, i w pigułce nagłówka
    expect(picker).toContain("modelLabel(option.id, option.label)");
    expect(picker).toContain("instanceModelLabel(active, selection.model)");
    expect(picker).toContain("isFreeModel(option.id)");
    // klucz przygasza wiersz, ale go nie blokuje — klik otwiera pole klucza
    expect(picker).toContain("wymaga wspólnego klucza OpenCode Go");
    expect(picker).toContain("<KeyRound size={12}");
    expect(picker).toContain('!disabled && opts.needsKey && "opacity-60"');
    // powód siedzi na całym wierszu: niedostępność albo brakujący klucz
    expect(picker).toContain("title={disabled ? (instance.snapshot.reason ?? undefined) : opts.needsKey ? keyHint : undefined}");
    expect(picker).toContain('role="img" aria-label={keyHint}');
    // licznik grupy z jednostką, nie goła liczba
    expect(picker).toContain('{group.options.length} {polish ? "modeli" : "models"}');
  });

  it("zostaje przy telefonowej szufladzie od dołu, nie desktopowym dropdownie", () => {
    expect(picker).toContain("fixed inset-x-0 bottom-0 h-[60vh]");
  });
});
