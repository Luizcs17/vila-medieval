import { PLAYER_MAX_HP, PLAYER_REGEN_DELAY, PLAYER_REGEN_EVERY } from '../config';

/** The protagonist's vital stats. Serializable. */
export class PlayerStats {
  hp = PLAYER_MAX_HP;
  maxHp = PLAYER_MAX_HP;
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
