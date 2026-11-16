/** 一个带时间的单词（秒） */
export interface Word {
  text: string;
  start: number;
  end: number;
  /** 时间来源：asr = YouTube 自动字幕自带的逐词时间；interp = 估算 */
  timing: 'asr' | 'interp';
  /** 人工字幕替换了自动字幕中识别不同的词时，记录原来的 ASR 文本 */
  asrText?: string;
}

/** 字幕中的一条（平台原始的一行） */
export interface Cue {
  start: number;
  end: number;
  text: string;
}

export interface Sentence {
  id: number;
  start: number;
  end: number;
  words: Word[];
  text: string;
}

export type TranscriptSource = 'manual+asr' | 'asr' | 'manual';

export interface Transcript {
  videoId: string;
  source: TranscriptSource;
  sentences: Sentence[];
  /** 人工字幕与自动字幕对齐的统计 */
  alignStats?: { total: number; matched: number; substituted: number; interpolated: number };
}

export interface CaptionTrack {
  baseUrl: string;
  languageCode: string;
  kind?: string; // 'asr' = 自动生成
  name: string;
  vssId?: string;
}

export interface DictEntry {
  word: string;
  /** 查询时如果命中的是词形变化，这里是原形 */
  lemma?: string;
  phonetic: string;
  translation: string;
}

export interface VocabItem {
  word: string;
  phonetic: string;
  meaning: string;
  sentence: string;
  time: number;
  addedAt: number;
}

export interface VideoVocab {
  videoId: string;
  url: string;
  title: string;
  items: VocabItem[];
}
