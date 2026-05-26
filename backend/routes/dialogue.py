"""
对话路由 — v2 新增 POST /api/dialogue/show-item。
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
from agents.content_moderator import moderate_input, check_rate_limit, record_block
from state.chapter_engine import ChapterEngine

router = APIRouter()
logger = logging.getLogger(__name__)


class DialogueRequest(BaseModel):
    session_id: str
    npc_id: str
    player_message: Optional[str] = None
    api_key: Optional[str] = None
    model: Optional[str] = None


class ShowItemRequest(BaseModel):
    session_id: str
    npc_id: str
    item_id: str
    player_message: Optional[str] = None
    api_key: Optional[str] = None
    model: Optional[str] = None


class ExitDialogueRequest(BaseModel):
    session_id: str
    npc_id: str
    api_key: Optional[str] = None
    model: Optional[str] = None


def _get_orchestrator(session: GameSession) -> AgentOrchestrator:
    llm = LLMClient(model=session.model or LLM_MODEL)
    builder = PromptBuilder()
    if session.system_prompt:
        builder.set_system_prompt(session.system_prompt)
    return AgentOrchestrator(llm, builder)


@router.post("/dialogue")
async def dialogue(req: DialogueRequest, raw_request: Request):
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
    if not npc.is_available:
        raise HTTPException(status_code=400, detail={
            "error": True, "code": "NPC_NOT_AVAILABLE",
            "message": f"NPC 当前不可交互: {req.npc_id}"
        })

    if session.game_ended:
        raise HTTPException(status_code=400, detail={
            "error": True, "code": "GAME_ENDED",
            "message": "游戏已结束"
        })

    # 频率限制检查：无论是否携带 player_message，被封禁就拒绝
    rate_result = check_rate_limit(req.session_id)
    if not rate_result.allowed:
        raise HTTPException(status_code=429, detail={
            "error": True, "code": "RATE_LIMITED",
            "message": rate_result.reason,
        })

    # 输入内容审核
    if req.player_message:
        mod_result = moderate_input(req.player_message)
        if not mod_result.safe:
            record_block(req.session_id)  # 记录拦截，可能触发封禁
            raise HTTPException(status_code=400, detail={
                "error": True, "code": "CONTENT_BLOCKED",
                "message": mod_result.reason,
            })

    orchestrator = _get_orchestrator(session)

    async def event_stream():
        try:
            async def is_disconnected():
                return await raw_request.is_disconnected()

            full_text = ""
            async for event_type, data in orchestrator.dialogue_stream(
                session, req.npc_id, req.player_message
            ):
                if await is_disconnected():
                    break

                if event_type == "token":
                    full_text += data
                    yield f"event: delta\ndata: {json.dumps({'chunk': data}, ensure_ascii=False)}\n\n"

                elif event_type == "done":
                    result = data["result"]
                    chapter_completed = data.get("chapter_completed", False)

                    if chapter_completed:
                        engine = ChapterEngine()
                        next_ch = engine.advance_to_next_chapter(session)
                        manager.persist_session(session)

                    ending_triggered = False
                    if session.game_ended and not session.ending_data:
                        ending_triggered = True
                        manager.persist_session(session)

                    current_ch = session.get_current_chapter()
                    done_data = {
                        "full_text": full_text,
                        "relationship_change": {req.npc_id: result.relationship_delta},
                        "options": result.options if result.options else None,
                        "events_triggered": [result.new_event] if result.should_trigger_event and result.new_event else [],
                        "chapter_completed": chapter_completed,
                        "game_ended": session.game_ended,
                        "current_chapter": {
                            "chapter_id": session.current_chapter_id,
                            "chapter_name": current_ch.get("name", "") if current_ch else None,
                        } if current_ch else None,
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


@router.post("/dialogue/show-item")
async def show_item(req: ShowItemRequest, raw_request: Request):
    """向 NPC 展示物品（SSE 流式，注入物品上下文到对话 Prompt）。"""
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

    item = session.get_inventory_item(req.item_id)
    if not item:
        raise HTTPException(status_code=404, detail={
            "error": True, "code": "ITEM_NOT_FOUND",
            "message": f"物品不在背包中: {req.item_id}"
        })

    if req.npc_id not in session.npcs:
        raise HTTPException(status_code=404, detail={
            "error": True, "code": "NPC_NOT_FOUND",
            "message": f"NPC 不存在: {req.npc_id}"
        })

    # 构造带物品提示的玩家消息
    message = req.player_message or f"（向{session.npcs[req.npc_id].name}展示了{item.name}）"

    # 频率限制检查：无论是否携带 player_message，被封禁就拒绝
    rate_result = check_rate_limit(req.session_id)
    if not rate_result.allowed:
        raise HTTPException(status_code=429, detail={
            "error": True, "code": "RATE_LIMITED",
            "message": rate_result.reason,
        })

    # 输入内容审核
    mod_result = moderate_input(message)
    if not mod_result.safe:
        record_block(req.session_id)
        raise HTTPException(status_code=400, detail={
            "error": True, "code": "CONTENT_BLOCKED",
            "message": mod_result.reason,
        })

    orchestrator = _get_orchestrator(session)

    async def event_stream():
        try:
            async def is_disconnected():
                return await raw_request.is_disconnected()

            full_text = ""
            async for event_type, data in orchestrator.dialogue_stream(
                session, req.npc_id, message, show_item_id=req.item_id
            ):
                if await is_disconnected():
                    break

                if event_type == "token":
                    full_text += data
                    yield f"event: delta\ndata: {json.dumps({'chunk': data}, ensure_ascii=False)}\n\n"

                elif event_type == "done":
                    result = data["result"]
                    done_data = {
                        "full_text": full_text,
                        "relationship_change": {req.npc_id: result.relationship_delta},
                        "options": result.options if result.options else None,
                        "shown_item": {"item_id": item.id, "name": item.name},
                        "chapter_completed": data.get("chapter_completed", False),
                    }
                    yield f"event: done\ndata: {json.dumps(done_data, ensure_ascii=False)}\n\n"
                    break

        except Exception as e:
            logger.exception(f"[ShowItem] SSE error: {e}")
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


@router.post("/dialogue/exit")
async def exit_dialogue(req: ExitDialogueRequest):
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
        orchestrator = _get_orchestrator(session)
        npc.dialogue_round_count = MAX_DIALOGUE_ROUNDS
        result = await orchestrator.exit_dialogue(session, req.npc_id)
        npc.dialogue_round_count = 0
        manager.persist_session(session)

        from state.session import DialogueTurn
        npc.dialogue_history.append(DialogueTurn(
            role="npc", content=result.dialogue_text,
            npc_id=req.npc_id, stage=session.current_stage,
        ))
        manager.persist_dialogue(session, req.npc_id, "npc", result.dialogue_text, options=[])

        return {"dialogue_text": result.dialogue_text, "options": [], "is_available": npc.is_available}
    except Exception as e:
        logger.exception(f"[Exit Dialogue] Error: {e}")
        npc.dialogue_round_count = 0
        manager.persist_session(session)
        return {"dialogue_text": f"（{npc.name}微微点头）", "options": [], "is_available": npc.is_available}
