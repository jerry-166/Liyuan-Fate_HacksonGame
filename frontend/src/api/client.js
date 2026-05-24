/**
 * API 客户端 — 封装所有后端通信
 * 当前使用 Mock 数据，联调时切换到真实 API
 */
const BASE = '/api';

// ========== Mock 数据（从 mock 文件夹复制，内联以便独立运行）==========

const MOCK_START = {
  "session_id": "sess_mock_001",
  "player_name": "玩家",
  "current_stage": 1,
  "stage_params": {
    "id": 1, "name": "不屑",
    "description": "戏班众人对你冷眼相看，觉得你不过是又一个心血来潮的外人",
    "color_tone": "cold", "bgm_mood": "melancholy", "dialogue_tone": "冷漠、疏离、话中带刺"
  },
  "npcs": [
    {
      "id": "npc_chen", "name": "陈师傅", "role": "老琴师", "scene": "tavern",
      "position": { "x": 1200, "y": 800 }, "sprite_key": "npc_chen_idle",
      "relationship": 0, "is_available": true,
      "current_greeting": "……（陈师傅低头擦拭琴弦，仿佛没看见你）"
    },
    {
      "id": "npc_xiaohua", "name": "小华", "role": "年轻学徒", "scene": "stage",
      "position": { "x": 600, "y": 400 }, "sprite_key": "npc_xiaohua_idle",
      "relationship": 0, "is_available": true,
      "current_greeting": "你也是来看戏班笑话的吗？"
    }
  ],
  "events_triggered": [], "game_ended": false
};

// 不同场景的 SSE Mock 数据（按 NPC ID 区分首轮 / 后续轮）
const MOCK_SSE_POOLS = {
  // 首轮对话 — 陈师傅
  first_chen: [
    { event: 'delta', data: { chunk: '……' } },
    { event: 'delta', data: { chunk: '（陈师傅停下手中的活，缓缓抬起头）' } },
    { event: 'delta', data: { chunk: '你就是老班主的儿子？' } },
    { event: 'delta', data: { chunk: '模样倒是有点像他。' } },
    { event: 'done', data: { full_text: '……（陈师傅停下手中的活，缓缓抬起头）你就是老班主的儿子？模样倒是有点像他。', relationship_change: { npc_chen: 2 },
        options: [{ id: 1, text: '您认识我父亲？' }, { id: 2, text: '我是来看看戏班现在的情况' }, { id: 3, text: '（沉默地看着他）' }],
        stage_changed: false, new_stage: null, ending_triggered: false, events_triggered: ['chen_first_talk'] } }
  ],
  // 首轮对话 — 小华
  first_xiaohua: [
    { event: 'delta', data: { chunk: '哼，' } },
    { event: 'delta', data: { chunk: '又一个来看我们笑话的。' } },
    { event: 'delta', data: { chunk: '你们这些人啊，' } },
    { event: 'delta', data: { chunk: '觉得戏班好欺负是不是？' } },
    { event: 'done', data: { full_text: '哼，又一个来看我们笑话的。你们这些人啊，觉得戏班好欺负是不是？', relationship_change: { npc_xiaohua: -3 },
        options: [{ id: 1, text: '我不是来看笑话的' }, { id: 2, text: '你为什么这么生气？' }, { id: 3, text: '（默默转身要走）' }],
        stage_changed: false, new_stage: null, ending_triggered: false, events_triggered: ['xiaohua_first_talk'] } }
  ],
  // 续接对话 — 正常
  continue_normal: [
    { event: 'delta', data: { chunk: '你父亲他……' } },
    { event: 'delta', data: { chunk: '是个真正的角儿。' } },
    { event: 'delta', data: { chunk: '一出《空城计》，能唱哭半条街的人。' } },
    { event: 'delta', data: { chunk: '可惜啊，这世道变了。' } },
    { event: 'delta', data: { chunk: '听戏的人，越来越少了。' } },
    { event: 'done', data: { full_text: '你父亲他……是个真正的角儿。一出《空城计》，能唱哭半条街的人。可惜啊，这世道变了。听戏的人，越来越少了。',
        relationship_change: { npc_chen: 8 },
        options: [{ id: 1, text: '那后来发生了什么？' }, { id: 2, text: '我能帮上什么忙吗？' }, { id: 3, text: '小华是怎么留下来的？' }],
        stage_changed: false, new_stage: null, ending_triggered: false, events_triggered: ['chen_talked_father'] } }
  ],
  // 阶段变化
  stage_change: [
    { event: 'delta', data: { chunk: '三十年了啊……' } },
    { event: 'delta', data: { chunk: '那时候戏班三十来号人，' } },
    { event: 'delta', data: { chunk: '每到初一十五，镇上的人挤破了头也要来听戏。' } },
    { event: 'delta', data: { chunk: '你父亲站在台上，一嗓子能镇住整条街。' } },
    { event: 'delta', data: { chunk: '后来打仗了，年轻人都走了，' } },
    { event: 'delta', data: { chunk: '到今天，就剩我和小华两个人了。' } },
    { event: 'done', data: { full_text: '三十年了啊……那时候戏班三十来号人，每到初一十五，镇上的人挤破了头也要来听戏。你父亲站在台上，一嗓子能镇住整条街。后来打仗了，年轻人都走了，到今天，就剩我和小华两个人了。',
        relationship_change: { npc_chen: 10 },
        options: [{ id: 1, text: '我可以留在戏班帮忙吗？' }, { id: 2, text: '小华是怎么留下来的？' }, { id: 3, text: '这戏班……还有救吗？' }],
        stage_changed: true, new_stage: { id: 2, name: '了解', description: '你开始走近这个戏班，有人愿意跟你说几句真心话了', color_tone: 'warm', bgm_mood: 'hopeful', dialogue_tone: '温和、敞开、偶有真情流露' },
        ending_triggered: false, events_triggered: ['chen_told_full_story'] } }
  ],
  // 结局触发
  ending_trigger: [
    { event: 'delta', data: { chunk: '孩子，' } },
    { event: 'delta', data: { chunk: '你当真想好了？' } },
    { event: 'delta', data: { chunk: '接下这个戏班，可不是闹着玩的。' } },
    { event: 'delta', data: { chunk: '没有掌声，没有银钱，' } },
    { event: 'delta', data: { chunk: '可能连个像样的戏台都凑不齐。' } },
    { event: 'delta', data: { chunk: '但……如果你愿意，' } },
    { event: 'delta', data: { chunk: '这把跟了我四十年的京胡，' } },
    { event: 'delta', data: { chunk: '今天就交到你手上。' } },
    { event: 'done', data: { full_text: '孩子，你当真想好了？接下这个戏班，可不是闹着玩的。没有掌声，没有银钱，可能连个像样的戏台都凑不齐。但……如果你愿意，这把跟了我四十年的京胡，今天就交到你手上。',
        relationship_change: { npc_chen: 15 }, options: null,
        stage_changed: false, new_stage: null, ending_triggered: true, events_triggered: ['final_choice_made'] } }
  ],
  // 对话结束无选项
  no_options: [
    { event: 'delta', data: { chunk: '行了，' } },
    { event: 'delta', data: { chunk: '今天就说这么多吧。' } },
    { event: 'delta', data: { chunk: '你……先到处转转吧。' } },
    { event: 'done', data: { full_text: '行了，今天就说这么多吧。你……先到处转转吧。', relationship_change: {}, options: null,
        stage_changed: false, new_stage: null, ending_triggered: false, events_triggered: [] } }
  ],
};

// 对话轮次计数器（用于 Mock 切换不同场景）
let mockDialogueRounds = {};

// ========== API 方法 ==========

// Mock 模式由 VITE_USE_MOCK 环境变量控制（默认 true，即独立运行）false=连真实后端
let USE_MOCK = import.meta.env.VITE_USE_MOCK !== 'false';

export function setUseMock(useMock) {
  USE_MOCK = useMock;
}

export async function startGame(playerName = '玩家') {
  if (USE_MOCK) {
    // 重置对话轮次
    mockDialogueRounds = {};
    return { ...MOCK_START, player_name: playerName, session_id: `mock_${Date.now()}` };
  }
  const res = await fetch(`${BASE}/game/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ player_name: playerName })
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getGameState(sessionId) {
  if (USE_MOCK) {
    // 从 localStorage 读取已保存的 mock 状态
    const saved = localStorage.getItem(`game_state_${sessionId}`);
    if (saved) {
      try { return JSON.parse(saved); } catch (e) { /* fall through */ }
    }
    return { ...MOCK_START };
  }
  const res = await fetch(`${BASE}/game/${sessionId}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

/**
 * 发起 NPC 对话 — 返回 ReadableStream 用于 SSE 解析
 */
export async function startDialogueStream(sessionId, npcId, playerMessage = null) {
  if (USE_MOCK) {
    return createMockSSEStream(sessionId, npcId, playerMessage);
  }
  const res = await fetch(`${BASE}/dialogue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      session_id: sessionId,
      npc_id: npcId,
      player_message: playerMessage
    })
  });
  if (!res.ok) throw new Error(await res.text());
  return res.body;
}

/**
 * 根据对话状态选择合适的 Mock SSE 场景
 */
function selectMockScene(npcId, playerMessage) {
  const key = `${npcId}_round`;
  const round = mockDialogueRounds[key] || 0;
  mockDialogueRounds[key] = round + 1;

  // 首轮对话（playerMessage 为空）
  if (!playerMessage) {
    return npcId === 'npc_chen' ? 'first_chen' : 'first_xiaohua';
  }

  // 后续轮次 → 根据轮次切换场景
  const scenes = ['continue_normal', 'stage_change', 'ending_trigger', 'no_options'];
  const idx = Math.min(round - 1, scenes.length - 1);
  return scenes[idx];
}

function createMockSSEStream(sessionId, npcId, playerMessage) {
  const scene = selectMockScene(npcId, playerMessage);
  const events = MOCK_SSE_POOLS[scene] || MOCK_SSE_POOLS.continue_normal;

  let index = 0;
  return new ReadableStream({
    pull(controller) {
      if (index < events.length) {
        return new Promise(resolve => {
          const isLastDelta = events[index].event === 'done';
          const delay = isLastDelta ? 100 : (120 + Math.random() * 150);
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

/**
 * SSE 流解析器 — 从 ReadableStream 中解析 SSE 事件，回调驱动
 * @param {ReadableStream} stream
 * @param {Object} callbacks - { onDelta(text), onDone(result), onError(err) }
 */
export async function parseSSEStream(stream, callbacks) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let eventType = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('event: ')) {
          eventType = trimmed.slice(7).trim();
        } else if (trimmed.startsWith('data: ')) {
          try {
            const data = JSON.parse(trimmed.slice(6));
            switch (eventType) {
              case 'delta':
                callbacks.onDelta && callbacks.onDelta(data.chunk);
                break;
              case 'done':
                callbacks.onDone && callbacks.onDone(data);
                break;
              case 'error':
                callbacks.onError && callbacks.onError(data);
                break;
            }
          } catch (e) {
            console.warn('[SSE] 解析 data 失败:', trimmed, e);
          }
          eventType = '';
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export async function evaluateEnding(sessionId) {
  if (USE_MOCK) {
    return {
      type: 'accept_leader',
      title: '梨园新火',
      summary: '你选择扛起戏班的大旗。虽然前路艰难，但你在陈师傅的眼中看到了一丝久违的光。戏台上，第一声锣响震碎了多年的沉寂……',
      key_moments: [
        { stage: 1, description: '你第一次踏入破旧的戏台，小华对你冷嘲热讽' },
        { stage: 2, description: '陈师傅终于开口，讲起了戏班三十年前的辉煌与衰落' },
        { stage: 3, description: '在祠堂祖宗牌位前，你做出了继承戏班的决定' }
      ],
      life_lesson: '传承不是守住灰烬，而是让火焰在另一片土地上继续燃烧。有些东西，一旦断了就真的没了。',
      npc_endings: [
        { npc_id: 'npc_chen', final_relationship: 85, summary: '陈师傅在晚年终于找到了传人。他把毕生所学倾囊相授，走的时候嘴角带着笑。' },
        { npc_id: 'npc_xiaohua', final_relationship: 60, summary: '小华从一开始的敌意，逐渐变成了你最好的搭档。他说：「原来你不是来抢东西的。」' }
      ]
    };
  }
  const res = await fetch(`${BASE}/game/${sessionId}/evaluate`, { method: 'POST' });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

/**
 * 保存游戏状态到 localStorage
 */
export function saveGameState(sessionId, state) {
  try {
    localStorage.setItem(`game_state_${sessionId}`, JSON.stringify(state));
  } catch (e) {
    console.warn('[API] 保存游戏状态失败:', e);
  }
}

// ========== 以下为 v1.2 新增接口（前端接入全部 10 个 API）==========

// Mock — GET /api/sessions
const MOCK_SESSIONS = {
  sessions: [
    {
      session_id: 'sess_mock_001',
      player_name: '玩家',
      stage: 2,
      stage_name: '了解',
      game_ended: false,
      created_at: '2026-05-23 20:00:00',
      updated_at: '2026-05-23 20:30:00',
    },
    {
      session_id: 'sess_mock_002',
      player_name: '戏迷阿三',
      stage: 3,
      stage_name: '抉择',
      game_ended: true,
      created_at: '2026-05-22 14:00:00',
      updated_at: '2026-05-22 15:20:00',
    },
  ],
  total: 2,
};

// Mock — GET /api/game/{id}/dialogues
const MOCK_DIALOGUES = {
  items: [
    { id: 1, session_id: 'sess_mock_001', npc_id: 'npc_chen', role: 'npc',
      content: '……（陈师傅低头擦拭琴弦，仿佛没看见你）',
      options: ['陈师傅好', '默默站在一旁', '去找小华'], stage: 1, created_at: '2026-05-23 20:01:00' },
    { id: 2, session_id: 'sess_mock_001', npc_id: 'npc_chen', role: 'player',
      content: '您认识我父亲？', options: null, stage: 1, created_at: '2026-05-23 20:02:00' },
    { id: 3, session_id: 'sess_mock_001', npc_id: 'npc_chen', role: 'npc',
      content: '你父亲他……是个真正的角儿。一出《空城计》，能唱哭半条街的人。',
      options: ['那后来发生了什么？', '我能帮上什么忙吗？', '小华是怎么留下来的？'], stage: 1, created_at: '2026-05-23 20:03:00' },
  ],
  total: 3, page: 1, page_size: 20,
};

// Mock — POST /api/dialogue/exit
const MOCK_EXIT = {
  dialogue_text: '行吧，时候不早了，你去忙你的。',
  options: [],
  is_available: true,
};

// Mock — GET /api/game/{id}/relationships
const MOCK_RELATIONSHIPS = {
  session_id: 'sess_mock_001',
  npc_id: 'npc_chen',
  logs: [
    { id: 1, session_id: 'sess_mock_001', npc_id: 'npc_chen', delta: 2,
      reason: '对话', relationship_after: 2, created_at: '2026-05-23 20:01:00' },
    { id: 2, session_id: 'sess_mock_001', npc_id: 'npc_chen', delta: 8,
      reason: '对话', relationship_after: 10, created_at: '2026-05-23 20:03:00' },
    { id: 3, session_id: 'sess_mock_001', npc_id: 'npc_chen', delta: 5,
      reason: '对话', relationship_after: 15, created_at: '2026-05-24 12:00:00' },
  ],
  current_relationships: { npc_chen: 15, npc_xiaohua: 10 },
  total: 3,
};

// Mock — GET /api/game/{id}/events
const MOCK_EVENTS = {
  session_id: 'sess_mock_001',
  events: [
    { id: 1, event_id: 'first_enter_tavern', triggered_by: 'system',
      stage: 1, stage_name: '不屑', created_at: '2026-05-23 20:00:00' },
    { id: 2, event_id: 'chen_first_talk', triggered_by: 'npc_chen',
      stage: 1, stage_name: '不屑', created_at: '2026-05-23 20:01:00' },
    { id: 3, event_id: 'chen_told_full_story', triggered_by: 'npc_chen',
      stage: 2, stage_name: '了解', created_at: '2026-05-23 20:30:00' },
  ],
  total: 3,
};

// ========== 新增 API 方法 ==========

/**
 * 获取所有存档列表 — GET /api/sessions
 */
export async function getSessions() {
  if (USE_MOCK) {
    return { ...MOCK_SESSIONS };
  }
  const res = await fetch(`${BASE}/sessions`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

/**
 * 删除存档 — DELETE /api/game/{session_id}
 */
export async function deleteSession(sessionId) {
  if (USE_MOCK) {
    // Mock: 清理 localStorage
    localStorage.removeItem(`game_state_${sessionId}`);
    if (localStorage.getItem('__active_session__') === sessionId) {
      localStorage.removeItem('__active_session__');
    }
    return { success: true, message: `已删除会话: ${sessionId}` };
  }
  const res = await fetch(`${BASE}/game/${sessionId}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

/**
 * 分页查询对话历史 — GET /api/game/{session_id}/dialogues
 */
export async function getDialogues(sessionId, npcId = null, page = 1, pageSize = 20) {
  if (USE_MOCK) {
    let items = MOCK_DIALOGUES.items;
    if (npcId) items = items.filter(d => d.npc_id === npcId);
    return { items, total: items.length, page, page_size: pageSize };
  }
  const params = new URLSearchParams();
  if (npcId) params.set('npc_id', npcId);
  params.set('page', String(page));
  params.set('page_size', String(pageSize));
  const res = await fetch(`${BASE}/game/${sessionId}/dialogues?${params}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

/**
 * 退出 NPC 对话 — POST /api/dialogue/exit
 */
export async function exitDialogue(sessionId, npcId) {
  if (USE_MOCK) {
    return { ...MOCK_EXIT, dialogue_text: `（${npcId === 'npc_chen' ? '陈师傅' : '小华'}微微点头，示意你可以离开了）` };
  }
  const res = await fetch(`${BASE}/dialogue/exit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId, npc_id: npcId }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

/**
 * 查询关系值变化历史 — GET /api/game/{session_id}/relationships
 */
export async function getRelationships(sessionId, npcId = null) {
  if (USE_MOCK) {
    if (npcId) return { ...MOCK_RELATIONSHIPS, npc_id: npcId };
    return MOCK_RELATIONSHIPS;
  }
  const params = npcId ? `?npc_id=${encodeURIComponent(npcId)}` : '';
  const res = await fetch(`${BASE}/game/${sessionId}/relationships${params}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

/**
 * 查询已触发事件时间线 — GET /api/game/{session_id}/events
 */
export async function getEvents(sessionId) {
  if (USE_MOCK) {
    return { ...MOCK_EVENTS };
  }
  const res = await fetch(`${BASE}/game/${sessionId}/events`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
