import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene.js';
import { MenuScene } from './scenes/MenuScene.js';
import { GameScene } from './scenes/GameScene.js';
import { UIScene } from './scenes/UIScene.js';

const config = {
  type: Phaser.AUTO,
  parent: 'game-container',
  width: 1280,
  height: 800,
  backgroundColor: '#1a1a2e',
  pixelArt: true,
  roundPixels: true,
  dom: { createContainer: true },
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { x: 0, y: 0 },
      debug: false,
    },
  },
  scene: [BootScene, MenuScene, GameScene, UIScene],
};

const game = new Phaser.Game(config);

// ========== 全局自由文本输入框（HTML DOM，嵌入对话框内）==========
export function createGlobalInput() {
  const el = document.createElement('input');
  el.type = 'text';
  el.id = 'game-free-input';
  el.placeholder = '输入你想说的话……';
  el.style.cssText = `
    position: fixed; display: none; z-index: 350;
    font-family: "Microsoft YaHei","PingFang SC",sans-serif;
    font-size: 18px; color: #e8dcc8;
    background: #16161e; border: none;
    border-top: 1px solid #c4a882;
    border-radius: 0 0 6px 6px; padding: 6px 12px; margin: 0;
    outline: none; box-sizing: border-box;
  `;
  document.getElementById('game-container').appendChild(el);
  return el;
}

// 保存输入值集（用于清理）
export const globalInputValues = { current: '' };
