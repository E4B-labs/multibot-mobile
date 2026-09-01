// multibot: „scrapery zdjęć" na telefonie — czyli konektory, którymi bot
// wyszukuje i ściąga obrazy z sieci — mają być podpięte domyślnie, bez
// przeklikiwania formularza przez użytkownika.
//
// Cała decyzja „co jest scraperem zdjęć i czy wolno go podpiąć" siedzi tutaj,
// a nie w komponencie, bo zapada w dwóch różnych momentach: przy rozpoznaniu
// karty, którą przysłał katalog, i przy zasianiu gotowego presetu. Trzymane
// osobno rozjechałyby się przy pierwszej zmianie listy słów.
//
// Dwa źródła konektorów zachowują się na telefonie zupełnie inaczej i to
// właśnie one wyznaczają granicę tego modułu:
//   * Composio — podłączenie idzie przez OAuth w przeglądarce
//     (`POST /api/connectors/:slug/authorize`, potem `window.open`). Na
//     Androidzie WebView odrzuca logowanie Google (`disallowed_useragent`,
//     CLAUDE.md §8), a bez klucza Composio przycisk „Połącz" jest w ogóle
//     wyłączony. Takiej karty NIE DA SIĘ podpiąć automatycznie — można ją
//     tylko wyciągnąć na wierzch, żeby użytkownik nie szukał jej wśród
//     kilkuset pozycji katalogu.
//   * własny serwer MCP — rejestracja to jeden `PUT
//     /api/connectors/custom/:id` po stronie harnessa, bez klucza i bez
//     przeglądarki. To jedyna droga, którą „domyślnie podpięte" faktycznie
//     da się na telefonie zrobić.

/** Karta katalogu w zakresie, którego potrzebuje rozpoznawanie scraperów. */
export interface ScraperCardLike {
  slug: string;
  label: string;
  blurb: string;
  source?: "composio" | "custom";
}

// Dostawcy, których cały produkt to obrazy albo scraping z obrazami w wyniku.
// Katalog należy do serwera (`server/composio.ts` woła v3 `toolkits`), więc po
// naszej stronie może to być wyłącznie lista rozpoznawanych slugów — nie ma
// tu czego „dodać do katalogu", jest co rozpoznać w tym, co przyszło.
const IMAGE_SCRAPER_SLUGS = new Set([
  "unsplash",
  "pexels",
  "pixabay",
  "giphy",
  "tenor",
  "shutterstock",
  "gettyimages",
  "flickr",
  "imgur",
  "pinterest",
  "apify",
  "firecrawl",
  "serpapi",
  "browserbase",
]);

// Heurystyka dla reszty katalogu: sam „obraz" to za mało (Figma czy Dysk też
// trzymają pliki graficzne), więc karta musi mówić i o obrazach, i o ich
// zdobywaniu. Dzięki temu „Google Drive — browse and manage files" odpada,
// a „scrape product images" wpada.
const MEDIA_WORDS = ["image", "images", "photo", "photos", "picture", "pictures", "gif", "gifs", "stock photo", "obraz", "zdjęc", "zdjec"];
const FETCH_WORDS = ["scrape", "scraper", "scraping", "crawl", "search", "download", "fetch", "extract"];

function haystack(card: ScraperCardLike): string {
  return `${card.slug} ${card.label} ${card.blurb}`.toLowerCase();
}

/** Czy ta karta katalogu jest scraperem zdjęć. */
export function isImageScraper(card: ScraperCardLike): boolean {
  if (IMAGE_SCRAPER_SLUGS.has(card.slug.toLowerCase())) return true;
  const text = haystack(card);
  return MEDIA_WORDS.some((w) => text.includes(w)) && FETCH_WORDS.some((w) => text.includes(w));
}

/** Scrapery zdjęć wyłuskane z katalogu, w kolejności, w jakiej przyszły. */
export function imageScraperCards<T extends ScraperCardLike>(cards: readonly T[]): T[] {
  return cards.filter(isImageScraper);
}

// --- gotowe presety własnych serwerów MCP -----------------------------------

/** Transport w kształcie, który waliduje `decodeConnector` po stronie serwera. */
export type PresetTransport =
  | { type: "stdio"; command: string; args?: string[]; env?: Record<string, string> }
  | { type: "http" | "sse"; url: string; headers?: Record<string, string> };

export interface ScraperPreset {
  /** Id konektora w harnessie; ląduje w nazwie serwera MCP. */
  id: string;
  name: string;
  transport: PresetTransport;
  /**
   * Czy wolno zainstalować preset SAM, bez tapnięcia użytkownika.
   *
   * Domyślnie `false` i to nie jest ostrożnościowy ozdobnik. Rejestr
   * konektorów leży w `~/.openmausbot/config.json` — tym samym pliku, w którym
   * są klucze API użytkownika — a transport `stdio` znaczy, że host uruchomi
   * podany proces (`npx -y …`) z pełnymi prawami użytkownika. Cichy zapis
   * takiego wpisu to wykonanie cudzego kodu na maszynie właściciela hosta bez
   * jego wiedzy, więc na `true` zasługuje wyłącznie serwer, co do którego
   * ktoś świadomie podjął tę decyzję.
   */
  auto?: boolean;
}

/**
 * Scrapery zdjęć instalowane bez wpisywania ich ręcznie w formularz.
 *
 * PUSTA CELOWO. Mechanizm poniżej jest kompletny i przetestowany, ale sam
 * dobór serwerów nie wynika z kodu tego repo: skrócony katalog Composio
 * (`server/composio.ts`, 24 pozycje w historii repo) nie ma ani jednego
 * scrapera zdjęć, rejestr własnych konektorów nie ma żadnych wpisów
 * wbudowanych (`server/mcp-connectors.ts` czyta wyłącznie konfigurację
 * użytkownika), a ani dokumentacja, ani plany nie nazywają żadnego serwera
 * po imieniu. Wpisanie tu nazw paczek npm „z głowy" dałoby hostowi polecenie
 * uruchomienia kodu, którego nikt nie wybrał — dlatego lista czeka na decyzję.
 *
 * Dopisanie pozycji to jedno miejsce, na przykład:
 *   { id: "unsplash", name: "Unsplash",
 *     transport: { type: "stdio", command: "npx", args: ["-y", "…"] } }
 */
export const IMAGE_SCRAPER_PRESETS: ScraperPreset[] = [];

// Lustro walidacji z `server/mcp-connectors.ts`: preset z niepoprawnym id
// zostałby odrzucony dopiero przez serwer, a zasianie leci w tle, więc ten
// błąd nie miałby gdzie się pokazać.
const ID_RE = /^[a-z0-9][a-z0-9_-]{0,60}$/;
const RESERVED_IDS = new Set(["composio", "computer", "agents", "ogb"]);

/** Czy preset w ogóle nadaje się do wysłania na `PUT /api/connectors/custom/:id`. */
export function isInstallablePreset(preset: ScraperPreset): boolean {
  if (!ID_RE.test(preset.id) || RESERVED_IDS.has(preset.id)) return false;
  return preset.transport.type === "stdio"
    ? Boolean(preset.transport.command.trim())
    : /^https?:\/\//i.test(preset.transport.url);
}

/** Ciało żądania dla `PUT /api/connectors/custom/:id`. */
export function presetBody(preset: ScraperPreset): { name: string; transport: PresetTransport } {
  return { name: preset.name, transport: preset.transport };
}

// Klucz pamięta presety, które JUŻ raz trafiły do harnessa. Bez niego
// „domyślnie podpięte" znaczyłoby też „wraca po każdym odświeżeniu", więc
// usunięcie konektora byłoby nie do wyklikania — panel wstawiałby go z
// powrotem przy najbliższym wczytaniu katalogu.
const SEEDED_KEY = "multibot.imageScrapers.seeded";

export function readSeeded(storage: Pick<Storage, "getItem"> | undefined = safeStorage()): string[] {
  try {
    const raw = storage?.getItem(SEEDED_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

export function markSeeded(ids: readonly string[], storage: Pick<Storage, "getItem" | "setItem"> | undefined = safeStorage()): void {
  if (!ids.length) return;
  try {
    const next = Array.from(new Set([...readSeeded(storage), ...ids]));
    storage?.setItem(SEEDED_KEY, JSON.stringify(next));
  } catch {
    /* prywatne okno albo pełny magazyn — brak pamięci nie może wywrócić panelu */
  }
}

function safeStorage(): Storage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

/**
 * Presety, których w harnessie jeszcze nie ma i których użytkownik wcześniej
 * nie odrzucił. `cards` to pełny katalog — wystarczy, bo własne konektory
 * wracają z niego jako `source: "custom"` o slugu równym id.
 */
export function pendingPresets(
  cards: readonly ScraperCardLike[],
  presets: readonly ScraperPreset[] = IMAGE_SCRAPER_PRESETS,
  seeded: readonly string[] = readSeeded(),
): ScraperPreset[] {
  const present = new Set(cards.map((c) => c.slug));
  const known = new Set(seeded);
  return presets.filter((p) => isInstallablePreset(p) && !present.has(p.id) && !known.has(p.id));
}
