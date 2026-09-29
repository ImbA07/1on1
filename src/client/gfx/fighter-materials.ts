import * as THREE from 'three';
import { mulberry32 } from './fighter-geo.js';

// Gemeinsame Materialien und prozedurale Texturen der Kaempfer.
// Werden einmal erzeugt und von allen Figuren geteilt (nie pro Figur freigeben).
// Die eigentliche Farbe steckt in den Vertex-Farben; Texturen liefern nur Struktur
// (Kratzer, Gewebe, Narben im Leder, Kettenringe).

export type MatKey = 'metal' | 'chain' | 'cloth' | 'leather' | 'skin';

export type FighterMaterials = Record<MatKey, THREE.MeshStandardMaterial>;

let cache: FighterMaterials | null = null;

type Ctx = CanvasRenderingContext2D;

function canvas(size: number): [HTMLCanvasElement, Ctx] {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  return [c, c.getContext('2d')!];
}

function tex(c: HTMLCanvasElement, srgb: boolean, repeat: number): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 4;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

/** Weiche Flecken, nahtlos (an den Raendern wiederholt gezeichnet). */
function blotches(g: Ctx, size: number, rnd: () => number, count: number, rMin: number, rMax: number, color: (r: number) => string): void {
  for (let i = 0; i < count; i++) {
    const x = rnd() * size;
    const y = rnd() * size;
    const r = rMin + rnd() * (rMax - rMin);
    const col = color(rnd());
    for (const ox of [-size, 0, size]) {
      for (const oy of [-size, 0, size]) {
        const cx = x + ox;
        const cy = y + oy;
        if (cx + r < 0 || cx - r > size || cy + r < 0 || cy - r > size) continue;
        const grad = g.createRadialGradient(cx, cy, 0, cx, cy, r);
        grad.addColorStop(0, col);
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = grad;
        g.fillRect(cx - r, cy - r, r * 2, r * 2);
      }
    }
  }
}

function wrapLine(g: Ctx, size: number, x0: number, y0: number, x1: number, y1: number): void {
  for (const ox of [-size, 0, size]) {
    for (const oy of [-size, 0, size]) {
      g.beginPath();
      g.moveTo(x0 + ox, y0 + oy);
      g.lineTo(x1 + ox, y1 + oy);
      g.stroke();
    }
  }
}

function metalTextures(): { map: THREE.CanvasTexture; rough: THREE.CanvasTexture } {
  const S = 512;
  const rnd = mulberry32(71);
  const [c, g] = canvas(S);
  g.fillStyle = 'rgb(214,214,214)';
  g.fillRect(0, 0, S, S);
  // Grosse, weiche Schattierung (gehaemmert, ungleichmaessig)
  blotches(g, S, rnd, 60, 30, 110, (r) => (r < 0.5 ? `rgba(255,255,255,${0.12 + r * 0.1})` : `rgba(120,120,125,${0.08 + r * 0.08})`));
  // Patina / Anlauffarben (braeunlich)
  blotches(g, S, rnd, 22, 8, 40, (r) => `rgba(${120 + r * 30},${95 + r * 20},${70},${0.08 + r * 0.1})`);
  // Kleine Rostpunkte
  for (let i = 0; i < 160; i++) {
    g.fillStyle = `rgba(${90 + rnd() * 40},${60 + rnd() * 20},40,${0.15 + rnd() * 0.25})`;
    const r = 0.5 + rnd() * 1.2;
    g.beginPath();
    g.arc(rnd() * S, rnd() * S, r, 0, Math.PI * 2);
    g.fill();
  }
  // Kratzer: hell (blankes Metall) und einige dunkle Riefen
  g.lineCap = 'round';
  for (let i = 0; i < 420; i++) {
    const x = rnd() * S;
    const y = rnd() * S;
    const a = rnd() * Math.PI;
    const l = 6 + rnd() * rnd() * 70;
    const bright = rnd() < 0.7;
    g.strokeStyle = bright ? `rgba(255,255,255,${0.2 + rnd() * 0.35})` : `rgba(60,60,64,${0.15 + rnd() * 0.2})`;
    g.lineWidth = 0.5 + rnd() * 1.1;
    wrapLine(g, S, x, y, x + Math.cos(a) * l, y + Math.sin(a) * l);
  }
  // Rauheit: Flecken rauer, Kratzer glatter
  const [cr, gr] = canvas(256);
  gr.fillStyle = 'rgb(200,200,200)';
  gr.fillRect(0, 0, 256, 256);
  const rnd2 = mulberry32(72);
  blotches(gr, 256, rnd2, 50, 10, 50, (r) => (r < 0.55 ? `rgba(255,255,255,${0.25 + r * 0.3})` : `rgba(90,90,90,${0.2 + r * 0.2})`));
  gr.lineCap = 'round';
  for (let i = 0; i < 160; i++) {
    const x = rnd2() * 256;
    const y = rnd2() * 256;
    const a = rnd2() * Math.PI;
    const l = 4 + rnd2() * 36;
    gr.strokeStyle = `rgba(80,80,80,${0.3 + rnd2() * 0.4})`;
    gr.lineWidth = 0.6 + rnd2();
    wrapLine(gr, 256, x, y, x + Math.cos(a) * l, y + Math.sin(a) * l);
  }
  return { map: tex(c, true, 1 / 0.55), rough: tex(cr, false, 1 / 0.55) };
}

function clothTexture(): THREE.CanvasTexture {
  const S = 256;
  const rnd = mulberry32(81);
  const [c, g] = canvas(S);
  g.fillStyle = 'rgb(222,222,222)';
  g.fillRect(0, 0, S, S);
  // Webstruktur: feine Kett- und Schussfaeden
  for (let i = 0; i < S; i += 2) {
    g.fillStyle = `rgba(255,255,255,${0.05 + rnd() * 0.12})`;
    g.fillRect(i, 0, 1, S);
    g.fillStyle = `rgba(0,0,0,${0.04 + rnd() * 0.1})`;
    g.fillRect(0, i, S, 1);
  }
  // Schmutz und Abnutzung
  blotches(g, S, rnd, 40, 10, 60, (r) => (r < 0.6 ? `rgba(70,55,40,${0.08 + r * 0.12})` : `rgba(255,255,255,${0.06 + r * 0.06})`));
  // einzelne Fadennoppen
  for (let i = 0; i < 500; i++) {
    g.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.16)';
    g.fillRect(Math.floor(rnd() * S), Math.floor(rnd() * S), 1 + Math.floor(rnd() * 3), 1);
  }
  return tex(c, true, 1 / 0.35);
}

function leatherTexture(): THREE.CanvasTexture {
  const S = 256;
  const rnd = mulberry32(91);
  const [c, g] = canvas(S);
  g.fillStyle = 'rgb(210,210,210)';
  g.fillRect(0, 0, S, S);
  blotches(g, S, rnd, 70, 6, 40, (r) => (r < 0.5 ? `rgba(40,30,20,${0.1 + r * 0.2})` : `rgba(255,245,230,${0.08 + r * 0.1})`));
  // Narbung
  for (let i = 0; i < 1600; i++) {
    g.fillStyle = `rgba(30,20,10,${0.08 + rnd() * 0.15})`;
    g.fillRect(rnd() * S, rnd() * S, 1 + rnd() * 1.5, 1 + rnd() * 1.5);
  }
  // Knicke/Falten
  g.lineCap = 'round';
  for (let i = 0; i < 70; i++) {
    const x = rnd() * S;
    const y = rnd() * S;
    const a = rnd() * Math.PI;
    const l = 8 + rnd() * 30;
    g.strokeStyle = `rgba(25,15,8,${0.15 + rnd() * 0.25})`;
    g.lineWidth = 0.8 + rnd() * 1.2;
    wrapLine(g, S, x, y, x + Math.cos(a) * l, y + Math.sin(a) * l);
    g.strokeStyle = `rgba(255,240,220,${0.1 + rnd() * 0.12})`;
    g.lineWidth = 0.6;
    wrapLine(g, S, x + 1, y + 1, x + 1 + Math.cos(a) * l, y + 1 + Math.sin(a) * l);
  }
  return tex(c, true, 1 / 0.3);
}

/** Kettengeflecht: Ringe (Farbe) plus Hoehenfeld -> Normal-Map. */
function chainTextures(): { map: THREE.CanvasTexture; normal: THREE.CanvasTexture } {
  const S = 256;
  const N = 8; // Ringe pro Kachel
  const step = S / N;
  const [c, g] = canvas(S);
  g.fillStyle = 'rgb(58,58,60)';
  g.fillRect(0, 0, S, S);
  const h = new Float32Array(S * S);
  const rOut = step * 0.62;
  const rIn = step * 0.3;
  for (let row = -2; row <= N * 2 + 1; row++) {
    for (let col = -1; col <= N; col++) {
      const cx = col * step + (((row % 2) + 2) % 2 ? step / 2 : 0);
      const cy = row * step * 0.5 + step * 0.25;
      // Farbe
      const grad = g.createRadialGradient(cx - 2, cy - 3, rIn, cx, cy, rOut);
      grad.addColorStop(0, 'rgb(245,245,245)');
      grad.addColorStop(0.55, 'rgb(200,200,204)');
      grad.addColorStop(1, 'rgb(120,120,125)');
      g.fillStyle = grad;
      g.beginPath();
      g.ellipse(cx, cy, rOut, rOut * 0.78, 0, 0, Math.PI * 2);
      g.ellipse(cx, cy, rIn, rIn * 0.7, 0, 0, Math.PI * 2, true);
      g.fill('evenodd');
    }
  }
  // Hoehenfeld analytisch (Torus-Querschnitt)
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let best = 0;
      const row0 = Math.floor((y - step * 0.25) / (step * 0.5));
      for (let row = row0 - 2; row <= row0 + 2; row++) {
        const cy = row * step * 0.5 + step * 0.25;
        const off = ((row % 2) + 2) % 2 ? step / 2 : 0;
        const col0 = Math.round((x - off) / step);
        for (let col = col0 - 1; col <= col0 + 1; col++) {
          const cx = col * step + off;
          let dx = x - cx;
          let dy = (y - cy) / 0.78;
          dx = ((dx + S / 2) % S + S) % S - S / 2;
          dy = ((dy + S / 2) % S + S) % S - S / 2;
          const d = Math.hypot(dx, dy);
          const mid = (rOut + rIn) / 2;
          const w = (rOut - rIn) / 2;
          const t = 1 - Math.abs(d - mid) / w;
          if (t > 0) best = Math.max(best, Math.sqrt(t) * (0.8 + 0.2 * (row % 2)));
        }
      }
      h[y * S + x] = best;
    }
  }
  const [cn, gn] = canvas(S);
  const img = gn.createImageData(S, S);
  const k = 2.2;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const hx = h[y * S + ((x + 1) % S)]! - h[y * S + ((x - 1 + S) % S)]!;
      const hy = h[((y + 1) % S) * S + x]! - h[((y - 1 + S) % S) * S + x]!;
      let nx = -hx * k;
      let ny = hy * k;
      let nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l;
      ny /= l;
      nz /= l;
      const i = (y * S + x) * 4;
      img.data[i] = (nx * 0.5 + 0.5) * 255;
      img.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      img.data[i + 2] = (nz * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  gn.putImageData(img, 0, 0);
  const rep = 1 / 0.13;
  return { map: tex(c, true, rep), normal: tex(cn, false, rep) };
}

/**
 * Kleine Umgebungskarte (Himmel oben, warmer Burghof unten, Fackelschein),
 * damit Metall wie Metall aussieht und nicht schwarz wird.
 */
function envTexture(): THREE.CanvasTexture {
  const W = 256;
  const H = 128;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#7f8c99');
  grad.addColorStop(0.35, '#b4bbc0');
  grad.addColorStop(0.49, '#d9d6cc');
  grad.addColorStop(0.52, '#6d6153');
  grad.addColorStop(0.7, '#4f4539');
  grad.addColorStop(1, '#2e2822');
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  const rnd = mulberry32(5);
  // Mauern als dunklere Bänder knapp ueber dem Horizont
  for (let i = 0; i < 18; i++) {
    const x = rnd() * W;
    const w = 10 + rnd() * 30;
    g.fillStyle = `rgba(80,74,66,${0.35 + rnd() * 0.3})`;
    g.fillRect(x, H * 0.4, w, H * 0.12);
  }
  // Sonne (weich)
  const sx = W * 0.62;
  const sy = H * 0.18;
  const sg = g.createRadialGradient(sx, sy, 0, sx, sy, 26);
  sg.addColorStop(0, 'rgba(255,248,230,1)');
  sg.addColorStop(0.3, 'rgba(255,240,215,0.6)');
  sg.addColorStop(1, 'rgba(255,240,215,0)');
  g.fillStyle = sg;
  g.fillRect(sx - 30, sy - 30, 60, 60);
  // Fackeln
  for (let i = 0; i < 4; i++) {
    const fx = (i + 0.3) * (W / 4);
    const fy = H * 0.47;
    const fg = g.createRadialGradient(fx, fy, 0, fx, fy, 12);
    fg.addColorStop(0, 'rgba(255,180,100,0.35)');
    fg.addColorStop(1, 'rgba(255,150,60,0)');
    g.fillStyle = fg;
    g.fillRect(fx - 14, fy - 14, 28, 28);
  }
  const t = new THREE.CanvasTexture(c);
  t.mapping = THREE.EquirectangularReflectionMapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

export function getFighterMaterials(): FighterMaterials {
  if (cache) return cache;
  const env = envTexture();
  const metalTex = metalTextures();
  const chainTex = chainTextures();
  const metal = new THREE.MeshStandardMaterial({
    name: 'fighter-metal',
    vertexColors: true,
    flatShading: true,
    metalness: 0.8,
    roughness: 0.5,
    map: metalTex.map,
    roughnessMap: metalTex.rough,
    envMap: env,
    envMapIntensity: 0.75,
  });
  const chain = new THREE.MeshStandardMaterial({
    name: 'fighter-chain',
    vertexColors: true,
    flatShading: true,
    metalness: 0.7,
    roughness: 0.55,
    map: chainTex.map,
    normalMap: chainTex.normal,
    normalScale: new THREE.Vector2(0.6, 0.6),
    envMap: env,
    envMapIntensity: 0.8,
  });
  const cloth = new THREE.MeshStandardMaterial({
    name: 'fighter-cloth',
    vertexColors: true,
    flatShading: true,
    metalness: 0,
    roughness: 0.95,
    map: clothTexture(),
  });
  const leather = new THREE.MeshStandardMaterial({
    name: 'fighter-leather',
    vertexColors: true,
    flatShading: true,
    metalness: 0,
    roughness: 0.72,
    map: leatherTexture(),
  });
  const skin = new THREE.MeshStandardMaterial({
    name: 'fighter-skin',
    vertexColors: true,
    flatShading: true,
    metalness: 0,
    roughness: 0.78,
  });
  cache = { metal, chain, cloth, leather, skin };
  return cache;
}
