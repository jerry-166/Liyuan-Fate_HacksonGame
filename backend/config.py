"""
全局配置管理 — v2 章节驱动架构。
"""

import os
from typing import Optional
from dotenv import load_dotenv

load_dotenv()

# ─── LLM 配置 ───────────────────────────────────────────

LLM_BASE_URL: str = os.getenv("LLM_BASE_URL", "https://tokenhub.tencentmaas.com/v1")
LLM_MODEL: str = os.getenv("LLM_MODEL", "qwen3.5-flash")
LLM_MAX_TOKENS: int = int(os.getenv("LLM_MAX_TOKENS", "2048"))
LLM_TEMPERATURE: float = float(os.getenv("LLM_TEMPERATURE", "0.8"))
LLM_API_KEY_FALLBACK: Optional[str] = os.getenv("TENCENT_LLM_API_KEY")
LLM_HTTP_TIMEOUT: float = float(os.getenv("LLM_HTTP_TIMEOUT", "60.0"))
LLM_SSE_TIMEOUT: float = float(os.getenv("LLM_SSE_TIMEOUT", "120.0"))

# ─── 游戏配置 ───────────────────────────────────────────

# NPC 配置（5 个 NPC）
# position 使用瓦片坐标 {col, row}，前端通过 COORD.toPixel() 转换为像素坐标
NPC_DEFS = [
    {"id": "npc_chen", "name": "陈师傅", "role": "老琴师",
     "scene": "teahouse", "position": {"col": 38, "row": 14},
     "sprite_key": "npc_chen_idle", "relationship_default": 20},
    {"id": "npc_xiaohua", "name": "小华", "role": "年轻学徒",
     "scene": "stage", "position": {"col": 15, "row": 12},
     "sprite_key": "npc_xiaohua_idle", "relationship_default": 0},
    {"id": "npc_laozhou", "name": "老周", "role": "老艺人",
     "scene": "stage", "position": {"col": 10, "row": 8},
     "sprite_key": "npc_laozhou_idle", "relationship_default": 10},
    {"id": "npc_meiyi", "name": "梅姨", "role": "茶馆老板娘",
     "scene": "teahouse", "position": {"col": 40, "row": 16},
     "sprite_key": "npc_meiyi_idle", "relationship_default": 15},
    {"id": "npc_laoli", "name": "老李", "role": "船夫",
     "scene": "dock", "position": {"col": 60, "row": 22},
     "sprite_key": "npc_laoli_idle", "relationship_default": 10},
]

# 章节到旧阶段的映射（兼容前端色调/BGM 切换）
CHAPTER_TO_STAGE = {
    "ch_prologue": 1,
    "ch_01": 1,
    "ch_02": 1,
    "ch_03": 2,
    "ch_04": 2,
    "ch_05": 3,
}

# 旧阶段参数（兼容前端 to_api_response）
STAGE_LEGACY_MAP = {
    1: {"id": 1, "name": "不屑", "description": "戏班众人对你冷眼相看",
        "color_tone": "cold", "bgm_mood": "melancholy", "dialogue_tone": "冷漠"},
    2: {"id": 2, "name": "了解", "description": "你开始走近这个戏班",
        "color_tone": "warm", "bgm_mood": "hopeful", "dialogue_tone": "温和"},
    3: {"id": 3, "name": "抉择", "description": "关键时刻到了",
        "color_tone": "dramatic", "bgm_mood": "intense", "dialogue_tone": "浓烈"},
}

# 旧 STAGES 字典（兼容引用）
STAGES = STAGE_LEGACY_MAP

# 旧 STAGE_RULES（不再使用，保留空值防止 import 报错）
STAGE_RULES = {}

# ─── 关系值配置 ─────────────────────────────────────────

RELATIONSHIP_CLAMP = (-100, 100)
RELATIONSHIP_DELTA_CLAMP = (-5, 10)
RELATIONSHIP_DEFAULT_DELTA = 3
RELATIONSHIP_EVENT_BONUS = 5

# ─── 结局触发条件（保留兼容）────────────────────────────

ENDING_CONDITIONS = {
    "accept_leader": {
        "min_stage": 3,
        "min_relationship_sum": 100,
        "key_events": {"accept_mission"},
    },
}

# ─── 对话控制 ───────────────────────────────────────────

MAX_DIALOGUE_ROUNDS: int = int(os.getenv("MAX_DIALOGUE_ROUNDS", "10"))

# ─── 会话管理 ───────────────────────────────────────────

SESSION_TTL_SECONDS: float = float(os.getenv("SESSION_TTL_SECONDS", "7200"))
DB_PATH: str = os.getenv("DB_PATH", os.path.join(os.path.dirname(__file__), "game.db"))

# ─── 地图配置 ───────────────────────────────────────────

MAP_COLS: int = 80
MAP_ROWS: int = 50
TILE_SIZE: int = 32

# ─── 剧本路径 ───────────────────────────────────────────

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data")
SCRIPTS_DIR = os.path.join(DATA_DIR, "scripts")
DEFAULT_SCRIPT_ID = "liyuan_shengsi"
