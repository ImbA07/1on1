// Gemeinsame Bewegungs-Simulation. Wird vom Server (verbindlich) und vom
// Client (Vorhersage, damit sich die eigene Figur sofort anfuehlt) benutzt.
// WICHTIG: Beide muessen exakt dasselbe rechnen, sonst "ruckelt" die Figur.

export const TICK_RATE = 30;
export const TICK = 1 / TICK_RATE;

export const ARENA_RADIUS = 12;
export const PLAYER_RADIUS = 0.45;

export const WALK_SPEED = 2.4; // Meter pro Sekunde, bewusst langsam
export const SPRINT_SPEED = 4.2;
export const BACKWARD_FACTOR = 0.6;
export const STRAFE_FACTOR = 0.8;

export const STAMINA_MAX = 100;
export const SPRINT_DRAIN = 14; // pro Sekunde
export const STAMINA_REGEN = 18; // pro Sekunde
export const STAMINA_REGEN_MOVING_FACTOR = 0.6;
export const REGEN_DELAY = 0.9; // Pause nach dem Rennen, bevor Ausdauer zurueckkommt
export const EXHAUST_RECOVER = 30; // ab hier darf man nach Erschoepfung wieder rennen

export interface SimState {
  x: number;
  z: number;
  yaw: number; // Blickrichtung. Vorwaerts = (-sin(yaw), -cos(yaw))
  stamina: number;
  exhausted: boolean;
  regenDelay: number;
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
}

export function newSimState(x: number, z: number, yaw: number): SimState {
  return {
    x,
    z,
    yaw,
    stamina: STAMINA_MAX,
    exhausted: false,
    regenDelay: 0,
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
  return {
    fwd: clamp(num(r.fwd), -1, 1),
    right: clamp(num(r.right), -1, 1),
    yaw: num(r.yaw),
    sprint: r.sprint === true,
  };
}

/** Ein Simulationsschritt (1/30 Sekunde). `other` ist die Position des Gegners. */
export function stepPlayer(p: SimState, input: MoveInput, other?: { x: number; z: number }): void {
  let fwd = input.fwd;
  let right = input.right;
  const len = Math.hypot(fwd, right);
  if (len > 1) {
    fwd /= len;
    right /= len;
  }
  const moving = len > 0.01;

  const sprinting = input.sprint && fwd > 0.3 && !p.exhausted && p.stamina > 0;
  const speed = sprinting ? SPRINT_SPEED : WALK_SPEED;

  let factor = 1;
  if (fwd < -0.1) factor = BACKWARD_FACTOR;
  else if (fwd < 0.1 && Math.abs(right) > 0.1) factor = STRAFE_FACTOR;

  const sin = Math.sin(input.yaw);
  const cos = Math.cos(input.yaw);
  const fx = -sin;
  const fz = -cos;
  const rx = cos;
  const rz = -sin;

  p.vx = (fx * fwd + rx * right) * speed * factor;
  p.vz = (fz * fwd + rz * right) * speed * factor;
  p.x += p.vx * TICK;
  p.z += p.vz * TICK;
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
  } else {
    const regen = STAMINA_REGEN * (moving ? STAMINA_REGEN_MOVING_FACTOR : 1);
    p.stamina = Math.min(STAMINA_MAX, p.stamina + regen * TICK);
    if (p.exhausted && p.stamina >= EXHAUST_RECOVER) p.exhausted = false;
  }
}
