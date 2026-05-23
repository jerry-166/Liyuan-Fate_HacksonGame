import Phaser from 'phaser';
import { GAME, COLORS, STAGE_TONES } from '../config.js';
import {
  startDialogueStream,
  parseSSEStream,
  evaluateEnding,
  getGameState,
} from '../api/client.js';

/**
 * UIScene — UI 覆盖层场景
 * 渲染在 GameScene 之上，负责对话 UI、阶段过渡、结局画面
 */
export class UIScene extends Phaser.Scene {
  constructor() {
    super({ key: 'UIScene' });
  }

  create() {
    this.dialogActive = false;
    this.isStreaming = false;
    this.sessionId = null;
    this.currentNPC = null;
    this.currentStage = 1;

    // 分页状态
    this.dialogPages = [];
    this.dialogCurrentPage = 0;
    this.pendingOptions = null;
    this.pendingStageChange = null;
    this.pendingEnding = false;

    // 历史对话
    this.dialogueHistory = [];

    // 预创建按键
    this.keyF = this.input.keyboard.addKey('F');
    this.key1 = this.input.keyboard.addKey('ONE');
    this.key2 = this.input.keyboard.addKey('TWO');
    this.key3 = this.input.keyboard.addKey('THREE');
    this.keyH = this.input.keyboard.addKey('H');

    this.createDialogPanel();
    this.createHUD();
    this.createHistoryPanel();
    this.createStageTransitionOverlay();
    this.createEndingScreen();

    // 监听 GameScene 事件
    const gameScene = this.scene.get('GameScene');
    gameScene.events.on('dialogue:start', this.onDialogueStart, this);
    gameScene.events.on('game:init', this.onGameInit, this);
    gameScene.events.on('stage:change', this.onStageChange, this);
  }

  // =========================== HUD ===========================

  createHUD() {
    const { width } = this.cameras.main;
    this.hudContainer = this.add.container(0, 0).setDepth(200);

    // 右上角阶段指示器
    this.stageBadge = this.add.text(width - 12, 12, '阶段一 · 不屑', {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
      fontSize: '13px', color: '#c4a882',
      backgroundColor: '#1a1a2ecc', padding: { x: 10, y: 5 },
    }).setOrigin(1, 0);

    // 左上角游戏标题
    this.add.text(12, 12, '《梨园生死》', {
      fontFamily: '"KaiTi","SimSun",serif',
      fontSize: '16px', color: '#d4b896',
    }).setDepth(200);

    // 历史对话按钮
    this.historyBtn = this.add.text(width - 12, 38, '📜 历史 [H]', {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
      fontSize: '12px', color: '#887766',
      backgroundColor: '#1a1a2ecc', padding: { x: 8, y: 4 },
    }).setOrigin(1, 0).setInteractive({ useHandCursor: true });
    this.historyBtn.on('pointerdown', () => this.toggleHistoryPanel());
    this.hudContainer.add(this.historyBtn);

    this.hudContainer.add(this.stageBadge);
  }

  // =========================== 历史对话面板 ===========================

  createHistoryPanel() {
    const { width, height } = this.cameras.main;
    this.historyPanelVisible = false;
    this.historyScrollY = 0;

    this.historyPanel = this.add.container(0, 0).setDepth(400).setVisible(false);

    const bg = this.add.graphics();
    bg.fillStyle(0x0a0a12, 0.93);
    bg.fillRect(0, 0, width, height);
    this.historyPanel.add(bg);

    const titleText = this.add.text(width / 2, 20, '—— 记忆回响 ——', {
      fontFamily: '"KaiTi","SimSun",serif',
      fontSize: '20px', color: '#d4b896',
    }).setOrigin(0.5, 0);
    this.historyPanel.add(titleText);

    this.historyContent = this.add.container(0, 60);
    this.historyPanel.add(this.historyContent);

    // 历史内容遮罩：限制在标题下方、提示上方区域内
    const histMaskGfx = this.add.graphics();
    histMaskGfx.fillRect(0, 56, width, height - 96);
    histMaskGfx.setVisible(false);
    const histMask = histMaskGfx.createGeometryMask();
    this.historyContent.setMask(histMask);
    this.historyMask = histMask;

    const tipText = this.add.text(width / 2, height - 30, '[H] 或 [F] 关闭  |  滚轮滚动', {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
      fontSize: '12px', color: '#666655',
    }).setOrigin(0.5, 0);
    this.historyPanel.add(tipText);

    this.input.on('wheel', (pointer, gameObjects, deltaX, deltaY) => {
      if (!this.historyPanelVisible) return;
      if (this.historyContentHeight <= height - 160) return;
      this.historyScrollY = Math.max(
        Math.min(0, this.historyScrollY + deltaY * 0.5),
        -(this.historyContentHeight - height + 160)
      );
      this.historyContent.setY(60 + this.historyScrollY);
    });
  }

  toggleHistoryPanel() {
    this.historyPanelVisible = !this.historyPanelVisible;
    if (this.historyPanelVisible) {
      this.refreshHistoryContent();
      this.historyPanel.setVisible(true);
      // 历史面板打开时禁用对话框点击，避免误触发翻页
      this.dialogClickZone.disableInteractive();
    } else {
      this.historyPanel.setVisible(false);
      // 恢复对话框点击（如果还在分页中且未结束）
      if (this.dialogActive && !this.isStreaming && this.dialogPages.length > 1 &&
          this.dialogCurrentPage < this.dialogPages.length - 1) {
        this.dialogClickZone.setInteractive({ useHandCursor: true });
      }
    }
  }

  addToHistory(npcName, npcText, playerText = null) {
    this.dialogueHistory.push({
      npcName,
      npcText: npcText || '',
      playerText: playerText || null,
      stage: this.currentStage,
    });
  }

  refreshHistoryContent() {
    this.historyContent.removeAll(true);
    const { width } = this.cameras.main;
    const maxW = width - 120;
    let y = 0;

    if (this.dialogueHistory.length === 0) {
      const empty = this.add.text(width / 2, 80, '还没有任何对话记录', {
        fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
        fontSize: '14px', color: '#666655',
      }).setOrigin(0.5, 0);
      this.historyContent.add(empty);
      this.historyContentHeight = 120;
      return;
    }

    this.dialogueHistory.forEach((entry, idx) => {
      if (idx === 0 || entry.stage !== this.dialogueHistory[idx - 1].stage) {
        const sep = this.add.text(width / 2, y, `—— 第${entry.stage}章 ——`, {
          fontFamily: '"KaiTi","SimSun",serif',
          fontSize: '14px', color: '#998866',
        }).setOrigin(0.5, 0);
        this.historyContent.add(sep);
        y += 30;
      }

      const npcLabel = this.add.text(60, y, `【${entry.npcName}】`, {
        fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
        fontSize: '14px', color: '#d4b896', fontStyle: 'bold',
      });
      this.historyContent.add(npcLabel);
      y += 22;

      const npcT = this.add.text(60, y, entry.npcText, {
        fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
        fontSize: '13px', color: '#c0b898', wordWrap: { width: maxW }, lineSpacing: 4,
      });
      this.historyContent.add(npcT);
      y += npcT.height + 10;

      if (entry.playerText) {
        const pl = this.add.text(60, y, `【你】${entry.playerText}`, {
          fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
          fontSize: '12px', color: '#88aacc', wordWrap: { width: maxW },
        });
        this.historyContent.add(pl);
        y += pl.height + 18;
      }
    });

    this.historyContentHeight = y;
    this.historyScrollY = 0;
    this.historyContent.setY(60);
  }

  // =========================== 对话框面板 ===========================

  createDialogPanel() {
    const { width, height } = this.cameras.main;
    const panelW = width - 80;
    const panelH = 210;
    const panelX = (width - panelW) / 2;
    const panelY = height - panelH - 24;

    this.dialogContainer = this.add.container(0, 0).setDepth(300).setVisible(false);

    // 半透明背景
    const bg = this.add.graphics();
    bg.fillStyle(0x1a1820, 0.92);
    bg.fillRoundedRect(panelX, panelY, panelW, panelH, 10);
    bg.lineStyle(2, COLORS.DIALOG_BORDER, 0.7);
    bg.strokeRoundedRect(panelX, panelY, panelW, panelH, 10);
    // 顶部装饰线
    bg.lineStyle(1, COLORS.DIALOG_BORDER, 0.35);
    bg.lineBetween(panelX + 16, panelY + 36, panelX + panelW - 16, panelY + 36);

    this.dialogContainer.add(bg);

    // NPC 名字
    this.dialogName = this.add.text(panelX + 20, panelY + 10, '', {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
      fontSize: '14px', color: '#d4b896', fontStyle: 'bold',
    });
    this.dialogContainer.add(this.dialogName);

    // 对话文本（流式逐字显示区域）
    this.dialogText = this.add.text(panelX + 20, panelY + 46, '', {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
      fontSize: '15px', color: '#e8dcc8', wordWrap: { width: panelW - 40 },
      lineSpacing: 6,
    });
    this.dialogContainer.add(this.dialogText);

    // 遮罩：防止流式输出时文字溢出到选项区
    const textMaskGfx = this.add.graphics();
    textMaskGfx.fillRect(panelX + 16, panelY + 44, panelW - 32, panelH - 44 - 58);
    textMaskGfx.setVisible(false);
    const textMask = textMaskGfx.createGeometryMask();
    this.dialogText.setMask(textMask);
    this.dialogTextMask = textMask;

    // 光标闪烁
    this.cursorBlink = this.add.text(0, 0, '▎', {
      fontFamily: 'monospace', fontSize: '15px', color: '#d4b896',
    }).setVisible(false);
    this.dialogContainer.add(this.cursorBlink);
    this.cursorTimer = null;

    // 选项按钮组
    this.optionButtons = [];
    this.optionContainer = this.add.container(0, 0);
    this.dialogContainer.add(this.optionContainer);

    // 翻页提示（右下角）
    this.pageHint = this.add.text(panelX + panelW - 150, panelY + panelH - 40, '', {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
      fontSize: '11px', color: '#c4a882',
    });
    this.dialogContainer.add(this.pageHint);

    // 提示文字（"按F关闭"等）
    this.dialogHint = this.add.text(panelX + panelW - 150, panelY + panelH - 24, '[F] 关闭  [1-3] 选择', {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
      fontSize: '11px', color: '#888878',
    });
    this.dialogContainer.add(this.dialogHint);

    // 对话框翻页点击区（覆盖文本区域）
    this.dialogClickZone = this.add.zone(
      panelX + panelW / 2,
      panelY + 36 + (panelH - 36 - 60) / 2,
      panelW - 8,
      panelH - 36 - 60
    ).setInteractive({ useHandCursor: true });
    this.dialogClickZone.on('pointerdown', () => this.onDialogClick());
    this.dialogContainer.add(this.dialogClickZone);
    this.dialogClickZone.setVisible(false);  // 默认不启用
  }

  /**
   * 显示选项按钮
   */
  showOptions(options) {
    this.clearOptions();

    if (!options || options.length === 0) {
      this.dialogHint.setText('[F] 关闭对话');
      return;
    }

    // 兼容后端返回的字符串数组 ["text1", "text2"]
    const normalized = options.map((opt, i) => {
      if (typeof opt === 'string') return { id: i + 1, text: opt };
      return opt;
    });

    const { width, height } = this.cameras.main;
    const panelW = width - 80;
    const panelH = 210;
    const panelX = (width - panelW) / 2;
    const panelY = height - panelH - 24;

    const btnW = Math.min(240, (panelW - 60) / options.length);
    const totalW = options.length * btnW + (options.length - 1) * 12;
    const startX = panelX + (panelW - totalW) / 2;
    const btnY = panelY + panelH - 50;

    normalized.forEach((opt, i) => {
      const x = startX + i * (btnW + 12);
      const btn = this.createOptionButton(x, btnY, btnW, 34, opt, i);
      this.optionButtons.push(btn);
    });

    this.dialogHint.setText('[F] 关闭  [1-3] 选择');
  }

  createOptionButton(x, y, w, h, optionData, index) {
    const container = this.add.container(x, y);

    // 背景
    const bg = this.add.graphics();
    bg.fillStyle(0x2a2824, 1);
    bg.fillRoundedRect(0, 0, w, h, 5);
    bg.lineStyle(1, 0xc4a882, 0.5);
    bg.strokeRoundedRect(0, 0, w, h, 5);
    container.add(bg);

    // 编号标签
    const num = this.add.text(10, h / 2, `${index + 1}`, {
      fontFamily: 'monospace', fontSize: '12px', color: '#c4a882',
    }).setOrigin(0, 0.5);
    container.add(num);

    // 选项文字
    const text = this.add.text(30, h / 2, optionData.text, {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
      fontSize: '13px', color: '#d0c8b4', wordWrap: { width: w - 44, useAdvancedWrap: true },
    }).setOrigin(0, 0.5);
    container.add(text);

    // 透明点击区域
    const zone = this.add.zone(w / 2, h / 2, w, h).setInteractive({ useHandCursor: true });
    zone.on('pointerover', () => {
      bg.clear();
      bg.fillStyle(0x3a3834, 1);
      bg.fillRoundedRect(0, 0, w, h, 5);
      bg.lineStyle(1, 0xd4b896, 0.8);
      bg.strokeRoundedRect(0, 0, w, h, 5);
    });
    zone.on('pointerout', () => {
      bg.clear();
      bg.fillStyle(0x2a2824, 1);
      bg.fillRoundedRect(0, 0, w, h, 5);
      bg.lineStyle(1, 0xc4a882, 0.5);
      bg.strokeRoundedRect(0, 0, w, h, 5);
    });
    zone.on('pointerdown', () => {
      this.onOptionSelected(optionData);
    });
    container.add(zone);
    container.setSize(w, h);

    this.optionContainer.add(container);
    return container;
  }

  clearOptions() {
    this.optionButtons.forEach(btn => btn.destroy());
    this.optionButtons = [];
    this.optionContainer.removeAll(true);
  }

  /**
   * 文本分页 — 将超长文本按对话框可视高度分割成多页
   * 使用二分查找找到合适截断点，保证每页不超出可视区域
   */
  splitTextToPages(fullText) {
    if (!fullText) return [''];

    const { width } = this.cameras.main;
    const panelW = width - 80;
    const panelH = 210;
    const maxTextH = panelH - 48 - 60;  // 减去名称栏和选项区

    // 用 dialogText 做测量，临时保存原值
    const savedText = this.dialogText.text;
    const savedStyle = { ...this.dialogText.style };

    const pages = [];
    let remaining = fullText;

    while (remaining.length > 0) {
      this.dialogText.setText(remaining);
      if (this.dialogText.height <= maxTextH) {
        pages.push(remaining);
        break;
      }

      // 二分查找本页最大字符数
      let lo = 0, hi = remaining.length;
      while (lo < hi) {
        const mid = Math.floor((lo + hi + 1) / 2);
        const test = remaining.slice(0, mid);
        this.dialogText.setText(test);
        if (this.dialogText.height <= maxTextH) {
          lo = mid;
        } else {
          hi = mid - 1;
        }
      }

      if (lo === 0) {
        // 连一个字符都放不下，回退
        pages.push(remaining);
        break;
      }

      pages.push(remaining.slice(0, lo));
      remaining = remaining.slice(lo);
    }

    // 恢复原文本
    this.dialogText.setText(savedText);
    return pages;
  }

  // =========================== 阶段过渡覆盖层 ===========================

  createStageTransitionOverlay() {
    const { width, height } = this.cameras.main;
    this.transitionContainer = this.add.container(0, 0).setDepth(500).setVisible(false);

    const overlay = this.add.graphics();
    overlay.fillStyle(0x000000, 0);
    overlay.fillRect(0, 0, width, height);
    this.transitionContainer.add(overlay);
    this.transitionOverlay = overlay;

    // 阶段标题文字
    this.transitionTitle = this.add.text(width / 2, height / 2 - 30, '', {
      fontFamily: '"KaiTi","SimSun",serif',
      fontSize: '36px', color: '#d4b896',
    }).setOrigin(0.5).setAlpha(0);
    this.transitionContainer.add(this.transitionTitle);

    this.transitionDesc = this.add.text(width / 2, height / 2 + 20, '', {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
      fontSize: '16px', color: '#998866', wordWrap: { width: 400 },
      align: 'center',
    }).setOrigin(0.5).setAlpha(0);
    this.transitionContainer.add(this.transitionDesc);

    this.transitionHint = this.add.text(width / 2, height / 2 + 70, '', {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
      fontSize: '13px', color: '#888878',
    }).setOrigin(0.5).setAlpha(0);
    this.transitionContainer.add(this.transitionHint);
  }

  // =========================== 结局画面 ===========================

  createEndingScreen() {
    const { width, height } = this.cameras.main;
    this.endingContainer = this.add.container(0, 0).setDepth(600).setVisible(false);

    // 全黑背景
    const endingBg = this.add.graphics();
    endingBg.fillStyle(0x0a0a12, 1);
    endingBg.fillRect(0, 0, width, height);
    this.endingContainer.add(endingBg);

    // 标题
    this.endingTitle = this.add.text(width / 2, 100, '', {
      fontFamily: '"KaiTi","SimSun",serif',
      fontSize: '42px', color: '#d4b896',
    }).setOrigin(0.5);
    this.endingContainer.add(this.endingTitle);

    // 副标题
    this.endingSubtitle = this.add.text(width / 2, 155, '', {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
      fontSize: '18px', color: '#998866',
    }).setOrigin(0.5);
    this.endingContainer.add(this.endingSubtitle);

    // 分割线
    const divider = this.add.graphics();
    divider.lineStyle(1, 0xc4a882, 0.4);
    divider.lineBetween(width / 2 - 180, 190, width / 2 + 180, 190);
    this.endingContainer.add(divider);

    // 关键节点
    this.endingKeyMoments = this.add.text(width / 2, 260, '', {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
      fontSize: '14px', color: '#a89878', lineSpacing: 12, align: 'center',
    }).setOrigin(0.5);
    this.endingContainer.add(this.endingKeyMoments);

    // 人生感悟
    this.endingLesson = this.add.text(width / 2, height / 2 + 40, '', {
      fontFamily: '"KaiTi","SimSun",serif',
      fontSize: '20px', color: '#e8d8b8', wordWrap: { width: 500 },
      align: 'center', lineSpacing: 8,
    }).setOrigin(0.5);
    this.endingContainer.add(this.endingLesson);

    // NPC 结局
    this.endingNPCText = this.add.text(width / 2, height - 180, '', {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
      fontSize: '13px', color: '#887766', lineSpacing: 8, align: 'center',
    }).setOrigin(0.5);
    this.endingContainer.add(this.endingNPCText);

    // 重新开始提示
    this.endingRestart = this.add.text(width / 2, height - 50, '[ 按 R 键重新开始 ]', {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
      fontSize: '14px', color: '#887766',
    }).setOrigin(0.5).setAlpha(0);
    this.endingContainer.add(this.endingRestart);
  }

  // =========================== 逻辑处理 ===========================

  onGameInit(data) {
    this.sessionId = data.sessionId;
    this.currentStage = data.stage || 1;
    this.updateStageBadge();
  }

  /**
   * 开始对话 — 由 GameScene 的 'dialogue:start' 事件触发
   */
  async onDialogueStart({ npcId, name, greeting }) {
    if (this.dialogActive || this.isStreaming) return;
    this.dialogActive = true;
    this.isStreaming = true;
    this.currentNPC = { id: npcId, name };

    // 关闭历史面板（如果有）
    if (this.historyPanelVisible) this.toggleHistoryPanel();

    // 暂停 GameScene 的输入
    const gameScene = this.scene.get('GameScene');
    gameScene.events.emit('input:lock', true);

    // 显示对话框
    this.dialogContainer.setVisible(true);
    this.dialogName.setText(name);
    this.dialogText.setText('');
    this.dialogHint.setText('对话生成中……');
    this.clearOptions();

    // 开始游标闪烁
    this.startCursorBlink();

    // 发起 SSE 流式对话（首轮，无 player_message）
    try {
      const stream = await startDialogueStream(this.sessionId, npcId, null);
      await this.processDialogueStream(stream);
    } catch (err) {
      console.error('[UIScene] 对话请求失败:', err);
      this.dialogText.setText('【网络开小差了，请重试】');
      this.dialogHint.setText('[F] 关闭');
    }
  }

  /**
   * 处理选项选择 — 发送玩家消息继续对话
   */
  async onOptionSelected(option) {
    if (this.isStreaming) return;
    this.isStreaming = true;

    // 记录玩家选择到历史
    if (this.currentNPC && option.text) {
      this.addToHistory(this.currentNPC.name, null, option.text);
    }

    this.clearOptions();
    this.dialogText.setText('');
    this.dialogHint.setText('对话生成中……');
    this.pageHint.setText('');
    this.dialogClickZone.disableInteractive();
    this.startCursorBlink();

    try {
      const stream = await startDialogueStream(
        this.sessionId,
        this.currentNPC.id,
        option.text
      );
      await this.processDialogueStream(stream);
    } catch (err) {
      console.error('[UIScene] 续接对话失败:', err);
      this.dialogText.setText('【网络开小差了，请重试】');
      this.dialogHint.setText('[F] 关闭');
    }
  }

  /**
   * 解析 SSE 流并驱动 UI 更新
   */
  async processDialogueStream(stream) {
    let accumulatedText = '';

    await parseSSEStream(stream, {
      onDelta: (chunk) => {
        accumulatedText += chunk;
        this.dialogText.setText(accumulatedText);
        this.updateCursorPosition();
      },
      onDone: async (result) => {
        this.isStreaming = false;
        this.stopCursorBlink();

        // 记录到历史
        this.addToHistory(this.currentNPC.name, result.full_text || accumulatedText);

        // 全文分页
        const fullText = result.full_text || accumulatedText;
        this.dialogPages = this.splitTextToPages(fullText);
        this.dialogCurrentPage = 0;
        this.pendingOptions = result.options || null;
        this.pendingStageChange = result.stage_changed && result.new_stage ? result.new_stage : null;
        this.pendingEnding = result.ending_triggered || false;

        // 显示第一页
        this.showCurrentPage();

        // 结局直接触发（不需要分页交互）
        if (this.pendingEnding) {
          this.dialogHint.setText('[F] 关闭对话');
          this.time.delayedCall(1200, () => this.triggerEndingSequence());
        }
      },
      onError: (err) => {
        this.isStreaming = false;
        this.stopCursorBlink();
        this.dialogText.setText(`【出错了】${err.message || 'AI回复失败'}`);
        this.dialogHint.setText('[F] 关闭');
        this.clearOptions();
      }
    });
  }

  /**
   * 显示当前页 — 从 dialogPages 取第 dialogCurrentPage 页
   */
  showCurrentPage() {
    const total = this.dialogPages.length;
    const cur = this.dialogCurrentPage;
    const text = this.dialogPages[cur] || '';

    this.dialogText.setText(text);
    this.pageHint.setText('');
    this.dialogClickZone.disableInteractive();

    if (total <= 1) {
      // 不分页，直接显示选项
      this.finishPagination();
    } else if (cur < total - 1) {
      // 还有下一页
      this.pageHint.setText(`点击继续 (${cur + 1}/${total})`);
      this.dialogClickZone.setInteractive({ useHandCursor: true });
    } else {
      // 最后一页
      this.pageHint.setText(`(${cur + 1}/${total})`);
      this.finishPagination();
    }
  }

  /**
   * 分页结束 — 显示选项、触发阶段变化等
   */
  async finishPagination() {
    this.pageHint.setText('');
    this.dialogClickZone.disableInteractive();

    if (this.pendingStageChange) {
      await this.playStageTransition(this.pendingStageChange);
      this.currentStage = this.pendingStageChange.id;
      this.updateStageBadge();
      const gameScene = this.scene.get('GameScene');
      gameScene.events.emit('stage:change', this.pendingStageChange);
      this.pendingStageChange = null;
    }

    if (!this.pendingEnding) {
      this.showOptions(this.pendingOptions);
    }
  }

  /**
   * 对话框点击翻页
   */
  onDialogClick() {
    if (this.isStreaming) return;
    if (this.dialogCurrentPage >= this.dialogPages.length - 1) return;
    this.dialogCurrentPage++;
    this.showCurrentPage();
  }

  /**
   * 阶段过渡动画
   */
  async playStageTransition(newStage) {
    const { width, height } = this.cameras.main;
    const tone = STAGE_TONES[newStage.id];

    this.transitionContainer.setVisible(true);
    this.transitionContainer.setAlpha(0);

    // 阶段标题
    this.transitionTitle.setText(`第${newStage.id}章 · ${newStage.name}`);
    this.transitionDesc.setText(newStage.description || '');
    this.transitionHint.setText('');

    // 淡入
    await this.fadeInContainer(this.transitionContainer, 800);

    // 逐字显示标题
    this.transitionTitle.setAlpha(1);
    this.transitionDesc.setAlpha(0);

    // 显示描述
    this.time.delayedCall(400, () => {
      this.tweens.add({
        targets: this.transitionDesc,
        alpha: 1, duration: 600, ease: 'Sine.easeIn',
      });
    });

    // 停留
    await this.wait(2200);

    // 淡出
    await this.fadeOutContainer(this.transitionContainer, 600);
    this.transitionContainer.setVisible(false);
  }

  /**
   * 结局触发流程
   */
  async triggerEndingSequence() {
    // 隐藏对话框
    this.dialogContainer.setVisible(false);
    const gameScene = this.scene.get('GameScene');
    gameScene.events.emit('input:lock', true);

    // "命运的齿轮开始转动..."
    const { width, height } = this.cameras.main;
    const fateText = this.add.text(width / 2, height / 2, '命运的齿轮开始转动……', {
      fontFamily: '"KaiTi","SimSun",serif',
      fontSize: '24px', color: '#d4b896',
    }).setOrigin(0.5).setDepth(550).setAlpha(0);

    this.tweens.add({ targets: fateText, alpha: 1, duration: 1200 });
    await this.wait(2000);
    this.tweens.add({ targets: fateText, alpha: 0, duration: 600 });
    await this.wait(700);
    fateText.destroy();

    // 调用 evaluate 接口
    let endingData;
    try {
      endingData = await evaluateEnding(this.sessionId);
    } catch (e) {
      console.error('结局评价失败:', e);
      return;
    }

    // 显示结局画面
    this.endingContainer.setVisible(true);
    this.endingContainer.setAlpha(0);

    // 标题
    this.endingTitle.setText(endingData.title);
    this.endingSubtitle.setText(endingData.type === 'accept_leader' ? '—— 梨园传承线 ——' : '—— 遗憾离别线 ——');

    // 关键节点
    if (endingData.key_moments && endingData.key_moments.length > 0) {
      const momentsText = endingData.key_moments
        .map((m, i) => `「${m.description}」`)
        .join('  →  ');
      this.endingKeyMoments.setText(momentsText);
    }

    // 人生感悟
    this.endingLesson.setText(`"${endingData.life_lesson}"`);

    // NPC结局
    if (endingData.npc_endings && endingData.npc_endings.length > 0) {
      const npcText = endingData.npc_endings
        .map(e => `◆ ${e.summary}`)
        .join('\n');
      this.endingNPCText.setText(npcText);
    }

    // 淡入
    await this.fadeInContainer(this.endingContainer, 1500);

    // 逐行显示元素
    this.endingTitle.setAlpha(1);
    this.endingSubtitle.setAlpha(0);
    this.endingKeyMoments.setAlpha(0);
    this.endingLesson.setAlpha(0);
    this.endingNPCText.setAlpha(0);

    // 逐行弹出
    const elements = [this.endingSubtitle, this.endingKeyMoments, this.endingLesson, this.endingNPCText];
    for (let i = 0; i < elements.length; i++) {
      await this.wait(800);
      this.tweens.add({
        targets: elements[i], alpha: 1, duration: 800, ease: 'Sine.easeIn',
      });
    }

    // 显示重新开始提示
    await this.wait(1000);
    this.tweens.add({
      targets: this.endingRestart, alpha: 1, duration: 800, yoyo: true, repeat: -1,
    });

    // 监听 R 键重新开始
    this.input.keyboard.once('keydown-R', () => {
      this.endingContainer.setVisible(false);
      this.scene.get('GameScene').events.emit('game:restart');
    });
  }

  // =========================== 工具方法 ===========================

  startCursorBlink() {
    this.stopCursorBlink();
    this.cursorBlink.setVisible(true);
    this.updateCursorPosition();
    this.cursorTimer = this.tweens.add({
      targets: this.cursorBlink, alpha: { from: 1, to: 0.2 },
      duration: 500, yoyo: true, repeat: -1,
    });
  }

  stopCursorBlink() {
    this.cursorBlink.setVisible(false);
    if (this.cursorTimer) {
      this.cursorTimer.remove();
      this.cursorTimer = null;
    }
  }

  updateCursorPosition() {
    const textBounds = this.dialogText.getBounds();
    this.cursorBlink.setPosition(
      textBounds.right + 2,
      textBounds.bottom - 4
    );
  }

  updateStageBadge() {
    const tone = STAGE_TONES[this.currentStage];
    if (tone) {
      this.stageBadge.setText(`阶段${this.currentStage} · ${tone.name}`);
      // 根据阶段切换色调文字
      const tintColors = { cold: '#8899cc', warm: '#ccaa77', dramatic: '#cc8866' };
      this.stageBadge.setColor(tintColors[tone.mood] || '#c4a882');
    }
  }

  onStageChange(newStage) {
    this.currentStage = newStage.id;
    this.updateStageBadge();
    // 刷新游戏状态
    if (this.sessionId) {
      getGameState(this.sessionId)
        .then(state => this.scene.get('GameScene').events.emit('state:refresh', state))
        .catch(() => {});
    }
  }

  fadeInContainer(container, duration = 600) {
    return new Promise(resolve => {
      this.tweens.add({
        targets: container, alpha: 1, duration, ease: 'Sine.easeIn',
        onComplete: resolve,
      });
    });
  }

  fadeOutContainer(container, duration = 600) {
    return new Promise(resolve => {
      this.tweens.add({
        targets: container, alpha: 0, duration, ease: 'Sine.easeOut',
        onComplete: resolve,
      });
    });
  }

  wait(ms) {
    return new Promise(resolve => this.time.delayedCall(ms, resolve));
  }

  // =========================== 输入处理 ===========================

  update() {
    // 历史面板开关（对话外可用）
    if (!this.dialogActive && Phaser.Input.Keyboard.JustDown(this.keyH)) {
      this.toggleHistoryPanel();
    }
    if (this.historyPanelVisible && Phaser.Input.Keyboard.JustDown(this.keyF)) {
      // ESC 也可以用 F 关闭历史
      this.toggleHistoryPanel();
    }

    if (!this.dialogActive || this.isStreaming) return;

    // F 键关闭对话框（翻页中不可以关闭）
    if (Phaser.Input.Keyboard.JustDown(this.keyF)) {
      if (this.dialogClickZone.input && this.dialogClickZone.input.enabled) {
        // 正在翻页，F → 跳过翻页直接到最后一页
        this.dialogCurrentPage = this.dialogPages.length - 1;
        this.showCurrentPage();
        return;
      }
      this.closeDialog();
      return;
    }

    // 数字键选择选项
    const numKeys = [this.key1, this.key2, this.key3];
    for (let i = 0; i < numKeys.length; i++) {
      if (Phaser.Input.Keyboard.JustDown(numKeys[i])) {
        if (i < this.optionButtons.length) {
          const btn = this.optionButtons[i];
          const zone = btn.list && btn.list[btn.list.length - 1];
          if (zone && zone.emit) zone.emit('pointerdown');
          return;
        }
      }
    }
  }

  closeDialog() {
    this.dialogActive = false;
    this.isStreaming = false;
    this.dialogPages = [];
    this.dialogCurrentPage = 0;
    this.pendingOptions = null;
    this.pendingStageChange = null;
    this.pendingEnding = false;
    this.pageHint.setText('');
    this.dialogClickZone.disableInteractive();
    this.stopCursorBlink();
    this.clearOptions();
    this.dialogContainer.setVisible(false);

    const gameScene = this.scene.get('GameScene');
    gameScene.events.emit('input:lock', false);
  }
}
