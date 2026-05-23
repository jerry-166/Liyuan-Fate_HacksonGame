import Phaser from 'phaser';
import { GAME } from '../config.js';

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

  create() {
    this.mapData = generateMapData();
    this.cursors = null;
    this.player = null;
    this.npcs = [];
    this.npcBubbles = [];

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

    this.scene.launch('UIScene');
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
    const startX = 44 * TILE;
    const startY = 28 * TILE;

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

  // ==================== NPC ====================

  createNPCs() {
    const npcData = [
      { id: 'npc_chen', name: '陈师傅', x: 43 * TILE, y: 16 * TILE, greeting: '……（低头擦琴，仿佛没看见你）' },
      { id: 'npc_xiaohua', name: '小华', x: 11 * TILE, y: 10 * TILE, greeting: '你也是来看戏班笑话的吗？' },
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

    // NPC 气泡跟随 + 接近检测
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
        this.interactHint.setText(`按 [F] 与 ${npc.getData('name')} 对话`);
        this.interactHint.setPosition(npc.x, npc.y - 42);
        this.interactHint.setVisible(true);
      }
    }

    if (!this.currentNearbyNPC) {
      this.interactHint.setVisible(false);
    }

    // F 键交互
    if (Phaser.Input.Keyboard.JustDown(this.wasd.F)) {
      if (this.currentNearbyNPC) {
        this.triggerDialogue(this.currentNearbyNPC);
      }
    }
  }

  triggerDialogue(npc) {
    console.log(`[交互] 触发与 ${npc.getData('name')} (${npc.getData('npcId')}) 的对话`);
    this.events.emit('dialogue:start', {
      npcId: npc.getData('npcId'),
      name: npc.getData('name'),
      position: { x: npc.x, y: npc.y },
    });
  }
}
