import type Phaser from 'phaser';
import { ADULT_AGE, COMPANION_MAX, DAY_SECONDS } from '../config';
import { ageOf, fullName, PLAYER_ID } from '../game/families';
import { RESOURCE_LABEL, RESOURCES } from '../game/inventory';
import { ITEM_DEFS } from '../game/items';
import { isStarving } from '../game/needs';
import { jobTitle, type NpcData, roleLabel, SKILL_LABEL, SKILLS, stars, TIER_COLOR, TRAITS, tierLabel } from '../game/npcs';
import { commandLabel, STANCE_HELP, STANCE_LABEL, STANCES, stanceOf } from '../game/orders';
import { ensurePersonTextures } from '../gfx/people';
import type { WorldScene } from '../scenes/WorldScene';

const W = 440;
const PAD = 16;
const TEXT = { fontFamily: '"Alegreya", Georgia, serif', color: '#e8d8b0' } satisfies Phaser.Types.GameObjects.Text.TextStyle;
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
    const c = s.add.container(0, 0).setDepth(280);
    const items: Phaser.GameObjects.GameObject[] = [];
    let y = PAD;

    const portrait = s.add.image(PAD + 22, y + 36, `${ensurePersonTextures(s, npc.look)}_idle`).setScale(4);
    const name = s.add.text(PAD + 64, y, fullName(npc), {
      ...TEXT,
      fontFamily: '"MedievalSharp", "Alegreya", Georgia, serif',
      fontSize: '20px',
      color: '#e0b860',
    });
    const age = ageOf(npc, this.world.clock.seconds);
    const sub = s.add.text(
      PAD + 64,
      y + 26,
      `${roleLabel(npc.role, npc.gender)} · ${tierLabel(npc.tier, npc.gender)} · ${age} anos`,
      {
        ...TEXT,
        fontSize: '13px',
        color: TIER_COLOR[npc.tier],
      },
    );
    items.push(portrait, name, sub);
    y += 78;

    items.push(s.add.text(PAD, y, 'Habilidades', { ...TEXT, fontSize: '13px', color: '#cdb98e' }));
    y += 20;
    SKILLS.forEach((sk, k) => {
      const col = k % 2;
      const r = npc.skills[sk];
      items.push(
        s.add.text(PAD + 8 + col * 205, y, `${SKILL_LABEL[sk]}`, { ...TEXT, fontSize: '12px' }),
        s.add.text(PAD + 8 + col * 205 + 118, y, stars(r), { ...TEXT, fontSize: '12px', color: r >= 4 ? '#ffcf5a' : '#cdb98e' }),
      );
      if (col === 1) y += 18;
    });
    y += (SKILLS.length % 2 === 1 ? 18 : 0) + 8; // an odd last skill still takes its row

    items.push(s.add.text(PAD, y, 'Traços', { ...TEXT, fontSize: '13px', color: '#cdb98e' }));
    y += 20;
    for (const t of npc.traits) {
      const trait = TRAITS[t];
      items.push(
        s.add.text(PAD + 8, y, `${trait.name}`, { ...TEXT, fontSize: '13px', color: trait.positive ? '#e8d8b0' : '#e8a890' }),
        s.add.text(PAD + 8, y + 16, trait.description, { ...TEXT, fontSize: '11px', color: '#a8977a' }),
      );
      y += 36;
    }
    y += 6;

    const settled = this.world.settled;
    if (npc.role === 'wanderer') {
      const ask = settled ? 'Para morar na vila, pede:' : 'Para viajar com você (como companheiro), pede:';
      items.push(s.add.text(PAD, y, ask, { ...TEXT, fontSize: '13px', color: '#cdb98e' }));
      y += 20;
      const pop = this.world.population;
      this.addLine(items, y, () => {
        if (!settled) {
          const n = pop.companions.length;
          return { label: `Lugar no grupo (${n}/${COMPANION_MAX} companheiros)`, met: n < COMPANION_MAX };
        }
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
          color: '#a8977a',
        }),
      );
      y += 30;
    } else if (npc.role === 'companion') {
      const hungry = isStarving(npc);
      items.push(
        s.add.text(PAD, y, 'Viaja com você. Come carne da sua mochila (ou da sua casa).', {
          ...TEXT,
          fontSize: '12px',
          color: '#cdb98e',
        }),
        s.add.text(PAD, y + 18, `Vida ${npc.hp}   Fome ${Math.round(100 - npc.food)}%${hungry ? ' (FAMINTO)' : ''}`, {
          ...TEXT,
          fontSize: '12px',
          color: hungry ? '#ff8a7a' : npc.food < 50 ? '#ffc060' : '#a8e890',
        }),
        s.add.text(PAD, y + 36, 'Clique para dar arma/armadura da sua mochila (a antiga volta para ela):', {
          ...TEXT,
          fontSize: '11px',
          color: '#a8977a',
        }),
      );
      y += 56;
      this.gearButton(items, PAD, y, npc, 'weapon');
      this.gearButton(items, PAD + 205, y, npc, 'armor');
      y += 36;
    } else {
      // Family: spouse, and (for your villagers) affinity with you and a proposal.
      const f = npc.gender === 'f';
      const spouse =
        npc.partnerId === null
          ? f
            ? 'Solteira'
            : 'Solteiro'
          : npc.partnerId === PLAYER_ID
            ? `${f ? 'Casada' : 'Casado'} com você`
            : `${f ? 'Casada' : 'Casado'} com ${this.world.population.person(npc.partnerId)?.name ?? '?'}`;
      const kids = this.world.population.allVillagers.filter((c) => c.parents.includes(npc.id)).length;
      items.push(
        s.add.text(PAD, y, `${spouse}${kids ? ` · ${kids} ${kids > 1 ? 'filhos' : 'filho(a)'}` : ''}`, {
          ...TEXT,
          fontSize: '12px',
          color: '#ffb0d0',
        }),
      );
      if (npc.faction === 0 && npc.partnerId === null && age >= ADULT_AGE) {
        const aff = Math.round(this.world.families.getAffinity(PLAYER_ID, npc.id));
        items.push(s.add.text(PAD + 230, y, `Afinidade com você ${aff}%`, { ...TEXT, fontSize: '12px', color: '#ffb0d0' }));
      }
      y += 20;
      y += 18; // room for the "lives in" line
      items.push(
        s.add.text(PAD + 230, y, `Fome ${Math.round(100 - npc.food)}%${isStarving(npc) ? ' (FAMINTO)' : ''}`, {
          ...TEXT,
          fontSize: '12px',
          color: isStarving(npc) ? '#ff8a7a' : npc.food < 50 ? '#ffc060' : '#a8e890',
        }),
        s.add.text(PAD, y - 18, npc.faction === 0 ? 'Mora na sua vila.' : `Mora em ${this.world.factions[npc.faction].name}.`, {
          ...TEXT,
          fontSize: '12px',
          color: this.world.factions[npc.faction].css,
        }),
        s.add.text(PAD, y, `Trabalho: ${npc.jobId === null ? 'nenhum' : jobTitle(npc, this.world.buildings)}`, {
          ...TEXT,
          fontSize: '13px',
        }),
        s.add.text(
          PAD,
          y + 18,
          npc.faction !== 0
            ? 'Não é da sua vila.'
            : npc.jobId === null
              ? 'Designe pelo painel de um prédio de trabalho (E nele).'
              : (this.world.npcStatus(npc.id) ?? 'Trabalhando.'),
          {
            ...TEXT,
            fontSize: '12px',
            color: '#a8977a',
          },
        ),
      );
      y += 44;
    }

    if (this.world.canCommand(npc)) y = this.orders(items, y, npc);

    // Buttons.
    const btn = (x: number, label: string, onClick: () => void) => {
      const bg = s.add.rectangle(x, y, 190, 30, 0x3a3228, 1).setOrigin(0).setStrokeStyle(1, 0x8a6a3a);
      const text = s.add.text(x + 95, y + 15, label, { ...TEXT, fontSize: '13px' }).setOrigin(0.5);
      bg.setInteractive({ useHandCursor: true }).on('pointerdown', onClick);
      items.push(bg, text);
      return { bg, label: text };
    };
    const foreign = npc.role === 'villager' && !this.world.isMine(npc.faction);
    if (npc.role === 'wanderer')
      this.recruitBtn = btn(PAD, settled ? 'Recrutar  [Enter]' : 'Chamar para o grupo  [Enter]', () => this.confirm());
    else if (foreign) {
      const war = this.world.atWar(0, npc.faction);
      const b = btn(PAD, war ? 'Em guerra: sem comércio' : 'Comerciar', () => {
        if (war) return;
        const f = npc.faction;
        this.close();
        this.world.openPeddle(f);
      });
      if (war) b.label.setColor('#8a7e68');
    } else if (this.world.families.canPropose(npc, this.world.clock.seconds)) {
      btn(PAD, 'Pedir em casamento ♥', () => {
        if (this.world.propose(npc)) this.close();
      });
    }
    btn(W - PAD - 190, 'Fechar  [Esc]', () => this.close());
    y += 30 + PAD;

    const bg = s.add.rectangle(0, 0, W, y, 0x140f0a, 0.96).setOrigin(0).setStrokeStyle(2, 0x8a6a3a).setInteractive();
    c.add([bg, ...items]);
    c.setData('height', y);
    this.container = c;
    this.layout(s.scale.width, s.scale.height);
    this.update();
  }

  /** Orders and stance for your companions and soldiers. Returns the y below them. */
  private orders(items: Phaser.GameObjects.GameObject[], y: number, npc: NpcData): number {
    const s = this.scene;
    const companion = npc.role === 'companion';
    items.push(
      s.add.text(PAD, y, `Ordens · ${commandLabel(npc.command, companion)}`, { ...TEXT, fontSize: '13px', color: '#cdb98e' }),
    );
    y += 22;
    const small = (x: number, w: number, label: string, on: boolean, onClick: () => void) => {
      const bg = s.add
        .rectangle(x, y, w, 26, on ? 0x4a3a1e : 0x2e3a4a, 1)
        .setOrigin(0)
        .setStrokeStyle(1, on ? 0xe0b860 : 0x8a6a3a);
      bg.setInteractive({ useHandCursor: true }).on('pointerdown', onClick);
      items.push(bg, s.add.text(x + w / 2, y + 13, label, { ...TEXT, fontSize: '12px' }).setOrigin(0.5));
    };
    const c = npc.command;
    const w = (W - 2 * PAD - 3 * 6) / 4;
    const p = this.world.player;
    small(PAD, w, 'Siga-me', c?.kind === 'follow', () => {
      this.world.setCommand(npc, { kind: 'follow' });
      this.open(npc);
    });
    small(PAD + (w + 6), w, 'Fique aqui', false, () => {
      const n = this.world.npcList().find((x) => x.data === npc);
      const t = n?.tile ?? p.tile;
      this.world.setCommand(npc, { kind: 'hold', x: t.x, y: t.y });
      this.open(npc);
    });
    small(PAD + 2 * (w + 6), w, 'Vá até…', false, () => {
      this.close();
      this.world.startCommandPick(npc);
    });
    small(PAD + 3 * (w + 6), w, 'Liberar', !c, () => {
      this.world.setCommand(npc, null);
      this.open(npc);
    });
    y += 32;
    const stance = stanceOf(npc);
    const sw = (W - 2 * PAD - 2 * 6) / 3;
    STANCES.forEach((st, k) => {
      small(PAD + k * (sw + 6), sw, STANCE_LABEL[st], st === stance, () => {
        this.world.setStance(npc, st);
        this.open(npc);
      });
    });
    y += 30;
    items.push(s.add.text(PAD, y, STANCE_HELP[stance], { ...TEXT, fontSize: '11px', color: '#a8977a' }));
    return y + 22;
  }

  /** A button showing a companion's weapon or armour; clicking cycles through what you carry. */
  private gearButton(items: Phaser.GameObjects.GameObject[], x: number, y: number, npc: NpcData, slot: 'weapon' | 'armor'): void {
    const s = this.scene;
    const label = () => {
      const item = npc[slot];
      const what = item ? ITEM_DEFS[item].label : slot === 'weapon' ? 'sem arma' : 'sem armadura';
      return `${slot === 'weapon' ? 'Arma' : 'Armadura'}: ${what}`;
    };
    const bg = s.add.rectangle(x, y, 195, 28, 0x2e3a4a, 1).setOrigin(0).setStrokeStyle(1, 0x8a6a3a);
    const text = s.add.text(x + 97, y + 14, label(), { ...TEXT, fontSize: '12px' }).setOrigin(0.5);
    bg.setInteractive({ useHandCursor: true }).on('pointerdown', () => {
      this.world.equipFromBag(npc, slot);
      text.setText(label());
    });
    items.push(bg, text);
  }

  private addLine(items: Phaser.GameObjects.GameObject[], y: number, evalFn: Line['eval']): void {
    const text = this.scene.add.text(PAD + 8, y, '', { ...TEXT, fontSize: '12px' });
    items.push(text);
    this.lines.push({ text, eval: evalFn });
  }
}
