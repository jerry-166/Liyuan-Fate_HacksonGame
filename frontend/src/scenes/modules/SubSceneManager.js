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
  SUBSCENES, ENTRY_DETECT_RANGE,
  generateBorderCollision, getCollisionKey, getNPCPositionsKey,
  SUB_MAP_SCALE,
} from './SubSceneConfig.js';
import { FALLBACK_NPC_SPRITE, NPC_SPRITES, addItemSparkle, loadImagesOnDemand, isTextureLoaded } from './GameUIHelpers.js';

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

    /** 子场景地图偏移量（居中用），主地图时为 null */
    this._subSceneOffset = null;
    /** 子场景背景填充矩形 */
    this._subSceneBg = null;
    /** 子场景地图边框（居中时显示边界感） */
    this._subSceneBorder = null;
    /** 子场景实际地图区域（用于边界约束） */
    this._subMapArea = null;
    /** 当前子场景的动态缩放因子（含 displayScale） */
    this._currentSubScale = SUB_MAP_SCALE;

    /** 动态入口区域列表（从编辑器 localStorage 加载） */
    this._entryZones = [];
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
   * 计算指定子场景的动态缩放因子（含 displayScale）
   * @param {Object} config - 子场景配置
   * @returns {number}
   */
  _calcSubScale(config) {
    return SUB_MAP_SCALE * (config?.displayScale || 1.0);
  }

  /**
   * 获取当前有效的缩放因子
   * 子场景内返回动态子场景缩放，主地图返回 MAP_SCALE
   */
  getEffectiveScale() {
    return this.isInSubScene() ? this._currentSubScale : MAP_SCALE;
  }

  // ==================== 建筑入口检测 ====================

  /**
   * 从 localStorage 重新加载编辑器配置的入口区域
   * 由 CollisionEditor 在保存入口区域时调用
   */
  _reloadEntryZones() {
    try {
      const saved = localStorage.getItem('editor_entry_zones');
      if (saved) {
        this._entryZones = JSON.parse(saved);
      } else {
        this._entryZones = [];
      }
    } catch (_) {
      this._entryZones = [];
    }
  }

  /**
   * 检测玩家是否接近建筑入口（基于编辑器配置的入口区域）
   * @param {number} playerCol - 玩家瓦片列
   * @param {number} playerRow - 玩家瓦片行
   * @returns {Object|null} 匹配的建筑入口配置 { subSceneId, name, entryZone }，或 null
   */
  checkBuildingProximity(playerCol, playerRow) {
    let best = null;
    let bestDist = Infinity;
    for (const entry of this._entryZones) {
      const z = entry.zone;
      if (!z) continue;
      // 检查玩家是否在入口区域内或曼哈顿距离 <= ENTRY_DETECT_RANGE
      for (let r = z.row; r < z.row + z.h; r++) {
        for (let c = z.col; c < z.col + z.w; c++) {
          const dist = Math.abs(playerCol - c) + Math.abs(playerRow - r);
          if (dist <= ENTRY_DETECT_RANGE && dist < bestDist) {
            bestDist = dist;
            best = {
              subSceneId: entry.subSceneId,
              name: entry.name,
              entryZone: z,
            };
          }
        }
      }
    }
    return best;
  }

  /**
   * 检测玩家是否在子场景出口区域
   * @param {number} playerCol - 玩家瓦片列（子场景坐标系）
   * @param {number} playerRow - 玩家瓦片行（子场景坐标系）
   * @returns {boolean}
   */
  isAtExitZone(playerCol, playerRow) {
    const ez = this._getEffectiveExitZone();
    if (!ez) return false;
    return playerCol >= ez.col && playerCol < ez.col + ez.w &&
           playerRow >= ez.row && playerRow < ez.row + ez.h;
  }

  /**
   * 获取当前子场景的有效出口区域（编辑器保存 > 配置默认）
   * @returns {{col:number,row:number,w:number,h:number}|null}
   */
  _getEffectiveExitZone() {
    const config = this.getCurrentConfig();
    if (!config) return null;
    // 优先读取编辑器保存的出口区域
    try {
      const allSaved = localStorage.getItem('editor_exit_zones');
      if (allSaved) {
        const exitZones = JSON.parse(allSaved);
        if (exitZones[config.id]) return exitZones[config.id];
      }
      // 兼容旧单键格式
      const saved = localStorage.getItem(`editor_exit_zone_${config.id}`);
      if (saved) return JSON.parse(saved);
    } catch (_) { /* fall through */ }
    // 回退到配置默认
    return config.exitZone || null;
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
    // ★ 备份入口位置到 localStorage，防止 _savedWorldState 丢失
    this._backupEntryPosition(subSceneId);

    // 3. 摄像机淡出
    await this._fadeOut();

    // ★ 确保子场景地图图片已加载（懒加载：首次进入时自动下载）
    await this._ensureSubSceneMapLoaded(config);

    // 4. 销毁当前NPC/物品精灵
    this._destroyAllEntities();

    // 5. 切换地图
    this._switchToSubSceneMap(config);

    // 6. 加载子场景碰撞数据
    this._loadSubSceneCollision(config);

    // 7. 创建子场景NPC（支持存档恢复位置）
    this._createSubSceneNPCs(config, options?.storyNpcPositions);

    // 7.5 加载子场景专属物品
    this._createSubSceneItems(config);

    // 8. 放置玩家（存档恢复用指定位置，否则用出生点）
    const scale = this._currentSubScale;
    const off = this._subSceneOffset || { x: 0, y: 0 };
    if (options?.playerPos) {
      const { x, y } = COORD.toPixel(options.playerPos.col, options.playerPos.row);
      scene.player.x = off.x + x * scale;
      scene.player.y = off.y + y * scale;
    } else {
      this._placePlayerAtSpawn(config);
    }
    scene.player.setData('facing', 'up');

    // 9. 更新地图边界
    this._updateMapBounds(config);

    // 10. 设置当前子场景ID
    this.currentSubSceneId = subSceneId;

    // 11. 固定摄像机到原点（子场景边界=视口大小，不滚动）
    scene.cameras.main.setScroll(0, 0);

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

    // 2. 摄像机淡出
    await this._fadeOut();

    // 3. 销毁子场景NPC/物品精灵
    this._destroyAllEntities();

    // 4. 恢复主地图
    this._restoreWorldMap();

    // 5. 恢复碰撞数据
    this._restoreWorldCollision();

    // 6. 恢复NPC/物品
    this._restoreWorldEntities();

    // 7. 恢复玩家位置
    this._restorePlayerPosition();

    // 8. 更新地图边界
    this._restoreWorldBounds();

    // 9. ★ 摄像机立即聚焦玩家位置（避免渐变滑动导致的"卡住"错觉）
    if (scene.player && scene._mapBounds) {
      const cam = scene.cameras.main;
      cam.centerOn(scene.player.x, scene.player.y);
      cam.scrollX = Phaser.Math.Clamp(cam.scrollX, 0, Math.max(0, scene._mapBounds.w - cam.width));
      cam.scrollY = Phaser.Math.Clamp(cam.scrollY, 0, Math.max(0, scene._mapBounds.h - cam.height));
    }

    // 10. 清除子场景状态
    this.currentSubSceneId = null;

    // 11. 摄像机淡入
    await this._fadeIn();

    // 12. 解锁输入
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

    // 2. 销毁子场景 NPC/物品精灵
    this._destroyAllEntities();

    // 3. 销毁子场景地图图片、边框和背景，恢复主地图
    if (this._subSceneBg) { this._subSceneBg.destroy(); this._subSceneBg = null; }
    if (this._subSceneBorder) { this._subSceneBorder.destroy(); this._subSceneBorder = null; }
    if (scene.mapImage) scene.mapImage.destroy();
    this._subSceneOffset = null;
    scene.mapImage = scene.add.image(0, 0, 'town_worldmap').setOrigin(0, 0);
    scene.mapImage.setDepth(0).setScale(MAP_SCALE);

    // 4. 恢复主地图碰撞数据
    try {
      const saved = localStorage.getItem('editor_collision_map');
      scene._collisionMap = saved ? JSON.parse(saved) : {};
    } catch (_) {
      scene._collisionMap = {};
    }

    // 5. 恢复主地图边界
    this._restoreWorldBounds();

    // 6. 清除子场景状态
    this.currentSubSceneId = null;
    this._savedWorldState = null;
    this.nearbyBuilding = null;
    this._subMapArea = null;

    // 8. ★ 兜底：将玩家放回主地图可见位置
    //    优先级：localStorage 入口备份 > 编辑器出生点 > 默认位置
    if (scene.player) {
      let placed = false;
      // 尝试从入口位置备份恢复
      try {
        const entryBackup = localStorage.getItem('subscene_entry_position');
        if (entryBackup) {
          const p = JSON.parse(entryBackup);
          if (p.x != null && p.y != null) {
            scene.player.x = p.x;
            scene.player.y = p.y;
            placed = true;
          }
        }
      } catch (_) { /* ignore */ }
      if (!placed) {
        let spawnCol = 7, spawnRow = 5;
        try {
          const saved = localStorage.getItem('editor_player_start_position');
          if (saved) {
            const parsed = JSON.parse(saved);
            if (parsed.col != null && parsed.row != null) {
              spawnCol = parsed.col; spawnRow = parsed.row;
            }
          }
        } catch (_) { /* 使用默认位置 */ }
        const pos = COORD.toPixel(spawnCol, spawnRow);
        scene.player.x = pos.x * MAP_SCALE;
        scene.player.y = pos.y * MAP_SCALE;
      }
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

      // 场景物品（保存完整外观数据以便恢复）
      sceneItems: scene.sceneItems.map(item => ({
        itemId: item.getData('itemId'),
        name: item.getData('name'),
        x: item.x,
        y: item.y,
        emoji: item.text,
        size: parseInt(item.style.fontSize, 10) / MAP_SCALE,
        editorIdx: item.getData('editorIdx'),
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

  /** 仅清理子场景 UI（地图图、边框、背景），不销毁实体，不恢复主地图 */
  _cleanSubSceneUI() {
    if (this._subSceneBg) { this._subSceneBg.destroy(); this._subSceneBg = null; }
    if (this._subSceneBorder) { this._subSceneBorder.destroy(); this._subSceneBorder = null; }
    this._subSceneOffset = null;
    this.currentSubSceneId = null;
    this._transitioning = false;
    this._subMapArea = null;
    this.nearbyBuilding = null;
  }

  // ==================== 地图切换 ====================

  /**
   * 确保子场景地图图片已加载（首次进入时按需下载）
   * @param {Object} config - 子场景配置
   */
  async _ensureSubSceneMapLoaded(config) {
    const assets = [{ key: config.imageKey, path: config.imagePath }];
    if (config.hasStateSwitch && config.altImageKey) {
      assets.push({ key: config.altImageKey, path: config.altImagePath });
    }
    const pending = assets.filter(a => !isTextureLoaded(a.key));
    if (pending.length === 0) return;
    console.log(`[SubSceneManager] 按需加载子场景地图: ${pending.map(a => a.key).join(', ')}`);
    await loadImagesOnDemand(this.scene, pending);
  }

  /** 切换到子场景地图 */
  _switchToSubSceneMap(config) {
    const scene = this.scene;
    const cam = scene.cameras.main;

    // 移除旧地图和背景
    if (scene.mapImage) scene.mapImage.destroy();
    if (this._subSceneBg) { this._subSceneBg.destroy(); this._subSceneBg = null; }

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

    // 计算动态子场景缩放
    const dynScale = this._calcSubScale(config);
    this._currentSubScale = dynScale;

    // 计算地图显示尺寸和居中偏移
    const mapW = config.pixelW * dynScale;
    const mapH = config.pixelH * dynScale;
    const offsetX = Math.floor((cam.width - mapW) / 2);
    const offsetY = Math.floor((cam.height - mapH) / 2);
    this._subSceneOffset = { x: Math.max(0, offsetX), y: Math.max(0, offsetY) };

    // 同色系像素背景（覆盖整个视口，深度-1）
    // 生成 32x32 像素纹理平铺，模拟像素风格背景
    if (config.bgColor != null) {
      const texKey = `_bg_tex_${config.id}`;
      if (!scene.textures.exists(texKey)) {
        this._generatePixelBgTexture(scene, texKey, config.bgColor);
      }
      this._subSceneBg = scene.add.tileSprite(
        cam.width / 2, cam.height / 2, cam.width, cam.height, texKey
      ).setDepth(-1).setScrollFactor(0);
    }

    // 创建新地图，居中放置
    scene.mapImage = scene.add.image(this._subSceneOffset.x, this._subSceneOffset.y, imageKey)
      .setOrigin(0, 0);
    scene.mapImage.setDepth(0).setScale(dynScale);

    // 地图四周绘制细边框，强化居中边界感
    if (this._subSceneOffset.x > 0) {
      const border = scene.add.graphics().setDepth(1);
      border.lineStyle(1, config.bgColor, 0.5);
      border.strokeRect(
        this._subSceneOffset.x, this._subSceneOffset.y,
        mapW, mapH
      );
      this._subSceneBorder = border;
    }
  }

  /**
   * 生成同色系像素背景纹理（32x32 小块，通过亮度微调产生像素感）
   * @param {Phaser.Scene} scene
   * @param {string} key - 纹理 key
   * @param {number} color - 基础颜色 (0xRRGGBB)
   */
  _generatePixelBgTexture(scene, key, color) {
    const SIZE = 32;
    const canvas = scene.textures.createCanvas(key, SIZE, SIZE);
    const ctx = canvas.getContext();
    const imageData = ctx.createImageData(SIZE, SIZE);

    // 提取 RGB 分量
    const r0 = (color >> 16) & 0xff;
    const g0 = (color >> 8) & 0xff;
    const b0 = color & 0xff;

    for (let py = 0; py < SIZE; py++) {
      for (let px = 0; px < SIZE; px++) {
        const idx = (py * SIZE + px) * 4;
        // 像素块大小 4x4，每块内颜色一致
        const bx = Math.floor(px / 4);
        const by = Math.floor(py / 4);
        // 根据块位置产生 ±12 的亮度波动
        const seed = (bx * 7 + by * 13) % 17;
        const delta = (seed - 8) * 1.5; // range: -12 ~ +12
        imageData.data[idx]     = Math.max(0, Math.min(255, r0 + delta));
        imageData.data[idx + 1] = Math.max(0, Math.min(255, g0 + delta));
        imageData.data[idx + 2] = Math.max(0, Math.min(255, b0 + delta));
        imageData.data[idx + 3] = 255;
      }
    }
    ctx.putImageData(imageData, 0, 0);
    canvas.refresh();
  }

  /** 恢复主地图 */
  _restoreWorldMap() {
    const scene = this.scene;
    if (scene.mapImage) scene.mapImage.destroy();
    // 销毁子场景背景和边框
    if (this._subSceneBg) { this._subSceneBg.destroy(); this._subSceneBg = null; }
    if (this._subSceneBorder) { this._subSceneBorder.destroy(); this._subSceneBorder = null; }
    // 重置偏移
    this._subSceneOffset = null;
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

    // 出口区域移除碰撞（优先使用编辑器保存的出口区域）
    this._refreshExitZoneCollision(null);
  }

  /**
   * 刷新出口区域碰撞（移除出口区域的阻挡）
   * @param {{col,row,w,h}|null} ez - 出口矩形，null 时使用 _getEffectiveExitZone()
   */
  _refreshExitZoneCollision(ez) {
    const scene = this.scene;
    if (!ez) ez = this._getEffectiveExitZone();
    if (!ez) return;
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
    const scale = this._currentSubScale;

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

      const off = this._subSceneOffset || { x: 0, y: 0 };
      const cfg = NPC_SPRITES[ph.id] || FALLBACK_NPC_SPRITE;
      const { x: posX, y: posY } = COORD.toPixel(col, row);
      const startKey = `${cfg.prefix}_idle_down`;

      const sprite = scene.physics.add.sprite(off.x + posX * scale, off.y + posY * scale, startKey);
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
      const bubbleText = scene.add.text(sprite.x, sprite.y - 20 * scale, ph.greeting || '', {
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

  /** 加载子场景专属物品（从 localStorage 按格子坐标 + 居中偏移放置） */
  _createSubSceneItems(config) {
    const scene = this.scene;
    const off = this._subSceneOffset || { x: 0, y: 0 };
    const scale = this._currentSubScale;
    const itemKey = `editor_item_positions_${config.id}`;

    // 获取背包中已有的物品 ID，已收集的不再渲染
    let ownedItemIds = new Set();
    try {
      const ui = scene.scene.get('UIScene');
      if (ui && ui.inventory) {
        ui.inventory.forEach(i => {
          const id = i.id || i.item_id;
          if (id) ownedItemIds.add(id);
        });
      }
    } catch (_) { /* ignore */ }

    try {
      const saved = localStorage.getItem(itemKey);
      if (!saved) return;
      const items = JSON.parse(saved);
      if (!Array.isArray(items) || items.length === 0) return;

      let skipped = 0;
      items.forEach(item => {
        if (item.col == null || item.row == null) return;
        // ★ 已收集的物品不再渲染
        if (item.item_id && ownedItemIds.has(item.item_id)) {
          skipped++;
          return;
        }
        const pos = COORD.toPixel(item.col, item.row);
        const px = off.x + pos.x * scale;
        const py = off.y + pos.y * scale;

        const sprite = scene.add.text(px, py, item.emoji || '📦', {
          fontSize: `${(item.size || 20) * scale}px`,
        }).setOrigin(0.5).setDepth(90);

        sprite.setData('itemId', item.item_id || item.id || 'item_' + Math.random().toString(36).slice(2, 8));
        sprite.setData('name', item.name || '未知物品');
        sprite.setData('editorIdx', item._editorIdx ?? -1);

        scene.tweens.add({
          targets: sprite,
          y: py - 4 * scale,
          duration: 1200, yoyo: true, repeat: -1,
          ease: 'Sine.easeInOut',
        });

        // ★ 添加闪光效果
        addItemSparkle(scene, sprite);

        scene.sceneItems.push(sprite);
      });
      console.log(`[SubSceneManager] 子场景物品已加载: ${items.length} 个` + (skipped ? ` (跳过${skipped}个已收集)` : ''));
    } catch (e) {
      console.warn(`[SubSceneManager] 加载子场景物品失败 (${config.id}):`, e);
    }
  }

  // ==================== 玩家定位 ====================

  /** 放置玩家到子场景出生点（优先使用编辑器保存的位置） */
  _placePlayerAtSpawn(config) {
    const scene = this.scene;
    const off = this._subSceneOffset || { x: 0, y: 0 };
    const scale = this._currentSubScale;

    // 优先从 localStorage 加载编辑器保存的出生位置
    let col = config.playerSpawn.col, row = config.playerSpawn.row;
    try {
      const posKey = `editor_player_start_position_${config.id}`;
      const saved = localStorage.getItem(posKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.col != null && parsed.row != null) {
          col = parsed.col; row = parsed.row;
        }
      }
    } catch (_) { /* 使用默认位置 */ }

    const { x, y } = COORD.toPixel(col, row);
    scene.player.x = off.x + x * scale;
    scene.player.y = off.y + y * scale;
    scene.player.setData('facing', 'up');
  }

  /** 恢复玩家位置到主地图 — 优先级：savedWorldState > localStorage备份 > 默认出生点 */
  _restorePlayerPosition() {
    const scene = this.scene;
    if (this._savedWorldState) {
      scene.player.x = this._savedWorldState.playerX;
      scene.player.y = this._savedWorldState.playerY;
    } else {
      // 尝试从 localStorage 备份恢复（防止 _savedWorldState 被 forceExitSubScene 清除）
      let restored = false;
      try {
        const entryBackup = localStorage.getItem('subscene_entry_position');
        if (entryBackup) {
          const p = JSON.parse(entryBackup);
          if (p.x != null && p.y != null) {
            scene.player.x = p.x;
            scene.player.y = p.y;
            restored = true;
          }
        }
      } catch (_) { /* ignore */ }
      if (!restored) {
        // 最后兜底：编辑器出生点或默认位置
        let spawnCol = 7, spawnRow = 5;
        try {
          const saved = localStorage.getItem('editor_player_start_position');
          if (saved) {
            const parsed = JSON.parse(saved);
            if (parsed.col != null && parsed.row != null) {
              spawnCol = parsed.col; spawnRow = parsed.row;
            }
          }
        } catch (_) { /* ignore */ }
        const pos = COORD.toPixel(spawnCol, spawnRow);
        scene.player.x = pos.x * MAP_SCALE;
        scene.player.y = pos.y * MAP_SCALE;
      }
    }
  }

  /**
   * 备份进入子场景前的主地图玩家位置到 localStorage
   * 作为 _savedWorldState 丢失后的兜底方案
   */
  _backupEntryPosition(subSceneId) {
    const config = SUBSCENES[subSceneId];
    const scene = this.scene;
    try {
      // 优先保存玩家当前实际位置
      localStorage.setItem('subscene_entry_position', JSON.stringify({
        x: scene.player.x,
        y: scene.player.y,
      }));
      // 同时保存对应建筑的入口区域中心位置（二次兜底）
      if (config && config.mainMapEntryZone) {
        const z = config.mainMapEntryZone;
        const cc = Math.floor(z.col + z.w / 2);
        const cr = z.row + Math.floor(z.h / 2) + 1; // 入口南侧1格
        const { x, y } = COORD.toPixel(cc, cr);
        localStorage.setItem('subscene_entry_building', JSON.stringify({
          x: x * MAP_SCALE,
          y: y * MAP_SCALE,
        }));
      }
    } catch (_) { /* ignore */ }
  }

  // ==================== 地图边界 ====================

  /** 更新地图边界为视口大小（子场景居中，摄像机不滚动） */
  _updateMapBounds(config) {
    const scene = this.scene;
    const cam = scene.cameras.main;
    const off = this._subSceneOffset || { x: 0, y: 0 };
    const scale = this._currentSubScale;
    // 边界 = 视口尺寸，使摄像机固定不滚动
    scene._mapBounds = { w: cam.width, h: cam.height };
    // 保存地图区域供边界检查
    this._subMapArea = {
      x: off.x, y: off.y,
      w: config.pixelW * scale,
      h: config.pixelH * scale,
    };
  }

  /** 恢复主地图边界 — 以地图图片实际渲染尺寸为准，与 create() 保持一致 */
  _restoreWorldBounds() {
    const scene = this.scene;
    this._subMapArea = null; // 清除子场景地图区域
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

    // 恢复场景物品（使用保存的完整外观数据）
    saved.sceneItems.forEach(data => {
      const spSize = (data.size || 20) * MAP_SCALE;
      const sprite = scene.add.text(data.x, data.y, data.emoji || '📦', {
        fontSize: `${spSize}px`,
      }).setOrigin(0.5).setDepth(90);
      sprite.setData('itemId', data.itemId);
      sprite.setData('name', data.name);
      sprite.setData('editorIdx', data.editorIdx ?? -1);
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
    scene.mapImage.setDepth(0).setScale(this._currentSubScale);

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
      // 子场景内：检测出口区域（需减去居中偏移）
      const off = this._subSceneOffset || { x: 0, y: 0 };
      const adjX = scene.player.x - off.x;
      const adjY = scene.player.y - off.y;
      const tile = COORD.toTile(adjX / effectiveScale, adjY / effectiveScale);
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
        if (this.nearbyBuilding && !scene.currentNearbyNPC && !scene.currentNearbyItem) {
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
      // 在子场景中：检查是否在出口区域（需减去居中偏移）
      const scene = this.scene;
      const effectiveScale = this.getEffectiveScale();
      const off = this._subSceneOffset || { x: 0, y: 0 };
      const tile = COORD.toTile(
        (scene.player.x - off.x) / effectiveScale,
        (scene.player.y - off.y) / effectiveScale
      );
      if (this.isAtExitZone(tile.col, tile.row)) {
        this.exitSubScene();
        return true;
      }
    } else {
      // 在主地图中：检查是否接近建筑入口
      if (this.nearbyBuilding) {
        // 不传 playerPos，由 _placePlayerAtSpawn 使用编辑器保存的出生位置
        this.enterSubScene(this.nearbyBuilding.subSceneId);
        return true;
      }
    }
    return false;
  }
}
