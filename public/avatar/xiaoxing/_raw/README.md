# 收件箱：把可灵/即梦导出的原始视频丢这里

这是数字人循环视频的**收件箱**。流程：

1. 在**可灵(Kling)** 或 **即梦(Dreamina)** 网页版选「图生视频」，
   上传上一级目录的 `<clip>.jpg` 作**首帧**，贴 `../video-prompts.md` 里对应提示词，导出 mp4。
2. 把下载的视频放进**本文件夹**，文件名带片段关键词即可（不必精确改名）：
   `idle*.mp4  talk*.mp4  happy*.mp4  thinking*.mp4  concerned*.mp4`
3. 回项目根目录运行：`pnpm avatar:video`
   → 自动去音轨/截时长/缩放/转码，生成 `../<clip>-loop.mp4`，刷新页面即生效。

> 为什么不用 ZenMux/Seedance 自动生成：Seedance 与 Google Veo 会以
> 「input image may contain real person」**拒绝让写实人像动起来**（防深伪）。
> 可灵/即梦网页版允许上传人像，是保留写实小行、拿到真眨眼/真说话的可行路。
> （`scripts/avatar-gen.mjs` 保留备用：换到允许真人首帧的模型时 `--model` 指定即可。）

本文件夹只是中转，处理完可清空；`.mp4` 不必提交到 git。
