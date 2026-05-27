/**
 * 可视化碰撞编辑器 —— 按 E 键进入编辑模式
 * 功能：涂画/擦除碰撞格、拖拽 NPC 定位、WASD 滚动视角
 * 数据持久化到 localStorage (editor_collision_map / editor_npc_positions)
 * @module scenes/modules/CollisionEditor
 */

import { GAME, COORD } from '../../config.js';
import { MAP_SCALE, MAP_COLS, MAP_ROWS } from './MapGenerator.js';

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
    this.isBrushPainting = false;
    this.brushMode = null;
    this.lastBrushTile = null;
    this.editCamFreeScroll = false;
  }

  /** 初始化编辑器资源 */
  init(delayedCall) {
    // 网格 + 碰撞高亮显示层
    this.editGridGraphics = this.scene.add.graphics().setDepth(50).setScrollFactor(1);

    // 编辑器 HUD
    this.editHUD = this.scene.add.container(0, 0).setDepth(1000).setScrollFactor(0).setVisible(false);

    const hudBg = this.scene.add.graphics();
    hudBg.fillStyle(0x1a1820, 0.95);
    hudBg.fillRoundedRect(-200, -30, 400, 60, 8);
    hudBg.lineStyle(2, 0xd4b896, 0.6);
    hudBg.strokeRoundedRect(-200, -30, 400, 60, 8);
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

    this.editHUD.setVisible(true);
    this.editHUD.setPosition(this.scene.cameras.main.width / 2, 40);
    this.refreshHUD();
    this.drawGrid();
    console.log('[Editor] 已进入编辑模式 — WASD滚动视角 | 左键:切换碰撞 | 拖拽:NPC');
  }

  /** 退出编辑模式 */
  _exitEditMode() {
    // 自动保存
    this.scene._saveToLocalStorage();
    console.log('[Editor] 碰撞和NPC位置已自动保存');

    // 拖拽中的 NPC 吸附到格子中心
    if (this.draggedNPC) {
      const gs = this.scene;
      const tile = COORD.toTile(this.draggedNPC.x / MAP_SCALE, this.draggedNPC.y / MAP_SCALE);
      const { x: cx, y: cy } = COORD.toPixelCenter(tile.col, tile.row);
      this.draggedNPC.x = cx * MAP_SCALE;
      this.draggedNPC.y = cy * MAP_SCALE;
      const idx = gs.npcs.indexOf(this.draggedNPC);
      if (idx >= 0 && gs.npcBubbles[idx]) {
        gs.npcBubbles[idx].setPosition(this.draggedNPC.x, this.draggedNPC.y - 22);
      }
      this.draggedNPC = null;
    }

    this.editCamFreeScroll = false;
    this.scene.inputLocked = false;

    this.editHUD.setVisible(false);
    if (this.editGridGraphics) this.editGridGraphics.clear();
    console.log('[Editor] 已退出编辑模式 | inputLocked:', this.scene.inputLocked);
  }

  /** 刷新 HUD 文字 */
  refreshHUD() {
    const count = Object.keys(this.scene._collisionMap).length;
    const mode = this.draggedNPC
      ? '拖拽NPC中...'
      : this.isBrushPainting
        ? (this.brushMode === 'erase' ? '🧹 擦除中(拖动)' : '🖌️ 涂画中(拖动)')
        : 'WASD:滚动 | 左键:单击/拖动画笔 | S:保存 | C:清除';
    this.editHUDText.setText(`[碰撞编辑模式]  碰撞格: ${count}\n${mode}`);
  }

  /** 绘制网格和碰撞区域 */
  drawGrid() {
    const g = this.editGridGraphics;
    if (!g) return;
    g.clear();

    const gridPx = TILE * MAP_SCALE;
    const mapW = this.scene._mapBounds ? this.scene._mapBounds.w : MAP_COLS * gridPx;
    const mapH = this.scene._mapBounds ? this.scene._mapBounds.h : MAP_ROWS * gridPx;
    const cols = Math.ceil(mapW / gridPx);
    const rows = Math.ceil(mapH / gridPx);

    // 1. 浅色网格线
    g.lineStyle(1, 0xffffff, 0.12);
    for (let c = 0; c <= cols; c++) {
      g.moveTo(c * gridPx, 0); g.lineTo(c * gridPx, mapH);
    }
    for (let r = 0; r <= rows; r++) {
      g.moveTo(0, r * gridPx); g.lineTo(mapW, r * gridPx);
    }

    // 2. 碰撞格子（红色半透明）
    for (const key of Object.keys(this.scene._collisionMap)) {
      const [c, r] = key.split('_').map(Number);
      g.fillStyle(0xff3333, 0.35);
      g.fillRect(c * gridPx, r * gridPx, gridPx, gridPx);
      g.lineStyle(2, 0xff6666, 0.8);
      g.strokeRect(c * gridPx, r * gridPx, gridPx, gridPx);
    }

    // 3. NPC 位置标记（青色）
    for (const npc of this.scene.npcs) {
      const tile = COORD.toTile(npc.x / MAP_SCALE, npc.y / MAP_SCALE);
      const cx = tile.col * gridPx + gridPx / 2;
      const cy = tile.row * gridPx + gridPx / 2;
      g.fillStyle(0x00ffff, 0.4);
      g.fillCircle(cx, cy, gridPx * 0.4);
      g.lineStyle(2, 0x00ffff, 0.9);
      g.strokeCircle(cx, cy, gridPx * 0.4);
    }
  }

  /** 获取鼠标指向的瓦片坐标 */
  getPointerTile(ptr) {
    const cam = this.scene.cameras.main;
    const worldX = ptr.x + cam.scrollX;
    const worldY = ptr.y + cam.scrollY;
    const gridPx = TILE * MAP_SCALE;
    const maxCol = Math.floor(this.scene._mapBounds.w / gridPx) - 1;
    const maxRow = Math.floor(this.scene._mapBounds.h / gridPx) - 1;
    return {
      col: Phaser.Math.Clamp(Math.floor(worldX / gridPx), 0, maxCol),
      row: Phaser.Math.Clamp(Math.floor(worldY / gridPx), 0, maxRow),
    };
  }

  /** 鼠标按下 */
  onPointerDown(ptr) {
    if (!this.editMode) return;
    const gs = this.scene;

    const tile = this.getPointerTile(ptr);

    // 1) 检查是否点中 NPC
    for (const npc of gs.npcs) {
      const dist = Phaser.Math.Distance.Between(
        ptr.x + gs.cameras.main.scrollX, ptr.y + gs.cameras.main.scrollY,
        npc.x, npc.y
      );
      if (dist < 32) {
        this.draggedNPC = npc;
        console.log(`[Editor] 开始拖拽 NPC: ${npc.getData('name')}`);
        return;
      }
    }

    // 2) 进入画笔拖拽模式
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

    if (this.isBrushPainting) {
      this.isBrushPainting = false;
      this.brushMode = null;
      this.lastBrushTile = null;
      gs._saveToLocalStorage();
      return;
    }

    if (this.draggedNPC) {
      const tile = COORD.toTile(this.draggedNPC.x / MAP_SCALE, this.draggedNPC.y / MAP_SCALE);
      console.log(`[Editor] NPC ${this.draggedNPC.getData('name')} 新位置: col=${tile.col}, row=${tile.row}`);

      const { x: cx, y: cy } = COORD.toPixelCenter(tile.col, tile.row);
      this.draggedNPC.x = cx * MAP_SCALE;
      this.draggedNPC.y = cy * MAP_SCALE;

      const idx = gs.npcs.indexOf(this.draggedNPC);
      if (idx >= 0 && gs.npcBubbles[idx]) {
        gs.npcBubbles[idx].setPosition(this.draggedNPC.x, this.draggedNPC.y - 22);
      }

      this.draggedNPC = null;
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
}


