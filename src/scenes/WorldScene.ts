import Phaser from 'phaser';
import {
  ADULT_AGE,
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
  RAID_INTERVAL,
  REPAIR_RATE,
  TILE_H,
  TILE_W,
  WANDERER_STAY,
  ZOOM_LEVELS,
} from '../config';
import type { Animal, Human } from '../entities/Animal';
import { Npc, type NpcWorld, type Target } from '../entities/Npc';
import { Player } from '../entities/Player';
import { BUILDING_DEFS, type Building, Buildings, type BuildingType, type PlaceCheck } from '../game/buildings';
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
import { createFactions, type Faction, PLAYER_FACTION } from '../game/factions';
import { ageOf, Families, fullName, isAdult, PLAYER_ID } from '../game/families';
import { Gatherer, NODE_DEFS, nearestTile, ResourceNodes } from '../game/gathering';
import { Inventory, RESOURCE_LABEL, RESOURCES, type Resource } from '../game/inventory';
import { ITEM_DEFS, type ItemId, type Recipe, type ToolType } from '../game/items';
import { isStarving, updateNeeds } from '../game/needs';
import {
  compass,
  generateWanderer,
  jobTitle,
  maxHpOf,
  type NpcData,
  Population,
  payFrom,
  pickSpawnTile,
  WandererSpawner,
} from '../game/npcs';
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
  palisade: 'bld_palisade',
  gate: 'bld_gate',
  tower: 'bld_tower',
  barracks: 'bld_barracks',
  embassy: 'bld_embassy',
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

/** A diplomat's trip: going → talking → returning. */
export interface Mission {
  diplomatId: number;
  kind: MissionKind;
  target: number;
  phase: 'going' | 'talking' | 'returning';
  timer: number;
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

const isInteractable = (o: Obj) => o === Obj.Building || o === Obj.Gate || NODE_DEFS[o] !== undefined;

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
    this.modalOpen = false;
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
    this.population.now = () => this.clock.seconds;
    this.families = new Families(this.population);
    this.diplomacy = new Diplomacy();
    this.missions = new Map();
    this.raidTimers = new Map();
    this.diploTimer = 0;
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
      findHostile: (f, gx, gy, r) => this.findHostile(f, gx, gy, r),
      atWar: (a, b) => this.atWar(a, b),
      raidTarget: (npc, target) => this.raidTarget(npc, target),
      attackBuilding: (npc, b, dmg) => this.damageBuilding(b, dmg, npc.data.faction),
      mission: (id) => this.missions.get(id) ?? null,
      missionArrived: (id) => {
        const m = this.missions.get(id);
        if (m) {
          m.phase = 'talking';
          m.timer = 6;
        }
      },
      missionDone: (id) => this.missions.delete(id),
      missionFailed: (id) => {
        const n = this.population.person(id);
        this.missions.delete(id);
        this.toast(`${n?.name ?? 'O diplomata'} não encontrou caminho até a outra vila.`, '#ffb070');
      },
      factionCenter: (f) => this.factions[f].center,
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
        f.stock.add('meat', 20);
        for (const n of populateTown(this.population, this.buildings, f, Math.random, 8, this.clock.seconds))
          this.spawnVillagerEntity(n);
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
      families: { affinity: { ...this.families.affinity }, chattedOn: { ...this.families.chattedOn } },
      diplomacy: this.diplomacy.snapshot(),
      missions: [...this.missions.values()].map((m) => ({ ...m })),
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
    this.families.affinity = { ...save.families.affinity };
    this.families.chattedOn = { ...save.families.chattedOn };
    this.diplomacy.restore(save.diplomacy);
    for (const m of save.missions) this.missions.set(m.diplomatId, { ...m });
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
    this.updateDefenses(worldDt);
    this.drawBuildingHealth();
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
    this.hurtHuman(target, damage, `um ${animal.def.name.toLowerCase()}`);
  }

  /** Damage to the player or a villager from `source` (e.g. "um lobo"). */
  private hurtHuman(target: Human, damage: number, source: string): void {
    if (target.kind === 'player') {
      const p = this.player.sprite;
      this.popup(p.x, p.y - p.height, `-${damage}`, '#ff6a5a');
      p.setTint(0xff7060);
      this.time.delayedCall(150, () => p.clearTint());
      this.cameras.main.shake(80, 0.004);
      if (this.stats.hurt(damage)) this.knockOut(source);
      return;
    }
    const npc = this.npcs.get(target.id);
    if (!npc) return;
    npc.data.hp -= damage;
    npc.sprite.setTint(0xff7060);
    this.time.delayedCall(150, () => npc.sprite.clearTint());
    this.popup(npc.sprite.x, npc.sprite.y - npc.sprite.height, `-${damage}`, '#ff6a5a');
    if (npc.data.hp <= 0) {
      const mine = npc.data.faction === PLAYER_FACTION;
      this.removeVillager(npc.data.id, mine ? `${npc.data.name} foi morto por ${source}.` : null);
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
    if (this.stats.hp >= this.stats.maxHp) return;
    if (this.inventory.remove('meat', 1) === 0) {
      this.popup(p.x, p.y - p.height, 'Sem carne na mochila', '#cfc3a8');
      return;
    }
    this.stats.heal(MEAT_HEAL);
    this.popup(p.x, p.y - p.height, `+${MEAT_HEAL} ♥`, '#a8ffa8');
  }

  /** The player's HP hit zero: wake up at the village, losing carried resources (tools are kept). */
  private knockOut(source: string): void {
    const lost = this.inventory.takeAllResources();
    const any = RESOURCES.some((r) => lost[r] > 0);
    const c = this.villageCenter;
    this.player.gx = c.x - 1;
    this.player.gy = c.y + 1.5;
    this.stats.hp = this.stats.maxHp;
    this.cameras.main.flash(400, 120, 0, 0);
    const lostText = any ? ' e perdeu os recursos que carregava' : '';
    this.toast(`Você foi derrubado por ${source}. Acordou na vila${lostText}.`, '#ff8a7a');
  }

  /** Are two factions at war? (Diplomacy arrives in milestone 15.) */
  atWar(a: number, b: number): boolean {
    return this.diplomacy.atWar(a, b);
  }

  // ---------- diplomacy & war ----------

  /** Diplomats (at your embassies) who are free for a mission, best Diplomacia rating first. */
  freeDiplomats(): NpcData[] {
    const embassies = this.buildings.list.filter((b) => b.faction === PLAYER_FACTION && b.type === 'embassy' && b.built);
    return embassies
      .flatMap((e) => this.population.workers(e.id))
      .filter((n) => !this.missions.has(n.id) && this.npcs.has(n.id))
      .sort((a, b) => b.skills.diplomacy - a.skills.diplomacy);
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
    const ids = this.factions.filter((f) => f.alive).map((f) => f.id);
    for (const e of this.diplomacy.declareWar(PLAYER_FACTION, target, ids, 'declarada por você'))
      if (e.type === 'war') this.announceWar(e.a, e.b);
  }

  /** Orders every healthy soldier of yours to march on `target`. Returns how many went. */
  orderAttack(target: number): number {
    let n = 0;
    for (const s of this.soldiers()) {
      if (s.hp > 3 && isAdult(s, this.clock.seconds)) {
        s.order = { kind: 'raid', target };
        n++;
      }
    }
    if (n > 0) this.toast(`${n} soldado(s) marchando contra ${this.factions[target].name}!`, '#ffb070');
    return n;
  }

  recallSoldiers(): void {
    for (const s of this.soldiers()) s.order = null;
    this.toast('Seus soldados estão voltando ao quartel.', '#cfc3a8');
  }

  answerProposal(p: Proposal, accept: boolean): void {
    this.diplomacy.answer(p, accept);
    const name = this.factions[p.from].name;
    if (!accept) this.toast(`Você recusou a proposta de ${name}.`, '#cfc3a8');
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
    if (winner === PLAYER_FACTION) {
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
      if (!d || !this.factions[m.target].alive) {
        this.missions.delete(m.diplomatId);
        continue;
      }
      if (m.phase !== 'talking') continue;
      m.timer -= worldDt;
      if (m.timer > 0) continue;
      m.phase = 'returning';
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
      const ids = this.factions.filter((f) => f.alive).map((f) => f.id);
      const touching = this.touchingBorders();
      for (const e of this.diplomacy.daily(ids, this.clock.seconds, Math.random, (a, b) =>
        touching.has(`${Math.min(a, b)}:${Math.max(a, b)}`),
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
        const k = `${f.id}>${e.id}`;
        const t = (this.raidTimers.get(k) ?? 0) + worldDt;
        this.raidTimers.set(k, t);
        if (t < RAID_INTERVAL) continue;
        this.raidTimers.set(k, 0);
        const ready = this.soldiers(f.id).filter((s) => s.order === null && s.hp > 4 && isAdult(s, this.clock.seconds));
        const go = ready.length > 2 ? ready.slice(0, ready.length - 1) : ready;
        for (const s of go) s.order = { kind: 'raid', target: e.id };
        if (go.length > 0 && e.id === PLAYER_FACTION)
          this.toast(`Soldados de ${f.name} estão marchando contra sua vila!`, '#ff6a5a');
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
  findHostile(faction: number, gx: number, gy: number, r: number): Target | null {
    let best: Target | null = null;
    let bestD = r;
    const a = this.wildlife.nearestHostile(gx, gy, r);
    if (a) {
      best = { kind: 'animal', id: a.data.id, gx: a.data.gx, gy: a.data.gy };
      bestD = Math.hypot(a.data.gx - gx, a.data.gy - gy);
    }
    for (const n of this.npcs.values()) {
      if (n.data.role !== 'villager' || !this.atWar(faction, n.data.faction) || this.missions.has(n.data.id)) continue;
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
      const threatened = this.factions.some(
        (o) => o.id !== f.id && o.alive && (this.atWar(f.id, o.id) || this.diplomacy.get(f.id, o.id).score < -30),
      );
      const hasBarracks = this.buildings.list.some((b) => b.faction === f.id && b.type === 'barracks');
      if (threatened && !hasBarracks && f.stock.canAfford(BUILDING_DEFS.barracks.cost)) {
        const spot = findSpot(this.buildings, 'barracks', f.center, 3, 10, Math.random);
        if (spot && this.territory.canBuild(f.id, spot.x, spot.y, 2)) {
          f.stock.pay(BUILDING_DEFS.barracks.cost);
          this.addBuildingView(this.buildings.place('barracks', spot.x, spot.y, true, f.id));
          this.territory.recompute(this.buildings.list);
        }
      }
      if (threatened && hasBarracks && this.soldiers(f.id).length < 2) {
        const barracks = this.buildings.list.find((b) => b.faction === f.id && b.type === 'barracks')!;
        const pool = this.population
          .villagersOf(f.id)
          .filter((n) => isAdult(n, this.clock.seconds) && this.buildings.list.find((b) => b.id === n.jobId)?.type !== 'barracks')
          .sort((a, b) => b.skills.combat - a.skills.combat);
        for (const n of pool) {
          if (this.soldiers(f.id).length >= 2) break;
          n.jobId = null;
          this.population.assign(n, barracks);
        }
      }
      const hasTower = this.buildings.list.some((b) => b.faction === f.id && b.type === 'tower');
      if (!hasTower && f.stock.canAfford(BUILDING_DEFS.tower.cost)) {
        const spot = findSpot(this.buildings, 'tower', f.center, 4, 9, Math.random);
        if (spot && this.territory.canBuild(f.id, spot.x, spot.y, 1)) {
          f.stock.pay(BUILDING_DEFS.tower.cost);
          this.addBuildingView(this.buildings.place('tower', spot.x, spot.y, true, f.id));
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
      const childFactor = (n: NpcData) => (ageOf(n, this.clock.seconds) < ADULT_AGE ? 0.5 : 1);
      for (const e of updateNeeds(this.population.villagersOf(f.id), f.stock, worldDt, childFactor)) {
        if (!f.isPlayer) {
          if (e.type === 'died') this.removeVillager(e.npc.id, null);
        } else if (e.type === 'starving') this.toast(`${e.npc.name} está com fome! Falta carne no estoque.`, '#ffb070');
        else this.removeVillager(e.npc.id, `${e.npc.name} morreu de fome.`);
      }
    }
    this.updateTowns(worldDt);
    this.updateFamilies(worldDt);
    this.updateDiplomacy(worldDt);

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
    const data = generateWanderer(Math.random, this.population.newId(), this.clock.seconds + WANDERER_STAY, this.clock.seconds);
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
        if (d.role === 'villager' && d.faction === PLAYER_FACTION) this.families.chat(d, this.clock.day);
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
      if (!def.deposit || !Phaser.Input.Keyboard.JustDown(this.keys.E)) return;
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
        if (e.a.faction === PLAYER_FACTION && e.b) this.toast(`${fullName(e.a)} e ${fullName(e.b)} se casaram!`, '#ffb0d0');
      } else if (e.type === 'born') {
        const c = e.child;
        this.spawnVillagerEntity(c);
        if (c.faction === PLAYER_FACTION) {
          const parents = c.parents
            .map((id) => (id === PLAYER_ID ? 'você' : (this.population.person(id)?.name ?? '?')))
            .join(' e ');
          this.toast(`Nasceu ${fullName(c)}, ${c.gender === 'f' ? 'filha' : 'filho'} de ${parents}!`, '#ffb0d0');
        }
      } else if (e.type === 'died') {
        const mine = e.npc.faction === PLAYER_FACTION;
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
