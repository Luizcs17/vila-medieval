import Phaser from 'phaser';
import { sound } from '../audio/sound';
import { DAY_SECONDS } from '../config';
import { deleteSave, latestSlot, migrateLegacySave, readSave, type SlotId } from '../game/save';
import { createPlaceholderTextures } from '../gfx/textures';
import { drawSlotList } from '../ui/SlotList';
import type { WorldInit } from './WorldScene';

const TEXT = { fontFamily: '"Alegreya", Georgia, serif', color: '#e8d8b0' } satisfies Phaser.Types.GameObjects.Text.TextStyle;
const TITLE_FONT = '"MedievalSharp", "Alegreya", Georgia, serif';

/**
 * The first screen: continue the latest save, start a new game, or pick one of the save slots
 * (Autosave + 10). Drawn over a dark forest silhouette at dusk.
 */
export class TitleScene extends Phaser.Scene {
  private items: Phaser.GameObjects.GameObject[] = [];
  private backdrop: Phaser.GameObjects.GameObject[] = [];
  private mode: 'main' | 'load' | 'credits' = 'main';
  private armed: SlotId | null = null;

  constructor() {
    super('Title');
  }

  create(): void {
    createPlaceholderTextures(this);
    migrateLegacySave();
    sound.setMood('title');
    this.mode = 'main';
    this.armed = null;
    this.choosingSex = false;
    this.drawBackdrop();
    this.build();
    const onResize = () => {
      this.drawBackdrop();
      this.build();
    };
    this.scale.on('resize', onResize);
    this.events.once('shutdown', () => this.scale.off('resize', onResize));
    this.input.keyboard?.on('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Escape' && this.mode !== 'main') {
        this.mode = 'main';
        this.build();
      } else if (e.key === 'Enter' && this.mode === 'main') {
        const slot = latestSlot(DAY_SECONDS);
        if (slot !== null) this.play(slot);
      }
    });
  }

  update(_t: number, deltaMs: number): void {
    sound.update(Math.min(deltaMs, 100) / 1000);
  }

  /** "Novo jogo" was clicked: the button turns into the choice of sex. */
  private choosingSex = false;

  /** Starts the world from a slot (or fresh, as a man or a woman). */
  play(slot: SlotId | null, gender: 'f' | 'm' = 'm'): void {
    const data: WorldInit = slot === null ? { fresh: true, gender } : { save: readSave(slot), slot };
    if (slot !== null && !data.save) return;
    this.scene.start('World', data);
  }

  /** Night sky, a row of dark trees and a lit house on the horizon. */
  private drawBackdrop(): void {
    for (const o of this.backdrop) o.destroy();
    this.backdrop = [];
    const { width, height } = this.scale;
    const g = this.add.graphics();
    const bands = 24;
    for (let k = 0; k < bands; k++) {
      const t = k / (bands - 1);
      const c = Phaser.Display.Color.Interpolate.ColorWithColor(
        Phaser.Display.Color.ValueToColor(0x0b0d16),
        Phaser.Display.Color.ValueToColor(0x3a2418),
        100,
        Math.round(t * 100),
      );
      g.fillStyle(Phaser.Display.Color.GetColor(c.r, c.g, c.b), 1);
      g.fillRect(0, (height * k) / bands, width, height / bands + 1);
    }
    // A few stars.
    let seed = 7;
    const rnd = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    for (let k = 0; k < 70; k++) g.fillStyle(0xe8d8b0, 0.2 + rnd() * 0.5).fillRect(rnd() * width, rnd() * height * 0.45, 1, 1);
    this.backdrop.push(g);
    // The forest line.
    const y0 = height * 0.82;
    for (let x = -20; x < width + 40; x += 22 + rnd() * 18) {
      const key = rnd() < 0.6 ? 'pine' : 'tree';
      const img = this.add
        .image(x, y0 + rnd() * 40, key)
        .setOrigin(0.5, 1)
        .setScale(3 + rnd() * 1.5)
        .setTint(0x10140f);
      this.backdrop.push(img);
    }
    const house = this.add
      .image(width * 0.78, y0 + 30, 'bld_home')
      .setOrigin(0.5, 1)
      .setScale(3)
      .setTint(0x16110c);
    // One warm window in the dark.
    const glow = this.add.circle(width * 0.78 + 8, y0 - 2, 16, 0xd8a548, 0.12);
    const window = this.add.rectangle(width * 0.78 + 8, y0 - 2, 5, 6, 0xd8a548, 0.9);
    this.backdrop.push(house, glow, window);
    this.backdrop.push(this.add.rectangle(0, y0 + 20, width, height, 0x07080a, 1).setOrigin(0));
  }

  private button(x: number, y: number, w: number, label: string, onClick: () => void, color = 0x3a3228, enabled = true): void {
    const bg = this.add
      .rectangle(x, y, w, 38, enabled ? color : 0x201a14, 0.95)
      .setOrigin(0)
      .setStrokeStyle(1, 0x8a6a3a);
    if (enabled)
      bg.setInteractive({ useHandCursor: true })
        .on('pointerover', () => bg.setStrokeStyle(2, 0xe0b860))
        .on('pointerout', () => bg.setStrokeStyle(1, 0x8a6a3a))
        .on('pointerdown', () => {
          sound.play('click');
          onClick();
        });
    const text = this.add
      .text(x + w / 2, y + 19, label, { ...TEXT, fontSize: '16px', color: enabled ? '#e8d8b0' : '#6a604e' })
      .setOrigin(0.5);
    this.items.push(bg, text);
  }

  private build(): void {
    for (const o of this.items) o.destroy();
    this.items = [];
    const { width, height } = this.scale;
    const cx = width / 2;
    const title = this.add
      .text(cx, height * 0.14, 'Vila Medieval', {
        fontFamily: TITLE_FONT,
        fontSize: '64px',
        color: '#e0b860',
        stroke: '#1a1008',
        strokeThickness: 8,
      })
      .setOrigin(0.5);
    const sub = this.add
      .text(cx, height * 0.14 + 52, 'Do nada, um reino', { ...TEXT, fontSize: '18px', color: '#cdb98e' })
      .setOrigin(0.5);
    this.items.push(title, sub);

    if (this.mode === 'main') {
      const w = 300;
      let y = height * 0.38;
      const latest = latestSlot(DAY_SECONDS);
      const info = latest !== null ? readSave(latest) : null;
      this.button(cx - w / 2, y, w, 'Continuar  [Enter]', () => this.play(latest), 0x3c6a2c, latest !== null);
      if (info && latest !== null) {
        const day = Math.floor(info.clock / DAY_SECONDS) + 1;
        const when = new Date(info.savedAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
        this.items.push(
          this.add
            .text(cx, y + 46, `${latest === 'auto' ? 'Autosave' : `Espaço ${latest}`} · dia ${day} · ${when}`, {
              ...TEXT,
              fontSize: '12px',
              color: '#a8977a',
            })
            .setOrigin(0.5, 0),
        );
      }
      y += 74;
      // A new game asks who you are: man or woman (marriages are between a man and a woman).
      if (this.choosingSex) {
        const half = (w - 8) / 2;
        this.button(cx - w / 2, y, half, 'Homem', () => this.play(null, 'm'));
        this.button(cx - w / 2 + half + 8, y, half, 'Mulher', () => this.play(null, 'f'));
      } else
        this.button(cx - w / 2, y, w, 'Novo jogo', () => {
          this.choosingSex = true;
          this.build();
        });
      y += 48;
      this.button(cx - w / 2, y, w, 'Carregar jogo', () => {
        this.mode = 'load';
        this.armed = null;
        this.build();
      });
      y += 48;
      this.button(cx - w / 2, y, w, 'Créditos', () => {
        this.mode = 'credits';
        this.build();
      });
      y += 60;
      this.items.push(
        this.add
          .text(cx, y, 'O jogo salva sozinho no Autosave a cada 10 minutos e ao fechar. Salve em espaços próprios pelo Esc.', {
            ...TEXT,
            fontSize: '12px',
            color: '#8a7e68',
            align: 'center',
            wordWrap: { width: 420 },
          })
          .setOrigin(0.5, 0),
      );
      return;
    }

    if (this.mode === 'credits') {
      const w = Math.min(620, width - 40);
      const x = cx - w / 2;
      const y0 = height * 0.3;
      const lines = [
        'Música',
        '"Fantasy Orchestral Theme" — Joth (CC0)',
        '"Majesty" — Kistol (CC0)',
        '"Тема королевства", "Легенда 1", "СДП (средневековая тема 1)" — Alexandr Zhelanov',
        '    soundcloud.com/alexandr-zhelanov · licença CC-BY 3.0 (creativecommons.org/licenses/by/3.0)',
        '"Medieval: Battle" — RandomMind (CC0)',
        'Todas via OpenGameArt.org',
        '',
        'Fontes: MedievalSharp e Alegreya (SIL Open Font License)',
        'Feito com Phaser',
      ];
      this.items.push(
        this.add
          .rectangle(x - 16, y0 - 16, w + 32, lines.length * 22 + 110, 0x140f0a, 0.92)
          .setOrigin(0)
          .setStrokeStyle(2, 0x8a6a3a),
        this.add.text(x, y0 - 6, 'Créditos', { fontFamily: TITLE_FONT, fontSize: '20px', color: '#e0b860' }),
      );
      lines.forEach((l, k) => {
        this.items.push(
          this.add.text(x, y0 + 30 + k * 22, l, {
            ...TEXT,
            fontSize: k === 0 ? '14px' : '12px',
            color: k === 0 ? '#cdb98e' : '#e8d8b0',
          }),
        );
      });
      this.button(x, y0 + 40 + lines.length * 22, 140, 'Voltar  [Esc]', () => {
        this.mode = 'main';
        this.build();
      });
      return;
    }

    // Load screen: every slot, with delete buttons.
    const w = Math.min(620, width - 40);
    const x = cx - w / 2;
    let y = height * 0.3;
    const panelH = 11 * 34 + 112;
    this.items.push(
      this.add
        .rectangle(x - 16, y - 16, w + 32, panelH, 0x140f0a, 0.92)
        .setOrigin(0)
        .setStrokeStyle(2, 0x8a6a3a),
      this.add.text(x, y - 6, 'Carregar jogo', { fontFamily: TITLE_FONT, fontSize: '20px', color: '#e0b860' }),
    );
    y += 28;
    y = drawSlotList(this, this.items, x, y, w, {
      mode: 'load',
      armed: this.armed,
      onPick: (slot) => this.play(slot),
      onDelete: (slot) => {
        if (this.armed === slot) {
          deleteSave(slot);
          this.armed = null;
        } else this.armed = slot;
        this.build();
      },
    });
    this.button(x, y + 8, 140, 'Voltar  [Esc]', () => {
      this.mode = 'main';
      this.build();
    });
  }
}
