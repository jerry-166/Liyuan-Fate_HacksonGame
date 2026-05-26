# 更新日志 (Changelog)

## [Unreleased]

---

## 2025-05-26

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
