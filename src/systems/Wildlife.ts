import type Phaser from 'phaser';
import { ANIMAL_SPAWN_DISTANCE, ATTACK_REACH, CARCASS_LIFETIME } from '../config';
import { Animal, type AnimalWorld, type Human } from '../entities/Animal';
import type { Npc, Prey } from '../entities/Npc';
import {
  ALL_SPECIES,
  type AnimalData,
  AnimalSpawner,
  newAnimal,
  pickAnimalTile,
  SPECIES,
  type Species,
  takeLeather,
  takeMeat,
  targetPopulation,
} from '../game/animals';
import type { Rng } from '../game/npcs';
import { gridToScreen } from '../iso';
import type { WorldMap } from '../world/map';

/** What the wildlife system needs from the scene. */
export interface WildlifeHost {
  scene: Phaser.Scene;
  map: WorldMap;
  isNight(): boolean;
  now(): number;
  /** Village centre and player position, to keep spawns away. */
  avoidPoints(): { x: number; y: number }[];
  humans(): Human[];
  /** An animal hit a person (player or villager). */
  onHumanHit(target: Human, damage: number, animal: Animal): void;
  hitBuildingAt(tx: number, ty: number, damage: number): void;
  popup(x: number, y: number, text: string, color?: string): void;
}

/**
 * Owns every animal: spawning to keep populations up, AI updates, carcass rot,
 * player melee, hunter shots, meat collection, and health bars.
 */
export class Wildlife {
  readonly animals = new Map<number, Animal>();
  private readonly spawner = new AnimalSpawner();
  private nextId = 1;
  private readonly fx: Phaser.GameObjects.Graphics;
  private readonly world: AnimalWorld;

  constructor(
    private readonly host: WildlifeHost,
    private readonly rng: Rng = Math.random,
  ) {
    this.fx = host.scene.add.graphics().setDepth(900_000);
    this.world = {
      map: host.map,
      isNight: () => host.isNight(),
      now: () => host.now(),
      humans: () => host.humans(),
      hit: (t, dmg, from) => host.onHumanHit(t, dmg, from),
      hitBuildingAt: (tx, ty, dmg) => host.hitBuildingAt(tx, ty, dmg),
    };
  }

  /** Fills the map with the daytime population. */
  populate(): void {
    for (const s of ALL_SPECIES) for (let i = 0; i < targetPopulation(s, false); i++) this.spawn(s);
  }

  /** Recreates animals from saved data. */
  restore(list: AnimalData[]): void {
    for (const a of this.animals.values()) a.destroy();
    this.animals.clear();
    for (const d of list) {
      this.animals.set(d.id, new Animal(this.host.scene, d));
      this.nextId = Math.max(this.nextId, d.id + 1);
    }
  }

  spawn(species: Species): Animal | null {
    const tile = pickAnimalTile(this.host.map, this.rng, species, this.host.avoidPoints(), ANIMAL_SPAWN_DISTANCE);
    if (!tile) return null;
    const a = new Animal(this.host.scene, newAnimal(this.nextId++, species, tile));
    this.animals.set(a.data.id, a);
    return a;
  }

  update(dt: number): void {
    const now = this.host.now();
    const alive = Object.fromEntries(ALL_SPECIES.map((s) => [s, 0])) as Record<Species, number>;
    for (const a of [...this.animals.values()]) {
      if (a.alive) {
        a.update(dt, this.world);
        alive[a.data.species]++;
      } else if ((a.data.meat <= 0 && (a.data.leather ?? 0) <= 0) || now - a.data.diedAt > CARCASS_LIFETIME) {
        this.remove(a);
      }
    }
    const want = this.spawner.update(dt, alive, this.host.isNight());
    if (want) this.spawn(want);
    this.drawHealthBars();
  }

  /** Position of an aggressive animal currently chasing someone within 4 tiles of (gx, gy). */
  threat(gx: number, gy: number): { x: number; y: number } | null {
    for (const a of this.animals.values()) {
      if (a.hunting && Math.hypot(a.data.gx - gx, a.data.gy - gy) < 4) return { x: a.data.gx, y: a.data.gy };
    }
    return null;
  }

  /** Player melee: hits the nearest live animal within reach. Returns the animal hit, if any. */
  playerAttack(
    gx: number,
    gy: number,
    damage: number,
    player: Human,
    reachBonus = 0,
    aim: (a: Animal) => boolean = () => true,
  ): Animal | null {
    const target = this.nearest(gx, gy, ATTACK_REACH + reachBonus, (a) => a.alive && aim(a));
    if (!target) return null;
    const killed = target.damage(damage, player, this.host.now());
    const s = target.sprite;
    this.host.popup(s.x, s.y - s.height, `-${damage}`, '#ff8a7a');
    if (killed) this.host.popup(s.x, s.y - s.height - 10, `${target.def.name} abatido!`, '#ffe08a');
    return target;
  }

  /** Nearest live animal that is dangerous right now (aggressive, or a boar that's charging). */
  nearestHostile(gx: number, gy: number, r: number): Animal | null {
    return this.nearest(gx, gy, r, (a) => a.alive && (a.def.temper === 'aggressive' || a.hunting));
  }

  /** Damage from a soldier, tower or other source; shows a popup. Returns true if it died. */
  damageAnimal(id: number, damage: number, from: Human): boolean {
    const a = this.animals.get(id);
    if (!a?.alive) return false;
    const killed = a.damage(damage, from, this.host.now());
    this.host.popup(a.sprite.x, a.sprite.y - a.sprite.height, `-${damage}`, '#ff8a7a');
    if (killed) this.host.popup(a.sprite.x, a.sprite.y - a.sprite.height - 10, `${a.def.name} abatido!`, '#ffe08a');
    return killed;
  }

  nearestCarcass(gx: number, gy: number, reach: number): Animal | null {
    return this.nearest(gx, gy, reach, (a) => !a.alive && (a.data.meat > 0 || (a.data.leather ?? 0) > 0));
  }

  /** Removes up to `max` leather from carcass `id`. */
  takeLeather(id: number, max: number): number {
    const a = this.animals.get(id);
    if (!a) return 0;
    const n = takeLeather(a.data, max);
    if (a.data.meat <= 0 && (a.data.leather ?? 0) <= 0) this.remove(a);
    return n;
  }

  /** Removes up to `max` meat from carcass `id`. */
  takeMeat(id: number, max: number): number {
    const a = this.animals.get(id);
    if (!a) return 0;
    const n = takeMeat(a.data, max);
    if (a.data.meat <= 0 && (a.data.leather ?? 0) <= 0) this.remove(a);
    return n;
  }

  // ---------- hunters ----------

  findPrey(cx: number, cy: number, r: number): Prey | null {
    const a = this.nearest(cx, cy, r, (x) => x.alive && SPECIES[x.data.species].temper === 'skittish');
    return a ? this.asPrey(a) : null;
  }

  prey(id: number): Prey | null {
    const a = this.animals.get(id);
    return a?.alive ? this.asPrey(a) : null;
  }

  findCarcass(cx: number, cy: number, r: number): Prey | null {
    const a = this.nearestCarcass(cx, cy, r);
    return a ? this.asPrey(a) : null;
  }

  shoot(from: Npc, id: number, damage: number): boolean {
    const a = this.animals.get(id);
    if (!a?.alive) return false;
    // Arrow streak for a moment.
    const g = this.host.scene.add.graphics().setDepth(900_001);
    const p = from.sprite;
    g.lineStyle(1, 0xf3e9d2, 0.9).lineBetween(p.x, p.y - 8, a.sprite.x, a.sprite.y - 4);
    this.host.scene.time.delayedCall(120, () => g.destroy());
    return a.damage(damage, { kind: 'npc', id: from.data.id, gx: from.gx, gy: from.gy }, this.host.now());
  }

  /** Serializable snapshot. */
  snapshot(): AnimalData[] {
    return [...this.animals.values()].map((a) => ({ ...a.data }));
  }

  private asPrey(a: Animal): Prey {
    return { id: a.data.id, gx: a.data.gx, gy: a.data.gy };
  }

  private remove(a: Animal): void {
    a.destroy();
    this.animals.delete(a.data.id);
  }

  private nearest(gx: number, gy: number, reach: number, accept: (a: Animal) => boolean): Animal | null {
    let best: Animal | null = null;
    let bestD = reach;
    for (const a of this.animals.values()) {
      if (!accept(a)) continue;
      const d = Math.hypot(a.data.gx - gx, a.data.gy - gy);
      if (d <= bestD) {
        bestD = d;
        best = a;
      }
    }
    return best;
  }

  private drawHealthBars(): void {
    this.fx.clear();
    for (const a of this.animals.values()) {
      if (!a.alive || a.data.hp >= a.def.hp) continue;
      const s = gridToScreen(a.data.gx, a.data.gy);
      const w = 14;
      const x = Math.round(s.x - w / 2);
      const y = Math.round(s.y - a.sprite.height - 4);
      this.fx.fillStyle(0x000000, 0.7).fillRect(x - 1, y - 1, w + 2, 4);
      this.fx
        .fillStyle(a.def.temper === 'aggressive' ? 0xff5040 : 0xa8e070, 1)
        .fillRect(x, y, Math.round((w * a.data.hp) / a.def.hp), 2);
    }
  }
}
