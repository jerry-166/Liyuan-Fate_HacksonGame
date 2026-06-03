/**
 * TouchController — 移动端虚拟摇杆 + 触控按钮
 *
 * 提供：
 * - 左下角虚拟摇杆（拖拽控制移动方向）
 * - 右下角交互按钮（对话/拾取替代 F 键）
 *
 * 设计分辨率 1280x800，通过 Phaser 场景的 scaleManager 自动适配
 *
 * @module utils/TouchController
 */

import Phaser from 'phaser';
import { isMobileDevice } from './DeviceDetector.js';

/** 虚拟摇杆配置 */
const JOYSTICK = {
  baseRadius: 55,        // 底座半径（设计px）
  thumbRadius: 28,       // 摇杆头半径
  baseAlpha: 0.3,        // 底座透明度
  thumbAlpha: 0.5,       // 摇杆头透明度
  baseColor: 0x1a1a2e,
  thumbColor: 0xc4a882,
  borderColor: 0x887766,
};

/** 交互按钮配置 */
const ACTION_BTN = {
  radius: 36,            // 按钮半径（设计px）
  color: 0x2a2824,
  borderColor: 0xc4a882,
  alpha: 0.75,
};

export class TouchController {
  /**
   * @param {Phaser.Scene} scene - GameScene 实例
   */
  constructor(scene) {
    this.scene = scene;
    this.enabled = false;

    /** 摇杆状态 */
    this.joystick = {
      active: false,
      pointerId: null,
      baseX: 0,
      baseY: 0,
      dx: 0,
      dy: 0,
      magnitude: 0,
      angle: 0,
    };

    /** 交互按钮状态 */
    this.actionBtn = {
      active: false,
      pressed: false,
    };

    /** 图形对象引用 */
    this._gfx = {};

    // ★ 只在移动端创建触控 UI
    if (isMobileDevice()) {
      this.enabled = true;
      this._createUI();
    }
  }

  // ==================== 创建虚拟 UI ====================

  _createUI() {
    const s = this.scene;

    // ── 左下角：虚拟摇杆底座 ──
    const joyX = 110;
    const joyY = 800 - 110;
    const baseR = JOYSTICK.baseRadius;

    // 底座（固定的圆环）
    const baseGfx = s.add.graphics().setDepth(1000).setScrollFactor(0);
    baseGfx.fillStyle(JOYSTICK.baseColor, JOYSTICK.baseAlpha);
    baseGfx.fillCircle(joyX, joyY, baseR);
    baseGfx.lineStyle(2, JOYSTICK.borderColor, 0.4);
    baseGfx.strokeCircle(joyX, joyY, baseR);

    // 摇杆头
    const thumbGfx = s.add.graphics().setDepth(1001).setScrollFactor(0);
    thumbGfx.fillStyle(JOYSTICK.thumbColor, JOYSTICK.thumbAlpha);
    thumbGfx.fillCircle(joyX, joyY, JOYSTICK.thumbRadius);
    thumbGfx.lineStyle(1, JOYSTICK.borderColor, 0.3);
    thumbGfx.strokeCircle(joyX, joyY, JOYSTICK.thumbRadius);

    // 方向指示器（小三角）
    const arrowSize = 6;
    const arrowGfx = s.add.graphics().setDepth(1002).setScrollFactor(0);
    arrowGfx.fillStyle(0xffffff, 0.6);

    this._gfx.base = baseGfx;
    this._gfx.thumb = thumbGfx;
    this._gfx.arrow = arrowGfx;
    this._joyBaseX = joyX;
    this._joyBaseY = joyY;

    // ── 右下角：交互按钮 ──
    const btnX = 1280 - 100;
    const btnY = 800 - 120;
    const btnR = ACTION_BTN.radius;

    const btnGfx = s.add.graphics().setDepth(1000).setScrollFactor(0);
    this._drawActionBtn(btnGfx, btnX, btnY, btnR, false);

    const btnLabel = s.add.text(btnX, btnY, '互动', {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
      fontSize: '15px', color: '#c4a882',
    }).setOrigin(0.5).setDepth(1001).setScrollFactor(0);

    this._gfx.actionBtn = btnGfx;
    this._gfx.actionLabel = btnLabel;
    this._actionBtnX = btnX;
    this._actionBtnY = btnY;
    this._actionBtnR = btnR;

    // ★ 可拖拽的透明热区（覆盖整个屏幕下半部分用于摇杆）
    // 用大区域监听 pointer 事件
    const joyZone = s.add.rectangle(0, 400, 640, 400, 0x000000, 0)
      .setOrigin(0, 0).setDepth(999).setScrollFactor(0)
      .setInteractive({ useHandCursor: false, draggable: false });
    const actZone = s.add.rectangle(640, 400, 640, 400, 0x000000, 0)
      .setOrigin(0, 0).setDepth(999).setScrollFactor(0)
      .setInteractive({ useHandCursor: false, draggable: false });

    this._gfx.joyZone = joyZone;
    this._gfx.actZone = actZone;

    // ===== 摇杆事件 =====
    s.input.on('pointerdown', (pointer) => {
      if (pointer.x > 640) return; // 只在左半屏幕激活摇杆
      this.joystick.active = true;
      this.joystick.pointerId = pointer.id;
      this.joystick.baseX = pointer.x;
      this.joystick.baseY = pointer.y;
      this._joyBaseX = pointer.x;
      this._joyBaseY = pointer.y;

      // 移动底座到触摸位置
      this._gfx.base.setPosition(pointer.x - joyX, pointer.y - joyY);
      baseGfx.clear();
      baseGfx.fillStyle(JOYSTICK.baseColor, JOYSTICK.baseAlpha);
      baseGfx.fillCircle(pointer.x, pointer.y, baseR);
      baseGfx.lineStyle(2, JOYSTICK.borderColor, 0.4);
      baseGfx.strokeCircle(pointer.x, pointer.y, baseR);
    });

    s.input.on('pointermove', (pointer) => {
      if (!this.joystick.active || pointer.id !== this.joystick.pointerId) return;

      const dx = pointer.x - this.joystick.baseX;
      const dy = pointer.y - this.joystick.baseY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const clampedDist = Math.min(dist, baseR);

      if (dist > 0) {
        this.joystick.dx = (dx / dist) * (clampedDist / baseR);
        this.joystick.dy = (dy / dist) * (clampedDist / baseR);
        this.joystick.magnitude = clampedDist / baseR;
        this.joystick.angle = Math.atan2(dy, dx);
      }

      // 更新摇杆头位置
      const thumbX = this.joystick.baseX + (dist > 0 ? (dx / dist) * clampedDist : 0);
      const thumbY = this.joystick.baseY + (dist > 0 ? (dy / dist) * clampedDist : 0);

      thumbGfx.clear();
      thumbGfx.fillStyle(JOYSTICK.thumbColor, JOYSTICK.thumbAlpha);
      thumbGfx.fillCircle(thumbX, thumbY, JOYSTICK.thumbRadius);
      thumbGfx.lineStyle(1, JOYSTICK.borderColor, 0.3);
      thumbGfx.strokeCircle(thumbX, thumbY, JOYSTICK.thumbRadius);

      // 方向箭头
      arrowGfx.clear();
      if (dist > 5) {
        arrowGfx.fillStyle(0xffffff, 0.5);
        const ang = Math.atan2(dy, dx);
        const ax = thumbX + Math.cos(ang) * (JOYSTICK.thumbRadius + 4);
        const ay = thumbY + Math.sin(ang) * (JOYSTICK.thumbRadius + 4);
        arrowGfx.fillTriangle(
          ax + Math.cos(ang) * 8, ay + Math.sin(ang) * 8,
          ax + Math.cos(ang + 2.5) * 6, ay + Math.sin(ang + 2.5) * 6,
          ax + Math.cos(ang - 2.5) * 6, ay + Math.sin(ang - 2.5) * 6,
        );
      }
    });

    s.input.on('pointerup', (pointer) => {
      if (pointer.id === this.joystick.pointerId) {
        this.joystick.active = false;
        this.joystick.pointerId = null;
        this.joystick.dx = 0;
        this.joystick.dy = 0;
        this.joystick.magnitude = 0;

        // 重置摇杆头到中心
        thumbGfx.clear();
        thumbGfx.fillStyle(JOYSTICK.thumbColor, JOYSTICK.thumbAlpha);
        thumbGfx.fillCircle(this.joystick.baseX, this.joystick.baseY, JOYSTICK.thumbRadius);
        thumbGfx.lineStyle(1, JOYSTICK.borderColor, 0.3);
        thumbGfx.strokeCircle(this.joystick.baseX, this.joystick.baseY, JOYSTICK.thumbRadius);
        arrowGfx.clear();
      }
    });

    // ===== 交互按钮事件 =====
    actZone.on('pointerdown', (pointer) => {
      // 检查是否在按钮范围内
      const dx = pointer.x - btnX;
      const dy = pointer.y - btnY;
      if (dx * dx + dy * dy <= (btnR + 20) * (btnR + 20)) {
        this.actionBtn.pressed = true;
        this._drawActionBtn(btnGfx, btnX, btnY, btnR, true);
      }
    });

    s.input.on('pointerup', () => {
      if (this.actionBtn.pressed) {
        this.actionBtn.pressed = false;
        this.actionBtn.active = true; // 标记按钮被点击过
        this._drawActionBtn(btnGfx, btnX, btnY, btnR, false);
      }
    });

    console.log('[TouchController] 移动端触控 UI 已创建');
  }

  _drawActionBtn(gfx, x, y, r, pressed) {
    gfx.clear();
    const c = pressed ? 0xd4b896 : ACTION_BTN.color;
    const bc = pressed ? 0xe8d4a0 : ACTION_BTN.borderColor;
    gfx.fillStyle(c, ACTION_BTN.alpha);
    gfx.fillCircle(x, y, r);
    gfx.lineStyle(2, bc, 0.6);
    gfx.strokeCircle(x, y, r);
  }

  // ==================== 查询方法 ====================

  /**
   * 获取当前移动方向（-1 到 1，同时支持键盘和摇杆）
   * @returns {{ vx: number, vy: number, isMoving: boolean }}
   */
  getDirection() {
    if (!this.enabled) return { vx: 0, vy: 0, isMoving: false };

    if (this.joystick.active && this.joystick.magnitude > 0.1) {
      return {
        vx: this.joystick.dx,
        vy: this.joystick.dy,
        isMoving: true,
      };
    }

    return { vx: 0, vy: 0, isMoving: false };
  }

  /**
   * 检查交互按钮是否刚被按下（每帧调用一次后自动清除）
   * @returns {boolean}
   */
  isActionJustPressed() {
    if (!this.enabled) return false;
    if (this.actionBtn.active) {
      this.actionBtn.active = false;
      return true;
    }
    return false;
  }

  /** 显示/隐藏触控 UI */
  setVisible(visible) {
    for (const key of Object.keys(this._gfx)) {
      const obj = this._gfx[key];
      if (obj && typeof obj.setVisible === 'function') {
        obj.setVisible(visible);
      }
    }
  }

  /** 销毁触控 UI */
  destroy() {
    for (const key of Object.keys(this._gfx)) {
      const obj = this._gfx[key];
      if (obj && typeof obj.destroy === 'function') {
        obj.destroy();
      }
    }
    this._gfx = {};
    this.enabled = false;
  }
}
