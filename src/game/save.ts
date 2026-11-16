import type { AnimalData } from './animals';
import type { Building } from './buildings';
import type { MissionKind, Proposal, Relation } from './diplomacy';
import type { Drop } from './drops';
import type { DungeonState } from './dungeons';
import type { RecruitPolicy, TradePolicy } from './factions';
import type { NodesSnapshot } from './gathering';
import type { Amounts } from './inventory';
import type { ToolId } from './items';
import type { PopulationSnapshot } from './npcs';
import type { Stack } from './slots';
import type { Goods } from './trade';

export const SAVE_KEY = 'vila-medieval-save';
/** Bump when the shape changes; older saves are then ignored instead of half-loaded. */
export const SAVE_VERSION = 7;
/** Oldest save that still loads (older ones are migrated on load). */
export const MIN_SAVE_VERSION = 6;

/** Everything needed to rebuild a game. The map layout itself comes from the fixed seed. */
export interface SaveData {
  version: number;
  savedAt: string;
  clock: number;
  /** map.objects (trees cut, rocks mined, buildings placed). */
  objects: number[];
  nodes: NodesSnapshot;
  buildings: { list: Building[]; nextId: number };
  stockpile: Amounts;
  factions: {
    id: number;
    stock: Amounts;
    alive: boolean;
    rulerId: number | null;
    center: { x: number; y: number };
    coins: number;
    tools: Partial<Record<ToolId, number>>;
    /** Colonies only. */
    name?: string;
    parent?: number;
    recruitPolicy?: RecruitPolicy;
  }[];
  tradePolicy: TradePolicy;
  inventory: (Stack | null)[];
  /** Worn armour (missing in saves from before the armour slot). */
  armor?: Stack | null;
  selectedHotbar: number;
  player: { gx: number; gy: number; hp: number; maxHp: number; level: number; xp: number; food?: number; gender?: 'f' | 'm' };
  population: PopulationSnapshot;
  families: { affinity: Record<string, number>; chattedOn: Record<number, number> };
  diplomacy: { rel: Record<string, Relation>; pending: Proposal[] };
  missions: {
    diplomatId: number;
    kind: MissionKind | 'trade' | 'recruit';
    wanderer?: number;
    target: number;
    phase: 'going' | 'talking' | 'returning';
    timer: number;
    faction?: number;
    cargo?: Goods;
    shopping?: Goods;
    coins?: number;
    bought?: Goods;
  }[];
  /** NPC positions by id. */
  npcPositions: [number, number, number][];
  animals: AnimalData[];
  /** Ruins (same order as map.dungeons). */
  dungeons?: DungeonState[];
  /** Items lying on the ground (G). */
  drops?: { list: Drop[]; nextId: number };
}

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** localStorage, or undefined where it's unavailable (private mode, blocked storage, tests). */
function defaultStore(): Store | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

/** Shallow shape check: right version and the big pieces present. */
export function isSaveData(x: unknown): x is SaveData {
  if (typeof x !== 'object' || x === null) return false;
  const d = x as Partial<SaveData>;
  return (
    typeof d.version === 'number' &&
    d.version >= MIN_SAVE_VERSION &&
    d.version <= SAVE_VERSION &&
    typeof d.clock === 'number' &&
    Array.isArray(d.objects) &&
    Array.isArray(d.inventory) &&
    typeof d.player?.gx === 'number' &&
    Array.isArray(d.buildings?.list) &&
    Array.isArray(d.population?.npcs) &&
    Array.isArray(d.animals) &&
    Array.isArray(d.factions)
  );
}

// ---------- slots ----------

/** Ten manual slots plus the autosave one. */
export const SLOT_COUNT = 10;
export type SlotId = 'auto' | number;
export const SLOT_IDS: SlotId[] = ['auto', ...Array.from({ length: SLOT_COUNT }, (_, k) => k + 1)];
export const slotKey = (slot: SlotId) => `${SAVE_KEY}-slot-${slot}`;
export const slotName = (slot: SlotId) => (slot === 'auto' ? 'Autosave' : `Espaço ${slot}`);

/** What the slot lists show about a save. */
export interface SlotInfo {
  slot: SlotId;
  savedAt: string;
  day: number;
  /** Your villagers (0 before you have a village). */
  people: number;
  settled: boolean;
}

export function writeSave(data: SaveData, slot: SlotId = 'auto', store: Store | undefined = defaultStore()): boolean {
  try {
    store?.setItem(slotKey(slot), JSON.stringify(data));
    return store !== undefined;
  } catch {
    return false; // quota or blocked storage
  }
}

export function readSave(slot: SlotId = 'auto', store: Store | undefined = defaultStore()): SaveData | null {
  try {
    const raw = store?.getItem(slotKey(slot));
    if (!raw) return null;
    const data: unknown = JSON.parse(raw);
    return isSaveData(data) ? data : null;
  } catch {
    return null;
  }
}

export function deleteSave(slot: SlotId, store: Store | undefined = defaultStore()): void {
  try {
    store?.removeItem(slotKey(slot));
  } catch {
    // nothing to do
  }
}

export function slotInfo(slot: SlotId, data: SaveData, dayLength: number): SlotInfo {
  return {
    slot,
    savedAt: data.savedAt,
    day: Math.floor(data.clock / dayLength) + 1,
    people: data.population.npcs.filter((n) => n.role === 'villager' && n.faction === 0).length,
    settled: data.buildings.list.some((b) => b.type === 'stockpile' && b.faction === 0),
  };
}

/** Every slot, with its info or null when empty. */
export function listSlots(
  dayLength: number,
  store: Store | undefined = defaultStore(),
): { slot: SlotId; info: SlotInfo | null }[] {
  return SLOT_IDS.map((slot) => {
    const d = readSave(slot, store);
    return { slot, info: d ? slotInfo(slot, d, dayLength) : null };
  });
}

/** The most recently saved slot (what "Continuar" loads), or null. */
export function latestSlot(dayLength: number, store: Store | undefined = defaultStore()): SlotId | null {
  let best: SlotInfo | null = null;
  for (const { info } of listSlots(dayLength, store)) if (info && (!best || info.savedAt > best.savedAt)) best = info;
  return best?.slot ?? null;
}

/** Games saved before slots existed (one key) become the autosave slot. */
export function migrateLegacySave(store: Store | undefined = defaultStore()): void {
  try {
    const raw = store?.getItem(SAVE_KEY);
    if (!raw) return;
    if (!store?.getItem(slotKey('auto'))) store?.setItem(slotKey('auto'), raw);
    store?.removeItem(SAVE_KEY);
  } catch {
    // nothing to do
  }
}
