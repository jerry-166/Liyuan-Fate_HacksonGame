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

// ==================== 角色立绘配置 ====================

/**
 * 角色立绘映射
 * key: npcId 或 'protagonist'
 * default: 默认表情key
 * variants: { emotionName → portraitKey }
 * baseDir: 立绘图片目录
 */
export const CHARACTER_PORTRAITS = {
  'protagonist': {
    baseDir: '/assets/images/characters/protagonist/portraits',
    default: 'protagonist_lost',
    variants: {
      lost: 'protagonist_lost',
      determined: 'protagonist_determined',
    },
  },
  'npc_chen': {
    baseDir: '/assets/images/characters/npc-chenshifu/portraits',
    default: 'chenshifu_cold',
    variants: {
      cold: 'chenshifu_cold',
      gentle: 'chenshifu_gentle',
      tears: 'chenshifu_tears',
    },
  },
  'npc_xiaohua': {
    baseDir: '/assets/images/characters/npc-xiaohua/portraits',
    default: 'xiaohua_friendly',
    variants: {
      friendly: 'xiaohua_friendly',
      guarded: 'xiaohua_guarded',
      hopeful: 'xiaohua_hopeful',
    },
  },
  'npc_laozhou': {
    baseDir: '/assets/images/characters/npc-laozhou/portraits',
    default: 'laozhou_dazed',
    variants: {
      dazed: 'laozhou_dazed',
      tears: 'laozhou_tears',
    },
  },
  'npc_meiyi': {
    baseDir: '/assets/images/characters/npc-meiyi/portraits',
    default: 'meiyi_curious',
    variants: {
      curious: 'meiyi_curious',
      sigh: 'meiyi_sigh',
    },
  },
};

/**
 * 获取所有立绘纹理的加载列表（供 BootScene 使用）
 * @returns {Array<{key:string, path:string}>}
 */
export function getAllPortraitAssets() {
  const assets = [];
  for (const cfg of Object.values(CHARACTER_PORTRAITS)) {
    const keys = new Set([cfg.default, ...Object.values(cfg.variants)]);
    for (const key of keys) {
      assets.push({ key, path: `${cfg.baseDir}/${key}.png` });
    }
  }
  return assets;
}

/**
 * 根据对话文本检测应该使用的立绘表情
 * @param {string} npcId
 * @param {string} text - 当前累积的对话文本
 * @returns {string|null} 表情变体名，或null表示使用默认
 */
export function detectPortraitEmotion(npcId, text) {
  const cfg = CHARACTER_PORTRAITS[npcId];
  if (!cfg || !text) return null;

  const lower = text.toLowerCase();

  // 通用情绪关键词 → 变体名映射
  const emotionRules = [
    { keywords: ['泪', '哭', '伤心', '难过', '悲痛', 'tears', 'cry', 'weep', 'sob'], emotion: 'tears' },
    { keywords: ['温柔', '微笑', '笑', '暖', 'gentle', 'smile', 'warm'], emotion: 'gentle' },
    { keywords: ['冷', '沉默', 'cold', 'silent', '哼'], emotion: 'cold' },
    { keywords: ['叹', '叹息', 'sigh', '无奈'], emotion: 'sigh' },
    { keywords: ['好奇', '打听', 'curious', 'wonder'], emotion: 'curious' },
    { keywords: ['希望', '未来', '明天', 'hope', 'hopeful'], emotion: 'hopeful' },
    { keywords: ['戒备', '怀疑', 'guarded', 'suspicious', '警惕'], emotion: 'guarded' },
    { keywords: ['坚定', '决心', 'determined', 'resolve'], emotion: 'determined' },
    { keywords: ['恍惚', '回忆', '过去', 'dazed', 'memory', 'reminisce'], emotion: 'dazed' },
    { keywords: ['友善', '开心', 'friendly', 'happy'], emotion: 'friendly' },
    { keywords: ['迷茫', '困惑', 'lost', 'confused', '茫然'], emotion: 'lost' },
  ];

  for (const rule of emotionRules) {
    // 检查该变体是否在角色的可用变体中
    if (!cfg.variants[rule.emotion]) continue;
    for (const kw of rule.keywords) {
      if (lower.includes(kw)) return rule.emotion;
    }
  }

  return null;
}

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

// ==================== NPC 分批预加载（按章节需要） ====================

/**
 * 章节 → 首次需要该NPC的章节映射
 * 序章(ch_prologue, 墓地)不需要任何NPC；
 * 第一章(ch_01)主地图首次出现小华、老周；
 * 第二章(ch_02)出现陈师傅、梅姨、船夫老李。
 */
export const CHAPTER_NPCS = {
  1: ['npc_chen', 'npc_xiaohua', 'npc_laozhou'],
  2: ['npc_meiyi', 'npc_laoli'],
};

/**
 * 后台预加载指定NPC列表的所有精灵纹理（不阻塞主流程）
 * @param {Phaser.Scene} scene
 * @param {string[]} npcIds - NPC ID 列表，如 ['npc_xiaohua', 'npc_laozhou']
 * @returns {Promise<void>} 注意：调用方不需要 await，Promise 只用于确保加载完成
 */
export function preloadNPCSprites(scene, npcIds) {
  const assets = [];
  for (const id of npcIds) {
    const cfg = NPC_SPRITES[id];
    if (!cfg) continue;
    for (const dir of DIRS) {
      assets.push({ key: `${cfg.prefix}_idle_${dir}`, path: `${cfg.baseDir}/${cfg.prefix}_idle_${dir}.png` });
      assets.push({ key: `${cfg.prefix}_walk_${dir}`, path: `${cfg.baseDir}/${cfg.prefix}_walk_${dir}.png` });
    }
  }
  return loadImagesOnDemand(scene, assets);
}

// ==================== NPC 漫游状态初始化（供 GameScene 使用）====================

export { MAP_SCALE };
