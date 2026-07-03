import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

declare const process: {
  env: Record<string, string | undefined>;
};

export default defineConfig(({ command }) => {
  const enableDevTools =
    command === "serve" || process.env.VITEST === "true" || process.env.VITE_SPIDER_DEV_TOOLS === "true";
  const devToolsModule = enableDevTools ? "./src/dev/devTools.tsx" : "./src/dev/devTools.disabled.ts";

  return {
    plugins: [react()],
    clearScreen: false,
    resolve: {
      alias: {
        "#dev-tools": fileUrlToPath(new URL(devToolsModule, import.meta.url))
      }
    },
    server: {
      host: "127.0.0.1",
      port: 1420,
      strictPort: true
    },
    envPrefix: ["VITE_", "TAURI_"],
    test: {
      environment: "jsdom",
      exclude: ["tests/layout/**", "**/node_modules/**", "**/dist/**", "**/src-tauri/target/**"],
      globals: true,
      setupFiles: ["./src/test/setup.ts"]
    }
  };
});

function fileUrlToPath(url: URL): string {
  return decodeURIComponent(url.pathname).replace(/^\/([A-Za-z]:)/, "$1");
}
