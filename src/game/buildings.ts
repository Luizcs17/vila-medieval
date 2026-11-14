import { Ground, inBounds, Obj, tileIndex, type WorldMap } from '../world/map';
import type { Amounts, Resource } from './inventory';
import type { Skill } from './npcs';

/** A workplace: villagers assigned here use `skill` on `nodes` within `radius` tiles. */
export interface JobDef {
  skill: Skill;
  slots: number;
  /** Map objects workers harvest. Empty for hunters (they hunt animals). */
  nodes: Obj[];
  radius: number;
  /** Job title, gendered. */
  title: { f: string; m: string };
}

export type BuildingType =
  | 'stockpile'
  | 'house'
  | 'lumberjack'
  | 'quarry'
  | 'mine'
  | 'hunter'
  | 'depot'
  | 'palisade'
  | 'gate'
  | 'tower'
  | 'barracks';

export interface BuildingDef {
  name: string;
  /** Square footprint, in tiles. */
  size: number;
  /** Paid from the central stockpile when the site is placed. */
  cost: Partial<Amounts>;
  /** Seconds the player must hold E on the site to finish it. */
  buildSeconds: number;
  description: string;
  /** Must be placed within `radius` tiles of at least one of these objects. */
  near?: { objs: Obj[]; radius: number; label: string };
  /** Players can drop resources here; they go into the shared central stock. */
  deposit?: boolean;
  /** Shown in the build menu. */
  buildable: boolean;
  /** Resource icon shown above the finished building. */
  sign?: Resource;
  job?: JobDef;
  /** Territory radius (tiles) this building claims for its faction. */
  claim: number;
  /** Hit points when finished (raids and animals can damage buildings). */
  maxHp: number;
  /** Towers: shoot at hostiles within `range` tiles for `damage` every `cooldown` seconds. */
  defense?: { range: number; damage: number; cooldown: number };
  /** Walls and gates: placement mode stays on so you can lay several in a row. */
  repeatPlace?: boolean;
}

export const BUILDING_DEFS: Record<BuildingType, BuildingDef> = {
  stockpile: {
    claim: 9,
    maxHp: 250,
    name: 'Estoque central',
    size: 1,
    cost: {},
    buildSeconds: 0,
    description: 'Onde a vila guarda seus recursos.',
    deposit: true,
    buildable: false,
  },
  house: {
    claim: 4,
    maxHp: 100,
    name: 'Casa',
    size: 2,
    cost: { wood: 20, stone: 10 },
    buildSeconds: 20,
    description: 'Moradia para 2 aldeões.',
    buildable: true,
  },
  lumberjack: {
    claim: 4,
    maxHp: 100,
    name: 'Cabana do lenhador',
    size: 2,
    cost: { wood: 15, stone: 5 },
    buildSeconds: 15,
    description: 'Um aldeão aqui corta árvores.',
    near: { objs: [Obj.Tree, Obj.Pine], radius: 6, label: 'árvores' },
    buildable: true,
    sign: 'wood',
    job: { skill: 'woodcutting', slots: 2, nodes: [Obj.Tree, Obj.Pine], radius: 9, title: { f: 'Lenhadora', m: 'Lenhador' } },
  },
  quarry: {
    claim: 4,
    maxHp: 100,
    name: 'Pedreira',
    size: 2,
    cost: { wood: 20 },
    buildSeconds: 15,
    description: 'Um aldeão aqui quebra pedras.',
    near: { objs: [Obj.Rock], radius: 6, label: 'pedras' },
    buildable: true,
    sign: 'stone',
    job: { skill: 'stonework', slots: 2, nodes: [Obj.Rock], radius: 9, title: { f: 'Pedreira', m: 'Pedreiro' } },
  },
  mine: {
    claim: 4,
    maxHp: 120,
    name: 'Mina',
    size: 2,
    cost: { wood: 20, stone: 15 },
    buildSeconds: 25,
    description: 'Um aldeão aqui extrai ferro.',
    near: { objs: [Obj.Iron], radius: 6, label: 'ferro' },
    buildable: true,
    sign: 'iron',
    job: { skill: 'mining', slots: 2, nodes: [Obj.Iron], radius: 9, title: { f: 'Mineira', m: 'Mineiro' } },
  },
  hunter: {
    claim: 4,
    maxHp: 100,
    name: 'Cabana do caçador',
    size: 2,
    cost: { wood: 15, stone: 5 },
    buildSeconds: 15,
    description: 'Um aldeão aqui caça animais.',
    buildable: true,
    sign: 'meat',
    job: { skill: 'hunting', slots: 2, nodes: [], radius: 14, title: { f: 'Caçadora', m: 'Caçador' } },
  },
  depot: {
    claim: 5,
    maxHp: 80,
    name: 'Depósito',
    size: 1,
    cost: { wood: 10, stone: 5 },
    buildSeconds: 8,
    description: 'Outro ponto para guardar no estoque.',
    deposit: true,
    buildable: true,
  },
  palisade: {
    claim: 0,
    name: 'Paliçada',
    size: 1,
    cost: { wood: 3 },
    buildSeconds: 3,
    description: 'Muro de troncos: bloqueia animais e inimigos.',
    buildable: true,
    repeatPlace: true,
    maxHp: 60,
  },
  gate: {
    claim: 0,
    name: 'Portão',
    size: 1,
    cost: { wood: 5 },
    buildSeconds: 4,
    description: 'Passagem na paliçada só para o seu povo.',
    buildable: true,
    repeatPlace: true,
    maxHp: 80,
  },
  tower: {
    claim: 8,
    name: 'Torre de vigia',
    size: 1,
    cost: { wood: 15, stone: 10 },
    buildSeconds: 15,
    description: 'Atira em animais agressivos e inimigos. Amplia o território.',
    buildable: true,
    maxHp: 120,
    defense: { range: 6, damage: 1, cooldown: 1.5 },
  },
  barracks: {
    claim: 5,
    name: 'Quartel',
    size: 2,
    cost: { wood: 25, stone: 15 },
    buildSeconds: 25,
    description: 'Soldados protegem a vila (e atacam em guerras).',
    buildable: true,
    maxHp: 150,
    job: { skill: 'combat', slots: 4, nodes: [], radius: 10, title: { f: 'Soldada', m: 'Soldado' } },
  },
};

export const BUILD_MENU: BuildingType[] = (Object.keys(BUILDING_DEFS) as BuildingType[]).filter(
  (t) => BUILDING_DEFS[t].buildable,
);

export interface Building {
  id: number;
  type: BuildingType;
  /** Owner faction (0 = the player). */
  faction: number;
  /** Footprint's minimum corner (north tile). */
  tx: number;
  ty: number;
  built: boolean;
  /** Seconds of construction done so far. */
  progress: number;
  /** Current hit points (max is BUILDING_DEFS[type].maxHp). */
  hp: number;
}

export type PlaceCheck = { ok: true } | { ok: false; reason: string };

/** Objects a building can be placed over (they get cleared). */
const CLEARABLE = new Set<Obj>([Obj.None, Obj.Stump, Obj.Sapling]);

/** All buildings and construction sites, and which tiles they cover. */
export class Buildings {
  readonly list: Building[] = [];
  private readonly byTile = new Map<number, Building>();
  private nextId = 1;

  constructor(private readonly map: WorldMap) {}

  get mapWidth(): number {
    return this.map.w;
  }

  at(i: number): Building | undefined {
    return this.byTile.get(i);
  }

  /** Tile indices of a footprint. */
  footprint(type: BuildingType, tx: number, ty: number): number[] {
    const s = BUILDING_DEFS[type].size;
    const out: number[] = [];
    for (let y = ty; y < ty + s; y++) for (let x = tx; x < tx + s; x++) out.push(tileIndex(this.map, x, y));
    return out;
  }

  /** Can `type` go with its north corner at (tx, ty)? `blocked(i)` lets the caller veto tiles (e.g. the player is there). */
  check(type: BuildingType, tx: number, ty: number, blocked: (i: number) => boolean = () => false): PlaceCheck {
    const def = BUILDING_DEFS[type];
    for (let y = ty; y < ty + def.size; y++) {
      for (let x = tx; x < tx + def.size; x++) {
        if (!inBounds(this.map, x, y)) return { ok: false, reason: 'Fora do mapa' };
        const i = tileIndex(this.map, x, y);
        if (this.map.ground[i] === Ground.Water) return { ok: false, reason: 'Não dá para construir na água' };
        if (!CLEARABLE.has(this.map.objects[i])) return { ok: false, reason: 'Local ocupado' };
        if (blocked(i)) return { ok: false, reason: 'Saia de cima do local' };
      }
    }
    if (def.near && !this.hasNearby(tx + def.size / 2, ty + def.size / 2, def.near.objs, def.near.radius)) {
      return { ok: false, reason: `Precisa de ${def.near.label} por perto` };
    }
    return { ok: true };
  }

  /** Places a building or construction site. Does not check or pay; call `check` first. */
  place(type: BuildingType, tx: number, ty: number, built = false, faction = 0): Building {
    const b: Building = { id: this.nextId++, type, faction, tx, ty, built, progress: 0, hp: BUILDING_DEFS[type].maxHp };
    for (const i of this.footprint(type, tx, ty)) {
      this.map.objects[i] = type === 'gate' ? Obj.Gate : Obj.Building;
      this.byTile.set(i, b);
    }
    this.list.push(b);
    return b;
  }

  snapshot(): { list: Building[]; nextId: number } {
    return { list: this.list.map((b) => ({ ...b })), nextId: this.nextId };
  }

  /** Replaces all buildings (map tiles under them become Obj.Building). */
  restore(s: { list: Building[]; nextId: number }): void {
    this.list.length = 0;
    this.byTile.clear();
    for (const b of s.list) {
      const copy = { ...b };
      for (const i of this.footprint(copy.type, copy.tx, copy.ty)) {
        this.map.objects[i] = copy.type === 'gate' ? Obj.Gate : Obj.Building;
        this.byTile.set(i, copy);
      }
      this.list.push(copy);
    }
    this.nextId = s.nextId;
  }

  /** Damages a building. Returns true if it was destroyed (the caller removes it). */
  damage(b: Building, amount: number): boolean {
    b.hp = Math.max(0, b.hp - amount);
    return b.hp === 0;
  }

  /** Restores hit points, up to the maximum. Returns how much was restored. */
  repair(b: Building, amount: number): number {
    const before = b.hp;
    b.hp = Math.min(BUILDING_DEFS[b.type].maxHp, b.hp + amount);
    return b.hp - before;
  }

  /** Removes a building (destroyed or demolished); its tiles become empty. */
  remove(b: Building): void {
    for (const i of this.footprint(b.type, b.tx, b.ty)) {
      this.map.objects[i] = Obj.None;
      this.byTile.delete(i);
    }
    const k = this.list.indexOf(b);
    if (k >= 0) this.list.splice(k, 1);
  }

  /** Adds construction work. Returns true on the call that finishes the building. */
  work(b: Building, dt: number): boolean {
    if (b.built) return false;
    b.progress += dt;
    if (b.progress >= BUILDING_DEFS[b.type].buildSeconds) {
      b.progress = BUILDING_DEFS[b.type].buildSeconds;
      b.built = true;
      return true;
    }
    return false;
  }

  private hasNearby(cx: number, cy: number, objs: Obj[], radius: number): boolean {
    const want = new Set(objs);
    for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y++) {
      for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x++) {
        if (!inBounds(this.map, x, y)) continue;
        if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) > radius) continue;
        if (want.has(this.map.objects[tileIndex(this.map, x, y)])) return true;
      }
    }
    return false;
  }
}
