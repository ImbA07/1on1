import { defineConfig } from 'vite';

// Im Entwicklungsmodus laeuft der Server auf Port 3000, Vite auf 5173.
// Vite leitet /ws an den Server weiter, damit Client und Server zusammenspielen.
export default defineConfig({
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/ws': { target: 'ws://localhost:3000', ws: true },
    },
  },
});
