import * as THREE from 'three';
import { merge, mulberry32, smoothstep } from './fighter-geo.js';
import type { FighterMaterials, MatKey } from './fighter-materials.js';

// Sammelt alle Einzelteile der Figur, faerbt sie (Vertex-Farben mit Abnutzung),
// weist Knochen-Gewichte zu und fasst sie pro Ruestungsgruppe und Material zu
// wenigen SkinnedMeshes zusammen (wenige Draw-Calls).

export type Weights = ReadonlyArray<readonly [string, number]>;
export type WeightFn = (p: THREE.Vector3) => Weights;

export interface PieceOpts {
  mat: MatKey;
  color: THREE.ColorRepresentation;
  group: string;
  /** starr an einem Knochen */
  bone?: string;
  /** oder Gewichte pro Ecke */
  weights?: WeightFn;
  /** Farbschwankung pro Dreieck (0..1) */
  jitter?: number;
  /** Kanten-Aufhellung / Mulden-Abdunklung */
  wear?: number;
  cavity?: number;
  /** Farbe pro Dreieck ueberschreiben (Mittelpunkt, Normale) */
  colorFn?: (centroid: THREE.Vector3, normal: THREE.Vector3, out: THREE.Color, u: number, v: number) => void;
  /** Hoehen-Abdunklung ausschalten (z. B. fuer die Waffe) */
  noAO?: boolean;
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _n = new THREE.Vector3();
const _cen = new THREE.Vector3();
const _col = new THREE.Color();
const _base = new THREE.Color();
const _p = new THREE.Vector3();

export class FighterMeshBuilder {
  private readonly pieces = new Map<string, THREE.BufferGeometry[]>();
  private readonly rnd: () => number;

  constructor(
    private readonly boneIndex: ReadonlyMap<string, number>,
    seed: number,
  ) {
    this.rnd = mulberry32(seed);
  }

  add(geo: THREE.BufferGeometry, o: PieceOpts): void {
    const posAttr = geo.getAttribute('position') as THREE.BufferAttribute;
    const pos = posAttr.array as Float32Array;
    const count = posAttr.count;
    if (count === 0) return;

    // --- UV: vorhandene behalten, fehlende per Box-Projektion (Meter) ---
    let uvAttr = geo.getAttribute('uv') as THREE.BufferAttribute | undefined;
    const uv = new Float32Array(count * 2);
    if (uvAttr) uv.set(uvAttr.array as Float32Array);
    else uv.fill(NaN);

    const normals = new Float32Array(count * 3);
    for (let t = 0; t < count; t += 3) {
      _a.fromArray(pos, t * 3);
      _b.fromArray(pos, t * 3 + 3);
      _c.fromArray(pos, t * 3 + 6);
      _c.sub(_a);
      _b.sub(_a);
      _n.crossVectors(_b, _c).normalize(); // (b-a) x (c-a)
      for (let k = 0; k < 3; k++) _n.toArray(normals, (t + k) * 3);
      if (Number.isNaN(uv[t * 2]!)) {
        const ax = Math.abs(_n.x);
        const ay = Math.abs(_n.y);
        const az = Math.abs(_n.z);
        for (let k = 0; k < 3; k++) {
          _p.fromArray(pos, (t + k) * 3);
          let u: number;
          let v: number;
          if (ax >= ay && ax >= az) {
            u = _p.z;
            v = _p.y;
          } else if (ay >= az) {
            u = _p.x;
            v = _p.z;
          } else {
            u = _p.x;
            v = _p.y;
          }
          uv[(t + k) * 2] = u + 0.37 * (o.mat.length % 3);
          uv[(t + k) * 2 + 1] = v;
        }
      }
    }

    // --- Kantenmass pro Ecke (verschweisste Positionen) ---
    const edge = this.edgeFactors(pos, normals, count);

    // --- Farben ---
    const colors = new Float32Array(count * 3);
    _base.set(o.color);
    const jitter = o.jitter ?? 0.06;
    const wear = o.wear ?? 0;
    const cavity = o.cavity ?? 0.25;
    for (let t = 0; t < count; t += 3) {
      _cen.set(0, 0, 0);
      for (let k = 0; k < 3; k++) _cen.x += pos[(t + k) * 3]! / 3;
      for (let k = 0; k < 3; k++) _cen.y += pos[(t + k) * 3 + 1]! / 3;
      for (let k = 0; k < 3; k++) _cen.z += pos[(t + k) * 3 + 2]! / 3;
      _col.copy(_base);
      if (o.colorFn) {
        _n.fromArray(normals, t * 3);
        const cu = (uv[t * 2]! + uv[t * 2 + 2]! + uv[t * 2 + 4]!) / 3;
        const cv = (uv[t * 2 + 1]! + uv[t * 2 + 3]! + uv[t * 2 + 5]!) / 3;
        o.colorFn(_cen, _n, _col, cu, cv);
      }
      const j = 1 + (this.rnd() * 2 - 1) * jitter;
      for (let k = 0; k < 3; k++) {
        const vi = t + k;
        const e = edge[vi]!;
        let f = j;
        if (e > 0) f *= 1 + e * wear;
        else f *= 1 + e * cavity;
        if (!o.noAO) {
          const y = pos[vi * 3 + 1]!;
          f *= 0.72 + 0.28 * smoothstep(0.0, 1.05, y);
        }
        colors[vi * 3] = Math.min(1, _col.r * f);
        colors[vi * 3 + 1] = Math.min(1, _col.g * f);
        colors[vi * 3 + 2] = Math.min(1, _col.b * f);
      }
    }

    // --- Knochen-Gewichte ---
    const si = new Uint16Array(count * 4);
    const sw = new Float32Array(count * 4);
    const rigid = o.bone !== undefined ? this.idx(o.bone) : -1;
    for (let v = 0; v < count; v++) {
      if (rigid >= 0 || !o.weights) {
        si[v * 4] = Math.max(0, rigid);
        sw[v * 4] = 1;
        continue;
      }
      _p.fromArray(pos, v * 3);
      const ws = o.weights(_p);
      let sum = 0;
      const n = Math.min(4, ws.length);
      for (let k = 0; k < n; k++) sum += ws[k]![1];
      for (let k = 0; k < n; k++) {
        si[v * 4 + k] = this.idx(ws[k]![0]);
        sw[v * 4 + k] = sum > 0 ? ws[k]![1] / sum : k === 0 ? 1 : 0;
      }
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    geo.dispose();
    const key = `${o.group}|${o.mat}`;
    let list = this.pieces.get(key);
    if (!list) this.pieces.set(key, (list = []));
    list.push(g);
    uvAttr = undefined;
  }

  private idx(name: string): number {
    const i = this.boneIndex.get(name);
    if (i === undefined) throw new Error('Unbekannter Knochen: ' + name);
    return i;
  }

  /**
   * Pro Ecke: >0 = aussen liegende Kante (hell, abgenutzt), <0 = Mulde (dunkel).
   * Aus der Streuung der angrenzenden Flaechen-Normalen.
   */
  private edgeFactors(pos: Float32Array, normals: Float32Array, count: number): Float32Array {
    const keyOf = (i: number) =>
      `${Math.round(pos[i * 3]! * 2e4)},${Math.round(pos[i * 3 + 1]! * 2e4)},${Math.round(pos[i * 3 + 2]! * 2e4)}`;
    const map = new Map<string, number>();
    const ids = new Int32Array(count);
    const acc: number[] = []; // nx, ny, nz, cx, cy, cz, count
    for (let v = 0; v < count; v++) {
      const k = keyOf(v);
      let id = map.get(k);
      if (id === undefined) {
        id = acc.length / 7;
        map.set(k, id);
        acc.push(0, 0, 0, 0, 0, 0, 0);
      }
      ids[v] = id;
      const t = v - (v % 3);
      const b = id * 7;
      acc[b] += normals[v * 3]!;
      acc[b + 1] += normals[v * 3 + 1]!;
      acc[b + 2] += normals[v * 3 + 2]!;
      for (let k2 = 0; k2 < 3; k2++) {
        acc[b + 3] += pos[(t + k2) * 3]! / 3;
        acc[b + 4] += pos[(t + k2) * 3 + 1]! / 3;
        acc[b + 5] += pos[(t + k2) * 3 + 2]! / 3;
      }
      acc[b + 6] += 1;
    }
    const out = new Float32Array(count);
    for (let v = 0; v < count; v++) {
      const b = ids[v]! * 7;
      const c = acc[b + 6]!;
      const nx = acc[b]!;
      const ny = acc[b + 1]!;
      const nz = acc[b + 2]!;
      const len = Math.hypot(nx, ny, nz);
      const spread = 1 - len / c;
      if (len < 1e-6) continue;
      const dx = pos[v * 3]! - acc[b + 3]! / c;
      const dy = pos[v * 3 + 1]! - acc[b + 4]! / c;
      const dz = pos[v * 3 + 2]! - acc[b + 5]! / c;
      const convex = (dx * nx + dy * ny + dz * nz) / len;
      const s = smoothstep(0.015, 0.16, spread);
      out[v] = convex >= 0 ? s : -s;
    }
    return out;
  }

  /**
   * Baut die Meshes. Rueckgabe: Gruppe -> Meshes. Mit Skelett als SkinnedMesh,
   * sonst als normales Mesh (z. B. Waffe).
   */
  build(mats: FighterMaterials, skeleton: THREE.Skeleton | null): Map<string, THREE.Mesh[]> {
    const out = new Map<string, THREE.Mesh[]>();
    const identity = new THREE.Matrix4();
    for (const [key, list] of this.pieces) {
      const [group, mat] = key.split('|') as [string, MatKey];
      const geo = list.length === 1 ? list[0]! : merge(list);
      if (list.length > 1) list.forEach((g) => g.dispose());
      let mesh: THREE.Mesh;
      if (skeleton) {
        const sm = new THREE.SkinnedMesh(geo, mats[mat]);
        sm.bind(skeleton, identity);
        // Grosszuegige feste Huelle, damit die animierte Figur nie weggeschnitten wird
        sm.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1.0, 0), 1.5);
        mesh = sm;
      } else {
        mesh = new THREE.Mesh(geo, mats[mat]);
      }
      mesh.name = key;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      let arr = out.get(group);
      if (!arr) out.set(group, (arr = []));
      arr.push(mesh);
    }
    this.pieces.clear();
    return out;
  }

  triangleCount(): number {
    let n = 0;
    for (const list of this.pieces.values()) for (const g of list) n += g.getAttribute('position').count / 3;
    return n;
  }
}

// ------------------------------------------------------------------ Gewichts-Helfer

export function rigid(bone: string): WeightFn {
  const w: Weights = [[bone, 1]];
  return () => w;
}

/** Uebergang entlang Y: unter y0 ganz "low", ueber y1 ganz "high". */
export function vblend(low: string, high: string, y0: number, y1: number): WeightFn {
  return (p) => {
    const t = smoothstep(y0, y1, p.y);
    return [
      [low, 1 - t],
      [high, t],
    ];
  };
}
