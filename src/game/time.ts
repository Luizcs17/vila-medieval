import { DAY_SECONDS, START_HOUR } from '../config';

/** In-game clock. `seconds` counts game time since the start of day 1 at midnight. */
export class GameClock {
  seconds: number;

  constructor(startHour = START_HOUR) {
    this.seconds = (startHour / 24) * DAY_SECONDS;
  }

  advance(dt: number): void {
    this.seconds += dt;
  }

  get day(): number {
    return Math.floor(this.seconds / DAY_SECONDS) + 1;
  }

  /** 0 <= hour < 24, fractional. */
  get hour(): number {
    return ((this.seconds % DAY_SECONDS) / DAY_SECONDS) * 24;
  }

  get isNight(): boolean {
    const h = this.hour;
    return h >= 19.5 || h < 6;
  }
}

export function formatClock(hour: number): string {
  const h = Math.floor(hour);
  const m = Math.floor((hour - h) * 6) * 10; // 10-minute steps read calmer than a ticking clock
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

interface Tint {
  r: number;
  g: number;
  b: number;
  a: number;
}

const NIGHT: Tint = { r: 10, g: 16, b: 48, a: 0.55 };
const DAWN: Tint = { r: 255, g: 150, b: 90, a: 0.18 };
const DUSK: Tint = { r: 255, g: 120, b: 60, a: 0.25 };
const CLEAR: Tint = { r: 255, g: 190, b: 140, a: 0 };

/** Lighting keyframes over a day: [hour, tint]. Must start at 0 and end at 24. */
const KEYFRAMES: [number, Tint][] = [
  [0, NIGHT],
  [5, NIGHT],
  [6.5, DAWN],
  [8, CLEAR],
  [17.5, CLEAR],
  [19, DUSK],
  [20.5, NIGHT],
  [24, NIGHT],
];

/** Colour and opacity of the full-screen overlay that tints the world at a given hour. */
export function ambientAt(hour: number): { color: number; alpha: number } {
  const h = ((hour % 24) + 24) % 24;
  let k = 0;
  while (KEYFRAMES[k + 1][0] <= h) k++;
  const [h0, a] = KEYFRAMES[k];
  const [h1, b] = KEYFRAMES[k + 1];
  const t = (h - h0) / (h1 - h0);
  const mix = (x: number, y: number) => x + (y - x) * t;
  const r = Math.round(mix(a.r, b.r));
  const g = Math.round(mix(a.g, b.g));
  const bl = Math.round(mix(a.b, b.b));
  return { color: (r << 16) | (g << 8) | bl, alpha: mix(a.a, b.a) };
}
