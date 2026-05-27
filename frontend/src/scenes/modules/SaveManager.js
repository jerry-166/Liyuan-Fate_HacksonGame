/**
 * 存档/暂停菜单管理器
 * 包含：暂停菜单、存档/加载面板、音量滑块
 * @module scenes/modules/SaveManager
 */

import { getGameState, getSaves, createSave, loadSave, deleteSave, batchReportNPCPositions } from '../../api/client.js';

const MAX_SLOTS_DISPLAY = 6;

export class SaveManager {
  /**
   * @param {Phaser.Scene} uiScene - UIScene 实例
   */
  constructor(uiScene) {
    this.ui = uiScene;
  }

  /** 创建暂停菜单 UI */
  createPauseMenu() {
    const ui = this.ui;
    const { width, height } = ui.cameras.main;

    ui.pauseContainer = ui.add.container(0, 0).setDepth(700).setVisible(false);

    const overlay = ui.add.graphics();
    overlay.fillStyle(0x000000, 0.6);
    overlay.fillRect(0, 0, width, height);
    overlay.setInteractive(new Phaser.Geom.Rectangle(0, 0, width, height), Phaser.Geom.Rectangle.Contains);
    ui.pauseContainer.add(overlay);

    const cx = width / 2, cy = height / 2;
    const panelH = 370, panelW = 320;

    const panelBg = ui.add.graphics();
    panelBg.fillStyle(0x1a1820, 0.95);
    panelBg.fillRoundedRect(cx - panelW / 2, cy - panelH / 2, panelW, panelH, 10);
    panelBg.lineStyle(1, 0xc4a882, 0.6);
    panelBg.strokeRoundedRect(cx - panelW / 2, cy - panelH / 2, panelW, panelH, 10);
    ui.pauseContainer.add(panelBg);

    ui.pauseContainer.add(ui.add.text(cx, cy - panelH / 2 + 30, '—— 游戏菜单 ——', {
      fontFamily: '"KaiTi","SimSun",serif', fontSize: '18px', color: '#d4b896',
    }).setOrigin(0.5));

    const divider = ui.add.graphics();
    divider.lineStyle(1, 0xc4a882, 0.25);
    divider.lineBetween(cx - 140, cy - panelH / 2 + 52, cx + 140, cy - panelH / 2 + 52);
    ui.pauseContainer.add(divider);

    const btnW = 220, btnH = 36, startY = cy - panelH / 2 + 72, gap = 48;

    const _makeBtn = (label, y, cb) => {
      const bg = ui.add.graphics();
      const drawBtn = (hover) => {
        bg.clear();
        bg.fillStyle(hover ? 0x3a3830 : 0x2a2824, 1);
        bg.fillRoundedRect(cx - btnW / 2, y - btnH / 2, btnW, btnH, 4);
        bg.lineStyle(1, hover ? 0xd4b896 : 0x887766, 0.6);
        bg.strokeRoundedRect(cx - btnW / 2, y - btnH / 2, btnW, btnH, 4);
      };
      drawBtn(false);
      const text = ui.add.text(cx, y, label, {
        fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif', fontSize: '15px', color: '#d0c8b4',
      }).setOrigin(0.5);
      const zone = ui.add.zone(cx, y, btnW, btnH).setInteractive({ useHandCursor: true });
      zone.on('pointerover', () => drawBtn(true));
      zone.on('pointerout', () => drawBtn(false));
      zone.on('pointerdown', cb);
      ui.pauseContainer.add([bg, text, zone]);
    };

    _makeBtn('继续游戏', startY, () => this.togglePause());
    _makeBtn('保存存档', startY + gap, () => this.showSlots('save'));
    _makeBtn('加载存档', startY + gap * 2, () => this.showSlots('load'));

    this._createVolumeSlider(cx, startY + gap * 3, panelW, cy, panelH);
    _makeBtn('返回主菜单', startY + gap * 4, () => ui.onReturnToMenu());

    ui.pauseContainer.add(ui.add.text(cx, cy + panelH / 2 - 20, '[ESC] 关闭 · 点击操作', {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif', fontSize: '11px', color: '#666655',
    }).setOrigin(0.5));
  }

  /** 音乐音量滑动条 */
  _createVolumeSlider(cx, y, panelW, cy, panelH) {
    const ui = this.ui;
    const sliderW = 200, sliderH = 8, knobR = 10, left = cx - sliderW / 2;

    const label = ui.add.text(cx, y - 12, '🎵 音乐音量', {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif', fontSize: '13px', color: '#998866',
    }).setOrigin(0.5);
    ui.pauseContainer.add(label);

    const trackBg = ui.add.graphics();
    trackBg.fillStyle(0x333333, 1);
    trackBg.fillRoundedRect(cx - sliderW / 2, y + 4, sliderW, sliderH, 4);
    ui.pauseContainer.add(trackBg);

    const trackFill = ui.add.graphics();
    const drawTrackFill = (vol) => {
      trackFill.clear();
      trackFill.fillStyle(0xc4a882, 0.8);
      trackFill.fillRoundedRect(cx - sliderW / 2, y + 4, sliderW * vol, sliderH, 4);
    };
    drawTrackFill(ui.musicVolume);
    ui.pauseContainer.add(trackFill);

    const knob = ui.add.graphics();
    const drawKnob = (vol, hover) => {
      knob.clear();
      const kx = left + sliderW * vol;
      knob.fillStyle(hover ? 0xe8d8b8 : 0xd4b896, 1);
      knob.fillCircle(kx, y + 8, knobR);
      knob.lineStyle(1, 0x887766, 0.5);
      knob.strokeCircle(kx, y + 8, knobR);
    };
    drawKnob(ui.musicVolume, false);
    ui.pauseContainer.add(knob);

    // 左右箭头
    const leftArrow = ui.add.text(left - 24, y + 2, '◀', {
      fontSize: '14px', color: '#887766',
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    leftArrow.on('pointerdown', () => {
      const v = Math.max(0, Math.round((ui.musicVolume - 0.1) * 10) / 10);
      this._setVolume(v, drawTrackFill, drawKnob);
    });
    leftArrow.on('pointerover', () => leftArrow.setColor('#d4b896'));
    leftArrow.on('pointerout', () => leftArrow.setColor('#887766'));
    ui.pauseContainer.add(leftArrow);

    const rightArrow = ui.add.text(left + sliderW + 24, y + 2, '▶', {
      fontSize: '14px', color: '#887766',
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    rightArrow.on('pointerdown', () => {
      const v = Math.min(1, Math.round((ui.musicVolume + 0.1) * 10) / 10);
      this._setVolume(v, drawTrackFill, drawKnob);
    });
    rightArrow.on('pointerover', () => rightArrow.setColor('#d4b896'));
    rightArrow.on('pointerout', () => rightArrow.setColor('#887766'));
    ui.pauseContainer.add(rightArrow);

    // 拖拽滑块
    const knobZone = ui.add.zone(cx, y + 8, sliderW + knobR * 2, knobR * 3)
      .setInteractive({ draggable: true, useHandCursor: true });
    ui.pauseContainer.add(knobZone);
    knobZone.on('drag', (_p, dragX) => {
      const rel = Phaser.Math.Clamp(dragX, left, left + sliderW) - left;
      const vol = Math.round((rel / sliderW) * 10) / 10;
      this._setVolume(vol, drawTrackFill, drawKnob);
    });

    // 点击滑轨
    const trackZone = ui.add.zone(cx, y + 8, sliderW, sliderH + 10)
      .setInteractive({ useHandCursor: true });
    ui.pauseContainer.add(trackZone);
    trackZone.on('pointerdown', (pointer) => {
      const rel = Phaser.Math.Clamp(pointer.x, left, left + sliderW) - left;
      const vol = Math.round((rel / sliderW) * 10) / 10;
      this._setVolume(vol, drawTrackFill, drawKnob);
    });
  }

  _setVolume(vol, drawFill, drawKnob) {
    const ui = this.ui;
    ui.musicVolume = vol;
    localStorage.setItem('__music_volume__', String(vol));
    if (drawFill) drawFill(vol);
    if (drawKnob) drawKnob(vol, false);
  }

  /** 切换暂停菜单 */
  togglePause() {
    const ui = this.ui;
    // ★ 如果存档面板正在显示，ESC 只关闭存档面板并恢复暂停菜单
    if (ui.saveSlotsVisible) {
      this._closeSlots();
      return;
    }
    ui.pauseMenuVisible = !ui.pauseMenuVisible;
    ui.pauseContainer.setVisible(ui.pauseMenuVisible);
    ui.saveSlotsVisible = false;
    // ★ 清理残留引用（防止全屏交互遮罩持续阻塞输入）
    if (ui.saveSlotContainer) {
      ui.saveSlotContainer.destroy();
      ui.saveSlotContainer = null;
    }
    const gs = ui.scene.get('GameScene');
    gs.events.emit('input:lock', ui.pauseMenuVisible);
  }

  /** 显示存档/加载面板 */
  async showSlots(mode) {
    const ui = this.ui;
    ui.saveMode = mode;
    ui.saveSlotsVisible = true;
    ui.pauseContainer.setVisible(false); // ★ 隐藏暂停菜单，避免标题重叠
    await this._renderSlots();
  }

  /** 关闭存档面板并恢复暂停菜单 */
  _closeSlots() {
    const ui = this.ui;
    ui.saveSlotsVisible = false;
    if (ui.saveSlotContainer) {
      ui.saveSlotContainer.destroy();
      ui.saveSlotContainer = null;
    }
    ui.pauseContainer.setVisible(true);
  }

  async _renderSlots() {
    const ui = this.ui;
    if (ui.saveSlotContainer) ui.saveSlotContainer.destroy();
    const { width, height } = ui.cameras.main;
    const cx = width / 2;
    const cy = height / 2;

    // ═══ 主容器（初始透明，后面淡入）═══
    ui.saveSlotContainer = ui.add.container(0, 0).setDepth(701).setAlpha(0);

    // ═══ 全屏遮罩（遮挡暂停菜单，点击外部可关闭）═══
    const backdrop = ui.add.graphics();
    backdrop.fillStyle(0x0a0a12, 0.82);
    backdrop.fillRect(0, 0, width, height);
    backdrop.setInteractive(new Phaser.Geom.Rectangle(0, 0, width, height), Phaser.Geom.Rectangle.Contains);
    backdrop.on('pointerdown', (_p, _x, _y, event) => {
      // 阻止事件穿透到下层
      if (event) event.stopPropagation();
    });
    ui.saveSlotContainer.add(backdrop);

    // ═══ 面板常量 ═══
    const panelW = 480;
    const panelH = 430;
    const px = cx - panelW / 2;
    const py = cy - panelH / 2;

    // ═══ 面板背景 + 双层边框 ═══
    const panelBg = ui.add.graphics();
    // 外层阴影
    panelBg.fillStyle(0x000000, 0.3);
    panelBg.fillRoundedRect(px + 4, py + 4, panelW, panelH, 10);
    // 主背景
    panelBg.fillStyle(0x16141c, 0.96);
    panelBg.fillRoundedRect(px, py, panelW, panelH, 10);
    // 外层暖金边框
    panelBg.lineStyle(2, 0x7a6545, 0.9);
    panelBg.strokeRoundedRect(px, py, panelW, panelH, 10);
    // 内层暗金边框
    panelBg.lineStyle(1, 0x3d3528, 1);
    panelBg.strokeRoundedRect(px + 4, py + 4, panelW - 8, panelH - 8, 8);
    ui.saveSlotContainer.add(panelBg);

    // ═══ 标题 ═══
    const isSave = ui.saveMode === 'save';
    const titleStr = isSave ? '📜 保存进度' : '📖 读取进度';
    ui.saveSlotContainer.add(ui.add.text(cx, py + 36, titleStr, {
      fontFamily: '"KaiTi","SimSun",serif', fontSize: '22px', color: '#d4b896',
    }).setOrigin(0.5));

    // ═══ 装饰线 ═══
    const decoLine = ui.add.graphics();
    decoLine.lineStyle(1, 0x6b5a3a, 0.5);
    decoLine.lineBetween(cx - 110, py + 60, cx + 110, py + 60);
    ui.saveSlotContainer.add(decoLine);
    ui.saveSlotContainer.add(ui.add.text(cx, py + 60, '◈', {
      fontSize: '10px', color: '#6b5a3a',
    }).setOrigin(0.5));

    // ═══ 右上角关闭按钮 ═══
    const closeBtn = ui.add.text(px + panelW - 20, py + 20, '✕', {
      fontFamily: '"Microsoft YaHei",sans-serif', fontSize: '18px', color: '#887766',
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    closeBtn.on('pointerdown', () => this._closeSlots());
    closeBtn.on('pointerover', () => closeBtn.setColor('#c4a882'));
    closeBtn.on('pointerout', () => closeBtn.setColor('#887766'));
    ui.saveSlotContainer.add(closeBtn);

    // ═══ 从后端获取存档 ═══
    let savesList = [];
    try {
      const data = await getSaves(ui.sessionId);
      savesList = data.saves || [];
    } catch (e) {
      console.warn('[SaveManager] 获取存档列表失败:', e);
    }

    // ═══ 槽位区域常量 ═══
    const slotH = 50;
    const slotGap = 6;
    const slotW = panelW - 64;
    const slotX = cx - slotW / 2;
    const listTop = py + 82;

    // 空状态提示
    if (savesList.length === 0 && !isSave) {
      ui.saveSlotContainer.add(ui.add.text(cx, cy - 20, '暂无存档', {
        fontFamily: '"KaiTi","SimSun",serif', fontSize: '16px', color: '#554433',
      }).setOrigin(0.5));
    }

    // ═══ 渲染 6 个槽位 ═══
    const slotEntries = []; // 用于 stagger 动画
    for (let i = 0; i < MAX_SLOTS_DISPLAY; i++) {
      const slot = savesList.find(s => s.slot_id === i + 1);
      const hasSlot = !!slot;
      const sy = listTop + i * (slotH + slotGap);

      // ── 槽位背景 ──
      const slotBg = ui.add.graphics();
      if (hasSlot) {
        slotBg.fillStyle(0x1e1c18, 0.95);
        slotBg.fillRoundedRect(slotX, sy, slotW, slotH, 6);
        slotBg.lineStyle(1.5, 0x6b5a3a, 0.7);
        slotBg.strokeRoundedRect(slotX, sy, slotW, slotH, 6);
      } else {
        slotBg.fillStyle(0x16141a, 0.7);
        slotBg.fillRoundedRect(slotX, sy, slotW, slotH, 6);
        slotBg.lineStyle(1, 0x2a2824, 0.5);
        slotBg.strokeRoundedRect(slotX, sy, slotW, slotH, 6);
      }
      ui.saveSlotContainer.add(slotBg);

      // ── 左侧槽位编号（圆角小方块）──
      const numBg = ui.add.graphics();
      numBg.fillStyle(hasSlot ? 0x3d3528 : 0x1e1c1a, 0.9);
      numBg.fillRoundedRect(slotX + 8, sy + 10, 30, 30, 4);
      if (hasSlot) {
        numBg.lineStyle(1, 0x8b7355, 0.5);
        numBg.strokeRoundedRect(slotX + 8, sy + 10, 30, 30, 4);
      }
      ui.saveSlotContainer.add(numBg);

      const numText = ui.add.text(slotX + 23, sy + 25, String(i + 1).padStart(2, '0'), {
        fontFamily: '"KaiTi","SimSun",serif', fontSize: '14px',
        color: hasSlot ? '#c4a882' : '#554433',
      }).setOrigin(0.5);
      ui.saveSlotContainer.add(numText);

      // ── 中间文字信息 ──
      if (hasSlot) {
        // 主标签（阶段+章节）
        const labelText = ui.add.text(slotX + 50, sy + 14, slot.label || `阶段${slot.stage}`, {
          fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif', fontSize: '13px', color: '#d4c8a8',
        });
        ui.saveSlotContainer.add(labelText);

        // 时间戳
        const timeStr = slot.updated_at
          ? slot.updated_at.slice(5, 16).replace('T', ' ')
          : '';
        ui.saveSlotContainer.add(ui.add.text(slotX + 50, sy + 32, timeStr, {
          fontFamily: 'monospace', fontSize: '11px', color: '#665544',
        }));
      } else {
        ui.saveSlotContainer.add(ui.add.text(slotX + 50, sy + 25, '虚位以待', {
          fontFamily: '"KaiTi","SimSun",serif', fontSize: '13px', color: '#3a3530',
        }).setOrigin(0, 0.5));
      }

      // ── 右侧操作按钮 ──
      if (isSave) {
        // 保存/覆盖按钮
        const btnW = 56, btnH = 28;
        const btnX = slotX + slotW - btnW - 12;
        const btnY = sy + (slotH - btnH) / 2;

        const btnBg = ui.add.graphics();
        const drawBtn = (hover) => {
          btnBg.clear();
          const bgc = hover ? 0x4a3f2a : (hasSlot ? 0x3a3528 : 0x2a2520);
          btnBg.fillStyle(bgc, 0.95);
          btnBg.fillRoundedRect(btnX, btnY, btnW, btnH, 4);
          btnBg.lineStyle(1, hover ? 0xc4a882 : 0x6b5a3a, hover ? 0.9 : 0.6);
          btnBg.strokeRoundedRect(btnX, btnY, btnW, btnH, 4);
        };
        drawBtn(false);
        ui.saveSlotContainer.add(btnBg);

        const btnLabel = ui.add.text(btnX + btnW / 2, btnY + btnH / 2, hasSlot ? '覆盖' : '保存', {
          fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif', fontSize: '12px', color: '#c4a882',
        }).setOrigin(0.5);
        ui.saveSlotContainer.add(btnLabel);

        const hitZone = ui.add.zone(btnX + btnW / 2, btnY + btnH / 2, btnW, btnH)
          .setInteractive({ useHandCursor: true });
        hitZone.on('pointerover', () => drawBtn(true));
        hitZone.on('pointerout', () => drawBtn(false));
        hitZone.on('pointerdown', () => ui.onSaveGame(i + 1));
        ui.saveSlotContainer.add(hitZone);

        // 记录用于动画
        slotEntries.push({ bg: slotBg, num: numBg, label: numText });
      } else if (hasSlot) {
        // 读取按钮
        const loadW = 50, loadH = 28;
        const loadX = slotX + slotW - loadW - 12;
        const loadY = sy + (slotH - loadH) / 2;

        const loadBg = ui.add.graphics();
        const drawLoad = (hover) => {
          loadBg.clear();
          loadBg.fillStyle(hover ? 0x4a3f2a : 0x3a3528, 0.95);
          loadBg.fillRoundedRect(loadX, loadY, loadW, loadH, 4);
          loadBg.lineStyle(1, hover ? 0xc4a882 : 0x6b5a3a, hover ? 0.9 : 0.6);
          loadBg.strokeRoundedRect(loadX, loadY, loadW, loadH, 4);
        };
        drawLoad(false);
        ui.saveSlotContainer.add(loadBg);

        const loadLabel = ui.add.text(loadX + loadW / 2, loadY + loadH / 2, '读取', {
          fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif', fontSize: '12px', color: '#c4a882',
        }).setOrigin(0.5);
        ui.saveSlotContainer.add(loadLabel);

        const loadZone = ui.add.zone(loadX + loadW / 2, loadY + loadH / 2, loadW, loadH)
          .setInteractive({ useHandCursor: true });
        loadZone.on('pointerover', () => drawLoad(true));
        loadZone.on('pointerout', () => drawLoad(false));
        loadZone.on('pointerdown', () => ui.onLoadGame(slot.save_id));
        ui.saveSlotContainer.add(loadZone);

        // 删除按钮（小一点，暗红色）
        const delW = 40, delH = 24;
        const delX = loadX - delW - 8;
        const delY = sy + (slotH - delH) / 2;

        const delBg = ui.add.graphics();
        const drawDel = (hover) => {
          delBg.clear();
          delBg.fillStyle(hover ? 0x4a2828 : 0x2a1a1a, 0.9);
          delBg.fillRoundedRect(delX, delY, delW, delH, 3);
          delBg.lineStyle(1, hover ? 0xaa6666 : 0x664444, hover ? 0.8 : 0.4);
          delBg.strokeRoundedRect(delX, delY, delW, delH, 3);
        };
        drawDel(false);
        ui.saveSlotContainer.add(delBg);

        const delLabel = ui.add.text(delX + delW / 2, delY + delH / 2, '删', {
          fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif', fontSize: '11px', color: '#886666',
        }).setOrigin(0.5);
        ui.saveSlotContainer.add(delLabel);

        const delZone = ui.add.zone(delX + delW / 2, delY + delH / 2, delW, delH)
          .setInteractive({ useHandCursor: true });
        delZone.on('pointerover', () => drawDel(true));
        delZone.on('pointerout', () => drawDel(false));
        delZone.on('pointerdown', async () => {
          try { await deleteSave(ui.sessionId, slot.save_id); } catch (e) {}
          await this._renderSlots();
        });
        ui.saveSlotContainer.add(delZone);

        slotEntries.push({ bg: slotBg, num: numBg, label: numText });
      } else {
        slotEntries.push({ bg: slotBg, num: numBg, label: numText });
      }
    }

    // ═══ 底部返回按钮 ═══
    const backY = py + panelH - 36;
    const backBtnBg = ui.add.graphics();
    const drawBack = (hover) => {
      backBtnBg.clear();
      backBtnBg.fillStyle(hover ? 0x3a3528 : 0x000000, 0);
      backBtnBg.fillRoundedRect(cx - 50, backY - 14, 100, 28, 4);
    };
    drawBack(false);
    ui.saveSlotContainer.add(backBtnBg);

    const backBtn = ui.add.text(cx, backY, '◀  返 回', {
      fontFamily: '"KaiTi","SimSun",serif', fontSize: '14px', color: '#887766',
      letterSpacing: 2,
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    backBtn.on('pointerdown', () => this._closeSlots());
    backBtn.on('pointerover', () => { backBtn.setColor('#c4a882'); drawBack(true); });
    backBtn.on('pointerout', () => { backBtn.setColor('#887766'); drawBack(false); });
    ui.saveSlotContainer.add(backBtn);

    // ═══ 底部提示 ═══
    ui.saveSlotContainer.add(ui.add.text(cx, py + panelH - 14, isSave
      ? '点击「保存」将当前进度写入槽位  ·  覆盖会替换已有存档'
      : '点击「读取」恢复该进度  ·  点击「删」永久删除',
      { fontFamily: '"Microsoft YaHei",sans-serif', fontSize: '10px', color: '#554433' }
    ).setOrigin(0.5));

    // ═══ 淡入动画 ═══
    ui.tweens.add({
      targets: ui.saveSlotContainer,
      alpha: 1,
      duration: 200,
      ease: 'Sine.easeOut',
    });
  }

  /** 保存存档 */
  async onSave(slotId) {
    const ui = this.ui;
    if (!ui.sessionId) return;
    try {
      // ★ 收集当前所有 NPC 和主角的实时位置
      const gameScene = ui.scene.get('GameScene');
      let positions = null;
      let playerPos = null, townNpcPos = null;
      if (gameScene && gameScene.collectPositions) {
        positions = gameScene.collectPositions();
        console.log('[SaveManager] collectPositions:', positions);
        // 异步上报剧情 NPC 位置到后端
        if (positions.storyNpcs.length > 0) {
          batchReportNPCPositions(ui.sessionId, positions.storyNpcs).catch(e =>
            console.warn('[SaveManager] batchReportNPCPositions failed:', e));
        }
        playerPos = positions.player;
        townNpcPos = positions.townNpcs;
      } else {
        console.warn('[SaveManager] collectPositions not available on GameScene');
      }

      const state = await getGameState(ui.sessionId);
      state._saved_stage = ui.currentStage;

      // ★ 直接更新 state 中的位置数据
      if (positions) {
        if (state.npcs && Array.isArray(state.npcs)) {
          for (const pos of positions.storyNpcs) {
            const npc = state.npcs.find(n => n.id === pos.npc_id);
            if (npc) npc.position = pos.position;
          }
        }
        state._town_npc_positions = positions.townNpcs;
        state._player_position = positions.player;
      }

      // 调用后端存档 API
      await createSave(ui.sessionId, state, slotId, playerPos, townNpcPos);
      this._showToast('存档成功!');
      await this._renderSlots();
    } catch (e) {
      console.error('[SaveManager] 存档失败:', e);
      this._showToast('存档失败');
    }
  }

  /** 加载存档 — 就地刷新 GameScene，无需重启场景 */
  async onLoad(saveId) {
    const ui = this.ui;
    try {
      const state = await loadSave(ui.sessionId, saveId);
      if (!state) { this._showToast('存档损坏'); return; }

      // ★ 必须销毁存档面板（含全屏遮罩），否则 depth=701 的交互层持续阻塞所有输入
      if (ui.saveSlotContainer) {
        ui.saveSlotContainer.destroy();
        ui.saveSlotContainer = null;
      }
      ui.saveSlotsVisible = false;

      // 关闭暂停菜单
      ui.pauseMenuVisible = false;
      ui.pauseContainer.setVisible(false);

      if (ui.dialogActive) ui.closeDialog();

      // ★ 就地刷新：通过 GameScene 的 state:reload 事件完整恢复所有游戏状态
      const gs = ui.scene.get('GameScene');
      if (gs) {
        gs.events.emit('state:reload', state);
        this._showToast('存档已加载!');
      } else {
        // 降级：GameScene 不在运行中时重启场景（例如从某处错误状态恢复）
        ui.scene.stop('GameScene');
        ui.scene.stop('UIScene');
        ui.time.delayedCall(200, () => {
          ui.scene.start('GameScene', { savedSessionId: ui.sessionId });
        });
      }
    } catch (e) {
      console.error('[SaveManager] 加载存档失败:', e);
      this._showToast('加载失败');
    }
  }

  _showToast(msg) {
    const ui = this.ui;
    const { width, height } = ui.cameras.main;
    const toast = ui.add.text(width / 2, height / 2 + 180, msg, {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif', fontSize: '14px', color: '#d4b896',
      backgroundColor: '#2a2824ee', padding: { x: 16, y: 8 },
    }).setOrigin(0.5).setDepth(705);

    ui.tweens.add({
      targets: toast, alpha: 0, y: toast.y - 20,
      duration: 1800, delay: 600, onComplete: () => toast.destroy(),
    });
  }
}
