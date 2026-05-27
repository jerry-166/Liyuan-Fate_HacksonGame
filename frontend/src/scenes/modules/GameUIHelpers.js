/**
 * 游戏 UI 工具函数 —— 可在 GameScene 和 UIScene 间共享
 * @module scenes/modules/GameUIHelpers
 */

import { GAME, COORD } from '../../config.js';
import { MAP_SCALE } from './MapGenerator.js';

// ==================== 主角精灵配置 ====================
export const PROTAGONIST = {
  baseDir: '/assets/images/characters/protagonist/sprites',
  prefix: 'protagonist',
  scale: 0.09,
  bodyRatio: { w: 0.5, h: 0.6, offsetX: 0.25, offsetY: 0.35 },
};

// ==================== NPC 精灵配置 ====================
export const NPC_SPRITES = {
  'npc_chen':    { prefix: 'chenshifu',     baseDir: '/assets/images/characters/npc-chenshifu/sprites',     scale: 0.09 },
  'npc_xiaohua': { prefix: 'xiaohua',        baseDir: '/assets/images/characters/npc-xiaohua/sprites',       scale: 0.09 },
  'npc_laozhou': { prefix: 'laozhou',        baseDir: '/assets/images/characters/npc-laozhou/sprites',       scale: 0.09 },
  'npc_laoli':   { prefix: 'chuanfulaoli',   baseDir: '/assets/images/characters/npc-chuanfulaoli/sprites',  scale: 0.09 },
  'npc_meiyi':   { prefix: 'meiyi',          baseDir: '/assets/images/characters/npc-meiyi/sprites',         scale: 0.09 },
};

/** 普通 NPC/town-npcs 回退精灵（使用小华素材作为通用路人外观） */
export const FALLBACK_NPC_SPRITE = {
  prefix: 'xiaohua',
  baseDir: '/assets/images/characters/npc-xiaohua/sprites',
  scale: 0.08,
};

/** 四方向常量 */
export const DIRS = ['down', 'left', 'right', 'up'];

/**
 * 创建 Toast 提示（绑定到场景实例上）
 * @param {Phaser.Scene} scene - 任意 Phaser 场景
 * @param {string} message - 提示文字
 * @param {number} [duration=2000] - 显示时长(ms)
 */
export function showToast(scene, message, duration = 2000) {
  const { width } = scene.cameras.main;
  const toast = scene.add.text(width / 2, 30, message, {
    fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
    fontSize: '18px', color: '#ffaa66',
    backgroundColor: '#1a1010ee',
    padding: { x: 14, y: 8 },
    borderRadius: 5,
  }).setOrigin(0.5, 0).setDepth(600).setAlpha(0);

  scene.tweens.add({
    targets: toast, alpha: 1, duration: 300,
    onComplete: () => {
      scene.time.delayedCall(duration, () => {
        scene.tweens.add({
          targets: toast, alpha: 0, duration: 400,
          onComplete: () => toast.destroy(),
        });
      });
    },
  });
}

/**
 * 显示加载提示
 * @param {Phaser.Scene} scene
 * @param {string} text
 * @returns {Phaser.GameObjects.Text} 提示对象
 */
export function showLoadingHint(scene, text) {
  const { width, height } = scene.cameras.main;
  const hint = scene.add.text(width / 2, height / 2, text, {
    fontFamily: '"KaiTi","SimSun",serif',
    fontSize: '26px', color: '#d4b896',
    backgroundColor: '#0a0a12cc',
    padding: { x: 24, y: 16 },
    borderRadius: 8,
  }).setOrigin(0.5).setDepth(500);
  return hint;
}

/**
 * 隐藏加载提示
 * @param {Phaser.GameObjects.Text|null} hint
 */
export function hideLoadingHint(hint) {
  if (hint) {
    hint.setVisible(false);
  }
}

// ==================== NPC 漫游状态初始化（供 GameScene 使用）====================

export { MAP_SCALE };
