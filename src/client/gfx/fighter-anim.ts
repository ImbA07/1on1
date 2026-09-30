import * as THREE from 'three';
import { DIGITS, digitBoneName, gripPose, HandRig, LOOSE_FIST, RELAXED, type HandPose } from './fighter-hand.js';
import { ANKLE_H, SHIN_LEN, THIGH_LEN, type Rig } from './fighter-rig.js';

// Prozedurale Animation: Kampfhaltung, Gehen/Rennen in alle Richtungen mit
// Fuss-IK (Ferse-Zeh-Abrollen), Gewichtsverlagerung, Atmen, Traegheit (Federn),
// Oberkoerper eilt beim Drehen voraus, Beine ziehen mit Trippelschritten nach.
// Keine Speicheranforderungen pro Bild.

const TAU = Math.PI * 2;

function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
function smooth01(t: number): number {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}
function approach(cur: number, target: number, rate: number, dt: number): number {
  return cur + (target - cur) * (1 - Math.exp(-rate * dt));
}
function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/** Gedaempfte Feder (fuer Nachwippen). */
class Spring {
  x = 0;
  v = 0;
  constructor(
    private k: number,
    private zeta: number,
  ) {}
  reset(value: number): void {
    this.x = value;
    this.v = 0;
  }
  update(target: number, dt: number): number {
    const c = 2 * Math.sqrt(this.k) * this.zeta;
    // halbimplizit, stabil bei grossen Schritten
    const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      const a = this.k * (target - this.x) - c * this.v;
      this.v += a * h;
      this.x += this.v * h;
    }
    return this.x;
  }
}

interface ArmPose {
  sx: number; // Schluessel-/Schulterbein Heben
  ux: number; // Oberarm vor
  uz: number; // Oberarm abspreizen
  uy: number; // Oberarm eindrehen
  fx: number; // Ellbogen beugen
  fy: number; // Unterarm drehen
  hx: number; // Handgelenk
  hz: number;
}

function arm(p: Partial<ArmPose>): ArmPose {
  return { sx: 0, ux: 0, uz: 0, uy: 0, fx: 0, fy: 0, hx: 0, hz: 0, ...p };
}

// Posen (rechte Seite = Schwertarm). Linke Werte sind fuer den linken Arm (Vorzeichen schon gespiegelt).
const GUARD_R = arm({ ux: 0.42, uz: 0.18, uy: 0.5, fx: 1.12, fy: -0.25, hx: -0.57, hz: 0.1 });
const GUARD_L = arm({ ux: 0.32, uz: -0.2, uy: -0.45, fx: 1.25, fy: 0.75, hx: 0.3, hz: -0.15 });
const RUN_R = arm({ ux: 0.05, uz: 0.16, uy: 0.25, fx: 1.35, fy: -0.2, hx: -0.7, hz: 0.1 });
const RUN_L = arm({ ux: -0.05, uz: -0.14, uy: -0.2, fx: 1.45, fy: 0.2 });

const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _q3 = new THREE.Quaternion();
const _qh = new THREE.Quaternion();
const _qt = new THREE.Quaternion();
const _qs = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _e = new THREE.Euler();
const _hip = new THREE.Vector3();
const _ank = new THREE.Vector3();
const _knee = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _bx = new THREE.Vector3();
const _by = new THREE.Vector3();
const _bz = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _g = new THREE.Vector3();

interface ArmBones {
  shoulder: THREE.Bone;
  upper: THREE.Bone;
  fore: THREE.Bone;
  hand: THREE.Bone;
  phase: number;
}

interface LegBones {
  thigh: THREE.Bone;
  shin: THREE.Bone;
  foot: THREE.Bone;
  toe: THREE.Bone;
  thighRest: THREE.Vector3;
  out: number; // +1 rechts, -1 links
}

interface FootState {
  x: number;
  z: number;
  lift: number;
  pitch: number;
  yaw: number;
  toe: number;
}

export class FighterAnimator {
  private readonly B: Record<string, THREE.Bone>;
  private readonly rest: Record<string, THREE.Vector3> = {};

  // Bewegungszustand
  private lvx = 0;
  private lvz = 0;
  private accF = 0; // Beschleunigung vorwaerts (m/s^2, geglaettet)
  private dirX = 0;
  private dirZ = -1;
  private moveAmp = 0;
  private runBlend = 0;
  private freq = 1;
  private phase = Math.random();
  private prevYaw: number | null = null;
  private yawRate = 0;
  private legOff = 0; // Unterkoerper-Gierwinkel relativ zur Blickrichtung
  private turnAct = 0;
  private breath = Math.random() * 10;
  private exertion = 0;
  private time = Math.random() * 50;
  private readonly hipsSpring = new Spring(160, 0.45);
  private readonly leanSpring = new Spring(55, 0.5);
  private readonly rollSpring = new Spring(55, 0.55);
  private readonly swordSpring = new Spring(90, 0.35);
  private prevLvz = 0;
  private first = true;
  private readonly feet: [FootState, FootState] = [
    { x: 0, z: 0, lift: 0, pitch: 0, yaw: 0, toe: 0 },
    { x: 0, z: 0, lift: 0, pitch: 0, yaw: 0, toe: 0 },
  ];

  private readonly armL: ArmBones;
  private readonly armR: ArmBones;
  private readonly legL: LegBones;
  private readonly legR: LegBones;
  private readonly handRigL: HandRig;
  private readonly handRigR: HandRig;
  private readonly grip: HandPose;
  private readonly fingerLag = new Spring(120, 0.4);
  private prevSwingL = 0;

  constructor(rig: Rig) {
    this.B = rig.bones;
    for (const n of Object.keys(rig.bones)) this.rest[n] = rig.bones[n]!.position.clone();
    const arm = (S: string, phase: number): ArmBones => ({
      shoulder: rig.bones['shoulder' + S]!,
      upper: rig.bones['upperArm' + S]!,
      fore: rig.bones['forearm' + S]!,
      hand: rig.bones['hand' + S]!,
      phase,
    });
    const leg = (S: string, out: number): LegBones => ({
      thigh: rig.bones['thigh' + S]!,
      shin: rig.bones['shin' + S]!,
      foot: rig.bones['foot' + S]!,
      toe: rig.bones['toe' + S]!,
      thighRest: this.rest['thigh' + S]!,
      out,
    });
    this.armL = arm('L', 1.3);
    this.armR = arm('R', 0);
    this.legL = leg('L', -1);
    this.legR = leg('R', 1);
    const digits = (S: 'L' | 'R') => DIGITS.map((d) => [0, 1, 2].map((i) => rig.bones[digitBoneName(d.name, i, S)]!));
    this.handRigL = new HandRig(digits('L'), 'L');
    this.handRigR = new HandRig(digits('R'), 'R');
    this.grip = gripPose();
  }

  /** Blickrichtung neu uebernehmen (kein Nachziehen der Beine), z. B. nach dem Aufstellen. */
  resetYaw(): void {
    this.prevYaw = null;
    this.legOff = 0;
    this.turnAct = 0;
    this.yawRate = 0;
  }

  update(dt: number, vx: number, vz: number, yaw: number, sprinting: boolean): void {
    if (!(dt > 0)) dt = 1 / 60;
    dt = Math.min(dt, 0.1);
    this.time += dt;
    const B = this.B;

    // ---------------- Geschwindigkeit im Figurenraum ----------------
    // Schutz gegen Ausreisser (z. B. Ruckler bei der Geschwindigkeitsschaetzung)
    const vIn = Math.hypot(vx, vz);
    if (vIn > 6) {
      vx *= 6 / vIn;
      vz *= 6 / vIn;
    }
    const sy = Math.sin(yaw);
    const cy = Math.cos(yaw);
    const fwd = -vx * sy - vz * cy;
    const right = vx * cy - vz * sy;
    const tx = right;
    const tz = -fwd;
    this.lvx = approach(this.lvx, tx, 9, dt);
    this.lvz = approach(this.lvz, tz, 9, dt);
    const speed = Math.hypot(this.lvx, this.lvz);
    if (speed > 0.05) {
      const k = 1 - Math.exp(-dt * 10);
      this.dirX += (this.lvx / speed - this.dirX) * k;
      this.dirZ += (this.lvz / speed - this.dirZ) * k;
      const l = Math.hypot(this.dirX, this.dirZ) || 1;
      this.dirX /= l;
      this.dirZ /= l;
    }
    const aF = (-(this.lvz - this.prevLvz)) / dt;
    this.prevLvz = this.lvz;
    this.accF = approach(this.accF, clamp(aF, -12, 12), 7, dt);

    const ampT = smooth01((speed - 0.06) / 0.55);
    this.moveAmp = approach(this.moveAmp, ampT, 7, dt);
    const runT = sprinting && speed > 2.7 ? 1 : 0;
    this.runBlend = approach(this.runBlend, runT, 3.2, dt);
    this.exertion = clamp(this.exertion + dt * (this.runBlend > 0.5 ? 0.12 : this.moveAmp > 0.5 ? 0.01 : -0.05), 0, 1);

    const amp = this.moveAmp;
    const run = this.runBlend;
    const fwdness = -this.dirZ; // 1 vor, -1 zurueck
    const side = this.dirX;

    // ---------------- Drehen: Oberkoerper voraus, Beine ziehen nach ----------------
    if (this.prevYaw === null) this.prevYaw = yaw;
    const dYaw = wrapAngle(yaw - this.prevYaw);
    this.prevYaw = yaw;
    this.yawRate = approach(this.yawRate, dYaw / dt, 10, dt);
    this.legOff -= dYaw;
    if (amp > 0.25) {
      this.legOff *= Math.exp(-dt * 10 * amp);
      this.turnAct = approach(this.turnAct, 0, 8, dt);
    } else if (Math.abs(this.legOff) > 0.4 || this.turnAct > 0.2) {
      this.turnAct = approach(this.turnAct, Math.abs(this.legOff) > 0.05 ? 1 : 0, 10, dt);
      const stepRate = 3.2 * this.turnAct;
      this.legOff -= Math.sign(this.legOff) * Math.min(Math.abs(this.legOff), stepRate * dt);
    } else {
      this.turnAct = approach(this.turnAct, 0, 6, dt);
    }
    this.legOff = clamp(this.legOff, -1.0, 1.0);
    const turn = this.turnAct;

    // ---------------- Gangzyklus ----------------
    const fWalk = 0.9 + 0.27 * speed;
    const fRun = 1.25 + 0.08 * speed;
    let fT = lerp(fWalk, fRun, run) * (1 + 0.55 * Math.abs(side) * (1 - run));
    fT = Math.max(fT, 1.7 * turn);
    this.freq = approach(this.freq, fT, 6, dt);
    this.phase = (this.phase + this.freq * dt) % 1;
    const beta = lerp(0.6, 0.38, run);
    const R = Math.min(0.95, (speed * beta) / Math.max(0.5, this.freq));

    const liftH = lerp(0.085, 0.2, run) * amp * clamp(0.4 + speed / 4, 0.4, 1) + 0.055 * turn * (1 - amp);
    const heelP = lerp(0.32, 0.18, run);
    const toeP = lerp(0.5, 0.75, run);

    // Grundstellung: im Stand leicht versetzt (links vor), in Bewegung parallel
    const sxAmt = side * amp;
    for (let f = 0; f < 2; f++) {
      const isL = f === 0;
      const S = isL ? -1 : 1;
      const ps = (this.phase + (isL ? 0 : 0.5)) % 1;
      const st = this.feet[f]!;
      const idleX = isL ? -0.13 : 0.14;
      const idleZ = isL ? -0.085 : 0.095;
      const moveX = S * (0.105 + 0.035 * Math.abs(sxAmt));
      const moveZ = 0.04 * run;
      const nb = Math.max(amp, turn);
      let bx = lerp(idleX, moveX, nb);
      let bz = lerp(idleZ, moveZ, nb);
      // Seitschritte: Beine kreuzen (einer vorne, einer hinten)
      if (isL) bz += -0.1 * Math.max(0, sxAmt) + 0.06 * Math.max(0, -sxAmt);
      else bz += -0.1 * Math.max(0, -sxAmt) + 0.06 * Math.max(0, sxAmt);

      let o: number;
      let lift: number;
      let pitch: number;
      if (ps < beta) {
        const u = ps / beta;
        o = R * (0.5 - u);
        lift = 0;
        pitch = heelP * (1 - smooth01(u / 0.25)) - toeP * smooth01((u - 0.62) / 0.38);
      } else {
        const s = (ps - beta) / (1 - beta);
        const e = run > 0.5 ? smooth01(Math.pow(s, 1.25)) : smooth01(s);
        o = R * (-0.5 + e);
        const shape = Math.sin(Math.PI * Math.pow(s, lerp(1, 0.7, run)));
        lift = liftH * shape;
        pitch = -toeP * (1 - smooth01(s / 0.45)) + heelP * smooth01((s - 0.6) / 0.4) - 0.25 * shape * run;
      }
      pitch *= fwdness * amp;
      st.x = bx + this.dirX * o;
      st.z = bz + this.dirZ * o;
      st.lift = lift * (amp > 0.01 || turn > 0.01 ? 1 : 0);
      st.pitch = pitch;
      st.toe = pitch < 0 ? Math.min(0.9, -pitch) : 0;
      const idleYaw = isL ? 0.14 : -0.38;
      const moveYaw = isL ? 0.07 : -0.07;
      st.yaw = lerp(idleYaw, moveYaw, nb);
    }

    // ---------------- Becken ----------------
    const psL = this.phase;
    const idle = 1 - Math.max(amp, turn * 0.5);
    const shift = Math.sin(this.time * 0.55) * 0.5 + Math.sin(this.time * 0.23 + 1) * 0.5;
    const walkBob = -Math.cos(4 * Math.PI * psL) * 0.017 * amp * (1 - run);
    const runBob = -Math.cos(4 * Math.PI * (psL - 0.19)) * 0.032 * run;
    const stepBob = -Math.abs(Math.sin(TAU * psL)) * 0.012 * turn * (1 - amp);
    const baseY = this.rest.hips!.y - 0.035 - 0.012 * amp - 0.035 * run - 0.004 * idle * (1 + shift) - 0.012 * this.exertion - 0.014 * Math.min(1, Math.abs(this.accF) / 6);
    if (this.first) this.hipsSpring.reset(baseY);
    const hy = this.hipsSpring.update(baseY, dt) + walkBob + runBob + stepBob;
    const swayX = (-Math.sin(TAU * psL) * 0.028 * amp * (1 - 0.6 * run) * (1 - Math.abs(side))) + idle * 0.022 * shift;

    const leanT = -(0.06 * amp * Math.max(0, fwdness) + 0.2 * run) + 0.03 * amp * Math.max(0, -fwdness) - clamp(this.accF, -6, 6) * 0.022;
    if (this.first) {
      this.leanSpring.reset(leanT);
      this.first = false;
    }
    const lean = this.leanSpring.update(leanT, dt);
    const rollT = -Math.sin(TAU * psL) * 0.045 * amp + idle * shift * -0.03 - side * amp * 0.03;
    const roll = this.rollSpring.update(rollT, dt);
    const gaitYaw = -Math.cos(TAU * psL) * lerp(0.11, 0.17, run) * amp * Math.abs(fwdness);
    const stanceYaw = -0.13 * idle;

    const hips = B.hips!;
    hips.position.set(swayX, hy, this.rest.hips!.z - 0.01 * idle);
    hips.rotation.set(lean * 0.6, this.legOff + gaitYaw + stanceYaw, roll);

    // ---------------- Rumpf, Kopf ----------------
    this.breath += dt * lerp(1.45, 3.4, this.exertion);
    const br = Math.sin(this.breath);
    const lead = clamp(this.yawRate * 0.06, -0.25, 0.25);
    const spine = B.spine!;
    const chest = B.chest!;
    spine.rotation.set(lean * 0.3 + 0.03 * idle, -(this.legOff + gaitYaw) * 0.5 - stanceYaw * 0.45 + lead * 0.4, -roll * 0.55);
    chest.rotation.set(lean * 0.25 - br * 0.012 * (1 + this.exertion), -(this.legOff + gaitYaw) * 0.5 - stanceYaw * 0.35 + lead * 0.6, -roll * 0.35);
    chest.position.y = this.rest.chest!.y + br * 0.0035;
    const upperYaw = this.legOff + gaitYaw + stanceYaw + spine.rotation.y + chest.rotation.y;
    const upperPitch = lean * 1.15 + 0.03 * idle - br * 0.012;
    const neck = B.neck!;
    const head = B.head!;
    const look = Math.sin(this.time * 0.31) * 0.06 * idle + Math.sin(this.time * 0.17 + 2) * 0.04 * idle;
    neck.rotation.set(-upperPitch * 0.35, -upperYaw * 0.4 + lead * 0.3, roll * 0.2);
    head.rotation.set(-upperPitch * 0.45 + walkBob * 1.5 + 0.05 * run, -upperYaw * 0.55 + lead * 0.5 + look, roll * 0.25);

    // ---------------- Arme ----------------
    const swingL = Math.sin(TAU * psL) * amp * Math.max(0, Math.abs(fwdness)) * lerp(0.28, 0.42, run);
    const swingR = -swingL * lerp(0.25, 0.6, run);
    const tip = this.swordSpring.update(walkBob * 6 + runBob * 3, dt);
    this.setArm(this.armR, GUARD_R, RUN_R, run, swingR, tip, br, 1);
    this.setArm(this.armL, GUARD_L, RUN_L, run, swingL, 0, br, -1);

    // ---------------- Finger ----------------
    // Rechts: Schwertgriff, im Stand minimal lockerer, beim Rennen fester.
    this.handRigR.apply(this.grip, this.grip, 0, -0.025 + 0.012 * br + 0.03 * run, 0);
    // Links: locker und halb offen, gibt dem Armschwung leicht nach; beim Rennen lockere Faust.
    const swingVel = (swingL - this.prevSwingL) / dt;
    this.prevSwingL = swingL;
    const lag = this.fingerLag.update(clamp(-swingVel * 0.06, -0.14, 0.14), dt);
    this.handRigL.apply(RELAXED, LOOSE_FIST, run * 0.85, 0.035 * Math.sin(this.breath + 0.8) + lag, 0.02 * br);

    // ---------------- Beine (IK) ----------------
    this.solveLeg(this.legL, this.feet[0]!, hips);
    this.solveLeg(this.legR, this.feet[1]!, hips);
  }

  private setArm(A: ArmBones, guard: ArmPose, runP: ArmPose, run: number, swing: number, tip: number, br: number, sgn: number): void {
    const idleSway = Math.sin(this.time * 0.9 + A.phase) * 0.02;
    A.shoulder.rotation.set(-br * 0.01, 0, sgn * br * 0.012);
    A.upper.rotation.set(lerp(guard.ux, runP.ux, run) + swing + idleSway, lerp(guard.uy, runP.uy, run), lerp(guard.uz, runP.uz, run) + sgn * 0.02 * br);
    A.fore.rotation.set(lerp(guard.fx, runP.fx, run) + swing * 0.5 + tip * 0.3, lerp(guard.fy, runP.fy, run), 0);
    A.hand.rotation.set(lerp(guard.hx, runP.hx, run) - tip * 0.8 + idleSway * 0.5, 0, lerp(guard.hz, runP.hz, run));
  }

  /** Zwei-Knochen-IK fuer ein Bein im Figurenraum (Hueften-Kind des Wurzelobjekts). */
  private solveLeg(Lg: LegBones, st: FootState, hips: THREE.Bone): void {
    const thigh = Lg.thigh;
    const shin = Lg.shin;
    const foot = Lg.foot;
    const toe = Lg.toe;

    // Hueftgelenk im Figurenraum
    _qh.copy(hips.quaternion);
    _hip.copy(Lg.thighRest).applyQuaternion(_qh).add(hips.position);

    // Fussziel: Bodenpunkt im Unterkoerper-Rahmen (legOff) -> Knoechel
    const lo = this.legOff;
    const cl = Math.cos(lo);
    const sl = Math.sin(lo);
    const gx = st.x * cl + st.z * sl;
    const gz = -st.x * sl + st.z * cl;
    const fy = lo + st.yaw;
    _e.set(st.pitch, fy, 0, 'YXZ');
    _q1.setFromEuler(_e); // Fussausrichtung (Figurenraum)
    if (st.pitch >= 0) {
      // um die Ferse kippen
      _g.set(0, 0, 0.07).applyAxisAngle(_Y, fy);
      _g.x += gx;
      _g.z += gz;
      _tmp.set(0, ANKLE_H, -0.07).applyQuaternion(_q1);
    } else {
      // um den Ballen kippen
      _g.set(0, 0, -0.1).applyAxisAngle(_Y, fy);
      _g.x += gx;
      _g.z += gz;
      _tmp.set(0, ANKLE_H, 0.1).applyQuaternion(_q1);
    }
    _ank.copy(_g).add(_tmp);
    _ank.y += st.lift;

    // Zwei-Knochen-Loesung
    _dir.subVectors(_ank, _hip);
    let L = _dir.length();
    const l1 = THIGH_LEN;
    const l2 = SHIN_LEN;
    const maxL = (l1 + l2) * 0.999;
    const soft = maxL * 0.965;
    if (L > soft) {
      const over = L - soft;
      const room = maxL - soft;
      L = soft + room * (1 - Math.exp(-over / room));
    }
    L = Math.max(L, Math.abs(l1 - l2) + 0.05);
    _dir.normalize();
    _ank.copy(_hip).addScaledVector(_dir, L);
    const cosA = clamp((l1 * l1 + L * L - l2 * l2) / (2 * l1 * L), -1, 1);
    const sinA = Math.sqrt(1 - cosA * cosA);
    // Knie zeigt nach vorne (Unterkoerper-Rahmen) und leicht nach aussen
    const o = Lg.out * 0.0875;
    _pole.set(-Math.sin(fy) * 0.94 + o * Math.cos(fy), 0, -Math.cos(fy) * 0.94 - o * Math.sin(fy));
    _pole.addScaledVector(_dir, -_pole.dot(_dir)).normalize();
    _knee.copy(_hip).addScaledVector(_dir, l1 * cosA).addScaledVector(_pole, l1 * sinA);

    // Oberschenkel-Basis: Y = Hueft - Knie, X = Beugeachse
    _by.subVectors(_hip, _knee).normalize();
    _bx.crossVectors(_pole, _by).normalize();
    _bz.crossVectors(_bx, _by);
    _m.makeBasis(_bx, _by, _bz);
    _qt.setFromRotationMatrix(_m);
    _q2.copy(_qh).invert().multiply(_qt);
    thigh.quaternion.copy(_q2);

    _by.subVectors(_knee, _ank).normalize();
    _bz.crossVectors(_bx, _by);
    _m.makeBasis(_bx, _by, _bz);
    _qs.setFromRotationMatrix(_m);
    _q3.copy(_qt).invert().multiply(_qs);
    shin.quaternion.copy(_q3);

    _q2.copy(_qs).invert().multiply(_q1);
    foot.quaternion.copy(_q2);
    toe.rotation.set(st.toe, 0, 0);
  }
}

const _Y = new THREE.Vector3(0, 1, 0);
