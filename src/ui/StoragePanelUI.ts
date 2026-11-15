import type Phaser from 'phaser';
import { ALL_ITEMS, ITEM_DEFS, type ItemId } from '../game/items';
import { contents, depositResources, putInto, type Storage, takeFrom } from '../game/storage';
import type { WorldScene } from '../scenes/WorldScene';

const W = 680;
const PAD = 16;
const ROW = 26;
const TEXT = { fontFamily: '"Alegreya", Georgia, serif', color: '#e8d8b0' } satisfies Phaser.Types.GameObjects.Text.TextStyle;
const MUTED = '#a8977a';
const TITLE = '"MedievalSharp", "Alegreya", Georgia, serif';

/**
 * Two-column inventory screen: a storage (a village's stock, or one building's own inventory) on
 * the left, what you carry on the right. Take or store one, ten or everything; E stores all your
 * resources at once. Modal while open.
 */
export class StoragePanelUI {
  isOpen = false;
  private title = '';
  private storage: Storage | null = null;
  private objects: Phaser.GameObjects.GameObject[] = [];
  private refresh = 0;
  private message = '';

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly world: WorldScene,
  ) {}

  open(title: string, storage: Storage): void {
    this.title = title;
    this.storage = storage;
    this.isOpen = true;
    this.message = '';
    this.world.modalOpen = true;
    this.build();
  }

  close(): void {
    this.isOpen = false;
    this.storage = null;
    this.world.modalOpen = false;
    this.clear();
  }

  /** E inside the panel: store every resource you carry. */
  depositAll(): void {
    if (!this.storage) return;
    const moved = depositResources(this.storage, this.world.inventory);
    const n = Object.values(moved).reduce((a, b) => a + (b ?? 0), 0);
    this.message = n > 0 ? `Guardou ${n} recursos.` : 'Você não carrega recursos.';
    this.build();
  }

  update(dt: number): void {
    if (!this.isOpen) return;
    this.refresh -= dt;
    if (this.refresh <= 0) this.build();
  }

  layout(): void {
    if (this.isOpen) this.build();
  }

  private clear(): void {
    for (const o of this.objects) o.destroy();
    this.objects = [];
  }

  private add<T extends Phaser.GameObjects.GameObject>(o: T): T {
    (o as unknown as Phaser.GameObjects.Components.Depth).setDepth?.(285);
    this.objects.push(o);
    return o;
  }

  private text(x: number, y: number, s: string, size = 12, color = '#e8d8b0'): Phaser.GameObjects.Text {
    return this.add(this.scene.add.text(x, y, s, { ...TEXT, fontSize: `${size}px`, color }));
  }

  private button(x: number, y: number, w: number, label: string, onClick: () => void, enabled = true, color = 0x3a3228): void {
    const bg = this.add(
      this.scene.add
        .rectangle(x, y, w, 22, enabled ? color : 0x201a14, 1)
        .setOrigin(0)
        .setStrokeStyle(1, 0x8a6a3a),
    );
    if (enabled) bg.setInteractive({ useHandCursor: true }).on('pointerdown', onClick);
    this.add(
      this.scene.add
        .text(x + w / 2, y + 11, label, { ...TEXT, fontSize: '11px', color: enabled ? '#e8d8b0' : '#6a604e' })
        .setOrigin(0.5),
    );
  }

  private build(): void {
    this.clear();
    this.refresh = 0.5;
    const s = this.storage;
    if (!s) return;
    const inv = this.world.inventory;
    const { width, height } = this.scene.scale;
    const stored = contents(s);
    const carried = ALL_ITEMS.filter((i) => inv.count(i) > 0);
    const rows = Math.max(stored.length, carried.length, 3);
    const H = Math.min(height - 40, 120 + rows * ROW + 40);
    const x0 = Math.round((width - W) / 2);
    const y0 = Math.round((height - H) / 2);
    this.add(this.scene.add.rectangle(0, 0, width, height, 0x000000, 0.45).setOrigin(0).setInteractive());
    this.add(this.scene.add.rectangle(x0, y0, W, H, 0x140f0a, 0.97).setOrigin(0).setStrokeStyle(2, 0x8a6a3a).setInteractive());
    this.add(
      this.scene.add.text(x0 + PAD, y0 + 10, this.title, { ...TEXT, fontFamily: TITLE, fontSize: '20px', color: '#e0b860' }),
    );
    this.text(x0 + W - 230, y0 + 16, 'E: guardar todos os recursos · Esc fecha', 11, MUTED);
    if (this.message) this.text(x0 + PAD, y0 + 38, this.message, 11, '#ffe08a');

    const colW = (W - PAD * 3) / 2;
    const lx = x0 + PAD;
    const rx = x0 + PAD * 2 + colW;
    const top = y0 + 60;
    this.text(lx, top, 'Guardado aqui', 13, '#cdb98e');
    this.text(rx, top, `Com você · ${inv.weight}/${inv.maxWeight} kg`, 13, '#cdb98e');

    const act = (fn: () => number, verb: string, label: string) => () => {
      const n = fn();
      this.message =
        n > 0
          ? `${verb} ${n} ${label}.`
          : verb === 'Pegou'
            ? 'Sem espaço ou peso livre.'
            : 'Ferramentas gastas não podem ser guardadas.';
      this.build();
    };

    const row = (x: number, y: number, item: ItemId, n: number) => {
      this.add(this.scene.add.image(x + 8, y + 10, `icon_${item}`).setScale(2));
      this.text(x + 22, y + 3, `${ITEM_DEFS[item].label}`, 12);
      this.text(x + 124, y + 3, `${n}`, 12, '#e0b860');
    };

    let y = top + 22;
    if (stored.length === 0) this.text(lx, y + 3, 'Vazio.', 12, MUTED);
    for (const [item, n] of stored) {
      row(lx, y, item, n);
      const label = ITEM_DEFS[item].label.toLowerCase();
      this.button(
        lx + colW - 150,
        y,
        46,
        'Pegar',
        act(() => takeFrom(this.storage!, inv, item, 1), 'Pegou', label),
      );
      this.button(
        lx + colW - 100,
        y,
        46,
        '+10',
        act(() => takeFrom(this.storage!, inv, item, 10), 'Pegou', label),
      );
      this.button(
        lx + colW - 50,
        y,
        50,
        'Tudo',
        act(() => takeFrom(this.storage!, inv, item, Infinity), 'Pegou', label),
      );
      y += ROW;
    }

    y = top + 22;
    if (carried.length === 0) this.text(rx, y + 3, 'Nada.', 12, MUTED);
    for (const item of carried) {
      row(rx, y, item, inv.count(item));
      const label = ITEM_DEFS[item].label.toLowerCase();
      this.button(
        rx + colW - 104,
        y,
        50,
        'Guardar',
        act(() => putInto(this.storage!, inv, item, 1), 'Guardou', label),
      );
      this.button(
        rx + colW - 50,
        y,
        50,
        'Tudo',
        act(() => putInto(this.storage!, inv, item, Infinity), 'Guardou', label),
      );
      y += ROW;
    }
  }
}
