import type Phaser from 'phaser';
import { checkCraft } from '../game/crafting';
import { RESOURCES } from '../game/inventory';
import { ITEM_DEFS, RECIPES } from '../game/items';
import type { WorldScene } from '../scenes/WorldScene';

const ROW_W = 340;
const ROW_H = 48;
const PAD = 10;
const TEXT = { fontFamily: '"Alegreya", Georgia, serif', color: '#e8d8b0' } satisfies Phaser.Types.GameObjects.Text.TextStyle;

interface Row {
  bg: Phaser.GameObjects.Rectangle;
  costs: { r: (typeof RESOURCES)[number]; need: number; text: Phaser.GameObjects.Text }[];
  name: Phaser.GameObjects.Text;
}

/**
 * Crafting list (C). Each row is a recipe: click to craft. Materials come from what you carry first,
 * then the stockpile; costs turn red when the total isn't enough.
 */
export class CraftingUI {
  isOpen = false;
  private readonly container: Phaser.GameObjects.Container;
  private readonly rows: Row[] = [];

  constructor(
    scene: Phaser.Scene,
    private readonly world: WorldScene,
  ) {
    this.container = scene.add.container(12, 110).setDepth(90);
    const height = PAD * 2 + 22 + RECIPES.length * (ROW_H + 4);
    const panel = scene.add
      .rectangle(0, 0, ROW_W + PAD * 2, height, 0x140f0a, 0.94)
      .setOrigin(0)
      .setStrokeStyle(2, 0x8a6a3a)
      .setInteractive();
    const title = scene.add.text(PAD, PAD - 4, 'Criar  (C fecha) · usa o que você carrega + estoque', {
      ...TEXT,
      fontFamily: '"MedievalSharp", "Alegreya", Georgia, serif',
      color: '#e0b860',
      fontSize: '14px',
    });
    this.container.add([panel, title]);

    RECIPES.forEach((recipe, k) => {
      const y = PAD + 22 + k * (ROW_H + 4);
      const bg = scene.add.rectangle(PAD, y, ROW_W, ROW_H, 0x241a12, 0.95).setOrigin(0).setStrokeStyle(1, 0x8a6a3a);
      bg.setInteractive({ useHandCursor: true })
        .on('pointerover', () => bg.setStrokeStyle(1, 0xffe08a))
        .on('pointerout', () => bg.setStrokeStyle(1, 0x8a6a3a))
        .on('pointerdown', (p: Phaser.Input.Pointer) => {
          if (p.leftButtonDown()) this.world.craftItem(recipe);
        });
      const icon = scene.add.image(PAD + 16, y + ROW_H / 2, `icon_${recipe.item}`).setScale(3);
      const name = scene.add.text(PAD + 34, y + 6, ITEM_DEFS[recipe.item].label, { ...TEXT, fontSize: '13px' });
      const desc = scene.add.text(PAD + 34, y + 26, recipe.description, { ...TEXT, fontSize: '10px', color: '#a8977a' });
      const objects: Phaser.GameObjects.GameObject[] = [bg, icon, name, desc];
      const costs: Row['costs'] = [];
      let cx = PAD + ROW_W - 8;
      for (const r of [...RESOURCES].reverse()) {
        const need = recipe.cost[r];
        if (!need) continue;
        const text = scene.add.text(cx, y + 13, String(need), { ...TEXT, fontSize: '13px' }).setOrigin(1, 0.5);
        const ic = scene.add
          .image(cx - text.width - 3, y + 13, `icon_${r}`)
          .setScale(2)
          .setOrigin(1, 0.5);
        cx -= text.width + 26;
        costs.push({ r, need, text });
        objects.push(text, ic);
      }
      this.container.add(objects);
      this.rows.push({ bg, costs, name });
    });
    this.container.setVisible(false);
  }

  setOpen(open: boolean): void {
    this.isOpen = open;
    this.container.setVisible(open);
  }

  update(): void {
    if (!this.isOpen) return;
    const w = this.world;
    RECIPES.forEach((recipe, k) => {
      const row = this.rows[k];
      for (const c of row.costs) {
        const have = w.inventory.count(c.r) + w.stockpile.items[c.r];
        c.text.setColor(have >= c.need ? '#e8d8b0' : '#ff8070');
      }
      const ok = checkCraft(recipe, w.inventory, w.stockpile) === 'ok';
      row.name.setColor(ok ? '#e8d8b0' : '#8a7e68');
    });
  }
}
