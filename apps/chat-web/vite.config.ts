import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { configDefaults } from 'vitest/config';

export default defineConfig(({ command, mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env };
  const demo = command === 'serve' && env.RUNTIME_MODE === 'sandbox' &&
    env.VITE_SHOW_DEMO_LOGIN === 'true' && Boolean(env.SANDBOX_USER_EMAIL && env.SANDBOX_USER_PASSWORD) &&
    env.SANDBOX_USER_EMAIL !== env.CHAT_ADMIN_EMAIL;
  return {
  plugins: [react(), tailwindcss()],
  define: {
    'import.meta.env.VITE_SHOW_DEMO_LOGIN': JSON.stringify(demo ? 'true' : 'false'),
    'import.meta.env.VITE_DEMO_EMAIL': JSON.stringify(demo ? env.SANDBOX_USER_EMAIL : ''),
    'import.meta.env.VITE_DEMO_PASSWORD': JSON.stringify(demo ? env.SANDBOX_USER_PASSWORD : ''),
  },
  server: {
    host: '127.0.0.1',
    port: Number(process.env.V3_WEB_PORT) || 5174,
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${process.env.PORT || 3000}`,
        changeOrigin: true,
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    exclude: [...configDefaults.exclude, 'tests/browser/**'],
  },
  };
});
