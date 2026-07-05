# 数字人「小行」循环视频 · 图生视频提示词 + 一键处理

视频版是最像真人的形态：模型生成的**真实眨眼 / 呼吸 / 说话口型**，一眼就像在跟真人对话。
你用**图生视频（I2V）**模型，以本目录已有的静态立绘为**首帧**，生成几段几秒的小视频，
放进收件箱、跑一条命令，就自动处理成前端要用的循环片段。

> 已启用视频模式（`.env.local` 里 `NEXT_PUBLIC_AVATAR_MODE=video`，也是默认）。
> 当前目录里的 `*-loop.mp4` 是用静态图 ffmpeg 生成的**占位循环**（只会缩放呼吸、**不会眨眼**）——
> 这就是现在看起来「假」的原因。**换成模型视频后直接覆盖同名文件即可。**

> ⚠️ **别用 ZenMux/Seedance API 自动生成**：Seedance 与 Google Veo 会以
> 「input image may contain real person」**拒绝让写实人像动起来**（防深伪硬拦截，实测无法绕过）。
> **请用可灵(Kling)/即梦(Dreamina) 网页版**——它们允许上传人像，是保留写实小行、
> 拿到真眨眼/真说话的可行路。（`scripts/avatar-gen.mjs` 保留备用，换到允许真人首帧的模型时 `--model` 指定。）

---

## 三步走

**① 生成（用可灵/即梦网页版）**：打开[可灵 kling.kuaishou.com] 或 [即梦 jimeng.jianying.com]，
选「图生视频 / 首尾帧」，**上传本目录对应立绘作首帧**（idle→`idle.jpg`，happy→`happy.jpg`…，talk 也用 `idle.jpg`），
贴下面对应的提示词，导出 3~6 秒的小视频。（Runway / 海螺 / Vidu / Sora 亦可，只要允许人像首帧。）

**② 收件**：把下载的视频丢进 `public/avatar/xiaoxing/_raw/`，文件名带上片段关键词即可（不必精确改名）：

```
idle.mp4   talk.mp4   happy.mp4   thinking.mp4   concerned.mp4
（小行-talk-final.mp4、happy_v2.mov 之类也能自动认领）
```

**③ 一键处理**：

```bash
pnpm avatar:video
```

它会自动：认领片段 → **去音轨** → 截时长 → 缩放 → 转 H.264/yuv420p/faststart（网页秒开、全平台兼容）→
**原子覆盖** `<clip>-loop.mp4`。刷新页面即可：待机播 idle、说话切 talk、情绪切对应片段，全部交叉淡入。

> 循环处**有跳变**？加 `--seamless` 做「回旋」无缝（正放+倒放拼接）：`pnpm avatar:video --seamless`
> （talk 默认不回旋，因为倒放说话会怪；要连 talk 也无缝用 `--seamless-all`）。
> 其它开关：`--seconds 6`、`--width 720`、`--dry`（只看命令不处理）、`pnpm avatar:video --help`。

---

## 需要哪些视频

| 文件名 | 首帧 | 内容 | 播放时机 | 必需 |
| --- | --- | --- | --- | --- |
| `idle-loop.mp4` | `idle.jpg` | 待机：自然**眨眼 + 轻呼吸 + 细微头动**，安静微笑看镜头 | 平时 | ✅ |
| `talk-loop.mp4` | `idle.jpg` | **说话动作**：嘴自然开合像在讲话，配合点头、眉眼 | 小行说话时 | ✅ |
| `happy-loop.mp4` | `happy.jpg` | 开心：眉眼上扬、灿笑，仍有眨眼呼吸 | 改动成功/开新行程 | 可选 |
| `thinking-loop.mp4` | `thinking.jpg` | 思考：眼神上瞟、轻歪头、若有所思 | 调用工具/生成中 | 可选 |
| `concerned-loop.mp4` | `concerned.jpg` | 关切：微蹙眉、歉意，柔和 | 出错时 | 可选 |

只做 `idle` + `talk` 也能跑（情绪会回退到 idle/talk；某段缺失则回退同名静态立绘，不会黑屏）。做全 5 段体验最好。

---

## 关键要求

- **首帧 = 本目录对应静态立绘**：这样几段视频是**同一个人、同机位、同背景**，切换不会「换脸」。
- **无缝循环**：动作幅度别太大、结尾回到接近起始姿态；模型有 loop 选项就开。实在不无缝，交给 `--seamless`。
- **时长**：3~6 秒即可（脚本默认截到 6 秒，可 `--seconds` 调）。
- **恒静音**：视频不需要声音（小行的嗓音来自独立 TTS）。所以 `talk-loop` 只要**嘴在动**、
  **不用对上具体字**——通用说话动作即可；脚本会自动去掉音轨。
- **格式**：导出 MP4（H.264）竖构图即可，分辨率 720×1080 上下（展示位会自动 `object-cover` 裁切）。
  用 WebM 也行，但要把 `app/copilot/avatar-config.ts` 的 `videoExt` 改成 `"webm"`。

---

## 可直接用的提示词（图生视频 · 以立绘为首帧）

**idle-loop（待机，最重要）**
```
以这张肖像为首帧，让她自然地轻微活动：平静微笑看着镜头，缓慢眨眼 2~3 次，
轻柔呼吸使肩部有细微起伏，头部极其轻微地自然摆动，几缕发丝随之轻动。
镜头固定不动，背景极光与人物保持一致，动作幅度很小、温柔自然，结尾回到起始姿态以便无缝循环。
写实真人、不要变形、不要转头大幅度动作。时长约5秒。
```

**talk-loop（说话）**
```
以这张肖像为首帧，让她像在亲切地讲话：嘴自然地开合说话，配合轻微点头、
眉毛和眼神的自然变化，偶尔眨眼，面带微笑，热情友好。镜头固定，背景一致，
动作自然不夸张，结尾回到接近起始姿态以便循环。写实真人、不要变形。时长约4秒。
```

**happy / thinking / concerned（可选，各自以对应立绘为首帧）**
```
happy：以这张开心表情的肖像为首帧，她愉快地笑，眉眼上扬、脸颊微抬，自然眨眼与呼吸，轻轻点头。镜头固定、写实、动作温柔、可无缝循环。约4秒。
thinking：以这张思考表情的肖像为首帧，她若有所思，眼神向上方游移、轻轻歪头、偶尔眨眼，安静自然。镜头固定、写实、可循环。约4秒。
concerned：以这张关切表情的肖像为首帧，她带着歉意与关心，眉头微蹙、眼神柔和、缓慢眨眼呼吸。镜头固定、写实、可循环。约4秒。
```

**英文版（Runway / Sora 等）**
```
idle: Animate this portrait subtly and realistically: she looks at the camera with a calm
gentle smile, blinks naturally 2-3 times, breathes softly with slight shoulder movement,
tiny natural head sway, a few hair strands moving. Locked-off camera, background consistent,
very small gentle motion, returns to the starting pose for a seamless loop. Photorealistic,
no distortion, no big head turns. ~5s.

talk: Animate this portrait as if she is warmly speaking: mouth opens and closes naturally
as if talking, with slight nods and natural eyebrow/eye movement, occasional blinks, friendly
smile. Locked-off camera, consistent background, natural not exaggerated, ends near the start
pose to loop. Photorealistic, no distortion. ~4s.
```

---

## 手动 ffmpeg（可选：不想用脚本时）

脚本已封装好这些，一般不用手敲。个别情况可参考：

```bash
# 转静音 MP4（H.264）
ffmpeg -i in.mp4 -an -c:v libx264 -crf 23 -pix_fmt yuv420p -movflags +faststart idle-loop.mp4
# 无缝「回旋」（正放+倒放）
ffmpeg -i in.mp4 -filter_complex "[0]reverse[r];[0][r]concat=n=2:v=1:a=0,format=yuv420p" -an -c:v libx264 -crf 23 idle-loop.mp4
```

静态立绘（`.jpg`）会作为视频加载前的 poster 和缺片段时的兜底，保留即可。
