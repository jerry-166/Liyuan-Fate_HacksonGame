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

  createPanel() {
    const ui = this.ui;
    const { width, height } = ui.cameras.main;

    ui._taskPanelUI = ui.add.container(0, 0).setDepth(200).setVisible(false);

    // 半透明背景
    const bg = ui.add.graphics();
    bg.fillStyle(0x0d0d1a, 0.8);
    bg.fillRoundedRect(8, TOP, PANEL_W, PANEL_H, 8);
    bg.lineStyle(1, 0x443322, 0.3);
    bg.strokeRoundedRect(8, TOP, PANEL_W, PANEL_H, 8);
    ui._taskPanelUI.add(bg);

    // 标题
    ui._taskPanelUI.add(ui.add.text(8 + PANEL_W / 2, TOP + 8, '当前任务', {
      fontFamily: '"KaiTi","SimSun",serif', fontSize: '20px', color: '#d4b896',
    }).setOrigin(0.5, 0));

    // 章节名称
    ui._taskChapterName = ui.add.text(20, TOP + 34, '', {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif', fontSize: '14px', color: '#887766',
    }).setOrigin(0, 0);
    ui._taskPanelUI.add(ui._taskChapterName);

    // 进度条区域
    ui._taskProgressBar = ui.add.graphics();
    ui._taskProgressBar.setPosition(20, TOP + 54);
    ui._taskPanelUI.add(ui._taskProgressBar);

    ui._taskProgressText = ui.add.text(8 + PANEL_W - 12, TOP + 66, '', {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif', fontSize: '12px', color: '#887766',
    }).setOrigin(1, 0);
    ui._taskPanelUI.add(ui._taskProgressText);

    // 分隔线
    const sepGfx = ui.add.graphics();
    sepGfx.lineStyle(1, 0x443322, 0.3);
    sepGfx.lineBetween(20, TOP + 78, 8 + PANEL_W - 12, TOP + 78);
    ui._taskPanelUI.add(sepGfx);

    // 滚动内容区域
    const contentTop = TOP + 84;
    const contentH = PANEL_H - 84;
    ui._taskContent = ui.add.container(12, contentTop);
    ui._taskPanelUI.add(ui._taskContent);

    // 裁剪遮罩
    const maskGfx = ui.add.graphics();
    maskGfx.fillRect(12, contentTop, PANEL_W - 16, contentH);
    maskGfx.setVisible(false);
    ui._taskContent.setMask(maskGfx.createGeometryMask());
    ui._taskContentArea = { height: contentH };

    // 滚轮处理
    if (this._wheelHandler) ui.input.off('wheel', this._wheelHandler);
    this._wheelHandler = (_p, _go, _dx, deltaY) => {
      if (!ui._taskPanelUI || !ui._taskPanelUI.visible) return;
      const contentHeight = ui._taskContentHeight || 0;
      const maxScroll = Math.max(0, contentHeight - ui._taskContentArea.height);
      if (maxScroll === 0) return;
      ui._taskScrollY = Math.max(-maxScroll, Math.min(0, (ui._taskScrollY || 0) - deltaY * 0.5));
      ui._taskContent.setY(contentTop + ui._taskScrollY);
    };
    ui.input.on('wheel', this._wheelHandler);
  }

  toggle() {
    const ui = this.ui;
    if (!ui._taskPanelUI) return;
    this._visible = !this._visible;
    ui._taskPanelUI.setVisible(this._visible);
    if (this._visible) this.refreshContent();
  }

  show() {
    const ui = this.ui;
    if (!ui._taskPanelUI) return;
    this._visible = true;
    ui._taskPanelUI.setVisible(true);
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

    try {
      const { getTask } = await import('../../api/client.js');
      const result = await getTask(ui.sessionId);
      this._taskData = result;
      this._renderContent();
    } catch (e) {
      console.warn('[TaskPanel] fetch failed:', e);
      this._renderContent();
    }

    if (!this._visible) this._visible = true;
    ui._taskPanelUI.setVisible(true);
  }

  refreshWithCachedData() {
    this._renderContent();
  }

  _renderContent() {
    const ui = this.ui;
    if (!ui._taskContent) return;
    ui._taskContent.removeAll(true);
    ui._taskScrollY = 0;
    ui._taskContent.setY(TOP + 84);

    const task = this._taskData?.task;
    if (!task) {
      ui._taskChapterName.setText('暂无进行中的任务');
      ui._taskProgressBar.clear();
      ui._taskProgressText.setText('');
      ui._taskContentHeight = 0;
      return;
    }

    ui._taskChapterName.setText(`${getChapterLabel(ui.currentChapterId)} · ${task.chapter_name || ''}`);

    // 进度条
    const progress = task.completion_rate || 0;
    const barW = PANEL_W - 32;
    const barH = 6;
    ui._taskProgressBar.clear();
    ui._taskProgressBar.fillStyle(0x33332a, 0.6);
    ui._taskProgressBar.fillRoundedRect(0, 0, barW, barH, 3);
    if (progress > 0) {
      ui._taskProgressBar.fillStyle(0xd4b896, 0.8);
      ui._taskProgressBar.fillRoundedRect(0, 0, Math.max(barH, barW * progress), barH, 3);
    }
    ui._taskProgressText.setText(`${Math.round(progress * 100)}%`);

    // 子任务列表
    const padX = 0;
    const textW = PANEL_W - 16;
    let y = 0;

    const subTasks = task.sub_tasks || [];
    const statusIcons = { locked: '🔒', active: '⬜', in_progress: '🔄', completed: '✅' };

    for (const st of subTasks) {
      const icon = statusIcons[st.status] || '?';
      const isCompleted = st.status === 'completed';
      const isActive = st.status === 'active' || st.status === 'in_progress';
      const nameColor = isCompleted ? '#666655' : isActive ? '#e8dcc8' : '#555544';

      const row = ui.add.text(padX, y, `${icon} ${st.title}`, {
        fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
        fontSize: '15px', color: nameColor,
        fontStyle: isActive ? 'bold' : 'normal',
        wordWrap: { width: textW, useAdvancedWrap: true },
      });
      ui._taskContent.add(row);
      y += row.height + 3;

      if (st.description) {
        const descColor = isCompleted ? '#555544' : '#887766';
        const desc = ui.add.text(padX + 24, y, st.description, {
          fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
          fontSize: '13px', color: descColor,
          wordWrap: { width: textW - 24, useAdvancedWrap: true }, lineSpacing: 2,
        });
        ui._taskContent.add(desc);
        y += desc.height + 4;
      }

      // NPC 对话轮数提示
      if (st.target_npc_id && st.min_dialogue_rounds > 0 && !isCompleted) {
        const npcName = ui._resolveNpcName(st.target_npc_id);
        const npc = ui.scene.get('GameScene')?.npcs?.find(
          n => n.getData && n.getData('npcId') === st.target_npc_id
        );
        const currentRounds = npc?.getData?.('dialogueRounds') || 0;
        const roundText = ui.add.text(padX + 24, y, `${npcName}对话 ${currentRounds}/${st.min_dialogue_rounds}`, {
          fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif', fontSize: '12px', color: '#665544',
        });
        ui._taskContent.add(roundText);
        y += roundText.height + 4;
      }

      y += 8;
    }

    // NPC 投票状态
    const votes = task.npc_completion_votes || {};
    const voteEntries = Object.entries(votes);
    if (voteEntries.length > 0) {
      y += 6;
      const voteLabel = ui.add.text(padX, y, 'NPC 确认：', {
        fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif', fontSize: '13px', color: '#776655',
      });
      ui._taskContent.add(voteLabel);
      y += voteLabel.height + 3;

      for (const [npcId, voted] of voteEntries) {
        const name = ui._resolveNpcName(npcId);
        const voteIcon = voted ? '✅' : '⬜';
        const voteText = ui.add.text(padX + 14, y, `${voteIcon} ${name}`, {
          fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif', fontSize: '13px',
          color: voted ? '#88aa66' : '#776655',
        });
        ui._taskContent.add(voteText);
        y += voteText.height + 3;
      }
    }

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
