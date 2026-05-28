"""
NPC Agent 核心逻辑 — v2 集成任务投票 + 章节推进。
"""

import json
import logging
import re
from typing import Optional, AsyncIterator

from state.session import GameSession, DialogueTurn
from agents.prompt_builder import PromptBuilder
from agents.response_parser import parse_dialogue_response, DialogueResult
from llm.client import LLMClient

logger = logging.getLogger(__name__)


def _extract_dialogue_partial(text: str):
    pattern = r'"dialogue_text"\s*:\s*"'
    m = re.search(pattern, text)
    if not m:
        return ""
    start = m.end()
    result = []
    i = start
    while i < len(text):
        if text[i] == '\\' and i + 1 < len(text):
            next_char = text[i + 1]
            escape_map = {'n': '\n', 't': '\t', 'r': '\r', '"': '"', '\\': '\\', '/': '/'}
            result.append(escape_map.get(next_char, next_char))
            i += 2
        elif text[i] == '"':
            break
        else:
            result.append(text[i])
            i += 1
    return ''.join(result)


class NPCAgent:

    def __init__(self, llm_client: LLMClient, prompt_builder: PromptBuilder):
        self.llm = llm_client
        self.prompt_builder = prompt_builder

    async def generate_dialogue(
        self,
        session: GameSession,
        npc_id: str,
        player_message: Optional[str] = None,
        show_item_id: Optional[str] = None,
    ) -> AsyncIterator[tuple[str, DialogueResult]]:
        npc = session.npcs.get(npc_id)
        if not npc:
            raise ValueError(f"NPC not found: {npc_id}")
        if not npc.is_available:
            raise ValueError(f"NPC not available: {npc_id}")

        is_ending = PromptBuilder.is_conversation_ending(player_message)

        messages = self.prompt_builder.build_dialogue_messages(
            session, npc_id, player_message, is_ending=is_ending,
            show_item_id=show_item_id,
        )

        full_text = ""
        prev_dialogue_len = 0
        api_key = session.api_key

        async for token in self.llm.chat_stream(messages, api_key=api_key):
            full_text += token
            current_dialogue = _extract_dialogue_partial(full_text)
            if len(current_dialogue) > prev_dialogue_len:
                new_chars = current_dialogue[prev_dialogue_len:]
                prev_dialogue_len = len(current_dialogue)
                yield ("token", new_chars)

        result = parse_dialogue_response(full_text)
        self._apply_result(session, npc_id, result, player_message, full_text)

        # v2: 处理任务投票
        if result.task_progress and session.current_task:
            self._handle_task_vote(session, npc_id, result.task_progress)

        yield ("done", result)

    def _apply_result(self, session, npc_id, result, player_message, full_text):
        from state.manager import get_session_manager
        manager = get_session_manager()
        npc = session.npcs[npc_id]

        # 记录玩家消息
        if player_message:
            session.dialogue_turn_counter += 1
            npc.dialogue_history.append(DialogueTurn(
                role="player", content=player_message,
                npc_id=npc_id, stage=session.current_stage,
                chapter_id=session.current_chapter_id or "",
                turn_index=session.dialogue_turn_counter,
            ))
            dialogue_id = manager.persist_dialogue(session, npc_id, "player", player_message)
            manager.persist_player_choice(
                session, npc_id, player_message,
                available_options=npc.last_options or None,
                dialogue_id=dialogue_id,
            )

        # 记录 NPC 回复
        reply_text = result.dialogue_text or full_text
        session.dialogue_turn_counter += 1
        npc.dialogue_history.append(DialogueTurn(
            role="npc", content=reply_text,
            npc_id=npc_id, stage=session.current_stage,
            chapter_id=session.current_chapter_id or "",
            turn_index=session.dialogue_turn_counter,
        ))
        npc_reply_id = manager.persist_dialogue(session, npc_id, "npc", reply_text, options=result.options)
        npc.last_options = result.options
        npc.dialogue_round_count += 1

        # 关系值
        delta = result.relationship_delta
        if delta == 0:
            from config import RELATIONSHIP_DEFAULT_DELTA
            delta = RELATIONSHIP_DEFAULT_DELTA
        old_rel = npc.relationship
        npc.apply_delta(delta)
        manager.persist_relationship_log(
            session, npc_id, delta, old_rel, npc.relationship,
            reason="对话加成" if result.relationship_delta != 0 else "兜底加成",
            dialogue_id=npc_reply_id,
        )

        # NPC 问候语
        short_reply = reply_text[:50].replace("\n", " ")
        npc.current_greeting = short_reply + ("……" if len(reply_text) > 50 else "")

        # 事件
        if result.should_trigger_event and result.new_event:
            event_id = result.new_event.strip()
            if event_id and event_id not in session.events_triggered:
                session.events_triggered.add(event_id)
                manager.persist_event(session, event_id,
                                     f"{npc.name}触发了事件", triggered_by_npc=npc_id)
                from config import RELATIONSHIP_EVENT_BONUS
                npc.apply_delta(RELATIONSHIP_EVENT_BONUS)

        # 阶段判定（兼容）
        if result.stage_should_advance:
            session.stage_llm_consecutive += 1
        else:
            session.stage_llm_consecutive = 0

        manager.persist_session(session)

    def _handle_task_vote(self, session: GameSession, npc_id: str,
                          task_progress) -> None:
        """处理 NPC 的任务进度投票。"""
        if not session.current_task:
            return

        task = session.current_task
        if npc_id not in task.related_npc_ids:
            return

        # 更新投票
        task.npc_completion_votes[npc_id] = task_progress.should_vote_complete

        # 更新子任务状态
        for st_id in task_progress.completed_sub_task_ids:
            for st in task.sub_tasks:
                if st.id == st_id and st.status != "completed":
                    st.status = "completed"
                    # 解锁下一个
                    idx = task.sub_tasks.index(st)
                    if idx + 1 < len(task.sub_tasks):
                        next_st = task.sub_tasks[idx + 1]
                        if next_st.status == "locked":
                            next_st.status = "active"

        # 检查是否全部完成
        if task.completion_rate >= 1.0 and not task.is_completed:
            task.is_completed = True
            logger.info(f"[NPCAgent] Task {task.task_id} completed by NPC consensus!")

        # 持久化
        try:
            from state.manager import get_session_manager
            manager = get_session_manager()
            manager._db.save_task_instance(session.session_id, task.to_dict())
        except Exception as e:
            logger.error(f"[NPCAgent] 持久化任务投票失败: {e}")


class AgentOrchestrator:

    def __init__(self, llm_client: LLMClient, prompt_builder: PromptBuilder):
        self.agent = NPCAgent(llm_client, prompt_builder)
        self.llm = llm_client
        self.prompt_builder = prompt_builder

    async def dialogue_stream(
        self,
        session: GameSession,
        npc_id: str,
        player_message: Optional[str] = None,
        show_item_id: Optional[str] = None,
    ):
        async for event_type, data in self.agent.generate_dialogue(
            session, npc_id, player_message, show_item_id=show_item_id,
        ):
            if event_type == "token":
                yield ("token", data)
            elif event_type == "done":
                # 检查章节完成
                chapter_completed = False
                if session.current_task and session.current_task.is_completed:
                    chapter_completed = True

                yield ("done", {
                    "result": data,
                    "chapter_completed": chapter_completed,
                })

    async def exit_dialogue(self, session: GameSession, npc_id: str):
        from agents.response_parser import parse_dialogue_response
        npc = session.npcs.get(npc_id)
        if not npc:
            raise ValueError(f"NPC not found: {npc_id}")

        messages = self.prompt_builder.build_dialogue_messages(
            session, npc_id, player_message="（玩家准备离开了）", is_ending=True
        )

        full_text = ""
        async for token in self.llm.chat_stream(messages, api_key=session.api_key):
            full_text += token

        result = parse_dialogue_response(full_text)
        result.options = []
        return result
