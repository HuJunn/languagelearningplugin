import type { VideoVocab, VocabItem } from './types';

export const OBSIDIAN_VAULT = 'codex-obsidian';
export const OBSIDIAN_FILE = 'languagelearning/生词表';
export const OBSIDIAN_OPEN_URI = `obsidian://open?vault=${encodeURIComponent(OBSIDIAN_VAULT)}&file=${encodeURIComponent(OBSIDIAN_FILE)}`;

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

export function formatVocabItemBullet(item: VocabItem, videoUrl: string): string {
  const timeLabel = formatTimestamp(item.time);
  const timeLink = buildTimeUrl(videoUrl, item.time);
  const phon = item.phonetic ? ` \`${item.phonetic}\`` : '';
  const meaning = item.meaning.replace(/\r?\n/g, ' ； ').trim();
  const lines = [`- **${item.word}**${phon} — ${meaning} · [${timeLabel}](${timeLink})`];
  if (item.sentence) {
    lines.push(`  - 例句：${item.sentence.trim()}`);
  }
  return lines.join('\n');
}

/** 生成单个视频的 Markdown 分割区块（按视频原链接作为分割） */
export function formatVideoVocabSection(vocab: VideoVocab): string {
  const cleanUrl = vocab.url || `https://www.youtube.com/watch?v=${vocab.videoId}`;
  const title = (vocab.title || vocab.videoId).replace(/[\[\]\r\n]/g, ' ').trim();
  const header = `## [${title}](${cleanUrl})\n> 视频链接：${cleanUrl}`;
  const bullets = vocab.items.map((item) => formatVocabItemBullet(item, cleanUrl)).join('\n');
  return `${header}\n\n${bullets}\n`;
}

/**
 * 将当前视频的生词合并进已有的《生词表.md》全文中：
 * - 按视频原链接（或 videoId）定位已有区块，存在则原位合并去重单词，不存在则在末尾新增分割区块。
 */
export function mergeVocabIntoMarkdown(existingMd: string, vocab: VideoVocab): string {
  const sectionMd = formatVideoVocabSection(vocab);
  const trimmed = existingMd.trim();
  if (!trimmed) {
    return `# 生词表\n\n${sectionMd}`;
  }

  // 按二级标题 `## ` 切分区块
  const parts = trimmed.split(/^(?=##\s)/m);
  const cleanUrl = vocab.url || `https://www.youtube.com/watch?v=${vocab.videoId}`;
  const targetIdx = parts.findIndex(
    (p) => p.startsWith('## ') && (p.includes(cleanUrl) || (vocab.videoId && p.includes(vocab.videoId))),
  );

  if (targetIdx === -1) {
    return `${trimmed}\n\n---\n\n${sectionMd}`;
  }

  // 解析已有区块中的生词（保留之前已收藏但不在本次列表里的词）
  const existingBlock = parts[targetIdx];
  const existingWords = new Set(vocab.items.map((i) => i.word.toLowerCase()));
  const preservedBullets: string[] = [];
  const lines = existingBlock.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const m = /^-\s+\*\*([^*]+)\*\*/.exec(line);
    if (m) {
      const w = m[1].trim().toLowerCase();
      const bulletLines = [line];
      while (i + 1 < lines.length && /^\s+-\s/.test(lines[i + 1])) {
        i++;
        bulletLines.push(lines[i]);
      }
      if (!existingWords.has(w)) {
        preservedBullets.push(bulletLines.join('\n'));
      }
    }
    i++;
  }

  const title = (vocab.title || vocab.videoId).replace(/[\[\]\r\n]/g, ' ').trim();
  const header = `## [${title}](${cleanUrl})\n> 视频链接：${cleanUrl}`;
  const newBullets = vocab.items.map((item) => formatVocabItemBullet(item, cleanUrl));
  const allBullets = [...preservedBullets, ...newBullets].join('\n');
  const hasTrailingHr = /\n---\s*$/.test(existingBlock.trim());
  parts[targetIdx] = `${header}\n\n${allBullets}\n${hasTrailingHr ? '\n---\n\n' : '\n'}`;

  return parts.map((p) => p.trimEnd()).join('\n\n') + '\n';
}

/**
 * 构造 Obsidian URI（使用 obsidian://new?...&append=true 直接追加到 languagelearning/生词表）
 */
export function buildObsidianAppendUri(content: string): string {
  return (
    `obsidian://new?vault=${encodeURIComponent(OBSIDIAN_VAULT)}` +
    `&file=${encodeURIComponent(OBSIDIAN_FILE)}` +
    `&append=true` +
    `&content=${encodeURIComponent('\n' + content)}`
  );
}
