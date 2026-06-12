"""
章节详情编辑路由 — 查看和修改运行中会话的章节 TaskInstance。

端点：
  GET   /api/game/{session_id}/chapter/{chapter_id}/detail
        获取指定章节的完整生成内容（TaskInstance + 上下文信息）

  PATCH /api/game/{session_id}/chapter/{chapter_id}/detail
        修改当前章节的 TaskInstance（描述/子任务标题/描述），
        修改结果立即注入 session 运行上下文，影响后续 NPC 行为。

  GET   /api/game/{session_id}/story/full
        获取完整故事进展：所有章节定义 + 大纲 + 当前 task + NPC 状态快照

  POST  /api/game/{session_id}/chapter/{chapter_id}/regenerate
        重新生成指定章节的 TaskInstance（当前章节才有意义）
"""

import logging
from typing import Optional, List
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from state.manager import get_session_manager

router = APIRouter()
logger = logging.getLogger(__name__)


# ═══════════════════════════════════════════════════════════════
# 请求模型
# ═══════════════════════════════════════════════════════════════

class SubTaskPatch(BaseModel):
    id: str
    title: Optional[str] = None
    description: Optional[str] = None
    mode: Optional[str] = None
    target_npc_id: Optional[str] = None
    min_dialogue_rounds: Optional[int] = None


class ChapterDetailPatch(BaseModel):
    """
    可编辑字段：
    - chapter_name: 章节显示名
    - description: 章节整体描述（会注入 NPC 对话上下文）
    - sub_tasks: 子任务列表（部分更新，按 id 匹配）
    - inject_context: 额外注入到下一章生成提示词的自由文本
    """
    chapter_name: Optional[str] = None
    description: Optional[str] = None
    sub_tasks: Optional[List[SubTaskPatch]] = None
    inject_context: Optional[str] = None   # 自由文本，注入下一章 LLM 上下文


# ═══════════════════════════════════════════════════════════════
# 辅助函数
# ═══════════════════════════════════════════════════════════════

def _get_session_or_404(session_id: str):
    manager = get_session_manager()
    session = manager.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail={
            "error": True, "code": "SESSION_NOT_FOUND",
            "message": f"游戏会话不存在: {session_id}"
        })
    return session, manager


def _chapter_def_for_id(session, chapter_id: str) -> Optional[dict]:
    for ch in session.chapter_defs:
        if ch.get("id") == chapter_id:
            return ch
    return None


def _build_chapter_detail_response(session, chapter_id: str) -> dict:
    """构建章节详情 API 响应（含 TaskInstance + NPC 快照 + 大纲）。"""
    ch_def = _chapter_def_for_id(session, chapter_id)

    # 查找 AI 大纲
    outline = None
    for o in session.chapter_outlines:
        if o.get("chapter_id") == chapter_id:
            outline = o
            break

    # 当前 task（只有当前章节才有 TaskInstance）
    task_data = None
    if session.current_task and session.current_chapter_id == chapter_id:
        task_data = session.current_task.to_dict()

    # 章节中涉及的 NPC 快照
    npc_ids = ch_def.get("required_npcs", []) if ch_def else []
    if task_data and not npc_ids:
        npc_ids = task_data.get("related_npc_ids", [])

    npc_snapshots = []
    for npc_id in npc_ids:
        npc = session.npcs.get(npc_id)
        if npc:
            npc_snapshots.append({
                "id": npc.id,
                "name": npc.name,
                "role": npc.role,
                "relationship": npc.relationship,
                "dialogue_round_count": npc.dialogue_round_count,
            })

    # 是否已完成
    is_completed = chapter_id in (session.completed_chapters or [])
    is_current = chapter_id == session.current_chapter_id

    return {
        "chapter_id": chapter_id,
        "is_current": is_current,
        "is_completed": is_completed,
        "chapter_def": {
            "id": ch_def.get("id") if ch_def else chapter_id,
            "name": ch_def.get("name", "") if ch_def else "",
            "sort_order": ch_def.get("sort_order", 0) if ch_def else 0,
            "type": ch_def.get("type", "normal") if ch_def else "normal",
            "description": ch_def.get("description", "") if ch_def else "",
            "goal": ch_def.get("goal", "") if ch_def else "",
            "key_conflict": ch_def.get("key_conflict", "") if ch_def else "",
            "atmosphere": ch_def.get("atmosphere", "") if ch_def else "",
            "color_tone": ch_def.get("color_tone", "") if ch_def else "",
            "bgm_mood": ch_def.get("bgm_mood", "") if ch_def else "",
            "required_npcs": ch_def.get("required_npcs", []) if ch_def else [],
        } if ch_def else None,
        "outline": outline,
        "task": task_data,
        "npc_snapshots": npc_snapshots,
        "inject_context": getattr(session, '_chapter_inject_contexts', {}).get(chapter_id, ""),
    }


# ═══════════════════════════════════════════════════════════════
# 路由实现
# ═══════════════════════════════════════════════════════════════

@router.get("/game/{session_id}/chapter/{chapter_id}/detail")
async def get_chapter_detail(session_id: str, chapter_id: str):
    """
    获取指定章节的完整生成内容。
    对于当前章节，返回完整 TaskInstance。
    对于历史章节，返回章节定义 + 大纲。
    """
    session, _ = _get_session_or_404(session_id)

    # 检查章节是否存在于本次游戏
    ch_def = _chapter_def_for_id(session, chapter_id)
    if not ch_def:
        raise HTTPException(status_code=404, detail={
            "error": True, "code": "CHAPTER_NOT_FOUND",
            "message": f"章节不存在: {chapter_id}"
        })

    return _build_chapter_detail_response(session, chapter_id)


@router.patch("/game/{session_id}/chapter/{chapter_id}/detail")
async def update_chapter_detail(session_id: str, chapter_id: str, req: ChapterDetailPatch):
    """
    修改章节 TaskInstance（仅当前章节有效）。

    修改立即注入 session 运行时状态，影响：
    1. NPC 对话上下文（下一次对话 prompt 包含修改后的章节描述）
    2. 下一章节生成时的背景信息（inject_context）
    3. TaskPanel 显示的子任务标题/描述
    """
    session, manager = _get_session_or_404(session_id)

    ch_def = _chapter_def_for_id(session, chapter_id)
    if not ch_def:
        raise HTTPException(status_code=404, detail={
            "error": True, "code": "CHAPTER_NOT_FOUND",
            "message": f"章节不存在: {chapter_id}"
        })

    # 只有当前章节的 TaskInstance 可以编辑
    is_current = chapter_id == session.current_chapter_id
    task = session.current_task if is_current else None

    changes = []

    # ── 修改章节名 ──
    if req.chapter_name is not None and is_current and task:
        old_name = task.chapter_name
        task.chapter_name = req.chapter_name
        ch_def["name"] = req.chapter_name  # 同步更新会话中的章节定义
        changes.append(f"chapter_name: '{old_name}' → '{req.chapter_name}'")

    # ── 修改章节描述 ──
    if req.description is not None:
        if is_current and task:
            old_desc = task.description
            task.description = req.description
            changes.append(f"description updated ({len(req.description)} chars)")
        # 同时更新 chapter_def 的描述（影响下次大纲生成）
        ch_def["description"] = req.description

    # ── 修改子任务 ──
    if req.sub_tasks and is_current and task:
        sub_task_map = {st.id: st for st in task.sub_tasks}
        for patch in req.sub_tasks:
            st = sub_task_map.get(patch.id)
            if not st:
                continue
            if patch.title is not None:
                st.title = patch.title
            if patch.description is not None:
                st.description = patch.description
            if patch.mode is not None:
                st.mode = patch.mode
            if patch.target_npc_id is not None:
                st.target_npc_id = patch.target_npc_id
            if patch.min_dialogue_rounds is not None:
                st.min_dialogue_rounds = patch.min_dialogue_rounds
        changes.append(f"sub_tasks updated: {len(req.sub_tasks)} items")

    # ── 注入自由上下文 ──
    if req.inject_context is not None:
        # 存储在 session 的扩展字段中（不破坏原有结构）
        if not hasattr(session, '_chapter_inject_contexts'):
            session._chapter_inject_contexts = {}
        session._chapter_inject_contexts[chapter_id] = req.inject_context
        changes.append(f"inject_context: {len(req.inject_context)} chars")

    # 持久化
    manager.persist_session(session)

    logger.info(f"[ChapterEdit] {session_id}/{chapter_id}: {'; '.join(changes)}")

    return {
        "success": True,
        "chapter_id": chapter_id,
        "changes": changes,
        "task": task.to_dict() if task else None,
    }


@router.post("/game/{session_id}/chapter/{chapter_id}/regenerate")
async def regenerate_chapter_detail(session_id: str, chapter_id: str):
    """
    重新生成当前章节的 TaskInstance（用于 AI 生成结果不满意时重试）。
    只有当前章节支持此操作。
    """
    session, manager = _get_session_or_404(session_id)

    if session.current_chapter_id != chapter_id:
        raise HTTPException(status_code=400, detail={
            "error": True, "code": "NOT_CURRENT_CHAPTER",
            "message": f"只有当前章节 ({session.current_chapter_id}) 支持重新生成"
        })

    ch_def = _chapter_def_for_id(session, chapter_id)
    if not ch_def:
        raise HTTPException(status_code=404, detail={
            "error": True, "code": "CHAPTER_NOT_FOUND",
            "message": f"章节不存在: {chapter_id}"
        })

    # 查找 AI 大纲
    outline = None
    for o in session.chapter_outlines:
        if o.get("chapter_id") == chapter_id:
            outline = o
            break

    try:
        from agents.story_planner import StoryPlanner
        planner = StoryPlanner()
        new_task = await planner.generate_chapter_detail(session, ch_def, outline=outline)
        session.current_task = new_task
        # 解锁第一个子任务
        if new_task.sub_tasks:
            from state.session import SubTaskStatus
            new_task.sub_tasks[0].status = SubTaskStatus.ACTIVE.value
        manager.persist_session(session)
        logger.info(f"[ChapterRegen] {session_id}/{chapter_id}: regenerated {len(new_task.sub_tasks)} subtasks")
        return {
            "success": True,
            "chapter_id": chapter_id,
            "task": new_task.to_dict(),
        }
    except Exception as e:
        logger.exception(f"[ChapterRegen] Failed: {e}")
        raise HTTPException(status_code=500, detail={
            "error": True, "code": "REGEN_FAILED",
            "message": f"重新生成失败: {str(e)}"
        })


@router.get("/game/{session_id}/story/full")
async def get_full_story(session_id: str):
    """
    获取完整故事进展：
    - 所有章节定义（带骨架信息）
    - 每章的 AI 大纲（如果已生成）
    - 当前章节 TaskInstance
    - NPC 状态快照
    - 对话历史摘要
    """
    session, _ = _get_session_or_404(session_id)

    chapters_with_detail = []
    for ch in session.chapter_defs:
        ch_id = ch.get("id", "")
        outline = next((o for o in session.chapter_outlines if o.get("chapter_id") == ch_id), None)
        is_current = ch_id == session.current_chapter_id
        is_completed = ch_id in (session.completed_chapters or [])

        chapter_entry = {
            "chapter_id": ch_id,
            "name": ch.get("name", ""),
            "sort_order": ch.get("sort_order", 0),
            "type": ch.get("type", "normal"),
            "description": ch.get("description", ""),
            "goal": ch.get("goal", ""),
            "key_conflict": ch.get("key_conflict", ""),
            "atmosphere": ch.get("atmosphere", ""),
            "color_tone": ch.get("color_tone", ""),
            "bgm_mood": ch.get("bgm_mood", ""),
            "is_current": is_current,
            "is_completed": is_completed,
            "outline": outline,
        }

        # 已完成章节附加存档的生成内容
        if is_completed and ch_id in (session.completed_chapter_tasks or {}):
            chapter_entry["task"] = session.completed_chapter_tasks[ch_id]

        # 当前章节附加 task 详情
        if is_current and session.current_task:
            chapter_entry["task"] = session.current_task.to_dict()

        chapters_with_detail.append(chapter_entry)

    # NPC 状态快照
    npc_snapshots = [
        {
            "id": npc.id,
            "name": npc.name,
            "role": npc.role,
            "scene": npc.scene,
            "relationship": npc.relationship,
            "dialogue_round_count": npc.dialogue_round_count,
            "summary": session.compressed_summaries.get(npc.id, ""),
        }
        for npc in session.npcs.values()
    ]

    return {
        "session_id": session_id,
        "script_id": session.script_id,
        "player_name": session.player_name,
        "current_chapter_id": session.current_chapter_id,
        "completed_chapters": session.completed_chapters or [],
        "game_ended": session.game_ended,
        "chapters": chapters_with_detail,
        "npc_snapshots": npc_snapshots,
        "inventory_count": len([i for i in session.inventory if i.is_discovered]),
    }
