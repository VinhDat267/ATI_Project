import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { configDefaults } from "vitest/config";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    "import.meta.env.VITE_RUNTIME_MODE": JSON.stringify(
      process.env.RUNTIME_MODE || "unknown",
    ),
  },
  server: {
    host: "127.0.0.1",
    port: Number(process.env.V3_WEB_PORT) || 5174,
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${process.env.PORT || 3000}`,
        changeOrigin: true,
      },
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    exclude: [...configDefaults.exclude, "tests/browser/**"],
  },
});
