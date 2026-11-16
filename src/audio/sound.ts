/**
 * Sound for the whole game: background music that follows the mood (title, day, night, battle)
 * with slow crossfades, and short sound effects synthesized with the Web Audio API (no files).
 *
 * Music files are optional: they live in `public/audio/music/` (see MUSIC below and
 * docs/CREDITS.md). A missing file just means silence for that mood.
 */

export type Mood = 'title' | 'day' | 'night' | 'battle';

/** Tracks per mood, played in turn. Paths are relative to the page (Vite serves public/ at the root). */
export const MUSIC: Record<Mood, string[]> = {
  title: ['audio/music/title.mp3'],
  day: ['audio/music/day_kingdom.mp3', 'audio/music/day_majesty.ogg'],
  night: ['audio/music/night_legend.mp3', 'audio/music/night_theme.mp3'],
  battle: ['audio/music/battle.mp3'],
};

export type Sfx =
  | 'chop'
  | 'mine'
  | 'pull'
  | 'build'
  | 'swing'
  | 'hit'
  | 'hurt'
  | 'eat'
  | 'pickup'
  | 'drop'
  | 'coins'
  | 'click'
  | 'open'
  | 'complete'
  | 'levelup'
  | 'recruit'
  | 'dig';

const SETTINGS_KEY = 'vila-medieval-audio';
/** Seconds a crossfade between moods takes. */
const FADE = 4;

interface Settings {
  music: number;
  sfx: number;
}

function loadSettings(): Settings {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null') as Partial<Settings> | null;
    return { music: s?.music ?? 0.5, sfx: s?.sfx ?? 0.6 };
  } catch {
    return { music: 0.5, sfx: 0.6 };
  }
}

/** One playing track: an <audio> element whose volume we ramp. */
interface Track {
  el: HTMLAudioElement;
  mood: Mood;
  /** 0–1 fade level (times the music volume). */
  level: number;
  target: number;
}

class SoundSystem {
  settings: Settings = loadSettings();
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private mood: Mood | null = null;
  private tracks: Track[] = [];
  private next: Record<Mood, number> = { title: 0, day: 0, night: 0, battle: 0 };
  private missing = new Set<string>();
  private unlocked = false;
  private last = new Map<Sfx, number>();

  constructor() {
    // Browsers only allow sound after a user gesture.
    const unlock = () => {
      this.unlocked = true;
      this.ensureContext();
      void this.ctx?.resume();
      for (const t of this.tracks) if (t.el.paused) void t.el.play().catch(() => {});
      if (this.mood && this.tracks.length === 0) this.startTrack(this.mood);
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('pointerdown', unlock);
      window.addEventListener('keydown', unlock);
    }
  }

  private ensureContext(): void {
    if (this.ctx || typeof AudioContext === 'undefined') return;
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.settings.sfx;
    this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  // ---------- settings ----------

  setVolume(kind: 'music' | 'sfx', v: number): void {
    this.settings[kind] = Math.max(0, Math.min(1, Math.round(v * 10) / 10));
    if (kind === 'sfx' && this.master) this.master.gain.value = this.settings.sfx;
    for (const t of this.tracks) t.el.volume = t.level * this.settings.music;
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
    } catch {
      // not saved: fine
    }
  }

  // ---------- music ----------

  /** Switches the mood; the music crossfades over a few seconds. */
  setMood(mood: Mood): void {
    if (mood === this.mood) return;
    this.mood = mood;
    for (const t of this.tracks) t.target = 0;
    if (this.unlocked) this.startTrack(mood);
  }

  private startTrack(mood: Mood): void {
    const list = MUSIC[mood].filter((p) => !this.missing.has(p));
    if (list.length === 0) return;
    const src = list[this.next[mood] % list.length];
    this.next[mood]++;
    const el = new Audio(src);
    el.volume = 0;
    const track: Track = { el, mood, level: 0, target: 1 };
    el.addEventListener('error', () => {
      this.missing.add(src);
      this.tracks = this.tracks.filter((t) => t !== track);
    });
    // When a track ends, the next one of the same mood starts.
    el.addEventListener('ended', () => {
      this.tracks = this.tracks.filter((t) => t !== track);
      if (this.mood === mood) this.startTrack(mood);
    });
    this.tracks.push(track);
    void el.play().catch(() => {});
  }

  /** Call every frame with real seconds: drives the fades. */
  update(dt: number): void {
    const step = dt / FADE;
    for (const t of [...this.tracks]) {
      t.level += Math.sign(t.target - t.level) * Math.min(step, Math.abs(t.target - t.level));
      t.el.volume = Math.max(0, Math.min(1, t.level * this.settings.music));
      if (t.target === 0 && t.level <= 0) {
        t.el.pause();
        this.tracks = this.tracks.filter((x) => x !== t);
      }
    }
  }

  // ---------- effects ----------

  /** Plays a short effect. `gain` scales it (e.g. quieter for things far away). */
  play(name: Sfx, gain = 1): void {
    if (!this.unlocked || this.settings.sfx <= 0) return;
    this.ensureContext();
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noise) return;
    // Don't stack the same sound many times in one instant.
    const now = ctx.currentTime;
    if (now - (this.last.get(name) ?? -1) < 0.06) return;
    this.last.set(name, now);
    const v = gain * (0.85 + Math.random() * 0.3);
    const pitch = 0.92 + Math.random() * 0.16;
    switch (name) {
      case 'chop':
        this.thud(now, 140 * pitch, 0.09, 0.5 * v);
        this.burst(now, 1800 * pitch, 6, 0.06, 0.35 * v);
        break;
      case 'mine':
        this.tone(now, 1300 * pitch, 'triangle', 0.12, 0.18 * v, 0.6);
        this.burst(now, 3200 * pitch, 3, 0.05, 0.3 * v);
        break;
      case 'dig':
        this.burst(now, 600 * pitch, 1.5, 0.14, 0.35 * v);
        break;
      case 'pull':
        this.burst(now, 2600 * pitch, 1.2, 0.12, 0.18 * v);
        break;
      case 'build':
        this.thud(now, 220 * pitch, 0.06, 0.35 * v);
        this.tone(now, 900 * pitch, 'square', 0.04, 0.05 * v, 0.7);
        break;
      case 'swing':
        this.burst(now, 1400 * pitch, 0.8, 0.12, 0.22 * v, 3200);
        break;
      case 'hit':
        this.thud(now, 110 * pitch, 0.1, 0.5 * v);
        this.burst(now, 900 * pitch, 2, 0.05, 0.3 * v);
        break;
      case 'hurt':
        this.thud(now, 80, 0.16, 0.55 * v);
        this.tone(now, 180, 'sawtooth', 0.12, 0.06 * v, 0.6);
        break;
      case 'eat':
        for (let k = 0; k < 3; k++) this.burst(now + k * 0.09, 1200 * pitch, 2, 0.04, 0.18 * v);
        break;
      case 'pickup':
        this.tone(now, 520 * pitch, 'triangle', 0.08, 0.12 * v, 1.5);
        break;
      case 'drop':
        this.thud(now, 160 * pitch, 0.08, 0.3 * v);
        break;
      case 'coins':
        for (let k = 0; k < 3; k++) this.tone(now + k * 0.05, (1900 + k * 260) * pitch, 'triangle', 0.09, 0.07 * v, 0.9);
        break;
      case 'click':
        this.tone(now, 700, 'triangle', 0.03, 0.06 * v, 1);
        break;
      case 'open':
        this.burst(now, 700, 1, 0.08, 0.12 * v);
        break;
      case 'complete':
        this.chord(now, [262, 330, 392], 0.9, 0.08 * v);
        break;
      case 'levelup':
        this.chord(now, [294, 370, 440, 587], 1.2, 0.08 * v);
        break;
      case 'recruit':
        this.chord(now, [220, 277, 330], 1.0, 0.07 * v);
        break;
    }
  }

  private out(gain: number, start: number, length: number): GainNode {
    const g = this.ctx!.createGain();
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), start + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, start + length);
    g.connect(this.master!);
    return g;
  }

  /** Filtered noise: rustle, scrape, crack. */
  private burst(start: number, freq: number, q: number, length: number, gain: number, sweepTo?: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.7 + Math.random() * 0.6;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(freq, start);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, start + length);
    f.Q.value = q;
    src.connect(f).connect(this.out(gain, start, length));
    src.start(start, Math.random() * 0.5, length + 0.05);
  }

  /** A low knock (wood, body). */
  private thud(start: number, freq: number, length: number, gain: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(freq * 1.6, start);
    o.frequency.exponentialRampToValueAtTime(freq * 0.6, start + length);
    o.connect(this.out(gain, start, length));
    o.start(start);
    o.stop(start + length + 0.05);
  }

  private tone(start: number, freq: number, type: OscillatorType, length: number, gain: number, glide: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, start);
    o.frequency.exponentialRampToValueAtTime(freq * glide, start + length);
    o.connect(this.out(gain, start, length));
    o.start(start);
    o.stop(start + length + 0.05);
  }

  /** A soft plucked chord (lute-like), for good news. */
  private chord(start: number, freqs: number[], length: number, gain: number): void {
    freqs.forEach((f, k) => {
      this.tone(start + k * 0.07, f, 'triangle', length, gain, 0.998);
    });
  }
}

/** The game's single sound system. */
export const sound = new SoundSystem();
