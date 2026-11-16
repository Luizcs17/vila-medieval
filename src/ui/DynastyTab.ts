import { DAY_SECONDS } from '../config';
import { ageOf, PLAYER_ID, PLAYER_SURNAME } from '../game/families';
import type { ManagementUI } from './ManagementUI';

interface Person {
  id: number;
  name: string;
  surname: string;
  partnerId: number | null;
  parents: number[];
  born: number;
  alive: boolean;
  diedAt?: number;
}

const MUTED = '#a8977a';
const BOX_H = 38;
const ROW_H = 64;
const MAX_DEPTH = 5;

/** Which tree is shown: the player's dynasty or a rival ruler's. */
let rootId: number = PLAYER_ID;

/**
 * Family tree tab. Each box is a person (with their spouse on the second line); children hang
 * below. The dead are greyed out with †.
 */
export function renderDynasty(ui: ManagementUI, x: number, y: number, w: number, h: number): void {
  const world = ui.world;
  const pop = world.population;
  const now = world.clock.seconds;

  const person = (id: number): Person | undefined => {
    if (id === PLAYER_ID)
      return {
        id,
        name: 'Você',
        surname: PLAYER_SURNAME,
        partnerId: pop.playerPartnerId,
        parents: [],
        born: -Infinity,
        alive: true,
      };
    const p = pop.person(id);
    if (!p) return undefined;
    const dead = 'diedAt' in p;
    return {
      id,
      name: p.name,
      surname: p.surname,
      partnerId: p.partnerId,
      parents: p.parents,
      born: p.born,
      alive: !dead,
      diedAt: dead ? p.diedAt : undefined,
    };
  };
  const everyone = [...pop.allVillagers.map((n) => n.id), ...pop.deceased.map((d) => d.id)];
  const childrenOf = (ids: number[]) =>
    everyone
      .filter((c) => person(c)?.parents.some((p) => ids.includes(p)))
      .sort((a, b) => (person(a)?.born ?? 0) - (person(b)?.born ?? 0));
  /** Walk up to the oldest known ancestor. */
  const founder = (id: number): number => {
    let cur = id;
    for (let guard = 0; guard < 10; guard++) {
      const p = person(cur);
      const up = p?.parents.find((pid) => pid === PLAYER_ID || person(pid));
      if (up === undefined) break;
      cur = up;
    }
    return cur;
  };

  // Tree selector: only the leaders' dynasties: yours and each rival ruler's.
  const options: [string, number][] = [['Sua dinastia', PLAYER_ID]];
  for (const f of world.factions)
    if (!f.isPlayer && f.alive && f.rulerId !== null && person(f.rulerId)) options.push([`${f.name}`, founder(f.rulerId)]);
  if (!options.some(([, id]) => id === rootId)) rootId = PLAYER_ID;
  options.forEach(([label, id], k) => {
    ui.button(
      x + k * 150,
      y,
      144,
      label.length > 18 ? `${label.slice(0, 17)}…` : label,
      () => {
        rootId = id;
        ui.build();
      },
      id === rootId ? 0x8a6a3a : 0x241a12,
    );
  });

  // Layout: leaves get equal slots; a parent box is centred over its children.
  interface Node {
    id: number;
    depth: number;
    kids: Node[];
    cx: number;
  }
  const build = (id: number, depth: number): Node => {
    const p = person(id);
    const kids =
      depth < MAX_DEPTH ? childrenOf(p?.partnerId != null ? [id, p.partnerId] : [id]).map((c) => build(c, depth + 1)) : [];
    return { id, depth, kids, cx: 0 };
  };
  const root = build(rootId, 0);
  const leaves: Node[] = [];
  const collect = (n: Node) => (n.kids.length === 0 ? leaves.push(n) : n.kids.forEach(collect));
  collect(root);
  const top = y + 40;
  const slot = Math.max(110, Math.min(240, w / Math.max(1, leaves.length)));
  leaves.forEach((n, k) => {
    n.cx = x + slot * k + slot / 2;
  });
  const place = (n: Node): number => {
    if (n.kids.length > 0) {
      const xs = n.kids.map(place);
      n.cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    }
    return n.cx;
  };
  place(root);
  const scene = ui.scene;
  const g = ui.add(scene.add.graphics());
  const boxW = Math.min(slot - 10, 220);

  const draw = (n: Node) => {
    const p = person(n.id);
    if (!p) return;
    const by = top + n.depth * ROW_H;
    if (by + BOX_H > y + h) return;
    for (const k of n.kids) {
      const ky = top + k.depth * ROW_H;
      if (ky + BOX_H > y + h) continue;
      g.lineStyle(1, 0x8a7350, 1);
      g.lineBetween(n.cx, by + BOX_H, n.cx, by + BOX_H + 10);
      g.lineBetween(n.cx, by + BOX_H + 10, k.cx, by + BOX_H + 10);
      g.lineBetween(k.cx, by + BOX_H + 10, k.cx, ky);
    }
    const isRuler = n.id === PLAYER_ID || world.factions.some((f) => f.rulerId === n.id);
    ui.add(
      scene.add
        .rectangle(n.cx - boxW / 2, by, boxW, BOX_H, p.alive ? 0x241a12 : 0x1e1a16, 1)
        .setOrigin(0)
        .setStrokeStyle(isRuler ? 2 : 1, isRuler ? 0xffd040 : 0x8a6a3a),
    );
    const life = (q: Person) =>
      q.id === PLAYER_ID ? '' : q.alive ? ` (${ageOf(q, now)})` : ` † ${Math.floor(((q.diedAt ?? now) - q.born) / DAY_SECONDS)}`;
    const color = p.alive ? '#e8d8b0' : MUTED;
    ui.text(n.cx - boxW / 2 + 6, by + 4, `${p.name} ${p.surname}${life(p)}`.slice(0, 30), 11, color);
    const partner = p.partnerId !== null ? person(p.partnerId) : undefined;
    if (partner)
      ui.text(n.cx - boxW / 2 + 6, by + 20, `♥ ${partner.name} ${partner.surname}${life(partner)}`.slice(0, 30), 10, '#ffb0d0');
    for (const k of n.kids) draw(k);
  };
  draw(root);

  if (root.kids.length === 0) {
    const tip =
      rootId === PLAYER_ID
        ? 'Sua dinastia começa com você. Converse com seus aldeões todo dia (E) para criar afinidade e peça alguém em casamento.'
        : 'Ainda sem descendentes.';
    ui.text(x, top + BOX_H + 16, tip, 11, MUTED).setWordWrapWidth(w);
  }
}
