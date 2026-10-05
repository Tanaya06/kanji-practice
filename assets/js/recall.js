// Recall view: five drill types + session builder + grading.

import { DB, wordsOf, sentencesOf } from './data.js';
import { state, grade, weakChars, isDue, save } from './store.js';
import { $, $$, el, speak, speakBtn, shuffle, sample, toast } from './ui.js';
import { checkMeaning, checkReading, normaliseReadingInput, toHiragana, toKatakana, sentenceScore, readingCore } from './kana.js';

const MODES = ['m1', 'm2', 'm3', 'm4', 'm5'];
const MODE_NAME = {
  m1: 'Kanji → Meaning', m2: 'Kanji → Readings', m3: 'Word → Reading + Meaning',
  m4: 'Meaning → Kanji', m5: 'Sentence → Meaning',
};

let source = 'level';
const picked = new Set();
let session = null;

/* --------------------------------------------------------------- the pool */

function pool() {
  switch (source) {
    case 'all': return DB.chars;
    case 'mistakes': return weakChars();
    case 'due': return DB.chars.filter(isDue);
    case 'group': return DB.groups[$('#groupSelect').value] || [];
    case 'pick': return [...picked];
    default: {
      const levels = $$('#opt-level input:checked').map((i) => Number(i.value));
      return DB.chars.filter((c) => levels.includes(DB.kanji[c].l));
    }
  }
}

function updatePool() {
  const n = pool().length;
  const mode = $('input[name=mode]:checked').value;
  let note = `${n} kanji in the pool.`;
  if (source === 'mistakes' && !n) note = 'No mistakes recorded yet — do a session first.';
  if (source === 'due' && !n) note = 'Nothing is due right now. Pick a level to study ahead.';
  if (mode === 'm3') note += ` ${pool().filter((c) => wordsOf(c).length).length} have vocabulary.`;
  if (mode === 'm5') note += ` ${pool().filter((c) => sentencesOf(c).length).length} have sentences.`;
  $('#poolInfo').textContent = note;
  $('#startQuiz').disabled = n === 0;
}

/* -------------------------------------------------------- question making */

const stripSuru = (r) => r.replace(/(する|な|の)$/, '');

function makeQuestion(mode, char) {
  const k = DB.kanji[char];

  if (mode === 'm1') {
    return {
      mode, char,
      prompt: el('div', { class: 'big-kanji jp' }, char),
      hint: `N${k.l} · ${k.s} strokes`,
      fields: [{ label: 'Meaning in English', check: (v) => checkMeaning(v, k.m) }],
      answer: [k.m.join(', ')],
      reveal: [['Readings', [...k.on.map(toKatakana), ...k.kn].join('、')]],
      say: char,
    };
  }

  if (mode === 'm2') {
    const fields = [];
    if (k.on.length) fields.push({ label: "on'yomi (katakana or romaji)", jp: true, check: (v) => checkReading(v, k.on), expect: k.on.map(toKatakana).join('、') });
    if (k.kn.length) fields.push({ label: "kun'yomi (hiragana or romaji)", jp: true, check: (v) => checkReading(v, k.kn), expect: k.kn.join('、') });
    if (!fields.length) return null;
    return {
      mode, char,
      prompt: el('div', { class: 'big-kanji jp' }, char),
      hint: k.m.join(', '),
      fields,
      answer: fields.map((f) => f.expect),
      reveal: [['Meaning', k.m.join(', ')]],
      say: readingCore(k.kn[0] || k.on[0]),
    };
  }

  if (mode === 'm3') {
    const words = wordsOf(char);
    if (!words.length) return null;
    const w = sample(words);
    const reading = toHiragana(w.r);
    return {
      mode, char, word: w,
      prompt: el('div', { class: 'q-word jp' }, w.w),
      hint: `contains ${char} · N${w.l}`,
      fields: [
        { label: 'Reading (kana or romaji)', jp: true, check: (v) => { const g = normaliseReadingInput(v, autoRomaji()); return g === reading || g === stripSuru(reading) || stripSuru(g) === stripSuru(reading); }, expect: reading },
        { label: 'Meaning in English', check: (v) => checkMeaning(v, [w.m]), expect: w.m },
      ],
      answer: [reading, w.m],
      reveal: [[`Kanji ${char}`, DB.kanji[char].m.join(', ')]],
      say: w.w,
    };
  }

  if (mode === 'm4') {
    const words = wordsOf(char);
    const useWord = words.length && Math.random() < 0.5;
    const w = useWord ? sample(words) : null;
    const target = useWord ? w.w : char;
    const meaning = useWord ? w.m : k.m.join(', ');
    return {
      mode, char, target,
      prompt: el('div', { class: 'q-meaning' }, meaning),
      hint: useWord ? `a word written with ${w.w.length} character(s), reading ${toHiragana(w.r)}` : `a single kanji, ${k.s} strokes, N${k.l}`,
      fields: [{ label: 'Write it in Japanese (needs a Japanese IME)', jp: true, check: (v) => v.replace(/\s/g, '') === target, expect: target }],
      answer: [target],
      choices: useWord ? null : buildChoices(char),
      reveal: useWord ? [['Reading', toHiragana(w.r)]] : [['Readings', [...k.on.map(toKatakana), ...k.kn].join('、')]],
      say: target,
    };
  }

  // m5 - sentence meaning
  const sents = sentencesOf(char);
  if (!sents.length) return null;
  const s = sample(sents);
  return {
    mode, char, sentence: s,
    prompt: el('div', { class: 'q-sentence jp' }, s.j),
    hint: `uses ${char}`,
    fields: [{ label: 'What does it mean?', textarea: true, check: (v) => sentenceScore(v, s.e) >= 0.6, expect: s.e }],
    answer: [s.e],
    fuzzy: true,
    reveal: [[`Kanji ${char}`, DB.kanji[char].m.join(', ')]],
    say: s.j,
  };
}

function buildChoices(char) {
  const sim = (DB.kanji[char].sim || []).filter((c) => DB.kanji[c]);
  const others = shuffle([...sim, ...shuffle(DB.chars).slice(0, 12)]).filter((c) => c !== char);
  return shuffle([char, ...[...new Set(others)].slice(0, 7)]);
}

const autoRomaji = () => $('#optRomaji').checked;
const audioOn = () => $('#optAudio').checked;

function buildSession() {
  const chosen = $('input[name=mode]:checked').value;
  const size = Math.max(1, Number($('#sessionSize').value) || 15);
  const base = shuffle(pool());
  const questions = [];
  let guard = 0;

  while (questions.length < size && guard < size * 25 && base.length) {
    const char = base[guard % base.length];
    const mode = chosen === 'mix' ? sample(MODES) : chosen;
    const q = makeQuestion(mode, char);
    if (q) questions.push(q);
    guard++;
  }
  return questions.length ? { questions, i: 0, results: [] } : null;
}

/* --------------------------------------------------------------- the quiz */

function renderQuestion() {
  const box = $('#recallQuiz');
  const q = session.questions[session.i];
  box.replaceChildren();

  box.append(
    el('div', { class: 'quiz-top' },
      el('span', {}, `${session.i + 1} / ${session.questions.length}`),
      el('div', { class: 'bar' }, el('i', { style: `width:${(session.i / session.questions.length) * 100}%` })),
      el('span', {}, MODE_NAME[q.mode]),
      el('button', { class: 'mini', onclick: finish }, 'End')),
    el('div', { class: 'prompt' }, q.prompt, el('div', { class: 'hint' }, q.hint)),
  );

  const inputs = q.fields.map((f) => {
    const node = f.textarea
      ? el('textarea', { rows: 2, placeholder: 'type the English meaning…' })
      : el('input', { type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
    if (f.jp) node.classList.add('jp');
    return el('label', {}, f.label, node);
  });
  const answers = el('div', { class: 'answers' }, inputs);
  box.append(answers);

  if (q.choices) {
    box.append(el('div', { class: 'sim-row', style: 'justify-content:center;margin-top:10px' },
      q.choices.map((c) => el('button', {
        class: 'sim-item', onclick: () => { inputs[0].querySelector('input').value = c; check(); },
      }, el('span', { class: 'k jp' }, c)))));
  }

  const actionRow = el('div', { class: 'quiz-actions' },
    el('button', { class: 'primary', onclick: () => check() }, 'Check (Enter)'),
    el('button', { class: 'ghost', onclick: () => check(true) }, "Don't know"));
  box.append(actionRow);

  const first = answers.querySelector('input, textarea');
  first?.focus();
  answers.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); check(); }
  });

  function check(skipped = false) {
    if (box.dataset.answered) return;
    box.dataset.answered = '1';
    const fieldNodes = [...answers.querySelectorAll('input, textarea')];
    const given = fieldNodes.map((n) => n.value.trim());
    let ok = !skipped && q.fields.every((f, i) => given[i] && f.check(given[i]));
    fieldNodes.forEach((n) => { n.readOnly = true; });
    actionRow.replaceChildren();
    showFeedback(q, ok, given, skipped, box, actionRow);
  }
}

function showFeedback(q, ok, given, skipped, box, actionRow) {
  let settled = false;
  const fb = el('div', { class: 'feedback ' + (ok ? 'good' : 'bad') });
  const verdict = el('div', { class: 'verdict' }, ok ? '✓ Correct' : skipped ? '· Skipped' : '✗ Not quite');
  const dl = el('dl', {});
  q.fields.forEach((f, i) => {
    dl.append(el('dt', {}, f.label.split('(')[0].trim()), el('dd', { class: f.jp ? 'jp' : '' }, f.expect ?? q.answer[i]));
  });
  (q.reveal || []).forEach(([t, v]) => { if (v) dl.append(el('dt', {}, t), el('dd', { class: 'jp' }, v)); });
  fb.append(verdict, dl);

  // free-form translations are judged loosely, so let the learner override
  if (q.fuzzy && !skipped && given[0]) {
    const sg = el('div', { class: 'self-grade' },
      el('button', { class: 'mini', onclick: () => settle(true) }, '✓ I was right'),
      el('button', { class: 'mini', onclick: () => settle(false) }, '✗ I was wrong'));
    fb.append(el('div', { class: 'hint' }, `Auto-score: ${Math.round(sentenceScore(given[0], q.answer[0]) * 100)}% keyword match — correct it if needed.`), sg);
  }
  actionRow.before(fb);

  if (audioOn() && q.say) speak(q.say);

  const next = el('button', { class: 'primary', onclick: () => settle(ok) }, session.i + 1 >= session.questions.length ? 'See results (Enter)' : 'Next (Enter)');
  actionRow.append(next,
    el('button', { class: 'ghost', onclick: () => { import('./app.js').then((m) => m.goLearn(q.char)); } }, `Study ${q.char}`));
  next.focus();

  function settle(correct) {
    if (settled) return;
    settled = true;
    box.removeEventListener('keydown', onKey);
    grade(q.char, q.mode, correct);
    session.results.push({ q, correct, given });
    delete box.dataset.answered;
    session.i++;
    if (session.i >= session.questions.length) finish(); else renderQuestion();
  }

  function onKey(e) {
    if (e.key === 'Enter') { e.preventDefault(); settle(ok); }
  }
  // attached on the next tick so the Enter that submitted the answer is not reused
  setTimeout(() => box.addEventListener('keydown', onKey), 0);
}

function finish() {
  const box = $('#recallQuiz');
  box.classList.add('hidden');
  delete box.dataset.answered;
  const res = $('#recallResult');
  res.classList.remove('hidden');

  const done = session.results;
  const correct = done.filter((r) => r.correct).length;
  const pct = done.length ? Math.round((correct / done.length) * 100) : 0;
  const wrong = done.filter((r) => !r.correct);

  res.replaceChildren(
    el('h2', {}, 'Session complete'),
    el('div', { class: 'score-ring', style: `color:${pct >= 80 ? 'var(--ok)' : pct >= 50 ? 'var(--warn)' : 'var(--bad)'}` }, `${pct}%`),
    el('p', { class: 'hint' }, `${correct} of ${done.length} correct`),
    wrong.length
      ? el('table', {}, el('thead', {}, el('tr', {}, el('th', {}, 'Kanji'), el('th', {}, 'Section'), el('th', {}, 'You typed'), el('th', {}, 'Answer'))),
        el('tbody', {}, wrong.map((r) => el('tr', {},
          el('td', {}, el('span', { class: 'mistake-k', onclick: () => import('./app.js').then((m) => m.goLearn(r.q.char)) }, r.q.char)),
          el('td', {}, MODE_NAME[r.q.mode]),
          el('td', { class: 'jp' }, r.given.filter(Boolean).join(' / ') || '—'),
          el('td', { class: 'jp' }, r.q.answer.join(' / '))))))
      : el('p', {}, '🎉 Everything correct.'),
    el('div', { class: 'quiz-actions' },
      el('button', { class: 'primary', onclick: start }, 'Another session'),
      wrong.length ? el('button', {
        class: 'ghost',
        onclick: () => {
          session = { questions: wrong.map((r) => makeQuestion(r.q.mode, r.q.char)).filter(Boolean), i: 0, results: [] };
          if (!session.questions.length) return toast('Could not rebuild those questions');
          res.classList.add('hidden'); $('#recallQuiz').classList.remove('hidden'); renderQuestion();
        },
      }, 'Retry the misses') : null,
      el('button', { class: 'ghost', onclick: showSetup }, 'Change settings')),
  );
}

function start() {
  session = buildSession();
  if (!session) { toast('No questions could be built for that combination.'); return; }
  state.settings.sessionSize = Number($('#sessionSize').value);
  state.settings.autoRomaji = autoRomaji();
  state.settings.audio = audioOn();
  save();
  $('#recallSetup').classList.add('hidden');
  $('#recallResult').classList.add('hidden');
  $('#recallQuiz').classList.remove('hidden');
  renderQuestion();
}

function showSetup() {
  $('#recallQuiz').classList.add('hidden');
  $('#recallResult').classList.add('hidden');
  $('#recallSetup').classList.remove('hidden');
  updatePool();
}

/* ---------------------------------------------------------------- wiring */

function renderPickGrid(filter = '') {
  const q = filter.toLowerCase();
  const list = DB.chars.filter((c) => !q || c === filter || DB.kanji[c].m.join(' ').toLowerCase().includes(q));
  $('#pickGrid').replaceChildren(...list.slice(0, 400).map((c) => el('button', {
    class: 'kanji-cell jp' + (picked.has(c) ? ' sel' : ''),
    title: DB.kanji[c].m.join(', '),
    onclick: (e) => {
      picked.has(c) ? picked.delete(c) : picked.add(c);
      e.currentTarget.classList.toggle('sel');
      renderPickSelected();
      updatePool();
    },
  }, c)));
}

function renderPickSelected() {
  const box = $('#pickSelected');
  if (!picked.size) { box.innerHTML = '<em>none selected</em>'; return; }
  box.replaceChildren(el('span', { class: 'jp' }, [...picked].join(' ')),
    el('button', { class: 'mini', style: 'margin-left:8px', onclick: () => { picked.clear(); renderPickGrid($('#pickSearch').value); renderPickSelected(); updatePool(); } }, 'clear'));
}

export function initRecall() {
  $('#groupSelect').replaceChildren(...Object.keys(DB.groups).map((g) => el('option', { value: g }, `${g} (${DB.groups[g].length})`)));

  $('#sourceSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    $$('#sourceSeg button').forEach((n) => n.classList.toggle('active', n === b));
    source = b.dataset.source;
    $$('.source-opt').forEach((n) => n.classList.add('hidden'));
    const opt = $(`#opt-${source}`);
    if (opt) opt.classList.remove('hidden');
    if (source === 'pick') renderPickGrid('');
    updatePool();
  });

  $('#opt-level').addEventListener('change', updatePool);
  $('#groupSelect').addEventListener('change', updatePool);
  $('#modeCards').addEventListener('change', updatePool);
  $('#pickSearch').addEventListener('input', (e) => renderPickGrid(e.target.value.trim()));
  $('#startQuiz').addEventListener('click', start);

  $('#sessionSize').value = state.settings.sessionSize;
  $('#optRomaji').checked = state.settings.autoRomaji;
  $('#optAudio').checked = state.settings.audio;
  renderPickSelected();
  updatePool();
}

/** Jump straight into a drill from elsewhere in the app. */
export function quickSession(sourceKey, modeKey = 'mix') {
  $$('#sourceSeg button').forEach((n) => n.classList.toggle('active', n.dataset.source === sourceKey));
  source = sourceKey;
  $$('.source-opt').forEach((n) => n.classList.add('hidden'));
  const radio = $(`input[name=mode][value=${modeKey}]`);
  if (radio) radio.checked = true;
  start();
}
