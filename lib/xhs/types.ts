/**
 * 「小红书攻略提炼」的前后端共用类型。
 *
 * 由 lib/xhs/research.ts 聚合多篇小红书/社区帖子后，用 DeepSeek 收口成 XhsGuide；
 * 作为生成式 UI 卡片（Card kind="xhs_guide"）在 Copilot Dock 里渲染，
 * 每个 spot/eat 可一键加入当前行程（复用 ItinItem 的 why / source_url 证据锚定）。
 */

/** 一个玩法/景点或一处美食 */
export interface XhsSpot {
  /** 名称（景点/餐厅/店名） */
  title: string;
  /** 所在区域/商圈；未知留空 */
  area: string;
  /** 为什么值得去（→ 映射到 ItinItem.why） */
  reason: string;
  /** 实用贴士 / 避坑（门票·预约·排队·最佳时段）；→ 映射到 ItinItem.detail */
  tips: string;
  /** 人均/门票（人民币）估算；无法确定填 0，绝不编造 */
  est_cost: number;
  /** 出处小红书帖链接（必须是检索结果里真实出现的 URL）；未知留空 */
  source_url: string;
}

/** 一份从多篇帖子聚合提炼出的目的地攻略 */
export interface XhsGuide {
  destination: string;
  /** 本次聚焦：美食 / citywalk / 亲子 / 综合… */
  focus: string;
  /** 最佳季节/时段；未知留空 */
  best_time: string;
  /** 建议天数；未知填 0 */
  suggested_days: number;
  /** 玩法/景点 */
  spots: XhsSpot[];
  /** 美食 */
  eats: XhsSpot[];
  /** 通用实用贴士 */
  tips: string[];
  /** 避坑警告 */
  warnings: string[];
  /** 参考的帖子（由后端从真实检索结果确定性填充，非模型生成） */
  sources: { title: string; url: string }[];
}
