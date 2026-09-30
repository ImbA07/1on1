// Waffen, Ruestungen und Kampf-Grundbegriffe. Alle Zeiten sind in Ticks (30 pro Sekunde).
// Werte sind Startwerte und werden mit echten Testkaempfen eingestellt.

const T = (seconds: number): number => Math.round(seconds * 30);

/** Aktionen einer Figur. Sie laufen wie ein Automat: Ausholen -> Schlag -> Erholung. */
export const Act = {
  IDLE: 0,
  WINDUP: 1, // Ausholen (Gegner sieht den Angriff kommen)
  STRIKE: 2, // Schlag (kurzes Zeitfenster, in dem er trifft)
  RECOVERY: 3, // Erholung nach dem Schlag (verwundbar)
  BLOCK: 4,
  STAGGER: 5, // aus dem Gleichgewicht
} as const;
export type ActId = (typeof Act)[keyof typeof Act];

/** Trefferzonen */
export const Zone = { HEAD: 0, TORSO: 1, ARM: 2, LEG: 3 } as const;
export const ZONE_NAMES = ['Kopf', 'Torso', 'Arm', 'Bein'] as const;
/** Schadensfaktor pro Zone */
export const ZONE_DAMAGE = [1.5, 1.0, 0.7, 0.7] as const;

/**
 * Richtungen 0 = oben, 1 = links, 2 = rechts, aus Sicht des ANGREIFERS.
 * Der Verteidiger muss die gespiegelte Seite decken (siehe counterDir): Was beim
 * Angreifer von links kommt, erscheint beim Verteidiger auf dessen rechter Seite.
 */
export const DIR_NAMES = ['oben', 'links', 'rechts'] as const;
export function clampDir(d: unknown): number {
  return d === 1 || d === 2 ? d : 0;
}
/** Welche Block-Richtung (aus Sicht des Verteidigers) einen Angriff mit Richtung d stoppt. */
export function counterDir(d: number): number {
  return d === 1 ? 2 : d === 2 ? 1 : 0;
}

export interface WeaponDef {
  id: string;
  name: string;
  windupMin: number; // fruehestens nach so vielen Ticks kann der Schlag ausgeloest werden
  windupMax: number; // danach schlaegt er automatisch zu
  strikeTicks: number; // Dauer des Schlag-Zeitfensters
  recovery: number; // Erholung nach dem Schlag
  reach: number; // Reichweite (Mitte zu Mitte) in Metern
  arc: number; // halber Trefferwinkel in Radiant
  damage: number; // Grundschaden
  staminaAttack: number; // Ausdauer beim Ausholen
  staminaHold: number; // Ausdauer pro Tick beim laengeren Halten des Ausholens
  staminaOnBlocked: number; // Ausdauer, die ein geblockter Schlag dem Blockenden kostet
  blockFactor: number; // Ausdauer-Kosten beim Blocken MIT dieser Waffe (Schild = wenig)
  blockRaise: number; // Ticks, bis der Block nach dem Druecken wirkt
  blockRedirectRaise: number; // Ticks, bis er nach einem Richtungswechsel wieder wirkt (deutlich laenger)
  blockRedirectCost: number; // Ausdauer fuer einen Richtungswechsel
  blockHoldDrain: number; // Ausdauer pro Tick, solange man den Block haelt (Dauerblocken geht nicht)
  perfectWindow: number; // Ticks nach Block-Aufbau, in denen ein Treffer ein Perfect Block ist
  parryStagger: number; // Ticks, die der Angreifer nach einem Perfect Block taumelt
  moveWindup: number; // Lauftempo-Faktor in den Phasen
  moveStrike: number;
  moveRecovery: number;
  moveBlock: number;
  lungeSpeed: number; // Ausfallschritt nach vorn waehrend des Schlags (m/s)
  pushHit: number; // Rueckstoss (m/s, klingt ab) fuer den Getroffenen
  pushBlock: number; // ... fuer den Blockenden
  pushParry: number; // ... fuer den Angreifer nach einem Perfect Block
  pushBreak: number; // ... fuer den Blockenden bei durchbrochenem Block
  feintCost: number;
  feintRecovery: number;
  redirectCost: number; // Richtung waehrend des Ausholens wechseln
  redirectPenalty: number;
}

export const WEAPONS: WeaponDef[] = [
  {
    id: 'swordShield',
    name: 'Schwert & Schild',
    windupMin: T(0.45),
    windupMax: T(1.2),
    strikeTicks: T(0.13),
    recovery: T(0.35),
    reach: 2.1,
    arc: 0.7,
    damage: 24,
    staminaAttack: 10,
    staminaHold: 0.17,
    staminaOnBlocked: 20,
    blockFactor: 0.5,
    blockRaise: 6,
    blockRedirectRaise: T(0.37),
    blockRedirectCost: 6,
    blockHoldDrain: 0.25,
    perfectWindow: 5,
    parryStagger: T(0.8),
    moveWindup: 0.55,
    moveStrike: 0.25,
    moveRecovery: 0.6,
    moveBlock: 0.55,
    lungeSpeed: 3.6,
    pushHit: 3.0,
    pushBlock: 1.8,
    pushParry: 4.2,
    pushBreak: 3.6,
    feintCost: 8,
    feintRecovery: T(0.27),
    redirectCost: 2,
    redirectPenalty: 3,
  },
];

export interface ArmorDef {
  id: string;
  name: string;
  damageFactor: number; // Anteil des Schadens, der durchkommt
}

export const ARMORS: ArmorDef[] = [{ id: 'heavy', name: 'Schwere Rüstung', damageFactor: 0.6 }];

export const HP_MAX = 100;
export const HIT_STAGGER = T(0.33);
export const HEAD_DAZE = T(0.5);
export const ARM_DEBUFF = T(3);
export const LEG_DEBUFF = T(3);
export const GUARD_BREAK_STAGGER = T(0.5);
export const LAST_CHANCE = T(3);
export const LAST_CHANCE_STAMINA = 40;
export const REVIVE_HP = 15;
export const COUNTDOWN = T(3);
export const ROUND_END = T(3.5);
