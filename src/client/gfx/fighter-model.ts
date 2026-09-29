import * as THREE from 'three';
import { box, extrude, loft, mirrorX, octa, sheet, smoothstep, sphere, tube, v3, xf, type Ring } from './fighter-geo.js';
import { rigid, vblend, type FighterMeshBuilder, type PieceOpts, type WeightFn, type Weights } from './fighter-mesh.js';
import { CHAINS, chainBoneName, restPos } from './fighter-rig.js';

// Modell der Figur, komplett prozedural. Masse in Metern, Figurenraum (siehe fighter-rig.ts).
// Standard ist die schwere Ruestung. Jede Ruestungsgruppe (helmet, torso, ...) wird
// zu eigenen Meshes zusammengefasst, damit man sie spaeter einzeln tauschen kann.

export type ArmorTier = 'light' | 'medium' | 'heavy';
export const ARMOR_GROUPS = ['body', 'helmet', 'torso', 'shoulders', 'arms', 'legs', 'tabard', 'cape'] as const;
export type ArmorGroup = (typeof ARMOR_GROUPS)[number];

const C = {
  steel: 0xaab0b8,
  steelLame: 0x969ca5,
  steelDark: 0x7a8088,
  brass: 0xb38d4e,
  bronze: 0x9a7240,
  leatherDark: 0x3a2518,
  leather: 0x5c3b23,
  leatherTan: 0x85603c,
  gambeson: 0x94825e,
  gambesonDark: 0x6f5f45,
  chausses: 0x3f352b,
  skin: 0xc68e69,
  skinDark: 0xa8724f,
  hair: 0x3a281b,
  cream: 0xe6d8ae,
  lining: 0x2f2621,
  chain: 0xa9aeb5,
  sole: 0x24190f,
  lip: 0x6a3428,
  eye: 0x241812,
};

interface Ctx {
  b: FighterMeshBuilder;
  tier: ArmorTier;
  accent: THREE.Color;
  accentCape: THREE.Color;
  accentLight: THREE.Color;
}

type Side = 'R' | 'L';

// ------------------------------------------------------------------ Helfer

const METAL = { mat: 'metal', jitter: 0.05, wear: 0.55, cavity: 0.4 } as const;
const BRASS = { mat: 'metal', jitter: 0.06, wear: 0.5, cavity: 0.45 } as const;
const LEATHER = { mat: 'leather', jitter: 0.06, wear: 0.35, cavity: 0.35 } as const;
const CLOTH = { mat: 'cloth', jitter: 0.04, wear: 0.12, cavity: 0.35 } as const;
const CHAIN = { mat: 'chain', jitter: 0.03, wear: 0.2, cavity: 0.3 } as const;

/** Rechte Seite bauen und gespiegelt links hinzufuegen. */
function both(c: Ctx, geo: THREE.BufferGeometry, opts: (s: Side) => PieceOpts): void {
  const left = mirrorX(geo);
  c.b.add(geo, opts('R'));
  c.b.add(left, opts('L'));
}

function weights3(a: string, b: string, cc: string, y0: number, y1: number, y2: number, y3: number): WeightFn {
  return (p) => {
    const t1 = smoothstep(y0, y1, p.y);
    const t2 = smoothstep(y2, y3, p.y);
    return [
      [a, 1 - t1],
      [b, t1 * (1 - t2)],
      [cc, t1 * t2],
    ];
  };
}

/** Rock/Kettensaum: oben Becken, unten zunehmend den Oberschenkeln folgend. */
function skirtW(yTop: number, yBot: number, follow = 0.85): WeightFn {
  return (p) => {
    const d = smoothstep(yTop, yBot, p.y) * follow;
    const side = Math.max(-1, Math.min(1, p.x / 0.1));
    const wr = (1 + side) / 2;
    return [
      ['hips', 1 - d],
      ['thighR', d * wr],
      ['thighL', d * (1 - wr)],
    ];
  };
}

function footW(S: Side): WeightFn {
  return (p) => {
    const t = smoothstep(-0.075, -0.115, p.z);
    return [
      ['foot' + S, 1 - t],
      ['toe' + S, t],
    ];
  };
}

/** Starr am naechsten Segment einer einspaltigen Kette. */
function chainW(name: string): WeightFn {
  const def = CHAINS.find((d) => d.name === name)!;
  const pts = def.columns[0]!.map((q) => v3(q[0], q[1], q[2]));
  const ab = new THREE.Vector3();
  const ap = new THREE.Vector3();
  const cache = new Map<number, Weights>();
  return (p) => {
    let best = 0;
    let bestD = Infinity;
    for (let s = 0; s < pts.length - 1; s++) {
      ab.subVectors(pts[s + 1]!, pts[s]!);
      ap.subVectors(p, pts[s]!);
      const t = Math.max(0, Math.min(1, ap.dot(ab) / ab.lengthSq()));
      const d = ap.addScaledVector(ab, -t).lengthSq();
      if (d < bestD - 1e-9) {
        bestD = d;
        best = s;
      }
    }
    let w = cache.get(best);
    if (!w) cache.set(best, (w = [[chainBoneName(name, 0, best), 1]]));
    return w;
  };
}

/** Tuch aus mehreren Spalten: Zeile nach Hoehe, quer zwischen benachbarten Spalten ueberblendet. */
function gridW(name: string): WeightFn {
  const def = CHAINS.find((d) => d.name === name)!;
  const cols = def.columns;
  const n = cols.length;
  const M = cols[0]!;
  const rows = M.length - 1;
  return (p) => {
    let s = 0;
    while (s < rows - 1 && p.y < M[s + 1]![1]) s++;
    const y0 = M[s]![1];
    const y1 = M[s + 1]![1];
    const t = Math.max(0, Math.min(1, (y0 - p.y) / (y0 - y1)));
    const xs = cols.map((c) => c[s]![0] + (c[s + 1]![0] - c[s]![0]) * t);
    if (n === 1 || p.x <= xs[0]!) return [[chainBoneName(name, 0, s), 1]];
    if (p.x >= xs[n - 1]!) return [[chainBoneName(name, n - 1, s), 1]];
    let c = 0;
    while (c < n - 2 && p.x > xs[c + 1]!) c++;
    const u = (p.x - xs[c]!) / (xs[c + 1]! - xs[c]!);
    return [
      [chainBoneName(name, c, s), 1 - u],
      [chainBoneName(name, c + 1, s), u],
    ];
  };
}

function capeW(): WeightFn {
  return gridW('cape');
}

function rivetsOnRing(r: Ring, thetas: number[], out: number, size = 0.0055): THREE.BufferGeometry[] {
  const list: THREE.BufferGeometry[] = [];
  const p = new THREE.Vector3();
  for (const th of thetas) {
    const rr: Ring = { ...r, rx: r.rx + out, rzF: (r.rzF ?? r.rz ?? r.rx) + out, rzB: (r.rzB ?? r.rz ?? r.rx) + out };
    // ringPoint inline (vermeidet Import-Zyklus)
    const s = Math.sin(th);
    const cc = Math.cos(th);
    p.set((rr.cx ?? 0) + rr.rx * s, rr.y, (rr.cz ?? 0) - (cc >= 0 ? rr.rzF! : rr.rzB!) * cc);
    list.push(xf(octa(size), { t: [p.x, p.y, p.z], s: [1, 0.8, 1] }));
  }
  return list;
}

function range(a: number, b: number, n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(a + ((b - a) * i) / Math.max(1, n - 1));
  return out;
}

function mergeList(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  // kleine Teile fuer einen add()-Aufruf zusammenfassen
  const pos: number[] = [];
  const uv: number[] = [];
  for (const g of list) {
    const p = g.getAttribute('position').array as Float32Array;
    const u = g.getAttribute('uv') as THREE.BufferAttribute | undefined;
    for (let i = 0; i < p.length; i++) pos.push(p[i]!);
    const n = p.length / 3;
    if (u) for (let i = 0; i < n * 2; i++) uv.push((u.array as Float32Array)[i]!);
    else for (let i = 0; i < n * 2; i++) uv.push(NaN);
    g.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

// ------------------------------------------------------------------ Kopf / Gesicht

function buildHead(c: Ctx): void {
  const cz = 0.008;
  const rings: Ring[] = [
    { y: 1.45, rx: 0.058, rzF: 0.052, rzB: 0.058, cz: 0.02 },
    { y: 1.53, rx: 0.056, rzF: 0.05, rzB: 0.056, cz: 0.02 },
    { y: 1.548, rx: 0.058, rzF: 0.074, rzB: 0.06, cz: 0.012 },
    { y: 1.566, rx: 0.065, rzF: 0.097, rzB: 0.076, cz, n: 2.3 },
    { y: 1.6, rx: 0.073, rzF: 0.1, rzB: 0.092, cz, n: 2.3 },
    { y: 1.636, rx: 0.078, rzF: 0.101, rzB: 0.1, cz },
    { y: 1.676, rx: 0.08, rzF: 0.098, rzB: 0.104, cz },
    { y: 1.716, rx: 0.079, rzF: 0.097, rzB: 0.105, cz },
    { y: 1.76, rx: 0.072, rzF: 0.086, rzB: 0.1, cz },
    { y: 1.795, rx: 0.055, rzF: 0.062, rzB: 0.076, cz },
  ];
  const head = loft(rings, {
    segs: 18,
    apexTop: v3(0, 1.815, 0.016),
    deform: (p, th, i) => {
      const a = Math.abs(Math.atan2(Math.sin(th), Math.cos(th)));
      if (i === 6 && a > 0.2 && a < 0.5) p.z += 0.01; // Augenhoehlen
      if (i === 6 && a < 0.1) p.z -= 0.004; // Nasenwurzel
      if (i === 5 && a > 0.55 && a < 0.9) p.x += 0.006 * Math.sign(p.x); // Wangenknochen
      if (i === 3 && a > 0.9 && a < 1.3) p.x += 0.007 * Math.sign(p.x); // kantiger Kiefer
      if ((i === 3 || i === 2) && a < 0.2) p.z -= 0.006; // Kinn
    },
  });
  c.b.add(head, {
    mat: 'skin',
    color: C.skin,
    group: 'body',
    weights: vblend('neck', 'head', 1.535, 1.585),
    jitter: 0.03,
    wear: 0.15,
    cavity: 0.35,
    colorFn: (cen, _n, out) => {
      const ax = Math.abs(cen.x);
      if (cen.z < -0.075 && cen.y > 1.668 && cen.y < 1.694 && ax > 0.016 && ax < 0.056) out.setHex(0xa06a48);
    },
  });

  // Nase
  const nose = new THREE.BufferGeometry();
  {
    const T = v3(0, 1.692, -0.1);
    const P = v3(0, 1.634, -0.127);
    const Lb = v3(-0.018, 1.632, -0.102);
    const Rb = v3(0.018, 1.632, -0.102);
    const Bc = v3(0, 1.628, -0.108);
    const pos = [T, P, Lb, T, Rb, P, P, Lb, Bc, P, Bc, Rb, Lb, Bc, Rb];
    const refs = [v3(-1, 0.3, -1), v3(1, 0.3, -1), v3(-0.3, -1, -0.5), v3(0.3, -1, -0.5), v3(0, -1, 0)];
    const arr: number[] = [];
    for (let t = 0; t < 5; t++) {
      const a = pos[t * 3]!;
      let b = pos[t * 3 + 1]!;
      let cc = pos[t * 3 + 2]!;
      const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(cc, a));
      if (n.dot(refs[t]!) < 0) [b, cc] = [cc, b];
      arr.push(a.x, a.y, a.z, b.x, b.y, b.z, cc.x, cc.y, cc.z);
    }
    nose.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
  }
  c.b.add(nose, { mat: 'skin', color: C.skin, group: 'body', bone: 'head', jitter: 0.02, wear: 0.2 });

  // Brauenwulst
  const brow = loft(
    [
      { y: 1.694, rx: 0.082, rzF: 0.1, rzB: 0.1, cz },
      { y: 1.717, rx: 0.082, rzF: 0.104, rzB: 0.1, cz },
    ],
    { segs: 8, arc: [-0.8, 0.8], thickness: 0.012 },
  );
  c.b.add(brow, { mat: 'skin', color: C.skin, group: 'body', bone: 'head', jitter: 0.02, wear: 0.15 });

  // Augen, Brauen, Mund, Bart, Ohren
  const hair: THREE.BufferGeometry[] = [];
  const dark: THREE.BufferGeometry[] = [];
  for (const s of [1, -1]) {
    hair.push(xf(box(0.044, 0.01, 0.014), { t: [s * 0.036, 1.711, -0.101], r: [0.15, 0, s * 0.17] }));
    dark.push(xf(box(0.019, 0.0105, 0.005), { t: [s * 0.034, 1.679, -0.0925], r: [0, s * 0.25, 0] }));
  }
  c.b.add(mergeList(dark), { mat: 'skin', color: C.eye, group: 'body', bone: 'head', jitter: 0.02, noAO: true });
  c.b.add(xf(box(0.026, 0.0045, 0.004), { t: [0, 1.596, -0.1015] }), { mat: 'skin', color: C.lip, group: 'body', bone: 'head', jitter: 0.02, noAO: true });

  const beard = loft(
    [
      { y: 1.522, rx: 0.048, rzF: 0.084, rzB: 0.05, cz },
      { y: 1.548, rx: 0.067, rzF: 0.109, rzB: 0.068, cz },
      { y: 1.577, rx: 0.075, rzF: 0.111, rzB: 0.082, cz },
      { y: 1.612, rx: 0.081, rzF: 0.108, rzB: 0.096, cz },
    ],
    {
      segs: 14,
      arc: [-2.05, 2.05],
      thickness: 0.006,
      deform: (p, th, i) => {
        const a = Math.abs(th);
        if (i === 3 && a < 0.55) p.y = 1.586;
        if (i === 3 && a > 1.25) p.y += 0.032;
        if (i === 0 && a < 0.3) p.y -= 0.01;
      },
    },
  );
  hair.push(beard);
  const stache = loft(
    [
      { y: 1.603, rx: 0.07, rzF: 0.11, rzB: 0.1, cz },
      { y: 1.617, rx: 0.074, rzF: 0.109, rzB: 0.1, cz },
    ],
    {
      segs: 8,
      arc: [-0.62, 0.62],
      thickness: 0.009,
      deform: (p, th) => {
        if (Math.abs(th) > 0.3) p.y -= 0.012 * (Math.abs(th) - 0.3) * 3;
      },
    },
  );
  hair.push(stache);
  c.b.add(mergeList(hair), { mat: 'skin', color: C.hair, group: 'body', bone: 'head', jitter: 0.08, wear: 0.1, cavity: 0.4 });

  const ears: THREE.BufferGeometry[] = [];
  for (const s of [1, -1]) ears.push(xf(sphere(0.03, 6, 4), { t: [s * 0.081, 1.662, 0.014], s: [0.35, 1, 0.62], r: [0, s * 0.25, 0] }));
  c.b.add(mergeList(ears), { mat: 'skin', color: C.skinDark, group: 'body', bone: 'head', jitter: 0.03 });
}

// ------------------------------------------------------------------ Grundkoerper

function torsoW(): WeightFn {
  return weights3('hips', 'spine', 'chest', 1.0, 1.1, 1.16, 1.26);
}

function buildBaseBody(c: Ctx): void {
  const quilted = c.tier === 'light';
  // Gambeson (Rumpf). Bei schwerer Ruestung fast ganz verdeckt, daher dort grob.
  const rings: Ring[] = [
    { y: 0.93, rx: 0.15, rzF: 0.125, rzB: 0.12 },
    { y: 1.0, rx: 0.142, rzF: 0.12, rzB: 0.112 },
    { y: 1.08, rx: 0.138, rzF: 0.118, rzB: 0.105 },
    { y: 1.18, rx: 0.148, rzF: 0.138, rzB: 0.108 },
    { y: 1.28, rx: 0.152, rzF: 0.15, rzB: 0.112 },
    { y: 1.36, rx: 0.152, rzF: 0.142, rzB: 0.115 },
    { y: 1.43, rx: 0.14, rzF: 0.12, rzB: 0.112 },
    { y: 1.475, rx: 0.1, rzF: 0.085, rzB: 0.09 },
    { y: 1.505, rx: 0.068, rzF: 0.062, rzB: 0.068 },
  ].map((r) => ({ ...r, cz: 0.005, n: 2.2 }));
  const fine: Ring[] = [];
  if (quilted) {
    // Steppnaehte: zusaetzliche, leicht eingeschnuerte Ringe
    for (let i = 0; i < rings.length - 1; i++) {
      const a = rings[i]!;
      const b = rings[i + 1]!;
      fine.push(a);
      const m = (k: keyof Ring) => ((a[k] as number) + (b[k] as number)) / 2;
      fine.push({ ...a, y: m('y'), rx: m('rx') + 0.004, rzF: m('rzF') + 0.004, rzB: m('rzB') + 0.004 });
    }
    fine.push(rings[rings.length - 1]!);
  }
  const torso = loft(quilted ? fine : rings, {
    segs: quilted ? 28 : 12,
    deform: quilted
      ? (p, th) => {
          const k = Math.abs(Math.sin(th * 7));
          const d = 0.004 * (1 - k);
          p.x -= Math.sin(th) * d;
          p.z += Math.cos(th) * d;
        }
      : undefined,
  });
  c.b.add(torso, { ...CLOTH, color: quilted ? C.gambeson : C.gambesonDark, group: 'body', weights: torsoW() });

  // Beinlinge
  const thigh = loft(
    [
      { y: 0.97, rx: 0.1, rzF: 0.1, rzB: 0.105, cx: 0.088 },
      { y: 0.86, rx: 0.09, rzF: 0.09, rzB: 0.095, cx: 0.097 },
      { y: 0.7, rx: 0.073, rzF: 0.075, rzB: 0.078, cx: 0.1 },
      { y: 0.57, rx: 0.061, rzF: 0.062, rzB: 0.064, cx: 0.098 },
      { y: 0.5, rx: 0.057, rzF: 0.06, rzB: 0.06, cx: 0.096 },
    ],
    { segs: 10 },
  );
  both(c, thigh, (S) => ({
    ...CLOTH,
    color: C.chausses,
    group: 'body',
    weights: (p) => {
      const tk = smoothstep(0.47, 0.55, p.y);
      const th = smoothstep(0.88, 0.98, p.y) * 0.5;
      return [
        ['shin' + S, 1 - tk],
        ['thigh' + S, tk * (1 - th)],
        ['hips', tk * th],
      ];
    },
  }));
  const shin = loft(
    [
      { y: 0.5, rx: 0.056, rzF: 0.058, rzB: 0.06, cx: 0.096 },
      { y: 0.42, rx: 0.055, rzF: 0.05, rzB: 0.07, cx: 0.096, cz: 0.004 },
      { y: 0.3, rx: 0.05, rzF: 0.046, rzB: 0.062, cx: 0.096, cz: 0.004 },
      { y: 0.18, rx: 0.039, rzF: 0.042, rzB: 0.043, cx: 0.096 },
      { y: 0.12, rx: 0.037, rzF: 0.04, rzB: 0.04, cx: 0.096 },
    ],
    { segs: 10 },
  );
  both(c, shin, (S) => ({ ...CLOTH, color: C.chausses, group: 'body', bone: 'shin' + S }));

  buildBoots(c);
}

/** Fussform als Loft entlang der Fussachse (Ferse +Z, Spitze -Z). */
function footLoft(sections: [number, number, number][], segs: number, arc?: [number, number], thickness?: number, grow = 0): THREE.BufferGeometry {
  // sections: [z, halbe Breite, Hoehe]
  const rings: Ring[] = sections.map(([z, w, h]) => ({ y: -z, rx: w + grow, rzF: h / 2 + grow * 0.5, rzB: h / 2 + grow, cz: h / 2, n: 2.4 }));
  const g = loft(rings, {
    segs,
    arc,
    thickness,
    capTop: !arc,
    capBottom: !arc,
    deform: (p) => {
      if (p.z < 0.0) p.z = 0.0; // flache Sohle
    },
  });
  // Loft-Y -> Fuss -Z, Loft-Z -> Fuss +Y
  return xf(g, { r: [-Math.PI / 2, 0, 0] });
}

function buildBoots(c: Ctx): void {
  const x = 0.095;
  const foot = footLoft(
    [
      [0.083, 0.028, 0.055],
      [0.066, 0.041, 0.1],
      [0.02, 0.046, 0.125],
      [-0.035, 0.049, 0.09],
      [-0.095, 0.051, 0.063],
      [-0.145, 0.043, 0.048],
      [-0.178, 0.022, 0.032],
    ],
    10,
  );
  xf(foot, { t: [x, 0, 0] });
  both(c, foot, (S) => ({
    ...LEATHER,
    color: C.leather,
    group: 'body',
    weights: footW(S),
    colorFn: (cen, _n, out) => {
      if (cen.y < 0.016) out.setHex(C.sole);
    },
  }));
  // Schaft
  const shaft = loft(
    [
      { y: 0.08, rx: 0.05, rzF: 0.056, rzB: 0.056, cx: x },
      { y: 0.18, rx: 0.045, rzF: 0.049, rzB: 0.052, cx: x },
      { y: 0.25, rx: 0.049, rzF: 0.052, rzB: 0.06, cx: x, cz: 0.004 },
      { y: 0.262, rx: 0.056, rzF: 0.058, rzB: 0.066, cx: x, cz: 0.004 },
      { y: 0.285, rx: 0.056, rzF: 0.058, rzB: 0.066, cx: x, cz: 0.004 },
    ],
    { segs: 10, thickness: 0.004 },
  );
  both(c, shaft, (S) => ({ ...LEATHER, color: C.leather, group: 'body', weights: vblend('foot' + S, 'shin' + S, 0.1, 0.16) }));
  // Riemen mit Schnallen (Knoechel)
  const strap = loft(
    [
      { y: 0.105, rx: 0.053, rzF: 0.059, rzB: 0.059, cx: x },
      { y: 0.125, rx: 0.052, rzF: 0.058, rzB: 0.058, cx: x },
    ],
    { segs: 10, thickness: 0.004 },
  );
  both(c, strap, (S) => ({ ...LEATHER, color: C.leatherDark, group: 'body', bone: 'foot' + S }));
  const buckle = mergeList([xf(box(0.006, 0.026, 0.02), { t: [x + 0.056, 0.115, 0.01] }), xf(box(0.004, 0.006, 0.026), { t: [x + 0.058, 0.115, 0.01] })]);
  both(c, buckle, (S) => ({ ...BRASS, color: C.brass, group: 'body', bone: 'foot' + S }));
}

// ------------------------------------------------------------------ Faeuste

function buildFist(c: Ctx, plated: boolean, group: ArmorGroup): void {
  const H = restPos('handR');
  const at = (x: number, y: number, z: number): [number, number, number] => [H.x + x, H.y + y, H.z + z];
  const core = xf(box(0.052, 0.082, 0.09), { t: at(0.002, -0.068, 0) });
  const leatherParts = [core];
  const metalParts: THREE.BufferGeometry[] = [];
  const fingerMat = plated ? metalParts : leatherParts;
  for (const fz of [-0.0335, -0.011, 0.0115, 0.0335]) {
    fingerMat.push(xf(box(0.036, 0.016, 0.0195), { t: at(0.005, -0.113, fz) }));
    fingerMat.push(xf(box(0.016, 0.032, 0.0195), { t: at(-0.025, -0.096, fz) }));
    fingerMat.push(xf(box(0.018, 0.02, 0.019), { t: at(0.024, -0.103, fz), r: [0, 0, 0.6] }));
  }
  const thumb = tube([v3(...at(0.016, -0.035, -0.036)), v3(...at(-0.004, -0.056, -0.053)), v3(...at(-0.026, -0.072, -0.05))], [
    [0.011, 0.011],
    [0.01, 0.01],
    [0.009, 0.009],
  ], { segs: 5, capEnd: true, capStart: true });
  fingerMat.push(thumb);
  if (plated) {
    metalParts.push(xf(box(0.012, 0.036, 0.094), { t: at(0.031, -0.044, 0), r: [0, 0, -0.08] }));
    metalParts.push(xf(box(0.012, 0.034, 0.096), { t: at(0.033, -0.077, 0), r: [0, 0, 0.1] }));
    // Stulpe (Sanduhr-Form)
    metalParts.push(
      loft(
        [
          { y: H.y + 0.03, rx: 0.047, rz: 0.049, cx: H.x, cz: H.z },
          { y: H.y - 0.005, rx: 0.054, rz: 0.057, cx: H.x, cz: H.z },
          { y: H.y - 0.032, rx: 0.064, rz: 0.066, cx: H.x + 0.004, cz: H.z },
        ],
        { segs: 12, thickness: 0.004 },
      ),
    );
    both(c, mergeList(metalParts), (S) => ({ ...METAL, color: C.steel, group, bone: 'hand' + S }));
  } else {
    leatherParts.push(
      loft(
        [
          { y: H.y + 0.035, rx: 0.046, rz: 0.048, cx: H.x, cz: H.z },
          { y: H.y - 0.02, rx: 0.052, rz: 0.054, cx: H.x + 0.002, cz: H.z },
        ],
        { segs: 10, thickness: 0.004 },
      ),
    );
  }
  both(c, mergeList(leatherParts), (S) => ({ ...LEATHER, color: plated ? C.leatherDark : C.leatherTan, group, bone: 'hand' + S }));
}

// ------------------------------------------------------------------ Schwere Ruestung

function buildBascinet(c: Ctx): void {
  const cz = 0.012;
  const dome = loft(
    [
      { y: 1.703, rx: 0.102, rzF: 0.114, rzB: 0.12, cz },
      { y: 1.745, rx: 0.1, rzF: 0.111, rzB: 0.12, cz },
      { y: 1.785, rx: 0.091, rzF: 0.099, rzB: 0.114, cz: cz + 0.002 },
      { y: 1.825, rx: 0.073, rzF: 0.079, rzB: 0.1, cz: cz + 0.008 },
      { y: 1.858, rx: 0.046, rzF: 0.048, rzB: 0.07, cz: cz + 0.018 },
      { y: 1.882, rx: 0.02, rzF: 0.019, rzB: 0.038, cz: cz + 0.03 },
    ],
    { segs: 20, apexTop: v3(0, 1.904, 0.056), thickness: 0.005 },
  );
  const band = loft(
    [
      { y: 1.56, rx: 0.1, rzF: 0.103, rzB: 0.113, cz },
      { y: 1.63, rx: 0.103, rzF: 0.109, rzB: 0.119, cz },
      { y: 1.706, rx: 0.1025, rzF: 0.1145, rzB: 0.1205, cz },
    ],
    {
      segs: 16,
      arc: [0.78, Math.PI * 2 - 0.78],
      thickness: 0.005,
      deform: (p, th, i) => {
        if (i === 0) {
          const a = Math.abs(Math.atan2(Math.sin(th), Math.cos(th)));
          p.y += 0.035 * (1 - smoothstep(0.8, 1.9, a)); // Wangen enden hoeher
        }
      },
    },
  );
  c.b.add(dome, { ...METAL, color: C.steel, group: 'helmet', bone: 'head' });
  c.b.add(band, { ...METAL, color: C.steel, group: 'helmet', bone: 'head' });

  // Nasal
  const nasal = sheet(
    [0, 1],
    [0, 0.5, 1],
    (u, v) => {
      const w = 0.024 - v * 0.007;
      return v3((u - 0.5) * w, 1.722 - v * 0.098, -0.118 - v * 0.013 - Math.sin(v * Math.PI) * 0.003);
    },
    () => v3(0, 0.1, -1),
    0.006,
  );
  const brass: THREE.BufferGeometry[] = [];
  // Stirnband (Messing) rundum, Rand am Gesichtsausschnitt, Randleiste unten
  brass.push(
    loft(
      [
        { y: 1.697, rx: 0.106, rzF: 0.119, rzB: 0.125, cz },
        { y: 1.715, rx: 0.106, rzF: 0.119, rzB: 0.125, cz },
      ],
      { segs: 20, thickness: 0.004 },
    ),
  );
  brass.push(
    loft(
      [
        { y: 1.557, rx: 0.104, rzF: 0.107, rzB: 0.117, cz },
        { y: 1.575, rx: 0.104, rzF: 0.107, rzB: 0.117, cz },
      ],
      {
        segs: 14,
        arc: [0.8, Math.PI * 2 - 0.8],
        thickness: 0.004,
        deform: (p, th) => {
          const a = Math.abs(Math.atan2(Math.sin(th), Math.cos(th)));
          p.y += 0.035 * (1 - smoothstep(0.8, 1.9, a));
        },
      },
    ),
  );
  for (const s of [1, -1]) {
    const ex = Math.sin(0.78) * 0.103;
    const ez = -Math.cos(0.78) * 0.11 + cz;
    brass.push(tube([v3(s * ex, 1.703, ez), v3(s * ex * 1.01, 1.63, ez + 0.002), v3(s * ex * 0.99, 1.595, ez + 0.004)], [
      [0.0033, 0.0033],
      [0.0033, 0.0033],
      [0.0033, 0.0033],
    ], { segs: 4 }));
  }
  const studRing: Ring = { y: 1.566, rx: 0.104, rzF: 0.107, rzB: 0.117, cz };
  const studs = rivetsOnRing(studRing, range(1.0, Math.PI * 2 - 1.0, 13), 0.004, 0.0055);
  studs.forEach((g, i) => {
    const th = 1.0 + ((Math.PI * 2 - 2.0) * i) / 12;
    const a = Math.abs(Math.atan2(Math.sin(th), Math.cos(th)));
    xf(g, { t: [0, 0.035 * (1 - smoothstep(0.8, 1.9, a)), 0] });
  });
  brass.push(...studs);
  brass.push(...rivetsOnRing({ y: 1.706, rx: 0.106, rzF: 0.119, rzB: 0.125, cz }, [-1.2, -0.6, 0.6, 1.2, 2.2, 3.14, 4.08], 0.004, 0.005));
  // Halter fuer den Helmbusch
  brass.push(xf(tube([v3(0, 1.892, 0.04), v3(0, 1.915, 0.07)], [
    [0.012, 0.012],
    [0.014, 0.014],
  ], { segs: 6, capEnd: true }), {}));
  c.b.add(nasal, { ...METAL, color: C.steelDark, group: 'helmet', bone: 'head' });
  c.b.add(mergeList(brass), { ...BRASS, color: C.brass, group: 'helmet', bone: 'head' });

  // Helmbusch (Rosshaar) an einer Feder-Kette
  const plumeDef = CHAINS.find((d) => d.name === 'plume')!.columns[0]!;
  const strands: THREE.BufferGeometry[] = [];
  for (const [ox, oy, sc, tw] of [
    [0, 0, 1, 0],
    [0.017, -0.012, 0.8, 0.9],
    [-0.017, -0.012, 0.8, -0.9],
    [0, 0.014, 0.7, 2.1],
  ] as const) {
    const pts: THREE.Vector3[] = [];
    const radii: [number, number][] = [];
    for (let i = 0; i < plumeDef.length - 1; i++) {
      const a = v3(...(plumeDef[i] as [number, number, number]));
      const b = v3(...(plumeDef[i + 1] as [number, number, number]));
      for (let k = 0; k < 3; k++) pts.push(a.clone().lerp(b, k / 3));
    }
    pts.push(v3(...(plumeDef[plumeDef.length - 1] as [number, number, number])));
    const n = pts.length - 1;
    pts.forEach((p, i) => {
      const t = i / n;
      p.x += ox * Math.sin(t * Math.PI * 0.9);
      p.y += oy * t;
      const w = (0.012 + Math.sin(Math.min(1, t * 1.5) * Math.PI * 0.5) * 0.024 - t * t * 0.028) * sc;
      radii.push([Math.max(0.005, w * 0.75), Math.max(0.007, w * 1.3)]);
    });
    strands.push(
      tube(pts, radii, {
        segs: 7,
        capEnd: true,
        capStart: true,
        deform: (p, th, i) => {
          const t = i / n;
          p.y += Math.sin(th * 3 + i * 1.9 + tw) * 0.005 * (0.2 + t);
          p.x += Math.cos(th * 2 + i * 1.3 + tw) * 0.003 * t;
        },
      }),
    );
  }
  const plume = mergeList(strands);
  c.b.add(plume, {
    ...CLOTH,
    color: c.accentLight,
    group: 'helmet',
    weights: chainW('plume'),
    jitter: 0.1,
    wear: 0.2,
    noAO: true,
  });

  // Helmbrünne (Kettengeflecht) von Helmrand ueber Hals und Schultern
  const av = loft(
    [
      { y: 1.585, rx: 0.098, rzF: 0.103, rzB: 0.108, cz },
      { y: 1.53, rx: 0.101, rzF: 0.1, rzB: 0.11, cz },
      { y: 1.49, rx: 0.13, rzF: 0.116, rzB: 0.126, cz },
      { y: 1.458, rx: 0.183, rzF: 0.15, rzB: 0.152, cz },
      { y: 1.43, rx: 0.21, rzF: 0.168, rzB: 0.163, cz },
    ],
    {
      segs: 22,
      thickness: 0.006,
      deform: (p, th, i) => {
        const a = Math.abs(Math.atan2(Math.sin(th), Math.cos(th)));
        if (i === 0) {
          const f = 1 - smoothstep(0.3, 1.0, a);
          p.y -= 0.05 * f; // vorne unter dem Kinn
          p.z -= 0.012 * f;
        }
        if (i === 1 && a < 0.6) p.z -= 0.008;
        if (i >= 3) p.y += Math.sin(th * 11) * 0.004; // leicht gewellter Saum
      },
    },
  );
  c.b.add(av, {
    ...CHAIN,
    color: C.chain,
    group: 'helmet',
    weights: weights3('chest', 'neck', 'head', 1.45, 1.5, 1.53, 1.575),
  });
}

function buildCuirass(c: Ctx): void {
  const cz = 0.005;
  const ridge = (p: THREE.Vector3, th: number, amt: number) => {
    const a = Math.abs(Math.atan2(Math.sin(th), Math.cos(th)));
    p.z -= amt * Math.max(0, 1 - a / 0.32);
  };
  const rings: Ring[] = [
    { y: 1.02, rx: 0.141, rzF: 0.121, rzB: 0.112 },
    { y: 1.07, rx: 0.137, rzF: 0.124, rzB: 0.109 },
    { y: 1.14, rx: 0.147, rzF: 0.143, rzB: 0.114 },
    { y: 1.22, rx: 0.157, rzF: 0.161, rzB: 0.12 },
    { y: 1.3, rx: 0.161, rzF: 0.167, rzB: 0.126 },
    { y: 1.37, rx: 0.159, rzF: 0.157, rzB: 0.129 },
    { y: 1.43, rx: 0.151, rzF: 0.136, rzB: 0.126 },
    { y: 1.47, rx: 0.116, rzF: 0.101, rzB: 0.106 },
    { y: 1.492, rx: 0.086, rzF: 0.077, rzB: 0.082 },
  ].map((r) => ({ ...r, cz, n: 2.2 }));
  const cuirass = loft(rings, {
    segs: 24,
    thickness: 0.006,
    deform: (p, th, i) => {
      if (i >= 2 && i <= 6) ridge(p, th, 0.022);
      // Rueckenmitte leicht eingezogen
      const a = Math.abs(Math.atan2(Math.sin(th), Math.cos(th)));
      if (i >= 2 && i <= 6 && a > 2.9) p.z -= 0.004;
    },
  });
  c.b.add(cuirass, { ...METAL, color: C.steel, group: 'torso', weights: vblend('spine', 'chest', 1.12, 1.22) });

  // Bauchplatte (Plackart) mit Spitze nach oben
  const plack = loft(
    [
      { y: 1.028, rx: 0.149, rzF: 0.132, rzB: 0.12, cz, n: 2.2 },
      { y: 1.09, rx: 0.146, rzF: 0.14, rzB: 0.12, cz, n: 2.2 },
      { y: 1.16, rx: 0.157, rzF: 0.156, rzB: 0.12, cz, n: 2.2 },
      { y: 1.2, rx: 0.166, rzF: 0.167, rzB: 0.12, cz, n: 2.2 },
    ],
    {
      segs: 14,
      arc: [-1.3, 1.3],
      thickness: 0.005,
      deform: (p, th, i) => {
        const f = Math.max(0, 1 - Math.abs(th) / 1.3);
        if (i === 3) {
          p.y += 0.07 * f;
          p.z -= 0.004 * f;
        }
        ridge(p, th, 0.012);
      },
    },
  );
  c.b.add(plack, { ...METAL, color: C.steel, group: 'torso', weights: vblend('spine', 'chest', 1.14, 1.24) });
  // Messingkante entlang der Plackart-Spitze (V-Form) und am Halsausschnitt
  const vPts: THREE.Vector3[] = [];
  const vR: [number, number][] = [];
  for (let i = 0; i <= 12; i++) {
    const th = -1.3 + (2.6 * i) / 12;
    const f = Math.max(0, 1 - Math.abs(th) / 1.3);
    const r: Ring = { y: 1.2 + 0.07 * f, rx: 0.169, rzF: 0.171, rzB: 0.12, cz, n: 2.2 };
    const p = new THREE.Vector3(Math.sin(th) * r.rx, r.y, cz - Math.cos(th) * r.rzF! - 0.004 * f - 0.012 * Math.max(0, 1 - Math.abs(th) / 0.32));
    vPts.push(p);
    vR.push([0.0045, 0.0045]);
  }
  const vtrim = tube(vPts, vR, { segs: 4, side: v3(0, 0, -1) });
  const neckTrim = loft(
    [
      { y: 1.478, rx: 0.106, rzF: 0.093, rzB: 0.098, cz, n: 2.2 },
      { y: 1.496, rx: 0.088, rzF: 0.079, rzB: 0.084, cz, n: 2.2 },
    ],
    { segs: 20, thickness: 0.004 },
  );
  c.b.add(mergeList([vtrim, neckTrim]), { ...BRASS, color: C.brass, group: 'torso', weights: vblend('spine', 'chest', 1.14, 1.24) });

  // Fauld: drei Reifen
  const fauld: Ring[][] = [
    [
      { y: 1.065, rx: 0.144, rzF: 0.13, rzB: 0.114 },
      { y: 1.0, rx: 0.158, rzF: 0.142, rzB: 0.125 },
    ],
    [
      { y: 1.012, rx: 0.152, rzF: 0.136, rzB: 0.12 },
      { y: 0.945, rx: 0.167, rzF: 0.15, rzB: 0.131 },
    ],
    [
      { y: 0.957, rx: 0.161, rzF: 0.144, rzB: 0.127 },
      { y: 0.89, rx: 0.176, rzF: 0.158, rzB: 0.139 },
    ],
  ];
  const brass: THREE.BufferGeometry[] = [];
  fauld.forEach((rr, i) => {
    const g = loft(
      rr.map((r) => ({ ...r, cz, n: 2.2 })),
      {
        segs: 24,
        thickness: 0.005,
        deform: (p, th, ri) => {
          // vorne unten leicht ausgeschnitten (Beinfreiheit)
          if (i === 2 && ri === 0) {
            const a = Math.abs(Math.atan2(Math.sin(th), Math.cos(th)));
            p.y += 0.02 * Math.max(0, 1 - a / 0.5);
          }
        },
      },
    );
    c.b.add(g, { ...METAL, color: i === 1 ? C.steelLame : C.steel, group: 'torso', weights: i === 0 ? vblend('hips', 'spine', 1.02, 1.07) : rigid('hips') });
    const mid = rr[0]!;
    brass.push(...rivetsOnRing({ ...mid, y: mid.y - 0.018, rx: mid.rx + 0.004, rzF: mid.rzF! + 0.004, rzB: mid.rzB! + 0.004, cz }, [-1.2, -0.45, 0.45, 1.2, 2.0, 2.7, 3.58, 4.28], 0.003, 0.0055));
  });
  // Plackart-Nieten
  brass.push(...rivetsOnRing({ y: 1.1, rx: 0.157, rzF: 0.147, rzB: 0.12, cz }, [-1.05, -0.75, 0.75, 1.05], 0.004, 0.006));
  c.b.add(mergeList(brass), { ...BRASS, color: C.brass, group: 'torso', weights: vblend('hips', 'spine', 1.0, 1.08) });

  // Beintaschen (Tassets), zwei Folgen je Seite
  const tas: Ring[][] = [
    [
      { y: 0.9, rx: 0.176, rzF: 0.157, rzB: 0.14 },
      { y: 0.812, rx: 0.195, rzF: 0.176, rzB: 0.15 },
    ],
    [
      { y: 0.826, rx: 0.188, rzF: 0.168, rzB: 0.146 },
      { y: 0.735, rx: 0.206, rzF: 0.187, rzB: 0.155 },
    ],
  ];
  const tasW = (S: Side): WeightFn => (p) => {
    const d = 0.15 + 0.25 * smoothstep(0.9, 0.74, p.y);
    return [
      ['hips', 1 - d],
      ['thigh' + S, d],
    ];
  };
  const tasBrass: THREE.BufferGeometry[] = [];
  tas.forEach((rr) => {
    const g = loft(
      rr.map((r) => ({ ...r, cz, n: 2.2 })),
      {
        segs: 6,
        arc: [0.72, 1.62],
        thickness: 0.005,
        deform: (p, th, ri) => {
          if (ri === 1) p.y -= 0.012 * Math.sin(((th - 0.72) / 0.9) * Math.PI); // gerundete Unterkante
        },
      },
    );
    both(c, g, (S) => ({ ...METAL, color: C.steel, group: 'torso', weights: tasW(S) }));
    tasBrass.push(...rivetsOnRing({ ...rr[0]!, y: rr[0]!.y - 0.016, cz, n: 2.2 }, [0.9, 1.44], 0.004, 0.0055));
  });
  both(c, mergeList(tasBrass), (S) => ({ ...BRASS, color: C.brass, group: 'torso', weights: tasW(S) }));

  // Kettenhemd-Saum unter dem Fauld
  const mail = loft(
    [
      { y: 0.99, rx: 0.15, rzF: 0.131, rzB: 0.118 },
      { y: 0.9, rx: 0.165, rzF: 0.146, rzB: 0.134 },
      { y: 0.8, rx: 0.18, rzF: 0.158, rzB: 0.148 },
      { y: 0.748, rx: 0.186, rzF: 0.164, rzB: 0.154 },
    ].map((r) => ({ ...r, cz, n: 2.1 })),
    {
      segs: 26,
      thickness: 0.005,
      deform: (p, th, i) => {
        if (i === 3) p.y += Math.sin(th * 13) * 0.005; // Zackensaum
      },
    },
  );
  c.b.add(mail, {
    ...CHAIN,
    color: C.chain,
    group: 'torso',
    weights: skirtW(0.93, 0.75, 0.55),
    colorFn: (cen, _n, out) => {
      if (cen.y < 0.765) out.setHex(C.brass).multiplyScalar(0.85);
    },
  });
  // Gambeson-Saum darunter (gesteppt)
  const gskirt = loft(
    [
      { y: 0.82, rx: 0.172, rzF: 0.15, rzB: 0.14 },
      { y: 0.745, rx: 0.18, rzF: 0.158, rzB: 0.148 },
      { y: 0.68, rx: 0.188, rzF: 0.166, rzB: 0.156 },
    ].map((r) => ({ ...r, cz, n: 2.1 })),
    {
      segs: 32,
      thickness: 0.006,
      deform: (p, th) => {
        const k = Math.abs(Math.sin(th * 8));
        const d = 0.004 * k;
        p.x += Math.sin(th) * d;
        p.z -= Math.cos(th) * d;
      },
    },
  );
  c.b.add(gskirt, { ...CLOTH, color: C.gambesonDark, group: 'torso', weights: skirtW(0.9, 0.68, 0.6) });

  buildBelts(c);
}

function buildBelts(c: Ctx): void {
  const cz = 0.005;
  // Leibgurt (ueber dem Waffenrock)
  const belt = loft(
    [
      { y: 1.052, rx: 0.15, rzF: 0.16, rzB: 0.12, cz, n: 2.2 },
      { y: 1.088, rx: 0.147, rzF: 0.157, rzB: 0.118, cz, n: 2.2 },
    ],
    { segs: 24, thickness: 0.006 },
  );
  c.b.add(belt, { ...LEATHER, color: C.leatherDark, group: 'torso', weights: vblend('hips', 'spine', 1.02, 1.1) });
  // Schwertgurt, schraeg auf der Huefte, mit Messingbeschlaegen
  const hip = loft(
    [
      { y: 0.93, rx: 0.187, rzF: 0.167, rzB: 0.148, cz, n: 2.2 },
      { y: 0.962, rx: 0.183, rzF: 0.162, rzB: 0.144, cz, n: 2.2 },
    ],
    {
      segs: 24,
      thickness: 0.006,
      deform: (p) => {
        p.y += -p.x * 0.09 + p.z * 0.06; // links tiefer, hinten hoeher
      },
    },
  );
  c.b.add(hip, { ...LEATHER, color: C.leather, group: 'torso', bone: 'hips' });
  const plaques: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 16; i++) {
    const th = (i / 16) * Math.PI * 2 + 0.2;
    const a = Math.abs(Math.atan2(Math.sin(th), Math.cos(th)));
    if (a < 0.45) continue; // vorne vom Waffenrock verdeckt
    const r = { rx: 0.189, rzF: 0.169, rzB: 0.15 };
    const x = Math.sin(th) * r.rx;
    const z = cz - Math.cos(th) * (Math.cos(th) >= 0 ? r.rzF : r.rzB);
    const y = 0.946 - x * 0.09 + z * 0.06;
    plaques.push(xf(box(0.022, 0.026, 0.006), { t: [x, y, z], r: [0, -th, 0] }));
  }
  c.b.add(mergeList(plaques), { ...BRASS, color: C.brass, group: 'torso', bone: 'hips' });

  // Schnalle vorne am Leibgurt + herabhaengendes Riemenende
  const buckle = mergeList([
    xf(box(0.046, 0.006, 0.006), { t: [0, 1.087, -0.164] }),
    xf(box(0.046, 0.006, 0.006), { t: [0, 1.053, -0.166] }),
    xf(box(0.006, 0.04, 0.006), { t: [-0.02, 1.07, -0.165] }),
    xf(box(0.006, 0.04, 0.006), { t: [0.02, 1.07, -0.165] }),
    xf(box(0.004, 0.036, 0.004), { t: [0, 1.07, -0.168], r: [0, 0, 0.3] }),
  ]);
  c.b.add(buckle, { ...BRASS, color: C.brass, group: 'torso', weights: vblend('hips', 'spine', 1.02, 1.1) });
  const tongue = tube([v3(0.02, 1.07, -0.169), v3(0.026, 1.03, -0.182), v3(0.03, 0.985, -0.19)], [
    [0.012, 0.0025],
    [0.012, 0.0025],
    [0.012, 0.0025],
  ], { segs: 4, side: v3(1, 0, 0) });
  c.b.add(tongue, { ...LEATHER, color: C.leatherDark, group: 'torso', bone: 'hips' });

  // Beutel (rechts vorne an der Huefte)
  // Beutel hinten rechts
  const pouch = xf(box(0.085, 0.085, 0.034), { t: [0.118, 0.875, 0.143], r: [0, -0.5, 0] });
  const flap = xf(box(0.09, 0.048, 0.01), { t: [0.124, 0.9, 0.16], r: [0.12, -0.5, 0] });
  c.b.add(pouch, { ...LEATHER, color: C.leatherTan, group: 'torso', bone: 'hips' });
  c.b.add(flap, { ...LEATHER, color: C.leather, group: 'torso', bone: 'hips' });
  c.b.add(xf(octa(0.007), { t: [0.128, 0.884, 0.167] }), { ...BRASS, color: C.brass, group: 'torso', bone: 'hips' });

  // Dolch (Rondelldolch) rechts an der Seite
  const dA = v3(0.196, 0.93, 0.035);
  const dB = v3(0.222, 0.69, 0.125);
  const sheath = tube([dA, dA.clone().lerp(dB, 0.5), dB], [
    [0.012, 0.02],
    [0.011, 0.016],
    [0.006, 0.008],
  ], { segs: 6, capEnd: true, side: v3(1, 0, 0) });
  c.b.add(sheath, { ...LEATHER, color: C.leatherDark, group: 'torso', bone: 'hips' });
  const dir = dA.clone().sub(dB).normalize();
  const g0 = dA.clone().addScaledVector(dir, 0.012);
  const g1 = dA.clone().addScaledVector(dir, 0.095);
  const grip = tube([g0, g1], [
    [0.011, 0.011],
    [0.011, 0.011],
  ], { segs: 6 });
  c.b.add(grip, { ...LEATHER, color: 0x2a1c12, group: 'torso', bone: 'hips' });
  const discs: THREE.BufferGeometry[] = [];
  for (const [p, r] of [
    [g0, 0.024],
    [g1, 0.026],
  ] as const) {
    discs.push(
      tube([p.clone().addScaledVector(dir, -0.005), p.clone().addScaledVector(dir, 0.005)], [
        [r, r],
        [r, r],
      ], { segs: 8, capStart: true, capEnd: true }),
    );
  }
  discs.push(tube([dA.clone().addScaledVector(dir, -0.01), dA.clone().addScaledVector(dir, 0.004)], [
    [0.016, 0.022],
    [0.016, 0.022],
  ], { segs: 6, capStart: true }));
  c.b.add(mergeList(discs), { ...BRASS, color: C.bronze, group: 'torso', bone: 'hips' });

  // Schwertscheide links (pendelt an eigener Kette)
  const sd = CHAINS.find((d) => d.name === 'scab')!.columns[0]!;
  const sA = v3(sd[0]![0]!, sd[0]![1]!, sd[0]![2]!);
  const sB = v3(sd[1]![0]!, sd[1]![1]!, sd[1]![2]!);
  const sdir = sB.clone().sub(sA);
  const L = sdir.length();
  sdir.normalize();
  const along = (t: number) => sA.clone().addScaledVector(sdir, t * L);
  const scab = tube([along(0.02), along(0.4), along(0.85), along(0.99)], [
    [0.013, 0.031],
    [0.012, 0.027],
    [0.009, 0.019],
    [0.004, 0.008],
  ], { segs: 6, capStart: true, capEnd: true, side: v3(1, 0, 0) });
  c.b.add(scab, { ...LEATHER, color: C.leatherDark, group: 'torso', weights: chainW('scab') });
  const fittings = mergeList([
    tube([along(0.0), along(0.075)], [
      [0.016, 0.034],
      [0.015, 0.033],
    ], { segs: 6, capStart: true, side: v3(1, 0, 0) }),
    tube([along(0.9), along(1.0)], [
      [0.011, 0.018],
      [0.004, 0.006],
    ], { segs: 6, capEnd: true, side: v3(1, 0, 0) }),
    tube([along(0.3), along(0.33)], [
      [0.0135, 0.029],
      [0.0135, 0.029],
    ], { segs: 6, side: v3(1, 0, 0) }),
  ]);
  c.b.add(fittings, { ...BRASS, color: C.bronze, group: 'torso', weights: chainW('scab') });
  const hanger = mergeList([
    tube([v3(-0.18, 0.955, -0.07), v3(-0.212, 0.93, -0.06)], [
      [0.004, 0.012],
      [0.004, 0.012],
    ], { segs: 4 }),
    tube([v3(-0.18, 0.955, 0.03), v3(-0.225, 0.855, -0.01)], [
      [0.004, 0.011],
      [0.004, 0.011],
    ], { segs: 4 }),
  ]);
  c.b.add(hanger, { ...LEATHER, color: C.leather, group: 'torso', bone: 'hips' });
}

function buildPauldrons(c: Ctx): void {
  const cx = 0.185;
  const cz = 0.022;
  // Schulterkuppel: flacher, zum Hals hin auslaufend
  const dome = loft(
    [
      { y: 1.37, rx: 0.12, rzF: 0.121, rzB: 0.116, cx, cz },
      { y: 1.41, rx: 0.118, rzF: 0.119, rzB: 0.114, cx, cz },
      { y: 1.452, rx: 0.106, rzF: 0.109, rzB: 0.103, cx: cx - 0.005, cz },
      { y: 1.487, rx: 0.079, rzF: 0.087, rzB: 0.081, cx: cx - 0.012, cz },
      { y: 1.506, rx: 0.042, rzF: 0.052, rzB: 0.048, cx: cx - 0.018, cz },
    ],
    {
      segs: 18,
      thickness: 0.005,
      capTop: true,
      deform: (p, th, i) => {
        // Grat ueber die Schulter (von vorne nach hinten)
        const a = Math.abs(Math.sin(th));
        if (i >= 1 && i <= 3 && Math.sin(th) > 0) p.y += 0.008 * Math.pow(a, 6);
      },
    },
  );
  const lames: THREE.BufferGeometry[] = [dome];
  const brass: THREE.BufferGeometry[] = [];
  const lameDefs: [number, number, number, number][] = [
    [1.382, 1.322, 0.113, 0.108],
    [1.332, 1.272, 0.104, 0.099],
    [1.282, 1.226, 0.095, 0.09],
  ];
  const arc: [number, number] = [-0.8, Math.PI + 0.8];
  const bend = (p: THREE.Vector3, th: number) => {
    // Unterkante vorne/hinten hochgezogen, aussen tiefer
    p.y -= 0.014 * Math.sin(((th - arc[0]) / (arc[1] - arc[0])) * Math.PI);
  };
  lameDefs.forEach(([y0, y1, r0, r1], i) => {
    lames.push(
      loft(
        [
          { y: y1, rx: r1 + 0.006, rzF: r1 + 0.008, rzB: r1 + 0.002, cx: 0.2, cz },
          { y: y0, rx: r0, rzF: r0 + 0.004, rzB: r0, cx: 0.2, cz },
        ],
        { segs: 12, arc, thickness: 0.005, deform: (p, th, ri) => ri === 0 && bend(p, th) },
      ),
    );
    brass.push(...rivetsOnRing({ y: (y0 + y1) / 2 + 0.008, rx: (r0 + r1) / 2 + 0.004, rz: (r0 + r1) / 2 + 0.006, cx: 0.2, cz }, [-0.35, Math.PI / 2, Math.PI + 0.35], 0.002, 0.005));
    if (i === 2) {
      brass.push(
        loft(
          [
            { y: y1 - 0.004, rx: r1 + 0.009, rzF: r1 + 0.011, rzB: r1 + 0.005, cx: 0.2, cz },
            { y: y1 + 0.008, rx: r1 + 0.008, rzF: r1 + 0.01, rzB: r1 + 0.004, cx: 0.2, cz },
          ],
          { segs: 12, arc, thickness: 0.004, deform: (p, th) => bend(p, th) },
        ),
      );
    }
  });
  // Messingkante am Kuppelrand
  brass.push(
    loft(
      [
        { y: 1.367, rx: 0.1245, rzF: 0.1255, rzB: 0.1205, cx, cz },
        { y: 1.379, rx: 0.1235, rzF: 0.1245, rzB: 0.1195, cx, cz },
      ],
      { segs: 18, thickness: 0.004 },
    ),
  );
  const pW = (S: Side): WeightFn => (p) => {
    const t = smoothstep(1.46, 1.29, p.y);
    const up = 0.3 + 0.7 * t;
    return [
      ['shoulder' + S, 1 - up],
      ['upperArm' + S, up],
    ];
  };
  const domeGeo = lames.shift()!;
  both(c, domeGeo, (S) => ({ ...METAL, color: C.steel, group: 'shoulders', weights: pW(S) }));
  both(c, mergeList(lames), (S) => ({ ...METAL, color: C.steelLame, group: 'shoulders', weights: pW(S) }));
  both(c, mergeList(brass), (S) => ({ ...BRASS, color: C.brass, group: 'shoulders', weights: pW(S) }));
  // Riemen ueber der Schulterkuppel
  const strap = loft(
    [
      { y: 1.513, rx: 0.036, rzF: 0.05, rzB: 0.05, cx: cx - 0.016, cz },
      { y: 1.49, rx: 0.082, rzF: 0.09, rzB: 0.088, cx: cx - 0.011, cz },
    ],
    { segs: 10, arc: [Math.PI / 2 - 0.3, Math.PI / 2 + 0.3], thickness: 0.004 },
  );
  both(c, strap, (S) => ({ ...LEATHER, color: C.leatherDark, group: 'shoulders', bone: 'shoulder' + S }));
}

function buildArmPlates(c: Ctx): void {
  const x = 0.2;
  // Kettenaermel (am Oberarm, innen sichtbar)
  const sleeve = loft(
    [
      { y: 1.44, rx: 0.062, rz: 0.064, cx: x, cz: 0.025 },
      { y: 1.3, rx: 0.058, rz: 0.06, cx: x, cz: 0.026 },
      { y: 1.17, rx: 0.052, rz: 0.055, cx: x, cz: 0.028 },
      { y: 1.1, rx: 0.049, rz: 0.052, cx: x, cz: 0.03 },
    ],
    { segs: 12 },
  );
  both(c, sleeve, (S) => ({ ...CHAIN, color: C.chain, group: 'arms', weights: vblend('forearm' + S, 'upperArm' + S, 1.11, 1.18) }));

  // Oberarmschiene (innen offen)
  const rere = loft(
    [
      { y: 1.19, rx: 0.058, rzF: 0.06, rzB: 0.062, cx: x, cz: 0.027 },
      { y: 1.24, rx: 0.061, rzF: 0.063, rzB: 0.065, cx: x, cz: 0.026 },
      { y: 1.3, rx: 0.066, rzF: 0.067, rzB: 0.068, cx: x, cz: 0.026 },
    ],
    { segs: 12, arc: [-1.0, Math.PI + 1.0], thickness: 0.004 },
  );
  const metal: THREE.BufferGeometry[] = [rere];
  const brass: THREE.BufferGeometry[] = [];
  // Ellbogenkachel: Kuppe nach hinten + Muschel aussen
  const cop = loft(
    [
      { y: 0, rx: 0.064, rz: 0.064 },
      { y: 0.022, rx: 0.058, rz: 0.058 },
      { y: 0.04, rx: 0.038, rz: 0.038 },
      { y: 0.05, rx: 0.018, rz: 0.018 },
    ],
    { segs: 12, apexTop: v3(0, 0.058, 0), thickness: 0.004 },
  );
  xf(cop, { r: [Math.PI / 2, 0, 0], t: [x, 1.14, 0.012] });
  metal.push(cop);
  const wing = loft(
    [
      { y: 0, rx: 0.056, rz: 0.046 },
      { y: 0.01, rx: 0.046, rz: 0.038 },
      { y: 0.018, rx: 0.02, rz: 0.018 },
    ],
    { segs: 10, apexTop: v3(0, 0.022, 0), thickness: 0.004 },
  );
  xf(wing, { r: [0, 0, -Math.PI / 2], t: [x + 0.05, 1.14, 0.025] });
  metal.push(wing);
  brass.push(xf(octa(0.007), { t: [x + 0.074, 1.14, 0.025] }));
  both(c, mergeList(metal.splice(0)), (S) => ({ ...METAL, color: C.steel, group: 'arms', weights: vblend('forearm' + S, 'upperArm' + S, 1.1, 1.19) }));

  // Unterarmschiene
  const vam = loft(
    [
      { y: 0.9, rx: 0.046, rzF: 0.049, rzB: 0.049, cx: x, cz: 0.03 },
      { y: 0.92, rx: 0.042, rzF: 0.045, rzB: 0.045, cx: x, cz: 0.03 },
      { y: 0.98, rx: 0.046, rzF: 0.049, rzB: 0.05, cx: x, cz: 0.03 },
      { y: 1.05, rx: 0.054, rzF: 0.056, rzB: 0.058, cx: x, cz: 0.03 },
      { y: 1.105, rx: 0.053, rzF: 0.054, rzB: 0.058, cx: x, cz: 0.03 },
    ],
    { segs: 14, thickness: 0.004 },
  );
  metal.push(vam);
  // Scharnierleiste innen
  metal.push(xf(box(0.006, 0.18, 0.012), { t: [x - 0.05, 1.0, 0.03] }));
  brass.push(
    loft(
      [
        { y: 1.095, rx: 0.057, rzF: 0.058, rzB: 0.062, cx: x, cz: 0.03 },
        { y: 1.108, rx: 0.056, rzF: 0.057, rzB: 0.061, cx: x, cz: 0.03 },
      ],
      { segs: 14, thickness: 0.003 },
    ),
  );
  brass.push(xf(octa(0.005), { t: [x - 0.054, 1.05, 0.03] }), xf(octa(0.005), { t: [x - 0.052, 0.95, 0.03] }));
  both(c, mergeList(metal), (S) => ({ ...METAL, color: C.steel, group: 'arms', bone: 'forearm' + S }));
  both(c, mergeList(brass), (S) => ({ ...BRASS, color: C.brass, group: 'arms', weights: vblend('forearm' + S, 'upperArm' + S, 1.1, 1.19) }));

  buildFist(c, true, 'arms');
}

function buildLegPlates(c: Ctx): void {
  const x = 0.097;
  const metal: THREE.BufferGeometry[] = [];
  const brass: THREE.BufferGeometry[] = [];
  const ridge = (p: THREE.Vector3, th: number, amt: number) => {
    const a = Math.abs(Math.atan2(Math.sin(th), Math.cos(th)));
    p.z -= amt * Math.max(0, 1 - a / 0.34);
  };
  // Beinzeug Oberschenkel (vorne und seitlich)
  const cuisse = loft(
    [
      { y: 0.6, rx: 0.08, rzF: 0.083, rzB: 0.076, cx: x + 0.002, cz: -0.004 },
      { y: 0.68, rx: 0.088, rzF: 0.091, rzB: 0.08, cx: x + 0.002, cz: -0.004 },
      { y: 0.8, rx: 0.1, rzF: 0.104, rzB: 0.09, cx: x, cz: -0.004 },
      { y: 0.9, rx: 0.108, rzF: 0.114, rzB: 0.097, cx: x - 0.004, cz: -0.004 },
      { y: 0.935, rx: 0.113, rzF: 0.119, rzB: 0.1, cx: x - 0.006, cz: -0.004 },
    ],
    {
      segs: 14,
      arc: [-2.0, 2.05],
      thickness: 0.005,
      deform: (p, th, i) => {
        if (i >= 1 && i <= 3) ridge(p, th, 0.01);
      },
    },
  );
  metal.push(cuisse);
  brass.push(...rivetsOnRing({ y: 0.918, rx: 0.113, rzF: 0.119, rzB: 0.1, cx: x - 0.005, cz: -0.004 }, [-1.3, -0.6, 0.6, 1.3], 0.002, 0.0055));
  // Kniekachel mit Muschel und Folgen
  const cop = loft(
    [
      { y: 0, rx: 0.07, rz: 0.066 },
      { y: 0.024, rx: 0.062, rz: 0.058 },
      { y: 0.042, rx: 0.04, rz: 0.038 },
      { y: 0.052, rx: 0.018, rz: 0.018 },
    ],
    { segs: 12, apexTop: v3(0, 0.058, 0), thickness: 0.005 },
  );
  xf(cop, { r: [-Math.PI / 2, 0, 0], t: [x, 0.505, -0.022] });
  metal.push(cop);
  const wing = loft(
    [
      { y: 0, rx: 0.05, rz: 0.058 },
      { y: 0.01, rx: 0.042, rz: 0.048 },
      { y: 0.017, rx: 0.018, rz: 0.02 },
    ],
    { segs: 10, apexTop: v3(0, 0.021, 0), thickness: 0.004 },
  );
  xf(wing, { r: [0, 0, -Math.PI / 2], t: [x + 0.058, 0.505, -0.018] });
  metal.push(wing);
  brass.push(xf(octa(0.006), { t: [x, 0.505, -0.082] }), xf(octa(0.006), { t: [x + 0.08, 0.505, -0.018] }));
  both(c, mergeList(metal.splice(0)), (S) => ({ ...METAL, color: C.steel, group: 'legs', weights: vblend('shin' + S, 'thigh' + S, 0.47, 0.545) }));
  const lameA = loft(
    [
      { y: 0.548, rx: 0.074, rzF: 0.078, rzB: 0.07, cx: x, cz: -0.004 },
      { y: 0.582, rx: 0.079, rzF: 0.082, rzB: 0.074, cx: x, cz: -0.004 },
    ],
    { segs: 10, arc: [-1.5, 1.5], thickness: 0.004 },
  );
  both(c, lameA, (S) => ({ ...METAL, color: C.steel, group: 'legs', bone: 'thigh' + S }));
  // Beinschiene
  const greave = loft(
    [
      { y: 0.108, rx: 0.052, rzF: 0.066, rzB: 0.062, cx: x },
      { y: 0.13, rx: 0.046, rzF: 0.059, rzB: 0.056, cx: x },
      { y: 0.2, rx: 0.049, rzF: 0.056, rzB: 0.06, cx: x },
      { y: 0.3, rx: 0.058, rzF: 0.062, rzB: 0.075, cx: x, cz: 0.002 },
      { y: 0.39, rx: 0.063, rzF: 0.066, rzB: 0.08, cx: x, cz: 0.002 },
      { y: 0.44, rx: 0.064, rzF: 0.07, rzB: 0.07, cx: x },
      { y: 0.468, rx: 0.07, rzF: 0.075, rzB: 0.069, cx: x },
    ],
    {
      segs: 16,
      thickness: 0.004,
      deform: (p, th, i) => {
        if (i >= 1 && i <= 5) ridge(p, th, 0.012);
      },
    },
  );
  metal.push(greave);
  const lameB = loft(
    [
      { y: 0.44, rx: 0.07, rzF: 0.077, rzB: 0.07, cx: x, cz: -0.004 },
      { y: 0.47, rx: 0.074, rzF: 0.08, rzB: 0.072, cx: x, cz: -0.006 },
    ],
    { segs: 10, arc: [-1.5, 1.5], thickness: 0.004 },
  );
  metal.push(lameB);
  metal.push(xf(box(0.005, 0.3, 0.01), { t: [x + 0.058, 0.3, 0.012] }));
  brass.push(xf(octa(0.005), { t: [x + 0.062, 0.38, 0.012] }), xf(octa(0.005), { t: [x + 0.056, 0.2, 0.012] }));

  // Eisenschuh (Sabaton): Folgen ueber dem Rist, Kappe am Zeh
  const sabFoot: THREE.BufferGeometry[] = [];
  const sabToe: THREE.BufferGeometry[] = [];
  const lameAt = (z0: number, z1: number, w0: number, w1: number, h0: number, h1: number) =>
    xf(
      footLoft(
        [
          [z0, w0, h0],
          [z1, w1, h1],
        ],
        10,
        [Math.PI / 2 - 0.15, Math.PI * 1.5 + 0.15],
        0.004,
        0.008,
      ),
      { t: [x, 0.003, 0] },
    );
  sabFoot.push(lameAt(0.035, -0.005, 0.048, 0.05, 0.12, 0.105));
  sabFoot.push(lameAt(0.0, -0.04, 0.05, 0.051, 0.1, 0.088));
  sabFoot.push(lameAt(-0.035, -0.075, 0.051, 0.052, 0.086, 0.07));
  sabToe.push(lameAt(-0.07, -0.11, 0.052, 0.05, 0.068, 0.057));
  sabToe.push(
    xf(
      footLoft(
        [
          [-0.105, 0.051, 0.058],
          [-0.15, 0.044, 0.048],
          [-0.18, 0.024, 0.034],
          [-0.19, 0.008, 0.024],
        ],
        10,
        [Math.PI / 2 - 0.15, Math.PI * 1.5 + 0.15],
        0.004,
        0.008,
      ),
      { t: [x, 0.003, 0] },
    ),
  );
  both(c, mergeList(metal), (S) => ({ ...METAL, color: C.steel, group: 'legs', bone: 'shin' + S }));
  both(c, mergeList(sabFoot), (S) => ({ ...METAL, color: C.steelDark, group: 'legs', weights: footW(S) }));
  both(c, mergeList(sabToe), (S) => ({ ...METAL, color: C.steelDark, group: 'legs', bone: 'toe' + S }));
  both(c, mergeList(brass), (S) => ({ ...BRASS, color: C.brass, group: 'legs', weights: vblend('shin' + S, 'thigh' + S, 0.47, 0.545) }));

  // Lederriemen hinten am Oberschenkel mit Schnallen
  const straps: THREE.BufferGeometry[] = [];
  for (const y of [0.84, 0.665]) {
    straps.push(
      loft(
        [
          { y: y, rx: 0.095 - (0.84 - y) * 0.12, rzF: 0.09, rzB: 0.094 - (0.84 - y) * 0.1, cx: x, cz: -0.002 },
          { y: y + 0.022, rx: 0.095 - (0.84 - y) * 0.12, rzF: 0.09, rzB: 0.094 - (0.84 - y) * 0.1, cx: x, cz: -0.002 },
        ],
        { segs: 8, arc: [1.9, Math.PI * 2 - 1.9], thickness: 0.004 },
      ),
    );
  }
  both(c, mergeList(straps), (S) => ({ ...LEATHER, color: C.leatherDark, group: 'legs', bone: 'thigh' + S }));
}

// ------------------------------------------------------------------ Waffenrock und Umhang

function charge(size: number): THREE.BufferGeometry {
  // Tatzenkreuz
  const w0 = 0.2 * size;
  const w1 = 0.52 * size;
  const L = size;
  const s = new THREE.Shape();
  s.moveTo(-w0, w0);
  s.lineTo(-w1, L);
  s.lineTo(w1, L);
  s.lineTo(w0, w0);
  s.lineTo(L, w1);
  s.lineTo(L, -w1);
  s.lineTo(w0, -w0);
  s.lineTo(w1, -L);
  s.lineTo(-w1, -L);
  s.lineTo(-w0, -w0);
  s.lineTo(-L, -w1);
  s.lineTo(-L, w1);
  s.closePath();
  return extrude(s, 0.003);
}

function buildTabard(c: Ctx, withBack: boolean): void {
  const trim = new THREE.Color(C.cream).lerp(new THREE.Color(0xc8a050), 0.45);
  const colorFn = (_cen: THREE.Vector3, _n: THREE.Vector3, out: THREE.Color, u: number, v: number) => {
    if (u < 0.07 || u > 0.93 || v > 0.94) out.copy(trim);
  };
  const us = [0, 0.07, 0.2, 0.35, 0.5, 0.65, 0.8, 0.93, 1];
  const vs = [0, 0.1, 0.2, 1 / 3, 0.45, 0.56, 2 / 3, 0.78, 0.88, 0.94, 1];
  const panel = (name: string, halfTop: number, halfGrow: number, curve: number, outward: number) => {
    const cols = CHAINS.find((d) => d.name === name)!.columns;
    const L = cols[0]!;
    const R = cols[1]!;
    const at = (col: readonly (readonly number[])[], v: number, k: number) => {
      const f = v * (col.length - 1);
      const i = Math.min(col.length - 2, Math.floor(f));
      return col[i]![k]! + (col[i + 1]![k]! - col[i]![k]!) * (f - i);
    };
    const pos = (u: number, v: number) => {
      const half = halfTop + halfGrow * v;
      const x = (u * 2 - 1) * half;
      const zc = (at(L, v, 2) + at(R, v, 2)) / 2 - curve * at(R, v, 0) ** 2;
      return v3(x, at(L, v, 1), zc + curve * x * x);
    };
    return { geo: sheet(us, vs, pos, (u) => v3((u * 2 - 1) * 0.35, 0, outward), 0.008), pos };
  };
  const front = panel('tabF', 0.125, 0.06, 0.8, -1);
  c.b.add(front.geo, { ...CLOTH, color: c.accent, group: 'tabard', weights: gridW('tabF'), colorFn });
  // Wappen
  const ch = charge(0.06);
  let vv = 0;
  const col0 = CHAINS.find((d) => d.name === 'tabF')!.columns[0]!;
  const chY = 0.8;
  for (let i = 0; i < col0.length - 1; i++) {
    const y0 = col0[i]![1];
    const y1 = col0[i + 1]![1];
    if (chY <= y0 && chY >= y1) vv = (i + (y0 - chY) / (y0 - y1)) / (col0.length - 1);
  }
  const pc = front.pos(0.5, vv);
  xf(ch, { t: [0, chY, pc.z - 0.0065] });
  c.b.add(ch, { ...CLOTH, color: C.cream, group: 'tabard', weights: gridW('tabF'), jitter: 0.02 });

  if (withBack) {
    const back = panel('tabB', 0.13, 0.06, -0.9, 1);
    c.b.add(back.geo, { ...CLOTH, color: c.accent, group: 'tabard', weights: gridW('tabB'), colorFn });
  }
}

function buildCape(c: Ctx): void {
  const def = CHAINS.find((d) => d.name === 'cape')!;
  const cols = def.columns.map((col) => col.map((p) => v3(p[0]!, p[1]!, p[2]!)));
  const rows = cols[0]!.length - 1;
  const colAt = (ci: number, v: number) => {
    const f = v * rows;
    const i = Math.min(rows - 1, Math.floor(f));
    return cols[ci]![i]!.clone().lerp(cols[ci]![i + 1]!, f - i);
  };
  const point = (u: number, v: number) => {
    const L = colAt(0, v);
    const M = colAt(1, v);
    const R = colAt(2, v);
    // quadratische Interpolation ueber die drei Spalten (u = 0, 0.5, 1)
    const l0 = 2 * (u - 0.5) * (u - 1);
    const l1 = -4 * u * (u - 1);
    const l2 = 2 * u * (u - 0.5);
    return L.multiplyScalar(l0).add(M.multiplyScalar(l1)).add(R.multiplyScalar(l2));
  };
  const us: number[] = [];
  for (let i = 0; i <= 14; i++) us.push(i / 14);
  us.splice(1, 0, 0.025);
  us.splice(us.length - 1, 0, 0.975);
  const vs: number[] = [];
  for (let i = 0; i <= 16; i++) vs.push(i / 16);
  vs.splice(vs.length - 1, 0, 0.965);
  const trim = new THREE.Color(C.cream).lerp(new THREE.Color(0xc8a050), 0.45);
  const lining = new THREE.Color(C.lining);
  const cape = sheet(
    us,
    vs,
    (u, v) => {
      const p = point(u, v);
      // Faltenwurf nach unten zunehmend
      const fold = Math.sin(u * Math.PI * 5) * 0.012 * v;
      p.z += fold;
      return p;
    },
    (u, v) => {
      const p = point(u, v);
      return v3(p.x, 0, p.z + 0.02);
    },
    0.01,
  );
  c.b.add(cape, {
    ...CLOTH,
    color: c.accentCape,
    group: 'cape',
    weights: capeW(),
    colorFn: (cen, n, out, u, v) => {
      const outward = n.x * cen.x + n.z * (cen.z + 0.02) > 0;
      if (!outward) out.copy(lining);
      else if (u < 0.025 || u > 0.975 || v > 0.965) out.copy(trim);
    },
  });
  // Wappen auf dem Ruecken
  const ch = charge(0.075);
  const pc = point(0.5, 0.3);
  xf(ch, { t: [0, pc.y, pc.z + 0.0085], r: [0, Math.PI, 0] });
  c.b.add(ch, { ...CLOTH, color: C.cream, group: 'cape', weights: capeW(), jitter: 0.02 });
  // Schliessen (Messing) an den oberen Ecken
  const clasps: THREE.BufferGeometry[] = [];
  for (const u of [0, 1]) {
    const p = point(u, 0.02);
    clasps.push(xf(sphere(0.017, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), { t: [p.x, p.y, p.z], r: [0, 0, (u ? -1 : 1) * 1.4], s: [1, 0.5, 1] }));
  }
  c.b.add(mergeList(clasps), { ...BRASS, color: C.brass, group: 'cape', weights: capeW() });
}

// ------------------------------------------------------------------ Mittlere / leichte Stufe

function buildMailHauberk(c: Ctx, sleevesToWrist: boolean): void {
  const cz = 0.005;
  const rings: Ring[] = [
    { y: 0.74, rx: 0.19, rzF: 0.17, rzB: 0.16 },
    { y: 0.82, rx: 0.18, rzF: 0.16, rzB: 0.15 },
    { y: 0.95, rx: 0.163, rzF: 0.14, rzB: 0.132 },
    { y: 1.05, rx: 0.152, rzF: 0.13, rzB: 0.118 },
    { y: 1.18, rx: 0.157, rzF: 0.146, rzB: 0.116 },
    { y: 1.29, rx: 0.16, rzF: 0.158, rzB: 0.12 },
    { y: 1.37, rx: 0.16, rzF: 0.15, rzB: 0.124 },
    { y: 1.44, rx: 0.148, rzF: 0.128, rzB: 0.12 },
    { y: 1.48, rx: 0.106, rzF: 0.092, rzB: 0.097 },
    { y: 1.51, rx: 0.075, rzF: 0.07, rzB: 0.074 },
  ].map((r) => ({ ...r, cz, n: 2.2 }));
  const body = loft(rings, {
    segs: 24,
    thickness: 0.005,
    deform: (p, _th, i) => {
      if (i === 0) p.y += Math.sin(_th * 13) * 0.005;
    },
  });
  c.b.add(body, {
    ...CHAIN,
    color: C.chain,
    group: 'torso',
    weights: (p) => {
      if (p.y < 0.98) return skirtW(0.95, 0.74)(p);
      return torsoW()(p);
    },
  });
  const x = 0.2;
  const sleeve = loft(
    [
      ...(sleevesToWrist
        ? [
            { y: 0.9, rx: 0.047, rz: 0.049, cx: x, cz: 0.03 },
            { y: 1.02, rx: 0.052, rz: 0.055, cx: x, cz: 0.03 },
          ]
        : [{ y: 1.1, rx: 0.056, rz: 0.058, cx: x, cz: 0.03 }]),
      { y: 1.15, rx: 0.058, rz: 0.06, cx: x, cz: 0.028 },
      { y: 1.3, rx: 0.064, rz: 0.066, cx: x, cz: 0.026 },
      { y: 1.44, rx: 0.07, rz: 0.072, cx: x, cz: 0.025 },
    ],
    { segs: 12, thickness: 0.004 },
  );
  both(c, sleeve, (S) => ({
    ...CHAIN,
    color: C.chain,
    group: 'arms',
    weights: (p) => {
      const t = smoothstep(1.1, 1.18, p.y);
      const sh = smoothstep(1.38, 1.46, p.y) * 0.5;
      return [
        ['forearm' + S, 1 - t],
        ['upperArm' + S, t * (1 - sh)],
        ['shoulder' + S, t * sh],
      ];
    },
  }));
}

function buildGambesonSleeves(c: Ctx): void {
  const x = 0.2;
  const rings: Ring[] = [];
  const ys = [0.9, 0.96, 1.02, 1.08, 1.14, 1.2, 1.26, 1.32, 1.38, 1.44];
  ys.forEach((y, i) => {
    const r = 0.048 + (y - 0.9) * 0.042 + (i % 2) * 0.004;
    rings.push({ y, rx: r, rz: r + 0.002, cx: x, cz: 0.028 });
  });
  const sleeve = loft(rings, {
    segs: 16,
    deform: (p, th) => {
      const k = Math.abs(Math.sin(th * 4));
      p.x += Math.sin(th) * 0.003 * k;
      p.z -= Math.cos(th) * 0.003 * k;
    },
  });
  both(c, sleeve, (S) => ({
    ...CLOTH,
    color: C.gambeson,
    group: 'arms',
    weights: (p) => {
      const t = smoothstep(1.1, 1.18, p.y);
      const sh = smoothstep(1.38, 1.46, p.y) * 0.5;
      return [
        ['forearm' + S, 1 - t],
        ['upperArm' + S, t * (1 - sh)],
        ['shoulder' + S, t * sh],
      ];
    },
  }));
}

function buildLeatherBracers(c: Ctx): void {
  const x = 0.2;
  const br = loft(
    [
      { y: 0.9, rx: 0.052, rzF: 0.054, rzB: 0.054, cx: x, cz: 0.03 },
      { y: 0.98, rx: 0.055, rzF: 0.057, rzB: 0.058, cx: x, cz: 0.03 },
      { y: 1.06, rx: 0.062, rzF: 0.063, rzB: 0.066, cx: x, cz: 0.03 },
    ],
    { segs: 12, thickness: 0.005 },
  );
  both(c, br, (S) => ({ ...LEATHER, color: C.leather, group: 'arms', bone: 'forearm' + S }));
  const laces: THREE.BufferGeometry[] = [];
  for (const y of [0.93, 0.975, 1.02]) laces.push(xf(box(0.005, 0.006, 0.03), { t: [x - 0.058, y, 0.03] }));
  both(c, mergeList(laces), (S) => ({ ...LEATHER, color: C.leatherDark, group: 'arms', bone: 'forearm' + S }));
}

function buildSimpleCouters(c: Ctx): void {
  const x = 0.2;
  const cop = loft(
    [
      { y: 0, rx: 0.062, rz: 0.062 },
      { y: 0.022, rx: 0.056, rz: 0.056 },
      { y: 0.04, rx: 0.036, rz: 0.036 },
    ],
    { segs: 10, apexTop: v3(0, 0.052, 0), thickness: 0.004 },
  );
  xf(cop, { r: [Math.PI / 2, 0, 0], t: [x, 1.14, 0.018] });
  both(c, cop, (S) => ({ ...METAL, color: C.steelDark, group: 'arms', weights: vblend('forearm' + S, 'upperArm' + S, 1.1, 1.19) }));
  const knee = loft(
    [
      { y: 0, rx: 0.066, rz: 0.062 },
      { y: 0.024, rx: 0.058, rz: 0.054 },
      { y: 0.04, rx: 0.036, rz: 0.034 },
    ],
    { segs: 10, apexTop: v3(0, 0.052, 0), thickness: 0.004 },
  );
  xf(knee, { r: [-Math.PI / 2, 0, 0], t: [0.097, 0.505, -0.03] });
  both(c, knee, (S) => ({ ...METAL, color: C.steelDark, group: 'legs', weights: vblend('shin' + S, 'thigh' + S, 0.47, 0.545) }));
}

function buildKettleHelm(c: Ctx): void {
  const cz = 0.012;
  // Eisenhut mit breiter Krempe
  const hat = loft(
    [
      { y: 1.705, rx: 0.176, rzF: 0.186, rzB: 0.19, cz },
      { y: 1.72, rx: 0.168, rzF: 0.178, rzB: 0.182, cz },
      { y: 1.735, rx: 0.106, rzF: 0.116, rzB: 0.122, cz },
      { y: 1.8, rx: 0.1, rzF: 0.108, rzB: 0.116, cz },
      { y: 1.85, rx: 0.074, rzF: 0.078, rzB: 0.086, cz },
      { y: 1.885, rx: 0.036, rzF: 0.038, rzB: 0.044, cz },
    ],
    { segs: 20, apexTop: v3(0, 1.9, cz), thickness: 0.005 },
  );
  c.b.add(hat, { ...METAL, color: C.steelDark, group: 'helmet', bone: 'head' });
  // Kettenhaube um Kopf und Hals, Gesicht frei
  const coif = loft(
    [
      { y: 1.43, rx: 0.19, rzF: 0.155, rzB: 0.155, cz },
      { y: 1.47, rx: 0.14, rzF: 0.12, rzB: 0.128, cz },
      { y: 1.53, rx: 0.099, rzF: 0.1, rzB: 0.11, cz },
      { y: 1.6, rx: 0.094, rzF: 0.104, rzB: 0.112, cz },
      { y: 1.68, rx: 0.095, rzF: 0.108, rzB: 0.116, cz },
      { y: 1.735, rx: 0.098, rzF: 0.108, rzB: 0.116, cz },
    ],
    {
      segs: 20,
      thickness: 0.005,
      deform: (p, th, i) => {
        const a = Math.abs(Math.atan2(Math.sin(th), Math.cos(th)));
        if (i >= 3 && a < 0.72) {
          // Gesichtsoeffnung: Ecken nach hinten ziehen
          p.z += 0.07 * (1 - a / 0.72);
        }
        if (i === 2 && a < 0.6) p.z -= 0.006;
      },
    },
  );
  c.b.add(coif, { ...CHAIN, color: C.chain, group: 'helmet', weights: weights3('chest', 'neck', 'head', 1.45, 1.5, 1.53, 1.58) });
  // kleiner Federbusch
  const plumeDef = CHAINS.find((d) => d.name === 'plume')!.columns[0]!;
  const pts = plumeDef.map((q) => v3(q[0]!, q[1]! - 0.02, q[2]!));
  const plume = tube(pts, [
    [0.008, 0.01],
    [0.014, 0.02],
    [0.012, 0.018],
    [0.005, 0.007],
  ], { segs: 6, capEnd: true, capStart: true });
  c.b.add(plume, { ...CLOTH, color: c.accentLight, group: 'helmet', weights: chainW('plume'), noAO: true });
}

function buildHood(c: Ctx): void {
  const cz = 0.012;
  const col = c.accentCape;
  const W = weights3('chest', 'neck', 'head', 1.45, 1.5, 1.53, 1.58);
  // Kragen (Gugel) ueber den Schultern
  const lower = loft(
    [
      { y: 1.405, rx: 0.225, rzF: 0.175, rzB: 0.17, cz },
      { y: 1.46, rx: 0.16, rzF: 0.13, rzB: 0.14, cz },
      { y: 1.53, rx: 0.103, rzF: 0.106, rzB: 0.114, cz },
      { y: 1.555, rx: 0.1, rzF: 0.112, rzB: 0.116, cz },
    ],
    { segs: 20, thickness: 0.008, deform: (p, th, i) => i === 0 && (p.y += Math.sin(th * 5) * 0.012) },
  );
  // Gesichtsausschnitt: vorne offen
  const band = loft(
    [
      { y: 1.55, rx: 0.1, rzF: 0.112, rzB: 0.116, cz },
      { y: 1.64, rx: 0.1, rzF: 0.113, rzB: 0.12, cz },
      { y: 1.728, rx: 0.099, rzF: 0.114, rzB: 0.121, cz },
    ],
    { segs: 16, arc: [0.72, Math.PI * 2 - 0.72], thickness: 0.008 },
  );
  // Kopfteil mit Zipfel nach hinten
  const top = loft(
    [
      { y: 1.72, rx: 0.1, rzF: 0.116, rzB: 0.121, cz },
      { y: 1.79, rx: 0.086, rzF: 0.097, rzB: 0.112, cz: cz + 0.01 },
      { y: 1.83, rx: 0.054, rzF: 0.058, rzB: 0.082, cz: cz + 0.025 },
    ],
    { segs: 20, thickness: 0.008, apexTop: v3(0, 1.845, 0.11) },
  );
  // Umschlag um das Gesicht
  const rim = tube(
    [v3(-0.068, 1.55, -0.078), v3(-0.074, 1.64, -0.085), v3(-0.066, 1.72, -0.09), v3(0, 1.735, -0.118), v3(0.066, 1.72, -0.09), v3(0.074, 1.64, -0.085), v3(0.068, 1.55, -0.078)],
    [
      [0.012, 0.012],
      [0.012, 0.012],
      [0.012, 0.012],
      [0.012, 0.012],
      [0.012, 0.012],
      [0.012, 0.012],
      [0.012, 0.012],
    ],
    { segs: 5, side: v3(0, 0, -1) },
  );
  c.b.add(mergeList([lower, band, top]), { ...CLOTH, color: col, group: 'helmet', weights: W });
  c.b.add(rim, { ...CLOTH, color: col.clone().multiplyScalar(0.8), group: 'helmet', bone: 'head' });
}

// ------------------------------------------------------------------ Gesamtaufbau

export function buildFighterModel(b: FighterMeshBuilder, accentHex: number, tier: ArmorTier): void {
  const accent = new THREE.Color(accentHex);
  // etwas erdiger: leicht Richtung Braun ziehen
  accent.lerp(new THREE.Color(0x5a4630), 0.12);
  const accentCape = accent.clone().multiplyScalar(0.72);
  const accentLight = accent.clone().lerp(new THREE.Color(0xffffff), 0.08).multiplyScalar(1.15);
  const c: Ctx = { b, tier, accent, accentCape, accentLight };

  buildHead(c);
  buildBaseBody(c);

  if (tier === 'heavy') {
    buildBascinet(c);
    buildCuirass(c);
    buildPauldrons(c);
    buildArmPlates(c);
    buildLegPlates(c);
    buildTabard(c, true);
    buildCape(c);
  } else if (tier === 'medium') {
    buildKettleHelm(c);
    buildMailHauberk(c, true);
    buildBelts(c);
    buildSimpleCouters(c);
    buildFist(c, false, 'arms');
    buildTabard(c, true);
    buildCape(c);
  } else {
    buildHood(c);
    buildGambesonSleeves(c);
    buildLeatherBracers(c);
    buildBelts(c);
    buildFist(c, false, 'arms');
    buildTabard(c, true);
  }
}
