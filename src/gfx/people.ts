import type Phaser from 'phaser';
import type { Look } from '../game/looks';
import { HAIRS, HATS, PANTS, SKINS, TUNICS } from '../game/looks';

/**
 * Builds a villager sprite (idle + two walking frames) from their randomized `Look`, once per
 * distinct look, and returns the texture key prefix. Art is a 10×16 pixel person:
 * k outline, s skin, h hair, t/T tunic, b belt, p trousers, f boots, c hat, a apron.
 */
export function personKey(look: Look): string {
  return `p_${look.skin}-${look.hair}-${look.style}-${look.beard ? 1 : 0}-${look.tunic}-${look.pants}-${look.hat}-${look.apron ? 1 : 0}`;
}

const HEAD_BASE = ['..kkkkkk..', '.khhhhhhk.', '.khhhhhhk.', '.khsssshk.', '.kskssksk.', '.kssssssk.', '..kkkkkk..'];
const TORSO = ['.kttttttk.', 'kttTttTttk', 'ksttttttsk', 'ksbbbbbbsk', '.kttttttk.'];
const LEGS_IDLE = ['.kppkkppk.', '.kppkkppk.', '.kffkkffk.', '..kk..kk..'];
const LEGS_STEP = ['.kppkkppk.', '.kffk.kppk', '..kk..kffk', '......kk..'];

const mirror = (rows: string[]) => rows.map((r) => r.split('').reverse().join(''));
const setRow = (rows: string[], i: number, row: string) => {
  rows[i] = row;
};

function head(look: Look): string[] {
  const r = [...HEAD_BASE];
  if (look.style === 'bald') {
    setRow(r, 1, '.kssssssk.');
    setRow(r, 2, '.kssssssk.');
    setRow(r, 3, '.kssssssk.');
  } else if (look.style === 'long') {
    for (const i of [3, 4, 5]) setRow(r, i, `.h${r[i].slice(2, 8)}h.`);
    setRow(r, 6, '.hkkkkkkh.');
  } else if (look.style === 'short') {
    setRow(r, 3, '.kssssssk.');
  }
  // 'tied' keeps the base (hair down to the temples)
  if (look.beard) {
    setRow(r, 5, '.khsssshk.');
    setRow(r, 6, '..khhhhk..');
  }
  if (look.hat === 'hood') {
    setRow(r, 0, '...kkkk...');
    setRow(r, 1, '..kcccck..');
    setRow(r, 2, '.kcccccck.');
    for (const i of [3, 4, 5]) setRow(r, i, `kc${r[i].slice(2, 8)}ck`);
  } else if (hasBrim(look)) {
    setRow(r, 0, '..kcccck..');
    setRow(r, 1, 'kcccccccck');
  }
  return r;
}

const hasBrim = (look: Look) => look.hat === 'cap' || look.hat === 'straw';

function torso(look: Look): string[] {
  const r = [...TORSO];
  if (look.apron) {
    setRow(r, 2, 'ksaaaaaask');
    setRow(r, 4, '.kaaaaaak.');
  }
  return r;
}

export function ensurePersonTextures(scene: Phaser.Scene, look: Look): string {
  const key = personKey(look);
  if (scene.textures.exists(`${key}_idle`)) return key;
  const [t, T] = TUNICS[look.tunic];
  const palette: Record<string, string> = {
    k: '#140d08',
    s: SKINS[look.skin],
    h: HAIRS[look.hair],
    t,
    T,
    b: '#2e1f12',
    p: PANTS[look.pants],
    f: '#1a120c',
    c: look.hat === 'hood' ? T : (HATS[look.hat] ?? '#000000'),
    a: '#b8ac8e',
  };
  const body = [...head(look), ...torso(look)];
  const frames: [string, string[]][] = [
    ['idle', LEGS_IDLE],
    ['step_a', LEGS_STEP],
    ['step_b', mirror(LEGS_STEP)],
  ];
  for (const [name, legs] of frames) {
    const rows = [...body, ...legs];
    const tex = scene.textures.createCanvas(`${key}_${name}`, 10, rows.length)!;
    const ctx = tex.getContext();
    rows.forEach((row, y) => {
      [...row].forEach((ch, x) => {
        const col = palette[ch];
        if (!col) return;
        ctx.fillStyle = col;
        ctx.fillRect(x, y, 1, 1);
      });
    });
    tex.refresh();
  }
  return key;
}
