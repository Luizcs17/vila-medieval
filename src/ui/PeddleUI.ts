import type Phaser from 'phaser';
import { ITEM_DEFS, maxDurability } from '../game/items';
import { buyPrice, GOODS, type Good, sellPrice } from '../game/trade';
import type { WorldScene } from '../scenes/WorldScene';

const W = 680;
const PAD = 16;
const ROW = 26;
const TEXT = { fontFamily: '"Alegreya", Georgia, serif', color: '#e8d8b0' } satisfies Phaser.Types.GameObjects.Text.TextStyle;
const MUTED = '#a8977a';
const TITLE = '"MedievalSharp", "Alegreya", Georgia, serif';

/**
 * Trading in person with another village (opened from one of its people): on the left what they
 * sell, on the right what you carry that they'd buy. Prices follow their market (supply), paid
 * with your coins; worn tools sell for less. Modal while open.
 */
export class PeddleUI {
  isOpen = false;
  private faction = -1;
  private objects: Phaser.GameObjects.GameObject[] = [];
  private message = '';

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly world: WorldScene,
  ) {}

  open(faction: number): void {
    this.faction = faction;
    this.isOpen = true;
    this.message = '';
    this.world.modalOpen = true;
    this.build();
  }

  close(): void {
    this.isOpen = false;
    this.world.modalOpen = false;
    this.clear();
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

  private button(x: number, y: number, w: number, label: string, onClick: () => void, color = 0x3a3228): void {
    const bg = this.add(this.scene.add.rectangle(x, y, w, 22, color, 1).setOrigin(0).setStrokeStyle(1, 0x8a6a3a));
    bg.setInteractive({ useHandCursor: true }).on('pointerdown', onClick);
    this.add(this.scene.add.text(x + w / 2, y + 11, label, { ...TEXT, fontSize: '11px' }).setOrigin(0.5));
  }

  /** Trades `times` units, stopping at the first refusal. */
  private trade(g: Good, side: 'buy' | 'sell', times: number): void {
    let done = 0;
    let why: string | null = null;
    for (let k = 0; k < times; k++) {
      why = this.world.peddle(this.faction, g, side);
      if (why) break;
      done++;
    }
    const label = ITEM_DEFS[g].label.toLowerCase();
    this.message = done > 0 ? `${side === 'buy' ? 'Comprou' : 'Vendeu'} ${done} ${label}.${why ? ` ${why}` : ''}` : (why ?? '');
    this.build();
  }

  private build(): void {
    this.clear();
    const f = this.world.factions[this.faction];
    if (!f) return;
    const market = this.world.marketOf(f);
    const inv = this.world.inventory;
    const me = this.world.factions[0];
    const { width, height } = this.scene.scale;
    const selling = GOODS.filter((g) => market.forSale(g) > 0);
    const carried = GOODS.filter((g) => inv.count(g) > 0);
    const rows = Math.max(selling.length, carried.length, 3);
    const H = Math.min(height - 40, 130 + rows * ROW + 30);
    const x0 = Math.round((width - W) / 2);
    const y0 = Math.round((height - H) / 2);
    this.add(this.scene.add.rectangle(0, 0, width, height, 0x000000, 0.45).setOrigin(0).setInteractive());
    this.add(this.scene.add.rectangle(x0, y0, W, H, 0x140f0a, 0.97).setOrigin(0).setStrokeStyle(2, 0x8a6a3a).setInteractive());
    this.add(
      this.scene.add.text(x0 + PAD, y0 + 10, `Comércio · ${f.name}`, {
        ...TEXT,
        fontFamily: TITLE,
        fontSize: '20px',
        color: f.css,
      }),
    );
    this.text(x0 + W - 250, y0 + 16, `Suas moedas ⛁ ${me.coins} · deles ⛁ ${f.coins} · Esc`, 11, MUTED);
    if (this.message) this.text(x0 + PAD, y0 + 38, this.message, 11, '#ffe08a');

    const colW = (W - PAD * 3) / 2;
    const lx = x0 + PAD;
    const rx = x0 + PAD * 2 + colW;
    const top = y0 + 60;
    this.text(lx, top, 'Eles vendem', 13, '#cdb98e');
    this.text(rx, top, `Você vende · ${inv.weight}/${inv.maxWeight} kg`, 13, '#cdb98e');

    const row = (x: number, y: number, g: Good, n: number, price: number) => {
      this.add(this.scene.add.image(x + 8, y + 10, `icon_${g}`).setScale(2));
      this.text(x + 22, y + 3, ITEM_DEFS[g].label, 12);
      this.text(x + 132, y + 3, `${n}`, 12, MUTED);
      this.text(x + 160, y + 3, `⛁ ${price}`, 12, '#e0b860');
    };

    let y = top + 22;
    if (selling.length === 0) this.text(lx, y + 3, 'Nada à venda agora.', 12, MUTED);
    for (const g of selling) {
      row(lx, y, g, market.forSale(g), buyPrice(g, market.have(g)));
      this.button(lx + colW - 96, y, 46, 'Comprar', () => this.trade(g, 'buy', 1), 0x2c4a2a);
      if (!ITEM_DEFS[g].tool && !ITEM_DEFS[g].armor)
        this.button(lx + colW - 46, y, 46, '+5', () => this.trade(g, 'buy', 5), 0x2c4a2a);
      y += ROW;
    }

    y = top + 22;
    if (carried.length === 0) this.text(rx, y + 3, 'Você não carrega nada que se venda.', 12, MUTED);
    for (const g of carried) {
      const slot = this.world.sellSlot(g);
      const s = slot >= 0 ? inv.slots[slot] : null;
      const max = maxDurability(g);
      const condition = max && s?.durability !== undefined ? s.durability / max : 1;
      const wanted = market.wants(g) > 0;
      const price = Math.max(1, Math.round(sellPrice(g, market.have(g)) * condition));
      row(rx, y, g, inv.count(g), price);
      if (!wanted) this.text(rx + colW - 96, y + 3, 'Não querem', 11, MUTED);
      else {
        this.button(rx + colW - 96, y, 46, 'Vender', () => this.trade(g, 'sell', 1), 0x4a3a1e);
        if (!ITEM_DEFS[g].tool && !ITEM_DEFS[g].armor)
          this.button(rx + colW - 46, y, 46, '+5', () => this.trade(g, 'sell', 5), 0x4a3a1e);
      }
      y += ROW;
    }
    this.text(
      x0 + PAD,
      y0 + H - 22,
      'Os preços sobem quando falta e caem quando sobra. Ferramentas gastas valem menos.',
      11,
      MUTED,
    );
  }
}
