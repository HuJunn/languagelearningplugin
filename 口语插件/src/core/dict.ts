import type { DictEntry } from './types';

/** Compact dictionary map: word -> [phonetic, translation] */
export type CompactDict = Record<string, [string, string]>;

const IRREGULAR_LEMMAS: Record<string, string> = {
  am: 'be',
  is: 'be',
  are: 'be',
  was: 'be',
  were: 'be',
  been: 'be',
  being: 'be',
  had: 'have',
  has: 'have',
  having: 'have',
  did: 'do',
  does: 'do',
  doing: 'do',
  done: 'do',
  went: 'go',
  gone: 'go',
  going: 'go',
  goes: 'go',
  got: 'get',
  gotten: 'get',
  getting: 'get',
  said: 'say',
  says: 'say',
  saying: 'say',
  made: 'make',
  making: 'make',
  knew: 'know',
  known: 'know',
  took: 'take',
  taken: 'take',
  taking: 'take',
  saw: 'see',
  seen: 'see',
  seeing: 'see',
  came: 'come',
  coming: 'come',
  thought: 'think',
  told: 'tell',
  telling: 'tell',
  gave: 'give',
  given: 'give',
  giving: 'give',
  found: 'find',
  felt: 'feel',
  left: 'leave',
  leaving: 'leave',
  put: 'put',
  putting: 'put',
  meant: 'mean',
  kept: 'keep',
  let: 'let',
  letting: 'let',
  began: 'begin',
  begun: 'begin',
  beginning: 'begin',
  ran: 'run',
  running: 'run',
  wrote: 'write',
  written: 'write',
  writing: 'write',
  stood: 'stand',
  heard: 'hear',
  met: 'meet',
  paid: 'pay',
  paying: 'pay',
  sat: 'sit',
  sitting: 'sit',
  spoke: 'speak',
  spoken: 'speak',
  lost: 'lose',
  losing: 'lose',
  bought: 'buy',
  buying: 'buy',
  brought: 'bring',
  caught: 'catch',
  taught: 'teach',
  built: 'build',
  sent: 'send',
  spent: 'spend',
  fell: 'fall',
  fallen: 'fall',
  cut: 'cut',
  cutting: 'cut',
  sold: 'sell',
  held: 'hold',
  understood: 'understand',
  drew: 'draw',
  drawn: 'draw',
  broke: 'break',
  broken: 'break',
  chose: 'choose',
  chosen: 'choose',
  drove: 'drive',
  driven: 'drive',
  driving: 'drive',
  ate: 'eat',
  eaten: 'eat',
  flew: 'fly',
  flown: 'fly',
  forgot: 'forget',
  forgotten: 'forget',
  grew: 'grow',
  grown: 'grow',
  hid: 'hide',
  hidden: 'hide',
  rode: 'ride',
  ridden: 'ride',
  rose: 'rise',
  risen: 'rise',
  sang: 'sing',
  sung: 'sing',
  sank: 'sink',
  sunk: 'sink',
  slept: 'sleep',
  stole: 'steal',
  stolen: 'steal',
  swam: 'swim',
  swum: 'swim',
  threw: 'throw',
  thrown: 'throw',
  woke: 'wake',
  woken: 'wake',
  wore: 'wear',
  worn: 'wear',
  won: 'win',
  winning: 'win',
  men: 'man',
  women: 'woman',
  children: 'child',
  feet: 'foot',
  teeth: 'tooth',
  mice: 'mouse',
  people: 'person',
  lives: 'life',
  wives: 'wife',
  knives: 'knife',
  leaves: 'leaf',
  halves: 'half',
  selves: 'self',
  better: 'good',
  best: 'good',
  worse: 'bad',
  worst: 'bad',
  farther: 'far',
  further: 'far',
  farthest: 'far',
  furthest: 'far',
};

const CONTRACTION_BASE: Record<string, string> = {
  "what's": 'what',
  "that's": 'that',
  "it's": 'it',
  "he's": 'he',
  "she's": 'she',
  "there's": 'there',
  "here's": 'here',
  "who's": 'who',
  "how's": 'how',
  "where's": 'where',
  "let's": 'let',
  "i'm": 'I',
  "you're": 'you',
  "we're": 'we',
  "they're": 'they',
  "i've": 'have',
  "you've": 'have',
  "we've": 'have',
  "they've": 'have',
  "i'll": 'will',
  "you'll": 'will',
  "he'll": 'will',
  "she'll": 'will',
  "we'll": 'will',
  "they'll": 'will',
  "it'll": 'will',
  "i'd": 'would',
  "you'd": 'would',
  "he'd": 'would',
  "she'd": 'would',
  "we'd": 'would',
  "they'd": 'would',
  "don't": 'do',
  "doesn't": 'do',
  "didn't": 'do',
  "can't": 'can',
  "couldn't": 'could',
  "won't": 'will',
  "wouldn't": 'would',
  "shouldn't": 'should',
  "isn't": 'be',
  "aren't": 'be',
  "wasn't": 'be',
  "weren't": 'be',
  "haven't": 'have',
  "hasn't": 'have',
  "hadn't": 'have',
};

/** 清洗点击的单词文本，提取小写查询词 */
export function cleanWord(raw: string): string {
  return raw
    .trim()
    .replace(/[’‘]/g, "'")
    .replace(/^[^a-zA-Z0-9$]+|[^a-zA-Z0-9']+$/g, '')
    .toLowerCase();
}

/** 生成单词可能的词根/原形候选列表（按优先级排序） */
export function candidateLemmas(word: string): string[] {
  const w = cleanWord(word);
  if (!w) return [];
  const out: string[] = [w];
  const push = (c: string) => {
    if (c && c.length >= 2 && !out.includes(c)) out.push(c);
  };

  if (CONTRACTION_BASE[w]) push(CONTRACTION_BASE[w].toLowerCase());
  if (w.endsWith("'s") || w.endsWith("s'")) push(w.slice(0, -2));
  if (IRREGULAR_LEMMAS[w]) push(IRREGULAR_LEMMAS[w]);

  // -ies -> -y (tries -> try, cities -> city)
  if (w.endsWith('ies') && w.length > 4) push(w.slice(0, -3) + 'y');
  // -es -> base (washes -> wash, boxes -> box, goes -> go, heroes -> hero)
  if (w.endsWith('es') && w.length > 3) {
    push(w.slice(0, -2));
    push(w.slice(0, -1));
  }
  // -s -> base
  if (w.endsWith('s') && !w.endsWith('ss') && w.length > 2) push(w.slice(0, -1));

  // -ied -> -y (worried -> worry)
  if (w.endsWith('ied') && w.length > 4) push(w.slice(0, -3) + 'y');
  // -ed -> base / base+e / undoubled consonant (opened -> open, liked -> like, stopped -> stop)
  if (w.endsWith('ed') && w.length > 3) {
    const stem = w.slice(0, -2);
    push(stem);
    push(w.slice(0, -1));
    if (stem.length >= 3 && stem[stem.length - 1] === stem[stem.length - 2]) {
      push(stem.slice(0, -1));
    }
  }

  // -ing -> base / base+e / undoubled consonant (wondering -> wonder, making -> make, running -> run)
  if (w.endsWith('ing') && w.length > 4) {
    const stem = w.slice(0, -3);
    push(stem);
    push(stem + 'e');
    if (stem.length >= 3 && stem[stem.length - 1] === stem[stem.length - 2]) {
      push(stem.slice(0, -1));
    }
  }

  // -er / -est (bigger -> big, nicer -> nice, happier -> happy)
  if (w.endsWith('ier') && w.length > 4) push(w.slice(0, -3) + 'y');
  if (w.endsWith('iest') && w.length > 5) push(w.slice(0, -4) + 'y');
  if (w.endsWith('er') && w.length > 4) {
    const stem = w.slice(0, -2);
    push(stem);
    push(stem + 'e');
    if (stem.length >= 3 && stem[stem.length - 1] === stem[stem.length - 2]) push(stem.slice(0, -1));
  }
  if (w.endsWith('est') && w.length > 5) {
    const stem = w.slice(0, -3);
    push(stem);
    push(stem + 'e');
    if (stem.length >= 3 && stem[stem.length - 1] === stem[stem.length - 2]) push(stem.slice(0, -1));
  }

  // -ly -> adj (basically -> basic, happily -> happy, simply -> simple)
  if (w.endsWith('ally') && w.length > 5) push(w.slice(0, -4));
  if (w.endsWith('ily') && w.length > 4) push(w.slice(0, -3) + 'y');
  if (w.endsWith('ly') && w.length > 4) {
    push(w.slice(0, -2));
    push(w.slice(0, -2) + 'e');
  }

  return out;
}

/** 在离线词典中查询单词，支持词形变化自动还原 */
export function lookupOfflineDict(rawWord: string, dict: CompactDict): DictEntry | null {
  const cleaned = cleanWord(rawWord);
  if (!cleaned) return null;

  // 数字金额特殊处理（如 $10,000）
  if (/^\$?\d[\d,.]*$/.test(rawWord.trim())) {
    return {
      word: rawWord.trim(),
      phonetic: '',
      translation: `num. 数值 / 金额：${rawWord.trim()}`,
    };
  }

  const candidates = candidateLemmas(cleaned);
  for (let i = 0; i < candidates.length; i++) {
    const cand = candidates[i];
    const hit = dict[cand];
    if (hit) {
      let [phon, trans] = hit;
      let lemma = i > 0 ? cand : undefined;
      if (trans.startsWith('@')) {
        const ref = trans.slice(1);
        const target = dict[ref];
        if (target) {
          lemma = ref;
          phon = phon || target[0];
          trans = target[1];
        }
      }
      return {
        word: cleaned,
        lemma,
        phonetic: phon ? `/${phon.replace(/^\/|\/$/g, '')}/` : '',
        translation: trans,
      };
    }
  }
  return null;
}
