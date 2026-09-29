import * as THREE from 'three';
import { Buckets, box, boxB, mat, part, type Rand } from './arena-common.js';
import { GLSL_NOISE, sharedUniforms } from './arena-materials.js';
import type { Spectator, Spot } from './arena-structures.js';
import type { MoodDef } from './arena-moods.js';

// Feuer (Flammen, Glut, Funken, Rauch), Staub in der Luft, Zuschauer. Alles ohne Allokationen pro Bild.

const pxScale = { value: 720 };
const _size = new THREE.Vector2();
function trackViewport(obj: THREE.Object3D): void {
  obj.onBeforeRender = (renderer) => {
    renderer.getDrawingBufferSize(_size);
    pxScale.value = _size.y;
  };
}

interface Emitter {
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  kind: number; // 0 Flamme, 1 Leuchthof
}

/** Flammen als Billboards (ein Draw-Call fuer alle). */
export function buildFlames(emitters: Emitter[], mood: MoodDef): THREE.Mesh {
  const n = emitters.length;
  const pos = new Float32Array(n * 4 * 3);
  const corner = new Float32Array(n * 4 * 2);
  const size = new Float32Array(n * 4 * 3);
  const phase = new Float32Array(n * 4);
  const idx: number[] = [];
  const cs = [
    [-0.5, 0],
    [0.5, 0],
    [0.5, 1],
    [-0.5, 1],
  ];
  emitters.forEach((e, i) => {
    const ph = Math.random() * 10;
    for (let k = 0; k < 4; k++) {
      const v = i * 4 + k;
      pos.set([e.x, e.y, e.z], v * 3);
      corner.set(cs[k]!, v * 2);
      size.set([e.w, e.h, e.kind], v * 3);
      phase[v] = ph;
    }
    const o = i * 4;
    idx.push(o, o + 1, o + 2, o, o + 2, o + 3);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aCorner', new THREE.BufferAttribute(corner, 2));
  g.setAttribute('aSize', new THREE.BufferAttribute(size, 3));
  g.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  g.setIndex(idx);
  const night = mood.fireIntensity > 20 ? 1 : 0;
  const m = new THREE.ShaderMaterial({
    uniforms: {
      uTime: sharedUniforms.uTime,
      uScale: { value: mood.flameScale },
      uGlow: { value: 0.35 + night * 0.4 },
    },
    vertexShader: /* glsl */ `
      attribute vec2 aCorner;
      attribute vec3 aSize;
      attribute float aPhase;
      uniform float uTime;
      uniform float uScale;
      varying vec2 vUv;
      varying float vPhase;
      varying float vKind;
      void main() {
        vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 up = vec3(0.0, 1.0, 0.0);
        float kind = aSize.z;
        float flick = 1.0 + 0.1 * sin(uTime * 11.0 + aPhase * 7.0) + 0.07 * sin(uTime * 23.0 + aPhase * 3.0);
        vec2 sz = aSize.xy * uScale;
        vec3 wp;
        if (kind > 0.5) {
          vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
          sz *= 0.92 + 0.08 * flick;
          wp = position + right * aCorner.x * sz.x + camUp * (aCorner.y - 0.5) * sz.y;
        } else {
          sz.y *= flick;
          wp = position + right * aCorner.x * sz.x + up * aCorner.y * sz.y;
        }
        vUv = vec2(aCorner.x + 0.5, aCorner.y);
        vPhase = aPhase;
        vKind = kind;
        gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uGlow;
      varying vec2 vUv;
      varying float vPhase;
      varying float vKind;
      ${GLSL_NOISE}
      void main() {
        if (vKind > 0.5) {
          vec2 d = vUv - 0.5;
          float r = length(d) * 2.0;
          float a = exp(-r * r * 4.0) * uGlow;
          gl_FragColor = vec4(vec3(1.0, 0.55, 0.2) * a, 1.0);
          return;
        }
        vec2 uv = vUv;
        float t = uTime * 2.4 + vPhase * 10.0;
        float n = aFbm(vec2(uv.x * 3.2 + vPhase * 5.0, uv.y * 2.6 - t));
        float x = (uv.x - 0.5) * 2.0;
        x += (n - 0.5) * 1.0 * uv.y;
        float width = mix(0.9, 0.05, pow(uv.y, 0.8)) * (0.75 + 0.5 * n);
        float body = 1.0 - smoothstep(width * 0.45, width, abs(x));
        body *= smoothstep(0.0, 0.12, uv.y);
        body *= 1.0 - smoothstep(0.45 + 0.4 * n, 1.0, uv.y);
        float core = body * (1.0 - smoothstep(0.05, 0.55, uv.y + abs(x) * 0.9));
        vec3 col = mix(vec3(0.95, 0.22, 0.03), vec3(1.0, 0.6, 0.16), body);
        col = mix(col, vec3(1.0, 0.92, 0.66), core);
        gl_FragColor = vec4(col * body, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    fog: false,
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  return mesh;
}

/** Funken ueber den Feuern und Staub im Hof (Points). */
export function buildParticles(fires: Spot[], torches: Spot[], mood: MoodDef, rand: Rand): THREE.Points[] {
  const out: THREE.Points[] = [];
  // Funken
  {
    const srcs = [...fires.map((f) => ({ ...f, s: 1 })), ...torches.map((t) => ({ ...t, s: 0.35 }))];
    const per = (s: number) => (s > 0.5 ? 26 : 5);
    const total = srcs.reduce((acc, s) => acc + per(s.s), 0);
    const pos = new Float32Array(total * 3);
    const seed = new Float32Array(total * 4);
    let k = 0;
    for (const s of srcs) {
      for (let i = 0; i < per(s.s); i++) {
        pos.set([s.x, s.y + 0.1, s.z], k * 3);
        seed.set([rand(), rand(), rand(), s.s], k * 4);
        k++;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    const m = new THREE.ShaderMaterial({
      uniforms: { uTime: sharedUniforms.uTime, uPx: pxScale },
      vertexShader: /* glsl */ `
        attribute vec4 aSeed;
        uniform float uTime;
        uniform float uPx;
        varying float vA;
        void main() {
          float speed = 0.35 + aSeed.x * 0.4;
          float life = fract(uTime * speed + aSeed.y * 7.0);
          float h = life * (1.2 + aSeed.z * 2.2) * (0.5 + aSeed.w * 0.6);
          vec3 p = position;
          p.x += sin(aSeed.x * 40.0 + uTime * (1.5 + aSeed.z)) * 0.18 * life + life * 0.35;
          p.z += cos(aSeed.z * 40.0 + uTime * (1.3 + aSeed.x)) * 0.18 * life + life * 0.15;
          p.y += h;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          float sz = (0.03 + aSeed.x * 0.025) * (1.0 - life * 0.7);
          gl_PointSize = max(1.0, sz * projectionMatrix[1][1] * uPx * 0.5 / -mv.z);
          vA = (1.0 - life) * smoothstep(0.0, 0.08, life) * (0.6 + 0.4 * sin(uTime * 20.0 + aSeed.y * 50.0));
        }`,
      fragmentShader: /* glsl */ `
        varying float vA;
        void main() {
          vec2 d = gl_PointCoord - 0.5;
          float a = smoothstep(0.5, 0.1, length(d)) * vA;
          gl_FragColor = vec4(vec3(1.0, 0.62, 0.22) * a * 1.4, 1.0);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      fog: false,
    });
    const pts = new THREE.Points(g, m);
    pts.frustumCulled = false;
    pts.renderOrder = 6;
    trackViewport(pts);
    out.push(pts);
  }
  // Staub in der Luft
  if (mood.dust > 0) {
    const n = 420;
    const pos = new Float32Array(n * 3);
    const seed = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2;
      const r = Math.sqrt(rand()) * 14;
      pos.set([Math.sin(a) * r, 0.2 + Math.pow(rand(), 1.6) * 6, Math.cos(a) * r], i * 3);
      seed.set([rand(), rand(), rand(), rand()], i * 4);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    const m = new THREE.ShaderMaterial({
      uniforms: {
        uTime: sharedUniforms.uTime,
        uPx: pxScale,
        uCol: { value: new THREE.Color(mood.dustColor) },
        uAmt: { value: mood.dust },
      },
      vertexShader: /* glsl */ `
        attribute vec4 aSeed;
        uniform float uTime;
        uniform float uPx;
        varying float vA;
        void main() {
          vec3 p = position;
          float t = uTime;
          p.x += sin(t * (0.08 + aSeed.x * 0.1) + aSeed.y * 6.28) * 0.9 + t * 0.05;
          p.z += cos(t * (0.07 + aSeed.z * 0.1) + aSeed.w * 6.28) * 0.9;
          p.y += sin(t * (0.11 + aSeed.w * 0.1) + aSeed.x * 6.28) * 0.35;
          p.x = mod(p.x + 15.0, 30.0) - 15.0;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          float sz = 0.012 + aSeed.z * 0.018;
          gl_PointSize = max(1.0, sz * projectionMatrix[1][1] * uPx * 0.5 / -mv.z);
          float fade = smoothstep(0.4, 2.0, -mv.z) * (1.0 - smoothstep(12.0, 22.0, -mv.z));
          vA = fade * (0.35 + 0.65 * (0.5 + 0.5 * sin(t * (0.6 + aSeed.y) + aSeed.x * 30.0)));
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uCol;
        uniform float uAmt;
        varying float vA;
        void main() {
          vec2 d = gl_PointCoord - 0.5;
          float a = smoothstep(0.5, 0.0, length(d)) * vA * uAmt * 0.55;
          gl_FragColor = vec4(uCol, a);
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      fog: false,
    });
    const pts = new THREE.Points(g, m);
    pts.frustumCulled = false;
    pts.renderOrder = 4;
    trackViewport(pts);
    out.push(pts);
  }
  return out;
}

/** Rauch aus Kaminen und Feuerkoerben. */
export function buildSmoke(sources: Array<{ x: number; y: number; z: number; s: number }>, mood: MoodDef): THREE.Mesh {
  const per = 7;
  const n = sources.length * per;
  const pos = new Float32Array(n * 4 * 3);
  const corner = new Float32Array(n * 4 * 2);
  const seed = new Float32Array(n * 4 * 3);
  const idx: number[] = [];
  const cs = [
    [-0.5, -0.5],
    [0.5, -0.5],
    [0.5, 0.5],
    [-0.5, 0.5],
  ];
  let q = 0;
  for (const s of sources) {
    for (let i = 0; i < per; i++) {
      for (let k = 0; k < 4; k++) {
        const v = q * 4 + k;
        pos.set([s.x, s.y, s.z], v * 3);
        corner.set(cs[k]!, v * 2);
        seed.set([i / per, Math.random(), s.s], v * 3);
      }
      const o = q * 4;
      idx.push(o, o + 1, o + 2, o, o + 2, o + 3);
      q++;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aCorner', new THREE.BufferAttribute(corner, 2));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 3));
  g.setIndex(idx);
  const base = new THREE.Color(mood.fogColor).lerp(new THREE.Color(0x4a4a4a), 0.55);
  const m = new THREE.ShaderMaterial({
    uniforms: { uTime: sharedUniforms.uTime, uCol: { value: base } },
    vertexShader: /* glsl */ `
      attribute vec2 aCorner;
      attribute vec3 aSeed;
      uniform float uTime;
      varying vec2 vUv;
      varying float vA;
      varying float vSeed;
      void main() {
        float life = fract(uTime * 0.09 * (1.0 + aSeed.y * 0.3) + aSeed.x);
        vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
        vec3 c = position + vec3(life * 2.6 + sin(life * 6.0 + aSeed.y * 9.0) * 0.3, life * 5.0 * aSeed.z, life * 1.2);
        float sz = (0.5 + life * 2.6) * aSeed.z;
        vec3 wp = c + (right * aCorner.x + up * aCorner.y) * sz;
        vUv = aCorner + 0.5;
        vA = smoothstep(0.0, 0.12, life) * (1.0 - life);
        vSeed = aSeed.y;
        gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uCol;
      uniform float uTime;
      varying vec2 vUv;
      varying float vA;
      varying float vSeed;
      ${GLSL_NOISE}
      void main() {
        vec2 d = vUv - 0.5;
        float n = aFbm(vUv * 3.0 + vSeed * 10.0 + uTime * 0.05);
        float a = smoothstep(0.5, 0.05, length(d) + (n - 0.5) * 0.35) * vA * 0.32;
        gl_FragColor = vec4(uCol * (0.85 + n * 0.3), a);
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    fog: false,
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  return mesh;
}

/** Nieselregen: duenne Striche im Hof, per Vertex-Shader bewegt. */
export function buildRain(rand: Rand, amount: number): THREE.Mesh {
  const n = Math.round(2200 * amount);
  const pos = new Float32Array(n * 4 * 3);
  const corner = new Float32Array(n * 4 * 2);
  const seed = new Float32Array(n * 4);
  const idx: number[] = [];
  const cs = [
    [-0.5, 0],
    [0.5, 0],
    [0.5, 1],
    [-0.5, 1],
  ];
  for (let i = 0; i < n; i++) {
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(rand()) * 16;
    const x = Math.sin(a) * r;
    const z = Math.cos(a) * r;
    const ph = rand();
    for (let k = 0; k < 4; k++) {
      const v = i * 4 + k;
      pos.set([x, 0, z], v * 3);
      corner.set(cs[k]!, v * 2);
      seed[v] = ph;
    }
    const o = i * 4;
    idx.push(o, o + 1, o + 2, o, o + 2, o + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aCorner', new THREE.BufferAttribute(corner, 2));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  g.setIndex(idx);
  const m = new THREE.ShaderMaterial({
    uniforms: { uTime: sharedUniforms.uTime },
    vertexShader: /* glsl */ `
      attribute vec2 aCorner;
      attribute float aSeed;
      uniform float uTime;
      varying float vA;
      void main() {
        float y = fract(aSeed * 13.7 - uTime * 0.55 * (0.85 + aSeed * 0.3)) * 13.0;
        vec3 fall = normalize(vec3(0.18, -1.0, 0.08));
        vec3 base = position + vec3(0.0, y, 0.0) - fall * y * 0.0;
        vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 wp = base + right * aCorner.x * 0.012 - fall * aCorner.y * 0.55;
        vec4 mv = viewMatrix * vec4(wp, 1.0);
        vA = aCorner.y * smoothstep(0.5, 3.0, -mv.z) * (1.0 - smoothstep(10.0, 22.0, -mv.z));
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying float vA;
      void main() {
        gl_FragColor = vec4(0.82, 0.85, 0.88, vA * 0.28);
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    fog: false,
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false;
  mesh.renderOrder = 7;
  return mesh;
}

// ------------------------------------------------------------------ Zuschauer

const CLOTHES = [0x6b4a3a, 0x4a5a3a, 0x3e4a5e, 0x7a6a4a, 0x5e3a3a, 0x8a7a5a, 0xa3241d, 0x1f4f8f, 0xd9a62b, 0x2f6b36, 0xe6ddc6, 0x5a2a6e, 0x6e6860];
const SKIN = [0xe0b090, 0xd2a37c, 0xb98561, 0x8f5f3f, 0xe8c0a0];

export interface Crowd {
  meshes: THREE.InstancedMesh[];
  update(t: number): void;
}

export function buildCrowd(spots: Spectator[], rand: Rand, b: Buckets): Crowd {
  const bb = new Buckets();
  const c = (v: number) => new THREE.Color(v, v, v);
  bb.add('body', part(boxB(0.3, 0.82, 0.18), null, { color: c(0.5), uv: 'none' }));
  bb.add('body', part(new THREE.CylinderGeometry(0.19, 0.27, 0.72, 7), mat(0, 1.15, 0), { color: c(1), uv: 'none' }));
  bb.add('body', part(new THREE.CylinderGeometry(0.2, 0.2, 0.06, 7), mat(0, 1.0, 0), { color: c(0.3), uv: 'none' }));
  for (const sx of [-1, 1]) {
    bb.add('body', part(box(0.1, 0.6, 0.11), mat(sx * 0.25, 1.12, 0.02, 0, 0.1, sx * 0.08), { color: c(0.85), uv: 'none' }));
  }
  bb.add('body', part(new THREE.CylinderGeometry(0.11, 0.2, 0.12, 7), mat(0, 1.5, 0), { color: c(0.8), uv: 'none' }));
  const bodyGeo = bb.merged('body')!;
  bodyGeo.deleteAttribute('uv');
  const head = new THREE.IcosahedronGeometry(0.115, 1);
  const hp = head.attributes.position as THREE.BufferAttribute;
  const hc = new Float32Array(hp.count * 3);
  for (let i = 0; i < hp.count; i++) {
    const y = hp.getY(i);
    const z = hp.getZ(i);
    const hair = y > 0.03 || (z < -0.02 && y > -0.06);
    const v = hair ? 0.3 : 1;
    hc.set([v, v * (hair ? 0.8 : 1), v * (hair ? 0.65 : 1)], i * 3);
  }
  head.setAttribute('color', new THREE.BufferAttribute(hc, 3));
  head.scale(1, 1.1, 1);
  head.translate(0, 1.66, 0);
  const matl = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 });
  const bodies = new THREE.InstancedMesh(bodyGeo, matl, spots.length);
  const heads = new THREE.InstancedMesh(head, matl, spots.length);
  bodies.receiveShadow = heads.receiveShadow = true;
  const col = new THREE.Color();
  const data = spots.map((s, i) => {
    if (s.kind === 1) {
      bodies.setColorAt(i, col.set(0x4a5470));
      heads.setColorAt(i, col.set(0x9aa0a8));
      // Speer der Wache
      const m = mat(s.x, s.y, s.z, s.ry);
      b.add('wood', part(new THREE.CylinderGeometry(0.02, 0.025, 2.3, 5), m.clone().multiply(mat(0.32, 1.15, 0.1)), { color: 0x7a5a40, uvSwap: true }));
      b.add('iron', part(new THREE.ConeGeometry(0.04, 0.3, 4), m.clone().multiply(mat(0.32, 2.42, 0.1)), { color: 0xa0a4aa, uv: 'none' }));
    } else {
      bodies.setColorAt(i, col.set(CLOTHES[Math.floor(rand() * CLOTHES.length)]!).multiplyScalar(0.8 + rand() * 0.3));
      heads.setColorAt(i, col.set(SKIN[Math.floor(rand() * SKIN.length)]!));
    }
    return { ph: rand() * 10, sp: 0.6 + rand() * 0.8, sc: 0.92 + rand() * 0.14 };
  });
  const q = new THREE.Quaternion();
  const axis = new THREE.Vector3(0, 1, 0);
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  const m4 = new THREE.Matrix4();
  const update = (t: number) => {
    for (let i = 0; i < spots.length; i++) {
      const sp = spots[i]!;
      const d = data[i]!;
      let y = sp.y + Math.sin(t * d.sp + d.ph) * 0.012;
      let turn = Math.sin(t * 0.3 * d.sp + d.ph) * 0.18;
      if (sp.cheer) {
        const j = Math.sin(t * 3.2 + d.ph);
        y += Math.max(0, j) * Math.max(0, Math.sin(t * 0.4 + d.ph)) * 0.09;
        turn *= 0.5;
      }
      if (sp.kind === 1) turn = Math.sin(t * 0.15 + d.ph) * 0.5;
      q.setFromAxisAngle(axis, sp.ry + turn);
      p.set(sp.x, y, sp.z);
      s.setScalar(d.sc);
      m4.compose(p, q, s);
      bodies.setMatrixAt(i, m4);
      q.setFromAxisAngle(axis, sp.ry + turn * 1.6);
      m4.compose(p, q, s);
      heads.setMatrixAt(i, m4);
    }
    bodies.instanceMatrix.needsUpdate = true;
    heads.instanceMatrix.needsUpdate = true;
  };
  update(0);
  bodies.computeBoundingSphere();
  heads.computeBoundingSphere();
  bodies.frustumCulled = heads.frustumCulled = false;
  return { meshes: [bodies, heads], update };
}

export type { Emitter };
