let edgeTokenCache: { token: string; expiresAt: number } | null = null;

async function getEdgeTranslateToken(): Promise<string> {
  const now = Date.now();
  if (edgeTokenCache && edgeTokenCache.expiresAt > now) {
    return edgeTokenCache.token;
  }
  const resp = await fetch('https://edge.microsoft.com/translate/auth', {
    method: 'GET',
    cache: 'no-store',
  });
  if (!resp.ok) throw new Error(`Edge auth HTTP ${resp.status}`);
  const token = (await resp.text()).trim();
  if (!token) throw new Error('Empty Edge auth token');
  edgeTokenCache = { token, expiresAt: now + 8 * 60 * 1000 };
  return token;
}

/** 使用 Microsoft Edge 内置翻译接口批量翻译（支持国内直连与批量数组） */
export async function translateViaEdge(texts: string[], to = 'zh-Hans'): Promise<string[]> {
  if (!texts.length) return [];
  const token = await getEdgeTranslateToken();
  const url = `https://api-edge.cognitive.microsofttranslator.com/translate?from=en&to=${encodeURIComponent(to)}&api-version=3.0`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(texts.map((t) => ({ Text: t }))),
  });
  if (!resp.ok) {
    edgeTokenCache = null;
    throw new Error(`Edge translate HTTP ${resp.status}`);
  }
  const data = (await resp.json()) as Array<{ translations?: Array<{ text?: string }> }>;
  return data.map((item) => item?.translations?.[0]?.text?.trim() ?? '');
}

/** 使用 Google GTX 免费接口翻译（支持词典义项 dt=bd） */
export async function translateViaGoogle(text: string, to = 'zh-CN'): Promise<{ text: string; dictTerms?: string[] }> {
  const url =
    `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=${encodeURIComponent(to)}` +
    `&dt=t&dt=bd&q=${encodeURIComponent(text)}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Google translate HTTP ${resp.status}`);
  const data = await resp.json();
  const mainText = Array.isArray(data?.[0])
    ? data[0]
        .map((seg: unknown[]) => (typeof seg?.[0] === 'string' ? seg[0] : ''))
        .join('')
        .trim()
    : '';
  const dictTerms: string[] = [];
  if (Array.isArray(data?.[1])) {
    for (const posBlock of data[1]) {
      const pos = typeof posBlock?.[0] === 'string' ? `${posBlock[0]}. ` : '';
      const terms = Array.isArray(posBlock?.[1]) ? posBlock[1].slice(0, 4).join('，') : '';
      if (terms) dictTerms.push(`${pos}${terms}`);
    }
  }
  return { text: mainText, dictTerms: dictTerms.length ? dictTerms : undefined };
}

/** 单词在线翻译：优先尝试同时拿词典义项或上下文译文（Edge + Google 双通道自动降级） */
export async function translateWordOnline(
  word: string,
  sentence?: string,
): Promise<{ wordTranslation: string; sentenceTranslation?: string; provider: 'edge' | 'google' }> {
  // 先用 Edge 批量翻译 [word, sentence]（在 Edge 浏览器下最快最稳）
  try {
    const inputs = sentence ? [word, sentence] : [word];
    const res = await translateViaEdge(inputs, 'zh-Hans');
    if (res[0]) {
      return {
        wordTranslation: res[0],
        sentenceTranslation: res[1] || undefined,
        provider: 'edge',
      };
    }
  } catch {
    // fallback to Google
  }

  const gWord = await translateViaGoogle(word, 'zh-CN');
  let sentZh: string | undefined;
  if (sentence) {
    try {
      const gSent = await translateViaGoogle(sentence, 'zh-CN');
      sentZh = gSent.text;
    } catch {
      // ignore
    }
  }
  return {
    wordTranslation: gWord.dictTerms ? gWord.dictTerms.join('；') : gWord.text,
    sentenceTranslation: sentZh,
    provider: 'google',
  };
}

/** 批量翻译整句（每批最多 25 句） */
export async function translateSentencesBatch(sentences: string[]): Promise<string[]> {
  if (!sentences.length) return [];
  const BATCH_SIZE = 25;
  const out: string[] = new Array(sentences.length).fill('');

  for (let start = 0; start < sentences.length; start += BATCH_SIZE) {
    const chunk = sentences.slice(start, start + BATCH_SIZE);
    try {
      const res = await translateViaEdge(chunk, 'zh-Hans');
      for (let i = 0; i < chunk.length; i++) {
        out[start + i] = res[i] ?? '';
      }
      continue;
    } catch {
      // Fallback: join with newline for Google Translate
    }
    try {
      const joined = chunk.join('\n');
      const g = await translateViaGoogle(joined, 'zh-CN');
      const lines = g.text.split(/\r?\n/);
      for (let i = 0; i < chunk.length; i++) {
        out[start + i] = (lines[i] ?? '').trim();
      }
    } catch {
      // leave empty on failure
    }
  }
  return out;
}
