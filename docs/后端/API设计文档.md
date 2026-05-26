# 《梨园生死》API 设计文档

> **版本**: v2.0 | **最后更新**: 2026-05-25 | **设计原则**: 章节驱动、AI 任务规划、多 NPC 共识推进

---

## 一、概述

### 1.1 游戏流程

```
选择剧本 → 创建会话 → 开始第一章 → 探索/对话/物品交互
  → 任务子目标逐个完成 → NPC 共识投票通过 → 章节完成
  → 自动推进下一章 → ... → 所有章节完成 → AI 结局评价
```

### 1.2 章节生命周期

```
POST /api/game/start              ← 创建会话（返回完整状态 + first_chapter 提示）
       ↓
POST /api/game/{id}/chapter/start ← 前端调用，触发章节初始化
       ↓                    ↺ LLM 任务规划（TaskPlanner，有模板则秒级返回）
  章节进行中：对话/探索/物品
       ↓
  SSE done 事件中 chapter_completed=true（所有 NPC 投票通过后）
       ↓
  自动调用 advance_to_next_chapter()（标记旧章节完成、查找下一章）
       ↓
  前端再次调用 POST /api/game/{id}/chapter/start（初始化下一章）
       ↓                    ← 此接口会检查 is_completed，未完成则返回 400
  循环…直到所有章节完成 → game_ended=true
```

### 1.3 API 设计原则

| 原则 | 说明 |
|------|------|
| **职责单一** | 每个 API 只负责一个明确的业务功能 |
| **RESTful 风格** | 资源路径清晰，HTTP 方法语义正确 |
| **SSE 流式** | 对话接口使用 Server-Sent Events，逐 token 推送 |
| **章节驱动** | 游戏进度由章节+任务系统驱动，取代旧的 stage 线性推进 |
| **AI 任务规划** | 每章开始时 LLM 根据剧本定义生成具体子任务 |
| **NPC 共识投票** | 章节完成需多 NPC 投票确认 |

### 1.4 API 总览（v2 共 24 个接口）

| 模块 | 方法 | 路径 | 说明 |
|------|------|------|------|
| 游戏 | POST | `/api/game/start` | 创建新游戏会话 |
| 游戏 | GET | `/api/scripts` | 列出可用剧本 |
| 游戏 | GET | `/api/game/{id}` | 获取游戏完整状态 |
| 游戏 | GET | `/api/game/{id}/dialogues` | 对话历史（分页） |
| 游戏 | POST | `/api/game/{id}/evaluate` | 生成结局评价 |
| 游戏 | GET | `/api/game/{id}/relationships` | 关系值历史 |
| 游戏 | GET | `/api/game/{id}/events` | 事件时间线 |
| 游戏 | DELETE | `/api/game/{id}` | 删除存档 |
| 游戏 | GET | `/api/sessions` | 存档列表 |
| 游戏 | POST | `/api/game/{id}/npc/position` | 上报 NPC 新位置 |
| 游戏 | POST | `/api/game/{id}/npc/positions/batch` | 批量同步 NPC 位置 |
| 游戏 | POST | `/api/game/{id}/npc/spawn` | 运行时生成临时 NPC |
| 章节 | POST | `/api/game/{id}/chapter/start` | 开始/推进章节（触发 LLM 任务规划） |
| 章节 | GET | `/api/game/{id}/chapter` | 获取当前章节状态+任务进度 |
| 章节 | GET | `/api/game/{id}/task` | 获取当前任务详情（子任务+投票） |
| 对话 | POST | `/api/dialogue` | NPC 对话（SSE 流式） |
| 对话 | POST | `/api/dialogue/show-item` | 向 NPC 展示物品（SSE 流式） |
| 对话 | POST | `/api/dialogue/exit` | 退出对话 |
| 物品 | GET | `/api/game/{id}/items` | 获取物品清单（背包+场景） |
| 物品 | GET | `/api/game/{id}/item/{item_id}` | 查看单个物品详情 |
| 物品 | POST | `/api/game/{id}/item/discover` | 发现物品（标记+AI旁白） |
| 编剧 | GET | `/api/scripts/{id}/town-npcs` | 查询普通 NPC 列表 |
| 编剧 | POST | `/api/scripts/{id}/town-npcs` | 批量创建/覆盖普通 NPC |
| 编剧 | DELETE | `/api/scripts/{id}/town-npcs/{nid}` | 删除普通 NPC |
| 编剧 | PUT | `/api/scripts/{id}/town-npcs/{nid}` | 更新普通 NPC 配置 |

---

## 二、通用规范

### 2.1 基础信息

```
Base URL:     http://localhost:8000/api
Content-Type: application/json; charset=utf-8
字符编码:      UTF-8
```

### 2.2 坐标约定

**所有 API 中的 `position` 字段统一使用瓦片坐标（tile coordinate）：**

```json
{ "col": 43, "row": 16 }
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `col` | int | 列号，0 起，向右递增 |
| `row` | int | 行号，0 起，向下递增 |

- 后端不感知像素坐标，全部使用瓦片坐标
- 前端通过 `COORD.toPixel(col, row)` 转换为像素坐标用于渲染
- 前端通过 `COORD.toTile(px, py)` 将像素坐标转换为瓦片坐标
- 详细规范见 `docs/_shared/坐标体系.md`

### 2.3 统一错误响应格式

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
| `SCRIPT_NOT_FOUND` | script_id 对应的剧本目录不存在 |
| `NPC_NOT_FOUND` | npc_id 不存在 |
| `NPC_NOT_AVAILABLE` | NPC 当前不可交互 |
| `GAME_ENDED` | 游戏已结束 |
| `NO_CHAPTERS` | 没有可用的章节定义 |
| `CHAPTER_NOT_FOUND` | 指定的 chapter_id 不存在 |
| `CHAPTER_START_FAILED` | 章节初始化失败 |
| `CHAPTER_NOT_COMPLETED` | 当前章节未完成（NPC 投票未全通过），不可推进 |
| `ITEM_NOT_FOUND` | 物品不存在或不在背包中 |
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

**职责**: 创建新游戏会话，加载指定剧本，初始化 NPC 状态。

**Request**

```json
{
  "player_name": "玩家",
  "api_key": "sk-xxxxx",
  "model": "deepseek-v3.1-terminus",
  "script_id": "liyuan_shengsi"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `player_name` | string | 否 | 默认"玩家" |
| `api_key` | string | 否 | LLM API Key（仅存内存） |
| `model` | string | 否 | 指定模型名 |
| `script_id` | string | 否 | 剧本 ID，默认"liyuan_shengsi" |

**Response** `201 Created`

```json
{
  "session_id": "sess_a1b2c3d4",
  "player_name": "玩家",
  "script_id": "liyuan_shengsi",
  "current_stage": 1,
  "stage_params": {
    "id": 1,
    "name": "归乡",
    "description": "父亲病逝，你带着他的骨灰回到陌生的故乡。",
    "color_tone": "#8899aa",
    "bgm_mood": "melancholy_distant",
    "dialogue_tone": ""
  },
  "current_chapter": null,
  "completed_chapters": [],
  "npcs": [
    {
      "id": "npc_chen",
      "name": "陈师傅",
      "role": "老琴师",
      "scene": "teahouse",
      "position": { "col": 43, "row": 16 },
      "sprite_key": "npc_chen_idle",
      "relationship": 20,
      "is_available": true,
      "current_greeting": "……（陈师傅低头擦拭琴弦，仿佛没看见你）",
      "last_dialogue": "",
      "last_options": [],
      "dialogue_round_count": 0
    }
  ],
  "events_triggered": [],
  "game_ended": false,
  "ending": null,
  "inventory": []
}
```

> **注意**: 创建会话时不会自动开始第一章。前端需根据 `current_chapter: null` 判断，然后调用 `POST /api/game/{id}/chapter/start` 初始化章节。

### 3.2 剧本列表 — `GET /api/scripts`

**职责**: 列出所有可用剧本。

**Response** `200 OK`

```json
{
  "scripts": [
    {
      "script_id": "liyuan_shengsi",
      "name": "梨园生死",
      "version": "1.0",
      "author": "Team A",
      "npc_count": 5,
      "chapter_count": 6,
      "description": "江南水乡小镇梨溪镇，民国时期。"
    }
  ],
  "total": 1
}
```

### 3.3 获取游戏状态 — `GET /api/game/{session_id}`

**职责**: 获取当前完整游戏状态，是前端唯一的「真相来源」。

**Response** `200 OK`

```json
{
  "session_id": "sess_a1b2c3d4",
  "player_name": "玩家",
  "script_id": "liyuan_shengsi",
  "current_stage": 2,
  "stage_params": {
    "id": 2,
    "name": "闻声·异样",
    "description": "你偶然走到老街深处，看见一座门庭冷清的老戏院...",
    "color_tone": "#8899bb",
    "bgm_mood": "eerie_warm",
    "dialogue_tone": ""
  },
  "current_chapter": {
    "chapter_id": "ch_01",
    "chapter_name": "闻声·异样",
    "color_tone": "#8899bb",
    "bgm_mood": "eerie_warm",
    "completion_rate": 0.5
  },
  "completed_chapters": ["ch_prologue"],
  "npcs": [
    {
      "id": "npc_chen",
      "name": "陈师傅",
      "relationship": 25,
      "is_available": true,
      "current_greeting": "来了啊？坐吧。……",
      "last_dialogue": "嗯……你倒是问到了点子上。",
      "last_options": ["后来发生了什么？", "我父亲也在这唱过戏？"],
      "dialogue_round_count": 3
    }
  ],
  "events_triggered": ["first_enter_tavern"],
  "game_ended": false,
  "ending": null,
  "inventory": [
    {
      "id": "item_urn",
      "name": "父亲的骨灰盒",
      "description": "一个简朴的深色木盒，里面装着父亲柳三秋的骨灰。",
      "is_key": false,
      "is_discovered": true
    }
  ]
}
```

### 3.4 开始章节 — `POST /api/game/{session_id}/chapter/start` 🔥核心

**职责**: 开始新一章。首次调用初始化第一章，后续调用推进到下一章。会触发 **LLM 任务规划**生成子任务。

**Request**

```json
{
  "chapter_id": null
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `chapter_id` | string | 否 | 指定章节 ID 跳转；不传则自动推进到下一章 |

**三种调用场景**:

| 场景 | chapter_id | 行为 |
|------|------------|------|
| 首次开始 | 不传/null | 取第一章（跳过 cinematic 类型） |
| 推进下一章 | 不传/null | 标记旧章节完成 → 取下一章 → LLM 规划任务 |
| 指定跳转 | "ch_02" | 验证章节存在 → LLM 规划任务 |

**Response** `200 OK`

```json
{
  "chapter_id": "ch_01",
  "chapter_name": "闻声·异样",
  "chapter_type": "task",
  "task": {
    "task_id": "task_ch_01_a1b2c3",
    "chapter_id": "ch_01",
    "chapter_name": "闻声·异样",
    "description": "探索老戏院，与戏班的人初步接触",
    "sub_tasks": [
      {
        "id": "st_001",
        "title": "找到老戏院",
        "mode": "explore",
        "description": "在小镇上找到戏台的位置并进入",
        "target_position": { "col": 48, "row": 8 },
        "target_scene": "stage_ruin",
        "status": "active"
      },
      {
        "id": "st_002",
        "title": "与戏班的人打照面",
        "mode": "dialogue",
        "target_npc_id": "npc_xiaohua",
        "description": "在戏台内遇到小华，进行第一次对话",
        "target_position": null,
        "status": "locked"
      }
    ],
    "related_npc_ids": ["npc_xiaohua", "npc_laozhou"],
    "npc_completion_votes": {
      "npc_xiaohua": false,
      "npc_laozhou": false
    },
    "completion_rate": 0.0,
    "is_completed": false
  },
  "color_tone": "#8899bb",
  "bgm_mood": "eerie_warm"
}
```

**所有章节完成时**:

```json
{
  "chapter_id": null,
  "game_ended": true,
  "message": "所有章节已完成"
}
```

### 3.5 获取章节状态 — `GET /api/game/{session_id}/chapter`

**职责**: 获取当前章节状态和任务进度（轻量级，不含 LLM 调用）。

**Response** `200 OK`

```json
{
  "current_chapter": {
    "chapter_id": "ch_01",
    "chapter_name": "闻声·异样",
    "chapter_type": "task",
    "color_tone": "#8899bb",
    "bgm_mood": "eerie_warm"
  },
  "completed_chapters": ["ch_prologue"],
  "task": {
    "task_id": "task_ch_01_a1b2c3",
    "completion_rate": 0.5,
    "is_completed": false,
    "sub_tasks": [
      { "id": "st_001", "title": "找到老戏院", "mode": "explore", "status": "completed" },
      { "id": "st_002", "title": "与戏班的人打照面", "mode": "dialogue", "status": "active" },
      { "id": "st_003", "title": "遇到沉默的老艺人", "mode": "dialogue", "status": "locked" }
    ]
  }
}
```

### 3.6 获取任务详情 — `GET /api/game/{session_id}/task`

**职责**: 获取当前任务的完整详情（含子任务列表和 NPC 投票状态）。

**Response** `200 OK`

```json
{
  "task": {
    "task_id": "task_ch_01_a1b2c3",
    "chapter_id": "ch_01",
    "chapter_name": "闻声·异样",
    "description": "探索老戏院，与戏班的人初步接触",
    "sub_tasks": [
      {
        "id": "st_001",
        "title": "找到老戏院",
        "mode": "explore",
        "description": "在小镇上找到戏台的位置并进入",
        "target_scene": "stage_ruin",
        "target_position": { "col": 48, "row": 8 },
        "status": "completed"
      }
    ],
    "related_npc_ids": ["npc_xiaohua", "npc_laozhou"],
    "npc_completion_votes": {
      "npc_xiaohua": true,
      "npc_laozhou": false
    },
    "completion_rate": 0.5,
    "is_completed": false
  }
}
```

### 3.7 NPC 对话 — `POST /api/dialogue` 🔥核心

**职责**: 处理所有 NPC 对话交互，是游戏的核心 AI 接口。

**Request**

```json
{
  "session_id": "sess_a1b2c3d4",
  "npc_id": "npc_chen",
  "player_message": "陈师傅，这个戏班以前是什么样的？",
  "api_key": null,
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

**Response**: SSE 流式 (`Content-Type: text/event-stream`)

**SSE 事件类型**:

| 事件 | 说明 | data 格式 |
|------|------|-----------|
| `delta` | 增量 token | `{"chunk": "你"}` |
| `done` | 对话完成 | 见下方 |
| `error` | 错误 | `{"code": "LLM_ERROR", "message": "..."}` |

**done 事件 data**:

```json
{
  "full_text": "嗯……你倒是问到了点子上。三十年前，这戏台可是夜夜满座。",
  "relationship_change": { "npc_chen": 5 },
  "options": ["后来发生了什么？", "我父亲也在这唱过戏？", "那现在为什么变成这样了……"],
  "events_triggered": [],
  "chapter_completed": false,
  "game_ended": false,
  "current_chapter": {
    "chapter_id": "ch_01",
    "chapter_name": "闻声·异样"
  }
}
```

> **关键**: `chapter_completed=true` 时，后端已自动调用 `advance_to_next_chapter()` 标记旧章节完成。前端需再调用 `POST /chapter/start` 初始化下一章。

### 3.8 展示物品 — `POST /api/dialogue/show-item`

**职责**: 向 NPC 展示背包中的物品，注入物品上下文到对话 Prompt（SSE 流式）。

**Request**

```json
{
  "session_id": "sess_a1b2c3d4",
  "npc_id": "npc_chen",
  "item_id": "item_child_costume",
  "player_message": null,
  "api_key": null,
  "model": null
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `item_id` | string | 是 | 背包中物品 ID |

**Response**: 同 `POST /api/dialogue` 的 SSE 流式，done 事件额外包含 `shown_item` 字段。

### 3.9 退出对话 — `POST /api/dialogue/exit`

**Request**

```json
{
  "session_id": "sess_a1b2c3d4",
  "npc_id": "npc_chen"
}
```

**Response** `200 OK`

```json
{ "dialogue_text": "行吧，时候不早了，你去忙你的。", "options": [], "is_available": true }
```

### 3.10 生成结局评价 — `POST /api/game/{session_id}/evaluate`

**职责**: 游戏结束后生成个性化结局评价。幂等——同一 session 多次调用返回相同结果。

**Response** `200 OK`

```json
{
  "type": "story_complete",
  "title": "梨园新火",
  "summary": "你选择扛起戏班的大旗...",
  "key_moments": [],
  "life_lesson": "传承不是守住灰烬，而是让火焰在另一片土地上继续燃烧。",
  "npc_endings": [
    { "npc_id": "npc_chen", "final_relationship": 85, "summary": "..." }
  ]
}
```

### 3.11 物品清单 — `GET /api/game/{session_id}/items`

**职责**: 获取物品清单，分为背包（已发现可持有）和场景物品（当前章节可发现但尚未拾取）。

**Response** `200 OK`

```json
{
  "inventory": [
    {
      "id": "item_urn",
      "name": "父亲的骨灰盒",
      "item_type": "key",
      "base_description": "一个简朴的深色木盒，里面装着父亲柳三秋的骨灰。",
      "ai_detail": null,
      "ai_detail_locked": false,
      "is_key": true,
      "is_discovered": true,
      "location": { "scene": "cemetery" },
      "discovery_context": "你在坟前找到了它，木盒还带着雨水的湿润。",
      "related_npcs": [],
      "holdable": true,
      "acquire_method": "explore"
    }
  ],
  "scene_items": [
    {
      "item_id": "item_child_costume",
      "name": "小孩戏服",
      "location": { "scene": "stage_ruin", "position": { "col": 10, "row": 12 } },
      "acquire_method": "click"
    }
  ]
}
```

| 字段 | 说明 |
|------|------|
| `inventory` | 背包中已发现的物品（完整 NarrativeItem 详情） |
| `scene_items` | 当前章节可发现但尚未拾取的物品（摘要） |

### 3.11a 物品详情 — `GET /api/game/{session_id}/item/{item_id}`

**职责**: 查看单个物品完整详情，背包中已发现的返回完整运行时信息，场景中未发现的返回静态定义。

**Response** `200 OK` — 已发现（背包中）

```json
{
  "item_id": "item_urn",
  "from": "inventory",
  "item": {
    "id": "item_urn",
    "name": "父亲的骨灰盒",
    "item_type": "key",
    "base_description": "一个简朴的深色木盒...",
    "ai_detail": "盒盖上刻着柳三秋三个字，已经有些模糊了。",
    "ai_detail_locked": true,
    "is_key": true,
    "is_discovered": true,
    "discovery_context": "你在坟前找到了它...",
    "related_npcs": [],
    "holdable": true,
    "location": { "scene": "cemetery" },
    "acquire_method": "explore"
  }
}
```

**Response** `200 OK` — 未发现（场景中）

```json
{
  "item_id": "item_child_costume",
  "from": "scene",
  "is_discovered": false,
  "item": {
    "id": "item_child_costume",
    "name": "小孩戏服",
    "base_description": "一件褪色的京剧童装，上面绣着精致的花纹。",
    "item_type": "misc",
    "is_key": false,
    "is_discovered": false,
    "holdable": true,
    "location": { "scene": "stage_ruin", "position": { "col": 10, "row": 12 } },
    "acquire_method": "click",
    "related_npcs": ["npc_chen"],
    "stage_relevance": [1, 2]
  }
}
```

### 3.11b 发现物品 — `POST /api/game/{session_id}/item/discover`

**职责**: 拾取/发现物品，标记为已发现，触发 LLM 生成发现旁白，加入背包并持久化。幂等——已发现的物品直接返回。

**Request**

```json
{
  "item_id": "item_child_costume"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `item_id` | string | 是 | 物品 ID |

**Response** `200 OK` — 新发现

```json
{
  "item_id": "item_child_costume",
  "already_discovered": false,
  "item": {
    "id": "item_child_costume",
    "name": "小孩戏服",
    "base_description": "一件褪色的京剧童装...",
    "is_discovered": true,
    "holdable": true,
    ...
  },
  "discovery_narration": "你拾起那件褪色的戏服，袖口已经磨损，但绣在上面的金线龙纹依然清晰可见。三十年前的梨园盛景，仿佛还在这件衣衫上残留着余温。"
}
```

**Response** `200 OK` — 已发现（幂等）

```json
{
  "item_id": "item_child_costume",
  "already_discovered": true,
  "item": { ... }
}
```

> `discovery_narration` 由 LLM 根据物品定义 + 当前游戏上下文生成。生成失败时兜底为 `"你发现了「物品名」。"`。

### 3.12 存档列表 — `GET /api/sessions`

**Response** `200 OK`

```json
{
  "sessions": [
    {
      "session_id": "sess_a1b2c3d4",
      "player_name": "玩家",
      "stage": 2,
      "stage_name": "闻声·异样",
      "game_ended": false,
      "created_at": "2026-05-25 14:00:00",
      "updated_at": "2026-05-25 14:30:00"
    }
  ],
  "total": 1
}
```

### 3.13 删除存档 — `DELETE /api/game/{session_id}`

**Response** `200 OK`

```json
{ "success": true, "message": "已删除会话: sess_a1b2c3d4" }
```

### 3.14 对话历史 — `GET /api/game/{session_id}/dialogues`

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
      "options": ["陈师傅好", "默默站在一旁"],
      "stage": 1, "created_at": "2026-05-25 14:01:00"
    }
  ],
  "total": 25, "page": 1, "page_size": 20
}
```

### 3.15 关系值历史 — `GET /api/game/{session_id}/relationships`

```
GET /api/game/sess_a1b2c3d4/relationships?npc_id=npc_chen
```

**Response** `200 OK`

```json
{
  "session_id": "sess_a1b2c3d4",
  "npc_id": "npc_chen",
  "logs": [
    { "id": 1, "npc_id": "npc_chen", "delta": 5, "reason": "对话加成", "relationship_after": 25, "created_at": "2026-05-25 14:00:00" }
  ],
  "current_relationships": { "npc_chen": 25, "npc_xiaohua": 10 },
  "total": 1
}
```

### 3.16 事件时间线 — `GET /api/game/{session_id}/events`

**Response** `200 OK`

```json
{
  "session_id": "sess_a1b2c3d4",
  "events": [
    { "id": 1, "event_id": "first_enter_tavern", "triggered_by": "system", "stage": 1, "created_at": "2026-05-25 14:00:00" }
  ],
  "total": 1
}
```

### 3.17 NPC 位置上报 — `POST /api/game/{session_id}/npc/position`

**职责**: 前端在 NPC 移动动画完成后上报新位置，后端持久化以保证一致性。

**Request**

```json
{
  "npc_id": "npc_chen",
  "position": { "col": 48, "row": 24 }
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `npc_id` | string | 是 | NPC ID |
| `position.col` | int | 是 | 新的列号 |
| `position.row` | int | 是 | 新的行号 |

**Response** `200 OK`

```json
{
  "success": true,
  "npc_id": "npc_chen",
  "position": { "col": 48, "row": 24 }
}
```

> **注意**: 后端应校验 `0 <= col < MAP_COLS` 且 `0 <= row < MAP_ROWS`。碰撞检测由前端处理，后端不参与。

### 3.18 批量 NPC 位置同步 — `POST /api/game/{session_id}/npc/positions/batch`

**职责**: 场景切换或存档时将全部 NPC 位置一次上报，避免多次请求。

**Request**

```json
{
  "scene": "town",
  "trigger": "subscene_enter",
  "positions": [
    { "npc_id": "npc_chen",    "position": { "col": 45, "row": 18 } },
    { "npc_id": "npc_meiyi",   "position": { "col": 40, "row": 13 } },
    { "npc_id": "npc_xiaohua", "position": { "col": 12, "row": 11 } },
    { "npc_id": "town_001",    "position": { "col": 32, "row": 42 }, "scene": "market" }
  ]
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `scene` | string | 否 | 当前场景标识 |
| `trigger` | string | 否 | 触发原因: `subscene_enter` / `subscene_exit` / `save` |
| `positions[].npc_id` | string | 是 | NPC ID |
| `positions[].position` | object | 是 | 瓦片坐标 `{col, row}` |
| `positions[].scene` | string | 否 | 更新 NPC 所在场景 |

**Response** `200 OK`

```json
{
  "success": true,
  "updated_count": 4,
  "errors": null,
  "scene": "town",
  "trigger": "subscene_enter"
}
```

> `errors` 字段为非空数组时，列出未能更新的 NPC 及原因（坐标越界 / NPC 不存在）。

### 3.19 运行时生成临时 NPC — `POST /api/game/{session_id}/npc/spawn`

**职责**: 在游戏进行中动态生成临时 NPC（如剧情触发的过路客），不持久化到 YAML 数据源。

**Request**

```json
{
  "name": "神秘过客",
  "sprite": "traveler_m",
  "position": { "col": 50, "row": 35 },
  "scene": "town",
  "is_temporary": true,
  "greeting": "这位先生请留步……",
  "role": "过路人",
  "movement_enabled": true,
  "movement_speed": 25,
  "idle_range": [3, 8],
  "wander_range": [4, 12]
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | string | 是 | NPC 显示名称 |
| `sprite` | string | 否 | 精灵图 key |
| `position` | object | 是 | 瓦片坐标 |
| `scene` | string | 否 | 所在场景，默认 "town" |
| `is_temporary` | bool | 否 | 标记为临时 NPC，默认 true |
| `greeting` | string | 否 | 初始问候语 |
| `role` | string | 否 | 角色描述 |
| `movement_enabled` | bool | 否 | 是否启用自由移动 |
| `movement_speed` | int | 否 | 移动速度（秒/步） |
| `idle_range` | int[] | 否 | 原地待机时间范围 [min, max] |
| `wander_range` | int[] | 否 | 漫游间隔范围 [min, max] |

**Response** `201 Created`

```json
{
  "success": true,
  "npc_id": "npc_temp_a1b2c3",
  "name": "神秘过客",
  "position": { "col": 50, "row": 35 },
  "scene": "town",
  "is_temporary": true
}
```

> `npc_id` 由后端自动生成（`npc_temp_` 前缀），前端需记录此 ID 用于后续交互。

### 3.20 查询普通 NPC 列表 — `GET /api/scripts/{script_id}/town-npcs`

**职责**: 获取指定剧本中所有普通 NPC（路人/商贩等非剧情关键角色）的配置列表。

**Response** `200 OK`

```json
{
  "script_id": "liyuan_shengsi",
  "town_npcs": [
    {
      "id": "town_001",
      "name": "卖菜大婶",
      "sprite": "vendor_f",
      "position": { "col": 30, "row": 40 },
      "scene": "town",
      "greeting": "新鲜的青菜嘞——",
      "role": "菜贩",
      "movement": {
        "enabled": true,
        "speed": 30,
        "idle_range": [3, 8],
        "wander_range": [4, 12]
      }
    }
  ],
  "total": 1
}
```

### 3.21 批量创建/覆盖普通 NPC — `POST /api/scripts/{script_id}/town-npcs`

**职责**: 地图编辑器/开发阶段批量创建普通 NPC，写入 `meta.yaml` 的 `town_npcs` 列表（**全量覆盖**）。

**Request**

```json
{
  "town_npcs": [
    {
      "name": "卖菜大婶",
      "sprite": "vendor_f",
      "position": { "col": 30, "row": 40 },
      "scene": "town",
      "greeting": "新鲜的青菜嘞——",
      "role": "菜贩",
      "movement_enabled": true,
      "movement_speed": 30,
      "idle_range": [3, 8],
      "wander_range": [4, 12]
    }
  ]
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `town_npcs[].name` | string | 是 | NPC 名称 |
| `town_npcs[].sprite` | string | 否 | 精灵图 key |
| `town_npcs[].position` | object | 是 | 瓦片坐标 |
| `town_npcs[].scene` | string | 否 | 所在场景 |
| `town_npcs[].greeting` | string | 否 | 问候语 |

**Response** `201 Created`

```json
{
  "success": true,
  "created": [{ "id": "town_001", "name": "卖菜大婶", ... }],
  "total": 1
}
```

> **注意**: 此接口**全量替换**已有的 `town_npcs` 列表。如需增量添加，前端需先 GET 获取当前列表，合并后再 POST。

### 3.22 删除普通 NPC — `DELETE /api/scripts/{script_id}/town-npcs/{npc_id}`

**Response** `200 OK`

```json
{ "success": true, "message": "已删除普通 NPC: town_001" }
```

### 3.23 更新普通 NPC — `PUT /api/scripts/{script_id}/town-npcs/{npc_id}`

**职责**: 部分更新普通 NPC 配置，只传需要修改的字段。

**Request**（所有字段可选）

```json
{
  "name": "卖菜大妈",
  "position": { "col": 32, "row": 41 },
  "movement_enabled": false
}
```

**Response** `200 OK`

```json
{
  "success": true,
  "npc": {
    "id": "town_001",
    "name": "卖菜大妈",
    "position": { "col": 32, "row": 41 },
    ...
  }
}
```

---

## 四、完整调用时序（v2 章节驱动）

```
前端 (Phaser 3)                              后端 (FastAPI)
    │                                              │
    │  [选择剧本 + 新游戏]                            │
    │──── POST /api/game/start ──────────────────→│
    │←──── 201 { session_id, npcs[],              │
    │           current_chapter: null } ──────────│
    │                                              │
    │  [开始第一章]                                   │
    │──── POST /api/game/{id}/chapter/start ───→│
    │←──── 200 { chapter_id, task{sub_tasks[]} } │← LLM 任务规划
    │                                              │
    │  [接近 NPC → 按 F]                             │
    │──── POST /api/dialogue ──────────────────→│ player_message=null
    │←──── SSE: delta → done { options[] } ──────│
    │                                              │
    │  [点选选项 / 自由输入]                            │
    │──── POST /api/dialogue ──────────────────→│ player_message="..."
    │←──── SSE: done { chapter_completed: false } │
    │                                              │
    │  [向NPC展示物品]                                │
    │──── POST /api/dialogue/show-item ─────────→│
    │←──── SSE: delta → done { shown_item } ────│
    │                                              │
    │  ...多轮对话/物品交互...                         │
    │                                              │
    │──── POST /api/dialogue ──────────────────→│
    │←──── SSE: done { chapter_completed: true } │← 自动 advance
    │                                              │
    │  [开始下一章]                                   │
    │──── POST /api/game/{id}/chapter/start ───→│
    │←──── 200 { next_chapter, new_task } ──────│← LLM 规划下一章
    │                                              │
    │  ...循环...                                    │
    │                                              │
    │  [所有章节完成 → game_ended=true]                │
    │──── POST /api/game/{id}/evaluate ────────→│
    │←──── 200 { type, title, summary } ─────────│
```

---

## 五、核心数据模型

### 子任务模式 (SubTaskMode)

| 模式 | 说明 | 完成判定 |
|------|------|---------|
| `dialogue` | 与 NPC 对话 | NPC 投票确认 |
| `explore` | 探索场景 | NPC 投票 / 事件触发 |
| `acquire_item` | 获取物品 | 物品在背包中 |
| `show_item` | 展示物品 | 物品在背包中 + NPC 确认 |
| `deliver` | 递交物品 | 物品在背包中 |
| `relation` | 关系值达标 | NPC relationship >= threshold |

### 子任务状态 (SubTaskStatus)

| 状态 | 说明 |
|------|------|
| `locked` | 锁定（前置子任务未完成） |
| `active` | 可执行 |
| `in_progress` | 进行中 |
| `completed` | 已完成 |

### 章节类型

| 类型 | 说明 |
|------|------|
| `cinematic` | 过场动画（自动跳过，无任务规划） |
| `task` | 正式章节（LLM 生成子任务） |

---

## 六、MVP 与完整版的边界

| 维度 | v2.0（本文档范围） | 后续版本 |
|------|-------------------|----------|
| API 数量 | **24 个** | 扩展至 26+ 个 |
| 章节系统 | 6 章线性推进 | 分支章节 + 多结局 |
| 任务规划 | LLM 逐章规划 | 动态任务调整 + 失败回退 |
| NPC 共识 | 投票机制 | NPC 主动行为 + 反目 |
| 物品系统 | 发现 + 展示 | 合成 + 使用 + 装备 |
| 结局 | 1 个主结局 | 4+ 个结局分支 |

---

## 附录：Mock 数据清单

| 文件 | 对应接口 |
|------|---------|
| `frontend/src/api/client.js` | 所有接口（`USE_MOCK=true` 时使用内联 Mock） |
| `mock/dialogue_sse.txt` | `POST /api/dialogue` |
| `mock/evaluate.json` | `POST /api/game/{id}/evaluate` |

> **注意**: Mock 数据仅用于开发降级，坐标格式已统一为 `{col, row}` 瓦片坐标。数据权威来源为 `data/scripts/liyuan_shengsi/`。
