import * as THREE from 'three';

// Haende: Masse der Finger, Waffengriff-Loeser und Fingerposen.
// Alles im Handraum der RECHTEN Hand in Ruhelage (Arm haengt, Handflaeche zeigt nach -X
// zur Koerpermitte, Finger zeigen nach unten, Daumen nach vorne/-Z).
// Die linke Hand ist gespiegelt (X -> -X).

export const FINGER_NAMES = ['index', 'middle', 'ring', 'pinky'] as const;
export type FingerName = (typeof FINGER_NAMES)[number] | 'thumb';

export interface DigitDef {
  name: FingerName;
  /** Grundgelenk relativ zum Handgelenk */
  base: readonly [number, number, number];
  /** Richtung in Ruhelage (normiert) */
  dir: readonly [number, number, number];
  len: readonly [number, number, number];
  /** halbe Breite (quer) und halbe Dicke (Handruecken-Handflaeche) */
  hw: number;
  ht: number;
}

const THUMB_DIR = new THREE.Vector3(-0.25, -0.72, -0.64).normalize();

export const DIGITS: readonly DigitDef[] = [
  { name: 'index', base: [-0.003, -0.088, -0.028], dir: [0, -1, 0], len: [0.04, 0.025, 0.021], hw: 0.0095, ht: 0.0085 },
  { name: 'middle', base: [-0.003, -0.092, -0.0095], dir: [0, -1, 0], len: [0.044, 0.028, 0.022], hw: 0.0099, ht: 0.0088 },
  { name: 'ring', base: [-0.002, -0.089, 0.0092], dir: [0, -1, 0], len: [0.041, 0.026, 0.021], hw: 0.0093, ht: 0.0084 },
  { name: 'pinky', base: [-0.001, -0.081, 0.026], dir: [0, -1, 0], len: [0.032, 0.021, 0.019], hw: 0.0083, ht: 0.0076 },
  { name: 'thumb', base: [-0.013, -0.024, -0.026], dir: [THUMB_DIR.x, THUMB_DIR.y, THUMB_DIR.z], len: [0.04, 0.031, 0.026], hw: 0.011, ht: 0.0095 },
];

/** Waffenhalterung in der rechten Hand (Griffachse = lokale Z-Achse, Klinge nach -Z). */
export const MOUNT_POS = new THREE.Vector3(-0.031, -0.086, 0);
export const MOUNT_ROT_X = -0.35;
/** Radius der Fingermittellinie um die Griffachse (Griff ca. 19 mm + halbe Fingerdicke) */
const GRIP_R = 0.0255;

/** Beugeachse der Langfinger (rechte Hand): Beugen bewegt die Spitze nach -X (Handflaeche). */
export const FLEX_AXIS_R = new THREE.Vector3(0, 0, -1);
/** Beugeachse des Daumens (rechte Hand) */
export const THUMB_FLEX_AXIS_R = new THREE.Vector3().crossVectors(THUMB_DIR, new THREE.Vector3(-1, 0, 0)).normalize();

export function digitBoneName(d: FingerName, seg: number, side: 'L' | 'R'): string {
  return `${d}${seg + 1}${side}`;
}

/** Gelenkpunkte in Ruhelage (Handraum rechts): Grundgelenk, Mittel-, Endgelenk, Spitze. */
export function digitJoints(d: DigitDef): THREE.Vector3[] {
  const dir = new THREE.Vector3(...d.dir);
  const pts = [new THREE.Vector3(...d.base)];
  for (const l of d.len) pts.push(pts[pts.length - 1]!.clone().addScaledVector(dir, l));
  return pts;
}

// ------------------------------------------------------------------ Posen

export interface HandPose {
  /** je Langfinger: Grund-, Mittel-, Endgelenk-Beugung, Spreizung */
  fingers: [number, number, number, number][];
  /** Daumen: Drehung um Y (Opposition), Beugung Grund-, Mittel-, Endglied */
  thumb: [number, number, number, number];
}

/** Lockere, halb geoeffnete Hand (bereit fuer Block/Schild) */
export const RELAXED: HandPose = {
  fingers: [
    [0.5, 0.78, 0.45, 0.13],
    [0.62, 0.9, 0.5, 0.03],
    [0.74, 0.98, 0.55, -0.08],
    [0.86, 1.04, 0.58, -0.19],
  ],
  thumb: [0.55, 0.05, 0.35, 0.35],
};

/** Lockere Faust (z. B. beim Rennen) */
export const LOOSE_FIST: HandPose = {
  fingers: [
    [0.95, 1.2, 0.75, 0.04],
    [1.0, 1.25, 0.8, 0.0],
    [1.05, 1.25, 0.8, -0.04],
    [1.1, 1.25, 0.75, -0.08],
  ],
  thumb: [0.55, 0.45, 0.5, 0.35],
};

let gripCache: HandPose | null = null;

/**
 * Griff um das Schwert: Fingerbeugung so geloest, dass Mittelglieder und Spitzen
 * auf einem Kreis um die Griffachse liegen (umschliessen, nicht durchdringen).
 * Einmal berechnet und von allen Figuren geteilt.
 */
export function gripPose(): HandPose {
  if (gripCache) return gripCache;
  const axisDir = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(1, 0, 0), MOUNT_ROT_X);
  const tmp = new THREE.Vector3();
  const distToAxis = (p: THREE.Vector3) => {
    tmp.subVectors(p, MOUNT_POS);
    const t = tmp.dot(axisDir);
    tmp.addScaledVector(axisDir, -t);
    return tmp.length();
  };
  const P = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const M = new THREE.Vector3();
  const dir = (phi: number, out: THREE.Vector3) => out.set(-Math.sin(phi), -Math.cos(phi), 0);
  const d = new THREE.Vector3();
  const fingers: [number, number, number, number][] = [];
  for (let fi = 0; fi < 4; fi++) {
    const def = DIGITS[fi]!;
    const r = GRIP_R - (0.0088 - def.ht);
    let best = Infinity;
    let bestA: [number, number, number] = [0, 0, 0];
    const evalCost = (a: number, b: number, c: number) => {
      P[0]!.set(...def.base);
      let phi = a;
      let cost = 0;
      const angs = [a, a + b, a + b + c];
      for (let s = 0; s < 3; s++) {
        phi = angs[s]!;
        dir(phi, d);
        const A = P[s]!;
        const B = P[s + 1]!.copy(A).addScaledVector(d, def.len[s]!);
        for (const f of s === 0 ? [0.6, 1] : [0.5, 1]) {
          M.copy(A).lerp(B, f);
          const dist = distToAxis(M);
          const e = dist - r;
          cost += e * e;
          if (dist < r - 0.0015) cost += 40 * (r - 0.0015 - dist) ** 2;
        }
      }
      // natuerliche Kopplung End- zu Mittelgelenk
      cost += 0.00002 * (c - 0.75 * b) ** 2;
      return cost;
    };
    // grob, dann fein um das beste Ergebnis
    for (let a = 0; a <= 1.7; a += 0.1) {
      for (let b = 0; b <= 1.9; b += 0.1) {
        for (let c = 0; c <= 1.6; c += 0.1) {
          const cost = evalCost(a, b, c);
          if (cost < best) {
            best = cost;
            bestA = [a, b, c];
          }
        }
      }
    }
    const [a0, b0, c0] = bestA;
    for (let a = a0 - 0.1; a <= a0 + 0.1; a += 0.025) {
      for (let b = b0 - 0.1; b <= b0 + 0.1; b += 0.025) {
        for (let c = c0 - 0.1; c <= c0 + 0.1; c += 0.025) {
          const cost = evalCost(a, b, c);
          if (cost < best) {
            best = cost;
            bestA = [a, b, c];
          }
        }
      }
    }
    fingers.push([bestA[0], bestA[1], bestA[2], [0.04, 0.0, -0.03, -0.07][fi]!]);
  }

  // Daumen: Spitze auf der Innenseite des Griffs, nahe am Zeigefinger (Richtung Parierstange)
  const target = new THREE.Vector3(-0.028, -0.004, -0.034)
    .applyAxisAngle(new THREE.Vector3(1, 0, 0), MOUNT_ROT_X)
    .add(MOUNT_POS);
  const tdef = DIGITS[4]!;
  const Y = new THREE.Vector3(0, 1, 0);
  const q0 = new THREE.Quaternion();
  const q1 = new THREE.Quaternion();
  const qa = new THREE.Quaternion();
  const base = new THREE.Vector3(...tdef.base);
  const rest = new THREE.Vector3(...tdef.dir);
  const cur = new THREE.Vector3();
  const Q = new THREE.Vector3();
  let bestT = Infinity;
  let bestTh: [number, number, number, number] = [0, 0, 0, 0];
  for (let u = -0.6; u <= 1.2; u += 0.09) {
    for (let a = -0.6; a <= 1.4; a += 0.09) {
      for (let b = 0; b <= 1.3; b += 0.1) {
        const c = b * 0.9;
        q0.setFromAxisAngle(Y, u);
        qa.setFromAxisAngle(THUMB_FLEX_AXIS_R, a);
        q0.multiply(qa);
        Q.copy(base);
        let cost = 0;
        q1.copy(q0);
        for (let s = 0; s < 3; s++) {
          if (s === 1) q1.multiply(qa.setFromAxisAngle(THUMB_FLEX_AXIS_R, b));
          if (s === 2) q1.multiply(qa.setFromAxisAngle(THUMB_FLEX_AXIS_R, c));
          cur.copy(rest).applyQuaternion(q1);
          M.copy(Q).addScaledVector(cur, tdef.len[s]! * 0.5);
          Q.addScaledVector(cur, tdef.len[s]!);
          for (const pt of [M, Q]) {
            const dist = distToAxis(pt);
            const rr = GRIP_R + 0.001;
            if (dist < rr) cost += 40 * (rr - dist) ** 2;
          }
        }
        cost += Q.distanceToSquared(target);
        if (cost < bestT) {
          bestT = cost;
          bestTh = [u, a, b, c];
        }
      }
    }
  }
  gripCache = { fingers, thumb: bestTh };
  return gripCache;
}

// ------------------------------------------------------------------ Anwenden (ohne Speicheranforderung)

const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _X = new THREE.Vector3(1, 0, 0);
const _Yax = new THREE.Vector3(0, 1, 0);

export class HandRig {
  private readonly flexAxis: THREE.Vector3;
  private readonly thumbAxis: THREE.Vector3;
  private readonly sgn: number;

  constructor(
    private readonly bones: THREE.Bone[][], // [digit][seg], Reihenfolge wie DIGITS
    side: 'L' | 'R',
  ) {
    this.sgn = side === 'R' ? 1 : -1;
    this.flexAxis = FLEX_AXIS_R.clone();
    this.thumbAxis = THUMB_FLEX_AXIS_R.clone();
    if (side === 'L') {
      // Spiegelung an der YZ-Ebene: Achsen-Vektoren (Pseudovektoren) -> (x, -y, -z)
      this.flexAxis.set(this.flexAxis.x, -this.flexAxis.y, -this.flexAxis.z);
      this.thumbAxis.set(this.thumbAxis.x, -this.thumbAxis.y, -this.thumbAxis.z);
    }
  }

  /**
   * Pose a und b ueberblenden (t), dazu zusaetzliche Beugung aller Langfinger (extraFlex)
   * und des Daumens (extraThumb).
   */
  apply(a: HandPose, b: HandPose, t: number, extraFlex: number, extraThumb: number): void {
    for (let f = 0; f < 4; f++) {
      const pa = a.fingers[f]!;
      const pb = b.fingers[f]!;
      const bones = this.bones[f]!;
      const k = extraFlex * (0.8 + f * 0.1);
      const spread = pa[3] + (pb[3] - pa[3]) * t;
      _qa.setFromAxisAngle(_X, spread);
      _qb.setFromAxisAngle(this.flexAxis, pa[0] + (pb[0] - pa[0]) * t + k);
      bones[0]!.quaternion.multiplyQuaternions(_qa, _qb);
      bones[1]!.quaternion.setFromAxisAngle(this.flexAxis, pa[1] + (pb[1] - pa[1]) * t + k * 1.2);
      bones[2]!.quaternion.setFromAxisAngle(this.flexAxis, pa[2] + (pb[2] - pa[2]) * t + k * 0.8);
    }
    const ta = a.thumb;
    const tb = b.thumb;
    const th = this.bones[4]!;
    _qa.setFromAxisAngle(_Yax, this.sgn * (ta[0] + (tb[0] - ta[0]) * t));
    _qb.setFromAxisAngle(this.thumbAxis, ta[1] + (tb[1] - ta[1]) * t + extraThumb * 0.5);
    th[0]!.quaternion.multiplyQuaternions(_qa, _qb);
    th[1]!.quaternion.setFromAxisAngle(this.thumbAxis, ta[2] + (tb[2] - ta[2]) * t + extraThumb);
    th[2]!.quaternion.setFromAxisAngle(this.thumbAxis, ta[3] + (tb[3] - ta[3]) * t + extraThumb);
  }
}
