import Phaser from 'phaser';
import { GAME, COORD } from '../config.js';

/**
 * 地图配置 — 小镇布局（严格参考 design.md Prompt 指南）
 * 每格 16px，地图 80x50 格 = 1280x800 px
 * 风格：16-bit 像素、星露谷式俯视、江南水乡、水墨淡雅、低饱和
 */
const MAP_COLS = 80;
const MAP_ROWS = 50;
const TILE = GAME.TILE_SIZE; // 16

// 地图放大倍数（素材 1280×800 放大后可滚动）
const MAP_SCALE = 1.8;

// Tile 类型常量（细化建筑类型以支持不同颜色）
const T = {
  GRASS:    'grass',       // 草地（淡青+竹绿）
  ROAD:     'road',        // 青石板路（浅灰+深灰缝+青苔）
  DIRT:     'dirt',        // 土路（浅棕）
  WATER:    'water',       // 河水（淡蓝+波纹）
  BRIDGE:   'bridge',      // 石桥（青灰色）
  STAGE:    'stage',       // 戏台（暖红+木棕+金黄）— 核心地标
  TEA:      'tea',         // 茶馆（米黄+茶褐+竹绿）
  DOCK:     'dock',        // 码头（水蓝+青灰+雾白）
  TEMPLE:   'temple',      // 祠堂（淡灰+米白）
  HOUSE:    'house',       // 民居（淡灰+浅绿）
  TREE:     'tree',        // 树木/竹林（竹绿+黛蓝）
};

// ========== 江南水乡配色表（参考 design.md 低饱和色调）==========
// 阶段一：冷色调（不屑）
const PALETTE = {
  [T.GRASS]:   { base: 0x8ab88a, dark: 0x7aa87a, highlight: 0xa0c8a0 },  // 淡青草地
  [T.ROAD]:    { base: 0xb8b4a8, dark: 0xa8a498, highlight: 0xc8c4b8 },  // 青石板
  [T.DIRT]:    { base: 0xbba888, dark: 0xab9878, highlight: 0xcbb898 },  // 浅棕土路
  [T.WATER]:   { base: 0x7899bb, dark: 0x6889ab, highlight: 0x98bbdd },  // 黛蓝河水
  [T.BRIDGE]:  { base: 0x9eaaa0, dark: 0x8e9a90, highlight: 0xaebab0 },  // 青灰石桥
  [T.STAGE]:   { base: 0xcc9977, dark: 0xbc8967, highlight: 0xdca987 },  // 戏台暖红
  [T.TEA]:     { base: 0xc8bc9a, dark: 0xb8ac8a, highlight: 0xd8ccaa },  // 茶馆米黄
  [T.DOCK]:    { base: 0x9aacb8, dark: 0x8a9ca8, highlight: 0xaaaccc },  // 码头水蓝
  [T.TEMPLE]:  { base: 0xbcb8b0, dark: 0xaca8a0, highlight: 0xccccc2 }, // 祠堂灰白
  [T.HOUSE]:   { base: 0xbec4b8, dark: 0xaeb4a8, highlight: 0xcec4c8 }, // 民居淡灰
  [T.TREE]:    { base: 0x4a7058, dark: 0x3a6048, highlight: 0x6a8068 },  // 竹林黛绿
};

// 黑边色（1px hard edge）
const BLACK_EDGE = 0x222222;

// ========== 程序化生成小镇地图（按 design.md 布局）==========
function generateMapData() {
  const map = Array.from({ length: MAP_ROWS }, () => Array(MAP_COLS).fill(T.GRASS));

  // 边界设为树（竹篱笆/竹林边缘）
  for (let r = 0; r < MAP_ROWS; r++) {
    for (let c = 0; c < MAP_COLS; c++) {
      if (r === 0 || r === MAP_ROWS - 1 || c === 0 || c === MAP_COLS - 1) {
        map[r][c] = T.TREE;
      }
    }
  }

  // ====== 青石板主街 — 贯穿南北（偏右，3 格宽）======
  for (let r = 5; r < MAP_ROWS - 5; r++) {
    for (let dc = -1; dc <= 1; dc++) {
      const c = 48 + dc;
      if (c > 0 && c < MAP_COLS - 1) map[r][c] = T.ROAD;
    }
  }

  // ====== 小河 — 从西向东穿过小镇（第 25 行附近，3 格宽）======
  for (let c = 8; c <= 65; c++) {
    map[24][c] = T.WATER;
    map[25][c] = T.WATER;
    map[26][c] = T.WATER;
  }

  // 石桥 — 跨河连接两岸与主街（4 格宽）
  for (let dc = -1; dc <= 2; dc++) {
    map[23][48 + dc] = T.BRIDGE;
    map[27][48 + dc] = T.BRIDGE;
    map[24][48 + dc] = T.BRIDGE;
    map[25][48 + dc] = T.BRIDGE;
    map[26][48 + dc] = T.BRIDGE;
  }

  // ====== 西侧：戏台区域（核心地标）======
  drawBuilding(map, 4, 4, 14, 11, T.STAGE);   // 戏台大院（最大建筑，红色调）
  drawBuilding(map, 4, 17, 9, 7, T.STAGE);     // 后台化妆间

  // ====== 中部偏西：茶馆（消息集散地）======
  drawBuilding(map, 36, 11, 11, 9, T.TEA);

  // ====== 东侧：码头（河运入口）======
  drawBuilding(map, 64, 21, 12, 7, T.DOCK);

  // ====== 北部：祠堂 ======
  drawBuilding(map, 30, 4, 10, 9, T.TEMPLE);

  // ====== 南部：民居小巷（散落分布）======
  drawBuilding(map, 18, 36, 9, 9, T.HOUSE);
  drawBuilding(map, 54, 38, 11, 9, T.HOUSE);
  drawBuilding(map, 14, 43, 9, 5, T.HOUSE);
  drawBuilding(map, 68, 35, 8, 8, T.HOUSE);  // 东侧小屋

  // ====== 散落树木装饰（竹林、垂柳感）======
  scatterTrees(map, 50);

  // ====== 土路分支 — 连接主街到各建筑 ======
  // 到戏台的横路（北部横向大土路）
  for (let c = 18; c <= 46; c++) map[10][c] = T.DIRT;
  for (let r = 10; r <= 15; r++) map[r][46] = T.DIRT;

  // 到茶馆的路
  for (let r = 16; r <= 20; r++) map[r][43] = T.DIRT;
  for (let c = 36; c <= 43; c++) map[20][c] = T.DIRT;

  // 到祠堂的路
  for (let r = 13; r <= 17; r++) map[r][40] = T.DIRT;
  for (let c = 40; c <= 47; c++) map[13][c] = T.DIRT;

  // 到码头的路
  for (let r = 28; r <= 34; r++) map[r][52] = T.DIRT;
  for (let c = 52; c <= 64; c++) map[28][c] = T.DIRT;

  return map;
}

function drawBuilding(map, col, row, w, h, type) {
  for (let r = row; r < row + h && r < MAP_ROWS; r++) {
    for (let c = col; c < col + w && c < MAP_COLS; c++) {
      if (r >= 0 && c >= 0 && map[r][c] !== T.WATER && map[r][c] !== T.BRIDGE) {
        map[r][c] = type;
      }
    }
  }
}

function scatterTrees(map, count) {
  let placed = 0;
  while (placed < count) {
    const r = Math.floor(Math.random() * (MAP_ROWS - 4)) + 2;
    const c = Math.floor(Math.random() * (MAP_COLS - 4)) + 2;
    if (map[r][c] === T.GRASS) {
      map[r][c] = T.TREE;
      placed++;
    }
  }
}

// ==========================================

// ========== 主角精灵配置 ==========
const PROTAGONIST = {
  baseDir: '/assets/images/characters/protagonist/sprites',
  prefix: 'protagonist',
  scale: 0.09,
  bodyRatio: { w: 0.5, h: 0.6, offsetX: 0.25, offsetY: 0.35 },
};

// ========== NPC 精灵配置 ==========
const NPC_SPRITES = {
  'npc_chen':    { prefix: 'chenshifu',     baseDir: '/assets/images/characters/npc-chenshifu/sprites',     scale: 0.09 },
  'npc_xiaohua': { prefix: 'xiaohua',        baseDir: '/assets/images/characters/npc-xiaohua/sprites',       scale: 0.09 },
  'npc_laozhou': { prefix: 'laozhou',        baseDir: '/assets/images/characters/npc-laozhou/sprites',       scale: 0.09 },
  'npc_laoli':   { prefix: 'chuanfulaoli',   baseDir: '/assets/images/characters/npc-chuanfulaoli/sprites',  scale: 0.09 },
  'npc_meiyi':   { prefix: 'meiyi',          baseDir: '/assets/images/characters/npc-meiyi/sprites',         scale: 0.09 },
};

// ★ 普通NPC/town-npcs 的回退精灵配置（使用小华的素材作为通用路人外观）
const FALLBACK_NPC_SPRITE = {
  prefix: 'xiaohua',
  baseDir: '/assets/images/characters/npc-xiaohua/sprites',
  scale: 0.08,   // 稍微小一点以区分主要NPC
};
const DIRS = ['down', 'left', 'right', 'up'];

export class GameScene extends Phaser.Scene {
  constructor() {
    super({ key: 'GameScene' });
  }

  init(data) {
    this._savedSessionId = data?.savedSessionId || null;
  }

  preload() {
    // 加载主角切分后的单帧图片（每方向 idle + walk 各一张）
    for (const dir of DIRS) {
      this.load.image(`${PROTAGONIST.prefix}_idle_${dir}`, `${PROTAGONIST.baseDir}/${PROTAGONIST.prefix}_idle_${dir}.png`);
      this.load.image(`${PROTAGONIST.prefix}_walk_${dir}`, `${PROTAGONIST.baseDir}/${PROTAGONIST.prefix}_walk_${dir}.png`);
    }
    // 加载 NPC 精灵图
    for (const [npcId, cfg] of Object.entries(NPC_SPRITES)) {
      for (const dir of DIRS) {
        this.load.image(`${cfg.prefix}_idle_${dir}`, `${cfg.baseDir}/${cfg.prefix}_idle_${dir}.png`);
        this.load.image(`${cfg.prefix}_walk_${dir}`, `${cfg.baseDir}/${cfg.prefix}_walk_${dir}.png`);
      }
    }
    // 加载大地图素材（江南水乡小镇全景）
    this.load.image('town_worldmap', '/assets/images/maps/town_worldmap.png');
  }

  create() {
    // 检查是否从菜单传来的存档 sessionId
    const savedSessionId = this._savedSessionId;

    this.mapData = generateMapData();
    this.cursors = null;
    this.player = null;
    this.npcs = [];
    this.npcBubbles = [];
    this.sceneItems = [];      // 场景中可交互的物品精灵
    this.townNpcs = [];        // 普通NPC（town-npcs）精灵列表
    this.townNpcBubbles = [];  // 普通NPC气泡列表
    this.inputLocked = false;
    this.currentStage = 1;
    this.currentNearbyItem = null;

    this.drawTileMap();

    // ★ 直接从地图图片取实际渲染尺寸作为边界（最准确）
    const actualMapW = this.mapImage.displayWidth;
    const actualMapH = this.mapImage.displayHeight;

    // [DEBUG] 立即打印所有尺寸
    console.log('[GameScene] 初始化尺寸:', {
      GAME_WIDTH: GAME.WIDTH, GAME_HEIGHT: GAME.HEIGHT,
      MAP_SCALE,
      configW: GAME.WIDTH * MAP_SCALE, configH: GAME.HEIGHT * MAP_SCALE,
      actualMapW, actualMapH,  // 图片真实渲染尺寸
      canvasW: this.sys.game.config.width,
      canvasH: this.sys.game.config.height,
      camW: this.cameras.main.width,
      camH: this.cameras.main.height,
    });

    // 用实际图片尺寸
    this._mapBounds = { w: actualMapW, h: actualMapH };

    this.createCollisionLayer();
    this.createPlayer();
    this.createNPCs();

    // ★ 完全手动控制摄像机 — 不用 startFollow，避免其内部边界限制
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

    // F键交互提示文字（江南风配色）
    this.interactHint = this.add.text(0, 0, '', {
      fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
      fontSize: '17px',
      color: '#d4c4a0',
      backgroundColor: '#2a2824ee',
      padding: { x: 10, y: 5 },
      border: 1,
      borderRadius: 4,
    }).setOrigin(0.5).setDepth(100).setVisible(false).setScrollFactor(0);

    // ========== 碰撞编辑器相关 ==========
    this._editMode = false;
    this._editGridGraphics = null;       // 网格 + 碰撞显示层
    this._editHUD = null;               // 编辑器 UI 提示
    this._collisionMap = {};            // 碰撞数据 { "col_row": true }
    this._draggedNPC = null;            // 正在拖拽的 NPC

    // 编辑器快捷键
    this.editKeys = {
      E: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E),
      S: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      C: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.C),  // 清除所有碰撞
      R: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.R),  // 硬重置（清除缓存+重启）
    };

    // 延迟一帧初始化编辑器（等地图尺寸就绪）
    this.time.delayedCall(200, () => this._initEditor());

    // NPC 交互按钮（靠近 NPC 时显示）
    this.npcActionContainer = this.add.container(0, 0).setDepth(102).setVisible(false).setScrollFactor(0);
    this._createNPCActionButtons();
    // ★ NPC 交互按钮通过可见性+定位直接驱动，无需状态追踪

    // 事件监听
    this.events.on('input:lock', (locked) => {
      this.inputLocked = locked;
    });

    this.events.on('game:restart', () => {
      this.scene.stop('UIScene');
      this.scene.restart();
    });

    this.events.on('state:refresh', (state) => {
      this.refreshNPCsFromState(state);
      this.refreshSceneItems(state);
    });

    this.events.on('stage:change', (newStage) => {
      this.applyStageTone(newStage);
    });

    // 阶段色调遮罩（半透明，避免 flash 遮挡地图）
    this.tintOverlay = this.add.rectangle(
      this.cameras.main.centerX,
      this.cameras.main.centerY,
      this.cameras.main.width,
      this.cameras.main.height,
      0xffffff,
      0
    );
    this.tintOverlay.setScrollFactor(0);
    this.tintOverlay.setDepth(999);
    this.tintOverlay.setOrigin(0.5);
    // 遮罩仅用于视觉色调叠加，永远不参与输入交互
    this.tintOverlay.setInteractive = () => this.tintOverlay;

    this.scene.launch('UIScene');

    // 显示控制提示（5秒后自动消失）
    this._showControlsHint();

    // 延迟一帧通知 UI 游戏已就绪（此时 UIScene 已完全创建）
    this.time.delayedCall(100, () => {
      if (savedSessionId) {
        this.restoreGame(savedSessionId);
      } else {
        this.initGame();
      }
    });
  }

  /**
   * 初始化游戏状态 — POST /api/game/start → POST /chapter/start
   */
  async initGame() {
    try {
      const { startGame, saveGameState, startChapter } = await import('../api/client.js');

      // 显示加载提示
      this.showLoadingHint('正在创建新的故事……');

      const gameState = await startGame('玩家');
      if (!gameState || !gameState.session_id) throw new Error('创建游戏失败');

      // 确定当前章节映射 stage
      let stage = gameState.current_stage || 1;
      let chapterId = null;
      let chapterName = null;
      if (gameState.current_chapter) {
        chapterId = gameState.current_chapter.chapter_id;
        chapterName = gameState.current_chapter.chapter_name;
      }

      this.hideLoadingHint();
      this.currentStage = stage;

      // 持久化
      localStorage.setItem('__active_session__', gameState.session_id);
      saveGameState(gameState.session_id, gameState);

      // 刷新 NPC 状态（从 API 获取完整 NPC 列表）
      if (gameState.npcs) {
        this.time.delayedCall(300, () => this.refreshNPCsFromState(gameState));
      }

      // ★ 加载普通 NPC（town-npcs）
      this.time.delayedCall(500, () => this.loadTownNPCs());

      // 通知 UI
      this.events.emit('game:init', {
        sessionId: gameState.session_id,
        stage: stage,
        chapterId: chapterId,
        chapterName: chapterName,
        inventory: gameState.inventory || [],
      });

      // 应用初始阶段色调
      if (gameState.stage_params) {
        this.time.delayedCall(500, () => this.applyStageTone(gameState.stage_params));
      }

      // v2: 自动开始第一章
      if (!chapterId) {
        this.showLoadingHint('正在载入第一章……');
        try {
          const chResult = await startChapter(gameState.session_id);
          this.hideLoadingHint();
          if (chResult && chResult.chapter_id) {
            this.time.delayedCall(800, () => {
              const stageId = 1; // 第一章
              const toneInfo = chResult.color_tone || '#8899aa';
              this.events.emit('stage:change', {
                id: stageId,
                name: chResult.chapter_name || '归乡',
                description: chResult.task ? chResult.task.description : '',
                color_tone: toneInfo,
                bgm_mood: chResult.bgm_mood || '',
              });
            });
          }
        } catch (chErr) {
          this.hideLoadingHint();
          console.warn('[GameScene] 章节初始化失败（非阻塞）:', chErr);
        }
      }

      console.log('[GameScene] 游戏已初始化, session:', gameState.session_id);
    } catch (e) {
      this.hideLoadingHint();
      console.error('[GameScene] 初始化游戏失败:', e);
      this.showToast('连接服务器失败，请确认后端已启动', 3000);
    }
  }

  /**
   * 恢复存档游戏
   */
  async restoreGame(sessionId) {
    try {
      const { getGameState, saveGameState } = await import('../api/client.js');

      this.showLoadingHint('正在加载存档……');

      // 先尝试从 API 获取最新状态
      let gameState = null;
      try {
        gameState = await getGameState(sessionId);
      } catch (apiErr) {
        // API 不可用时回退到 localStorage
        console.warn('[GameScene] API 获取状态失败，回退到本地缓存:', apiErr.message);
      }

      // 回退到 localStorage
      if (!gameState || !gameState.session_id) {
        const saved = localStorage.getItem(`game_state_${sessionId}`);
        if (!saved) throw new Error('存档不存在');
        gameState = JSON.parse(saved);
      }

      this.hideLoadingHint();

      console.log('[GameScene] 恢复存档, session:', sessionId, 'stage:', gameState.current_stage);

      this.currentStage = gameState.current_stage || 1;
      let chapterId = null;
      let chapterName = null;
      if (gameState.current_chapter) {
        chapterId = gameState.current_chapter.chapter_id;
        chapterName = gameState.current_chapter.chapter_name;
      }

      this.events.emit('game:init', {
        sessionId: sessionId,
        stage: this.currentStage,
        chapterId: chapterId,
        chapterName: chapterName,
        inventory: gameState.inventory || [],
      });

      // 刷新 NPC 状态
      if (gameState.npcs) {
        this.time.delayedCall(300, () => this.refreshNPCsFromState(gameState));
      }

      // ★ 加载普通 NPC
      this.time.delayedCall(500, () => this.loadTownNPCs());

      // 同步到本地缓存
      saveGameState(sessionId, gameState);

      // 如果已结局，通知 UI
      if (gameState.game_ended && gameState.ending) {
        console.log('[GameScene] 存档已是结局状态');
        this.time.delayedCall(500, () => {
          this.events.emit('ending:restore', gameState.ending);
        });
      }

      // 应用阶段色调
      if (gameState.stage_params) {
        this.time.delayedCall(500, () => this.applyStageTone(gameState.stage_params));
      }
    } catch (e) {
      this.hideLoadingHint();
      console.warn('[GameScene] 恢复存档失败，开始新游戏:', e);
      this.initGame();
    }
  }


  // ==================== 场景物品系统 ====================

  /**
   * 从后端状态刷新场景物品（显示当前章节可拾取的物品精灵）
   */
  async refreshSceneItems(state) {
    const sessionId = localStorage.getItem('__active_session__');
    if (!sessionId) return;

    try {
      const { getItems } = await import('../api/client.js');
      const data = await getItems(sessionId);

      // 清除已有的物品精灵
      this.sceneItems.forEach(sp => sp.destroy());
      this.sceneItems = [];
      this.currentNearbyItem = null;

      // 创建新的物品精灵
      const sceneItems = data.scene_items || [];
      sceneItems.forEach(item => {
        if (!item.location || !item.location.position) return;
        const { col, row } = item.location.position;
        this.createSceneItemSprite(item, col, row);
      });

      console.log(`[GameScene] 场景物品已刷新: ${this.sceneItems.length} 个`);
    } catch (e) {
      console.warn('[GameScene] 刷新场景物品失败:', e);
    }
  }

  // ==================== 普通NPC系统（town-npcs）====================

  /**
   * 加载并创建普通NPC（从后端 API 或 Mock 数据）
   * 在游戏初始化后调用，支持运行时动态增删
   */
  async loadTownNPCs() {
    try {
      const { getTownNPCs } = await import('../api/client.js');
      const data = await getTownNPCs('liyuan_shengsi');

      // 清除已有的普通NPC精灵
      this.townNpcs.forEach(sp => sp.destroy());
      this.townNpcBubbles.forEach(b => b.destroy());
      this.townNpcs = [];
      this.townNpcBubbles = [];

      const townNpcList = data.town_npcs || [];
      townNpcList.forEach(townNpc => {
        const sprite = this.createTownNPCSprite(townNpc);
        if (sprite) {
          this.townNpcs.push(sprite);
          // 气泡
          const bubbleText = this.add.text(sprite.x, sprite.y - 18 * MAP_SCALE, townNpc.greeting || '', {
            fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
            fontSize: '14px', color: '#c8dcc8',
            backgroundColor: '#1a2824dd',
            padding: { x: 6, y: 3 },
            wordWrap: { width: 140 }, align: 'center', lineSpacing: 3,
          }).setOrigin(0.5).setDepth(100);
          this.townNpcBubbles.push(bubbleText);

          // ★ 初始化漫游状态
          sprite.setData('wanderState', this._initWanderState(townNpc));
        }
      });

      console.log(`[GameScene] 普通NPC已加载: ${this.townNpcs.length} 个`);
    } catch (e) {
      console.warn('[GameScene] 加载普通NPC失败（非阻塞）:', e);
    }
  }

  /**
   * 创建单个普通NPC精灵
   */
  createTownNPCSprite(townNpc) {
    const cfg = FALLBACK_NPC_SPRITE;
    const col = townNpc.position?.col || 30;
    const row = townNpc.position?.row || 40;
    const { x: posX, y: posY } = COORD.toPixel(col, row);

    const startKey = `${cfg.prefix}_idle_down`;
    const sprite = this.physics.add.sprite(posX * MAP_SCALE, posY * MAP_SCALE, startKey);
    sprite.setScale(cfg.scale);
    sprite.setData('npcId', townNpc.id);           // 如 "town_001"
    sprite.setData('name', townNpc.name);           // 如 "卖菜大婶"
    sprite.setData('greeting', townNpc.greeting || '');
    sprite.setData('spriteCfg', cfg);
    sprite.setData('isTownNPC', true);
    sprite.setImmovable(true);
    sprite.body.pushable = false;
    sprite.setDepth(4);  // 比主要NPC略低一层
    sprite.setVisible(true);

    return sprite;
  }

  /**
   * 初始化单个NPC的漫游状态
   */
  _initWanderState(townNpc) {
    const movement = townNpc.movement || {};
    return {
      enabled: movement.enabled !== false,
      speed: (movement.speed || 35) * 0.01,     // 转换为 px/frame 左右
      idleTimer: 0,
      idleDuration: (movement.idle_range?.[0] || 3) * 60 + Math.random() * ((movement.idle_range?.[1] || 8) - (movement.idle_range?.[0] || 3)) * 60,
      wanderTimer: 0,
      wanderDuration: (movement.wander_range?.[4] || 6) * 60,
      state: 'idle',       // 'idle' | 'wandering'
      targetX: 0,
      targetY: 0,
      originCol: townNpc.position?.col || 30,
      originRow: townNpc.position?.row || 40,
      wanderRange: movement.wander_range?.[1] || 10, // 最大漫游格子范围
    };
  }

  /**
   * 更新所有普通NPC的漫游行为（每帧调用）
   * 简单的状态机：idle → 选目标 → wandering → 到达 → idle
   */
  _updateTownNPCs(dt) {
    for (let i = 0; i < this.townNpcs.length; i++) {
      const npc = this.townNpcs[i];
      const wander = npc.getData('wanderState');
      if (!wander || !wander.enabled || !npc.active) continue;

      const bubble = this.townNpcBubbles[i];
      switch (wander.state) {
        case 'idle':
          wander.idleTimer++;
          // 偶尔切换朝向
          if (Math.random() < 0.005) {
            const dirs = ['down', 'left', 'right', 'up'];
            const dir = dirs[Math.floor(Math.random() * dirs.length)];
            const cfg = npc.getData('spriteCfg');
            if (cfg) npc.setTexture(`${cfg.prefix}_idle_${dir}`);
          }
          if (wander.idleTimer >= wander.idleDuration) {
            // 进入漫游：随机选一个目标点（在 origin 附近 wanderRange 格内）
            const angle = Math.random() * Math.PI * 2;
            const dist = (3 + Math.random() * (wander.wanderRange - 3)) * TILE * MAP_SCALE;
            wander.targetX = npc.x + Math.cos(angle) * dist;
            wander.targetY = npc.y + Math.sin(angle) * dist;
            // 边界 clamp
            const mapW = MAP_COLS * TILE * MAP_SCALE;
            const mapH = MAP_ROWS * TILE * MAP_SCALE;
            wander.targetX = Phaser.Math.Clamp(wander.targetX, TILE * MAP_SCALE, mapW - TILE * MAP_SCALE);
            wander.targetY = Phaser.Math.Clamp(wander.targetY, TILE * MAP_SCALE, mapH - TILE * MAP_SCALE);
            wander.state = 'wandering';
            wander.wanderTimer = 0;
            wander.wanderDuration = (wander.wanderRange * 40 + Math.random() * 60); // 根据距离调整时长
          }
          break;

        case 'wandering':
          wander.wanderTimer++;
          const dx = wander.targetX - npc.x;
          const dy = wander.targetY - npc.y;
          const distToTarget = Math.sqrt(dx * dx + dy * dy);

          if (distToTarget < 5) {
            // 到达目标，切回 idle
            wander.state = 'idle';
            wander.idleTimer = 0;
            wander.idleDuration = (3 + Math.random() * 5) * 60;
            const cfg = npc.getData('spriteCfg');
            if (cfg) npc.setTexture(`${cfg.prefix}_idle_down`);
          } else {
            // 向目标移动
            const moveSpeed = wander.speed * (dt / 16.667); // 归一化到 ~60fps
            const vx = (dx / distToTarget) * moveSpeed;
            const vy = (dy / distToTarget) * moveSpeed;
            npc.x += vx;
            npc.y += vy;

            // 更新朝向
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

      // 气泡跟随
      if (bubble) bubble.setPosition(npc.x, npc.y - 18 * MAP_SCALE);
    }
  }

  /**
   * 创建一个场景物品精灵
   */
  createSceneItemSprite(itemData, col, row) {
    const pos = COORD.toPixel(col, row);
    const px = pos.x * MAP_SCALE;
    const py = pos.y * MAP_SCALE;
    // 使用 emoji 文字作为物品图标
    const emoji = '📦';
    const sprite = this.add.text(px, py, emoji, {
      fontSize: `${20 * MAP_SCALE}px`,
    }).setOrigin(0.5).setDepth(90);

    sprite.setData('itemId', itemData.item_id);
    sprite.setData('name', itemData.name);

    // 小幅上下浮动动画
    this.tweens.add({
      targets: sprite,
      y: py - 4 * MAP_SCALE,
      duration: 1200,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    this.sceneItems.push(sprite);
  }

  /**
   * 根据状态刷新 NPC（动态创建/更新）
   */
  refreshNPCsFromState(state) {
    if (!state || !state.npcs) return;
    state.npcs.forEach(stateNpc => {
      let sprite = this.npcs.find(s => s.getData('npcId') === stateNpc.id);
      if (!sprite) {
        // 动态创建新 NPC（API 返回了本地不存在的 NPC）
        sprite = this.createNPCSprite(stateNpc.id, stateNpc.name, stateNpc);
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
        const idx = this.npcs.indexOf(sprite);
        if (idx >= 0 && this.npcBubbles[idx]) {
          this.npcBubbles[idx].setText(stateNpc.current_greeting || '');
          this.npcBubbles[idx].setVisible(stateNpc.is_available !== false);
        }
      }
    });
  }

  /**
   * 动态创建单个 NPC 精灵（使用真实精灵图）
   * ★ 对于不在 NPC_SPRITES 中的普通NPC（如 town_001），自动回退到 FALLBACK_NPC_SPRITE
   */
  createNPCSprite(npcId, name, stateNpc) {
    const cfg = NPC_SPRITES[npcId] || FALLBACK_NPC_SPRITE;
    if (!cfg) {
      console.warn(`[GameScene] NPC ${npcId} 无精灵配置，跳过创建`);
      return null;
    }

    const defaultPos = npcId === 'npc_chen' ? { col: 38, row: 14 } : { col: 15, row: 12 };
    const col = stateNpc.position ? stateNpc.position.col : defaultPos.col;
    const row = stateNpc.position ? stateNpc.position.row : defaultPos.row;
    const { x: posX, y: posY } = COORD.toPixel(col || defaultPos.col, row || defaultPos.row);

    const startKey = `${cfg.prefix}_idle_down`;
    const sprite = this.physics.add.sprite(posX * MAP_SCALE, posY * MAP_SCALE, startKey);
    sprite.setScale(cfg.scale);
    sprite.setData('npcId', npcId);
    sprite.setData('name', name);
    sprite.setData('greeting', stateNpc.current_greeting || '');
    sprite.setData('spriteCfg', cfg);
    sprite.setData('isTownNPC', !NPC_SPRITES[npcId]); // 标记是否为普通NPC
    sprite.setImmovable(true);
    sprite.body.pushable = false;
    sprite.setDepth(5);
    sprite.setVisible(stateNpc.is_available !== false);

    // 注册物理重叠
    this.physics.add.overlap(this.player, sprite, () => {
      // overlap callback 在 update 中通过 currentNearbyNPC 处理
    });

    return sprite;
  }

  /**
   * 应用阶段色调到摄像机（兼容 v2 格式 color_tone hex 或 mood 字符串）
   */
  applyStageTone(newStage) {
    if (!this.cameras) return;
    this.currentStage = newStage.id;

    // 色调映射（支持 v2 hex 字符串 + v1 mood 字符串）
    const tintMap = {
      cold:       { r: 160, g: 172, b: 210, alpha: 0.08 },
      warm:       { r: 255, g: 245, b: 210, alpha: 0.12 },
      dramatic:   { r: 255, g: 230, b: 195, alpha: 0.15 },
      melancholy: { r: 136, g: 153, b: 170, alpha: 0.10 },
      somber:     { r: 153, g: 136, b: 119, alpha: 0.12 },
    };

    // 尝试从 hex 字符串解析
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

    // 重置相机背景色
    this.cameras.main.setBackgroundColor(Phaser.Display.Color.GetColor(
      Math.floor(tint.r * 0.15),
      Math.floor(tint.g * 0.12),
      Math.floor(tint.b * 0.16)
    ));

    // 通过半透明遮罩施加持续色调
    if (this.tintOverlay) {
      this.tintOverlay.setFillStyle(
        Phaser.Display.Color.GetColor(tint.r, tint.g, tint.b),
        tint.alpha
      );
    }
  }

  // ==================== 地图绘制（江南水乡像素风格）====================

  drawTileMap() {
    // 使用素材图片替换程序化绘制，放大显示以支持摄像机滚动
    this.mapImage = this.add.image(0, 0, 'town_worldmap').setOrigin(0, 0);
    this.mapImage.setDepth(0);
    this.mapImage.setScale(MAP_SCALE);
  }

  createCollisionLayer() {
    // 从 localStorage 加载已保存的碰撞配置
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

  // ========== 可视化碰撞编辑器 ==========

  /** 初始化编辑器（创建网格层、HUD、绑定事件） */
  _initEditor() {
    // 网格 + 碰撞高亮显示层（跟随地图滚动）
    this._editGridGraphics = this.add.graphics().setDepth(50).setScrollFactor(1);

    // 编辑器 HUD（固定屏幕）
    this._editHUD = this.add.container(0, 0).setDepth(1000).setScrollFactor(0).setVisible(false);

    const hudBg = this.add.graphics();
    hudBg.fillStyle(0x1a1820, 0.95);
    hudBg.fillRoundedRect(-200, -30, 400, 60, 8);
    hudBg.lineStyle(2, 0xd4b896, 0.6);
    hudBg.strokeRoundedRect(-200, -30, 400, 60, 8);
    this._editHUD.add(hudBg);

    this._editHUDText = this.add.text(0, 0, '', {
      fontFamily: '"Consolas", monospace',
      fontSize: '15px', color: '#d4b896',
      align: 'center', lineSpacing: 4,
    }).setOrigin(0.5);
    this._editHUD.add(this._editHUDText);

    // 鼠标点击/拖拽事件
    this.input.on('pointerdown', (ptr) => this._onEditPointerDown(ptr));
    this.input.on('pointermove', (ptr) => this._onEditPointerMove(ptr));
    this.input.on('pointerup', (ptr) => this._onEditPointerUp(ptr));

    console.log('[Editor] 初始化完成 — 按 [E] 进入编辑模式');
  }

  /** 切换编辑模式 */
  _toggleEditMode() {
    this._editMode = !this._editMode;
    if (this._editMode) {
      // 进入编辑模式：冻结玩家物理，启用自由摄像机滚动
      this.player.setVelocity(0, 0);
      this.player.body.enable = false;
      this._editCamFreeScroll = true;

      this._editHUD.setVisible(true);
      this._editHUD.setPosition(this.cameras.main.width / 2, 40);
      this._refreshEditHUD();
      this._drawCollisionGrid();
      console.log('[Editor] 已进入编辑模式 — WASD滚动视角 | 左键:切换碰撞 | 拖拽:NPC');
    } else {
      // 退出编辑模式：自动保存 + 恢复玩家物理
      this._saveToLocalStorage();
      console.log('[Editor] 碰撞数据已自动保存');
      this.player.body.enable = true;
      this._editCamFreeScroll = false;

      this._editHUD.setVisible(false);
      this._draggedNPC = null;
      if (this._editGridGraphics) this._editGridGraphics.clear();
      console.log('[Editor] 已退出编辑模式');
    }
  }

  /** 刷新 HUD 显示 */
  _refreshEditHUD() {
    const count = Object.keys(this._collisionMap).length;
    const mode = this._draggedNPC ? '拖拽NPC中...' : 'WASD:滚动视角 | 左键:碰撞 | 拖拽:NPC | S:保存 | C:清除';
    this._editHUDText.setText(`[碰撞编辑模式]  碰撞格: ${count}\n${mode}`);
  }

  /** 绘制网格和碰撞区域 */
  _drawCollisionGrid() {
    const g = this._editGridGraphics;
    if (!g) return;
    g.clear();

    const gridPx = TILE * MAP_SCALE;   // 每格像素大小
    const mapW = MAP_COLS * gridPx;
    const mapH = MAP_ROWS * gridPx;

    // 1. 绘制浅色网格线（所有格子）
    g.lineStyle(1, 0xffffff, 0.12);
    for (let c = 0; c <= MAP_COLS; c++) {
      g.moveTo(c * gridPx, 0); g.lineTo(c * gridPx, mapH);
    }
    for (let r = 0; r <= MAP_ROWS; r++) {
      g.moveTo(0, r * gridPx); g.lineTo(mapW, r * gridPx);
    }

    // 2. 绘制碰撞格子（红色半透明填充 + 边框）
    for (const key of Object.keys(this._collisionMap)) {
      const [c, r] = key.split('_').map(Number);
      g.fillStyle(0xff3333, 0.35);
      g.fillRect(c * gridPx, r * gridPx, gridPx, gridPx);
      g.lineStyle(2, 0xff6666, 0.8);
      g.strokeRect(c * gridPx, r * gridPx, gridPx, gridPx);
    }

    // 3. 标注 NPC 位置
    for (const npc of this.npcs) {
      const tile = COORD.toTile(npc.x / MAP_SCALE, npc.y / MAP_SCALE);
      const cx = tile.col * gridPx + gridPx / 2;
      const cy = tile.row * gridPx + gridPx / 2;

      // NPC 圆形标记（青色）
      g.fillStyle(0x00ffff, 0.4);
      g.fillCircle(cx, cy, gridPx * 0.4);
      g.lineStyle(2, 0x00ffff, 0.9);
      g.strokeCircle(cx, cy, gridPx * 0.4);
    }
  }

  /** 获取鼠标指向的瓦片坐标（边界 clamp，防止边缘像素越界） */
  _getPointerTile(ptr) {
    const cam = this.cameras.main;
    const worldX = ptr.x + cam.scrollX;
    const worldY = ptr.y + cam.scrollY;
    const gridPx = TILE * MAP_SCALE;
    // 用 clamp 确保边缘像素映射到最后一个有效瓦片（而非越界） */
    return {
      col: Phaser.Math.Clamp(Math.floor(worldX / gridPx), 0, MAP_COLS - 1),
      row: Phaser.Math.Clamp(Math.floor(worldY / gridPx), 0, MAP_ROWS - 1),
    };
  }

  /** 编辑模式下的鼠标按下 */
  _onEditPointerDown(ptr) {
    if (!this._editMode) return;

    const tile = this._getPointerTile(ptr);

    // 检查是否点中 NPC（优先检测拖拽）
    for (const npc of this.npcs) {
      const dist = Phaser.Math.Distance.Between(
        ptr.x + this.cameras.main.scrollX,
        ptr.y + this.cameras.main.scrollY,
        npc.x, npc.y
      );
      if (dist < 32) {
        this._draggedNPC = npc;
        this._refreshEditHUD();
        console.log(`[Editor] 开始拖拽 NPC: ${npc.getData('name')}`);
        return;
      }
    }

    // 切换碰撞状态
    if (tile.col >= 0 && tile.col < MAP_COLS && tile.row >= 0 && tile.row < MAP_ROWS) {
      const key = `${tile.col}_${tile.row}`;
      if (this._collisionMap[key]) {
        delete this._collisionMap[key];
      } else {
        this._collisionMap[key] = true;
      }
      this._drawCollisionGrid();
      this._refreshEditHUD();
    }
  }

  /** 鼠标移动（绘制预览） */
  _onEditPointerMove(ptr) {
    if (!this._editMode) return;

    // 如果正在拖拽 NPC
    if (this._draggedNPC) {
      const cam = this.cameras.main;
      this._draggedNPC.x = ptr.x + cam.scrollX;
      this._draggedNPC.y = ptr.y + cam.scrollY;

      // 同步气泡位置
      const idx = this.npcs.indexOf(this._draggedNPC);
      if (idx >= 0 && this.npcBubbles[idx]) {
        this.npcBubbles[idx].setPosition(
          this._draggedNPC.x,
          this._draggedNPC.y - 22
        );
      }
      this._drawCollisionGrid();  // 重绘以更新 NPC 标记位置
    }
  }

  /** 鼠标释放 */
  _onEditPointerUp(ptr) {
    if (!this._editMode || !this._draggedNPC) return;

    const tile = COORD.toTile(this._draggedNPC.x / MAP_SCALE, this._draggedNPC.y / MAP_SCALE);
    console.log(`[Editor] NPC ${this._draggedNPC.getData('name')} 新位置: col=${tile.col}, row=${tile.row}`);

    // 吸附到格子中心
    const { x: cx, y: cy } = COORD.toPixelCenter(tile.col, tile.row);
    this._draggedNPC.x = cx * MAP_SCALE;
    this._draggedNPC.y = cy * MAP_SCALE;

    const idx = this.npcs.indexOf(this._draggedNPC);
    if (idx >= 0 && this.npcBubbles[idx]) {
      this.npcBubbles[idx].setPosition(this._draggedNPC.x, this._draggedNPC.y - 22);
    }

    this._draggedNPC = null;
    this._drawCollisionGrid();
    this._refreshEditHUD();
  }

  /** 仅写 localStorage（退出编辑时静默保存） */
  _saveToLocalStorage() {
    const npcPositions = {};
    for (const npc of this.npcs) {
      const tile = COORD.toTile(npc.x / MAP_SCALE, npc.y / MAP_SCALE);
      npcPositions[npc.getData('npcId')] = { col: tile.col, row: tile.row };
    }
    try {
      localStorage.setItem('editor_collision_map', JSON.stringify(this._collisionMap));
      localStorage.setItem('editor_npc_positions', JSON.stringify(npcPositions));
    } catch (e) {
      console.warn('[Editor] localStorage 保存失败:', e);
    }
  }

  /** 保存碰撞配置到 localStorage + 控制台导出 JSON（S 键手动触发） */
  _saveCollisionConfig() {
    this._saveToLocalStorage();

    // 控制台输出可复制 JSON
    console.log('═══════════════════════════════════');
    console.log('[Editor] 配置已保存! 碰撞格数:', Object.keys(this._collisionMap).length);
    console.log('\n// 碰撞数据 (复制到代码中使用):');
    console.log(JSON.stringify(this._collisionMap, null, 2));
    console.log('═══════════════════════════════════');

    this.showToast(`已保存! 碰撞:${Object.keys(this._collisionMap).length}格`, 2500);
    this._refreshEditHUD();
  }

  /** 清除所有碰撞数据 */
  _clearAllCollisions() {
    this._collisionMap = {};
    // 同时清除 localStorage 中的碰撞数据
    localStorage.removeItem('editor_collision_map');
    this._drawCollisionGrid();
    this._refreshEditHUD();
    console.log('[Editor] 🗑️ 已清除所有碰撞');
    this.showToast('已清除所有碰撞格', 1500);
  }

  /** 硬重置：仅清除游戏存档，保留编辑器配置 */
  _hardReset() {
    console.log('══════════════════════════════');
    console.log('[硬重置] 清除游戏存档(保留编辑器配置)...');
    // 仅清除游戏存档 session，不碰编辑器的碰撞/NPC位置
    localStorage.removeItem('__active_session__');  // 只清存档session
    // 注意: 不再删除 editor_collision_map 和 editor_npc_positions
    console.log('[硬重置] ✅ 存档已清除，编辑器配置保留，正在重启...');
    console.log('══════════════════════════════');

    this.scene.stop('UIScene');
    this.scene.restart();
  }

  /** 显示控制提示 */
  _showControlsHint() {
    const { width, height } = this.cameras.main;
    const hint = this.add.text(width / 2, height - 50, [
      '[WASD/方向键] 移动  |  [E] 碰撞编辑器(编辑器内WASD滚动视角)  |  [R] 硬重置',
    ].join('\n'), {
      fontFamily: '"Microsoft YaHei","Consolas",sans-serif',
      fontSize: '13px',
      color: '#aabbcc',
      backgroundColor: '#0a0a15dd',
      padding: { x: 12, y: 8 },
      align: 'center',
      lineSpacing: 3,
    }).setOrigin(0.5).setDepth(800).setAlpha(0).setScrollFactor(0);

    // 淡入 → 停留 → 淡出
    this.tweens.add({
      targets: hint,
      alpha: 1,
      duration: 500,
      onComplete: () => {
        this.time.delayedCall(6000, () => {
          this.tweens.add({ targets: hint, alpha: 0, duration: 1500, onComplete: () => hint.destroy() });
        });
      },
    });
  }

  /**
   * 检测某世界坐标是否在碰撞格中
   * @param {number} worldX 世界坐标 X（已含 MAP_SCALE）
   * @param {number} worldY 世界坐标 Y（已含 MAP_SCALE）
   * @returns {boolean} 是否碰撞
   */
  _checkCollisionAt(worldX, worldY) {
    // 如果没有设置任何碰撞，直接返回 false（不阻挡）
    if (!this._collisionMap || Object.keys(this._collisionMap).length === 0) return false;

    const gridPx = TILE * MAP_SCALE;
    const col = Math.floor(worldX / gridPx);
    const row = Math.floor(worldY / gridPx);

    // 检查玩家覆盖的 2x2 区域（角色比一格大）
    for (let dc = 0; dc <= 1; dc++) {
      for (let dr = 0; dr <= 1; dr++) {
        const key = `${col + dc}_${row + dr}`;
        if (this._collisionMap[key]) {
          // [DEBUG] 首次碰撞时打印
          if (!this._collDebug) { this._collDebug = true; console.log('[碰撞] 命中', key, 'at', Math.round(worldX), Math.round(worldY)); }
          return true;
        }
      }
    }
    return false;
  }

  // ==================== 玩家（真实精灵图 + 2帧walk动画）====================

  createPlayer() {
    const pos = COORD.toPixel(38, 26);
    const startX = pos.x * MAP_SCALE;
    const startY = pos.y * MAP_SCALE;
    const p = PROTAGONIST;

    // 用 idle_down 纹理创建主角
    this.player = this.physics.add.sprite(startX, startY, `${p.prefix}_idle_down`);
    this.player.setScale(p.scale);
    this.player.setCollideWorldBounds(false); // 不用物理边界（用摄像机边界替代）

    // 自定义碰撞体（脚底区域）
    const br = p.bodyRatio;
    const bodyW = Math.floor(this.player.displayWidth * br.w);
    const bodyH = Math.floor(this.player.displayHeight * br.h);
    this.player.body.setSize(bodyW, bodyH);
    this.player.body.setOffset(bodyW * br.offsetX, this.player.displayHeight * br.offsetY);

    this.player.setDepth(10);
    this.player.setData('facing', 'down');
    // 碰撞层已禁用，角色可自由行走
  }

  // ==================== NPC 交互按钮 ====================

  _createNPCActionButtons() {
    const btnW = 130;
    const btnH = 32;
    const gap = 10;
    const totalW = btnW * 2 + gap;

    // 半透明背景条
    const bg = this.add.graphics();
    bg.fillStyle(0x1a1820, 0.92);
    bg.fillRoundedRect(-totalW / 2 - 8, -btnH / 2 - 6, totalW + 16, btnH + 12, 6);
    bg.lineStyle(1, 0xc4a882, 0.5);
    bg.strokeRoundedRect(-totalW / 2 - 8, -btnH / 2 - 6, totalW + 16, btnH + 12, 6);
    this.npcActionContainer.add(bg);

    // 左按钮：「进行对话」
    const makeBtn = (label, offsetX, callback, color = '#d4b896') => {
      const btnGfx = this.add.graphics();
      const drawBtn = (hover) => {
        btnGfx.clear();
        btnGfx.fillStyle(hover ? 0x3a3830 : 0x2a2824, 1);
        btnGfx.fillRoundedRect(offsetX - btnW / 2, -btnH / 2, btnW, btnH, 4);
        btnGfx.lineStyle(1, hover ? 0xd4b896 : 0x887766, 0.6);
        btnGfx.strokeRoundedRect(offsetX - btnW / 2, -btnH / 2, btnW, btnH, 4);
      };
      drawBtn(false);

      const text = this.add.text(offsetX, 0, label, {
        fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
        fontSize: '13px', color,
      }).setOrigin(0.5);

      const zone = this.add.zone(offsetX, 0, btnW, btnH).setInteractive({ useHandCursor: true });
      zone.on('pointerover', () => drawBtn(true));
      zone.on('pointerout', () => drawBtn(false));
      zone.on('pointerdown', callback);

      this.npcActionContainer.add([btnGfx, text, zone]);
    };

    const leftX = -btnW / 2 - gap / 2;
    const rightX = btnW / 2 + gap / 2;

    makeBtn('💬 进行对话', leftX, () => {
      if (this.currentNearbyNPC) {
        this.triggerDialogue(this.currentNearbyNPC);
      }
    });

    makeBtn('🎁 展示物品', rightX, () => {
      if (this.currentNearbyNPC) {
        const npcId = this.currentNearbyNPC.getData('npcId');
        const npcName = this.currentNearbyNPC.getData('name');
        this.events.emit('show-item:select', { npcId, npcName });
      }
    }, '#c0b898');
  }

  _showNPCActionButtons(npc) {
    this.npcActionContainer.setVisible(true);
    this._updateNPCActionPosition(npc);
  }

  _updateNPCActionPosition(npc) {
    // 将世界坐标转换为屏幕坐标（scrollFactor=0 的容器用屏幕坐标）
    const cam = this.cameras.main;
    const relX = npc.x - cam.scrollX;
    const relY = npc.y - cam.scrollY - 52 * MAP_SCALE;
    this.npcActionContainer.setPosition(relX, relY);
  }

  _hideNPCActionButtons() {
    this.npcActionContainer.setVisible(false);
  }

  // ==================== NPC ====================

  createNPCs() {
    // 尝试从 localStorage 加载编辑器保存的 NPC 位置
    let savedNPCPositions = null;
    try {
      const saved = localStorage.getItem('editor_npc_positions');
      if (saved) savedNPCPositions = JSON.parse(saved);
    } catch (e) { /* 忽略 */ }

    const defaultNPCs = [
      { id: 'npc_chen', name: '陈师傅', col: 38, row: 14, greeting: '……（低头擦琴，仿佛没看见你）' },
      { id: 'npc_xiaohua', name: '小华', col: 15, row: 12, greeting: '你也是来看戏班笑话的吗？' },
      { id: 'npc_laozhou', name: '老周', col: 10, row: 8, greeting: '……' },
      { id: 'npc_meiyi', name: '梅姨', col: 40, row: 16, greeting: '哎呀，来客人了！快坐快坐，喝点什么？' },
      { id: 'npc_laoli', name: '老李', col: 60, row: 22, greeting: '过河啊？等着，马上开船。' },
    ];

    defaultNPCs.forEach((def) => {
      // 使用保存的位置或默认位置
      const pos = savedNPCPositions && savedNPCPositions[def.id]
        ? savedNPCPositions[def.id]
        : { col: def.col, row: def.row };

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
      sprite.setData('spriteCfg', cfg || null);  // 保存配置供后续切换纹理
      sprite.setImmovable(true);
      sprite.body.pushable = false;
      sprite.setDepth(5);

      // 气泡（江南风半透明深色背景）
      const bubbleText = this.add.text(sprite.x, sprite.y - 20 * MAP_SCALE, def.greeting, {
        fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
        fontSize: '16px',
        color: '#e8dcc8',
        backgroundColor: '#2a2824dd',
        padding: { x: 8, y: 4 },
        wordWrap: { width: 170 },
        align: 'center',
        lineSpacing: 4,
      }).setOrigin(0.5).setDepth(101);

      this.npcs.push(sprite);
      this.npcBubbles.push(bubbleText);
    });

    this.currentNearbyNPC = null;
    this.physics.add.overlap(this.player, this.npcs, (_player, npc) => {
      this.currentNearbyNPC = npc;
    });
  }

  // ==================== 更新循环 ====================

  /**
   * 切换主角朝向纹理（single模式：每方向独立图片）
   * setTexture()会重置physics body，必须立即重建
   */
  switchPlayerTexture(facing, isMoving) {
    const p = PROTAGONIST;
    const animType = isMoving ? 'walk' : 'idle';
    const texKey = `${p.prefix}_${animType}_${facing}`;

    // 仅在纹理实际变化时切换（避免每帧都触发 setTexture）
    if (this.player.texture.key === texKey) return;

    this.player.setTexture(texKey);

    // 重建 body（setTexture 重置为默认值）
    const br = p.bodyRatio;
    const bodyW = Math.floor(this.player.displayWidth * br.w);
    const bodyH = Math.floor(this.player.displayHeight * br.h);
    this.player.body.setSize(bodyW, bodyH);
    this.player.body.setOffset(bodyW * br.offsetX, this.player.displayHeight * br.offsetY);
  }

  update() {
    // ★ R 键硬重置 — 永远可用（在 try 外面，防止被错误吞掉）
    if (this.editKeys && Phaser.Input.Keyboard.JustDown(this.editKeys.R)) {
      this._hardReset();
      return;
    }

    try {
      this._updateInner();
    } catch (e) {
      // 防止 JS 错误导致整个游戏卡死 + 在屏幕上显示错误
      if (!this._errLogged) {
        this._errLogged = true;
        console.error('[GameScene] update 崩溃:', e);
        // 在屏幕上显示红色错误信息
        const { width } = this.cameras.main;
        const errMsg = this.add.text(width / 2, 120,
          `⚠️ 游戏出错: ${e.message}\n按 [R] 重置  |  按 F12 查看控制台`, {
          fontSize: '18px', color: '#ff6666', backgroundColor: '#330000dd',
          padding: { x: 16, y: 10 }, align: 'center',
        }).setOrigin(0.5).setDepth(9999).setScrollFactor(0);
        this._errorMsg = errMsg;
      }
    }
  }

  _updateInner() {
    if (!this.player || !this.cursors) {
      // 调试：如果 player 或 cursors 为空，在控制台打印原因
      if (!this._initDebug) {
        this._initDebug = true;
        console.warn('[GameScene] player或cursors为空!', {
          hasPlayer: !!this.player,
          hasCursors: !!this.cursors,
          hasWasd: !!this.wasd,
        });
      }
      return;
    }

    // ========== 编辑器快捷键 ==========
    if (Phaser.Input.Keyboard.JustDown(this.editKeys.E)) {
      this._toggleEditMode();
      return;
    }
    // R: 硬重置（清除所有缓存 + 重启游戏）
    if (Phaser.Input.Keyboard.JustDown(this.editKeys.R)) {
      this._hardReset();
      return;
    }
    // S/C 保存/清除在任何模式下都可用
    if (Phaser.Input.Keyboard.JustDown(this.editKeys.C)) {
      this._clearAllCollisions();
      console.log('[Game] 已强制清除所有碰撞 (按C触发)');
    }
    if (Phaser.Input.Keyboard.JustDown(this.editKeys.S) && this._editMode) {
      this._saveCollisionConfig();
    }
    if (this._editMode) {
      // 编辑模式下：WASD 自由滚动摄像机（不移动角色）
      this.player.setVelocity(0, 0);
      this._updateEditorCamera();
      return;
    }

    if (!this.inputLocked) {
      const speed = GAME.PLAYER_SPEED;

      // ---- 第1步：计算目标速度 ----
      let targetVX = 0, targetVY = 0;
      if (this.wasd.A.isDown || this.cursors.left.isDown) targetVX = -speed;
      else if (this.wasd.D.isDown || this.cursors.right.isDown) targetVX = speed;

      if (this.wasd.W.isDown || this.cursors.up.isDown) targetVY = -speed;
      else if (this.wasd.S.isDown || this.cursors.down.isDown) targetVY = speed;

      // 斜向归一化
      if (targetVX !== 0 && targetVY !== 0) { targetVX *= 0.707; targetVY *= 0.707; }

      // ---- 第2步：确定朝向 + 切换纹理 ----
      let facing = this.player.getData('facing') || 'down';
      if (targetVX !== 0 || targetVY !== 0) {
        if (Math.abs(targetVX) > Math.abs(targetVY)) {
          facing = targetVX > 0 ? 'right' : 'left';
        } else {
          facing = targetVY > 0 ? 'down' : 'up';
        }
      }
      this.switchPlayerTexture(facing, targetVX !== 0 || targetVY !== 0);
      this.player.setData('facing', facing);

      // ---- 第3步：碰撞检测 + 设置速度 ----
      // 用固定小距离预判前方是否有碰撞格（避免被卡住）
      const checkDist = 8;  // 向前探测的距离(px)
      let finalVX = targetVX, finalVY = targetVY;

      if (targetVX !== 0) {
        const dirX = targetVX > 0 ? checkDist : -checkDist;
        if (this._checkCollisionAt(this.player.x + dirX, this.player.y)) {
          finalVX = 0;
        }
      }
      if (targetVY !== 0) {
        const dirY = targetVY > 0 ? checkDist : -checkDist;
        if (this._checkCollisionAt(this.player.x, this.player.y + dirY)) {
          finalVY = 0;
        }
      }

      this.player.setVelocity(finalVX, finalVY);

    } else {
      this.player.setVelocity(0, 0);
      // 锁定时也切到idle朝向
      this.switchPlayerTexture(this.player.getData('facing') || 'down', false);
    }

    // ===== 主要 NPC 气泡跟随 + 接近检测 =====
    this.currentNearbyNPC = null;
    for (let i = 0; i < this.npcs.length; i++) {
      const npc = this.npcs[i];
      const bubble = this.npcBubbles[i];
      if (bubble) bubble.setPosition(npc.x, npc.y - 22);

      const dist = Phaser.Math.Distance.Between(
        this.player.x, this.player.y, npc.x, npc.y
      );
      if (dist < 64) {
        this.currentNearbyNPC = npc;
      }
    }

    // ===== 普通 NPC（town-npcs）气泡跟随 + 接近检测 =====
    for (let i = 0; i < this.townNpcs.length; i++) {
      const npc = this.townNpcs[i];
      const bubble = this.townNpcBubbles[i];
      if (bubble) bubble.setPosition(npc.x, npc.y - 18 * MAP_SCALE);

      const dist = Phaser.Math.Distance.Between(
        this.player.x, this.player.y, npc.x, npc.y
      );
      if (dist < 64) {
        this.currentNearbyNPC = npc;
      }
    }

    // ===== NPC 交互按钮（简单可靠：有NPC就显示，没有就隐藏）=====
    if (this.currentNearbyNPC && !this.inputLocked) {
      this.interactHint.setVisible(false);
      // setVisible(true) 在已显示时是空操作，不会导致 zone 点击丢失
      if (!this.npcActionContainer.visible) {
        this.npcActionContainer.setVisible(true);
      }
      // 每帧更新位置（轻量，且支持漫游中的 town-npc）
      this._updateNPCActionPosition(this.currentNearbyNPC);
    } else {
      if (this.npcActionContainer.visible) {
        this._hideNPCActionButtons();
      }
    }

    // 物品接近检测（NPC 优先，NPC 范围内不显示物品提示）
    this.currentNearbyItem = null;
    if (!this.currentNearbyNPC) {
      for (let i = 0; i < this.sceneItems.length; i++) {
        const item = this.sceneItems[i];
        const dist = Phaser.Math.Distance.Between(
          this.player.x, this.player.y, item.x, item.y
        );
        if (dist < 48) {
          this.currentNearbyItem = item;
          this.interactHint.setText(`按 [F] 拾取 ${item.getData('name')}`);
          this.interactHint.setPosition(item.x, item.y - 30);
          this.interactHint.setVisible(true);
          break;
        }
      }
    }

    // F 键交互（仅物品拾取；NPC 用按钮交互）
    if (!this.inputLocked && Phaser.Input.Keyboard.JustDown(this.wasd.F)) {
      if (this.currentNearbyItem) {
        this.pickupItem(this.currentNearbyItem);
      }
    }

    // ★ 完全手动摄像机跟随 + 边界（不用 startFollow，避免内部限制）
    this._updateCameraOnly();

    // ★ 更新普通NPC的漫游行为
    const dt = this.game.loop.delta || 16.667;
    this._updateTownNPCs(dt);
  }

  /** 仅更新相机跟随（编辑模式和游戏模式共用） */
  _updateCameraOnly() {
    if (this._mapBounds) {
      const cam = this.cameras.main;
      const { w: mapW, h: mapH } = this._mapBounds;

      // [DEBUG] 每隔几帧打印一次
      if (!this._camDebugCount) this._camDebugCount = 0;
      this._camDebugCount++;
      if (this._camDebugCount % 300 === 1) {
        console.log('[GameScene] Camera debug:', {
          playerPos: { x: Math.round(this.player.x), y: Math.round(this.player.y) },
          scroll: { x: Math.round(cam.scrollX), y: Math.round(cam.scrollY) },
          camSize: { w: cam.width, h: cam.height },
          mapBounds: { mapW, mapH },
          maxScroll: { maxX: mapW - cam.width, maxY: mapH - cam.height },
          mapImageDisplaySize: this.mapImage ? {
            w: this.mapImage.displayWidth,
            h: this.mapImage.displayHeight,
          } : null,
        });
      }

      // 目标：角色在屏幕中心
      const targetX = this.player.x - cam.width / 2;
      const targetY = this.player.y - cam.height / 2;
      // 平滑插值
      cam.scrollX += (targetX - cam.scrollX) * 0.08;
      cam.scrollY += (targetY - cam.scrollY) * 0.08;
      // clamp 到地图范围（超出时角色自然偏离中心）
      cam.scrollX = Phaser.Math.Clamp(cam.scrollX, 0, Math.max(0, mapW - cam.width));
      cam.scrollY = Phaser.Math.Clamp(cam.scrollY, 0, Math.max(0, mapH - cam.height));
    }
  }

  /**
   * 编辑模式下的自由摄像机滚动（WASD/方向键移动视角，不移动角色）
   */
  _updateEditorCamera() {
    if (!this._mapBounds) return;
    const cam = this.cameras.main;
    const { w: mapW, h: mapH } = this._mapBounds;

    // 滚动速度
    const scrollSpeed = 10;

    let dx = 0, dy = 0;
    if (this.wasd.A.isDown || this.cursors.left.isDown) dx = -scrollSpeed;
    else if (this.wasd.D.isDown || this.cursors.right.isDown) dx = scrollSpeed;

    if (this.wasd.W.isDown || this.cursors.up.isDown) dy = -scrollSpeed;
    else if (this.wasd.S.isDown || this.cursors.down.isDown) dy = scrollSpeed;

    cam.scrollX += dx;
    cam.scrollY += dy;
    // clamp 到地图范围
    cam.scrollX = Phaser.Math.Clamp(cam.scrollX, 0, Math.max(0, mapW - cam.width));
    cam.scrollY = Phaser.Math.Clamp(cam.scrollY, 0, Math.max(0, mapH - cam.height));
  }

  triggerDialogue(npc) {
    const tilePos = COORD.toTile(npc.x, npc.y);
    console.log(`[交互] 触发与 ${npc.getData('name')} (${npc.getData('npcId')}) 的对话, tile=(${tilePos.col},${tilePos.row})`);
    this.events.emit('dialogue:start', {
      npcId: npc.getData('npcId'),
      name: npc.getData('name'),
      position: { col: tilePos.col, row: tilePos.row },
    });
  }

  /**
   * 拾取场景物品（调用后端 discover API + 即时视觉反馈 + Toast 动画 + 刷新背包）
   */
  async pickupItem(itemSprite) {
    const itemId = itemSprite.getData('itemId');
    const itemName = itemSprite.getData('name');
    const sessionId = localStorage.getItem('__active_session__');
    if (!sessionId) return;

    // ★ 立即从场景列表移除（避免重复检测）
    const idx = this.sceneItems.indexOf(itemSprite);
    if (idx >= 0) this.sceneItems.splice(idx, 1);
    this.currentNearbyItem = null;
    this.interactHint.setVisible(false);

    // ★ 仅锁定 400ms（动画时长），API 调用不阻塞移动
    this.events.emit('input:lock', true);

    this.tweens.add({
      targets: itemSprite,
      alpha: 0,
      y: itemSprite.y - 30 * MAP_SCALE,
      scaleX: 1.5,
      scaleY: 1.5,
      duration: 400,
      onComplete: () => {
        itemSprite.destroy();
        this.events.emit('input:lock', false); // ★ 动画结束立即恢复移动
      },
    });

    // API 调用后台进行，不阻塞
    try {
      const { discoverItem } = await import('../api/client.js');
      const result = await discoverItem(sessionId, itemId);

      if (result.already_discovered) {
        this.showToast(`${itemName} 已在行囊中`);
      } else {
        this.showToast(`获得: ${itemName}`, 2500);
        this.events.emit('item:discovered', result.item);
      }
    } catch (e) {
      console.error('[GameScene] 拾取物品失败:', e);
      this.showToast('拾取失败', 1500);
    }
  }

  // ==================== 工具方法 ====================

  /**
   * 显示加载提示
   */
  showLoadingHint(text) {
    if (!this.loadingHint) {
      const { width, height } = this.cameras.main;
      this.loadingHint = this.add.text(width / 2, height / 2, '', {
        fontFamily: '"KaiTi","SimSun",serif',
        fontSize: '26px', color: '#d4b896',
        backgroundColor: '#0a0a12cc',
        padding: { x: 24, y: 16 },
        borderRadius: 8,
      }).setOrigin(0.5).setDepth(500);
    }
    this.loadingHint.setText(text);
    this.loadingHint.setVisible(true);
  }

  /**
   * 隐藏加载提示
   */
  hideLoadingHint() {
    if (this.loadingHint) {
      this.loadingHint.setVisible(false);
    }
  }

  /**
   * 显示短暂提示 Toast
   */
  showToast(message, duration = 2000) {
    const { width } = this.cameras.main;
    const toast = this.add.text(width / 2, 30, message, {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
      fontSize: '18px', color: '#ffaa66',
      backgroundColor: '#1a1010ee',
      padding: { x: 14, y: 8 },
      borderRadius: 5,
    }).setOrigin(0.5, 0).setDepth(600).setAlpha(0);

    this.tweens.add({
      targets: toast, alpha: 1, duration: 300,
      onComplete: () => {
        this.time.delayedCall(duration, () => {
          this.tweens.add({
            targets: toast, alpha: 0, duration: 400,
            onComplete: () => toast.destroy(),
          });
        });
      },
    });
  }
}
