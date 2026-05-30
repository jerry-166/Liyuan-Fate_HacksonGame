/**
 * BootScene — 启动场景
 * 预加载序章核心资源（主角精灵、大地图、序章过渡图），显示加载进度条。
 * 完成后自动跳转到主菜单。
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
    const barW = 320, barH = 22;
    const barX = (width - barW) / 2, barY = height / 2 + 50;

    // 背景
    this.add.rectangle(width / 2, height / 2, width, height, 0x0d0d1a);

    // 标题
    this.add.text(width / 2, height / 2 - 90, '梨园生死', {
      fontFamily: '"KaiTi","SimSun",serif',
      fontSize: '48px', color: '#d4b896',
    }).setOrigin(0.5);

    // 加载提示
    const loadText = this.add.text(width / 2, height / 2 - 28, '正在准备舞台……', {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
      fontSize: '15px', color: '#887766',
    }).setOrigin(0.5);

    // 进度条背景
    const barBg = this.add.graphics();
    barBg.fillStyle(0x22221c, 0.7);
    barBg.fillRoundedRect(barX, barY, barW, barH, 10);
    barBg.lineStyle(1, 0x554433, 0.5);
    barBg.strokeRoundedRect(barX, barY, barW, barH, 10);

    // 进度条填充
    const bar = this.add.graphics();

    this.load.on('progress', (value) => {
      bar.clear();
      bar.fillStyle(0xd4b896, 0.85);
      const fillW = Math.max(6, (barW - 8) * value);
      bar.fillRoundedRect(barX + 4, barY + 4, fillW, barH - 8, 7);
      loadText.setText(`正在准备舞台…… ${Math.round(value * 100)}%`);
    });

    // ====== 只加载序章核心资源 ======
    // 主角精灵（8个文件）
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
    // 主大地图（约3.4MB — 最重的单个资源）
    this.load.image('town_worldmap', '/assets/images/maps/town_worldmap.png');
    // 序章过渡图
    this.load.image('transition_1', CHAPTER_IMAGES[1]);
  }

  create() {
    console.log('[BootScene] 核心资源加载完成，进入 MenuScene');
    // 短暂过渡后进入菜单
    this.time.delayedCall(200, () => {
      this.scene.start('MenuScene');
    });
  }
}
