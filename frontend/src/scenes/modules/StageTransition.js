/**
 * 阶段过渡动画管理器 —— 章节切换时的全屏过渡效果
 * 背景配图 + 暗色遮罩 + 淡入 → 显示章节名和描述 → 停留 → 淡出
 * @module scenes/modules/StageTransition
 */

import { STAGE_TONES, CHAPTER_IMAGES, getChapterLabel } from '../../config.js';
import { loadImagesOnDemand, isTextureLoaded } from './GameUIHelpers.js';

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

    // 半透明暗色遮罩（加深以提高文字对比度）
    ui.transitionDim = ui.add.graphics();
    ui.transitionDim.fillStyle(0x000000, 0.58);
    ui.transitionDim.fillRect(0, 0, width, height);
    ui.transitionContainer.add(ui.transitionDim);

    // 章节标题 — 大号醒目
    ui.transitionTitle = ui.add.text(width / 2, height / 2 - 60, '', {
      fontFamily: '"KaiTi","SimSun",serif', fontSize: '48px', color: '#f5dca0',
      stroke: '#000000', strokeThickness: 5,
      shadow: { offsetX: 0, offsetY: 2, color: '#000000aa', blur: 8, fill: true },
    }).setOrigin(0.5, 0).setAlpha(0);
    ui.transitionContainer.add(ui.transitionTitle);

    // 章节描述 — 清晰易读
    ui.transitionDesc = ui.add.text(width / 2, height / 2, '', {
      fontFamily: '"Microsoft YaHei","PingFang SC","SimHei",sans-serif',
      fontSize: '22px', color: '#e0d0b0',
      stroke: '#000000', strokeThickness: 4,
      wordWrap: { width: 500 }, align: 'center',
    }).setOrigin(0.5, 0).setAlpha(0);
    ui.transitionContainer.add(ui.transitionDesc);

    // 点击提示（居中靠下，醒目但不抢眼）
    ui.transitionHint = ui.add.text(width / 2, height - 60, '', {
      fontFamily: '"Microsoft YaHei","PingFang SC","SimHei",sans-serif',
      fontSize: '18px', color: '#c8c0a0',
      stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5).setAlpha(0);
    ui.transitionContainer.add(ui.transitionHint);

    // ★ 全屏透明交互层，用于点击检测
    ui.transitionClickZone = ui.add.zone(width / 2, height / 2, width, height)
      .setInteractive({ useHandCursor: true });
    ui.transitionContainer.add(ui.transitionClickZone);
  }

  /** 播放阶段过渡动画 — 点击全屏任意位置继续
   *  @param {Object} newStage - 阶段数据 { id, chapterId, name, description }
   *  @param {Object} [options]
   *  @param {Promise} [options.readyPromise] - 外部就绪 Promise；点击后等待它再淡出
   */
  async play(newStage, options = {}) {
    const ui = this.ui;
    const { width, height } = ui.cameras.main;
    const stageId = newStage.id;
    const { readyPromise } = options;

    // 选择背景图：优先当前章节，无则 fallback 到默认（stageId=1）
    const textureKey = `transition_${stageId}`;
    const fallbackKey = 'transition_1';
    let key = ui.textures.exists(textureKey) ? textureKey : fallbackKey;

    // ★ 按需加载当前章节过渡图（首次进入该章节时触发）
    if (!ui.textures.exists(textureKey) && CHAPTER_IMAGES[stageId]) {
      try {
        await loadImagesOnDemand(ui, [{ key: textureKey, path: CHAPTER_IMAGES[stageId] }]);
        if (ui.textures.exists(textureKey)) key = textureKey;
      } catch (e) {
        console.warn(`[StageTransition] 按需加载过渡图失败 (${textureKey}):`, e);
      }
    }

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

    // ★ 全屏点击播放模式：显示提示，等待点击
    ui.time.delayedCall(1000, () => {
      ui.transitionHint.setText('—— 点击任意位置继续 ——');
      ui.tweens.add({
        targets: ui.transitionHint, alpha: 1, duration: 500,
        onComplete: () => {
          // 提示文字呼吸效果
          ui.tweens.add({
            targets: ui.transitionHint, alpha: 0.4, duration: 1200,
            yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
          });
        },
      });
    });

    // ★ scene 级全屏 pointerdown 监听，覆盖整个画布
    await new Promise(resolve => {
      const onAnyClick = () => {
        ui.input.off('pointerdown', onAnyClick);
        resolve();
      };
      ui.input.on('pointerdown', onAnyClick);
    });

    // 停掉呼吸动画
    ui.tweens.killTweensOf(ui.transitionHint);
    ui.transitionHint.setAlpha(1);

    // ★ 如果有外部就绪 Promise（如 API 调用未完成），等待它再淡出
    if (readyPromise) {
      ui.transitionHint.setText('—— 正在准备剧情…… ——');
      ui.transitionHint.setAlpha(1);
      try {
        await readyPromise;
      } catch (_) { /* 忽略错误 */ }
    }

    // 快速淡出（300ms），让后续场景切换更流畅
    await this._fadeOut(ui.transitionContainer, 300);

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
