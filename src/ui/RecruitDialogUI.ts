import type Phaser from 'phaser';
import { DAY_SECONDS } from '../config';
import { RESOURCE_LABEL, RESOURCES } from '../game/inventory';
import { jobTitle, type NpcData, roleLabel, SKILL_LABEL, SKILLS, stars, TIER_COLOR, TRAITS, tierLabel } from '../game/npcs';
import { npcSpriteKey } from '../gfx/textures';
import type { WorldScene } from '../scenes/WorldScene';

const W = 440;
const PAD = 16;
const TEXT = { fontFamily: 'monospace', color: '#f3e9d2' } satisfies Phaser.Types.GameObjects.Text.TextStyle;
const OK = '#a8e890';
const MISSING = '#ff8a7a';

interface Line {
  text: Phaser.GameObjects.Text;
  /** Recomputes the line's text and whether its requirement is met. */
  eval: () => { label: string; met: boolean };
}

/**
 * Card shown when talking to an NPC. For wanderers it lists traits and the recruitment request
 * (a free bed + resources, payable from the inventory and the stockpile) with a Recruit button.
 * For villagers it is an info card.
 */
export class RecruitDialogUI {
  npc: NpcData | null = null;
  private container: Phaser.GameObjects.Container | null = null;
  private lines: Line[] = [];
  private recruitBtn?: { bg: Phaser.GameObjects.Rectangle; label: Phaser.GameObjects.Text };

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly world: WorldScene,
    private readonly onClose: () => void,
  ) {}

  get isOpen(): boolean {
    return this.npc !== null;
  }

  open(npc: NpcData): void {
    this.close(false);
    this.npc = npc;
    this.build(npc);
  }

  close(notify = true): void {
    this.container?.destroy();
    this.container = null;
    this.lines = [];
    this.recruitBtn = undefined;
    const wasOpen = this.npc !== null;
    this.npc = null;
    if (notify && wasOpen) this.onClose();
  }

  /** Recruits if allowed; closes the card on success. */
  confirm(): void {
    if (this.npc?.role !== 'wanderer') return;
    if (this.world.recruit(this.npc.id)) this.close();
  }

  update(): void {
    if (!this.npc) return;
    let allMet = true;
    for (const l of this.lines) {
      const { label, met } = l.eval();
      allMet &&= met;
      l.text.setText(`${met ? '✓' : '✗'} ${label}`).setColor(met ? OK : MISSING);
    }
    if (this.recruitBtn) {
      this.recruitBtn.bg.setFillStyle(allMet ? 0x3c6a2c : 0x3a3228, 1);
      this.recruitBtn.label.setColor(allMet ? '#ffffff' : '#8a7e68');
    }
    // A wanderer can leave (or the dialog target can vanish); close if it's gone.
    if (!this.world.population.npcs.includes(this.npc)) this.close();
  }

  layout(width: number, height: number): void {
    if (!this.container) return;
    const h = (this.container.getData('height') as number) ?? 0;
    this.container.setPosition(Math.round((width - W) / 2), Math.round((height - h) / 2));
  }

  private build(npc: NpcData): void {
    const s = this.scene;
    const c = s.add.container(0, 0).setDepth(150);
    const items: Phaser.GameObjects.GameObject[] = [];
    let y = PAD;

    const portrait = s.add.image(PAD + 22, y + 36, `${npcSpriteKey(npc.variant, npc.gender)}_idle`).setScale(4);
    const name = s.add.text(PAD + 64, y, npc.name, { ...TEXT, fontSize: '18px' });
    const sub = s.add.text(PAD + 64, y + 26, `${roleLabel(npc.role, npc.gender)} · ${tierLabel(npc.tier, npc.gender)}`, {
      ...TEXT,
      fontSize: '13px',
      color: TIER_COLOR[npc.tier],
    });
    items.push(portrait, name, sub);
    y += 78;

    items.push(s.add.text(PAD, y, 'Habilidades', { ...TEXT, fontSize: '13px', color: '#cfc3a8' }));
    y += 20;
    SKILLS.forEach((sk, k) => {
      const col = k % 2;
      const r = npc.skills[sk];
      items.push(
        s.add.text(PAD + 8 + col * 205, y, `${SKILL_LABEL[sk]}`, { ...TEXT, fontSize: '12px' }),
        s.add.text(PAD + 8 + col * 205 + 118, y, stars(r), { ...TEXT, fontSize: '12px', color: r >= 4 ? '#ffcf5a' : '#cfc3a8' }),
      );
      if (col === 1) y += 18;
    });
    y += 8;

    items.push(s.add.text(PAD, y, 'Traços', { ...TEXT, fontSize: '13px', color: '#cfc3a8' }));
    y += 20;
    for (const t of npc.traits) {
      const trait = TRAITS[t];
      items.push(
        s.add.text(PAD + 8, y, `${trait.name}`, { ...TEXT, fontSize: '13px', color: trait.positive ? '#f3e9d2' : '#e8a890' }),
        s.add.text(PAD + 8, y + 16, trait.description, { ...TEXT, fontSize: '11px', color: '#a89a80' }),
      );
      y += 36;
    }
    y += 6;

    if (npc.role === 'wanderer') {
      items.push(s.add.text(PAD, y, 'Para morar na vila, pede:', { ...TEXT, fontSize: '13px', color: '#cfc3a8' }));
      y += 20;
      const pop = this.world.population;
      this.addLine(items, y, () => {
        const free = pop.freeBeds;
        return {
          label: free > 0 ? `Uma cama livre (${free} livre${free > 1 ? 's' : ''})` : 'Uma cama livre (construa uma Casa: B)',
          met: free > 0,
        };
      });
      y += 18;
      for (const r of RESOURCES) {
        const need = npc.request[r];
        if (!need) continue;
        this.addLine(items, y, () => {
          const carried = this.world.inventory.count(r);
          const stored = this.world.stockpile.items[r];
          return {
            label: `${need} ${RESOURCE_LABEL[r]} (com você ${carried}, no estoque ${stored})`,
            met: carried + stored >= need,
          };
        });
        y += 18;
      }
      const days = Math.max(0, (npc.leavesAt - this.world.clock.seconds) / DAY_SECONDS);
      const when = days >= 1 ? `${days.toFixed(1).replace('.', ',')} dia(s)` : 'menos de 1 dia';
      items.push(
        s.add.text(PAD, y + 6, `Vai embora em ${when} se não for recrutad${npc.gender === 'f' ? 'a' : 'o'}.`, {
          ...TEXT,
          fontSize: '11px',
          color: '#a89a80',
        }),
      );
      y += 30;
    } else {
      items.push(
        s.add.text(PAD, y, `Trabalho: ${npc.jobId === null ? 'nenhum' : jobTitle(npc, this.world.buildings)}`, {
          ...TEXT,
          fontSize: '13px',
        }),
        s.add.text(
          PAD,
          y + 18,
          npc.jobId === null
            ? 'Designe pelo painel de um prédio de trabalho (E nele).'
            : (this.world.npcStatus(npc.id) ?? 'Trabalhando.'),
          {
            ...TEXT,
            fontSize: '12px',
            color: '#a89a80',
          },
        ),
      );
      y += 44;
    }

    // Buttons.
    const btn = (x: number, label: string, onClick: () => void) => {
      const bg = s.add.rectangle(x, y, 190, 30, 0x3a3228, 1).setOrigin(0).setStrokeStyle(1, 0x5a4630);
      const text = s.add.text(x + 95, y + 15, label, { ...TEXT, fontSize: '13px' }).setOrigin(0.5);
      bg.setInteractive({ useHandCursor: true }).on('pointerdown', onClick);
      items.push(bg, text);
      return { bg, label: text };
    };
    if (npc.role === 'wanderer') this.recruitBtn = btn(PAD, 'Recrutar  [Enter]', () => this.confirm());
    btn(W - PAD - 190, 'Fechar  [Esc]', () => this.close());
    y += 30 + PAD;

    const bg = s.add.rectangle(0, 0, W, y, 0x1a140e, 0.96).setOrigin(0).setStrokeStyle(2, 0x5a4630).setInteractive();
    c.add([bg, ...items]);
    c.setData('height', y);
    this.container = c;
    this.layout(s.scale.width, s.scale.height);
    this.update();
  }

  private addLine(items: Phaser.GameObjects.GameObject[], y: number, evalFn: Line['eval']): void {
    const text = this.scene.add.text(PAD + 8, y, '', { ...TEXT, fontSize: '12px' });
    items.push(text);
    this.lines.push({ text, eval: evalFn });
  }
}
