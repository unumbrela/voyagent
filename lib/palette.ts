// 全站唯一的「按天配色」来源 —— 行程页编号针 / 地图针脚 / 分享页 / 预算图共用。
// 制图集（atlas）风格：中明度、微降饱和，与青瓷主色 #0f8b8b、墨蓝 #17202e 同一气质，
// 相邻色相错开保证地图上可分辨。
export const DAY_COLORS = [
  "#0f8b8b", // 青瓷（品牌锚点，第 1 天）
  "#5b6abf", // 黛蓝
  "#d97742", // 柿橙
  "#6f8f3f", // 苔绿
  "#9d5b8f", // 紫苏
  "#4a7fb5", // 钢青
  "#c2973a", // 赭金
  "#b25757", // 绛红
];

export const dayColorOf = (day: number) =>
  DAY_COLORS[(((day - 1) % DAY_COLORS.length) + DAY_COLORS.length) % DAY_COLORS.length];
