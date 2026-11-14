import Phaser from 'phaser';
import { UIScene } from './scenes/UIScene';
import { WorldScene } from './scenes/WorldScene';

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#14110d',
  pixelArt: true,
  // RESIZE fills the window; explicit fallbacks avoid a 0x0 WebGL framebuffer if the
  // page boots while hidden (e.g. a background tab).
  scale: {
    mode: Phaser.Scale.RESIZE,
    width: Math.max(window.innerWidth, 640),
    height: Math.max(window.innerHeight, 360),
  },
  scene: [WorldScene, UIScene],
});

// Dev-only handle for debugging from the browser console, e.g.
// game.scene.getScene('World').stockpile.add('wood', 50). Stripped from production builds.
if (import.meta.env.DEV) (window as unknown as { game: Phaser.Game }).game = game;
