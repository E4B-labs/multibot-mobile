// Dociąga interfejs MultiBota z repo oryginalnego do `webui/src/`.
//
// Zamiast `git merge`, bo to repo nie ma już `server/` ani `engine/` i scalanie
// chciałoby je przywrócić przy każdym podejściu. Kopiowanie z listą wyjątków
// jest krótsze i nie zostawia stanu, którego nie da się cofnąć.
//
// Użycie:
//   git remote add original https://github.com/clewkord/multibot   (raz)
//   node scripts/sync-webui.mjs
//
// Potem `git diff` i albo commit, albo `git checkout .`.

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
  console.error("  git remote add original https://github.com/clewkord/multibot");
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
