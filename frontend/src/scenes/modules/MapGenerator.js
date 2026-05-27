/**
 * 地图数据生成器 —— 程序化生成江南水乡小镇布局
 * 每格 16px，地图 80×50 格 = 1280×800 px
 * 风格：16-bit 像素、星露谷式俯视、江南水乡、水墨淡雅
 * @module scenes/modules/MapGenerator
 */

export const MAP_COLS = 80;
export const MAP_ROWS = 50;

/** 地图放大倍数 */
export const MAP_SCALE = 1.8;

/** Tile 类型常量 */
export const TileType = {
  GRASS:  'grass',
  ROAD:   'road',
  DIRT:   'dirt',
  WATER:  'water',
  BRIDGE: 'bridge',
  STAGE:  'stage',
  TEA:    'tea',
  DOCK:   'dock',
  TEMPLE: 'temple',
  HOUSE:  'house',
  TREE:   'tree',
};

/**
 * 程序化生成小镇地图（按 design.md 布局）
 * @returns {string[][]} 二维数组，每格为 TileType 字符串
 */
export function generateMapData() {
  const T = TileType;
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
    for (let r = 23; r <= 27; r++) {
      map[r][48 + dc] = T.BRIDGE;
    }
  }

  // ====== 建筑布局 ======
  drawBuilding(map, 4, 4, 14, 11, T.STAGE);   // 戏台大院（核心地标，红色调）
  drawBuilding(map, 4, 17, 9, 7, T.STAGE);     // 后台化妆间
  drawBuilding(map, 36, 11, 11, 9, T.TEA);     // 茶馆（消息集散地）
  drawBuilding(map, 64, 21, 12, 7, T.DOCK);    // 码头（河运入口）
  drawBuilding(map, 30, 4, 10, 9, T.TEMPLE);   // 北部祠堂
  drawBuilding(map, 18, 36, 9, 9, T.HOUSE);    // 南部民居
  drawBuilding(map, 54, 38, 11, 9, T.HOUSE);
  drawBuilding(map, 14, 43, 9, 5, T.HOUSE);
  drawBuilding(map, 68, 35, 8, 8, T.HOUSE);

  // ====== 散落树木装饰 ======
  scatterTrees(map, 50);

  // ====== 土路分支 — 连接主街到各建筑 ======
  connectPaths(map, T);

  return map;
}

/**
 * 在地图上绘制矩形建筑区域
 * @param {string[][]} map - 地图数据
 * @param {number} col - 左上角列
 * @param {number} row - 左上角行
 * @param {number} w - 宽度(格)
 * @param {number} h - 高度(格)
 * @param {string} type - 建筑类型
 */
function drawBuilding(map, col, row, w, h, type) {
  for (let r = row; r < row + h && r < MAP_ROWS; r++) {
    for (let c = col; c < col + w && c < MAP_COLS; c++) {
      if (r >= 0 && c >= 0 && map[r][c] !== TileType.WATER && map[r][c] !== TileType.BRIDGE) {
        map[r][c] = type;
      }
    }
  }
}

/**
 * 随机散布树木
 * @param {string[][]} map
 * @param {number} count - 树木数量
 */
function scatterTrees(map, count) {
  let placed = 0;
  while (placed < count) {
    const r = Math.floor(Math.random() * (MAP_ROWS - 4)) + 2;
    const c = Math.floor(Math.random() * (MAP_COLS - 4)) + 2;
    if (map[r][c] === TileType.GRASS) {
      map[r][c] = TileType.TREE;
      placed++;
    }
  }
}

/**
 * 绘制土路连接各建筑的路径
 * @param {string[][]} map
 * @param {Object} T - TileType 对象
 */
function connectPaths(map, T) {
  // 到戏台的横路
  for (let c2 = 18; c2 <= 46; c2++) map[10][c2] = T.DIRT;
  for (let r = 10; r <= 15; r++) map[r][46] = T.DIRT;
  // 到茶馆的路
  for (let r = 16; r <= 20; r++) map[r][43] = T.DIRT;
  for (let c2 = 36; c2 <= 43; c2++) map[20][c2] = T.DIRT;
  // 到祠堂的路
  for (let r = 13; r <= 17; r++) map[r][40] = T.DIRT;
  for (let c2 = 40; c2 <= 47; c2++) map[13][c2] = T.DIRT;
  // 到码头的路
  for (let r = 28; r <= 34; r++) map[r][52] = T.DIRT;
  for (let c2 = 52; c2 <= 64; c2++) map[28][c2] = T.DIRT;
}
