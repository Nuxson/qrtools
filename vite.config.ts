import { defineConfig } from "vite";

export default defineConfig({
  base: process.env.TAURI_ENV_PLATFORM ? "/" : "/qrtools/",
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  build: {
    target: process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari13",
    minify: !process.env.TAURI_ENV_DEBUG ? "esbuild" : false,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
    rollupOptions: {
      external: process.env.TAURI_ENV_PLATFORM ? [] : ["@tauri-apps/api/core"],
    },
  },
});
