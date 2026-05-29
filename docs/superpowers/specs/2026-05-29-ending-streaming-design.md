# 结局流式渐进生成 + 赛后回看

## 问题

`POST /game/{id}/evaluate` 用非流式 `chat_json()` 让 LLM 一次生成全部内容（标题、总结、3个关键瞬间、人生感悟、5个NPC结局描述），~400-500 tokens，前端全程只显示"命运的齿轮开始转动……"等待 15-20 秒。

## 解决方案

拆成 2 级并行 LLM 调用 + SSE 流输出。前端渐进渲染，来一个显示一个。已结局存档在主菜单可回看。

---

## A. 后端 — 流式结局生成

### 新端点：`GET /game/{session_id}/evaluate/stream`

SSE 端点，事件序列：

```
event: header    → {"title":"...","summary":"...","key_moments":[...],"life_lesson":"..."}
event: npc       → {"npc_id":"npc_chen","name":"陈师傅","summary":"..."}  (x5, 无序)
event: done      → {"type":"story_complete"}
event: error     → {"message":"..."}
```

### 生成流程

1. 收到请求 → 立即返回 HTTP 200 + SSE headers
2. 异步 `chat_json()` 生成 header（小 prompt，~200 tokens，约 3-5s）
3. header 返回 → emit `header` 事件
4. 同时并行发起 5 个独立 `chat_json()` 调用（每个 NPC 一个）
5. 每个 NPC 返回 → emit `npc` 事件（谁先回就先发）
6. 全部完成 → emit `done` → 将完整 ending_data 持久化到 session

### 新 prompt 文件

- `prompts/evaluate_header.txt` — 标题/总结/关键瞬间/人生感悟（只要求这些字段，精简）
- `prompts/evaluate_npc.txt` — 单 NPC 结局（传入：关系值、对话历史摘要、NPC 人设）

### 缓存复用

已持久化的 `session.ending_data` 若完整，后续请求直接返回缓存，不重复调用 LLM。

### 新增端点：`GET /game/{session_id}/ending`

只读端点，返回已有的 `ending_data`。用于主菜单回看。

---

## B. 新增/修改 prompt 文件

### prompts/evaluate_header.txt

输入：player_name、ending_type、npc_relationships、key_events、dialogue_summary  
输出 JSON：`{ "title": "...", "summary": "...", "key_moments": [...], "life_lesson": "..." }`

### prompts/evaluate_npc.txt

输入：单个 NPC 的 name、role、final_relationship、dialogue_history_sample  
输出 JSON：`{ "npc_id": "...", "summary": "..." }`

---

## C. 前端 — 渐进渲染

### client.js

新增两个函数：

- `evaluateEndingStream(sessionId, { onHeader, onNpcEnding, onDone, onError })` — SSE 流式消费
- `getEnding(sessionId)` — 调用 `GET /api/game/{id}/ending`，返回缓存结局数据

### EndingScreen.js

`trigger()` 重构为流式消费：

| 阶段 | 行为 |
|------|------|
| LLM 等待中 | "命运的齿轮开始转动……" 大字脉动（保持现有动画） |
| 收到 header | 淡出等待文字 → 渲染标题(淡入) → 总结(400ms后) → 关键瞬间(400ms) → 感悟(400ms) |
| 收到 npc | 追加到 NPC 结局列表底部，300ms fade-in，自动调整滚动区 |
| 收到 done | 显示 [R 重新开始] 提示闪烁 |

新增 `showStatic(endingData)` — 静态展示模式，用于主菜单回看场景：直接渲染全部内容（无等待动画），ESC 关闭。

### 布局

```
┌──────────────────────────────────┐
│       结局标题 (42px KaiTi)       │  y: 80
│     —— 传承线/离别线 ——          │  y: 140
│  ───────── 分隔线 ─────────      │  y: 170
│  「瞬间1」→「瞬间2」→「瞬间3」   │  y: 200
│  "人生感悟"                       │  y: 260
│  ──────── NPC 结局 ────────      │  y: 320
│  ◆ 陈师傅：他留在了舞台……        │  可滚区域
│  ◆ 小华：年轻的学徒终于……        │  每个 NPC 到来时 fade-in
│  ◆ 老周：沉默地守着后台……        │
│  ◆ 梅姨：茶馆飘着熟悉的茶香……    │
│  ◆ 老李：渡口的船依旧往来……      │
│                                  │
│     [ 按 R 键重新开始 ]          │  底部固定 y: H-50
└──────────────────────────────────┘
```

NPC 结局区域超长时可滚轮滚动。key_moments 换行显示（不再强制单行 `→` 连接），避免溢出。

---

## D. 赛后回看 — 主菜单

### MenuScene.js

`_renderArchiveList()` 中，当 `s.game_ended === true`：

- 「继续」按钮 → 「查看结局」（颜色区分，如青色系）
- 点击 → 从后端获取结局数据 → 创建 mini EndingScreen（`showStatic(endingData)`）
- 遮罩 + ESC 关闭

### 回看弹窗布局

与 EndingScreen 内容一致，但全量即时渲染（无逐行动画），顶部加"返回"按钮 + 点击遮罩或 ESC 关闭。

---

## E. 文件修改清单

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `backend/routes/game.py` | 修改 | 新增 `GET /evaluate/stream` + `GET /ending` |
| `backend/agents/prompt_builder.py` | 修改 | 新增 `build_evaluate_header_messages()` + `build_evaluate_npc_messages()` |
| `backend/prompts/evaluate_header.txt` | **新建** | header prompt |
| `backend/prompts/evaluate_npc.txt` | **新建** | 单 NPC 结局 prompt |
| `frontend/src/api/client.js` | 修改 | 新增 `evaluateEndingStream()` + `getEnding()` |
| `frontend/src/scenes/modules/EndingScreen.js` | 修改 | 重构 trigger() 为流式 + showStatic() + 布局调整 |
| `frontend/src/scenes/MenuScene.js` | 修改 | 存档列表「查看结局」按钮 + 结局弹窗 |

---

## 验证方案

1. 玩到结局触发点 → 确认"命运的齿轮"动画显示
2. 确认 header 先到达，标题/总结/感悟在 5s 内渲染
3. 确认 NPC 结局逐条出现（不是全部同时），最后一条到后显示 R 提示
4. 回到主菜单 → 存档列表该存档显示「查看结局」
5. 点击「查看结局」→ 确认全量结局内容正确展示
6. 再次进入已结局存档（load game）→ 按 R 仍可查看结局
7. 非结局存档行 → 仍显示「继续」按钮
