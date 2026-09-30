import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import type { ClientMessage } from '../shared/protocol.js';
import { RoomManager } from './room.js';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json',
};

// Der Spielschritt wird alle paar Millisekunden angestossen; rooms.advance() rechnet dann so viele
// Schritte (30 pro Sekunde), wie an Zeit vergangen ist. So bleibt das Tempo auch bei ungenauen Timern exakt.
const TICK_POLL_MS = 4;
const HEARTBEAT_INTERVAL_MS = 25_000;

export interface GameServerOptions {
  port: number;
  staticDir?: string; // Ordner mit dem gebauten Client (dist/client)
}

export interface GameServer {
  server: Server;
  rooms: RoomManager;
  port: number;
  close(): Promise<void>;
}

async function serveStatic(staticDir: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400).end('Bad request');
    return;
  }

  if (pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok');
    return;
  }

  const root = path.resolve(staticDir);
  let filePath = path.join(root, pathname === '/' ? 'index.html' : pathname);
  // Schutz vor "../"-Tricks
  if (filePath !== root && !filePath.startsWith(root + path.sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  let isIndex = path.basename(filePath) === 'index.html';
  let data: Buffer;
  try {
    data = await fs.readFile(filePath);
  } catch {
    // Raum-Links (/r/ABCDE) und andere Seiten ohne Dateiendung laden die App
    if (path.extname(pathname) === '') {
      try {
        filePath = path.join(root, 'index.html');
        data = await fs.readFile(filePath);
        isIndex = true;
      } catch {
        res.writeHead(503).end('Client noch nicht gebaut. Bitte "npm run build" ausfuehren.');
        return;
      }
    } else {
      res.writeHead(404).end('Not found');
      return;
    }
  }

  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME[ext] ?? 'application/octet-stream',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': isIndex ? 'no-cache' : 'public, max-age=31536000, immutable',
  });
  res.end(data);
}

function parseMessage(raw: string): ClientMessage | null {
  try {
    const msg = JSON.parse(raw) as unknown;
    if (typeof msg !== 'object' || msg === null || typeof (msg as { t?: unknown }).t !== 'string') return null;
    return msg as ClientMessage;
  } catch {
    return null;
  }
}

export function createGameServer(opts: GameServerOptions): Promise<GameServer> {
  const staticDir = opts.staticDir ?? path.resolve(process.cwd(), 'dist/client');
  const rooms = new RoomManager();

  const server = createServer((req, res) => {
    serveStatic(staticDir, req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end('Server error');
    });
  });

  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 2048 });
  const alive = new WeakSet<WebSocket>();

  wss.on('connection', (ws) => {
    alive.add(ws);
    ws.on('pong', () => alive.add(ws));
    ws.on('message', (data) => {
      const msg = parseMessage(data.toString());
      if (!msg) return;
      try {
        rooms.handle(ws, msg);
      } catch (err) {
        console.error('Fehler bei Nachricht', msg.t, err);
      }
    });
    ws.on('close', () => rooms.disconnect(ws));
    ws.on('error', () => rooms.disconnect(ws));
  });

  const broadcastTimer = setInterval(() => rooms.advance(performance.now()), TICK_POLL_MS);
  const cleanupTimer = setInterval(() => rooms.cleanup(), 10_000);
  // Tote Verbindungen erkennen (und Hosting-Proxys wach halten)
  const heartbeatTimer = setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.has(ws)) {
        ws.terminate();
        continue;
      }
      alive.delete(ws);
      ws.ping();
    }
  }, HEARTBEAT_INTERVAL_MS);

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port, () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : opts.port;
      resolve({
        server,
        rooms,
        port,
        close: () =>
          new Promise<void>((done) => {
            clearInterval(broadcastTimer);
            clearInterval(cleanupTimer);
            clearInterval(heartbeatTimer);
            for (const ws of wss.clients) ws.terminate();
            wss.close(() => server.close(() => done()));
          }),
      });
    });
  });
}
