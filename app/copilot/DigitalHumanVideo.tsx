"use client";

/**
 * 数字人（视频版）——待机用真人循环小视频（真眨眼/呼吸/摆头），说话用**逐字口型**：
 *
 * 说话时不放通用 talk 视频（那跟语音对不上），而是交叉淡入到静帧小行，用 **wawa-lipsync**
 * 从 TTS 音频实时识别 viseme（音素口型），切到对应的口型帧：
 *   闭嘴(idle.jpg) / ah(idle-talk.jpg) / ee(idle-ee.jpg) / oh(idle-oh.jpg) / oo(idle-oo.jpg)。
 * 这几张口型帧是把各口型 inpaint 后**只把嘴合成回同一张 idle.jpg** 得到的，所以除嘴以外像素一致，
 * 帧间切换只有嘴在变、不会「换脸」。于是嘴形跟着实际发音走（逐字），而非只有音量开合。
 *
 * 声音走独立 <audio>（云 TTS，失败回退 Web Speech）；muted / 无 viseme 时退化为程序化开合。
 * 待机仍是真视频；缺视频/减少动态时回退静帧，绝不黑屏。
 */

import { useEffect, useRef, useState } from "react";
import { Lipsync } from "wawa-lipsync";
import type { DigitalHumanHandle, Emotion } from "./DigitalHuman";
import { PERSONA, type VideoClip, frameSrc, loopSrc, pickClip } from "./avatar-config";

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
// 静帧相对待机视频的缩放（图生视频取景比原立绘近），让视频↔静帧交叉淡入时脸径对齐
const STILL_SCALE = 1.06;

// 口型帧文件（都与 idle.jpg 同脸、只嘴不同）
const MOUTH: Record<string, string> = {
  closed: `${PERSONA.dir}/idle.jpg`,
  ah: `${PERSONA.dir}/idle-talk.jpg`,
  ee: `${PERSONA.dir}/idle-ee.jpg`,
  oh: `${PERSONA.dir}/idle-oh.jpg`,
  oo: `${PERSONA.dir}/idle-oo.jpg`,
};
// 叠在 closed(闭嘴底)之上的口型层
const OVERLAYS = ["ah", "ee", "oh", "oo"] as const;
type Overlay = (typeof OVERLAYS)[number];
// wawa 的 15 个 viseme → 5 个口型帧
const V2F: Record<string, keyof typeof MOUTH> = {
  viseme_sil: "closed",
  viseme_PP: "closed",
  viseme_FF: "ee",
  viseme_TH: "ah",
  viseme_DD: "ah",
  viseme_kk: "ah",
  viseme_nn: "ah",
  viseme_RR: "ah",
  viseme_aa: "ah",
  viseme_CH: "ee",
  viseme_SS: "ee",
  viseme_E: "ee",
  viseme_I: "ee",
  viseme_O: "oh",
  viseme_U: "oo",
};

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

  // 口型层
  const stillsWrapRef = useRef<HTMLDivElement | null>(null);
  const overlayRefs = useRef<Partial<Record<Overlay, HTMLImageElement | null>>>({});
  const opRef = useRef<Record<Overlay, number>>({ ah: 0, ee: 0, oh: 0, oo: 0 });

  // 音频 + wawa-lipsync（懒建：首次说话=用户手势后，避免 AudioContext 挂起/重复建源）
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lipsyncRef = useRef<Lipsync | null>(null);

  const clips = PERSONA.videoClips;
  const videoActive = pickClip(emotion, false, clips); // 待机/情绪片段，永不含 talk
  const objectPosition = variant === "bubble" ? PERSONA.bubbleFocus : PERSONA.fullFocus;
  const showStills = speaking || reducedMotion || !!broken[videoActive];

  useEffect(() => {
    const audio = new Audio();
    audio.crossOrigin = "anonymous";
    audioRef.current = audio;
    return () => {
      audio.pause();
      audio.src = "";
    };
  }, []);

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

  // 渲染循环：viseme→口型帧不透明度 + 说话呼吸微动
  useEffect(() => {
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const t = (now - t0) / 1000;
      const sp = speakingRef.current;
      const audio = audioRef.current;

      const target: Record<Overlay, number> = { ah: 0, ee: 0, oh: 0, oo: 0 };
      if (sp) {
        if (speakModeRef.current === "audio" && lipsyncRef.current && audio && !audio.paused) {
          try {
            lipsyncRef.current.processAudio();
            const frame = V2F[lipsyncRef.current.viseme as unknown as string] || "ah";
            if (frame !== "closed") target[frame as Overlay] = 1; // else 全 0 → 露出闭嘴底
          } catch {
            target.ah = 0.4;
          }
        } else {
          // 静音 / Web Speech 回退 / 无 lipsync → 程序化开合（只 ah 层）
          target.ah = 0.16 + 0.5 * Math.abs(Math.sin(t * 10.5));
        }
      }
      // 口型切换要快（音素级），张快、切换也快
      for (const k of OVERLAYS) {
        opRef.current[k] = lerp(opRef.current[k], target[k], sp ? 0.5 : 0.25);
        const el = overlayRefs.current[k];
        if (el) el.style.opacity = opRef.current[k].toFixed(3);
      }

      if (stillsWrapRef.current) {
        const amp = reducedMotion ? 0 : sp ? 1 : 0;
        const breathe = (Math.sin(t * 0.95) * 0.006 + Math.sin(t * 0.31 + 1) * 0.003) * amp;
        const tx = (Math.sin(t * 0.53) + Math.sin(t * 0.31 + 1.2) * 0.6) * 0.8 * amp;
        const ty = (Math.sin(t * 0.8 + 0.6) * 0.9 + Math.sin(t * 0.45) * 0.5) * amp;
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
      const mime = res.headers.get("content-type") || "audio/mpeg";
      const url = URL.createObjectURL(new Blob([buf], { type: mime }));
      const audio = audioRef.current!;
      audio.src = url;
      // 懒建并连音频到 lipsync（同元素幂等，避免重复 createMediaElementSource）
      if (!lipsyncRef.current) lipsyncRef.current = new Lipsync();
      try {
        lipsyncRef.current.connectAudio(audio);
        // 真实浏览器里 AudioContext 可能挂起（自动播放策略）→ 恢复它，否则取不到 viseme
        await (
          lipsyncRef.current as unknown as { audioContext?: AudioContext }
        ).audioContext?.resume?.();
      } catch {
        /* 连接/恢复失败 → 退化为程序化口型 */
      }
      speakModeRef.current = "audio";
      setSpeaking(true);
      audio.onended = () => {
        speakModeRef.current = null;
        setSpeaking(false);
        URL.revokeObjectURL(url);
      };
      await audio.play().catch(() => {
        setSpeaking(false);
        webSpeech(content);
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
      {/* 待机/情绪：真人循环视频（真眨眼/摆头）。说话/减少动态/失败时淡出 */}
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

      {/* 说话口型层：闭嘴底 + 4 张口型帧（viseme 驱动其不透明度）。外层 rAF 呼吸微动 + 缩放对齐 */}
      <div
        className="absolute inset-0 transition-opacity duration-300 ease-out will-change-transform"
        style={{ opacity: showStills ? 1 : 0 }}
        aria-hidden={!showStills}
      >
        <div ref={stillsWrapRef} className="absolute inset-0" style={{ willChange: "transform" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={MOUTH.closed}
            alt=""
            draggable={false}
            className="absolute inset-0 h-full w-full select-none object-cover"
            style={{ objectPosition }}
          />
          {OVERLAYS.map((k) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={k}
              ref={(el) => {
                overlayRefs.current[k] = el;
              }}
              src={MOUTH[k]}
              alt=""
              draggable={false}
              className="absolute inset-0 h-full w-full select-none object-cover"
              style={{ objectPosition, opacity: 0 }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
