// 数字人「小行」循环视频 · 一键处理器
// ------------------------------------------------------------------
// 你用图生视频模型（可灵 Kling / 即梦 Dreamina / Runway / 海螺 / Vidu / Sora）
// 以本项目的静态立绘为首帧生成几段小视频后，把下载的原始 mp4 丢进收件箱目录，
// 跑这个脚本，它会自动：
//   · 按文件名认领片段（idle / talk / happy / thinking / concerned）
//   · 去掉音轨（小行的嗓音来自独立 TTS，视频恒静音）
//   · 截到指定时长、缩到合适宽度、转 H.264 + yuv420p + faststart（网页秒开、全平台兼容）
//   · 可选「回旋」无缝循环（正放+倒放拼接，任何片段都能无缝首尾相接）
//   · 原子写入 <clip>-loop.mp4（先写临时文件再改名，失败不会毁掉现有视频）
//
// 用法：
//   1) 把下载的视频放进 public/avatar/xiaoxing/_raw/，文件名带上片段关键词，例如
//        idle.mp4 / 小行-talk-final.mp4 / happy_v2.mp4 …
//      然后： pnpm avatar:video
//   2) 或显式指定： pnpm avatar:video idle=~/Downloads/a.mp4 talk=~/Downloads/b.mp4
//
// 常用开关：
//   --seconds 6      每段最长秒数（默认 6）
//   --width 720      最大宽度（默认 720，竖构图会按比例缩高，不足则原样）
//   --seamless       给非 talk 片段做「回旋」无缝循环（片段循环处有跳变时加它）
//   --seamless-all   连 talk 也做回旋（倒放说话通常怪，慎用）
//   --fps 30         回旋时统一帧率（默认 30）
//   --in <dir>       收件箱目录（默认 public/avatar/xiaoxing/_raw）
//   --dir <dir>      输出目录（默认 public/avatar/xiaoxing）
//   --keep-audio     保留音轨（默认去掉）
//   --dry            只打印将执行的 ffmpeg 命令，不真正处理
//
// 依赖：本机 ffmpeg（`ffmpeg -version` 能跑即可）。无任何 npm 依赖。

import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { homedir } from "node:os";

/** 五个片段：idle/talk 必需，其余可选（缺则前端回退 idle/talk） */
const CLIPS = ["idle", "talk", "happy", "thinking", "concerned"];
const VIDEO_EXTS = new Set([".mp4", ".mov", ".webm", ".mkv", ".m4v", ".avi", ".gif"]);

// ── 解析参数 ──
function parseArgs(argv) {
  const opts = {
    in: null,
    dir: "public/avatar/xiaoxing",
    seconds: 6,
    width: 720,
    fps: 30,
    seamless: false,
    seamlessAll: false,
    loopfade: 0, // >0 时做「交叉淡化」无缝循环，值=淡化秒数
    keepAudio: false,
    dry: false,
    help: false,
    explicit: {}, // clip -> path
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--help" || a === "-h") opts.help = true;
    else if (a === "--in") opts.in = next();
    else if (a === "--dir") opts.dir = next();
    else if (a === "--seconds") opts.seconds = Number(next());
    else if (a === "--width") opts.width = Number(next());
    else if (a === "--fps") opts.fps = Number(next());
    else if (a === "--seamless") opts.seamless = true;
    else if (a === "--seamless-all") (opts.seamless = true), (opts.seamlessAll = true);
    else if (a === "--loopfade") {
      // 可选带值：--loopfade 或 --loopfade 0.5；不带值默认 0.4s
      const peek = argv[i + 1];
      opts.loopfade =
        peek !== undefined && !peek.startsWith("--") && !peek.includes("=") && Number.isFinite(Number(peek))
          ? Number(argv[++i])
          : 0.4;
    }
    else if (a === "--keep-audio") opts.keepAudio = true;
    else if (a === "--dry") opts.dry = true;
    else if (a.includes("=")) {
      const [clip, ...rest] = a.split("=");
      const path = rest.join("=");
      if (!CLIPS.includes(clip)) fail(`未知片段名「${clip}」，可选：${CLIPS.join(" / ")}`);
      opts.explicit[clip] = expandHome(path);
    } else fail(`无法识别的参数：${a}（用 --help 看用法）`);
  }
  return opts;
}

function expandHome(p) {
  return p.startsWith("~") ? join(homedir(), p.slice(1)) : p;
}

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

const HELP = `数字人循环视频 · 一键处理器

把图生视频模型导出的原始 mp4 处理成前端要用的 <clip>-loop.mp4。

步骤：
  1. 用可灵/即梦/Runway 等，以 public/avatar/xiaoxing/<clip>.jpg 为首帧生成小视频
     （提示词见 public/avatar/xiaoxing/video-prompts.md）。
  2. 下载的视频放进  public/avatar/xiaoxing/_raw/  ，文件名带片段关键词：
       idle*.mp4  talk*.mp4  happy*.mp4  thinking*.mp4  concerned*.mp4
  3. 运行：  pnpm avatar:video
     （或显式：pnpm avatar:video idle=~/Downloads/a.mp4 talk=~/Downloads/b.mp4）

片段（idle 与 talk 必需，其余可选）：
  idle       待机：眨眼+轻呼吸+微动
  talk       说话：嘴自然开合（小行说话时切到这段）
  happy      开心（改动成功/开新行程）
  thinking   思考（调用工具/生成中）
  concerned  关切（出错时）

开关：--seconds 6  --width 720  --seamless  --seamless-all  --fps 30
      --in <dir>  --dir <dir>  --keep-audio  --dry`;

// ── 认领：把收件箱里的文件按关键词映射到片段 ──
function claimFromInbox(inDir) {
  const map = {};
  if (!existsSync(inDir)) return map;
  const files = readdirSync(inDir)
    .filter((f) => VIDEO_EXTS.has(extname(f).toLowerCase()))
    .map((f) => join(inDir, f));
  for (const file of files) {
    const name = basename(file).toLowerCase();
    const hit = CLIPS.find((c) => name.includes(c));
    if (!hit) {
      console.warn(`· 跳过「${basename(file)}」：文件名里没有片段关键词（${CLIPS.join("/")}）`);
      continue;
    }
    // 同一片段命中多个文件时，取最新修改的那个（通常是你最后导出的定稿）
    if (!map[hit] || statSync(file).mtimeMs > statSync(map[hit]).mtimeMs) {
      map[hit] = file;
    }
  }
  return map;
}

/** ffprobe 取 { 时长秒, 源帧率fps }，失败返回 0 */
function probeStream(input) {
  return new Promise((res) => {
    const p = spawn(
      "ffprobe",
      [
        "-v", "error", "-select_streams", "v:0",
        "-show_entries", "stream=r_frame_rate:format=duration",
        "-of", "default=nk=1:nw=1", input,
      ],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    let out = "";
    p.stdout.on("data", (d) => (out += d.toString()));
    p.on("error", () => res({ dur: 0, fps: 0 }));
    p.on("close", () => {
      let fps = 0, dur = 0;
      for (const ln of out.trim().split("\n").map((s) => s.trim()).filter(Boolean)) {
        if (ln.includes("/")) {
          const [a, b] = ln.split("/").map(Number);
          fps = b ? a / b : 0;
        } else if (!dur) dur = Number(ln) || 0;
      }
      res({ dur, fps });
    });
  });
}

// ── 组 ffmpeg 参数 ──（dur=源时长秒[loopfade用]，fps=有效帧率[已 min(源,目标) 防上采样抖动]）
function buildFfmpegArgs(input, output, clip, opts, dur, fps) {
  const scale = `scale='min(iw,${opts.width})':-2:flags=lanczos`;
  const boomerang =
    opts.seamless && (opts.seamlessAll || clip !== "talk");

  const args = ["-y", "-hide_banner", "-loglevel", "error", "-i", input];

  if (opts.loopfade > 0 && dur > 0) {
    // 交叉淡化无缝循环（保持正向运动，把「片尾」淡回「片头」，接缝不可见）：
    //   输出 = 中段[CF..D-CF] 顺接 xfade(片尾[D-CF..D] → 片头[0..CF])
    //   首帧=尾帧=第 CF 秒那一帧 → 无缝；适合首尾接近一致的片段。
    const D = Math.min(dur, opts.seconds);
    const CF = Math.max(0.1, Math.min(opts.loopfade, D / 3));
    const f = (n) => n.toFixed(3);
    const fc =
      `[0:v]fps=${fps},${scale},format=yuv420p,split=3[a][b][c];` +
      `[a]trim=0:${f(CF)},setpts=PTS-STARTPTS[begin];` +
      `[b]trim=${f(CF)}:${f(D - CF)},setpts=PTS-STARTPTS[mid];` +
      `[c]trim=${f(D - CF)}:${f(D)},setpts=PTS-STARTPTS[end];` +
      `[end][begin]xfade=transition=fade:duration=${f(CF)}:offset=0[tail];` +
      `[mid][tail]concat=n=2:v=1:a=0[v]`;
    args.push("-filter_complex", fc, "-map", "[v]");
  } else if (boomerang) {
    // 干净 ping-pong 无缝循环：正放 + 「去掉两端重复帧」的倒放。
    // 倒放段用 reverse→丢首帧→reverse→丢首帧→reverse 去掉它的首帧(=正放尾帧)和尾帧(=正放首帧)，
    // 这样折返点与循环点都不会多一帧「定格」——避免顿挫；无需知道帧数。
    const fc =
      `[0:v]trim=0:${opts.seconds},setpts=PTS-STARTPTS,fps=${fps},${scale},format=yuv420p,split[a][b];` +
      `[b]reverse,select='gt(n,0)',reverse,select='gt(n,0)',reverse,setpts=PTS-STARTPTS[r];` +
      `[a][r]concat=n=2:v=1:a=0[v]`;
    args.push("-filter_complex", fc, "-map", "[v]");
  } else {
    // 只按需降帧（fps 已是 min(源,目标)，24fps 源不会被上采样成 30 而产生抖动）+ 缩放
    args.push("-t", String(opts.seconds), "-vf", `fps=${fps},${scale}`);
  }

  if (!opts.keepAudio) args.push("-an");
  args.push(
    "-c:v", "libx264",
    "-preset", "medium",
    "-crf", "23",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    output,
  );
  return args;
}

function runFfmpeg(args) {
  return new Promise((res, rej) => {
    const p = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => (err += d.toString()));
    p.on("error", (e) => rej(e));
    p.on("close", (code) =>
      code === 0 ? res() : rej(new Error(err.trim() || `ffmpeg exit ${code}`)),
    );
  });
}

function ffmpegAvailable() {
  return new Promise((res) => {
    const p = spawn("ffmpeg", ["-version"], { stdio: "ignore" });
    p.on("error", () => res(false));
    p.on("close", (code) => res(code === 0));
  });
}

function human(bytes) {
  return bytes > 1e6 ? `${(bytes / 1e6).toFixed(1)}MB` : `${Math.round(bytes / 1e3)}KB`;
}

// ── 主流程 ──
async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(HELP);
    return;
  }
  if (!Number.isFinite(opts.seconds) || opts.seconds <= 0) fail("--seconds 必须是正数");
  if (!Number.isFinite(opts.width) || opts.width < 64) fail("--width 太小");

  const outDir = resolve(opts.dir);
  const inDir = resolve(opts.in || join(opts.dir, "_raw"));

  if (!(await ffmpegAvailable()))
    fail("找不到 ffmpeg。请先安装（macOS: brew install ffmpeg；Ubuntu: apt install ffmpeg）。");

  if (!existsSync(outDir)) fail(`输出目录不存在：${outDir}`);

  // 收集任务：显式参数优先，其余从收件箱认领
  const jobs = { ...claimFromInbox(inDir), ...opts.explicit };

  if (Object.keys(jobs).length === 0) {
    if (!existsSync(inDir)) mkdirSync(inDir, { recursive: true });
    console.log(
      `没有找到可处理的视频。\n\n把下载的图生视频放进：\n  ${inDir}\n\n` +
        `文件名带上片段关键词（idle / talk / happy / thinking / concerned），例如 idle.mp4、小行-talk.mp4，\n` +
        `然后重跑：pnpm avatar:video\n\n（提示词见 public/avatar/xiaoxing/video-prompts.md，用 --help 看全部用法）`,
    );
    return;
  }

  console.log(`ffmpeg ✓  输出 → ${outDir}\n`);
  const missing = CLIPS.filter((c) => !jobs[c]);
  const order = CLIPS.filter((c) => jobs[c]); // 固定顺序，idle/talk 在前

  let ok = 0;
  for (const clip of order) {
    const input = resolve(jobs[clip]);
    if (!existsSync(input)) {
      console.error(`✗ ${clip}：找不到输入文件 ${input}`);
      continue;
    }
    const finalOut = join(outDir, `${clip}-loop.mp4`);
    const tmpOut = join(outDir, `.${clip}-loop.tmp.mp4`);
    // 探测源帧率：有效 fps = min(目标, 源) —— 绝不把 24fps 源上采样成 30（会每 4 帧插一重复帧→抖动）
    const { dur, fps: srcFps } = await probeStream(input);
    const fps = srcFps > 0 ? Math.min(opts.fps, Math.round(srcFps)) : opts.fps;
    const args = buildFfmpegArgs(input, tmpOut, clip, opts, dur, fps);

    if (opts.dry) {
      console.log(`[dry] ${clip}  ←  ${basename(input)}`);
      console.log(`      ffmpeg ${args.join(" ")}\n`);
      continue;
    }

    process.stdout.write(`▶ ${clip.padEnd(9)} ← ${basename(input)} … `);
    try {
      await runFfmpeg(args);
      renameSync(tmpOut, finalOut); // 原子替换
      console.log(`✓ ${human(statSync(finalOut).size)} → ${clip}-loop.mp4`);
      ok++;
    } catch (e) {
      try {
        rmSync(tmpOut, { force: true });
      } catch {
        /* ignore */
      }
      console.log("✗");
      console.error(`  ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (opts.dry) return;

  console.log(`\n完成 ${ok}/${order.length} 段。`);
  if (missing.length)
    console.log(
      `未处理：${missing.join(" / ")}（缺就好，前端会自动回退 idle/talk 或对应静态立绘）。`,
    );
  if (ok > 0)
    console.log(
      "刷新页面即可看到：待机播 idle、说话切 talk、情绪切对应片段，全部交叉淡入。\n" +
        "静态 .jpg 立绘会作为加载前的 poster 和缺片段时的兜底，保留即可。",
    );
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
