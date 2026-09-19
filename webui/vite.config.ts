import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig({
  // Ścieżki względne, bo ten build nie leży już pod adresem serwera. Cały
  // interfejs jedzie w paczce aplikacji i WebView ładuje go z pamięci —
  // patrz `scripts/bundle-webui.mjs` i sekcja 2 CLAUDE.md.
  base: "./",
  // Jeden plik HTML z wszystkim w środku. WebView dostaje go jako string, więc
  // każdy osobny plik obok byłby nie do wczytania — nie ma katalogu, z którego
  // mógłby go pobrać.
  plugins: [react(), tailwindcss(), viteSingleFile()],
  test: {
    environment: "node",
    include: ["server/**/*.test.ts", "src/**/*.test.ts"],
    // the suite spawns fake provider CLIs and a real harness server;
    // parallel files introduce load-sensitive flakes for no win
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    // IPv4 explicitly — a bare ::1 bind makes localhost a coin-flip for
    // clients that resolve IPv4 first
    host: "127.0.0.1",
    port: 5199,
    // packager output lands inside the repo — its HTML files must never
    // trigger dev full-page reloads
    watch: {
      ignored: [
        "**/release/**",
        "**/build/**",
        "**/dist/**",
        "**/electron/resources/**",
      ],
    },
    // the harness server owns every provider process; the app only ever
    // talks to /api — clients hold no transports
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${process.env.OGB_PORT || 8799}`,
        // multibot: harness ma własny WebSocket — bez tego dev-serwer nie
        // przepuszcza upgrade'u i kanał eventów działa wyłącznie w apce pakowanej
        ws: true,
      },
    },
  },
});
