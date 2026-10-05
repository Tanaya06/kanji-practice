// Optional cloud sync of progress through Supabase (auth + a single jsonb row per user).
// Everything here degrades gracefully: with no project configured the app stays local-only.

import { CONFIG, isConfigured } from './config.js';
import { state, mergeRemote, onSave } from './store.js';

const TABLE = 'progress';

export const status = {
  configured: isConfigured(),
  email: null,
  lastSync: null,
  busy: false,
  error: null,
};

let client = null;
let applyingRemote = false;
let pushTimer = null;
const watchers = new Set();

export function onStatus(fn) {
  watchers.add(fn);
  return () => watchers.delete(fn);
}

function announce(patch = {}) {
  Object.assign(status, patch);
  watchers.forEach((fn) => fn(status));
}

async function getClient() {
  if (client) return client;
  if (!isConfigured()) return null;
  const { createClient } = await import(/* @vite-ignore */ CONFIG.clientModule);
  client = createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey, {
    auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  return client;
}

/** Snapshot worth storing remotely - settings stay device-local. */
const payload = () => ({ progress: state.progress, daily: state.daily, streak: state.streak });

export async function pull() {
  const sb = await getClient();
  if (!sb || !status.email) return false;
  announce({ busy: true, error: null });
  try {
    const { data, error } = await sb.from(TABLE).select('data').maybeSingle();
    if (error) throw error;
    applyingRemote = true;
    const changed = data ? mergeRemote(data.data) : false;
    applyingRemote = false;
    announce({ busy: false, lastSync: Date.now() });
    return changed;
  } catch (err) {
    applyingRemote = false;
    announce({ busy: false, error: err.message });
    return false;
  }
}

export async function push() {
  const sb = await getClient();
  if (!sb || !status.email) return false;
  announce({ busy: true, error: null });
  try {
    const { data: auth } = await sb.auth.getUser();
    const { error } = await sb.from(TABLE).upsert({
      user_id: auth.user.id,
      data: payload(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });
    if (error) throw error;
    announce({ busy: false, lastSync: Date.now() });
    return true;
  } catch (err) {
    announce({ busy: false, error: err.message });
    return false;
  }
}

/** Download, merge, then upload the merged result. */
export async function syncNow() {
  await pull();
  return push();
}

export async function signIn(email) {
  const sb = await getClient();
  if (!sb) throw new Error('Supabase is not configured yet.');
  const redirect = location.origin + location.pathname;
  const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: redirect } });
  if (error) throw error;
}

export async function signOut() {
  const sb = await getClient();
  if (!sb) return;
  await sb.auth.signOut();
  announce({ email: null, lastSync: null });
}

/** Wire up auth state and background pushes. Safe to call when unconfigured. */
export async function initSync() {
  announce({ configured: isConfigured() });
  if (!isConfigured()) return;

  let sb;
  try {
    sb = await getClient();
  } catch (err) {
    announce({ error: `Could not load supabase-js: ${err.message}` });
    return;
  }

  const { data } = await sb.auth.getSession();
  if (data.session) {
    announce({ email: data.session.user.email });
    await syncNow();
  }

  sb.auth.onAuthStateChange(async (event, session) => {
    if (session?.user) {
      announce({ email: session.user.email });
      if (event === 'SIGNED_IN') await syncNow();
    } else {
      announce({ email: null });
    }
  });

  onSave(() => {
    if (applyingRemote || !status.email) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(push, 4000);
  });

  window.addEventListener('beforeunload', () => {
    if (status.email) clearTimeout(pushTimer);
  });
}
