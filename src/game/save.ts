import type { AnimalData } from './animals';
import type { Building } from './buildings';
import type { MissionKind, Proposal, Relation } from './diplomacy';
import type { NodesSnapshot } from './gathering';
import type { Amounts } from './inventory';
import type { PopulationSnapshot } from './npcs';
import type { Stack } from './slots';

export const SAVE_KEY = 'vila-medieval-save';
/** Bump when the shape changes; older saves are then ignored instead of half-loaded. */
export const SAVE_VERSION = 4;

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
  factions: { id: number; stock: Amounts; alive: boolean; rulerId: number | null; center: { x: number; y: number } }[];
  inventory: (Stack | null)[];
  selectedHotbar: number;
  player: { gx: number; gy: number; hp: number; maxHp: number; level: number; xp: number };
  population: PopulationSnapshot;
  families: { affinity: Record<string, number>; chattedOn: Record<number, number> };
  diplomacy: { rel: Record<string, Relation>; pending: Proposal[] };
  missions: { diplomatId: number; kind: MissionKind; target: number; phase: 'going' | 'talking' | 'returning'; timer: number }[];
  /** NPC positions by id. */
  npcPositions: [number, number, number][];
  animals: AnimalData[];
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
    d.version === SAVE_VERSION &&
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

export function writeSave(data: SaveData, store: Store | undefined = defaultStore()): boolean {
  try {
    store?.setItem(SAVE_KEY, JSON.stringify(data));
    return store !== undefined;
  } catch {
    return false; // quota or blocked storage
  }
}

export function readSave(store: Store | undefined = defaultStore()): SaveData | null {
  try {
    const raw = store?.getItem(SAVE_KEY);
    if (!raw) return null;
    const data: unknown = JSON.parse(raw);
    return isSaveData(data) ? data : null;
  } catch {
    return null;
  }
}

export function clearSave(store: Store | undefined = defaultStore()): void {
  try {
    store?.removeItem(SAVE_KEY);
  } catch {
    // nothing to do
  }
}
