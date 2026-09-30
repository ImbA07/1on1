import * as THREE from 'three';
import { FighterAnimator } from './gfx/fighter-anim.js';
import { CombatLayer, newCombatPose, type CombatPose } from './gfx/fighter-combat.js';
import { getFighterMaterials } from './gfx/fighter-materials.js';
import { FighterMeshBuilder } from './gfx/fighter-mesh.js';
import { ARMOR_GROUPS, buildFighterModel, type ArmorGroup, type ArmorTier } from './gfx/fighter-model.js';
import { MOUNT_POS, MOUNT_ROT_X } from './gfx/fighter-hand.js';
import { BONE_NAMES, createRig, FINGER_BONE_NAMES, type BoneName, type Rig } from './gfx/fighter-rig.js';
import { buildShield, shieldMountQuaternion } from './gfx/fighter-shield.js';
import { SwordTrail } from './gfx/fighter-trail.js';
import { SecondarySim } from './gfx/fighter-sim.js';
import { buildSword } from './gfx/fighter-weapon.js';

// Kaempfer-Figur: prozedural gebautes Low-Poly-Modell mit Skelett.
// Blickt in Richtung -Z (rotation.y = yaw), Fuesse bei y = 0, ca. 1,85 m gross.
//
// Aufbau:
//  - bones: benannte Gelenke (hips, spine, chest, neck, head, shoulder/upperArm/forearm/hand
//    L+R, thigh/shin/foot/toe L+R, Finger thumb/index/middle/ring/pinky 1..3 L+R)
//    fuer spaetere Angriffs-/Block-Animationen
//  - armor: je Ruestungsgruppe ein Objekt (body, helmet, torso, shoulders, arms, legs, tabard, cape)
//  - weaponMount (rechte Hand) und shieldMount (linker Unterarm)
//  - setArmorTier('light' | 'medium' | 'heavy'), Standard 'heavy'
//  - setWeapon('swordShield' | 'sword'), Standard 'swordShield'
//  - setCombat(pose): Kampfzustand pro Bild (vor animate) -> Ausholen, Schlag, Block, Taumeln, Knien

export type { ArmorTier, ArmorGroup, BoneName, CombatPose };

/** Waffen-Ausruestung der Figur (Schild gehoert zur Waffe, nicht zur Ruestung). */
export type WeaponId = 'swordShield' | 'sword';

/** Art einer Trefferreaktion fuer playImpact. */
export type ImpactKind = 'hit' | 'block' | 'parry' | 'break' | 'down' | 'revive';

export interface ImpactInfo {
  /** Trefferzone bei 'hit': 0 Kopf, 1 Torso, 2 Arm, 3 Bein */
  zone?: number;
  /** Richtung des Stosses in der Welt (normiert), also weg vom Angreifer */
  dirX?: number;
  dirZ?: number;
  /** starker Treffer (Todesstoss, Kopf) */
  heavy?: boolean;
}

function angleLerp(a: number, b: number, t: number): number {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + d * t;
}

export class Fighter {
  readonly root = new THREE.Group();
  readonly bones: Readonly<Record<BoneName, THREE.Bone>>;
  readonly weaponMount = new THREE.Group();
  readonly shieldMount = new THREE.Group();
  readonly armor: Readonly<Record<ArmorGroup, THREE.Group>>;
  /**
   * Effekte in Weltkoordinaten (Klingenspur). Das Spiel haengt dieses Objekt neben `root`
   * in die Szene; dispose() entfernt und leert es.
   */
  readonly worldFx = new THREE.Group();

  private readonly rig: Rig;
  private readonly skeleton: THREE.Skeleton;
  private readonly animator: FighterAnimator;
  private readonly sim: SecondarySim;
  private readonly combat: CombatLayer;
  private readonly shield: THREE.Group;
  private weaponId: WeaponId = 'swordShield';
  private readonly _imp = new THREE.Vector3();
  private readonly trail: SwordTrail;
  private readonly lastPos = new THREE.Vector3();
  private hasLastPos = false;
  private readonly _tb = new THREE.Vector3();
  private readonly _tt = new THREE.Vector3();
  private readonly tierMeshes = new Map<ArmorTier, THREE.Mesh[]>();
  private readonly sword: THREE.Group;
  private tier: ArmorTier | null = null;
  private disposed = false;

  constructor(private readonly accent: number) {
    this.root.name = 'fighter';
    this.rig = createRig();
    this.root.add(this.rig.rootBone);
    this.root.updateMatrixWorld(true);
    this.skeleton = new THREE.Skeleton(this.rig.list);

    const bones = {} as Record<BoneName, THREE.Bone>;
    for (const n of [...BONE_NAMES, ...FINGER_BONE_NAMES]) bones[n] = this.rig.bones[n]!;
    this.bones = bones;

    const armor = {} as Record<ArmorGroup, THREE.Group>;
    for (const g of ARMOR_GROUPS) {
      const grp = new THREE.Group();
      grp.name = 'armor-' + g;
      this.root.add(grp);
      armor[g] = grp;
    }
    this.armor = armor;

    // Waffenhalterung in der rechten Hand: Griffachse = lokale Z-Achse (Klinge nach -Z),
    // liegt schraeg vor der Handflaeche; die Finger schliessen sich darum (siehe fighter-hand.ts)
    this.weaponMount.name = 'weaponMount';
    this.weaponMount.position.copy(MOUNT_POS);
    this.weaponMount.rotation.set(MOUNT_ROT_X, 0, 0);
    bones.handR.add(this.weaponMount);
    // Schildhalterung aussen am linken Unterarm. Achsen der Halterung: +Z = Schild-Vorderseite
    // (vom Unterarm weg, Handrueckenseite), +Y = Schild oben (quer zum Unterarm).
    this.shieldMount.name = 'shieldMount';
    this.shieldMount.position.set(-0.07, -0.14, 0);
    shieldMountQuaternion(this.shieldMount.quaternion);
    bones.forearmL.add(this.shieldMount);
    this.shield = buildShield(getFighterMaterials(), accent);
    this.shieldMount.add(this.shield);

    this.sword = buildSword(getFighterMaterials());
    this.weaponMount.add(this.sword);
    this.worldFx.name = 'fighterWorldFx';
    this.trail = new SwordTrail(accent);
    this.worldFx.add(this.trail.mesh);

    this.animator = new FighterAnimator(this.rig);
    this.sim = new SecondarySim(this.rig);
    this.combat = new CombatLayer(this.rig, this.animator);
    this.setArmorTier('heavy');
    // Erste Pose sofort setzen, damit die Figur nie in der Ruhelage aufblitzt
    this.animator.update(1 / 60, 0, 0, 0, false);
    this.animator.resetYaw();
  }

  get armorTier(): ArmorTier {
    return this.tier ?? 'heavy';
  }

  /** Ruestungsstufe wechseln. Meshes werden beim ersten Gebrauch gebaut und behalten. */
  setArmorTier(tier: ArmorTier): void {
    if (this.disposed || tier === this.tier) return;
    if (this.tier) for (const m of this.tierMeshes.get(this.tier) ?? []) m.visible = false;
    let meshes = this.tierMeshes.get(tier);
    if (!meshes) {
      const b = new FighterMeshBuilder(this.rig.index, 1000 + (this.accent & 0xffff));
      buildFighterModel(b, this.accent, tier);
      const built = b.build(getFighterMaterials(), this.skeleton);
      meshes = [];
      for (const [group, list] of built) {
        const parent = this.armor[group as ArmorGroup] ?? this.root;
        for (const m of list) {
          parent.add(m);
          meshes.push(m);
        }
      }
      this.tierMeshes.set(tier, meshes);
    }
    for (const m of meshes) m.visible = true;
    this.tier = tier;
  }

  get weapon(): WeaponId {
    return this.weaponId;
  }

  /** Waffe wechseln: 'swordShield' zeigt das Schild am linken Unterarm. */
  setWeapon(id: WeaponId): void {
    this.weaponId = id;
    this.shield.visible = id === 'swordShield';
    this.combat.shield = id === 'swordShield';
  }

  /**
   * Kampfzustand fuer dieses Bild setzen (vor animate). Fehlende Felder behalten ihren Wert.
   * Siehe CombatPose (act, dir, actT, tickFrac, need, staggerT, down, ...).
   */
  setCombat(c: Partial<CombatPose>): void {
    Object.assign(this.combat.pose, c);
  }

  /**
   * Trefferreaktion abspielen (kurzer, additiver Stoss ueber der laufenden Pose).
   *  'hit'    Treffer (info.zone, info.dirX/dirZ Stossrichtung in der Welt, info.heavy)
   *  'block'  Schild faengt ab, federt zurueck
   *  'parry'  fuer den ANGREIFER: Waffenarm wird aufgerissen, Oberkoerper kippt weg
   *  'break'  Block durchbrochen: Schild und Arme werden aufgerissen
   *  'down'   Kollaps aufs Knie
   *  'revive' wieder hoch
   */
  playImpact(kind: ImpactKind, info: ImpactInfo = {}): void {
    if (this.disposed) return;
    // Weltrichtung in den Figurenraum (+Z = hinten, +X = rechts)
    const yaw = this.root.rotation.y;
    let wx = info.dirX ?? 0;
    let wz = info.dirZ ?? 0;
    if (wx === 0 && wz === 0) {
      // ohne Angabe: nach hinten
      wx = Math.sin(yaw);
      wz = Math.cos(yaw);
    }
    const px = wx * Math.cos(yaw) - wz * Math.sin(yaw);
    const pz = wx * Math.sin(yaw) + wz * Math.cos(yaw);
    this.combat.impact(kind, px, pz, info.zone ?? 1, info.heavy === true);
  }

  setPosition(x: number, z: number, yaw: number): void {
    this.root.position.set(x, 0, z);
    this.root.rotation.y = yaw;
  }

  /** vx/vz: Geschwindigkeit in der Welt (Meter pro Sekunde). */
  animate(dt: number, vx: number, vz: number, yaw: number, sprinting: boolean): void {
    if (this.disposed) return;
    // Tatsaechliche Verschiebung (inkl. Ausfallschritt/Rueckstoss) -> aufgesetzte Fuesse
    const p = this.root.position;
    if (this.hasLastPos) {
      const dx = p.x - this.lastPos.x;
      const dz = p.z - this.lastPos.z;
      if (dx * dx + dz * dz < 1) {
        const ry = this.root.rotation.y;
        this.animator.setRootDelta(dx * Math.cos(ry) - dz * Math.sin(ry), dx * Math.sin(ry) + dz * Math.cos(ry));
      } else {
        this.trail.clear(); // Sprung (neue Runde)
      }
    }
    this.lastPos.copy(p);
    this.hasLastPos = true;

    this.combat.pre(dt);
    // Ausfallschritt/Rueckstoss sind keine Laufschritte: Gangzyklus waehrenddessen gedaempft
    const damp = 1 - this.combat.gaitDamp;
    this.animator.update(dt, vx * damp, vz * damp, yaw, sprinting);
    this.combat.post();
    this.root.updateMatrixWorld(true);
    this.sim.update(dt, this.root);

    // Klingenspur (Weltraum): Klingenmitte und Spitze
    this._tb.set(0, 0, -0.33).applyMatrix4(this.sword.matrixWorld);
    this._tt.set(0, 0, -0.87).applyMatrix4(this.sword.matrixWorld);
    this.trail.update(dt > 0 ? Math.min(dt, 0.1) : 1 / 60, this._tb, this._tt, this.root.visible ? this.combat.trailStrength : 0);
    if (this.combat.hasImpulse) {
      this.combat.hasImpulse = false;
      this._imp.copy(this.combat.impulse).applyQuaternion(this.root.quaternion);
      this.sim.impulse(this._imp);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.root.removeFromParent();
    // Nur figureneigene Geometrien freigeben; Materialien/Texturen sind geteilt.
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
    this.skeleton.dispose();
    this.trail.dispose();
    this.worldFx.removeFromParent();
    this.worldFx.clear();
    this.tierMeshes.clear();
  }
}

export { angleLerp, newCombatPose };
