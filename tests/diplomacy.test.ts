import { describe, expect, it } from 'vitest';
import { BUILD_MENU, BUILDING_DEFS } from '../src/game/buildings';
import { ALLIANCE_MIN, Diplomacy, giftValue, missionChance } from '../src/game/diplomacy';

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const IDS = [0, 1, 2, 3];
const never = () => false;

describe('relations', () => {
  it('start at peace with mild random scores', () => {
    const d = new Diplomacy();
    d.init(IDS, seeded(1));
    for (const a of IDS)
      for (const b of IDS) {
        if (a === b) continue;
        const r = d.get(a, b);
        expect(r.status).toBe('peace');
        expect(Math.abs(r.score)).toBeLessThanOrEqual(15);
        expect(d.get(b, a)).toBe(r); // symmetric
      }
  });

  it('drift toward neutral, and shared borders cause friction', () => {
    const d = new Diplomacy();
    d.get(0, 1).score = 30;
    d.get(1, 2).score = 0;
    d.daily(IDS, 0, seeded(2), (a, b) => a === 1 && b === 2);
    expect(d.get(0, 1).score).toBe(29);
    expect(d.get(1, 2).score).toBe(-2);
  });
});

describe('war and alliances', () => {
  it('declaring war drags in allies on both sides', () => {
    const d = new Diplomacy();
    d.makeAlliance(0, 2); // player + 2
    d.makeAlliance(1, 3); // 1 + 3
    const wars = d.declareWar(0, 1, IDS, 'teste');
    expect(d.atWar(0, 1)).toBe(true);
    expect(d.atWar(2, 1)).toBe(true); // our ally joins
    expect(d.atWar(3, 0)).toBe(true); // their ally joins
    expect(d.atWar(2, 3)).toBe(false); // allies of each side aren't forced to fight each other
    expect(wars.length).toBe(3);
  });

  it('AI villages declare war when relations are terrible, and the AI only proposes to the player', () => {
    const d = new Diplomacy();
    d.get(1, 2).score = -90;
    d.get(0, 3).score = 90;
    let warred = false;
    let proposed = false;
    for (let day = 0; day < 20; day++) {
      for (const e of d.daily(IDS, day * 480, seeded(day + 5), never)) {
        if (e.type === 'war' && e.a !== 0 && e.b !== 0) warred = true;
        if (e.type === 'proposal' && e.proposal.from === 3 && e.proposal.kind === 'alliance') proposed = true;
      }
    }
    expect(warred).toBe(true);
    expect(proposed).toBe(true);
    expect(d.allied(0, 3)).toBe(false); // waiting for the player's answer
    const p = d.pending.find((x) => x.from === 3)!;
    d.answer(p, true);
    expect(d.allied(0, 3)).toBe(true);
  });

  it('refusing a proposal costs relation', () => {
    const d = new Diplomacy();
    d.get(0, 1).score = 70;
    d.pending.push({ from: 1, kind: 'alliance', expires: 999 });
    d.answer(d.pending[0], false);
    expect(d.get(0, 1).score).toBe(60);
    expect(d.pending).toHaveLength(0);
  });

  it('forgets a conquered village', () => {
    const d = new Diplomacy();
    d.init(IDS, seeded(3));
    d.forget(2);
    expect(Object.keys(d.rel).some((k) => k.split(':').includes('2'))).toBe(false);
  });
});

describe('missions', () => {
  it('gifts always land; better diplomats persuade more', () => {
    expect(missionChance('gift', 1, -50)).toBe(1);
    expect(giftValue(5)).toBeGreaterThan(giftValue(1));
    expect(missionChance('alliance', 5, ALLIANCE_MIN)).toBeGreaterThan(missionChance('alliance', 1, ALLIANCE_MIN));
    expect(missionChance('peace', 3, -10)).toBeGreaterThan(missionChance('peace', 3, -90));
    for (const k of ['alliance', 'peace'] as const) {
      expect(missionChance(k, 5, 100)).toBeLessThanOrEqual(0.95);
      expect(missionChance(k, 1, -100)).toBeGreaterThanOrEqual(0.05);
    }
  });

  it('has an embassy that employs diplomats', () => {
    expect(BUILD_MENU).toContain('embassy');
    expect(BUILDING_DEFS.embassy.job?.skill).toBe('diplomacy');
  });
});
