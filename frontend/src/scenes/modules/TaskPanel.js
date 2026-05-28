/**
 * 任务面板管理器 — 显示当前章节任务进度
 * 按 T 键或点击 HUD 按钮开关
 * @module scenes/modules/TaskPanel
 */

import { getChapterLabel } from '../../config.js';
export class TaskPanel {
  /**
   * @param {Phaser.Scene} uiScene - UIScene 实例
   */
  constructor(uiScene) {
    this.ui = uiScene;
    this._taskData = null;
  }

  /** 创建任务面板 UI */
  createPanel() {
    const ui = this.ui;
    const { width, height } = ui.cameras.main;

    ui._taskPanelUI = ui.add.container(0, 0).setDepth(450).setVisible(false);

    const bg = ui.add.graphics();
    bg.fillStyle(0x0a0a12, 0.93);
    bg.fillRect(0, 0, width, height);
    ui._taskPanelUI.add(bg);

    ui._taskTitle = ui.add.text(width / 2, 24, '—— 当前行务 ——', {
      fontFamily: '"KaiTi","SimSun",serif', fontSize: '24px', color: '#d4b896',
    }).setOrigin(0.5, 0);
    ui._taskPanelUI.add(ui._taskTitle);

    ui._taskChapterName = ui.add.text(width / 2, 58, '', {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif', fontSize: '16px', color: '#887766',
    }).setOrigin(0.5, 0);
    ui._taskPanelUI.add(ui._taskChapterName);

    ui._taskContent = ui.add.container(0, 80);
    ui._taskPanelUI.add(ui._taskContent);

    // 裁剪遮罩
    const padX = 48, padTop = 80, padBottom = 50;
    const contentH = height - padTop - padBottom;
    const maskGfx = ui.add.graphics();
    maskGfx.fillRect(padX, padTop, width - padX * 2, contentH);
    maskGfx.setVisible(false);
    ui._taskContent.setMask(maskGfx.createGeometryMask());

    ui._taskPanelUI.add(ui.add.text(width / 2, height - 28, '[T] 关闭  |  滚轮滚动', {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif', fontSize: '14px', color: '#666655',
    }).setOrigin(0.5, 0));

    // 滚轮
    if (this._wheelHandler) {
      ui.input.off('wheel', this._wheelHandler);
    }
    this._wheelHandler = (_p, _go, _dx, deltaY) => {
      if (!ui._taskPanelUI || !ui._taskPanelUI.visible) return;
      const contentHeight = ui._taskContentHeight || 0;
      const maxScroll = Math.max(0, contentHeight - contentH);
      if (maxScroll === 0) return;
      ui._taskScrollY = Math.max(-maxScroll, Math.min(0, (ui._taskScrollY || 0) - deltaY * 0.5));
      ui._taskContent.setY(80 + ui._taskScrollY);
    };
    ui.input.on('wheel', this._wheelHandler);
  }

  /** 切换面板显示 */
  toggle() {
    const ui = this.ui;
    if (!ui._taskPanelUI) return;
    const visible = !ui._taskPanelUI.visible;
    ui._taskPanelUI.setVisible(visible);
    if (visible) {
      this.refreshContent();
      const gs = ui.scene.get('GameScene');
      if (gs) gs.events.emit('input:lock', true);
    } else {
      const gs = ui.scene.get('GameScene');
      if (gs) gs.events.emit('input:lock', false);
    }
  }

  /** 隐藏面板 */
  hide() {
    const ui = this.ui;
    if (ui._taskPanelUI) ui._taskPanelUI.setVisible(false);
    const gs = ui.scene.get('GameScene');
    if (gs) gs.events.emit('input:lock', false);
  }

  /** 从 API 拉取任务数据并刷新显示 */
  async refreshContent() {
    const ui = this.ui;
    if (!ui.sessionId) return;

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

  /** 用已有数据刷新显示（不调 API） */
  refreshWithCachedData() {
    this._renderContent();
  }

  /** 渲染任务列表 */
  _renderContent() {
    const ui = this.ui;
    if (!ui._taskContent) return;
    ui._taskContent.removeAll(true);
    ui._taskScrollY = 0;
    ui._taskContent.setY(80);

    const task = this._taskData?.task;
    if (!task) {
      ui._taskChapterName.setText('暂无进行中的任务');
      ui._taskContentHeight = 0;
      return;
    }

    const chapterName = task.chapter_name || '';
    ui._taskChapterName.setText(`${getChapterLabel(ui.currentChapterId)} · ${chapterName}`);

    const { width } = ui.cameras.main;
    const padX = 60;
    let y = 0;

    // 章节描述
    if (task.description) {
      const desc = ui.add.text(padX, y, task.description, {
        fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif', fontSize: '16px', color: '#aa9977',
        wordWrap: { width: width - padX * 2, useAdvancedWrap: true }, lineSpacing: 4,
      });
      ui._taskContent.add(desc);
      y += desc.height + 20;
    }

    // 进度条
    const progress = task.completion_rate || 0;
    const barW = width - padX * 2;
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
    const progressText = ui.add.text(padX + barW, y + barH + 4, `${Math.round(progress * 100)}%`, {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif', fontSize: '13px', color: '#887766',
    }).setOrigin(1, 0);
    ui._taskContent.add(progressText);
    y += barH + 26;

    // 子任务列表
    const subTasks = task.sub_tasks || [];
    const statusIcons = { locked: '🔒', active: '⬜', in_progress: '🔄', completed: '✅' };

    for (const st of subTasks) {
      const icon = statusIcons[st.status] || '?';
      const isCompleted = st.status === 'completed';
      const isActive = st.status === 'active' || st.status === 'in_progress';
      const nameColor = isCompleted ? '#666655' : isActive ? '#e8dcc8' : '#555544';

      const row = ui.add.text(padX, y, `${icon}  ${st.title}`, {
        fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
        fontSize: '18px', color: nameColor,
        fontStyle: isActive ? 'bold' : 'normal',
      });
      ui._taskContent.add(row);
      y += row.height + 4;

      if (st.description) {
        const descColor = isCompleted ? '#555544' : '#887766';
        const desc = ui.add.text(padX + 28, y, st.description, {
          fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
          fontSize: '14px', color: descColor,
          wordWrap: { width: width - padX * 2 - 28, useAdvancedWrap: true }, lineSpacing: 2,
        });
        ui._taskContent.add(desc);
        y += desc.height + 6;
      }

      // NPC 进度提示（对话轮数）
      if (st.target_npc_id && st.min_dialogue_rounds > 0 && !isCompleted) {
        const npcName = ui._resolveNpcName(st.target_npc_id);
        const npc = ui.scene.get('GameScene')?.npcs?.find(
          n => n.getData && n.getData('npcId') === st.target_npc_id
        );
        const currentRounds = npc?.getData?.('dialogueRounds') || 0;
        const roundText = ui.add.text(padX + 28, y, `需与${npcName}对话 ≥ ${st.min_dialogue_rounds} 轮`, {
          fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif', fontSize: '13px', color: '#665544',
        });
        ui._taskContent.add(roundText);
        y += roundText.height + 8;
      }

      y += 8;
    }

    // NPC 投票状态
    const votes = task.npc_completion_votes || {};
    const voteEntries = Object.entries(votes);
    if (voteEntries.length > 0) {
      y += 10;
      const voteLabel = ui.add.text(padX, y, 'NPC 确认状态：', {
        fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif', fontSize: '14px', color: '#776655',
      });
      ui._taskContent.add(voteLabel);
      y += voteLabel.height + 4;

      for (const [npcId, voted] of voteEntries) {
        const name = ui._resolveNpcName(npcId);
        const voteIcon = voted ? '✅' : '⬜';
        const voteText = ui.add.text(padX + 16, y, `${voteIcon} ${name}`, {
          fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif', fontSize: '14px',
          color: voted ? '#88aa66' : '#776655',
        });
        ui._taskContent.add(voteText);
        y += voteText.height + 4;
      }
    }

    ui._taskContentHeight = y;
  }

  /** 窗口缩放时重建 */
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
    }
  }
}
