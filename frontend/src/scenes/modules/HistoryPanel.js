/**
 * 历史对话面板管理器 —— 全屏覆盖层，按章节分组显示所有对话记录
 * 支持滚轮滚动、H 键开关
 * @module scenes/modules/HistoryPanel
 */

import { getChapterLabel } from '../../config.js';
import { isMobileDevice } from '../../utils/DeviceDetector.js';

export class HistoryPanel {
  /**
   * @param {Phaser.Scene} uiScene - UIScene 实例
   */
  constructor(uiScene) {
    this.ui = uiScene;
  }

  /** 创建历史对话面板 UI */
  createPanel() {
    const ui = this.ui;
    const { width, height } = ui.cameras.main;

    const padX = 48, padTop = 70, padBottom = 60;
    ui._historyArea = { x: padX, y: padTop, w: width - padX * 2, h: height - padTop - padBottom };

    ui._historyPanelUI = ui.add.container(0, 0).setDepth(400).setVisible(false);

    const bg = ui.add.graphics();
    bg.fillStyle(0x0a0a12, 0.93);
    bg.fillRect(0, 0, width, height);
    // 移动端：点击外部关闭面板
    if (isMobileDevice()) {
      bg.setInteractive(new Phaser.Geom.Rectangle(0, 0, width, height), Phaser.Geom.Rectangle.Contains);
      bg.on('pointerdown', () => this.toggle());
    }
    ui._historyPanelUI.add(bg);

    ui._historyPanelUI.add(ui.add.text(width / 2, 20, '—— 记忆回响 ——', {
      fontFamily: '"KaiTi","SimSun",serif', fontSize: '26px', color: '#d4b896',
    }).setOrigin(0.5, 0));

    ui.historyContent = ui.add.container(0, padTop);
    ui._historyPanelUI.add(ui.historyContent);

    const ha = ui._historyArea;
    const histMaskGfx = ui.add.graphics();
    histMaskGfx.fillRect(ha.x - 4, ha.y - 4, ha.w + 8, ha.h + 8);
    histMaskGfx.setVisible(false);
    ui.historyContent.setMask(histMaskGfx.createGeometryMask());

    ui._historyPanelUI.add(ui.add.text(width / 2, height - 30, isMobileDevice() ? '[H / F] 关闭  |  滚轮滚动  |  点击外部关闭' : '[H / F] 关闭  |  滚轮滚动', {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif', fontSize: '16px', color: '#666655',
    }).setOrigin(0.5, 0));

    if (this._wheelHandler) {
      ui.input.off('wheel', this._wheelHandler);
    }
    this._wheelHandler = (_p, _go, _dx, deltaY) => {
      if (!ui.historyPanelVisible) return;
      const ha = ui._historyArea;
      if (ui.historyContentHeight <= ha.h) return;
      ui.historyScrollY = Math.max(
        Math.min(0, ui.historyScrollY - deltaY * 0.5),
        -(ui.historyContentHeight - ha.h)
      );
      ui.historyContent.setY(ha.y + ui.historyScrollY);
    };
    ui.input.on('wheel', this._wheelHandler);
  }

  /** 窗口缩放时重建历史面板并恢复当前状态 */
  onResize() {
    const ui = this.ui;
    const wasVisible = ui.historyPanelVisible;
    const savedScrollY = ui.historyScrollY || 0;

    if (ui._historyPanelUI) {
      ui._historyPanelUI.destroy();
      ui._historyPanelUI = null;
    }

    this.createPanel();

    if (wasVisible) {
      ui.historyPanelVisible = true;
      ui._historyPanelUI.setVisible(true);
      this.refreshContent();
      ui.historyScrollY = savedScrollY;
      const ha = ui._historyArea;
      ui.historyContent.setY(ha.y + savedScrollY);
    }
  }

  /** 切换面板显隐 */
  toggle() {
    const ui = this.ui;
    ui.historyPanelVisible = !ui.historyPanelVisible;

    if (ui.historyPanelVisible) {
      this.refreshContent();
      ui._historyPanelUI.setVisible(true);
      ui.dialogClickZone.disableInteractive();
      if (ui.freeInput) { ui.freeInput.blur(); ui.freeInput.style.display = 'none'; }
      const gs = ui.scene.get('GameScene');
      if (gs) gs.events.emit('input:lock', true);
    } else {
      ui._historyPanelUI.setVisible(false);
      if (ui.dialogActive && !ui.isStreaming && ui.dialogPages.length > 1 &&
        ui.dialogCurrentPage < ui.dialogPages.length - 1) {
        ui.dialogClickZone.setInteractive({ useHandCursor: true });
      }
      if (ui.dialogActive && !ui.isStreaming && ui.pendingOptions !== null && !ui.pauseMenuVisible) {
        ui.dialogue.showFreeInput();
      }
      if (!ui.dialogActive) {
        const gs = ui.scene.get('GameScene');
        if (gs) gs.events.emit('input:lock', false);
      }
    }
  }

  /** 重建历史记录列表 */
  refreshContent() {
    const ui = this.ui;
    ui.historyContent.removeAll(true);
    const { width } = ui.cameras.main;
    const ha = ui._historyArea;
    const maxW = ha.w - 10;
    let y = 0;

    console.log('[HistoryPanel] refreshContent 开始渲染，总条数:', ui.dialogueHistory.length);

    if (ui.dialogueHistory.length === 0) {
      const empty = ui.add.text(width / 2, 20, '还没有任何对话记录', {
        fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif', fontSize: '18px', color: '#666655',
      }).setOrigin(0.5, 0);
      ui.historyContent.add(empty);
      ui.historyContentHeight = 120;
      return;
    }

    ui.dialogueHistory.forEach((entry, idx) => {
      if (idx === 0 || entry.chapterId !== ui.dialogueHistory[idx - 1].chapterId) {
        const chLabel = getChapterLabel(entry.chapterId);
        const sep = ui.add.text(ha.w / 2, y, `—— ${chLabel} ——`, {
          fontFamily: '"KaiTi","SimSun",serif', fontSize: '18px', color: '#998866',
        }).setOrigin(0.5, 0);
        ui.historyContent.add(sep);
        y += 34;
      }

      // ★ 跳过既没有 NPC 文本也没有玩家文本的空条目
      if (!entry.npcText && !entry.playerText) {
        console.log('[HistoryPanel] 跳过空条目 idx=', idx, 'npcName=', entry.npcName);
        return;
      }

      // NPC 标签：仅在存在 NPC 文本时显示
      if (entry.npcText) {
        const npcLabel = ui.add.text(ha.x, y, `【${entry.npcName}】`, {
          fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif', fontSize: '18px', color: '#d4b896', fontStyle: 'bold',
        });
        ui.historyContent.add(npcLabel);
        y += 26;

        const npcT = ui.add.text(ha.x, y, entry.npcText, {
          fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif', fontSize: '17px', color: '#c0b898',
          wordWrap: { width: maxW, useAdvancedWrap: true }, lineSpacing: 5,
        });
        ui.historyContent.add(npcT);
        y += npcT.height + 12;
      }

      if (entry.playerText) {
        const pl = ui.add.text(ha.x, y, `【你】${entry.playerText}`, {
          fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif', fontSize: '16px', color: '#88aacc',
          wordWrap: { width: maxW, useAdvancedWrap: true },
        });
        ui.historyContent.add(pl);
        y += pl.height + 18;
      }
    });

    ui.historyContentHeight = y;
    ui.historyScrollY = 0;
    ui.historyContent.setY(ha.y);
    console.log('[HistoryPanel] refreshContent 渲染完成，内容高度:', y);
  }
}
