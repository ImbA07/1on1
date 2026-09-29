import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { createGameServer, type GameServer } from '../src/server/app.js';
import type { ClientMessage, ServerMessage } from '../src/shared/protocol.js';

class Client {
  ws: WebSocket;
  messages: ServerMessage[] = [];
  private waiters: Array<{ pred: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void }> = [];

  constructor(port: number) {
    this.ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    this.ws.on('message', (data) => {
      const msg = JSON.parse(data.toString()) as ServerMessage;
      this.messages.push(msg);
      this.waiters = this.waiters.filter((w) => {
        if (w.pred(msg)) {
          w.resolve(msg);
          return false;
        }
        return true;
      });
    });
  }

  open(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws.once('open', () => resolve());
      this.ws.once('error', reject);
    });
  }

  send(msg: ClientMessage): void {
    this.ws.send(JSON.stringify(msg));
  }

  /** Wartet auf die naechste passende Nachricht (auch auf eine, die schon da ist). */
  waitFor<T extends ServerMessage['t']>(type: T, extra?: (m: Extract<ServerMessage, { t: T }>) => boolean) {
    const pred = (m: ServerMessage) => m.t === type && (!extra || extra(m as Extract<ServerMessage, { t: T }>));
    const existing = this.messages.find(pred);
    if (existing) return Promise.resolve(existing as Extract<ServerMessage, { t: T }>);
    return new Promise<Extract<ServerMessage, { t: T }>>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timeout beim Warten auf "${type}"`)), 2000);
      this.waiters.push({
        pred,
        resolve: (m) => {
          clearTimeout(timer);
          resolve(m as Extract<ServerMessage, { t: T }>);
        },
      });
    });
  }

  clear(): void {
    this.messages = [];
  }

  close(): void {
    this.ws.close();
  }
}

async function withServer(fn: (game: GameServer) => Promise<void>): Promise<void> {
  const game = await createGameServer({ port: 0, staticDir: '/nonexistent' });
  try {
    await fn(game);
  } finally {
    await game.close();
  }
}

async function connect(game: GameServer): Promise<Client> {
  const c = new Client(game.port);
  await c.open();
  return c;
}

test('Raum erstellen, beitreten, starten', async () => {
  await withServer(async (game) => {
    const a = await connect(game);
    const b = await connect(game);

    a.send({ t: 'create', name: 'Alice' });
    const created = await a.waitFor('room');
    assert.match(created.code, /^[A-Z2-9]{5}$/);
    assert.equal(created.players.length, 1);
    assert.equal(created.hostId, created.youId);
    assert.equal(created.phase, 'lobby');

    b.send({ t: 'join', code: created.code.toLowerCase(), name: 'Bob' });
    const joined = await b.waitFor('room');
    assert.equal(joined.players.length, 2);
    assert.notEqual(joined.youId, created.youId);
    assert.equal(joined.hostId, created.youId);

    // Alice bekommt auch das Update
    const update = await a.waitFor('room', (m) => m.players.length === 2);
    assert.deepEqual(update.players.map((p) => p.name), ['Alice', 'Bob']);

    // Gast darf nicht starten
    b.send({ t: 'start' });
    const err = await b.waitFor('error');
    assert.match(err.message, /Ersteller/);

    a.send({ t: 'start' });
    const arenaA = await a.waitFor('room', (m) => m.phase === 'arena');
    assert.equal(arenaA.phase, 'arena');
    const state = await a.waitFor('state');
    assert.equal(state.players.length, 2);
    // Startplaetze gegenueber
    const sa = state.players.find((p) => p.id === created.youId)!;
    const sb = state.players.find((p) => p.id === joined.youId)!;
    assert.ok(sa.z > 0 && sb.z < 0);

    a.close();
    b.close();
  });
});

test('Starten ohne Gegner geht nicht', async () => {
  await withServer(async (game) => {
    const a = await connect(game);
    a.send({ t: 'create', name: 'Alice' });
    await a.waitFor('room');
    a.send({ t: 'start' });
    const err = await a.waitFor('error');
    assert.match(err.message, /Gegner/);
    a.close();
  });
});

test('unbekannter und voller Raum', async () => {
  await withServer(async (game) => {
    const a = await connect(game);
    const b = await connect(game);
    const c = await connect(game);

    c.send({ t: 'join', code: 'ZZZZZ', name: 'X' });
    assert.match((await c.waitFor('error')).message, /gibt es nicht/);
    c.clear();

    a.send({ t: 'create', name: 'A' });
    const { code } = await a.waitFor('room');
    b.send({ t: 'join', code, name: 'B' });
    await b.waitFor('room');

    c.send({ t: 'join', code, name: 'C' });
    assert.match((await c.waitFor('error')).message, /voll/);

    [a, b, c].forEach((x) => x.close());
  });
});

test('Eingaben bewegen die Figur, Server bestaetigt mit ack', async () => {
  await withServer(async (game) => {
    const a = await connect(game);
    const b = await connect(game);
    a.send({ t: 'create', name: 'A' });
    const room = await a.waitFor('room');
    b.send({ t: 'join', code: room.code, name: 'B' });
    await b.waitFor('room');
    a.send({ t: 'start' });
    await a.waitFor('room', (m) => m.phase === 'arena');
    await a.waitFor('state');

    // 10 Schritte nach vorne (yaw 0 = -z). A startet bei z = 6. 10 liegt im erlaubten Vorrat.
    for (let seq = 1; seq <= 10; seq++) {
      a.send({ t: 'input', seq, fwd: 1, right: 0, yaw: 0, sprint: false });
    }
    const state = await a.waitFor('state', (m) => m.players.find((p) => p.id === room.youId)?.ack === 10);
    const me = state.players.find((p) => p.id === room.youId)!;
    const walked = 6 - me.z;
    assert.ok(Math.abs(walked - 10 * 2.4 * (1 / 30)) < 0.05, `10 Schritte = ca. 0,8 m, gelaufen: ${walked}`);
    assert.ok(Math.abs(me.x) < 1e-6);

    // Der Gegner sieht die Bewegung auch
    const stateB = await b.waitFor('state', (m) => m.players.find((p) => p.id === room.youId)?.ack === 10);
    assert.equal(stateB.players.find((p) => p.id === room.youId)!.z, me.z);

    // Alte Eingaben (seq zu klein) werden ignoriert
    a.send({ t: 'input', seq: 5, fwd: 1, right: 0, yaw: 0, sprint: false });
    await new Promise((r) => setTimeout(r, 150));
    const last = [...a.messages].reverse().find((m): m is Extract<ServerMessage, { t: 'state' }> => m.t === 'state')!;
    assert.equal(last.players.find((p) => p.id === room.youId)!.ack, 10);

    a.close();
    b.close();
  });
});

test('Eingaben-Flut macht nicht schneller (kein Speed-Hack, kein Teleport)', async () => {
  await withServer(async (game) => {
    const a = await connect(game);
    const b = await connect(game);
    a.send({ t: 'create', name: 'A' });
    const room = await a.waitFor('room');
    b.send({ t: 'join', code: room.code, name: 'B' });
    await b.waitFor('room');
    a.send({ t: 'start' });
    await a.waitFor('room', (m) => m.phase === 'arena');

    // 200 Sprint-Eingaben auf einmal (= 6,7 Sekunden Bewegung in wenigen Millisekunden)
    for (let seq = 1; seq <= 200; seq++) {
      a.send({ t: 'input', seq, fwd: 1, right: 0, yaw: 0, sprint: true });
    }
    const state = await a.waitFor('state', (m) => m.players.find((p) => p.id === room.youId)?.ack === 200);
    const me = state.players.find((p) => p.id === room.youId)!;
    const walked = 6 - me.z;
    // Erlaubt: Vorrat (15) plus etwas Nachschub waehrend des Sendens, hoechstens ca. 20 Schritte
    assert.ok(walked < 20 * 4.2 * (1 / 30) + 0.01, `zu weit gelaufen: ${walked} m`);
    assert.ok(walked > 5 * 4.2 * (1 / 30), 'ein Teil der Eingaben muss zaehlen');
    a.close();
    b.close();
  });
});

test('Verlaesst ein Spieler den Raum, geht der andere zurueck in die Lobby', async () => {
  await withServer(async (game) => {
    const a = await connect(game);
    const b = await connect(game);
    a.send({ t: 'create', name: 'A' });
    const room = await a.waitFor('room');
    b.send({ t: 'join', code: room.code, name: 'B' });
    await b.waitFor('room');
    a.send({ t: 'start' });
    await b.waitFor('room', (m) => m.phase === 'arena');

    a.close();
    const back = await b.waitFor('room', (m) => m.phase === 'lobby' && m.players.length === 1);
    assert.equal(back.players.length, 1);
    assert.equal(back.hostId, back.youId, 'B wird neuer Host');
    const info = await b.waitFor('info');
    assert.match(info.message, /verlassen/);
    b.close();
  });
});

test('Schrott-Nachrichten bringen den Server nicht zum Absturz', async () => {
  await withServer(async (game) => {
    const a = await connect(game);
    a.ws.send('das ist kein json');
    a.ws.send(JSON.stringify({ t: 'gibtsnicht' }));
    a.ws.send(JSON.stringify({ t: 'input', seq: 'x', fwd: {}, right: null }));
    a.ws.send(JSON.stringify({ t: 'create', name: 12345 }));
    const room = await a.waitFor('room');
    assert.equal(room.players[0]!.name, 'Ritter');
    a.close();
  });
});
