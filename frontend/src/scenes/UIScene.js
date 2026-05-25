import Phaser from 'phaser';
import { GAME, COLORS, STAGE_TONES, CHAPTER_MAP } from '../config.js';
import {
  startDialogueStream,
  parseSSEStream,
  evaluateEnding,
  getGameState,
  saveToSlot,
  getSaveSlots,
  loadFromSlot,
  deleteSlot,
  startChapter,
  exitDialogue,
  showItemToNpcStream,
  getItems,
  getDialogues,
} from '../api/client.js';
import { createGlobalInput, globalInputValues } from '../main.js';

const MAX_SLOTS_DISPLAY = 6;

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
    this.currentChapterId = null;
    this.currentChapterName = null;

    // 分页状态
    this.dialogPages = [];
    this.dialogCurrentPage = 0;
    this.pendingOptions = null;
    this.pendingChapterChange = null;  // v2: 章节完成数据
    this.pendingEnding = false;

    // 历史对话
    this.dialogueHistory = [];

    // 物品
    this.inventory = [];

    // 暂停/存档菜单状态
    this.pauseMenuVisible = false;
    this.saveSlotsVisible = false;
    this.saveMode = null; // 'save' | 'load'
    this.musicVolume = parseFloat(localStorage.getItem('__music_volume__') || '0.7');

    // 预创建按键
    this.keyF = this.input.keyboard.addKey('F');
    this.key1 = this.input.keyboard.addKey('ONE');
    this.key2 = this.input.keyboard.addKey('TWO');
    this.key3 = this.input.keyboard.addKey('THREE');
    this.key4 = this.input.keyboard.addKey('FOUR');
    this.keyH = this.input.keyboard.addKey('H');
    this.keyI = this.input.keyboard.addKey('I');  // 物品栏
    this.keyESC = this.input.keyboard.addKey('ESC');
    this.keyEnter = this.input.keyboard.addKey('ENTER');

    // 全局自由文本输入框
    this.freeInput = createGlobalInput();
    this.freeInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const text = this.freeInput.value.trim();
        if (text) {
          globalInputValues.current = text;
          this.onFreeInputSubmit(text);
        }
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        this.freeInput.blur();
        this.freeInput.style.display = 'none';
        // DOM input 聚焦时 Phaser 收不到键盘事件，必须直接关闭对话
        this.closeDialog();
        return;
      }
      if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        this.freeInput.blur();
        // 如果处于多页翻页中，F 跳到最后一页
        if (this.dialogClickZone.input && this.dialogClickZone.input.enabled &&
            this.dialogPages.length > 1) {
          this.dialogCurrentPage = this.dialogPages.length - 1;
          this.showCurrentPage();
        } else {
          this.closeDialog();
        }
        return;
      }
    });

    this.createDialogPanel();
    this.createHUD();
    this.createHistoryPanel();
    this.createStageTransitionOverlay();
    this.createEndingScreen();
    this.createPauseMenu();

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

    // 统一内容区域参数（所有文本坐标和遮罩基于此计算）
    const padX = 24;
    const padTop = 60;          // 标题下方
    const padBottom = 50;       // 底部提示上方
    this._historyArea = {
      x: padX,
      y: padTop,
      w: width - padX * 2,
      h: height - padTop - padBottom,
    };

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

    this.historyContent = this.add.container(0, padTop);
    this.historyPanel.add(this.historyContent);

    // 遮罩精确对齐 _historyArea 区域
    const histMaskGfx = this.add.graphics();
    const ha = this._historyArea;
    histMaskGfx.fillRect(ha.x - 4, ha.y - 4, ha.w + 8, ha.h + 8);
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
      if (this.historyContentHeight <= ha.h) return;
      this.historyScrollY = Math.max(
        Math.min(0, this.historyScrollY - deltaY * 0.5),
        -(this.historyContentHeight - ha.h)
      );
      this.historyContent.setY(ha.y + this.historyScrollY);
    });
  }

  toggleHistoryPanel() {
    this.historyPanelVisible = !this.historyPanelVisible;
    if (this.historyPanelVisible) {
      this.refreshHistoryContent();
      this.historyPanel.setVisible(true);
      // 历史面板打开时禁用对话框点击，避免误触发翻页
      this.dialogClickZone.disableInteractive();
      // 历史面板打开时锁定 WASD 移动输入
      const gameScene = this.scene.get('GameScene');
      if (gameScene) gameScene.events.emit('input:lock', true);
    } else {
      this.historyPanel.setVisible(false);
      // 恢复对话框点击（如果还在分页中且未结束）
      if (this.dialogActive && !this.isStreaming && this.dialogPages.length > 1 &&
          this.dialogCurrentPage < this.dialogPages.length - 1) {
        this.dialogClickZone.setInteractive({ useHandCursor: true });
      }
      // 关闭历史面板时，若当前没有活跃对话则恢复 WASD 移动
      if (!this.dialogActive) {
        const gameScene = this.scene.get('GameScene');
        if (gameScene) gameScene.events.emit('input:lock', false);
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
    const ha = this._historyArea;
    // wordWrap 宽度留 10px 安全边距，确保不超出区域
    const maxW = ha.w - 10;
    let y = 0;

    if (this.dialogueHistory.length === 0) {
      const empty = this.add.text(width / 2, 20, '还没有任何对话记录', {
        fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
        fontSize: '14px', color: '#666655',
      }).setOrigin(0.5, 0);
      this.historyContent.add(empty);
      this.historyContentHeight = 120;
      return;
    }

    this.dialogueHistory.forEach((entry, idx) => {
      if (idx === 0 || entry.stage !== this.dialogueHistory[idx - 1].stage) {
        const sep = this.add.text(ha.w / 2, y, `—— 第${entry.stage}章 ——`, {
          fontFamily: '"KaiTi","SimSun",serif',
          fontSize: '14px', color: '#998866',
        }).setOrigin(0.5, 0);
        this.historyContent.add(sep);
        y += 30;
      }

      const npcLabel = this.add.text(ha.x, y, `【${entry.npcName}】`, {
        fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
        fontSize: '14px', color: '#d4b896', fontStyle: 'bold',
      });
      this.historyContent.add(npcLabel);
      y += 22;

      const npcT = this.add.text(ha.x, y, entry.npcText, {
        fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
        fontSize: '13px', color: '#c0b898',
        wordWrap: { width: maxW, useAdvancedWrap: true },
        lineSpacing: 4,
      });
      this.historyContent.add(npcT);
      y += npcT.height + 10;

      if (entry.playerText) {
        const pl = this.add.text(ha.x, y, `【你】${entry.playerText}`, {
          fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
          fontSize: '12px', color: '#88aacc',
          wordWrap: { width: maxW, useAdvancedWrap: true },
        });
        this.historyContent.add(pl);
        y += pl.height + 18;
      }
    });

    this.historyContentHeight = y;
    this.historyScrollY = 0;
    this.historyContent.setY(this._historyArea.y);
  }

  // =========================== 对话框面板 ===========================

  createDialogPanel() {
    const { width, height } = this.cameras.main;
    const panelW = width - 80;
    const panelH = 250;
    const panelX = (width - panelW) / 2;
    const panelY = height - panelH - 24;

    // 统一对话框区域参数（所有内部元素基于此定位）
    this._dialogArea = { x: panelX, y: panelY, w: panelW, h: panelH };
    // 文本安全区：名称栏下方 → 选项/输入框上方
    this._textArea = {
      x: panelX + 20,
      y: panelY + 46,
      w: panelW - 40,
      h: panelH - 40 - 74,   // 减去名称区(36px) + 底部选项+输入区(~74px)
    };

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
    const ta = this._textArea;
    this.dialogText = this.add.text(ta.x, ta.y, '', {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
      fontSize: '15px', color: '#e8dcc8',
      wordWrap: { width: ta.w, useAdvancedWrap: true },
      lineSpacing: 6,
    });
    this.dialogContainer.add(this.dialogText);

    // 遮罩：防止流式输出时文字溢出到选项区，精确对齐 _textArea
    const textMaskGfx = this.add.graphics();
    textMaskGfx.fillRect(ta.x - 4, ta.y - 4, ta.w + 8, ta.h + 8);
    textMaskGfx.setVisible(false);
    const textMask = textMaskGfx.createGeometryMask();
    this.dialogText.setMask(textMask);
    this.dialogTextMask = textMask;
    this._maskHeight = ta.h;

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
    this.pageHint = this.add.text(panelX + panelW - 150, panelY + panelH - 50, '', {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
      fontSize: '11px', color: '#c4a882',
    });
    this.dialogContainer.add(this.pageHint);

    // 提示文字（"按F关闭"等）
    this.dialogHint = this.add.text(panelX + panelW - 150, panelY + panelH - 52, '[F] 关闭', {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
      fontSize: '11px', color: '#888878',
    });
    this.dialogContainer.add(this.dialogHint);

    // 对话框翻页点击区（覆盖文本区域）
    this.dialogClickZone = this.add.zone(
      panelX + panelW / 2,
      panelY + 36 + (panelH - 36 - 70) / 2,
      panelW - 8,
      panelH - 36 - 70
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

    // 始终显示自由输入框
    this.showFreeInput();

    if (!options || options.length === 0) {
      this.dialogHint.setText('[F] 关闭对话  [输入] 自由回复  [点击] 跳过');
      // 无选项时启用对话框点击区，点击直接关闭对话
      this.dialogClickZone.setInteractive({ useHandCursor: true });
      return;
    }

    // 兼容后端返回的字符串数组 ["text1", "text2"]
    const normalized = options.map((opt, i) => {
      if (typeof opt === 'string') return { id: i + 1, text: opt };
      return opt;
    });

    const { width, height } = this.cameras.main;
    const da = this._dialogArea || {
      x: (width - (width - 80)) / 2, y: height - 250 - 24,
      w: width - 80, h: 250,
    };
    const { x: panelX, y: panelY, w: panelW, h: panelH } = da;
    const inputY = panelY + panelH - 38;

    // 布局策略：<=3 横排，>=4 双列网格（避免4个横排时每个按钮过窄）
    const useGrid = normalized.length >= 4;
    const cols = useGrid ? 2 : normalized.length;
    const gapX = 12;
    const gapY = 8;
    const btnW = useGrid
      ? (panelW - 40 - gapX) / 2
      : Math.min(280, (panelW - 40 - (cols - 1) * gapX) / cols);

    // 先测量每个选项文本所需高度
    const btnHeights = normalized.map(opt => {
      const wrapW = Math.max(60, btnW - 44);
      const temp = this.add.text(0, 0, opt.text, {
        fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
        fontSize: '13px', color: '#d0c8b4',
        wordWrap: { width: wrapW, useAdvancedWrap: true },
      });
      const h = Math.max(36, Math.min(60, temp.height + 14));
      temp.destroy();
      return h;
    });

    const rows = Math.ceil(normalized.length / cols);
    const rowHeights = [];
    for (let r = 0; r < rows; r++) {
      let maxH = 0;
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        if (idx < btnHeights.length) maxH = Math.max(maxH, btnHeights[idx]);
      }
      rowHeights.push(maxH);
    }

    const totalH = rowHeights.reduce((a, b) => a + b, 0) + (rows - 1) * gapY;
    // 按钮区域底部紧贴输入框上方，留 16px 间隙避免遮挡
    const bottomY = inputY - 16;
    const topY = bottomY - totalH;
    const startX = panelX + 20;

    let y = topY;
    normalized.forEach((opt, i) => {
      const r = Math.floor(i / cols);
      const c = i % cols;
      const x = startX + c * (btnW + gapX);
      const h = btnHeights[i];
      const rowH = rowHeights[r];
      const btnY = y + (rowH - h) / 2; // 在行内垂直居中
      const btn = this.createOptionButton(x, btnY, btnW, h, opt, i);
      this.optionButtons.push(btn);
      if (c === cols - 1 || i === normalized.length - 1) {
        y += rowH + gapY;
      }
    });

    const maxOptNum = Math.min(normalized.length, 4);
    let hint = '[F] 关闭';
    if (maxOptNum > 0) hint += `  [1-${maxOptNum}] 选择`;
    hint += '  [输入] 自由回复';
    this.dialogHint.setText(hint);
  }

  /**
   * 显示自由文本输入框
   */
  showFreeInput() {
    if (!this.freeInput || !this.dialogContainer.visible) return;
    const { width, height } = this.cameras.main;
    const da = this._dialogArea || {
      x: (width - (width - 80)) / 2, y: height - 250 - 24,
      w: width - 80, h: 250,
    };
    const { x: panelX, y: panelY, w: panelW, h: panelH } = da;
    const inputY = panelY + panelH - 38;

    // 获取 canvas 在页面中的实际位置和缩放
    const canvas = this.sys.game.canvas;
    const rect = canvas.getBoundingClientRect();
    const scaleX = rect.width / width;
    const scaleY = rect.height / height;
    const left = rect.left + panelX * scaleX + 20 * scaleX;
    const top = rect.top + inputY * scaleY;
    const iw = (panelW - 40) * scaleX;

    this.freeInput.style.display = 'block';
    this.freeInput.style.left = `${left}px`;
    this.freeInput.style.top = `${top}px`;
    this.freeInput.style.width = `${iw}px`;
    this.freeInput.style.fontSize = `${13 * scaleY}px`;
    this.freeInput.value = '';
    this.freeInput.placeholder = '输入你想说的话……';
    setTimeout(() => this.freeInput.focus(), 100);
  }

  /**
   * 隐藏自由文本输入框
   */
  hideFreeInput() {
    if (this.freeInput) {
      this.freeInput.style.display = 'none';
      this.freeInput.value = '';
    }
  }

  /**
   * 自由文本输入提交
   */
  async onFreeInputSubmit(text) {
    if (this.isStreaming || !this.dialogActive) return;
    this.isStreaming = true;
    this.hideFreeInput();

    // 记录玩家自由输入到历史
    if (this.currentNPC && text) {
      this.addToHistory(this.currentNPC.name, null, text);
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
        text
      );
      await this.processDialogueStream(stream);
    } catch (err) {
      console.error('[UIScene] 自由输入对话失败:', err);
      this.dialogText.setText('【网络开小差了，请重试】');
      this.dialogHint.setText('[F] 关闭');
    }
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

    // 使用 _textArea 高度，留 4px 安全边距
    const ta = this._textArea || { w: (this.cameras.main.width - 80) - 40, h: 250 - 40 - 74 };
    const maxTextH = ta.h - 4;

    // 用 dialogText 做测量，临时保存原值
    const savedText = this.dialogText.text;
    const savedStyle = { ...this.dialogText.style };

    // 临时移除遮罩，保证 height 测量不受裁剪影响
    const savedMask = this.dialogText.mask;
    this.dialogText.setMask(null);

    // 确保测量时使用与显示一致的 wordWrap 配置
    this.dialogText.setWordWrapWidth(ta.w, true);

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

    // 恢复遮罩和原文本
    if (savedMask) this.dialogText.setMask(savedMask);
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

  // =========================== 暂停/存档菜单 ===========================

  createPauseMenu() {
    const { width, height } = this.cameras.main;
    this.pauseContainer = this.add.container(0, 0).setDepth(700).setVisible(false);

    // 半透明遮罩
    const overlay = this.add.graphics();
    overlay.fillStyle(0x000000, 0.6);
    overlay.fillRect(0, 0, width, height);
    overlay.setInteractive(new Phaser.Geom.Rectangle(0, 0, width, height),
      Phaser.Geom.Rectangle.Contains);
    this.pauseContainer.add(overlay);

    const cx = width / 2;
    const cy = height / 2;

    // 菜单面板背景（加高以容纳5项）
    const panelH = 370;
    const panelW = 320;
    const panelBg = this.add.graphics();
    panelBg.fillStyle(0x1a1820, 0.95);
    panelBg.fillRoundedRect(cx - panelW/2, cy - panelH/2, panelW, panelH, 10);
    panelBg.lineStyle(1, 0xc4a882, 0.6);
    panelBg.strokeRoundedRect(cx - panelW/2, cy - panelH/2, panelW, panelH, 10);
    this.pauseContainer.add(panelBg);

    // 标题
    const title = this.add.text(cx, cy - panelH/2 + 30, '—— 游戏菜单 ——', {
      fontFamily: '"KaiTi","SimSun",serif',
      fontSize: '18px', color: '#d4b896',
    }).setOrigin(0.5);
    this.pauseContainer.add(title);

    // 分割线
    const divider = this.add.graphics();
    divider.lineStyle(1, 0xc4a882, 0.25);
    divider.lineBetween(cx - 140, cy - panelH/2 + 52, cx + 140, cy - panelH/2 + 52);
    this.pauseContainer.add(divider);

    // ===== 按钮配置 =====
    const btnW = 220;
    const btnH = 36;
    const startY = cy - panelH/2 + 72;
    const gap = 48;

    const makeBtn = (label, y, cb) => {
      const bg = this.add.graphics();
      const drawBtn = (hover) => {
        bg.clear();
        bg.fillStyle(hover ? 0x3a3830 : 0x2a2824, 1);
        bg.fillRoundedRect(cx - btnW/2, y - btnH/2, btnW, btnH, 4);
        bg.lineStyle(1, hover ? 0xd4b896 : 0x887766, 0.6);
        bg.strokeRoundedRect(cx - btnW/2, y - btnH/2, btnW, btnH, 4);
      };
      drawBtn(false);
      const text = this.add.text(cx, y, label, {
        fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
        fontSize: '15px', color: '#d0c8b4',
      }).setOrigin(0.5);
      const zone = this.add.zone(cx, y, btnW, btnH)
        .setInteractive({ useHandCursor: true });
      zone.on('pointerover', () => drawBtn(true));
      zone.on('pointerout', () => drawBtn(false));
      zone.on('pointerdown', cb);
      this.pauseContainer.add([bg, text, zone]);
    };

    makeBtn('继续游戏', startY, () => this.togglePauseMenu());
    makeBtn('保存存档', startY + gap, () => this.showSaveLoadPanel('save'));
    makeBtn('加载存档', startY + gap * 2, () => this.showSaveLoadPanel('load'));

    // ===== 音乐音量滑动条 =====
    this.createVolumeSlider(cx, startY + gap * 3);

    makeBtn('返回主菜单', startY + gap * 4, () => this.onReturnToMenu());

    // 底部提示
    this.pauseContainer.add(
      this.add.text(cx, cy + panelH/2 - 20, '[ESC] 关闭 · 点击操作', {
        fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
        fontSize: '11px', color: '#666655',
      }).setOrigin(0.5)
    );
  }

  /**
   * 音乐音量滑动条
   */
  createVolumeSlider(cx, y) {
    const sliderW = 200;
    const sliderH = 8;
    const knobR = 10;
    const left = cx - sliderW / 2;

    // 标签
    const label = this.add.text(cx, y - 12, '🎵 音乐音量', {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
      fontSize: '13px', color: '#998866',
    }).setOrigin(0.5);
    this.pauseContainer.add(label);

    // 滑轨背景
    const trackBg = this.add.graphics();
    trackBg.fillStyle(0x333333, 1);
    trackBg.fillRoundedRect(cx - sliderW/2, y + 4, sliderW, sliderH, 4);
    this.pauseContainer.add(trackBg);

    // 已填充部分
    const trackFill = this.add.graphics();
    const drawTrackFill = (vol) => {
      trackFill.clear();
      trackFill.fillStyle(0xc4a882, 0.8);
      trackFill.fillRoundedRect(cx - sliderW/2, y + 4, sliderW * vol, sliderH, 4);
    };
    drawTrackFill(this.musicVolume);
    this.pauseContainer.add(trackFill);

    // 拖动滑块
    const knob = this.add.graphics();
    const drawKnob = (vol, hover) => {
      knob.clear();
      const kx = left + sliderW * vol;
      knob.fillStyle(hover ? 0xe8d8b8 : 0xd4b896, 1);
      knob.fillCircle(kx, y + 8, knobR);
      knob.lineStyle(1, 0x887766, 0.5);
      knob.strokeCircle(kx, y + 8, knobR);
    };
    drawKnob(this.musicVolume, false);
    this.pauseContainer.add(knob);

    // 左箭头（减小音量）
    const leftArrow = this.add.text(left - 24, y + 2, '◀', {
      fontSize: '14px', color: '#887766',
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    leftArrow.on('pointerdown', () => {
      const v = Math.max(0, Math.round((this.musicVolume - 0.1) * 10) / 10);
      this.setVolume(v, drawTrackFill, drawKnob);
    });
    leftArrow.on('pointerover', () => leftArrow.setColor('#d4b896'));
    leftArrow.on('pointerout', () => leftArrow.setColor('#887766'));
    this.pauseContainer.add(leftArrow);

    // 右箭头（增大音量）
    const rightArrow = this.add.text(left + sliderW + 24, y + 2, '▶', {
      fontSize: '14px', color: '#887766',
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    rightArrow.on('pointerdown', () => {
      const v = Math.min(1, Math.round((this.musicVolume + 0.1) * 10) / 10);
      this.setVolume(v, drawTrackFill, drawKnob);
    });
    rightArrow.on('pointerover', () => rightArrow.setColor('#d4b896'));
    rightArrow.on('pointerout', () => rightArrow.setColor('#887766'));
    this.pauseContainer.add(rightArrow);

    // 滑块拖拽交互
    const knobZone = this.add.zone(cx, y + 8, sliderW + knobR * 2, knobR * 3)
      .setInteractive({ draggable: true, useHandCursor: true });
    this.pauseContainer.add(knobZone);

    let isDragging = false;
    knobZone.on('dragstart', () => { isDragging = true; });
    knobZone.on('drag', (_p, dragX) => {
      const rel = Phaser.Math.Clamp(dragX, left, left + sliderW) - left;
      const vol = Math.round((rel / sliderW) * 10) / 10;
      this.setVolume(vol, drawTrackFill, drawKnob);
    });
    knobZone.on('dragend', () => { isDragging = false; });

    // 点击滑轨跳转
    const trackZone = this.add.zone(cx, y + 8, sliderW, sliderH + 10)
      .setInteractive({ useHandCursor: true });
    this.pauseContainer.add(trackZone);
    trackZone.on('pointerdown', (pointer) => {
      const rel = Phaser.Math.Clamp(pointer.x, left, left + sliderW) - left;
      const vol = Math.round((rel / sliderW) * 10) / 10;
      this.setVolume(vol, drawTrackFill, drawKnob);
    });

    // 存储绘图引用供外部更新
    this._volDrawFill = drawTrackFill;
    this._volDrawKnob = drawKnob;
  }

  setVolume(vol, drawFill, drawKnob) {
    this.musicVolume = vol;
    localStorage.setItem('__music_volume__', String(vol));
    if (drawFill) drawFill(vol);
    if (drawKnob) drawKnob(vol, false);
    // 尝试更新 GameScene 中的音效音量（如已实现）
    const gameScene = this.scene.get('GameScene');
    if (gameScene && gameScene.setMusicVolume) {
      gameScene.setMusicVolume(vol);
    }
  }

  togglePauseMenu() {
    this.pauseMenuVisible = !this.pauseMenuVisible;
    this.pauseContainer.setVisible(this.pauseMenuVisible);
    this.saveSlotsVisible = false;
    if (this.saveSlotContainer) this.saveSlotContainer.setVisible(false);

    const gameScene = this.scene.get('GameScene');
    gameScene.events.emit('input:lock', this.pauseMenuVisible);
    // 暂停时不锁定 F/H 键（需要菜单操作）
  }

  showSaveLoadPanel(mode) {
    this.saveMode = mode;
    this.saveSlotsVisible = true;
    this.renderSaveSlots();
  }

  renderSaveSlots() {
    if (this.saveSlotContainer) this.saveSlotContainer.destroy();
    const { width, height } = this.cameras.main;
    this.saveSlotContainer = this.add.container(0, 0).setDepth(701);

    const cx = width / 2;
    const titleText = this.saveMode === 'save' ? '—— 保存存档 ——' : '—— 加载存档 ——';

    const title = this.add.text(cx, height / 2 - 165, titleText, {
      fontFamily: '"KaiTi","SimSun",serif',
      fontSize: '16px', color: '#d4b896',
    }).setOrigin(0.5);
    this.saveSlotContainer.add(title);

    const slots = getSaveSlots();

    if (slots.length === 0) {
      const empty = this.add.text(cx, height / 2 - 80,
        this.saveMode === 'save' ? '点击空槽位保存' : '没有可用存档',
        { fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
          fontSize: '13px', color: '#666655' }).setOrigin(0.5);
      this.saveSlotContainer.add(empty);
    }

    const maxShow = this.saveMode === 'save' ? MAX_SLOTS_DISPLAY : slots.length;
    for (let i = 0; i < maxShow; i++) {
      const slotY = height / 2 - 120 + i * 45;
      const slotId = this.saveMode === 'save' ? (i + 1) : slots[i]?.id;
      const slot = this.saveMode === 'save'
        ? slots.find(s => s.id === i + 1)
        : slots[i];

      // 槽位标签
      const labelBg = this.add.graphics();
      const hasSlot = !!slot;
      labelBg.fillStyle(hasSlot ? 0x2a2824 : 0x1a1a25, 0.9);
      labelBg.fillRoundedRect(cx - 180, slotY, 360, 36, 4);
      labelBg.lineStyle(1, hasSlot ? 0xc4a882 : 0x443322, hasSlot ? 0.5 : 0.2);
      labelBg.strokeRoundedRect(cx - 180, slotY, 360, 36, 4);
      this.saveSlotContainer.add(labelBg);

      const labelText = hasSlot
        ? `槽位${slot.id} — ${slot.label}`
        : `槽位 ${i + 1} — 空`;
      const label = this.add.text(cx - 165, slotY + 18, labelText, {
        fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
        fontSize: '12px', color: hasSlot ? '#c0b898' : '#555544',
      }).setOrigin(0, 0.5);
      this.saveSlotContainer.add(label);

      // 操作按钮区域
      if (this.saveMode === 'save') {
        const btn = this.add.text(cx + 150, slotY + 18, hasSlot ? '覆盖' : '保存', {
          fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
          fontSize: '12px', color: '#d4b896',
          backgroundColor: '#2a2824', padding: { x: 8, y: 3 },
        }).setOrigin(1, 0.5).setInteractive({ useHandCursor: true });
        btn.on('pointerdown', () => this.onSaveGame(i + 1));
        btn.on('pointerover', () => btn.setColor('#e8dcc8'));
        btn.on('pointerout', () => btn.setColor('#d4b896'));
        this.saveSlotContainer.add(btn);
      } else if (hasSlot) {
        const loadBtn = this.add.text(cx + 145, slotY + 18, '读取', {
          fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
          fontSize: '12px', color: '#d4b896',
          backgroundColor: '#2a2824', padding: { x: 8, y: 3 },
        }).setOrigin(1, 0.5).setInteractive({ useHandCursor: true });
        loadBtn.on('pointerdown', () => this.onLoadGame(slot.id));

        const delBtn = this.add.text(cx + 90, slotY + 18, '删除', {
          fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
          fontSize: '11px', color: '#886666',
          backgroundColor: '#2a2824', padding: { x: 6, y: 3 },
        }).setOrigin(1, 0.5).setInteractive({ useHandCursor: true });
        delBtn.on('pointerdown', () => {
          deleteSlot(slot.id);
          this.renderSaveSlots();
        });

        this.saveSlotContainer.add([loadBtn, delBtn]);
      }
    }

    // 返回按钮
    const backBtn = this.add.text(cx, height / 2 + 155, '[← 返回]', {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
      fontSize: '13px', color: '#887766',
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    backBtn.on('pointerdown', () => {
      this.saveSlotsVisible = false;
      if (this.saveSlotContainer) this.saveSlotContainer.setVisible(false);
    });
    backBtn.on('pointerover', () => backBtn.setColor('#c4a882'));
    backBtn.on('pointerout', () => backBtn.setColor('#887766'));
    this.saveSlotContainer.add(backBtn);
  }

  async onSaveGame(slotId) {
    if (!this.sessionId) return;
    try {
      const state = await getGameState(this.sessionId);
      state._saved_stage = this.currentStage;
      saveToSlot(this.sessionId, state, slotId);
      this.showSaveToast('存档成功!');
      this.renderSaveSlots();
    } catch (e) {
      this.showSaveToast('存档失败');
    }
  }

  async onLoadGame(slotId) {
    const state = loadFromSlot(slotId);
    if (!state) {
      this.showSaveToast('存档损坏');
      return;
    }
    this.pauseContainer.setVisible(false);
    this.pauseMenuVisible = false;
    this.saveSlotsVisible = false;
    if (this.saveSlotContainer) this.saveSlotContainer.setVisible(false);

    const gameScene = this.scene.get('GameScene');
    // 保存当前对话状态到历史
    if (this.dialogActive) this.closeDialog();
    // 重新启动 GameScene 并加载存档
    this.scene.stop('GameScene');
    this.scene.stop('UIScene');
    this.time.delayedCall(200, () => {
      this.scene.start('GameScene', { savedSessionId: slotId });
    });
  }

  onReturnToMenu() {
    this.pauseContainer.setVisible(false);
    this.pauseMenuVisible = false;
    if (this.saveSlotContainer) this.saveSlotContainer.destroy();
    this.saveSlotsVisible = false;

    const gameScene = this.scene.get('GameScene');
    gameScene.events.emit('input:lock', false);
    // 保存当前 session 供菜单"继续游戏"使用
    if (this.sessionId) {
      localStorage.setItem('__active_session__', this.sessionId);
    }
    this.scene.stop('GameScene');
    this.scene.stop('UIScene');
    this.scene.start('MenuScene');
  }

  showSaveToast(msg) {
    const { width, height } = this.cameras.main;
    const toast = this.add.text(width / 2, height / 2 + 180, msg, {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
      fontSize: '14px', color: '#d4b896',
      backgroundColor: '#2a2824ee', padding: { x: 16, y: 8 },
    }).setOrigin(0.5).setDepth(705);

    this.tweens.add({
      targets: toast, alpha: 0, y: toast.y - 20,
      duration: 1800, delay: 600,
      onComplete: () => toast.destroy(),
    });
  }

  onGameInit(data) {
    this.sessionId = data.sessionId;
    this.currentStage = data.stage || 1;
    this.currentChapterId = data.chapterId || null;
    this.currentChapterName = data.chapterName || null;
    this.inventory = data.inventory || [];
    this.updateStageBadge();

    // 加载存档时，从后端恢复对话历史
    if (this.sessionId) {
      this.restoreDialogueHistory(this.sessionId);
    }
  }

  /**
   * 从后端 API 恢复对话历史到本地 memory
   */
  async restoreDialogueHistory(sessionId) {
    try {
      const result = await getDialogues(sessionId);
      if (!result || !result.items || result.items.length === 0) {
        console.log('[UIScene] 后端无对话历史可恢复，尝试 localStorage 缓存');
        this._tryRestoreHistoryFromCache(sessionId);
        return;
      }
      // 按时间排序，重建对话历史
      result.items.sort((a, b) => (a.id || 0) - (b.id || 0));
      let lastName = null;
      let pendingNpcText = '';
      result.items.forEach((entry) => {
        // 提取纯文本内容（防止 content 包含 JSON 对象）
        const cleanContent = this._extractDialogueText(entry.content);
        
        if (entry.role === 'npc') {
          // NPC 发言
          if (pendingNpcText) {
            // 上一条 NPC 发言先写入
            this.addToHistory(lastName, pendingNpcText);
          }
          pendingNpcText = cleanContent || '';
          lastName = this._resolveNpcName(entry.npc_id);
        } else if (entry.role === 'player') {
          // 玩家发言：先清掉上条 NPC 待写入，再记录玩家
          if (pendingNpcText) {
            this.addToHistory(lastName, pendingNpcText);
            pendingNpcText = '';
          }
          this.addToHistory(lastName || 'NPC', null, cleanContent);
        }
      });
      // 最后一条 NPC 文本
      if (pendingNpcText) {
        this.addToHistory(lastName, pendingNpcText);
      }
      console.log(`[UIScene] 已恢复 ${this.dialogueHistory.length} 条对话历史`);

      // 缓存到 localStorage
      try {
        localStorage.setItem(`__dialogue_history_${sessionId}`, JSON.stringify(this.dialogueHistory));
      } catch (e) { /* ignore */ }
    } catch (e) {
      console.warn('[UIScene] 恢复对话历史失败，尝试本地缓存:', e.message);
      this._tryRestoreHistoryFromCache(sessionId);
    }
  }

  /**
   * 提取纯对话文本（处理后端返回的可能包含 JSON 的 content）
   */
  _extractDialogueText(content) {
    if (!content) return '';
    if (typeof content !== 'string') {
      // 如果 content 已经是对象，尝试提取 dialogue_text 或 text 字段
      if (content.dialogue_text) return content.dialogue_text;
      if (content.text) return content.text;
      if (content.content) return this._extractDialogueText(content.content);
      return JSON.stringify(content);
    }
    // 检查是否是 JSON 字符串
    const trimmed = content.trim();
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) ||
        (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        const parsed = JSON.parse(trimmed);
        // 递归提取文本字段
        if (parsed.dialogue_text) return parsed.dialogue_text;
        if (parsed.text) return parsed.text;
        if (parsed.content) return this._extractDialogueText(parsed.content);
        // 如果解析成功但没有找到合适的字段，返回原始字符串（可能是合法的文本内容）
        return content;
      } catch (e) {
        // 不是有效的 JSON，返回原文本
        return content;
      }
    }
    return content;
  }

  _resolveNpcName(npcId) {
    // 优先从 GameScene 的 NPC 列表中获取名字
    const gameScene = this.scene.get('GameScene');
    if (gameScene && gameScene.npcs) {
      const found = gameScene.npcs.find(s => s.getData && s.getData('npcId') === npcId);
      if (found) return found.getData('name');
    }
    // 回退到静态映射
    const NPC_NAME_MAP = {
      'npc_chen': '陈师傅', 'npc_xiaohua': '小华', 'npc_laozhou': '老周',
      'npc_meiyi': '梅姨', 'npc_doctor': '郎中', 'npc_elder': '村长',
      'npc_laoli': '船夫老李',
    };
    return NPC_NAME_MAP[npcId] || npcId || '未知';
  }

  _tryRestoreHistoryFromCache(sessionId) {
    try {
      const cached = localStorage.getItem(`__dialogue_history_${sessionId}`);
      if (cached) {
        this.dialogueHistory = JSON.parse(cached);
        console.log(`[UIScene] 从 localStorage 恢复 ${this.dialogueHistory.length} 条对话历史`);
      }
    } catch (e) { /* ignore */ }
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
        // 流式输出时如果文本超出安全高度，截断显示并隐藏光标
        const maxTextH = (this._maskHeight || 136) - 4;
        if (this.dialogText.height > maxTextH) {
          // 文本已超出可视区域，二分查找截断点
          let lo = 0, hi = accumulatedText.length;
          while (lo < hi) {
            const mid = Math.floor((lo + hi + 1) / 2);
            this.dialogText.setText(accumulatedText.slice(0, mid));
            if (this.dialogText.height <= maxTextH) {
              lo = mid;
            } else {
              hi = mid - 1;
            }
          }
          this.cursorBlink.setVisible(false);
        } else {
          this.updateCursorPosition();
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

        // v2: 章节完成检测（兼容旧格式 stage_changed）
        this.pendingChapterChange = null;
        if (result.chapter_completed) {
          this.pendingChapterChange = { chapterCompleted: true };
          this.markChapterCompleted(result.current_chapter);
        }
        this.pendingEnding = result.game_ended || result.ending_triggered || false;

        // 更新当前章节信息
        if (result.current_chapter) {
          this.currentChapterId = result.current_chapter.chapter_id;
          this.currentChapterName = result.current_chapter.chapter_name;
        }

        // 显示第一页
        this.showCurrentPage();

        // 结局直接触发
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
   * 分页结束 — 显示选项、触发章节推进等
   */
  async finishPagination() {
    this.pageHint.setText('');
    this.dialogClickZone.disableInteractive();

    // v2: 章节完成后，先关闭对话框，再开始下一章
    if (this.pendingChapterChange && this.pendingChapterChange.chapterCompleted) {
      await this.handleChapterComplete();
      return;
    }

    if (!this.pendingEnding) {
      this.showOptions(this.pendingOptions);
    }
  }

  /**
   * 处理章节完成 → 推进到下一章
   */
  async handleChapterComplete() {
    this.dialogContainer.setVisible(false);
    this.clearOptions();
    this.hideFreeInput();

    // 解锁 GameScene 输入（允许移动）
    const gameScene = this.scene.get('GameScene');
    gameScene.events.emit('input:lock', false);

    if (!this.sessionId) return;

    try {
      // 调用后端推进章节 API
      const chapterResult = await startChapter(this.sessionId);
      console.log('[UIScene] 章节推进结果:', chapterResult);

      if (chapterResult.game_ended) {
        // 所有章节已完成，触发结局
        this.time.delayedCall(500, () => this.triggerEndingSequence());
        return;
      }

      if (chapterResult.chapter_id) {
        // 显示新章节过渡动画
        const stageId = CHAPTER_MAP[chapterResult.chapter_id] || this.currentStage + 1;
        const tone = STAGE_TONES[stageId];

        // 构造兼容旧格式的 newStage
        const newStage = {
          id: stageId,
          name: chapterResult.chapter_name || (tone ? tone.name : '未知'),
          description: chapterResult.task ? chapterResult.task.description : '',
          color_tone: chapterResult.color_tone || (tone ? tone.mood : 'cold'),
          bgm_mood: chapterResult.bgm_mood || '',
        };

        this.currentStage = stageId;
        this.currentChapterId = chapterResult.chapter_id;
        this.currentChapterName = chapterResult.chapter_name;
        this.updateStageBadge();

        // 通知 GameScene
        gameScene.events.emit('stage:change', newStage);
        gameScene.events.emit('chapter:new', chapterResult);

        // 播放过渡动画
        await this.playStageTransition(newStage);

        // 刷新状态
        if (this.sessionId) {
          const state = await getGameState(this.sessionId);
          gameScene.events.emit('state:refresh', state);
          saveGameState(this.sessionId, state);
        }

        // 关闭对话框状态
        this.dialogActive = false;
        this.pendingChapterChange = null;
      }
    } catch (e) {
      console.error('[UIScene] 章节推进失败:', e);
      this.dialogActive = false;
      this.pendingChapterChange = null;
    }
  }

  /**
   * 标记章节完成（本地记录）
   */
  markChapterCompleted(chapterInfo) {
    if (!chapterInfo) return;
    console.log(`[UIScene] 章节完成: ${chapterInfo.chapter_name} (${chapterInfo.chapter_id})`);
    // 如果有 stage 映射关系则更新
    if (chapterInfo.chapter_id) {
      const mapped = CHAPTER_MAP[chapterInfo.chapter_id];
      if (mapped && mapped > this.currentStage) {
        this.currentStage = mapped;
      }
    }
  }

  /**
   * 对话框点击翻页
   */
  onDialogClick() {
    if (this.isStreaming) return;
    // 没有可翻页内容（空对话或无选项）→ 点击关闭对话
    if (this.dialogPages.length <= 1 && this.dialogCurrentPage >= this.dialogPages.length - 1) {
      this.closeDialog();
      return;
    }
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
    const da = this._dialogArea || {};
    const panelH = da.h || 250;
    const panelY = da.y || (this.cameras.main.height - panelH - 24);
    const maxCursorY = panelY + panelH - 78; // 光标不能超出文本安全区
    const cursorX = textBounds.right + 2;
    const cursorY = Math.min(textBounds.bottom - 4, maxCursorY);
    this.cursorBlink.setPosition(cursorX, cursorY);
  }

  updateStageBadge() {
    const tone = STAGE_TONES[this.currentStage];
    if (tone) {
      const label = this.currentChapterName || tone.name;
      this.stageBadge.setText(`第${this.currentStage}章 · ${label}`);
      const tintColors = { cold: '#8899cc', warm: '#ccaa77', dramatic: '#cc8866', melancholy: '#8899aa', somber: '#998877' };
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
    // ── 统一缓存按键状态（JustDown 每次调用会消费，必须在 update 开头缓存）──
    const escJustDown = Phaser.Input.Keyboard.JustDown(this.keyESC);

    // ── ESC 键：退出暂停菜单 ──
    if (this.pauseMenuVisible && escJustDown) {
      this.togglePauseMenu();
      return;
    }

    // ── ESC 键：退出对话（任何时候，包括流式输出中）──
    if (this.dialogActive && escJustDown) {
      this.closeDialog();
      return;
    }

    // ── ESC 键（游戏中）：打开暂停菜单 ──
    if (!this.dialogActive && !this.pauseMenuVisible && escJustDown) {
      // 检查是否是历史面板打开中
      if (this.historyPanelVisible) {
        this.toggleHistoryPanel();
        return;
      }
      this.togglePauseMenu();
      return;
    }

    // 历史面板开关（对话外可用）
    if (!this.dialogActive && Phaser.Input.Keyboard.JustDown(this.keyH)) {
      this.toggleHistoryPanel();
    }
    if (this.historyPanelVisible && Phaser.Input.Keyboard.JustDown(this.keyF)) {
      this.toggleHistoryPanel();
    }

    if (!this.dialogActive || this.isStreaming) return;

    // F 键关闭对话框（翻页中不可关闭；空对话页直接关闭）
    if (Phaser.Input.Keyboard.JustDown(this.keyF)) {
      if (this.dialogClickZone.input && this.dialogClickZone.input.enabled &&
          this.dialogPages.length > 1) {
        // 正在翻页，F → 跳过翻页直接到最后一页
        this.dialogCurrentPage = this.dialogPages.length - 1;
        this.showCurrentPage();
        return;
      }
      this.closeDialog();
      return;
    }

    // 数字键选择选项（支持最多4个）
    const numKeys = [this.key1, this.key2, this.key3, this.key4];
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

    // Enter 键触发自由文本输入框聚焦
    if (this.dialogActive && !this.isStreaming &&
        this.freeInput && this.freeInput.style.display === 'block' &&
        Phaser.Input.Keyboard.JustDown(this.keyEnter)) {
      if (document.activeElement !== this.freeInput) {
        this.freeInput.focus();
      }
    }
  }

  closeDialog() {
    this.dialogActive = false;
    this.isStreaming = false;
    this.dialogPages = [];
    this.dialogCurrentPage = 0;
    this.pendingOptions = null;
    this.pendingChapterChange = null;
    this.pendingEnding = false;
    this.pageHint.setText('');
    this.dialogClickZone.disableInteractive();
    this.stopCursorBlink();
    this.clearOptions();
    this.hideFreeInput();
    this.dialogContainer.setVisible(false);

    const gameScene = this.scene.get('GameScene');
    gameScene.events.emit('input:lock', false);

    // 持久化对话历史到 localStorage（供存档加载时恢复）
    this._persistDialogueHistory();

    // 调用后端退出对话 API（非阻塞）
    if (this.sessionId && this.currentNPC) {
      const npcId = this.currentNPC.id;
      exitDialogue(this.sessionId, npcId)
        .then(result => {
          console.log('[UIScene] NPC 告别语:', result.dialogue_text);
        })
        .catch(err => {
          console.warn('[UIScene] 退出对话 API 调用失败（不影响游戏流程）:', err.message);
        });
    }
  }

  _persistDialogueHistory() {
    if (!this.sessionId || this.dialogueHistory.length === 0) return;
    try {
      localStorage.setItem(`__dialogue_history_${this.sessionId}`, JSON.stringify(this.dialogueHistory));
    } catch (e) { /* ignore */ }
  }
}
