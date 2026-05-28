"""
游戏会话数据类 — v2 章节+任务+物品架构。

保留原有 NPCState/DialogueTurn/GameSession 接口，新增：
  - SubTask / SubTaskMode / SubTaskStatus
  - TaskInstance
  - NarrativeItem
  - GameSession 扩展字段（章节、物品）
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional


# ═══════════════════════════════════════════════════════════════
# SubTask 相关
# ═══════════════════════════════════════════════════════════════

class SubTaskMode(str, Enum):
    DIALOGUE = "dialogue"
    ACQUIRE_ITEM = "acquire_item"
    SHOW_ITEM = "show_item"
    DELIVER = "deliver"
    RELATION_THRESHOLD = "relation"
    EXPLORE = "explore"


class SubTaskStatus(str, Enum):
    LOCKED = "locked"
    ACTIVE = "active"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"


@dataclass
class SubTask:
    id: str
    title: str
    mode: str
    description: str = ""
    target_npc_id: Optional[str] = None
    deliver_to_npc_id: Optional[str] = None
    required_item_id: Optional[str] = None
    target_scene: Optional[str] = None
    relation_threshold: Optional[int] = None
    status: str = SubTaskStatus.LOCKED.value
    min_dialogue_rounds: int = 0

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "title": self.title,
            "mode": self.mode,
            "description": self.description,
            "target_npc_id": self.target_npc_id,
            "deliver_to_npc_id": self.deliver_to_npc_id,
            "required_item_id": self.required_item_id,
            "target_scene": self.target_scene,
            "relation_threshold": self.relation_threshold,
            "status": self.status,
            "min_dialogue_rounds": self.min_dialogue_rounds,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "SubTask":
        return cls(
            id=d.get("id", ""),
            title=d.get("title", ""),
            mode=d.get("mode", "dialogue"),
            description=d.get("description", ""),
            target_npc_id=d.get("target_npc_id"),
            deliver_to_npc_id=d.get("deliver_to_npc_id"),
            required_item_id=d.get("required_item_id"),
            target_scene=d.get("target_scene"),
            relation_threshold=d.get("relation_threshold"),
            status=d.get("status", SubTaskStatus.LOCKED.value),
            min_dialogue_rounds=d.get("min_dialogue_rounds", 0),
        )


# ═══════════════════════════════════════════════════════════════
# TaskInstance
# ═══════════════════════════════════════════════════════════════

@dataclass
class TaskInstance:
    task_id: str
    chapter_id: str
    chapter_name: str
    description: str = ""
    sub_tasks: list[SubTask] = field(default_factory=list)
    related_npc_ids: list[str] = field(default_factory=list)
    generated_item_ids: list[str] = field(default_factory=list)
    npc_completion_votes: dict[str, bool] = field(default_factory=dict)
    is_completed: bool = False

    @property
    def completion_rate(self) -> float:
        total = len(self.related_npc_ids)
        if total == 0:
            return 1.0
        return sum(1 for v in self.npc_completion_votes.values() if v) / total

    @property
    def completed_subtasks(self) -> int:
        return sum(1 for st in self.sub_tasks if st.status == SubTaskStatus.COMPLETED.value)

    def to_dict(self) -> dict:
        return {
            "task_id": self.task_id,
            "chapter_id": self.chapter_id,
            "chapter_name": self.chapter_name,
            "description": self.description,
            "sub_tasks": [st.to_dict() for st in self.sub_tasks],
            "related_npc_ids": self.related_npc_ids,
            "generated_item_ids": self.generated_item_ids,
            "npc_completion_votes": self.npc_completion_votes,
            "is_completed": self.is_completed,
            "completion_rate": self.completion_rate,
            "completed_subtasks": self.completed_subtasks,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "TaskInstance":
        sub_tasks = [SubTask.from_dict(st) for st in d.get("sub_tasks", [])]
        return cls(
            task_id=d.get("task_id", ""),
            chapter_id=d.get("chapter_id", ""),
            chapter_name=d.get("chapter_name", ""),
            description=d.get("description", ""),
            sub_tasks=sub_tasks,
            related_npc_ids=d.get("related_npc_ids", []),
            generated_item_ids=d.get("generated_item_ids", []),
            npc_completion_votes=d.get("npc_completion_votes", {}),
            is_completed=d.get("is_completed", False),
        )

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), ensure_ascii=False)

    @classmethod
    def from_json(cls, json_str: str) -> "TaskInstance":
        return cls.from_dict(json.loads(json_str))


# ═══════════════════════════════════════════════════════════════
# NarrativeItem
# ═══════════════════════════════════════════════════════════════

@dataclass
class NarrativeItem:
    id: str
    name: str
    item_type: str = "misc"
    base_description: str = ""
    ai_detail: Optional[str] = None
    ai_detail_locked: bool = False
    is_key: bool = False
    location: Optional[dict] = None
    is_discovered: bool = False
    discovery_context: str = ""
    related_npcs: list[str] = field(default_factory=list)
    npc_knowledge: dict[str, str] = field(default_factory=dict)
    desc_source: str = "fixed"
    stage_relevance: list[int] = field(default_factory=list)
    source_npc: Optional[str] = None
    template_ref: Optional[str] = None
    holdable: bool = True
    acquire_method: str = ""

    def get_display_text(self) -> str:
        parts = [self.base_description]
        if self.ai_detail:
            parts.append(self.ai_detail)
        return "\n".join(parts)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "item_type": self.item_type,
            "base_description": self.base_description,
            "ai_detail": self.ai_detail,
            "ai_detail_locked": self.ai_detail_locked,
            "is_key": self.is_key,
            "location": self.location,
            "is_discovered": self.is_discovered,
            "discovery_context": self.discovery_context,
            "related_npcs": self.related_npcs,
            "npc_knowledge": self.npc_knowledge,
            "desc_source": self.desc_source,
            "stage_relevance": self.stage_relevance,
            "source_npc": self.source_npc,
            "template_ref": self.template_ref,
            "holdable": self.holdable,
            "acquire_method": self.acquire_method,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "NarrativeItem":
        return cls(
            id=d.get("id", d.get("item_id", "")),
            name=d.get("name", d.get("narrative_name", "")),
            item_type=d.get("item_type", d.get("category", "misc")),
            base_description=d.get("base_description", d.get("narrative_desc", "")),
            ai_detail=d.get("ai_detail"),
            ai_detail_locked=d.get("ai_detail_locked", False),
            is_key=d.get("is_key", False),
            location=d.get("location"),
            is_discovered=d.get("is_discovered", False),
            discovery_context=d.get("discovery_context", ""),
            related_npcs=d.get("related_npcs", []),
            npc_knowledge=d.get("npc_knowledge", {}),
            desc_source=d.get("desc_source", "fixed"),
            stage_relevance=d.get("stage_relevance", []),
            source_npc=d.get("source_npc"),
            template_ref=d.get("template_ref"),
            holdable=d.get("holdable", True),
            acquire_method=d.get("acquire_method", ""),
        )


# ═══════════════════════════════════════════════════════════════
# 原有 NPCState / DialogueTurn / GameSession
# ═══════════════════════════════════════════════════════════════

@dataclass
class NPCState:
    """单个 NPC 的运行时状态。"""
    id: str
    name: str
    role: str
    scene: str
    position: dict
    sprite_key: str
    relationship: int = 0
    is_available: bool = True
    current_greeting: str = ""
    dialogue_history: list = field(default_factory=list)
    last_options: list[str] = field(default_factory=list)
    dialogue_round_count: int = 0
    relationship_default: int = 0

    def clamp_relationship(self) -> None:
        self.relationship = max(-100, min(100, self.relationship))

    def apply_delta(self, delta: int) -> None:
        self.relationship += delta
        self.clamp_relationship()


@dataclass
class DialogueTurn:
    """单轮对话记录。"""
    role: str
    content: str
    npc_id: str = ""
    stage: int = 1
    chapter_id: str = ""
    turn_index: int = 0


@dataclass
class GameSession:
    """一次完整的游戏会话（v2：章节驱动架构）。"""
    session_id: str
    player_name: str
    api_key: Optional[str] = None
    model: Optional[str] = None

    # ─── v1 兼容 ────────────────────────────────
    current_stage: int = 1
    npcs: dict = field(default_factory=dict)
    events_triggered: set = field(default_factory=set)
    game_ended: bool = False
    ending_type: Optional[str] = None
    ending_data: Optional[dict] = None
    stage_llm_consecutive: int = 0
    last_active_at: float = 0.0

    # ─── v2 章节 ────────────────────────────────
    script_id: str = "liyuan_shengsi"
    current_chapter_id: Optional[str] = None
    completed_chapters: list[str] = field(default_factory=list)
    current_task: Optional[TaskInstance] = None
    chapter_defs: list[dict] = field(default_factory=list)
    item_defs: list[dict] = field(default_factory=list)
    persona_cache: dict = field(default_factory=dict)
    system_prompt: str = ""

    # ─── v2 物品 ────────────────────────────────
    inventory: list[NarrativeItem] = field(default_factory=list)
    active_item: Optional[str] = None

    # ─── 对话全局序号（用于跨 NPC 时间排序） ──────
    dialogue_turn_counter: int = 0

    # ─── 存档上下文 ─────────────────────────────
    current_save_id: Optional[str] = None

    # ─── AI 生成的章节大纲 ───────────────────────
    chapter_outlines: list[dict] = field(default_factory=list)

    def get_current_chapter(self) -> Optional[dict]:
        """获取当前章节定义。"""
        if not self.current_chapter_id or not self.chapter_defs:
            return None
        for ch in self.chapter_defs:
            if ch.get("id") == self.current_chapter_id:
                return ch
        return None

    def get_next_chapter(self) -> Optional[dict]:
        """获取下一个章节定义（跳过已完成的章节）。"""
        if not self.chapter_defs:
            return None
        current = self.get_current_chapter()
        if current:
            current_order = current.get("sort_order", 0)
        else:
            current_order = -1
        for ch in self.chapter_defs:
            if ch.get("sort_order", 0) > current_order:
                # 跳过已完成的章节
                if ch.get("id") in self.completed_chapters:
                    continue
                return ch
        return None

    def get_inventory_item(self, item_id: str) -> Optional[NarrativeItem]:
        """从背包中查找物品。"""
        for item in self.inventory:
            if item.id == item_id:
                return item
        return None

    def add_to_inventory(self, item: NarrativeItem) -> None:
        if not self.get_inventory_item(item.id):
            self.inventory.append(item)

    def to_api_response(self) -> dict:
        """序列化为 API 响应格式（对话数据从 NPC 内存读取，确保存档隔离）。"""
        stage_params = self._get_stage_params()
        npc_last_dialogues = self._get_last_dialogue_from_memory()
        current_chapter = self.get_current_chapter()

        return {
            "session_id": self.session_id,
            "player_name": self.player_name,
            "script_id": self.script_id,
            "current_stage": self.current_stage,
            "stage_params": stage_params,
            "current_chapter": {
                "chapter_id": self.current_chapter_id,
                "chapter_name": current_chapter.get("name", "") if current_chapter else None,
                "color_tone": current_chapter.get("color_tone", "") if current_chapter else None,
                "bgm_mood": current_chapter.get("bgm_mood", "") if current_chapter else None,
                "completion_rate": self.current_task.completion_rate if self.current_task else None,
            } if current_chapter else None,
            "completed_chapters": self.completed_chapters,
            "npcs": [
                {
                    "id": npc.id,
                    "name": npc.name,
                    "role": npc.role,
                    "scene": npc.scene,
                    "position": npc.position,
                    "sprite_key": npc.sprite_key,
                    "relationship": npc.relationship,
                    "is_available": npc.is_available,
                    "current_greeting": npc.current_greeting,
                    "last_dialogue": npc_last_dialogues.get(npc.id, {}).get("content", ""),
                    "last_options": npc_last_dialogues.get(npc.id, {}).get("options", []),
                    "dialogue_round_count": npc.dialogue_round_count,
                }
                for npc in self.npcs.values()
            ],
            "dialogue_history": self._collect_full_dialogue_history(),
            "current_save_id": self.current_save_id,
            "events_triggered": sorted(self.events_triggered),
            "game_ended": self.game_ended,
            "ending": self.ending_data if self.game_ended else None,
            "inventory": [item.to_dict() for item in self.inventory if item.is_discovered],
        }

    def _get_last_dialogue_from_memory(self) -> dict[str, dict]:
        """从 NPC 内存中获取每个 NPC 最后一条对话（替代 DB 查询，确保存档隔离）。"""
        result = {}
        for npc_id, npc in self.npcs.items():
            history = npc.dialogue_history
            if not history:
                continue
            # 找最后一条 NPC 发言
            last_npc = None
            for dt in reversed(history):
                if dt.role == "npc":
                    last_npc = dt
                    break
            if last_npc:
                result[npc_id] = {
                    "role": last_npc.role,
                    "content": last_npc.content,
                    "options": list(npc.last_options) if npc.last_options else [],
                }
        return result

    def _collect_full_dialogue_history(self) -> list[dict]:
        """收集所有 NPC 的完整对话历史，按 turn_index 全局时间排序后返回。"""
        entries = []
        for npc_id, npc in self.npcs.items():
            for dt in npc.dialogue_history:
                entries.append({
                    "npc_id": npc_id,
                    "npc_name": npc.name,
                    "role": dt.role,
                    "content": dt.content,
                    "stage": dt.stage,
                    "chapter_id": dt.chapter_id,
                    "turn_index": dt.turn_index,
                })
        # 按 turn_index 排序，确保跨 NPC 的时间顺序正确
        return sorted(entries, key=lambda e: e.get("turn_index", 0))

    def _get_stage_params(self) -> dict:
        from config import CHAPTER_TO_STAGE, STAGE_LEGACY_MAP
        ch = self.get_current_chapter()
        if ch:
            return {
                "id": CHAPTER_TO_STAGE.get(self.current_chapter_id, 1),
                "name": ch.get("name", ""),
                "description": ch.get("description", ""),
                "color_tone": ch.get("color_tone", ""),
                "bgm_mood": ch.get("bgm_mood", ""),
                "dialogue_tone": "",
            }
        return STAGE_LEGACY_MAP.get(self.current_stage, STAGE_LEGACY_MAP[1])
