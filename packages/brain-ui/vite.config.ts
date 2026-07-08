import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/knowledge': 'http://127.0.0.1:3456',
      '/health': 'http://127.0.0.1:3456',
      '/stats': 'http://127.0.0.1:3456',
      '/activity': 'http://127.0.0.1:3456',
      '/export': 'http://127.0.0.1:3456',
    },
  },
});
