import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { lookupOfflineDict, CompactDict } from '../dict';
import {
  buildObsidianAppendUri,
  formatVideoVocabSection,
  mergeVocabIntoMarkdown,
  OBSIDIAN_OPEN_URI,
} from '../obsidian';
import { compareSemver, parseAndroidUpdatesXml } from '../version';

const dict: CompactDict = JSON.parse(fs.readFileSync('public/dict.json', 'utf8'));

describe('Offline ECDICT dictionary + lemmatizer', () => {
  it('resolves headwords, inflected forms, and contractions with IPA and Chinese meanings', () => {
    const p = lookupOfflineDict('proposition', dict);
    expect(p).not.toBeNull();
    expect(p!.phonetic).toContain('prɑpəˈzɪʃn');
    expect(p!.translation).toContain('提议');

    const w = lookupOfflineDict('washes.', dict);
    expect(w).not.toBeNull();
    expect(w!.lemma).toBe('wash');
    expect(w!.translation).toContain('洗');

    const o = lookupOfflineDict('opened,', dict);
    expect(o).not.toBeNull();
    expect(o!.lemma).toBe('open');
    expect(o!.translation).toContain('打开');

    const g = lookupOfflineDict('grand', dict);
    expect(g).not.toBeNull();
    expect(g!.translation).toContain('一千美元');

    const num = lookupOfflineDict('$10,000', dict);
    expect(num).not.toBeNull();
    expect(num!.translation).toContain('$10,000');
  });
});

describe('Obsidian vocabulary markdown formatter & merger (table-view template)', () => {
  it('formats video vocabulary using table-view template and deduplicates on repeated merges', () => {
    expect(OBSIDIAN_OPEN_URI).toBe('obsidian://open?vault=codex-obsidian&file=languagelearning%2F%E7%94%9F%E8%AF%8D%E8%A1%A8');

    const v1 = {
      videoId: 'nJs7YXLYu0A',
      url: 'https://www.youtube.com/watch?v=nJs7YXLYu0A',
      title: 'I Opened A FREE Carwash',
      items: [
        {
          word: 'proposition',
          phonetic: '/ˌprɑpəˈzɪʃn/',
          meaning: 'n. 提议，建议',
          sentence: 'I have a proposition for you.',
          sentenceZh: '我有个提议要跟你说。',
          time: 18,
          addedAt: 1,
        },
      ],
    };

    const md1 = mergeVocabIntoMarkdown('', v1);
    expect(md1).toContain('tags: [vocabulary, table-view]');
    expect(md1).toContain('# I Opened A FREE Carwash');
    expect(md1).toContain('| 时间 | 词汇与音标 | 词性与核心释义 | 原声双语语境 |');
    expect(md1).toContain(
      '| [0:18](https://www.youtube.com/watch?v=nJs7YXLYu0A&t=18s) | **proposition**<br>`/ˌprɑpəˈzɪʃn/` | `n.` 提议，建议 | I have a **proposition** for you.<br>*我有个提议要跟你说。* |',
    );

    // Merge another word into the same video table
    const v1More = {
      ...v1,
      items: [
        ...v1.items,
        {
          word: 'grand',
          phonetic: '/ɡrænd/',
          meaning: 'n. 一千美元；adj. 宏伟的',
          sentence: "he's going to hand me 10 grand",
          time: 39,
          addedAt: 2,
        },
      ],
    };
    const md2 = mergeVocabIntoMarkdown(md1, v1More);
    expect(md2.match(/# I Opened A FREE Carwash/g)?.length).toBe(1);
    expect(md2).toContain('**proposition**');
    expect(md2).toContain('| [0:39](https://www.youtube.com/watch?v=nJs7YXLYu0A&t=39s) | **grand**<br>`/ɡrænd/` | `n.` 一千美元<br>`adj.` 宏伟的 |');

    // Merge a second video
    const v2 = {
      videoId: 'abc123xyz',
      url: 'https://www.youtube.com/watch?v=abc123xyz',
      title: 'Another Video',
      items: [
        {
          word: 'awesome',
          phonetic: '/ˈɔsəm/',
          meaning: 'adj. 棒极了',
          sentence: 'That is awesome.',
          time: 12,
          addedAt: 3,
        },
      ],
    };
    const md3 = mergeVocabIntoMarkdown(md2, v2);
    expect(md3).toContain('# I Opened A FREE Carwash');
    expect(md3).toContain('# Another Video');
    expect(formatVideoVocabSection(v2)).toContain('https://www.youtube.com/watch?v=abc123xyz&t=12s');
    expect(buildObsidianAppendUri('| row |\n', false)).not.toContain('content=%0A');
  });
});

describe('Version comparison & GitHub updates.xml parser', () => {
  it('compares semver strings and parses Android updates.xml', () => {
    expect(compareSemver('0.1.2', '0.1.1')).toBe(1);
    expect(compareSemver('0.1.2', '0.1.2')).toBe(0);
    expect(compareSemver('0.1.1', '0.2.0')).toBe(-1);

    const parsed = parseAndroidUpdatesXml(
      "<gupdate><app appid='abc'><updatecheck codebase='https://example.com/a.crx' version='0.1.2' /></app></gupdate>",
    );
    expect(parsed).toEqual({ version: '0.1.2', codebase: 'https://example.com/a.crx' });
  });
});
