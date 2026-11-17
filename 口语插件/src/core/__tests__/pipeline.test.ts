import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { buildTranscript } from '../pipeline';
import { alignManualToAsr } from '../align';
import { parseAsrJson3, parseCustomTranscriptCues } from '../captions';
import { findSentenceAt, findSentenceBefore } from '../segment';

const SUB_PATH =
  'C:\\Users\\25370\\.gemini\\antigravity\\brain\\d187e9d2-1640-4572-be69-79cd41f84792\\scratch\\subs\\nJs7YXLYu0A.en.json3';
const THEATER_SUB_PATH =
  'C:\\Users\\25370\\.gemini\\antigravity\\brain\\d187e9d2-1640-4572-be69-79cd41f84792\\scratch\\subs\\X3WjbiXyu8Y.en.json3';
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

    // Ensure every sentence starts strictly at its first word's timestamp and has a natural tail pad
    for (let i = 0; i < tr.sentences.length; i++) {
      const s = tr.sentences[i];
      expect(s.start).toBe(s.words[0].start);
      expect(s.end).toBeGreaterThanOrEqual(s.words[s.words.length - 1].end + 0.15);
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

  it('preserves exact first-word start time on X3WjbiXyu8Y around 50s ("We have one theater fully rented out...") for both json3 and srv3 XML', () => {
    const rawJson3 = JSON.parse(fs.readFileSync(THEATER_SUB_PATH, 'utf8'));
    const trJson3 = buildTranscript({ videoId: 'X3WjbiXyu8Y', asrJson3: rawJson3 });
    const sent1 = trJson3.sentences.find((s) => s.text.startsWith('We have one theater fully rented out'));
    expect(sent1).toBeDefined();
    // "We" must start at ~50.52s, strictly before "fully" at 51.40s
    expect(sent1!.start).toBeCloseTo(50.52, 2);
    expect(sent1!.words[0].text).toBe('We');
    expect(sent1!.words[0].start).toBeCloseTo(50.52, 2);
    const fullyWord1 = sent1!.words.find((w) => w.text === 'fully')!;
    expect(fullyWord1.start).toBeCloseTo(51.4, 2);
    expect(sent1!.words[0].start).toBeLessThan(fullyWord1.start - 0.8);

    // Also test srv3 XML (both with <s> tags and fallback without <s> tags)
    const srv3WithS = `<?xml version="1.0" encoding="utf-8" ?><timedtext format="3"><body>
      <p t="48080" d="3320" w="1">&gt;&gt; So,<s t="360"> what</s><s t="640"> what</s><s t="840"> Let&#39;s</s><s t="1040"> I</s><s t="1080"> guess</s><s t="1240"> let&#39;s</s></p>
      <p t="49560" d="4360" w="1">discuss<s t="360"> the</s><s t="480"> plan.</s><s t="960"> We</s><s t="1080"> have</s><s t="1240"> one</s><s t="1400"> theater</s></p>
      <p t="51400" d="4040" w="1">fully<s t="320"> rented</s><s t="640"> out</s><s t="800"> right</s><s t="1000"> now</s><s t="1720"> plus</s><s t="2080"> the</s><s t="2240"> gift</s></p>
      <p t="53920" d="2600" w="1">cards<s t="360"> that</s><s t="560"> you</s><s t="720"> have,</s><s t="960"> right?</s></p>
    </body></timedtext>`;
    const trSrv3 = buildTranscript({ videoId: 'X3WjbiXyu8Y', asrXml: srv3WithS });
    expect(trSrv3.source).toBe('asr');
    const sent2 = trSrv3.sentences.find((s) => s.text.startsWith('We have one theater fully rented out'))!;
    expect(sent2).toBeDefined();
    expect(sent2.start).toBeCloseTo(50.52, 2);
    expect(sent2.words.find((w) => w.text === 'fully')!.start).toBeCloseTo(51.4, 2);

    // Fallback plain XML (no <s> tags, overlapping durations d=4360 and t=51400)
    const plainXml = srv3WithS.replace(/<\/?s[^>]*>/g, '');
    const trPlain = buildTranscript({ videoId: 'X3WjbiXyu8Y', asrXml: plainXml });
    const sent3 = trPlain.sentences.find((s) => s.text.startsWith('We have one theater fully rented out'))!;
    expect(sent3).toBeDefined();
    // Because overlapping cue durations are truncated at next cue start (51.40s), "We" is strictly before "fully" (51.40s)
    expect(sent3.words[0].start).toBeLessThan(sent3.words.find((w) => w.text === 'fully')!.start);
  });
});
