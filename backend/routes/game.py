"""
游戏路由 — 会话管理 + 状态查询 + 结局评价。
"""

import json
import logging
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

from state.manager import get_session_manager
from llm.client import LLMClient
from agents.prompt_builder import PromptBuilder

router = APIRouter()
logger = logging.getLogger(__name__)


class StartGameRequest(BaseModel):
    player_name: str = "玩家"
    api_key: Optional[str] = None
    model: Optional[str] = None


@router.post("/game/start", status_code=201)
async def start_game(req: StartGameRequest):
    """创建新游戏会话，初始化所有状态。"""
    manager = get_session_manager()
    session = manager.create(
        player_name=req.player_name,
        api_key=req.api_key,
        model=req.model,
    )
    return session.to_api_response()


@router.get("/game/{session_id}")
async def get_game_state(session_id: str):
    """获取完整游戏状态。"""
    manager = get_session_manager()
    session = manager.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail={
            "error": True, "code": "SESSION_NOT_FOUND",
            "message": f"游戏会话不存在: {session_id}"
        })
    return session.to_api_response()


@router.post("/game/{session_id}/evaluate")
async def evaluate_ending(session_id: str):
    """
    生成结局评价（幂等 — 同一 session 多次调用返回缓存结果）。

    前提：game_ended = true
    """
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
            "message": "游戏尚未结束，无法生成结局评价"
        })

    # 幂等：如果已有缓存，直接返回
    if session.ending_data:
        return session.ending_data

    # 调用 LLM 生成结局评价
    try:
        llm = LLMClient()
        builder = PromptBuilder()
        messages = builder.build_evaluate_messages(session)
        result = await llm.chat_json(messages, api_key=session.api_key, temperature=0.7)

        # 缓存
        session.ending_data = result
        manager.persist_session(session)

        return result

    except Exception as e:
        logger.exception(f"[Evaluate] Failed: {e}")
        # 降级：返回兜底结局
        fallback = {
            "type": session.ending_type or "default_ending",
            "title": "梨园余韵",
            "summary": "你在梨溪镇的故事告一段落。戏台的锣鼓声或许散去，但有些东西，一旦经历，便刻在了骨子里。",
            "key_moments": [
                {"stage": 1, "description": "你第一次踏入这个陌生又熟悉的小镇"},
                {"stage": 2, "description": "你开始走近戏班的人，听他们讲述往事"},
                {"stage": 3, "description": "在关键的时刻，你做出了自己的选择"},
            ],
            "life_lesson": "戏如人生，人生如戏。冥冥之中，有些缘分是命中注定的。",
            "npc_endings": [
                {
                    "npc_id": npc.id,
                    "final_relationship": npc.relationship,
                    "summary": f"{npc.name}的故事还在继续……"
                }
                for npc in session.npcs.values()
            ],
        }
        session.ending_data = fallback
        manager.persist_session(session)
        return fallback
