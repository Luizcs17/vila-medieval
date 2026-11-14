import Phaser from 'phaser';
import { NPC_SPEED, WORKER_LOAD, WORKER_TIME_FACTOR } from '../config';
import { BUILDING_DEFS, type Building, type Buildings } from '../game/buildings';
import { NODE_DEFS } from '../game/gathering';
import type { Resource } from '../game/inventory';
import { type NpcData, productivity, TIER_COLOR } from '../game/npcs';
import { npcSpriteKey } from '../gfx/textures';
import { gridToScreen } from '../iso';
import { inBounds, isWalkable, tileIndex, type WorldMap } from '../world/map';
import { findPath, type Tile } from '../world/path';

/** What an NPC needs from the world to live and work. Implemented by WorldScene. */
export interface NpcWorld {
  map: WorldMap;
  buildings: Buildings;
  isNight(): boolean;
  /** Takes one unit from the node on tile `i` (updating sprites). Null if nothing is there any more. */
  harvest(i: number): Resource | null;
  /** Adds resources to the central stockpile. */
  deposit(resource: Resource, n: number): void;
}

type State = 'idle' | 'toNode' | 'working' | 'toDeposit';

/** Footprint rectangle helpers. */
const footprintOf = (b: Building) => ({ x: b.tx, y: b.ty, s: BUILDING_DEFS[b.type].size });

/**
 * A wanderer or villager on the map. Position is in grid space; movement follows A* paths
 * between tile centres. Unemployed villagers and wanderers stroll around an anchor. Employed
 * villagers loop: walk to a resource node near their workplace → work it → carry the load to the
 * nearest deposit building → repeat. Everyone heads home at night.
 */
export class Npc {
  gx: number;
  gy: number;
  readonly sprite: Phaser.GameObjects.Sprite;
  /** Why an employed villager is not working, for the UI (null when fine). */
  status: string | null = null;
  private readonly shadow: Phaser.GameObjects.Image;
  private marker?: Phaser.GameObjects.Image;
  private carryIcon?: Phaser.GameObjects.Image;
  private path: Tile[] = [];
  private idle = 1 + Math.random() * 2;
  private anchor: Tile;
  private roam = 4;
  private state: State = 'idle';
  private node: number | null = null;
  private workTimer = 0;
  private workAnim = 0;
  private carrying: { resource: Resource; n: number } | null = null;
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

  /**
   * `dt` is game time. `frozen`: stand still (e.g. while talking to the player), facing `faceX` if given.
   */
  update(dt: number, world: NpcWorld, frozen: boolean, faceX?: number): void {
    if (frozen) {
      this.stopWalking();
      if (faceX !== undefined) this.sprite.setFlipX(faceX < this.sprite.x);
      this.sync();
      return;
    }

    const workplace = this.workplace(world);
    if (workplace && !world.isNight()) this.work(dt, world, workplace);
    else this.live(dt, world);
    this.sync();
  }

  /** Recruited: drop the marker and walk home; from now on live around the house. */
  becomeVillager(home: Building): void {
    this.scene.tweens.killTweensOf(this.bob);
    this.marker?.destroy();
    this.marker = undefined;
    this.goNextTo(home, 8000);
    this.anchor = this.path.at(-1) ?? this.tile;
    this.roam = 3;
    this.idle = 0.5;
  }

  /** Fades out and removes the NPC. */
  leave(onDone: () => void): void {
    const targets = [
      this.sprite,
      this.shadow,
      ...(this.marker ? [this.marker] : []),
      ...(this.carryIcon ? [this.carryIcon] : []),
    ];
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

  // ---------- behaviours ----------

  private workplace(world: NpcWorld): Building | undefined {
    if (this.data.jobId === null) return undefined;
    return world.buildings.list.find((b) => b.id === this.data.jobId);
  }

  private home(world: NpcWorld): Building | undefined {
    if (this.data.homeId === null) return undefined;
    return world.buildings.list.find((b) => b.id === this.data.homeId);
  }

  /** Off duty: stroll around the anchor; at night go home and stay close. */
  private live(dt: number, world: NpcWorld): void {
    this.status = null;
    if (this.state !== 'idle') {
      // Interrupted work (night or fired): drop the task, keep any carried load for tomorrow.
      this.state = 'idle';
      this.path = [];
      this.node = null;
    }
    const home = this.home(world);
    const night = world.isNight();
    if (home && night && this.path.length === 0 && !this.isNextTo(home)) {
      this.goNextTo(home, 4000);
      this.idle = 2;
    }
    if (this.path.length > 0) {
      this.walk(dt);
      return;
    }
    this.stopWalking();
    this.idle -= dt;
    if (this.idle <= 0) {
      this.idle = 1.5 + Math.random() * 3.5;
      if (!night) this.path = this.planStroll() ?? [];
    }
  }

  private work(dt: number, world: NpcWorld, workplace: Building): void {
    const job = BUILDING_DEFS[workplace.type].job!;
    if (job.nodes.length === 0) {
      // Hunters need animals (next milestone); wait at the workplace.
      this.status = 'Esperando animais para caçar';
      this.live(dt, world);
      return;
    }

    if (this.state === 'idle') {
      // Fill up to a full load (moving on to the next node if one runs out), then deliver.
      const load = this.carrying?.n ?? 0;
      if (load >= WORKER_LOAD) this.startDeposit(world);
      else {
        this.startNode(world, workplace);
        if (this.state === 'idle' && load > 0) this.startDeposit(world);
      }
      if (this.state === 'idle') {
        this.stopWalking();
        return;
      }
    }

    if (this.path.length > 0) {
      this.walk(dt);
      return;
    }

    if (this.state === 'toNode') {
      if (this.node === null || !job.nodes.includes(world.map.objects[this.node])) {
        this.state = 'idle'; // someone else finished it
        return;
      }
      this.state = 'working';
      this.workTimer = 0;
    }

    if (this.state === 'working') {
      const obj = this.node !== null ? world.map.objects[this.node] : undefined;
      const def = obj !== undefined ? NODE_DEFS[obj] : undefined;
      if (this.node === null || !def || !job.nodes.includes(obj!)) {
        this.state = 'idle';
        return;
      }
      this.faceTile(this.node);
      this.animateWork(dt);
      this.workTimer += dt * productivity(this.data, job.skill);
      if (this.workTimer >= def.secondsPerUnit * WORKER_TIME_FACTOR) {
        this.workTimer = 0;
        const got = world.harvest(this.node);
        if (got) {
          if (this.carrying && this.carrying.resource !== got) this.carrying = null; // shouldn't happen: one job, one resource
          this.carrying = { resource: got, n: (this.carrying?.n ?? 0) + 1 };
          this.updateCarryIcon();
        }
        if (!got || (this.carrying && this.carrying.n >= WORKER_LOAD)) this.state = 'idle';
      }
      return;
    }

    if (this.state === 'toDeposit') {
      if (this.carrying) world.deposit(this.carrying.resource, this.carrying.n);
      this.carrying = null;
      this.updateCarryIcon();
      this.state = 'idle';
    }
  }

  private startNode(world: NpcWorld, workplace: Building): void {
    const job = BUILDING_DEFS[workplace.type].job!;
    const f = footprintOf(workplace);
    const cx = f.x + f.s / 2;
    const cy = f.y + f.s / 2;
    // Candidate nodes near the workplace, nearest to the worker first.
    const candidates: { i: number; d: number }[] = [];
    const r = job.radius;
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        if (!inBounds(world.map, x, y) || Math.hypot(x + 0.5 - cx, y + 0.5 - cy) > r) continue;
        const i = tileIndex(world.map, x, y);
        if (job.nodes.includes(world.map.objects[i])) candidates.push({ i, d: Math.hypot(x + 0.5 - this.gx, y + 0.5 - this.gy) });
      }
    }
    candidates.sort((a, b) => a.d - b.d);
    for (const c of candidates.slice(0, 6)) {
      const nx = c.i % world.map.w;
      const ny = Math.floor(c.i / world.map.w);
      const adjacent = (x: number, y: number) => Math.max(Math.abs(x - nx), Math.abs(y - ny)) === 1;
      const p = findPath(world.map, this.tile, adjacent, { x: nx, y: ny }, 3000);
      if (p) {
        this.path = p;
        this.node = c.i;
        this.state = 'toNode';
        this.status = null;
        return;
      }
    }
    this.status = candidates.length === 0 ? 'Sem recursos por perto' : 'Não consegue chegar aos recursos';
    this.idle = 3;
  }

  private startDeposit(world: NpcWorld): void {
    const deposits = world.buildings.list
      .filter((b) => b.built && BUILDING_DEFS[b.type].deposit)
      .sort((a, b) => Math.hypot(a.tx - this.gx, a.ty - this.gy) - Math.hypot(b.tx - this.gx, b.ty - this.gy));
    for (const d of deposits) {
      if (this.goNextTo(d, 6000)) {
        this.state = 'toDeposit';
        return;
      }
    }
    this.status = 'Não consegue chegar ao estoque';
  }

  // ---------- movement ----------

  private isNextTo(b: Building): boolean {
    const f = footprintOf(b);
    const t = this.tile;
    return t.x >= f.x - 1 && t.x <= f.x + f.s && t.y >= f.y - 1 && t.y <= f.y + f.s;
  }

  /** Plans a path to a walkable tile touching building `b`. Returns false if unreachable. */
  private goNextTo(b: Building, budget: number): boolean {
    const f = footprintOf(b);
    const inside = (x: number, y: number) => x >= f.x && x < f.x + f.s && y >= f.y && y < f.y + f.s;
    const nextTo = (x: number, y: number) =>
      !inside(x, y) && isWalkable(this.map, x, y) && x >= f.x - 1 && x <= f.x + f.s && y >= f.y - 1 && y <= f.y + f.s;
    const p = findPath(this.map, this.tile, nextTo, { x: f.x + f.s / 2, y: f.y + f.s }, budget);
    this.path = p ?? [];
    return p !== null;
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
        this.path = []; // something grew or was built in the way; re-plan
        this.idle = 0.3;
        if (this.state !== 'working') this.state = 'idle';
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

  private faceTile(i: number): void {
    const x = (i % this.map.w) + 0.5;
    const y = Math.floor(i / this.map.w) + 0.5;
    this.sprite.setFlipX(x - y < this.gx - this.gy);
  }

  /** Alternates two frames while chopping/mining. */
  private animateWork(dt: number): void {
    this.sprite.anims.stop();
    this.workAnim += dt;
    this.sprite.setTexture(Math.floor(this.workAnim * 3) % 2 === 0 ? `${this.key}_idle` : `${this.key}_step_a`);
  }

  private updateCarryIcon(): void {
    if (!this.carrying) {
      this.carryIcon?.destroy();
      this.carryIcon = undefined;
      return;
    }
    if (!this.carryIcon) this.carryIcon = this.scene.add.image(0, 0, `icon_${this.carrying.resource}`).setOrigin(0.5, 1);
    else this.carryIcon.setTexture(`icon_${this.carrying.resource}`);
  }

  private sync(): void {
    const s = gridToScreen(this.gx, this.gy);
    this.sprite.setPosition(s.x, s.y).setDepth(s.y);
    this.shadow.setPosition(s.x, s.y).setDepth(s.y - 0.5);
    this.marker?.setPosition(s.x, Math.round(s.y - 19 + this.bob.v)).setDepth(s.y + 0.1);
    this.carryIcon?.setPosition(s.x, s.y - 17).setDepth(s.y + 0.1);
  }
}
