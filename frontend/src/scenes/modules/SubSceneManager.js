/**
 * 子场景管理器 —— 编排进入/离开子场景的完整流程
 *
 * 职责：
 * - 检测玩家是否接近主地图建筑入口
 * - 编排场景切换动画（淡入淡出）
 * - 保存/恢复主地图世界状态（NPC位置、物品、碰撞数据）
 * - 切换地图图片、碰撞数据、地图边界
 * - 管理子场景内NPC/物品的生命周期
 * - 戏台状态切换（ruined → renewed）
 *
 * @module scenes/modules/SubSceneManager
 */

import { GAME, COORD } from '../../config.js';
import { MAP_SCALE, MAP_COLS, MAP_ROWS } from './MapGenerator.js';
import {
  SUBSCENES, BUILDING_ENTRIES, ENTRY_DETECT_RANGE,
  generateBorderCollision, getCollisionKey, getNPCPositionsKey,
  SUB_MAP_SCALE,
} from './SubSceneConfig.js';
import { FALLBACK_NPC_SPRITE, NPC_SPRITES } from './GameUIHelpers.js';

const TILE = GAME.TILE_SIZE;

export class SubSceneManager {
  /**
   * @param {import('../GameScene').GameScene} scene - GameScene 实例
   */
  constructor(scene) {
    this.scene = scene;

    /** 当前所在子场景ID，null表示在主地图 */
    this.currentSubSceneId = null;

    /** 保存的主地图世界状态 */
    this._savedWorldState = null;

    /** 当前接近的建筑入口（null=无） */
    this.nearbyBuilding = null;

    /** 是否正在切换中（防止重复触发） */
    this._transitioning = false;

    /** 子场景退出按钮 UI 元素 */
    this._exitBtnBg = null;
    this._exitBtnText = null;
    this._sceneNameLabel = null;
  }

  // ==================== 状态查询 ====================

  /** 当前是否在子场景中 */
  isInSubScene() {
    return this.currentSubSceneId !== null;
  }

  /** 获取当前子场景配置 */
  getCurrentConfig() {
    if (!this.currentSubSceneId) return null;
    return SUBSCENES[this.currentSubSceneId];
  }

  /** 是否正在切换场景 */
  isTransitioning() {
    return this._transitioning;
  }

  /**
   * 获取当前有效的缩放因子
   * 子场景内返回 SUB_MAP_SCALE (MAP_SCALE * 0.5)，主地图返回 MAP_SCALE
   */
  getEffectiveScale() {
    return this.isInSubScene() ? SUB_MAP_SCALE : MAP_SCALE;
  }

  // ==================== 建筑入口检测 ====================

  /**
   * 检测玩家是否接近建筑入口
   * @param {number} playerCol - 玩家瓦片列
   * @param {number} playerRow - 玩家瓦片行
   * @returns {Object|null} 匹配的建筑入口配置，或 null
   */
  checkBuildingProximity(playerCol, playerRow) {
    for (const entry of BUILDING_ENTRIES) {
      const z = entry.entryZone;
      // 玩家在入口区域内或距离入口区域内任意格子 <= ENTRY_DETECT_RANGE
      for (let r = z.row; r < z.row + z.h; r++) {
        for (let c = z.col; c < z.col + z.w; c++) {
          const dist = Math.abs(playerCol - c) + Math.abs(playerRow - r);
          if (dist <= ENTRY_DETECT_RANGE) {
            return entry;
          }
        }
      }
    }
    return null;
  }

  /**
   * 检测玩家是否在子场景出口区域
   * @param {number} playerCol - 玩家瓦片列（子场景坐标系）
   * @param {number} playerRow - 玩家瓦片行（子场景坐标系）
   * @returns {boolean}
   */
  isAtExitZone(playerCol, playerRow) {
    const config = this.getCurrentConfig();
    if (!config) return false;
    const ez = config.exitZone;
    return playerCol >= ez.col && playerCol < ez.col + ez.w &&
           playerRow >= ez.row && playerRow < ez.row + ez.h;
  }

  // ==================== 进入子场景 ====================

  /**
   * 进入子场景的完整流程
   * @param {string} subSceneId - 目标子场景ID
   * @param {Object} [options] - 存档恢复时的位置覆盖
   * @param {Object} [options.playerPos] - { col, row } 玩家子场景瓦片坐标
   * @param {Array}  [options.storyNpcPositions] - [{ npc_id, position: { col, row } }]
   */
  async enterSubScene(subSceneId, options) {
    const config = SUBSCENES[subSceneId];
    if (!config || this._transitioning) return;

    this._transitioning = true;
    const scene = this.scene;

    // 1. 锁定输入
    scene.events.emit('input:lock', true);
    scene.inputLocked = true;

    // 2. 保存世界状态
    this._saveWorldState();

    // 3. 摄像机淡出
    await this._fadeOut();

    // 4. 销毁当前NPC/物品精灵
    this._destroyAllEntities();

    // 5. 切换地图
    this._switchToSubSceneMap(config);

    // 6. 加载子场景碰撞数据
    this._loadSubSceneCollision(config);

    // 7. 创建子场景NPC（支持存档恢复位置）
    this._createSubSceneNPCs(config, options?.storyNpcPositions);

    // 8. 放置玩家（存档恢复用指定位置，否则用出生点）
    if (options?.playerPos) {
      const { x, y } = COORD.toPixel(options.playerPos.col, options.playerPos.row);
      scene.player.x = x * SUB_MAP_SCALE;
      scene.player.y = y * SUB_MAP_SCALE;
    } else {
      this._placePlayerAtSpawn(config);
    }
    scene.player.setData('facing', 'up');

    // 9. 更新地图边界
    this._updateMapBounds(config);

    // 10. 设置当前子场景ID
    this.currentSubSceneId = subSceneId;

    // 11. 创建退出按钮
    this._createExitButton(config);

    // 12. 摄像机淡入
    await this._fadeIn();

    // 13. 解锁输入
    scene.inputLocked = false;
    scene.events.emit('input:lock', false);
    this._transitioning = false;

    console.log(`[SubSceneManager] 进入子场景: ${config.name} (${subSceneId})`,
      options ? '(存档恢复)' : '');
  }

  // ==================== 离开子场景 ====================

  /**
   * 离开子场景，返回主地图
   */
  async exitSubScene() {
    if (!this.currentSubSceneId || this._transitioning) return;

    this._transitioning = true;
    const scene = this.scene;

    // 1. 锁定输入
    scene.events.emit('input:lock', true);
    scene.inputLocked = true;

    // 2. 销毁退出按钮
    this._destroyExitButton();

    // 3. 摄像机淡出
    await this._fadeOut();

    // 4. 销毁子场景NPC/物品精灵
    this._destroyAllEntities();

    // 5. 恢复主地图
    this._restoreWorldMap();

    // 6. 恢复碰撞数据
    this._restoreWorldCollision();

    // 7. 恢复NPC/物品
    this._restoreWorldEntities();

    // 8. 恢复玩家位置
    this._restorePlayerPosition();

    // 9. 更新地图边界
    this._restoreWorldBounds();

    // 10. ★ 摄像机立即聚焦玩家位置（避免渐变滑动导致的"卡住"错觉）
    if (scene.player && scene._mapBounds) {
      const cam = scene.cameras.main;
      cam.centerOn(scene.player.x, scene.player.y);
      cam.scrollX = Phaser.Math.Clamp(cam.scrollX, 0, Math.max(0, scene._mapBounds.w - cam.width));
      cam.scrollY = Phaser.Math.Clamp(cam.scrollY, 0, Math.max(0, scene._mapBounds.h - cam.height));
    }

    // 11. 清除子场景状态
    this.currentSubSceneId = null;

    // 12. 摄像机淡入
    await this._fadeIn();

    // 13. 解锁输入
    scene.inputLocked = false;
    scene.events.emit('input:lock', false);
    this._transitioning = false;

    console.log('[SubSceneManager] 返回主地图');
  }

  // ==================== 强制退出子场景 ====================

  /**
   * 同步强制退出子场景（无动画，用于存档加载等需要立即恢复主地图的场景）
   *
   * 与 exitSubScene() 的区别：
   * - 无淡入淡出动画
   * - 无 input:lock 事件
   * - 不恢复保存的世界状态（因为加载存档会用新数据覆盖）
   * - 执行立即销毁子场景 UI、恢复主地图图片/碰撞/边界/玩家位置
   */
  forceExitSubScene() {
    if (!this.currentSubSceneId) return;

    const scene = this.scene;
    console.log(`[SubSceneManager] 强制退出子场景: ${this.currentSubSceneId}`);

    // 1. 重置过渡状态（防止 exitSubScene 的 async 竞态）
    this._transitioning = false;

    // 2. 销毁退出按钮
    this._destroyExitButton();

    // 3. 销毁子场景 NPC/物品精灵
    this._destroyAllEntities();

    // 4. 销毁子场景地图图片，恢复主地图
    if (scene.mapImage) scene.mapImage.destroy();
    scene.mapImage = scene.add.image(0, 0, 'town_worldmap').setOrigin(0, 0);
    scene.mapImage.setDepth(0).setScale(MAP_SCALE);

    // 5. 恢复主地图碰撞数据
    try {
      const saved = localStorage.getItem('editor_collision_map');
      scene._collisionMap = saved ? JSON.parse(saved) : {};
    } catch (_) {
      scene._collisionMap = {};
    }

    // 6. 恢复主地图边界
    this._restoreWorldBounds();

    // 7. 清除子场景状态
    this.currentSubSceneId = null;
    this._savedWorldState = null;
    this.nearbyBuilding = null;

    // 8. ★ 兜底：将玩家放回主地图可见位置，确保角色不消失
    //    如果后续存档加载提供了 _player_position，会被 _reloadFromState 覆盖
    if (scene.player) {
      const defaultPos = COORD.toPixel(44, 28);
      scene.player.x = defaultPos.x * MAP_SCALE;
      scene.player.y = defaultPos.y * MAP_SCALE;
      scene.player.setVisible(true);
      scene.player.setAlpha(1);
      scene.player.setDepth(10);
    }

    scene.interactHint?.setVisible(false);
    scene.currentNearbyNPC = null;
    scene.currentNearbyItem = null;
  }

  // ==================== 世界状态保存/恢复 ====================

  /** 保存主地图世界状态 */
  _saveWorldState() {
    const scene = this.scene;
    this._savedWorldState = {
      // 玩家位置（像素）
      playerX: scene.player.x,
      playerY: scene.player.y,

      // 主地图碰撞数据
      collisionMap: { ...scene._collisionMap },

      // 故事NPC位置
      storyNPCs: scene.npcs.map(npc => ({
        npcId: npc.getData('npcId'),
        name: npc.getData('name'),
        greeting: npc.getData('greeting'),
        x: npc.x,
        y: npc.y,
        visible: npc.visible,
        spriteCfg: npc.getData('spriteCfg'),
        isTownNPC: npc.getData('isTownNPC'),
        wanderState: npc.getData('wanderState') ? { ...npc.getData('wanderState') } : null,
      })),

      // 普通NPC位置
      townNPCs: scene.townNpcs.map((npc, i) => ({
        npcId: npc.getData('npcId'),
        name: npc.getData('name'),
        greeting: npc.getData('greeting'),
        x: npc.x,
        y: npc.y,
        role: npc.getData('role'),
        spriteCfg: npc.getData('spriteCfg'),
        wanderState: npc.getData('wanderState') ? { ...npc.getData('wanderState') } : null,
        bubbleText: scene.townNpcBubbles[i]?.text || '',
      })),

      // 场景物品
      sceneItems: scene.sceneItems.map(item => ({
        itemId: item.getData('itemId'),
        name: item.getData('name'),
        x: item.x,
        y: item.y,
      })),
    };
  }

  // ==================== 实体销毁 ====================

  /** 销毁所有NPC和物品精灵 */
  _destroyAllEntities() {
    const scene = this.scene;

    // 销毁故事NPC
    scene.npcs.forEach(npc => npc.destroy());
    scene.npcBubbles.forEach(b => b.destroy());
    scene.npcs = [];
    scene.npcBubbles = [];

    // 销毁普通NPC
    scene.townNpcs.forEach(npc => npc.destroy());
    scene.townNpcBubbles.forEach(b => b.destroy());
    scene.townNpcs = [];
    scene.townNpcBubbles = [];

    // 销毁场景物品
    scene.sceneItems.forEach(item => item.destroy());
    scene.sceneItems = [];
    scene.currentNearbyItem = null;

    // 隐藏交互提示
    scene.interactHint?.setVisible(false);
    scene._hideNPCActionButtons?.();

    // 重置NPC接近状态
    scene.currentNearbyNPC = null;
  }

  // ==================== 地图切换 ====================

  /** 切换到子场景地图 */
  _switchToSubSceneMap(config) {
    const scene = this.scene;

    // 移除旧地图
    if (scene.mapImage) scene.mapImage.destroy();

    // 确定使用哪张图（戏台特殊处理）
    let imageKey = config.imageKey;
    if (config.hasStateSwitch) {
      const sessionId = localStorage.getItem('__active_session__');
      if (sessionId) {
        try {
          const saved = localStorage.getItem(`game_state_${sessionId}`);
          if (saved) {
            const gs = JSON.parse(saved);
            if (gs[config.stateKey]) {
              imageKey = config.altImageKey;
            }
          }
        } catch (_) { /* 默认使用原始图 */ }
      }
    }

    // 创建新地图（使用 50% 缩放）
    scene.mapImage = scene.add.image(0, 0, imageKey).setOrigin(0, 0);
    scene.mapImage.setDepth(0).setScale(SUB_MAP_SCALE);
  }

  /** 恢复主地图 */
  _restoreWorldMap() {
    const scene = this.scene;
    if (scene.mapImage) scene.mapImage.destroy();
    scene.mapImage = scene.add.image(0, 0, 'town_worldmap').setOrigin(0, 0);
    scene.mapImage.setDepth(0).setScale(MAP_SCALE);
  }

  // ==================== 碰撞数据 ====================

  /** 加载子场景碰撞数据 */
  _loadSubSceneCollision(config) {
    const scene = this.scene;
    const key = getCollisionKey(config.id);

    try {
      const saved = localStorage.getItem(key);
      if (saved) {
        scene._collisionMap = JSON.parse(saved);
      } else {
        // 无保存数据，生成边界碰撞
        scene._collisionMap = generateBorderCollision(config.tileCols, config.tileRows);
      }
    } catch (_) {
      scene._collisionMap = generateBorderCollision(config.tileCols, config.tileRows);
    }

    // 出口区域移除碰撞（让玩家可以走到出口）
    const ez = config.exitZone;
    for (let r = ez.row; r < ez.row + ez.h; r++) {
      for (let c = ez.col; c < ez.col + ez.w; c++) {
        delete scene._collisionMap[`${c}_${r}`];
      }
    }
  }

  /** 恢复主地图碰撞数据 */
  _restoreWorldCollision() {
    const scene = this.scene;
    if (this._savedWorldState) {
      scene._collisionMap = this._savedWorldState.collisionMap;
    } else {
      try {
        const saved = localStorage.getItem('editor_collision_map');
        scene._collisionMap = saved ? JSON.parse(saved) : {};
      } catch (_) {
        scene._collisionMap = {};
      }
    }
  }

  // ==================== 子场景NPC ====================

  /** 创建子场景NPC */
  _createSubSceneNPCs(config, overridePositions) {
    const scene = this.scene;
    const placeholders = config.npcPlaceholders || [];

    // 位置优先级：存档恢复 > localStorage编辑器 > 配置默认值
    const overrideMap = {};
    if (overridePositions && Array.isArray(overridePositions)) {
      for (const op of overridePositions) {
        overrideMap[op.npc_id] = op.position;
      }
    }

    const posKey = getNPCPositionsKey(config.id);
    let savedPositions = null;
    try {
      const saved = localStorage.getItem(posKey);
      if (saved) savedPositions = JSON.parse(saved);
    } catch (_) { /* ignore */ }

    placeholders.forEach(ph => {
      let col = ph.col, row = ph.row;
      if (overrideMap[ph.id]) {
        col = overrideMap[ph.id].col;
        row = overrideMap[ph.id].row;
      } else if (savedPositions && savedPositions[ph.id]) {
        col = savedPositions[ph.id].col;
        row = savedPositions[ph.id].row;
      }

      const cfg = NPC_SPRITES[ph.id] || FALLBACK_NPC_SPRITE;
      const { x: posX, y: posY } = COORD.toPixel(col, row);
      const startKey = `${cfg.prefix}_idle_down`;

      const sprite = scene.physics.add.sprite(posX * SUB_MAP_SCALE, posY * SUB_MAP_SCALE, startKey);
      sprite.setScale(cfg.scale);
      sprite.setData('npcId', ph.id);
      sprite.setData('name', ph.name);
      sprite.setData('greeting', ph.greeting || '');
      sprite.setData('spriteCfg', cfg);
      sprite.setData('isTownNPC', !NPC_SPRITES[ph.id]);
      sprite.setImmovable(true);
      sprite.body.pushable = false;
      sprite.setDepth(5).setVisible(true);

      // 漫游状态
      sprite.setData('wanderState', scene._initWanderState({
        position: { col, row },
        movement: { enabled: true, speed: 20, idle_range: [5, 12], wander_range: [2, 4] },
      }));

      // 气泡
      const bubbleText = scene.add.text(sprite.x, sprite.y - 20 * SUB_MAP_SCALE, ph.greeting || '', {
        fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
        fontSize: '16px', color: '#e8dcc8',
        backgroundColor: '#2a2824dd',
        padding: { x: 8, y: 4 },
        wordWrap: { width: 170 }, align: 'center', lineSpacing: 4,
      }).setOrigin(0.5).setDepth(101);

      scene.npcs.push(sprite);
      scene.npcBubbles.push(bubbleText);
    });
  }

  // ==================== 玩家定位 ====================

  /** 放置玩家到子场景出生点 */
  _placePlayerAtSpawn(config) {
    const scene = this.scene;
    const { col, row } = config.playerSpawn;
    const { x, y } = COORD.toPixel(col, row);
    scene.player.x = x * SUB_MAP_SCALE;
    scene.player.y = y * SUB_MAP_SCALE;
    scene.player.setData('facing', 'up');
  }

  /** 恢复玩家位置到主地图 */
  _restorePlayerPosition() {
    const scene = this.scene;
    if (this._savedWorldState) {
      scene.player.x = this._savedWorldState.playerX;
      scene.player.y = this._savedWorldState.playerY;
    } else {
      const pos = COORD.toPixel(44, 28);
      scene.player.x = pos.x * MAP_SCALE;
      scene.player.y = pos.y * MAP_SCALE;
    }
  }

  // ==================== 地图边界 ====================

  /** 更新地图边界为子场景尺寸 */
  _updateMapBounds(config) {
    const scene = this.scene;
    const actualW = config.pixelW * SUB_MAP_SCALE;
    const actualH = config.pixelH * SUB_MAP_SCALE;
    scene._mapBounds = { w: actualW, h: actualH };
  }

  /** 恢复主地图边界 — 以地图图片实际渲染尺寸为准，与 create() 保持一致 */
  _restoreWorldBounds() {
    const scene = this.scene;
    if (scene.mapImage && scene.mapImage.displayWidth > 0) {
      scene._mapBounds = { w: scene.mapImage.displayWidth, h: scene.mapImage.displayHeight };
    } else {
      // 后备：按逻辑网格计算
      const actualW = MAP_COLS * TILE * MAP_SCALE;
      const actualH = MAP_ROWS * TILE * MAP_SCALE;
      scene._mapBounds = { w: actualW, h: actualH };
    }
  }

  // ==================== 主地图实体恢复 ====================

  /** 恢复主地图NPC和物品 */
  _restoreWorldEntities() {
    const scene = this.scene;
    const saved = this._savedWorldState;
    if (!saved) return;

    // 恢复故事NPC
    saved.storyNPCs.forEach(data => {
      const cfg = data.spriteCfg || NPC_SPRITES[data.npcId] || FALLBACK_NPC_SPRITE;
      const startKey = `${cfg.prefix}_idle_down`;
      const sprite = scene.physics.add.sprite(data.x, data.y, startKey);
      sprite.setScale(cfg.scale);
      sprite.setData('npcId', data.npcId);
      sprite.setData('name', data.name);
      sprite.setData('greeting', data.greeting);
      sprite.setData('spriteCfg', cfg);
      sprite.setData('isTownNPC', data.isTownNPC || false);
      sprite.setImmovable(true);
      sprite.body.pushable = false;
      sprite.setDepth(5).setVisible(data.visible !== false);
      if (data.wanderState) sprite.setData('wanderState', data.wanderState);

      const bubbleText = scene.add.text(sprite.x, sprite.y - 20 * MAP_SCALE, data.greeting || '', {
        fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
        fontSize: '16px', color: '#e8dcc8',
        backgroundColor: '#2a2824dd',
        padding: { x: 8, y: 4 },
        wordWrap: { width: 170 }, align: 'center', lineSpacing: 4,
      }).setOrigin(0.5).setDepth(101);

      scene.npcs.push(sprite);
      scene.npcBubbles.push(bubbleText);
    });

    // 恢复普通NPC
    saved.townNPCs.forEach(data => {
      const cfg = data.spriteCfg || FALLBACK_NPC_SPRITE;
      const startKey = `${cfg.prefix}_idle_down`;
      const sprite = scene.physics.add.sprite(data.x, data.y, startKey);
      sprite.setScale(cfg.scale);
      sprite.setData('npcId', data.npcId);
      sprite.setData('name', data.name);
      sprite.setData('greeting', data.greeting);
      sprite.setData('spriteCfg', cfg);
      sprite.setData('isTownNPC', true);
      sprite.setData('role', data.role || null);
      sprite.setImmovable(true);
      sprite.body.pushable = false;
      sprite.setDepth(4).setVisible(true);
      if (data.wanderState) sprite.setData('wanderState', data.wanderState);

      const bubbleText = scene.add.text(sprite.x, sprite.y - 18 * MAP_SCALE, data.bubbleText || '', {
        fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
        fontSize: '14px', color: '#c8dcc8',
        backgroundColor: '#1a2824dd',
        padding: { x: 6, y: 3 },
        wordWrap: { width: 140 }, align: 'center', lineSpacing: 3,
      }).setOrigin(0.5).setDepth(100);

      scene.townNpcs.push(sprite);
      scene.townNpcBubbles.push(bubbleText);
    });

    // 恢复场景物品
    saved.sceneItems.forEach(data => {
      const sprite = scene.add.text(data.x, data.y, '📦', {
        fontSize: `${20 * MAP_SCALE}px`,
      }).setOrigin(0.5).setDepth(90);
      sprite.setData('itemId', data.itemId);
      sprite.setData('name', data.name);
      scene.tweens.add({
        targets: sprite,
        y: data.y - 4 * MAP_SCALE,
        duration: 1200, yoyo: true, repeat: -1,
        ease: 'Sine.easeInOut',
      });
      scene.sceneItems.push(sprite);
    });

    // 清除保存状态
    this._savedWorldState = null;
  }

  // ==================== 淡入淡出 ====================

  /** 摄像机淡出 */
  _fadeOut() {
    return new Promise(resolve => {
      this.scene.cameras.main.fadeOut(300, 0, 0, 0);
      this.scene.cameras.main.once('camerafadeoutcomplete', resolve);
    });
  }

  /** 摄像机淡入 */
  _fadeIn() {
    return new Promise(resolve => {
      this.scene.cameras.main.fadeIn(300, 0, 0, 0);
      this.scene.cameras.main.once('camerafadeincomplete', resolve);
    });
  }

  // ==================== 戏台状态切换 ====================

  /**
   * 检查并应用戏台 renewed 状态
   * 如果 gameState._stage_renewed 为 true，且当前在戏台子场景中，切换地图图片
   * @param {Object} gameState - 当前游戏状态
   */
  updateStageRenewed(gameState) {
    if (!gameState || !gameState._stage_renewed) return;
    if (this.currentSubSceneId !== 'stage') return;

    const config = SUBSCENES.stage;
    const scene = this.scene;

    // 切换地图图片
    if (scene.mapImage) scene.mapImage.destroy();
    scene.mapImage = scene.add.image(0, 0, config.altImageKey).setOrigin(0, 0);
    scene.mapImage.setDepth(0).setScale(SUB_MAP_SCALE);

    console.log('[SubSceneManager] 戏台已切换为 renewed 状态');
  }

  /**
   * 触发戏台状态切换（由剧情事件调用）
   * 设置 _stage_renewed 标志并持久化
   */
  triggerStageRenewed() {
    const sessionId = localStorage.getItem('__active_session__');
    if (!sessionId) return;

    try {
      const saved = localStorage.getItem(`game_state_${sessionId}`);
      if (saved) {
        const gs = JSON.parse(saved);
        if (gs._stage_renewed) return; // 已经切换过了
        gs._stage_renewed = true;
        localStorage.setItem(`game_state_${sessionId}`, JSON.stringify(gs));
      }
    } catch (_) { /* ignore */ }

    // 如果当前在戏台子场景中，立即切换
    this.updateStageRenewed({ _stage_renewed: true });
    console.log('[SubSceneManager] 戏台状态已标记为 renewed');
  }

  // ==================== 退出按钮 ====================

  /**
   * 创建子场景退出按钮（固定在屏幕右上角，不随摄像机移动）
   * @param {Object} config - 子场景配置
   */
  _createExitButton(config) {
    const scene = this.scene;
    const cam = scene.cameras.main;

    // 按钮尺寸参数
    const btnW = 72, btnH = 36, padding = 12;
    const screenX = cam.width - btnW / 2 - padding;
    const screenY = btnH / 2 + padding;

    // 背景
    this._exitBtnBg = scene.add.graphics()
      .setDepth(1000)
      .setScrollFactor(0)
      .setVisible(true);
    this._drawExitBtnBg(this._exitBtnBg, screenX, screenY, btnW, btnH, false);

    // 按钮文字
    this._exitBtnText = scene.add.text(screenX, screenY, '🚪 退出', {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
      fontSize: '15px', color: '#d4c4a0',
    }).setOrigin(0.5).setDepth(1001).setScrollFactor(0);

    // 点击区域
    const hitArea = scene.add.rectangle(screenX, screenY, btnW, btnH, 0x000000, 0.01)
      .setDepth(1002)
      .setScrollFactor(0)
      .setInteractive({ useHandCursor: true });

    hitArea.on('pointerover', () => {
      this._drawExitBtnBg(this._exitBtnBg, screenX, screenY, btnW, btnH, true);
      this._exitBtnText.setColor('#fff5e0');
    });
    hitArea.on('pointerout', () => {
      this._drawExitBtnBg(this._exitBtnBg, screenX, screenY, btnW, btnH, false);
      this._exitBtnText.setColor('#d4c4a0');
    });
    hitArea.on('pointerdown', () => {
      if (!this._transitioning) this.exitSubScene();
    });

    this._exitBtnHit = hitArea;

    // 场景名称标签
    this._sceneNameLabel = scene.add.text(screenX - btnW / 2, screenY - btnH / 2 - 6, config.name, {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
      fontSize: '12px', color: '#887766',
    }).setOrigin(0.5, 1).setDepth(1001).setScrollFactor(0);
  }

  /**
   * 绘制退出按钮背景
   */
  _drawExitBtnBg(gfx, cx, cy, w, h, hover) {
    gfx.clear();
    gfx.fillStyle(hover ? 0x4a3830 : 0x2a2824, 0.92);
    gfx.fillRoundedRect(cx - w / 2, cy - h / 2, w, h, 6);
    gfx.lineStyle(1, hover ? 0xd4b896 : 0x887766, 0.6);
    gfx.strokeRoundedRect(cx - w / 2, cy - h / 2, w, h, 6);
  }

  /** 销毁退出按钮 */
  _destroyExitButton() {
    if (this._exitBtnBg) { this._exitBtnBg.destroy(); this._exitBtnBg = null; }
    if (this._exitBtnText) { this._exitBtnText.destroy(); this._exitBtnText = null; }
    if (this._exitBtnHit) { this._exitBtnHit.destroy(); this._exitBtnHit = null; }
    if (this._sceneNameLabel) { this._sceneNameLabel.destroy(); this._sceneNameLabel = null; }
  }

  // ==================== 每帧更新 ====================

  /**
   * 每帧更新 — 检测建筑接近/出口区域并更新提示
   * 由 GameScene._updateInner() 调用
   */
  updateProximityHints() {
    const scene = this.scene;
    if (!scene.player) return;

    const effectiveScale = this.getEffectiveScale();

    if (this.isInSubScene()) {
      // 子场景内：检测出口区域
      const tile = COORD.toTile(scene.player.x / effectiveScale, scene.player.y / effectiveScale);
      const config = this.getCurrentConfig();

      if (this.isAtExitZone(tile.col, tile.row)) {
        scene.interactHint.setText(`按 [F] 离开${config.name}`);
        scene.interactHint.setPosition(scene.player.x, scene.player.y - 50);
        scene.interactHint.setVisible(true);
        this.nearbyBuilding = null; // 不再显示建筑入口提示
      } else {
        // 不在出口，且没有NPC/物品接近，隐藏提示
        if (!scene.currentNearbyNPC && !scene.currentNearbyItem) {
          scene.interactHint.setVisible(false);
        }
      }
    } else {
      // 主地图：检测建筑入口
      const tile = COORD.toTile(scene.player.x / effectiveScale, scene.player.y / effectiveScale);
      const building = this.checkBuildingProximity(tile.col, tile.row);

      if (building && !scene.currentNearbyNPC && !scene.currentNearbyItem) {
        scene.interactHint.setText(`按 [F] 进入${building.name}`);
        scene.interactHint.setPosition(scene.player.x, scene.player.y - 50);
        scene.interactHint.setVisible(true);
        this.nearbyBuilding = building;
      } else {
        if (this.nearbyBuilding) {
          scene.interactHint.setVisible(false);
        }
        this.nearbyBuilding = null;
      }
    }
  }

  /**
   * 处理F键交互 — 进入/离开子场景
   * @returns {boolean} 是否消耗了此次F键事件
   */
  handleFKeyInteraction() {
    if (this._transitioning) return false;

    if (this.isInSubScene()) {
      // 在子场景中：检查是否在出口区域
      const scene = this.scene;
      const effectiveScale = this.getEffectiveScale();
      const tile = COORD.toTile(scene.player.x / effectiveScale, scene.player.y / effectiveScale);
      if (this.isAtExitZone(tile.col, tile.row)) {
        this.exitSubScene();
        return true;
      }
    } else {
      // 在主地图中：检查是否接近建筑入口
      if (this.nearbyBuilding) {
        this.enterSubScene(this.nearbyBuilding.subSceneId);
        return true;
      }
    }
    return false;
  }
}
