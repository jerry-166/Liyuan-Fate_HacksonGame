"""
剧本加载器 — 读取并校验一个剧本的全部数据。

支持多剧本切换，每个剧本有独立的 meta.yaml / chapters / items / personas。
"""

import os
import yaml
import logging
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

SCRIPTS_DIR = Path(__file__).resolve().parent.parent.parent / "data" / "scripts"


class ScriptValidationError(Exception):
    pass


class ScriptLoader:
    def __init__(self, scripts_dir: Path = SCRIPTS_DIR):
        self.scripts_dir = scripts_dir

    def list_scripts(self) -> list[dict]:
        scripts = []
        if not self.scripts_dir.exists():
            return scripts
        for d in sorted(self.scripts_dir.iterdir()):
            meta_file = d / "meta.yaml"
            if meta_file.exists():
                meta = self._load_yaml(meta_file)
                if meta:
                    chapters = meta.get("chapters_file", "")
                    chapter_count = 0
                    ch_file = d / chapters
                    if ch_file.exists():
                        ch_data = self._load_yaml(ch_file)
                        if isinstance(ch_data, dict):
                            chapter_count = len(ch_data.get("chapters", []))
                        elif isinstance(ch_data, list):
                            chapter_count = len(ch_data)
                    scripts.append({
                        "script_id": meta.get("script_id", d.name),
                        "name": meta.get("name", d.name),
                        "version": meta.get("version", "1.0"),
                        "author": meta.get("author", ""),
                        "npc_count": len(meta.get("npcs", [])),
                        "chapter_count": chapter_count,
                        "description": meta.get("worldview", "")[:100].strip(),
                    })
        return scripts

    def load_script(self, script_id: str) -> dict:
        script_dir = self.scripts_dir / script_id
        if not script_dir.exists():
            raise ScriptValidationError(f"剧本目录不存在: {script_dir}")

        meta = self._load_yaml(script_dir / "meta.yaml")
        if not meta:
            raise ScriptValidationError(f"meta.yaml 解析失败: {script_dir}/meta.yaml")

        # 加载世界观 Prompt
        system_prompt = ""
        spf = meta.get("system_prompt_file") or "system_base.txt"
        prompt_file = script_dir / spf
        if prompt_file.exists():
            system_prompt = prompt_file.read_text(encoding="utf-8")
        else:
            global_prompt = Path(__file__).resolve().parent.parent / "prompts" / "system_base.txt"
            if global_prompt.exists():
                system_prompt = global_prompt.read_text(encoding="utf-8")

        # 加载章节
        chapters = []
        cf = meta.get("chapters_file") or "chapters.yaml"
        chapters_file = script_dir / cf
        if chapters_file.exists():
            raw = self._load_yaml(chapters_file)
            if isinstance(raw, dict):
                chapters = raw.get("chapters", [])
            elif isinstance(raw, list):
                chapters = raw

        # 加载物品
        items = []
        ifl = meta.get("items_file") or "items/story_items.yaml"
        items_file = script_dir / ifl
        if items_file.exists():
            raw = self._load_yaml(items_file)
            if isinstance(raw, dict):
                items = raw.get("items", [])
            elif isinstance(raw, list):
                items = raw

        # 加载 NPC 人设
        personas = {}
        pd = meta.get("persona_dir") or "personas"
        persona_dir = script_dir / pd
        for npc_def in meta.get("npcs", []):
            persona_file = npc_def.get("persona_file", f"{npc_def['id']}.yaml")
            p_path = persona_dir / persona_file
            if p_path.exists():
                personas[npc_def["id"]] = self._load_yaml(p_path)

        # 加载 Prompt 覆盖
        prompt_overrides = {}
        for key, file_path in meta.get("prompt_overrides", {}).items():
            if file_path:
                p = script_dir / file_path
                if p.exists():
                    prompt_overrides[key] = p.read_text(encoding="utf-8")

        self._validate(meta, chapters, items, personas)

        return {
            "meta": meta,
            "system_prompt": system_prompt,
            "chapters": chapters,
            "items": items,
            "personas": personas,
            "prompt_overrides": prompt_overrides,
        }

    def _validate(self, meta, chapters, items, personas):
        npc_ids = {npc["id"] for npc in meta.get("npcs", [])}
        item_ids = {item.get("id", item.get("item_id", "")) for item in items}
        errors = []

        for ch in chapters:
            ch_id = ch.get("id", "unknown")
            for npc_id in ch.get("required_npcs", []):
                if npc_id not in npc_ids:
                    errors.append(f"章节 {ch_id} 引用不存在的 NPC: {npc_id}")
            for item_id in ch.get("required_items", []):
                if item_id not in item_ids:
                    errors.append(f"章节 {ch_id} 引用不存在的物品: {item_id}")
            for st in ch.get("sub_task_templates", []):
                if st.get("target_npc_id") and st["target_npc_id"] not in npc_ids:
                    errors.append(f"章节 {ch_id} 子任务引用无效 NPC: {st['target_npc_id']}")
                if st.get("required_item_id") and st["required_item_id"] not in item_ids:
                    errors.append(f"章节 {ch_id} 子任务引用无效物品: {st['required_item_id']}")

        if errors:
            raise ScriptValidationError(
                f"剧本校验失败 ({len(errors)} 个错误):\n" + "\n".join(errors)
            )

    def _load_yaml(self, path: Path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                return yaml.safe_load(f)
        except Exception as e:
            logger.error(f"[ScriptLoader] 加载 YAML 失败: {path} → {e}")
            return None
