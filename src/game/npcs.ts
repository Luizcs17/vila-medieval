import { BEDS_PER_HOUSE, MAX_WANDERERS, WANDERER_FIRST_SPAWN, WANDERER_INTERVAL } from '../config';
import { isWalkable, type WorldMap } from '../world/map';
import type { Building, Buildings } from './buildings';
import { type Amounts, type Inventory, RESOURCE_LABEL, RESOURCES } from './inventory';
import type { SlotInventory } from './slots';

export type Rng = () => number;
export type Gender = 'f' | 'm';
export type Tier = 'common' | 'skilled' | 'master';

export const TIER_COLOR: Record<Tier, string> = { common: '#d8d0c0', skilled: '#7fc8ff', master: '#ffcf5a' };

export function tierLabel(tier: Tier, g: Gender): string {
  if (tier === 'common') return 'Comum';
  if (tier === 'skilled') return g === 'f' ? 'Habilidosa' : 'Habilidoso';
  return g === 'f' ? 'Mestra' : 'Mestre';
}

export const roleLabel = (role: NpcData['role'], g: Gender) =>
  role === 'wanderer' ? (g === 'f' ? 'Andarilha' : 'Andarilho') : g === 'f' ? 'Aldeã' : 'Aldeão';

export type TraitId = 'axe' | 'stone' | 'iron' | 'aim' | 'tireless' | 'frugal' | 'appetite' | 'slow';

/** Trait effects are applied by the job and needs systems (milestones 6 and 7). */
export const TRAITS: Record<TraitId, { name: string; description: string; positive: boolean }> = {
  axe: { name: 'Força no machado', description: '+50% de madeira como lenhador', positive: true },
  stone: { name: 'Olho para pedra', description: '+50% de pedra na pedreira', positive: true },
  iron: { name: 'Faro para ferro', description: '+50% de ferro na mina', positive: true },
  aim: { name: 'Mira certeira', description: '+50% de carne como caçador', positive: true },
  tireless: { name: 'Incansável', description: '+20% de produção em qualquer trabalho', positive: true },
  frugal: { name: 'Frugal', description: 'Come menos', positive: true },
  appetite: { name: 'Apetite grande', description: 'Come mais', positive: false },
  slow: { name: 'Sem pressa', description: '-20% de produção', positive: false },
};

const PROFESSION_TRAITS: TraitId[] = ['axe', 'stone', 'iron', 'aim'];

const NAMES: Record<Gender, string[]> = {
  f: [
    'Ana',
    'Beatriz',
    'Brites',
    'Catarina',
    'Clara',
    'Constança',
    'Filipa',
    'Inês',
    'Isabel',
    'Joana',
    'Leonor',
    'Margarida',
    'Maria',
    'Teresa',
  ],
  m: [
    'Afonso',
    'Bento',
    'Duarte',
    'Fernão',
    'Gonçalo',
    'Henrique',
    'João',
    'Lourenço',
    'Martim',
    'Nuno',
    'Pedro',
    'Rodrigo',
    'Tomé',
    'Vasco',
  ],
};

/** What each tier may ask for (besides a free bed), picked at random. */
const REQUESTS: Record<Tier, Partial<Amounts>[]> = {
  common: [{}],
  skilled: [{ wood: 10 }, { stone: 8 }, { wood: 6, stone: 4 }],
  master: [{ iron: 5, stone: 10 }, { iron: 8 }, { wood: 15, iron: 4 }],
};

/** Number of sprite colour variants (see textures.ts). */
export const NPC_VARIANTS = 8;

export interface NpcData {
  id: number;
  name: string;
  gender: Gender;
  tier: Tier;
  traits: TraitId[];
  /** Resources asked for on recruitment (in addition to a free bed). */
  request: Partial<Amounts>;
  variant: number;
  role: 'wanderer' | 'villager';
  homeId: number | null;
  /** Game time (clock seconds) when a wanderer gives up and leaves. */
  leavesAt: number;
}

const pick = <T>(rng: Rng, list: readonly T[]): T => list[Math.floor(rng() * list.length)];

export function generateWanderer(rng: Rng, id: number, leavesAt: number): NpcData {
  const roll = rng();
  const tier: Tier = roll < 0.6 ? 'common' : roll < 0.9 ? 'skilled' : 'master';
  const gender: Gender = rng() < 0.5 ? 'f' : 'm';
  let traits: TraitId[];
  if (tier === 'common') traits = [pick(rng, Object.keys(TRAITS) as TraitId[])];
  else if (tier === 'skilled') traits = [pick(rng, PROFESSION_TRAITS)];
  else traits = [pick(rng, PROFESSION_TRAITS), pick(rng, ['tireless', 'frugal'] as TraitId[])];
  return {
    id,
    name: pick(rng, NAMES[gender]),
    gender,
    tier,
    traits,
    request: { ...pick(rng, REQUESTS[tier]) },
    variant: Math.floor(rng() * NPC_VARIANTS),
    role: 'wanderer',
    homeId: null,
    leavesAt,
  };
}

// ---------- paying with what you carry + the stockpile ----------

export function canPayFrom(cost: Partial<Amounts>, inv: SlotInventory, stock: Inventory): boolean {
  return RESOURCES.every((r) => inv.count(r) + stock.items[r] >= (cost[r] ?? 0));
}

/** Pays `cost` taking from the carried inventory first, then the stockpile. All-or-nothing. */
export function payFrom(cost: Partial<Amounts>, inv: SlotInventory, stock: Inventory): boolean {
  if (!canPayFrom(cost, inv, stock)) return false;
  for (const r of RESOURCES) {
    const need = cost[r] ?? 0;
    const fromInv = inv.remove(r, need);
    stock.items[r] -= need - fromInv;
  }
  return true;
}

export function describeCost(cost: Partial<Amounts>): string {
  return RESOURCES.filter((r) => cost[r])
    .map((r) => `${cost[r]} ${RESOURCE_LABEL[r]}`)
    .join(', ');
}

// ---------- population & housing ----------

export interface RecruitCheck {
  bed: boolean;
  items: boolean;
  ok: boolean;
}

export class Population {
  readonly npcs: NpcData[] = [];
  private nextId = 1;

  constructor(private readonly buildings: Buildings) {}

  newId(): number {
    return this.nextId++;
  }

  get villagers(): NpcData[] {
    return this.npcs.filter((n) => n.role === 'villager');
  }

  get wanderers(): NpcData[] {
    return this.npcs.filter((n) => n.role === 'wanderer');
  }

  private houses(): Building[] {
    return this.buildings.list.filter((b) => b.type === 'house' && b.built);
  }

  get beds(): number {
    return this.houses().length * BEDS_PER_HOUSE;
  }

  get freeBeds(): number {
    return this.beds - this.villagers.length;
  }

  residents(houseId: number): NpcData[] {
    return this.villagers.filter((n) => n.homeId === houseId);
  }

  check(npc: NpcData, inv: SlotInventory, stock: Inventory): RecruitCheck {
    const bed = this.freeBeds > 0;
    const items = canPayFrom(npc.request, inv, stock);
    return { bed, items, ok: npc.role === 'wanderer' && bed && items };
  }

  /** Pays the request, turns the wanderer into a villager and assigns a home. Returns the home, or null if not allowed. */
  recruit(npc: NpcData, inv: SlotInventory, stock: Inventory): Building | null {
    if (!this.check(npc, inv, stock).ok) return null;
    const home = this.houses().find((h) => this.residents(h.id).length < BEDS_PER_HOUSE)!;
    payFrom(npc.request, inv, stock);
    npc.role = 'villager';
    npc.homeId = home.id;
    return home;
  }

  remove(id: number): void {
    const i = this.npcs.findIndex((n) => n.id === id);
    if (i >= 0) this.npcs.splice(i, 1);
  }
}

// ---------- spawning ----------

/** Decides when a new wanderer should appear. */
export class WandererSpawner {
  private timer: number;

  constructor(
    private readonly rng: Rng,
    first = WANDERER_FIRST_SPAWN,
  ) {
    this.timer = first;
  }

  /** Advances by `dt` game seconds. Returns true when a wanderer should spawn now. */
  update(dt: number, wandererCount: number): boolean {
    this.timer -= dt;
    if (this.timer > 0) return false;
    this.timer = WANDERER_INTERVAL * (0.75 + this.rng() * 0.5);
    return wandererCount < MAX_WANDERERS;
  }
}

/** A random walkable tile between `minDist` and `maxDist` tiles from `center`, or null. */
export function pickSpawnTile(
  map: WorldMap,
  rng: Rng,
  center: { x: number; y: number },
  minDist = 12,
  maxDist = 26,
): { x: number; y: number } | null {
  for (let tries = 0; tries < 300; tries++) {
    const a = rng() * Math.PI * 2;
    const d = minDist + rng() * (maxDist - minDist);
    const x = Math.floor(center.x + Math.cos(a) * d);
    const y = Math.floor(center.y + Math.sin(a) * d);
    if (isWalkable(map, x, y)) return { x, y };
  }
  return null;
}

/** Compass word for a grid offset, using screen directions (north = up on the monitor). */
export function compass(dx: number, dy: number): string {
  const sx = dx - dy;
  const sy = dx + dy;
  const names = ['a leste', 'a sudeste', 'ao sul', 'a sudoeste', 'a oeste', 'a noroeste', 'ao norte', 'a nordeste'];
  const angle = Math.atan2(sy, sx); // 0 = east (right), positive = down
  const k = Math.round(angle / (Math.PI / 4));
  return names[(k + 8) % 8];
}
