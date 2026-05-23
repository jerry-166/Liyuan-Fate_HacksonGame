/**
 * API 客户端 — 封装所有后端通信
 * 当前使用 Mock 数据，联调时切换到真实 API
 */
const BASE = '/api';

// ========== Mock 数据 ==========

const MOCK_START = {
  "session_id": "mock_sess_001",
  "player_name": "玩家",
  "current_stage": 1,
  "stage_params": {
    "id": 1,
    "name": "不屑",
    "description": "戏班众人对你冷眼相看",
    "color_tone": "cold",
    "bgm_mood": "melancholy",
    "dialogue_tone": "冷漠、疏离、话中带刺"
  },
  "npcs": [
    {
      "id": "npc_chen",
      "name": "陈师傅",
      "role": "老琴师",
      "scene": "tavern",
      "position": { "x": 400, "y": 300 },
      "sprite_key": "npc_chen_idle",
      "relationship": 0,
      "is_available": true,
      "current_greeting": "……（低头擦琴，仿佛没看见你）"
    },
    {
      "id": "npc_xiaohua",
      "name": "小华",
      "role": "年轻学徒",
      "scene": "stage",
      "position": { "x": 200, "y": 400 },
      "sprite_key": "npc_xiaohua_idle",
      "relationship": 0,
      "is_available": true,
      "current_greeting": "你也是来看戏班笑话的吗？"
    }
  ],
  "events_triggered": [],
  "game_ended": false
};

const MOCK_DIALOGUE_EVENTS = [
  'event: delta\ndata: {"chunk": "戏班啊……"}\n',
  'event: delta\ndata: {"chunk": "三十年前，这镇上的戏台可是夜夜满座。"}\n',
  'event: delta\ndata: {"chunk": "你父亲那时候，一出《空城计》能唱哭半条街的人。"}\n',
  `event: done
data: {"full_text":"戏班啊……三十年前，这镇上的戏台可是夜夜满座。你父亲那时候，一出《空城计》能唱哭半条街的人。","relationship_change":{"npc_chen":5},"options":[{"id":1,"text":"后来发生了什么？"},{"id":2,"text":"我父亲也会唱戏？"},{"id":3,"text":"那现在为什么变成这样了……"}],"stage_changed":false,"new_stage":null,"ending_triggered":false,"events_triggered":[]}
`,
];

// ========== API 方法 ==========

let USE_MOCK = true;

export function setUseMock(useMock) {
  USE_MOCK = useMock;
}

export async function startGame(playerName = '玩家') {
  if (USE_MOCK) {
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
  if (USE_MOCK) return { ...MOCK_START };
  const res = await fetch(`${BASE}/game/${sessionId}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

/**
 * 发起 NPC 对话 — 返回 ReadableStream 用于 SSE 解析
 */
export async function startDialogueStream(sessionId, npcId, playerMessage = null) {
  if (USE_MOCK) {
    return createMockSSEStream();
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

function createMockSSEStream() {
  let index = 0;
  const events = MOCK_DIALOGUE_EVENTS;
  return new ReadableStream({
    pull(controller) {
      if (index < events.length) {
        // 模拟延迟，让流式效果可见
        return new Promise(resolve => {
          setTimeout(() => {
            controller.enqueue(new TextEncoder().encode(events[index]));
            index++;
            resolve();
          }, index < events.length - 1 ? 300 : 100);
        });
      } else {
        controller.close();
      }
    }
  });
}

export async function evaluateEnding(sessionId) {
  if (USE_MOCK) {
    return {
      type: 'accept_leader',
      title: '梨园新火',
      summary: '你选择扛起戏班的大旗。戏台上，第一声锣响震碎了多年的沉寂……',
      key_moments: [{ stage: 1, description: '第一次踏入破旧戏台' }],
      life_lesson: '传承不是守住灰烬，而是让火焰继续燃烧。',
      npc_endings: []
    };
  }
  const res = await fetch(`${BASE}/game/${sessionId}/evaluate`, { method: 'POST' });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
