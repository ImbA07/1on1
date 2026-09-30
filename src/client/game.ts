import * as THREE from 'three';
import { buildArena, CAMERA_MAX_RADIUS, type Arena } from './arena.js';
import { Fighter, angleLerp, newCombatPose, type CombatPose } from './fighter.js';
import type { Net } from './net.js';
import type { NetEvent, NetMatch, PlayerInfo, ServerMessage } from '../shared/protocol.js';
import { applyNet } from '../shared/netstate.js';
import { DirectionPicker } from './direction.js';
import { Effects } from './fx.js';
import { Sfx } from './sfx.js';
import { SPAWNS, TICK, newSimState, stepPlayer, type MoveInput, type SimState } from '../shared/sim.js';
import { weaponOf, windupNeed } from '../shared/combat.js';
import { Act, HP_MAX } from '../shared/weapons.js';

const FIGHTER_COLORS = [0xb3322b, 0x2b6cb3];
const MOUSE_SENSITIVITY = 0.0022;
const OPPONENT_DELAY_MS = 110; // Gegner wird leicht verzoegert, dafuer ruckelfrei gezeigt
const SHOULDER_OFFSET = 0.65;
const CAMERA_DISTANCE = 3.9;
const CAMERA_HEIGHT = 1.75;

/** Alles, was die Anzeige im Kampf braucht (kein Lebensbalken: nur Zustand und Effekte). */
export interface CombatView {
  act: number;
  dir: number; // aktuelle Richtung des eigenen Angriffs/Blocks
  actT: number;
  need: number; // Ticks bis zum fruehesten Schlag
  atkHeld: boolean;
  blkHeld: boolean;
  selDir: number; // per Maus gewaehlte Richtung
  hpFrac: number; // 0..1, nur fuer Bildschirm-Effekte
  down: boolean;
  downT: number;
  oppAct: number;
  oppDir: number; // Richtung des gegnerischen Angriffs (aus dessen Sicht)
  oppDown: boolean;
  oppDownT: number;
  canAct: boolean;
}

export interface HudHooks {
  onStamina(value: number, exhausted: boolean): void;
  onLockOn(active: boolean): void;
  onPointerLock(locked: boolean): void;
  onCombat(view: CombatView): void;
  onEvents(events: NetEvent[], youId: string): void;
  onMatch(match: NetMatch, youId: string): void;
  onNotice?(text: string): void;
}

interface Snapshot {
  t: number;
  x: number;
  z: number;
  yaw: number;
  sp: boolean;
  // Kampfzustand (fuer die Animation, mit derselben Verzoegerung wie die Position abgespielt)
  ac: number;
  d: number;
  at: number;
  sg: number;
  dz: number;
  am: number;
  lg: number;
  dn: boolean;
  dt: number;
  rv: boolean;
  need: number;
}

interface SelfState {
  id: string;
  fighter: Fighter;
  pred: SimState;
  renderX: number;
  renderZ: number;
  pending: Array<{ seq: number; input: MoveInput }>;
  spawnYaw: number;
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
  act: number;
  dir: number;
  down: boolean;
  downT: number;
  /** Hilfszustand, um windupNeed fuer den Gegner auszurechnen */
  needSim: SimState;
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

  // Kampf-Eingabe: linke Maustaste = Angriff, rechte = Block, Maus bewegen = Richtung waehlen
  private atkHeld = false;
  private blkHeld = false;
  // Richtungswahl: Die Richtung folgt der letzten deutlichen Mausbewegung (kurzer Rueckblick),
  // waehrend die Kamera sich normal weiterdreht.
  private readonly picker = new DirectionPicker();
  private selDir = 0;
  private manualDirAt = -1e9; // wann die Richtung zuletzt bewusst per Maus gewechselt wurde
  // Beim Kampfbeginn automatisch auf den Gegner ausrichten: Dann steuert die Maus nur die Richtung
  private preferLock = true;
  private prevPhase = '';

  // Effekte und Ton
  private readonly fx = new Effects();
  private readonly sfx = new Sfx();
  private pendingFx: Array<{ at: number; fn: () => void }> = [];
  private hitstop = 0; // Sekunden: Zeitlupen-Moment beim Treffer
  private fovKick = 0;
  private prevSelfAct: number = Act.IDLE;
  private prevOppAct: number = Act.IDLE;
  private tmKey = '';
  private canAct = false;
  private matchKey = '';
  private matchRound = 0;
  private shake = 0;

  // Rundenausgang fuer Sieger-/Verlierer-Pose
  private matchPhase = '';
  private matchWinner = '';
  private readonly combatPose: CombatPose = newCombatPose();

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
    this.scene.add(this.fx.group);
    try {
      this.sfx.muted = localStorage.getItem('1on1.mute') === '1';
    } catch {
      // Standard: Ton an
    }

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
    this.addWorldFx(selfFighter);
    this.self = {
      id: youId,
      fighter: selfFighter,
      pred: newSimState(spawn.x, spawn.z, spawn.yaw),
      renderX: spawn.x,
      renderZ: spawn.z,
      pending: [],
      spawnYaw: spawn.yaw,
    };

    const oppIndex = players.findIndex((p) => p.id !== youId);
    if (oppIndex >= 0) {
      const oppSpawn = SPAWNS[oppIndex] ?? SPAWNS[1]!;
      const oppFighter = new Fighter(FIGHTER_COLORS[oppIndex % 2]!);
      this.scene.add(oppFighter.root);
      this.addWorldFx(oppFighter);
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
        act: Act.IDLE,
        dir: 0,
        down: false,
        downT: 0,
        needSim: newSimState(0, 0, 0),
      };
      oppFighter.setPosition(oppSpawn.x, oppSpawn.z, oppSpawn.yaw);
    }

    this.camYaw = spawn.yaw;
    this.lookPitch = -0.12;
    this.lockOn = false;
    this.acc = 0;
    this.canAct = false;
    this.matchKey = '';
    this.matchRound = 0;
    this.atkHeld = false;
    this.blkHeld = false;
    this.selDir = 0;
    this.shake = 0;
    this.hitstop = 0;
    this.fovKick = 0;
    this.pendingFx = [];
    this.tmKey = '';
    this.prevSelfAct = Act.IDLE;
    this.prevOppAct = Act.IDLE;
    this.fx.clear();
    this.sfx.setAmbient(true);
    this.hud.onLockOn(false);
    this.hud.onStamina(100, false);
  }

  /** Effekt-Objekte einer Figur (z. B. Schwert-Spur), falls sie welche hat, mit in die Szene aufnehmen. */
  private addWorldFx(f: Fighter): void {
    const wf = (f as unknown as { worldFx?: THREE.Object3D }).worldFx;
    if (wf) this.scene.add(wf);
  }

  private removeWorldFx(f: Fighter): void {
    (f as unknown as { worldFx?: THREE.Object3D }).worldFx?.removeFromParent();
  }

  leaveArena(): void {
    if (this.self) this.removeWorldFx(this.self.fighter);
    if (this.opp) this.removeWorldFx(this.opp.fighter);
    this.self?.fighter.dispose();
    this.opp?.fighter.dispose();
    this.fx.clear();
    this.sfx.setAmbient(false);
    this.pendingFx = [];
    this.self = null;
    this.opp = null;
    this.lockOn = false;
    this.keys.clear();
    this.atkHeld = false;
    this.blkHeld = false;
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

  onState(msg: Extract<ServerMessage, { t: 'state' }>): void {
    if (this.mode !== 'arena' || !this.self) return;
    const players = msg.players;
    const youId = this.self.id;

    // Kampf-Phase (Countdown/Kampf/Rundenende) und Ereignisse
    this.canAct = msg.match?.ph === 'fight';
    const phase = msg.match?.ph ?? '';
    if (phase === 'fight' && this.prevPhase !== 'fight' && this.preferLock && this.opp && !this.lockOn) {
      // Kampfbeginn: Kamera auf den Gegner ausrichten, die Maus waehlt dann nur noch die Richtung
      this.lockOn = true;
      this.hud.onLockOn(true);
    }
    this.prevPhase = phase;
    // Countdown: Trommelschlaege, Kampfbeginn: Horn
    if (msg.match) {
      const tk = `${msg.match.ph}|${msg.match.tm}`;
      if (tk !== this.tmKey) {
        if (msg.match.ph === 'countdown') this.sfx.drum(msg.match.tm <= 1);
        else if (msg.match.ph === 'fight' && !this.tmKey.startsWith('fight')) this.sfx.horn(false);
        this.tmKey = tk;
      }
    }
    this.matchPhase = msg.match?.ph ?? '';
    this.matchWinner = msg.match && msg.match.ld >= 0 ? (msg.match.ids[msg.match.ld] ?? '') : '';
    if (msg.match) {
      const m = msg.match;
      const key = `${m.ph}|${m.round}|${m.wins.join(',')}|${m.tm}|${m.ld}|${m.rm.join(',')}|${m.stats ? 1 : 0}`;
      if (key !== this.matchKey) {
        this.matchKey = key;
        this.hud.onMatch(m, youId);
      }
      if (m.round !== this.matchRound) {
        // Neue Runde: Kamera wieder zum Gegner ausrichten
        this.matchRound = m.round;
        this.fx.clear();
        this.camYaw = this.self.spawnYaw;
        this.lookPitch = -0.12;
        this.lockOn = false;
        this.hud.onLockOn(false);
      }
    }
    if (msg.ev.length) {
      for (const e of msg.ev) if ((e.k === 'hit' && e.d === youId) || (e.k === 'break' && e.d === youId)) this.shake = 1;
      this.hud.onEvents(msg.ev, youId);
      this.dispatchEvents(msg.ev, youId);
    }

    // Zuerst den Gegner aktualisieren: Das Neuabspielen unten rechnet mit dessen neuester Position
    const other = players.find((p) => p.id !== youId);
    if (other && this.opp) {
      this.opp.latest = { x: other.x, z: other.z };
      this.opp.sprinting = other.sp;
      this.opp.act = other.ac;
      this.opp.dir = other.d;
      this.opp.down = other.dn;
      this.opp.downT = other.dt;
      const ns = this.opp.needSim;
      ns.armT = other.am;
      ns.dazeT = other.dz;
      ns.exhausted = other.ex;
      this.opp.snaps.push({
        t: performance.now(),
        x: other.x,
        z: other.z,
        yaw: other.yaw,
        sp: other.sp,
        ac: other.ac,
        d: other.d,
        at: other.at,
        sg: other.sg,
        dz: other.dz,
        am: other.am,
        lg: other.lg,
        dn: other.dn,
        dt: other.dt,
        rv: other.rv,
        need: windupNeed(ns, weaponOf(ns)),
      });
      if (this.opp.snaps.length > 30) this.opp.snaps.shift();
    }

    const me = players.find((p) => p.id === youId);
    if (me) {
      const s = this.self;
      applyNet(s.pred, me);
      // Vom Server schon verarbeitete Eingaben verwerfen, die restlichen erneut abspielen
      while (s.pending.length && s.pending[0]!.seq <= me.ack) s.pending.shift();
      for (const item of s.pending) stepPlayer(s.pred, item.input, this.opp?.latest, this.canAct);
    }
  }

  // ---------------------------------------------------------------- Eingabe

  private bindInput(): void {
    window.addEventListener('keydown', (e) => {
      if (this.isTyping(e)) return;
      this.sfx.unlock();
      if (e.code === 'KeyM' && !e.repeat) {
        this.sfx.setMuted(!this.sfx.muted);
        try {
          localStorage.setItem('1on1.mute', this.sfx.muted ? '1' : '0');
        } catch {
          // nicht schlimm
        }
        this.hud.onNotice?.(this.sfx.muted ? 'Ton aus (M)' : 'Ton an (M)');
      }
      if (this.mode === 'arena' && ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
        e.preventDefault();
      }
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.atkHeld = false;
      this.blkHeld = false;
    });

    window.addEventListener('mousemove', (e) => {
      if (this.mode !== 'arena' || !this.pointerLocked) return;
      // Die Kamera dreht IMMER mit der Maus (mit Fokus auf den Gegner folgt sie ihm selbst) ...
      if (!this.lockOn) this.camYaw -= e.movementX * MOUSE_SENSITIVITY;
      this.lookPitch = clamp(this.lookPitch - e.movementY * MOUSE_SENSITIVITY, -0.85, 0.45);
      // ... und dieselbe Bewegung waehlt beim Angriff/Block die Richtung.
      this.picker.feed(e.movementX, e.movementY, performance.now());
      if (this.atkHeld || this.blkHeld) this.pickDirection();
    });

    this.canvas.addEventListener('mousedown', (e) => {
      this.sfx.unlock();
      if (this.mode !== 'arena') return;
      if (e.button === 1) {
        e.preventDefault();
        this.toggleLockOn();
      } else if (!this.pointerLocked) {
        if (e.button === 0) this.requestPointerLock();
      } else if (e.button === 0) {
        e.preventDefault();
        this.atkHeld = true;
        this.pickDirection(); // auch eine Wischbewegung kurz VOR dem Klick zaehlt
      } else if (e.button === 2) {
        e.preventDefault();
        this.blkHeld = true;
        this.pickDirection();
      }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.atkHeld = false;
      if (e.button === 2) this.blkHeld = false;
    });
    // Rechtsklick soll kein Browser-Menue oeffnen, Mausrad-Klick nicht das Auto-Scrollen starten
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    this.canvas.addEventListener('auxclick', (e) => e.preventDefault());

    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.canvas;
      if (!this.pointerLocked) {
        this.atkHeld = false;
        this.blkHeld = false;
      }
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
    this.preferLock = this.lockOn; // wer den Fokus abschaltet, will ihn auch in der naechsten Runde nicht
    this.hud.onLockOn(this.lockOn);
  }

  /**
   * Richtung aus der letzten deutlichen Mausbewegung: hoch = oben, links = links, rechts = rechts.
   * Kleine Bewegungen und Wischen nach unten aendern nichts (siehe direction.ts).
   */
  private pickDirection(): void {
    const now = performance.now();
    const d = this.picker.pick(now, this.selDir);
    if (d !== this.selDir) {
      this.selDir = d;
      this.manualDirAt = now;
    }
  }

  private readInput(): MoveInput {
    // Vor dem Kampf (Countdown) und nach der Runde bleibt die Figur stehen
    if (!this.canAct) {
      return { fwd: 0, right: 0, yaw: this.camYaw, sprint: false, atk: false, blk: false, dir: this.selDir };
    }
    const k = this.keys;
    const fwd = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0);
    const right = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
    const sprint = k.has('ShiftLeft') || k.has('ShiftRight');
    const dir = this.selDir;
    return { fwd, right, yaw: this.camYaw, sprint, atk: this.atkHeld, blk: this.blkHeld, dir };
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
    // Kampf-Animation: vorhergesagter Zustand, zwischen den Ticks weitergefuehrt
    const cp = this.combatPose;
    const w = weaponOf(p);
    cp.act = p.act;
    cp.dir = p.dir;
    cp.actT = p.actT;
    cp.tickFrac = Math.min(1, this.acc / TICK);
    cp.need = windupNeed(p, w);
    cp.windupMax = w.windupMax;
    cp.strikeTicks = w.strikeTicks;
    cp.recovery = w.recovery;
    cp.blockRaise = w.blockRaise;
    cp.staggerT = p.staggerT;
    cp.down = p.down;
    cp.downT = p.downT;
    cp.revived = p.revived;
    cp.armT = p.armT;
    cp.legT = p.legT;
    cp.dazeT = p.dazeT;
    cp.outcome = this.outcomeFor(self.id);
    self.fighter.setCombat(cp);
    // Zeitlupen-Moment beim Treffer: Die Figuren-Animation laeuft kurz fast still
    const animDt = this.hitstop > 0 ? dt * 0.06 : dt;
    this.hitstop = Math.max(0, this.hitstop - dt);
    self.fighter.animate(animDt, p.vx, p.vz, this.camYaw, p.sprinting);
    if (p.act === Act.STRIKE && this.prevSelfAct !== Act.STRIKE) this.sfx.swoosh(0, 1);
    this.prevSelfAct = p.act;

    this.updateOpponent(dt, now, animDt);
    this.runPendingFx(now);
    this.fx.update(dt);
    this.fovKick *= Math.exp(-dt * 8);
    this.updateCamera(self, dt);

    const opp = this.opp;
    this.hud.onCombat({
      act: p.act,
      dir: p.dir,
      actT: p.actT,
      need: windupNeed(p, weaponOf(p)),
      atkHeld: this.atkHeld,
      blkHeld: this.blkHeld,
      selDir: this.selDir,
      hpFrac: Math.max(0, Math.min(1, p.hp / HP_MAX)),
      down: p.down,
      downT: p.downT,
      oppAct: opp?.act ?? Act.IDLE,
      oppDir: opp?.dir ?? 0,
      oppDown: opp?.down ?? false,
      oppDownT: opp?.downT ?? 0,
      canAct: this.canAct,
    });
  }

  private tick(): void {
    const self = this.self!;
    const input = this.readInput();
    this.seq += 1;
    stepPlayer(self.pred, input, this.opp?.latest, this.canAct);
    self.pending.push({ seq: this.seq, input });
    if (self.pending.length > 150) self.pending.shift();
    this.net.send({
      t: 'input',
      seq: this.seq,
      fwd: input.fwd,
      right: input.right,
      yaw: input.yaw,
      sprint: input.sprint,
      atk: input.atk === true,
      blk: input.blk === true,
      dir: input.dir ?? 0,
    });
    this.hud.onStamina(self.pred.stamina, self.pred.exhausted);
  }

  private updateOpponent(dt: number, now: number, animDt: number): void {
    const opp = this.opp;
    if (!opp || opp.snaps.length === 0) return;

    const renderT = now - OPPONENT_DELAY_MS;
    const snaps = opp.snaps;
    this.applyOpponentCombat(opp, renderT);
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
    opp.fighter.animate(animDt, opp.vx, opp.vz, yaw, opp.sprinting);
  }

  /** Rundenausgang aus Sicht eines Spielers: 1 gewonnen, -1 verloren, 0 laeuft. */
  private outcomeFor(id: string): number {
    if ((this.matchPhase !== 'roundEnd' && this.matchPhase !== 'matchEnd') || !this.matchWinner) return 0;
    return this.matchWinner === id ? 1 : -1;
  }

  /**
   * Kampfzustand des Gegners zum selben (verzoegerten) Zeitpunkt wie seine Position abspielen:
   * letzter Schnappschuss vor renderT, der Rest bis zum naechsten Tick als Bruchteil.
   */
  private applyOpponentCombat(opp: OpponentState, renderT: number): void {
    const snaps = opp.snaps;
    let i = snaps.length - 1;
    while (i > 0 && snaps[i]!.t > renderT) i--;
    const s = snaps[i]!;
    const w = weaponOf(opp.needSim);
    const cp = this.combatPose;
    cp.act = s.ac;
    cp.dir = s.d;
    cp.actT = s.at;
    cp.tickFrac = Math.max(0, Math.min(1, (renderT - s.t) / (TICK * 1000)));
    cp.need = s.need;
    cp.windupMax = w.windupMax;
    cp.strikeTicks = w.strikeTicks;
    cp.recovery = w.recovery;
    cp.blockRaise = w.blockRaise;
    cp.staggerT = s.sg;
    cp.down = s.dn;
    cp.downT = s.dt;
    cp.revived = s.rv;
    cp.armT = s.am;
    cp.legT = s.lg;
    cp.dazeT = s.dz;
    cp.outcome = this.outcomeFor(opp.id);
    opp.fighter.setCombat(cp);
    if (s.ac === Act.STRIKE && this.prevOppAct !== Act.STRIKE) this.sfx.swoosh(this.panFor(opp.lastX, opp.lastZ), 1);
    this.prevOppAct = s.ac;
  }

  private updateCamera(self: SelfState, dt: number): void {
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
    // Wackeln, wenn man getroffen wurde
    if (this.shake > 0) {
      const a = this.shake * this.shake * 0.09;
      cx += (Math.random() - 0.5) * a;
      cy += (Math.random() - 0.5) * a;
      cz += (Math.random() - 0.5) * a;
      this.shake = Math.max(0, this.shake - dt * 3);
    }
    const fov = 60 + this.fovKick;
    if (Math.abs(fov - this.camera.fov) > 0.02) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    this.camera.position.set(cx, cy, cz);
    this.camera.lookAt(tx + vx * 10, ty + vy * 10, tz + vz * 10);
  }

  // ---------------------------------------------------------------- Effekte und Ton

  private posOf(id: string): { x: number; z: number } {
    if (this.self && id === this.self.id) return { x: this.self.renderX, z: this.self.renderZ };
    if (this.opp && id === this.opp.id) return { x: this.opp.lastX, z: this.opp.lastZ };
    return { x: 0, z: 0 };
  }

  /** Links/rechts-Position einer Schallquelle fuer den Ton (-1 links .. 1 rechts). */
  private panFor(x: number, z: number): number {
    const cp = this.camera.position;
    const dx = x - cp.x;
    const dz = z - cp.z;
    const d = Math.max(1, Math.hypot(dx, dz));
    return clamp(((dx * Math.cos(this.camYaw) + dz * -Math.sin(this.camYaw)) / d) * 0.9, -1, 1);
  }

  private schedule(delayMs: number, fn: () => void): void {
    if (delayMs <= 0) fn();
    else this.pendingFx.push({ at: performance.now() + delayMs, fn });
  }

  private runPendingFx(now: number): void {
    if (this.pendingFx.length === 0) return;
    const rest: Array<{ at: number; fn: () => void }> = [];
    for (const p of this.pendingFx) {
      if (p.at <= now) p.fn();
      else rest.push(p);
    }
    this.pendingFx = rest;
  }

  private impact(id: string, kind: string, info: Record<string, unknown>): void {
    const f = this.self && id === this.self.id ? this.self.fighter : this.opp && id === this.opp.id ? this.opp.fighter : null;
    (f as unknown as { playImpact?: (k: string, i: Record<string, unknown>) => void } | null)?.playImpact?.(kind, info);
  }

  /**
   * Ereignisse vom Server in Effekte, Ton und Figurenreaktionen umsetzen. Ereignisse, bei denen
   * der Gegner die Wirkung "traegt", werden um die Anzeigeverzoegerung (110 ms) verschoben,
   * damit sie zu seiner sichtbaren Pose passen.
   */
  private dispatchEvents(events: NetEvent[], youId: string): void {
    const ZONE_Y = [1.7, 1.3, 1.35, 0.6];
    for (const e of events) {
      if (e.k === 'hit') {
        const delay = e.d === youId ? 0 : OPPONENT_DELAY_MS;
        this.schedule(delay, () => {
          const a = this.posOf(e.a);
          const d = this.posOf(e.d);
          const dx = d.x - a.x;
          const dz = d.z - a.z;
          const l = Math.hypot(dx, dz) || 1;
          const nx = dx / l;
          const nz = dz / l;
          const heavy = e.fin === true || e.z === 0;
          this.fx.bleed(d.x - nx * 0.15, ZONE_Y[e.z] ?? 1.3, d.z - nz * 0.15, nx, nz, 12 + Math.round(e.dmg / 2) + (e.fin ? 14 : 0), e.fin ? 1.5 : 1);
          this.sfx.thud(this.panFor(d.x, d.z), e.z, heavy);
          this.hitstop = Math.max(this.hitstop, e.fin ? 0.16 : e.z === 0 ? 0.11 : 0.08);
          if (e.a === youId) this.fovKick = -2.5;
          else if (e.d === youId) this.fovKick = 3.5;
          this.impact(e.d, 'hit', { zone: e.z, dirX: nx, dirZ: nz, heavy });
        });
      } else if (e.k === 'block' || e.k === 'parry') {
        const delay = e.d === youId ? 0 : OPPONENT_DELAY_MS;
        this.schedule(delay, () => {
          const a = this.posOf(e.a);
          const d = this.posOf(e.d);
          const dx = d.x - a.x;
          const dz = d.z - a.z;
          const l = Math.hypot(dx, dz) || 1;
          const nx = dx / l;
          const nz = dz / l;
          const parry = e.k === 'parry';
          // Aufprallpunkt: vor dem Blockenden, auf Schildhoehe
          this.fx.spark(d.x - nx * 0.55, 1.3, d.z - nz * 0.55, -nx, -nz, parry ? 38 : 18, parry ? 1.4 : 1);
          this.sfx.clang(this.panFor(d.x, d.z), parry);
          this.hitstop = Math.max(this.hitstop, parry ? 0.13 : 0.05);
          if (parry) this.fovKick = e.d === youId ? -4 : 3;
          this.impact(e.d, 'block', { dirX: nx, dirZ: nz });
          if (parry) this.impact(e.a, 'parry', { dirX: -nx, dirZ: -nz });
        });
      } else if (e.k === 'break') {
        this.schedule(e.d === youId ? 0 : OPPONENT_DELAY_MS, () => {
          const d = this.posOf(e.d);
          this.fx.spark(d.x, 1.3, d.z, 0, 0, 26, 1.1);
          this.sfx.crack(this.panFor(d.x, d.z));
          this.hitstop = Math.max(this.hitstop, 0.1);
          this.impact(e.d, 'break', {});
        });
      } else if (e.k === 'down') {
        this.schedule(e.id === youId ? 0 : OPPONENT_DELAY_MS, () => {
          this.sfx.boom();
          this.impact(e.id, 'down', {});
        });
      } else if (e.k === 'revive') {
        this.schedule(e.id === youId ? 0 : OPPONENT_DELAY_MS, () => {
          this.sfx.rise();
          this.impact(e.id, 'revive', {});
        });
      } else if (e.k === 'round') {
        this.schedule(300, () => this.sfx.horn(false, e.w !== youId));
      } else if (e.k === 'match') {
        this.schedule(700, () => this.sfx.horn(true, e.w !== youId));
      }
    }
  }

  // ---------------------------------------------------------------- Debug

  /** Nur zum Testen (mit ?debug): loest Effekte aus, als haette der Server das Ereignis geschickt. */
  debugEvents(kind: 'hit' | 'block' | 'parry' | 'break', zone = 1): void {
    if (!this.self || !this.opp) return;
    const me = this.self.id;
    const other = this.opp.id;
    const ev: NetEvent[] =
      kind === 'hit'
        ? [{ k: 'hit', a: me, d: other, z: zone, dmg: 20 }]
        : kind === 'block'
          ? [{ k: 'block', a: me, d: other }]
          : kind === 'parry'
            ? [{ k: 'parry', a: me, d: other }]
            : [{ k: 'break', d: other }];
    this.dispatchEvents(ev, me);
  }

  debugInfo(): unknown {
    return {
      mode: this.mode,
      lockOn: this.lockOn,
      camYaw: this.camYaw,
      pred: this.self ? { ...this.self.pred } : null,
      pending: this.self?.pending.length ?? 0,
      canAct: this.canAct,
      selDir: this.selDir,
      atkHeld: this.atkHeld,
      blkHeld: this.blkHeld,
      opp: this.opp ? { x: this.opp.lastX, z: this.opp.lastZ, snaps: this.opp.snaps.length } : null,
    };
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
