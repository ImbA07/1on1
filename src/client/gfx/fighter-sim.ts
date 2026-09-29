import * as THREE from 'three';
import { CHAINS, chainBoneName, restPos, type ChainDef, type Rig } from './fighter-rig.js';

// Sekundaerbewegung: Umhang, Waffenrock, Helmbusch und Schwertscheide.
// Punkte werden im Weltraum per Verlet-Integration bewegt (reagiert dadurch von
// selbst auf Beschleunigung und Drehung), an Ruhelage gezogen, an Abstaende gebunden
// und aus Koerper-Kapseln herausgeschoben. Danach werden die Knochen ausgerichtet.
// Keine Speicheranforderungen pro Bild.

interface ChainParams {
  /** Zug zur Ruhelage je Schritt (0..1), pro Zeile (oben -> unten) */
  stiff: number[];
  damping: number;
  gravity: number;
  colliders: string[];
  radius: number;
  /** Querverbindungen zwischen Spalten (Tuch) */
  cross: boolean;
}

const PARAMS: Record<string, ChainParams> = {
  cape: { stiff: [1, 0.05, 0.03, 0.022, 0.018], damping: 0.975, gravity: 9.8, colliders: ['torso', 'hips', 'thighL', 'thighR', 'shinL', 'shinR', 'scab'], radius: 0.02, cross: true },
  tabF: { stiff: [1, 0.07, 0.045, 0.035], damping: 0.97, gravity: 9.8, colliders: ['thighL', 'thighR', 'shinL', 'shinR'], radius: 0.032, cross: true },
  tabB: { stiff: [1, 0.07, 0.045, 0.035], damping: 0.97, gravity: 9.8, colliders: ['thighL', 'thighR', 'shinL', 'shinR'], radius: 0.032, cross: true },
  plume: { stiff: [1, 0.3, 0.16, 0.1], damping: 0.95, gravity: 4, colliders: ['head'], radius: 0.01, cross: false },
  scab: { stiff: [1, 0.035], damping: 0.955, gravity: 9.8, colliders: ['thighL', 'shinL'], radius: 0.03, cross: false },
};

interface Capsule {
  name: string;
  a: THREE.Vector3;
  b: THREE.Vector3;
  r: number;
}

class Chain {
  readonly anchor: THREE.Bone;
  readonly cols: number;
  readonly rows: number; // Punkte je Spalte
  readonly restLocal: THREE.Vector3[]; // relativ zum Anker (Ruhelage)
  readonly pos: THREE.Vector3[];
  readonly prev: THREE.Vector3[];
  readonly target: THREE.Vector3[];
  readonly segLen: number[];
  readonly crossLen: number[];
  readonly bones: THREE.Bone[][];
  readonly restDir: THREE.Vector3[][];
  readonly colliders: Capsule[] = [];

  constructor(
    readonly def: ChainDef,
    readonly p: ChainParams,
    rig: Rig,
  ) {
    this.anchor = rig.bones[def.anchor]!;
    const anchorRest = restPos(def.anchor);
    this.cols = def.columns.length;
    this.rows = def.columns[0]!.length;
    this.restLocal = [];
    this.bones = [];
    this.restDir = [];
    def.columns.forEach((col, ci) => {
      const bl: THREE.Bone[] = [];
      const dl: THREE.Vector3[] = [];
      col.forEach((q, ri) => {
        this.restLocal.push(new THREE.Vector3(q[0], q[1], q[2]).sub(anchorRest));
        if (ri < col.length - 1) {
          bl.push(rig.bones[chainBoneName(def.name, ci, ri)]!);
          const n = col[ri + 1]!;
          dl.push(new THREE.Vector3(n[0] - q[0], n[1] - q[1], n[2] - q[2]).normalize());
        }
      });
      this.bones.push(bl);
      this.restDir.push(dl);
    });
    const n = this.restLocal.length;
    this.pos = Array.from({ length: n }, () => new THREE.Vector3());
    this.prev = Array.from({ length: n }, () => new THREE.Vector3());
    this.target = Array.from({ length: n }, () => new THREE.Vector3());
    this.segLen = [];
    this.crossLen = [];
    for (let c = 0; c < this.cols; c++) {
      for (let r = 0; r < this.rows; r++) {
        const i = c * this.rows + r;
        this.segLen.push(r > 0 ? this.restLocal[i]!.distanceTo(this.restLocal[i - 1]!) : 0);
        this.crossLen.push(c > 0 ? this.restLocal[i]!.distanceTo(this.restLocal[i - this.rows]!) : 0);
      }
    }
  }

  computeTargets(): void {
    const m = this.anchor.matrixWorld;
    for (let i = 0; i < this.restLocal.length; i++) this.target[i]!.copy(this.restLocal[i]!).applyMatrix4(m);
  }

  reset(): void {
    this.computeTargets();
    for (let i = 0; i < this.pos.length; i++) {
      this.pos[i]!.copy(this.target[i]!);
      this.prev[i]!.copy(this.target[i]!);
    }
  }
}

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qp = new THREE.Quaternion();
const _qi = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _t = new THREE.Vector3();
const _d = new THREE.Vector3();
const _wind = new THREE.Vector3();

const STEP = 1 / 90;

export class SecondarySim {
  private readonly chains: Chain[];
  private readonly capsules = new Map<string, Capsule>();
  private acc = 0;
  private time = Math.random() * 100;
  private initialized = false;
  private readonly lastAnchor = new THREE.Vector3();
  private readonly scabBone: THREE.Bone;

  constructor(private readonly rig: Rig) {
    this.scabBone = rig.bones['scab_0_0']!;
    this.chains = CHAINS.map((d) => new Chain(d, PARAMS[d.name]!, rig));
    for (const name of ['torso', 'hips', 'head', 'thighL', 'thighR', 'shinL', 'shinR', 'scab']) {
      this.capsules.set(name, { name, a: new THREE.Vector3(), b: new THREE.Vector3(), r: 0.1 });
    }
    for (const ch of this.chains) {
      for (const n of ch.p.colliders) ch.colliders.push(this.capsules.get(n)!);
    }
  }

  private setCapsule(name: string, a: THREE.Object3D, b: THREE.Object3D, r: number, ao?: THREE.Vector3, bo?: THREE.Vector3): void {
    const c = this.capsules.get(name)!;
    if (ao) c.a.copy(ao).applyMatrix4(a.matrixWorld);
    else c.a.setFromMatrixPosition(a.matrixWorld);
    if (bo) c.b.copy(bo).applyMatrix4(b.matrixWorld);
    else c.b.setFromMatrixPosition(b.matrixWorld);
    c.r = r;
  }

  private updateCapsules(): void {
    const B = this.rig.bones;
    this.setCapsule('torso', B.spine!, B.chest!, 0.155, _TORSO_A, _TORSO_B);
    this.setCapsule('hips', B.hips!, B.hips!, 0.185, _HIPS_A, _HIPS_B);
    this.setCapsule('head', B.head!, B.head!, 0.125, _HEAD_A, _HEAD_A);
    this.setCapsule('thighL', B.thighL!, B.shinL!, 0.115);
    this.setCapsule('thighR', B.thighR!, B.shinR!, 0.115);
    this.setCapsule('shinL', B.shinL!, B.footL!, 0.082);
    this.setCapsule('shinR', B.shinR!, B.footR!, 0.082);
    this.setCapsule('scab', this.scabBone, this.scabBone, 0.03, _ZERO, _SCAB_TIP);
  }

  /** Nach dem Setzen der Skelett-Pose aufrufen (Weltmatrizen muessen aktuell sein). */
  update(dt: number, root: THREE.Object3D): void {
    this.updateCapsules();
    _v.setFromMatrixPosition(root.matrixWorld);
    const jump = _v.distanceTo(this.lastAnchor);
    if (!this.initialized || jump > 1.5) {
      for (const ch of this.chains) ch.reset();
      this.initialized = true;
      this.acc = 0;
    } else if (jump > 0.12) {
      // Ruckler (z. B. sehr lange Bildzeit): Tuch mitnehmen statt wegschleudern
      _w.subVectors(_v, this.lastAnchor);
      for (const ch of this.chains) {
        for (let i = 0; i < ch.pos.length; i++) {
          ch.pos[i]!.add(_w);
          ch.prev[i]!.add(_w);
        }
      }
    }
    this.lastAnchor.copy(_v);
    this.time += dt;
    this.acc = Math.min(this.acc + dt, STEP * 10);
    for (const ch of this.chains) ch.computeTargets();
    // leichter Wind (in Weltrichtung, langsam wechselnd)
    _wind.set(Math.sin(this.time * 0.37) * 0.35 + Math.sin(this.time * 1.7) * 0.15, 0, Math.cos(this.time * 0.29) * 0.3 + 0.25);
    while (this.acc >= STEP) {
      this.acc -= STEP;
      for (const ch of this.chains) this.step(ch);
    }
    for (const ch of this.chains) this.apply(ch);
  }

  private step(ch: Chain): void {
    const p = ch.p;
    const h2 = STEP * STEP;
    const windK = ch.def.name === 'cape' ? 1 : ch.def.name.startsWith('tab') ? 0.5 : 0.2;
    for (let c = 0; c < ch.cols; c++) {
      for (let r = 0; r < ch.rows; r++) {
        const i = c * ch.rows + r;
        const pos = ch.pos[i]!;
        if (r === 0) {
          ch.prev[i]!.copy(pos);
          pos.copy(ch.target[i]!);
          continue;
        }
        _v.subVectors(pos, ch.prev[i]!).multiplyScalar(p.damping);
        ch.prev[i]!.copy(pos);
        pos.add(_v);
        pos.y -= p.gravity * h2;
        pos.addScaledVector(_wind, h2 * windK * (r / (ch.rows - 1)));
        const k = p.stiff[Math.min(r, p.stiff.length - 1)]!;
        pos.x += (ch.target[i]!.x - pos.x) * k;
        pos.y += (ch.target[i]!.y - pos.y) * k;
        pos.z += (ch.target[i]!.z - pos.z) * k;
      }
    }
    for (let it = 0; it < 3; it++) {
      for (let c = 0; c < ch.cols; c++) {
        for (let r = 1; r < ch.rows; r++) {
          const i = c * ch.rows + r;
          this.distance(ch.pos[i - 1]!, ch.pos[i]!, ch.segLen[i]!, r === 1 ? 0 : 0.5, 1, 1);
        }
        if (p.cross && c > 0) {
          for (let r = 1; r < ch.rows; r++) {
            const i = c * ch.rows + r;
            this.distance(ch.pos[i - ch.rows]!, ch.pos[i]!, ch.crossLen[i]!, 0.5, 0.75, 1.05);
          }
        }
      }
    }
    for (let c = 0; c < ch.cols; c++) {
      for (let r = 1; r < ch.rows; r++) {
        const pos = ch.pos[c * ch.rows + r]!;
        for (const cap of ch.colliders) this.collide(pos, cap, p.radius);
      }
    }
  }

  /** Abstand zwischen a und b auf [min*len, max*len] bringen. wa = Anteil fuer a. */
  private distance(a: THREE.Vector3, b: THREE.Vector3, len: number, wa: number, min: number, max: number): void {
    _d.subVectors(b, a);
    const d = _d.length();
    if (d < 1e-6) return;
    let target = d;
    if (d > len * max) target = len * max;
    else if (d < len * min) target = len * min;
    else return;
    const diff = (d - target) / d;
    a.addScaledVector(_d, diff * wa);
    b.addScaledVector(_d, -diff * (1 - wa));
  }

  private collide(p: THREE.Vector3, cap: Capsule, extra: number): void {
    _s.subVectors(cap.b, cap.a);
    const l2 = _s.lengthSq();
    let t = 0;
    if (l2 > 1e-8) t = Math.max(0, Math.min(1, _t.subVectors(p, cap.a).dot(_s) / l2));
    _t.copy(cap.a).addScaledVector(_s, t);
    _d.subVectors(p, _t);
    const d = _d.length();
    const r = cap.r + extra;
    if (d < r && d > 1e-6) p.addScaledVector(_d, (r - d) / d);
  }

  private apply(ch: Chain): void {
    this.anchor(ch, _qp);
    for (let c = 0; c < ch.cols; c++) {
      _q.copy(_qp);
      for (let s = 0; s < ch.rows - 1; s++) {
        const i = c * ch.rows + s;
        _d.subVectors(ch.pos[i + 1]!, ch.pos[i]!);
        if (_d.lengthSq() < 1e-10) continue;
        _d.normalize();
        _qi.copy(_q).invert();
        _d.applyQuaternion(_qi);
        const bone = ch.bones[c]![s]!;
        bone.quaternion.setFromUnitVectors(ch.restDir[c]![s]!, _d);
        _q.multiply(bone.quaternion);
      }
    }
  }

  private anchor(ch: Chain, out: THREE.Quaternion): void {
    ch.anchor.matrixWorld.decompose(_w, out, _s);
  }
}

const _ZERO = new THREE.Vector3();
const _TORSO_A = new THREE.Vector3(0, 0.02, -0.03);
const _TORSO_B = new THREE.Vector3(0, 0.12, -0.05);
const _HIPS_A = new THREE.Vector3(-0.03, -0.05, 0.015);
const _HIPS_B = new THREE.Vector3(0.03, -0.05, 0.015);
const _HEAD_A = new THREE.Vector3(0, 0.13, 0.0);
const _SCAB_TIP = (() => {
  const d = CHAINS.find((c) => c.name === 'scab')!.columns[0]!;
  return new THREE.Vector3(d[1]![0] - d[0]![0], d[1]![1] - d[0]![1], d[1]![2] - d[0]![2]);
})();
