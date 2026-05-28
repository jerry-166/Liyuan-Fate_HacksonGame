/**
 * 阶段过渡动画管理器 —— 章节切换时的全屏过渡效果
 * 背景配图 + 暗色遮罩 + 淡入 → 显示章节名和描述 → 停留 → 淡出
 * @module scenes/modules/StageTransition
 */

import { STAGE_TONES, CHAPTER_IMAGES, getChapterLabel } from '../../config.js';

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

    // 背景图片（铺满屏幕，保持比例 cover）
    ui.transitionBg = ui.add.image(width / 2, height / 2, 'transition_1')
      .setDisplaySize(width, height);
    ui.transitionContainer.add(ui.transitionBg);

    // 半透明暗色遮罩
    ui.transitionDim = ui.add.graphics();
    ui.transitionDim.fillStyle(0x000000, 0.45);
    ui.transitionDim.fillRect(0, 0, width, height);
    ui.transitionContainer.add(ui.transitionDim);

    // 章节标题
    ui.transitionTitle = ui.add.text(width / 2, height / 2 - 60, '', {
      fontFamily: '"KaiTi","SimSun",serif', fontSize: '36px', color: '#d4b896',
      stroke: '#000000', strokeThickness: 4,
    }).setOrigin(0.5, 0).setAlpha(0);
    ui.transitionContainer.add(ui.transitionTitle);

    // 章节描述
    ui.transitionDesc = ui.add.text(width / 2, height / 2, '', {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif', fontSize: '16px', color: '#998866',
      stroke: '#000000', strokeThickness: 3,
      wordWrap: { width: 400 }, align: 'center',
    }).setOrigin(0.5, 0).setAlpha(0);
    ui.transitionContainer.add(ui.transitionDesc);

    ui.transitionHint = ui.add.text(width / 2, height / 2, '', {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif', fontSize: '13px', color: '#888878',
      stroke: '#000000', strokeThickness: 2,
    }).setOrigin(0.5, 0).setAlpha(0);
    ui.transitionContainer.add(ui.transitionHint);
  }

  /** 播放阶段过渡动画 */
  async play(newStage) {
    const ui = this.ui;
    const { width, height } = ui.cameras.main;
    const stageId = newStage.id;

    // 选择背景图：优先当前章节，无则 fallback 到默认（stageId=1）
    const textureKey = `transition_${stageId}`;
    const fallbackKey = 'transition_1';
    const key = ui.textures.exists(textureKey) ? textureKey : fallbackKey;

    ui.transitionBg.setTexture(key);
    ui.transitionBg.setPosition(width / 2, height / 2);
    ui.transitionBg.setDisplaySize(width, height);

    ui.transitionContainer.setVisible(true);
    ui.transitionContainer.setAlpha(0);
    ui.transitionTitle.setAlpha(0);
    ui.transitionDesc.setAlpha(0);
    ui.transitionHint.setAlpha(0);

    const chapterLabel = getChapterLabel(newStage.chapterId);
    ui.transitionTitle.setText(`${chapterLabel} · ${newStage.name}`);

    // 描述定位：紧跟标题底部 + 间距
    const titleBottom = ui.transitionTitle.y + ui.transitionTitle.height + 12;
    ui.transitionDesc.setText(newStage.description || '');
    ui.transitionDesc.setY(titleBottom);

    // 提示定位：紧跟描述底部 + 间距
    const descBottom = titleBottom + ui.transitionDesc.height + 16;
    ui.transitionHint.setText('');
    ui.transitionHint.setY(descBottom);

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
