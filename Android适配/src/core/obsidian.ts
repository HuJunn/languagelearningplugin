import type { VideoVocab, VocabItem } from './types';

export const OBSIDIAN_VAULT = 'codex-obsidian';
export const OBSIDIAN_FILE = 'languagelearning/生词表';
export const OBSIDIAN_OPEN_URI = `obsidian://open?vault=${encodeURIComponent(OBSIDIAN_VAULT)}&file=${encodeURIComponent(OBSIDIAN_FILE)}`;

const TABLE_HEADER =
  '| 时间 | 词汇与音标 | 词性与核心释义 | 原声双语语境 |\n| :---: | :--- | :--- | :--- |';

export interface ObsidianSyncResult {
  markdown: string;
  /** created: 空文件按完整模板写入; appended_section: 未找到同标题，末尾追加新标题+生词; appended_words: 匹配到同标题，追加可新增词汇; noop: 匹配到同标题且无可追加词汇 */
  status: 'created' | 'appended_section' | 'appended_words' | 'noop';
  addedCount: number;
  titleExists: boolean;
}

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

function normalizeTitle(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * 生成《界面选型》模板的 Markdown 区块：
 * - includeFrontmatter = true（默认）：包含完整 YAML frontmatter + `# Title` + 4 列表格
 * - includeFrontmatter = false：用于在多视频合并文档中追加后续视频区块
 */
export function formatVideoVocabSection(vocab: VideoVocab, includeFrontmatter = true): string {
  const cleanUrl = vocab.url || `https://www.youtube.com/watch?v=${vocab.videoId}`;
  const title = normalizeTitle(vocab.title || vocab.videoId);
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

function extractHeadingTitle(line: string): string | null {
  const m = /^#{1,2}\s+(.+)$/.exec(line.trim());
  if (!m) return null;
  let heading = m[1].trim();
  // 兼容旧格式 `## [视频标题](https://...)`
  const linkMatch = /^\[([^\]]+)\]\([^)]+\)$/.exec(heading);
  if (linkMatch) heading = linkMatch[1];
  return normalizeTitle(heading);
}

function extractExistingWordsFromBlock(blockText: string): Set<string> {
  const words = new Set<string>();
  for (const line of blockText.split(/\r?\n/)) {
    const trimmed = line.trim();
    // 新格式表格行：| [0:15](...) | **photographer**... | ... |
    if (trimmed.startsWith('|') && !/^\|\s*:?---/.test(trimmed) && !/^\|\s*时间\s*\|/.test(trimmed)) {
      const mRow = /\*\*([^*]+)\*\*/.exec(trimmed);
      if (mRow) words.add(mRow[1].trim().toLowerCase());
      continue;
    }
    // 兼容旧格式列表项：- **photographer** ...
    const mBullet = /^-\s+\*\*([^*]+)\*\*/.exec(trimmed);
    if (mBullet) {
      words.add(mBullet[1].trim().toLowerCase());
    }
  }
  return words;
}

/** 将新表格行追加到已匹配标题区块的末尾（或表格最后一行之后，保留已有全部手动/历史内容） */
function appendRowsToSection(blockText: string, newRows: string[]): string {
  const lines = blockText.split(/\r?\n/);
  const hasTableHeader = lines.some((l) => /^\|\s*时间\s*\|/.test(l.trim()));

  // 找到本区块最后一条有效表格行
  let lastTableRowIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t.startsWith('|')) lastTableRowIdx = i;
  }

  if (lastTableRowIdx >= 0) {
    const nextLines = [...lines];
    nextLines.splice(lastTableRowIdx + 1, 0, ...newRows);
    return nextLines.join('\n');
  }

  // 该标题存在但下面还没有表格（例如用户保留了标题但删除了下方表格行）
  let insertAt = lines.length;
  while (insertAt > 0 && (lines[insertAt - 1].trim() === '' || lines[insertAt - 1].trim() === '---')) {
    insertAt--;
  }
  const head = lines.slice(0, insertAt).join('\n').trimEnd();
  const tail = lines.slice(insertAt).join('\n');
  const tableBlock = hasTableHeader ? newRows.join('\n') : `${TABLE_HEADER}\n${newRows.join('\n')}`;
  return tail.trim() ? `${head}\n\n${tableBlock}\n\n${tail}` : `${head}\n\n${tableBlock}`;
}

/**
 * 按流程图逻辑将当前生词同步进 Markdown：
 * A[点击导出 Obsidian]
 *  -> B{md 中是否存在相同标题？}
 *     |-- No --> C[按完整模板导入标题与生词]
 *     |-- Yes -> D[检查已有内容，若有可追加的新词汇则追加；无新增则保持不变]
 */
export function syncVocabIntoMarkdown(existingMd: string, vocab: VideoVocab): ObsidianSyncResult {
  const cleanUrl = vocab.url || `https://www.youtube.com/watch?v=${vocab.videoId}`;
  const targetTitle = normalizeTitle(vocab.title || vocab.videoId);
  const trimmed = existingMd.trim();

  if (!trimmed) {
    return {
      markdown: formatVideoVocabSection(vocab, true),
      status: 'created',
      addedCount: vocab.items.length,
      titleExists: false,
    };
  }

  // 把文本切分成区块：每个 `# ` / `## ` 标题开启新区块，开头的 YAML frontmatter 归入第一个标题区块
  const lines = trimmed.split(/\r?\n/);
  const blocks: { title: string | null; lines: string[] }[] = [];
  let inFrontmatter = false;
  let current: { title: string | null; lines: string[] } = { title: null, lines: [] };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (i === 0 && line.trim() === '---') {
      inFrontmatter = true;
      current.lines.push(line);
      continue;
    }
    if (inFrontmatter) {
      current.lines.push(line);
      if (line.trim() === '---') inFrontmatter = false;
      continue;
    }

    const headingTitle = extractHeadingTitle(line);
    if (headingTitle !== null) {
      if (current.title === null && current.lines.length > 0) {
        // 顶部 frontmatter / 前导空行并入第一个标题区块
        current.title = headingTitle;
        current.lines.push(line);
        continue;
      }
      if (current.lines.length > 0 || current.title !== null) {
        blocks.push(current);
      }
      current = { title: headingTitle, lines: [line] };
      continue;
    }
    current.lines.push(line);
  }
  if (current.lines.length > 0 || current.title !== null) {
    blocks.push(current);
  }

  // B: 优先按标题精确匹配（若仅顶部 YAML frontmatter 里有 title 且正文没写 `# 标题`，也尝试匹配 frontmatter 的 title）
  let matchedIdx = blocks.findIndex((b) => b.title !== null && b.title === targetTitle);
  if (matchedIdx === -1) {
    const fmTitleMatch = /^---\r?\n[\s\S]*?^title:\s*(.+)$[\s\S]*?\r?\n---/m.exec(trimmed);
    if (fmTitleMatch) {
      let fmTitle = fmTitleMatch[1].trim();
      if ((fmTitle.startsWith('"') && fmTitle.endsWith('"')) || (fmTitle.startsWith("'") && fmTitle.endsWith("'"))) {
        fmTitle = fmTitle.slice(1, -1);
      }
      if (normalizeTitle(fmTitle) === targetTitle && blocks.length > 0) {
        matchedIdx = 0;
      }
    }
  }

  // B --No--> C: 没有匹配标题，使用模板导入标题和全部词汇
  if (matchedIdx === -1) {
    return {
      markdown: `${trimmed}\n\n---\n\n${formatVideoVocabSection(vocab, false)}`,
      status: 'appended_section',
      addedCount: vocab.items.length,
      titleExists: false,
    };
  }

  // B --Yes--> D: 匹配到相同标题，检查已有内容并仅追加可新增词汇
  const matchedBlockText = blocks[matchedIdx].lines.join('\n');
  const existingWords = extractExistingWordsFromBlock(matchedBlockText);
  const seenNew = new Set<string>();
  const addableItems: VocabItem[] = [];
  for (const item of vocab.items) {
    const key = item.word.trim().toLowerCase();
    if (!key || existingWords.has(key) || seenNew.has(key)) continue;
    seenNew.add(key);
    addableItems.push(item);
  }

  if (addableItems.length === 0) {
    return {
      markdown: existingMd,
      status: 'noop',
      addedCount: 0,
      titleExists: true,
    };
  }

  const newRows = addableItems.map((item) => formatVocabTableRow(item, cleanUrl));
  const updatedBlockText = appendRowsToSection(matchedBlockText, newRows);
  blocks[matchedIdx].lines = updatedBlockText.split(/\r?\n/);

  const rebuilt = blocks
    .map((b) => b.lines.join('\n').trimEnd())
    .filter((s) => s.length > 0)
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n') + '\n';

  return {
    markdown: rebuilt,
    status: 'appended_words',
    addedCount: addableItems.length,
    titleExists: true,
  };
}

/**
 * 将当前视频的生词合并进已有的《生词表.md》全文中
 */
export function mergeVocabIntoMarkdown(existingMd: string, vocab: VideoVocab): string {
  return syncVocabIntoMarkdown(existingMd, vocab).markdown;
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
