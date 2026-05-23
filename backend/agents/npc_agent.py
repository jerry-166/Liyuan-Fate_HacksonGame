"""
NPC Agent 核心逻辑。

职责：
  - 调用 PromptBuilder 拼装消息
  - 调用 LLMClient 流式生成
  - 调用 ResponseParser 解析结构化结果
  - 更新关系值、触发事件、判定阶段
"""

import logging
from typing import Optional, AsyncIterator

from state.session import GameSession
from agents.prompt_builder import PromptBuilder
from agents.response_parser import parse_dialogue_response, DialogueResult
from llm.client import LLMClient

logger = logging.getLogger(__name__)


class NPCAgent:
    """
    单个 NPC 的对话 Agent。

    MVP 设计：一个 NPCAgent 实例绑定一个 NPC，但可以处理其全部对话。
    """

    def __init__(self, llm_client: LLMClient, prompt_builder: PromptBuilder):
        self.llm = llm_client
        self.prompt_builder = prompt_builder

    async def generate_dialogue(
        self,
        session: GameSession,
        npc_id: str,
        player_message: Optional[str] = None,
    ) -> AsyncIterator[tuple[str, DialogueResult]]:
        """
        生成 NPC 对话（流式）。

        Yields:
            ("token", DialogueResult()) — 流中每个 token
            ("done",  DialogueResult()) — 完成后，附带解析结果

        用法:
            async for event_type, data in agent.generate_dialogue(session, npc_id, msg):
                if event_type == "token":
                    yield to_sse("delta", data)   # data is str
                elif event_type == "done":
                    yield to_sse("done", data)    # data is DialogueResult
        """
        npc = session.npcs.get(npc_id)
        if not npc:
            raise ValueError(f"NPC not found: {npc_id}")
        if not npc.is_available:
            raise ValueError(f"NPC not available: {npc_id}")

        # 检测玩家是否要结束对话（代码级检测 + 传给 prompt）
        is_ending = PromptBuilder.is_conversation_ending(player_message)

        # 1. 构建 messages
        messages = self.prompt_builder.build_dialogue_messages(
            session, npc_id, player_message, is_ending=is_ending
        )

        # 2. 流式调用 LLM
        full_text = ""
        api_key = session.api_key
        async for token in self.llm.chat_stream(messages, api_key=api_key):
            full_text += token
            yield ("token", token)

        # 3. 解析结构化结果
        result = parse_dialogue_response(full_text)

        # 4. 应用结果到会话状态
        self._apply_result(session, npc_id, result, player_message, full_text)

        yield ("done", result)

    def _apply_result(
        self,
        session: GameSession,
        npc_id: str,
        result: DialogueResult,
        player_message: Optional[str],
        full_text: str,
    ) -> None:
        """将 LLM 响应结果应用到游戏会话状态。"""
        from state.manager import get_session_manager
        from state.session import DialogueTurn
        manager = get_session_manager()

        npc = session.npcs[npc_id]

        # 记录玩家消息到对话历史
        if player_message:
            npc.dialogue_history.append(DialogueTurn(
                role="player",
                content=player_message,
                npc_id=npc_id,
                stage=session.current_stage,
            ))
            manager.persist_dialogue(session, npc_id, "player", player_message)

        # 记录 NPC 回复
        reply_text = result.dialogue_text or full_text
        npc.dialogue_history.append(DialogueTurn(
            role="npc",
            content=reply_text,
            npc_id=npc_id,
            stage=session.current_stage,
        ))
        manager.persist_dialogue(session, npc_id, "npc", reply_text)

        # 更新关系值
        delta = result.relationship_delta
        if delta == 0:
            # 兜底：每轮 +3
            from config import RELATIONSHIP_DEFAULT_DELTA
            delta = RELATIONSHIP_DEFAULT_DELTA
        npc.apply_delta(delta)

        # 更新 NPC 问候语（用回复的摘要作新问候语）
        short_reply = reply_text[:50].replace("\n", " ")
        npc.current_greeting = short_reply + ("……" if len(reply_text) > 50 else "")

        # 处理事件触发
        if result.should_trigger_event and result.new_event:
            event_id = result.new_event.strip()
            if event_id and event_id not in session.events_triggered:
                session.events_triggered.add(event_id)
                manager.persist_event(
                    session, event_id,
                    f"{npc.name}在对话中触发了事件",
                    triggered_by_npc=npc_id,
                )
                # 事件奖励关系值
                from config import RELATIONSHIP_EVENT_BONUS
                npc.apply_delta(RELATIONSHIP_EVENT_BONUS)
                logger.info(f"[Agent] Event triggered: {event_id} by {npc_id}")

        # 阶段判定（LLM 建议）
        if result.stage_should_advance:
            session.stage_llm_consecutive += 1
        else:
            session.stage_llm_consecutive = 0

        # 持久化
        manager.persist_session(session)


class AgentOrchestrator:
    """
    Agent 编排器 — 协调多 NPC 对话 + 阶段切换 + 结局判定。
    """

    def __init__(self, llm_client: LLMClient, prompt_builder: PromptBuilder):
        self.agent = NPCAgent(llm_client, prompt_builder)
        self.llm = llm_client
        self.prompt_builder = prompt_builder

    async def dialogue_stream(
        self,
        session: GameSession,
        npc_id: str,
        player_message: Optional[str] = None,
    ):
        """
        对话流式生成（整合阶段切换判定）。

        在 done 事件之前，自动运行规则+LLM 阶段判定，
        将 stage_changed 和 new_stage 注入 done 数据。
        """
        from state.stage_engine import StageEngine
        stage_engine = StageEngine(self.llm, self.prompt_builder)

        async for event_type, data in self.agent.generate_dialogue(
            session, npc_id, player_message
        ):
            if event_type == "token":
                yield ("token", data)
            elif event_type == "done":
                # 对话完成后 → 运行阶段判定
                stage_result = await stage_engine.check_stage_advance(session)
                yield ("done", {
                    "result": data,
                    "stage": stage_result,
                })
