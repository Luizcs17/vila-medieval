import type Phaser from 'phaser';
import { TILE_H, TILE_W } from '../config';

/**
 * Provisional pixel art, generated in code at boot so the game runs without asset files.
 * Each texture key here is a stable name; real art can later replace a key one-for-one
 * by loading an image with the same key in a preload step.
 */

type RGB = [number, number, number];

function hex(c: string): RGB {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Small deterministic RNG so the placeholder art is identical every run. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function paint(scene: Phaser.Scene, key: string, w: number, h: number, pixel: (x: number, y: number) => RGB | null): void {
  const tex = scene.textures.createCanvas(key, w, h);
  if (!tex) throw new Error(`could not create texture ${key}`);
  const ctx = tex.getContext();
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = pixel(x, y);
      if (!c) continue;
      const o = (y * w + x) * 4;
      img.data[o] = c[0];
      img.data[o + 1] = c[1];
      img.data[o + 2] = c[2];
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  tex.refresh();
}

function fromRows(scene: Phaser.Scene, key: string, rows: string[], palette: Record<string, string>): void {
  const pal: Record<string, RGB> = {};
  for (const k in palette) pal[k] = hex(palette[k]);
  paint(scene, key, rows[0].length, rows.length, (x, y) => pal[rows[y][x]] ?? null);
}

// ---------- ground tiles ----------

/** Diamond test with a hair of overlap so neighbouring tiles leave no seams. */
function inDiamond(x: number, y: number): number {
  return Math.abs(x + 0.5 - TILE_W / 2) / (TILE_W / 2) + Math.abs(y + 0.5 - TILE_H / 2) / (TILE_H / 2);
}

function groundTile(scene: Phaser.Scene, key: string, colors: string[], seed: number, speck?: string): void {
  const pal = colors.map(hex);
  const sp = speck ? hex(speck) : null;
  const r = rng(seed);
  paint(scene, key, TILE_W, TILE_H, (x, y) => {
    const d = inDiamond(x, y);
    if (d > 1.06) return null;
    const v = r();
    if (sp && v > 0.985) return sp;
    // Slightly darker toward the bottom edges for tile definition.
    const shade = y > TILE_H / 2 && d > 0.85 ? 1 : 0;
    const idx = Math.min(pal.length - 1, Math.floor(v * (pal.length - 1)) + shade);
    return pal[idx];
  });
}

// ---------- sprites ----------

const PLAYER_PALETTE = {
  k: '#2b1d14', // outline
  h: '#6b3e1f', // hair
  s: '#e8b48a', // skin
  t: '#3c6e9e', // tunic
  T: '#2a4f73', // tunic shade
  b: '#5a3a1a', // belt
  p: '#4a3b2a', // trousers
  f: '#2b1d14', // boots
};

const PLAYER_BODY = [
  '..kkkkkk..',
  '.khhhhhhk.',
  '.khhhhhhk.',
  '.khsssshk.',
  '.kskssksk.',
  '.kssssssk.',
  '..kkkkkk..',
  '.kttttttk.',
  'kttTttTttk',
  'ksttttttsk',
  'ksbbbbbbsk',
  '.kttttttk.',
];

const LEGS_IDLE = ['.kppkkppk.', '.kppkkppk.', '.kffkkffk.', '..kk..kk..'];
const LEGS_STEP = ['.kppkkppk.', '.kffk.kppk', '..kk..kffk', '......kk..'];

function mirror(rows: string[]): string[] {
  return rows.map((r) => r.split('').reverse().join(''));
}

/** Longer hair framing the face (rows 3-5, outline columns become hair). */
function withLongHair(rows: string[]): string[] {
  return rows.map((r, y) => (y >= 3 && y <= 5 ? `${'h'.padStart(2, '.') + r.slice(2, 8)}h.` : r));
}

/** Creates `${prefix}_idle`, `${prefix}_step_a`, `${prefix}_step_b` for a character. */
function person(scene: Phaser.Scene, prefix: string, palette: Record<string, string>, longHair: boolean): void {
  const body = longHair ? withLongHair(PLAYER_BODY) : PLAYER_BODY;
  fromRows(scene, `${prefix}_idle`, [...body, ...LEGS_IDLE], palette);
  fromRows(scene, `${prefix}_step_a`, [...body, ...LEGS_STEP], palette);
  fromRows(scene, `${prefix}_step_b`, [...body, ...mirror(LEGS_STEP)], palette);
}

const NPC_TUNICS: [string, string][] = [
  ['#a83a32', '#7a2a24'],
  ['#4a7a3a', '#355a2a'],
  ['#8a6a44', '#6a5034'],
  ['#6a4a8a', '#4e3668'],
  ['#7a7a7a', '#5a5a5a'],
  ['#c8a040', '#9a7a30'],
  ['#3a8a8a', '#2a6666'],
  ['#c06a30', '#904e24'],
];
const NPC_HAIR = ['#2b1d14', '#d8b860', '#6b3e1f', '#a8462a', '#9a9a9a'];
const NPC_SKIN = ['#e8b48a', '#c88e64', '#8e5e3e'];

/** NPC sprite key prefix for a colour variant and gender. */
export const npcSpriteKey = (variant: number, gender: 'f' | 'm') => `npc_${variant}_${gender}`;

function tree(scene: Phaser.Scene, key: string, seed: number): void {
  const r = rng(seed);
  const leaf = ['#2f5d2a', '#3b7332', '#4c8a3b', '#5fa046'].map(hex);
  const trunk = ['#5a3a1a', '#6e4824'].map(hex);
  const outline = hex('#1c2b14');
  const blobs = [
    { x: 12, y: 13, r: 9 },
    { x: 7, y: 17, r: 6 },
    { x: 17, y: 17, r: 6 },
    { x: 12, y: 7, r: 6 },
  ];
  paint(scene, key, 24, 34, (x, y) => {
    const cx = x + 0.5;
    const cy = y + 0.5;
    let inside = false;
    let edge = false;
    for (const b of blobs) {
      const d = Math.hypot(cx - b.x, cy - b.y);
      if (d < b.r) inside = true;
      else if (d < b.r + 1) edge = true;
    }
    if (inside) {
      // Light from the top-left.
      const light = (24 - x + (34 - y)) / 58;
      const idx = Math.max(0, Math.min(3, Math.floor(light * 3 + r() * 1.2)));
      return leaf[idx];
    }
    if (edge && y < 26) return outline;
    if (x >= 10 && x <= 13 && y >= 20 && y <= 33) return x === 10 ? outline : trunk[x === 11 ? 1 : 0];
    return null;
  });
}

function pine(scene: Phaser.Scene, key: string, seed: number): void {
  const r = rng(seed);
  const leaf = ['#1f4a2c', '#2a5e36', '#357042'].map(hex);
  const trunk = hex('#5a3a1a');
  const outline = hex('#14261a');
  paint(scene, key, 20, 36, (x, y) => {
    const cx = x + 0.5;
    // Three stacked triangles.
    for (const [top, bottom, half] of [
      [1, 14, 6],
      [8, 22, 8],
      [15, 30, 10],
    ]) {
      if (y >= top && y < bottom) {
        const width = ((y - top) / (bottom - top)) * half;
        const dx = Math.abs(cx - 10);
        if (dx < width) return leaf[Math.min(2, Math.floor((cx < 10 ? 1.4 : 0.4) + r() * 1.2))];
        if (dx < width + 1) return outline;
      }
    }
    if (x >= 9 && x <= 10 && y >= 30) return trunk;
    return null;
  });
}

function rock(scene: Phaser.Scene, key: string, seed: number, ore: boolean): void {
  const r = rng(seed);
  const stone = ['#5d5a57', '#76726d', '#8f8a83', '#a8a29a'].map(hex);
  const rust = ['#b0602a', '#d0843f'].map(hex);
  const outline = hex('#2a2724');
  paint(scene, key, 16, 12, (x, y) => {
    const dx = (x + 0.5 - 8) / 7.5;
    const dy = (y + 0.5 - 7) / 5;
    const d = dx * dx + dy * dy;
    if (y < 2 && Math.abs(x - 8) > 4) return null;
    if (d > 1) return null;
    if (d > 0.78) return outline;
    if (ore && r() < 0.14) return rust[r() < 0.5 ? 0 : 1];
    const light = 1 - (dx + dy + 2) / 4;
    return stone[Math.max(0, Math.min(3, Math.floor(light * 4 + r() * 0.8)))];
  });
}

function stump(scene: Phaser.Scene, key: string): void {
  fromRows(scene, key, ['..kkkkkk..', '.krrRRrrk.', 'krRrrrrRrk', 'kbrrRRrrbk', 'kBbkkkkbBk', 'kBbbbbbbBk', '.kkkkkkkk.'], {
    k: '#2b1d14',
    r: '#d9b27a',
    R: '#b8915c',
    b: '#6e4824',
    B: '#5a3a1a',
  });
}

/** Central stockpile: a wooden platform with crates and a log pile. */
function stockpile(scene: Phaser.Scene, key: string): void {
  const outline = hex('#2b1d14');
  const plank = hex('#7a5230');
  const plankDark = hex('#5e3d22');
  const crate = hex('#a0703a');
  const crateDark = hex('#7d5228');
  const logEnd = hex('#d9b27a');
  const log = hex('#6e4824');
  const W = 32;
  const H = 28;
  paint(scene, key, W, H, (x, y) => {
    // Crates (drawn first so they sit on top of the platform).
    const box = (x0: number, y0: number, x1: number, y1: number): RGB | null => {
      if (x < x0 || x > x1 || y < y0 || y > y1) return null;
      if (x === x0 || x === x1 || y === y0 || y === y1) return outline;
      if (x - x0 === y - y0 || x1 - x === y - y0) return crateDark; // cross brace
      return crate;
    };
    const top = box(8, 1, 15, 8);
    if (top) return top;
    const big = box(5, 8, 16, 19);
    if (big) return big;
    // Log pile: three logs with light ring ends on the right.
    for (const [ly, lx0] of [
      [12, 17],
      [15, 16],
      [9, 19],
    ] as const) {
      if (y >= ly && y <= ly + 2 && x >= lx0 && x <= lx0 + 10) {
        if (y === ly || y === ly + 2) return outline;
        return x >= lx0 + 9 ? logEnd : log;
      }
    }
    // Platform diamond.
    const d = Math.abs(x + 0.5 - 16) / 15 + Math.abs(y + 0.5 - 21) / 6.5;
    if (y >= 14 && d <= 1) return d > 0.85 ? outline : (x + y) % 4 === 0 ? plankDark : plank;
    return null;
  });
}

const ICON_ROWS: Record<string, { rows: string[]; palette: Record<string, string> }> = {
  icon_wood: {
    rows: ['........', '.kkkkkk.', 'kbbbbbrk', 'kBBBBBrk', '.kkkkkk.', 'kbbbbbrk', 'kBBBBBrk', '.kkkkkk.'],
    palette: { k: '#2b1d14', b: '#8a5a2b', B: '#6e4824', r: '#d9b27a' },
  },
  icon_stone: {
    rows: ['........', '..kkkk..', '.klllgk.', 'kllggggk', 'klggggdk', 'kggggddk', '.kddddk.', '..kkkk..'],
    palette: { k: '#2a2724', l: '#c2bcb3', g: '#8f8a83', d: '#5d5a57' },
  },
  icon_iron: {
    rows: ['........', '..kkkk..', '.kllogk.', 'kllggogk', 'klogggdk', 'kggoggdk', '.kddddk.', '..kkkk..'],
    palette: { k: '#2a2724', l: '#c2bcb3', g: '#8f8a83', d: '#5d5a57', o: '#d0843f' },
  },
  icon_meat: {
    rows: ['........', '..kkkk..', '.krrrrk.', 'krrwrrrk', 'krrrrRrk', 'kRrrrRRk', '.kRRRRk.', '..kkkk..'],
    palette: { k: '#2b1d14', r: '#c0453a', R: '#8e2e27', w: '#f0d0c0' },
  },
};

// ---------- buildings ----------

function inTri(px: number, py: number, a: number[], b: number[], c: number[]): boolean {
  const s = (p: number[], q: number[]) => (px - q[0]) * (p[1] - q[1]) - (p[0] - q[0]) * (py - q[1]);
  const d1 = s(a, b);
  const d2 = s(b, c);
  const d3 = s(c, a);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}

function nearSegment(px: number, py: number, a: number[], b: number[], width: number): boolean {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy)) <= width;
}

interface HouseStyle {
  wallL: string;
  wallR: string;
  roofL: string;
  roofR: string;
  wallH: number;
  roofH: number;
  door?: boolean;
  window?: boolean;
}

/**
 * Isometric box with a pyramid roof on a `size`×`size` footprint. The texture's bottom-centre
 * pixel is the footprint's south vertex, so place it with origin (0.5, 1) at that point.
 */
function isoBuilding(scene: Phaser.Scene, key: string, size: number, st: HouseStyle): void {
  const W = TILE_W * size;
  const hh = (TILE_H / 2) * size;
  const H = st.wallH + st.roofH + 2 * hh + 2;
  const baseY = H - 1;
  const leftY = baseY - hh;
  const c = {
    wallL: hex(st.wallL),
    wallR: hex(st.wallR),
    roofL: hex(st.roofL),
    roofR: hex(st.roofR),
    outline: hex('#2b1d14'),
    door: hex('#4a2f15'),
    window: hex('#2b3a4a'),
    windowLight: hex('#e8c86a'),
  };
  const L = [-1, leftY - st.wallH];
  const B = [W / 2, baseY - st.wallH + 1];
  const R = [W + 1, leftY - st.wallH];
  const A = [W / 2, leftY - st.wallH - st.roofH];

  type Part = 'roofL' | 'roofR' | 'wallL' | 'wallR' | null;
  const region = (x: number, y: number): Part => {
    const px = x + 0.5;
    const py = y + 0.5;
    if (inTri(px, py, L, B, A)) return 'roofL';
    if (inTri(px, py, B, R, A)) return 'roofR';
    if (px < W / 2) {
      const yb = leftY + px * 0.5;
      if (py <= yb && py >= yb - st.wallH) return 'wallL';
    } else {
      const yb = baseY - (px - W / 2) * 0.5;
      if (py <= yb && py >= yb - st.wallH) return 'wallR';
    }
    return null;
  };

  paint(scene, key, W, H, (x, y) => {
    const part = region(x, y);
    if (!part) return null;
    if (!region(x - 1, y) || !region(x + 1, y) || !region(x, y - 1) || !region(x, y + 1)) return c.outline;
    if (part === 'wallL' && st.door) {
      const dx = x + 0.5 - W / 4;
      const yb = leftY + (x + 0.5) * 0.5;
      const doorH = Math.min(12, st.wallH - 3);
      if (Math.abs(dx) <= 3 && y + 0.5 > yb - doorH) return c.door;
    }
    if (part === 'wallR' && st.window) {
      const dx = x + 0.5 - (3 * W) / 4;
      const yt = baseY - (x + 0.5 - W / 2) * 0.5 - st.wallH;
      const wy = y + 0.5 - yt;
      if (Math.abs(dx) <= 3 && wy >= 5 && wy <= 10) return Math.abs(dx) <= 1 && wy >= 6 && wy <= 9 ? c.windowLight : c.window;
    }
    if ((part === 'roofL' || part === 'roofR') && Math.abs(x + 0.5 - W / 2) < 1) return c.outline; // ridge
    return c[part];
  });
}

/** Construction site: dirt footprint, corner posts, beams and a plank pile. */
function constructionSite(scene: Phaser.Scene, key: string, size: number): void {
  const W = TILE_W * size;
  const hh = (TILE_H / 2) * size;
  const post = 14 + size * 2;
  const H = 2 * hh + post + 2;
  const baseY = H - 1;
  const dirt = ['#8a7350', '#7d6747', '#94805c'].map(hex);
  const outline = hex('#2b1d14');
  const wood = hex('#a0703a');
  const plank = hex('#c8955a');
  const r = rng(size * 77);
  // Footprint vertices (inset a little so posts stand on the diamond).
  const Lp = [3, baseY - hh];
  const Bp = [W / 2, baseY - 2];
  const Rp = [W - 3, baseY - hh];
  const up = (p: number[]) => [p[0], p[1] - post];
  paint(scene, key, W, H, (x, y) => {
    const px = x + 0.5;
    const py = y + 0.5;
    for (const p of [Lp, Bp, Rp]) if (nearSegment(px, py, p, up(p), 1)) return wood;
    if (nearSegment(px, py, up(Lp), up(Bp), 0.7) || nearSegment(px, py, up(Bp), up(Rp), 0.7)) return wood;
    // Plank pile in the middle.
    const cx = W / 2;
    const cy = baseY - hh;
    if (Math.abs(px - cx) < 7 * size && py > cy - 4 && py < cy + 2) return py < cy - 2.5 || py > cy + 0.5 ? outline : plank;
    const d = Math.abs(px - W / 2) / (W / 2) + Math.abs(py - (baseY - hh)) / hh;
    if (d > 1) return null;
    return d > 0.92 ? outline : dirt[Math.floor(r() * 3)];
  });
}

// ---------- animals (side view facing right; frame b moves the legs) ----------

interface AnimalArt {
  body: string[];
  legsA: string[];
  legsB: string[];
  palette: Record<string, string>;
}

const ANIMAL_ART: Record<string, AnimalArt> = {
  rabbit: {
    body: ['......k.', '.....kwk', '..kkkkwk', '.kwwwwek', 'kwwwwwwk'],
    legsA: ['.kwkkwk.', '..k..k..'],
    legsB: ['.kwkkwk.', '.k....k.'],
    palette: { k: '#2b1d14', w: '#b8a890', e: '#1a1a1a' },
  },
  deer: {
    body: [
      '...........k.k..',
      '...........kak..',
      '............kk..',
      '...........kbbk.',
      '...........kbebk',
      '..kkkkkkkkkbbbk.',
      '.kbbbbbbbbbbbk..',
      'kwbbbbbbbbbbbk..',
      '.kbbbbbbbbbbk...',
      '..kbBkkkkkbBk...',
    ],
    legsA: ['..kbk....kbk....', '..kbk....kbk....', '..kk.....kk.....'],
    legsB: ['.kbk......kbk...', '.kbk......kbk...', '.kk.......kk....'],
    palette: { k: '#2b1d14', b: '#a0703a', B: '#7d5228', w: '#f0e8d8', e: '#1a1a1a', a: '#d8c8a0' },
  },
  boar: {
    body: [
      '..............',
      '...kkkkkkk....',
      '..kbbbbbbbkk..',
      '.kbbbbbbbbbbk.',
      'kbbbbbbbbbbebk',
      'kbbbbbbbbbbbwk',
      '.kbbbbbbbbbbk.',
      '..kbkkkkkbk...',
    ],
    legsA: ['..kbk...kbk...', '..kk....kk....'],
    legsB: ['.kbk.....kbk..', '.kk......kk...'],
    palette: { k: '#1e140e', b: '#5a4030', e: '#1a1a1a', w: '#f0e8d8' },
  },
  wolf: {
    body: [
      '..........k.k.',
      '.........kgkgk',
      '.........kggek',
      'k.kkkkkkkggggk',
      'kgggggggggggk.',
      '.kgggggggggk..',
      '..kgGkkkkgGk..',
    ],
    legsA: ['..kgk....kgk..', '..kk.....kk...'],
    legsB: ['.kgk......kgk.', '.kk.......kk..'],
    palette: { k: '#1e1e24', g: '#8a8a90', G: '#6a6a70', e: '#ffd040' },
  },
  bear: {
    body: [
      '............k..k..',
      '...........kbkkbk.',
      '...kkkkkkkkbbbbbk.',
      '..kbbbbbbbbbbbebk.',
      '.kbbbbbbbbbbbbbbBk',
      'kbbbbbbbbbbbbbbbk.',
      'kbbbbbbbbbbbbbbk..',
      'kbbbbbbbbbbbbbbk..',
      '.kbbbbbbbbbbbbk...',
      '..kbbkkkkkkbbk....',
    ],
    legsA: ['..kbbk....kbbk....', '..kbbk....kbbk....', '..kkkk....kkkk....'],
    legsB: ['.kbbk......kbbk...', '.kbbk......kbbk...', '.kkkk......kkkk...'],
    palette: { k: '#1a120c', b: '#5a3a22', B: '#3a2416', e: '#1a1a1a' },
  },
};

export function createPlaceholderTextures(scene: Phaser.Scene): void {
  for (const [name, art] of Object.entries(ANIMAL_ART)) {
    fromRows(scene, `animal_${name}_a`, [...art.body, ...art.legsA], art.palette);
    fromRows(scene, `animal_${name}_b`, [...art.body, ...art.legsB], art.palette);
  }
  // Melee swing arc.
  fromRows(scene, 'slash', ['..wwww..', '.w....w.', 'w......w', '........'], { w: '#ffffff' });

  isoBuilding(scene, 'bld_house', 2, {
    wallL: '#e0d0a8',
    wallR: '#bfae86',
    roofL: '#b0503a',
    roofR: '#8a3a28',
    wallH: 18,
    roofH: 22,
    door: true,
    window: true,
  });
  isoBuilding(scene, 'bld_lumberjack', 2, {
    wallL: '#9a6a3a',
    wallR: '#7a5028',
    roofL: '#5a7a44',
    roofR: '#455f34',
    wallH: 16,
    roofH: 20,
    door: true,
  });
  isoBuilding(scene, 'bld_quarry', 2, {
    wallL: '#a8a39b',
    wallR: '#86817a',
    roofL: '#8a6a44',
    roofR: '#6e5234',
    wallH: 14,
    roofH: 20,
    door: true,
  });
  isoBuilding(scene, 'bld_mine', 2, {
    wallL: '#6e6a66',
    wallR: '#55524f',
    roofL: '#5a4a3a',
    roofR: '#463a2d',
    wallH: 12,
    roofH: 18,
    door: true,
  });
  isoBuilding(scene, 'bld_hunter', 2, {
    wallL: '#8a5a2b',
    wallR: '#6e4824',
    roofL: '#d4b05a',
    roofR: '#b08e40',
    wallH: 16,
    roofH: 22,
    door: true,
    window: true,
  });
  constructionSite(scene, 'site_1', 1);
  constructionSite(scene, 'site_2', 2);

  stump(scene, 'stump');
  fromRows(scene, 'sapling', ['...kk...', '..kllk..', '.kllgk..', '.kglggk.', '..kgggk.', '...kbk..', '..kbbk..', '.kkkkkk.'], {
    k: '#1c2b14',
    l: '#7cc25a',
    g: '#4c8a3b',
    b: '#6e4824',
  });
  stockpile(scene, 'stockpile');
  for (const key in ICON_ROWS) fromRows(scene, key, ICON_ROWS[key].rows, ICON_ROWS[key].palette);

  for (let v = 0; v < 4; v++) {
    groundTile(scene, `grass_${v}`, ['#4f8a3c', '#5a9643', '#64a24a', '#477e36'], 10 + v, v === 3 ? '#e8d86a' : undefined);
    groundTile(scene, `water_${v}`, ['#2f6fa3', '#3478ad', '#3c84b8', '#2a6596'], 20 + v, '#8fc3e6');
    groundTile(scene, `sand_${v}`, ['#d8c48a', '#cfb97c', '#e0cd95', '#c4ad70'], 30 + v);
    groundTile(scene, `dirt_${v}`, ['#7a6a55', '#857560', '#6f604c', '#8f806a'], 40 + v, '#5d5a57');
  }

  tree(scene, 'tree', 7);
  pine(scene, 'pine', 8);
  rock(scene, 'rock', 9, false);
  rock(scene, 'iron', 10, true);

  person(scene, 'player', PLAYER_PALETTE, false);
  NPC_TUNICS.forEach(([t, T], v) => {
    const palette = { ...PLAYER_PALETTE, t, T, h: NPC_HAIR[(v * 3) % NPC_HAIR.length], s: NPC_SKIN[v % NPC_SKIN.length] };
    person(scene, npcSpriteKey(v, 'f'), palette, true);
    person(scene, npcSpriteKey(v, 'm'), palette, false);
  });

  // "!" above wanderers (white so it can be tinted by tier) and the population icon.
  fromRows(scene, 'marker', ['kkkk', 'kwwk', 'kwwk', 'kwwk', 'kwwk', 'kkkk', 'kwwk', 'kkkk'], { k: '#2b1d14', w: '#ffffff' });
  fromRows(
    scene,
    'icon_person',
    ['..kkkk..', '.kssssk.', '.kssssk.', '..kkkk..', '.kttttk.', 'kttttttk', 'kttttttk', '.kkkkkk.'],
    { k: '#2b1d14', s: '#e8b48a', t: '#3c6e9e' },
  );

  const shadow = hex('#000000');
  paint(scene, 'shadow', 12, 5, (x, y) => {
    const dx = (x + 0.5 - 6) / 6;
    const dy = (y + 0.5 - 2.5) / 2.5;
    return dx * dx + dy * dy <= 1 ? shadow : null;
  });
}
