import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    // Never hot-reload on non-source files. The SQLite WAL changes on every
    // write, so without this every save forces a full page reload and blows
    // away form state / scroll position mid-typing.
    watch: {
      ignored: [
        '**/data/**',
        '**/*.sqlite',
        '**/*.sqlite-wal',
        '**/*.sqlite-shm',
        '**/tsconfig.tsbuildinfo',
        '**/dist/**',
        '**/screenshots/**',
        '**/scripts/**',
      ],
    },
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
      },
    },
  },
});
