import Phaser from 'phaser';
import { HUNTER_DAMAGE, HUNTER_RANGE, NPC_SPEED, ROAD_SPEED, WORKER_LOAD, WORKER_TIME_FACTOR } from '../config';
import { BUILDING_DEFS, type Building, type Buildings } from '../game/buildings';
import type { FarmTask } from '../game/farms';
import { NODE_DEFS } from '../game/gathering';
import { toolSpeed } from '../game/gear';
import type { Resource } from '../game/inventory';
import type { ToolId } from '../game/items';
import { isStarving } from '../game/needs';
import { type NpcData, productivity, soldierDamage, TIER_COLOR } from '../game/npcs';
import { engagement, pickFidgetTile, stanceOf } from '../game/orders';
import { ensurePersonTextures } from '../gfx/people';
import { gridToScreen } from '../iso';
import { inBounds, isRoad, isWalkable, tileIndex, type WorldMap } from '../world/map';
import { findPath, type Tile } from '../world/path';

/** What an NPC needs from the world to live and work. Implemented by WorldScene. */
export interface NpcWorld {
  map: WorldMap;
  buildings: Buildings;
  isNight(): boolean;
  /** Takes one unit from the node on tile `i` (updating sprites). Null if nothing is there any more. */
  harvest(i: number): Resource | null;
  /** Adds resources to `faction`'s stockpile. */
  deposit(faction: number, resource: Resource, n: number): void;
  /** Position of an aggressive animal hunting near (gx, gy), if any. */
  threat(gx: number, gy: number): { x: number; y: number } | null;
  /** Nearest live prey (skittish animal) within `r` tiles of (cx, cy). */
  findPrey(cx: number, cy: number, r: number, faction: number): Prey | null;
  prey(id: number): Prey | null;
  /** A hunter's shot hits prey `id`. Returns true if it died. */
  shoot(from: Npc, id: number, damage: number): boolean;
  /** Nearest carcass with meat within `r` tiles of (cx, cy). */
  findCarcass(cx: number, cy: number, r: number, faction: number): Prey | null;
  takeMeat(id: number, max: number, faction?: number): number;
  /** The tool this worker uses from its workplace's inventory ('none' if the job needs none, null if missing). */
  toolFor(npc: Npc): ToolId | null | 'none';
  /** One use of the worker's tool (it may wear out). */
  useTool(npc: Npc, tool: ToolId): void;
  /** Is this smithy forging right now (queue and materials)? */
  smithyBusy(b: Building): boolean;
  /** Nearest thing hostile to `faction` within `r` tiles (aggressive animals, enemies at war; any animal with `anyAnimal`). */
  findHostile(faction: number, gx: number, gy: number, r: number, anyAnimal?: boolean): Target | null;
  /** A soldier's blow lands on `target`. */
  strike(from: Npc, target: Target, damage: number): void;
  atWar(a: number, b: number): boolean;
  /** Nearest building of village `target` for a raiding soldier, or null. */
  raidTarget(npc: Npc, target: number): Building | null;
  attackBuilding(npc: Npc, b: Building, damage: number): void;
  /** Diplomatic mission of this diplomat, if any. */
  mission(id: number): { phase: 'going' | 'talking' | 'returning'; target: number; kind: string } | null;
  /** Where a diplomat on a mission is heading (null: the goal is gone). */
  missionPoint(id: number): { x: number; y: number } | null;
  missionArrived(id: number): void;
  missionDone(id: number): void;
  missionFailed(id: number): void;
  factionCenter(faction: number): { x: number; y: number };
  /** Where the player is (companions follow them). */
  playerAt(): { x: number; y: number };
  /** May people of `faction` take resources on tile (x, y)? (Not on another village's land.) */
  mayTake(faction: number, x: number, y: number): boolean;
  /** An unfinished building an idle villager should help build, or null. */
  buildSite(npc: Npc): Building | null;
  /** One step of an idle villager's building work. */
  buildWork(npc: Npc, b: Building, dt: number): void;
  /** A farmer's next field job (harvest or plant), reserved for them; null with a reason when there's none. */
  farmTask(npc: Npc, farm: Building): FarmTask | string;
  /** Does the job on that tile. Returns the food harvested (0 when planting or if it failed). */
  farmDo(npc: Npc, farm: Building, task: FarmTask): number;
}

/** Something a soldier or tower can attack. */
export interface Target {
  kind: 'animal' | 'npc' | 'player';
  id: number;
  gx: number;
  gy: number;
}

export interface Prey {
  id: number;
  gx: number;
  gy: number;
}

type State = 'idle' | 'toNode' | 'working' | 'toDeposit' | 'hunt' | 'toCarcass';

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
  /** Tool or weapon in hand (job tool while working, a soldier's weapon). */
  private handIcon?: Phaser.GameObjects.Image;
  private holding: ToolId | null = null;
  private swing = 0;
  private hungerIcon?: Phaser.GameObjects.Image;
  private cart?: Phaser.GameObjects.Image;
  private path: Tile[] = [];
  private idle = 1 + Math.random() * 2;
  private anchor: Tile;
  private roam = 4;
  private state: State = 'idle';
  private node: number | null = null;
  private workTimer = 0;
  private workAnim = 0;
  private carrying: { resource: Resource; n: number } | null = null;
  private fleeing = false;
  private preyId: number | null = null;
  private shotTimer = 0;
  private repath = 0;
  private attackCd = 0;
  /** Tool in use for the current job ('none' when the job needs none). */
  private tool: ToolId | 'none' = 'none';
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
    this.key = ensurePersonTextures(scene, data.look);
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
    this.holding = null;
    this.swing = 0;
    if (frozen) {
      this.stopWalking();
      if (faceX !== undefined) this.sprite.setFlipX(faceX < this.sprite.x);
      this.sync();
      return;
    }

    // Bandits march on a village and fight anyone in their way.
    if (this.data.role === 'bandit') {
      if (this.indoors) this.setIndoors(false);
      this.attackCd -= dt;
      this.holding = this.data.weapon ?? null;
      if (this.data.order) this.raid(dt, world);
      else this.live(dt, world);
      this.sync();
      return;
    }

    // Companions travel with the player: no house, no job, no night indoors.
    if (this.data.role === 'companion') {
      if (this.indoors) this.setIndoors(false);
      this.companion(dt, world);
      this.sync();
      return;
    }

    // Indoors for the night: hidden and safe until morning (or until their house is gone).
    if (this.indoors) {
      if ((world.isNight() || world.threat(this.gx, this.gy)) && this.home(world)) {
        this.sync();
        return;
      }
      this.setIndoors(false);
    }

    const workplace = this.workplace(world);
    const soldier = workplace !== undefined && BUILDING_DEFS[workplace.type].job?.skill === 'combat';
    if (this.data.role === 'villager' && !soldier && this.flee(dt, world)) {
      this.sync();
      return;
    }

    // Soldiers stand guard day and night, diplomats travel on; everyone else works by day.
    const busyAtNight = soldier || world.mission(this.data.id) !== null;
    if (workplace && (busyAtNight || !world.isNight())) this.work(dt, world, workplace);
    else if (workplace || world.isNight() || !this.helpBuild(dt, world)) this.live(dt, world);
    this.sync();
  }

  /** Joined the player's group: drop the marker; from now on follow the player. */
  becomeCompanion(): void {
    this.scene.tweens.killTweensOf(this.bob);
    this.marker?.destroy();
    this.marker = undefined;
    this.path = [];
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

  /** Moved to another of the player's villages: walk to the new home (or go there directly if no path). */
  moveTo(home: Building): void {
    this.setIndoors(false);
    if (!this.goNextTo(home, 60000)) {
      const f = footprintOf(home);
      this.gx = f.x + f.s / 2;
      this.gy = f.y + f.s + 0.5;
      this.path = [];
    }
    this.anchor = this.path.at(-1) ?? this.tile;
    this.roam = 3;
    this.idle = 0.5;
    this.sync();
  }

  /** Loaded villager: live around `home` without walking there first. */
  settleAt(home: Building): void {
    this.scene.tweens.killTweensOf(this.bob);
    this.marker?.destroy();
    this.marker = undefined;
    const f = footprintOf(home);
    this.anchor = { x: f.x + Math.floor(f.s / 2), y: f.y + f.s };
    this.roam = 3;
  }

  /** Fades out and removes the NPC. */
  leave(onDone: () => void): void {
    const extras = [this.marker, this.carryIcon, this.hungerIcon, this.cart, this.handIcon].filter(
      (o): o is Phaser.GameObjects.Image => o !== undefined,
    );
    const targets = [this.sprite, this.shadow, ...extras];
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

  /** Productivity, halved while starving. */
  private workRate(skill: Parameters<typeof productivity>[1]): number {
    return productivity(this.data, skill) * (isStarving(this.data) ? 0.5 : 1);
  }

  /** Runs home while an aggressive animal is hunting nearby. Returns true while fleeing. */
  private flee(dt: number, world: NpcWorld): boolean {
    const threat = world.threat(this.gx, this.gy);
    if (!threat) {
      if (this.fleeing) {
        this.fleeing = false;
        this.path = [];
        this.state = 'idle';
      }
      return false;
    }
    const home = this.home(world);
    if (home && this.isNextTo(home) && this.path.length === 0) {
      // Made it home: take shelter inside until the danger passes.
      this.fleeing = false;
      this.setIndoors(true);
      return true;
    }
    if (!this.fleeing || this.path.length === 0) {
      this.fleeing = true;
      this.state = 'idle';
      if (home && !this.isNextTo(home)) this.goNextTo(home, 4000);
    }
    this.status = 'Fugindo de um animal!';
    if (this.path.length > 0) this.walk(dt * 1.4);
    else this.stopWalking();
    return true;
  }

  /** Hunter loop: shoot prey near the hut, collect meat from carcasses, deliver. */
  private hunt(dt: number, world: NpcWorld, workplace: Building): void {
    const job = BUILDING_DEFS[workplace.type].job!;
    const f = footprintOf(workplace);
    const cx = f.x + f.s / 2;
    const cy = f.y + f.s / 2;
    const load = this.carrying?.n ?? 0;

    if (this.state === 'idle') {
      if (load >= WORKER_LOAD) {
        this.startDeposit(world);
        return;
      }
      const carcass = world.findCarcass(cx, cy, job.radius, this.data.faction);
      if (carcass && this.goNear(carcass.gx, carcass.gy, 1)) {
        this.preyId = carcass.id;
        this.state = 'toCarcass';
        this.status = null;
        return;
      }
      if (load > 0) {
        this.startDeposit(world);
        return;
      }
      const prey = world.findPrey(cx, cy, job.radius, this.data.faction);
      if (prey) {
        this.preyId = prey.id;
        this.state = 'hunt';
        this.repath = 0;
        this.status = null;
      } else {
        this.status = 'Sem caça por perto';
        this.live(dt, world);
      }
      return;
    }

    if (this.state === 'toDeposit') {
      if (this.path.length > 0) this.walk(dt);
      else {
        if (this.carrying) world.deposit(this.data.faction, this.carrying.resource, this.carrying.n);
        this.carrying = null;
        this.updateCarryIcon();
        this.state = 'idle';
      }
      return;
    }

    if (this.state === 'toCarcass') {
      if (this.path.length > 0) {
        this.walk(dt);
        return;
      }
      const got = this.preyId !== null ? world.takeMeat(this.preyId, WORKER_LOAD - load, this.data.faction) : 0;
      if (got > 0) {
        this.carrying = { resource: 'meat', n: load + got };
        this.updateCarryIcon();
      }
      this.state = 'idle';
      return;
    }

    // hunt
    const prey = this.preyId !== null ? world.prey(this.preyId) : null;
    if (!prey) {
      this.state = 'idle';
      return;
    }
    const d = Math.hypot(prey.gx - this.gx, prey.gy - this.gy);
    if (d <= HUNTER_RANGE) {
      this.path = [];
      this.stopWalking();
      this.sprite.setFlipX(prey.gx - prey.gy < this.gx - this.gy);
      this.shotTimer += dt * this.workRate('hunting');
      if (this.shotTimer >= 2) {
        this.shotTimer = 0;
        if (this.tool !== 'none') world.useTool(this, this.tool);
        if (world.shoot(this, prey.id, HUNTER_DAMAGE)) this.state = 'idle';
      }
      return;
    }
    this.repath -= dt;
    if (this.path.length === 0 || this.repath <= 0) {
      this.repath = 1;
      if (!this.goNear(prey.gx, prey.gy, 2)) {
        this.state = 'idle';
        return;
      }
    }
    this.walk(dt);
  }

  /** Soldier loop: patrol around the barracks; charge and fight hostiles that come close. */
  private guard(dt: number, world: NpcWorld, barracks: Building): void {
    this.attackCd -= dt;
    if (this.data.order) {
      this.raid(dt, world);
      return;
    }
    if (this.data.command) {
      this.commanded(dt, world, true);
      return;
    }
    const f = footprintOf(barracks);
    const cx = f.x + f.s / 2;
    const cy = f.y + f.s / 2;
    const e = engagement(stanceOf(this.data), true);
    const target = world.findHostile(this.data.faction, this.gx, this.gy, e.range, e.anyAnimal);
    const inLeash = target && Math.hypot(target.gx - cx, target.gy - cy) < e.leash;
    if (target && inLeash) {
      this.fight(dt, world, target);
      return;
    }
    this.status = null;
    // Patrol: stroll around the barracks.
    this.anchor = { x: Math.floor(cx), y: f.y + f.s };
    this.roam = 5;
    if (this.path.length > 0) {
      this.walk(dt);
      return;
    }
    this.stopWalking();
    this.idle -= dt;
    if (this.idle <= 0) {
      this.idle = 2 + Math.random() * 3;
      this.path = this.planStroll() ?? [];
    }
  }

  /** Companion: follows the player unless told otherwise. */
  private companion(dt: number, world: NpcWorld): void {
    this.attackCd -= dt;
    this.holding = this.data.weapon ?? null;
    this.commanded(dt, world, false);
  }

  /**
   * Under the player's orders (companions always; soldiers once ordered): stay with the anchor
   * (the player, or a held spot) and fight what the stance allows around it.
   */
  private commanded(dt: number, world: NpcWorld, soldier: boolean): void {
    const c = this.data.command ?? { kind: 'follow' as const };
    const anchor = c.kind === 'follow' ? world.playerAt() : { x: c.x + 0.5, y: c.y + 0.5 };
    const e = engagement(stanceOf(this.data), soldier);
    const target = world.findHostile(this.data.faction, this.gx, this.gy, e.range, e.anyAnimal);
    if (target && Math.hypot(target.gx - anchor.x, target.gy - anchor.y) < e.leash) {
      this.fight(dt, world, target);
      return;
    }
    if (c.kind === 'follow') this.follow(dt, anchor.x, anchor.y);
    else this.hold(dt, c.x, c.y);
  }

  /** Walks to a tile and stands there. */
  private hold(dt: number, x: number, y: number): void {
    const d = Math.hypot(x + 0.5 - this.gx, y + 0.5 - this.gy);
    if (d <= 1.5) {
      // On the spot or on a tile touching it (diagonals included): shift about a little.
      this.status = 'Guardando a posição';
      this.fidget(dt, x + 0.5, y + 0.5, 0, 1.45);
      return;
    }
    if (this.fidgeting) {
      this.fidgeting = false;
      this.path = [];
    }
    this.repath -= dt;
    if (this.path.length === 0) {
      if (this.repath > 0 || !this.goNear(x, y, 1, 8000)) {
        if (this.repath <= 0) {
          this.repath = 2; // unreachable: don't search every frame
          this.status = 'Não consegue chegar ao ponto';
        }
        this.stopWalking();
        return;
      }
    }
    this.status = 'Indo até o ponto';
    this.walk(dt * (d > 5 ? 1.6 : 1.2));
  }

  /** Walks after a point (the player), keeping a step or two away; catches up faster from afar. */
  private follow(dt: number, x: number, y: number): void {
    const d = Math.hypot(x - this.gx, y - this.gy);
    this.status = 'Seguindo você';
    if (d > 40) {
      // Lost far behind (e.g. you were knocked out across the map): catch up out of sight.
      this.gx = x + (Math.random() - 0.5) * 2;
      this.gy = y + 1.5;
      if (!isWalkable(this.map, Math.floor(this.gx), Math.floor(this.gy))) {
        this.gx = x;
        this.gy = y;
      }
      this.path = [];
      return;
    }
    if (d <= 2.2 || (this.fidgeting && d <= 3.4)) {
      // Close to you: stay around, now and then taking a step or looking about.
      this.fidget(dt, x, y, 1, 2.2);
      return;
    }
    if (this.fidgeting) {
      this.fidgeting = false;
      this.path = [];
    }
    this.repath -= dt;
    const last = this.path.at(-1);
    const stale = !last || Math.hypot(last.x + 0.5 - x, last.y + 0.5 - y) > 2;
    if (this.path.length === 0 || (this.repath <= 0 && stale)) {
      this.repath = 0.7;
      this.goNear(x, y, 1, 4000);
    }
    this.walk(dt * (d > 5 ? 2.3 : 1.6));
  }

  /** Idle near an anchor: walking a short fidget path, or waiting for the next step. */
  private fidgeting = false;
  private fidgetWait = 2 + Math.random() * 4;

  /**
   * Standing near (ax, ay) with nothing to do: every few seconds either turn to look the other
   * way or walk slowly to a tile between `minD` and `maxD` from the anchor, so people don't stand
   * frozen in one spot.
   */
  private fidget(dt: number, ax: number, ay: number, minD: number, maxD: number): void {
    if (this.fidgeting && this.path.length > 0) {
      this.walk(dt * 0.6);
      return;
    }
    if (this.fidgeting) {
      this.fidgeting = false;
      this.fidgetWait = 3 + Math.random() * 6;
    }
    this.path = [];
    this.stopWalking();
    this.fidgetWait -= dt;
    if (this.fidgetWait > 0) return;
    this.fidgetWait = 3 + Math.random() * 6;
    if (Math.random() < 0.4) {
      this.sprite.setFlipX(!this.sprite.flipX); // look about
      return;
    }
    const t = pickFidgetTile(Math.random, ax, ay, minD, maxD, (x, y) => isWalkable(this.map, x, y));
    if (!t) return;
    const p = findPath(this.map, this.tile, (px, py) => px === t.x && py === t.y, t, 200);
    if (p && p.length > 0 && p.length <= 4) {
      this.path = p;
      this.fidgeting = true;
    }
  }

  /** Close in on `target` and hit it on cooldown. */
  private fight(dt: number, world: NpcWorld, target: Target): void {
    this.status = 'Combatendo!';
    this.fidgeting = false;
    const d = Math.hypot(target.gx - this.gx, target.gy - this.gy);
    // Close enough to strike (a little further when there's no way to get closer).
    if (d <= 0.95 || (d <= 1.6 && this.path.length === 0)) {
      this.path = [];
      this.stopWalking();
      this.sprite.setFlipX(target.gx - target.gy < this.gx - this.gy);
      if (this.attackCd <= 0) {
        this.attackCd = 1.1;
        world.strike(this, target, soldierDamage(this.data));
        this.scene.tweens.add({ targets: this.sprite, scaleX: 1.15, duration: 70, yoyo: true });
      }
      return;
    }
    this.repath -= dt;
    if (this.path.length === 0 || this.repath <= 0) {
      this.repath = 0.6;
      // Straight at it, or next to it when its own tile can't be reached (it stands in a thicket).
      if (!this.goNear(target.gx, target.gy, 0)) this.goNear(target.gx, target.gy, 1);
    }
    this.walk(dt * 1.3);
  }

  /** Campaign: march on the enemy village, fight its defenders and batter its buildings. */
  private raid(dt: number, world: NpcWorld): void {
    const order = this.data.order!;
    if (!world.atWar(this.data.faction, order.target) || this.data.hp <= 3) {
      this.data.order = null; // war over, or badly hurt: back to the barracks
      this.path = [];
      return;
    }
    const enemy = world.findHostile(this.data.faction, this.gx, this.gy, 5);
    if (enemy) {
      this.fight(dt, world, enemy);
      return;
    }
    const b = world.raidTarget(this, order.target);
    if (!b) {
      this.data.order = null;
      return;
    }
    this.status = 'Atacando!';
    if (this.isNextTo(b)) {
      this.path = [];
      this.stopWalking();
      const f = footprintOf(b);
      this.sprite.setFlipX(f.x - f.y < this.gx - this.gy);
      if (this.attackCd <= 0) {
        this.attackCd = 1.4;
        world.attackBuilding(this, b, soldierDamage(this.data) * 2);
        this.scene.tweens.add({ targets: this.sprite, scaleX: 1.15, duration: 70, yoyo: true });
      }
      return;
    }
    this.repath -= dt;
    if (this.path.length === 0 || this.repath <= 0) {
      this.repath = 3;
      this.goNextTo(b, 30000);
    }
    this.walk(dt * 1.1);
  }

  /** Diplomat loop: wait at the embassy; on a mission walk to the other village, talk, come back. */
  private diplomat(dt: number, world: NpcWorld, embassy: Building): void {
    const m = world.mission(this.data.id);
    this.showCart(m?.kind === 'trade' && m.phase !== 'talking');
    if (!m) {
      this.status = null;
      this.live(dt, world);
      return;
    }
    if (m.phase === 'talking') {
      this.status = m.kind === 'trade' ? 'Comerciando…' : 'Negociando…';
      this.path = [];
      this.stopWalking();
      return;
    }
    if (m.phase === 'going') {
      const recruiting = m.kind === 'recruit';
      this.status = m.kind === 'trade' ? 'Levando a caravana' : recruiting ? 'Indo convidar um andarilho' : 'Viajando em missão';
      const c = world.missionPoint(this.data.id);
      if (!c) {
        world.missionFailed(this.data.id);
        return;
      }
      if (Math.hypot(c.x + 0.5 - this.gx, c.y + 0.5 - this.gy) < (recruiting ? 1.8 : 3.5)) {
        this.path = [];
        world.missionArrived(this.data.id);
        return;
      }
      // A wanderer moves about: re-plan when they've walked away from where the path ends.
      const end = this.path.at(-1);
      if (recruiting && end && Math.hypot(end.x - c.x, end.y - c.y) > 3) this.path = [];
      if (this.path.length === 0 && !this.goNear(c.x, c.y, recruiting ? 1 : 2, 40000)) {
        world.missionFailed(this.data.id);
        return;
      }
      this.walk(dt);
      return;
    }
    // returning
    this.status = 'Voltando da missão';
    if (this.isNextTo(embassy)) {
      this.path = [];
      world.missionDone(this.data.id);
      return;
    }
    if (this.path.length === 0 && !this.goNextTo(embassy, 40000)) {
      world.missionDone(this.data.id);
      return;
    }
    this.walk(dt);
  }

  private showCart(on: boolean): void {
    if (on && !this.cart) this.cart = this.scene.add.image(0, 0, 'cart').setOrigin(0.5, 1);
    if (!on && this.cart) {
      this.cart.destroy();
      this.cart = undefined;
    }
  }

  /** Smith: stand at the smithy and hammer while there's work. */
  private smith(dt: number, world: NpcWorld, smithy: Building): void {
    if (!this.isNextTo(smithy)) {
      this.status = null;
      if (this.path.length === 0) this.goNextTo(smithy, 4000);
      this.walk(dt);
      return;
    }
    this.path = [];
    if (world.smithyBusy(smithy)) {
      this.status = 'Forjando';
      const f = footprintOf(smithy);
      this.sprite.setFlipX(f.x - f.y < this.gx - this.gy);
      this.animateWork(dt);
    } else {
      this.status = 'Fila vazia ou faltam materiais';
      this.stopWalking();
    }
  }

  /** Construction site this idle villager is helping with, and sites they couldn't reach (id → retry time). */
  private siteId: number | null = null;
  private unreachable = new Map<number, number>();
  private clock = 0;

  /** Unemployed by day: walk to a construction site of the village and help build. False when there's none. */
  private helpBuild(dt: number, world: NpcWorld): boolean {
    this.clock += dt;
    const site = world.buildSite(this);
    if (!site || (this.unreachable.get(site.id) ?? 0) > this.clock) {
      this.siteId = null;
      return false;
    }
    if (this.siteId !== site.id) {
      this.siteId = site.id;
      this.path = [];
      this.state = 'idle';
    }
    if (this.isNextTo(site) && this.path.length === 0) {
      this.status = 'Construindo';
      const f = footprintOf(site);
      this.sprite.setFlipX(f.x - f.y < this.gx - this.gy);
      this.animateWork(dt);
      world.buildWork(this, site, dt);
      return true;
    }
    if (this.path.length === 0 && !this.goNextTo(site, 6000)) {
      this.unreachable.set(site.id, this.clock + 20); // try again later
      this.siteId = null;
      return false;
    }
    this.status = 'Indo ajudar na obra';
    this.walk(dt);
    return true;
  }

  /** The field job a farmer is walking to or doing. */
  private farmJob: FarmTask | null = null;

  /** Farmer loop: harvest ripe crops and plant empty fields; carry the food to the stock. */
  private farm(dt: number, world: NpcWorld, farm: Building): void {
    const load = this.carrying?.n ?? 0;
    if (this.state === 'toDeposit') {
      if (this.path.length > 0) this.walk(dt);
      else {
        if (this.carrying) world.deposit(this.data.faction, this.carrying.resource, this.carrying.n);
        this.carrying = null;
        this.updateCarryIcon();
        this.state = 'idle';
      }
      return;
    }
    if (this.state === 'idle') {
      if (load >= WORKER_LOAD) {
        this.startDeposit(world);
        return;
      }
      const task = world.farmTask(this, farm);
      if (typeof task === 'string') {
        if (load > 0) {
          this.startDeposit(world);
          return;
        }
        this.live(dt, world);
        this.status = task;
        return;
      }
      const x = task.tile % world.map.w;
      const y = Math.floor(task.tile / world.map.w);
      if (!this.goNear(x, y, 1, 4000)) {
        this.status = 'Não consegue chegar à plantação';
        this.idle = 2;
        return;
      }
      this.farmJob = task;
      this.state = 'toNode';
      this.status = null;
      return;
    }
    if (this.state === 'toNode') {
      if (this.path.length > 0) {
        this.walk(dt);
        return;
      }
      this.state = 'working';
      this.workTimer = 0;
    }
    const job = this.farmJob;
    if (!job) {
      this.state = 'idle';
      return;
    }
    this.status = job.kind === 'plant' ? 'Plantando' : 'Colhendo';
    this.faceTile(job.tile);
    this.animateWork(dt);
    this.workTimer += dt * this.workRate('farming');
    if (this.workTimer < 3) return;
    const food = world.farmDo(this, farm, job);
    if (food > 0) {
      this.carrying = { resource: 'meat', n: load + food };
      this.updateCarryIcon();
    }
    this.farmJob = null;
    this.state = 'idle';
  }

  /** True when standing at building `b` (used for smiths' presence). */
  isAt(b: Building): boolean {
    return this.isNextTo(b) && !this.indoors;
  }

  /** Path to any walkable tile within `r` tiles of (x, y). */
  private goNear(x: number, y: number, r: number, budget = 2500): boolean {
    const tx = Math.floor(x);
    const ty = Math.floor(y);
    const p = findPath(
      this.map,
      this.tile,
      (px, py) => Math.max(Math.abs(px - tx), Math.abs(py - ty)) <= r,
      { x: tx, y: ty },
      budget,
    );
    this.path = p ?? [];
    return p !== null;
  }

  /** Their workplace, if it's standing (one being moved or rebuilt doesn't count). */
  private workplace(world: NpcWorld): Building | undefined {
    if (this.data.jobId === null) return undefined;
    const b = world.buildings.list.find((x) => x.id === this.data.jobId);
    return b?.built ? b : undefined;
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
    if (home && night && this.path.length === 0 && this.isNextTo(home)) {
      this.setIndoors(true); // home for the night
      return;
    }
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
    // Productive jobs need a tool from the building's inventory.
    const tool = world.toolFor(this);
    if (tool === null) {
      this.live(dt, world);
      this.status = 'Sem ferramenta no prédio';
      return;
    }
    this.tool = tool;
    this.holding = job.skill === 'combat' ? (this.data.weapon ?? null) : tool === 'none' ? null : tool;
    if (job.skill === 'farming') {
      this.farm(dt, world, workplace);
      return;
    }
    if (job.skill === 'smithing') {
      this.smith(dt, world, workplace);
      return;
    }
    if (job.skill === 'hunting') {
      this.hunt(dt, world, workplace);
      return;
    }
    if (job.skill === 'combat') {
      this.guard(dt, world, workplace);
      return;
    }
    if (job.skill === 'diplomacy') {
      this.diplomat(dt, world, workplace);
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
      this.workTimer += dt * this.workRate(job.skill) * toolSpeed(this.tool);
      if (this.workTimer >= def.secondsPerUnit * WORKER_TIME_FACTOR) {
        this.workTimer = 0;
        const got = world.harvest(this.node);
        if (got && this.tool !== 'none') world.useTool(this, this.tool);
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
      if (this.carrying) world.deposit(this.data.faction, this.carrying.resource, this.carrying.n);
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
        if (job.nodes.includes(world.map.objects[i]) && world.mayTake(this.data.faction, x, y))
          candidates.push({ i, d: Math.hypot(x + 0.5 - this.gx, y + 0.5 - this.gy) });
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
      .filter((b) => b.built && BUILDING_DEFS[b.type].deposit && b.faction === this.data.faction)
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
    let budget = NPC_SPEED * dt * (isRoad(this.map, Math.floor(this.gx), Math.floor(this.gy)) ? ROAD_SPEED : 1);
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
    const up = Math.floor(this.workAnim * 3) % 2 === 0;
    this.sprite.setTexture(up ? `${this.key}_idle` : `${this.key}_step_a`);
    this.swing = up ? -0.7 : 0.5;
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

  /** True while inside their house at night (hidden; animals and raiders can't reach them). */
  indoors = false;

  private setIndoors(on: boolean): void {
    this.indoors = on;
    this.path = [];
    this.stopWalking();
    for (const o of [this.sprite, this.shadow, this.marker, this.carryIcon, this.hungerIcon, this.cart, this.handIcon])
      o?.setVisible(!on);
  }

  /** Draws the held tool at the hand, mirrored with the body and tilted while working. */
  private syncHand(x: number, y: number): void {
    const item = this.indoors || this.sprite.scaleY < 1 ? null : this.holding;
    if (!item) {
      this.handIcon?.setVisible(false);
      return;
    }
    this.handIcon ??= this.scene.add.image(0, 0, `icon_${item}`);
    const left = this.sprite.flipX;
    this.handIcon
      .setTexture(`icon_${item}`)
      .setVisible(true)
      .setFlipX(left)
      .setOrigin(left ? 0.85 : 0.15, 0.85)
      .setRotation(left ? -this.swing : this.swing)
      .setPosition(x + (left ? -4 : 4), y - 6)
      .setDepth(y + 0.15);
  }

  /** Children are drawn smaller (set by the world from their age). */
  setChild(child: boolean): void {
    const k = child ? 0.7 : 1;
    if (this.sprite.scaleY !== k) this.sprite.setScale(k);
  }

  private sync(): void {
    const s = gridToScreen(this.gx, this.gy);
    this.sprite.setPosition(s.x, s.y).setDepth(s.y);
    this.shadow.setPosition(s.x, s.y).setDepth(s.y - 0.5);
    this.marker?.setPosition(s.x, Math.round(s.y - 19 + this.bob.v)).setDepth(s.y + 0.1);
    this.carryIcon?.setPosition(s.x, s.y - 17).setDepth(s.y + 0.1);
    this.syncHand(s.x, s.y);
    // Starving villagers show a red meat icon over their head.
    const starving = this.data.role !== 'wanderer' && isStarving(this.data);
    if (starving && !this.hungerIcon)
      this.hungerIcon = this.scene.add.image(0, 0, 'icon_meat').setOrigin(0.5, 1).setTint(0xff6050);
    if (!starving && this.hungerIcon) {
      this.hungerIcon.destroy();
      this.hungerIcon = undefined;
    }
    this.hungerIcon?.setPosition(s.x + 6, s.y - 18).setDepth(s.y + 0.2);
    // The handcart trails behind the merchant.
    this.cart
      ?.setPosition(s.x + (this.sprite.flipX ? 9 : -9), s.y + 1)
      .setFlipX(this.sprite.flipX)
      .setDepth(s.y - 0.2);
  }
}
