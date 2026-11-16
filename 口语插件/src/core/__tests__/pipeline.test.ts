import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { buildTranscript } from '../pipeline';
import { alignManualToAsr } from '../align';
import { parseAsrJson3, parseCustomTranscriptCues } from '../captions';
import { findSentenceAt, findSentenceBefore } from '../segment';

const SUB_PATH =
  'C:\\Users\\25370\\.gemini\\antigravity\\brain\\d187e9d2-1640-4572-be69-79cd41f84792\\scratch\\subs\\nJs7YXLYu0A.en.json3';
const CLIPPING_PATH = 'E:\\CODEX\\codex-obsidian\\Clippings\\I Opened A FREE Carwash.md';

describe('YouTube caption pipeline on nJs7YXLYu0A (I Opened A FREE Carwash)', () => {
  it('parses ASR json3 with word-level timestamps and segments into clean sentences', () => {
    const raw = JSON.parse(fs.readFileSync(SUB_PATH, 'utf8'));
    const tr = buildTranscript({ videoId: 'nJs7YXLYu0A', asrJson3: raw });

    expect(tr.source).toBe('asr');
    expect(tr.sentences.length).toBeGreaterThan(80);

    // Check first 5 sentences
    expect(tr.sentences[0].text).toBe("What's up, guys?");
    expect(tr.sentences[1].text).toBe('Welcome back to That Was Epic.');
    expect(tr.sentences[2].text).toBe('Today, I opened a free car wash.');
    expect(tr.sentences[3].text).toBe("How's it going?");
    expect(tr.sentences[4].text).toBe('Good.');

    // Verify every word has valid monotonic start/end timestamps
    for (const s of tr.sentences) {
      expect(s.words.length).toBeGreaterThan(0);
      expect(s.start).toBeLessThan(s.end);
      for (let i = 0; i < s.words.length; i++) {
        const w = s.words[i];
        expect(w.start).toBeLessThan(w.end);
        if (i > 0) {
          expect(w.start).toBeGreaterThanOrEqual(s.words[i - 1].start);
        }
      }
    }

    // Binary search helpers
    const idx = findSentenceAt(tr.sentences, tr.sentences[2].start + 0.05);
    expect(idx).toBe(2);
    expect(findSentenceBefore(tr.sentences, tr.sentences[2].start + 0.05)).toBe(2);

    // Ensure sentence[i].end never overlaps or equals sentence[i+1].start (prevents auto-pause jumping to next sentence)
    for (let i = 0; i < tr.sentences.length - 1; i++) {
      expect(tr.sentences[i].end).toBeLessThan(tr.sentences[i + 1].start);
      expect(findSentenceAt(tr.sentences, tr.sentences[i].end)).not.toBe(i + 1);
    }
  });

  it('aligns Manual cues against ASR words, replacing ASR errors while preserving word-level timing', () => {
    const raw = JSON.parse(fs.readFileSync(SUB_PATH, 'utf8'));
    const asrWords = parseAsrJson3(raw).filter((w) => w.start < 32);

    // In ASR at 0:26, YouTube recognized: "How do we me call my boss and we'll make that happen."
    // Suppose manual subtitle has the corrected line: "Let me call my boss and we'll make that happen."
    const manualCues = [
      { start: 0.0, end: 5.2, text: "What's up, guys? Welcome back to That Was Epic. Today, I opened a free car wash." },
      { start: 11.5, end: 13.2, text: "How's it going?" },
      { start: 26.5, end: 29.2, text: "Let me call my boss and we'll make that happen." },
    ];

    const { words, stats } = alignManualToAsr(manualCues, asrWords);
    expect(stats.total).toBeGreaterThan(20);
    expect(stats.matched).toBeGreaterThan(18);

    // Verify the corrected sentence has "Let me call my boss..." with ASR timestamps
    const joined = words.map((w) => w.text).join(' ');
    expect(joined).toContain("Let me call my boss and we'll make that happen.");

    const bossWord = words.find((w) => w.text === 'boss');
    expect(bossWord).toBeDefined();
    expect(bossWord!.timing).toBe('asr');
    expect(bossWord!.start).toBeGreaterThan(26);
    expect(bossWord!.start).toBeLessThan(29);
  });

  it('parses the Obsidian Clipper markdown file and aligns it with ASR word-level timestamps', () => {
    const rawJson3 = JSON.parse(fs.readFileSync(SUB_PATH, 'utf8'));
    const md = fs.readFileSync(CLIPPING_PATH, 'utf8').replace(
      "How do we me call my boss and we'll make that happen.",
      "Let me call my boss and we'll make that happen.",
    );
    const cues = parseCustomTranscriptCues(md);
    expect(cues.length).toBeGreaterThan(70);

    const tr = buildTranscript({
      videoId: 'nJs7YXLYu0A',
      asrJson3: rawJson3,
      customManualCues: cues,
    });
    expect(tr.source).toBe('manual+asr');
    expect(tr.alignStats!.matched).toBeGreaterThan(1000);
    const fixedSentence = tr.sentences.find((s) => s.text.includes('Let me call my boss'));
    expect(fixedSentence).toBeDefined();
    expect(fixedSentence!.words.some((w) => w.timing === 'asr')).toBe(true);
  });
});
