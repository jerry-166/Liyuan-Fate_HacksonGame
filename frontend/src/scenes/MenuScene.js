import Phaser from 'phaser';
import { GAME, COLORS, STAGE_TONES } from '../config.js';
import { getSessions, deleteSession } from '../api/client.js';

/**
 * MenuScene — 游戏主菜单
 * 包含标题画面、"开始游戏"和"继续游戏"选项、存档管理面板
 */
export class MenuScene extends Phaser.Scene {
  constructor() {
    super({ key: 'MenuScene' });
  }

  create() {
    const { width, height } = this.cameras.main;
    const cx = width / 2;

    // ========== 背景层 ==========
    this.cameras.main.setBackgroundColor('#0d0d1a');

    // 顶部装饰纹样
    const topDeco = this.add.graphics();
    topDeco.lineStyle(1, 0x887766, 0.25);
    for (let i = 0; i < 8; i++) {
      const dx = (i - 3.5) * 130;
      topDeco.strokeCircle(cx + dx, 30, 18);
      topDeco.strokeCircle(cx + dx, 30, 8);
    }
    topDeco.lineBetween(0, 56, width, 56);

    const botDeco = this.add.graphics();
    botDeco.lineStyle(1, 0x887766, 0.2);
    botDeco.lineBetween(0, height - 56, width, height - 56);

    // ========== 飘落粒子 ==========
    this.fallingParticles = [];
    for (let i = 0; i < 14; i++) {
      const petal = this.add.text(
        Math.random() * width,
        Math.random() * height,
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

    // ========== 标题 ==========
    this.add.text(cx, 100, '—— 一段关于传承与选择的故事 ——', {
      fontFamily: '"KaiTi","SimSun",serif',
      fontSize: '15px', color: '#887766',
    }).setOrigin(0.5).setDepth(1).setAlpha(0);

    const title = this.add.text(cx, 170, '梨园生死', {
      fontFamily: '"KaiTi","SimSun",serif',
      fontSize: '58px', color: '#d4b896',
      stroke: '#332a20',
      strokeThickness: 3,
    }).setOrigin(0.5).setDepth(1);

    this.add.text(cx, 230, 'PEKING OPERA · LIFE & DEATH', {
      fontFamily: 'serif',
      fontSize: '11px', color: '#886644', letterSpacing: 6,
    }).setOrigin(0.5).setDepth(1);

    title.setAlpha(0).setScale(1.2);
    this.tweens.add({
      targets: title,
      alpha: 1, scaleX: 1, scaleY: 1,
      duration: 1200, ease: 'Sine.easeOut',
    });

    // ========== 按钮 ==========
    const btnY1 = height / 2 + 40;
    const btnY2 = btnY1 + 62;
    const btnW = 220;
    const btnH = 48;

    this.allButtons = [];

    this.allButtons.push(
      this.createMenuButton(cx, btnY1, btnW, btnH, '开 始 游 戏', () => {
        this.onNewGame();
      }, 1)
    );

    this.allButtons.push(
      this.createMenuButton(cx, btnY2, btnW, btnH, '继 续 游 戏', () => {
        this.onContinue();
      }, 1)
    );

    // ========== 存档列表面板 ==========
    this.keyEsc = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);
    this.createArchivePanel();

    // ========== 底部信息 ==========
    this.add.text(cx, height - 80, 'WASD 移动  ·  F 交互  ·  H 对话历史  ·  数字键选择', {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
      fontSize: '11px', color: '#555544',
    }).setOrigin(0.5).setDepth(1);

    this.add.text(cx, height - 58, 'T-Hackathon 2026 · AI Narrative Game', {
      fontFamily: 'monospace',
      fontSize: '10px', color: '#444433',
    }).setOrigin(0.5).setDepth(1);

    this.add.text(width - 16, height - 16, 'v0.3', {
      fontFamily: 'monospace',
      fontSize: '10px', color: '#333322',
    }).setOrigin(1, 1).setDepth(1);

    // 按钮延迟淡入
    const btnContainer = this.add.container(0, 0).setDepth(2).setAlpha(0);
    this.allButtons.forEach(b => btnContainer.add(b));
    this.tweens.add({
      targets: btnContainer, alpha: 1,
      duration: 800, delay: 600, ease: 'Sine.easeIn',
    });
  }

  /**
   * 创建菜单按钮
   */
  createMenuButton(x, y, w, h, label, callback, alpha = 1, disabled = false) {
    const container = this.add.container(x, y);

    // 背景
    const bg = this.add.graphics();
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

    // 文字
    const text = this.add.text(0, 0, label, {
      fontFamily: '"KaiTi","SimSun",serif',
      fontSize: '20px', color: disabled ? '#555544' : '#d4b896',
      letterSpacing: 8,
    }).setOrigin(0.5);
    container.add(text);

    if (!disabled) {
      // 交互区域
      const zone = this.add.zone(0, 0, w, h).setInteractive({ useHandCursor: true });
      zone.on('pointerover', () => drawBg(true));
      zone.on('pointerout', () => drawBg(false));
      zone.on('pointerdown', callback);
      container.add(zone);
    } else {
      // 禁用态显示存档为空提示
      const dimText = this.add.text(0, 20, '（没有存档）', {
        fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
        fontSize: '10px', color: '#443322',
      }).setOrigin(0.5);
      container.add(dimText);
    }

    return container;
  }

  /**
   * 创建存档列表覆盖面板
   */
  createArchivePanel() {
    const { width, height } = this.cameras.main;
    this.archivePanel = this.add.container(0, 0).setDepth(100).setVisible(false);
    this.archiveScrollY = 0;

    // 半透明遮罩（仅面板外部响应点击关闭）
    const mask = this.add.graphics();
    mask.fillStyle(0x000000, 0.75);
    mask.fillRect(0, 0, width, height);
    mask.setInteractive(new Phaser.Geom.Rectangle(0, 0, width, height), Phaser.Geom.Rectangle.Contains);
    mask.on('pointerdown', (pointer) => {
      const px = pointer.x, py = pointer.y;
      // 如果点击在面板内部，不关闭（避免和按钮冲突）
      if (px >= panelX && px <= panelX + panelW && py >= panelY && py <= panelY + panelH) return;
      this.hideArchivePanel();
    });
    this.archivePanel.add(mask);

    // 面板背景
    const panelW = 580;
    const panelH = 400;
    const panelX = (width - panelW) / 2;
    const panelY = (height - panelH) / 2 - 20;
    const panelBg = this.add.graphics();
    panelBg.fillStyle(0x151520, 0.97);
    panelBg.fillRoundedRect(panelX, panelY, panelW, panelH, 12);
    panelBg.lineStyle(2, 0x887766, 0.6);
    panelBg.strokeRoundedRect(panelX, panelY, panelW, panelH, 12);
    this.archivePanel.add(panelBg);

    // 标题
    const panelTitle = this.add.text(width / 2, panelY + 28, '—— 戏梦存档 ——', {
      fontFamily: '"KaiTi","SimSun",serif',
      fontSize: '22px', color: '#d4b896',
    }).setOrigin(0.5);
    this.archivePanel.add(panelTitle);

    // 分割线
    const divGfx = this.add.graphics();
    divGfx.lineStyle(1, 0x887766, 0.3);
    divGfx.lineBetween(panelX + 30, panelY + 52, panelX + panelW - 30, panelY + 52);
    this.archivePanel.add(divGfx);

    // 存档列表容器
    this.archiveListContent = this.add.container(0, panelY + 62);
    this.archivePanel.add(this.archiveListContent);

    // 列表区域参数（供滚动使用）
    this._archiveListArea = {
      x: panelX + 10,
      y: panelY + 56,
      w: panelW - 20,
      h: panelH - 110,
      baseY: panelY + 62,
    };

    // 列表遮罩
    const listMaskGfx = this.add.graphics();
    listMaskGfx.fillRect(panelX + 10, panelY + 56, panelW - 20, panelH - 110);
    listMaskGfx.setVisible(false);
    const listMask = listMaskGfx.createGeometryMask();
    this.archiveListContent.setMask(listMask);
    this.archiveListMask = listMask;

    // 滚轮滚动
    this.input.on('wheel', (_pointer, _go, _dx, deltaY) => {
      if (!this.archivePanel || !this.archivePanel.visible) return;
      const area = this._archiveListArea;
      if (!this.archiveListContentHeight || this.archiveListContentHeight <= area.h) return;
      const maxScroll = this.archiveListContentHeight - area.h;
      this.archiveScrollY = Math.max(-maxScroll, Math.min(0, this.archiveScrollY - deltaY * 0.5));
      this.archiveListContent.setY(area.baseY + this.archiveScrollY);
    });

    // 底部提示
    this.archiveHint = this.add.text(width / 2, panelY + panelH - 30, '', {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
      fontSize: '12px', color: '#887766',
    }).setOrigin(0.5);
    this.archivePanel.add(this.archiveHint);

    // 底部操作提示
    this.add.text(width / 2, panelY + panelH - 10, '[ESC] 关闭  |  [Del] 删除选中  |  点击继续', {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
      fontSize: '10px', color: '#665544',
    }).setOrigin(0.5).setDepth(101);
  }

  /**
   * 显示存档面板并加载存档列表
   */
  async showArchivePanel() {
    this.archivePanel.setVisible(true);
    this.archiveListContent.removeAll(true);
    this.archiveScrollY = 0;
    this.archiveListContentHeight = 0;
    this.archiveHint.setText('加载存档列表中……');

    // 禁用主菜单按钮
    this.allButtons.forEach(btn => {
      if (btn.list) {
        btn.list.forEach(child => {
          if (child.input) child.disableInteractive();
        });
      }
    });

    try {
      const data = await getSessions();
      const sessions = data.sessions || [];

      if (sessions.length === 0) {
        this.archiveHint.setText('没有存档记录');
        this.displayEmptyArchive();
      } else {
        this.archiveHint.setText(`共 ${sessions.length} 个存档`);
        this.renderArchiveList(sessions);
      }
    } catch (err) {
      console.warn('[MenuScene] 获取存档列表失败:', err);
      this.archiveHint.setText('无法连接到服务器');
      this.displayEmptyArchive();
    }
  }

  /**
   * 隐藏存档面板
   */
  hideArchivePanel() {
    this.archivePanel.setVisible(false);
    // 恢复按钮交互
    this.allButtons.forEach(btn => {
      if (btn.list) {
        btn.list.forEach(child => {
          if (child.input) child.setInteractive({ useHandCursor: true });
        });
      }
    });
  }

  /**
   * 空存档提示
   */
  displayEmptyArchive() {
    const { width } = this.cameras.main;
    const emptyText = this.add.text(width / 2, 120, '还没有存档，请先开始新游戏', {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
      fontSize: '14px', color: '#666655',
    }).setOrigin(0.5);
    this.archiveListContent.add(emptyText);
  }

  /**
   * 渲染存档列表
   */
  renderArchiveList(sessions) {
    const { width } = this.cameras.main;
    const panelW = 580;
    const panelX = (width - panelW) / 2;

    // 阶段名映射（从 STAGE_TONES 动态生成）
    const stageNames = {};
    for (const [k, v] of Object.entries(STAGE_TONES)) {
      stageNames[k] = v.name;
    }

    // 按更新时间降序
    const sorted = [...sessions].sort((a, b) =>
      (b.updated_at || b.created_at || '').localeCompare(a.updated_at || a.created_at || '')
    );

    const colW = panelW - 60;
    let y = 8;

    sorted.forEach((s, idx) => {
      const stageName = s.stage_name || stageNames[s.stage] || '未知';
      const date = (s.updated_at || s.created_at || '').slice(0, 16);
      const ended = s.game_ended ? ' [已结局]' : '';
      const label = `${s.player_name || '玩家'} · 第${s.stage || '?'}章「${stageName}」${ended}`;
      const subLabel = date || '未知时间';

      // 行容器
      const rowY = y;
      const rowBg = this.add.graphics();
      rowBg.fillStyle(0x1a1a28, 1);
      rowBg.fillRoundedRect(panelX + 20, rowY - 4, colW - 20, 52, 6);
      rowBg.lineStyle(1, 0x443322, 0.4);
      rowBg.strokeRoundedRect(panelX + 20, rowY - 4, colW - 20, 52, 6);
      this.archiveListContent.add(rowBg);

      // 文字
      const nameText = this.add.text(panelX + 34, rowY + 4, label, {
        fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
        fontSize: '14px', color: s.game_ended ? '#886644' : '#d4b896',
      });
      this.archiveListContent.add(nameText);

      const dateText = this.add.text(panelX + 34, rowY + 26, subLabel, {
        fontFamily: 'monospace',
        fontSize: '10px', color: '#665544',
      });
      this.archiveListContent.add(dateText);

      // "继续" 按钮
      const contW = 56;
      const contBtn = this.createSmallButton(
        panelX + colW - contW - 90, rowY + 8, contW, 28,
        '继续', '#889966', () => {
          this.loadArchive(s.session_id);
        }
      );
      this.archiveListContent.add(contBtn);

      // "删除" 按钮
      const delW = 56;
      const delBtn = this.createSmallButton(
        panelX + colW - delW - 30, rowY + 8, delW, 28,
        '删除', '#aa6655', () => {
          this.confirmDeleteArchive(s.session_id, s.player_name);
        }
      );
      this.archiveListContent.add(delBtn);

      y += 56;
    });

    this.archiveListContentHeight = y;
    this.archiveScrollY = 0;
    this.archiveListContent.setY(this._archiveListArea.baseY);
  }

  /**
   * 创建小型操作按钮（存档列表内用）
   */
  createSmallButton(x, y, w, h, label, color, callback) {
    const container = this.add.container(x, y);
    const bg = this.add.graphics();
    bg.fillStyle(0x2a2824, 1);
    bg.fillRoundedRect(0, 0, w, h, 4);
    bg.lineStyle(1, Phaser.Display.Color.HexStringToColor(color).color, 0.5);
    bg.strokeRoundedRect(0, 0, w, h, 4);
    container.add(bg);

    const text = this.add.text(w / 2, h / 2, label, {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
      fontSize: '12px', color: color,
    }).setOrigin(0.5);
    container.add(text);

    const zone = this.add.zone(w / 2, h / 2, w, h).setInteractive({ useHandCursor: true });
    zone.on('pointerover', () => {
      bg.clear();
      bg.fillStyle(0x3a3834, 1);
      bg.fillRoundedRect(0, 0, w, h, 4);
      bg.lineStyle(1, Phaser.Display.Color.HexStringToColor(color).color, 0.8);
      bg.strokeRoundedRect(0, 0, w, h, 4);
    });
    zone.on('pointerout', () => {
      bg.clear();
      bg.fillStyle(0x2a2824, 1);
      bg.fillRoundedRect(0, 0, w, h, 4);
      bg.lineStyle(1, Phaser.Display.Color.HexStringToColor(color).color, 0.5);
      bg.strokeRoundedRect(0, 0, w, h, 4);
    });
    zone.on('pointerdown', callback);
    container.add(zone);

    return container;
  }

  /**
   * 确认删除存档
   */
  async confirmDeleteArchive(sessionId, playerName) {
    const confirmed = confirm(`确定要删除「${playerName || '玩家'}」的存档吗？此操作不可撤销。`);
    if (!confirmed) return;

    try {
      await deleteSession(sessionId);

      // 清理本地关联
      if (localStorage.getItem('__active_session__') === sessionId) {
        localStorage.removeItem('__active_session__');
      }
      localStorage.removeItem(`game_state_${sessionId}`);

      // 刷新列表
      this.archiveListContent.removeAll(true);
      this.showArchivePanel();
    } catch (err) {
      console.error('[MenuScene] 删除存档失败:', err);
      this.archiveHint.setText('删除失败，请重试');
    }
  }

  /**
   * 加载指定存档
   */
  loadArchive(sessionId) {
    if (!sessionId) return;

    localStorage.setItem('__active_session__', sessionId);
    this.cameras.main.fadeOut(600, 0, 0, 0);
    this.time.delayedCall(600, () => {
      this.scene.start('GameScene', { savedSessionId: sessionId });
    });
  }

  /**
   * 开始新游戏
   */
  onNewGame() {
    this.cameras.main.fadeOut(600, 0, 0, 0);
    this.time.delayedCall(600, () => {
      this.scene.start('GameScene');
    });
  }

  /**
   * 继续游戏 — 直接显示存档面板，让玩家选择会话
   */
  async onContinue() {
    this.showArchivePanel();
  }

  /**
   * 检查是否有可用存档（已废弃，改用 API 动态获取）
   */
  hasSavedGame() {
    const sessionId = localStorage.getItem('__active_session__');
    if (!sessionId) return false;
    const saved = localStorage.getItem(`game_state_${sessionId}`);
    if (!saved) return false;
    try {
      const state = JSON.parse(saved);
      return !state.game_ended;
    } catch {
      return false;
    }
  }

  /**
   * 更新循环 — 粒子飘落动画 + 存档面板键盘操作
   */
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

    // ESC 关闭存档面板
    if (this.archivePanel && this.archivePanel.visible) {
      if (Phaser.Input.Keyboard.JustDown(this.keyEsc)) {
        this.hideArchivePanel();
      }
    }
  }
}
