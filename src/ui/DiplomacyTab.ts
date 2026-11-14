import { ALLIANCE_MIN, GIFT_COST, missionChance } from '../game/diplomacy';
import { RESOURCE_LABEL, RESOURCES } from '../game/inventory';
import type { ManagementUI } from './ManagementUI';

const MUTED = '#a89a80';
const STATUS: Record<string, [string, string]> = {
  peace: ['Paz', '#cfc3a8'],
  alliance: ['Aliança', '#a8ffa8'],
  war: ['Guerra', '#ff6a5a'],
};

/** Feedback from the last button pressed (shown under the title). */
let lastMessage = '';

/**
 * Diplomacy tab: relation with each village (score bar and status), diplomat missions (gift,
 * alliance, peace), war declaration, sending soldiers, and AI proposals awaiting an answer.
 */
export function renderDiplomacy(ui: ManagementUI, x: number, y: number, w: number): void {
  const world = ui.world;
  const diplomats = world.freeDiplomats();
  const soldiers = world.soldiers();
  const best = diplomats[0];
  const gift = RESOURCES.filter((r) => GIFT_COST[r])
    .map((r) => `${GIFT_COST[r]} ${RESOURCE_LABEL[r].toLowerCase()}`)
    .join(' + ');
  ui.text(
    x,
    y,
    `Diplomatas livres: ${diplomats.length}${best ? ` (melhor: ${best.name}, Diplomacia ${best.skills.diplomacy}★)` : ' — construa uma Embaixada e designe aldeões'}  ·  Soldados: ${soldiers.length}`,
    12,
  );
  if (lastMessage) ui.text(x, y + 18, lastMessage, 11, '#ffe08a');
  let yy = y + 42;

  const act = (fn: () => string | number | void) => () => {
    const r = fn();
    lastMessage = typeof r === 'string' ? r : '';
    ui.build();
  };

  for (const f of world.factions) {
    if (f.isPlayer) continue;
    ui.add(
      ui.scene.add
        .rectangle(x, yy + 4, 12, 12, f.color)
        .setOrigin(0)
        .setAlpha(f.alive ? 1 : 0.3),
    );
    ui.text(x + 18, yy, f.name, 14, f.alive ? '#f3e9d2' : MUTED);
    if (!f.alive) {
      ui.text(x + 200, yy + 2, 'conquistada', 12, MUTED);
      yy += 34;
      continue;
    }
    const rel = world.diplomacy.get(0, f.id);
    const [label, color] = STATUS[rel.status];
    ui.text(x + 200, yy + 2, label, 13, color);
    // Score bar: -100 … 100.
    const bx = x + 290;
    const bw = 160;
    const g = ui.add(ui.scene.add.graphics());
    g.fillStyle(0x000000, 0.6).fillRect(bx, yy + 6, bw, 8);
    const mid = bx + bw / 2;
    const len = (rel.score / 100) * (bw / 2);
    g.fillStyle(rel.score >= 0 ? 0x80d070 : 0xe05040, 1).fillRect(Math.min(mid, mid + len), yy + 7, Math.abs(len), 6);
    g.fillStyle(0xffffff, 0.6).fillRect(mid, yy + 4, 1, 12);
    ui.text(bx + bw + 8, yy + 2, `${rel.score > 0 ? '+' : ''}${Math.round(rel.score)}`, 12);

    // Actions.
    const ay = yy + 22;
    let ax = x + 18;
    const btn = (labelText: string, width: number, fn: () => string | number | void, c = 0x3a3228) => {
      ui.button(ax, ay, width, labelText, act(fn), c);
      ax += width + 6;
    };
    if (rel.status !== 'war') {
      btn(`Presente (${gift})`, 196, () => world.sendMission('gift', f.id));
      const chance = best ? Math.round(missionChance('alliance', best.skills.diplomacy, rel.score) * 100) : 0;
      if (rel.status === 'peace')
        btn(
          rel.score >= ALLIANCE_MIN ? `Propor aliança (${chance}%)` : `Aliança: precisa +${ALLIANCE_MIN}`,
          170,
          () => world.sendMission('alliance', f.id),
          rel.score >= ALLIANCE_MIN ? 0x2c4a6a : 0x2a2420,
        );
      btn(
        'Declarar guerra',
        130,
        () => {
          world.declareWarOn(f.id);
          return `Guerra declarada contra ${f.name}.`;
        },
        0x6a2a24,
      );
    } else {
      const chance = best ? Math.round(missionChance('peace', best.skills.diplomacy, rel.score) * 100) : 0;
      btn(`Propor paz (${chance}%)`, 150, () => world.sendMission('peace', f.id), 0x2c4a6a);
      btn(
        `Atacar com soldados (${soldiers.length})`,
        196,
        () => {
          const n = world.orderAttack(f.id);
          return n > 0
            ? `${n} soldado(s) a caminho de ${f.name}.`
            : 'Sem soldados prontos. Construa um Quartel e designe aldeões.';
        },
        0x6a2a24,
      );
      btn('Recuar', 80, () => world.recallSoldiers());
    }
    const travelling = [...world.missions.values()].filter((m) => m.target === f.id);
    if (travelling.length > 0) {
      const phase = { going: 'a caminho', talking: 'negociando', returning: 'voltando' };
      const who = travelling.map((m) => `${world.population.person(m.diplomatId)?.name} (${phase[m.phase]})`).join(', ');
      ui.text(ax + 4, ay + 5, `Missão: ${who}`, 11, '#a8c8ff');
    }
    yy += 58;
  }

  // AI proposals waiting for your answer.
  const pending = world.diplomacy.pending;
  if (pending.length > 0) {
    yy += 6;
    ui.text(x, yy, 'Propostas recebidas', 13, '#cfc3a8');
    yy += 20;
    for (const p of pending) {
      const name = world.factions[p.from].name;
      ui.text(x, yy + 5, `${name} propõe ${p.kind === 'alliance' ? 'uma aliança' : 'a paz'}.`, 12);
      ui.button(
        x + 300,
        yy,
        90,
        'Aceitar',
        act(() => world.answerProposal(p, true)),
        0x3c6a2c,
      );
      ui.button(
        x + 396,
        yy,
        90,
        'Recusar',
        act(() => world.answerProposal(p, false)),
        0x5a2a24,
      );
      yy += 30;
    }
  }
  ui.text(
    x,
    yy + 14,
    'Alianças: aliados não atacam você e entram nas suas guerras. Na guerra, tomar o Salão (estoque) de uma vila a conquista.',
    10,
    MUTED,
  ).setWordWrapWidth(w);
}
