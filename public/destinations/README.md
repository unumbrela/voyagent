# 精选目的地图墙 · 图片规范

首页「灵感灯箱」区（`app/page.tsx` 的 `DESTINATIONS` / `DestinationCard`）读取本目录下的照片。
文件名必须与 `slug` 一致，缺图时卡片自动降级为青瓷→琥珀渐变占位（不裂图）。

| 文件名           | 目的地   | slug        |
| ---------------- | -------- | ----------- |
| `suzhou.jpg`     | 苏州     | `suzhou`    |
| `kyoto.jpg`      | 京都     | `kyoto`     |
| `yading.jpg`     | 稻城亚丁 | `yading`    |
| `iceland.jpg`    | 冰岛     | `iceland`   |
| `santorini.jpg`  | 圣托里尼 | `santorini` |
| `morocco.jpg`    | 摩洛哥   | `morocco`   |

- **尺寸/比例**：竖幅 **1024×1536**（GPT Image portrait）。卡片以 `object-cover` 裁成 4:5，画面主体请居中偏上，**底部三分之一留给渐深遮罩 + 地名**。
- **格式**：导出 `.jpg`，建议压到 200–400 KB（参考 `public/bg/*.jpg`）。
- **风格统一**：全部走同一套「编辑风电影感、暖调略去饱和」的美术方向，见下方提示词。

## 生成提示词（GPT Image 2）

先粘贴这段【统一美术方向】，再接每张的【主体】：

**统一美术方向（每张都加）：**

> Refined editorial travel photography, cinematic natural light, filmic slightly-muted color grade (not oversaturated stock). Warm, serene, aspirational mood with a strong sense of place and journey. Soft golden-hour or blue-hour light, gentle atmosphere and depth. Clean iconic composition; keep the lower third calmer and slightly darker so a caption can overlay. Vertical 4:5 portrait, 35mm look, subtle film grain. No text, no watermark, no logos, no large faces in the foreground.

**主体：**

- **suzhou** — A classical Suzhou water-town garden at dusk: whitewashed Jiangnan houses with dark tiled roofs mirrored in a still canal, an arched stone bridge, a glowing red lantern, weeping willows, a wooden rowboat drifting. Misty, tranquil, ink-wash atmosphere in celadon-green and warm amber tones.
- **kyoto** — A serene Kyoto scene at golden hour: an endless corridor of vermilion torii gates with soft sunbeams filtering through, a wooden temple pavilion glimpsed among fiery red maple leaves. Peaceful, timeless, warm autumn light, faint mist.
- **yading** — The sacred alpine wilderness of Daocheng Yading: a turquoise glacial lake beneath towering snow-capped peaks, golden autumn larch forest, colorful Tibetan prayer flags in the foreground, crisp high-altitude light, deep blue sky. Pristine, majestic, otherworldly.
- **iceland** — Iceland at night: green-and-violet aurora borealis dancing over a vast dark volcanic landscape, a lone waterfall and snowy peak, a star-filled sky mirrored in a glassy lake. Cold, ethereal, dramatic — teal and violet auroral glow.
- **santorini** — Santorini at sunset: whitewashed cubic houses and blue-domed churches cascading down a caldera cliff above the deep-blue Aegean Sea, a warm pink-and-amber sky, a few bougainvillea blossoms. Dreamy, luminous, Mediterranean.
- **morocco** — The Sahara desert at dusk: rolling amber sand dunes with long rippled shadows, a distant camel-caravan silhouette, a warm sky fading from amber to deep indigo. Vast, serene, cinematic warm tones.
