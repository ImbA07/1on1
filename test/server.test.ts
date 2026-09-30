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
  waitFor<T extends ServerMessage['t']>(type: T, extra?: (m: Extract<ServerMessage, { t: T }>) => boolean, timeoutMs = 2000) {
    const pred = (m: ServerMessage) => m.t === type && (!extra || extra(m as Extract<ServerMessage, { t: T }>));
    const existing = this.messages.find(pred);
    if (existing) return Promise.resolve(existing as Extract<ServerMessage, { t: T }>);
    return new Promise<Extract<ServerMessage, { t: T }>>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timeout beim Warten auf "${type}"`)), timeoutMs);
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
    await a.waitFor('state', (m) => m.match?.ph === 'fight', 6000); // erst nach dem Countdown darf man sich bewegen

    // 10 Schritte nach vorne (yaw 0 = -z), im Takt gesendet wie ein echter Client. A startet bei z = 6.
    for (let seq = 1; seq <= 10; seq++) {
      a.send({ t: 'input', seq, fwd: 1, right: 0, yaw: 0, sprint: false, atk: false, blk: false, dir: 0 });
      await new Promise((r) => setTimeout(r, 34));
    }
    const state = await a.waitFor('state', (m) => m.players.find((p) => p.id === room.youId)?.ack === 10);
    const me = state.players.find((p) => p.id === room.youId)!;
    const step = 2.4 / 30;
    const walked = 6 - me.z;
    assert.ok(walked > 7 * step && walked < 13 * step, `ca. 10 Schritte erwartet, gelaufen: ${(walked / step).toFixed(1)}`);
    assert.ok(Math.abs(me.x) < 1e-6);

    // Der Gegner sieht die Bewegung auch
    const stateB = await b.waitFor('state', (m) => m.players.find((p) => p.id === room.youId)?.ack === 10);
    assert.equal(stateB.players.find((p) => p.id === room.youId)!.z, me.z);

    // Alte Eingaben (seq zu klein) werden ignoriert
    a.send({ t: 'input', seq: 5, fwd: 1, right: 0, yaw: 0, sprint: false, atk: false, blk: false, dir: 0 });
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
    await a.waitFor('state', (m) => m.match?.ph === 'fight', 6000);

    // 200 Sprint-Eingaben auf einmal (= 6,7 Sekunden Bewegung in wenigen Millisekunden)
    for (let seq = 1; seq <= 200; seq++) {
      a.send({ t: 'input', seq, fwd: 1, right: 0, yaw: 0, sprint: true, atk: false, blk: false, dir: 0 });
    }
    const state = await a.waitFor('state', (m) => m.players.find((p) => p.id === room.youId)?.ack === 200);
    const me = state.players.find((p) => p.id === room.youId)!;
    const walked = 6 - me.z;
    // Der Server nimmt nur wenige der neuesten Eingaben (Puffer) und macht pro Tick genau einen Schritt.
    assert.ok(walked < 8 * (4.2 / 30) + 0.01, `zu weit gelaufen: ${walked} m`);
    assert.ok(walked > 0, 'ein Teil der Eingaben muss zaehlen');
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

test('Training: Raum mit Trainingspuppe startet sofort und liefert Kampf-Zustand', async () => {
  await withServer(async (game) => {
    const a = await connect(game);
    a.send({ t: 'create', name: 'Solo', practice: true });
    const room = await a.waitFor('room');
    assert.equal(room.practice, true);
    assert.equal(room.phase, 'arena');
    assert.equal(room.players.length, 2);
    assert.equal(room.players.filter((p) => p.bot).length, 1);

    const state = await a.waitFor('state', (m) => m.match?.ph === 'countdown');
    assert.equal(state.players.length, 2);
    const me = state.players.find((p) => p.id === room.youId)!;
    const puppet = state.players.find((p) => p.id !== room.youId)!;
    assert.equal(typeof me.hp, 'number', 'eigene Lebenspunkte werden mitgeschickt');
    assert.equal(puppet.hp, undefined, 'die des Gegners nicht (kein Balken, kein Schummeln)');
    assert.equal(state.match!.rw, 2);

    // Ein Trainingsraum kann nicht per Link betreten werden
    const b = await connect(game);
    b.send({ t: 'join', code: room.code, name: 'Fremder' });
    assert.match((await b.waitFor('error')).message, /gibt es nicht/);
    a.close();
    b.close();
  });
});

test('Countdown laeuft ab und der Kampf beginnt', async () => {
  await withServer(async (game) => {
    const a = await connect(game);
    a.send({ t: 'create', name: 'Solo', practice: true });
    await a.waitFor('room');
    const fight = await a.waitFor('state', (m) => m.match?.ph === 'fight', 6000);
    assert.equal(fight.match!.round, 1);
    a.close();
  });
});

test('Revanche: nach dem Kampfende startet der Kampf im Training sofort neu', async () => {
  const { RoomManager } = await import('../src/server/room.js');
  const mgr = new RoomManager();
  const sent: ServerMessage[] = [];
  const ws = { readyState: 1, OPEN: 1, send: (d: string) => sent.push(JSON.parse(d) as ServerMessage) } as unknown as import('ws').WebSocket;
  mgr.handle(ws, { t: 'create', name: 'Solo', practice: true });
  // Kampf kuenstlich beenden
  const rooms = (mgr as unknown as { rooms: Map<string, { match: { phase: string; wins: number[]; round: number } }> }).rooms;
  const room = [...rooms.values()][0]!;
  room.match.phase = 'matchEnd';
  room.match.wins = [2, 0];
  room.match.round = 3;
  mgr.handle(ws, { t: 'rematch' });
  assert.equal(room.match.phase, 'countdown');
  assert.deepEqual(room.match.wins, [0, 0]);
  assert.equal(room.match.round, 1);
});

test('Lobby-Einstellung: nur der Ersteller stellt die Rundenzahl ein', async () => {
  await withServer(async (game) => {
    const a = await connect(game);
    const b = await connect(game);
    a.send({ t: 'create', name: 'A' });
    const room = await a.waitFor('room');
    assert.equal(room.settings.rounds, 3);
    b.send({ t: 'join', code: room.code, name: 'B' });
    await b.waitFor('room');

    b.send({ t: 'settings', rounds: 5 }); // Gast darf nicht
    a.send({ t: 'settings', rounds: 5 });
    const upd = await a.waitFor('room', (m) => m.settings.rounds === 5);
    assert.equal(upd.settings.rounds, 5);
    const updB = await b.waitFor('room', (m) => m.settings.rounds === 5);
    assert.equal(updB.settings.rounds, 5);

    a.send({ t: 'settings', rounds: 99 }); // ungueltig -> Standard 3
    const back = await a.waitFor('room', (m) => m.settings.rounds === 3 && m.players.length === 2 && m !== upd);
    assert.equal(back.settings.rounds, 3);

    a.send({ t: 'settings', rounds: 1 });
    await a.waitFor('room', (m) => m.settings.rounds === 1);
    a.send({ t: 'start' });
    const st = await a.waitFor('state');
    assert.equal(st.match!.rw, 1, 'Best of 1 = ein Sieg reicht');
    a.close();
    b.close();
  });
});

test('Im Countdown bleiben beide Figuren stehen', async () => {
  await withServer(async (game) => {
    const a = await connect(game);
    a.send({ t: 'create', name: 'Solo', practice: true });
    const room = await a.waitFor('room');
    await a.waitFor('state', (m) => m.match?.ph === 'countdown');
    for (let seq = 1; seq <= 12; seq++) {
      a.send({ t: 'input', seq, fwd: 1, right: 0, yaw: 0, sprint: false, atk: false, blk: false, dir: 0 });
      await new Promise((r) => setTimeout(r, 34));
    }
    const st = await a.waitFor('state', (m) => m.match?.ph === 'countdown' && (m.players.find((p) => p.id === room.youId)?.ack ?? 0) >= 10);
    const me = st.players.find((p) => p.id === room.youId)!;
    assert.equal(me.z, 6, 'Startplatz unveraendert');
    a.close();
  });
});

test('Ersteller bleibt Ersteller, wenn er mit seinem Schluessel neu beitritt', async () => {
  await withServer(async (game) => {
    const a = await connect(game);
    const b = await connect(game);
    a.send({ t: 'create', name: 'Ersteller' });
    const room = await a.waitFor('room');
    assert.ok(room.hostKey, 'der Ersteller bekommt einen Schluessel');
    b.send({ t: 'join', code: room.code, name: 'Gast' });
    const bRoom = await b.waitFor('room');
    assert.equal(bRoom.hostKey, undefined, 'der Gast bekommt keinen');

    // Ersteller verlaesst (z. B. Seite neu geladen): Gast wird Ersteller
    a.close();
    const promoted = await b.waitFor('room', (m) => m.players.length === 1 && m.hostId === m.youId);
    assert.ok(promoted.hostKey, 'der neue Ersteller bekommt einen Schluessel');

    // Ersteller kommt mit seinem alten Schluessel zurueck und ist wieder Ersteller
    const a2 = await connect(game);
    a2.send({ t: 'join', code: room.code, name: 'Ersteller', key: room.hostKey });
    const back = await a2.waitFor('room');
    assert.equal(back.hostId, back.youId);
    const bAfter = await b.waitFor('room', (m) => m.players.length === 2 && m.hostId !== m.youId);
    assert.notEqual(bAfter.hostId, bAfter.youId);

    // Falscher Schluessel hilft nicht
    const c = await connect(game);
    c.send({ t: 'join', code: room.code, name: 'Fremder', key: 'falsch' });
    assert.match((await c.waitFor('error')).message, /voll/);
    a2.close();
    b.close();
    c.close();
  });
});
