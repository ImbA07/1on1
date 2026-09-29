import * as THREE from 'three';
import { Buckets, WALL_INNER, mulberry32, part } from './gfx/arena-common.js';
import { MOODS, ARENA_MOODS, type ArenaMood } from './gfx/arena-moods.js';
import { clothMaterial, packedMaterial, sharedUniforms } from './gfx/arena-materials.js';
import {
  bannerAtlas,
  cobbleTexture,
  groundMask,
  ivyTexture,
  roofTexture,
  stoneTexture,
  woodTexture,
} from './gfx/arena-textures.js';
import {
  TOWER_ANGLES,
  buildChapel,
  buildGatehouse,
  buildHouses,
  buildKeep,
  buildPalas,
  buildRingWall,
  buildStands,
  buildTower,
  type StructureInfo,
} from './gfx/arena-structures.js';
import { buildCloth, buildCurb, buildIvy, buildProps, buildStraw, type PropInfo } from './gfx/arena-props.js';
import { buildCrowd, buildFlames, buildParticles, buildRain, buildSmoke, type Emitter } from './gfx/arena-fx.js';
import { buildCrows, buildEnvironment, buildLandscape, buildSky, sunDirection } from './gfx/arena-sky.js';

// Burghof: prozedural gebaut. Mauern mit Steinlagen, Tuerme, Torhaus, Palas mit Zuschauern,
// Tribuene, Pflaster mit Pfuetzen, Fackeln, Banner im Wind, Wolkenhimmel, Landschaft.
// Die Spielflaeche (ARENA_RADIUS) und die Mauer-Innenkante (15 m) bleiben unveraendert.

export type { ArenaMood };
export { ARENA_MOODS };
export const CAMERA_MAX_RADIUS = WALL_INNER - 0.4;

export interface Arena {
  group: THREE.Group;
  update(time: number): void;
}

function moodFromUrl(): ArenaMood | null {
  try {
    const m = new URLSearchParams(location.search).get('mood');
    return m && (ARENA_MOODS as string[]).includes(m) ? (m as ArenaMood) : null;
  } catch {
    return null;
  }
}

export function buildArena(scene: THREE.Scene, mood?: ArenaMood): Arena {
  const moodKey = mood ?? moodFromUrl() ?? 'overcast';
  const M = MOODS[moodKey];
  const rand = mulberry32(1337);
  const group = new THREE.Group();
  group.name = 'arena';
  scene.add(group);

  // ---------------------------------------------------------------- Licht, Himmel, Nebel
  const sunDir = sunDirection(M);
  const hemi = new THREE.HemisphereLight(M.hemiSky, M.hemiGround, M.hemiIntensity);
  group.add(hemi);
  const sun = new THREE.DirectionalLight(M.sunColor, M.sunIntensity);
  sun.position.copy(sunDir).multiplyScalar(45);
  sun.target.position.set(0, 0, 0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -21;
  sc.right = 21;
  sc.top = 21;
  sc.bottom = -21;
  sc.near = 5;
  sc.far = 95;
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.025;
  group.add(sun, sun.target);

  scene.background = new THREE.Color(M.fogColor);
  scene.fog = new THREE.FogExp2(M.fogColor, M.fogDensity);
  scene.environment = buildEnvironment(M, sunDir);
  scene.environmentIntensity = M.envIntensity;
  group.add(buildSky(M, sunDir));
  sharedUniforms.uWet.value = M.wetness;
  sharedUniforms.uRain.value = M.rain;

  // ---------------------------------------------------------------- Materialien
  const cobble = cobbleTexture(3.2);
  const mask = groundMask();
  const mats = {
    stone: packedMaterial({
      kind: 'stone',
      tex: stoneTexture(3.4),
      palette: [0x918a7e, 0x817e77, 0x756b5f],
      mortar: 0x5e584e,
      moss: 0x4b5a2c,
      roughness: 0.93,
      normalScale: 1.1,
    }),
    roof: packedMaterial({
      kind: 'roof',
      tex: roofTexture(1.6),
      palette: [0xbab2a8, 0x958d86, 0x77706a],
      moss: 0x5a6038,
      roughness: 0.8,
      normalScale: 1.2,
    }),
    wood: packedMaterial({
      kind: 'wood',
      tex: woodTexture(2.0),
      palette: [0x5e4631, 0x8a6c4c, 0x7d7870],
      roughness: 0.85,
      normalScale: 0.9,
    }),
    iron: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.48, metalness: 0.7, flatShading: true }),
    generic: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, flatShading: true, side: THREE.DoubleSide }),
    cloth: clothMaterial(bannerAtlas()),
    ivy: new THREE.MeshStandardMaterial({
      map: ivyTexture(),
      vertexColors: true,
      alphaTest: 0.45,
      side: THREE.DoubleSide,
      roughness: 0.8,
    }),
    window: new THREE.MeshBasicMaterial({
      color: new THREE.Color(0x0d0b0a).lerp(new THREE.Color(0xffa24a), M.windowGlow * 0.9),
    }),
  };
  const ground = packedMaterial({
    kind: 'ground',
    tex: cobble,
    mask,
    palette: [0x7a756c, 0x6a655d, 0x6f6152],
    mortar: 0x4a4034,
    moss: 0x49542c,
    dirt: [0x5c4c3a, 0x8b775a],
    roughness: 0.95,
    normalScale: 1.15,
  });

  // ---------------------------------------------------------------- Boden
  {
    const g = new THREE.CircleGeometry(WALL_INNER + 1.2, 128);
    g.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(part(g, null, { uv: 'face' }), ground);
    mesh.receiveShadow = true;
    mesh.name = 'arena-ground';
    group.add(mesh);
  }

  // ---------------------------------------------------------------- Bauwerke und Requisiten
  const b = new Buckets();
  const info: StructureInfo = { spectators: [], torches: [], pennants: [], shields: [], banners: [], chimneys: [] };
  buildRingWall(b, rand, info);
  const pennantCells = [2, 5, 6, 4];
  TOWER_ANGLES.forEach((a, i) => buildTower(b, info, rand, a, 17.45, 2.45, 9.2 + (i % 2) * 1.2, 'roof', pennantCells[i]!));
  buildGatehouse(b, info, rand);
  buildPalas(b, info, rand);
  buildStands(b, info, rand);
  buildKeep(b, info, rand);
  buildChapel(b);
  buildHouses(b, info, rand);
  // Wachen auf dem Wehrgang
  for (const a of [-0.75, 1.55, -2.6, 2.45, -1.65]) {
    const r = WALL_INNER + 0.55;
    info.spectators.push({ x: Math.sin(a) * r, y: 4.8, z: Math.cos(a) * r, ry: a + Math.PI, kind: 1, cheer: 0 });
  }
  const propInfo: PropInfo = { fires: [], lights: [] };
  buildCurb(b, rand);
  const strawClusters = buildProps(b, rand, propInfo);
  buildStraw(b, rand, strawClusters);
  buildCloth(b, rand, info);
  buildIvy(b, rand);
  const crowd = buildCrowd(info.spectators, rand, b);

  const castKeys = new Set(['stone', 'roof', 'wood', 'iron', 'generic', 'cloth']);
  for (const key of ['stone', 'roof', 'wood', 'iron', 'generic', 'cloth', 'ivy', 'window'] as const) {
    const geo = b.merged(key);
    if (!geo) continue;
    const mesh = new THREE.Mesh(geo, mats[key]);
    mesh.name = 'arena-' + key;
    mesh.castShadow = castKeys.has(key);
    mesh.receiveShadow = key !== 'window';
    group.add(mesh);
  }
  for (const m of crowd.meshes) group.add(m);

  // ---------------------------------------------------------------- Landschaft
  group.add(buildLandscape(rand));
  const crows = buildCrows(rand, moodKey === 'night' ? 0 : 9);
  if (moodKey !== 'night') group.add(crows.mesh);

  // ---------------------------------------------------------------- Feuer
  const emitters: Emitter[] = [];
  for (const f of propInfo.fires) {
    emitters.push({ x: f.x, y: f.y, z: f.z, w: 0.62, h: 1.0, kind: 0 });
    emitters.push({ x: f.x + 0.05, y: f.y + 0.02, z: f.z, w: 0.45, h: 0.75, kind: 0 });
    emitters.push({ x: f.x, y: f.y + 0.45, z: f.z, w: 2.6, h: 2.6, kind: 1 });
  }
  for (const t of info.torches) {
    emitters.push({ x: t.x, y: t.y - 0.05, z: t.z, w: 0.22, h: 0.48, kind: 0 });
    emitters.push({ x: t.x, y: t.y + 0.18, z: t.z, w: 1.1, h: 1.1, kind: 1 });
  }
  group.add(buildFlames(emitters, M));
  for (const p of buildParticles(propInfo.fires, info.torches, M, rand)) group.add(p);
  const smokeSrc = [
    ...info.chimneys.map((c) => ({ x: c.x, y: c.y, z: c.z, s: 1.0 })),
    ...propInfo.fires.map((f) => ({ x: f.x, y: f.y + 1.1, z: f.z, s: 0.45 })),
  ];
  group.add(buildSmoke(smokeSrc, M));
  if (M.rain > 0) group.add(buildRain(rand, M.rain));

  const fireLights: THREE.PointLight[] = [];
  for (const f of propInfo.lights.slice(0, 3)) {
    const l = new THREE.PointLight(0xff9a48, M.fireIntensity, 19, 2);
    l.position.set(f.x, f.y, f.z);
    group.add(l);
    fireLights.push(l);
  }

  // Statische Teile nicht jedes Bild neu rechnen
  group.updateMatrixWorld(true);
  const base = M.fireIntensity;

  return {
    group,
    update(time: number) {
      sharedUniforms.uTime.value = time;
      for (let i = 0; i < fireLights.length; i++) {
        const f = 1 + Math.sin(time * 9.3 + i * 2.1) * 0.08 + Math.sin(time * 17.1 + i * 1.3) * 0.06 + Math.sin(time * 3.1 + i) * 0.05;
        fireLights[i]!.intensity = base * f;
      }
      crowd.update(time);
      if (moodKey !== 'night') crows.update(time);
    },
  };
}
