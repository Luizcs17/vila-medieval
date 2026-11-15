import type Phaser from 'phaser';
import { PLAYER_RADIUS, PLAYER_RUN_MULTIPLIER, PLAYER_SPEED, ROAD_SPEED } from '../config';
import { gridToScreen, screenDirToGrid } from '../iso';
import { isRoad, isWalkable, type WorldMap } from '../world/map';

export interface MoveInput {
  /** Screen-space direction: x right, y down. Each in {-1, 0, 1}. */
  x: number;
  y: number;
  run: boolean;
}

/** The protagonist. Position is in grid space (tile units); the sprite follows it in screen space. */
export class Player {
  gx: number;
  gy: number;
  readonly sprite: Phaser.GameObjects.Sprite;
  private readonly shadow: Phaser.GameObjects.Image;

  constructor(
    scene: Phaser.Scene,
    private readonly map: WorldMap,
    gx: number,
    gy: number,
  ) {
    this.gx = gx;
    this.gy = gy;
    this.shadow = scene.add.image(0, 0, 'shadow').setAlpha(0.3);
    this.sprite = scene.add.sprite(0, 0, 'player_idle').setOrigin(0.5, 1);

    if (!scene.anims.exists('player_walk')) {
      scene.anims.create({
        key: 'player_walk',
        frames: [{ key: 'player_step_a' }, { key: 'player_idle' }, { key: 'player_step_b' }, { key: 'player_idle' }],
        frameRate: 8,
        repeat: -1,
      });
    }
    this.syncSprite();
  }

  update(dtSeconds: number, input: MoveInput): void {
    const dir = screenDirToGrid(input.x, input.y);
    const moving = dir.x !== 0 || dir.y !== 0;

    if (moving) {
      const road = isRoad(this.map, Math.floor(this.gx), Math.floor(this.gy)) ? ROAD_SPEED : 1;
      const speed = PLAYER_SPEED * road * (input.run ? PLAYER_RUN_MULTIPLIER : 1) * dtSeconds;
      // Move each axis separately so the player slides along obstacles instead of sticking.
      const nx = this.gx + dir.x * speed;
      if (!this.blocked(nx, this.gy)) this.gx = nx;
      const ny = this.gy + dir.y * speed;
      if (!this.blocked(this.gx, ny)) this.gy = ny;

      if (input.x !== 0) this.sprite.setFlipX(input.x < 0);
      this.sprite.anims.play('player_walk', true);
      this.sprite.anims.timeScale = input.run ? 1.6 : 1;
    } else if (this.sprite.anims.isPlaying) {
      this.sprite.anims.stop();
      this.sprite.setTexture('player_idle');
    }

    this.syncSprite();
  }

  /** Turns the sprite toward a screen-space x coordinate. */
  face(screenX: number): void {
    this.sprite.setFlipX(screenX < this.sprite.x);
  }

  /** Tile the player's feet are on. */
  get tile(): { x: number; y: number } {
    return { x: Math.floor(this.gx), y: Math.floor(this.gy) };
  }

  private blocked(gx: number, gy: number): boolean {
    const r = PLAYER_RADIUS;
    for (const [ox, oy] of [
      [-r, -r],
      [r, -r],
      [-r, r],
      [r, r],
    ]) {
      if (!isWalkable(this.map, Math.floor(gx + ox), Math.floor(gy + oy))) return true;
    }
    return false;
  }

  private syncSprite(): void {
    const s = gridToScreen(this.gx, this.gy);
    this.sprite.setPosition(s.x, s.y);
    this.sprite.setDepth(s.y);
    this.shadow.setPosition(s.x, s.y);
    this.shadow.setDepth(s.y - 0.5);
  }
}
