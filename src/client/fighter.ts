import * as THREE from 'three';

// Selbst gebaute Low-Poly-Figur. Blickt in Richtung -Z (so passt rotation.y = yaw).
// Aufbau ist bewusst in Gruppen geteilt, damit spaeter Waffen, Ruestung und
// Angriffs-Animationen einfach angehaengt werden koennen.

const SKIN = 0xd2a37c;
const STEEL = 0xaab1ba;
const LEATHER = 0x4a3524;
const CLOTH_DARK = 0x33302c;

const matCache = new Map<string, THREE.MeshStandardMaterial>();
function mat(color: number, opts: { metal?: boolean; rough?: number; double?: boolean } = {}): THREE.MeshStandardMaterial {
  const key = `${color}-${opts.metal ? 1 : 0}-${opts.rough ?? ''}-${opts.double ? 1 : 0}`;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color,
      flatShading: true,
      roughness: opts.rough ?? (opts.metal ? 0.42 : 0.85),
      metalness: opts.metal ? 0.65 : 0.05,
      side: opts.double ? THREE.DoubleSide : THREE.FrontSide,
    });
    matCache.set(key, m);
  }
  return m;
}

function mesh(geo: THREE.BufferGeometry, material: THREE.Material, y = 0, x = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function angleLerp(a: number, b: number, t: number): number {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + d * t;
}

interface Leg {
  hip: THREE.Group;
  knee: THREE.Group;
}

export class Fighter {
  readonly root = new THREE.Group();
  private readonly body = new THREE.Group(); // alles ueber den Fuessen (Neigung beim Rennen)
  private readonly upper = new THREE.Group(); // Oberkoerper (Atmen, Wippen)
  private readonly legL: Leg;
  private readonly legR: Leg;
  private readonly armR = { shoulder: new THREE.Group(), elbow: new THREE.Group() };
  private readonly armL = { shoulder: new THREE.Group(), elbow: new THREE.Group() };
  private readonly cape = new THREE.Group();

  private phase = Math.random() * Math.PI * 2;
  private amp = 0; // Schrittstaerke 0..1
  private nz = 0; // vorwaerts (+) / rueckwaerts (-)
  private nx = 0; // rechts (+) / links (-)
  private lean = 0;
  private breath = Math.random() * 10;

  constructor(accent: number) {
    const accentMat = mat(accent);
    const accentDark = mat(new THREE.Color(accent).multiplyScalar(0.6).getHex(), { double: true });

    this.root.add(this.body);

    // ---- Beine ----
    this.legL = this.buildLeg(-1);
    this.legR = this.buildLeg(1);

    // ---- Becken ----
    this.body.add(mesh(new THREE.BoxGeometry(0.4, 0.2, 0.25), mat(LEATHER), 0.94));

    // ---- Oberkoerper ----
    this.upper.position.y = 0.92;
    this.body.add(this.upper);

    const torso = mesh(new THREE.CylinderGeometry(0.27, 0.21, 0.58, 6), accentMat, 0.3);
    torso.scale.z = 0.72;
    this.upper.add(torso);
    const belt = mesh(new THREE.CylinderGeometry(0.225, 0.225, 0.08, 6), mat(LEATHER), 0.03);
    belt.scale.z = 0.76;
    this.upper.add(belt);
    // Brustplatte (Platzhalter fuer spaetere Ruestungsstufen)
    const chest = mesh(new THREE.CylinderGeometry(0.235, 0.22, 0.34, 6, 1, false, 0, Math.PI), mat(STEEL, { metal: true }), 0.36, 0, -0.02);
    chest.rotation.y = Math.PI / 2; // Halbschale nach vorne (-Z)
    chest.scale.z = 0.8;
    this.upper.add(chest);

    // Kopf mit offenem Helm
    const head = mesh(new THREE.IcosahedronGeometry(0.135, 0), mat(SKIN), 0.75);
    this.upper.add(head);
    const helmet = mesh(
      new THREE.SphereGeometry(0.165, 7, 5, 0, Math.PI * 2, 0, Math.PI * 0.56),
      mat(STEEL, { metal: true }),
      0.77,
    );
    this.upper.add(helmet);
    this.upper.add(mesh(new THREE.BoxGeometry(0.03, 0.11, 0.02), mat(STEEL, { metal: true }), 0.73, 0, -0.155));
    // Helmbusch in der Teamfarbe
    const crest = mesh(new THREE.BoxGeometry(0.03, 0.09, 0.26), accentMat, 0.94);
    this.upper.add(crest);

    // Schulterpanzer
    for (const s of [-1, 1]) {
      this.upper.add(mesh(new THREE.IcosahedronGeometry(0.115, 0), mat(STEEL, { metal: true }), 0.54, s * 0.34));
    }

    // ---- Arme ----
    this.buildArm(this.armR, 1, accentMat);
    this.buildArm(this.armL, -1, accentMat);

    // Schwert in der rechten Hand
    const sword = new THREE.Group();
    sword.add(mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.16, 5), mat(LEATHER), 0)); // Griff
    sword.add(mesh(new THREE.BoxGeometry(0.3, 0.035, 0.05), mat(0xb08a3a, { metal: true }), -0.09)); // Parierstange
    sword.add(mesh(new THREE.BoxGeometry(0.06, 0.95, 0.018), mat(0xd5dae0, { metal: true, rough: 0.3 }), -0.58)); // Klinge
    const tip = mesh(new THREE.ConeGeometry(0.043, 0.12, 4), mat(0xd5dae0, { metal: true, rough: 0.3 }), -1.11);
    tip.rotation.x = Math.PI;
    tip.scale.z = 0.4;
    sword.add(tip);
    sword.position.y = -0.31;
    sword.rotation.x = 0.4; // Klinge schraeg nach oben Richtung Gegner
    this.armR.elbow.add(sword);

    // ---- Umhang ----
    this.cape.position.set(0, 0.56, 0.15);
    const capeMesh = mesh(new THREE.BoxGeometry(0.5, 0.95, 0.03), accentDark, -0.45);
    this.cape.add(capeMesh);
    this.upper.add(this.cape);

    // Kampfhaltung
    this.armR.shoulder.rotation.set(0.85, 0, -0.1);
    this.armR.elbow.rotation.set(1.05, 0, 0);
    this.armL.shoulder.rotation.set(0.55, 0, 0.25);
    this.armL.elbow.rotation.set(1.35, 0, 0);
  }

  private buildLeg(side: number): Leg {
    const hip = new THREE.Group();
    hip.position.set(side * 0.14, 0.92, 0);
    hip.add(mesh(new THREE.CylinderGeometry(0.11, 0.085, 0.48, 6), mat(CLOTH_DARK), -0.23));
    const knee = new THREE.Group();
    knee.position.y = -0.46;
    knee.add(mesh(new THREE.CylinderGeometry(0.085, 0.07, 0.4, 6), mat(CLOTH_DARK), -0.2));
    knee.add(mesh(new THREE.BoxGeometry(0.15, 0.14, 0.3), mat(LEATHER), -0.4, 0, -0.05)); // Stiefel
    hip.add(knee);
    this.body.add(hip);
    return { hip, knee };
  }

  private buildArm(arm: { shoulder: THREE.Group; elbow: THREE.Group }, side: number, sleeve: THREE.MeshStandardMaterial): void {
    arm.shoulder.position.set(side * 0.34, 0.55, 0);
    arm.shoulder.add(mesh(new THREE.CylinderGeometry(0.07, 0.06, 0.32, 6), sleeve, -0.16));
    arm.elbow.position.y = -0.32;
    arm.elbow.add(mesh(new THREE.CylinderGeometry(0.06, 0.05, 0.28, 6), mat(STEEL, { metal: true }), -0.14)); // Armschiene
    arm.elbow.add(mesh(new THREE.BoxGeometry(0.085, 0.09, 0.09), mat(LEATHER), -0.3)); // Handschuh
    arm.shoulder.add(arm.elbow);
    this.upper.add(arm.shoulder);
  }

  setPosition(x: number, z: number, yaw: number): void {
    this.root.position.set(x, 0, z);
    this.root.rotation.y = yaw;
  }

  /** vx/vz: Geschwindigkeit in der Welt (Meter pro Sekunde). */
  animate(dt: number, vx: number, vz: number, yaw: number, sprinting: boolean): void {
    const speed = Math.hypot(vx, vz);
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    const rx = Math.cos(yaw);
    const rz = -Math.sin(yaw);

    const targetAmp = Math.min(1, speed / 2.4) * (sprinting ? 1.25 : 1);
    const k = 1 - Math.exp(-dt * 12);
    this.amp += (targetAmp - this.amp) * k;
    if (speed > 0.05) {
      this.nz += ((vx * fx + vz * fz) / speed - this.nz) * k;
      this.nx += ((vx * rx + vz * rz) / speed - this.nx) * k;
    }
    this.lean += ((sprinting ? 1 : 0) - this.lean) * k;

    this.phase += dt * speed * (sprinting ? 2.4 : 3.1);
    this.breath += dt * 1.6;

    const swing = 0.62 * this.amp;
    for (const [leg, off] of [
      [this.legL, 0],
      [this.legR, Math.PI],
    ] as const) {
      const p = this.phase + off;
      leg.hip.rotation.x = Math.sin(p) * swing * this.nz;
      leg.hip.rotation.z = Math.sin(p) * swing * 0.55 * this.nx;
      leg.knee.rotation.x = -Math.max(0, Math.cos(p)) * swing * 1.25;
    }

    // Oberkoerper: Atmen + Wippen
    const bob = Math.abs(Math.sin(this.phase)) * 0.03 * this.amp;
    this.upper.position.y = 0.92 + bob + Math.sin(this.breath) * 0.006;
    this.upper.rotation.y = Math.sin(this.phase) * 0.06 * this.amp * this.nz;
    this.body.rotation.x = -0.16 * this.lean;

    // Arme wippen leicht mit
    this.armL.shoulder.rotation.x = 0.55 + Math.sin(this.breath * 1.3) * 0.03 - Math.sin(this.phase) * 0.12 * this.amp;
    this.armR.shoulder.rotation.x = 0.85 + Math.sin(this.breath * 1.1 + 1) * 0.03 + Math.sin(this.phase) * 0.06 * this.amp;

    // Umhang weht nach hinten, staerker bei Tempo
    const capeTarget = -(0.08 + Math.min(1, speed / 4) * 0.55 * Math.max(0, this.nz));
    this.cape.rotation.x += (capeTarget - this.cape.rotation.x) * k;
    this.cape.rotation.x += Math.sin(this.breath * 2.2) * 0.002;
  }

  dispose(): void {
    this.root.removeFromParent();
  }
}

export { angleLerp };
