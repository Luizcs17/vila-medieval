import type Phaser from 'phaser';
import { BEDS_PER_HOUSE } from '../config';
import { BUILDING_DEFS, type Building } from '../game/buildings';
import { isAdult } from '../game/families';
import { ARMORS, RECURRING_DEFAULT, recipeOf, setRecurring, WEAPONS, workplaceTools } from '../game/gear';
import { ALL_ITEMS, ITEM_DEFS, RECIPES, type ToolId } from '../game/items';
import { jobTitle, type NpcData, productivity, SKILL_LABEL, stars } from '../game/npcs';
import { buildingStorage, type Storage, villageStorage } from '../game/storage';
import { ensurePersonTextures } from '../gfx/people';
import type { WorldScene } from '../scenes/WorldScene';
import { Obj } from '../world/map';

const W = 460;
const PAD = 16;
const ROW = 34;
const TEXT = { fontFamily: '"Alegreya", Georgia, serif', color: '#e8d8b0' } satisfies Phaser.Types.GameObjects.Text.TextStyle;

/**
 * Panel for a finished workplace (assign/remove workers, ranked by their rating for the job's skill)
 * or a house (list of residents). Rebuilt whenever something changes; modal while open.
 */
export class BuildingPanelUI {
  building: Building | null = null;
  private container: Phaser.GameObjects.Container | null = null;
  private signature = '';
  private progress: Phaser.GameObjects.Rectangle | null = null;

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
    this.editing = null;
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
    if (this.sig() !== this.signature) this.rebuild();
    const b = this.building;
    if (this.progress && b.queue?.[0]) {
      const r = recipeOf(b.queue[0]);
      this.progress.width = Math.max(1, (W - 2 * PAD) * Math.min(1, (b.craft ?? 0) / r.seconds));
    }
  }

  layout(width: number, height: number): void {
    if (!this.container) return;
    const h = this.container.getData('height') as number;
    this.container.setPosition(Math.round((width - W) / 2), Math.round((height - h) / 2));
  }

  /** What the panel shows: people, gear and inventories. */
  private sig(): string {
    const b = this.building!;
    const f = this.world.factions[b.faction];
    return [
      this.world.population.allVillagers
        .map((n) => `${n.id}:${n.faction}:${n.homeId}:${n.jobId}:${n.weapon}:${n.armor}`)
        .join(','),
      JSON.stringify(b.storage),
      (b.queue ?? []).join(','),
      JSON.stringify(b.recurring ?? {}),
      b.paid,
      JSON.stringify(f.tools),
      JSON.stringify(f.stock.items),
    ].join('|');
  }

  private button(
    items: Phaser.GameObjects.GameObject[],
    x: number,
    y: number,
    w: number,
    text: string,
    color: number,
    onClick: () => void,
  ) {
    const s = this.scene;
    const bg = s.add.rectangle(x, y, w, 24, color, 1).setOrigin(0).setStrokeStyle(1, 0x8a6a3a);
    bg.setInteractive({ useHandCursor: true }).on('pointerdown', onClick);
    items.push(bg, s.add.text(x + w / 2, y + 12, text, { ...TEXT, fontSize: '11px' }).setOrigin(0.5));
  }

  /** Smithy: recipes to queue, the queue and progress. Returns the new y. */
  private smithy(items: Phaser.GameObjects.GameObject[], b: Building, y: number, village: Storage): number {
    const s = this.scene;
    items.push(s.add.text(PAD, y, 'Produção (custo sai do estoque da vila)', { ...TEXT, fontSize: '13px', color: '#cdb98e' }));
    items.push(
      s.add.text(PAD, y + 16, 'Clique: produzir sempre até o máximo no estoque · Shift+clique: só 1 na fila', {
        ...TEXT,
        fontSize: '10px',
        color: '#a8977a',
      }),
    );
    y += 34;
    const colW = (W - 2 * PAD - 8) / 2;
    const rec = b.recurring ?? {};
    RECIPES.forEach((r, i) => {
      const x = PAD + (i % 2) * (colW + 8);
      const ry = y + Math.floor(i / 2) * 28;
      const max = rec[r.item];
      const on = max !== undefined;
      const cost = Object.entries(r.cost)
        .map(([k, n]) => `${n} ${ITEM_DEFS[k as ToolId].label.toLowerCase()}`)
        .join(', ');
      const ok = Object.entries(r.cost).every(([k, n]) => village.have(k as ToolId) >= (n ?? 0));
      const bg = s.add
        .rectangle(x, ry, colW, 26, on ? 0x4a3a1e : ok ? 0x2e3a24 : 0x2a2420, 1)
        .setOrigin(0)
        .setStrokeStyle(on ? 2 : 1, on ? 0xe0b860 : 0x6a5232);
      bg.setInteractive({ useHandCursor: true }).on('pointerdown', (p: Phaser.Input.Pointer) => {
        if ((p.event as MouseEvent).shiftKey) this.world.queueCraft(b, r.item);
        else if (!on) setRecurring(b, r.item, RECURRING_DEFAULT);
        this.editing = on ? this.editing : null;
        this.rebuild();
      });
      items.push(
        bg,
        s.add.image(x + 12, ry + 13, `icon_${r.item}`).setScale(2),
        s.add.text(x + 24, ry + 1, ITEM_DEFS[r.item].label, { ...TEXT, fontSize: '11px' }),
        s.add.text(x + 24, ry + 13, `${cost} · ${r.seconds}s`, { ...TEXT, fontSize: '10px', color: ok ? '#a8c890' : '#a8977a' }),
      );
      if (on) this.recurringControls(items, b, r.item, x + colW, ry, max, village.have(r.item));
    });
    y += Math.ceil(RECIPES.length / 2) * 28 + 6;
    const queue = b.queue ?? [];
    items.push(
      s.add.text(PAD, y, queue.length ? `Fila (${queue.length}/8) · clique para cancelar` : 'Fila vazia', {
        ...TEXT,
        fontSize: '12px',
        color: '#cdb98e',
      }),
    );
    y += 18;
    queue.forEach((t, i) => {
      const x = PAD + i * 32;
      const slot = s.add
        .rectangle(x, y, 28, 28, i === 0 ? 0x4a3a1e : 0x2a2420, 1)
        .setOrigin(0)
        .setStrokeStyle(1, 0x8a6a3a);
      slot.setInteractive({ useHandCursor: true }).on('pointerdown', () => {
        this.world.cancelCraft(b, i);
        this.rebuild();
      });
      items.push(slot, s.add.image(x + 14, y + 14, `icon_${t}`).setScale(2));
    });
    if (queue.length) {
      y += 32;
      items.push(s.add.rectangle(PAD, y, W - 2 * PAD, 5, 0x2a2420).setOrigin(0));
      this.progress = s.add.rectangle(PAD, y, 1, 5, 0xe0b860).setOrigin(0);
      items.push(this.progress);
      y += 8;
    } else y += 6;
    return y + 6;
  }

  /** Recurring item being typed into (its maximum box has the keyboard). */
  private editing: { item: ToolId; text: string } | null = null;

  /**
   * On a recurring recipe, at its right edge: the maximum box (click it and type a number; Enter
   * or a click elsewhere confirms) and an "x" that turns recurring production off. Covers the cost text.
   */
  private recurringControls(
    items: Phaser.GameObjects.GameObject[],
    b: Building,
    item: ToolId,
    right: number,
    y: number,
    max: number,
    have: number,
  ): void {
    const s = this.scene;
    const x0 = right - 92;
    items.push(s.add.rectangle(x0 - 2, y + 1, 94, 24, 0x4a3a1e, 1).setOrigin(0));
    items.push(s.add.text(x0, y + 7, `${have}/`, { ...TEXT, fontSize: '11px', color: have >= max ? '#a8e890' : '#ffc060' }));
    const editing = this.editing?.item === item;
    const box = s.add
      .rectangle(x0 + 26, y + 3, 34, 20, editing ? 0x140f0a : 0x2a2420, 1)
      .setOrigin(0)
      .setStrokeStyle(1, editing ? 0xffe08a : 0x8a6a3a);
    box.setInteractive({ useHandCursor: true }).on('pointerdown', () => {
      this.editing = { item, text: '' };
      this.rebuild();
    });
    const shown = editing ? `${this.editing!.text}|` : String(max);
    items.push(box, s.add.text(x0 + 43, y + 13, shown, { ...TEXT, fontSize: '12px' }).setOrigin(0.5));
    const x = s.add
      .rectangle(x0 + 66, y + 3, 20, 20, 0x6a2a24, 1)
      .setOrigin(0)
      .setStrokeStyle(1, 0x8a6a3a);
    x.setInteractive({ useHandCursor: true }).on('pointerdown', () => {
      setRecurring(b, item, null);
      if (this.editing?.item === item) this.editing = null;
      this.rebuild();
    });
    items.push(x, s.add.text(x0 + 76, y + 13, '✕', { ...TEXT, fontSize: '12px' }).setOrigin(0.5));
  }

  /** Keys typed into a maximum box. Returns true when the panel used the key. */
  typeKey(key: string): boolean {
    const e = this.editing;
    const b = this.building;
    if (!e || !b) return false;
    if (/^[0-9]$/.test(key) && e.text.length < 2) e.text += key;
    else if (key === 'backspace') e.text = e.text.slice(0, -1);
    else if (key === 'enter' || key === 'escape' || key === 'e') {
      if (key !== 'escape' && e.text !== '') setRecurring(b, e.item, Number(e.text));
      this.editing = null;
    } else return true; // other keys are ignored while typing
    this.rebuild();
    return true;
  }

  private rebuild(): void {
    const b = this.building!;
    const def = BUILDING_DEFS[b.type];
    const pop = this.world.population;
    this.signature = this.sig();
    this.container?.destroy();
    this.progress = null;
    const village = villageStorage(this.world.factions[b.faction]);
    const s = this.scene;
    const items: Phaser.GameObjects.GameObject[] = [];
    let y = PAD;

    items.push(
      s.add.text(PAD, y, def.name, {
        ...TEXT,
        fontFamily: '"MedievalSharp", "Alegreya", Georgia, serif',
        fontSize: '19px',
        color: '#e0b860',
      }),
    );
    y += 28;

    const row = (npc: NpcData, label: string, sub: string, action?: { text: string; color: number; onClick: () => void }) => {
      items.push(
        s.add.image(PAD + 10, y + ROW / 2 + 6, `${ensurePersonTextures(s, npc.look)}_idle`).setScale(1.5),
        s.add.text(PAD + 26, y + 2, label, { ...TEXT, fontSize: '13px' }),
        s.add.text(PAD + 26, y + 18, sub, { ...TEXT, fontSize: '11px', color: '#a8977a' }),
      );
      if (action) {
        const bg = s.add
          .rectangle(W - PAD - 92, y + 3, 92, 26, action.color, 1)
          .setOrigin(0)
          .setStrokeStyle(1, 0x8a6a3a);
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
        s.add.text(PAD, y, `Trabalhadores ${workers.length}/${job.slots}`, { ...TEXT, fontSize: '13px', color: '#cdb98e' }),
      );
      y += 22;
      if (workers.length === 0) {
        items.push(s.add.text(PAD + 8, y, 'Ninguém trabalhando aqui.', { ...TEXT, fontSize: '12px', color: '#a8977a' }));
        y += 22;
      }
      // Tools: one per worker, kept in the building's inventory.
      if (job.tools?.length) {
        const have = workplaceTools(b).length;
        items.push(
          s.add.text(PAD, y + 4, `Ferramentas ${have}/${job.slots}: ${job.tools.map((t) => ITEM_DEFS[t].label).join(' ou ')}`, {
            ...TEXT,
            fontSize: '12px',
            color: have < workers.length ? '#ff9a7a' : '#a8c890',
            wordWrap: { width: W - 2 * PAD - 140 },
          }),
        );
        this.button(items, W - PAD - 130, y, 130, 'Trazer do estoque', 0x3a3228, () => {
          if (this.world.stockWorkplace(b) === 0)
            this.world.toast('Não há essas ferramentas no estoque. Faça no Ferreiro (ou com C).', '#ffb070');
          this.rebuild();
        });
        y += 34;
      }
      if (b.type === 'smithy') y = this.smithy(items, b, y, village);
      const soldier = b.type === 'barracks';
      for (const w of workers) {
        const status = this.world.npcStatus(w.id);
        if (soldier) {
          const cycle = (slot: 'weapon' | 'armor', list: ToolId[]) => {
            const options: (ToolId | null)[] = [
              null,
              ...list.filter((t) => t === w[slot] || buildingStorage(b).have(t) + village.have(t) > 0),
            ];
            const next = options[(options.indexOf(w[slot] ?? null) + 1) % options.length];
            if (!this.world.equip(w, slot, next)) this.world.toast('Sem esse equipamento no quartel ou no estoque.', '#ffb070');
            this.rebuild();
          };
          const short = (t: ToolId | null | undefined, none: string) => (t ? ITEM_DEFS[t].label.split(' ')[0] : none);
          this.button(items, W - PAD - 92 - 136, y + 4, 64, short(w.weapon, 'Sem arma'), 0x2e3a4a, () =>
            cycle('weapon', WEAPONS),
          );
          this.button(items, W - PAD - 92 - 68, y + 4, 64, short(w.armor, 'Sem arm.'), 0x2e3a4a, () => cycle('armor', ARMORS));
        }
        const sub = soldier
          ? `${stars(w.skills.combat)} · ${w.armor ? ITEM_DEFS[w.armor].label : 'sem armadura'}`
          : (status ?? rate(w));
        row(w, `${w.name} · ${job.title[w.gender]}`, sub, {
          text: 'Dispensar',
          color: 0x5a2a24,
          onClick: () => {
            pop.unassign(w);
            this.rebuild();
          },
        });
      }
      y += 6;
      items.push(s.add.text(PAD, y, 'Aldeões sem trabalho (melhores primeiro)', { ...TEXT, fontSize: '13px', color: '#cdb98e' }));
      y += 22;
      const free = pop.unemployed(skill, b.faction);
      if (free.length === 0) {
        items.push(
          s.add.text(PAD + 8, y, 'Nenhum. Recrute andarilhos para ter mais gente.', {
            ...TEXT,
            fontSize: '12px',
            color: '#a8977a',
          }),
        );
        y += 22;
      }
      const full = workers.length >= job.slots;
      for (const n of free.slice(0, b.type === 'smithy' || soldier ? 3 : 6)) {
        row(n, `${n.name}`, rate(n), {
          text: full ? 'Lotado' : 'Contratar',
          color: full ? 0x3a3228 : 0x3c6a2c,
          onClick: () => {
            if (pop.assign(n, b)) this.rebuild();
          },
        });
      }
    } else if (b.type === 'home') {
      items.push(
        s.add.text(
          PAD,
          y,
          this.world.settled
            ? 'Sua casa. Guarde itens no inventário; ao ser derrubado, você acorda aqui.'
            : 'Sua casa: guarde aqui o que juntar (inventário). Reivindicar terras paga com isso + a mochila.',
          {
            ...TEXT,
            fontSize: '12px',
            color: '#cdb98e',
            wordWrap: { width: W - 2 * PAD },
          },
        ),
      );
      y += 36;
      if (b.built) {
        const night = this.world.clock.isNight;
        const sleep = s.add
          .rectangle(PAD, y, 220, 28, night ? 0x2e3a4a : 0x2a2420, 1)
          .setOrigin(0)
          .setStrokeStyle(1, 0x8a6a3a);
        sleep.setInteractive({ useHandCursor: night }).on('pointerdown', () => {
          if (this.world.sleep()) this.close();
        });
        items.push(
          sleep,
          s.add
            .text(PAD + 110, y + 14, night ? 'Dormir até o amanhecer' : 'Só dá para dormir à noite', {
              ...TEXT,
              fontSize: '12px',
              color: night ? '#e8d8b0' : '#8a7e68',
            })
            .setOrigin(0.5),
        );
        y += 40;
      }
    } else {
      const residents = pop.residents(b.id);
      items.push(
        s.add.text(PAD, y, `Moradores ${residents.length}/${BEDS_PER_HOUSE}`, { ...TEXT, fontSize: '13px', color: '#cdb98e' }),
      );
      y += 22;
      if (residents.length === 0) {
        items.push(s.add.text(PAD + 8, y, 'Camas livres: recrute andarilhos.', { ...TEXT, fontSize: '12px', color: '#a8977a' }));
        y += 22;
      }
      for (const n of residents) row(n, `${n.name} · ${jobTitle(n, this.world.buildings)}`, '');
      // Settling other villages of yours: move people here from your other villages.
      const others = this.world.myVillages().filter((f) => f.id !== b.faction);
      if (b.type === 'house' && b.built && others.length > 0 && residents.length < BEDS_PER_HOUSE) {
        y += 4;
        items.push(
          s.add.text(PAD, y, `Mudar para cá (de ${others.map((f) => f.name).join(', ')})`, {
            ...TEXT,
            fontSize: '13px',
            color: '#cdb98e',
          }),
        );
        y += 22;
        const movers = others
          .flatMap((f) => pop.villagersOf(f.id))
          .filter((n) => isAdult(n, this.world.clock.seconds) && this.world.factions[n.faction].rulerId !== n.id)
          .sort((a, c) => Number(a.jobId !== null) - Number(c.jobId !== null))
          .slice(0, 4);
        if (movers.length === 0) {
          items.push(s.add.text(PAD + 8, y, 'Ninguém disponível.', { ...TEXT, fontSize: '12px', color: '#a8977a' }));
          y += 22;
        }
        for (const n of movers)
          row(n, n.name, `${this.world.factions[n.faction].name} · ${jobTitle(n, this.world.buildings)}`, {
            text: 'Mudar',
            color: 0x2e3a4a,
            onClick: () => {
              this.world.moveVillager(n, b);
              this.rebuild();
            },
          });
      }
    }

    y += 8;
    if (b.type === 'barracks') {
      items.push(
        s.add.text(PAD, y, 'Clique na arma/armadura de um soldado para trocar (vem do quartel ou do estoque).', {
          ...TEXT,
          fontSize: '11px',
          color: '#a8977a',
          wordWrap: { width: W - 2 * PAD },
        }),
      );
      y += 30;
    }
    if (b.type === 'farm' && b.built) {
      const plot = b.plot;
      const objs = this.world.map.objects;
      const n = plot?.tiles.length ?? 0;
      const growing = plot?.tiles.filter((i) => objs[i] === Obj.Crop).length ?? 0;
      const ripe = plot?.tiles.filter((i) => objs[i] === Obj.CropRipe).length ?? 0;
      items.push(
        s.add.text(
          PAD,
          y,
          n === 0
            ? 'Sem área de plantio.'
            : `Plantação ${n} quadrados · ${growing} crescendo · ${ripe} prontos · ${n - growing - ripe} vazios`,
          { ...TEXT, fontSize: '12px', color: '#cdb98e' },
        ),
        s.add.text(PAD, y + 18, `Sementes: ${this.world.farmSeeds(b)} (fazenda + estoque). Colhe em 3 dias.`, {
          ...TEXT,
          fontSize: '11px',
          color: '#a8977a',
        }),
      );
      y += 40;
      const plotBtn = s.add.rectangle(PAD, y, 220, 28, 0x2c4a2a, 1).setOrigin(0).setStrokeStyle(1, 0x8a6a3a);
      plotBtn.setInteractive({ useHandCursor: true }).on('pointerdown', () => {
        const farm = b;
        this.close();
        this.world.startPlot(farm);
      });
      items.push(
        plotBtn,
        s.add
          .text(PAD + 110, y + 14, n === 0 ? 'Definir área de plantio' : 'Redefinir área de plantio', {
            ...TEXT,
            fontSize: '12px',
          })
          .setOrigin(0.5),
      );
      y += 38;
    }
    // Every building has its own inventory.
    const inv = s.add.rectangle(PAD, y, 170, 28, 0x3a3228, 1).setOrigin(0).setStrokeStyle(1, 0x8a6a3a);
    inv.setInteractive({ useHandCursor: true }).on('pointerdown', () => {
      const target = b;
      this.close();
      this.world.openStorage(`${def.name} · inventário`, this.world.storageOf(target));
    });
    const store = this.world.storageOf(b);
    const stored = ALL_ITEMS.reduce((a, i) => a + store.have(i), 0);
    items.push(inv, s.add.text(PAD + 85, y + 14, `Inventário (${stored})`, { ...TEXT, fontSize: '12px' }).setOrigin(0.5));
    const close = s.add
      .rectangle(W - PAD - 150, y, 150, 28, 0x3a3228, 1)
      .setOrigin(0)
      .setStrokeStyle(1, 0x8a6a3a);
    close.setInteractive({ useHandCursor: true }).on('pointerdown', () => this.close());
    items.push(close, s.add.text(W - PAD - 75, y + 14, 'Fechar  [Esc]', { ...TEXT, fontSize: '12px' }).setOrigin(0.5));
    y += 28 + PAD;

    const bg = s.add.rectangle(0, 0, W, y, 0x140f0a, 0.96).setOrigin(0).setStrokeStyle(2, 0x8a6a3a).setInteractive();
    const c = s.add.container(0, 0, [bg, ...items]).setDepth(280);
    c.setData('height', y);
    this.container = c;
    this.layout(s.scale.width, s.scale.height);
  }
}
