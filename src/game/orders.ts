import { COMPANION_LEASH, COMPANION_RANGE, GUARD_LEASH, GUARD_RANGE } from '../config';
import type { NpcData } from './npcs';

/**
 * Orders the player gives one companion or soldier: follow me, or hold a spot (stay here / go
 * there). With no order, companions follow and soldiers guard their barracks.
 */
export type Command = { kind: 'follow' } | { kind: 'hold'; x: number; y: number };

/** How eagerly they fight. */
export type Stance = 'defensive' | 'neutral' | 'aggressive';
export const STANCES: Stance[] = ['defensive', 'neutral', 'aggressive'];

export const STANCE_LABEL: Record<Stance, string> = {
  defensive: 'Defensivo',
  neutral: 'Neutro',
  aggressive: 'Agressivo',
};

export const STANCE_HELP: Record<Stance, string> = {
  defensive: 'Só luta com o que chega bem perto; não sai de perto do ponto.',
  neutral: 'Enfrenta ameaças próximas (feras e inimigos em guerra).',
  aggressive: 'Persegue qualquer inimigo e caça qualquer animal ao alcance.',
};

export interface Engagement {
  /** Fight hostiles this close to the fighter. */
  range: number;
  /** …as long as they stay this close to the anchor (the player, the held spot or the barracks). */
  leash: number;
  /** Also attack harmless and defensive animals. */
  anyAnimal: boolean;
}

/** How far a fighter reaches out, by stance; `soldier` uses the barracks' ranges as the neutral baseline. */
export function engagement(stance: Stance, soldier: boolean): Engagement {
  const range = soldier ? GUARD_RANGE : COMPANION_RANGE;
  const leash = soldier ? GUARD_LEASH : COMPANION_LEASH;
  if (stance === 'defensive') return { range: 2.5, leash: 4, anyAnimal: false };
  if (stance === 'aggressive') return { range: range * 2, leash: leash * 2, anyAnimal: true };
  return { range, leash, anyAnimal: false };
}

export const stanceOf = (n: Pick<NpcData, 'stance'>): Stance => n.stance ?? 'neutral';

/** Who takes orders: your companions and your soldiers (`isSoldier` tells soldiers apart). */
export function takesOrders(n: NpcData, mine: boolean, isSoldier: boolean): boolean {
  return mine && (n.role === 'companion' || (n.role === 'villager' && isSoldier));
}

/**
 * A tile for an idle fidget step: walkable, between `minD` and `maxD` tiles (centre to centre) from
 * the anchor (ax, ay). Null when none is found in a few tries.
 */
export function pickFidgetTile(
  rng: () => number,
  ax: number,
  ay: number,
  minD: number,
  maxD: number,
  walkable: (x: number, y: number) => boolean,
): { x: number; y: number } | null {
  for (let k = 0; k < 10; k++) {
    const a = rng() * Math.PI * 2;
    const r = minD + rng() * (maxD - minD);
    const x = Math.floor(ax + Math.cos(a) * r);
    const y = Math.floor(ay + Math.sin(a) * r);
    const d = Math.hypot(x + 0.5 - ax, y + 0.5 - ay);
    if (d >= minD && d <= maxD && walkable(x, y)) return { x, y };
  }
  return null;
}

/** Short description of what someone is doing under orders, for cards. */
export function commandLabel(c: Command | null | undefined, companion: boolean): string {
  if (!c) return companion ? 'Seguindo você (padrão)' : 'Guardando o quartel (padrão)';
  return c.kind === 'follow' ? 'Seguindo você' : 'Guardando uma posição';
}
