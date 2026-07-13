// README 配图：对线上站点批量截图（桌面 1440×900 @1.5x，JPEG）
// 用法：node scripts/readme-shots.mjs   （BASE / SHOT_DIR 可用环境变量覆盖）
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE || "https://voyagent-five.vercel.app";
const OUT = process.env.SHOT_DIR || "docs/screenshots";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1.5,
});
const page = await ctx.newPage();

const settle = async (ms = 1500) => {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(ms);
};
const shot = async (name) => {
  await page.screenshot({ path: `${OUT}/${name}.jpg`, type: "jpeg", quality: 85 });
  console.log("shot", name);
};

// 先登录：站点会把未登录访问重定向到 /login
await page.goto(`${BASE}/login`);
await page.fill('input[type="email"]', "ui-preview@test.local");
await page.fill('input[type="password"]', "preview123456");
await page.click('button[type="submit"]');
await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 });
console.log("logged in ->", page.url());

// 1. 首页 hero
await page.goto(`${BASE}/`);
await settle(3000);
await shot("landing-hero");

// 2. 首页展示带（第二个 Leaflet 地图；hero 地图有持续动画，不能用 scrollIntoViewIfNeeded）
await page.evaluate(() => {
  const maps = document.querySelectorAll(".leaflet-container");
  const target = maps[maps.length > 1 ? 1 : 0];
  if (target) window.scrollTo(0, target.getBoundingClientRect().top + window.scrollY - 140);
});
await settle(3500);
await shot("landing-showcase");

// 3. 目的地演示页（京都：出境 CARTO 底图 + 真实航班）
await page.goto(`${BASE}/demo/kyoto`);
await settle(4000);
await page.evaluate(() => {
  const m = document.querySelector(".leaflet-container");
  if (m) window.scrollTo(0, m.getBoundingClientRect().top + window.scrollY - 120);
});
await page.waitForTimeout(3000);
await shot("demo-kyoto");

// 4. 行程详情：优先已有行程，否则一键载入示例行程
await page.goto(`${BASE}/trips`);
await settle(1500);
let tripLink = page.locator('a[href^="/trips/"]').first();
if ((await tripLink.count()) === 0) {
  await page.evaluate(() => fetch("/api/trips/sample", { method: "POST" }));
  await page.waitForTimeout(3000);
  await page.goto(`${BASE}/trips`);
  await settle(1500);
  tripLink = page.locator('a[href^="/trips/"]').first();
}
const href = await tripLink.getAttribute("href");
console.log("open trip", href);
await page.goto(`${BASE}${href}`);
await settle(4000);
await page.evaluate(() => {
  const m = document.querySelector(".leaflet-container");
  if (m) m.scrollIntoView({ block: "center" });
});
await page.waitForTimeout(2500);
await shot("trip-detail");

// 5. 右下角智能体：真发一句话，截出对话 + 工具调用 + 卡片
//    键盘输入模式（无头浏览器没有语音识别，且截图要的是输入框而不是「点击说话」）
await page.evaluate(() => localStorage.setItem("hci_input_mode", "text"));
await page.reload();
await settle(2500);
await page.click('button[aria-label="打开旅行助手 小行"]');
await page.waitForTimeout(800);
const box = page.locator("textarea").first();
await box.fill("查一下目的地这几天的天气");
await box.press("Control+Enter");
const thinking = () => page.getByText("小行思考中…").first();
await thinking().waitFor({ timeout: 15000 }).catch(() => {});
await thinking().waitFor({ state: "detached", timeout: 120000 }).catch(() => {});
await page.waitForTimeout(1500);
await shot("copilot");

await browser.close();
console.log("done ->", OUT);
