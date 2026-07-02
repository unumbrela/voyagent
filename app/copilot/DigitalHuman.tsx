"use client";

/**
 * 数字人（2D 矢量）——手绘 SVG 角色「小行」，会说话、有表情。
 *
 * 为什么不用 3D：GLB 头像在 64px 气泡里取景/打光都难看且加载重；
 * 矢量插画在任意尺寸下锐利精致，且能完全贴合全站「暮色极光」视觉。
 *
 * - 表情：emotion（idle/thinking/happy/concerned）驱动眉毛/眼睛/嘴角/腮红 + 自动眨眼 + 视线游移。
 * - 口型：说话时用 wawa-lipsync 从 TTS 音频实时分析 viseme（与 provider 无关），
 *   映射为「张口/咧宽/撮圆」三参数驱动的嘴形；无音频（静音/Web Speech 回退）时用程序化口型。
 * - 发声：优先云 TTS（/api/tts），失败/未配置则回退浏览器 Web Speech；可静音（只动不发声）。
 *
 * 通过 ref 暴露命令式接口：speak(text) / stop() / setEmotion(e)。
 */

import { useEffect, useId, useRef, useState } from "react";
import { Lipsync } from "wawa-lipsync";

export type Emotion = "idle" | "thinking" | "happy" | "concerned";

export interface DigitalHumanHandle {
  /** 朗读并做口型；muted 时只做口型不发声 */
  speak: (text: string) => Promise<void>;
  stop: () => void;
  setEmotion: (e: Emotion) => void;
}

/** viseme → [张口, 咧宽, 撮圆]（0..1） */
const VISEME_MOUTH: Record<string, [number, number, number]> = {
  viseme_sil: [0.02, 0, 0],
  viseme_PP: [0.04, 0.1, 0],
  viseme_FF: [0.14, 0.35, 0],
  viseme_TH: [0.25, 0.35, 0],
  viseme_DD: [0.32, 0.4, 0],
  viseme_kk: [0.3, 0.3, 0],
  viseme_CH: [0.26, 0.25, 0.5],
  viseme_SS: [0.18, 0.6, 0],
  viseme_nn: [0.16, 0.3, 0],
  viseme_RR: [0.26, 0.2, 0.4],
  viseme_aa: [0.85, 0.35, 0.1],
  viseme_E: [0.5, 0.75, 0],
  viseme_I: [0.32, 0.85, 0],
  viseme_O: [0.7, 0.1, 0.85],
  viseme_U: [0.38, 0, 1],
};

/** 各情绪 → 面部参数目标 */
interface Face {
  corner: number; // 嘴角上扬（负为下垂）
  open: number;
  browL: number; // 眉毛抬升
  browR: number;
  tiltL: number; // 眉毛旋转（正=外端上挑）
  tiltR: number;
  eyeS: number; // 眼睛纵向开合（1=全开）
  squint: number; // 下睑上抬（笑眼）
  blush: number;
  headTilt: number;
  gaze: [number, number] | null; // null=自由游移
}

const EXPR: Record<Emotion, Face> = {
  idle: {
    corner: 3.4, open: 0.03, browL: 0, browR: 0, tiltL: 0, tiltR: 0,
    eyeS: 1, squint: 0, blush: 0.5, headTilt: 0, gaze: null,
  },
  thinking: {
    corner: 0.8, open: 0.03, browL: 3.5, browR: 0.5, tiltL: -5, tiltR: 0,
    eyeS: 0.94, squint: 0, blush: 0.45, headTilt: -2.4, gaze: [-2.6, -2.6],
  },
  happy: {
    corner: 7, open: 0.1, browL: 1.5, browR: 1.5, tiltL: 0, tiltR: 0,
    eyeS: 0.58, squint: 2.2, blush: 0.8, headTilt: 1.2, gaze: [0, 0],
  },
  concerned: {
    corner: -3.2, open: 0.04, browL: 2, browR: 2, tiltL: 9, tiltR: 9,
    eyeS: 0.88, squint: 0, blush: 0.4, headTilt: -1, gaze: [0, 0.6],
  },
};

/** 帧间共享的可变状态（命令式接口写、渲染循环读） */
interface Shared {
  emotion: Emotion;
  speaking: boolean;
  mode: "audio" | "procedural" | null;
  lipsync: Lipsync | null;
  audio: HTMLAudioElement | null;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** 嘴形路径：由 张口/咧宽/撮圆/嘴角 计算（中心 160,190） */
function mouthPath(open: number, wide: number, round: number, corner: number) {
  const w = 13 + wide * 8 - round * 7;
  const cy = 190 - corner;
  const topC = 190 + corner * 1.3 - open * 7;
  const botC = 190 + corner * 1.3 + 3.2 + open * 26;
  return `M ${160 - w} ${cy} Q 160 ${topC} ${160 + w} ${cy} Q 160 ${botC} ${160 - w} ${cy} Z`;
}

/** 星点/微光的固定布置（铺满 full 变体的宽舞台） */
const STARS: [number, number, number, number][] = [
  // x, y, r, delay(s)
  [-118, 66, 1.3, 0], [-64, 128, 1, 1.2], [-16, 54, 1.5, 2.1], [30, 100, 0.9, 0.6],
  [70, 44, 1.2, 1.7], [104, 82, 0.8, 2.6], [226, 60, 1.1, 0.3], [258, 122, 0.9, 1.5],
  [306, 46, 1.4, 2.3], [356, 96, 1, 0.9], [412, 58, 1.3, 1.9], [446, 140, 0.9, 0.1],
];

const SPARKLE = "M0 -5 C1.2 -1.2 1.2 -1.2 5 0 C1.2 1.2 1.2 1.2 0 5 C-1.2 1.2 -1.2 1.2 -5 0 C-1.2 -1.2 -1.2 -1.2 0 -5 Z";

/** 左眼几何（右眼镜像复用）。groupRef 做眨眼缩放，gazeRef 做视线平移 */
function Eye({
  groupRef,
  gazeRef,
  clipId,
  irisId,
}: {
  groupRef: React.RefObject<SVGGElement | null>;
  gazeRef: React.RefObject<SVGGElement | null>;
  clipId: string;
  irisId: string;
}) {
  return (
    <g ref={groupRef}>
      {/* 眼白 */}
      <path
        d="M114.5 148 C117.5 138.5 124.5 133.5 132.5 133.5 C141 133.5 147.5 139.5 149 148 C147.5 155.5 140.5 160 132 160 C123.5 160 117 155 114.5 148 Z"
        fill="#fdf9f2"
      />
      {/* 虹膜/瞳孔（裁剪进眼眶） */}
      <g clipPath={`url(#${clipId})`}>
        <g ref={gazeRef}>
          <circle cx="132.5" cy="148" r="8.6" fill={`url(#${irisId})`} />
          <circle cx="132.5" cy="148" r="8.2" fill="none" stroke="#16295b" strokeWidth="1.4" opacity="0.5" />
          <circle cx="132.5" cy="148" r="4" fill="#10142e" />
          <circle cx="129.4" cy="144.4" r="2.5" fill="#fff" />
          <circle cx="136.4" cy="151.6" r="1.2" fill="#fff" opacity="0.75" />
        </g>
      </g>
      {/* 上睫毛（月牙）+ 外眼角挑 */}
      <path
        d="M112.8 148.6 C115.8 136.8 123.8 130.4 132.6 130.4 C142.4 130.4 149.8 137.6 151.6 147.4 L148.3 148.1 C146.6 139.9 140.4 134.4 132.6 134.4 C125 134.4 118.4 139.7 115.9 149.4 Z"
        fill="#252b4e"
      />
      <path
        d="M150.6 146.2 C153 143.4 155.4 142.2 158.2 141.7 C156.5 144.4 155.4 146.9 154.7 150 Z"
        fill="#252b4e"
      />
      {/* 卧蚕/下睫毛 */}
      <path
        d="M119 156.5 C124.5 160.5 138 161.5 145.5 156.8"
        fill="none"
        stroke="#252b4e"
        strokeWidth="1.6"
        strokeLinecap="round"
        opacity="0.28"
      />
      {/* 眼睑折痕 */}
      <path
        d="M119 135.5 C124.5 131.5 140 131.5 146 135.8"
        fill="none"
        stroke="#e2bd99"
        strokeWidth="2"
        strokeLinecap="round"
        opacity="0.5"
      />
    </g>
  );
}

function AvatarSVG({
  shared,
  reducedMotion,
  variant,
}: {
  shared: React.RefObject<Shared>;
  reducedMotion: boolean;
  variant: "full" | "bubble";
}) {
  const uid = useId().replace(/[:]/g, "");
  const id = (s: string) => `dh-${uid}-${s}`;

  const charG = useRef<SVGGElement | null>(null);
  const headG = useRef<SVGGElement | null>(null);
  const lockL = useRef<SVGGElement | null>(null);
  const lockR = useRef<SVGGElement | null>(null);
  const eyeL = useRef<SVGGElement | null>(null);
  const eyeR = useRef<SVGGElement | null>(null);
  const gazeL = useRef<SVGGElement | null>(null);
  const gazeR = useRef<SVGGElement | null>(null);
  const browL = useRef<SVGPathElement | null>(null);
  const browR = useRef<SVGPathElement | null>(null);
  const mouth = useRef<SVGPathElement | null>(null);
  const mouthClip = useRef<SVGPathElement | null>(null);
  const tongue = useRef<SVGEllipseElement | null>(null);
  const lipShadow = useRef<SVGPathElement | null>(null);
  const blushL = useRef<SVGEllipseElement | null>(null);
  const blushR = useRef<SVGEllipseElement | null>(null);

  useEffect(() => {
    // 当前面部参数（朝目标收敛）
    const P = {
      open: 0.03, wide: 0.3, round: 0, corner: 3.4,
      browL: 0, browR: 0, tiltL: 0, tiltR: 0,
      eyeS: 1, squint: 0, blush: 0.5, headTilt: 0,
      gx: 0, gy: 0,
    };
    const blink = { next: 1.2 + Math.random() * 2, active: false, start: 0 };
    const wander = { next: 2, x: 0, y: 0 };
    let raf = 0;
    const t0 = performance.now();

    const tick = (now: number) => {
      const t = (now - t0) / 1000;
      const s = shared.current;
      const E = EXPR[s.emotion] ?? EXPR.idle;

      // 1) 口型目标
      let [tOpen, tWide, tRound] = [E.open, 0.3, 0];
      let mouthLerp = 0.14;
      if (s.speaking) {
        mouthLerp = 0.42;
        if (s.mode === "audio" && s.lipsync && s.audio && !s.audio.paused) {
          s.lipsync.processAudio();
          const v = VISEME_MOUTH[s.lipsync.viseme as unknown as string];
          [tOpen, tWide, tRound] = v ?? [0.4, 0.3, 0];
        } else {
          // 程序化口型（静音 / Web Speech 回退）
          tOpen = (0.16 + 0.5 * Math.abs(Math.sin(t * 10.5))) * (0.75 + 0.25 * Math.sin(t * 2.1));
          tWide = 0.35 + 0.25 * Math.sin(t * 3.3);
          tRound = Math.max(0, Math.sin(t * 1.7)) * 0.5;
        }
      }
      P.open = lerp(P.open, tOpen, mouthLerp);
      P.wide = lerp(P.wide, tWide, mouthLerp * 0.7);
      P.round = lerp(P.round, tRound, mouthLerp * 0.7);
      P.corner = lerp(P.corner, s.speaking ? Math.min(E.corner, 1.5) : E.corner, 0.12);

      // 2) 眉/眼/腮红/头 朝情绪目标收敛
      P.browL = lerp(P.browL, E.browL, 0.12);
      P.browR = lerp(P.browR, E.browR, 0.12);
      P.tiltL = lerp(P.tiltL, E.tiltL, 0.12);
      P.tiltR = lerp(P.tiltR, E.tiltR, 0.12);
      P.eyeS = lerp(P.eyeS, E.eyeS, 0.14);
      P.squint = lerp(P.squint, E.squint, 0.14);
      P.blush = lerp(P.blush, E.blush, 0.06);
      P.headTilt = lerp(P.headTilt, E.headTilt, 0.08);

      // 3) 视线：情绪指定 or 自由游移
      let [tgx, tgy] = E.gaze ?? [wander.x, wander.y];
      if (!E.gaze && t > wander.next) {
        wander.next = t + 2.4 + Math.random() * 2.6;
        if (Math.random() < 0.55) {
          wander.x = 0; wander.y = 0; // 多数时间看向用户
        } else {
          wander.x = (Math.random() * 2 - 1) * 2.8;
          wander.y = (Math.random() * 2 - 1) * 1.4;
        }
        [tgx, tgy] = [wander.x, wander.y];
      }
      P.gx = lerp(P.gx, tgx, 0.1);
      P.gy = lerp(P.gy, tgy, 0.1);

      // 4) 眨眼
      const b = blink;
      if (!b.active && t > b.next) {
        b.active = true;
        b.start = t;
      }
      let blinkS = 1;
      if (b.active) {
        const p = (t - b.start) / 0.16;
        blinkS = p < 0.5 ? 1 - p * 2 : Math.min(1, (p - 0.5) * 2);
        if (p >= 1) {
          b.active = false;
          b.next = t + 2 + Math.random() * 3.5;
        }
      }
      const sEff = Math.max(0.06, P.eyeS * Math.max(0.04, blinkS));

      // 5) 待机呼吸/摆动（尊重减少动效；bubble 幅度减半）
      const amp = reducedMotion ? 0 : variant === "bubble" ? 0.55 : 1;
      const bobY = Math.sin(t * 1.15) * 1.8 * amp;
      const rot =
        P.headTilt +
        Math.sin(t * 0.55) * 1.5 * amp +
        (s.speaking && !reducedMotion ? Math.sin(t * 6.5) * 0.5 : 0);
      const sway = Math.sin(t * 0.8 + 0.6) * 1.1 * amp;

      // ── 写入 SVG ──
      charG.current?.setAttribute("transform", `translate(0 ${bobY.toFixed(2)})`);
      headG.current?.setAttribute("transform", `rotate(${rot.toFixed(2)} 160 152)`);
      lockL.current?.setAttribute("transform", `rotate(${sway.toFixed(2)} 110 95)`);
      lockR.current?.setAttribute("transform", `rotate(${sway.toFixed(2)} 110 95)`);
      const eyeT = `translate(0 ${(147 * (1 - sEff) + P.squint * (1 - (1 - sEff) * 0.5)).toFixed(2)}) scale(1 ${sEff.toFixed(3)})`;
      eyeL.current?.setAttribute("transform", eyeT);
      eyeR.current?.setAttribute("transform", eyeT);
      gazeL.current?.setAttribute("transform", `translate(${P.gx.toFixed(2)} ${P.gy.toFixed(2)})`);
      gazeR.current?.setAttribute("transform", `translate(${(-P.gx).toFixed(2)} ${P.gy.toFixed(2)})`);
      browL.current?.setAttribute(
        "transform",
        `translate(0 ${(-P.browL).toFixed(2)}) rotate(${P.tiltL.toFixed(2)} 119 124)`,
      );
      browR.current?.setAttribute(
        "transform",
        `translate(0 ${(-P.browR).toFixed(2)}) rotate(${P.tiltR.toFixed(2)} 119 124)`,
      );
      const d = mouthPath(P.open, P.wide, P.round, P.corner);
      mouth.current?.setAttribute("d", d);
      mouthClip.current?.setAttribute("d", d);
      tongue.current?.setAttribute("cy", (197 + P.open * 12).toFixed(2));
      const lw = (13 + P.wide * 8 - P.round * 7) * 0.62;
      const by = 190 + P.corner * 1.3 + 2.4 + P.open * 20;
      lipShadow.current?.setAttribute(
        "d",
        `M ${160 - lw} ${by} Q 160 ${by + 2.6} ${160 + lw} ${by}`,
      );
      const blushO = P.blush.toFixed(2);
      blushL.current?.setAttribute("opacity", blushO);
      blushR.current?.setAttribute("opacity", blushO);

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [shared, reducedMotion, variant]);

  // bubble：头部特写（圆形头像）；full：宽幅舞台（头+肩+极光）
  const viewBox = variant === "bubble" ? "62 26 196 196" : "-153 30 626 290";

  return (
    <svg
      viewBox={viewBox}
      preserveAspectRatio="xMidYMid slice"
      className="h-full w-full"
      role="img"
      aria-label="数字人小行"
    >
      <defs>
        <linearGradient id={id("bg")} x1="0" y1="0" x2="0.3" y2="1">
          <stop offset="0" stopColor="#1b2456" />
          <stop offset="1" stopColor="#0b1124" />
        </linearGradient>
        <radialGradient id={id("halo")} cx="0.5" cy="0.45" r="0.5">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.09" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={id("hair")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3b4374" />
          <stop offset="1" stopColor="#191f42" />
        </linearGradient>
        <linearGradient id={id("bang")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#454e85" />
          <stop offset="1" stopColor="#262d58" />
        </linearGradient>
        <radialGradient id={id("skin")} cx="0.46" cy="0.38" r="0.75">
          <stop offset="0" stopColor="#ffeede" />
          <stop offset="1" stopColor="#f5cba2" />
        </radialGradient>
        <radialGradient id={id("iris")} cx="0.35" cy="0.3" r="0.85">
          <stop offset="0" stopColor="#43cdbb" />
          <stop offset="0.55" stopColor="#2b8f9c" />
          <stop offset="1" stopColor="#1d3a74" />
        </radialGradient>
        <radialGradient id={id("blush")} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#ff9d7e" stopOpacity="0.55" />
          <stop offset="1" stopColor="#ff9d7e" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={id("mouth")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#b34a5e" />
          <stop offset="1" stopColor="#7c2e44" />
        </linearGradient>
        <linearGradient id={id("scarf")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3fdcc8" />
          <stop offset="1" stopColor="#149a8b" />
        </linearGradient>
        <linearGradient id={id("jacket")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2c3668" />
          <stop offset="1" stopColor="#1a2148" />
        </linearGradient>
        <radialGradient id={id("pin")} cx="0.35" cy="0.3" r="0.9">
          <stop offset="0" stopColor="#ffd894" />
          <stop offset="1" stopColor="#e2a04a" />
        </radialGradient>
        <filter id={id("blurA")} x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="18" />
        </filter>
        <filter id={id("blurB")} x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="26" />
        </filter>
        <clipPath id={id("eyeclip")}>
          <path d="M114.5 148 C117.5 138.5 124.5 133.5 132.5 133.5 C141 133.5 147.5 139.5 149 148 C147.5 155.5 140.5 160 132 160 C123.5 160 117 155 114.5 148 Z" />
        </clipPath>
        <clipPath id={id("mouthclip")}>
          <path ref={mouthClip} d={mouthPath(0.03, 0.3, 0, 3.4)} />
        </clipPath>
      </defs>

      {/* ── 夜空背景 ── */}
      <rect x="-160" y="-20" width="644" height="380" fill={`url(#${id("bg")})`} />
      <ellipse cx="30" cy="66" rx="120" ry="52" fill="#2fd4c6" opacity="0.36" filter={`url(#${id("blurA")})`} />
      <ellipse cx="330" cy="120" rx="130" ry="58" fill="#7c6bff" opacity="0.3" filter={`url(#${id("blurB")})`} />
      <ellipse cx="160" cy="336" rx="180" ry="52" fill="#ffb45e" opacity="0.14" filter={`url(#${id("blurB")})`} />
      {STARS.map(([x, y, r, delay], i) => (
        <circle
          key={i}
          cx={x}
          cy={y}
          r={r}
          fill="#fff"
          className="dh-tw"
          style={{ animationDelay: `${delay}s` }}
          opacity="0.8"
        />
      ))}
      <circle cx="160" cy="140" r="150" fill={`url(#${id("halo")})`} />
      {/* 前景微光星芒 */}
      <g fill="#bffdf4">
        <path d={SPARKLE} transform="translate(84 76)" className="dh-tw" style={{ animationDelay: "0.8s" }} />
        <path d={SPARKLE} transform="translate(243 178) scale(0.8)" className="dh-tw" style={{ animationDelay: "2s" }} />
        <path d={SPARKLE} transform="translate(292 58) scale(1.1)" className="dh-tw" style={{ animationDelay: "1.4s" }} opacity="0.8" />
      </g>

      {/* ── 角色 ── */}
      <g ref={charG}>
        {/* 脖子（头后、身体前） */}
        <path d="M147 200 C148 226 148 238 145 248 L175 248 C172 238 172 226 173 200 Z" fill="#eec49e" />
        <path d="M147 204 C152 216 168 216 173 204 L173 200 L147 200 Z" fill="#dfa87c" opacity="0.55" />
        {/* 肩/夹克（顶部提亮 + 肩线轮廓光，和夜空拉开层次） */}
        <path d="M76 334 C78 296 108 270 140 261 C146 273 174 273 180 261 C212 270 242 296 244 334 Z" fill={`url(#${id("jacket")})`} />
        <path d="M88 304 C98 281 118 268 138 262" fill="none" stroke="#4d5a9c" strokeWidth="2.4" strokeLinecap="round" opacity="0.75" />
        <path d="M232 304 C222 281 202 268 182 262" fill="none" stroke="#4d5a9c" strokeWidth="2.4" strokeLinecap="round" opacity="0.75" />
        <path d="M140 262 C137 277 134 293 136 312" fill="none" stroke="#434e8c" strokeWidth="2" opacity="0.55" />
        <path d="M180 262 C183 277 186 293 184 312" fill="none" stroke="#434e8c" strokeWidth="2" opacity="0.55" />
        {/* 围巾（窄圈 + 垂坠小尾） + 指南针别针 */}
        <path d="M121 258 C123 247 197 247 199 258 C199 269 121 269 121 258 Z" fill={`url(#${id("scarf")})`} />
        <path d="M126 253 C144 259 176 259 194 253" fill="none" stroke="#0c7c70" strokeWidth="2.2" opacity="0.5" />
        <path d="M141 266 C136 280 134 292 137 302 C142 307 150 304 151 297 C153 285 150 274 148 266 Z" fill="#1cab9a" />
        <path d="M140 299 L138 307 M145 301 L144 309 M150 298 L151 306" stroke="#0c7c70" strokeWidth="1.8" strokeLinecap="round" />
        <circle cx="190" cy="282" r="7.5" fill={`url(#${id("pin")})`} stroke="#b97f34" strokeWidth="1" />
        <circle cx="190" cy="282" r="4.8" fill="#fdf4e3" />
        <path d="M190 277.8 L191.7 282 L188.3 282 Z" fill="#c5482f" />
        <path d="M190 286.2 L191.7 282 L188.3 282 Z" fill="#128a7e" />

        {/* 头（整体轻微摆动） */}
        <g ref={headG}>
          {/* 后发 */}
          <path
            d="M160 42 C106 42 70 80 68 136 C67 172 76 205 70 240 C67 253 74 262 87 263 C103 264 117 257 124 245 C117 213 114 182 116 150 C117 128 121 106 130 88 L190 88 C199 106 203 128 204 150 C206 182 203 213 196 245 C203 257 217 264 233 263 C246 262 253 253 250 240 C244 205 253 172 252 136 C250 80 214 42 160 42 Z"
            fill={`url(#${id("hair")})`}
          />
          {/* 脸 */}
          <path
            d="M160 66 C123 66 101 92 101 134 C101 165 112 192 132 208 C142 216 152 220 160 220 C168 220 178 216 188 208 C208 192 219 165 219 134 C219 92 197 66 160 66 Z"
            fill={`url(#${id("skin")})`}
          />
          {/* 腮红 */}
          <ellipse ref={blushL} cx="121.5" cy="168" rx="12.5" ry="7.5" fill={`url(#${id("blush")})`} opacity="0.5" />
          <ellipse ref={blushR} cx="198.5" cy="168" rx="12.5" ry="7.5" fill={`url(#${id("blush")})`} opacity="0.5" />
          {/* 眼睛（右眼镜像） */}
          <Eye groupRef={eyeL} gazeRef={gazeL} clipId={id("eyeclip")} irisId={id("iris")} />
          <g transform="matrix(-1 0 0 1 320 0)">
            <Eye groupRef={eyeR} gazeRef={gazeR} clipId={id("eyeclip")} irisId={id("iris")} />
          </g>
          {/* 鼻 */}
          <path
            d="M161.5 157 C160 163 159 167.5 162 171"
            fill="none"
            stroke="#dda07c"
            strokeWidth="2.2"
            strokeLinecap="round"
          />
          {/* 嘴（口型动画） */}
          <path ref={mouth} d={mouthPath(0.03, 0.3, 0, 3.4)} fill={`url(#${id("mouth")})`} />
          <g clipPath={`url(#${id("mouthclip")})`}>
            <rect x="147" y="180.5" width="26" height="9" rx="3" fill="#fff7f1" />
            <ellipse ref={tongue} cx="160" cy="197" rx="8.5" ry="5.5" fill="#e56f79" opacity="0.9" />
          </g>
          <path
            ref={lipShadow}
            d="M152 197 Q 160 199.6 168 197"
            fill="none"
            stroke="#d78d66"
            strokeWidth="2"
            strokeLinecap="round"
            opacity="0.5"
          />
          {/* 刘海（饱满锯齿式，覆盖额头） */}
          <path
            d="M95 112
               C96 74 122 50 160 50
               C198 50 224 72 225 108
               C222 114 219 119 214 121
               C210 122 208 116 205 113
               C200 118 198 125 193 127
               C189 128 186 120 183 116
               C177 122 175 130 169 132
               C164 133 161 122 157 118
               C152 123 150 129 145 130
               C140 131 137 120 133 116
               C127 121 125 128 121 128
               C116 128 113 117 109 114
               C105 117 103 123 100 124
               C97 124 95 117 95 112 Z"
            fill={`url(#${id("bang")})`}
          />
          {/* 眉毛（透出刘海之上——保持表情可见） */}
          <path
            ref={browL}
            d="M117 123.5 C124.5 117.5 137 116.5 145.5 120.8"
            fill="none"
            stroke="#232946"
            strokeWidth="4.4"
            strokeLinecap="round"
            opacity="0.92"
          />
          <g transform="matrix(-1 0 0 1 320 0)">
            <path
              ref={browR}
              d="M117 123.5 C124.5 117.5 137 116.5 145.5 120.8"
              fill="none"
              stroke="#232946"
              strokeWidth="4.4"
              strokeLinecap="round"
              opacity="0.92"
            />
          </g>
          {/* 发丝高光 + 极光边缘光 + 呆毛 */}
          <path d="M144 60 C136 76 128 92 122 108" fill="none" stroke="#59639f" strokeWidth="3" strokeLinecap="round" opacity="0.85" />
          <path d="M184 62 C190 76 196 90 200 102" fill="none" stroke="#59639f" strokeWidth="2.6" strokeLinecap="round" opacity="0.75" />
          <path d="M72 116 C78 84 98 60 128 47" fill="none" stroke="#8fe9dc" strokeWidth="3" strokeLinecap="round" opacity="0.45" />
          <path d="M166 44 C162 34 170 26 178 30" fill="none" stroke="#4a5390" strokeWidth="3.4" strokeLinecap="round" />
          {/* 侧发绺（前层，轻微摇摆） */}
          <g ref={lockL}>
            <path
              d="M105 90 C96 112 91 148 94 186 C96 210 102 228 112 237 C119 231 122 219 121 204 C118 172 116 138 119 108 C115 100 110 94 105 90 Z"
              fill={`url(#${id("hair")})`}
            />
          </g>
          <g transform="matrix(-1 0 0 1 320 0)">
            <g ref={lockR}>
              <path
                d="M105 90 C96 112 91 148 94 186 C96 210 102 228 112 237 C119 231 122 219 121 204 C118 172 116 138 119 108 C115 100 110 94 105 90 Z"
                fill={`url(#${id("hair")})`}
              />
            </g>
          </g>
        </g>
      </g>
    </svg>
  );
}

export default function DigitalHuman({
  apiRef,
  muted = false,
  variant = "full",
  onSpeakingChange,
  onError,
}: {
  /** 父组件持有的句柄：挂载后写入 speak/stop/setEmotion（避开 dynamic 的 ref 转发问题） */
  apiRef: React.MutableRefObject<DigitalHumanHandle | null>;
  muted?: boolean;
  /** full=头+肩宽幅舞台（面板）；bubble=头部特写（右下角圆形头像） */
  variant?: "full" | "bubble";
  onSpeakingChange?: (speaking: boolean) => void;
  onError?: (msg: string) => void;
}) {
  const shared = useRef<Shared>({
    emotion: "idle",
    speaking: false,
    mode: null,
    lipsync: null,
    audio: null,
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

  useEffect(() => {
    // 复用同一个 <audio>：wawa 的 connectAudio 对同一元素幂等，避免 createMediaElementSource 重复报错
    const audio = new Audio();
    audio.crossOrigin = "anonymous";
    shared.current.audio = audio;
    return () => {
      audio.pause();
      audio.src = "";
    };
  }, []);

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

  // 浏览器免费 Web Speech 兜底（云 TTS 未配置/失败时）
  function webSpeech(text: string) {
    const s = shared.current;
    if (typeof window === "undefined" || !window.speechSynthesis) {
      // 连 Web Speech 都没有：仅按时长做程序化口型
      s.mode = "procedural";
      s.speaking = true;
      onSpeakingChange?.(true);
      const ms = Math.min(12000, 800 + text.length * 90);
      setTimeout(() => {
        s.speaking = false;
        s.emotion = "idle";
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
      s.emotion = "idle";
      onSpeakingChange?.(false);
    };
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  }

  function setEmotion(e: Emotion) {
    shared.current.emotion = e;
  }

  async function speak(text: string) {
    const content = text.trim();
    if (!content) return;
    stopSpeaking();
    const s = shared.current;

    // 静音：只做程序化口型，不发声
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
        // 501=未配置云 TTS，其它=失败：都回退 Web Speech
        webSpeech(content);
        return;
      }
      const buf = await res.arrayBuffer();
      const url = URL.createObjectURL(new Blob([buf], { type: "audio/mpeg" }));
      const audio = s.audio!;
      audio.src = url;
      if (!s.lipsync) s.lipsync = new Lipsync();
      s.lipsync.connectAudio(audio); // 同元素幂等；首次 src 就绪时建立音频图
      s.mode = "audio";
      s.speaking = true;
      onSpeakingChange?.(true);
      audio.onended = () => {
        s.speaking = false;
        s.emotion = "idle";
        onSpeakingChange?.(false);
        URL.revokeObjectURL(url);
      };
      await audio.play().catch(() => {
        // 自动播放被拦截：回退 Web Speech
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

  return <AvatarSVG shared={shared} reducedMotion={reducedMotion} variant={variant} />;
}
