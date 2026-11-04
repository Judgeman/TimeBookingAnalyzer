/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
// @ts-expect-error type error without @types/node package
import process from "node:process";
// @ts-expect-error type error without @types/node package
import { readFileSync } from "node:fs";
const host = process.env.TAURI_DEV_HOST;
/** Versionsnummer aus package.json (einzige Quelle; Tauri liest sie ebenfalls dort). */
const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [react(), tailwindcss()],
  define: { __APP_VERSION__: JSON.stringify(version) },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },

  // Unit- und Komponententests (npm test / npm run test:coverage)
  test: {
    environment: "jsdom",
    setupFiles: ["src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8" as const,
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.test.{ts,tsx}", "src/test/**", "src/main.tsx", "src/vite-env.d.ts"],
      reporter: ["text", "html", "lcov"],
      reportsDirectory: "coverage/frontend",
      // Mindestabdeckung – CI schlägt fehl, wenn sie unterschritten wird.
      thresholds: { lines: 90, statements: 90, functions: 85, branches: 85 },
    },
  },
}));
