/**
 * 结局画面管理器 — 流式渐进渲染 + 静态回看模式
 * @module scenes/modules/EndingScreen
 */

import { evaluateEndingStream } from '../../api/client.js';

const NPC_LABEL_STAGGER = 300;  // 每个 NPC 结局淡入间隔
const SECTION_STAGGER = 400;    // 各段落淡入间隔

export class EndingScreen {
  /**
   * @param {Phaser.Scene} uiScene - UIScene 实例
   */
  constructor(uiScene) {
    this.ui = uiScene;
  }

  /** 创建结局画面 UI 结构 */
  createScreen() {
    const ui = this.ui;
    const { width, height } = ui.cameras.main;

    ui.endingContainer = ui.add.container(0, 0).setDepth(600).setVisible(false);

    // 全黑背景
    const endingBg = ui.add.graphics();
    endingBg.fillStyle(0x0a0a12, 1);
    endingBg.fillRect(0, 0, width, height);
    ui.endingContainer.add(endingBg);

    // 标题
    ui.endingTitle = ui.add.text(width / 2, 80, '', {
      fontFamily: '"KaiTi","SimSun",serif', fontSize: '42px', color: '#d4b896',
    }).setOrigin(0.5, 0);
    ui.endingContainer.add(ui.endingTitle);

    // 副标题（传承线/离别线）
    ui.endingSubtitle = ui.add.text(width / 2, 140, '', {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif', fontSize: '18px', color: '#998866',
    }).setOrigin(0.5, 0);
    ui.endingContainer.add(ui.endingSubtitle);

    // 分隔线
    const divider = ui.add.graphics();
    divider.lineStyle(1, 0xc4a882, 0.4);
    ui.endingDivider = divider;
    ui.endingContainer.add(divider);

    // 可滚动内容区域
    const scrollTop = 190;
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

    // 关键瞬间
    ui.endingKeyMoments = ui.add.text(width / 2, 0, '', {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif', fontSize: '14px', color: '#a89878',
      lineSpacing: 10, align: 'center', wordWrap: { width: 520 },
    }).setOrigin(0.5, 0).setAlpha(0);
    ui.endingScrollContent.add(ui.endingKeyMoments);

    // 人生感悟
    ui.endingLesson = ui.add.text(width / 2, 0, '', {
      fontFamily: '"KaiTi","SimSun",serif', fontSize: '20px', color: '#e8d8b8',
      wordWrap: { width: 500 }, align: 'center', lineSpacing: 8,
    }).setOrigin(0.5, 0).setAlpha(0);
    ui.endingScrollContent.add(ui.endingLesson);

    // NPC 结局标签
    ui._endingNPClabel = ui.add.text(width / 2, 0, '', {
      fontFamily: '"KaiTi","SimSun",serif', fontSize: '15px', color: '#776655',
    }).setOrigin(0.5, 0).setAlpha(0);
    ui.endingScrollContent.add(ui._endingNPClabel);

    // NPC 结局文本容器（动态追加）
    ui._endingNPCTexts = [];
    ui._endingNPCContainer = ui.add.container(0, 0);
    ui.endingScrollContent.add(ui._endingNPCContainer);

    // 滑滚
    if (this._wheelHandler) ui.input.off('wheel', this._wheelHandler);
    this._wheelHandler = (_p, _go, _dx, deltaY) => {
      if (!ui.endingContainer || !ui.endingContainer.visible) return;
      const maxScroll = Math.max(0, ui._endingScrollContentHeight - ui._endingScrollArea.height);
      if (maxScroll === 0) return;
      ui._endingScrollY = Math.max(-maxScroll, Math.min(0, (ui._endingScrollY || 0) - deltaY * 0.5));
      ui.endingScrollContent.setY(ui._endingScrollArea.top + ui._endingScrollY);
    };
    ui.input.on('wheel', this._wheelHandler);

    // 重新开始提示
    ui.endingRestart = ui.add.text(width / 2, height - 50, '[ 按 R 键重新开始 ]', {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif', fontSize: '14px', color: '#887766',
    }).setOrigin(0.5).setAlpha(0);
    ui.endingContainer.add(ui.endingRestart);
  }

  /** 流式触发结局流程 */
  async trigger() {
    const ui = this.ui;
    const { width, height } = ui.cameras.main;

    ui.dialogContainer.setVisible(false);
    const gs = ui.scene.get('GameScene');
    gs.events.emit('input:lock', true);

    // "命运的齿轮开始转动..."
    const fateText = ui.add.text(width / 2, height / 2, '命运的齿轮开始转动……', {
      fontFamily: '"KaiTi","SimSun",serif', fontSize: '48px', color: '#e8e0d0',
      stroke: '#1a1a1a', strokeThickness: 4,
    }).setOrigin(0.5).setDepth(550).setAlpha(0);

    ui.tweens.add({ targets: fateText, alpha: 1, duration: 1500 });
    ui.tweens.add({
      targets: fateText, alpha: 0.5, duration: 1600, yoyo: true, repeat: -1,
      ease: 'Sine.easeInOut', delay: 1500,
    });

    this._pendingNPCCount = 0;
    this._allNPCsDone = false;

    // 流式消费
    evaluateEndingStream(ui.sessionId, {
      onHeader: (header) => {
        ui.tweens.killTweensOf(fateText);
        ui.tweens.add({ targets: fateText, alpha: 0, duration: 400 });

        this._timeout(500).then(() => {
          fateText.destroy();
          ui.endingContainer.setVisible(true);
          ui.endingContainer.setAlpha(1);

          this._renderHeader(header);
        });
      },

      onNpcEnding: (npc) => {
        this._pendingNPCCount++;
        const delayIndex = this._pendingNPCCount - 1;
        ui.time.delayedCall(delayIndex * NPC_LABEL_STAGGER + 200, () => {
          this._addNPCEnding(npc);
        });
      },

      onDone: () => {
        this._allNPCsDone = true;
        this._timeout(600).then(() => {
          ui.tweens.add({ targets: ui.endingRestart, alpha: 1, duration: 800, yoyo: true, repeat: -1 });
          ui.input.keyboard.once('keydown-R', () => {
            ui.endingContainer.setVisible(false);
            ui.scene.get('GameScene').events.emit('game:restart');
          });
        });
      },

      onError: (err) => {
        console.error('[EndingScreen] evaluate error:', err);
        ui.tweens.killTweensOf(fateText);
        fateText.destroy();
        this._showFallback();
      },
    });
  }

  /** 渲染 header（标题/副标题/关键瞬间/感悟） */
  _renderHeader(header) {
    const ui = this.ui;
    const { width } = ui.cameras.main;

    ui.endingTitle.setText(header.title || '梨园余韵').setAlpha(1);

    const typeLabel = header.type === 'accept_leader' ? '—— 梨园传承线 ——' : '—— 遗憾离别线 ——';
    ui.endingSubtitle.setText(typeLabel).setAlpha(0);

    // 分隔线
    ui.endingDivider.clear();
    ui.endingDivider.lineStyle(1, 0xc4a882, 0.4);
    ui.endingDivider.lineBetween(width / 2 - 180, 170, width / 2 + 180, 170);

    // 清除旧的 NPC 列表
    ui._endingNPCTexts.forEach(t => t.destroy());
    ui._endingNPCTexts = [];
    ui._endingNPCContainer.removeAll(true);
    ui._endingNPClabel.setText('').setAlpha(0);

    // 关键瞬间
    if (header.key_moments && header.key_moments.length > 0) {
      ui.endingKeyMoments.setText(
        header.key_moments.map(m => `「${m.description}」`).join('\n')
      ).setAlpha(0);
    } else {
      ui.endingKeyMoments.setText('').setAlpha(0);
    }

    // 人生感悟
    ui.endingLesson.setText(`"${header.life_lesson || '戏如人生，人生如戏。'}"`).setAlpha(0);

    // 暂存
    ui._endingEvaluatedHeader = header;

    // 逐段淡入
    const elements = [
      { target: ui.endingSubtitle, delay: 0 },
      { target: ui.endingKeyMoments, delay: SECTION_STAGGER },
      { target: ui.endingLesson, delay: SECTION_STAGGER * 2 },
    ];
    for (const el of elements) {
      if (el.target.text) {
        ui.time.delayedCall(el.delay, () => {
          ui.tweens.add({ targets: el.target, alpha: 1, duration: 600, ease: 'Sine.easeIn' });
        });
      }
    }

    this._layoutScrollContent();
  }

  /** 追加一条 NPC 结局 */
  _addNPCEnding(npc) {
    const ui = this.ui;
    const { width } = ui.cameras.main;

    // 在第一个 NPC 到达时显示标签
    if (ui._endingNPCTexts.length === 0) {
      let npcLabelY = 0;
      if (ui.endingLesson.text) {
        npcLabelY = ui.endingLesson.y + ui.endingLesson.height + 28;
      }
      ui._endingNPClabel.setText('—— NPC 结局 ——').setY(npcLabelY).setAlpha(0);
      ui.tweens.add({ targets: ui._endingNPClabel, alpha: 1, duration: 500, ease: 'Sine.easeIn' });
    }

    const name = npc.name || ui._resolveNpcName?.(npc.npc_id) || npc.npc_id || '未知';
    const nameText = ui.add.text(width / 2, 0, `◆ ${name}`, {
      fontFamily: '"KaiTi","SimSun",serif', fontSize: '14px', color: '#c4a882',
    }).setOrigin(0.5, 0).setAlpha(0);
    ui._endingNPCContainer.add(nameText);
    ui._endingNPCTexts.push(nameText);
    ui.tweens.add({ targets: nameText, alpha: 1, duration: 500, ease: 'Sine.easeIn' });

    const summaryText = ui.add.text(width / 2, 0, npc.summary || '', {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif', fontSize: '13px',
      color: '#887766', lineSpacing: 8, align: 'center',
      wordWrap: { width: 480 },
    }).setOrigin(0.5, 0).setAlpha(0);

    ui._endingNPCContainer.add(summaryText);
    ui._endingNPCTexts.push(summaryText);
    ui.tweens.add({ targets: summaryText, alpha: 1, duration: 500, ease: 'Sine.easeIn' });

    this._layoutScrollContent();
  }

  /** 根据内容重新布局滚动区 */
  _layoutScrollContent() {
    const ui = this.ui;
    let y = 0;

    if (ui.endingKeyMoments.text) {
      ui.endingKeyMoments.setY(y);
      y += ui.endingKeyMoments.height + 24;
    }

    if (ui.endingLesson.text) {
      ui.endingLesson.setY(y);
      y += ui.endingLesson.height + 28;
    }

    if (ui._endingNPClabel.text) {
      ui._endingNPClabel.setY(y);
      y += ui._endingNPClabel.height + 14;
    }

    // 排列 NPC 结局文本（name + summary 交替）
    ui._endingNPCContainer.setY(y);
    let npcY = 0;
    for (let i = 0; i < ui._endingNPCTexts.length; i++) {
      const t = ui._endingNPCTexts[i];
      if (!t || !t.active) continue;
      t.setY(npcY);
      npcY += t.height;
      // summary 后多留间距
      if (i % 2 === 1) npcY += 16;
    }
    y += npcY + 16;

    ui._endingScrollContentHeight = y;
    ui._endingScrollY = 0;
    ui.endingScrollContent.setY(ui._endingScrollArea.top);
  }

  /** 兜底：显示默认结局 */
  _showFallback() {
    const ui = this.ui;
    ui.endingContainer.setVisible(true);
    ui.endingContainer.setAlpha(1);
    this._renderHeader({
      title: '梨园余韵',
      summary: '故事告一段落。',
      key_moments: [],
      life_lesson: '戏如人生，人生如戏。',
    });
    for (const nid of Object.keys(ui.scene.get('GameScene')?.npcs || {})) {
      const name = ui._resolveNpcName?.(nid) || nid;
      this._addNPCEnding({ npc_id: nid, name, summary: `${name}的故事还在继续……` });
    }
    ui.tweens.add({ targets: ui.endingRestart, alpha: 1, duration: 800, yoyo: true, repeat: -1 });
    ui.input.keyboard.once('keydown-R', () => {
      ui.endingContainer.setVisible(false);
      ui.scene.get('GameScene').events.emit('game:restart');
    });
  }

  /** 静态展示已生成的结局（用于主菜单回看） */
  showStatic(endingData) {
    const ui = this.ui;
    const { width } = ui.cameras.main;

    ui.endingContainer.setVisible(true);
    ui.endingContainer.setAlpha(1);

    // 清空旧 NPC
    ui._endingNPCTexts.forEach(t => t.destroy());
    ui._endingNPCTexts = [];
    ui._endingNPCContainer.removeAll(true);

    ui.endingTitle.setText(endingData.title || '梨园余韵').setAlpha(1);
    const typeLabel = endingData.type === 'accept_leader' ? '—— 梨园传承线 ——' : '—— 遗憾离别线 ——';
    ui.endingSubtitle.setText(typeLabel).setAlpha(1);

    ui.endingDivider.clear();
    ui.endingDivider.lineStyle(1, 0xc4a882, 0.4);
    ui.endingDivider.lineBetween(width / 2 - 180, 170, width / 2 + 180, 170);

    if (endingData.key_moments && endingData.key_moments.length > 0) {
      ui.endingKeyMoments.setText(
        endingData.key_moments.map(m => `「${m.description}」`).join('\n')
      ).setAlpha(1);
    } else {
      ui.endingKeyMoments.setText('').setAlpha(0);
    }

    ui.endingLesson.setText(`"${endingData.life_lesson || '戏如人生，人生如戏。'}"`).setAlpha(1);

    if (endingData.npc_endings && endingData.npc_endings.length > 0) {
      ui._endingNPClabel.setText('—— NPC 结局 ——').setAlpha(1);
      for (const ne of endingData.npc_endings) {
        const name = ne.name || ui._resolveNpcName?.(ne.npc_id) || ne.npc_id || '未知';
        const nameText = ui.add.text(width / 2, 0, `◆ ${name}`, {
          fontFamily: '"KaiTi","SimSun",serif', fontSize: '14px', color: '#c4a882',
        }).setOrigin(0.5, 0).setAlpha(1);
        ui._endingNPCContainer.add(nameText);
        ui._endingNPCTexts.push(nameText);

        const summaryText = ui.add.text(width / 2, 0, ne.summary || '', {
          fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif', fontSize: '13px',
          color: '#887766', lineSpacing: 8, align: 'center',
          wordWrap: { width: 480 },
        }).setOrigin(0.5, 0).setAlpha(1);
        ui._endingNPCContainer.add(summaryText);
        ui._endingNPCTexts.push(summaryText);
      }
    } else {
      ui._endingNPClabel.setText('').setAlpha(0);
    }

    this._layoutScrollContent();

    // 显示关闭提示
    ui.endingRestart.setText('[ 按 ESC 关闭 ]').setAlpha(0);
    ui.tweens.add({ targets: ui.endingRestart, alpha: 1, duration: 800, yoyo: true, repeat: -1 });

    // ESC 关闭
    const escHandler = (event) => {
      if (event.key === 'Escape') {
        ui.endingContainer.setVisible(false);
        ui.endingRestart.setText('[ 按 R 键重新开始 ]').setAlpha(0);
        ui.input.keyboard.off('keydown', escHandler);
      }
    };
    ui.input.keyboard.on('keydown', escHandler);
  }

  _timeout(ms) {
    return new Promise(resolve => this.ui.time.delayedCall(ms, resolve));
  }

  /** 窗口缩放时重建 */
  onResize() {
    const ui = this.ui;
    const wasVisible = ui.endingContainer && ui.endingContainer.visible;
    const savedAlpha = ui.endingContainer ? ui.endingContainer.alpha : 0;
    const savedTexts = {
      title: ui.endingTitle ? ui.endingTitle.text : '',
      subtitle: ui.endingSubtitle ? ui.endingSubtitle.text : '',
      moments: ui.endingKeyMoments ? ui.endingKeyMoments.text : '',
      lesson: ui.endingLesson ? ui.endingLesson.text : '',
      npclabel: ui._endingNPClabel ? ui._endingNPClabel.text : '',
    };
    // 保存 NPC 为 {name, summary} 对
    const savedNPCs = [];
    for (let i = 0; i < ui._endingNPCTexts.length; i += 2) {
      savedNPCs.push({
        name: ui._endingNPCTexts[i]?.text?.replace(/^◆ /, '') || '',
        summary: ui._endingNPCTexts[i + 1]?.text || '',
      });
    }

    if (ui.endingContainer) {
      ui.endingContainer.destroy();
      ui.endingContainer = null;
    }
    ui._endingNPCTexts = [];

    this.createScreen();

    if (wasVisible) {
      ui.endingContainer.setVisible(true);
      ui.endingContainer.setAlpha(savedAlpha);
      ui.endingTitle.setText(savedTexts.title);
      ui.endingSubtitle.setText(savedTexts.subtitle);
      ui.endingKeyMoments.setText(savedTexts.moments);
      ui.endingLesson.setText(savedTexts.lesson);
      if (savedTexts.npclabel) {
        ui._endingNPClabel.setText(savedTexts.npclabel).setAlpha(1);
      }
      for (const npc of savedNPCs) {
        const nameText = ui.add.text(ui.cameras.main.width / 2, 0, `◆ ${npc.name}`, {
          fontFamily: '"KaiTi","SimSun",serif', fontSize: '14px', color: '#c4a882',
        }).setOrigin(0.5, 0).setAlpha(1);
        ui._endingNPCContainer.add(nameText);
        ui._endingNPCTexts.push(nameText);

        const summaryText = ui.add.text(ui.cameras.main.width / 2, 0, npc.summary, {
          fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif', fontSize: '13px',
          color: '#887766', lineSpacing: 8, align: 'center',
          wordWrap: { width: 480 },
        }).setOrigin(0.5, 0).setAlpha(1);
        ui._endingNPCContainer.add(summaryText);
        ui._endingNPCTexts.push(summaryText);
      }
      this._layoutScrollContent();
    }
  }
}
