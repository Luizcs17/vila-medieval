import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths so the build can later be packaged as a desktop app (Electron/Tauri).
  base: './',
  server: { port: 5173 },
});
