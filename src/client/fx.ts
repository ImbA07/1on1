import * as THREE from 'three';

// Trefferfeedback: Funken (Block/Parade) und Blut (Treffer). Alles aus festen Puffern,
// ohne Speicheranforderungen pro Bild. Blut, das den Boden erreicht, bleibt als Fleck
// bis zum Rundenende liegen.

const SPARKS = 320;
const BLOOD = 520;
const MAX_DECALS = 220;

let dotTexture: THREE.CanvasTexture | null = null;
function dot(): THREE.CanvasTexture {
  if (dotTexture) return dotTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(16, 16, 1, 16, 16, 15);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.55, 'rgba(255,255,255,0.9)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  dotTexture = new THREE.CanvasTexture(c);
  return dotTexture;
}

/** Ein Puffer aus gleichartigen Partikeln. */
class Pool {
  readonly points: THREE.Points;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly vel: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly base: Float32Array; // Grundfarbe
  private next = 0;

  constructor(
    private readonly count: number,
    size: number,
    additive: boolean,
    private readonly gravity: number,
    private readonly drag: number,
  ) {
    this.pos = new Float32Array(count * 3);
    this.col = new Float32Array(count * 3);
    this.vel = new Float32Array(count * 3);
    this.life = new Float32Array(count);
    this.maxLife = new Float32Array(count).fill(1);
    this.base = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) this.pos[i * 3 + 1] = -1000;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    const mat = new THREE.PointsMaterial({
      size,
      map: dot(),
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      sizeAttenuation: true,
      alphaTest: additive ? 0 : 0.35,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
  }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, r: number, g: number, b: number): void {
    const i = this.next;
    this.next = (this.next + 1) % this.count;
    const k = i * 3;
    this.pos[k] = x;
    this.pos[k + 1] = y;
    this.pos[k + 2] = z;
    this.vel[k] = vx;
    this.vel[k + 1] = vy;
    this.vel[k + 2] = vz;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.base[k] = r;
    this.base[k + 1] = g;
    this.base[k + 2] = b;
  }

  /** Gibt zurueck, wo Partikel den Boden beruehrt haben (fuer Blutflecken) ueber den Rueckruf. */
  update(dt: number, onGround?: (x: number, z: number) => void): void {
    const drag = Math.exp(-this.drag * dt);
    for (let i = 0; i < this.count; i++) {
      if (this.life[i] <= 0) continue;
      const k = i * 3;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.pos[k + 1] = -1000;
        continue;
      }
      this.vel[k + 1] -= this.gravity * dt;
      this.vel[k] *= drag;
      this.vel[k + 2] *= drag;
      this.pos[k] += this.vel[k]! * dt;
      this.pos[k + 1] += this.vel[k + 1]! * dt;
      this.pos[k + 2] += this.vel[k + 2]! * dt;
      if (this.pos[k + 1]! <= 0.03) {
        if (onGround) onGround(this.pos[k]!, this.pos[k + 2]!);
        this.life[i] = 0;
        this.pos[k + 1] = -1000;
        continue;
      }
      const f = Math.min(1, (this.life[i]! / this.maxLife[i]!) * 1.6);
      this.col[k] = this.base[k]! * f;
      this.col[k + 1] = this.base[k + 1]! * f;
      this.col[k + 2] = this.base[k + 2]! * f;
    }
    (this.points.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.points.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  }

  clear(): void {
    this.life.fill(0);
    for (let i = 0; i < this.count; i++) this.pos[i * 3 + 1] = -1000;
    (this.points.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}

export class Effects {
  readonly group = new THREE.Group();
  private readonly sparks = new Pool(SPARKS, 0.075, true, 7, 1.2);
  private readonly blood = new Pool(BLOOD, 0.06, false, 9, 0.6);
  private readonly decals: THREE.InstancedMesh;
  private decalCount = 0;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();

  constructor() {
    this.group.add(this.sparks.points, this.blood.points);
    const plane = new THREE.PlaneGeometry(1, 1);
    plane.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x4f0808,
      map: dot(),
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.decals = new THREE.InstancedMesh(plane, mat, MAX_DECALS);
    this.decals.count = 0;
    this.decals.frustumCulled = false;
    this.group.add(this.decals);
  }

  /** Funkenregen. (dirX, dirZ) = Richtung, in die die meisten Funken fliegen (normiert). */
  spark(x: number, y: number, z: number, dirX: number, dirZ: number, count: number, power = 1): void {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const spread = 0.6 + Math.random() * 1.6;
      const speed = (2.2 + Math.random() * 4.5) * power;
      const vx = (dirX * 0.9 + Math.cos(a) * spread * 0.55) * speed * 0.5;
      const vz = (dirZ * 0.9 + Math.sin(a) * spread * 0.55) * speed * 0.5;
      const vy = (Math.random() * 1.6 - 0.2) * speed * 0.45 + 0.6;
      const hot = Math.random();
      this.sparks.emit(x, y, z, vx, vy, vz, 0.22 + Math.random() * 0.4, 1.0, 0.55 + hot * 0.4, 0.15 + hot * 0.25);
    }
  }

  /** Blutspritzer. (dirX, dirZ) = Stossrichtung (vom Angreifer weg). */
  bleed(x: number, y: number, z: number, dirX: number, dirZ: number, count: number, power = 1): void {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const speed = (1.2 + Math.random() * 3.6) * power;
      const vx = dirX * speed * (0.5 + Math.random() * 0.8) + Math.cos(a) * speed * 0.35;
      const vz = dirZ * speed * (0.5 + Math.random() * 0.8) + Math.sin(a) * speed * 0.35;
      const vy = 0.8 + Math.random() * 2.8 * power;
      const d = 0.55 + Math.random() * 0.45;
      this.blood.emit(x, y, z, vx, vy, vz, 0.7 + Math.random() * 0.7, 0.45 * d, 0.02 * d, 0.02 * d);
    }
  }

  private stain(x: number, z: number): void {
    if (this.decalCount >= MAX_DECALS) return;
    const size = 0.07 + Math.random() * 0.2;
    this.e.set(0, Math.random() * Math.PI, 0);
    this.q.setFromEuler(this.e);
    this.p.set(x, 0.024, z);
    this.s.set(size, 1, size * (0.7 + Math.random() * 0.6));
    this.m.compose(this.p, this.q, this.s);
    this.decals.setMatrixAt(this.decalCount++, this.m);
    this.decals.count = this.decalCount;
    this.decals.instanceMatrix.needsUpdate = true;
  }

  update(dt: number): void {
    this.sparks.update(dt);
    this.blood.update(dt, (x, z) => this.stain(x, z));
  }

  /** Blutflecken und Partikel entfernen (neue Runde). */
  clear(): void {
    this.sparks.clear();
    this.blood.clear();
    this.decalCount = 0;
    this.decals.count = 0;
    this.decals.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.group.removeFromParent();
    this.sparks.dispose();
    this.blood.dispose();
    this.decals.geometry.dispose();
    (this.decals.material as THREE.Material).dispose();
  }
}
