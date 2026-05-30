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
  const bg = scene.add.graphics().setScrollFactor(0).setDepth(499);
  bg.fillStyle(0x0a0a12, 0.8);
  bg.fillRect(0, 0, width, height);
  const hint = scene.add.text(width / 2, height / 2, text, {
    fontFamily: '"KaiTi","SimSun",serif',
    fontSize: '26px', color: '#d4b896',
    backgroundColor: '#0a0a12cc',
    padding: { x: 24, y: 16 },
  }).setOrigin(0.5).setScrollFactor(0).setDepth(500);
  return { bg, hint };
}

/**
 * 隐藏加载提示
 * @param {Object|null} hint - { bg, hint }
 */
export function hideLoadingHint(hint) {
  if (hint) {
    if (hint.bg) hint.bg.setVisible(false);
    if (hint.hint) hint.hint.setVisible(false);
  }
}

// ==================== 物品闪光效果 ====================

/**
 * 为物品精灵添加闪光效果（呼吸 alpha + 轻微缩放脉冲）
 * 调用方在创建物品 sprite 后调用此函数即可
 * @param {Phaser.Scene} scene - 当前场景
 * @param {Phaser.GameObjects.Text} sprite - 物品文字精灵
 */
export function addItemSparkle(scene, sprite) {
  // 闪光：alpha 呼吸
  scene.tweens.add({
    targets: sprite,
    alpha: { from: 0.55, to: 1.0 },
    duration: 900 + Math.random() * 400,
    yoyo: true, repeat: -1,
    ease: 'Sine.easeInOut',
    delay: Math.random() * 600,
  });

  // 脉冲：轻微缩放
  scene.tweens.add({
    targets: sprite,
    scaleX: 1.08,
    scaleY: 1.08,
    duration: 1400 + Math.random() * 500,
    yoyo: true, repeat: -1,
    ease: 'Sine.easeInOut',
    delay: Math.random() * 400,
  });
}

// ==================== 资源按需加载 ====================

/** 已加载的纹理 key 集合（跨场景复用） */
const _loadedTextures = new Set();

/**
 * 按需加载图片纹理（支持多场景调用，已加载的直接跳过）
 * @param {Phaser.Scene} scene - 任意场景实例
 * @param {Array<{key:string, path:string}>} assets - 需要确保已加载的资源列表
 * @param {function} [onProgress] - 进度回调 (loaded: number, total: number)
 * @returns {Promise<void>}
 */
export function loadImagesOnDemand(scene, assets, onProgress) {
  const pending = assets.filter(a => !_loadedTextures.has(a.key));
  if (pending.length === 0) return Promise.resolve();

  let loaded = 0;
  const total = pending.length;

  return new Promise((resolve) => {
    pending.forEach(a => {
      _loadedTextures.add(a.key);
      scene.load.image(a.key, a.path);
    });

    scene.load.on('filecomplete', () => {
      loaded++;
      onProgress?.(loaded, total);
    });

    scene.load.once('complete', resolve);
    scene.load.start();
  });
}

/**
 * 同步检查纹理是否已加载
 * @param {string} key - 纹理 key
 * @returns {boolean}
 */
export function isTextureLoaded(key) {
  return _loadedTextures.has(key);
}

/**
 * 标记纹理为已加载（用于非 image 类型的资源或已知存在的纹理）
 * @param {string} key
 */
export function markTextureLoaded(key) {
  _loadedTextures.add(key);
}

// ==================== NPC 漫游状态初始化（供 GameScene 使用）====================

export { MAP_SCALE };
