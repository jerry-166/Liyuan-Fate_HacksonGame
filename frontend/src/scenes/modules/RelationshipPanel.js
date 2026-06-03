/**
 * 关系面板 — 展示各剧情NPC好感度/关系值
 * 居中浮动面板，0 居中双向柱状图（-100~+100）
 * R 键或点击 HUD 按钮切换显隐
 * @module scenes/modules/RelationshipPanel
 */

import { isMobileDevice } from '../../utils/DeviceDetector.js';

const PANEL_W = 760;         // 面板宽
const NAME_W = 100;          // 名字区域宽
const BAR_AREA_W = 420;      // 条形图区域总宽（左右各一半）
const BAR_H = 24;            // 条形图高度
const ITEM_H = 64;           // 每行高度
const HEADER_H = 72;
const LEGEND_H = 44;
const BOTTOM_PAD = 36;
const CORNER_R = 12;

/** 根据关系值返回颜色 */
function relationshipColor(value) {
  if (value <= -60) return '#e05555';   // 红 敌视
  if (value <= -20) return '#e08844';   // 橙 冷淡
  if (value < 20)   return '#d4a843';   // 金 中立
  if (value < 60)   return '#5caa60';   // 绿 友好
  return '#44bb66';                     // 翠绿 信任
}

function relationshipLabel(value) {
  if (value <= -60) return '敌视';
  if (value <= -20) return '冷淡';
  if (value < 20)   return '中立';
  if (value < 60)   return '友好';
  return '信任';
}

const LEVELS = [
  { label: '敌视', color: '#e05555', range: '≤ -60' },
  { label: '冷淡', color: '#e08844', range: '-60 ~ -20' },
  { label: '中立', color: '#d4a843', range: '-20 ~ +20' },
  { label: '友好', color: '#5caa60', range: '+20 ~ +60' },
  { label: '信任', color: '#44bb66', range: '≥ +60' },
];

export class RelationshipPanel {
  constructor(uiScene) {
    this.ui = uiScene;
  }

  createPanel() {
    const ui = this.ui;
    const { width, height } = ui.cameras.main;

    this._panelW = Math.min(PANEL_W, width - 40);
    const count = 5;
    const panelH = HEADER_H + count * ITEM_H + LEGEND_H + BOTTOM_PAD + 20;
    this._panelH = Math.min(panelH, height - 60);
    const cx = width / 2;
    const cy = Math.round(height * 0.45);
    const pLeft = cx - this._panelW / 2;
    const pTop = cy - this._panelH / 2;

    ui._relationshipPanelUI = ui.add.container(0, 0).setDepth(460).setVisible(false);

    // 半透明暗遮罩
    const dimBg = ui.add.graphics();
    dimBg.fillStyle(0x000000, 0.45);
    dimBg.fillRect(0, 0, width, height);
    ui._relationshipPanelUI.add(dimBg);

    // 点击遮罩关闭（仅移动端支持）
    if (isMobileDevice()) {
      const clickBlocker = ui.add.rectangle(width / 2, height / 2, width, height, 0x000000, 0)
        .setInteractive({ useHandCursor: false });
      clickBlocker.on('pointerdown', () => this.hide());
      ui._relationshipPanelUI.add(clickBlocker);
    }

    // —— 面板主体背景 ——
    this._bgGfx = ui.add.graphics();
    this._drawBg(pLeft, pTop);
    ui._relationshipPanelUI.add(this._bgGfx);

    // —— 内层装饰框 ——
    const innerGfx = ui.add.graphics();
    innerGfx.lineStyle(1, 0xc4a882, 0.15);
    innerGfx.strokeRoundedRect(pLeft + 12, pTop + 12, this._panelW - 24, this._panelH - 24, 6);
    ui._relationshipPanelUI.add(innerGfx);

    // —— 标题 ——
    this._title = ui.add.text(cx, pTop + 18, '◇  人 物 关 系  ◇', {
      fontFamily: '"KaiTi","SimSun",serif',
      fontSize: '26px',
      color: '#d4b896',
    }).setOrigin(0.5, 0);
    ui._relationshipPanelUI.add(this._title);

    // 标题下装饰线
    const titleLine = ui.add.graphics();
    const lineY = pTop + 54;
    titleLine.lineStyle(1, 0xc4a882, 0.25);
    titleLine.lineBetween(pLeft + 60, lineY, pLeft + this._panelW - 60, lineY);
    ui._relationshipPanelUI.add(titleLine);

    // 标题下小圆点装饰
    for (let i = -2; i <= 2; i++) {
      const dot = ui.add.circle(cx + i * 20, lineY, 2, 0xc4a882, 0.4);
      ui._relationshipPanelUI.add(dot);
    }

    // —— 0基准线标注 ——
    const barAreaLeft = pLeft + NAME_W + 20 + 16;
    const barCenterX = barAreaLeft + BAR_AREA_W / 2;
    this._zeroLineY = pTop + HEADER_H + ITEM_H * count - 4;
    const zeroLine = ui.add.graphics();
    zeroLine.lineStyle(1, 0x554433, 0.6);
    zeroLine.lineBetween(barAreaLeft, pTop + HEADER_H + 4, barAreaLeft, this._zeroLineY);
    zeroLine.lineStyle(1, 0x554433, 0.5);
    zeroLine.lineBetween(barAreaLeft + BAR_AREA_W, pTop + HEADER_H + 4, barAreaLeft + BAR_AREA_W, this._zeroLineY);
    ui._relationshipPanelUI.add(zeroLine);

    // 0 和 ±100 刻度标签（在柱子区域上方）
    const axisY = pTop + HEADER_H - 6;
    ui._relationshipPanelUI.add(
      ui.add.text(barAreaLeft, axisY, '-100', {
        fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
        fontSize: '11px', color: '#554433',
      }).setOrigin(0.5, 1)
    );
    ui._relationshipPanelUI.add(
      ui.add.text(barCenterX, axisY, '0', {
        fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
        fontSize: '11px', color: '#887766',
      }).setOrigin(0.5, 1)
    );
    ui._relationshipPanelUI.add(
      ui.add.text(barAreaLeft + BAR_AREA_W, axisY, '+100', {
        fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
        fontSize: '11px', color: '#554433',
      }).setOrigin(0.5, 1)
    );

    // —— 关系条容器 ——
    this._panelLeft = pLeft;
    this._barsY = pTop + HEADER_H;
    this._barsContainer = ui.add.container(pLeft, this._barsY);
    ui._relationshipPanelUI.add(this._barsContainer);

    // —— 底部图例 ——
    const legendY = pTop + this._panelH - BOTTOM_PAD;
    this._legendContainer = ui.add.container(cx, legendY);
    ui._relationshipPanelUI.add(this._legendContainer);
    this._buildLegend();

    // —— 底部提示 ——
    this._hintText = ui.add.text(cx, pTop + this._panelH - 8, isMobileDevice() ? '[ R / ESC ] 关闭  |  点击外部关闭' : '[ R / ESC ] 关闭', {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
      fontSize: '12px', color: '#554433',
    }).setOrigin(0.5, 1);
    ui._relationshipPanelUI.add(this._hintText);
  }

  _drawBg(pLeft, pTop) {
    this._bgGfx.clear();
    // 外阴影层
    this._bgGfx.fillStyle(0x000000, 0.5);
    this._bgGfx.fillRoundedRect(pLeft + 3, pTop + 3, this._panelW, this._panelH, CORNER_R);
    // 主背景
    this._bgGfx.fillStyle(0x161320, 0.98);
    this._bgGfx.fillRoundedRect(pLeft, pTop, this._panelW, this._panelH, CORNER_R);
    // 边框
    this._bgGfx.lineStyle(2, 0xc4a882, 0.45);
    this._bgGfx.strokeRoundedRect(pLeft, pTop, this._panelW, this._panelH, CORNER_R);
  }

  _buildLegend() {
    const ui = this.ui;
    this._legendContainer.removeAll(true);
    const gap = 86;
    const totalW = (LEVELS.length - 1) * gap;
    const startX = -totalW / 2;

    LEVELS.forEach((lv, i) => {
      const x = startX + i * gap;
      // 色块
      const dot = ui.add.rectangle(x, -2, 10, 10, parseInt(lv.color.slice(1), 16))
        .setOrigin(0.5, 0.5);
      this._legendContainer.add(dot);
      // 标签
      const label = ui.add.text(x + 8, -8, lv.label, {
        fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
        fontSize: '12px', color: lv.color,
      }).setOrigin(0, 0.5);
      this._legendContainer.add(label);
    });
  }

  /** 刷新关系数据并显示 — 始终从后端 API 获取最新值 */
  refreshAndShow() {
    if (this.ui.sessionId) {
      this._refreshFromAPI();
      return;
    }

    // 无 session 时兜底：从精灵数据读取
    const gameScene = this.ui.scene.get('GameScene');
    if (!gameScene) return;

    const npcData = [];
    if (gameScene.npcs) {
      for (const sprite of gameScene.npcs) {
        const npcId = sprite.getData('npcId');
        const name = sprite.getData('name');
        const role = sprite.getData('role');
        const relationship = sprite.getData('relationship') ?? 0;
        if (npcId && name) {
          npcData.push({ npcId, name, role, relationship });
        }
      }
    }

    if (npcData.length > 0) {
      this._renderBars(npcData);
      this.ui._relationshipPanelUI.setVisible(true);
    }
  }

  /** 从 API 获取关系数据（兜底） */
  async _refreshFromAPI() {
    try {
      const { getGameState } = await import('../../api/client.js');
      const state = await getGameState(this.ui.sessionId);
      if (state && state.npcs) {
        const npcData = state.npcs.map(n => ({
          npcId: n.id,
          name: n.name,
          role: n.role || '',
          relationship: n.relationship ?? 0,
        }));
        this._renderBars(npcData);
        this.ui._relationshipPanelUI.setVisible(true);
      }
    } catch (err) {
      console.warn('[RelationshipPanel] 获取关系数据失败:', err);
      this._renderBars([]);
      this.ui._relationshipPanelUI.setVisible(true);
    }
  }

  _renderBars(npcData) {
    const ui = this.ui;
    this._barsContainer.removeAll(true);

    if (npcData.length === 0) {
      const noData = ui.add.text(
        this._panelW / 2, ITEM_H * 2.5,
        '暂无关系数据\n\n请先开始一段剧情',
        {
          fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
          fontSize: '16px', color: '#665544',
          align: 'center', lineSpacing: 6,
        }
      ).setOrigin(0.5, 0.5);
      this._barsContainer.add(noData);
      return;
    }

    const pLeft = this._panelW / 2 - this._panelW / 2; // container relative
    const nameAreaLeft = 24;
    const barAreaLeft = nameAreaLeft + NAME_W + 28;
    const barCenterX = barAreaLeft + BAR_AREA_W / 2;
    const halfBarW = BAR_AREA_W / 2;

    npcData.forEach((npc, i) => {
      const y = i * ITEM_H;
      const midY = y + ITEM_H / 2;
      const barY = midY - BAR_H / 2;
      const rel = Math.max(-100, Math.min(100, npc.relationship));
      const absRel = Math.abs(rel);
      const label = relationshipLabel(rel);
      const color = relationshipColor(rel);

      // —— NPC 名称 ——
      const nameText = ui.add.text(nameAreaLeft, midY, npc.name, {
        fontFamily: '"KaiTi","SimSun",serif',
        fontSize: '20px', color: '#d4b896',
      }).setOrigin(0, 0.5);
      this._barsContainer.add(nameText);

      // —— 角色标签 ——
      if (npc.role) {
        const roleText = ui.add.text(nameAreaLeft + NAME_W + 4, midY - 14, npc.role, {
          fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
          fontSize: '11px', color: '#887766',
        }).setOrigin(0, 0.5);
        this._barsContainer.add(roleText);
      }

      // —— 0 中线 ——
      const zeroLine = ui.add.graphics();
      zeroLine.lineStyle(1, 0x554433, 0.35);
      zeroLine.lineBetween(barCenterX, barY, barCenterX, barY + BAR_H);
      this._barsContainer.add(zeroLine);

      // —— 柱状图背景（整个条形区域） ——
      const bgBar = ui.add.graphics();
      bgBar.fillStyle(0x222030, 1);
      bgBar.fillRoundedRect(barAreaLeft, barY, BAR_AREA_W, BAR_H, 3);
      this._barsContainer.add(bgBar);

      // —— 值柱：从0中线向两侧延伸 ——
      if (rel !== 0) {
        const fillW = Math.max(2, Math.round(halfBarW * (absRel / 100)));
        const fillBar = ui.add.graphics();
        const alpha = 0.9 + (absRel / 100) * 0.1; // 越高越亮
        const hexColor = parseInt(color.slice(1), 16);
        fillBar.fillStyle(hexColor, alpha);

        if (rel > 0) {
          // 正值：从中间向右延伸
          fillBar.fillRoundedRect(barCenterX + 1, barY, fillW, BAR_H, { tl: 0, tr: 3, bl: 0, br: 3 });
        } else {
          // 负值：从中间向左延伸
          fillBar.fillRoundedRect(barCenterX - fillW - 1, barY, fillW, BAR_H, { tl: 3, tr: 0, bl: 3, br: 0 });
        }
        this._barsContainer.add(fillBar);
      }

      // —— 0 中心圆点标记 ——
      const centerDot = ui.add.circle(barCenterX, midY, 3.5, 0xc4a882);
      this._barsContainer.add(centerDot);

      // —— 数值标签 ——
      const sign = rel >= 0 ? '+' : '';
      const valText = ui.add.text(
        barAreaLeft + BAR_AREA_W + 16, midY,
        `${sign}${rel}`,
        {
          fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
          fontSize: '16px', color: color, fontStyle: 'bold',
        }
      ).setOrigin(0, 0.5);
      this._barsContainer.add(valText);

      // —— 关系标签 ——
      const labelText = ui.add.text(
        barAreaLeft + BAR_AREA_W + 56, midY,
        label,
        {
          fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
          fontSize: '13px', color: color,
        }
      ).setOrigin(0, 0.5);
      this._barsContainer.add(labelText);

      // —— 分隔线（非最后一项） ——
      if (i < npcData.length - 1) {
        const sepLine = ui.add.graphics();
        sepLine.lineStyle(1, 0xc4a882, 0.08);
        sepLine.lineBetween(nameAreaLeft, y + ITEM_H, barAreaLeft + BAR_AREA_W + 100, y + ITEM_H);
        this._barsContainer.add(sepLine);
      }
    });
  }

  show() {
    if (!this.ui._relationshipPanelUI) return;
    this.refreshAndShow();
    const gs = this.ui.scene.get('GameScene');
    if (gs) gs.events.emit('input:lock', true);
  }

  hide() {
    if (!this.ui._relationshipPanelUI) return;
    this.ui._relationshipPanelUI.setVisible(false);
    const gs = this.ui.scene.get('GameScene');
    if (gs) gs.events.emit('input:lock', false);
  }

  toggle() {
    if (!this.ui._relationshipPanelUI) return;
    if (this.ui._relationshipPanelUI.visible) {
      this.hide();
    } else {
      this.show();
    }
  }

  onResize() {
    if (!this.ui._relationshipPanelUI) return;
    // 简化的 resize：销毁并重建面板
    const wasVisible = this.ui._relationshipPanelUI.visible;
    this.ui._relationshipPanelUI.destroy();
    this.ui._relationshipPanelUI = null;
    this.createPanel();
    if (wasVisible) this.refreshAndShow();
  }
}
