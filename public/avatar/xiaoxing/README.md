# 数字人「小行」立绘规范

> **当前默认是「视频版」数字人（最像真人：真眨眼/呼吸/说话）。**
> 要做视频循环片段，看 [`video-prompts.md`](./video-prompts.md)。
> 本文档讲的是**静态立绘**（用于 image 模式、以及视频的 poster/兜底）。

把你生成的立绘按下面的**文件名**放进本目录，然后启用图片形象：

```bash
# .env.local
NEXT_PUBLIC_AVATAR_MODE=image
```

（或直接把 `app/copilot/avatar-config.ts` 里 `AVATAR_MODE` 的默认值改成 `"image"`。）

配置项都在 `app/copilot/avatar-config.ts` 的 `PERSONA` 里：目录、扩展名、是否有张嘴帧等。

---

## 需要哪些图片

### 必需：4 张表情主帧（闭嘴）

| 文件名 | 表情 | 触发时机 |
| --- | --- | --- |
| `idle.png` | 平静微笑 | 待机 |
| `thinking.png` | 认真思考（略偏头/挑眉） | 正在调用工具、生成中 |
| `happy.png` | 开心（弯眼笑） | 改动成功应用、打开新行程 |
| `concerned.png` | 关切/歉意（微蹙眉） | 出错时 |

只有这 4 张也能跑：表情会**交叉淡入**切换，说话时整体做轻微律动（不动嘴）。

### 可选：4 张张嘴帧（做口型，强烈建议）

| 文件名 | 说明 |
| --- | --- |
| `idle-talk.png` | 与 `idle.png` **完全同一张脸/姿势/光照，只把嘴改成张开** |
| `thinking-talk.png` | 同上，对应 thinking |
| `happy-talk.png` | 同上，对应 happy |
| `concerned-talk.png` | 同上，对应 concerned |

有张嘴帧后，说话时会用 **TTS 音频的实时响度**在「闭嘴帧 ⇄ 张嘴帧」间叠化 —— 音量越大嘴张得越开，做出跟着声音动的口型。
> 关键：talk 帧必须和对应主帧**只有嘴不同**（用 img2img / inpainting 只重绘嘴部区域，别整张重画，否则会「换脸」抖动）。
> 若某个表情没有 talk 帧，会自动退化为该表情说话时的轻微律动。

如果你不打算做张嘴帧，把 `avatar-config.ts` 里 `talkFrames` 改成 `false`。

### 可选：紧凑头像帧（右下角 64px 圆头像）

默认右下角圆头像**复用主帧**并把取景上移到脸部（`bubbleFocus`）。
若想要更贴脸的专用裁剪，提供 `idle-bubble.png` 等，并把 `bubbleFrames` 改成 `true`。

---

## 图片要求

- **尺寸**：竖构图，建议 `768×960`（4:5）或更高；两个展示位都用 `object-cover`，会自动裁切填充。
- **格式**：`.png`（想更小可用 `.webp`，同时改 `avatar-config.ts` 的 `ext`）。
- **背景**：
  - 面板舞台（176px 高的宽横幅）会把图裁成横向铺满，所以**上半身居中、留出左右余量**最稳。
  - 背景可用与全站一致的「暮色极光」深蓝夜空；透明背景也行（组件底层已铺同色渐变）。
- **一致性（最重要）**：4 个表情必须是**同一个人**——同发型、同服装、同机位、同光照，只有表情不同。
  做法：先定一张主图，其余表情用 img2img / 换脸锁定 / 同 seed + 只改表情提示词 生成。

---

## 可直接用的生成提示词（写实 AI 真人风）

> **用 GPT Image（image-2）生成真人 · 活泼可爱版**：完整分步提示词见同目录
> [`gpt-image-prompts.md`](./gpt-image-prompts.md)（推荐）。下面是通用简版。

先生成 `idle` 主图，锁定人物后再派生其余表情与张嘴帧。

**基础人设（每张都带上）**
```
A friendly young Chinese female travel guide, mid-20s, warm approachable face,
soft natural makeup, shoulder-length dark hair with light bangs, wearing a teal
scarf and a deep-navy travel jacket. Upper-body portrait, facing camera,
centered, soft cinematic rim light, dusk-aurora deep-blue night sky background
with subtle teal/purple glow. Photorealistic, 85mm portrait lens, shallow depth
of field, high detail, 4:5 vertical.
```

**各表情追加**
- idle：`calm gentle closed-mouth smile, relaxed eyes, looking at the viewer`
- thinking：`thoughtful expression, one eyebrow slightly raised, head tilted a little, eyes glancing up`
- happy：`bright cheerful smile with curved happy eyes, cheeks slightly raised`
- concerned：`softly concerned and apologetic, slightly furrowed brows, gentle empathetic look`

**张嘴帧（用对应主帧做 inpaint，只改嘴）**
```
same person, same pose, same lighting, mouth open as if speaking a syllable,
teeth slightly visible — inpaint the mouth region only
```

生成后按上表命名放进本目录即可。当前目录内的 `*.png` 是可替换的占位图（纯色 + 标签），用来先验证流程。
