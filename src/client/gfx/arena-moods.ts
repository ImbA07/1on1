// Stimmungen der Arena. 'overcast' ist die Hauptstimmung, die anderen sind schlanke Varianten.

export type ArenaMood = 'overcast' | 'goldenHour' | 'night' | 'fog';
export const ARENA_MOODS: ArenaMood[] = ['overcast', 'goldenHour', 'night', 'fog'];

export interface MoodDef {
  // Himmel
  skyTop: number;
  skyHorizon: number;
  skyGround: number;
  cloudLit: number;
  cloudDark: number;
  cloudCover: number; // 0 = klar, 1 = geschlossen
  cloudSpeed: number;
  sunGlow: number; // Hof um die Sonne
  sunDisk: number;
  stars: number;
  // Licht
  sunColor: number;
  sunIntensity: number;
  sunElevation: number; // Grad
  sunAzimuth: number; // Grad (0 = aus +Z)
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  envIntensity: number;
  // Nebel
  fogColor: number;
  fogDensity: number;
  // Feuer und Fenster
  fireIntensity: number; // Punktlichter in Candela
  flameScale: number;
  windowGlow: number; // 0 = dunkle Fenster, 1 = warmes Licht
  // Boden
  wetness: number; // 0..1 Pfuetzen-Menge
  dust: number; // Sichtbarkeit Staubteilchen
  rain: number; // 0 = trocken, 1 = Nieselregen
  dustColor: number;
}

export const MOODS: Record<ArenaMood, MoodDef> = {
  overcast: {
    skyTop: 0x6f7f8e,
    skyHorizon: 0xc3c6c3,
    skyGround: 0x575048,
    cloudLit: 0xd6d7d4,
    cloudDark: 0x7d8288,
    cloudCover: 0.62,
    cloudSpeed: 0.006,
    sunGlow: 0.18,
    sunDisk: 0.0,
    stars: 0,
    sunColor: 0xfff1de,
    sunIntensity: 1.85,
    sunElevation: 52,
    sunAzimuth: 38,
    hemiSky: 0xc9d2da,
    hemiGround: 0x5a5046,
    hemiIntensity: 0.5,
    envIntensity: 0.65,
    fogColor: 0xb2b7b8,
    fogDensity: 0.0037,
    fireIntensity: 5,
    flameScale: 1,
    windowGlow: 0.0,
    wetness: 0.55,
    dust: 0.35,
    dustColor: 0xe8e4da,
    rain: 0,
  },
  goldenHour: {
    skyTop: 0x4a6a96,
    skyHorizon: 0xf0b07a,
    skyGround: 0x5a4636,
    cloudLit: 0xffc690,
    cloudDark: 0x7a5e68,
    cloudCover: 0.42,
    cloudSpeed: 0.005,
    sunGlow: 0.9,
    sunDisk: 3.0,
    stars: 0,
    sunColor: 0xffb26a,
    sunIntensity: 3.8,
    sunElevation: 21,
    sunAzimuth: 118,
    hemiSky: 0xb4b8d0,
    hemiGround: 0x7a5238,
    hemiIntensity: 0.5,
    envIntensity: 0.7,
    fogColor: 0xd8a47e,
    fogDensity: 0.0042,
    fireIntensity: 6,
    flameScale: 1,
    windowGlow: 0.35,
    wetness: 0.25,
    dust: 1.0,
    dustColor: 0xffd29a,
    rain: 0,
  },
  night: {
    skyTop: 0x060a18,
    skyHorizon: 0x1c2438,
    skyGround: 0x0c0c10,
    cloudLit: 0x39435a,
    cloudDark: 0x0d1220,
    cloudCover: 0.45,
    cloudSpeed: 0.004,
    sunGlow: 0.25,
    sunDisk: 1.2,
    stars: 1,
    sunColor: 0x9fb4e8,
    sunIntensity: 0.75,
    sunElevation: 40,
    sunAzimuth: -30,
    hemiSky: 0x44507a,
    hemiGround: 0x1a1612,
    hemiIntensity: 0.55,
    envIntensity: 0.55,
    fogColor: 0x121a2a,
    fogDensity: 0.009,
    fireIntensity: 38,
    flameScale: 1.15,
    windowGlow: 1.0,
    wetness: 0.6,
    dust: 0.5,
    dustColor: 0xffb070,
    rain: 0,
  },
  fog: {
    skyTop: 0x8e9796,
    skyHorizon: 0xa6adab,
    skyGround: 0x565a55,
    cloudLit: 0xb5bbb9,
    cloudDark: 0x8a918f,
    cloudCover: 0.9,
    cloudSpeed: 0.004,
    sunGlow: 0.08,
    sunDisk: 0,
    stars: 0,
    sunColor: 0xe8ecef,
    sunIntensity: 0.7,
    sunElevation: 60,
    sunAzimuth: 20,
    hemiSky: 0xbac3c6,
    hemiGround: 0x4c4a44,
    hemiIntensity: 0.75,
    envIntensity: 0.85,
    fogColor: 0x9aa2a1,
    fogDensity: 0.046,
    fireIntensity: 9,
    flameScale: 1,
    windowGlow: 0.3,
    wetness: 1.0,
    dust: 0.0,
    dustColor: 0xdfe4e4,
    rain: 1,
  },
};
