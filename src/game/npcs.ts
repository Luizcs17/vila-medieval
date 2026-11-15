import {
  ADULT_AGE,
  BEDS_PER_HOUSE,
  COMPANION_MAX,
  DAY_SECONDS,
  MAX_WANDERERS,
  SOLDIER_BONUS_HP,
  VILLAGER_HP,
  WANDERER_FIRST_SPAWN,
  WANDERER_INTERVAL,
} from '../config';
import { isWalkable, type WorldMap } from '../world/map';
import { BUILDING_DEFS, type Building, type Buildings } from './buildings';
import { type Amounts, type Inventory, RESOURCE_LABEL, RESOURCES } from './inventory';
import { ITEM_DEFS, type ToolId } from './items';
import { type Look, randomLook } from './looks';
import type { Command, Stance } from './orders';
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
  role === 'wanderer'
    ? g === 'f'
      ? 'Andarilha'
      : 'Andarilho'
    : role === 'companion'
      ? g === 'f'
        ? 'Companheira'
        : 'Companheiro'
      : g === 'f'
        ? 'Aldeã'
        : 'Aldeão';

export type TraitId = 'axe' | 'stone' | 'iron' | 'aim' | 'tireless' | 'frugal' | 'appetite' | 'slow';

/** Traits are random personality quirks. Production effects apply in `productivity`; eating effects in the needs system. */
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

// ---------- skills (rated 1–5 stars) ----------

export const SKILLS = ['woodcutting', 'stonework', 'mining', 'hunting', 'combat', 'diplomacy', 'smithing'] as const;
export type Skill = (typeof SKILLS)[number];
export type Skills = Record<Skill, number>;

export const SKILL_LABEL: Record<Skill, string> = {
  woodcutting: 'Corte de lenha',
  stonework: 'Cantaria',
  mining: 'Mineração',
  hunting: 'Caça',
  combat: 'Combate',
  diplomacy: 'Diplomacia',
  smithing: 'Forja',
};

/** The trait that gives +50% in each skill's job. */
const SKILL_TRAIT: Partial<Record<Skill, TraitId>> = { woodcutting: 'axe', stonework: 'stone', mining: 'iron', hunting: 'aim' };

export const stars = (rating: number) => '★'.repeat(rating) + '☆'.repeat(5 - rating);

const randInt = (rng: Rng, lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));

/** Skill ratings by tier: common 1–3 everywhere; skilled one 4; master one 5 and one 4 (rest 2–3). */
export function rollSkills(rng: Rng, tier: Tier): Skills {
  const order = [...SKILLS].sort(() => rng() - 0.5);
  const skills = {} as Skills;
  for (const s of SKILLS) skills[s] = tier === 'master' ? randInt(rng, 2, 3) : randInt(rng, 1, 3);
  if (tier === 'skilled') skills[order[0]] = 4;
  if (tier === 'master') {
    skills[order[0]] = 5;
    skills[order[1]] = 4;
  }
  return skills;
}

/**
 * Work speed multiplier for a skill: rating 1 → 0.75×, 3 → 1.25×, 5 → 1.75×,
 * times trait effects (matching profession trait ×1.5, Incansável ×1.2, Sem pressa ×0.8).
 */
export function productivity(npc: Pick<NpcData, 'skills' | 'traits'>, skill: Skill): number {
  let m = 0.5 + 0.25 * npc.skills[skill];
  const trait = SKILL_TRAIT[skill];
  if (trait && npc.traits.includes(trait)) m *= 1.5;
  if (npc.traits.includes('tireless')) m *= 1.2;
  if (npc.traits.includes('slow')) m *= 0.8;
  return m;
}

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

export const SURNAMES = [
  'Almeida',
  'Barros',
  'Cardoso',
  'Coelho',
  'Correia',
  'Costa',
  'Dias',
  'Ferreira',
  'Gomes',
  'Lopes',
  'Machado',
  'Martins',
  'Mendes',
  'Monteiro',
  'Nunes',
  'Pereira',
  'Pinto',
  'Rocha',
  'Santos',
  'Teixeira',
  'Vieira',
];

export const ageOf = (n: Pick<NpcData, 'born'>, now: number) => Math.max(0, Math.floor((now - n.born) / DAY_SECONDS));
export const isAdult = (n: Pick<NpcData, 'born'>, now: number) => ageOf(n, now) >= ADULT_AGE;
export const fullName = (n: Pick<NpcData, 'name' | 'surname'>) => `${n.name} ${n.surname}`;

/** Number of sprite colour variants (see textures.ts). */
export const NPC_VARIANTS = 8;

export interface NpcData {
  id: number;
  name: string;
  gender: Gender;
  tier: Tier;
  traits: TraitId[];
  skills: Skills;
  /** Resources asked for on recruitment (in addition to a free bed). */
  request: Partial<Amounts>;
  variant: number;
  /** Companions travel with the player before there's a village (they become villagers when it's founded). */
  role: 'wanderer' | 'villager' | 'companion';
  homeId: number | null;
  /** Workplace building id, or null when unemployed. */
  jobId: number | null;
  /** Which village they belong to (0 = the player's). Wanderers are 0 until someone recruits them. */
  faction: number;
  /** Hit points (animals can hurt villagers). */
  hp: number;
  /** Satiety 0–100 (see needs.ts). */
  food: number;
  /** Family name (children inherit it). */
  surname: string;
  /** Game time of birth (age in years = days since then). */
  born: number;
  /** Spouse id (0 = the player), or null. */
  partnerId: number | null;
  /** Parent ids (0 = the player), empty for people who arrived as wanderers. */
  parents: number[];
  /** Randomized appearance (sprite is built from it). */
  look: Look;
  /** Gear handed out from the barracks (soldiers). */
  weapon?: ToolId | null;
  armor?: ToolId | null;
  /** Soldiers on campaign: attack village `target`. */
  order: { kind: 'raid'; target: number } | null;
  /** The player's order to a companion or soldier (follow me, hold a spot); null = default behaviour. */
  command?: Command | null;
  /** How eagerly they fight (default neutral). */
  stance?: Stance;
  /** Game seconds spent at zero satiety. */
  starving: number;
  /** Game time (clock seconds) when a wanderer gives up and leaves. */
  leavesAt: number;
}

const pick = <T>(rng: Rng, list: readonly T[]): T => list[Math.floor(rng() * list.length)];

export function generateWanderer(rng: Rng, id: number, leavesAt: number, now = 0): NpcData {
  const roll = rng();
  const tier: Tier = roll < 0.6 ? 'common' : roll < 0.9 ? 'skilled' : 'master';
  const gender: Gender = rng() < 0.5 ? 'f' : 'm';
  // Traits are random at every tier; masters get two different ones. Tier shows in the skill ratings.
  const all = Object.keys(TRAITS) as TraitId[];
  const traits: TraitId[] = [pick(rng, all)];
  if (tier === 'master')
    traits.push(
      pick(
        rng,
        all.filter((t) => t !== traits[0]),
      ),
    );
  return {
    id,
    name: pick(rng, NAMES[gender]),
    gender,
    tier,
    traits,
    skills: rollSkills(rng, tier),
    request: { ...pick(rng, REQUESTS[tier]) },
    variant: Math.floor(rng() * NPC_VARIANTS),
    role: 'wanderer',
    homeId: null,
    jobId: null,
    faction: 0,
    hp: VILLAGER_HP,
    food: 100,
    starving: 0,
    surname: pick(rng, SURNAMES),
    born: now - (ADULT_AGE + Math.floor(rng() * 30)) * DAY_SECONDS,
    partnerId: null,
    parents: [],
    order: null,
    look: randomLook(rng, gender),
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

export interface PopulationSnapshot {
  npcs: NpcData[];
  nextId: number;
  deceased?: Deceased[];
  playerPartnerId?: number | null;
}

export interface RecruitCheck {
  bed: boolean;
  items: boolean;
  ok: boolean;
}

/** What family trees remember about someone who died. */
export type Deceased = Pick<
  NpcData,
  'id' | 'name' | 'surname' | 'gender' | 'parents' | 'partnerId' | 'born' | 'faction' | 'variant'
> & {
  diedAt: number;
};

export class Population {
  readonly npcs: NpcData[] = [];
  /** People who died, for family trees. */
  deceased: Deceased[] = [];
  /** The player's spouse, if married. */
  playerPartnerId: number | null = null;
  /** Game clock (set by the world) for ages. */
  now: () => number = () => 0;
  private nextId = 1;

  constructor(private readonly buildings: Buildings) {}

  newId(): number {
    return this.nextId++;
  }

  snapshot(): PopulationSnapshot {
    return {
      npcs: this.npcs.map((n) => structuredClone(n)),
      nextId: this.nextId,
      deceased: structuredClone(this.deceased),
      playerPartnerId: this.playerPartnerId,
    };
  }

  restore(s: PopulationSnapshot): void {
    this.npcs.length = 0;
    for (const n of s.npcs) this.npcs.push(structuredClone(n));
    this.nextId = s.nextId;
    this.deceased = structuredClone(s.deceased ?? []);
    this.playerPartnerId = s.playerPartnerId ?? null;
  }

  /** The player's villagers. */
  get villagers(): NpcData[] {
    return this.villagersOf(0);
  }

  villagersOf(faction: number): NpcData[] {
    return this.npcs.filter((n) => n.role === 'villager' && n.faction === faction);
  }

  /** Villagers of every faction. */
  get allVillagers(): NpcData[] {
    return this.npcs.filter((n) => n.role === 'villager');
  }

  get wanderers(): NpcData[] {
    return this.npcs.filter((n) => n.role === 'wanderer');
  }

  /** People travelling with the player (before the village exists). */
  get companions(): NpcData[] {
    return this.npcs.filter((n) => n.role === 'companion');
  }

  /** Can this wanderer join you as a companion (room in the group + their request)? */
  checkCompanion(npc: NpcData, inv: SlotInventory, stock: Inventory): { room: boolean; items: boolean; ok: boolean } {
    const room = this.companions.length < COMPANION_MAX;
    const items = canPayFrom(npc.request, inv, stock);
    return { room, items, ok: npc.role === 'wanderer' && room && items };
  }

  /** Pays the request and the wanderer starts following you. */
  recruitCompanion(npc: NpcData, inv: SlotInventory, stock: Inventory): boolean {
    if (!this.checkCompanion(npc, inv, stock).ok) return false;
    payFrom(npc.request, inv, stock);
    npc.role = 'companion';
    npc.faction = 0;
    npc.homeId = null;
    npc.jobId = null;
    return true;
  }

  /** The village is founded: companions settle down as (homeless, for now) villagers. Returns them. */
  settleCompanions(): NpcData[] {
    const list = this.companions;
    for (const n of list) n.role = 'villager';
    return list;
  }

  private houses(faction = 0): Building[] {
    return this.buildings.list.filter((b) => b.type === 'house' && b.built && b.faction === faction);
  }

  get beds(): number {
    return this.bedsOf(0);
  }

  get freeBeds(): number {
    return this.freeBedsOf(0);
  }

  bedsOf(faction: number): number {
    return this.houses(faction).length * BEDS_PER_HOUSE;
  }

  freeBedsOf(faction: number): number {
    return this.bedsOf(faction) - this.villagersOf(faction).length;
  }

  residents(houseId: number): NpcData[] {
    return this.allVillagers.filter((n) => n.homeId === houseId);
  }

  /** A finished house of `faction` with a free bed, if any. */
  houseWithBed(faction: number): Building | undefined {
    return this.houses(faction).find((h) => this.residents(h.id).length < BEDS_PER_HOUSE);
  }

  check(npc: NpcData, inv: SlotInventory, stock: Inventory): RecruitCheck {
    const bed = this.freeBeds > 0;
    const items = canPayFrom(npc.request, inv, stock);
    return { bed, items, ok: npc.role === 'wanderer' && bed && items };
  }

  /** Pays the request, turns the wanderer into a villager and assigns a home. Returns the home, or null if not allowed. */
  recruit(npc: NpcData, inv: SlotInventory, stock: Inventory): Building | null {
    if (!this.check(npc, inv, stock).ok) return null;
    const home = this.houseWithBed(0)!;
    payFrom(npc.request, inv, stock);
    npc.role = 'villager';
    npc.homeId = home.id;
    return home;
  }

  /** Removes someone (death, leaving). Villagers are remembered for family trees; spouses are widowed. */
  remove(id: number): void {
    const i = this.npcs.findIndex((n) => n.id === id);
    if (i < 0) return;
    const [n] = this.npcs.splice(i, 1);
    if (n.role === 'wanderer') return;
    const { name, surname, gender, parents, partnerId, born, faction, variant } = n;
    this.deceased.push({ id, name, surname, gender, parents, partnerId, born, faction, variant, diedAt: this.now() });
    for (const o of this.npcs) if (o.partnerId === id) o.partnerId = null;
    if (this.playerPartnerId === id) this.playerPartnerId = null;
  }

  /** Living or dead person by id (for family trees). */
  person(id: number): NpcData | Deceased | undefined {
    return this.npcs.find((n) => n.id === id) ?? this.deceased.find((n) => n.id === id);
  }

  workers(buildingId: number): NpcData[] {
    return this.allVillagers.filter((n) => n.jobId === buildingId);
  }

  /** Villagers without a job, best first for `skill` (if given). */
  unemployed(skill?: Skill, faction = 0): NpcData[] {
    const list = this.villagersOf(faction).filter((n) => n.jobId === null && isAdult(n, this.now()));
    if (skill) list.sort((a, b) => productivity(b, skill) - productivity(a, skill));
    return list;
  }

  /** Assigns a villager to a finished workplace with a free slot. Returns false if not allowed. */
  assign(npc: NpcData, building: Building): boolean {
    const job = BUILDING_DEFS[building.type].job;
    if (!job || !building.built || npc.role !== 'villager' || building.faction !== npc.faction) return false;
    if (!isAdult(npc, this.now())) return false; // children don't work
    if (this.workers(building.id).length >= job.slots) return false;
    npc.jobId = building.id;
    return true;
  }

  unassign(npc: NpcData): void {
    npc.jobId = null;
    npc.command = null;
  }
}

/** Melee damage of a soldier: 1 + half their Combate rating (1–3), halved while starving. */
export function soldierDamage(npc: Pick<NpcData, 'skills' | 'food' | 'weapon'>): number {
  const weapon = npc.weapon ? (ITEM_DEFS[npc.weapon].tool?.damage ?? 1) - 1 : 0;
  const base = 1 + Math.floor(npc.skills.combat / 2) + weapon;
  return npc.food <= 0 ? Math.max(1, Math.floor(base / 2)) : base;
}

/** Soldiers are tougher. */
export function maxHpOf(npc: NpcData, buildings: Buildings): number {
  const b = npc.jobId !== null ? buildings.list.find((x) => x.id === npc.jobId) : undefined;
  return VILLAGER_HP + (b?.type === 'barracks' ? SOLDIER_BONUS_HP : 0);
}

/** Display title for a villager: job title, or "Aldeã/Aldeão" when unemployed. */
export function jobTitle(npc: NpcData, buildings: Buildings): string {
  const b = npc.jobId !== null ? buildings.list.find((x) => x.id === npc.jobId) : undefined;
  const job = b ? BUILDING_DEFS[b.type].job : undefined;
  return job ? job.title[npc.gender] : roleLabel(npc.role, npc.gender);
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
