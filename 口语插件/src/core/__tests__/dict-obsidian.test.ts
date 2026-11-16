import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { lookupOfflineDict, CompactDict } from '../dict';
import { formatVideoVocabSection, mergeVocabIntoMarkdown, OBSIDIAN_OPEN_URI } from '../obsidian';

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

describe('Obsidian vocabulary markdown formatter & merger', () => {
  it('groups vocabulary by original video link and deduplicates on repeated merges', () => {
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
          time: 18,
          addedAt: 1,
        },
      ],
    };

    const md1 = mergeVocabIntoMarkdown('', v1);
    expect(md1).toContain('# 生词表');
    expect(md1).toContain('## [I Opened A FREE Carwash](https://www.youtube.com/watch?v=nJs7YXLYu0A)');
    expect(md1).toContain('- **proposition** `/ˌprɑpəˈzɪʃn/` — n. 提议，建议 · [0:18](https://www.youtube.com/watch?v=nJs7YXLYu0A&t=18s)');

    // Merge another word into the same video section
    const v1More = {
      ...v1,
      items: [
        ...v1.items,
        {
          word: 'grand',
          phonetic: '/ɡrænd/',
          meaning: 'n. 一千美元',
          sentence: "he's going to hand me 10 grand",
          time: 39,
          addedAt: 2,
        },
      ],
    };
    const md2 = mergeVocabIntoMarkdown(md1, v1More);
    // Should still only have ONE header for this video
    expect(md2.match(/## \[I Opened A FREE Carwash\]/g)?.length).toBe(1);
    expect(md2).toContain('- **proposition**');
    expect(md2).toContain('- **grand**');

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
    expect(md3).toContain('## [I Opened A FREE Carwash](https://www.youtube.com/watch?v=nJs7YXLYu0A)');
    expect(md3).toContain('## [Another Video](https://www.youtube.com/watch?v=abc123xyz)');
    expect(formatVideoVocabSection(v2)).toContain('https://www.youtube.com/watch?v=abc123xyz&t=12s');
  });
});
