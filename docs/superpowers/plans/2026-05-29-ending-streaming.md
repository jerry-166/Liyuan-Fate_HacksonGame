# 结局流式渐进生成 + 赛后回看 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将结局生成从单次非流式 LLM 调用改为 2 级并行 + SSE 流式输出，前端逐条渐进渲染；主菜单支持已结局存档回看。

**Architecture:** 后端新增 SSE 端点拆解结局生成为 header 生成 + 5 个并行 NPC 结局生成；前端 EndingScreen 流式消费 SSE 事件逐条渲染；MenuScene 存档行加「查看结局」按钮调用只读缓存端点。

**Tech Stack:** Python/FastAPI/SSE — Phaser 3/JavaScript/fetch ReadableStream

---

## 文件结构

| 文件 | 职责 |
|------|------|
| `backend/prompts/evaluate_header.txt` | **新建** — 结局标题/总结/感悟 prompt |
| `backend/prompts/evaluate_npc.txt` | **新建** — 单 NPC 结局 prompt |
| `backend/agents/prompt_builder.py` | **修改** — 新增 2 个 build 方法 |
| `backend/routes/game.py` | **修改** — 新增 SSE + 只读端点 |
| `frontend/src/api/client.js` | **修改** — 新增 evaluateEndingStream / getEnding |
| `frontend/src/scenes/modules/EndingScreen.js` | **修改** — 流式 trigger + 静态 showStatic + 布局 |
| `frontend/src/scenes/MenuScene.js` | **修改** — 查看结局按钮 + 弹窗 |

---

### Task 1: 创建 evaluate_header.txt prompt

**Files:**
- Create: `backend/prompts/evaluate_header.txt`

- [ ] **Step 1: 写入 header prompt 文件**

```text
# 结局标题与总结 Prompt 模板

你是一位叙事评论家，请为《梨园生死》的这位玩家生成结局的标题和总结部分。

## 游戏数据
- 玩家名称：{player_name}
- 最终阶段：第 {current_stage} 阶段「{stage_name}」
- 触发结局类型：{ending_type}
- 各 NPC 最终关系值：{npc_relationships}
- 关键事件：{key_events}
- 对话历史摘要：{dialogue_summary}

## 要求
请以 JSON 格式输出，只包含以下字段：

{{
  "type": "{ending_type}",
  "title": "结局标题（4-8字，有诗意）",
  "summary": "结局概述（80-120字，描述玩家的选择带来的结果）",
  "key_moments": [
    {{"stage": 1, "description": "阶段一的关键瞬间（15-25字）"}},
    {{"stage": 2, "description": "阶段二的关键瞬间（15-25字）"}},
    {{"stage": 3, "description": "阶段三的关键瞬间（15-25字）"}}
  ],
  "life_lesson": "人生感悟（一句有哲理的话，10-25字）"
}}

请确保输出是合法的 JSON，不要包含 markdown 代码块标记。
```

- [ ] **Step 2: 提交**

```bash
git add backend/prompts/evaluate_header.txt
git commit -m "feat: 添加结局 header prompt 模板"
```

---

### Task 2: 创建 evaluate_npc.txt prompt

**Files:**
- Create: `backend/prompts/evaluate_npc.txt`

- [ ] **Step 1: 写入 NPC 结局 prompt 文件**

```text
# 单 NPC 结局 Prompt 模板

你是一位叙事评论家，请为《梨园生死》中的一位 NPC 生成结局描述。

## NPC 信息
- 名称：{npc_name}
- 身份：{npc_role}
- 最终关系值：{final_relationship}（范围 -100 ~ 100）
- 最近对话片段：{dialogue_sample}

## 玩家信息
- 玩家名称：{player_name}
- 结局类型：{ending_type}

## 要求
请以 JSON 格式输出：

{{
  "npc_id": "{npc_id}",
  "summary": "该 NPC 的结局描述（25-40字，基于关系值反映亲疏冷暖）"
}}

注意：
- 关系值 > 60：偏温暖/感激/传承
- 关系值 0~60：偏中性/平淡
- 关系值 < 0：偏疏离/遗憾/冷淡
请确保输出是合法的 JSON，不要包含 markdown 代码块标记。
```

- [ ] **Step 2: 提交**

```bash
git add backend/prompts/evaluate_npc.txt
git commit -m "feat: 添加单 NPC 结局 prompt 模板"
```

---

### Task 3: 新增 prompt_builder 方法

**Files:**
- Modify: `backend/agents/prompt_builder.py`

- [ ] **Step 1: 在 `build_evaluate_messages` 方法后面添加两个新方法**

在 `build_evaluate_messages` 方法（约第 372 行，return 语句后）之后添加：

```python
    # ─── 结局 Header Prompt ─────────────────────────

    def build_evaluate_header_messages(self, session: GameSession) -> list[dict]:
        header_path = os.path.join(_PROMPTS_DIR, "evaluate_header.txt")
        if os.path.exists(header_path):
            with open(header_path, "r", encoding="utf-8") as f:
                template = f.read()
        else:
            template = "请生成结局标题和总结 JSON。"

        chapter = session.get_current_chapter()
        stage_name = chapter.get("name", "未知") if chapter else str(session.current_stage)

        npc_relationships = ", ".join(
            f"{n.name}({n.id})={n.relationship}" for n in session.npcs.values()
        )
        dialogue_summary = ""
        for npc in session.npcs.values():
            if npc.dialogue_history:
                for turn in npc.dialogue_history[-2:]:
                    role = "玩家" if turn.role == "player" else npc.name
                    dialogue_summary += f"{role}：{turn.content[:60]}\n"

        prompt = template.format(
            player_name=session.player_name,
            current_stage=session.current_stage,
            stage_name=stage_name,
            ending_type=session.ending_type or "default_ending",
            npc_relationships=npc_relationships,
            key_events=", ".join(sorted(session.events_triggered)) if session.events_triggered else "无",
            dialogue_summary=dialogue_summary or "（尚无对话）",
        )
        return [
            {"role": "system", "content": "你是叙事评论家，生成结局标题和总结 JSON。"},
            {"role": "user", "content": prompt},
        ]

    # ─── 单 NPC 结局 Prompt ─────────────────────────

    def build_evaluate_npc_messages(self, session: GameSession, npc_id: str,
                                     ending_type: str = "") -> list[dict]:
        npc_path = os.path.join(_PROMPTS_DIR, "evaluate_npc.txt")
        if os.path.exists(npc_path):
            with open(npc_path, "r", encoding="utf-8") as f:
                template = f.read()
        else:
            template = "请为 NPC 生成结局描述 JSON。"

        npc = session.npcs.get(npc_id)
        if not npc:
            return []

        dialogue_sample = ""
        if npc.dialogue_history:
            for turn in npc.dialogue_history[-2:]:
                role = "玩家" if turn.role == "player" else npc.name
                dialogue_sample += f"{role}：{turn.content[:60]}\n"

        prompt = template.format(
            npc_name=npc.name,
            npc_role=npc.role,
            npc_id=npc_id,
            final_relationship=npc.relationship,
            dialogue_sample=dialogue_sample or "（无对话记录）",
            player_name=session.player_name,
            ending_type=ending_type or session.ending_type or "default_ending",
        )
        return [
            {"role": "system", "content": "你是一位叙事评论家，为 NPC 生成结局描述 JSON。"},
            {"role": "user", "content": prompt},
        ]
```

- [ ] **Step 2: 提交**

```bash
git add backend/agents/prompt_builder.py
git commit -m "feat: 添加结局 header 和单 NPC 结局的 prompt builder 方法"
```

---

### Task 4: 后端 SSE 端点 + 只读端点

**Files:**
- Modify: `backend/routes/game.py`

- [ ] **Step 1: 添加必要的 import**

在 `backend/routes/game.py` 顶部，找到现有的 import 区域，添加 `asyncio` 和 `Starlette` SSE 相关导入：

```python
import asyncio
import json
from starlette.responses import StreamingResponse
```

注意：`json` 和 `asyncio` 可能已在文件顶部，检查并只添加缺少的。

- [ ] **Step 2: 在 `evaluate_ending` 之后添加 SSE 端点**

在 `evaluate_ending` 路由（约第 166 行 return 后）之后插入：

```python
@router.get("/game/{session_id}/evaluate/stream")
async def evaluate_ending_stream(session_id: str):
    """流式结局生成 — SSE 端点。先返回 header，再并行返回 5 个 NPC 结局。"""
    manager = get_session_manager()
    session = manager.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail={
            "error": True, "code": "SESSION_NOT_FOUND",
            "message": f"游戏会话不存在: {session_id}"
        })

    if not session.game_ended:
        raise HTTPException(status_code=400, detail={
            "error": True, "code": "INVALID_PARAM",
            "message": "游戏尚未结束"
        })

    # 如果已有完整缓存，直接返回
    if session.ending_data and session.ending_data.get("npc_endings"):
        logger.info(f"[Evaluate Stream] Returning cached ending for {session_id}")

        async def replay_cache():
            header = {
                "title": session.ending_data.get("title", ""),
                "summary": session.ending_data.get("summary", ""),
                "key_moments": session.ending_data.get("key_moments", []),
                "life_lesson": session.ending_data.get("life_lesson", ""),
            }
            yield f"event: header\ndata: {json.dumps(header, ensure_ascii=False)}\n\n"
            for npc_end in session.ending_data.get("npc_endings", []):
                yield f"event: npc\ndata: {json.dumps(npc_end, ensure_ascii=False)}\n\n"
            yield f"event: done\ndata: {json.dumps({'type': session.ending_type or 'default_ending'})}\n\n"

        return StreamingResponse(replay_cache(), media_type="text/event-stream")

    async def generate():
        try:
            llm = LLMClient()
            builder = PromptBuilder()
            if session.system_prompt:
                builder.set_system_prompt(session.system_prompt)

            # Phase 1: 生成 header
            header_messages = builder.build_evaluate_header_messages(session)
            header_result = await llm.chat_json(header_messages, api_key=session.api_key, temperature=0.7)

            if not header_result.get("title"):
                header_result = {
                    "title": "梨园余韵",
                    "summary": "你在梨溪镇的故事告一段落。",
                    "key_moments": [],
                    "life_lesson": "戏如人生，人生如戏。",
                }

            header_event = {
                "title": header_result.get("title", ""),
                "summary": header_result.get("summary", ""),
                "key_moments": header_result.get("key_moments", []),
                "life_lesson": header_result.get("life_lesson", ""),
            }
            yield f"event: header\ndata: {json.dumps(header_event, ensure_ascii=False)}\n\n"

            # Phase 2: 并行生成 5 个 NPC 结局
            ending_type = session.ending_type or "default_ending"
            npc_list = list(session.npcs.values())

            async def generate_one_npc(npc):
                try:
                    msgs = builder.build_evaluate_npc_messages(session, npc.id, ending_type)
                    if not msgs:
                        return {"npc_id": npc.id, "summary": f"{npc.name}的故事还在继续……"}
                    result = await llm.chat_json(msgs, api_key=session.api_key, temperature=0.7)
                    return {
                        "npc_id": npc.id,
                        "name": npc.name,
                        "summary": result.get("summary", f"{npc.name}的故事还在继续……"),
                    }
                except Exception as e:
                    logger.warning(f"[Evaluate Stream] NPC {npc.id} generation failed: {e}")
                    return {"npc_id": npc.id, "name": npc.name, "summary": f"{npc.name}的故事还在继续……"}

            tasks = [generate_one_npc(npc) for npc in npc_list]
            npc_endings = []

            for coro in asyncio.as_completed(tasks):
                npc_result = await coro
                npc_endings.append(npc_result)
                yield f"event: npc\ndata: {json.dumps(npc_result, ensure_ascii=False)}\n\n"

            yield f"event: done\ndata: {json.dumps({'type': ending_type})}\n\n"

            # 持久化完整 ending_data
            session.ending_data = {
                "type": ending_type,
                "title": header_event["title"],
                "summary": header_event["summary"],
                "key_moments": header_event["key_moments"],
                "life_lesson": header_event["life_lesson"],
                "npc_endings": npc_endings,
            }
            manager.persist_session(session)

        except Exception as e:
            logger.exception(f"[Evaluate Stream] Failed: {e}")
            yield f"event: error\ndata: {json.dumps({'message': str(e)})}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")
```

- [ ] **Step 3: 在 SSE 端点后添加只读 ending 端点**

```python
@router.get("/game/{session_id}/ending")
async def get_ending(session_id: str):
    """只读端点 — 返回已缓存的结局数据，用于主菜单回看。"""
    manager = get_session_manager()
    session = manager.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail={
            "error": True, "code": "SESSION_NOT_FOUND",
            "message": f"游戏会话不存在: {session_id}"
        })

    if not session.ending_data:
        raise HTTPException(status_code=404, detail={
            "error": True, "code": "ENDING_NOT_FOUND",
            "message": "该存档尚无结局数据"
        })

    return session.ending_data
```

- [ ] **Step 4: 提交**

```bash
git add backend/routes/game.py
git commit -m "feat: 添加结局流式 SSE 端点和只读 ending 端点"
```

---

### Task 5: 前端 client.js 新增函数

**Files:**
- Modify: `frontend/src/api/client.js`

- [ ] **Step 1: 在 `evaluateEnding` 函数后添加 `evaluateEndingStream`**

找到 `evaluateEnding` 函数（约第 389 行），在它的闭合 `}` 后添加：

```js
/**
 * 流式结局生成 — SSE 消费
 * @param {string} sessionId
 * @param {Object} callbacks
 * @param {function(Object):void} callbacks.onHeader - 收到 header 事件
 * @param {function(Object):void} callbacks.onNpcEnding - 收到单个 NPC 结局
 * @param {function(Object):void} callbacks.onDone - 全部完成
 * @param {function(Error):void} callbacks.onError - 出错
 */
export async function evaluateEndingStream(sessionId, callbacks) {
  const { onHeader, onNpcEnding, onDone, onError } = callbacks;
  try {
    const res = await fetch(`${BASE}/game/${sessionId}/evaluate/stream`);
    if (!res.ok) {
      const errText = await res.text();
      onError && onError(new Error(errText));
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let eventType = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('event: ')) {
          eventType = trimmed.slice(7).trim();
        } else if (trimmed.startsWith('data: ')) {
          try {
            const data = JSON.parse(trimmed.slice(6));
            switch (eventType) {
              case 'header':
                onHeader && onHeader(data);
                break;
              case 'npc':
                onNpcEnding && onNpcEnding(data);
                break;
              case 'done':
                onDone && onDone(data);
                break;
              case 'error':
                onError && onError(new Error(data.message || 'Unknown error'));
                break;
            }
          } catch (e) {
            console.warn('[evaluateEndingStream] parse error:', trimmed, e);
          }
          eventType = '';
        }
      }
    }
  } catch (e) {
    onError && onError(e);
  }
}

/** 获取已缓存的结局数据（只读，用于主菜单回看） */
export async function getEnding(sessionId) {
  const res = await fetch(`${BASE}/game/${sessionId}/ending`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
```

- [ ] **Step 2: 提交**

```bash
git add frontend/src/api/client.js
git commit -m "feat: 添加 evaluateEndingStream 和 getEnding API 函数"
```

---

### Task 6: 重构 EndingScreen — 流式渲染 + 静态模式

**Files:**
- Modify: `frontend/src/scenes/modules/EndingScreen.js`

- [ ] **Step 1: 重写 `trigger()` 方法为流式消费**

替换现有 `trigger()` 方法（约第 94 行起）为：

```js
  /** 触发结局流程 — 流式消费 */
  async trigger() {
    const ui = this.ui;
    const { width, height } = ui.cameras.main;

    ui.dialogContainer.setVisible(false);
    const gs = ui.scene.get('GameScene');
    gs.events.emit('input:lock', true);

    // "命运的齿轮开始转动..." — 等待动画
    const fateText = ui.add.text(width / 2, height / 2, '命运的齿轮开始转动……', {
      fontFamily: '"KaiTi","SimSun",serif', fontSize: '48px', color: '#e8e0d0',
      stroke: '#1a1a1a', strokeThickness: 4,
    }).setOrigin(0.5).setDepth(550).setAlpha(0);

    ui.tweens.add({ targets: fateText, alpha: 1, duration: 1500 });
    ui.tweens.add({
      targets: fateText, alpha: 0.5, duration: 1600, yoyo: true, repeat: -1,
      ease: 'Sine.easeInOut', delay: 1500,
    });

    // 收集 NPC 结局数据
    const npcEndings = [];

    const { evaluateEndingStream } = await import('../../api/client.js');
    evaluateEndingStream(ui.sessionId, {
      onHeader: (header) => {
        // 收到 header → 停止脉动，渲染上半部分
        ui.tweens.killTweensOf(fateText);
        ui.tweens.add({ targets: fateText, alpha: 0, duration: 400 });
        this._wait(500).then(() => fateText.destroy());

        ui.endingContainer.setVisible(true);
        ui.endingContainer.setAlpha(1);

        ui.endingTitle.setText(header.title || '梨园余韵');
        ui.endingSubtitle.setText(
          (header.type || ui._endingType) === 'accept_leader'
            ? '—— 梨园传承线 ——' : '—— 遗憾离别线 ——'
        );

        if (header.key_moments && header.key_moments.length > 0) {
          const lines = header.key_moments.map(m => `「${m.description}」`);
          ui.endingKeyMoments.setText(lines.join('\n'));
        } else {
          ui.endingKeyMoments.setText('');
        }

        ui.endingLesson.setText(`"${header.life_lesson || '戏如人生，人生如戏。'}"`);

        // 清空 NPC 区域等待追加
        ui.endingNPCText.setText('');

        // 逐段淡入
        ui.endingTitle.setAlpha(1);
        ui.endingSubtitle.setAlpha(0);
        ui.endingKeyMoments.setAlpha(0);
        ui.endingLesson.setAlpha(0);
        this._staggerHeaderIn(ui);
      },

      onNpcEnding: (npcEnd) => {
        npcEndings.push(npcEnd);
        // 追加到 NPC 文本
        const name = ui._resolveNpcName
          ? ui._resolveNpcName(npcEnd.npc_id)
          : (npcEnd.name || npcEnd.npc_id || '未知');
        const current = ui.endingNPCText.text || '';
        const newLine = current ? `${current}\n◆ ${name}：${npcEnd.summary}` : `◆ ${name}：${npcEnd.summary}`;
        ui.endingNPCText.setText(newLine);
        this._layoutScrollContent();

        // 新追加的行做短暂高亮（通过 alpha 闪烁）
        ui.endingNPCText.setAlpha(0.3);
        ui.tweens.add({ targets: ui.endingNPCText, alpha: 1, duration: 400, ease: 'Sine.easeIn' });
      },

      onDone: () => {
        this._showRestartHint(ui);
      },

      onError: (err) => {
        console.error('[EndingScreen] stream error:', err);
        ui.tweens.killTweensOf(fateText);
        fateText.destroy();
      },
    });
  }

  _staggerHeaderIn(ui) {
    const elements = [ui.endingSubtitle, ui.endingKeyMoments, ui.endingLesson];
    elements.reduce((delay, el) => {
      this._wait(delay).then(() => {
        ui.tweens.add({ targets: el, alpha: 1, duration: 600, ease: 'Sine.easeIn' });
      });
      return delay + 400;
    }, 400);
  }

  _showRestartHint(ui) {
    this._wait(300).then(() => {
      ui.tweens.add({ targets: ui.endingRestart, alpha: 1, duration: 800, yoyo: true, repeat: -1 });
    });

    ui.input.keyboard.once('keydown-R', () => {
      ui.endingContainer.setVisible(false);
      ui.scene.get('GameScene').events.emit('game:restart');
    });
  }
```

- [ ] **Step 2: 添加 `showStatic()` 方法（主菜单回看用）**

在 `_layoutScrollContent` 前插入：

```js
  /** 静态展示结局（主菜单回看模式，无 LLM 等待，全量即时渲染） */
  showStatic(endingData) {
    const ui = this.ui;

    ui.endingContainer.setVisible(true);
    ui.endingContainer.setAlpha(1);

    ui.endingTitle.setText(endingData.title || '梨园余韵');
    ui.endingTitle.setAlpha(1);

    ui.endingSubtitle.setText(
      (endingData.type || '') === 'accept_leader'
        ? '—— 梨园传承线 ——' : '—— 遗憾离别线 ——'
    ).setAlpha(1);

    if (endingData.key_moments && endingData.key_moments.length > 0) {
      const lines = endingData.key_moments.map(m => `「${m.description}」`);
      ui.endingKeyMoments.setText(lines.join('\n'));
    } else {
      ui.endingKeyMoments.setText('');
    }
    ui.endingKeyMoments.setAlpha(1);

    ui.endingLesson.setText(`"${endingData.life_lesson || '戏如人生，人生如戏。'}"`).setAlpha(1);

    if (endingData.npc_endings && endingData.npc_endings.length > 0) {
      ui.endingNPCText.setText(endingData.npc_endings.map(e => {
        const name = ui._resolveNpcName
          ? ui._resolveNpcName(e.npc_id)
          : (e.name || e.npc_id || '未知');
        return `◆ ${name}：${e.summary}`;
      }).join('\n'));
    } else {
      ui.endingNPCText.setText('');
    }
    ui.endingNPCText.setAlpha(1);

    this._layoutScrollContent();

    // 隐藏重启提示（菜单回看不需要）
    ui.endingRestart.setAlpha(0);
  }
```

- [ ] **Step 3: 更新 `createScreen()` 的布局**

在 `createScreen()` 中调整各元素的初始 Y 坐标（约第 28-90 行），替换为：

```js
  createScreen() {
    const ui = this.ui;
    const { width, height } = ui.cameras.main;

    ui.endingContainer = ui.add.container(0, 0).setDepth(600).setVisible(false);

    const endingBg = ui.add.graphics();
    endingBg.fillStyle(0x0a0a12, 1);
    endingBg.fillRect(0, 0, width, height);
    ui.endingContainer.add(endingBg);

    // 标题 — y: 80
    ui.endingTitle = ui.add.text(width / 2, 80, '', {
      fontFamily: '"KaiTi","SimSun",serif', fontSize: '42px', color: '#d4b896',
      wordWrap: { width: width - 80 }, align: 'center',
    }).setOrigin(0.5, 0);
    ui.endingContainer.add(ui.endingTitle);

    // 副标题 — y: 紧贴标题下方
    ui.endingSubtitle = ui.add.text(width / 2, 140, '', {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif', fontSize: '18px', color: '#998866',
    }).setOrigin(0.5, 0);
    ui.endingContainer.add(ui.endingSubtitle);

    // 分隔线 — y: 170
    const divider = ui.add.graphics();
    divider.lineStyle(1, 0xc4a882, 0.4);
    const divY = 175;
    divider.lineBetween(width / 2 - 180, divY, width / 2 + 180, divY);
    ui.endingContainer.add(divider);

    // 关键瞬间 — y: 195
    ui.endingKeyMoments = ui.add.text(width / 2, 195, '', {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif', fontSize: '14px', color: '#a89878',
      lineSpacing: 10, align: 'center', wordWrap: { width: width - 100 },
    }).setOrigin(0.5, 0);
    ui.endingContainer.add(ui.endingKeyMoments);

    // 感悟 — 紧贴关键瞬间下方
    ui.endingLesson = ui.add.text(width / 2, 265, '', {
      fontFamily: '"KaiTi","SimSun",serif', fontSize: '20px', color: '#e8d8b8',
      wordWrap: { width: Math.min(500, width - 80) }, align: 'center', lineSpacing: 8,
    }).setOrigin(0.5, 0);
    ui.endingContainer.add(ui.endingLesson);

    // NPC 结局分割
    const npcDivY = 320;
    const npcDivider = ui.add.graphics();
    npcDivider.lineStyle(1, 0xc4a882, 0.25);
    npcDivider.lineBetween(width / 2 - 120, npcDivY, width / 2 + 120, npcDivY);
    ui.endingContainer.add(npcDivider);

    // 可滚动内容区（NPC 结局区域）
    const scrollTop = npcDivY + 12;
    const scrollBottom = height - 70;
    ui._endingScrollArea = { top: scrollTop, bottom: scrollBottom, height: scrollBottom - scrollTop };
    ui._endingScrollY = 0;
    ui._endingScrollContentHeight = 0;

    ui.endingScrollContent = ui.add.container(0, scrollTop);
    ui.endingContainer.add(ui.endingScrollContent);

    const scrollMaskGfx = ui.add.graphics();
    scrollMaskGfx.fillRect(0, scrollTop, width, scrollBottom - scrollTop);
    scrollMaskGfx.setVisible(false);
    ui.endingScrollContent.setMask(scrollMaskGfx.createGeometryMask());

    ui.endingNPCText = ui.add.text(width / 2, 0, '', {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif', fontSize: '13px', color: '#887766',
      lineSpacing: 8, align: 'center', wordWrap: { width: Math.min(480, width - 60) },
    }).setOrigin(0.5, 0);
    ui.endingScrollContent.add(ui.endingNPCText);

    // 滚轮滚动
    if (this._wheelHandler) ui.input.off('wheel', this._wheelHandler);
    this._wheelHandler = (_p, _go, _dx, deltaY) => {
      if (!ui.endingContainer || !ui.endingContainer.visible) return;
      const maxScroll = Math.max(0, ui._endingScrollContentHeight - ui._endingScrollArea.height);
      if (maxScroll === 0) return;
      ui._endingScrollY = Math.max(-maxScroll, Math.min(0, (ui._endingScrollY || 0) - deltaY * 0.5));
      ui.endingScrollContent.setY(ui._endingScrollArea.top + ui._endingScrollY);
    };
    ui.input.on('wheel', this._wheelHandler);

    // R 键重启提示 — 底部固定
    ui.endingRestart = ui.add.text(width / 2, height - 50, '[ 按 R 键重新开始 ]', {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif', fontSize: '14px', color: '#887766',
    }).setOrigin(0.5).setAlpha(0);
    ui.endingContainer.add(ui.endingRestart);
  }
```

- [ ] **Step 4: 更新 `_layoutScrollContent()` 和 `onResize()`**

替换 layout 方法（约第 186 行）以匹配新布局：

```js
  _layoutScrollContent() {
    const ui = this.ui;
    // NPC 结局文本在 scrollContent 容器内，自动计算高度
    ui._endingScrollContentHeight = ui.endingNPCText.height;
    ui._endingScrollY = 0;
    ui.endingScrollContent.setY(ui._endingScrollArea.top);
  }
```

`onResize()` 方法中有 `savedTexts` 对象，需补充 `npc` 字段（已有），布局坐标已固定无需额外改动。

- [ ] **Step 5: 添加 `_endingType` 状态存储**

`trigger()` 在收到 header 时可能需要记录 ending_type。这个值在 done 事件的 data 中也有，但 header 里可能不含 type。简单处理：用 closure 存储。

在 `trigger()` 方法 `evaluateEndingStream` 调用前加一行：

```js
    let _endingType = 'default_ending';
```

在 `onHeader` 回调开头：
```js
        // (type 信息后续由 done 事件携带，这里先设为 default)
```

在 `onDone` 回调中：
```js
        _endingType = data.type || 'default_ending';
        this._showRestartHint(ui);
```

在 subtitle 显示时用 `_endingType`：
```js
        ui.endingSubtitle.setText(
          _endingType === 'accept_leader'
            ? '—— 梨园传承线 ——' : '—— 遗憾离别线 ——'
        );
```

- [ ] **Step 6: 提交**

```bash
git add frontend/src/scenes/modules/EndingScreen.js
git commit -m "feat: EndingScreen 流式渲染 + 静态回看模式 + 布局优化"
```

---

### Task 7: MenuScene 添加「查看结局」按钮

**Files:**
- Modify: `frontend/src/scenes/MenuScene.js`

- [ ] **Step 1: 添加 getEnding 导入和结局查看器创建**

在文件顶部 import 区域（约第 16 行）添加导入：

```js
import { getSessions, deleteSession, getEnding } from '../api/client.js';
```

修改为：
```js
import { getSessions, deleteSession, getEnding } from '../api/client.js';
```

- [ ] **Step 2: 在 MenuScene.create() 中预创建结局弹窗**

在 `create()` 末尾（约第 195 行 `this.tweens.add({ targets: btnContainer... })` 之后）添加：

```js
    // 结局回看弹窗
    this._createEndingViewer();
```

- [ ] **Step 3: 添加结局弹窗创建方法**

在 `_createArchivePanel()` 方法之后（约第 269 行后）添加：

```js
  _createEndingViewer() {
    const { width, height } = this.cameras.main;
    this.endingViewer = this.add.container(0, 0).setDepth(200).setVisible(false);

    // 全屏遮罩
    const dimBg = this.add.graphics();
    dimBg.fillStyle(0x0a0a12, 1);
    dimBg.fillRect(0, 0, width, height);
    dimBg.setInteractive(new Phaser.Geom.Rectangle(0, 0, width, height), Phaser.Geom.Rectangle.Contains);
    dimBg.on('pointerdown', () => this._hideEndingViewer());
    this.endingViewer.add(dimBg);

    // 内容区
    this.endingViewerContent = this.add.container(0, 0);
    this.endingViewer.add(this.endingViewerContent);

    // 标题
    this.endingViewerTitle = this.add.text(width / 2, 60, '', {
      fontFamily: '"KaiTi","SimSun",serif', fontSize: '36px', color: '#d4b896',
    }).setOrigin(0.5, 0);
    this.endingViewerContent.add(this.endingViewerTitle);

    // 副标题
    this.endingViewerSub = this.add.text(width / 2, 115, '', {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif', fontSize: '16px', color: '#998866',
    }).setOrigin(0.5, 0);
    this.endingViewerContent.add(this.endingViewerSub);

    // 分隔线
    const divGfx2 = this.add.graphics();
    divGfx2.lineStyle(1, 0xc4a882, 0.4);
    divGfx2.lineBetween(width / 2 - 180, 145, width / 2 + 180, 145);
    this.endingViewerContent.add(divGfx2);

    // 关键瞬间
    this.endingViewerMoments = this.add.text(width / 2, 160, '', {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif', fontSize: '13px', color: '#a89878',
      lineSpacing: 8, align: 'center', wordWrap: { width: width - 100 },
    }).setOrigin(0.5, 0);
    this.endingViewerContent.add(this.endingViewerMoments);

    // 感悟
    this.endingViewerLesson = this.add.text(width / 2, 220, '', {
      fontFamily: '"KaiTi","SimSun",serif', fontSize: '18px', color: '#e8d8b8',
      align: 'center', wordWrap: { width: Math.min(480, width - 80) },
    }).setOrigin(0.5, 0);
    this.endingViewerContent.add(this.endingViewerLesson);

    // NPC 结局
    this.endingViewerNPC = this.add.text(width / 2, 270, '', {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif', fontSize: '13px', color: '#887766',
      lineSpacing: 6, align: 'center', wordWrap: { width: Math.min(480, width - 60) },
    }).setOrigin(0.5, 0);
    this.endingViewerContent.add(this.endingViewerNPC);

    // 关闭提示
    this.add.text(width / 2, height - 40, '[ 点击任意位置或按 ESC 关闭 ]', {
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
      fontSize: '13px', color: '#554433',
    }).setOrigin(0.5).setDepth(201);
  }
```

- [ ] **Step 4: 添加显示/隐藏结局弹窗方法**

在 `_hideEndingViewer` 被引用之前添加（约在 `_hideArchivePanel()` 后）：

```js
  async _showEndingViewer(sessionId) {
    try {
      const data = await getEnding(sessionId);
      this.endingViewerTitle.setText(data.title || '梨园余韵');
      this.endingViewerSub.setText(
        data.type === 'accept_leader' ? '—— 梨园传承线 ——' : '—— 遗憾离别线 ——'
      );

      if (data.key_moments && data.key_moments.length > 0) {
        this.endingViewerMoments.setText(data.key_moments.map(m => `「${m.description}」`).join('\n'));
      } else {
        this.endingViewerMoments.setText('');
      }

      this.endingViewerLesson.setText(`"${data.life_lesson || '戏如人生，人生如戏。'}"`);

      if (data.npc_endings && data.npc_endings.length > 0) {
        this.endingViewerNPC.setText(data.npc_endings.map(e => {
          const name = e.name || e.npc_id || '未知';
          return `◆ ${name}：${e.summary}`;
        }).join('\n'));
      } else {
        this.endingViewerNPC.setText('');
      }

      this.endingViewer.setVisible(true);
    } catch (e) {
      console.error('[MenuScene] 获取结局失败:', e);
      this.archiveHint.setText('无法加载结局数据');
    }
  }

  _hideEndingViewer() {
    this.endingViewer.setVisible(false);
    this.endingViewerContent.removeAll(true);
    this._createEndingViewer(); // 重建内容
  }
```

注意：`_hideEndingViewer` 中重建了 `endingViewerContent`，这需要把 `_createEndingViewer` 中的内容创建逻辑抽出来。更好的方式是让 `_hideEndingViewer` 只隐藏：

```js
  _hideEndingViewer() {
    this.endingViewer.setVisible(false);
  }
```

- [ ] **Step 5: 添加 ESC 关闭结局弹窗**

在 `create()` 的 ESC 逻辑中（如果有的话）或者添加：

```js
    this.input.keyboard.on('keydown-ESC', () => {
      if (this.endingViewer && this.endingViewer.visible) {
        this._hideEndingViewer();
      }
    });
```

查找现有 ESC 处理逻辑位置（约 `this.keyEsc` 部分），在其附近添加。

- [ ] **Step 6: 修改 `_renderArchiveList()` 中的按钮逻辑**

在 `_renderArchiveList()` 中（约第 347-357 行），将「继续」按钮的渲染改为条件渲染：

将：
```js
      // 继续按钮
      this.archiveListContent.add(
        createSmallButton(this, panelX + colW - 150, y + 10, 60, 32, '继续', '#889966',
          () => this._loadArchive(s.session_id))
      );
```

改为：
```js
      if (s.game_ended) {
        // 已结局 → 「查看结局」按钮
        this.archiveListContent.add(
          createSmallButton(this, panelX + colW - 150, y + 10, 80, 32, '查看结局', '#8899aa',
            () => this._showEndingViewer(s.session_id))
        );
      } else {
        // 未结局 → 「继续」按钮
        this.archiveListContent.add(
          createSmallButton(this, panelX + colW - 150, y + 10, 60, 32, '继续', '#889966',
            () => this._loadArchive(s.session_id))
        );
      }
```

同时把删除按钮的 X 坐标从 `-90` 调整到 `-70`，宽度从 60 调为 60（保持不变），给查看结局按钮多留 20px 空间。

- [ ] **Step 7: 提交**

```bash
git add frontend/src/scenes/MenuScene.js
git commit -m "feat: 主菜单存档列表添加已结局存档的「查看结局」按钮"
```

---

### Task 8: 端到端验证

- [ ] **Step 1: 启动后端**

```bash
cd backend && python main.py
```

确认启动无报错。

- [ ] **Step 2: 启动前端**

```bash
cd frontend && npm run dev
```

确认无构建错误。

- [ ] **Step 3: 测试流式结局生成**

1. 新建游戏或加载存档 → 推进到结局触发
2. 确认"命运的齿轮开始转动……"动画出现
3. 确认标题/总结在 3-5s 内显示
4. 确认 NPC 结局逐条淡入追加（不是全部同时出现）
5. 确认最后显示 [R 重新开始] 闪烁

- [ ] **Step 4: 测试缓存复用**

1. 再次触发同一存档的结局 → 确认立即返回（缓存命中，日志有 "Returning cached ending"）

- [ ] **Step 5: 测试主菜单回看**

1. 返回主菜单 → 点「继续游戏」
2. 找到已结局存档 → 确认显示「查看结局」按钮（青色系）
3. 点击「查看结局」 → 确认结局弹窗全量显示
4. 点击遮罩或按 ESC → 确认关闭
5. 未结局的存档 → 确认仍显示「继续」按钮

- [ ] **Step 6: 测试加载已结局存档**

1. 从菜单加载已结局存档 → 确认游戏场景正常加载
2. 确认 `ending:restore` 事件触发（已有逻辑），结局画面重现

---

### Task 9: 最终提交

- [ ] **Step 1: 确认所有改动已提交**

```bash
git status
git log --oneline -10
```
