# API 接口清单（单一真相源）

> 所有文档引用本文件获取完整的 API 接口列表。共 **38 个接口**（含世界资产、剧本管理、物品增强）。

## 游戏会话

| # | 方法 | 路径 | 职责 | 响应方式 |
|---|------|------|------|----------|
| 1 | `POST` | `/api/game/start` | 创建新游戏（返回完整状态 + first_chapter 提示） | JSON |
| 2 | `GET` | `/api/game/{session_id}` | 获取完整游戏状态（含每NPC最近对话+选项） | JSON |
| 3 | `POST` | `/api/game/{session_id}/evaluate` | 生成结局评价（幂等） | JSON |
| 4 | `GET` | `/api/game/{session_id}/dialogues` | 分页查询对话历史（含 options） | JSON |
| 5 | `GET` | `/api/game/{session_id}/relationships` | 查询关系值变化历史 | JSON |
| 6 | `GET` | `/api/game/{session_id}/events` | 查询已触发事件的时间线 | JSON |
| 7 | `GET` | `/api/sessions` | 列出所有历史存档 | JSON |
| 8 | `DELETE` | `/api/game/{session_id}` | 软删除存档 | JSON |

## 剧本管理

| # | 方法 | 路径 | 职责 | 响应方式 |
|---|------|------|------|----------|
| 9 | `GET` | `/api/scripts` | 列出所有可用剧本 | JSON |
| 10 | `GET` | `/api/scripts/{script_id}` | 获取单个剧本详情（meta + chapters） | JSON |
| 11 | `POST` | `/api/scripts/generate` | AI 生成微剧本骨架（注入世界场景+物品约束） | JSON |
| 12 | `GET` | `/api/scripts/{script_id}/skeleton` | 获取剧本骨架（章节大纲） | JSON |
| 13 | `PATCH` | `/api/scripts/{script_id}/skeleton` | 修改剧本骨架 | JSON |
| 14 | `GET` | `/api/scripts/{script_id}/chapters` | 获取完整章节列表 | JSON |
| 15 | `GET` | `/api/scripts/{script_id}/items` | 剧本级全量物品查询（无需 session） | JSON |

## 章节

| # | 方法 | 路径 | 职责 | 响应方式 |
|---|------|------|------|----------|
| 16 | `POST` | `/api/game/{session_id}/chapter/start` | 开始/推进章节（有模板则秒级返回） | JSON |
| 17 | `GET` | `/api/game/{session_id}/chapter` | 获取当前章节状态+任务进度 | JSON |
| 18 | `GET` | `/api/game/{session_id}/task` | 获取当前任务详情（子任务列表+NPC投票） | JSON |

## 对话

| # | 方法 | 路径 | 职责 | 响应方式 |
|---|------|------|------|----------|
| 19 | `POST` | `/api/dialogue` | NPC 对话交互（支持自由文本和选项） | SSE 流式 |
| 20 | `POST` | `/api/dialogue/show-item` | 向 NPC 展示物品（注入物品上下文） | SSE 流式 |
| 21 | `POST` | `/api/dialogue/exit` | 显式退出 NPC 对话 | JSON |

## NPC 管理

| # | 方法 | 路径 | 职责 | 响应方式 |
|---|------|------|------|----------|
| 22 | `POST` | `/api/game/{id}/npc/position` | 单个 NPC 位置上报（移动完成） | JSON |
| 23 | `POST` | `/api/game/{id}/npc/positions/batch` | 批量同步 NPC 位置（场景切换/存档） | JSON |
| 24 | `POST` | `/api/game/{id}/npc/spawn` | 运行时动态生成临时 NPC | JSON |

## 世界资产（世界先行，AI 后行）

| # | 方法 | 路径 | 职责 | 响应方式 |
|---|------|------|------|----------|
| 25 | `GET` | `/api/world/scenes` | 获取所有世界场景定义（含连接图/氛围/区域） | JSON |
| 26 | `GET` | `/api/world/items` | 获取所有世界物品（含模板合并，无剧本属性） | JSON |

## 物品

| # | 方法 | 路径 | 职责 | 响应方式 |
|---|------|------|------|----------|
| 27 | `GET` | `/api/game/{id}/items` | 获取物品清单（inventory背包 + scene_items场景） | JSON |
| 28 | `GET` | `/api/game/{id}/item/{item_id}` | 查看单个物品完整详情 | JSON |
| 29 | `POST` | `/api/game/{id}/item/discover` | 发现/拾取物品（标记+AI旁白+入包） | JSON |
| 30 | `GET` | `/api/game/{id}/items/full` | 全量物品（含模板合并+坐标+章节名，不过滤） | JSON |

## 编辑（普通 NPC 管理）

| # | 方法 | 路径 | 职责 | 响应方式 |
|---|------|------|------|----------|
| 31 | `GET` | `/api/scripts/{id}/town-npcs` | 查询普通 NPC 列表 | JSON |
| 32 | `POST` | `/api/scripts/{id}/town-npcs` | 批量创建/覆盖普通 NPC | JSON |
| 33 | `DELETE` | `/api/scripts/{id}/town-npcs/{nid}` | 删除普通 NPC | JSON |
| 34 | `PUT` | `/api/scripts/{id}/town-npcs/{nid}` | 更新普通 NPC 配置 | JSON |

## 存档管理

| # | 方法 | 路径 | 职责 | 响应方式 |
|---|------|------|------|----------|
| 35 | `POST` | `/api/game/{id}/saves` | 创建存档快照（含完整状态+位置） | JSON |
| 36 | `GET` | `/api/game/{id}/saves` | 列出 session 下所有存档 | JSON |
| 37 | `POST` | `/api/game/{id}/saves/{sid}/load` | 从存档恢复完整游戏状态 | JSON |
| 38 | `DELETE` | `/api/game/{id}/saves/{sid}` | 删除指定存档（元数据+文件） | JSON |

> 各接口的详细请求/响应格式见 [后端/API设计文档.md](../后端/API设计文档.md)。
