"use client";

/**
 * 数字人（视频版）——待机用循环真人小视频（真眨眼/呼吸/摆头），说话用「音量驱动口型」：
 *
 * 为什么这么混：预生成的 talk 视频是「通用说话动作」，跟运行时才生成的 TTS 语音对不上口型。
 * 所以说话时改成——交叉淡入到静帧「小行」（idle.jpg 闭嘴），再把「idle-talk.jpg 张嘴帧」叠在上面、
 * 用 TTS 音频的实时响度(RMS)驱动其不透明度：音量大→嘴张大，音量小/停顿→嘴闭上，
 * 于是嘴跟着真实语音开合、和语音「对得上」（非逐字，但对节奏）。说话时头相对静，但有呼吸微动不僵。
 * 待机时回到真视频（真眨眼/摆头）。
 *
 * 与 SVG / 图片版共用同一命令式接口（speak/stop/setEmotion），CopilotDock 无需改动。
 * 视频恒 muted+autoplay+loop；声音永远来自独立 <audio>；缺视频/减少动态时回退静帧，绝不黑屏。
 */

import { useEffect, useRef, useState } from "react";
import type { DigitalHumanHandle, Emotion } from "./DigitalHuman";
import {
  PERSONA,
  type VideoClip,
  frameSrc,
  loopSrc,
  pickClip,
  talkSrc,
} from "./avatar-config";

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// 说话时的静帧相对「待机视频」的缩放：图生视频比原立绘取景更近，
// 放大静帧让「视频↔静帧」交叉淡入时人脸尺寸/位置基本对齐，不至于一说话就「后退一下」。
const STILL_SCALE = 1.06;

export default function DigitalHumanVideo({
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
  const mutedRef = useRef(muted);
  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  const [emotion, setEmotionState] = useState<Emotion>("idle");
  const [speaking, setSpeakingState] = useState(false);
  const [broken, setBroken] = useState<Record<string, boolean>>({});
  const markBroken = (clip: VideoClip) =>
    setBroken((b) => (b[clip] ? b : { ...b, [clip]: true }));

  const [reducedMotion] = useState(
    () =>
      typeof window !== "undefined" &&
      !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
  );

  const emotionRef = useRef<Emotion>("idle");
  const speakingRef = useRef(false);
  const speakModeRef = useRef<"audio" | "procedural" | null>(null);
  const videoRefs = useRef<Partial<Record<VideoClip, HTMLVideoElement | null>>>({});

  // 说话口型层：闭嘴静帧 + 张嘴静帧（rAF 驱动 openRef 不透明度），外层做呼吸微动
  const stillsWrapRef = useRef<HTMLDivElement | null>(null);
  const openRef = useRef<HTMLImageElement | null>(null);

  // 音频 + 响度分析
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const srcNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const dataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  // 自适应响度峰值：按「近期峰值」归一化，让口型跟的是相对包络，
  // 不会因整段音量偏高就恒张到最大（那样看着像一直咧着嘴）。
  const peakRef = useRef(0);

  const clips = PERSONA.videoClips;
  // 待机/情绪片段（永不含 talk——说话口型改由静帧+音频驱动）
  const videoActive = pickClip(emotion, false, clips);
  const objectPosition = variant === "bubble" ? PERSONA.bubbleFocus : PERSONA.fullFocus;
  // 说话 / 减少动态 / 视频加载失败 → 显示静帧层
  const showStills = speaking || reducedMotion || !!broken[videoActive];

  // 复用一个 <audio> 发声
  useEffect(() => {
    const audio = new Audio();
    audio.crossOrigin = "anonymous";
    audioRef.current = audio;
    return () => {
      audio.pause();
      audio.src = "";
      ctxRef.current?.close().catch(() => {});
    };
  }, []);

  // 首次说话时按需建响度分析图（AudioContext 需用户手势后才能启动）
  function ensureAnalyser() {
    if (!audioRef.current || analyserRef.current) return;
    const AC: typeof AudioContext =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    if (!AC) return;
    try {
      const ctx = new AC();
      const node = ctx.createMediaElementSource(audioRef.current);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      node.connect(analyser);
      analyser.connect(ctx.destination);
      ctxRef.current = ctx;
      srcNodeRef.current = node;
      analyserRef.current = analyser;
      dataRef.current = new Uint8Array(analyser.fftSize);
    } catch {
      analyserRef.current = null; // 建图失败 → 口型退化为程序化摆嘴，声音仍能听
    }
  }

  // 切到情绪视频时从头播，做出干净起拍；idle 不重置保持连续
  useEffect(() => {
    if (reducedMotion || videoActive === "idle") return;
    const el = videoRefs.current[videoActive];
    if (!el) return;
    try {
      el.currentTime = 0;
    } catch {
      /* ignore */
    }
    el.play?.().catch(() => {});
  }, [videoActive, reducedMotion]);

  // 渲染循环：音量→张嘴不透明度（口型）+ 说话时呼吸微动
  useEffect(() => {
    let raf = 0;
    const t0 = performance.now();
    let mouth = 0;
    const tick = (now: number) => {
      const t = (now - t0) / 1000;
      const sp = speakingRef.current;

      let target = 0;
      if (sp) {
        const analyser = analyserRef.current;
        const data = dataRef.current;
        const audio = audioRef.current;
        if (speakModeRef.current === "audio" && analyser && data && audio && !audio.paused) {
          analyser.getByteTimeDomainData(data);
          let sum = 0;
          for (let i = 0; i < data.length; i++) {
            const v = (data[i] - 128) / 128;
            sum += v * v;
          }
          const rms = Math.sqrt(sum / data.length);
          // 自适应归一化：以近期峰值为满张，减 18% 底噪→停顿闭嘴；避免整体偏响时恒张
          peakRef.current = Math.max(rms, peakRef.current * 0.99);
          const norm = peakRef.current > 0.02 ? rms / peakRef.current : 0;
          // 以近期峰值为满张，把「音节间的相对下陷」映射成闭嘴：
          // 归一化响度低于峰值 70% → 开始合嘴，接近峰值 → 张到最大。语音连续处也能看出咬字起伏。
          target = Math.min(1, Math.max(0, (norm - 0.7) / 0.3));
        } else {
          // 静音 / Web Speech 回退 / 无分析器 → 程序化摆嘴
          target = 0.16 + 0.5 * Math.abs(Math.sin(t * 10.5));
        }
      } else {
        peakRef.current = 0; // 不说话时清空峰值，下次说话重新自适应
      }
      // 非对称平滑：张嘴快、闭嘴也不拖 → 咬字更清楚，不糊成一直开着
      mouth = lerp(mouth, target, sp ? (target > mouth ? 0.6 : 0.45) : 0.2);
      if (openRef.current) openRef.current.style.opacity = mouth.toFixed(3);

      // 静帧呼吸微动（说话时才动，避免「静帧僵脸」；reduced-motion 不动）
      if (stillsWrapRef.current) {
        const amp = reducedMotion ? 0 : sp ? 1 : 0;
        const breathe = (Math.sin(t * 0.95) * 0.006 + Math.sin(t * 0.31 + 1) * 0.003) * amp;
        const tx = (Math.sin(t * 0.53) + Math.sin(t * 0.31 + 1.2) * 0.6) * 0.8 * amp;
        const ty =
          (Math.sin(t * 0.8 + 0.6) * 0.9 + Math.sin(t * 0.45) * 0.5) * amp + mouth * 1.1 * amp;
        const rot = Math.sin(t * 0.4) * 0.25 * amp;
        stillsWrapRef.current.style.transform =
          `translate(${tx.toFixed(2)}px, ${ty.toFixed(2)}px) scale(${(STILL_SCALE + breathe).toFixed(4)}) rotate(${rot.toFixed(2)}deg)`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [reducedMotion]);

  function setSpeaking(v: boolean) {
    speakingRef.current = v;
    setSpeakingState(v);
    onSpeakingChange?.(v);
  }

  function stopSpeaking() {
    try {
      audioRef.current?.pause();
    } catch {
      /* ignore */
    }
    if (typeof window !== "undefined") window.speechSynthesis?.cancel();
    speakModeRef.current = null;
    setSpeaking(false);
  }

  function webSpeech(text: string) {
    if (typeof window === "undefined" || !window.speechSynthesis) {
      speakModeRef.current = "procedural";
      setSpeaking(true);
      const ms = Math.min(12000, 800 + text.length * 90);
      setTimeout(() => setSpeaking(false), ms);
      return;
    }
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "zh-CN";
    speakModeRef.current = "procedural";
    setSpeaking(true);
    u.onend = () => setSpeaking(false);
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  }

  function setEmotion(e: Emotion) {
    emotionRef.current = e;
    setEmotionState(e);
  }

  async function speak(text: string) {
    const content = text.trim();
    if (!content) return;
    stopSpeaking();

    // 静音：只做程序化摆嘴，不发声
    if (mutedRef.current) {
      speakModeRef.current = "procedural";
      setSpeaking(true);
      const ms = Math.min(12000, 800 + content.length * 90);
      setTimeout(() => setSpeaking(false), ms);
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
      // 用返回的实际 MIME（ZenMux 返回 audio/wav，OpenAI/Azure 返回 audio/mpeg）
      const mime = res.headers.get("content-type") || "audio/mpeg";
      const url = URL.createObjectURL(new Blob([buf], { type: mime }));
      const audio = audioRef.current!;
      ensureAnalyser();
      await ctxRef.current?.resume().catch(() => {});
      audio.src = url;
      speakModeRef.current = "audio";
      setSpeaking(true);
      audio.onended = () => {
        speakModeRef.current = null;
        setSpeaking(false);
        URL.revokeObjectURL(url);
      };
      await audio.play().catch(() => {
        setSpeaking(false);
        webSpeech(content); // 自动播放被拦 → Web Speech（程序化摆嘴）
      });
    } catch (e) {
      onError?.(e instanceof Error ? e.message : String(e));
      webSpeech(content);
    }
  }

  useEffect(() => {
    apiRef.current = { speak, stop: stopSpeaking, setEmotion };
    return () => {
      apiRef.current = null;
    };
  });

  return (
    <div
      className="relative h-full w-full overflow-hidden bg-[linear-gradient(160deg,#1b2456,#0b1124)]"
      role="img"
      aria-label={`数字人${PERSONA.name}`}
    >
      {/* 待机/情绪：真人循环视频（含真眨眼/摆头）。说话/减少动态/失败时整体淡出 */}
      {clips
        .filter((clip) => clip !== "talk")
        .map((clip) => {
          const visible = clip === videoActive && !showStills;
          return (
            <div
              key={clip}
              className="absolute inset-0 transition-opacity duration-300 ease-out"
              style={{ opacity: visible ? 1 : 0 }}
              aria-hidden={!visible}
            >
              {broken[clip] || reducedMotion ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={frameSrc(clip as Emotion)}
                  alt=""
                  draggable={false}
                  className="absolute inset-0 h-full w-full select-none object-cover"
                  style={{ objectPosition }}
                />
              ) : (
                <video
                  ref={(el) => {
                    videoRefs.current[clip] = el;
                    if (el) {
                      el.muted = true;
                      if (el.paused) el.play().catch(() => {});
                    }
                  }}
                  src={loopSrc(clip)}
                  poster={frameSrc(clip as Emotion)}
                  autoPlay
                  loop
                  muted
                  playsInline
                  preload="auto"
                  onError={() => markBroken(clip)}
                  className="absolute inset-0 h-full w-full select-none object-cover"
                  style={{ objectPosition }}
                />
              )}
            </div>
          );
        })}

      {/* 说话口型层：闭嘴静帧 + 张嘴静帧（音量驱动）。外层 rAF 呼吸微动 + 缩放对齐视频取景 */}
      <div
        className="absolute inset-0 transition-opacity duration-300 ease-out will-change-transform"
        style={{ opacity: showStills ? 1 : 0 }}
        aria-hidden={!showStills}
      >
        <div ref={stillsWrapRef} className="absolute inset-0" style={{ willChange: "transform" }}>
          {/* 用中性 idle 脸（与下层待机视频同一表情/机位），说话时不突然换成 thinking 表情 */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={frameSrc("idle")}
            alt=""
            draggable={false}
            className="absolute inset-0 h-full w-full select-none object-cover"
            style={{ objectPosition }}
          />
          {PERSONA.talkFrames && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              ref={openRef}
              src={talkSrc("idle")}
              alt=""
              draggable={false}
              className="absolute inset-0 h-full w-full select-none object-cover"
              style={{ objectPosition, opacity: 0 }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
