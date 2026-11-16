import type Phaser from 'phaser';
import { type SlotId, slotName } from '../game/save';
import type { WorldScene } from '../scenes/WorldScene';
import { drawSlotList } from './SlotList';

const W = 380;
const PAD = 18;
const TEXT = { fontFamily: '"Alegreya", Georgia, serif', color: '#e8d8b0' } satisfies Phaser.Types.GameObjects.Text.TextStyle;

const CONTROLS = [
  'WASD / setas: andar   Shift: correr',
  'E: coletar, construir, falar, usar',
  'Clique: atacar na direção do mouse (ou Espaço)   F: comer carne',
  '1–9: escolher ferramenta da hotbar',
  'B: construir   C: criar   I/Tab: inventário',
  'V: gestão da vila   M: mapa   N: minimapa',
  'F1: ordens rápidas (F1 de novo: siga-me, F2: fiquem)',
  'G: largar 1 do item selecionado (Shift+G: a pilha)',
  'T (segurar): acelerar tempo',
];

/** Esc menu: pauses the world; continue, save, load the last save, or start a new game. */
export class PauseMenuUI {
  isOpen = false;
  private container: Phaser.GameObjects.Container | null = null;
  private confirmNew = false;
  private confirmTitle = false;
  private mode: 'main' | 'save' | 'load' = 'main';
  private armed: SlotId | null = null;

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
    this.confirmNew = false;
    this.confirmTitle = false;
    this.mode = 'main';
    this.armed = null;
    this.scene.scene.pause('World');
    this.build();
  }

  close(): void {
    this.isOpen = false;
    this.container?.destroy();
    this.container = null;
    this.scene.scene.resume('World');
  }

  layout(width: number, height: number): void {
    if (!this.container) return;
    const h = this.container.getData('height') as number;
    const w = (this.container.getData('width') as number | undefined) ?? W;
    this.container.setPosition(Math.round((width - w) / 2), Math.round((height - h) / 2));
  }

  /** Esc inside a slot list goes back to the main menu; returns false when already there. */
  back(): boolean {
    if (this.mode === 'main') return false;
    this.mode = 'main';
    this.armed = null;
    this.build();
    return true;
  }

  private build(): void {
    if (this.mode !== 'main') {
      this.buildSlots();
      return;
    }
    this.container?.destroy();
    const s = this.scene;
    const items: Phaser.GameObjects.GameObject[] = [];
    let y = PAD;
    items.push(
      s.add
        .text(W / 2, y, 'Pausado', {
          ...TEXT,
          fontFamily: '"MedievalSharp", "Alegreya", Georgia, serif',
          fontSize: '26px',
          color: '#e0b860',
        })
        .setOrigin(0.5, 0),
    );
    y += 34;

    const slot = this.world.currentSlot;
    items.push(
      s.add
        .text(W / 2, y, slot ? `Este jogo: ${slotName(slot)}` : 'Este jogo ainda não foi salvo num espaço próprio', {
          ...TEXT,
          fontSize: '11px',
          color: '#a8977a',
        })
        .setOrigin(0.5, 0),
    );
    y += 24;

    const button = (label: string, onClick: () => void, enabled = true, color = 0x3a3228) => {
      const bg = s.add
        .rectangle(PAD, y, W - PAD * 2, 32, enabled ? color : 0x2a2420, 1)
        .setOrigin(0)
        .setStrokeStyle(1, 0x8a6a3a);
      const text = s.add
        .text(W / 2, y + 16, label, { ...TEXT, fontSize: '13px', color: enabled ? '#e8d8b0' : '#6a604e' })
        .setOrigin(0.5);
      if (enabled) bg.setInteractive({ useHandCursor: true }).on('pointerdown', onClick);
      items.push(bg, text);
      y += 38;
    };

    button('Continuar  [Esc]', () => this.close(), true, 0x3c6a2c);
    button('Salvar jogo…', () => {
      this.mode = 'save';
      this.build();
    });
    button('Carregar jogo…', () => {
      this.mode = 'load';
      this.build();
    });
    button(
      this.confirmNew ? 'Clique de novo: recomeçar do zero (o que não salvou se perde)' : 'Novo jogo',
      () => {
        if (this.confirmNew) this.world.newGame();
        else {
          this.confirmNew = true;
          this.build();
        }
      },
      true,
      this.confirmNew ? 0x6a2a24 : 0x3a3228,
    );
    button(
      this.confirmTitle ? 'Clique de novo: voltar ao menu inicial' : 'Menu inicial',
      () => {
        if (!this.confirmTitle) {
          this.confirmTitle = true;
          this.build();
          return;
        }
        this.isOpen = false;
        this.container?.destroy();
        this.container = null;
        this.scene.scene.resume('World');
        this.world.toTitle();
      },
      true,
      this.confirmTitle ? 0x6a4a24 : 0x3a3228,
    );

    y += 6;
    items.push(s.add.text(PAD, y, 'Controles', { ...TEXT, fontSize: '13px', color: '#cdb98e' }));
    y += 20;
    for (const line of CONTROLS) {
      items.push(s.add.text(PAD, y, line, { ...TEXT, fontSize: '11px', color: '#a8977a' }));
      y += 16;
    }
    y += 8;
    items.push(
      s.add.text(PAD, y, 'O jogo salva sozinho no Autosave a cada 10 minutos e ao fechar (e antes de voltar ao menu inicial).', {
        ...TEXT,
        fontSize: '10px',
        color: '#8a7e68',
        wordWrap: { width: W - PAD * 2 },
      }),
    );
    y += 30;

    const bg = s.add.rectangle(0, 0, W, y, 0x140f0a, 0.97).setOrigin(0).setStrokeStyle(2, 0x8a6a3a).setInteractive();
    const c = s.add.container(0, 0, [bg, ...items]).setDepth(300);
    c.setData('height', y);
    this.container = c;
    this.layout(s.scale.width, s.scale.height);
  }

  /** Choosing a slot to save to (asks before overwriting) or to load. */
  private buildSlots(): void {
    this.container?.destroy();
    const s = this.scene;
    const items: Phaser.GameObjects.GameObject[] = [];
    const w = 560;
    let y = PAD;
    const saving = this.mode === 'save';
    items.push(
      s.add.text(PAD, y, saving ? 'Salvar em…' : 'Carregar…', {
        ...TEXT,
        fontFamily: '"MedievalSharp", "Alegreya", Georgia, serif',
        fontSize: '22px',
        color: '#e0b860',
      }),
    );
    y += 36;
    y = drawSlotList(s, items, PAD, y, w - PAD * 2, {
      mode: saving ? 'save' : 'load',
      current: this.world.currentSlot,
      armed: this.armed,
      onPick: (slot, info) => {
        if (saving) {
          // Overwriting another save asks for a second click (the game's own slot doesn't).
          if (info && slot !== this.world.currentSlot && this.armed !== slot) {
            this.armed = slot;
            this.buildSlots();
            return;
          }
          this.world.saveGame(false, slot);
          this.armed = null;
          this.buildSlots();
        } else this.world.loadGame(slot);
      },
    });
    const back = s.add
      .rectangle(PAD, y + 8, 160, 30, 0x3a3228, 1)
      .setOrigin(0)
      .setStrokeStyle(1, 0x8a6a3a);
    back.setInteractive({ useHandCursor: true }).on('pointerdown', () => this.back());
    items.push(back, s.add.text(PAD + 80, y + 23, 'Voltar  [Esc]', { ...TEXT, fontSize: '13px' }).setOrigin(0.5));
    y += 48 + PAD;
    const bg = s.add.rectangle(0, 0, w, y, 0x140f0a, 0.97).setOrigin(0).setStrokeStyle(2, 0x8a6a3a).setInteractive();
    const c = s.add.container(0, 0, [bg, ...items]).setDepth(300);
    c.setData('height', y);
    c.setData('width', w);
    this.container = c;
    this.layout(s.scale.width, s.scale.height);
  }
}
