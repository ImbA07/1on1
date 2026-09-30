import { randomInt, randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';
import {
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  cleanName,
  normalizeCode,
  DEFAULT_SETTINGS,
  cleanRounds,
  type ClientMessage,
  type NetEvent,
  type RoomSettings,
  type Phase,
  type PlayerInfo,
  type ServerMessage,
} from '../shared/protocol.js';
import { simToNet } from '../shared/netstate.js';
import { SPAWNS, TICK_RATE, newSimState, sanitizeInput, stepPlayer, type MoveInput, type SimState } from '../shared/sim.js';
import { BotBrain } from './bot.js';
import { Match } from './match.js';
import { resolveStrikes, type Fighter } from './resolve.js';

export const MAX_PLAYERS = 2;
const EMPTY_ROOM_TTL_MS = 60_000;
const MAX_ROOMS = 1000;
export const TICK_MS = 1000 / TICK_RATE;
const MAX_CATCHUP_TICKS = 6;

// Eingaben werden vom Server genau EINE pro Tick abgearbeitet. Damit kann niemand durch
// Eingaben-Fluten schneller laufen oder schneller zuschlagen. Ein kleiner Puffer faengt
// Netz-Schwankungen ab; wird er zu gross, werden die aeltesten Eingaben verworfen.
const MAX_QUEUE = 5;

const IDLE_INPUT: MoveInput = { fwd: 0, right: 0, yaw: 0, sprint: false, atk: false, blk: false, dir: 0 };

interface QueuedInput {
  seq: number;
  input: MoveInput;
}

interface Player {
  id: string;
  name: string;
  ws: WebSocket | null; // null = Trainings-Puppe
  bot: BotBrain | null;
  sim: SimState;
  ack: number; // zuletzt verarbeitete Eingabe
  lastSeq: number; // hoechste angenommene Eingabe
  queue: QueuedInput[];
  lastInput: MoveInput;
}

interface Room {
  code: string;
  players: Player[]; // Reihenfolge = Beitrittsreihenfolge (bestimmt den Startplatz)
  hostId: string;
  phase: Phase;
  emptySince: number | null;
  practice: boolean;
  match: Match | null;
  tick: number;
  settings: RoomSettings;
}

function send(ws: WebSocket | null, msg: ServerMessage): void {
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

export class RoomManager {
  private rooms = new Map<string, Room>();
  private byWs = new WeakMap<WebSocket, { room: Room; player: Player }>();
  private nextTickAt = 0;

  get roomCount(): number {
    return this.rooms.size;
  }

  handle(ws: WebSocket, msg: ClientMessage): void {
    switch (msg.t) {
      case 'create':
        return this.create(ws, msg.name, msg.practice === true);
      case 'join':
        return this.join(ws, msg.code, msg.name);
      case 'start':
        return this.start(ws);
      case 'settings':
        return this.settings(ws, msg.rounds);
      case 'toLobby':
        return this.toLobby(ws);
      case 'rematch':
        return this.rematch(ws);
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

    // Ohne Menschen im Raum (auch nicht mit Puppe) gibt es nichts mehr zu tun
    if (room.players.every((p) => p.bot)) {
      room.players = [];
      room.emptySince = Date.now();
      room.phase = 'lobby';
      room.match = null;
      if (room.practice) this.rooms.delete(room.code);
      return;
    }

    if (room.hostId === player.id) room.hostId = room.players[0]!.id;
    room.phase = 'lobby';
    room.match = null;
    for (const p of room.players) {
      send(p.ws, { t: 'info', message: `${player.name} hat den Raum verlassen.` });
    }
    this.broadcastRoom(room);
  }

  /**
   * Wird oft aufgerufen (z. B. alle 5 ms). Fuehrt so viele Spielschritte aus, wie seit dem
   * letzten Mal an Zeit vergangen ist (30 pro Sekunde), unabhaengig von Timer-Ungenauigkeit.
   */
  advance(nowMs: number): void {
    if (this.nextTickAt === 0) this.nextTickAt = nowMs;
    let n = 0;
    while (nowMs >= this.nextTickAt && n < MAX_CATCHUP_TICKS) {
      this.runTick();
      this.nextTickAt += TICK_MS;
      n++;
    }
    if (nowMs - this.nextTickAt > TICK_MS * MAX_CATCHUP_TICKS) this.nextTickAt = nowMs; // zu weit zurueck: aufgeben
  }

  /** Raeume ohne Spieler nach einer Weile loeschen. */
  cleanup(now = Date.now()): void {
    for (const [code, room] of this.rooms) {
      if (room.players.length === 0 && room.emptySince !== null && now - room.emptySince > EMPTY_ROOM_TTL_MS) {
        this.rooms.delete(code);
      }
    }
  }

  // ---- Spielschritt ----

  private runTick(): void {
    for (const room of this.rooms.values()) {
      if (room.phase !== 'arena' || !room.match || room.players.length < 2) continue;
      this.tickRoom(room);
    }
  }

  private tickRoom(room: Room): void {
    const match = room.match!;
    const events: NetEvent[] = [];
    const fighters = room.players.map((p) => ({ id: p.id, sim: p.sim })) as [Fighter, Fighter];
    const frozen = match.phase === 'roundEnd' || match.phase === 'matchEnd';

    room.tick++;
    room.players.forEach((p, i) => {
      const other = room.players[1 - i]!;
      let input: MoveInput;
      if (p.bot) {
        input = p.bot.think(p.sim, other.sim, match.canAct);
      } else {
        const q = p.queue.shift();
        if (q) {
          input = q.input;
          p.ack = q.seq;
          p.lastInput = q.input;
        } else {
          input = p.lastInput; // keine neue Eingabe angekommen: letzte weiterlaufen lassen
        }
      }
      if (frozen) input = { ...input, fwd: 0, right: 0, sprint: false, atk: false, blk: false };
      stepPlayer(p.sim, input, other.sim, match.canAct);
    });

    if (match.phase === 'fight') {
      let winner = resolveStrikes(fighters, match.stats, events);
      if (winner < 0) winner = match.checkLastChance(fighters);
      if (winner >= 0) match.endRound(winner, fighters, events);
    }
    match.advance(fighters);
    // Nach einem Zuruecksetzen (neue Runde) zeigen die Figuren auf frische Zustaende
    room.players.forEach((p, i) => (p.sim = fighters[i]!.sim));

    this.broadcastState(room, events);
  }

  private broadcastState(room: Room, events: NetEvent[]): void {
    const match = room.match!;
    const fighters = room.players.map((p) => ({ id: p.id, sim: p.sim })) as [Fighter, Fighter];
    const netMatch = match.toNet(fighters);
    for (const viewer of room.players) {
      if (!viewer.ws) continue;
      const players = room.players.map((p) => simToNet(p.id, p.sim, p.ack, p === viewer));
      send(viewer.ws, { t: 'state', tk: room.tick, players, ev: events, match: netMatch });
    }
  }

  // ---- Nachrichten ----

  private create(ws: WebSocket, rawName: string, practice: boolean): void {
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
      practice,
      match: null,
      tick: 0,
      settings: { ...DEFAULT_SETTINGS },
    };
    this.rooms.set(room.code, room);
    this.addPlayer(room, ws, rawName);
    room.hostId = room.players[0]!.id;
    if (practice) {
      this.addBot(room);
      this.beginArena(room);
    }
    this.broadcastRoom(room);
  }

  private join(ws: WebSocket, rawCode: string, rawName: string): void {
    if (this.byWs.has(ws)) return send(ws, { t: 'error', message: 'Du bist schon in einem Raum.' });
    const room = this.rooms.get(normalizeCode(rawCode));
    if (!room || room.practice) return send(ws, { t: 'error', message: 'Diesen Raum gibt es nicht (mehr). Bitte einen neuen Link holen.' });
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
    this.beginArena(room);
    this.broadcastRoom(room);
  }

  private beginArena(room: Room): void {
    room.match = new Match((room.settings.rounds + 1) / 2);
    room.players.forEach((p, i) => {
      const s = SPAWNS[i]!;
      p.sim = newSimState(s.x, s.z, s.yaw);
      p.ack = 0;
      p.queue = [];
      p.lastInput = { ...IDLE_INPUT, yaw: s.yaw };
    });
    room.phase = 'arena';
    room.tick = 0;
  }

  private settings(ws: WebSocket, rounds: number): void {
    const entry = this.byWs.get(ws);
    if (!entry) return;
    const { room, player } = entry;
    if (room.hostId !== player.id || room.phase !== 'lobby') return;
    room.settings.rounds = cleanRounds(rounds);
    this.broadcastRoom(room);
  }

  private toLobby(ws: WebSocket): void {
    const entry = this.byWs.get(ws);
    if (!entry) return;
    const { room, player } = entry;
    if (room.phase === 'lobby') return;
    if (room.practice) {
      // Training hat keine Lobby: zurueck bedeutet, den Raum zu verlassen (Client macht das)
      return;
    }
    room.phase = 'lobby';
    room.match = null;
    for (const p of room.players) {
      if (p !== player) send(p.ws, { t: 'info', message: `${player.name} ist zurück in die Lobby gegangen.` });
    }
    this.broadcastRoom(room);
  }

  private rematch(ws: WebSocket): void {
    const entry = this.byWs.get(ws);
    if (!entry) return;
    const { room, player } = entry;
    const match = room.match;
    if (!match || match.phase !== 'matchEnd') return;
    match.rematch.add(player.id);
    for (const p of room.players) if (p.bot) match.rematch.add(p.id);
    if (room.players.every((p) => match.rematch.has(p.id))) {
      const fighters = room.players.map((p) => ({ id: p.id, sim: p.sim })) as [Fighter, Fighter];
      match.restart(fighters);
      room.players.forEach((p, i) => {
        p.sim = fighters[i]!.sim;
        p.queue = [];
        p.ack = 0;
        p.lastSeq = 0;
      });
    }
  }

  private input(ws: WebSocket, msg: Extract<ClientMessage, { t: 'input' }>): void {
    const entry = this.byWs.get(ws);
    if (!entry) return;
    const { room, player } = entry;
    if (room.phase !== 'arena') return;

    // Nur neuere Eingaben zaehlen (Reihenfolge einhalten)
    if (typeof msg.seq !== 'number' || !Number.isFinite(msg.seq) || msg.seq <= player.lastSeq) return;
    player.lastSeq = msg.seq;
    player.queue.push({ seq: msg.seq, input: sanitizeInput(msg) });
    // Zu viele auf einmal: die aeltesten fallen weg (ihr ack springt dann weiter)
    while (player.queue.length > MAX_QUEUE) player.queue.shift();
  }

  // ---- Hilfsfunktionen ----

  private addPlayer(room: Room, ws: WebSocket, rawName: string): Player {
    const name = cleanName(rawName) || 'Ritter';
    const player = this.makePlayer(room, name, ws, null);
    this.byWs.set(ws, { room, player });
    return player;
  }

  private addBot(room: Room): void {
    this.makePlayer(room, 'Trainingspuppe', null, new BotBrain(randomInt(1, 1_000_000)));
  }

  private makePlayer(room: Room, name: string, ws: WebSocket | null, bot: BotBrain | null): Player {
    const spawn = SPAWNS[room.players.length] ?? SPAWNS[0]!;
    const player: Player = {
      id: randomUUID().slice(0, 8),
      name,
      ws,
      bot,
      sim: newSimState(spawn.x, spawn.z, spawn.yaw),
      ack: 0,
      lastSeq: 0,
      queue: [],
      lastInput: { ...IDLE_INPUT, yaw: spawn.yaw },
    };
    room.players.push(player);
    return player;
  }

  private broadcastRoom(room: Room): void {
    const players: PlayerInfo[] = room.players.map((p) => ({ id: p.id, name: p.name, ...(p.bot ? { bot: true } : {}) }));
    for (const p of room.players) {
      send(p.ws, {
        t: 'room',
        code: room.code,
        youId: p.id,
        hostId: room.hostId,
        phase: room.phase,
        players,
        practice: room.practice,
        settings: room.settings,
      });
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
