// Gemeinsame Simulation (Bewegung + Kampf-Automat). Wird vom Server (verbindlich) und vom
// Client (Vorhersage, damit sich die eigene Figur sofort anfuehlt) benutzt.
// WICHTIG: Beide muessen exakt dasselbe rechnen, sonst "ruckelt" die Figur.

import { stepCombat, weaponOf } from './combat.js';
import { Act, HP_MAX } from './weapons.js';

export const TICK_RATE = 30;
export const TICK = 1 / TICK_RATE;

export const ARENA_RADIUS = 12;
export const PLAYER_RADIUS = 0.45;

export const WALK_SPEED = 2.4; // Meter pro Sekunde, bewusst langsam (= Tempo fuer schwere Ruestung)
export const SPRINT_SPEED = 4.2;
export const BACKWARD_FACTOR = 0.6;
export const STRAFE_FACTOR = 0.8;

export const STAMINA_MAX = 100;
export const SPRINT_DRAIN = 14; // pro Sekunde
export const STAMINA_REGEN = 18; // pro Sekunde
export const STAMINA_REGEN_MOVING_FACTOR = 0.6;
export const REGEN_DELAY = 0.9; // Pause nach dem Rennen, bevor Ausdauer zurueckkommt
export const EXHAUST_RECOVER = 30; // ab hier darf man nach Erschoepfung wieder rennen
export const KNOCKBACK_DECAY = 0.8; // pro Tick

// Startplaetze der beiden Spieler (einander zugewandt)
export const SPAWNS = [
  { x: 0, z: 6, yaw: 0 },
  { x: 0, z: -6, yaw: Math.PI },
];

export interface SimState {
  x: number;
  z: number;
  yaw: number; // Blickrichtung. Vorwaerts = (-sin(yaw), -cos(yaw))
  stamina: number;
  exhausted: boolean;
  regenDelay: number;

  // ---- Kampf ----
  act: number; // Act.*
  dir: number; // Richtung des Angriffs/Blocks (0 oben, 1 links, 2 rechts)
  actT: number; // Ticks in der aktuellen Aktion
  hp: number; // nur der Server kennt den echten Wert; der Client bekommt nur den eigenen
  staggerT: number;
  dazeT: number; // Benommenheit (Kopftreffer)
  armT: number; // Armtreffer: langsameres Ausholen
  legT: number; // Beintreffer: langsamer laufen
  down: boolean; // "Letzte Chance": am Boden
  downT: number;
  revived: boolean; // Letzte Chance schon genutzt
  hitDone: boolean; // aktueller Schlag hat schon getroffen oder wurde geblockt
  prevAtk: boolean; // Tasten-Zustand des letzten Ticks (fuer Flanken)
  prevBlk: boolean;
  weapon: number;
  armor: number;
  kx: number; // Rueckstoss-Geschwindigkeit (klingt ab)
  kz: number;

  // Nur fuer Animation, nicht verbindlich:
  vx: number;
  vz: number;
  sprinting: boolean;
}

export interface MoveInput {
  fwd: number; // -1 (rueckwaerts) .. 1 (vorwaerts), relativ zur Blickrichtung
  right: number; // -1 (links) .. 1 (rechts)
  yaw: number;
  sprint: boolean;
  atk?: boolean; // linke Maustaste gehalten
  blk?: boolean; // rechte Maustaste gehalten
  dir?: number; // gewaehlte Richtung 0 oben / 1 links / 2 rechts
}

export function newSimState(x: number, z: number, yaw: number): SimState {
  return {
    x,
    z,
    yaw,
    stamina: STAMINA_MAX,
    exhausted: false,
    regenDelay: 0,
    act: Act.IDLE,
    dir: 0,
    actT: 0,
    hp: HP_MAX,
    staggerT: 0,
    dazeT: 0,
    armT: 0,
    legT: 0,
    down: false,
    downT: 0,
    revived: false,
    hitDone: true,
    prevAtk: false,
    prevBlk: false,
    weapon: 0,
    armor: 0,
    kx: 0,
    kz: 0,
    vx: 0,
    vz: 0,
    sprinting: false,
  };
}

export function cloneSim(s: SimState): SimState {
  return { ...s };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function num(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** Macht aus beliebigen (evtl. manipulierten) Eingaben eine gueltige Eingabe. */
export function sanitizeInput(raw: Partial<MoveInput> | null | undefined): MoveInput {
  const r = raw ?? {};
  const dir = r.dir === 1 || r.dir === 2 ? r.dir : 0;
  return {
    fwd: clamp(num(r.fwd), -1, 1),
    right: clamp(num(r.right), -1, 1),
    yaw: num(r.yaw),
    sprint: r.sprint === true,
    atk: r.atk === true,
    blk: r.blk === true,
    dir,
  };
}

/**
 * Ein Simulationsschritt (1/30 Sekunde). `other` ist die Position des Gegners.
 * `canAct`: false = Kaempfen gerade nicht erlaubt (Countdown, Rundenende).
 */
export function stepPlayer(
  p: SimState,
  input: MoveInput,
  other?: { x: number; z: number },
  canAct = true,
): void {
  const fx = stepCombat(p, input, canAct);

  let fwd = input.fwd;
  let right = input.right;
  const len = Math.hypot(fwd, right);
  if (len > 1) {
    fwd /= len;
    right /= len;
  }
  const moving = len > 0.01 && fx.moveMult > 0;

  const sprinting = input.sprint && fwd > 0.3 && !p.exhausted && p.stamina > 0 && fx.canSprint;
  const speed = sprinting ? SPRINT_SPEED : WALK_SPEED;

  let factor = 1;
  if (fwd < -0.1) factor = BACKWARD_FACTOR;
  else if (fwd < 0.1 && Math.abs(right) > 0.1) factor = STRAFE_FACTOR;
  factor *= fx.moveMult;

  const sin = Math.sin(input.yaw);
  const cos = Math.cos(input.yaw);
  const fx_ = -sin;
  const fz = -cos;
  const rx = cos;
  const rz = -sin;

  p.vx = (fx_ * fwd + rx * right) * speed * factor;
  p.vz = (fz * fwd + rz * right) * speed * factor;
  p.x += p.vx * TICK;
  p.z += p.vz * TICK;

  // Ausfallschritt: Beim Schlag springt die Figur ein Stueck nach vorn
  if (p.act === Act.STRIKE && !p.down) {
    const lunge = weaponOf(p).lungeSpeed;
    p.x += fx_ * lunge * TICK;
    p.z += fz * lunge * TICK;
  }
  // Rueckstoss (nach Treffer, Block oder Parade), klingt schnell ab
  if (p.kx !== 0 || p.kz !== 0) {
    p.x += p.kx * TICK;
    p.z += p.kz * TICK;
    p.kx *= KNOCKBACK_DECAY;
    p.kz *= KNOCKBACK_DECAY;
    if (Math.abs(p.kx) < 0.05 && Math.abs(p.kz) < 0.05) {
      p.kx = 0;
      p.kz = 0;
    }
  }
  p.yaw = input.yaw;
  p.sprinting = sprinting;

  // Nicht aus der Arena laufen
  const maxR = ARENA_RADIUS - PLAYER_RADIUS;
  const r = Math.hypot(p.x, p.z);
  if (r > maxR) {
    p.x = (p.x / r) * maxR;
    p.z = (p.z / r) * maxR;
  }

  // Nicht in den Gegner hineinlaufen
  if (other) {
    const dx = p.x - other.x;
    const dz = p.z - other.z;
    const d = Math.hypot(dx, dz);
    const minD = PLAYER_RADIUS * 2;
    if (d < minD) {
      if (d > 1e-4) {
        p.x = other.x + (dx / d) * minD;
        p.z = other.z + (dz / d) * minD;
      } else {
        p.x = other.x + minD;
      }
      // Falls der Schubs uns aus der Arena drueckt, wieder zurueck
      const r2 = Math.hypot(p.x, p.z);
      if (r2 > maxR) {
        p.x = (p.x / r2) * maxR;
        p.z = (p.z / r2) * maxR;
      }
    }
  }

  // Ausdauer
  if (sprinting) {
    p.stamina -= SPRINT_DRAIN * TICK;
    p.regenDelay = REGEN_DELAY;
    if (p.stamina <= 0) {
      p.stamina = 0;
      p.exhausted = true;
    }
  } else if (p.regenDelay > 0) {
    p.regenDelay = Math.max(0, p.regenDelay - TICK);
  } else if (fx.regenScale > 0) {
    const regen = STAMINA_REGEN * (moving ? STAMINA_REGEN_MOVING_FACTOR : 1) * fx.regenScale;
    p.stamina = Math.min(STAMINA_MAX, p.stamina + regen * TICK);
    if (p.exhausted && p.stamina >= EXHAUST_RECOVER) p.exhausted = false;
  }
}
