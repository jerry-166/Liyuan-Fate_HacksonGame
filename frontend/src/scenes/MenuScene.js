/**
 * MenuScene — 游戏主菜单场景
 *
 * 职责：提供游戏入口，管理主页 UI
 * - 标题画面（"梨园生死" + 粒子动画）
 * - "开始游戏" / "继续游戏" 按钮
 * - 存档列表面板（列出所有已保存的游戏会话）
 *
 * 通过 GameScene(savedSessionId) 传递存档 ID 来区分新游戏 vs 继续游戏
 *
 * @module scenes/MenuScene
 */

import Phaser from 'phaser';
import { getChapterLabel, GAME } from '../config.js';
import { getSessions, deleteSession, getEnding } from '../api/client.js';
import { getAllPortraitAssets } from './modules/GameUIHelpers.js';
import { isMobileDevice, toggleFullscreen, isFullscreen } from '../utils/DeviceDetector.js';

// ========== UI 工具函数 ==========

/**
 * 创建菜单按钮容器
 * @param {Phaser.Scene} scene
 * @param {number} x - 中心 X
 * @param {number} y - 中心 Y
 * @param {number} w - 按钮宽度
 * @param {number} h - 按钮高度
 * @param {string} label - 按钮文字
 * @param {function} callback - 点击回调
 * @param {boolean} [disabled=false]
 * @returns {Phaser.GameObjects.Container}
 */
function createMenuButton(scene, x, y, w, h, label, callback, disabled = false) {
  const container = scene.add.container(x, y);

  // ★ 按键宽高缩放字号
  const textSize = Math.round(h * 0.54); // 26/48 ≈ 0.54

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
  const textSize = Math.round(h * 0.48); // 按高度缩放
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

  create() {
    const { width, height } = this.cameras.main;
    const cx = width / 2;
    const isMobile = isMobileDevice();

    // ★ 根据屏幕缩放标题字号
    const scale = Math.min(width / GAME.WIDTH, height / GAME.HEIGHT);
    const titleFS = Math.round(72 * scale);
    const subFS = Math.round(20 * scale);
    const btnFS = Math.round(26 * scale);
    const enFS = Math.round(15 * scale);
    const hintFS = Math.round(15 * scale);

    // ★ 立绘异步预加载（不阻塞菜单显示，后台加载）
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

    // 背景
    this.cameras.main.setBackgroundColor('#0d0d1a');

    // 顶部装饰纹样
    const topDeco = this.add.graphics();
    topDeco.lineStyle(1, 0x887766, 0.25);
    for (let i = 0; i < 8; i++) {
      topDeco.strokeCircle(cx + (i - 3.5) * 130, 30, 18);
      topDeco.strokeCircle(cx + (i - 3.5) * 130, 30, 8);
    }
    topDeco.lineBetween(0, 56, width, 56);

    const botDeco = this.add.graphics();
    botDeco.lineStyle(1, 0x887766, 0.2);
    botDeco.lineBetween(0, height - 56, width, height - 56);

    // 飘落粒子
    this.fallingParticles = [];
    for (let i = 0; i < 14; i++) {
      const petal = this.add.text(
        Math.random() * width, Math.random() * height,
        ['◆', '◇', '❋', '·', '♢'][Math.floor(Math.random() * 5)],
        {
          fontFamily: 'serif',
          fontSize: `${6 + Math.random() * 8}px`,
          color: ['#887766', '#776655', '#997766', '#665544'][Math.floor(Math.random() * 4)],
        }
      ).setAlpha(0.15 + Math.random() * 0.2).setDepth(0);
      petal.speed = 0.3 + Math.random() * 0.5;
      petal.wobble = Math.random() * 2;
      petal.wobbleSpeed = 0.005 + Math.random() * 0.01;
      this.fallingParticles.push(petal);
    }

    // 标题
    this.add.text(cx, Math.round(100 * scale), '—— 一段关于传承与选择的故事 ——', {
      fontFamily: '"KaiTi","SimSun",serif', fontSize: `${subFS}px`, color: '#887766',
    }).setOrigin(0.5).setDepth(1).setAlpha(0);

    const titleY = Math.round(170 * scale);
    const title = this.add.text(cx, titleY, '梨园生死', {
      fontFamily: '"KaiTi","SimSun",serif', fontSize: `${titleFS}px`, color: '#d4b896',
      stroke: '#332a20', strokeThickness: Math.max(1, Math.round(3 * scale)),
    }).setOrigin(0.5).setDepth(1);

    this.add.text(cx, titleY + Math.round(60 * scale), 'PEKING OPERA · LIFE & DEATH', {
      fontFamily: 'serif', fontSize: `${enFS}px`, color: '#886644', letterSpacing: 6,
    }).setOrigin(0.5).setDepth(1);

    title.setAlpha(0).setScale(1.2);
    this.tweens.add({ targets: title, alpha: 1, scaleX: 1, scaleY: 1, duration: 1200, ease: 'Sine.easeOut' });

    // 按钮（响应式尺寸）
    const btnW = Math.round(220 * scale), btnH = Math.round(48 * scale);
    const btnGap = Math.round(62 * scale);
    const btnY1 = Math.round(height / 2 + 40 * scale), btnY2 = btnY1 + btnGap;
    this.allButtons = [];

    this.allButtons.push(
      createMenuButton(this, cx, btnY1, btnW, btnH, '开 始 游 戏', () => this._startNewGame())
    );
    this.allButtons.push(
      createMenuButton(this, cx, btnY2, btnW, btnH, '继 续 游 戏', () => this._showArchives())
    );

    // 存档列表面板
    this.keyEsc = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);
    this._createArchivePanel();

    // 底部信息
    const mobileTip = isMobile ? '左半屏摇杆移动  ·  右下按钮互动' : 'WASD 移动  ·  F 交互  ·  H 对话历史  ·  数字键选择';
    this.add.text(cx, height - Math.round(80 * scale), mobileTip, {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
      fontSize: `${hintFS}px`, color: '#555544',
    }).setOrigin(0.5).setDepth(1);

    this.add.text(cx, height - Math.round(58 * scale), 'T-Hackathon 2026 · AI Narrative Game', {
      fontFamily: 'monospace', fontSize: `${Math.round(14 * scale)}px`, color: '#444433',
    }).setOrigin(0.5).setDepth(1);

    this.add.text(width - 16, height - 16, 'v0.3', {
      fontFamily: 'monospace', fontSize: `${Math.round(13 * scale)}px`, color: '#333322',
    }).setOrigin(1, 1).setDepth(1);

    // 按钮淡入
    const btnContainer = this.add.container(0, 0).setDepth(2).setAlpha(0);
    this.allButtons.forEach(b => btnContainer.add(b));
    this.tweens.add({ targets: btnContainer, alpha: 1, duration: 800, delay: 600, ease: 'Sine.easeIn' });

    // ★ 全屏切换按钮（右上角）
    this._createFullscreenBtn(width, height, scale, hintFS);
  }

  _createFullscreenBtn(width, height, scale, hintFS) {
    const label = isFullscreen() ? '⛶ 退出全屏' : '⛶ 全屏';
    const btnFS = Math.round(15 * scale);
    this._fsBtn = this.add.text(width - 16, 16, label, {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
      fontSize: `${btnFS}px`, color: '#887766',
      backgroundColor: '#1a1a2ecc', padding: { x: 8, y: 4 },
    }).setOrigin(1, 0).setDepth(10).setInteractive({ useHandCursor: true });
    this._fsBtn.on('pointerover', () => this._fsBtn.setColor('#c4a882'));
    this._fsBtn.on('pointerout', () => this._fsBtn.setColor('#887766'));
    this._fsBtn.on('pointerdown', () => {
      toggleFullscreen().then(() => this._updateFSBtnLabel());
    });

    // 监听全屏状态变化
    const onFsChange = () => {
      if (this._fsBtn) this._fsBtn.setText(isFullscreen() ? '⛶ 退出全屏' : '⛶ 全屏');
    };
    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('webkitfullscreenchange', onFsChange);
    document.addEventListener('msfullscreenchange', onFsChange);
  }

  _updateFSBtnLabel() {
    if (!this._fsBtn) return;
    this._fsBtn.setText(isFullscreen() ? '⛶ 退出全屏' : '⛶ 全屏');
  }

  // ==================== 存档面板 ====================

  _createArchivePanel() {
    const { width, height } = this.cameras.main;
    this.archivePanel = this.add.container(0, 0).setDepth(100).setVisible(false);
    this.archiveScrollY = 0;

    const panelW = 780, panelH = 520;
    const panelX = (width - panelW) / 2;
    const panelY = (height - panelH) / 2 - 20;

    // 遮罩
    const mask = this.add.graphics();
    mask.fillStyle(0x000000, 0.75);
    mask.fillRect(0, 0, width, height);
    mask.setInteractive(new Phaser.Geom.Rectangle(0, 0, width, height), Phaser.Geom.Rectangle.Contains);
    mask.on('pointerdown', (pointer) => {
      if (pointer.x >= panelX && pointer.x <= panelX + panelW &&
          pointer.y >= panelY && pointer.y <= panelY + panelH) return;
      this._hideArchivePanel();
    });
    this.archivePanel.add(mask);

    // 面板背景
    const panelBg = this.add.graphics();
    panelBg.fillStyle(0x151520, 0.97);
    panelBg.fillRoundedRect(panelX, panelY, panelW, panelH, 12);
    panelBg.lineStyle(2, 0x887766, 0.6);
    panelBg.strokeRoundedRect(panelX, panelY, panelW, panelH, 12);
    this.archivePanel.add(panelBg);

    this.archivePanel.add(this.add.text(width / 2, panelY + 32, '—— 戏梦存档 ——', {
      fontFamily: '"KaiTi","SimSun",serif', fontSize: '28px', color: '#d4b896',
    }).setOrigin(0.5));

    const divGfx = this.add.graphics();
    divGfx.lineStyle(1, 0x887766, 0.3);
    divGfx.lineBetween(panelX + 40, panelY + 60, panelX + panelW - 40, panelY + 60);
    this.archivePanel.add(divGfx);

    this.archiveListContent = this.add.container(0, panelY + 72);
    this.archivePanel.add(this.archiveListContent);

    this._archiveListArea = { x: panelX + 16, y: panelY + 66, w: panelW - 32, h: panelH - 130, baseY: panelY + 72 };

    // 列表遮罩
    const listMaskGfx = this.add.graphics();
    listMaskGfx.fillRect(panelX + 10, panelY + 56, panelW - 20, panelH - 110);
    listMaskGfx.setVisible(false);
    this.archiveListContent.setMask(listMaskGfx.createGeometryMask());

    // 滚轮
    this.input.on('wheel', (_p, _go, _dx, deltaY) => {
      if (!this.archivePanel || !this.archivePanel.visible) return;
      const area = this._archiveListArea;
      if (!this.archiveListContentHeight || this.archiveListContentHeight <= area.h) return;
      const maxScroll = this.archiveListContentHeight - area.h;
      this.archiveScrollY = Math.max(-maxScroll, Math.min(0, this.archiveScrollY - deltaY * 0.5));
      this.archiveListContent.setY(area.baseY + this.archiveScrollY);
    });

    this.archiveHint = this.add.text(width / 2, panelY + panelH - 36, '', {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
      fontSize: '16px', color: '#887766',
    }).setOrigin(0.5);
    this.archivePanel.add(this.archiveHint);

    this.add.text(width / 2, panelY + panelH - 12, '[ESC] 关闭  |  [Del] 删除选中  |  点击继续', {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
      fontSize: '14px', color: '#665544',
    }).setOrigin(0.5).setDepth(101);
  }

  async _showArchives() {
    this.archivePanel.setVisible(true);
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
    }
  }

  _hideArchivePanel() {
    this.archivePanel.setVisible(false);
    this.allButtons.forEach(btn => {
      if (btn.list) btn.list.forEach(child => { if (child.input) child.setInteractive({ useHandCursor: true }); });
    });
  }

  _displayEmptyArchive() {
    const emptyText = this.add.text(this.cameras.main.width / 2, 120, '还没有存档，请先开始新游戏', {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
      fontSize: '18px', color: '#666655',
    }).setOrigin(0.5);
    this.archiveListContent.add(emptyText);
  }

  _renderArchiveList(sessions) {
    const { width } = this.cameras.main;
    const panelW = 580, panelX = (width - panelW) / 2;

    const sorted = [...sessions].sort((a, b) =>
      (b.updated_at || b.created_at || '').localeCompare(a.updated_at || a.created_at || '')
    );

    const colW = panelW - 60;
    let y = 8;

    sorted.forEach((s) => {
      const chLabel = getChapterLabel(s.chapter_id);
      const date = (s.updated_at || s.created_at || '').slice(0, 16);
      const ended = s.game_ended ? ' [已结局]' : '';
      const label = `${s.player_name || '玩家'} · ${chLabel}${ended}`;

      const rowBg = this.add.graphics();
      rowBg.fillStyle(0x1a1a28, 1);
      rowBg.fillRoundedRect(panelX + 28, y - 4, colW - 28, 58, 6);
      rowBg.lineStyle(1, 0x443322, 0.4);
      rowBg.strokeRoundedRect(panelX + 28, y - 4, colW - 28, 58, 6);
      this.archiveListContent.add(rowBg);

      this.archiveListContent.add(this.add.text(panelX + 42, y + 6, label, {
        fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
        fontSize: '18px', color: s.game_ended ? '#886644' : '#d4b896',
      }));

      this.archiveListContent.add(this.add.text(panelX + 42, y + 30, date || '未知时间', {
        fontFamily: 'monospace', fontSize: '14px', color: '#665544',
      }));

      // 继续 / 查看结局按钮
      if (s.game_ended) {
        this.archiveListContent.add(
          createSmallButton(this, panelX + colW - 130, y + 12, 52, 26, '结局', '#669988',
            () => this._showEndingViewer(s.session_id))
        );
      } else {
        this.archiveListContent.add(
          createSmallButton(this, panelX + colW - 130, y + 12, 52, 26, '继续', '#889966',
            () => this._loadArchive(s.session_id))
        );
      }

      // 删除按钮
      this.archiveListContent.add(
        createSmallButton(this, panelX + colW - 68, y + 12, 52, 26, '删除', '#aa6655',
          () => this._confirmDelete(s.session_id, s.player_name))
      );

      y += 62;
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

    // 遮罩
    const dimBg = this.add.graphics();
    dimBg.fillStyle(0x000000, 1);
    dimBg.fillRect(0, 0, width, height);
    dimBg.setInteractive(new Phaser.Geom.Rectangle(0, 0, width, height), Phaser.Geom.Rectangle.Contains);
    dimBg.on('pointerdown', () => this._hideEndingViewer());
    this.endingViewer.add(dimBg);

    // 内容框 — 全部按比例
    const margin = Math.round(Math.min(width, height) * 0.04);
    const bx = margin;
    const by = margin;
    const bw = width - margin * 2;
    const bh = height - margin * 2;

    this._evBox = { x: bx, y: by, w: bw, h: bh };

    const boxBg = this.add.graphics();
    boxBg.fillStyle(0x141420, 1);
    boxBg.fillRoundedRect(bx, by, bw, bh, 8);
    boxBg.lineStyle(1, 0xc4a882, 0.35);
    boxBg.strokeRoundedRect(bx, by, bw, bh, 8);
    this.endingViewer.add(boxBg);

    // 底部提示
    const hintFontSize = Math.max(12, Math.round(bh * 0.025));
    const hintY = by + bh - hintFontSize - 8;
    this.endingViewerHint = this.add.text(width / 2, hintY, '[ ESC 或点击空白处关闭 ]', {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
      fontSize: `${hintFontSize}px`, color: '#665544',
    }).setOrigin(0.5).setAlpha(0.7);
    this.endingViewer.add(this.endingViewerHint);
  }

  async _showEndingViewer(sessionId) {
    // 每次销毁重建，彻底避免缓存重叠
    if (this.endingViewer) {
      this.endingViewer.destroy(true);
      this.endingViewer = null;
    }
    this._createEndingViewer();
    this.endingViewer.setVisible(true);
    this.archivePanel.setVisible(false);

    // 加载提示
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

    // ESC 关闭
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

    // 字号按窗口缩放
    const titleFS = Math.max(18, Math.round(bh * 0.05));
    const subFS = Math.max(11, Math.round(bh * 0.028));
    const bodyFS = Math.max(11, Math.round(bh * 0.024));
    const npcNameFS = Math.max(12, Math.round(bh * 0.026));
    const npcBodyFS = Math.max(11, Math.round(bh * 0.022));
    const lineGap = Math.max(4, Math.round(bh * 0.012));

    const v = this.endingViewer;

    // 标题
    v.add(this.add.text(cx, by + pad + 8, data.title || '梨园余韵', {
      fontFamily: '"KaiTi","SimSun",serif', fontSize: `${titleFS}px`, color: '#d4b896',
      align: 'center', wordWrap: { width: wrapW },
    }).setOrigin(0.5, 0));

    // 副标题
    const titleH = Math.round(titleFS * 1.4);
    const typeLabel = data.type === 'accept_leader' ? '—— 梨园传承线 ——' : '—— 遗憾离别线 ——';
    v.add(this.add.text(cx, by + pad + 8 + titleH + 6, typeLabel, {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
      fontSize: `${subFS}px`, color: '#998866',
    }).setOrigin(0.5, 0));

    // 分隔线
    const divY = by + pad + 8 + titleH + 6 + Math.round(subFS * 1.4) + lineGap;
    const divGfx = this.add.graphics();
    divGfx.lineStyle(1, 0xc4a882, 0.3);
    divGfx.lineBetween(bx + pad, divY, bx + bw - pad, divY);
    v.add(divGfx);

    let y = divY + lineGap;

    // 关键瞬间
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

    // 人生感悟
    if (data.life_lesson) {
      const lessonText = this.add.text(cx, y, `"${data.life_lesson}"`, {
        fontFamily: '"KaiTi","SimSun",serif',
        fontSize: `${Math.max(13, Math.round(bh * 0.03))}px`, color: '#e8d8b8',
        align: 'center', wordWrap: { width: wrapW }, lineSpacing: lineGap,
      }).setOrigin(0.5, 0);
      v.add(lessonText);
      y += lessonText.height + lineGap * 2;
    }

    // NPC 结局
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
    // 清除旧会话标记，防止残留数据干扰新游戏
    const oldSession = localStorage.getItem('__active_session__');
    if (oldSession) {
      try { localStorage.removeItem(`__dialogue_history_${oldSession}`); } catch (_) {}
      localStorage.removeItem('__active_session__');
    }
    this.cameras.main.fadeOut(600, 0, 0, 0);
    this.time.delayedCall(600, () => this.scene.start('GameScene'));
  }

  // ==================== 更新循环 ====================

  update() {
    if (!this.fallingParticles) return;

    const { height } = this.cameras.main;
    for (const p of this.fallingParticles) {
      p.y += p.speed;
      p.x += Math.sin(this.time.now * p.wobbleSpeed) * p.wobble * 0.3;
      if (p.y > height + 20) {
        p.y = -20;
        p.x = Math.random() * this.cameras.main.width;
      }
    }

    if (this.archivePanel && this.archivePanel.visible) {
      if (Phaser.Input.Keyboard.JustDown(this.keyEsc)) this._hideArchivePanel();
    }
  }
}
