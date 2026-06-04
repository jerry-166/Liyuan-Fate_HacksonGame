/**
 * 可视化碰撞编辑器 —— 按 E 键进入编辑模式
 * 功能：涂画/擦除碰撞格、拖拽 NPC 定位、WASD 滚动视角
 * 数据持久化到 localStorage (editor_collision_map / editor_npc_positions)
 * @module scenes/modules/CollisionEditor
 */

import { GAME, COORD } from '../../config.js';
import { MAP_SCALE, MAP_COLS, MAP_ROWS } from './MapGenerator.js';
import { EDITOR_ITEMS, SUBSCENE_LIST, SUBSCENES } from './SubSceneConfig.js';

const TILE = GAME.TILE_SIZE;

/**
 * 碰撞编辑器管理器
 * 附加到 GameScene 实例上，管理编辑器相关的所有状态和方法
 */
export class CollisionEditor {
  /**
   * @param {Phaser.Scene} scene - GameScene 实例
   */
  constructor(scene) {
    this.scene = scene;
    this.editMode = false;
    this.editGridGraphics = null;
    this.editHUD = null;
    this.editHUDText = null;
    this.draggedNPC = null;
    this.draggedItem = null;
    this.isBrushPainting = false;
    this.brushMode = null;
    this.lastBrushTile = null;
    this.editCamFreeScroll = false;

    // 物品选择器
    this.itemPickerOpen = false;       // 是否正在选择物品
    this.itemPickerIndex = 0;          // 当前高亮的物品索引

    // 入口区域编辑器（主地图专属）
    this.entryZoneMode = false;        // 是否在入口区域编辑模式
    this.entryZoneSubScene = null;     // 当前选择的子场景 { id, name }
    this.drawingEntryZone = false;     // 是否正在拖画入口区域
    this.entryZoneStart = null;        // 拖画起点 { col, row }
    this.entryZoneCurrent = null;      // 拖画当前点 { col, row }
    this.entryZones = [];              // 已保存的入口区域

    // 出口区域编辑器（子场景专属，每个子场景一个出口矩形）
    this.exitZoneMode = false;         // 是否在出口区域编辑模式
    this.drawingExitZone = false;      // 是否正在拖画出口区域
    this.exitZoneStart = null;         // 拖画起点 { col, row }
    this.exitZoneCurrent = null;       // 拖画当前点 { col, row }
    this.exitZones = {};               // 已保存的出口区域 { [subId]: { col, row, w, h } }

    // 出生点编辑
    this.spawnEditMode = false;        // 是否在出生点编辑模式（左键点击直接设置出生点）
  }

  /** 初始化编辑器资源 */
  init(delayedCall) {
    // 网格 + 碰撞高亮显示层
    this.editGridGraphics = this.scene.add.graphics().setDepth(50).setScrollFactor(1);

    // 编辑器 HUD
    this.editHUD = this.scene.add.container(0, 0).setDepth(1000).setScrollFactor(0).setVisible(false);

    const hudBg = this.scene.add.graphics();
    hudBg.fillStyle(0x1a1820, 0.95);
    hudBg.fillRoundedRect(-300, -32, 600, 64, 8);
    hudBg.lineStyle(2, 0xd4b896, 0.6);
    hudBg.strokeRoundedRect(-300, -32, 600, 64, 8);
    this.editHUD.add(hudBg);

    this.editHUDText = this.scene.add.text(0, 0, '', {
      fontFamily: '"Consolas", monospace',
      fontSize: '15px', color: '#d4b896',
      align: 'center', lineSpacing: 4,
    }).setOrigin(0.5);
    this.editHUD.add(this.editHUDText);

    // 绑定鼠标事件
    const input = this.scene.input;
    input.on('pointerdown', (ptr) => this.onPointerDown(ptr));
    input.on('pointermove', (ptr) => this.onPointerMove(ptr));
    input.on('pointerup', (ptr) => this.onPointerUp(ptr));

    console.log('[Editor] 初始化完成 — 按 [E] 进入编辑模式');
  }

  /** 切换编辑模式 */
  toggle() {
    this.editMode = !this.editMode;
    if (this.editMode) {
      this._enterEditMode();
    } else {
      this._exitEditMode();
    }
  }

  /** 进入编辑模式 */
  _enterEditMode() {
    this.scene.player.setVelocity(0, 0);
    this.editCamFreeScroll = true;

    // 关闭所有 UI 面板（背包/历史/暂停菜单），避免热键冲突
    this._closeAllUIPanels();

    // 入口区域仅主地图加载；子场景加载出口区域
    this._isMainMap = !this.scene.subSceneManager.currentSubSceneId;
    if (this._isMainMap) {
      this.loadEntryZones();
      this.exitZoneMode = false;
      this.drawingExitZone = false;
    } else {
      // 子场景：清空入口状态，加载出口区域
      this.entryZones = [];
      this.entryZoneMode = false;
      this.entryZoneSubScene = null;
      this.drawingEntryZone = false;
      this._loadExitZone();
    }

    this.editHUD.setVisible(true);
    this.editHUD.setPosition(this.scene.cameras.main.width / 2, 40);
    this.refreshHUD();
    this.drawGrid();
    console.log('[Editor] 已进入编辑模式 — WASD滚动 | 左键:画笔/拖拽 | I:物品 | Z:入口 | X:删除 | K:保存 | B:出生点');
  }

  /** 关闭所有 UI 面板，确保编辑模式独占控制权 */
  _closeAllUIPanels() {
    try {
      const ui = this.scene.scene.get('UIScene');
      if (!ui) return;
      // 关闭背包面板
      if (ui.backpackPanelVisible) {
        if (ui.showItemMode) ui.cancelShowItemMode();
        ui.toggleBackpackPanel();
      }
      // 关闭历史面板
      if (ui.historyPanelVisible) {
        ui.historyPanel.toggle();
      }
      // 关闭暂停菜单
      if (ui.pauseMenuVisible) {
        ui.togglePauseMenu();
      }
      // 关闭对话
      if (ui.dialogActive) {
        ui.closeDialog();
      }
    } catch (e) { /* ignore */ }
  }

  /** 退出编辑模式 */
  _exitEditMode() {
    // 自动保存
    this.scene._saveToLocalStorage();
    if (this._isMainMap) this._saveEntryZones();
    else this._saveExitZone(); // 子场景保存出口区域
    console.log('[Editor] 碰撞、NPC、物品和入口/出口区域已自动保存');

    // ★ 自动同步到后端文件系统，确保换浏览器后编辑器配置不丢失
    this.scene._syncEditorToBackend();

    const gs = this.scene;

    // 清理入口区域状态
    this.entryZoneMode = false;
    this.entryZoneSubScene = null;
    this.drawingEntryZone = false;
    this.entryZoneStart = null;
    this.entryZoneCurrent = null;
    this.draggedEntryZone = null;
    // 清理出口区域状态
    this.exitZoneMode = false;
    this.drawingExitZone = false;
    this.exitZoneStart = null;
    this.exitZoneCurrent = null;
    this.itemPickerOpen = false;
    this.spawnEditMode = false;
    this._clearEntryZoneLabels();

    // 拖拽中的 NPC 吸附到格子中心
    if (this.draggedNPC) {
      const { scale, offsetX, offsetY } = this._getEditorScale();
      const tile = COORD.toTile((this.draggedNPC.x - offsetX) / scale, (this.draggedNPC.y - offsetY) / scale);
      const { x: cx, y: cy } = COORD.toPixelCenter(tile.col, tile.row);
      this.draggedNPC.x = offsetX + cx * scale;
      this.draggedNPC.y = offsetY + cy * scale;
      const idx = gs.npcs.indexOf(this.draggedNPC);
      if (idx >= 0 && gs.npcBubbles[idx]) {
        gs.npcBubbles[idx].setPosition(this.draggedNPC.x, this.draggedNPC.y - 22);
      }
      this.draggedNPC = null;
    }

    // 拖拽中的物品吸附到格子中心
    if (this.draggedItem) {
      const { scale, offsetX, offsetY } = this._getEditorScale();
      const tile = COORD.toTile((this.draggedItem.x - offsetX) / scale, (this.draggedItem.y - offsetY) / scale);
      const { x: cx, y: cy } = COORD.toPixelCenter(tile.col, tile.row);
      this.draggedItem.x = offsetX + cx * scale;
      this.draggedItem.y = offsetY + cy * scale;
      // 重启浮动动画
      gs.tweens.killTweensOf(this.draggedItem);
      gs.tweens.add({
        targets: this.draggedItem,
        y: this.draggedItem.y - 4 * scale,
        duration: 1200, yoyo: true, repeat: -1,
        ease: 'Sine.easeInOut',
      });
      this.draggedItem = null;
    }

    this.editCamFreeScroll = false;
    this.scene.inputLocked = false;

    this.editHUD.setVisible(false);
    if (this.editGridGraphics) this.editGridGraphics.clear();
    console.log('[Editor] 已退出编辑模式 | inputLocked:', this.scene.inputLocked);
  }

  /** 获取当前场景的主角出生位置（优先 localStorage，否则配置默认值） */
  _getPlayerSpawnPos() {
    const gs = this.scene;
    const subId = gs.subSceneManager.currentSubSceneId;
    const posKey = subId
      ? `editor_player_start_position_${subId}`
      : 'editor_player_start_position';
    try {
      const saved = localStorage.getItem(posKey);
      if (saved) {
        const { col, row } = JSON.parse(saved);
        if (col != null && row != null) return { col, row };
      }
    } catch (_) { /* ignore */ }
    // 回退到配置默认值
    if (subId && SUBSCENES[subId]) {
      const cfg = SUBSCENES[subId];
      return { col: cfg.playerSpawn.col, row: cfg.playerSpawn.row };
    }
    // 主地图默认
    return { col: 44, row: 28 };
  }

  /** 获取当前场景的 NPC 出生位置（从 localStorage，不含配置默认值） */
  _getNPCSpawnPositions() {
    const gs = this.scene;
    const subId = gs.subSceneManager.currentSubSceneId;
    const key = subId ? `editor_npc_positions_${subId}` : 'editor_npc_positions';
    try {
      const saved = localStorage.getItem(key);
      if (saved) return JSON.parse(saved);
    } catch (_) { /* ignore */ }
    return null;
  }

  /** 刷新 HUD 文字 */
  refreshHUD() {
    const count = Object.keys(this.scene._collisionMap).length;
    const itemCount = this.scene.sceneItems.length;
    const zoneCount = this._isMainMap ? this.entryZones.length : 0;
    const exitZoneStr = !this._isMainMap && this.exitZones[this.scene.subSceneManager.currentSubSceneId]
      ? ` [已设]` : (!this._isMainMap ? ' [未设]' : '');

    // 读取当前出生位置
    const spawn = this._getPlayerSpawnPos();
    const spawnInfo = spawn ? `  出生点:(${spawn.col},${spawn.row})` : '';

    let mode = '';
    if (this.itemPickerOpen) {
      const item = EDITOR_ITEMS[this.itemPickerIndex];
      mode = `🎯 选择物品: [${this.itemPickerIndex + 1}/${EDITOR_ITEMS.length}] ${item.emoji} ${item.name} | 数字键选 | Enter确认 | Esc取消`;
    } else if (this.exitZoneMode) {
      mode = '🚪 出口模式: 左键拖画出口范围 | Z退出';
    } else if (this.drawingExitZone) {
      mode = '🚪 拖画出口区域中...';
    } else if (this.entryZoneMode) {
      if (this.entryZoneSubScene) {
        mode = `🏠 入口模式: ${this.entryZoneSubScene.name} | 左键拖画范围 | 数字键切换子场景 | Z退出`;
      } else {
        mode = `🏠 入口模式: 请选择子场景 | 数字键1-${SUBSCENE_LIST.length}选择 | Z退出`;
      }
    } else if (this.drawingEntryZone) {
      mode = '🏠 拖画入口区域中...';
    } else if (this.spawnEditMode) {
      mode = '📍 出生点模式: 左键点击设置主角出生点 | B退出';
    } else if (this.draggedNPC) {
      mode = '拖拽NPC中... [松开鼠标定位]';
    } else if (this.draggedItem) {
      mode = '拖拽物品中... [松开鼠标定位]';
    } else if (this.isBrushPainting) {
      mode = (this.brushMode === 'erase' ? '🧹 擦除中(拖动)' : '🖌️ 涂画中(拖动)');
    } else {
      mode = this._isMainMap
        ? '左键:画笔/拖拽 | I:物品 Z:入口 C:清碰撞 K:保存 B:出生点 | E:退出编辑'
        : `左键:画笔/拖拽 | I:物品 Z:出口${exitZoneStr} C:清碰撞 K:保存 B:出生点 | E:退出编辑`;
    }
    this.editHUDText.setText(`[碰撞编辑模式]  碰撞格:${count}  物品:${itemCount}  入口:${zoneCount}${exitZoneStr}${spawnInfo}\n${mode}`);
  }

  /** 绘制网格和碰撞区域（自动适配主/子场景缩放和偏移） */
  drawGrid() {
    const g = this.editGridGraphics;
    if (!g) return;
    g.clear();

    const { gridPx, scale, offsetX, offsetY } = this._getEditorScale();
    const subMap = this.scene.subSceneManager._subMapArea;
    const mapW = subMap ? subMap.w : (this.scene._mapBounds ? this.scene._mapBounds.w : MAP_COLS * gridPx);
    const mapH = subMap ? subMap.h : (this.scene._mapBounds ? this.scene._mapBounds.h : MAP_ROWS * gridPx);
    const cols = Math.ceil(mapW / gridPx);
    const rows = Math.ceil(mapH / gridPx);

    // 1. 浅色网格线（偏移到子场景地图区域）
    g.lineStyle(1, 0xffffff, 0.12);
    for (let c = 0; c <= cols; c++) {
      g.moveTo(offsetX + c * gridPx, offsetY);
      g.lineTo(offsetX + c * gridPx, offsetY + mapH);
    }
    for (let r = 0; r <= rows; r++) {
      g.moveTo(offsetX, offsetY + r * gridPx);
      g.lineTo(offsetX + mapW, offsetY + r * gridPx);
    }

    // 2. 碰撞格子（红色半透明）
    for (const key of Object.keys(this.scene._collisionMap)) {
      const [c, r] = key.split('_').map(Number);
      g.fillStyle(0xff3333, 0.35);
      g.fillRect(offsetX + c * gridPx, offsetY + r * gridPx, gridPx, gridPx);
      g.lineStyle(2, 0xff6666, 0.8);
      g.strokeRect(offsetX + c * gridPx, offsetY + r * gridPx, gridPx, gridPx);
    }

    // 3. NPC 位置标记（青色）
    for (const npc of this.scene.npcs) {
      const tile = COORD.toTile((npc.x - offsetX) / scale, (npc.y - offsetY) / scale);
      const cx = offsetX + tile.col * gridPx + gridPx / 2;
      const cy = offsetY + tile.row * gridPx + gridPx / 2;
      g.fillStyle(0x00ffff, 0.4);
      g.fillCircle(cx, cy, gridPx * 0.4);
      g.lineStyle(2, 0x00ffff, 0.9);
      g.strokeCircle(cx, cy, gridPx * 0.4);
    }

    // 4. 物品位置标记（黄色）
    for (const item of this.scene.sceneItems) {
      const tile = COORD.toTile((item.x - offsetX) / scale, (item.y - offsetY) / scale);
      const cx = offsetX + tile.col * gridPx + gridPx / 2;
      const cy = offsetY + tile.row * gridPx + gridPx / 2;
      g.fillStyle(0xffcc00, 0.35);
      g.fillRect(cx - gridPx * 0.35, cy - gridPx * 0.35, gridPx * 0.7, gridPx * 0.7);
      g.lineStyle(2, 0xffcc00, 0.9);
      g.strokeRect(cx - gridPx * 0.35, cy - gridPx * 0.35, gridPx * 0.7, gridPx * 0.7);
      // 小标签
      g.fillStyle(0xffcc00, 1);
      g.fillCircle(cx, cy, 3);
    }

    // 4.5 出口区域标记（绿色半透明矩形）— 仅子场景可见
    if (!this._isMainMap) {
      const subId = this.scene.subSceneManager.currentSubSceneId;
      if (subId) {
        const ez = this.exitZones[subId];
        if (ez) {
          g.fillStyle(0x33cc66, 0.25);
          g.fillRect(offsetX + ez.col * gridPx, offsetY + ez.row * gridPx, ez.w * gridPx, ez.h * gridPx);
          g.lineStyle(2, 0x33cc66, 0.85);
          g.strokeRect(offsetX + ez.col * gridPx, offsetY + ez.row * gridPx, ez.w * gridPx, ez.h * gridPx);
          // 出口标签
          const lx = offsetX + (ez.col + ez.w / 2) * gridPx;
          const ly = offsetY + (ez.row + ez.h / 2) * gridPx;
          g.fillStyle(0x33cc66, 1);
          g.fillCircle(lx, ly, 5);
        }
      }
      // 绘制正在拖画的出口区域预览
      if (this.drawingExitZone && this.exitZoneStart && this.exitZoneCurrent) {
        const s = this.exitZoneStart;
        const e = this.exitZoneCurrent;
        const ezCol = Math.min(s.col, e.col);
        const ezRow = Math.min(s.row, e.row);
        const ezW = Math.abs(e.col - s.col) + 1;
        const ezH = Math.abs(e.row - s.row) + 1;
        g.fillStyle(0x33cc66, 0.15);
        g.fillRect(offsetX + ezCol * gridPx, offsetY + ezRow * gridPx, ezW * gridPx, ezH * gridPx);
        g.lineStyle(1.5, 0x33cc66, 0.6);
        g.strokeRect(offsetX + ezCol * gridPx, offsetY + ezRow * gridPx, ezW * gridPx, ezH * gridPx);
      }
    }

    // 5. 入口区域标记（紫色半透明矩形 + 标签）— 仅主地图可见
    if (this._isMainMap) {
      for (const zone of this.entryZones) {
        const z = zone.zone;
        g.fillStyle(0x9966ff, 0.25);
        g.fillRect(offsetX + z.col * gridPx, offsetY + z.row * gridPx, z.w * gridPx, z.h * gridPx);
        g.lineStyle(2, 0x9966ff, 0.85);
        g.strokeRect(offsetX + z.col * gridPx, offsetY + z.row * gridPx, z.w * gridPx, z.h * gridPx);
        // 标签文字（在区域中心）
        const lx = offsetX + (z.col + z.w / 2) * gridPx;
        const ly = offsetY + (z.row + z.h / 2) * gridPx;
        g.fillStyle(0x9966ff, 1);
        g.fillCircle(lx, ly, 4);
      }
    }

    // 6. 正在拖画中的入口区域（亮紫色虚线效果）
    if (this.drawingEntryZone && this.entryZoneStart && this.entryZoneCurrent) {
      const s = this.entryZoneStart;
      const e = this.entryZoneCurrent;
      const x1 = offsetX + Math.min(s.col, e.col) * gridPx;
      const y1 = offsetY + Math.min(s.row, e.row) * gridPx;
      const x2 = offsetX + Math.max(s.col, e.col) * gridPx + gridPx;
      const y2 = offsetY + Math.max(s.row, e.row) * gridPx + gridPx;
      g.fillStyle(0x9966ff, 0.3);
      g.fillRect(x1, y1, x2 - x1, y2 - y1);
      g.lineStyle(2, 0xcc99ff, 0.9);
      g.strokeRect(x1, y1, x2 - x1, y2 - y1);
    }

    // 7. 主角出生位置标记（绿色菱形，始终显示）
    this._drawSpawnMarker(g, gridPx, offsetX, offsetY);
    // 8. NPC 出生位置标记（橙色圆点）
    this._drawNPCSpawnMarkers(g, gridPx, offsetX, offsetY);
  }

  /** 绘制主角出生位置标记（绿色菱形，使用 _getPlayerSpawnPos 自动回退默认） */
  _drawSpawnMarker(g, gridPx, offsetX, offsetY) {
    const spawn = this._getPlayerSpawnPos();
    if (!spawn) return;
    const { col, row } = spawn;
    const cx = offsetX + col * gridPx + gridPx / 2;
    const cy = offsetY + row * gridPx + gridPx / 2;
    const half = gridPx * 0.45;
    // 菱形
    g.fillStyle(0x33ff66, 0.45);
    g.fillPoints([
      { x: cx, y: cy - half },
      { x: cx + half, y: cy },
      { x: cx, y: cy + half },
      { x: cx - half, y: cy },
    ], true);
    g.lineStyle(2, 0x33ff66, 0.95);
    g.strokePoints([
      { x: cx, y: cy - half },
      { x: cx + half, y: cy },
      { x: cx, y: cy + half },
      { x: cx - half, y: cy },
    ], true);
    // 十字准心
    g.lineStyle(1, 0x33ff66, 0.6);
    g.moveTo(cx - half * 0.7, cy); g.lineTo(cx + half * 0.7, cy);
    g.moveTo(cx, cy - half * 0.7); g.lineTo(cx, cy + half * 0.7);
    // 标签
    g.fillStyle(0x33ff66, 1);
    g.fillCircle(cx, cy, 2);
  }

  /** 绘制 NPC 出生位置标记（橙色圆点，仅当有 localStorage 编辑器数据时） */
  _drawNPCSpawnMarkers(g, gridPx, offsetX, offsetY) {
    const positions = this._getNPCSpawnPositions();
    if (!positions) return;
    for (const [npcId, pos] of Object.entries(positions)) {
      if (pos.col == null || pos.row == null) continue;
      const cx = offsetX + pos.col * gridPx + gridPx / 2;
      const cy = offsetY + pos.row * gridPx + gridPx / 2;
      const r = gridPx * 0.3;
      g.fillStyle(0xff8800, 0.4);
      g.fillCircle(cx, cy, r);
      g.lineStyle(1.5, 0xff8800, 0.8);
      g.strokeCircle(cx, cy, r);
      // 小文字标签
      g.fillStyle(0xff8800, 1);
      g.fillRect(cx - 1, cy - 1, 3, 3);
    }
  }

  /** 获取编辑器当前使用的缩放和偏移参数 */
  _getEditorScale() {
    const scene = this.scene;
    const off = scene.subSceneManager._subSceneOffset || { x: 0, y: 0 };
    const effectiveScale = scene.subSceneManager.getEffectiveScale();
    return {
      scale: effectiveScale,
      gridPx: TILE * effectiveScale,
      offsetX: off.x,
      offsetY: off.y,
    };
  }

  /** 获取鼠标指向的瓦片坐标（自动适配主/子场景缩放和偏移） */
  getPointerTile(ptr) {
    const cam = this.scene.cameras.main;
    const { gridPx, offsetX, offsetY } = this._getEditorScale();
    const worldX = ptr.x + cam.scrollX - offsetX;
    const worldY = ptr.y + cam.scrollY - offsetY;
    // 子场景使用实际地图尺寸计算最大行列；主场景使用 _mapBounds
    const subMap = this.scene.subSceneManager._subMapArea;
    const mapW = subMap ? subMap.w : (this.scene._mapBounds ? this.scene._mapBounds.w : MAP_COLS * gridPx);
    const mapH = subMap ? subMap.h : (this.scene._mapBounds ? this.scene._mapBounds.h : MAP_ROWS * gridPx);
    const maxCol = Math.floor(mapW / gridPx) - 1;
    const maxRow = Math.floor(mapH / gridPx) - 1;
    return {
      col: Phaser.Math.Clamp(Math.floor(worldX / gridPx), 0, maxCol),
      row: Phaser.Math.Clamp(Math.floor(worldY / gridPx), 0, maxRow),
    };
  }

  /** 检测鼠标是否在某个入口区域内，返回该入口区域对象或null */
  _getEntryZoneAtWorld(worldX, worldY) {
    const { gridPx, offsetX, offsetY } = this._getEditorScale();
    for (let i = this.entryZones.length - 1; i >= 0; i--) {
      const z = this.entryZones[i].zone;
      const zx = offsetX + z.col * gridPx;
      const zy = offsetY + z.row * gridPx;
      const zw = z.w * gridPx;
      const zh = z.h * gridPx;
      if (worldX >= zx && worldX <= zx + zw && worldY >= zy && worldY <= zy + zh) {
        return this.entryZones[i];
      }
    }
    return null;
  }

  /** 鼠标按下 */
  onPointerDown(ptr) {
    if (!this.editMode) return;
    const gs = this.scene;
    const worldX = ptr.x + gs.cameras.main.scrollX;
    const worldY = ptr.y + gs.cameras.main.scrollY;

    // 关闭物品选择器（点击其他地方）
    if (this.itemPickerOpen) {
      this.itemPickerOpen = false;
      this.refreshHUD();
      return;
    }

    // 出生点编辑模式：左键点击设置出生点
    if (this.spawnEditMode) {
      const tile = this.getPointerTile(ptr);
      this.setPlayerSpawnPoint(tile);
      this.drawGrid();
      this.refreshHUD();
      return;
    }

    // 出口区域模式：开始拖画（子场景）
    if (this.exitZoneMode) {
      const tile = this.getPointerTile(ptr);
      this.drawingExitZone = true;
      this.exitZoneStart = { col: tile.col, row: tile.row };
      this.exitZoneCurrent = { col: tile.col, row: tile.row };
      this.drawGrid();
      this.refreshHUD();
      return;
    }

    // 入口区域模式：开始拖画
    if (this.entryZoneMode && this.entryZoneSubScene) {
      const tile = this.getPointerTile(ptr);
      this.drawingEntryZone = true;
      this.entryZoneStart = { col: tile.col, row: tile.row };
      this.entryZoneCurrent = { col: tile.col, row: tile.row };
      this.drawGrid();
      this.refreshHUD();
      return;
    }

    // 1) 检查是否点中 NPC
    for (const npc of gs.npcs) {
      const dist = Phaser.Math.Distance.Between(worldX, worldY, npc.x, npc.y);
      if (dist < 32) {
        this.draggedNPC = npc;
        console.log(`[Editor] 开始拖拽 NPC: ${npc.getData('name')}`);
        this.refreshHUD();
        return;
      }
    }

    // 2) 检查是否点中物品
    for (const item of gs.sceneItems) {
      const dist = Phaser.Math.Distance.Between(worldX, worldY, item.x, item.y);
      if (dist < 28) {
        this.draggedItem = item;
        // 暂停物品的浮动动画，避免拖拽时抖动
        gs.tweens.killTweensOf(item);
        console.log(`[Editor] 开始拖拽物品: ${item.getData('name')}`);
        this.refreshHUD();
        return;
      }
    }

    // 3) 检查是否点中入口区域（可拖拽移动）— 非入口模式下也允许拖拽，仅主地图
    if (!this.entryZoneMode && this._isMainMap) {
      const hitZone = this._getEntryZoneAtWorld(worldX, worldY);
      if (hitZone) {
        const z = hitZone.zone;
        const { gridPx, offsetX, offsetY } = this._getEditorScale();
        this.draggedEntryZone = hitZone;
        this.dragOffsetX = worldX - (offsetX + z.col * gridPx);
        this.dragOffsetY = worldY - (offsetY + z.row * gridPx);
        console.log(`[Editor] 开始拖拽入口区域: ${hitZone.name}`);
        this.refreshHUD();
        return;
      }
    }

    // 4) 进入画笔拖拽模式
    const tile = this.getPointerTile(ptr);
    this.isBrushPainting = true;
    this.lastBrushTile = null;

    const key = `${tile.col}_${tile.row}`;
    if (gs._collisionMap[key]) {
      this.brushMode = 'erase';
      delete gs._collisionMap[key];
    } else {
      this.brushMode = 'paint';
      gs._collisionMap[key] = true;
    }
    this.drawGrid();
    this.refreshHUD();
  }

  /** 鼠标移动 */
  onPointerMove(ptr) {
    if (!this.editMode) return;
    const gs = this.scene;
    const cam = gs.cameras.main;

    // 入口区域拖画
    if (this.drawingEntryZone) {
      const tile = this.getPointerTile(ptr);
      this.entryZoneCurrent = { col: tile.col, row: tile.row };
      this.drawGrid();
      return;
    }

    // 出口区域拖画（子场景）
    if (this.drawingExitZone) {
      const tile = this.getPointerTile(ptr);
      this.exitZoneCurrent = { col: tile.col, row: tile.row };
      this.drawGrid();
      return;
    }

    // 入口区域拖拽移动
    if (this.draggedEntryZone) {
      const { gridPx, offsetX, offsetY } = this._getEditorScale();
      const worldX = ptr.x + cam.scrollX;
      const worldY = ptr.y + cam.scrollY;
      const newCol = Math.round((worldX - this.dragOffsetX - offsetX) / gridPx);
      const newRow = Math.round((worldY - this.dragOffsetY - offsetY) / gridPx);
      const subMap = gs.subSceneManager._subMapArea;
      const mapW = subMap ? subMap.w : gs._mapBounds.w;
      const mapH = subMap ? subMap.h : gs._mapBounds.h;
      const maxCol = Math.floor(mapW / gridPx) - this.draggedEntryZone.zone.w;
      const maxRow = Math.floor(mapH / gridPx) - this.draggedEntryZone.zone.h;
      this.draggedEntryZone.zone.col = Phaser.Math.Clamp(newCol, 0, maxCol);
      this.draggedEntryZone.zone.row = Phaser.Math.Clamp(newRow, 0, maxRow);
      this.drawGrid();
      this._drawEntryZoneLabels();
      return;
    }

    if (this.draggedNPC) {
      this.draggedNPC.x = ptr.x + cam.scrollX;
      this.draggedNPC.y = ptr.y + cam.scrollY;
      const idx = gs.npcs.indexOf(this.draggedNPC);
      if (idx >= 0 && gs.npcBubbles[idx]) {
        gs.npcBubbles[idx].setPosition(this.draggedNPC.x, this.draggedNPC.y - 22);
      }
      this.drawGrid();
      return;
    }

    if (this.draggedItem) {
      this.draggedItem.x = ptr.x + cam.scrollX;
      this.draggedItem.y = ptr.y + cam.scrollY;
      this.drawGrid();
      return;
    }

    if (this.isBrushPainting) {
      const tile = this.getPointerTile(ptr);
      const key = `${tile.col}_${tile.row}`;
      if (this.lastBrushTile && this.lastBrushTile === key) return;
      this.lastBrushTile = key;

      if (this.brushMode === 'paint') {
        gs._collisionMap[key] = true;
      } else {
        delete gs._collisionMap[key];
      }
      this.drawGrid();
      this.refreshHUD();
    }
  }

  /** 鼠标释放 */
  onPointerUp() {
    if (!this.editMode) return;
    const gs = this.scene;

    // 完成出口区域拖画（子场景）
    if (this.drawingExitZone) {
      this.drawingExitZone = false;
      if (this.exitZoneStart && this.exitZoneCurrent) {
        const s = this.exitZoneStart;
        const e = this.exitZoneCurrent;
        const zone = {
          col: Math.min(s.col, e.col),
          row: Math.min(s.row, e.row),
          w: Math.abs(e.col - s.col) + 1,
          h: Math.abs(e.row - s.row) + 1,
        };
        const subId = gs.subSceneManager.currentSubSceneId;
        this.exitZones[subId] = zone;
        console.log(`[Editor] 出口区域已设置: col=${zone.col} row=${zone.row} w=${zone.w} h=${zone.h}`);
        this._saveExitZone();
        // 同步更新 SubSceneManager 中的碰撞（移除出口区域碰撞）
        if (gs.subSceneManager) {
          gs.subSceneManager._refreshExitZoneCollision({ col: zone.col, row: zone.row, w: zone.w, h: zone.h });
        }
      }
      this.exitZoneStart = null;
      this.exitZoneCurrent = null;
      this.drawGrid();
      this.refreshHUD();
      return;
    }

    // 完成入口区域拖画
    if (this.drawingEntryZone) {
      this.drawingEntryZone = false;
      if (this.entryZoneStart && this.entryZoneCurrent) {
        const s = this.entryZoneStart;
        const e = this.entryZoneCurrent;
        const zone = {
          col: Math.min(s.col, e.col),
          row: Math.min(s.row, e.row),
          w: Math.abs(e.col - s.col) + 1,
          h: Math.abs(e.row - s.row) + 1,
        };
        // 过滤太小（至少1x1）的区域
        if (zone.w >= 1 && zone.h >= 1) {
          // 检测与已有区域的重叠
          const overlapped = this.entryZones.filter(existing => {
            const z = existing.zone;
            return !(zone.col + zone.w <= z.col ||
                     zone.col >= z.col + z.w ||
                     zone.row + zone.h <= z.row ||
                     zone.row >= z.row + z.h);
          });
          if (overlapped.length > 0) {
            console.warn(`[Editor] ⚠ 入口区域与 ${overlapped.length} 个已有区域重叠:`,
              overlapped.map(o => o.name).join(', '),
              '| 玩家在重叠区域时，将在最近的入口中二选一');
          }
          this.entryZones.push({
            subSceneId: this.entryZoneSubScene.id,
            name: this.entryZoneSubScene.name,
            zone,
          });
          console.log(`[Editor] 添加入口区域: ${this.entryZoneSubScene.name} col=${zone.col} row=${zone.row} w=${zone.w} h=${zone.h}`);
          this._saveEntryZones();
        }
      }
      this.entryZoneStart = null;
      this.entryZoneCurrent = null;
      this._drawEntryZoneLabels();
      this.drawGrid();
      this.refreshHUD();
      return;
    }

    // 完成入口区域拖拽
    if (this.draggedEntryZone) {
      this.draggedEntryZone = null;
      this._saveEntryZones();
      this.drawGrid();
      this.refreshHUD();
      return;
    }

    if (this.isBrushPainting) {
      this.isBrushPainting = false;
      this.brushMode = null;
      this.lastBrushTile = null;
      gs._saveToLocalStorage();
      return;
    }

    if (this.draggedNPC) {
      const { scale, offsetX, offsetY } = this._getEditorScale();
      const tile = COORD.toTile((this.draggedNPC.x - offsetX) / scale, (this.draggedNPC.y - offsetY) / scale);
      console.log(`[Editor] NPC ${this.draggedNPC.getData('name')} 新位置: col=${tile.col}, row=${tile.row}`);

      const { x: cx, y: cy } = COORD.toPixelCenter(tile.col, tile.row);
      this.draggedNPC.x = offsetX + cx * scale;
      this.draggedNPC.y = offsetY + cy * scale;

      const idx = gs.npcs.indexOf(this.draggedNPC);
      if (idx >= 0 && gs.npcBubbles[idx]) {
        gs.npcBubbles[idx].setPosition(this.draggedNPC.x, this.draggedNPC.y - 22);
      }

      this.draggedNPC = null;
      gs._saveToLocalStorage();
      this.drawGrid();
      this.refreshHUD();
      return;
    }

    if (this.draggedItem) {
      const { scale, offsetX, offsetY } = this._getEditorScale();
      const tile = COORD.toTile((this.draggedItem.x - offsetX) / scale, (this.draggedItem.y - offsetY) / scale);
      console.log(`[Editor] 物品 ${this.draggedItem.getData('name')} 新位置: col=${tile.col}, row=${tile.row}`);

      const { x: cx, y: cy } = COORD.toPixelCenter(tile.col, tile.row);
      this.draggedItem.x = offsetX + cx * scale;
      this.draggedItem.y = offsetY + cy * scale;

      // 重启浮动动画
      gs.tweens.killTweensOf(this.draggedItem);
      gs.tweens.add({
        targets: this.draggedItem,
        y: this.draggedItem.y - 4 * scale,
        duration: 1200, yoyo: true, repeat: -1,
        ease: 'Sine.easeInOut',
      });

      this.draggedItem = null;
      gs._saveToLocalStorage();
      this.drawGrid();
      this.refreshHUD();
    }
  }

  /** 更新编辑模式下的摄像机滚动 */
  updateCamera() {
    if (!this.scene._mapBounds) return;
    const gs = this.scene;
    const cam = gs.cameras.main;
    const { w: mapW, h: mapH } = gs._mapBounds;
    const scrollSpeed = 10;

    let dx = 0, dy = 0;
    if (gs.wasd.A.isDown || gs.cursors.left.isDown) dx = -scrollSpeed;
    else if (gs.wasd.D.isDown || gs.cursors.right.isDown) dx = scrollSpeed;
    if (gs.wasd.W.isDown || gs.cursors.up.isDown) dy = -scrollSpeed;
    else if (gs.wasd.S.isDown || gs.cursors.down.isDown) dy = scrollSpeed;

    cam.scrollX += dx;
    cam.scrollY += dy;
    cam.scrollX = Phaser.Math.Clamp(cam.scrollX, 0, Math.max(0, mapW - cam.width));
    cam.scrollY = Phaser.Math.Clamp(cam.scrollY, 0, Math.max(0, mapH - cam.height));
  }

  // ==================== 物品选择器 ====================

  /** 打开/切换物品选择器 */
  openItemPicker() {
    if (!this.editMode) return;
    if (this.itemPickerOpen) {
      // 已打开，循环到下一个物品
      this.itemPickerIndex = (this.itemPickerIndex + 1) % EDITOR_ITEMS.length;
    } else {
      this.itemPickerOpen = true;
      this.itemPickerIndex = 0;
      // 退出入口模式
      this.entryZoneMode = false;
      this.entryZoneSubScene = null;
    }
    this.refreshHUD();
  }

  /** 通过数字键选择物品（1-based） */
  selectItemByNumber(num) {
    if (!this.itemPickerOpen || !this.editMode) return;
    const idx = num - 1;
    if (idx >= 0 && idx < EDITOR_ITEMS.length) {
      this.itemPickerIndex = idx;
    }
    this.refreshHUD();
  }

  /** 确认放置当前选择的物品（自动适配缩放和偏移） */
  confirmItemPlace() {
    if (!this.itemPickerOpen || !this.editMode) return null;
    const itemDef = EDITOR_ITEMS[this.itemPickerIndex];
    this.itemPickerOpen = false;
    this.refreshHUD();
    // 放置到摄像机中心
    const gs = this.scene;
    const cam = gs.cameras.main;
    const { scale, offsetX, offsetY } = this._getEditorScale();
    const cx = cam.scrollX + cam.width / 2;
    const cy = cam.scrollY + cam.height / 2;
    const tile = COORD.toTile((cx - offsetX) / scale, (cy - offsetY) / scale);
    return {
      item_id: itemDef.item_id,
      name: itemDef.name,
      emoji: itemDef.emoji,
      size: itemDef.size,
      col: tile.col,
      row: tile.row,
    };
  }

  /** 取消物品选择 */
  cancelItemPicker() {
    if (!this.itemPickerOpen) return;
    this.itemPickerOpen = false;
    this.refreshHUD();
  }

  // ==================== 入口区域编辑器 ====================

  /** 切换入口/出口区域编辑模式（主地图:入口; 子场景:出口） */
  toggleEntryZoneMode() {
    if (!this.editMode) return;
    if (!this._isMainMap) {
      // 子场景 → 编辑出口区域
      this._toggleExitZoneMode();
      return;
    }
    this.entryZoneMode = !this.entryZoneMode;
    if (this.entryZoneMode) {
      this.itemPickerOpen = false;
      this.spawnEditMode = false;
      this.exitZoneMode = false;
      this.drawingExitZone = false;
      this.entryZoneSubScene = null;
      this.drawingEntryZone = false;
      this.entryZoneStart = null;
      this.entryZoneCurrent = null;
    } else {
      this.entryZoneSubScene = null;
      this.drawingEntryZone = false;
      this.entryZoneStart = null;
      this.entryZoneCurrent = null;
      this._drawEntryZoneLabels();
      this.drawGrid();
    }
    this.refreshHUD();
  }

  /** 切换出口区域编辑模式（子场景专用） */
  _toggleExitZoneMode() {
    this.exitZoneMode = !this.exitZoneMode;
    if (this.exitZoneMode) {
      this.itemPickerOpen = false;
      this.spawnEditMode = false;
      this.entryZoneMode = false;
      this.drawingEntryZone = false;
      this.drawingExitZone = false;
      this.exitZoneStart = null;
      this.exitZoneCurrent = null;
    } else {
      this.drawingExitZone = false;
      this.exitZoneStart = null;
      this.exitZoneCurrent = null;
      this.drawGrid();
    }
    this.refreshHUD();
  }

  // ==================== 出生点编辑 ====================

  /** 切换出生点编辑模式 */
  toggleSpawnEditMode() {
    if (!this.editMode) return;
    this.spawnEditMode = !this.spawnEditMode;
    if (this.spawnEditMode) {
      // 退出其他子模式
      this.itemPickerOpen = false;
      this.entryZoneMode = false;
      this.entryZoneSubScene = null;
      this.drawingEntryZone = false;
      this.exitZoneMode = false;
      this.drawingExitZone = false;
    }
    this.refreshHUD();
  }

  /** 立即将玩家当前位置设为出生点 */
  setPlayerSpawnPoint(pointerTile = null) {
    const gs = this.scene;
    let col, row;

    if (pointerTile) {
      // 传入指定瓦片坐标（出生点模式的点击）
      col = pointerTile.col;
      row = pointerTile.row;
    } else {
      // 使用玩家当前世界坐标（B 键快捷设置）
      const effectiveScale = gs.subSceneManager.getEffectiveScale();
      const off = gs.subSceneManager._subSceneOffset || { x: 0, y: 0 };
      const tile = COORD.toTile(
        (gs.player.x - off.x) / effectiveScale,
        (gs.player.y - off.y) / effectiveScale
      );
      col = tile.col;
      row = tile.row;
    }

    // 如果出生点模式，退出
    this.spawnEditMode = false;

    // 保存到 localStorage
    const subId = gs.subSceneManager.currentSubSceneId;
    const posKey = subId
      ? `editor_player_start_position_${subId}`
      : 'editor_player_start_position';
    try {
      localStorage.setItem(posKey, JSON.stringify({ col, row }));
    } catch (e) {
      console.warn('[Editor] 保存出生点失败:', e);
    }

    console.log(`[Editor] 出生点已设置: (${col}, ${row})`);
  }

  /** 通过数字键选择子场景标签 */
  selectSubSceneByNumber(num) {
    if (!this.entryZoneMode || !this.editMode) return;
    const idx = num - 1;
    if (idx >= 0 && idx < SUBSCENE_LIST.length) {
      this.entryZoneSubScene = SUBSCENE_LIST[idx];
      console.log(`[Editor] 入口区域标签: ${this.entryZoneSubScene.name}`);
    }
    this.refreshHUD();
  }

  /** 删除最近点击的入口区域 */
  deleteEntryZoneAt(ptr) {
    if (!this.editMode || this.entryZones.length === 0) return;
    const gs = this.scene;
    const worldX = ptr.x + gs.cameras.main.scrollX;
    const worldY = ptr.y + gs.cameras.main.scrollY;
    const { gridPx, offsetX, offsetY } = this._getEditorScale();

    for (let i = this.entryZones.length - 1; i >= 0; i--) {
      const z = this.entryZones[i].zone;
      const zx = offsetX + z.col * gridPx;
      const zy = offsetY + z.row * gridPx;
      const zw = z.w * gridPx;
      const zh = z.h * gridPx;
      if (worldX >= zx && worldX <= zx + zw && worldY >= zy && worldY <= zy + zh) {
        const removed = this.entryZones.splice(i, 1)[0];
        console.log(`[Editor] 删除入口区域: ${removed.name}`);
        this._saveEntryZones();
        this._drawEntryZoneLabels();
        this.drawGrid();
        this.refreshHUD();
        return;
      }
    }
  }

  /** 保存入口区域到 localStorage（仅主地图） */
  _saveEntryZones() {
    if (!this._isMainMap) return; // 子场景不操作入口区域
    try {
      localStorage.setItem('editor_entry_zones', JSON.stringify(this.entryZones));
    } catch (e) {
      console.warn('[Editor] 保存入口区域失败:', e);
    }
    // 同时更新 SubSceneManager 的缓存
    if (this.scene.subSceneManager) {
      this.scene.subSceneManager._reloadEntryZones();
    }
  }

  /** 从 localStorage 加载入口区域 */
  loadEntryZones() {
    try {
      const saved = localStorage.getItem('editor_entry_zones');
      if (saved) {
        this.entryZones = JSON.parse(saved);
        console.log(`[Editor] 已加载入口区域: ${this.entryZones.length} 个`);
      } else {
        this.entryZones = [];
      }
    } catch (e) {
      this.entryZones = [];
    }
    this._drawEntryZoneLabels();
  }

  /** 加载当前子场景的出口区域 */
  _loadExitZone() {
    const subId = this.scene.subSceneManager.currentSubSceneId;
    if (!subId) return;
    try {
      const allSaved = localStorage.getItem('editor_exit_zones');
      if (allSaved) {
        this.exitZones = JSON.parse(allSaved);
      } else {
        this.exitZones = {};
      }
      // 也检查旧的单键 layout
      if (!this.exitZones[subId]) {
        const saved = localStorage.getItem(`editor_exit_zone_${subId}`);
        if (saved) {
          this.exitZones[subId] = JSON.parse(saved);
          // 迁移到统一存储
          this._saveExitZone();
          localStorage.removeItem(`editor_exit_zone_${subId}`);
        }
      }
      if (this.exitZones[subId]) {
        console.log(`[Editor] 已加载出口区域: (${this.exitZones[subId].col},${this.exitZones[subId].row}) ${this.exitZones[subId].w}x${this.exitZones[subId].h}`);
      }
    } catch (e) {
      this.exitZones = {};
    }
  }

  /** 保存出口区域到 localStorage */
  _saveExitZone() {
    if (this._isMainMap) return;
    try {
      localStorage.setItem('editor_exit_zones', JSON.stringify(this.exitZones));
    } catch (e) {
      console.warn('[Editor] 保存出口区域失败:', e);
    }
  }

  /** 删除当前子场景的出口区域 */
  _deleteExitZone() {
    const subId = this.scene.subSceneManager.currentSubSceneId;
    if (!subId || !this.exitZones[subId]) return;
    delete this.exitZones[subId];
    this._saveExitZone();
    console.log('[Editor] 出口区域已删除');
  }

  /** 绘制入口区域标签文字 — 仅编辑模式 + 主地图下可见 */
  _drawEntryZoneLabels() {
    // 清理旧标签
    this._clearEntryZoneLabels();
    // 非编辑模式或子场景不显示入口标签
    if (!this.editMode || !this._isMainMap) return;

    const { gridPx, offsetX, offsetY } = this._getEditorScale();
    for (const zone of this.entryZones) {
      const z = zone.zone;
      const lx = offsetX + (z.col + z.w / 2) * gridPx;
      const ly = offsetY + (z.row + z.h / 2) * gridPx;
      const label = this.scene.add.text(lx, ly, `🏠${zone.name}`, {
        fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
        fontSize: '13px', color: '#d4b8ff',
        backgroundColor: '#2a2040dd',
        padding: { x: 4, y: 2 },
      }).setOrigin(0.5).setDepth(55);
      this._entryZoneLabels.push(label);
    }
  }

  /** 清理入口区域标签 */
  _clearEntryZoneLabels() {
    if (this._entryZoneLabels) {
      this._entryZoneLabels.forEach(t => t.destroy());
    }
    this._entryZoneLabels = [];
  }
}


