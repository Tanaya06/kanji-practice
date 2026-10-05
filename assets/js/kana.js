// Kana helpers + fuzzy answer checking.

const ROMAJI = {
  kya: 'きゃ', kyu: 'きゅ', kyo: 'きょ', sha: 'しゃ', shu: 'しゅ', sho: 'しょ', sya: 'しゃ', syu: 'しゅ', syo: 'しょ',
  cha: 'ちゃ', chu: 'ちゅ', cho: 'ちょ', tya: 'ちゃ', tyu: 'ちゅ', tyo: 'ちょ', nya: 'にゃ', nyu: 'にゅ', nyo: 'にょ',
  hya: 'ひゃ', hyu: 'ひゅ', hyo: 'ひょ', mya: 'みゃ', myu: 'みゅ', myo: 'みょ', rya: 'りゃ', ryu: 'りゅ', ryo: 'りょ',
  gya: 'ぎゃ', gyu: 'ぎゅ', gyo: 'ぎょ', ja: 'じゃ', ju: 'じゅ', jo: 'じょ', jya: 'じゃ', jyu: 'じゅ', jyo: 'じょ',
  zya: 'じゃ', zyu: 'じゅ', zyo: 'じょ', bya: 'びゃ', byu: 'びゅ', byo: 'びょ', pya: 'ぴゃ', pyu: 'ぴゅ', pyo: 'ぴょ',
  dya: 'ぢゃ', dyu: 'ぢゅ', dyo: 'ぢょ', fa: 'ふぁ', fi: 'ふぃ', fe: 'ふぇ', fo: 'ふぉ', vu: 'ゔ',
  shi: 'し', chi: 'ち', tsu: 'つ', ji: 'じ', si: 'し', ti: 'ち', tu: 'つ', zi: 'じ', di: 'ぢ', du: 'づ', fu: 'ふ', hu: 'ふ',
  ka: 'か', ki: 'き', ku: 'く', ke: 'け', ko: 'こ', sa: 'さ', su: 'す', se: 'せ', so: 'そ',
  ta: 'た', te: 'て', to: 'と', na: 'な', ni: 'に', nu: 'ぬ', ne: 'ね', no: 'の',
  ha: 'は', hi: 'ひ', he: 'へ', ho: 'ほ', ma: 'ま', mi: 'み', mu: 'む', me: 'め', mo: 'も',
  ya: 'や', yu: 'ゆ', yo: 'よ', ra: 'ら', ri: 'り', ru: 'る', re: 'れ', ro: 'ろ', wa: 'わ', wo: 'を',
  ga: 'が', gi: 'ぎ', gu: 'ぐ', ge: 'げ', go: 'ご', za: 'ざ', zu: 'ず', ze: 'ぜ', zo: 'ぞ',
  da: 'だ', de: 'で', do: 'ど', ba: 'ば', bi: 'び', bu: 'ぶ', be: 'べ', bo: 'ぼ',
  pa: 'ぱ', pi: 'ぴ', pu: 'ぷ', pe: 'ぺ', po: 'ぽ',
  a: 'あ', i: 'い', u: 'う', e: 'え', o: 'お', n: 'ん', '-': 'ー'
};

/** Convert any leftover latin letters in `text` to hiragana (wāpuro style). */
export function romajiToKana(text) {
  let out = '';
  let i = 0;
  const s = text.toLowerCase().replace(/nn/g, "n'");
  while (i < s.length) {
    const c = s[i];
    if (!/[a-z'-]/.test(c)) { out += c; i++; continue; }
    if (c === "'") { i++; continue; }
    // small tsu: doubled consonant
    if (/[a-z]/.test(c) && c !== 'n' && s[i + 1] === c) { out += 'っ'; i++; continue; }
    let matched = false;
    for (const len of [3, 2, 1]) {
      const chunk = s.slice(i, i + len);
      if (ROMAJI[chunk]) {
        // "n" alone only converts when not the start of another syllable
        if (chunk === 'n' && /^[aiueoy]/.test(s[i + 1] || '')) break;
        out += ROMAJI[chunk]; i += len; matched = true; break;
      }
    }
    if (!matched) { out += c; i++; }
  }
  return out;
}

export const toHiragana = (s) => (s || '').replace(/[\u30a1-\u30f6]/g, (m) => String.fromCharCode(m.charCodeAt(0) - 0x60));
export const toKatakana = (s) => (s || '').replace(/[\u3041-\u3096]/g, (m) => String.fromCharCode(m.charCodeAt(0) + 0x60));

/** Strip KANJIDIC markers: 待つ is stored as "ま.つ", prefixes/suffixes as "-び". */
export const readingCore = (r) => toHiragana((r || '').replace(/[.\-ー―]/g, '').trim());
export const readingFull = (r) => toHiragana((r || '').replace(/[-]/g, '').replace(/\./g, '').trim());
/** Part before the "." — the bit actually written with the kanji. */
export const readingStem = (r) => toHiragana((r || '').split('.')[0].replace(/-/g, '').trim());

export function normaliseReadingInput(text, autoRomaji = true) {
  let s = (text || '').trim();
  if (autoRomaji) s = romajiToKana(s);
  return toHiragana(s).replace(/[\s.\-・]/g, '');
}

/** Does the typed reading match any accepted reading? */
export function checkReading(input, readings, autoRomaji = true) {
  const got = normaliseReadingInput(input, autoRomaji);
  if (!got) return false;
  return readings.some((r) => {
    const full = readingCore(r);
    return got === full || got === readingStem(r);
  });
}

const STOP = new Set(['a', 'an', 'the', 'to', 'of', 'in', 'on', 'at', 'is', 'are', 'be', 'it', 'and', 'or', 'etc', 'one', 'with', 'for', 'that', 'this']);

export function normaliseEn(text) {
  return (text || '').toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const contentWords = (s) => normaliseEn(s).split(' ').filter((w) => w && !STOP.has(w));

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (Math.abs(m - n) > 2) return 99;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

/** True when the typed English is "close enough" to one of the accepted meanings. */
export function checkMeaning(input, meanings) {
  const got = normaliseEn(input);
  if (!got) return false;
  const gotWords = new Set(contentWords(got));
  if (!gotWords.size) return false;

  for (const raw of meanings) {
    for (const variant of String(raw).split(/[,;/]|\bor\b/)) {
      const want = normaliseEn(variant);
      if (!want) continue;
      if (got === want) return true;
      const wantWords = contentWords(want);
      if (!wantWords.length) continue;
      // every content word of the expected meaning was typed (order free)
      if (wantWords.every((w) => gotWords.has(w))) return true;
      // single-word answers tolerate a typo
      if (wantWords.length === 1 && [...gotWords].some((w) => w.length > 3 && levenshtein(w, wantWords[0]) <= 1)) return true;
    }
  }
  return false;
}

/** Loose scoring for free-form sentence translations: share of key words hit. */
export function sentenceScore(input, expected) {
  const want = contentWords(expected);
  if (!want.length) return 0;
  const got = new Set(contentWords(input));
  let hit = 0;
  for (const w of want) {
    if (got.has(w)) { hit++; continue; }
    if ([...got].some((g) => g.length > 3 && levenshtein(g, w) <= 1)) hit++;
  }
  return hit / want.length;
}
