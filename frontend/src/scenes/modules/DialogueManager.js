/**
 * 对话管理器 —— 处理对话面板创建、SSE 流式显示、文本分页、选项按钮、自由输入
 * 从 UIScene 中提取，通过 uiScene 引用访问场景资源
 * @module scenes/modules/DialogueManager
 */

import { COLORS } from '../../config.js';
import { startDialogueStream, parseSSEStream, showItemToNpcStream } from '../../api/client.js';
import { createGlobalInput, globalInputValues } from '../../main.js';
import { CHARACTER_PORTRAITS, detectPortraitEmotion } from './GameUIHelpers.js';

/**
 * 对话管理器
 * 附加到 UIScene 上使用
 */
export class DialogueManager {
  /**
   * @param {Phaser.Scene} uiScene - UIScene 实例
   */
  constructor(uiScene) {
    this.ui = uiScene;
  }

  /** 创建对话框面板 UI */
  createPanel() {
    const ui = this.ui;
    const { width, height } = ui.cameras.main;
    const panelW = width - 100;
    const panelH = 320;
    const panelX = (width - panelW) / 2;
    const panelY = height - panelH - 28;

    // ★ 立绘占左侧约 28% 宽度（对话框自然覆盖下半身）

    ui._dialogArea = { x: panelX, y: panelY, w: panelW, h: panelH };
    ui._textArea = {
      x: panelX + 28, y: panelY + 50,
      w: panelW - 56, h: panelH - 44 - 80,
    };

    ui.dialogContainer = ui.add.container(0, 0).setDepth(300).setVisible(false);

    // ★ 全屏透明点击区（对话框外部点击关闭对话）
    const outsideClickZone = ui.add.rectangle(width / 2, height / 2, width, height, 0x000000, 0)
      .setInteractive({ useHandCursor: false });
    outsideClickZone.on('pointerdown', () => {
      if (ui.dialogActive) ui.closeDialog();
    });
    ui.dialogContainer.add(outsideClickZone);

    // ★ 立绘图片（左侧，朝向右侧，对话框覆盖其下半身）
    const portraitW = Math.round(width * 0.28);
    const portraitDisplayH = Math.round((height - 32) * 0.75);
    ui.portraitImage = ui.add.image(panelX + portraitW * 0.45, height - 40, '__BLANK__')
      .setOrigin(0.5, 1)
      .setDisplaySize(portraitW, portraitDisplayH)
      .setFlipX(true)  // 统一朝向右侧
      .setAlpha(0)
      .setDepth(0);
    ui.dialogContainer.add(ui.portraitImage);
    ui._portraitDisplayH = portraitDisplayH;
    ui._portraitW = portraitW;

    // 背景
    const bg = ui.add.graphics();
    bg.fillStyle(0x1a1820, 0.92);
    bg.fillRoundedRect(panelX, panelY, panelW, panelH, 10);
    bg.lineStyle(2, COLORS.DIALOG_BORDER, 0.7);
    bg.strokeRoundedRect(panelX, panelY, panelW, panelH, 10);
    bg.lineStyle(1, COLORS.DIALOG_BORDER, 0.35);
    bg.lineBetween(panelX + 16, panelY + 36, panelX + panelW - 16, panelY + 36);
    ui.dialogContainer.add(bg);

    // NPC 名字
    ui.dialogName = ui.add.text(panelX + 28, panelY + 12, '', {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
      fontSize: '20px', color: '#d4b896', fontStyle: 'bold',
    });
    ui.dialogContainer.add(ui.dialogName);

    // 对话文本
    const ta = ui._textArea;
    ui.dialogText = ui.add.text(ta.x, ta.y, '', {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
      fontSize: '20px', color: '#e8dcc8',
      wordWrap: { width: ta.w, useAdvancedWrap: true },
      lineSpacing: 8,
    });
    ui.dialogContainer.add(ui.dialogText);

    // 文本遮罩
    const textMaskGfx = ui.add.graphics();
    textMaskGfx.fillRect(ta.x - 4, ta.y - 4, ta.w + 8, ta.h + 8);
    textMaskGfx.setVisible(false);
    const textMask = textMaskGfx.createGeometryMask();
    ui.dialogText.setMask(textMask);
    ui.dialogTextMask = textMask;
    ui._maskHeight = ta.h;

    // 光标
    ui.cursorBlink = ui.add.text(0, 0, '▎', {
      fontFamily: 'monospace', fontSize: '20px', color: '#d4b896',
    }).setVisible(false);
    ui.dialogContainer.add(ui.cursorBlink);
    ui.cursorTimer = null;

    // 选项容器
    ui.optionButtons = [];
    ui.optionContainer = ui.add.container(0, 0);
    ui.dialogContainer.add(ui.optionContainer);

    // 翻页提示
    ui.pageHint = ui.add.text(panelX + panelW - 150, panelY + panelH - 50, '', {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
      fontSize: '15px', color: '#c4a882',
    });
    ui.dialogContainer.add(ui.pageHint);

    // 提示文字
    ui.dialogHint = ui.add.text(panelX + panelW - 150, panelY + panelH - 52, '[F] 关闭  |  点击外部关闭', {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
      fontSize: '15px', color: '#888878',
    });
    ui.dialogContainer.add(ui.dialogHint);

    // 翻页点击区
    ui.dialogClickZone = ui.add.zone(
      panelX + panelW / 2, panelY + 36 + (panelH - 36 - 70) / 2,
      panelW - 8, panelH - 36 - 70
    ).setInteractive({ useHandCursor: true });
    ui.dialogClickZone.on('pointerdown', () => this.onDialogClick());
    ui.dialogContainer.add(ui.dialogClickZone);
    ui.dialogClickZone.setVisible(false);
  }

  // ==================== 立绘显示 ====================

  /**
   * 显示角色立绘
   * @param {string} npcId - NPC ID（如 'npc_chen'）或 'protagonist'
   * @param {string} [emotion] - 表情变体名，不传使用默认
   */
  showPortrait(npcId, emotion) {
    const ui = this.ui;
    const cfg = CHARACTER_PORTRAITS[npcId];
    if (!cfg) {
      this.hidePortrait();
      return;
    }

    // 确定使用的 portrait key
    let portraitKey = cfg.default;
    if (emotion && cfg.variants[emotion]) {
      portraitKey = cfg.variants[emotion];
    }

    // 检查纹理是否存在
    if (!ui.textures.exists(portraitKey)) {
      console.warn(`[DialogueManager] 立绘纹理 "${portraitKey}" 不存在，使用默认`);
      portraitKey = cfg.default;
      if (!ui.textures.exists(portraitKey)) {
        this.hidePortrait();
        return;
      }
    }

    const { width, height } = ui.cameras.main;
    const portraitW = ui._portraitW || Math.round(width * 0.28);

    // 更新纹理和位置（左侧，朝右，底部锚定）
    ui.portraitImage.setTexture(portraitKey);
    ui.portraitImage.setPosition(ui._dialogArea.x + portraitW * 0.45, height - 40);
    ui.portraitImage.setOrigin(0.5, 1);
    ui.portraitImage.setFlipX(true);
    ui.portraitImage.setDisplaySize(portraitW, ui._portraitDisplayH);

    // 淡入动画
    ui.tweens.killTweensOf(ui.portraitImage);
    ui.portraitImage.setAlpha(0);
    ui.tweens.add({
      targets: ui.portraitImage,
      alpha: 1,
      duration: 350,
      ease: 'Sine.easeInOut',
    });

    ui._currentPortraitNpcId = npcId;
    ui._currentPortraitEmotion = emotion || 'default';
    console.log(`[DialogueManager] 显示立绘: ${npcId} / ${portraitKey}`);
  }

  /**
   * 根据文本情感切换立绘表情
   * @param {string} text - 当前累积的对话文本
   */
  updatePortraitEmotion(text) {
    const ui = this.ui;
    const npcId = ui._currentPortraitNpcId;
    if (!npcId || !text) return;

    const emotion = detectPortraitEmotion(npcId, text);
    if (!emotion || emotion === ui._currentPortraitEmotion) return;

    const cfg = CHARACTER_PORTRAITS[npcId];
    if (!cfg) return;

    const portraitKey = cfg.variants[emotion];
    if (!portraitKey || !ui.textures.exists(portraitKey)) return;

    const { width, height } = ui.cameras.main;
    const portraitW = ui._portraitW || Math.round(width * 0.28);

    // 快速切换表情（短淡入淡出）
    ui.tweens.add({
      targets: ui.portraitImage,
      alpha: 0,
      duration: 150,
      onComplete: () => {
        ui.portraitImage.setTexture(portraitKey);
        ui.portraitImage.setPosition(ui._dialogArea.x + portraitW * 0.45, height - 40);
        ui.portraitImage.setOrigin(0.5, 1);
        ui.portraitImage.setFlipX(true);
        ui.portraitImage.setDisplaySize(portraitW, ui._portraitDisplayH);
        ui.tweens.add({
          targets: ui.portraitImage,
          alpha: 1,
          duration: 250,
          ease: 'Sine.easeInOut',
        });
      },
    });

    ui._currentPortraitEmotion = emotion;
    console.log(`[DialogueManager] 切换立绘表情: ${portraitKey}`);
  }

  /** 隐藏立绘 */
  hidePortrait() {
    const ui = this.ui;
    ui.tweens.killTweensOf(ui.portraitImage);
    ui.tweens.add({
      targets: ui.portraitImage,
      alpha: 0,
      duration: 200,
      ease: 'Sine.easeIn',
    });
    ui._currentPortraitNpcId = null;
    ui._currentPortraitEmotion = null;
  }

  /** 创建自由文本输入框 */
  setupFreeInput() {
    const ui = this.ui;
    ui.freeInput = createGlobalInput();
    ui.freeInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const text = ui.freeInput.value.trim();
        if (text) {
          globalInputValues.current = text;
          this.onFreeInputSubmit(text);
        }
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        ui.freeInput.blur();
        ui.freeInput.style.display = 'none';
        ui.closeDialog();
        return;
      }
      if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        ui.freeInput.blur();
        if (ui.dialogClickZone.input && ui.dialogClickZone.input.enabled && ui.dialogPages.length > 1) {
          ui.dialogCurrentPage = ui.dialogPages.length - 1;
          this.showCurrentPage();
        } else {
          ui.closeDialog();
        }
        return;
      }
    });

    // 外部点击失焦
    document.getElementById('game-container').addEventListener('mousedown', (e) => {
      if (ui.freeInput && ui.freeInput.style.display === 'block' &&
        e.target !== ui.freeInput && !ui.freeInput.contains(e.target)) {
        ui.freeInput.blur();
      }
    });

    // 确保在 game-container 中
    const gameContainer = document.getElementById('game-container');
    if (gameContainer && ui.freeInput.parentElement !== gameContainer) {
      gameContainer.appendChild(ui.freeInput);
    }
  }

  /** 显示选项按钮 */
  showOptions(options) {
    const ui = this.ui;
    this.clearOptions();

    this.showFreeInput();

    if (!options || options.length === 0) {
      ui.dialogHint.setText('[F] 关闭对话  [输入] 自由回复  [点击] 跳过');
      ui.dialogClickZone.setInteractive({ useHandCursor: true });
      return;
    }

    const normalized = options.map((opt, i) => {
      if (typeof opt === 'string') return { id: i + 1, text: opt };
      return opt;
    });

    const { width, height } = ui.cameras.main;
    const da = ui._dialogArea || { x: (width - (width - 80)) / 2, y: height - 250 - 24, w: width - 80, h: 250 };
    const { x: panelX, y: panelY, w: panelW, h: panelH } = da;
    const inputY = panelY + panelH - 38;

    const useGrid = normalized.length >= 4;
    const cols = useGrid ? 2 : normalized.length;
    const gapX = 12, gapY = 8;
    const btnW = useGrid
      ? (panelW - 40 - gapX) / 2
      : Math.min(280, (panelW - 40 - (cols - 1) * gapX) / cols);

    // 测量高度
    const btnHeights = normalized.map(opt => {
      const wrapW = Math.max(60, btnW - 44);
      const temp = ui.add.text(0, 0, opt.text, {
        fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
        fontSize: '17px', color: '#d0c8b4',
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
      const btnY = y + (rowH - h) / 2;
      const btn = this._createOptionButton(x, btnY, btnW, h, opt, i);
      ui.optionButtons.push(btn);
      if (c === cols - 1 || i === normalized.length - 1) y += rowH + gapY;
    });

    const maxOptNum = Math.min(normalized.length, 4);
    let hint = '[F] 关闭';
    if (maxOptNum > 0) hint += `  [1-${maxOptNum}] 选择`;
    hint += '  [输入] 自由回复';
    ui.dialogHint.setText(hint);
  }

  /** 创建单个选项按钮 */
  _createOptionButton(x, y, w, h, optionData, index) {
    const ui = this.ui;
    const container = ui.add.container(x, y);

    const bg = ui.add.graphics();
    bg.fillStyle(0x2a2824, 1);
    bg.fillRoundedRect(0, 0, w, h, 5);
    bg.lineStyle(1, 0xc4a882, 0.5);
    bg.strokeRoundedRect(0, 0, w, h, 5);
    container.add(bg);

    const num = ui.add.text(10, h / 2, `${index + 1}`, {
      fontFamily: 'monospace', fontSize: '16px', color: '#c4a882',
    }).setOrigin(0, 0.5);
    container.add(num);

    const text = ui.add.text(30, h / 2, optionData.text, {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
      fontSize: '17px', color: '#d0c8b4', wordWrap: { width: w - 44, useAdvancedWrap: true },
    }).setOrigin(0, 0.5);
    container.add(text);

    const zone = ui.add.zone(w / 2, h / 2, w, h).setInteractive({ useHandCursor: true });
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
    zone.on('pointerdown', () => this.onOptionSelected(optionData));
    container.add(zone);
    container.setSize(w, h);

    ui.optionContainer.add(container);
    return container;
  }

  /** 清除选项 */
  clearOptions() {
    const ui = this.ui;
    ui.optionButtons.forEach(btn => btn.destroy());
    ui.optionButtons = [];
    ui.optionContainer.removeAll(true);
  }

  /** 显示自由输入框（fixed 定位对齐 viewport） */
  showFreeInput() {
    const ui = this.ui;
    if (!ui.freeInput || !ui.dialogContainer.visible) return;
    const { width, height } = ui.cameras.main;
    const da = ui._dialogArea || { x: (width - (width - 80)) / 2, y: height - 250 - 24, w: width - 80, h: 250 };
    const { x: panelX, y: panelY, w: panelW, h: panelH } = da;
    const inputY = panelY + panelH - 36;

    const canvas = ui.sys.game.canvas;
    const rect = canvas.getBoundingClientRect();
    const scaleX = rect.width / width;
    const scaleY = rect.height / height;

    const left = rect.left + (panelX + 20) * scaleX;
    const top = rect.top + inputY * scaleY;
    const iw = (panelW - 40) * scaleX;

    ui.freeInput.style.display = 'block';
    ui.freeInput.style.left = `${left}px`;
    ui.freeInput.style.top = `${top}px`;
    ui.freeInput.style.width = `${iw}px`;
    ui.freeInput.style.fontSize = `${14 * scaleY}px`;
    ui.freeInput.value = '';
    ui.freeInput.placeholder = '输入你想说的话……';
    // ★ 不自动聚焦，避免移动端每次对话都弹出键盘；用户手动点击输入框时再输入
  }

  /** 隐藏自由输入框 */
  hideFreeInput() {
    const ui = this.ui;
    if (ui.freeInput) {
      ui.freeInput.blur();
      ui.freeInput.style.display = 'none';
      ui.freeInput.value = '';
    }
  }

  /** 自由文本提交 */
  async onFreeInputSubmit(text) {
    const ui = this.ui;
    if (ui.isStreaming || !ui.dialogActive) return;
    ui.isStreaming = true;
    this.hideFreeInput();

    if (ui.currentNPC && text) ui.addToHistory(ui.currentNPC.name, null, text);

    this.clearOptions();
    ui.dialogText.setText('');
    ui.dialogHint.setText('对话生成中……');
    ui.pageHint.setText('');
    ui.dialogClickZone.disableInteractive();
    this.startCursorBlink();

    try {
      const stream = await startDialogueStream(ui.sessionId, ui.currentNPC.id, text);
      await this.processDialogueStream(stream);
    } catch (err) {
      console.error('[DialogueManager] 自由输入对话失败:', err);
      ui.dialogText.setText(`【${err.message || '网络开小差了，请重试'}】`);
      ui.dialogHint.setText('[F] 关闭');
    }
  }

  /** 选项选择 */
  async onOptionSelected(option) {
    const ui = this.ui;
    if (ui.isStreaming) return;
    ui.isStreaming = true;

    if (ui.currentNPC && option.text) ui.addToHistory(ui.currentNPC.name, null, option.text);

    this.clearOptions();
    ui.dialogText.setText('');
    ui.dialogHint.setText('对话生成中……');
    ui.pageHint.setText('');
    ui.dialogClickZone.disableInteractive();
    this.startCursorBlink();

    try {
      const stream = await startDialogueStream(ui.sessionId, ui.currentNPC.id, option.text);
      await this.processDialogueStream(stream);
    } catch (err) {
      console.error('[DialogueManager] 续接对话失败:', err);
      ui.dialogText.setText(`【${err.message || '网络开小差了，请重试'}】`);
      ui.dialogHint.setText('[F] 关闭');
    }
  }

  /** 展示物品对话确认 */
  async confirmShowItem() {
    const ui = this.ui;
    if (!ui.showItemMode || !ui.showItemTargetNPC) return;
    const item = ui.inventory[ui.backpackCursorIndex];
    if (!item) return;

    const npcId = ui.showItemTargetNPC.id;
    const npcName = ui.showItemTargetNPC.name;
    const itemId = item.id || item.item_id;

    // 关闭展示模式
    ui.showItemMode = false;
    ui.showItemTargetNPC = null;
    ui.backpackPanelVisible = false;
    ui.backpackPanel.setVisible(false);
    ui.bpTipNormal.setVisible(true);
    ui.bpTipShowItem.setVisible(false);
    ui.bpConfirmBtn.setVisible(false);
    ui.bpShowItemBtnContainer.setVisible(false);
    ui.bpTitle.setText('—— 行  囊 ——');

    ui.addToHistory(npcName, null, `[展示了物品：${item.name || '未知物品'}]`);

    ui.dialogActive = true;
    ui.isStreaming = true;
    ui.currentNPC = { id: npcId, name: npcName };

    ui.dialogContainer.setVisible(true);
    ui.dialogName.setText(npcName);
    ui.dialogText.setText('');
    ui.dialogHint.setText('对话生成中……');
    this.showPortrait(npcId);
    this.clearOptions();
    this.startCursorBlink();

    try {
      const stream = await showItemToNpcStream(ui.sessionId, npcId, itemId,
        `我给你看样东西。${item.name || ''}`);
      await this.processDialogueStream(stream);
    } catch (err) {
      console.error('[DialogueManager] 展示物品对话失败:', err);
      ui.dialogText.setText(`【${err.message || '网络开小差了，请重试'}】`);
      ui.dialogHint.setText('[F] 关闭');
    }
  }

  /** 处理 SSE 流式对话 */
  async processDialogueStream(stream) {
    const ui = this.ui;
    let accumulatedText = '';

    await parseSSEStream(stream, {
      onDelta: (chunk) => {
        accumulatedText += chunk;
        ui.dialogText.setText(accumulatedText);
        const maxTextH = (ui._maskHeight || 136) - 4;
        if (ui.dialogText.height > maxTextH) {
          let lo = 0, hi = accumulatedText.length;
          while (lo < hi) {
            const mid = Math.floor((lo + hi + 1) / 2);
            ui.dialogText.setText(accumulatedText.slice(0, mid));
            if (ui.dialogText.height <= maxTextH) lo = mid;
            else hi = mid - 1;
          }
          ui.cursorBlink.setVisible(false);
        } else {
          this.updateCursorPosition();
        }
        // ★ 根据文本内容检测情绪并切换立绘表情
        if (ui._currentPortraitNpcId) {
          this.updatePortraitEmotion(accumulatedText);
        }
      },
      onDone: async (result) => {
        ui.isStreaming = false;
        this.stopCursorBlink();

        ui.addToHistory(ui.currentNPC.name, result.full_text || accumulatedText);

        const fullText = result.full_text || accumulatedText;
        ui.dialogPages = this.splitTextToPages(fullText);
        ui.dialogCurrentPage = 0;
        ui.pendingOptions = result.options || null;

        ui.pendingChapterChange = null;
        if (result.chapter_completed) {
          ui.pendingChapterChange = { chapterCompleted: true };
          ui.markChapterCompleted(result.current_chapter);
        }
        ui.pendingEnding = result.game_ended || result.ending_triggered || false;

        if (result.current_chapter) {
          ui.currentChapterId = result.current_chapter.chapter_id;
          ui.currentChapterName = result.current_chapter.chapter_name;
        }

        this.showCurrentPage();

        if (ui.pendingEnding) {
          ui.dialogHint.setText('[F] 关闭对话');
          ui.time.delayedCall(1200, () => ui.triggerEndingSequence());
        }
      },
      onError: (err) => {
        ui.isStreaming = false;
        this.stopCursorBlink();
        ui.dialogText.setText(`【出错了】${err.message || 'AI回复失败'}`);
        ui.dialogHint.setText('[F] 关闭');
        this.clearOptions();
      }
    });
  }

  /** 文本分页 */
  splitTextToPages(fullText) {
    const ui = this.ui;
    if (!fullText) return [''];

    const ta = ui._textArea || { w: (ui.cameras.main.width - 80) - 40, h: 250 - 40 - 74 };
    const maxTextH = ta.h - 4;

    const savedText = ui.dialogText.text;
    const savedMask = ui.dialogText.mask;
    ui.dialogText.setMask(null);
    ui.dialogText.setWordWrapWidth(ta.w, true);

    const pages = [];
    let remaining = fullText;

    while (remaining.length > 0) {
      ui.dialogText.setText(remaining);
      if (ui.dialogText.height <= maxTextH) {
        pages.push(remaining);
        break;
      }

      let lo = 0, hi = remaining.length;
      while (lo < hi) {
        const mid = Math.floor((lo + hi + 1) / 2);
        ui.dialogText.setText(remaining.slice(0, mid));
        if (ui.dialogText.height <= maxTextH) lo = mid;
        else hi = mid - 1;
      }

      if (lo === 0) { pages.push(remaining); break; }
      pages.push(remaining.slice(0, lo));
      remaining = remaining.slice(lo);
    }

    if (savedMask) ui.dialogText.setMask(savedMask);
    ui.dialogText.setText(savedText);
    return pages;
  }

  /** 显示当前页 */
  showCurrentPage() {
    const ui = this.ui;
    const total = ui.dialogPages.length;
    const cur = ui.dialogCurrentPage;
    const text = ui.dialogPages[cur] || '';

    ui.dialogText.setText(text);
    ui.pageHint.setText('');
    ui.dialogClickZone.disableInteractive();

    if (total <= 1) {
      ui.finishPagination();
    } else if (cur < total - 1) {
      ui.pageHint.setText(`点击继续 (${cur + 1}/${total})`);
      ui.dialogClickZone.setInteractive({ useHandCursor: true });
    } else {
      ui.pageHint.setText(`(${cur + 1}/${total})`);
      ui.finishPagination();
    }
  }

  /** 对话框点击翻页 */
  onDialogClick() {
    const ui = this.ui;
    if (ui.isStreaming) return;
    if (ui.dialogPages.length <= 1 && ui.dialogCurrentPage >= ui.dialogPages.length - 1) {
      ui.closeDialog();
      return;
    }
    if (ui.dialogCurrentPage >= ui.dialogPages.length - 1) return;
    ui.dialogCurrentPage++;
    this.showCurrentPage();
  }

  /** 光标位置 */
  updateCursorPosition() {
    const ui = this.ui;
    const textBounds = ui.dialogText.getBounds();
    const da = ui._dialogArea || {};
    const panelH = da.h || 250;
    const panelY = da.y || (ui.cameras.main.height - panelH - 24);
    const maxCursorY = panelY + panelH - 78;
    ui.cursorBlink.setPosition(textBounds.right + 2, Math.min(textBounds.bottom - 4, maxCursorY));
  }

  startCursorBlink() {
    const ui = this.ui;
    this.stopCursorBlink();
    ui.cursorBlink.setVisible(true);
    this.updateCursorPosition();
    ui.cursorTimer = ui.tweens.add({
      targets: ui.cursorBlink, alpha: { from: 1, to: 0.2 },
      duration: 500, yoyo: true, repeat: -1,
    });
  }

  stopCursorBlink() {
    const ui = this.ui;
    ui.cursorBlink.setVisible(false);
    if (ui.cursorTimer) {
      ui.cursorTimer.remove();
      ui.cursorTimer = null;
    }
  }

  /** 窗口缩放时重建对话框并恢复当前状态 */
  onResize() {
    const ui = this.ui;
    const wasVisible = ui.dialogContainer && ui.dialogContainer.visible;
    const savedName = ui.dialogName ? ui.dialogName.text : '';
    const savedText = ui.dialogText ? ui.dialogText.text : '';
    const savedHint = ui.dialogHint ? ui.dialogHint.text : '';
    const savedPageHint = ui.pageHint ? ui.pageHint.text : '';
    const savedPages = ui.dialogPages ? [...ui.dialogPages] : [];
    const savedCurrentPage = ui.dialogCurrentPage || 0;
    const savedOptions = ui.pendingOptions;
    const savedDialogActive = ui.dialogActive;
    const savedIsStreaming = ui.isStreaming;
    const savedPendingChapterChange = ui.pendingChapterChange;
    const savedPendingEnding = ui.pendingEnding;
    const savedPortraitNpcId = ui._currentPortraitNpcId;
    const savedPortraitEmotion = ui._currentPortraitEmotion;

    this.clearOptions();
    if (ui.dialogText) ui.dialogText.setMask(null);
    if (ui.dialogContainer) {
      ui.dialogContainer.destroy();
      ui.dialogContainer = null;
    }

    this.createPanel();

    if (wasVisible) {
      ui.dialogContainer.setVisible(true);
      ui.dialogName.setText(savedName);
      ui.dialogText.setText(savedText);
      ui.dialogHint.setText(savedHint);
      ui.pageHint.setText(savedPageHint);
      ui.dialogPages = savedPages;
      ui.dialogCurrentPage = savedCurrentPage;
      ui.dialogActive = savedDialogActive;
      ui.isStreaming = savedIsStreaming;
      ui.pendingChapterChange = savedPendingChapterChange;
      ui.pendingEnding = savedPendingEnding;

      // ★ 恢复立绘
      if (savedPortraitNpcId) {
        this.showPortrait(savedPortraitNpcId, savedPortraitEmotion);
      }

      if (savedIsStreaming) {
        this.startCursorBlink();
      } else if (savedPages.length > 0) {
        const total = savedPages.length;
        const cur = savedCurrentPage;
        if (total > 1 && cur < total - 1) {
          ui.pageHint.setText(`点击继续 (${cur + 1}/${total})`);
          ui.dialogClickZone.setInteractive({ useHandCursor: true });
        } else {
          ui.pageHint.setText(`(${cur + 1}/${total})`);
          if (savedOptions && savedOptions.length > 0 && !savedPendingEnding && !savedPendingChapterChange) {
            this.showOptions(savedOptions);
          }
        }
      }
    }
  }
}
