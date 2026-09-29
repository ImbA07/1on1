import * as THREE from 'three';
import {
  Buckets,
  WALL_INNER,
  box,
  boxB,
  lathe,
  mat,
  part,
  polar,
  polarPos,
  profilePrism,
  type Rand,
} from './arena-common.js';

// Mauern, Tuerme, Torhaus, Palas mit Zuschauer-Galerie, Tribuene, Bergfried, Haeuser.

export const WALL_OUT = 16.6;
export const WALK_Y = 4.8;
const SEGS = 72;
const SEG_A = (Math.PI * 2) / SEGS;
const SEG_W = 1.47;
export const TOWER_ANGLES = [Math.PI / 4, (3 * Math.PI) / 4, -Math.PI / 4, (-3 * Math.PI) / 4];
export const GALLERY_RANGE: [number, number] = [-2.2, -0.95];
/** Gemeinsame Windrichtung fuer Wimpel. */
const WIND_RY = 2.3;

export interface Spot {
  x: number;
  y: number;
  z: number;
  ry: number; // Blickrichtung (rotation.y, lokal +Z)
}
export interface Spectator extends Spot {
  kind: 0 | 1; // 0 Buerger, 1 Wache
  cheer: number;
}

export interface StructureInfo {
  spectators: Spectator[];
  torches: Spot[]; // Wandfackeln: Position der Flamme
  pennants: Array<{ m: THREE.Matrix4; len: number; cell: number }>;
  shields: Array<{ m: THREE.Matrix4; size: number; cell: number }>;
  banners: Array<{ m: THREE.Matrix4; w: number; len: number; cell: number }>;
  chimneys: THREE.Vector3[];
}

export const angDiff = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

type SegType = 'wall' | 'palas' | 'gate' | 'stands';
function segType(a: number): SegType {
  if (angDiff(a, 0) < 0.44) return 'palas';
  if (angDiff(a, Math.PI) < 0.24) return 'gate';
  if (angDiff(a, Math.PI / 2) < 0.27) return 'stands';
  return 'wall';
}
const nearTower = (a: number, lim: number) => TOWER_ANGLES.some((t) => angDiff(a, t) < lim);

const STONE = 0xf2efe8;
const SEG_W0 = 2 * WALL_INNER * Math.tan(SEG_A / 2) + 0.004;

/** Keilform: x wird mit dem Abstand zur Hofmitte gestreckt, damit Mauerstuecke luecken- und ueberlappungsfrei sind. */
function wedge(g: THREE.BufferGeometry, r0 = WALL_INNER): THREE.BufferGeometry {
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) pos.setX(i, (pos.getX(i) * (r0 - pos.getZ(i))) / r0);
  g.computeVertexNormals();
  return g;
}

/** Drehkoerper mit scharfen Kanten: jedes Profilstueck einzeln. */
function addLathe(
  b: Buckets,
  key: string,
  profile: Array<[number, number]>,
  T: THREE.Matrix4,
  opts: Parameters<typeof part>[2],
  uRef: number,
  tile: number,
  segs = 18,
): void {
  for (let i = 0; i < profile.length - 1; i++) {
    b.add(key, part(lathe([profile[i]!, profile[i + 1]!], segs, uRef, tile), T, opts));
  }
}

/** Welt-Matrix aus lokalem Rahmen + lokaler Verschiebung/Drehung. */
function at(frame: THREE.Matrix4, x: number, y: number, z: number, ry = 0, rx = 0, rz = 0): THREE.Matrix4 {
  return frame.clone().multiply(mat(x, y, z, ry, rx, rz));
}
function spotFrom(m: THREE.Matrix4): Spot {
  const p = new THREE.Vector3().setFromMatrixPosition(m);
  const d = new THREE.Vector3(0, 0, 1).transformDirection(m);
  return { x: p.x, y: p.y, z: p.z, ry: Math.atan2(d.x, d.z) };
}

/** Fenster: dunkle Oeffnung mit Steinrahmen (Rahmen = lokales +Z zeigt aus der Wand). */
export function windowAt(b: Buckets, m: THREE.Matrix4, w: number, h: number, arched: boolean, frame = true): void {
  b.add('window', part(new THREE.PlaneGeometry(w, h), at(m, 0, h / 2, 0.02), { uv: 'none' }));
  if (arched) {
    b.add('window', part(new THREE.CircleGeometry(w / 2, 8, 0, Math.PI), at(m, 0, h, 0.02), { uv: 'none' }));
  }
  if (!frame) return;
  const c = { color: 0xfff8ee, uv: 'face' as const };
  b.add('stone', part(box(w + 0.3, 0.1, 0.22), at(m, 0, -0.05, 0.08), c));
  b.add('stone', part(box(0.14, h, 0.14), at(m, -w / 2 - 0.07, h / 2, 0.05), c));
  b.add('stone', part(box(0.14, h, 0.14), at(m, w / 2 + 0.07, h / 2, 0.05), c));
  if (arched) {
    b.add('stone', part(new THREE.TorusGeometry(w / 2 + 0.07, 0.08, 4, 8, Math.PI), at(m, 0, h, 0.05), c));
  } else {
    b.add('stone', part(box(w + 0.32, 0.16, 0.16), at(m, 0, h + 0.08, 0.06), c));
  }
}

// ------------------------------------------------------------------ Ringmauer

export function buildRingWall(b: Buckets, rand: Rand, info: StructureInfo): void {
  for (let i = 0; i < SEGS; i++) {
    const a = (i + 0.5) * SEG_A;
    const type = segType(a);
    if (type === 'gate' || type === 'palas') continue;
    const F = polar(a, WALL_INNER);
    const arc = a * WALL_INNER;
    const tint = new THREE.Color(STONE).multiplyScalar(0.94 + rand() * 0.1);
    const L = { uv: 'local' as const, uvOffset: [arc, 0] as [number, number], color: tint, groundAO: 0.35 };
    const eps = (i % 2) * 0.004;
    const body = boxB(SEG_W0, WALK_Y + eps, 1.6);
    body.translate(0, 0, -0.8);
    b.add('stone', part(wedge(body), F, L));
    // Sockel und Gesims
    b.add('stone', part(wedge(profilePrism([[0, 0], [0.22, 0], [0.22, 0.4], [0, 0.62]], SEG_W0)), F, { ...L, color: tint.clone().multiplyScalar(0.92) }));
    b.add('stone', part(wedge(profilePrism([[0, 4.45], [0.16, 4.58], [0.16, 4.8], [0, 4.8]], SEG_W0)), F, L));
    if (type === 'stands') continue;
    // Brustwehr aussen mit Zinnen
    const par = boxB(SEG_W0, 1.1 + eps, 0.5);
    par.translate(0, WALK_Y, -1.35);
    b.add('stone', part(wedge(par), F, L));
    const cop = box(SEG_W0, 0.08, 0.64);
    cop.translate(0, 5.94 + eps, -1.35);
    b.add('stone', part(wedge(cop), F, L));
    const slit = i % 2 === 0;
    const mh = 0.92;
    const my = 5.98;
    if (slit) {
      const sw = 0.09;
      const side = (0.82 - sw) / 2;
      for (const sx of [-1, 1]) {
        const g = boxB(side, mh, 0.5);
        b.add('stone', part(g, at(F, sx * (sw / 2 + side / 2), my, -1.35), L));
      }
      b.add('stone', part(boxB(sw, 0.16, 0.5), at(F, 0, my, -1.35), L));
      b.add('stone', part(boxB(sw, 0.2, 0.5), at(F, 0, my + mh - 0.2, -1.35), L));
    } else {
      b.add('stone', part(boxB(0.82, mh, 0.5), at(F, 0, my, -1.35), L));
    }
    b.add('stone', part(box(0.92, 0.08, 0.6), at(F, 0, my + mh + 0.04, -1.35), L));

    const inGallery = a - Math.PI * 2 > GALLERY_RANGE[0] && a - Math.PI * 2 < GALLERY_RANGE[1];
    // Tuer am Mauerfuss
    if (i === 21) {
      windowAt(b, at(F, 0, 0.02, 0), 1.05, 1.85, true);
      b.add('wood', part(boxB(1.02, 1.85, 0.06), at(F, 0, 0.02, 0.0), { color: 0x7a5a42, uvSwap: true }));
      b.add('wood', part(new THREE.CircleGeometry(0.51, 8, 0, Math.PI), at(F, 0, 1.87, 0.031), { color: 0x6a4c36 }));
      for (const y of [0.35, 1.0, 1.6]) b.add('iron', part(box(0.95, 0.06, 0.03), at(F, 0, y, 0.045), { color: 0x2a2826, uv: 'none' }));
      b.add('iron', part(new THREE.TorusGeometry(0.07, 0.015, 4, 8), at(F, 0.3, 1.0, 0.07), { color: 0x2a2826, uv: 'none' }));
    }
    // Strebepfeiler
    if (i % 3 === 1 && !nearTower(a, 0.16) && !inGallery) {
      b.add('stone', part(profilePrism([[0, 0], [0.3, 0], [0.3, 2.9], [0, 3.8]], 0.64), F, { ...L, uv: 'face' }));
      b.add('stone', part(profilePrism([[0, 0], [0.42, 0], [0.42, 0.3], [0.3, 0.45], [0, 0.45]], 0.8), F, { ...L, uv: 'face' }));
    }
    // Wandfackeln
    if (i % 6 === 4 && !nearTower(a, 0.2)) {
      info.torches.push(spotFrom(at(F, 0, 2.75, 0.34)));
      b.add('iron', part(box(0.06, 0.06, 0.34), at(F, 0, 2.35, 0.17), { color: 0x2c2a28 }));
      b.add('iron', part(box(0.12, 0.3, 0.04), at(F, 0, 2.35, 0.02), { color: 0x2c2a28 }));
      b.add('iron', part(new THREE.CylinderGeometry(0.1, 0.06, 0.12, 6, 1, true), at(F, 0, 2.42, 0.34), { color: 0x2c2a28, uv: 'none' }));
      b.add('wood', part(new THREE.CylinderGeometry(0.045, 0.035, 0.55, 5), at(F, 0, 2.5, 0.34, 0, 0.12), { color: 0x6a4a30, uvSwap: true }));
      b.add('generic', part(new THREE.CylinderGeometry(0.07, 0.05, 0.12, 6), at(F, 0, 2.72, 0.36), { color: 0x1e1712, uv: 'none' }));
    }
    // Holz-Wehrgang auf der Hofseite
    if (inGallery) {
      const wood = { color: 0xb09a86, uv: 'face' as const };
      b.add('wood', part(box(SEG_W + 0.02, 0.1, 0.9), at(F, 0, WALK_Y - 0.05, 0.45), wood));
      for (const sx of [-0.55, 0.55]) {
        b.add('wood', part(box(0.12, 0.14, 1.1), at(F, sx, WALK_Y - 0.48, 0.38, 0, -Math.atan2(0.72, 0.76)), { ...wood, color: 0x8a7462 }));
        b.add('wood', part(box(0.16, 0.16, 0.9), at(F, sx, WALK_Y - 0.18, 0.45), { ...wood, color: 0x8a7462 }));
      }
      b.add('wood', part(box(0.09, 1.05, 0.09), at(F, -0.6, WALK_Y + 0.5, 0.84), { ...wood, uvSwap: true }));
      b.add('wood', part(box(SEG_W, 0.07, 0.08), at(F, 0, WALK_Y + 1.0, 0.84), wood));
      b.add('wood', part(box(SEG_W, 0.05, 0.05), at(F, 0, WALK_Y + 0.55, 0.84), wood));
    }
  }
}

// ------------------------------------------------------------------ Tuerme

export function buildTower(
  b: Buckets,
  info: StructureInfo,
  rand: Rand,
  a: number,
  rc: number,
  R: number,
  H: number,
  style: 'roof' | 'crenel',
  pennantCell: number,
): void {
  const [cx, cz] = polarPos(a, rc);
  const T = mat(cx, 0, cz);
  const tint = new THREE.Color(STONE).multiplyScalar(0.92 + rand() * 0.08);
  const S = { uv: 'keep' as const, color: tint, groundAO: 0.35 };
  const segs = 18;
  addLathe(b, 'stone', [[R + 0.12, 0], [R + 0.12, 0.35], [R, 0.8]], T, S, R, 3, segs);
  b.add('stone', part(lathe([[R, 0.8], [R, H]], segs, R, 3), T, S));
  // Gurtgesims
  const gy = H * 0.52;
  addLathe(b, 'stone', [[R, gy], [R + 0.12, gy + 0.06], [R + 0.12, gy + 0.22], [R, gy + 0.28]], T, S, R, 3, segs);
  // Konsolen
  const nC = 16;
  for (let k = 0; k < nC; k++) {
    const ph = (k / nC) * Math.PI * 2;
    b.add('stone', part(profilePrism([[0, 0], [0.4, 0.35], [0.4, 0.55], [0, 0.55]], 0.26), T.clone().multiply(mat(Math.sin(ph) * R, H - 0.55, Math.cos(ph) * R, ph + Math.PI)).multiply(mat(0, 0, 0, Math.PI)), S));
  }
  if (style === 'roof') {
    const Ro = R + 0.35;
    b.add('stone', part(lathe([[R, H], [Ro, H]], segs, R, 3), T, S));
    b.add('stone', part(lathe([[Ro, H], [Ro, H + 1.2]], segs, Ro, 3), T, S));
    // kleine Fenster im Obergeschoss
    for (let k = 0; k < 4; k++) {
      const ph = (k / 4) * Math.PI * 2 + a;
      windowAt(b, T.clone().multiply(mat(Math.sin(ph) * Ro, H + 0.3, Math.cos(ph) * Ro, ph)), 0.28, 0.5, true, false);
    }
    const eaveR = Ro + 0.55;
    const top = H + 1.1 + R * 2.5;
    const roofTint = new THREE.Color(0xa65a44).multiplyScalar(0.9 + rand() * 0.15);
    b.add('roof', part(lathe([[eaveR, H + 1.0], [Ro + 0.1, H + 1.45], [0.03, top]], segs, eaveR, 1.6, 0), T, { uv: 'keep', color: roofTint }));
    b.add('roof', part(lathe([[Ro, H + 1.2], [eaveR, H + 1.0]], segs, eaveR, 1.6, 0), T, { uv: 'keep', color: roofTint.clone().multiplyScalar(0.5) }));
    // Spitze mit Knauf
    b.add('iron', part(new THREE.CylinderGeometry(0.03, 0.05, 2.2, 5), mat(cx, top + 0.9, cz), { color: 0x3a3632, uv: 'none' }));
    b.add('iron', part(new THREE.IcosahedronGeometry(0.12, 0), mat(cx, top + 0.1, cz), { color: 0xb08a3a, uv: 'none' }));
    info.pennants.push({ m: mat(cx, top + 1.85, cz, WIND_RY + (rand() - 0.5) * 0.4), len: 2.4, cell: pennantCell });
  } else {
    const Ro = R + 0.3;
    b.add('stone', part(lathe([[R, H], [Ro, H]], segs, R, 3), T, S));
    addLathe(b, 'stone', [[Ro, H], [Ro, H + 1.0], [Ro - 0.4, H + 1.0], [Ro - 0.4, H + 0.2]], T, S, Ro, 3, segs);
    b.add('stone', part(new THREE.CylinderGeometry(Ro - 0.4, Ro - 0.4, 0.1, segs), mat(cx, H + 0.2, cz), { ...S, uv: 'face' }));
    for (let k = 0; k < 8; k++) {
      const ph = (k / 8) * Math.PI * 2;
      b.add('stone', part(boxB(0.7, 0.8, 0.4), T.clone().multiply(mat(Math.sin(ph) * (Ro - 0.2), H + 1.0, Math.cos(ph) * (Ro - 0.2), ph)), { ...S, uv: 'face' }));
    }
    b.add('wood', part(new THREE.CylinderGeometry(0.05, 0.07, 4.2, 5), mat(cx, H + 2.3, cz), { color: 0x6a5040, uvSwap: true }));
    info.pennants.push({ m: mat(cx, H + 4.2, cz, WIND_RY + (rand() - 0.5) * 0.4), len: 2.8, cell: pennantCell });
  }
  // Fenster zum Hof
  const toC = Math.atan2(-cx, -cz);
  const wins: Array<[number, number, number]> = [
    [0.0, 5.7, 0],
    [0.42, 7.2, 1],
    [-0.38, H - 1.9, 1],
  ];
  for (const [off, y, arched] of wins) {
    const ph = toC + off;
    windowAt(b, T.clone().multiply(mat(Math.sin(ph) * R, y, Math.cos(ph) * R, ph)), arched ? 0.32 : 0.14, arched ? 0.8 : 0.9, !!arched);
  }
  // Tueren zum Wehrgang
  for (const side of [-1, 1]) {
    const [wx, wz] = polarPos(a + side * 0.14, 15.8);
    const ph = Math.atan2(wx - cx, wz - cz);
    const D = T.clone().multiply(mat(Math.sin(ph) * R, WALK_Y, Math.cos(ph) * R, ph));
    windowAt(b, D, 0.8, 1.6, true);
    b.add('wood', part(box(0.78, 1.55, 0.05), at(D, 0, 0.78, 0.0), { color: 0x7a5a40, uvSwap: true }));
  }
}

// ------------------------------------------------------------------ Torhaus

export function buildGatehouse(b: Buckets, info: StructureInfo, rand: Rand): void {
  const a = Math.PI;
  const F = polar(a, WALL_INNER - 0.25);
  const W = 8.2;
  const H = 8.4;
  const D = 5.6;
  const ar = 1.55;
  const ay = 2.9;
  const shape = new THREE.Shape();
  shape.moveTo(-W / 2, 0);
  shape.lineTo(W / 2, 0);
  shape.lineTo(W / 2, H);
  shape.lineTo(-W / 2, H);
  shape.closePath();
  const hole = new THREE.Path();
  hole.moveTo(-ar, 0);
  hole.lineTo(-ar, ay);
  hole.absarc(0, ay, ar, Math.PI, 0, true);
  hole.lineTo(ar, 0);
  hole.closePath();
  shape.holes.push(hole);
  const g = new THREE.ExtrudeGeometry(shape, { depth: D, bevelEnabled: false, curveSegments: 10 });
  g.translate(0, 0, -D);
  b.add(
    'stone',
    part(g, F, {
      color: STONE,
      groundAO: 0.3,
      shadeLocal: (x, y, z, _nx, _ny, nz) =>
        Math.abs(x) < ar + 0.01 && y < ay + ar + 0.01 && Math.abs(nz) < 0.9 ? 0.25 + 0.5 * Math.min(1, Math.max(0, (z + 2.2) / 2.2)) : 1,
    }),
  );
  // Sockel
  for (const sx of [-1, 1]) {
    b.add('stone', part(profilePrism([[0, 0], [0.22, 0], [0.22, 0.4], [0, 0.62]], W / 2 - ar), at(F, sx * (ar + (W / 2 - ar) / 2), 0, 0), { color: 0xe0dcd4, groundAO: 0.3 }));
  }
  // Bogensteine
  const nV = 13;
  for (let k = 0; k < nV; k++) {
    const t = (k / (nV - 1)) * Math.PI;
    const big = k === (nV - 1) / 2;
    const r = ar + (big ? 0.24 : 0.19);
    b.add('stone', part(box(0.3, big ? 0.55 : 0.4, 0.18), at(F, Math.cos(t) * r, ay + Math.sin(t) * r, 0.06, 0, 0, t - Math.PI / 2), { color: 0xfff6ea }));
  }
  for (const sx of [-1, 1]) {
    for (let k = 0; k < 5; k++) {
      b.add('stone', part(box(k % 2 ? 0.34 : 0.46, 0.5, 0.16), at(F, sx * (ar + 0.18), 0.35 + k * 0.56, 0.06), { color: 0xfff6ea }));
    }
  }
  // Fallgitter (halb hochgezogen)
  const iron = { color: 0x2d2b29, uv: 'none' as const };
  for (let k = 0; k < 10; k++) {
    const x = -1.35 + k * 0.3;
    b.add('iron', part(box(0.07, 3.2, 0.07), at(F, x, 2.25 + 1.6, -0.7), iron));
    b.add('iron', part(new THREE.ConeGeometry(0.05, 0.22, 4), at(F, x, 2.14, -0.7, 0, Math.PI), iron));
  }
  for (let k = 0; k < 5; k++) b.add('iron', part(box(3.1, 0.07, 0.08), at(F, 0, 2.5 + k * 0.5, -0.7), iron));
  // Torfluegel am Ende der Durchfahrt
  const woodC = { color: 0x8a6a50, uvSwap: true };
  for (const sx of [-1, 1]) {
    b.add('wood', part(box(1.53, ay, 0.12), at(F, sx * 0.77, ay / 2, -D + 0.7), woodC));
    for (const y of [0.5, 1.5, 2.5]) b.add('iron', part(box(1.4, 0.08, 0.03), at(F, sx * 0.77, y, -D + 0.78), iron));
    b.add('iron', part(new THREE.TorusGeometry(0.1, 0.02, 4, 8), at(F, sx * 0.25, 1.4, -D + 0.8), iron));
  }
  b.add('wood', part(new THREE.CircleGeometry(ar, 10, 0, Math.PI), at(F, 0, ay, -D + 0.7), { color: 0x5a4432 }));
  // Wappen und Scharten ueber dem Tor
  info.shields.push({ m: at(F, 0, 5.75, 0.07), size: 1.25, cell: 0 });
  for (const sx of [-1, 1]) windowAt(b, at(F, sx * 2.7, 5.2, 0), 0.12, 0.95, false);
  // Maschikulis und Zinnen
  for (let k = 0; k < 8; k++) {
    const x = -W / 2 + 0.45 + k * ((W - 0.9) / 7);
    b.add('stone', part(profilePrism([[0, 0], [0.55, 0.45], [0.55, 0.62], [0, 0.62]], 0.32), at(F, x, H - 1.9, 0), { color: STONE }));
  }
  b.add('stone', part(boxB(W + 0.2, 1.3, 0.45), at(F, 0, H - 1.28, 0.33), { color: STONE }));
  for (let k = 0; k < 7; k++) {
    const x = -W / 2 + 0.55 + k * ((W - 1.1) / 6);
    b.add('stone', part(boxB(0.75, 0.85, 0.45), at(F, x, H + 0.02, 0.33), { color: STONE }));
    b.add('stone', part(boxB(0.75, 0.85, 0.45), at(F, x, H, -D + 0.25), { color: STONE }));
  }
  info.torches.push(spotFrom(at(F, -2.35, 2.85, 0.32)), spotFrom(at(F, 2.35, 2.85, 0.32)));
  for (const sx of [-2.35, 2.35]) {
    b.add('iron', part(box(0.06, 0.06, 0.34), at(F, sx, 2.45, 0.17), iron));
    b.add('iron', part(new THREE.CylinderGeometry(0.1, 0.06, 0.12, 6, 1, true), at(F, sx, 2.52, 0.34), iron));
    b.add('wood', part(new THREE.CylinderGeometry(0.045, 0.035, 0.55, 5), at(F, sx, 2.6, 0.34), { color: 0x6a4a30 }));
  }
  // Ketten des Fallgitters
  for (const sx of [-1.95, 1.95]) addChain(b, at(F, sx, 4.9, 0.1), 1.6);
  // Flankentuerme
  buildTower(b, info, rand, a - 0.3, 16.9, 1.9, 9.6, 'crenel', 1);
  buildTower(b, info, rand, a + 0.3, 16.9, 1.9, 9.6, 'crenel', 3);
  // Wachen auf dem Tor
  for (const sx of [-2.2, 1.6]) {
    const s = spotFrom(at(F, sx, H, -0.5));
    info.spectators.push({ ...s, kind: 1, cheer: 0 });
  }
}

export function addChain(b: Buckets, m: THREE.Matrix4, len: number): void {
  const n = Math.round(len / 0.085);
  const g0 = new THREE.TorusGeometry(0.045, 0.012, 3, 6);
  for (let k = 0; k < n; k++) {
    b.add('iron', part(g0.clone(), at(m, 0, -k * 0.085, 0, k % 2 ? Math.PI / 2 : 0, 0, Math.PI / 2), { color: 0x3a3836, uv: 'none' }));
  }
  g0.dispose();
  b.add('iron', part(new THREE.TorusGeometry(0.08, 0.018, 4, 8), at(m, 0, 0.06, 0), { color: 0x3a3836, uv: 'none' }));
}

// ------------------------------------------------------------------ Palas mit Galerie

export function buildPalas(b: Buckets, info: StructureInfo, rand: Rand): void {
  const floor1 = 2.7;
  const floor2 = 4.8;
  const eave = 7.4;
  const ridgeY = 10.6;
  const depth = 6.8;
  for (let i = 0; i < SEGS; i++) {
    const a = (i + 0.5) * SEG_A;
    if (segType(a) !== 'palas') continue;
    const F = polar(a, WALL_INNER);
    const arc = a * WALL_INNER;
    const L = { uv: 'local' as const, uvOffset: [arc, 0] as [number, number], color: STONE, groundAO: 0.35 };
    const eps = (i % 2) * 0.004;
    const g1 = boxB(SEG_W0, floor1 + eps, depth);
    g1.translate(0, 0, -depth / 2);
    b.add('stone', part(wedge(g1), F, L));
    b.add('stone', part(wedge(profilePrism([[0, 0], [0.22, 0], [0.22, 0.4], [0, 0.62]], SEG_W0)), F, L));
    b.add('stone', part(wedge(profilePrism([[0, floor1 - 0.1], [0.16, floor1], [0.16, floor1 + 0.12], [0, floor1 + 0.12]], SEG_W0)), F, L));
    // Arkade
    const panel = new THREE.Shape();
    const pw = 1.36 / 2;
    const gh = floor2 - floor1;
    panel.moveTo(-pw, 0);
    panel.lineTo(pw, 0);
    panel.lineTo(pw, gh);
    panel.lineTo(-pw, gh);
    panel.closePath();
    const hr = 0.44;
    const hy = 0.85;
    const holeTop = gh - 0.28 - hr;
    const hp = new THREE.Path();
    hp.moveTo(-hr, hy);
    hp.lineTo(hr, hy);
    hp.lineTo(hr, holeTop);
    hp.absarc(0, holeTop, hr, 0, Math.PI, false);
    hp.lineTo(-hr, hy);
    panel.holes.push(hp);
    const pg = new THREE.ExtrudeGeometry(panel, { depth: 0.38, bevelEnabled: false, curveSegments: 8 });
    pg.translate(0, floor1, -0.38);
    b.add('stone', part(pg, F, { color: 0xf6f2ea }));
    b.add('stone', part(box(1.36, 0.08, 0.5), at(F, 0, floor1 + hy - 0.02, -0.12), { color: 0xfff8ee }));
    // Galerie: Rueckwand dunkel, Decke
    const bw = boxB(SEG_W0, gh, 0.3);
    bw.translate(0, floor1, -2.5);
    b.add('stone', part(wedge(bw), F, { color: 0x9a948c }));
    // Obergeschoss
    const g2 = boxB(SEG_W0, eave - floor2 - eps, depth);
    g2.translate(0, floor2 + eps, -depth / 2);
    b.add('stone', part(wedge(g2), F, { ...L, shadeLocal: (_x, _y, _z, _nx, ny) => (ny < -0.5 ? 0.45 : 1) }));
    b.add('stone', part(wedge(profilePrism([[0, floor2 - 0.05], [0.18, floor2 + 0.05], [0.18, floor2 + 0.2], [0, floor2 + 0.2]], SEG_W0)), F, L));
    b.add('stone', part(wedge(profilePrism([[0, eave - 0.3], [0.22, eave - 0.15], [0.22, eave], [0, eave]], SEG_W0)), F, L));
    // Fenster im Obergeschoss (paarweise)
    const idx = Math.round(a / SEG_A - 0.5);
    if (idx % 2 === 0) {
      windowAt(b, at(F, -0.2, floor2 + 0.75, 0), 0.26, 0.85, true);
      windowAt(b, at(F, 0.2, floor2 + 0.75, 0), 0.26, 0.85, true);
    } else if (angDiff(a, 0) > 0.1) {
      info.banners.push({ m: at(F, 0, eave - 0.3, 0.25), w: 0.95, len: 2.3, cell: [0, 2, 5, 1][(idx >>> 0) % 4]! });
    }
    // Dach
    const roofTint = new THREE.Color(0x9c5540).multiplyScalar(0.92 + rand() * 0.1);
    const front: [number, number] = [0.65, eave - 0.1];
    const ridge: [number, number] = [-depth / 2, ridgeY];
    const back: [number, number] = [-depth - 0.6, eave - 0.1];
    for (const [p, q] of [
      [front, ridge],
      [ridge, back],
    ] as Array<[[number, number], [number, number]]>) {
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      const ang = Math.atan2(q[1] - p[1], p[0] - q[0]);
      const slab = box(SEG_W0, 0.16, len);
      slab.applyMatrix4(mat(0, (p[1] + q[1]) / 2 + eps, (p[0] + q[0]) / 2, 0, ang));
      b.add('roof', part(wedge(slab), F, { color: roofTint, uv: 'face' }));
    }
    const rc = box(SEG_W0, 0.22, 0.3);
    rc.translate(0, ridgeY + 0.1, ridge[0]);
    b.add('roof', part(wedge(rc), F, { color: 0x6a4034 }));
    // Zuschauer
    for (const [zx, zz] of [
      [-0.28, -1.0],
      [0.3, -1.55],
    ]) {
      if (rand() < 0.15) continue;
      const s = spotFrom(at(F, zx! + (rand() - 0.5) * 0.15, floor1, zz!));
      info.spectators.push({ ...s, ry: s.ry + (rand() - 0.5) * 0.4, kind: 0, cheer: rand() < 0.3 ? 1 : 0 });
    }
  }
  // Giebelwaende
  for (const side of [-1, 1]) {
    const ea = side * 0.4363;
    const F = polar(ea, WALL_INNER);
    b.add(
      'stone',
      part(
        profilePrism(
          [
            [0.7, 0],
            [0.7, eave],
            [-depth / 2, ridgeY + 0.2],
            [-depth - 0.6, eave],
            [-depth - 0.6, 0],
          ],
          0.5,
        ),
        at(F, side * 0.1, 0, 0),
        { color: STONE, groundAO: 0.35 },
      ),
    );
  }
  // Portal in der Mitte
  const P = polar(0, WALL_INNER - 0.03);
  b.add('wood', part(boxB(1.5, 2.1, 0.08), at(P, 0, 0, 0.0), { color: 0x7a5a42, uvSwap: true }));
  b.add('wood', part(new THREE.CircleGeometry(0.75, 10, 0, Math.PI), at(P, 0, 2.1, 0.04), { color: 0x6a4c36 }));
  for (const y of [0.4, 1.1, 1.8]) b.add('iron', part(box(1.4, 0.07, 0.03), at(P, 0, y, 0.06), { color: 0x2a2826 }));
  const nV = 11;
  for (let k = 0; k < nV; k++) {
    const t = (k / (nV - 1)) * Math.PI;
    b.add('stone', part(box(0.26, 0.36, 0.2), at(P, Math.cos(t) * 0.92, 2.1 + Math.sin(t) * 0.92, 0.08, 0, 0, t - Math.PI / 2), { color: 0xfff6ea }));
  }
  for (const sx of [-1, 1]) b.add('stone', part(boxB(0.3, 2.1, 0.22), at(P, sx * 0.92, 0, 0.08), { color: 0xfff6ea, groundAO: 0.3 }));
  info.shields.push({ m: at(P, 0, 5.6, 0.34), size: 0.95, cell: 3 });
  const [chx, chz] = polarPos(0.3, 19.5);
  info.chimneys.push(new THREE.Vector3(chx, 12.0, chz));
  const C = polar(0.3, 19.5);
  b.add('stone', part(boxB(0.9, 3.4, 0.9), at(C, 0, 8.4, 0), { color: 0xd8d2c8 }));
  b.add('stone', part(box(1.1, 0.15, 1.1), at(C, 0, 11.8, 0), { color: 0xd8d2c8 }));
}

// ------------------------------------------------------------------ Tribuene auf der Mauer

export function buildStands(b: Buckets, info: StructureInfo, rand: Rand): void {
  const F = polar(Math.PI / 2, WALL_INNER);
  const W = 7.7;
  const wood = { color: 0xc0aa94 };
  const dark = { color: 0x8c7866 };
  const tierH = 0.45;
  const tierD = 0.8;
  for (let k = 0; k < 3; k++) {
    const zf = 0.35 - tierD * k;
    const y0 = WALK_Y + tierH * k;
    const g = boxB(W, tierH, tierD + (k === 0 ? 0 : 0));
    b.add('wood', part(g, at(F, 0, y0, zf - tierD / 2), wood));
    if (k > 0) {
      const back = boxB(W, tierH * k, tierD);
      b.add('wood', part(back, at(F, 0, WALK_Y, zf - tierD / 2), dark));
    }
    // Zuschauer
    const n = 7;
    for (let j = 0; j < n; j++) {
      if (rand() < 0.12) continue;
      const x = -W / 2 + 0.55 + (j + (k % 2) * 0.5) * ((W - 1.1) / n);
      const s = spotFrom(at(F, x + (rand() - 0.5) * 0.2, y0 + tierH, zf - 0.4));
      info.spectators.push({ ...s, ry: s.ry + (rand() - 0.5) * 0.5, kind: 0, cheer: rand() < 0.35 ? 1 : 0 });
    }
  }
  const topY = WALK_Y + tierH * 3;
  // Rueckwand, Seiten, Stuetzen
  b.add('wood', part(boxB(W + 0.2, 3.2, 0.12), at(F, 0, topY - 0.3, -2.05), dark));
  for (const sx of [-1, 1]) {
    b.add('wood', part(boxB(0.12, 2.0, 2.5), at(F, sx * (W / 2 + 0.06), topY - 0.3, -0.85), dark));
    b.add('wood', part(boxB(0.16, topY + 3.1, 0.16), at(F, sx * (W / 2), 0, -2.1), { ...dark, uvSwap: true }));
  }
  for (const x of [-W / 2, -W / 6, W / 6, W / 2]) {
    b.add('wood', part(boxB(0.12, 2.9, 0.12), at(F, x * 0.98, WALK_Y + tierH, 0.4), { ...wood, uvSwap: true }));
    b.add('wood', part(box(0.1, 0.1, 1.0), at(F, x * 0.98, WALK_Y - 0.4, 0.1, 0, Math.atan2(0.9, 0.5)), dark));
  }
  // Gelaender
  b.add('wood', part(box(W, 0.08, 0.08), at(F, 0, WALK_Y + tierH + 0.85, 0.32), wood));
  // Markise (gestreift) und Behang
  const cellStripe = 7;
  const awn = new THREE.PlaneGeometry(W + 0.4, 2.8, 8, 3);
  awn.rotateX(-Math.PI / 2 + 0.22);
  addCloth(b, awn, at(F, 0, topY + 2.25, -0.9), cellStripe, 0.02, 0.8, 2.8, 'y');
  const val = new THREE.PlaneGeometry(W + 0.4, 0.45, 16, 1);
  scallop(val, 0.45, 16);
  addCloth(b, val, at(F, 0, topY + 1.72, 0.48), cellStripe, 0.03, 1.4, 0.45, 'y');
  // Behaenge ueber die Mauer
  const cells = [0, 1, 2, 5];
  for (let k = 0; k < 4; k++) {
    const x = -W / 2 + W / 8 + (k * W) / 4;
    info.banners.push({ m: at(F, x, WALK_Y + tierH - 0.02, 0.4), w: W / 4 - 0.12, len: 1.35, cell: cells[k]! });
  }
}

/** Unterkante eines Streifens gezackt (Wimpelkante). */
function scallop(g: THREE.PlaneGeometry, h: number, n: number): void {
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) < 0) {
      const k = Math.round((pos.getX(i) / (g.parameters.width / n)) * 1);
      if (k % 2 === 0) pos.setY(i, -h / 2 + h * 0.4);
    }
  }
}

/**
 * Stoff in den Stoff-Topf legen. Die Geometrie ist lokal (Ebene x/y), die Welle wirkt entlang
 * der lokalen Z-Achse. weightAxis: Richtung, entlang der die Auslenkung zunimmt ('y' = von oben nach unten).
 */
export function addCloth(
  b: Buckets,
  g: THREE.BufferGeometry,
  m: THREE.Matrix4,
  cell: number,
  amp: number,
  freq: number,
  span: number,
  weightAxis: 'y' | 'x',
  uvRect?: [number, number, number, number],
): void {
  const pos = g.attributes.position as THREE.BufferAttribute;
  const n = pos.count;
  g.computeBoundingBox();
  const bb = g.boundingBox!;
  const uv = new Float32Array(n * 2);
  const wave = new Float32Array(n * 4);
  const dir = new Float32Array(n * 3);
  const r = uvRect ?? cellRect(cell);
  const normal = new THREE.Vector3(0, 0, 1);
  const tmp = new THREE.Vector3();
  const phase = (m.elements[12] ?? 0) * 0.7 + (m.elements[14] ?? 0) * 0.3;
  g.computeVertexNormals();
  const nor = g.attributes.normal as THREE.BufferAttribute;
  for (let i = 0; i < n; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const fu = (x - bb.min.x) / Math.max(1e-6, bb.max.x - bb.min.x);
    const fv = (y - bb.min.y) / Math.max(1e-6, bb.max.y - bb.min.y);
    uv[i * 2] = r[0] + (r[2] - r[0]) * fu;
    uv[i * 2 + 1] = r[1] + (r[3] - r[1]) * fv;
    const w = weightAxis === 'y' ? 1 - fv : fu;
    wave[i * 4] = w * (span > 0 ? 1 : 0);
    wave[i * 4 + 1] = phase + fu * 1.5;
    wave[i * 4 + 2] = amp;
    wave[i * 4 + 3] = freq;
    tmp.fromBufferAttribute(nor, i);
    normal.copy(tmp).transformDirection(m);
    dir[i * 3] = normal.x;
    dir[i * 3 + 1] = normal.y;
    dir[i * 3 + 2] = normal.z;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  const pg = part(g, m, { uv: 'keep', color: 0xffffff });
  pg.setAttribute('aWave', expandAttr(g, wave, 4));
  pg.setAttribute('aWaveDir', expandAttr(g, dir, 3));
  b.add('cloth', pg);
}

function expandAttr(g: THREE.BufferGeometry, data: Float32Array, size: number): THREE.BufferAttribute {
  if (!g.index) return new THREE.BufferAttribute(data, size);
  const idx = g.index.array;
  const out = new Float32Array(idx.length * size);
  for (let i = 0; i < idx.length; i++) {
    for (let k = 0; k < size; k++) out[i * size + k] = data[idx[i]! * size + k]!;
  }
  return new THREE.BufferAttribute(out, size);
}

export function cellRect(cell: number): [number, number, number, number] {
  const c = cell % 4;
  const r = Math.floor(cell / 4);
  return [c / 4 + 0.003, 1 - (r + 1) / 2 + 0.003, (c + 1) / 4 - 0.003, 1 - r / 2 - 0.003];
}

// ------------------------------------------------------------------ Bergfried, Kapelle, Haeuser

export function buildKeep(b: Buckets, info: StructureInfo, rand: Rand): void {
  const a = 2.62;
  const [cx, cz] = polarPos(a, 28);
  const ry = a + 0.15;
  const K = mat(cx, 0, cz, ry);
  const s = 8.5;
  const H = 21;
  b.add('stone', part(boxB(s, H, s), K, { color: 0xe6e1d8, groundAO: 0.3 }));
  b.add('stone', part(boxB(s + 0.5, 0.8, s + 0.5), K, { color: 0xd8d2c8 }));
  // Konsolen, Zinnen
  for (let side = 0; side < 4; side++) {
    const Sd = K.clone().multiply(mat(0, 0, 0, (side * Math.PI) / 2));
    b.add('stone', part(boxB(s + 0.7, 1.2, 0.35), at(Sd, 0, H - 0.2, s / 2 + 0.17), { color: 0xe6e1d8 }));
    for (let k = 0; k < 5; k++) {
      b.add('stone', part(boxB(0.9, 0.8, 0.35), at(Sd, -s / 2 + 0.6 + k * ((s - 1.2) / 4), H + 1.0, s / 2 + 0.17), { color: 0xe6e1d8 }));
    }
    for (let k = 0; k < 7; k++) {
      b.add('stone', part(profilePrism([[0, 0], [0.35, 0.3], [0.35, 0.45], [0, 0.45]], 0.3), at(Sd, -s / 2 + 0.6 + k * ((s - 1.2) / 6), H - 0.65, s / 2), { color: 0xe6e1d8 }));
    }
    windowAt(b, at(Sd, (side % 2 ? -1 : 1) * 1.2, 9, s / 2), 0.35, 1.0, true);
    windowAt(b, at(Sd, 0, 15.5, s / 2), 0.35, 1.0, true);
    windowAt(b, at(Sd, (side % 2 ? 1 : -1) * 2.2, 4.5, s / 2), 0.12, 0.9, false);
  }
  const roof = new THREE.ConeGeometry((s / 2) * Math.SQRT2 - 0.2, 7.5, 4, 1, true);
  roof.rotateY(Math.PI / 4);
  b.add('roof', part(roof, at(K, 0, H + 1.8 + 3.75, 0), { color: 0x8c9098 }));
  b.add('iron', part(new THREE.CylinderGeometry(0.04, 0.06, 2.6, 5), at(K, 0, H + 1.8 + 7.5 + 1.1, 0), { color: 0x3a3632, uv: 'none' }));
  info.pennants.push({ m: mat(cx, H + 1.8 + 7.5 + 2.2, cz, WIND_RY + (rand() - 0.5) * 0.4), len: 3.4, cell: 0 });
}

export function buildChapel(b: Buckets, info: StructureInfo): void {
  const a = 0.62;
  const [cx, cz] = polarPos(a, 31);
  const C = mat(cx, 0, cz, a);
  b.add('stone', part(boxB(4.2, 17, 4.2), C, { color: 0xe2ddd4 }));
  for (let side = 0; side < 4; side++) {
    const Sd = C.clone().multiply(mat(0, 0, 0, (side * Math.PI) / 2));
    windowAt(b, at(Sd, 0, 13.8, 2.1), 0.45, 1.4, true);
    windowAt(b, at(Sd, 0, 9.5, 2.1), 0.2, 0.9, true);
  }
  const spire = new THREE.ConeGeometry(3.2, 10, 8, 1, true);
  b.add('roof', part(spire, at(C, 0, 17 + 5, 0), { color: 0x8a9098 }));
  b.add('iron', part(new THREE.IcosahedronGeometry(0.22, 0), at(C, 0, 27.2, 0), { color: 0xc09a40, uv: 'none' }));
  b.add('iron', part(box(0.05, 1.1, 0.05), at(C, 0, 27.9, 0), { color: 0xc09a40, uv: 'none' }));
  b.add('iron', part(box(0.55, 0.05, 0.05), at(C, 0, 28.1, 0), { color: 0xc09a40, uv: 'none' }));
  void info;
}

export function buildHouses(b: Buckets, info: StructureInfo, rand: Rand): void {
  const spots: Array<[number, number, number]> = [
    [-1.32, 21.5, 7.5],
    [-1.92, 22.5, 6.5],
    [1.18, 22.5, 6.0],
  ];
  for (const [a, r, w] of spots) {
    const [cx, cz] = polarPos(a, r);
    const M = mat(cx, 0, cz, a + Math.PI + (rand() - 0.5) * 0.2);
    const d = 5.2;
    b.add('stone', part(boxB(w, 5.5, d), M, { color: 0xd8d2c8 }));
    b.add('generic', part(boxB(w, 3.2, d), at(M, 0, 5.5, 0), { color: 0xa89a80 }));
    // Fachwerk auf der Hofseite (+Z)
    const beam = { color: 0x5a4030 };
    for (const y of [5.5, 7.0, 8.65]) b.add('wood', part(box(w + 0.05, 0.16, 0.08), at(M, 0, y, d / 2 + 0.02), beam));
    const nPost = Math.round(w / 1.25);
    for (let k = 0; k <= nPost; k++) {
      const x = -w / 2 + (k * w) / nPost;
      b.add('wood', part(box(0.16, 3.2, 0.08), at(M, x, 7.1, d / 2 + 0.02), { ...beam, uvSwap: true }));
      if (k < nPost && k % 2 === 0) {
        const len = Math.hypot(w / nPost, 1.5);
        b.add('wood', part(box(0.12, len, 0.07), at(M, x + w / nPost / 2, 6.25, d / 2 + 0.03, 0, 0, Math.atan2(w / nPost, 1.5)), beam));
      }
    }
    windowAt(b, at(M, -w / 4, 7.4, d / 2), 0.5, 0.7, false, false);
    windowAt(b, at(M, w / 4, 7.4, d / 2), 0.5, 0.7, false, false);
    // Satteldach (First parallel zur Mauer)
    const rise = 3.4;
    const half = d / 2 + 0.5;
    const len = Math.hypot(half, rise);
    const ang = Math.atan2(rise, half);
    const tint = new THREE.Color(0x96533e).multiplyScalar(0.85 + rand() * 0.2);
    for (const sz of [-1, 1]) {
      b.add('roof', part(box(w + 0.6, 0.16, len), at(M, 0, 8.7 + rise / 2, (sz * half) / 2, 0, sz * ang), { color: tint }));
    }
    for (const sx of [-1, 1]) {
      b.add('generic', part(profilePrism([[d / 2, 0], [0, rise], [-d / 2, 0]], 0.2), at(M, sx * (w / 2 - 0.1), 8.7, 0), { color: 0xa09278 }));
    }
    b.add('stone', part(boxB(0.7, 2.2, 0.7), at(M, w / 3, 10.3, -0.8), { color: 0xcfc8bd }));
    info.chimneys.push(new THREE.Vector3().setFromMatrixPosition(at(M, w / 3, 12.6, -0.8)));
  }
}
