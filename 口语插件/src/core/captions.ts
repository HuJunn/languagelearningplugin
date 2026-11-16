import type { Cue, Word } from './types';

interface Json3Seg {
  utf8?: string;
  tOffsetMs?: number;
}
interface Json3Event {
  tStartMs?: number;
  dDurationMs?: number;
  aAppend?: number;
  segs?: Json3Seg[];
}
export interface Json3 {
  events?: Json3Event[];
}

/** [music] [Applause] (laughs) ♪ 之类的非语音标记 */
const NON_SPEECH = /^(\[[^\]]*\]|\([^)]*\)|♪+|>>)$/;

export function isNonSpeech(token: string): boolean {
  return NON_SPEECH.test(token.trim());
}

/** 估算一个词大概要念多久（秒），用来在停顿处截断高亮 */
export function estimateWordDuration(text: string): number {
  const letters = text.replace(/[^\p{L}\p{N}]/gu, '').length;
  return Math.min(1.5, Math.max(0.25, 0.08 * letters + 0.15));
}

/**
 * 解析 YouTube 自动字幕（ASR）的 json3：每个 seg 带 tOffsetMs，可以得到逐词时间。
 * 一个 seg 里偶尔包含多个词（如 " a free"），按字符数平分该 seg 的时长。
 */
export function parseAsrJson3(data: Json3): Word[] {
  type Raw = { text: string; start: number; eventEnd: number };
  const segs: Raw[] = [];
  for (const ev of data.events ?? []) {
    if (!ev.segs || ev.aAppend) continue;
    const t0 = (ev.tStartMs ?? 0) / 1000;
    const evEnd = t0 + (ev.dDurationMs ?? 0) / 1000;
    for (const s of ev.segs) {
      const text = (s.utf8 ?? '').replace(/\n/g, ' ');
      if (!text.trim()) continue;
      segs.push({ text, start: t0 + (s.tOffsetMs ?? 0) / 1000, eventEnd: evEnd });
    }
  }
  segs.sort((a, b) => a.start - b.start);

  const words: Word[] = [];
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i];
    const next = segs[i + 1];
    const segEnd = next ? Math.min(next.start, seg.eventEnd) : seg.eventEnd;
    const parts = seg.text.trim().split(/\s+/).filter((p) => !isNonSpeech(p));
    if (!parts.length) continue;
    const total = parts.reduce((a, p) => a + p.length, 0);
    let t = seg.start;
    const span = Math.max(0.05, segEnd - seg.start);
    for (const p of parts) {
      const d = parts.length === 1 ? span : (span * p.length) / total;
      words.push({ text: p, start: t, end: t + d, timing: 'asr' });
      t += d;
    }
  }
  // 结束时间：不超过下一个词的开始，也不超过估算的发音时长（避免停顿时高亮拖很久）
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const nextStart = words[i + 1]?.start ?? Infinity;
    w.end = Math.min(nextStart, w.start + estimateWordDuration(w.text), Math.max(w.end, w.start + 0.05));
    if (w.end <= w.start) w.end = w.start + 0.05;
  }
  return words;
}

/** 解析人工字幕 json3：每个 event 是一整行，只有行级时间 */
export function parseCuesJson3(data: Json3): Cue[] {
  const cues: Cue[] = [];
  for (const ev of data.events ?? []) {
    if (!ev.segs) continue;
    const text = ev.segs
      .map((s) => s.utf8 ?? '')
      .join('')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) continue;
    const start = (ev.tStartMs ?? 0) / 1000;
    cues.push({ start, end: start + (ev.dDurationMs ?? 0) / 1000, text });
  }
  cues.sort((a, b) => a.start - b.start);
  // 人工字幕的行经常互相重叠显示，截断到下一行开始
  for (let i = 0; i < cues.length - 1; i++) {
    if (cues[i].end > cues[i + 1].start) cues[i].end = Math.max(cues[i].start + 0.2, cues[i + 1].start);
  }
  return cues;
}

/** 把一行文本拆成单词，去掉非语音标记和说话人标记 */
export function tokenizeCueText(text: string): string[] {
  return text
    .replace(/\[[^\]]*\]|\([^)]*\)|♪/g, ' ')
    .replace(/(^|\s)(>>|-)\s*/g, ' ')
    .replace(/^[A-Z][A-Z .'-]{1,24}:\s/, ' ') // "JUAN: hello" 说话人
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/** 只有行级时间时，按字符数在一行内插值出每个词的时间 */
export function interpolateCue(cue: Cue, tokens = tokenizeCueText(cue.text)): Word[] {
  const total = tokens.reduce((a, t) => a + t.length + 1, 0);
  let t = cue.start;
  return tokens.map((text) => {
    const d = ((cue.end - cue.start) * (text.length + 1)) / total;
    const w: Word = { text, start: t, end: t + d, timing: 'interp' };
    t += d;
    return w;
  });
}

/** 解析 YouTube srv3 / timedtext XML（播放器没用 json3 时的兜底） */
export function parseTimedTextXml(xml: string): Cue[] {
  const cues: Cue[] = [];
  const decode = (s: string) =>
    s
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
  const reP = /<p\s+t="(\d+)"(?:\s+d="(\d+)")?[^>]*>([\s\S]*?)<\/p>/g;
  let m: RegExpExecArray | null;
  while ((m = reP.exec(xml))) {
    const text = decode(m[3]).replace(/\s+/g, ' ').trim();
    if (text) cues.push({ start: +m[1] / 1000, end: (+m[1] + +(m[2] ?? 0)) / 1000, text });
  }
  if (!cues.length) {
    const reT = /<text\s+start="([\d.]+)"(?:\s+dur="([\d.]+)")?[^>]*>([\s\S]*?)<\/text>/g;
    while ((m = reT.exec(xml))) {
      const text = decode(decode(m[3])).replace(/\s+/g, ' ').trim();
      if (text) cues.push({ start: +m[1], end: +m[1] + +(m[2] ?? 0), text });
    }
  }
  return cues;
}

function parseClockTime(raw: string): number {
  const parts = raw.trim().replace(',', '.').split(':').map(Number);
  if (parts.some(Number.isNaN)) return NaN;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] ?? NaN;
}

/**
 * 解析外部人工字幕文本（支持 Obsidian Clipper 剪藏格式 `**0:26** · ...`、SRT/VTT、或 `0:26 文本`）
 * 用于和自动字幕对齐校准单词并保留逐词时间。
 */
export function parseCustomTranscriptCues(input: string): Cue[] {
  const cues: Cue[] = [];
  const lines = input.split(/\r?\n/);

  // 1. 尝试 SRT / VTT 时间轴行: 00:00:16.500 --> 00:00:18.000
  for (let i = 0; i < lines.length; i++) {
    const arrow = /(\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d+)?)\s*-->\s*(\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d+)?)/.exec(
      lines[i],
    );
    if (arrow) {
      const start = parseClockTime(arrow[1]);
      const end = parseClockTime(arrow[2]);
      const textLines: string[] = [];
      while (i + 1 < lines.length && lines[i + 1].trim() !== '') {
        i++;
        textLines.push(lines[i].trim());
      }
      const text = textLines.join(' ').replace(/<[^>]+>/g, '').trim();
      if (text && !Number.isNaN(start) && !Number.isNaN(end)) {
        cues.push({ start, end, text });
      }
    }
  }
  if (cues.length > 0) return cues;

  // 2. Obsidian Clipper 格式 (`**0:26** · ...`) 或通用时间戳行 (`0:26 ...`)
  const rawStarts: Array<{ start: number; text: string }> = [];
  for (const line of lines) {
    const m = /^\s*(?:\*\*\[?)?(\d{1,2}:\d{2}(?::\d{2})?)(?:\]?\*\*)?\s*(?:[·•\-–—|]\s*|\s+)(.+)$/.exec(line);
    if (!m) continue;
    const start = parseClockTime(m[1]);
    const text = m[2].replace(/\\\[/g, '[').replace(/\\\]/g, ']').trim();
    if (!Number.isNaN(start) && text) {
      rawStarts.push({ start, text });
    }
  }
  for (let i = 0; i < rawStarts.length; i++) {
    const cur = rawStarts[i];
    const next = rawStarts[i + 1];
    const estDur = Math.max(1.5, Math.min(12, cur.text.split(/\s+/).length * 0.42));
    const end = next && next.start > cur.start ? Math.min(next.start, cur.start + estDur + 2) : cur.start + estDur;
    cues.push({ start: cur.start, end, text: cur.text });
  }
  return cues;
}
