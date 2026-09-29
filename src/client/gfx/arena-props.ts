import * as THREE from 'three';
import { ARENA_RADIUS } from '../../shared/sim.js';
import { Buckets, WALL_INNER, box, boxB, jiggle, lathe, mat, part, polar, polarPos, type Rand } from './arena-common.js';
import { addCloth, addChain, angDiff, cellRect, type StructureInfo, type Spot, TOWER_ANGLES } from './arena-structures.js';

// Randsteine, Stroh, Faesser, Kisten, Heu, Saecke, Waffenstaender, Puppen, Feuerkoerbe,
// Banner, Wimpel, Wappenschilde, Efeu.

export interface PropInfo {
  fires: Spot[]; // Feuerkoerbe (Flamme)
  lights: Spot[]; // Positionen der (hoechstens 3) Feuer-Punktlichter
}

function at(frame: THREE.Matrix4, x: number, y: number, z: number, ry = 0, rx = 0, rz = 0, s = 1): THREE.Matrix4 {
  return frame.clone().multiply(mat(x, y, z, ry, rx, rz, s, s, s));
}

export function buildCurb(b: Buckets, rand: Rand): void {
  const n = 88;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + (rand() - 0.5) * 0.004;
    const r = ARENA_RADIUS + 0.26;
    const len = ((Math.PI * 2 * r) / n) * 0.96;
    const g = jiggle(boxB(len, 0.1 + rand() * 0.03, 0.34), 0.025, i);
    b.add('stone', part(g, at(polar(a, r), 0, -0.03, 0, (rand() - 0.5) * 0.04), { color: new THREE.Color(0xd8d2c8).multiplyScalar(0.85 + rand() * 0.2), groundAO: 0.2 }));
  }
}

/** Strohhalme verstreut: mehr am Rand und bei den Heuballen. */
export function buildStraw(b: Buckets, rand: Rand, clusters: Array<[number, number, number]>): void {
  const g0 = new THREE.PlaneGeometry(0.018, 0.2);
  g0.rotateX(-Math.PI / 2);
  const add = (x: number, z: number) => {
    const c = new THREE.Color().setHSL(0.1 + rand() * 0.03, 0.35 + rand() * 0.2, 0.28 + rand() * 0.14);
    b.add('generic', part(g0.clone(), mat(x, 0.012 + rand() * 0.01, z, rand() * Math.PI, (rand() - 0.5) * 0.3, 0, 0.8, 1, 0.4 + rand() * 0.6), { color: c, uv: 'none' }));
  };
  for (let i = 0; i < 700; i++) {
    const a = rand() * Math.PI * 2;
    const r = ARENA_RADIUS + 0.3 + rand() * 2.4;
    add(Math.sin(a) * r, Math.cos(a) * r);
  }
  for (let i = 0; i < 70; i++) {
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(rand()) * ARENA_RADIUS;
    add(Math.sin(a) * r, Math.cos(a) * r);
  }
  for (const [x, z, rad] of clusters) {
    for (let i = 0; i < 90; i++) {
      const a = rand() * Math.PI * 2;
      const r = Math.pow(rand(), 0.7) * rad;
      add(x + Math.sin(a) * r, z + Math.cos(a) * r);
    }
  }
  g0.dispose();
}

// ------------------------------------------------------------------ Einzelne Requisiten

function barrel(b: Buckets, m: THREE.Matrix4, rand: Rand, lying = false): void {
  const h = 0.95;
  const r0 = 0.34;
  const r1 = 0.42;
  const prof: Array<[number, number]> = [];
  for (let k = 0; k <= 6; k++) {
    const t = k / 6;
    prof.push([r0 + (r1 - r0) * Math.sin(t * Math.PI), t * h]);
  }
  const M = lying ? m.clone().multiply(mat(0, r1, h / 2, 0, Math.PI / 2)).multiply(mat(0, -h / 2, 0)) : m;
  const tint = new THREE.Color(0xc4a484).multiplyScalar(0.8 + rand() * 0.25);
  b.add('wood', part(lathe(prof, 12, r1, 0.2, 0), M, { uv: 'keep', uvSwap: true, color: tint, groundAO: lying ? 0 : 0.3 }));
  b.add('wood', part(new THREE.CircleGeometry(r0, 12), M.clone().multiply(mat(0, h - 0.03, 0, 0, -Math.PI / 2)), { color: tint.clone().multiplyScalar(0.8) }));
  for (const t of [0.12, 0.34, 0.66, 0.88]) {
    const rr = r0 + (r1 - r0) * Math.sin(t * Math.PI) + 0.012;
    b.add('iron', part(lathe([[rr, -0.03], [rr, 0.03]], 12), M.clone().multiply(mat(0, t * h, 0)), { color: 0x3b3835, uv: 'none' }));
  }
}

function crate(b: Buckets, m: THREE.Matrix4, s: number, rand: Rand): void {
  const tint = new THREE.Color(0xb89a7c).multiplyScalar(0.8 + rand() * 0.25);
  b.add('wood', part(boxB(s, s, s), m, { color: tint, groundAO: 0.3 }));
  const f = 0.07;
  const dark = tint.clone().multiplyScalar(0.7);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      b.add('wood', part(boxB(f, s + 0.01, f), at(m, sx * (s / 2 - f / 2 + 0.01), 0, sz * (s / 2 - f / 2 + 0.01)), { color: dark, uvSwap: true }));
    }
  }
  for (const y of [f / 2, s - f / 2]) {
    for (const sz of [-1, 1]) b.add('wood', part(box(s + 0.02, f, f), at(m, 0, y, sz * (s / 2 + 0.005)), { color: dark }));
    for (const sx of [-1, 1]) b.add('wood', part(box(f, f, s + 0.02), at(m, sx * (s / 2 + 0.005), y, 0), { color: dark }));
  }
  // Diagonale
  for (const sz of [-1, 1]) {
    b.add('wood', part(box(s * 1.3, f * 0.9, 0.03), at(m, 0, s / 2, sz * (s / 2 + 0.015), 0, 0, Math.PI / 4 * sz), { color: dark }));
  }
}

function hayBale(b: Buckets, m: THREE.Matrix4, rand: Rand): void {
  const g = jiggle(new THREE.BoxGeometry(1.15, 0.52, 0.6, 3, 2, 2), 0.05, Math.floor(rand() * 1000));
  g.translate(0, 0.26, 0);
  b.add('generic', part(g, m, { color: new THREE.Color().setHSL(0.115, 0.5, 0.36 + rand() * 0.08), groundAO: 0.35, uv: 'none' }));
  for (const x of [-0.3, 0.3]) {
    b.add('generic', part(box(0.03, 0.56, 0.64), at(m, x, 0.26, 0), { color: 0x4a3a28, uv: 'none' }));
  }
  // Halme
  const hg = new THREE.PlaneGeometry(0.02, 0.18);
  for (let k = 0; k < 14; k++) {
    const side = rand() < 0.5 ? -1 : 1;
    b.add('generic', part(hg.clone(), at(m, (rand() - 0.5) * 1.1, 0.1 + rand() * 0.4, side * 0.31, rand(), side * 0.8, rand() * 2), { color: 0xc9a85a, uv: 'none' }));
  }
  hg.dispose();
}

function sack(b: Buckets, m: THREE.Matrix4, rand: Rand): void {
  const g = jiggle(new THREE.IcosahedronGeometry(0.3, 1), 0.07, Math.floor(rand() * 1000));
  g.scale(1.15, 0.72, 0.85);
  g.translate(0, 0.2, 0);
  b.add('generic', part(g, m, { color: new THREE.Color(0x9c8866).multiplyScalar(0.85 + rand() * 0.25), groundAO: 0.35, uv: 'none' }));
  b.add('generic', part(new THREE.CylinderGeometry(0.06, 0.1, 0.12, 5), at(m, 0.28, 0.32, 0, 0, 0, -1.2), { color: 0x8a7658, uv: 'none' }));
}

function weaponRack(b: Buckets, m: THREE.Matrix4, rand: Rand): void {
  const wood = { color: 0xa88a6c };
  b.add('wood', part(boxB(1.8, 0.1, 0.55), m, { ...wood, groundAO: 0.2 }));
  for (const x of [-0.85, 0.85]) b.add('wood', part(boxB(0.09, 1.25, 0.09), at(m, x, 0.1, -0.15), { ...wood, uvSwap: true }));
  b.add('wood', part(box(1.8, 0.08, 0.1), at(m, 0, 1.2, -0.15), wood));
  b.add('wood', part(box(1.8, 0.06, 0.08), at(m, 0, 0.55, -0.15), wood));
  for (let k = 0; k < 6; k++) {
    const x = -0.7 + k * 0.28;
    const tilt = (rand() - 0.5) * 0.08;
    if (k % 3 === 2) {
      // Schwert
      b.add('iron', part(box(0.05, 0.9, 0.012), at(m, x, 0.62, -0.05, 0, -0.08, tilt), { color: 0xb8bcc2, uv: 'none' }));
      b.add('iron', part(box(0.22, 0.035, 0.035), at(m, x, 1.08, -0.1, 0, -0.08, tilt), { color: 0x4a4540, uv: 'none' }));
      b.add('wood', part(box(0.035, 0.2, 0.035), at(m, x, 1.2, -0.11, 0, -0.08, tilt), { color: 0x4a3222 }));
    } else {
      // Speer
      b.add('wood', part(new THREE.CylinderGeometry(0.018, 0.022, 2.1, 5), at(m, x, 1.12, -0.1, 0, -0.1, tilt), { color: 0x8a6a48, uvSwap: true }));
      b.add('iron', part(new THREE.ConeGeometry(0.035, 0.26, 4), at(m, x + tilt * -1.1, 2.28, -0.21, 0, -0.1, tilt), { color: 0x9a9ea4, uv: 'none' }));
    }
  }
  // Rundschild angelehnt
  const sc = cellRect(Math.floor(rand() * 7));
  const shield = new THREE.CircleGeometry(0.36, 12);
  b.add('cloth', part(shieldUV(shield, sc), at(m, 0.55, 0.42, 0.12, 0, -0.25), { uv: 'keep' }));
  b.add('wood', part(new THREE.CylinderGeometry(0.37, 0.37, 0.04, 12), at(m, 0.55, 0.42, 0.1, 0, -0.25 + Math.PI / 2), { color: 0x6a5038, uv: 'none' }));
  b.add('iron', part(new THREE.SphereGeometry(0.07, 6, 3, 0, Math.PI * 2, 0, Math.PI / 2), at(m, 0.55, 0.42, 0.125, 0, -0.25 + Math.PI / 2), { color: 0x6a6660, uv: 'none' }));
}

function shieldUV(g: THREE.BufferGeometry, r: [number, number, number, number]): THREE.BufferGeometry {
  g.computeBoundingBox();
  const bb = g.boundingBox!;
  const pos = g.attributes.position as THREE.BufferAttribute;
  const uv = new Float32Array(pos.count * 2);
  // Wappenbild sitzt im oberen Teil der Zelle (Mitte bei 40 % von oben)
  const cu = (r[0] + r[2]) / 2;
  const cv = r[3] - (r[3] - r[1]) * 0.4;
  const hu = (r[2] - r[0]) * 0.5;
  const hv = (r[3] - r[1]) * 0.3;
  const sx = bb.max.x - bb.min.x;
  const sy = bb.max.y - bb.min.y;
  for (let i = 0; i < pos.count; i++) {
    const fx = ((pos.getX(i) - bb.min.x) / sx) * 2 - 1;
    const fy = ((pos.getY(i) - bb.min.y) / sy) * 2 - 1;
    uv[i * 2] = cu + fx * hu;
    uv[i * 2 + 1] = cv + fy * hv * 1.05;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

function pell(b: Buckets, m: THREE.Matrix4, rand: Rand): void {
  const tint = new THREE.Color(0x9c7c5c).multiplyScalar(0.85 + rand() * 0.2);
  b.add('wood', part(new THREE.CylinderGeometry(0.11, 0.13, 1.75, 7), at(m, 0, 0.875, 0), { color: tint, uvSwap: true, groundAO: 0.3 }));
  b.add('wood', part(new THREE.CylinderGeometry(0.13, 0.13, 0.08, 7), at(m, 0, 1.2, 0), { color: tint.clone().multiplyScalar(0.6) }));
  b.add('stone', part(jiggle(new THREE.CylinderGeometry(0.3, 0.36, 0.2, 7), 0.03, 5), at(m, 0, 0.08, 0), { color: 0xcfc8bd, groundAO: 0.3 }));
}

function strawDummy(b: Buckets, m: THREE.Matrix4, rand: Rand): void {
  b.add('wood', part(new THREE.CylinderGeometry(0.06, 0.07, 1.9, 6), at(m, 0, 0.95, 0), { color: 0x7a5c40, uvSwap: true, groundAO: 0.3 }));
  b.add('wood', part(box(1.1, 0.08, 0.08), at(m, 0, 1.45, 0), { color: 0x7a5c40 }));
  const body = jiggle(new THREE.CylinderGeometry(0.24, 0.2, 0.75, 7, 2), 0.04, 21);
  b.add('generic', part(body, at(m, 0, 1.2, 0), { color: 0xc8a660, uv: 'none' }));
  const head = jiggle(new THREE.IcosahedronGeometry(0.16, 1), 0.03, 22);
  b.add('generic', part(head, at(m, 0, 1.78, 0), { color: 0xb0905a, uv: 'none' }));
  for (const sx of [-1, 1]) b.add('generic', part(jiggle(new THREE.CylinderGeometry(0.07, 0.06, 0.45, 5), 0.02, 23), at(m, sx * 0.42, 1.45, 0, 0, 0, Math.PI / 2), { color: 0xc8a660, uv: 'none' }));
  // Wams mit Farbe
  const cell = cellRect(Math.floor(rand() * 7));
  b.add('cloth', part(shieldUV(new THREE.PlaneGeometry(0.42, 0.5), cell), at(m, 0, 1.22, 0.23), { uv: 'keep' }));
  b.add('generic', part(new THREE.CylinderGeometry(0.2, 0.26, 0.08, 7), at(m, 0, 0.04, 0), { color: 0x5a4a38, uv: 'none' }));
}

function archeryTarget(b: Buckets, m: THREE.Matrix4): void {
  const wood = { color: 0x8a6a4c, uvSwap: true };
  b.add('wood', part(box(0.06, 1.7, 0.06), at(m, -0.35, 0.8, -0.35, 0, 0.3), wood));
  b.add('wood', part(box(0.06, 1.7, 0.06), at(m, 0.35, 0.8, -0.35, 0, 0.3), wood));
  b.add('wood', part(box(0.06, 1.5, 0.06), at(m, 0, 0.7, 0.3, 0, -0.35), wood));
  const face = at(m, 0, 1.05, -0.12, 0, -0.3);
  b.add('generic', part(new THREE.CylinderGeometry(0.5, 0.5, 0.18, 14), face.clone().multiply(mat(0, 0, 0, 0, Math.PI / 2)), { color: 0xc4a058, uv: 'none' }));
  const rings: Array<[number, number]> = [
    [0.44, 0xe6dcc4],
    [0.34, 0x2f5d8f],
    [0.24, 0xa3241d],
    [0.12, 0xe3b53c],
  ];
  rings.forEach(([r, c], k) => {
    b.add('generic', part(new THREE.CircleGeometry(r, 14), at(face, 0, 0, 0.095 + k * 0.002), { color: c, uv: 'none' }));
  });
  for (let k = 0; k < 3; k++) {
    b.add('wood', part(new THREE.CylinderGeometry(0.008, 0.008, 0.6, 3), at(face, (k - 1) * 0.12, 0.05 * k, 0.35, 0, Math.PI / 2 + 0.15 * (k - 1)), { color: 0x6a5038 }));
    b.add('generic', part(box(0.02, 0.07, 0.1), at(face, (k - 1) * 0.12 - 0.02 * (k - 1), 0.05 * k + 0.08 * (k - 1), 0.62), { color: 0xe8e0d0, uv: 'none' }));
  }
}

function fireBasket(b: Buckets, m: THREE.Matrix4, info: PropInfo): void {
  const iron = { color: 0x2e2c2a, uv: 'none' as const };
  for (let k = 0; k < 3; k++) {
    const ph = (k / 3) * Math.PI * 2;
    b.add('iron', part(box(0.04, 1.35, 0.04), at(m, Math.sin(ph) * 0.2, 0.65, Math.cos(ph) * 0.2, ph, 0.18), iron));
  }
  const bowl: Array<[number, number]> = [
    [0.08, 1.2],
    [0.3, 1.28],
    [0.36, 1.55],
  ];
  b.add('iron', part(lathe(bowl, 10), m, iron));
  b.add('iron', part(lathe([...bowl].reverse().map(([r, y]) => [r - 0.02, y] as [number, number]), 10), m, iron));
  for (let k = 0; k < 10; k++) {
    const ph = (k / 10) * Math.PI * 2;
    b.add('iron', part(box(0.03, 0.22, 0.03), at(m, Math.sin(ph) * 0.37, 1.62, Math.cos(ph) * 0.37, ph, 0.25), iron));
  }
  // Glut und Scheite
  b.add('generic', part(new THREE.CylinderGeometry(0.3, 0.25, 0.12, 8), at(m, 0, 1.45, 0), { color: 0x1a120c, uv: 'none' }));
  for (let k = 0; k < 4; k++) {
    b.add('wood', part(new THREE.CylinderGeometry(0.045, 0.045, 0.5, 5), at(m, 0, 1.55, 0, k * 0.8, 0.6, 0), { color: 0x3a2a1c }));
  }
  info.fires.push(spot(at(m, 0, 1.52, 0)));
}

function bench(b: Buckets, m: THREE.Matrix4): void {
  const wood = { color: 0xa88a6c };
  b.add('wood', part(boxB(1.6, 0.07, 0.36), at(m, 0, 0.42, 0), wood));
  for (const x of [-0.65, 0.65]) b.add('wood', part(boxB(0.08, 0.42, 0.3), at(m, x, 0, 0), { ...wood, uvSwap: true, groundAO: 0.3 }));
}

function bucket(b: Buckets, m: THREE.Matrix4): void {
  b.add('wood', part(lathe([[0.15, 0], [0.19, 0.32]], 10, 0.19, 0.2, 0), m, { color: 0xa0805e, uv: 'keep', uvSwap: true, groundAO: 0.3 }));
  b.add('iron', part(lathe([[0.18, 0.24], [0.185, 0.28]], 10), m, { color: 0x3a3835, uv: 'none' }));
  b.add('generic', part(new THREE.CircleGeometry(0.17, 10), at(m, 0, 0.26, 0, 0, -Math.PI / 2), { color: 0x2a3438, uv: 'none' }));
}

function spot(m: THREE.Matrix4): Spot {
  const p = new THREE.Vector3().setFromMatrixPosition(m);
  return { x: p.x, y: p.y, z: p.z, ry: 0 };
}

/** Platz am Mauerfuss: Winkel a, Abstand d von der Mauer-Innenkante, lokal +Z zur Mitte. */
function wallSpot(a: number, d: number, rot = 0): THREE.Matrix4 {
  const [x, z] = polarPos(a, WALL_INNER - d);
  return mat(x, 0, z, a + Math.PI + rot);
}

export function buildProps(b: Buckets, rand: Rand, info: PropInfo): Array<[number, number, number]> {
  const strawClusters: Array<[number, number, number]> = [];
  const pos = (m: THREE.Matrix4): [number, number] => [m.elements[12]!, m.elements[14]!];

  // Faesser-Gruppen
  const barrelGroups: Array<[number, number]> = [
    [Math.PI + 0.44, 3],
    [0.55, 2],
    [-0.62, 3],
    [2.05, 2],
    [-2.55, 2],
  ];
  for (const [a, n] of barrelGroups) {
    for (let k = 0; k < n; k++) {
      barrel(b, wallSpot(a + (k - (n - 1) / 2) * 0.058, 0.55 + (k % 2) * 0.15, rand() * 6), rand);
    }
    if (n === 3) barrel(b, wallSpot(a + 0.13, 1.05, 0.3), rand, true);
  }
  // Kisten (gestapelt)
  for (const [a, stack] of [
    [Math.PI - 0.47, 2],
    [1.12, 1],
    [-0.98, 2],
    [2.72, 1],
    [-2.78, 1],
  ] as Array<[number, number]>) {
    const s = 0.72;
    const m = wallSpot(a, 0.5, (rand() - 0.5) * 0.3);
    crate(b, m, s, rand);
    crate(b, wallSpot(a + 0.055, 0.55, (rand() - 0.5) * 0.4), 0.6, rand);
    if (stack > 1) crate(b, at(m, 0.05, s, 0.02, 0.4), 0.55, rand);
  }
  // Heu
  for (const [a, n] of [
    [1.3, 3],
    [-1.62, 2],
    [2.35, 2],
  ] as Array<[number, number]>) {
    for (let k = 0; k < n; k++) hayBale(b, wallSpot(a + k * 0.085, 0.5, (rand() - 0.5) * 0.3), rand);
    if (n === 3) hayBale(b, at(wallSpot(a + 0.042, 0.5, 0.1), 0, 0.52, 0), rand);
    const [x, z] = pos(wallSpot(a + 0.08, 1.0));
    strawClusters.push([x, z, 1.8]);
  }
  // Saecke
  for (const [a, n] of [
    [Math.PI + 0.55, 4],
    [1.72, 3],
    [-0.4, 3],
  ] as Array<[number, number]>) {
    for (let k = 0; k < n; k++) sack(b, wallSpot(a + (k % 3) * 0.045, 0.45 + Math.floor(k / 3) * 0.02, rand() * 0.6), rand);
    if (n >= 3) sack(b, at(wallSpot(a + 0.022, 0.45, 0.2), 0, 0.33, 0), rand);
  }
  // Trainingsecke (-X)
  weaponRack(b, wallSpot(-1.45, 0.42), rand);
  weaponRack(b, wallSpot(-1.25, 0.42), rand);
  weaponRack(b, wallSpot(2.55, 0.42), rand);
  pell(b, wallSpot(-1.78, 0.75), rand);
  pell(b, wallSpot(-1.86, 0.8), rand);
  strawDummy(b, wallSpot(-2.02, 0.7, 0.2), rand);
  archeryTarget(b, wallSpot(1.52, 0.7, 0.1));
  bench(b, wallSpot(0.72, 0.35));
  bench(b, wallSpot(-2.3, 0.35));
  bucket(b, wallSpot(0.85, 0.45));
  bucket(b, wallSpot(-1.18, 0.5));
  bucket(b, wallSpot(Math.PI + 0.62, 0.9));
  // Leiter zum Wehrgang
  {
    const m = wallSpot(-0.8, 0.95);
    const L = at(m, 0, 0, 0, 0, -0.19);
    for (const x of [-0.25, 0.25]) b.add('wood', part(boxB(0.07, 5.0, 0.07), at(L, x, 0, 0), { color: 0x9a7c60, uvSwap: true }));
    for (let k = 0; k < 13; k++) b.add('wood', part(box(0.5, 0.05, 0.05), at(L, 0, 0.3 + k * 0.36, 0), { color: 0x9a7c60 }));
  }
  // Feuerkoerbe: neben dem Tor und vor dem Palas
  fireBasket(b, wallSpot(Math.PI - 0.35, 0.7), info);
  fireBasket(b, wallSpot(Math.PI + 0.35, 0.7), info);
  fireBasket(b, wallSpot(0.12, 0.62), info);
  fireBasket(b, wallSpot(0.93, 0.62), info);
  fireBasket(b, wallSpot(-0.9, 0.62), info);
  const lp = (a: number, d: number, y: number): Spot => {
    const [x, z] = polarPos(a, WALL_INNER - d);
    return { x, y, z, ry: 0 };
  };
  info.lights.push(lp(Math.PI, 1.3, 2.3), lp(0.93, 0.9, 2.1), lp(-0.9, 0.9, 2.1));
  // Ketten an der Mauer
  addChain(b, polar(-1.03, WALL_INNER - 0.02, 3.2).multiply(mat(0, 0, 0.03)), 1.4);
  addChain(b, polar(-1.1, WALL_INNER - 0.02, 3.2).multiply(mat(0, 0, 0.03)), 1.1);
  return strawClusters;
}

// ------------------------------------------------------------------ Stoffe und Wappen

export function buildCloth(b: Buckets, rand: Rand, info: StructureInfo): void {
  // Lange Banner zwischen den Strebepfeilern
  const bannerAngles: Array<[number, number]> = [
    [1.0, 1],
    [2.12, 2],
    [-1.0, 5],
    [-2.12, 0],
    [2.9, 3],
    [-2.9, 6],
  ];
  for (const [a, cell] of bannerAngles) {
    const F = polar(a, WALL_INNER, 4.3).multiply(mat(0, 0, 0.18));
    info.banners.push({ m: F, w: 1.05, len: 2.6, cell });
  }
  for (const bn of info.banners) {
    const segX = 4;
    const segY = 10;
    const g = new THREE.PlaneGeometry(bn.w, bn.len, segX, segY);
    g.translate(0, -bn.len / 2, 0);
    // Schwalbenschwanz
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const y = p.getY(i);
      if (y < -bn.len + 0.01) p.setY(i, y + (1 - Math.abs(x) / (bn.w / 2)) * bn.len * 0.16);
    }
    addCloth(b, g, bn.m, bn.cell, 0.07, 1.3 + rand() * 0.4, bn.len, 'y');
    b.add('wood', part(new THREE.CylinderGeometry(0.035, 0.035, bn.w + 0.25, 6), at(bn.m, 0, 0.03, 0, 0, 0, Math.PI / 2), { color: 0x4a3626 }));
    for (const sx of [-1, 1]) {
      b.add('iron', part(new THREE.IcosahedronGeometry(0.05, 0), at(bn.m, sx * (bn.w / 2 + 0.13), 0.03, 0), { color: 0xb08a3a, uv: 'none' }));
    }
  }
  // Wimpel an den Turmspitzen
  for (const pn of info.pennants) {
    const g = new THREE.PlaneGeometry(pn.len, pn.len * 0.36, 12, 2);
    g.translate(pn.len / 2, -pn.len * 0.18, 0);
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const t = p.getX(i) / pn.len;
      const y = p.getY(i) + pn.len * 0.18;
      p.setY(i, y * (1 - t * 0.75) - pn.len * 0.18 * (1 - t * 0.75) - t * 0.15);
    }
    const r = cellRect(pn.cell);
    const rect: [number, number, number, number] = [r[0], r[1] + (r[3] - r[1]) * 0.45, r[2], r[3] - (r[3] - r[1]) * 0.25];
    addCloth(b, g, pn.m, pn.cell, 0.28, 6.5, pn.len, 'x', rect);
  }
  // Wappenschilde an der Mauer
  const shieldAngles: Array<[number, number]> = [
    [0.72, 2],
    [-0.72, 1],
    [1.8, 4],
    [-1.8, 3],
    [2.45, 5],
    [-2.45, 0],
  ];
  for (const [a, cell] of shieldAngles) {
    const tooClose = TOWER_ANGLES.some((t) => angDiff(a, t) < 0.12);
    if (tooClose) continue;
    info.shields.push({ m: polar(a, WALL_INNER, 3.3).multiply(mat(0, 0, 0.05)), size: 0.8, cell });
  }
  for (const sh of info.shields) {
    const s = sh.size;
    const shape = new THREE.Shape();
    shape.moveTo(-0.5 * s, 0.55 * s);
    shape.lineTo(0.5 * s, 0.55 * s);
    shape.lineTo(0.5 * s, 0.05 * s);
    shape.quadraticCurveTo(0.46 * s, -0.5 * s, 0, -0.72 * s);
    shape.quadraticCurveTo(-0.46 * s, -0.5 * s, -0.5 * s, 0.05 * s);
    shape.closePath();
    const front = new THREE.ShapeGeometry(shape, 6);
    b.add('cloth', part(shieldUV(front, cellRect(sh.cell)), at(sh.m, 0, 0, 0.065), { uv: 'keep' }));
    const body = new THREE.ExtrudeGeometry(shape, { depth: 0.06, bevelEnabled: false, curveSegments: 6 });
    b.add('iron', part(body, at(sh.m, 0, 0, 0), { color: 0x4a4540, uv: 'none' }));
  }
}

export function buildIvy(b: Buckets, rand: Rand): void {
  const patches: Array<[number, number, number, number, boolean]> = [
    // Winkel, Breite, Hoehe, y-Start, haengend
    [-0.55, 2.2, 3.6, 0, false],
    [1.62, 1.8, 3.0, 0, false],
    [-2.65, 2.4, 4.2, 0, false],
    [2.62, 1.6, 2.6, 0, false],
    [-1.52, 1.8, 1.9, 2.9, true],
    [0.95, 1.4, 1.6, 3.2, true],
    [-0.82, 1.2, 1.4, 3.4, true],
    [2.25, 1.5, 1.8, 3.0, true],
    [Math.PI + 0.48, 1.6, 3.4, 0, false],
  ];
  for (const [a, w, h, y0, hang] of patches) {
    const F = polar(a, WALL_INNER, y0).multiply(mat(0, 0, 0.04 + rand() * 0.02));
    const g = new THREE.PlaneGeometry(w, h, 2, 3);
    g.translate(0, h / 2, 0);
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) {
      uv.setXY(i, uv.getX(i) * (w / 2.2), hang ? 1 - uv.getY(i) : uv.getY(i));
    }
    b.add('ivy', part(g, F, { uv: 'keep', color: new THREE.Color().setHSL(0.25, 0.2, 0.7 + rand() * 0.2) }));
  }
}
