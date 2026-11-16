import Phaser from 'phaser';
import { sound } from '../audio/sound';
import {
  ADULT_AGE,
  ATTACK_COOLDOWN,
  AUTOSAVE_SECONDS,
  BEDS_PER_HOUSE,
  BUILDER_RANGE,
  BUILDER_RATE,
  CLAIM_NEAR_HOME,
  COMPANION_MAX,
  DAY_SECONDS,
  DEFAULT_ZOOM_INDEX,
  FAST_FORWARD,
  HOTBAR_SLOTS,
  INTERACT_REACH,
  INVENTORY_SLOTS,
  MAX_CARRY_WEIGHT,
  MEAT_HEAL,
  NPC_REACH,
  PLAYER_HUNGER_PER_DAY,
  PLAYER_RADIUS,
  QUICK_ORDER_RADIUS,
  RAID_INTERVAL,
  REPAIR_RATE,
  START_HOUR,
  TILE_H,
  TILE_W,
  WANDERER_STAY,
  ZOOM_LEVELS,
} from '../config';
import type { Animal, Human } from '../entities/Animal';
import { Npc, type NpcWorld, type Target } from '../entities/Npc';
import { Player } from '../entities/Player';
import {
  BUILD_MENU,
  BUILDING_DEFS,
  type Building,
  Buildings,
  type BuildingType,
  canRelocate,
  demolitionRefund,
  type PlaceCheck,
  relocationCost,
} from '../game/buildings';
import { type CraftCheck, craft } from '../game/crafting';
import {
  ALLIANCE_MIN,
  Diplomacy,
  GIFT_COST,
  giftValue,
  MISSION_LABEL,
  type MissionKind,
  missionChance,
  type Proposal,
} from '../game/diplomacy';
import { DROP_LIFETIME, type Drop, Drops, takeFromSlot } from '../game/drops';
import {
  COLONY_MIN_DISTANCE,
  COLONY_NAMES,
  COLONY_START,
  colonySiteOk,
  createColony,
  createFactions,
  type Faction,
  PLAYER_FACTION,
  policyAccepts,
  realmOf,
  type TradePolicy,
} from '../game/factions';
import { ageOf, Families, fullName, isAdult, PLAYER_ID } from '../game/families';
import {
  autoPlot,
  clearPlot,
  type FarmTask,
  FIELD_OBJS,
  harvestCrop,
  nextFarmTask,
  plant,
  plotRect,
  plotTileProblem,
  rectTiles,
  ripen,
  setPlot,
} from '../game/farms';
import { Gatherer, NODE_DEFS, nearestTile, ResourceNodes } from '../game/gathering';
import {
  ARMORS,
  absorb,
  autoSupply,
  basicTool,
  grantStarterTools,
  planRecurring,
  QUEUE_MAX,
  recipeOf,
  smithyCanWork,
  tickSmithy,
  toolForWorker,
  unqueue,
  WEAPONS,
  wearWorkplaceTool,
  workplaceTools,
} from '../game/gear';
import { Inventory, RESOURCE_LABEL, RESOURCES, type Resource } from '../game/inventory';
import { ITEM_DEFS, type ItemId, maxDurability, RECIPES, type Recipe, type ToolId, type ToolType } from '../game/items';
import { foodDays, isStarving, updateNeeds, updateNeedsFrom } from '../game/needs';
import {
  compass,
  generateWanderer,
  jobTitle,
  maxHpOf,
  type NpcData,
  Population,
  payFrom,
  pickSpawnTile,
  productivity,
  roleLabel,
  describeCost as summarizeCost,
  WandererSpawner,
} from '../game/npcs';
import { type Command, type Stance, takesOrders } from '../game/orders';
import { inAimCone, PER_LEVEL, PlayerStats, XP } from '../game/player';
import { readSave, SAVE_VERSION, type SaveData, type SlotId, slotName, writeSave } from '../game/save';
import { SlotInventory } from '../game/slots';
import { buildingStorage, type Storage, villageStorage } from '../game/storage';
import { Territory } from '../game/territory';
import { GameClock } from '../game/time';
import { buildRoadNetwork, findSpot, foundTown, JOB_PRIORITY, populateTown, staffInOrder } from '../game/towns';
import {
  executeTrade,
  GOODS,
  type Good,
  type Goods,
  goodLabel,
  isToolGood,
  type Market,
  planAiCaravan,
  quoteBuy,
  quoteSell,
  summarize,
  TOOL_GOODS,
  targetStock,
} from '../game/trade';
import { createPlaceholderTextures } from '../gfx/textures';
import { gridToScreen, screenToGrid } from '../iso';
import { Wildlife } from '../systems/Wildlife';
import { Ground, generateMap, inBounds, isWalkable, Obj, tileCenter, tileIndex, type WorldMap } from '../world/map';

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
  [Obj.Road]: 'road',
  [Obj.Grass]: 'grass_tuft',
  [Obj.Field]: 'field',
  [Obj.Crop]: 'crop',
  [Obj.CropRipe]: 'crop_ripe',
};

const BUILDING_KEY: Record<BuildingType, string> = {
  stockpile: 'stockpile',
  depot: 'stockpile',
  house: 'bld_house',
  lumberjack: 'bld_lumberjack',
  quarry: 'bld_quarry',
  mine: 'bld_mine',
  hunter: 'bld_hunter',
  palisade: 'bld_palisade',
  gate: 'bld_gate',
  tower: 'bld_tower',
  barracks: 'bld_barracks',
  embassy: 'bld_embassy',
  road: 'road',
  market: 'bld_market',
  smithy: 'bld_smithy',
  colony: 'stockpile',
  home: 'bld_home',
  claim: 'stockpile',
  farm: 'bld_farm',
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

/** Scene start data: a save to load (and the slot it came from), or a fresh game. */
export interface WorldInit {
  save?: SaveData | null;
  fresh?: boolean;
  slot?: SlotId;
}

/** A diplomat's trip: going → talking → returning. */
export interface Mission {
  diplomatId: number;
  /** Diplomacy errand, a trade caravan led by a merchant, or fetching a wanderer to live in the village. */
  kind: MissionKind | 'trade' | 'recruit';
  /** Recruiting: the wanderer's id. */
  wanderer?: number;
  target: number;
  phase: 'going' | 'talking' | 'returning';
  timer: number;
  /** Owner village (the player for diplomacy; any village for caravans). */
  faction?: number;
  /** Caravans: goods carried, shopping list, purse, and what was bought. */
  cargo?: Goods;
  shopping?: Goods;
  coins?: number;
  bought?: Goods;
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

const isInteractable = (o: Obj) => o === Obj.Building || o === Obj.Gate || o === Obj.CropRipe || NODE_DEFS[o] !== undefined;

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
  /** Set by UIScene while a full-screen panel (map, management) is open: freezes the player. */
  modalOpen = false;
  factions!: Faction[];
  territory!: Territory;
  private townTimer = 0;
  families!: Families;
  diplomacy!: Diplomacy;
  /** Diplomatic missions in progress, by diplomat id. */
  missions = new Map<number, Mission>();
  private diploTimer = 0;
  private raidTimers = new Map<string, number>();
  private tradeTimer = 0;
  /** Standing orders for merchants who visit your market. */
  tradePolicy: TradePolicy = { sellAbove: {}, buyUpTo: {} };
  private towerCd = new Map<number, number>();
  private buildingFx!: Phaser.GameObjects.Graphics;
  private repairAcc = 0;
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
    this.modalOpen = false;
    this.demolishing = false;
    this.demolishHint = null;
    this.demolishPick = null;
    this.demolishArmed = null;
    this.selectedHotbar = 0;
    this.fastForward = false;
    this.attackCd = 0;
    this.villagerRegen = 0;
    this.autosaveTimer = 0;
    this.battleTimer = 0;
    this.drops = new Drops();
    this.farmReserved = new Map();
    this.plotFarm = null;
    this.plotStart = null;
    this.commandPick = null;
    this.hungerStage = 0;
    this.dropViews = new Map();
    this.placeTile = { x: 0, y: 0 };
    this.zoomIndex = DEFAULT_ZOOM_INDEX;
  }

  create(): void {
    createPlaceholderTextures(this);
    const save = this.initData.fresh ? null : (this.initData.save ?? null);
    this.currentSlot = save ? (this.initData.slot ?? null) : null;
    this.map = generateMap();
    if (save) {
      const generated = [...this.map.objects];
      this.map.objects.splice(0, this.map.objects.length, ...save.objects);
      // Saves from before farming have no grass tufts: sprinkle them where the map would have them.
      if (!save.objects.includes(Obj.Grass))
        generated.forEach((o, i) => {
          if (o === Obj.Grass && this.map.objects[i] === Obj.None) this.map.objects[i] = Obj.Grass;
        });
    }
    this.nodes = new ResourceNodes(this.map);
    this.buildings = new Buildings(this.map);
    this.population = new Population(this.buildings);
    this.population.now = () => this.clock.seconds;
    this.families = new Families(this.population);
    this.diplomacy = new Diplomacy();
    this.missions = new Map();
    this.raidTimers = new Map();
    this.tradeTimer = 0;
    this.tradePolicy = { sellAbove: {}, buyUpTo: {} };
    this.diploTimer = 0;
    this.factions = createFactions(this.map.sites, this.stockpile);
    // Colonies are extra factions after the rivals (saved with their name and founder).
    for (const sf of save?.factions ?? [])
      if (sf.parent !== undefined && sf.id === this.factions.length)
        this.factions.push(createColony(sf.id, sf.center, sf.name ?? COLONY_NAMES[0], sf.parent));
    this.diplomacy.realm = (id) => realmOf(this.factions, id);
    this.territory = new Territory(this.map);
    this.npcWorld = {
      map: this.map,
      buildings: this.buildings,
      isNight: () => this.clock.isNight,
      harvest: (i) => this.workerHarvest(i),
      deposit: (f, r, n) => this.factions[f]?.stock.add(r, n),
      threat: (gx, gy) => this.wildlife.threat(gx, gy),
      findPrey: (cx, cy, r, f) => this.wildlife.findPrey(cx, cy, r, (x, y) => this.mayTake(f, x, y)),
      prey: (id) => this.wildlife.prey(id),
      shoot: (from, id, dmg) => this.wildlife.shoot(from, id, dmg),
      findCarcass: (cx, cy, r, f) => this.wildlife.findCarcass(cx, cy, r, (x, y) => this.mayTake(f, x, y)),
      takeMeat: (id, max, faction) => {
        const n = this.wildlife.takeMeat(id, max);
        // Hunters skin their prey: the leather goes straight to their village's stock.
        if (faction !== undefined) this.factions[faction]?.stock.add('leather', this.wildlife.takeLeather(id, 99));
        return n;
      },
      toolFor: (npc) => {
        const b = this.buildings.list.find((x) => x.id === npc.data.jobId);
        if (!b) return 'none';
        const index = this.population
          .workers(b.id)
          .map((n) => n.id)
          .sort((a, c) => a - c)
          .indexOf(npc.data.id);
        return toolForWorker(b, Math.max(0, index));
      },
      useTool: (npc, tool) => {
        const b = this.buildings.list.find((x) => x.id === npc.data.jobId);
        if (b && wearWorkplaceTool(b, tool) && this.isMine(b.faction))
          this.toast(`${ITEM_DEFS[tool].label} de ${BUILDING_DEFS[b.type].name} se gastou.`, '#ffb070');
      },
      smithyBusy: (b) => smithyCanWork(b, villageStorage(this.factions[b.faction])),
      findHostile: (f, gx, gy, r, any) => this.findHostile(f, gx, gy, r, any),
      atWar: (a, b) => this.atWar(a, b),
      raidTarget: (npc, target) => this.raidTarget(npc, target),
      attackBuilding: (npc, b, dmg) => this.damageBuilding(b, dmg, npc.data.faction),
      mission: (id) => this.missions.get(id) ?? null,
      missionArrived: (id) => {
        const m = this.missions.get(id);
        if (m?.kind === 'recruit') this.recruitArrived(m);
        else if (m) {
          m.phase = 'talking';
          m.timer = 6;
        }
      },
      missionPoint: (id) => this.missionPoint(id),
      missionDone: (id) => this.finishMission(id),
      missionFailed: (id) => {
        const n = this.population.person(id);
        const quiet = this.missions.get(id)?.kind === 'recruit';
        this.missions.delete(id);
        if (quiet) return;
        this.toast(`${n?.name ?? 'O diplomata'} não encontrou caminho até a outra vila.`, '#ffb070');
      },
      factionCenter: (f) => this.factions[f].center,
      playerAt: () => ({ x: this.player.gx, y: this.player.gy }),
      mayTake: (f, x, y) => this.mayTake(f, x, y),
      buildSite: (npc) => this.buildSiteFor(npc),
      farmTask: (npc, farm) => this.farmTaskFor(npc, farm),
      farmDo: (npc, farm, task) => this.farmDo(npc, farm, task),
      buildWork: (npc, b, dt) => {
        if (!this.buildings.work(b, dt * BUILDER_RATE)) return;
        this.refreshBuildingView(b);
        if (this.isMine(b.faction))
          this.toast(`${BUILDING_DEFS[b.type].name} pronta (${npc.data.name} terminou a obra).`, '#ffe08a');
      },
      strike: (from, target, dmg) =>
        this.strikeTarget(target, dmg, `um soldado de ${this.factions[from.data.faction].name}`, {
          kind: 'npc',
          id: from.data.id,
          gx: from.gx,
          gy: from.gy,
        }),
    };

    if (save) {
      this.nodes.restore(save.nodes);
      this.buildings.restore(save.buildings);
      // Saves from before M21: workplaces get the tools their jobs now need.
      if (save.version < 7) for (const b of this.buildings.list) grantStarterTools(b);
    }
    this.drawMap();

    if (save) for (const b of this.buildings.list) this.addBuildingView(b);
    else {
      // You start with nothing: no hall, no land, no coins. Your village comes from claiming land (B).
      const sx = Math.floor(this.map.spawn.x);
      const sy = Math.floor(this.map.spawn.y);
      this.factions[0].center = { x: sx + 2, y: sy - 1 };
      this.factions[0].coins = 0;
      for (const f of this.factions)
        if (!f.isPlayer)
          for (const b of foundTown(this.buildings, f, Math.random)) {
            grantStarterTools(b);
            if (b.type === 'barracks') b.storage.spear = 2;
            this.addBuildingView(b);
          }
      for (const i of buildRoadNetwork(
        this.map,
        this.factions.map((f) => f.center),
      ))
        this.replaceObjectImage(i);
    }
    this.territory.recompute(this.buildings.list);

    this.selection = this.add.graphics().setDepth(GROUND_DEPTH + 1);
    this.buildingFx = this.add.graphics().setDepth(900_000);
    this.towerCd = new Map();
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
      hitBuildingAt: (tx, ty, dmg) => this.hitBuildingAt(tx, ty, dmg),
      popup: (x, y, text, color) => this.popup(x, y, text, color),
    });
    if (save) this.applySave(save);
    else {
      this.wildlife.populate();
      this.diplomacy.init(
        this.factions.map((f) => f.id),
        Math.random,
      );
      for (const f of this.factions) {
        if (f.isPlayer) continue;
        f.stock.add('wood', 40);
        f.stock.add('stone', 25);
        f.stock.add('meat', 60);
        // Farms need land claimed first (territory is computed by now): planting area and seeds.
        for (const b of this.buildings.list) if (b.faction === f.id && b.type === 'farm') this.setupAiFarm(b);
        f.recruitPolicy = 'all';
        for (const n of populateTown(this.population, this.buildings, f, Math.random, 10, this.clock.seconds))
          this.spawnVillagerEntity(n);
      }
    }

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

  /** The manual slot this game was loaded from or last saved to (the save menu suggests it). */
  currentSlot: SlotId | null = null;

  /** Writes the game to a slot ('auto' for autosaves). `quiet` skips the toast. */
  saveGame(quiet = false, slot: SlotId = 'auto'): boolean {
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
        coins: f.coins,
        tools: { ...f.tools },
        ...(f.parent !== undefined ? { name: f.name, parent: f.parent } : {}),
        ...(f.recruitPolicy ? { recruitPolicy: f.recruitPolicy } : {}),
      })),
      inventory: this.inventory.slots.map((s) => (s ? { ...s } : null)),
      armor: this.inventory.armor ? { ...this.inventory.armor } : null,
      selectedHotbar: this.selectedHotbar,
      player: { gx: this.player.gx, gy: this.player.gy, ...this.stats.snapshot() },
      population: this.population.snapshot(),
      families: { affinity: { ...this.families.affinity }, chattedOn: { ...this.families.chattedOn } },
      diplomacy: this.diplomacy.snapshot(),
      missions: [...this.missions.values()].map((m) => structuredClone(m)),
      tradePolicy: structuredClone(this.tradePolicy),
      npcPositions: [...this.npcs.values()].map((n) => [n.data.id, n.gx, n.gy]),
      animals: this.wildlife.snapshot(),
      drops: this.drops.snapshot(),
    };
    const ok = writeSave(data, slot);
    if (ok && slot !== 'auto') this.currentSlot = slot;
    if (!quiet)
      this.toast(ok ? `Jogo salvo (${slotName(slot)}).` : 'Não foi possível salvar neste navegador.', ok ? '#a8ffa8' : '#ff8a7a');
    return ok;
  }

  /** Restarts the world from a slot. */
  loadGame(slot: SlotId = 'auto'): boolean {
    const save = readSave(slot);
    if (!save) return false;
    this.scene.restart({ save, slot } satisfies WorldInit);
    return true;
  }

  /** Starts over with nothing (saved slots are kept). */
  newGame(): void {
    this.scene.restart({ fresh: true } satisfies WorldInit);
  }

  /** Back to the title screen (the game is autosaved first). */
  toTitle(): void {
    this.saveGame(true);
    this.scene.stop('UI');
    this.scene.start('Title');
  }

  private applySave(save: SaveData): void {
    this.clock.seconds = save.clock;
    Object.assign(this.stockpile.items, save.stockpile);
    save.inventory.forEach((s, i) => {
      if (i < this.inventory.slots.length) this.inventory.slots[i] = s ? { ...s } : null;
    });
    if (save.armor !== undefined) this.inventory.armor = save.armor ? { ...save.armor } : null;
    else this.equipBestArmor(); // saves from before the armour slot
    this.selectedHotbar = save.selectedHotbar;
    this.stats.restore(save.player);
    this.inventory.maxWeight = this.stats.carryWeight;
    this.player.gx = save.player.gx;
    this.player.gy = save.player.gy;
    this.population.restore(save.population);
    this.families.affinity = { ...save.families.affinity };
    this.families.chattedOn = { ...save.families.chattedOn };
    this.diplomacy.restore(save.diplomacy);
    for (const m of save.missions) this.missions.set(m.diplomatId, structuredClone(m));
    this.tradePolicy = structuredClone(save.tradePolicy);
    const pos = new Map(save.npcPositions.map(([id, x, y]) => [id, { x, y }]));
    for (const data of this.population.npcs) this.spawnVillagerEntity(data, pos.get(data.id) ?? this.villageCenter);
    this.wildlife.restore(save.animals);
    this.drops.restore(save.drops);
    for (const d of this.drops.list) this.addDropView(d);
    for (const sf of save.factions) {
      const f = this.factions[sf.id];
      if (!f) continue;
      if (f.id !== PLAYER_FACTION) Object.assign(f.stock.items, sf.stock);
      f.alive = sf.alive;
      f.rulerId = sf.rulerId;
      f.coins = sf.coins;
      f.tools = { ...sf.tools };
      // Rival villages recruit everyone (saves from before diplomats recruited, too).
      f.recruitPolicy = sf.recruitPolicy ?? (f.isPlayer ? undefined : 'all');
      f.center = sf.center;
    }
    this.territory.recompute(this.buildings.list);
  }

  /** Every AUTOSAVE_SECONDS of real play, the game is saved to the Autosave slot (also when the page closes). */
  private autosave(dt: number): void {
    this.autosaveTimer += dt;
    if (this.autosaveTimer < AUTOSAVE_SECONDS) return;
    this.autosaveTimer = 0;
    if (this.saveGame(true)) this.toast('Salvo automaticamente (Autosave).', '#8a9a7a');
  }

  update(_time: number, deltaMs: number): void {
    const k = this.keys;
    const frozen = this.inventoryOpen || this.modalOpen || this.talkingTo !== null || this.panelBuilding !== null;
    const x = frozen ? 0 : (k.D.isDown || k.RIGHT.isDown ? 1 : 0) - (k.A.isDown || k.LEFT.isDown ? 1 : 0);
    const y = frozen ? 0 : (k.S.isDown || k.DOWN.isDown ? 1 : 0) - (k.W.isDown || k.UP.isDown ? 1 : 0);
    // Clamp huge frame gaps (e.g. tab switch) so the player never tunnels through walls.
    const dt = Math.min(deltaMs, 50) / 1000;

    // World time (clock + regrowth) can be fast-forwarded; the player always moves in real time.
    this.fastForward = k.T.isDown;
    const worldDt = dt * (this.fastForward ? FAST_FORWARD : 1);
    this.clock.advance(worldDt);
    for (const i of this.nodes.update(worldDt, (t) => !this.playerOverlapsTile(t))) this.replaceObjectImage(i);

    const aim = frozen ? undefined : this.aimPoint();
    this.player.update(dt, { x, y, run: k.SHIFT.isDown, aimX: aim?.x });
    const heldItem = this.inventory.slots[this.selectedHotbar]?.item;
    this.player.hold(heldItem && ITEM_DEFS[heldItem].tool ? heldItem : null);
    if (this.stats.update(worldDt) > 0) {
      const p = this.player.sprite;
      this.popup(p.x, p.y - p.height, '-1 ♥ fome', '#ff8a7a');
      if (this.stats.hp <= 0) this.knockOut('a fome');
    }
    this.hungerNotice();
    this.wildlife.update(worldDt);
    this.updateNpcs(worldDt);
    this.attackCd -= dt;
    if (!frozen && !this.placement && Phaser.Input.Keyboard.JustDown(k.SPACE)) this.attack();
    if (!frozen && Phaser.Input.Keyboard.JustDown(k.F)) this.eat();
    this.selection.clear();
    if (this.demolishing) this.updateDemolish();
    else if (this.movePicking) this.updateMovePick();
    else if (this.plotFarm) this.updatePlot();
    else if (this.commandPick) this.updateCommandPick();
    else if (this.placement) this.updatePlacement();
    else this.updateInteraction(dt, x !== 0 || y !== 0);
    this.updateDefenses(worldDt);
    this.updateFarms(worldDt);
    for (const d of this.drops.expire(this.clock.seconds)) this.removeDropView(d);
    this.drawBuildingHealth();
    this.sortBuildingsAroundPlayer();
    this.fadeObjectsInFrontOfPlayer();
    this.autosave(dt);
    this.updateMusic(dt);
  }

  /** Time to the next hammer blow while you build. */
  private hammer = 0;

  /** Seconds left of "battle" mood (set by fighting; enemies nearby keep it up). */
  private battleTimer = 0;
  private battleCheck = 0;

  /** Battle music while you fight or enemies at war are near; otherwise day or night. */
  private updateMusic(dt: number): void {
    this.battleTimer = Math.max(0, this.battleTimer - dt);
    this.battleCheck -= dt;
    if (this.battleCheck <= 0) {
      this.battleCheck = 1;
      const t = this.findHostile(PLAYER_FACTION, this.player.gx, this.player.gy, 10);
      if (t && t.kind !== 'animal') this.battleTimer = Math.max(this.battleTimer, 6);
    }
    sound.setMood(this.battleTimer > 0 ? 'battle' : this.clock.isNight ? 'night' : 'day');
    sound.update(dt);
  }

  // ---------- combat ----------

  /** People animals can see: the player and every villager. */
  private humans(): Human[] {
    const list: Human[] = [{ kind: 'player', id: 0, gx: this.player.gx, gy: this.player.gy }];
    for (const n of this.npcs.values())
      if (n.data.role !== 'wanderer' && !n.indoors) list.push({ kind: 'npc', id: n.data.id, gx: n.gx, gy: n.gy });
    return list;
  }

  /** Damage the player deals with a melee swing. Weapons raise it (crafting). */
  playerDamage(): number {
    const s = this.inventory.slots[this.selectedHotbar];
    return (s && ITEM_DEFS[s.item].tool?.damage) || 1;
  }

  /** The mouse position in world (screen-space) coordinates. */
  aimPoint(): { x: number; y: number } {
    const p = this.input.activePointer;
    const v = this.cameras.main.getWorldPoint(p.x, p.y);
    return { x: v.x, y: v.y };
  }

  /** Left click on the world: swing toward the mouse (when no panel or build mode is active). */
  clickAttack(): void {
    const frozen = this.inventoryOpen || this.modalOpen || this.talkingTo !== null || this.panelBuilding !== null;
    if (!frozen && !this.placement && !this.demolishing) this.attack();
  }

  private attack(): void {
    if (this.attackCd > 0) return;
    this.attackCd = ATTACK_COOLDOWN;
    const p = this.player.sprite;
    const chest = { x: p.x, y: p.y - 9 };
    const aim = this.aimPoint();
    let ax = aim.x - chest.x;
    let ay = aim.y - chest.y;
    if (Math.hypot(ax, ay) < 1) {
      ax = p.flipX ? -1 : 1;
      ay = 0;
    }
    const len = Math.hypot(ax, ay);
    this.player.face(aim.x);
    this.slash
      .setPosition(chest.x + (ax / len) * 10, chest.y + (ay / len) * 10)
      .setFlipX(false)
      .setRotation(Math.atan2(ay, ax))
      .setVisible(true)
      .setAlpha(1);
    this.tweens.add({ targets: this.slash, alpha: 0, duration: 160, onComplete: () => this.slash.setVisible(false) });
    this.tweens.killTweensOf(this.player.swing);
    this.player.swing.r = -1.1;
    this.tweens.add({
      targets: this.player.swing,
      r: 0.9,
      duration: 120,
      yoyo: true,
      onComplete: () => (this.player.swing.r = 0),
    });
    const held = this.inventory.slots[this.selectedHotbar];
    const reach = (held && ITEM_DEFS[held.item].tool?.reach) || 0;
    const hit = this.wildlife.playerAttack(this.player.gx, this.player.gy, this.playerDamage(), this.humans()[0], reach, (a) =>
      inAimCone(ax, ay, a.sprite.x - p.x, a.sprite.y - p.y),
    );
    sound.play(hit ? 'hit' : 'swing');
    if (hit) {
      if (hit.def.temper !== 'skittish') this.battleTimer = Math.max(this.battleTimer, 8);
      if (held?.durability !== undefined) this.wearTool(this.selectedHotbar);
      if (!hit.alive) this.gainXp(hit.def.hp * XP.killPerHp);
    }
  }

  private onHumanHit(target: Human, damage: number, animal: Animal): void {
    this.hurtHuman(target, damage, `um ${animal.def.name.toLowerCase()}`);
  }

  /** Damage to the player or a villager from `source` (e.g. "um lobo"). */
  private hurtHuman(target: Human, damage: number, source: string): void {
    if (target.kind === 'player') {
      const p = this.player.sprite;
      const armor = this.inventory.armor;
      if (armor) {
        damage = absorb(damage, armor.item as ToolId, Math.random);
        if (this.inventory.wearArmor()) this.toast('Sua armadura se desfez!', '#ffb070');
      }
      this.popup(p.x, p.y - p.height, `-${damage}`, '#ff6a5a');
      sound.play('hurt');
      this.battleTimer = Math.max(this.battleTimer, 10);
      p.setTint(0xff7060);
      this.time.delayedCall(150, () => p.clearTint());
      this.cameras.main.shake(80, 0.004);
      if (damage > 0 && this.stats.hurt(damage)) this.knockOut(source);
      return;
    }
    const npc = this.npcs.get(target.id);
    if (!npc) return;
    damage = absorb(damage, npc.data.armor, Math.random);
    npc.data.hp -= damage;
    npc.sprite.setTint(0xff7060);
    this.time.delayedCall(150, () => npc.sprite.clearTint());
    this.popup(npc.sprite.x, npc.sprite.y - npc.sprite.height, `-${damage}`, '#ff6a5a');
    if (npc.data.hp <= 0) {
      const mine = this.isMine(npc.data.faction);
      this.removeVillager(npc.data.id, mine ? `${npc.data.name} foi morto por ${source}.` : null);
    }
  }

  /** Puts on the best armour in the bag (old saves, where carrying armour was enough). */
  private equipBestArmor(): void {
    let best = -1;
    this.inventory.slots.forEach((s, i) => {
      const a = s ? ITEM_DEFS[s.item].armor : undefined;
      if (a && (best < 0 || a.reduction > ITEM_DEFS[this.inventory.slots[best]!.item].armor!.reduction)) best = i;
    });
    if (best >= 0) this.inventory.equipFrom(best);
  }

  /**
   * May people of `faction` take resources (trees, rocks, game, grass…) on tile (x, y)? Not on
   * another village's land; your colonies count as yours.
   */
  mayTake(faction: number, x: number, y: number): boolean {
    const o = this.territory.ownerAt(Math.floor(x), Math.floor(y));
    return o === -1 || o === faction || (this.isMine(o) && this.isMine(faction));
  }

  /** Whose land a resource stands on, when you may not take it (for the hint), else null. */
  private forbiddenLand(x: number, y: number): string | null {
    if (this.mayTake(PLAYER_FACTION, x, y)) return null;
    return this.factions[this.territory.ownerAt(Math.floor(x), Math.floor(y))]?.name ?? 'outra vila';
  }

  // ---------- gear: smithies, workplace tools, soldiers ----------

  /** Smiths standing at their smithy forge its queue; finished gear lands in the smithy's inventory. */
  private updateSmithies(worldDt: number): void {
    for (const b of this.buildings.list) {
      if (b.type !== 'smithy' || !b.built) continue;
      let workforce = 0;
      for (const n of this.population.workers(b.id)) {
        const npc = this.npcs.get(n.id);
        if (npc?.isAt(b) && !this.clock.isNight) workforce += productivity(n, 'smithing');
      }
      const f = this.factions[b.faction];
      // Recurring production tops the warehouse up to each item's maximum.
      planRecurring(b, (t) => villageStorage(f).have(t));
      const e = tickSmithy(b, workforce, worldDt, villageStorage(f), villageStorage(f));
      if (e?.type === 'made' && f.isPlayer)
        this.toast(`Ferreiro: ${ITEM_DEFS[e.item].label} pronto(a), guardado(a) no estoque.`, '#a8ffa8');
      if (e?.type === 'blocked' && f.isPlayer && !b.blockedNotice) {
        b.blockedNotice = true;
        this.toast(`Ferreiro: faltam materiais para ${ITEM_DEFS[e.item].label}.`, '#ffb070');
      }
      if (e?.type !== 'blocked') b.blockedNotice = false;
    }
  }

  /** Adds an item to a smithy's production queue. */
  queueCraft(b: Building, item: ToolId): void {
    b.queue ??= [];
    if (b.queue.length < QUEUE_MAX) b.queue.push(item);
  }

  /** Removes queue entry `i` (refunding started work). */
  cancelCraft(b: Building, i: number): void {
    unqueue(b, i, villageStorage(this.factions[b.faction]));
  }

  /** Moves accepted tools from the village warehouse into a workplace until every worker has one. */
  stockWorkplace(b: Building): number {
    const job = BUILDING_DEFS[b.type].job;
    const village = villageStorage(this.factions[b.faction]);
    let moved = 0;
    for (const t of job?.tools ?? []) {
      const want = job!.slots - workplaceTools(b).length;
      if (want <= 0) break;
      const k = village.remove(t, Math.min(want, village.have(t)));
      if (k > 0) buildingStorage(b).add(t, k);
      moved += k;
    }
    return moved;
  }

  /** Gives a soldier a weapon or armour (null takes it off). Gear comes from the barracks, then the village. */
  equip(npc: NpcData, slot: 'weapon' | 'armor', item: ToolId | null): boolean {
    const barracks = this.buildings.list.find((x) => x.id === npc.jobId);
    const village = villageStorage(this.factions[npc.faction]);
    const store = barracks ? buildingStorage(barracks) : village;
    if (item) {
      const from = store.have(item) > 0 ? store : village.have(item) > 0 ? village : null;
      if (!from) return false;
      from.remove(item, 1);
    }
    const old = npc[slot];
    if (old) store.add(old, 1);
    npc[slot] = item;
    return true;
  }

  /** Rival towns keep their workplaces tooled and soldiers armed, paying recipe costs from their stock. */
  private supplyTown(f: Faction): void {
    for (const b of this.buildings.list) {
      if (b.faction !== f.id) continue;
      const job = BUILDING_DEFS[b.type].job;
      const t = basicTool(b);
      if (job && t && workplaceTools(b).length < this.population.workers(b.id).length) {
        if ((f.tools[t] ?? 0) > 0) f.tools[t]!--;
        else if (!f.stock.pay(recipeOf(t).cost)) continue;
        b.storage[t] = (b.storage[t] ?? 0) + 1;
      }
    }
    for (const n of this.soldiers(f.id)) {
      if (n.weapon) continue;
      const b = this.buildings.list.find((x) => x.id === n.jobId);
      if (b && (b.storage.spear ?? 0) > 0) b.storage.spear!--;
      else if (!f.stock.pay(recipeOf('spear').cost)) continue;
      n.weapon = 'spear';
    }
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
    if (!this.stats.wantsFood()) {
      this.popup(p.x, p.y - p.height, 'Sem fome', '#cdb98e');
      return;
    }
    if (this.inventory.remove('meat', 1) === 0) {
      this.popup(p.x, p.y - p.height, 'Sem carne na mochila', '#cdb98e');
      return;
    }
    this.stats.eat(MEAT_HEAL);
    sound.play('eat');
    this.popup(p.x, p.y - p.height, `Comeu · +${MEAT_HEAL} ♥`, '#a8ffa8');
  }

  /** Warns once when you get hungry, and again when you start starving. */
  private hungerStage = 0;
  private hungerNotice(): void {
    const stage = this.stats.starving ? 2 : this.stats.hungry ? 1 : 0;
    if (stage > this.hungerStage) {
      if (stage === 1) this.toast('Você está com fome. Coma carne com F (cace animais).', '#ffc060');
      else this.toast('Você está faminto! Sem comer, vai perdendo vida.', '#ff8a7a');
    }
    this.hungerStage = stage;
  }

  /** Sleeps in your house until morning (only at night): full HP, but you wake up hungrier. */
  sleep(): boolean {
    if (!this.clock.isNight) return false;
    const dh = (START_HOUR - this.clock.hour + 24) % 24;
    const dt = (dh / 24) * DAY_SECONDS;
    this.clock.advance(dt);
    this.stats.food = Math.max(0, this.stats.food - (PLAYER_HUNGER_PER_DAY / DAY_SECONDS) * dt * 0.5);
    this.stats.hp = this.stats.maxHp;
    this.cameras.main.fadeIn(800, 0, 0, 0);
    this.toast(`Você dormiu até o amanhecer do dia ${this.clock.day}.`, '#a8c8ff');
    return true;
  }

  /** The player's HP hit zero: wake up at the village, losing carried resources (tools are kept). */
  private knockOut(source: string): void {
    const lost = this.inventory.takeAllResources();
    const any = RESOURCES.some((r) => lost[r] > 0);
    const home = this.myHome();
    const c = this.villageCenter;
    if (home) {
      this.player.gx = home.tx + 1;
      this.player.gy = home.ty + BUILDING_DEFS.home.size + 0.5;
    } else if (this.settled) {
      this.player.gx = c.x - 1;
      this.player.gy = c.y + 1.5;
    }
    this.stats.hp = this.stats.maxHp;
    if (this.stats.food < 25) this.stats.food = 25; // someone gave you a bite
    this.cameras.main.flash(400, 120, 0, 0);
    const lostText = any ? ' e perdeu os recursos que carregava' : '';
    const where = home ? 'em casa' : this.settled ? 'na vila' : 'onde caiu';
    this.toast(`Você foi derrubado por ${source}. Acordou ${where}${lostText}.`, '#ff8a7a');
  }

  /** Are two factions at war? (Diplomacy arrives in milestone 15.) */
  atWar(a: number, b: number): boolean {
    return this.diplomacy.atWar(a, b);
  }

  // ---------- diplomacy & war ----------

  // ---------- diplomats recruiting wanderers ----------

  private recruitTimer = 0;

  /** Where a diplomat on a mission walks to: the wanderer they're fetching, or the other village. */
  private missionPoint(id: number): { x: number; y: number } | null {
    const m = this.missions.get(id);
    if (!m) return null;
    if (m.kind !== 'recruit') return this.factions[m.target].center;
    const w = m.wanderer !== undefined ? this.npcs.get(m.wanderer) : undefined;
    return w && w.data.role === 'wanderer' ? { x: Math.floor(w.gx), y: Math.floor(w.gy) } : null;
  }

  /**
   * Every few seconds, each village whose policy allows it sends a free diplomat to a wanderer near
   * it (if there's a free bed and, for rival villages, food to spare).
   */
  private updateRecruiting(worldDt: number): void {
    this.recruitTimer += worldDt;
    if (this.recruitTimer < 8) return;
    this.recruitTimer = 0;
    const targeted = new Set([...this.missions.values()].filter((m) => m.kind === 'recruit').map((m) => m.wanderer));
    for (const f of this.factions) {
      if (!f.alive || !f.recruitPolicy || f.recruitPolicy === 'none') continue;
      if (f.isPlayer && !this.settled) continue;
      const pending = [...this.missions.values()].filter((m) => m.kind === 'recruit' && m.faction === f.id).length;
      if (this.population.freeBedsOf(f.id) - pending <= 0) continue;
      if (!f.isPlayer && foodDays(this.population.villagersOf(f.id), f.stock) < 2) continue;
      const c = f.center;
      const wanderer = [...this.npcs.values()]
        .filter((w) => w.data.role === 'wanderer' && !targeted.has(w.data.id) && policyAccepts(f.recruitPolicy, w.data.tier))
        .map((w) => ({ w, d: Math.hypot(w.gx - c.x, w.gy - c.y) }))
        .filter((x) => x.d < 45)
        .sort((a, b) => a.d - b.d)[0]?.w;
      if (!wanderer) continue;
      const diplomat = this.buildings.list
        .filter((b) => b.faction === f.id && b.type === 'embassy' && b.built)
        .flatMap((e) => this.population.workers(e.id))
        .find((n) => !this.missions.has(n.id) && this.npcs.has(n.id) && isAdult(n, this.clock.seconds));
      if (!diplomat) continue;
      this.missions.set(diplomat.id, {
        diplomatId: diplomat.id,
        kind: 'recruit',
        target: f.id,
        faction: f.id,
        wanderer: wanderer.data.id,
        phase: 'going',
        timer: 0,
      });
      targeted.add(wanderer.data.id);
      if (f.isPlayer) this.toast(`${diplomat.name} foi convidar ${wanderer.data.name} para morar na vila.`, '#a8c8ff');
    }
  }

  /** The diplomat reached the wanderer: they move into a free bed of the village, if there's still one. */
  private recruitArrived(m: Mission): void {
    m.phase = 'returning';
    const npc = m.wanderer !== undefined ? this.npcs.get(m.wanderer) : undefined;
    const f = this.factions[m.faction ?? m.target];
    const home = this.population.houseWithBed(f.id);
    if (!npc || npc.data.role !== 'wanderer' || !home) return;
    if (this.talkingTo?.id === npc.data.id) this.talkingTo = null;
    npc.data.role = 'villager';
    npc.data.faction = f.id;
    npc.data.homeId = home.id;
    npc.becomeVillager(home);
    if (f.isPlayer) {
      sound.play('recruit');
      this.toast(`${npc.data.name} aceitou o convite e vai morar em ${f.name}!`, '#a8ffa8');
    }
  }

  /** Diplomats (at your embassies) who are free for a mission, best Diplomacia rating first. */
  freeDiplomats(): NpcData[] {
    const embassies = this.buildings.list.filter((b) => b.faction === PLAYER_FACTION && b.type === 'embassy' && b.built);
    return embassies
      .flatMap((e) => this.population.workers(e.id))
      .filter((n) => !this.missions.has(n.id) && this.npcs.has(n.id))
      .sort((a, b) => b.skills.diplomacy - a.skills.diplomacy);
  }

  // ---------- trade ----------

  /** A village's market, as seen by a visiting caravan (the player's follows the trade policy). */
  marketOf(f: Faction): Market {
    const player = f.isPlayer;
    const policy = this.tradePolicy;
    const have = (g: Good) => (isToolGood(g) ? (f.tools[g] ?? 0) : f.stock.items[g]);
    return {
      get coins() {
        return f.coins;
      },
      set coins(v: number) {
        f.coins = v;
      },
      have,
      forSale: (g) => Math.max(0, have(g) - (player ? (policy.sellAbove[g] ?? Infinity) : Math.floor(targetStock(g) * 0.3))),
      wants: (g) => Math.max(0, player ? (policy.buyUpTo[g] ?? 0) - have(g) : targetStock(g) * 2 - have(g)),
      add: (g, n) => {
        if (isToolGood(g)) f.tools[g] = (f.tools[g] ?? 0) + n;
        else f.stock.add(g, n);
      },
      remove: (g, n) => {
        if (isToolGood(g)) f.tools[g] = Math.max(0, (f.tools[g] ?? 0) - n);
        else f.stock.items[g] = Math.max(0, f.stock.items[g] - n);
      },
    };
  }

  /** Free merchants of a village (market workers not travelling), best haggler first. */
  freeMerchants(faction = PLAYER_FACTION): NpcData[] {
    return this.buildings.list
      .filter((b) => b.faction === faction && b.type === 'market' && b.built)
      .flatMap((m) => this.population.workers(m.id))
      .filter((n) => !this.missions.has(n.id) && this.npcs.has(n.id) && isAdult(n, this.clock.seconds))
      .sort((a, b) => b.skills.diplomacy - a.skills.diplomacy);
  }

  hasMarket(faction: number): boolean {
    return this.buildings.list.some((b) => b.faction === faction && b.type === 'market' && b.built);
  }

  /** Sends one of your merchants with `cargo` to sell and money for `shopping`. Returns a message. */
  sendCaravan(target: number, cargo: Goods, shopping: Goods, coins: number): string {
    const m = this.freeMerchants()[0];
    const dest = this.factions[target];
    if (!m) return 'Nenhum mercador livre. Construa um Mercado e designe aldeões.';
    if (!dest?.alive || !this.hasMarket(target)) return 'Essa vila não tem mercado.';
    if (this.atWar(PLAYER_FACTION, target)) return 'Não dá para comerciar com quem está em guerra com você.';
    const home = this.marketOf(this.factions[PLAYER_FACTION]);
    for (const g of GOODS) if ((cargo[g] ?? 0) > home.have(g)) return `Falta ${goodLabel(g)} para a carga.`;
    if (coins > this.factions[PLAYER_FACTION].coins) return 'Moedas insuficientes.';
    if (GOODS.every((g) => !cargo[g]) && GOODS.every((g) => !shopping[g]))
      return 'A caravana vai vazia: escolha o que vender ou comprar.';
    for (const g of GOODS) if (cargo[g]) home.remove(g, cargo[g]!);
    this.factions[PLAYER_FACTION].coins -= coins;
    this.missions.set(m.id, {
      diplomatId: m.id,
      kind: 'trade',
      target,
      phase: 'going',
      timer: 0,
      faction: PLAYER_FACTION,
      cargo: { ...cargo },
      shopping: { ...shopping },
      coins,
    });
    const msg = `A caravana de ${m.name} partiu para ${dest.name}.`;
    this.toast(msg, '#e0b860');
    return msg;
  }

  /** A caravan reached its destination market and trades. */
  private tradeAt(m: Mission, merchant: NpcData): void {
    const dest = this.factions[m.target];
    const owner = m.faction ?? PLAYER_FACTION;
    if (!dest.alive || this.atWar(owner, m.target)) return;
    const r = executeTrade(m.cargo ?? {}, m.shopping ?? {}, m.coins ?? 0, this.marketOf(dest), merchant.skills.diplomacy);
    m.coins = (m.coins ?? 0) + r.earned - r.spent;
    m.bought = r.bought;
    if (m.target === PLAYER_FACTION && (r.earned > 0 || r.spent > 0)) {
      const parts = [];
      if (r.spent > 0) parts.push(`comprou ${summarize(r.bought)} por ${r.spent} moedas`);
      if (r.earned > 0) parts.push(`vendeu ${summarize(r.sold)} por ${r.earned} moedas`);
      this.toast(`Mercadores de ${this.factions[owner].name} ${parts.join(' e ')} no seu mercado.`, '#e0b860');
    }
  }

  /** A diplomat or merchant got home; caravans unload goods and coins. */
  private finishMission(id: number): void {
    const m = this.missions.get(id);
    this.missions.delete(id);
    if (!m || m.kind !== 'trade') return;
    const home = this.factions[m.faction ?? PLAYER_FACTION];
    if (!home.alive) return;
    const market = this.marketOf(home);
    for (const g of GOODS) {
      market.add(g, (m.bought?.[g] ?? 0) + (m.cargo?.[g] ?? 0));
    }
    home.coins += m.coins ?? 0;
    if (home.isPlayer) {
      const got = summarize(m.bought ?? {});
      const back = summarize(m.cargo ?? {});
      this.toast(
        `Caravana de volta de ${this.factions[m.target].name}: ${m.coins ?? 0} moedas${got ? `, trouxe ${got}` : ''}${back ? `, não vendeu ${back}` : ''}.`,
        '#e0b860',
      );
    }
  }

  /** Takes one tool from your market warehouse into your inventory. */
  takeTool(t: ToolId): boolean {
    const f = this.factions[PLAYER_FACTION];
    if ((f.tools[t] ?? 0) <= 0 || this.inventory.space(t) <= 0) return false;
    f.tools[t] = (f.tools[t] ?? 0) - 1;
    this.inventory.add(t, 1);
    return true;
  }

  /** Daily: rival smiths forge tools; rival merchants set out with caravans. */
  private updateTrade(worldDt: number): void {
    this.tradeTimer += worldDt;
    if (this.tradeTimer < DAY_SECONDS / 2) return;
    this.tradeTimer = 0;
    for (const f of this.factions) {
      if (f.isPlayer || !f.alive) continue;
      // Smithing: turn spare iron, stone and wood into tools to sell.
      const totalTools = TOOL_GOODS.reduce((n, t) => n + (f.tools[t] ?? 0), 0);
      if (totalTools < 6) {
        const options = RECIPES.filter((r) => f.stock.canAfford(r.cost));
        const r = options[Math.floor(Math.random() * options.length)];
        if (r && f.stock.items.wood > 15) {
          f.stock.pay(r.cost);
          f.tools[r.item] = (f.tools[r.item] ?? 0) + 1;
        }
      }
      // Caravans to a market at peace.
      const merchant = this.freeMerchants(f.id)[0];
      if (!merchant || Math.random() < 0.4) continue;
      const dests = this.factions.filter((o) => o.id !== f.id && o.alive && this.hasMarket(o.id) && !this.atWar(f.id, o.id));
      const dest = dests[Math.floor(Math.random() * dests.length)];
      if (!dest) continue;
      const home = this.marketOf(f);
      const plan = planAiCaravan(home);
      if (GOODS.every((g) => !plan.cargo[g]) && GOODS.every((g) => !plan.shopping[g])) continue;
      for (const g of GOODS) if (plan.cargo[g]) home.remove(g, plan.cargo[g]!);
      f.coins -= plan.coins;
      this.missions.set(merchant.id, {
        diplomatId: merchant.id,
        kind: 'trade',
        target: dest.id,
        phase: 'going',
        timer: 0,
        faction: f.id,
        ...plan,
      });
      if (dest.isPlayer) this.toast(`Uma caravana de ${f.name} está a caminho do seu mercado.`, '#e0b860');
    }
  }

  /** Your soldiers (Quartel workers). */
  soldiers(faction = PLAYER_FACTION): NpcData[] {
    const barracks = this.buildings.list.filter((b) => b.faction === faction && b.type === 'barracks');
    return barracks.flatMap((b) => this.population.workers(b.id));
  }

  /** Sends the best free diplomat on a mission. Returns a message for the UI. */
  sendMission(kind: MissionKind, target: number): string {
    const d = this.freeDiplomats()[0];
    const f = this.factions[target];
    if (!d) return 'Nenhum diplomata livre. Construa uma Embaixada e designe um aldeão.';
    const rel = this.diplomacy.get(PLAYER_FACTION, target);
    if (kind === 'alliance' && (rel.status !== 'peace' || rel.score < ALLIANCE_MIN))
      return `Precisa de paz e relação de pelo menos +${ALLIANCE_MIN}.`;
    if (kind === 'peace' && rel.status !== 'war') return 'Vocês não estão em guerra.';
    if (kind === 'gift' && !payFrom(GIFT_COST, this.inventory, this.stockpile)) return 'Faltam recursos para o presente.';
    this.missions.set(d.id, { diplomatId: d.id, kind, target, phase: 'going', timer: 0 });
    const msg = `${d.name} partiu para ${f.name}: ${MISSION_LABEL[kind].toLowerCase()}.`;
    this.toast(msg, '#a8c8ff');
    return msg;
  }

  declareWarOn(target: number): void {
    const ids = this.realms();
    for (const e of this.diplomacy.declareWar(PLAYER_FACTION, target, ids, 'declarada por você'))
      if (e.type === 'war') this.announceWar(e.a, e.b);
  }

  /** Orders every healthy soldier of yours to march on `target`. Returns how many went. */
  orderAttack(target: number): number {
    let n = 0;
    for (const s of this.soldiers()) {
      if (s.hp > 3 && isAdult(s, this.clock.seconds)) {
        s.order = { kind: 'raid', target };
        s.command = null;
        n++;
      }
    }
    if (n > 0) this.toast(`${n} soldado(s) marchando contra ${this.factions[target].name}!`, '#ffb070');
    return n;
  }

  recallSoldiers(): void {
    for (const s of this.soldiers()) s.order = null;
    this.toast('Seus soldados estão voltando ao quartel.', '#cdb98e');
  }

  answerProposal(p: Proposal, accept: boolean): void {
    this.diplomacy.answer(p, accept);
    const name = this.factions[p.from].name;
    if (!accept) this.toast(`Você recusou a proposta de ${name}.`, '#cdb98e');
    else this.toast(p.kind === 'alliance' ? `Aliança com ${name}!` : `Paz com ${name}.`, '#a8ffa8');
  }

  private announceWar(a: number, b: number): void {
    this.townTimer = DAY_SECONDS; // villages react (barracks, soldiers) right away
    const fa = this.factions[a];
    const fb = this.factions[b];
    if (b === PLAYER_FACTION) this.toast(`${fa.name} declarou guerra contra você!`, '#ff6a5a');
    else if (a === PLAYER_FACTION) this.toast(`Você está em guerra com ${fb.name}.`, '#ff8a7a');
    else this.toast(`${fa.name} e ${fb.name} entraram em guerra.`, '#ffb070');
  }

  /**
   * What a raiding soldier attacks next in village `target`: a watchtower shooting nearby first,
   * then the nearest building (walls in the way get battered on the route to the hall).
   */
  private raidTarget(npc: Npc, target: number): Building | null {
    let best: Building | null = null;
    let bestD = Infinity;
    for (const b of this.buildings.list) {
      if (b.faction !== target) continue;
      const tower = BUILDING_DEFS[b.type].defense !== undefined;
      const d = Math.hypot(b.tx - npc.gx, b.ty - npc.gy) - (tower && Math.hypot(b.tx - npc.gx, b.ty - npc.gy) < 12 ? 100 : 0);
      if (d < bestD) {
        bestD = d;
        best = b;
      }
    }
    return best;
  }

  /** `winner` takes over `loser`: buildings, villagers and stock change hands. */
  private conquer(loser: number, winner: number): void {
    const lf = this.factions[loser];
    const wf = this.factions[winner];
    for (const b of this.buildings.list) {
      if (b.faction !== loser) continue;
      b.faction = winner;
      b.hp = Math.max(b.hp, Math.round(BUILDING_DEFS[b.type].maxHp / 2));
      if (this.buildingViews.has(b.id)) this.refreshBuildingView(b);
    }
    for (const n of this.population.npcs) {
      if (n.faction === loser && n.role === 'villager') n.faction = winner;
      if (n.order?.target === loser) n.order = null;
    }
    for (const r of RESOURCES) wf.stock.add(r, lf.stock.items[r]);
    lf.alive = false;
    lf.rulerId = null;
    this.diplomacy.forget(loser);
    this.territory.recompute(this.buildings.list);
    if (lf.parent !== undefined && lf.isPlayer) {
      lf.isPlayer = false; // the colony is gone (its land and people now belong to the winner)
      this.toast(`Sua colônia ${lf.name} foi conquistada por ${wf.name}!`, '#ff6a5a');
    } else if (winner === PLAYER_FACTION) {
      this.toast(`Você conquistou ${lf.name}! Os prédios e aldeões de lá agora são seus.`, '#ffe08a');
      if (this.factions.every((f) => f.isPlayer || !f.alive))
        this.toast('Todas as vilas são suas. Você unificou a região!', '#ffe08a');
    } else this.toast(`${wf.name} conquistou ${lf.name}.`, '#ffb070');
  }

  /** A raid reached your hall: they loot a share of the stockpile and leave. */
  private plunder(attacker: number, hall: Building): void {
    const af = this.factions[attacker];
    const taken: string[] = [];
    for (const r of RESOURCES) {
      const n = Math.floor(this.stockpile.items[r] * 0.3);
      if (n <= 0) continue;
      this.stockpile.items[r] -= n;
      af.stock.add(r, n);
      taken.push(`${n} ${RESOURCE_LABEL[r]}`);
    }
    hall.hp = Math.round(BUILDING_DEFS[hall.type].maxHp / 2);
    for (const n of this.population.npcs) if (n.faction === attacker && n.order?.target === PLAYER_FACTION) n.order = null;
    this.toast(`${af.name} saqueou seu estoque${taken.length ? `: ${taken.join(', ')}` : ''}!`, '#ff6a5a');
  }

  private updateDiplomacy(worldDt: number): void {
    // Missions: talks take a few hours, then the outcome.
    for (const m of [...this.missions.values()]) {
      const d = this.population.npcs.find((n) => n.id === m.diplomatId);
      if (!d || !this.factions[m.target].alive || !this.factions[m.faction ?? PLAYER_FACTION].alive) {
        this.missions.delete(m.diplomatId);
        continue;
      }
      if (m.phase !== 'talking') continue;
      m.timer -= worldDt;
      if (m.timer > 0) continue;
      m.phase = 'returning';
      if (m.kind === 'trade') {
        this.tradeAt(m, d);
        continue;
      }
      if (m.kind === 'recruit') continue; // recruiting has no talks
      const f = this.factions[m.target];
      const rel = this.diplomacy.get(PLAYER_FACTION, m.target);
      const rating = d.skills.diplomacy;
      if (m.kind === 'gift') {
        const v = giftValue(rating);
        this.diplomacy.adjust(PLAYER_FACTION, m.target, v);
        this.toast(`${f.name} aceitou o presente de ${d.name} (+${v}).`, '#a8ffa8');
      } else if (Math.random() < missionChance(m.kind, rating, rel.score)) {
        if (m.kind === 'alliance') this.diplomacy.makeAlliance(PLAYER_FACTION, m.target);
        else this.diplomacy.makePeace(PLAYER_FACTION, m.target);
        this.toast(
          m.kind === 'alliance' ? `${d.name} selou uma aliança com ${f.name}!` : `${d.name} negociou a paz com ${f.name}.`,
          '#a8ffa8',
        );
      } else {
        this.diplomacy.adjust(PLAYER_FACTION, m.target, -5);
        this.toast(`${f.name} recusou a proposta de ${d.name}.`, '#ffb070');
      }
    }

    // Once a day: relations drift and the AI decides on wars, peace and alliances.
    this.diploTimer += worldDt;
    if (this.diploTimer >= DAY_SECONDS) {
      this.diploTimer = 0;
      const ids = this.realms().filter((id) => id !== PLAYER_FACTION || this.settled);
      const touching = this.touchingBorders();
      const realmTouch = new Set<string>();
      for (const k of touching) {
        const [x, y] = k.split(':').map((v) => realmOf(this.factions, Number(v)));
        realmTouch.add(`${Math.min(x, y)}:${Math.max(x, y)}`);
      }
      for (const e of this.diplomacy.daily(ids, this.clock.seconds, Math.random, (a, b) =>
        realmTouch.has(`${Math.min(a, b)}:${Math.max(a, b)}`),
      )) {
        if (e.type === 'war') this.announceWar(e.a, e.b);
        else if (e.type === 'proposal') {
          const what = e.proposal.kind === 'alliance' ? 'uma aliança' : 'a paz';
          this.toast(`${this.factions[e.proposal.from].name} propõe ${what}. Responda em V → Diplomacia.`, '#a8c8ff');
        } else if (e.type === 'alliance_broken' && (e.a === 0 || e.b === 0)) {
          this.toast(`A aliança com ${this.factions[e.a === 0 ? e.b : e.a].name} acabou.`, '#ffb070');
        }
      }
    }

    // Villages at war send their soldiers on raids.
    for (const f of this.factions) {
      if (f.isPlayer || !f.alive) continue;
      for (const e of this.factions) {
        if (e.id === f.id || !e.alive || !this.atWar(f.id, e.id)) continue;
        if (e.id === PLAYER_FACTION && !this.settled) continue;
        const k = `${f.id}>${e.id}`;
        const t = (this.raidTimers.get(k) ?? 0) + worldDt;
        this.raidTimers.set(k, t);
        if (t < RAID_INTERVAL) continue;
        this.raidTimers.set(k, 0);
        const ready = this.soldiers(f.id).filter((s) => s.order === null && s.hp > 4 && isAdult(s, this.clock.seconds));
        const go = ready.length > 2 ? ready.slice(0, ready.length - 1) : ready;
        for (const s of go) s.order = { kind: 'raid', target: e.id };
        if (go.length > 0 && e.isPlayer)
          this.toast(`Soldados de ${f.name} estão marchando contra ${e.id === PLAYER_FACTION ? 'sua vila' : e.name}!`, '#ff6a5a');
      }
    }
  }

  /** Pairs of villages whose territories touch ("a:b"), checked once a day. */
  private touchingBorders(): Set<string> {
    const out = new Set<string>();
    const { owner } = this.territory;
    const w = this.map.w;
    for (let i = 0; i < owner.length; i++) {
      const o = owner[i];
      if (o < 0) continue;
      for (const j of [i + 1, i + w]) {
        const p = owner[j];
        if (p >= 0 && p !== o && j < owner.length) out.add(`${Math.min(o, p)}:${Math.max(o, p)}`);
      }
    }
    return out;
  }

  /** Nearest thing hostile to `faction` within `r` of (gx, gy): dangerous animals, or people of a faction at war with it. */
  findHostile(faction: number, gx: number, gy: number, r: number, anyAnimal = false): Target | null {
    let best: Target | null = null;
    let bestD = r;
    const a = anyAnimal ? this.wildlife.nearestAny(gx, gy, r) : this.wildlife.nearestHostile(gx, gy, r);
    if (a) {
      best = { kind: 'animal', id: a.data.id, gx: a.data.gx, gy: a.data.gy };
      bestD = Math.hypot(a.data.gx - gx, a.data.gy - gy);
    }
    for (const n of this.npcs.values()) {
      if (n.data.role === 'wanderer' || n.indoors || !this.atWar(faction, n.data.faction) || this.missions.has(n.data.id))
        continue;
      const d = Math.hypot(n.gx - gx, n.gy - gy);
      if (d < bestD) {
        bestD = d;
        best = { kind: 'npc', id: n.data.id, gx: n.gx, gy: n.gy };
      }
    }
    if (this.atWar(faction, PLAYER_FACTION)) {
      const d = Math.hypot(this.player.gx - gx, this.player.gy - gy);
      if (d < bestD) best = { kind: 'player', id: 0, gx: this.player.gx, gy: this.player.gy };
    }
    return best;
  }

  /** A hit from a soldier (`from`) or a tower on `target`. */
  private strikeTarget(target: Target, damage: number, source: string, from: Human): void {
    if (target.kind === 'animal') this.wildlife.damageAnimal(target.id, damage, from);
    else this.hurtHuman({ kind: target.kind, id: target.id, gx: target.gx, gy: target.gy }, damage, source);
  }

  /** Towers shoot the nearest hostile in range on their cooldown. */
  private updateDefenses(worldDt: number): void {
    for (const b of this.buildings.list) {
      const def = BUILDING_DEFS[b.type];
      if (!b.built || !def.defense) continue;
      const cd = (this.towerCd.get(b.id) ?? 0) - worldDt;
      this.towerCd.set(b.id, cd);
      if (cd > 0) continue;
      const cx = b.tx + def.size / 2;
      const cy = b.ty + def.size / 2;
      const target = this.findHostile(b.faction, cx, cy, def.defense.range);
      if (!target) continue;
      this.towerCd.set(b.id, def.defense.cooldown);
      const view = this.buildingViews.get(b.id);
      if (view) {
        const t = gridToScreen(target.gx, target.gy);
        const g = this.add.graphics().setDepth(900_001);
        g.lineStyle(1, 0xf3e9d2, 0.9).lineBetween(view.img.x, view.img.y - view.img.height + 10, t.x, t.y - 6);
        this.time.delayedCall(120, () => g.destroy());
      }
      const name = this.factions[b.faction].name;
      this.strikeTarget(target, def.defense.damage, `uma torre de ${name}`, { kind: 'npc', id: -b.id, gx: cx, gy: cy });
    }
  }

  /** An animal (or raider) hits whatever building stands on (tx, ty). */
  hitBuildingAt(tx: number, ty: number, damage: number): void {
    if (tx < 0 || ty < 0 || tx >= this.map.w || ty >= this.map.h) return;
    const b = this.buildings.at(tileIndex(this.map, tx, ty));
    if (b) this.damageBuilding(b, damage);
  }

  damageBuilding(b: Building, damage: number, attacker?: number): void {
    if (b.type === 'stockpile' && attacker !== undefined && b.hp - damage <= 0) {
      if (b.faction === PLAYER_FACTION) this.plunder(attacker, b);
      else this.conquer(b.faction, attacker);
      return;
    }
    if (b.type === 'stockpile' && b.hp - damage <= 0) {
      b.hp = 1; // animals can't knock a village hall down
      return;
    }
    const view = this.buildingViews.get(b.id);
    if (view) {
      view.img.setTint(0xff8070);
      this.time.delayedCall(120, () => view.img.clearTint());
    }
    if (!this.buildings.damage(b, damage)) return;
    // Destroyed.
    const def = BUILDING_DEFS[b.type];
    if (b.faction === PLAYER_FACTION) this.toast(`${def.name} foi destruída!`, '#ff8a7a');
    view?.img.destroy();
    view?.sign?.destroy();
    this.buildingViews.delete(b.id);
    for (const n of this.population.npcs) {
      if (n.homeId === b.id) n.homeId = null;
      if (n.jobId === b.id) n.jobId = null;
    }
    for (const i of clearPlot(this.map, b)) this.replaceObjectImage(i);
    this.buildings.remove(b);
    for (const i of this.buildings.footprint(b.type, b.tx, b.ty)) this.replaceObjectImage(i);
    this.territory.recompute(this.buildings.list);
  }

  /** Health bars over damaged buildings. */
  private drawBuildingHealth(): void {
    const g = this.buildingFx.clear();
    for (const b of this.buildings.list) {
      const max = BUILDING_DEFS[b.type].maxHp;
      if (!b.built || b.hp >= max) continue;
      const view = this.buildingViews.get(b.id);
      if (!view) continue;
      const w = 20;
      const x = Math.round(view.img.x - w / 2);
      const y = Math.round(view.img.y - view.img.height - 6);
      g.fillStyle(0x000000, 0.7).fillRect(x - 1, y - 1, w + 2, 4);
      g.fillStyle(b.hp / max > 0.5 ? 0xe0c060 : 0xff5040, 1).fillRect(x, y, Math.round((w * b.hp) / max), 2);
    }
  }

  private popup(x: number, y: number, text: string, color?: string): void {
    this.events.emit('popup', { x, y, text, color } satisfies PopupEvent);
  }

  // ---------- NPCs ----------

  /** Village centre for spawn distances and compass directions: the central stockpile. */
  private get villageCenter(): { x: number; y: number } {
    if (!this.settled) {
      const h = this.myHome();
      return h ? { x: h.tx + 1, y: h.ty + 1 } : { x: this.player.gx, y: this.player.gy };
    }
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
  /** Places a finished building for a rival village near its centre (paying from its stock). */
  private aiBuild(f: Faction, type: BuildingType, minR: number, maxR: number): Building | null {
    const def = BUILDING_DEFS[type];
    if (!f.stock.canAfford(def.cost)) return null;
    const spot = findSpot(this.buildings, type, f.center, minR, maxR, Math.random);
    if (!spot || !this.territory.canBuild(f.id, spot.x, spot.y, def.size)) return null;
    f.stock.pay(def.cost);
    const b = this.buildings.place(type, spot.x, spot.y, true, f.id);
    grantStarterTools(b);
    if (type === 'farm') this.setupAiFarm(b);
    this.addBuildingView(b);
    this.territory.recompute(this.buildings.list);
    return b;
  }

  /** A rival farm gets its planting area and some seeds. */
  private setupAiFarm(b: Building): void {
    const tiles = autoPlot(this.map, b, (i) => this.territory.owner[i]);
    if (tiles) for (const i of setPlot(this.map, b, tiles)) this.replaceObjectImage(i);
    b.storage.seed = (b.storage.seed ?? 0) + (tiles?.length ?? 0);
  }

  /** Each rival village's leaning when it has spare materials (random, fixed per game). */
  private townBias = new Map<number, BuildingType[]>();

  /**
   * Rival villages grow on their own, twice a day: food first (staff farms and hunters, build a farm
   * when food runs short), then protection (barracks, soldiers, a tower when threatened), then houses
   * and production, each village with its own random leaning.
   */
  private updateTowns(worldDt: number): void {
    this.townTimer += worldDt;
    if (this.townTimer < DAY_SECONDS / 2) return;
    this.townTimer = 0;
    for (const f of this.factions) {
      if (f.isPlayer || !f.alive) continue;
      const people = this.population.villagersOf(f.id);
      const days = foodDays(people, f.stock);
      const mine = (t: BuildingType) => this.buildings.list.filter((b) => b.faction === f.id && b.type === t && b.built);

      // 1. Food: put people on farms and hunting (taking them from other jobs if needed), and grow farms.
      const foodJobs = [...mine('farm'), ...mine('hunter')];
      if (days < 3) {
        for (const b of foodJobs) {
          const slots = BUILDING_DEFS[b.type].job!.slots - this.population.workers(b.id).length;
          const spare = people
            .filter((n) => isAdult(n, this.clock.seconds) && n.jobId !== null && !this.missions.has(n.id))
            .filter((n) => {
              const t = this.buildings.list.find((x) => x.id === n.jobId)?.type;
              return t === 'lumberjack' || t === 'quarry' || t === 'market' || t === 'mine' || t === 'smithy';
            });
          for (let k = 0; k < slots && k < spare.length; k++) {
            spare[k].jobId = null;
            this.population.assign(spare[k], b);
          }
        }
        if (mine('farm').length < 1 + Math.floor(people.length / 6)) this.aiBuild(f, 'farm', 4, 12);
      }

      // 2. Protection.
      const threatened = this.factions.some(
        (o) => o.id !== f.id && o.alive && (this.atWar(f.id, o.id) || this.diplomacy.get(f.id, o.id).score < -30),
      );
      const hasBarracks = this.buildings.list.some((b) => b.faction === f.id && b.type === 'barracks');
      if (threatened && !hasBarracks) this.aiBuild(f, 'barracks', 3, 10);
      if (threatened && hasBarracks && this.soldiers(f.id).length < 2) {
        const barracks = this.buildings.list.find((b) => b.faction === f.id && b.type === 'barracks')!;
        const pool = people
          .filter((n) => {
            const t = this.buildings.list.find((b) => b.id === n.jobId)?.type;
            return isAdult(n, this.clock.seconds) && t !== 'barracks' && t !== 'farm' && t !== 'hunter';
          })
          .sort((a, b) => b.skills.combat - a.skills.combat);
        for (const n of pool) {
          if (this.soldiers(f.id).length >= 2) break;
          n.jobId = null;
          this.population.assign(n, barracks);
        }
      }
      if (mine('tower').length === 0) this.aiBuild(f, 'tower', 4, 9);

      // 3. Growth, only with food to spare: beds, then the village's own leaning.
      if (days >= 3) {
        if (this.population.freeBedsOf(f.id) < 2) this.aiBuild(f, 'house', 2, 10);
        let bias = this.townBias.get(f.id);
        if (!bias) {
          const all: BuildingType[] = ['lumberjack', 'quarry', 'hunter', 'farm', 'tower', 'smithy', 'mine'];
          bias = all.sort(() => Math.random() - 0.5).slice(0, 3);
          this.townBias.set(f.id, bias);
        }
        if (Math.random() < 0.35) {
          const t = bias[Math.floor(Math.random() * bias.length)];
          if (mine(t).length < 2) this.aiBuild(f, t, 4, 12);
        }
      }

      // Jobs: food first, then the rest.
      const order = this.buildings.list
        .filter((b) => b.faction === f.id && b.built && BUILDING_DEFS[b.type].job)
        .sort((a, b) => JOB_PRIORITY.indexOf(a.type) - JOB_PRIORITY.indexOf(b.type));
      staffInOrder(this.population, order, f.id);
      this.supplyTown(f);
    }
  }

  /** Every few seconds, workplaces of yours whose workers lack tools get them from the village stock. */
  private supplyTimer = 0;
  private autoSupplyTools(worldDt: number): void {
    this.supplyTimer += worldDt;
    if (this.supplyTimer < 2) return;
    this.supplyTimer = 0;
    for (const b of this.buildings.list) {
      if (!this.isMine(b.faction)) continue;
      const workers = this.population.workers(b.id).length;
      if (workers === 0) continue;
      const moved = autoSupply(b, workers, villageStorage(this.factions[b.faction]));
      if (moved.length === 0) continue;
      const names = [...new Set(moved)].map((t) => ITEM_DEFS[t].label.toLowerCase()).join(', ');
      this.toast(
        `${BUILDING_DEFS[b.type].name} recebeu do estoque: ${moved.length > 1 ? `${moved.length}× ` : ''}${names}.`,
        '#a8c8ff',
      );
    }
  }

  private updateNpcs(worldDt: number): void {
    if (this.spawner.update(worldDt, this.population.wanderers.length)) this.spawnWanderer();
    this.autoSupplyTools(worldDt);

    for (const f of this.factions) {
      const childFactor = (n: NpcData) => (ageOf(n, this.clock.seconds) < ADULT_AGE ? 0.5 : 1);
      for (const e of updateNeeds(this.population.villagersOf(f.id), f.stock, worldDt, childFactor)) {
        if (!f.isPlayer) {
          if (e.type === 'died') this.removeVillager(e.npc.id, null);
        } else if (e.type === 'starving') this.toast(`${e.npc.name} está com fome! Falta carne no estoque.`, '#ffb070');
        else this.removeVillager(e.npc.id, `${e.npc.name} morreu de fome.`);
      }
    }
    const bag = { take: () => this.inventory.remove('meat', 1) === 1 || this.currentVillage().stock.pay({ meat: 1 }) };
    for (const e of updateNeedsFrom(this.population.companions, bag, worldDt)) {
      if (e.type === 'starving') this.toast(`${e.npc.name} está com fome! Leve carne na mochila.`, '#ffb070');
      else this.removeVillager(e.npc.id, `${e.npc.name} morreu de fome.`);
    }
    this.houseHomeless(worldDt);
    this.updateTowns(worldDt);
    this.updateRecruiting(worldDt);
    this.updateSmithies(worldDt);
    this.updateFamilies(worldDt);
    this.updateDiplomacy(worldDt);
    this.updateTrade(worldDt);

    this.villagerRegen += worldDt;
    const regen = this.villagerRegen >= 30;
    if (regen) this.villagerRegen = 0;
    for (const npc of [...this.npcs.values()]) {
      if (regen && npc.data.hp < maxHpOf(npc.data, this.buildings) && !isStarving(npc.data)) npc.data.hp++;
      npc.setChild(npc.data.role === 'villager' && ageOf(npc.data, this.clock.seconds) < ADULT_AGE);
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
          this.toast(`${npc.data.name} cansou de esperar e foi morar em ${rival.name}.`, '#cdb98e');
        } else {
          this.npcs.delete(npc.data.id);
          this.population.remove(npc.data.id);
          npc.leave(() => {});
          this.toast(`${npc.data.name} desistiu de esperar e foi embora.`, '#cdb98e');
        }
      }
    }
  }

  private spawnWanderer(): void {
    const center = this.villageCenter;
    const tile = pickSpawnTile(this.map, Math.random, center);
    if (!tile) return;
    const data = generateWanderer(Math.random, this.population.newId(), this.clock.seconds + WANDERER_STAY, this.clock.seconds);
    this.population.npcs.push(data);
    this.npcs.set(data.id, new Npc(this, this.map, data, tile));
    const who = data.gender === 'f' ? 'Uma andarilha' : 'Um andarilho';
    const from = this.settled ? 'da vila' : 'de você';
    this.toast(`${who} apareceu ${compass(tile.x + 0.5 - center.x, tile.y + 0.5 - center.y)} ${from}.`, '#ffe08a');
  }

  /** Nearest NPC within reach of the player, or null. */
  private nearestNpc(): Npc | null {
    let best: Npc | null = null;
    let bestD = NPC_REACH;
    for (const npc of this.npcs.values()) {
      if (npc.indoors) continue;
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
    if (!this.settled) return this.recruitCompanion(id);
    const home = this.population.recruit(npc.data, this.inventory, this.stockpile);
    if (!home) return false;
    this.gainXp(XP.recruit);
    sound.play('recruit');
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

  toast(text: string, color?: string): void {
    this.events.emit('toast', { text, color } satisfies ToastEvent);
  }

  // ---------- demolition (driven by UIScene) ----------

  /** Demolish mode is on (X or the button in the B menu). */
  demolishing = false;
  /** What the cursor would demolish, for the UI hint. */
  demolishHint: { text: string; ok: boolean } | null = null;
  private demolishPick: { building?: Building; road?: number } | null = null;
  private demolishArmed: { key: string; until: number } | null = null;

  startDemolish(): void {
    this.cancelPlacing();
    this.demolishing = true;
    this.interaction = null;
  }

  cancelDemolish(): void {
    this.demolishing = false;
    this.demolishHint = null;
    this.demolishPick = null;
    this.demolishArmed = null;
  }

  /** Finds your building or road under the cursor and outlines it. */
  private updateDemolish(): void {
    const ptr = this.input.activePointer;
    const world = this.cameras.main.getWorldPoint(ptr.x, ptr.y);
    const g = screenToGrid(world.x, world.y);
    const tx = Math.floor(g.x);
    const ty = Math.floor(g.y);
    this.demolishPick = null;
    this.demolishHint = { text: 'Aponte para um prédio ou estrada seu', ok: false };
    if (tx < 0 || ty < 0 || tx >= this.map.w || ty >= this.map.h) return;
    const i = tileIndex(this.map, tx, ty);
    const b = this.buildings.at(i);
    if (b) {
      const def = BUILDING_DEFS[b.type];
      this.drawFootprint(b.tx, b.ty, def.size, 0xff6040);
      if (!this.isMine(b.faction)) this.demolishHint = { text: 'Não é seu', ok: false };
      else if (b.type === 'stockpile') this.demolishHint = { text: 'O Salão não pode ser demolido', ok: false };
      else {
        this.demolishPick = { building: b };
        const armed = this.demolishArmed?.key === `b${b.id}` && this.demolishArmed.until > this.time.now;
        const refund = summarizeCost(this.refundFor(b));
        this.demolishHint = {
          text: armed ? `Clique de novo para demolir ${def.name}` : `Demolir ${def.name}${refund ? ` (devolve ${refund})` : ''}`,
          ok: true,
        };
      }
      return;
    }
    if (
      this.map.objects[i] === Obj.Road &&
      this.territory.ownerAt(tx, ty) !== -1 &&
      !this.isMine(this.territory.ownerAt(tx, ty))
    ) {
      this.demolishHint = { text: 'Estrada no território de outra vila', ok: false };
      return;
    }
    if (this.map.objects[i] === Obj.Road || FIELD_OBJS.has(this.map.objects[i])) {
      this.drawFootprint(tx, ty, 1, 0xff6040);
      this.demolishPick = { road: i };
      this.demolishHint = { text: 'Remover estrada (devolve 1 pedra)', ok: true };
    }
  }

  // ---------- moving buildings (driven by UIScene) ----------

  /** "Mover" mode: pointing at the building to move. */
  movePicking = false;
  moveHint: { text: string; ok: boolean } | null = null;
  private movePick: Building | null = null;
  /** The building being moved (placement mode shows its ghost at the new spot). */
  relocating: Building | null = null;

  startMove(): void {
    this.cancelPlacing();
    this.movePicking = true;
    this.interaction = null;
  }

  private updateMovePick(): void {
    const t = this.pointerTile();
    this.movePick = null;
    this.moveHint = { text: 'Aponte para um prédio seu', ok: false };
    if (!inBounds(this.map, t.x, t.y)) return;
    const b = this.buildings.at(tileIndex(this.map, t.x, t.y));
    if (!b) return;
    const def = BUILDING_DEFS[b.type];
    this.drawFootprint(b.tx, b.ty, def.size, 0xffe08a);
    if (!this.isMine(b.faction)) this.moveHint = { text: 'Não é seu', ok: false };
    else if (!canRelocate(b)) this.moveHint = { text: 'O Salão não pode ser mudado de lugar', ok: false };
    else {
      this.movePick = b;
      const cost = summarizeCost(relocationCost(b));
      this.moveHint = { text: `Mover ${def.name} (${cost ? `custa ${cost}` : 'obra: grátis'}) · clique`, ok: true };
    }
  }

  /** The click that picks the building; then choose its new spot like when building. */
  tryPickMove(): void {
    const b = this.movePick;
    if (!b) return;
    this.movePicking = false;
    this.moveHint = null;
    this.relocating = b;
    this.startPlacing(b.type);
  }

  /** Moves a building: it becomes a construction site at the new spot (people, inventory and orders go along). */
  private relocate(b: Building, tx: number, ty: number): void {
    const def = BUILDING_DEFS[b.type];
    const old = this.buildings.footprint(b.type, b.tx, b.ty);
    const lostPlot = (b.plot?.tiles.length ?? 0) > 0;
    for (const i of clearPlot(this.map, b)) this.replaceObjectImage(i);
    this.buildings.move(b, tx, ty);
    b.built = false;
    b.progress = 0;
    b.hp = def.maxHp;
    for (const i of [...old, ...this.buildings.footprint(b.type, tx, ty)]) this.replaceObjectImage(i);
    const view = this.buildingViews.get(b.id);
    view?.img.destroy();
    view?.sign?.destroy();
    this.buildingViews.delete(b.id);
    this.addBuildingView(b);
    this.territory.recompute(this.buildings.list);
    sound.play('build');
    this.toast(
      `${def.name}: obra no novo lugar. Termine a construção (E), os desocupados ajudam.${lostPlot ? ' Defina a área de plantio de novo.' : ''}`,
      '#ffe08a',
    );
  }

  /** What demolishing gives back: everything for an unfinished site, half for a finished building. */
  private refundFor(b: Building): Partial<Record<Resource, number>> {
    return demolitionRefund(b);
  }

  /** Click in demolish mode: the first click arms, a second click on the same thing within 4 s demolishes. */
  tryDemolish(): void {
    const pick = this.demolishPick;
    if (!pick) return;
    const key = pick.building ? `b${pick.building.id}` : `r${pick.road}`;
    if (pick.road !== undefined) {
      // Roads are cheap: no confirmation.
      this.map.objects[pick.road] = Obj.None;
      this.replaceObjectImage(pick.road);
      this.stockpile.add('stone', 1);
      return;
    }
    if (this.demolishArmed?.key !== key || this.demolishArmed.until < this.time.now) {
      this.demolishArmed = { key, until: this.time.now + 4000 };
      return;
    }
    this.demolishArmed = null;
    this.demolish(pick.building!);
  }

  // ---------- colonies ----------

  /** Is faction `f` the player's (home village or a colony)? */
  isMine(f: number): boolean {
    return this.factions[f]?.isPlayer === true;
  }

  /** You have a village (a hall of your own). Before that: survival, your house, claiming land. */
  get settled(): boolean {
    return this.buildings.list.some((b) => b.type === 'stockpile' && b.faction === PLAYER_FACTION);
  }

  /** Your own house (one at most). */
  myHome(): Building | undefined {
    return this.buildings.list.find((b) => b.type === 'home' && b.faction === PLAYER_FACTION);
  }

  /** What the build menu offers now. */
  buildMenu(): BuildingType[] {
    const home = this.myHome();
    if (!this.settled) return [...(home ? [] : (['home'] as const)), ...(home?.built ? (['claim'] as const) : [])];
    return BUILD_MENU.filter((t) => t !== 'claim' && (t !== 'home' || !home));
  }

  buildMenuHint(): string | null {
    if (this.settled) return null;
    const home = this.myHome();
    if (!home) return 'Você ainda não tem vila. Comece pela sua casa (em terra sem dono).';
    if (!home.built) return 'Termine a sua casa (segure E na obra) para poder reivindicar terras.';
    return 'Reivindique terras perto da sua casa: o Salão funda a sua vila. Paga com a mochila + o guardado em casa.';
  }

  /** Why the claim can't go at (tx, ty), or null if it can. */
  private claimSiteOk(tx: number, ty: number): string | null {
    const home = this.myHome();
    if (!home?.built) return 'Construa sua casa primeiro';
    if (Math.hypot(tx - home.tx - 1, ty - home.ty - 1) > CLAIM_NEAR_HOME) return 'Longe demais da sua casa';
    for (const f of this.factions)
      if (f.id !== PLAYER_FACTION && f.alive && Math.hypot(f.center.x - tx, f.center.y - ty) < COLONY_MIN_DISTANCE)
        return `Perto demais de ${f.name}`;
    for (let y = ty - 10; y <= ty + 10; y++)
      for (let x = tx - 10; x <= tx + 10; x++) {
        const o = this.territory.ownerAt(x, y);
        if (o !== -1 && !this.isMine(o)) return 'Perto demais de terras de outra vila';
      }
    return null;
  }

  /** The hall goes up: your village is born. */
  private claimLand(tx: number, ty: number): void {
    const hall = this.buildings.place('stockpile', tx, ty, true, PLAYER_FACTION);
    for (const i of this.buildings.footprint('stockpile', tx, ty)) this.replaceObjectImage(i);
    this.addBuildingView(hall);
    this.factions[PLAYER_FACTION].center = { x: tx, y: ty };
    this.territory.recompute(this.buildings.list);
    this.onSettled();
    this.toast('Terras reivindicadas! Sua vila nasceu: construa (B), recrute e governe (V).', '#ffe08a');
    this.toast('O que estava guardado na sua casa agora é o estoque da vila (no Salão).', '#cdb98e');
  }

  /** The village is founded. Companions stay companions until you settle them (their card: "Morar na vila"). */
  private onSettled(): void {
    if (this.population.companions.length > 0)
      this.toast(
        'Seus companheiros continuam com você. Para que morem na vila: casa com cama livre e "Morar na vila" no cartão.',
        '#a8c8ff',
      );
  }

  /** The nearest unfinished building of this villager's village, if they're an idle adult. */
  private buildSiteFor(npc: Npc): Building | null {
    const n = npc.data;
    const job = n.jobId !== null ? this.buildings.list.find((b) => b.id === n.jobId) : undefined;
    if (job?.built) return null; // busy at work (people whose workplace is being rebuilt help with it)
    if (n.role !== 'villager' || this.missions.has(n.id) || !isAdult(n, this.clock.seconds)) return null;
    if (job && !job.built) return job;
    let best: Building | null = null;
    let bestD = BUILDER_RANGE;
    for (const b of this.buildings.list) {
      if (b.built || b.faction !== n.faction) continue;
      const d = Math.hypot(b.tx - npc.gx, b.ty - npc.gy);
      if (d < bestD) {
        bestD = d;
        best = b;
      }
    }
    return best;
  }

  // ---------- farms ----------

  /** Tiles a farmer is walking to (so two farmers don't take the same one). */
  private farmReserved = new Map<number, number>();
  private farmTimer = 0;

  /** Seeds a farm can plant with: its own inventory, then its village's stock. */
  farmSeeds(farm: Building): number {
    return (farm.storage.seed ?? 0) + this.factions[farm.faction].stock.items.seed;
  }

  private farmTaskFor(npc: Npc, farm: Building): FarmTask | string {
    if (!farm.plot || farm.plot.tiles.length === 0) return 'Defina a área de plantio (painel da fazenda)';
    for (const [tile, who] of this.farmReserved) if (who === npc.data.id) this.farmReserved.delete(tile);
    const taken = new Set(this.farmReserved.keys());
    const task = nextFarmTask(this.map, farm.plot, this.farmSeeds(farm) > 0, taken);
    if (!task) {
      const empty = farm.plot.tiles.some((i) => this.map.objects[i] === Obj.Field);
      return empty && this.farmSeeds(farm) === 0 ? 'Sem sementes (colete grama)' : 'Esperando a plantação crescer';
    }
    this.farmReserved.set(task.tile, npc.data.id);
    return task;
  }

  private farmDo(_npc: Npc, farm: Building, task: FarmTask): number {
    this.farmReserved.delete(task.tile);
    const plot = farm.plot;
    if (!plot) return 0;
    if (task.kind === 'plant') {
      if (this.farmSeeds(farm) <= 0 || !plant(this.map, plot, task.tile, this.clock.seconds)) return 0;
      if ((farm.storage.seed ?? 0) > 0) farm.storage.seed = (farm.storage.seed ?? 0) - 1;
      else this.factions[farm.faction].stock.items.seed -= 1;
      this.replaceObjectImage(task.tile);
      return 0;
    }
    const got = harvestCrop(this.map, plot, task.tile, Math.random);
    if (!got) return 0;
    farm.storage.seed = (farm.storage.seed ?? 0) + got.seeds;
    this.replaceObjectImage(task.tile);
    return got.food;
  }

  /** You pick a ripe crop yourself: the food and seeds go to your bag. */
  private harvestByHand(i: number): void {
    const farm = this.buildings.list.find((b) => b.plot?.tiles.includes(i));
    const img = this.objectImages.get(i);
    if (!farm?.plot || !this.isMine(farm.faction)) return;
    if (this.inventory.space('meat') < 1) {
      if (img) this.popup(img.x, img.y - 10, 'Mochila cheia', '#ffb070');
      return;
    }
    const got = harvestCrop(this.map, farm.plot, i, Math.random);
    if (!got) return;
    this.inventory.add('meat', got.food);
    const seeds = this.inventory.add('seed', got.seeds);
    sound.play('pull');
    this.replaceObjectImage(i);
    this.gainXp(XP.gather);
    if (img) this.popup(img.x, img.y - 10, `+${got.food} Comida  +${seeds} Semente`);
  }

  /** Crops ripen after GROW_SECONDS (checked once a second). */
  private updateFarms(worldDt: number): void {
    this.farmTimer += worldDt;
    if (this.farmTimer < 1) return;
    this.farmTimer = 0;
    for (const b of this.buildings.list) for (const i of ripen(this.map, b.plot, this.clock.seconds)) this.replaceObjectImage(i);
  }

  /** "Definir área de plantio": drag a rectangle (up to 5×5) of grass near the farm. */
  plotFarm: Building | null = null;
  plotHint: { text: string; ok: boolean } | null = null;
  private plotStart: { x: number; y: number } | null = null;
  private plotTiles: { tiles: number[]; problem: string | null } | null = null;

  startPlot(farm: Building): void {
    this.cancelPlacing();
    this.plotFarm = farm;
    this.plotStart = null;
    this.interaction = null;
  }

  cancelPlot(): void {
    this.plotFarm = null;
    this.plotStart = null;
    this.plotTiles = null;
    this.plotHint = null;
  }

  private pointerTile(): { x: number; y: number } {
    const ptr = this.input.activePointer;
    const world = this.cameras.main.getWorldPoint(ptr.x, ptr.y);
    const g = screenToGrid(world.x, world.y);
    return { x: Math.floor(g.x), y: Math.floor(g.y) };
  }

  private updatePlot(): void {
    const farm = this.plotFarm!;
    if (!this.buildings.list.includes(farm)) {
      this.cancelPlot();
      return;
    }
    const t = this.pointerTile();
    const a = this.plotStart ?? t;
    const rect = plotRect(a.x, a.y, t.x, t.y);
    const tiles = rectTiles(this.map, rect);
    let problem: string | null = null;
    for (const i of tiles) {
      const why = plotTileProblem(this.map, farm, i, (k) => this.territory.owner[k]);
      this.drawFootprint(i % this.map.w, Math.floor(i / this.map.w), 1, why ? 0xff6060 : 0x8aff8a);
      problem ??= why;
    }
    this.plotTiles = { tiles, problem };
    const size = `${rect.x1 - rect.x0 + 1}×${rect.y1 - rect.y0 + 1}`;
    this.plotHint = problem
      ? { text: problem, ok: false }
      : this.plotStart
        ? { text: `${size} · solte para definir`, ok: true }
        : { text: 'Arraste sobre a grama (até 5×5) · direito/Esc cancela', ok: true };
  }

  plotPointerDown(): void {
    if (this.plotFarm) this.plotStart = this.pointerTile();
  }

  /** Releasing the drag sets the area (if every tile is fine). */
  plotPointerUp(): void {
    const farm = this.plotFarm;
    if (!farm || !this.plotStart) return;
    this.updatePlot();
    const sel = this.plotTiles;
    this.plotStart = null;
    if (!sel || sel.problem) {
      if (sel?.problem) this.toast(sel.problem, '#ffb070');
      return;
    }
    for (const i of setPlot(this.map, farm, sel.tiles)) this.replaceObjectImage(i);
    this.territory.recompute(this.buildings.list);
    this.toast(
      `Área de plantio definida: ${sel.tiles.length} quadrados. O fazendeiro planta com sementes da fazenda ou do estoque.`,
      '#a8ffa8',
    );
    this.cancelPlot();
  }

  /** One of your villagers joins your group: leaves their job and house. */
  makeCompanion(n: NpcData): string | null {
    if (n.role !== 'villager' || !this.isMine(n.faction)) return 'Só aldeões seus.';
    if (!isAdult(n, this.clock.seconds)) return 'Crianças não viajam no grupo.';
    if (this.factions[n.faction].rulerId === n.id) return 'O governante fica na vila.';
    if (this.population.companions.length >= COMPANION_MAX) return `O grupo está cheio (${COMPANION_MAX}).`;
    if (this.talkingTo?.id === n.id) this.talkingTo = null;
    this.population.unassign(n);
    this.missions.delete(n.id);
    n.order = null;
    n.homeId = null;
    n.faction = PLAYER_FACTION;
    n.role = 'companion';
    this.toast(`${n.name} agora viaja com você.`, '#a8ffa8');
    return null;
  }

  /** A companion settles in the village you're standing in (needs a free bed there). */
  settleCompanion(n: NpcData): string | null {
    if (n.role !== 'companion') return null;
    if (!this.settled) return 'Você ainda não tem vila.';
    const v = this.currentVillage();
    const home = this.population.houseWithBed(v.id);
    if (!home) return `Sem cama livre em ${v.name}: construa uma Casa.`;
    if (this.talkingTo?.id === n.id) this.talkingTo = null;
    n.role = 'villager';
    n.faction = v.id;
    n.homeId = home.id;
    n.command = null;
    this.npcs.get(n.id)?.moveTo(home);
    this.toast(`${n.name} vai morar em ${v.name}.`, '#a8c8ff');
    return null;
  }

  /** A wanderer joins your group instead of the village (any time). */
  recruitCompanion(id: number): boolean {
    const npc = this.npcs.get(id);
    if (!npc || !this.population.recruitCompanion(npc.data, this.inventory, this.currentVillage().stock)) return false;
    this.gainXp(XP.recruit);
    sound.play('recruit');
    npc.becomeCompanion();
    this.toast(`${npc.data.name} agora viaja com você. Leve carne: companheiros comem da sua mochila.`, '#a8ffa8');
    return true;
  }

  /** Every few seconds, villagers without a home move into a free bed of their village. */
  private homelessTimer = 0;
  private houseHomeless(worldDt: number): void {
    this.homelessTimer += worldDt;
    if (this.homelessTimer < 5) return;
    this.homelessTimer = 0;
    for (const n of this.population.allVillagers) {
      if (n.homeId !== null) continue;
      const home = this.population.houseWithBed(n.faction);
      if (!home) continue;
      n.homeId = home.id;
      this.npcs.get(n.id)?.moveTo(home);
      if (this.isMine(n.faction)) this.toast(`${n.name} se mudou para uma casa.`, '#a8c8ff');
    }
  }

  /** Gives a companion (or soldier) the next weapon or armour you carry, putting theirs back in your bag. */
  equipFromBag(n: NpcData, slot: 'weapon' | 'armor'): void {
    const list = slot === 'weapon' ? WEAPONS : ARMORS;
    const current = n[slot] ?? null;
    const options: (ToolId | null)[] = [null, ...list.filter((t) => this.inventory.count(t) > 0 || t === current)];
    const next = options[(options.indexOf(current) + 1) % options.length];
    if (next === current) return;
    if (current && this.inventory.add(current, 1) === 0) {
      this.toast('Sua mochila está cheia.', '#ffb070');
      return;
    }
    if (next) this.inventory.remove(next, 1);
    n[slot] = next;
  }

  /** Buy (from them) or sell (to them) one unit at another village's market, with what you carry and your coins. */
  peddle(faction: number, g: Good, side: 'buy' | 'sell'): string | null {
    const f = this.factions[faction];
    if (!f?.alive || this.isMine(faction)) return 'Ninguém para negociar.';
    if (this.atWar(PLAYER_FACTION, faction)) return 'Estão em guerra com você.';
    const market = this.marketOf(f);
    const me = this.factions[PLAYER_FACTION];
    if (side === 'buy') {
      const q = quoteBuy(market, g, me.coins);
      if ('why' in q) return q.why;
      if (this.inventory.space(g) < 1) return 'Não cabe na mochila.';
      this.inventory.add(g, 1);
      market.remove(g, 1);
      market.coins += q.price;
      me.coins -= q.price;
      sound.play('coins');
      return null;
    }
    const slot = this.sellSlot(g);
    if (slot < 0) return `Você não carrega ${goodLabel(g)}.`;
    const s = this.inventory.slots[slot]!;
    const max = maxDurability(g);
    const q = quoteSell(market, g, max && s.durability !== undefined ? s.durability / max : 1);
    if ('why' in q) return q.why;
    if (--s.count <= 0) this.inventory.slots[slot] = null;
    market.add(g, 1);
    market.coins -= q.price;
    me.coins += q.price;
    sound.play('coins');
    return null;
  }

  /** The slot a sale takes from: the most worn tool of that kind, or any stack of the resource. */
  sellSlot(g: Good): number {
    let best = -1;
    this.inventory.slots.forEach((s, i) => {
      if (s?.item !== g) return;
      const b = best >= 0 ? this.inventory.slots[best] : null;
      if (best < 0 || (s.durability ?? 0) < (b?.durability ?? 0)) best = i;
    });
    return best;
  }

  // ---------- orders to companions and soldiers ----------

  /** Is this one of your soldiers? */
  isSoldier(n: NpcData): boolean {
    return n.jobId !== null && this.buildings.list.find((b) => b.id === n.jobId)?.type === 'barracks';
  }

  /** Can you give this person orders (your companions and soldiers)? */
  canCommand(n: NpcData): boolean {
    return takesOrders(n, this.isMine(n.faction), this.isSoldier(n));
  }

  /** Gives an order (null = back to their default: companions follow, soldiers guard the barracks). */
  setCommand(n: NpcData, c: Command | null): void {
    if (!this.canCommand(n)) return;
    n.command = c;
    if (c) n.order = null; // a direct order calls them back from a raid
  }

  setStance(n: NpcData, s: Stance): void {
    if (this.canCommand(n)) n.stance = s;
  }

  /** "Vá até…": the next click on the map sends this person there. */
  commandPick: NpcData | null = null;
  commandHint: { text: string; ok: boolean } | null = null;
  private commandTile: { x: number; y: number } | null = null;

  startCommandPick(n: NpcData): void {
    this.cancelPlacing();
    this.commandPick = n;
    this.interaction = null;
  }

  cancelCommandPick(): void {
    this.commandPick = null;
    this.commandHint = null;
    this.commandTile = null;
  }

  /** Highlights the tile under the cursor while picking a destination. */
  private updateCommandPick(): void {
    const n = this.commandPick!;
    if (!this.population.npcs.includes(n)) {
      this.cancelCommandPick();
      return;
    }
    const ptr = this.input.activePointer;
    const world = this.cameras.main.getWorldPoint(ptr.x, ptr.y);
    const g = screenToGrid(world.x, world.y);
    const tx = Math.floor(g.x);
    const ty = Math.floor(g.y);
    const ok = inBounds(this.map, tx, ty) && isWalkable(this.map, tx, ty);
    this.commandTile = ok ? { x: tx, y: ty } : null;
    this.commandHint = {
      text: ok ? `Clique: ${n.name} vai até aqui e guarda a posição · botão direito cancela` : 'Não dá para ficar ali',
      ok,
    };
    this.drawFootprint(tx, ty, 1, ok ? 0x8ac8ff : 0xff6060);
  }

  /** The click that confirms the destination. */
  tryCommandPick(): void {
    const n = this.commandPick;
    const t = this.commandTile;
    if (!n || !t) return;
    this.setCommand(n, { kind: 'hold', x: t.x, y: t.y });
    this.toast(`${n.name} está indo até o ponto.`, '#a8c8ff');
    this.cancelCommandPick();
  }

  /** Your companions and soldiers within QUICK_ORDER_RADIUS of you (who F1/F2 orders reach), nearest first. */
  nearbyCommandables(): NpcData[] {
    return [...this.npcs.values()]
      .filter(
        (npc) =>
          !npc.indoors &&
          this.canCommand(npc.data) &&
          Math.hypot(npc.gx - this.player.gx, npc.gy - this.player.gy) < QUICK_ORDER_RADIUS,
      )
      .sort(
        (a, b) =>
          Math.hypot(a.gx - this.player.gx, a.gy - this.player.gy) - Math.hypot(b.gx - this.player.gx, b.gy - this.player.gy),
      )
      .map((npc) => npc.data);
  }

  /** Quick order to everyone nearby: follow you, or stay where each one stands. Returns how many got it. */
  orderNearby(kind: 'follow' | 'stay'): number {
    const near = this.nearbyCommandables();
    for (const n of near) {
      const t = this.npcs.get(n.id)!.tile;
      this.setCommand(n, kind === 'follow' ? { kind: 'follow' } : { kind: 'hold', x: t.x, y: t.y });
    }
    if (near.length === 0) this.toast('Ninguém por perto para receber ordens (companheiros e soldados).', '#cdb98e');
    else this.toast(`${near.length} ${kind === 'follow' ? 'seguindo você' : 'ficando onde estão'}.`, '#a8c8ff');
    return near.length;
  }

  // ---------- items on the ground ----------

  private drops!: Drops;
  private dropViews!: Map<number, Phaser.GameObjects.Image>;

  /** G drops one of the selected hotbar item (Shift+G: the whole stack) at your feet. */
  dropSelected(all: boolean): void {
    const slot = this.selectedHotbar;
    const stack = takeFromSlot(this.inventory, slot, all ? Infinity : 1);
    const p = this.player.sprite;
    if (!stack) {
      this.popup(p.x, p.y - p.height, 'Nada selecionado na barra', '#cdb98e');
      return;
    }
    // Merge with a drop of the same resource right here, so dropping one by one makes one pile.
    const here = this.drops.nearest(this.player.gx, this.player.gy, 0.6);
    if (here && here.item === stack.item && here.durability === undefined && stack.durability === undefined) {
      here.count += stack.count;
      here.expiresAt = this.clock.seconds + DROP_LIFETIME;
    } else this.addDropView(this.drops.add(stack, this.player.gx, this.player.gy + 0.3, this.clock.seconds));
    this.popup(p.x, p.y - p.height, `Largou ${stack.count} ${ITEM_DEFS[stack.item].label}`, '#cdb98e');
    sound.play('drop');
  }

  private addDropView(d: Drop): void {
    const s = gridToScreen(d.gx, d.gy);
    const img = this.add
      .image(s.x, s.y, `icon_${d.item}`)
      .setOrigin(0.5, 1)
      .setScale(1.2)
      .setDepth(s.y - 1);
    this.tweens.add({ targets: img, y: s.y - 2, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    this.dropViews.set(d.id, img);
  }

  private removeDropView(d: Drop): void {
    const img = this.dropViews.get(d.id);
    if (!img) return;
    this.tweens.killTweensOf(img);
    img.destroy();
    this.dropViews.delete(d.id);
  }

  /** Opens the trade window with another village (from one of its people). */
  openPeddle(faction: number): void {
    this.events.emit('peddle', faction);
  }

  /** Independent villages (colonies share their founder's relations). */
  private realms(): number[] {
    return this.factions.filter((f) => f.alive && f.parent === undefined).map((f) => f.id);
  }

  /** Is any tile within `r` of (tx, ty) owned by a village? */
  private landNear(tx: number, ty: number, r: number): boolean {
    for (let y = ty - r; y <= ty + r; y++)
      for (let x = tx - r; x <= tx + r; x++) if (this.territory.ownerAt(x, y) !== -1) return true;
    return false;
  }

  /** Which of your villages a building at (tx, ty) belongs to (and pays for it): the land's owner, else home. */
  private buildFaction(type: BuildingType, tx: number, ty: number, size: number): number {
    if (type === 'colony') return PLAYER_FACTION;
    const o = this.territory.ownerAt(Math.floor(tx + size / 2 - 0.01), Math.floor(ty + size / 2 - 0.01));
    return this.isMine(o) ? o : PLAYER_FACTION;
  }

  /** Costs are paid from what you carry first, then that village's stock. */
  private canPay(cost: Partial<Record<Resource, number>>, f: Faction): boolean {
    return RESOURCES.every((r) => this.inventory.count(r) + f.stock.items[r] >= (cost[r] ?? 0));
  }

  /** The village whose land you stand on (if it's yours), else your home village. */
  currentVillage(): Faction {
    const o = this.territory.ownerAt(Math.floor(this.player.gx), Math.floor(this.player.gy));
    return this.factions[this.isMine(o) ? o : PLAYER_FACTION];
  }

  /** Your villages (home first), for selectors. */
  myVillages(): Faction[] {
    return this.factions.filter((f) => f.isPlayer && f.alive);
  }

  /** A new colony hall at (tx, ty): a new village of yours with a little starting stock. */
  private foundColony(tx: number, ty: number): void {
    const id = this.factions.length;
    const n = this.factions.filter((f) => f.parent !== undefined).length;
    const round = Math.floor(n / COLONY_NAMES.length);
    const name = COLONY_NAMES[n % COLONY_NAMES.length] + (round > 0 ? ` ${round + 1}` : '');
    const f = createColony(id, { x: tx, y: ty }, name);
    for (const [r, k] of Object.entries(COLONY_START)) f.stock.add(r as Resource, k);
    this.factions.push(f);
    const hall = this.buildings.place('stockpile', tx, ty, true, id);
    for (const i of this.buildings.footprint('stockpile', tx, ty)) this.replaceObjectImage(i);
    this.addBuildingView(hall);
    this.territory.recompute(this.buildings.list);
    this.toast(`Colônia ${name} fundada! Construa casas lá e mude aldeões para elas (painel da casa).`, '#ffe08a');
  }

  /** Moves one of your villagers to a house in another of your villages: new home, no job. */
  moveVillager(n: NpcData, house: Building): boolean {
    if (!this.isMine(n.faction) || !this.isMine(house.faction) || n.faction === house.faction) return false;
    if (this.population.residents(house.id).length >= BEDS_PER_HOUSE) return false;
    if (this.talkingTo?.id === n.id) this.talkingTo = null;
    if (n.jobId !== null) this.population.unassign(n);
    this.missions.delete(n.id);
    n.order = null;
    n.faction = house.faction;
    n.homeId = house.id;
    this.npcs.get(n.id)?.moveTo(house);
    this.toast(`${n.name} está se mudando para ${this.factions[house.faction].name}.`, '#a8c8ff');
    return true;
  }

  /** Tears down one of your buildings: refunds materials, frees its people, recomputes territory. */
  demolish(b: Building): void {
    if (b.type === 'stockpile' || !this.isMine(b.faction)) return;
    const def = BUILDING_DEFS[b.type];
    const refund = this.refundFor(b);
    for (const r of RESOURCES) this.factions[b.faction].stock.add(r, refund[r] ?? 0);
    for (const n of this.population.npcs) {
      if (n.homeId === b.id) n.homeId = null;
      if (n.jobId === b.id) {
        n.jobId = null;
        n.order = null;
      }
    }
    const view = this.buildingViews.get(b.id);
    view?.img.destroy();
    view?.sign?.destroy();
    this.buildingViews.delete(b.id);
    for (const i of clearPlot(this.map, b)) this.replaceObjectImage(i);
    this.buildings.remove(b);
    for (const i of this.buildings.footprint(b.type, b.tx, b.ty)) this.replaceObjectImage(i);
    this.territory.recompute(this.buildings.list);
    const back = summarizeCost(refund);
    this.toast(`${def.name} demolida${back ? `: voltaram ${back}` : ''}.`, '#cdb98e');
  }

  // ---------- build mode (driven by UIScene) ----------

  startPlacing(type: BuildingType): void {
    if (!this.relocating && !this.buildMenu().includes(type)) return;
    this.placement = { type, check: { ok: false, reason: '' } };
    this.ghost.setTexture(BUILDING_KEY[type]).setVisible(true);
    this.interaction = null;
  }

  cancelPlacing(): void {
    if (this.demolishing) this.cancelDemolish();
    this.movePicking = false;
    this.moveHint = null;
    this.movePick = null;
    this.relocating = null;
    if (this.commandPick) this.cancelCommandPick();
    if (this.plotFarm) this.cancelPlot();
    this.placement = null;
    this.ghost.setVisible(false);
  }

  /** Places a construction site at the ghost's position if valid. Returns true on success. */
  tryPlace(): boolean {
    if (!this.placement?.check.ok) return false;
    const { type } = this.placement;
    const def = BUILDING_DEFS[type];
    if (this.relocating) {
      const b = this.relocating;
      if (!payFrom(relocationCost(b), this.inventory, this.factions[b.faction].stock)) return false;
      this.relocate(b, this.placeTile.x, this.placeTile.y);
      this.cancelPlacing();
      return true;
    }
    const fid = this.buildFaction(type, this.placeTile.x, this.placeTile.y, def.size);
    if (!payFrom(def.cost, this.inventory, this.factions[fid].stock)) return false;
    if (type === 'colony') {
      this.foundColony(this.placeTile.x, this.placeTile.y);
      this.cancelPlacing();
      return true;
    }
    if (type === 'claim') {
      this.claimLand(this.placeTile.x, this.placeTile.y);
      this.cancelPlacing();
      return true;
    }
    if (type === 'road') {
      const i = tileIndex(this.map, this.placeTile.x, this.placeTile.y);
      this.map.objects[i] = Obj.Road;
      this.replaceObjectImage(i);
      return true;
    }
    const b = this.buildings.place(type, this.placeTile.x, this.placeTile.y, false, fid);
    this.territory.recompute(this.buildings.list);
    for (const i of this.buildings.footprint(type, b.tx, b.ty)) this.replaceObjectImage(i); // clears stumps/saplings
    const view = this.addBuildingView(b);
    this.events.emit('popup', {
      x: view.img.x,
      y: view.img.y - view.img.height,
      text: `Obra: ${def.name}`,
      color: '#ffe08a',
    } satisfies PopupEvent);
    if (!def.repeatPlace) this.cancelPlacing();
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

    let check = this.buildings.check(p.type, tx, ty, (i) => this.playerOverlapsTile(i), this.relocating ?? undefined);
    if (this.relocating) {
      // Moving: same rules as building, on the land of the building's own village, for half the price.
      const b = this.relocating;
      const payer = this.factions[b.faction];
      if (check.ok && !this.territory.canBuild(b.faction, tx, ty, def.size) && !(b.type === 'home' && !this.landNear(tx, ty, 0)))
        check = { ok: false, reason: `Fora do território de ${payer.name}` };
      if (check.ok && !this.canPay(relocationCost(b), payer))
        check = { ok: false, reason: `Recursos insuficientes: ${summarizeCost(relocationCost(b))}` };
      p.check = check;
      const bottom = gridToScreen(tx + def.size, ty + def.size);
      this.ghost.setPosition(bottom.x, bottom.y).setTint(check.ok ? 0xa8ffa8 : 0xff9090);
      this.drawFootprint(tx, ty, def.size, check.ok ? 0x8aff8a : 0xff6060);
      this.drawFootprint(b.tx, b.ty, def.size, 0xffe08a);
      return;
    }
    if (p.type === 'road') {
      // Roads may leave your land (to reach other villages), just not cross into theirs.
      const owner = this.territory.ownerAt(tx, ty);
      if (check.ok && this.map.objects[tileIndex(this.map, tx, ty)] === Obj.Road) check = { ok: false, reason: 'Já tem estrada' };
      if (check.ok && owner !== -1 && !this.isMine(owner)) check = { ok: false, reason: 'Território de outra vila' };
    } else if (p.type === 'colony') {
      const why = check.ok ? colonySiteOk(this.factions, tx, ty, (r) => this.landNear(tx, ty, r)) : null;
      if (why) check = { ok: false, reason: why };
    } else if (p.type === 'claim') {
      const why = check.ok ? this.claimSiteOk(tx, ty) : null;
      if (why) check = { ok: false, reason: why };
    } else if (p.type === 'home') {
      // Your house goes on land nobody owns (or your own).
      for (let y = ty; y < ty + def.size && check.ok; y++)
        for (let x = tx; x < tx + def.size && check.ok; x++) {
          const o = this.territory.ownerAt(x, y);
          if (o !== -1 && !this.isMine(o)) check = { ok: false, reason: 'Território de outra vila' };
        }
    } else if (check.ok && !this.territory.canBuild(this.buildFaction(p.type, tx, ty, def.size), tx, ty, def.size))
      check = { ok: false, reason: 'Fora do seu território' };
    const payer = this.factions[this.buildFaction(p.type, tx, ty, def.size)];
    if (check.ok && !this.canPay(def.cost, payer))
      check = { ok: false, reason: `Recursos insuficientes (mochila + estoque de ${payer.name})` };
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
      if (d.role === 'companion') text = `[E] ${d.name} · ${roleLabel(d.role, d.gender)}`;
      if (d.role === 'villager' && !this.isMine(d.faction)) text = `[E] ${d.name} · ${this.factions[d.faction].name}`;
      this.interaction = { x: npc.sprite.x, y: npc.sprite.y - npc.sprite.height - 6, text, progress: null };
      if (Phaser.Input.Keyboard.JustDown(this.keys.E)) {
        if (d.role === 'villager' && this.isMine(d.faction)) this.families.chat(d, this.clock.day);
        this.talkingTo = d;
        this.player.face(npc.sprite.x);
        this.events.emit('talk', d);
      }
      return;
    }

    const drop = this.inventoryOpen ? null : this.drops.nearest(this.player.gx, this.player.gy, 1.2);
    if (drop) {
      this.gatherer.tick(dt, null, false, 1);
      const view = this.dropViews.get(drop.id);
      const label = ITEM_DEFS[drop.item].label;
      const text = `[E] Pegar ${drop.count > 1 ? `${drop.count} ` : ''}${label}`;
      this.interaction = { x: view?.x ?? 0, y: (view?.y ?? 0) - 12, text, progress: null };
      if (Phaser.Input.Keyboard.JustDown(this.keys.E)) {
        const n = this.drops.take(drop, this.inventory);
        if (n > 0) sound.play('pickup');
        if (n === 0) this.popup(view?.x ?? 0, (view?.y ?? 0) - 12, 'Não cabe na mochila', '#ffb070');
        else this.popup(view?.x ?? 0, (view?.y ?? 0) - 12, `+${n} ${label}`);
        if (drop.count <= 0) this.removeDropView(drop);
        else view?.setData('count', drop.count);
      }
      return;
    }

    const carcass = this.inventoryOpen ? null : this.wildlife.nearestCarcass(this.player.gx, this.player.gy, 1.2);
    if (carcass) {
      this.gatherer.tick(dt, null, false, 1);
      const s = carcass.sprite;
      const meat = carcass.data.meat;
      const leather = carcass.data.leather ?? 0;
      const room = (meat > 0 ? this.inventory.space('meat') : 0) + (leather > 0 ? this.inventory.space('leather') : 0);
      const name = carcass.def.name.toLowerCase();
      const what = [meat > 0 ? `${meat} carne` : '', leather > 0 ? `${leather} couro` : ''].filter(Boolean).join(', ');
      const land = this.forbiddenLand(carcass.data.gx, carcass.data.gy);
      const text = land
        ? `Terras de ${land}: não é seu`
        : room > 0
          ? `[E] Esfolar ${name} (${what})`
          : 'Peso máximo! Leve ao estoque';
      this.interaction = { x: s.x, y: s.y - 14, text, progress: null };
      if (!land && room > 0 && Phaser.Input.Keyboard.JustDown(this.keys.E)) {
        const id = carcass.data.id;
        const m = meat > 0 ? this.inventory.add('meat', this.wildlife.takeMeat(id, this.inventory.space('meat'))) : 0;
        const l = leather > 0 ? this.inventory.add('leather', this.wildlife.takeLeather(id, this.inventory.space('leather'))) : 0;
        this.popup(s.x, s.y - 14, [m ? `+${m} Carne` : '', l ? `+${l} Couro` : ''].filter(Boolean).join('  '));
        sound.play('pull');
      }
      return;
    }

    // With a shovel in hand, stumps and saplings can be dug out too.
    const digging = this.selectedTool('shovel') !== null;
    const accept = (o: Obj) => isInteractable(o) || (digging && (o === Obj.Stump || o === Obj.Sapling));
    const target = this.inventoryOpen ? null : nearestTile(this.map, this.player.gx, this.player.gy, INTERACT_REACH, accept);

    if (target === null) {
      this.gatherer.tick(dt, null, false, 1);
      this.interaction = null;
      return;
    }

    if (this.map.objects[target] === Obj.Building || this.map.objects[target] === Obj.Gate) {
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
    if (obj === Obj.Stump || obj === Obj.Sapling) {
      const shovel = this.selectedTool('shovel')!;
      const land = this.forbiddenLand(tx, ty);
      const active = this.keys.E.isDown && !moving && !land;
      if (active) this.player.face(anchorX);
      const seconds = 1.2 / this.stats.gatherSpeed;
      if (this.gatherer.tick(dt, target, active, seconds) && this.nodes.dig(target)) {
        sound.play('dig');
        this.wearTool(shovel.slot);
        this.replaceObjectImage(target);
        this.gainXp(XP.gather);
        this.popup(anchorX, anchorY, 'Arrancado', '#cdb98e');
      }
      const what = obj === Obj.Stump ? 'toco' : 'muda';
      this.interaction = {
        x: anchorX,
        y: anchorY,
        text: land ? `Terras de ${land}: não é seu` : `[segure E] Arrancar ${what} (não cresce mais)`,
        progress: active ? this.gatherer.progress / seconds : null,
      };
      return;
    }
    if (obj === Obj.CropRipe) {
      this.gatherer.tick(dt, null, false, 1);
      this.interaction = { x: anchorX, y: anchorY + img!.height - 8, text: '[E] Colher', progress: null };
      if (Phaser.Input.Keyboard.JustDown(this.keys.E)) this.harvestByHand(target);
      return;
    }
    const def = NODE_DEFS[obj]!;
    const tool = def.tool ? this.selectedTool(def.tool) : null;
    const full = this.inventory.space(def.resource) <= 0;
    const missingTool = def.needsTool && !tool;
    const land = this.forbiddenLand(tx, ty);
    const active = this.keys.E.isDown && !moving && !full && !missingTool && !land;
    if (active) this.player.face(anchorX);

    const seconds = def.secondsPerUnit / (this.stats.gatherSpeed * (tool ? ITEM_DEFS[tool.item].tool!.speed : 1));
    if (this.gatherer.tick(dt, target, active, seconds)) this.harvest(target, tool?.slot);

    const left = this.nodes.remainingAt(target);
    const toolName = tool ? ` · ${ITEM_DEFS[tool.item].label}` : '';
    let text = `[segure E] ${def.verb} ${def.name} (${left})${toolName}`;
    if (full) text = 'Peso máximo! Leve ao estoque';
    if (missingTool) text = `Precisa de uma picareta na hotbar (C: criar)`;
    if (land) text = `Terras de ${land}: não é seu`;
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
      sound.play('levelup');
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
      sound.play('build');
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
    if (!this.isMine(b.faction)) {
      this.drawFootprint(b.tx, b.ty, def.size, this.factions[b.faction].color);
      this.interaction = { x, y, text: `${this.factions[b.faction].name} · ${def.name}`, progress: null };
      return;
    }
    this.drawFootprint(b.tx, b.ty, def.size, 0xffe08a);

    if (!b.built) {
      const active = this.keys.E.isDown && !moving;
      if (active) {
        this.player.face(x);
        this.hammer -= dt;
        if (this.hammer <= 0) {
          this.hammer = 0.45;
          sound.play('build');
        }
        if (this.buildings.work(b, dt)) {
          sound.play('complete');
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

    if (b.hp < def.maxHp) {
      const active = this.keys.E.isDown && !moving;
      if (active) {
        this.player.face(x);
        this.repairAcc += REPAIR_RATE * dt;
        while (this.repairAcc >= 10) {
          if (!payFrom({ wood: 1 }, this.inventory, this.stockpile)) {
            this.repairAcc = 0;
            break;
          }
          this.repairAcc -= 10;
          this.buildings.repair(b, 10);
        }
      }
      this.interaction = {
        x,
        y,
        text: `[segure E] Reparar ${def.name} (${b.hp}/${def.maxHp}) · 1 madeira a cada 10`,
        progress: active ? b.hp / def.maxHp : null,
      };
      if (!def.deposit || def.job || !Phaser.Input.Keyboard.JustDown(this.keys.E)) return;
    }

    if (def.deposit && !def.job) {
      // The village's stock (stockpile resources + tool warehouse) is reachable from any deposit building
      // (the market has jobs: its panel opens instead, with a button for the stock).
      if (Phaser.Input.Keyboard.JustDown(this.keys.E))
        this.openStorage(`Estoque · ${this.factions[b.faction].name}`, villageStorage(this.factions[b.faction]));
      this.interaction = { x, y, text: `[E] Estoque da vila`, progress: null };
      return;
    }
    if (!def.job && b.type !== 'house' && b.type !== 'home') {
      // Towers, walls, gates…: just their own inventory.
      if (Phaser.Input.Keyboard.JustDown(this.keys.E)) this.openStorage(def.name, buildingStorage(b));
      this.interaction = { x, y, text: `[E] ${def.name} · inventário`, progress: null };
      return;
    }

    let text = `${def.name}: ${def.description}`;
    if (def.job) text = `[E] ${def.name} (${this.population.workers(b.id).length}/${def.job.slots} trabalhando)`;
    else if (b.type === 'house') text = `[E] ${def.name} (${this.population.residents(b.id).length}/${BEDS_PER_HOUSE} moradores)`;
    else if (b.type === 'home') text = `[E] ${def.name}${this.clock.isNight ? ' · dormir' : ''}`;
    this.interaction = { x, y, text, progress: null };
    if ((def.job || b.type === 'house' || b.type === 'home') && Phaser.Input.Keyboard.JustDown(this.keys.E)) {
      this.panelBuilding = b;
      this.events.emit('building', b);
    }
  }

  /** Diplomatic status with a rival village, for the UI (diplomacy arrives in milestone 15). */
  relationLabel(faction: number): string {
    if (!this.factions[faction]?.alive) return '—';
    const r = this.diplomacy.get(PLAYER_FACTION, faction);
    const name = { peace: 'Paz', alliance: 'Aliança', war: 'Guerra' }[r.status];
    return `${name} (${r.score > 0 ? '+' : ''}${Math.round(r.score)})`;
  }

  /** Age for the UI (families arrive in milestone 14). */
  ageLabel(n: NpcData): string {
    const age = ageOf(n, this.clock.seconds);
    return age < ADULT_AGE ? `${age} (criança)` : `${age}`;
  }

  private updateFamilies(worldDt: number): void {
    const events = this.families.update(worldDt, {
      now: this.clock.seconds,
      rng: Math.random,
      playerFaction: PLAYER_FACTION,
      together: (a, b) => {
        if (a.homeId !== null && a.homeId === b.homeId) return true;
        const ea = this.npcs.get(a.id);
        const eb = this.npcs.get(b.id);
        return !!ea && !!eb && Math.hypot(ea.gx - eb.gx, ea.gy - eb.gy) < 4;
      },
      hasFood: (f) => (this.factions[f]?.stock.items.meat ?? 0) >= 4,
    });
    for (const e of events) {
      if (e.type === 'married') {
        if (this.isMine(e.a.faction) && e.b) this.toast(`${fullName(e.a)} e ${fullName(e.b)} se casaram!`, '#ffb0d0');
      } else if (e.type === 'born') {
        const c = e.child;
        this.spawnVillagerEntity(c);
        if (this.isMine(c.faction)) {
          const parents = c.parents
            .map((id) => (id === PLAYER_ID ? 'você' : (this.population.person(id)?.name ?? '?')))
            .join(' e ');
          this.toast(`Nasceu ${fullName(c)}, ${c.gender === 'f' ? 'filha' : 'filho'} de ${parents}!`, '#ffb0d0');
        }
      } else if (e.type === 'died') {
        const mine = this.isMine(e.npc.faction);
        this.removeVillager(e.npc.id, mine ? `${fullName(e.npc)} morreu de velhice aos ${e.age} anos.` : null);
      }
    }
  }

  /** Player marriage proposal (from the villager card). */
  propose(npc: NpcData): boolean {
    const ok = this.families.propose(npc, this.clock.seconds);
    if (ok) this.toast(`Você e ${fullName(npc)} se casaram!`, '#ffb0d0');
    return ok;
  }

  /** Building condition for the UI (building HP arrives in milestone 13). */
  buildingHealthLabel(b: Building): string {
    const max = BUILDING_DEFS[b.type].maxHp;
    return b.hp >= max ? 'pronto' : `vida ${b.hp}/${max}`;
  }

  /** Opens a villager's card from another panel (management screen). */
  openNpcCard(n: NpcData): void {
    this.talkingTo = n;
    this.events.emit('talk', n);
  }

  /** Opens a building's panel from another panel (management screen). */
  openBuildingPanel(b: Building): void {
    this.panelBuilding = b;
    this.events.emit('building', b);
  }

  /** Opens the two-column storage screen (UIScene listens for 'storage'). */
  openStorage(title: string, storage: Storage): void {
    this.events.emit('storage', { title, storage });
  }

  /** A building's own inventory, for the building panel's "Inventário" button. */
  storageOf(b: Building): Storage {
    // Before you have a village, your house is your larder: what you store there is your stock
    // (it pays for claiming land, and becomes the village's stock afterwards).
    if (b.type === 'home' && !this.settled) return villageStorage(this.factions[PLAYER_FACTION]);
    return buildingStorage(b);
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
    const kind = NODE_DEFS[this.map.objects[i]]?.resource;
    const result = this.nodes.harvest(i);
    if (!result) return;
    if (result.resource) this.inventory.add(result.resource);
    sound.play(kind === 'wood' ? 'chop' : kind === 'seed' ? 'pull' : 'mine');
    if (toolSlot !== undefined) this.wearTool(toolSlot);
    this.gainXp(XP.gather);

    const img = this.objectImages.get(i);
    if (img) {
      this.events.emit('popup', {
        x: img.x,
        y: img.y - img.height,
        text: result.resource ? `+1 ${RESOURCE_LABEL[result.resource]}` : 'Nada',
        color: result.resource ? undefined : '#a8977a',
      } satisfies PopupEvent);
      this.tweens.add({ targets: img, x: img.x + 1, duration: 40, yoyo: true, repeat: 1 });
    }

    if (result.depleted) this.replaceObjectImage(i);
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
    if (this.map.objects[i] === Obj.Road) {
      // Roads lie flat on the ground, under everything that stands.
      this.objectImages.set(i, this.add.image(c.x, c.y, key).setDepth(GROUND_DEPTH + 0.5));
      return;
    }
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
    if (b.built && (b.type === 'stockpile' || b.type === 'embassy')) {
      // Each village hall flies its faction's banner.
      view.sign = this.add
        .image(view.img.x + 6, view.img.y - view.img.height + 2, 'flag')
        .setOrigin(0.2, 1)
        .setTint(this.factions[b.faction]?.color ?? 0xffffff);
    } else if (b.built && b.type === 'barracks') {
      view.sign = this.add.image(view.img.x, view.img.y - view.img.height - 3, 'icon_iron_sword').setOrigin(0.5, 1);
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
