import type Phaser from 'phaser';
import { BUILD_MENU, BUILDING_DEFS, type BuildingType } from '../game/buildings';
import { type Inventory, RESOURCES } from '../game/inventory';

const ROW_W = 300;
const ROW_H = 40;
const PAD = 10;

const TEXT = { fontFamily: '"Alegreya", Georgia, serif', color: '#e8d8b0' } satisfies Phaser.Types.GameObjects.Text.TextStyle;

interface Row {
  type: BuildingType;
  bg: Phaser.GameObjects.Rectangle;
  costs: { r: (typeof RESOURCES)[number]; text: Phaser.GameObjects.Text }[];
  objects: Phaser.GameObjects.GameObject[];
}

/** Left-side list of buildings with their stockpile costs. Clicking a row starts placement. */
export class BuildMenuUI {
  isOpen = false;
  private readonly container: Phaser.GameObjects.Container;
  private readonly rows: Row[] = [];

  constructor(
    scene: Phaser.Scene,
    private readonly stockpile: Inventory,
    onSelect: (type: BuildingType) => void,
  ) {
    this.container = scene.add.container(12, 110).setDepth(90);
    const height = PAD * 2 + 22 + BUILD_MENU.length * (ROW_H + 4);
    const panel = scene.add
      .rectangle(0, 0, ROW_W + PAD * 2, height, 0x140f0a, 0.94)
      .setOrigin(0)
      .setStrokeStyle(2, 0x8a6a3a);
    panel.setInteractive(); // swallow clicks so they don't place buildings underneath
    const title = scene.add.text(PAD, PAD - 2, 'Construir  (B fecha)', {
      ...TEXT,
      fontFamily: '"MedievalSharp", "Alegreya", Georgia, serif',
      fontSize: '16px',
      color: '#e0b860',
    });
    this.container.add([panel, title]);

    BUILD_MENU.forEach((type, k) => {
      const def = BUILDING_DEFS[type];
      const y = PAD + 22 + k * (ROW_H + 4);
      const bg = scene.add.rectangle(PAD, y, ROW_W, ROW_H, 0x241a12, 0.95).setOrigin(0).setStrokeStyle(1, 0x8a6a3a);
      bg.setInteractive({ useHandCursor: true })
        .on('pointerover', () => bg.setFillStyle(0x3a2e20, 1))
        .on('pointerout', () => bg.setFillStyle(0x241a12, 0.95))
        .on('pointerdown', (p: Phaser.Input.Pointer) => {
          if (p.leftButtonDown()) onSelect(type);
        });
      const name = scene.add.text(PAD + 8, y + 4, `${def.name}  ${def.size}×${def.size}`, { ...TEXT, fontSize: '13px' });
      const info = def.near ? `Perto de ${def.near.label}` : def.description;
      const sub = scene.add.text(PAD + 8, y + 22, info, { ...TEXT, fontSize: '10px', color: '#a8977a' });
      const objects: Phaser.GameObjects.GameObject[] = [bg, name, sub];
      const costs: Row['costs'] = [];
      let cx = PAD + ROW_W - 8;
      for (const r of [...RESOURCES].reverse()) {
        const amount = def.cost[r];
        if (!amount) continue;
        const text = scene.add.text(cx, y + 12, String(amount), { ...TEXT, fontSize: '13px' }).setOrigin(1, 0.5);
        const icon = scene.add
          .image(cx - text.width - 3, y + 12, `icon_${r}`)
          .setScale(2)
          .setOrigin(1, 0.5);
        cx -= text.width + 26;
        costs.push({ r, text });
        objects.push(text, icon);
      }
      this.container.add(objects);
      this.rows.push({ type, bg, costs, objects });
    });

    this.container.setVisible(false);
  }

  setOpen(open: boolean): void {
    this.isOpen = open;
    this.container.setVisible(open);
  }

  update(): void {
    if (!this.isOpen) return;
    for (const row of this.rows) {
      const cost = BUILDING_DEFS[row.type].cost;
      for (const c of row.costs) c.text.setColor(this.stockpile.items[c.r] >= (cost[c.r] ?? 0) ? '#e8d8b0' : '#ff8070');
    }
  }
}
