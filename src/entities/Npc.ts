import Phaser from 'phaser';
import { GUARD_LEASH, GUARD_RANGE, HUNTER_RANGE, NPC_SPEED, WORKER_LOAD, WORKER_TIME_FACTOR } from '../config';
import { BUILDING_DEFS, type Building, type Buildings } from '../game/buildings';
import { NODE_DEFS } from '../game/gathering';
import type { Resource } from '../game/inventory';
import { isStarving } from '../game/needs';
import { type NpcData, productivity, soldierDamage, TIER_COLOR } from '../game/npcs';
import { ensurePersonTextures } from '../gfx/people';
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
  /** Adds resources to `faction`'s stockpile. */
  deposit(faction: number, resource: Resource, n: number): void;
  /** Position of an aggressive animal hunting near (gx, gy), if any. */
  threat(gx: number, gy: number): { x: number; y: number } | null;
  /** Nearest live prey (skittish animal) within `r` tiles of (cx, cy). */
  findPrey(cx: number, cy: number, r: number): Prey | null;
  prey(id: number): Prey | null;
  /** A hunter's shot hits prey `id`. Returns true if it died. */
  shoot(from: Npc, id: number, damage: number): boolean;
  /** Nearest carcass with meat within `r` tiles of (cx, cy). */
  findCarcass(cx: number, cy: number, r: number): Prey | null;
  takeMeat(id: number, max: number): number;
  /** Nearest thing hostile to `faction` within `r` tiles (aggressive animals, enemies at war). */
  findHostile(faction: number, gx: number, gy: number, r: number): Target | null;
  /** A soldier's blow lands on `target`. */
  strike(from: Npc, target: Target, damage: number): void;
  atWar(a: number, b: number): boolean;
  /** Nearest building of village `target` for a raiding soldier, or null. */
  raidTarget(npc: Npc, target: number): Building | null;
  attackBuilding(npc: Npc, b: Building, damage: number): void;
  /** Diplomatic mission of this diplomat, if any. */
  mission(id: number): { phase: 'going' | 'talking' | 'returning'; target: number } | null;
  missionArrived(id: number): void;
  missionDone(id: number): void;
  missionFailed(id: number): void;
  factionCenter(faction: number): { x: number; y: number };
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
  private hungerIcon?: Phaser.GameObjects.Image;
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
    if (frozen) {
      this.stopWalking();
      if (faceX !== undefined) this.sprite.setFlipX(faceX < this.sprite.x);
      this.sync();
      return;
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
    const extras = [this.marker, this.carryIcon, this.hungerIcon].filter((o): o is Phaser.GameObjects.Image => o !== undefined);
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
      const carcass = world.findCarcass(cx, cy, job.radius);
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
      const prey = world.findPrey(cx, cy, job.radius);
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
      const got = this.preyId !== null ? world.takeMeat(this.preyId, WORKER_LOAD - load) : 0;
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
        if (world.shoot(this, prey.id, 1)) this.state = 'idle';
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
    const f = footprintOf(barracks);
    const cx = f.x + f.s / 2;
    const cy = f.y + f.s / 2;
    const target = world.findHostile(this.data.faction, this.gx, this.gy, GUARD_RANGE);
    const inLeash = target && Math.hypot(target.gx - cx, target.gy - cy) < GUARD_LEASH;
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

  /** Close in on `target` and hit it on cooldown. */
  private fight(dt: number, world: NpcWorld, target: Target): void {
    this.status = 'Combatendo!';
    const d = Math.hypot(target.gx - this.gx, target.gy - this.gy);
    if (d <= 0.95) {
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
      this.goNear(target.gx, target.gy, 0);
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
    if (!m) {
      this.status = null;
      this.live(dt, world);
      return;
    }
    if (m.phase === 'talking') {
      this.status = 'Negociando…';
      this.path = [];
      this.stopWalking();
      return;
    }
    if (m.phase === 'going') {
      this.status = 'Viajando em missão';
      const c = world.factionCenter(m.target);
      if (Math.hypot(c.x + 0.5 - this.gx, c.y + 0.5 - this.gy) < 3.5) {
        this.path = [];
        world.missionArrived(this.data.id);
        return;
      }
      if (this.path.length === 0 && !this.goNear(c.x, c.y, 2, 40000)) {
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
      this.workTimer += dt * this.workRate(job.skill);
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
    // Starving villagers show a red meat icon over their head.
    const starving = this.data.role === 'villager' && isStarving(this.data);
    if (starving && !this.hungerIcon)
      this.hungerIcon = this.scene.add.image(0, 0, 'icon_meat').setOrigin(0.5, 1).setTint(0xff6050);
    if (!starving && this.hungerIcon) {
      this.hungerIcon.destroy();
      this.hungerIcon = undefined;
    }
    this.hungerIcon?.setPosition(s.x + 6, s.y - 18).setDepth(s.y + 0.2);
  }
}
