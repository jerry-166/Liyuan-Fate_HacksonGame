import Phaser from 'phaser';

export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: 'BootScene' });
  }

  preload() {
    // 没有外部资源需要加载，直接跳入 create
  }

  create() {
    console.log('[BootScene] 启动完成，进入 GameScene');
    this.scene.start('GameScene');
  }
}
