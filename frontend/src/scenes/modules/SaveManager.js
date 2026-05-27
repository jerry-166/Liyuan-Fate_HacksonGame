/**
 * 存档/暂停菜单管理器
 * 包含：暂停菜单、存档/加载面板、音量滑块
 * @module scenes/modules/SaveManager
 */

import { getGameState, saveToSlot, getSaveSlots, loadFromSlot, deleteSlot, batchReportNPCPositions } from '../../api/client.js';

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
    ui.pauseMenuVisible = !ui.pauseMenuVisible;
    ui.pauseContainer.setVisible(ui.pauseMenuVisible);
    ui.saveSlotsVisible = false;
    if (ui.saveSlotContainer) ui.saveSlotContainer.setVisible(false);
    const gs = ui.scene.get('GameScene');
    gs.events.emit('input:lock', ui.pauseMenuVisible);
  }

  /** 显示存档/加载面板 */
  showSlots(mode) {
    const ui = this.ui;
    ui.saveMode = mode;
    ui.saveSlotsVisible = true;
    this._renderSlots();
  }

  _renderSlots() {
    const ui = this.ui;
    if (ui.saveSlotContainer) ui.saveSlotContainer.destroy();
    const { width, height } = ui.cameras.main;
    ui.saveSlotContainer = ui.add.container(0, 0).setDepth(701);

    const cx = width / 2;
    const titleText = ui.saveMode === 'save' ? '—— 保存存档 ——' : '—— 加载存档 ——';

    ui.saveSlotContainer.add(ui.add.text(cx, height / 2 - 165, titleText, {
      fontFamily: '"KaiTi","SimSun",serif', fontSize: '16px', color: '#d4b896',
    }).setOrigin(0.5));

    const slots = getSaveSlots();

    if (slots.length === 0) {
      ui.saveSlotContainer.add(ui.add.text(cx, height / 2 - 80,
        ui.saveMode === 'save' ? '点击空槽位保存' : '没有可用存档', {
          fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif', fontSize: '13px', color: '#666655',
        }).setOrigin(0.5));
    }

    const maxShow = ui.saveMode === 'save' ? MAX_SLOTS_DISPLAY : slots.length;
    for (let i = 0; i < maxShow; i++) {
      const slotY = height / 2 - 120 + i * 45;
      const slotId = ui.saveMode === 'save' ? (i + 1) : slots[i]?.id;
      const slot = ui.saveMode === 'save' ? slots.find(s => s.id === i + 1) : slots[i];
      const hasSlot = !!slot;

      const labelBg = ui.add.graphics();
      labelBg.fillStyle(hasSlot ? 0x2a2824 : 0x1a1a25, 0.9);
      labelBg.fillRoundedRect(cx - 180, slotY, 360, 36, 4);
      labelBg.lineStyle(1, hasSlot ? 0xc4a882 : 0x443322, hasSlot ? 0.5 : 0.2);
      labelBg.strokeRoundedRect(cx - 180, slotY, 360, 36, 4);
      ui.saveSlotContainer.add(labelBg);

      const labelText = hasSlot ? `槽位${slot.id} — ${slot.label}` : `槽位 ${i + 1} — 空`;
      ui.saveSlotContainer.add(ui.add.text(cx - 165, slotY + 18, labelText, {
        fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif', fontSize: '12px', color: hasSlot ? '#c0b898' : '#555544',
      }).setOrigin(0, 0.5));

      if (ui.saveMode === 'save') {
        const btn = ui.add.text(cx + 150, slotY + 18, hasSlot ? '覆盖' : '保存', {
          fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif', fontSize: '12px', color: '#d4b896',
          backgroundColor: '#2a2824', padding: { x: 8, y: 3 },
        }).setOrigin(1, 0.5).setInteractive({ useHandCursor: true });
        btn.on('pointerdown', () => ui.onSaveGame(i + 1));
        btn.on('pointerover', () => btn.setColor('#e8dcc8'));
        btn.on('pointerout', () => btn.setColor('#d4b896'));
        ui.saveSlotContainer.add(btn);
      } else if (hasSlot) {
        const loadBtn = ui.add.text(cx + 145, slotY + 18, '读取', {
          fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif', fontSize: '12px', color: '#d4b896',
          backgroundColor: '#2a2824', padding: { x: 8, y: 3 },
        }).setOrigin(1, 0.5).setInteractive({ useHandCursor: true });
        loadBtn.on('pointerdown', () => ui.onLoadGame(slot.id));

        const delBtn = ui.add.text(cx + 90, slotY + 18, '删除', {
          fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif', fontSize: '11px', color: '#886666',
          backgroundColor: '#2a2824', padding: { x: 6, y: 3 },
        }).setOrigin(1, 0.5).setInteractive({ useHandCursor: true });
        delBtn.on('pointerdown', () => { deleteSlot(slot.id); this._renderSlots(); });

        ui.saveSlotContainer.add([loadBtn, delBtn]);
      }
    }

    const backBtn = ui.add.text(cx, height / 2 + 155, '[← 返回]', {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif', fontSize: '13px', color: '#887766',
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    backBtn.on('pointerdown', () => {
      ui.saveSlotsVisible = false;
      if (ui.saveSlotContainer) ui.saveSlotContainer.setVisible(false);
    });
    backBtn.on('pointerover', () => backBtn.setColor('#c4a882'));
    backBtn.on('pointerout', () => backBtn.setColor('#887766'));
    ui.saveSlotContainer.add(backBtn);
  }

  /** 保存存档 */
  async onSave(slotId) {
    const ui = this.ui;
    if (!ui.sessionId) return;
    try {
      // ★ 收集当前所有 NPC 和主角的实时位置
      const gameScene = ui.scene.get('GameScene');
      if (gameScene && gameScene.collectPositions) {
        const positions = gameScene.collectPositions();
        // 异步上报剧情 NPC 位置到后端（不阻塞存档）
        if (positions.storyNpcs.length > 0) {
          batchReportNPCPositions(ui.sessionId, positions.storyNpcs).catch(() => {});
        }
      }

      const state = await getGameState(ui.sessionId);
      state._saved_stage = ui.currentStage;

      // ★ 附加普通 NPC 和主角位置到存档状态
      if (gameScene && gameScene.collectPositions) {
        const positions = gameScene.collectPositions();
        state._town_npc_positions = positions.townNpcs;
        state._player_position = positions.player;
      }

      saveToSlot(ui.sessionId, state, slotId);
      this._showToast('存档成功!');
      this._renderSlots();
    } catch (e) {
      this._showToast('存档失败');
    }
  }

  /** 加载存档 */
  onLoad(slotId) {
    const ui = this.ui;
    const state = loadFromSlot(slotId);
    if (!state) { this._showToast('存档损坏'); return; }

    ui.pauseContainer.setVisible(false);
    ui.pauseMenuVisible = false;
    ui.saveSlotsVisible = false;
    if (ui.saveSlotContainer) ui.saveSlotContainer.setVisible(false);

    if (ui.dialogActive) ui.closeDialog();
    ui.scene.stop('GameScene');
    ui.scene.stop('UIScene');
    ui.time.delayedCall(200, () => {
      ui.scene.start('GameScene', { savedSessionId: slotId });
    });
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
