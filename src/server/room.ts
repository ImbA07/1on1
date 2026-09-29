import { randomInt, randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';
import {
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  cleanName,
  normalizeCode,
  type ClientMessage,
  type NetPlayerState,
  type Phase,
  type ServerMessage,
} from '../shared/protocol.js';
import { SPAWNS, TICK_RATE, newSimState, sanitizeInput, stepPlayer, type SimState } from '../shared/sim.js';

export const MAX_PLAYERS = 2;
const EMPTY_ROOM_TTL_MS = 60_000;
const MAX_ROOMS = 1000;

// Jede Eingabe ist ein voller Simulationsschritt (1/30 s). Damit niemand durch
// Eingaben-Fluten schneller laufen oder "teleportieren" kann, darf ein Spieler
// im Schnitt nur so viele Schritte machen, wie Zeit vergangen ist (30 pro Sekunde,
// plus 3 % Toleranz). Der Vorrat ist klein (0,5 s), damit Netz-Hakler ehrlicher
// Spieler noch aufgefangen werden, ein gestauter Schwung aber kein Teleport wird.
const INPUT_BUCKET_CAPACITY = 15;
const INPUT_REFILL_PER_SEC = TICK_RATE * 1.03;

interface Player {
  id: string;
  name: string;
  ws: WebSocket;
  sim: SimState;
  ack: number;
  tokens: number;
  lastRefill: number;
}

interface Room {
  code: string;
  players: Player[]; // Reihenfolge = Beitrittsreihenfolge (bestimmt den Startplatz)
  hostId: string;
  phase: Phase;
  emptySince: number | null;
}

function send(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function round(v: number, digits = 3): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

export class RoomManager {
  private rooms = new Map<string, Room>();
  private byWs = new WeakMap<WebSocket, { room: Room; player: Player }>();

  get roomCount(): number {
    return this.rooms.size;
  }

  handle(ws: WebSocket, msg: ClientMessage): void {
    switch (msg.t) {
      case 'create':
        return this.create(ws, msg.name);
      case 'join':
        return this.join(ws, msg.code, msg.name);
      case 'start':
        return this.start(ws);
      case 'toLobby':
        return this.toLobby(ws);
      case 'input':
        return this.input(ws, msg);
      case 'ping':
        return;
    }
  }

  disconnect(ws: WebSocket): void {
    const entry = this.byWs.get(ws);
    if (!entry) return;
    this.byWs.delete(ws);
    const { room, player } = entry;
    room.players = room.players.filter((p) => p !== player);

    if (room.players.length === 0) {
      room.emptySince = Date.now();
      room.phase = 'lobby';
      return;
    }

    if (room.hostId === player.id) room.hostId = room.players[0]!.id;
    room.phase = 'lobby';
    for (const p of room.players) {
      send(p.ws, { t: 'info', message: `${player.name} hat den Raum verlassen.` });
    }
    this.broadcastRoom(room);
  }

  /** Wird regelmaessig aufgerufen: schickt den Spielstand an alle Raeume im Kampf. */
  broadcastStates(): void {
    for (const room of this.rooms.values()) {
      if (room.phase !== 'arena') continue;
      const players: NetPlayerState[] = room.players.map((p) => ({
        id: p.id,
        x: round(p.sim.x),
        z: round(p.sim.z),
        yaw: round(p.sim.yaw),
        // Ausdauer und Pause bewusst ungerundet: Der Client muss exakt gleich weiterrechnen
        st: p.sim.stamina,
        ex: p.sim.exhausted,
        rd: p.sim.regenDelay,
        sp: p.sim.sprinting,
        ack: p.ack,
      }));
      for (const p of room.players) send(p.ws, { t: 'state', players });
    }
  }

  /** Raeume ohne Spieler nach einer Weile loeschen. */
  cleanup(now = Date.now()): void {
    for (const [code, room] of this.rooms) {
      if (room.players.length === 0 && room.emptySince !== null && now - room.emptySince > EMPTY_ROOM_TTL_MS) {
        this.rooms.delete(code);
      }
    }
  }

  // ---- Nachrichten ----

  private create(ws: WebSocket, rawName: string): void {
    if (this.byWs.has(ws)) return send(ws, { t: 'error', message: 'Du bist schon in einem Raum.' });
    if (this.rooms.size >= MAX_ROOMS) {
      // Leere Raeume sofort wegraeumen, damit sie das Limit nicht blockieren koennen
      for (const [code, r] of this.rooms) if (r.players.length === 0) this.rooms.delete(code);
    }
    if (this.rooms.size >= MAX_ROOMS) {
      return send(ws, { t: 'error', message: 'Gerade sind zu viele Räume offen. Versuch es später noch einmal.' });
    }
    const room: Room = {
      code: this.newCode(),
      players: [],
      hostId: '',
      phase: 'lobby',
      emptySince: null,
    };
    this.rooms.set(room.code, room);
    this.addPlayer(room, ws, rawName);
    room.hostId = room.players[0]!.id;
    this.broadcastRoom(room);
  }

  private join(ws: WebSocket, rawCode: string, rawName: string): void {
    if (this.byWs.has(ws)) return send(ws, { t: 'error', message: 'Du bist schon in einem Raum.' });
    const room = this.rooms.get(normalizeCode(rawCode));
    if (!room) return send(ws, { t: 'error', message: 'Diesen Raum gibt es nicht (mehr). Bitte einen neuen Link holen.' });
    if (room.players.length >= MAX_PLAYERS) return send(ws, { t: 'error', message: 'Der Raum ist schon voll.' });
    room.emptySince = null;
    this.addPlayer(room, ws, rawName);
    if (room.hostId === '' || !room.players.some((p) => p.id === room.hostId)) {
      room.hostId = room.players[0]!.id;
    }
    this.broadcastRoom(room);
  }

  private start(ws: WebSocket): void {
    const entry = this.byWs.get(ws);
    if (!entry) return;
    const { room, player } = entry;
    if (room.hostId !== player.id) return send(ws, { t: 'error', message: 'Nur der Ersteller kann den Kampf starten.' });
    if (room.players.length < MAX_PLAYERS) return send(ws, { t: 'error', message: 'Es fehlt noch ein Gegner.' });
    if (room.phase === 'arena') return;

    room.players.forEach((p, i) => {
      const s = SPAWNS[i]!;
      p.sim = newSimState(s.x, s.z, s.yaw);
      p.ack = 0;
      p.tokens = INPUT_BUCKET_CAPACITY;
      p.lastRefill = Date.now();
    });
    room.phase = 'arena';
    this.broadcastRoom(room);
    this.broadcastStates();
  }

  private toLobby(ws: WebSocket): void {
    const entry = this.byWs.get(ws);
    if (!entry) return;
    const { room, player } = entry;
    if (room.phase === 'lobby') return;
    room.phase = 'lobby';
    for (const p of room.players) {
      if (p !== player) send(p.ws, { t: 'info', message: `${player.name} ist zurück in die Lobby gegangen.` });
    }
    this.broadcastRoom(room);
  }

  private input(ws: WebSocket, msg: Extract<ClientMessage, { t: 'input' }>): void {
    const entry = this.byWs.get(ws);
    if (!entry) return;
    const { room, player } = entry;
    if (room.phase !== 'arena') return;

    // Reihenfolge einhalten: nur neuere Eingaben zaehlen
    if (typeof msg.seq !== 'number' || !Number.isFinite(msg.seq) || msg.seq <= player.ack) return;

    // Mehr Eingaben als Zeit vergangen ist? Dann wird der Schritt NICHT ausgefuehrt.
    // Wir bestaetigen ihn trotzdem (ack), damit der Client ihn nicht ewig als
    // "offen" mitschleppt und stattdessen auf den Server-Stand zurueckgesetzt wird.
    const now = Date.now();
    player.tokens = Math.min(
      INPUT_BUCKET_CAPACITY,
      player.tokens + ((now - player.lastRefill) / 1000) * INPUT_REFILL_PER_SEC,
    );
    player.lastRefill = now;
    if (player.tokens < 1) {
      player.ack = msg.seq;
      return;
    }
    player.tokens -= 1;

    const other = room.players.find((p) => p !== player);
    stepPlayer(player.sim, sanitizeInput(msg), other?.sim);
    player.ack = msg.seq;
  }

  // ---- Hilfsfunktionen ----

  private addPlayer(room: Room, ws: WebSocket, rawName: string): Player {
    const name = cleanName(rawName) || 'Ritter';
    const spawn = SPAWNS[room.players.length] ?? SPAWNS[0]!;
    const player: Player = {
      id: randomUUID().slice(0, 8),
      name,
      ws,
      sim: newSimState(spawn.x, spawn.z, spawn.yaw),
      ack: 0,
      tokens: INPUT_BUCKET_CAPACITY,
      lastRefill: Date.now(),
    };
    room.players.push(player);
    this.byWs.set(ws, { room, player });
    return player;
  }

  private broadcastRoom(room: Room): void {
    const players = room.players.map((p) => ({ id: p.id, name: p.name }));
    for (const p of room.players) {
      send(p.ws, { t: 'room', code: room.code, youId: p.id, hostId: room.hostId, phase: room.phase, players });
    }
  }

  private newCode(): string {
    for (let attempt = 0; attempt < 50; attempt++) {
      let code = '';
      for (let i = 0; i < ROOM_CODE_LENGTH; i++) code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
      if (!this.rooms.has(code)) return code;
    }
    throw new Error('Kein freier Raum-Code gefunden');
  }
}
