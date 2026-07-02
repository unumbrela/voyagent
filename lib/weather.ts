/** 每日天气数据（与 /api/weather 返回结构一致） */
export interface DayWeather {
  code: number; // WMO weather code
  tmax: number;
  tmin: number;
  pop: number; // 降水概率 %
}

/** WMO weather code → emoji + 中文描述。未知码回退「多云」。 */
export function wmoMeta(code: number): { emoji: string; label: string } {
  if (code === 0) return { emoji: "☀️", label: "晴" };
  if (code === 1) return { emoji: "🌤️", label: "晴间多云" };
  if (code === 2) return { emoji: "⛅", label: "多云" };
  if (code === 3) return { emoji: "☁️", label: "阴" };
  if (code === 45 || code === 48) return { emoji: "🌫️", label: "雾" };
  if (code >= 51 && code <= 57) return { emoji: "🌦️", label: "毛毛雨" };
  if (code >= 61 && code <= 67) return { emoji: "🌧️", label: "雨" };
  if (code >= 71 && code <= 77) return { emoji: "🌨️", label: "雪" };
  if (code >= 80 && code <= 82) return { emoji: "🌧️", label: "阵雨" };
  if (code === 85 || code === 86) return { emoji: "🌨️", label: "阵雪" };
  if (code >= 95) return { emoji: "⛈️", label: "雷暴" };
  return { emoji: "⛅", label: "多云" };
}
