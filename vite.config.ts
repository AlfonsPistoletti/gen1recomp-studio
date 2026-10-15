import { defineConfig } from "vite";
import { handleApi } from "./server/api.ts";

export default defineConfig(({ command }) => ({
  // unfinished features (src/features.ts): on in the dev server, off in builds
  // unless VITE_EXPERIMENTAL=1; a constant, so builds drop the code behind it
  define: {
    __EXPERIMENTAL__: JSON.stringify(command === "serve" || process.env.VITE_EXPERIMENTAL === "1"),
    // shown in bug reports (src/ui/bugReport.ts); npm sets it for every script
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? "dev"),
  },
  server: {
    port: 5178,
    strictPort: true,
    // the desktop shell (npm run tauri dev) opens its own window on this server
    open: !process.env.TAURI_ENV_PLATFORM,
    // Rust build output must not trigger page reloads
    watch: { ignored: ["**/src-tauri/**"] },
  },
  // leave Rust compiler errors visible in the shared terminal
  clearScreen: false,
  preview: { port: 5178 },
  plugins: [
    {
      name: "gen1recomp-studio-api",
      configureServer(server) {
        server.middlewares.use((req, res, next) => void handleApi(req, res, next));
      },
      configurePreviewServer(server) {
        server.middlewares.use((req, res, next) => void handleApi(req, res, next));
      },
    },
  ],
}));
