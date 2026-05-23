/**
 * 游戏常量配置
 */
export const GAME = {
  WIDTH: 1024,
  HEIGHT: 768,
  TILE_SIZE: 16,
  PLAYER_SPEED: 160,
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
  GAME: 'GameScene',
  UI: 'UIScene',
};

/** 三阶段色调 */
export const STAGE_TONES = {
  1: { name: '不屑', tint: 0x8899bb, mood: 'cold' },
  2: { name: '了解', tint: 0xddcc99, mood: 'warm' },
  3: { name: '抉择', tint: 0xcc8866, mood: 'dramatic' },
};
