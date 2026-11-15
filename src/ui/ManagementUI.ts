import type Phaser from 'phaser';
import { BEDS_PER_HOUSE } from '../config';
import { BUILDING_DEFS, type Building } from '../game/buildings';
import { RESOURCE_LABEL, RESOURCES } from '../game/inventory';
import { foodDays, isStarving } from '../game/needs';
import { jobTitle, type NpcData, SKILL_LABEL, SKILLS, stars } from '../game/npcs';
import type { WorldScene } from '../scenes/WorldScene';

export type Tab = 'summary' | 'people' | 'buildings' | 'diplomacy' | 'dynasty';

const TABS: [Tab, string][] = [
  ['summary', 'Resumo'],
  ['people', 'Aldeões'],
  ['buildings', 'Prédios'],
  ['diplomacy', 'Diplomacia'],
  ['dynasty', 'Dinastia'],
];
const TEXT = { fontFamily: '"Alegreya", Georgia, serif', color: '#e8d8b0' } satisfies Phaser.Types.GameObjects.Text.TextStyle;
const MUTED = '#a8977a';
const PAGE = 12;

/** Extra tabs (diplomacy, dynasty) plug in content builders here. */
export type TabRenderer = (ui: ManagementUI, x: number, y: number, w: number, h: number) => void;

/**
 * Village management (V): tabbed full-screen panel. Rebuilt on tab change and refreshed every
 * second while open. Clicking a villager opens their card; clicking a building opens its panel.
 */
export class ManagementUI {
  isOpen = false;
  tab: Tab = 'summary';
  page = 0;
  readonly renderers: Partial<Record<Tab, TabRenderer>> = {};
  private objects: Phaser.GameObjects.GameObject[] = [];
  private refresh = 0;

  constructor(
    readonly scene: Phaser.Scene,
    readonly world: WorldScene,
    /** Opens another panel (villager card / building panel) on top of this one. */
    private readonly openNpc: (n: NpcData) => void,
    private readonly openBuilding: (b: Building) => void,
  ) {}

  toggle(tab?: Tab): void {
    if (this.isOpen && (!tab || tab === this.tab)) this.close();
    else this.open(tab ?? this.tab);
  }

  open(tab: Tab = this.tab): void {
    this.isOpen = true;
    this.tab = tab;
    this.world.modalOpen = true;
    this.build();
  }

  close(): void {
    this.isOpen = false;
    this.world.modalOpen = false;
    this.clear();
  }

  update(dt: number): void {
    if (!this.isOpen) return;
    this.refresh -= dt;
    if (this.refresh <= 0) this.build();
  }

  layout(): void {
    if (this.isOpen) this.build();
  }

  /** Adds a display object that lives until the next rebuild. */
  add<T extends Phaser.GameObjects.GameObject>(o: T): T {
    (o as unknown as Phaser.GameObjects.Components.Depth).setDepth?.(260);
    this.objects.push(o);
    return o;
  }

  text(x: number, y: number, s: string, size = 12, color = '#e8d8b0'): Phaser.GameObjects.Text {
    return this.add(this.scene.add.text(x, y, s, { ...TEXT, fontSize: `${size}px`, color }));
  }

  button(x: number, y: number, w: number, label: string, onClick: () => void, color = 0x3a3228): void {
    const bg = this.add(this.scene.add.rectangle(x, y, w, 24, color, 1).setOrigin(0).setStrokeStyle(1, 0x8a6a3a));
    bg.setInteractive({ useHandCursor: true }).on('pointerdown', onClick);
    this.add(this.scene.add.text(x + w / 2, y + 12, label, { ...TEXT, fontSize: '12px' }).setOrigin(0.5));
  }

  /** Re-renders the panel (also called by tab renderers after actions). */
  build(): void {
    this.clear();
    this.refresh = 1;
    const s = this.scene;
    const { width, height } = s.scale;
    const W = Math.min(900, width - 40);
    const H = Math.min(560, height - 40);
    const x0 = Math.round((width - W) / 2);
    const y0 = Math.round((height - H) / 2);
    this.add(s.add.rectangle(0, 0, width, height, 0x000000, 0.5).setOrigin(0).setInteractive());
    this.add(s.add.rectangle(x0, y0, W, H, 0x140f0a, 0.97).setOrigin(0).setStrokeStyle(2, 0x8a6a3a).setInteractive());
    this.text(x0 + 16, y0 + 10, `${this.world.factions[0].name} · Dia ${this.world.clock.day}`, 20, '#e0b860').setFontFamily(
      '"MedievalSharp", "Alegreya", Georgia, serif',
    );
    this.text(x0 + W - 190, y0 + 14, 'V ou Esc fecha', 11, MUTED);
    TABS.forEach(([id, label], k) => {
      const active = id === this.tab;
      this.button(
        x0 + 16 + k * 120,
        y0 + 42,
        114,
        label,
        () => {
          this.tab = id;
          this.page = 0;
          this.build();
        },
        active ? 0x8a6a3a : 0x241a12,
      );
    });
    const cx = x0 + 16;
    const cy = y0 + 80;
    const cw = W - 32;
    const ch = H - 96;
    const custom = this.renderers[this.tab];
    if (custom) custom(this, cx, cy, cw, ch);
    else if (this.tab === 'summary') this.summary(cx, cy, cw);
    else if (this.tab === 'people') this.people(cx, cy, cw);
    else if (this.tab === 'buildings') this.buildingsTab(cx, cy, cw);
  }

  private clear(): void {
    for (const o of this.objects) o.destroy();
    this.objects = [];
  }

  private summary(x: number, y: number, w: number): void {
    const world = this.world;
    const pop = world.population;
    const villagers = pop.villagers;
    const days = foodDays(villagers, world.stockpile);
    const employed = villagers.filter((n) => n.jobId !== null).length;
    const lines: [string, string][] = [
      ['População', `${villagers.length} aldeões · ${pop.beds} camas (${pop.freeBeds} livres)`],
      ['Trabalho', `${employed} empregados · ${villagers.length - employed} sem trabalho`],
      ['Comida', Number.isFinite(days) ? `${days.toFixed(1).replace('.', ',')} dias de carne` : 'ninguém para alimentar'],
      ['Famintos', `${villagers.filter((n) => isStarving(n)).length}`],
      ['Território', `${world.territory.area(0)} quadrados`],
      [
        'Prédios',
        `${world.buildings.list.filter((b) => b.faction === 0 && b.built).length} prontos · ${world.buildings.list.filter((b) => b.faction === 0 && !b.built).length} em obra`,
      ],
      ['Você', `nível ${world.stats.level} · vida ${world.stats.hp}/${world.stats.maxHp}`],
    ];
    let yy = y;
    for (const [k, v] of lines) {
      this.text(x, yy, k, 13, '#cdb98e');
      this.text(x + 120, yy, v, 13);
      yy += 22;
    }
    yy += 8;
    this.text(x, yy, 'Estoque', 13, '#cdb98e');
    RESOURCES.forEach((r, k) => {
      this.add(this.scene.add.image(x + 120 + k * 130, yy + 7, `icon_${r}`).setScale(2));
      this.text(x + 134 + k * 130, yy, `${RESOURCE_LABEL[r]} ${world.stockpile.items[r]}`, 13);
    });

    // Other villages at a glance.
    let ty = yy + 44;
    this.text(x, ty, 'Vilas da região', 13, '#cdb98e');
    ty += 22;
    this.text(x, ty, 'Vila', 11, MUTED);
    this.text(x + 200, ty, 'Aldeões', 11, MUTED);
    this.text(x + 290, ty, 'Território', 11, MUTED);
    this.text(x + 390, ty, 'Relação', 11, MUTED);
    ty += 18;
    for (const f of world.factions) {
      if (f.isPlayer) continue;
      this.add(
        this.scene.add
          .rectangle(x, ty + 3, 10, 10, f.color)
          .setOrigin(0)
          .setAlpha(f.alive ? 1 : 0.3),
      );
      this.text(x + 16, ty, f.alive ? f.name : `${f.name} (conquistada)`, 12);
      this.text(x + 200, ty, `${pop.villagersOf(f.id).length}`, 12);
      this.text(x + 290, ty, `${world.territory.area(f.id)}`, 12);
      this.text(x + 390, ty, world.relationLabel(f.id), 12);
      ty += 20;
    }
    void w;
  }

  private people(x: number, y: number, w: number): void {
    const list = this.world.population.villagers;
    if (list.length === 0) {
      this.text(x, y, 'Nenhum aldeão ainda. Recrute andarilhos (o "!" sobre a cabeça).', 13, MUTED);
      return;
    }
    const cols = [0, 160, 290, ...SKILLS.map((_, k) => 400 + k * 58), 400 + SKILLS.length * 58, 400 + SKILLS.length * 58 + 70];
    const head = ['Nome', 'Trabalho', 'Idade', ...SKILLS.map((s) => SKILL_LABEL[s].slice(0, 6)), 'Fome', 'Vida'];
    head.forEach((h, k) => {
      this.text(x + cols[k], y, h, 11, MUTED);
    });
    const pages = Math.ceil(list.length / PAGE);
    this.page = Math.min(this.page, pages - 1);
    let yy = y + 20;
    for (const n of list.slice(this.page * PAGE, (this.page + 1) * PAGE)) {
      const row = this.add(this.scene.add.rectangle(x - 4, yy - 2, w, 22, 0x241a12, 0.001).setOrigin(0));
      row
        .setInteractive({ useHandCursor: true })
        .on('pointerover', () => row.setFillStyle(0x3a2e20, 1))
        .on('pointerout', () => row.setFillStyle(0x241a12, 0.001))
        .on('pointerdown', () => this.openNpc(n));
      const cells = [
        n.name,
        jobTitle(n, this.world.buildings),
        this.world.ageLabel(n),
        ...SKILLS.map((s) => stars(n.skills[s]).replace(/☆/g, '·')),
        `${Math.round(100 - n.food)}%`,
        `${n.hp}`,
      ];
      cells.forEach((c, k) => {
        this.text(x + cols[k], yy, c, 11, k === cells.length - 2 && isStarving(n) ? '#ff8a7a' : '#e8d8b0');
      });
      yy += 24;
    }
    if (pages > 1) {
      this.text(x, yy + 8, `Página ${this.page + 1}/${pages}`, 11, MUTED);
      this.button(x + 120, yy + 4, 40, '◀', () => {
        this.page = Math.max(0, this.page - 1);
        this.build();
      });
      this.button(x + 166, yy + 4, 40, '▶', () => {
        this.page = Math.min(pages - 1, this.page + 1);
        this.build();
      });
    }
    this.text(x, yy + 36, 'Clique num aldeão para ver o cartão completo.', 11, MUTED);
  }

  private buildingsTab(x: number, y: number, w: number): void {
    const mine = this.world.buildings.list.filter((b) => b.faction === 0);
    const pop = this.world.population;
    this.text(x, y, 'Prédio', 11, MUTED);
    this.text(x + 240, y, 'Estado', 11, MUTED);
    this.text(x + 380, y, 'Pessoas', 11, MUTED);
    const pages = Math.max(1, Math.ceil(mine.length / PAGE));
    this.page = Math.min(this.page, pages - 1);
    let yy = y + 20;
    for (const b of mine.slice(this.page * PAGE, (this.page + 1) * PAGE)) {
      const def = BUILDING_DEFS[b.type];
      const row = this.add(this.scene.add.rectangle(x - 4, yy - 2, w, 22, 0x241a12, 0.001).setOrigin(0));
      const opens = b.built && (def.job || b.type === 'house');
      if (opens) {
        row
          .setInteractive({ useHandCursor: true })
          .on('pointerover', () => row.setFillStyle(0x3a2e20, 1))
          .on('pointerout', () => row.setFillStyle(0x241a12, 0.001))
          .on('pointerdown', () => this.openBuilding(b));
      }
      const state = b.built ? this.world.buildingHealthLabel(b) : `obra ${Math.floor((b.progress / def.buildSeconds) * 100)}%`;
      let people = '';
      if (def.job) people = `${pop.workers(b.id).length}/${def.job.slots} trabalhando`;
      if (b.type === 'house') people = `${pop.residents(b.id).length}/${BEDS_PER_HOUSE} moradores`;
      this.text(x, yy, def.name, 12);
      this.text(x + 240, yy, state, 12, b.built ? '#e8d8b0' : '#ffc060');
      this.text(x + 380, yy, people, 12);
      yy += 24;
    }
    if (pages > 1) {
      this.button(x, yy + 4, 40, '◀', () => {
        this.page = Math.max(0, this.page - 1);
        this.build();
      });
      this.button(x + 46, yy + 4, 40, '▶', () => {
        this.page = Math.min(pages - 1, this.page + 1);
        this.build();
      });
    }
  }
}
