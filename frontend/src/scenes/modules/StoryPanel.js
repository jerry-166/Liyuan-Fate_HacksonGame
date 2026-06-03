/**
 * 剧本状态面板 — 显示章节大纲 + 任务进度，逐步揭示
 * HUD 按钮打开，滚轮滚动
 * @module scenes/modules/StoryPanel
 */

import { getChapterLabel } from '../../config.js';

export class StoryPanel {
  constructor(uiScene) {
    this.ui = uiScene;
    this._storyData = null;
  }

  createPanel() {
    const ui = this.ui;
    const { width, height } = ui.cameras.main;

    ui._storyPanelUI = ui.add.container(0, 0).setDepth(450).setVisible(false);

    const bg = ui.add.graphics();
    bg.fillStyle(0x0a0a12, 0.93);
    bg.fillRect(0, 0, width, height);
    ui._storyPanelUI.add(bg);

    // 全屏遮罩阻挡点击穿透，点击外部关闭面板
    const clickBlocker = ui.add.rectangle(width / 2, height / 2, width, height, 0x000000, 0)
      .setInteractive({ useHandCursor: false });
    clickBlocker.on('pointerdown', () => this.hide());
    ui._storyPanelUI.add(clickBlocker);

    ui._storyTitle = ui.add.text(width / 2, 24, '—— 剧本纲要 ——', {
      fontFamily: '"KaiTi","SimSun",serif', fontSize: '26px', color: '#d4b896',
    }).setOrigin(0.5, 0);
    ui._storyPanelUI.add(ui._storyTitle);

    ui._storyContent = ui.add.container(0, 60);
    ui._storyPanelUI.add(ui._storyContent);

    const padX = 48, padTop = 60, padBottom = 50;
    const contentH = height - padTop - padBottom;
    const maskGfx = ui.add.graphics();
    maskGfx.fillRect(padX, padTop, width - padX * 2, contentH);
    maskGfx.setVisible(false);
    ui._storyContent.setMask(maskGfx.createGeometryMask());
    ui._storyContentArea = { height: contentH };

    ui._storyPanelUI.add(ui.add.text(width / 2, height - 28, '[ESC / J] 关闭  |  滚轮滚动  |  点击外部关闭', {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif', fontSize: '14px', color: '#666655',
    }).setOrigin(0.5, 0));

    if (this._wheelHandler) ui.input.off('wheel', this._wheelHandler);
    this._wheelHandler = (_p, _go, _dx, deltaY) => {
      if (!ui._storyPanelUI || !ui._storyPanelUI.visible) return;
      const contentHeight = ui._storyContentHeight || 0;
      const maxScroll = Math.max(0, contentHeight - ui._storyContentArea.height);
      if (maxScroll === 0) return;
      ui._storyScrollY = Math.max(-maxScroll, Math.min(0, (ui._storyScrollY || 0) - deltaY * 0.5));
      ui._storyContent.setY(60 + ui._storyScrollY);
    };
    ui.input.on('wheel', this._wheelHandler);
  }

  toggle() {
    const ui = this.ui;
    if (!ui._storyPanelUI) return;
    const visible = !ui._storyPanelUI.visible;
    ui._storyPanelUI.setVisible(visible);
    if (visible) {
      this.refreshContent();
      const gs = ui.scene.get('GameScene');
      if (gs) gs.events.emit('input:lock', true);
    } else {
      const gs = ui.scene.get('GameScene');
      if (gs) gs.events.emit('input:lock', false);
    }
  }

  hide() {
    const ui = this.ui;
    if (ui._storyPanelUI) ui._storyPanelUI.setVisible(false);
    const gs = ui.scene.get('GameScene');
    if (gs) gs.events.emit('input:lock', false);
  }

  async refreshContent() {
    const ui = this.ui;
    if (!ui.sessionId) return;

    try {
      const { getStoryStatus } = await import('../../api/client.js');
      this._storyData = await getStoryStatus(ui.sessionId);

      // ★ 序章阶段：确保序章数据在章节列表中
      const gameScene = ui.scene.get('GameScene');
      if (gameScene && gameScene._isProloguePhase) {
        const chapters = this._storyData.chapters || [];
        const hasPrologue = chapters.some(ch => ch.chapter_id === 'ch_prologue');
        if (!hasPrologue) {
          // API 未返回序章条目，手动插入到列表头部
          chapters.unshift({
            chapter_id: 'ch_prologue',
            name: '归乡',
            description: '从墓地苏醒，回到小镇寻找记忆的线索',
          });
          this._storyData.chapters = chapters;
        }
        // 修正 API 返回的 current_chapter_id（序章阶段应为序章）
        this._storyData.current_chapter_id = 'ch_prologue';
        // 序章未完成，从已完成列表移除
        const completed = this._storyData.completed_chapters || [];
        this._storyData.completed_chapters = completed.filter(id => id !== 'ch_prologue');
        // ★ current_task 保留不动 --- _renderContent() 中通过 ch.chapter_id !== 'ch_prologue' 守卫跳过子任务渲染
      }
    } catch (e) {
      console.warn('[StoryPanel] fetch failed:', e);
    }
    this._renderContent();
  }

  _renderContent() {
    const ui = this.ui;
    if (!ui._storyContent) return;
    ui._storyContent.removeAll(true);
    ui._storyScrollY = 0;
    ui._storyContent.setY(60);

    const { width } = ui.cameras.main;
    const padX = 60;
    const maxW = width - padX * 2;
    let y = 0;

    const data = this._storyData;
    if (!data || !data.chapters || data.chapters.length === 0) {
      const empty = ui.add.text(width / 2, 20, '暂无剧本信息', {
        fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif', fontSize: '18px', color: '#666655',
      }).setOrigin(0.5, 0);
      ui._storyContent.add(empty);
      ui._storyContentHeight = 120;
      return;
    }

    const currentChapterId = data.current_chapter_id;
    const completedSet = new Set(data.completed_chapters || []);

    for (const ch of data.chapters) {
      const isCompleted = completedSet.has(ch.chapter_id);
      const isCurrent = ch.chapter_id === currentChapterId;
      // ★ 只显示已完成和当前章节，未完成的全部隐藏
      const isFuture = !isCompleted && !isCurrent;
      if (isFuture) continue;

      // 分隔线
      if (y > 0) {
        const sep = ui.add.graphics();
        sep.lineStyle(1, 0x443322, 0.3);
        sep.lineBetween(padX, y, width - padX, y);
        ui._storyContent.add(sep);
        y += 10;
      }

      // 已完成 或 当前章节
      const chLabel = getChapterLabel(ch.chapter_id);
      const nameColor = isCompleted ? '#666655' : '#e8dcc8';
      const statusIcon = isCompleted ? '✅' : '📖';
      const titleText = ui.add.text(padX, y, `${statusIcon}  ${chLabel} · ${ch.name}`, {
        fontFamily: '"KaiTi","SimSun",serif', fontSize: '20px', color: nameColor,
        fontStyle: isCurrent ? 'bold' : 'normal',
      });
      ui._storyContent.add(titleText);
      y += titleText.height + 6;

      // 大纲摘要（AI 生成的）
      const outline = ch.outline;
      if (outline) {
        if (outline.summary) {
          const summaryText = ui.add.text(padX + 20, y, outline.summary, {
            fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif', fontSize: '14px',
            color: isCompleted ? '#555544' : '#b8a888',
            wordWrap: { width: maxW - 20, useAdvancedWrap: true }, lineSpacing: 3,
          });
          ui._storyContent.add(summaryText);
          y += summaryText.height + 4;
        }
        if (outline.key_conflict) {
          const conflictText = ui.add.text(padX + 20, y, `⚡ ${outline.key_conflict}`, {
            fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif', fontSize: '13px',
            color: isCompleted ? '#554433' : '#aa8866',
            wordWrap: { width: maxW - 20, useAdvancedWrap: true },
          });
          ui._storyContent.add(conflictText);
          y += conflictText.height + 4;
        }
        if (outline.atmosphere) {
          const atmText = ui.add.text(padX + 20, y, `🎭 ${outline.atmosphere}`, {
            fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif', fontSize: '13px',
            color: '#665544',
          });
          ui._storyContent.add(atmText);
          y += atmText.height + 4;
        }
      } else {
        // 无 AI 大纲，显示章节原始描述
        const descText = ui.add.text(padX + 20, y, ch.description || '', {
          fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif', fontSize: '14px',
          color: isCompleted ? '#555544' : '#a89878',
          wordWrap: { width: maxW - 20, useAdvancedWrap: true }, lineSpacing: 3,
        });
        ui._storyContent.add(descText);
        y += descText.height + 4;
      }

      // 当前章节：显示任务子任务进度（序章无子任务，跳过）
      if (isCurrent && data.current_task && ch.chapter_id !== 'ch_prologue') {
        const task = data.current_task;
        y += 4;
        const taskLabel = ui.add.text(padX + 20, y, '当前任务进度：', {
          fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif', fontSize: '14px', color: '#998866',
        });
        ui._storyContent.add(taskLabel);
        y += taskLabel.height + 4;

        const subTasks = task.sub_tasks || [];
        const statusIcons = { locked: '🔒', active: '⬜', in_progress: '🔄', completed: '✅' };
        for (const st of subTasks) {
          const icon = statusIcons[st.status] || '?';
          const done = st.status === 'completed';
          const stText = ui.add.text(padX + 30, y, `${icon} ${st.title}`, {
            fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif', fontSize: '14px',
            color: done ? '#555544' : '#c8b898',
          });
          ui._storyContent.add(stText);
          y += stText.height + 3;
        }
      }

      y += 12;
    }

    ui._storyContentHeight = y;
  }

  onResize() {
    const ui = this.ui;
    const wasVisible = ui._storyPanelUI?.visible;
    if (ui._storyPanelUI) {
      ui._storyPanelUI.destroy();
      ui._storyPanelUI = null;
    }
    this.createPanel();
    if (wasVisible) {
      ui._storyPanelUI.setVisible(true);
      this._renderContent();
    }
  }
}
