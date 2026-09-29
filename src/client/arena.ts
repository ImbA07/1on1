import * as THREE from 'three';
import { ARENA_RADIUS } from '../shared/sim.js';

// Burghof: Low-Poly, matt und erdig, mit bunten Akzenten (Banner).

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WALL_INNER = 15;
const WALL_THICK = 1.4;
const WALL_HEIGHT = 4.6;
export const CAMERA_MAX_RADIUS = WALL_INNER - 0.4;

const stone = (hex: number) =>
  new THREE.MeshStandardMaterial({ color: hex, flatShading: true, roughness: 0.95, metalness: 0 });

export interface Arena {
  group: THREE.Group;
  update(time: number): void;
}

export function buildArena(scene: THREE.Scene): Arena {
  const rand = mulberry32(1337);
  const group = new THREE.Group();
  scene.add(group);

  // ---- Licht: bewoelkter Tag, matt ----
  const hemi = new THREE.HemisphereLight(0xcfd6dc, 0x4a4238, 1.15);
  group.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff0d8, 1.9);
  sun.position.set(10, 20, 7);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const cam = sun.shadow.camera;
  cam.left = -20;
  cam.right = 20;
  cam.top = 20;
  cam.bottom = -20;
  cam.near = 1;
  cam.far = 60;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  group.add(sun);

  // ---- Himmel und Nebel ----
  scene.background = new THREE.Color(0xa9b0b6);
  scene.fog = new THREE.Fog(0xa9b0b6, 30, 110);
  group.add(buildSkyDome());

  // ---- Boden: Dreiecke mit leicht unterschiedlichen Farben ----
  group.add(buildGround(rand));

  // Rand der Kampffläche
  const curb = new THREE.Mesh(
    new THREE.RingGeometry(ARENA_RADIUS - 0.15, ARENA_RADIUS + 0.25, 48),
    new THREE.MeshStandardMaterial({ color: 0x3b342c, flatShading: true, roughness: 1 }),
  );
  curb.rotation.x = -Math.PI / 2;
  curb.position.y = 0.02;
  curb.receiveShadow = true;
  group.add(curb);

  // ---- Mauer mit Zinnen ----
  const wallMats = [stone(0x8a857b), stone(0x7d786e), stone(0x726d64)];
  const segments = 32;
  const segAngle = (Math.PI * 2) / segments;
  const wallR = WALL_INNER + WALL_THICK / 2;
  const segWidth = 2 * wallR * Math.tan(segAngle / 2) + 0.05;
  for (let i = 0; i < segments; i++) {
    const a = i * segAngle;
    const wall = new THREE.Mesh(
      new THREE.BoxGeometry(segWidth, WALL_HEIGHT + rand() * 0.25, WALL_THICK),
      wallMats[Math.floor(rand() * wallMats.length)]!,
    );
    wall.position.set(Math.sin(a) * wallR, wall.geometry.parameters.height / 2, Math.cos(a) * wallR);
    wall.rotation.y = a;
    wall.castShadow = true;
    wall.receiveShadow = true;
    group.add(wall);

    if (i % 2 === 0) {
      const merlon = new THREE.Mesh(new THREE.BoxGeometry(segWidth * 0.55, 0.9, WALL_THICK * 0.95), wallMats[i % 3]!);
      merlon.position.set(Math.sin(a) * wallR, WALL_HEIGHT + 0.45 + 0.12, Math.cos(a) * wallR);
      merlon.rotation.y = a;
      merlon.castShadow = true;
      merlon.receiveShadow = true;
      group.add(merlon);
    }
  }

  // ---- Tuerme an den Ecken ----
  const towerMat = stone(0x7a756b);
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x7a2a22, flatShading: true, roughness: 0.8 });
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    const r = WALL_INNER + WALL_THICK + 0.4;
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(2.3, 2.6, 8.5, 8), towerMat);
    tower.position.set(Math.sin(a) * r, 4.25, Math.cos(a) * r);
    tower.castShadow = true;
    tower.receiveShadow = true;
    group.add(tower);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(3.1, 3.2, 8), roofMat);
    roof.position.set(tower.position.x, 8.5 + 1.6, tower.position.z);
    roof.castShadow = true;
    group.add(roof);
  }

  // ---- Banner (bunte Akzente) ----
  const bannerColors = [0xb3322b, 0x2b6cb3, 0xd0a030, 0x3a8a4a];
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI * 2) / 8 + Math.PI / 8;
    const banner = buildBanner(bannerColors[i % bannerColors.length]!);
    const r = WALL_INNER - 0.06;
    banner.position.set(Math.sin(a) * r, 3.6, Math.cos(a) * r);
    banner.rotation.y = a + Math.PI; // schaut zur Mitte
    group.add(banner);
  }

  // ---- Fackeln ----
  const flames: THREE.Mesh[] = [];
  const flameMat = new THREE.MeshBasicMaterial({ color: 0xffa040 });
  const bracketMat = new THREE.MeshStandardMaterial({ color: 0x2a2622, flatShading: true, roughness: 0.6, metalness: 0.5 });
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI * 2) / 8;
    const r = WALL_INNER - 0.15;
    const torch = new THREE.Group();
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.6, 5), bracketMat);
    torch.add(stick);
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.42, 5), flameMat);
    flame.position.y = 0.5;
    torch.add(flame);
    flames.push(flame);
    torch.position.set(Math.sin(a) * r, 2.4, Math.cos(a) * r);
    group.add(torch);
    if (i % 4 === 0) {
      const light = new THREE.PointLight(0xffa050, 14, 14, 2);
      light.position.set(Math.sin(a) * (r - 0.6), 3.1, Math.cos(a) * (r - 0.6));
      group.add(light);
    }
  }

  // ---- Deko: Faesser, Kisten, Waffenstaender am Rand ----
  addProps(group, rand);

  // ---- Ferne Huegel ----
  group.add(buildHills(rand));

  return {
    group,
    update(time: number) {
      flames.forEach((f, i) => {
        const s = 1 + Math.sin(time * 9 + i * 1.7) * 0.12 + Math.sin(time * 15 + i) * 0.06;
        f.scale.set(1, s, 1);
      });
    },
  };
}

function buildSkyDome(): THREE.Mesh {
  const geo = new THREE.SphereGeometry(300, 16, 10);
  const top = new THREE.Color(0x7d8b99);
  const horizon = new THREE.Color(0xc7c9c6);
  const colors: number[] = [];
  const pos = geo.attributes.position!;
  for (let i = 0; i < pos.count; i++) {
    const t = Math.max(0, Math.min(1, pos.getY(i) / 300));
    const c = horizon.clone().lerp(top, Math.pow(t, 0.6));
    colors.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false }));
  return mesh;
}

function buildGround(rand: () => number): THREE.Mesh {
  const size = 90;
  const div = 60;
  const plane = new THREE.PlaneGeometry(size, size, div, div);
  plane.rotateX(-Math.PI / 2);
  const geo = plane.toNonIndexed();
  const pos = geo.attributes.position!;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i += 3) {
    const cx = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3;
    const cz = (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3;
    const r = Math.hypot(cx, cz);
    let base: number;
    if (r < ARENA_RADIUS) base = 0x7b766c; // Pflaster
    else if (r < WALL_INNER + 1) base = 0x5d5044; // festgetretene Erde
    else base = 0x3f4b35; // Gras ausserhalb
    c.set(base);
    const v = 0.88 + rand() * 0.24;
    c.multiplyScalar(v);
    for (let k = 0; k < 3; k++) {
      colors[(i + k) * 3] = c.r;
      colors[(i + k) * 3 + 1] = c.g;
      colors[(i + k) * 3 + 2] = c.b;
    }
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 }),
  );
  mesh.receiveShadow = true;
  return mesh;
}

function buildBanner(color: number): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.85, side: THREE.DoubleSide });
  const shape = new THREE.Shape();
  shape.moveTo(-0.55, 0);
  shape.lineTo(0.55, 0);
  shape.lineTo(0.55, -2.0);
  shape.lineTo(0, -1.6); // Schwalbenschwanz
  shape.lineTo(-0.55, -2.0);
  shape.closePath();
  const cloth = new THREE.Mesh(new THREE.ShapeGeometry(shape), mat);
  cloth.castShadow = true;
  g.add(cloth);
  const emblem = new THREE.Mesh(
    new THREE.CircleGeometry(0.22, 6),
    new THREE.MeshStandardMaterial({ color: 0xe8d9a8, flatShading: true, roughness: 0.8, side: THREE.DoubleSide }),
  );
  emblem.position.set(0, -0.6, 0.01);
  g.add(emblem);
  const rod = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.05, 1.3, 5),
    new THREE.MeshStandardMaterial({ color: 0x2a2622, roughness: 0.6, metalness: 0.4 }),
  );
  rod.rotation.z = Math.PI / 2;
  rod.position.set(0, 0.03, 0.02);
  g.add(rod);
  return g;
}

function addProps(group: THREE.Group, rand: () => number): void {
  const wood = new THREE.MeshStandardMaterial({ color: 0x6b4a2b, flatShading: true, roughness: 0.9 });
  const woodDark = new THREE.MeshStandardMaterial({ color: 0x4a3320, flatShading: true, roughness: 0.9 });
  const iron = new THREE.MeshStandardMaterial({ color: 0x33353a, flatShading: true, roughness: 0.5, metalness: 0.6 });

  const place = (angle: number, radius: number) => new THREE.Vector3(Math.sin(angle) * radius, 0, Math.cos(angle) * radius);

  // Faesser
  const barrelSpots = [0.35, 0.5, 2.2, 3.9, 5.3];
  for (const a of barrelSpots) {
    const p = place(a, WALL_INNER - 0.9 - rand() * 0.3);
    const barrel = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.95, 8), wood);
    body.position.y = 0.475;
    barrel.add(body);
    for (const y of [0.2, 0.75]) {
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.44, 0.06, 8), iron);
      ring.position.y = y;
      barrel.add(ring);
    }
    barrel.position.copy(p);
    barrel.rotation.y = rand() * Math.PI;
    barrel.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    group.add(barrel);
  }

  // Kisten
  const crateSpots = [1.2, 1.4, 4.6, 6.0];
  for (const a of crateSpots) {
    const p = place(a, WALL_INNER - 0.95);
    const s = 0.7 + rand() * 0.3;
    const crate = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), woodDark);
    crate.position.set(p.x, s / 2, p.z);
    crate.rotation.y = a + rand() * 0.4;
    crate.castShadow = true;
    crate.receiveShadow = true;
    group.add(crate);
  }

  // Waffenstaender mit Speeren
  for (const a of [2.9, 5.0]) {
    const p = place(a, WALL_INNER - 0.8);
    const rack = new THREE.Group();
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.12, 0.5), woodDark);
    base.position.y = 0.06;
    rack.add(base);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.08, 0.08), wood);
    bar.position.set(0, 0.9, 0);
    rack.add(bar);
    for (let i = -2; i <= 2; i++) {
      const spear = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 1.9, 5), wood);
      spear.position.set(i * 0.3, 0.95, 0);
      spear.rotation.z = i * 0.03;
      rack.add(spear);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.22, 4), iron);
      tip.position.set(i * 0.3 - i * 0.03 * 0.95, 1.95, 0);
      rack.add(tip);
    }
    rack.position.copy(p);
    rack.rotation.y = a + Math.PI;
    rack.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = true;
    });
    group.add(rack);
  }
}

function buildHills(rand: () => number): THREE.Group {
  const g = new THREE.Group();
  const mats = [0x4a5644, 0x3f4a3a, 0x566050].map(
    (c) => new THREE.MeshStandardMaterial({ color: c, flatShading: true, roughness: 1 }),
  );
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2 + rand() * 0.2;
    const r = 75 + rand() * 30;
    const h = 12 + rand() * 22;
    const hill = new THREE.Mesh(new THREE.ConeGeometry(14 + rand() * 12, h, 6), mats[i % mats.length]!);
    hill.position.set(Math.sin(a) * r, h / 2 - 1, Math.cos(a) * r);
    hill.rotation.y = rand() * Math.PI;
    g.add(hill);
  }
  return g;
}
