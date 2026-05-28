"""
编辑器配置路由 — 碰撞信息、NPC初始位置、场景入口、物品位置、出生点。
这些是创建新存档时的初始模板数据，与游戏存档（saves/）完全分离。
保存位置：data/editor_config/{script_id}.json
"""

import json
import logging
import os
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from config import DATA_DIR, DEFAULT_SCRIPT_ID

router = APIRouter()
logger = logging.getLogger(__name__)

EDITOR_CONFIG_DIR = os.path.join(DATA_DIR, "editor_config")


def _ensure_config_dir():
    """确保编辑器配置目录存在。"""
    os.makedirs(EDITOR_CONFIG_DIR, exist_ok=True)


def _get_config_path(script_id: str = DEFAULT_SCRIPT_ID) -> str:
    """获取编辑器配置文件路径。"""
    _ensure_config_dir()
    return os.path.join(EDITOR_CONFIG_DIR, f"{script_id}.json")


# ─── 请求/响应模型 ────────────────────────────────────────

class EditorConfigPayload(BaseModel):
    """编辑器配置全部内容。使用 dict 存储各子场景的配置。"""
    data: dict  # { "_main": {...}, "stage": {...}, ... }


class SaveEditorConfigRequest(BaseModel):
    script_id: str = DEFAULT_SCRIPT_ID
    data: dict  # { "_main": {...}, "stage": {...}, ... }


class LoadEditorConfigResponse(BaseModel):
    script_id: str
    data: dict
    updated_at: Optional[str] = None


# ─── API 端点 ─────────────────────────────────────────────

@router.get("/editor/config", response_model=LoadEditorConfigResponse)
def load_editor_config(script_id: str = DEFAULT_SCRIPT_ID):
    """
    加载指定剧本的编辑器配置（碰撞/NPC初始位置/场景入口/物品位置/出生点）。
    返回空配置如果文件不存在。
    """
    config_path = _get_config_path(script_id)
    if not os.path.exists(config_path):
        return LoadEditorConfigResponse(script_id=script_id, data={})

    try:
        with open(config_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        mtime = os.path.getmtime(config_path)
        from datetime import datetime
        updated_at = datetime.fromtimestamp(mtime).isoformat()
        return LoadEditorConfigResponse(
            script_id=script_id,
            data=data.get("data", data),  # 兼容旧格式
            updated_at=updated_at,
        )
    except (json.JSONDecodeError, OSError) as e:
        logger.error(f"[Editor] 读取配置文件失败: {config_path}, {e}")
        raise HTTPException(status_code=500, detail=f"读取编辑器配置失败: {e}")


@router.post("/editor/config")
def save_editor_config(req: SaveEditorConfigRequest):
    """
    保存编辑器配置到磁盘文件。
    此数据是创建新存档时的初始模板，与游戏存档（saves/）完全独立。
    """
    _ensure_config_dir()
    config_path = _get_config_path(req.script_id)

    try:
        payload = {
            "script_id": req.script_id,
            "data": req.data,
        }
        with open(config_path, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2, default=str)
        logger.info(
            f"[Editor] 配置已保存: {config_path} "
            f"(子场景: {list(req.data.keys())})"
        )
        return {"status": "ok", "path": config_path, "scenes": list(req.data.keys())}
    except OSError as e:
        logger.error(f"[Editor] 保存配置失败: {config_path}, {e}")
        raise HTTPException(status_code=500, detail=f"保存编辑器配置失败: {e}")
