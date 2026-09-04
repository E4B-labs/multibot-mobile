// Cała konfiguracja siedzi w `app.json` — ten plik dokłada do niej JEDNĄ rzecz,
// której statyczny JSON nie umie: odczyt zmiennej środowiskowej.
//
// `google-services.json` NIE leży w repozytorium (jest w `.gitignore`). Na EAS
// wjeżdża jako zmienna projektu `GOOGLE_SERVICES_JSON` typu `file`: builder
// zapisuje plik POZA katalogiem projektu i podstawia do zmiennej BEZWZGLĘDNĄ
// ŚCIEŻKĘ do niego (nie zawartość). Dlatego `googleServicesFile` musi wskazywać
// na `process.env.GOOGLE_SERVICES_JSON`, a nie na ścieżkę w repo.
//
// Fallback na wartość z `app.json` (`./google-services.json`) jest dla pracy
// lokalnej: gdy ktoś robi `expo prebuild` u siebie, kładzie plik w korzeniu i
// zmienna nie jest ustawiona.
module.exports = ({ config }) => ({
  ...config,
  android: {
    ...config.android,
    googleServicesFile: process.env.GOOGLE_SERVICES_JSON ?? config.android.googleServicesFile,
  },
});
