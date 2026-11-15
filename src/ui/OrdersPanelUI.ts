import type Phaser from 'phaser';
import { QUICK_ORDER_RADIUS } from '../config';
import { commandLabel, STANCE_LABEL, stanceOf } from '../game/orders';
import type { WorldScene } from '../scenes/WorldScene';

const W = 300;
const PAD = 12;
const ROW = 20;
const TEXT = { fontFamily: '"Alegreya", Georgia, serif', color: '#e8d8b0' } satisfies Phaser.Types.GameObjects.Text.TextStyle;

/**
 * F1: a table on the right side listing your companions and soldiers nearby, with the quick
 * orders: F1 again = everyone follows you, F2 = everyone stays where they are. Not modal: you
 * can keep walking while it's open. Individual orders stay on each person's card.
 */
export class OrdersPanelUI {
  isOpen = false;
  private objects: Phaser.GameObjects.GameObject[] = [];
  private refresh = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly world: WorldScene,
  ) {}

  open(): void {
    this.isOpen = true;
    this.build();
  }

  close(): void {
    this.isOpen = false;
    this.clear();
  }

  /** F1 while open: everyone follows. F2: everyone stays. Both close the table. */
  order(kind: 'follow' | 'stay'): void {
    this.world.orderNearby(kind);
    this.close();
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
    (o as unknown as Phaser.GameObjects.Components.Depth).setDepth?.(150);
    this.objects.push(o);
    return o;
  }

  private text(x: number, y: number, s: string, size = 12, color = '#e8d8b0'): Phaser.GameObjects.Text {
    return this.add(this.scene.add.text(x, y, s, { ...TEXT, fontSize: `${size}px`, color }));
  }

  private build(): void {
    this.clear();
    this.refresh = 0.5;
    const people = this.world.nearbyCommandables().slice(0, 12);
    const { width } = this.scene.scale;
    const H = 92 + Math.max(1, people.length) * ROW + 32;
    const x0 = width - W - 12;
    const y0 = 96;
    this.add(this.scene.add.rectangle(x0, y0, W, H, 0x140f0a, 0.94).setOrigin(0).setStrokeStyle(2, 0x8a6a3a));
    this.add(
      this.scene.add.text(x0 + PAD, y0 + 8, 'Ordens', {
        ...TEXT,
        fontFamily: '"MedievalSharp", "Alegreya", Georgia, serif',
        fontSize: '18px',
        color: '#e0b860',
      }),
    );
    this.text(x0 + PAD, y0 + 34, '[F1] Siga-me (todos)', 13, '#a8d8ff');
    this.text(x0 + PAD, y0 + 52, '[F2] Fiquem aqui (cada um onde está)', 13, '#a8d8ff');
    this.text(x0 + PAD, y0 + 72, `Quem recebe (até ${QUICK_ORDER_RADIUS} casas de você):`, 11, '#a8977a');
    let y = y0 + 92;
    if (people.length === 0) {
      this.text(x0 + PAD, y, 'Ninguém por perto. Companheiros e soldados.', 12, '#a8977a');
      y += ROW;
    }
    for (const n of people) {
      const soldier = n.role !== 'companion';
      this.text(x0 + PAD, y, `${n.name}${soldier ? ' (soldado)' : ''}`, 12);
      this.text(x0 + PAD + 120, y, STANCE_LABEL[stanceOf(n)], 11, '#cdb98e');
      this.text(x0 + PAD + 190, y, commandLabel(n.command, !soldier).replace(' (padrão)', ''), 11, '#a8977a');
      y += ROW;
    }
    this.text(x0 + PAD, y + 10, 'Esc fecha · ordens individuais: E na pessoa', 11, '#a8977a');
  }
}
