import type { CaptionTrack, Cue, Transcript, Word } from './types';
import { interpolateCue, Json3, parseAsrJson3, parseCuesJson3, parseTimedTextXml } from './captions';
import { alignManualToAsr } from './align';
import { segmentSentences, SegmentOptions } from './segment';

export interface BuildTranscriptInput {
  videoId: string;
  asrJson3?: Json3 | null;
  manualJson3?: Json3 | null;
  manualXml?: string | null;
  asrXml?: string | null;
  customManualCues?: Cue[] | null;
  segmentOptions?: SegmentOptions;
}

/**
 * 综合人工字幕与自动字幕生成最终的跟读字幕列表：
 * 1. 同时有人工字幕和自动字幕（ASR json3）：
 *    用 alignManualToAsr 对齐，以人工字幕校准单词拼写/标点，同时保留 ASR 的逐词时间戳（问题4）。
 * 2. 只有自动字幕（ASR json3）：
 *    直接提取逐词时间戳并按标点/停顿断句。
 * 3. 只有人工字幕（或 XML 兜底）：
 *    按字符数在每条字幕内插值生成单词时间，再按标点断句。
 */
export function buildTranscript(input: BuildTranscriptInput): Transcript {
  const { videoId, asrJson3, manualJson3, manualXml, asrXml, customManualCues, segmentOptions } = input;

  const asrWords: Word[] = asrJson3 ? parseAsrJson3(asrJson3) : [];
  let manualCues: Cue[] = [];
  if (customManualCues && customManualCues.length > 0) {
    manualCues = customManualCues;
  } else if (manualJson3) {
    manualCues = parseCuesJson3(manualJson3);
  } else if (manualXml) {
    manualCues = parseTimedTextXml(manualXml);
  }

  // 情况 1：人工字幕 + 自动字幕同时存在 -> 对齐替换差异词并保留逐词时间
  if (manualCues.length > 0 && asrWords.length > 0) {
    const { words, stats } = alignManualToAsr(manualCues, asrWords);
    const sentences = segmentSentences(words, segmentOptions);
    return {
      videoId,
      source: 'manual+asr',
      sentences,
      alignStats: stats,
    };
  }

  // 情况 2：只有自动字幕（json3 含逐词 tOffsetMs）
  if (asrWords.length > 0) {
    const sentences = segmentSentences(asrWords, segmentOptions);
    return {
      videoId,
      source: 'asr',
      sentences,
    };
  }

  // 情况 3：只有人工字幕（或 ASR 只有行级）
  const fallbackCues =
    manualCues.length > 0
      ? manualCues
      : asrJson3
        ? parseCuesJson3(asrJson3)
        : asrXml
          ? parseTimedTextXml(asrXml)
          : [];

  const interpWords = fallbackCues.flatMap((c) => interpolateCue(c));
  const sentences = segmentSentences(interpWords, segmentOptions);
  return {
    videoId,
    source: 'manual',
    sentences,
  };
}

/**
 * 从 YouTube playerResponse 的 captionTracks 中选出最佳的英文人工轨和英文自动生成轨（ASR）
 */
export function selectEnglishTracks(tracks: CaptionTrack[]): {
  manualTrack: CaptionTrack | null;
  asrTrack: CaptionTrack | null;
} {
  if (!Array.isArray(tracks) || !tracks.length) {
    return { manualTrack: null, asrTrack: null };
  }

  const isEn = (code: string) => /^en(-[a-z0-9]+)?$/i.test(code);
  const rankEn = (t: CaptionTrack) => {
    const c = (t.languageCode || '').toLowerCase();
    if (c === 'en') return 0;
    if (c === 'en-orig') return 1;
    if (c === 'en-us') return 2;
    if (c === 'en-gb') return 3;
    if (c.startsWith('en')) return 4;
    return 99;
  };

  const enTracks = tracks.filter((t) => isEn(t.languageCode));
  const pool = enTracks.length > 0 ? enTracks : tracks;

  const asrCandidates = pool.filter((t) => t.kind === 'asr' || (t.vssId ?? '').startsWith('a.')).sort((a, b) => rankEn(a) - rankEn(b));
  const manualCandidates = pool.filter((t) => t.kind !== 'asr' && !(t.vssId ?? '').startsWith('a.')).sort((a, b) => rankEn(a) - rankEn(b));

  return {
    manualTrack: manualCandidates[0] ?? null,
    asrTrack: asrCandidates[0] ?? null,
  };
}
