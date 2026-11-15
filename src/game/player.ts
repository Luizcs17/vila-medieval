import {
  DAY_SECONDS,
  MAX_CARRY_WEIGHT,
  PLAYER_HUNGER_PER_DAY,
  PLAYER_MAX_HP,
  PLAYER_MEAL,
  PLAYER_REGEN_DELAY,
  PLAYER_REGEN_EVERY,
  PLAYER_STARVE_EVERY,
} from '../config';

/** Satiety at or below this shows as hungry (and eating with F is always allowed). */
export const PLAYER_HUNGRY = 30;
export type PlayerSnapshot = { hp: number; maxHp: number; level: number; xp: number; food?: number };

/** XP needed to go from `level` to `level + 1`. */
export const xpToNext = (level: number) => 20 + 15 * (level - 1);

/** What each level above 1 gives. */
export const PER_LEVEL = { hp: 1, carry: 3, gather: 0.05 };
export const MAX_LEVEL = 15;

/** XP rewards. */
export const XP = { gather: 1, build: 10, recruit: 15, craft: 5, killPerHp: 2 };

/** The protagonist's vital stats and progression. Serializable. */
export class PlayerStats {
  hp = PLAYER_MAX_HP;
  maxHp = PLAYER_MAX_HP;
  level = 1;
  /** XP towards the next level. */
  xp = 0;
  /** Game seconds since the last hit (regen starts after PLAYER_REGEN_DELAY). */
  sinceHit = Infinity;
  /** Satiety 0–100. At zero there's no regeneration and HP drains. */
  food = 100;
  private regen = 0;
  private starve = 0;

  /** Returns true if this hit knocked the player out. */
  hurt(damage: number): boolean {
    this.hp = Math.max(0, this.hp - damage);
    this.sinceHit = 0;
    this.regen = 0;
    return this.hp === 0;
  }

  /** Extra kg the player can carry thanks to their level. */
  get carryWeight(): number {
    return MAX_CARRY_WEIGHT + PER_LEVEL.carry * (this.level - 1);
  }

  /** Gathering speed multiplier from level (before tools). */
  get gatherSpeed(): number {
    return 1 + PER_LEVEL.gather * (this.level - 1);
  }

  /** Adds XP. Returns how many levels were gained (each raises max HP and heals that much). */
  addXp(amount: number): number {
    let gained = 0;
    this.xp += amount;
    while (this.level < MAX_LEVEL && this.xp >= xpToNext(this.level)) {
      this.xp -= xpToNext(this.level);
      this.level += 1;
      this.maxHp += PER_LEVEL.hp;
      this.hp += PER_LEVEL.hp;
      gained++;
    }
    if (this.level >= MAX_LEVEL) this.xp = 0;
    return gained;
  }

  snapshot(): PlayerSnapshot {
    return { hp: this.hp, maxHp: this.maxHp, level: this.level, xp: this.xp, food: this.food };
  }

  restore(s: PlayerSnapshot): void {
    this.hp = s.hp;
    this.maxHp = s.maxHp;
    this.level = s.level;
    this.xp = s.xp;
    this.food = s.food ?? 100;
  }

  get hungry(): boolean {
    return this.food <= PLAYER_HUNGRY;
  }

  get starving(): boolean {
    return this.food <= 0;
  }

  /** Worth eating now: hungry-ish, or hurt. */
  wantsFood(): boolean {
    return this.food <= 100 - PLAYER_MEAL || this.hp < this.maxHp;
  }

  /** Eats one meal: satiety back and `heal` HP. */
  eat(heal: number): void {
    this.food = Math.min(100, this.food + PLAYER_MEAL);
    this.heal(heal);
  }

  heal(amount: number): void {
    this.hp = Math.min(this.maxHp, this.hp + amount);
  }

  /**
   * Advances hunger and regeneration by `dt` game seconds. Returns HP lost to starvation this step
   * (the caller knocks the player out if HP reaches zero).
   */
  update(dt: number): number {
    this.sinceHit += dt;
    this.food = Math.max(0, this.food - (PLAYER_HUNGER_PER_DAY / DAY_SECONDS) * dt);
    if (this.starving) {
      this.regen = 0;
      this.starve += dt;
      let lost = 0;
      while (this.starve >= PLAYER_STARVE_EVERY && this.hp > 0) {
        this.starve -= PLAYER_STARVE_EVERY;
        this.hp -= 1;
        lost++;
      }
      return lost;
    }
    this.starve = 0;
    if (this.sinceHit < PLAYER_REGEN_DELAY || this.hp >= this.maxHp) return 0;
    this.regen += dt;
    while (this.regen >= PLAYER_REGEN_EVERY && this.hp < this.maxHp) {
      this.regen -= PLAYER_REGEN_EVERY;
      this.hp += 1;
    }
    return 0;
  }
}

/**
 * Whether a target at offset (tx, ty) from the player lies in the swing aimed along (ax, ay).
 * Both in the same space (screen pixels). Targets right next to the player always count.
 */
export function inAimCone(ax: number, ay: number, tx: number, ty: number, close = 8, minCos = 0.35): boolean {
  const t = Math.hypot(tx, ty);
  if (t <= close) return true;
  const a = Math.hypot(ax, ay);
  if (a === 0) return true;
  return (ax * tx + ay * ty) / (a * t) >= minCos;
}
