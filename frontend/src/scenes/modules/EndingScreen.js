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

    ui.endingKeyMoments = ui.add.text(width / 2, 260, '', {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif', fontSize: '14px', color: '#a89878',
      lineSpacing: 12, align: 'center',
    }).setOrigin(0.5);
    ui.endingContainer.add(ui.endingKeyMoments);

    ui.endingLesson = ui.add.text(width / 2, height / 2 + 40, '', {
      fontFamily: '"KaiTi","SimSun",serif', fontSize: '20px', color: '#e8d8b8',
      wordWrap: { width: 500 }, align: 'center', lineSpacing: 8,
    }).setOrigin(0.5);
    ui.endingContainer.add(ui.endingLesson);

    ui.endingNPCText = ui.add.text(width / 2, height - 180, '', {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif', fontSize: '13px', color: '#887766',
      lineSpacing: 8, align: 'center',
    }).setOrigin(0.5);
    ui.endingContainer.add(ui.endingNPCText);

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

    // "命运的齿轮开始转动..."
    const fateText = ui.add.text(width / 2, height / 2, '命运的齿轮开始转动……', {
      fontFamily: '"KaiTi","SimSun",serif', fontSize: '24px', color: '#d4b896',
    }).setOrigin(0.5).setDepth(550).setAlpha(0);

    ui.tweens.add({ targets: fateText, alpha: 1, duration: 1200 });
    await this._wait(2000);
    ui.tweens.add({ targets: fateText, alpha: 0, duration: 600 });
    await this._wait(700);
    fateText.destroy();

    let endingData;
    try {
      endingData = await evaluateEnding(ui.sessionId);
    } catch (e) {
      console.error('结局评价失败:', e);
      return;
    }

    ui.endingContainer.setVisible(true);
    ui.endingContainer.setAlpha(0);

    ui.endingTitle.setText(endingData.title);
    ui.endingSubtitle.setText(endingData.type === 'accept_leader' ? '—— 梨园传承线 ——' : '—— 遗憾离别线 ——');

    if (endingData.key_moments && endingData.key_moments.length > 0) {
      ui.endingKeyMoments.setText(endingData.key_moments.map(m => `「${m.description}」`).join('  →  '));
    }

    ui.endingLesson.setText(`"${endingData.life_lesson}"`);

    if (endingData.npc_endings && endingData.npc_endings.length > 0) {
      ui.endingNPCText.setText(endingData.npc_endings.map(e => `◆ ${e.summary}`).join('\n'));
    }

    await this._fadeIn(ui.endingContainer, 1500);

    ui.endingTitle.setAlpha(1);
    ui.endingSubtitle.setAlpha(0);
    ui.endingKeyMoments.setAlpha(0);
    ui.endingLesson.setAlpha(0);
    ui.endingNPCText.setAlpha(0);

    const elements = [ui.endingSubtitle, ui.endingKeyMoments, ui.endingLesson, ui.endingNPCText];
    for (let i = 0; i < elements.length; i++) {
      await this._wait(800);
      ui.tweens.add({ targets: elements[i], alpha: 1, duration: 800, ease: 'Sine.easeIn' });
    }

    await this._wait(1000);
    ui.tweens.add({ targets: ui.endingRestart, alpha: 1, duration: 800, yoyo: true, repeat: -1 });

    ui.input.keyboard.once('keydown-R', () => {
      ui.endingContainer.setVisible(false);
      ui.scene.get('GameScene').events.emit('game:restart');
    });
  }

  _fadeIn(container, duration = 600) {
    return new Promise(resolve => {
      this.ui.tweens.add({ targets: container, alpha: 1, duration, ease: 'Sine.easeIn', onComplete: resolve });
    });
  }

  _wait(ms) {
    return new Promise(resolve => this.ui.time.delayedCall(ms, resolve));
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
    }
  }
}
