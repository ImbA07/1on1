// Trefferauswertung: Der SERVER entscheidet, ob ein Schlag trifft, geblockt wird oder ein
// Perfect Block ist. Reine Funktionen ohne Netzwerk, damit man sie gut testen kann.

import type { NetEvent } from '../shared/protocol.js';
import { spendStamina, weaponOf, applyStagger } from '../shared/combat.js';
import type { SimState } from '../shared/sim.js';
import {
  ARMORS,
  ARM_DEBUFF,
  Act,
  GUARD_BREAK_STAGGER,
  HEAD_DAZE,
  HIT_STAGGER,
  LAST_CHANCE,
  LAST_CHANCE_STAMINA,
  LEG_DEBUFF,
  REVIVE_HP,
  ZONE_DAMAGE,
  Zone,
  counterDir,
} from '../shared/weapons.js';

export interface Fighter {
  id: string;
  sim: SimState;
}

export interface PlayerStats {
  hits: number;
  damage: number;
  taken: number;
  blocks: number;
  parries: number;
  zones: [number, number, number, number];
}

export function newStats(): PlayerStats {
  return { hits: 0, damage: 0, taken: 0, blocks: 0, parries: 0, zones: [0, 0, 0, 0] };
}

/** Welche Zone trifft ein Schlag? Oben = Kopf, seitlich = Torso (Arm beim Ausholen, Bein in der Erholung). */
export function zoneFor(attackDir: number, defender: SimState): number {
  if (attackDir === 0) return Zone.HEAD;
  if (defender.act === Act.WINDUP) return Zone.ARM;
  if (defender.act === Act.RECOVERY) return Zone.LEG;
  return Zone.TORSO;
}

/** Stoesst `target` von `from` weg (Geschwindigkeit in m/s, klingt in der Simulation ab). */
function push(from: SimState, target: SimState, speed: number): void {
  const dx = target.x - from.x;
  const dz = target.z - from.z;
  const d = Math.hypot(dx, dz) || 1;
  target.kx += (dx / d) * speed;
  target.kz += (dz / d) * speed;
}

function revive(f: Fighter, events: NetEvent[]): void {
  f.sim.down = false;
  f.sim.downT = 0;
  f.sim.hp = REVIVE_HP;
  f.sim.revived = true;
  events.push({ k: 'revive', id: f.id });
}

function goDown(f: Fighter, events: NetEvent[]): void {
  const s = f.sim;
  s.down = true;
  s.downT = LAST_CHANCE;
  s.hp = 0;
  s.stamina = Math.min(s.stamina, LAST_CHANCE_STAMINA);
  s.exhausted = false;
  // Nicht mehr ausholen oder blocken, aber laufende Schlaege/Erholungen zu Ende fuehren
  if (s.act === Act.WINDUP || s.act === Act.BLOCK || s.act === Act.STAGGER) {
    s.act = Act.IDLE;
    s.actT = 0;
    s.staggerT = 0;
  }
  events.push({ k: 'down', id: f.id });
}

/**
 * Wertet alle laufenden Schlaege aus. Gibt den Index (0/1) des Rundengewinners zurueck,
 * wenn ein Todesstoss gelandet ist, sonst -1.
 */
export function resolveStrikes(
  fighters: [Fighter, Fighter],
  stats: [PlayerStats, PlayerStats],
  events: NetEvent[],
): number {
  let winner = -1;

  for (let i = 0; i < 2; i++) {
    const a = fighters[i]!;
    const d = fighters[1 - i]!;
    const as = a.sim;
    const ds = d.sim;
    if (as.act !== Act.STRIKE || as.hitDone) continue;

    const w = weaponOf(as);
    const dw = weaponOf(ds);

    // Trifft der Schlag ueberhaupt? (Reichweite und Blickrichtung)
    const dx = ds.x - as.x;
    const dz = ds.z - as.z;
    const dist = Math.hypot(dx, dz);
    let inRange = dist <= w.reach;
    if (inRange && dist > 1e-4) {
      const fx = -Math.sin(as.yaw);
      const fz = -Math.cos(as.yaw);
      const cos = (dx * fx + dz * fz) / dist;
      inRange = Math.acos(Math.max(-1, Math.min(1, cos))) <= w.arc;
    }

    // Block: zaehlt in jedem Tick des Schlag-Zeitfensters (so bleibt Zeit zum Reagieren)
    if (inRange && ds.act === Act.BLOCK && ds.actT >= dw.blockRaise && ds.dir === counterDir(as.dir)) {
      as.hitDone = true;
      const perfect = ds.actT - dw.blockRaise < dw.perfectWindow;
      if (perfect) {
        applyStagger(as, w.parryStagger);
        push(ds, as, w.pushParry);
        stats[1 - i]!.parries++;
        stats[1 - i]!.blocks++;
        events.push({ k: 'parry', a: a.id, d: d.id });
        if (ds.down && !ds.revived) revive(d, events);
      } else {
        stats[1 - i]!.blocks++;
        events.push({ k: 'block', a: a.id, d: d.id });
        spendStamina(ds, w.staminaOnBlocked * dw.blockFactor);
        push(as, ds, w.pushBlock);
        if (ds.stamina <= 0) {
          applyStagger(ds, GUARD_BREAK_STAGGER);
          push(as, ds, w.pushBreak - w.pushBlock);
          events.push({ k: 'break', d: d.id });
        }
      }
      continue;
    }

    // Der Schaden kommt erst im letzten Tick des Zeitfensters (bis dahin konnte noch geblockt werden)
    if (as.actT < w.strikeTicks - 1) continue;
    as.hitDone = true;
    if (!inRange) continue; // daneben

    const zone = zoneFor(as.dir, ds);
    const armor = ARMORS[ds.armor] ?? ARMORS[0]!;
    const dmg = w.damage * (ZONE_DAMAGE[zone] ?? 1) * armor.damageFactor;
    const finishing = ds.down;
    ds.hp -= dmg;

    stats[i]!.hits++;
    stats[i]!.damage += dmg;
    stats[i]!.zones[zone]!++;
    stats[1 - i]!.taken += dmg;

    push(as, ds, w.pushHit * (zone === Zone.HEAD ? 1.15 : 1));
    // Nachwirkungen
    if (zone === Zone.HEAD) ds.dazeT = HEAD_DAZE;
    else if (zone === Zone.ARM) ds.armT = ARM_DEBUFF;
    else if (zone === Zone.LEG) ds.legT = LEG_DEBUFF;
    // Treffer unterbrechen Ausholen und Block. Laufende Schlaege/Erholungen nicht (Schlagabtausch).
    if (ds.act === Act.IDLE || ds.act === Act.WINDUP || ds.act === Act.BLOCK) applyStagger(ds, HIT_STAGGER);

    if (finishing) {
      ds.hp = 0;
      events.push({ k: 'hit', a: a.id, d: d.id, z: zone, dmg, fin: true });
      winner = i;
    } else if (ds.hp <= 0) {
      if (ds.revived) {
        ds.hp = 0;
        events.push({ k: 'hit', a: a.id, d: d.id, z: zone, dmg, fin: true });
        winner = i;
      } else {
        events.push({ k: 'hit', a: a.id, d: d.id, z: zone, dmg });
        goDown(d, events);
      }
    } else {
      events.push({ k: 'hit', a: a.id, d: d.id, z: zone, dmg });
    }

    // Wer am Boden liegt und trifft, steht mit wenig Leben wieder auf
    if (as.down && !as.revived) revive(a, events);
  }

  return winner;
}
