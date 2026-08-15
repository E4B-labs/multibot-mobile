# MultiBot na telefon

Aplikacja na Androida do MultiBota. Osobne repo, osobny build, własne
aktualizacje — tak samo jak TaskTree.

Serwer MultiBota mieszka w [`clewkord/multibot`](https://github.com/clewkord/multibot).
Tutaj jest sama aplikacja.

---

## Jak to działa

Aplikacja nosi interfejs MultiBota **w swojej paczce**. Nie pobiera go
z serwera. WebView dostaje gotowy dokument, a `baseUrl` wskazuje na adres
hosta — dzięki temu wywołania API ze środka interfejsu trafiają do serwera,
a sam wygląd aktualizuje się przez `eas update`, bez wgrywania czegokolwiek
na serwer.

| Warstwa | Gdzie |
|---|---|
| Skorupa: lista hostów, parowanie, powiadomienia, popup aktualizacji | `src/` (React Native) |
| Interfejs MultiBota | `webui/` (React + Vite + Tailwind) |
| Interfejs spakowany do paczki | `src/webui-html.ts` — **plik generowany** |

---

## Praca na co dzień

```sh
npm install
npm start                 # Expo Go albo build deweloperski
```

Po zmianie w `webui/`:

```sh
npm run webui             # buduje interfejs i pakuje go do src/webui-html.ts
```

Sprawdzenie przed wysłaniem:

```sh
npm run typecheck              # skorupa
npm --prefix webui run typecheck   # interfejs
```

---

## Wydawanie

| Zmiana | Komenda |
|---|---|
| JavaScript, style, zawartość `webui/` | `npx eas-cli@latest update --branch production -m "opis"` |
| Nowa paczka natywna, `plugins`, uprawnienia, SDK | podnieś `runtimeVersion` w `app.json`, potem `npx eas-cli@latest build --platform android --profile production` |

**Commituj przed `eas build`.** EAS pakuje do wysyłki pliki wzięte z gita, nie
z dysku.

---

## Nowe funkcje z repo oryginalnego

```sh
git remote add original https://github.com/clewkord/multibot   # raz
git fetch original
npm run sync-webui
```

Skrypt kopiuje interfejs z oryginału do `webui/src/`, pomijając pliki
przerobione pod telefon. Wynik oglądasz przez `git diff`.

---

## Reszta

Pułapki, konfiguracja EAS i znane problemy: [`CLAUDE.md`](CLAUDE.md).
Zadania: [`PLAN-MOBILE-KOLEGA.md`](PLAN-MOBILE-KOLEGA.md).

Licencja: MIT. Projekt wywodzi się z
[OpenMausBot](https://github.com/milind-soni/OpenMausBot) — patrz
[`LICENSE`](LICENSE).
