/**
 * 数字人形象配置 —— 在「手绘 SVG 木偶」与「你自己的写实立绘」之间切换。
 *
 * 默认 svg（当前手绘木偶「小行」，会实时对口型）。
 * 想换成自己生成的写实立绘：
 *   1) 按 public/avatar/<dir>/README.md 的规范把图片放进去；
 *   2) 设环境变量 NEXT_PUBLIC_AVATAR_MODE=image（或把下面的 fallback 默认改成 "image"）。
 * 两种模式共用同一套命令式接口（speak/stop/setEmotion），CopilotDock 无需改动。
 */

import type { Emotion } from "./DigitalHuman";

export type AvatarMode = "svg" | "image" | "video";

/**
 * 形象模式（默认 video——真人循环视频，会真眨眼/呼吸/说话）：
 *   - video：播放循环小视频（待机 idle-loop、说话 talk-loop、情绪 <e>-loop），最像真人；
 *   - image：静态写实立绘 + 活人微动 + 两帧口型；
 *   - svg：手绘木偶「小行」。
 * 用环境变量强制：NEXT_PUBLIC_AVATAR_MODE=image / svg / video。
 * 三种模式共用同一命令式接口（speak/stop/setEmotion），CopilotDock 无需改动。
 */
export const AVATAR_MODE: AvatarMode =
  process.env.NEXT_PUBLIC_AVATAR_MODE === "svg"
    ? "svg"
    : process.env.NEXT_PUBLIC_AVATAR_MODE === "image"
      ? "image"
      : "video";

/** 视频循环片段的 key（idle/talk 必需；其余可选，缺则回退 idle/talk） */
export type VideoClip = "idle" | "talk" | "happy" | "thinking" | "concerned";

export interface AvatarPersona {
  /** 展示名（无障碍标签） */
  name: string;
  /** public 下的目录（以 / 开头，不含结尾斜杠） */
  dir: string;
  /** 图片扩展名，jpg / png / webp */
  ext: "jpg" | "png" | "webp";
  /**
   * 是否提供「张嘴帧」<emotion>-talk.<ext>：
   *   有 → 说话时在闭嘴/张嘴两帧间切换，做出口型；
   *   无 → 说话时退化为轻微律动（缩放/上浮），不动嘴。
   */
  talkFrames: boolean;
  /**
   * 是否提供 bubble 专用的紧凑头像帧 <emotion>-bubble.<ext>（右下角 64px 圆头像）：
   *   有 → 圆头像用更贴脸的裁剪；无 → 复用主帧并 object-position 上移取脸。
   */
  bubbleFrames: boolean;
  /** bubble 复用主帧时的取景焦点（object-position），一般取脸部偏上 */
  bubbleFocus: string;
  /**
   * full 宽横幅舞台（约 2.6:1）里竖版立绘的取景焦点（object-position）。
   * 竖图被 object-cover 裁成横带，默认 50% 50% 会落在下巴/胸口；上移到脸部更好看。
   */
  fullFocus: string;

  // ── video 模式 ──
  /** 循环视频扩展名（mp4 兼容性最好；webm 更小） */
  videoExt: "mp4" | "webm";
  /** 存在哪些循环片段：idle/talk 必需，其余可选（缺则回退 idle/talk） */
  videoClips: VideoClip[];
}

/** 四种情绪对应的文件基名，与 DigitalHuman 的 Emotion 一一对应 */
export const EMOTIONS: Emotion[] = ["idle", "thinking", "happy", "concerned"];

/** 当前角色「小行」的图片清单 —— 替换成自己的立绘时改这里即可 */
export const PERSONA: AvatarPersona = {
  name: "小行",
  dir: "/avatar/xiaoxing",
  ext: "jpg",
  talkFrames: true,
  bubbleFrames: false,
  bubbleFocus: "50% 20%",
  fullFocus: "50% 38%",
  videoExt: "mp4",
  // 只列已生成的「真」循环片段。idle/talk 是可灵/即梦网页版生成的写实真人视频；
  // happy/thinking/concerned 尚未生成 → 从列表移除，pickClip 会让情绪回退到真实的 idle 视频
  // （而不是旧的 ffmpeg 缩放占位）。生成好情绪片段后，把对应 key 加回来即可。
  videoClips: ["idle", "talk"],
};

/**
 * 循环视频版本号——每次重生成/替换 *-loop.mp4 就把它 +1。
 * 浏览器按 URL 缓存 mp4，同名覆盖后旧标签页仍会放缓存的旧片；
 * 加 ?v= 让新片段在普通刷新时就能拉到最新，无需硬刷新。
 */
export const VIDEO_VERSION = "5-smooth24";

/** 循环视频路径（带缓存刷新版本）：/avatar/xiaoxing/idle-loop.mp4?v=… */
export function loopSrc(clip: VideoClip): string {
  return `${PERSONA.dir}/${clip}-loop.${PERSONA.videoExt}?v=${VIDEO_VERSION}`;
}

/** 该情绪要播的循环 key：说话优先 talk，否则用情绪专属（缺则 idle） */
export function pickClip(
  emotion: Emotion,
  speaking: boolean,
  available: VideoClip[],
): VideoClip {
  if (speaking && available.includes("talk")) return "talk";
  if (!speaking && emotion !== "idle" && available.includes(emotion as VideoClip)) {
    return emotion as VideoClip;
  }
  return "idle";
}

/** 主帧路径：/avatar/xiaoxing/happy.png */
export function frameSrc(emotion: Emotion): string {
  return `${PERSONA.dir}/${emotion}.${PERSONA.ext}`;
}

/** 张嘴帧路径（talkFrames 为 true 时才有意义）：/avatar/xiaoxing/happy-talk.png */
export function talkSrc(emotion: Emotion): string {
  return `${PERSONA.dir}/${emotion}-talk.${PERSONA.ext}`;
}

/** bubble 帧路径（bubbleFrames 为 true 时才有意义） */
export function bubbleSrc(emotion: Emotion): string {
  return `${PERSONA.dir}/${emotion}-bubble.${PERSONA.ext}`;
}
