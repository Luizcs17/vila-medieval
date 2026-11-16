import '@fontsource/alegreya/400.css';
import '@fontsource/alegreya/700.css';
import '@fontsource/medievalsharp/400.css';
import Phaser from 'phaser';
import { sound } from './audio/sound';
import { TitleScene } from './scenes/TitleScene';
import { UIScene } from './scenes/UIScene';
import { WorldScene } from './scenes/WorldScene';

// Phaser draws text to canvas, so the bundled fonts must be loaded before the first text is made.
await Promise.all(['16px Alegreya', '16px MedievalSharp'].map((f) => document.fonts.load(f)));

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#0b0907',
  pixelArt: true,
  // RESIZE fills the window; explicit fallbacks avoid a 0x0 WebGL framebuffer if the
  // page boots while hidden (e.g. a background tab).
  scale: {
    mode: Phaser.Scale.RESIZE,
    width: Math.max(window.innerWidth, 640),
    height: Math.max(window.innerHeight, 360),
  },
  scene: [TitleScene, WorldScene, UIScene],
});

// Dev-only handle for debugging from the browser console, e.g.
// game.scene.getScene('World').stockpile.add('wood', 50); `sound` is the audio system. Stripped from production builds.
if (import.meta.env.DEV) Object.assign(window as unknown as object, { game, sound });
