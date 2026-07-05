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

export type AvatarMode = "svg" | "image" | "video" | "three";

/**
 * 形象模式（默认 three——浏览器里实时渲染的拟真 3D 数字人，真·实时口型）：
 *   - three：three.js 实时 3D 半身人（human.glb，ARKit+viseme morph 实时驱动），说话时头/眼/呼吸不冻结、
 *            嘴连续变形（最自然，推荐）；
 *   - video：真人循环视频 + 说话切口型照片（一开口会冻结成静帧，较僵硬——已被 three 取代）；
 *   - image：静态写实立绘 + 活人微动 + 两帧口型；
 *   - svg：手绘木偶「小行」。
 * 用环境变量强制：NEXT_PUBLIC_AVATAR_MODE=three / video / image / svg。
 * 各模式共用同一命令式接口（speak/stop/setEmotion），CopilotDock 无需改动。
 */
export const AVATAR_MODE: AvatarMode =
  process.env.NEXT_PUBLIC_AVATAR_MODE === "svg"
    ? "svg"
    : process.env.NEXT_PUBLIC_AVATAR_MODE === "image"
      ? "image"
      : process.env.NEXT_PUBLIC_AVATAR_MODE === "video"
        ? "video"
        : "three";

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

// ══════════════════════════════════════════════════════════════
//  three 实时 3D 数字人的「可选模型」注册表（供用户在面板里切换）
//  每个模型都带 ARKit + Oculus viseme morph（骨骼名统一 Head/Neck/Spine2/LeftEye/RightEye）。
//  用 gltf-transform 压过（webp 贴图 + meshopt 几何），放在 PERSONA.dir 下。
// ══════════════════════════════════════════════════════════════

export interface Avatar3DModel {
  /** localStorage / prop 用的稳定 id */
  id: string;
  /** 选择器里显示的名字 */
  name: string;
  /** 一句话风格说明（tooltip） */
  desc: string;
  /** GLB 文件名（相对 PERSONA.dir） */
  file: string;
  /** bubble 静帧头像文件名（相对 PERSONA.dir） */
  poster: string;
  /** 取景（以双眼中点为基准）：镜头距离 / 俯视下压 / 抬高。不同模型头身比不同故各配一套。 */
  frame: { dist: number; aimDrop: number; camRise: number };
  /**
   * 口型策略：
   *   - "viseme"：直接驱动模型自带的 viseme_* morph（RPM/VRoid 雕刻规范，逐音素最准）；
   *   - "synth"：用 jawOpen+圆唇+咧嘴合成（mpfb 那套 viseme 雕坏了，只能这样绕开）。
   */
  mouth: "viseme" | "synth";
  /** 放下 T-pose 手臂的肩旋转量（弧度，0/缺省=不动）。VRoid 是 T-pose 需要 ~1.0。 */
  armZ?: number;
  /** 署名（CC BY-NC 4.0 的模型需要）；CC0 的留空 */
  credit?: string;
}

/**
 * 可选 3D 模型清单（第一个为默认，即男生「远舟」）。
 * 注意：id（mpfb/rpm/vroid）是持久化键与素材名，勿改；要换称呼只改 name/desc。
 */
export const AVATAR_3D_MODELS: Avatar3DModel[] = [
  {
    id: "mpfb",
    name: "远舟",
    desc: "远舟 · 简约写实的男生（默认）",
    file: "human.glb",
    poster: "head.png",
    frame: { dist: 0.74, aimDrop: 0.11, camRise: 0.04 },
    mouth: "synth",
  },
  {
    id: "rpm",
    name: "林夏",
    desc: "林夏 · 戴眼镜的写实女生",
    file: "rpm.glb",
    poster: "rpm.png",
    frame: { dist: 0.74, aimDrop: 0.11, camRise: 0.04 },
    mouth: "viseme",
    credit: "3D: Ready Player Me · CC BY-NC 4.0",
  },
  {
    id: "vroid",
    name: "小樱",
    desc: "小樱 · 动漫风格的二次元少女",
    file: "vroid.glb",
    poster: "vroid.png",
    frame: { dist: 0.95, aimDrop: 0.05, camRise: 0.02 },
    mouth: "viseme",
    armZ: 1.0,
    credit: "3D: VRoid Studio · CC BY-NC 4.0",
  },
];

/** 默认 3D 模型 id（男生「远舟」，CC0 素材） */
export const DEFAULT_3D_MODEL_ID = "mpfb";

/** 按 id 取模型，找不到回退到默认模型 */
export function get3DModel(id?: string | null): Avatar3DModel {
  return (
    AVATAR_3D_MODELS.find((m) => m.id === id) ??
    AVATAR_3D_MODELS.find((m) => m.id === DEFAULT_3D_MODEL_ID) ??
    AVATAR_3D_MODELS[0]
  );
}

/**
 * 数字人舞台背景候选 —— 复用首页六大景点实景图（`public/destinations/<slug>.jpg`）。
 * 每次打开面板随机选一张当背景（见 DigitalHuman3D）。slug/名称与 showcase-data 的 DEMOS 对齐，
 * 这里只留精简清单，避免把整份 showcase-data 拉进数字人的懒加载 chunk。
 */
export const AVATAR_BACKDROPS: { slug: string; name: string }[] = [
  { slug: "suzhou", name: "苏州" },
  { slug: "kyoto", name: "京都" },
  { slug: "yading", name: "稻城亚丁" },
  { slug: "iceland", name: "冰岛" },
  { slug: "santorini", name: "圣托里尼" },
  { slug: "morocco", name: "摩洛哥" },
];

/** 随机取一张景点背景 */
export function randomBackdrop() {
  return AVATAR_BACKDROPS[Math.floor(Math.random() * AVATAR_BACKDROPS.length)];
}

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
