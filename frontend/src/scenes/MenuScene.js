import Phaser from 'phaser';
import { GAME, COLORS } from '../config.js';

/**
 * MenuScene — 游戏主菜单
 * 包含标题画面、"开始游戏"和"继续游戏"选项
 */
export class MenuScene extends Phaser.Scene {
  constructor() {
    super({ key: 'MenuScene' });
  }

  create() {
    const { width, height } = this.cameras.main;
    const cx = width / 2;

    // ========== 背景层 ==========
    // 深色底 + 装饰粒子（模拟飘落的桃花/纸片）
    this.cameras.main.setBackgroundColor('#0d0d1a');

    // 顶部装饰纹样（传统云纹简笔画）
    const topDeco = this.add.graphics();
    topDeco.lineStyle(1, 0x887766, 0.25);
    for (let i = 0; i < 8; i++) {
      const dx = (i - 3.5) * 130;
      topDeco.strokeCircle(cx + dx, 30, 18);
      topDeco.strokeCircle(cx + dx, 30, 8);
    }
    topDeco.lineBetween(0, 56, width, 56);

    // 底部装饰
    const botDeco = this.add.graphics();
    botDeco.lineStyle(1, 0x887766, 0.2);
    botDeco.lineBetween(0, height - 56, width, height - 56);

    // ========== 飘落粒子动画 ==========
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
    // 副标题（先显示）
    this.add.text(cx, 100, '—— 一段关于传承与选择的故事 ——', {
      fontFamily: '"KaiTi","SimSun",serif',
      fontSize: '15px', color: '#887766',
    }).setOrigin(0.5).setDepth(1).setAlpha(0);

    // 主标题
    const title = this.add.text(cx, 170, '梨园生死', {
      fontFamily: '"KaiTi","SimSun",serif',
      fontSize: '58px', color: '#d4b896',
      stroke: '#332a20',
      strokeThickness: 3,
    }).setOrigin(0.5).setDepth(1);

    // 标题下方印章风格小字
    this.add.text(cx, 230, 'PEKING OPERA · LIFE & DEATH', {
      fontFamily: 'serif',
      fontSize: '11px', color: '#886644', letterSpacing: 6,
    }).setOrigin(0.5).setDepth(1);

    // 标题淡入动画
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

    // 检查是否有存档
    const hasSave = this.hasSavedGame();

    this.allButtons = [];

    // "开始游戏" 按钮
    this.allButtons.push(
      this.createMenuButton(cx, btnY1, btnW, btnH, '开 始 游 戏', () => {
        this.onNewGame();
      }, 1)
    );

    // "继续游戏" 按钮
    this.allButtons.push(
      this.createMenuButton(cx, btnY2, btnW, btnH, '继 续 游 戏', () => {
        this.onContinue();
      }, hasSave ? 1 : 0.35, !hasSave)
    );

    // ========== 底部信息 ==========
    this.add.text(cx, height - 80, 'WASD 移动  ·  F 交互  ·  H 对话历史  ·  数字键选择', {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
      fontSize: '11px', color: '#555544',
    }).setOrigin(0.5).setDepth(1);

    this.add.text(cx, height - 58, 'T-Hackathon 2026 · AI Narrative Game', {
      fontFamily: 'monospace',
      fontSize: '10px', color: '#444433',
    }).setOrigin(0.5).setDepth(1);

    // 版本号
    this.add.text(width - 16, height - 16, 'v0.2', {
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
   * 开始新游戏
   */
  onNewGame() {
    // 淡出 + 缩放
    this.cameras.main.fadeOut(600, 0, 0, 0);
    this.time.delayedCall(600, () => {
      this.scene.start('GameScene');
    });
  }

  /**
   * 继续游戏
   */
  onContinue() {
    const sessionId = localStorage.getItem('__active_session__');
    if (!sessionId) return;

    this.cameras.main.fadeOut(600, 0, 0, 0);
    this.time.delayedCall(600, () => {
      this.scene.start('GameScene', { savedSessionId: sessionId });
    });
  }

  /**
   * 检查是否有可用存档
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
   * 更新循环 — 粒子飘落动画
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
  }
}
