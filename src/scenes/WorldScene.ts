import Phaser from 'phaser';
import {
  ATTACK_COOLDOWN,
  AUTOSAVE_SECONDS,
  BEDS_PER_HOUSE,
  DAY_SECONDS,
  DEFAULT_ZOOM_INDEX,
  FAST_FORWARD,
  HOTBAR_SLOTS,
  INTERACT_REACH,
  INVENTORY_SLOTS,
  MAX_CARRY_WEIGHT,
  MEAT_HEAL,
  NPC_REACH,
  PLAYER_RADIUS,
  TILE_H,
  TILE_W,
  VILLAGER_HP,
  WANDERER_STAY,
  ZOOM_LEVELS,
} from '../config';
import type { Animal, Human } from '../entities/Animal';
import { Npc, type NpcWorld } from '../entities/Npc';
import { Player } from '../entities/Player';
import { BUILDING_DEFS, type Building, Buildings, type BuildingType, type PlaceCheck } from '../game/buildings';
import { type CraftCheck, craft } from '../game/crafting';
import { createFactions, type Faction, PLAYER_FACTION } from '../game/factions';
import { Gatherer, NODE_DEFS, nearestTile, ResourceNodes } from '../game/gathering';
import { Inventory, RESOURCE_LABEL, RESOURCES, type Resource } from '../game/inventory';
import { ITEM_DEFS, type ItemId, type Recipe, type ToolType } from '../game/items';
import { isStarving, updateNeeds } from '../game/needs';
import { compass, generateWanderer, jobTitle, type NpcData, Population, pickSpawnTile, WandererSpawner } from '../game/npcs';
import { PER_LEVEL, PlayerStats, XP } from '../game/player';
import { clearSave, readSave, SAVE_VERSION, type SaveData, writeSave } from '../game/save';
import { SlotInventory } from '../game/slots';
import { Territory } from '../game/territory';
import { GameClock } from '../game/time';
import { findSpot, foundTown, populateTown } from '../game/towns';
import { createPlaceholderTextures } from '../gfx/textures';
import { gridToScreen, screenToGrid } from '../iso';
import { Wildlife } from '../systems/Wildlife';
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

/** Scene start data: load a specific save, or force a fresh game (otherwise the last save is loaded). */
export interface WorldInit {
  save?: SaveData | null;
  fresh?: boolean;
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
  inventory!: SlotInventory;
  stockpile!: Inventory;
  clock!: GameClock;
  interaction: InteractionView | null = null;
  placement: PlacementView | null = null;
  population!: Population;
  /** NPC the player is talking to (dialog open in UIScene). Freezes the player and that NPC. */
  talkingTo: NpcData | null = null;
  /** Building whose panel is open in UIScene (workers / residents). Freezes the player. */
  panelBuilding: Building | null = null;
  npcWorld!: NpcWorld;
  factions!: Faction[];
  territory!: Territory;
  private townTimer = 0;
  /** Set by UIScene while the inventory panel is open: freezes movement and gathering. */
  inventoryOpen = false;
  /** Selected hotbar slot (0-based). No effect yet; tools will use it. */
  selectedHotbar = 0;
  /** True while world time is being fast-forwarded (T held). */
  fastForward = false;
  stats!: PlayerStats;
  wildlife!: Wildlife;
  private attackCd = 0;
  private villagerRegen = 0;
  private slash!: Phaser.GameObjects.Image;

  private nodes!: ResourceNodes;
  private gatherer!: Gatherer;
  private keys!: Record<
    'W' | 'A' | 'S' | 'D' | 'UP' | 'DOWN' | 'LEFT' | 'RIGHT' | 'SHIFT' | 'E' | 'T' | 'SPACE' | 'F',
    Phaser.Input.Keyboard.Key
  >;
  private objectImages!: Map<number, Phaser.GameObjects.Image>;
  private buildingViews!: Map<number, BuildingView>;
  private npcs!: Map<number, Npc>;
  private spawner!: WandererSpawner;
  private initData: WorldInit = {};
  private autosaveTimer = 0;
  private lastSaveDay = 0;
  private selection!: Phaser.GameObjects.Graphics;
  private ghost!: Phaser.GameObjects.Image;
  private placeTile = { x: 0, y: 0 };
  private zoomIndex = DEFAULT_ZOOM_INDEX;

  constructor() {
    super('World');
  }

  /**
   * Runs before every create(), including scene restarts (loading a save, new game): Phaser reuses
   * this instance, so all per-game state is rebuilt here rather than in field initialisers.
   */
  init(data: WorldInit = {}): void {
    this.initData = data;
    this.inventory = new SlotInventory(INVENTORY_SLOTS, HOTBAR_SLOTS, MAX_CARRY_WEIGHT);
    this.stockpile = new Inventory();
    this.clock = new GameClock();
    this.stats = new PlayerStats();
    this.gatherer = new Gatherer();
    this.objectImages = new Map();
    this.buildingViews = new Map();
    this.npcs = new Map();
    this.spawner = new WandererSpawner(Math.random);
    this.interaction = null;
    this.placement = null;
    this.talkingTo = null;
    this.panelBuilding = null;
    this.inventoryOpen = false;
    this.selectedHotbar = 0;
    this.fastForward = false;
    this.attackCd = 0;
    this.villagerRegen = 0;
    this.autosaveTimer = 0;
    this.placeTile = { x: 0, y: 0 };
    this.zoomIndex = DEFAULT_ZOOM_INDEX;
  }

  create(): void {
    createPlaceholderTextures(this);
    const save = this.initData.fresh ? null : (this.initData.save ?? readSave());
    this.map = generateMap();
    if (save) this.map.objects.splice(0, this.map.objects.length, ...save.objects);
    this.nodes = new ResourceNodes(this.map);
    this.buildings = new Buildings(this.map);
    this.population = new Population(this.buildings);
    this.factions = createFactions(this.map.sites, this.stockpile);
    this.territory = new Territory(this.map);
    this.npcWorld = {
      map: this.map,
      buildings: this.buildings,
      isNight: () => this.clock.isNight,
      harvest: (i) => this.workerHarvest(i),
      deposit: (f, r, n) => this.factions[f]?.stock.add(r, n),
      threat: (gx, gy) => this.wildlife.threat(gx, gy),
      findPrey: (cx, cy, r) => this.wildlife.findPrey(cx, cy, r),
      prey: (id) => this.wildlife.prey(id),
      shoot: (from, id, dmg) => this.wildlife.shoot(from, id, dmg),
      findCarcass: (cx, cy, r) => this.wildlife.findCarcass(cx, cy, r),
      takeMeat: (id, max) => this.wildlife.takeMeat(id, max),
    };

    if (save) {
      this.nodes.restore(save.nodes);
      this.buildings.restore(save.buildings);
    }
    this.drawMap();

    if (save) for (const b of this.buildings.list) this.addBuildingView(b);
    else {
      // The central stockpile stands in the spawn clearing, next to where the player starts.
      const sx = Math.floor(this.map.spawn.x);
      const sy = Math.floor(this.map.spawn.y);
      this.addBuildingView(this.buildings.place('stockpile', sx + 2, sy - 1, true));
      this.factions[0].center = { x: sx + 2, y: sy - 1 };
      for (const f of this.factions)
        if (!f.isPlayer) for (const b of foundTown(this.buildings, f, Math.random)) this.addBuildingView(b);
    }
    this.territory.recompute(this.buildings.list);

    this.selection = this.add.graphics().setDepth(GROUND_DEPTH + 1);
    this.ghost = this.add.image(0, 0, 'bld_house').setOrigin(0.5, 1).setAlpha(0.65).setDepth(1_000_000).setVisible(false);
    this.player = new Player(this, this.map, this.map.spawn.x, this.map.spawn.y);

    const kb = this.input.keyboard!;
    this.keys = kb.addKeys('W,A,S,D,UP,DOWN,LEFT,RIGHT,SHIFT,E,T,SPACE,F') as typeof this.keys;
    this.slash = this.add.image(0, 0, 'slash').setVisible(false).setDepth(900_002);

    this.wildlife = new Wildlife({
      scene: this,
      map: this.map,
      isNight: () => this.clock.isNight,
      now: () => this.clock.seconds,
      avoidPoints: () => [...this.factions.map((f) => f.center), { x: this.player.gx, y: this.player.gy }],
      humans: () => this.humans(),
      onHumanHit: (t, dmg, a) => this.onHumanHit(t, dmg, a),
      popup: (x, y, text, color) => this.popup(x, y, text, color),
    });
    if (save) this.applySave(save);
    else {
      this.wildlife.populate();
      for (const f of this.factions) {
        if (f.isPlayer) continue;
        f.stock.add('wood', 20);
        f.stock.add('stone', 10);
        f.stock.add('meat', 20);
        for (const n of populateTown(this.population, this.buildings, f, Math.random, 6)) this.spawnVillagerEntity(n);
      }
    }
    this.lastSaveDay = this.clock.day;

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

    // Save when the page is closed or hidden.
    const onHide = () => {
      if (document.visibilityState === 'hidden') this.saveGame(true);
    };
    const onUnload = () => this.saveGame(true);
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('beforeunload', onUnload);
    this.events.once('shutdown', () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('beforeunload', onUnload);
    });

    this.scene.launch('UI');
    if (save) this.time.delayedCall(300, () => this.toast(`Jogo carregado: dia ${this.clock.day}.`, '#a8ffa8'));
  }

  // ---------- save / load ----------

  /** Writes the game to browser storage. `quiet` skips the toast (autosave on close). */
  saveGame(quiet = false): boolean {
    const data: SaveData = {
      version: SAVE_VERSION,
      savedAt: new Date().toISOString(),
      clock: this.clock.seconds,
      objects: [...this.map.objects],
      nodes: this.nodes.snapshot(),
      buildings: this.buildings.snapshot(),
      stockpile: { ...this.stockpile.items },
      factions: this.factions.map((f) => ({
        id: f.id,
        stock: { ...f.stock.items },
        alive: f.alive,
        rulerId: f.rulerId,
        center: f.center,
      })),
      inventory: this.inventory.slots.map((s) => (s ? { ...s } : null)),
      selectedHotbar: this.selectedHotbar,
      player: { gx: this.player.gx, gy: this.player.gy, ...this.stats.snapshot() },
      population: this.population.snapshot(),
      npcPositions: [...this.npcs.values()].map((n) => [n.data.id, n.gx, n.gy]),
      animals: this.wildlife.snapshot(),
    };
    const ok = writeSave(data);
    if (!quiet) this.toast(ok ? 'Jogo salvo.' : 'Não foi possível salvar neste navegador.', ok ? '#a8ffa8' : '#ff8a7a');
    return ok;
  }

  /** Restarts the world from a save (or the last saved game). */
  loadGame(save: SaveData | null = readSave()): boolean {
    if (!save) return false;
    this.scene.restart({ save } satisfies WorldInit);
    return true;
  }

  /** Discards the saved game and starts over. */
  newGame(): void {
    clearSave();
    this.scene.restart({ fresh: true } satisfies WorldInit);
  }

  private applySave(save: SaveData): void {
    this.clock.seconds = save.clock;
    Object.assign(this.stockpile.items, save.stockpile);
    save.inventory.forEach((s, i) => {
      if (i < this.inventory.slots.length) this.inventory.slots[i] = s ? { ...s } : null;
    });
    this.selectedHotbar = save.selectedHotbar;
    this.stats.restore(save.player);
    this.inventory.maxWeight = this.stats.carryWeight;
    this.player.gx = save.player.gx;
    this.player.gy = save.player.gy;
    this.population.restore(save.population);
    const pos = new Map(save.npcPositions.map(([id, x, y]) => [id, { x, y }]));
    for (const data of this.population.npcs) this.spawnVillagerEntity(data, pos.get(data.id) ?? this.villageCenter);
    this.wildlife.restore(save.animals);
    for (const sf of save.factions) {
      const f = this.factions[sf.id];
      if (!f) continue;
      if (!f.isPlayer) Object.assign(f.stock.items, sf.stock);
      f.alive = sf.alive;
      f.rulerId = sf.rulerId;
      f.center = sf.center;
    }
    this.territory.recompute(this.buildings.list);
  }

  /** Autosave every few real minutes and at each new day. */
  private autosave(dt: number): void {
    this.autosaveTimer += dt;
    if (this.autosaveTimer >= AUTOSAVE_SECONDS || this.clock.day !== this.lastSaveDay) {
      this.autosaveTimer = 0;
      this.lastSaveDay = this.clock.day;
      this.saveGame(true);
    }
  }

  update(_time: number, deltaMs: number): void {
    const k = this.keys;
    const frozen = this.inventoryOpen || this.talkingTo !== null || this.panelBuilding !== null;
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
    this.stats.update(worldDt);
    this.wildlife.update(worldDt);
    this.updateNpcs(worldDt);
    this.attackCd -= dt;
    if (!frozen && !this.placement && Phaser.Input.Keyboard.JustDown(k.SPACE)) this.attack();
    if (!frozen && Phaser.Input.Keyboard.JustDown(k.F)) this.eat();
    this.selection.clear();
    if (this.placement) this.updatePlacement();
    else this.updateInteraction(dt, x !== 0 || y !== 0);
    this.sortBuildingsAroundPlayer();
    this.fadeObjectsInFrontOfPlayer();
    this.autosave(dt);
  }

  // ---------- combat ----------

  /** People animals can see: the player and every villager. */
  private humans(): Human[] {
    const list: Human[] = [{ kind: 'player', id: 0, gx: this.player.gx, gy: this.player.gy }];
    for (const n of this.npcs.values())
      if (n.data.role === 'villager') list.push({ kind: 'npc', id: n.data.id, gx: n.gx, gy: n.gy });
    return list;
  }

  /** Damage the player deals with a melee swing. Weapons raise it (crafting). */
  playerDamage(): number {
    const s = this.inventory.slots[this.selectedHotbar];
    return (s && ITEM_DEFS[s.item].tool?.damage) || 1;
  }

  private attack(): void {
    if (this.attackCd > 0) return;
    this.attackCd = ATTACK_COOLDOWN;
    const p = this.player.sprite;
    const dir = p.flipX ? -1 : 1;
    this.slash
      .setPosition(p.x + dir * 9, p.y - 9)
      .setFlipX(dir < 0)
      .setVisible(true)
      .setAlpha(1);
    this.tweens.add({ targets: this.slash, alpha: 0, duration: 160, onComplete: () => this.slash.setVisible(false) });
    const held = this.inventory.slots[this.selectedHotbar];
    const reach = (held && ITEM_DEFS[held.item].tool?.reach) || 0;
    const hit = this.wildlife.playerAttack(this.player.gx, this.player.gy, this.playerDamage(), this.humans()[0], reach);
    if (hit) {
      this.player.face(hit.sprite.x);
      if (held?.durability !== undefined) this.wearTool(this.selectedHotbar);
      if (!hit.alive) this.gainXp(hit.def.hp * XP.killPerHp);
    }
  }

  private onHumanHit(target: Human, damage: number, animal: Animal): void {
    if (target.kind === 'player') {
      const p = this.player.sprite;
      this.popup(p.x, p.y - p.height, `-${damage}`, '#ff6a5a');
      p.setTint(0xff7060);
      this.time.delayedCall(150, () => p.clearTint());
      this.cameras.main.shake(80, 0.004);
      if (this.stats.hurt(damage)) this.knockOut(animal);
      return;
    }
    const npc = this.npcs.get(target.id);
    if (!npc) return;
    npc.data.hp -= damage;
    npc.sprite.setTint(0xff7060);
    this.time.delayedCall(150, () => npc.sprite.clearTint());
    this.popup(npc.sprite.x, npc.sprite.y - npc.sprite.height, `-${damage}`, '#ff6a5a');
    if (npc.data.hp <= 0) this.removeVillager(npc.data.id, `${npc.data.name} foi morto por um ${animal.def.name.toLowerCase()}.`);
  }

  /** A villager dies: frees their bed and job, fades them out, tells the player. */
  private removeVillager(id: number, message: string | null): void {
    const npc = this.npcs.get(id);
    this.npcs.delete(id);
    this.population.remove(id);
    if (this.talkingTo?.id === id) this.talkingTo = null;
    npc?.leave(() => {});
    if (message) this.toast(message, '#ff8a7a');
  }

  /** F: eat one meat you carry to heal. */
  private eat(): void {
    const p = this.player.sprite;
    if (this.stats.hp >= this.stats.maxHp) return;
    if (this.inventory.remove('meat', 1) === 0) {
      this.popup(p.x, p.y - p.height, 'Sem carne na mochila', '#cfc3a8');
      return;
    }
    this.stats.heal(MEAT_HEAL);
    this.popup(p.x, p.y - p.height, `+${MEAT_HEAL} ♥`, '#a8ffa8');
  }

  /** The player's HP hit zero: wake up at the village, losing carried resources (tools are kept). */
  private knockOut(animal: Animal): void {
    const lost = this.inventory.takeAllResources();
    const any = RESOURCES.some((r) => lost[r] > 0);
    const c = this.villageCenter;
    this.player.gx = c.x - 1;
    this.player.gy = c.y + 1.5;
    this.stats.hp = this.stats.maxHp;
    this.cameras.main.flash(400, 120, 0, 0);
    const lostText = any ? ' e perdeu os recursos que carregava' : '';
    this.toast(`Um ${animal.def.name.toLowerCase()} te derrubou. Você acordou na vila${lostText}.`, '#ff8a7a');
  }

  private popup(x: number, y: number, text: string, color?: string): void {
    this.events.emit('popup', { x, y, text, color } satisfies PopupEvent);
  }

  // ---------- NPCs ----------

  /** Village centre for spawn distances and compass directions: the central stockpile. */
  private get villageCenter(): { x: number; y: number } {
    const c = this.factions[PLAYER_FACTION].center;
    return { x: c.x + 0.5, y: c.y + 0.5 };
  }

  /** Creates the on-map entity for a housed villager (rival towns, loaded games). */
  private spawnVillagerEntity(data: NpcData, at?: { x: number; y: number }): Npc {
    const home = data.homeId !== null ? this.buildings.list.find((b) => b.id === data.homeId) : undefined;
    const tile = at ?? (home ? { x: home.tx, y: home.ty + BUILDING_DEFS[home.type].size } : this.factions[data.faction].center);
    const npc = new Npc(this, this.map, data, { x: Math.floor(tile.x), y: Math.floor(tile.y) });
    if (home) npc.settleAt(home);
    this.npcs.set(data.id, npc);
    return npc;
  }

  /** Rival towns grow on their own: new houses when beds run short, jobs for the idle. */
  private updateTowns(worldDt: number): void {
    this.townTimer += worldDt;
    if (this.townTimer < DAY_SECONDS / 2) return;
    this.townTimer = 0;
    for (const f of this.factions) {
      if (f.isPlayer || !f.alive) continue;
      const cost = BUILDING_DEFS.house.cost;
      if (this.population.freeBedsOf(f.id) < 2 && f.stock.canAfford(cost)) {
        const spot = findSpot(this.buildings, 'house', f.center, 2, 10, Math.random);
        if (spot && this.territory.canBuild(f.id, spot.x, spot.y, 2)) {
          f.stock.pay(cost);
          this.addBuildingView(this.buildings.place('house', spot.x, spot.y, true, f.id));
          this.territory.recompute(this.buildings.list);
        }
      }
      for (const b of this.buildings.list) {
        if (b.faction !== f.id || !BUILDING_DEFS[b.type].job) continue;
        for (const n of this.population.unemployed(undefined, f.id)) if (!this.population.assign(n, b)) break;
      }
    }
  }

  private updateNpcs(worldDt: number): void {
    if (this.spawner.update(worldDt, this.population.wanderers.length)) this.spawnWanderer();

    for (const f of this.factions) {
      for (const e of updateNeeds(this.population.villagersOf(f.id), f.stock, worldDt)) {
        if (!f.isPlayer) {
          if (e.type === 'died') this.removeVillager(e.npc.id, null);
        } else if (e.type === 'starving') this.toast(`${e.npc.name} está com fome! Falta carne no estoque.`, '#ffb070');
        else this.removeVillager(e.npc.id, `${e.npc.name} morreu de fome.`);
      }
    }
    this.updateTowns(worldDt);

    this.villagerRegen += worldDt;
    const regen = this.villagerRegen >= 30;
    if (regen) this.villagerRegen = 0;
    for (const npc of [...this.npcs.values()]) {
      if (regen && npc.data.hp < VILLAGER_HP && !isStarving(npc.data)) npc.data.hp++;
      const talking = this.talkingTo?.id === npc.data.id;
      npc.update(worldDt, this.npcWorld, talking, talking ? this.player.sprite.x : undefined);
      if (npc.data.role === 'wanderer' && !talking && this.clock.seconds >= npc.data.leavesAt) {
        // Half the time, a rival town with a free bed takes them in.
        const rival = this.factions.find((f) => !f.isPlayer && f.alive && this.population.houseWithBed(f.id));
        const home = rival && Math.random() < 0.5 ? this.population.houseWithBed(rival.id) : undefined;
        if (rival && home) {
          npc.data.role = 'villager';
          npc.data.faction = rival.id;
          npc.data.homeId = home.id;
          npc.becomeVillager(home);
          this.toast(`${npc.data.name} cansou de esperar e foi morar em ${rival.name}.`, '#cfc3a8');
        } else {
          this.npcs.delete(npc.data.id);
          this.population.remove(npc.data.id);
          npc.leave(() => {});
          this.toast(`${npc.data.name} desistiu de esperar e foi embora.`, '#cfc3a8');
        }
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
    this.gainXp(XP.recruit);
    npc.becomeVillager(home);
    this.toast(`${npc.data.name} entrou para a vila!`, '#a8ffa8');
    return true;
  }

  /** All NPC entities (for the minimap). */
  npcList(): Npc[] {
    return [...this.npcs.values()];
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
    this.territory.recompute(this.buildings.list);
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
    if (check.ok && !this.territory.canBuild(PLAYER_FACTION, tx, ty, def.size))
      check = { ok: false, reason: 'Fora do seu território' };
    if (check.ok && !this.stockpile.canAfford(def.cost)) check = { ok: false, reason: 'Recursos insuficientes no estoque' };
    p.check = check;

    const bottom = gridToScreen(tx + def.size, ty + def.size);
    this.ghost.setPosition(bottom.x, bottom.y).setTint(check.ok ? 0xa8ffa8 : 0xff9090);
    this.drawFootprint(tx, ty, def.size, check.ok ? 0x8aff8a : 0xff6060);
  }

  // ---------- interaction ----------

  private updateInteraction(dt: number, moving: boolean): void {
    if (this.talkingTo || this.panelBuilding) {
      this.interaction = null;
      return;
    }

    // People take priority over things.
    const npc = this.inventoryOpen ? null : this.nearestNpc();
    if (npc) {
      this.gatherer.tick(dt, null, false, 1);
      const d = npc.data;
      let text = d.role === 'wanderer' ? `[E] Falar com ${d.name}` : `[E] ${d.name} · ${jobTitle(d, this.buildings)}`;
      if (d.role === 'villager' && d.faction !== PLAYER_FACTION) text = `[E] ${d.name} · ${this.factions[d.faction].name}`;
      this.interaction = { x: npc.sprite.x, y: npc.sprite.y - npc.sprite.height - 6, text, progress: null };
      if (Phaser.Input.Keyboard.JustDown(this.keys.E)) {
        this.talkingTo = d;
        this.player.face(npc.sprite.x);
        this.events.emit('talk', d);
      }
      return;
    }

    const carcass = this.inventoryOpen ? null : this.wildlife.nearestCarcass(this.player.gx, this.player.gy, 1.2);
    if (carcass) {
      this.gatherer.tick(dt, null, false, 1);
      const s = carcass.sprite;
      const room = this.inventory.space('meat');
      const name = carcass.def.name.toLowerCase();
      const text = room > 0 ? `[E] Pegar carne de ${name} (${carcass.data.meat})` : 'Peso máximo! Leve ao estoque';
      this.interaction = { x: s.x, y: s.y - 14, text, progress: null };
      if (room > 0 && Phaser.Input.Keyboard.JustDown(this.keys.E)) {
        const n = this.wildlife.takeMeat(carcass.data.id, room);
        this.inventory.add('meat', n);
        this.popup(s.x, s.y - 14, `+${n} Carne`);
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
    const tool = this.selectedTool(def.tool);
    const full = this.inventory.space(def.resource) <= 0;
    const missingTool = def.needsTool && !tool;
    const active = this.keys.E.isDown && !moving && !full && !missingTool;
    if (active) this.player.face(anchorX);

    const seconds = def.secondsPerUnit / (this.stats.gatherSpeed * (tool ? ITEM_DEFS[tool.item].tool!.speed : 1));
    if (this.gatherer.tick(dt, target, active, seconds)) this.harvest(target, tool?.slot);

    const left = this.nodes.remainingAt(target);
    const toolName = tool ? ` · ${ITEM_DEFS[tool.item].label}` : '';
    let text = `[segure E] ${def.verb} ${def.name} (${left})${toolName}`;
    if (full) text = 'Peso máximo! Leve ao estoque';
    if (missingTool) text = `Precisa de uma picareta na hotbar (C: criar)`;
    this.interaction = { x: anchorX, y: anchorY, text, progress: active ? this.gatherer.progress / seconds : null };
  }

  /** The tool of `type` in the selected hotbar slot, if any. */
  private selectedTool(type: ToolType): { item: ItemId; slot: number } | null {
    const s = this.inventory.slots[this.selectedHotbar];
    if (!s || ITEM_DEFS[s.item].tool?.type !== type) return null;
    return { item: s.item, slot: this.selectedHotbar };
  }

  /** Wears the tool in `slot`; announces it if it breaks. */
  private wearTool(slot: number): void {
    const s = this.inventory.slots[slot];
    if (!s) return;
    const name = ITEM_DEFS[s.item].label;
    if (this.inventory.wear(slot)) this.toast(`${name} quebrou!`, '#ffb070');
  }

  /** Grants XP and announces level-ups (max HP and carry weight grow). */
  gainXp(amount: number): void {
    const levels = this.stats.addXp(amount);
    this.inventory.maxWeight = this.stats.carryWeight;
    if (levels > 0) {
      this.toast(
        `Nível ${this.stats.level}! +${PER_LEVEL.hp} de vida máxima, +${PER_LEVEL.carry} kg de carga, coleta mais rápida.`,
        '#ffe08a',
      );
    }
  }

  /** Crafts a recipe (from the C menu). Returns the result for the UI. */
  craftItem(recipe: Recipe): CraftCheck {
    const result = craft(recipe, this.inventory, this.stockpile);
    const p = this.player.sprite;
    if (result === 'ok') {
      this.popup(p.x, p.y - p.height, `+ ${ITEM_DEFS[recipe.item].label}`, '#ffe08a');
      this.gainXp(XP.craft);
    } else {
      this.popup(p.x, p.y - p.height, result === 'cost' ? 'Faltam materiais' : 'Sem espaço no inventário', '#ff8a7a');
    }
    return result;
  }

  private interactWithBuilding(b: Building, dt: number, moving: boolean): void {
    const def = BUILDING_DEFS[b.type];
    const view = this.buildingViews.get(b.id)!;
    const x = view.img.x;
    const y = view.img.y - view.img.height - 2;
    if (b.faction !== PLAYER_FACTION) {
      this.drawFootprint(b.tx, b.ty, def.size, this.factions[b.faction].color);
      this.interaction = { x, y, text: `${this.factions[b.faction].name} · ${def.name}`, progress: null };
      return;
    }
    this.drawFootprint(b.tx, b.ty, def.size, 0xffe08a);

    if (!b.built) {
      const active = this.keys.E.isDown && !moving;
      if (active) {
        this.player.face(x);
        if (this.buildings.work(b, dt)) {
          this.gainXp(XP.build);
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

    let text = `${def.name}: ${def.description}`;
    if (def.job) text = `[E] ${def.name} (${this.population.workers(b.id).length}/${def.job.slots} trabalhando)`;
    else if (b.type === 'house') text = `[E] ${def.name} (${this.population.residents(b.id).length}/${BEDS_PER_HOUSE} moradores)`;
    this.interaction = { x, y, text, progress: null };
    if ((def.job || b.type === 'house') && Phaser.Input.Keyboard.JustDown(this.keys.E)) {
      this.panelBuilding = b;
      this.events.emit('building', b);
    }
  }

  /** Why a villager isn't working (e.g. no resources nearby), or null. */
  npcStatus(id: number): string | null {
    return this.npcs.get(id)?.status ?? null;
  }

  /** Called by the building panel when it closes. */
  closeBuildingPanel(): void {
    this.panelBuilding = null;
  }

  /** A worker takes one unit from node `i` (sprites updated). */
  private workerHarvest(i: number): Resource | null {
    const result = this.nodes.harvest(i);
    if (!result) return null;
    const img = this.objectImages.get(i);
    if (img) this.tweens.add({ targets: img, x: img.x + 1, duration: 40, yoyo: true, repeat: 1 });
    if (result.depleted) this.replaceObjectImage(i);
    return result.resource;
  }

  private harvest(i: number, toolSlot?: number): void {
    const result = this.nodes.harvest(i);
    if (!result) return;
    this.inventory.add(result.resource);
    if (toolSlot !== undefined) this.wearTool(toolSlot);
    this.gainXp(XP.gather);

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
    this.drawGround();
    for (let i = 0; i < m.w * m.h; i++) this.replaceObjectImage(i);
  }

  /**
   * Bakes the ground into render textures of CHUNK×CHUNK tiles, so the 16k ground tiles cost a
   * few dozen draws per frame instead of one each.
   */
  private drawGround(): void {
    const m = this.map;
    const CHUNK = 16;
    const pad = 2;
    for (let y0 = 0; y0 < m.h; y0 += CHUNK) {
      for (let x0 = 0; x0 < m.w; x0 += CHUNK) {
        const minX = gridToScreen(x0, y0 + CHUNK).x - pad;
        const minY = gridToScreen(x0, y0).y - pad;
        const rt = this.add
          .renderTexture(minX, minY, CHUNK * TILE_W + pad * 2, CHUNK * TILE_H + pad * 2)
          .setOrigin(0)
          .setDepth(GROUND_DEPTH);
        rt.beginDraw();
        for (let ty = y0; ty < Math.min(m.h, y0 + CHUNK); ty++) {
          for (let tx = x0; tx < Math.min(m.w, x0 + CHUNK); tx++) {
            const i = tileIndex(m, tx, ty);
            const c = gridToScreen(tx + 0.5, ty + 0.5);
            rt.batchDrawFrame(
              `${GROUND_KEY[m.ground[i]]}_${m.variant[i]}`,
              undefined,
              c.x - TILE_W / 2 - minX,
              c.y - TILE_H / 2 - minY,
            );
          }
        }
        rt.endDraw();
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
    if (b.built && b.type === 'stockpile') {
      // Each village hall flies its faction's banner.
      view.sign = this.add
        .image(view.img.x + 6, view.img.y - view.img.height + 2, 'flag')
        .setOrigin(0.2, 1)
        .setTint(this.factions[b.faction]?.color ?? 0xffffff);
    } else if (b.built && def.sign) {
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
