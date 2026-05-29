"""
游戏路由 — v2 新增 /api/scripts + /api/game/new。
"""

import logging
import json
from pathlib import Path
from typing import Optional, List

import yaml
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from config import MAP_COLS, MAP_ROWS
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

    # 后台生成全5章大纲（不阻塞响应）
    import asyncio
    async def _gen_outline_bg():
        try:
            from agents.story_planner import StoryPlanner
            planner = StoryPlanner()
            outlines = await planner.generate_outline(session)
            if outlines:
                session.chapter_outlines = outlines
                manager.persist_session(session)
                logger.info(f"[GameStart] Generated {len(outlines)} chapter outlines for {session.session_id}")
        except Exception as e:
            logger.warning(f"[GameStart] Background outline generation failed: {e}")
    asyncio.create_task(_gen_outline_bg())

    # 合并 to_api_response + first_chapter
    response = session.to_api_response()
    response["first_chapter"] = {
        "chapter_id": first_ch.get("id") if first_ch else None,
        "type": first_ch.get("type") if first_ch else None,
        "name": first_ch.get("name") if first_ch else None,
        "description": first_ch.get("description") if first_ch else None,
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
                          save_id: Optional[str] = None,
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
    # 优先使用 session 的当前存档上下文，也允许显式传参覆盖
    effective_save_id = save_id or session.current_save_id
    db = get_db()
    return db.get_dialogue_history_paginated(session_id, npc_id=npc_id, page=page,
                                              page_size=page_size, save_id=effective_save_id)


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
        # 校验关键字段，缺失则用 raw 中的内容兜底
        if not result.get("title") or not result.get("life_lesson"):
            logger.warning(f"[Evaluate] LLM result missing fields, using fallback. raw keys: {list(result.keys())}")
            raise ValueError("Missing required ending fields")
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


@router.get("/game/{session_id}/evaluate/stream")
async def evaluate_ending_stream(session_id: str, request: Request):
    """流式结局评价 — SSE 渐进返回 header + 各 NPC 结局。"""
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

    # 缓存复用：已有完整数据直接返回
    if session.ending_data and session.ending_data.get("npc_endings"):
        cached = session.ending_data

        async def replay_stream():
            yield f"event: header\ndata: {json.dumps({**{k: cached.get(k) for k in ['title','summary','key_moments','life_lesson']}, 'type': session.ending_type or 'story_complete'}, ensure_ascii=False)}\n\n"
            for ne in cached.get("npc_endings", []):
                yield f"event: npc\ndata: {json.dumps({'npc_id': ne.get('npc_id',''), 'name': session.npcs.get(ne.get('npc_id','')).name if session.npcs.get(ne.get('npc_id','')) else '', 'summary': ne.get('summary','')}, ensure_ascii=False)}\n\n"
            yield f"event: done\ndata: {json.dumps({'type': session.ending_type or 'story_complete'}, ensure_ascii=False)}\n\n"

        return StreamingResponse(
            replay_stream(), media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"},
        )

    llm = LLMClient()
    builder = PromptBuilder()
    if session.system_prompt:
        builder.set_system_prompt(session.system_prompt)

    async def event_stream():
        collected_npc_endings = []
        header_data = None

        try:
            async def is_disconnected():
                return await request.is_disconnected()

            # Phase 1: 生成 header（标题+总结+关键瞬间+感悟）
            header_msgs = builder.build_evaluate_header_messages(session)
            header_data = await llm.chat_json(header_msgs, api_key=session.api_key, temperature=0.7)
            if not header_data.get("title"):
                header_data = {"title": "梨园余韵", "summary": "故事告一段落。", "key_moments": [], "life_lesson": "戏如人生。"}
            header_data["type"] = session.ending_type or "story_complete"
            yield f"event: header\ndata: {json.dumps(header_data, ensure_ascii=False)}\n\n"

            if await is_disconnected():
                return

            # Phase 2: 并行生成 5 个 NPC 结局
            import asyncio
            async def gen_one_npc(npc_id):
                try:
                    msgs = builder.build_evaluate_npc_messages(session, npc_id)
                    if not msgs:
                        return None
                    result = await llm.chat_json(msgs, api_key=session.api_key, temperature=0.7)
                    name = session.npcs.get(npc_id).name if session.npcs.get(npc_id) else npc_id
                    return {"npc_id": npc_id, "name": name,
                            "summary": result.get("summary", f"{name}的故事还在继续……")}
                except Exception as e:
                    logger.warning(f"[EvaluateStream] NPC {npc_id} failed: {e}")
                    name = session.npcs.get(npc_id).name if session.npcs.get(npc_id) else npc_id
                    return {"npc_id": npc_id, "name": name,
                            "summary": f"{name}的故事还在继续……"}

            tasks = [gen_one_npc(nid) for nid in session.npcs.keys()]
            # 谁先完成就先 yield
            for coro in asyncio.as_completed(tasks):
                if await is_disconnected():
                    break
                npc_result = await coro
                if npc_result:
                    collected_npc_endings.append(npc_result)
                    yield f"event: npc\ndata: {json.dumps(npc_result, ensure_ascii=False)}\n\n"

            # 组装完整 ending_data 并持久化
            full_ending = {
                **header_data,
                "type": session.ending_type or "story_complete",
                "npc_endings": collected_npc_endings,
            }
            session.ending_data = full_ending
            manager.persist_session(session)

            yield f"event: done\ndata: {json.dumps({'type': session.ending_type or 'story_complete'}, ensure_ascii=False)}\n\n"

        except Exception as e:
            logger.exception(f"[EvaluateStream] Error: {e}")
            yield f"event: error\ndata: {json.dumps({'message': str(e)}, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        event_stream(), media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"},
    )


@router.get("/game/{session_id}/ending")
async def get_ending(session_id: str):
    """只读端点：返回已有的结局数据（用于主菜单回看）。"""
    manager = get_session_manager()
    session = manager.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail={
            "error": True, "code": "SESSION_NOT_FOUND",
            "message": f"游戏会话不存在: {session_id}"
        })

    if not session.ending_data:
        # 兜底：没有结局数据时生成默认结局并持久化
        session.ending_data = {
            "type": session.ending_type or "story_complete",
            "title": "梨园余韵",
            "summary": "你在梨溪镇的故事告一段落。",
            "key_moments": [],
            "life_lesson": "戏如人生，人生如戏。",
            "npc_endings": [
                {"npc_id": npc.id, "name": npc.name,
                 "summary": f"{npc.name}的故事还在继续……"}
                for npc in session.npcs.values()
            ],
        }
        manager.persist_session(session)

    return session.ending_data


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


# ═══════════════════════════════════════════════════════════════
# NPC 位置 & 生成 相关路由
# ═══════════════════════════════════════════════════════════════

class PositionData(BaseModel):
    col: int
    row: int


class UpdateNPCPositionRequest(BaseModel):
    npc_id: str
    position: PositionData


class BatchPositionItem(BaseModel):
    npc_id: str
    position: PositionData
    scene: Optional[str] = None


class BatchUpdatePositionsRequest(BaseModel):
    scene: Optional[str] = None
    trigger: Optional[str] = None          # subscene_enter | subscene_exit | save
    positions: List[BatchPositionItem]


class SpawnNPCRequest(BaseModel):
    name: str
    sprite: str = ""
    position: PositionData
    scene: str = "town"
    is_temporary: bool = True
    greeting: str = ""
    role: str = ""
    # 可选：普通 NPC 的移动配置
    movement_enabled: bool = False
    movement_speed: int = 30
    idle_range: Optional[List[int]] = None
    wander_range: Optional[List[int]] = None


class TownNPCItem(BaseModel):
    name: str
    sprite: str = ""
    position: PositionData
    scene: str = "town"
    greeting: str = ""
    role: str = ""
    movement_enabled: bool = False
    movement_speed: int = 30
    idle_range: Optional[List[int]] = None
    wander_range: Optional[List[int]] = None


class BatchCreateTownNPCsRequest(BaseModel):
    town_npcs: List[TownNPCItem]


class UpdateTownNPCRequest(BaseModel):
    name: Optional[str] = None
    sprite: Optional[str] = None
    position: Optional[PositionData] = None
    scene: Optional[str] = None
    greeting: Optional[str] = None
    role: Optional[str] = None
    movement_enabled: Optional[bool] = None
    movement_speed: Optional[int] = None
    idle_range: Optional[List[int]] = None
    wander_range: Optional[List[int]] = None


# ─── P0: 单个 NPC 位置上报 ──────────────────────────────────

@router.post("/game/{session_id}/npc/position")
async def update_npc_position(session_id: str, req: UpdateNPCPositionRequest):
    """NPC 位置上报（剧情移动完成后调用）。"""
    # 坐标校验
    col, row = req.position.col, req.position.row
    if not (0 <= col < MAP_COLS and 0 <= row < MAP_ROWS):
        raise HTTPException(status_code=400, detail={
            "error": True, "code": "INVALID_PARAM",
            "message": f"坐标越界: col={col}, row={row} (地图范围: 0~{MAP_COLS-1}, 0~{MAP_ROWS-1})"
        })

    manager = get_session_manager()
    session = manager.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail={
            "error": True, "code": "SESSION_NOT_FOUND",
            "message": f"游戏会话不存在: {session_id}"
        })

    npc = session.npcs.get(req.npc_id)
    if not npc:
        raise HTTPException(status_code=404, detail={
            "error": True, "code": "NPC_NOT_FOUND",
            "message": f"NPC 不存在: {req.npc_id}"
        })

    npc.position = {"col": col, "row": row}
    manager.persist_npc_state(session, req.npc_id)
    logger.info(f"[NPC Position] {req.npc_id} → ({col}, {row})")

    return {"success": True, "npc_id": req.npc_id, "position": {"col": col, "row": row}}


# ─── P1: 批量 NPC 位置同步 ──────────────────────────────────

@router.post("/game/{session_id}/npc/positions/batch")
async def batch_update_npc_positions(session_id: str, req: BatchUpdatePositionsRequest):
    """批量同步 NPC 位置（场景切换/存档时调用）。"""
    manager = get_session_manager()
    session = manager.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail={
            "error": True, "code": "SESSION_NOT_FOUND",
            "message": f"游戏会话不存在: {session_id}"
        })

    updated_count = 0
    errors = []

    for item in req.positions:
        col, row = item.position.col, item.position.row
        # 校验坐标
        if not (0 <= col < MAP_COLS and 0 <= row < MAP_ROWS):
            errors.append({"npc_id": item.npc_id, "reason": f"坐标越界 ({col},{row})"})
            continue

        npc = session.npcs.get(item.npc_id)
        if not npc:
            errors.append({"npc_id": item.npc_id, "reason": "NPC_NOT_FOUND"})
            continue

        npc.position = {"col": col, "row": row}
        if item.scene:
            npc.scene = item.scene
        updated_count += 1

    # 批量持久化
    if updated_count > 0:
        manager.persist_session(session)

    logger.info(f"[NPC Batch] {session_id}: updated={updated_count}, errors={len(errors)}, trigger={req.trigger}")

    return {
        "success": True,
        "updated_count": updated_count,
        "errors": errors if errors else None,
        "scene": req.scene,
        "trigger": req.trigger,
    }


# ─── P3: 会话内生成临时 NPC ─────────────────────────────────

@router.post("/game/{session_id}/npc/spawn", status_code=201)
async def spawn_temporary_npc(session_id: str, req: SpawnNPCRequest):
    """运行时动态生成临时 NPC（如剧情触发）。临时 NPC 不持久化到 YAML 数据源。"""
    col, row = req.position.col, req.position.row
    if not (0 <= col < MAP_COLS and 0 <= row < MAP_ROWS):
        raise HTTPException(status_code=400, detail={
            "error": True, "code": "INVALID_PARAM",
            "message": f"坐标越界: col={col}, row={row}"
        })

    manager = get_session_manager()
    session = manager.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail={
            "error": True, "code": "SESSION_NOT_FOUND",
            "message": f"游戏会话不存在: {session_id}"
        })

    # 生成临时 NPC ID
    import uuid
    npc_id = f"npc_temp_{uuid.uuid4().hex[:6]}"

    from state.session import NPCState
    npc = NPCState(
        id=npc_id,
        name=req.name,
        role=req.role or "临时NPC",
        scene=req.scene,
        position={"col": col, "row": row},
        sprite_key=req.sprite or f"npc_{npc_id}",
        relationship_default=0,
    )
    npc.relationship = 0
    npc.current_greeting = req.greeting or "……"
    npc.is_available = True
    session.npcs[npc_id] = npc

    # 持久化到 DB
    manager.persist_npc_state(session, npc_id)

    logger.info(f"[NPC Spawn] {npc_id} ({req.name}) at ({col},{row}), temp={req.is_temporary}")
    return {
        "success": True,
        "npc_id": npc_id,
        "name": req.name,
        "position": {"col": col, "row": row},
        "scene": req.scene,
        "is_temporary": req.is_temporary,
    }


# ═══════════════════════════════════════════════════════════════
# 普通 NPC（town_npcs）CRUD — 读写 meta.yaml
# ═══════════════════════════════════════════════════════════════

SCRIPTS_DIR = Path(__file__).resolve().parent.parent.parent / "data" / "scripts"


def _load_meta_yaml(script_id: str) -> dict:
    """加载指定剧本的 meta.yaml"""
    meta_path = SCRIPTS_DIR / script_id / "meta.yaml"
    if not meta_path.exists():
        raise HTTPException(status_code=404, detail={
            "error": True, "code": "SCRIPT_NOT_FOUND",
            "message": f"剧本不存在: {script_id}"
        })
    try:
        with open(meta_path, "r", encoding="utf-8") as f:
            return yaml.safe_load(f) or {}
    except Exception as e:
        raise HTTPException(status_code=500, detail={
            "error": True, "code": "INTERNAL_ERROR",
            "message": f"读取 meta.yaml 失败: {e}"
        })


def _save_meta_yaml(script_id: str, meta: dict) -> None:
    """保存指定剧本的 meta.yaml（保留格式）"""
    meta_path = SCRIPTS_DIR / script_id / "meta.yaml"
    # 使用 safe_dump 保留中文可读性
    import io
    buf = io.StringIO()
    yaml.dump(meta, buf, allow_unicode=True, default_flow_style=False, sort_keys=False)
    with open(meta_path, "w", encoding="utf-8") as f:
        f.write(buf.getvalue())


def _town_npc_to_dict(npc: dict) -> dict:
    """将 town NPC 数据转为 API 响应格式"""
    result = {
        "id": npc.get("id", ""),
        "name": npc.get("name", ""),
        "sprite": npc.get("sprite", ""),
        "position": npc.get("position", {}),
        "scene": npc.get("scene", "town"),
        "greeting": npc.get("greeting", ""),
        "role": npc.get("role", ""),
    }
    movement = npc.get("movement", {})
    if movement:
        result["movement"] = {
            "enabled": movement.get("enabled", False),
            "zone": movement.get("zone"),
            "speed": movement.get("speed", 30),
            "idle_range": movement.get("idle_range"),
            "wander_range": movement.get("wander_range"),
        }
    else:
        result["movement"] = {"enabled": False}
    return result


def _auto_assign_id(town_npcs_list: list) -> str:
    """自动分配下一个 town_npc id: town_001, town_002, ..."""
    max_num = 0
    for npc in (town_npcs_list or []):
        nid = npc.get("id", "")
        if nid.startswith("town_"):
            try:
                num = int(nid.split("_")[1])
                if num > max_num:
                    max_num = num
            except (ValueError, IndexError):
                pass
    return f"town_{max_num + 1:03d}"


# ─── P2a: 查询所有普通 NPC ──────────────────────────────────

@router.get("/scripts/{script_id}/town-npcs")
async def list_town_npcs(script_id: str):
    """获取指定剧本的所有普通 NPC（路人）列表。"""
    meta = _load_meta_yaml(script_id)
    town_npcs = meta.get("town_npcs", []) or []
    return {
        "script_id": script_id,
        "town_npcs": [_town_npc_to_dict(n) for n in town_npcs],
        "total": len(town_npcs),
    }


# ─── P2b: 批量创建/覆盖普通 NPC ─────────────────────────────

@router.post("/scripts/{script_id}/town-npcs", status_code=201)
async def batch_create_town_npcs(script_id: str, req: BatchCreateTownNPCsRequest):
    """批量创建普通 NPC。已有 ID 的会覆盖更新，无 ID 的自动分配。"""
    meta = _load_meta_yaml(script_id)
    existing = meta.get("town_npcs", []) or []
    existing_ids = {n.get("id", ""): i for i, n in enumerate(existing)}
    created = []

    for item in req.town_npcs:
        col, row = item.position.col, item.position.row
        # 坐标校验
        if not (0 <= col < MAP_COLS and 0 <= row < MAP_ROWS):
            continue

        # 构建 NPC 数据
        movement = {}
        if item.movement_enabled:
            movement["enabled"] = True
            movement["speed"] = item.movement_speed
            if item.idle_range:
                movement["idle_range"] = item.idle_range
            if item.wander_range:
                movement["wander_range"] = item.wander_range

        npc_data = {
            "name": item.name,
            "sprite": item.sprite,
            "position": {"col": col, "row": row},
            "scene": item.scene,
            "greeting": item.greeting,
            "role": item.role,
            "movement": movement,
        }
        created.append(npc_data)

    # 全部替换
    meta["town_npcs"] = created

    # 为没有 id 的分配
    for i, npc in enumerate(meta["town_npcs"]):
        if not npc.get("id"):
            npc["id"] = _auto_assign_id(meta["town_npcs"][:i] if i > 0 else [])

    _save_meta_yaml(script_id, meta)

    logger.info(f"[TownNPCs] {script_id}: created/updated {len(created)} NPCs")
    return {
        "success": True,
        "created": [_town_npc_to_dict(n) for n in meta["town_npcs"]],
        "total": len(meta["town_npcs"]),
    }


# ─── P2c: 删除单个普通 NPC ──────────────────────────────────

@router.delete("/scripts/{script_id}/town-npcs/{npc_id}")
async def delete_town_npc(script_id: str, npc_id: str):
    """删除指定 ID 的普通 NPC。"""
    meta = _load_meta_yaml(script_id)
    town_npcs = meta.get("town_npcs", []) or []

    new_list = [n for n in town_npcs if n.get("id") != npc_id]
    if len(new_list) == len(town_npcs):
        raise HTTPException(status_code=404, detail={
            "error": True, "code": "NPC_NOT_FOUND",
            "message": f"普通 NPC 不存在: {npc_id}"
        })

    meta["town_npcs"] = new_list
    _save_meta_yaml(script_id, meta)

    logger.info(f"[TownNPCs] {script_id}: deleted {npc_id}")
    return {"success": True, "message": f"已删除普通 NPC: {npc_id}"}


# ─── P2d: 更新单个普通 NPC ──────────────────────────────────

@router.put("/scripts/{script_id}/town-npcs/{npc_id}")
async def update_town_npc(script_id: str, npc_id: str, req: UpdateTownNPCRequest):
    """更新指定普通 NPC 的配置（部分更新）。"""
    meta = _load_meta_yaml(script_id)
    town_npcs = meta.get("town_npcs", []) or []

    target = None
    for n in town_npcs:
        if n.get("id") == npc_id:
            target = n
            break

    if target is None:
        raise HTTPException(status_code=404, detail={
            "error": True, "code": "NPC_NOT_FOUND",
            "message": f"普通 NPC 不存在: {npc_id}"
        })

    # 部分更新
    if req.name is not None:
        target["name"] = req.name
    if req.sprite is not None:
        target["sprite"] = req.sprite
    if req.scene is not None:
        target["scene"] = req.scene
    if req.greeting is not None:
        target["greeting"] = req.greeting
    if req.role is not None:
        target["role"] = req.role
    if req.position is not None:
        col, row = req.position.col, req.position.row
        if 0 <= col < MAP_COLS and 0 <= row < MAP_ROWS:
            target["position"] = {"col": col, "row": row}

    # 更新 movement
    if "movement" not in target:
        target["movement"] = {}
    movement = target["movement"]
    if req.movement_enabled is not None:
        movement["enabled"] = req.movement_enabled
    if req.movement_speed is not None:
        movement["speed"] = req.movement_speed
    if req.idle_range is not None:
        movement["idle_range"] = req.idle_range
    if req.wander_range is not None:
        movement["wander_range"] = req.wander_range

    _save_meta_yaml(script_id, meta)

    logger.info(f"[TownNPCs] {script_id}: updated {npc_id}")
    return {"success": True, "npc": _town_npc_to_dict(target)}
