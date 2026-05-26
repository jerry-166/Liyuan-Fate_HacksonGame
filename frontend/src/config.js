/**
 * 游戏常量配置
 */
export const GAME = {
  WIDTH: 1280,
  HEIGHT: 800,
  TILE_SIZE: 16,
  PLAYER_SPEED: 200,
};

export const COLORS = {
  BG_DARK: 0x1a1a2e,
  TEXT_PRIMARY: '#c4a882',
  TEXT_SECONDARY: '#888888',
  DIALOG_BG: 0x1a1a2e,
  DIALOG_BORDER: 0xc4a882,
};

/** 场景 key 常量 */
export const SCENES = {
  BOOT: 'BootScene',
  MENU: 'MenuScene',
  GAME: 'GameScene',
  UI: 'UIScene',
};

/** 六章节色调（按《梨园生死》剧情） */
export const STAGE_TONES = {
  1: { name: '归乡', tint: 0x8899aa, mood: 'melancholy', hex: '#8899aa' },
  2: { name: '闻声·异样', tint: 0x8899bb, mood: 'cold', hex: '#8899bb' },
  3: { name: '探寻·疑云', tint: 0xbbaa88, mood: 'warm', hex: '#bbaa88' },
  4: { name: '忆归·真相', tint: 0xcc9977, mood: 'dramatic', hex: '#cc9977' },
  5: { name: '目睹·凋零', tint: 0x998877, mood: 'somber', hex: '#998877' },
  6: { name: '承戏·重振', tint: 0xcc8866, mood: 'dramatic', hex: '#cc8866' },
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

/** 坐标转换工具 — 瓦片坐标 ↔ 像素坐标 */
export const COORD = {
  /**
   * 瓦片坐标 → 像素坐标（渲染用）
   * @param {number} col 列号
   * @param {number} row 行号
   * @returns {{x: number, y: number}}
   */
  toPixel(col, row) {
    return {
      x: col * GAME.TILE_SIZE,
      y: row * GAME.TILE_SIZE,
    };
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
