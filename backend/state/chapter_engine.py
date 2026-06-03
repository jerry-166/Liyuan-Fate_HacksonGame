"""
章节推进引擎 — 管理 chapter 生命周期和推进判定。
"""

import json
import logging
from typing import Optional

from state.session import GameSession, TaskInstance, SubTaskStatus, NarrativeItem
from config import CHAPTER_TO_STAGE

logger = logging.getLogger(__name__)


class ChapterEngine:

    async def start_chapter(self, session: GameSession,
                            chapter_def: dict) -> TaskInstance:
        """开始一个新章节：优先用 StoryPlanner（含 AI 大纲），兜底用 TaskPlanner。

        章节切换时，自动压缩上一章所有 NPC 的对话历史。
        跳章时，自动补齐被跳过章节的状态（事件、物品、关系值）。
        """
        from agents.story_planner import StoryPlanner
        planner = StoryPlanner()

        # ── 跳章状态补齐（必须先于压缩，确保压缩时状态完整） ──
        self.fill_skipped_state(session, chapter_def)

        # ── 章节切换时压缩上一章的对话 ───────────────
        if session.current_chapter_id and session.npcs:
            await self._compress_previous_chapter(session)

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

    async def _compress_previous_chapter(self, session: GameSession) -> None:
        """章节切换时，异步压缩所有 NPC 的对话历史。"""
        try:
            from agents.dialogue_compressor import DialogueCompressor
            compressor = DialogueCompressor()
            results = await compressor.compress_all_for_chapter_end(session)
            if results:
                logger.info(f"[ChapterEngine] Compressed dialogue for {len(results)} NPCs "
                           f"before chapter {session.current_chapter_id}")
        except Exception as e:
            logger.warning(f"[ChapterEngine] 对话压缩失败（非致命）: {e}")

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

    def fill_skipped_state(self, session: GameSession, target_chapter: dict) -> int:
        """补齐所有已完成章节中缺失的状态（事件、物品、关系值）。

        不只是检查 current→target 之间的跳跃，而是遍历所有 completed_chapters，
        为其中缺失状态（事件/物品）的章节自动注入。

        这样无论是逐章跳（skip_chapter）还是一次性跳（start_chapter+chapter_id），
        都能正确补齐。

        Returns:
            被补齐的章节数
        """
        if not session.chapter_defs or not session.completed_chapters:
            return 0

        filled = 0
        for ch_def in sorted(session.chapter_defs,
                             key=lambda c: c.get("sort_order", 0)):
            cid = ch_def.get("id", "")
            # 只处理已完成章节
            if cid not in session.completed_chapters:
                continue
            if ch_def.get("type") == "cinematic":
                continue

            # 检查是否需要填充（事件缺失 或 物品缺失）
            key_event = ch_def.get("key_event", "")
            event_missing = key_event and key_event not in session.events_triggered

            items_missing = []
            for item_id in ch_def.get("required_items", []):
                if not session.get_inventory_item(item_id):
                    items_missing.append(item_id)

            if not event_missing and not items_missing:
                continue  # 状态完整，跳过

            logger.info(f"[ChapterEngine] Filling state for {ch_def.get('name', cid)} "
                       f"(event_missing={event_missing}, items_missing={len(items_missing)})")

            # 1. 注入关键事件
            if event_missing:
                session.events_triggered.add(key_event)
                logger.info(f"[ChapterEngine]   + event: {key_event}")

            # 2. 注入缺少的物品
            for item_id in items_missing:
                item_def = None
                for idef in session.item_defs:
                    iid = idef.get("id", idef.get("item_id", ""))
                    if iid == item_id:
                        item_def = idef
                        break
                if item_def:
                    narrative_item = NarrativeItem(
                        id=item_id,
                        name=item_def.get("name", item_def.get("narrative_name", item_id)),
                        item_type=item_def.get("item_type", item_def.get("category", "misc")),
                        base_description=item_def.get("base_description",
                                                       item_def.get("narrative_desc", "")),
                        is_key=item_def.get("is_key", True),
                        is_discovered=True,
                        discovery_context=f"跳章自动获得（来自章节{ch_def.get('name', '')}）",
                        related_npcs=item_def.get("related_npcs", []),
                        npc_knowledge=item_def.get("npc_knowledge", {}),
                    )
                    session.add_to_inventory(narrative_item)
                    logger.info(f"[ChapterEngine]   + item: {item_id} ({narrative_item.name})")

            filled += 1

        # 3. 调整 NPC 关系值到目标章节应有的水平
        if filled > 0:
            self._adjust_npc_relationships(session, target_chapter)

        return filled

    @staticmethod
    def _adjust_npc_relationships(session: GameSession, target_chapter: dict) -> None:
        """根据目标章节的阶段，将 NPC 关系值调整到合理水平。

        阶段映射：
          - 阶段1（ch_01/ch_02）：初始值 + 0~10（陌生人，初步接触）
          - 阶段2（ch_03/ch_04）：初始值 + 25~40（记忆恢复，已是自己人）
          - 阶段3（ch_05）：      初始值 + 50~65（信任，准备交接）
        """
        stage = CHAPTER_TO_STAGE.get(target_chapter.get("id", ""), 1)
        if stage <= 1:
            return

        # 每个 stage 对应的最低关系值增量
        stage_min_delta = {2: 25, 3: 50}
        min_delta = stage_min_delta.get(stage, 0)

        for npc in session.npcs.values():
            target_relationship = npc.relationship_default + min_delta
            if npc.relationship < target_relationship:
                npc.relationship = max(npc.relationship, target_relationship)
            npc.clamp_relationship()

        logger.info(f"[ChapterEngine] Adjusted NPC relationships to stage {stage} "
                   f"(min delta +{min_delta})")

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
