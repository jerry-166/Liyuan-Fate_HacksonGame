/**
 * 城镇 NPC 随机话术库
 *
 * 当玩家与普通 NPC（非故事 NPC）点击"进行对话"时，
 * 从该话术库中随机抽取一条内容展示，避免调用后端 API 报 NPC_NOT_FOUND
 *
 * 扩展方式：直接在对应分类数组中添加新的字符串即可
 *
 * @module scenes/modules/TownNPCDialogue
 */

/**
 * 随机选取数组中的一个元素
 * @param {string[]} arr
 * @returns {string}
 */
function _pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ========== 通用对话（适用于任何城镇 NPC） ==========
const GENERIC_LINES = [
  '最近镇上还挺太平的，就是戏班子那边有点冷清。',
  '你是外乡人吧？来这儿做什么？',
  '这年头日子不好过啊，能听见几句戏就不错了。',
  '哎哟，这天儿可真不错，适合赶集。',
  '你认识陈师傅吗？那可是个角儿啊……可惜了。',
  '老周昨天还来我这儿唠了会儿嗑，说起戏班子的事直叹气。',
  '我们这儿虽然小，但以前可热闹着咧。',
  '年轻人多待几天，镇上虽偏僻，人情味足。',
  '听说码头上那个船夫老李，也是个有故事的人。',
  '茶馆的梅姨知道的事儿可多了，有空去坐坐。',
];

// ========== 按角色分类的话术 ==========

/** 菜贩类 NPC */
const VENDOR_LINES = [
  '新鲜的青菜！刚从地里拔的，水灵着呢——',
  '要买点什么？都是自家种的。',
  '这萝卜炖汤可甜了，来两根？',
  '便宜卖便宜卖，天快黑了急着回家。',
  '你要找戏班子的人啊？顺着老街往北走就到了。',
];

/** 货郎类 NPC */
const PEDDLER_LINES = [
  '来看看吧！针头线脑、胭脂水粉，什么都有！',
  '我今天进了一批好玩意，要不要瞅瞅？',
  '这梳子可是苏州来的好货，姑娘家最喜欢。',
  '走街串巷这么多年，镇上每条路我都熟。',
  '戏班子的人？他们常在我这儿买些小物件。',
  '我挑货走南闯北，见的人多了——你这气质不一般。',
];

/** 茶馆类 NPC / 茶客 */
const TEAHOUSE_LINES = [
  '来壶新茶？今年的龙井可香了。',
  '坐下喝杯茶吧，听听老辈人讲故事。',
  '我们茶馆以前有个说书先生，讲《三国》可好听了，后来不知去哪儿了。',
  '我这儿常有老戏迷来坐，一坐就是一下午。',
  '你父亲当年也常来喝茶——那时候茶馆可热闹了。',
];

/** 码头/船夫类 NPC */
const DOCK_LINES = [
  '今天风平浪静，是个好天气。',
  '要过河吗？我撑船送你。',
  '码头上每天人来人往，消息最灵通了。',
  '江南水多，坐船比走路快多了。',
];

/** 路人/闲逛类 NPC */
const PASSERBY_LINES = [
  '今儿个街上可真热闹。',
  '我们这儿很久没来新面孔了。',
  '你也喜欢听戏？',
  '往前走就是老戏台了，不过那儿现在冷清得很。',
  '我这人没啥本事，就好打听个新鲜事儿。',
];

// ========== 角色 → 话术映射表 ==========

/** @type {Record<string, string[]>} */
const ROLE_LINES = {
  '菜贩': VENDOR_LINES,
  'vendor': VENDOR_LINES,
  '货郎': PEDDLER_LINES,
  'peddler': PEDDLER_LINES,
  '茶馆': TEAHOUSE_LINES,
  'teahouse': TEAHOUSE_LINES,
  '茶客': TEAHOUSE_LINES,
  '码头': DOCK_LINES,
  'dock': DOCK_LINES,
  '船夫': DOCK_LINES,
  '路人': PASSERBY_LINES,
  'passerby': PASSERBY_LINES,
};

/**
 * 获取一条城镇 NPC 随机对话
 *
 * @param {string} npcName - NPC 名字（如 "卖菜大婶"）
 * @param {string} [role]   - NPC 角色（如 "菜贩"、"货郎"），用于匹配分类话术
 * @returns {{ dialogue: string, options: string[] }}
 */
export function getTownNPCDialogue(npcName, role) {
  let pool = GENERIC_LINES;

  // 按角色匹配专属话术
  if (role && ROLE_LINES[role]) {
    pool = [...pool, ...ROLE_LINES[role]];
  }

  // 从池中随机抽取
  const dialogue = _pick(pool);

  // 生成简单的回应选项
  const options = [
    '谢谢你，我再转转。',
    '说得有道理。',
    '好，我知道了。',
  ];

  return { dialogue, options };
}
