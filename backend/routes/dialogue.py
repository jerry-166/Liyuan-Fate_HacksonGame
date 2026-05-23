"""
对话路由 — POST /api/dialogue（SSE 流式核心接口）。
"""

import json
import logging
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional

from config import LLM_MODEL
from state.manager import get_session_manager
from state.session import GameSession
from llm.client import LLMClient
from agents.prompt_builder import PromptBuilder
from agents.npc_agent import AgentOrchestrator
from state.stage_engine import StageEngine

router = APIRouter()
logger = logging.getLogger(__name__)


class DialogueRequest(BaseModel):
    session_id: str
    npc_id: str
    player_message: Optional[str] = None
    api_key: Optional[str] = None   # 从 game/start 传入，每次对话携带以防 session 重建丢失
    model: Optional[str] = None     # 同上


def _get_orchestrator(session: GameSession) -> AgentOrchestrator:
    """获取 AgentOrchestrator 实例，使用 session 级的 model。"""
    llm = LLMClient(model=session.model or LLM_MODEL)
    builder = PromptBuilder()
    return AgentOrchestrator(llm, builder)


@router.post("/dialogue")
async def dialogue(req: DialogueRequest, raw_request: Request):
    """
    NPC 对话接口 — SSE 流式响应。

    player_message 为 null 时 → 首轮对话（生成 NPC 开场白 + 选项）
    player_message 有值时 → 续接对话
    """
    manager = get_session_manager()
    session = manager.get(req.session_id)
    if not session:
        raise HTTPException(status_code=404, detail={
            "error": True, "code": "SESSION_NOT_FOUND",
            "message": f"游戏会话不存在: {req.session_id}"
        })

    # 自动注入：防 session 因服务重载从 DB 重建后丢失 api_key/model
    if req.api_key and not session.api_key:
        session.api_key = req.api_key
    if req.model and not session.model:
        session.model = req.model

    if req.npc_id not in session.npcs:
        raise HTTPException(status_code=404, detail={
            "error": True, "code": "NPC_NOT_FOUND",
            "message": f"NPC 不存在: {req.npc_id}"
        })

    npc = session.npcs[req.npc_id]
    if not npc.is_available:
        raise HTTPException(status_code=400, detail={
            "error": True, "code": "NPC_NOT_AVAILABLE",
            "message": f"NPC 当前不可交互: {req.npc_id}"
        })

    if session.game_ended:
        raise HTTPException(status_code=400, detail={
            "error": True, "code": "GAME_ALREADY_ENDED",
            "message": "游戏已结束，不能继续对话"
        })

    model = session.model or LLM_MODEL
    orchestrator = _get_orchestrator(session)
    stage_engine = StageEngine(LLMClient(model=model), PromptBuilder())

    async def event_stream():
        """SSE 事件流生成器。"""
        try:
            # 检查客户端是否已断开
            async def is_disconnected():
                return await raw_request.is_disconnected()

            full_text = ""
            async for event_type, data in orchestrator.dialogue_stream(
                session, req.npc_id, req.player_message
            ):
                if await is_disconnected():
                    logger.info("[Dialogue] Client disconnected")
                    break

                if event_type == "token":
                    full_text += data
                    yield f"event: delta\ndata: {json.dumps({'chunk': data}, ensure_ascii=False)}\n\n"

                elif event_type == "done":
                    result = data["result"]  # DialogueResult
                    stage_result = data["stage"]  # StageCheckResult

                    # 执行阶段切换
                    if stage_result.stage_changed:
                        stage_engine.apply_stage_change(session, stage_result)

                    # 检测结局触发
                    ending_triggered = False
                    if not session.game_ended:
                        ending_triggered = _check_ending(session)
                    if ending_triggered:
                        session.game_ended = True
                        manager.persist_session(session)

                    # 获取新阶段参数
                    new_stage = None
                    if stage_result.stage_changed:
                        from config import STAGES
                        new_stage = STAGES.get(session.current_stage)

                    # SSE done 事件
                    done_data = {
                        "full_text": full_text,
                        "relationship_change": {
                            req.npc_id: result.relationship_delta,
                        },
                        "options": result.options if result.options else None,
                        "stage_changed": stage_result.stage_changed,
                        "new_stage": new_stage,
                        "ending_triggered": ending_triggered,
                        "events_triggered": [result.new_event] if result.should_trigger_event and result.new_event else [],
                    }

                    yield f"event: done\ndata: {json.dumps(done_data, ensure_ascii=False)}\n\n"
                    break

        except Exception as e:
            logger.exception(f"[Dialogue] SSE error: {e}")
            yield f"event: error\ndata: {json.dumps({'code': 'LLM_ERROR', 'message': str(e)}, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
            "Access-Control-Allow-Origin": "*",
        },
    )


class ExitDialogueRequest(BaseModel):
    session_id: str
    npc_id: str
    api_key: Optional[str] = None
    model: Optional[str] = None


@router.post("/dialogue/exit")
async def exit_dialogue(req: ExitDialogueRequest):
    """
    显式退出与 NPC 的对话。

    让 NPC 生成一句告别语（无 options），重置对话轮数。
    is_available 不受影响 —— 仅由后端剧情逻辑（阶段引擎）控制，退出对话不改变 NPC 可用性。
    不走 SSE 流式，直接返回 JSON。
    """
    from config import MAX_DIALOGUE_ROUNDS

    manager = get_session_manager()
    session = manager.get(req.session_id)
    if not session:
        raise HTTPException(status_code=404, detail={
            "error": True, "code": "SESSION_NOT_FOUND",
            "message": f"游戏会话不存在: {req.session_id}"
        })

    if req.api_key and not session.api_key:
        session.api_key = req.api_key
    if req.model and not session.model:
        session.model = req.model

    if req.npc_id not in session.npcs:
        raise HTTPException(status_code=404, detail={
            "error": True, "code": "NPC_NOT_FOUND",
            "message": f"NPC 不存在: {req.npc_id}"
        })

    npc = session.npcs[req.npc_id]

    try:
        model = session.model or LLM_MODEL
        orchestrator = _get_orchestrator(session)

        # 强制设置为结束状态，生成告别语
        npc.dialogue_round_count = MAX_DIALOGUE_ROUNDS  # 触发收尾指令

        result = await orchestrator.exit_dialogue(session, req.npc_id)

        # 重置轮数计数器（下次再对话从头计数）
        npc.dialogue_round_count = 0
        manager.persist_session(session)

        # 持久化告别语
        from state.session import DialogueTurn
        npc.dialogue_history.append(DialogueTurn(
            role="npc",
            content=result.dialogue_text,
            npc_id=req.npc_id,
            stage=session.current_stage,
        ))
        manager.persist_dialogue(session, req.npc_id, "npc", result.dialogue_text, options=[])

        return {
            "dialogue_text": result.dialogue_text,
            "options": [],
            "is_available": npc.is_available,
        }

    except Exception as e:
        logger.exception(f"[Exit Dialogue] Error: {e}")
        # 降级：返回简单告别语
        npc.dialogue_round_count = 0
        manager.persist_session(session)

        fallback_text = f"（{npc.name}微微点头，示意你可以离开了）"
        return {
            "dialogue_text": fallback_text,
            "options": [],
            "is_available": npc.is_available,
        }


def _check_ending(session) -> bool:
    """判断是否触发结局。"""
    from config import ENDING_CONDITIONS

    for ending_type, conditions in ENDING_CONDITIONS.items():
        if session.current_stage < conditions.get("min_stage", 3):
            continue

        # 关系值总和
        rel_sum = sum(n.relationship for n in session.npcs.values())
        if rel_sum < conditions.get("min_relationship_sum", 100):
            continue

        # 关键事件
        key_events = conditions.get("key_events", set())
        if key_events and not (key_events & session.events_triggered):
            continue

        session.ending_type = ending_type
        logger.info(f"[Ending] Triggered: {ending_type}")
        return True

    return False
