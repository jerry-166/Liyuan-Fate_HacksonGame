# 《梨园生死》MVP API 设计文档

> **版本**: v1.0-MVP  
> **最后更新**: 2026-05-22  
> **设计原则**: 职责单一、接口清晰、按业务模块拆分、覆盖 MVP 完整流程

---

## 一、概述

### 1.1 MVP 游戏流程

```
开始游戏 → 探索地图(WASD) → 接近NPC → 触发对话(F键) → 多轮AI对话 → 阶段变化 → 触发结局 → AI评价总结
```

### 1.2 API 设计原则

| 原则 | 说明 |
|------|------|
| **职责单一** | 每个 API 只负责一个明确的业务功能 |
| **RESTful 风格** | 资源路径清晰，HTTP 方法语义正确 |
| **SSE 流式** | 对话接口使用 Server-Sent Events，逐 token 推送 |
| **状态集中** | 游戏全局状态通过单一入口获取，前端不自行推导 |
| **MVP 最小化** | 只设计 MVP 必需的接口，预留扩展空间但不实现 |

### 1.3 API 总览（4 个接口）

| # | 方法 | 路径 | 职责 | 响应方式 |
|---|------|------|------|----------|
| 1 | `POST` | `/api/game/start` | 创建新游戏会话 | JSON |
| 2 | `GET` | `/api/game/{session_id}` | 获取完整游戏状态 | JSON |
| 3 | `POST` | `/api/dialogue` | NPC 对话交互 | SSE 流式 |
| 4 | `POST` | `/api/game/{session_id}/evaluate` | 生成结局评价 | JSON |

---

## 二、通用规范

### 2.1 基础信息

```
Base URL:     http://localhost:8000/api
Content-Type: application/json; charset=utf-8
字符编码:      UTF-8
```

### 2.2 统一错误响应格式

```json
{
  "error": true,
  "code": "SESSION_NOT_FOUND",
  "message": "游戏会话不存在: sess_xxx",
  "detail": null
}
```

| 错误码 | 说明 |
|--------|------|
| `SESSION_NOT_FOUND` | session_id 不存在 |
| `NPC_NOT_FOUND` | npc_id 不存在 |
| `NPC_NOT_AVAILABLE` | NPC 当前不可交互 |
| `GAME_ALREADY_ENDED` | 游戏已结束，不能继续对话 |
| `INVALID_PARAM` | 请求参数不合法 |
| `LLM_ERROR` | LLM 调用失败 |
| `INTERNAL_ERROR` | 服务器内部错误 |

### 2.3 Session 管理

- 所有需要 session 的接口通过 **URL 路径参数** 或 **请求体** 传递 `session_id`
- 会话数据存储在 SQLite 中
- MVP 不做用户认证，session_id 即身份标识
- 前端将 session_id 存储在 `localStorage`

---

## 三、API 详细设计

### 3.1 开始游戏 — `POST /api/game/start`

**职责**: 创建新游戏会话，初始化所有游戏状态（世界观、阶段、NPC列表及初始问候语）

**Request**

```json
{
  "player_name": "玩家"          // 可选，默认"玩家"
}
```

**Response** `201 Created`

```json
{
  "session_id": "sess_a1b2c3d4",
  "player_name": "玩家",
  "current_stage": 1,
  "stage_params": {
    "id": 1,
    "name": "不屑",
    "description": "戏班众人对你冷眼相看，觉得你不过是又一个心血来潮的外人",
    "color_tone": "cold",
    "bgm_mood": "melancholy",
    "dialogue_tone": "冷漠、疏离、话中带刺"
  },
  "npcs": [
    {
      "id": "npc_chen",
      "name": "陈师傅",
      "role": "老琴师",
      "scene": "tavern",
      "position": { "x": 1200, "y": 800 },
      "sprite_key": "npc_chen_idle",
      "relationship": 0,
      "is_available": true,
      "current_greeting": "……（陈师傅低头擦拭琴弦，仿佛没看见你）"
    },
    {
      "id": "npc_xiaohua",
      "name": "小华",
      "role": "年轻学徒",
      "scene": "stage",
      "position": { "x": 600, "y": 400 },
      "sprite_key": "npc_xiaohua_idle",
      "relationship": 0,
      "is_available": true,
      "current_greeting": "你也是来看戏班笑话的吗？"
    }
  ],
  "events_triggered": [],
  "game_ended": false
}
```

**说明**:
- `current_greeting`：NPC 头顶气泡显示的问候语，由 AI 根据当前阶段 + NPC 人设生成
- `relationship`：范围 -100 ~ 100，0 为中性
- `scene`：NPC 所在场景/地图，与前端 Tiled Map 对应
- `color_tone` / `bgm_mood`：前端据此调整画面滤镜和音乐

---

### 3.2 获取游戏状态 — `GET /api/game/{session_id}`

**职责**: 获取当前完整游戏状态，是前端唯一的「真相来源」。在以下时机调用：
- 阶段变化后（刷新 NPC 问候语、色调参数）
- 结局触发后（获取结局评价）
- 恢复游戏时（从 localStorage 读取 session_id 恢复）

**Request**

```
GET /api/game/sess_a1b2c3d4
```

**Response** `200 OK`

```json
{
  "session_id": "sess_a1b2c3d4",
  "player_name": "玩家",
  "current_stage": 2,
  "stage_params": {
    "id": 2,
    "name": "了解",
    "description": "你开始走近这个戏班，有人愿意跟你说几句真心话了",
    "color_tone": "warm",
    "bgm_mood": "hopeful",
    "dialogue_tone": "温和、敞开、偶有真情流露"
  },
  "npcs": [
    {
      "id": "npc_chen",
      "name": "陈师傅",
      "role": "老琴师",
      "scene": "tavern",
      "position": { "x": 1200, "y": 800 },
      "sprite_key": "npc_chen_idle",
      "relationship": 15,
      "is_available": true,
      "current_greeting": "来了啊？坐吧。"
    }
  ],
  "events_triggered": ["first_enter_tavern", "chen_first_talk"],
  "game_ended": false,
  "ending": null
}
```

**游戏结束时的响应**（game_ended = true 时）：

```json
{
  "session_id": "sess_a1b2c3d4",
  "current_stage": 3,
  "stage_params": { "id": 3, "name": "抉择", "color_tone": "dramatic", "bgm_mood": "intense" },
  "npcs": [ /* ... */ ],
  "events_triggered": [ /* ... */ ],
  "game_ended": true,
  "ending": {
    "type": "accept_leader",
    "title": "梨园新火",
    "summary": "你选择扛起戏班的大旗。虽然前路艰难，但你在陈师傅的眼中看到了一丝久违的光...",
    "key_moments": [
      {
        "stage": 1,
        "description": "你第一次踏入破旧的戏台，小华对你冷嘲热讽"
      },
      {
        "stage": 2,
        "description": "陈师傅终于开口，讲起了戏班三十年前的辉煌"
      },
      {
        "stage": 3,
        "description": "你在祠堂里做出了最终的决定"
      }
    ],
    "life_lesson": "传承不是守住灰烬，而是让火焰在另一片土地上继续燃烧。",
    "npc_endings": [
      {
        "npc_id": "npc_chen",
        "final_relationship": 85,
        "summary": "陈师傅在晚年终于找到了传人，他把毕生所学倾囊相授"
      },
      {
        "npc_id": "npc_xiaohua",
        "final_relationship": 60,
        "summary": "小华从一开始的敌意，逐渐变成了你最好的搭档"
      }
    ]
  }
}
```

**注意**: `ending` 字段只有在调用 `POST /api/game/{session_id}/evaluate` 后才会填充。首次触发结局时 `game_ended=true` 但 `ending=null`，前端引导调用 evaluate 接口。

---

### 3.3 NPC 对话 — `POST /api/dialogue` 🔥核心

**职责**: 处理所有 NPC 对话交互，是游戏的核心 AI 接口。根据 `player_message` 是否为空，自动区分「首轮对话」和「续接对话」。

**Request**

```json
{
  "session_id": "sess_a1b2c3d4",
  "npc_id": "npc_chen",
  "player_message": "陈师傅，这个戏班以前是什么样的？"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `session_id` | string | 是 | 游戏会话ID |
| `npc_id` | string | 是 | 目标NPC的ID |
| `player_message` | string | 否 | 玩家输入的文字。**首轮对话时不传此字段**（或传 `null`），后端自动生成 NPC 开场白 + AI 选项 |

**两种对话模式**:

| 模式 | player_message | 后端行为 |
|------|---------------|----------|
| **首轮对话** | 不传 / null | 根据阶段+NPC人设+对话历史 → 生成 NPC 开场白 + 3~4个AI选项 |
| **续接对话** | 玩家输入的文字 | 拼接上下文 → LLM 流式生成 NPC 回复 → 检测阶段/结局触发 → 生成下一轮选项 |

**Response**: SSE 流式 (`Content-Type: text/event-stream`)

#### SSE 事件格式

##### 事件类型 1: `delta` — 逐 token 推送

```
event: delta
data: {"chunk": "戏班啊"}

event: delta
data: {"chunk": "……"}

event: delta
data: {"chunk": "三十年前，这镇上的戏台可是夜夜满座。"}
```

##### 事件类型 2: `done` — 流结束，携带元数据

```
event: done
data: {
  "full_text": "戏班啊……三十年前，这镇上的戏台可是夜夜满座。你父亲那时候，一出《空城计》能唱哭半条街的人。",
  "relationship_change": {
    "npc_chen": 5
  },
  "options": [
    {"id": 1, "text": "后来发生了什么？"},
    {"id": 2, "text": "我父亲也会唱戏？"},
    {"id": 3, "text": "那现在为什么变成这样了……"}
  ],
  "stage_changed": false,
  "new_stage": null,
  "ending_triggered": false,
  "events_triggered": []
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `full_text` | string | 完整回复文本（去掉了 SSE chunk 拼接的麻烦） |
| `relationship_change` | object | 各 NPC 关系值变化量，如 `{"npc_chen": 5, "npc_xiaohua": -2}` |
| `options` | array \| null | AI 生成的下一轮对话选项；`null` 表示对话结束（无选项） |
| `stage_changed` | boolean | 是否触发了阶段变化 |
| `new_stage` | object \| null | 若 stage_changed=true，包含新阶段的完整 stage_params |
| `ending_triggered` | boolean | 是否触发了游戏结局 |
| `events_triggered` | string[] | 本次对话触发的新事件ID列表 |

##### 事件类型 3: `error` — 异常

```
event: error
data: {"code": "LLM_ERROR", "message": "AI 生成超时，请重试"}
```

#### 完整 SSE 流示例

```
event: delta
data: {"chunk": "你父亲……"}

event: delta
data: {"chunk": "他是个真正的角儿。"}

event: delta
data: {"chunk": "可惜啊，这世道变了。"}

event: done
data: {"full_text": "...", "relationship_change": {...}, "options": [...], "stage_changed": false, "ending_triggered": false}
```

#### 前端处理 SSE 的伪代码

```javascript
// 推荐使用 fetch + ReadableStream，比 EventSource 更灵活（支持 POST）
async function sendDialogue(sessionId, npcId, playerMessage) {
  const response = await fetch('/api/dialogue', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      session_id: sessionId,
      npc_id: npcId,
      player_message: playerMessage || null
    })
  });

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop(); // 保留不完整的行

    // 简易 SSE 解析
    let eventType = '';
    for (const line of lines) {
      if (line.startsWith('event: ')) {
        eventType = line.slice(7).trim();
      } else if (line.startsWith('data: ')) {
        const data = JSON.parse(line.slice(6));
        handleSSEEvent(eventType, data);
      }
    }
  }
}

function handleSSEEvent(type, data) {
  switch (type) {
    case 'delta':
      dialogBox.appendText(data.chunk);   // 逐字显示
      break;
    case 'done':
      dialogBox.showOptions(data.options); // 显示下一轮选项
      if (data.stage_changed) {
        refreshGameState();                // 刷新色调/音乐
      }
      if (data.ending_triggered) {
        triggerEnding();                   // 触发结局流程
      }
      break;
    case 'error':
      dialogBox.showError(data.message);
      break;
  }
}
```

---

### 3.4 生成结局评价 — `POST /api/game/{session_id}/evaluate`

**职责**: 当对话触发结局后，调用此接口让 AI 生成个性化的结局评价。此接口是**幂等的**——同一 session 多次调用返回相同结果（后端缓存）。

**Request**

```
POST /api/game/sess_a1b2c3d4/evaluate
```

（无请求体，session_id 在 URL 中）

**Response** `200 OK`

```json
{
  "type": "accept_leader",
  "title": "梨园新火",
  "summary": "你选择扛起戏班的大旗。虽然前路艰难，但你在陈师傅的眼中看到了一丝久违的光。戏台上，第一声锣响震碎了多年的沉寂……",
  "key_moments": [
    {
      "stage": 1,
      "description": "你第一次踏入破旧的戏台，小华对你冷嘲热讽"
    },
    {
      "stage": 2,
      "description": "陈师傅终于开口，讲起了戏班三十年前的辉煌与衰落"
    },
    {
      "stage": 3,
      "description": "在祠堂祖宗牌位前，你做出了继承戏班的决定"
    }
  ],
  "life_lesson": "传承不是守住灰烬，而是让火焰在另一片土地上继续燃烧。有些东西，一旦断了就真的没了。",
  "npc_endings": [
    {
      "npc_id": "npc_chen",
      "final_relationship": 85,
      "summary": "陈师傅在晚年终于找到了传人。他把毕生所学倾囊相授，走的时候嘴角带着笑。"
    },
    {
      "npc_id": "npc_xiaohua",
      "final_relationship": 60,
      "summary": "小华从一开始的敌意，逐渐变成了你最好的搭档。他说：'原来你不是来抢东西的。'"
    }
  ]
}
```

**调用时机**:

```
对话中检测到结局条件
    ↓
POST /api/dialogue 的 done 事件中 ending_triggered=true
    ↓
前端展示过渡动画（如"命运的齿轮开始转动..."）
    ↓
POST /api/game/{session_id}/evaluate  ← 此时调用
    ↓
拿到结局评价后，前端播放结局画面
    ↓
同时 GET /api/game/{session_id} 也会包含相同的 ending 数据
```

**后端实现要点**:
- 收集该 session 的所有关键对话节点（对话摘要）
- 收集各 NPC 最终关系值
- 拼接结局评价 Prompt → 调用 LLM → 返回结构化 JSON
- **缓存结果**到 SQLite，同一 session 重复调用直接返回缓存

---

## 四、完整调用时序

```
前端 (Phaser 3)                              后端 (FastAPI)
    │                                              │
    │  [玩家点击"开始游戏"]                          │
    │──── POST /api/game/start ────────────────────→│ 创建会话+初始化状态
    │←──── 201 { session_id, stage, npcs[] } ──────│
    │                                              │
    │  [玩家 WASD 走到陈师傅附近]                    │
    │  [前端显示 NPC 头顶气泡: current_greeting]      │  (数据已在 game/start 返回)
    │                                              │
    │  [玩家按 F 键交互]                             │
    │──── POST /api/dialogue ──────────────────────→│ player_message=null
    │     { session_id, npc_id }                    │ → 识别为首轮对话
    │←──── SSE: delta chunk1 ──────────────────────│ → 生成 NPC 开场白
    │←──── SSE: delta chunk2 ──────────────────────│
    │←──── SSE: done { full_text, options[] } ─────│ → 附带 AI 选项
    │                                              │
    │  [玩家选择选项2: "我父亲也会唱戏？"]            │
    │──── POST /api/dialogue ──────────────────────→│ player_message="我父亲也会唱戏？"
    │     { session_id, npc_id, player_message }    │ → 拼接历史+LLM生成
    │←──── SSE: delta "你父亲啊……" ────────────────│
    │←──── SSE: delta "他可是个真正的角儿" ─────────│
    │←──── SSE: done { stage_changed: true } ──────│ → 阶段变化!
    │                                              │
    │  [前端: 画面色调由冷转暖, 过渡动画]            │
    │──── GET /api/game/{session_id} ──────────────→│ 拉取新阶段完整数据
    │←──── 200 { stage: 2, color_tone: "warm" } ───│ NPC 问候语已刷新
    │                                              │
    │  [继续多轮对话... 省略]                        │
    │                                              │
    │  [关键抉择轮]                                 │
    │──── POST /api/dialogue ──────────────────────→│ 玩家做出最终选择
    │←──── SSE: done { ending_triggered: true } ────│ → 结局触发!
    │                                              │
    │  [前端: 过渡画面 "命运的齿轮开始转动..."]       │
    │──── POST /api/game/{session_id}/evaluate ────→│ LLM 生成结局评价
    │←──── 200 { ending_type, life_lesson, ... } ───│
    │                                              │
    │  [前端: 播放结局画面 + 人生感悟字幕]            │
    │──── GET /api/game/{session_id} ──────────────→│ 包含完整 ending 数据
    │←──── 200 { game_ended: true, ending: {...} } ─│ 可随时重查结局
```

---

## 五、核心数据模型

### 5.1 游戏阶段（Stage）

| 阶段 | name | color_tone | dialogue_tone | 典型触发条件 |
|------|------|------------|---------------|-------------|
| 1 | 不屑 | `cold` | 冷漠疏离 | 游戏开始 |
| 2 | 了解 | `warm` | 温和敞开 | 和一个 NPC 对话达到 5 轮以上 |
| 3 | 抉择 | `dramatic` | 情感浓烈 | 触发关键事件（如祠堂剧情） |

### 5.2 关系值（Relationship）

| 范围 | 含义 | NPC 行为表现 |
|------|------|-------------|
| -100 ~ -30 | 敌意 | 拒绝对话、言语攻击 |
| -30 ~ 0 | 冷淡 | 爱答不理、话中带刺 |
| 0 ~ 30 | 中立 | 正常交流 |
| 30 ~ 70 | 友善 | 主动分享、语气温和 |
| 70 ~ 100 | 信任 | 掏心窝子、透露秘密 |

### 5.3 NPC 状态（NPC State）

```
NPC
├── id: string              唯一标识
├── name: string            显示名称
├── role: string            角色定位（老琴师/年轻学徒）
├── scene: string           所在场景（tavern/stage/shrine/dock）
├── position: {x, y}        地图坐标
├── sprite_key: string      前端精灵标识
├── relationship: int       关系值 (-100~100)
├── is_available: bool      当前是否可交互
└── current_greeting: string 当前阶段下的主动问候语
```

### 5.4 对话记录（存储于 SQLite）

```sql
CREATE TABLE dialogues (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id  TEXT NOT NULL,
    npc_id      TEXT NOT NULL,
    role        TEXT NOT NULL,   -- 'player' | 'npc'
    content     TEXT NOT NULL,
    stage       INTEGER,         -- 发言时所在阶段
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_dialogue_session ON dialogues(session_id, npc_id);
```

---

## 六、后端 Prompt 架构（参考）

### 6.1 NPC Agent 的 System Prompt 结构

```
[世界观] 你是《梨园生死》中的角色，设定在民国时期的江南小镇...
[全局状态] 当前阶段：{stage_name}，对话基调：{dialogue_tone}
[关键事件] 已触发事件：{events}，玩家与各NPC关系：{relationships}
[NPC 人设卡] 你是陈师傅，62岁的老琴师。性格孤傲但内心炽热...
[对话风格] {few_shot_examples}
[当前任务] 玩家对你说：{player_message}，请以陈师傅的身份回应。
[输出格式] 生成自然对话+下一轮3-4个选项。检测阶段/结局触发条件。
```

### 6.2 阶段变化检测逻辑

后端在每轮对话结束后，调用一段判定逻辑（可用规则引擎或一次轻量 LLM 调用）：

```
输入：对话历史摘要 + 当前阶段 + 关系值 + 已触发事件
输出：{ stage_changed: bool, new_stage: int|null, reason: string }
```

规则示例（MVP 阶段一→二）：
- 与任一 NPC 对话轮数 ≥ 5 轮
- 或触发了某个关键事件（如「陈师傅讲起往事」）

---

## 七、MVP 与完整版的边界

| 维度 | MVP（本文档范围） | 后续版本 |
|------|-------------------|----------|
| API 数量 | **4 个** | 扩展至 8-10 个 |
| NPC Agent | 1 个（两个 NPC 共用同一套 Agent 逻辑，只是人设 Prompt 不同） | 每个 NPC 独立 Agent 实例 |
| 对话方式 | AI 生成选项，玩家点选 | 增加自由输入文字 |
| 阶段数 | 2 次阶段变化（1→2→3） | 更细粒度的子阶段 |
| 结局数 | 1 个（MVP 只需验证流程） | 4+ 个结局分支 |
| 对话历史 | 原始存储 | 增加 AI 摘要 + 关键节点提取 |
| 存储 | SQLite 本地 | 迁移至云数据库 |
| 流式 | SSE（fetch + ReadableStream） | WebSocket 双向通信 |

---

## 八、前端 API 封装建议

```typescript
// api/client.ts — 给 A 参考的 TypeScript 封装

const BASE = '/api';

export async function startGame(playerName?: string): Promise<GameState> {
  const res = await fetch(`${BASE}/game/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ player_name: playerName || '玩家' })
  });
  if (!res.ok) throw new ApiError(await res.json());
  return res.json();
}

export async function getGameState(sessionId: string): Promise<GameState> {
  const res = await fetch(`${BASE}/game/${sessionId}`);
  if (!res.ok) throw new ApiError(await res.json());
  return res.json();
}

export async function startDialogue(
  sessionId: string,
  npcId: string,
  playerMessage: string | null,
  onChunk: (text: string) => void,
  onDone: (result: DialogueResult) => void,
  onError: (error: ApiError) => void
): Promise<void> {
  const res = await fetch(`${BASE}/dialogue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      session_id: sessionId,
      npc_id: npcId,
      player_message: playerMessage
    })
  });
  // SSE 解析逻辑见 3.3 节的伪代码
}

export async function evaluateEnding(sessionId: string): Promise<EndingData> {
  const res = await fetch(`${BASE}/game/${sessionId}/evaluate`, {
    method: 'POST'
  });
  if (!res.ok) throw new ApiError(await res.json());
  return res.json();
}
```

---

## 附录：Mock 数据清单（给 B 的第一项交付物）

B 在开始写后端逻辑前，应先用 JSON 文件给出以下 Mock 响应，让 A 能独立开发前端：

| 文件 | 对应接口 | 说明 |
|------|---------|------|
| `mock/start_game.json` | `POST /api/game/start` | 一次完整的初始化响应 |
| `mock/game_state.json` | `GET /api/game/{id}` | 阶段二时的状态快照 |
| `mock/game_state_ended.json` | `GET /api/game/{id}` | 游戏结束时的状态（含结局） |
| `mock/dialogue_sse.txt` | `POST /api/dialogue` | 一段完整的 SSE 流文本（含 delta + done 事件） |
| `mock/evaluate.json` | `POST /api/game/{id}/evaluate` | 结局评价响应 |
