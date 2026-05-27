# SSE 通信格式（单一真相源）

> 所有文档引用本文件获取 SSE 事件类型和数据格式。

## 基础信息

对话接口 `POST /api/dialogue` 使用 Server-Sent Events 流式响应，`Content-Type: text/event-stream`。

前端使用 `fetch` + `ReadableStream`（而非 `EventSource`），因为需要 `POST` 方法传递 `player_message`。

## 事件类型

### 1. `delta` — 逐 token 推送

```
event: delta
data: {"chunk": "戏班啊……"}

event: delta
data: {"chunk": "三十年前，这镇上的戏台可是夜夜满座。"}
```

### 2. `done` — 流结束，携带元数据

```
event: done
data: {
  "full_text": "完整回复文本……",
  "relationship_change": {"npc_chen": 5},
  "options": ["后来发生了什么？", "我父亲也会唱戏？", "那现在为什么变成这样了……"],
  "chapter_completed": false,
  "game_ended": false,
  "events_triggered": [],
  "current_chapter": {
    "chapter_id": "ch_01",
    "chapter_name": "闻声·异样"
  }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `full_text` | string | 完整回复文本（去掉了 SSE chunk 拼接的麻烦） |
| `relationship_change` | object | 各 NPC 关系值变化量 |
| `options` | array \| null | AI 生成的下一轮选项；空数组或 null 表示对话结束 |
| `chapter_completed` | boolean | 是否完成当前章节（后端已自动推进至下一章） |
| `game_ended` | boolean | 是否触发游戏结局 |
| `events_triggered` | string[] | 本次对话触发的新事件ID列表 |
| `current_chapter` | object \| null | 当前章节信息 `{chapter_id, chapter_name}` |

> **兼容说明**: 前端同时支持旧格式的 `stage_changed`/`new_stage`/`ending_triggered` 字段作为 fallback。

### 3. `error` — 异常

```
event: error
data: {"code": "LLM_ERROR", "message": "AI 生成超时，请重试"}
```

## 完整 SSE 流示例

```
event: delta
data: {"chunk": "你父亲……"}

event: delta
data: {"chunk": "他是个真正的角儿。"}

event: delta
data: {"chunk": "可惜啊，这世道变了。"}

event: done
data: {"full_text": "你父亲……他是个真正的角儿。可惜啊，这世道变了。", "relationship_change": {"npc_chen": 5}, "options": ["后来发生了什么？", "我父亲也会唱戏？", "那现在为什么变成这样了……"], "chapter_completed": false, "game_ended": false, "events_triggered": [], "current_chapter": {"chapter_id": "ch_01", "chapter_name": "闻声·异样"}}
```
