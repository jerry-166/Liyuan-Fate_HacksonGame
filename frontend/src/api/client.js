/**
 * API 客户端 — 封装所有后端通信（v2 章节驱动版）
 * 共 25 个接口，USE_MOCK=true 时使用 Mock 数据
 *
 * 模块职责：
 * - 网络请求封装（所有 fetch 调用统一在此）
 * - Mock 模式路由（USE_MOCK 控制是否走 Mock 数据）
 * - 本地存储辅助（localStorage 持久化 + 存档槽位管理）
 *
 * @module api/client
 */

import { parseSSEStream } from './sse-parser.js';
import {
  MOCK_START, MOCK_SSE_POOLS, MOCK_CHAPTERS,
  MOCK_INVENTORY, MOCK_SCENE_ITEMS, MOCK_SESSIONS, MOCK_TOWN_NPCS,
  mockTownNpcsData, mockDialogueRounds,
  mockChapterIdx, mockChapterCompleted,
} from './mock-data.js';

// ========== 基础常量 ==========
const BASE = '/api';

// ========== Mock 模式控制 ==========
let USE_MOCK = import.meta.env.VITE_USE_MOCK !== 'false';

/** 切换 Mock 模式 */
export function setUseMock(useMock) {
  USE_MOCK = useMock;
}

// ========== 工具函数 ==========

/**
 * 从 HTTP 错误响应中提取人类可读的错误消息
 * 后端返回 FastAPI 格式：{"detail": {"error": true, "code": "...", "message": "..."}}
 */
async function _extractApiError(res) {
  try {
    const body = await res.json();
    const msg = body?.detail?.message;
    if (msg) return msg;
    return `服务器错误 (${res.status})`;
  } catch {
    try {
      return await res.text() || `服务器错误 (${res.status})`;
    } catch {
      return `服务器错误 (${res.status})`;
    }
  }
}

// ========== 本地持久化辅助 ==========

/** 将游戏状态持久化到 localStorage */
export function saveGameState(sessionId, state) {
  try {
    localStorage.setItem(`game_state_${sessionId}`, JSON.stringify(state));
  } catch (e) {
    console.warn('[API] 保存游戏状态失败:', e);
  }
}

// ========== SSE 流解析器（重新导出） ==========
export { parseSSEStream };

// ==================== 游戏会话 API ====================

/** 创建新游戏会话 */
export async function startGame(playerName = '玩家', scriptId = 'liyuan_shengsi') {
  if (USE_MOCK) {
    // 重置全局 mock 状态
    import('./mock-data.js').then(m => m.resetMockChapterState());
    const sid = `mock_${Date.now()}`;
    const state = { ...MOCK_START, player_name: playerName, session_id: sid, script_id: scriptId };
    MOCK_SESSIONS.unshift({
      session_id: sid, player_name: playerName, stage: 1, stage_name: '归乡',
      game_ended: false, created_at: new Date().toISOString().replace('T', ' ').slice(0, 19),
      updated_at: new Date().toISOString().replace('T', ' ').slice(0, 19),
    });
    return state;
  }
  const res = await fetch(`${BASE}/game/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ player_name: playerName, script_id: scriptId })
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

/** 获取游戏状态 */
export async function getGameState(sessionId) {
  if (USE_MOCK) {
    const saved = localStorage.getItem(`game_state_${sessionId}`);
    if (saved) {
      try { return JSON.parse(saved); } catch (e) { /* fall through */ }
    }
    return { ...MOCK_START, session_id: sessionId };
  }
  const res = await fetch(`${BASE}/game/${sessionId}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

/** 获取剧本列表 */
export async function getScripts() {
  if (USE_MOCK) {
    return {
      scripts: [{
        script_id: 'liyuan_shengsi', name: '梨园生死', version: '1.0',
        author: 'Team A', npc_count: 5, chapter_count: 6,
        description: '江南水乡小镇梨溪镇，民国时期。'
      }], total: 1
    };
  }
  const res = await fetch(`${BASE}/scripts`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ==================== 存档管理 API ====================

/** 获取存档列表 */
export async function getSessions() {
  if (USE_MOCK) {
    return { sessions: MOCK_SESSIONS, total: MOCK_SESSIONS.length };
  }
  const res = await fetch(`${BASE}/sessions`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

/** 删除指定存档 */
export async function deleteSession(sessionId) {
  if (USE_MOCK) {
    const idx = MOCK_SESSIONS.findIndex(s => s.session_id === sessionId);
    if (idx >= 0) MOCK_SESSIONS.splice(idx, 1);
    localStorage.removeItem(`game_state_${sessionId}`);
    return { success: true, message: `已删除会话: ${sessionId}` };
  }
  const res = await fetch(`${BASE}/game/${sessionId}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ==================== 章节 API ====================

/** 开始/推进章节 */
export async function startChapter(sessionId, chapterId = null) {
  if (USE_MOCK) {
    if (chapterId) {
      const m = await import('./mock-data.js');
      m.mockChapterIdx = MOCK_CHAPTERS.findIndex(c => c.chapter_id === chapterId);
    }
    // 跳过 cinematic 类型
    while (mockChapterIdx < MOCK_CHAPTERS.length) {
      const ch = MOCK_CHAPTERS[mockChapterIdx];
      if (ch.type !== 'cinematic') break;
      mockChapterCompleted.add(ch.chapter_id);
      mockChapterIdx++;
    }
    if (mockChapterIdx >= MOCK_CHAPTERS.length) {
      return { chapter_id: null, game_ended: true, message: '所有章节已完成' };
    }
    const ch = MOCK_CHAPTERS[mockChapterIdx];
    const subTasks = [
      { id: 'st_001', title: `探索${ch.name}`, mode: 'explore',
        description: `进入场景，感受${ch.name}的氛围`, status: 'active', target_scene: null },
      { id: 'st_002', title: '与关键人物对话', mode: 'dialogue',
        description: '找到NPC获取信息', status: 'locked', target_npc_id: 'npc_chen' },
    ];
    return {
      chapter_id: ch.chapter_id, chapter_name: ch.name, chapter_type: ch.type,
      task: {
        task_id: `task_${ch.chapter_id}_${Date.now().toString(36)}`,
        chapter_id: ch.chapter_id, chapter_name: ch.name,
        description: ch.description, sub_tasks: subTasks,
        related_npc_ids: ['npc_chen', 'npc_xiaohua', 'npc_laozhou'],
        npc_completion_votes: { npc_chen: false, npc_xiaohua: false, npc_laozhou: false },
        completion_rate: 0, is_completed: false
      },
      color_tone: ch.color_tone, bgm_mood: ch.bgm_mood
    };
  }
  const res = await fetch(`${BASE}/game/${sessionId}/chapter/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chapter_id: chapterId })
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

/** 获取当前章节信息 */
export async function getChapter(sessionId) {
  if (USE_MOCK) {
    if (mockChapterIdx < MOCK_CHAPTERS.length) {
      const ch = MOCK_CHAPTERS[mockChapterIdx];
      return {
        current_chapter: {
          chapter_id: ch.chapter_id, chapter_name: ch.name,
          chapter_type: ch.type, color_tone: ch.color_tone, bgm_mood: ch.bgm_mood
        },
        completed_chapters: [...mockChapterCompleted],
        task: {
          task_id: `task_${ch.chapter_id}`,
          completion_rate: 0.3, is_completed: false,
          sub_tasks: [
            { id: 'st_001', title: `探索${ch.name}`, mode: 'explore', status: 'active' },
            { id: 'st_002', title: '与关键人物对话', mode: 'dialogue', status: 'locked' },
          ]
        }
      };
    }
    return { current_chapter: null, completed_chapters: [...mockChapterCompleted], task: null };
  }
  const res = await fetch(`${BASE}/game/${sessionId}/chapter`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

/** 获取当前任务 */
export async function getTask(sessionId) {
  if (USE_MOCK) {
    if (mockChapterIdx < MOCK_CHAPTERS.length) {
      const ch = MOCK_CHAPTERS[mockChapterIdx];
      return {
        task: {
          task_id: `task_${ch.chapter_id}`,
          chapter_id: ch.chapter_id, chapter_name: ch.name,
          description: ch.description,
          sub_tasks: [
            { id: 'st_001', title: `探索${ch.name}`, mode: 'explore', description: ch.description,
              status: 'in_progress', target_scene: null },
            { id: 'st_002', title: '与关键人物对话', mode: 'dialogue',
              description: '找到NPC获取信息', status: 'locked', target_npc_id: 'npc_chen' },
          ],
          related_npc_ids: ['npc_chen', 'npc_xiaohua', 'npc_laozhou'],
          npc_completion_votes: { npc_chen: true, npc_xiaohua: false, npc_laozhou: false },
          completion_rate: 0.5, is_completed: false
        }
      };
    }
    return { task: null };
  }
  const res = await fetch(`${BASE}/game/${sessionId}/task`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ==================== 对话 API ====================

/**
 * 根据 NPC ID 和轮次选择 Mock SSE 场景
 */
function selectMockScene(npcId, playerMessage) {
  const key = `${npcId}_round`;
  const round = mockDialogueRounds[key] || 0;
  mockDialogueRounds[key] = round + 1;

  if (!playerMessage) {
    const firstMap = {
      'npc_chen': 'first_chen', 'npc_xiaohua': 'first_xiaohua', 'npc_laozhou': 'first_laozhou'
    };
    return firstMap[npcId] || 'first_default';
  }

  const scenes = ['continue_normal', 'chapter_complete', 'ending_trigger', 'no_options'];
  const idx = Math.min(round - 1, scenes.length - 1);
  return scenes[idx];
}

/**
 * 创建 Mock SSE ReadableStream
 */
function createMockSSEStream(sessionId, npcId, playerMessage) {
  const scene = selectMockScene(npcId, playerMessage);
  const events = MOCK_SSE_POOLS[scene] || MOCK_SSE_POOLS.continue_normal;

  let index = 0;
  return new ReadableStream({
    pull(controller) {
      if (index < events.length) {
        return new Promise(resolve => {
          const isLast = events[index].event === 'done';
          const delay = isLast ? 100 : (120 + Math.random() * 150);
          setTimeout(() => {
            const raw = `event: ${events[index].event}\ndata: ${JSON.stringify(events[index].data)}\n`;
            controller.enqueue(new TextEncoder().encode(raw));
            index++;
            resolve();
          }, delay);
        });
      } else {
        controller.close();
      }
    }
  });
}

/** 发起 SSE 流式对话 */
export async function startDialogueStream(sessionId, npcId, playerMessage = null) {
  if (USE_MOCK) {
    return createMockSSEStream(sessionId, npcId, playerMessage);
  }
  const res = await fetch(`${BASE}/dialogue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId, npc_id: npcId, player_message: playerMessage })
  });
  if (!res.ok) throw new Error(await _extractApiError(res));
  return res.body;
}

/** 展示物品给 NPC（SSE 流式） */
export async function showItemToNpcStream(sessionId, npcId, itemId, playerMessage = null) {
  if (USE_MOCK) {
    return createMockSSEStream(sessionId, npcId, `[展示了物品:${itemId}]`);
  }
  const res = await fetch(`${BASE}/dialogue/show-item`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId, npc_id: npcId, item_id: itemId, player_message: playerMessage })
  });
  if (!res.ok) throw new Error(await _extractApiError(res));
  return res.body;
}

/** 退出对话 */
export async function exitDialogue(sessionId, npcId) {
  if (USE_MOCK) {
    return { dialogue_text: '行吧，时候不早了，你去忙你的。', options: [], is_available: true };
  }
  const res = await fetch(`${BASE}/dialogue/exit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId, npc_id: npcId })
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

/** 获取对话历史 */
export async function getDialogues(sessionId, npcId = null, page = 1, pageSize = 20) {
  if (USE_MOCK) {
    const items = [
      { id: 1, session_id: sessionId, npc_id: 'npc_chen', role: 'npc',
        content: '……（陈师傅低头擦拭琴弦，仿佛没看见你）',
        options: ['陈师傅好', '默默站在一旁'], stage: 1, created_at: '2026-05-25 10:01:00' },
      { id: 2, session_id: sessionId, npc_id: 'npc_chen', role: 'player',
        content: '您认识我父亲？', options: null, stage: 1, created_at: '2026-05-25 10:02:00' },
      { id: 3, session_id: sessionId, npc_id: 'npc_chen', role: 'npc',
        content: '你父亲他……是个真正的角儿。一出《空城计》，能唱哭半条街的人。',
        options: ['那后来发生了什么？', '我能帮上什么忙吗？'], stage: 1, created_at: '2026-05-25 10:03:00' },
    ];
    let filtered = npcId ? items.filter(d => d.npc_id === npcId) : items;
    return { items: filtered, total: filtered.length, page: 1, page_size: 20 };
  }
  const params = new URLSearchParams();
  if (npcId) params.set('npc_id', npcId);
  params.set('page', String(page));
  params.set('page_size', String(pageSize));
  const res = await fetch(`${BASE}/game/${sessionId}/dialogues?${params}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ==================== 结局 API ====================

/** 触发结局评价 */
export async function evaluateEnding(sessionId) {
  if (USE_MOCK) {
    return {
      type: 'accept_leader', title: '梨园新火',
      summary: '你选择扛起戏班的大旗。虽然前路艰难，但你在陈师傅的眼中看到了一丝久违的光。',
      key_moments: [
        { stage: 1, description: '你第一次踏入破旧的戏台，小华对你冷嘲热讽' },
        { stage: 2, description: '陈师傅终于开口，讲起了戏班三十年前的辉煌与衰落' },
        { stage: 3, description: '在父亲旧居中翻出的孩童戏服，唤醒了尘封的记忆' },
        { stage: 4, description: '老艺人们倾诉了戏班凋零的全貌' },
        { stage: 5, description: '你做出继承戏班的决定' },
      ],
      life_lesson: '传承不是守住灰烬，而是让火焰在另一片土地上继续燃烧。',
      npc_endings: [
        { npc_id: 'npc_chen', final_relationship: 85, summary: '陈师傅在晚年终于找到了传人。他走的时候嘴角带着笑。' },
        { npc_id: 'npc_xiaohua', final_relationship: 60, summary: '小华从一开始的敌意，逐渐成了你最好的搭档。' },
        { npc_id: 'npc_laozhou', final_relationship: 40, summary: '老周在戏班重振后精神焕发，又活跃了几年。' },
      ]
    };
  }
  const res = await fetch(`${BASE}/game/${sessionId}/evaluate`, { method: 'POST' });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ==================== 物品 API ====================

/** 获取物品列表（背包 + 场景物品） */
export async function getItems(sessionId) {
  if (USE_MOCK) {
    return { inventory: MOCK_INVENTORY, scene_items: MOCK_SCENE_ITEMS };
  }
  const res = await fetch(`${BASE}/game/${sessionId}/items`);
  if (!res.ok) throw new Error(await _extractApiError(res));
  return res.json();
}

/** 获取物品详情 */
export async function getItemDetail(sessionId, itemId) {
  if (USE_MOCK) {
    const invItem = MOCK_INVENTORY.find(i => i.id === itemId);
    const sceneItem = MOCK_SCENE_ITEMS.find(i => i.item_id === itemId);
    if (invItem) return { item_id: itemId, from: 'inventory', item: invItem };
    if (sceneItem) return { item_id: itemId, from: 'scene', is_discovered: false, item: sceneItem };
    throw new Error('ITEM_NOT_FOUND');
  }
  const res = await fetch(`${BASE}/game/${sessionId}/item/${itemId}`);
  if (!res.ok) throw new Error(await _extractApiError(res));
  return res.json();
}

/** 发现/拾取物品 */
export async function discoverItem(sessionId, itemId) {
  if (USE_MOCK) {
    const mock = MOCK_INVENTORY.find(i => i.id === itemId)
      || MOCK_SCENE_ITEMS.find(i => i.item_id === itemId);
    return {
      item_id: itemId, already_discovered: false,
      item: mock || { id: itemId, item_id: itemId, name: '未知物品', description: '', is_key: false },
      discovery_narration: `你发现了「${mock?.name || mock?.id || '未知物品'}」。`,
    };
  }
  const res = await fetch(`${BASE}/game/${sessionId}/item/discover`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ item_id: itemId }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ==================== NPC 位置 API ====================

/** 上报单个 NPC 位置 */
export async function reportNPCPosition(sessionId, npcId, position) {
  if (USE_MOCK) {
    return { success: true, npc_id: npcId, position };
  }
  const res = await fetch(`${BASE}/game/${sessionId}/npc/position`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ npc_id: npcId, position }),
  });
  if (!res.ok) throw new Error(await _extractApiError(res));
  return res.json();
}

/** 批量上报 NPC 位置 */
export async function batchReportNPCPositions(sessionId, positions) {
  console.log(`[API] batchReportNPCPositions called: session=${sessionId}, count=${positions.length}, USE_MOCK=${USE_MOCK}`, positions);
  if (USE_MOCK) {
    // Mock 模式：将位置写入 localStorage game_state，确保下次 getGameState 能读到
    const saved = localStorage.getItem(`game_state_${sessionId}`);
    if (saved) {
      try {
        const state = JSON.parse(saved);
        if (state.npcs && Array.isArray(state.npcs)) {
          for (const pos of positions) {
            const npc = state.npcs.find(n => n.id === pos.npc_id);
            if (npc) npc.position = pos.position;
          }
          localStorage.setItem(`game_state_${sessionId}`, JSON.stringify(state));
        }
      } catch (_) {}
    }
    console.log('[API] batchReportNPCPositions mock done');
    return { success: true, updated_count: positions.length, errors: null };
  }
  const url = `${BASE}/game/${sessionId}/npc/positions/batch`;
  console.log('[API] batchReportNPCPositions calling backend:', url);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ positions }),
  });
  if (!res.ok) throw new Error(await _extractApiError(res));
  return res.json();
}

/** 动态生成 NPC */
export async function spawnNPC(sessionId, npcData) {
  if (USE_MOCK) {
    const tempId = `npc_temp_${Date.now().toString(36)}`;
    return { success: true, npc_id: tempId, name: npcData.name || '临时NPC', position: npcData.position, is_temporary: true };
  }
  const res = await fetch(`${BASE}/game/${sessionId}/npc/spawn`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(npcData),
  });
  if (!res.ok) throw new Error(await _extractApiError(res));
  return res.json();
}

// ==================== 普通 NPC 管理 API（town-npcs）====================

/** 获取普通 NPC 列表 */
export async function getTownNPCs(scriptId) {
  if (USE_MOCK) {
    return { script_id: scriptId || 'liyuan_shengsi', town_npcs: mockTownNpcsData, total: mockTownNpcsData.length };
  }
  const res = await fetch(`${BASE}/scripts/${scriptId}/town-npcs`);
  if (!res.ok) throw new Error(await _extractApiError(res));
  return res.json();
}

/** 批量创建普通 NPC */
export async function createTownNPCs(scriptId, townNpcs) {
  if (USE_MOCK) {
    const created = townNpcs.map((tn, idx) => ({
      ...tn,
      id: tn.id || `town_${String(Date.now()).slice(-6)}_${idx}`,
    }));
    mockTownNpcsData.length = 0;
    mockTownNpcsData.push(...created);
    return { success: true, created, total: created.length };
  }
  const res = await fetch(`${BASE}/scripts/${scriptId}/town-npcs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ town_npcs: townNpcs }),
  });
  if (!res.ok) throw new Error(await _extractApiError(res));
  return res.json();
}

/** 删除普通 NPC */
export async function deleteTownNPC(scriptId, npcId) {
  if (USE_MOCK) {
    const idx = mockTownNpcsData.findIndex(t => t.id === npcId);
    if (idx >= 0) mockTownNpcsData.splice(idx, 1);
    return { success: true, message: `已删除普通 NPC: ${npcId}` };
  }
  const res = await fetch(`${BASE}/scripts/${scriptId}/town-npcs/${npcId}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(await _extractApiError(res));
  return res.json();
}

/** 更新普通 NPC */
export async function updateTownNPC(scriptId, npcId, data) {
  if (USE_MOCK) {
    const idx = mockTownNpcsData.findIndex(t => t.id === npcId);
    if (idx >= 0) {
      mockTownNpcsData[idx] = { ...mockTownNpcsData[idx], ...data };
      return { success: true, npc: mockTownNpcsData[idx] };
    }
    throw new Error('NPC_NOT_FOUND');
  }
  const res = await fetch(`${BASE}/scripts/${scriptId}/town-npcs/${npcId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(await _extractApiError(res));
  return res.json();
}

// ==================== 关系 & 事件 API ====================

/** 获取好感度关系变化日志 */
export async function getRelationships(sessionId, npcId = null) {
  if (USE_MOCK) {
    return {
      session_id: sessionId, npc_id: npcId || 'npc_chen',
      logs: [
        { id: 1, npc_id: 'npc_chen', delta: 2, reason: '对话', relationship_after: 22, created_at: '2026-05-25 10:01:00' },
        { id: 2, npc_id: 'npc_chen', delta: 8, reason: '对话', relationship_after: 30, created_at: '2026-05-25 10:03:00' },
      ],
      current_relationships: { npc_chen: 30, npc_xiaohua: 10, npc_laozhou: 15 },
      total: 2
    };
  }
  const params = npcId ? `?npc_id=${encodeURIComponent(npcId)}` : '';
  const res = await fetch(`${BASE}/game/${sessionId}/relationships${params}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

/** 获取事件日志 */
export async function getEvents(sessionId) {
  if (USE_MOCK) {
    return {
      session_id: sessionId,
      events: [
        { id: 1, event_id: 'first_chapter_started', triggered_by: 'system', stage: 1, created_at: '2026-05-25 10:00:00' },
        { id: 2, event_id: 'chen_first_talk', triggered_by: 'dialogue', stage: 1, created_at: '2026-05-25 10:01:00' },
      ],
      total: 2
    };
  }
  const res = await fetch(`${BASE}/game/${sessionId}/events`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ==================== v3 存档管理 API（后端持久化）====================

const MAX_SLOTS = 6;

// Mock 模式下用内存模拟后端存档
const _mockSaves = {};

/** 获取 session 下所有存档槽位 */
export async function getSaves(sessionId) {
  if (USE_MOCK) {
    const saves = _mockSaves[sessionId] || [];
    return { saves, total: saves.length };
  }
  const res = await fetch(`${BASE}/game/${sessionId}/saves`);
  if (!res.ok) throw new Error(await _extractApiError(res));
  return res.json();
}

/** 保存存档快照（兼容旧 saveToSlot 签名） */
export async function createSave(sessionId, gameState, slotId = null,
                                  playerPos = null, townNpcPos = null) {
  if (USE_MOCK) {
    const timestamp = Date.now();
    const stage = gameState?.current_stage || 1;
    const saveId = `sv_mock_${timestamp.toString(36)}`;
    const label = `阶段${stage} · ${new Date(timestamp).toLocaleString('zh-CN')}`;
    const saves = _mockSaves[sessionId] || [];

    let assignedSlot = slotId || saves.length + 1;
    if (saves.length >= MAX_SLOTS) {
      const oldest = saves.reduce((a, b) => a.created_at < b.created_at ? a : b);
      assignedSlot = oldest.slot_id;
      saves.splice(saves.findIndex(s => s.save_id === oldest.save_id), 1);
    }

    const save = {
      save_id: saveId, session_id: sessionId, slot_id: assignedSlot,
      label, stage, chapter_id: gameState?.current_chapter?.chapter_id || null,
      created_at: new Date(timestamp).toISOString(),
    };
    saves.push(save);
    _mockSaves[sessionId] = saves;

    // 同时写 localStorage 做降级
    saveGameState(sessionId, { ...gameState, _save_id: saveId, _slot_id: assignedSlot, _save_label: label });
    localStorage.setItem('__active_session__', sessionId);
    return save;
  }
  const body = {
    slot_id: slotId,
    player_position: playerPos,
    town_npc_positions: townNpcPos,
    _sub_scene_id: gameState?._sub_scene_id || null,
    _sub_scene_player_position: gameState?._sub_scene_player_position || null,
    _sub_scene_story_npc_positions: gameState?._sub_scene_story_npc_positions || null,
    _sub_scene_town_npc_positions: gameState?._sub_scene_town_npc_positions || null,
  };
  const res = await fetch(`${BASE}/game/${sessionId}/saves`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await _extractApiError(res));
  const result = await res.json();

  // 本地缓存一份做降级
  saveGameState(sessionId, { ...gameState, _save_id: result.save_id, _slot_id: result.slot_id, _save_label: result.label });
  localStorage.setItem('__active_session__', sessionId);
  return result;
}

/** 加载存档并返回完整游戏状态（兼容旧 loadFromSlot 签名） */
export async function loadSave(sessionId, saveId) {
  if (USE_MOCK) {
    const saved = localStorage.getItem(`game_state_${sessionId}`);
    if (!saved) return null;
    try { return JSON.parse(saved); } catch { return null; }
  }
  const res = await fetch(`${BASE}/game/${sessionId}/saves/${saveId}/load`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error(await _extractApiError(res));
  return res.json();
}

/** 删除存档 */
export async function deleteSave(sessionId, saveId) {
  if (USE_MOCK) {
    const saves = _mockSaves[sessionId] || [];
    _mockSaves[sessionId] = saves.filter(s => s.save_id !== saveId);
    return { success: true };
  }
  const res = await fetch(`${BASE}/game/${sessionId}/saves/${saveId}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error(await _extractApiError(res));
  return res.json();
}

// ===== 编辑器配置（场景模板，独立于游戏存档）=====

/**
 * 保存编辑器配置到后端文件系统（碰撞/NPC初始位置/场景入口/物品位置/出生点）
 * 这些是创建新存档时的初始模板数据，与游戏存档完全分离。
 * @param {Object} data - { "_main": { collisionMap, npcPositions, itemPositions, playerSpawn, entryZones }, "stage": {...}, ... }
 * @param {string} [scriptId='liyuan_shengsi'] - 剧本ID
 */
export async function saveEditorConfig(data, scriptId = 'liyuan_shengsi') {
  if (USE_MOCK) {
    localStorage.setItem('__editor_config__', JSON.stringify(data));
    console.log('[client] Mock: 编辑器配置已保存到 localStorage');
    return { status: 'ok', scenes: Object.keys(data) };
  }
  const res = await fetch(`${BASE}/editor/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ script_id: scriptId, data }),
  });
  if (!res.ok) throw new Error(await _extractApiError(res));
  return res.json();
}

/**
 * 从后端文件系统加载编辑器配置
 * @param {string} [scriptId='liyuan_shengsi'] - 剧本ID
 * @returns {Object|null} 编辑器配置数据
 */
export async function loadEditorConfig(scriptId = 'liyuan_shengsi') {
  if (USE_MOCK) {
    try {
      const saved = localStorage.getItem('__editor_config__');
      if (saved) {
        console.log('[client] Mock: 从 localStorage 加载编辑器配置');
        return JSON.parse(saved);
      }
    } catch { /* ignore */ }
    return null;
  }
  const res = await fetch(`${BASE}/editor/config?script_id=${encodeURIComponent(scriptId)}`);
  if (!res.ok) throw new Error(await _extractApiError(res));
  const result = await res.json();
  return result.data || null;
}

// ===== 兼容旧接口（代理到新 API）=====

/** @deprecated 使用 getSaves(sessionId) 替代 */
export function getSaveSlots() {
  // 同步兼容：返回空数组，调用方应改用异步版
  console.warn('[client] getSaveSlots() is deprecated, use getSaves(sessionId) instead');
  return [];
}

/** @deprecated 使用 createSave() 替代 */
export function saveToSlot(sessionId, gameState, slotId = null) {
  console.warn('[client] saveToSlot() is deprecated, use createSave() instead');
  return createSave(sessionId, gameState, slotId);
}

/** @deprecated 使用 loadSave() 替代 */
export function loadFromSlot(slotId) {
  console.warn('[client] loadFromSlot() is deprecated, use loadSave() instead');
  return null;
}

/** @deprecated 使用 deleteSave() 替代 */
export function deleteSlot(slotId) {
  console.warn('[client] deleteSlot() is deprecated, use deleteSave() instead');
  return [];
}
