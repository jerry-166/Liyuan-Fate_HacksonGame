/**
 * GameScene — 核心游戏场景
 *
 * 职责：管理游戏世界的所有实体和行为
 * - 地图渲染（加载素材图片 town_worldmap.png）
 * - 玩家移动 + 精灵动画（protagonist 系列）
 * - NPC 系统（主要 NPC + 普通 NPC 漫游 AI）
 * - 场景物品拾取（点击/按键交互）
 * - 碰撞编辑器（按 E 键进入可视化编辑）
 * - 摄像机跟随 + 阶段色调遮罩
 *
 * 与其他场景的通信通过 Phaser 事件系统：
 *   dialogue:start → UIScene 开始对话
 *   game:init     → UIScene 初始化 session
 *   stage:change  → UIScene 更新阶段指示器
 *   input:lock    → 锁定/解锁玩家移动
 *
 * @module scenes/GameScene
 */

import Phaser from 'phaser';
import { GAME, COORD, CHAPTER_IMAGES, CHAPTER_MAP } from '../config.js';
import { generateMapData, MAP_SCALE, MAP_COLS, MAP_ROWS } from './modules/MapGenerator.js';
import { CollisionEditor } from './modules/CollisionEditor.js';
import {
  PROTAGONIST, NPC_SPRITES, FALLBACK_NPC_SPRITE, DIRS,
  showToast as _showToast, showLoadingHint as _showLoadingHint, hideLoadingHint as _hideLoadingHint,
  addItemSparkle as _addItemSparkle,
  loadImagesOnDemand, isTextureLoaded, markTextureLoaded,
  preloadNPCSprites, CHAPTER_NPCS,
} from './modules/GameUIHelpers.js';
import { SUBSCENES, SUB_MAP_SCALE } from './modules/SubSceneConfig.js';
import { SubSceneManager } from './modules/SubSceneManager.js';
import { MusicManager } from './modules/MusicManager.js';

const TILE = GAME.TILE_SIZE;

/** 回退精灵：纹理加载失败或 NPC 无专属精灵时使用（向下 idle 帧） */
const FALLBACK_TEXTURE_KEY = `${FALLBACK_NPC_SPRITE.prefix}_idle_down`;

/**
 * 从 localStorage 合并仅前端持有的位置数据到后端 state（后端 API 不含 _town_npc_positions / _player_position）
 * @param {string} sessionId
 * @param {object} gameState - 后端返回的 state（会被原地修改）
 */
function _mergeLocalPositionState(sessionId, gameState) {
  if (!gameState || !sessionId) return;
  try {
    const saved = localStorage.getItem(`game_state_${sessionId}`);
    if (!saved) return;
    const local = JSON.parse(saved);

    // ★ 仅补全缺失字段，不覆盖后端/快照已返回的值
    if (!gameState._town_npc_positions && local._town_npc_positions && Array.isArray(local._town_npc_positions)) {
      gameState._town_npc_positions = local._town_npc_positions;
    }
    if (!gameState._player_position && local._player_position) {
      gameState._player_position = local._player_position;
    }
    if (!gameState._sub_scene_id && local._sub_scene_id) {
      gameState._sub_scene_id = local._sub_scene_id;
    }
    if (!gameState._sub_scene_player_position && local._sub_scene_player_position) {
      gameState._sub_scene_player_position = local._sub_scene_player_position;
    }
    if (!gameState._sub_scene_story_npc_positions && local._sub_scene_story_npc_positions) {
      gameState._sub_scene_story_npc_positions = local._sub_scene_story_npc_positions;
    }
    if (!gameState._sub_scene_town_npc_positions && local._sub_scene_town_npc_positions) {
      gameState._sub_scene_town_npc_positions = local._sub_scene_town_npc_positions;
    }
    // 合并故事 NPC 位置（localStorage 中的可能比后端 DB 更新）
    if (local.npcs && Array.isArray(local.npcs) && gameState.npcs && Array.isArray(gameState.npcs)) {
      for (const localNpc of local.npcs) {
        if (localNpc.position && localNpc.position.col !== undefined) {
          const serverNpc = gameState.npcs.find(n => n.id === localNpc.id);
          if (serverNpc) serverNpc.position = localNpc.position;
        }
      }
    }
  } catch (_) { /* 静默失败，localStorage 损坏不影响主流程 */ }
}

export class GameScene extends Phaser.Scene {
  constructor() {
    super({ key: 'GameScene' });
  }

  // ==================== 生命周期 ====================

  init(data) {
    this._savedSessionId = data?.savedSessionId || null;
  }

  preload() {
    // ★ 主角、地图、过渡图、墓地已由 BootScene 加载
    for (const dir of DIRS) {
      markTextureLoaded(`${PROTAGONIST.prefix}_idle_${dir}`);
      markTextureLoaded(`${PROTAGONIST.prefix}_walk_${dir}`);
    }
    markTextureLoaded('town_worldmap');
    markTextureLoaded('transition_1');
    markTextureLoaded('subscene_graveyard');
    // ★ NPC精灵由后台异步预加载，不在此处加载也不标记
  }

  create() {
    const savedSessionId = this._savedSessionId;

    // 初始化状态
    this.mapData = generateMapData();
    this.cursors = null;
    this.player = null;
    this.npcs = [];
    this.npcBubbles = [];
    this.sceneItems = [];
    this.townNpcs = [];
    this.townNpcBubbles = [];
    this.inputLocked = false;
    this._npcResumeDelay = 0;   // NPC漫游恢复延迟（ms），-1=暂停，0=正常，>0=倒计时中
    this.currentStage = 1;
    this.currentNearbyItem = null;

    // 碰撞数据
    this._collisionMap = {};

    // 子场景管理器
    this.subSceneManager = new SubSceneManager(this);

    // ★ 音乐管理器
    this.musicManager = new MusicManager(this);
    this.musicManager.preloadAll();

    // ★ 黑色遮罩：覆盖主地图加载过程，进入游戏后根据流程移除
    const { width: sw, height: sh } = this.cameras.main;
    this._startupOverlay = this.add.rectangle(sw / 2, sh / 2, sw, sh, 0x000000, 1)
      .setDepth(200).setScrollFactor(0).setOrigin(0.5);

    // ★ 后台预加载全部NPC精灵（5个NPC × 8贴图 = 40张小图，总体积很小）
    //   一次性加载避免章节切换时缺纹理，也避免子场景内重复按需加载
    //   不 await，让它和 initGame / 过渡动画 / 墓地探索并行运行
    const allNPCs = [...CHAPTER_NPCS[1], ...CHAPTER_NPCS[2]];
    this._npcPreloadPromise = preloadNPCSprites(this, allNPCs);
    console.log('[GameScene] 全部NPC精灵后台预加载已启动');

    // 从后端文件系统加载编辑器配置（如果localStorage中没有数据）
    // 必须等配置加载完再创建 NPC，否则首次打开时NPC位置会回退到硬编码默认值
    this._editorConfigPromise = this._loadEditorFromBackend();

    this.drawTileMap();

    // 以图片实际渲染尺寸作为边界
    const actualMapW = this.mapImage.displayWidth;
    const actualMapH = this.mapImage.displayHeight;
    this._mapBounds = { w: actualMapW, h: actualMapH };

    this.createCollisionLayer();
    this.createPlayer();

    // 等编辑器配置就绪 + NPC纹理预加载完成后再创建 NPC
    // （因为编辑器配置读取很快，纹理加载是网络IO，必须等两者都完成）
    this._editorConfigPromise.then(async (restored) => {
      if (restored) {
        console.log('[Editor] 配置已恢复，创建 NPC 使用编辑器出生点');
      }
      // ★ 等待 NPC 纹理预加载完成（否则精灵将不可见）
      if (this._npcPreloadPromise) await this._npcPreloadPromise;
      this.createNPCs();
    });

    this.cameras.main.removeBounds();

    // 键盘输入
    this.cursors = this.input.keyboard.createCursorKeys();
    this.wasd = {
      W: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      A: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      S: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      D: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D),
      F: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.F),
    };

    // F键交互提示文字（跟随世界坐标，出现在目标头上方）
    this.interactHint = this.add.text(0, 0, '', {
      fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
      fontSize: '17px', color: '#d4c4a0',
      backgroundColor: '#2a2824ee',
      padding: { x: 10, y: 5 },
      border: 1, borderRadius: 4,
    }).setOrigin(0.5).setDepth(100).setVisible(false);

    // 碰撞编辑器
    this._editor = new CollisionEditor(this);

    // 编辑器快捷键
    this.editKeys = {
      E: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E),
      K: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.K),   // 保存（避免与WASD的S冲突）
      B: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.B),   // 设置出生点
      C: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.C),
      R: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.R),
      I: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.I),
      X: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.X),
      Z: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.Z),
      ENTER: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER),
      ESC: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ESC),
      ONE: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ONE),
      TWO: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.TWO),
      THREE: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.THREE),
      FOUR: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.FOUR),
      FIVE: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.FIVE),
      SIX: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SIX),
      SEVEN: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SEVEN),
      EIGHT: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.EIGHT),
      NINE: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.NINE),
      ZERO: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ZERO),
    };

    // 加载入口区域数据（供 SubSceneManager 使用，即使不在编辑模式也需加载）
    this.time.delayedCall(100, () => {
      this._editor.loadEntryZones();
      this.subSceneManager._reloadEntryZones();
    });

    // 延迟初始化编辑器
    this.time.delayedCall(200, () => this._editor.init());

    // NPC 交互按钮
    this._npcBtnParts = [];
    this.npcActionContainer = this.add.container(0, 0).setDepth(102).setVisible(false).setScrollFactor(0);
    this._createNPCActionButtons();

    // 事件监听
    this.events.on('input:lock', (locked) => {
      this.inputLocked = locked;
      if (locked) {
        // 对话开始：暂停所有 NPC 漫游
        this._npcResumeDelay = -1;
        this._pauseAllNPCWander();
      } else {
        // 对话结束：立即恢复 NPC 漫游
        this._npcResumeDelay = 0;
        this._resumeAllNPCWander();
      }
    });
    this.events.on('game:restart', () => {
      this.scene.stop('UIScene');
      this.scene.restart();
    });
    this.events.on('state:refresh', (state) => {
      // 子场景中有独立 NPC 生命周期，跳过主地图状态刷新
      if (this.subSceneManager.isInSubScene()) return;
      this.refreshNPCsFromState(state);
      this.refreshSceneItems();
    });
    this.events.on('state:reload', this._reloadFromState, this);
    this.events.on('stage:change', (newStage) => {
      this.applyStageTone(newStage);
    });

    // 子场景相关事件
    this.events.on('subscene:stage-renewed', () => {
      this.subSceneManager.triggerStageRenewed();
    });
    this.events.on('subscene:enter', (subSceneId) => {
      this.subSceneManager.enterSubScene(subSceneId);
    });
    this.events.on('subscene:exit', () => {
      this.subSceneManager.exitSubScene();
    });
    // ★ 离开子场景回调 — 序章阶段离开墓地时推进至第一章
    this.events.on('subscene:exited', this._onSubSceneExited, this);

    // ★ 音乐切换事件 — 子场景管理器发出
    this.events.on('music:scene', (subSceneId) => {
      if (this.musicManager) {
        this.musicManager.playForScene(subSceneId || null);
      }
    });

    // 阶段色调遮罩
    this.tintOverlay = this.add.rectangle(
      this.cameras.main.centerX, this.cameras.main.centerY,
      this.cameras.main.width, this.cameras.main.height,
      0xffffff, 0
    );
    this.tintOverlay.setScrollFactor(0).setDepth(999).setOrigin(0.5);
    this.tintOverlay.setInteractive = () => this.tintOverlay;

    this.scene.launch('UIScene');

    // ★ 音频上下文解锁：首次用户交互后启动音乐播放
    const unlockAudio = () => {
      if (this.musicManager) this.musicManager.start();
      this.input.off('pointerdown', unlockAudio);
      this.input.keyboard?.off('keydown', unlockAudio);
    };
    this.input.on('pointerdown', unlockAudio);
    this.input.keyboard?.on('keydown', unlockAudio);

    // ★ 场景停止时销毁音乐管理器（返回主菜单等）
    this.events.on('shutdown', () => {
      if (this.musicManager) {
        this.musicManager.destroy();
        console.log('[GameScene] 音乐管理器已销毁');
      }
    });

    // 控制提示
    this._showControlsHint();

    // 延迟通知 UI 游戏就绪
    this.time.delayedCall(100, () => {
      if (savedSessionId) {
        this.restoreGame(savedSessionId);
      } else {
        this.initGame();
      }
    });
  }

  // ==================== 游戏初始化 ====================

  /** 移除启动黑屏遮罩 — 在进入墓地或存档恢复完成后调用 */
  _removeStartupOverlay() {
    if (this._startupOverlay) {
      this._startupOverlay.destroy();
      this._startupOverlay = null;
    }
  }

  /**
   * 将主地图玩家位置设置到建筑入口区域中心（用于新游戏等场景）
   * @param {string} subSceneId - 子场景ID
   */
  _setPlayerToBuildingEntrance(subSceneId) {
    try {
      const saved = localStorage.getItem('editor_entry_zones');
      if (!saved) return;
      const zones = JSON.parse(saved);
      const entry = zones.find(z => z.subSceneId === subSceneId);
      if (!entry || !entry.zone) return;
      const z = entry.zone;
      const cc = z.col + Math.floor(z.w / 2);
      const rr = z.row + Math.floor(z.h / 2) + 1; // 入口区域中心偏南1格
      const pos = COORD.toPixel(cc, rr);
      this.player.x = pos.x * MAP_SCALE;
      this.player.y = pos.y * MAP_SCALE;
    } catch (_) { /* ignore */ }
  }

  /**
   * 初始化新游戏 — POST /api/game/start → 自动开始第一章
   */
  async initGame() {
    try {
      const { startGame, saveGameState, startChapter } = await import('../api/client.js');
      // ★ 延迟显示加载提示：只在服务器响应超过400ms时才显示，避免一闪而过
      let loadingHintShown = false;
      const hintTimer = setTimeout(() => {
        loadingHintShown = true;
        this._loadingHint = _showLoadingHint(this, '正在创建新的故事……');
      }, 400);

      const gameState = await startGame('玩家');
      clearTimeout(hintTimer);
      if (loadingHintShown) _hideLoadingHint(this._loadingHint);
      if (!gameState || !gameState.session_id) throw new Error('创建游戏失败');

      let stage = gameState.current_stage || 1;
      let chapterId = null, chapterName = null;
      if (gameState.current_chapter) {
        chapterId = gameState.current_chapter.chapter_id;
        chapterName = gameState.current_chapter.chapter_name;
      }
      this.currentStage = stage;

      localStorage.setItem('__active_session__', gameState.session_id);
      saveGameState(gameState.session_id, gameState);
      localStorage.removeItem('subscene_entry_position');
      localStorage.removeItem('subscene_entry_building');

      if (gameState.npcs) {
        try {
          const subId = this.subSceneManager.currentSubSceneId;
          const npcKey = subId
            ? `editor_npc_positions_${subId}`
            : 'editor_npc_positions';
          const saved = localStorage.getItem(npcKey);
          if (saved) {
            const editorPositions = JSON.parse(saved);
            gameState.npcs.forEach(npc => {
              if (editorPositions[npc.id] && editorPositions[npc.id].col !== undefined) {
                npc.position = { ...editorPositions[npc.id] };
              }
            });
          }
        } catch (_) { /* ignore */ }
        this.time.delayedCall(300, () => this.refreshNPCsFromState(gameState));
      }
      this.time.delayedCall(500, () => this.loadTownNPCs());
      this.time.delayedCall(600, () => this.refreshSceneItems());

      this.events.emit('game:init', {
        sessionId: gameState.session_id,
        stage, chapterId, chapterName,
        inventory: gameState.inventory || [],
        dialogueHistory: _convertDialogueHistory(gameState.dialogue_history || [], _buildNpcNameMap(gameState.npcs)),
        npcNames: _buildNpcNameMap(gameState.npcs),
      });

      if (gameState.stage_params) {
        this.time.delayedCall(500, () => this.applyStageTone(gameState.stage_params));
      }

      // ★★★ 核心优化：过渡动画与 API 并行 ★★★
      // 不再先等 API 再播过渡。而是先播过渡（图片已在 BootScene 预加载），
      // 同时从 readyPromise 通道获知 API 何时完成。
      // 用户点击"继续"后，过渡界面会等到 API 就绪再淡出，体验无缝。
      const firstCh = gameState.first_chapter || {};

      // 给过渡动画的 ready 通道：API 完成后 resolve
      let resolveChapterReady;
      const chapterReady = new Promise(resolve => { resolveChapterReady = resolve; });

      // 启动过渡动画（与 API 调用并行，不阻塞）
      const transitionPromise = (async () => {
        await new Promise(r => this.time.delayedCall(200, r));
        const ui = this.scene.get('UIScene');
        if (ui && ui.stageTransition) {
          return ui.stageTransition.play({
            id: 1, // ★ 序章固定用 stage 1 过渡图
            chapterId: 'ch_prologue',
            name: '归乡',
            description: firstCh.description || '',
          }, { readyPromise: chapterReady });
        }
      })();

      // 并行：调 API 获取章节内容（LLM 调用，最耗时）
      // ★ 后端会自动跳过 cinematic 类型的序章，返回的是第一章数据
      let pendingChapterResult = null;
      if (!chapterId) {
        try {
          pendingChapterResult = await startChapter(gameState.session_id);
        } catch (chErr) {
          console.warn('[GameScene] 章节初始化失败（非阻塞）:', chErr);
        }
      }
      // ★ 通知过渡动画：API 已就绪
      resolveChapterReady();

      // ★ 等待过渡动画完全淡出
      await transitionPromise;

      // ★ 关键：保存第一章数据为延后数据（离开墓地时才应用）
      // 现在先发序章的 stage:change，让 HUD 显示"序章 · 归乡"
      if (pendingChapterResult) {
        this._deferredChapterResult = pendingChapterResult;
        console.log('[GameScene] 序章阶段：缓存第一章数据，离开墓地后应用');
      }
      // ★ 发序章的 stage:change（不是第一章的）
      this.events.emit('stage:change', {
        id: 1,
        chapterId: 'ch_prologue',
        name: '归乡',
        description: '离开墓地，踏上归乡之路',
        color_tone: '#8899aa',
        bgm_mood: '',
      });

      // ★ 将主地图玩家位置设为墓地入口区域中心，确保离开墓地时出现在入口处
      this._setPlayerToBuildingEntrance('graveyard');
      // ★ 标记序章阶段，离开墓地时触发章节推进
      this._isProloguePhase = true;
      // 进入墓地
      await this.subSceneManager.enterSubScene('graveyard');
      // 墓地加载完成，移除遮罩露出子场景
      this._removeStartupOverlay();

      // ★ 序章阶段任务提示固定为"离开墓地"
      const uiScene = this.scene.get('UIScene');
      if (uiScene && uiScene._miniTaskHint) {
        uiScene._miniTaskHint.setText('📋 离开墓地');
        uiScene._miniTaskHint.setVisible(true);
      }
      // 同时也缓存序章任务数据给 TaskPanel（不能用第一章的API数据）
      if (uiScene && uiScene.taskPanel) {
        uiScene.taskPanel._taskData = {
          task: {
            chapter_name: '归乡',
            description: '离开墓地，到小镇上去散散心',
            completion_rate: 0,
            sub_tasks: [],
          },
        };
        // 序章迷你提示覆盖
        uiScene._prologueHintText = '离开墓地';
      }

      console.log('[GameScene] 游戏已初始化, session:', gameState.session_id);
    } catch (e) {
      _hideLoadingHint(this._loadingHint);
      console.error('[GameScene] 初始化游戏失败:', e);
      _showToast(this, '连接服务器失败，请确认后端已启动', 3000);
    }
  }

  /**
   * ★ 子场景退出回调：序章阶段离开墓地 → 推进至第一章
   */
  async _onSubSceneExited(exitedSubSceneId) {
    // 只在序章阶段 + 离开的是墓地时触发
    if (!this._isProloguePhase || exitedSubSceneId !== 'graveyard') return;
    if (!this._deferredChapterResult) {
      console.warn('[GameScene] 序章离开墓地但无第一章缓存数据');
      this._isProloguePhase = false;
      return;
    }

    this._isProloguePhase = false;
    const chData = this._deferredChapterResult;
    this._deferredChapterResult = null;
    const ui = this.scene.get('UIScene');
    const stageId = CHAPTER_MAP[chData.chapter_id] || 2;

    console.log('[GameScene] 序章完成，推进至第一章:', chData.chapter_name);

    // 1. 移除序章迷你提示覆盖，让 TaskPanel 从 API 数据取
    if (ui) {
      delete ui._prologueHintText;
    }

    // 2. 发 stage:change → 更新 HUD（序章 → 第一章）
    const newStage = {
      id: stageId,
      chapterId: chData.chapter_id,
      name: chData.chapter_name || '闻声·异样',
      description: chData.task ? chData.task.description : '',
      color_tone: chData.color_tone || '#8899cc',
      bgm_mood: chData.bgm_mood || '',
    };
    this.events.emit('stage:change', newStage);

    // 3. 播放章节过渡动画（序章 → 第一章）
    if (ui && ui.stageTransition) {
      await ui.stageTransition.play(newStage);
    }

    // 4. 刷新任务面板 + 同步左侧迷你提示
    if (ui && ui.taskPanel) {
      ui.taskPanel._taskData = chData;
      await ui.taskPanel.refreshContent();
    }

    console.log('[GameScene] 第一章已就绪');
  }

  /**
   * 恢复存档游戏
   */
  async restoreGame(sessionId) {
    // ★ create() 时已在主地图初始状态，无需 forceExitSubScene
    try {
      const { getGameState, saveGameState } = await import('../api/client.js');
      this._loadingHint = _showLoadingHint(this, '正在加载存档……');

      let gameState = null;
      try {
        gameState = await getGameState(sessionId);
      } catch (apiErr) {
        console.warn('[GameScene] API 获取状态失败，回退到本地缓存:', apiErr.message);
      }

      if (!gameState || !gameState.session_id) {
        const saved = localStorage.getItem(`game_state_${sessionId}`);
        if (!saved) throw new Error('存档不存在');
        gameState = JSON.parse(saved);
      }

      // ★ 从 localStorage 合并仅前端持有的位置数据（后端 API 不含这些字段）
      _mergeLocalPositionState(sessionId, gameState);

      _hideLoadingHint(this._loadingHint);
      console.log('[GameScene] 恢复存档, session:', sessionId, 'stage:', gameState.current_stage);
      // ★ 诊断日志：检查存档中是否包含位置数据
      if (gameState.npcs && Array.isArray(gameState.npcs)) {
        const firstNpc = gameState.npcs[0];
        console.log('[GameScene] restoreGame: npcs[0].position =', firstNpc?.position, 'firstNpc.id =', firstNpc?.id, 'total npcs:', gameState.npcs.length);
      } else {
        console.warn('[GameScene] restoreGame: gameState.npcs is missing or not array');
      }
      console.log('[GameScene] restoreGame: _town_npc_positions =', gameState._town_npc_positions?.length || 0, 'items');
      console.log('[GameScene] restoreGame: _player_position =', gameState._player_position);

      localStorage.setItem('__active_session__', sessionId);
      this.currentStage = gameState.current_stage || 1;

      let chapterId = null, chapterName = null;
      if (gameState.current_chapter) {
        chapterId = gameState.current_chapter.chapter_id;
        chapterName = gameState.current_chapter.chapter_name;
      }

      this.events.emit('game:init', {
        sessionId, stage: this.currentStage, chapterId, chapterName,
        inventory: gameState.inventory || [],
        dialogueHistory: _convertDialogueHistory(gameState.dialogue_history || [], _buildNpcNameMap(gameState.npcs)),
        npcNames: _buildNpcNameMap(gameState.npcs),
      });

      // 读档后刷新任务面板
      this.time.delayedCall(200, () => {
        const ui = this.scene.get('UIScene');
        if (ui && ui.taskPanel) ui.taskPanel.refreshContent();
      });

      // ★ 子场景存档恢复：如果存档时玩家在子场景中，跳过主地图加载
      if (gameState._sub_scene_id) {
        console.log('[GameScene] restoreGame: 检测到子场景存档', gameState._sub_scene_id);
        saveGameState(sessionId, gameState);
        this._removeStartupOverlay();
        this.time.delayedCall(300, () => {
          this._reloadSubSceneFromState(gameState, gameState._sub_scene_id);
        });
        if (gameState.stage_params) {
          this.time.delayedCall(500, () => this.applyStageTone(gameState.stage_params));
        }
        return;
      }

      // ★ 主地图路径：同步恢复主角位置（不等 NPC 异步加载完成）
      this._restorePlayerFromState(gameState);
      this._removeStartupOverlay();

      // ★ 恢复主地图背景音乐
      this.events.emit('music:scene', null);

      if (gameState.npcs) {
        this.time.delayedCall(300, () => this.refreshNPCsFromState(gameState));
      }
      // 先加载普通 NPC，完成后恢复位置（避免异步时序导致位置未生效）
      this._townNpcLoadPromise = this.loadTownNPCs();
      this.time.delayedCall(500, () => this.refreshSceneItems());

      // ★ 等待 loadTownNPCs 完成后恢复普通 NPC 和主角位置
      this._townNpcLoadPromise.then(() => {
        this._restoreTownNPCAndPlayerPositions(gameState);
      }).catch(() => {
        this._restoreTownNPCAndPlayerPositions(gameState);
      });

      saveGameState(sessionId, gameState);

      if (gameState.game_ended && gameState.ending) {
        this.time.delayedCall(500, () => {
          this.events.emit('ending:restore', gameState.ending);
        });
      }

      if (gameState.stage_params) {
        this.time.delayedCall(500, () => this.applyStageTone(gameState.stage_params));
      }
    } catch (e) {
      _hideLoadingHint(this._loadingHint);
      console.warn('[GameScene] 恢复存档失败，开始新游戏:', e);
      this.initGame();
    }
  }

  /**
   * 就地重新加载存档状态 — 不重启场景，无缝刷新所有游戏实体。
   * 由 SaveManager.onLoad() 通过 state:reload 事件触发。
   */
  _reloadFromState(gameState) {
    const sessionId = gameState.session_id;
    if (!sessionId) return;

    const savedSubSceneId = gameState._sub_scene_id;
    console.log('[GameScene] reloadFromState: stage=', gameState.current_stage,
      'npcs=', gameState.npcs?.length,
      'subSceneId=', savedSubSceneId, 'currentSubScene=', this.subSceneManager.currentSubSceneId);

    // ★ 根据目标场景类型决定清理策略
    if (savedSubSceneId) {
      // ★★★ 子场景存档：清理当前实体但不恢复主地图实体（enterSubScene 的 fadeOut 会遮住过渡）
      this.subSceneManager._destroyAllEntities();
      // 销毁子场景UI（如果当前在子场景中），避免残留
      this.subSceneManager._cleanSubSceneUI();
    } else {
      // ★★★ 主地图存档：退出子场景并恢复主地图 ★★★
      if (this.subSceneManager.isInSubScene()) {
        this.subSceneManager.forceExitSubScene();
      } else {
        this.subSceneManager._destroyAllEntities();
      }
      // 从 localStorage 合并位置数据
      _mergeLocalPositionState(sessionId, gameState);
    }

    // 1. 更新本地阶段 + 缓存
    this.currentStage = gameState.current_stage || 1;
    localStorage.setItem('__active_session__', sessionId);
    import('../api/client.js').then(({ saveGameState }) => {
      saveGameState(sessionId, gameState);
    });

    // 2. 通知 UIScene 更新 session/阶段/背包/章节
    let chapterId = null, chapterName = null;
    if (gameState.current_chapter) {
      chapterId = gameState.current_chapter.chapter_id;
      chapterName = gameState.current_chapter.chapter_name;
    }
    const npcNames = _buildNpcNameMap(gameState.npcs);
    const dialogueHistory = _convertDialogueHistory(gameState.dialogue_history || [], npcNames);

    this.events.emit('game:init', {
      sessionId, stage: this.currentStage, chapterId, chapterName,
      inventory: gameState.inventory || [],
      dialogueHistory,
      npcNames,
    });

    // 子场景读档后刷新任务面板
    this.time.delayedCall(200, () => {
      const ui = this.scene.get('UIScene');
      if (ui && ui.taskPanel) ui.taskPanel.refreshContent();
    });

    // 3. 应用阶段色调
    if (gameState.stage_params) {
      this.time.delayedCall(300, () => this.applyStageTone(gameState.stage_params));
    }

    // 4. 结局状态处理
    if (gameState.game_ended && gameState.ending) {
      this.time.delayedCall(500, () => {
        this.events.emit('ending:restore', gameState.ending);
      });
    }

    // ====== 分路径恢复 ======
    if (savedSubSceneId) {
      console.log(`[GameScene] 检测到子场景存档: ${savedSubSceneId}，直接恢复子场景`);
      this._reloadSubSceneFromState(gameState, savedSubSceneId);
    } else {
      this._reloadMainMapFromState(gameState);
      // ★ 恢复主地图背景音乐
      this.events.emit('music:scene', null);
    }

    // 解锁输入
    this.events.emit('input:lock', false);
  }

  /**
   * 从子场景存档恢复 — 直接进入子场景，不加载主地图实体
   */
  _reloadSubSceneFromState(gameState, subSceneId) {
    // ★ 确保主角可见（可能在之前的子场景中被隐藏）
    if (this.player) {
      this.player.setVisible(true);
      this.player.setAlpha(1);
      this.player.setTexture(`${PROTAGONIST.prefix}_idle_down`);
    }

    // 延迟进入子场景，等待 forceExitSubScene 的地图渲染完成
    this.time.delayedCall(200, () => {
      this.subSceneManager.enterSubScene(subSceneId, {
        playerPos: gameState._sub_scene_player_position || null,
        storyNpcPositions: gameState._sub_scene_story_npc_positions || null,
      });
    });
  }

  /**
   * 同步恢复主角位置和可见性（主地图坐标，MAP_SCALE）
   * 用于 restoreGame 和 _reloadMainMapFromState 共享
   */
  _restorePlayerFromState(gameState) {
    if (!gameState._player_position || !this.player) return;
    const { col, row } = gameState._player_position;
    const { x: px, y: py } = COORD.toPixel(col, row);
    this.player.x = px * MAP_SCALE;
    this.player.y = py * MAP_SCALE;
    this.player.setTexture(`${PROTAGONIST.prefix}_idle_down`);
    this.player.setVisible(true);
    this.player.setAlpha(1);
    this.player.setDepth(10);
    const br = PROTAGONIST.bodyRatio;
    const bodyW = Math.floor(this.player.displayWidth * br.w);
    const bodyH = Math.floor(this.player.displayHeight * br.h);
    this.player.body.setSize(bodyW, bodyH);
    this.player.body.setOffset(bodyW * br.offsetX, this.player.displayHeight * br.offsetY);
  }

  /**
   * 从主地图存档恢复 — 加载所有主地图实体
   */
  _reloadMainMapFromState(gameState) {
    // ★ 同步恢复主角位置
    this._restorePlayerFromState(gameState);

    // 刷新剧情 NPC
    if (gameState.npcs) {
      this.time.delayedCall(100, () => this.refreshNPCsFromState(gameState));
    }

    // 加载普通 NPC + 完成后恢复位置
    this._townNpcLoadPromise = this.loadTownNPCs();
    this.time.delayedCall(300, () => this.refreshSceneItems());

    this._townNpcLoadPromise.then(() => {
      this._restoreTownNPCAndPlayerPositions(gameState);
    }).catch(() => {
      this._restoreTownNPCAndPlayerPositions(gameState);
    });
  }

  // ==================== 场景物品系统 ====================

  /** 从 localStorage 加载编辑器配置的场景物品（支持主/子场景区分） */
  refreshSceneItems(subSceneId = null) {
    // 清空现有物品
    this.sceneItems.forEach(sp => { this.tweens.killTweensOf(sp); sp.destroy(); });
    this.sceneItems = [];
    this.currentNearbyItem = null;

    // 获取背包中已有的物品 ID 集合，已收集的物品不再在场景中渲染
    let ownedItemIds = new Set();
    try {
      const ui = this.scene.get('UIScene');
      if (ui && ui.inventory) {
        ui.inventory.forEach(i => {
          const id = i.id || i.item_id;
          if (id) ownedItemIds.add(id);
        });
      }
    } catch (_) { /* ignore */ }

    try {
      const itemKey = subSceneId
        ? `editor_item_positions_${subSceneId}`
        : 'editor_item_positions';
      const saved = localStorage.getItem(itemKey);
      if (!saved) return;
      const items = JSON.parse(saved);
      if (!Array.isArray(items)) return;

      // 子场景使用子场景缩放 + 居中偏移（含动态 displayScale）
      const scale = subSceneId
        ? SUB_MAP_SCALE * ((SUBSCENES[subSceneId]?.displayScale) || 1.0)
        : MAP_SCALE;
      const off = subSceneId ? (this.subSceneManager._subSceneOffset || { x: 0, y: 0 }) : { x: 0, y: 0 };

      let skipped = 0;
      items.forEach(item => {
        if (item.col == null || item.row == null) return;
        // ★ 已收集的物品不再渲染
        if (item.item_id && ownedItemIds.has(item.item_id)) {
          skipped++;
          return;
        }
        this._createSceneItemSprite(item, scale, off);
      });
      console.log(`[GameScene] 编辑器物品已加载: ${this.sceneItems.length} 个` + (skipped ? ` (跳过${skipped}个已收集)` : ''));
    } catch (e) {
      console.warn('[GameScene] 加载编辑器物品失败:', e);
    }
  }

  /** 创建单个场景物品精灵（支持主/子场景缩放和偏移） */
  _createSceneItemSprite(itemData, scale = MAP_SCALE, offset = { x: 0, y: 0 }) {
    const pos = COORD.toPixel(itemData.col, itemData.row);
    const px = offset.x + pos.x * scale;
    const py = offset.y + pos.y * scale;

    const sprite = this.add.text(px, py, itemData.emoji || '📦', {
      fontSize: `${(itemData.size || 20) * scale}px`,
    }).setOrigin(0.5).setDepth(90);

    sprite.setData('itemId', itemData.item_id || itemData.id || 'item_' + Math.random().toString(36).slice(2, 8));
    sprite.setData('name', itemData.name || '未知物品');
    sprite.setData('editorIdx', itemData._editorIdx ?? -1);

    this.tweens.add({
      targets: sprite,
      y: py - 4 * scale,
      duration: 1200, yoyo: true, repeat: -1,
      ease: 'Sine.easeInOut',
    });

    // ★ 添加闪光效果（alpha呼吸 + 缩放脉冲）
    _addItemSparkle(this, sprite);

    this.sceneItems.push(sprite);
    return sprite;
  }

  // ==================== 普通 NPC 系统 ====================

  /** 加载普通 NPC（town-npcs） */
  async loadTownNPCs() {
    try {
      const { getTownNPCs } = await import('../api/client.js');
      const data = await getTownNPCs('liyuan_shengsi');

      this.townNpcs.forEach(sp => sp.destroy());
      this.townNpcBubbles.forEach(b => b.destroy());
      this.townNpcs = [];
      this.townNpcBubbles = [];

      const townNpcList = data.town_npcs || [];
      townNpcList.forEach(townNpc => {
        const sprite = this._createTownNPCSprite(townNpc);
        if (sprite) {
          this.townNpcs.push(sprite);
          const bubbleText = this.add.text(sprite.x, sprite.y - 18 * MAP_SCALE, townNpc.greeting || '', {
            fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
            fontSize: '14px', color: '#c8dcc8',
            backgroundColor: '#1a2824dd',
            padding: { x: 6, y: 3 },
            wordWrap: { width: 140 }, align: 'center', lineSpacing: 3,
          }).setOrigin(0.5).setDepth(100);
          this.townNpcBubbles.push(bubbleText);
          sprite.setData('wanderState', this._initWanderState(townNpc));
        }
      });
      console.log(`[GameScene] 普通NPC已加载: ${this.townNpcs.length} 个`);
    } catch (e) {
      console.warn('[GameScene] 加载普通NPC失败（非阻塞）:', e);
    }
  }

  /** 创建单个普通 NPC 精灵 */
  _createTownNPCSprite(townNpc) {
    const cfg = FALLBACK_NPC_SPRITE;
    const col = townNpc.position?.col || 30;
    const row = townNpc.position?.row || 40;
    const { x: posX, y: posY } = COORD.toPixel(col, row);
    const startKey = `${cfg.prefix}_idle_down`;

    const sprite = this.physics.add.sprite(posX * MAP_SCALE, posY * MAP_SCALE, startKey);
    sprite.setScale(cfg.scale);
    sprite.setData('npcId', townNpc.id);
    sprite.setData('name', townNpc.name);
    sprite.setData('greeting', townNpc.greeting || '');
    sprite.setData('spriteCfg', cfg);
    sprite.setData('isTownNPC', true);
    sprite.setData('role', townNpc.role || null);
    sprite.setImmovable(true);
    sprite.body.pushable = false;
    sprite.setDepth(4).setVisible(true);
    return sprite;
  }

  /** 初始化 NPC 漫游状态 */
  _initWanderState(townNpc) {
    const movement = townNpc.movement || {};
    return {
      enabled: movement.enabled !== false,
      speed: (movement.speed || 35) * 0.01,
      idleTimer: 0,
      idleDuration: (movement.idle_range?.[0] || 3) * 60 + Math.random() * ((movement.idle_range?.[1] || 8) - (movement.idle_range?.[0] || 3)) * 60,
      wanderTimer: 0,
      wanderDuration: (movement.wander_range?.[4] || 6) * 60,
      state: 'idle',
      targetX: 0, targetY: 0,
      originCol: townNpc.position?.col || 30,
      originRow: townNpc.position?.row || 40,
      wanderRange: movement.wander_range?.[1] || 10,
    };
  }

  /**
   * 收集当前所有 NPC 和主角的实时瓦片坐标
   * @returns {{ storyNpcs: Array, townNpcs: Array, player: Object, subSceneId: string|null }}
   */
  collectPositions() {
    const effectiveScale = this.subSceneManager.getEffectiveScale();
    const off = this.subSceneManager._subSceneOffset || { x: 0, y: 0 };
    const storyNpcs = this.npcs.map(npc => {
      const tile = COORD.toTile((npc.x - off.x) / effectiveScale, (npc.y - off.y) / effectiveScale);
      return { npc_id: npc.getData('npcId'), position: { col: tile.col, row: tile.row } };
    });
    const townNpcs = this.townNpcs.map(npc => {
      const tile = COORD.toTile((npc.x - off.x) / effectiveScale, (npc.y - off.y) / effectiveScale);
      return { npc_id: npc.getData('npcId'), position: { col: tile.col, row: tile.row } };
    });
    const playerTile = this.player
      ? COORD.toTile((this.player.x - off.x) / effectiveScale, (this.player.y - off.y) / effectiveScale)
      : { col: 7, row: 5 };

    return { storyNpcs, townNpcs, player: playerTile, subSceneId: this.subSceneManager.currentSubSceneId };
  }

  /** 从存档 state 恢复普通 NPC 和主角位置 */
  _restoreTownNPCAndPlayerPositions(gameState) {
    // 恢复普通 NPC 位置
    const savedTownNPCs = gameState._town_npc_positions;
    if (savedTownNPCs && Array.isArray(savedTownNPCs)) {
      savedTownNPCs.forEach(saved => {
        const sprite = this.townNpcs.find(s => s.getData('npcId') === saved.npc_id);
        if (sprite && saved.position) {
          const { x: px, y: py } = COORD.toPixel(saved.position.col, saved.position.row);
          sprite.x = px * MAP_SCALE;
          sprite.y = py * MAP_SCALE;
          // 重置漫游原点
          const wander = sprite.getData('wanderState');
          if (wander) {
            wander.originCol = saved.position.col;
            wander.originRow = saved.position.row;
          }
        }
      });
    }
    // 恢复主角位置
    if (gameState._player_position && this.player) {
      const { col, row } = gameState._player_position;
      const { x: px, y: py } = COORD.toPixel(col, row);
      this.player.x = px * MAP_SCALE;
      this.player.y = py * MAP_SCALE;
    }
  }

  /** 暂停所有 NPC 漫游（对话开始时调用） */
  _pauseAllNPCWander() {
    const freeze = (npc) => {
      const wander = npc.getData('wanderState');
      if (wander) {
        wander.enabled = false;
        wander.state = 'idle';
      }
    };
    this.npcs.forEach(freeze);
    this.townNpcs.forEach(freeze);
  }

  /** 恢复所有 NPC 漫游（对话结束后延迟调用） */
  _resumeAllNPCWander() {
    const resume = (npc) => {
      const wander = npc.getData('wanderState');
      if (wander) wander.enabled = true;
    };
    this.npcs.forEach(resume);
    this.townNpcs.forEach(resume);
  }

  /** 更新所有 NPC 漫游行为（每帧调用，覆盖故事NPC + 普通NPC） */
  _updateTownNPCs(dt) {
    const self = this;
    const effectiveScale = this.subSceneManager.getEffectiveScale();
    // 子场景使用实际地图区域作为漫游边界
    const subMap = this.subSceneManager._subMapArea;
    let mapW, mapH, marginX = 0, marginY = 0;
    if (subMap) {
      mapW = subMap.w;
      mapH = subMap.h;
      marginX = subMap.x;
      marginY = subMap.y;
    } else {
      const mapBounds = this._mapBounds;
      mapW = mapBounds ? mapBounds.w : MAP_COLS * TILE * MAP_SCALE;
      mapH = mapBounds ? mapBounds.h : MAP_ROWS * TILE * MAP_SCALE;
    }
    const margin = TILE * effectiveScale;
    const npcCheckDist = TILE * effectiveScale * 0.6; // NPC 碰撞检测距离

    // 辅助函数：驱动单个 NPC 的 wander AI
    const _driveNPC = (npc) => {
      const wander = npc.getData('wanderState');
      if (!wander || !wander.enabled || !npc.active) return;

      switch (wander.state) {
        case 'idle':
          wander.idleTimer++;
          if (Math.random() < 0.005) {
            const randDirs = ['down', 'left', 'right', 'up'];
            const dir = randDirs[Math.floor(Math.random() * randDirs.length)];
            const cfg = npc.getData('spriteCfg');
            if (cfg) npc.setTexture(`${cfg.prefix}_idle_${dir}`);
          }
          if (wander.idleTimer >= wander.idleDuration) {
            // 尝试多次获取有效目标，避开碰撞区域
            let foundTarget = false;
            for (let attempt = 0; attempt < 8; attempt++) {
              const angle = Math.random() * Math.PI * 2;
              const dist = (3 + Math.random() * (wander.wanderRange - 3)) * margin;
              const minX = marginX + margin, maxX = marginX + mapW - margin;
              const minY = marginY + margin, maxY = marginY + mapH - margin;
              const tx = Phaser.Math.Clamp(npc.x + Math.cos(angle) * dist, minX, maxX);
              const ty = Phaser.Math.Clamp(npc.y + Math.sin(angle) * dist, minY, maxY);
              if (!self._checkCollisionAt(tx, ty)) {
                wander.targetX = tx;
                wander.targetY = ty;
                foundTarget = true;
                break;
              }
            }
            if (foundTarget) {
              wander.state = 'wandering';
              wander.wanderTimer = 0;
              wander.wanderDuration = wander.wanderRange * 40 + Math.random() * 60;
            } else {
              // 无有效目标，重新计时空闲
              wander.idleTimer = 0;
              wander.idleDuration = (2 + Math.random() * 3) * 60;
            }
          }
          break;
        case 'wandering':
          wander.wanderTimer++;
          const dx = wander.targetX - npc.x;
          const dy = wander.targetY - npc.y;
          const distToTarget = Math.sqrt(dx * dx + dy * dy);
          // 超时或到达目标 → 进入空闲
          if (distToTarget < 5 || wander.wanderTimer > wander.wanderDuration) {
            wander.state = 'idle';
            wander.idleTimer = 0;
            wander.idleDuration = (3 + Math.random() * 5) * 60;
            const cfg = npc.getData('spriteCfg');
            if (cfg) npc.setTexture(`${cfg.prefix}_idle_down`);
          } else {
            const moveSpeed = wander.speed * (dt / 16.667);
            const rawVX = (dx / distToTarget) * moveSpeed;
            const rawVY = (dy / distToTarget) * moveSpeed;

            // 逐轴检测碰撞后再移动
            let vx = rawVX, vy = rawVY;
            if (vx !== 0) {
              const probeX = npc.x + (vx > 0 ? npcCheckDist : -npcCheckDist);
              if (self._checkCollisionAt(probeX, npc.y)) vx = 0;
            }
            if (vy !== 0) {
              const probeY = npc.y + (vy > 0 ? npcCheckDist : -npcCheckDist);
              if (self._checkCollisionAt(npc.x, probeY)) vy = 0;
            }

            // 如果完全被卡住，短暂发呆后重置
            if (vx === 0 && vy === 0) {
              wander.stuckTimer = (wander.stuckTimer || 0) + 1;
              if (wander.stuckTimer > 90) {
                wander.state = 'idle';
                wander.idleTimer = 0;
                wander.idleDuration = (2 + Math.random() * 3) * 60;
                wander.stuckTimer = 0;
              }
            } else {
              wander.stuckTimer = 0;
              npc.x += vx;
              npc.y += vy;
            }

            const cfg = npc.getData('spriteCfg');
            if (cfg) {
              let facing = 'down';
              if (Math.abs(vx) > Math.abs(vy)) {
                facing = vx > 0 ? 'right' : 'left';
              } else {
                facing = vy > 0 ? 'down' : 'up';
              }
              npc.setTexture(`${cfg.prefix}_walk_${facing}`);
            }
          }
          break;
      }
    };

    // 驱动故事 NPC 漫游（气泡由 _updateNPCProximity 统一处理）
    for (let i = 0; i < this.npcs.length; i++) {
      _driveNPC(this.npcs[i]);
    }

    // 驱动普通 NPC 漫游 + 气泡跟随
    for (let i = 0; i < this.townNpcs.length; i++) {
      _driveNPC(this.townNpcs[i]);
      const bubble = this.townNpcBubbles[i];
      if (bubble) bubble.setPosition(this.townNpcs[i].x, this.townNpcs[i].y - 18 * effectiveScale);
    }
  }

  // ==================== NPC 管理 ====================

  /** 根据状态刷新 NPC */
  refreshNPCsFromState(state) {
    if (!state || !state.npcs) return;
    state.npcs.forEach(stateNpc => {
      let sprite = this.npcs.find(s => s.getData('npcId') === stateNpc.id);
      if (!sprite) {
        sprite = this._createNPCSprite(stateNpc.id, stateNpc.name, stateNpc);
        if (!sprite) return;
        this.npcs.push(sprite);
        const bubbleText = this.add.text(sprite.x, sprite.y - 20 * MAP_SCALE, stateNpc.current_greeting || '', {
          fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
          fontSize: '16px', color: '#e8dcc8',
          backgroundColor: '#2a2824dd',
          padding: { x: 8, y: 4 },
          wordWrap: { width: 170 }, align: 'center', lineSpacing: 4,
        }).setOrigin(0.5).setDepth(101);
        this.npcBubbles.push(bubbleText);
      }
      if (sprite) {
        sprite.setData('greeting', stateNpc.current_greeting);
        sprite.setData('name', stateNpc.name);
        sprite.setVisible(stateNpc.is_available !== false);
        // ★ 恢复 NPC 位置：编辑器位置优先于后端位置
        //    章节推进或阶段切换时 UIScene 会发 state:refresh 携带后端原始位置，
        //    必须用编辑器保存的位置覆盖，否则 NPC 会被拉回后端默认位置。
        let useCol, useRow;
        try {
          const subId = this.subSceneManager.currentSubSceneId;
          const npcKey = subId ? `editor_npc_positions_${subId}` : 'editor_npc_positions';
          const saved = localStorage.getItem(npcKey);
          if (saved) {
            const editorPositions = JSON.parse(saved);
            if (editorPositions[stateNpc.id] && editorPositions[stateNpc.id].col !== undefined) {
              useCol = editorPositions[stateNpc.id].col;
              useRow = editorPositions[stateNpc.id].row;
            }
          }
        } catch (_) { /* ignore */ }
        if (useCol === undefined && stateNpc.position && stateNpc.position.col !== undefined) {
          useCol = stateNpc.position.col;
          useRow = stateNpc.position.row;
        }
        if (useCol !== undefined) {
          const { x: px, y: py } = COORD.toPixel(useCol, useRow);
          sprite.x = px * MAP_SCALE;
          sprite.y = py * MAP_SCALE;
          // 同步气泡位置
          const idx = this.npcs.indexOf(sprite);
          if (idx >= 0 && this.npcBubbles[idx]) {
            this.npcBubbles[idx].setPosition(sprite.x, sprite.y - 20 * MAP_SCALE);
          }
          // 重置漫游原点
          const wander = sprite.getData('wanderState');
          if (wander) {
            wander.originCol = useCol;
            wander.originRow = useRow;
          }
        }
        const idx = this.npcs.indexOf(sprite);
        if (idx >= 0 && this.npcBubbles[idx]) {
          this.npcBubbles[idx].setText(stateNpc.current_greeting || '');
          this.npcBubbles[idx].setVisible(stateNpc.is_available !== false);
        }
      }
    });
  }

  /** 动态创建 NPC 精灵 */
  _createNPCSprite(npcId, name, stateNpc) {
    const cfg = NPC_SPRITES[npcId];
    if (!cfg) {
      console.warn(`[GameScene] NPC ${npcId} 无精灵配置，跳过创建`);
      return null;
    }

    let col, row;
    try {
      // ★ 用正确的 subId key 读编辑器位置
      const subId = this.subSceneManager.currentSubSceneId;
      const npcKey = subId ? `editor_npc_positions_${subId}` : 'editor_npc_positions';
      const saved = localStorage.getItem(npcKey);
      if (saved) {
        const savedPos = JSON.parse(saved);
        if (savedPos && savedPos[npcId]) {
          col = savedPos[npcId].col;
          row = savedPos[npcId].row;
        }
      }
    } catch (e) { /* ignore */ }

    if (col === undefined) {
      const defaultPos = npcId === 'npc_chen' ? { col: 43, row: 16 } : { col: 11, row: 10 };
      col = stateNpc.position ? stateNpc.position.col : defaultPos.col;
      row = stateNpc.position ? stateNpc.position.row : defaultPos.row;
    }

    const { x: posX, y: posY } = COORD.toPixel(col, row);
    const textureKey = `${cfg.prefix}_idle_down`;
    // ★ 纹理检查：验证纹理是否已加载
    if (!this.textures.exists(textureKey)) {
      console.warn(`[GameScene] _createNPCSprite: NPC "${npcId}" 纹理 "${textureKey}" 未加载，使用回退精灵`);
    }
    const useKey = this.textures.exists(textureKey) ? textureKey : FALLBACK_TEXTURE_KEY;

    const sprite = this.physics.add.sprite(posX * MAP_SCALE, posY * MAP_SCALE, useKey);
    sprite.setScale(cfg.scale);
    sprite.setData('npcId', npcId);
    sprite.setData('name', name);
    sprite.setData('greeting', stateNpc.current_greeting || '');
    sprite.setData('spriteCfg', cfg);
    sprite.setData('isTownNPC', !NPC_SPRITES[npcId]);
    sprite.setImmovable(true);
    sprite.body.pushable = false;
    sprite.setDepth(5);
    sprite.setVisible(stateNpc.is_available !== false);

    // 初始化故事 NPC 漫游状态（动态创建的 NPC）
    if (!sprite.getData('isTownNPC')) {
      sprite.setData('wanderState', this._initWanderState({
        position: { col, row },
        movement: { enabled: true, speed: 25, idle_range: [4, 10], wander_range: [2, 5] },
      }));
    }

    this.physics.add.overlap(this.player, sprite, () => {});
    return sprite;
  }

  /** 创建初始 NPC（带去重保护） */
  createNPCs() {
    let savedNPCPositions = null;
    try {
      const saved = localStorage.getItem('editor_npc_positions');
      if (saved) savedNPCPositions = JSON.parse(saved);
    } catch (e) { /* ignore */ }

    const defaultNPCs = [
      { id: 'npc_chen', name: '陈师傅', col: 43, row: 16, greeting: '……（低头擦琴，仿佛没看见你）' },
      { id: 'npc_xiaohua', name: '小华', col: 11, row: 10, greeting: '你也是来看戏班笑话的吗？' },
    ];

    defaultNPCs.forEach((def) => {
      // ★ 去重：如果该 npcId 的精灵已存在，跳过创建（防止 refresh/initGame 重复调用）
      if (this.npcs.some(s => s.getData('npcId') === def.id)) {
        console.log(`[GameScene] createNPCs: ${def.id} 已存在，跳过`);
        return;
      }

      const pos = savedNPCPositions && savedNPCPositions[def.id]
        ? savedNPCPositions[def.id] : { col: def.col, row: def.row };
      const pixelPos = COORD.toPixel(pos.col, pos.row);
      const cfg = NPC_SPRITES[def.id];
      let startKey = cfg ? `${cfg.prefix}_idle_down` : null;

      // ★ 纹理检查：如果主纹理不存在，回退到 FALLBACK_TEXTURE_KEY
      if (startKey && !this.textures.exists(startKey)) {
        console.warn(`[GameScene] NPC ${def.id} 纹理 "${startKey}" 未加载，使用回退精灵`);
        startKey = null;
      }
      const useKey = startKey || FALLBACK_TEXTURE_KEY;

      const sprite = this.physics.add.sprite(
        pixelPos.x * MAP_SCALE, pixelPos.y * MAP_SCALE,
        useKey
      );
      sprite.setScale(cfg ? cfg.scale : FALLBACK_NPC_SPRITE.scale);
      sprite.setData('npcId', def.id);
      sprite.setData('name', def.name);
      sprite.setData('greeting', def.greeting);
      sprite.setData('spriteCfg', cfg || null);
      sprite.setImmovable(true);
      sprite.body.pushable = false;
      sprite.setDepth(5);

      const bubbleText = this.add.text(sprite.x, sprite.y - 20 * MAP_SCALE, def.greeting, {
        fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
        fontSize: '16px', color: '#e8dcc8',
        backgroundColor: '#2a2824dd',
        padding: { x: 8, y: 4 },
        wordWrap: { width: 170 }, align: 'center', lineSpacing: 4,
      }).setOrigin(0.5).setDepth(101);

      // 初始化主要 NPC 漫游状态
      sprite.setData('wanderState', this._initWanderState({
        position: pos,
        movement: { enabled: true, speed: 25, idle_range: [4, 10], wander_range: [2, 5] },
      }));

      this.npcs.push(sprite);
      this.npcBubbles.push(bubbleText);
    });

    this.currentNearbyNPC = null;
    this.physics.add.overlap(this.player, this.npcs, (_player, npc) => {
      this.currentNearbyNPC = npc;
    });
  }

  // ==================== 地图与碰撞 ====================

  drawTileMap() {
    this.mapImage = this.add.image(0, 0, 'town_worldmap').setOrigin(0, 0);
    this.mapImage.setDepth(0).setScale(MAP_SCALE);
  }

  createCollisionLayer() {
    this.collisionZones = [];
    try {
      const saved = localStorage.getItem('editor_collision_map');
      if (saved) {
        this._collisionMap = JSON.parse(saved);
        console.log('[Editor] 已加载碰撞数据, 碰撞格数:', Object.keys(this._collisionMap).length);
      }
    } catch (e) {
      console.warn('[Editor] 加载碰撞数据失败:', e);
      this._collisionMap = {};
    }
  }

  /** 检查网格碰撞 - 支持 2x2 覆盖检测（子场景自动减去居中偏移） */
  _checkCollisionAt(worldX, worldY) {
    if (!this._collisionMap || Object.keys(this._collisionMap).length === 0) return false;
    const effectiveScale = this.subSceneManager.getEffectiveScale();
    const off = this.subSceneManager._subSceneOffset;
    const adjX = off ? worldX - off.x : worldX;
    const adjY = off ? worldY - off.y : worldY;
    const gridPx = TILE * effectiveScale;
    const col = Math.floor(adjX / gridPx);
    const row = Math.floor(adjY / gridPx);
    for (let dc = 0; dc <= 1; dc++) {
      for (let dr = 0; dr <= 1; dr++) {
        if (this._collisionMap[`${col + dc}_${row + dr}`]) return true;
      }
    }
    return false;
  }

  /** 保存碰撞配置、NPC 位置和物品位置到 localStorage */
  _saveToLocalStorage() {
    const npcPositions = {};
    const effectiveScale = this.subSceneManager.getEffectiveScale();
    const off = this.subSceneManager._subSceneOffset || { x: 0, y: 0 };
    for (const npc of this.npcs) {
      const tile = COORD.toTile((npc.x - off.x) / effectiveScale, (npc.y - off.y) / effectiveScale);
      npcPositions[npc.getData('npcId')] = { col: tile.col, row: tile.row };
    }
    // ★ 合并模式：已有物品更新位置，新物品追加，互不干扰
    const subId = this.subSceneManager.currentSubSceneId;
    const itemKey = subId
      ? `editor_item_positions_${subId}`
      : 'editor_item_positions';
    // 1. 读取已持久化的物品位置
    let existingItems = [];
    try {
      const saved = localStorage.getItem(itemKey);
      if (saved) existingItems = JSON.parse(saved);
      if (!Array.isArray(existingItems)) existingItems = [];
    } catch (_) { existingItems = []; }
    // 2. 按 item_id 建立映射
    const itemMap = {};
    existingItems.forEach((item, idx) => {
      if (item.item_id) itemMap[item.item_id] = { ...item, _editorIdx: idx };
    });
    // 3. 当前场景中的物品 → 更新或新增到映射
    this.sceneItems.forEach((sp) => {
      const itemId = sp.getData('itemId');
      if (!itemId) return;
      const tile = COORD.toTile((sp.x - off.x) / effectiveScale, (sp.y - off.y) / effectiveScale);
      const entry = {
        item_id: itemId,
        name: sp.getData('name'),
        emoji: sp.text,
        size: parseInt(sp.style.fontSize, 10) / effectiveScale,
        col: tile.col,
        row: tile.row,
      };
      if (itemMap[itemId]) {
        // 已有 → 更新位置信息
        Object.assign(itemMap[itemId], entry);
      } else {
        // 没有 → 记录新物品
        itemMap[itemId] = entry;
      }
    });
    const itemPositions = Object.values(itemMap);
    // 注意：出生点由 setPlayerSpawnPoint() 显式保存，这里不再自动覆盖，
    // 避免退出编辑时用玩家当前位置覆写掉设计者手动指定的出生位置。
    try {
      // 区分主地图和子场景的碰撞 data key
      const collisionKey = subId
        ? `editor_collision_map_${subId}`
        : 'editor_collision_map';
      const npcKey = subId
        ? `editor_npc_positions_${subId}`
        : 'editor_npc_positions';
      localStorage.setItem(collisionKey, JSON.stringify(this._collisionMap));
      localStorage.setItem(npcKey, JSON.stringify(npcPositions));
      localStorage.setItem(itemKey, JSON.stringify(itemPositions));
      // 入口区域由 CollisionEditor 自行管理保存
      this._editor._saveEntryZones();
    } catch (e) {
      console.warn('[Editor] localStorage 保存失败:', e);
    }
  }

  /** 保存碰撞配置 + 控制台输出 JSON + 同步到后端文件 */
  _saveCollisionConfig() {
    this._saveToLocalStorage();
    const npcPositions = {};
    const effectiveScale = this.subSceneManager.getEffectiveScale();
    const off = this.subSceneManager._subSceneOffset || { x: 0, y: 0 };
    for (const npc of this.npcs) {
      const tile = COORD.toTile((npc.x - off.x) / effectiveScale, (npc.y - off.y) / effectiveScale);
      npcPositions[npc.getData('npcId')] = { name: npc.getData('name'), col: tile.col, row: tile.row };
    }
    console.log('═══════════════════════════════════');
    console.log('[Editor] 已保存为默认游戏设置! 碰撞格数:', Object.keys(this._collisionMap).length);
    console.log('   新建存档时将使用此配置（碰撞/NPC/物品/入口/起始位置）');
    console.log('\n// 碰撞数据 (复制到代码中使用):');
    console.log(JSON.stringify(this._collisionMap, null, 2));
    console.log('\n// NPC 位置 (复制到代码中使用):');
    console.log(JSON.stringify(npcPositions, null, 2));
    console.log('═══════════════════════════════════');
    _showToast(this, `已保存为默认! 碰撞:${Object.keys(this._collisionMap).length}格 NPC:${this.npcs.length}个 物品:${this.sceneItems.length}个`, 2500);
    this._editor.refreshHUD();

    // 同步到后端文件系统（独立于游戏存档）
    this._syncEditorToBackend();
  }

  /** 收集所有 localStorage 中的编辑器配置数据，同步到后端文件 */
  _syncEditorToBackend() {
    import('../api/client.js').then(({ saveEditorConfig }) => {
      const config = {};
      // 收集所有 editor_ 前缀的 localStorage key
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key || !key.startsWith('editor_')) continue;
        try {
          config[key] = JSON.parse(localStorage.getItem(key));
        } catch (_) {
          config[key] = localStorage.getItem(key);
        }
      }
      if (Object.keys(config).length === 0) {
        console.log('[Editor] 无编辑器数据，跳过后端同步');
        return;
      }
      saveEditorConfig(config).then(result => {
        console.log('[Editor] 已同步到后端文件:', result.scenes || result.status);
        _showToast(this, '已保存到后端文件系统', 1500);
      }).catch(err => {
        console.warn('[Editor] 同步到后端失败（localStorage 已保存）:', err.message);
      });
    });
  }

  /** 从后端文件加载编辑器配置，填充到 localStorage。返回 Promise<boolean>（是否恢复了数据） */
  _loadEditorFromBackend() {
    // localStorage 已有编辑器数据，无需等待
    if (localStorage.getItem('editor_collision_map') !== null) {
      console.log('[Editor] localStorage 已有编辑器数据，跳过加载');
      return Promise.resolve(false);
    }
    return new Promise((resolve) => {
      import('../api/client.js').then(({ loadEditorConfig }) => {
        loadEditorConfig().then(config => {
          if (!config || Object.keys(config).length === 0) {
            console.log('[Editor] 后端无编辑器配置，将使用默认值');
            resolve(false);
            return;
          }
          let restored = 0;
          for (const [key, value] of Object.entries(config)) {
            if (!key.startsWith('editor_')) continue;
            try {
              localStorage.setItem(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
              restored++;
            } catch (e) { /* ignore */ }
          }
          if (restored > 0) {
            console.log(`[Editor] 从后端恢复了 ${restored} 个编辑器配置项到 localStorage`);
            // 重新加载碰撞数据（此时 createCollisionLayer 可能还没调用，无妨）
            if (this._collisionMap) this.createCollisionLayer();
            if (this._editor) {
              this._editor.loadEntryZones();
              this._editor.drawGrid();
              this._editor.refreshHUD();
            }
          }
          resolve(restored > 0);
        }).catch(err => {
          console.warn('[Editor] 从后端加载编辑器配置失败（将使用默认值）:', err.message);
          resolve(false);
        });
      }).catch(err => {
        console.warn('[Editor] 动态导入 client.js 失败:', err.message);
        resolve(false);
      });
    });
  }

  /** 编辑器: 确认物品选择器中当前物品的放置 */
  _editorConfirmItemPlace() {
    const item = this._editor.confirmItemPlace();
    if (!item) return;
    const off = this.subSceneManager._subSceneOffset || { x: 0, y: 0 };
    const scale = this.subSceneManager.getEffectiveScale();
    this._createSceneItemSprite(item, scale, off);
    this._saveToLocalStorage();
    this._editor.drawGrid();
    this._editor.refreshHUD();
    _showToast(this, `已放置: ${item.name} [${item.col},${item.row}]`, 1500);
  }

  /** 从 localStorage 中移除指定物品（辅助方法） */
  _removeItemFromStorage(itemSprite) {
    const itemId = itemSprite.getData('itemId');
    if (!itemId) return;
    const subId = this.subSceneManager.currentSubSceneId;
    const itemKey = subId
      ? `editor_item_positions_${subId}`
      : 'editor_item_positions';
    try {
      const saved = localStorage.getItem(itemKey);
      if (!saved) return;
      let items = JSON.parse(saved);
      if (!Array.isArray(items)) return;
      items = items.filter(it => it.item_id !== itemId);
      localStorage.setItem(itemKey, JSON.stringify(items));
    } catch (_) { /* ignore */ }
  }

  /** 编辑器: 删除当前拖拽中的或最近的物品 */
  _editorDeleteItem() {
    const ed = this._editor;
    // 优先删除正在拖拽的物品
    if (ed.draggedItem) {
      const itemId = ed.draggedItem.getData('itemId');
      const idx = this.sceneItems.indexOf(ed.draggedItem);
      if (idx >= 0) this.sceneItems.splice(idx, 1);
      this.tweens.killTweensOf(ed.draggedItem);
      this._removeItemFromStorage(ed.draggedItem);
      ed.draggedItem.destroy();
      ed.draggedItem = null;
      this._saveToLocalStorage();
      ed.drawGrid();
      ed.refreshHUD();
      _showToast(this, '已删除物品', 1200);
      return;
    }
    // 否则删除离摄像机中心最近的物品
    const cam = this.cameras.main;
    const cx = cam.scrollX + cam.width / 2;
    const cy = cam.scrollY + cam.height / 2;
    let nearest = null, nearestDist = Infinity;
    for (const item of this.sceneItems) {
      const d = Phaser.Math.Distance.Between(cx, cy, item.x, item.y);
      if (d < nearestDist) { nearestDist = d; nearest = item; }
    }
    if (nearest && nearestDist < 200) {
      const idx = this.sceneItems.indexOf(nearest);
      if (idx >= 0) this.sceneItems.splice(idx, 1);
      this.tweens.killTweensOf(nearest);
      this._removeItemFromStorage(nearest);
      nearest.destroy();
      this._saveToLocalStorage();
      ed.drawGrid();
      ed.refreshHUD();
      _showToast(this, '已删除最近物品', 1200);
    } else {
      _showToast(this, '附近没有可删除的物品', 1200);
    }
  }

  /** 清除所有碰撞 */
  _clearAllCollisions() {
    this._collisionMap = {};
    const subId = this.subSceneManager.currentSubSceneId;
    const collisionKey = subId
      ? `editor_collision_map_${subId}`
      : 'editor_collision_map';
    localStorage.removeItem(collisionKey);
    this._editor.drawGrid();
    this._editor.refreshHUD();
    _showToast(this, '已清除所有碰撞格', 1500);
  }

  /** 硬重置 — 清除存档但保留编辑器配置 */
  _hardReset() {
    localStorage.removeItem('__active_session__');
    this.scene.stop('UIScene');
    this.scene.restart();
  }

  // ==================== 阶段色调 ====================

  applyStageTone(newStage) {
    if (!this.cameras) return;
    this.currentStage = newStage.id;

    const tintMap = {
      cold:       { r: 160, g: 172, b: 210, alpha: 0.08 },
      warm:       { r: 255, g: 245, b: 210, alpha: 0.12 },
      dramatic:   { r: 255, g: 230, b: 195, alpha: 0.15 },
      melancholy: { r: 136, g: 153, b: 170, alpha: 0.10 },
      somber:     { r: 153, g: 136, b: 119, alpha: 0.12 },
    };

    let tint = null;
    const toneStr = newStage.color_tone || newStage.mood || '';
    if (toneStr.startsWith('#')) {
      const r = parseInt(toneStr.slice(1, 3), 16);
      const g = parseInt(toneStr.slice(3, 5), 16);
      const b = parseInt(toneStr.slice(5, 7), 16);
      tint = { r, g: Math.floor(g * 0.9), b, alpha: 0.10 };
    } else if (tintMap[toneStr]) {
      tint = tintMap[toneStr];
    } else {
      tint = tintMap.melancholy;
    }

    this.cameras.main.setBackgroundColor(Phaser.Display.Color.GetColor(
      Math.floor(tint.r * 0.15), Math.floor(tint.g * 0.12), Math.floor(tint.b * 0.16)
    ));

    if (this.tintOverlay) {
      this.tintOverlay.setFillStyle(
        Phaser.Display.Color.GetColor(tint.r, tint.g, tint.b), tint.alpha
      );
    }
  }

  // ==================== 玩家 ====================

  createPlayer() {
    // 优先加载编辑器默认起始位置
    let col = 7, row = 5;  // 墓地入口附近（序章起点）
    try {
      const saved = localStorage.getItem('editor_player_start_position');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.col != null && parsed.row != null) {
          col = parsed.col; row = parsed.row;
        }
      }
    } catch (_) { /* 使用默认位置 */ }

    const pos = COORD.toPixel(col, row);
    const p = PROTAGONIST;

    this.player = this.physics.add.sprite(pos.x * MAP_SCALE, pos.y * MAP_SCALE, `${p.prefix}_idle_down`);
    this.player.setScale(p.scale);
    this.player.setCollideWorldBounds(false);

    const br = p.bodyRatio;
    const bodyW = Math.floor(this.player.displayWidth * br.w);
    const bodyH = Math.floor(this.player.displayHeight * br.h);
    this.player.body.setSize(bodyW, bodyH);
    this.player.body.setOffset(bodyW * br.offsetX, this.player.displayHeight * br.offsetY);

    this.player.setDepth(10);
    this.player.setData('facing', 'down');
  }

  /**
   * 切换主角纹理（仅纹理变化时触发，避免每帧 setTexture）
   * setTexture 会重置 physics body，必须立即重建
   */
  switchPlayerTexture(facing, isMoving) {
    const p = PROTAGONIST;
    const texKey = `${p.prefix}_${isMoving ? 'walk' : 'idle'}_${facing}`;
    if (this.player.texture.key === texKey) return;

    this.player.setTexture(texKey);

    const br = p.bodyRatio;
    const bodyW = Math.floor(this.player.displayWidth * br.w);
    const bodyH = Math.floor(this.player.displayHeight * br.h);
    this.player.body.setSize(bodyW, bodyH);
    this.player.body.setOffset(bodyW * br.offsetX, this.player.displayHeight * br.offsetY);
  }

  // ==================== NPC 交互按钮 ====================

  _createNPCActionButtons() {
    const btnW = 130, btnH = 32, gap = 10;
    const totalW = btnW * 2 + gap;
    this._npcBtnParts = [];

    const addPart = (obj, dx = 0, dy = 0, depth = 102) => {
      obj.setDepth(depth).setScrollFactor(0).setVisible(false);
      this._npcBtnParts.push({ obj, dx, dy });
      return obj;
    };

    const bg = addPart(this.add.graphics());
    bg.fillStyle(0x1a1820, 0.92);
    bg.fillRoundedRect(-totalW / 2 - 8, -btnH / 2 - 6, totalW + 16, btnH + 12, 6);
    bg.lineStyle(1, 0xc4a882, 0.5);
    bg.strokeRoundedRect(-totalW / 2 - 8, -btnH / 2 - 6, totalW + 16, btnH + 12, 6);

    const _makeBtn = (label, centerX, callback, color = '#d4b896') => {
      const btnGfx = addPart(this.add.graphics(), 0, 0, 103);
      const drawBtn = (hover) => {
        btnGfx.clear();
        btnGfx.fillStyle(hover ? 0x3a3830 : 0x2a2824, 1);
        btnGfx.fillRoundedRect(centerX - btnW / 2, -btnH / 2, btnW, btnH, 4);
        btnGfx.lineStyle(1, hover ? 0xd4b896 : 0x887766, 0.6);
        btnGfx.strokeRoundedRect(centerX - btnW / 2, -btnH / 2, btnW, btnH, 4);
      };
      drawBtn(false);

      addPart(
        this.add.text(0, 0, label, {
          fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
          fontSize: '13px', color,
        }).setOrigin(0.5),
        centerX, 0, 104
      );

      const hit = addPart(
        this.add.rectangle(0, 0, btnW, btnH, 0x000000, 0.01)
          .setInteractive({ useHandCursor: true }),
        centerX, 0, 105
      );
      hit.on('pointerover', () => drawBtn(true));
      hit.on('pointerout', () => drawBtn(false));
      hit.on('pointerdown', callback);
    };

    const leftX = -btnW / 2 - gap / 2;
    const rightX = btnW / 2 + gap / 2;

    _makeBtn('💬 进行对话', leftX, () => {
      if (this.currentNearbyNPC) this.triggerDialogue(this.currentNearbyNPC);
    });

    _makeBtn('🎁 展示物品', rightX, () => {
      if (this.currentNearbyNPC) {
        const npcId = this.currentNearbyNPC.getData('npcId');
        const npcName = this.currentNearbyNPC.getData('name');
        this.events.emit('show-item:select', { npcId, npcName });
      }
    }, '#c0b898');
  }

  _showNPCActionButtons(npc) {
    this.interactHint.setVisible(false);
    const cam = this.cameras.main;
    const effectiveScale = this.subSceneManager.getEffectiveScale();
    const relX = npc.x - cam.scrollX;
    const relY = npc.y - cam.scrollY - 50 * effectiveScale;
    for (const { obj, dx, dy } of this._npcBtnParts) {
      obj.setPosition(relX + dx, relY + dy).setVisible(true);
    }
    this.npcActionContainer.setVisible(true);
    this._updateNPCActionPosition(npc);
  }

  _updateNPCActionPosition(npc) {
    const cam = this.cameras.main;
    const effectiveScale = this.subSceneManager.getEffectiveScale();
    const relX = npc.x - cam.scrollX;
    const relY = npc.y - cam.scrollY - 52 * effectiveScale;
    this.npcActionContainer.setPosition(relX, relY);
  }

  _hideNPCActionButtons() {
    for (const { obj } of this._npcBtnParts) obj.setVisible(false);
    this.npcActionContainer.setVisible(false);
  }

  // ==================== 摄像机 ====================

  /** 平滑跟随摄像机 + 边界限制 */
  _updateCameraOnly() {
    if (!this._mapBounds) return;
    const cam = this.cameras.main;
    const { w: mapW, h: mapH } = this._mapBounds;
    const targetX = this.player.x - cam.width / 2;
    const targetY = this.player.y - cam.height / 2;

    cam.scrollX += (targetX - cam.scrollX) * 0.08;
    cam.scrollY += (targetY - cam.scrollY) * 0.08;
    cam.scrollX = Phaser.Math.Clamp(cam.scrollX, 0, Math.max(0, mapW - cam.width));
    cam.scrollY = Phaser.Math.Clamp(cam.scrollY, 0, Math.max(0, mapH - cam.height));
  }

  // ==================== 对话与拾取触发器 ====================

  triggerDialogue(npc) {
    const tilePos = COORD.toTile(npc.x, npc.y);
    this.events.emit('dialogue:start', {
      npcId: npc.getData('npcId'),
      name: npc.getData('name'),
      position: { col: tilePos.col, row: tilePos.row },
      isTownNPC: npc.getData('isTownNPC') || false,
      role: npc.getData('role') || null,
    });
  }

  /** 拾取场景物品 */
  async pickupItem(itemSprite) {
    const itemId = itemSprite.getData('itemId');
    const itemName = itemSprite.getData('name');
    const sessionId = localStorage.getItem('__active_session__');
    if (!sessionId) return;

    const idx = this.sceneItems.indexOf(itemSprite);
    if (idx >= 0) this.sceneItems.splice(idx, 1);
    this.currentNearbyItem = null;
    this.interactHint.setVisible(false);

    this.events.emit('input:lock', true);

    this.tweens.add({
      targets: itemSprite,
      alpha: 0, y: itemSprite.y - 30 * MAP_SCALE, scaleX: 1.5, scaleY: 1.5,
      duration: 400,
      onComplete: () => {
        itemSprite.destroy();
        this.events.emit('input:lock', false);
      },
    });

    try {
      const { discoverItem } = await import('../api/client.js');
      const result = await discoverItem(sessionId, itemId);
      if (result.already_discovered) {
        _showToast(this, `${itemName} 已在行囊中`);
      } else {
        _showToast(this, `获得: ${itemName}`, 2500);
        this.events.emit('item:discovered', result.item);
      }
    } catch (e) {
      console.error('[GameScene] 拾取物品失败:', e);
      _showToast(this, '拾取失败', 1500);
    }
  }

  // ==================== 控制提示 ====================

  _showControlsHint() {
    const { width, height } = this.cameras.main;
    const hint = this.add.text(width / 2, height - 50,
      '[WASD/方向键] 移动  |  [F] 拾取/进出建筑  |  [E] 碰撞编辑器  |  [R] 硬重置  |  编辑模式:[B]出生点 [K]保存', {
        fontFamily: '"Microsoft YaHei","Consolas",sans-serif',
        fontSize: '13px', color: '#aabbcc',
        backgroundColor: '#0a0a15dd',
        padding: { x: 12, y: 8 },
        align: 'center', lineSpacing: 3,
      }).setOrigin(0.5).setDepth(800).setAlpha(0).setScrollFactor(0);

    this.tweens.add({
      targets: hint, alpha: 1, duration: 500,
      onComplete: () => {
        this.time.delayedCall(6000, () => {
          this.tweens.add({ targets: hint, alpha: 0, duration: 1500, onComplete: () => hint.destroy() });
        });
      },
    });
  }

  // ==================== 更新循环 ====================

  update() {
    // R 键硬重置 — 永远可用
    if (this.editKeys && Phaser.Input.Keyboard.JustDown(this.editKeys.R)) {
      this._hardReset();
      return;
    }

    try {
      this._updateInner();
    } catch (e) {
      if (!this._errLogged) {
        this._errLogged = true;
        console.error('[GameScene] update 崩溃:', e);
        const { width } = this.cameras.main;
        this._errorMsg = this.add.text(width / 2, 120,
          `⚠️ 游戏出错: ${e.message}\n按 [R] 重置  |  按 F12 查看控制台`, {
            fontSize: '18px', color: '#ff6666', backgroundColor: '#330000dd',
            padding: { x: 16, y: 10 }, align: 'center',
          }).setOrigin(0.5).setDepth(9999).setScrollFactor(0);
      }
    }
  }

  _updateInner() {
    if (!this.player || !this.cursors) return;

    // 编辑器快捷键 — 仅在非锁定状态下可用（对话/背包/历史面板打开时禁止）
    if (Phaser.Input.Keyboard.JustDown(this.editKeys.E) && !this.inputLocked) {
      this._editor.toggle();
      return;
    }
    if (Phaser.Input.Keyboard.JustDown(this.editKeys.C) && this._editor.editMode) {
      this._clearAllCollisions();
    }
    if (Phaser.Input.Keyboard.JustDown(this.editKeys.K) && this._editor.editMode) {
      this._saveCollisionConfig();
    }

    // 编辑器内切换出生点编辑模式 (B)
    if (Phaser.Input.Keyboard.JustDown(this.editKeys.B) && this._editor.editMode && !this._editor.entryZoneMode && !this._editor.itemPickerOpen) {
      this._editor.toggleSpawnEditMode();
      this._editor.drawGrid();
      return;
    }

    // 编辑器内 Esc 取消选择器
    if (Phaser.Input.Keyboard.JustDown(this.editKeys.ESC) && this._editor.editMode) {
      this._editor.cancelItemPicker();
    }

    // 编辑器内 Enter 确认物品选择
    if (Phaser.Input.Keyboard.JustDown(this.editKeys.ENTER) && this._editor.editMode && this._editor.itemPickerOpen) {
      this._editorConfirmItemPlace();
    }

    // 编辑器内数字键选择
    if (this._editor.editMode) {
      const numKeys = [
        this.editKeys.ONE, this.editKeys.TWO, this.editKeys.THREE,
        this.editKeys.FOUR, this.editKeys.FIVE, this.editKeys.SIX,
        this.editKeys.SEVEN, this.editKeys.EIGHT, this.editKeys.NINE,
        this.editKeys.ZERO,
      ];
      for (let i = 0; i < numKeys.length; i++) {
        if (Phaser.Input.Keyboard.JustDown(numKeys[i])) {
          const num = i === 9 ? 10 : i + 1; // 0键=10
          if (this._editor.itemPickerOpen) {
            this._editor.selectItemByNumber(num);
          } else if (this._editor.entryZoneMode) {
            this._editor.selectSubSceneByNumber(num);
          }
          break;
        }
      }
    }

    // 编辑器内放置物品 (I) — 打开物品选择器
    if (Phaser.Input.Keyboard.JustDown(this.editKeys.I) && this._editor.editMode) {
      this._editor.openItemPicker();
    }

    // 编辑器内入口区域模式 (Z)
    if (Phaser.Input.Keyboard.JustDown(this.editKeys.Z) && this._editor.editMode) {
      this._editor.toggleEntryZoneMode();
    }

    // 编辑器内删除 (X) — 优先删除入口/出口区域，否则删除物品
    if (Phaser.Input.Keyboard.JustDown(this.editKeys.X) && this._editor.editMode) {
      const ptr = this.input.activePointer;
      const worldX = ptr.x + this.cameras.main.scrollX;
      const worldY = ptr.y + this.cameras.main.scrollY;
      // 子场景：检测是否鼠标在出口区域上
      if (!this._editor._isMainMap) {
        const subId = this.subSceneManager.currentSubSceneId;
        if (subId && this._editor.exitZones[subId]) {
          const ez = this._editor.exitZones[subId];
          const { gridPx, offsetX, offsetY } = this._editor._getEditorScale();
          const zx = offsetX + ez.col * gridPx;
          const zy = offsetY + ez.row * gridPx;
          const zw = ez.w * gridPx;
          const zh = ez.h * gridPx;
          if (worldX >= zx && worldX <= zx + zw && worldY >= zy && worldY <= zy + zh) {
            this._editor._deleteExitZone();
            this._editor.drawGrid();
            this._editor.refreshHUD();
            _showToast(this, '已删除出口区域', 1200);
            return;
          }
        }
      }
      const hitZone = this._editor._getEntryZoneAtWorld(worldX, worldY);
      if (hitZone) {
        // 鼠标悬停在入口区域上 → 删除该入口区域
        const idx = this._editor.entryZones.indexOf(hitZone);
        if (idx >= 0) {
          const removed = this._editor.entryZones.splice(idx, 1)[0];
          console.log(`[Editor] X删除入口区域: ${removed.name}`);
          this._editor._saveEntryZones();
          this._editor._drawEntryZoneLabels();
          this._editor.drawGrid();
          this._editor.refreshHUD();
          _showToast(this, `已删除入口: ${removed.name}`, 1200);
        }
      } else {
        this._editorDeleteItem();
      }
    }

    // 编辑模式
    if (this._editor.editMode) {
      this.player.setVelocity(0, 0);
      this._editor.updateCamera();
      return;
    }

    // 正常游戏模式
    if (!this.inputLocked) {
      this._updatePlayerMovement();
    } else {
      this.player.setVelocity(0, 0);
      this.switchPlayerTexture(this.player.getData('facing') || 'down', false);
    }

    // NPC 气泡跟随 + 接近检测
    this._updateNPCProximity();

    // 物品接近检测
    this._updateItemProximity();

    // 子场景入口/出口接近检测
    this.subSceneManager.updateProximityHints();

    // F 键交互 — 仅用于子场景切换和物品拾取；NPC 交互已自动弹出
    if (!this.inputLocked && Phaser.Input.Keyboard.JustDown(this.wasd.F)) {
      // 优先处理子场景交互
      if (!this.subSceneManager.handleFKeyInteraction()) {
        if (this.currentNearbyItem) {
          this.pickupItem(this.currentNearbyItem);
        }
      }
    }

    // 摄像机跟随
    this._updateCameraOnly();

    // NPC 漫游（对话中暂停，结束后立即恢复）
    if (this._npcResumeDelay === 0) {
      this._updateTownNPCs(this.game.loop.delta || 16.667);
    }
  }

  /** 玩家移动控制 */
  _updatePlayerMovement() {
    const speed = GAME.PLAYER_SPEED;
    let targetVX = 0, targetVY = 0;

    if (this.wasd.A.isDown || this.cursors.left.isDown) targetVX = -speed;
    else if (this.wasd.D.isDown || this.cursors.right.isDown) targetVX = speed;
    if (this.wasd.W.isDown || this.cursors.up.isDown) targetVY = -speed;
    else if (this.wasd.S.isDown || this.cursors.down.isDown) targetVY = speed;

    if (targetVX !== 0 && targetVY !== 0) { targetVX *= 0.707; targetVY *= 0.707; }

    let facing = this.player.getData('facing') || 'down';
    if (targetVX !== 0 || targetVY !== 0) {
      facing = Math.abs(targetVX) > Math.abs(targetVY)
        ? (targetVX > 0 ? 'right' : 'left')
        : (targetVY > 0 ? 'down' : 'up');
    }
    this.switchPlayerTexture(facing, targetVX !== 0 || targetVY !== 0);
    this.player.setData('facing', facing);

    const checkDist = 8;
    let finalVX = targetVX, finalVY = targetVY;
    if (targetVX !== 0 && this._checkCollisionAt(this.player.x + (targetVX > 0 ? checkDist : -checkDist), this.player.y)) {
      finalVX = 0;
    }
    if (targetVY !== 0 && this._checkCollisionAt(this.player.x, this.player.y + (targetVY > 0 ? checkDist : -checkDist))) {
      finalVY = 0;
    }

    // 地图边界限制（主地图和子场景通用）
    if (this._mapBounds) {
      const effectiveScale = this.subSceneManager.getEffectiveScale();
      const margin = 16 * effectiveScale;
      const newX = this.player.x + finalVX * (this.game.loop.delta / 1000);
      const newY = this.player.y + finalVY * (this.game.loop.delta / 1000);
      // 子场景：约束在地图区域内；主地图：约束在 _mapBounds 内
      const subMap = this.subSceneManager._subMapArea;
      if (subMap) {
        if (newX < subMap.x + margin || newX > subMap.x + subMap.w - margin) finalVX = 0;
        if (newY < subMap.y + margin || newY > subMap.y + subMap.h - margin) finalVY = 0;
      } else {
        if (newX < margin || newX > this._mapBounds.w - margin) finalVX = 0;
        if (newY < margin || newY > this._mapBounds.h - margin) finalVY = 0;
      }
    }

    this.player.setVelocity(finalVX, finalVY);
  }

  /** NPC 气泡跟随 + 接近检测 */
  _updateNPCProximity() {
    this.currentNearbyNPC = null;
    let minDist = Infinity;

    // 主要 NPC
    for (let i = 0; i < this.npcs.length; i++) {
      const npc = this.npcs[i];
      const bubble = this.npcBubbles[i];
      if (bubble) bubble.setPosition(npc.x, npc.y - 22);

      const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, npc.x, npc.y);
      if (dist < 64) this.currentNearbyNPC = npc;
    }

    // 普通 NPC
    const effectiveScale = this.subSceneManager.getEffectiveScale();
    for (let i = 0; i < this.townNpcs.length; i++) {
      const npc = this.townNpcs[i];
      const bubble = this.townNpcBubbles[i];
      if (bubble) bubble.setPosition(npc.x, npc.y - 18 * effectiveScale);

      const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, npc.x, npc.y);
      if (dist < minDist) minDist = dist;
      if (dist < 64) this.currentNearbyNPC = npc;
    }

    // NPC 交互：靠近自动弹出选项按钮
    this.interactHint.setVisible(false); // NPC优先，清除物品拾取提示
    if (this.currentNearbyNPC && !this.inputLocked) {
      if (!this.npcActionContainer.visible) {
        this._showNPCActionButtons(this.currentNearbyNPC);
      } else {
        // 如果当前NPC和弹窗指向的不是同一个，切换
        const currentTargetId = this._npcActionTarget?.getData('npcId');
        const nearbyId = this.currentNearbyNPC.getData('npcId');
        if (currentTargetId !== nearbyId) {
          this._showNPCActionButtons(this.currentNearbyNPC);
        } else {
          this._updateNPCActionPosition(this.currentNearbyNPC);
        }
      }
      this._npcActionTarget = this.currentNearbyNPC;
    } else {
      // NPC 离开范围时关闭按钮；没有NPC且inputLocked时也关闭
      if (this.npcActionContainer.visible) {
        this._hideNPCActionButtons();
        this._npcActionTarget = null;
      }
    }
  }

  /** 物品接近检测（NPC 优先，近距离有 NPC 时不显示物品提示） */
  _updateItemProximity() {
    this.currentNearbyItem = null;
    if (this.currentNearbyNPC) {
      // NPC 优先，不显示物品提示（保留NPC提示可见）
      return;
    }

    for (let i = 0; i < this.sceneItems.length; i++) {
      const item = this.sceneItems[i];
      const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, item.x, item.y);
      if (dist < 48) {
        this.currentNearbyItem = item;
        this.interactHint.setText(`按 [F] 拾取 ${item.getData('name')}`);
        this.interactHint.setPosition(item.x, item.y - 30);
        this.interactHint.setVisible(true);
        break;
      }
    }
    if (!this.currentNearbyItem) this.interactHint.setVisible(false);
  }
}

// ═══════════════════════════════════════════════════════════════
// 模块级辅助函数（存档对话历史转换）
// ═══════════════════════════════════════════════════════════════

/**
 * 从 NPC 列表构建 ID → 名称映射。
 * @param {Array|Object} npcs — npcs 数组或对象
 * @returns {Record<string, string>}
 */
function _buildNpcNameMap(npcs) {
  const map = {};
  if (!npcs) return map;
  const iterable = Array.isArray(npcs) ? npcs : Object.values(npcs);
  for (const npc of iterable) {
    if (npc && npc.id && npc.name) map[npc.id] = npc.name;
  }
  return map;
}

/**
 * 将后端 dialogue_history 格式转换为前端 HistoryPanel 所需格式。
 * 后端: { npc_id, npc_name, role, content, stage, chapter_id, turn_index }
 * 前端: { npcName, npcText, playerText, stage }
 * @param {Array} backendHistory — 来自 to_api_response().dialogue_history
 * @param {Record<string,string>} npcNames — NPC ID → 名称映射
 * @returns {Array<{npcName:string, npcText:string|null, playerText:string|null, stage:number}>}
 */
function _convertDialogueHistory(backendHistory, npcNames) {
  if (!backendHistory || !Array.isArray(backendHistory)) return [];

  console.log('[GameScene] _convertDialogueHistory 原始条目数:', backendHistory.length,
    'sample:', backendHistory.slice(0, 3));

  const frontendHistory = [];
  let pendingNpcName = null;
  let pendingNpcText = '';
  let pendingStage = 1;

  for (const entry of backendHistory) {
    const npcName = entry.npc_name || npcNames[entry.npc_id] || entry.npc_id || '未知';
    const stage = entry.stage || 1;

    if (entry.role === 'npc') {
      // 同一 NPC 连续发言时合并为一条（用换行分隔），避免拆分显示
      if (pendingNpcText && pendingNpcName === npcName) {
        pendingNpcText += '\n' + (entry.content || '');
        pendingStage = stage;
      } else {
        if (pendingNpcText) {
          frontendHistory.push({ npcName: pendingNpcName, npcText: pendingNpcText, playerText: null, stage: pendingStage });
        }
        pendingNpcText = entry.content || '';
        pendingNpcName = npcName;
        pendingStage = stage;
      }
    } else if (entry.role === 'player') {
      // 玩家发言前先提交 NPC 对话
      if (pendingNpcText) {
        frontendHistory.push({ npcName: pendingNpcName, npcText: pendingNpcText, playerText: null, stage: pendingStage });
        pendingNpcText = '';
      }
      frontendHistory.push({ npcName, npcText: null, playerText: entry.content, stage });
    }
  }
  // 收尾：使用最后一条记录的 stage，而非硬编码 1
  if (pendingNpcText) {
    frontendHistory.push({ npcName: pendingNpcName, npcText: pendingNpcText, playerText: null, stage: pendingStage });
  }

  console.log('[GameScene] _convertDialogueHistory 转换后条目数:', frontendHistory.length,
    'sample:', frontendHistory.slice(0, 2));
  return frontendHistory;
}
