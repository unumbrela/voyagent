/**
 * WGS-84 → GCJ-02（火星坐标）转换。
 *
 * 高德/腾讯等国内底图用 GCJ-02 加偏坐标系；我们的行程坐标是真实 WGS-84。
 * 直接把 WGS-84 点画在高德瓦片上会整体偏移约 400–600m（针脚落到错误街区）。
 * 仅在「往国内中文底图上落点」时做此转换；真实距离计算仍用原始 WGS-84。
 *
 * 经典公开算法（丁伟等），中国境外原样返回。
 */

const A = 6378245.0; // 克拉索夫斯基椭球长半轴
const EE = 0.00669342162296594323; // 椭球偏心率平方

function outOfChina(lat: number, lon: number): boolean {
  return lon < 72.004 || lon > 137.8347 || lat < 0.8293 || lat > 55.8271;
}

/** 粗略国内判定（bbox）：行程地图据此选高德引擎/地理编码源 */
export function isInChina(lat: number, lon: number): boolean {
  return !outOfChina(lat, lon);
}

function transformLat(x: number, y: number): number {
  let ret =
    -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  ret += ((20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2) / 3;
  ret += ((20 * Math.sin(y * Math.PI) + 40 * Math.sin((y / 3) * Math.PI)) * 2) / 3;
  ret +=
    ((160 * Math.sin((y / 12) * Math.PI) + 320 * Math.sin((y * Math.PI) / 30)) * 2) / 3;
  return ret;
}

function transformLon(x: number, y: number): number {
  let ret = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += ((20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2) / 3;
  ret += ((20 * Math.sin(x * Math.PI) + 40 * Math.sin((x / 3) * Math.PI)) * 2) / 3;
  ret += ((150 * Math.sin((x / 12) * Math.PI) + 300 * Math.sin((x / 30) * Math.PI)) * 2) / 3;
  return ret;
}

/** [lat, lon] WGS-84 → [lat, lon] GCJ-02 */
export function wgs84ToGcj02(lat: number, lon: number): [number, number] {
  if (outOfChina(lat, lon)) return [lat, lon];
  let dLat = transformLat(lon - 105, lat - 35);
  let dLon = transformLon(lon - 105, lat - 35);
  const radLat = (lat / 180) * Math.PI;
  let magic = Math.sin(radLat);
  magic = 1 - EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180) / (((A * (1 - EE)) / (magic * sqrtMagic)) * Math.PI);
  dLon = (dLon * 180) / ((A / sqrtMagic) * Math.cos(radLat) * Math.PI);
  return [lat + dLat, lon + dLon];
}

/**
 * [lat, lon] GCJ-02 → [lat, lon] WGS-84（正变换无闭式逆，用不动点迭代逼近，
 * 3 次即收敛到 <1m）。用于「从高德地图上点选/读回的坐标」还原成真实坐标。
 */
export function gcj02ToWgs84(lat: number, lon: number): [number, number] {
  if (outOfChina(lat, lon)) return [lat, lon];
  let wLat = lat;
  let wLon = lon;
  for (let i = 0; i < 3; i++) {
    const [gLat, gLon] = wgs84ToGcj02(wLat, wLon);
    wLat += lat - gLat;
    wLon += lon - gLon;
  }
  return [wLat, wLon];
}
