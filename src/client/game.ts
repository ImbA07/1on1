import * as THREE from 'three';
import { buildArena, CAMERA_MAX_RADIUS, type Arena } from './arena.js';
import { Fighter, angleLerp } from './fighter.js';
import type { Net } from './net.js';
import type { NetPlayerState, PlayerInfo } from '../shared/protocol.js';
import { SPAWNS, TICK, newSimState, stepPlayer, type MoveInput, type SimState } from '../shared/sim.js';

const FIGHTER_COLORS = [0xb3322b, 0x2b6cb3];
const MOUSE_SENSITIVITY = 0.0022;
const OPPONENT_DELAY_MS = 110; // Gegner wird leicht verzoegert, dafuer ruckelfrei gezeigt
const SHOULDER_OFFSET = 0.65;
const CAMERA_DISTANCE = 3.9;
const CAMERA_HEIGHT = 1.75;

export interface HudHooks {
  onStamina(value: number, exhausted: boolean): void;
  onLockOn(active: boolean): void;
  onPointerLock(locked: boolean): void;
}

interface Snapshot {
  t: number;
  x: number;
  z: number;
  yaw: number;
  sp: boolean;
}

interface SelfState {
  id: string;
  fighter: Fighter;
  pred: SimState;
  renderX: number;
  renderZ: number;
  pending: Array<{ seq: number; input: MoveInput }>;
}

interface OpponentState {
  id: string;
  fighter: Fighter;
  snaps: Snapshot[];
  latest: { x: number; z: number };
  lastX: number;
  lastZ: number;
  vx: number;
  vz: number;
  sprinting: boolean;
}

export class Game {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(60, 1, 0.1, 500);
  private readonly arena: Arena;
  private readonly menuFighter: Fighter;

  private mode: 'menu' | 'arena' = 'menu';
  private self: SelfState | null = null;
  private opp: OpponentState | null = null;

  private readonly keys = new Set<string>();
  private camYaw = 0;
  private lookPitch = -0.12;
  private lockOn = false;
  private pointerLocked = false;
  private acc = 0;
  // Laeuft ueber alle Runden weiter. So kann eine verspaetete Eingabe aus der
  // Vorrunde niemals neue Eingaben blockieren (der Server nimmt nur hoehere Nummern an).
  private seq = 0;
  private lastFrame = performance.now();
  private menuAngle = 0.6;
  private elapsed = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly net: Net,
    private readonly hud: HudHooks,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    // Auf Bildschirmen mit sehr hoher Pixeldichte nicht ueber 1.5 gehen: spart viel Rechenzeit
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;

    this.arena = buildArena(this.scene);
    this.menuFighter = new Fighter(FIGHTER_COLORS[0]!);
    this.scene.add(this.menuFighter.root);

    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.bindInput();
    requestAnimationFrame(() => this.frame());
  }

  // ---------------------------------------------------------------- Modi

  enterMenu(): void {
    this.leaveArena();
    this.mode = 'menu';
    this.menuFighter.root.visible = true;
  }

  enterArena(youId: string, players: PlayerInfo[]): void {
    this.leaveArena();
    this.mode = 'arena';
    this.menuFighter.root.visible = false;

    const myIndex = Math.max(0, players.findIndex((p) => p.id === youId));
    const spawn = SPAWNS[myIndex] ?? SPAWNS[0]!;
    const selfFighter = new Fighter(FIGHTER_COLORS[myIndex % 2]!);
    this.scene.add(selfFighter.root);
    this.self = {
      id: youId,
      fighter: selfFighter,
      pred: newSimState(spawn.x, spawn.z, spawn.yaw),
      renderX: spawn.x,
      renderZ: spawn.z,
      pending: [],
    };

    const oppIndex = players.findIndex((p) => p.id !== youId);
    if (oppIndex >= 0) {
      const oppSpawn = SPAWNS[oppIndex] ?? SPAWNS[1]!;
      const oppFighter = new Fighter(FIGHTER_COLORS[oppIndex % 2]!);
      this.scene.add(oppFighter.root);
      this.opp = {
        id: players[oppIndex]!.id,
        fighter: oppFighter,
        snaps: [],
        latest: { x: oppSpawn.x, z: oppSpawn.z },
        lastX: oppSpawn.x,
        lastZ: oppSpawn.z,
        vx: 0,
        vz: 0,
        sprinting: false,
      };
      oppFighter.setPosition(oppSpawn.x, oppSpawn.z, oppSpawn.yaw);
    }

    this.camYaw = spawn.yaw;
    this.lookPitch = -0.12;
    this.lockOn = false;
    this.acc = 0;
    this.hud.onLockOn(false);
    this.hud.onStamina(100, false);
  }

  leaveArena(): void {
    this.self?.fighter.dispose();
    this.opp?.fighter.dispose();
    this.self = null;
    this.opp = null;
    this.lockOn = false;
    this.keys.clear();
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  requestPointerLock(): void {
    if (this.mode !== 'arena') return;
    try {
      const result = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
      // Neuere Browser liefern ein Versprechen; Fehler (z. B. zu schnell nach Esc) ignorieren
      result?.catch?.(() => {});
    } catch {
      // nicht unterstuetzt
    }
  }

  // ---------------------------------------------------------------- Netzwerk

  onState(players: NetPlayerState[]): void {
    if (this.mode !== 'arena' || !this.self) return;

    // Zuerst den Gegner aktualisieren: Das Neuabspielen unten rechnet mit dessen neuester Position
    const other = players.find((p) => p.id !== this.self!.id);
    if (other && this.opp) {
      this.opp.latest = { x: other.x, z: other.z };
      this.opp.sprinting = other.sp;
      this.opp.snaps.push({ t: performance.now(), x: other.x, z: other.z, yaw: other.yaw, sp: other.sp });
      if (this.opp.snaps.length > 30) this.opp.snaps.shift();
    }

    const me = players.find((p) => p.id === this.self!.id);
    if (me) {
      const s = this.self;
      const p = s.pred;
      p.x = me.x;
      p.z = me.z;
      p.yaw = me.yaw;
      p.stamina = me.st;
      p.exhausted = me.ex;
      p.regenDelay = me.rd;
      p.sprinting = me.sp;
      // Vom Server schon verarbeitete Eingaben verwerfen, die restlichen erneut abspielen
      while (s.pending.length && s.pending[0]!.seq <= me.ack) s.pending.shift();
      for (const item of s.pending) stepPlayer(p, item.input, this.opp?.latest);
    }
  }

  // ---------------------------------------------------------------- Eingabe

  private bindInput(): void {
    window.addEventListener('keydown', (e) => {
      if (this.isTyping(e)) return;
      if (this.mode === 'arena' && ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
        e.preventDefault();
      }
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    window.addEventListener('mousemove', (e) => {
      if (this.mode !== 'arena' || !this.pointerLocked) return;
      if (!this.lockOn) this.camYaw -= e.movementX * MOUSE_SENSITIVITY;
      this.lookPitch = clamp(this.lookPitch - e.movementY * MOUSE_SENSITIVITY, -0.85, 0.45);
    });

    this.canvas.addEventListener('mousedown', (e) => {
      if (this.mode !== 'arena') return;
      if (e.button === 1) {
        e.preventDefault();
        this.toggleLockOn();
      } else if (e.button === 0 && !this.pointerLocked) {
        this.requestPointerLock();
      }
    });
    // Mausrad-Klick soll nicht das Auto-Scrollen des Browsers starten
    this.canvas.addEventListener('auxclick', (e) => e.preventDefault());

    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.canvas;
      this.hud.onPointerLock(this.pointerLocked);
    });
  }

  private isTyping(e: KeyboardEvent): boolean {
    const t = e.target;
    return t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement;
  }

  private toggleLockOn(): void {
    if (!this.opp) return;
    this.lockOn = !this.lockOn;
    this.hud.onLockOn(this.lockOn);
  }

  private readInput(): MoveInput {
    const k = this.keys;
    const fwd = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0);
    const right = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
    const sprint = k.has('ShiftLeft') || k.has('ShiftRight');
    return { fwd, right, yaw: this.camYaw, sprint };
  }

  // ---------------------------------------------------------------- Schleife

  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private frame(): void {
    const now = performance.now();
    const rawDt = (now - this.lastFrame) / 1000;
    const dt = Math.min(0.1, rawDt);
    this.lastFrame = now;
    this.elapsed += dt;

    if (this.mode === 'arena' && this.self) this.updateArena(dt, Math.min(0.25, rawDt), now);
    else this.updateMenu(dt);

    this.arena.update(this.elapsed);
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(() => this.frame());
  }

  private updateMenu(dt: number): void {
    this.menuAngle += dt * 0.07;
    const r = 9.5;
    this.camera.position.set(Math.cos(this.menuAngle) * r, 3.2, Math.sin(this.menuAngle) * r);
    this.camera.lookAt(0, 1.35, 0);
    this.menuFighter.setPosition(0, 0, -this.menuAngle - Math.PI / 2 + 0.5);
    this.menuFighter.animate(dt, 0, 0, 0, false);
  }

  /** dt: geglaettete Bildzeit fuer Optik; simDt: echte Zeit (bis 0,25 s) fuer die Spiellogik. */
  private updateArena(dt: number, simDt: number, now: number): void {
    const self = this.self!;

    // Kamera mit Pfeiltasten drehen (Ersatz, falls die Maus nicht gefangen ist)
    if (!this.pointerLocked) {
      if (this.keys.has('ArrowLeft') && !this.lockOn) this.camYaw += dt * 2;
      if (this.keys.has('ArrowRight') && !this.lockOn) this.camYaw -= dt * 2;
      if (this.keys.has('ArrowUp')) this.lookPitch = clamp(this.lookPitch + dt * 1.2, -0.85, 0.45);
      if (this.keys.has('ArrowDown')) this.lookPitch = clamp(this.lookPitch - dt * 1.2, -0.85, 0.45);
    }

    // Lock-on: Kamera und Blick folgen dem Gegner
    if (this.lockOn && this.opp) {
      const desired = Math.atan2(-(this.opp.lastX - self.renderX), -(this.opp.lastZ - self.renderZ));
      this.camYaw = angleLerp(this.camYaw, desired, 1 - Math.exp(-dt * 9));
      this.lookPitch += (-0.16 - this.lookPitch) * (1 - Math.exp(-dt * 4));
    }

    // Feste Simulationsschritte (30 pro Sekunde), genau wie auf dem Server
    this.acc = Math.min(this.acc + simDt, 0.25);
    while (this.acc >= TICK) {
      this.acc -= TICK;
      this.tick();
    }

    // Eigene Figur weich zur vorhergesagten Position bewegen
    const p = self.pred;
    const err = Math.hypot(p.x - self.renderX, p.z - self.renderZ);
    if (err > 2) {
      self.renderX = p.x;
      self.renderZ = p.z;
    } else {
      const k = 1 - Math.exp(-dt * 22);
      self.renderX += (p.x - self.renderX) * k;
      self.renderZ += (p.z - self.renderZ) * k;
    }
    self.fighter.setPosition(self.renderX, self.renderZ, this.camYaw);
    self.fighter.animate(dt, p.vx, p.vz, this.camYaw, p.sprinting);

    this.updateOpponent(dt, now);
    this.updateCamera(self);
  }

  private tick(): void {
    const self = this.self!;
    const input = this.readInput();
    this.seq += 1;
    stepPlayer(self.pred, input, this.opp?.latest);
    self.pending.push({ seq: this.seq, input });
    if (self.pending.length > 150) self.pending.shift();
    this.net.send({ t: 'input', seq: this.seq, fwd: input.fwd, right: input.right, yaw: input.yaw, sprint: input.sprint });
    this.hud.onStamina(self.pred.stamina, self.pred.exhausted);
  }

  private updateOpponent(dt: number, now: number): void {
    const opp = this.opp;
    if (!opp || opp.snaps.length === 0) return;

    const renderT = now - OPPONENT_DELAY_MS;
    const snaps = opp.snaps;
    let x: number, z: number, yaw: number;
    if (renderT <= snaps[0]!.t) {
      ({ x, z, yaw } = snaps[0]!);
    } else if (renderT >= snaps[snaps.length - 1]!.t) {
      ({ x, z, yaw } = snaps[snaps.length - 1]!);
    } else {
      let i = snaps.length - 1;
      while (i > 0 && snaps[i - 1]!.t > renderT) i--;
      const a = snaps[i - 1]!;
      const b = snaps[i]!;
      const f = (renderT - a.t) / Math.max(1, b.t - a.t);
      x = a.x + (b.x - a.x) * f;
      z = a.z + (b.z - a.z) * f;
      yaw = angleLerp(a.yaw, b.yaw, f);
    }

    // Geschwindigkeit fuer die Lauf-Animation aus den sichtbaren Bewegungen ableiten
    if (dt > 0) {
      const k = 1 - Math.exp(-dt * 14);
      opp.vx += ((x - opp.lastX) / dt - opp.vx) * k;
      opp.vz += ((z - opp.lastZ) / dt - opp.vz) * k;
    }
    opp.lastX = x;
    opp.lastZ = z;
    opp.fighter.setPosition(x, z, yaw);
    opp.fighter.animate(dt, opp.vx, opp.vz, yaw, opp.sprinting);
  }

  private updateCamera(self: SelfState): void {
    const yaw = this.camYaw;
    const pitch = this.lookPitch;
    const cosP = Math.cos(pitch);
    const vx = -Math.sin(yaw) * cosP;
    const vy = Math.sin(pitch);
    const vz = -Math.cos(yaw) * cosP;
    const rx = Math.cos(yaw);
    const rz = -Math.sin(yaw);

    const tx = self.renderX + rx * SHOULDER_OFFSET;
    const ty = CAMERA_HEIGHT;
    const tz = self.renderZ + rz * SHOULDER_OFFSET;

    let cx = tx - vx * CAMERA_DISTANCE;
    let cy = Math.max(0.4, ty - vy * CAMERA_DISTANCE);
    let cz = tz - vz * CAMERA_DISTANCE;
    const r = Math.hypot(cx, cz);
    if (r > CAMERA_MAX_RADIUS) {
      cx = (cx / r) * CAMERA_MAX_RADIUS;
      cz = (cz / r) * CAMERA_MAX_RADIUS;
    }
    this.camera.position.set(cx, cy, cz);
    this.camera.lookAt(tx + vx * 10, ty + vy * 10, tz + vz * 10);
  }

  // ---------------------------------------------------------------- Debug

  debugInfo(): unknown {
    return {
      mode: this.mode,
      lockOn: this.lockOn,
      camYaw: this.camYaw,
      pred: this.self ? { ...this.self.pred } : null,
      pending: this.self?.pending.length ?? 0,
      opp: this.opp ? { x: this.opp.lastX, z: this.opp.lastZ, snaps: this.opp.snaps.length } : null,
    };
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
