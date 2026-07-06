"use client";

/**
 * 数字人（实时 3D 版）——真·实时口型的拟真数字人「小行」。
 *
 * 为什么推倒重来：旧的「视频+口型照片」一开口就把头冻结成静帧、再在 5 张离散嘴形照片间硬切，
 * 所以看着僵硬、对不上。这一版换成**在浏览器里实时渲染的 3D 半身人**（three.js），
 * 说话时头/眼/呼吸继续活着、嘴是**连续变形**而非幻灯片：
 *
 *   - 模型：CC0 的 mpfb.glb（MakeHuman 血统），带完整 ARKit blendshape + 15 个 Oculus viseme
 *     口型（已用 gltf-transform 压到 ~3MB：webp 贴图 + meshopt 几何）。见 public/avatar/xiaoxing/human.glb。
 *   - 口型：说话时用 wawa-lipsync 从 TTS 音频实时识别 viseme——它的命名（viseme_aa/O/E…）与模型的
 *     morph target **完全一致**，直接连续加权驱动对应 morph（外加一点 jawOpen 强调张合），逐字自然。
 *   - 活人细节：程序化眨眼、呼吸（脊椎微动）、头部微摆/点头、视线游移、四种情绪表情 morph。
 *   - 发声：优先云 TTS（/api/tts），失败/未配置回退浏览器 Web Speech；muted 时只动嘴不发声。
 *
 * bubble（右下角 64px 圆头像）不起 WebGL——用一次性渲染好的静帧 head.png，省电、省流量；
 * full（面板 320px 舞台）才跑实时 3D。两者共用命令式接口 speak/stop/setEmotion，CopilotDock 无需改动。
 */

import { useEffect, useRef, useState } from "react";
// three 只做「类型」静态引入（运行时零成本）；实际 three 在 full 模式的 effect 里 **动态 import**，
// 这样 bubble（只显示静帧）与未开数字人的页面都**不会**下载 ~600KB 的 three。
import type * as THREE from "three";
import { Lipsync } from "wawa-lipsync";
import type { DigitalHumanHandle, Emotion } from "./DigitalHuman";
import { PERSONA, DEFAULT_3D_MODEL_ID, get3DModel, randomBackdrop } from "./avatar-config";

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** 15 个 Oculus viseme morph 名（viseme 口型模式下要驱动它们，别的模式回零） */
const VISEME_NAMES = [
  "viseme_sil", "viseme_PP", "viseme_FF", "viseme_TH", "viseme_DD", "viseme_kk",
  "viseme_CH", "viseme_SS", "viseme_nn", "viseme_RR", "viseme_aa", "viseme_E",
  "viseme_I", "viseme_O", "viseme_U",
];

/**
 * 把一整段回复切成便于「边合成边播」的短句：按中英文句末标点断句，太长的句子用逗号/顿号兜底切，
 * 过短的碎片并回上一句。这样第一句能立刻送去合成先响起来，其余句子在播放时并行预取——
 * 首字发声延迟 ≈ 只合成第一句的时间，而不是等整段音频全部合成完。
 */
function splitForSpeech(text: string): string[] {
  const enders = new Set(["。", "！", "？", "!", "?", "…", "\n", "；", ";"]);
  const raw: string[] = [];
  let cur = "";
  for (const ch of text) {
    cur += ch;
    if (enders.has(ch) && cur.trim().length >= 6) {
      raw.push(cur.trim());
      cur = "";
    } else if (cur.length >= 42 && (ch === "，" || ch === "," || ch === "、")) {
      raw.push(cur.trim());
      cur = "";
    }
  }
  if (cur.trim()) raw.push(cur.trim());
  const merged: string[] = [];
  for (const p of raw) {
    const prev = merged[merged.length - 1];
    if (prev && prev.length < 12) merged[merged.length - 1] = prev + p;
    else merged.push(p);
  }
  return merged.length ? merged : [text.trim()];
}

/**
 * 口型「synth」策略（mpfb 专用）：mpfb 自带的 viseme_* 复合 morph 雕得差（一张嘴就把下唇外翻/露怪异嘴腔），
 * 改用干净的 ARKit 基础 morph 由 wawa 的 viseme 分类合成「正常说话」口型——
 *   jawOpen（张颌，主）+ mouthPucker（圆唇 O/U）+ mouthSmile（咧 E/I）。幅度收敛，面板距离下自然。
 * RPM / VRoid 的 viseme 雕刻规范，走「viseme」策略直接驱动 viseme_*（逐音素更准），见组件里的 model.mouth 分支。
 */
const V_JAW: Record<string, number> = {
  viseme_aa: 0.34, viseme_E: 0.24, viseme_I: 0.15, viseme_O: 0.26, viseme_U: 0.12,
  viseme_CH: 0.14, viseme_DD: 0.18, viseme_kk: 0.2, viseme_nn: 0.12, viseme_RR: 0.14,
  viseme_TH: 0.16, viseme_SS: 0.06, viseme_FF: 0.05, viseme_PP: 0.0, viseme_sil: 0.0,
};
const V_ROUND: Record<string, number> = { viseme_O: 0.42, viseme_U: 0.6, viseme_RR: 0.18 };
const V_WIDE: Record<string, number> = {
  viseme_E: 0.26, viseme_I: 0.34, viseme_SS: 0.14, viseme_CH: 0.12, viseme_DD: 0.1,
};

/** 四种情绪 → 一组 ARKit 表情 morph 的目标权重（口型部分说话时会被压低，让 viseme 读出来） */
const EXPR: Record<Emotion, Record<string, number>> = {
  idle: { mouthSmileLeft: 0.14, mouthSmileRight: 0.14, browInnerUp: 0.04 },
  thinking: {
    browDownLeft: 0.38, browInnerUp: 0.16, mouthPressLeft: 0.16,
    eyeSquintLeft: 0.12, eyeSquintRight: 0.12,
  },
  happy: {
    mouthSmileLeft: 0.6, mouthSmileRight: 0.6, cheekSquintLeft: 0.45, cheekSquintRight: 0.45,
    eyeSquintLeft: 0.28, eyeSquintRight: 0.28, browInnerUp: 0.1,
  },
  concerned: {
    browInnerUp: 0.58, mouthFrownLeft: 0.34, mouthFrownRight: 0.34, browDownLeft: 0.12,
  },
};
/** 属于「嘴部」的表情 morph（说话时压低，避免和 viseme 打架） */
const MOUTH_EXPR = new Set([
  "mouthSmileLeft", "mouthSmileRight", "mouthFrownLeft", "mouthFrownRight",
  "mouthPressLeft", "mouthPressRight", "mouthPucker",
]);

/** 情绪 → 头姿 + 视线（gaze 为归一化 [x 右为正, y 上为正]） */
const POSE: Record<Emotion, { tiltZ: number; pitchX: number; gaze: [number, number] | null }> = {
  idle: { tiltZ: 0, pitchX: 0, gaze: null },
  thinking: { tiltZ: 0.05, pitchX: -0.05, gaze: [0.35, 0.28] },
  happy: { tiltZ: -0.02, pitchX: 0.03, gaze: [0, 0] },
  concerned: { tiltZ: 0.01, pitchX: -0.04, gaze: [0, -0.12] },
};

/** 情绪表情涉及的所有 morph（各模型共用） */
const EXPR_MORPHS = Array.from(new Set(Object.values(EXPR).flatMap((e) => Object.keys(e))));
const BLINK_MORPHS = ["eyeBlinkLeft", "eyeBlinkRight"];
/** synth 口型合成用 morph */
const SYNTH_MOUTH = ["jawOpen", "mouthPucker", "mouthSmileLeft", "mouthSmileRight"];
/**
 * 视线用 ARKit eyeLook morph（**不转眼骨**）：不同模型（尤其 VRoid/VRM）眼骨局部轴向千奇百怪，
 * 直接转 bone.rotation.y 会绕歪轴、左右眼发散→眼睛偏一边。改用 morph 与骨骼朝向无关，三模型统一居中。
 */
const EYE_LOOK = [
  "eyeLookInLeft", "eyeLookOutLeft", "eyeLookUpLeft", "eyeLookDownLeft",
  "eyeLookInRight", "eyeLookOutRight", "eyeLookUpRight", "eyeLookDownRight",
];

/** 帧间共享状态：命令式接口写、rAF 读 */
interface Shared {
  emotion: Emotion;
  speaking: boolean;
  mode: "audio" | "procedural" | null;
  lipsync: Lipsync | null;
  audio: HTMLAudioElement | null;
}

export default function DigitalHuman3D({
  apiRef,
  muted = false,
  variant = "full",
  modelId,
  onSpeakingChange,
  onError,
}: {
  apiRef: React.MutableRefObject<DigitalHumanHandle | null>;
  muted?: boolean;
  variant?: "full" | "bubble";
  /** 选哪个 3D 模型（远舟/林夏/小樱）；缺省用默认 */
  modelId?: string;
  onSpeakingChange?: (speaking: boolean) => void;
  onError?: (msg: string) => void;
}) {
  const model = get3DModel(modelId ?? DEFAULT_3D_MODEL_ID);
  const mutedRef = useRef(muted);
  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  const [reducedMotion] = useState(
    () =>
      typeof window !== "undefined" &&
      !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
  );

  // 每次打开面板（本组件挂载）随机选一张首页景点图当舞台背景
  const [backdrop] = useState(randomBackdrop);

  const shared = useRef<Shared>({
    emotion: "idle",
    speaking: false,
    mode: null,
    lipsync: null,
    audio: null,
  });

  // 每次 speak 递增；流水线里的循环靠它判断自己是否被新一轮朗读/停止顶掉（stale → 立刻退出）
  const speakSeq = useRef(0);

  const hostRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    variant === "bubble" ? "ready" : "loading",
  );

  // ── 复用同一个 <audio>（wawa connectAudio 对同一元素幂等） ──
  useEffect(() => {
    const audio = new Audio();
    audio.crossOrigin = "anonymous";
    shared.current.audio = audio;
    return () => {
      audio.pause();
      audio.src = "";
    };
  }, []);

  // ── three.js 场景（仅 full 变体跑实时 3D；bubble 用静帧） ──
  useEffect(() => {
    if (variant === "bubble") return;
    const host = hostRef.current;
    if (!host) return;

    let disposed = false;
    let contextLost = false;
    let raf = 0;
    let renderer: THREE.WebGLRenderer | null = null;
    let ro: ResizeObserver | null = null;

    (async () => {
      // 动态引入 three（+ GLTF/meshopt 解码器），只有真正要跑 3D 时才下载
      const [T, { GLTFLoader }, { MeshoptDecoder }] = await Promise.all([
        import("three"),
        import("three/examples/jsm/loaders/GLTFLoader.js"),
        import("three/examples/jsm/libs/meshopt_decoder.module.js"),
      ]);
      if (disposed) return;

      const scene = new T.Scene();
      const camera = new T.PerspectiveCamera(30, 1, 0.01, 100);

      renderer = new T.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.outputColorSpace = T.SRGBColorSpace;
      renderer.toneMapping = T.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.15;
      const canvas = renderer.domElement;
      canvas.style.width = "100%";
      canvas.style.height = "100%";
      canvas.style.display = "block";
      host.appendChild(canvas);

      // WebGL 上下文丢失（GPU 驱动重置 / 显存吃紧 / 标签页切后台太久）：不要静默留一张空画布
      // 盖在景照上——标记出错、停掉渲染循环，让下面的静帧立绘顶上来，保证「人」始终可见。
      canvas.addEventListener(
        "webglcontextlost",
        (e) => {
          e.preventDefault();
          contextLost = true;
          cancelAnimationFrame(raf);
          setStatus("error");
        },
        false,
      );

      // 灯光：暖主光 + 正面柔补，肤色健康；青/紫极光边缘光从背后侧打，只勾轮廓不泛脸（避免绿脸）
      scene.add(new T.HemisphereLight(0xeef0ff, 0x2a1a30, 0.7));
      const key = new T.DirectionalLight(0xfff2e2, 1.9);
      key.position.set(0.5, 1.0, 1.6);
      scene.add(key);
      const fill = new T.DirectionalLight(0xfff6ee, 0.5);
      fill.position.set(-0.8, 0.2, 1.2);
      scene.add(fill);
      const teal = new T.DirectionalLight(0x2fd4c6, 0.55);
      teal.position.set(-1.6, 0.7, -1.0);
      scene.add(teal);
      const violet = new T.DirectionalLight(0x8f7cff, 0.5);
      violet.position.set(1.5, 0.5, -1.1);
      scene.add(violet);

      const resize = () => {
        if (!renderer) return;
        const w = host.clientWidth || 1;
        const h = host.clientHeight || 1;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      };
      resize();
      ro = new ResizeObserver(resize);
      ro.observe(host);

      const loader = new GLTFLoader();
      loader.setMeshoptDecoder(MeshoptDecoder);

      loader.load(
        `${PERSONA.dir}/${model.file}`,
        (gltf) => {
          if (disposed) return;
          const root = gltf.scene;
          scene.add(root);

          // 本模型这轮实际驱动的 morph 集合（viseme 模式驱动 viseme_*；synth 模式驱动合成口型）
          const driven = Array.from(new Set([
            ...BLINK_MORPHS,
            ...EYE_LOOK,
            ...EXPR_MORPHS,
            ...(model.mouth === "viseme" ? VISEME_NAMES : SYNTH_MOUTH),
          ]));

          // 收集所有带 morph 的网格，建立 morph 名 → 各网格影响项列表
          const morphTargets: Record<string, { infl: number[]; idx: number }[]> = {};
          root.traverse((o) => {
            const m = o as THREE.Mesh;
            if (m.isMesh) {
              m.frustumCulled = false; // 蒙皮+morph 的包围盒易误裁
              const dict = m.morphTargetDictionary;
              const infl = m.morphTargetInfluences;
              if (dict && infl) {
                for (const name of Object.keys(dict)) {
                  (morphTargets[name] ??= []).push({ infl, idx: dict[name] });
                }
              }
            }
          });
          const setMorph = (name: string, v: number) => {
            const list = morphTargets[name];
            if (list) for (const e of list) e.infl[e.idx] = v;
          };

          // 关键骨骼 + 记录静息旋转（每帧在其基础上叠加偏移）
          const bone = (n: string) => root.getObjectByName(n) as THREE.Bone | undefined;
          const head = bone("Head");
          const neck = bone("Neck");
          const spine2 = bone("Spine2");
          const eyeL = bone("LeftEye");
          const eyeR = bone("RightEye");
          const rest = new Map<THREE.Object3D, THREE.Euler>();
          for (const b of [head, neck, spine2, eyeL, eyeR]) {
            if (b) rest.set(b, b.rotation.clone());
          }
          const addRot = (b: THREE.Object3D | undefined, dx: number, dy: number, dz: number) => {
            if (!b) return;
            const r = rest.get(b)!;
            b.rotation.set(r.x + dx, r.y + dy, r.z + dz, r.order);
          };

          // 相机取景：以双眼中点为基准对准（头肩景），比头骨原点更贴近「脸」
          root.updateWorldMatrix(true, true);
          const faceCenter = new T.Vector3();
          if (eyeL && eyeR) {
            const a = new T.Vector3();
            const b = new T.Vector3();
            eyeL.getWorldPosition(a);
            eyeR.getWorldPosition(b);
            faceCenter.addVectors(a, b).multiplyScalar(0.5);
          } else {
            (head ?? root).getWorldPosition(faceCenter);
          }
          const F = model.frame;
          camera.position.set(faceCenter.x, faceCenter.y + F.camRise, faceCenter.z + F.dist);
          camera.lookAt(faceCenter.x, faceCenter.y - F.aimDrop, faceCenter.z);

          // 放下 T-pose 手臂（VRoid 是 T 字站姿，把上臂朝下转一点更像自然站像）
          if (model.armZ) {
            const la = root.getObjectByName("LeftArm");
            const ra = root.getObjectByName("RightArm");
            if (la) la.rotation.z += model.armZ;
            if (ra) ra.rotation.z -= model.armZ;
          }

          // 逐帧收敛用的当前 morph 值
          const cur: Record<string, number> = {};
          for (const n of driven) cur[n] = 0;

          const blink = { next: 1 + Math.random() * 2, active: false, start: 0 };
          const wander = { next: 2, x: 0, y: 0 };
          const t0 = performance.now();
          // 只有真正画出第一帧后才置 ready（据此撤下静帧兜底）。若某些驱动能建上下文却渲不出画面，
          // 就永远到不了这里，兜底立绘会一直显示，而不是露出一张没有人的空画布。
          let firstFrame = true;

          const tick = (now: number) => {
            if (disposed || contextLost) return;
            const t = (now - t0) / 1000;
            const s = shared.current;
            const sp = s.speaking;
            const E = EXPR[s.emotion] ?? EXPR.idle;
            const P = POSE[s.emotion] ?? POSE.idle;
            const amp = reducedMotion ? 0 : 1;

            // ── 目标 morph ──
            const target: Record<string, number> = {};
            for (const n of driven) target[n] = 0;
            // 情绪表情（说话时压低嘴部表情，让口型读得出来）
            for (const [name, val] of Object.entries(E)) {
              if (target[name] === undefined) continue; // 该模型没这个 morph 就跳过
              target[name] = sp && MOUTH_EXPR.has(name) ? val * 0.35 : val;
            }
            // 口型
            if (sp) {
              let v = "viseme_sil";
              let proc = 0; // 程序化幅度（无音频时）
              if (s.mode === "audio" && s.lipsync && s.audio && !s.audio.paused) {
                try {
                  s.lipsync.processAudio();
                  v = s.lipsync.viseme as unknown as string;
                } catch {
                  v = "viseme_aa";
                }
              } else {
                // 程序化（静音 / Web Speech 回退）：按时间轮换几个口型 + 正弦幅度
                proc = (0.35 + 0.65 * Math.abs(Math.sin(t * 9.5))) * (0.7 + 0.3 * Math.sin(t * 2.3));
                v = ["viseme_aa", "viseme_O", "viseme_E"][Math.floor(t * 5) % 3];
              }
              if (model.mouth === "viseme") {
                // 直接驱动模型自带 viseme_*（RPM/VRoid 雕刻好）
                if (v !== "viseme_sil") target[v] = proc || 1;
              } else {
                // synth：jawOpen + 圆唇/咧嘴合成（mpfb）。proc 只是 0..1 的幅度包络，不能直接
                // 灌进 jawOpen——V_JAW 标定上限才 0.34，灌到 1.0 下颌会张到变形（线上未配云 TTS
                // 走 Web Speech 回退时远舟嘴崩坏的根因）。程序化模式改为用包络调制标定幅度，
                // 与音频驱动同一量程；音频模式（proc=0）行为不变。
                const k = proc ? 0.35 + 0.65 * proc : 1;
                target.jawOpen = (V_JAW[v] || 0.14) * k;
                target.mouthPucker = Math.max(target.mouthPucker, (V_ROUND[v] || 0) * k);
                target.mouthSmileLeft = Math.max(target.mouthSmileLeft, (V_WIDE[v] || 0) * k);
                target.mouthSmileRight = Math.max(target.mouthSmileRight, (V_WIDE[v] || 0) * k);
              }
            }

            // 视线（eyeLook morph，不转眼骨）：情绪指定 or 自由游移（多数时间看向用户）
            let gx = P.gaze ? P.gaze[0] : wander.x;
            let gy = P.gaze ? P.gaze[1] : wander.y;
            if (!P.gaze && t > wander.next) {
              wander.next = t + 2.4 + Math.random() * 2.8;
              if (Math.random() < 0.6) {
                wander.x = 0;
                wander.y = 0;
              } else {
                wander.x = (Math.random() * 2 - 1) * 0.4;
                wander.y = (Math.random() * 2 - 1) * 0.22;
              }
              gx = wander.x;
              gy = wander.y;
            }
            // gx>0 看向屏幕右、gy>0 看上；左右眼分别用 In/Out 达成同向注视，morph lerp 会平滑
            const gR = Math.max(0, gx);
            const gL = Math.max(0, -gx);
            const gU = Math.max(0, gy);
            const gD = Math.max(0, -gy);
            target.eyeLookOutLeft = gR;
            target.eyeLookInRight = gR;
            target.eyeLookInLeft = gL;
            target.eyeLookOutRight = gL;
            target.eyeLookUpLeft = gU;
            target.eyeLookUpRight = gU;
            target.eyeLookDownLeft = gD;
            target.eyeLookDownRight = gD;

            // 收敛（口型 morph 快，表情慢）；眨眼另算。说话时口型收敛拉满，尽量贴着音频不拖影。
            for (const n of driven) {
              const fast = n.startsWith("viseme_") || SYNTH_MOUTH.includes(n);
              cur[n] = lerp(cur[n], target[n], fast ? (sp ? 0.6 : 0.3) : 0.14);
            }

            // 眨眼（覆盖式，要脆）
            const b = blink;
            if (!b.active && t > b.next) {
              b.active = true;
              b.start = t;
            }
            let blinkV = 0;
            if (b.active) {
              const p = (t - b.start) / 0.16;
              blinkV = p < 0.5 ? p * 2 : Math.max(0, 1 - (p - 0.5) * 2);
              if (p >= 1) {
                b.active = false;
                b.next = t + 2 + Math.random() * 3.5;
              }
            }
            cur.eyeBlinkLeft = blinkV;
            cur.eyeBlinkRight = blinkV;

            for (const n of driven) setMorph(n, cur[n]);

            // ── 头/颈/呼吸/视线 ──
            const bob = Math.sin(t * 0.9) * 0.02 * amp;
            const swayY = Math.sin(t * 0.55) * 0.03 * amp;
            const rollZ = Math.sin(t * 0.4) * 0.014 * amp;
            const nod = sp && !reducedMotion ? Math.sin(t * 6.2) * 0.012 : 0;
            addRot(head, P.pitchX + bob + nod, swayY, P.tiltZ + rollZ);
            addRot(neck, (P.pitchX + bob) * 0.4, swayY * 0.5, rollZ * 0.5);
            // 呼吸：脊椎极轻微俯仰
            addRot(spine2, Math.sin(t * 1.05) * 0.01 * amp, 0, 0);

            renderer!.render(scene, camera);
            if (firstFrame) {
              firstFrame = false;
              setStatus("ready");
            }
            raf = requestAnimationFrame(tick);
          };
          raf = requestAnimationFrame(tick);
        },
        undefined,
        (err) => {
          if (disposed) return;
          setStatus("error");
          onError?.(`数字人模型加载失败：${err instanceof Error ? err.message : String(err)}`);
        },
      );
    })().catch((e) => {
      // 动态 import / WebGL 创建失败（如 WebGL 不可用）→ 异步置错，绝不黑屏
      queueMicrotask(() => setStatus("error"));
      onError?.(e instanceof Error ? e.message : String(e));
    });

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro?.disconnect();
      if (renderer) {
        renderer.dispose();
        renderer.forceContextLoss?.();
        renderer.domElement.remove();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variant, reducedMotion, modelId]);

  // ── 命令式接口：speak / stop / setEmotion（与视频/SVG 版一致） ──
  function setSpeaking(v: boolean) {
    shared.current.speaking = v;
    onSpeakingChange?.(v);
  }

  function stopSpeaking() {
    speakSeq.current++; // 作废正在跑的朗读流水线（正在 await 的分句循环会据此立即退出）
    try {
      shared.current.audio?.pause();
    } catch {
      /* ignore */
    }
    if (typeof window !== "undefined") window.speechSynthesis?.cancel();
    shared.current.mode = null;
    setSpeaking(false);
  }

  function webSpeech(text: string) {
    const s = shared.current;
    if (typeof window === "undefined" || !window.speechSynthesis) {
      s.mode = "procedural";
      setSpeaking(true);
      const ms = Math.min(12000, 800 + text.length * 90);
      setTimeout(() => setSpeaking(false), ms);
      return;
    }
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "zh-CN";
    s.mode = "procedural";
    setSpeaking(true);
    u.onend = () => setSpeaking(false);
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  }

  function setEmotion(e: Emotion) {
    shared.current.emotion = e;
  }

  /** 合成一句 → objectURL（失败/非 200 返回 null，由调用方决定兜底）。 */
  async function ttsToUrl(chunk: string): Promise<string | null> {
    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: chunk }),
      });
      if (!res.ok) return null;
      const buf = await res.arrayBuffer();
      const mime = res.headers.get("content-type") || "audio/mpeg";
      return URL.createObjectURL(new Blob([buf], { type: mime }));
    } catch {
      return null;
    }
  }

  /** 在复用的 <audio> 上放一句，播完（或被顶掉/出错）即 resolve；始终回收该句的 objectURL。 */
  function playChunk(url: string, seq: number): Promise<void> {
    const s = shared.current;
    const audio = s.audio!;
    return new Promise<void>((resolve) => {
      let settled = false;
      let watch = 0;
      const done = () => {
        if (settled) return;
        settled = true;
        clearInterval(watch);
        audio.removeEventListener("ended", done);
        audio.removeEventListener("error", done);
        URL.revokeObjectURL(url);
        resolve();
      };
      audio.addEventListener("ended", done);
      audio.addEventListener("error", done);
      // 被 stop/新一轮 speak 顶掉时 pause 不一定触发 ended，用轮询兜底及时收尾
      watch = window.setInterval(() => {
        if (seq !== speakSeq.current) done();
      }, 100);

      audio.src = url;
      // ★关键顺序：**先设 src、再 connectAudio**。wawa 的 connectAudio 里若 audio.src 还空，
      // 会直接告警 return 且把 audioSource 标记掉，导致 MediaElementSource / 分析器**永远建不起来**，
      // processAudio() 永远读到静音 → 嘴几乎不动/严重滞后（这就是「发了声嘴才慢半拍」的根因）。
      // 现在等 src 就位再连，wawa 才会 createMediaElementSource→analyser→destination，口型实时贴合音频。
      const ctx = (s.lipsync as unknown as { audioContext?: AudioContext }).audioContext;
      try {
        s.lipsync?.connectAudio(audio); // 首句真正建源；之后同一元素会被 wawa 幂等跳过
      } catch {
        /* createMediaElementSource 仅能建一次；异常则退化为程序化口型 */
      }
      s.mode = "audio";
      // MediaElementSource 接管后音频改走 Web Audio 图；context 若挂起会「有口型没声音」，
      // 必须先 resume 再 play。resume 通常瞬时完成（send 按钮的用户手势带来 sticky activation）。
      Promise.resolve(ctx?.resume?.())
        .catch(() => {})
        .then(() => {
          if (seq !== speakSeq.current) {
            done();
            return;
          }
          audio.play().catch(done);
        });
    });
  }

  async function speak(text: string) {
    const content = text.trim();
    if (!content) return;
    stopSpeaking();
    const s = shared.current;

    if (mutedRef.current) {
      s.mode = "procedural";
      setSpeaking(true);
      const ms = Math.min(12000, 800 + content.length * 90);
      setTimeout(() => setSpeaking(false), ms);
      return;
    }

    const seq = ++speakSeq.current;
    const stale = () => seq !== speakSeq.current;
    // 丢弃预取但用不上的音频，避免 objectURL 泄漏（ttsToUrl 从不 reject）
    const drop = (p: Promise<string | null>) => {
      void p.then((u) => {
        if (u) URL.revokeObjectURL(u);
      });
    };

    // 只创建 Lipsync 实例（内部会建 AudioContext）；**不在此处 connectAudio**——
    // wawa 要求连接时 audio.src 已设置，否则白连。真正的连接推迟到 playChunk 里 src 就位后做。
    if (!s.lipsync) s.lipsync = new Lipsync();

    // 分句流水线：**立刻**起第一句合成（不被任何 await 挡在前面），播每句时并行预取下一句
    // → 首字发声 ≈ 只等第一句的合成延迟，而不是整段。
    const chunks = splitForSpeech(content);
    let pending = ttsToUrl(chunks[0]);
    try {
      for (let i = 0; i < chunks.length; i++) {
        const url = await pending;
        if (stale()) {
          if (url) URL.revokeObjectURL(url);
          return;
        }
        pending =
          i + 1 < chunks.length ? ttsToUrl(chunks[i + 1]) : Promise.resolve(null);
        if (!url) {
          // 云 TTS 这句失败 → 余下整段交给浏览器 Web Speech 兜底
          drop(pending);
          webSpeech(chunks.slice(i).join(""));
          return;
        }
        setSpeaking(true);
        await playChunk(url, seq);
        if (stale()) {
          drop(pending);
          return;
        }
      }
    } catch (e) {
      drop(pending);
      onError?.(e instanceof Error ? e.message : String(e));
      if (!stale()) webSpeech(content);
      return;
    }
    if (stale()) return;
    s.mode = null;
    setSpeaking(false);
  }

  useEffect(() => {
    apiRef.current = { speak, stop: stopSpeaking, setEmotion };
    return () => {
      apiRef.current = null;
    };
  });

  // ── bubble：静帧头像（不起 WebGL） ──
  if (variant === "bubble") {
    return (
      <div className="relative h-full w-full overflow-hidden bg-[linear-gradient(160deg,#1b2456,#0b1124)]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`${PERSONA.dir}/${model.poster}`}
          alt="数字人小行"
          draggable={false}
          className="absolute inset-0 h-full w-full select-none object-cover dh-breathe"
          style={{ objectPosition: "50% 42%" }}
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = "none";
          }}
        />
      </div>
    );
  }

  // ── full：实时 3D 舞台 ──
  return (
    <div
      className="relative h-full w-full overflow-hidden bg-[linear-gradient(160deg,#1b2456,#0b1124)]"
      role="img"
      aria-label={`数字人${PERSONA.name}`}
    >
      {/* 舞台背景：完整呈现整张竖构图景照（山巅/天空/前景都在，不再只截中间一条）。
          景照是竖图、舞台是横向，直接 object-cover 会裁掉上下的主体——改为两层：
          底层模糊放大铺满，填掉左右留白避免黑边；上层 object-contain 缩小到完整可见。 */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/destinations/${backdrop.slug}.jpg`}
        alt=""
        aria-hidden
        draggable={false}
        className="pointer-events-none absolute inset-0 h-full w-full select-none object-cover"
        style={{ transform: "scale(1.2)", filter: "blur(26px) saturate(0.8) brightness(0.7)" }}
        onError={(e) => {
          (e.currentTarget as HTMLImageElement).style.display = "none";
        }}
      />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/destinations/${backdrop.slug}.jpg`}
        alt=""
        aria-hidden
        draggable={false}
        className="pointer-events-none absolute inset-0 h-full w-full select-none object-contain"
        style={{ filter: "blur(1.2px) saturate(0.95) brightness(0.9)" }}
        onError={(e) => {
          (e.currentTarget as HTMLImageElement).style.display = "none";
        }}
      />
      {/* 暮色遮罩：压暗景照、突出人物；底部更深托肩/署名 */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "linear-gradient(180deg, rgba(11,17,36,0.5) 0%, rgba(11,17,36,0.22) 38%, rgba(11,17,36,0.44) 66%, rgba(11,17,36,0.85) 100%)",
        }}
      />
      {/* 一缕极光维持品牌调性 */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-10 top-0 h-36 w-52 rounded-full bg-[#2fd4c6]/15 blur-3xl" />
        <div className="absolute right-0 top-4 h-40 w-52 rounded-full bg-[#7c6bff]/15 blur-3xl" />
      </div>
      {/* 静态形象兜底：实时 3D 还没画出第一帧（加载中）或 WebGL 出错/丢上下文时，用该模型的
          静帧立绘顶上——保证「数字人形象」在任何环境（无 WebGL/驱动异常/切模型间隙）下都可见，
          而不是只剩景照或一行报错。画出首帧（status==="ready"）后即撤下，让透明画布露出景深背景。 */}
      {status !== "ready" && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`${PERSONA.dir}/${model.poster}`}
          alt={`数字人${PERSONA.name}`}
          draggable={false}
          className="pointer-events-none absolute inset-0 h-full w-full select-none object-cover"
          style={{ objectPosition: "50% 36%" }}
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = "none";
          }}
        />
      )}
      <div ref={hostRef} className="absolute inset-0" />
      {/* 当前背景地名（右上角，与左上角模型选择器呼应） */}
      <div className="pointer-events-none absolute right-2 top-2 select-none rounded-full bg-[#0b1124]/45 px-2 py-0.5 text-[10px] text-white/75 backdrop-blur">
        {backdrop.name}
      </div>
      {status === "loading" && (
        <div className="pointer-events-none absolute inset-x-0 bottom-2 flex items-center justify-center gap-1.5 text-[10px] text-white/70">
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/25 border-t-[#2fd4c6]" />
          实时形象加载中…
        </div>
      )}
      {status === "error" && (
        <div className="pointer-events-none absolute inset-x-0 bottom-2 flex items-center justify-center px-4 text-center text-[10px] text-white/70">
          <span className="rounded-full bg-[#0b1124]/55 px-2 py-0.5 backdrop-blur">
            实时形象暂不可用，已用静态形象
          </span>
        </div>
      )}
      {/* 模型署名（CC BY-NC 4.0 的模型需要） */}
      {status === "ready" && model.credit && (
        <div className="pointer-events-none absolute bottom-1 left-2 select-none text-[9px] leading-none text-white/35">
          {model.credit}
        </div>
      )}
    </div>
  );
}
