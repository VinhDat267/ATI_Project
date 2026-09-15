import { defineConfig } from "vite";
import { localProxy } from "./tooling/local-proxy.js";

const apiTarget = process.env.WAP_API_TARGET || "http://127.0.0.1:3001";
const frontendOrigin = process.env.WAP_FRONTEND_ORIGIN || "http://127.0.0.1:5173";

export default defineConfig({
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    cors: false,
    open: false,
  },
  preview: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: true,
    cors: false,
    open: false,
  },
  plugins: [
    localProxy({
      target: apiTarget,
      devOrigin: frontendOrigin,
      previewOrigin: "http://127.0.0.1:4173",
    }),
  ],
});
