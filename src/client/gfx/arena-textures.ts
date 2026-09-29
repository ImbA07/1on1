import * as THREE from 'three';
import { fbm, mulberry32, smoothstep, vnoise, clamp01, WALL_INNER } from './arena-common.js';

// Prozedurale Texturen. "Gepackt" heisst: R/G = Normalen-XY, B = Hoehe, A = Zufallswert pro Stein.
// So reicht eine einzige Textur pro Oberflaeche (Farbe entsteht im Shader aus Palette + Hoehe).

function makeData(size: number, data: Uint8Array<ArrayBuffer>, repeat: number, colorSpace: THREE.ColorSpace = THREE.NoColorSpace): THREE.DataTexture {
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.colorSpace = colorSpace;
  t.repeat.set(1 / repeat, 1 / repeat);
  t.needsUpdate = true;
  return t;
}

/** Schreibt Normalen aus einem Hoehenfeld (kachelbar) in das gepackte Format. */
function packHeight(size: number, height: Float32Array, rnd: Float32Array, strength: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(size * size * 4);
  const at = (x: number, y: number) => height[((y + size) % size) * size + ((x + size) % size)]!;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const inv = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const i = (y * size + x) * 4;
      out[i] = Math.round((-dx * inv * 0.5 + 0.5) * 255);
      out[i + 1] = Math.round((-dy * inv * 0.5 + 0.5) * 255);
      out[i + 2] = Math.round(clamp01(height[y * size + x]!) * 255);
      out[i + 3] = Math.round(clamp01(rnd[y * size + x]!) * 255);
    }
  }
  return out;
}

/** Kopfsteinpflaster (Voronoi), kachelbar. Kachel = tile Meter. */
export function cobbleTexture(tile: number): THREE.DataTexture {
  const size = 512;
  const cells = 21;
  const rand = mulberry32(99);
  const pts: Array<[number, number, number, number, number]> = []; // x, y, rand, crackAngle, crack?
  for (let j = 0; j < cells; j++) {
    for (let i = 0; i < cells; i++) {
      // Reihen leicht versetzt, damit es nach verlegtem Pflaster aussieht
      const off = (j % 2) * 0.5;
      pts.push([i + off + (rand() - 0.5) * 0.55, j + 0.5 + (rand() - 0.5) * 0.45, rand(), rand() * Math.PI, rand() < 0.1 ? 1 : 0]);
    }
  }
  const height = new Float32Array(size * size);
  const rnd = new Float32Array(size * size);
  const sc = cells / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x * sc;
      const py = y * sc;
      const ci = Math.floor(px);
      const cj = Math.floor(py);
      let d1 = 1e9;
      let d2 = 1e9;
      let best: [number, number, number, number, number] = pts[0]!;
      let bx = 0;
      let by = 0;
      for (let oj = -2; oj <= 2; oj++) {
        for (let oi = -2; oi <= 2; oi++) {
          const ii = ci + oi;
          const jj = cj + oj;
          const wi = ((ii % cells) + cells) % cells;
          const wj = ((jj % cells) + cells) % cells;
          const p = pts[wj * cells + wi]!;
          const qx = p[0] + (ii - wi);
          const qy = p[1] + (jj - wj);
          const dx = (px - qx) * 0.85;
          const dy = py - qy;
          const d = dx * dx + dy * dy;
          if (d < d1) {
            d2 = d1;
            d1 = d;
            best = p;
            bx = qx;
            by = qy;
          } else if (d < d2) d2 = d;
        }
      }
      const edge = Math.sqrt(d2) - Math.sqrt(d1);
      const n = fbm(px * 3, py * 3, 5, 3, cells * 3);
      const e = edge + (n - 0.5) * 0.12;
      let h = smoothstep(0.02, 0.2, e);
      h = Math.pow(h, 0.8) * (0.78 + best[2] * 0.22);
      // leichte Woelbung
      h *= 1 - Math.min(1, d1) * 0.25;
      h += (vnoise(px * 14, py * 14, 7, cells * 14) - 0.5) * 0.08 * h;
      // Risse in einzelnen Steinen
      if (best[4] && h > 0.3) {
        const ca = Math.cos(best[3]);
        const sa = Math.sin(best[3]);
        const lx = px - bx;
        const ly = py - by;
        const dist = Math.abs(lx * sa - ly * ca + (vnoise(px * 8, py * 8, 3) - 0.5) * 0.08);
        if (dist < 0.035) h -= 0.35 * (1 - dist / 0.035);
      }
      height[y * size + x] = h;
      rnd[y * size + x] = best[2];
    }
  }
  return makeData(size, packHeight(size, height, rnd, 3.2), tile);
}

/** Quadermauerwerk mit versetzten Fugen. */
export function stoneTexture(tile: number): THREE.DataTexture {
  const size = 512;
  const rows = 8;
  const rand = mulberry32(4242);
  const rowH = size / rows;
  const bounds: number[][] = [];
  const rnds: number[][] = [];
  for (let r = 0; r < rows; r++) {
    const b: number[] = [];
    const rr: number[] = [];
    let x = rand() * 60;
    const start = x;
    while (x < start + size - 40) {
      b.push(x);
      rr.push(rand());
      x += 55 + rand() * 95;
    }
    b.push(start + size);
    bounds.push(b);
    rnds.push(rr);
  }
  const height = new Float32Array(size * size);
  const rnd = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    const r = Math.floor(y / rowH);
    const ly = y - r * rowH;
    const b = bounds[r]!;
    const rr = rnds[r]!;
    for (let x = 0; x < size; x++) {
      // Position relativ zum Zeilenanfang (kachelbar)
      let xx = x;
      if (xx < b[0]!) xx += size;
      let k = 0;
      while (k < b.length - 2 && xx >= b[k + 1]!) k++;
      const x0 = b[k]!;
      const x1 = b[k + 1]!;
      const jag = (vnoise(x / 8, y / 8, 11, size / 8) - 0.5) * 4.5;
      const dx = Math.min(xx - x0, x1 - xx) + jag;
      const dy = Math.min(ly, rowH - ly) + jag * 0.7;
      const e = Math.min(dx, dy);
      const sr = rr[k]!;
      let h = smoothstep(2.0, 9 + sr * 6, e);
      const face = fbm(x / 32, y / 32, 21, 4, size / 32);
      h = h * (0.72 + face * 0.35 + sr * 0.08);
      // Kissenform
      const cx = ((xx - x0) / (x1 - x0)) * 2 - 1;
      const cy = (ly / rowH) * 2 - 1;
      h -= (cx * cx * 0.06 + cy * cy * 0.1) * h;
      h += (vnoise(x / 4, y / 4, 5, size / 4) - 0.5) * 0.06;
      height[y * size + x] = h;
      rnd[y * size + x] = sr;
    }
  }
  return makeData(size, packHeight(size, height, rnd, 3.0), tile);
}

/** Biberschwanz-Dachziegel. */
export function roofTexture(tile: number): THREE.DataTexture {
  const size = 256;
  const rows = 8;
  const cols = 8;
  const rh = size / rows;
  const cw = size / cols;
  const rand = mulberry32(777);
  const tileRnd: number[] = [];
  for (let i = 0; i < rows * cols; i++) tileRnd.push(rand());
  const height = new Float32Array(size * size);
  const rnd = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    const r = Math.floor(y / rh);
    const ly = (y - r * rh) / rh; // 0 unten .. 1 oben (v zeigt den Hang hinauf)
    for (let x = 0; x < size; x++) {
      const off = (r % 2) * cw * 0.5;
      const xx = (x + off) % size;
      const c = Math.floor(xx / cw);
      const lx = (xx - c * cw) / cw - 0.5; // -0.5..0.5
      // runde Unterkante: Ziegelkante liegt bei ly = 0.18*(1-(2lx)^2)
      const edgeY = 0.22 * (1 - Math.pow(Math.abs(lx) * 2, 2.2));
      let h: number;
      const tr = tileRnd[(r * cols + c) % tileRnd.length]!;
      if (ly >= 0.2 - edgeY * 0.2 && ly > 0.02) {
        h = 0.35 + ly * 0.55;
        const side = Math.abs(lx) * 2;
        h *= 1 - smoothstep(0.86, 1.0, side) * 0.6;
        h *= 1 - (1 - smoothstep(0.0, 0.08, ly - (0.2 - edgeY * 0.2))) * 0.5;
      } else {
        h = 0.1 + ly * 0.4; // darunterliegender Ziegel
      }
      h += (vnoise(x / 4, y / 4, 3, size / 4) - 0.5) * 0.08;
      height[y * size + x] = h;
      rnd[y * size + x] = tr;
    }
  }
  return makeData(size, packHeight(size, height, rnd, 2.2), tile);
}

/** Holzbretter, Maserung entlang u. A = Maserungshelligkeit. */
export function woodTexture(tile: number): THREE.DataTexture {
  const size = 256;
  const planks = 10;
  const ph = size / planks;
  const rand = mulberry32(31337);
  const joints: number[] = [];
  const shade: number[] = [];
  for (let i = 0; i < planks; i++) {
    joints.push(rand() * size);
    shade.push(rand());
  }
  const height = new Float32Array(size * size);
  const grain = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    const p = Math.floor(y / ph);
    const ly = y - p * ph;
    for (let x = 0; x < size; x++) {
      const gap = Math.min(ly, ph - ly);
      const jd = Math.abs(((x - joints[p]! + size * 1.5) % size) - size / 2);
      const jointDist = size / 2 - jd;
      let h = smoothstep(0.5, 2.5, gap) * smoothstep(0.5, 2.0, jointDist);
      const g1 = fbm(x / 32, y / 2.2 + p * 13, 9 + p, 3, size / 32);
      const streak = Math.sin((y + g1 * 12) * 0.9) * 0.5 + 0.5;
      let gr = 0.55 + (g1 - 0.5) * 0.7 + streak * 0.15 + (shade[p]! - 0.5) * 0.35;
      // Astloch
      const kx = ((x - joints[p]! * 0.37 + size) % size) - size / 2;
      const ky = ly - ph / 2;
      const kd = Math.sqrt((kx * kx) / 16 + ky * ky);
      if (shade[p]! > 0.6 && kd < 4) gr -= (1 - kd / 4) * 0.45;
      h *= 0.85 + g1 * 0.25;
      height[y * size + x] = h;
      grain[y * size + x] = clamp01(gr);
    }
  }
  return makeData(size, packHeight(size, height, grain, 2.0), tile);
}

/**
 * Masken fuer den Hofboden (Weltbereich -18..18 m):
 * R = Erde/Sand, G = Pfuetzen, B = Abnutzung, A = Moos/Gruen in den Fugen.
 */
export const MASK_EXTENT = 36;
export function groundMask(): THREE.DataTexture {
  const size = 256;
  const data = new Uint8Array(size * size * 4);
  const rand = mulberry32(5150);
  // ein paar gezielte Pfuetzen
  const puddles: Array<[number, number, number]> = [];
  for (let i = 0; i < 9; i++) {
    const a = rand() * Math.PI * 2;
    const r = 4 + rand() * 9.5;
    puddles.push([Math.sin(a) * r, Math.cos(a) * r, 0.6 + rand() * 1.1]);
  }
  puddles.push([0.9, -12.8, 1.2], [-0.8, -10.5, 0.8], [2.5, 3.5, 0.7]);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const wx = (x / size - 0.5) * MASK_EXTENT;
      const wz = (y / size - 0.5) * MASK_EXTENT;
      const r = Math.hypot(wx, wz);
      const n1 = fbm(wx * 0.22, wz * 0.22, 1, 5);
      const n2 = fbm(wx * 0.6 + 40, wz * 0.6, 2, 4);
      // Erde: Randzone (zwischen Kampfkreis und Mauer) fast voll, innen Flecken
      let dirt = smoothstep(0.52, 0.72, n1) * 0.75;
      dirt += 0.38 * Math.exp(-Math.pow(r / 4.5, 2)) * (0.6 + n2 * 0.8);
      dirt = Math.max(dirt, smoothstep(11.8, 12.6, r) * (0.7 + n2 * 0.4));
      dirt *= 1 - smoothstep(14.4, 15.2, r) * 0.25;
      // Weg vom Tor (-Z) zur Mitte
      const path = Math.exp(-Math.pow(wx / 1.6, 2)) * smoothstep(0, -4, wz);
      dirt = Math.max(dirt, path * (0.45 + n2 * 0.4));
      // Abnutzung: Ring um die Mitte (Fussspuren), Weg
      let wear = Math.exp(-Math.pow((r - 4.5) / 3.2, 2)) * 0.7 + Math.exp(-Math.pow(r / 2.5, 2)) * 0.4;
      wear += path * 0.5;
      const rut = Math.exp(-Math.pow((Math.abs(wx) - 0.75) / 0.18, 2)) * smoothstep(-2, -8, wz);
      wear += rut * 0.6;
      wear *= 0.75 + n2 * 0.5;
      // Pfuetzen
      let pud = smoothstep(0.66, 0.8, fbm(wx * 0.35 + 9, wz * 0.35 - 3, 3, 4)) * 0.7;
      for (const [px, pz, pr] of puddles) {
        const d = Math.hypot(wx - px, wz - pz) / pr;
        pud = Math.max(pud, (1 - smoothstep(0.35, 1.0, d + (n2 - 0.5) * 0.6)) * 0.95);
      }
      pud = Math.max(pud, rut * smoothstep(0.45, 0.6, n2) * 0.9);
      pud *= 1 - smoothstep(14.2, 14.9, r);
      // Moos an der Mauer und in ruhigen Ecken
      let moss = smoothstep(13.2, 14.9, r) * smoothstep(0.35, 0.65, n2);
      moss = Math.max(moss, smoothstep(0.62, 0.8, fbm(wx * 0.3, wz * 0.3, 8, 3)) * smoothstep(7, 11, r) * 0.6);
      const i = (y * size + x) * 4;
      data[i] = Math.round(clamp01(dirt) * 255);
      data[i + 1] = Math.round(clamp01(pud) * 255);
      data[i + 2] = Math.round(clamp01(wear) * 255);
      data[i + 3] = Math.round(clamp01(moss) * 255);
    }
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

// ------------------------------------------------------------------ Stoff: Banner-Atlas

export const BANNER_CELLS = { cols: 4, rows: 2 };
/** Farben der 8 Wappen (Grund, Figur). Zelle 7 = Streifen fuer Markisen/Behaenge. */
export const HERALDRY: Array<[string, string]> = [
  ['#9e1f1a', '#e3b53c'], // rot / gold: Loewe (Stern)
  ['#1f4f8f', '#e8e2d0'], // blau / silber: Kreuz
  ['#2f6b36', '#e3b53c'], // gruen / gold: Sparren
  ['#1d1b1a', '#d9a62b'], // schwarz / gold: Adler
  ['#e6ddc6', '#a3241d'], // silber / rot: Turm
  ['#5a2a6e', '#e3b53c'], // purpur / gold: Lilie
  ['#b0641c', '#1d1b1a'], // orange / schwarz: Balken
  ['#a3241d', '#e3b53c'], // Streifen rot / gelb
];

export function bannerAtlas(): THREE.CanvasTexture {
  const W = 512;
  const H = 512;
  const cw = W / BANNER_CELLS.cols;
  const ch = H / BANNER_CELLS.rows;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const g = cv.getContext('2d')!;
  const rand = mulberry32(12);
  for (let i = 0; i < 8; i++) {
    const x0 = (i % BANNER_CELLS.cols) * cw;
    const y0 = Math.floor(i / BANNER_CELLS.cols) * ch;
    const [bg, fg] = HERALDRY[i]!;
    g.save();
    g.translate(x0, y0);
    g.beginPath();
    g.rect(0, 0, cw, ch);
    g.clip();
    g.fillStyle = bg;
    g.fillRect(0, 0, cw, ch);
    if (i === 7) {
      for (let s = 0; s < 8; s++) {
        g.fillStyle = s % 2 ? fg : bg;
        g.fillRect((s * cw) / 8, 0, cw / 8, ch);
      }
    } else {
      // Bordure
      g.strokeStyle = fg;
      g.lineWidth = 5;
      g.strokeRect(9, 9, cw - 18, ch - 18);
      g.setLineDash([3, 4]);
      g.lineWidth = 1.5;
      g.strokeStyle = 'rgba(255,240,200,0.5)';
      g.strokeRect(15, 15, cw - 30, ch - 30);
      g.setLineDash([]);
      drawCharge(g, i, cw / 2, ch * 0.4, cw * 0.36, fg, bg);
    }
    // Webstruktur, Falten, Abnutzung
    for (let k = 0; k < 900; k++) {
      g.fillStyle = `rgba(0,0,0,${rand() * 0.06})`;
      g.fillRect(rand() * cw, rand() * ch, 1, 1 + rand() * 6);
    }
    const fold = g.createLinearGradient(0, 0, cw, 0);
    for (let f = 0; f <= 6; f++) fold.addColorStop(f / 6, f % 2 ? 'rgba(0,0,0,0.14)' : 'rgba(255,255,255,0.05)');
    g.fillStyle = fold;
    g.fillRect(0, 0, cw, ch);
    const vig = g.createLinearGradient(0, 0, 0, ch);
    vig.addColorStop(0, 'rgba(0,0,0,0.25)');
    vig.addColorStop(0.15, 'rgba(0,0,0,0)');
    vig.addColorStop(0.85, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(20,10,0,0.35)');
    g.fillStyle = vig;
    g.fillRect(0, 0, cw, ch);
    g.restore();
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

function drawCharge(g: CanvasRenderingContext2D, kind: number, cx: number, cy: number, s: number, fg: string, bg: string): void {
  g.fillStyle = fg;
  g.strokeStyle = fg;
  g.save();
  g.translate(cx, cy);
  switch (kind) {
    case 0: {
      // gekroenter Stern / Sonne
      g.beginPath();
      for (let i = 0; i < 16; i++) {
        const r = i % 2 ? s * 0.42 : s * 0.95;
        const a = (i / 16) * Math.PI * 2;
        g.lineTo(Math.sin(a) * r, -Math.cos(a) * r);
      }
      g.closePath();
      g.fill();
      g.fillStyle = bg;
      g.beginPath();
      g.arc(0, 0, s * 0.3, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = fg;
      g.beginPath();
      g.arc(0, 0, s * 0.18, 0, Math.PI * 2);
      g.fill();
      break;
    }
    case 1: {
      const w = s * 0.32;
      g.fillRect(-w / 2, -s * 1.1, w, s * 2.6);
      g.fillRect(-s * 0.95, -w / 2 - s * 0.2, s * 1.9, w);
      break;
    }
    case 2: {
      g.lineWidth = s * 0.36;
      for (const dy of [-0.3, 0.55]) {
        g.beginPath();
        g.moveTo(-s * 1.1, s * (0.6 + dy));
        g.lineTo(0, s * (-0.35 + dy));
        g.lineTo(s * 1.1, s * (0.6 + dy));
        g.stroke();
      }
      break;
    }
    case 3: {
      // stilisierter Adler
      g.beginPath();
      g.moveTo(0, -s * 0.9);
      g.lineTo(s * 0.18, -s * 0.55);
      g.lineTo(s * 0.2, -s * 0.2);
      for (let f = 0; f < 5; f++) {
        g.lineTo(s * (0.45 + f * 0.13), -s * (0.55 - f * 0.12));
        g.lineTo(s * (0.4 + f * 0.13), -s * (0.3 - f * 0.12));
      }
      g.lineTo(s * 0.25, s * 0.3);
      g.lineTo(s * 0.45, s * 0.95);
      g.lineTo(0, s * 0.6);
      g.lineTo(-s * 0.45, s * 0.95);
      g.lineTo(-s * 0.25, s * 0.3);
      for (let f = 4; f >= 0; f--) {
        g.lineTo(-s * (0.4 + f * 0.13), -s * (0.3 - f * 0.12));
        g.lineTo(-s * (0.45 + f * 0.13), -s * (0.55 - f * 0.12));
      }
      g.lineTo(-s * 0.2, -s * 0.2);
      g.lineTo(-s * 0.18, -s * 0.55);
      g.closePath();
      g.fill();
      break;
    }
    case 4: {
      // Turm
      g.fillRect(-s * 0.45, -s * 0.4, s * 0.9, s * 1.3);
      for (let k = -2; k <= 2; k += 2) g.fillRect(k * s * 0.2 - s * 0.12, -s * 0.72, s * 0.24, s * 0.4);
      g.fillStyle = bg;
      g.beginPath();
      g.moveTo(-s * 0.18, s * 0.9);
      g.lineTo(-s * 0.18, s * 0.45);
      g.arc(0, s * 0.45, s * 0.18, Math.PI, 0);
      g.lineTo(s * 0.18, s * 0.9);
      g.fill();
      g.fillRect(-s * 0.06, -s * 0.15, s * 0.12, s * 0.28);
      break;
    }
    case 5: {
      // Lilie
      g.beginPath();
      g.moveTo(0, -s);
      g.bezierCurveTo(s * 0.35, -s * 0.6, s * 0.3, -s * 0.1, 0, s * 0.2);
      g.bezierCurveTo(-s * 0.3, -s * 0.1, -s * 0.35, -s * 0.6, 0, -s);
      g.fill();
      for (const sx of [-1, 1]) {
        g.beginPath();
        g.moveTo(sx * s * 0.1, 0);
        g.bezierCurveTo(sx * s * 0.9, -s * 0.6, sx * s * 1.1, s * 0.1, sx * s * 0.6, s * 0.45);
        g.bezierCurveTo(sx * s * 0.75, s * 0.05, sx * s * 0.45, -s * 0.05, sx * s * 0.1, s * 0.2);
        g.fill();
      }
      g.fillRect(-s * 0.55, s * 0.15, s * 1.1, s * 0.16);
      g.beginPath();
      g.moveTo(-s * 0.12, s * 0.3);
      g.lineTo(s * 0.12, s * 0.3);
      g.lineTo(0, s * 0.85);
      g.fill();
      break;
    }
    default: {
      g.save();
      g.rotate(-0.6);
      g.fillRect(-s * 1.6, -s * 0.2, s * 3.2, s * 0.4);
      g.restore();
      g.beginPath();
      g.arc(-s * 0.5, s * 0.55, s * 0.15, 0, Math.PI * 2);
      g.arc(s * 0.5, -s * 0.55, s * 0.15, 0, Math.PI * 2);
      g.fill();
    }
  }
  g.restore();
}

/** UV-Rechteck (u0, v0, u1, v1) einer Atlas-Zelle. v=1 ist oben. */
export function bannerCell(i: number): [number, number, number, number] {
  const c = i % BANNER_CELLS.cols;
  const r = Math.floor(i / BANNER_CELLS.cols);
  const u0 = c / BANNER_CELLS.cols;
  const u1 = (c + 1) / BANNER_CELLS.cols;
  const v1 = 1 - r / BANNER_CELLS.rows;
  const v0 = 1 - (r + 1) / BANNER_CELLS.rows;
  return [u0 + 0.002, v0 + 0.002, u1 - 0.002, v1 - 0.002];
}

// ------------------------------------------------------------------ Efeu

export function ivyTexture(): THREE.CanvasTexture {
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = S;
  cv.height = S;
  const g = cv.getContext('2d')!;
  const rand = mulberry32(808);
  // Ranken von unten nach oben verzweigt, dicht mit kleinen Blaettern
  const leaves: Array<[number, number, number, number]> = [];
  const grow = (x: number, y: number, a: number, len: number, depth: number) => {
    g.strokeStyle = 'rgba(58,44,28,1)';
    g.lineWidth = Math.max(0.8, 2.2 - depth * 0.6);
    g.beginPath();
    g.moveTo(x, y);
    for (let i = 0; i < len; i++) {
      a += (rand() - 0.5) * 0.6;
      x += Math.sin(a) * 4;
      y -= Math.cos(a) * 4;
      g.lineTo(x, y);
      for (let k = 0; k < 2; k++) {
        if (rand() < 0.8) leaves.push([x + (rand() - 0.5) * 9, y + (rand() - 0.5) * 9, 3 + rand() * 3.2, rand()]);
      }
      if (depth < 3 && rand() < 0.1) grow(x, y, a + (rand() < 0.5 ? -0.9 : 0.9), Math.floor(len * 0.55), depth + 1);
    }
    g.stroke();
  };
  for (let i = 0; i < 9; i++) grow(S * 0.3 + rand() * S * 0.4, S + 4, (rand() - 0.5) * 0.9, 40 + Math.floor(rand() * 25), 0);
  for (const [x, y, s, r] of leaves) {
    const dx = Math.abs((x - S / 2) / (S / 2));
    const up = 1 - y / S; // 0 unten, 1 oben
    const lim = 0.92 - 0.62 * Math.pow(up, 1.3) + (vnoise(x / 20, y / 20, 3) - 0.5) * 0.35;
    if (dx > lim || up > 0.97) continue;
    const l = 14 + r * 18;
    g.fillStyle = `hsl(${98 + r * 30}, ${26 + r * 16}%, ${l}%)`;
    g.save();
    g.translate(x, y);
    g.rotate(r * 6.28);
    g.beginPath();
    g.moveTo(0, -s);
    g.quadraticCurveTo(s, -s * 0.4, s * 0.6, s * 0.5);
    g.quadraticCurveTo(0, s * 0.2, -s * 0.6, s * 0.5);
    g.quadraticCurveTo(-s, -s * 0.4, 0, -s);
    g.fill();
    if (r > 0.7) {
      g.fillStyle = 'rgba(200,220,160,0.18)';
      g.beginPath();
      g.arc(-s * 0.2, -s * 0.2, s * 0.35, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export const COURT_RADIUS = WALL_INNER + 0.6;
