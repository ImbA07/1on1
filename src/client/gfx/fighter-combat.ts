import * as THREE from 'three';
import { Act } from '../../shared/weapons.js';
import { GUARD_R, Spring, type AnimMods, type FighterAnimator } from './fighter-anim.js';
import { MOUNT_ROT_X } from './fighter-hand.js';
import type { Rig } from './fighter-rig.js';

// Kampf-Ebene: legt Ausholen, Schlag, Erholung, Block, Taumeln, Knien usw. ueber die
// Lauf-/Atem-Animation. Die Arme werden per IK im Brustraum gesteuert:
//  - Schwerthand: Handgelenk-Position + Klingenrichtung (die Schneide zeigt immer in Schlagrichtung)
//  - Schildarm: Handgelenk-Position + Blickrichtung der Schildflaeche
// Rumpf/Becken/Kopf bekommen Zusatzwinkel (AnimMods). Alles wird zwischen den Ticks
// interpoliert und zusaetzlich geglaettet (Server-Korrekturen erzeugen keine Spruenge).
// Keine Speicheranforderungen pro Bild.

/** Kampfzustand, den das Spiel pro Bild setzt (Ticks zu 1/30 s). */
export interface CombatPose {
  /** Act.* (0 Ruhe, 1 Ausholen, 2 Schlag, 3 Erholung, 4 Block, 5 Taumeln) */
  act: number;
  /** Richtung von Angriff bzw. Block: 0 oben, 1 links, 2 rechts (aus Sicht dieser Figur) */
  dir: number;
  /** Ticks seit Beginn der Aktion */
  actT: number;
  /** Bruchteil des laufenden Ticks 0..1 (fuer glatte Bewegung zwischen den Ticks) */
  tickFrac: number;
  /** Ticks Ausholen, bis der Schlag frei ist (windupNeed) */
  need: number;
  /** Ticks, nach denen das Ausholen automatisch zuschlaegt */
  windupMax: number;
  strikeTicks: number;
  recovery: number;
  blockRaise: number;
  /** Ticks bis ein umgelenkter Block wieder wirkt (actT startet dann negativ) */
  blockRedirectRaise: number;
  /** verbleibende Ticks Taumeln */
  staggerT: number;
  /** "Letzte Chance": kniet */
  down: boolean;
  downT: number;
  revived: boolean;
  /** Nachwirkungen: Arm-, Bein-, Kopftreffer (Ticks) */
  armT: number;
  legT: number;
  dazeT: number;
  /** 1 = Runde/Kampf gewonnen, -1 = verloren, 0 = laeuft */
  outcome: number;
}

export function newCombatPose(): CombatPose {
  return {
    act: Act.IDLE,
    dir: 0,
    actT: 0,
    tickFrac: 0,
    need: 14,
    windupMax: 36,
    strikeTicks: 4,
    recovery: 11,
    blockRaise: 6,
    blockRedirectRaise: 11,
    staggerT: 0,
    down: false,
    downT: 0,
    revived: false,
    armT: 0,
    legT: 0,
    dazeT: 0,
    outcome: 0,
  };
}

// ------------------------------------------------------------------ Schluesselposen

type V3 = readonly [number, number, number];

/** Schwerthand im Brustraum: Handgelenk w, Klingenrichtung b, Ellbogen-Richtung pole */
interface SwordKey {
  w: THREE.Vector3;
  q: THREE.Quaternion;
  pole: THREE.Vector3;
}

/** Schildarm: Handgelenk w, Schild-Vorderseite n, Ellbogen-Richtung pole */
interface ShieldKey {
  w: THREE.Vector3;
  n: THREE.Vector3;
  pole: THREE.Vector3;
}

const BODY_KEYS = [
  'hipX',
  'hipY',
  'hipZ',
  'hipPitch',
  'hipYaw',
  'hipRoll',
  'spinePitch',
  'spineYaw',
  'spineRoll',
  'chestPitch',
  'chestYaw',
  'chestRoll',
  'headPitch',
  'headYaw',
  'headRoll',
] as const;
type BodyKey = (typeof BODY_KEYS)[number];
type Body = Float32Array; // gleiche Reihenfolge wie BODY_KEYS
const NB = BODY_KEYS.length;

function body(p: Partial<Record<BodyKey, number>>): Body {
  const b = new Float32Array(NB);
  BODY_KEYS.forEach((k, i) => (b[i] = p[k] ?? 0));
  return b;
}

// Klinge und Schneide im Handraum (siehe fighter-hand.ts: Griffachse = Halterungs-Z)
const _X = new THREE.Vector3(1, 0, 0);
const BLADE_H = new THREE.Vector3(0, 0, -1).applyAxisAngle(_X, MOUNT_ROT_X);
const EDGE_H = new THREE.Vector3(0, -1, 0).applyAxisAngle(_X, MOUNT_ROT_X); // "lange Schneide" (Knoechelseite)
const SIDE_H = new THREE.Vector3().crossVectors(BLADE_H, EDGE_H);
const HAND_BASIS_INV = new THREE.Matrix4().makeBasis(SIDE_H, BLADE_H, EDGE_H).invert();

/** Handausrichtung aus Klingenrichtung b und Richtung, in die die Schneide zeigen soll. */
function swordQuat(b: THREE.Vector3, edgeHint: THREE.Vector3): THREE.Quaternion {
  const B = b.clone().normalize();
  const E = edgeHint.clone().addScaledVector(B, -edgeHint.dot(B));
  if (E.lengthSq() < 1e-6) E.set(0, 0, -1).addScaledVector(B, -B.z);
  E.normalize();
  const S = new THREE.Vector3().crossVectors(B, E);
  const m = new THREE.Matrix4().makeBasis(S, B, E).multiply(HAND_BASIS_INV);
  return new THREE.Quaternion().setFromRotationMatrix(m);
}

const vec = (a: V3) => new THREE.Vector3(a[0], a[1], a[2]);

function sk(w: V3, b: V3, edge: V3, pole: V3): SwordKey {
  return { w: vec(w), q: swordQuat(vec(b), vec(edge)), pole: vec(pole).normalize() };
}
function shk(w: V3, n: V3, pole: V3): ShieldKey {
  return { w: vec(w), n: vec(n).normalize(), pole: vec(pole).normalize() };
}

/** Schneiden-Richtung = Richtung der Bewegung der Klinge von a nach b */
function travel(from: V3, to: V3): V3 {
  const a = vec(from).normalize();
  const b = vec(to).normalize();
  const t = b.sub(a);
  return [t.x, t.y, t.z];
}

// Klingenrichtungen je Richtung: Ausholen -> Schlag-Mitte -> Ende
// Ausholen muss aus Gegnersicht (von vorn) sofort lesbar sein: die Klinge ragt deutlich
// ueber den Kopf (oben) bzw. seitlich ueber die Schulter hinaus (links/rechts).
const B_CHAMBER: V3[] = [
  [0.12, 0.96, 0.26], // oben: fast senkrecht hoch ueber dem Kopf (klare senkrechte Linie)
  [-0.92, 0.3, 0.26], // links: flach und weit ueber die linke Schulter nach aussen
  [0.93, 0.28, 0.24], // rechts: flach und weit ueber die rechte Schulter nach aussen
];
// Mitte: Klinge quer (Hieb, kein Stich)
const B_MID: V3[] = [
  [0.08, 0.62, -0.78],
  [-0.74, 0.22, -0.64],
  [0.76, 0.22, -0.62],
];
const B_END: V3[] = [
  [0.05, -0.82, -0.57],
  [0.86, -0.42, -0.28],
  [-0.62, -0.62, -0.48],
];

const W_CHAMBER: V3[] = [
  [0.12, 0.72, 0.0],
  [-0.21, 0.36, -0.02],
  [0.44, 0.28, 0.06],
];
const W_MID: V3[] = [
  [0.08, 0.36, -0.44],
  [0.02, 0.24, -0.46],
  [0.25, 0.22, -0.44],
];
const W_END: V3[] = [
  [0.1, -0.12, -0.38],
  [0.34, -0.02, -0.3],
  [0.02, -0.08, -0.42],
];
const P_CHAMBER: V3[] = [
  [1, -0.3, 0.1],
  [0.3, -1, 0.2],
  [0.6, -0.8, 0.4],
];
const P_MID: V3[] = [
  [0.8, -0.6, 0.2],
  [0.5, -0.8, 0.3],
  [0.7, -0.6, 0.3],
];
const P_END: V3[] = [
  [0.6, -0.4, 0.6],
  [0.3, -0.7, 0.6],
  [0.8, -0.5, 0.3],
];

const CHAMBER: SwordKey[] = [0, 1, 2].map((d) => sk(W_CHAMBER[d]!, B_CHAMBER[d]!, travel(B_CHAMBER[d]!, B_MID[d]!), P_CHAMBER[d]!));
const MID: SwordKey[] = [0, 1, 2].map((d) => sk(W_MID[d]!, B_MID[d]!, travel(B_MID[d]!, B_END[d]!), P_MID[d]!));
const END: SwordKey[] = [0, 1, 2].map((d) => sk(W_END[d]!, B_END[d]!, travel(B_MID[d]!, B_END[d]!), P_END[d]!));

// Schwert beim Blocken hinter dem Schild, Spitze hoch
const SWORD_BLOCK: SwordKey[] = [
  sk([0.27, 0.04, -0.2], [0.18, 0.85, -0.5], [0, 0, -1], [0.8, -0.6, 0.2]),
  sk([0.26, 0.0, -0.24], [0.12, 0.9, -0.4], [0, 0, -1], [0.8, -0.6, 0.2]),
  sk([0.32, -0.02, -0.14], [0.25, 0.9, -0.3], [0, 0, -1], [0.8, -0.6, 0.3]),
];
const SWORD_STAGGER = sk([0.42, 0.04, 0.1], [0.75, 0.35, 0.55], [0.2, 1, 0], [0.3, -0.9, 0.3]);
const SWORD_KNEEL = sk([0.2, 0.02, -0.38], [0.02, -0.86, -0.5], [0, 0, -1], [0.7, -0.5, 0.4]);
const SWORD_WIN = sk([0.12, 0.72, -0.1], [0.0, 1, 0.12], [0, 0, -1], [1, -0.2, 0]);
const SWORD_LOSE = sk([0.22, -0.36, -0.14], [0.1, -0.9, -0.4], [0, 0, -1], [0.6, -0.2, 0.7]);

// Grundhaltung: Schild links vor dem Koerper, schraeg nach aussen (Oberkoerper bleibt sichtbar)
const SHIELD_GUARD = shk([-0.19, -0.06, -0.3], [-0.5, 0.05, -0.87], [-1, -0.25, 0.4]);
const SHIELD_RUN = shk([-0.24, -0.1, -0.22], [-0.7, 0, -0.7], [-1, -0.3, 0.5]);
const SHIELD_BLOCK: ShieldKey[] = [
  shk([-0.02, 0.47, -0.34], [0, 0.6, -0.8], [-1, -0.45, 0.1]),
  shk([-0.32, 0.12, -0.36], [-0.4, 0.05, -0.92], [-0.6, -0.8, 0.2]),
  shk([0.1, 0.1, -0.4], [0.32, 0.05, -0.95], [-0.8, -0.5, 0.3]),
];
const SHIELD_TUCK: ShieldKey[] = [
  shk([-0.24, -0.06, -0.26], [-0.55, 0.05, -0.83], [-1, -0.3, 0.3]),
  shk([-0.22, -0.12, -0.28], [-0.5, 0, -0.86], [-1, -0.3, 0.3]),
  shk([-0.36, -0.06, -0.08], [-0.85, 0.05, -0.5], [-1, -0.3, 0.4]),
];
const SHIELD_STAGGER = shk([-0.42, -0.02, -0.12], [-0.8, 0.12, -0.6], [-0.8, -0.6, 0.3]);
const SHIELD_KNEEL = shk([-0.3, -0.2, -0.24], [-0.55, 0.15, -0.8], [-1, -0.4, 0.2]);
const SHIELD_WIN = shk([-0.3, -0.16, -0.16], [-0.7, 0, -0.7], [-1, -0.2, 0.3]);
const SHIELD_LOSE = shk([-0.3, -0.4, -0.06], [-0.9, 0, -0.35], [-0.6, -0.2, 0.7]);

const BODY_GUARD = body({});
const BODY_CHAMBER = [
  body({ spinePitch: 0.1, chestPitch: 0.12, hipZ: 0.03, hipY: -0.02, headPitch: -0.1 }),
  body({ spineYaw: 0.2, chestYaw: 0.18, hipYaw: 0.1, chestRoll: -0.05, hipZ: 0.02, hipY: -0.015 }),
  body({ spineYaw: -0.22, chestYaw: -0.2, hipYaw: -0.1, chestRoll: 0.06, hipZ: 0.03, hipY: -0.015 }),
];
const BODY_MID = [
  body({ spinePitch: -0.1, chestPitch: -0.12, hipZ: -0.05, hipY: -0.03 }),
  body({ spineYaw: -0.06, chestYaw: -0.1, spinePitch: -0.06, hipZ: -0.05, hipY: -0.03 }),
  body({ spineYaw: 0.06, chestYaw: 0.1, spinePitch: -0.06, hipZ: -0.05, hipY: -0.03 }),
];
const BODY_END = [
  body({ spinePitch: -0.18, chestPitch: -0.14, hipZ: -0.075, hipY: -0.05, hipPitch: -0.05 }),
  body({ spineYaw: -0.28, chestYaw: -0.26, hipYaw: -0.14, spinePitch: -0.12, hipZ: -0.07, hipY: -0.045 }),
  body({ spineYaw: 0.24, chestYaw: 0.24, hipYaw: 0.12, spinePitch: -0.1, hipZ: -0.065, hipY: -0.045 }),
];
const BODY_BLOCK = [
  body({ spinePitch: -0.03, hipY: -0.03, headPitch: 0.04 }),
  body({ spineYaw: 0.12, chestYaw: 0.1, hipY: -0.03 }),
  body({ spineYaw: -0.14, chestYaw: -0.12, hipY: -0.03 }),
];
const BODY_STAGGER = body({ spinePitch: 0.26, chestPitch: 0.2, hipZ: 0.12, hipPitch: 0.1, headPitch: 0.3, chestRoll: 0.1, spineYaw: -0.12, hipY: -0.05 });
const BODY_KNEEL = body({ spinePitch: -0.16, chestPitch: -0.06, headPitch: -0.32 });
const BODY_WIN = body({ spinePitch: 0.05, chestPitch: 0.04, headPitch: 0.16 });
const BODY_LOSE = body({ spinePitch: -0.3, chestPitch: -0.18, headPitch: -0.55, headRoll: 0.08 });

// ------------------------------------------------------------------ Hilfsfunktionen

function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}
function smooth01(t: number): number {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}
function easeOut(t: number, p = 2): number {
  return 1 - Math.pow(1 - clamp(t, 0, 1), p);
}
function kExp(rate: number, dt: number): number {
  return 1 - Math.exp(-rate * dt);
}

/** Arbeitskopie einer Pose (vorab angelegt, wird nur ueberschrieben). */
class PoseBuf {
  readonly sw = new THREE.Vector3();
  readonly sq = new THREE.Quaternion();
  readonly sp = new THREE.Vector3();
  readonly hw = new THREE.Vector3();
  readonly hn = new THREE.Vector3();
  readonly hp = new THREE.Vector3();
  readonly body = new Float32Array(NB);

  setSword(k: SwordKey): this {
    this.sw.copy(k.w);
    this.sq.copy(k.q);
    this.sp.copy(k.pole);
    return this;
  }
  setShield(k: ShieldKey): this {
    this.hw.copy(k.w);
    this.hn.copy(k.n);
    this.hp.copy(k.pole);
    return this;
  }
  setBody(b: Body): this {
    this.body.set(b);
    return this;
  }
  mixSword(a: SwordKey, b: SwordKey, t: number): this {
    this.sw.lerpVectors(a.w, b.w, t);
    this.sq.slerpQuaternions(a.q, b.q, t);
    this.sp.lerpVectors(a.pole, b.pole, t).normalize();
    return this;
  }
  mixShield(a: ShieldKey, b: ShieldKey, t: number): this {
    this.hw.lerpVectors(a.w, b.w, t);
    this.hn.lerpVectors(a.n, b.n, t).normalize();
    this.hp.lerpVectors(a.pole, b.pole, t).normalize();
    return this;
  }
  mixBody(a: Body, b: Body, t: number): this {
    for (let i = 0; i < NB; i++) this.body[i] = a[i]! + (b[i]! - a[i]!) * t;
    return this;
  }
}

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _S = new THREE.Vector3();
const _E = new THREE.Vector3();
const _W = new THREE.Vector3();
const _d = new THREE.Vector3();
const _p = new THREE.Vector3();
const _bx = new THREE.Vector3();
const _by = new THREE.Vector3();
const _bz = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _qU = new THREE.Quaternion();
const _qF = new THREE.Quaternion();
const _qH = new THREE.Quaternion();
const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _qI = new THREE.Quaternion();
const _Y = new THREE.Vector3(0, 1, 0);
const _SW = new THREE.Vector3();

interface ArmBones {
  shoulder: THREE.Bone;
  upper: THREE.Bone;
  fore: THREE.Bone;
  hand: THREE.Bone;
  l1: number;
  l2: number;
}

// ------------------------------------------------------------------ Kampf-Ebene

export class CombatLayer {
  readonly pose: CombatPose = newCombatPose();
  /** Schild in der linken Hand (Waffe "Schwert & Schild") */
  shield = true;

  private readonly armR: ArmBones;
  private readonly armL: ArmBones;
  private readonly guardR: SwordKey;

  // geglaettete Ist-Pose
  private readonly cur = new PoseBuf();
  private readonly tgt = new PoseBuf();
  private first = true;
  private wR = 0; // Anteil IK am Schwertarm (0 = freie Lauf-/Ruhepose)
  private wL = 0;
  private kneel = 0;
  private limp = 0;
  private daze = 0;
  private armHurt = 0;
  private tension = 0;

  // Uebergaenge
  private prevAct: number = Act.IDLE;
  private prevDir = 0;
  private recFromWindup = false;
  private blockFrom = -1; // Blockrichtung vor einem Wechsel (-1 = aus der Grundhaltung)
  private staggerMax = 10;
  private time = Math.random() * 10;
  /** Impuls fuer Umhang/Waffenrock (Figurenraum, m/s), wird von aussen abgeholt */
  readonly impulse = new THREE.Vector3();
  hasImpulse = false;
  /** Staerke der Klingenspur in diesem Bild (0 = keine) */
  trailStrength = 0;
  /** 0..1: wie stark der Gangzyklus gerade unterdrueckt wird (Ausfallschritt, Rueckstoss) */
  gaitDamp = 0;

  // Trefferreaktionen: gedaempfte Federn (Ziel 0), per Stoss angeregt
  private readonly sp = {
    hipX: new Spring(150, 0.42),
    hipY: new Spring(150, 0.42),
    hipZ: new Spring(130, 0.45),
    spinePitch: new Spring(140, 0.4),
    spineYaw: new Spring(140, 0.42),
    spineRoll: new Spring(140, 0.42),
    headPitch: new Spring(170, 0.38),
    headRoll: new Spring(170, 0.4),
    buckle: new Spring(90, 0.55),
    swX: new Spring(120, 0.4),
    swY: new Spring(120, 0.4),
    swZ: new Spring(120, 0.4),
    shX: new Spring(140, 0.42),
    shY: new Spring(140, 0.42),
    shZ: new Spring(140, 0.42),
  };
  private readonly spList: Spring[] = Object.values(this.sp);
  private impactT = 9; // Sekunden seit dem letzten Stoss
  private collapse = 0; // schnelles Einsacken (down)
  private readonly swOff = new THREE.Vector3();
  private readonly shOff = new THREE.Vector3();

  constructor(
    private readonly rig: Rig,
    private readonly anim: FighterAnimator,
  ) {
    const arm = (S: 'L' | 'R'): ArmBones => {
      const B = rig.bones;
      return {
        shoulder: B['shoulder' + S]!,
        upper: B['upperArm' + S]!,
        fore: B['forearm' + S]!,
        hand: B['hand' + S]!,
        l1: B['forearm' + S]!.position.length(),
        l2: B['hand' + S]!.position.length(),
      };
    };
    this.armR = arm('R');
    this.armL = arm('L');
    this.guardR = this.fkGuard();
  }

  /** Grundhaltung der Schwerthand aus der Lauf-Animation (damit Ueberblenden nahtlos ist). */
  private fkGuard(): SwordKey {
    const a = this.armR;
    const save = [a.shoulder, a.upper, a.fore, a.hand].map((b) => b.quaternion.clone());
    a.shoulder.rotation.set(0, 0, 0);
    a.upper.rotation.set(GUARD_R.ux, GUARD_R.uy, GUARD_R.uz);
    a.fore.rotation.set(GUARD_R.fx, GUARD_R.fy, 0);
    a.hand.rotation.set(GUARD_R.hx, 0, GUARD_R.hz);
    const chain = [a.shoulder, a.upper, a.fore, a.hand];
    const M = new THREE.Matrix4();
    const pos: THREE.Vector3[] = [];
    for (const b of chain) {
      b.updateMatrix();
      M.multiply(b.matrix);
      pos.push(new THREE.Vector3().setFromMatrixPosition(M));
    }
    const q = new THREE.Quaternion().setFromRotationMatrix(M);
    const S = pos[1]!;
    const E = pos[2]!;
    const W = pos[3]!;
    const dir = W.clone().sub(S).normalize();
    const pole = E.clone().sub(S);
    pole.addScaledVector(dir, -pole.dot(dir)).normalize();
    chain.forEach((b, i) => b.quaternion.copy(save[i]!));
    return { w: W, q, pole };
  }

  /** Vor animator.update(): Zusatzwinkel und Knien setzen. */
  pre(dt: number): void {
    const c = this.pose;
    const M = this.anim.mods;
    this.time += dt;

    // --- Uebergaenge erkennen ---
    if (c.act !== this.prevAct) {
      if (c.act === Act.RECOVERY) this.recFromWindup = this.prevAct === Act.WINDUP;
      if (c.act === Act.BLOCK) this.blockFrom = -1;
      if (c.act === Act.STAGGER) {
        this.staggerMax = Math.max(6, c.staggerT);
        this.addImpulse(0, 0.6, -2.4);
      }
      if (c.act === Act.STRIKE) {
        const side = c.dir === 1 ? 1 : c.dir === 2 ? -1 : 0;
        this.addImpulse(-side * 2.2, 0.5, 2.6);
        // Ausfallschritt: vorderer (linker) Fuss tritt vor, hinterer bleibt als Standbein stehen
        M.stepNow[0] = true;
        M.stepNowDur = 0.13;
      }
    } else if (c.act === Act.BLOCK && c.dir !== this.prevDir) {
      this.blockFrom = this.prevDir;
    }
    // Fusswechsel bei Richtungswechsel (Ausholen/Block): der Fuss auf der neuen Seite setzt um
    if ((c.act === Act.BLOCK || c.act === Act.WINDUP) && c.act === this.prevAct && c.dir !== this.prevDir) {
      M.stepNow[c.dir === 1 ? 0 : 1] = true;
      M.stepNowDur = 0.16;
    }
    if (c.act === Act.STAGGER) this.staggerMax = Math.max(this.staggerMax, c.staggerT);
    this.prevAct = c.act;
    this.prevDir = c.dir;

    // --- Zielpose bestimmen ---
    this.evaluate(this.tgt);

    // --- Glaetten ---
    const strike = c.act === Act.STRIKE;
    const rateS = strike ? 95 : c.act === Act.STAGGER ? 30 : c.act === Act.RECOVERY ? 22 : 17;
    const rateH = c.act === Act.BLOCK ? 32 : c.act === Act.STAGGER ? 24 : 15;
    const rateB = strike ? 30 : c.act === Act.STAGGER ? 22 : 12;
    if (this.first) {
      this.cur.sw.copy(this.tgt.sw);
      this.cur.sq.copy(this.tgt.sq);
      this.cur.sp.copy(this.tgt.sp);
      this.cur.hw.copy(this.tgt.hw);
      this.cur.hn.copy(this.tgt.hn);
      this.cur.hp.copy(this.tgt.hp);
      this.cur.body.set(this.tgt.body);
      this.first = false;
    } else {
      const ks = kExp(rateS, dt);
      const kh = kExp(rateH, dt);
      const kb = kExp(rateB, dt);
      this.cur.sw.lerp(this.tgt.sw, ks);
      this.cur.sq.slerp(this.tgt.sq, ks);
      this.cur.sp.lerp(this.tgt.sp, ks).normalize();
      this.cur.hw.lerp(this.tgt.hw, kh);
      this.cur.hn.lerp(this.tgt.hn, kh).normalize();
      this.cur.hp.lerp(this.tgt.hp, kh).normalize();
      for (let i = 0; i < NB; i++) this.cur.body[i]! += (this.tgt.body[i]! - this.cur.body[i]!) * kb;
    }

    // --- Trefferreaktionen (Federn) ---
    this.impactT += dt;
    const S = this.sp;
    for (let i = 0; i < this.spList.length; i++) this.spList[i]!.update(0, dt);
    const impactE =
      Math.abs(S.swX.x) + Math.abs(S.swY.x) + Math.abs(S.swZ.x) + Math.abs(S.shX.x) + Math.abs(S.shY.x) + Math.abs(S.shZ.x);
    this.collapse = Math.max(0, this.collapse - dt * 2.2);

    // --- Fussarbeit ---
    this.footwork(c);

    // --- Klingenspur und Gangdaempfung ---
    const tt = c.actT + clamp(c.tickFrac, 0, 1);
    if (c.act === Act.STRIKE) this.trailStrength = 1;
    else if (c.act === Act.RECOVERY && !this.recFromWindup) this.trailStrength = Math.max(0, 1 - tt / 3.5) * 0.8;
    else if (c.act === Act.WINDUP && tt > c.need) this.trailStrength = 0.22 * clamp((tt - c.need) / 8, 0, 1);
    else this.trailStrength = 0;
    const lungeDamp = c.act === Act.STRIKE ? 0.9 : c.act === Act.RECOVERY && !this.recFromWindup ? 0.6 * (1 - tt / c.recovery) : 0;
    const knockDamp = this.impactT < 0.35 ? 0.9 : 0;
    this.gaitDamp = Math.max(lungeDamp, knockDamp, c.act === Act.STAGGER ? 0.7 : 0);

    // --- Gewichte ---
    const active = c.act !== Act.IDLE || c.down || c.outcome !== 0 || this.kneel > 0.02 || impactE > 0.004;
    // Kampfhaltung auch im Stand und Gehen (nur beim Rennen uebernimmt der Armschwung)
    const wantR = active ? 1 : 1 - this.anim.runBlend;
    this.wR += (wantR - this.wR) * kExp(active ? 14 : 7, dt);
    this.wL += ((this.shield ? 1 : 0) - this.wL) * kExp(8, dt);
    const wantKneel = c.down || c.outcome < 0 ? 1 : 0;
    this.kneel += (wantKneel - this.kneel) * kExp(wantKneel ? (this.collapse > 0 ? 9 : 3.2) : 2.2, dt);
    this.limp += ((c.legT > 0 ? 1 : 0) - this.limp) * kExp(3, dt);
    this.daze += ((c.dazeT > 0 ? 1 : 0) - this.daze) * kExp(4, dt);
    this.armHurt += ((c.armT > 0 ? 1 : 0) - this.armHurt) * kExp(3, dt);
    const tens = c.act === Act.WINDUP || c.act === Act.STRIKE ? 1 : c.act === Act.BLOCK ? 0.5 : 0;
    this.tension += (tens - this.tension) * kExp(10, dt);

    // --- Rumpf-Zusaetze ---
    const b = this.cur.body;
    M.hipX = b[0]!;
    M.hipY = b[1]!;
    M.hipZ = b[2]!;
    M.hipPitch = b[3]!;
    M.hipYaw = b[4]!;
    M.hipRoll = b[5]!;
    M.spinePitch = b[6]!;
    M.spineYaw = b[7]!;
    M.spineRoll = b[8]!;
    M.chestPitch = b[9]!;
    M.chestYaw = b[10]!;
    M.chestRoll = b[11]!;
    M.headPitch = b[12]!;
    M.headYaw = b[13]!;
    M.headRoll = b[14]!;
    // Benommen: Kopf wackelt, Oberkoerper schwankt
    if (this.daze > 0.01) {
      const t = this.time;
      M.headRoll += (Math.sin(t * 6.3) * 0.09 + Math.sin(t * 2.9) * 0.05) * this.daze;
      M.headYaw += Math.sin(t * 4.1 + 1) * 0.07 * this.daze;
      M.spineRoll += Math.sin(t * 2.3) * 0.04 * this.daze;
    }
    // Stoss-Federn auf den Rumpf
    M.hipX += S.hipX.x;
    M.hipY += S.hipY.x - 0.05 * Math.max(0, S.buckle.x);
    M.hipZ += S.hipZ.x;
    M.spinePitch += S.spinePitch.x;
    M.chestPitch += S.spinePitch.x * 0.6;
    M.spineYaw += S.spineYaw.x;
    M.spineRoll += S.spineRoll.x;
    M.headPitch += S.headPitch.x;
    M.headRoll += S.headRoll.x;
    this.swOff.set(S.swX.x, S.swY.x, S.swZ.x);
    this.shOff.set(S.shX.x, S.shY.x, S.shZ.x);
    M.kneel = clamp(Math.max(this.kneel, S.buckle.x * 0.85), 0, 1);
    M.limp = this.limp;
    M.shieldGrip = this.shield;
    M.gripTension = this.tension;
  }

  /** Zielpose fuer den aktuellen Zustand (zwischen den Ticks interpoliert). */
  private evaluate(o: PoseBuf): void {
    const c = this.pose;
    const d = c.dir === 1 || c.dir === 2 ? c.dir : 0;
    const t = c.actT + clamp(c.tickFrac, 0, 1);
    const run = this.anim.runBlend;
    const G = this.guardR;

    // Grundhaltung (auch Basis fuer alles andere)
    o.setSword(G).setBody(BODY_GUARD).setShield(SHIELD_GUARD);
    if (run > 0.01) o.mixShield(SHIELD_GUARD, SHIELD_RUN, run);
    // Lebendiger Kampfstand: Schwertspitze kreist langsam, Rumpf pendelt, Gewicht wandert
    if (c.act === Act.IDLE && !c.down && c.outcome === 0) {
      const tm = this.time;
      const lv = 1 - 0.6 * this.anim.moveAmp;
      o.sw.x += (Math.sin(tm * 1.15) * 0.028 + Math.sin(tm * 2.7) * 0.008) * lv;
      o.sw.y += (Math.sin(tm * 0.83 + 1) * 0.024 + Math.sin(tm * 3.1) * 0.006) * lv;
      o.sw.z += Math.cos(tm * 1.15) * 0.02 * lv;
      o.body[7] = Math.sin(tm * 0.52) * 0.07 * lv; // spineYaw
      o.body[10] = Math.sin(tm * 0.52 + 0.6) * 0.05 * lv; // chestYaw
      o.body[0] = Math.sin(tm * 0.37) * 0.018 * lv; // hipX (Gewicht)
      o.hw.y += Math.sin(tm * 0.9 + 2) * 0.02 * lv;
      o.hw.x += Math.sin(tm * 0.6) * 0.015 * lv;
    }

    if (c.outcome > 0) {
      o.setSword(SWORD_WIN).setShield(SHIELD_WIN).setBody(BODY_WIN);
      return;
    }
    if (c.outcome < 0) {
      o.setSword(SWORD_LOSE).setShield(SHIELD_LOSE).setBody(BODY_LOSE);
      return;
    }

    switch (c.act) {
      case Act.WINDUP: {
        const p = t / Math.max(1, c.need);
        const e = easeOut(p, 2.2);
        o.mixSword(G, CHAMBER[d]!, e).mixBody(BODY_GUARD, BODY_CHAMBER[d]!, e).mixShield(SHIELD_GUARD, SHIELD_TUCK[d]!, e * 0.6);
        // Bogen statt gerader Linie: Hand nicht quer vor dem Gesicht bzw. durch die Brust fuehren
        const arc = Math.sin(Math.PI * e);
        if (d === 0) o.sw.x += 0.13 * arc;
        else if (d === 1) o.sw.z -= 0.1 * arc;
        else o.sw.x += 0.05 * arc;
        // Laenger gehalten: weiter spannen, leichtes Zittern
        const hold = clamp((t - c.need) / Math.max(1, c.windupMax - c.need), 0, 1);
        if (hold > 0) {
          o.body[7]! *= 1 + 0.25 * hold; // spineYaw
          o.body[10]! *= 1 + 0.25 * hold; // chestYaw
          o.sw.y += 0.03 * hold;
          o.sw.z += 0.03 * hold;
          const tr = Math.sin(this.time * 37) * 0.004 * hold;
          o.sw.x += tr;
          o.sw.y += tr * 0.7;
        }
        break;
      }
      case Act.STRIKE: {
        // schnell los (Wucht), Treffpunkt (Mitte) nach ~40 % des Zeitfensters
        const s = easeOut(t / Math.max(1, c.strikeTicks * 0.92), 1.6);
        if (s < 0.5) {
          const u = s / 0.5;
          o.mixSword(CHAMBER[d]!, MID[d]!, u).mixBody(BODY_CHAMBER[d]!, BODY_MID[d]!, u);
        } else {
          const u = (s - 0.5) / 0.5;
          o.mixSword(MID[d]!, END[d]!, u).mixBody(BODY_MID[d]!, BODY_END[d]!, u);
        }
        o.setShield(SHIELD_TUCK[d]!);
        break;
      }
      case Act.RECOVERY: {
        const r = t / Math.max(1, c.recovery);
        if (this.recFromWindup) {
          // Finte: aus dem Ausholen zurueck in die Grundhaltung
          const e = smooth01(r * 1.4);
          o.mixSword(CHAMBER[d]!, G, e).mixBody(BODY_CHAMBER[d]!, BODY_GUARD, e).mixShield(SHIELD_TUCK[d]!, SHIELD_GUARD, e);
        } else {
          // schwer nachlaufen, dann zurueck in die Deckung
          const e = smooth01(Math.pow(r, 0.85));
          o.mixSword(END[d]!, G, e).mixBody(BODY_END[d]!, BODY_GUARD, smooth01(r)).mixShield(SHIELD_TUCK[d]!, SHIELD_GUARD, e);
        }
        break;
      }
      case Act.BLOCK: {
        const from = this.blockFrom;
        const redirect = from >= 0 && from !== d;
        // actT kann nach einem Richtungswechsel negativ sein: Fortschritt 0..1 ueber die ganze Wartezeit
        const t0 = redirect ? c.blockRaise - c.blockRedirectRaise : 0;
        const span = Math.max(1, c.blockRaise - t0);
        const r = easeOut((t - t0) / span, redirect ? 1.6 : 2);
        if (redirect) {
          o.mixShield(SHIELD_BLOCK[from]!, SHIELD_BLOCK[d]!, r).mixSword(SWORD_BLOCK[from]!, SWORD_BLOCK[d]!, r).mixBody(BODY_BLOCK[from]!, BODY_BLOCK[d]!, r);
        } else {
          o.mixShield(SHIELD_GUARD, SHIELD_BLOCK[d]!, r).mixSword(G, SWORD_BLOCK[d]!, r).mixBody(BODY_GUARD, BODY_BLOCK[d]!, r);
        }
        if (!this.shield) {
          // ohne Schild: mit dem Schwert blocken (einfach: Schwert quer vor die Seite)
          o.mixSword(G, SWORD_BLOCK[d]!, r);
        }
        break;
      }
      case Act.STAGGER: {
        const s = 1 - clamp((c.staggerT - clamp(c.tickFrac, 0, 1)) / this.staggerMax, 0, 1);
        const k = s < 0.22 ? easeOut(s / 0.22, 2) : 1 - smooth01((s - 0.22) / 0.78);
        const amp = clamp(this.staggerMax / 12, 0.9, 1.4);
        o.mixSword(G, SWORD_STAGGER, k * Math.min(1, amp)).mixShield(SHIELD_GUARD, SHIELD_STAGGER, k * Math.min(1, amp));
        const lead = this.impactT < 0.25 ? 0.5 + 2 * this.impactT : 1; // Zonen-Stoss fuehrt am Anfang
        o.mixBody(BODY_GUARD, BODY_STAGGER, k * lead);
        for (let i = 0; i < NB; i++) o.body[i]! *= amp;
        break;
      }
    }

    // Knien: Ruhepose (Schwert aufgestuetzt), solange keine Aktion laeuft
    if (this.kneel > 0.02 && c.act === Act.IDLE) {
      const k = smooth01(this.kneel);
      o.mixSword(G, SWORD_KNEEL, k).mixShield(SHIELD_GUARD, SHIELD_KNEEL, k).mixBody(BODY_GUARD, BODY_KNEEL, k);
    }

    // Armtreffer: Waffenarm haengt etwas
    if (this.armHurt > 0.01) {
      o.sw.y -= 0.05 * this.armHurt;
      o.sw.x += 0.02 * this.armHurt;
    }
  }

  /** Nach animator.update(): Arme per IK in die Kampfpose bringen (ueberblendet). */
  post(): void {
    const cur = this.cur;
    if (this.wR > 0.002) {
      _SW.copy(cur.sw).add(this.swOff);
      this.solveArm(this.armR, _SW, cur.sp, cur.sq, null, this.wR);
    }
    if (this.wL > 0.002) {
      // Schildarm: Gehschwung und Atmen leicht mitnehmen
      _W.copy(cur.hw).add(this.shOff);
      _W.z -= this.anim.swingL * 0.12 * (1 - this.anim.runBlend * 0.5);
      _W.y += this.anim.breathSin * 0.004;
      this.solveArm(this.armL, _W, cur.hp, null, cur.hn, this.wL);
    }
  }

  /** Fuss-Ziele je Zustand (Figurenraum: -Z vorn, +X rechts). Index 0 = links (vorn), 1 = rechts (hinten). */
  private footwork(c: CombatPose): void {
    const M = this.anim.mods;
    const d = c.dir === 1 || c.dir === 2 ? c.dir : 0;
    let lx = 0;
    let lz = 0;
    let rx = 0;
    let rz = 0;
    let hold = -1;
    switch (c.act) {
      case Act.WINDUP:
        // Anlauf: hinteres Bein laedt (tritt etwas zurueck), je nach Seite
        if (d === 0) rz = 0.07;
        else if (d === 1) {
          lz = 0.04;
          rz = 0.04;
          rx = -0.02;
        } else {
          rz = 0.1;
          rx = 0.03;
        }
        break;
      case Act.STRIKE:
        lz = -0.14; // vorderer Fuss tritt in den Schlag
        rz = 0.05;
        hold = 1; // Standbein bleibt stehen -> Ausfallschritt
        break;
      case Act.RECOVERY:
        lz = this.recFromWindup ? 0 : -0.06;
        break;
      case Act.BLOCK:
        // breiter Stand, je nach Seite der Fuss unter dem Schild
        lx = d === 1 ? -0.06 : -0.03;
        rx = d === 2 ? 0.06 : 0.03;
        lz = d === 0 ? -0.03 : 0;
        rz = 0.05;
        break;
      case Act.STAGGER:
        rz = 0.1;
        lz = 0.04;
        break;
    }
    M.footTX[0] = lx;
    M.footTZ[0] = lz;
    M.footTX[1] = rx;
    M.footTZ[1] = rz;
    M.holdFoot = hold;
    M.idleShuffle = c.act === Act.IDLE && !c.down && c.outcome === 0;
  }

  /**
   * Stoss-Reaktion (additiv, klingt in ~0,4 s ab). px/pz: Richtung, in die der Koerper gestossen
   * wird (Figurenraum, +Z = nach hinten), zone 0 Kopf/1 Torso/2 Arm/3 Bein.
   */
  impact(kind: string, px: number, pz: number, zone: number, heavy: boolean): void {
    const S = this.sp;
    const g = heavy ? 1.6 : 1;
    const kick = (sp: Spring, v: number) => {
      sp.v += v * g;
    };
    this.impactT = 0;
    const side = clamp(px, -1, 1);
    const back = clamp(pz, -1, 1);
    switch (kind) {
      case 'hit':
        kick(S.hipZ, 0.9 * back);
        kick(S.hipX, 0.7 * side);
        if (zone === 0) {
          kick(S.headPitch, 12); // Nacken reisst zurueck
          kick(S.spinePitch, 3.2);
          kick(S.headRoll, -6 * (side || 0.6));
        } else if (zone === 2) {
          kick(S.swX, 4.2); // Waffenarm schleudert weg
          kick(S.swZ, 3.6);
          kick(S.swY, 1.6);
          kick(S.spineYaw, -4);
        } else if (zone === 3) {
          kick(S.buckle, 11); // Bein knickt ein
          kick(S.hipY, -1.2);
          kick(S.spineRoll, 3);
          kick(S.headPitch, -2);
        } else {
          kick(S.spinePitch, -7); // Koerper kruemmt sich
          kick(S.headPitch, -3.5);
          kick(S.spineRoll, -2.5 * side);
          kick(S.swY, -1.4);
          kick(S.shZ, 1.2);
          kick(S.buckle, 3);
        }
        this.addImpulse(side * 2.2, 0.6, back * 3);
        break;
      case 'block':
        kick(S.shZ, 1.8); // Schild federt zurueck
        kick(S.shY, 0.5);
        kick(S.shX, -0.4);
        kick(S.hipZ, 0.6 * back);
        kick(S.spinePitch, 1.3);
        kick(S.headPitch, 0.8);
        kick(S.swZ, 0.5);
        this.addImpulse(side * 1.2, 0.3, back * 1.8);
        break;
      case 'parry':
        kick(S.swY, 4.2); // Waffenarm wird aufgerissen
        kick(S.swZ, 3.6);
        kick(S.swX, 1.4);
        kick(S.spinePitch, 3.2);
        kick(S.spineYaw, 2);
        kick(S.headPitch, 2.2);
        kick(S.hipZ, 0.8 * Math.max(0.5, back));
        this.addImpulse(side * 1.5, 0.8, 3.2);
        break;
      case 'break':
        kick(S.shX, -3.2); // Schild und Arme werden aufgerissen
        kick(S.shY, 2.2);
        kick(S.shZ, 1.2);
        kick(S.swX, 2);
        kick(S.swY, 1.6);
        kick(S.spinePitch, 3);
        kick(S.headPitch, 2.8);
        kick(S.hipZ, 1 * Math.max(0.5, back));
        this.addImpulse(side * 1.5, 0.6, 3.4);
        break;
      case 'down':
        this.collapse = 1;
        kick(S.buckle, 5);
        kick(S.headPitch, -5);
        kick(S.spinePitch, -2.6);
        kick(S.hipY, -0.8);
        this.addImpulse(0, 1, 1.2);
        break;
      case 'revive':
        kick(S.hipY, 0.9);
        kick(S.spinePitch, 2);
        kick(S.headPitch, 3);
        this.addImpulse(0, -0.8, 0.5);
        break;
    }
  }

  private addImpulse(x: number, y: number, z: number): void {
    if (!this.hasImpulse) this.impulse.set(0, 0, 0);
    this.impulse.x += x;
    this.impulse.y += y;
    this.impulse.z += z;
    this.hasImpulse = true;
  }

  /**
   * Zwei-Knochen-IK im Brustraum. handQ: gewuenschte Handausrichtung (Schwert) oder
   * shieldN: gewuenschte Blickrichtung der Schildflaeche (Unterarm -X).
   */
  private solveArm(A: ArmBones, wrist: THREE.Vector3, pole: THREE.Vector3, handQ: THREE.Quaternion | null, shieldN: THREE.Vector3 | null, w: number): void {
    // Schultergelenk im Brustraum
    _S.copy(A.upper.position).applyQuaternion(A.shoulder.quaternion).add(A.shoulder.position);
    _d.subVectors(wrist, _S);
    let L = _d.length();
    const l1 = A.l1;
    const l2 = A.l2;
    L = clamp(L, Math.abs(l1 - l2) + 0.03, (l1 + l2) * 0.998);
    if (_d.lengthSq() < 1e-8) _d.set(0, -1, 0);
    _d.normalize();
    _W.copy(_S).addScaledVector(_d, L);
    const cosA = clamp((l1 * l1 + L * L - l2 * l2) / (2 * l1 * L), -1, 1);
    const sinA = Math.sqrt(1 - cosA * cosA);
    _p.copy(pole).addScaledVector(_d, -pole.dot(_d));
    if (_p.lengthSq() < 1e-6) _p.set(0, 0, 1).addScaledVector(_d, -_d.z);
    _p.normalize();
    _E.copy(_S).addScaledVector(_d, l1 * cosA).addScaledVector(_p, l1 * sinA);

    // Oberarm: Y zeigt vom Ellbogen zur Schulter, X = Beugeachse
    _by.subVectors(_S, _E).normalize();
    _bx.crossVectors(_by, _p).normalize();
    _bz.crossVectors(_bx, _by);
    _qU.setFromRotationMatrix(_m.makeBasis(_bx, _by, _bz));
    // Unterarm
    _by.subVectors(_E, _W).normalize();
    _bz.crossVectors(_bx, _by);
    _qF.setFromRotationMatrix(_m.makeBasis(_bx, _by, _bz));

    if (handQ) {
      // Verdrehung zwischen Unterarm und Hand teilen (sieht natuerlicher aus als nur am Handgelenk)
      _qa.copy(_qF).invert().multiply(handQ);
      _qb.set(0, _qa.y, 0, _qa.w);
      if (_qb.lengthSq() < 1e-8) _qb.identity();
      else _qb.normalize();
      _qI.identity().slerp(_qb, 0.5);
      _qF.multiply(_qI);
      _qH.copy(_qF).invert().multiply(handQ);
    } else if (shieldN) {
      // Unterarm so verdrehen, dass die Schildseite (-X) moeglichst zur gewuenschten Richtung zeigt
      _v1.set(-1, 0, 0).applyQuaternion(_qF);
      _v2.set(0, 1, 0).applyQuaternion(_qF);
      _p.copy(shieldN).addScaledVector(_v2, -shieldN.dot(_v2));
      if (_p.lengthSq() > 1e-6) {
        _p.normalize();
        const ang = Math.atan2(_v2.dot(_bz.crossVectors(_v1, _p)), _v1.dot(_p));
        _qa.setFromAxisAngle(_Y, clamp(ang, -2.2, 2.2));
        _qF.multiply(_qa);
      }
      _qH.setFromAxisAngle(_X, 0.12); // Hand leicht gebeugt am Griff
    } else {
      _qH.identity();
    }

    // In lokale Rotationen umrechnen und mit der freien Pose ueberblenden
    _qa.copy(A.shoulder.quaternion).invert().multiply(_qU);
    A.upper.quaternion.slerp(_qa, w);
    _qa.copy(_qU).invert().multiply(_qF);
    A.fore.quaternion.slerp(_qa, w);
    A.hand.quaternion.slerp(_qH, w);
  }
}
