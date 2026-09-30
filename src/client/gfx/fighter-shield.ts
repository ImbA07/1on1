import * as THREE from 'three';
import { box, extrude, loft, octa, TriBuilder, tube, v3, xf } from './fighter-geo.js';
import { FighterMeshBuilder } from './fighter-mesh.js';
import type { FighterMaterials } from './fighter-materials.js';

// Dreieckschild (Heater) fuer "Schwert & Schild": leicht gewoelbt, lederbezogen und bemalt
// (Akzentfarbe mit Tatzenkreuz), Stahlrand, Messingbuckel und Nieten, Riemen auf der Rueckseite.
//
// Schildraum: +Z = Vorderseite (nach aussen), +Y = oben, Ursprung = Befestigung am Unterarm.
// Die Halterung (shieldMount) dreht den Schildraum so, dass +Z vom Unterarm weg zeigt
// (Handrueckenseite) und +Y quer zum Unterarm liegt.

const W = 0.23; // halbe Breite
const TOP = 0.22;
const SHOULDER = -0.02; // ab hier laeuft der Schild zur Spitze zusammen
const TIP = -0.38;
const CURVE = 0.42; // Woelbung: z = -CURVE * x^2
const Z_BACK = 0.0;
const THICK = 0.014;

function halfWidth(y: number): number {
  if (y >= SHOULDER) return W;
  const t = Math.min(1, (SHOULDER - y) / (SHOULDER - TIP));
  return W * Math.pow(Math.max(0, 1 - t * t), 0.78);
}

function surfZ(x: number): number {
  return -CURVE * x * x;
}

/** Punkt auf der Schildflaeche (u -1..1 quer, y Hoehe), Vorder- (front) oder Rueckseite. */
function surf(u: number, y: number, front: boolean, out = new THREE.Vector3()): THREE.Vector3 {
  const x = u * halfWidth(y);
  return out.set(x, y, surfZ(x) + Z_BACK + (front ? THICK : 0));
}

function rowsY(): number[] {
  const ys: number[] = [];
  for (let i = 0; i <= 5; i++) ys.push(TOP - ((TOP - SHOULDER) * i) / 5);
  for (let i = 1; i <= 7; i++) {
    const t = i / 7;
    ys.push(SHOULDER - (SHOULDER - TIP) * (1 - Math.pow(1 - t, 1.3)));
  }
  return ys;
}

function face(front: boolean): THREE.BufferGeometry {
  const tb = new TriBuilder();
  const ys = rowsY();
  const cols = 10;
  const ref = v3(0, 0, front ? 1 : -1);
  for (let i = 0; i < ys.length - 1; i++) {
    for (let j = 0; j < cols; j++) {
      const u0 = -1 + (2 * j) / cols;
      const u1 = -1 + (2 * (j + 1)) / cols;
      const a = surf(u0, ys[i]!, front);
      const b = surf(u1, ys[i]!, front);
      const c = surf(u1, ys[i + 1]!, front);
      const d = surf(u0, ys[i + 1]!, front);
      tb.quad(a, b, c, d, ref);
    }
  }
  return tb.geometry();
}

/** Umriss (im Uhrzeigersinn von oben links), auf halber Dicke. */
function outline(): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  const ys = rowsY();
  for (let j = 0; j <= 10; j++) pts.push(new THREE.Vector3((-1 + j / 5) * W, TOP, 0));
  for (let i = 1; i < ys.length; i++) pts.push(new THREE.Vector3(halfWidth(ys[i]!), ys[i]!, 0));
  for (let i = ys.length - 2; i >= 1; i--) pts.push(new THREE.Vector3(-halfWidth(ys[i]!), ys[i]!, 0));
  pts.push(pts[0]!.clone());
  for (const p of pts) p.z = surfZ(p.x) + Z_BACK + THICK / 2;
  return pts;
}

function cross(size: number): THREE.Shape {
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
  return s;
}

/** Flache Form auf die gewoelbte Vorderseite legen. */
function onFace(g: THREE.BufferGeometry, lift: number): THREE.BufferGeometry {
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    p.setZ(i, p.getZ(i) + surfZ(x) + Z_BACK + THICK + lift);
  }
  p.needsUpdate = true;
  return g;
}

export function buildShield(mats: FighterMaterials, accentHex: number): THREE.Group {
  const accent = new THREE.Color(accentHex).lerp(new THREE.Color(0x5a4630), 0.1).multiplyScalar(1.2);
  const b = new FighterMeshBuilder(new Map([['s', 0]]), 700 + (accentHex & 0xff));
  const cream = 0xe0d0a2;
  const steel = 0xa4aab2;
  const brass = 0xb38d4e;

  // Vorderseite: bemaltes Leder in Akzentfarbe, leicht abgeschabt zum Rand hin
  b.add(face(true), {
    mat: 'leather',
    color: accent,
    group: 'shield',
    bone: 's',
    noAO: true,
    jitter: 0.07,
    wear: 0.25,
    cavity: 0.3,
    colorFn: (cen, _n, out) => {
      const edge = Math.max(Math.abs(cen.x) / W, (TOP - cen.y) < 0.03 ? 1 : 0);
      if (edge > 0.85) out.multiplyScalar(0.8); // dunklere Kante (Schmutz)
    },
  });
  // Rueckseite: rohes Holz/Leder
  b.add(face(false), { mat: 'leather', color: 0x4a3322, group: 'shield', bone: 's', noAO: true, jitter: 0.08 });

  // Tatzenkreuz
  const cr = onFace(xf(extrude(cross(0.12), 0.003), { t: [0, 0.035, 0] }), 0.0015);
  b.add(cr, { mat: 'leather', color: cream, group: 'shield', bone: 's', noAO: true, jitter: 0.04, wear: 0.2 });

  // Stahlrand (U-Profil als flaches Rohr entlang des Umrisses)
  const out = outline();
  const rim = tube(
    out,
    out.map(() => [0.011, 0.0105] as const),
    { segs: 6, n: 3, side: v3(0, 0, 1) },
  );
  b.add(rim, { mat: 'metal', color: steel, group: 'shield', bone: 's', noAO: true, jitter: 0.05, wear: 0.6, cavity: 0.4 });

  // Messingbuckel in der Kreuzmitte und Nieten am Rand
  const boss = loft(
    [
      { y: 0, rx: 0.048, rz: 0.048 },
      { y: 0.008, rx: 0.045, rz: 0.045 },
      { y: 0.022, rx: 0.032, rz: 0.032 },
      { y: 0.032, rx: 0.014, rz: 0.014 },
    ],
    { segs: 12, apexTop: v3(0, 0.036, 0) },
  );
  xf(boss, { r: [Math.PI / 2, 0, 0], t: [0, 0.035, Z_BACK + THICK + 0.002] });
  const rivets: THREE.BufferGeometry[] = [];
  const ringR = 0.036;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const x = Math.cos(a) * ringR;
    rivets.push(xf(octa(0.005), { t: [x, 0.035 + Math.sin(a) * ringR, surfZ(x) + Z_BACK + THICK + 0.012] }));
  }
  for (let i = 1; i < out.length - 1; i += 3) {
    const p = out[i]!;
    const inward = v3(-p.x, 0.04 - p.y, 0).normalize().multiplyScalar(0.022);
    const x = p.x + inward.x;
    rivets.push(xf(octa(0.0045), { t: [x, p.y + inward.y, surfZ(x) + Z_BACK + THICK + 0.002] }));
  }
  b.add(boss, { mat: 'metal', color: brass, group: 'shield', bone: 's', noAO: true, jitter: 0.05, wear: 0.5 });
  for (const r of rivets) b.add(r, { mat: 'metal', color: brass, group: 'shield', bone: 's', noAO: true, jitter: 0.08 });

  // Rueckseite: Armriemen (um den Unterarm) und Handgriff
  // Unterarmachse liegt bei z = -0.07 (Schild-X = Richtung Ellbogen)
  const straps: THREE.BufferGeometry[] = [];
  const armZ = -0.07;
  const loop = (x: number, r: number, wdt: number) => {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 8; i++) {
      const a = -Math.PI * 0.5 + (i / 8) * Math.PI * 2 * 0.5 - Math.PI * 0.5;
      pts.push(v3(x, Math.cos(a + Math.PI / 2) * r, armZ + Math.sin(a + Math.PI / 2) * r * 1.02));
    }
    pts.push(v3(x, r * 0.95, surfZ(x) + Z_BACK - 0.001));
    pts.unshift(v3(x, -r * 0.95, surfZ(x) + Z_BACK - 0.001));
    return tube(
      pts,
      pts.map(() => [wdt, 0.0035] as const),
      { segs: 4, n: 4, side: v3(1, 0, 0) },
    );
  };
  straps.push(loop(0.07, 0.062, 0.017));
  // Griff fuer die Faust (quer zum Unterarm) mit zwei Stuetzen
  const gx = -0.19;
  const gz = -0.1;
  straps.push(
    tube([v3(gx, -0.075, gz), v3(gx, 0, gz - 0.004), v3(gx, 0.075, gz)], [
      [0.012, 0.012],
      [0.013, 0.013],
      [0.012, 0.012],
    ], { segs: 6, capStart: true, capEnd: true }),
  );
  for (const y of [-0.07, 0.07]) {
    straps.push(tube([v3(gx, y, gz), v3(gx, y, surfZ(gx) + Z_BACK)], [
      [0.009, 0.009],
      [0.011, 0.011],
    ], { segs: 5 }));
  }
  // Polster unter dem Unterarm
  straps.push(xf(box(0.2, 0.09, 0.012), { t: [-0.03, 0, surfZ(0) + Z_BACK - 0.006] }));
  for (const g of straps) b.add(g, { mat: 'leather', color: 0x3a2518, group: 'shield', bone: 's', noAO: true, jitter: 0.06, wear: 0.3 });

  const meshes = b.build(mats, null).get('shield')!;
  const grp = new THREE.Group();
  grp.name = 'shield';
  for (const m of meshes) grp.add(m);
  return grp;
}

/** Drehung der Schildhalterung im Unterarmraum (links): Schild +Z -> Unterarm -X, Schild +Y -> Unterarm -Z. */
export function shieldMountQuaternion(out: THREE.Quaternion): THREE.Quaternion {
  const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, -1), new THREE.Vector3(-1, 0, 0));
  return out.setFromRotationMatrix(m);
}
