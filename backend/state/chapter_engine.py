"""
章节推进引擎 — 管理 chapter 生命周期和推进判定。
"""

import json
import logging
from typing import Optional

from state.session import GameSession, TaskInstance, SubTaskStatus
from config import CHAPTER_TO_STAGE

logger = logging.getLogger(__name__)


class ChapterEngine:

    async def start_chapter(self, session: GameSession,
                            chapter_def: dict) -> TaskInstance:
        """开始一个新章节：优先用 StoryPlanner（含 AI 大纲），兜底用 TaskPlanner。"""
        from agents.story_planner import StoryPlanner
        planner = StoryPlanner()

        # 查找该章的 AI 大纲（如果有）
        outline = None
        ch_id = chapter_def.get("id", "")
        for o in session.chapter_outlines:
            if o.get("chapter_id") == ch_id:
                outline = o
                break

        task = await planner.generate_chapter_detail(session, chapter_def, outline=outline)

        # 设置 session 状态
        session.current_chapter_id = chapter_def.get("id")
        session.current_task = task

        # 更新旧阶段映射
        new_stage = CHAPTER_TO_STAGE.get(chapter_def.get("id", ""), 1)
        if new_stage != session.current_stage:
            old_stage = session.current_stage
            session.current_stage = new_stage
            logger.info(f"[ChapterEngine] Stage: {old_stage} → {new_stage}")

        # 解锁第一个子任务
        if task.sub_tasks:
            task.sub_tasks[0].status = SubTaskStatus.ACTIVE.value

        # 持久化
        self._persist_chapter_start(session, chapter_def, task)

        return task

    def check_chapter_completion(self, session: GameSession) -> bool:
        """检查当前章节是否完成（多 NPC 共识投票）。"""
        if not session.current_task:
            return False
        return session.current_task.is_completed

    def check_sub_task_progress(self, session: GameSession, npc_id: str) -> bool:
        """检查某个 NPC 相关的子任务是否有可推进的。"""
        if not session.current_task:
            return False
        task = session.current_task
        changed = False

        for st in task.sub_tasks:
            if st.status == SubTaskStatus.COMPLETED.value:
                continue
            if st.status == SubTaskStatus.LOCKED.value:
                # 检查前置是否完成
                idx = task.sub_tasks.index(st)
                if idx > 0 and task.sub_tasks[idx - 1].status == SubTaskStatus.COMPLETED.value:
                    st.status = SubTaskStatus.ACTIVE.value
                    changed = True
                continue

            # 检查完成条件
            if self._is_sub_task_done(session, st):
                st.status = SubTaskStatus.COMPLETED.value
                changed = True
                # 解锁下一个
                idx = task.sub_tasks.index(st)
                if idx + 1 < len(task.sub_tasks):
                    next_st = task.sub_tasks[idx + 1]
                    if next_st.status == SubTaskStatus.LOCKED.value:
                        next_st.status = SubTaskStatus.ACTIVE.value

        return changed

    def _is_sub_task_done(self, session: GameSession, st) -> bool:
        """检查单个子任务是否完成。"""
        mode = st.mode

        if mode == "acquire_item":
            if st.required_item_id:
                return session.get_inventory_item(st.required_item_id) is not None

        elif mode == "show_item":
            if st.required_item_id:
                return session.get_inventory_item(st.required_item_id) is not None

        elif mode == "deliver":
            if st.required_item_id:
                return session.get_inventory_item(st.required_item_id) is not None

        elif mode == "relation":
            if st.target_npc_id and st.relation_threshold is not None:
                npc = session.npcs.get(st.target_npc_id)
                if npc:
                    return npc.relationship >= st.relation_threshold

        elif mode == "explore":
            if st.target_scene:
                for npc in session.npcs.values():
                    if npc.scene == st.target_scene and npc.dialogue_round_count > 0:
                        return True

        elif mode == "dialogue":
            if st.target_npc_id:
                npc = session.npcs.get(st.target_npc_id)
                if npc and st.min_dialogue_rounds > 0:
                    return npc.dialogue_round_count >= st.min_dialogue_rounds

        return False

    def advance_to_next_chapter(self, session: GameSession) -> Optional[dict]:
        """推进到下一章。返回下一章定义或 None（游戏结束）。"""
        if session.current_chapter_id:
            session.completed_chapters.append(session.current_chapter_id)

        # 标记当前任务完成
        if session.current_task:
            session.current_task.is_completed = True

        # 更新章节进度
        try:
            from state.manager import get_session_manager
            manager = get_session_manager()
            manager._db.complete_chapter_progress(
                session.session_id, session.current_chapter_id or ""
            )
        except Exception:
            pass

        # 查找下一章
        next_ch = session.get_next_chapter()
        if not next_ch:
            session.game_ended = True
            session.ending_type = "story_complete"
            return None

        return next_ch

    def _persist_chapter_start(self, session: GameSession,
                               chapter_def: dict, task: TaskInstance) -> None:
        try:
            from state.manager import get_session_manager
            manager = get_session_manager()

            # 保存任务实例
            manager._db.save_task_instance(session.session_id, task.to_dict())

            # 保存章节进度
            manager._db.save_chapter_progress(
                session.session_id,
                chapter_def.get("id", ""),
                task.task_id,
                "active",
            )

            # 保存 session（含 current_chapter_id）
            manager.persist_session(session)
        except Exception as e:
            logger.error(f"[ChapterEngine] 持久化失败: {e}")
