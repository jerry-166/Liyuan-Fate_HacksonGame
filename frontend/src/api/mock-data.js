/**
 * Mock 数据模块 —— 所有接口的假数据集中管理
 * 当 USE_MOCK=true 时，API 调用直接返回这些数据而无需后端
 * @module api/mock-data
 */

// ========== 初始游戏状态 ==========
export const MOCK_START = {
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
      position: { col: 38, row: 14 }, sprite_key: 'npc_chen_idle',
      relationship: 20, is_available: true,
      current_greeting: '……（陈师傅低头擦拭琴弦，仿佛没看见你）',
      last_dialogue: '', last_options: [], dialogue_round_count: 0
    },
    {
      id: 'npc_xiaohua', name: '小华', role: '年轻学徒', scene: 'stage',
      position: { col: 15, row: 12 }, sprite_key: 'npc_xiaohua_idle',
      relationship: 10, is_available: true,
      current_greeting: '你也是来看戏班笑话的吗？',
      last_dialogue: '', last_options: [], dialogue_round_count: 0
    },
    {
      id: 'npc_laozhou', name: '老周', role: '老艺人', scene: 'stage',
      position: { col: 10, row: 8 }, sprite_key: 'npc_laozhou_idle',
      relationship: 15, is_available: true,
      current_greeting: '（老人靠在柱子上打盹，偶尔咳嗽两声）',
      last_dialogue: '', last_options: [], dialogue_round_count: 0
    },
    {
      id: 'npc_meiyi', name: '梅姨', role: '茶馆老板娘', scene: 'teahouse',
      position: { col: 40, row: 16 }, sprite_key: 'npc_meiyi_idle',
      relationship: 5, is_available: true,
      current_greeting: '哎哟，新面孔啊？进来喝杯茶吧。',
      last_dialogue: '', last_options: [], dialogue_round_count: 0
    },
    {
      id: 'npc_laoli', name: '船夫老李', role: '船夫', scene: 'dock',
      position: { col: 60, row: 22 }, sprite_key: 'npc_laoli_idle',
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

// ========== SSE 对话 Mock 池 ==========
export const MOCK_SSE_POOLS = {
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
      chapter_completed: false, game_ended: false,
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
      chapter_completed: true, game_ended: false,
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
      options: null, chapter_completed: false, game_ended: true,
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
      relationship_change: {}, options: null,
      chapter_completed: false, game_ended: false,
      events_triggered: [], current_chapter: null
    }}
  ],
  first_default: [
    { event: 'delta', data: { chunk: '哦，' } },
    { event: 'delta', data: { chunk: '你是新来的？' } },
    { event: 'delta', data: { chunk: '真没想到这时候还会有人来这小镇。' } },
    { event: 'done', data: {
      full_text: '哦，你是新来的？真没想到这时候还会有人来这小镇。',
      relationship_change: {},
      options: ['我是回来安葬父亲的', '只是路过看看'],
      chapter_completed: false, game_ended: false,
      events_triggered: [], current_chapter: null
    }}
  ],
};

// ========== Mock 章节数据 ==========
export const MOCK_CHAPTERS = [
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

// ========== Mock 物品数据 ==========
export const MOCK_INVENTORY = [
  { id: 'item_urn', name: '父亲的骨灰盒', description: '一个简朴的深色木盒，里面装着父亲柳三秋的骨灰。',
    item_type: 'key', is_key: false, is_discovered: true, location: { scene: 'cemetery' },
    ai_detail: null, ai_detail_locked: false, holdable: true, acquire_method: 'explore', related_npcs: [] },
];

export const MOCK_SCENE_ITEMS = [
  { item_id: 'item_child_costume', name: '孩童戏服',
    narrative_desc: '一件小号的戏曲戏服，红底金线绣传统纹样，约五六岁孩童尺寸。颜色已经褪暗，但叠得很整齐——像是有人经常打开来看，又小心翼翼地折好放回去。衣领内侧用墨笔写了一个小小的「柳」字。',
    location: { scene: 'father_house', position: { col: 20, row: 12 } }, acquire_method: 'click',
    related_npcs: ['npc_chen'] },
];

// ========== Mock 会话列表 ==========
export let MOCK_SESSIONS = [
  {
    session_id: 'sess_mock_001', player_name: '玩家', stage: 2, stage_name: '闻声·异样',
    game_ended: false, created_at: '2026-05-25 10:00:00', updated_at: '2026-05-25 12:30:00'
  },
];

// ========== Mock 普通 NPC（town-npcs）==========
export const MOCK_TOWN_NPCS = [
  { id: 'town_001', name: '卖菜大婶', sprite: 'vendor_f', position: { col: 30, row: 40 }, scene: 'town',
    greeting: '新鲜的青菜嘞——', role: '菜贩',
    movement: { enabled: true, speed: 30, idle_range: [3, 8], wander_range: [4, 12] } },
  { id: 'town_002', name: '货郎老张', sprite: 'peddler_m', position: { col: 45, row: 35 }, scene: 'town',
    greeting: '来看看吧，好东西不等人！', role: '货郎',
    movement: { enabled: true, speed: 35, idle_range: [2, 6], wander_range: [6, 15] } },
];

/** Mock 普通 NPC 可变副本 */
export let mockTownNpcsData = [...MOCK_TOWN_NPCS];

/** 重置 town-npc mock 数据 */
export function resetMockTownNpcs() {
  mockTownNpcsData = [...MOCK_TOWN_NPCS];
}

// ========== Mock 对话轮次 ==========
/** @type {Record<string, number>} 每个 NPC 的对话轮次计数器 */
export let mockDialogueRounds = {};

/** Mock 章节游标 */
export let mockChapterIdx = 0;
export let mockChapterCompleted = new Set();

/** 重置章节状态 */
export function resetMockChapterState() {
  mockChapterIdx = 0;
  mockChapterCompleted = new Set();
  mockDialogueRounds = {};
}
