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
    const audio = await provider(text);
    return new Response(audio, {
      headers: {
        "Content-Type": "audio/mpeg",
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

/** 按 env 选合成器；返回 null 表示未配置 */
function pickProvider(): Synth | null {
  const forced = (process.env.TTS_PROVIDER || "").toLowerCase();
  const has = (v?: string) => !!v && v.length > 0;

  if (forced === "openai" || (!forced && has(process.env.OPENAI_API_KEY)))
    return has(process.env.OPENAI_API_KEY) ? openaiTTS : null;
  if (forced === "azure" || (!forced && has(process.env.AZURE_SPEECH_KEY)))
    return has(process.env.AZURE_SPEECH_KEY) ? azureTTS : null;
  if (forced === "elevenlabs" || (!forced && has(process.env.ELEVENLABS_API_KEY)))
    return has(process.env.ELEVENLABS_API_KEY) ? elevenTTS : null;
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
