import Phaser from 'phaser';
import { NPC_SPEED } from '../config';
import { BUILDING_DEFS, type Building } from '../game/buildings';
import { type NpcData, TIER_COLOR } from '../game/npcs';
import { npcSpriteKey } from '../gfx/textures';
import { gridToScreen } from '../iso';
import { inBounds, isWalkable, type WorldMap } from '../world/map';
import { findPath, type Tile } from '../world/path';

/**
 * A wanderer or villager on the map. Position is in grid space; movement follows A* paths
 * between tile centres. Idles, then strolls to a random spot near its anchor (where it spawned,
 * or its home once recruited).
 */
export class Npc {
  gx: number;
  gy: number;
  readonly sprite: Phaser.GameObjects.Sprite;
  private readonly shadow: Phaser.GameObjects.Image;
  private marker?: Phaser.GameObjects.Image;
  private path: Tile[] = [];
  private idle = 1 + Math.random() * 2;
  private anchor: Tile;
  private roam: number;
  private readonly key: string;
  /** Vertical bob offset for the marker, animated by a tween. */
  private readonly bob = { v: 0 };

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly map: WorldMap,
    readonly data: NpcData,
    tile: Tile,
  ) {
    this.gx = tile.x + 0.5;
    this.gy = tile.y + 0.5;
    this.anchor = { ...tile };
    this.roam = 4;
    this.key = npcSpriteKey(data.variant, data.gender);
    this.shadow = scene.add.image(0, 0, 'shadow').setAlpha(0.3);
    this.sprite = scene.add.sprite(0, 0, `${this.key}_idle`).setOrigin(0.5, 1);
    if (!scene.anims.exists(`${this.key}_walk`)) {
      scene.anims.create({
        key: `${this.key}_walk`,
        frames: [
          { key: `${this.key}_step_a` },
          { key: `${this.key}_idle` },
          { key: `${this.key}_step_b` },
          { key: `${this.key}_idle` },
        ],
        frameRate: 7,
        repeat: -1,
      });
    }
    if (data.role === 'wanderer') {
      this.marker = scene.add
        .image(0, 0, 'marker')
        .setOrigin(0.5, 1)
        .setTint(Phaser.Display.Color.HexStringToColor(TIER_COLOR[data.tier]).color);
      scene.tweens.add({ targets: this.bob, v: -2, duration: 500, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }
    this.sync();
  }

  get tile(): Tile {
    return { x: Math.floor(this.gx), y: Math.floor(this.gy) };
  }

  /** `frozen`: stand still (e.g. while talking to the player), facing `faceX` if given. */
  update(dt: number, frozen: boolean, faceX?: number): void {
    if (frozen) {
      this.stopWalking();
      if (faceX !== undefined) this.sprite.setFlipX(faceX < this.sprite.x);
      this.sync();
      return;
    }

    if (this.path.length === 0) {
      this.stopWalking();
      this.idle -= dt;
      if (this.idle <= 0) {
        this.idle = 1.5 + Math.random() * 3.5;
        this.path = this.planStroll() ?? [];
      }
    } else {
      this.walk(dt);
    }
    this.sync();
  }

  /** Recruited: drop the marker and walk home; from now on stroll around the house. */
  becomeVillager(home: Building): void {
    this.scene.tweens.killTweensOf(this.bob);
    this.marker?.destroy();
    this.marker = undefined;
    const s = BUILDING_DEFS[home.type].size;
    const inside = (x: number, y: number) => x >= home.tx && x < home.tx + s && y >= home.ty && y < home.ty + s;
    const nextTo = (x: number, y: number) =>
      !inside(x, y) && isWalkable(this.map, x, y) && x >= home.tx - 1 && x <= home.tx + s && y >= home.ty - 1 && y <= home.ty + s;
    const toward = { x: home.tx + s / 2, y: home.ty + s };
    const path = findPath(this.map, this.tile, nextTo, toward, 8000);
    this.path = path ?? [];
    const end = path && path.length > 0 ? path[path.length - 1] : this.tile;
    this.anchor = end;
    this.roam = 3;
    this.idle = 0.5;
  }

  /** Fades out and removes the NPC. */
  leave(onDone: () => void): void {
    const targets = [this.sprite, this.shadow, ...(this.marker ? [this.marker] : [])];
    this.scene.tweens.add({
      targets,
      alpha: 0,
      duration: 800,
      onComplete: () => {
        for (const t of targets) t.destroy();
        onDone();
      },
    });
  }

  private planStroll(): Tile[] | null {
    for (let tries = 0; tries < 8; tries++) {
      const x = this.anchor.x + Math.round((Math.random() * 2 - 1) * this.roam);
      const y = this.anchor.y + Math.round((Math.random() * 2 - 1) * this.roam);
      if (!inBounds(this.map, x, y) || !isWalkable(this.map, x, y)) continue;
      const p = findPath(this.map, this.tile, (px, py) => px === x && py === y, { x, y }, 600);
      if (p) return p;
    }
    return null;
  }

  private walk(dt: number): void {
    let budget = NPC_SPEED * dt;
    while (budget > 0 && this.path.length > 0) {
      const next = this.path[0];
      if (!isWalkable(this.map, next.x, next.y)) {
        this.path = []; // something grew or was built in the way; re-plan after a short idle
        this.idle = 0.3;
        return;
      }
      const tx = next.x + 0.5;
      const ty = next.y + 0.5;
      const dx = tx - this.gx;
      const dy = ty - this.gy;
      const d = Math.hypot(dx, dy);
      if (d <= budget) {
        this.gx = tx;
        this.gy = ty;
        budget -= d;
        this.path.shift();
      } else {
        this.gx += (dx / d) * budget;
        this.gy += (dy / d) * budget;
        budget = 0;
      }
      const screenDx = dx - dy;
      if (Math.abs(screenDx) > 0.01) this.sprite.setFlipX(screenDx < 0);
    }
    this.sprite.anims.play(`${this.key}_walk`, true);
  }

  private stopWalking(): void {
    if (this.sprite.anims.isPlaying) {
      this.sprite.anims.stop();
      this.sprite.setTexture(`${this.key}_idle`);
    }
  }

  private sync(): void {
    const s = gridToScreen(this.gx, this.gy);
    this.sprite.setPosition(s.x, s.y).setDepth(s.y);
    this.shadow.setPosition(s.x, s.y).setDepth(s.y - 0.5);
    this.marker?.setPosition(s.x, Math.round(s.y - 19 + this.bob.v)).setDepth(s.y + 0.1);
  }
}
