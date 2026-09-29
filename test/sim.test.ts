import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ARENA_RADIUS,
  PLAYER_RADIUS,
  SPRINT_SPEED,
  STAMINA_MAX,
  TICK,
  WALK_SPEED,
  newSimState,
  sanitizeInput,
  stepPlayer,
} from '../src/shared/sim.js';

test('vorwaerts laufen bewegt in Blickrichtung (yaw 0 = -z)', () => {
  const p = newSimState(0, 0, 0);
  stepPlayer(p, { fwd: 1, right: 0, yaw: 0, sprint: false });
  assert.ok(Math.abs(p.x) < 1e-9);
  assert.ok(Math.abs(p.z + WALK_SPEED * TICK) < 1e-9);
});

test('rechts laufen bewegt nach +x bei yaw 0', () => {
  const p = newSimState(0, 0, 0);
  stepPlayer(p, { fwd: 0, right: 1, yaw: 0, sprint: false });
  assert.ok(p.x > 0);
});

test('diagonal ist nicht schneller als geradeaus', () => {
  const a = newSimState(0, 0, 0);
  const b = newSimState(0, 0, 0);
  stepPlayer(a, { fwd: 1, right: 0, yaw: 0, sprint: false });
  stepPlayer(b, { fwd: 1, right: 1, yaw: 0, sprint: false });
  assert.ok(Math.hypot(b.x, b.z) <= Math.hypot(a.x, a.z) + 1e-9);
});

test('rueckwaerts ist langsamer als vorwaerts', () => {
  const a = newSimState(0, 0, 0);
  const b = newSimState(0, 0, 0);
  stepPlayer(a, { fwd: 1, right: 0, yaw: 0, sprint: false });
  stepPlayer(b, { fwd: -1, right: 0, yaw: 0, sprint: false });
  assert.ok(Math.hypot(b.x, b.z) < Math.hypot(a.x, a.z));
});

test('rennen ist schneller und kostet Ausdauer', () => {
  const p = newSimState(0, 0, 0);
  stepPlayer(p, { fwd: 1, right: 0, yaw: 0, sprint: true });
  assert.ok(Math.abs(p.z + SPRINT_SPEED * TICK) < 1e-9);
  assert.ok(p.stamina < STAMINA_MAX);
  assert.equal(p.sprinting, true);
});

test('rueckwaerts rennen geht nicht', () => {
  const p = newSimState(0, 0, 0);
  stepPlayer(p, { fwd: -1, right: 0, yaw: 0, sprint: true });
  assert.equal(p.sprinting, false);
  assert.equal(p.stamina, STAMINA_MAX);
});

test('leere Ausdauer erschoepft, bis sie sich erholt hat', () => {
  const p = newSimState(0, 0, 0);
  // Weit genug weg von der Wand rennen: im Kreis laufen
  let yaw = 0;
  let guard = 0;
  while (!p.exhausted && guard++ < 2000) {
    yaw += 0.1;
    stepPlayer(p, { fwd: 1, right: 0, yaw, sprint: true });
  }
  assert.equal(p.exhausted, true);
  assert.equal(p.stamina, 0);
  stepPlayer(p, { fwd: 1, right: 0, yaw, sprint: true });
  assert.equal(p.sprinting, false, 'erschoepft: kein Rennen mehr');

  // Stehen bleiben -> Ausdauer kommt zurueck, irgendwann darf man wieder rennen
  guard = 0;
  while (p.exhausted && guard++ < 5000) stepPlayer(p, { fwd: 0, right: 0, yaw, sprint: false });
  assert.equal(p.exhausted, false);
  stepPlayer(p, { fwd: 1, right: 0, yaw, sprint: true });
  assert.equal(p.sprinting, true);
});

test('Ausdauer erholt sich erst nach der Pause', () => {
  const p = newSimState(0, 0, 0);
  stepPlayer(p, { fwd: 1, right: 0, yaw: 0, sprint: true });
  const afterSprint = p.stamina;
  stepPlayer(p, { fwd: 0, right: 0, yaw: 0, sprint: false });
  assert.equal(p.stamina, afterSprint, 'direkt nach dem Rennen noch keine Erholung');
});

test('man kann die Arena nicht verlassen', () => {
  const p = newSimState(0, 0, Math.PI / 2);
  for (let i = 0; i < 1000; i++) stepPlayer(p, { fwd: 1, right: 0, yaw: Math.PI / 2, sprint: true });
  assert.ok(Math.hypot(p.x, p.z) <= ARENA_RADIUS - PLAYER_RADIUS + 1e-9);
});

test('Spieler laufen nicht ineinander', () => {
  const other = { x: 0, z: -2 };
  const p = newSimState(0, 0, 0);
  for (let i = 0; i < 200; i++) stepPlayer(p, { fwd: 1, right: 0, yaw: 0, sprint: false }, other);
  assert.ok(Math.hypot(p.x - other.x, p.z - other.z) >= PLAYER_RADIUS * 2 - 1e-9);
});

test('manipulierte Eingaben werden bereinigt', () => {
  const s = sanitizeInput({ fwd: 999, right: -999, yaw: NaN, sprint: 'ja' as unknown as boolean });
  assert.equal(s.fwd, 1);
  assert.equal(s.right, -1);
  assert.equal(s.yaw, 0);
  assert.equal(s.sprint, false);
});

test('Simulation ist deterministisch (Client und Server rechnen gleich)', () => {
  const a = newSimState(1, 2, 0.3);
  const b = newSimState(1, 2, 0.3);
  for (let i = 0; i < 300; i++) {
    const input = { fwd: Math.sin(i / 10), right: Math.cos(i / 7), yaw: i / 50, sprint: i % 40 < 20 };
    stepPlayer(a, input, { x: 3, z: 3 });
    stepPlayer(b, input, { x: 3, z: 3 });
  }
  assert.deepEqual(a, b);
});
