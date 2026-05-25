"""
游戏路由 — v2 新增 /api/scripts + /api/game/new。
"""

import logging
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

from state.manager import get_session_manager
from storage.database import get_db
from llm.client import LLMClient
from agents.prompt_builder import PromptBuilder

router = APIRouter()
logger = logging.getLogger(__name__)


class StartGameRequest(BaseModel):
    player_name: str = "玩家"
    api_key: Optional[str] = None
    model: Optional[str] = None
    script_id: str = "liyuan_shengsi"


@router.post("/game/start", status_code=201)
async def start_game(req: StartGameRequest):
    """创建新游戏会话（script_id 默认 liyuan_shengsi）。

    返回完整游戏状态 + first_chapter 提示，前端据此决定首个章节并调用 /chapter/start。
    """
    manager = get_session_manager()
    session = manager.create(
        player_name=req.player_name,
        api_key=req.api_key,
        model=req.model,
        script_id=req.script_id,
    )
    first_ch = session.get_next_chapter()

    # 合并 to_api_response + first_chapter
    response = session.to_api_response()
    response["first_chapter"] = {
        "chapter_id": first_ch.get("id") if first_ch else None,
        "type": first_ch.get("type") if first_ch else None,
        "name": first_ch.get("name") if first_ch else None,
    }
    return response


@router.get("/scripts")
async def list_scripts():
    """列出所有可用剧本。"""
    from data.script_loader import ScriptLoader
    loader = ScriptLoader()
    try:
        scripts = loader.list_scripts()
        return {"scripts": scripts, "total": len(scripts)}
    except Exception as e:
        logger.error(f"[Scripts] list failed: {e}")
        return {"scripts": [], "total": 0, "error": str(e)}


@router.get("/game/{session_id}")
async def get_game_state(session_id: str):
    manager = get_session_manager()
    session = manager.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail={
            "error": True, "code": "SESSION_NOT_FOUND",
            "message": f"游戏会话不存在: {session_id}"
        })
    return session.to_api_response()


@router.get("/game/{session_id}/dialogues")
async def get_dialogues(session_id: str, npc_id: Optional[str] = None,
                          page: int = 1, page_size: int = 20):
    manager = get_session_manager()
    session = manager.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail={
            "error": True, "code": "SESSION_NOT_FOUND",
            "message": f"游戏会话不存在: {session_id}"
        })
    page = max(1, page)
    page_size = max(1, min(100, page_size))
    db = get_db()
    return db.get_dialogue_history_paginated(session_id, npc_id=npc_id, page=page, page_size=page_size)


@router.post("/game/{session_id}/evaluate")
async def evaluate_ending(session_id: str):
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

    if session.ending_data:
        return session.ending_data

    try:
        llm = LLMClient()
        builder = PromptBuilder()
        if session.system_prompt:
            builder.set_system_prompt(session.system_prompt)
        messages = builder.build_evaluate_messages(session)
        result = await llm.chat_json(messages, api_key=session.api_key, temperature=0.7)
        session.ending_data = result
        manager.persist_session(session)
        return result
    except Exception as e:
        logger.exception(f"[Evaluate] Failed: {e}")
        fallback = {
            "type": session.ending_type or "default_ending",
            "title": "梨园余韵",
            "summary": "你在梨溪镇的故事告一段落。戏台的锣鼓声或许散去，但有些东西，一旦经历，便刻在了骨子里。",
            "key_moments": [],
            "life_lesson": "戏如人生，人生如戏。",
            "npc_endings": [
                {"npc_id": npc.id, "final_relationship": npc.relationship,
                 "summary": f"{npc.name}的故事还在继续……"}
                for npc in session.npcs.values()
            ],
        }
        session.ending_data = fallback
        manager.persist_session(session)
        return fallback


@router.get("/game/{session_id}/relationships")
async def get_relationships(session_id: str, npc_id: Optional[str] = None):
    manager = get_session_manager()
    session = manager.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail={
            "error": True, "code": "SESSION_NOT_FOUND",
            "message": f"游戏会话不存在: {session_id}"
        })
    db = get_db()
    logs = db.get_relationship_log(session_id, npc_id=npc_id)
    current_rel = {nid: npc.relationship for nid, npc in session.npcs.items()}
    return {"session_id": session_id, "npc_id": npc_id, "logs": logs, "current_relationships": current_rel, "total": len(logs)}


@router.get("/game/{session_id}/events")
async def get_events(session_id: str):
    manager = get_session_manager()
    session = manager.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail={
            "error": True, "code": "SESSION_NOT_FOUND",
            "message": f"游戏会话不存在: {session_id}"
        })
    db = get_db()
    events = db.get_events(session_id)
    return {"session_id": session_id, "events": events, "total": len(events)}
