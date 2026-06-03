"""
双模阶段切换引擎。

规则：
  1. 规则检测（O(1) 内存查表）— 确定性护栏，命中立即切换
  2. LLM 独立判定 — 单轮即可推进，每次对话后 LLM 独立判断
"""

import logging
from dataclasses import dataclass

from state.session import GameSession
from config import STAGE_RULES, STAGES

logger = logging.getLogger(__name__)


@dataclass
class StageCheckResult:
    """阶段判定结果。"""
    stage_changed: bool = False
    new_stage: int = 0
    reason: str = ""
    triggered_by: str = ""  # "rule" | "llm" | "none"


class StageEngine:
    """阶段切换引擎。"""

    def __init__(self, llm_client, prompt_builder):
        self.llm = llm_client
        self.prompt_builder = prompt_builder

    async def check_stage_advance(self, session: GameSession) -> StageCheckResult:
        """
        双模阶段判定，按优先级：
          1. 规则检测 → 命中立即返回
          2. LLM 判定 → 单轮即可推进
          3. 否则不切换
        """
        if session.game_ended:
            return StageCheckResult()

        if session.current_stage >= max(STAGES.keys()):
            return StageCheckResult()

        # ─── 1. 规则检测 ───────────────────────────
        next_stage = session.current_stage + 1
        rules = STAGE_RULES.get(session.current_stage, {})

        rule_hit = False
        rule_reason = ""

        # 关系值检测
        min_rel = rules.get("min_relationship")
        if min_rel is not None:
            for npc in session.npcs.values():
                if npc.relationship >= min_rel:
                    rule_hit = True
                    rule_reason = f"{npc.name} 关系值达到 {npc.relationship}（阈值 {min_rel}）"
                    break

        # 关键事件检测
        key_events = rules.get("key_events", set())
        triggered = key_events & session.events_triggered
        if triggered:
            rule_hit = True
            event_name = next(iter(triggered))
            rule_reason = f"触发关键事件: {event_name}"

        # 最少对话轮数检测（附加条件）
        min_rounds = rules.get("min_dialogue_rounds", 0)
        if rule_hit and min_rounds > 0:
            total_rounds = sum(
                len(npc.dialogue_history) // 2
                for npc in session.npcs.values()
            )
            if total_rounds < min_rounds:
                rule_hit = False
                rule_reason = ""

        if rule_hit and next_stage in STAGES:
            logger.info(f"[StageEngine] Rule triggered: {rule_reason}")
            return StageCheckResult(
                stage_changed=True,
                new_stage=next_stage,
                reason=rule_reason,
                triggered_by="rule",
            )

        # ─── 2. LLM 判定 ───────────────────────────
        if session.stage_llm_consecutive < 1:
            return StageCheckResult()

        # LLM 独立判定
        try:
            messages = self.prompt_builder.build_stage_check_messages(session)
            result = await self.llm.chat_json(messages, api_key=session.api_key, temperature=0.3)
        except Exception as e:
            logger.warning(f"[StageEngine] LLM stage check failed: {e}")
            return StageCheckResult()

        should_advance = result.get("should_advance", False)

        if should_advance:
            session.stage_llm_consecutive += 1
        else:
            session.stage_llm_consecutive = 0

        if session.stage_llm_consecutive >= 1 and next_stage in STAGES:
            reason = result.get("reason", "LLM 判定单轮推进")
            logger.info(f"[StageEngine] LLM triggered: {reason}")
            return StageCheckResult(
                stage_changed=True,
                new_stage=next_stage,
                reason=reason,
                triggered_by="llm",
            )

        return StageCheckResult()

    def apply_stage_change(self, session: GameSession, result: StageCheckResult) -> None:
        """执行阶段切换：更新 session 阶段、刷新 NPC 问候语。"""
        if not result.stage_changed:
            return

        old_stage = session.current_stage
        session.current_stage = result.new_stage
        session.stage_llm_consecutive = 0

        new_params = STAGES.get(result.new_stage, {})
        logger.info(
            f"[StageEngine] Stage changed: {old_stage} → {result.new_stage} "
            f"({new_params.get('name')}) reason={result.reason}"
        )

        # 刷新 NPC 问候语（使用新阶段的 greeting）
        from config import NPC_DEFS
        for npc in session.npcs.values():
            npc.current_greeting = self._stage_greeting(npc.id, result.new_stage)

        # 持久化
        from state.manager import get_session_manager
        manager = get_session_manager()
        manager.persist_session(session)
        # 记录阶段切换历史
        manager.persist_stage_history(
            session, old_stage, result.new_stage,
            reason=f"{result.triggered_by}: {result.reason}",
        )

    def _stage_greeting(self, npc_id: str, stage: int) -> str:
        """根据阶段返回 NPC 问候语。"""
        # 优先从 persona YAML 读，fallback 到硬编码
        import yaml, os
        mapping = {
            "npc_chen": "chen_shifu.yaml",
            "npc_xiaohua": "xiaohua.yaml",
        }
        filename = mapping.get(npc_id)
        if filename:
            path = os.path.join(
                os.path.dirname(os.path.dirname(__file__)),
                "agents", "personas", filename
            )
            if os.path.exists(path):
                with open(path, "r", encoding="utf-8") as f:
                    data = yaml.safe_load(f)
                stages = data.get("stage_attitudes", {})
                attitude = stages.get(f"stage_{stage}", {})
                if "greeting" in attitude:
                    return attitude["greeting"]

        # fallback
        greetings = {
            "npc_chen": {1: "……（低头擦琴，仿佛没看见你）", 2: "来了啊？坐吧。", 3: "我等这天等太久了……"},
            "npc_xiaohua": {1: "你也是来看笑话的吗？", 2: "又来啦？真拿你没办法……", 3: "我就知道你今天会来。"},
        }
        return greetings.get(npc_id, {}).get(stage, "…")
