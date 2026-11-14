import type Phaser from 'phaser';
import { type AnimalData, hurtAnimal, SPECIES } from '../game/animals';
import { gridToScreen } from '../iso';
import { isWalkable, type WorldMap } from '../world/map';

/** Someone animals react to: the player or a villager. */
export interface Human {
  kind: 'player' | 'npc';
  id: number;
  gx: number;
  gy: number;
}

export interface AnimalWorld {
  map: WorldMap;
  isNight(): boolean;
  /** Game clock, for carcass timestamps. */
  now(): number;
  humans(): Human[];
  /** An animal's attack lands on `target`. */
  hit(target: Human, damage: number, from: Animal): void;
}

type Mode = 'wander' | 'flee' | 'chase' | 'return';

const RADIUS = 0.2;
const LEASH = 12;

/**
 * An animal on the map. Moves in straight lines with sliding collision (no pathfinding):
 * wanders around its home, skittish ones flee from people, aggressive ones chase and bite,
 * defensive ones fight back when hurt. When killed it stays as a carcass with meat on it.
 */
export class Animal {
  readonly sprite: Phaser.GameObjects.Sprite;
  private readonly shadow: Phaser.GameObjects.Image;
  private mode: Mode = 'wander';
  private dir = { x: 0, y: 0 };
  private timer = Math.random() * 2;
  private attackCd = 0;
  private target: Human | null = null;
  /** Who hurt us last, and for how much longer we care. */
  private provokedBy: Human | null = null;
  private provokedFor = 0;
  private hurtFor = 0;
  private readonly key: string;

  constructor(
    private readonly scene: Phaser.Scene,
    readonly data: AnimalData,
  ) {
    this.key = `animal_${data.species}`;
    this.shadow = scene.add.image(0, 0, 'shadow').setAlpha(0.25);
    this.sprite = scene.add.sprite(0, 0, `${this.key}_a`).setOrigin(0.5, 1);
    if (!scene.anims.exists(`${this.key}_walk`)) {
      scene.anims.create({
        key: `${this.key}_walk`,
        frames: [{ key: `${this.key}_a` }, { key: `${this.key}_b` }],
        frameRate: 6,
        repeat: -1,
      });
    }
    if (data.dead) this.showCarcass();
    this.sync();
  }

  get def() {
    return SPECIES[this.data.species];
  }

  get alive(): boolean {
    return !this.data.dead;
  }

  /** True while chasing someone (used to make villagers run). */
  get hunting(): boolean {
    return this.alive && this.mode === 'chase';
  }

  update(dt: number, world: AnimalWorld): void {
    if (this.data.dead) return;
    this.attackCd -= dt;
    this.provokedFor -= dt;
    this.hurtFor -= dt;
    const def = this.def;
    const humans = world.humans();
    const nearest = this.nearest(humans);
    const d = nearest ? Math.hypot(nearest.gx - this.data.gx, nearest.gy - this.data.gy) : Infinity;
    const fromHome = Math.hypot(this.data.homeX - this.data.gx, this.data.homeY - this.data.gy);

    // Decide what to do.
    if (this.mode === 'return' && fromHome > 2) {
      // keep returning
    } else if (def.temper === 'skittish' && nearest && (d < def.fleeRange || this.hurtFor > 0)) {
      this.mode = 'flee';
      this.target = nearest;
    } else if (def.temper === 'defensive' && this.provokedBy && this.provokedFor > 0) {
      this.mode = 'chase';
      this.target = humans.find((h) => h.kind === this.provokedBy!.kind && h.id === this.provokedBy!.id) ?? null;
    } else if (def.temper === 'aggressive' && nearest && d < def.aggroRange * (world.isNight() ? 1.4 : 1)) {
      this.mode = 'chase';
      this.target = nearest;
    } else if (this.mode !== 'wander') {
      this.mode = 'wander';
      this.target = null;
      this.timer = 0;
    }
    if (this.mode === 'chase' && fromHome > LEASH) {
      this.mode = 'return'; // too far from home: give up and go back
      this.target = null;
      this.provokedFor = 0;
    }

    // Act.
    let speed = def.speed;
    if (this.mode === 'wander') {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.timer = 1.5 + Math.random() * 3;
        if (fromHome > 6 || Math.random() < 0.35)
          this.dir = fromHome > 6 ? this.toward(this.data.homeX, this.data.homeY) : { x: 0, y: 0 };
        else {
          const a = Math.random() * Math.PI * 2;
          this.dir = { x: Math.cos(a), y: Math.sin(a) };
        }
      }
    } else if (this.mode === 'return') {
      speed = def.speed * 1.5;
      this.dir = this.toward(this.data.homeX, this.data.homeY);
      if (fromHome <= 2) this.mode = 'wander';
    } else if (this.target) {
      speed = def.runSpeed;
      const toward = this.toward(this.target.gx, this.target.gy);
      if (this.mode === 'flee') this.dir = { x: -toward.x, y: -toward.y };
      else {
        const dist = Math.hypot(this.target.gx - this.data.gx, this.target.gy - this.data.gy);
        this.dir = dist > 0.7 ? toward : { x: 0, y: 0 };
        if (dist <= 0.9 && this.attackCd <= 0) {
          this.attackCd = def.attackCooldown;
          world.hit(this.target, def.damage, this);
          this.scene.tweens.add({ targets: this.sprite, scaleX: 1.15, scaleY: 0.9, duration: 80, yoyo: true });
        }
      }
    }

    this.move(world.map, this.dir.x * speed * dt, this.dir.y * speed * dt);
    this.sync();
  }

  /** Takes a hit from `from`. Returns true if it died. */
  damage(amount: number, from: Human, now: number): boolean {
    if (this.data.dead) return false;
    const killed = hurtAnimal(this.data, amount, now);
    this.provokedBy = from;
    this.provokedFor = 10;
    this.hurtFor = 4;
    this.sprite.setTintFill(0xffffff);
    this.scene.time.delayedCall(90, () => {
      if (!this.data.dead) this.sprite.clearTint();
    });
    if (killed) this.showCarcass();
    return killed;
  }

  destroy(): void {
    this.sprite.destroy();
    this.shadow.destroy();
  }

  private showCarcass(): void {
    this.sprite.anims.stop();
    this.sprite.setTexture(`${this.key}_a`).setFlipY(true).clearTint().setTint(0x9a8a80);
    this.sprite.setOrigin(0.5, 0.6);
    this.sync();
  }

  private nearest(humans: Human[]): Human | null {
    let best: Human | null = null;
    let bestD = Infinity;
    for (const h of humans) {
      const d = Math.hypot(h.gx - this.data.gx, h.gy - this.data.gy);
      if (d < bestD) {
        bestD = d;
        best = h;
      }
    }
    return best;
  }

  private toward(x: number, y: number): { x: number; y: number } {
    const dx = x - this.data.gx;
    const dy = y - this.data.gy;
    const len = Math.hypot(dx, dy) || 1;
    return { x: dx / len, y: dy / len };
  }

  private blocked(map: WorldMap, gx: number, gy: number): boolean {
    for (const [ox, oy] of [
      [-RADIUS, -RADIUS],
      [RADIUS, -RADIUS],
      [-RADIUS, RADIUS],
      [RADIUS, RADIUS],
    ]) {
      if (!isWalkable(map, Math.floor(gx + ox), Math.floor(gy + oy))) return true;
    }
    return false;
  }

  private move(map: WorldMap, dx: number, dy: number): void {
    const moving = dx !== 0 || dy !== 0;
    let moved = false;
    if (dx !== 0 && !this.blocked(map, this.data.gx + dx, this.data.gy)) {
      this.data.gx += dx;
      moved = true;
    }
    if (dy !== 0 && !this.blocked(map, this.data.gx, this.data.gy + dy)) {
      this.data.gy += dy;
      moved = true;
    }
    if (moving && !moved) this.timer = 0; // stuck: pick a new direction soon
    const screenDx = dx - dy;
    if (Math.abs(screenDx) > 1e-4) this.sprite.setFlipX(screenDx < 0);
    if (moved) this.sprite.anims.play(`${this.key}_walk`, true);
    else if (this.sprite.anims.isPlaying) {
      this.sprite.anims.stop();
      this.sprite.setTexture(`${this.key}_a`);
    }
  }

  private sync(): void {
    const s = gridToScreen(this.data.gx, this.data.gy);
    this.sprite.setPosition(s.x, s.y).setDepth(this.data.dead ? s.y - 1 : s.y);
    this.shadow
      .setPosition(s.x, s.y)
      .setDepth(s.y - 1.5)
      .setVisible(!this.data.dead);
  }
}
