import type { Sentence, Word } from './types';

const ABBREV = new Set([
  'mr.', 'mrs.', 'ms.', 'dr.', 'st.', 'jr.', 'sr.', 'vs.', 'etc.', 'e.g.', 'i.e.', 'u.s.', 'u.k.', 'a.m.', 'p.m.', 'no.', 'mt.', 'prof.', 'inc.', 'ltd.', 'co.',
]);

export function endsSentence(text: string): boolean {
  const t = text.toLowerCase();
  if (ABBREV.has(t)) return false;
  return /[.?!…]["'”’)\]]*$/.test(text);
}

const isClauseBreak = (text: string) => /[,;:—–-]["'”’)\]]*$/.test(text);

export interface SegmentOptions {
  maxWords?: number;
  maxSeconds?: number;
  /** 没有标点时，超过这个停顿就断句（秒） */
  pauseNoPunct?: number;
  /** 有标点时，超过这个停顿也断句（秒） */
  pauseWithPunct?: number;
}

/**
 * 按标点把逐词序列重新组合成完整的句子；太长的句子在逗号或最大停顿处再拆开。
 */
export function segmentSentences(words: Word[], opts: SegmentOptions = {}): Sentence[] {
  const { maxWords = 24, maxSeconds = 9, pauseNoPunct = 0.8, pauseWithPunct = 2.0 } = opts;
  if (!words.length) return [];
  const punctRatio = words.filter((w) => endsSentence(w.text)).length / words.length;
  const hasPunct = punctRatio > 0.02;
  const pauseLimit = hasPunct ? pauseWithPunct : pauseNoPunct;

  const groups: Word[][] = [];
  let cur: Word[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    cur.push(w);
    const next = words[i + 1];
    const gap = next ? next.start - w.end : Infinity;
    if (!next || (hasPunct && endsSentence(w.text)) || gap > pauseLimit) {
      groups.push(cur);
      cur = [];
    }
  }
  if (cur.length) groups.push(cur);

  const split: Word[][] = [];
  const splitLong = (g: Word[]) => {
    const dur = g[g.length - 1].end - g[0].start;
    if (g.length <= maxWords && dur <= maxSeconds) {
      split.push(g);
      return;
    }
    // 在中间附近找最佳断点：逗号优先，其次停顿最大的地方
    let best = -1;
    let bestScore = -Infinity;
    const lo = Math.max(2, Math.floor(g.length * 0.25));
    const hi = Math.min(g.length - 2, Math.ceil(g.length * 0.75));
    for (let k = lo; k <= hi; k++) {
      const gap = g[k + 1] ? g[k + 1].start - g[k].end : 0;
      const centre = 1 - Math.abs(k + 1 - g.length / 2) / g.length;
      const score = (isClauseBreak(g[k].text) ? 2 : 0) + Math.min(gap, 1.5) * 2 + centre;
      if (score > bestScore) {
        bestScore = score;
        best = k;
      }
    }
    if (best < 0) {
      split.push(g);
      return;
    }
    splitLong(g.slice(0, best + 1));
    splitLong(g.slice(best + 1));
  };
  groups.forEach(splitLong);

  const sentences: Sentence[] = split.map((ws, id) => {
    const zhs: string[] = [];
    for (const w of ws) {
      if (w.zh && !zhs.includes(w.zh)) zhs.push(w.zh);
    }
    return {
      id,
      start: ws[0].start,
      end: ws[ws.length - 1].end,
      words: ws,
      text: ws.map((w) => w.text).join(' '),
      ...(zhs.length ? { builtInZh: zhs.join(' ') } : {}),
    };
  });
  // 首句开头严格等于第一个词的起点 (ws[0].start)；
  // 句尾留足自然收尾余量（最多 +0.24s），若下一句紧随其后则严禁越过下一句起点，避免吞掉下一句开头单词
  for (let i = 0; i < sentences.length; i++) {
    const lastWordEnd = sentences[i].words[sentences[i].words.length - 1].end;
    const nextStart = sentences[i + 1]?.start ?? Infinity;
    const naturalEnd = lastWordEnd + 0.24;
    sentences[i].end =
      nextStart === Infinity
        ? naturalEnd
        : Math.min(naturalEnd, Math.max(lastWordEnd + 0.01, nextStart - 0.02));
  }
  return sentences;
}

/** 二分查找：time 所在的句子下标；若两句句尾余量与下句开头重叠，优先归属已经开始的下一句 */
export function findSentenceAt(sentences: Sentence[], time: number): number {
  let lo = 0;
  let hi = sentences.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const s = sentences[mid];
    const nextStart = sentences[mid + 1]?.start ?? Infinity;
    const effectiveEnd = Math.min(s.end, nextStart);
    if (time < s.start) hi = mid - 1;
    else if (time >= effectiveEnd) lo = mid + 1;
    else return mid;
  }
  return -1;
}

/** time 之前最近的一句（包括正在播放的） */
export function findSentenceBefore(sentences: Sentence[], time: number): number {
  let lo = 0;
  let hi = sentences.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (sentences[mid].start <= time) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}
