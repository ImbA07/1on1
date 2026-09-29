import * as THREE from 'three';
import { Buckets, fbm, part, smoothstep, boxB, mat, type Rand } from './arena-common.js';
import { GLSL_NOISE, sharedUniforms } from './arena-materials.js';
import type { MoodDef } from './arena-moods.js';

// Himmel (Shader mit ziehenden Wolken), Umgebungslicht, Landschaft, Wald, ferne Burg, Kraehen.

export function sunDirection(mood: MoodDef): THREE.Vector3 {
  const el = THREE.MathUtils.degToRad(mood.sunElevation);
  const az = THREE.MathUtils.degToRad(mood.sunAzimuth);
  return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).normalize();
}

export function buildSky(mood: MoodDef, sunDir: THREE.Vector3): THREE.Mesh {
  const geo = new THREE.SphereGeometry(460, 48, 24);
  const matl = new THREE.ShaderMaterial({
    uniforms: {
      uTime: sharedUniforms.uTime,
      uTop: { value: new THREE.Color(mood.skyTop) },
      uHor: { value: new THREE.Color(mood.skyHorizon) },
      uGround: { value: new THREE.Color(mood.skyGround) },
      uFog: { value: new THREE.Color(mood.fogColor) },
      uSunDir: { value: sunDir.clone() },
      uSunCol: { value: new THREE.Color(mood.sunColor) },
      uCloudLit: { value: new THREE.Color(mood.cloudLit) },
      uCloudDark: { value: new THREE.Color(mood.cloudDark) },
      uCover: { value: mood.cloudCover },
      uSpeed: { value: mood.cloudSpeed },
      uGlow: { value: mood.sunGlow },
      uDisk: { value: mood.sunDisk },
      uStars: { value: mood.stars },
      uHaze: { value: Math.min(1, 0.55 + mood.fogDensity * 20) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uCover, uSpeed, uGlow, uDisk, uStars, uHaze;
      uniform vec3 uTop, uHor, uGround, uFog, uSunDir, uSunCol, uCloudLit, uCloudDark;
      varying vec3 vDir;
      ${GLSL_NOISE}
      float fbm5(vec2 p){ float s = 0.0; float a = 0.5; for (int i = 0; i < 4; i++) { s += a * aNoise(p); p = p * 2.07 + 5.3; a *= 0.5; } return s / 0.9375; }
      float fbm2(vec2 p){ return (aNoise(p) * 0.5 + aNoise(p * 2.07 + 5.3) * 0.25) / 0.75; }
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 col = h > 0.0 ? mix(uHor, uTop, pow(h, 0.5)) : uGround;
        float sd = max(dot(d, uSunDir), 0.0);
        col += uSunCol * (pow(sd, 5.0) * uGlow * 0.5 + pow(sd, 48.0) * uGlow * 0.6);
        col += uSunCol * smoothstep(0.99955, 0.9998, sd) * uDisk;
        if (uStars > 0.0 && h > 0.02) {
          vec3 sp = d * 220.0;
          vec2 cellp = floor(sp.xz / (h + 0.4));
          float s = aHash(cellp + floor(sp.y));
          float tw = 0.6 + 0.4 * sin(uTime * 2.0 + s * 90.0);
          col += vec3(0.8, 0.86, 1.0) * step(0.996, s) * uStars * tw * smoothstep(0.02, 0.3, h) * 0.9;
        }
        if (h > 0.0) {
          vec2 uv = d.xz / (h + 0.15) * 1.1 + vec2(uTime * uSpeed, uTime * uSpeed * 0.35);
          float n = fbm5(uv * 1.3);
          float n2 = fbm2(uv * 1.3 + uSunDir.xz * 0.12);
          float cov = smoothstep(1.0 - uCover - 0.16, 1.0 - uCover + 0.3, n);
          float lit = clamp(0.55 + (n - n2) * 3.5, 0.0, 1.0);
          float thick = smoothstep(0.4, 0.95, n);
          vec3 cc = mix(uCloudLit, uCloudDark, clamp(thick * 0.85 - lit * 0.35 + 0.2, 0.0, 1.0));
          cc += uSunCol * pow(sd, 6.0) * uGlow * 0.55 * (1.0 - thick * 0.6);
          float fade = smoothstep(0.0, 0.2, h);
          col = mix(col, cc, cov * fade * 0.97);
        }
        float haze = 1.0 - smoothstep(0.0, 0.25, h);
        col = mix(col, uFog, haze * uHaze);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const mesh = new THREE.Mesh(geo, matl);
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;
  return mesh;
}

/** Kleine Wuerfel-Umgebung aus dem Himmelsverlauf: weiches Himmelslicht und Spiegelung in Pfuetzen. */
export function buildEnvironment(mood: MoodDef, sunDir: THREE.Vector3): THREE.CubeTexture {
  const S = 32;
  const top = new THREE.Color(mood.skyTop);
  const hor = new THREE.Color(mood.skyHorizon);
  const gnd = new THREE.Color(mood.skyGround);
  const cloud = new THREE.Color(mood.cloudLit).lerp(new THREE.Color(mood.cloudDark), 0.2);
  const sun = new THREE.Color(mood.sunColor);
  const c = new THREE.Color();
  const d = new THREE.Vector3();
  const faces: HTMLCanvasElement[] = [];
  for (let f = 0; f < 6; f++) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = S;
    const g = cv.getContext('2d')!;
    const img = g.createImageData(S, S);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const u = ((x + 0.5) / S) * 2 - 1;
        const v = ((y + 0.5) / S) * 2 - 1;
        if (f === 0) d.set(1, -v, -u);
        else if (f === 1) d.set(-1, -v, u);
        else if (f === 2) d.set(u, 1, v);
        else if (f === 3) d.set(u, -1, -v);
        else if (f === 4) d.set(u, -v, 1);
        else d.set(-u, -v, -1);
        d.normalize();
        d.x = -d.x; // three spiegelt Wuerfeltexturen in x
        const h = d.y;
        if (h >= 0) {
          c.copy(hor).lerp(top, Math.pow(h, 0.5));
          c.lerp(cloud, Math.min(1, mood.cloudCover * 1.1) * smoothstep(0, 0.3, h));
        } else {
          c.copy(hor).lerp(gnd, smoothstep(0, 0.25, -h));
        }
        const sd = Math.max(0, d.dot(sunDir));
        const glow = Math.pow(sd, 5) * mood.sunGlow * 0.6 + Math.pow(sd, 32) * mood.sunGlow;
        c.r += sun.r * glow;
        c.g += sun.g * glow;
        c.b += sun.b * glow;
        const o = (y * S + x) * 4;
        const hex = c.getHex();
        img.data[o] = (hex >> 16) & 255;
        img.data[o + 1] = (hex >> 8) & 255;
        img.data[o + 2] = hex & 255;
        img.data[o + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    faces.push(cv);
  }
  const tex = new THREE.CubeTexture(faces);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

// ------------------------------------------------------------------ Landschaft

function terrainHeight(x: number, z: number): number {
  const r = Math.hypot(x, z);
  const a = Math.atan2(x, z);
  let h = (fbm(x * 0.03, z * 0.03, 3, 3) - 0.4) * 2.5 * smoothstep(18, 40, r);
  const hills = fbm(x * 0.011 + 3, z * 0.011, 5, 4);
  h += smoothstep(45, 110, r) * Math.pow(hills, 1.5) * 70;
  const mount = fbm(x * 0.005 - 7, z * 0.005 + 2, 9, 5);
  const ridge = 1 - Math.abs(fbm(x * 0.009, z * 0.009, 13, 3) * 2 - 1);
  h += smoothstep(170, 330, r) * (mount * 150 + ridge * 55);
  // Weg aus dem Tor (-Z) flacher
  const da = Math.abs(Math.atan2(Math.sin(a - Math.PI), Math.cos(a - Math.PI)));
  const lateral = da * r;
  h *= 1 - Math.exp(-Math.pow(lateral / 9, 2)) * (1 - smoothstep(60, 140, r)) * 0.85;
  // Burgberg der fernen Burg
  const cx = Math.sin(CASTLE_A) * CASTLE_R;
  const cz = Math.cos(CASTLE_A) * CASTLE_R;
  const dc = Math.hypot(x - cx, z - cz);
  h = Math.max(h, 92 * (1 - smoothstep(14, 85, dc)) + h * smoothstep(14, 85, dc));
  return h - 0.3;
}

const CASTLE_A = Math.PI + 0.36;
const CASTLE_R = 240;

export function buildLandscape(rand: Rand): THREE.Group {
  const group = new THREE.Group();
  const rings = 44;
  const segs = 128;
  const radius = (i: number) => 16.2 + (440 - 16.2) * Math.pow(i / rings, 1.75);
  const pos: number[] = [];
  const col: number[] = [];
  const cGrass = new THREE.Color(0x56643a);
  const cDry = new THREE.Color(0x7c7548);
  const cDark = new THREE.Color(0x3c4a2e);
  const cRock = new THREE.Color(0x6d6a64);
  const cSnow = new THREE.Color(0xdde2e6);
  const cRoad = new THREE.Color(0x6e5e48);
  const cc = new THREE.Color();
  const vtx = (i: number, j: number): [number, number, number] => {
    const r = radius(i);
    const a = (j / segs) * Math.PI * 2 + (i % 2) * (Math.PI / segs);
    const x = Math.sin(a) * r;
    const z = Math.cos(a) * r;
    return [x, terrainHeight(x, z), z];
  };
  const grid: Array<Array<[number, number, number]>> = [];
  for (let i = 0; i <= rings; i++) {
    const row: Array<[number, number, number]> = [];
    for (let j = 0; j <= segs; j++) row.push(vtx(i, j % segs));
    grid.push(row);
  }
  const tri = (p: [number, number, number], q: [number, number, number], s: [number, number, number]) => {
    pos.push(...p, ...q, ...s);
    const cx = (p[0] + q[0] + s[0]) / 3;
    const cy = (p[1] + q[1] + s[1]) / 3;
    const cz = (p[2] + q[2] + s[2]) / 3;
    // Steigung
    const ux = q[0] - p[0], uy = q[1] - p[1], uz = q[2] - p[2];
    const vx = s[0] - p[0], vy = s[1] - p[1], vz = s[2] - p[2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const slope = 1 - Math.abs(ny) / Math.hypot(nx, ny, nz);
    const n = fbm(cx * 0.02, cz * 0.02, 21, 3);
    cc.copy(cGrass).lerp(cDry, smoothstep(0.45, 0.75, n)).lerp(cDark, smoothstep(0.5, 0.2, n) * 0.7);
    cc.lerp(cRock, smoothstep(0.25, 0.5, slope) * 0.9 + smoothstep(60, 110, cy) * 0.6);
    cc.lerp(cSnow, smoothstep(125, 150, cy + n * 30) * 0.95);
    const r = Math.hypot(cx, cz);
    const a = Math.atan2(cx, cz);
    const da = Math.abs(Math.atan2(Math.sin(a - Math.PI), Math.cos(a - Math.PI)));
    if (da * r < 2.4 && r < 150) cc.copy(cRoad);
    cc.multiplyScalar(0.9 + rand() * 0.16);
    for (let k = 0; k < 3; k++) col.push(cc.r, cc.g, cc.b);
  };
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segs; j++) {
      const a = grid[i]![j]!;
      const b = grid[i]![j + 1]!;
      const c = grid[i + 1]![j]!;
      const d = grid[i + 1]![j + 1]!;
      tri(a, c, b);
      tri(b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const terrain = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1, metalness: 0 }),
  );
  terrain.receiveShadow = true;
  group.add(terrain);

  group.add(buildForest(rand));
  group.add(buildDistantCastle(terrain.material as THREE.MeshStandardMaterial));
  return group;
}

function buildForest(rand: Rand): THREE.Group {
  const b = new Buckets();
  const dark = 0x2f3f28;
  b.add('t', part(new THREE.CylinderGeometry(0.25, 0.35, 2.4, 5), mat(0, 1.2, 0), { color: 0x4a3626, uv: 'none' }));
  const tiers: Array<[number, number, number]> = [
    [2.6, 4.6, 2.0],
    [2.0, 3.8, 4.4],
    [1.3, 3.2, 6.6],
  ];
  tiers.forEach(([r, h, y], k) => {
    b.add('t', part(new THREE.ConeGeometry(r, h, 6), mat(0, y + h / 2, 0, k * 0.4), { color: new THREE.Color(dark).multiplyScalar(1 + k * 0.12), uv: 'none' }));
  });
  const geo = b.merged('t')!;
  geo.deleteAttribute('uv');
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 });
  const spots: THREE.Matrix4[] = [];
  const colors: THREE.Color[] = [];
  let tries = 0;
  while (spots.length < 900 && tries < 20000) {
    tries++;
    const a = rand() * Math.PI * 2;
    const r = 75 + Math.pow(rand(), 0.8) * 210;
    const x = Math.sin(a) * r;
    const z = Math.cos(a) * r;
    const forest = fbm(x * 0.018 + 50, z * 0.018, 31, 3);
    if (forest < 0.5 - smoothstep(60, 140, r) * 0.08) continue;
    const da = Math.abs(Math.atan2(Math.sin(a - Math.PI), Math.cos(a - Math.PI)));
    if (da * r < 7 && r < 160) continue;
    const dc = Math.hypot(x - Math.sin(CASTLE_A) * CASTLE_R, z - Math.cos(CASTLE_A) * CASTLE_R);
    if (dc < 24) continue;
    const h = terrainHeight(x, z);
    if (h > 110) continue;
    const s = 0.6 + rand() * 0.5 + smoothstep(90, 250, r) * 0.5;
    spots.push(mat(x, h - 0.4, z, rand() * 6, 0, 0, s, s * (0.85 + rand() * 0.4), s));
    colors.push(new THREE.Color().setHSL(0.24 + rand() * 0.08, 0.25 + rand() * 0.2, 0.55 + rand() * 0.35));
  }
  // Jeder vierte Baum wird ein Laubbaum (runde Krone)
  const lb = new Buckets();
  lb.add('l', part(new THREE.CylinderGeometry(0.3, 0.45, 3.2, 5), mat(0, 1.6, 0), { color: 0x4a3626, uv: 'none' }));
  lb.add('l', part(new THREE.IcosahedronGeometry(3.0, 0), mat(0, 5.2, 0, 0.3, 0, 0, 1, 0.85, 1), { color: 0x3e5230, uv: 'none' }));
  lb.add('l', part(new THREE.IcosahedronGeometry(2.1, 0), mat(1.6, 4.3, 0.8, 1.1), { color: 0x455a34, uv: 'none' }));
  const lgeo = lb.merged('l')!;
  lgeo.deleteAttribute('uv');
  const needle: number[] = [];
  const leaf: number[] = [];
  spots.forEach((_, i) => ((i % 4 === 3 ? leaf : needle).push(i)));
  const g = new THREE.Group();
  for (const [ids, gg] of [
    [needle, geo],
    [leaf, lgeo],
  ] as Array<[number[], THREE.BufferGeometry]>) {
    const inst = new THREE.InstancedMesh(gg, m, ids.length);
    ids.forEach((id, k) => {
      inst.setMatrixAt(k, spots[id]!);
      inst.setColorAt(k, colors[id]!);
    });
    inst.instanceMatrix.needsUpdate = true;
    inst.computeBoundingSphere();
    g.add(inst);
  }
  return g;
}

function buildDistantCastle(material: THREE.Material): THREE.Mesh {
  const b = new Buckets();
  const cx = Math.sin(CASTLE_A) * CASTLE_R;
  const cz = Math.cos(CASTLE_A) * CASTLE_R;
  const base = terrainHeight(cx, cz) - 1;
  const stone = 0xa29d94;
  const roof = 0x5a3a36;
  const add = (g: THREE.BufferGeometry, x: number, y: number, z: number, color: number, ry = 0) =>
    b.add('c', part(g, mat(cx + x, base + y, cz + z, ry), { color, uv: 'none' }));
  // Ringmauer
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const r = 13;
    add(boxB(8.6, 7, 1.6), Math.sin(a) * r, 0, Math.cos(a) * r, stone, a);
    add(new THREE.CylinderGeometry(2, 2.2, 11, 7), Math.sin(a + 0.31) * 13.3, 5.5, Math.cos(a + 0.31) * 13.3, stone);
    add(new THREE.ConeGeometry(2.6, 4, 7), Math.sin(a + 0.31) * 13.3, 13, Math.cos(a + 0.31) * 13.3, roof);
  }
  add(boxB(9, 26, 9), 0, 0, 0, stone, 0.3);
  add(new THREE.ConeGeometry(7.2, 8, 4), 0, 30, 0, roof, 0.3 + Math.PI / 4);
  add(boxB(14, 13, 7), 4, 0, -5, stone, 0.2);
  add(new THREE.CylinderGeometry(0.01, 5.2, 5, 4), 4, 15.5, -5, roof, 0.2 + Math.PI / 4);
  add(new THREE.CylinderGeometry(2.5, 2.5, 30, 8), -6, 15, 4, stone);
  add(new THREE.ConeGeometry(3.2, 7, 8), -6, 33.5, 4, roof);
  const geo = b.merged('c')!;
  const mesh = new THREE.Mesh(geo, material);
  return mesh;
}

// ------------------------------------------------------------------ Kraehen

export interface Crows {
  mesh: THREE.InstancedMesh;
  update(t: number): void;
}

export function buildCrows(rand: Rand, count = 9): Crows {
  const g = new THREE.BufferGeometry();
  // Koerper + zwei Fluegel (Spannweite ~0.9 m); aWing = Abstand zur Mitte fuer das Schlagen
  const p = [
    // Fluegel links
    0, 0, 0.12, -0.45, 0, -0.05, 0, 0, -0.12,
    // Fluegel rechts
    0, 0, 0.12, 0, 0, -0.12, 0.45, 0, -0.05,
    // Koerper
    0, 0.03, 0.28, -0.05, 0, -0.1, 0.05, 0, -0.1,
    0, 0, -0.1, -0.08, 0, -0.32, 0.08, 0, -0.32,
  ];
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.computeVertexNormals();
  const phases = new Float32Array(count);
  for (let i = 0; i < count; i++) phases[i] = rand() * 10;
  g.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));
  const m = new THREE.MeshBasicMaterial({ color: 0x14151a, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = sharedUniforms.uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aPhase;\nuniform float uTime;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float flap = sin(uTime * 7.0 + aPhase * 3.0) * step(0.5, fract(uTime * 0.13 + aPhase));
        transformed.y += flap * abs(transformed.x) * 0.9;`,
      );
  };
  m.customProgramCacheKey = () => 'arena-crow';
  const mesh = new THREE.InstancedMesh(g, m, count);
  mesh.frustumCulled = false;
  const params = Array.from({ length: count }, () => ({
    r: 22 + rand() * 40,
    h: 24 + rand() * 18,
    speed: (0.1 + rand() * 0.08) * (rand() < 0.3 ? -1 : 1),
    off: rand() * Math.PI * 2,
    cx: (rand() - 0.5) * 30,
    cz: (rand() - 0.5) * 30,
    scale: 0.9 + rand() * 0.5,
  }));
  const o = new THREE.Object3D();
  return {
    mesh,
    update(t: number) {
      for (let i = 0; i < count; i++) {
        const q = params[i]!;
        const a = t * q.speed + q.off;
        o.position.set(q.cx + Math.sin(a) * q.r, q.h + Math.sin(t * 0.3 + q.off) * 2, q.cz + Math.cos(a) * q.r);
        o.rotation.set(0, a + (q.speed > 0 ? Math.PI / 2 : -Math.PI / 2), q.speed > 0 ? -0.25 : 0.25, 'YXZ');
        o.scale.setScalar(q.scale);
        o.updateMatrix();
        mesh.setMatrixAt(i, o.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}

