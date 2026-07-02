// 设计走查用：登录测试账号，批量截图关键页面（桌面 + 移动）
import { chromium } from "playwright";

const BASE = "http://localhost:3000";
const OUT = process.env.SHOT_DIR || "/tmp/ui-shots";
const pages = [
  { path: "/", name: "landing", full: true },
  { path: "/trips", name: "trips" },
  { path: "/study", name: "study", full: true },
];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 });
const page = await ctx.newPage();

// 登录
await page.goto(`${BASE}/login`);
await page.fill('input[type="email"]', "ui-preview@test.local");
await page.fill('input[type="password"]', "preview123456");
await page.click('button[type="submit"]');
await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 15000 });
console.log("logged in ->", page.url());

for (const p of pages) {
  await page.goto(`${BASE}${p.path}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  // 逐屏滚到底再回顶：触发 whileInView 进场动画后再截全页
  await page.evaluate(async () => {
    const step = window.innerHeight * 0.8;
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 220));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/${p.name}.png`, fullPage: !!p.full });
  console.log("shot", p.name);
}

// 移动端 landing
const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const mp = await mctx.newPage();
await mp.goto(`${BASE}/login`);
await mp.fill('input[type="email"]', "ui-preview@test.local");
await mp.fill('input[type="password"]', "preview123456");
await mp.click('button[type="submit"]');
await mp.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 15000 }).catch(() => {});
await mp.goto(`${BASE}/`, { waitUntil: "networkidle" });
await mp.screenshot({ path: `${OUT}/landing-mobile.png` });
console.log("shot landing-mobile");

await browser.close();
