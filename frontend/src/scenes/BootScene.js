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
