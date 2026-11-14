import { Ground, inBounds, Obj, tileIndex, type WorldMap } from '../world/map';
import type { Amounts, Resource } from './inventory';

export type BuildingType = 'stockpile' | 'house' | 'lumberjack' | 'quarry' | 'mine' | 'hunter' | 'depot';

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
}

export const BUILDING_DEFS: Record<BuildingType, BuildingDef> = {
  stockpile: {
    name: 'Estoque central',
    size: 1,
    cost: {},
    buildSeconds: 0,
    description: 'Onde a vila guarda seus recursos.',
    deposit: true,
    buildable: false,
  },
  house: {
    name: 'Casa',
    size: 2,
    cost: { wood: 20, stone: 10 },
    buildSeconds: 20,
    description: 'Moradia para 2 aldeões.',
    buildable: true,
  },
  lumberjack: {
    name: 'Cabana do lenhador',
    size: 2,
    cost: { wood: 15, stone: 5 },
    buildSeconds: 15,
    description: 'Um aldeão aqui corta árvores.',
    near: { objs: [Obj.Tree, Obj.Pine], radius: 6, label: 'árvores' },
    buildable: true,
    sign: 'wood',
  },
  quarry: {
    name: 'Pedreira',
    size: 2,
    cost: { wood: 20 },
    buildSeconds: 15,
    description: 'Um aldeão aqui quebra pedras.',
    near: { objs: [Obj.Rock], radius: 6, label: 'pedras' },
    buildable: true,
    sign: 'stone',
  },
  mine: {
    name: 'Mina',
    size: 2,
    cost: { wood: 20, stone: 15 },
    buildSeconds: 25,
    description: 'Um aldeão aqui extrai ferro.',
    near: { objs: [Obj.Iron], radius: 6, label: 'ferro' },
    buildable: true,
    sign: 'iron',
  },
  hunter: {
    name: 'Cabana do caçador',
    size: 2,
    cost: { wood: 15, stone: 5 },
    buildSeconds: 15,
    description: 'Um aldeão aqui caça animais.',
    buildable: true,
    sign: 'meat',
  },
  depot: {
    name: 'Depósito',
    size: 1,
    cost: { wood: 10, stone: 5 },
    buildSeconds: 8,
    description: 'Outro ponto para guardar no estoque.',
    deposit: true,
    buildable: true,
  },
};

export const BUILD_MENU: BuildingType[] = (Object.keys(BUILDING_DEFS) as BuildingType[]).filter(
  (t) => BUILDING_DEFS[t].buildable,
);

export interface Building {
  id: number;
  type: BuildingType;
  /** Footprint's minimum corner (north tile). */
  tx: number;
  ty: number;
  built: boolean;
  /** Seconds of construction done so far. */
  progress: number;
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
  place(type: BuildingType, tx: number, ty: number, built = false): Building {
    const b: Building = { id: this.nextId++, type, tx, ty, built, progress: 0 };
    for (const i of this.footprint(type, tx, ty)) {
      this.map.objects[i] = Obj.Building;
      this.byTile.set(i, b);
    }
    this.list.push(b);
    return b;
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
