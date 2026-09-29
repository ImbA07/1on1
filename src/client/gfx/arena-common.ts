import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Gemeinsame Helfer fuer die prozedurale Arena: Zufall, Rauschen, Geometrie-Baukasten.

export const WALL_INNER = 15;

export function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Rand = () => number;

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export function smoothstep(a: number, b: number, v: number): number {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
}

// ------------------------------------------------------------------ Rauschen (CPU)

function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Wertrauschen, optional kachelbar (period in Zellen). */
export function vnoise(x: number, y: number, seed = 0, period = 0): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const w = (i: number) => (period > 0 ? ((i % period) + period) % period : i);
  const a = hash2(w(xi), w(yi), seed);
  const b = hash2(w(xi + 1), w(yi), seed);
  const c = hash2(w(xi), w(yi + 1), seed);
  const d = hash2(w(xi + 1), w(yi + 1), seed);
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}

export function fbm(x: number, y: number, seed = 0, oct = 4, period = 0): number {
  let s = 0;
  let amp = 0.5;
  let norm = 0;
  let f = 1;
  for (let i = 0; i < oct; i++) {
    s += vnoise(x * f, y * f, seed + i * 17, period > 0 ? period * f : 0) * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return s / norm;
}

// ------------------------------------------------------------------ Geometrie-Baukasten

const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _u = new THREE.Vector3();
const _w = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/** Matrix aus Position, Drehung (Euler YXZ) und Skalierung. */
export function mat(
  x: number,
  y: number,
  z: number,
  ry = 0,
  rx = 0,
  rz = 0,
  sx = 1,
  sy = 1,
  sz = 1,
): THREE.Matrix4 {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ'));
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(sx, sy, sz));
}

/**
 * Lokales Koordinatensystem an der Mauer: Winkel a (0 = +Z), Radius r, Hoehe y.
 * Lokal +Z zeigt zur Hofmitte, lokal +X laeuft entlang der Mauer.
 */
export function polar(a: number, r: number, y = 0): THREE.Matrix4 {
  return mat(Math.sin(a) * r, y, Math.cos(a) * r, a + Math.PI);
}

export function polarPos(a: number, r: number): [number, number] {
  return [Math.sin(a) * r, Math.cos(a) * r];
}

export type ColorFn = (x: number, y: number, z: number, nx: number, ny: number, nz: number) => number;

export interface PartOpts {
  /** Grundfarbe (multipliziert mit Textur). */
  color?: THREE.ColorRepresentation;
  /** 'face': weltbezogene Projektion pro Flaeche; 'keep': vorhandene UVs behalten; 'none': 0. */
  uv?: 'face' | 'keep' | 'local' | 'none';
  /** UV-Streckung (Meter pro Einheit bleibt 1, sonst Faktor). */
  uvScale?: number;
  uvOffset?: [number, number];
  /** Texturrichtung um 90 Grad drehen (Holzmaserung senkrecht). */
  uvSwap?: boolean;
  /** Helligkeitsfaktor pro Ecke in lokalen Koordinaten (vor der Transformation). */
  shadeLocal?: ColorFn;
  /** Helligkeitsfaktor pro Ecke in Weltkoordinaten (nach der Transformation). */
  shade?: ColorFn;
  /** Kontaktschatten am Boden (Weltkoordinate y). */
  groundAO?: number;
  /** Farbvarianz pro Teil (0..1) */
  jitter?: number;
  rand?: Rand;
}

/** Bringt eine Geometrie in das gemeinsame Format: nicht indiziert, position/normal/uv/color. */
export function part(geo: THREE.BufferGeometry, m: THREE.Matrix4 | null, opts: PartOpts = {}): THREE.BufferGeometry {
  let g = geo.index ? geo.toNonIndexed() : geo;
  if (g === geo) g = geo.clone();
  geo.dispose();
  for (const name of Object.keys(g.attributes)) {
    if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
  }
  if (!g.attributes.normal) g.computeVertexNormals();
  const pos = g.attributes.position as THREE.BufferAttribute;
  const nor = g.attributes.normal as THREE.BufferAttribute;
  const count = pos.count;

  // lokale UV-Projektion (vor Transformation) oder Farbe
  const colors = new Float32Array(count * 3);
  const base = new THREE.Color(opts.color ?? 0xffffff);
  if (opts.jitter && opts.rand) {
    const j = 1 + (opts.rand() - 0.5) * 2 * opts.jitter;
    base.multiplyScalar(j);
  }
  for (let i = 0; i < count; i++) {
    let f = 1;
    if (opts.shadeLocal) f *= opts.shadeLocal(pos.getX(i), pos.getY(i), pos.getZ(i), nor.getX(i), nor.getY(i), nor.getZ(i));
    colors[i * 3] = base.r * f;
    colors[i * 3 + 1] = base.g * f;
    colors[i * 3 + 2] = base.b * f;
  }
  if (opts.uv === 'local') faceUV(g, opts);
  if (m) g.applyMatrix4(m);
  if (opts.shade || opts.groundAO) {
    for (let i = 0; i < count; i++) {
      let f = 1;
      const y = pos.getY(i);
      if (opts.shade) f *= opts.shade(pos.getX(i), y, pos.getZ(i), nor.getX(i), nor.getY(i), nor.getZ(i));
      if (opts.groundAO) f *= 1 - opts.groundAO * Math.exp(-Math.max(0, y) / 0.35);
      colors[i * 3] *= f;
      colors[i * 3 + 1] *= f;
      colors[i * 3 + 2] *= f;
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mode = opts.uv ?? 'face';
  if (mode === 'face') faceUV(g, opts);
  else if (mode === 'none' || !g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
  else if (mode === 'keep' && (opts.uvScale || opts.uvOffset)) {
    const uv = g.attributes.uv as THREE.BufferAttribute;
    const s = opts.uvScale ?? 1;
    const [ou, ov] = opts.uvOffset ?? [0, 0];
    for (let i = 0; i < count; i++) uv.setXY(i, uv.getX(i) * s + ou, uv.getY(i) * s + ov);
  }
  return g;
}

/** Projektion pro Dreieck: u waagerecht entlang der Flaeche, v die Flaeche hinauf (in Metern). */
export function faceUV(g: THREE.BufferGeometry, opts: PartOpts = {}): void {
  const pos = g.attributes.position as THREE.BufferAttribute;
  const count = pos.count;
  const uv = new Float32Array(count * 2);
  const s = opts.uvScale ?? 1;
  const [ou, ov] = opts.uvOffset ?? [0, 0];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let i = 0; i < count; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    _n.subVectors(c, b).cross(_w.subVectors(a, b)).normalize();
    if (Math.abs(_n.y) > 0.985) {
      _u.set(1, 0, 0);
      _w.set(0, 0, 1);
    } else {
      _u.crossVectors(UP, _n).normalize();
      _w.crossVectors(_n, _u).normalize();
    }
    for (let k = 0; k < 3; k++) {
      _v.fromBufferAttribute(pos, i + k);
      let u = _v.dot(_u) * s + ou;
      let v = _v.dot(_w) * s + ov;
      if (opts.uvSwap) [u, v] = [v, u];
      uv[(i + k) * 2] = u;
      uv[(i + k) * 2 + 1] = v;
    }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

/** Sammelt Teilgeometrien pro Material und fuegt sie am Ende zusammen. */
export class Buckets {
  readonly map = new Map<string, THREE.BufferGeometry[]>();
  add(key: string, g: THREE.BufferGeometry): void {
    let list = this.map.get(key);
    if (!list) this.map.set(key, (list = []));
    list.push(g);
  }
  merged(key: string): THREE.BufferGeometry | null {
    const list = this.map.get(key);
    if (!list || list.length === 0) return null;
    // Zusatzattribute (z. B. Wind) auf alle Teile ausdehnen
    const extra = new Map<string, number>();
    for (const g of list) {
      for (const [name, attr] of Object.entries(g.attributes)) extra.set(name, (attr as THREE.BufferAttribute).itemSize);
    }
    for (const g of list) {
      for (const [name, size] of extra) {
        if (!g.attributes[name]) {
          g.setAttribute(name, new THREE.BufferAttribute(new Float32Array(g.attributes.position!.count * size), size));
        }
      }
    }
    const m = mergeGeometries(list, false);
    for (const g of list) g.dispose();
    this.map.delete(key);
    if (!m) throw new Error('merge failed: ' + key);
    m.computeBoundingSphere();
    return m;
  }
}

// ------------------------------------------------------------------ Grundformen

/** Prisma aus einem 2D-Profil (in der Z/Y-Ebene), entlang X extrudiert, mittig. */
export function profilePrism(profile: Array<[number, number]>, width: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(profile[0]![0], profile[0]![1]);
  for (let i = 1; i < profile.length; i++) shape.lineTo(profile[i]![0], profile[i]![1]);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false });
  // Shape-x ist unser lokales z, Extrusion (z) wird zu x
  g.applyMatrix4(new THREE.Matrix4().makeRotationY(-Math.PI / 2));
  g.translate(width / 2, 0, 0);
  return g;
}

/** Drehkoerper mit UVs in Metern (u entlang Umfang bei Referenzradius, v entlang Profil). */
export function lathe(profile: Array<[number, number]>, segments: number, uRef = 0, tileU = 0, vStart?: number): THREE.BufferGeometry {
  const pts = profile.map(([r, y]) => new THREE.Vector2(r, y));
  const g = new THREE.LatheGeometry(pts, segments);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  const ref = uRef || profile[0]![0];
  let circ = Math.PI * 2 * ref;
  if (tileU > 0) circ = Math.max(1, Math.round(circ / tileU)) * tileU;
  // v: Laenge entlang des Profils
  const lens = [0];
  for (let i = 1; i < pts.length; i++) lens.push(lens[i - 1]! + pts[i]!.distanceTo(pts[i - 1]!));
  const total = lens[lens.length - 1]!;
  for (let i = 0; i < uv.count; i++) {
    const vi = Math.round(uv.getY(i) * (pts.length - 1));
    uv.setXY(i, uv.getX(i) * circ, lens[Math.min(vi, lens.length - 1)]! * (total > 0 ? 1 : 0) + (vStart ?? profile[0]![1]));
  }
  return g;
}

export function box(w: number, h: number, d: number): THREE.BufferGeometry {
  return new THREE.BoxGeometry(w, h, d);
}

/** Kiste, deren Unterkante auf y=0 liegt. */
export function boxB(w: number, h: number, d: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(0, h / 2, 0);
  return g;
}

/** Zufaellige Verformung der Ecken (fuer Saecke, Steine), bei nicht indizierter Geometrie konsistent pro Ort. */
export function jiggle(g: THREE.BufferGeometry, amount: number, seed: number): THREE.BufferGeometry {
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const k = Math.round(x * 1000) * 7 + Math.round(y * 1000) * 13 + Math.round(z * 1000) * 31;
    const r1 = hash2(k, 1, seed) - 0.5;
    const r2 = hash2(k, 2, seed) - 0.5;
    const r3 = hash2(k, 3, seed) - 0.5;
    pos.setXYZ(i, x + r1 * amount, y + r2 * amount, z + r3 * amount);
  }
  g.computeVertexNormals();
  return g;
}
