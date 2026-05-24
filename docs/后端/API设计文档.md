# 《梨园生死》API 设计文档

> **版本**: v1.2 | **最后更新**: 2026-05-24 | **设计原则**: 职责单一、接口清晰、按业务模块拆分

---

## 一、概述

### 1.1 游戏流程

```
开始游戏/加载存档 → 探索地图(WASD) → 接近NPC → 触发对话(F键)
  → 多轮AI对话（选项点选 or 自由输入）→ 自然结束/退出对话 → 阶段变化 → 触发结局 → AI评价总结
```

### 1.2 API 设计原则

| 原则 | 说明 |
|------|------|
| **职责单一** | 每个 API 只负责一个明确的业务功能 |
| **RESTful 风格** | 资源路径清晰，HTTP 方法语义正确 |
| **SSE 流式** | 对话接口使用 Server-Sent Events，逐 token 推送 |
| **状态集中** | 游戏全局状态通过单一入口获取 |
| **MVP 最小化** | 只设计 MVP 必需的接口，预留扩展空间 |

### 1.3 API 总览（8 个接口）

> 📎 **详见 [_shared/API接口清单.md](../_shared/API接口清单.md)** — 接口总览表。

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
| `SESSION_NOT_FOUND` | session_id 不存在或已删除 |
| `NPC_NOT_FOUND` | npc_id 不存在 |
| `NPC_NOT_AVAILABLE` | NPC 当前不可交互 |
| `GAME_ALREADY_ENDED` | 游戏已结束，不能继续对话 |
| `INVALID_PARAM` | 请求参数不合法 |
| `LLM_ERROR` | LLM 调用失败 |
| `INTERNAL_ERROR` | 服务器内部错误 |

### 2.3 Session 管理

- MVP 不做用户认证，session_id 即身份标识
- 前端将 session_id 存储在 `localStorage`
- API Key 仅存内存，不持久化

---

## 三、API 详细设计

### 3.1 开始游戏 — `POST /api/game/start`

**职责**: 创建新游戏会话，初始化所有游戏状态。

**Request**

```json
{
  "player_name": "玩家",          // 可选，默认"玩家"
  "api_key": "sk-xxxxx",          // 可选，LLM API Key（仅存内存）
  "model": "deepseek-v3.1-terminus"  // 可选，指定模型名
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
      "current_greeting": "……（陈师傅低头擦拭琴弦，仿佛没看见你）",
      "last_dialogue": "",
      "last_options": [],
      "dialogue_round_count": 0
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
      "current_greeting": "你也是来看戏班笑话的吗？",
      "last_dialogue": "",
      "last_options": [],
      "dialogue_round_count": 0
    }
  ],
  "events_triggered": [],
  "game_ended": false,
  "ending": null
}
```

### 3.2 获取游戏状态 — `GET /api/game/{session_id}`

**职责**: 获取当前完整游戏状态，是前端唯一的「真相来源」。

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
    "color_tone": "warm",
    "bgm_mood": "hopeful",
    "dialogue_tone": "温和、敞开、偶有真情流露"
  },
  "npcs": [
    {
      "id": "npc_chen",
      "name": "陈师傅",
      "relationship": 15,
      "is_available": true,
      "current_greeting": "来了啊？坐吧。",
      "last_dialogue": "嗯……你倒是问到了点子上。三十年前，这戏台可是夜夜满座。",
      "last_options": ["后来发生了什么？", "我父亲也在这唱过戏？", "那现在为什么变成这样了……"],
      "dialogue_round_count": 3
    }
  ],
  "events_triggered": ["first_enter_tavern", "chen_first_talk"],
  "game_ended": false,
  "ending": null
}
```

**游戏结束时的响应**（`game_ended=true`）：

```json
{
  "game_ended": true,
  "ending": {
    "type": "accept_leader",
    "title": "梨园新火",
    "summary": "你选择扛起戏班的大旗...",
    "key_moments": [
      {"stage": 1, "description": "你第一次踏入破旧的戏台"},
      {"stage": 2, "description": "陈师傅讲起了戏班三十年前的辉煌"},
      {"stage": 3, "description": "你在祠堂里做出了最终的决定"}
    ],
    "life_lesson": "传承不是守住灰烬，而是让火焰在另一片土地上继续燃烧。",
    "npc_endings": [
      {"npc_id": "npc_chen", "final_relationship": 85, "summary": "..."},
      {"npc_id": "npc_xiaohua", "final_relationship": 60, "summary": "..."}
    ]
  }
}
```

> **注意**: `ending` 字段只在调用 evaluate 接口后填充。首次触发结局时 `game_ended=true` 但 `ending=null`，前端引导调用 evaluate 接口。

### 3.3 NPC 对话 — `POST /api/dialogue` 🔥核心

**职责**: 处理所有 NPC 对话交互，是游戏的核心 AI 接口。

**Request**

```json
{
  "session_id": "sess_a1b2c3d4",
  "npc_id": "npc_chen",
  "player_message": "陈师傅，这个戏班以前是什么样的？",
  "api_key": "sk-xxxxx",
  "model": null
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `session_id` | string | 是 | 游戏会话ID |
| `npc_id` | string | 是 | 目标NPC的ID |
| `player_message` | string | 否 | 首轮不传（后端自动生成开场白）；可传递自由文本 |
| `api_key` | string | 否 | 会话重建后丢失 key 时传入 |
| `model` | string | 否 | 模型名，不传则使用 session 级默认 |

**两种对话模式**:

| 模式 | player_message | 后端行为 |
|------|---------------|----------|
| **首轮对话** | 不传 / null | 生成 NPC 开场白 + 3~4 个 AI 选项 |
| **续接对话** | 选项文本 / 自由输入 | 拼接上下文 → LLM 流式生成 → 检测阶段/结局触发 |

**Response**: SSE 流式 (`Content-Type: text/event-stream`)

> 📎 **SSE 事件格式详见 [_shared/SSE通信格式.md](../_shared/SSE通信格式.md)**

**前端 SSE 解析伪代码**:

```javascript
async function sendDialogue(sessionId, npcId, playerMessage) {
  const response = await fetch('/api/dialogue', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId, npc_id: npcId, player_message: playerMessage || null })
  });
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    let eventType = '';
    for (const line of lines) {
      if (line.startsWith('event: ')) eventType = line.slice(7).trim();
      else if (line.startsWith('data: ')) {
        const data = JSON.parse(line.slice(6));
        handleSSEEvent(eventType, data);
      }
    }
  }
}
```

### 3.4 生成结局评价 — `POST /api/game/{session_id}/evaluate`

**职责**: 对话触发结局后，生成个性化结局评价。幂等——同一 session 多次调用返回相同结果。

**Request**
```
POST /api/game/sess_a1b2c3d4/evaluate
```

**Response** `200 OK`

```json
{
  "type": "accept_leader",
  "title": "梨园新火",
  "summary": "你选择扛起戏班的大旗...",
  "key_moments": [
    {"stage": 1, "description": "你第一次踏入破旧的戏台"},
    {"stage": 2, "description": "陈师傅讲起了戏班三十年前的辉煌与衰落"},
    {"stage": 3, "description": "在祠堂祖宗牌位前，你做出了继承戏班的决定"}
  ],
  "life_lesson": "传承不是守住灰烬，而是让火焰在另一片土地上继续燃烧。",
  "npc_endings": [
    {"npc_id": "npc_chen", "final_relationship": 85, "summary": "陈师傅在晚年终于找到了传人。"},
    {"npc_id": "npc_xiaohua", "final_relationship": 60, "summary": "小华从一开始的敌意，逐渐变成了你最好的搭档。"}
  ]
}
```

**调用时序**: `done 事件 ending_triggered=true` → 前端过渡动画 → `POST evaluate` → 播放结局

### 3.5 存档列表 — `GET /api/sessions`

**Request**
```
GET /api/sessions
```

**Response** `200 OK`

```json
{
  "sessions": [
    {
      "session_id": "sess_a1b2c3d4",
      "player_name": "玩家",
      "stage": 2,
      "stage_name": "了解",
      "game_ended": false,
      "created_at": "2026-05-23 20:00:00",
      "updated_at": "2026-05-23 20:30:00"
    }
  ],
  "total": 1
}
```

### 3.6 删除存档 — `DELETE /api/game/{session_id}`

**Request**
```
DELETE /api/game/sess_a1b2c3d4
```

**Response** `200 OK`
```json
{ "success": true, "message": "已删除会话: sess_a1b2c3d4" }
```

**Response** `404`
```json
{ "error": true, "code": "SESSION_NOT_FOUND", "message": "..." }
```

### 3.7 对话历史查询 — `GET /api/game/{session_id}/dialogues`

**Request**
```
GET /api/game/sess_a1b2c3d4/dialogues?npc_id=npc_chen&page=1&page_size=20
```

**Response** `200 OK`

```json
{
  "items": [
    {
      "id": 1, "session_id": "sess_a1b2c3d4", "npc_id": "npc_chen",
      "role": "npc", "content": "……（陈师傅低头擦拭琴弦）",
      "options": ["陈师傅好", "默默站在一旁", "去找小华"],
      "stage": 1, "created_at": "2026-05-23 20:01:00"
    }
  ],
  "total": 25, "page": 1, "page_size": 20
}
```

### 3.8 退出对话 — `POST /api/dialogue/exit`

**Request**
```json
{
  "session_id": "sess_a1b2c3d4",
  "npc_id": "npc_chen",
  "api_key": "sk-xxxxx",
  "model": null
}
```

**Response** `200 OK`
```json
{ "dialogue_text": "行吧，时候不早了，你去忙你的。", "options": [], "is_available": true }
```

> **说明**: 不走 SSE 流式，直接返回 JSON。`is_available` 不受退出影响——可用性由后端剧情逻辑控制。

---

### 3.9 关系值历史 — `GET /api/game/{session_id}/relationships`

**职责**: 查询关系值变化历史，支持按 NPC 筛选。

**Request**
```
GET /api/game/sess_a1b2c3d4/relationships?npc_id=npc_chen
```

**Response** `200 OK`

```json
{
  "session_id": "sess_a1b2c3d4",
  "npc_id": "npc_chen",
  "logs": [
    {
      "id": 1,
      "session_id": "sess_a1b2c3d4",
      "npc_id": "npc_chen",
      "delta": 5,
      "reason": "对话",
      "relationship_after": 5,
      "created_at": "2026-05-24 12:00:00"
    }
  ],
  "current_relationships": {
    "npc_chen": 15,
    "npc_xiaohua": 10
  },
  "total": 1
}
```

### 3.10 事件时间线 — `GET /api/game/{session_id}/events`

**职责**: 查询已触发事件的时间线。

**Request**
```
GET /api/game/sess_a1b2c3d4/events
```

**Response** `200 OK`

```json
{
  "session_id": "sess_a1b2c3d4",
  "events": [
    {
      "id": 1,
      "event_id": "first_enter_tavern",
      "triggered_by": "system",
      "stage": 1,
      "stage_name": "不屑",
      "created_at": "2026-05-24 12:00:00"
    }
  ],
  "total": 1
}
```

---

## 四、完整调用时序

```
前端 (Phaser 3)                              后端 (FastAPI)
    │                                              │
    │  [进入游戏]                                    │
    │──── GET /api/sessions ───────────────────────→│
    │←──── 200 { sessions[] } ─────────────────────│
    │                                              │
    │  [新游戏]                                     │
    │──── POST /api/game/start ────────────────────→│
    │←──── 201 { session_id, stage, npcs[] } ──────│
    │                                              │
    │  [接近 NPC → 按 F]                            │
    │──── POST /api/dialogue ──────────────────────→│ player_message=null
    │←──── SSE: delta → done { options[] } ────────│
    │                                              │
    │  [点选选项 / 自由输入 / ESC退出]                 │
    │──── POST /api/dialogue ──────────────────────→│ player_message="..."
    │←──── SSE: done → 循环                         │
    │                                              │
    │  [结局触发]                                    │
    │──── POST /api/game/{id}/evaluate ────────────→│
    │←──── 200 { type, title, summary } ───────────│
```

---

## 五、核心数据模型

> 📎 **详见 [_shared/数据模型.md](../_shared/数据模型.md)** — GameSession、NPCState、Stage 定义。

> 📎 **阶段参数表详见 [_shared/阶段系统.md](../_shared/阶段系统.md)**

> 📎 **关系值系统详见 [_shared/关系值系统.md](../_shared/关系值系统.md)**

### 对话记录（存储于 SQLite）

```sql
CREATE TABLE dialogues (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id  TEXT NOT NULL,
    npc_id      TEXT NOT NULL,
    role        TEXT NOT NULL,   -- 'player' | 'npc'
    content     TEXT NOT NULL,
    options     TEXT,            -- JSON: NPC 回复时附带的选项
    stage       INTEGER,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_dialogue_session ON dialogues(session_id, npc_id);
```

---

## 六、后端 Prompt 架构（参考）

> 📎 **详见 [架构设计.md](./架构设计.md)** — NPC Agent 架构、Handoff 机制、Response Parser、关系值 Clamp。

### 6.1 NPC Agent System Prompt

```
[世界观] 你是《梨园生死》中的角色，设定在民国时期的江南小镇...
[全局状态] 当前阶段：{stage_name}，对话基调：{dialogue_tone}
[关键事件] 已触发事件：{events}，玩家与各NPC关系：{relationships}
[NPC 人设卡] 你是陈师傅，62岁的老琴师...
[对话风格] {few_shot_examples}
[当前任务] 玩家对你说：{player_message}，请以陈师傅的身份回应。
[输出格式] 生成自然对话+下一轮3-4个选项。检测阶段/结局触发条件。
```

---

## 七、MVP 与完整版的边界

| 维度 | v1.0-MVP / v1.1（本文档范围） | 后续版本 |
|------|-------------------------------|----------|
| API 数量 | **10 个**（v1.0: 4个 + v1.1: 4个 + v1.2: 2个） | 扩展至 12+ 个 |
| NPC Agent | 2 个 NPC Agent | 每个 NPC 独立 Agent 实例 + 主动行为 |
| NPC Handoff | ✅ 事件驱动跨NPC上下文注入 | 复杂 NPC 间协作剧情 |
| 对话方式 | AI 生成选项 + 自由输入文字 | 自由输入为主 |
| 阶段切换 | 双模判定（规则条件 + LLM 判定） | 更复杂的多条件分支 |
| 阶段数 | 2 次阶段变化（1→2→3） | 细粒度子阶段 |
| 结局数 | 1 个 | 4+ 个结局分支 |
| 存档管理 | ✅ 列表/软删除 | 重命名、备注 |
| 存储 | SQLite 本地 | 云数据库 |
| 流式 | SSE（fetch + ReadableStream） | WebSocket 双向通信 |

---

## 附录：Mock 数据清单

| 文件 | 对应接口 |
|------|---------|
| `mock/start_game.json` | `POST /api/game/start` |
| `mock/game_state.json` | `GET /api/game/{id}`（阶段二） |
| `mock/game_state_ended.json` | `GET /api/game/{id}`（含结局） |
| `mock/dialogue_sse.txt` | `POST /api/dialogue`（完整 SSE 流） |
| `mock/evaluate.json` | `POST /api/game/{id}/evaluate` |
| `mock/sessions.json` | `GET /api/sessions` |
| `mock/dialogues.json` | `GET /api/game/{id}/dialogues` |
| `mock/exit_dialogue.json` | `POST /api/dialogue/exit` |
| `mock/relationships.json` | `GET /api/game/{id}/relationships` |
| `mock/events.json` | `GET /api/game/{id}/events` |
