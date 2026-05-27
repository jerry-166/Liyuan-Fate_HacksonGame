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
import { GAME, COORD } from '../config.js';
import { generateMapData, MAP_SCALE, MAP_COLS, MAP_ROWS } from './modules/MapGenerator.js';
import { CollisionEditor } from './modules/CollisionEditor.js';
import {
  PROTAGONIST, NPC_SPRITES, FALLBACK_NPC_SPRITE, DIRS,
  showToast as _showToast, showLoadingHint as _showLoadingHint, hideLoadingHint as _hideLoadingHint,
} from './modules/GameUIHelpers.js';
import { SUBSCENES } from './modules/SubSceneConfig.js';
import { SubSceneManager } from './modules/SubSceneManager.js';

const TILE = GAME.TILE_SIZE;

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
    // 加载主角精灵（四方向 idle + walk 各一张）
    for (const dir of DIRS) {
      this.load.image(`${PROTAGONIST.prefix}_idle_${dir}`, `${PROTAGONIST.baseDir}/${PROTAGONIST.prefix}_idle_${dir}.png`);
      this.load.image(`${PROTAGONIST.prefix}_walk_${dir}`, `${PROTAGONIST.baseDir}/${PROTAGONIST.prefix}_walk_${dir}.png`);
    }
    // 加载 NPC 精灵图
    for (const cfg of Object.values(NPC_SPRITES)) {
      for (const dir of DIRS) {
        this.load.image(`${cfg.prefix}_idle_${dir}`, `${cfg.baseDir}/${cfg.prefix}_idle_${dir}.png`);
        this.load.image(`${cfg.prefix}_walk_${dir}`, `${cfg.baseDir}/${cfg.prefix}_walk_${dir}.png`);
      }
    }
    // 加载大地图素材
    this.load.image('town_worldmap', '/assets/images/maps/town_worldmap.png');

    // 加载子场景地图图片
    for (const config of Object.values(SUBSCENES)) {
      this.load.image(config.imageKey, config.imagePath);
      if (config.hasStateSwitch && config.altImageKey) {
        this.load.image(config.altImageKey, config.altImagePath);
      }
    }
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

    this.drawTileMap();

    // 以图片实际渲染尺寸作为边界
    const actualMapW = this.mapImage.displayWidth;
    const actualMapH = this.mapImage.displayHeight;
    this._mapBounds = { w: actualMapW, h: actualMapH };

    this.createCollisionLayer();
    this.createPlayer();
    this.createNPCs();

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

    // F键交互提示文字
    this.interactHint = this.add.text(0, 0, '', {
      fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
      fontSize: '17px', color: '#d4c4a0',
      backgroundColor: '#2a2824ee',
      padding: { x: 10, y: 5 },
      border: 1, borderRadius: 4,
    }).setOrigin(0.5).setDepth(100).setVisible(false).setScrollFactor(0);

    // 碰撞编辑器
    this._editor = new CollisionEditor(this);

    // 编辑器快捷键
    this.editKeys = {
      E: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E),
      S: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      C: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.C),
      R: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.R),
    };

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

    // 阶段色调遮罩
    this.tintOverlay = this.add.rectangle(
      this.cameras.main.centerX, this.cameras.main.centerY,
      this.cameras.main.width, this.cameras.main.height,
      0xffffff, 0
    );
    this.tintOverlay.setScrollFactor(0).setDepth(999).setOrigin(0.5);
    this.tintOverlay.setInteractive = () => this.tintOverlay;

    this.scene.launch('UIScene');

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

  /**
   * 初始化新游戏 — POST /api/game/start → 自动开始第一章
   */
  async initGame() {
    try {
      const { startGame, saveGameState, startChapter } = await import('../api/client.js');
      this._loadingHint = _showLoadingHint(this, '正在创建新的故事……');

      const gameState = await startGame('玩家');
      if (!gameState || !gameState.session_id) throw new Error('创建游戏失败');

      let stage = gameState.current_stage || 1;
      let chapterId = null, chapterName = null;
      if (gameState.current_chapter) {
        chapterId = gameState.current_chapter.chapter_id;
        chapterName = gameState.current_chapter.chapter_name;
      }

      _hideLoadingHint(this._loadingHint);
      this.currentStage = stage;

      localStorage.setItem('__active_session__', gameState.session_id);
      saveGameState(gameState.session_id, gameState);

      if (gameState.npcs) {
        this.time.delayedCall(300, () => this.refreshNPCsFromState(gameState));
      }
      this.time.delayedCall(500, () => this.loadTownNPCs());
      this.time.delayedCall(600, () => this.refreshSceneItems());

      this.events.emit('game:init', {
        sessionId: gameState.session_id,
        stage, chapterId, chapterName,
        inventory: gameState.inventory || [],
      });

      if (gameState.stage_params) {
        this.time.delayedCall(500, () => this.applyStageTone(gameState.stage_params));
      }

      // v2: 自动开始第一章
      if (!chapterId) {
        _hideLoadingHint(this._loadingHint);
        this._loadingHint = _showLoadingHint(this, '正在载入第一章……');
        try {
          const chResult = await startChapter(gameState.session_id);
          _hideLoadingHint(this._loadingHint);
          if (chResult && chResult.chapter_id) {
            this.time.delayedCall(800, () => {
              this.events.emit('stage:change', {
                id: 1, name: chResult.chapter_name || '归乡',
                description: chResult.task ? chResult.task.description : '',
                color_tone: chResult.color_tone || '#8899aa',
                bgm_mood: chResult.bgm_mood || '',
              });
            });
          }
        } catch (chErr) {
          _hideLoadingHint(this._loadingHint);
          console.warn('[GameScene] 章节初始化失败（非阻塞）:', chErr);
        }
      }

      console.log('[GameScene] 游戏已初始化, session:', gameState.session_id);
    } catch (e) {
      _hideLoadingHint(this._loadingHint);
      console.error('[GameScene] 初始化游戏失败:', e);
      _showToast(this, '连接服务器失败，请确认后端已启动', 3000);
    }
  }

  /**
   * 恢复存档游戏
   */
  async restoreGame(sessionId) {
    // ★ 防御性：如果当前在子场景中，强制退出避免状态残留
    this.subSceneManager.forceExitSubScene();

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
      });

      // ★ 子场景存档恢复：如果存档时玩家在子场景中，跳过主地图加载
      if (gameState._sub_scene_id) {
        console.log('[GameScene] restoreGame: 检测到子场景存档', gameState._sub_scene_id);
        saveGameState(sessionId, gameState);
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

    // ★ 强制退出当前子场景（如果正在某子场景中，确保 UI 清理干净）
    this.subSceneManager.forceExitSubScene();

    const savedSubSceneId = gameState._sub_scene_id;
    console.log('[GameScene] reloadFromState: stage=', gameState.current_stage,
      'npcs=', gameState.npcs?.length,
      'subSceneId=', savedSubSceneId);

    // ★ 从 localStorage 合并位置数据（仅主地图场景使用）
    if (!savedSubSceneId) {
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
    this.events.emit('game:init', {
      sessionId, stage: this.currentStage, chapterId, chapterName,
      inventory: gameState.inventory || [],
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

    // ====== 分路径处理 ======
    if (savedSubSceneId) {
      // ★★★ 子场景存档：跳过主地图 NPC/主角/物品加载，直接进入子场景 ★★★
      console.log(`[GameScene] 检测到子场景存档: ${savedSubSceneId}，直接恢复子场景`);
      this._reloadSubSceneFromState(gameState, savedSubSceneId);
    } else {
      // ★★★ 主地图存档：正常加载主地图实体 ★★★
      this._reloadMainMapFromState(gameState);
    }

    // 解锁输入
    this.events.emit('input:lock', false);
  }

  /**
   * 从子场景存档恢复 — 直接进入子场景，不加载主地图实体
   */
  _reloadSubSceneFromState(gameState, subSceneId) {
    // ★ 同步恢复主角可见性（forceExitSubScene 已放到主地图兜底位置）
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

  /** 从后端刷新场景物品 */
  async refreshSceneItems() {
    const sessionId = localStorage.getItem('__active_session__');
    if (!sessionId) return;

    try {
      const { getItems } = await import('../api/client.js');
      const data = await getItems(sessionId);

      this.sceneItems.forEach(sp => sp.destroy());
      this.sceneItems = [];
      this.currentNearbyItem = null;

      const sceneItems = data.scene_items || [];
      sceneItems.forEach(item => {
        if (!item.location || !item.location.position) return;
        const { col, row } = item.location.position;
        this._createSceneItemSprite(item, col, row);
      });
      console.log(`[GameScene] 场景物品已刷新: ${this.sceneItems.length} 个`);
    } catch (e) {
      console.warn('[GameScene] 刷新场景物品失败:', e);
    }
  }

  /** 创建单个场景物品精灵 */
  _createSceneItemSprite(itemData, col, row) {
    const pos = COORD.toPixel(col, row);
    const px = pos.x * MAP_SCALE;
    const py = pos.y * MAP_SCALE;

    const sprite = this.add.text(px, py, '📦', {
      fontSize: `${20 * MAP_SCALE}px`,
    }).setOrigin(0.5).setDepth(90);

    sprite.setData('itemId', itemData.item_id);
    sprite.setData('name', itemData.name);

    this.tweens.add({
      targets: sprite,
      y: py - 4 * MAP_SCALE,
      duration: 1200, yoyo: true, repeat: -1,
      ease: 'Sine.easeInOut',
    });

    this.sceneItems.push(sprite);
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
    const storyNpcs = this.npcs.map(npc => {
      const tile = COORD.toTile(npc.x / effectiveScale, npc.y / effectiveScale);
      return { npc_id: npc.getData('npcId'), position: { col: tile.col, row: tile.row } };
    });
    const townNpcs = this.townNpcs.map(npc => {
      const tile = COORD.toTile(npc.x / effectiveScale, npc.y / effectiveScale);
      return { npc_id: npc.getData('npcId'), position: { col: tile.col, row: tile.row } };
    });
    const playerTile = this.player
      ? COORD.toTile(this.player.x / effectiveScale, this.player.y / effectiveScale)
      : { col: 44, row: 28 };

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
    const mapBounds = this._mapBounds;
    const mapW = mapBounds ? mapBounds.w : MAP_COLS * TILE * MAP_SCALE;
    const mapH = mapBounds ? mapBounds.h : MAP_ROWS * TILE * MAP_SCALE;
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
              const tx = Phaser.Math.Clamp(npc.x + Math.cos(angle) * dist, margin, mapW - margin);
              const ty = Phaser.Math.Clamp(npc.y + Math.sin(angle) * dist, margin, mapH - margin);
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
        // ★ 恢复 NPC 位置（从后端 stateNpc.position）
        if (stateNpc.position && stateNpc.position.col !== undefined && stateNpc.position.row !== undefined) {
          const { x: px, y: py } = COORD.toPixel(stateNpc.position.col, stateNpc.position.row);
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
            wander.originCol = stateNpc.position.col;
            wander.originRow = stateNpc.position.row;
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
      const saved = localStorage.getItem('editor_npc_positions');
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
    const sprite = this.physics.add.sprite(posX * MAP_SCALE, posY * MAP_SCALE, `${cfg.prefix}_idle_down`);
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

  /** 创建初始 NPC */
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
      const pos = savedNPCPositions && savedNPCPositions[def.id]
        ? savedNPCPositions[def.id] : { col: def.col, row: def.row };
      const pixelPos = COORD.toPixel(pos.col, pos.row);
      const cfg = NPC_SPRITES[def.id];
      const startKey = cfg ? `${cfg.prefix}_idle_down` : null;

      const sprite = this.physics.add.sprite(
        pixelPos.x * MAP_SCALE, pixelPos.y * MAP_SCALE,
        startKey || '__fallback_npc__'
      );
      if (cfg) sprite.setScale(cfg.scale);
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

  /** 检查网格碰撞 - 支持 2x2 覆盖检测 */
  _checkCollisionAt(worldX, worldY) {
    if (!this._collisionMap || Object.keys(this._collisionMap).length === 0) return false;
    const effectiveScale = this.subSceneManager.getEffectiveScale();
    const gridPx = TILE * effectiveScale;
    const col = Math.floor(worldX / gridPx);
    const row = Math.floor(worldY / gridPx);
    for (let dc = 0; dc <= 1; dc++) {
      for (let dr = 0; dr <= 1; dr++) {
        if (this._collisionMap[`${col + dc}_${row + dr}`]) return true;
      }
    }
    return false;
  }

  /** 保存碰撞配置和 NPC 位置到 localStorage */
  _saveToLocalStorage() {
    const npcPositions = {};
    const effectiveScale = this.subSceneManager.getEffectiveScale();
    for (const npc of this.npcs) {
      const tile = COORD.toTile(npc.x / effectiveScale, npc.y / effectiveScale);
      npcPositions[npc.getData('npcId')] = { col: tile.col, row: tile.row };
    }
    try {
      // 区分主地图和子场景的碰撞数据 key
      const collisionKey = this.subSceneManager.isInSubScene()
        ? `editor_collision_map_${this.subSceneManager.currentSubSceneId}`
        : 'editor_collision_map';
      const npcKey = this.subSceneManager.isInSubScene()
        ? `editor_npc_positions_${this.subSceneManager.currentSubSceneId}`
        : 'editor_npc_positions';
      localStorage.setItem(collisionKey, JSON.stringify(this._collisionMap));
      localStorage.setItem(npcKey, JSON.stringify(npcPositions));
    } catch (e) {
      console.warn('[Editor] localStorage 保存失败:', e);
    }
  }

  /** 保存碰撞配置 + 控制台输出 JSON */
  _saveCollisionConfig() {
    this._saveToLocalStorage();
    const npcPositions = {};
    const effectiveScale = this.subSceneManager.getEffectiveScale();
    for (const npc of this.npcs) {
      const tile = COORD.toTile(npc.x / effectiveScale, npc.y / effectiveScale);
      npcPositions[npc.getData('npcId')] = { name: npc.getData('name'), col: tile.col, row: tile.row };
    }
    console.log('═══════════════════════════════════');
    console.log('[Editor] 配置已保存! 碰撞格数:', Object.keys(this._collisionMap).length);
    console.log('\n// 碰撞数据 (复制到代码中使用):');
    console.log(JSON.stringify(this._collisionMap, null, 2));
    console.log('\n// NPC 位置 (复制到代码中使用):');
    console.log(JSON.stringify(npcPositions, null, 2));
    console.log('═══════════════════════════════════');
    _showToast(this, `已保存! 碰撞:${Object.keys(this._collisionMap).length}格 | NPC:${this.npcs.length}个`, 2500);
    this._editor.refreshHUD();
  }

  /** 清除所有碰撞 */
  _clearAllCollisions() {
    this._collisionMap = {};
    localStorage.removeItem('editor_collision_map');
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
    const pos = COORD.toPixel(44, 28);
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
      '[WASD/方向键] 移动  |  [F] 拾取/进出建筑  |  [E] 碰撞编辑器  |  [R] 硬重置', {
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

    // 编辑器快捷键
    if (Phaser.Input.Keyboard.JustDown(this.editKeys.E)) {
      this._editor.toggle();
      return;
    }
    if (Phaser.Input.Keyboard.JustDown(this.editKeys.C)) {
      this._clearAllCollisions();
    }
    if (Phaser.Input.Keyboard.JustDown(this.editKeys.S) && this._editor.editMode) {
      this._saveCollisionConfig();
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

    // F 键拾取 / 进入离开子场景
    if (!this.inputLocked && Phaser.Input.Keyboard.JustDown(this.wasd.F)) {
      // 优先处理子场景交互
      if (!this.subSceneManager.handleFKeyInteraction()) {
        if (this.currentNearbyItem) this.pickupItem(this.currentNearbyItem);
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
      if (newX < margin || newX > this._mapBounds.w - margin) finalVX = 0;
      if (newY < margin || newY > this._mapBounds.h - margin) finalVY = 0;
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

    // NPC 交互按钮
    if (this.currentNearbyNPC && !this.inputLocked) {
      this.interactHint.setVisible(false);
      if (!this.npcActionContainer.visible) {
        this._showNPCActionButtons(this.currentNearbyNPC);
      }
      this._updateNPCActionPosition(this.currentNearbyNPC);
    } else {
      if (this.npcActionContainer.visible) this._hideNPCActionButtons();
    }
  }

  /** 物品接近检测（NPC 优先，近距离有 NPC 时不显示物品提示） */
  _updateItemProximity() {
    this.currentNearbyItem = null;
    if (this.currentNearbyNPC) {
      this.interactHint.setVisible(false);
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
