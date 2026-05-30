/**
 * 左侧常驻任务面板 — 显示当前章节任务进度
 * 始终可见，滚轮滚动，对话时自动隐藏
 * T 键或点击 HUD 按钮切换显隐
 * @module scenes/modules/TaskPanel
 */

import { getChapterLabel } from '../../config.js';

const PANEL_W = 320;
const PANEL_H = 280;
const TOP = 50;

export class TaskPanel {
  constructor(uiScene) {
    this.ui = uiScene;
    this._taskData = null;
    this._visible = true;
    this._wheelHandler = null;
  }

  /** 创建任务面板 UI（居中浮动面板） */
  createPanel() {
    const ui = this.ui;
    const { width, height } = ui.cameras.main;

    const cx = width / 2;
    const cy = Math.round(height * 0.45); // 略偏上
    this._panelW = Math.min(900, width - 40);
    this._panelH = Math.min(560, height - 60);
    const pLeft = cx - this._panelW / 2;
    const pTop = cy - this._panelH / 2;

    ui._taskPanelUI = ui.add.container(0, 0).setDepth(450).setVisible(false);

    // 半透明全屏暗底
    const dimBg = ui.add.graphics();
    dimBg.fillStyle(0x000000, 0.4);
    dimBg.fillRect(0, 0, width, height);
    ui._taskPanelUI.add(dimBg);

    // 点击遮罩：全屏阻挡穿透 + 面板可操作
    const clickBlocker = ui.add.rectangle(width / 2, height / 2, width, height, 0x000000, 0)
      .setInteractive({ useHandCursor: false });
    ui._taskPanelUI.add(clickBlocker);

    // 面板背景
    const panelBg = ui.add.graphics();
    panelBg.fillStyle(0x1a1820, 0.97);
    panelBg.fillRoundedRect(pLeft, pTop, this._panelW, this._panelH, 10);
    panelBg.lineStyle(1, 0xc4a882, 0.5);
    panelBg.strokeRoundedRect(pLeft, pTop, this._panelW, this._panelH, 10);
    ui._taskPanelUI.add(panelBg);

    ui._taskTitle = ui.add.text(cx, pTop + 16, '—— 当前行务 ——', {
      fontFamily: '"KaiTi","SimSun",serif', fontSize: '22px', color: '#d4b896',
    }).setOrigin(0.5, 0);
    ui._taskPanelUI.add(ui._taskTitle);

    const divider = ui.add.graphics();
    divider.lineStyle(1, 0xc4a882, 0.2);
    divider.lineBetween(pLeft + 40, pTop + 44, cx + this._panelW / 2 - 40, pTop + 44);
    ui._taskPanelUI.add(divider);

    ui._taskChapterName = ui.add.text(cx, pTop + 56, '', {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif', fontSize: '15px', color: '#887766',
    }).setOrigin(0.5, 0);
    ui._taskPanelUI.add(ui._taskChapterName);

    // 内容区域 — 多留一些顶部间距，避免与章节名重叠
    const padX = 32, padTop = 88, padBottom = 36;
    const contentW = this._panelW - padX * 2;
    const contentH = this._panelH - padTop - padBottom;
    this._contentAreaH = contentH;
    this._contentBaseY = pTop + padTop;

    ui._taskContent = ui.add.container(pLeft + padX, pTop + padTop);
    ui._taskPanelUI.add(ui._taskContent);

    // 裁剪遮罩
    const maskGfx = ui.add.graphics();
    maskGfx.fillRect(pLeft, pTop + padTop, this._panelW, contentH);
    maskGfx.setVisible(false);
    ui._taskContent.setMask(maskGfx.createGeometryMask());
    ui._taskContentArea = { height: contentH };

    ui._taskPanelUI.add(ui.add.text(cx, pTop + this._panelH - 24, '[T / ESC] 关闭  |  滚轮滚动', {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif', fontSize: '13px', color: '#666655',
    }).setOrigin(0.5, 0));

    // 滚轮
    if (this._wheelHandler) { ui.input.off('wheel', this._wheelHandler); }
    this._wheelHandler = (_p, _go, _dx, deltaY) => {
      if (!ui._taskPanelUI || !ui._taskPanelUI.visible) return;
      const contentHeight = ui._taskContentHeight || 0;
      const maxScroll = Math.max(0, contentHeight - this._contentAreaH);
      if (maxScroll === 0) return;
      ui._taskScrollY = Math.max(-maxScroll, Math.min(0, (ui._taskScrollY || 0) - deltaY * 0.5));
      ui._taskContent.setY(this._contentBaseY + ui._taskScrollY);
    };
    ui.input.on('wheel', this._wheelHandler);
  }

  toggle() {
    const ui = this.ui;
    if (!ui._taskPanelUI) return;
    this._visible = !this._visible;
    if (this._visible) {
      ui._taskPanelUI.setAlpha(0).setVisible(true);
      this.refreshContent();
    } else {
      ui._taskPanelUI.setVisible(false);
    }
  }

  show() {
    const ui = this.ui;
    if (!ui._taskPanelUI) return;
    this._visible = true;
    ui._taskPanelUI.setAlpha(0).setVisible(true);
    this.refreshContent();
  }

  hide() {
    const ui = this.ui;
    if (!ui._taskPanelUI) return;
    this._visible = false;
    ui._taskPanelUI.setVisible(false);
  }

  async refreshContent() {
    const ui = this.ui;
    if (!ui.sessionId) return;

    // ★ 序章阶段：不调 API（API 返回的是第一章数据），用硬编码序章任务
    // 用 _prologueHintText 判断最可靠，它与序章数据同时设置、离开时同时清除
    const gameScene = ui.scene.get('GameScene');
    const isPrologue = (gameScene && gameScene._isProloguePhase) || ui.currentChapterId === 'ch_prologue' || !!ui._prologueHintText;
    if (isPrologue) {
      console.log('[TaskPanel] 序章模式，跳过 API 直接渲染');
      this._renderContent();
    } else {
      try {
        const { getTask } = await import('../../api/client.js');
        const result = await getTask(ui.sessionId);
        this._taskData = result;
        this._renderContent();
      } catch (e) {
        console.warn('[TaskPanel] fetch failed:', e);
        this._renderContent();
      }
    }

    if (!this._visible) this._visible = true;
    ui._taskPanelUI.setVisible(true);

    // ★ 淡入动画：面板从透明渐显，0→1
    ui._taskPanelUI.setAlpha(0);
    ui.tweens.add({
      targets: ui._taskPanelUI,
      alpha: 1,
      duration: 400,
      ease: 'Sine.easeOut',
    });

    // ★ 同步左侧紧凑提示
    this._syncMiniHint();
  }

  refreshWithCachedData() {
    // ★ 序章守卫：即使 _taskData 为 null 也不走普通渲染
    const ui = this.ui;
    const gameScene = ui.scene.get('GameScene');
    const isPrologue = (gameScene && gameScene._isProloguePhase) || ui.currentChapterId === 'ch_prologue' || !!ui._prologueHintText;
    if (isPrologue) {
      console.log('[TaskPanel] refreshWithCachedData 序章守卫');
      this._renderPrologueTask(ui);
      return;
    }
    this._renderContent();
    this._syncMiniHint();
  }

  /** ★ 同步左侧紧凑任务提示：提取当前活跃子任务标题，写入 UIScene._miniTaskHint */
  _syncMiniHint() {
    const ui = this.ui;
    if (!ui._miniTaskHint) return;

    // ★ 序章阶段有手动覆盖文本（如"离开墓地"）
    if (ui._prologueHintText) {
      ui._miniTaskHint.setText(`📋 ${ui._prologueHintText}`);
      ui._miniTaskHint.setVisible(true);
      return;
    }

    const task = this._taskData?.task;

    if (!task) {
      ui._miniTaskHint.setText('');
      ui._miniTaskHint.setVisible(false);
      return;
    }

    // 找到第一个 active/in_progress 状态的子任务
    const activeSubTask = (task.sub_tasks || []).find(
      s => s.status === 'active' || s.status === 'in_progress'
    );

    if (activeSubTask) {
      ui._miniTaskHint.setText(`📋 ${activeSubTask.title}`);
      ui._miniTaskHint.setVisible(true);
    } else {
      // 无活跃子任务时显示章节名
      const chLabel = getChapterLabel(ui.currentChapterId);
      const chName = task.chapter_name || '';
      ui._miniTaskHint.setText(`📋 ${chLabel} · ${chName}`);
      ui._miniTaskHint.setVisible(true);
    }
  }

  _renderContent() {
    const ui = this.ui;
    if (!ui._taskContent) return;
    ui._taskContent.removeAll(true);
    ui._taskScrollY = 0;
    ui._taskContent.setY(this._contentBaseY || 80);

    // ★★ 序章守卫：强制渲染硬编码序章数据，完全屏蔽 _taskData
    // 三重判断确保不会漏过，最可靠的是 _prologueHintText（与序章数据生命周期完全同步）
    const gameScene = ui.scene.get('GameScene');
    const isPrologue = (gameScene && gameScene._isProloguePhase) || ui.currentChapterId === 'ch_prologue' || !!ui._prologueHintText;
    if (isPrologue) {
      console.log('[TaskPanel] _renderContent 序章守卫触发，渲染序章数据');
      this._renderPrologueTask(ui);
      return;
    }

    const task = this._taskData?.task;
    if (!task) {
      ui._taskChapterName.setText('暂无进行中的任务');
      ui._taskContentHeight = 0;
      ui._taskContent.setY(this._contentBaseY || 80);
      return;
    }

    const chapterName = task.chapter_name || '';
    ui._taskChapterName.setText(`${getChapterLabel(ui.currentChapterId)} · ${chapterName}`);

    const { width } = ui.cameras.main;
    const contentW = (this._panelW || width) - 100;
    const padX = 40;
    let y = 0;

    // 章节描述 — 增大行间距防止换行文字重叠
    if (task.description) {
      const desc = ui.add.text(padX, y, task.description, {
        fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif', fontSize: '16px', color: '#aa9977',
        wordWrap: { width: contentW, useAdvancedWrap: true }, lineSpacing: 8,
      });
      ui._taskContent.add(desc);
      y += desc.height + 30;
    }

    // 进度条 — 百分比标签放在进度条下方，避免与描述重叠
    const progress = task.completion_rate || 0;
    const barW = contentW;
    const barH = 8;
    const barBg = ui.add.graphics();
    barBg.fillStyle(0x33332a, 0.6);
    barBg.fillRoundedRect(padX, y, barW, barH, 4);
    ui._taskContent.add(barBg);
    if (progress > 0) {
      const barFill = ui.add.graphics();
      barFill.fillStyle(0xd4b896, 0.8);
      barFill.fillRoundedRect(padX, y, Math.max(barH, barW * progress), barH, 4);
      ui._taskContent.add(barFill);
    }
    const progressText = ui.add.text(padX + barW, y + barH + 6, `${Math.round(progress * 100)}%`, {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif', fontSize: '12px', color: '#887766',
    }).setOrigin(1, 0.5);
    ui._taskContent.add(progressText);
    y += barH + 28;

    // 子任务列表 — ★ 必须从 y 继续，不能从 0 开始！
    const subPadX = 0;
    const textW = contentW;
    let subY = y;

    const subTasks = task.sub_tasks || [];
    const statusIcons = { locked: '🔒', active: '⬜', in_progress: '🔄', completed: '✅' };

    for (const st of subTasks) {
      const icon = statusIcons[st.status] || '?';
      const isCompleted = st.status === 'completed';
      const isActive = st.status === 'active' || st.status === 'in_progress';
      const nameColor = isCompleted ? '#666655' : isActive ? '#e8dcc8' : '#555544';

      const row = ui.add.text(subPadX, subY, `${icon} ${st.title}`, {
        fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
        fontSize: '15px', color: nameColor,
        fontStyle: isActive ? 'bold' : 'normal',
        wordWrap: { width: textW, useAdvancedWrap: true },
      });
      ui._taskContent.add(row);
      subY += row.height + 8;

      if (st.description) {
        const descColor = isCompleted ? '#555544' : '#887766';
        const desc = ui.add.text(subPadX + 24, subY, st.description, {
          fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
          fontSize: '14px', color: descColor,
          wordWrap: { width: contentW - 28, useAdvancedWrap: true }, lineSpacing: 6,
        });
        ui._taskContent.add(desc);
        subY += desc.height + 8;
      }

      // NPC 对话轮数提示
      if (st.target_npc_id && st.min_dialogue_rounds > 0 && !isCompleted) {
        const npcName = ui._resolveNpcName(st.target_npc_id);
        const npc = ui.scene.get('GameScene')?.npcs?.find(
          n => n.getData && n.getData('npcId') === st.target_npc_id
        );
        const currentRounds = npc?.getData?.('dialogueRounds') || 0;
        const roundText = ui.add.text(subPadX + 24, subY, `${npcName}对话 ${currentRounds}/${st.min_dialogue_rounds}`, {
          fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif', fontSize: '12px', color: '#665544',
        });
        ui._taskContent.add(roundText);
        subY += roundText.height + 8;
      }

      subY += 12;
    }

    // NPC 投票状态
    const votes = task.npc_completion_votes || {};
    const voteEntries = Object.entries(votes);
    if (voteEntries.length > 0) {
      subY += 12;
      const voteLabel = ui.add.text(subPadX, subY, 'NPC 确认：', {
        fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif', fontSize: '13px', color: '#776655',
      });
      ui._taskContent.add(voteLabel);
      subY += voteLabel.height + 8;

      for (const [npcId, voted] of voteEntries) {
        const name = ui._resolveNpcName(npcId);
        const voteIcon = voted ? '✅' : '⬜';
        const voteText = ui.add.text(subPadX + 14, subY, `${voteIcon} ${name}`, {
          fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif', fontSize: '13px',
          color: voted ? '#88aa66' : '#776655',
        });
        ui._taskContent.add(voteText);
        subY += voteText.height + 6;
      }
    }

    ui._taskContentHeight = subY;
  }

  /** ★ 序章专用渲染：硬编码序章任务数据，不受 _taskData 污染 */
  _renderPrologueTask(ui) {
    const { width } = ui.cameras.main;
    const contentW = (this._panelW || width) - 100;
    const padX = 40;
    let y = 0;

    // 章节名
    ui._taskChapterName.setText('序章 · 归乡');

    // 描述
    const desc = ui.add.text(padX, y, '离开墓地，到小镇上去散散心', {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif', fontSize: '16px', color: '#aa9977',
      wordWrap: { width: contentW, useAdvancedWrap: true }, lineSpacing: 8,
    });
    ui._taskContent.add(desc);
    y += desc.height + 30;

    // 进度条
    const barW = contentW, barH = 8;
    const barBg = ui.add.graphics();
    barBg.fillStyle(0x33332a, 0.6);
    barBg.fillRoundedRect(padX, y, barW, barH, 4);
    ui._taskContent.add(barBg);

    const progressText = ui.add.text(padX + barW, y + barH + 6, '0%', {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif', fontSize: '12px', color: '#887766',
    }).setOrigin(1, 0.5);
    ui._taskContent.add(progressText);
    y += barH + 28;

    ui._taskContentHeight = y;
  }

  onResize() {
    const ui = this.ui;
    const wasVisible = ui._taskPanelUI?.visible;
    if (ui._taskPanelUI) {
      ui._taskPanelUI.destroy();
      ui._taskPanelUI = null;
    }
    this.createPanel();
    if (wasVisible) {
      ui._taskPanelUI.setVisible(true);
      this._renderContent();
    } else {
      ui._taskPanelUI.setVisible(false);
    }
  }
}
