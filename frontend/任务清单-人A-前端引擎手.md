# 🖥️ 人 A — 前端引擎手

> **核心原则**：你只管前端游戏客户端这条线，交叉点找 CodeBuddy 补位。

## 你的活

| # | 工作内容 | 技术栈/工具 |
|---|---------|------------|
| ① | 地图渲染（星露谷倾斜视角 tile map） | Phaser 3 + Tiled Map Editor |
| ② | WASD 移动 + 碰撞检测 + F 键交互触发 | Phaser Arcade Physics |
| ③ | 场景切换逻辑（外部地图 ↔ 建筑内部） | Phaser Scene 管理 |
| ④ | 对话 UI（手动输入 / AI 选项 / 流式展示） | 自建 UI 组件 |
| ⑤ | 角色/NPC 精灵加载与动画 | Phaser Sprite/Animation |

---

## 需要和 B 沟通的事（后端）

| 事项 | 说明 |
|------|------|
| API 接口文档 | Day 1 一起敲定 `dialogue` / `game_state` / `trigger_event` / `evaluate_ending` 四个接口的请求/响应格式 |
| Mock 数据 | B 先给你一套静态 JSON，你可以不连后端独立开发 UI |
| 流式输出方案 | 确认用 SSE 还是 chunked transfer，前端怎么接 streaming |
| 联调 | Mock 跑通后接真实 API，测试完整对话链路 |

## 需要和 C 沟通的事（内容）

| 事项 | 说明 |
|------|------|
| 美术规格约定 | tile 尺寸多少（建议 64x32）、什么格式、要不要透明通道，Day 1 定死 |
| 文件命名和路径 | 统一命名规范，比如 `tile_grass.png`、`npc_chenbo.png`，放 `assets/` 下哪个子目录 |
| 资产交付节奏 | C 第一批给你基础地形 tile + 2 个 NPC 角色图，你能开始搭场景 |
| Tiled 地图 | C 拼好地图导出 .json → 你直接加载渲染 |

## 你的 MVP

> 玩家 WASD 走动 → 走到 NPC 面前按 F → 弹出对话框看到 AI 回复 → 能选选项继续聊

重点：**Day 1 拿 Mock 数据就可以开始写，不等后端。**
