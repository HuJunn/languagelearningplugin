import fs from 'node:fs';
import path from 'node:path';

const ECDICT_PATH =
  'C:\\Users\\25370\\.gemini\\antigravity\\brain\\d187e9d2-1640-4572-be69-79cd41f84792\\scratch\\dict\\package\\data\\dict.dat';
const CMU_PATH =
  'C:\\Users\\25370\\.gemini\\antigravity\\brain\\d187e9d2-1640-4572-be69-79cd41f84792\\scratch\\dict\\cmu\\package\\index.js';
const OUT_PATH = path.resolve('public/dict.json');

const ARPABET_TO_IPA = {
  AA: 'ɑ',
  AE: 'æ',
  AH0: 'ə',
  AH: 'ʌ',
  AO: 'ɔ',
  AW: 'aʊ',
  AY: 'aɪ',
  B: 'b',
  CH: 'tʃ',
  D: 'd',
  DH: 'ð',
  EH: 'e',
  ER0: 'ər',
  ER: 'ɜːr',
  EY: 'eɪ',
  F: 'f',
  G: 'ɡ',
  HH: 'h',
  IH: 'ɪ',
  IY: 'iː',
  JH: 'dʒ',
  K: 'k',
  L: 'l',
  M: 'm',
  N: 'n',
  NG: 'ŋ',
  OW: 'oʊ',
  OY: 'ɔɪ',
  P: 'p',
  R: 'r',
  S: 's',
  SH: 'ʃ',
  T: 't',
  TH: 'θ',
  UH: 'ʊ',
  UW: 'uː',
  V: 'v',
  W: 'w',
  Y: 'j',
  Z: 'z',
  ZH: 'ʒ',
};

function arpabetToIpa(arpa) {
  if (!arpa) return '';
  const phones = arpa.trim().split(/\s+/);
  const multiSyllable = phones.filter((p) => /\d$/.test(p)).length > 1;
  let out = '';
  for (const ph of phones) {
    const m = /^([A-Z]+)(\d)?$/.exec(ph);
    if (!m) continue;
    const [, base, stress] = m;
    if (multiSyllable && stress === '1') out += 'ˈ';
    else if (multiSyllable && stress === '2') out += 'ˌ';
    const key = (base === 'AH' || base === 'ER') && stress === '0' ? `${base}0` : base;
    out += ARPABET_TO_IPA[key] ?? ARPABET_TO_IPA[base] ?? '';
  }
  return out;
}

const rawEcdict = JSON.parse(fs.readFileSync(ECDICT_PATH, 'utf8'));
const cmuMod = await import('file:///' + CMU_PATH.replace(/\\/g, '/'));
const cmu = cmuMod.dictionary;

/** @type {Record<string, [string, string]>} */
const out = Object.create(null);
/** @type {Record<string, string>} inflected -> lemma */
const forms = Object.create(null);

for (const [word, entry] of Object.entries(rawEcdict)) {
  const senses = entry[0];
  if (!Array.isArray(senses) || !senses.length) continue;
  const parts = [];
  for (const s of senses.slice(0, 3)) {
    const pos = s[0] ? `${s[0]} ` : '';
    const zhs = Array.isArray(s[1]) ? s[1].slice(0, 4).join('，') : '';
    if (zhs) parts.push(`${pos}${zhs}`);
  }
  if (!parts.length) continue;
  const ipa = arpabetToIpa(cmu[word]);
  out[word] = [ipa, parts.join('；')];

  // Parse ECDICT exchange forms: e.g. "p:opened/d:opened/i:opening/3:opens/s:washes"
  const exch = typeof entry[5] === 'string' ? entry[5] : '';
  if (exch) {
    for (const seg of exch.split('/')) {
      const idx = seg.indexOf(':');
      if (idx < 0) continue;
      const code = seg.slice(0, idx);
      const val = seg.slice(idx + 1).trim().toLowerCase();
      if (val && val !== word && /^[a-z'-]+$/.test(val) && code !== '0' && code !== '1') {
        if (!forms[val]) forms[val] = word;
      }
    }
  }
}

// High-frequency spoken / colloquial supplements
const EXTRA = {
  guys: ['ɡaɪz', 'n. 伙计们，大家，各位（guy 的复数）'],
  epic: ['ˈepɪk', 'adj. 史诗般的；宏大的；（口）超棒的，绝了；n. 史诗'],
  grand: ['ɡrænd', 'adj. 宏伟的；盛大的；n. （口）一千美元（如 10 grand = 一万美元）'],
  yeah: ['jeə', 'adv. 是的，对（yes 的口语形式）'],
  hell: ['hel', 'n. 地狱；hell yeah（口）那必须的，太好了'],
  wanna: ['ˈwɑnə', 'v. （口）想要（= want to / want a）'],
  gonna: ['ˈɡɔnə', 'v. （口）将要，打算（= going to）'],
  gotta: ['ˈɡɑtə', 'v. （口）必须，得（= got to / have got to）'],
  kinda: ['ˈkaɪndə', 'adv. （口）有一点，算是（= kind of）'],
  sorta: ['ˈsɔrtə', 'adv. （口）有点儿（= sort of）'],
  lemme: ['ˈlemi', 'v. （口）让我（= let me）'],
  gimme: ['ˈɡɪmi', 'v. （口）给我（= give me）'],
  dunno: ['dəˈnoʊ', 'v. （口）不知道（= don’t know）'],
  awesome: ['ˈɔsəm', 'adj. 极好的，棒极了；令人惊叹的'],
  basically: ['ˈbeɪsɪkli', 'adv. 基本上，大体上，说白了'],
  proposition: ['ˌprɑpəˈzɪʃn', 'n. 提议，建议；主张；命题'],
  wondering: ['ˈwʌndərɪŋ', 'v. 想知道，琢磨（I was wondering if... 委婉询问“我想问能不能…”）'],
  carwash: ['ˈkɑrwɑʃ', 'n. 洗车店，洗车服务'],
  bro: ['broʊ', 'n. （口）兄弟，哥们儿'],
  dude: ['duːd', 'n. （口）老兄，家伙'],
  nope: ['noʊp', 'adv. （口）不，没有'],
  yep: ['jep', 'adv. （口）是的，没错'],
  congrats: ['kənˈɡræts', 'n. （口）恭喜，祝贺（= congratulations）'],
  appreciate: ['əˈpriːʃieɪt', 'v. 感激，感谢；欣赏；体会'],
};

for (const [k, v] of Object.entries(EXTRA)) {
  out[k] = v;
}

// Attach inflection forms that aren't already headwords as "@lemma" pointers or include them
for (const [inflected, lemma] of Object.entries(forms)) {
  if (!out[inflected] && out[lemma]) {
    const ipa = arpabetToIpa(cmu[inflected]) || out[lemma][0];
    out[inflected] = [ipa, `@${lemma}`];
  }
}

fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
fs.writeFileSync(OUT_PATH, JSON.stringify(out));
console.log(`Built ${OUT_PATH}: ${Object.keys(out).length} entries (${(fs.statSync(OUT_PATH).size / 1024 / 1024).toFixed(2)} MB)`);
