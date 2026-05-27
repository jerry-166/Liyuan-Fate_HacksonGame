/**
 * BootScene — 启动场景
 * 在资源加载完成后自动跳转到主菜单
 * @module scenes/BootScene
 */

import Phaser from 'phaser';

export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: 'BootScene' });
  }

  create() {
    console.log('[BootScene] 启动完成，进入 MenuScene');
    this.scene.start('MenuScene');
  }
}
