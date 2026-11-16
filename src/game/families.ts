import { BEDS_PER_HOUSE, DAY_SECONDS } from '../config';
import { childLook } from './looks';
import {
  ageOf,
  generateWanderer,
  isAdult,
  type NpcData,
  type Population,
  type Rng,
  SKILLS,
  type Skills,
  TRAITS,
  type TraitId,
} from './npcs';

export { ADULT_AGE } from '../config';
export { SURNAMES } from './npcs';

export const OLD_AGE = 65;
/** Couples stop having children at this age. */
export const FERTILE_UNTIL = 48;
export const MAX_CHILDREN = 4;
/** Affinity needed to marry (villagers marry on their own; the player proposes). */
export const MARRY_AT = 100;
export const PROPOSE_AT = 60;
/** The player is person 0 in family trees. */
export const PLAYER_ID = 0;
export const PLAYER_SURNAME = 'Valverde';

export { ageOf, fullName, isAdult } from './npcs';

const pairKey = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);

/** How well two people get along: shared traits help, opposite appetites clash. */
export function compatibility(a: Pick<NpcData, 'traits'>, b: Pick<NpcData, 'traits'>): number {
  let c = 1;
  if (a.traits.some((t) => b.traits.includes(t))) c *= 1.5;
  const clash = (x: TraitId, y: TraitId) =>
    (a.traits.includes(x) && b.traits.includes(y)) || (a.traits.includes(y) && b.traits.includes(x));
  if (clash('frugal', 'appetite')) c *= 0.5;
  if (clash('tireless', 'slow')) c *= 0.6;
  return c;
}

/** A child's ratings: the parents' average ± 1 (a parent of null counts as 3s). */
export function inheritSkills(rng: Rng, a: Skills | null, b: Skills | null): Skills {
  const out = {} as Skills;
  for (const s of SKILLS) {
    const avg = ((a?.[s] ?? 3) + (b?.[s] ?? 3)) / 2;
    out[s] = Math.max(1, Math.min(5, Math.round(avg + (rng() * 2 - 1))));
  }
  return out;
}

export type FamilyEvent =
  | { type: 'married'; a: NpcData; b: NpcData | null }
  | { type: 'born'; child: NpcData; parents: number[] }
  | { type: 'died'; npc: NpcData; age: number };

/** Inputs the family simulation needs from the world each tick. */
export interface FamilyContext {
  now: number;
  rng: Rng;
  /** Are two villagers close enough to bond (same house, or near each other)? */
  together(a: NpcData, b: NpcData): boolean;
  /** Can this faction afford another mouth (food in the stockpile)? */
  hasFood(faction: number): boolean;
  /** For the player's family: does the player's spouse's house have a free bed? (player marriage). */
  playerFaction: number;
}

/**
 * Relationships, marriages, births and old age. Ticks once per game hour; returns events for the
 * caller to show (and to create/remove on-map entities).
 */
export class Families {
  /** Affinity 0..MARRY_AT between pairs of people, keyed "lowId:highId" (player is id 0). */
  affinity: Record<string, number> = {};
  /** Last game day the player chatted with each villager (one affinity boost per day). */
  chattedOn: Record<number, number> = {};
  private acc = 0;

  constructor(private readonly pop: Population) {}

  getAffinity(a: number, b: number): number {
    return this.affinity[pairKey(a, b)] ?? 0;
  }

  private addAffinity(a: number, b: number, v: number): number {
    const k = pairKey(a, b);
    this.affinity[k] = Math.max(0, Math.min(MARRY_AT, (this.affinity[k] ?? 0) + v));
    return this.affinity[k];
  }

  /** Talking to a villager raises their affinity with you once per day. Returns the new value. */
  chat(npc: NpcData, day: number): number {
    if (this.chattedOn[npc.id] === day) return this.getAffinity(PLAYER_ID, npc.id);
    this.chattedOn[npc.id] = day;
    return this.addAffinity(PLAYER_ID, npc.id, 12);
  }

  /**
   * A marriage between dynasties: who of yours marries (you if single, else your oldest unmarried
   * adult child) and who of village `faction` (the ruler's unmarried adult children first, then any
   * unmarried adult who isn't the ruler). Null when either side has nobody.
   */
  dynasticMatch(faction: number, ruler: number | null, now: number): { ours: number; theirs: NpcData } | null {
    const single = (n: NpcData) => n.role === 'villager' && n.partnerId === null && isAdult(n, now);
    let ours: number | null = this.pop.playerPartnerId === null ? PLAYER_ID : null;
    if (ours === null) {
      const heir = this.pop.npcs
        .filter((n) => single(n) && n.faction === 0 && n.parents.includes(PLAYER_ID))
        .sort((a, b) => a.born - b.born)[0];
      ours = heir?.id ?? null;
    }
    if (ours === null) return null;
    const pool = this.pop.villagersOf(faction).filter((n) => single(n) && n.id !== ruler);
    const theirs = pool.find((n) => ruler !== null && n.parents.includes(ruler)) ?? pool[0];
    return theirs ? { ours, theirs } : null;
  }

  /** Marries `ours` (PLAYER_ID or one of your villagers) and `theirs`. */
  wed(ours: number, theirs: NpcData): void {
    theirs.partnerId = ours;
    if (ours === PLAYER_ID) this.pop.playerPartnerId = theirs.id;
    else {
      const o = this.pop.npcs.find((n) => n.id === ours);
      if (o) o.partnerId = theirs.id;
    }
  }

  /** Can the player propose to this villager right now? */
  canPropose(npc: NpcData, now: number): boolean {
    return (
      npc.role === 'villager' &&
      npc.faction === 0 &&
      npc.partnerId === null &&
      this.pop.playerPartnerId === null &&
      isAdult(npc, now) &&
      this.getAffinity(PLAYER_ID, npc.id) >= PROPOSE_AT
    );
  }

  propose(npc: NpcData, now: number): boolean {
    if (!this.canPropose(npc, now)) return false;
    npc.partnerId = PLAYER_ID;
    this.pop.playerPartnerId = npc.id;
    return true;
  }

  update(dt: number, ctx: FamilyContext): FamilyEvent[] {
    this.acc += dt;
    const hour = DAY_SECONDS / 24;
    const events: FamilyEvent[] = [];
    while (this.acc >= hour) {
      this.acc -= hour;
      this.tick(ctx, events);
    }
    return events;
  }

  private tick(ctx: FamilyContext, events: FamilyEvent[]): void {
    const { now, rng } = ctx;
    const people = this.pop.allVillagers;

    // Old age: after 65, a growing chance each year (spread over the day's hours).
    for (const n of people) {
      const age = ageOf(n, now);
      if (age >= OLD_AGE && rng() < ((age - OLD_AGE + 1) * 0.08) / 24) events.push({ type: 'died', npc: n, age });
    }

    // Bonding and marriage between single adults of the same village.
    const singles = people.filter((n) => n.partnerId === null && isAdult(n, now));
    for (let i = 0; i < singles.length; i++) {
      for (let j = i + 1; j < singles.length; j++) {
        const a = singles[i];
        const b = singles[j];
        if (a.faction !== b.faction || a.partnerId !== null || b.partnerId !== null) continue;
        if (a.parents.includes(b.id) || b.parents.includes(a.id) || siblings(a, b)) continue;
        if (!ctx.together(a, b)) continue;
        const v = this.addAffinity(a.id, b.id, 3 * compatibility(a, b));
        if (v >= MARRY_AT) {
          a.partnerId = b.id;
          b.partnerId = a.id;
          this.moveIn(a, b);
          events.push({ type: 'married', a, b });
        }
      }
    }

    // Children: a couple sharing a house with a free bed and food to spare.
    const seen = new Set<number>();
    for (const a of people) {
      if (a.partnerId === null || seen.has(a.id)) continue;
      seen.add(a.id);
      const isPlayerCouple = a.partnerId === PLAYER_ID;
      const b = isPlayerCouple ? null : (people.find((x) => x.id === a.partnerId) ?? null);
      if (!isPlayerCouple && !b) continue;
      if (b) seen.add(b.id);
      if (ageOf(a, now) > FERTILE_UNTIL || (b && ageOf(b, now) > FERTILE_UNTIL)) continue;
      if (b && a.homeId !== b.homeId) continue;
      if (a.homeId === null || !ctx.hasFood(a.faction)) continue;
      if (this.pop.residents(a.homeId).length >= BEDS_PER_HOUSE) continue;
      const kids = this.pop.allVillagers.filter((c) => c.parents.includes(a.id)).length;
      if (kids >= MAX_CHILDREN) continue;
      if (rng() >= 0.35 / 24) continue;
      const child = this.birth(rng, a, b, now);
      events.push({ type: 'born', child, parents: child.parents });
    }
  }

  /** Newlyweds share a house when one of them has room. */
  private moveIn(a: NpcData, b: NpcData): void {
    if (a.homeId === b.homeId) return;
    const room = (h: number | null, extra: NpcData) =>
      h !== null && this.pop.residents(h).filter((r) => r.id !== extra.id).length < BEDS_PER_HOUSE;
    if (room(a.homeId, b)) b.homeId = a.homeId;
    else if (room(b.homeId, a)) a.homeId = b.homeId;
  }

  private birth(rng: Rng, a: NpcData, b: NpcData | null, now: number): NpcData {
    const child = generateWanderer(rng, this.pop.newId(), Infinity);
    child.role = 'villager';
    child.tier = 'common';
    child.faction = a.faction;
    child.homeId = a.homeId;
    child.born = now;
    child.parents = b ? [a.id, b.id] : [a.id, PLAYER_ID];
    child.surname = b ? a.surname : PLAYER_SURNAME;
    child.skills = inheritSkills(rng, a.skills, b ? b.skills : null);
    // Half the time a child takes after a parent's trait.
    const parentTraits = [...a.traits, ...(b?.traits ?? [])];
    if (parentTraits.length > 0 && rng() < 0.5) child.traits = [parentTraits[Math.floor(rng() * parentTraits.length)]];
    else child.traits = [(Object.keys(TRAITS) as TraitId[])[Math.floor(rng() * Object.keys(TRAITS).length)]];
    child.request = {};
    child.variant = (rng() < 0.5 ? a.variant : (b?.variant ?? a.variant)) % 8;
    child.look = childLook(rng, child.gender, a.look, b?.look);
    this.pop.npcs.push(child);
    return child;
  }
}

const siblings = (a: NpcData, b: NpcData) => a.parents.length > 0 && a.parents.some((p) => b.parents.includes(p));
