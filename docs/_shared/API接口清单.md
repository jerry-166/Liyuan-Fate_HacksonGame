# API 接口清单（单一真相源）

> 所有文档引用本文件获取完整的 API 接口列表。共 **10 个接口**。

| # | 方法 | 路径 | 职责 | 响应方式 |
|---|------|------|------|----------|
| 1 | `POST` | `/api/game/start` | 创建新游戏会话 | JSON |
| 2 | `GET` | `/api/game/{session_id}` | 获取完整游戏状态（含每NPC最近对话+选项） | JSON |
| 3 | `POST` | `/api/dialogue` | NPC 对话交互（支持自由文本和选项） | SSE 流式 |
| 4 | `POST` | `/api/game/{session_id}/evaluate` | 生成结局评价（幂等） | JSON |
| 5 | `GET` | `/api/sessions` | 列出所有历史存档 | JSON |
| 6 | `DELETE` | `/api/game/{session_id}` | 软删除存档 | JSON |
| 7 | `GET` | `/api/game/{session_id}/dialogues` | 分页查询对话历史（含 options） | JSON |
| 8 | `POST` | `/api/dialogue/exit` | 显式退出 NPC 对话 | JSON |
| 9 | `GET` | `/api/game/{session_id}/relationships` | 查询关系值变化历史 | JSON |
| 10 | `GET` | `/api/game/{session_id}/events` | 查询已触发事件的时间线 | JSON |

> 各接口的详细请求/响应格式见 [后端/API设计文档.md](../后端/API设计文档.md)。
