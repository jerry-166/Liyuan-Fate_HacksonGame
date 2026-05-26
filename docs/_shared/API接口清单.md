# API 接口清单（单一真相源）

> 所有文档引用本文件获取完整的 API 接口列表。共 **24 个接口**。

## 游戏会话

| # | 方法 | 路径 | 职责 | 响应方式 |
|---|------|------|------|----------|
| 1 | `POST` | `/api/game/start` | 创建新游戏（返回完整状态 + first_chapter 提示） | JSON |
| 2 | `GET` | `/api/game/{session_id}` | 获取完整游戏状态（含每NPC最近对话+选项） | JSON |
| 3 | `GET` | `/api/scripts` | 列出所有可用剧本 | JSON |
| 4 | `POST` | `/api/game/{session_id}/evaluate` | 生成结局评价（幂等） | JSON |
| 5 | `GET` | `/api/game/{session_id}/dialogues` | 分页查询对话历史（含 options） | JSON |
| 6 | `GET` | `/api/game/{session_id}/relationships` | 查询关系值变化历史 | JSON |
| 7 | `GET` | `/api/game/{session_id}/events` | 查询已触发事件的时间线 | JSON |
| 8 | `GET` | `/api/sessions` | 列出所有历史存档 | JSON |
| 9 | `DELETE` | `/api/game/{session_id}` | 软删除存档 | JSON |

## 章节

| # | 方法 | 路径 | 职责 | 响应方式 |
|---|------|------|------|----------|
| 10 | `POST` | `/api/game/{session_id}/chapter/start` | 开始/推进章节（有模板则秒级返回） | JSON |
| 11 | `GET` | `/api/game/{session_id}/chapter` | 获取当前章节状态+任务进度 | JSON |
| 12 | `GET` | `/api/game/{session_id}/task` | 获取当前任务详情（子任务列表+NPC投票） | JSON |

## 对话

| # | 方法 | 路径 | 职责 | 响应方式 |
|---|------|------|------|----------|
| 13 | `POST` | `/api/dialogue` | NPC 对话交互（支持自由文本和选项） | SSE 流式 |
| 14 | `POST` | `/api/dialogue/show-item` | 向 NPC 展示物品（注入物品上下文） | SSE 流式 |
| 15 | `POST` | `/api/dialogue/exit` | 显式退出 NPC 对话 | JSON |

## NPC 管理

| # | 方法 | 路径 | 职责 | 响应方式 |
|---|------|------|------|----------|
| 16 | `POST` | `/api/game/{id}/npc/position` | 单个 NPC 位置上报（移动完成） | JSON |
| 17 | `POST` | `/api/game/{id}/npc/positions/batch` | 批量同步 NPC 位置（场景切换/存档） | JSON |
| 18 | `POST` | `/api/game/{id}/npc/spawn` | 运行时动态生成临时 NPC | JSON |

## 物品

| # | 方法 | 路径 | 职责 | 响应方式 |
|---|------|------|------|----------|
| 19 | `GET` | `/api/game/{id}/items` | 获取物品清单（inventory背包 + scene_items场景） | JSON |
| 20 | `GET` | `/api/game/{id}/item/{item_id}` | 查看单个物品完整详情 | JSON |
| 21 | `POST` | `/api/game/{id}/item/discover` | 发现/拾取物品（标记+AI旁白+入包） | JSON |

## 编辑（普通 NPC 管理）

| # | 方法 | 路径 | 职责 | 响应方式 |
|---|------|------|------|----------|
| 22 | `GET` | `/api/scripts/{id}/town-npcs` | 查询普通 NPC 列表 | JSON |
| 23 | `POST` | `/api/scripts/{id}/town-npcs` | 批量创建/覆盖普通 NPC | JSON |
| 24 | `DELETE` | `/api/scripts/{id}/town-npcs/{nid}` | 删除普通 NPC | JSON |

> 各接口的详细请求/响应格式见 [后端/API设计文档.md](../后端/API设计文档.md)。
