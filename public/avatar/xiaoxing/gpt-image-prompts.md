# 数字人「小行」立绘 · GPT Image 生成提示词（真人 · 活泼可爱）

面向 **GPT Image（image-2）**。目标：一个**真人写实**、**活泼可爱**的年轻旅行向导「小行」，
用于产品右下角数字人。你需要出 **8 张图**：4 张表情主帧（闭嘴）+ 4 张对应张嘴帧（做口型）。

> 全流程约 15 分钟。提示词块直接**整段复制粘贴**即可；中文是给你看的说明，英文块是喂给模型的。

---

## 0. 一致性铁律（最重要，决定成败）

这 8 张必须像**同一个人在同一秒、同一机位下只换了表情**，否则切换/口型会「换脸」抖动：

- **同一个人**：脸型、发型、发色、五官、肤色、痣/雀斑，全程不变。
- **同一机位与构图**：正面直视镜头、头的大小与位置不变、同焦段（85mm 感）。
- **同一光线与背景**：同一束光、同一片极光夜空背景。
- **同一服装**：teal 针织围巾 + 深藏蓝旅行夹克 + 小金色指南针别针，不变。
- **只改**：表情（4 张主帧）/ 嘴巴开合（4 张 talk 帧）。
- **双手不入镜**（避免手挡脸、破坏 talk 帧对齐）。

做法：**先生成 idle 基准图**锁定人物 → 其余表情都基于上一张、命令"同一个人只改表情" →
talk 帧再基于对应表情图、命令"整张不变只把嘴张开"。GPT Image 会引用上一张图来保持一致。

---

## 1. 尺寸与导出

- **比例/尺寸**：竖版 **2:3，1024 × 1536**（头肩像，脸在画面上中部、顶部留一点空）。
- **格式**：导出 **PNG**（想更小可用 WebP，同时改 `avatar-config.ts` 的 `ext`）。
- 展示位会自动 `object-cover` 裁切填充，你只要保证**头肩居中、脸在上中部**即可。

### 文件名映射（出图后按此命名，覆盖目录里的占位图）

| 文件名 | 内容 | 触发时机 |
| --- | --- | --- |
| `idle.png` | 平静微笑（闭嘴） | 待机 |
| `idle-talk.png` | 同上，**只把嘴张开** | 待机时说话 |
| `thinking.png` | 好奇思考（闭嘴） | 正在调用工具/生成中 |
| `thinking-talk.png` | 同上，张嘴 | 思考时说话 |
| `happy.png` | 开心灿笑（闭嘴/微开） | 改动成功、打开新行程 |
| `happy-talk.png` | 同上，张嘴 | 开心时说话 |
| `concerned.png` | 关切歉意（闭嘴） | 出错时 |
| `concerned-talk.png` | 同上，张嘴 | 关切时说话 |

---

## 2. 人物设定（MASTER，可自行改）

> 想换性别/长相/穿搭，只改这一段，后面所有步骤自动跟着变。

```
A real photograph of a cheerful, cute young Chinese woman travel guide named "Xiaoxing",
around 22-24 years old. Bright, expressive round eyes, natural glowing skin with a light
blush and a few faint freckles, a sweet and friendly heart-shaped face. Soft shoulder-length
dark-brown hair with light airy bangs, small silver ear studs. She wears a cozy teal knit
scarf over a deep-navy travel jacket, with a tiny golden compass pin on the collar.
Energetic, playful, warm and approachable personality.
```

**构图 / 光线 / 背景（每张都带上）：**
```
Upper-body head-and-shoulders portrait, facing the camera straight on, head centered
horizontally and placed in the upper-middle of the frame with a little headroom, symmetrical.
Both hands out of frame. Soft cinematic rim light. Background is a dreamy dusk aurora: a deep
navy-blue night sky with subtle teal and violet glow and a few faint stars, softly out of
focus (shallow depth of field, 85mm lens look).
Photorealistic DSLR photograph, natural true-to-life skin texture and color, high detail.
NOT an illustration, NOT anime, NOT 3D render, NOT CGI. Portrait 2:3, 1024x1536.
```

---

## 3. Step 1 —— 生成基准图 `idle`（先出这张，锁人物）

把 **MASTER + 构图块 + 下面这句表情**拼在一起发给 GPT Image：

```
Expression: a gentle warm closed-mouth smile, relaxed bright eyes looking straight at the
viewer, calm and friendly. Mouth closed.
```

> 满意后再继续。这张的人物长相会成为后面所有图的基准。**导出为 `idle.png`。**

---

## 4. Step 2 —— 派生其余 3 张表情主帧

每一张都在**同一个对话里**、基于上一张图发送。开头统一加这句「锁人物」指令：

```
Keep the exact same person, same face and identity, same hairstyle, same clothes, same
lighting, same aurora background, same camera framing and head position as the previous image.
Only change the facial expression. Photorealistic, not illustration.
```

然后接对应表情，各出一张：

**thinking（好奇思考）→ 导出 `thinking.png`**
```
Expression: a curious, playful thinking look — head tilted slightly to one side, one eyebrow
raised, eyes glancing upward as if pondering, a cute little pursed closed-mouth. Hands out of frame.
```

**happy（开心灿笑）→ 导出 `happy.png`**
```
Expression: a bright, beaming joyful smile, eyes curved into happy crescents, cheeks lifted,
radiant and playful. Keep the mouth closed or only barely parted (this is the closed-mouth base).
```

**concerned（关切歉意）→ 导出 `concerned.png`**
```
Expression: a soft, caring, slightly worried and apologetic look — inner brows gently raised,
a small sympathetic expression, gentle eyes. Mouth closed.
```

---

## 5. Step 3 —— 4 张张嘴帧（做口型，强烈建议）

口型效果靠"闭嘴帧 ⇄ 张嘴帧"用语音响度实时叠化。所以 talk 帧必须与对应主帧**只差嘴部**。
**分别基于上面 4 张主帧**各发一次（在对话里引用/上传对应那张图）：

```
Use this exact image. Keep the ENTIRE image identical — same person, same face, same hair,
same clothes, same lighting, same aurora background, same head position, size and camera.
ONLY change the mouth: open it as if speaking a syllable, lips parted with a hint of upper
teeth. Do not change anything else. Photorealistic.
```

依次得到并导出：`idle-talk.png`、`thinking-talk.png`、`happy-talk.png`、`concerned-talk.png`。

> `happy-talk` 可以张得更开一点（像在笑着说话）；其余自然张口即可。
> 若不想做 talk 帧：只出 4 张主帧，然后把 `avatar-config.ts` 里 `talkFrames` 改成 `false`
> （说话时会退化为轻微律动，不动嘴）。

---

## 6. （可选）右下角圆头像专用帧

默认圆头像**复用主帧**并自动上移取脸，一般够用。若想要更贴脸的裁剪，可再出 4 张更近的头部特写
`idle-bubble.png` / `thinking-bubble.png` / …（脸更大、只到肩），并把 `avatar-config.ts` 的
`bubbleFrames` 改成 `true`。不需要就跳过。

---

## 7. 避免项（Negative / 出问题时补充说明）

- 不要插画/动漫/卡通/3D/CGI/绘画质感 → 强调 `real DSLR photograph, natural skin texture`。
- 不要换脸/换发型/换衣服/换背景/换机位/换光线。
- 不要手指或手入镜、不要遮挡脸。
- 不要文字、水印、logo、边框。
- 不要浓妆或大浓度滤镜（GPT Image 爱加暖黄滤镜 → 补 `true-to-life neutral color, no heavy filter`）。

**如果它「换脸」了**：回一句
`That changed her identity. Keep the same person as the previous image, only change the expression.`
并把基准图再贴一次。

---

## 8. 出图后怎么用

1. 8 张图按第 1 节的文件名放进本目录 `public/avatar/xiaoxing/`，**覆盖同名占位图**。
2. 启用图片形象：`.env.local` 加一行
   ```
   NEXT_PUBLIC_AVATAR_MODE=image
   ```
   重启 dev（或把 `app/copilot/avatar-config.ts` 的 `AVATAR_MODE` 默认改成 `"image"`）。
3. 打开右下角小行 → 圆头像与面板舞台就是你的真人立绘；说话时会跟着声音动嘴。
4. 若脸的取景偏了（宽舞台里裁得不好），微调 `avatar-config.ts` 的 `fullFocus` / `bubbleFocus`
   两个 `object-position` 值即可（现为 `"50% 30%"` / `"50% 20%"`）。

---

### 一次性总提示词（懒人版：直接出 idle 基准图）

把下面整段发给 GPT Image，拿到满意的 idle 后，再按第 4/5 节派生其余：

```
A real DSLR photograph of a cheerful, cute young Chinese woman travel guide named "Xiaoxing",
around 22-24 years old, with bright expressive round eyes, natural glowing skin with light
blush and a few faint freckles, a sweet friendly face, soft shoulder-length dark-brown hair
with airy bangs, small silver ear studs. She wears a cozy teal knit scarf over a deep-navy
travel jacket with a tiny golden compass pin. Upper-body head-and-shoulders portrait, facing
the camera, head centered in the upper-middle of the frame with a little headroom, both hands
out of frame. She has a gentle warm closed-mouth smile, looking at the viewer, playful and
approachable. Soft cinematic rim light; dreamy dusk-aurora background of deep navy-blue night
sky with subtle teal and violet glow and faint stars, softly out of focus, shallow depth of
field. Natural true-to-life color, no heavy filter. Photorealistic, NOT illustration, NOT
anime, NOT 3D. Portrait 2:3, 1024x1536.
```
