import type Phaser from 'phaser';
import { BEDS_PER_HOUSE } from '../config';
import { BUILDING_DEFS, type Building } from '../game/buildings';
import { jobTitle, type NpcData, productivity, SKILL_LABEL, stars } from '../game/npcs';
import { npcSpriteKey } from '../gfx/textures';
import type { WorldScene } from '../scenes/WorldScene';

const W = 460;
const PAD = 16;
const ROW = 34;
const TEXT = { fontFamily: 'monospace', color: '#f3e9d2' } satisfies Phaser.Types.GameObjects.Text.TextStyle;

/**
 * Panel for a finished workplace (assign/remove workers, ranked by their rating for the job's skill)
 * or a house (list of residents). Rebuilt whenever something changes; modal while open.
 */
export class BuildingPanelUI {
  building: Building | null = null;
  private container: Phaser.GameObjects.Container | null = null;
  private signature = '';

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly world: WorldScene,
    private readonly onClose: () => void,
  ) {}

  get isOpen(): boolean {
    return this.building !== null;
  }

  open(b: Building): void {
    this.building = b;
    this.rebuild();
  }

  close(): void {
    this.container?.destroy();
    this.container = null;
    if (this.building) this.onClose();
    this.building = null;
  }

  update(): void {
    if (!this.building) return;
    // Rebuild only when the people involved change (cheap signature check).
    const sig = this.world.population.villagers.map((n) => `${n.id}:${n.jobId}`).join(',');
    if (sig !== this.signature) this.rebuild();
  }

  layout(width: number, height: number): void {
    if (!this.container) return;
    const h = this.container.getData('height') as number;
    this.container.setPosition(Math.round((width - W) / 2), Math.round((height - h) / 2));
  }

  private rebuild(): void {
    const b = this.building!;
    const def = BUILDING_DEFS[b.type];
    const pop = this.world.population;
    this.signature = pop.villagers.map((n) => `${n.id}:${n.jobId}`).join(',');
    this.container?.destroy();
    const s = this.scene;
    const items: Phaser.GameObjects.GameObject[] = [];
    let y = PAD;

    items.push(s.add.text(PAD, y, def.name, { ...TEXT, fontSize: '17px' }));
    y += 28;

    const row = (npc: NpcData, label: string, sub: string, action?: { text: string; color: number; onClick: () => void }) => {
      items.push(
        s.add.image(PAD + 10, y + ROW / 2 + 6, `${npcSpriteKey(npc.variant, npc.gender)}_idle`).setScale(1.5),
        s.add.text(PAD + 26, y + 2, label, { ...TEXT, fontSize: '13px' }),
        s.add.text(PAD + 26, y + 18, sub, { ...TEXT, fontSize: '11px', color: '#a89a80' }),
      );
      if (action) {
        const bg = s.add
          .rectangle(W - PAD - 92, y + 3, 92, 26, action.color, 1)
          .setOrigin(0)
          .setStrokeStyle(1, 0x5a4630);
        bg.setInteractive({ useHandCursor: true }).on('pointerdown', action.onClick);
        items.push(bg, s.add.text(W - PAD - 46, y + 16, action.text, { ...TEXT, fontSize: '12px' }).setOrigin(0.5));
      }
      y += ROW + 4;
    };

    if (def.job) {
      const job = def.job;
      const skill = job.skill;
      const workers = pop.workers(b.id);
      const rate = (n: NpcData) => `${SKILL_LABEL[skill]} ${stars(n.skills[skill])}  ×${productivity(n, skill).toFixed(2)}`;
      items.push(
        s.add.text(PAD, y, `Trabalhadores ${workers.length}/${job.slots}`, { ...TEXT, fontSize: '13px', color: '#cfc3a8' }),
      );
      y += 22;
      if (workers.length === 0) {
        items.push(s.add.text(PAD + 8, y, 'Ninguém trabalhando aqui.', { ...TEXT, fontSize: '12px', color: '#a89a80' }));
        y += 22;
      }
      for (const w of workers) {
        const status = this.world.npcStatus(w.id);
        row(w, `${w.name} · ${job.title[w.gender]}`, status ?? rate(w), {
          text: 'Dispensar',
          color: 0x5a2a24,
          onClick: () => {
            pop.unassign(w);
            this.rebuild();
          },
        });
      }
      y += 6;
      items.push(s.add.text(PAD, y, 'Aldeões sem trabalho (melhores primeiro)', { ...TEXT, fontSize: '13px', color: '#cfc3a8' }));
      y += 22;
      const free = pop.unemployed(skill);
      if (free.length === 0) {
        items.push(
          s.add.text(PAD + 8, y, 'Nenhum. Recrute andarilhos para ter mais gente.', {
            ...TEXT,
            fontSize: '12px',
            color: '#a89a80',
          }),
        );
        y += 22;
      }
      const full = workers.length >= job.slots;
      for (const n of free.slice(0, 6)) {
        row(n, `${n.name}`, rate(n), {
          text: full ? 'Lotado' : 'Contratar',
          color: full ? 0x3a3228 : 0x3c6a2c,
          onClick: () => {
            if (pop.assign(n, b)) this.rebuild();
          },
        });
      }
    } else {
      const residents = pop.residents(b.id);
      items.push(
        s.add.text(PAD, y, `Moradores ${residents.length}/${BEDS_PER_HOUSE}`, { ...TEXT, fontSize: '13px', color: '#cfc3a8' }),
      );
      y += 22;
      if (residents.length === 0) {
        items.push(s.add.text(PAD + 8, y, 'Camas livres: recrute andarilhos.', { ...TEXT, fontSize: '12px', color: '#a89a80' }));
        y += 22;
      }
      for (const n of residents) row(n, `${n.name} · ${jobTitle(n, this.world.buildings)}`, '');
    }

    y += 8;
    const close = s.add
      .rectangle(W - PAD - 150, y, 150, 28, 0x3a3228, 1)
      .setOrigin(0)
      .setStrokeStyle(1, 0x5a4630);
    close.setInteractive({ useHandCursor: true }).on('pointerdown', () => this.close());
    items.push(close, s.add.text(W - PAD - 75, y + 14, 'Fechar  [Esc]', { ...TEXT, fontSize: '12px' }).setOrigin(0.5));
    y += 28 + PAD;

    const bg = s.add.rectangle(0, 0, W, y, 0x1a140e, 0.96).setOrigin(0).setStrokeStyle(2, 0x5a4630).setInteractive();
    const c = s.add.container(0, 0, [bg, ...items]).setDepth(150);
    c.setData('height', y);
    this.container = c;
    this.layout(s.scale.width, s.scale.height);
  }
}
