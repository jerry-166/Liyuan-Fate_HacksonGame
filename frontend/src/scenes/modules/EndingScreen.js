/**
 * 结局画面管理器 —— 触发结局评价、逐行弹出动画、R 键重新开始
 * @module scenes/modules/EndingScreen
 */

import { evaluateEnding } from '../../api/client.js';

export class EndingScreen {
  /**
   * @param {Phaser.Scene} uiScene - UIScene 实例
   */
  constructor(uiScene) {
    this.ui = uiScene;
  }

  /** 创建结局画面 UI */
  createScreen() {
    const ui = this.ui;
    const { width, height } = ui.cameras.main;

    ui.endingContainer = ui.add.container(0, 0).setDepth(600).setVisible(false);

    const endingBg = ui.add.graphics();
    endingBg.fillStyle(0x0a0a12, 1);
    endingBg.fillRect(0, 0, width, height);
    ui.endingContainer.add(endingBg);

    ui.endingTitle = ui.add.text(width / 2, 100, '', {
      fontFamily: '"KaiTi","SimSun",serif', fontSize: '42px', color: '#d4b896',
    }).setOrigin(0.5);
    ui.endingContainer.add(ui.endingTitle);

    ui.endingSubtitle = ui.add.text(width / 2, 155, '', {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif', fontSize: '18px', color: '#998866',
    }).setOrigin(0.5);
    ui.endingContainer.add(ui.endingSubtitle);

    const divider = ui.add.graphics();
    divider.lineStyle(1, 0xc4a882, 0.4);
    divider.lineBetween(width / 2 - 180, 190, width / 2 + 180, 190);
    ui.endingContainer.add(divider);

    // 可滚动内容区
    const scrollTop = 200;
    const scrollBottom = height - 60;
    ui._endingScrollArea = { top: scrollTop, bottom: scrollBottom, height: scrollBottom - scrollTop };
    ui._endingScrollY = 0;
    ui._endingScrollContentHeight = 0;

    ui.endingScrollContent = ui.add.container(0, scrollTop);
    ui.endingContainer.add(ui.endingScrollContent);

    const scrollMaskGfx = ui.add.graphics();
    scrollMaskGfx.fillRect(0, scrollTop, width, scrollBottom - scrollTop);
    scrollMaskGfx.setVisible(false);
    ui.endingScrollContent.setMask(scrollMaskGfx.createGeometryMask());

    ui.endingKeyMoments = ui.add.text(width / 2, 0, '', {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif', fontSize: '14px', color: '#a89878',
      lineSpacing: 12, align: 'center',
    }).setOrigin(0.5, 0);
    ui.endingScrollContent.add(ui.endingKeyMoments);

    ui.endingLesson = ui.add.text(width / 2, 0, '', {
      fontFamily: '"KaiTi","SimSun",serif', fontSize: '20px', color: '#e8d8b8',
      wordWrap: { width: 500 }, align: 'center', lineSpacing: 8,
    }).setOrigin(0.5, 0);
    ui.endingScrollContent.add(ui.endingLesson);

    ui.endingNPCText = ui.add.text(width / 2, 0, '', {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif', fontSize: '13px', color: '#887766',
      lineSpacing: 8, align: 'center',
    }).setOrigin(0.5, 0);
    ui.endingScrollContent.add(ui.endingNPCText);

    // 滚轮滚动
    if (this._wheelHandler) ui.input.off('wheel', this._wheelHandler);
    this._wheelHandler = (_p, _go, _dx, deltaY) => {
      if (!ui.endingContainer || !ui.endingContainer.visible) return;
      const maxScroll = Math.max(0, ui._endingScrollContentHeight - ui._endingScrollArea.height);
      if (maxScroll === 0) return;
      ui._endingScrollY = Math.max(-maxScroll, Math.min(0, (ui._endingScrollY || 0) - deltaY * 0.5));
      ui.endingScrollContent.setY(ui._endingScrollArea.top + ui._endingScrollY);
    };
    ui.input.on('wheel', this._wheelHandler);

    ui.endingRestart = ui.add.text(width / 2, height - 50, '[ 按 R 键重新开始 ]', {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif', fontSize: '14px', color: '#887766',
    }).setOrigin(0.5).setAlpha(0);
    ui.endingContainer.add(ui.endingRestart);
  }

  /** 触发结局流程 */
  async trigger() {
    const ui = this.ui;
    const { width, height } = ui.cameras.main;

    ui.dialogContainer.setVisible(false);
    const gs = ui.scene.get('GameScene');
    gs.events.emit('input:lock', true);

    // 同时发起 LLM 评价 + 播放过渡动画
    const endingPromise = evaluateEnding(ui.sessionId).catch(e => {
      console.error('结局评价失败:', e);
      return null;
    });

    // "命运的齿轮开始转动..." — 大字+亮色，持续显示直到 LLM 返回
    const fateText = ui.add.text(width / 2, height / 2, '命运的齿轮开始转动……', {
      fontFamily: '"KaiTi","SimSun",serif', fontSize: '48px', color: '#e8e0d0',
      stroke: '#1a1a1a', strokeThickness: 4,
    }).setOrigin(0.5).setDepth(550).setAlpha(0);

    ui.tweens.add({ targets: fateText, alpha: 1, duration: 1500 });
    ui.tweens.add({
      targets: fateText, alpha: 0.5, duration: 1600, yoyo: true, repeat: -1,
      ease: 'Sine.easeInOut', delay: 1500,
    });

    // 等 LLM 结果（动画一直在播）
    const endingData = await endingPromise;

    // LLM 返回了，停止脉动并淡出
    ui.tweens.killTweensOf(fateText);
    ui.tweens.add({ targets: fateText, alpha: 0, duration: 600 });
    await this._wait(700);
    fateText.destroy();

    if (!endingData) return;

    // 设置文本内容
    ui.endingContainer.setVisible(true);
    ui.endingContainer.setAlpha(1);

    ui.endingTitle.setText(endingData.title || '梨园余韵');
    ui.endingSubtitle.setText(
      endingData.type === 'accept_leader' ? '—— 梨园传承线 ——' : '—— 遗憾离别线 ——'
    ).setAlpha(0);

    if (endingData.key_moments && endingData.key_moments.length > 0) {
      ui.endingKeyMoments.setText(endingData.key_moments.map(m => `「${m.description}」`).join('  →  '));
    } else {
      ui.endingKeyMoments.setText('');
    }

    ui.endingLesson.setText(`"${endingData.life_lesson || '戏如人生，人生如戏。'}"`);

    if (endingData.npc_endings && endingData.npc_endings.length > 0) {
      ui.endingNPCText.setText(endingData.npc_endings.map(e => {
        const name = ui._resolveNpcName ? ui._resolveNpcName(e.npc_id) : (e.npc_id || '未知');
        return `◆ ${name}：${e.summary}`;
      }).join('\n'));
    } else {
      ui.endingNPCText.setText('');
    }

    this._layoutScrollContent();

    // 逐段淡入动画
    ui.endingTitle.setAlpha(1);
    ui.endingSubtitle.setAlpha(0);
    ui.endingKeyMoments.setAlpha(0);
    ui.endingLesson.setAlpha(0);
    ui.endingNPCText.setAlpha(0);

    const elements = [ui.endingSubtitle, ui.endingKeyMoments, ui.endingLesson, ui.endingNPCText];
    for (const el of elements) {
      await this._wait(400);
      ui.tweens.add({ targets: el, alpha: 1, duration: 600, ease: 'Sine.easeIn' });
    }

    await this._wait(600);
    ui.tweens.add({ targets: ui.endingRestart, alpha: 1, duration: 800, yoyo: true, repeat: -1 });

    ui.input.keyboard.once('keydown-R', () => {
      ui.endingContainer.setVisible(false);
      ui.scene.get('GameScene').events.emit('game:restart');
    });
  }

  _wait(ms) {
    return new Promise(resolve => this.ui.time.delayedCall(ms, resolve));
  }

  /** 根据 text 实际高度布局滚动内容区 */
  _layoutScrollContent() {
    const ui = this.ui;
    let y = 0;

    if (ui.endingKeyMoments.text) {
      ui.endingKeyMoments.setY(y);
      y += ui.endingKeyMoments.height + 30;
    }

    if (ui.endingLesson.text) {
      ui.endingLesson.setY(y);
      y += ui.endingLesson.height + 36;
    }

    if (ui.endingNPCText.text) {
      ui.endingNPCText.setY(y);
      y += ui.endingNPCText.height + 16;
    }

    ui._endingScrollContentHeight = y;
    ui._endingScrollY = 0;
    ui.endingScrollContent.setY(ui._endingScrollArea.top);
  }

  /** 窗口缩放时重建结局画面并恢复当前状态 */
  onResize() {
    const ui = this.ui;
    const wasVisible = ui.endingContainer && ui.endingContainer.visible;
    const savedAlpha = ui.endingContainer ? ui.endingContainer.alpha : 0;
    const savedTexts = {
      title: ui.endingTitle ? ui.endingTitle.text : '',
      subtitle: ui.endingSubtitle ? ui.endingSubtitle.text : '',
      moments: ui.endingKeyMoments ? ui.endingKeyMoments.text : '',
      lesson: ui.endingLesson ? ui.endingLesson.text : '',
      npc: ui.endingNPCText ? ui.endingNPCText.text : '',
    };

    if (ui.endingContainer) {
      ui.endingContainer.destroy();
      ui.endingContainer = null;
    }

    this.createScreen();

    if (wasVisible) {
      ui.endingContainer.setVisible(true);
      ui.endingContainer.setAlpha(savedAlpha);
      ui.endingTitle.setText(savedTexts.title);
      ui.endingSubtitle.setText(savedTexts.subtitle);
      ui.endingKeyMoments.setText(savedTexts.moments);
      ui.endingLesson.setText(savedTexts.lesson);
      ui.endingNPCText.setText(savedTexts.npc);
      this._layoutScrollContent();
    }
  }
}
