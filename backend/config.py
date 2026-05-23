"""
全局配置管理。

API Key 优先级：
  1. 用户前端输入 → 内存存储（当前 session 有效）
  2. 环境变量 TENCENT_LLM_API_KEY（fallback）
  3. 无 Key → 返回错误提示用户输入
"""

import os
from typing import Optional

from dotenv import load_dotenv

# 加载 .env 文件（优先读取系统环境变量，.env 中的值作为兜底）
load_dotenv()


# ─── LLM 配置 ───────────────────────────────────────────

# OpenAI 兼容接口地址（腾讯云 TokenHub / 混元 / DeepSeek 等）
#   TokenHub: https://tokenhub.tencentmaas.com/v1
#   旧版知识引擎: https://api.lkeap.cloud.tencent.com/v1
LLM_BASE_URL: str = os.getenv("LLM_BASE_URL", "https://tokenhub.tencentmaas.com/v1")
LLM_MODEL: str = os.getenv("LLM_MODEL", "deepseek-v4-flash")
LLM_MAX_TOKENS: int = int(os.getenv("LLM_MAX_TOKENS", "1024"))
LLM_TEMPERATURE: float = float(os.getenv("LLM_TEMPERATURE", "0.8"))
# 全局 fallback API Key（从 .env 或系统环境变量读取，不再硬编码）
LLM_API_KEY_FALLBACK: Optional[str] = os.getenv("TENCENT_LLM_API_KEY")

# LLM 调用超时（秒）
LLM_HTTP_TIMEOUT: float = float(os.getenv("LLM_HTTP_TIMEOUT", "60.0"))
LLM_SSE_TIMEOUT: float = float(os.getenv("LLM_SSE_TIMEOUT", "120.0"))


# ─── 游戏配置 ───────────────────────────────────────────

# 游戏阶段定义
STAGES = {
    1: {
        "id": 1,
        "name": "不屑",
        "description": "戏班众人对你冷眼相看，觉得你不过是又一个心血来潮的外人",
        "color_tone": "cold",
        "bgm_mood": "melancholy",
        "dialogue_tone": "冷漠、疏离、话中带刺",
    },
    2: {
        "id": 2,
        "name": "了解",
        "description": "你开始走近这个戏班，有人愿意跟你说几句真心话了",
        "color_tone": "warm",
        "bgm_mood": "hopeful",
        "dialogue_tone": "温和、敞开、偶有真情流露",
    },
    3: {
        "id": 3,
        "name": "抉择",
        "description": "关键的时刻到了，你的选择将决定这个戏班的命运",
        "color_tone": "dramatic",
        "bgm_mood": "intense",
        "dialogue_tone": "情感浓烈、言辞恳切",
    },
}

# 阶段切换规则（硬护栏）
STAGE_RULES = {
    # 1→2：任一 NPC 关系 >= 20，或触发关键事件 chen_tells_past
    1: {
        "min_relationship": 20,
        "key_events": {"chen_tells_past"},
        "min_dialogue_rounds": 3,
    },
    # 2→3：任一 NPC 关系 >= 50，或触发关键事件 shrine_visit
    2: {
        "min_relationship": 50,
        "key_events": {"shrine_visit", "accept_mission"},
        "min_dialogue_rounds": 5,
    },
}

# 关系值变化范围
RELATIONSHIP_CLAMP = (-100, 100)
RELATIONSHIP_DELTA_CLAMP = (-5, 10)      # 单轮对话关系值变化边界
RELATIONSHIP_DEFAULT_DELTA = 3            # LLM 解析失败时的兜底增量
RELATIONSHIP_EVENT_BONUS = 5              # 触发关键事件的额外加分

# 结局触发条件
ENDING_CONDITIONS = {
    "accept_leader": {
        "min_stage": 3,
        "min_relationship_sum": 100,
        "key_events": {"accept_mission"},
    },
}


# ─── 对话控制 ───────────────────────────────────────────

MAX_DIALOGUE_ROUNDS: int = int(os.getenv("MAX_DIALOGUE_ROUNDS", "10"))  # 单次对话最大轮数


# ─── 会话管理 ───────────────────────────────────────────

SESSION_TTL_SECONDS: float = float(os.getenv("SESSION_TTL_SECONDS", "7200"))  # 2 小时
DB_PATH: str = os.getenv("DB_PATH", os.path.join(os.path.dirname(__file__), "game.db"))

# NPC 配置（硬编码，后续可从 YAML 加载）
NPC_DEFS = [
    {
        "id": "npc_chen",
        "name": "陈师傅",
        "role": "老琴师",
        "scene": "tavern",
        "position": {"x": 1200, "y": 800},
        "sprite_key": "npc_chen_idle",
    },
    {
        "id": "npc_xiaohua",
        "name": "小华",
        "role": "年轻学徒",
        "scene": "stage",
        "position": {"x": 600, "y": 400},
        "sprite_key": "npc_xiaohua_idle",
    },
]
