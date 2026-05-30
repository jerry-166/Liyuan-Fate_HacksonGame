/**
 * BootScene — 启动场景
 * 预加载序章刚需资源（主角精灵、大地图、序章过渡图），显示进度条。
 * NPC精灵延迟到 GameScene 后台预加载，因为序章墓地场景用不到任何NPC。
 * @module scenes/BootScene
 */

import Phaser from 'phaser';
import { PROTAGONIST, DIRS } from './modules/GameUIHelpers.js';
import { CHAPTER_IMAGES } from '../config.js';

export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: 'BootScene' });
  }

  preload() {
    const { width, height } = this.cameras.main;
    const barW = 400, barH = 24;
    const barX = (width - barW) / 2, barY = height / 2 + 50;

    // 背景
    this.add.rectangle(width / 2, height / 2, width, height, 0x0d0d1a);

    // 标题
    this.add.text(width / 2, height / 2 - 90, '梨园生死', {
      fontFamily: '"KaiTi","SimSun",serif',
      fontSize: '48px', color: '#d4b896',
    }).setOrigin(0.5);

    // 加载提示 + 进度文字
    const totalFiles = 11; // 主角(8) + 大地图(1) + 过渡图(1) + 墓地(1)
    const loadText = this.add.text(width / 2, height / 2 - 28, '正在准备舞台……', {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
      fontSize: '15px', color: '#887766',
    }).setOrigin(0.5);

    const fileText = this.add.text(width / 2, height / 2 + 90, '', {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
      fontSize: '12px', color: '#554433',
    }).setOrigin(0.5);

    // 进度条背景
    const barBg = this.add.graphics();
    barBg.fillStyle(0x22221c, 0.7);
    barBg.fillRoundedRect(barX, barY, barW, barH, 12);
    barBg.lineStyle(1, 0x554433, 0.5);
    barBg.strokeRoundedRect(barX, barY, barW, barH, 12);

    // 进度条填充
    const bar = this.add.graphics();
    let fileLoaded = 0;

    this.load.on('filecomplete', () => {
      fileLoaded++;
      fileText.setText(`已加载 ${fileLoaded} / ${totalFiles}`);
    });

    this.load.on('progress', (value) => {
      bar.clear();
      bar.fillStyle(0xd4b896, 0.85);
      const fillW = Math.max(6, (barW - 8) * value);
      bar.fillRoundedRect(barX + 4, barY + 4, fillW, barH - 8, 8);
      loadText.setText(`正在准备舞台…… ${Math.round(value * 100)}%`);
    });

    // ====== 只加载序章刚需（序章墓地场景不需要任何NPC精灵） ======
    // 主角精灵（4方向 × 2帧 = 8个文件）
    for (const dir of DIRS) {
      this.load.image(
        `${PROTAGONIST.prefix}_idle_${dir}`,
        `${PROTAGONIST.baseDir}/${PROTAGONIST.prefix}_idle_${dir}.png`
      );
      this.load.image(
        `${PROTAGONIST.prefix}_walk_${dir}`,
        `${PROTAGONIST.baseDir}/${PROTAGONIST.prefix}_walk_${dir}.png`
      );
    }
    // 主大地图（约3.4MB）
    this.load.image('town_worldmap', '/assets/images/maps/town_worldmap.png');
    // 序章过渡图（约2.1MB）
    this.load.image('transition_1', CHAPTER_IMAGES[1]);
    // 墓地子场景（约2.3MB）— 序章第一站，预加载消除 GameScene.preload 阻塞
    this.load.image('subscene_graveyard', '/assets/images/maps/graveyard.png');

  }

  create() {
    console.log('[BootScene] 序章核心资源加载完成（11文件），进入 MenuScene（立绘异步加载中……）');
    this.time.delayedCall(200, () => {
      this.scene.start('MenuScene');
    });
  }
}
