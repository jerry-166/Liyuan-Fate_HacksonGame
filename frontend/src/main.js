/**
 * Phaser 游戏入口
 *
 * 职责：
 * - 创建 Phaser.Game 实例并配置渲染参数
 * - 注册所有场景（BootScene → MenuScene → GameScene → UIScene）
 * - 导出全局自由文本输入工具（供对话系统使用）
 *
 * @module main
 */

import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene.js';
import { MenuScene } from './scenes/MenuScene.js';
import { GameScene } from './scenes/GameScene.js';
import { UIScene } from './scenes/UIScene.js';
import { isMobileDevice } from './utils/DeviceDetector.js';

// ★ 移动端横屏锁定：竖屏时自动缩放适配
const isMobile = isMobileDevice();

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
    // ★ 移动端用 FIT 保持 1280x800 设计比例并 letterbox
    //    桌面端用 RESIZE 以支持窗口自由调整
    mode: isMobile ? Phaser.Scale.FIT : Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    // 移动端自动锁横屏
    autoRound: true,
  },
  // ★ 移动端启用多点触控
  input: {
    activePointers: isMobile ? 3 : 1,
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

// eslint-disable-next-line no-unused-vars
const game = new Phaser.Game(config);

/**
 * 创建全局自由文本输入框（HTML DOM input）
 * 使用 fixed 定位，嵌入 game-container 中与 canvas 同级
 * 用于对话框内的自由文本回复
 *
 * @returns {HTMLInputElement} 输入框 DOM 元素
 */
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

/** 全局输入值引用 — 保存最新提交的文本 */
export const globalInputValues = { current: '' };

// ★ 移动端横屏检测：竖屏时显示提示遮罩
if (isMobile) {
  const warnEl = document.getElementById('orientation-warn');
  const checkOrientation = () => {
    const isLandscape = window.innerWidth > window.innerHeight;
    if (warnEl) warnEl.style.display = isLandscape ? 'none' : 'flex';
  };
  window.addEventListener('resize', checkOrientation);
  window.addEventListener('orientationchange', () => {
    setTimeout(checkOrientation, 300); // 延迟等待浏览器更新尺寸
  });
  checkOrientation();

  // ★ 禁用移动端浏览器手势（滑动调节亮度/音量/返回等）
  // 只拦截 document 层的触摸，不阻断 Phaser canvas 内的游戏交互
  const gc = document.getElementById('game-container');
  if (gc) {
    gc.addEventListener('touchmove', (e) => {
      // 仅阻止容器级触摸（边缘滑动等浏览器手势），不干扰 canvas 内 Phaser 输入
      const target = /** @type {Element} */ (e.target);
      if (target === gc || target === document.body || target === document.documentElement) {
        e.preventDefault();
      }
    }, { passive: false });
    gc.style.touchAction = 'none';
  }

  // 阻止手势导航（Android 返回手势等）
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('gesturechange', (e) => e.preventDefault());
  document.addEventListener('gestureend', (e) => e.preventDefault());
}

// ★ 游戏创建后给 canvas 设置 touch-action:none（桌面端也设，无副作用）
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    const canvas = document.querySelector('#game-container canvas');
    if (canvas) canvas.style.touchAction = 'none';
  }, 1000);
});
