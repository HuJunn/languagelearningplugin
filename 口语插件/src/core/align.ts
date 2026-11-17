import type { Cue, Word } from './types';
import { interpolateCue, tokenizeCueText } from './captions';

/** 归一化用于比较：小写、只保留字母数字（$10,000 和 10,000 视为相同） */
export function normToken(t: string): string {
  return t
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^\p{L}\p{N}']/gu, '')
    .replace(/^'+|'+$/g, '');
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** 0~1 的相似度 */
export function similarity(a: string, b: string): number {
  const x = normToken(a);
  const y = normToken(b);
  if (!x && !y) return 1;
  if (!x || !y) return 0;
  if (x === y) return 1;
  return 1 - levenshtein(x, y) / Math.max(x.length, y.length);
}

const GAP = 0.75; // 插入/删除的代价；替换代价 = 1 - 相似度（<= 1 < 2*GAP，所以一对一替换优先）
const MATCH_SIM = 0.8; // 相似度达到这个值算"相同"

export interface AlignStats {
  total: number;
  matched: number;
  substituted: number;
  interpolated: number;
}

/**
 * 人工字幕 + 自动字幕对齐：文本用人工字幕，时间用自动字幕的逐词时间。
 *
 * 对每一行人工字幕，取时间窗口内的 ASR 词做半全局对齐（两端可以跳过 ASR 词，不计代价）：
 * - 相同的词（相似度 >= 0.8）：直接用 ASR 时间
 * - 一对一替换（ASR 识别错了）：用人工字幕的文本 + ASR 的时间
 * - 人工字幕多出来的词：在前后两个有时间的词之间按字符数插值
 */
export function alignManualToAsr(cues: Cue[], asr: Word[], windowPad = 1.5): { words: Word[]; stats: AlignStats } {
  const out: Word[] = [];
  const stats: AlignStats = { total: 0, matched: 0, substituted: 0, interpolated: 0 };
  let asrFloor = 0; // 保证单调：后面的行只能用之前没用过的 ASR 词

  for (const cue of cues) {
    const tokens = tokenizeCueText(cue.text);
    if (!tokens.length) continue;
    stats.total += tokens.length;

    // 候选 ASR 词
    let lo = asrFloor;
    while (lo < asr.length && asr[lo].start < cue.start - windowPad) lo++;
    let hi = lo;
    while (hi < asr.length && asr[hi].start <= cue.end + windowPad) hi++;
    const cand = asr.slice(lo, hi);

    if (!cand.length) {
      const ws = interpolateCue(cue, tokens);
      stats.interpolated += ws.length;
      out.push(...ws);
      continue;
    }

    const n = tokens.length;
    const m = cand.length;
    // dp[i][j]：前 i 个人工词与前 j 个 ASR 词的最小代价；dp[0][j] = 0（开头可跳过 ASR）
    const dp: Float64Array[] = Array.from({ length: n + 1 }, () => new Float64Array(m + 1));
    const bt: Uint8Array[] = Array.from({ length: n + 1 }, () => new Uint8Array(m + 1)); // 1=diag 2=up(人工多) 3=left(ASR多)
    for (let i = 1; i <= n; i++) {
      dp[i][0] = i * GAP;
      bt[i][0] = 2;
    }
    for (let j = 1; j <= m; j++) bt[0][j] = 3;
    const sims: number[][] = [];
    for (let i = 1; i <= n; i++) {
      sims[i] = [];
      for (let j = 1; j <= m; j++) {
        const s = similarity(tokens[i - 1], cand[j - 1].text);
        sims[i][j] = s;
        const diag = dp[i - 1][j - 1] + (s >= MATCH_SIM ? 0 : 1 - s * 0.5);
        const up = dp[i - 1][j] + GAP;
        const left = dp[i][j - 1] + GAP;
        if (diag <= up && diag <= left) {
          dp[i][j] = diag;
          bt[i][j] = 1;
        } else if (up <= left) {
          dp[i][j] = up;
          bt[i][j] = 2;
        } else {
          dp[i][j] = left;
          bt[i][j] = 3;
        }
      }
    }
    // 结尾可跳过 ASR：取最后一行最小值
    let bestJ = 0;
    for (let j = 1; j <= m; j++) if (dp[n][j] < dp[n][bestJ]) bestJ = j;

    const map: number[] = new Array(n).fill(-1); // 人工词 -> 候选 ASR 下标
    const kind: ('match' | 'sub' | 'none')[] = new Array(n).fill('none');
    let i = n;
    let j = bestJ;
    while (i > 0) {
      const b = j === 0 ? 2 : bt[i][j];
      if (b === 1) {
        map[i - 1] = j - 1;
        kind[i - 1] = sims[i][j] >= MATCH_SIM ? 'match' : 'sub';
        i--;
        j--;
      } else if (b === 2) {
        i--;
      } else {
        j--;
      }
    }

    const words: Word[] = tokens.map((text, k) => {
      const a = map[k] >= 0 ? cand[map[k]] : null;
      if (a) {
        if (kind[k] === 'match') stats.matched++;
        else stats.substituted++;
        return {
          text,
          start: a.start,
          end: a.end,
          timing: 'asr' as const,
          ...(kind[k] === 'sub' ? { asrText: a.text } : {}),
          ...(cue.zh ? { zh: cue.zh } : {}),
        };
      }
      stats.interpolated++;
      return {
        text,
        start: NaN,
        end: NaN,
        timing: 'interp' as const,
        ...(cue.zh ? { zh: cue.zh } : {}),
      };
    });
    fillGaps(words, cue);
    out.push(...words);

    const lastUsed = map.reduce((a, v) => Math.max(a, v), -1);
    if (lastUsed >= 0) asrFloor = lo + lastUsed + 1;
  }

  // 全局保证单调递增
  for (let k = 1; k < out.length; k++) {
    if (out[k].start < out[k - 1].start) out[k].start = out[k - 1].start;
    if (out[k].end < out[k].start) out[k].end = out[k].start + 0.05;
  }
  return { words: out, stats };
}

/** 没对上的词：在左右两个已知时间点之间按字符数插值 */
function fillGaps(words: Word[], cue: Cue) {
  let k = 0;
  while (k < words.length) {
    if (!Number.isNaN(words[k].start)) {
      k++;
      continue;
    }
    let e = k;
    while (e < words.length && Number.isNaN(words[e].start)) e++;
    const left = k > 0 ? words[k - 1].end : cue.start;
    let right = e < words.length ? words[e].start : cue.end;
    if (right <= left) right = left + 0.25 * (e - k);
    const run = words.slice(k, e);
    const total = run.reduce((a, w) => a + w.text.length + 1, 0);
    let t = left;
    for (const w of run) {
      const d = ((right - left) * (w.text.length + 1)) / total;
      w.start = t;
      w.end = t + d;
      t += d;
    }
    k = e;
  }
}
