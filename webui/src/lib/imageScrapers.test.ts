// multibot: rozpoznawanie scraperów zdjęć jedzie po tekście kart, które
// przysyła serwer, więc zbyt szeroka heurystyka wciągnęłaby do sekcji
// „scrapery zdjęć" Dysk albo Figmę, a zbyt wąska zgubiłaby to, po co ta sekcja
// powstała. Stąd te testy — pilnują obu krawędzi naraz.
import { describe, expect, it } from "vitest";

import {
  isImageScraper,
  imageScraperCards,
  isInstallablePreset,
  pendingPresets,
  presetBody,
  type ScraperPreset,
} from "./imageScrapers";

const card = (slug: string, label: string, blurb: string, source?: "composio" | "custom") => ({
  slug,
  label,
  blurb,
  source,
});

describe("isImageScraper", () => {
  it("rozpoznaje dostawcę obrazów po samym slugu", () => {
    expect(isImageScraper(card("unsplash", "Unsplash", ""))).toBe(true);
    expect(isImageScraper(card("giphy", "Giphy", ""))).toBe(true);
  });

  it("łapie kartę, która mówi i o obrazach, i o ich zdobywaniu", () => {
    expect(isImageScraper(card("acme", "Acme", "Scrape product images from any shop"))).toBe(true);
    expect(isImageScraper(card("mcp-shots", "Shots", "stdio: npx -y shots --search-photos"))).toBe(true);
  });

  it("nie bierze magazynów plików ani narzędzi graficznych", () => {
    expect(isImageScraper(card("googledrive", "Google Drive", "Browse and manage files"))).toBe(false);
    expect(isImageScraper(card("figma", "Figma", "Files and comments"))).toBe(false);
    expect(isImageScraper(card("slack", "Slack", "Post updates and read channels"))).toBe(false);
  });

  it("sam obraz bez zdobywania to za mało", () => {
    expect(isImageScraper(card("gallery", "Gallery", "Store your images"))).toBe(false);
  });
});

describe("imageScraperCards", () => {
  it("zwraca tylko scrapery, zachowując kolejność katalogu", () => {
    const cards = [
      card("slack", "Slack", "Post updates"),
      card("unsplash", "Unsplash", ""),
      card("figma", "Figma", "Files and comments"),
      card("pexels", "Pexels", ""),
    ];
    expect(imageScraperCards(cards).map((c) => c.slug)).toEqual(["unsplash", "pexels"]);
  });
});

describe("isInstallablePreset", () => {
  const stdio = (id: string): ScraperPreset => ({
    id,
    name: id,
    transport: { type: "stdio", command: "npx", args: ["-y", "x"] },
  });

  it("odrzuca id, którego serwer i tak by nie przyjął", () => {
    expect(isInstallablePreset(stdio("Unsplash"))).toBe(false); // wielka litera
    expect(isInstallablePreset(stdio("-leading"))).toBe(false);
    expect(isInstallablePreset(stdio("composio"))).toBe(false); // zarezerwowane
  });

  it("wymaga polecenia dla stdio i adresu http(s) dla reszty", () => {
    expect(isInstallablePreset(stdio("ok"))).toBe(true);
    expect(isInstallablePreset({ id: "a", name: "a", transport: { type: "stdio", command: "  " } })).toBe(false);
    expect(isInstallablePreset({ id: "b", name: "b", transport: { type: "http", url: "ftp://x" } })).toBe(false);
    expect(isInstallablePreset({ id: "c", name: "c", transport: { type: "http", url: "https://x/mcp" } })).toBe(true);
  });
});

describe("pendingPresets", () => {
  const preset: ScraperPreset = {
    id: "shots",
    name: "Shots",
    transport: { type: "http", url: "https://example.com/mcp" },
  };

  it("proponuje preset, którego w katalogu nie ma", () => {
    expect(pendingPresets([card("slack", "Slack", "")], [preset], []).map((p) => p.id)).toEqual(["shots"]);
  });

  it("milczy o presecie już zarejestrowanym w harnessie", () => {
    expect(pendingPresets([card("shots", "Shots", "http: …", "custom")], [preset], [])).toEqual([]);
  });

  it("nie wskrzesza presetu, który raz już został zasiany i usunięty", () => {
    expect(pendingPresets([], [preset], ["shots"])).toEqual([]);
  });
});

describe("presetBody", () => {
  it("wysyła dokładnie to, czego chce PUT /api/connectors/custom/:id", () => {
    expect(presetBody({ id: "shots", name: "Shots", transport: { type: "http", url: "https://x/mcp" } })).toEqual({
      name: "Shots",
      transport: { type: "http", url: "https://x/mcp" },
    });
  });
});
