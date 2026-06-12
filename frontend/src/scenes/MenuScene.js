/**
 * MenuScene — 游戏主菜单场景
 *
 * 职责：提供游戏入口，管理主页 UI
 * - 标题画面（"梨园生死" + 粒子动画）
 * - "开始游戏" / "继续游戏" 按钮
 * - 存档列表面板（列出所有已保存的游戏会话）
 * - 全屏切换按钮
 *
 * ★ 支持窗口 resize / 全屏切换时自动重建 UI 布局（防抖 150ms）
 *
 * 通过 GameScene(savedSessionId) 传递存档 ID 来区分新游戏 vs 继续游戏
 *
 * @module scenes/MenuScene
 */

import Phaser from 'phaser';
import { getChapterLabel, GAME } from '../config.js';
import { getSessions, deleteSession, getEnding, getScripts } from '../api/client.js';
import { getAllPortraitAssets } from './modules/GameUIHelpers.js';
import { isMobileDevice, toggleFullscreen, isFullscreen } from '../utils/DeviceDetector.js';
import { EditorPanel } from './modules/EditorPanel.js';

// ========== UI 工具函数 ==========

/**
 * 创建菜单按钮容器
 */
function createMenuButton(scene, x, y, w, h, label, callback, disabled = false) {
  const container = scene.add.container(x, y);
  const textSize = Math.round(h * 0.54);

  const bg = scene.add.graphics();
  const drawBg = (hover) => {
    bg.clear();
    const baseColor = disabled ? 0x1a1a20 : (hover ? 0x3a3830 : 0x2a2820);
    const borderColor = disabled ? 0x443322 : (hover ? 0xd4b896 : 0x887766);
    bg.fillStyle(baseColor, 1);
    bg.fillRoundedRect(-w / 2, -h / 2, w, h, 6);
    bg.lineStyle(1, borderColor, disabled ? 0.3 : 0.7);
    bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 6);
  };
  drawBg(false);
  container.add(bg);

  const text = scene.add.text(0, 0, label, {
    fontFamily: '"KaiTi","SimSun",serif',
    fontSize: `${textSize}px`, color: disabled ? '#555544' : '#d4b896',
    letterSpacing: 8,
  }).setOrigin(0.5);
  container.add(text);

  if (!disabled) {
    const zone = scene.add.zone(0, 0, w, h).setInteractive({ useHandCursor: true });
    zone.on('pointerover', () => drawBg(true));
    zone.on('pointerout', () => drawBg(false));
    zone.on('pointerdown', callback);
    container.add(zone);
  } else {
    container.add(scene.add.text(0, 20, '（没有存档）', {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
      fontSize: '14px', color: '#443322',
    }).setOrigin(0.5));
  }

  return container;
}

/**
 * 创建小型操作按钮（存档列表内用）
 */
function createSmallButton(scene, x, y, w, h, label, color, callback) {
  const container = scene.add.container(x, y);
  const textSize = Math.round(h * 0.48);
  const bg = scene.add.graphics();
  const drawBtn = (hover) => {
    bg.clear();
    bg.fillStyle(hover ? 0x3a3834 : 0x2a2824, 1);
    bg.fillRoundedRect(0, 0, w, h, 4);
    bg.lineStyle(1, Phaser.Display.Color.HexStringToColor(color).color, hover ? 0.8 : 0.5);
    bg.strokeRoundedRect(0, 0, w, h, 4);
  };
  drawBtn(false);
  container.add(bg);

  container.add(scene.add.text(w / 2, h / 2, label, {
    fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
    fontSize: `${textSize}px`, color: color,
  }).setOrigin(0.5));

  const zone = scene.add.zone(w / 2, h / 2, w, h).setInteractive({ useHandCursor: true });
  zone.on('pointerover', () => drawBtn(true));
  zone.on('pointerout', () => drawBtn(false));
  zone.on('pointerdown', callback);
  container.add(zone);

  return container;
}

// ========== MenuScene ==========

export class MenuScene extends Phaser.Scene {
  constructor() {
    super({ key: 'MenuScene' });
  }

  // ==================== 生命周期 ====================

  create() {
    this._portraitsLoaded = false;
    this._archiveVisible = false;
    this._archiveLoading = false;  // ★ 防止重复打开存档面板
    this._archiveSessionData = null;
    this._resizeTimer = null;
    this._uiContainer = null;
    this.isMobile = isMobileDevice();

    // ★ 一次性的初始化（不随 resize 重建）
    this._preloadPortraits();
    this._bindFullscreenListener();
    this._bindWheelHandler();
    this.keyEsc = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);

    // ★ 内联编辑器面板
    this.editorPanel = new EditorPanel(this);
    this.editorPanel.createPanel();
    this.editorPanel.onScriptSelected((scriptId) => {
      // 选中剧本后关闭编辑器和选择器，重新打开选择器以刷新
      this._closeScriptSelector();
      this.time.delayedCall(400, () => this._showScriptSelector());
    });

    // 构建首次 UI
    const { width, height } = this.cameras.main;
    this._buildAll(width, height);

    // ★ 防抖的 resize 监听
    this.scale.on('resize', this._onResize, this);
  }

  shutdown() {
    this.scale.off('resize', this._onResize, this);
    if (this.editorPanel) { this.editorPanel.destroy(); this.editorPanel = null; }
    this._cleanupNameInput();
  }

  // ==================== Resize 处理（防抖） ====================

  /**
   * resize 回调 —— 防抖后执行重建
   */
  _onResize(gameSize) {
    if (this._resizeTimer) clearTimeout(this._resizeTimer);
    this._resizeTimer = setTimeout(() => {
      this._doResize(gameSize.width, gameSize.height);
    }, 150);
  }

  /**
   * 实际执行 resize 重建
   */
  _doResize(width, height) {
    // 保存状态
    const wasArchiveVisible = this.archivePanel && this.archivePanel.active && this.archivePanel.visible;
    const savedSessionData = this._archiveSessionData;

    // ★ 只销毁 UI 容器及其子树，不动 Phaser 内部对象
    this.tweens.killAll();
    if (this._uiContainer) {
      this._uiContainer.destroy(true);
      this._uiContainer = null;
    }

    // 清理引用
    this.archivePanel = null;
    this.archiveListContent = null;
    this.archiveHint = null;
    this._archiveListArea = null;
    this.archiveListContentHeight = 0;  // ★ 防止 resize 后残留旧值
    this.archiveScrollY = 0;
    this.allButtons = null;
    this._fsBtn = null;
    this.endingViewer = null;
    this._scriptSelectorContainer = null;
    this._scriptScrollContainer = null;
    this._nameDialogContainer = null;
    if (this._scriptWheelHandler) {
      this.input.off('wheel', this._scriptWheelHandler);
      this._scriptWheelHandler = null;
    }
    this._cleanupNameInput();

    // 重建
    this._buildAll(width, height);

    // 恢复存档面板
    if (wasArchiveVisible && savedSessionData) {
      this._archiveSessionData = savedSessionData;
      this.archivePanel.setVisible(true);
      this._renderArchiveList(savedSessionData);
      if (this.archiveHint) {
        this.archiveHint.setText(`共 ${savedSessionData.length} 个存档`);
      }
    }
  }

  // ==================== 一次性绑定 ====================

  _bindWheelHandler() {
    if (this._wheelHandler) return;
    this._wheelHandler = (_p, _go, _dx, deltaY) => {
      // ★ 仅检查面板是否存在且可见（移除 active 检查，resize 后的一帧内 active 可能为 false）
      if (!this.archivePanel || !this.archivePanel.visible) return;
      const area = this._archiveListArea;
      if (!area || !this.archiveListContentHeight || this.archiveListContentHeight <= area.h) return;
      // ★ 校验当前 listContent 的父容器确是当前 panel（防止 resize 前后引用错乱）
      const content = this.archiveListContent;
      if (!content) return;
      const maxScroll = this.archiveListContentHeight - area.h;
      this.archiveScrollY = Math.max(-maxScroll, Math.min(0, this.archiveScrollY - deltaY * 0.5));
      // ★ 直接设置 Y 坐标，不做 active 判断
      content.setY(area.baseY + this.archiveScrollY);
    };
    this.input.on('wheel', this._wheelHandler);
  }

  _bindFullscreenListener() {
    if (this._fsListenerBound) return;
    this._fsListenerBound = true;

    this._onFsChangeHandler = () => {
      if (this._fsBtn && this._fsBtn.active) {
        this._fsBtn.setText(isFullscreen() ? '⛶ 退出全屏' : '⛶ 全屏');
      }
    };
    document.addEventListener('fullscreenchange', this._onFsChangeHandler);
    document.addEventListener('webkitfullscreenchange', this._onFsChangeHandler);
    document.addEventListener('msfullscreenchange', this._onFsChangeHandler);
  }

  _preloadPortraits() {
    if (this._portraitsLoaded) return;
    this._portraitsLoaded = true;

    const allPortraits = getAllPortraitAssets();
    if (allPortraits.length > 0) {
      for (const asset of allPortraits) {
        this.load.image(asset.key, asset.path);
      }
      this.load.once('complete', () => {
        console.log(`[MenuScene] 立绘后台加载完成 (${allPortraits.length} 张)`);
      });
      this.load.start();
    }
  }

  // ==================== UI 构建 ====================

  /**
   * 构建全部 UI 元素到 _uiContainer 中
   */
  _buildAll(width, height) {
    // ★ 创建根 UI 容器，所有可重建元素放这里面
    this._uiContainer = this.add.container(0, 0);
    const addUI = (obj) => { this._uiContainer.add(obj); return obj; };

    const cx = width / 2;
    const scale = Math.min(width / GAME.WIDTH, height / GAME.HEIGHT);
    const titleFS = Math.round(72 * scale);
    const subFS = Math.round(20 * scale);
    const enFS = Math.round(15 * scale);
    const hintFS = Math.round(15 * scale);

    // 背景
    this.cameras.main.setBackgroundColor('#0d0d1a');

    // 顶部装饰纹样
    const topDeco = addUI(this.add.graphics());
    topDeco.lineStyle(1, 0x887766, 0.25);
    for (let i = 0; i < 8; i++) {
      topDeco.strokeCircle(cx + (i - 3.5) * 130, 30, 18);
      topDeco.strokeCircle(cx + (i - 3.5) * 130, 30, 8);
    }
    topDeco.lineBetween(0, 56, width, 56);

    const botDeco = addUI(this.add.graphics());
    botDeco.lineStyle(1, 0x887766, 0.2);
    botDeco.lineBetween(0, height - 56, width, height - 56);

    // 飘落粒子
    this._createParticles(width, height, addUI);

    // 标题
    addUI(this.add.text(cx, Math.round(100 * scale), '—— 一段关于传承与选择的故事 ——', {
      fontFamily: '"KaiTi","SimSun",serif', fontSize: `${subFS}px`, color: '#887766',
    }).setOrigin(0.5).setDepth(1).setAlpha(0));

    const titleY = Math.round(170 * scale);
    const title = addUI(this.add.text(cx, titleY, '梨园生死', {
      fontFamily: '"KaiTi","SimSun",serif', fontSize: `${titleFS}px`, color: '#d4b896',
      stroke: '#332a20', strokeThickness: Math.max(1, Math.round(3 * scale)),
    }).setOrigin(0.5).setDepth(1));

    addUI(this.add.text(cx, titleY + Math.round(60 * scale), 'PEKING OPERA · LIFE & DEATH', {
      fontFamily: 'serif', fontSize: `${enFS}px`, color: '#886644', letterSpacing: 6,
    }).setOrigin(0.5).setDepth(1));

    title.setAlpha(0).setScale(1.2);
    this.tweens.add({ targets: title, alpha: 1, scaleX: 1, scaleY: 1, duration: 1200, ease: 'Sine.easeOut' });

    // 按钮
    const btnW = Math.round(220 * scale), btnH = Math.round(48 * scale);
    const btnGap = Math.round(62 * scale);
    const btnY1 = Math.round(height / 2 + 40 * scale), btnY2 = btnY1 + btnGap;
    this.allButtons = [];

    const btnStart = createMenuButton(this, cx, btnY1, btnW, btnH, '开 始 游 戏', () => this._startNewGame());
    const btnContinue = createMenuButton(this, cx, btnY2, btnW, btnH, '继 续 游 戏', () => this._showArchives());
    this.allButtons.push(addUI(btnStart), addUI(btnContinue));

    // 按钮淡入容器
    const btnContainer = addUI(this.add.container(0, 0).setDepth(2).setAlpha(0));
    this.allButtons.forEach(b => btnContainer.add(b));
    this.tweens.add({ targets: btnContainer, alpha: 1, duration: 800, delay: 600, ease: 'Sine.easeIn' });

    // 存档列表面板
    this._createArchivePanel(width, height, scale, addUI);

    // 底部信息
    const mobileTip = this.isMobile ? '左半屏摇杆移动  ·  右下按钮互动' : 'WASD 移动  ·  F 交互  ·  H 对话历史  ·  数字键选择';
    addUI(this.add.text(cx, height - Math.round(80 * scale), mobileTip, {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
      fontSize: `${hintFS}px`, color: '#555544',
    }).setOrigin(0.5).setDepth(1));

    addUI(this.add.text(cx, height - Math.round(58 * scale), 'T-Hackathon 2026 · AI Narrative Game', {
      fontFamily: 'monospace', fontSize: `${Math.round(14 * scale)}px`, color: '#444433',
    }).setOrigin(0.5).setDepth(1));

    addUI(this.add.text(width - 16, height - 16, 'v0.3', {
      fontFamily: 'monospace', fontSize: `${Math.round(13 * scale)}px`, color: '#333322',
    }).setOrigin(1, 1).setDepth(1));

    // 全屏切换按钮
    this._createFullscreenBtn(width, scale, addUI);
  }

  // ==================== 粒子系统 ====================

  _createParticles(width, height, addUI) {
    this.fallingParticles = [];
    for (let i = 0; i < 14; i++) {
      const petal = addUI(this.add.text(
        Math.random() * width, Math.random() * height,
        ['◆', '◇', '❋', '·', '♢'][Math.floor(Math.random() * 5)],
        {
          fontFamily: 'serif',
          fontSize: `${6 + Math.random() * 8}px`,
          color: ['#887766', '#776655', '#997766', '#665544'][Math.floor(Math.random() * 4)],
        }
      ).setAlpha(0.15 + Math.random() * 0.2).setDepth(0));
      petal.speed = 0.3 + Math.random() * 0.5;
      petal.wobble = Math.random() * 2;
      petal.wobbleSpeed = 0.005 + Math.random() * 0.01;
      this.fallingParticles.push(petal);
    }
  }

  // ==================== 全屏按钮 ====================

  _createFullscreenBtn(width, scale, addUI) {
    const label = isFullscreen() ? '⛶ 退出全屏' : '⛶ 全屏';
    const btnFS = Math.round(15 * scale);
    this._fsBtn = addUI(this.add.text(width - 16, 16, label, {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
      fontSize: `${btnFS}px`, color: '#887766',
      backgroundColor: '#1a1a2ecc', padding: { x: 8, y: 4 },
    }).setOrigin(1, 0).setDepth(10).setInteractive({ useHandCursor: true }));
    this._fsBtn.on('pointerover', () => this._fsBtn.setColor('#c4a882'));
    this._fsBtn.on('pointerout', () => this._fsBtn.setColor('#887766'));
    this._fsBtn.on('pointerdown', () => {
      toggleFullscreen().then(() => this._updateFSBtnLabel());
    });
  }

  _updateFSBtnLabel() {
    if (!this._fsBtn || !this._fsBtn.active) return;
    this._fsBtn.setText(isFullscreen() ? '⛶ 退出全屏' : '⛶ 全屏');
  }

  // ==================== 存档面板 ====================

  /**
   * 创建存档列表面板（尺寸基于当前画布缩放）
   */
  _createArchivePanel(width, height, scale, addUI) {
    const panelW = Math.min(Math.round(780 * scale), width - 40);
    const panelH = Math.min(Math.round(520 * scale), height - 40);
    const panelX = (width - panelW) / 2;
    const panelY = (height - panelH) / 2 - Math.round(20 * scale);

    const titleFS = Math.round(28 * scale);
    const hintFS = Math.round(16 * scale);
    const tipFS = Math.round(14 * scale);

    const container = addUI(this.add.container(0, 0).setDepth(100).setVisible(false));
    this.archivePanel = container;
    this.archiveScrollY = 0;

    // 遮罩
    const mask = addUI(this.add.graphics());
    mask.fillStyle(0x000000, 0.75);
    mask.fillRect(0, 0, width, height);
    mask.setInteractive(new Phaser.Geom.Rectangle(0, 0, width, height), Phaser.Geom.Rectangle.Contains);
    mask.on('pointerdown', (pointer) => {
      if (pointer.x >= panelX && pointer.x <= panelX + panelW &&
          pointer.y >= panelY && pointer.y <= panelY + panelH) return;
      this._hideArchivePanel();
    });
    container.add(mask);

    // 面板背景
    const panelBg = addUI(this.add.graphics());
    panelBg.fillStyle(0x151520, 0.97);
    panelBg.fillRoundedRect(panelX, panelY, panelW, panelH, 12);
    panelBg.lineStyle(2, 0x887766, 0.6);
    panelBg.strokeRoundedRect(panelX, panelY, panelW, panelH, 12);
    container.add(panelBg);

    const titleText = addUI(this.add.text(width / 2, panelY + Math.round(32 * scale), '—— 戏梦存档 ——', {
      fontFamily: '"KaiTi","SimSun",serif', fontSize: `${titleFS}px`, color: '#d4b896',
    }).setOrigin(0.5));
    container.add(titleText);

    const divTopY = panelY + Math.round(60 * scale);
    const divGfx = addUI(this.add.graphics());
    divGfx.lineStyle(1, 0x887766, 0.3);
    divGfx.lineBetween(panelX + Math.round(40 * scale), divTopY, panelX + panelW - Math.round(40 * scale), divTopY);
    container.add(divGfx);

    const listTopY = panelY + Math.round(72 * scale);
    const listContent = addUI(this.add.container(0, listTopY));
    container.add(listContent);
    this.archiveListContent = listContent;

    const listAreaH = panelH - Math.round(130 * scale);
    this._archiveListArea = {
      x: panelX + Math.round(16 * scale),
      y: panelY + Math.round(66 * scale),
      w: panelW - Math.round(32 * scale),
      h: listAreaH,
      baseY: listTopY,
    };

    // 列表遮罩
    const maskTop = panelY + Math.round(56 * scale);
    const listMaskGfx = addUI(this.add.graphics());
    listMaskGfx.fillRect(panelX + Math.round(10 * scale), maskTop,
      panelW - Math.round(20 * scale), listAreaH + Math.round(16 * scale));
    listMaskGfx.setVisible(false);
    listContent.setMask(listMaskGfx.createGeometryMask());

    this.archiveHint = addUI(this.add.text(width / 2, panelY + panelH - Math.round(36 * scale), '', {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
      fontSize: `${hintFS}px`, color: '#887766',
    }).setOrigin(0.5));
    container.add(this.archiveHint);

    const bottomTip = addUI(this.add.text(width / 2, panelY + panelH - Math.round(12 * scale),
      '[ESC] 关闭  |  [Del] 删除选中  |  点击继续', {
        fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
        fontSize: `${tipFS}px`, color: '#665544',
      }).setOrigin(0.5).setDepth(101));
    container.add(bottomTip);
  }

  async _showArchives() {
    // ★ 防止短时间内重复调用（双击继续游戏按钮等）
    if (this._archiveLoading) return;
    this._archiveLoading = true;

    this.archivePanel.setVisible(true);
    this._archiveVisible = true;
    this.archiveListContent.removeAll(true);
    this.archiveScrollY = 0;
    this.archiveListContentHeight = 0;
    this.archiveHint.setText('加载存档列表中……');

    this.allButtons.forEach(btn => {
      if (btn.list) btn.list.forEach(child => { if (child.input) child.disableInteractive(); });
    });

    try {
      const data = await getSessions();
      const sessions = data.sessions || [];
      this._archiveSessionData = sessions;
      if (sessions.length === 0) {
        this.archiveHint.setText('没有存档记录');
        this._displayEmptyArchive();
      } else {
        this.archiveHint.setText(`共 ${sessions.length} 个存档`);
        this._renderArchiveList(sessions);
      }
    } catch (err) {
      console.warn('[MenuScene] 获取存档列表失败:', err);
      this.archiveHint.setText('无法连接到服务器');
      this._displayEmptyArchive();
    } finally {
      this._archiveLoading = false;
    }
  }

  _hideArchivePanel() {
    this.archivePanel.setVisible(false);
    this._archiveVisible = false;
    this.allButtons.forEach(btn => {
      if (btn.list) btn.list.forEach(child => { if (child.input) child.setInteractive({ useHandCursor: true }); });
    });
  }

  _displayEmptyArchive() {
    const { width, height } = this.cameras.main;
    const scale = Math.min(width / GAME.WIDTH, height / GAME.HEIGHT);
    const emptyFS = Math.round(18 * scale);
    const emptyText = this.add.text(width / 2, Math.round(120 * scale), '还没有存档，请先开始新游戏', {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
      fontSize: `${emptyFS}px`, color: '#666655',
    }).setOrigin(0.5);
    this.archiveListContent.add(emptyText);
  }

  _renderArchiveList(sessions) {
    const { width, height } = this.cameras.main;
    const scale = Math.min(width / GAME.WIDTH, height / GAME.HEIGHT);
    const panelW = Math.min(Math.round(780 * scale), width - 40);
    const panelX = (width - panelW) / 2;

    const nameFS = Math.round(17 * scale);
    const dateFS = Math.round(13 * scale);
    const rowH = Math.round(72 * scale);
    const rowGap = Math.round(76 * scale);
    const btnW = Math.round(52 * scale);
    const btnH = Math.round(26 * scale);

    const sorted = [...sessions].sort((a, b) =>
      (b.updated_at || b.created_at || '').localeCompare(a.updated_at || a.created_at || '')
    );

    const colW = panelW - Math.round(60 * scale);
    let y = Math.round(8 * scale);

    sorted.forEach((s) => {
      const chLabel = getChapterLabel(s.chapter_id);
      const date = (s.updated_at || s.created_at || '').slice(0, 16);
      const ended = s.game_ended ? ' [已结局]' : '';
      const scriptTag = s.script_name ? `「${s.script_name}」` : '';
      const label = `${s.player_name || '玩家'} · ${chLabel}${ended}`;

      const rowBg = this.add.graphics();
      rowBg.fillStyle(0x1a1a28, 1);
      rowBg.fillRoundedRect(panelX + Math.round(28 * scale), y - Math.round(4 * scale),
        colW - Math.round(28 * scale), rowH, Math.round(6 * scale));
      rowBg.lineStyle(1, 0x443322, 0.4);
      rowBg.strokeRoundedRect(panelX + Math.round(28 * scale), y - Math.round(4 * scale),
        colW - Math.round(28 * scale), rowH, Math.round(6 * scale));
      this.archiveListContent.add(rowBg);

      this.archiveListContent.add(this.add.text(panelX + Math.round(42 * scale), y + Math.round(6 * scale), label, {
        fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
        fontSize: `${nameFS}px`, color: s.game_ended ? '#886644' : '#d4b896',
      }));

      // Script name line
      if (scriptTag) {
        this.archiveListContent.add(this.add.text(panelX + Math.round(42 * scale), y + Math.round(30 * scale), scriptTag, {
          fontFamily: '"KaiTi","SimSun",serif',
          fontSize: `${dateFS}px`, color: '#887766',
        }));
      }

      const dateY = scriptTag ? y + Math.round(46 * scale) : y + Math.round(30 * scale);
      this.archiveListContent.add(this.add.text(panelX + Math.round(42 * scale), dateY, date || '未知时间', {
        fontFamily: 'monospace', fontSize: `${dateFS}px`, color: '#665544',
      }));

      const btnVOffset = Math.round((rowH - btnH) / 2);
      if (s.game_ended) {
        this.archiveListContent.add(
          createSmallButton(this, panelX + colW - Math.round(130 * scale), y + btnVOffset,
            btnW, btnH, '结局', '#669988',
            () => this._showEndingViewer(s.session_id))
        );
      } else {
        this.archiveListContent.add(
          createSmallButton(this, panelX + colW - Math.round(130 * scale), y + btnVOffset,
            btnW, btnH, '继续', '#889966',
            () => this._loadArchive(s.session_id))
        );
      }

      this.archiveListContent.add(
        createSmallButton(this, panelX + colW - Math.round(68 * scale), y + btnVOffset,
          btnW, btnH, '删除', '#aa6655',
          () => this._confirmDelete(s.session_id, s.player_name))
      );

      y += rowGap;
    });

    this.archiveListContentHeight = y;
    this.archiveScrollY = 0;
    this.archiveListContent.setY(this._archiveListArea.baseY);
  }

  async _confirmDelete(sessionId, playerName) {
    if (!confirm(`确定要删除「${playerName || '玩家'}」的存档吗？此操作不可撤销。`)) return;
    try {
      await deleteSession(sessionId);
      if (localStorage.getItem('__active_session__') === sessionId) {
        localStorage.removeItem('__active_session__');
      }
      localStorage.removeItem(`game_state_${sessionId}`);
      this.archiveListContent.removeAll(true);
      this._showArchives();
    } catch (err) {
      console.error('[MenuScene] 删除存档失败:', err);
      this.archiveHint.setText('删除失败，请重试');
    }
  }

  _loadArchive(sessionId) {
    if (!sessionId) return;
    localStorage.setItem('__active_session__', sessionId);
    this.cameras.main.fadeOut(600, 0, 0, 0);
    this.time.delayedCall(600, () => {
      this.scene.start('GameScene', { savedSessionId: sessionId });
    });
  }

  // ==================== 结局查看弹窗 ====================

  _createEndingViewer() {
    const { width, height } = this.cameras.main;
    this.endingViewer = this.add.container(0, 0).setDepth(200).setVisible(false);

    const dimBg = this.add.graphics();
    dimBg.fillStyle(0x000000, 1);
    dimBg.fillRect(0, 0, width, height);
    dimBg.setInteractive(new Phaser.Geom.Rectangle(0, 0, width, height), Phaser.Geom.Rectangle.Contains);
    dimBg.on('pointerdown', () => this._hideEndingViewer());
    this.endingViewer.add(dimBg);

    const margin = Math.round(Math.min(width, height) * 0.04);
    const bx = margin, by = margin;
    const bw = width - margin * 2, bh = height - margin * 2;

    this._evBox = { x: bx, y: by, w: bw, h: bh };

    const boxBg = this.add.graphics();
    boxBg.fillStyle(0x141420, 1);
    boxBg.fillRoundedRect(bx, by, bw, bh, 8);
    boxBg.lineStyle(1, 0xc4a882, 0.35);
    boxBg.strokeRoundedRect(bx, by, bw, bh, 8);
    this.endingViewer.add(boxBg);

    const hintFontSize = Math.max(12, Math.round(bh * 0.025));
    const hintY = by + bh - hintFontSize - 8;
    this.endingViewerHint = this.add.text(width / 2, hintY, '[ ESC 或点击空白处关闭 ]', {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
      fontSize: `${hintFontSize}px`, color: '#665544',
    }).setOrigin(0.5).setAlpha(0.7);
    this.endingViewer.add(this.endingViewerHint);
  }

  async _showEndingViewer(sessionId) {
    if (this.endingViewer) {
      this.endingViewer.destroy(true);
      this.endingViewer = null;
    }
    this._createEndingViewer();
    this.endingViewer.setVisible(true);
    this.archivePanel.setVisible(false);

    const { width, height } = this.cameras.main;
    const loadingText = this.add.text(width / 2, height / 2, '加载结局……', {
      fontFamily: '"KaiTi","SimSun",serif', fontSize: '24px', color: '#887766',
    }).setOrigin(0.5);
    this.endingViewer.add(loadingText);

    try {
      const data = await getEnding(sessionId);
      loadingText.destroy();
      this._renderEndingViewer(data);
    } catch (err) {
      console.error('[MenuScene] 获取结局失败:', err);
      loadingText.setText('无法加载结局数据');
    }

    this._endingEscHandler = (event) => {
      if (event.key === 'Escape') this._hideEndingViewer();
    };
    this.input.keyboard.on('keydown', this._endingEscHandler);
  }

  _hideEndingViewer() {
    if (this.endingViewer) this.endingViewer.setVisible(false);
    if (this._endingEscHandler) {
      this.input.keyboard.off('keydown', this._endingEscHandler);
      this._endingEscHandler = null;
    }
    this.archivePanel.setVisible(true);
  }

  _renderEndingViewer(data) {
    const { width, height } = this.cameras.main;
    const cx = width / 2;
    const { x: bx, y: by, w: bw, h: bh } = this._evBox;
    const pad = Math.round(Math.min(bw, bh) * 0.06);
    const wrapW = bw - pad * 2;

    const titleFS = Math.max(18, Math.round(bh * 0.05));
    const subFS = Math.max(11, Math.round(bh * 0.028));
    const bodyFS = Math.max(11, Math.round(bh * 0.024));
    const npcNameFS = Math.max(12, Math.round(bh * 0.026));
    const npcBodyFS = Math.max(11, Math.round(bh * 0.022));
    const lineGap = Math.max(4, Math.round(bh * 0.012));

    const v = this.endingViewer;

    v.add(this.add.text(cx, by + pad + 8, data.title || '梨园余韵', {
      fontFamily: '"KaiTi","SimSun",serif', fontSize: `${titleFS}px`, color: '#d4b896',
      align: 'center', wordWrap: { width: wrapW },
    }).setOrigin(0.5, 0));

    const titleH = Math.round(titleFS * 1.4);
    const typeLabel = data.type === 'accept_leader' ? '—— 梨园传承线 ——' : '—— 遗憾离别线 ——';
    v.add(this.add.text(cx, by + pad + 8 + titleH + 6, typeLabel, {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
      fontSize: `${subFS}px`, color: '#998866',
    }).setOrigin(0.5, 0));

    const divY = by + pad + 8 + titleH + 6 + Math.round(subFS * 1.4) + lineGap;
    const divGfx = this.add.graphics();
    divGfx.lineStyle(1, 0xc4a882, 0.3);
    divGfx.lineBetween(bx + pad, divY, bx + bw - pad, divY);
    v.add(divGfx);

    let y = divY + lineGap;

    if (data.key_moments && data.key_moments.length > 0) {
      for (const m of data.key_moments) {
        const t = this.add.text(cx, y, `「${m.description}」`, {
          fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
          fontSize: `${bodyFS}px`, color: '#a89878',
          lineSpacing: lineGap, align: 'center', wordWrap: { width: wrapW },
        }).setOrigin(0.5, 0);
        v.add(t);
        y += t.height + lineGap;
      }
      y += lineGap;
    }

    if (data.life_lesson) {
      const lessonText = this.add.text(cx, y, `"${data.life_lesson}"`, {
        fontFamily: '"KaiTi","SimSun",serif',
        fontSize: `${Math.max(13, Math.round(bh * 0.03))}px`, color: '#e8d8b8',
        align: 'center', wordWrap: { width: wrapW }, lineSpacing: lineGap,
      }).setOrigin(0.5, 0);
      v.add(lessonText);
      y += lessonText.height + lineGap * 2;
    }

    if (data.npc_endings && data.npc_endings.length > 0) {
      const npcSep = this.add.graphics();
      npcSep.lineStyle(1, 0xc4a882, 0.15);
      npcSep.lineBetween(bx + pad + 20, y, bx + bw - pad - 20, y);
      v.add(npcSep);
      y += lineGap;

      for (const ne of data.npc_endings) {
        const name = ne.name || ne.npc_id || '???';
        v.add(this.add.text(cx, y, `◆ ${name}`, {
          fontFamily: '"KaiTi","SimSun",serif',
          fontSize: `${npcNameFS}px`, color: '#c4a882',
        }).setOrigin(0.5, 0));
        y += npcNameFS + lineGap;
        const npcText = this.add.text(cx, y, ne.summary || '', {
          fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
          fontSize: `${npcBodyFS}px`, color: '#887766',
          lineSpacing: lineGap, align: 'center', wordWrap: { width: wrapW },
        }).setOrigin(0.5, 0);
        v.add(npcText);
        y += npcText.height + lineGap * 2;
      }
    }
  }

  _startNewGame() {
    const oldSession = localStorage.getItem('__active_session__');
    if (oldSession) {
      try { localStorage.removeItem(`__dialogue_history_${oldSession}`); } catch (_) {}
      localStorage.removeItem('__active_session__');
    }
    // Show script selection panel before starting
    this._showScriptSelector();
  }

  // ==================== 剧本选择面板 ====================

  async _showScriptSelector() {
    const { width, height } = this.cameras.main;
    const scale = Math.min(width / GAME.WIDTH, height / GAME.HEIGHT);

    // Disable main buttons
    this.allButtons.forEach(btn => {
      if (btn.list) btn.list.forEach(child => { if (child.input) child.disableInteractive(); });
    });

    // Create selector panel
    const panelW = Math.min(Math.round(520 * scale), width - 32);
    const panelH = Math.min(Math.round(520 * scale), height - 40);
    const panelX = (width - panelW) / 2;
    const panelY = (height - panelH) / 2;

    const container = this.add.container(0, 0).setDepth(200);
    this._scriptSelectorContainer = container;
    this._uiContainer.add(container);

    // Overlay (click to close — also cleans up name dialog)
    const overlay = this.add.graphics();
    overlay.fillStyle(0x000000, 0.75);
    overlay.fillRect(0, 0, width, height);
    overlay.setInteractive(new Phaser.Geom.Rectangle(0, 0, width, height), Phaser.Geom.Rectangle.Contains);
    overlay.on('pointerdown', () => {
      this._cleanupNameInput(); // ★ 关闭选择器前先清理名字输入 DOM
      this._closeScriptSelector();
    });
    container.add(overlay);

    // Panel bg — deeper, more refined
    const bg = this.add.graphics();
    bg.fillStyle(0x0d0d1e, 0.98);
    bg.fillRoundedRect(panelX, panelY, panelW, panelH, 14);
    bg.lineStyle(1.5, 0x665544, 0.5);
    bg.strokeRoundedRect(panelX, panelY, panelW, panelH, 14);
    // Inner glow border
    bg.lineStyle(1, 0x887766, 0.2);
    bg.strokeRoundedRect(panelX + 1, panelY + 1, panelW - 2, panelH - 2, 13);
    container.add(bg);

    // Title
    const titleFS = Math.round(24 * scale);
    const titleY = panelY + Math.round(36 * scale);
    container.add(this.add.text(width / 2, titleY, '—— 选择剧本 ——', {
      fontFamily: '"KaiTi","SimSun",serif', fontSize: `${titleFS}px`, color: '#d4b896',
    }).setOrigin(0.5));

    // Divider
    const divY = panelY + Math.round(62 * scale);
    const divGfx = this.add.graphics();
    divGfx.lineStyle(1, 0x665544, 0.35);
    divGfx.lineBetween(panelX + 30, divY, panelX + panelW - 30, divY);
    container.add(divGfx);

    // Close button
    const closeFS = Math.round(20 * scale);
    const closeBtn = this.add.text(panelX + panelW - Math.round(18 * scale), panelY + Math.round(12 * scale), '✕', {
      fontFamily: '"Microsoft YaHei",sans-serif',
      fontSize: `${closeFS}px`, color: '#554433',
    }).setOrigin(1, 0).setInteractive({ useHandCursor: true });
    closeBtn.on('pointerover', () => closeBtn.setColor('#c4a882'));
    closeBtn.on('pointerout', () => closeBtn.setColor('#554433'));
    closeBtn.on('pointerdown', () => this._closeScriptSelector());
    container.add(closeBtn);

    // ── Scrollable content area ──
    const contentX = panelX + Math.round(24 * scale);
    const contentY = panelY + Math.round(74 * scale);
    const contentW = panelW - Math.round(48 * scale);
    const contentH = panelH - Math.round(130 * scale);

    // Mask for scroll area
    const maskGfx = this.add.graphics();
    maskGfx.fillStyle(0xffffff, 1);
    maskGfx.fillRect(contentX, contentY, contentW, contentH);
    maskGfx.setVisible(false);
    container.add(maskGfx);

    const scrollContainer = this.add.container(0, 0);
    scrollContainer.setMask(maskGfx.createGeometryMask());
    container.add(scrollContainer);
    this._scriptScrollContainer = scrollContainer;
    this._scriptScrollY = 0;
    this._scriptScrollMax = 0;
    this._scriptContentH = contentH;

    // AI Create button at bottom
    const aiBtnW = Math.round(150 * scale), aiBtnH = Math.round(34 * scale);
    const aiBtn = this._createStyledButton(
      panelX + panelW - Math.round(20 * scale),
      panelY + panelH - Math.round(22 * scale),
      aiBtnW, aiBtnH, '✨ AI 创作新剧本', '#7b8cde',
      () => this._openEditorWorkshop('generate'),
      'right', scale
    );
    container.add(aiBtn);

    // ── Scroll wheel handler ──
    if (this._scriptWheelHandler) {
      this.input.off('wheel', this._scriptWheelHandler);
    }
    this._scriptWheelHandler = (_p, _go, _dx, deltaY) => {
      if (!this._scriptScrollContainer || !this._scriptSelectorContainer) return;
      const sensitivity = 0.6;
      this._scriptScrollY = Phaser.Math.Clamp(
        this._scriptScrollY + deltaY * sensitivity,
        0, Math.max(0, this._scriptScrollMax)
      );
      this._scriptScrollContainer.y = -this._scriptScrollY;
    };
    this.input.on('wheel', this._scriptWheelHandler);

    // Loading hint
    const loadingText = this.add.text(width / 2, panelY + panelH / 2, '加载剧本列表中……', {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
      fontSize: `${Math.round(15 * scale)}px`, color: '#665544',
    }).setOrigin(0.5);
    container.add(loadingText);

    // Load scripts
    try {
      const data = await getScripts();
      const scripts = data.scripts || [];
      loadingText.destroy();

      if (scripts.length === 0) {
        container.add(this.add.text(width / 2, panelY + panelH / 2 + Math.round(16 * scale), '暂无剧本，请使用 AI 创作新剧本', {
          fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
          fontSize: `${Math.round(14 * scale)}px`, color: '#665544',
        }).setOrigin(0.5));
        return;
      }

      this._renderScriptCards(scrollContainer, scripts, contentX, contentY, contentW, contentH, scale);
    } catch (err) {
      console.warn('[MenuScene] 加载剧本列表失败:', err);
      loadingText.setText('加载失败，将使用默认剧本');
      this.time.delayedCall(1500, () => {
        this._closeScriptSelector();
        this._startNewGameWithScript('liyuan_shengsi');
      });
    }
  }

  _renderScriptCards(container, scripts, cx, cy, rw, rh, scale) {
    const cardW = rw;
    const cardH = Math.round(76 * scale);
    const cardGap = Math.round(10 * scale);
    const nameFS = Math.round(16 * scale);
    const descFS = Math.round(12 * scale);
    const metaFS = Math.round(11 * scale);
    const pad = Math.round(16 * scale);

    scripts.forEach((s, i) => {
      const cardY = cy + i * (cardH + cardGap);
      const cardX = cx;

      // Card bg
      const card = this.add.graphics();
      const drawCard = (hover) => {
        card.clear();
        card.fillStyle(hover ? 0x1c1c32 : 0x141428, 1);
        card.fillRoundedRect(cardX, cardY, cardW, cardH, 8);
        card.lineStyle(1, hover ? 0x776655 : 0x443322, hover ? 0.6 : 0.35);
        card.strokeRoundedRect(cardX, cardY, cardW, cardH, 8);
      };
      drawCard(false);
      container.add(card);

      // Left accent bar
      const accent = this.add.graphics();
      accent.fillStyle(0xd4b896, 0.5);
      accent.fillRoundedRect(cardX + 2, cardY + cardH * 0.2, 3, cardH * 0.6, 1.5);
      container.add(accent);

      // Script name — with wordWrap fallback for long names on small screens
      const nameLimit = Math.floor(cardW * 0.85);
      const nameText = this.add.text(cardX + pad, cardY + Math.round(10 * scale),
        s.name.length > 10 ? s.name.slice(0, 9) + '…' : s.name, {
          fontFamily: '"KaiTi","SimSun",serif',
          fontSize: `${nameFS}px`, color: '#d4b896',
          wordWrap: { width: nameLimit - pad, useAdvancedWrap: true },
          maxLines: 1,
        });
      container.add(nameText);

      // Chapter/NPC tag - right aligned
      const tagText = this.add.text(cardX + cardW - pad, cardY + Math.round(12 * scale),
        `${s.chapter_count}章 · ${s.npc_count}角色`, {
          fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
          fontSize: `${metaFS}px`, color: '#554433',
        }).setOrigin(1, 0);
      container.add(tagText);

      // Description
      const descW = cardW - pad * 2;
      const descText = this.add.text(cardX + pad, cardY + Math.round(34 * scale),
        s.description || '暂无描述', {
          fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
          fontSize: `${descFS}px`, color: '#887766',
          wordWrap: { width: descW, useAdvancedWrap: true },
          maxLines: 2,
        });
      container.add(descText);

      // Author tag (bottom-right)
      if (s.author) {
        container.add(this.add.text(cardX + cardW - pad, cardY + cardH - pad * 0.6,
          s.author, {
            fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
            fontSize: `${Math.round(10 * scale)}px`, color: '#443322',
          }).setOrigin(1, 0));
      }

      // Click zone
      const zone = this.add.zone(cardX + cardW / 2, cardY + cardH / 2, cardW, cardH)
        .setInteractive({ useHandCursor: true });
      zone.on('pointerover', () => drawCard(true));
      zone.on('pointerout', () => drawCard(false));
      zone.on('pointerdown', () => {
        this._onScriptSelected(s.script_id, s.name);
      });
      container.add(zone);
    });

    // Update scroll max — content starts at cy, visible height is rh
    this._scriptScrollMax = Math.max(0,
      scripts.length * (cardH + cardGap) - cardGap - rh
    );
  }

  _createStyledButton(x, y, w, h, label, color, callback, align = 'center', scale = 1) {
    const container = this.add.container(0, 0);
    const offsetX = align === 'right' ? -w : align === 'left' ? 0 : -w / 2;
    const bg = this.add.graphics();
    const hexColor = parseInt(color.replace('#', ''), 16);
    const drawBg = (hover) => {
      bg.clear();
      bg.fillStyle(hover ? 0x2a2e50 : 0x1a1e3a, hover ? 1 : 0.9);
      bg.fillRoundedRect(x + offsetX, y - h / 2, w, h, 6);
      bg.lineStyle(1, hexColor, hover ? 0.9 : 0.5);
      bg.strokeRoundedRect(x + offsetX, y - h / 2, w, h, 6);
    };
    drawBg(false);
    container.add(bg);
    const fs = Math.round(h * 0.48);
    container.add(this.add.text(x + offsetX + w / 2, y, label, {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
      fontSize: `${fs}px`, color: color,
    }).setOrigin(0.5));
    const zone = this.add.zone(x + offsetX + w / 2, y, w, h).setInteractive({ useHandCursor: true });
    zone.on('pointerover', () => drawBg(true));
    zone.on('pointerout', () => drawBg(false));
    zone.on('pointerdown', callback);
    container.add(zone);
    return container;
  }

  _onScriptSelected(scriptId, scriptName) {
    // Show name input dialog
    this._showNameInputDialog(scriptId, scriptName);
  }

  _showNameInputDialog(scriptId, scriptName) {
    const { width, height } = this.cameras.main;
    const scale = Math.min(width / GAME.WIDTH, height / GAME.HEIGHT);

    // ★ 先彻底清理所有可能的残留 DOM input（包括上一轮的）
    this._cleanupNameInput();

    // Remove existing name dialog if any
    if (this._nameDialogContainer) {
      this._nameDialogContainer.destroy(true);
      this._nameDialogContainer = null;
    }

    const dW = Math.round(380 * scale), dH = Math.round(220 * scale);
    const dX = (width - dW) / 2, dY = (height - dH) / 2;
    const container = this.add.container(0, 0).setDepth(300);
    this._nameDialogContainer = container;
    this._uiContainer.add(container);

    const bg = this.add.graphics();
    bg.fillStyle(0x0d0d1e, 0.97);
    bg.fillRoundedRect(dX, dY, dW, dH, 10);
    bg.lineStyle(1.5, 0xd4b896, 0.6);
    bg.strokeRoundedRect(dX, dY, dW, dH, 10);
    container.add(bg);

    const fs = Math.round(16 * scale);
    container.add(this.add.text(width / 2, dY + Math.round(30 * scale),
      `开始「${scriptName}」`, {
        fontFamily: '"KaiTi","SimSun",serif', fontSize: `${fs + 2}px`, color: '#d4b896',
        wordWrap: { width: dW - Math.round(40 * scale), useAdvancedWrap: true },
        align: 'center',
      }).setOrigin(0.5));

    container.add(this.add.text(width / 2, dY + Math.round(68 * scale), '请输入你的名字', {
      fontFamily: '"Microsoft YaHei",sans-serif', fontSize: `${Math.round(14 * scale)}px`, color: '#887766',
    }).setOrigin(0.5));

    // ★ 计算 canvas 在视口中的实际位置（Phaser 缩放后 canvas 坐标 ≠ CSS 坐标）
    const canvas = this.sys.game.canvas;
    const canvasRect = canvas ? canvas.getBoundingClientRect() : { left: 0, top: 0, width, height };
    const cwRatio = canvasRect.width / width;   // canvas CSS 宽 / 逻辑宽
    const chRatio = canvasRect.height / height; // canvas CSS 高 / 逻辑高

    const inputLeft = canvasRect.left + dX * cwRatio + dW * 0.15 * cwRatio;
    const inputTop = canvasRect.top + dY * chRatio + dH * 0.44 * chRatio;
    const inputW = dW * 0.7 * cwRatio;
    const inputH = Math.round(38 * scale) * chRatio;

    // DOM input (overlay on canvas)
    const inputEl = document.createElement('input');
    inputEl.type = 'text';
    inputEl.value = '玩家';
    inputEl.maxLength = 12;
    inputEl.className = 'menu-name-input'; // ★ 添加 class 方便识别和清理
    inputEl.style.cssText = `
      position: fixed;
      left: ${inputLeft}px;
      top: ${inputTop}px;
      width: ${Math.max(100, inputW)}px;
      height: ${Math.max(26, inputH)}px;
      background: #111122;
      border: 1px solid #443322;
      border-radius: 6px;
      color: #d4b896;
      font-size: ${Math.max(12, Math.round(15 * scale))}px;
      font-family: "Microsoft YaHei", sans-serif;
      text-align: center;
      outline: none;
      padding: 0 10px;
      z-index: 9999;
      box-sizing: border-box;
    `;
    document.body.appendChild(inputEl);
    inputEl.focus();
    inputEl.select();
    this._activeInputEl = inputEl;

    // Shared callback for both button click and Enter key
    const doStartGame = () => {
      const name = (inputEl.value || '玩家').trim() || '玩家';
      inputEl.style.display = 'none';
      inputEl.blur();
      this._cleanupNameInput();
      this._closeScriptSelector();
      this._startNewGameWithScript(scriptId, name);
    };

    // Buttons — left: 开始游戏, right: 取消
    const btnW = Math.round(130 * scale), btnH = Math.round(36 * scale);
    const btnY = dY + dH - Math.round(34 * scale);
    const margin = Math.round(20 * scale);
    const confBtn = this._createStyledButton(
      dX + margin, btnY, btnW, btnH,
      '开始游戏', '#d4b896', doStartGame, 'left', scale
    );
    container.add(confBtn);

    const cancelBtn = this._createStyledButton(
      dX + dW - margin, btnY, btnW, btnH,
      '取消', '#665544', () => {
        this._cleanupNameInput();
        container.destroy(true);
        this._nameDialogContainer = null;
      }, 'right', scale
    );
    container.add(cancelBtn);

    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        doStartGame();
      }
      if (e.key === 'Escape') {
        this._cleanupNameInput();
        container.destroy(true);
        this._nameDialogContainer = null;
      }
    });
  }

  _cleanupNameInput() {
    // 清理当前追踪的 DOM input
    if (this._activeInputEl) {
      try {
        if (this._activeInputEl.parentNode) {
          this._activeInputEl.parentNode.removeChild(this._activeInputEl);
        }
      } catch (_) { /* already removed */ }
      this._activeInputEl = null;
    }
    // ★ 兜底：清理所有 class="menu-name-input" 的残留元素（防止引用丢失导致的 DOM 泄漏）
    try {
      const orphans = document.querySelectorAll('.menu-name-input');
      orphans.forEach(el => {
        if (el.parentNode) el.parentNode.removeChild(el);
      });
    } catch (_) { /* ignore */ }
  }

  _closeScriptSelector() {
    if (this._nameDialogContainer) {
      this._nameDialogContainer.destroy(true);
      this._nameDialogContainer = null;
    }
    if (this._scriptSelectorContainer) {
      this._scriptSelectorContainer.destroy(true);
      this._scriptSelectorContainer = null;
    }
    if (this._scriptWheelHandler) {
      this.input.off('wheel', this._scriptWheelHandler);
      this._scriptWheelHandler = null;
    }
    this._scriptScrollContainer = null;
    this._scriptScrollY = 0;
    this._scriptScrollMax = 0;
    this._cleanupNameInput();
    // Re-enable main buttons
    if (this.allButtons) {
      this.allButtons.forEach(btn => {
        if (btn.list) btn.list.forEach(child => {
          if (child.input) child.setInteractive({ useHandCursor: true });
        });
      });
    }
  }

  _startNewGameWithScript(scriptId = 'liyuan_shengsi', playerName = '玩家') {
    // Store selected script for GameScene
    localStorage.setItem('__selected_script_id__', scriptId);
    localStorage.setItem('__selected_player_name__', playerName);
    this.cameras.main.fadeOut(600, 0, 0, 0);
    this.time.delayedCall(600, () => this.scene.start('GameScene', { scriptId, playerName }));
  }

  _openEditorWorkshop(view = 'scripts') {
    this.editorPanel.show(view);
  }

  // ==================== 更新循环 ====================

  update() {
    // ★ 编辑器面板可见时优先处理 ESC 关闭
    if (this.editorPanel && this.editorPanel.isVisible()) {
      if (this.keyEsc && Phaser.Input.Keyboard.JustDown(this.keyEsc)) {
        this.editorPanel.hide();
      }
      return;
    }

    if (!this.fallingParticles) return;

    const { width, height } = this.cameras.main;
    for (const p of this.fallingParticles) {
      if (!p.active) continue;
      p.y += p.speed;
      p.x += Math.sin(this.time.now * p.wobbleSpeed) * p.wobble * 0.3;
      if (p.y > height + 20) {
        p.y = -20;
        p.x = Math.random() * width;
      }
    }

    if (this.archivePanel && this.archivePanel.active && this.archivePanel.visible) {
      if (this.keyEsc && Phaser.Input.Keyboard.JustDown(this.keyEsc)) this._hideArchivePanel();
    }
  }
}
