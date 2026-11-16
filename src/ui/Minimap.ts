import type Phaser from 'phaser';
import { SPECIES } from '../game/animals';
import { BUILDING_DEFS } from '../game/buildings';
import type { WorldScene } from '../scenes/WorldScene';
import { Ground, Obj } from '../world/map';

/** Pixels per tile step on the minimap (isometric, so a tile is K wide and K/2 tall). */
const K = 0.75;
const PAD = 6;
const TERRAIN_REFRESH = 2; // seconds

const GROUND_COLOR: Record<Ground, string> = {
  [Ground.Grass]: '#34502a',
  [Ground.Water]: '#1e3a50',
  [Ground.Sand]: '#8a7a58',
  [Ground.Dirt]: '#4e4236',
};
const OBJ_COLOR: Partial<Record<Obj, string>> = {
  [Obj.Tree]: '#1f3a1a',
  [Obj.Pine]: '#17301f',
  [Obj.Rock]: '#6a655e',
  [Obj.Iron]: '#a8622e',
  [Obj.Building]: '#7a5530',
  [Obj.Road]: '#7a6a58',
};

/**
 * Isometric overview in the bottom-right corner (toggle with M). Terrain and objects are painted
 * into a canvas texture every couple of seconds; people, animals and buildings are dots redrawn
 * every frame.
 */
export class Minimap {
  visible = true;
  private readonly tex: Phaser.Textures.CanvasTexture;
  private readonly frame: Phaser.GameObjects.Rectangle;
  private readonly image: Phaser.GameObjects.Image;
  private readonly dots: Phaser.GameObjects.Graphics;
  private readonly label: Phaser.GameObjects.Text;
  private readonly w: number;
  private readonly h: number;
  private refresh = 0;
  private origin = { x: 0, y: 0 };

  constructor(
    scene: Phaser.Scene,
    private readonly world: WorldScene,
  ) {
    const m = world.map;
    this.w = Math.ceil((m.w + m.h) * K);
    this.h = Math.ceil(((m.w + m.h) * K) / 2);
    if (scene.textures.exists('minimap')) scene.textures.remove('minimap'); // scene restart
    this.tex = scene.textures.createCanvas('minimap', this.w, this.h)!;
    this.frame = scene.add
      .rectangle(0, 0, this.w + PAD * 2, this.h + PAD * 2, 0x000000, 0.55)
      .setOrigin(0)
      .setStrokeStyle(1, 0x8a6a3a);
    this.image = scene.add.image(0, 0, 'minimap').setOrigin(0);
    this.dots = scene.add.graphics();
    this.label = scene.add.text(0, 0, 'N: ocultar · M: mapa', {
      fontFamily: '"Alegreya", Georgia, serif',
      fontSize: '10px',
      color: '#a8977a',
    });
    this.paintTerrain();
  }

  toggle(): void {
    this.visible = !this.visible;
    for (const o of [this.frame, this.image, this.dots, this.label]) o.setVisible(this.visible);
  }

  layout(width: number, height: number): void {
    const x = width - this.w - PAD * 2 - 8;
    const y = height - this.h - PAD * 2 - 8;
    this.frame.setPosition(x, y);
    this.image.setPosition(x + PAD, y + PAD);
    this.label.setPosition(x + 4, y - 13);
    this.origin = { x: x + PAD, y: y + PAD };
  }

  update(dt: number): void {
    if (!this.visible) return;
    this.refresh -= dt;
    if (this.refresh <= 0) {
      this.refresh = TERRAIN_REFRESH;
      this.paintTerrain();
    }
    const g = this.dots.clear();
    const w = this.world;
    const dot = (gx: number, gy: number, color: number, size = 2) => {
      const p = this.project(gx, gy);
      g.fillStyle(color, 1).fillRect(
        Math.round(this.origin.x + p.x - size / 2),
        Math.round(this.origin.y + p.y - size / 2),
        size,
        size,
      );
    };
    for (const b of w.buildings.list) {
      const s = BUILDING_DEFS[b.type].size;
      dot(b.tx + s / 2, b.ty + s / 2, b.built ? w.factions[b.faction].color : 0x8a7350, s + 1);
    }
    for (const a of w.wildlife.animals.values()) {
      if (!a.alive) continue;
      dot(a.data.gx, a.data.gy, SPECIES[a.data.species].temper === 'aggressive' ? 0xff4030 : 0xe8d8b0);
    }
    for (const n of w.npcList()) {
      if (n.indoors) continue;
      if (n.data.role === 'wanderer') dot(n.gx, n.gy, 0xffe060, 2);
      else if (n.data.role === 'bandit') dot(n.gx, n.gy, 0xff3020, 2);
      else if (n.data.faction === 0) dot(n.gx, n.gy, 0x6ab0ff, 2);
    }
    dot(w.player.gx, w.player.gy, 0xffffff, 3);
  }

  /** Grid → minimap pixels (same diamond projection as the world). */
  private project(gx: number, gy: number): { x: number; y: number } {
    return { x: (gx - gy) * K + this.world.map.h * K, y: ((gx + gy) * K) / 2 };
  }

  private paintTerrain(): void {
    const m = this.world.map;
    const ctx = this.tex.getContext();
    ctx.clearRect(0, 0, this.w, this.h);
    for (let ty = 0; ty < m.h; ty++) {
      for (let tx = 0; tx < m.w; tx++) {
        const i = ty * m.w + tx;
        const p = this.project(tx + 0.5, ty + 0.5);
        ctx.fillStyle = OBJ_COLOR[m.objects[i]] ?? GROUND_COLOR[m.ground[i]];
        ctx.fillRect(Math.round(p.x - K), Math.round(p.y - K / 2), Math.ceil(K * 2), Math.ceil(K));
        const owner = this.world.territory.owner[i];
        if (owner >= 0) {
          ctx.fillStyle = this.world.factions[owner].css + '66';
          ctx.fillRect(Math.round(p.x - K), Math.round(p.y - K / 2), Math.ceil(K * 2), Math.ceil(K));
        }
      }
    }
    this.tex.refresh();
  }
}
