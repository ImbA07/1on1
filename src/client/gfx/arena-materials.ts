import * as THREE from 'three';
import { MASK_EXTENT } from './arena-textures.js';

// Materialien mit kleinen Shader-Erweiterungen (onBeforeCompile), damit alles mit
// wenigen Texturen und wenigen Draw-Calls auskommt.

export const sharedUniforms = {
  uTime: { value: 0 },
  uWet: { value: 0.5 },
  uRain: { value: 0 },
};

export const GLSL_NOISE = /* glsl */ `
float aHash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float aNoise(vec2 p){
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(aHash(i), aHash(i + vec2(1.0, 0.0)), f.x), mix(aHash(i + vec2(0.0, 1.0)), aHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float aFbm(vec2 p){ float s = 0.0; float a = 0.5; for (int i = 0; i < 4; i++) { s += a * aNoise(p); p = p * 2.03 + 11.7; a *= 0.5; } return s / 0.9375; }
`;

type Kind = 'stone' | 'roof' | 'wood' | 'ground';

export interface PackedOpts {
  kind: Kind;
  tex: THREE.Texture;
  palette: [number, number, number];
  mortar?: number;
  moss?: number;
  roughness?: number;
  normalScale?: number;
  mask?: THREE.Texture;
  dirt?: [number, number];
  flatShading?: boolean;
}

const ALBEDO: Record<Kind, string> = {
  stone: /* glsl */ `
    float sr = fract(pkR + aHash(floor(vNormalMapUv) + 3.0) * 0.61);
    vec3 sc = mix(uPalA, uPalB, smoothstep(0.15, 0.85, sr));
    sc = mix(sc, uPalC, step(0.84, fract(sr * 5.37)));
    float lum = 0.7 + 0.4 * pkH;
    float mort = 1.0 - smoothstep(0.05, 0.22, pkH);
    vec3 col = mix(sc * lum, uMortar, mort);
    // Verwitterung in Weltkoordinaten
    float hc = atan(vWPos.z, vWPos.x) * 15.0;
    float big = aNoise(vec2(hc * 0.16, vWPos.y * 0.22) + vWPos.xz * 0.01) * 0.65 + aNoise(vec2(hc * 0.5, vWPos.y * 0.6)) * 0.35;
    col *= 0.8 + 0.4 * big;
    float streak = aNoise(vec2(hc * 2.3, vWPos.y * 0.1 + 3.0)) * aNoise(vec2(hc * 0.6, 1.7));
    float stain = smoothstep(0.2, 0.55, streak) * (0.35 + 0.65 * smoothstep(0.5, 5.5, vWPos.y));
    col *= 1.0 - 0.36 * stain;
    float dampN = aNoise(vec2(hc * 0.8, 7.0));
    float damp = 1.0 - smoothstep(0.05, 0.55 + dampN * 0.9, vWPos.y);
    col *= 1.0 - 0.32 * damp;
    float upF = smoothstep(0.5, 0.95, vWNormal.y);
    float mossN = aNoise(vWPos.xz * 1.1 + vWPos.y * 0.7) * 0.6 + aNoise(vWPos.xz * 3.1 - vWPos.y * 2.3) * 0.4;
    float mossAmt = upF * smoothstep(0.38, 0.62, mossN) * 0.9 + damp * smoothstep(0.5, 0.75, mossN) * 0.75;
    col = mix(col, uMoss * (0.55 + 0.7 * pkH), clamp(mossAmt, 0.0, 1.0));
    vec2 cell = floor(vec2(hc / 1.4, vWPos.y / 0.95));
    float rh = aHash(cell + 17.0);
    col *= rh > 0.93 ? vec3(1.16, 1.12, 1.04) : vec3(1.0);
    float pkRough = 1.0 - 0.12 * damp;
    float pkFlat = 1.0;
  `,
  roof: /* glsl */ `
    vec3 col = mix(uPalA, uPalB, pkR);
    col = mix(col, uPalC, step(0.82, fract(pkR * 7.1)));
    col *= 0.42 + 0.78 * pkH;
    float lich = smoothstep(0.55, 0.8, aNoise(vWPos.xz * 0.9 + vWPos.y));
    col = mix(col, uMoss, lich * 0.45);
    float pkRough = 1.0;
    float pkFlat = 1.0;
  `,
  wood: /* glsl */ `
    vec3 col = mix(uPalA, uPalB, pkR);
    col *= 0.5 + 0.6 * pkH;
    float weath = aNoise(vWPos.xz * 0.7 + vWPos.y * 1.3);
    col = mix(col, uPalC, smoothstep(0.5, 0.85, weath) * 0.5);
    float pkRough = 1.0;
    float pkFlat = 1.0;
  `,
  ground: /* glsl */ `
    vec4 gm = texture2D(uMask, vMaskUv);
    float grain = texture2D(normalMap, vNormalMapUv * 3.7 + 0.31).b;
    // Steinfarbe aus Palette, pro Kachel-Wiederholung leicht anders
    float pr = fract(pkR + aHash(floor(vNormalMapUv) + 7.0) * 0.61);
    vec3 sc = mix(uPalA, uPalB, smoothstep(0.1, 0.9, pr));
    sc = mix(sc, uPalC, step(0.86, fract(pr * 6.13)));
    float big = aNoise(vWPos.xz * 0.23) * 0.7 + aNoise(vWPos.xz * 0.9) * 0.3;
    sc *= 0.85 + 0.3 * big;
    float lum = 0.5 + 0.6 * pkH;
    vec3 col = sc * lum;
    float gap = 1.0 - smoothstep(0.05, 0.28, pkH);
    col = mix(col, uMortar * (0.6 + 0.5 * grain), gap);
    // Steinrosette in der Hofmitte (grosse Platten in Ringen)
    float rr = length(vWPos.xz);
    float inlay = 1.0 - smoothstep(2.6, 2.64, rr);
    if (inlay > 0.0) {
      float ang = atan(vWPos.z, vWPos.x) / 6.2832 + 0.5;
      float ri = rr < 0.72 ? 0.0 : (rr < 1.62 ? 1.0 : (rr < 2.28 ? 2.0 : 3.0));
      float nSec = ri < 0.5 ? 1.0 : (ri < 1.5 ? 8.0 : (ri < 2.5 ? 16.0 : 36.0));
      float sp = ang * nSec + ri * 0.37;
      float secF = fract(sp);
      float rEdge = ri < 0.5 ? 0.72 - rr : (ri < 1.5 ? min(rr - 0.72, 1.62 - rr) : (ri < 2.5 ? min(rr - 1.62, 2.28 - rr) : min(rr - 2.28, 2.62 - rr)));
      float aEdge = ri < 0.5 ? 1.0 : min(secF, 1.0 - secF) * 6.2832 * rr / nSec;
      float sh = smoothstep(0.004, 0.03, min(rEdge, aEdge));
      float sid = aHash(vec2(ri * 3.1, floor(sp)));
      vec3 slab = mix(uPalA, uPalB, sid) * (ri > 2.5 ? 0.6 : 0.9) * (0.78 + 0.3 * grain) * (0.9 + 0.2 * aNoise(vWPos.xz * 2.3));
      col = mix(col, mix(uMortar * 0.7, slab, sh), inlay);
      pkH = mix(pkH, 0.3 + 0.55 * sh, inlay);
      gap = mix(gap, 1.0 - sh, inlay);
    }
    // Ring aus laenglichen Randsteinen innen am Kampfkreis
    float band = smoothstep(11.28, 11.3, rr) * (1.0 - smoothstep(11.98, 12.0, rr));
    if (band > 0.0) {
      float ang2 = atan(vWPos.z, vWPos.x) / 6.2832 + 0.5;
      float row = rr < 11.64 ? 0.0 : 1.0;
      float sp2 = ang2 * 150.0 + row * 0.5;
      float f2 = fract(sp2);
      float rE = row < 0.5 ? min(rr - 11.3, 11.64 - rr) : min(rr - 11.64, 11.98 - rr);
      float aE = min(f2, 1.0 - f2) * 6.2832 * rr / 150.0;
      float sh2 = smoothstep(0.004, 0.025, min(rE, aE));
      float sid2 = aHash(vec2(row + 5.0, floor(sp2)));
      vec3 sett = mix(uPalB, uPalC, sid2) * 0.82 * (0.8 + 0.3 * grain);
      col = mix(col, mix(uMortar * 0.7, sett, sh2), band);
      pkH = mix(pkH, 0.3 + 0.55 * sh2, band);
      gap = mix(gap, 1.0 - sh2, band);
      inlay = max(inlay, band * 0.8);
    }
    // Erde und Sand: fuellt zuerst die Fugen, dann die Steine
    float dirt = clamp(gm.r * 1.55 - pkH * 0.75 + gap * 0.25 + (grain - 0.5) * 0.25, 0.0, 1.0);
    dirt = smoothstep(0.18, 0.7, dirt);
    vec3 dcol = mix(uDirtA, uDirtB, smoothstep(0.25, 0.8, aNoise(vWPos.xz * 1.7) * 0.6 + aNoise(vWPos.xz * 5.3) * 0.4));
    dcol *= (0.78 + 0.42 * grain) * mix(1.0, 0.6, gap);
    col = mix(col, dcol, dirt);
    // Moos in den Fugen
    col = mix(col, uMoss * (0.7 + 0.5 * grain), gm.a * max(gap, 0.25) * 0.85);
    // Abnutzung (Fussspuren): dunkler und glatter
    col *= 1.0 - gm.b * 0.2;
    // Pfuetzen: fuellen die Fugen zuerst
    float wetMask = gm.g * uWet;
    float pud = smoothstep(0.12, 0.3, wetMask * 1.25 - pkH * 0.35 - 0.12);
    float damp = smoothstep(0.02, 0.4, wetMask);
    col *= 1.0 - 0.18 * damp;
    col = mix(col, col * 0.62, pud);
    float pkRough = mix(1.0, 0.82, gm.b) * mix(1.0, 0.72, damp);
    pkRough = mix(pkRough, 0.035, pud);
    float pkFlat = (1.0 - dirt * 0.7) * (1.0 - pud) * (1.0 - inlay * 0.9);
  `,
};

export function packedMaterial(o: PackedOpts): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    roughness: o.roughness ?? 0.92,
    metalness: 0,
    normalMap: o.tex,
    normalScale: new THREE.Vector2(o.normalScale ?? 1, o.normalScale ?? 1),
    flatShading: o.flatShading ?? false,
  });
  const uniforms: Record<string, THREE.IUniform> = {
    uPalA: { value: new THREE.Color(o.palette[0]) },
    uPalB: { value: new THREE.Color(o.palette[1]) },
    uPalC: { value: new THREE.Color(o.palette[2]) },
    uMortar: { value: new THREE.Color(o.mortar ?? 0x3a3530) },
    uMoss: { value: new THREE.Color(o.moss ?? 0x4a5530) },
    uDirtA: { value: new THREE.Color(o.dirt?.[0] ?? 0x6b5a45) },
    uDirtB: { value: new THREE.Color(o.dirt?.[1] ?? 0x8f7b5e) },
    uMask: { value: o.mask ?? null },
    uWet: sharedUniforms.uWet,
    uRain: sharedUniforms.uRain,
    uTime: sharedUniforms.uTime,
  };
  m.userData.uniforms = uniforms;
  const isGround = o.kind === 'ground';
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vWPos;
        varying vec3 vWNormal;
        ${isGround ? 'varying vec2 vMaskUv;' : ''}`,
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vWNormal = normalize(mat3(modelMatrix) * objectNormal);
        ${isGround ? `vMaskUv = vWPos.xz / ${MASK_EXTENT.toFixed(1)} + 0.5;` : ''}`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vWPos;
        varying vec3 vWNormal;
        ${isGround ? 'varying vec2 vMaskUv; uniform sampler2D uMask; uniform float uWet; uniform float uRain; uniform float uTime;' : ''}
        uniform vec3 uPalA; uniform vec3 uPalB; uniform vec3 uPalC; uniform vec3 uMortar; uniform vec3 uMoss;
        uniform vec3 uDirtA; uniform vec3 uDirtB;
        ${GLSL_NOISE}`,
      )
      .replace(
        '#include <map_fragment>',
        `vec4 pk = texture2D(normalMap, vNormalMapUv);
        float pkH = pk.b;
        float pkR = pk.a;
        ${ALBEDO[o.kind]}
        diffuseColor.rgb *= col;`,
      )
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = clamp(roughness * pkRough, 0.04, 1.0);')
      .replace(
        '#include <normal_fragment_maps>',
        `vec3 mapN = vec3(pk.xy * 2.0 - 1.0, 0.0);
        mapN.z = sqrt(max(0.001, 1.0 - dot(mapN.xy, mapN.xy)));
        mapN.xy *= normalScale * pkFlat;
        ${isGround ? `{
          vec2 rp = vWPos.xz * 7.0;
          float rt = uTime * 1.7;
          vec2 rip = vec2(aNoise(rp + vec2(rt, rt * 0.6)) - aNoise(rp * 1.3 - vec2(rt * 0.8, rt)),
                          aNoise(rp.yx * 1.1 + vec2(rt * 0.7, -rt)) - aNoise(rp * 0.9 + vec2(-rt, rt * 0.5)));
          mapN.xy += rip * (0.03 + 0.14 * uRain) * pud;
        }` : ''}
        normal = normalize(tbn * mapN);`,
      );
  };
  m.customProgramCacheKey = () => 'arena-packed-' + o.kind;
  return m;
}

/** Stoff (Banner, Wimpel, Wappen): Atlas-Textur, Wind per Vertex-Animation. */
export function clothMaterial(atlas: THREE.Texture): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    map: atlas,
    vertexColors: true,
    roughness: 0.88,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = sharedUniforms.uTime;
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute vec4 aWave;
        attribute vec3 aWaveDir;
        uniform float uTime;
        varying float vWaveShade;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float wW = aWave.x;
        float wPh = uTime * aWave.w + aWave.y - wW * 5.5 + transformed.y * 0.6;
        float wv = sin(wPh) + 0.35 * sin(wPh * 2.3 + 1.7);
        transformed += aWaveDir * (wv * aWave.z * wW);
        vWaveShade = 1.0 + 0.3 * cos(wPh) * min(1.0, wW * 2.5) * step(0.0001, aWave.z);`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vWaveShade;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= vWaveShade;');
  };
  m.customProgramCacheKey = () => 'arena-cloth';
  return m;
}

export interface ArenaMaterials {
  stone: THREE.MeshStandardMaterial;
  ground: THREE.MeshStandardMaterial;
  roof: THREE.MeshStandardMaterial;
  wood: THREE.MeshStandardMaterial;
  iron: THREE.MeshStandardMaterial;
  generic: THREE.MeshStandardMaterial;
  cloth: THREE.MeshStandardMaterial;
  ivy: THREE.MeshStandardMaterial;
  window: THREE.MeshBasicMaterial;
}
