// Kampf-Automat einer Figur. Wird wie die Bewegung von Server UND Client gerechnet
// (deterministisch), damit sich die eigene Figur sofort anfuehlt.
// Ob ein Schlag TRIFFT, entscheidet nur der Server (siehe server/resolve.ts).

import type { MoveInput, SimState } from './sim.js';
import { Act, WEAPONS, clampDir, type WeaponDef } from './weapons.js';

export const COMBAT_REGEN_DELAY = 0.7; // Sekunden Pause, bevor Ausdauer nach Kampf-Aktionen zurueckkommt

export interface CombatFx {
  moveMult: number; // Faktor auf das Lauftempo
  canSprint: boolean;
  regenScale: number; // Faktor auf die Ausdauer-Erholung
}

export function weaponOf(p: SimState): WeaponDef {
  return WEAPONS[p.weapon] ?? WEAPONS[0]!;
}

/** Zieht Ausdauer ab. Bei 0 ist man erschoepft. */
export function spendStamina(p: SimState, amount: number): void {
  if (amount <= 0) return;
  p.stamina = Math.max(0, p.stamina - amount);
  p.regenDelay = Math.max(p.regenDelay, COMBAT_REGEN_DELAY);
  if (p.stamina <= 0) p.exhausted = true;
}

/** Sekunden bis der Schlag fruehestens ausgeloest werden darf (langsamer bei Erschoepfung u. a.). */
export function windupNeed(p: SimState, w: WeaponDef): number {
  const slow = (p.armT > 0 ? 0.4 : 0) + (p.exhausted ? 0.4 : 0) + (p.dazeT > 0 ? 0.3 : 0);
  return Math.round(w.windupMin * (1 + slow));
}

function startWindup(p: SimState, w: WeaponDef, dir: number): void {
  p.act = Act.WINDUP;
  p.dir = dir;
  p.actT = 0;
  p.hitDone = false;
  spendStamina(p, w.staminaAttack);
}

/** Bringt die Figur aus dem Gleichgewicht (vom Server aufgerufen). */
export function applyStagger(p: SimState, ticks: number): void {
  p.act = Act.STAGGER;
  p.staggerT = ticks;
  p.actT = 0;
  p.hitDone = true;
}

/**
 * Ein Kampf-Schritt (1/30 s). `canAct` ist false, solange nicht gekaempft werden darf
 * (Countdown, Rundenende). Die Eingabe-Flanken (Taste gerade gedrueckt) werden hier erkannt.
 */
export function stepCombat(p: SimState, input: MoveInput, canAct: boolean): CombatFx {
  const w = weaponOf(p);
  const atk = canAct && input.atk === true;
  const blk = canAct && input.blk === true;
  const atkEdge = atk && !p.prevAtk;
  const blkEdge = blk && !p.prevBlk;
  p.prevAtk = atk;
  p.prevBlk = blk;
  const dir = clampDir(input.dir);

  if (p.dazeT > 0) p.dazeT--;
  if (p.armT > 0) p.armT--;
  if (p.legT > 0) p.legT--;

  switch (p.act) {
    case Act.IDLE: {
      if (blk && !atkEdge) {
        p.act = Act.BLOCK;
        p.dir = dir;
        p.actT = 0;
        spendStamina(p, 2);
      } else if (atkEdge && p.stamina > 0) {
        startWindup(p, w, dir);
      }
      break;
    }

    case Act.WINDUP: {
      p.actT++;
      const need = windupNeed(p, w);
      if (blkEdge) {
        // Finte: Angriff abbrechen. Kostet Ausdauer und macht kurz langsam.
        p.act = Act.RECOVERY;
        p.actT = Math.max(0, w.recovery - w.feintRecovery);
        p.hitDone = true;
        spendStamina(p, w.feintCost);
        break;
      }
      if (dir !== p.dir) {
        // Richtung waehrend des Ausholens wechseln: kostet Zeit und Ausdauer
        p.dir = dir;
        p.actT = Math.max(0, p.actT - w.redirectPenalty);
        spendStamina(p, w.redirectCost);
      }
      if (p.actT > need && atk) spendStamina(p, w.staminaHold);
      const forced = p.actT >= w.windupMax || (p.stamina <= 0 && p.actT >= need);
      if (p.actT >= need && (!atk || forced)) {
        p.act = Act.STRIKE;
        p.actT = 0;
      }
      break;
    }

    case Act.STRIKE: {
      p.actT++;
      if (p.actT >= w.strikeTicks) {
        p.act = Act.RECOVERY;
        p.actT = 0;
      }
      break;
    }

    case Act.RECOVERY: {
      p.actT++;
      if (p.actT >= w.recovery) {
        p.act = Act.IDLE;
        p.actT = 0;
      }
      break;
    }

    case Act.BLOCK: {
      if (!blk) {
        p.act = Act.IDLE;
        p.actT = 0;
      } else if (atkEdge && p.stamina > 0) {
        startWindup(p, w, dir);
      } else {
        p.actT++;
        if (dir !== p.dir) {
          // Blockrichtung wechseln: Block muss neu aufgebaut werden
          p.dir = dir;
          p.actT = 0;
          spendStamina(p, 2);
        }
      }
      break;
    }

    case Act.STAGGER: {
      p.staggerT--;
      if (p.staggerT <= 0) {
        p.staggerT = 0;
        p.act = Act.IDLE;
        p.actT = 0;
      }
      break;
    }
  }

  let moveMult = 1;
  let regenScale = 1;
  switch (p.act) {
    case Act.WINDUP:
      moveMult = w.moveWindup;
      regenScale = 0;
      break;
    case Act.STRIKE:
      moveMult = w.moveStrike;
      regenScale = 0;
      break;
    case Act.RECOVERY:
      moveMult = w.moveRecovery;
      regenScale = 0;
      break;
    case Act.BLOCK:
      moveMult = w.moveBlock;
      regenScale = 0.5;
      break;
    case Act.STAGGER:
      moveMult = 0;
      regenScale = 0;
      break;
  }
  if (p.down) {
    moveMult = 0;
    regenScale = 0;
  }
  if (p.legT > 0) moveMult *= 0.7;
  if (p.dazeT > 0) moveMult *= 0.6;

  return { moveMult, canSprint: p.act === Act.IDLE && !p.down && p.legT === 0, regenScale };
}
