import { describe, expect, it } from 'vitest';
import { ADULT_AGE, DAY_SECONDS } from '../src/config';
import { Buildings } from '../src/game/buildings';
import {
  ageOf,
  compatibility,
  Families,
  type FamilyContext,
  inheritSkills,
  isAdult,
  MARRY_AT,
  PLAYER_ID,
  PLAYER_SURNAME,
  PROPOSE_AT,
} from '../src/game/families';
import { generateWanderer, type NpcData, Population } from '../src/game/npcs';
import { generateMap } from '../src/world/map';

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function setup() {
  const map = generateMap();
  const buildings = new Buildings(map);
  const pop = new Population(buildings);
  const s = map.sites[0];
  const house = buildings.place('house', s.x - 3, s.y - 3, true);
  let now = 100 * DAY_SECONDS;
  pop.now = () => now;
  const fam = new Families(pop);
  const person = (age: number, extra: Partial<NpcData> = {}): NpcData => {
    const n = generateWanderer(seeded(pop.newId() * 7), pop.newId(), 0, now);
    Object.assign(
      n,
      { role: 'villager', faction: 0, homeId: house.id, born: now - age * DAY_SECONDS, partnerId: null, parents: [], traits: [] },
      extra,
    );
    pop.npcs.push(n);
    return n;
  };
  const ctx = (rng = seeded(5)): FamilyContext => ({ now, rng, together: () => true, hasFood: () => true, playerFaction: 0 });
  return {
    pop,
    fam,
    house,
    person,
    ctx,
    advance: (days: number) => (now += days * DAY_SECONDS),
    get now() {
      return now;
    },
  };
}

describe('ages', () => {
  it('counts one year per game day', () => {
    expect(ageOf({ born: 0 }, DAY_SECONDS * 20.5)).toBe(20);
    expect(isAdult({ born: 0 }, DAY_SECONDS * (ADULT_AGE - 1))).toBe(false);
    expect(isAdult({ born: 0 }, DAY_SECONDS * ADULT_AGE)).toBe(true);
  });

  it('wanderers arrive as adults with a surname and no family', () => {
    const n = generateWanderer(seeded(3), 1, 0, 1000 * DAY_SECONDS);
    expect(ageOf(n, 1000 * DAY_SECONDS)).toBeGreaterThanOrEqual(ADULT_AGE);
    expect(n.surname.length).toBeGreaterThan(0);
    expect(n.partnerId).toBeNull();
    expect(n.parents).toEqual([]);
  });
});

describe('relationships', () => {
  it('single adults living together bond and marry, then share a house', () => {
    const t = setup();
    const a = t.person(25);
    const b = t.person(27);
    const events = [];
    for (let h = 0; h < 24 * 5 && a.partnerId === null; h++) events.push(...t.fam.update(DAY_SECONDS / 24, t.ctx()));
    expect(a.partnerId).toBe(b.id);
    expect(b.partnerId).toBe(a.id);
    expect(events.some((e) => e.type === 'married')).toBe(true);
    expect(t.fam.getAffinity(a.id, b.id)).toBe(MARRY_AT);
  });

  it('children, siblings and different villages never pair up', () => {
    const t = setup();
    const kid = t.person(10);
    t.person(30);
    const rival = t.person(30, { faction: 1 });
    for (let h = 0; h < 24 * 5; h++) t.fam.update(DAY_SECONDS / 24, t.ctx());
    expect(kid.partnerId).toBeNull();
    expect(rival.partnerId).toBeNull();
    const s1 = t.person(20, { parents: [99] });
    const s2 = t.person(21, { parents: [99] });
    for (let h = 0; h < 24 * 5; h++) t.fam.update(DAY_SECONDS / 24, t.ctx());
    expect(s1.partnerId === s2.id).toBe(false);
  });

  it('compatibility rewards shared traits and punishes clashing ones', () => {
    expect(compatibility({ traits: ['frugal'] }, { traits: ['frugal'] })).toBeGreaterThan(1);
    expect(compatibility({ traits: ['frugal'] }, { traits: ['appetite'] })).toBeLessThan(1);
  });
});

describe('children', () => {
  it('married couples with room and food have children who inherit surname and skills', () => {
    const t = setup();
    const a = t.person(25, { surname: 'Rocha' });
    const b = t.person(26, { surname: 'Dias', partnerId: a.id });
    a.partnerId = b.id;
    let born: NpcData | undefined;
    const rng = seeded(21);
    for (let h = 0; h < 24 * 30 && !born; h++) {
      for (const e of t.fam.update(DAY_SECONDS / 24, t.ctx(rng))) if (e.type === 'born') born = e.child;
    }
    expect(born).toBeDefined();
    expect(born!.parents).toEqual([a.id, b.id]);
    expect(born!.surname).toBe('Rocha');
    expect(born!.homeId).toBe(a.homeId);
    expect(isAdult(born!, t.now)).toBe(false);
    expect(t.pop.unemployed()).not.toContain(born); // children can't be hired
  });

  it('no children without food or room', () => {
    const t = setup();
    const a = t.person(25);
    const b = t.person(26, { partnerId: a.id });
    a.partnerId = b.id;
    for (let h = 0; h < 24 * 20; h++) {
      const events = t.fam.update(DAY_SECONDS / 24, { ...t.ctx(seeded(h)), hasFood: () => false });
      expect(events.some((e) => e.type === 'born')).toBe(false);
    }
  });

  it('inherited skills stay near the parents’ average', () => {
    const rng = seeded(8);
    const five = { woodcutting: 5, stonework: 5, mining: 5, hunting: 5, combat: 5, diplomacy: 5, smithing: 5, farming: 5 };
    for (let i = 0; i < 20; i++)
      for (const v of Object.values(inheritSkills(rng, five, five))) expect(v).toBeGreaterThanOrEqual(4);
  });
});

describe('the player', () => {
  it('builds affinity by chatting once a day and can propose at the threshold', () => {
    const t = setup();
    const n = t.person(30);
    let day = 1;
    while (t.fam.getAffinity(PLAYER_ID, n.id) < PROPOSE_AT) {
      expect(t.fam.canPropose(n, t.now)).toBe(false);
      t.fam.chat(n, day);
      t.fam.chat(n, day); // twice the same day doesn't count
      day++;
    }
    expect(day).toBeGreaterThan(3);
    expect(t.fam.propose(n, t.now)).toBe(true);
    expect(n.partnerId).toBe(PLAYER_ID);
    expect(t.pop.playerPartnerId).toBe(n.id);
  });

  it('player children carry the dynasty surname', () => {
    const t = setup();
    const n = t.person(30);
    n.partnerId = PLAYER_ID;
    t.pop.playerPartnerId = n.id;
    let child: NpcData | undefined;
    const rng = seeded(33);
    for (let h = 0; h < 24 * 40 && !child; h++) {
      for (const e of t.fam.update(DAY_SECONDS / 24, t.ctx(rng))) if (e.type === 'born') child = e.child;
    }
    expect(child?.parents).toEqual([n.id, PLAYER_ID]);
    expect(child?.surname).toBe(PLAYER_SURNAME);
  });
});

describe('death and memory', () => {
  it('the dead are remembered for the family tree and widow their spouse', () => {
    const t = setup();
    const a = t.person(70);
    const b = t.person(68, { partnerId: a.id });
    a.partnerId = b.id;
    t.pop.remove(a.id);
    expect(b.partnerId).toBeNull();
    expect(t.pop.person(a.id)).toMatchObject({ name: a.name, diedAt: t.now });
  });
});

describe('marriage between dynasties', () => {
  it('weds you if single, else your oldest single adult child, to the ruler’s family first', () => {
    const { pop, fam, person, now } = setup();
    const ruler = person(40, { faction: 2 });
    const stranger = person(25, { faction: 2 });
    const princess = person(20, { faction: 2, parents: [ruler.id] });
    expect(fam.dynasticMatch(2, ruler.id, now)).toEqual({ ours: PLAYER_ID, theirs: princess });
    fam.wed(PLAYER_ID, princess);
    expect(pop.playerPartnerId).toBe(princess.id);
    expect(princess.partnerId).toBe(PLAYER_ID);
    // Now married: your heir marries (the ruler's family has nobody single left, so anyone else).
    expect(fam.dynasticMatch(2, ruler.id, now)).toBeNull(); // no heir yet
    const heir = person(18, { parents: [PLAYER_ID, princess.id] });
    person(10, { parents: [PLAYER_ID, princess.id] }); // a child doesn't marry
    expect(fam.dynasticMatch(2, ruler.id, now)).toEqual({ ours: heir.id, theirs: stranger });
    fam.wed(heir.id, stranger);
    expect(heir.partnerId).toBe(stranger.id);
    expect(fam.dynasticMatch(2, ruler.id, now)).toBeNull(); // only the ruler is left single
  });
});
