import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Geometrie-Werkzeuge fuer die Kaempfer-Figur.
// Alles wird als "nicht indizierte" Dreiecksliste gebaut (passt zum Flat-Shading-Look).
// Jede Flaeche wird beim Anlegen automatisch nach aussen ausgerichtet (Referenzrichtung),
// dadurch muss man beim Bauen nicht auf die Reihenfolge der Ecken achten.

const _ab = new THREE.Vector3();
const _ac = new THREE.Vector3();
const _n = new THREE.Vector3();

export function v3(x: number, y: number, z: number): THREE.Vector3 {
  return new THREE.Vector3(x, y, z);
}

/** Sammelt Dreiecke (Position + UV in Metern). UV NaN = spaeter per Box-Projektion. */
export class TriBuilder {
  readonly pos: number[] = [];
  readonly uv: number[] = [];

  tri(
    a: THREE.Vector3,
    b: THREE.Vector3,
    c: THREE.Vector3,
    ref?: THREE.Vector3 | null,
    ua?: readonly [number, number],
    ub?: readonly [number, number],
    uc?: readonly [number, number],
  ): void {
    _ab.subVectors(b, a);
    _ac.subVectors(c, a);
    _n.crossVectors(_ab, _ac);
    if (_n.lengthSq() < 1e-14) return; // entartet
    let B = b;
    let C = c;
    let UB = ub;
    let UC = uc;
    if (ref && _n.dot(ref) < 0) {
      B = c;
      C = b;
      UB = uc;
      UC = ub;
    }
    this.pos.push(a.x, a.y, a.z, B.x, B.y, B.z, C.x, C.y, C.z);
    if (ua && UB && UC) this.uv.push(ua[0], ua[1], UB[0], UB[1], UC[0], UC[1]);
    else this.uv.push(NaN, NaN, NaN, NaN, NaN, NaN);
  }

  quad(
    a: THREE.Vector3,
    b: THREE.Vector3,
    c: THREE.Vector3,
    d: THREE.Vector3,
    ref?: THREE.Vector3 | null,
    ua?: readonly [number, number],
    ub?: readonly [number, number],
    uc?: readonly [number, number],
    ud?: readonly [number, number],
  ): void {
    this.tri(a, b, c, ref, ua, ub, uc);
    this.tri(a, c, d, ref, ua, uc, ud);
  }

  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    return g;
  }
}

// ------------------------------------------------------------------ Loft

export interface Ring {
  y: number;
  rx: number;
  /** Tiefe nach vorne (-Z) und hinten (+Z); rz setzt beide */
  rz?: number;
  rzF?: number;
  rzB?: number;
  cx?: number;
  cz?: number;
  /** Superellipsen-Exponent (2 = Ellipse, groesser = kastiger) */
  n?: number;
}

export interface LoftOpts {
  segs: number;
  /** Winkelbereich; 0 = vorne (-Z), PI/2 = rechts (+X). Ohne Angabe: geschlossen. */
  arc?: [number, number];
  capTop?: boolean;
  capBottom?: boolean;
  /** Spitze statt flachem Deckel oben */
  apexTop?: THREE.Vector3;
  apexBottom?: THREE.Vector3;
  /** Blechstaerke: erzeugt Innenflaeche und Kanten */
  thickness?: number;
  deform?: (p: THREE.Vector3, theta: number, ring: number) => void;
}

function sgnPow(v: number, e: number): number {
  return Math.sign(v) * Math.pow(Math.abs(v), e);
}

export function ringPoint(r: Ring, theta: number, out: THREE.Vector3): THREE.Vector3 {
  const n = r.n ?? 2;
  const s = Math.sin(theta);
  const c = Math.cos(theta);
  const sx = sgnPow(s, 2 / n);
  const sc = sgnPow(c, 2 / n);
  const rzF = r.rzF ?? r.rz ?? r.rx;
  const rzB = r.rzB ?? r.rz ?? r.rx;
  out.set((r.cx ?? 0) + r.rx * sx, r.y, (r.cz ?? 0) - (c >= 0 ? rzF : rzB) * sc);
  return out;
}

/** Ringe entlang Y verbinden (Rumpf, Glieder, Helm, Plattenschalen). */
export function loft(rings: Ring[], o: LoftOpts): THREE.BufferGeometry {
  const tb = new TriBuilder();
  const closed = !o.arc;
  const t0 = o.arc ? o.arc[0] : 0;
  const t1 = o.arc ? o.arc[1] : Math.PI * 2;
  const cols = o.segs + 1;
  const outer: THREE.Vector3[][] = [];
  const inner: THREE.Vector3[][] = [];
  const uvs: [number, number][][] = [];
  const centers: THREE.Vector3[] = [];
  rings.forEach((r, i) => {
    const row: THREE.Vector3[] = [];
    const urow: [number, number][] = [];
    const avgR = (r.rx + (r.rzF ?? r.rz ?? r.rx) + (r.rzB ?? r.rz ?? r.rx)) / 3;
    for (let j = 0; j < cols; j++) {
      const th = closed && j === o.segs ? t0 : t0 + ((t1 - t0) * j) / o.segs;
      const p = ringPoint(r, th, new THREE.Vector3());
      o.deform?.(p, th, i);
      row.push(p);
      urow.push([(t0 + ((t1 - t0) * j) / o.segs) * avgR, r.y]);
    }
    outer.push(row);
    uvs.push(urow);
    centers.push(new THREE.Vector3(r.cx ?? 0, r.y, r.cz ?? 0));
  });
  if (o.thickness) {
    rings.forEach((r, i) => {
      const c = centers[i]!;
      inner.push(
        outer[i]!.map((p) => {
          const d = new THREE.Vector3(p.x - c.x, 0, p.z - c.z);
          const len = d.length();
          if (len < 1e-6) return p.clone();
          return p.clone().addScaledVector(d, -Math.min(o.thickness!, len * 0.9) / len);
        }),
      );
    });
  }
  const ref = new THREE.Vector3();
  const mid = new THREE.Vector3();
  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < o.segs; j++) {
      const a = outer[i]![j]!;
      const b = outer[i]![j + 1]!;
      const c = outer[i + 1]![j + 1]!;
      const d = outer[i + 1]![j]!;
      mid.copy(a).add(b).add(c).add(d).multiplyScalar(0.25);
      const cy = (centers[i]!.y + centers[i + 1]!.y) / 2;
      ref.set(mid.x - (centers[i]!.x + centers[i + 1]!.x) / 2, 0, mid.z - (centers[i]!.z + centers[i + 1]!.z) / 2);
      // Schraege Flaechen (z. B. Schultern) bekommen einen Y-Anteil aus der Flaechennormalen
      _ab.subVectors(b, a);
      _ac.subVectors(d, a);
      _n.crossVectors(_ac, _ab);
      if (_n.dot(ref) < 0) _n.negate();
      if (ref.lengthSq() < 1e-8) ref.set(0, mid.y > cy ? 1 : -1, 0);
      else ref.copy(_n);
      tb.quad(a, b, c, d, ref, uvs[i]![j], uvs[i]![j + 1], uvs[i + 1]![j + 1], uvs[i + 1]![j]);
      if (o.thickness) {
        const A = inner[i]![j]!;
        const B = inner[i]![j + 1]!;
        const C = inner[i + 1]![j + 1]!;
        const D = inner[i + 1]![j]!;
        ref.negate();
        tb.quad(A, B, C, D, ref, uvs[i]![j], uvs[i]![j + 1], uvs[i + 1]![j + 1], uvs[i + 1]![j]);
      }
    }
  }
  const last = rings.length - 1;
  if (o.thickness) {
    // Kanten oben/unten
    for (const [ri, rn] of [
      [0, 1],
      [last, last - 1],
    ] as const) {
      for (let j = 0; j < o.segs; j++) {
        const a = outer[ri]![j]!;
        const b = outer[ri]![j + 1]!;
        ref.subVectors(a, outer[rn]![j]!).add(_ab.subVectors(b, outer[rn]![j + 1]!));
        tb.quad(a, b, inner[ri]![j + 1]!, inner[ri]![j]!, ref);
      }
    }
    if (!closed) {
      for (const [cj, cn] of [
        [0, 1],
        [o.segs, o.segs - 1],
      ] as const) {
        for (let i = 0; i < last; i++) {
          const a = outer[i]![cj]!;
          const d = outer[i + 1]![cj]!;
          ref.subVectors(a, outer[i]![cn]!).add(_ab.subVectors(d, outer[i + 1]![cn]!));
          tb.quad(a, d, inner[i + 1]![cj]!, inner[i]![cj]!, ref);
        }
      }
    }
  }
  const capFan = (ri: number, apex: THREE.Vector3, up: number) => {
    for (let j = 0; j < o.segs; j++) {
      const a = outer[ri]![j]!;
      const b = outer[ri]![j + 1]!;
      mid.copy(a).add(b).multiplyScalar(0.5);
      ref.set(mid.x - apex.x, 0, mid.z - apex.z).normalize().multiplyScalar(0.3);
      ref.y += up;
      _ab.subVectors(b, a);
      _ac.subVectors(apex, a);
      _n.crossVectors(_ab, _ac);
      if (_n.dot(ref) < 0) _n.negate();
      tb.tri(apex, a, b, _n.clone());
    }
  };
  if (o.apexTop) capFan(last, o.apexTop, 1);
  else if (o.capTop) capFan(last, outerCenter(outer[last]!, rings[last]!), 1);
  if (o.apexBottom) capFan(0, o.apexBottom, -1);
  else if (o.capBottom) capFan(0, outerCenter(outer[0]!, rings[0]!), -1);
  return tb.geometry();
}

function outerCenter(row: THREE.Vector3[], r: Ring): THREE.Vector3 {
  const c = new THREE.Vector3();
  const n = row.length - 1;
  for (let j = 0; j < n; j++) c.add(row[j]!);
  c.multiplyScalar(1 / Math.max(1, n));
  c.y = r.y;
  return c;
}

// ------------------------------------------------------------------ Tuch/Platte als Flaeche

/**
 * Flaeche aus einem Punktegitter (u quer, v laengs) mit Dicke.
 * fn liefert den Punkt, nrm die "Aussen"-Richtung (Vorderseite).
 */
export function sheet(
  us: number[],
  vs: number[],
  fn: (u: number, v: number) => THREE.Vector3,
  nrm: (u: number, v: number) => THREE.Vector3,
  thickness: number,
): THREE.BufferGeometry {
  const tb = new TriBuilder();
  const F: THREE.Vector3[][] = [];
  const Bk: THREE.Vector3[][] = [];
  const N: THREE.Vector3[][] = [];
  for (const v of vs) {
    const rf: THREE.Vector3[] = [];
    const rb: THREE.Vector3[] = [];
    const rn: THREE.Vector3[] = [];
    for (const u of us) {
      const p = fn(u, v);
      const n = nrm(u, v).normalize();
      rf.push(p.clone().addScaledVector(n, thickness / 2));
      rb.push(p.clone().addScaledVector(n, -thickness / 2));
      rn.push(n);
    }
    F.push(rf);
    Bk.push(rb);
    N.push(rn);
  }
  const ref = new THREE.Vector3();
  const L = (u: number, v: number): [number, number] => [u, v];
  for (let i = 0; i < vs.length - 1; i++) {
    for (let j = 0; j < us.length - 1; j++) {
      ref.copy(N[i]![j]!).add(N[i + 1]![j + 1]!);
      const uv0 = L(us[j]!, vs[i]!);
      const uv1 = L(us[j + 1]!, vs[i]!);
      const uv2 = L(us[j + 1]!, vs[i + 1]!);
      const uv3 = L(us[j]!, vs[i + 1]!);
      tb.quad(F[i]![j]!, F[i]![j + 1]!, F[i + 1]![j + 1]!, F[i + 1]![j]!, ref, uv0, uv1, uv2, uv3);
      ref.negate();
      tb.quad(Bk[i]![j]!, Bk[i]![j + 1]!, Bk[i + 1]![j + 1]!, Bk[i + 1]![j]!, ref, uv0, uv1, uv2, uv3);
    }
  }
  const ni = vs.length - 1;
  const nj = us.length - 1;
  // Raender
  for (let j = 0; j < nj; j++) {
    for (const [i, inw] of [
      [0, 1],
      [ni, ni - 1],
    ] as const) {
      ref.subVectors(F[i]![j]!, F[inw]![j]!);
      tb.quad(F[i]![j]!, F[i]![j + 1]!, Bk[i]![j + 1]!, Bk[i]![j]!, ref);
    }
  }
  for (let i = 0; i < ni; i++) {
    for (const [j, inw] of [
      [0, 1],
      [nj, nj - 1],
    ] as const) {
      ref.subVectors(F[i]![j]!, F[i]![inw]!);
      tb.quad(F[i]![j]!, F[i + 1]![j]!, Bk[i + 1]![j]!, Bk[i]![j]!, ref);
    }
  }
  return tb.geometry();
}

// ------------------------------------------------------------------ Rohr entlang eines Pfads

export interface TubeOpts {
  segs: number;
  /** Richtung, die als "Seite" (rx) des Querschnitts dient */
  side?: THREE.Vector3;
  capStart?: boolean;
  capEnd?: boolean;
  /** Superellipse fuer kantige Querschnitte */
  n?: number;
  deform?: (p: THREE.Vector3, theta: number, i: number) => void;
}

/** Rohr durch Punkte, Querschnitt-Radien je Punkt [rx (Seite), ry (Normale)]. */
export function tube(pts: THREE.Vector3[], radii: ReadonlyArray<readonly [number, number]>, o: TubeOpts): THREE.BufferGeometry {
  const tb = new TriBuilder();
  const side = o.side ?? new THREE.Vector3(1, 0, 0);
  const n = o.n ?? 2;
  const rings: THREE.Vector3[][] = [];
  const T = new THREE.Vector3();
  const X = new THREE.Vector3();
  const N = new THREE.Vector3();
  let len = 0;
  const vcoord: number[] = [];
  pts.forEach((p, i) => {
    if (i > 0) len += p.distanceTo(pts[i - 1]!);
    vcoord.push(len);
    const a = pts[Math.max(0, i - 1)]!;
    const b = pts[Math.min(pts.length - 1, i + 1)]!;
    T.subVectors(b, a).normalize();
    X.copy(side).addScaledVector(T, -side.dot(T)).normalize();
    N.crossVectors(T, X);
    const [rx, ry] = radii[i]!;
    const row: THREE.Vector3[] = [];
    for (let j = 0; j <= o.segs; j++) {
      const th = (j / o.segs) * Math.PI * 2;
      const c = sgnPow(Math.cos(th), 2 / n);
      const s = sgnPow(Math.sin(th), 2 / n);
      const q = p.clone().addScaledVector(X, rx * c).addScaledVector(N, ry * s);
      o.deform?.(q, th, i);
      row.push(q);
    }
    rings.push(row);
  });
  const ref = new THREE.Vector3();
  for (let i = 0; i < pts.length - 1; i++) {
    const r = (radii[i]![0] + radii[i]![1]) / 2;
    for (let j = 0; j < o.segs; j++) {
      const a = rings[i]![j]!;
      const b = rings[i]![j + 1]!;
      const c = rings[i + 1]![j + 1]!;
      const d = rings[i + 1]![j]!;
      ref.copy(a).add(b).add(c).add(d).multiplyScalar(0.25).sub(_ab.copy(pts[i]!).add(pts[i + 1]!).multiplyScalar(0.5));
      const u0 = (j / o.segs) * Math.PI * 2 * r;
      const u1 = ((j + 1) / o.segs) * Math.PI * 2 * r;
      tb.quad(a, b, c, d, ref, [u0, vcoord[i]!], [u1, vcoord[i]!], [u1, vcoord[i + 1]!], [u0, vcoord[i + 1]!]);
    }
  }
  const cap = (i: number, dir: number) => {
    const c = pts[i]!;
    const nb = pts[i + (dir > 0 ? -1 : 1)]!;
    ref.subVectors(c, nb).normalize();
    for (let j = 0; j < o.segs; j++) tb.tri(c, rings[i]![j]!, rings[i]![j + 1]!, ref.clone());
  };
  if (o.capStart) cap(0, -1);
  if (o.capEnd) cap(pts.length - 1, 1);
  return tb.geometry();
}

// ------------------------------------------------------------------ Grundkoerper

export function fromThree(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const ni = g.index ? g.toNonIndexed() : g;
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', ni.getAttribute('position').clone());
  if (ni !== g) ni.dispose();
  g.dispose();
  return out;
}

export function box(w: number, h: number, d: number): THREE.BufferGeometry {
  return fromThree(new THREE.BoxGeometry(w, h, d));
}

export function octa(r: number): THREE.BufferGeometry {
  return fromThree(new THREE.OctahedronGeometry(r, 0));
}

export function ico(r: number, detail = 0): THREE.BufferGeometry {
  return fromThree(new THREE.IcosahedronGeometry(r, detail));
}

export function cyl(rt: number, rb: number, h: number, segs: number, open = false): THREE.BufferGeometry {
  return fromThree(new THREE.CylinderGeometry(rt, rb, h, segs, 1, open));
}

export function sphere(r: number, ws: number, hs: number, phi0 = 0, phiL = Math.PI * 2, th0 = 0, thL = Math.PI): THREE.BufferGeometry {
  return fromThree(new THREE.SphereGeometry(r, ws, hs, phi0, phiL, th0, thL));
}

/** Prisma aus einer 2D-Kontur (XY), Dicke entlang Z, zentriert. */
export function extrude(shape: THREE.Shape, depth: number, bevel = 0): THREE.BufferGeometry {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 1,
    curveSegments: 6,
  });
  g.translate(0, 0, -depth / 2);
  return fromThree(g);
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _t = new THREE.Vector3();

export interface XForm {
  t?: readonly [number, number, number];
  r?: readonly [number, number, number];
  s?: number | readonly [number, number, number];
  order?: THREE.EulerOrder;
}

/** Skalieren, dann drehen, dann verschieben (veraendert die Geometrie). */
export function xf(g: THREE.BufferGeometry, x: XForm): THREE.BufferGeometry {
  const s = x.s ?? 1;
  if (typeof s === 'number') _s.set(s, s, s);
  else _s.set(s[0], s[1], s[2]);
  _e.set(x.r?.[0] ?? 0, x.r?.[1] ?? 0, x.r?.[2] ?? 0, x.order ?? 'XYZ');
  _q.setFromEuler(_e);
  _t.set(x.t?.[0] ?? 0, x.t?.[1] ?? 0, x.t?.[2] ?? 0);
  _m.compose(_t, _q, _s);
  g.applyMatrix4(_m);
  if (_s.x * _s.y * _s.z < 0) flipWinding(g);
  return g;
}

export function flipWinding(g: THREE.BufferGeometry): void {
  for (const name of ['position', 'uv', 'normal']) {
    const a = g.getAttribute(name) as THREE.BufferAttribute | undefined;
    if (!a) continue;
    const arr = a.array as Float32Array;
    const sz = a.itemSize;
    for (let t = 0; t < a.count; t += 3) {
      for (let k = 0; k < sz; k++) {
        const i1 = (t + 1) * sz + k;
        const i2 = (t + 2) * sz + k;
        const tmp = arr[i1]!;
        arr[i1] = arr[i2]!;
        arr[i2] = tmp;
      }
    }
    a.needsUpdate = true;
  }
}

export function mirrorX(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const c = g.clone();
  c.scale(-1, 1, 1);
  flipWinding(c);
  return c;
}

export function merge(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const m = mergeGeometries(list, false);
  if (!m) throw new Error('mergeGeometries fehlgeschlagen');
  return m;
}

// ------------------------------------------------------------------ Zufall

export function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}
