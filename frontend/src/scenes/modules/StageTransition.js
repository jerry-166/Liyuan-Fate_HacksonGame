/**
 * 阶段过渡动画管理器 —— 章节切换时的全屏过渡效果
 * 淡入 → 显示章节名和描述 → 停留 → 淡出
 * @module scenes/modules/StageTransition
 */

import { STAGE_TONES } from '../../config.js';

export class StageTransition {
  /**
   * @param {Phaser.Scene} uiScene - UIScene 实例
   */
  constructor(uiScene) {
    this.ui = uiScene;
  }

  /** 创建过渡覆盖层 UI */
  createOverlay() {
    const ui = this.ui;
    const { width, height } = ui.cameras.main;

    ui.transitionContainer = ui.add.container(0, 0).setDepth(500).setVisible(false);

    const overlay = ui.add.graphics();
    overlay.fillStyle(0x000000, 0);
    overlay.fillRect(0, 0, width, height);
    ui.transitionContainer.add(overlay);
    ui.transitionOverlay = overlay;

    ui.transitionTitle = ui.add.text(width / 2, height / 2 - 30, '', {
      fontFamily: '"KaiTi","SimSun",serif', fontSize: '36px', color: '#d4b896',
    }).setOrigin(0.5).setAlpha(0);
    ui.transitionContainer.add(ui.transitionTitle);

    ui.transitionDesc = ui.add.text(width / 2, height / 2 + 20, '', {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif', fontSize: '16px', color: '#998866',
      wordWrap: { width: 400 }, align: 'center',
    }).setOrigin(0.5).setAlpha(0);
    ui.transitionContainer.add(ui.transitionDesc);

    ui.transitionHint = ui.add.text(width / 2, height / 2 + 70, '', {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif', fontSize: '13px', color: '#888878',
    }).setOrigin(0.5).setAlpha(0);
    ui.transitionContainer.add(ui.transitionHint);
  }

  /** 播放阶段过渡动画 */
  async play(newStage) {
    const ui = this.ui;
    const tone = STAGE_TONES[newStage.id];

    ui.transitionContainer.setVisible(true);
    ui.transitionContainer.setAlpha(0);

    ui.transitionTitle.setText(`第${newStage.id}章 · ${newStage.name}`);
    ui.transitionDesc.setText(newStage.description || '');
    ui.transitionHint.setText('');

    await this._fadeIn(ui.transitionContainer, 800);

    ui.transitionTitle.setAlpha(1);
    ui.transitionDesc.setAlpha(0);

    ui.time.delayedCall(400, () => {
      ui.tweens.add({ targets: ui.transitionDesc, alpha: 1, duration: 600, ease: 'Sine.easeIn' });
    });

    await this._wait(2200);
    await this._fadeOut(ui.transitionContainer, 600);
    ui.transitionContainer.setVisible(false);
  }

  _fadeIn(container, duration) {
    return new Promise(resolve => {
      this.ui.tweens.add({ targets: container, alpha: 1, duration, ease: 'Sine.easeIn', onComplete: resolve });
    });
  }

  _fadeOut(container, duration) {
    return new Promise(resolve => {
      this.ui.tweens.add({ targets: container, alpha: 0, duration, ease: 'Sine.easeOut', onComplete: resolve });
    });
  }

  _wait(ms) {
    return new Promise(resolve => this.ui.time.delayedCall(ms, resolve));
  }

  /** 窗口缩放时重建过渡覆盖层并恢复当前状态 */
  onResize() {
    const ui = this.ui;
    const wasVisible = ui.transitionContainer && ui.transitionContainer.visible;
    const savedTitle = ui.transitionTitle ? ui.transitionTitle.text : '';
    const savedDesc = ui.transitionDesc ? ui.transitionDesc.text : '';
    const savedHint = ui.transitionHint ? ui.transitionHint.text : '';
    const savedAlpha = ui.transitionContainer ? ui.transitionContainer.alpha : 0;

    if (ui.transitionContainer) {
      ui.transitionContainer.destroy();
      ui.transitionContainer = null;
    }

    this.createOverlay();

    if (wasVisible) {
      ui.transitionContainer.setVisible(true);
      ui.transitionContainer.setAlpha(savedAlpha);
      ui.transitionTitle.setText(savedTitle);
      ui.transitionDesc.setText(savedDesc);
      ui.transitionHint.setText(savedHint);
    }
  }
}
