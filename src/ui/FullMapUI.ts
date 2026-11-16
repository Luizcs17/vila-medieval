import type Phaser from 'phaser';
import { BUILDING_DEFS } from '../game/buildings';
import type { WorldScene } from '../scenes/WorldScene';
import { Ground, Obj } from '../world/map';

const GROUND_COLOR: Record<Ground, [number, number, number]> = {
  [Ground.Grass]: [52, 80, 42],
  [Ground.Water]: [30, 58, 80],
  [Ground.Sand]: [138, 122, 88],
  [Ground.Dirt]: [78, 66, 54],
};
const OBJ_COLOR: Partial<Record<Obj, [number, number, number]>> = {
  [Obj.Tree]: [31, 58, 26],
  [Obj.Pine]: [23, 48, 31],
  [Obj.Rock]: [106, 101, 94],
  [Obj.Iron]: [168, 98, 46],
  [Obj.Road]: [122, 106, 88],
};
const TEXT = { fontFamily: '"Alegreya", Georgia, serif', color: '#e8d8b0' } satisfies Phaser.Types.GameObjects.Text.TextStyle;

/**
 * Full-screen map (M): terrain, every village's territory tinted in its colour with a solid border,
 * buildings, village names, a legend, and you. Painted into a canvas when opened (and refreshed
 * while open), sized to fit the screen.
 */
export class FullMapUI {
  isOpen = false;
  private objects: Phaser.GameObjects.GameObject[] = [];
  private dots?: Phaser.GameObjects.Graphics;
  private k = 2;
  private origin = { x: 0, y: 0 };
  private refresh = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly world: WorldScene,
  ) {}

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  open(): void {
    this.isOpen = true;
    this.world.modalOpen = true;
    this.build();
  }

  close(): void {
    this.isOpen = false;
    this.world.modalOpen = false;
    for (const o of this.objects) o.destroy();
    this.objects = [];
    this.dots = undefined;
  }

  layout(): void {
    if (this.isOpen) this.build();
  }

  update(dt: number): void {
    if (!this.isOpen || !this.dots) return;
    this.refresh -= dt;
    if (this.refresh <= 0) {
      this.refresh = 3;
      this.paint();
    }
    // Moving things: you, villagers, wanderers.
    const g = this.dots.clear();
    const w = this.world;
    for (const n of w.npcList()) {
      if (n.indoors) continue;
      const p = this.project(n.gx, n.gy);
      const color =
        n.data.role === 'wanderer' ? 0xffe060 : n.data.role === 'bandit' ? 0xff3020 : w.factions[n.data.faction].color;
      g.fillStyle(color, 1).fillRect(Math.round(p.x) - 1, Math.round(p.y) - 1, 2, 2);
    }
    const p = this.project(w.player.gx, w.player.gy);
    g.fillStyle(0x000000, 1).fillCircle(p.x, p.y, 4.5);
    g.fillStyle(0xffffff, 1).fillCircle(p.x, p.y, 3.5);
  }

  private project(gx: number, gy: number): { x: number; y: number } {
    const k = this.k;
    return { x: this.origin.x + (gx - gy) * k + this.world.map.h * k, y: this.origin.y + ((gx + gy) * k) / 2 };
  }

  private build(): void {
    for (const o of this.objects) o.destroy();
    this.objects = [];
    const s = this.scene;
    const { width, height } = s.scale;
    const m = this.world.map;
    const legendW = 230;
    // Largest scale that fits (isometric: (w+h)·k wide, half that tall).
    this.k = Math.max(1, Math.min((width - legendW - 60) / (m.w + m.h), ((height - 80) * 2) / (m.w + m.h)));
    const mapW = Math.ceil((m.w + m.h) * this.k);
    const mapH = Math.ceil(mapW / 2);
    this.origin = { x: Math.round((width - legendW - mapW) / 2), y: Math.round((height - mapH) / 2) };

    const bg = s.add.rectangle(0, 0, width, height, 0x0e0b08, 0.94).setOrigin(0).setDepth(250).setInteractive();
    if (s.textures.exists('fullmap')) s.textures.remove('fullmap');
    s.textures.createCanvas('fullmap', mapW, mapH);
    const img = s.add.image(this.origin.x, this.origin.y, 'fullmap').setOrigin(0).setDepth(251);
    this.dots = s.add.graphics().setDepth(253);
    const title = s.add
      .text(20, 16, 'Mapa  (M ou Esc fecha)', {
        ...TEXT,
        fontFamily: '"MedievalSharp", "Alegreya", Georgia, serif',
        fontSize: '20px',
        color: '#e0b860',
      })
      .setDepth(252);
    this.objects.push(bg, img, this.dots, title);
    this.paint();
    this.legend(width - legendW - 10);
  }

  /** Terrain + territory tint + borders + buildings into the canvas; village names on top. */
  private paint(): void {
    const tex = this.scene.textures.get('fullmap') as Phaser.Textures.CanvasTexture;
    const ctx = tex.getContext();
    const w = this.world;
    const m = w.map;
    const k = this.k;
    const img = ctx.createImageData(tex.width, tex.height);
    const put = (px: number, py: number, rgb: [number, number, number], a = 1) => {
      if (px < 0 || py < 0 || px >= tex.width || py >= tex.height) return;
      const o = (py * tex.width + px) * 4;
      img.data[o] = img.data[o] * (1 - a) + rgb[0] * a;
      img.data[o + 1] = img.data[o + 1] * (1 - a) + rgb[1] * a;
      img.data[o + 2] = img.data[o + 2] * (1 - a) + rgb[2] * a;
      img.data[o + 3] = 255;
    };
    const factionRgb = w.factions.map(
      (f) => [(f.color >> 16) & 255, (f.color >> 8) & 255, f.color & 255] as [number, number, number],
    );
    const owner = w.territory.owner;
    // Each pixel → the tile under it (inverse isometric projection).
    for (let py = 0; py < tex.height; py++) {
      for (let px = 0; px < tex.width; px++) {
        const sx = (px - m.h * k) / k;
        const sy = (py * 2) / k;
        const gx = Math.floor((sx + sy) / 2);
        const gy = Math.floor((sy - sx) / 2);
        if (gx < 0 || gy < 0 || gx >= m.w || gy >= m.h) continue;
        const i = gy * m.w + gx;
        put(px, py, OBJ_COLOR[m.objects[i]] ?? GROUND_COLOR[m.ground[i]]);
        const o = owner[i];
        if (o >= 0) {
          // Border: a neighbouring tile belongs to someone else.
          const edge =
            (gx > 0 && owner[i - 1] !== o) ||
            (gx < m.w - 1 && owner[i + 1] !== o) ||
            (gy > 0 && owner[i - m.w] !== o) ||
            (gy < m.h - 1 && owner[i + m.w] !== o);
          put(px, py, factionRgb[o], edge ? 0.9 : 0.32);
        }
      }
    }
    // Buildings as solid blocks.
    for (const b of w.buildings.list) {
      const size = BUILDING_DEFS[b.type].size;
      const c = this.project(b.tx + size / 2, b.ty + size / 2);
      const r = Math.max(1, Math.round((size * k) / 1.5));
      const rgb: [number, number, number] = b.built ? [240, 220, 170] : [150, 130, 100];
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) put(Math.round(c.x - this.origin.x + dx), Math.round(c.y - this.origin.y + dy / 2), rgb);
    }
    ctx.putImageData(img, 0, 0);
    tex.refresh();
  }

  private legend(x: number): void {
    const s = this.scene;
    const w = this.world;
    let y = 60;
    const add = (o: Phaser.GameObjects.GameObject) => this.objects.push(o);
    add(s.add.text(x, y, 'Vilas', { ...TEXT, fontSize: '14px', color: '#cdb98e' }).setDepth(252));
    y += 24;
    for (const f of w.factions) {
      add(
        s.add
          .rectangle(x, y + 2, 14, 14, f.color)
          .setOrigin(0)
          .setDepth(252)
          .setAlpha(f.alive ? 1 : 0.3),
      );
      const pop = w.population.villagersOf(f.id).length;
      const status = f.alive ? `${pop} aldeões · ${w.territory.area(f.id)} de terra` : 'conquistada';
      add(s.add.text(x + 22, y, f.name, { ...TEXT, fontSize: '13px' }).setDepth(252));
      add(s.add.text(x + 22, y + 16, status, { ...TEXT, fontSize: '11px', color: '#a8977a' }).setDepth(252));
      // Name over the village on the map.
      const c = this.project(f.center.x + 0.5, f.center.y + 0.5);
      add(
        s.add
          .text(c.x, c.y - 10, f.name, { ...TEXT, fontSize: '12px', color: f.css, stroke: '#000000', strokeThickness: 3 })
          .setOrigin(0.5, 1)
          .setDepth(254),
      );
      y += 40;
    }
    y += 10;
    const key = [
      ['⬤ branco', 'você'],
      ['pontos', 'aldeões (cor da vila), andarilhos em amarelo'],
      ['borda forte', 'fronteira do território'],
    ];
    for (const [a, b] of key) {
      add(
        s.add.text(x, y, `${a}: ${b}`, { ...TEXT, fontSize: '10px', color: '#a8977a', wordWrap: { width: 220 } }).setDepth(252),
      );
      y += 28;
    }
  }
}
