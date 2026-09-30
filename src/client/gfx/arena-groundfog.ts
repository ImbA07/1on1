import * as THREE from 'three';

// Bodennebel ohne zusaetzliche Flaechen (kein Overdraw): Die Nebel-Bausteine von three.js werden
// so erweitert, dass jeder Pixel zusaetzlich eine flache Nebelschicht (Dichte faellt mit der Hoehe
// ab) entlang des Sichtstrahls sammelt. Die Dichte haengt vom Ort ab: duenn in der Kampfmitte,
// dicht an den Mauerfuessen und um die Tuerme, mit langsam treibenden Schwaden.
//
// Trick fuer die Zeit: Solange der Bodennebel aktiv ist, ist scene.fog ein THREE.Fog, dessen
// "near" die Dichte des normalen Fernnebels (wie FogExp2) und dessen "far" die Zeit fuer das
// Treiben der Schwaden enthaelt. So bekommen alle Materialien (auch die Figuren) die Zeit ohne
// eigene Uniforms. Siehe GroundFog unten.

export interface GroundFogParams {
  density: number; // Grunddichte der Schicht (pro Meter am Boden)
  height: number; // Abfallhoehe (m)
  max: number; // hoechste Deckkraft
  tint: number; // Helligkeit relativ zur Nebelfarbe
}

const ORIGINAL = {
  fog_pars_vertex: THREE.ShaderChunk.fog_pars_vertex,
  fog_vertex: THREE.ShaderChunk.fog_vertex,
  fog_pars_fragment: THREE.ShaderChunk.fog_pars_fragment,
  fog_fragment: THREE.ShaderChunk.fog_fragment,
};

const f = (v: number) => v.toFixed(5);

/** Nebel-Objekt: near = Dichte des Fernnebels, far = Zeit (s). */
export class GroundFog extends THREE.Fog {
  constructor(color: THREE.ColorRepresentation, distanceDensity: number) {
    super(color, distanceDensity, 0);
  }
  set time(t: number) {
    this.far = t;
  }
}

export function installGroundFog(p: GroundFogParams | null): void {
  if (!p) {
    Object.assign(THREE.ShaderChunk, ORIGINAL);
    return;
  }
  THREE.ShaderChunk.fog_pars_vertex = /* glsl */ `
#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vGfWorld;
#endif
`;
  // Weltposition aus der Kameraposition: gilt fuer alle Materialien (auch Instanzen, Skinning, Sprites)
  THREE.ShaderChunk.fog_vertex = /* glsl */ `
#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  vGfWorld = cameraPosition + transpose( mat3( viewMatrix ) ) * mvPosition.xyz;
#endif
`;
  THREE.ShaderChunk.fog_pars_fragment = /* glsl */ `
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying vec3 vGfWorld;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
  float gfHash( vec2 q ) { q = fract( q * vec2( 233.34, 851.73 ) ); q += dot( q, q + 23.45 ); return fract( q.x * q.y ); }
  float gfNoise( vec2 q ) {
    vec2 i = floor( q ); vec2 u = fract( q ); u = u * u * ( 3.0 - 2.0 * u );
    return mix( mix( gfHash( i ), gfHash( i + vec2( 1.0, 0.0 ) ), u.x ), mix( gfHash( i + vec2( 0.0, 1.0 ) ), gfHash( i + vec2( 1.0, 1.0 ) ), u.x ), u.y );
  }
#endif
`;
  THREE.ShaderChunk.fog_fragment = /* glsl */ `
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
  #else
    // Bodennebel (near = Dichte des Fernnebels, far = Zeit)
    float gfT = fogFar;
    float gfH = ${f(p.height)};
    float gfYc = max( cameraPosition.y, 0.0 );
    float gfYf = max( vGfWorld.y, 0.0 );
    float gfEc = exp( - gfYc / gfH );
    float gfEf = exp( - gfYf / gfH );
    float gfDy = gfYf - gfYc;
    float gfMean = abs( gfDy ) > 0.02 ? ( gfEc - gfEf ) * gfH / gfDy : gfEf;
    float gfL = length( vGfWorld - cameraPosition );
    // Ort: Mitte duenn, Rand und Mauerfuss dicht, Tuerme und Ecken (45-Grad-Richtungen) dichter
    float gfR = length( vGfWorld.xz );
    float gfS = 0.1 + 0.22 * smoothstep( 3.0, 11.0, gfR ) + 0.68 * smoothstep( 11.0, 14.8, gfR );
    float gfAng = atan( vGfWorld.z, vGfWorld.x );
    gfS += 0.45 * pow( abs( sin( 2.0 * gfAng ) ), 8.0 ) * smoothstep( 11.5, 15.0, gfR );
    gfS = mix( gfS, 0.55, smoothstep( 17.0, 40.0, gfR ) );
    // treibende Schwaden
    vec2 gfP = vGfWorld.xz * 0.28 + vec2( gfT * 0.045, gfT * 0.018 );
    float gfN = gfNoise( gfP ) * 0.65 + gfNoise( gfP * 2.3 + vec2( - gfT * 0.03, 5.1 ) ) * 0.35;
    gfS *= 0.45 + 1.1 * gfN;
    float gfTau = ${f(p.density)} * gfL * gfMean * gfS;
    float gfA = ( 1.0 - exp( - gfTau ) ) * ${f(p.max)};
    gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor * ${f(p.tint)}, gfA );
    float fogFactor = 1.0 - exp( - fogNear * fogNear * vFogDepth * vFogDepth );
  #endif
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif
`;
}
