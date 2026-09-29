import { createGameServer } from './app.js';

const port = Number(process.env.PORT) || 3000;

createGameServer({ port }).then(
  (game) => console.log(`1on1-Server läuft auf Port ${game.port}`),
  (err) => {
    console.error('Server konnte nicht starten:', err);
    process.exit(1);
  },
);
