/**
 * UIScene — UI 覆盖层场景
 *
 * 职责：管理所有游戏 UI，作为各功能模块的协调者
 * - 对话系统（DialogueManager 模块）
 * - 背包面板（InventoryPanel 模块）
 * - 历史对话（HistoryPanel 模块）
 * - 暂停/存档（SaveManager 模块）
 * - 结局画面（EndingScreen 模块）
 * - 阶段过渡（StageTransition 模块）
 *
 * 渲染在 GameScene 之上，通过 Phaser 事件系统与 GameScene 通信
 *
 * @module scenes/UIScene
 */

import Phaser from 'phaser';
import { COLORS, STAGE_TONES, CHAPTER_MAP } from '../config.js';
import {
  startDialogueStream, exitDialogue, startChapter,
  getGameState, saveGameState, getDialogues, batchReportNPCPositions,
} from '../api/client.js';
import { DialogueManager } from './modules/DialogueManager.js';
import { InventoryPanel } from './modules/InventoryPanel.js';
import { HistoryPanel } from './modules/HistoryPanel.js';
import { SaveManager } from './modules/SaveManager.js';
import { EndingScreen } from './modules/EndingScreen.js';
import { StageTransition } from './modules/StageTransition.js';

export class UIScene extends Phaser.Scene {
  constructor() {
    super({ key: 'UIScene' });
  }

  create() {
    // ========== 核心状态 ==========
    this.dialogActive = false;
    this.isStreaming = false;
    this.sessionId = null;
    this.currentNPC = null;
    this.currentStage = 1;
    this.currentChapterId = null;
    this.currentChapterName = null;

    // 分页/选项状态
    this.dialogPages = [];
    this.dialogCurrentPage = 0;
    this.pendingOptions = null;
    this.pendingChapterChange = null;
    this.pendingEnding = false;

    // 历史对话
    this.dialogueHistory = [];

    // 物品/背包
    this.inventory = [];
    this.backpackPanelVisible = false;
    this.backpackCursorIndex = 0;
    this.showItemMode = false;
    this.showItemTargetNPC = null;

    // 暂停/存档
    this.pauseMenuVisible = false;
    this.saveSlotsVisible = false;
    this.saveMode = null;
    this.musicVolume = parseFloat(localStorage.getItem('__music_volume__') || '0.7');

    // ========== 初始化功能模块 ==========
    this.dialogue = new DialogueManager(this);
    this.inventoryPanel = new InventoryPanel(this);
    this.historyPanel = new HistoryPanel(this);
    this.saveManager = new SaveManager(this);
    this.endingScreen = new EndingScreen(this);
    this.stageTransition = new StageTransition(this);

    // ========== 构建 UI ==========
    this.dialogue.createPanel();
    this.dialogue.setupFreeInput();
    this.createHUD();
    this.historyPanel.createPanel();
    this.inventoryPanel.createPanel();
    this.stageTransition.createOverlay();
    this.endingScreen.createScreen();
    this.saveManager.createPauseMenu();

    // ========== 绑定 GameScene 事件 ==========
    const gameScene = this.scene.get('GameScene');
    gameScene.events.on('dialogue:start', this._onDialogueStart, this);
    gameScene.events.on('game:init', this._onGameInit, this);
    gameScene.events.on('stage:change', this._onStageChange, this);
    gameScene.events.on('item:discovered', this._onItemDiscovered, this);
    gameScene.events.on('show-item:select', this._onShowItemSelect, this);

    // ========== 键盘焦点 ==========
    const canvas = this.sys.game.canvas;
    if (canvas) {
      canvas.setAttribute('tabindex', '0');
      canvas.style.outline = 'none';
      canvas.addEventListener('click', () => canvas.focus(), { passive: true });
      setTimeout(() => canvas.focus(), 500);
    }

    // 原生 DOM 键盘监听（ESC 备用方案）
    this._domKeyHandler = (e) => {
      if (e.key === 'Escape' || e.key === 'Esc') {
        e.preventDefault();
        e.stopPropagation();
        this._handleEscPress();
      }
    };
    document.addEventListener('keydown', this._domKeyHandler);

    // 预创建键盘按键
    this.keyF = this.input.keyboard.addKey('F');
    this.key1 = this.input.keyboard.addKey('ONE');
    this.key2 = this.input.keyboard.addKey('TWO');
    this.key3 = this.input.keyboard.addKey('THREE');
    this.key4 = this.input.keyboard.addKey('FOUR');
    this.keyH = this.input.keyboard.addKey('H');
    this.keyB = this.input.keyboard.addKey('B');
    this.keyW = this.input.keyboard.addKey('W');
    this.keyS = this.input.keyboard.addKey('S');
    this.keyESC = this.input.keyboard.addKey('ESC');
    this.keyEnter = this.input.keyboard.addKey('ENTER');
  }

  // =========================== HUD ===========================

  createHUD() {
    const { width } = this.cameras.main;
    this.hudContainer = this.add.container(0, 0).setDepth(200);

    // 左上角标题
    this.add.text(16, 16, '《梨园生死》', {
      fontFamily: '"KaiTi","SimSun",serif', fontSize: '22px', color: '#d4b896',
    }).setDepth(200);

    // 右上角阶段指示器
    this.stageBadge = this.add.text(width - 16, 16, '阶段一 · 不屑', {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
      fontSize: '18px', color: '#c4a882',
      backgroundColor: '#1a1a2ecc', padding: { x: 14, y: 7 },
    }).setOrigin(1, 0);

    // 历史对话按钮
    this.historyBtn = this.add.text(width - 16, 48, '📜 历史 [H]', {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
      fontSize: '16px', color: '#887766',
      backgroundColor: '#1a1a2ecc', padding: { x: 10, y: 5 },
    }).setOrigin(1, 0).setInteractive({ useHandCursor: true });
    this.historyBtn.on('pointerdown', () => this.historyPanel.toggle());
    this.hudContainer.add(this.historyBtn);

    // 背包按钮
    this.backpackBtn = this.add.text(width - 16, 80, '🎒 行囊 [B]', {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
      fontSize: '16px', color: '#c4a882',
      backgroundColor: '#1a1a2ecc', padding: { x: 10, y: 5 },
    }).setOrigin(1, 0).setInteractive({ useHandCursor: true });
    this.backpackBtn.on('pointerover', () => this.backpackBtn.setColor('#e8d4a0'));
    this.backpackBtn.on('pointerout', () => this.backpackBtn.setColor('#c4a882'));
    this.backpackBtn.on('pointerdown', () => {
      if (!this.dialogActive && !this.pauseMenuVisible && !this.historyPanelVisible) {
        this.toggleBackpackPanel();
      }
    });
    this.hudContainer.add(this.backpackBtn);
    this.hudContainer.add(this.stageBadge);
  }

  // =========================== 背包面板（委托给 InventoryPanel）===========================

  toggleBackpackPanel() {
    if (this.dialogActive || this.pauseMenuVisible || this.historyPanelVisible) return;
    this.backpackPanelVisible = !this.backpackPanelVisible;
    if (this.backpackPanelVisible) {
      this.inventoryPanel.refreshContent();
      this.backpackPanel.setVisible(true);
      this.backpackCursorIndex = Math.min(this.backpackCursorIndex, Math.max(0, this.inventory.length - 1));
      this.inventoryPanel.highlightItem();
      const gs = this.scene.get('GameScene');
      if (gs) gs.events.emit('input:lock', true);
    } else {
      this.backpackPanel.setVisible(false);
      const gs = this.scene.get('GameScene');
      if (gs) gs.events.emit('input:lock', false);
    }
  }

  cancelShowItemMode() {
    this.inventoryPanel.cancelShowItemMode();
  }

  confirmShowItem() {
    this.dialogue.confirmShowItem();
  }

  _onItemDiscovered(item) {
    if (!item) return;
    if (this.inventory.some(i => (i.id || i.item_id) === (item.id || item.item_id))) return;
    this.inventory.push(item);
    this._updateBackpackBtnLabel();
    if (this.backpackPanelVisible) this.inventoryPanel.refreshContent();
  }

  _onShowItemSelect({ npcId, npcName }) {
    this.inventoryPanel.enterShowItemMode(npcId, npcName);
  }

  _updateBackpackBtnLabel() {
    if (!this.backpackBtn) return;
    this.backpackBtn.setText(`🎒 行囊 [B] (${this.inventory.length})`);
  }

  // =========================== 对话系统（委托给 DialogueManager）===========================

  async _onDialogueStart({ npcId, name }) {
    if (this.dialogActive || this.isStreaming) return;
    this.dialogActive = true;
    this.isStreaming = true;
    this.currentNPC = { id: npcId, name };

    if (this.historyPanelVisible) this.historyPanel.toggle();

    const gs = this.scene.get('GameScene');
    gs.events.emit('input:lock', true);

    this.dialogContainer.setVisible(true);
    this.dialogName.setText(name);
    this.dialogText.setText('');
    this.dialogHint.setText('对话生成中……');
    this.dialogue.clearOptions();
    this.dialogue.startCursorBlink();

    try {
      const stream = await startDialogueStream(this.sessionId, npcId, null);
      await this.dialogue.processDialogueStream(stream);
    } catch (err) {
      console.error('[UIScene] 对话请求失败:', err);
      this.dialogText.setText(`【${err.message || '网络开小差了，请重试'}】`);
      this.dialogHint.setText('[F] 关闭');
    }
  }

  /** 分页结束 → 显示选项 */
  async finishPagination() {
    this.pageHint.setText('');
    this.dialogClickZone.disableInteractive();

    if (this.pendingChapterChange && this.pendingChapterChange.chapterCompleted) {
      await this._handleChapterComplete();
      return;
    }

    if (!this.pendingEnding) {
      this.dialogue.showOptions(this.pendingOptions);
    }
  }

  /** 关闭对话 */
  closeDialog() {
    this.dialogActive = false;
    this.isStreaming = false;
    this.dialogPages = [];
    this.dialogCurrentPage = 0;
    this.pendingOptions = null;
    this.pendingChapterChange = null;
    this.pendingEnding = false;
    this.pageHint.setText('');
    this.dialogClickZone.disableInteractive();
    this.dialogue.stopCursorBlink();
    this.dialogue.clearOptions();
    this.dialogue.hideFreeInput();
    this.dialogContainer.setVisible(false);

    const gs = this.scene.get('GameScene');
    gs.events.emit('input:lock', false);

    this._persistDialogueHistory();

    if (this.sessionId && this.currentNPC) {
      exitDialogue(this.sessionId, this.currentNPC.id)
        .then(r => console.log('[UIScene] NPC 告别语:', r.dialogue_text))
        .catch(err => console.warn('[UIScene] 退出对话 API 失败:', err.message));
    }
  }

  /** 对话历史记录 */
  addToHistory(npcName, npcText, playerText = null) {
    this.dialogueHistory.push({
      npcName, npcText: npcText || '', playerText: playerText || null,
      stage: this.currentStage,
    });
  }

  // =========================== 章节管理 ============================

  async _handleChapterComplete() {
    this.dialogContainer.setVisible(false);
    this.dialogue.clearOptions();
    this.dialogue.hideFreeInput();

    const gs = this.scene.get('GameScene');
    gs.events.emit('input:lock', false);

    if (!this.sessionId) return;

    try {
      const chapterResult = await startChapter(this.sessionId);

      if (chapterResult.game_ended) {
        this.time.delayedCall(500, () => this.triggerEndingSequence());
        return;
      }

      if (chapterResult.chapter_id) {
        const stageId = CHAPTER_MAP[chapterResult.chapter_id] || this.currentStage + 1;
        const tone = STAGE_TONES[stageId];
        const newStage = {
          id: stageId,
          name: chapterResult.chapter_name || (tone ? tone.name : '未知'),
          description: chapterResult.task ? chapterResult.task.description : '',
          color_tone: chapterResult.color_tone || (tone ? tone.mood : 'cold'),
          bgm_mood: chapterResult.bgm_mood || '',
        };

        this.currentStage = stageId;
        this.currentChapterId = chapterResult.chapter_id;
        this.currentChapterName = chapterResult.chapter_name;
        this.updateStageBadge();

        gs.events.emit('stage:change', newStage);
        gs.events.emit('chapter:new', chapterResult);

        await this.stageTransition.play(newStage);

        if (this.sessionId) {
          // ★ 收集当前所有 NPC 和主角的实时位置
          if (gs && gs.collectPositions) {
            const positions = gs.collectPositions();
            if (positions.storyNpcs.length > 0) {
              batchReportNPCPositions(this.sessionId, positions.storyNpcs).catch(() => {});
            }
          }

          const state = await getGameState(this.sessionId);

          // ★ 附加普通 NPC 和主角位置到自动存档
          if (gs && gs.collectPositions) {
            const positions = gs.collectPositions();
            state._town_npc_positions = positions.townNpcs;
            state._player_position = positions.player;
          }

          gs.events.emit('state:refresh', state);
          saveGameState(this.sessionId, state);
        }

        this.dialogActive = false;
        this.pendingChapterChange = null;
      }
    } catch (e) {
      console.error('[UIScene] 章节推进失败:', e);
      this.dialogActive = false;
      this.pendingChapterChange = null;
    }
  }

  markChapterCompleted(chapterInfo) {
    if (!chapterInfo || !chapterInfo.chapter_id) return;
    const mapped = CHAPTER_MAP[chapterInfo.chapter_id];
    if (mapped && mapped > this.currentStage) this.currentStage = mapped;
  }

  // =========================== 结局（委托给 EndingScreen）===========================

  triggerEndingSequence() {
    this.endingScreen.trigger();
  }

  // =========================== 存档/暂停（委托给 SaveManager）===========================

  togglePauseMenu() {
    this.saveManager.togglePause();
  }

  async onSaveGame(slotId) {
    await this.saveManager.onSave(slotId);
  }

  onLoadGame(slotId) {
    this.saveManager.onLoad(slotId);
  }

  showSaveLoadPanel(mode) {
    this.saveManager.showSlots(mode);
  }

  onReturnToMenu() {
    this.pauseContainer.setVisible(false);
    this.pauseMenuVisible = false;
    if (this.saveSlotContainer) this.saveSlotContainer.destroy();
    this.saveSlotsVisible = false;

    const gs = this.scene.get('GameScene');
    gs.events.emit('input:lock', false);
    if (this.sessionId) localStorage.setItem('__active_session__', this.sessionId);

    this.scene.stop('GameScene');
    this.scene.stop('UIScene');
    this.scene.start('MenuScene');
  }

  // =========================== 游戏初始化回调 ============================

  _onGameInit(data) {
    this.sessionId = data.sessionId;
    this.currentStage = data.stage || 1;
    this.currentChapterId = data.chapterId || null;
    this.currentChapterName = data.chapterName || null;
    this.inventory = data.inventory || [];
    this.updateStageBadge();
    this._updateBackpackBtnLabel();
    this.inventoryPanel.refreshContent();

    if (this.sessionId) this._restoreDialogueHistory(this.sessionId);
  }

  _onStageChange(newStage) {
    this.currentStage = newStage.id;
    this.updateStageBadge();
    if (this.sessionId) {
      getGameState(this.sessionId)
        .then(state => this.scene.get('GameScene').events.emit('state:refresh', state))
        .catch(() => {});
    }
  }

  updateStageBadge() {
    const tone = STAGE_TONES[this.currentStage];
    if (tone) {
      const label = this.currentChapterName || tone.name;
      this.stageBadge.setText(`第${this.currentStage}章 · ${label}`);
      const tintColors = {
        cold: '#8899cc', warm: '#ccaa77', dramatic: '#cc8866', melancholy: '#8899aa', somber: '#998877'
      };
      this.stageBadge.setColor(tintColors[tone.mood] || '#c4a882');
    }
  }

  // =========================== 对话历史恢复 ============================

  async _restoreDialogueHistory(sessionId) {
    try {
      const result = await getDialogues(sessionId);
      if (!result || !result.items || result.items.length === 0) {
        this._tryRestoreHistoryFromCache(sessionId);
        return;
      }
      result.items.sort((a, b) => (a.id || 0) - (b.id || 0));
      let lastName = null;
      let pendingNpcText = '';
      result.items.forEach((entry) => {
        const cleanContent = this._extractText(entry.content);
        if (entry.role === 'npc') {
          if (pendingNpcText) this.addToHistory(lastName, pendingNpcText);
          pendingNpcText = cleanContent || '';
          lastName = this._resolveNpcName(entry.npc_id);
        } else if (entry.role === 'player') {
          if (pendingNpcText) { this.addToHistory(lastName, pendingNpcText); pendingNpcText = ''; }
          this.addToHistory(lastName || 'NPC', null, cleanContent);
        }
      });
      if (pendingNpcText) this.addToHistory(lastName, pendingNpcText);
      try { localStorage.setItem(`__dialogue_history_${sessionId}`, JSON.stringify(this.dialogueHistory)); } catch (e) { /* */ }
    } catch (e) {
      this._tryRestoreHistoryFromCache(sessionId);
    }
  }

  _extractText(content) {
    if (!content) return '';
    if (typeof content !== 'string') {
      if (content.dialogue_text) return content.dialogue_text;
      if (content.text) return content.text;
      if (content.content) return this._extractText(content.content);
      return JSON.stringify(content);
    }
    const trimmed = content.trim();
    if ((trimmed.startsWith('{') || trimmed.startsWith('[')) && (trimmed.endsWith('}') || trimmed.endsWith(']'))) {
      try {
        const p = JSON.parse(trimmed);
        if (p.dialogue_text) return p.dialogue_text;
        if (p.text) return p.text;
        if (p.content) return this._extractText(p.content);
        return content;
      } catch (e) { return content; }
    }
    return content;
  }

  _resolveNpcName(npcId) {
    const gs = this.scene.get('GameScene');
    if (gs && gs.npcs) {
      const found = gs.npcs.find(s => s.getData && s.getData('npcId') === npcId);
      if (found) return found.getData('name');
    }
    const map = {
      'npc_chen': '陈师傅', 'npc_xiaohua': '小华', 'npc_laozhou': '老周',
      'npc_meiyi': '梅姨', 'npc_doctor': '郎中', 'npc_elder': '村长', 'npc_laoli': '船夫老李',
    };
    return map[npcId] || npcId || '未知';
  }

  _tryRestoreHistoryFromCache(sessionId) {
    try {
      const cached = localStorage.getItem(`__dialogue_history_${sessionId}`);
      if (cached) this.dialogueHistory = JSON.parse(cached);
    } catch (e) { /* */ }
  }

  _persistDialogueHistory() {
    if (!this.sessionId || this.dialogueHistory.length === 0) return;
    try { localStorage.setItem(`__dialogue_history_${this.sessionId}`, JSON.stringify(this.dialogueHistory)); } catch (e) { /* */ }
  }

  // =========================== ESC 键统一处理 ============================

  _handleEscPress() {
    if (this.pauseMenuVisible) { this.togglePauseMenu(); return; }
    if (this.dialogActive) { this.closeDialog(); return; }
    if (this.backpackPanelVisible) {
      if (this.showItemMode) this.cancelShowItemMode();
      else this.toggleBackpackPanel();
      return;
    }
    if (this.historyPanelVisible) { this.historyPanel.toggle(); return; }
    this.togglePauseMenu();
  }

  // =========================== 更新循环 ============================

  update() {
    // ESC 键
    if (Phaser.Input.Keyboard.JustDown(this.keyESC)) {
      this._handleEscPress();
      return;
    }

    // 背包面板 B 键
    if (Phaser.Input.Keyboard.JustDown(this.keyB)) {
      if (this.backpackPanelVisible) {
        if (this.showItemMode) this.cancelShowItemMode();
        else this.toggleBackpackPanel();
        return;
      }
      if (!this.dialogActive && !this.pauseMenuVisible && !this.historyPanelVisible) {
        this.toggleBackpackPanel();
        return;
      }
    }

    // 背包内 W/S/Enter
    if (this.backpackPanelVisible) {
      if (Phaser.Input.Keyboard.JustDown(this.keyW) && this.inventory.length > 0) {
        this.backpackCursorIndex = (this.backpackCursorIndex - 1 + this.inventory.length) % this.inventory.length;
        this.inventoryPanel.highlightItem();
        return;
      }
      if (Phaser.Input.Keyboard.JustDown(this.keyS) && this.inventory.length > 0) {
        this.backpackCursorIndex = (this.backpackCursorIndex + 1) % this.inventory.length;
        this.inventoryPanel.highlightItem();
        return;
      }
      if (this.showItemMode && Phaser.Input.Keyboard.JustDown(this.keyEnter)) {
        this.confirmShowItem();
        return;
      }
      return;
    }

    // 历史面板
    if (!this.dialogActive && Phaser.Input.Keyboard.JustDown(this.keyH)) {
      this.historyPanel.toggle();
    }
    if (this.historyPanelVisible && Phaser.Input.Keyboard.JustDown(this.keyF)) {
      this.historyPanel.toggle();
    }

    if (!this.dialogActive || this.isStreaming) return;

    // F 键关闭
    if (Phaser.Input.Keyboard.JustDown(this.keyF)) {
      if (this.dialogClickZone.input && this.dialogClickZone.input.enabled && this.dialogPages.length > 1) {
        this.dialogCurrentPage = this.dialogPages.length - 1;
        this.dialogue.showCurrentPage();
        return;
      }
      this.closeDialog();
      return;
    }

    // 数字键选择
    const numKeys = [this.key1, this.key2, this.key3, this.key4];
    for (let i = 0; i < numKeys.length; i++) {
      if (Phaser.Input.Keyboard.JustDown(numKeys[i]) && i < this.optionButtons.length) {
        const btn = this.optionButtons[i];
        const zone = btn.list && btn.list[btn.list.length - 1];
        if (zone && zone.emit) zone.emit('pointerdown');
        return;
      }
    }

    // Enter 聚焦输入框
    if (this.dialogActive && !this.isStreaming &&
      this.freeInput && this.freeInput.style.display === 'block' &&
      Phaser.Input.Keyboard.JustDown(this.keyEnter)) {
      if (document.activeElement !== this.freeInput) this.freeInput.focus();
    }
  }

  shutdown() {
    this.scale.off('resize', () => {});
    if (this.freeInput) { this.freeInput.blur(); this.freeInput.style.display = 'none'; }
    if (this._domKeyHandler) { document.removeEventListener('keydown', this._domKeyHandler); this._domKeyHandler = null; }
  }
}
