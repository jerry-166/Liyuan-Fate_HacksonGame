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

export class GameScene extends Phaser.Scene {
  constructor() {
    super({ key: 'GameScene' });
  }

  init(data) {
    // 可靠接收 MenuScene 传来的存档 ID
    this._savedSessionId = data?.savedSessionId || null;
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
    this.inputLocked = false;
    this.currentStage = 1;
    this.currentNearbyItem = null;

    this.drawTileMap();
    this.createCollisionLayer();
    this.createPlayer();
    this.createNPCs();

    // 摄像机跟随
    this.cameras.main.startFollow(this.player, true, 0.08, 0.08);
    this.cameras.main.setBounds(0, 0, MAP_COLS * TILE, MAP_ROWS * TILE);

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
      fontSize: '13px',
      color: '#d4c4a0',
      backgroundColor: '#2a2824ee',
      padding: { x: 10, y: 5 },
      border: 1,
      borderRadius: 4,
    }).setOrigin(0.5).setDepth(100).setVisible(false);

    // NPC 交互按钮（靠近 NPC 时显示）
    this.npcActionContainer = this.add.container(0, 0).setDepth(102).setVisible(false);
    this._createNPCActionButtons();

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

  /**
   * 创建一个场景物品精灵
   */
  createSceneItemSprite(itemData, col, row) {
    const pos = COORD.toPixel(col, row);
    // 使用 emoji 文字作为物品图标
    const emoji = '📦';
    const sprite = this.add.text(pos.x, pos.y, emoji, {
      fontSize: '20px',
    }).setOrigin(0.5).setDepth(90);

    sprite.setData('itemId', itemData.item_id);
    sprite.setData('name', itemData.name);

    // 小幅上下浮动动画
    this.tweens.add({
      targets: sprite,
      y: pos.y - 4,
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
        const bubbleText = this.add.text(sprite.x, sprite.y - 20, stateNpc.current_greeting || '', {
          fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
          fontSize: '12px', color: '#e8dcc8',
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
   * 动态创建单个 NPC 精灵
   */
  createNPCSprite(npcId, name, stateNpc) {
    const npcConfigs = {
      'npc_chen': { color: 0xb8a078, hair: 0xc8c8d0 },
      'npc_xiaohua': { color: 0x7888a0, hair: 0x2a2420 },
      'npc_laozhou': { color: 0x9a8a7a, hair: 0xb0b0b8 },
      'npc_meiyi': { color: 0xaa8878, hair: 0x3a2820 },
      'npc_laoli': { color: 0x8a7a68, hair: 0x555550 },
    };
    const cfg = npcConfigs[npcId] || { color: 0x888888, hair: 0x444444 };
    const nw = 14, nh = 28;
    const gfx = this.make.graphics({ add: false });

    // 身体
    gfx.fillStyle(cfg.color);
    gfx.fillRect(1, 10, nw - 2, nh - 11);
    gfx.fillStyle(Phaser.Display.Color.ValueToColor(cfg.color).darken(10).color);
    gfx.fillRect(2, nh - 5, nw - 4, 4);
    // 裤子
    gfx.fillStyle(0x333338);
    gfx.fillRect(2, nh - 6, nw - 4, 6);
    // 脸
    gfx.fillStyle(0xf0d8b8);
    gfx.fillRect(2, 1, nw - 4, 9);
    // 头发
    gfx.fillStyle(cfg.hair);
    gfx.fillRect(2, 1, nw - 4, 4);
    // 眼睛
    gfx.fillStyle(0x333340);
    gfx.fillRect(4, 5, 2, 2);
    gfx.fillRect(nw - 6, 5, 2, 2);
    // 鞋子
    gfx.fillStyle(0x5a4a38);
    gfx.fillRect(2, nh - 2, 3, 2);
    gfx.fillRect(nw - 5, nh - 2, 3, 2);
    // 黑边
    gfx.lineStyle(1, 0x111111, 0.8);
    gfx.strokeRect(1, 1, nw - 2, nh - 2);

    const key = `__npc_${npcId}__`;
    gfx.generateTexture(key, nw, nh);

    // 使用 API 返回的瓦片坐标或默认位置
    const defaultPos = npcId === 'npc_chen' ? { col: 43, row: 16 } : { col: 11, row: 10 };
    const col = stateNpc.position ? stateNpc.position.col : defaultPos.col;
    const row = stateNpc.position ? stateNpc.position.row : defaultPos.row;
    const { x: posX, y: posY } = COORD.toPixel(col || defaultPos.col, row || defaultPos.row);

    const sprite = this.physics.add.sprite(posX, posY, key);
    sprite.setData('npcId', npcId);
    sprite.setData('name', name);
    sprite.setData('greeting', stateNpc.current_greeting || '');
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
    const gfx = this.add.graphics();
    gfx.setDepth(0);

    for (let r = 0; r < MAP_ROWS; r++) {
      for (let c = 0; c < MAP_COLS; c++) {
        const type = this.mapData[r][c];
        const colors = PALETTE[type];
        if (!colors) continue;

        const x = c * TILE;
        const y = r * TILE;
        const isDark = (r + c) % 2 === 1;
        const color = isDark ? colors.dark : colors.base;

        // ---- 基础填充 ----
        gfx.fillStyle(color);
        gfx.fillRect(x, y, TILE, TILE);

        // ---- 1px 黑边（design.md 要求） ----
        gfx.lineStyle(1, BLACK_EDGE, 0.45);
        gfx.strokeRect(x, y, TILE, TILE);

        // ---- 各类型纹理细节 ----

        // 草地：淡青+竹绿，随机小花点缀
        if (type === T.GRASS) {
          // 高光格子加亮
          if (!isDark) {
            gfx.fillStyle(colors.highlight, 0.3);
            // 小草点
            if ((r * 7 + c * 13) % 5 === 0) {
              gfx.fillRect(x + 3, y + 5, 2, 2);
              gfx.fillRect(x + 9, y + 10, 2, 1);
            }
          }
          // 零星小花（粉色/白色小点）
          if ((r * 17 + c * 23) % 19 === 0) {
            gfx.fillStyle(0xeeddee, 0.6);
            gfx.fillCircle(x + 5, y + 5, 1);
          }
        }

        // 青石板路：浅灰+深灰缝+青苔点
        if (type === T.ROAD) {
          // 石板缝隙
          gfx.lineStyle(1, 0x888878, 0.3);
          if (isDark) {
            gfx.moveTo(x, y); gfx.lineTo(x + TILE, y + TILE);
            gfx.strokePath();
          } else {
            gfx.moveTo(x + TILE, y); gfx.lineTo(x, y + TILE);
            gfx.strokePath();
          }
          // 随机青苔点
          if ((r * 3 + c * 7) % 11 === 0) {
            gfx.fillStyle(0x6a8a6a, 0.4);
            gfx.fillCircle(x + 6, y + 8, 1.5);
          }
        }

        // 土路：浅棕+小石子
        if (type === T.DIRT) {
          // 石子纹理
          if ((r + c) % 3 === 0) {
            gfx.fillStyle(0xaa9977, 0.3);
            gfx.fillRect(x + 4 + (c % 4), y + 6 + (r % 4), 2, 1);
            gfx.fillRect(x + 8 + (r % 3), y + 3 + (c % 5), 1, 2);
          }
        }

        // 河水：淡蓝+波纹白高光
        if (type === T.WATER) {
          // 波纹高光线
          gfx.fillStyle(0xffffff, isDark ? 0.15 : 0.25);
          const waveOffset = (r * 3 + c * 5) % 5;
          gfx.fillRect(x + 2 + waveOffset, y + 5, 4, 1);
          gfx.fillRect(x + 8 - waveOffset, y + 11, 5, 1);
          // 水面反光
          if (!isDark && (r * 7 + c * 11) % 9 === 0) {
            gfx.fillStyle(0xaaccff, 0.2);
            gfx.fillRect(x + 3, y + 3, 3, 2);
          }
        }

        // 石桥：青灰色+拱桥纹理
        if (type === T.BRIDGE) {
          // 桥面横纹
          gfx.lineStyle(1, 0x7a867c, 0.4);
          gfx.beginPath();
          gfx.moveTo(x + 1, y + 4);
          gfx.lineTo(x + TILE -1, y + 4);
          gfx.moveTo(x + 1, y + TILE -4);
          gfx.lineTo(x + TILE-1, y + TILE-4);
          gfx.strokePath();
          // 拱形暗示
          gfx.fillStyle(0xaebab0, 0.3);
          gfx.fillRect(x + 2, y + 2, TILE-4, 2);
        }

        // 戏台：暖红+木棕+金黄（核心地标，最醒目）
        if (type === T.STAGE) {
          // 屋顶暗示（飞檐翘角）
          if ((r + c) % 4 === 0) {
            gfx.fillStyle(0xdd7744, 0.5);  // 朱红色屋顶
            gfx.fillRect(x + 1, y + 1, TILE-2, 4);
            // 翘角
            gfx.fillStyle(0xcc6633, 0.4);
            gfx.fillRect(x, y + 1, 2, 2);
            gfx.fillRect(x + TILE-2, y + 1, 2, 2);
          }
          // 戏曲灯笼点缀（红色小圆）
          if ((r * 5 + c * 9) % 17 === 0 && !isDark) {
            gfx.fillStyle(0xee5533, 0.7);
            gfx.fillCircle(x + TILE/2, y + 6, 2);
          }
          // 雕花暗示
          if (isDark) {
            gfx.fillStyle(0xaa7744, 0.2);
            gfx.fillRect(x + 4, y + 7, 8, 2);
          }
        }

        // 茶馆：米黄+茶褐+竹绿
        if (type === T.TEA) {
          // 木窗格
          if ((r + c) % 3 === 0) {
            gfx.lineStyle(1, 0x8a7a5a, 0.3);
            gfx.strokeRect(x + 3, y + 3, TILE - 6, TILE - 6);
          }
          // 茶旗暗示
          if ((r * 7 + c * 3) % 13 === 0) {
            gfx.fillStyle(0x886644, 0.4);
            gfx.fillRect(x + 10, y + 1, 3, 5);
          }
          // 竹桌椅暗示
          if (isDark && (r + c) % 5 === 0) {
            gfx.fillStyle(0x7a9a6a, 0.25);
            gfx.fillRect(x + 4, y + 8, 6, 4);
          }
        }

        // 码头：水蓝+青灰+雾白
        if (type === T.DOCK) {
          // 木桩暗示
          if ((c) % 4 === 0) {
            gfx.fillStyle(0x7a6a54, 0.5);
            gfx.fillRect(x + 2, y + TILE - 5, 3, 5);
          }
          // 雾气感（半透明白）
          if (!isDark) {
            gfx.fillStyle(0xddeeff, 0.08);
            gfx.fillRect(x, y, TILE, TILE);
          }
          // 石阶
          if ((r) % 3 === 0) {
            gfx.lineStyle(1, 0x8a9a94, 0.3);
            gfx.beginPath();
            gfx.moveTo(x, y + TILE - 2);
            gfx.lineTo(x + TILE, y + TILE - 2);
            gfx.strokePath();
          }
        }

        // 祠堂：淡灰+米白（庄重）
        if (type === T.TEMPLE) {
          // 对称结构暗示
          if (isDark) {
            gfx.fillStyle(0xaca8a0, 0.2);
            gfx.fillRect(x + TILE/2 - 2, y + 2, 4, TILE - 4);
          }
          // 门匾
          if ((r + c) % 6 === 0) {
            gfx.fillStyle(0x6a5a42, 0.4);
            gfx.fillRect(x + 4, y + 4, TILE - 8, 3);
          }
        }

        // 民居：淡灰+浅绿（日常烟火）
        if (type === T.HOUSE) {
          // 白墙暗示（高光块）
          if (!isDark) {
            gfx.fillStyle(0xe8e4dc, 0.15);
            gfx.fillRect(x + 2, y + 2, TILE-4, TILE-5);
          }
          // 黛瓦屋顶
          if ((r + c) % 4 === 0) {
            gfx.fillStyle(0x555560, 0.3);
            gfx.fillRect(x + 1, y + 1, TILE-2, 3);
          }
          // 晾衣绳/竹篮等生活气息
          if ((r * 11 + c * 7) % 21 === 0) {
            gfx.fillStyle(0x998877, 0.25);
            gfx.fillRect(x + 3, y + TILE - 4, 8, 1);
          }
        }

        // 树木：竹丛/垂柳（多层绿色圆形叠加）
        if (type === T.TREE) {
          const cx = x + TILE / 2;
          const cy = y + TILE / 2;
          // 外层暗绿（树冠底）
          gfx.fillStyle(colors.dark);
          gfx.fillCircle(cx, cy + 1, TILE / 2 - 1);
          // 中层主色
          gfx.fillStyle(color);
          gfx.fillCircle(cx - 1, cy - 1, TILE / 2 - 2);
          // 内层亮绿（高光）
          gfx.fillStyle(colors.highlight);
          gfx.fillCircle(cx - 1, cy - 2, TILE / 2 - 4);
          // 树干
          gfx.fillStyle(0x6a5844, 0.8);
          gfx.fillRect(cx - 1, cy + 2, 3, 4);
        }
      }
    }

    // 地图外框粗边框（画幅感）
    gfx.lineStyle(2, BLACK_EDGE, 0.6);
    gfx.strokeRect(0, 0, MAP_COLS * TILE, MAP_ROWS * TILE);
  }

  createCollisionLayer() {
    this.collisionZones = [];
    const collideTypes = [T.WATER, T.STAGE, T.TEA, T.DOCK, T.TEMPLE, T.HOUSE, T.TREE];

    for (let r = 0; r < MAP_ROWS; r++) {
      for (let c = 0; c < MAP_COLS; c++) {
        if (collideTypes.includes(this.mapData[r][c])) {
          const zone = this.add.zone(
            c * TILE + TILE / 2,
            r * TILE + TILE / 2,
            TILE,
            TILE
          );
          this.physics.add.existing(zone, true);
          this.collisionZones.push(zone);
        }
      }
    }
  }

  // ==================== 玩家（16×32 Q 版风格占位）====================

  createPlayer() {
    const { x: startX, y: startY } = COORD.toPixel(44, 28);

    // 按 design.md：16×32 px，Q版，头身比 1:2，棉麻衫（米白/浅蓝）
    const pw = 14; // 接近16的视觉宽度
    const ph = 28;  // 接近32的视觉高度
    const playerGfx = this.make.graphics({ add: false });

    // 身体（棉麻衫 米白）
    playerGfx.fillStyle(0xe8dcc8);
    playerGfx.fillRect(1, 10, pw - 2, ph - 11);
    // 衣服下摆
    playerGfx.fillStyle(0xdcccb8);
    playerGfx.fillRect(2, ph - 5, pw - 4, 4);
    // 裤子（黑色）
    playerGfx.fillStyle(0x333338);
    playerGfx.fillRect(2, ph - 6, pw - 4, 6);
    // 头（肤色）
    playerGfx.fillStyle(0xf0d8b8);
    playerGfx.fillRect(2, 1, pw - 4, 9);
    // 发型（短发 黑色）
    playerGfx.fillStyle(0x2a2420);
    playerGfx.fillRect(2, 1, pw - 4, 4);
    // 眼睛暗示
    playerGfx.fillStyle(0x333340);
    playerGfx.fillRect(4, 5, 2, 2);
    playerGfx.fillRect(pw - 6, 5, 2, 2);
    // 鞋子（布鞋 深褐）
    playerGfx.fillStyle(0x5a4a38);
    playerGfx.fillRect(2, ph - 2, 3, 2);
    playerGfx.fillRect(pw - 5, ph - 2, 3, 2);

    // 1px 黑边轮廓
    playerGfx.lineStyle(1, 0x111111, 0.8);
    playerGfx.strokeRect(1, 1, pw - 2, ph - 2);

    const textureKey = '__player_sprite__';
    playerGfx.generateTexture(textureKey, pw, ph);

    this.player = this.physics.add.sprite(startX, startY, textureKey);
    this.player.setCollideWorldBounds(true);
    this.player.body.setSize(pw - 4, ph - 4);
    this.player.setOffset(2, 2);
    this.player.setDepth(10);

    this.physics.add.collider(this.player, this.collisionZones);
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
    this.npcActionContainer.setPosition(npc.x, npc.y - 52);
    this.npcActionContainer.setVisible(true);
  }

  _hideNPCActionButtons() {
    this.npcActionContainer.setVisible(false);
  }

  // ==================== NPC ====================

  createNPCs() {
    const npcData = [
      { id: 'npc_chen', name: '陈师傅', ...COORD.toPixel(43, 16), greeting: '……（低头擦琴，仿佛没看见你）' },
      { id: 'npc_xiaohua', name: '小华', ...COORD.toPixel(11, 10), greeting: '你也是来看戏班笑话的吗？' },
    ];

    npcData.forEach((npc) => {
      // NPC 精灵（同样 Q 版 14×28 占位）
      const nw = 14;
      const nh = 28;
      const gfx = this.make.graphics({ add: false });

      // 陈师傅：长衫（茶褐色），白发老头
      if (npc.id === 'npc_chen') {
        gfx.fillStyle(0xb8a078);  // 茶褐长衫
        gfx.fillRect(1, 10, nw - 2, nh - 11);
        gfx.fillStyle(0xa89068);  // 下摆
        gfx.fillRect(2, nh - 5, nw - 4, 4);
        gfx.fillStyle(0x333338);  // 裤
        gfx.fillRect(2, nh - 6, nw - 4, 6);
        gfx.fillStyle(0xf0d8b8);  // 脸
        gfx.fillRect(2, 1, nw - 4, 9);
        gfx.fillStyle(0xc8c8d0);  // 白发
        gfx.fillRect(2, 1, nw - 4, 4);
      } else {
        // 小华：短衫（蓝色系），青年
        gfx.fillStyle(0x7888a0);  // 蓝色短衫
        gfx.fillRect(1, 10, nw - 2, nh - 11);
        gfx.fillStyle(0x687890);
        gfx.fillRect(2, nh - 5, nw - 4, 4);
        gfx.fillStyle(0x333338);
        gfx.fillRect(2, nh - 6, nw - 4, 6);
        gfx.fillStyle(0xf0d8b8);  // 脸
        gfx.fillRect(2, 1, nw - 4, 9);
        gfx.fillStyle(0x2a2420);  // 黑发
        gfx.fillRect(2, 1, nw - 4, 4);
      }

      // 眼睛
      gfx.fillStyle(0x333340);
      gfx.fillRect(4, 5, 2, 2);
      gfx.fillRect(nw - 6, 5, 2, 2);
      // 鞋子
      gfx.fillStyle(0x5a4a38);
      gfx.fillRect(2, nh - 2, 3, 2);
      gfx.fillRect(nw - 5, nh - 2, 3, 2);
      // 黑边
      gfx.lineStyle(1, 0x111111, 0.8);
      gfx.strokeRect(1, 1, nw - 2, nh - 2);

      const key = `__npc_${npc.id}__`;
      gfx.generateTexture(key, nw, nh);

      const sprite = this.physics.add.sprite(npc.x, npc.y, key);
      sprite.setData('npcId', npc.id);
      sprite.setData('name', npc.name);
      sprite.setData('greeting', npc.greeting);
      sprite.setImmovable(true);
      sprite.body.pushable = false;
      sprite.setDepth(5);

      // 气泡（江南风半透明深色背景）
      const bubbleText = this.add.text(sprite.x, sprite.y - 20, npc.greeting, {
        fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
        fontSize: '12px',
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

  update() {
    if (!this.player || !this.cursors) return;

    // 输入锁定（对话中禁止移动）
    if (!this.inputLocked) {
      const speed = GAME.PLAYER_SPEED;
      this.player.setVelocity(0);

      if (this.wasd.A.isDown || this.cursors.left.isDown) {
        this.player.setVelocityX(-speed);
      } else if (this.wasd.D.isDown || this.cursors.right.isDown) {
        this.player.setVelocityX(speed);
      }

      if (this.wasd.W.isDown || this.cursors.up.isDown) {
        this.player.setVelocityY(-speed);
      } else if (this.wasd.S.isDown || this.cursors.down.isDown) {
        this.player.setVelocityY(speed);
      }

      // 斜向归一化
      if (this.player.body.velocity.x !== 0 && this.player.body.velocity.y !== 0) {
        this.player.body.velocity.x *= 0.707;
        this.player.body.velocity.y *= 0.707;
      }
    } else {
      this.player.setVelocity(0);
    }

    // NPC 气泡跟随 + 接近检测 + 交互按钮
    this.currentNearbyNPC = null;
    for (let i = 0; i < this.npcs.length; i++) {
      const npc = this.npcs[i];
      const bubble = this.npcBubbles[i];

      bubble.setPosition(npc.x, npc.y - 22);

      const dist = Phaser.Math.Distance.Between(
        this.player.x, this.player.y, npc.x, npc.y
      );
      if (dist < 64) {
        this.currentNearbyNPC = npc;
      }
    }

    if (this.currentNearbyNPC) {
      this._hideNPCActionButtons(); // 先隐藏，下一帧定位后再显示
      this.interactHint.setVisible(false);
      // 在NPC上方显示交互按钮（延后一帧确保位置正确）
      if (!this.inputLocked) {
        this._showNPCActionButtons(this.currentNearbyNPC);
      } else {
        this._hideNPCActionButtons();
      }
    } else {
      this._hideNPCActionButtons();
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
   * 拾取场景物品（调用后端 discover API + Toast 动画 + 刷新背包）
   */
  async pickupItem(itemSprite) {
    const itemId = itemSprite.getData('itemId');
    const itemName = itemSprite.getData('name');
    const sessionId = localStorage.getItem('__active_session__');
    if (!sessionId) return;

    this.events.emit('input:lock', true);
    this.interactHint.setVisible(false);

    try {
      const { discoverItem } = await import('../api/client.js');
      const result = await discoverItem(sessionId, itemId);

      // 移除地图上的物品精灵
      const idx = this.sceneItems.indexOf(itemSprite);
      if (idx >= 0) this.sceneItems.splice(idx, 1);
      this.currentNearbyItem = null;

      // 淡出动画
      this.tweens.add({
        targets: itemSprite,
        alpha: 0, y: itemSprite.y - 30, scaleX: 1.5, scaleY: 1.5,
        duration: 400,
        onComplete: () => itemSprite.destroy(),
      });

      if (result.already_discovered) {
        this.showToast(`${itemName} 已在行囊中`);
      } else {
        // Toast 动画
        this.showToast(`获得: ${itemName}`, 2500);
        // 通知 UIScene 刷新背包
        this.events.emit('item:discovered', result.item);
      }
    } catch (e) {
      console.error('[GameScene] 拾取物品失败:', e);
      this.showToast('拾取失败', 1500);
    } finally {
      this.events.emit('input:lock', false);
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
        fontSize: '20px', color: '#d4b896',
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
      fontSize: '13px', color: '#ffaa66',
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
