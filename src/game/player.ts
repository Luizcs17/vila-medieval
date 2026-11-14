import { MAX_CARRY_WEIGHT, PLAYER_MAX_HP, PLAYER_REGEN_DELAY, PLAYER_REGEN_EVERY } from '../config';

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
  private regen = 0;

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

  heal(amount: number): void {
    this.hp = Math.min(this.maxHp, this.hp + amount);
  }

  /** Advances regeneration by `dt` game seconds. */
  update(dt: number): void {
    this.sinceHit += dt;
    if (this.sinceHit < PLAYER_REGEN_DELAY || this.hp >= this.maxHp) return;
    this.regen += dt;
    while (this.regen >= PLAYER_REGEN_EVERY && this.hp < this.maxHp) {
      this.regen -= PLAYER_REGEN_EVERY;
      this.hp += 1;
    }
  }
}
