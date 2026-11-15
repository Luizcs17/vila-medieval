import { describe, expect, it } from 'vitest';
import { Buildings } from '../src/game/buildings';
import { NODE_DEFS, ResourceNodes } from '../src/game/gathering';
import { generateWanderer, Population } from '../src/game/npcs';
import { PlayerStats } from '../src/game/player';
import { clearSave, isSaveData, readSave, SAVE_VERSION, type SaveData, writeSave } from '../src/game/save';
import { generateMap, Obj } from '../src/world/map';

/** In-memory stand-in for localStorage. */
function memoryStore() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

function sampleSave(): SaveData {
  const map = generateMap();
  return {
    version: SAVE_VERSION,
    savedAt: new Date(0).toISOString(),
    clock: 1234,
    objects: [...map.objects],
    nodes: { remaining: [], regrowing: [] },
    buildings: { list: [], nextId: 1 },
    stockpile: { wood: 5, stone: 0, iron: 0, meat: 2 },
    factions: [],
    inventory: [{ item: 'stone_axe', count: 1, durability: 40 }, null],
    selectedHotbar: 0,
    player: { gx: 10.5, gy: 11.5, hp: 7, maxHp: 11, level: 2, xp: 3 },
    population: { npcs: [], nextId: 1 },
    families: { affinity: {}, chattedOn: {} },
    diplomacy: { rel: {}, pending: [] },
    missions: [],
    tradePolicy: { sellAbove: {}, buyUpTo: {} },
    npcPositions: [],
    animals: [],
  };
}

describe('save storage', () => {
  it('round-trips through storage', () => {
    const store = memoryStore();
    const data = sampleSave();
    expect(writeSave(data, store)).toBe(true);
    expect(readSave(store)).toEqual(data);
    clearSave(store);
    expect(readSave(store)).toBeNull();
  });

  it('ignores corrupt, foreign or outdated saves', () => {
    const store = memoryStore();
    store.setItem('vila-medieval-save', '{not json');
    expect(readSave(store)).toBeNull();
    expect(isSaveData({ ...sampleSave(), version: SAVE_VERSION + 1 })).toBe(false);
    expect(isSaveData({ hello: 'world' })).toBe(false);
    expect(isSaveData(null)).toBe(false);
  });

  it('works without any storage (private mode)', () => {
    expect(writeSave(sampleSave(), undefined)).toBe(false);
    expect(readSave(undefined)).toBeNull();
  });
});

describe('snapshots', () => {
  it('buildings restore their tiles and ids', () => {
    const map = generateMap();
    const b = new Buildings(map);
    const s = { x: Math.floor(map.spawn.x), y: Math.floor(map.spawn.y) };
    const house = b.place('house', s.x - 3, s.y - 3, true);
    const snap = JSON.parse(JSON.stringify(b.snapshot()));

    const map2 = generateMap();
    const b2 = new Buildings(map2);
    b2.restore(snap);
    expect(b2.list).toEqual([house]);
    expect(b2.at(map2.w * (s.y - 3) + (s.x - 3))?.type).toBe('house');
    expect(map2.objects[map2.w * (s.y - 2) + (s.x - 2)]).toBe(Obj.Building);
    expect(b2.place('depot', s.x, s.y).id).toBe(house.id + 1); // ids keep counting
  });

  it('resource nodes keep partial harvests and regrowth timers', () => {
    const map = generateMap();
    const nodes = new ResourceNodes(map);
    const tree = map.objects.indexOf(Obj.Tree);
    const rock = map.objects.indexOf(Obj.Rock);
    nodes.harvest(tree);
    for (let n = 0; n < NODE_DEFS[Obj.Rock]!.amount; n++) nodes.harvest(rock);
    nodes.update(100, () => true);
    const snap = JSON.parse(JSON.stringify(nodes.snapshot()));

    const map2 = generateMap();
    map2.objects.splice(0, map2.objects.length, ...map.objects);
    const nodes2 = new ResourceNodes(map2);
    nodes2.restore(snap);
    expect(nodes2.remainingAt(tree)).toBe(nodes.remainingAt(tree));
    expect(nodes2.regrowingCount).toBe(1);
    nodes2.update(NODE_DEFS[Obj.Rock]!.regrowSeconds, () => true);
    expect(map2.objects[rock]).toBe(Obj.Rock);
  });

  it('population and player stats survive JSON', () => {
    const map = generateMap();
    const pop = new Population(new Buildings(map));
    pop.npcs.push(generateWanderer(() => 0.3, pop.newId(), 99));
    const pop2 = new Population(new Buildings(map));
    pop2.restore(JSON.parse(JSON.stringify(pop.snapshot())));
    expect(pop2.npcs).toEqual(pop.npcs);
    expect(pop2.newId()).toBe(2);

    const p = new PlayerStats();
    p.addXp(100);
    p.hurt(2);
    const p2 = new PlayerStats();
    p2.restore(JSON.parse(JSON.stringify(p.snapshot())));
    expect(p2.snapshot()).toEqual(p.snapshot());
  });
});
