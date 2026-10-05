// Loads the generated static data files.

const base = new URL('../../data/', import.meta.url);

async function json(name) {
  const res = await fetch(new URL(name, base));
  if (!res.ok) throw new Error(`Could not load data/${name} (${res.status})`);
  return res.json();
}

export const DB = {
  kanji: {},      // char -> { l, s, m[], on[], kn[], sim[] }
  words: {},      // char -> [{ w, r, m, l }]
  sentences: {},  // char -> [{ j, e }]
  groups: {},     // group name -> [chars]
  chars: [],
};

export async function loadData() {
  const [kanji, words, sentences, groups] = await Promise.all([
    json('kanji.json'), json('words.json'), json('sentences.json'), json('groups.json'),
  ]);
  Object.assign(DB, { kanji, words, sentences, groups });
  DB.chars = Object.keys(kanji);
  return DB;
}

export const charsOfLevel = (lv) => DB.chars.filter((c) => DB.kanji[c].l === lv);
export const wordsOf = (c) => DB.words[c] || [];
export const sentencesOf = (c) => DB.sentences[c] || [];

const svgCache = new Map();

/** Fetch the KanjiVG stroke paths for a character (cached). */
export async function strokeSvg(char) {
  if (svgCache.has(char)) return svgCache.get(char);
  const file = `svg/${char.codePointAt(0).toString(16)}.svg`;
  const p = fetch(new URL(file, base))
    .then((r) => (r.ok ? r.text() : null))
    .catch(() => null);
  svgCache.set(char, p);
  return p;
}
