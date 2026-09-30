import test from 'node:test';
import assert from 'node:assert/strict';
import { newSimState, stepPlayer, type MoveInput } from '../src/shared/sim.js';
import { Act, WEAPONS, ARMORS, ZONE_DAMAGE, Zone, counterDir, HP_MAX, LAST_CHANCE, REVIVE_HP } from '../src/shared/weapons.js';
import { windupNeed, weaponOf } from '../src/shared/combat.js';
import { newStats, resolveStrikes, zoneFor, type Fighter } from '../src/server/resolve.js';
import { Match } from '../src/server/match.js';
import { BotBrain } from '../src/server/bot.js';
import type { NetEvent } from '../src/shared/protocol.js';

const W = WEAPONS[0]!;
const ARMOR = ARMORS[0]!;

function duel(dist = 1.6) {
  // A steht bei z=0 und blickt nach -z; B steht davor und blickt zurueck
  const a: Fighter = { id: 'A', sim: newSimState(0, 0, 0) };
  const b: Fighter = { id: 'B', sim: newSimState(0, -dist, Math.PI) };
  const stats: [ReturnType<typeof newStats>, ReturnType<typeof newStats>] = [newStats(), newStats()];
  const events: NetEvent[] = [];
  let winner = -1;
  const inp = (f: Fighter, o: Partial<MoveInput> = {}): MoveInput => ({
    fwd: 0,
    right: 0,
    yaw: f === a ? 0 : Math.PI,
    sprint: false,
    atk: false,
    blk: false,
    dir: 0,
    ...o,
  });
  const step = (ia: Partial<MoveInput> = {}, ib: Partial<MoveInput> = {}) => {
    stepPlayer(a.sim, inp(a, ia), b.sim, true);
    stepPlayer(b.sim, inp(b, ib), a.sim, true);
    const w = resolveStrikes([a, b], stats, events);
    if (w >= 0) winner = w;
  };
  const steps = (n: number, ia: Partial<MoveInput> = {}, ib: Partial<MoveInput> = {}) => {
    for (let i = 0; i < n; i++) step(ia, ib);
  };
  return { a, b, stats, events, step, steps, get winner() { return winner; } };
}

/** A schlaegt in Richtung dir, B macht `bInput` pro Tick (Funktion t -> Eingabe). */
function attack(d: ReturnType<typeof duel>, dir: number, bInput: (t: number) => Partial<MoveInput> = () => ({})): number {
  let t = 0;
  d.step({ atk: true, dir }, bInput(t++)); // Taste druecken
  const need = windupNeed(d.a.sim, W);
  while (d.a.sim.act === Act.WINDUP && t < 200) {
    d.step({ atk: d.a.sim.actT < need, dir }, bInput(t++));
  }
  // Schlag- und Erholungsphase bis zum Ende
  while (d.a.sim.act !== Act.IDLE && t < 400) d.step({ dir }, bInput(t++));
  return t;
}

test('Angriff: Ausholen -> Schlag -> Erholung dauert etwa eine Sekunde (mittleres Tempo)', () => {
  const d = duel(5); // weit weg: nur der Ablauf zaehlt
  const acts: number[] = [];
  d.step({ atk: true, dir: 0 });
  acts.push(d.a.sim.act);
  let ticks = 1;
  const need = windupNeed(d.a.sim, W);
  while (d.a.sim.act !== Act.IDLE && ticks < 200) {
    d.step({ atk: d.a.sim.actT < need, dir: 0 });
    if (acts[acts.length - 1] !== d.a.sim.act) acts.push(d.a.sim.act);
    ticks++;
  }
  assert.deepEqual(acts, [Act.WINDUP, Act.STRIKE, Act.RECOVERY, Act.IDLE]);
  const seconds = ticks / 30;
  assert.ok(seconds > 0.85 && seconds < 1.25, `Dauer ${seconds.toFixed(2)} s`);
});

test('Ausholen kostet Ausdauer', () => {
  const d = duel(5);
  d.step({ atk: true });
  assert.ok(d.a.sim.stamina <= 100 - W.staminaAttack + 1e-9);
});

test('ein Angriff von oben trifft den Kopf und richtet den erwarteten Schaden an', () => {
  const d = duel(1.6);
  attack(d, 0);
  const expected = W.damage * ZONE_DAMAGE[Zone.HEAD] * ARMOR.damageFactor;
  assert.ok(Math.abs(HP_MAX - d.b.sim.hp - expected) < 1e-6, `Schaden ${HP_MAX - d.b.sim.hp}`);
  const hit = d.events.find((e) => e.k === 'hit');
  assert.ok(hit && hit.k === 'hit' && hit.z === Zone.HEAD);
  assert.ok(d.b.sim.dazeT > 0, 'Kopftreffer macht benommen');
  assert.equal(d.stats[0].hits, 1);
});

test('seitlicher Angriff trifft den Torso', () => {
  const d = duel();
  attack(d, 1);
  const hit = d.events.find((e) => e.k === 'hit');
  assert.ok(hit && hit.k === 'hit' && hit.z === Zone.TORSO);
});

test('zu weit weg oder falsche Blickrichtung: daneben', () => {
  const far = duel(4);
  attack(far, 0);
  assert.equal(far.b.sim.hp, HP_MAX);

  const behind = duel(1.6);
  behind.b.sim.z = 1.6; // steht hinter A
  attack(behind, 0);
  assert.equal(behind.b.sim.hp, HP_MAX);
});

test('Zonen: Arm beim Ausholen, Bein in der Erholung', () => {
  const s = newSimState(0, 0, 0);
  s.act = Act.WINDUP;
  assert.equal(zoneFor(1, s), Zone.ARM);
  s.act = Act.RECOVERY;
  assert.equal(zoneFor(2, s), Zone.LEG);
  s.act = Act.IDLE;
  assert.equal(zoneFor(2, s), Zone.TORSO);
  assert.equal(zoneFor(0, s), Zone.HEAD);
});

test('Block in der gespiegelten Richtung stoppt den Angriff und kostet Ausdauer', () => {
  const d = duel();
  // A schlaegt "links" -> B muss "rechts" decken. B blockt frueh (normaler Block, kein Perfect).
  attack(d, 1, () => ({ blk: true, dir: counterDir(1) }));
  assert.equal(d.b.sim.hp, HP_MAX, 'kein Schaden');
  assert.ok(d.events.some((e) => e.k === 'block'));
  assert.ok(d.b.sim.stamina < 100, 'Block kostet Ausdauer');
  assert.equal(d.stats[1].blocks, 1);
});

test('Block in der falschen Richtung hilft nicht', () => {
  const d = duel();
  attack(d, 1, () => ({ blk: true, dir: 1 })); // gleiche Bezeichnung waere falsch (gespiegelt!)
  assert.ok(d.b.sim.hp < HP_MAX);
});

test('Perfect Block: spaet aufgebaut, Angreifer taumelt', () => {
  const d = duel();
  const need = windupNeed(d.a.sim, W);
  // B baut den Block erst kurz vor dem Schlag auf
  attack(d, 2, (t) => (t >= need - 2 ? { blk: true, dir: counterDir(2) } : {}));
  const parried = d.events.some((e) => e.k === 'parry');
  const blocked = d.events.some((e) => e.k === 'block');
  assert.ok(parried || blocked, 'irgendein Block muss zaehlen');
  assert.ok(parried, 'spaeter Block = Perfect Block');
  assert.equal(d.b.sim.hp, HP_MAX);
  assert.ok(d.b.sim.stamina > 100 - 16, 'Perfect Block kostet nur Aufbau und Halten, nichts fuer den Treffer');
});

test('Block ohne Ausdauer wird durchbrochen', () => {
  const d = duel();
  d.b.sim.stamina = 16; // reicht fuer Aufbau und Halten, aber nicht mehr fuer den Treffer
  attack(d, 0, () => ({ blk: true, dir: 0 }));
  assert.ok(d.events.some((e) => e.k === 'break'));
  assert.equal(d.b.sim.exhausted, true);
});

test('Finte: Block-Taste waehrend des Ausholens bricht den Angriff ab', () => {
  const d = duel();
  d.step({ atk: true, dir: 0 });
  d.steps(5, { atk: true, dir: 0 });
  assert.equal(d.a.sim.act, Act.WINDUP);
  const before = d.a.sim.stamina;
  d.step({ atk: true, blk: true, dir: 0 });
  assert.equal(d.a.sim.act, Act.RECOVERY);
  assert.ok(d.a.sim.stamina < before, 'Finte kostet Ausdauer');
  d.steps(60, {});
  assert.equal(d.b.sim.hp, HP_MAX, 'kein Treffer durch eine Finte');
});

test('Richtung waehrend des Ausholens wechseln kostet Zeit und Ausdauer', () => {
  const d = duel(5);
  d.step({ atk: true, dir: 0 });
  d.steps(8, { atk: true, dir: 0 });
  const t0 = d.a.sim.actT;
  const st0 = d.a.sim.stamina;
  d.step({ atk: true, dir: 1 });
  assert.equal(d.a.sim.dir, 1);
  assert.ok(d.a.sim.actT < t0, 'Ausholen wurde zurueckgeworfen');
  assert.ok(d.a.sim.stamina < st0);
});

test('Erschoepfung macht das Ausholen langsamer', () => {
  const s = newSimState(0, 0, 0);
  const normal = windupNeed(s, weaponOf(s));
  s.exhausted = true;
  assert.ok(windupNeed(s, weaponOf(s)) > normal);
});

test('Treffer unterbricht das Ausholen des Gegners', () => {
  const d = duel();
  // B holt aus, A trifft zuerst
  let bStarted = false;
  attack(d, 0, (t) => {
    if (t === 3) bStarted = true;
    return bStarted && t < 30 ? { atk: true, dir: 0 } : {};
  });
  assert.ok(d.b.sim.hp < HP_MAX);
});

test('Letzte Chance: bei 0 Leben am Boden, Todesstoss beendet die Runde', () => {
  const d = duel();
  d.b.sim.hp = 10;
  attack(d, 0);
  assert.equal(d.b.sim.down, true);
  assert.equal(d.b.sim.hp, 0);
  assert.equal(d.b.sim.downT, LAST_CHANCE);
  assert.ok(d.events.some((e) => e.k === 'down'));
  assert.equal(d.winner, -1, 'noch nicht vorbei');
  // zweiter Treffer auf den Liegenden = Todesstoss
  d.steps(40, {});
  attack(d, 0);
  assert.equal(d.winner, 0);
  assert.ok(d.events.some((e) => e.k === 'hit' && e.fin === true));
});

test('Letzte Chance: wer am Boden trifft, steht mit wenig Leben wieder auf', () => {
  const d = duel();
  d.b.sim.hp = 0;
  d.b.sim.down = true;
  d.b.sim.downT = LAST_CHANCE;
  // B (am Boden) schlaegt A
  let t = 0;
  const need = windupNeed(d.b.sim, W);
  d.step({}, { atk: true, dir: 0 });
  while (d.b.sim.act === Act.WINDUP && t++ < 100) d.step({}, { atk: d.b.sim.actT < need, dir: 0 });
  d.steps(10, {}, {});
  assert.equal(d.b.sim.down, false);
  assert.equal(d.b.sim.hp, REVIVE_HP);
  assert.equal(d.b.sim.revived, true);
  assert.ok(d.events.some((e) => e.k === 'revive'));
});

test('Match: Runden zaehlen, Gewinn nach zwei Runden, Statistik am Ende', () => {
  const a: Fighter = { id: 'A', sim: newSimState(0, 6, 0) };
  const b: Fighter = { id: 'B', sim: newSimState(0, -6, Math.PI) };
  const fs: [Fighter, Fighter] = [a, b];
  const m = new Match(2);
  const ev: NetEvent[] = [];
  assert.equal(m.phase, 'countdown');
  for (let i = 0; i < 100 && m.phase === 'countdown'; i++) m.advance(fs);
  assert.equal(m.phase, 'fight');
  m.endRound(0, fs, ev);
  assert.equal(m.phase, 'roundEnd');
  assert.deepEqual(m.wins, [1, 0]);
  for (let i = 0; i < 200 && m.phase === 'roundEnd'; i++) m.advance(fs);
  assert.equal(m.phase, 'countdown');
  assert.equal(m.round, 2);
  for (let i = 0; i < 100 && m.phase === 'countdown'; i++) m.advance(fs);
  m.endRound(0, fs, ev);
  assert.equal(m.phase, 'matchEnd');
  assert.ok(ev.some((e) => e.k === 'match' && e.w === 'A'));
  const net = m.toNet(fs);
  assert.equal(net.stats?.length, 2);
  m.restart(fs);
  assert.equal(m.phase, 'countdown');
  assert.deepEqual(m.wins, [0, 0]);
});

test('Puppe: kaempft gegen sich selbst ohne Fehler und greift an', () => {
  const a: Fighter = { id: 'A', sim: newSimState(0, 6, 0) };
  const b: Fighter = { id: 'B', sim: newSimState(0, -6, Math.PI) };
  const brainA = new BotBrain(1);
  const brainB = new BotBrain(2);
  const stats: [ReturnType<typeof newStats>, ReturnType<typeof newStats>] = [newStats(), newStats()];
  const events: NetEvent[] = [];
  for (let t = 0; t < 30 * 90; t++) {
    const ia = brainA.think(a.sim, b.sim, true);
    const ib = brainB.think(b.sim, a.sim, true);
    stepPlayer(a.sim, ia, b.sim, true);
    stepPlayer(b.sim, ib, a.sim, true);
    resolveStrikes([a, b], stats, events);
    for (const s of [a.sim, b.sim]) {
      assert.ok(Number.isFinite(s.x) && Number.isFinite(s.z) && Number.isFinite(s.stamina) && Number.isFinite(s.hp));
      assert.ok(s.stamina >= 0 && s.stamina <= 100);
    }
  }
  const attacks = events.filter((e) => e.k === 'hit' || e.k === 'block' || e.k === 'parry').length;
  assert.ok(attacks > 0, 'die Puppen sollten sich zumindest getroffen oder geblockt haben');
});

test('Fairness: ein Spieler mit Reaktionszeit 0,45 s blockt die Puppe meistens', () => {
  const a: Fighter = { id: 'P', sim: newSimState(0, 6, 0) }; // menschlicher Spieler
  const b: Fighter = { id: 'B', sim: newSimState(0, -6, Math.PI) }; // Puppe
  const brain = new BotBrain(7);
  const stats: [ReturnType<typeof newStats>, ReturnType<typeof newStats>] = [newStats(), newStats()];
  const events: NetEvent[] = [];
  const REACTION = 14; // Ticks (Wahrnehmung + Netz + Finger)
  let seenAt = -1;
  let dirSeen = 0;
  let attacksSeen = 0;
  for (let t = 0; t < 30 * 240; t++) {
    // Der Spieler naehert sich bis auf Schlagweite und wehrt dann ab
    const dist = Math.hypot(a.sim.x - b.sim.x, a.sim.z - b.sim.z);
    const yaw = Math.atan2(-(b.sim.x - a.sim.x), -(b.sim.z - a.sim.z));
    const ia: MoveInput = { fwd: dist > 2.2 ? 1 : 0, right: 0, yaw, sprint: false, atk: false, blk: false, dir: 0 };
    if (b.sim.act === Act.WINDUP) {
      if (seenAt < 0) {
        seenAt = t;
        attacksSeen++;
      }
      dirSeen = b.sim.dir;
    } else if (b.sim.act !== Act.STRIKE) {
      seenAt = -1;
    }
    if (seenAt >= 0 && t - seenAt >= REACTION) {
      ia.blk = true;
      ia.dir = counterDir(dirSeen); // mit Block-Hilfe
    }
    const ib = brain.think(b.sim, a.sim, true);
    stepPlayer(a.sim, ia, b.sim, true);
    stepPlayer(b.sim, ib, a.sim, true);
    resolveStrikes([a, b], stats, events);
  }
  const blocked = events.filter((e) => (e.k === 'block' || e.k === 'parry') && e.d === 'P').length;
  const hits = events.filter((e) => e.k === 'hit' && e.d === 'P').length;
  assert.ok(attacksSeen >= 8, `genug Angriffe zum Auswerten (${attacksSeen})`);
  assert.ok(blocked / (blocked + hits) >= 0.7, `geblockt ${blocked}, getroffen ${hits}`);
});

test('Block halten kostet dauernd Ausdauer, irgendwann faellt der Block', () => {
  const d = duel(5);
  const start = d.b.sim.stamina;
  d.steps(60, {}, { blk: true, dir: 0 });
  assert.ok(d.b.sim.stamina < start - 12, 'Dauerblocken kostet spuerbar');
  d.steps(600, {}, { blk: true, dir: 0 });
  assert.notEqual(d.b.sim.act, Act.BLOCK, 'mit leerer Ausdauer haelt der Block nicht');
});

test('Richtung beim Blocken wechseln dauert deutlich laenger und kostet Ausdauer', () => {
  const d = duel(5);
  d.steps(20, {}, { blk: true, dir: 0 });
  assert.ok(d.b.sim.actT >= W.blockRaise, 'Block steht');
  const st = d.b.sim.stamina;
  d.step({}, { blk: true, dir: 1 });
  assert.equal(d.b.sim.dir, 1);
  assert.ok(d.b.sim.actT < W.blockRaise, 'Block muss neu aufgebaut werden');
  assert.ok(d.b.sim.stamina < st - 5, 'Wechsel kostet Ausdauer');
  // erst nach der langen Wartezeit wirkt er wieder
  let ticks = 0;
  while (d.b.sim.actT < W.blockRaise && ticks < 60) {
    d.step({}, { blk: true, dir: 1 });
    ticks++;
  }
  assert.ok(ticks >= W.blockRedirectRaise - 2, `Wiederaufbau nach ${ticks} Ticks`);
});

test('Ausfallschritt und Rueckstoss bewegen die Figuren', () => {
  const d = duel(1.7);
  const z0 = d.a.sim.z;
  attack(d, 0);
  assert.ok(d.a.sim.z < z0 - 0.15 || d.b.sim.hp < HP_MAX, 'Angreifer springt nach vorn');
  // B wurde getroffen und ein Stueck weggestossen
  assert.ok(d.b.sim.z < -1.7 - 0.2, `Rueckstoss: B steht bei z=${d.b.sim.z.toFixed(2)}`);
  d.steps(30, {}, {});
  assert.ok(d.b.sim.kx === 0 && d.b.sim.kz === 0, 'Rueckstoss ist abgeklungen');
});
