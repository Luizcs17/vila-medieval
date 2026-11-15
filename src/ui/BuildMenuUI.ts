import type Phaser from 'phaser';
import { BUILDING_DEFS, type BuildingType } from '../game/buildings';
import { RESOURCES, type Resource } from '../game/inventory';

const ROW_W = 290;
const ROW_H = 40;
const PAD = 10;

const TEXT = { fontFamily: '"Alegreya", Georgia, serif', color: '#e8d8b0' } satisfies Phaser.Types.GameObjects.Text.TextStyle;

interface Row {
  type: BuildingType;
  bg: Phaser.GameObjects.Rectangle;
  costs: { r: (typeof RESOURCES)[number]; text: Phaser.GameObjects.Text }[];
  objects: Phaser.GameObjects.GameObject[];
}

/**
 * Left-side list of buildings with their costs. Clicking a row starts placement. The list is
 * rebuilt each time it opens, from `available()` (before you have a village only your house
 * and claiming land are offered), with `hint()` as a line under the title.
 */
export class BuildMenuUI {
  isOpen = false;
  private readonly container: Phaser.GameObjects.Container;
  private rows: Row[] = [];

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly have: (r: Resource) => number,
    private readonly available: () => BuildingType[],
    private readonly hint: () => string | null,
    private readonly onSelect: (type: BuildingType) => void,
    private readonly onDemolish: () => void,
  ) {
    this.container = scene.add.container(12, 96).setDepth(90).setVisible(false);
  }

  private build(): void {
    const { scene, onSelect, onDemolish } = this;
    this.container.removeAll(true);
    this.rows = [];
    const menu = this.available();
    const note = this.hint();
    const top = note ? 52 : 30;
    // Two columns so the growing list fits short screens.
    const rowsPerCol = Math.max(1, Math.ceil(menu.length / 2));
    const height = PAD * 2 + top + rowsPerCol * (ROW_H + 4);
    const panel = scene.add
      .rectangle(0, 0, ROW_W * 2 + PAD * 3, height, 0x140f0a, 0.94)
      .setOrigin(0)
      .setStrokeStyle(2, 0x8a6a3a);
    panel.setInteractive(); // swallow clicks so they don't place buildings underneath
    const title = scene.add.text(PAD, PAD - 2, 'Construir  (B fecha)', {
      ...TEXT,
      fontFamily: '"MedievalSharp", "Alegreya", Georgia, serif',
      fontSize: '16px',
      color: '#e0b860',
    });
    // Demolish mode button in the header.
    const dBg = scene.add
      .rectangle(ROW_W * 2 + PAD * 2 - 150, PAD - 4, 150, 24, 0x5a2a24, 1)
      .setOrigin(0)
      .setStrokeStyle(1, 0x8a6a3a);
    dBg.setInteractive({ useHandCursor: true }).on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (p.leftButtonDown()) onDemolish();
    });
    const dText = scene.add
      .text(ROW_W * 2 + PAD * 2 - 75, PAD + 8, '⚒ Demolir (X)', { ...TEXT, fontSize: '13px' })
      .setOrigin(0.5);
    this.container.add([panel, title, dBg, dText]);
    if (note)
      this.container.add(
        scene.add.text(PAD, PAD + 22, note, { ...TEXT, fontSize: '12px', color: '#ffe08a', wordWrap: { width: ROW_W * 2 } }),
      );

    menu.forEach((type, k) => {
      const def = BUILDING_DEFS[type];
      const col = Math.floor(k / rowsPerCol);
      const x0 = PAD + col * (ROW_W + PAD);
      const y = PAD + top + (k % rowsPerCol) * (ROW_H + 4);
      const bg = scene.add.rectangle(x0, y, ROW_W, ROW_H, 0x241a12, 0.95).setOrigin(0).setStrokeStyle(1, 0x8a6a3a);
      bg.setInteractive({ useHandCursor: true })
        .on('pointerover', () => bg.setFillStyle(0x3a2e20, 1))
        .on('pointerout', () => bg.setFillStyle(0x241a12, 0.95))
        .on('pointerdown', (p: Phaser.Input.Pointer) => {
          if (p.leftButtonDown()) onSelect(type);
        });
      const name = scene.add.text(x0 + 8, y + 4, `${def.name}  ${def.size}×${def.size}`, { ...TEXT, fontSize: '13px' });
      const info = def.near ? `Perto de ${def.near.label}` : def.description;
      const sub = scene.add.text(x0 + 8, y + 22, info, { ...TEXT, fontSize: '10px', color: '#a8977a' });
      const objects: Phaser.GameObjects.GameObject[] = [bg, name, sub];
      const costs: Row['costs'] = [];
      let cx = x0 + ROW_W - 8;
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
  }

  setOpen(open: boolean): void {
    if (open) this.build();
    this.isOpen = open;
    this.container.setVisible(open);
  }

  update(): void {
    if (!this.isOpen) return;
    for (const row of this.rows) {
      const cost = BUILDING_DEFS[row.type].cost;
      for (const c of row.costs) c.text.setColor(this.have(c.r) >= (cost[c.r] ?? 0) ? '#e8d8b0' : '#ff8070');
    }
  }
}
