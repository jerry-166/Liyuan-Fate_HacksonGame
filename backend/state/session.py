"""
游戏会话数据类 — GameSession 和 NPCState 的纯数据结构定义。
"""

from dataclasses import dataclass, field
from typing import Optional


@dataclass
class NPCState:
    """单个 NPC 的运行时状态。"""
    id: str
    name: str
    role: str
    scene: str
    position: dict  # {"x": int, "y": int}
    sprite_key: str
    relationship: int = 0
    is_available: bool = True
    current_greeting: str = ""
    # 对话历史（最近 N 轮，仅内存）
    dialogue_history: list = field(default_factory=list)
    # 上次对话的选项（持久化用）
    last_options: list[str] = field(default_factory=list)
    # 当前对话轮数计数器（同一 NPC 连续对话轮数）
    dialogue_round_count: int = 0

    def clamp_relationship(self) -> None:
        """将关系值 clamp 在 [-100, 100] 范围内。"""
        self.relationship = max(-100, min(100, self.relationship))

    def apply_delta(self, delta: int) -> None:
        """施加关系值变化并 clamp。"""
        self.relationship += delta
        self.clamp_relationship()


@dataclass
class DialogueTurn:
    """单轮对话记录。"""
    role: str        # "player" | "npc"
    content: str
    npc_id: str = ""
    stage: int = 1


@dataclass
class GameSession:
    """一次完整的游戏会话（内存热数据）。"""
    session_id: str
    player_name: str
    api_key: Optional[str] = None  # 仅内存，不持久化
    model: Optional[str] = None    # 仅内存，不持久化，None=使用 config 默认模型

    current_stage: int = 1
    npcs: dict = field(default_factory=dict)          # npc_id → NPCState
    events_triggered: set = field(default_factory=set)
    game_ended: bool = False
    ending_type: Optional[str] = None
    ending_data: Optional[dict] = None                # 缓存的结局评价

    # 阶段判定辅助
    stage_llm_consecutive: int = 0   # LLM 连续判定推进的轮数（≥2 才切换）
    last_active_at: float = 0.0      # TTL 淘汰依据

    def to_api_response(self) -> dict:
        """序列化为 API 响应格式（与 API 文档完全对齐）。"""
        stage_params = self._get_stage_params()

        # 查询每个 NPC 的最近对话
        npc_last_dialogues = self._get_npc_last_dialogues()

        return {
            "session_id": self.session_id,
            "player_name": self.player_name,
            "current_stage": self.current_stage,
            "stage_params": stage_params,
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
            "events_triggered": sorted(self.events_triggered),
            "game_ended": self.game_ended,
            "ending": self.ending_data if self.game_ended else None,
        }

    def _get_npc_last_dialogues(self) -> dict[str, dict]:
        """从 DB 查询每个 NPC 最近一条对话。"""
        try:
            from storage.database import get_db
            return get_db().get_last_dialogue_per_npc(self.session_id)
        except Exception:
            return {}

    def _get_stage_params(self) -> dict:
        """获取当前阶段的参数描述。"""
        from config import STAGES
        return STAGES.get(self.current_stage, STAGES[1])
