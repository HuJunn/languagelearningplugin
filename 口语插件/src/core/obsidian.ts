import type { VideoVocab, VocabItem } from './types';

export const OBSIDIAN_VAULT = 'codex-obsidian';
export const OBSIDIAN_FILE = 'languagelearning/生词表';
export const OBSIDIAN_OPEN_URI = `obsidian://open?vault=${encodeURIComponent(OBSIDIAN_VAULT)}&file=${encodeURIComponent(OBSIDIAN_FILE)}`;

const TABLE_HEADER =
  '| 时间 | 词汇与音标 | 词性与核心释义 | 原声双语语境 |\n| :---: | :--- | :--- | :--- |';

export function formatTimestamp(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const mm = h > 0 ? String(m % 60).padStart(2, '0') : String(m);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function buildTimeUrl(baseUrl: string, sec: number): string {
  const t = Math.max(0, Math.floor(sec));
  try {
    const u = new URL(baseUrl);
    if (u.hostname.includes('youtube.com')) {
      u.searchParams.set('t', `${t}s`);
      return u.toString();
    }
  } catch {
    // ignore
  }
  const sep = baseUrl.includes('?') ? '&' : '?';
  return `${baseUrl}${sep}t=${t}s`;
}

function escapeTableCell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 将 ECDICT / 在线释义中的词性标签格式化为 `n.` 风格并用 <br> 分行 */
export function formatMeaningForTable(meaning: string): string {
  const normalized = meaning
    .replace(/\r?\n/g, '\n')
    .replace(/[；;]\s*([a-zA-Z]{1,6}(?:\/[a-zA-Z]{1,6})?\.)\s*/g, '\n$1 ')
    .trim();
  const lines = normalized
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const m = /^([a-zA-Z]{1,6}(?:\/[a-zA-Z]{1,6})?\.)\s*(.*)$/.exec(line);
      if (m) {
        return `\`${escapeTableCell(m[1])}\` ${escapeTableCell(m[2])}`.trim();
      }
      return escapeTableCell(line);
    });
  return lines.join('<br>') || '—';
}

/** 在英文例句中加粗高亮命中的生词 */
export function highlightWordInSentence(sentence: string, word: string, rawWord?: string): string {
  const cleanSent = escapeTableCell(sentence);
  const candidates = Array.from(new Set([rawWord, word].filter((v): v is string => Boolean(v && v.trim()))));
  for (const cand of candidates) {
    const bare = cand.replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, '');
    if (!bare) continue;
    const re = new RegExp(`(?<!\\*)\\b(${escapeRegExp(bare)})\\b(?!\\*)`, 'i');
    if (re.test(cleanSent)) {
      return cleanSent.replace(re, '**$1**');
    }
  }
  // 兜底：若词形变化与词干有轻微差异（如 vendor -> vendors）
  const stem = word.replace(/[^a-zA-Z0-9'-]/g, '');
  if (stem.length >= 3) {
    const inflectRe = new RegExp(`(?<!\\*)\\b(${escapeRegExp(stem)}[a-zA-Z'-]*)\\b(?!\\*)`, 'i');
    if (inflectRe.test(cleanSent)) {
      return cleanSent.replace(inflectRe, '**$1**');
    }
  }
  return cleanSent;
}

/** 按《界面选型》模板生成单行 Markdown 表格记录 */
export function formatVocabTableRow(item: VocabItem, videoUrl: string): string {
  const timeLabel = formatTimestamp(item.time);
  const timeLink = buildTimeUrl(videoUrl, item.time);
  const wordLabel = escapeTableCell(item.word);
  const phon = item.phonetic ? `<br>\`${escapeTableCell(item.phonetic)}\`` : '';
  const colWord = `**${wordLabel}**${phon}`;
  const colMeaning = formatMeaningForTable(item.meaning);

  const enPart = item.sentence
    ? highlightWordInSentence(item.sentence, item.word, item.rawWord)
    : '';
  const zhPart = item.sentenceZh?.trim() ? `<br>*${escapeTableCell(item.sentenceZh)}*` : '';
  const colContext = `${enPart}${zhPart}` || '—';

  return `| [${timeLabel}](${timeLink}) | ${colWord} | ${colMeaning} | ${colContext} |`;
}

export function formatVocabItemBullet(item: VocabItem, videoUrl: string): string {
  return formatVocabTableRow(item, videoUrl);
}

function formatYamlScalar(val: string): string {
  const cleaned = val.replace(/\r?\n/g, ' ').trim();
  if (/[:#[\]{}&*!|>'"%@`]/.test(cleaned)) {
    return JSON.stringify(cleaned);
  }
  return cleaned;
}

/**
 * 生成《界面选型》模板的 Markdown 区块：
 * - includeFrontmatter = true（默认）：包含完整 YAML frontmatter + `# Title` + 4 列表格
 * - includeFrontmatter = false：用于在多视频合并文档中追加后续视频区块
 */
export function formatVideoVocabSection(vocab: VideoVocab, includeFrontmatter = true): string {
  const cleanUrl = vocab.url || `https://www.youtube.com/watch?v=${vocab.videoId}`;
  const title = (vocab.title || vocab.videoId).replace(/[\r\n]/g, ' ').trim();
  const rows = vocab.items.map((item) => formatVocabTableRow(item, cleanUrl)).join('\n');

  if (includeFrontmatter) {
    return (
      `---\n` +
      `title: ${formatYamlScalar(title)}\n` +
      `source: ${cleanUrl}\n` +
      `tags: [vocabulary, table-view]\n` +
      `---\n\n` +
      `# ${title}\n\n` +
      `${TABLE_HEADER}\n` +
      `${rows ? `${rows}\n` : ''}`
    );
  }

  return (
    `# ${title}\n\n` +
    `> source: ${cleanUrl}\n\n` +
    `${TABLE_HEADER}\n` +
    `${rows ? `${rows}\n` : ''}`
  );
}

function extractPreservedRowsFromBlock(blockText: string, overrideWords: Set<string>): string[] {
  const preserved: string[] = [];
  const lines = blockText.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // 匹配新格式表格行：| [0:15](...) | **photographer**... | ... |
    if (line.trim().startsWith('|') && !/^\|\s*:?---/.test(line.trim()) && !/^\|\s*时间\s*\|/.test(line.trim())) {
      const mRow = /\*\*([^*]+)\*\*/.exec(line);
      if (mRow && !overrideWords.has(mRow[1].trim().toLowerCase())) {
        preserved.push(line.trimEnd());
      }
      i++;
      continue;
    }
    // 兼容旧格式列表项（若用户合并旧版《生词表.md》）
    const mBullet = /^-\s+\*\*([^*]+)\*\*/.exec(line);
    if (mBullet) {
      const w = mBullet[1].trim().toLowerCase();
      const bulletLines = [line];
      while (i + 1 < lines.length && /^\s+-\s/.test(lines[i + 1])) {
        i++;
        bulletLines.push(lines[i]);
      }
      if (!overrideWords.has(w)) {
        preserved.push(bulletLines.join('\n'));
      }
    }
    i++;
  }
  return preserved;
}

/**
 * 将当前视频的生词合并进已有的《生词表.md》全文中（使用《界面选型》表格模板）：
 * - 按视频原链接（或 videoId）定位已有区块，存在则原位合并去重单词，不存在则在末尾新增区块。
 */
export function mergeVocabIntoMarkdown(existingMd: string, vocab: VideoVocab): string {
  const trimmed = existingMd.trim();
  if (!trimmed) {
    return formatVideoVocabSection(vocab, true);
  }

  const cleanUrl = vocab.url || `https://www.youtube.com/watch?v=${vocab.videoId}`;
  const title = (vocab.title || vocab.videoId).replace(/[\r\n]/g, ' ').trim();
  const overrideWords = new Set(vocab.items.map((i) => i.word.toLowerCase()));
  const newRows = vocab.items.map((item) => formatVocabTableRow(item, cleanUrl));

  // 1) 若文件顶部本身是带 source 的单视频 frontmatter 且匹配当前视频
  const fmMatch = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(trimmed);
  if (fmMatch) {
    const fmBody = fmMatch[1];
    const bodyRest = fmMatch[2];
    const sourceMatch = fmBody.includes(cleanUrl) || (vocab.videoId && fmBody.includes(vocab.videoId));
    // 如果正文后面还没有切出其他视频的二级/分隔区块，或者第一个区块属于本视频
    const restParts = bodyRest.trim().split(/^(?=#\s|##\s|---\s*$)/m).filter((p) => p.trim() !== '---' && p.trim().length > 0);
    if (sourceMatch && restParts.length <= 2) {
      const preserved = extractPreservedRowsFromBlock(bodyRest, overrideWords);
      const allRows = [...preserved, ...newRows].join('\n');
      return (
        `---\n` +
        `title: ${formatYamlScalar(title)}\n` +
        `source: ${cleanUrl}\n` +
        `tags: [vocabulary, table-view]\n` +
        `---\n\n` +
        `# ${title}\n\n` +
        `${TABLE_HEADER}\n` +
        `${allRows ? `${allRows}\n` : ''}`
      );
    }
  }

  // 2) 多视频区块按一级/二级标题切分（兼容 `# 标题` 与旧版 `## [标题](url)`）
  const parts = trimmed.split(/^(?=#\s|##\s)/m);
  const targetIdx = parts.findIndex(
    (p) =>
      (p.startsWith('# ') || p.startsWith('## ')) &&
      (p.includes(cleanUrl) || (vocab.videoId && p.includes(vocab.videoId))),
  );

  if (targetIdx === -1) {
    return `${trimmed}\n\n---\n\n${formatVideoVocabSection(vocab, false)}`;
  }

  const existingBlock = parts[targetIdx];
  const preserved = extractPreservedRowsFromBlock(existingBlock, overrideWords);
  const tableRows = preserved.filter((r) => r.startsWith('|')).concat(newRows);
  const legacyBullets = preserved.filter((r) => !r.startsWith('|'));
  const hasTrailingHr = /\n---\s*$/.test(existingBlock.trim());

  const rebuiltSection =
    `# ${title}\n\n` +
    `> source: ${cleanUrl}\n\n` +
    `${TABLE_HEADER}\n` +
    `${tableRows.join('\n')}` +
    (legacyBullets.length ? `\n\n${legacyBullets.join('\n')}` : '') +
    `\n${hasTrailingHr ? '\n---\n\n' : '\n'}`;

  parts[targetIdx] = rebuiltSection;
  return parts.map((p) => p.trimEnd()).join('\n\n') + '\n';
}

/**
 * 构造 Obsidian URI（使用 obsidian://new?...&append=true 直接追加到 languagelearning/生词表）
 */
export function buildObsidianAppendUri(content: string, ensureLeadingNewline = true): string {
  const payload = ensureLeadingNewline ? `\n${content}` : content;
  return (
    `obsidian://new?vault=${encodeURIComponent(OBSIDIAN_VAULT)}` +
    `&file=${encodeURIComponent(OBSIDIAN_FILE)}` +
    `&append=true` +
    `&content=${encodeURIComponent(payload)}`
  );
}
