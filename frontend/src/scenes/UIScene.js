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
import { COLORS, STAGE_TONES, CHAPTER_MAP, getChapterLabel } from '../config.js';
import {
  startDialogueStream, exitDialogue, startChapter, skipChapter,
  getGameState, saveGameState, getDialogues, batchReportNPCPositions,
  getItems,
} from '../api/client.js';
import { DialogueManager } from './modules/DialogueManager.js';
import { InventoryPanel } from './modules/InventoryPanel.js';
import { HistoryPanel } from './modules/HistoryPanel.js';
import { TaskPanel } from './modules/TaskPanel.js';
import { StoryPanel } from './modules/StoryPanel.js';
import { getTownNPCDialogue } from './modules/TownNPCDialogue.js';
import { SaveManager } from './modules/SaveManager.js';
import { EndingScreen } from './modules/EndingScreen.js';
import { StageTransition } from './modules/StageTransition.js';
import { RelationshipPanel } from './modules/RelationshipPanel.js';
import { EditorPanel } from './modules/EditorPanel.js';
import { toggleFullscreen, isFullscreen } from '../utils/DeviceDetector.js';

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
    this._skipRestoreDialogue = false;

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
    this.taskPanel = new TaskPanel(this);
    this.storyPanel = new StoryPanel(this);
    this.saveManager = new SaveManager(this);
    this.endingScreen = new EndingScreen(this);
    this.stageTransition = new StageTransition(this);
    this.relationshipPanel = new RelationshipPanel(this);
    this.editorPanel = new EditorPanel(this);

    // ========== 构建 UI ==========
    this.dialogue.createPanel();
    this.dialogue.setupFreeInput();
    this.createHUD();
    this.historyPanel.createPanel();
    this.taskPanel.createPanel();
    this.storyPanel.createPanel();
    this.inventoryPanel.createPanel();
    this.stageTransition.createOverlay();
    this.endingScreen.createScreen();
    this.saveManager.createPauseMenu();
    this.relationshipPanel.createPanel();
    this.editorPanel.createPanel();

    // ========== 响应式适配：窗口缩放时重定位所有 UI ==========
    this.scale.on('resize', this._onResize, this);

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
      // 更激进的焦点策略：任意 DOM 点击/按下都聚焦 canvas
      const focusCanvas = () => { if (document.activeElement !== canvas) canvas.focus(); };
      document.addEventListener('mousedown', focusCanvas, { passive: true, capture: true });
      document.addEventListener('pointerdown', focusCanvas, { passive: true, capture: true });
      canvas.addEventListener('contextmenu', focusCanvas);
      setTimeout(() => canvas.focus(), 100);
      setTimeout(() => canvas.focus(), 500);
    }

    // 原生 DOM 键盘监听（canvas 无焦点时也能响应 ESC）
    this._domKeyHandler = (e) => {
      if (e.key === 'Escape' || e.key === 'Esc') {
        e.preventDefault();
        this._handleEscPress();
      }
    };
    document.addEventListener('keydown', this._domKeyHandler, true);

    // 预创建键盘按键
    this.keyF = this.input.keyboard.addKey('F');
    this.key1 = this.input.keyboard.addKey('ONE');
    this.key2 = this.input.keyboard.addKey('TWO');
    this.key3 = this.input.keyboard.addKey('THREE');
    this.key4 = this.input.keyboard.addKey('FOUR');
    this.keyH = this.input.keyboard.addKey('H');
    this.keyT = this.input.keyboard.addKey('T');
    this.keyB = this.input.keyboard.addKey('B');
    this.keyJ = this.input.keyboard.addKey('J');
    this.keyR = this.input.keyboard.addKey('R');
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

    // ★ 移动端菜单按钮（标题下方）
    this.menuBtn = this.add.text(16, 44, '⚙ 菜单', {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
      fontSize: '14px', color: '#aa9977',
      backgroundColor: '#1a1a2ecc', padding: { x: 10, y: 5 },
    }).setOrigin(0, 0).setInteractive({ useHandCursor: true }).setDepth(201);
    this.menuBtn.on('pointerover', () => this.menuBtn.setColor('#d4b896'));
    this.menuBtn.on('pointerout', () => this.menuBtn.setColor('#aa9977'));
    this.menuBtn.on('pointerdown', () => { if (!this.dialogActive) this.togglePauseMenu(); });

    this.add.text(16, 78, '[T] 指引', {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif', fontSize: '15px', color: '#665544',
    }).setDepth(200);

    // ★ 左侧指引提示：常驻显示当前活跃子任务
    this._miniTaskHint = this.add.text(16, 102, '', {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
      fontSize: '15px', color: '#c4a882',
      backgroundColor: '#0d0c12cc',
      padding: { x: 10, y: 4 },
      maxWidth: 260,
      wordWrap: { width: 244, useAdvancedWrap: true },
    }).setOrigin(0, 0).setDepth(201);

    // 右上角阶段指示器
    this.stageBadge = this.add.text(width - 16, 16, '阶段一 · 不屑', {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
      fontSize: '16px', color: '#c4a882',
      backgroundColor: '#1a1a2ecc', padding: { x: 10, y: 5 },
    }).setOrigin(1, 0);

    this.hudContainer.add(this.stageBadge);

    // === 右上角纵向按钮栏 ===
    this._buildNavButtons();
  }

  /** 构建右上角纵向导航按钮栏（含移动端菜单按钮） */
  _buildNavButtons() {
    const { width } = this.cameras.main;
    const x = width - 16;
    const btnPaddingX = 10;
    const btnPaddingY = 5;
    const fontSize = '14px';

    const btnDefs = [
      { y: 48, label: '📜 历史 [H]', color: '#887766', hover: '#c4a882',
        action: () => this.historyPanel.toggle(), ref: 'historyBtn' },
      { y: 80, label: '🎒 行囊 [B]', color: '#c4a882', hover: '#e8d4a0',
        action: () => { if (!this.dialogActive && !this.pauseMenuVisible && !this.historyPanelVisible) this.toggleBackpackPanel(); },
        ref: 'backpackBtn' },
      { y: 112, label: '📋 任务 [T]', color: '#c4a882', hover: '#e8d4a0',
        action: () => { if (!this.dialogActive && !this.pauseMenuVisible) this.taskPanel.toggle(); },
        ref: 'taskBtn' },
      { y: 144, label: '📖 剧本 [J]', color: '#c4a882', hover: '#e8d4a0',
        action: () => this.storyPanel.toggle(), ref: 'storyBtn' },
      { y: 176, label: '💞 关系 [R]', color: '#c4a882', hover: '#e8d4a0',
        action: () => { if (!this.dialogActive && !this.pauseMenuVisible) this.relationshipPanel.toggle(); },
        ref: 'relationshipBtn' },
      { y: 208, label: isFullscreen() ? '⛶ 退出全屏' : '⛶ 全屏', color: '#887766', hover: '#c4a882',
        action: () => { toggleFullscreen().then(() => this._updateFullscreenBtnLabel()); },
        ref: 'fullscreenBtn' },
    ];

    for (const def of btnDefs) {
      const btn = this.add.text(x, def.y, def.label, {
        fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
        fontSize, color: def.color,
        backgroundColor: '#1a1a2ecc',
        padding: { x: btnPaddingX, y: btnPaddingY },
      }).setOrigin(1, 0).setInteractive({ useHandCursor: true });

      if (def.ref !== 'historyBtn') {
        btn.on('pointerover', () => btn.setColor(def.hover));
        btn.on('pointerout', () => btn.setColor(def.color));
      } else {
        btn.on('pointerover', () => btn.setColor('#c4a882'));
        btn.on('pointerout', () => btn.setColor(def.color));
      }
      btn.on('pointerdown', def.action);
      this.hudContainer.add(btn);
      this[def.ref] = btn;
    }

    // 监听全屏状态变化
    if (!this._fsListenerAdded) {
      const onFsChange = () => this._updateFullscreenBtnLabel();
      document.addEventListener('fullscreenchange', onFsChange);
      document.addEventListener('webkitfullscreenchange', onFsChange);
      document.addEventListener('msfullscreenchange', onFsChange);
      this._fsListenerAdded = true;
    }
  }

  /** 更新全屏按钮文字 + 全屏切换后延迟重布局 */
  _updateFullscreenBtnLabel() {
    if (!this.fullscreenBtn) return;
    this.fullscreenBtn.setText(isFullscreen() ? '⛶ 退出全屏' : '⛶ 全屏');
    // 全屏/退出全屏后浏览器需要约 300-500ms 完成布局，延迟触发 resize
    if (this._fsResizeTimer) this._fsResizeTimer.remove(false);
    this._fsResizeTimer = this.time.delayedCall(400, () => {
      this._fsResizeTimer = null;
      this._doResize();
    });
  }

  // =========================== 背包面板（委托给 InventoryPanel）===========================

  async toggleBackpackPanel() {
    if (this.dialogActive || this.pauseMenuVisible || this.historyPanelVisible) return;
    this.backpackPanelVisible = !this.backpackPanelVisible;
    if (this.backpackPanelVisible) {
      // 从后端拉取最新背包数据
      if (this.sessionId) {
        try {
          const data = await getItems(this.sessionId);
          if (data && data.inventory) {
            this.inventory = data.inventory;
          }
        } catch (err) {
          console.warn('[UIScene] 获取背包数据失败，使用本地缓存:', err.message);
        }
      }
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

  async _onDialogueStart({ npcId, name, isTownNPC, role }) {
    if (this.dialogActive || this.isStreaming) return;
    this.dialogActive = true;
    this.isStreaming = true;
    this.currentNPC = { id: npcId, name };

    if (this.historyPanelVisible) this.historyPanel.toggle();

    if (this._taskPanelUI?.visible) this.taskPanel.hide();

    const gs = this.scene.get('GameScene');
    gs.events.emit('input:lock', true);

    this.dialogContainer.setVisible(true);
    this.dialogName.setText(name);
    this.dialogText.setText('');
    this.dialogHint.setText('对话生成中……');
    this.dialogue.clearOptions();

    // ★ 显示角色立绘（底部居中，对话框覆盖下半身）
    if (!isTownNPC) {
      this.dialogue.showPortrait(npcId);
    }

    // 城镇 NPC：使用本地随机话术库，不调用后端 API
    if (isTownNPC) {
      await this._handleTownNPCDialogue(name, role);
      return;
    }

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

  /** 处理城镇 NPC 的本地对话（纯文本展示，无选项/输入框） */
  async _handleTownNPCDialogue(npcName, role) {
    const { dialogue } = getTownNPCDialogue(npcName, role);

    // 模拟短暂的"生成中"效果
    await new Promise(resolve => setTimeout(resolve, 300 + Math.random() * 400));

    this.isStreaming = false;
    this.dialogue.stopCursorBlink();
    this.dialogue.hideFreeInput();
    this.addToHistory(npcName, dialogue);

    // 直接展示纯文本，不进入分页/选项流程
    this.dialogText.setText(dialogue);
    this.dialogHint.setText('[F] 关闭');
    this.pageHint.setText('');
    this.dialogPages = [dialogue];
    this.dialogCurrentPage = 0;
    this.pendingOptions = null;
    this.pendingChapterChange = null;
    this.pendingEnding = false;

    // 启用点击关闭（点对话框文本区域即可关闭）
    this.dialogClickZone.setInteractive({ useHandCursor: true });
  }

  /** 分页结束 → 显示选项 */
  async finishPagination() {
    this.pageHint.setText('');
    this.dialogClickZone.disableInteractive();

    if (this.pendingEnding) {
      this.dialogHint.setText('[F] 关闭对话');
      return;
    }

    // 章节完成时不立即跳转，先正常显示选项，等玩家关闭对话后再跳转
    this.dialogue.showOptions(this.pendingOptions);
  }

  /** 关闭对话 */
  async closeDialog() {
    this.dialogActive = false;
    this.isStreaming = false;
    this.dialogPages = [];
    this.dialogCurrentPage = 0;
    this.pendingOptions = null;
    this.pendingEnding = false;
    this.pageHint.setText('');
    this.dialogClickZone.disableInteractive();
    this.dialogue.stopCursorBlink();
    this.dialogue.clearOptions();
    this.dialogue.hideFreeInput();
    this.dialogue.hidePortrait();
    this.dialogContainer.setVisible(false);

    const gs = this.scene.get('GameScene');
    gs.events.emit('input:lock', false);

    this._persistDialogueHistory();

    // 对话结束后刷新任务面板数据（不自动弹出）
    this.taskPanel.refreshContent();

    // ★ 对话结束后同步 NPC 状态（关系值等），确保精灵数据和面板数据一致
    if (this.sessionId) {
      getGameState(this.sessionId).then(state => {
        if (state) gs.events.emit('state:refresh', state);
      }).catch(() => {});
    }

    // 章节完成：玩家关闭对话后再跳转
    if (this.pendingChapterChange && this.pendingChapterChange.chapterCompleted) {
      const chapterChange = this.pendingChapterChange;
      this.pendingChapterChange = null;
      this.time.delayedCall(300, () => this._handleChapterComplete());
      return;
    }
    this.pendingChapterChange = null;

    if (this.sessionId && this.currentNPC) {
      exitDialogue(this.sessionId, this.currentNPC.id)
        .then(r => console.log('[UIScene] NPC 告别语:', r.dialogue_text))
        .catch(err => console.warn('[UIScene] 退出对话 API 失败:', err.message));
    }
  }

  /** 对话历史记录 */
  addToHistory(npcName, npcText, playerText = null) {
    this.dialogueHistory.push({
      npcName, npcText: npcText ?? null, playerText: playerText || null,
      stage: this.currentStage,
      chapterId: this.currentChapterId,
    });
  }

  // =========================== 章节管理 ============================

  async _handleSkipChapter() {
    if (this.dialogActive || !this.sessionId) return;
    try {
      console.log('[UIScene] skipChapter...');
      this._showChapterLoading(
        '补全剧情，加载新篇章……',
        '物品与记忆正在复位……'
      );
      const chapterResult = await skipChapter(this.sessionId);
      this._hideChapterLoading();

      if (chapterResult.game_ended) {
        this.time.delayedCall(500, () => this.triggerEndingSequence());
        return;
      }

      if (chapterResult.chapter_id) {
        const stageId = CHAPTER_MAP[chapterResult.chapter_id] || this.currentStage + 1;
        const tone = STAGE_TONES[stageId];
        const newStage = {
          id: stageId,
          chapterId: chapterResult.chapter_id,
          name: chapterResult.chapter_name || (tone ? tone.name : '未知'),
          description: chapterResult.task ? chapterResult.task.description : '',
          color_tone: chapterResult.color_tone || (tone ? tone.mood : 'cold'),
          bgm_mood: chapterResult.bgm_mood || '',
        };

        this.currentStage = stageId;
        this.currentChapterId = chapterResult.chapter_id;
        this.currentChapterName = chapterResult.chapter_name;
        this.updateStageBadge();

        const gs = this.scene.get('GameScene');
        gs.events.emit('stage:change', newStage);
        gs.events.emit('chapter:new', chapterResult);

        await this.stageTransition.play(newStage);
        // ★ 章节开始后，显示编辑器入口按钮（右下角悬浮）
        this._showChapterEditButton(chapterResult.chapter_id, chapterResult.chapter_name);
        if (this.taskPanel) this.taskPanel.refreshContent();
      }
    } catch (e) {
      console.error('[UIScene] 跳章失败:', e);
      this._hideChapterLoading();
    }
  }

  async _handleChapterComplete() {
    this.dialogContainer.setVisible(false);
    this.dialogue.clearOptions();
    this.dialogue.hideFreeInput();

    const gs = this.scene.get('GameScene');
    gs.events.emit('input:lock', false);

    if (!this.sessionId) return;

    try {
      this._showChapterLoading();
      const chapterResult = await startChapter(this.sessionId);
      this._hideChapterLoading();

      if (chapterResult.game_ended) {
        this.time.delayedCall(500, () => this.triggerEndingSequence());
        return;
      }

      if (chapterResult.chapter_id) {
        const stageId = CHAPTER_MAP[chapterResult.chapter_id] || this.currentStage + 1;
        const tone = STAGE_TONES[stageId];
        const newStage = {
          id: stageId,
          chapterId: chapterResult.chapter_id,
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
        // ★ 章节开始后，显示编辑器入口按钮（右下角悬浮）
        this._showChapterEditButton(chapterResult.chapter_id, chapterResult.chapter_name);

        if (this.sessionId) {
          // ★ 收集当前所有 NPC 和主角的实时位置
          let positions = null;
          if (gs && gs.collectPositions) {
            positions = gs.collectPositions();
            console.log('[UIScene] chapterComplete collectPositions:', positions);
            if (positions.storyNpcs.length > 0) {
              batchReportNPCPositions(this.sessionId, positions.storyNpcs).catch(e =>
                console.warn('[UIScene] chapterComplete batchReport failed:', e));
            }
          } else {
            console.warn('[UIScene] chapterComplete: collectPositions not available');
          }

          const state = await getGameState(this.sessionId);

          // ★ 直接更新 state 中的位置数据 + 子场景标识
          if (positions) {
            if (positions.subSceneId) {
              // 子场景中：不污染主地图位置字段
              state._sub_scene_id = positions.subSceneId;
              state._sub_scene_player_position = positions.player;
              state._sub_scene_story_npc_positions = positions.storyNpcs;
              state._sub_scene_town_npc_positions = positions.townNpcs;
            } else {
              state._sub_scene_id = null;
              if (state.npcs && Array.isArray(state.npcs)) {
                for (const pos of positions.storyNpcs) {
                  const npc = state.npcs.find(n => n.id === pos.npc_id);
                  if (npc) npc.position = pos.position;
                }
              }
              state._town_npc_positions = positions.townNpcs;
              state._player_position = positions.player;
            }
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
      this._hideChapterLoading();
    }
  }

  markChapterCompleted(chapterInfo) {
    if (!chapterInfo || !chapterInfo.chapter_id) return;
    const mapped = CHAPTER_MAP[chapterInfo.chapter_id];
    if (mapped && mapped > this.currentStage) this.currentStage = mapped;
  }

  // =========================== 章节编辑器入口按钮 ============================

  /**
   * 章节跳转后，在右下角显示一个悬浮的「编辑章节」按钮，
   * 点击后在新窗口打开 editor.html 并跳转到章节详情编辑页。
   * 按钮会在 12 秒后自动淡出消失。
   */
  _showChapterEditButton(chapterId, chapterName) {
    if (!this.sessionId || !chapterId) return;

    // 清理上一个按钮
    if (this._chapterEditBtn) {
      this._chapterEditBtn.destroy(true);
      this._chapterEditBtn = null;
    }
    if (this._chapterEditBtnTimer) {
      clearTimeout(this._chapterEditBtnTimer);
      this._chapterEditBtnTimer = null;
    }

    const { width, height } = this.cameras.main;
    const scale = Math.min(width / 1280, height / 720);
    const btnW = Math.round(160 * scale);
    const btnH = Math.round(36 * scale);
    const margin = Math.round(16 * scale);
    const bx = width - margin - btnW;
    const by = height - margin - btnH - Math.round(60 * scale); // above bottom bar

    const container = this.add.container(0, 0).setDepth(400).setAlpha(0);
    this._chapterEditBtn = container;

    // Button background
    const bg = this.add.graphics();
    const drawBg = (hover) => {
      bg.clear();
      bg.fillStyle(hover ? 0x1a1e3a : 0x111128, hover ? 0.95 : 0.85);
      bg.fillRoundedRect(bx, by, btnW, btnH, 6);
      bg.lineStyle(1, hover ? 0x7b8cde : 0x443388, hover ? 0.9 : 0.5);
      bg.strokeRoundedRect(bx, by, btnW, btnH, 6);
    };
    drawBg(false);
    container.add(bg);

    const fs = Math.round(12 * scale);
    const labelText = this.add.text(bx + btnW / 2, by + btnH / 2, '✎ 查看/编辑章节', {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
      fontSize: `${fs}px`,
      color: '#8899dd',
    }).setOrigin(0.5);
    container.add(labelText);

    // Hint below
    const hintText = this.add.text(bx + btnW / 2, by + btnH + Math.round(4 * scale),
      `「${chapterName || chapterId}」`, {
        fontFamily: '"KaiTi","SimSun",serif',
        fontSize: `${Math.round(10 * scale)}px`,
        color: '#665544',
      }).setOrigin(0.5, 0);
    container.add(hintText);

    // Interaction zone
    const zone = this.add.zone(bx + btnW / 2, by + btnH / 2, btnW, btnH)
      .setInteractive({ useHandCursor: true });
    zone.on('pointerover', () => {
      drawBg(true);
      labelText.setColor('#c0c8ff');
    });
    zone.on('pointerout', () => {
      drawBg(false);
      labelText.setColor('#8899dd');
    });
    zone.on('pointerdown', () => {
      this._openChapterEditor(chapterId);
    });
    container.add(zone);

    // Fade in
    this.tweens.add({
      targets: container,
      alpha: 1,
      duration: 500,
      ease: 'Sine.easeOut',
    });

    // Auto fade out after 12s
    this._chapterEditBtnTimer = setTimeout(() => {
      if (this._chapterEditBtn === container) {
        this.tweens.add({
          targets: container,
          alpha: 0,
          duration: 800,
          ease: 'Sine.easeIn',
          onComplete: () => container.destroy(true),
        });
        this._chapterEditBtn = null;
      }
    }, 12000);
  }

  /**
   * 打开章节编辑器（内联 iframe 覆盖层），替代 window.open 弹窗。
   */
  _openChapterEditor(chapterId) {
    if (!this.sessionId || !chapterId) return;
    this.editorPanel.show('chapter', {
      session_id: this.sessionId,
      chapter_id: chapterId,
    });
  }

  /**
   * 打开骨架编辑器（内联 iframe 覆盖层）。
   */
  openSkeletonEditor(scriptId) {
    if (!scriptId) return;
    this.editorPanel.show('skeleton', { script_id: scriptId });
  }

  /** 打开剧本工坊（剧本库 + AI 创作） */
  openEditorWorkshop() {
    this.editorPanel.show('scripts');
  }

  _showChapterLoading(title = '整理记忆，进入下一章……', hint = '故事正在推进……') {
    this._hideChapterLoading(true); // 先清理旧的
    const { width, height } = this.cameras.main;

    // 半透明背景遮罩
    this._chapterLoadingOverlay = this.add.rectangle(
      width / 2, height / 2, width, height, 0x000000, 0.4
    ).setDepth(540);

    // 标题文字
    this._chapterLoadingText = this.add.text(width / 2, height / 2 - 20,
      title, {
      fontFamily: '"KaiTi","SimSun",serif', fontSize: '36px',
      color: '#e8e0d0', stroke: '#1a1a1a', strokeThickness: 3,
    }).setOrigin(0.5).setDepth(550).setAlpha(0);

    // 小提示
    this._chapterLoadingHint = this.add.text(width / 2, height / 2 + 30,
      hint, {
      fontFamily: '"KaiTi","SimSun",serif', fontSize: '20px',
      color: '#bba080', stroke: '#1a1a1a', strokeThickness: 2,
    }).setOrigin(0.5).setDepth(550).setAlpha(0);

    // 淡入动画
    this.tweens.add({
      targets: [this._chapterLoadingText, this._chapterLoadingHint],
      alpha: 1, duration: 600, ease: 'Sine.easeIn',
    });

    // 呼吸闪烁
    this.tweens.add({
      targets: this._chapterLoadingText,
      alpha: 0.5, duration: 1200, yoyo: true, repeat: -1,
      ease: 'Sine.easeInOut', delay: 600,
    });
  }

  _hideChapterLoading(immediate = false) {
    if (!this._chapterLoadingText && !this._chapterLoadingOverlay) return;

    if (immediate) {
      if (this._chapterLoadingOverlay) { this._chapterLoadingOverlay.destroy(); this._chapterLoadingOverlay = null; }
      if (this._chapterLoadingText) { this._chapterLoadingText.destroy(); this._chapterLoadingText = null; }
      if (this._chapterLoadingHint) { this._chapterLoadingHint.destroy(); this._chapterLoadingHint = null; }
      return;
    }

    // 淡出
    this.tweens.killTweensOf(this._chapterLoadingText);
    this.tweens.killTweensOf(this._chapterLoadingHint);

    const targets = [];
    if (this._chapterLoadingText) targets.push(this._chapterLoadingText);
    if (this._chapterLoadingHint) targets.push(this._chapterLoadingHint);
    if (this._chapterLoadingOverlay) targets.push(this._chapterLoadingOverlay);

    this.tweens.add({
      targets, alpha: 0, duration: 400,
      onComplete: () => {
        if (this._chapterLoadingOverlay) { this._chapterLoadingOverlay.destroy(); this._chapterLoadingOverlay = null; }
        if (this._chapterLoadingText) { this._chapterLoadingText.destroy(); this._chapterLoadingText = null; }
        if (this._chapterLoadingHint) { this._chapterLoadingHint.destroy(); this._chapterLoadingHint = null; }
      },
    });
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

  async onLoadGame(saveId) {
    await this.saveManager.onLoad(saveId);
  }

  showSaveLoadPanel(mode) {
    this.saveManager.showSlots(mode);
  }

  async onReturnToMenu() {
    this.pauseContainer.setVisible(false);
    this.pauseMenuVisible = false;
    if (this.saveSlotContainer) this.saveSlotContainer.destroy();
    this.saveSlotsVisible = false;

    const gs = this.scene.get('GameScene');
    gs.events.emit('input:lock', false);
    if (this.sessionId) localStorage.setItem('__active_session__', this.sessionId);

    // ★ 返回主菜单前保存当前 NPC/主角位置，确保下次加载能恢复
    if (this.sessionId && gs && gs.collectPositions) {
      try {
        const positions = gs.collectPositions();
        console.log('[UIScene] returnToMenu collectPositions:', positions);
        // 上报故事NPC位置到后端
        if (positions.storyNpcs.length > 0) {
          batchReportNPCPositions(this.sessionId, positions.storyNpcs).catch(e =>
            console.warn('[UIScene] returnToMenu batchReport failed:', e));
        }

        const state = await getGameState(this.sessionId);
        // 直接更新 state 中的位置数据
        if (state.npcs && Array.isArray(state.npcs)) {
          for (const pos of positions.storyNpcs) {
            const npc = state.npcs.find(n => n.id === pos.npc_id);
            if (npc) npc.position = pos.position;
          }
        }
        if (positions.subSceneId) {
          state._sub_scene_id = positions.subSceneId;
          state._sub_scene_player_position = positions.player;
        } else {
          state._sub_scene_id = null;
          state._town_npc_positions = positions.townNpcs;
          state._player_position = positions.player;
        }
        saveGameState(this.sessionId, state);
      } catch (_) {}
    }

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

    console.log('[UIScene] _onGameInit 收到 dialogueHistory 长度:', data.dialogueHistory?.length || 0);

    // ★ 步骤1：彻底清空上一存档的对话缓存，防止堆叠
    if (this.sessionId && this.sessionId !== data.sessionId) {
      try { localStorage.removeItem(`__dialogue_history_${this.sessionId}`); } catch (e) { /* ignore */ }
    }
    this.dialogueHistory = [];

    // ★ 步骤2：如果 game:init 携带对话历史（如存档加载），直接赋值并跳过 API 查询
    if (data.dialogueHistory && Array.isArray(data.dialogueHistory) && data.dialogueHistory.length > 0) {
      this.dialogueHistory = data.dialogueHistory;
      this._skipRestoreDialogue = true;
      console.log('[UIScene] _onGameInit 已直接从 game:init 加载对话历史，条数:', this.dialogueHistory.length);
      try {
        localStorage.setItem(`__dialogue_history_${this.sessionId}`, JSON.stringify(this.dialogueHistory));
      } catch (e) { /* ignore */ }
    } else {
      this._skipRestoreDialogue = false;
    }

    if (this.sessionId) this._restoreDialogueHistory(this.sessionId);
    this.taskPanel.refreshWithCachedData();
  }

  _onStageChange(newStage) {
    this.currentStage = newStage.id;
    if (newStage.chapterId) this.currentChapterId = newStage.chapterId;
    if (newStage.name) this.currentChapterName = newStage.name;
    this.updateStageBadge();
    if (this.sessionId) {
      getGameState(this.sessionId)
        .then(state => this.scene.get('GameScene').events.emit('state:refresh', state))
        .catch(() => {});
    }
  }

  updateStageBadge() {
    const tone = STAGE_TONES[this.currentStage];
    const chapterLabel = getChapterLabel(this.currentChapterId);
    const label = this.currentChapterName || (tone ? tone.name : '未知');
    this.stageBadge.setText(`${chapterLabel} · ${label}`);
    if (tone) {
      const tintColors = {
        cold: '#8899cc', warm: '#ccaa77', dramatic: '#cc8866', melancholy: '#8899aa', somber: '#998877'
      };
      this.stageBadge.setColor(tintColors[tone.mood] || '#c4a882');
    }
  }

  /** 窗口/画布尺寸变化时统一重定位所有 UI */
  _onResize() {
    // 防抖：100ms 内只执行一次，避免 Phaser 初始化时连续触发导致崩溃
    if (this._resizeTimer) return;
    this._resizeTimer = this.time.delayedCall(100, () => {
      this._resizeTimer = null;
      this._doResize();
    });
  }

  _doResize() {
    const { width, height } = this.cameras.main;

    // 右上角 HUD 位置更新（纵向排列）
    const x = width - 16;
    const btnPositions = {
      historyBtn:      { x, y: 48 },
      backpackBtn:     { x, y: 80 },
      taskBtn:         { x, y: 112 },
      storyBtn:        { x, y: 144 },
      relationshipBtn: { x, y: 176 },
      fullscreenBtn:   { x, y: 208 },
    };
    for (const [ref, pos] of Object.entries(btnPositions)) {
      if (this[ref]) this[ref].setPosition(pos.x, pos.y);
    }

    // 右上角阶段指示器
    if (this.stageBadge) this.stageBadge.setPosition(width - 16, 16);

    // 重定位自由输入框（DOM 元素，需单独处理）
    try {
      if (this.dialogContainer && this.dialogContainer.visible && this.freeInput && this.freeInput.style.display === 'block') {
        this.dialogue.showFreeInput();
      }
    } catch (e) { console.warn('[UIScene] resize：freeInput 重定位失败', e); }

    // 按优先级顺序重建各面板，每个模块独立 try-catch 防止连锁崩溃
    const modules = [
      { name: 'dialogue',       inst: this.dialogue },
      { name: 'inventoryPanel', inst: this.inventoryPanel },
      { name: 'historyPanel',   inst: this.historyPanel },
      { name: 'taskPanel',      inst: this.taskPanel },
      { name: 'storyPanel',     inst: this.storyPanel },
      { name: 'saveManager',    inst: this.saveManager },
      { name: 'stageTransition',inst: this.stageTransition },
      { name: 'endingScreen',   inst: this.endingScreen },
      { name: 'relationshipPanel', inst: this.relationshipPanel },
    ];
    for (const m of modules) {
      try {
        m.inst.onResize();
      } catch (e) {
        console.warn(`[UIScene] resize：${m.name}.onResize() 失败`, e);
      }
    }
  }

  // =========================== 对话历史恢复 ============================

  async _restoreDialogueHistory(sessionId) {
    // ★ 如果 game:init 已提供对话历史（存档加载等场景），跳过 API 查询
    if (this._skipRestoreDialogue) {
      this._skipRestoreDialogue = false;
      console.log('[UIScene] _restoreDialogueHistory 跳过（game:init 已提供数据）');
      return;
    }
    console.log('[UIScene] _restoreDialogueHistory 开始从 API 恢复');
    this.dialogueHistory = [];
    try {
      const result = await getDialogues(sessionId);
      console.log('[UIScene] _restoreDialogueHistory API 返回条数:', result?.items?.length || 0);
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
      console.log('[UIScene] _restoreDialogueHistory 恢复完成，总条数:', this.dialogueHistory.length);
      try { localStorage.setItem(`__dialogue_history_${sessionId}`, JSON.stringify(this.dialogueHistory)); } catch (e) { /* */ }
    } catch (e) {
      console.warn('[UIScene] _restoreDialogueHistory API 失败，回退到缓存:', e);
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

  // =========================== 编辑模式检测 ============================

  /** 检测 GameScene 是否正在编辑模式中 */
  _isGameEditing() {
    try {
      const gs = this.scene.get('GameScene');
      return !!(gs && gs._editor && gs._editor.editMode);
    } catch (e) { return false; }
  }

  // =========================== ESC 键统一处理 ============================

  _handleEscPress() {
    // 编辑器面板优先关闭
    if (this.editorPanel && this.editorPanel.isVisible()) { this.editorPanel.hide(); return; }

    // 编辑模式下不处理 ESC，交给 GameScene 的编辑器
    if (this._isGameEditing()) return;

    // 防抖：DOM 监听器（capture 阶段）和 update() 中 Phaser JustDown 可能触发两次
    const now = Date.now();
    if (now - (this._lastEscPress || 0) < 150) return;
    this._lastEscPress = now;

    if (this.pauseMenuVisible) { this.togglePauseMenu(); return; }
    if (this.dialogActive) { this.closeDialog(); return; }
    if (this._taskPanelUI?.visible) { this.taskPanel.hide(); return; }
    if (this.backpackPanelVisible) {
      if (this.showItemMode) this.cancelShowItemMode();
      else this.toggleBackpackPanel();
      return;
    }
    if (this._relationshipPanelUI?.visible) { this.relationshipPanel.hide(); return; }
    if (this._storyPanelUI?.visible) { this.storyPanel.hide(); return; }
    if (this.historyPanelVisible) { this.historyPanel.toggle(); return; }
    this.togglePauseMenu();
  }

  // =========================== 面板互斥 ===========================

  /** 关闭所有非对话面板（用于快捷键互斥） */
  _closeAllPanels() {
    if (this.backpackPanelVisible) this.toggleBackpackPanel();
    if (this._storyPanelUI?.visible) this.storyPanel.hide();
    if (this.historyPanelVisible) this.historyPanel.toggle();
    if (this._taskPanelUI?.visible) this.taskPanel.hide();
    if (this._relationshipPanelUI?.visible) this.relationshipPanel.hide();
  }

  // =========================== 更新循环 ============================

  update() {
    // ★ 编辑器面板可见时，仅处理 ESC 关闭，其余输入全部阻断
    if (this.editorPanel && this.editorPanel.isVisible()) {
      if (Phaser.Input.Keyboard.JustDown(this.keyESC)) {
        this.editorPanel.hide();
      }
      return;
    }

    const editing = this._isGameEditing();

    // ESC 键 — 编辑模式下交给 GameScene 处理
    if (Phaser.Input.Keyboard.JustDown(this.keyESC)) {
      if (this.editorPanel && this.editorPanel.isVisible()) {
        this.editorPanel.hide();
        return;
      }
      if (!editing) this._handleEscPress();
      return;
    }

    // 背包面板 B 键 — 编辑模式下给出生点设置让路
    if (Phaser.Input.Keyboard.JustDown(this.keyB) && !editing) {
      if (this.backpackPanelVisible) {
        if (this.showItemMode) this.cancelShowItemMode();
        else this.toggleBackpackPanel();
        return;
      }
      if (!this.dialogActive && !this.pauseMenuVisible) {
        this._closeAllPanels();
        this.toggleBackpackPanel();
        return;
      }
    }

    // 背包内 W/S/Enter — 编辑模式下禁用
    if (this.backpackPanelVisible && !editing) {
      if (Phaser.Input.Keyboard.JustDown(this.keyW) && this.inventory.length > 0) {
        this.backpackCursorIndex = (this.backpackCursorIndex - 1 + this.inventory.length) % this.inventory.length;
        this.inventoryPanel.highlightItem();
        this.inventoryPanel.scrollToIndex(this.backpackCursorIndex);
        return;
      }
      if (Phaser.Input.Keyboard.JustDown(this.keyS) && this.inventory.length > 0) {
        this.backpackCursorIndex = (this.backpackCursorIndex + 1) % this.inventory.length;
        this.inventoryPanel.highlightItem();
        this.inventoryPanel.scrollToIndex(this.backpackCursorIndex);
        return;
      }
      if (this.showItemMode && Phaser.Input.Keyboard.JustDown(this.keyEnter)) {
        this.confirmShowItem();
        return;
      }
      // W/S/Enter 之外的按键（如 T/H/J/ESC）不在此拦截，让后续逻辑处理
    }

    // 关系面板 R 键 — 互斥
    if (!editing && !this.dialogActive && !this.pauseMenuVisible && Phaser.Input.Keyboard.JustDown(this.keyR)) {
      if (!this._relationshipPanelUI?.visible) this._closeAllPanels();
      this.relationshipPanel.toggle();
    }
    // 历史面板 H 键 — 互斥：打开前关闭其他面板
    if (!editing && !this.dialogActive && !this.pauseMenuVisible && Phaser.Input.Keyboard.JustDown(this.keyH)) {
      if (!this.historyPanelVisible) this._closeAllPanels();
      this.historyPanel.toggle();
    }
    // 剧本面板 J 键 — 互斥
    if (!editing && !this.dialogActive && !this.pauseMenuVisible && Phaser.Input.Keyboard.JustDown(this.keyJ)) {
      if (!this._storyPanelUI?.visible) this._closeAllPanels();
      this.storyPanel.toggle();
    }
    if (this.historyPanelVisible && Phaser.Input.Keyboard.JustDown(this.keyF)) {
      this.historyPanel.toggle();
    }

    // 任务面板 T 键 — 互斥
    if (!this.dialogActive && !this.pauseMenuVisible && !editing && Phaser.Input.Keyboard.JustDown(this.keyT)) {
      if (!this._taskPanelUI?.visible) this._closeAllPanels();
      this.taskPanel.toggle();
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
    this.scale.off('resize', this._onResize, this);
    if (this._resizeTimer) { this._resizeTimer.remove(false); this._resizeTimer = null; }
    if (this._fsResizeTimer) { this._fsResizeTimer.remove(false); this._fsResizeTimer = null; }
    if (this.freeInput) { this.freeInput.blur(); this.freeInput.style.display = 'none'; }
    if (this._domKeyHandler) { document.removeEventListener('keydown', this._domKeyHandler); this._domKeyHandler = null; }

    // ★ 清理章节编辑器相关资源
    if (this._chapterEditBtnTimer) { clearTimeout(this._chapterEditBtnTimer); this._chapterEditBtnTimer = null; }
    if (this._chapterEditBtn) { this._chapterEditBtn.destroy(true); this._chapterEditBtn = null; }

    // ★ 清理内联编辑器面板
    if (this.editorPanel) { this.editorPanel.destroy(); this.editorPanel = null; }
  }
}
