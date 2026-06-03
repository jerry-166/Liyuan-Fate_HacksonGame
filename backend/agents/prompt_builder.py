"""
Prompt 拼装器 — v2 章节+任务+物品上下文注入。
"""

import os
import logging
from typing import Optional

from state.session import GameSession
from config import CHAPTER_TO_STAGE, STAGE_LEGACY_MAP

logger = logging.getLogger(__name__)

_PERSONAS_DIR = os.path.join(os.path.dirname(__file__), "personas")
_PROMPTS_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "prompts")

_personas_cache: dict[str, dict] = {}
_system_base_cache: Optional[str] = None


def _load_persona(npc_id: str, persona_cache: dict = None) -> dict:
    if persona_cache and npc_id in persona_cache:
        return persona_cache[npc_id]
    if npc_id in _personas_cache:
        return _personas_cache[npc_id]

    # 搜索 persona 文件
    mapping = {
        "npc_chen": "chen_shifu.yaml",
        "npc_xiaohua": "xiaohua.yaml",
        "npc_laozhou": "lao_zhou.yaml",
        "npc_meiyi": "mei_yi.yaml",
        "npc_laoli": "lao_li.yaml",
    }
    filename = mapping.get(npc_id)
    if not filename:
        logger.warning(f"[PromptBuilder] No persona for {npc_id}")
        return {}

    path = os.path.join(_PERSONAS_DIR, filename)
    if not os.path.exists(path):
        logger.warning(f"[PromptBuilder] Persona not found: {path}")
        return {}

    import yaml
    with open(path, "r", encoding="utf-8") as f:
        data = yaml.safe_load(f)
    _personas_cache[npc_id] = data
    return data


def _load_system_base(system_prompt_override: str = None) -> str:
    if system_prompt_override:
        return system_prompt_override
    global _system_base_cache
    if _system_base_cache is not None:
        return _system_base_cache

    path = os.path.join(_PROMPTS_DIR, "system_base.txt")
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            _system_base_cache = f.read()
    else:
        _system_base_cache = ""
    return _system_base_cache


class PromptBuilder:

    def __init__(self):
        self._base = _load_system_base()

    def set_system_prompt(self, prompt: str):
        self._base = prompt

    def build_dialogue_messages(
        self,
        session: GameSession,
        npc_id: str,
        player_message: Optional[str] = None,
        is_ending: bool = False,
        show_item_id: Optional[str] = None,
    ) -> list[dict]:
        persona = _load_persona(npc_id, session.persona_cache)
        npc = session.npcs.get(npc_id)
        if not npc:
            raise ValueError(f"NPC not found: {npc_id}")

        chapter = session.get_current_chapter()
        stage = session.current_stage

        system_content = self._build_system(npc_id, persona, npc.name, stage, session, chapter)
        user_content = self._build_user(
            npc_id, npc.name, stage, session, player_message, is_ending, show_item_id, chapter
        )

        return [
            {"role": "system", "content": system_content},
            {"role": "user", "content": user_content},
        ]

    def _build_system(self, npc_id, persona, npc_name, stage, session, chapter) -> str:
        parts = []

        # 1. 世界观
        base = session.system_prompt or self._base
        if base:
            parts.append(base.replace("{npc_name}", npc_name))

        # 2. NPC 人设
        npc_section = persona.get("npc", {})
        personality = persona.get("personality", {})
        parts.append(f"""
## 你的角色设定
- 姓名：{npc_section.get('name', npc_name)}
- 角色：{npc_section.get('role', '')}
- 年龄：{npc_section.get('age', '')}
- 所在地点：{npc_section.get('scene', '')}
- 性格特征：{', '.join(personality.get('traits', []))}
- 说话风格：{personality.get('style', '')}
- 口头禅：{personality.get('catchphrase', '')}
- 背景故事：{personality.get('background', '')}
""")

        # 3. 章节上下文（本章目标 + NPC 态度指引）
        #    叙事进度（已完成章节+事件）由 _build_state_context 中的叙事总览统一提供
        if chapter:
            chapter_lines = [f"""
## 当前章节：{chapter.get('name', '')}

{chapter.get('description', '')}
"""]

            # 章节核心目标（引导 NPC 行为方向）
            sc = chapter.get('success_condition', '')
            if sc:
                chapter_lines.append(f"""
### 本章目标
{sc}

⚠️ 对话和选项应服务于推进以上目标。如果玩家偏离主线，自然地引导（但不直接说出游戏机制）。
""")

            # NPC 态度指引
            attitude = self._get_chapter_attitude_guidance(chapter.get("id", ""))
            if attitude:
                chapter_lines.append(attitude)

            parts.append("\n".join(chapter_lines))

        # 4. 全局状态
        parts.append(self._build_state_context(session, npc_id))

        # 5. 对话风格示例
        examples = persona.get("dialogue_examples", [])
        if examples:
            parts.append("\n## 对话风格参考")
            for ex in examples[:3]:
                parts.append(f"- 玩家：「{ex.get('player', '')}」\n  你：「{ex.get('npc', '')}」")

        # 6. 对话结束规则
        parts.append("""
## 对话结束规则
- 判断对话是否已「自然结束」。当话题穷尽或你已完成回应时，自然收尾。
- 对话结束时，options 必须为空数组 []，并说一句简短告别语。
""")

        return "\n".join(parts)

    # ─── 上下文长度控制常量 ─────────────────────────
    _MAX_DIALOGUE_HISTORY = 5          # 当前章节保留最近 N 轮原始对话
    _MAX_DIALOGUE_CONTENT_LEN = 80     # 单轮对话内容最大字符数（截断）
    _MAX_EVENT_DISPLAY = 10            # 最多显示的事件数

    def _build_state_context(self, session: GameSession, current_npc_id: str) -> str:
        """构建压缩版全局状态上下文。

        分级策略：
        - 跨章节叙事 → 压缩为「叙事总览」（自然语言摘要）
        - 关键事件 → 压缩为可读描述（而非原始 event_id）
        - 当前章节对话 → 保留最近 N 轮原始对话 + 内容截断
        - 关系值/任务/物品 → 保持原样
        """
        parts = []

        # ── 1. 叙事总览（压缩版：已完成章节 + 关键事件的人类可读描述）──
        narrative = self._build_narrative_summary(session)
        if narrative:
            parts.append(narrative)

        # ── 2. 关系值 ──────────────────────────────
        parts.append("\n## 关系值")
        for npc in session.npcs.values():
            rel_desc = self._describe_relationship(npc.relationship)
            parts.append(f"  - {npc.name}：{npc.relationship}（{rel_desc}）")

        # ── 3. 当前任务 ────────────────────────────
        task = session.current_task
        if task:
            parts.append(f"\n## 当前任务")
            parts.append(f"{task.description}")
            parts.append(f"进度：{int(task.completion_rate * 100)}%")
            relevant = [st for st in task.sub_tasks if self._is_npc_relevant(st, current_npc_id)]
            if relevant:
                parts.append("你需要关注的子任务：")
                for st in relevant:
                    status_icon = {"locked": "🔒", "active": "⬜",
                                   "in_progress": "🔄", "completed": "✅"
                                   }.get(st.status, "?")
                    parts.append(f"  [{status_icon}] {st.title}（{st.mode}）")

        # ── 4. 物品 ────────────────────────────────
        if session.inventory:
            inv_names = [i.name for i in session.inventory]
            parts.append(f"\n## 玩家物品：{', '.join(inv_names)}")
            if session.active_item:
                item = session.get_inventory_item(session.active_item)
                if item:
                    parts.append(f">>> 玩家正在展示：{item.name}")
                    parts.append(f"描述：{item.get_display_text()[:150]}")
                    if current_npc_id in item.npc_knowledge:
                        parts.append(f"你对它的认知：{item.npc_knowledge[current_npc_id][:100]}")

        # ── 5. 当前章节对话历史 ────────────────────
        dialogue_section = self._build_recent_dialogue(session, current_npc_id)
        if dialogue_section:
            parts.append(dialogue_section)

        return "\n".join(parts)

    def _build_narrative_summary(self, session: GameSession) -> str:
        """构建压缩版叙事总览。

        将已完成章节 + 已触发事件压缩为自然语言摘要。
        跨章节信息通过事件描述保留叙事连贯性（而非原始对话）。
        """
        if not session.chapter_defs or not session.current_chapter_id:
            return ""

        lines = ["## 📖 叙事总览"]
        player = session.player_name or "玩家"

        # 已完成章节（按 sort_order 排序）
        completed = []
        for ch_def in sorted(session.chapter_defs,
                             key=lambda c: c.get("sort_order", 0)):
            cid = ch_def.get("id", "")
            if cid == session.current_chapter_id:
                continue
            if cid in session.completed_chapters:
                completed.append(ch_def)

        if completed:
            parts = [f"「{player}」回到梨溪镇安葬父亲。"]
            for ch_def in completed:
                name = ch_def.get("name", "?")
                key_event = ch_def.get("key_event", "")
                # 用事件描述提供叙事锚点
                event_desc = self._describe_event(key_event) if key_event else "完成"
                parts.append(f"- {name}：{event_desc}")
            lines.append("\n".join(parts))

        # 关键事件（压缩：只显示有意义的描述，而非 raw event_id）
        events = sorted(session.events_triggered) if session.events_triggered else []
        if events:
            described = []
            for evt in events[:self._MAX_EVENT_DISPLAY]:
                desc = self._describe_event(evt)
                if desc != evt:
                    described.append(desc)
            if described:
                lines.append(f"\n⚡ 已发生的关键事件：{'; '.join(described)}")
            elif len(events) > 0:
                # fallback：显示原始 event_id
                excess = f"（共{len(events)}个）" if len(events) > self._MAX_EVENT_DISPLAY else ""
                lines.append(f"\n⚡ 已触发事件：{', '.join(events[:self._MAX_EVENT_DISPLAY])}{excess}")

        # LLM 压缩的对话摘要（章节结束时和超阈值时生成）
        if session.compressed_summaries:
            summaries = []
            for npc_id, summary in session.compressed_summaries.items():
                npc = session.npcs.get(npc_id)
                npc_name = npc.name if npc else npc_id
                summaries.append(f"- 与{npc_name}的过往对话摘要：{summary[:200]}")
            if summaries:
                lines.append(f"\n💬 历史对话摘要（AI 生成）：\n{chr(10).join(summaries)}")

        return "\n".join(lines)

    def _build_recent_dialogue(self, session: GameSession, npc_id: str) -> str:
        """构建当前章节的最近对话（内容截断 + 轮数控制）。

        只取当前章节的对话，避免跨章节「陌生人」对话污染。
        同时告知 LLM 如果前面还有更多轮对话。
        """
        if npc_id not in session.npcs:
            return ""

        npc = session.npcs[npc_id]
        current_ch_id = session.current_chapter_id

        # 过滤当前章节对话
        if current_ch_id:
            chapter_turns = [t for t in npc.dialogue_history
                            if getattr(t, 'chapter_id', '') == current_ch_id]
        else:
            chapter_turns = list(npc.dialogue_history)

        if not chapter_turns:
            # fallback：没有任何当前章节对话，用全部
            chapter_turns = list(npc.dialogue_history)[-self._MAX_DIALOGUE_HISTORY:]

        total_turns = len(chapter_turns)
        display_turns = chapter_turns[-self._MAX_DIALOGUE_HISTORY:]

        lines = [f"\n## 与 {npc.name} 的最近对话"]
        if total_turns > len(display_turns):
            skipped = total_turns - len(display_turns)
            lines.append(f"（前面还有 {skipped} 轮对话未显示）")

        for turn in display_turns:
            role_label = "玩家" if turn.role == "player" else npc.name
            content = turn.content[:self._MAX_DIALOGUE_CONTENT_LEN]
            if len(turn.content) > self._MAX_DIALOGUE_CONTENT_LEN:
                content += "…"
            lines.append(f"  {role_label}：{content}")

        return "\n".join(lines)

    @staticmethod
    def _describe_event(event_id: str) -> str:
        """将 event_id 映射为人类可读的叙事描述。

        用于叙事总览中的压缩展示。只映射已知的关键事件。
        """
        mapping = {
            "prologue_complete": "安葬父亲，离开墓地",
            "first_resonance": "在戏台体验到身体共鸣",
            "evidence_collected": "收集到关键证据和旧物",
            "memory_awakened": "记忆觉醒，想起自己是戏班神童",
            "decline_accepted": "认清戏班凋零的现实",
            "inheritance_accepted": "接受传承，决定继承戏班",
            "chen_tells_past": "陈师傅讲述了过去的故事",
            "xiaohua_trusts_player": "小华对你产生了信任",
        }
        return mapping.get(event_id, event_id)

    def _build_user(
        self, npc_id, npc_name, stage, session, player_message=None,
        is_ending=False, show_item_id=None, chapter=None,
    ) -> str:
        if player_message is None:
            intro = f"玩家「{session.player_name}」走到你面前，正要和你说话。请以 {npc_name} 的身份，主动说开场白。"
        else:
            intro = f"玩家「{session.player_name}」对你说：「{player_message}」"

        npc = session.npcs.get(npc_id)
        relationship = npc.relationship if npc else 0
        dialogue_rounds = len(npc.dialogue_history) // 2 if npc else 0

        if is_ending:
            options_instruction = "options 必须为空数组 []。只需给出自然得体的告别语。"
        else:
            options_instruction = "3-4 个自然的下一步对话选项。如果玩家要离开则 options 留空。"

        # 任务投票提示
        task_vote_hint = ""
        task = session.current_task
        if task and npc_id in task.related_npc_ids:
            # 检查是否有活跃子任务需要引导
            relevant_sts = [st for st in task.sub_tasks 
                           if self._is_npc_relevant(st, npc_id) and st.status != "completed"]
            st_hint = ""
            if relevant_sts:
                st_names = "、".join(st.title for st in relevant_sts[:3])
                st_hint = f"\n你当前需要玩家完成的子任务：{st_names}"
            
            dialogue_rounds_hint = ""
            if npc:
                dialogue_rounds_hint = f"\n当前已对话 {dialogue_rounds} 轮"
            
            task_vote_hint = f"""
## 任务进度投票（仅与你相关的子任务）
对话结束后，请在 task_progress 字段中判断你是否认为相关任务已完成：
- should_vote_complete: true/false（只有当对话内容确实推进了剧情、触发了关键信息交流时才投 true。闲聊、无关话题不算推进。）
- vote_reason: 用一句话说明投票理由，聚焦于「还缺什么」（如"关系不够熟络""对话太浅""子任务未完成"等）
- completed_sub_task_ids: 你认为已完成的子任务 ID 列表
{st_hint}{dialogue_rounds_hint}

### 🔑 关键：当你投反对票时的对话引导
如果 should_vote_complete = false，你必须在 dialogue_text 中自然地、含蓄地融入一句引导——
让玩家隐约感到「我们之间还差了点什么」，但不能直接说出游戏机制。

对照示例（请一定遵守这种分寸感）：
- ❌ 太直接："你需要提升和我的好感度" / "你还要多聊 3 轮才行"
- ✅ 含蓄引导：
  - 关系不够 → "我觉得咱俩还没那么熟，有些话不好说出口……"
  - 对话太浅 → "你每次来去匆匆，从没真的坐下来听过我的故事。"
  - 子任务未完 → "你答应我的事还没办呢，怎么就急着问别的了？"
  - 需要更多信息 → "有些事情你还没弄清楚，我不好替你做决定。"
  - 综合 → "人心都是处出来的。你若真想知道，就多陪陪我这把老骨头。"

核心：用 {npc_name} 的语气和性格来表达担心、保留或不信任，
让玩家自己去悟需要做什么。不要把"任务""投票""轮数"这些词说出口。
"""


        show_item_hint = ""
        if show_item_id:
            item = session.get_inventory_item(show_item_id)
            if item:
                knowledge = item.npc_knowledge.get(npc_id, "你不清楚这个东西。")
                show_item_hint = f"""
## 物品展示
玩家正在向你展示「{item.name}」。
物品描述：{item.get_display_text()}
你对这个物品的认知：{knowledge}
请在对话中自然地对这个物品做出反应。
"""

        # 叙事进度总结
        narrative_progress = self._build_narrative_progress(session, chapter)

        return f"""{intro}

{narrative_progress}当前章节：{chapter.get('name', '') if chapter else '未知'}（第{stage}阶段）
你与玩家的关系值：{relationship}
本轮已对话数：{dialogue_rounds} 轮

{self._build_round_limit_hint(npc_id, session)}
{show_item_hint}
{task_vote_hint}

【重要】你必须且只能输出一个合法 JSON 对象，不要输出任何其他文字、解释、markdown 标记。
直接输出 JSON，以 {{ 开头，以 }} 结尾：
{{
  "dialogue_text": "你作为 {npc_name} 的自然对话回应（2-5句）",
  "relationship_delta": 0,
  "options": ["选项1", "选项2", "选项3"],
  "should_trigger_event": false,
  "new_event": "",
  "task_progress": null
}}

字段说明：
- dialogue_text: 你对玩家说的话（直接写对话内容，不要包含动作描写或括号说明）
- relationship_delta: 本轮态度变化 [-5, 10]
- options: {options_instruction}
- should_trigger_event: 是否触发关键事件
- new_event: 事件 ID（如 "chen_tells_past"）
- task_progress: 任务进度投票结果（如你不参与当前任务则设为 null）

再次提醒：只输出 JSON，不要在 JSON 前后添加任何文字。
"""

    def _is_npc_relevant(self, st, npc_id: str) -> bool:
        return (st.target_npc_id == npc_id or
                st.deliver_to_npc_id == npc_id)

    @staticmethod
    def _get_chapter_attitude_guidance(chapter_id: str) -> str:
        """根据章节给出 NPC 对玩家的态度指引。

        随着剧情推进，NPC 对玩家的态度应有显著变化。
        这里提供硬编码的指引，确保跳章后 NPC 行为与叙事阶段匹配。
        """
        guidance_map = {
            "ch_prologue": "",
            "ch_01": """
### 🎭 NPC 态度指引
玩家刚来到小镇，是一个失去记忆的「外人」。戏班众人对你冷淡、疏离、略带警惕。
- 老周/小华：冷漠但有好奇，话不多
- 陈师傅：沉默寡言，但眼神复杂（他认识你父亲）
- 梅姨：客气但保持距离
- 老李：无所谓的态度""",
            "ch_02": """
### 🎭 NPC 态度指引
玩家已体验过「身体共鸣」的异样感，开始主动探索。戏班众人开始注意到你身上有熟悉的东西。
- 老周/小华：开始对你产生好奇，偶尔说漏嘴
- 陈师傅：开始试探你，但有所保留
- 梅姨：愿意和你聊聊镇上的往事
- 老李：提及你父亲时会沉默""",
            "ch_03": """
### 🎭 NPC 态度指引
这是关键转折章——玩家记忆觉醒，真相大白！NPC 的态度应发生根本性转变：
- 陈师傅：终于可以放下三十年的隐忍，情感爆发。说话不再遮遮掩掩，直接讲述你父亲和你的往事
- 老周：承认认识你，语气从敷衍变为愧疚和长辈的慈爱
- 梅姨：热泪盈眶，把你当自己的孩子看待
- 小华：对你的态度从"外人"变为"师兄/师姐"，语气尊重
- 老李：郑重地向你致敬，提及你父亲对他的恩情""",
            "ch_04": """
### 🎭 NPC 态度指引
记忆已恢复，你已是戏班「自己人」。NPC 不再对你隐瞒任何事，反而向你倾诉他们的困境。
- 陈师傅：把你视为戏班的希望，言语间充满期盼和担忧
- 老周：向你诉苦，讲述戏班如何一步步没落
- 梅姨：关心你的感受，担心你承受不了
- 小华：把你当作可以倾诉的知心人
- 老李：鼓励你，但也担心你从此被困住""",
            "ch_05": """
### 🎭 NPC 态度指引
终章！你决定继承戏班。所有 NPC 对你的态度应达到最高点：
- 陈师傅：如释重负、老泪纵横，正式交付传承信物
- 老周：欣慰、感动，表示愿意全力辅助你
- 梅姨：骄傲、不舍，像送别自己孩子一样叮嘱
- 小华：充满希望和干劲，愿意跟随你
- 老李：庄严郑重，说出肺腑之言""",
        }
        return guidance_map.get(chapter_id, "")

    @staticmethod
    def _build_narrative_progress(session: GameSession, chapter: dict) -> str:
        """构建一句简短的叙事提示（完整叙事总览在 System Prompt 中）。"""
        if not chapter:
            return ""
        completed_count = len([c for c in session.completed_chapters if c != chapter.get("id", "")])
        if completed_count == 0:
            return ""
        ch_names = []
        for cid in session.completed_chapters:
            for ch_def in session.chapter_defs:
                if ch_def.get("id") == cid and cid != chapter.get("id", ""):
                    ch_names.append(ch_def.get("name", cid))
        progress_hint = " → ".join(ch_names) if ch_names else f"已完成{completed_count}章"
        return f"📖 剧情已推进至「{chapter.get('name', '')}」（之前：{progress_hint}）。确保回应与当前阶段一致。\n"

    @staticmethod
    def _describe_relationship(value: int) -> str:
        if value <= -30: return "敌意"
        elif value < 0: return "冷淡"
        elif value < 30: return "中性"
        elif value < 70: return "友善"
        else: return "信任"

    @staticmethod
    def _build_round_limit_hint(npc_id: str, session: GameSession) -> str:
        from config import MAX_DIALOGUE_ROUNDS
        npc = session.npcs.get(npc_id)
        rounds = npc.dialogue_round_count if npc else 0
        if rounds >= MAX_DIALOGUE_ROUNDS:
            return "⚠️ 本轮对话已进行了多轮，请在本次回复中自然结束对话，options 留空 []。"
        elif rounds >= MAX_DIALOGUE_ROUNDS - 2:
            return "提示：对话已接近尾声，请在接下来的回复中逐步收尾。"
        return ""

    @staticmethod
    def is_conversation_ending(player_message: Optional[str]) -> bool:
        if not player_message:
            return False
        msg = player_message.strip()
        patterns = [
            "去找别人", "找别人", "去找其他人", "去找", "先走了",
            "我走了", "走了啊", "告辞", "再见", "拜拜", "下次再聊",
            "不打扰了", "你忙吧", "你忙", "我去找", "先这样",
            "就到这", "就到这儿", "回头再聊",
        ]
        return any(p in msg for p in patterns)

    # ─── 阶段判定 Prompt（兼容） ───────────────────────

    def build_stage_check_messages(self, session: GameSession) -> list[dict]:
        recent_dialogue = []
        for npc in session.npcs.values():
            if npc.dialogue_history:
                recent_dialogue.extend(npc.dialogue_history[-3:])
        dialogue_summary = ""
        for turn in recent_dialogue[-6:]:
            role_label = "玩家" if turn.role == "player" else "NPC"
            dialogue_summary += f"{role_label}：{turn.content[:100]}\n"
        rel_summary = ", ".join(f"{n.name}={n.relationship}" for n in session.npcs.values())

        stage = session.current_stage
        next_stage = stage + 1
        stage_names = {1: "不屑", 2: "了解", 3: "抉择"}
        current_name = stage_names.get(stage, f"第{stage}阶段")
        next_name = stage_names.get(next_stage, f"第{next_stage}阶段")

        # 收集关键事件摘要
        events_summary = ", ".join(sorted(session.events_triggered)) if session.events_triggered else "无"

        return [
            {"role": "system", "content": (
                "你是《梨园生死》游戏叙事引擎的阶段判定器。你的职责是判断玩家是否已经触发了足够的叙事进展，"
                "可以从当前阶段推进到下一阶段。"
            )},
            {"role": "user", "content": f"""
## 当前状态
- 当前阶段：第{stage}阶段「{current_name}」（{STAGE_LEGACY_MAP.get(stage, {}).get('description', '')}）
- 目标阶段：第{next_stage}阶段「{next_name}」（{STAGE_LEGACY_MAP.get(next_stage, {}).get('description', '')}）
- 当前章节：{session.current_chapter_id or '无'}
- 各 NPC 关系值：{rel_summary}
- 已触发关键事件：{events_summary}

## 最近对话摘要
{dialogue_summary or '（尚无对话）'}

## 判定标准
你需要判断是否应该推进到第{next_stage}阶段。推进的核心理由是：
**玩家已经在叙事上跨过了一个有意义的门槛**——比如发现了关键线索、与 NPC 建立了实质性关系、或者触发了改变局势的事件。

### 应该推进（should_advance = true）的情况：
- 对话中出现了关键信息揭示（如 NPC 透露了过去的秘密、戏班的历史等）
- 多个 NPC 对玩家的态度发生了明显转变（从冷眼到愿意交流）
- 触发了命名事件（如 "chen_tells_past"、"xiaohua_trusts_player" 等）
- 玩家展示了重要物品并引发了 NPC 的强烈反应

### 不应推进（should_advance = false）的情况：
- 对话以闲聊为主，没有推进任何剧情线
- NPC 仍然对玩家保持距离或敌意
- 没有关键事件被触发
- 对话内容停留在表面，没有触及核心矛盾（失忆、传承、故乡）

## 输出
直接输出合法 JSON，不要 markdown 代码块标记，不要在 JSON 前后添加任何文字或解释：

{{
  "should_advance": false,
  "reason": "用一句话说明判定的叙事依据（如'对话触及了戏班往事，NPC态度开始松动'或'对话停留在寒暄层面，缺乏实质推进'）"
}}

注意：判定应当保守。除非有明显的叙事进展，否则默认不推进。"""},
        ]

    # ─── 结局评价 Prompt（兼容） ───────────────────────

    def build_evaluate_messages(self, session: GameSession) -> list[dict]:
        evaluate_path = os.path.join(_PROMPTS_DIR, "evaluate.txt")
        if os.path.exists(evaluate_path):
            with open(evaluate_path, "r", encoding="utf-8") as f:
                template = f.read()
        else:
            template = "请为以下游戏会话生成结局评价 JSON。"

        chapter = session.get_current_chapter()
        stage_name = chapter.get("name", "未知") if chapter else str(session.current_stage)

        npc_relationships = ", ".join(
            f"{n.name}({n.id})={n.relationship}" for n in session.npcs.values()
        )
        dialogue_summary = ""
        for npc in session.npcs.values():
            if npc.dialogue_history:
                for turn in npc.dialogue_history[-3:]:
                    role = "玩家" if turn.role == "player" else npc.name
                    dialogue_summary += f"{role}：{turn.content[:80]}\n"

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
            {"role": "system", "content": "你是叙事评论家，只输出合法 JSON，不要任何 markdown 标记或额外文字。"},
            {"role": "user", "content": prompt},
        ]

    # ─── 流式结局 Header Prompt ────────────────────────

    def build_evaluate_header_messages(self, session: GameSession) -> list[dict]:
        header_path = os.path.join(_PROMPTS_DIR, "evaluate_header.txt")
        if os.path.exists(header_path):
            with open(header_path, "r", encoding="utf-8") as f:
                template = f.read()
        else:
            template = "请为以下游戏会话生成结局评价 JSON（只含标题/总结/关键瞬间/感悟）。"

        chapter = session.get_current_chapter()
        stage_name = chapter.get("name", "未知") if chapter else str(session.current_stage)

        npc_relationships = ", ".join(
            f"{n.name}({n.id})={n.relationship}" for n in session.npcs.values()
        )
        dialogue_summary = ""
        for npc in session.npcs.values():
            if npc.dialogue_history:
                for turn in npc.dialogue_history[-3:]:
                    role = "玩家" if turn.role == "player" else npc.name
                    dialogue_summary += f"{role}：{turn.content[:80]}\n"

        prompt = template.format(
            player_name=session.player_name,
            ending_type=session.ending_type or "default_ending",
            npc_relationships=npc_relationships,
            key_events=", ".join(sorted(session.events_triggered)) if session.events_triggered else "无",
            dialogue_summary=dialogue_summary or "（尚无对话）",
        )
        return [
            {"role": "system", "content": "你是叙事评论家，只输出合法 JSON，不要任何 markdown 标记或额外文字。请只返回标题、总结、关键瞬间和人生感悟，不要包含 NPC 结局。"},
            {"role": "user", "content": prompt},
        ]

    # ─── 流式结局 单 NPC Prompt ────────────────────────

    def build_evaluate_npc_messages(self, session: GameSession, npc_id: str) -> list[dict]:
        npc = session.npcs.get(npc_id)
        if not npc:
            return []

        npc_path = os.path.join(_PROMPTS_DIR, "evaluate_npc.txt")
        if os.path.exists(npc_path):
            with open(npc_path, "r", encoding="utf-8") as f:
                template = f.read()
        else:
            template = "请为 NPC {npc_name} 生成结局描述 JSON。"

        dialogue_sample = ""
        if npc.dialogue_history:
            for turn in npc.dialogue_history[-5:]:
                role = "玩家" if turn.role == "player" else npc.name
                dialogue_sample += f"{role}：{turn.content[:80]}\n"

        prompt = template.format(
            npc_id=npc_id,
            npc_name=npc.name,
            npc_role=npc.role,
            final_relationship=npc.relationship,
            dialogue_sample=dialogue_sample or "（无对话）",
        )
        return [
            {"role": "system", "content": "你是叙事评论家，只输出合法 JSON，不要任何 markdown 标记或额外文字。为单个 NPC 生成结局描述。"},
            {"role": "user", "content": prompt},
        ]

    # ─── 任务投票检查 Prompt ────────────────────────────

    def build_task_vote_messages(self, session: GameSession, npc_id: str,
                                  recent_dialogue: str) -> list[dict]:
        npc = session.npcs.get(npc_id)
        if not npc or not session.current_task:
            return []

        task = session.current_task
        relevant = [st for st in task.sub_tasks if self._is_npc_relevant(st, npc_id)]

        import os
        vote_path = os.path.join(_PROMPTS_DIR, "task_vote_check.txt")
        if os.path.exists(vote_path):
            with open(vote_path, "r", encoding="utf-8") as f:
                template = f.read()
        else:
            template = "判断 {npc_name} 是否认为任务已完成。输出 JSON。"

        st_info = ""
        for st in relevant:
            status = st.status
            st_info += f"  [{status}] {st.title}（{st.mode}）\n"

        prompt = template.format(
            npc_name=npc.name,
            task_description=task.description,
            relevant_sub_tasks=st_info or "  （无相关子任务）",
            relationship=npc.relationship,
            recent_dialogue=recent_dialogue or "（无对话）",
        )
        return [
            {"role": "system", "content": "你是任务进度评估器，只输出合法 JSON，不要任何 markdown 标记或额外文字。"},
            {"role": "user", "content": prompt},
        ]
