import Phaser from 'phaser';
import type { Building } from '../game/buildings';
import { RESOURCE_LABEL, RESOURCES, type Resource } from '../game/inventory';
import { foodDays } from '../game/needs';
import type { NpcData } from '../game/npcs';
import { MAX_LEVEL, xpToNext } from '../game/player';
import type { Storage } from '../game/storage';
import { ambientAt, formatClock } from '../game/time';
import { BuildingPanelUI } from '../ui/BuildingPanelUI';
import { BuildMenuUI } from '../ui/BuildMenuUI';
import { CraftingUI } from '../ui/CraftingUI';
import { renderDiplomacy } from '../ui/DiplomacyTab';
import { renderDynasty } from '../ui/DynastyTab';
import { FullMapUI } from '../ui/FullMapUI';
import { InventoryUI } from '../ui/InventoryUI';
import { ManagementUI } from '../ui/ManagementUI';
import { Minimap } from '../ui/Minimap';
import { OrdersPanelUI } from '../ui/OrdersPanelUI';
import { PauseMenuUI } from '../ui/PauseMenuUI';
import { PeddleUI } from '../ui/PeddleUI';
import { RecruitDialogUI } from '../ui/RecruitDialogUI';
import { StoragePanelUI } from '../ui/StoragePanelUI';
import { renderTrade } from '../ui/TradeTab';
import type { PopupEvent, ToastEvent, WorldScene } from './WorldScene';

const TOAST_SECONDS = 5;

const TEXT = {
  fontFamily: '"Alegreya", Georgia, serif',
  fontSize: '14px',
  color: '#e8d8b0',
} satisfies Phaser.Types.GameObjects.Text.TextStyle;

const POPUP_SECONDS = 1.1;

interface Popup {
  text: Phaser.GameObjects.Text;
  wx: number;
  wy: number;
  age: number;
}

/**
 * Screen-space overlay (unaffected by the world camera's zoom). Reads state from WorldScene.
 * Draw order: night tint → world-anchored prompts/popups → HUD → inventory panel.
 */
export class UIScene extends Phaser.Scene {
  private world!: WorldScene;
  private night!: Phaser.GameObjects.Rectangle;
  private vignette!: Phaser.GameObjects.Image;
  private counts = {} as Record<Resource, Phaser.GameObjects.Text>;
  private clockText!: Phaser.GameObjects.Text;
  private debug!: Phaser.GameObjects.Text;
  private prompt!: Phaser.GameObjects.Text;
  private bar!: Phaser.GameObjects.Graphics;
  private inventory!: InventoryUI;
  private minimap!: Minimap;
  private fullMap!: FullMapUI;
  private management!: ManagementUI;
  private pause!: PauseMenuUI;
  private crafting!: CraftingUI;
  private levelText!: Phaser.GameObjects.Text;
  private hpBar!: Phaser.GameObjects.Graphics;
  private hpText!: Phaser.GameObjects.Text;
  private foodText!: Phaser.GameObjects.Text;
  private buildMenu!: BuildMenuUI;
  private placeHint!: Phaser.GameObjects.Text;
  private dialog!: RecruitDialogUI;
  private panel!: BuildingPanelUI;
  private storagePanel!: StoragePanelUI;
  private peddle!: PeddleUI;
  private orders!: OrdersPanelUI;
  private popText!: Phaser.GameObjects.Text;
  private popups: Popup[] = [];
  private toasts: { text: Phaser.GameObjects.Text; age: number }[] = [];

  constructor() {
    super('UI');
  }

  create(): void {
    this.world = this.scene.get('World') as WorldScene;
    // This scene restarts whenever the world does (loading a save). The world's event emitter
    // survives restarts, so drop listeners from the previous run before adding new ones.
    for (const e of ['popup', 'toast', 'talk', 'building', 'storage', 'peddle']) this.world.events.off(e);
    this.popups = [];
    this.toasts = [];

    // Full-screen tint for the day/night cycle. Created first so it sits under all HUD elements.
    this.night = this.add.rectangle(0, 0, 10, 10, 0x000000, 0).setOrigin(0);
    // Dark vignette around the screen edges, for a candle-lit, medieval mood.
    if (!this.textures.exists('vignette')) {
      const tex = this.textures.createCanvas('vignette', 256, 256)!;
      const ctx = tex.getContext();
      const g = ctx.createRadialGradient(128, 128, 60, 128, 128, 182);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(8,5,2,0.78)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 256, 256);
      tex.refresh();
    }
    this.vignette = this.add.image(0, 0, 'vignette').setOrigin(0);

    this.prompt = this.add
      .text(0, 0, '', { ...TEXT, fontSize: '13px', backgroundColor: '#000000aa', padding: { x: 6, y: 3 } })
      .setOrigin(0.5, 1)
      .setVisible(false);
    this.bar = this.add.graphics();

    // Resource bar: stockpile totals.
    const panel = this.add.rectangle(8, 8, 0, 36, 0x000000, 0.55).setOrigin(0, 0);
    let x = 18;
    for (const r of RESOURCES) {
      this.add.image(x, 26, `icon_${r}`).setScale(2).setOrigin(0, 0.5);
      this.counts[r] = this.add.text(x + 20, 26, '', TEXT).setOrigin(0, 0.5);
      x += r === 'meat' ? 170 : r === 'seed' ? 124 : 112; // meat also shows days of food left
    }
    this.add.image(x, 26, 'icon_person').setScale(2).setOrigin(0, 0.5);
    this.popText = this.add.text(x + 20, 26, '', TEXT).setOrigin(0, 0.5);
    x += 160;
    panel.width = x - 8;

    this.clockText = this.add.text(0, 8, '', { ...TEXT, backgroundColor: '#00000088', padding: { x: 10, y: 9 } }).setOrigin(1, 0);
    this.add.text(
      12,
      52,
      'WASD andar · clique atacar · E usar · F comer · F1 ordens · G largar · B construir · C criar · I inventário · V vila · M mapa · T acelerar',
      { ...TEXT, fontSize: '12px', backgroundColor: '#00000088', padding: { x: 8, y: 5 } },
    );
    this.debug = this.add.text(12, 80, '', { ...TEXT, fontSize: '11px', color: '#cdb98e' });

    this.inventory = new InventoryUI(this, this.world.inventory, {
      get: () => this.world.selectedHotbar,
      set: (i) => (this.world.selectedHotbar = i),
    });

    this.buildMenu = new BuildMenuUI(
      this,
      (r) => this.world.inventory.count(r) + this.world.currentVillage().stock.items[r],
      () => this.world.buildMenu(),
      () => this.world.buildMenuHint(),
      (type) => {
        this.buildMenu.setOpen(false);
        this.world.startPlacing(type);
      },
      () => {
        this.buildMenu.setOpen(false);
        this.world.startDemolish();
      },
    );
    this.placeHint = this.add
      .text(0, 0, '', { ...TEXT, fontSize: '12px', backgroundColor: '#000000bb', padding: { x: 6, y: 3 } })
      .setDepth(95)
      .setVisible(false);

    this.minimap = new Minimap(this, this.world);
    this.crafting = new CraftingUI(this, this.world);
    this.levelText = this.add
      .text(0, 0, '', { ...TEXT, fontSize: '12px', color: '#ffe08a', stroke: '#000000', strokeThickness: 3 })
      .setOrigin(1, 1);
    this.hpBar = this.add.graphics();
    this.hpText = this.add.text(0, 0, '', { ...TEXT, fontSize: '12px', stroke: '#000000', strokeThickness: 3 }).setOrigin(0, 1);
    this.foodText = this.add.text(0, 0, '', { ...TEXT, fontSize: '11px', stroke: '#000000', strokeThickness: 3 }).setOrigin(0, 1);

    this.dialog = new RecruitDialogUI(this, this.world, () => this.world.stopTalking());
    this.world.events.on('talk', (npc: NpcData) => {
      if (this.inventory.isOpen) this.toggleInventory();
      this.closeBuildMode();
      this.dialog.open(npc);
    });

    this.storagePanel = new StoragePanelUI(this, this.world);
    this.peddle = new PeddleUI(this, this.world);
    this.orders = new OrdersPanelUI(this, this.world);
    this.world.events.on('peddle', (faction: number) => {
      if (this.inventory.isOpen) this.toggleInventory();
      this.closeBuildMode();
      this.peddle.open(faction);
    });
    this.world.events.on('storage', (e: { title: string; storage: Storage }) => {
      if (this.inventory.isOpen) this.toggleInventory();
      this.closeBuildMode();
      this.storagePanel.open(e.title, e.storage);
    });
    this.panel = new BuildingPanelUI(this, this.world, () => this.world.closeBuildingPanel());
    this.world.events.on('building', (b: Building) => {
      if (this.inventory.isOpen) this.toggleInventory();
      this.closeBuildMode();
      this.panel.open(b);
    });

    const kb = this.input.keyboard!;
    kb.addCapture('TAB,F1,F2');
    this.pause = new PauseMenuUI(this, this.world);
    this.fullMap = new FullMapUI(this, this.world);
    this.management = new ManagementUI(
      this,
      this.world,
      (n) => this.world.openNpcCard(n),
      (b) => this.world.openBuildingPanel(b),
    );
    this.management.renderers.dynasty = renderDynasty;
    this.management.renderers.trade = (ui, x, y, w) => renderTrade(ui, x, y, w);
    this.management.renderers.diplomacy = (ui, x, y, w) => renderDiplomacy(ui, x, y, w);
    kb.on('keydown', (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (this.pause.isOpen) {
        if (key === 'escape' && !this.pause.back()) this.pause.close();
        return;
      }
      if (this.peddle.isOpen) {
        if (key === 'escape' || key === 'e') this.peddle.close();
        return;
      }
      if (this.storagePanel.isOpen) {
        if (key === 'escape') this.storagePanel.close();
        else if (key === 'e') this.storagePanel.depositAll();
        return;
      }
      if (this.panel.isOpen) {
        if (key === 'escape' || key === 'e') this.panel.close();
        return;
      }
      if (this.dialog.isOpen) {
        if (key === 'enter') this.dialog.confirm();
        else if (key === 'escape' || key === 'e') this.dialog.close();
        return;
      }
      if (this.fullMap.isOpen) {
        if (key === 'escape' || key === 'm') this.fullMap.close();
        return;
      }
      if (this.management.isOpen) {
        if (key === 'escape' || key === 'v') this.management.close();
        return;
      }
      // F1: the quick-orders table (F1 again: follow me, F2: stay). Walking keeps working meanwhile.
      if (key === 'f1') {
        if (this.orders.isOpen) this.orders.order('follow');
        else this.orders.open();
        return;
      }
      if (key === 'f2') {
        if (this.orders.isOpen) this.orders.order('stay');
        return;
      }
      if (this.orders.isOpen && key === 'escape') {
        this.orders.close();
        return;
      }
      if (key === 'm') {
        this.closeBuildMode();
        if (this.inventory.isOpen) this.toggleInventory();
        this.fullMap.open();
        return;
      }
      if (key === 'v') {
        if (!this.world.settled) {
          this.world.toast('Você ainda não tem uma vila. Construa sua casa e reivindique terras (B).', '#ffc060');
          return;
        }
        this.closeBuildMode();
        if (this.inventory.isOpen) this.toggleInventory();
        this.management.open();
        return;
      }
      if (key === 'i' || key === 'tab') {
        this.closeBuildMode();
        this.toggleInventory();
      } else if (key === 'x') {
        if (this.inventory.isOpen) this.toggleInventory();
        const was = this.world.demolishing;
        this.closeBuildMode();
        if (!was) this.world.startDemolish();
      } else if (key === 'c') {
        this.closeBuildMode();
        this.crafting.setOpen(!this.crafting.isOpen);
      } else if (key === 'b') {
        if (this.inventory.isOpen) this.toggleInventory();
        this.crafting.setOpen(false);
        const wasOpen = this.buildMenu.isOpen || this.world.placement !== null;
        this.closeBuildMode();
        if (!wasOpen) this.buildMenu.setOpen(true);
      } else if (key === 'escape') {
        // Esc closes whatever is open; with nothing open it pauses the game.
        const anyOpen =
          this.inventory.isOpen ||
          this.buildMenu.isOpen ||
          this.crafting.isOpen ||
          this.world.placement !== null ||
          this.world.commandPick !== null ||
          this.world.plotFarm !== null ||
          this.world.demolishing;
        if (!anyOpen) this.pause.open();
        if (this.inventory.isOpen) this.toggleInventory();
        this.crafting.setOpen(false);
        this.closeBuildMode();
      } else if (key === 'g') this.world.dropSelected(e.shiftKey);
      else if (key === 'n') this.minimap.toggle();
      else if (key >= '1' && key <= '9') this.world.selectedHotbar = Number(key) - 1;
    });

    // Placement clicks land on empty screen space (not on any UI element of this scene).
    this.input.on('pointerdown', (p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
      if (over.length > 0) return;
      if (this.world.demolishing) {
        if (p.rightButtonDown()) this.world.cancelDemolish();
        else this.world.tryDemolish();
        return;
      }
      if (this.world.commandPick) {
        if (p.rightButtonDown()) this.world.cancelCommandPick();
        else this.world.tryCommandPick();
        return;
      }
      if (this.world.plotFarm) {
        if (p.rightButtonDown()) this.world.cancelPlot();
        else this.world.plotPointerDown();
        return;
      }
      if (!this.world.placement) {
        if (p.leftButtonDown()) this.world.clickAttack();
        return;
      }
      if (p.rightButtonDown()) this.world.cancelPlacing();
      else this.world.tryPlace();
    });

    this.input.on('pointerup', () => this.world.plotPointerUp());

    this.world.events.on('popup', (e: PopupEvent) => {
      const text = this.add
        .text(0, 0, e.text, { ...TEXT, fontSize: '13px', color: e.color ?? '#ffffff', stroke: '#000000', strokeThickness: 3 })
        .setOrigin(0.5, 1);
      this.popups.push({ text, wx: e.x, wy: e.y, age: 0 });
    });

    this.world.events.on('toast', (e: ToastEvent) => {
      const text = this.add
        .text(this.scale.width / 2, 0, e.text, {
          ...TEXT,
          fontSize: '14px',
          color: e.color ?? '#e8d8b0',
          backgroundColor: '#000000aa',
          padding: { x: 10, y: 5 },
        })
        .setOrigin(0.5, 0)
        .setDepth(120);
      this.toasts.unshift({ text, age: 0 });
      if (this.toasts.length > 4) this.toasts.pop()!.text.destroy();
    });

    this.layout();
    const onResize = () => this.layout();
    this.scale.on('resize', onResize);
    this.events.once('shutdown', () => this.scale.off('resize', onResize));
  }

  update(_t: number, deltaMs: number): void {
    const w = this.world;
    if (!w.player) return;

    // The HUD shows the village you're in (home, or one of your colonies).
    const v = w.currentVillage();
    const stock = v.stock;
    const people = w.population.villagersOf(v.id);
    for (const r of RESOURCES) this.counts[r].setText(`${RESOURCE_LABEL[r]} ${stock.items[r]}`);
    // Meat is food: show how many days it lasts, and warn when it runs low.
    const days = foodDays(people, stock);
    if (Number.isFinite(days)) {
      this.counts.meat.setText(`Carne ${stock.items.meat} · ${days.toFixed(1).replace('.', ',')}d`);
      this.counts.meat.setColor(days < 1 ? '#ff8a7a' : days < 2 ? '#ffc060' : '#e8d8b0');
    }
    const where = v.parent !== undefined ? `${v.name} · ` : '';
    if (w.settled)
      this.popText.setText(`${where}População ${people.length}/${w.population.bedsOf(v.id)}   ⛁ ${w.factions[0].coins} moedas`);
    else this.popText.setText(`Sem vila (B: sua casa, depois reivindicar terras)   ⛁ ${w.factions[0].coins} moedas`);

    const light = ambientAt(w.clock.hour);
    this.night.setFillStyle(light.color, light.alpha);
    const icon = w.clock.isNight ? '☾' : '☀';
    this.clockText.setText(`${icon} Dia ${w.clock.day}  ${formatClock(w.clock.hour)}${w.fastForward ? '  ▶▶' : ''}`);

    const t = w.player.tile;
    this.debug.setText(`tile ${t.x},${t.y}   fps ${Math.round(this.game.loop.actualFps)}`);

    this.drawInteraction();
    this.updatePopups(deltaMs / 1000);
    this.inventory.update(this.input.activePointer);
    this.minimap.update(deltaMs / 1000);
    this.crafting.update();
    this.fullMap.update(deltaMs / 1000);
    this.management.update(deltaMs / 1000);
    this.drawHealth();
    this.buildMenu.update();
    this.updatePlaceHint();
    this.dialog.update();
    this.panel.update();
    this.storagePanel.update(deltaMs / 1000);
    this.orders.update(deltaMs / 1000);
    this.updateToasts(deltaMs / 1000);
  }

  /** Newest toast on top, below the clock; each fades out after TOAST_SECONDS. */
  private updateToasts(dt: number): void {
    let y = 96; // below the resource bar, help line and debug text
    this.toasts = this.toasts.filter((t) => {
      t.age += dt;
      if (t.age >= TOAST_SECONDS) {
        t.text.destroy();
        return false;
      }
      t.text.setPosition(Math.round(this.scale.width / 2), y).setAlpha(Math.min(1, (TOAST_SECONDS - t.age) / 0.8));
      y += t.text.height + 4;
      return true;
    });
  }

  /** Player HP bar just above the left end of the hotbar. */
  private drawHealth(): void {
    const s = this.world.stats;
    const x = Math.round((this.scale.width - 428) / 2);
    const y = this.scale.height - 44 - 12 - 8;
    const w = 120;
    const ratio = s.hp / s.maxHp;
    this.hpBar.clear();
    this.hpBar.fillStyle(0x000000, 0.7).fillRect(x - 1, y - 1, w + 2, 7);
    this.hpBar.fillStyle(ratio > 0.5 ? 0xd04838 : 0xff3020, 1).fillRect(x, y, Math.round(w * ratio), 5);
    this.hpText.setText(`♥ ${s.hp}/${s.maxHp}`).setPosition(x, y - 3);
    // Level and XP (thin gold bar under the HP bar).
    const xpRatio = s.level >= MAX_LEVEL ? 1 : s.xp / xpToNext(s.level);
    this.hpBar.fillStyle(0x000000, 0.7).fillRect(x - 1, y + 6, w + 2, 4);
    this.hpBar.fillStyle(0xffd040, 1).fillRect(x, y + 7, Math.round(w * xpRatio), 2);
    this.levelText.setText(`Nv ${s.level}`).setPosition(x + w, y - 3);
    // Hunger: a brown bar right of the HP bar (F eats meat).
    const fx = x + w + 40;
    const food = s.food / 100;
    this.hpBar.fillStyle(0x000000, 0.7).fillRect(fx - 1, y - 1, 82, 7);
    this.hpBar.fillStyle(s.starving ? 0xff3020 : s.hungry ? 0xd08a30 : 0xa8703a, 1).fillRect(fx, y, Math.round(80 * food), 5);
    this.foodText
      .setText(s.starving ? 'Faminto! (F come)' : s.hungry ? 'Com fome (F come)' : 'Fome')
      .setColor(s.starving ? '#ff8a7a' : s.hungry ? '#ffc060' : '#cdb98e')
      .setPosition(fx, y - 3);
  }

  private closeBuildMode(): void {
    this.buildMenu.setOpen(false);
    this.world.cancelPlacing();
  }

  private updatePlaceHint(): void {
    const ptr0 = this.input.activePointer;
    const dh = this.world.demolishHint;
    if (this.world.demolishing && dh) {
      this.placeHint
        .setText(`${dh.text}   ·   Direito/Esc: sair`)
        .setColor(dh.ok ? '#ffb090' : '#a8977a')
        .setPosition(Math.round(ptr0.x + 16), Math.round(ptr0.y + 16))
        .setVisible(true);
      return;
    }
    const ph = this.world.plotHint;
    if (this.world.plotFarm && ph) {
      this.placeHint
        .setText(ph.text)
        .setColor(ph.ok ? '#c8ffc8' : '#ff9a8a')
        .setPosition(Math.round(ptr0.x + 16), Math.round(ptr0.y + 16))
        .setVisible(true);
      return;
    }
    const ch = this.world.commandHint;
    if (this.world.commandPick && ch) {
      this.placeHint
        .setText(ch.text)
        .setColor(ch.ok ? '#a8d8ff' : '#a8977a')
        .setPosition(Math.round(ptr0.x + 16), Math.round(ptr0.y + 16))
        .setVisible(true);
      return;
    }
    const pl = this.world.placement;
    if (!pl) {
      this.placeHint.setVisible(false);
      return;
    }
    const ptr = this.input.activePointer;
    const text = pl.check.ok ? 'Clique: construir   Direito/Esc: cancelar' : pl.check.reason;
    this.placeHint
      .setText(text)
      .setColor(pl.check.ok ? '#c8ffc8' : '#ff9a8a')
      .setPosition(Math.round(ptr.x + 16), Math.round(ptr.y + 16))
      .setVisible(true);
  }

  private toggleInventory(): void {
    this.inventory.toggle();
    this.world.inventoryOpen = this.inventory.isOpen;
  }

  private drawInteraction(): void {
    this.bar.clear();
    const it = this.world.interaction;
    if (!it) {
      this.prompt.setVisible(false);
      return;
    }
    const p = this.toScreen(it.x, it.y);
    this.prompt.setText(it.text).setPosition(Math.round(p.x), Math.round(p.y)).setVisible(true);
    if (it.progress !== null) {
      const bw = 48;
      const bx = Math.round(p.x - bw / 2);
      const by = Math.round(p.y + 4);
      this.bar.fillStyle(0x000000, 0.7).fillRect(bx - 1, by - 1, bw + 2, 7);
      this.bar.fillStyle(0xffe08a, 1).fillRect(bx, by, Math.round(bw * Math.min(1, it.progress)), 5);
    }
  }

  private updatePopups(dt: number): void {
    this.popups = this.popups.filter((p) => {
      p.age += dt;
      if (p.age >= POPUP_SECONDS) {
        p.text.destroy();
        return false;
      }
      const s = this.toScreen(p.wx, p.wy);
      // Start above the interaction prompt (~22px tall) so the two never overlap.
      p.text.setPosition(Math.round(s.x), Math.round(s.y - 24 - p.age * 30));
      p.text.setAlpha(1 - (p.age / POPUP_SECONDS) ** 2);
      return true;
    });
  }

  /** World (camera) coordinates to screen pixels. */
  private toScreen(wx: number, wy: number): { x: number; y: number } {
    const cam = this.world.cameras.main;
    return { x: (wx - cam.worldView.x) * cam.zoom, y: (wy - cam.worldView.y) * cam.zoom };
  }

  private layout(): void {
    const { width, height } = this.scale;
    this.night.setSize(width, height);
    this.vignette.setDisplaySize(width, height);
    this.clockText.setX(width - 8);
    this.inventory.layout(width, height);
    this.dialog.layout(width, height);
    this.panel.layout(width, height);
    this.storagePanel?.layout();
    this.peddle?.layout();
    this.orders?.layout();
    this.minimap.layout(width, height);
    this.pause?.layout(width, height);
    this.fullMap?.layout();
    this.management?.layout();
  }
}
