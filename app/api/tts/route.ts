import { createServerSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * POST /api/tts —— 数字人语音合成（云 TTS）。
 * body: { text: string }  → 返回 audio/mpeg 音频流。
 *
 * 按环境变量自动选 provider（也可用 TTS_PROVIDER 强制）：
 *   - OpenAI 兼容：OPENAI_API_KEY（可选 OPENAI_BASE_URL / TTS_MODEL / TTS_VOICE）
 *   - Azure：AZURE_SPEECH_KEY + AZURE_SPEECH_REGION（可选 AZURE_TTS_VOICE）
 *   - ElevenLabs：ELEVENLABS_API_KEY（可选 ELEVENLABS_VOICE_ID）
 * 都没配置 → 501，前端自动回退到浏览器免费 Web Speech（口型改用「说话中」循环）。
 *
 * 需登录（与 Copilot 一致，避免被匿名滥用）。口型由前端 wawa-lipsync 从返回音频实时分析，
 * 因此与 provider 无关——换任意 TTS 都能对口型。
 */
export async function POST(req: Request) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("未登录", { status: 401 });

  let text = "";
  try {
    const body = await req.json();
    text = typeof body?.text === "string" ? body.text.trim() : "";
  } catch {
    return new Response("请求体不是合法 JSON", { status: 400 });
  }
  if (!text) return new Response("缺少 text", { status: 400 });
  // 控制单次时长/成本：截断超长文本
  if (text.length > 800) text = text.slice(0, 800);

  const provider = pickProvider();
  if (!provider) {
    return new Response("未配置云 TTS（回退 Web Speech）", { status: 501 });
  }

  try {
    const audio = await provider.synth(text);
    return new Response(audio, {
      headers: {
        "Content-Type": provider.mime,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return new Response(`TTS 失败：${e instanceof Error ? e.message : String(e)}`, {
      status: 502,
    });
  }
}

type Synth = (text: string) => Promise<ArrayBuffer>;
/** 合成器 + 它返回音频的 MIME（前端按此建 Blob 播放 + Web Audio 分析响度做口型） */
type Provider = { synth: Synth; mime: string };

/** 按 env 选合成器；返回 null 表示未配置 */
function pickProvider(): Provider | null {
  const forced = (process.env.TTS_PROVIDER || "").toLowerCase();
  const has = (v?: string) => !!v && v.length > 0;

  if (forced === "openai" || (!forced && has(process.env.OPENAI_API_KEY)))
    return has(process.env.OPENAI_API_KEY) ? { synth: openaiTTS, mime: "audio/mpeg" } : null;
  if (forced === "azure" || (!forced && has(process.env.AZURE_SPEECH_KEY)))
    return has(process.env.AZURE_SPEECH_KEY) ? { synth: azureTTS, mime: "audio/mpeg" } : null;
  if (forced === "elevenlabs" || (!forced && has(process.env.ELEVENLABS_API_KEY)))
    return has(process.env.ELEVENLABS_API_KEY) ? { synth: elevenTTS, mime: "audio/mpeg" } : null;
  // 兜底：有 ZenMux key 就用它（OpenAI 兼容 /audio/speech，Gemini-TTS，返回 PCM → 包成 WAV）
  if (forced === "zenmux" || (!forced && has(process.env.ZENMUX_API_KEY)))
    return has(process.env.ZENMUX_API_KEY) ? { synth: zenmuxTTS, mime: "audio/wav" } : null;
  return null;
}

// ── OpenAI 兼容 TTS ──
const openaiTTS: Synth = async (text) => {
  const base = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
  const res = await fetch(`${base}/audio/speech`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: process.env.TTS_MODEL || "gpt-4o-mini-tts",
      voice: process.env.TTS_VOICE || "alloy",
      input: text,
      response_format: "mp3",
    }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
  return res.arrayBuffer();
};

// ── Azure 认知服务 TTS（SSML）──
const azureTTS: Synth = async (text) => {
  const region = process.env.AZURE_SPEECH_REGION;
  if (!region) throw new Error("缺少 AZURE_SPEECH_REGION");
  const voice = process.env.AZURE_TTS_VOICE || "zh-CN-XiaoxiaoNeural";
  const esc = (s: string) =>
    s.replace(/[<>&'"]/g, (c) =>
      ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!,
    );
  const ssml =
    `<speak version="1.0" xml:lang="zh-CN"><voice name="${voice}">${esc(text)}</voice></speak>`;
  const res = await fetch(
    `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`,
    {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": process.env.AZURE_SPEECH_KEY!,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
        "User-Agent": "travel-planner",
      },
      body: ssml,
    },
  );
  if (!res.ok) throw new Error(`Azure ${res.status}: ${await res.text()}`);
  return res.arrayBuffer();
};

// ── ZenMux TTS（OpenAI 兼容 /audio/speech；Gemini-TTS 只吐 PCM，服务端包成 WAV）──
// 用户已有的 ZENMUX_API_KEY 即可发声：比浏览器 Web Speech 好听得多，且走 <audio> 可被
// Web Audio 实时分析响度 → 数字人口型跟着真实语音开合（Web Speech 的声音无法被分析）。
//
// ⚠️ 关键：ZenMux 对 Gemini-TTS 的 `response_format: "pcm"` **不是**返回裸二进制 PCM，
// 而是返回 JSON：{ audio: <base64(PCM L16)>, mime_type: "audio/l16; rate=24000", ... }。
// 之前直接把整段 JSON 文本当成 PCM 塞进 WAF 头 → 浏览器把 JSON 字符串当 16bit 采样播放，
// 结果就是「满量程白噪音、声音巨大」。必须先解 JSON、base64 解码，再包 WAV。
const zenmuxTTS: Synth = async (text) => {
  const base = process.env.ZENMUX_BASE_URL || "https://zenmux.ai/api/v1";
  const res = await fetch(`${base}/audio/speech`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.ZENMUX_API_KEY}`,
    },
    body: JSON.stringify({
      model: process.env.TTS_MODEL || "google/gemini-3.1-flash-tts-preview",
      // 必须用 Gemini 声线（Kore/Aoede/Leda/Puck…），OpenAI 的 alloy 会 500
      voice: process.env.TTS_VOICE || "Kore",
      input: text,
      response_format: "pcm", // Gemini-TTS 仅支持 pcm（24kHz 16bit 单声道）
    }),
  });
  if (!res.ok) throw new Error(`ZenMux ${res.status}: ${await res.text()}`);

  const ct = res.headers.get("content-type") || "";
  let pcm: ArrayBuffer;
  let rate = Number(process.env.TTS_PCM_RATE || 24000);
  if (ct.includes("json")) {
    const json = (await res.json()) as { audio?: string; mime_type?: string };
    if (!json.audio) throw new Error("ZenMux 返回缺少 audio 字段");
    // mime_type 形如 "audio/l16; rate=24000"，采样率以它为准（回退到 env / 24000）
    const m = /rate=(\d+)/.exec(json.mime_type || "");
    if (m) rate = Number(m[1]);
    const b = Buffer.from(json.audio, "base64");
    pcm = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  } else {
    // 兼容将来可能改回裸二进制 PCM 的情况
    pcm = await res.arrayBuffer();
  }
  return pcmToWav(pcm, rate, 1, 16);
};

/** 裸 PCM(小端) → 加 44 字节 WAV 头，浏览器 <audio> 可直接播、Web Audio 可分析 */
function pcmToWav(pcm: ArrayBuffer, sampleRate: number, channels: number, bits: number): ArrayBuffer {
  const bytesPerSample = bits / 8;
  const blockAlign = channels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const out = new ArrayBuffer(44 + pcm.byteLength);
  const v = new DataView(out);
  const put = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i));
  };
  put(0, "RIFF");
  v.setUint32(4, 36 + pcm.byteLength, true);
  put(8, "WAVE");
  put(12, "fmt ");
  v.setUint32(16, 16, true); // PCM fmt chunk size
  v.setUint16(20, 1, true); // audio format = PCM
  v.setUint16(22, channels, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, byteRate, true);
  v.setUint16(32, blockAlign, true);
  v.setUint16(34, bits, true);
  put(36, "data");
  v.setUint32(40, pcm.byteLength, true);
  new Uint8Array(out, 44).set(new Uint8Array(pcm));
  return out;
}

// ── ElevenLabs TTS ──
const elevenTTS: Synth = async (text) => {
  const voiceId = process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM";
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": process.env.ELEVENLABS_API_KEY!,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: process.env.ELEVENLABS_MODEL || "eleven_multilingual_v2",
      }),
    },
  );
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${await res.text()}`);
  return res.arrayBuffer();
};
