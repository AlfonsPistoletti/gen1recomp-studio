import { defineConfig } from "vite";
import { handleApi } from "./server/api.ts";

export default defineConfig({
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
});
