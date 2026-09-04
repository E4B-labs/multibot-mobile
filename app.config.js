// Cała konfiguracja siedzi w `app.json` — ten plik dokłada do niej JEDNĄ rzecz,
// której statyczny JSON nie umie: odczyt zmiennej środowiskowej.
//
// `google-services.json` NIE leży w repozytorium (jest w `.gitignore`). Na EAS
// wjeżdża jako zmienna projektu `GOOGLE_SERVICES_JSON` typu `file`: builder
// zapisuje plik POZA katalogiem projektu i podstawia do zmiennej BEZWZGLĘDNĄ
// ŚCIEŻKĘ do niego (nie zawartość). Dlatego `googleServicesFile` bierze się
// wyłącznie ze zmiennej.
//
// Bez zmiennej pole zostaje `undefined` — i tak ma być. Zmienna żyje tylko w
// środowisku `production` (patrz `eas.json`), więc profile `preview` i
// `development` jej nie dostają. Gdyby stała tu ścieżka w rodzaju
// `./google-services.json`, ich `prebuild` szukałby pliku, którego nie ma w
// repozytorium, i padał. `undefined` to dokładnie stan sprzed tej zmiany:
// build wychodzi bez konfiguracji Firebase, czyli bez pushu, ale wychodzi.
module.exports = ({ config }) => ({
  ...config,
  android: {
    ...config.android,
    googleServicesFile: process.env.GOOGLE_SERVICES_JSON,
  },
});
