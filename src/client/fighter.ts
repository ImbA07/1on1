import * as THREE from 'three';
import { FighterAnimator } from './gfx/fighter-anim.js';
import { getFighterMaterials } from './gfx/fighter-materials.js';
import { FighterMeshBuilder } from './gfx/fighter-mesh.js';
import { ARMOR_GROUPS, buildFighterModel, type ArmorGroup, type ArmorTier } from './gfx/fighter-model.js';
import { BONE_NAMES, createRig, type BoneName, type Rig } from './gfx/fighter-rig.js';
import { SecondarySim } from './gfx/fighter-sim.js';
import { buildSword } from './gfx/fighter-weapon.js';

// Kaempfer-Figur: prozedural gebautes Low-Poly-Modell mit Skelett.
// Blickt in Richtung -Z (rotation.y = yaw), Fuesse bei y = 0, ca. 1,85 m gross.
//
// Aufbau:
//  - bones: benannte Gelenke (hips, spine, chest, neck, head, shoulder/upperArm/forearm/hand
//    L+R, thigh/shin/foot/toe L+R) fuer spaetere Angriffs-/Block-Animationen
//  - armor: je Ruestungsgruppe ein Objekt (body, helmet, torso, shoulders, arms, legs, tabard, cape)
//  - weaponMount (rechte Hand) und shieldMount (linker Unterarm)
//  - setArmorTier('light' | 'medium' | 'heavy'), Standard 'heavy'

export type { ArmorTier, ArmorGroup, BoneName };

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

  private readonly rig: Rig;
  private readonly skeleton: THREE.Skeleton;
  private readonly animator: FighterAnimator;
  private readonly sim: SecondarySim;
  private readonly tierMeshes = new Map<ArmorTier, THREE.Mesh[]>();
  private readonly weapon: THREE.Group;
  private tier: ArmorTier | null = null;
  private disposed = false;

  constructor(private readonly accent: number) {
    this.root.name = 'fighter';
    this.rig = createRig();
    this.root.add(this.rig.rootBone);
    this.root.updateMatrixWorld(true);
    this.skeleton = new THREE.Skeleton(this.rig.list);

    const bones = {} as Record<BoneName, THREE.Bone>;
    for (const n of BONE_NAMES) bones[n] = this.rig.bones[n]!;
    this.bones = bones;

    const armor = {} as Record<ArmorGroup, THREE.Group>;
    for (const g of ARMOR_GROUPS) {
      const grp = new THREE.Group();
      grp.name = 'armor-' + g;
      this.root.add(grp);
      armor[g] = grp;
    }
    this.armor = armor;

    // Waffenhalterung in der rechten Faust (Griff laeuft quer durch die Faust)
    this.weaponMount.name = 'weaponMount';
    this.weaponMount.position.set(-0.004, -0.072, 0);
    this.weaponMount.rotation.set(-0.5, 0, 0);
    bones.handR.add(this.weaponMount);
    // Schildhalterung aussen am linken Unterarm (Schild zeigt nach aussen/-X)
    this.shieldMount.name = 'shieldMount';
    this.shieldMount.position.set(-0.07, -0.14, 0);
    bones.forearmL.add(this.shieldMount);

    this.weapon = buildSword(getFighterMaterials());
    this.weaponMount.add(this.weapon);

    this.animator = new FighterAnimator(this.rig);
    this.sim = new SecondarySim(this.rig);
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

  setPosition(x: number, z: number, yaw: number): void {
    this.root.position.set(x, 0, z);
    this.root.rotation.y = yaw;
  }

  /** vx/vz: Geschwindigkeit in der Welt (Meter pro Sekunde). */
  animate(dt: number, vx: number, vz: number, yaw: number, sprinting: boolean): void {
    if (this.disposed) return;
    this.animator.update(dt, vx, vz, yaw, sprinting);
    this.root.updateMatrixWorld(true);
    this.sim.update(dt, this.root);
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
    this.tierMeshes.clear();
  }
}

export { angleLerp };
