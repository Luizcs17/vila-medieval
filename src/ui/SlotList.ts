import type Phaser from 'phaser';
import { DAY_SECONDS } from '../config';
import { listSlots, type SlotId, type SlotInfo, slotName } from '../game/save';

const TEXT = { fontFamily: '"Alegreya", Georgia, serif', color: '#e8d8b0' } satisfies Phaser.Types.GameObjects.Text.TextStyle;
export const SLOT_ROW = 34;

export interface SlotListOptions {
  /** 'load' lists every slot (empty ones disabled); 'save' lists the ten manual slots (not Autosave). */
  mode: 'load' | 'save';
  onPick: (slot: SlotId, info: SlotInfo | null) => void;
  /** Shows a delete button on filled slots. */
  onDelete?: (slot: SlotId) => void;
  /** Slot to highlight (the one this game uses). */
  current?: SlotId | null;
  /** Slot whose delete/overwrite button is armed (asks for a second click). */
  armed?: SlotId | null;
}

/** What a save looks like in a list: when, which day, village or not. */
export function describeSlot(info: SlotInfo): string {
  const when = new Date(info.savedAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  const where = info.settled ? `vila com ${info.people} aldeõ${info.people === 1 ? 'ão' : 'es'}` : 'sem vila';
  return `Dia ${info.day} · ${where} · ${when}`;
}

/**
 * Draws the slot rows at (x, y) with width `w` into `items` (the caller owns and destroys them).
 * Returns the y below the list.
 */
export function drawSlotList(
  s: Phaser.Scene,
  items: Phaser.GameObjects.GameObject[],
  x: number,
  y: number,
  w: number,
  o: SlotListOptions,
): number {
  for (const { slot, info } of listSlots(DAY_SECONDS)) {
    if (o.mode === 'save' && slot === 'auto') continue;
    const enabled = o.mode === 'save' || info !== null;
    const delW = o.onDelete && info ? 34 : 0;
    const current = o.current === slot;
    const armed = o.armed === slot;
    const bg = s.add
      .rectangle(x, y, w - delW - (delW ? 4 : 0), SLOT_ROW - 4, armed ? 0x6a2a24 : enabled ? 0x2a2218 : 0x1c1712, 1)
      .setOrigin(0)
      .setStrokeStyle(1, current ? 0xe0b860 : 0x8a6a3a);
    if (enabled) bg.setInteractive({ useHandCursor: true }).on('pointerdown', () => o.onPick(slot, info));
    const name = s.add.text(x + 10, y + 7, slotName(slot), {
      ...TEXT,
      fontSize: '13px',
      color: slot === 'auto' ? '#a8d8ff' : '#e0b860',
    });
    const label = armed
      ? o.mode === 'save'
        ? 'Clique de novo para sobrescrever'
        : 'Clique de novo para apagar'
      : info
        ? describeSlot(info)
        : 'Vazio';
    const desc = s.add.text(x + 100, y + 8, label, { ...TEXT, fontSize: '12px', color: info ? '#cdb98e' : '#6a604e' });
    items.push(bg, name, desc);
    if (delW) {
      const del = s.add
        .rectangle(x + w - delW, y, delW, SLOT_ROW - 4, armed && o.mode === 'load' ? 0x8a2a24 : 0x3a2420, 1)
        .setOrigin(0)
        .setStrokeStyle(1, 0x8a6a3a);
      del.setInteractive({ useHandCursor: true }).on('pointerdown', () => o.onDelete!(slot));
      items.push(del, s.add.text(x + w - delW / 2, y + (SLOT_ROW - 4) / 2, '✕', { ...TEXT, fontSize: '14px' }).setOrigin(0.5));
    }
    y += SLOT_ROW;
  }
  return y;
}
