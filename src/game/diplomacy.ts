import type { Amounts } from './inventory';
import type { Rng } from './npcs';

export type Status = 'peace' | 'alliance' | 'war';

export interface Relation {
  /** -100 (hatred) .. 100 (friendship). */
  score: number;
  status: Status;
}

export type MissionKind = 'gift' | 'alliance' | 'peace';

export const MISSION_LABEL: Record<MissionKind, string> = {
  gift: 'Levar presente',
  alliance: 'Propor aliança',
  peace: 'Propor paz',
};

/** Paid when a diplomat leaves with a gift. */
export const GIFT_COST: Partial<Amounts> = { wood: 10, meat: 5 };
/** Relation needed before an alliance can be proposed. */
export const ALLIANCE_MIN = 40;

export interface Proposal {
  from: number;
  kind: 'alliance' | 'peace';
  /** Game time when it lapses. */
  expires: number;
}

export type DiploEvent =
  | { type: 'war'; a: number; b: number; reason: string }
  | { type: 'peace'; a: number; b: number }
  | { type: 'alliance'; a: number; b: number }
  | { type: 'alliance_broken'; a: number; b: number }
  | { type: 'proposal'; proposal: Proposal };

const key = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Chance a mission succeeds, from the diplomat's Diplomacia rating (1–5) and the current relation. */
export function missionChance(kind: MissionKind, rating: number, score: number): number {
  if (kind === 'gift') return 1;
  if (kind === 'alliance') return clamp(0.2 + 0.12 * rating + (score - ALLIANCE_MIN) / 100, 0.05, 0.95);
  return clamp(0.15 + 0.12 * rating + (score + 50) / 150, 0.05, 0.9);
}

/** Relation gained from a gift (better diplomats are more persuasive). */
export const giftValue = (rating: number) => 8 + rating * 3;

/**
 * Relations between every pair of villages: score, peace/alliance/war, pending AI proposals to the
 * player, and the daily AI decisions (drift, border friction, wars, peace, alliances).
 */
export class Diplomacy {
  rel: Record<string, Relation> = {};
  pending: Proposal[] = [];

  /** Random starting relations (-15..15, at peace) between all villages. */
  init(ids: number[], rng: Rng): void {
    for (let i = 0; i < ids.length; i++)
      for (let j = i + 1; j < ids.length; j++)
        this.rel[key(ids[i], ids[j])] = { score: Math.round(rng() * 30 - 15), status: 'peace' };
  }

  get(a: number, b: number): Relation {
    const k = key(a, b);
    this.rel[k] ??= { score: 0, status: 'peace' };
    return this.rel[k];
  }

  atWar(a: number, b: number): boolean {
    return a !== b && this.get(a, b).status === 'war';
  }

  allied(a: number, b: number): boolean {
    return a !== b && this.get(a, b).status === 'alliance';
  }

  adjust(a: number, b: number, delta: number): number {
    const r = this.get(a, b);
    r.score = clamp(r.score + delta, -100, 100);
    return r.score;
  }

  /**
   * `a` declares war on `b`. Each side's allies join in. Returns every war that started.
   * (Allies of both sides are not dragged into fighting each other.)
   */
  declareWar(a: number, b: number, ids: number[], reason: string): DiploEvent[] {
    const events: DiploEvent[] = [];
    const start = (x: number, y: number, why: string) => {
      if (x === y || this.atWar(x, y)) return;
      const r = this.get(x, y);
      r.status = 'war';
      r.score = Math.min(r.score, -50);
      events.push({ type: 'war', a: x, b: y, reason: why });
    };
    start(a, b, reason);
    for (const c of ids) {
      if (c === a || c === b) continue;
      if (this.allied(c, b) && !this.allied(c, a)) start(c, a, `aliança com a outra vila`);
      if (this.allied(c, a) && !this.allied(c, b)) start(c, b, `aliança com a outra vila`);
    }
    this.pending = this.pending.filter((p) => !(p.from === b && a === 0) && !(p.from === a && b === 0));
    return events;
  }

  makePeace(a: number, b: number): void {
    const r = this.get(a, b);
    r.status = 'peace';
    r.score = Math.max(r.score, -20);
  }

  makeAlliance(a: number, b: number): void {
    const r = this.get(a, b);
    r.status = 'alliance';
    r.score = Math.max(r.score, 50);
  }

  /** Removes a conquered village from every relation and proposal. */
  forget(id: number): void {
    for (const k of Object.keys(this.rel)) if (k.split(':').map(Number).includes(id)) delete this.rel[k];
    this.pending = this.pending.filter((p) => p.from !== id);
  }

  /** Accepts or refuses a pending proposal to the player. */
  answer(p: Proposal, accept: boolean): void {
    this.pending = this.pending.filter((x) => x !== p);
    if (!accept) {
      this.adjust(0, p.from, -10);
      return;
    }
    if (p.kind === 'alliance') this.makeAlliance(0, p.from);
    else this.makePeace(0, p.from);
  }

  /**
   * One day of diplomacy among living villages. `touching(a, b)` says if their borders meet.
   * Village 0 is the player: the AI never decides for it, only proposes.
   */
  daily(ids: number[], now: number, rng: Rng, touching: (a: number, b: number) => boolean): DiploEvent[] {
    const events: DiploEvent[] = [];
    this.pending = this.pending.filter((p) => p.expires > now);
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = ids[i];
        const b = ids[j];
        const r = this.get(a, b);
        // Time heals, except in war; shared borders cause friction.
        if (r.status !== 'war') r.score += r.score > 0 ? -1 : r.score < 0 ? 1 : 0;
        if (touching(a, b)) r.score -= 2;
        if (r.status === 'alliance') r.score += 1;
        r.score = clamp(r.score, -100, 100);

        const player = a === 0 ? 0 : b === 0 ? 0 : -1;
        const ai = player === 0 ? (a === 0 ? b : a) : -1;
        if (r.status === 'peace' && r.score <= -60 && rng() < 0.5) {
          events.push(...this.declareWar(player === 0 ? ai : a, player === 0 ? 0 : b, ids, 'relações péssimas'));
        } else if (r.status === 'war' && r.score >= -20 && rng() < 0.4) {
          if (player === 0) {
            if (!this.pending.some((p) => p.from === ai)) {
              const p: Proposal = { from: ai, kind: 'peace', expires: now + 480 };
              this.pending.push(p);
              events.push({ type: 'proposal', proposal: p });
            }
          } else {
            this.makePeace(a, b);
            events.push({ type: 'peace', a, b });
          }
        } else if (r.status === 'peace' && r.score >= 65 && rng() < 0.3) {
          if (player === 0) {
            if (!this.pending.some((p) => p.from === ai)) {
              const p: Proposal = { from: ai, kind: 'alliance', expires: now + 480 };
              this.pending.push(p);
              events.push({ type: 'proposal', proposal: p });
            }
          } else {
            this.makeAlliance(a, b);
            events.push({ type: 'alliance', a, b });
          }
        } else if (r.status === 'alliance' && r.score < 15) {
          r.status = 'peace';
          events.push({ type: 'alliance_broken', a, b });
        }
        // Wars slowly wind down.
        if (r.status === 'war') r.score = clamp(r.score + 2, -100, 100);
      }
    }
    return events;
  }

  snapshot(): { rel: Record<string, Relation>; pending: Proposal[] } {
    return { rel: structuredClone(this.rel), pending: structuredClone(this.pending) };
  }

  restore(s: { rel: Record<string, Relation>; pending: Proposal[] }): void {
    this.rel = structuredClone(s.rel);
    this.pending = structuredClone(s.pending);
  }
}
