// Einfache Trainings-Puppe: bewegt sich, greift an und blockt manchmal. Laeuft komplett
// auf dem Server und benutzt dieselben Eingaben wie ein echter Spieler.

import type { MoveInput, SimState } from '../shared/sim.js';
import { Act, counterDir } from '../shared/weapons.js';
import { weaponOf } from '../shared/combat.js';

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface BotConfig {
  blockChance: number; // Wahrscheinlichkeit, den Angriff richtig zu blocken
  reactionTicks: number; // Reaktionszeit
  attackEveryMin: number; // Ticks zwischen Angriffen
  attackEveryMax: number;
  windupExtraMin: number; // Ticks, die die Puppe ueber das Minimum hinaus ausholt
  windupExtraMax: number;
}

// Anfaenger-Puppe: greift seltener an, holt deutlich aus (gut lesbar), reagiert langsam
// und blockt nur manchmal die richtige Seite.
export const DEFAULT_BOT: BotConfig = {
  blockChance: 0.3,
  reactionTicks: 20,
  attackEveryMin: 100,
  attackEveryMax: 200,
  windupExtraMin: 8,
  windupExtraMax: 16,
};

type Plan =
  | { kind: 'none' }
  | { kind: 'wind'; hold: number; dir: number }
  | { kind: 'block'; dir: number; until: number };

export class BotBrain {
  private rand: () => number;
  private tick = 0;
  private nextAttackAt: number;
  private plan: Plan = { kind: 'none' };
  private strafeDir = 1;
  private nextStrafeAt = 0;
  private seenWindup = -1; // Tick, an dem wir den Angriff des Gegners zuerst bemerkt haben
  private lastDir = 0;

  constructor(
    seed = 12345,
    private readonly cfg: BotConfig = DEFAULT_BOT,
  ) {
    this.rand = mulberry32(seed);
    this.nextAttackAt = 90 + Math.floor(this.rand() * 60);
  }

  /** Erzeugt die Eingabe der Puppe fuer diesen Tick. */
  think(self: SimState, target: SimState, canAct: boolean): MoveInput {
    this.tick++;
    const dx = target.x - self.x;
    const dz = target.z - self.z;
    const dist = Math.hypot(dx, dz);
    // Blickrichtung zum Gegner: Vorwaerts = (-sin yaw, -cos yaw)
    const yaw = Math.atan2(-dx, -dz);
    const w = weaponOf(self);

    const input: MoveInput = { fwd: 0, right: 0, yaw, sprint: false, atk: false, blk: false, dir: self.dir };
    if (!canAct || self.down) return input;

    // ---- Bewegung: Abstand halten und ab und zu seitlich laufen ----
    if (self.act === Act.IDLE || self.act === Act.BLOCK) {
      if (dist > w.reach - 0.25) input.fwd = 1;
      else if (dist < 1.3) input.fwd = -1;
      if (this.tick >= this.nextStrafeAt) {
        this.strafeDir = this.rand() < 0.5 ? -1 : 1;
        this.nextStrafeAt = this.tick + 30 + Math.floor(this.rand() * 60);
      }
      if (dist < w.reach + 1.5) input.right = this.strafeDir * 0.5;
    }

    // ---- Block: Angriff des Gegners bemerken und (manchmal richtig) blocken ----
    const enemyWinding = target.act === Act.WINDUP && dist < w.reach + 1.0;
    if (enemyWinding) {
      if (this.seenWindup < 0) this.seenWindup = this.tick;
      if (this.plan.kind !== 'block' && this.plan.kind !== 'wind' && this.tick - this.seenWindup >= this.cfg.reactionTicks) {
        const right = this.rand() < this.cfg.blockChance;
        const dir = right ? counterDir(target.dir) : Math.floor(this.rand() * 3);
        this.plan = { kind: 'block', dir, until: this.tick + 40 };
      }
    } else if (target.act !== Act.STRIKE) {
      this.seenWindup = -1;
    }

    if (this.plan.kind === 'block') {
      const enemyDone = target.act === Act.RECOVERY || target.act === Act.IDLE || target.act === Act.STAGGER;
      if (this.tick >= this.plan.until || (enemyDone && this.tick > this.plan.until - 30)) {
        this.plan = { kind: 'none' };
      } else {
        input.blk = true;
        input.dir = this.plan.dir;
        return input;
      }
    }

    // ---- Angriff ----
    if (this.plan.kind === 'none' && this.tick >= this.nextAttackAt && self.act === Act.IDLE && dist <= w.reach - 0.1) {
      let dir = Math.floor(this.rand() * 3);
      if (dir === this.lastDir) dir = (dir + 1 + Math.floor(this.rand() * 2)) % 3;
      this.lastDir = dir;
      const extra = this.cfg.windupExtraMin + Math.floor(this.rand() * (this.cfg.windupExtraMax - this.cfg.windupExtraMin + 1));
      this.plan = { kind: 'wind', hold: w.windupMin + extra, dir };
    }
    if (this.plan.kind === 'wind') {
      input.dir = this.plan.dir;
      if (self.act === Act.IDLE && self.actT === 0 && !self.prevAtk) {
        input.atk = true; // Taste druecken (Flanke)
      } else if (self.act === Act.WINDUP) {
        this.plan.hold--;
        input.atk = this.plan.hold > 0;
      } else if (self.act === Act.STRIKE || self.act === Act.RECOVERY || self.act === Act.STAGGER) {
        this.plan = { kind: 'none' };
        this.nextAttackAt = this.tick + this.cfg.attackEveryMin + Math.floor(this.rand() * (this.cfg.attackEveryMax - this.cfg.attackEveryMin));
      }
    }
    return input;
  }
}
