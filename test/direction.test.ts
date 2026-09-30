import test from 'node:test';
import assert from 'node:assert/strict';
import { DirectionPicker, DIR_LEFT, DIR_RIGHT, DIR_UP } from '../src/client/direction.js';

test('deutliches Wischen waehlt die Richtung', () => {
  const p = new DirectionPicker();
  p.feed(-60, 0, 0);
  assert.equal(p.pick(0, DIR_UP), DIR_LEFT);
  const q = new DirectionPicker();
  q.feed(70, 5, 0);
  assert.equal(q.pick(0, DIR_UP), DIR_RIGHT);
  const r = new DirectionPicker();
  r.feed(5, -70, 0);
  assert.equal(r.pick(0, DIR_LEFT), DIR_UP);
});

test('Wischen nach unten und kleine Zuckungen aendern nichts', () => {
  const p = new DirectionPicker();
  p.feed(0, 80, 0);
  assert.equal(p.pick(0, DIR_LEFT), DIR_LEFT);
  const q = new DirectionPicker();
  for (let i = 0; i < 20; i++) q.feed(i % 2 ? 4 : -4, i % 2 ? -3 : 3, i * 8);
  assert.equal(q.pick(160, DIR_RIGHT), DIR_RIGHT);
});

test('nach einem Wechsel gibt es eine kurze Sperre gegen Hin-und-her-Springen', () => {
  const p = new DirectionPicker();
  p.feed(-80, 0, 0);
  assert.equal(p.pick(0, DIR_UP), DIR_LEFT);
  p.feed(160, 0, 20); // sofort kraeftig zurueck nach rechts
  assert.equal(p.pick(20, DIR_LEFT), DIR_LEFT, 'noch gesperrt');
  p.feed(90, 0, 400); // nach der Sperre wirkt eine neue deutliche Bewegung wieder
  assert.equal(p.pick(400, DIR_LEFT), DIR_RIGHT);
});

test('alte Bewegungen klingen ab', () => {
  const p = new DirectionPicker();
  p.feed(-80, 0, 0);
  assert.equal(p.pick(2000, DIR_UP), DIR_UP);
});
