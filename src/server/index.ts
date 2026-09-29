import { createGameServer } from './app.js';

const port = Number(process.env.PORT) || 3000;

// STATIC_DIR: optionaler Ordner mit dem gebauten Client (Standard: dist/client)
createGameServer({ port, staticDir: process.env.STATIC_DIR || undefined }).then(
  (game) => console.log(`1on1-Server läuft auf Port ${game.port}`),
  (err) => {
    console.error('Server konnte nicht starten:', err);
    process.exit(1);
  },
);
