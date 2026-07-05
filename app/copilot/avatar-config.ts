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

export type AvatarMode = "svg" | "image";

/** 构建期读环境变量；缺省 svg，保持现有行为不变 */
export const AVATAR_MODE: AvatarMode =
  process.env.NEXT_PUBLIC_AVATAR_MODE === "image" ? "image" : "svg";

export interface AvatarPersona {
  /** 展示名（无障碍标签） */
  name: string;
  /** public 下的目录（以 / 开头，不含结尾斜杠） */
  dir: string;
  /** 图片扩展名，png 或 webp */
  ext: "png" | "webp";
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
}

/** 四种情绪对应的文件基名，与 DigitalHuman 的 Emotion 一一对应 */
export const EMOTIONS: Emotion[] = ["idle", "thinking", "happy", "concerned"];

/** 当前角色「小行」的图片清单 —— 替换成自己的立绘时改这里即可 */
export const PERSONA: AvatarPersona = {
  name: "小行",
  dir: "/avatar/xiaoxing",
  ext: "png",
  talkFrames: true,
  bubbleFrames: false,
  bubbleFocus: "50% 22%",
};

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
