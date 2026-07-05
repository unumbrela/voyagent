// 数字人「小行」循环视频 · 图生视频生成器（ZenMux Vertex 协议 · doubao-seedance-1.5-pro）
// ------------------------------------------------------------------
// 以本目录的静态立绘为「首帧」，调用 ZenMux 的 Vertex-AI 兼容视频接口，
// 用 bytedance/doubao-seedance-1.5-pro 生成会真眨眼/呼吸/说话的循环小视频，
// 结果写入 public/avatar/xiaoxing/_raw/<clip>.mp4。
// 之后再跑  pnpm avatar:video --loopfade  处理成前端要用的、无缝循环的 <clip>-loop.mp4。
//
// 关键发现（2026-07-05）：
//   · Seedance **2.0**（无论原生 /api/v1/videos 还是 Vertex 协议）会对写实人像首帧硬拦截
//     （"input image may contain real person" 防深伪）——走不通。
//   · Seedance **1.5-pro** 走 **Vertex 协议** 则**能通过**、正常出视频（且无第三方水印）。
//     且它不在原生 Videos API 白名单里（原生只接 2.0），所以必须用 Vertex 协议。
//
// 用法（需 .env.local 里的 ZENMUX_API_KEY）：
//   node --env-file=.env.local scripts/avatar-gen.mjs             # 生成全部 5 段
//   node --env-file=.env.local scripts/avatar-gen.mjs idle talk   # 只生成指定段
//   ... --seconds 5 --resolution 720p --model bytedance/doubao-seedance-1.5-pro --dry
//
// 接口（提交长任务 → 轮询）：
//   POST {BASE}/publishers/{provider}/models/{model}:predictLongRunning  → { name }
//   POST {BASE}/publishers/{provider}/models/{model}:fetchPredictOperation → { done, response:{ videos:[{ bytesBase64Encoded }] } }
//   Authorization: Bearer $ZENMUX_API_KEY

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";

const BASE = "https://zenmux.ai/api/vertex-ai/v1";
// 实测可用于写实人像首帧的组合。可用 --model / ZENMUX_VIDEO_MODEL 覆盖
// （注意：2.0 会被防深伪拦截；provider 前缀是 bytedance 而非文档里的 volcengine）。
const DEFAULT_MODEL = "bytedance/doubao-seedance-1.5-pro";

// 每个片段：首帧立绘 + 提示词（与 video-prompts.md 一致，强调回到起始姿态以便无缝循环）
const SPEC = {
  idle: {
    image: "idle.jpg",
    prompt:
      "以这张肖像为首帧，让她自然地轻微活动：平静微笑看着镜头，缓慢眨眼2~3次，" +
      "轻柔呼吸使肩部有细微起伏，头部极其轻微地自然摆动，几缕发丝随之轻动。" +
      "镜头固定不动，背景极光与人物保持一致，动作幅度很小、温柔自然，" +
      "结尾必须回到与首帧完全一致的姿态与表情，以便无缝循环。写实真人、不要变形、不要转头大幅度动作。",
  },
  talk: {
    image: "idle.jpg",
    prompt:
      "以这张肖像为首帧，让她像在亲切地讲话：嘴自然地开合说话，配合轻微点头、" +
      "眉毛和眼神的自然变化，偶尔眨眼，面带微笑，热情友好。镜头固定，背景一致，" +
      "动作自然不夸张，结尾必须回到与首帧接近一致的姿态与闭合的嘴型，以便无缝循环。写实真人、不要变形。",
  },
  happy: {
    image: "happy.jpg",
    prompt:
      "以这张开心表情的肖像为首帧，她愉快地笑，眉眼上扬、脸颊微抬，自然眨眼与呼吸，轻轻点头。" +
      "镜头固定、写实、动作温柔，结尾回到与首帧一致的姿态以便无缝循环。",
  },
  thinking: {
    image: "thinking.jpg",
    prompt:
      "以这张思考表情的肖像为首帧，她若有所思，眼神向上方游移、轻轻歪头、偶尔眨眼，安静自然。" +
      "镜头固定、写实，结尾回到与首帧一致的姿态以便无缝循环。",
  },
  concerned: {
    image: "concerned.jpg",
    prompt:
      "以这张关切表情的肖像为首帧，她带着歉意与关心，眉头微蹙、眼神柔和、缓慢眨眼呼吸。" +
      "镜头固定、写实，结尾回到与首帧一致的姿态以便无缝循环。",
  },
};
const ALL = Object.keys(SPEC);

function parseArgs(argv) {
  const opts = {
    clips: [],
    dir: "public/avatar/xiaoxing",
    out: null, // 默认 <dir>/_raw
    seconds: 5,
    resolution: "720p",
    model: process.env.ZENMUX_VIDEO_MODEL || DEFAULT_MODEL,
    dry: false,
    pollMs: 6000,
    maxWaitMs: 15 * 60 * 1000,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--help" || a === "-h") opts.help = true;
    else if (a === "--dir") opts.dir = next();
    else if (a === "--out") opts.out = next();
    else if (a === "--seconds") opts.seconds = Number(next());
    else if (a === "--resolution") opts.resolution = next();
    else if (a === "--model") opts.model = next();
    else if (a === "--dry") opts.dry = true;
    else if (a.startsWith("--")) fail(`未知参数：${a}`);
    else if (ALL.includes(a)) opts.clips.push(a);
    else fail(`未知片段「${a}」，可选：${ALL.join(" / ")}`);
  }
  if (opts.clips.length === 0) opts.clips = ALL;
  const slash = opts.model.indexOf("/");
  if (slash < 1) fail(`--model 需形如 provider/model，收到：${opts.model}`);
  opts.provider = opts.model.slice(0, slash);
  opts.modelName = opts.model.slice(slash + 1);
  return opts;
}

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}
const mimeOf = (f) =>
  extname(f).toLowerCase() === ".png" ? "image/png" : "image/jpeg";
const human = (b) => (b > 1e6 ? `${(b / 1e6).toFixed(1)}MB` : `${Math.round(b / 1e3)}KB`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 提交生成任务 → 返回 operation name */
async function submit(key, prompt, imgB64, mime, opts) {
  const url = `${BASE}/publishers/${opts.provider}/models/${opts.modelName}:predictLongRunning`;
  const body = {
    instances: [{ prompt, image: { bytesBase64Encoded: imgB64, mimeType: mime } }],
    parameters: { durationSeconds: opts.seconds, resolution: opts.resolution },
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const txt = await res.text();
  if (!res.ok) throw new Error(`提交失败 ${res.status}: ${txt.slice(0, 500)}`);
  let json;
  try {
    json = JSON.parse(txt);
  } catch {
    throw new Error(`提交返回非 JSON：${txt.slice(0, 300)}`);
  }
  if (!json.name) throw new Error(`提交返回缺少 operation name：${txt.slice(0, 300)}`);
  return json.name;
}

/** 轮询任务 → 成功返回视频 Buffer */
async function poll(key, name, opts) {
  const url = `${BASE}/publishers/${opts.provider}/models/${opts.modelName}:fetchPredictOperation`;
  const deadline = Date.now() + opts.maxWaitMs;
  for (;;) {
    if (Date.now() > deadline) throw new Error("轮询超时（>15min）");
    await sleep(opts.pollMs);
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ operationName: name }),
    });
    const txt = await res.text();
    if (!res.ok) {
      process.stdout.write(`(轮询 ${res.status}，重试) `);
      continue;
    }
    let json;
    try {
      json = JSON.parse(txt);
    } catch {
      process.stdout.write("(非JSON，重试) ");
      continue;
    }
    if (json.error)
      throw new Error(`任务出错：${JSON.stringify(json.error).slice(0, 400)}`);
    if (json.done) {
      const resp = json.response ?? json;
      const filtered = resp.raiMediaFilteredReasons || resp.raiMediaFilteredCount;
      if (filtered)
        throw new Error(
          `被内容风控拦截：${JSON.stringify(resp.raiMediaFilteredReasons || resp).slice(0, 300)}`,
        );
      const v = (resp.videos || resp.generatedVideos || [])[0];
      const b64 = v?.bytesBase64Encoded || v?.video?.bytesBase64Encoded;
      if (b64) return Buffer.from(b64, "base64");
      const uri = v?.uri || v?.url || v?.gcsUri;
      if (uri) {
        const r = await fetch(uri);
        if (!r.ok) throw new Error(`拉取视频 URL 失败 ${r.status}`);
        return Buffer.from(await r.arrayBuffer());
      }
      throw new Error(`成功但取不到视频：${JSON.stringify(resp).slice(0, 300)}`);
    }
    process.stdout.write("·"); // 进行中
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(
      `图生视频生成器（ZenMux Vertex · 默认 ${DEFAULT_MODEL}）\n` +
        `用法：node --env-file=.env.local scripts/avatar-gen.mjs [clips...] [--seconds 5] [--resolution 720p] [--model provider/model] [--dry]\n` +
        `clips: ${ALL.join(" / ")}（默认全部）\n` +
        `生成后处理：pnpm avatar:video --loopfade`,
    );
    return;
  }
  const key = process.env.ZENMUX_API_KEY;
  if (!key)
    fail("缺少 ZENMUX_API_KEY。请确认 .env.local 里已配置，并用 node --env-file=.env.local 运行。");

  const dir = resolve(opts.dir);
  const outDir = resolve(opts.out || join(opts.dir, "_raw"));
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  console.log(
    `模型 ${opts.model} · ${opts.seconds}s · ${opts.resolution}\n` +
      `首帧 ← ${dir}\n输出 → ${outDir}\n生成：${opts.clips.join(" / ")}\n`,
  );

  let ok = 0;
  for (const clip of opts.clips) {
    const spec = SPEC[clip];
    const imgPath = join(dir, spec.image);
    if (!existsSync(imgPath)) {
      console.error(`✗ ${clip}: 找不到首帧 ${imgPath}`);
      continue;
    }
    const imgBuf = readFileSync(imgPath);
    const imgB64 = imgBuf.toString("base64");
    const mime = mimeOf(spec.image);

    if (opts.dry) {
      console.log(`[dry] ${clip} ← ${spec.image} (${human(imgBuf.length)})`);
      console.log(`      prompt: ${spec.prompt.slice(0, 60)}…\n`);
      continue;
    }

    process.stdout.write(`▶ ${clip.padEnd(9)} ← ${spec.image}  提交… `);
    try {
      const name = await submit(key, spec.prompt, imgB64, mime, opts);
      process.stdout.write("排队/生成中 ");
      const vid = await poll(key, name, opts);
      const outPath = join(outDir, `${clip}.mp4`);
      writeFileSync(outPath, vid);
      console.log(` ✓ ${human(vid.length)} → _raw/${clip}.mp4`);
      ok++;
    } catch (e) {
      console.log(" ✗");
      console.error(`  ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  console.log(`\n完成 ${ok}/${opts.clips.length} 段 → ${outDir}`);
  if (ok > 0)
    console.log(
      "下一步：pnpm avatar:video --seamless-all\n" +
        "  （去音轨/降帧/缩放 + boomerang 无缝循环 → <clip>-loop.mp4）\n" +
        "  Seedance 片段常有缓慢位移/推近、不回到起点，boomerang(正放+倒放)比交叉淡化更自然、无重影；\n" +
        "  若某段确实首尾一致，也可改用 --loopfade（交叉淡化，时长不翻倍）。",
    );
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
