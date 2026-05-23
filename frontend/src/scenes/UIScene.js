import Phaser from 'phaser';

/**
 * UIScene — UI 覆盖层场景
 * 渲染在 GameScene 之上，负责对话 UI、HUD 等界面元素
 */
export class UIScene extends Phaser.Scene {
  constructor() {
    super({ key: 'UIScene' });
  }

  create() {
    // TODO: 对话 UI、HUD 等
  }
}
