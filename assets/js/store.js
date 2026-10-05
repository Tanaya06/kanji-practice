// Progress, settings and spaced-repetition scheduling. Everything lives in localStorage.

const KEY = 'kanjiTrainer.v1';
const DAY = 86400000;

export const today = () => new Date().toISOString().slice(0, 10);

const blank = () => ({
  settings: { theme: 'dark', autoRomaji: true, audio: true, sessionSize: 15 },
  progress: {},   // char -> record
  daily: {},      // 'YYYY-MM-DD' -> { answered, correct }
  streak: { current: 0, best: 0, last: null },
});

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY));
    if (saved && typeof saved === 'object') return { ...blank(), ...saved, settings: { ...blank().settings, ...saved.settings } };
  } catch { /* corrupted storage - start fresh */ }
  return blank();
}

export const state = load();

const saveListeners = new Set();
/** Called after every persisted change - used by cloud sync. */
export function onSave(fn) {
  saveListeners.add(fn);
  return () => saveListeners.delete(fn);
}

let pending = null;
export function save() {
  clearTimeout(pending);
  pending = setTimeout(() => {
    localStorage.setItem(KEY, JSON.stringify(state));
    saveListeners.forEach((fn) => fn(state));
  }, 150);
}

const stronger = (a, b) => (a.seen || 0) > (b.seen || 0)
  || ((a.seen || 0) === (b.seen || 0) && (a.srs?.due || 0) > (b.srs?.due || 0));

/** Fold a copy downloaded from another device into the local state. */
export function mergeRemote(remote) {
  if (!remote || typeof remote !== 'object') return false;
  let changed = false;

  for (const [char, rec] of Object.entries(remote.progress || {})) {
    const mine = state.progress[char];
    if (!mine || stronger(rec, mine)) { state.progress[char] = rec; changed = true; }
  }
  for (const [date, day] of Object.entries(remote.daily || {})) {
    const mine = state.daily[date];
    if (!mine || (day.answered || 0) > (mine.answered || 0)) { state.daily[date] = day; changed = true; }
  }

  const rs = remote.streak || {};
  if ((rs.best || 0) > (state.streak.best || 0)) { state.streak.best = rs.best; changed = true; }
  if (rs.last && (!state.streak.last || rs.last > state.streak.last)) {
    state.streak.last = rs.last;
    state.streak.current = Math.max(state.streak.current || 0, rs.current || 0);
    changed = true;
  }

  if (changed) save();
  return changed;
}

export function record(char) {
  if (!state.progress[char]) {
    state.progress[char] = {
      st: 0,                 // 0 new · 1 learning · 2 known
      seen: 0, correct: 0, wrong: 0,
      modes: {},             // m1..m5 -> { c, w }
      lastWrong: null,
      srs: { rep: 0, ease: 2.5, interval: 0, due: 0 },
    };
  }
  return state.progress[char];
}

export const statusOf = (char) => state.progress[char]?.st ?? 0;
export const isDue = (char) => {
  const r = state.progress[char];
  return !!r && r.srs.rep > 0 && r.srs.due <= Date.now();
};
export const weakChars = () => Object.keys(state.progress)
  .filter((c) => (state.progress[c].wrong || 0) > 0)
  .sort((a, b) => scoreWeak(b) - scoreWeak(a));

const scoreWeak = (c) => {
  const r = state.progress[c];
  const total = r.correct + r.wrong || 1;
  return (r.wrong / total) * 10 + r.wrong;
};

export function markLearned(char, known = true) {
  const r = record(char);
  r.st = known ? 2 : 0;
  if (known && r.srs.rep === 0) { r.srs.rep = 1; r.srs.interval = 1; r.srs.due = Date.now() + DAY; }
  save();
}

/** Register one graded answer and reschedule the card (SM-2 lite). */
export function grade(char, mode, correct) {
  const r = record(char);
  r.seen++;
  const m = (r.modes[mode] ||= { c: 0, w: 0 });
  if (correct) { r.correct++; m.c++; } else { r.wrong++; m.w++; r.lastWrong = Date.now(); }

  const s = r.srs;
  if (correct) {
    s.rep++;
    s.ease = Math.min(2.8, s.ease + 0.1);
    s.interval = s.rep === 1 ? 1 : s.rep === 2 ? 3 : Math.round(s.interval * s.ease);
    s.due = Date.now() + s.interval * DAY;
    if (r.st === 0) r.st = 1;
    if (s.rep >= 3 && r.wrong / Math.max(1, r.seen) < 0.4) r.st = 2;
  } else {
    s.rep = 0;
    s.ease = Math.max(1.3, s.ease - 0.2);
    s.interval = 0;
    s.due = Date.now() + 600000;   // try again in ~10 minutes
    r.st = 1;
  }

  const d = (state.daily[today()] ||= { answered: 0, correct: 0 });
  d.answered++;
  if (correct) d.correct++;
  touchStreak();
  save();
}

export function touchStreak() {
  const t = today();
  const s = state.streak;
  if (s.last === t) return;
  const yesterday = new Date(Date.now() - DAY).toISOString().slice(0, 10);
  s.current = s.last === yesterday ? s.current + 1 : 1;
  s.best = Math.max(s.best || 0, s.current);
  s.last = t;
  save();
}

export function exportJson() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `kanji-progress-${today()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function importJson(text) {
  const data = JSON.parse(text);
  if (!data || typeof data !== 'object' || !data.progress) throw new Error('Not a progress file');
  Object.assign(state, blank(), data);
  localStorage.setItem(KEY, JSON.stringify(state));
}

export function resetAll() {
  Object.assign(state, blank());
  localStorage.setItem(KEY, JSON.stringify(state));
}
