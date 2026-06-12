/**
 * 背包面板管理器 —— 左右分栏布局
 * 左侧：物品列表（支持 W/S 导航和滚动）
 * 右侧：物品详情（名称、描述、标签）
 * 支持"展示物品"模式（从 NPC 交互触发）
 * @module scenes/modules/InventoryPanel
 */

export class InventoryPanel {
  /**
   * @param {Phaser.Scene} uiScene - UIScene 实例
   */
  constructor(uiScene) {
    this.ui = uiScene;
  }

  /** 创建背包面板 UI */
  createPanel() {
    const ui = this.ui;
    const { width, height } = ui.cameras.main;

    const panelW = 900, panelH = 560;
    const panelX = (width - panelW) / 2;
    const panelY = (height - panelH) / 2;
    const leftW = 300, rightW = panelW - leftW;
    const titleH = 52, bottomH = 40;
    const sepX = panelX + leftW;

    ui._backpackArea = { x: panelX, y: panelY, w: panelW, h: panelH, leftW, rightW, titleH, bottomH, sepX };

    ui.backpackPanel = ui.add.container(0, 0).setDepth(450).setVisible(false);

    // 遮罩
    const overlay = ui.add.graphics();
    overlay.fillStyle(0x000000, 0.4);
    overlay.fillRect(0, 0, width, height);
    overlay.setInteractive(new Phaser.Geom.Rectangle(0, 0, width, height), Phaser.Geom.Rectangle.Contains);
    overlay.on('pointerdown', (pointer) => {
      const ba = ui._backpackArea;
      // 点击面板内部（含左右分栏）时不关闭，仅点击外部遮罩区域才关闭
      if (pointer.x >= ba.x && pointer.x <= ba.x + ba.w &&
          pointer.y >= ba.y && pointer.y <= ba.y + ba.h) return;
      if (ui.showItemMode) ui.cancelShowItemMode();
      else ui.toggleBackpackPanel();
    });
    ui.backpackPanel.add(overlay);

    // 面板背景
    const bg = ui.add.graphics();
    bg.fillStyle(0x12111a, 0.97);
    bg.fillRoundedRect(panelX, panelY, panelW, panelH, 10);
    bg.lineStyle(2, 0x6b5b3e, 0.8);
    bg.strokeRoundedRect(panelX, panelY, panelW, panelH, 10);
    bg.lineStyle(1, 0x6b5b3e, 0.4);
    bg.lineBetween(panelX + 16, panelY + titleH, panelX + panelW - 16, panelY + titleH);
    bg.lineBetween(sepX, panelY + titleH, sepX, panelY + panelH - bottomH);
    bg.lineBetween(panelX + 16, panelY + panelH - bottomH, panelX + panelW - 16, panelY + panelH - bottomH);
    ui.backpackPanel.add(bg);

    // 标题
    ui.bpTitle = ui.add.text(panelX + panelW / 2, panelY + titleH / 2, '—— 行  囊 ——', {
      fontFamily: '"KaiTi","SimSun",serif', fontSize: '24px', color: '#d4b896',
    }).setOrigin(0.5);
    ui.backpackPanel.add(ui.bpTitle);

    // 左侧标题 — ★ 限制最大宽度，防止文字溢出容器
    ui.backpackPanel.add(ui.add.text(panelX + leftW / 2, panelY + titleH + 16, '道具列表', {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif', fontSize: '17px', color: '#887766',
      wordWrap: { width: leftW - 32, useAdvancedWrap: true },
      align: 'center',
    }).setOrigin(0.5, 0));

    // 右侧标题 — ★ 限制最大宽度
    ui.backpackPanel.add(ui.add.text(sepX + rightW / 2, panelY + titleH + 16, '物品详情', {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif', fontSize: '17px', color: '#887766',
      wordWrap: { width: rightW - 32, useAdvancedWrap: true },
      align: 'center',
    }).setOrigin(0.5, 0));

    // 物品列表容器
    ui.bpListContent = ui.add.container(0, 0);
    ui.backpackPanel.add(ui.bpListContent);

    // 详情区域
    const detailX = sepX + 24;
    const detailY = panelY + titleH + 44;
    const detailW = rightW - 48;

    ui.bpDetailName = ui.add.text(detailX, detailY, '', {
      fontFamily: '"KaiTi","SimSun",serif', fontSize: '24px', color: '#e8dcc8', fontStyle: 'bold',
    });
    ui.backpackPanel.add(ui.bpDetailName);

    ui.bpDetailDesc = ui.add.text(detailX, detailY + 46, '', {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif', fontSize: '19px', color: '#c0b898',
      wordWrap: { width: detailW, useAdvancedWrap: true }, lineSpacing: 6,
    });
    ui.backpackPanel.add(ui.bpDetailDesc);

    ui.bpDetailTags = ui.add.text(detailX, detailY + 160, '', {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif', fontSize: '17px', color: '#aa9977',
    });
    ui.backpackPanel.add(ui.bpDetailTags);

    ui._bpDetailArea = { x: detailX, y: detailY, w: detailW };

    // 底部提示
    ui.bpTipNormal = ui.add.text(panelX + panelW / 2, panelY + panelH - bottomH / 2, '[B] 关闭    [W/S] 上下选择', {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif', fontSize: '16px', color: '#666655',
    }).setOrigin(0.5);
    ui.backpackPanel.add(ui.bpTipNormal);

    // 展示物品模式提示
    ui.bpTipShowItem = ui.add.text(panelX + panelW / 2 - 80, panelY + panelH - bottomH / 2, '[Enter] 展示', {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif', fontSize: '16px', color: '#c4a882',
    }).setOrigin(0.5).setVisible(false);
    ui.backpackPanel.add(ui.bpTipShowItem);

    ui.bpConfirmBtn = ui.add.text(panelX + panelW / 2 + 80, panelY + panelH - bottomH / 2, '[ B ] 取消', {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif', fontSize: '16px', color: '#887766',
    }).setOrigin(0.5).setVisible(false).setInteractive({ useHandCursor: true });
    ui.bpConfirmBtn.on('pointerover', () => ui.bpConfirmBtn.setColor('#d4b896'));
    ui.bpConfirmBtn.on('pointerout', () => ui.bpConfirmBtn.setColor('#887766'));
    ui.bpConfirmBtn.on('pointerdown', () => { if (ui.showItemMode) ui.cancelShowItemMode(); });
    ui.backpackPanel.add(ui.bpConfirmBtn);

    // 右侧「确认展示」按钮
    ui.bpShowItemBtnContainer = ui.add.container(0, 0).setVisible(false);
    const btnX = sepX + 24, btnY2 = panelY + panelH - bottomH - 56;
    const sbw = rightW - 48, sbh = 42;

    const sbBg = ui.add.graphics();
    const drawShowBtn = (hover) => {
      sbBg.clear();
      sbBg.fillStyle(hover ? 0x3a3830 : 0x2a2824, 1);
      sbBg.fillRoundedRect(btnX, btnY2, sbw, sbh, 6);
      sbBg.lineStyle(1, hover ? 0xd4b896 : 0xc4a882, 0.7);
      sbBg.strokeRoundedRect(btnX, btnY2, sbw, sbh, 6);
    };
    drawShowBtn(false);

    const sbText = ui.add.text(btnX + sbw / 2, btnY2 + sbh / 2, '确认展示选中物品', {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif', fontSize: '18px', color: '#d4b896',
    }).setOrigin(0.5);

    const sbZone = ui.add.zone(btnX + sbw / 2, btnY2 + sbh / 2, sbw, sbh).setInteractive({ useHandCursor: true });
    sbZone.on('pointerover', () => drawShowBtn(true));
    sbZone.on('pointerout', () => drawShowBtn(false));
    sbZone.on('pointerdown', () => { if (ui.showItemMode) ui.confirmShowItem(); });

    ui.bpShowItemBtnContainer.add([sbBg, sbText, sbZone]);
    ui.backpackPanel.add(ui.bpShowItemBtnContainer);

    // 左侧列表裁剪遮罩
    const listClipTop = panelY + titleH + 40;
    const listClipH = panelH - titleH - bottomH - 48;
    const listClipGfx = ui.add.graphics();
    listClipGfx.fillRect(panelX, listClipTop, leftW, listClipH);
    listClipGfx.setVisible(false);
    ui.bpListContent.setMask(listClipGfx.createGeometryMask());
    ui.backpackPanel.add(listClipGfx);

    // 滚动条（track + thumb）
    const sbTrackX = panelX + leftW - 14;
    const sbTrackW = 6;
    ui.bpScrollbarTrack = ui.add.graphics();
    ui.bpScrollbarTrack.fillStyle(0x33332a, 0.5);
    ui.bpScrollbarTrack.fillRoundedRect(sbTrackX, listClipTop + 4, sbTrackW, listClipH - 8, 3);
    ui.bpScrollbarTrack.setVisible(false);
    ui.backpackPanel.add(ui.bpScrollbarTrack);

    ui.bpScrollbarThumb = ui.add.graphics();
    ui.bpScrollbarThumb.fillStyle(0x887766, 0.7);
    ui.bpScrollbarThumb.setVisible(false);
    ui.backpackPanel.add(ui.bpScrollbarThumb);

    ui._sbLayout = { trackX: sbTrackX, trackW: sbTrackW, trackTop: listClipTop + 4, trackH: listClipH - 8 };

    // 滚轮滚动
    if (this._wheelHandler) {
      ui.input.off('wheel', this._wheelHandler);
    }
    this._wheelHandler = (_p, _go, _dx, deltaY) => {
      if (!ui.backpackPanelVisible) return;
      const ba = ui._backpackArea;
      if (ui.inventory.length <= 8) return;
      ui.bpListScrollY = Math.max(
        Math.min(0, (ui.bpListScrollY || 0) - deltaY * 0.5),
        -(ui.bpListContentHeight - (ba.h - ba.titleH - 80))
      );
      this._applyListScroll();
    };
    ui.input.on('wheel', this._wheelHandler);
  }

  /** 窗口缩放时重建背包面板并恢复当前状态 */
  onResize() {
    const ui = this.ui;
    const wasVisible = ui.backpackPanelVisible;
    const wasShowItemMode = ui.showItemMode;
    const savedTargetNPC = ui.showItemTargetNPC;
    const savedCursorIndex = ui.backpackCursorIndex;

    if (ui.backpackPanel) {
      ui.backpackPanel.destroy();
      ui.backpackPanel = null;
    }

    this.createPanel();

    if (wasVisible) {
      ui.backpackPanelVisible = true;
      ui.backpackPanel.setVisible(true);
      ui.showItemMode = wasShowItemMode;
      ui.showItemTargetNPC = savedTargetNPC;
      ui.backpackCursorIndex = savedCursorIndex;

      this.refreshContent();
      this.highlightItem();

      if (wasShowItemMode && savedTargetNPC) {
        ui.bpTipNormal.setVisible(false);
        ui.bpTipShowItem.setVisible(true);
        ui.bpConfirmBtn.setVisible(true);
        ui.bpShowItemBtnContainer.setVisible(true);
        ui.bpTitle.setText(`—— 展示物品给 ${savedTargetNPC.name} ——`);
      }
    }
  }

  /** 应用滚动位置：更新列表 Y + 滚动条 */
  _applyListScroll() {
    const ui = this.ui;
    const ba = ui._backpackArea;
    const listY = ba.y + ba.titleH + 44;
    ui.bpListContent.setY(listY + (ui.bpListScrollY || 0));

    // 滚动条
    const needsScrollbar = ui.inventory.length > 8;
    ui.bpScrollbarTrack.setVisible(needsScrollbar);
    ui.bpScrollbarThumb.setVisible(needsScrollbar);
    if (!needsScrollbar) return;

    const sb = ui._sbLayout;
    const maxScroll = Math.max(1, ui.bpListContentHeight - (ba.h - ba.titleH - 80));
    const ratio = Math.min(1, (ba.h - ba.titleH - 80) / ui.bpListContentHeight);
    const thumbH = Math.max(20, sb.trackH * ratio);
    const scrollRatio = Math.min(1, Math.abs(ui.bpListScrollY || 0) / maxScroll);
    const thumbY = sb.trackTop + scrollRatio * (sb.trackH - thumbH);

    ui.bpScrollbarThumb.clear();
    ui.bpScrollbarThumb.fillStyle(0x887766, 0.7);
    ui.bpScrollbarThumb.fillRoundedRect(sb.trackX, thumbY, sb.trackW, thumbH, 3);
  }

  /** 滚动到指定索引，确保选中项可见 */
  scrollToIndex(idx) {
    const ui = this.ui;
    const ba = ui._backpackArea;
    const visibleH = ba.h - ba.titleH - 80;
    const itemH = 52;
    if (ui.bpListContentHeight <= visibleH) return;

    const itemTop = idx * itemH;
    const itemBottom = itemTop + itemH;
    const currentOffset = Math.abs(ui.bpListScrollY || 0);

    if (itemTop < currentOffset) {
      ui.bpListScrollY = -itemTop;
    } else if (itemBottom > currentOffset + visibleH) {
      ui.bpListScrollY = -(itemBottom - visibleH);
    } else {
      return;
    }
    this._applyListScroll();
  }

  /** 刷新物品列表 */
  refreshContent() {
    const ui = this.ui;
    ui.bpListContent.removeAll(true);
    ui.bpListScrollY = 0;

    const ba = ui._backpackArea;
    const listY = ba.y + ba.titleH + 44;
    const itemH = 52;
    let y = 0;

    if (ui.inventory.length === 0) {
      const empty = ui.add.text(ba.leftW / 2, 24, '空空如也', {
        fontFamily: '"KaiTi","SimSun",serif', fontSize: '22px', color: '#555544',
      }).setOrigin(0.5, 0);
      ui.bpListContent.add(empty);
      ui.bpListContentHeight = 70;
      this._applyListScroll();
      this.updateDetail(null);
      return;
    }

    ui.inventory.forEach((item, idx) => {
      const emoji = item.is_key ? '⭐' : '📦';
      const nameColor = item.is_key ? '#e8c86a' : '#c8b898';
      const row = ui.add.container(ba.x + 16, y);

      const selBg = ui.add.graphics();
      selBg.fillStyle(0x3a3228, 0.6);
      selBg.fillRoundedRect(0, 0, ba.leftW - 32, itemH - 4, 5);
      selBg.setVisible(false);
      row.add(selBg);
      row.setData('selBg', selBg);

      row.add(ui.add.text(16, itemH / 2, emoji, { fontSize: '24px' }).setOrigin(0.5));
      row.add(ui.add.text(46, itemH / 2, item.name || item.narrative_name || '未知物品', {
        fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif', fontSize: '19px', color: nameColor,
        wordWrap: { width: ba.leftW - 80, useAdvancedWrap: true },
      }).setOrigin(0, 0.5));

      row.setSize(ba.leftW - 24, itemH - 4);
      row.setInteractive();
      row.on('pointerdown', () => {
        ui.backpackCursorIndex = idx;
        this.highlightItem();
      });

      ui.bpListContent.add(row);
      y += itemH;
    });

    ui.bpListContentHeight = y;
    this._applyListScroll();
    this.highlightItem();
  }

  /** 高亮选中项 + 更新详情 */
  highlightItem() {
    const ui = this.ui;
    if (!ui.bpListContent || ui.inventory.length === 0) return;

    const items = ui.bpListContent.list.filter(c => c.getData('selBg'));
    items.forEach((row, idx) => {
      const bg = row.getData('selBg');
      if (bg) bg.setVisible(idx === ui.backpackCursorIndex);
    });

    this.updateDetail(ui.inventory[ui.backpackCursorIndex]);
  }

  /** 更新右侧详情 */
  updateDetail(item) {
    const ui = this.ui;
    if (!item) {
      ui.bpDetailName.setText('');
      ui.bpDetailDesc.setText('选择一件物品查看详情');
      ui.bpDetailTags.setText('');
      return;
    }
    ui.bpDetailName.setText(item.name || item.narrative_name || '未知物品');
    ui.bpDetailDesc.setText(item.base_description || item.description || item.narrative_desc || '暂无描述');

    // ★ 标签位置跟随描述文字实际高度，避免长描述覆盖标签
    ui.bpDetailTags.setY(ui.bpDetailDesc.y + ui.bpDetailDesc.height + 12);

    let tags = '';
    if (item.is_key) tags += '⭐ 关键道具';
    if (item.related_npcs && item.related_npcs.length > 0) {
      const npcNames = item.related_npcs.map(id => ui._resolveNpcName(id));
      tags += (tags ? '    ' : '') + '👤 关联人物: ' + npcNames.join('、');
    }
    ui.bpDetailTags.setText(tags);
  }

  /** 展示物品模式入口 */
  enterShowItemMode(npcId, npcName) {
    const ui = this.ui;
    ui.showItemMode = true;
    ui.showItemTargetNPC = { id: npcId, name: npcName };

    const gameScene = ui.scene.get('GameScene');
    if (gameScene) {
      gameScene.events.emit('input:lock', true);
      if (gameScene._hideNPCActionButtons) gameScene._hideNPCActionButtons();
    }

    ui.backpackPanelVisible = true;
    ui.backpackCursorIndex = Math.min(ui.backpackCursorIndex, Math.max(0, ui.inventory.length - 1));
    this.refreshContent();
    ui.backpackPanel.setVisible(true);
    this.highlightItem();
    ui.bpTipNormal.setVisible(false);
    ui.bpTipShowItem.setVisible(true);
    ui.bpConfirmBtn.setVisible(true);
    ui.bpShowItemBtnContainer.setVisible(true);
    ui.bpTitle.setText(`—— 展示物品给 ${npcName} ——`);
  }

  /** 取消展示物品模式 */
  cancelShowItemMode() {
    const ui = this.ui;
    if (!ui.showItemMode) return;
    ui.showItemMode = false;
    ui.showItemTargetNPC = null;
    ui.backpackPanelVisible = false;
    ui.backpackPanel.setVisible(false);
    ui.bpTipNormal.setVisible(true);
    ui.bpTipShowItem.setVisible(false);
    ui.bpConfirmBtn.setVisible(false);
    ui.bpShowItemBtnContainer.setVisible(false);
    ui.bpTitle.setText('—— 行  囊 ——');

    const gameScene = ui.scene.get('GameScene');
    if (gameScene) gameScene.events.emit('input:lock', false);
  }
}
