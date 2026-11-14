import type Phaser from 'phaser';
import { readSave } from '../game/save';
import type { WorldScene } from '../scenes/WorldScene';

const W = 380;
const PAD = 18;
const TEXT = { fontFamily: 'monospace', color: '#f3e9d2' } satisfies Phaser.Types.GameObjects.Text.TextStyle;

const CONTROLS = [
  'WASD / setas: andar   Shift: correr',
  'E: coletar, construir, falar, usar',
  'Espaço: atacar   F: comer carne',
  '1–9: escolher ferramenta da hotbar',
  'B: construir   C: criar   I/Tab: inventário',
  'M: minimapa   T (segurar): acelerar tempo',
];

/** Esc menu: pauses the world; continue, save, load the last save, or start a new game. */
export class PauseMenuUI {
  isOpen = false;
  private container: Phaser.GameObjects.Container | null = null;
  private confirmNew = false;

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
    this.container.setPosition(Math.round((width - W) / 2), Math.round((height - h) / 2));
  }

  private build(): void {
    this.container?.destroy();
    const s = this.scene;
    const items: Phaser.GameObjects.GameObject[] = [];
    let y = PAD;
    items.push(s.add.text(W / 2, y, 'Pausado', { ...TEXT, fontSize: '20px' }).setOrigin(0.5, 0));
    y += 34;

    const save = readSave();
    const when = save ? new Date(save.savedAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : null;
    items.push(
      s.add
        .text(W / 2, y, when ? `Último salvamento: ${when}` : 'Nenhum jogo salvo ainda', {
          ...TEXT,
          fontSize: '11px',
          color: '#a89a80',
        })
        .setOrigin(0.5, 0),
    );
    y += 24;

    const button = (label: string, onClick: () => void, enabled = true, color = 0x3a3228) => {
      const bg = s.add
        .rectangle(PAD, y, W - PAD * 2, 32, enabled ? color : 0x2a2420, 1)
        .setOrigin(0)
        .setStrokeStyle(1, 0x5a4630);
      const text = s.add
        .text(W / 2, y + 16, label, { ...TEXT, fontSize: '13px', color: enabled ? '#f3e9d2' : '#6a604e' })
        .setOrigin(0.5);
      if (enabled) bg.setInteractive({ useHandCursor: true }).on('pointerdown', onClick);
      items.push(bg, text);
      y += 38;
    };

    button('Continuar  [Esc]', () => this.close(), true, 0x3c6a2c);
    button('Salvar jogo', () => {
      this.world.saveGame();
      this.build();
    });
    button('Carregar último salvamento', () => this.world.loadGame(), save !== null);
    button(
      this.confirmNew ? 'Clique de novo: apagar o salvamento e recomeçar' : 'Novo jogo',
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

    y += 6;
    items.push(s.add.text(PAD, y, 'Controles', { ...TEXT, fontSize: '13px', color: '#cfc3a8' }));
    y += 20;
    for (const line of CONTROLS) {
      items.push(s.add.text(PAD, y, line, { ...TEXT, fontSize: '11px', color: '#a89a80' }));
      y += 16;
    }
    y += 8;
    items.push(
      s.add.text(PAD, y, 'O jogo salva sozinho a cada 2 minutos, a cada novo dia e ao fechar.', {
        ...TEXT,
        fontSize: '10px',
        color: '#8a7e68',
        wordWrap: { width: W - PAD * 2 },
      }),
    );
    y += 30;

    const bg = s.add.rectangle(0, 0, W, y, 0x1a140e, 0.97).setOrigin(0).setStrokeStyle(2, 0x5a4630).setInteractive();
    const c = s.add.container(0, 0, [bg, ...items]).setDepth(300);
    c.setData('height', y);
    this.container = c;
    this.layout(s.scale.width, s.scale.height);
  }
}
