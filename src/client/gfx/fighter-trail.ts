import * as THREE from 'three';

// Klingenspur: Ringpuffer der Klingenpunkte (Weltraum) -> Band aus Dreiecken, additiv und
// halbtransparent, blendet nach LIFE Sekunden aus. Alle Puffer werden einmal angelegt,
// pro Bild werden nur Zahlen ueberschrieben. Zwischen zwei Bildern wird der Bogen um den
// Griff herum aufgefuellt (Klingenrichtung wird gedreht, nicht nur linear verschoben),
// damit die Spur auch bei wenigen Bildern pro Sekunde rund bleibt.

const MAX = 40; // Stuetzpunkte
const LIFE = 0.25; // Sekunden
const MAX_SUB = 4; // Zwischenpunkte pro Bild

let sharedMat: THREE.MeshBasicMaterial | null = null;
function material(): THREE.MeshBasicMaterial {
  if (!sharedMat) {
    sharedMat = new THREE.MeshBasicMaterial({
      name: 'fighter-trail',
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      fog: true,
      toneMapped: false,
    });
  }
  return sharedMat;
}

const _d0 = new THREE.Vector3();
const _d1 = new THREE.Vector3();
const _h = new THREE.Vector3();
const _b = new THREE.Vector3();
const _t = new THREE.Vector3();

export class SwordTrail {
  readonly mesh: THREE.Mesh;
  private readonly geo: THREE.BufferGeometry;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly base: THREE.Vector3[] = [];
  private readonly tip: THREE.Vector3[] = [];
  private readonly age = new Float32Array(MAX);
  private readonly str = new Float32Array(MAX);
  private head = -1; // Index des neuesten Punkts
  private count = 0;
  private hasLast = false;
  private readonly lastBase = new THREE.Vector3();
  private readonly lastTip = new THREE.Vector3();
  private lastStr = 0;
  private readonly color = new THREE.Color(0.95, 0.96, 1.0);

  constructor(tint?: THREE.ColorRepresentation) {
    for (let i = 0; i < MAX; i++) {
      this.base.push(new THREE.Vector3());
      this.tip.push(new THREE.Vector3());
    }
    if (tint !== undefined) this.color.lerp(new THREE.Color(tint), 0.18);
    this.pos = new Float32Array(MAX * 2 * 3);
    this.col = new Float32Array(MAX * 2 * 4);
    const idx: number[] = [];
    for (let i = 0; i < MAX - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    this.geo.setIndex(idx);
    this.geo.setDrawRange(0, 0);
    this.mesh = new THREE.Mesh(this.geo, material());
    this.mesh.name = 'swordTrail';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    this.mesh.visible = false;
  }

  /** Alles loeschen (z. B. nach einem Sprung der Figur). */
  clear(): void {
    this.count = 0;
    this.head = -1;
    this.hasLast = false;
    this.geo.setDrawRange(0, 0);
    this.mesh.visible = false;
  }

  private push(b: THREE.Vector3, t: THREE.Vector3, s: number, age: number): void {
    this.head = (this.head + 1) % MAX;
    this.base[this.head]!.copy(b);
    this.tip[this.head]!.copy(t);
    this.age[this.head] = age;
    this.str[this.head] = s;
    if (this.count < MAX) this.count++;
  }

  /**
   * Ein Bild: Punkte altern lassen, bei strength > 0 neue Klingenposition anhaengen
   * (Weltkoordinaten von Klingenmitte und Spitze), dann das Band neu fuellen.
   */
  update(dt: number, base: THREE.Vector3, tip: THREE.Vector3, strength: number): void {
    for (let k = 0, i = this.head; k < this.count; k++, i = (i - 1 + MAX) % MAX) this.age[i]! += dt;
    // abgelaufene Punkte am Ende abschneiden
    while (this.count > 0) {
      const oldest = (this.head - this.count + 1 + MAX) % MAX;
      if (this.age[oldest]! < LIFE) break;
      this.count--;
    }

    if (strength > 0.01) {
      if (this.hasLast && this.lastStr > 0.01) {
        // Bogen auffuellen: Griffpunkt linear, Klingenrichtung gedreht
        const moved = tip.distanceTo(this.lastTip);
        const n = Math.min(MAX_SUB, Math.floor(moved / 0.06));
        if (n > 0) {
          _d0.subVectors(this.lastTip, this.lastBase);
          _d1.subVectors(tip, base);
          const len = (_d0.length() + _d1.length()) / 2;
          _d0.normalize();
          _d1.normalize();
          for (let j = 1; j <= n; j++) {
            const f = j / (n + 1);
            _h.lerpVectors(this.lastBase, base, f);
            _b.lerpVectors(_d0, _d1, f);
            if (_b.lengthSq() < 1e-6) _b.copy(_d1);
            _b.normalize();
            _t.copy(_h).addScaledVector(_b, len);
            const s = this.lastStr + (strength - this.lastStr) * f;
            this.push(_h, _t, s, dt * (1 - f));
          }
        }
      }
      this.push(base, tip, strength, 0);
      this.hasLast = true;
      this.lastBase.copy(base);
      this.lastTip.copy(tip);
    } else {
      this.hasLast = false;
    }
    this.lastStr = strength;

    // Band fuellen: neuester Punkt zuerst
    const n = this.count;
    if (n < 2) {
      this.geo.setDrawRange(0, 0);
      this.mesh.visible = false;
      return;
    }
    const P = this.pos;
    const C = this.col;
    const c = this.color;
    for (let k = 0, i = this.head; k < n; k++, i = (i - 1 + MAX) % MAX) {
      const b = this.base[i]!;
      const t = this.tip[i]!;
      const life = 1 - this.age[i]! / LIFE;
      const a = Math.max(0, life) * Math.max(0, life) * this.str[i]!;
      // Schwanz ausduennen
      const tail = Math.min(1, (n - 1 - k) / 3);
      const o = k * 6;
      P[o] = b.x;
      P[o + 1] = b.y;
      P[o + 2] = b.z;
      P[o + 3] = t.x;
      P[o + 4] = t.y;
      P[o + 5] = t.z;
      const q = k * 8;
      // innen (Klingenmitte) schwach, aussen (Spitze) hell
      C[q] = c.r;
      C[q + 1] = c.g;
      C[q + 2] = c.b;
      C[q + 3] = a * 0.08 * tail;
      C[q + 4] = c.r;
      C[q + 5] = c.g;
      C[q + 6] = c.b;
      C[q + 7] = a * 0.62 * tail;
    }
    (this.geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    this.geo.setDrawRange(0, (n - 1) * 6);
    this.mesh.visible = true;
  }

  dispose(): void {
    this.geo.dispose();
  }
}
