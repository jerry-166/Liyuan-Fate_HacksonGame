# Mock 测试数据索引

> 基于 `docs/API设计文档-MVP.md` 生成，覆盖正常、边界及异常场景。  
> 前端 A 可直接 import JSON 文件或 fetch `.txt` 来模拟 SSE 流，无需等待后端开发。

---

## 目录结构

```
mock/
├── README.md                  ← 本文件
├── game/                      ← 游戏状态类 API 的 Mock
│   ├── start_201.json              POST /api/game/start → 正常创建新游戏
│   ├── game_state_stage1.json      GET  /api/game/{id}  → 阶段一"不屑"
│   ├── game_state_stage2.json      GET  /api/game/{id}  → 阶段二"了解"
│   ├── game_state_stage3_pre_ending.json  GET /api/game/{id} → 阶段三，已触发结局但未评价
│   ├── game_state_stage3_ended.json       GET /api/game/{id} → 阶段三，结局评价已完成
│   └── game_state_404.json         GET  /api/game/{id}  → 会话不存在
├── dialogue/                  ← 对话 API 的 SSE 流 Mock
│   ├── first_turn_chen.txt         POST /api/dialogue → 首轮对话（陈师傅）
│   ├── first_turn_xiaohua.txt      POST /api/dialogue → 首轮对话（小华）
│   ├── continue_normal.txt         POST /api/dialogue → 续接对话（正常）
│   ├── stage_change.txt            POST /api/dialogue → 触发阶段变化
│   ├── ending_trigger.txt          POST /api/dialogue → 触发结局
│   ├── no_options.txt              POST /api/dialogue → 对话结束（无选项）
│   └── error_llm_failure.txt       POST /api/dialogue → LLM 调用失败
├── evaluate/                  ← 结局评价 API 的 Mock
│   ├── accept_leader.json          POST /api/game/{id}/evaluate → 接受戏班（接手传承）
│   └── give_up.json                POST /api/game/{id}/evaluate → 放弃戏班（遗憾离去）
└── errors/                    ← 通用错误响应
    └── error_codes.json            所有错误码的标准响应
```

---

## 场景覆盖矩阵

### 正常场景

| 场景 | 文件 | 关键特征 |
|------|------|----------|
| 创建新游戏 | `game/start_201.json` | session_id 生成、阶段一初始化、2 个 NPC 含 greeting |
| 阶段一状态 | `game/game_state_stage1.json` | cold 色调、negative 关系萌芽 |
| 首轮对话-陈师傅 | `dialogue/first_turn_chen.txt` | player_message=null → NPC 开场白 + 3 个选项 |
| 首轮对话-小华 | `dialogue/first_turn_xiaohua.txt` | 带敌意的语气、负向 relationship_change |
| 续接对话 | `dialogue/continue_normal.txt` | 正常 6 个 chunk → done 带 3 个选项 + 触发事件 |
| 阶段变化 | `dialogue/stage_change.txt` | stage_changed=true、携带完整 new_stage 参数 |
| 阶段二状态 | `game/game_state_stage2.json` | warm 色调、关系值提升、问候语变化 |
| 结局触发 | `dialogue/ending_trigger.txt` | ending_triggered=true、options=null |
| 结局前置状态 | `game/game_state_stage3_pre_ending.json` | game_ended=true、ending=null（等待 evaluate） |
| 结局评价-接受 | `evaluate/accept_leader.json` | 完整 key_moments + life_lesson + npc_endings |
| 结局评价-放弃 | `evaluate/give_up.json` | 另一个结局方向的完整评价 |
| 完成状态 | `game/game_state_stage3_ended.json` | game_ended=true、ending 已填充、NPC 不可交互 |

### 边界场景

| 场景 | 文件 | 关键特征 |
|------|------|----------|
| 对话结束无选项 | `dialogue/no_options.txt` | options=null、relationship_change 为空对象 |
| 零选项对话 | `dialogue/no_options.txt` | NPC 主动结束对话，玩家需移动离开再回来 |

### 异常场景

| 错误码 | 文件 | 说明 |
|--------|------|------|
| `SESSION_NOT_FOUND` | `game/game_state_404.json` | 无效 session_id |
| `LLM_ERROR` | `dialogue/error_llm_failure.txt` | SSE error 事件，AI 生成失败 |
| 全部 7 种错误码 | `errors/error_codes.json` | 统一错误响应参考 |

---

## 使用方式

### 前端 A：在 Phaser 中使用 Mock

```javascript
// 方式一：直接 fetch 模拟真实请求
async function mockStartGame() {
  // 开发时改用本地 mock 文件
  const res = await fetch('/mock/game/start_201.json');
  return res.json();
}

// 方式二：静态 import（适合 vite/webpack 项目）
import startGameMock from '@/mock/game/start_201.json';
// 直接使用
this.initGame(startGameMock);
```

### 模拟 SSE 流

```javascript
async function mockDialogueSSE(filePath) {
  const text = await (await fetch(filePath)).text();
  const lines = text.split('\n');
  let eventType = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith('event: ')) {
      eventType = line.slice(7).trim();
    } else if (line.startsWith('data: ')) {
      const data = JSON.parse(line.slice(6));

      if (eventType === 'delta') {
        // 模拟逐字延迟
        await sleep(60);
        dialogBox.appendText(data.chunk);
      } else if (eventType === 'done') {
        handleDone(data);
      } else if (eventType === 'error') {
        handleError(data);
      }
    }
  }
}

// 用法
mockDialogueSSE('/mock/dialogue/first_turn_chen.txt');
```

### 后端 B：FastAPI Mock 模式

```python
# 开发阶段快速切换 mock/real
import json
from pathlib import Path

MOCK_DIR = Path(__file__).parent.parent / "mock"

@app.post("/api/game/start")
async def game_start(request: GameStartRequest):
    if USE_MOCK:
        with open(MOCK_DIR / "game" / "start_201.json") as f:
            return JSONResponse(json.load(f), status_code=201)
    # ... real implementation
```

---

## 数据常量约定

| 常量 | 值 | 说明 |
|------|-----|------|
| Mock session_id | `sess_mock_001` | 所有正常 mock 共用此 ID |
| NPC ID | `npc_chen` / `npc_xiaohua` | 与文档保持一致 |
| 关系值范围 | -100 ~ 100 | 0=中性，负值=敌意，正值=友善 |
| 阶段数 | 1, 2, 3 | 不屑 / 了解 / 抉择 |
| color_tone | `cold` / `warm` / `dramatic` | 对应三个阶段 |
| SSE 事件类型 | `delta` / `done` / `error` | 三种标准事件 |

---

## 更新日志

| 日期 | 变更 |
|------|------|
| 2026-05-22 | 初始创建：6 个游戏状态 + 7 个对话 SSE + 2 个结局评价 + 1 个错误合集 |
