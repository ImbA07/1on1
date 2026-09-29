import * as THREE from 'three';

// Skelett der Figur. Alle Positionen in Metern im Figurenraum (Ruheposition,
// Fuesse bei y = 0, Blick nach -Z, rechte Koerperseite = +X). Ruhelage: Arme haengen.

export const BONE_NAMES = [
  'hips',
  'spine',
  'chest',
  'neck',
  'head',
  'shoulderL',
  'upperArmL',
  'forearmL',
  'handL',
  'shoulderR',
  'upperArmR',
  'forearmR',
  'handR',
  'thighL',
  'shinL',
  'footL',
  'toeL',
  'thighR',
  'shinR',
  'footR',
  'toeR',
] as const;

export type BoneName = (typeof BONE_NAMES)[number];

type P3 = readonly [number, number, number];

const R: Record<string, { parent: string | null; p: P3 }> = {
  hips: { parent: null, p: [0, 0.975, 0] },
  spine: { parent: 'hips', p: [0, 1.08, 0.005] },
  chest: { parent: 'spine', p: [0, 1.25, 0.01] },
  neck: { parent: 'chest', p: [0, 1.5, 0.02] },
  head: { parent: 'neck', p: [0, 1.575, 0.015] },
  shoulderR: { parent: 'chest', p: [0.05, 1.44, 0.02] },
  upperArmR: { parent: 'shoulderR', p: [0.2, 1.43, 0.025] },
  forearmR: { parent: 'upperArmR', p: [0.2, 1.14, 0.03] },
  handR: { parent: 'forearmR', p: [0.2, 0.885, 0.03] },
  thighR: { parent: 'hips', p: [0.095, 0.925, 0] },
  shinR: { parent: 'thighR', p: [0.095, 0.505, 0] },
  footR: { parent: 'shinR', p: [0.095, 0.095, 0] },
  toeR: { parent: 'footR', p: [0.095, 0.03, -0.1] },
};
for (const k of Object.keys(R)) {
  if (!k.endsWith('R')) continue;
  const v = R[k]!;
  R[k.slice(0, -1) + 'L'] = {
    parent: v.parent && v.parent.endsWith('R') ? v.parent.slice(0, -1) + 'L' : v.parent,
    p: [-v.p[0], v.p[1], v.p[2]],
  };
}

export const REST: Readonly<Record<string, { parent: string | null; p: P3 }>> = R;

export function restPos(name: string): THREE.Vector3 {
  const r = REST[name];
  if (!r) throw new Error('Unbekannter Knochen ' + name);
  return new THREE.Vector3(r.p[0], r.p[1], r.p[2]);
}

// Laengen fuer die Bein-IK
export const THIGH_LEN = REST.thighR!.p[1] - REST.shinR!.p[1];
export const SHIN_LEN = REST.shinR!.p[1] - REST.footR!.p[1];
export const ANKLE_H = REST.footR!.p[1];

/** Sekundaer-Ketten (Umhang, Waffenrock, Helmbusch, Scheide): Ruhepunkte im Figurenraum. */
export interface ChainDef {
  name: string;
  anchor: BoneName;
  /** Punkte je Spalte; Punkt 0 ist fest am Anker */
  columns: P3[][];
}

function capeColumn(x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, rows: number): P3[] {
  const pts: P3[] = [];
  for (let i = 0; i <= rows; i++) {
    const t = i / rows;
    const e = Math.pow(t, 0.8);
    pts.push([x0 + (x1 - x0) * e, y0 + (y1 - y0) * t, z0 + (z1 - z0) * e]);
  }
  return pts;
}

export const CAPE_ROWS = 4;

/** Waffenrock-Bahn: vorne (side -1) oder hinten (+1), Punkte von der Taille abwaerts. */
function tabColumn(x: number, side: number): P3[] {
  const ys = side < 0 ? [1.066, 0.9, 0.71, 0.48] : [1.066, 0.92, 0.76, 0.58];
  const zf = [-0.146, -0.19, -0.2, -0.19];
  const zb = [0.128, 0.163, 0.178, 0.182];
  const zs = side < 0 ? zf : zb;
  const k = side < 0 ? 0.8 : -0.9;
  return ys.map((y, i) => [x * (1 + i * 0.12), y, zs[i]! + k * x * x] as const);
}
export const CHAINS: ChainDef[] = [
  {
    name: 'cape',
    anchor: 'chest',
    columns: [
      capeColumn(-0.2, 0.1, -0.29, 0.2, 1.43, 0.42, CAPE_ROWS),
      capeColumn(0, 0.152, 0, 0.27, 1.43, 0.42, CAPE_ROWS),
      capeColumn(0.2, 0.1, 0.29, 0.2, 1.43, 0.42, CAPE_ROWS),
    ],
  },
  {
    name: 'tabF',
    anchor: 'hips',
    columns: [-1, 1].map((sx) => tabColumn(sx * 0.075, -1)),
  },
  {
    name: 'tabB',
    anchor: 'hips',
    columns: [-1, 1].map((sx) => tabColumn(sx * 0.08, 1)),
  },
  {
    name: 'plume',
    anchor: 'head',
    columns: [
      [
        [0, 1.895, 0.05],
        [0, 1.965, 0.115],
        [0, 1.965, 0.22],
        [0, 1.875, 0.32],
      ],
    ],
  },
  {
    name: 'scab',
    anchor: 'hips',
    columns: [
      [
        [-0.212, 0.92, -0.005],
        [-0.238, 0.15, 0.31],
      ],
    ],
  },
];

export function chainBoneName(chain: string, col: number, seg: number): string {
  return `${chain}_${col}_${seg}`;
}

export interface Rig {
  bones: Record<string, THREE.Bone>;
  list: THREE.Bone[];
  index: Map<string, number>;
  rootBone: THREE.Bone;
}

/** Erzeugt alle Knochen in Ruhelage (Rotation 0). */
export function createRig(): Rig {
  const bones: Record<string, THREE.Bone> = {};
  const list: THREE.Bone[] = [];
  const index = new Map<string, number>();
  const abs = new Map<string, THREE.Vector3>();
  const make = (name: string, parent: string | null, p: THREE.Vector3) => {
    const b = new THREE.Bone();
    b.name = name;
    const pp = parent ? abs.get(parent)! : new THREE.Vector3();
    b.position.copy(p).sub(pp);
    abs.set(name, p.clone());
    if (parent) bones[parent]!.add(b);
    bones[name] = b;
    index.set(name, list.length);
    list.push(b);
  };
  for (const name of BONE_NAMES) {
    const r = REST[name]!;
    make(name, r.parent, restPos(name));
  }
  for (const ch of CHAINS) {
    ch.columns.forEach((col, ci) => {
      for (let s = 0; s < col.length - 1; s++) {
        const parent = s === 0 ? ch.anchor : chainBoneName(ch.name, ci, s - 1);
        const p = col[s]!;
        make(chainBoneName(ch.name, ci, s), parent, new THREE.Vector3(p[0], p[1], p[2]));
      }
    });
  }
  // Drehreihenfolgen: Rumpf erst Gieren, Arme erst Verdrehen
  for (const n of ['hips', 'spine', 'chest', 'neck', 'head']) bones[n]!.rotation.order = 'YXZ';
  for (const n of ['upperArmL', 'upperArmR', 'shoulderL', 'shoulderR']) bones[n]!.rotation.order = 'XZY';
  return { bones, list, index, rootBone: bones.hips! };
}
