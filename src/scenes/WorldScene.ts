import Phaser from 'phaser';
import {
  DEFAULT_ZOOM_INDEX,
  FAST_FORWARD,
  HOTBAR_SLOTS,
  INTERACT_REACH,
  INVENTORY_SLOTS,
  MAX_CARRY_WEIGHT,
  NPC_REACH,
  PLAYER_RADIUS,
  TILE_H,
  WANDERER_STAY,
  ZOOM_LEVELS,
} from '../config';
import { Npc } from '../entities/Npc';
import { Player } from '../entities/Player';
import { BUILDING_DEFS, type Building, Buildings, type BuildingType, type PlaceCheck } from '../game/buildings';
import { Gatherer, NODE_DEFS, nearestTile, ResourceNodes } from '../game/gathering';
import { Inventory, RESOURCE_LABEL, RESOURCES } from '../game/inventory';
import { compass, generateWanderer, type NpcData, Population, pickSpawnTile, WandererSpawner } from '../game/npcs';
import { SlotInventory } from '../game/slots';
import { GameClock } from '../game/time';
import { createPlaceholderTextures } from '../gfx/textures';
import { gridToScreen, screenToGrid } from '../iso';
import { Ground, generateMap, Obj, tileCenter, tileIndex, type WorldMap } from '../world/map';

const GROUND_KEY: Record<Ground, string> = {
  [Ground.Grass]: 'grass',
  [Ground.Water]: 'water',
  [Ground.Sand]: 'sand',
  [Ground.Dirt]: 'dirt',
};

const OBJECT_KEY: Partial<Record<Obj, string>> = {
  [Obj.Tree]: 'tree',
  [Obj.Pine]: 'pine',
  [Obj.Rock]: 'rock',
  [Obj.Iron]: 'iron',
  [Obj.Stump]: 'stump',
  [Obj.Sapling]: 'sapling',
};

const BUILDING_KEY: Record<BuildingType, string> = {
  stockpile: 'stockpile',
  depot: 'stockpile',
  house: 'bld_house',
  lumberjack: 'bld_lumberjack',
  quarry: 'bld_quarry',
  mine: 'bld_mine',
  hunter: 'bld_hunter',
};

/** Ground is drawn beneath everything; objects and characters are depth-sorted by their screen y. */
const GROUND_DEPTH = -1_000_000;

/** What the UI overlay should show about the current interaction. World-space coordinates. */
export interface InteractionView {
  x: number;
  y: number;
  text: string;
  /** 0..1 while gathering or building, null otherwise. */
  progress: number | null;
}

/** Build-mode ghost state for the UI. */
export interface PlacementView {
  type: BuildingType;
  check: PlaceCheck;
}

/** Emitted on `scene.events` as 'popup' for floating "+1 Madeira" style feedback. */
export interface PopupEvent {
  x: number;
  y: number;
  text: string;
  color?: string;
}

/** Emitted on `scene.events` as 'toast' for screen-level notifications. */
export interface ToastEvent {
  text: string;
  color?: string;
}

interface BuildingView {
  img: Phaser.GameObjects.Image;
  sign?: Phaser.GameObjects.Image;
  /** Depth when the player is not nearby (screen y of the footprint centre). */
  baseDepth: number;
}

const isInteractable = (o: Obj) => o === Obj.Building || NODE_DEFS[o] !== undefined;

export class WorldScene extends Phaser.Scene {
  map!: WorldMap;
  player!: Player;
  buildings!: Buildings;
  readonly inventory = new SlotInventory(INVENTORY_SLOTS, HOTBAR_SLOTS, MAX_CARRY_WEIGHT);
  readonly stockpile = new Inventory();
  readonly clock = new GameClock();
  interaction: InteractionView | null = null;
  placement: PlacementView | null = null;
  population!: Population;
  /** NPC the player is talking to (dialog open in UIScene). Freezes the player and that NPC. */
  talkingTo: NpcData | null = null;
  /** Set by UIScene while the inventory panel is open: freezes movement and gathering. */
  inventoryOpen = false;
  /** Selected hotbar slot (0-based). No effect yet; tools will use it. */
  selectedHotbar = 0;
  /** True while world time is being fast-forwarded (T held). */
  fastForward = false;

  private nodes!: ResourceNodes;
  private readonly gatherer = new Gatherer();
  private keys!: Record<
    'W' | 'A' | 'S' | 'D' | 'UP' | 'DOWN' | 'LEFT' | 'RIGHT' | 'SHIFT' | 'E' | 'T',
    Phaser.Input.Keyboard.Key
  >;
  private readonly objectImages = new Map<number, Phaser.GameObjects.Image>();
  private readonly buildingViews = new Map<number, BuildingView>();
  private readonly npcs = new Map<number, Npc>();
  private readonly spawner = new WandererSpawner(Math.random);
  private selection!: Phaser.GameObjects.Graphics;
  private ghost!: Phaser.GameObjects.Image;
  private placeTile = { x: 0, y: 0 };
  private zoomIndex = DEFAULT_ZOOM_INDEX;

  constructor() {
    super('World');
  }

  create(): void {
    createPlaceholderTextures(this);
    this.map = generateMap();
    this.nodes = new ResourceNodes(this.map);
    this.buildings = new Buildings(this.map);
    this.population = new Population(this.buildings);

    this.drawMap();

    // The central stockpile stands in the spawn clearing, next to where the player starts.
    const sx = Math.floor(this.map.spawn.x);
    const sy = Math.floor(this.map.spawn.y);
    this.addBuildingView(this.buildings.place('stockpile', sx + 2, sy - 1, true));

    this.selection = this.add.graphics().setDepth(GROUND_DEPTH + 1);
    this.ghost = this.add.image(0, 0, 'bld_house').setOrigin(0.5, 1).setAlpha(0.65).setDepth(1_000_000).setVisible(false);
    this.player = new Player(this, this.map, this.map.spawn.x, this.map.spawn.y);

    const kb = this.input.keyboard!;
    this.keys = kb.addKeys('W,A,S,D,UP,DOWN,LEFT,RIGHT,SHIFT,E,T') as typeof this.keys;

    const cam = this.cameras.main;
    const left = gridToScreen(0, this.map.h).x;
    const right = gridToScreen(this.map.w, 0).x;
    const bottom = gridToScreen(this.map.w, this.map.h).y;
    cam.setBounds(left, 0, right - left, bottom);
    cam.setZoom(ZOOM_LEVELS[this.zoomIndex]);
    cam.setRoundPixels(true);
    cam.startFollow(this.player.sprite, true, 0.15, 0.15);

    this.input.on('wheel', (_p: unknown, _o: unknown, _dx: number, dy: number) => {
      this.zoomIndex = Phaser.Math.Clamp(this.zoomIndex + (dy > 0 ? -1 : 1), 0, ZOOM_LEVELS.length - 1);
      cam.setZoom(ZOOM_LEVELS[this.zoomIndex]);
    });

    this.scene.launch('UI');
  }

  update(_time: number, deltaMs: number): void {
    const k = this.keys;
    const frozen = this.inventoryOpen || this.talkingTo !== null;
    const x = frozen ? 0 : (k.D.isDown || k.RIGHT.isDown ? 1 : 0) - (k.A.isDown || k.LEFT.isDown ? 1 : 0);
    const y = frozen ? 0 : (k.S.isDown || k.DOWN.isDown ? 1 : 0) - (k.W.isDown || k.UP.isDown ? 1 : 0);
    // Clamp huge frame gaps (e.g. tab switch) so the player never tunnels through walls.
    const dt = Math.min(deltaMs, 50) / 1000;

    // World time (clock + regrowth) can be fast-forwarded; the player always moves in real time.
    this.fastForward = k.T.isDown;
    const worldDt = dt * (this.fastForward ? FAST_FORWARD : 1);
    this.clock.advance(worldDt);
    for (const i of this.nodes.update(worldDt, (t) => !this.playerOverlapsTile(t))) this.replaceObjectImage(i);

    this.player.update(dt, { x, y, run: k.SHIFT.isDown });
    this.updateNpcs(dt, worldDt);
    this.selection.clear();
    if (this.placement) this.updatePlacement();
    else this.updateInteraction(dt, x !== 0 || y !== 0);
    this.sortBuildingsAroundPlayer();
    this.fadeObjectsInFrontOfPlayer();
  }

  // ---------- NPCs ----------

  /** Village centre for spawn distances and compass directions: the central stockpile. */
  private get villageCenter(): { x: number; y: number } {
    const s = this.buildings.list[0];
    return { x: s.tx + 0.5, y: s.ty + 0.5 };
  }

  private updateNpcs(dt: number, worldDt: number): void {
    if (this.spawner.update(worldDt, this.population.wanderers.length)) this.spawnWanderer();

    for (const npc of [...this.npcs.values()]) {
      const talking = this.talkingTo?.id === npc.data.id;
      npc.update(dt, talking, talking ? this.player.sprite.x : undefined);
      if (npc.data.role === 'wanderer' && !talking && this.clock.seconds >= npc.data.leavesAt) {
        this.npcs.delete(npc.data.id);
        this.population.remove(npc.data.id);
        npc.leave(() => {});
        this.toast(`${npc.data.name} desistiu de esperar e foi embora.`, '#cfc3a8');
      }
    }
  }

  private spawnWanderer(): void {
    const center = this.villageCenter;
    const tile = pickSpawnTile(this.map, Math.random, center);
    if (!tile) return;
    const data = generateWanderer(Math.random, this.population.newId(), this.clock.seconds + WANDERER_STAY);
    this.population.npcs.push(data);
    this.npcs.set(data.id, new Npc(this, this.map, data, tile));
    const who = data.gender === 'f' ? 'Uma andarilha' : 'Um andarilho';
    this.toast(`${who} apareceu ${compass(tile.x + 0.5 - center.x, tile.y + 0.5 - center.y)} da vila.`, '#ffe08a');
  }

  /** Nearest NPC within reach of the player, or null. */
  private nearestNpc(): Npc | null {
    let best: Npc | null = null;
    let bestD = NPC_REACH;
    for (const npc of this.npcs.values()) {
      const d = Math.hypot(npc.gx - this.player.gx, npc.gy - this.player.gy);
      if (d <= bestD) {
        bestD = d;
        best = npc;
      }
    }
    return best;
  }

  /** Called by the dialog. Returns true if the wanderer joined the village. */
  recruit(id: number): boolean {
    const npc = this.npcs.get(id);
    if (!npc) return false;
    const home = this.population.recruit(npc.data, this.inventory, this.stockpile);
    if (!home) return false;
    npc.becomeVillager(home);
    this.toast(`${npc.data.name} entrou para a vila!`, '#a8ffa8');
    return true;
  }

  stopTalking(): void {
    this.talkingTo = null;
  }

  private toast(text: string, color?: string): void {
    this.events.emit('toast', { text, color } satisfies ToastEvent);
  }

  // ---------- build mode (driven by UIScene) ----------

  startPlacing(type: BuildingType): void {
    this.placement = { type, check: { ok: false, reason: '' } };
    this.ghost.setTexture(BUILDING_KEY[type]).setVisible(true);
    this.interaction = null;
  }

  cancelPlacing(): void {
    this.placement = null;
    this.ghost.setVisible(false);
  }

  /** Places a construction site at the ghost's position if valid. Returns true on success. */
  tryPlace(): boolean {
    if (!this.placement?.check.ok) return false;
    const { type } = this.placement;
    const def = BUILDING_DEFS[type];
    if (!this.stockpile.pay(def.cost)) return false;
    const b = this.buildings.place(type, this.placeTile.x, this.placeTile.y);
    for (const i of this.buildings.footprint(type, b.tx, b.ty)) this.replaceObjectImage(i); // clears stumps/saplings
    const view = this.addBuildingView(b);
    this.events.emit('popup', {
      x: view.img.x,
      y: view.img.y - view.img.height,
      text: `Obra: ${def.name}`,
      color: '#ffe08a',
    } satisfies PopupEvent);
    this.cancelPlacing();
    return true;
  }

  private updatePlacement(): void {
    const p = this.placement!;
    const def = BUILDING_DEFS[p.type];
    const ptr = this.input.activePointer;
    const world = this.cameras.main.getWorldPoint(ptr.x, ptr.y);
    const g = screenToGrid(world.x, world.y);
    const tx = Math.floor(g.x - (def.size - 1) / 2);
    const ty = Math.floor(g.y - (def.size - 1) / 2);
    this.placeTile = { x: tx, y: ty };

    let check = this.buildings.check(p.type, tx, ty, (i) => this.playerOverlapsTile(i));
    if (check.ok && !this.stockpile.canAfford(def.cost)) check = { ok: false, reason: 'Recursos insuficientes no estoque' };
    p.check = check;

    const bottom = gridToScreen(tx + def.size, ty + def.size);
    this.ghost.setPosition(bottom.x, bottom.y).setTint(check.ok ? 0xa8ffa8 : 0xff9090);
    this.drawFootprint(tx, ty, def.size, check.ok ? 0x8aff8a : 0xff6060);
  }

  // ---------- interaction ----------

  private updateInteraction(dt: number, moving: boolean): void {
    if (this.talkingTo) {
      this.interaction = null;
      return;
    }

    // People take priority over things.
    const npc = this.inventoryOpen ? null : this.nearestNpc();
    if (npc) {
      this.gatherer.tick(dt, null, false, 1);
      const d = npc.data;
      const text = d.role === 'wanderer' ? `[E] Falar com ${d.name}` : `[E] ${d.name}`;
      this.interaction = { x: npc.sprite.x, y: npc.sprite.y - npc.sprite.height - 6, text, progress: null };
      if (Phaser.Input.Keyboard.JustDown(this.keys.E)) {
        this.talkingTo = d;
        this.player.face(npc.sprite.x);
        this.events.emit('talk', d);
      }
      return;
    }

    const target = this.inventoryOpen
      ? null
      : nearestTile(this.map, this.player.gx, this.player.gy, INTERACT_REACH, isInteractable);

    if (target === null) {
      this.gatherer.tick(dt, null, false, 1);
      this.interaction = null;
      return;
    }

    if (this.map.objects[target] === Obj.Building) {
      this.gatherer.tick(dt, null, false, 1);
      this.interactWithBuilding(this.buildings.at(target)!, dt, moving);
      return;
    }

    const tx = target % this.map.w;
    const ty = Math.floor(target / this.map.w);
    this.drawFootprint(tx, ty, 1, 0xffe08a);

    const obj = this.map.objects[target];
    const img = this.objectImages.get(target);
    const anchorX = img?.x ?? 0;
    const anchorY = img ? img.y - img.height - 2 : 0;
    const def = NODE_DEFS[obj]!;
    const full = this.inventory.space(def.resource) <= 0;
    const active = this.keys.E.isDown && !moving && !full;
    if (active) this.player.face(anchorX);

    if (this.gatherer.tick(dt, target, active, def.secondsPerUnit)) this.harvest(target);

    const left = this.nodes.remainingAt(target);
    this.interaction = {
      x: anchorX,
      y: anchorY,
      text: full ? 'Peso máximo! Leve ao estoque' : `[segure E] ${def.verb} ${def.name} (${left})`,
      progress: active ? this.gatherer.progress / def.secondsPerUnit : null,
    };
  }

  private interactWithBuilding(b: Building, dt: number, moving: boolean): void {
    const def = BUILDING_DEFS[b.type];
    const view = this.buildingViews.get(b.id)!;
    const x = view.img.x;
    const y = view.img.y - view.img.height - 2;
    this.drawFootprint(b.tx, b.ty, def.size, 0xffe08a);

    if (!b.built) {
      const active = this.keys.E.isDown && !moving;
      if (active) {
        this.player.face(x);
        if (this.buildings.work(b, dt)) {
          this.refreshBuildingView(b);
          this.events.emit('popup', { x, y, text: `${def.name} construída!`, color: '#ffe08a' } satisfies PopupEvent);
        }
      }
      const pct = Math.floor((b.progress / def.buildSeconds) * 100);
      this.interaction = {
        x,
        y,
        text: `[segure E] Construir ${def.name} (${pct}%)`,
        progress: active ? b.progress / def.buildSeconds : null,
      };
      return;
    }

    if (def.deposit) {
      if (Phaser.Input.Keyboard.JustDown(this.keys.E)) this.deposit(x, y);
      const hasItems = this.inventory.slots.some((s) => s !== null);
      this.interaction = { x, y, text: hasItems ? `[E] Guardar no estoque` : def.name, progress: null };
      return;
    }

    this.interaction = { x, y, text: `${def.name}: ${def.description}`, progress: null };
  }

  private harvest(i: number): void {
    const result = this.nodes.harvest(i);
    if (!result) return;
    this.inventory.add(result.resource);

    const img = this.objectImages.get(i);
    if (img) {
      this.events.emit('popup', {
        x: img.x,
        y: img.y - img.height,
        text: `+1 ${RESOURCE_LABEL[result.resource]}`,
      } satisfies PopupEvent);
      this.tweens.add({ targets: img, x: img.x + 1, duration: 40, yoyo: true, repeat: 1 });
    }

    if (result.depleted) this.replaceObjectImage(i);
  }

  private deposit(x: number, y: number): void {
    const moved = this.inventory.takeAllResources();
    for (const r of RESOURCES) this.stockpile.add(r, moved[r]);
    const parts = RESOURCES.filter((r) => moved[r] > 0).map((r) => `+${moved[r]} ${RESOURCE_LABEL[r]}`);
    if (parts.length > 0) this.events.emit('popup', { x, y, text: parts.join('  '), color: '#ffe08a' } satisfies PopupEvent);
  }

  // ---------- rendering ----------

  private drawMap(): void {
    const m = this.map;
    for (let ty = 0; ty < m.h; ty++) {
      for (let tx = 0; tx < m.w; tx++) {
        const i = tileIndex(m, tx, ty);
        const c = gridToScreen(tx + 0.5, ty + 0.5);
        this.add.image(c.x, c.y, `${GROUND_KEY[m.ground[i]]}_${m.variant[i]}`).setDepth(GROUND_DEPTH);
        this.replaceObjectImage(i);
      }
    }
  }

  /** (Re)creates the sprite for whatever natural object currently sits on tile `i`. Buildings have their own views. */
  private replaceObjectImage(i: number): void {
    this.objectImages.get(i)?.destroy();
    this.objectImages.delete(i);
    const key = OBJECT_KEY[this.map.objects[i]];
    if (!key) return;
    const g = tileCenter(this.map, i);
    const c = gridToScreen(g.x, g.y);
    // Anchor the sprite's base slightly below the tile center so it sits on the diamond.
    const img = this.add
      .image(c.x, c.y + TILE_H / 4, key)
      .setOrigin(0.5, 1)
      .setDepth(c.y);
    if (this.map.variant[i] % 2 === 1) img.setFlipX(true);
    this.objectImages.set(i, img);
  }

  private addBuildingView(b: Building): BuildingView {
    const s = BUILDING_DEFS[b.type].size;
    const bottom = gridToScreen(b.tx + s, b.ty + s);
    const center = gridToScreen(b.tx + s / 2, b.ty + s / 2);
    const img = this.add.image(bottom.x, bottom.y, 'site_1').setOrigin(0.5, 1).setDepth(center.y);
    const view: BuildingView = { img, baseDepth: center.y };
    this.buildingViews.set(b.id, view);
    this.refreshBuildingView(b);
    return view;
  }

  private refreshBuildingView(b: Building): void {
    const def = BUILDING_DEFS[b.type];
    const view = this.buildingViews.get(b.id)!;
    view.img.setTexture(b.built ? BUILDING_KEY[b.type] : `site_${def.size}`);
    view.sign?.destroy();
    view.sign = undefined;
    if (b.built && def.sign) {
      view.sign = this.add.image(view.img.x, view.img.y - view.img.height - 3, `icon_${def.sign}`).setOrigin(0.5, 1);
    }
  }

  private drawFootprint(tx: number, ty: number, size: number, color: number): void {
    const pts = [
      gridToScreen(tx, ty),
      gridToScreen(tx + size, ty),
      gridToScreen(tx + size, ty + size),
      gridToScreen(tx, ty + size),
    ];
    this.selection.lineStyle(1, color, 0.9);
    this.selection.strokePoints(pts, true);
  }

  private playerOverlapsTile(i: number): boolean {
    const tx = i % this.map.w;
    const ty = Math.floor(i / this.map.w);
    const { gx, gy } = this.player;
    const r = PLAYER_RADIUS;
    return gx + r > tx && gx - r < tx + 1 && gy + r > ty && gy - r < ty + 1;
  }

  /**
   * Multi-tile buildings can't be sorted against the player by a single y value. Near the player
   * we decide exactly: the player is in front if they are past the footprint's south-east or south-west edge.
   */
  private sortBuildingsAroundPlayer(): void {
    const { gx, gy } = this.player;
    const pd = this.player.sprite.depth;
    for (const b of this.buildings.list) {
      const view = this.buildingViews.get(b.id)!;
      const s = BUILDING_DEFS[b.type].size;
      const near = gx > b.tx - 3 && gx < b.tx + s + 3 && gy > b.ty - 3 && gy < b.ty + s + 3;
      let depth = view.baseDepth;
      if (near) depth = gx >= b.tx + s || gy >= b.ty + s ? pd - 0.25 : pd + 0.25;
      view.img.setDepth(depth);
      view.sign?.setDepth(depth + 0.01);
    }
  }

  /** Tall objects in front of the player become see-through, so the player is never fully hidden. */
  private fadeObjectsInFrontOfPlayer(): void {
    const p = this.player.sprite;
    const px = p.x;
    const py = p.y - 8; // roughly the player's torso
    const fade = (o: Phaser.GameObjects.Image) => {
      const inFront = o.depth > p.depth && Math.abs(o.x - px) < o.width / 2 + 2 && py > o.y - o.height && py < o.y;
      o.setAlpha(inFront ? 0.45 : 1);
    };
    for (const o of this.objectImages.values()) fade(o);
    for (const v of this.buildingViews.values()) fade(v.img);
  }
}
