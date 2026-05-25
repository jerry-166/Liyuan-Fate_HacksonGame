/**
 * API 客户端 — 封装所有后端通信（v2 章节驱动版）
 * 共 16 个接口，USE_MOCK=true 时使用 Mock 数据
 */
const BASE = '/api';

// ========== Mock 数据（v2 格式）==========

const MOCK_START = {
  session_id: 'sess_mock_001',
  player_name: '玩家',
  script_id: 'liyuan_shengsi',
  current_stage: 1,
  stage_params: {
    id: 1, name: '归乡',
    description: '父亲病逝，你带着他的骨灰回到陌生的故乡。',
    color_tone: '#8899aa', bgm_mood: 'melancholy_distant', dialogue_tone: ''
  },
  current_chapter: null,
  completed_chapters: [],
  npcs: [
    {
      id: 'npc_chen', name: '陈师傅', role: '老琴师', scene: 'teahouse',
      position: { x: 688, y: 256 }, sprite_key: 'npc_chen_idle',
      relationship: 20, is_available: true,
      current_greeting: '……（陈师傅低头擦拭琴弦，仿佛没看见你）',
      last_dialogue: '', last_options: [], dialogue_round_count: 0
    },
    {
      id: 'npc_xiaohua', name: '小华', role: '年轻学徒', scene: 'stage',
      position: { x: 176, y: 160 }, sprite_key: 'npc_xiaohua_idle',
      relationship: 10, is_available: true,
      current_greeting: '你也是来看戏班笑话的吗？',
      last_dialogue: '', last_options: [], dialogue_round_count: 0
    },
    {
      id: 'npc_laozhou', name: '老周', role: '老艺人', scene: 'stage',
      position: { x: 200, y: 140 }, sprite_key: 'npc_laozhou_idle',
      relationship: 15, is_available: true,
      current_greeting: '（老人靠在柱子上打盹，偶尔咳嗽两声）',
      last_dialogue: '', last_options: [], dialogue_round_count: 0
    },
    {
      id: 'npc_meiyi', name: '梅姨', role: '茶馆老板娘', scene: 'teahouse',
      position: { x: 620, y: 220 }, sprite_key: 'npc_meiyi_idle',
      relationship: 5, is_available: true,
      current_greeting: '哎哟，新面孔啊？进来喝杯茶吧。',
      last_dialogue: '', last_options: [], dialogue_round_count: 0
    },
    {
      id: 'npc_laoli', name: '船夫老李', role: '船夫', scene: 'dock',
      position: { x: 1040, y: 400 }, sprite_key: 'npc_laoli_idle',
      relationship: 5, is_available: true,
      current_greeting: '（蹲在船边抽旱烟，望着河水出神）',
      last_dialogue: '', last_options: [], dialogue_round_count: 0
    },
  ],
  events_triggered: [],
  game_ended: false,
  ending: null,
  inventory: []
};

// SSE Mock 池（v2 done 事件格式）
const MOCK_SSE_POOLS = {
  first_chen: [
    { event: 'delta', data: { chunk: '……' } },
    { event: 'delta', data: { chunk: '（陈师傅停下手中的活，缓缓抬起头）' } },
    { event: 'delta', data: { chunk: '你就是老班主的儿子？' } },
    { event: 'delta', data: { chunk: '模样倒是有点像他。' } },
    { event: 'done', data: {
      full_text: '……（陈师傅停下手中的活，缓缓抬起头）你就是老班主的儿子？模样倒是有点像他。',
      relationship_change: { npc_chen: 2 },
      options: ['您认识我父亲？', '我是来看看戏班现在的情况', '（沉默地看着他）'],
      chapter_completed: false,
      game_ended: false,
      events_triggered: ['chen_first_talk'],
      current_chapter: { chapter_id: 'ch_01', chapter_name: '闻声·异样' }
    }}
  ],
  first_xiaohua: [
    { event: 'delta', data: { chunk: '哼，' } },
    { event: 'delta', data: { chunk: '又一个来看我们笑话的。' } },
    { event: 'delta', data: { chunk: '你们这些人啊，' } },
    { event: 'delta', data: { chunk: '觉得戏班好欺负是不是？' } },
    { event: 'done', data: {
      full_text: '哼，又一个来看我们笑话的。你们这些人啊，觉得戏班好欺负是不是？',
      relationship_change: { npc_xiaohua: -3 },
      options: ['我不是来看笑话的', '你为什么这么生气？', '（默默转身要走）'],
      chapter_completed: false,
      game_ended: false,
      events_triggered: ['xiaohua_first_talk'],
      current_chapter: { chapter_id: 'ch_01', chapter_name: '闻声·异样' }
    }}
  ],
  first_laozhou: [
    { event: 'delta', data: { chunk: '（老人慢慢睁开眼）' } },
    { event: 'delta', data: { chunk: '咳咳……你是……新来的？' } },
    { event: 'delta', data: { chunk: '这戏班好久没见生面孔了。' } },
    { event: 'done', data: {
      full_text: '（老人慢慢睁开眼）咳咳……你是……新来的？这戏班好久没见生面孔了。',
      relationship_change: { npc_laozhou: 3 },
      options: ['您是这里的老人了？', '这戏班从前很热闹吧？'],
      chapter_completed: false, game_ended: false,
      events_triggered: ['laozhou_first_talk'],
      current_chapter: { chapter_id: 'ch_01', chapter_name: '闻声·异样' }
    }}
  ],
  continue_normal: [
    { event: 'delta', data: { chunk: '你父亲他……' } },
    { event: 'delta', data: { chunk: '是个真正的角儿。' } },
    { event: 'delta', data: { chunk: '一出《空城计》，能唱哭半条街的人。' } },
    { event: 'delta', data: { chunk: '可惜啊，这世道变了。' } },
    { event: 'delta', data: { chunk: '听戏的人，越来越少了。' } },
    { event: 'done', data: {
      full_text: '你父亲他……是个真正的角儿。一出《空城计》，能唱哭半条街的人。可惜啊，这世道变了。听戏的人，越来越少了。',
      relationship_change: { npc_chen: 8 },
      options: ['那后来发生了什么？', '我能帮上什么忙吗？', '小华是怎么留下来的？'],
      chapter_completed: false, game_ended: false,
      events_triggered: ['chen_talked_father'],
      current_chapter: { chapter_id: 'ch_02', chapter_name: '探寻·疑云' }
    }}
  ],
  chapter_complete: [
    { event: 'delta', data: { chunk: '说了这么多，' } },
    { event: 'delta', data: { chunk: '我倒是想起一件事来。' } },
    { event: 'delta', data: { chunk: '你父亲当年在旧居留了些东西，' } },
    { event: 'delta', data: { chunk: '或许……你该去看看。' } },
    { event: 'done', data: {
      full_text: '说了这么多，我倒是想起一件事来。你父亲当年在旧居留了些东西，或许……你该去看看。',
      relationship_change: { npc_chen: 10 },
      options: ['旧居在哪里？', '谢谢您告诉我这些'],
      chapter_completed: true,
      game_ended: false,
      events_triggered: ['chapter_01_done'],
      current_chapter: { chapter_id: 'ch_01', chapter_name: '闻声·异样' }
    }}
  ],
  ending_trigger: [
    { event: 'delta', data: { chunk: '孩子，' } },
    { event: 'delta', data: { chunk: '你当真想好了？' } },
    { event: 'delta', data: { chunk: '接下这个戏班，可不是闹着玩的。' } },
    { event: 'delta', data: { chunk: '没有掌声，没有银钱，' } },
    { event: 'delta', data: { chunk: '可能连个像样的戏台都凑不齐。' } },
    { event: 'delta', data: { chunk: '但……如果你愿意，' } },
    { event: 'delta', data: { chunk: '这把跟了我四十年的京胡，' } },
    { event: 'delta', data: { chunk: '今天就交到你手上。' } },
    { event: 'done', data: {
      full_text: '孩子，你当真想好了？接下这个戏班，可不是闹着玩的。没有掌声，没有银钱，可能连个像样的戏台都凑不齐。但……如果你愿意，这把跟了我四十年的京胡，今天就交到你手上。',
      relationship_change: { npc_chen: 15 },
      options: null,
      chapter_completed: false,
      game_ended: true,
      events_triggered: ['final_choice_made'],
      current_chapter: { chapter_id: 'ch_05', chapter_name: '承戏·重振' }
    }}
  ],
  no_options: [
    { event: 'delta', data: { chunk: '行了，' } },
    { event: 'delta', data: { chunk: '今天就说这么多吧。' } },
    { event: 'delta', data: { chunk: '你……先到处转转吧。' } },
    { event: 'done', data: {
      full_text: '行了，今天就说这么多吧。你……先到处转转吧。',
      relationship_change: {},
      options: null,
      chapter_completed: false, game_ended: false,
      events_triggered: [],
      current_chapter: null
    }}
  ],
  // 默认未知 NPC 首轮
  first_default: [
    { event: 'delta', data: { chunk: '哦，' } },
    { event: 'delta', data: { chunk: '你是新来的？' } },
    { event: 'delta', data: { chunk: '真没想到这时候还会有人来这小镇。' } },
    { event: 'done', data: {
      full_text: '哦，你是新来的？真没想到这时候还会有人来这小镇。',
      relationship_change: {},
      options: ['我是回来安葬父亲的', '只是路过看看'],
      chapter_completed: false, game_ended: false,
      events_triggered: [],
      current_chapter: null
    }}
  ],
};

// Mock 章节数据
const MOCK_CHAPTERS = [
  { chapter_id: 'ch_prologue', name: '归乡', type: 'cinematic', color_tone: '#8899aa', bgm_mood: 'melancholy_distant',
    description: '父亲病逝，你带着他的骨灰回到陌生的故乡。安葬完毕，一切才刚刚开始。' },
  { chapter_id: 'ch_01', name: '闻声·异样', type: 'task', color_tone: '#8899bb', bgm_mood: 'eerie_warm',
    description: '你偶然走到老街深处，看见一座门庭冷清的老戏院……' },
  { chapter_id: 'ch_02', name: '探寻·疑云', type: 'task', color_tone: '#bbaa88', bgm_mood: 'hopeful',
    description: '你在小镇上四处打听，逐渐拼凑出父亲的过往……' },
  { chapter_id: 'ch_03', name: '忆归·真相', type: 'task', color_tone: '#cc9977', bgm_mood: 'dramatic',
    description: '在父亲旧居中翻出的三件旧物，唤醒了沉睡的记忆……' },
  { chapter_id: 'ch_04', name: '目睹·凋零', type: 'task', color_tone: '#998877', bgm_mood: 'somber',
    description: '老艺人们的倾诉让你看到了戏班凋零的全貌……' },
  { chapter_id: 'ch_05', name: '承戏·重振', type: 'task', color_tone: '#cc8866', bgm_mood: 'heroic',
    description: '你决定扛起戏班的大旗。陈师傅颤抖着将京胡交到你手中……' },
];

// Mock 物品列表
const MOCK_ITEMS = [
  { id: 'item_urn', name: '父亲的骨灰盒', description: '一个简朴的深色木盒，里面装着父亲柳三秋的骨灰。',
    is_key: false, is_discovered: true, location: { scene: 'cemetery' } },
  { id: 'item_child_costume', name: '孩童戏服', description: '一件小小的戏服，保存完好，袖口绣着父亲的名字。',
    is_key: true, is_discovered: false, location: { scene: 'father_house' } },
];

// Mock 会话列表
let MOCK_SESSIONS = [
  {
    session_id: 'sess_mock_001', player_name: '玩家', stage: 2, stage_name: '闻声·异样',
    game_ended: false, created_at: '2026-05-25 10:00:00', updated_at: '2026-05-25 12:30:00'
  },
];

// 对话轮次计数
let mockDialogueRounds = {};

// ========== Mock 模式控制 ==========

let USE_MOCK = import.meta.env.VITE_USE_MOCK !== 'false';

export function setUseMock(useMock) {
  USE_MOCK = useMock;
}

// ========== 游戏会话 ==========

export async function startGame(playerName = '玩家', scriptId = 'liyuan_shengsi') {
  if (USE_MOCK) {
    mockDialogueRounds = {};
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

export async function getScripts() {
  if (USE_MOCK) {
    return { scripts: [{ script_id: 'liyuan_shengsi', name: '梨园生死', version: '1.0',
      author: 'Team A', npc_count: 5, chapter_count: 6,
      description: '江南水乡小镇梨溪镇，民国时期。' }], total: 1 };
  }
  const res = await fetch(`${BASE}/scripts`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ========== 章节 ==========

let mockChapterIdx = 0;
let mockChapterCompleted = new Set();

export async function startChapter(sessionId, chapterId = null) {
  if (USE_MOCK) {
    if (chapterId) mockChapterIdx = MOCK_CHAPTERS.findIndex(c => c.chapter_id === chapterId);
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
        description: `找到NPC获取信息`, status: 'locked', target_npc_id: 'npc_chen' },
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

export async function getChapter(sessionId) {
  if (USE_MOCK) {
    if (mockChapterIdx < MOCK_CHAPTERS.length) {
      const ch = MOCK_CHAPTERS[mockChapterIdx];
      return {
        current_chapter: { chapter_id: ch.chapter_id, chapter_name: ch.name,
          chapter_type: ch.type, color_tone: ch.color_tone, bgm_mood: ch.bgm_mood },
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

// ========== 对话 ==========

function selectMockScene(npcId, playerMessage) {
  const key = `${npcId}_round`;
  const round = mockDialogueRounds[key] || 0;
  mockDialogueRounds[key] = round + 1;

  if (!playerMessage) {
    // 首轮按 NPC 返回不同开场
    const firstMap = {
      'npc_chen': 'first_chen', 'npc_xiaohua': 'first_xiaohua', 'npc_laozhou': 'first_laozhou'
    };
    return firstMap[npcId] || 'first_default';
  }

  // 后续轮次 → 按轮次切换
  const scenes = ['continue_normal', 'chapter_complete', 'ending_trigger', 'no_options'];
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

export async function startDialogueStream(sessionId, npcId, playerMessage = null) {
  if (USE_MOCK) {
    return createMockSSEStream(sessionId, npcId, playerMessage);
  }
  const res = await fetch(`${BASE}/dialogue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId, npc_id: npcId, player_message: playerMessage })
  });
  if (!res.ok) throw new Error(await res.text());
  return res.body;
}

export async function showItemToNpcStream(sessionId, npcId, itemId, playerMessage = null) {
  if (USE_MOCK) {
    // 展示物品的 mock：返回特殊对话
    return createMockSSEStream(sessionId, npcId, `[展示了物品:${itemId}]`);
  }
  const res = await fetch(`${BASE}/dialogue/show-item`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId, npc_id: npcId, item_id: itemId, player_message: playerMessage })
  });
  if (!res.ok) throw new Error(await res.text());
  return res.body;
}

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

// ========== 结局 ==========

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

// ========== 物品 ==========

export async function getItems(sessionId) {
  if (USE_MOCK) {
    return { items: MOCK_ITEMS, total: MOCK_ITEMS.length };
  }
  const res = await fetch(`${BASE}/game/${sessionId}/items`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ========== 存档管理（后端 API）==========

export async function getSessions() {
  if (USE_MOCK) {
    return { sessions: MOCK_SESSIONS, total: MOCK_SESSIONS.length };
  }
  const res = await fetch(`${BASE}/sessions`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function deleteSession(sessionId) {
  if (USE_MOCK) {
    MOCK_SESSIONS = MOCK_SESSIONS.filter(s => s.session_id !== sessionId);
    localStorage.removeItem(`game_state_${sessionId}`);
    return { success: true, message: `已删除会话: ${sessionId}` };
  }
  const res = await fetch(`${BASE}/game/${sessionId}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ========== 对话历史 ==========

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

export async function getEvents(sessionId) {
  if (USE_MOCK) {
    return {
      session_id: sessionId,
      events: [
        { id: 1, event_id: 'first_chapter_started', triggered_by: 'system', stage: 1,
          created_at: '2026-05-25 10:00:00' },
        { id: 2, event_id: 'chen_first_talk', triggered_by: 'dialogue', stage: 1,
          created_at: '2026-05-25 10:01:00' },
      ],
      total: 2
    };
  }
  const res = await fetch(`${BASE}/game/${sessionId}/events`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ========== SSE 解析器 ==========

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

// ========== 本地持久化辅助 ==========

export function saveGameState(sessionId, state) {
  try {
    localStorage.setItem(`game_state_${sessionId}`, JSON.stringify(state));
  } catch (e) {
    console.warn('[API] 保存游戏状态失败:', e);
  }
}

// ========== 存档槽位管理（本地）==========

const SAVE_SLOTS_KEY = '__save_slots__';
const MAX_SLOTS = 6;

export function getSaveSlots() {
  try {
    const raw = localStorage.getItem(SAVE_SLOTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveToSlot(sessionId, gameState, slotId = null) {
  const slots = getSaveSlots();
  const timestamp = Date.now();
  const stage = gameState?.current_stage || 1;
  const label = `阶段${stage} · ${new Date(timestamp).toLocaleString('zh-CN')}`;

  if (slotId !== null) {
    const idx = slots.findIndex(s => s.id === slotId);
    if (idx >= 0) {
      slots[idx] = { id: slotId, sessionId, timestamp, stage, label };
    } else {
      slots.push({ id: slotId, sessionId, timestamp, stage, label });
    }
  } else {
    const usedIds = new Set(slots.map(s => s.id));
    let newId = 1;
    while (usedIds.has(newId) && newId <= MAX_SLOTS) newId++;
    if (newId > MAX_SLOTS) {
      slots.sort((a, b) => a.timestamp - b.timestamp);
      slots[0] = { id: slots[0].id, sessionId, timestamp, stage, label };
    } else {
      slots.push({ id: newId, sessionId, timestamp, stage, label });
    }
  }

  slots.sort((a, b) => b.timestamp - a.timestamp);
  localStorage.setItem(SAVE_SLOTS_KEY, JSON.stringify(slots));
  saveGameState(sessionId, gameState);
  localStorage.setItem('__active_session__', sessionId);

  return slots;
}

export function loadFromSlot(slotId) {
  const slots = getSaveSlots();
  const slot = slots.find(s => s.id === slotId);
  if (!slot) return null;

  const saved = localStorage.getItem(`game_state_${slot.sessionId}`);
  if (!saved) return null;

  try {
    return JSON.parse(saved);
  } catch {
    return null;
  }
}

export function deleteSlot(slotId) {
  const slots = getSaveSlots().filter(s => s.id !== slotId);
  localStorage.setItem(SAVE_SLOTS_KEY, JSON.stringify(slots));
  return slots;
}
