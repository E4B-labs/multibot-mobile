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
    // Po #173 przygaszenie ma dwa powody — brakujący klucz ORAZ niezalogowane
    // CLI (`lib/instanceGate.ts`) — więc decyduje wspólne `dimmed`/`hint`.
    expect(picker).toContain('const dimmed = gate === "signin" || Boolean(opts.needsKey);');
    expect(picker).toContain('const hint = gate === "signin" ? signInHint : opts.needsKey ? keyHint : undefined;');
    expect(picker).toContain('!disabled && dimmed && "opacity-60"');
    // powód siedzi na całym wierszu: niedostępność, brak logowania albo brak klucza
    expect(picker).toContain("title={disabled ? (instance.snapshot.reason ?? undefined) : hint}");
    expect(picker).toContain('role="img" aria-label={hint}');
    // licznik grupy z jednostką, nie goła liczba
    expect(picker).toContain('{group.options.length} {polish ? "modeli" : "models"}');
  });

  // #173: zainstalowane, ale WYLOGOWANE CLI nie ma udawać gotowego — wiersz
  // przygasa i kieruje do Ustawień, zamiast wywalić się dopiero po wysłaniu tury.
  it("bramkuje picker na `instanceGate`, nie na samym `state`", () => {
    expect(picker).toContain('import { instanceGate } from "@/lib/instanceGate";');
    expect(picker).toContain("instanceGate(instance.snapshot, instance.driverKind)");
    expect(picker).toContain('const disabled = gate === "missing";');
    // pigułka w nagłówku (jedyne, co widać w trybie `compact`) też niesie powód
    expect(picker).toContain('activeGate === "missing" && "opacity-40", activeGate === "signin" && "opacity-60"');
  });

  it("zostaje przy telefonowej szufladzie od dołu, nie desktopowym dropdownie", () => {
    expect(picker).toContain("fixed inset-x-0 bottom-0 h-[60vh]");
  });
});
