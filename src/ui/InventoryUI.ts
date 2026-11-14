import type Phaser from 'phaser';
import { ITEM_LABEL, ITEM_WEIGHT, type SlotInventory, type Stack } from '../game/slots';

const SLOT = 44;
const GAP = 4;
const PAD = 16;
const BORDER = 0x5a4630;
const BORDER_SELECTED = 0xffe08a;

const COUNT_STYLE = {
  fontFamily: 'monospace',
  fontSize: '13px',
  color: '#ffffff',
  stroke: '#000000',
  strokeThickness: 3,
} satisfies Phaser.Types.GameObjects.Text.TextStyle;

/** One square: background, item icon, stack count. */
class SlotView {
  readonly bg: Phaser.GameObjects.Rectangle;
  private readonly icon: Phaser.GameObjects.Image;
  private readonly count: Phaser.GameObjects.Text;

  constructor(
    scene: Phaser.Scene,
    readonly index: number,
  ) {
    this.bg = scene.add.rectangle(0, 0, SLOT, SLOT, 0x2a2118, 0.9).setOrigin(0).setStrokeStyle(2, BORDER);
    this.icon = scene.add.image(0, 0, 'icon_wood').setScale(3).setVisible(false);
    this.count = scene.add.text(0, 0, '', COUNT_STYLE).setOrigin(1, 1);
  }

  setPosition(x: number, y: number): void {
    this.bg.setPosition(x, y);
    this.icon.setPosition(x + SLOT / 2, y + SLOT / 2);
    this.count.setPosition(x + SLOT - 3, y + SLOT - 1);
  }

  render(stack: Stack | null, selected: boolean, visible: boolean): void {
    this.bg.setVisible(visible).setStrokeStyle(selected ? 3 : 2, selected ? BORDER_SELECTED : BORDER);
    this.icon.setVisible(visible && stack !== null);
    if (stack) this.icon.setTexture(`icon_${stack.item}`);
    this.count.setVisible(visible).setText(stack && stack.count > 1 ? String(stack.count) : '');
  }

  setDepth(d: number): void {
    this.bg.setDepth(d);
    this.icon.setDepth(d + 1);
    this.count.setDepth(d + 2);
  }
}

/**
 * Minecraft-style inventory: an always-visible hotbar at the bottom of the screen, and a panel
 * (toggled by the caller) showing the bag plus the hotbar, with click-to-move stacks:
 * left click = take/place/swap whole stack, right click = take half / place one, shift+click = quick move.
 */
export class InventoryUI {
  isOpen = false;
  /** Stack attached to the mouse cursor while the panel is open. */
  held: Stack | null = null;

  private readonly hotbar: SlotView[] = [];
  private readonly panelSlots: SlotView[] = [];
  private readonly panelBg: Phaser.GameObjects.Rectangle;
  private readonly title: Phaser.GameObjects.Text;
  private readonly hint: Phaser.GameObjects.Text;
  private readonly heldIcon: Phaser.GameObjects.Image;
  private readonly heldCount: Phaser.GameObjects.Text;
  private readonly tooltip: Phaser.GameObjects.Text;
  private readonly weightText: Phaser.GameObjects.Text;
  private readonly weightBar: Phaser.GameObjects.Graphics;
  private hovered: number | null = null;

  constructor(
    scene: Phaser.Scene,
    private readonly inv: SlotInventory,
    private readonly selection: { get: () => number; set: (i: number) => void },
  ) {
    for (let i = 0; i < inv.hotbarSize; i++) {
      const v = new SlotView(scene, i);
      v.bg.setInteractive().on('pointerdown', () => this.selection.set(i));
      this.hotbar.push(v);
    }

    this.panelBg = scene.add.rectangle(0, 0, 0, 0, 0x1a140e, 0.94).setOrigin(0).setStrokeStyle(2, BORDER).setDepth(100);
    this.panelBg.setInteractive(); // swallow clicks between slots
    this.title = scene.add
      .text(0, 0, 'Inventário', { fontFamily: 'monospace', fontSize: '15px', color: '#f3e9d2' })
      .setDepth(101);
    this.hint = scene.add
      .text(0, 0, 'Clique: pegar/soltar · Direito: metade/um · Shift: mover', {
        fontFamily: 'monospace',
        fontSize: '11px',
        color: '#a89a80',
      })
      .setDepth(101);

    // Panel order: bag rows first (top), then the hotbar row (bottom), like Minecraft.
    const order = [
      ...Array.from({ length: inv.slots.length - inv.hotbarSize }, (_, k) => k + inv.hotbarSize),
      ...Array.from({ length: inv.hotbarSize }, (_, k) => k),
    ];
    for (const idx of order) {
      const v = new SlotView(scene, idx);
      v.setDepth(102);
      v.bg
        .setInteractive()
        .on('pointerdown', (p: Phaser.Input.Pointer) => this.onSlotClick(idx, p))
        .on('pointerover', () => (this.hovered = idx))
        .on('pointerout', () => {
          if (this.hovered === idx) this.hovered = null;
        });
      this.panelSlots.push(v);
    }

    this.heldIcon = scene.add.image(0, 0, 'icon_wood').setScale(3).setDepth(200).setVisible(false);
    this.heldCount = scene.add.text(0, 0, '', COUNT_STYLE).setOrigin(1, 1).setDepth(201);
    this.tooltip = scene.add
      .text(0, 0, '', {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#f3e9d2',
        backgroundColor: '#000000cc',
        padding: { x: 5, y: 3 },
      })
      .setDepth(202)
      .setVisible(false);

    this.weightText = scene.add.text(0, 0, '', { ...COUNT_STYLE, fontSize: '12px' }).setOrigin(0, 1);
    this.weightBar = scene.add.graphics();

    scene.input.mouse?.disableContextMenu();
    this.setPanelVisible(false);
  }

  /** Opens or closes the panel. Closing puts any held stack back into the inventory. */
  toggle(): void {
    if (this.isOpen && this.held) {
      const added = this.inv.add(this.held.item, this.held.count);
      this.held.count -= added;
      if (this.held.count > 0) return; // nowhere to put it: keep the panel open
      this.held = null;
    }
    this.isOpen = !this.isOpen;
    this.hovered = null;
    this.setPanelVisible(this.isOpen);
  }

  layout(width: number, height: number): void {
    const hotbarW = this.inv.hotbarSize * SLOT + (this.inv.hotbarSize - 1) * GAP;
    const hx = Math.round((width - hotbarW) / 2);
    const hy = height - SLOT - 12;
    this.hotbar.forEach((v, i) => {
      v.setPosition(hx + i * (SLOT + GAP), hy);
    });
    this.weightPos = { x: hx + hotbarW + 10, y: hy + SLOT };

    const cols = this.inv.hotbarSize;
    const bagRows = Math.ceil((this.inv.slots.length - cols) / cols);
    const panelW = hotbarW + PAD * 2;
    const panelH = PAD + 22 + bagRows * (SLOT + GAP) + 12 + SLOT + 22 + PAD;
    const px = Math.round((width - panelW) / 2);
    const py = Math.round((height - panelH) / 2);
    this.panelBg.setPosition(px, py).setSize(panelW, panelH);
    this.panelBg.input?.hitArea.setTo(0, 0, panelW, panelH);
    this.title.setPosition(px + PAD, py + PAD - 4);
    this.panelSlots.forEach((v, k) => {
      const isHotbar = k >= this.panelSlots.length - cols;
      const row = isHotbar ? 0 : Math.floor(k / cols);
      const col = isHotbar ? k - (this.panelSlots.length - cols) : k % cols;
      const y = isHotbar ? py + PAD + 22 + bagRows * (SLOT + GAP) + 12 : py + PAD + 22 + row * (SLOT + GAP);
      v.setPosition(px + PAD + col * (SLOT + GAP), y);
    });
    this.hint.setPosition(px + PAD, py + panelH - PAD - 10);
    this.panelWeightPos = { x: px + panelW - PAD, y: py + PAD + 12 };
  }

  private weightPos = { x: 0, y: 0 };
  private panelWeightPos = { x: 0, y: 0 };

  /** "12/40 kg" plus a small bar; next to the hotbar, or in the panel header when open. */
  private drawWeight(): void {
    const w = this.inv.weight;
    const max = this.inv.maxWeight;
    const ratio = Math.min(1, w / max);
    const color = ratio >= 1 ? 0xff7060 : ratio > 0.75 ? 0xffc060 : 0xa8d878;
    const pos = this.isOpen ? this.panelWeightPos : this.weightPos;
    this.weightText
      .setText(`Peso ${w}/${max} kg`)
      .setOrigin(this.isOpen ? 1 : 0, 1)
      .setPosition(pos.x, pos.y - 8)
      .setDepth(this.isOpen ? 103 : 0);
    const bw = 90;
    const bx = this.isOpen ? pos.x - bw : pos.x;
    this.weightBar.clear().setDepth(this.isOpen ? 103 : 0);
    this.weightBar.fillStyle(0x000000, 0.7).fillRect(bx - 1, pos.y - 6, bw + 2, 6);
    this.weightBar.fillStyle(color, 1).fillRect(bx, pos.y - 5, Math.round(bw * ratio), 4);
  }

  update(pointer: Phaser.Input.Pointer): void {
    const selected = this.selection.get();
    this.hotbar.forEach((v, i) => {
      v.render(this.inv.slots[i], i === selected, !this.isOpen);
    });
    for (const v of this.panelSlots) v.render(this.inv.slots[v.index], false, this.isOpen);

    const h = this.held;
    this.heldIcon.setVisible(this.isOpen && h !== null);
    this.heldCount.setVisible(this.isOpen && h !== null);
    if (h) {
      this.heldIcon.setTexture(`icon_${h.item}`).setPosition(pointer.x, pointer.y);
      this.heldCount.setText(h.count > 1 ? String(h.count) : '').setPosition(pointer.x + SLOT / 2 - 3, pointer.y + SLOT / 2 - 1);
    }

    const hoveredStack = this.hovered !== null ? this.inv.slots[this.hovered] : null;
    const showTip = this.isOpen && !h && hoveredStack !== null;
    this.tooltip.setVisible(showTip);
    if (showTip && hoveredStack) {
      const unit = ITEM_WEIGHT[hoveredStack.item];
      this.tooltip
        .setText(`${ITEM_LABEL[hoveredStack.item]}  ${unit} kg cada (${unit * hoveredStack.count} kg)`)
        .setPosition(pointer.x + 14, pointer.y + 10);
    }
    this.drawWeight();
  }

  private onSlotClick(i: number, p: Phaser.Input.Pointer): void {
    const ev = p.event as MouseEvent;
    if (ev.shiftKey && !this.held) this.inv.quickMove(i);
    else if (p.rightButtonDown()) this.held = this.inv.rightClick(i, this.held);
    else this.held = this.inv.leftClick(i, this.held);
  }

  private setPanelVisible(v: boolean): void {
    this.panelBg.setVisible(v);
    this.title.setVisible(v);
    this.hint.setVisible(v);
    if (v) this.panelBg.setInteractive();
    else this.panelBg.disableInteractive();
  }
}
