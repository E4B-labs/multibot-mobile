// Dociąga interfejs MultiBota z repo oryginalnego do `webui/src/`.
//
// Zamiast `git merge`, bo to repo nie ma już `server/` ani `engine/` i scalanie
// chciałoby je przywrócić przy każdym podejściu. Kopiowanie z listą wyjątków
// jest krótsze i nie zostawia stanu, którego nie da się cofnąć.
//
// Użycie:
//   git remote add original https://github.com/E4B-labs/multibot-desktop   (once)
//   node scripts/sync-webui.mjs
//
// Potem `git diff` i albo commit, albo `git checkout .`.
//
// OSTRZEŻENIE, opłacone całym dniem pracy: lista `PHONE_OWNED` NIE chroni
// przeróbek mobilnych. Chroni wyłącznie pliki wypisane niżej po nazwie, a
// przeróbki pod telefon (hamburger `DrawerToggle`, panele przez `createPortal`
// nad szufladą, klasa `mb-drawer-open`, odsunięcia od pasków systemowych
// Androida, dyktowanie niedostępne w WebView) siedzą także w kilkunastu innych
// plikach — `ChatView.tsx`, `GroupPanel.tsx`, `ComputerPanel.tsx`,
// `SettingsPanel.tsx`, `ModelPicker.tsx`, `Composer.tsx`, `App.tsx`,
// `Onboarding.tsx`, `UpdateBanner.tsx`. Zwykłe przepisanie ich z oryginału
// kasuje tamtą robotę w całości; commit `13f960b` zrobił dokładnie to.
//
// Dlatego synchronizację robi się TRZYSTRONNIE, plik po pliku:
//   OURS   = wersja telefonu sprzed synchronizacji (`git show <HEAD>:webui/src/<plik>`)
//   BASE   = `src/<plik>` z repo `multibot-desktop` z commitu POPRZEDNIEJ synchronizacji
//   THEIRS = `src/<plik>` z repo `multibot-desktop` z commitu, który właśnie wciągasz
//   git merge-file -p OURS BASE THEIRS > webui/src/<plik>
// Konflikty rozstrzyga się w stronę „obie strony zostają": mobilne z OURS,
// nowe funkcje z THEIRS. Pliki, w których OURS nie różni się od BASE, można
// przepisać wprost — telefon ich nie ruszał.
//
// BAZA DLA NASTĘPNEJ SYNCHRONIZACJI: commit `164e6f1` w repo `multibot`
// (stan `src/` wciągnięty tutaj 2026-08-27). Po kolejnej synchronizacji
// podmień ten hash na świeży, inaczej trzystronne scalanie liczy różnice od
// złej bazy i znowu wywali przeróbki mobilne.

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const REF = process.env.SYNC_REF || "original/main";

// Pliki interfejsu należące do TELEFONU. Kopiowanie ich z oryginału skasowałoby
// przeróbki mobilne. Każda pozycja z powodem — lista bez powodów po pół roku
// jest nie do odróżnienia od listy przypadkowej.
const PHONE_OWNED = [
  // Zadanie B4: język wizualny z inspiracje.png. Oryginał ma tu wersję sprzed
  // przeróbki, więc skopiowanie go skasowałoby całą robotę nad wyglądem.
  "components/Sidebar.tsx",
  "styles.css",
  // Te dwa w oryginale w ogóle nie istnieją — powstały pod telefon. Wpisane
  // profilaktycznie, na wypadek gdyby ktoś dołożył pliki o tych nazwach po
  // tamtej stronie.
  "components/ListRow.tsx",
  "components/SearchPalette.tsx",
  "components/DrawerToggle.tsx",
  "lib/imageScrapers.ts",
  "lib/imageScrapers.test.ts",
];

function git(...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 1 << 28 });
}

if (git("status", "--porcelain").trim()) {
  console.error("Drzewo gita nie jest czyste. Zacommituj albo schowaj zmiany — inaczej nie odróżnisz");
  console.error("tego, co przyniósł skrypt, od tego, co miałeś swojego.");
  process.exit(1);
}

try {
  git("rev-parse", "--verify", REF);
} catch {
  console.error(`Brak referencji ${REF}. Zrób najpierw:`);
  console.error("  git remote add original https://github.com/E4B-labs/multibot-desktop");
  console.error("  git fetch original");
  process.exit(1);
}

const files = git("ls-tree", "-r", "--name-only", REF, "src/").split("\n").filter(Boolean);
if (files.length === 0) {
  console.error(`${REF} nie ma katalogu src/. Zła referencja?`);
  process.exit(1);
}

let copied = 0;
const skipped = [];
for (const file of files) {
  const relative = file.replace(/^src\//, "");
  if (PHONE_OWNED.includes(relative)) {
    skipped.push(relative);
    continue;
  }
  // `git show` oddaje bajty pliku z tamtego drzewa, bez ruszania drzewa roboczego.
  const content = execFileSync("git", ["show", `${REF}:${file}`], { cwd: root, maxBuffer: 1 << 28 });
  const target = join(root, "webui", "src", ...posix.normalize(relative).split("/"));
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
  copied += 1;
}

console.log(`Skopiowane z ${REF}: ${copied} plików do webui/src/`);
if (skipped.length > 0) console.log(`Pominięte jako mobilne: ${skipped.join(", ")}`);
console.log("Sprawdź `git diff`, potem `npm run webui` i commit.");



