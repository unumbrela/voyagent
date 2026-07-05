"use client";

/**
 * 数字人（图片版）——用你自己生成的写实立绘作为形象「小行」。
 *
 * 与手绘 SVG 版共用同一命令式接口（speak/stop/setEmotion），CopilotDock 无需改动，
 * 通过 avatar-config.ts 的 AVATAR_MODE 二选一。
 *
 * - 表情：按 emotion 在多张立绘间「交叉淡入」切换（idle/thinking/happy/concerned）。
 * - 口型：说话时——
 *     · 有张嘴帧（<emotion>-talk）→ 把张嘴帧叠在闭嘴帧上，用 TTS 音频的实时响度
 *       驱动其不透明度，做出「音量越大嘴张越开」的口型；静音/Web Speech 回退时用程序化摆嘴；
 *     · 没有张嘴帧 → 说话时整体做轻微律动（上浮 + 呼吸缩放），不动嘴。
 * - 发声：优先云 TTS（/api/tts），失败/未配置回退浏览器 Web Speech；muted 时只动不发声。
 *
 * 图片规范见 public/avatar/<dir>/README.md。缺图时该情绪层显示带提示的占位背景，不至于裂图。
 */

import { useEffect, useRef, useState } from "react";
import type { DigitalHumanHandle, Emotion } from "./DigitalHuman";
import {
  EMOTIONS,
  PERSONA,
  bubbleSrc,
  frameSrc,
  talkSrc,
} from "./avatar-config";

/** 帧间共享的可变状态（命令式接口写、渲染循环读） */
interface Shared {
  emotion: Emotion;
  speaking: boolean;
  mode: "audio" | "procedural" | null;
  audio: HTMLAudioElement | null;
  analyser: AnalyserNode | null;
  data: Uint8Array<ArrayBuffer> | null;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export default function DigitalHumanImage({
  apiRef,
  muted = false,
  variant = "full",
  onSpeakingChange,
  onError,
}: {
  apiRef: React.MutableRefObject<DigitalHumanHandle | null>;
  muted?: boolean;
  variant?: "full" | "bubble";
  onSpeakingChange?: (speaking: boolean) => void;
  onError?: (msg: string) => void;
}) {
  const shared = useRef<Shared>({
    emotion: "idle",
    speaking: false,
    mode: null,
    audio: null,
    analyser: null,
    data: null,
  });
  const mutedRef = useRef(muted);
  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  const [reducedMotion] = useState(
    () =>
      typeof window !== "undefined" &&
      !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
  );

  // 当前情绪（驱动交叉淡入的图层不透明度）
  const [emotion, setEmotionState] = useState<Emotion>("idle");
  // 加载失败的图片 → 该图层退化为占位背景
  const [broken, setBroken] = useState<Record<string, boolean>>({});
  const markBroken = (src: string) =>
    setBroken((b) => (b[src] ? b : { ...b, [src]: true }));

  // 律动/口型直接写 DOM，避免每帧 React 重渲染
  const stageRef = useRef<HTMLDivElement | null>(null);
  const talkRefs = useRef<Partial<Record<Emotion, HTMLImageElement | null>>>({});

  // Web Audio 图（懒建，说话时用于取响度）
  const ctxRef = useRef<AudioContext | null>(null);
  const srcNodeRef = useRef<MediaElementAudioSourceNode | null>(null);

  // 复用同一个 <audio>：避免对同一元素重复 createMediaElementSource 报错
  useEffect(() => {
    const audio = new Audio();
    audio.crossOrigin = "anonymous";
    shared.current.audio = audio;
    return () => {
      audio.pause();
      audio.src = "";
      ctxRef.current?.close().catch(() => {});
    };
  }, []);

  // 首次说话时按需建立音频分析图（AudioContext 需用户手势后才能启动）
  function ensureAnalyser() {
    const s = shared.current;
    if (!s.audio || s.analyser) return;
    const AC: typeof AudioContext =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    if (!AC) return;
    try {
      const ctx = new AC();
      const node = ctx.createMediaElementSource(s.audio);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      node.connect(analyser);
      analyser.connect(ctx.destination);
      ctxRef.current = ctx;
      srcNodeRef.current = node;
      s.analyser = analyser;
      s.data = new Uint8Array(analyser.fftSize);
    } catch {
      // 建图失败：口型退化为程序化摆嘴，声音仍能听
      s.analyser = null;
    }
  }

  // 渲染循环：驱动张嘴帧不透明度（口型）+ 说话律动
  useEffect(() => {
    let raf = 0;
    const t0 = performance.now();
    let mouth = 0; // 当前张嘴程度 0..1（平滑）
    let prevEmotion: Emotion = shared.current.emotion;
    let reactStart = -10; // 情绪切换时的「反应」起点（做一次小弹跳）

    const tick = (now: number) => {
      const t = (now - t0) / 1000;
      const s = shared.current;

      // 目标张嘴程度
      let target = 0;
      if (s.speaking) {
        if (
          s.mode === "audio" &&
          s.analyser &&
          s.data &&
          s.audio &&
          !s.audio.paused
        ) {
          // 时域 RMS 作为响度
          s.analyser.getByteTimeDomainData(s.data);
          let sum = 0;
          for (let i = 0; i < s.data.length; i++) {
            const v = (s.data[i] - 128) / 128;
            sum += v * v;
          }
          const rms = Math.sqrt(sum / s.data.length);
          target = Math.min(1, rms * 4.2); // 经验增益
        } else {
          // 程序化摆嘴（静音 / Web Speech 回退 / 无分析器）
          target = 0.16 + 0.5 * Math.abs(Math.sin(t * 10.5));
        }
      }
      mouth = lerp(mouth, target, s.speaking ? 0.45 : 0.2);

      // 写张嘴帧不透明度：仅当前情绪层可见，其余置 0
      for (const e of EMOTIONS) {
        const img = talkRefs.current[e];
        if (img) img.style.opacity = e === s.emotion ? mouth.toFixed(3) : "0";
      }

      // ── 活人微动：让静态照片始终「有生命」（呼吸/摆动/说话点头/情绪反应）──
      // 静态真人脸最显僵硬，靠持续的细微运动破除恐怖谷。
      if (stageRef.current) {
        const amp = reducedMotion ? 0 : variant === "bubble" ? 0.45 : 1;
        // 底缩放：留出平移余量（竖图 object-cover 横向无溢出，纯平移会露底），reduced 时不缩放
        const baseScale = reducedMotion ? 1 : variant === "bubble" ? 1.03 : 1.045;

        // 呼吸（两个慢频叠加，避免机械感）
        const breathe = (Math.sin(t * 0.95) * 0.006 + Math.sin(t * 0.31 + 1) * 0.003) * amp;
        // 待机摆动（多频叠加更有机）
        const tx = (Math.sin(t * 0.53) + Math.sin(t * 0.31 + 1.2) * 0.6) * 1.0 * amp;
        let ty = (Math.sin(t * 0.8 + 0.6) * 1.1 + Math.sin(t * 0.45) * 0.6) * amp;
        let rot = Math.sin(t * 0.4) * 0.32 * amp;
        let scale = baseScale + breathe;

        // 说话：轻点头 + 更活跃摆动 + 张嘴瞬间头微沉（重音感）
        if (s.speaking) {
          ty += (Math.sin(t * 3.1) * 1.2 + mouth * 1.3) * amp;
          rot += Math.sin(t * 2.15) * 0.5 * amp;
          scale += mouth * 0.004 * amp;
        }

        // 情绪切换的一次性「反应」：轻弹跳 + 视情绪歪头
        if (s.emotion !== prevEmotion) {
          prevEmotion = s.emotion;
          reactStart = t;
        }
        const rp = Math.max(0, 1 - (t - reactStart) * 2.2); // ~0.45s 衰减
        if (rp > 0) {
          const e = rp * rp;
          scale += 0.018 * e * amp;
          ty += -2 * e * amp;
          rot +=
            (s.emotion === "thinking" ? -3 : s.emotion === "happy" ? 2.2 : 0) * e * amp;
        }

        stageRef.current.style.transform = `translate(${tx.toFixed(2)}px, ${ty.toFixed(2)}px) scale(${scale.toFixed(4)}) rotate(${rot.toFixed(2)}deg)`;
      }

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [reducedMotion, variant]);

  function stopSpeaking() {
    const s = shared.current;
    try {
      s.audio?.pause();
    } catch {
      /* ignore */
    }
    if (typeof window !== "undefined") window.speechSynthesis?.cancel();
    s.speaking = false;
    s.mode = null;
    onSpeakingChange?.(false);
  }

  function webSpeech(text: string) {
    const s = shared.current;
    if (typeof window === "undefined" || !window.speechSynthesis) {
      s.mode = "procedural";
      s.speaking = true;
      onSpeakingChange?.(true);
      const ms = Math.min(12000, 800 + text.length * 90);
      setTimeout(() => {
        s.speaking = false;
        onSpeakingChange?.(false);
      }, ms);
      return;
    }
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "zh-CN";
    s.mode = "procedural";
    s.speaking = true;
    onSpeakingChange?.(true);
    u.onend = () => {
      s.speaking = false;
      onSpeakingChange?.(false);
    };
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  }

  function setEmotion(e: Emotion) {
    shared.current.emotion = e;
    setEmotionState(e);
  }

  async function speak(text: string) {
    const content = text.trim();
    if (!content) return;
    stopSpeaking();
    const s = shared.current;

    // 静音：只做程序化摆嘴/律动，不发声
    if (mutedRef.current) {
      s.mode = "procedural";
      s.speaking = true;
      onSpeakingChange?.(true);
      const ms = Math.min(12000, 800 + content.length * 90);
      setTimeout(() => {
        s.speaking = false;
        onSpeakingChange?.(false);
      }, ms);
      return;
    }

    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: content }),
      });
      if (!res.ok) {
        webSpeech(content);
        return;
      }
      const buf = await res.arrayBuffer();
      const url = URL.createObjectURL(new Blob([buf], { type: "audio/mpeg" }));
      const audio = s.audio!;
      ensureAnalyser();
      await ctxRef.current?.resume().catch(() => {});
      audio.src = url;
      s.mode = "audio";
      s.speaking = true;
      onSpeakingChange?.(true);
      audio.onended = () => {
        s.speaking = false;
        onSpeakingChange?.(false);
        URL.revokeObjectURL(url);
      };
      await audio.play().catch(() => {
        s.speaking = false;
        webSpeech(content);
      });
    } catch (e) {
      onError?.(e instanceof Error ? e.message : String(e));
      webSpeech(content);
    }
  }

  // 挂载后把句柄写给父组件（每次渲染刷新以持有最新闭包）
  useEffect(() => {
    apiRef.current = { speak, stop: stopSpeaking, setEmotion };
    return () => {
      apiRef.current = null;
    };
  });

  const objectPosition =
    variant === "bubble"
      ? PERSONA.bubbleFrames
        ? "50% 50%"
        : PERSONA.bubbleFocus
      : PERSONA.fullFocus;

  return (
    <div
      className="relative h-full w-full overflow-hidden bg-[linear-gradient(160deg,#1b2456,#0b1124)]"
      role="img"
      aria-label={`数字人${PERSONA.name}`}
    >
      <div ref={stageRef} className="absolute inset-0 will-change-transform">
        {EMOTIONS.map((e) => {
          const base =
            variant === "bubble" && PERSONA.bubbleFrames ? bubbleSrc(e) : frameSrc(e);
          const isActive = e === emotion;
          return (
            <div
              key={e}
              className="absolute inset-0 transition-opacity duration-[400ms] ease-out"
              style={{ opacity: isActive ? 1 : 0 }}
              aria-hidden={!isActive}
            >
              {broken[base] ? (
                <Placeholder emotion={e} src={base} />
              ) : (
                // 数字人立绘需即时叠层/交叉淡入 + rAF 驱动不透明度，next/image 的懒加载与包裹层不合用，故用原生 img
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={base}
                  alt=""
                  draggable={false}
                  className="absolute inset-0 h-full w-full select-none object-cover"
                  style={{ objectPosition }}
                  onError={() => markBroken(base)}
                />
              )}
              {PERSONA.talkFrames && !broken[base] && !broken[talkSrc(e)] && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  ref={(el) => {
                    talkRefs.current[e] = el;
                  }}
                  src={talkSrc(e)}
                  alt=""
                  draggable={false}
                  className="absolute inset-0 h-full w-full select-none object-cover"
                  style={{ objectPosition, opacity: 0 }}
                  onError={() => markBroken(talkSrc(e))}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** 缺图时的占位：夜空底 + 情绪名 + 放图提示 */
function Placeholder({ emotion, src }: { emotion: Emotion; src: string }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-[linear-gradient(160deg,#1b2456,#0b1124)] p-3 text-center">
      <span className="text-sm font-medium text-[#7ee8dd]">{emotion}</span>
      <span className="text-[10px] leading-tight text-white/45">缺图：{src}</span>
    </div>
  );
}
