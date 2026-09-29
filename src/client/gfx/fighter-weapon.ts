import * as THREE from 'three';
import { loft, TriBuilder, tube, v3, xf } from './fighter-geo.js';
import { FighterMeshBuilder } from './fighter-mesh.js';
import type { FighterMaterials } from './fighter-materials.js';

// Ritterschwert: Klinge mit Hohlkehle, gebogene Parierstange, Lederwickel-Griff,
// Radknauf. Gebaut entlang +Y (Knauf unten), danach so gedreht, dass die Klinge
// in der Halterung nach -Z zeigt und die Schneiden oben/unten liegen.

const BLADE_LEN = 0.8;

function blade(): THREE.BufferGeometry {
  const tb = new TriBuilder();
  const stations = [0, 0.03, 0.1, 0.2, 0.32, 0.45, 0.58, 0.68, 0.76, 0.84, 0.91, 0.96, 1];
  const y0 = 0.072;
  const rings: THREE.Vector3[][] = [];
  for (const t of stations) {
    const w = t < 0.8 ? 0.0265 - 0.0075 * (t / 0.8) : 0.019 * Math.pow(Math.max(0, 1 - (t - 0.8) / 0.2), 0.8);
    const th = 0.0048 - 0.0024 * t;
    const fuller = t > 0.02 && t < 0.66 ? Math.min(1, (t - 0.02) / 0.05, (0.66 - t) / 0.08) : 0;
    const fw = w * 0.3;
    const fc = th * (1 - 0.62 * fuller);
    const y = y0 + t * BLADE_LEN;
    const wEff = Math.max(w, 0.0004);
    // Querschnitt: x = Dicke, z = Breite. Rundherum (12 Punkte).
    const pts: [number, number][] = [
      [0, wEff],
      [th * 0.95, wEff * 0.62],
      [th, fw + 0.001],
      [fc, 0],
      [th, -fw - 0.001],
      [th * 0.95, -wEff * 0.62],
      [0, -wEff],
      [-th * 0.95, -wEff * 0.62],
      [-th, -fw - 0.001],
      [-fc, 0],
      [-th, fw + 0.001],
      [-th * 0.95, wEff * 0.62],
    ];
    rings.push(pts.map(([x, z]) => v3(x, y, z)));
  }
  const ref = new THREE.Vector3();
  for (let i = 0; i < rings.length - 1; i++) {
    const a = rings[i]!;
    const b = rings[i + 1]!;
    for (let j = 0; j < 12; j++) {
      const k = (j + 1) % 12;
      ref.set(a[j]!.x + a[k]!.x, 0, a[j]!.z + a[k]!.z);
      // Hohlkehlen-Flaechen zeigen nach aussen in Dickenrichtung
      if (Math.abs(ref.x) < 1e-6 && Math.abs(ref.z) < 1e-6) ref.set(1, 0, 0);
      if (j === 2 || j === 3) ref.set(1, 0, 0);
      if (j === 8 || j === 9) ref.set(-1, 0, 0);
      tb.quad(a[j]!, a[k]!, b[k]!, b[j]!, ref);
    }
  }
  // Boden (an der Parierstange)
  const base = rings[0]!;
  const c0 = v3(0, y0, 0);
  for (let j = 0; j < 12; j++) tb.tri(c0, base[j]!, base[(j + 1) % 12]!, v3(0, -1, 0));
  return tb.geometry();
}

export function buildSword(mats: FighterMaterials): THREE.Group {
  const b = new FighterMeshBuilder(new Map([['w', 0]]), 404);
  const steel = 0xd3d8de;
  const bronze = 0xb08440;

  b.add(blade(), {
    mat: 'metal',
    color: steel,
    group: 'sword',
    bone: 'w',
    noAO: true,
    jitter: 0.02,
    wear: 0.35,
    colorFn: (cen, n, out) => {
      const inFuller = Math.abs(cen.z) < 0.009 && cen.y < 0.072 + 0.64 * BLADE_LEN && cen.y > 0.09;
      if (inFuller && Math.abs(n.x) > 0.6) out.setHex(0x8f969e);
      else if (Math.abs(n.z) > 0.35) out.setHex(0xf2f4f6); // geschliffene Fase
    },
  });

  // Parierstange (leicht zur Klinge gebogen, Enden verdickt)
  const gp: THREE.Vector3[] = [];
  const gr: [number, number][] = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    const z = (t - 0.5) * 0.21;
    const y = 0.062 + Math.pow(Math.abs(t - 0.5) * 2, 2) * 0.016;
    gp.push(v3(0, y, z));
    const end = Math.pow(Math.abs(t - 0.5) * 2, 6);
    gr.push([0.0085 + end * 0.004, 0.008 + end * 0.004]);
  }
  const guard = tube(gp, gr, { segs: 6, capStart: true, capEnd: true, side: v3(1, 0, 0) });
  // Mittelstueck (Quillon-Block)
  const block = xf(new THREE.BoxGeometry(0.02, 0.022, 0.03).toNonIndexed(), { t: [0, 0.062, 0] });
  block.deleteAttribute('normal');
  block.deleteAttribute('uv');
  // Radknauf
  const pommel = loft(
    [
      { y: -0.012, rx: 0.025, rz: 0.025 },
      { y: -0.008, rx: 0.032, rz: 0.032 },
      { y: 0.008, rx: 0.032, rz: 0.032 },
      { y: 0.012, rx: 0.025, rz: 0.025 },
    ],
    { segs: 12, capTop: true, capBottom: true },
  );
  xf(pommel, { r: [0, 0, Math.PI / 2], t: [0, -0.083, 0] });
  const boss = loft(
    [
      { y: -0.017, rx: 0.012, rz: 0.012 },
      { y: 0.017, rx: 0.012, rz: 0.012 },
    ],
    { segs: 8, capTop: true, capBottom: true },
  );
  xf(boss, { r: [0, 0, Math.PI / 2], t: [0, -0.083, 0] });
  const peen = xf(new THREE.BoxGeometry(0.01, 0.012, 0.012).toNonIndexed(), { t: [0, -0.118, 0] });
  peen.deleteAttribute('normal');
  peen.deleteAttribute('uv');
  // Zwingen am Griff
  const ferrules = [
    loft(
      [
        { y: 0.043, rx: 0.018, rz: 0.018 },
        { y: 0.052, rx: 0.018, rz: 0.018 },
      ],
      { segs: 10, capTop: true },
    ),
    loft(
      [
        { y: -0.058, rx: 0.018, rz: 0.018 },
        { y: -0.049, rx: 0.018, rz: 0.018 },
      ],
      { segs: 10, capBottom: true },
    ),
  ];
  for (const g of [guard, block, pommel, boss, peen, ...ferrules]) {
    b.add(g, { mat: 'metal', color: bronze, group: 'sword', bone: 'w', noAO: true, jitter: 0.04, wear: 0.5, cavity: 0.4 });
  }

  // Griff mit spiralfoermigem Lederwickel
  const gripRings = [];
  for (let i = 0; i <= 16; i++) {
    const y = -0.05 + (i / 16) * 0.094;
    const swell = 1 + 0.08 * Math.sin((i / 16) * Math.PI);
    gripRings.push({ y, rx: 0.0145 * swell, rz: 0.0165 * swell });
  }
  const grip = loft(gripRings, {
    segs: 10,
    deform: (p, th, i) => {
      const k = 0.5 + 0.5 * Math.sin(th + i * 1.6);
      const r = Math.hypot(p.x, p.z);
      const s = 1 + (k * 0.0022) / r;
      p.x *= s;
      p.z *= s;
    },
  });
  b.add(grip, { mat: 'leather', color: 0x3a2416, group: 'sword', bone: 'w', noAO: true, jitter: 0.08, wear: 0.4, cavity: 0.5 });

  const meshes = b.build(mats, null).get('sword')!;
  const g = new THREE.Group();
  g.name = 'sword';
  for (const m of meshes) {
    m.geometry.rotateX(-Math.PI / 2); // +Y -> -Z (Klinge nach vorne)
    g.add(m);
  }
  return g;
}
