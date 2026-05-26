# 更新日志 (Changelog)

## [Unreleased]

---

## 2026-05-26

### 新增 (Added)

#### NPC 交互按钮化 — 「进行对话」+「展示物品」

**涉及文件：**
- `frontend/src/scenes/GameScene.js`
- `frontend/src/scenes/UIScene.js`
- `frontend/src/api/client.js`

**功能描述：**
靠近 NPC 时不再显示简单的 "[F] 对话" 文字提示，改为两个可交互按钮。

**GameScene.js 改动：**
- `_createNPCActionButtons()`: 在 NPC 上方创建两个按钮容器，半透明深色背景条 + 圆角边框
  - `💬 进行对话` (左) → 调用 `triggerDialogue()` 进入正常对话流程
  - `🎁 展示物品` (右) → 发射 `show-item:select` 事件给 UIScene
  - 支持悬停高亮效果（背景色、边框色变化）
- `_showNPCActionButtons(npc)` / `_hideNPCActionButtons()`: 按钮定位在 NPC 头顶上方 52px
- `update()` 中：靠近 NPC (<64px) 时显示按钮，远离或 `inputLocked` 时隐藏
- F 键不再触发 NPC 对话，仅保留物品拾取功能

**UIScene.js 改动：**
- 新增 `showItemMode` / `showItemTargetNPC` 状态管理
- 监听 `show-item:select` → `onShowItemSelect()`:
  - 设置展示物品模式，记录目标 NPC
  - 锁定 GameScene 输入，隐藏 NPC 按钮
  - 打开背包面板，标题改为「—— 展示物品给 XXX ——」
  - 底部提示切换为 `[Enter] 展示` + `[B] 取消`
  - 右侧详情区显示「确认展示选中物品」按钮
  - 背包为空时也打开面板（显示"空空如也"）
- `confirmShowItem()`: 选中物品确认后，调用 `showItemToNpcStream()` 发起对话
- `cancelShowItemMode()`: ESC / B / 点击 [B] 取消 / 点击遮罩 → 关闭背包，不触发对话
- `update()` 中：背包打开时 Enter 键确认展示，W/S 选择物品，B/ESC 取消
- **确认与选择分离**：鼠标点击物品行仅选中高亮，需 Enter 或点击"确认展示"按钮才触发对话
- 未选择物品时关闭背包不触发任何对话

**交互流程：**
1. 靠近 NPC → 显示两个按钮
2. 点击「💬 进行对话」→ 直接开始对话
3. 点击「🎁 展示物品」→ 打开背包（展示物品模式）
4. W/S 或鼠标选择物品 → 右侧显示详情
5. Enter 或点击「确认展示选中物品」→ 调用 API 发起展示对话
6. ESC / B / 点击取消 → 关闭背包，回归正常移动

---

### 修复 (Fixed)

#### 对话框自由文本输入框 UI 对齐与交互问题

**涉及的文件:**
- `frontend/src/main.js`
- `frontend/src/scenes/UIScene.js`

**问题描述:**
1. 浏览器窗口缩放后，对话框底部的自由文本输入框位置偏移，无法与对话框对齐
2. 打开历史面板时，DOM 输入框浮在历史面板之上（z-index 冲突）
3. 输入框缺少失焦功能，点击外部区域无法自动失去焦点

**修复内容:**

- **输入框定位重构** (`main.js` + `UIScene.js`)
  - 输入框 `position` 从 `absolute` 改为 `fixed`，`z-index` 从 `1000` 降至 `350`
  - 输入框保持在 `game-container` 中与 canvas 同级，避免被 Phaser DOM 容器遮挡
  - `showFreeInput()` 使用 `canvas.getBoundingClientRect()` 获取 viewport 坐标，结合 Phaser 设计尺寸计算 `scaleX/scaleY`
  - 输入框 `left = rect.left + (panelX+20) * scaleX`，`top = rect.top + inputY * scaleY`，确保与对话框在任意缩放比例下完全对齐
  - 添加 `this.scale.on('resize')` 监听，窗口缩放时实时重定位输入框
  - 添加 `shutdown()` 方法清理 resize 监听器

- **历史面板与输入框层级冲突** (`UIScene.js`)
  - `toggleHistoryPanel()` 打开历史面板时：主动 `blur()` 输入框并 `display: none` 隐藏
  - `toggleHistoryPanel()` 关闭历史面板时：若对话框仍活跃且选项已显示，自动恢复输入框

- **输入框失焦功能** (`UIScene.js`)
  - 添加 `game-container` 的 `mousedown` 事件监听，点击输入框外部区域自动 `blur()`
  - `hideFreeInput()` 方法中同步调用 `blur()`，防止焦点残留在 DOM 元素上拦截键盘事件

- **Bug 修复** (`UIScene.js`)
  - 修复 `showFreeInput()` 中解构 `da` 对象时漏写 `h: panelH` 导致 `inputY` 为 `NaN` 的致命错误

---

## 较早更新

*(待补充)*
