# 🧠 人 B — AI 架构师

> **核心原则**：你只管后端 + Agent 系统这条线，交叉点找 CodeBuddy 补位。

## 你的活

| # | 工作内容 | 技术栈/工具 |
|---|---------|------------|
| ① | 多 Agent NPC 架构设计（每个 NPC 是一个 Agent 实例） | Python |
| ② | LLM API 对接（对话生成 + 流式输出） | 腾讯云 LLM API |
| ③ | 全局状态管理器（阶段判定、关系值、触发器） | 自建状态机 |
| ④ | 对话存储 + 关键节点摘要 | SQLite |
| ⑤ | 结局评价生成 Prompt | Prompt Engineering |
| ⑥ | 前后端 API 接口设计 + 实现 | FastAPI |

---

## 需要和 A 沟通的事（前端）

| 事项 | 说明 |
|------|------|
| API 接口文档 | Day 1 一起敲定四个核心接口的契约，这是双方的生命线（MVP版完成） |
| Mock 数据 | 你先给 A 一套静态 JSON 响应示例，他不用等你写完就能开工（完成） |
| 流式输出方案 | 确认前端能接什么格式的 streaming，你按那个实现 |
| 联调 | 真实 API 上线后和 A 一起把对话链路跑通 |

## 需要和 C 沟通的事（内容）

| 事项 | 说明 |
|------|------|
| NPC 人设卡 | C 给你每个人设卡 → 你写入 Agent 的 system prompt (未完成、先使用mock数据)|
| 阶段切换条件 | C 告诉你什么剧情节点应该推进游戏阶段 → 你实现触发器 |
| 对话风格参考 | C 给每个 NPC 的典型台词示例 → 你放到 few-shot prompt 里 |
| 结局类型 | C 定义有几种结局和触发条件 → 你实现判定逻辑 |

---

## 架构决策记录（ADR）

> 以下为 MVP 后端开发前的关键技术选型，已确认。

### 1. 后端框架：FastAPI ✅

| 对比维度 | FastAPI | Flask | Django |
|---------|---------|-------|--------|
| 异步支持 | 原生 async/await | 需扩展 | 需 ASGI 适配 |
| SSE 流式 | 原生 StreamingResponse | 需手动处理 | 需 Channels |
| 数据校验 | Pydantic 内置 | 需手动 | DRF Serializer |
| WebSocket | 原生支持 | 需 flask-sock | 需 Channels |

**结论**：FastAPI，理由——SSE 流式对话是核心链路，async + Pydantic 校验完美匹配。

### 2. Agent 实现框架：自实现（纯 Python） ✅

| 方案 | 优点 | 缺点 |
|------|------|------|
| **自实现** ✅ | 完全控制流式输出、零依赖、MVP 极简 | 后续扩展需手动加 |
| LangChain | 生态丰富、Chain/Agent 抽象 | 流式控制弱、抽象层太重、调试困难 |
| CrewAI | 多 Agent 协作原生支持 | MVP 只有 2 个 NPC，杀鸡用牛刀 |

**结论**：自实现。MVP 只需 2 个 NPC Agent，自实现能精确控制 SSE 流式输出的每一个 token，且代码量极小。

### 3. LLM API 调用方式：httpx + OpenAI 兼容接口 ✅

```
腾讯云 LLM (混元/DeepSeek) → OpenAI 兼容 HTTP API → httpx 异步调用 → SSE 流式解析
```

| 方案 | 优点 | 缺点 |
|------|------|------|
| **httpx** ✅ | 异步、流式原生支持、轻量 | 需手写重试逻辑 |
| openai 官方 SDK | 开箱即用 | 与腾讯云兼容性不确定 |
| requests | 简单 | 同步阻塞，不适合 SSE |

**结论**：`httpx` 异步流式调用，`response.aiter_lines()` 逐行解析 SSE。

### 4. 全局状态管理器：Session 级状态机 + 内存 dict + SQLite 持久化 ✅

```
GameSession (内存)
├── session_id
├── player_name
├── api_key (内存仅存，不持久化)
├── current_stage: Stage enum
├── npcs: dict[npc_id → NPCState]
├── events_triggered: set[str]
├── game_ended: bool
├── ending_type: str | None
├── stage_llm_consecutive: int          # LLM 连续判定推进的轮数（≥2 才切换）
└── last_active_at: float               # TTL 淘汰依据

NPCState
├── id, name, role, scene, position
├── relationship: int (-100~100)
├── dialogue_history: list[DialogueTurn]  ← 最近 N 轮
├── is_available: bool
└── current_greeting: str
```

**持久化策略**：
- **热数据**（当前会话状态）→ 内存 dict，读写 O(1)
- **冷数据**（对话历史、事件日志）→ SQLite，按 session 查询
- **恢复**：session_id 存前端 localStorage，刷新页面时从 SQLite 重建内存状态

**Session 生命周期管理**：
- **Lazy loading**：启动时不主动加载所有 session；请求时未命中内存 → 从 SQLite 重建
- **TTL 淘汰**：会话超过 2 小时未活跃 → 从内存移除（SQLite 保留完整数据）
- **健康监控**：`GET /api/health` 端点返回 `{"active_sessions": N}`

### 5. API Key 管理策略

```
优先级：
  1. 用户前端输入 → 内存存储（当前 session 有效）
  2. 环境变量 TENCENT_LLM_API_KEY（fallback）
  3. 无 Key → 返回错误提示用户输入
```

- API Key **仅存内存**，不写入 SQLite/日志
- 每个 session 独立 key，session 销毁即清除

---

## 你的 MVP

> 后端能收对话请求 → 调 LLM 生成 NPC 回复 → 流式返回给前端

做 2 个 NPC Agent（1.便于测试Agent的剧情交接handsoff，eg.NPC A：找NPC B，NPC B: A让你来找我的吗？... 2.便于多轮对话个性测试）+ 顶层设计(世界观、剧情、当前状态等等状态图) + API 文档接口实现

### MVP 后端项目结构

```
backend/
├── main.py                    # FastAPI 入口 + 路由注册
├── config.py                  # 配置管理（环境变量、LLM 参数）
├── llm/
│   └── client.py              # httpx 流式 LLM 调用 + Session 级 API Key
├── agents/
│   ├── npc_agent.py           # NPC Agent 核心逻辑（对话生成 + 选项生成）
│   ├── prompt_builder.py      # Prompt 拼装（世界观 + 事件 + 阶段 + 人设注入）
│   ├── response_parser.py     # LLM 响应解析（提取 options/stage_change/events）
│   └── personas/
│       ├── chen_shifu.yaml    # 陈师傅人设卡
│       └── xiaohua.yaml       # 小华人设卡
├── state/
│   ├── manager.py             # 会话状态管理器（内存 dict）
│   ├── session.py             # GameSession / NPCState 数据类
│   ├── stage_engine.py        # 双模阶段切换（规则 + LLM 判定）
│   └── summarizer.py          # 对话摘要（占位，MVP 后启用）
├── storage/
│   ├── database.py            # SQLite 操作封装
│   └── schema.sql             # 建表语句
├── routes/
│   ├── game.py                # /api/game/start, /api/game/{id}, /api/game/{id}/evaluate
│   └── dialogue.py            # POST /api/dialogue（SSE 流式）
└── prompts/
    ├── system_base.txt        # 世界观 + 全局状态 System Prompt 模板
    └── evaluate.txt           # 结局评价 Prompt 模板
```

### MVP 功能取舍表

| 功能 | MVP 决策 | 理由 |
|------|---------|------|
| 2 个 NPC Agent | ✅ 纳入 | 测试 handoff + 多轮个性差异 |
| Handoff 事件系统 | ✅ 纳入 | Prompt 注入共享事件，实现成本极低 |
| Session 级 API Key | ✅ 纳入 | 零后端 LLM 成本 |
| 双模阶段切换 | ✅ 纳入 | 规则+LLM 判定嵌入同一 LLM 调用，零额外延迟 |
| NPC 自动生成对话/选项 | ✅ 纳入 | Prompt 中注入世界观+人设，LLM 自行生成 |
| 对话摘要（Summary） | 🟡 延后（schema 预留） | MVP 对话轮数 < 20，上下文窗口够用 |
| NPC 主动对话/工具调用 | ❌ 排除 | 需 WebSocket + 行为树，MVP 太重 |
| NPC 后端驱动行走 | ❌ 排除 | 前端 Phaser 3 固定巡逻路径；后端仅提供 scene/position |
| 自由文字输入 | ❌ 排除 | MVP 使用 AI 生成选项，玩家点选 |
| 多结局分支 | ❌ 排除 | MVP 只需 1 个结局验证流程 |
| 用户认证 | ❌ 排除 | session_id 即身份标识 |

### NPC Handoff 机制

```
事件驱动 → 共享事件集合 → Prompt 注入

示例流程：
  玩家对陈师傅说"我想学戏"
  → 陈师傅回复"去找小华，他欠我个人情"
  → LLM 响应中触发事件: "chen_sent_to_xiaohua"
  → 事件写入 session.events_triggered
  
  玩家走到小华处，按 F 对话
  → prompt_builder 检测到 "chen_sent_to_xiaohua" ∈ events
  → 注入 prompt: "[跨NPC事件] 陈师傅让玩家来找你"
  → 小华回复: "陈师傅让你来找我的？他居然还记着这事……"
```

### 双模阶段切换逻辑

```
每轮对话完成后（SSE done 事件时）：

1. 规则检测（O(1) 内存查表）— 确定性护栏，命中立即切换：
   - 任意 NPC relationship >= 50 → 立即切换
   - 触发关键事件 → 立即切换

2. LLM 独立判定（拆分为独立轻量调用，非嵌入对话 prompt）：
   - 独立 Prompt："当前阶段{stage}，关系值{rel}，已触发事件{evts}，最近对话摘要。是否可推进？"
   - 输出：{should_advance: bool, reason: str}
   - 需连续 2 轮判定一致才执行切换（防幻觉）

3. 加权合并：
   if 规则命中:
       立即执行阶段切换
   elif LLM 连续 2 轮判定推进:
       执行阶段切换
   else:
       不切换（LLM 判定计数中断则清零）
```

### 关系值 Clamp 机制

```
每轮对话结束时：
1. LLM 返回 relationship_delta（建议值）→ clamp 到 [-5, +10]
2. LLM 解析失败 → 规则兜底：每轮固定 +3
3. 触发关键事件 → 额外 +5~+10（由事件定义表指定）
4. 累加到 NPC.relationship，最终 clamp 到 [-100, 100]
```

### response_parser 降级策略

```
LLM 输出格式不可控时，必须保证对话链路不断：
- options 解析失败 → 返回空选项列表
- events 解析失败 → 跳过事件触发
- relationship_delta 解析失败 → 默认 0（配合规则兜底增量）
- dialogue_text 提取失败 → 使用 LLM 原始输出全文
```

### 开发优先级

| 优先级 | 模块 | 说明 |
|--------|------|------|
| P0 | `routes/dialogue.py` + `llm/client.py` | 核心链路：收消息→调LLM→SSE返回 |
| P0 | `state/session.py` + `state/manager.py` | 会话状态是一切的基础 |
| P1 | `agents/npc_agent.py` + `prompt_builder.py` | NPC 人设加载 + Prompt 拼装 |
| P1 | `routes/game.py` | 游戏开始 + 状态查询 |
| P2 | `state/stage_engine.py` | 阶段切换判定 |
| P2 | `storage/database.py` | SQLite 持久化 |
| P3 | `agents/response_parser.py` | LLM 响应结构化解析 |
| P3 | `routes/game.py` (evaluate) | 结局评价生成
