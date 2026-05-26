用户在问后端接口或文件是否需要更新。结合之前的讨论，我们已经确认：

1. 后端代码不需要改（没有硬编码地图尺寸）
2. 但数据层面的位置值需要更新

让我检查一下具体哪些文件涉及位置数据，需要同步更新。
让我全面排查一遍所有涉及位置数据的文件，给你一个精确的更新清单。
现在我有了完整的信息。让我检查后端数据库相关的代码，看看位置数据是怎么存储的。
让我再确认一下后端存储层和前端 Mock 数据：
现在我有了完整的信息，可以给用户一个精确的更新清单了。让我总结所有需要更新的文件和位置。
现在全部排查完了！给你一份精确到**行号级别**的更新清单。

---

## 完整文件更新清单

### 📊 一览表

| # | 文件 | 需要改什么 | 改动量 |
|---|------|-----------|:---:|
| 1 | **`data/scripts/.../meta.yaml`** | 5 个 NPC 的 `position {col, row}` | **必须** |
| 2 | **`data/scripts/.../items/story_items.yaml`** | 9 个物品的 `location.position {col, row}` | **必须** |
| 3 | **`backend/config.py`** | `NPC_DEFS` 中 5 个 NPC position（与 meta.yaml 同步） | **必须** |
| 4 | **`frontend/src/api/client.js`** | Mock 数据中 5 个 NPC position + 物品位置 | **必须** |
| 5 | **`frontend/src/scenes/GameScene.js`** | 玩家出生点 + createNPCs 默认位置 | **建议** |
| 6 | **`frontend/src/config.js`** | 如果 TILE_SIZE 变了要改这里 | 看情况 |
| 7 | **`docs/_shared/坐标体系.md`** | 第七章位置表 | 建议同步 |
| ~~8~~ | ~~`backend/routes/chapter.py`~~ | ~~不需要改~~ | ❌ |
| ~~9~~ | ~~`backend/state/session.py`~~ | ~~不需要改~~ | ❌ |
| ~~10~~ | ~~`backend/storage/database.py`~~ | ~~不需要改~~ | ❌ |

---

### 逐文件详细说明

#### ✅ 1. `data/scripts/liyuan_shengsi/meta.yaml` — 数据源（权威）

```22:60:data/scripts/liyuan_shengsi/meta.yaml
npcs:
  - id: "npc_chen"
    position: {col: ___, row: ___}   ← 第27行 改
  - id: "npc_xiaohua"  
    position: {col: ___, row: ___}   ← 第35行 改
  - id: "npc_laozhou"
    position: {col: ___, row: ___}   ← 第43行 改
  - id: "npc_meiyi"
    position: {col: ___, row: ___}   ← 第51行 改
  - id: "npc_laoli"
    position: {col: ___, row: ___}   ← 第59行 改
```

#### ✅ 2. `data/scripts/liyuan_shengsi/items/story_items.yaml` — 物品位置

```42:167:data/scripts/liyuan_shengsi/items/story_items.yaml
item_child_costume     location: ...position: {col: ___, row: ___}   ← 第42行
item_father_script     location: ...position: {col: ___, row: ___}   ← 第58行
item_childhood_photo   location: ...position: {col: ___, row: ___}   ← 第73行
item_father_single_photo location: ...position:{col: ___, row: ___}  ← 第91行
item_genealogy         location: ...position: {col: ___, row: ___}   ← 第106行
item_old_trunk         location: ...position: {col: ___, row: ___}   ← 第119行
item_old_jinghu        location: ...position: {col: ___, row: ___}   ← 第137行
item_stage_group_photo location: ...position:{col: ___, row: ___}   ← 第152行
item_temple_tablet     location: ...position: {col: ___, row: ___}   ← 第167行
```

#### ✅ 3. `backend/config.py` — 后端硬编码 NPC 定义

```24:39:backend/config.py
NPC_DEFS = [
    {"id": "npc_chen", ..., "position": {"col": ___, "row": ___}},   ← 第27行
    {"id": "npc_xiaohua", ..., "position": {"col": ___, "row": ___}},← 第30行
    {"id": "npc_laozhou", ..., "position": {"col": ___, "row": ___}},← 第33行
    {"id": "npc_meiyi", ..., "position": {"col": ___, "row": ___}},  ← 第36行
    {"id": "npc_laoli", ..., "position": {"col": ___, "row": ___}},  ← 第39行
]
```

> **注意**：这个文件是后端的"兜底配置"。正常流程下，`manager.py` 从 `meta.yaml` 读取位置：
> 
> ```60:backend/state/manager.py
> position=npc_def.get("position", {}),   ← 从 meta.yaml 读入
> ```
> 但如果 meta.yaml 加载失败，会用 config.py 的硬编码值兜底。所以**两处都要保持一致**。

#### ✅ 4. `frontend/src/api/client.js` — Mock 数据

Mock 数据里的 NPC 位置也需要同步：

```javascript
// client.js Mock 数据中的 npcs 数组
// 5 个 NPC 各有一个 position: { col: __, row: __ }  → 全部更新
```

#### ⚠️ 5. `frontend/src/scenes/GameScene.js` — 硬编码默认值

有两处硬编码的位置值，建议一起更新：

```479:483:frontend/src/scenes/GameScene.js
// createNPCSprite() 中的默认位置
const defaultPos = npcId === 'npc_chen' ? { col: ___, row: ___ } : { col: ___, row: ___ };
// ↑ 这两个 fallback 值要跟新图对齐
```

```979:983:frontend/src/scenes/GameScene.js
// createNPCs() 中的初始 NPC 列表（只有2个）
{ id: 'npc_chen', name: '陈师傅', ...COORD.toPixel(___, ___), greeting: '...' },
{ id: 'npc_xiaohua', name: '小华', ...COORD.toPixel(___, ___), greeting: '...' },
```

```794:frontend/src/scenes/GameScene.js
// createPlayer() 玩家出生点
const { x: startX, y: startY } = COORD.toPixel(___, ___);  // 当前是 (44, 28)
```

#### ⚠️ 6. `frontend/src/config.js` — TILE_SIZE（可能需要改）

```7:frontend/src/config.js
TILE_SIZE: 16,   // ← 如果新图每格像素不是 16 就要改
PLAYER_SPEED: 160, // ← 如果 TILE_SIZE 变了，速度也要同比调整
```

#### 📝 7. `docs/_shared/坐标体系.md` — 文档同步

第七章的实体位置表：

```232:252:docs/_shared/坐标体系.md
# 七、当前实体初始位置表
# NPC 位置表（5行）→ 全部更新 col/row 和像素换算值
# 物品位置表（9行）→ 全部更新
```

---

### 后端不需要动的文件（解释原因）

| 文件 | 为什么不用改 |
|------|------------|
| `backend/state/session.py` | `NPCState.position: dict` 是通用字典，不硬编码数值 |
| `backend/storage/database.py` | 用 `json.dumps(item.get("location", {}).get("position", {}))` 存储任意 JSON，格式无关 |
| `backend/state/manager.py` | `position=npc_def.get("position", {})` 直接从 meta.yaml 拿值，透传 |
| `backend/routes/chapter.py` | 不涉及任何位置逻辑 |
| `backend/main.py` / `agents/*.py` | 无地图相关代码 |

---

### 操作顺序建议

```
步骤 1: 你同伴确定新图的参数
        ├── MAP_COLS × MAP_ROWS（总格子数）
        ├── TILE_SIZE（每格像素数）
        └── 所有地标/NPC/物品的 tile 坐标
        
步骤 2: 他填写 frontend/位置清单.yaml（你已创建）

步骤 3: 你拿到清单后，按以下顺序一次性更新
        ① data/scripts/.../meta.yaml          ← 数据权威源
        ② data/scripts/.../items/story_items.yaml  ← 数据权威源  
        ③ backend/config.py                   ← 与①同步
        ④ frontend/src/api/client.js           ← Mock数据同步
        ⑤ frontend/src/scenes/GameScene.js     ← 默认值同步
        ⑥ frontend/src/config.js               ← TILE_SIZE（如需）
        ⑦ docs/_shared/坐标体系.md             ← 文档记录
        
步骤 4: git commit + push
```

一句话：**后端代码一行不动，只需要把新的 `{col, row}` 数值填进 6 个文件的对应位置就行。**