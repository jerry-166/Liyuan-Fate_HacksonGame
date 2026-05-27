/**
 * 子场景配置定义 —— 6个室内场景的完整参数
 *
 * 每个子场景与主地图上的一栋建筑对应，玩家走到入口区域按F键进入。
 * 子场景内支持与主地图一致的完整交互（NPC、物品、碰撞、对话）。
 *
 * @module scenes/modules/SubSceneConfig
 */

import { GAME } from '../../config.js';
import { MAP_SCALE } from './MapGenerator.js';

const TILE = GAME.TILE_SIZE;

/** 子场景显示缩放因子 — 为主地图的 50%，解决子场景图片过大的问题 */
export const SUB_MAP_SCALE = MAP_SCALE * 0.5;

/**
 * 子场景配置
 *
 * 每个子场景包含：
 * - id:           唯一标识
 * - name:         显示名称
 * - imageKey:     Phaser 纹理 key（preload 中加载）
 * - imagePath:    图片路径
 * - pixelW/H:     原始图片像素尺寸
 * - tileCols/Rows: 换算的瓦片列/行数（= 像素 / TILE_SIZE，向上取整）
 * - playerSpawn:   进入子场景后玩家的出生位置（瓦片坐标）
 * - exitZone:      子场景内出口区域（玩家走到此处显示"按F离开"）
 * - mainMapBuilding: 主地图上对应建筑的矩形区域（瓦片坐标）
 * - mainMapEntryZone: 主地图上触发入口提示的区域（建筑南侧1行）
 * - hasStateSwitch: 是否有状态切换（如戏台ruined→renewed）
 * - stateKey:      状态切换的 localStorage 标志 key
 * - altImageKey/altImagePath: 切换后的图片
 * - defaultCollision: 默认碰撞数据（边界墙）
 * - npcPlaceholders: NPC 占位配置（后续由后端/编辑器填充）
 */
export const SUBSCENES = {
  stage: {
    id: 'stage',
    name: '戏台',
    imageKey: 'subscene_stage',
    imagePath: '/assets/images/maps/stage_ruined.png',
    pixelW: 1536,
    pixelH: 1024,
    get tileCols() { return Math.ceil(this.pixelW / TILE); },
    get tileRows() { return Math.ceil(this.pixelH / TILE); },
    playerSpawn: { col: 48, row: 58 },
    exitZone: { col: 44, row: 60, w: 8, h: 2 },
    mainMapBuilding: { col: 4, row: 4, w: 14, h: 11 },
    mainMapEntryZone: { col: 6, row: 15, w: 6, h: 1 },
    hasStateSwitch: true,
    stateKey: '_stage_renewed',
    altImageKey: 'subscene_stage_renewed',
    altImagePath: '/assets/images/maps/stage_renewed.png',
    defaultCollision: null, // 运行时由边界自动生成
    npcPlaceholders: [
      { id: 'npc_chen', name: '陈师傅', col: 48, row: 30, greeting: '这戏台……老伙计，你终于回来了。' },
      { id: 'npc_xiaohua', name: '小华', col: 30, row: 25, greeting: '戏台破成这样，还能演吗？' },
    ],
  },

  tea_house: {
    id: 'tea_house',
    name: '茶馆',
    imageKey: 'subscene_tea_house',
    imagePath: '/assets/images/maps/tea_house.png',
    pixelW: 1484,
    pixelH: 1060,
    get tileCols() { return Math.ceil(this.pixelW / TILE); },
    get tileRows() { return Math.ceil(this.pixelH / TILE); },
    playerSpawn: { col: 46, row: 62 },
    exitZone: { col: 42, row: 63, w: 8, h: 2 },
    mainMapBuilding: { col: 36, row: 11, w: 11, h: 9 },
    mainMapEntryZone: { col: 38, row: 20, w: 5, h: 1 },
    hasStateSwitch: false,
    defaultCollision: null,
    npcPlaceholders: [
      { id: 'npc_laozhou', name: '老周', col: 50, row: 35, greeting: '来，喝杯茶，我给你讲讲这镇上的事。' },
    ],
  },

  dock: {
    id: 'dock',
    name: '码头',
    imageKey: 'subscene_dock',
    imagePath: '/assets/images/maps/dock.png',
    pixelW: 1774,
    pixelH: 887,
    get tileCols() { return Math.ceil(this.pixelW / TILE); },
    get tileRows() { return Math.ceil(this.pixelH / TILE); },
    playerSpawn: { col: 55, row: 50 },
    exitZone: { col: 50, row: 51, w: 10, h: 2 },
    mainMapBuilding: { col: 64, row: 21, w: 12, h: 7 },
    mainMapEntryZone: { col: 66, row: 28, w: 6, h: 1 },
    hasStateSwitch: false,
    defaultCollision: null,
    npcPlaceholders: [
      { id: 'npc_laoli', name: '老李', col: 60, row: 25, greeting: '船来得少了……这镇子也冷清了。' },
    ],
  },

  ancestral_hall: {
    id: 'ancestral_hall',
    name: '祠堂',
    imageKey: 'subscene_ancestral_hall',
    imagePath: '/assets/images/maps/ancestral_hall.png',
    pixelW: 1387,
    pixelH: 1134,
    get tileCols() { return Math.ceil(this.pixelW / TILE); },
    get tileRows() { return Math.ceil(this.pixelH / TILE); },
    playerSpawn: { col: 43, row: 66 },
    exitZone: { col: 39, row: 67, w: 8, h: 2 },
    mainMapBuilding: { col: 30, row: 4, w: 10, h: 9 },
    mainMapEntryZone: { col: 32, row: 13, w: 5, h: 1 },
    hasStateSwitch: false,
    defaultCollision: null,
    npcPlaceholders: [
      { id: 'npc_meiyi', name: '美怡', col: 43, row: 30, greeting: '祖先的牌位……你还记得吗？' },
    ],
  },

  fathers_house: {
    id: 'fathers_house',
    name: '父亲旧居',
    imageKey: 'subscene_fathers_house',
    imagePath: '/assets/images/maps/fathers_house.png',
    pixelW: 1387,
    pixelH: 1134,
    get tileCols() { return Math.ceil(this.pixelW / TILE); },
    get tileRows() { return Math.ceil(this.pixelH / TILE); },
    playerSpawn: { col: 43, row: 66 },
    exitZone: { col: 39, row: 67, w: 8, h: 2 },
    mainMapBuilding: { col: 18, row: 36, w: 9, h: 9 },
    mainMapEntryZone: { col: 20, row: 45, w: 4, h: 1 },
    hasStateSwitch: false,
    defaultCollision: null,
    npcPlaceholders: [],
  },

  graveyard: {
    id: 'graveyard',
    name: '墓地',
    imageKey: 'subscene_graveyard',
    imagePath: '/assets/images/maps/graveyard.png',
    pixelW: 1448,
    pixelH: 1086,
    get tileCols() { return Math.ceil(this.pixelW / TILE); },
    get tileRows() { return Math.ceil(this.pixelH / TILE); },
    playerSpawn: { col: 45, row: 63 },
    exitZone: { col: 41, row: 64, w: 8, h: 2 },
    // 墓地主地图入口：北部边缘，紧贴戏台北侧的树林小径
    mainMapBuilding: { col: 3, row: 1, w: 6, h: 3 },
    mainMapEntryZone: { col: 5, row: 3, w: 3, h: 1 },
    hasStateSwitch: false,
    defaultCollision: null,
    npcPlaceholders: [],
  },
};

/**
 * 建筑入口列表 — 用于快速遍历检测玩家是否接近建筑
 * 每项包含：subSceneId, entryZone (主地图瓦片矩形), name
 */
export const BUILDING_ENTRIES = Object.values(SUBSCENES).map(sc => ({
  subSceneId: sc.id,
  name: sc.name,
  entryZone: sc.mainMapEntryZone,
  buildingZone: sc.mainMapBuilding,
}));

/**
 * 入口检测距离（瓦片）— 玩家中心与入口区域的最大距离
 */
export const ENTRY_DETECT_RANGE = 2;

/**
 * 为子场景生成边界碰撞数据
 * 将地图边缘2行/列标记为碰撞，防止玩家走出地图
 *
 * @param {number} cols - 子场景瓦片列数
 * @param {number} rows - 子场景瓦片行数
 * @param {number} [borderWidth=2] - 边界碰撞宽度（瓦片数）
 * @returns {Object} 碰撞映射 { "col_row": true }
 */
export function generateBorderCollision(cols, rows, borderWidth = 2) {
  const map = {};
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (c < borderWidth || c >= cols - borderWidth || r < borderWidth || r >= rows - borderWidth) {
        map[`${c}_${r}`] = true;
      }
    }
  }
  // 出口区域不碰撞
  return map;
}

/**
 * 获取子场景碰撞数据的 localStorage key
 * @param {string} subSceneId
 * @returns {string}
 */
export function getCollisionKey(subSceneId) {
  return `editor_collision_map_${subSceneId}`;
}

/**
 * 获取子场景 NPC 位置的 localStorage key
 * @param {string} subSceneId
 * @returns {string}
 */
export function getNPCPositionsKey(subSceneId) {
  return `editor_npc_positions_${subSceneId}`;
}
