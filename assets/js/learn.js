// Learn view: browse kanji, stroke order, readings, vocabulary, look-alikes, sentences.

import { DB, wordsOf, sentencesOf, strokeSvg } from './data.js';
import { state, statusOf, isDue, markLearned, record, save } from './store.js';
import { $, $$, el, speak, speakBtn, toast } from './ui.js';
import { toKatakana, readingCore } from './kana.js';

let level = 'all';
let statusKey = 'all';
let query = '';
let current = null;

const LEVELS = { 5: 'N5', 4: 'N4', 3: 'N3' };

function matches(c) {
  const k = DB.kanji[c];
  if (level !== 'all' && k.l !== Number(level)) return false;

  const st = statusOf(c);
  if (statusKey === 'new' && st !== 0) return false;
  if (statusKey === 'learning' && st !== 1) return false;
  if (statusKey === 'known' && st !== 2) return false;
  if (statusKey === 'due' && !isDue(c)) return false;
  if (statusKey === 'weak' && !(state.progress[c]?.wrong > 0)) return false;

  if (query) {
    const q = query.toLowerCase();
    if (c === query) return true;
    const hay = [...k.m, ...k.on, ...k.kn].join(' ').toLowerCase();
    if (!hay.includes(q) && !readingCore(k.on.concat(k.kn).join(' ')).includes(q)) return false;
  }
  return true;
}

export function renderGrid() {
  const grid = $('#kanjiGrid');
  const list = DB.chars.filter(matches);
  grid.replaceChildren(...list.map((c) => {
    const p = state.progress[c];
    const cell = el('button', {
      class: 'kanji-cell jp' + (c === current ? ' sel' : ''),
      'data-st': statusOf(c),
      'data-k': c,
      title: DB.kanji[c].m.slice(0, 3).join(', '),
      onclick: () => showKanji(c),
    }, c, el('i', { class: `lvdot lv${DB.kanji[c].l}` }));
    if (p?.wrong > 0 && statusOf(c) !== 2) cell.dataset.weak = '1';
    return cell;
  }));
  $('#gridCount').textContent = `${list.length} kanji · ${list.filter((c) => statusOf(c) === 2).length} known`;
}

/* ------------------------------------------------------------ stroke order */

function strokeStage(char, svgText) {
  const stage = el('div', { class: 'stroke-stage' });
  stage.innerHTML = svgText;
  const svg = stage.querySelector('svg');
  const paths = [...svg.querySelectorAll('path')];
  const lengths = paths.map((p) => p.getTotalLength());

  const guide = el('div', { class: 'guide' });
  guide.innerHTML = '<svg viewBox="0 0 109 109"><line x1="54.5" y1="0" x2="54.5" y2="109"/><line x1="0" y1="54.5" x2="109" y2="54.5"/></svg>';
  stage.prepend(guide);

  const numbers = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  paths.forEach((p, i) => {
    const pt = p.getPointAtLength(0);
    const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    t.setAttribute('x', pt.x + 1.5); t.setAttribute('y', pt.y - 1.5);
    t.setAttribute('font-size', '7'); t.setAttribute('fill', 'var(--accent)');
    t.textContent = i + 1;
    numbers.append(t);
  });
  numbers.style.display = 'none';
  svg.append(numbers);

  let timer = null;
  const show = (n) => paths.forEach((p, i) => {
    p.style.transition = 'none';
    p.style.strokeDasharray = lengths[i];
    p.style.strokeDashoffset = i < n ? 0 : lengths[i];
  });

  function play() {
    clearTimeout(timer);
    show(0);
    let i = 0;
    const step = () => {
      if (i >= paths.length) return;
      const p = paths[i];
      const ms = Math.max(220, lengths[i] * 9);
      p.style.transition = `stroke-dashoffset ${ms}ms linear`;
      p.style.strokeDashoffset = 0;
      i++;
      slider.value = i;
      timer = setTimeout(step, ms + 90);
    };
    step();
  }

  const slider = el('input', {
    type: 'range', min: 0, max: paths.length, value: paths.length,
    oninput: () => { clearTimeout(timer); show(Number(slider.value)); },
  });

  const numBtn = el('button', {
    class: 'mini',
    onclick: () => {
      const on = numbers.style.display === 'none';
      numbers.style.display = on ? '' : 'none';
      numBtn.classList.toggle('on', on);
    },
  }, '1 2 3');

  // free-hand tracing layer
  const canvas = el('canvas', { width: 340, height: 340 });
  canvas.style.display = 'none';
  stage.append(canvas);
  const ctx = canvas.getContext('2d');
  ctx.lineWidth = 11; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  let drawing = false;
  const pos = (e) => {
    const r = canvas.getBoundingClientRect();
    return [(e.clientX - r.left) * (canvas.width / r.width), (e.clientY - r.top) * (canvas.height / r.height)];
  };
  canvas.addEventListener('pointerdown', (e) => {
    drawing = true; canvas.setPointerCapture(e.pointerId);
    ctx.strokeStyle = getComputedStyle(document.body).getPropertyValue('--accent');
    ctx.beginPath(); ctx.moveTo(...pos(e));
  });
  canvas.addEventListener('pointermove', (e) => { if (drawing) { ctx.lineTo(...pos(e)); ctx.stroke(); } });
  canvas.addEventListener('pointerup', () => { drawing = false; });

  const traceBtn = el('button', {
    class: 'mini',
    onclick: () => {
      const on = canvas.style.display === 'none';
      canvas.style.display = on ? '' : 'none';
      traceBtn.classList.toggle('on', on);
      paths.forEach((p) => { p.style.opacity = on ? 0.25 : 1; });
      if (on) show(paths.length);
    },
  }, '✎ Trace');

  show(paths.length);

  return el('div', { class: 'stroke-box' },
    stage,
    el('div', { class: 'stroke-ctrl' },
      el('div', { class: 'row2' },
        el('button', { class: 'mini', onclick: play }, '▶ Animate'),
        el('button', { class: 'mini', onclick: () => { ctx.clearRect(0, 0, canvas.width, canvas.height); show(paths.length); } }, '↺ Clear'),
      ),
      el('div', { class: 'row2' }, numBtn, traceBtn),
      el('label', { class: 'chk' }, 'Stroke ', slider),
      el('small', { class: 'hint' }, `${paths.length} strokes`),
    ));
}

/* ------------------------------------------------------------- detail pane */

export async function showKanji(char) {
  current = char;
  $$('.kanji-cell', $('#kanjiGrid')).forEach((n) => n.classList.toggle('sel', n.dataset.k === char));

  const k = DB.kanji[char];
  const p = record(char);
  const pane = $('#detail');
  pane.replaceChildren();
  pane.scrollTop = 0;

  const accuracy = p.seen ? Math.round((p.correct / p.seen) * 100) : null;

  pane.append(
    el('div', { class: 'detail-head' },
      el('div', { class: 'big-kanji jp', title: 'Click to hear', style: 'cursor:pointer', onclick: () => speak(char) }, char),
      el('div', {},
        el('div', {},
          el('span', { class: `chip n${k.l}` }, LEVELS[k.l]),
          el('span', { class: 'chip' }, `${k.s} strokes`),
          statusOf(char) === 2 ? el('span', { class: 'chip' }, '✓ known') : null,
          accuracy !== null ? el('span', { class: 'chip' }, `${accuracy}% · ${p.seen} reviews`) : null,
        ),
        el('div', { class: 'meaning-line' }, k.m.join(', ')),
        el('div', { class: 'readings' },
          k.on.length ? el('div', {}, el('b', {}, "on'yomi"), el('span', { class: 'jp' }, k.on.map(toKatakana).join('、')), speakBtn(readingCore(k.on[0]))) : null,
          k.kn.length ? el('div', {}, el('b', {}, "kun'yomi"), el('span', { class: 'jp' }, k.kn.join('、')), speakBtn(readingCore(k.kn[0]))) : null,
        ),
      )),
    el('div', { class: 'detail-actions' },
      el('button', {
        class: statusOf(char) === 2 ? 'ghost' : 'primary',
        onclick: (e) => {
          markLearned(char, statusOf(char) !== 2);
          toast(statusOf(char) === 2 ? 'Marked as known' : 'Moved back to "not started"');
          showKanji(char); renderGrid();
          e.currentTarget.blur();
        },
      }, statusOf(char) === 2 ? '↺ Mark as not known' : '✓ Mark as known'),
      el('button', { class: 'ghost', onclick: () => { p.bookmark = !p.bookmark; save(); toast(p.bookmark ? 'Starred' : 'Unstarred'); showKanji(char); } },
        p.bookmark ? '★ Starred' : '☆ Star'),
    ),
  );

  const strokeSection = el('div', {}, el('h4', { class: 'sec' }, 'Stroke order'), el('p', { class: 'hint' }, 'loading…'));
  pane.append(strokeSection);
  strokeSvg(char).then((svg) => {
    strokeSection.replaceChildren(el('h4', { class: 'sec' }, 'Stroke order'),
      svg ? strokeStage(char, svg) : el('p', { class: 'hint' }, 'No stroke diagram available.'));
  });

  const words = wordsOf(char);
  if (words.length) {
    pane.append(el('h4', { class: 'sec' }, `Words using ${char}`),
      el('div', {}, words.map((w) => el('div', { class: 'word-row' },
        el('div', {},
          el('span', { class: 'word jp' }, w.w),
          el('span', { class: 'word-r jp' }, w.r),
          speakBtn(w.w),
          el('span', { class: 'chip' }, `N${w.l}`)),
        el('div', { class: 'word-m' }, w.m)))));
  }

  if (k.sim?.length) {
    pane.append(el('h4', { class: 'sec' }, 'Easy to confuse with'),
      el('div', { class: 'sim-row' }, k.sim.filter((s) => DB.kanji[s]).map((s) => el('button', {
        class: 'sim-item', onclick: () => showKanji(s), title: DB.kanji[s].m.join(', '),
      }, el('span', { class: 'k jp' }, s), el('span', { class: 'm' }, DB.kanji[s].m[0])))));
  }

  const sentences = sentencesOf(char);
  if (sentences.length) {
    pane.append(el('h4', { class: 'sec' }, 'Example sentences'),
      el('div', {}, sentences.map((s) => el('div', { class: 'sent-row' },
        el('div', {}, el('span', { class: 'sentence-ja' }, s.j), speakBtn(s.j)),
        el('div', { class: 'sent-en' }, s.e)))));
  }
}

export function initLearn() {
  $('#levelFilter').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    $$('#levelFilter button').forEach((n) => n.classList.toggle('active', n === b));
    level = b.dataset.level;
    renderGrid();
  });
  $('#kanjiSearch').addEventListener('input', (e) => {
    query = e.target.value.trim();
    renderGrid();
  });
  $('#statusFilter').addEventListener('change', (e) => { statusKey = e.target.value; renderGrid(); });
  level = '5';
  renderGrid();
}

export function focusKanji(char) {
  level = 'all'; statusKey = 'all'; query = '';
  $$('#levelFilter button').forEach((n) => n.classList.toggle('active', n.dataset.level === 'all'));
  $('#kanjiSearch').value = '';
  $('#statusFilter').value = 'all';
  renderGrid();
  showKanji(char);
}
