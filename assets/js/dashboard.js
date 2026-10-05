// Dashboard: coverage, accuracy, mistakes, streak, cloud sync and backup.

import { DB } from './data.js';
import { state, statusOf, isDue, exportJson, importJson, resetAll, today } from './store.js';
import { CONFIG, saveOverrides, clearOverrides } from './config.js';
import { status as syncStatus, signIn, signOut, syncNow } from './sync.js';
import { $, el, toast } from './ui.js';

const MODE_NAME = {
  m1: 'Kanji → Meaning', m2: 'Kanji → Readings', m3: 'Word → Reading + Meaning',
  m4: 'Meaning → Kanji', m5: 'Sentence → Meaning',
};
const LEVELS = [[5, 'N5'], [4, 'N4'], [3, 'N3']];

function levelBar(lv, label) {
  const chars = DB.chars.filter((c) => DB.kanji[c].l === lv);
  const known = chars.filter((c) => statusOf(c) === 2).length;
  const learning = chars.filter((c) => statusOf(c) === 1).length;
  return el('div', { class: 'lvbar' },
    el('div', { class: 'lab' },
      el('span', {}, `${label} · ${chars.length} kanji`),
      el('span', {}, `${known} known · ${learning} learning · ${chars.length - known - learning} new`)),
    el('div', { class: 'track' },
      el('i', { class: 'known', style: `width:${(known / chars.length) * 100}%` }),
      el('i', { class: 'learning', style: `width:${(learning / chars.length) * 100}%` })));
}

function heatmap() {
  const cells = [];
  const start = new Date();
  start.setDate(start.getDate() - 7 * 17);
  start.setDate(start.getDate() - start.getDay());
  for (let d = new Date(start); d <= new Date(); d.setDate(d.getDate() + 1)) {
    const key = d.toISOString().slice(0, 10);
    const n = state.daily[key]?.answered || 0;
    const v = n === 0 ? 0 : n < 10 ? 1 : n < 25 ? 2 : n < 50 ? 3 : 4;
    cells.push(el('i', { 'data-v': v, title: `${key}: ${n} answers` }));
  }
  return el('div', { class: 'heat' }, cells);
}

function syncPanel(refresh) {
  const panel = el('div', { class: 'panel' }, el('h3', {}, 'Cloud sync'));

  if (!syncStatus.configured) {
    const url = el('input', { type: 'url', placeholder: 'https://xxxx.supabase.co', value: CONFIG.supabaseUrl });
    const key = el('input', { type: 'text', placeholder: 'anon public key', value: CONFIG.supabaseAnonKey });
    panel.append(
      el('p', { class: 'hint' }, 'Optional. Connect a free Supabase project to keep progress in sync across devices. See the README for the two-minute setup.'),
      el('div', { class: 'answers', style: 'margin-top:0' },
        el('label', {}, 'Project URL', url),
        el('label', {}, 'Anon public key', key)),
      el('div', { class: 'quiz-actions', style: 'justify-content:flex-start' },
        el('button', {
          class: 'primary',
          onclick: () => {
            if (!url.value.trim() || !key.value.trim()) return toast('Both fields are required');
            saveOverrides({ supabaseUrl: url.value, supabaseAnonKey: key.value });
            location.reload();
          },
        }, 'Connect')));
    return panel;
  }

  if (!syncStatus.email) {
    const email = el('input', { type: 'email', placeholder: 'you@example.com', autocomplete: 'email' });
    const send = async () => {
      if (!email.value.includes('@')) return toast('Enter a valid email');
      try { await signIn(email.value.trim()); toast('Check your inbox for the sign-in link'); }
      catch (err) { toast(err.message); }
    };
    email.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
    panel.append(
      el('p', { class: 'hint' }, 'Sign in with a one-time email link to back up and sync your progress. No password needed.'),
      el('div', { class: 'answers', style: 'margin-top:0' }, el('label', {}, 'Email', email)),
      el('div', { class: 'quiz-actions', style: 'justify-content:flex-start' },
        el('button', { class: 'primary', onclick: send }, 'Send magic link'),
        el('button', { class: 'ghost', onclick: () => { clearOverrides(); location.reload(); } }, 'Disconnect project')));
    if (syncStatus.error) panel.append(el('p', { class: 'hint', style: 'color:var(--bad)' }, syncStatus.error));
    return panel;
  }

  panel.append(
    el('div', { class: 'stat-row' },
      el('div', { class: 'stat' }, el('b', { style: 'font-size:16px' }, syncStatus.email), el('span', {}, 'signed in')),
      el('div', { class: 'stat' },
        el('b', { style: 'font-size:16px' }, syncStatus.busy ? 'syncing…' : syncStatus.lastSync ? new Date(syncStatus.lastSync).toLocaleTimeString() : 'never'),
        el('span', {}, 'last sync'))),
    el('p', { class: 'hint' }, 'Progress uploads automatically a few seconds after each answer, and merges on sign-in.'),
    el('div', { class: 'quiz-actions', style: 'justify-content:flex-start' },
      el('button', { class: 'primary', disabled: syncStatus.busy, onclick: async () => { await syncNow(); toast('Synced'); refresh(); } }, '⟳ Sync now'),
      el('button', { class: 'ghost', onclick: async () => { await signOut(); refresh(); } }, 'Sign out')));
  if (syncStatus.error) panel.append(el('p', { class: 'hint', style: 'color:var(--bad)' }, syncStatus.error));
  return panel;
}

export function renderDashboard(onPickKanji, onDrill) {
  const total = DB.chars.length;
  const known = DB.chars.filter((c) => statusOf(c) === 2).length;
  const learning = DB.chars.filter((c) => statusOf(c) === 1).length;
  const due = DB.chars.filter(isDue).length;
  const answered = Object.values(state.daily).reduce((a, d) => a + d.answered, 0);
  const correct = Object.values(state.daily).reduce((a, d) => a + d.correct, 0);
  const todayCount = state.daily[today()]?.answered || 0;

  const mistakes = Object.entries(state.progress)
    .filter(([, r]) => r.wrong > 0)
    .sort((a, b) => b[1].wrong - a[1].wrong || (a[1].correct / (a[1].seen || 1)) - (b[1].correct / (b[1].seen || 1)));

  const perMode = {};
  for (const r of Object.values(state.progress)) {
    for (const [m, v] of Object.entries(r.modes || {})) {
      const t = (perMode[m] ||= { c: 0, w: 0 });
      t.c += v.c; t.w += v.w;
    }
  }

  const importInput = el('input', { type: 'file', accept: '.json', class: 'hidden' });
  importInput.addEventListener('change', async () => {
    const f = importInput.files[0];
    if (!f) return;
    try { importJson(await f.text()); toast('Progress imported'); location.reload(); }
    catch (err) { toast('Import failed: ' + err.message); }
  });

  $('#dashboard').replaceChildren(el('div', { class: 'dash' },
    el('div', { class: 'panel' },
      el('h3', {}, 'Overview'),
      el('div', { class: 'stat-row' },
        el('div', { class: 'stat' }, el('b', {}, `${known}`), el('span', {}, `of ${total} kanji known`)),
        el('div', { class: 'stat' }, el('b', {}, `${learning}`), el('span', {}, 'in progress')),
        el('div', { class: 'stat' }, el('b', { style: due ? 'color:var(--warn)' : '' }, `${due}`), el('span', {}, 'due for review')),
        el('div', { class: 'stat' }, el('b', {}, `${answered ? Math.round((correct / answered) * 100) : 0}%`), el('span', {}, `overall accuracy (${answered} answers)`))),
      el('div', { style: 'margin-top:16px' }, LEVELS.map(([lv, name]) => levelBar(lv, name))),
      el('div', { class: 'legend' },
        el('s', {}, el('i', { style: 'background:var(--ok)' }), 'known'),
        el('s', {}, el('i', { style: 'background:var(--warn)' }), 'learning'),
        el('s', {}, el('i', { style: 'background:var(--bg-3)' }), 'not started')),
      el('div', { class: 'quiz-actions', style: 'justify-content:flex-start;margin-top:16px' },
        el('button', { class: 'primary', disabled: !due, onclick: () => onDrill('due') }, due ? `Review ${due} due` : 'Nothing due'),
        el('button', { class: 'ghost', onclick: () => onDrill('mistakes') }, 'Drill my mistakes'))),

    el('div', { class: 'panel' },
      el('h3', {}, 'Activity'),
      el('div', { class: 'stat-row' },
        el('div', { class: 'stat' }, el('b', {}, `🔥 ${state.streak.current || 0}`), el('span', {}, `day streak · best ${state.streak.best || 0}`)),
        el('div', { class: 'stat' }, el('b', {}, `${todayCount}`), el('span', {}, 'answers today'))),
      el('div', { style: 'margin-top:16px' }, heatmap()),
      el('p', { class: 'hint' }, 'Last 18 weeks — darker means more reviews.')),

    el('div', { class: 'panel' },
      el('h3', {}, 'Accuracy by recall section'),
      Object.keys(MODE_NAME).some((m) => perMode[m])
        ? el('table', {}, el('tbody', {}, Object.entries(MODE_NAME).map(([m, name]) => {
          const t = perMode[m];
          const tot = t ? t.c + t.w : 0;
          return el('tr', {},
            el('td', {}, name),
            el('td', {}, tot ? `${Math.round((t.c / tot) * 100)}%` : '—'),
            el('td', { style: 'color:var(--fg-dim)' }, tot ? `${t.c}/${tot}` : 'not practised'));
        })))
        : el('p', { class: 'hint' }, 'No recall sessions yet.')),

    el('div', { class: 'panel' },
      el('h3', {}, `Kanji to work on (${mistakes.length})`),
      mistakes.length
        ? el('div', { class: 'scroll' }, el('table', {},
          el('thead', {}, el('tr', {}, el('th', {}, ''), el('th', {}, 'Meaning'), el('th', {}, 'Wrong'), el('th', {}, 'Accuracy'))),
          el('tbody', {}, mistakes.slice(0, 80).map(([c, r]) => el('tr', {},
            el('td', {}, el('span', { class: 'mistake-k', title: 'Open in Learn', onclick: () => onPickKanji(c) }, c)),
            el('td', {}, DB.kanji[c]?.m.slice(0, 3).join(', ') || ''),
            el('td', { style: 'color:var(--bad)' }, r.wrong),
            el('td', {}, `${Math.round((r.correct / (r.seen || 1)) * 100)}%`))))))
        : el('p', { class: 'hint' }, 'Nothing here yet — mistakes you make during recall show up on this list.')),

    el('div', { class: 'panel' },
      el('h3', {}, 'Backup'),
      el('p', { class: 'hint' }, 'A local copy you can keep yourself. Export before clearing site data or switching browser.'),
      el('div', { class: 'quiz-actions', style: 'justify-content:flex-start' },
        el('button', { class: 'ghost', onclick: exportJson }, '⬇ Export progress'),
        el('button', { class: 'ghost', onclick: () => importInput.click() }, '⬆ Import progress'),
        el('button', {
          class: 'danger',
          onclick: () => { if (confirm('Erase all progress on this device?')) { resetAll(); location.reload(); } },
        }, 'Reset everything')),
      importInput),

    syncPanel(() => renderDashboard(onPickKanji, onDrill)),
  ));
}
