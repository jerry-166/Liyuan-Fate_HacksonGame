/**
 * 游戏常量配置文件
 *
 * 集中管理所有游戏级别的常量：
 * - GAME: 画布尺寸、瓦片大小、玩家速度等基础参数
 * - COLORS: UI 配色方案（背景、文字、对话框）
 * - SCENES: 场景 key 常量（避免硬编码字符串）
 * - STAGE_TONES: 六章剧情色调映射
 * - CHAPTER_MAP: chapter_id → stage 编号转换
 * - COORD: 瓦片坐标 ↔ 像素坐标转换工具
 *
 * @module config
 */

/** 游戏基础参数 */
export const GAME = {
  WIDTH: 1280,
  HEIGHT: 800,
  TILE_SIZE: 16,
  PLAYER_SPEED: 200,
};

/** UI 配色常量 */
export const COLORS = {
  BG_DARK: 0x1a1a2e,
  TEXT_PRIMARY: '#c4a882',
  TEXT_SECONDARY: '#888888',
  DIALOG_BG: 0x1a1a2e,
  DIALOG_BORDER: 0xc4a882,
};

/** 场景 key 常量（避免字符串硬编码） */
export const SCENES = {
  BOOT: 'BootScene',
  MENU: 'MenuScene',
  GAME: 'GameScene',
  UI: 'UIScene',
};

/** 子场景 key 常量 */
export const SUBSCENE = {
  STAGE: 'stage',
  TEA_HOUSE: 'tea_house',
  DOCK: 'dock',
  ANCESTRAL_HALL: 'ancestral_hall',
  FATHERS_HOUSE: 'fathers_house',
  GRAVEYARD: 'graveyard',
};

/** 六章节色调映射（《梨园生死》剧情线） */
export const STAGE_TONES = {
  1: { name: '归乡',       tint: 0x8899aa, mood: 'melancholy', hex: '#8899aa' },
  2: { name: '闻声·异样',  tint: 0x8899bb, mood: 'cold',        hex: '#8899bb' },
  3: { name: '探寻·疑云',  tint: 0xbbaa88, mood: 'warm',        hex: '#bbaa88' },
  4: { name: '忆归·真相',  tint: 0xcc9977, mood: 'dramatic',    hex: '#cc9977' },
  5: { name: '目睹·凋零',  tint: 0x998877, mood: 'somber',      hex: '#998877' },
  6: { name: '承戏·重振',  tint: 0xcc8866, mood: 'dramatic',    hex: '#cc8866' },
};

/** 章节过渡背景图映射（stageId → 图片路径） */
export const CHAPTER_IMAGES = {
  1: 'assets/images/transitions/ch0_prologue.png',
  2: 'assets/images/transitions/ch1_sound.png',
  3: 'assets/images/transitions/ch2_explore.png',
  4: 'assets/images/transitions/ch3_memory.png',
  5: 'assets/images/transitions/ch4_witness.png',
  6: 'assets/images/transitions/ch5_inherit.png',
};

/** chapter_id → stage 编号映射 */
export const CHAPTER_MAP = {
  'ch_prologue': 1,
  'ch_01': 2,
  'ch_02': 3,
  'ch_03': 4,
  'ch_04': 5,
  'ch_05': 6,
};

/**
 * chapter_id → 用户可见的章节显示文字
 * 序章显示 "序章"，ch_01~ch_05 显示 "第一章"~"第五章"
 */
export function getChapterLabel(chapterId) {
  if (!chapterId) return '未知';
  if (chapterId === 'ch_prologue') return '序章';
  const num = parseInt(chapterId.replace('ch_', ''), 10);
  if (isNaN(num)) return '未知';
  const zhNum = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
  return `第${zhNum[num - 1] || num}章`;
}

/**
 * 坐标转换工具 —— 瓦片坐标 ↔ 像素坐标
 *
 * 瓦片坐标 (col, row)：逻辑位置，如第3列第5行
 * 像素坐标 (x, y)：渲染/物理位置，用于精灵放置
 */
export const COORD = {
  /**
   * 瓦片坐标 → 像素坐标（渲染用，左上角）
   * @param {number} col - 列号
   * @param {number} row - 行号
   * @returns {{x: number, y: number}}
   */
  toPixel(col, row) {
    return { x: col * GAME.TILE_SIZE, y: row * GAME.TILE_SIZE };
  },

  /**
   * 像素坐标 → 瓦片坐标（碰撞/判定用）
   * @param {number} pixelX
   * @param {number} pixelY
   * @returns {{col: number, row: number}}
   */
  toTile(pixelX, pixelY) {
    return {
      col: Math.floor(pixelX / GAME.TILE_SIZE),
      row: Math.floor(pixelY / GAME.TILE_SIZE),
    };
  },

  /**
   * 瓦片中心像素坐标（实体放置用，居中于格子）
   * @param {number} col
   * @param {number} row
   * @returns {{x: number, y: number}}
   */
  toPixelCenter(col, row) {
    const half = GAME.TILE_SIZE / 2;
    return {
      x: col * GAME.TILE_SIZE + half,
      y: row * GAME.TILE_SIZE + half,
    };
  },
};
