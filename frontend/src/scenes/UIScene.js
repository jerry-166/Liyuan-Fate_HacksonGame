import Phaser from 'phaser';
import { GAME, COLORS, STAGE_TONES } from '../config.js';
import {
  startDialogueStream,
  parseSSEStream,
  evaluateEnding,
  getGameState,
  exitDialogue,
  getDialogues,
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

    // 自由文本输入 DOM 引用
    this.freeInputWrapper = document.getElementById('free-input-wrapper');
    this.freeInput = document.getElementById('free-input');
    this.freeInputSend = document.getElementById('free-input-send');

    // 预创建按键
    this.key1 = this.input.keyboard.addKey('ONE');
    this.key2 = this.input.keyboard.addKey('TWO');
    this.key3 = this.input.keyboard.addKey('THREE');
    this.keyH = this.input.keyboard.addKey('H');
    this.keyEsc = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);

    this.createDialogPanel();
    this.createHUD();
    this.createHistoryPanel();
    this.createStageTransitionOverlay();
    this.createEndingScreen();
    this.setupFreeInput();

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

    // 面板内边距（与对话面板一致）
    const padX = 20, padTop = 60, padBottom = 40;
    const contentW = width - padX * 2;   // 内容可用宽度
    const contentH = height - padTop - padBottom;  // 内容可用高度

    this.historyPanel = this.add.container(0, 0).setDepth(400).setVisible(false);

    // 半透明背景——全屏
    const bg = this.add.graphics();
    bg.fillStyle(0x0a0a12, 0.93);
    bg.fillRect(0, 0, width, height);
    this.historyPanel.add(bg);

    // 标题
    const titleText = this.add.text(width / 2, 20, '—— 记忆回响 ——', {
      fontFamily: '"KaiTi","SimSun",serif',
      fontSize: '20px', color: '#d4b896',
    }).setOrigin(0.5, 0);
    this.historyPanel.add(titleText);

    // 文本内容容器（从 padTop 开始）
    this.historyContent = this.add.container(padX, padTop);
    this.historyPanel.add(this.historyContent);

    // 记录内容区域尺寸，供渲染使用
    this._historyArea = { x: padX, y: padTop, w: contentW, h: contentH };

    // 遮罩：严格限制在内容区域内（不超出游戏界面）
    const histMaskGfx = this.make.graphics();
    histMaskGfx.fillStyle(0xffffff);
    histMaskGfx.fillRect(padX, padTop, contentW, contentH);
    const histMask = histMaskGfx.createGeometryMask();
    this.historyContent.setMask(histMask);
    this.historyMask = histMask;

    // 底部提示
    const tipText = this.add.text(width / 2, height - 20, '[H] 打开/关闭  |  滚轮滚动', {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
      fontSize: '12px', color: '#666655',
    }).setOrigin(0.5, 0);
    this.historyPanel.add(tipText);

    // 滚轮事件（向下滚动 → 显示更新的内容）
    this.input.on('wheel', (pointer, gameObjects, deltaX, deltaY) => {
      if (!this.historyPanelVisible) return;
      const area = this._historyArea;
      if (this.historyContentHeight <= area.h) return;
      // deltaY > 0 = 向下滚轮 → scrollY 减小 → 容器上移 → 显示后续（更新）内容
      const maxScroll = this.historyContentHeight - area.h;
      this.historyScrollY = Math.max(-maxScroll, Math.min(0, this.historyScrollY - deltaY * 0.5));
      this.historyContent.setY(area.y + this.historyScrollY);
    });
  }

  async toggleHistoryPanel() {
    this.historyPanelVisible = !this.historyPanelVisible;
    if (this.historyPanelVisible) {
      await this.refreshHistoryContent();
      this.historyPanel.setVisible(true);
      this.hideFreeInput();
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

  async refreshHistoryContent() {
    this.historyContent.removeAll(true);
    const area = this._historyArea;
    const maxW = area.w;   // wordWrap 宽度 = 内容区可用宽度
    let y = 0;

    // npc_id → 显示名称 映射（与后端数据对齐）
    const NPC_NAME_MAP = { npc_chen: '陈师傅', npc_xiaohua: '小华' };
    // 尝试从 GameScene 获取最新 NPC 名称映射（覆盖默认值）
    try {
      const gameScene = this.scene.get('GameScene');
      if (gameScene && gameScene.npcs) {
        gameScene.npcs.forEach(npc => {
          if (npc && npc.id && npc.name) NPC_NAME_MAP[npc.id] = npc.name;
        });
      }
    } catch (e) { /* ignore */ }

    // 从后端获取完整对话历史（含所有存档轮次）
    let historyEntries = [];
    if (this.sessionId) {
      try {
        const res = await getDialogues(this.sessionId, null, 1, 100);
        if (res && res.items && res.items.length > 0) {
          historyEntries = res.items.map(item => ({
            npcName: item.role === 'npc' ? (NPC_NAME_MAP[item.npc_id] || item.npc_id || 'NPC') : null,
            npcText: item.role === 'npc' ? (item.content || '') : null,
            playerText: item.role === 'player' ? (item.content || '') : null,
            stage: item.stage || 1,
          }));
        }
      } catch (err) {
        console.warn('[UIScene] 获取对话历史失败，回退到内存数据:', err.message);
      }
    }

    // 回退：如果后端无数据或调用失败，使用内存中的本次游玩记录
    if (historyEntries.length === 0 && this.dialogueHistory.length > 0) {
      historyEntries = [...this.dialogueHistory];
    }

    if (historyEntries.length === 0) {
      const empty = this.add.text(area.w / 2, 20, '还没有任何对话记录', {
        fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
        fontSize: '14px', color: '#666655',
      }).setOrigin(0.5, 0);
      this.historyContent.add(empty);
      this.historyContentHeight = 80;
      return;
    }

    let lastSpeaker = null;  // 用于合并连续同名说话人

    historyEntries.forEach((entry, idx) => {
      // 阶段分隔线
      if (idx === 0 || entry.stage !== historyEntries[idx - 1].stage) {
        const sep = this.add.text(area.w / 2, y, `—— 第${entry.stage}章 ——`, {
          fontFamily: '"KaiTi","SimSun",serif',
          fontSize: '14px', color: '#998866',
        }).setOrigin(0.5, 0);
        this.historyContent.add(sep);
        y += 28;
      }

      // 判断当前说话人
      const currentSpeaker = entry.playerText ? '__player__' : `npc:${entry.npcName}`;

      // NPC 文本（只在说话人变化时显示名字标签）
      if (entry.npcText) {
        if (currentSpeaker !== lastSpeaker) {
          const npcLabel = this.add.text(0, y, `【${entry.npcName}】`, {
            fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
            fontSize: '14px', color: '#d4b896', fontStyle: 'bold',
          });
          this.historyContent.add(npcLabel);
          y += 22;
        }
        const npcT = this.add.text(0, y, entry.npcText, {
          fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
          fontSize: '13px', color: '#c0b898',
          wordWrap: { width: maxW - 10, useAdvancedWrap: true }, lineSpacing: 4,
        });
        this.historyContent.add(npcT);
        y += npcT.height + 8;
        lastSpeaker = currentSpeaker;
      }

      // 玩家回复
      if (entry.playerText) {
        if (currentSpeaker !== lastSpeaker) {
          // 玩家标签
          const plLabel = this.add.text(0, y, `【你】`, {
            fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
            fontSize: '13px', color: '#88aacc', fontStyle: 'bold',
          });
          this.historyContent.add(plLabel);
          y += 20;
        }
        const pl = this.add.text(0, y, entry.playerText, {
          fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
          fontSize: '12px', color: '#88bbdd',
          wordWrap: { width: maxW - 10, useAdvancedWrap: true },
        });
        this.historyContent.add(pl);
        y += pl.height + 16;
        lastSpeaker = currentSpeaker;
      }
    });

    this.historyContentHeight = y;
    this.historyScrollY = 0;
    this.historyContent.setY(area.y);
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

    // 文本区域参数——严格对齐面板内边距（左右各 20px）
    const padLeft = 20, padRight = 20;
    this.textAreaX = panelX + padLeft;
    this.textAreaY = panelY + 46;
    this.textAreaW = panelW - padLeft - padRight;   // 可用宽度 = 面板宽 - 左右边距
    this.textAreaH = panelH - 46 - 60;              // 高度 = 面板高 - 顶部名字区(46) - 底部选项/提示区(60)

    // 对话文本滚动容器
    this.dialogTextScrollY = 0;
    this.dialogTextContainer = this.add.container(this.textAreaX, this.textAreaY).setDepth(300);
    this.dialogContainer.add(this.dialogTextContainer);

    // 对话文本（wordWrap 宽度严格 = 文本区域可用宽度，不多不少）
    this.dialogText = this.add.text(0, 0, '', {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
      fontSize: '15px', color: '#e8dcc8',
      wordWrap: { width: this.textAreaW, useAdvancedWrap: true },
      lineSpacing: 6,
    });
    this.dialogTextContainer.add(this.dialogText);

    // 遮罩：与文本区域完全一致，超出部分裁剪
    const maskGfx = this.make.graphics();
    maskGfx.fillStyle(0xffffff);
    maskGfx.fillRect(this.textAreaX, this.textAreaY, this.textAreaW, this.textAreaH);
    const textMask = maskGfx.createGeometryMask();
    this.dialogTextContainer.setMask(textMask);

    // 滚动条（紧贴在文本区域内右侧边缘，不超出面板）
    const sbX = this.textAreaX + this.textAreaW - 4;   // 在文本区域内右侧
    const sbW = 3;
    this.scrollBarBg = this.add.graphics().setDepth(301);
    this.scrollBarBg.fillStyle(0x444444, 0.2);
    this.scrollBarBg.fillRect(sbX, this.textAreaY, sbW, this.textAreaH);
    this.dialogContainer.add(this.scrollBarBg);

    // 滚动条滑块
    this.scrollBarThumb = this.add.graphics().setDepth(302);
    this._scrollBarConfig = { x: sbX, w: sbW };  // 记录位置供 updateScrollBar 使用
    this.dialogContainer.add(this.scrollBarThumb);

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
    this.dialogHint = this.add.text(panelX + panelW - 150, panelY + panelH - 24, '[ESC] 关闭  [1-3] 选择', {
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

    // 滚轮事件（对话文本滚动）
    this.input.on('wheel', (pointer, gameObjects, deltaX, deltaY) => {
      if (!this.dialogActive || this.isStreaming) return;
      if (pointer.x >= this.textAreaX && pointer.x <= this.textAreaX + this.textAreaW + 20 &&
          pointer.y >= this.textAreaY && pointer.y <= this.textAreaY + this.textAreaH) {
        this.scrollDialogText(deltaY);
      }
    });
  }

  /**
   * 显示选项按钮
   */
  showOptions(options) {
    this.clearOptions();

    if (!options || options.length === 0) {
      this.dialogHint.setText('[ESC] 关闭对话');
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

    // 选项区域可用宽度 = 面板宽 - 左右边距（与文本区域一致）
    const availW = panelW - 40;   // 左右各 20px
    const gap = 8;
    const btnY = panelY + panelH - 50;

    // 动态计算每个按钮宽度，确保总宽度不超出面板
    let btnW = (availW - (options.length - 1) * gap) / options.length;
    if (btnW > 220) btnW = 220;     // 单个最大宽度
    // 二次校验：如果最大宽度限制后仍溢出，进一步缩小
    const totalW = options.length * btnW + (options.length - 1) * gap;
    if (totalW > availW) {
      btnW = (availW - (options.length - 1) * gap) / options.length;
    }

    const startX = panelX + 20 + (availW - totalW) / 2;  // 在可用区域内居中

    normalized.forEach((opt, i) => {
      const x = startX + i * (btnW + gap);
      const btn = this.createOptionButton(x, btnY, btnW, 34, opt, i);
      this.optionButtons.push(btn);
    });

    this.dialogHint.setText(`[ESC] 关闭  [1-${Math.min(options.length, 9)}] 选择`);

    // 显示自由文本输入框
    this.showFreeInput();
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

    // 选项文字（严格限制在按钮背景内）
    const text = this.add.text(30, h / 2, optionData.text, {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
      fontSize: '13px', color: '#d0c8b4',
      wordWrap: { width: Math.max(60, w - 36), useAdvancedWrap: true },
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
    this.hideFreeInput();

    // 开始游标闪烁
    this.startCursorBlink();

    // 发起 SSE 流式对话（首轮，无 player_message）
    try {
      const stream = await startDialogueStream(this.sessionId, npcId, null);
      await this.processDialogueStream(stream);
    } catch (err) {
      this.isStreaming = false;
      this.stopCursorBlink();
      this.dialogText.setText(this.buildErrorMessage(err));
      this.dialogHint.setText('[ESC] 关闭');
      console.error('[UIScene] 对话请求失败:', err);
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
    this.hideFreeInput();
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
      this.isStreaming = false;
      this.stopCursorBlink();
      this.dialogText.setText(this.buildErrorMessage(err));
      this.dialogHint.setText('[ESC] 关闭');
      console.error('[UIScene] 续接对话失败:', err);
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
        // 自动滚动到底部，确保新内容始终可见
        const textHeight = this.dialogText.height;
        const maxScroll = Math.max(0, textHeight - this.textAreaH);
        if (maxScroll > 0) {
          this.dialogTextScrollY = maxScroll;
          this.dialogTextContainer.setY(this.textAreaY - this.dialogTextScrollY);
          this.updateScrollBar(textHeight, maxScroll);
        }
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
          this.dialogHint.setText('[ESC] 关闭对话');
          this.time.delayedCall(1200, () => this.triggerEndingSequence());
        }
      },
      onError: (err) => {
        this.isStreaming = false;
        this.stopCursorBlink();
        this.dialogText.setText(`【出错了】${err.message || 'AI回复失败'}`);
        this.dialogHint.setText('[ESC] 关闭');
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
    this.resetDialogScroll();
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

  // =========================== 自由文本输入 ===========================

  /**
   * 初始化自由文本输入框事件
   * 使用 DOM input 元素，因为 Phaser 没有原生文本输入支持
   */
  setupFreeInput() {
    if (!this.freeInput) return;

    // Enter 键发送
    this.freeInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        this.sendFreeInput();
      }
      // ESC 关闭对话框（阻止浏览器默认行为）
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.hideFreeInput();
        this.closeDialog();
      }
    });

    // 发送按钮点击
    this.freeInputSend.addEventListener('click', (e) => {
      e.stopPropagation();
      this.sendFreeInput();
    });
  }

  /**
   * 显示自由文本输入框
   */
  showFreeInput() {
    if (!this.freeInputWrapper) return;
    this.freeInputWrapper.classList.add('visible');
    this.freeInput.value = '';
    // 延迟聚焦，避免抢夺 Phaser 的键盘事件
    this.time.delayedCall(100, () => {
      this.freeInput.focus();
    });
  }

  /**
   * 隐藏自由文本输入框
   */
  hideFreeInput() {
    if (!this.freeInputWrapper) return;
    this.freeInputWrapper.classList.remove('visible');
    this.freeInput.blur();
  }

  /**
   * 发送自由文本输入内容
   */
  sendFreeInput() {
    const text = this.freeInput.value.trim();
    if (!text || this.isStreaming) return;
    this.hideFreeInput();
    // 构造一个与选项相同格式的对象，复用 onOptionSelected 逻辑
    this.onOptionSelected({ id: 0, text });
  }

  // =========================== 工具方法 ===========================

  /**
   * 根据错误类型构建用户友好提示
   */
  buildErrorMessage(err) {
    const msg = err?.message || String(err);
    if (msg.includes('SESSION_NOT_FOUND')) return '【存档已失效，请开始新游戏】';
    if (msg.includes('NPC_NOT_FOUND') || msg.includes('NPC_NOT_AVAILABLE')) return '【此人暂时不想理你……】';
    if (msg.includes('GAME_ALREADY_ENDED')) return '【故事已经结束了】';
    if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) return '【网络连接失败，请检查后端服务】';
    return '【AI 出神了，请重试】';
  }

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

  scrollDialogText(deltaY) {
    const textHeight = this.dialogText.height;
    const maxScroll = Math.max(0, textHeight - this.textAreaH);
    this.dialogTextScrollY = Math.max(0, Math.min(maxScroll, this.dialogTextScrollY + deltaY * 0.3));
    this.dialogTextContainer.setY(this.textAreaY - this.dialogTextScrollY);
    this.updateScrollBar(textHeight, maxScroll);
  }

  updateScrollBar(textHeight, maxScroll) {
    this.scrollBarThumb.clear();
    if (maxScroll <= 0) {
      this.scrollBarBg.setVisible(false);
      return;
    }
    this.scrollBarBg.setVisible(true);
    const sb = this._scrollBarConfig || {};
    const thumbRatio = this.textAreaH / textHeight;
    const thumbHeight = Math.max(16, this.textAreaH * thumbRatio);
    const scrollRatio = maxScroll > 0 ? this.dialogTextScrollY / maxScroll : 0;
    const thumbY = this.textAreaY + scrollRatio * (this.textAreaH - thumbHeight);
    this.scrollBarThumb.fillStyle(0x887766, 0.6);
    this.scrollBarThumb.fillRect(sb.x || this.textAreaX + this.textAreaW - 4, thumbY, sb.w || 3, thumbHeight);
  }

  resetDialogScroll() {
    this.dialogTextScrollY = 0;
    this.dialogTextContainer.setY(this.textAreaY);
    this.scrollBarThumb.clear();
    this.scrollBarBg.setVisible(false);
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
    // 如果自由输入框正在聚焦，跳过 Phaser 键盘处理
    if (this.freeInput && document.activeElement === this.freeInput) return;

    // 历史面板开关（对话外可用）
    if (!this.dialogActive && Phaser.Input.Keyboard.JustDown(this.keyH)) {
      this.toggleHistoryPanel();
    }

    if (!this.dialogActive || this.isStreaming) return;

    // ESC 键关闭对话框 / 跳过翻页
    if (Phaser.Input.Keyboard.JustDown(this.keyEsc)) {
      if (this.dialogClickZone.input && this.dialogClickZone.input.enabled) {
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
    this.hideFreeInput();
    this.resetDialogScroll();
    this.dialogContainer.setVisible(false);

    const gameScene = this.scene.get('GameScene');
    gameScene.events.emit('input:lock', false);

    // 调用后端退出对话 API（告别语），非阻塞
    if (this.sessionId && this.currentNPC) {
      const npcId = this.currentNPC.id;
      exitDialogue(this.sessionId, npcId)
        .then(result => {
          // 可选：短暂显示告别语气泡（通过 GameScene 刷新 NPC 状态）
          console.log('[UIScene] NPC 告别语:', result.dialogue_text);
        })
        .catch(err => {
          console.warn('[UIScene] 退出对话 API 调用失败（不影响游戏流程）:', err.message);
        });
    }
  }
}
