// App shell: data bootstrap, view routing, theme.

import { loadData } from './data.js';
import { state, save } from './store.js';
import { initSync, onStatus } from './sync.js';
import { $, $$, toast } from './ui.js';
import { initLearn, renderGrid, focusKanji } from './learn.js';
import { initRecall, quickSession } from './recall.js';
import { renderDashboard } from './dashboard.js';

const VIEWS = ['learn', 'recall', 'dashboard'];

/** Supabase appends its own params on the auth redirect - never treat those as a route. */
function routeFromHash() {
  const name = location.hash.replace('#', '').split(/[&?=]/)[0];
  return VIEWS.includes(name) ? name : 'learn';
}

function setView(name) {
  $$('.view').forEach((v) => v.classList.toggle('hidden', v.id !== `view-${name}`));
  $$('#nav button').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  if (name === 'dashboard') renderDashboard(goLearn, goDrill);
  if (name === 'learn') renderGrid();
  $('#streakBadge').textContent = `🔥 ${state.streak.current || 0}`;
  location.hash = name;
}

export function goLearn(char) {
  setView('learn');
  if (char) focusKanji(char);
}

function goDrill(sourceKey) {
  setView('recall');
  quickSession(sourceKey);
}

function applyTheme() {
  document.documentElement.dataset.theme = state.settings.theme;
}

async function main() {
  applyTheme();
  $('#themeBtn').addEventListener('click', () => {
    state.settings.theme = state.settings.theme === 'dark' ? 'light' : 'dark';
    applyTheme(); save();
  });
  $('#nav').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) setView(b.dataset.view);
  });
  $('#streakBadge').textContent = `🔥 ${state.streak.current || 0}`;

  try {
    await loadData();
  } catch (err) {
    $('#app').innerHTML = `<div class="panel"><p class="empty">${err.message}<br><br>
      Open the site through a local web server (see README) — browsers block <code>fetch</code> on <code>file://</code> URLs.</p></div>`;
    return;
  }

  initLearn();
  initRecall();
  setView(routeFromHash());
  window.addEventListener('hashchange', () => setView(routeFromHash()));

  initSync().catch((err) => toast(err.message));
  onStatus(() => {
    if (!$('#view-dashboard').classList.contains('hidden')) renderDashboard(goLearn, goDrill);
    $('#streakBadge').textContent = `🔥 ${state.streak.current || 0}`;
  });

  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea, select')) return;
    const map = { 1: 'learn', 2: 'recall', 3: 'dashboard' };
    if (map[e.key]) setView(map[e.key]);
  });

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register(new URL('../../sw.js', import.meta.url)).catch(() => { });
  }
}

main().catch((e) => toast(e.message));
