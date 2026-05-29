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

        # 3. 章节上下文
        if chapter:
            parts.append(f"""
## 当前章节：{chapter.get('name', '')}
{chapter.get('description', '')}
""")

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

    def _build_state_context(self, session: GameSession, current_npc_id: str) -> str:
        lines = ["\n## 游戏全局状态"]

        # 关系值
        lines.append("玩家与各NPC的关系：")
        for npc in session.npcs.values():
            rel_desc = self._describe_relationship(npc.relationship)
            lines.append(f"  - {npc.name}：{npc.relationship}（{rel_desc}）")

        # 当前任务
        task = session.current_task
        if task:
            lines.append(f"\n当前任务：{task.description}")
            lines.append(f"任务进度：{int(task.completion_rate * 100)}%")
            # 只显示与此 NPC 相关的子任务
            relevant = [st for st in task.sub_tasks if self._is_npc_relevant(st, current_npc_id)]
            if relevant:
                lines.append("你需要关注的子任务：")
                for st in relevant:
                    status_icon = {"locked": "🔒", "active": "⬜",
                                   "in_progress": "🔄", "completed": "✅"
                                   }.get(st.status, "?")
                    lines.append(f"  [{status_icon}] {st.title}（{st.mode}）")

        # 物品
        if session.inventory:
            inv_names = [i.name for i in session.inventory]
            lines.append(f"\n玩家持有的物品：{', '.join(inv_names)}")
            if session.active_item:
                item = session.get_inventory_item(session.active_item)
                if item:
                    lines.append(f"\n>>> 玩家正在展示：{item.name} <<<")
                    lines.append(f"物品描述：{item.get_display_text()}")
                    if current_npc_id in item.npc_knowledge:
                        lines.append(f"你对这个物品的认知：{item.npc_knowledge[current_npc_id]}")

        # 已触发事件
        if session.events_triggered:
            lines.append(f"\n已触发事件：{', '.join(sorted(session.events_triggered))}")

        # 对话历史
        if current_npc_id in session.npcs:
            hist = session.npcs[current_npc_id].dialogue_history
            if hist:
                lines.append(f"\n与 {session.npcs[current_npc_id].name} 的最近对话：")
                for turn in hist[-5:]:
                    role_label = "玩家" if turn.role == "player" else session.npcs[current_npc_id].name
                    lines.append(f"  {role_label}：{turn.content[:120]}")

        return "\n".join(lines)

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
            task_vote_hint = """
## 任务进度投票（仅与你相关的子任务）
对话结束后，请在 task_progress 字段中判断你是否认为相关任务已完成：
- should_vote_complete: true/false（只有当对话内容确实推进了剧情、触发了关键信息交流时才投 true。闲聊、无关话题不算推进。）
- vote_reason: 一句话说明
- completed_sub_task_ids: 你认为已完成的子任务 ID 列表
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

        return f"""{intro}

当前章节：{chapter.get('name', '') if chapter else '未知'}（第{stage}阶段）
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
        return [
            {"role": "system", "content": "你是一个游戏叙事引擎的阶段判定器。"},
            {"role": "user", "content": f"""
当前阶段：第{session.current_stage}阶段
各NPC关系值：{rel_summary}
最近对话摘要：
{dialogue_summary or '（尚无对话）'}
请判断是否应该推进到下一阶段。输出 JSON：
{{"should_advance": false, "reason": ""}}
"""},
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
            {"role": "system", "content": "你是叙事评论家，生成结局评价 JSON。"},
            {"role": "user", "content": prompt},
        ]

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
            {"role": "system", "content": "你是任务进度评估器，始终输出合法 JSON。"},
            {"role": "user", "content": prompt},
        ]
