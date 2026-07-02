/**
 * 可插拔文本向量化（RAG 的 E）。
 *
 * 设计取舍：与本项目其余 Tier 一致——【零 key 也能离线跑/测】。
 *   - 默认：确定性本地 embedding（feature hashing），无需任何 API，同文本恒等向量，
 *     基于词/字 n-gram，词面重叠越多越相似——足以演示相关性召回与离线回归。
 *   - 生产：配置 EMBED_API（OpenAI 兼容 /embeddings）即自动切换为真实语义向量，
 *     其余检索/巩固逻辑完全不变（向量维度以本地 DIM 对齐或走 remote 维度均可）。
 *
 * 存储：向量以 float 数组存 jsonb，检索在应用层做 cosine 排序（可移植、可测）。
 * 规模化路径：换 pgvector 的 vector 列 + ivfflat 索引 + match RPC，仅改 store 一处。
 */

export const DIM = 256;

/** 本地确定性向量的模型标识（用于给记忆打标，识别向量空间是否一致） */
export const LOCAL_MODEL = `local-fnv-${DIM}`;

/**
 * 当前生效的 embedding 模型标识。切换 provider 会改变向量空间——
 * 记忆按此标记，跨空间的旧记忆需重嵌后才能与新查询比较（见 store.recall 自愈）。
 */
export function currentEmbedModel(): string {
  const model = process.env.EMBED_MODEL;
  const base = process.env.EMBED_API_BASE;
  const key = process.env.EMBED_API_KEY;
  return model && base && key ? `remote:${model}` : LOCAL_MODEL;
}

const norm = (s: string) => s.toLowerCase().trim();

/** 分词：英文/数字词 + 中日字符单字 + 相邻中日字符 bigram（对中文有效） */
function tokenize(text: string): string[] {
  const t = norm(text);
  const words = t.match(/[a-z0-9]+/g) ?? [];
  const cjk = t.match(/[一-鿿぀-ヿ]/g) ?? [];
  const bigrams: string[] = [];
  for (let i = 0; i < cjk.length - 1; i++) bigrams.push(cjk[i] + cjk[i + 1]);
  return [...words, ...cjk, ...bigrams];
}

/** 稳定字符串哈希（FNV-1a 变体） */
function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** 确定性本地 embedding：feature hashing + 符号哈希 + L2 归一化 */
export function localEmbed(text: string): number[] {
  const v = new Array<number>(DIM).fill(0);
  const toks = tokenize(text);
  for (const tok of toks) {
    const hh = hash(tok);
    const idx = hh % DIM;
    const sign = (hh >>> 16) & 1 ? 1 : -1; // 符号哈希，降低碰撞偏置
    v[idx] += sign;
  }
  let mag = 0;
  for (const x of v) mag += x * x;
  mag = Math.sqrt(mag) || 1;
  return v.map((x) => x / mag);
}

/** 远端 embedding（OpenAI 兼容 /embeddings）；未配置则返回 null，由调用方回退本地 */
async function remoteEmbed(text: string): Promise<number[] | null> {
  const base = process.env.EMBED_API_BASE;
  const key = process.env.EMBED_API_KEY;
  const model = process.env.EMBED_MODEL;
  if (!base || !key || !model) return null;
  try {
    const res = await fetch(`${base}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ model, input: text }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      data?: { embedding?: number[] }[];
    };
    const emb = data.data?.[0]?.embedding;
    return Array.isArray(emb) && emb.length ? emb : null;
  } catch {
    return null;
  }
}

/** 对外统一入口：优先远端真实向量，回退确定性本地向量（永不抛、永不空） */
export async function embed(text: string): Promise<number[]> {
  return (await remoteEmbed(text)) ?? localEmbed(text);
}

/** 批量 embedding（逐条；远端可日后改批量接口） */
export async function embedMany(texts: string[]): Promise<number[][]> {
  return Promise.all(texts.map(embed));
}
