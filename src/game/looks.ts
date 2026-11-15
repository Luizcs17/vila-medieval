import type { Gender, Rng } from './npcs';

/** Randomized appearance of a villager (indices into the palettes below). */
export interface Look {
  skin: number;
  hair: number;
  style: 'short' | 'long' | 'bald' | 'tied';
  beard: boolean;
  tunic: number;
  pants: number;
  hat: 'none' | 'hood' | 'cap' | 'straw';
  apron: boolean;
}

export const SKINS = ['#e8c09a', '#d9a47c', '#c68a62', '#a8714c', '#8a5a3a', '#6a4430'];
export const HAIRS = ['#1a120a', '#3a2614', '#5a3a1e', '#7a5030', '#a8783a', '#c89e5a', '#8a8580', '#6a2a14'];
/** Earthy medieval dyes: [tunic, shade]. */
export const TUNICS: [string, string][] = [
  ['#5a2a24', '#3e1c18'],
  ['#3e4a2a', '#2a331c'],
  ['#4a3a28', '#33281b'],
  ['#2e3a4a', '#1f2833'],
  ['#5a4a2e', '#3f331f'],
  ['#4a2e40', '#33202c'],
  ['#6a5a40', '#4a3e2c'],
  ['#3a3a36', '#282825'],
  ['#6a3a1e', '#4a2814'],
  ['#2e4a40', '#1f332c'],
  ['#7a6a4a', '#55493a'],
  ['#4a1e1e', '#331414'],
];
export const PANTS = ['#3a2e22', '#2e2a26', '#4a3a2a', '#2a3038', '#4a4232'];
export const HATS: Record<string, string> = { cap: '#5a3a24', straw: '#b89a52' };

const pick = <T>(rng: Rng, list: readonly T[]): T => list[Math.floor(rng() * list.length)];
const idx = (rng: Rng, n: number) => Math.floor(rng() * n);

export function randomLook(rng: Rng, gender: Gender): Look {
  const style =
    gender === 'f'
      ? pick(rng, ['long', 'long', 'tied', 'short'] as const)
      : pick(rng, ['short', 'short', 'tied', 'bald', 'long'] as const);
  return {
    skin: idx(rng, SKINS.length),
    hair: idx(rng, HAIRS.length),
    style,
    beard: gender === 'm' && rng() < 0.45,
    tunic: idx(rng, TUNICS.length),
    pants: idx(rng, PANTS.length),
    hat: pick(rng, ['none', 'none', 'none', 'hood', 'cap', 'straw'] as const),
    apron: rng() < 0.2,
  };
}

/** A child's look: skin and hair from the parents, the rest of their own. */
export function childLook(rng: Rng, gender: Gender, a?: Look, b?: Look): Look {
  const own = randomLook(rng, gender);
  const parents = [a, b].filter((l): l is Look => l !== undefined);
  if (parents.length === 0) return own;
  return { ...own, skin: pick(rng, parents).skin, hair: pick(rng, parents).hair, beard: false, hat: 'none' };
}
