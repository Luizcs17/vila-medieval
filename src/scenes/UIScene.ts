import Phaser from 'phaser';
import { RESOURCE_LABEL, RESOURCES, type Resource } from '../game/inventory';
import { ambientAt, formatClock } from '../game/time';
import { BuildMenuUI } from '../ui/BuildMenuUI';
import { InventoryUI } from '../ui/InventoryUI';
import { RecruitDialogUI } from '../ui/RecruitDialogUI';
import type { NpcData } from '../game/npcs';
import type { PopupEvent, ToastEvent, WorldScene } from './WorldScene';

const TOAST_SECONDS = 5;

const TEXT = {
  fontFamily: 'monospace',
  fontSize: '14px',
  color: '#f3e9d2',
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
  private counts = {} as Record<Resource, Phaser.GameObjects.Text>;
  private clockText!: Phaser.GameObjects.Text;
  private debug!: Phaser.GameObjects.Text;
  private prompt!: Phaser.GameObjects.Text;
  private bar!: Phaser.GameObjects.Graphics;
  private inventory!: InventoryUI;
  private buildMenu!: BuildMenuUI;
  private placeHint!: Phaser.GameObjects.Text;
  private dialog!: RecruitDialogUI;
  private popText!: Phaser.GameObjects.Text;
  private popups: Popup[] = [];
  private toasts: { text: Phaser.GameObjects.Text; age: number }[] = [];

  constructor() {
    super('UI');
  }

  create(): void {
    this.world = this.scene.get('World') as WorldScene;

    // Full-screen tint for the day/night cycle. Created first so it sits under all HUD elements.
    this.night = this.add.rectangle(0, 0, 10, 10, 0x000000, 0).setOrigin(0);

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
      x += 116;
    }
    this.add.image(x, 26, 'icon_person').setScale(2).setOrigin(0, 0.5);
    this.popText = this.add.text(x + 20, 26, '', TEXT).setOrigin(0, 0.5);
    x += 160;
    panel.width = x - 8;

    this.clockText = this.add
      .text(0, 8, '', { ...TEXT, backgroundColor: '#00000088', padding: { x: 10, y: 9 } })
      .setOrigin(1, 0);
    this.add.text(
      12,
      52,
      'WASD: andar  Shift: correr  E: coletar/usar  B: construir  I/Tab: inventário  1-9: hotbar  T: acelerar tempo',
      { ...TEXT, fontSize: '12px', backgroundColor: '#00000088', padding: { x: 8, y: 5 } },
    );
    this.debug = this.add.text(12, 80, '', { ...TEXT, fontSize: '11px', color: '#cfc3a8' });

    this.inventory = new InventoryUI(this, this.world.inventory, {
      get: () => this.world.selectedHotbar,
      set: (i) => (this.world.selectedHotbar = i),
    });

    this.buildMenu = new BuildMenuUI(this, this.world.stockpile, (type) => {
      this.buildMenu.setOpen(false);
      this.world.startPlacing(type);
    });
    this.placeHint = this.add
      .text(0, 0, '', { ...TEXT, fontSize: '12px', backgroundColor: '#000000bb', padding: { x: 6, y: 3 } })
      .setDepth(95)
      .setVisible(false);

    this.dialog = new RecruitDialogUI(this, this.world, () => this.world.stopTalking());
    this.world.events.on('talk', (npc: NpcData) => {
      if (this.inventory.isOpen) this.toggleInventory();
      this.closeBuildMode();
      this.dialog.open(npc);
    });

    const kb = this.input.keyboard!;
    kb.addCapture('TAB');
    kb.on('keydown', (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (this.dialog.isOpen) {
        // The dialog is modal: only its own keys work.
        if (key === 'enter') this.dialog.confirm();
        else if (key === 'escape' || key === 'e') this.dialog.close();
        return;
      }
      if (key === 'i' || key === 'tab') {
        this.closeBuildMode();
        this.toggleInventory();
      } else if (key === 'b') {
        if (this.inventory.isOpen) this.toggleInventory();
        const wasOpen = this.buildMenu.isOpen || this.world.placement !== null;
        this.closeBuildMode();
        if (!wasOpen) this.buildMenu.setOpen(true);
      } else if (key === 'escape') {
        if (this.inventory.isOpen) this.toggleInventory();
        this.closeBuildMode();
      } else if (key >= '1' && key <= '9') this.world.selectedHotbar = Number(key) - 1;
    });

    // Placement clicks land on empty screen space (not on any UI element of this scene).
    this.input.on('pointerdown', (p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
      if (!this.world.placement || over.length > 0) return;
      if (p.rightButtonDown()) this.world.cancelPlacing();
      else this.world.tryPlace();
    });

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
          color: e.color ?? '#f3e9d2',
          backgroundColor: '#000000aa',
          padding: { x: 10, y: 5 },
        })
        .setOrigin(0.5, 0)
        .setDepth(120);
      this.toasts.unshift({ text, age: 0 });
      if (this.toasts.length > 4) this.toasts.pop()!.text.destroy();
    });

    this.layout();
    this.scale.on('resize', () => this.layout());
  }

  update(_t: number, deltaMs: number): void {
    const w = this.world;
    if (!w.player) return;

    for (const r of RESOURCES) this.counts[r].setText(`${RESOURCE_LABEL[r]} ${w.stockpile.items[r]}`);
    this.popText.setText(`População ${w.population.villagers.length}/${w.population.beds}`);

    const light = ambientAt(w.clock.hour);
    this.night.setFillStyle(light.color, light.alpha);
    const icon = w.clock.isNight ? '☾' : '☀';
    this.clockText.setText(`${icon} Dia ${w.clock.day}  ${formatClock(w.clock.hour)}${w.fastForward ? '  ▶▶' : ''}`);

    const t = w.player.tile;
    this.debug.setText(`tile ${t.x},${t.y}   fps ${Math.round(this.game.loop.actualFps)}`);

    this.drawInteraction();
    this.updatePopups(deltaMs / 1000);
    this.inventory.update(this.input.activePointer);
    this.buildMenu.update();
    this.updatePlaceHint();
    this.dialog.update();
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

  private closeBuildMode(): void {
    this.buildMenu.setOpen(false);
    this.world.cancelPlacing();
  }

  private updatePlaceHint(): void {
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
    this.clockText.setX(width - 8);
    this.inventory.layout(width, height);
    this.dialog.layout(width, height);
  }
}
