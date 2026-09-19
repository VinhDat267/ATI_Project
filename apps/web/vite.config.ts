import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { localProxy } from "./tooling/local-proxy.js";

export default defineConfig(({ mode }) => {
  const apiTarget = process.env.WAP_API_TARGET || "http://127.0.0.1:3001";
  const frontendOrigin =
    process.env.WAP_FRONTEND_ORIGIN || "http://127.0.0.1:5173";
  const previewOrigin = process.env.WAP_PREVIEW_ORIGIN;

  return {
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
        "@wap/web-mode-entry": fileURLToPath(
          new URL(
            mode === "live" ? "./src/main.live.tsx" : "./src/main.fixture.tsx",
            import.meta.url,
          ),
        ),
      },
    },
    server: {
      host: "127.0.0.1",
      port: 5173,
      strictPort: true,
      cors: false,
      open: false,
    },
    preview: {
      host: "127.0.0.1",
      port: process.env.WAP_PREVIEW_PORT ? Number(process.env.WAP_PREVIEW_PORT) : 4173,
      strictPort: !process.env.WAP_PREVIEW_PORT || process.env.WAP_PREVIEW_PORT !== "0",
      cors: false,
      open: false,
    },
    plugins: [
      react(),
      tailwindcss(),
      localProxy({
        target: apiTarget,
        devOrigin: frontendOrigin,
        previewOrigin: previewOrigin || undefined,
      }),
    ],
  };
});
