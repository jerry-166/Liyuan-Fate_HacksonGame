# 前端变更总结 — 2026-05-24

> 面向前端团队的本次会话改动说明。共涉及 6 个文件，+1058 / -146 行。

---

## 1. API 客户端 — `src/api/client.js`

### 变更概览

新增 6 个 API 函数，前端现覆盖全部 10 个后端接口。每个函数均支持 **Mock 模式**（`VITE_USE_MOCK !== 'false'`）和 **真实 HTTP** 双模式。

### 新增 API 函数

| 函数 | 方法 | 路径 | 用途 |
|---|---|---|---|
| `getSessions()` | GET | `/api/sessions` | 获取所有存档会话列表 |
| `deleteSession(id)` | DELETE | `/api/game/{id}` | 删除指定存档 |
| `getDialogues(sid, npcId, page, size)` | GET | `/api/game/{id}/dialogues` | 分页查询对话历史 |
| `exitDialogue(sid, npcId)` | POST | `/api/dialogue/exit` | 退出 NPC 对话（获取告别语） |
| `getRelationships(sid, npcId?)` | GET | `/api/game/{id}/relationships` | 查询关系值变化历史 |
| `getEvents(sid)` | GET | `/api/game/{id}/events` | 查询已触发事件时间线 |

### 影响范围

- 存档管理面板、对话历史回看、关系系统、事件系统均可直接使用这些新 API
- Mock 数据内联在 `client.js` 中，独立运行时不依赖后端

---

## 2. UIScene — `src/scenes/UIScene.js`（大改）

### 2.1 对话框文本区域重构

**背景**：此前对话框文本和选项按钮频繁超出面板右边界。

**改动**：
- 文本区域参数以面板 `(panelX, panelY, panelW, panelH)` 为唯一基准
- 内边距统一：`padLeft=20, padRight=20` → `textAreaW = panelW - 40`
- wordWrap 宽度精确等于 `textAreaW`，并使用 `useAdvancedWrap: true`
- 滚动条从面板外（`textAreaX + textAreaW + 2`）移至面板内（`textAreaX + textAreaW - 4`）
- 遮罩（GeometryMask）尺寸与文本区域完全对齐

### 2.2 选项按钮布局优化

**改动**：
- 可用宽度 = `panelW - 40`（与文本区域一致）
- 动态计算 `btnW`，计算后二次校验 `totalW ≤ availW`，超限等比缩小
- 按钮间距从 10px 缩至 8px

### 2.3 对话历史面板（记忆回想）重构

**背景**：面板文本超出游戏界面，且只展示本次游玩的对话。

**改动**：
- `createHistoryPanel()` 重写为 `_historyArea { x, y, w, h }` 统一区域参数
- 遮罩精确对齐内容区，不再溢出全屏
- `refreshHistoryContent()` 改为 **async**，优先调用后端 `getDialogues()` 获取**该 session 的全部对话历史**（含所有轮次）；失败自动回退内存数据
- 新增 `NPC_NAME_MAP` 将后端 `npc_id` 映射为中文显示名（如 `npc_chen` → `陈师傅`），并从 GameScene 动态补充
- 引入 `lastSpeaker` 追踪说话人变化，**连续同名 NPC 发言不再重复显示名字标签**
- 滚轮方向修复：向下滚动 → 显示更新内容（原为反直觉的逆行滚动）

### 2.4 自由文本输入（新功能）

**背景**：玩家除了点选预设选项，还需要自由输入文字与 NPC 对话。

**实现**：
- 在 `index.html` 中添加 DOM 层 `<input id="free-input">`（Phaser 无原生文本输入）
- 新增方法：`setupFreeInput()`、`showFreeInput()`、`hideFreeInput()`、`sendFreeInput()`
- 选项出现时自动显示输入框，Enter 键或点击"发送"按钮触发
- 发送内容复用 `onOptionSelected({ id: 0, text })` 逻辑，调用后端 SSE 流式对话
- 输入框聚焦时跳过 Phaser `update()` 中的键盘事件处理，避免 ESC/数字键冲突

### 2.5 其他改进

- **ESC 键注册**：`JustDown()` 必须传入已注册 Key 对象，UIScene/MenuScene 均添加 `this.keyEsc = this.input.keyboard.addKey(...)`
- **对话流式输出**：新增滚动条自动滚底 + GeometryMask 裁剪 + 滚轮滚动支持
- **关闭对话**：`closeDialog()` 调用 `exitDialogue` API 获取 NPC 告别语（非阻塞 fire-and-forget）
- **错误处理**：新增 `buildErrorMessage()` 按错误码分类返回中文提示（SESSION_NOT_FOUND / NPC_NOT_FOUND / NETWORK_ERROR 等）
- **阶段色调遮罩**：从 `cameras.main.flash()` 改为半透明 `tintOverlay` 矩形（setScrollFactor(0), depth 999），避免全屏纯色遮挡

---

## 3. MenuScene — `src/scenes/MenuScene.js`

### 3.1 存档管理系统

**改动**：
- `createArchivePanel()` — 创建存档列表覆盖面板（深色半透明遮罩 + 卡片式列表 + 遮罩裁剪）
- `showArchivePanel()` — 调用 `getSessions()` 从后端获取所有会话，渲染列表
- `renderArchiveList()` — 渲染带"继续"/"删除"按钮的存档卡片，显示玩家名、阶段、时间、是否已结局
- `confirmDeleteArchive()` — 调用 `deleteSession()` + 清理 localStorage
- ESC 键关闭面板，点击背景遮罩关闭

### 3.2 继续游戏逻辑简化

**背景**：此前 `onContinue()` 优先尝试直接从 localStorage 加载，不展示面板。

**改动**：`onContinue()` 改为**直接调用 `showArchivePanel()`**，用户从所有会话中选择要恢复的存档。

### 3.3 存档列表滚轮滚动

**新增**：存档面板添加 wheel 事件处理（`_archiveListArea` 参数 + `archiveScrollY`），长存档列表可滚动浏览。

### 3.4 按钮样式统一

- 创建 `createMenuButton()` 和 `createSmallButton()` 工具方法，统一菜单按钮和存档操作按钮的样式
- 支持 hover 高亮效果

---

## 4. GameScene — `src/scenes/GameScene.js`

### 4.1 初始化/恢复增强

- `initGame()` 增加加载提示 + 初始化失败 Toast 提示 + 阶段色调自动应用
- `restoreGame()` 优先从 API `getGameState()` 获取最新状态，失败回退 localStorage
- 新增 `showLoadingHint()` / `hideLoadingHint()` / `showToast()` 工具方法

### 4.2 阶段色调遮罩（看着改掉吧，我觉得没什么用）

- 原用 `cameras.main.flash()` 导致全屏纯色遮挡
- 改为半透明 `tintOverlay` 矩形（setScrollFactor(0), depth 999），通过 `setFillStyle(color, alpha)` 设置 0.08-0.15 透明度
- 遮罩不参与输入交互（重写 `setInteractive` 为 no-op）

---

## 5. 入口 HTML — `index.html`

### 变更

- 新增 DOM 元素：`<div id="free-input-wrapper">` 含 `<input>` 和 `<button>`
- 新增对应 CSS 样式：深色主题、边框高亮、响应式宽度（max-width: calc(100vw - 40px)）
- 输入框默认隐藏，由 UIScene 通过 CSS class `visible` 控制显隐

---

## 6. 架构文档 — `docs/前端/架构总览.md`

### 变更

- 更新 API 接口表格（12 个函数全覆盖）
- 更新功能状态和风险项

---

## 快速导航

| 文件 | 主要变更 | 行数变化 |
|---|---|---|
| `src/api/client.js` | 新增 6 个 API 函数 + Mock 数据 | +170 |
| `src/scenes/UIScene.js` | 文本区域重构、历史面板、自由输入、ESC/错误处理 | +418/-128 |
| `src/scenes/MenuScene.js` | 存档面板、滚轮滚动、继续游戏简化 | +354/-18 |
| `src/scenes/GameScene.js` | 初始化增强、遮罩修复 | +170/-0 |
| `index.html` | 自由输入 DOM + CSS | +47 |
| `docs/前端/架构总览.md` | API 表格更新 | +45/-45 |

## 注意事项

1. **Mock 模式**：`VITE_USE_MOCK` 环境变量控制，默认 `true`（前端可独立运行）。联调时设为 `false` 连接真实后端。
2. **自由输入**依赖 DOM 元素 `#free-input-wrapper`，确保 `index.html` 中有对应的 HTML 片段。
3. **存档管理**以 API 为唯一真相来源，localStorage 作为离线缓存层。
4. **退出对话 API** 调用为 fire-and-forget（非阻塞），不影响 UI 关闭速度。
5. **ESC 键**现在用于关闭对话框/存档面板，替代了原来的 F 键。
