import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Saved data lives in the browser per address (localhost:5173). If that port is busy, fail
  // instead of silently moving to another port, where the app would look empty.
  server: { port: 5173, strictPort: true },
});
