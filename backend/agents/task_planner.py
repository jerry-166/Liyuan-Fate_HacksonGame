"""
任务规划器 — 章节开始时 LLM 生成 TaskInstance。
"""

import json
import logging
import uuid
from typing import Optional

from state.session import GameSession, TaskInstance, SubTask
from llm.client import LLMClient
from config import LLM_MODEL

logger = logging.getLogger(__name__)


class TaskPlanner:

    def __init__(self):
        self._template_cache: Optional[str] = None

    def _load_template(self) -> str:
        if self._template_cache:
            return self._template_cache
        import os
        path = os.path.join(os.path.dirname(os.path.dirname(__file__)),
                            "prompts", "task_planning.txt")
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as f:
                self._template_cache = f.read()
        else:
            self._template_cache = ""
        return self._template_cache

    async def plan_chapter(self, session: GameSession, chapter_def: dict) -> TaskInstance:
        """根据章节定义 + 当前状态，生成任务实例。

        优先使用 sub_task_templates（同步，无 LLM 延迟）；
        无模板时才调用 LLM 规划。
        """
        st_templates = chapter_def.get("sub_task_templates", [])

        # ── 有模板时直接用模板，跳过 LLM 调用 ──
        if st_templates:
            logger.info(f"[TaskPlanner] 使用 sub_task_templates 兜底（{len(st_templates)} 个子任务），跳过 LLM")
            result = self._fallback_from_templates(chapter_def)
            return self._parse_result(session, chapter_def, result)

        # ── 无模板：调用 LLM 规划 ──
        template = self._load_template()
        npcs_info = "\n".join(
            f"  - {npc.name}({npc.id}): {npc.role}, 关系值={npc.relationship}"
            for npc in session.npcs.values()
            if npc.id in chapter_def.get("required_npcs", [])
        ) or "  （本章无特定 NPC）"

        items_info = "\n".join(
            f"  - {item.get('name', item.get('narrative_name', item.get('item_id', '')))}"
            f"（{item.get('item_id', '')}）: {(item.get('narrative_desc', item.get('base_description', '')))[:80]}"
            for item in session.item_defs
            if item.get("item_id", item.get("id", "")) in chapter_def.get("required_items", [])
        ) or "  （本章无特定物品）"

        st_info = "  （无建议模板）"

        inventory_names = [i.name for i in session.inventory]
        rel_summary = ", ".join(
            f"{n.name}={n.relationship}" for n in session.npcs.values()
        )

        # 安全 format：转义 worldview 中的花括号，防止 KeyError
        worldview_raw = session.system_prompt[:500] if session.system_prompt else "（见完整世界观）"
        worldview_safe = worldview_raw.replace("{", "{{").replace("}", "}}")

        try:
            prompt = template.format(
                script_name=session.script_id,
                worldview=worldview_safe,
                chapter_name=chapter_def.get("name", ""),
                chapter_description=chapter_def.get("description", ""),
                key_event=chapter_def.get("key_event", ""),
                success_condition=chapter_def.get("success_condition", ""),
                npcs_info=npcs_info,
                items_info=items_info,
                sub_task_templates=st_info,
                player_name=session.player_name,
                completed_chapters=", ".join(session.completed_chapters) or "无",
                relationship_summary=rel_summary,
                inventory_summary=", ".join(inventory_names) or "空",
            )
        except (KeyError, ValueError) as e:
            logger.warning(f"[TaskPlanner] Prompt format 失败: {e}，使用模板兜底")
            result = self._fallback_from_templates(chapter_def)
            return self._parse_result(session, chapter_def, result)

        messages = [
            {"role": "system", "content": "你是叙事规划引擎，始终输出合法 JSON。"},
            {"role": "user", "content": prompt},
        ]

        # LLM 调用（带 15s 超时）
        llm = LLMClient(model=session.model or LLM_MODEL)
        try:
            import asyncio
            result = await asyncio.wait_for(
                llm.chat_json(
                    messages, api_key=session.api_key,
                    temperature=0.5, max_tokens=1024,
                ),
                timeout=15.0,
            )
        except asyncio.TimeoutError:
            logger.warning("[TaskPlanner] LLM 调用超时(15s)，使用模板兜底")
            result = self._fallback_from_templates(chapter_def)
        except Exception as e:
            logger.warning(f"[TaskPlanner] LLM 调用失败，使用模板兜底: {e}")
            result = self._fallback_from_templates(chapter_def)

        # 解析结果
        return self._parse_result(session, chapter_def, result)

    def _parse_result(self, session: GameSession, chapter_def: dict,
                      llm_result: dict) -> TaskInstance:
        task_id = f"task_{chapter_def.get('id', 'unknown')}_{uuid.uuid4().hex[:6]}"

        description = llm_result.get("description", chapter_def.get("description", ""))

        # 解析 sub_tasks
        raw_sub_tasks = llm_result.get("sub_tasks", [])
        sub_tasks = []
        for i, st in enumerate(raw_sub_tasks):
            mode = st.get("mode", "dialogue")
            sub_tasks.append(SubTask(
                id=st.get("id", f"st_{i+1:03d}"),
                title=st.get("title", f"子任务 {i+1}"),
                mode=mode,
                description=st.get("description", ""),
                target_npc_id=st.get("target_npc_id"),
                deliver_to_npc_id=st.get("deliver_to_npc_id"),
                required_item_id=st.get("required_item_id"),
                target_scene=st.get("target_scene"),
                relation_threshold=st.get("relation_threshold"),
                status="locked" if i > 0 else "active",
                min_dialogue_rounds=st.get("min_dialogue_rounds", 2 if mode == "dialogue" else 0),
            ))

        # 如果没有 LLM 生成的子任务，用模板兜底
        if not sub_tasks:
            sub_tasks = self._sub_tasks_from_templates(chapter_def)

        related_npc_ids = list({
            st.target_npc_id or st.deliver_to_npc_id
            for st in sub_tasks
            if st.target_npc_id or st.deliver_to_npc_id
        })

        # 确保 required_npcs 中有投票权的 NPC 都包含在内
        for npc_id in chapter_def.get("required_npcs", []):
            if npc_id not in related_npc_ids:
                related_npc_ids.append(npc_id)

        return TaskInstance(
            task_id=task_id,
            chapter_id=chapter_def.get("id", ""),
            chapter_name=chapter_def.get("name", ""),
            description=description,
            sub_tasks=sub_tasks,
            related_npc_ids=related_npc_ids,
            npc_completion_votes={npc_id: False for npc_id in related_npc_ids},
        )

    def _fallback_from_templates(self, chapter_def: dict) -> dict:
        st_templates = chapter_def.get("sub_task_templates", [])
        sub_tasks = []
        for i, st in enumerate(st_templates):
            sub_tasks.append({
                "id": st.get("id", f"st_{i+1:03d}"),
                "title": st.get("title", ""),
                "mode": st.get("mode", "dialogue"),
                "description": st.get("description", ""),
                "target_npc_id": st.get("target_npc_id"),
                "required_item_id": st.get("required_item_id"),
                "deliver_to_npc_id": st.get("deliver_to_npc_id"),
                "target_scene": st.get("target_scene"),
                "relation_threshold": st.get("relation_threshold"),
            })
        return {
            "description": chapter_def.get("description", ""),
            "sub_tasks": sub_tasks,
        }

    def _sub_tasks_from_templates(self, chapter_def: dict) -> list[SubTask]:
        sub_tasks = []
        st_templates = chapter_def.get("sub_task_templates", [])
        for i, st in enumerate(st_templates):
            mode = st.get("mode", "dialogue")
            sub_tasks.append(SubTask(
                id=st.get("id", f"st_{i+1:03d}"),
                title=st.get("title", ""),
                mode=mode,
                description=st.get("description", ""),
                target_npc_id=st.get("target_npc_id"),
                required_item_id=st.get("required_item_id"),
                deliver_to_npc_id=st.get("deliver_to_npc_id"),
                target_scene=st.get("target_scene"),
                relation_threshold=st.get("relation_threshold"),
                status="locked" if i > 0 else "active",
                min_dialogue_rounds=st.get("min_dialogue_rounds", 2 if mode == "dialogue" else 0),
            ))
        return sub_tasks
