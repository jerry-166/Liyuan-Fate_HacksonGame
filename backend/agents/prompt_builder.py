"""
Prompt 拼装器。

职责：根据会话状态 + NPC 人设卡 → 拼接完整的 System Prompt + User Message。
"""

import os
import logging
from typing import Optional

import yaml

from state.session import GameSession

logger = logging.getLogger(__name__)

# personas 目录
_PERSONAS_DIR = os.path.join(os.path.dirname(__file__), "personas")
_PROMPTS_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "prompts")

# 缓存
_personas_cache: dict[str, dict] = {}
_system_base_cache: Optional[str] = None


def _load_persona(npc_id: str) -> dict:
    """加载 NPC 人设卡（YAML），会缓存。"""
    if npc_id in _personas_cache:
        return _personas_cache[npc_id]

    mapping = {
        "npc_chen": "chen_shifu.yaml",
        "npc_xiaohua": "xiaohua.yaml",
    }
    filename = mapping.get(npc_id)
    if not filename:
        logger.warning(f"[PromptBuilder] No persona file for npc_id={npc_id}")
        return {}

    path = os.path.join(_PERSONAS_DIR, filename)
    if not os.path.exists(path):
        logger.warning(f"[PromptBuilder] Persona file not found: {path}")
        return {}

    with open(path, "r", encoding="utf-8") as f:
        data = yaml.safe_load(f)
    _personas_cache[npc_id] = data
    return data


def _load_system_base() -> str:
    """加载世界观 System Prompt 模板。"""
    global _system_base_cache
    if _system_base_cache is not None:
        return _system_base_cache

    path = os.path.join(_PROMPTS_DIR, "system_base.txt")
    if not os.path.exists(path):
        logger.warning(f"[PromptBuilder] System base template not found: {path}")
        _system_base_cache = ""
        return ""

    with open(path, "r", encoding="utf-8") as f:
        _system_base_cache = f.read()
    return _system_base_cache


class PromptBuilder:
    """
    NPC 对话 Prompt 拼装器。

    输出两层 messages：
      1. system: NPC 人设 + 世界观 + 全局状态
      2. user:   当前对话上下文 + 玩家消息 + 输出格式指令
    """

    def __init__(self):
        self._base = _load_system_base()

    def build_dialogue_messages(
        self,
        session: GameSession,
        npc_id: str,
        player_message: Optional[str] = None,
        is_ending: bool = False,
    ) -> list[dict]:
        """
        构建用于 LLM 对话的 messages 数组。

        Args:
            session: 当前游戏会话
            npc_id: 目标 NPC ID
            player_message: 玩家输入文本，None 表示首轮对话
            is_ending: True 表示玩家明确要结束对话，不应生成 options

        Returns:
            [{"role": "system", "content": "..."}, {"role": "user", "content": "..."}]
        """
        persona = _load_persona(npc_id)
        npc = session.npcs.get(npc_id)
        if not npc:
            raise ValueError(f"NPC not found: {npc_id}")

        stage = session.current_stage

        # ─── System Prompt ───────────────────────────
        system_content = self._build_system(npc_id, persona, npc.name, stage, session)

        # ─── User Message ────────────────────────────
        user_content = self._build_user(
            npc_id, npc.name, stage, session, player_message, is_ending=is_ending
        )

        return [
            {"role": "system", "content": system_content},
            {"role": "user", "content": user_content},
        ]

    def _build_system(
        self, npc_id: str, persona: dict, npc_name: str, stage: int, session: GameSession
    ) -> str:
        """构建 System Prompt。"""
        from config import STAGES
        stage_params = STAGES.get(stage, STAGES[1])

        parts = []

        # 1. 世界观基础
        if self._base:
            parts.append(self._base.replace("{npc_name}", npc_name))

        # 2. NPC 人设卡
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

        # 3. 当前阶段对应的态度
        stage_attitudes = persona.get("stage_attitudes", {})
        current_attitude = stage_attitudes.get(f"stage_{stage}", {})
        parts.append(f"""
## 当前阶段：{stage_params['name']} — 「{stage_params['description']}」
- 对话基调：{current_attitude.get('tone', stage_params['dialogue_tone'])}
- 你对玩家的态度：{current_attitude.get('typical_line', '')}
""")

        # 4. 全局状态注入
        parts.append(self._build_state_context(session, npc_id))

        # 5. 对话风格示例
        examples = persona.get("dialogue_examples", [])
        if examples:
            parts.append("\n## 对话风格参考")
            for ex in examples[:3]:
                parts.append(f"- 玩家：「{ex.get('player', '')}」\n  你：「{ex.get('npc', '')}」")

        return "\n".join(parts)

    def _build_state_context(self, session: GameSession, current_npc_id: str) -> str:
        """构建全局状态上下文注入。"""
        lines = ["\n## 游戏全局状态"]

        # 关系值
        lines.append("玩家与各NPC的关系：")
        for npc in session.npcs.values():
            rel_desc = self._describe_relationship(npc.relationship)
            lines.append(f"  - {npc.name}：{npc.relationship}（{rel_desc}）")

        # 已触发事件
        if session.events_triggered:
            lines.append(f"\n已触发的关键事件：{', '.join(sorted(session.events_triggered))}")

            # Handoff：检测跨 NPC 事件
            other_npc_events = []
            for evt in session.events_triggered:
                # 事件与当前 NPC 相关 → 不应注入（它自己触发的，已知道）
                # 事件与当前 NPC 无关 → 可能涉及跨 NPC 剧情衔接
                if current_npc_id not in evt:
                    other_npc_events.append(evt)

            if other_npc_events:
                lines.append(f"\n[跨NPC事件] 以下事件已由其他NPC触发，你可以据此调整回应：")
                for evt in other_npc_events:
                    lines.append(f"  - {evt}")

        # 对话历史（最近 5 轮）
        if current_npc_id in session.npcs:
            hist = session.npcs[current_npc_id].dialogue_history
            if hist:
                lines.append(f"\n与 {session.npcs[current_npc_id].name} 的最近对话：")
                for turn in hist[-5:]:
                    role_label = "玩家" if turn.role == "player" else session.npcs[current_npc_id].name
                    lines.append(f"  {role_label}：{turn.content[:120]}")

        return "\n".join(lines)

    def _build_user(
        self,
        npc_id: str,
        npc_name: str,
        stage: int,
        session: GameSession,
        player_message: Optional[str] = None,
        is_ending: bool = False,
    ) -> str:
        """构建 User Message（含输出格式指令）。"""
        from config import STAGES
        stage_params = STAGES.get(stage, STAGES[1])

        if player_message is None:
            intro = f"玩家「{session.player_name}」走到你面前，正要和你说话。请以 {npc_name} 的身份，根据当前阶段的态度，主动说开场白。"
        else:
            intro = f"玩家「{session.player_name}」对你说：「{player_message}」"

        # 关系值
        npc = session.npcs.get(npc_id)
        relationship = npc.relationship if npc else 0

        # 对话轮数统计
        dialogue_rounds = len(npc.dialogue_history) // 2 if npc else 0

        # 根据是否结束对话，给不同的 options 指令
        if is_ending:
            options_instruction = (
                "玩家明确要结束这场对话（例如去找别人、先走了、下次再聊等），"
                "所以 options 必须为空数组 []。只需给出自然得体的告别语，不要提供任何后续话题选项。"
            )
        else:
            options_instruction = (
                "3-4 个自然的下一步对话选项（让玩家选一个继续说）。"
                "注意：如果玩家明确表达了要离开、去找其他NPC、或结束对话的意图，options 应为空数组 []。"
            )

        return f"""{intro}

当前阶段：{stage_params['name']}（第{stage}阶段）
你与玩家的关系值：{relationship}
本轮已对话数：{dialogue_rounds} 轮

请以 JSON 格式输出你的回应，格式如下（不要包含 markdown 代码块标记）：
{{
  "dialogue_text": "你作为 {npc_name} 的自然对话回应（2-5句，保持角色风格）",
  "relationship_delta": 0,
  "options": ["选项1文本", "选项2文本", "选项3文本"],
  "should_trigger_event": false,
  "new_event": "",
  "stage_should_advance": false,
  "advance_reason": ""
}}

字段说明：
- dialogue_text: 你对玩家说的话
- relationship_delta: 本轮对话你的态度改变程度，范围 [-5, 10]，正值表示态度改善
- options: {options_instruction}
- should_trigger_event: 本对话是否触发了一个关键剧情事件（如"陈师傅提到往事"）
- new_event: 若触发事件，事件ID（如 "chen_tells_past"），否则留空
- stage_should_advance: 对话是否应该推进到下一阶段
- advance_reason: 推进理由（若 stage_should_advance=true）
"""  # noqa: E501

    @staticmethod
    def _describe_relationship(value: int) -> str:
        if value <= -30:
            return "敌意"
        elif value < 0:
            return "冷淡"
        elif value < 30:
            return "中性"
        elif value < 70:
            return "友善"
        else:
            return "信任"

    @staticmethod
    def is_conversation_ending(player_message: Optional[str]) -> bool:
        """检测玩家消息是否明确要结束当前对话（代码级兜底）。"""
        if not player_message:
            return False
        msg = player_message.strip()
        ending_patterns = [
            "去找别人", "找别人", "去找其他人", "找其他人",
            "去找", "先走了", "我走了", "走了啊", "告辞",
            "再见", "拜拜", "下次再聊", "下次见", "回头再聊",
            "不打扰了", "不打扰", "你忙吧", "你忙",
            "我去找", "我要去",
            "先这样", "就到这", "就到这儿",
        ]
        return any(p in msg for p in ending_patterns)

    # ─── 阶段判定 Prompt ───────────────────────────────

    def build_stage_check_messages(self, session: GameSession) -> list[dict]:
        """构建阶段判定 LLM 调用的 messages。"""
        from config import STAGES
        stage_params = STAGES.get(session.current_stage, STAGES[1])

        recent_dialogue = []
        for npc in session.npcs.values():
            if npc.dialogue_history:
                recent_dialogue.extend(npc.dialogue_history[-3:])

        dialogue_summary = ""
        for turn in recent_dialogue[-6:]:
            role_label = "玩家" if turn.role == "player" else "NPC"
            dialogue_summary += f"{role_label}：{turn.content[:100]}\n"

        rel_summary = ", ".join(
            f"{n.name}={n.relationship}" for n in session.npcs.values()
        )

        return [
            {"role": "system", "content": "你是一个游戏叙事引擎的阶段判定器。根据当前状态判断游戏是否应该推进到下一阶段。"},
            {"role": "user", "content": f"""
当前阶段：第{session.current_stage}阶段「{stage_params['name']}」
各NPC关系值：{rel_summary}
已触发事件：{', '.join(sorted(session.events_triggered)) if session.events_triggered else '无'}
最近对话摘要：
{dialogue_summary if dialogue_summary else '（尚无对话）'}

请判断是否应该推进到下一阶段。输出 JSON：
{{"should_advance": false, "reason": ""}}
"""},
        ]

    # ─── 结局评价 Prompt ───────────────────────────────

    def build_evaluate_messages(self, session: GameSession) -> list[dict]:
        """构建结局评价 LLM 调用的 messages。"""
        import os
        from config import STAGES

        stage_params = STAGES.get(session.current_stage, STAGES[1])

        # 加载 evaluate 模板
        evaluate_path = os.path.join(_PROMPTS_DIR, "evaluate.txt")
        if os.path.exists(evaluate_path):
            with open(evaluate_path, "r", encoding="utf-8") as f:
                template = f.read()
        else:
            template = "请为以下游戏会话生成结局评价 JSON。"

        npc_relationships = ", ".join(
            f"{n.name}({n.id})={n.relationship}"
            for n in session.npcs.values()
        )

        # 收集对话摘要
        dialogue_summary = ""
        for npc in session.npcs.values():
            if npc.dialogue_history:
                for turn in npc.dialogue_history[-3:]:
                    role = "玩家" if turn.role == "player" else npc.name
                    dialogue_summary += f"{role}：{turn.content[:80]}\n"

        prompt = template.format(
            player_name=session.player_name,
            current_stage=session.current_stage,
            stage_name=stage_params["name"],
            ending_type=session.ending_type or "default_ending",
            npc_relationships=npc_relationships,
            key_events=", ".join(sorted(session.events_triggered)) if session.events_triggered else "无",
            dialogue_summary=dialogue_summary or "（尚无对话记录）",
        )

        return [
            {"role": "system", "content": "你是一位叙事评论家，为玩家生成个性化的结局评价。始终输出合法 JSON。"},
            {"role": "user", "content": prompt},
        ]
