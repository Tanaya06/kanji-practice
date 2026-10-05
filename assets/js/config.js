// Optional Supabase connection details.
//
// Two ways to set these:
//   1. Edit the values below and redeploy (the anon key is a public key - it is safe
//      to ship it in the browser, the database is protected by row level security).
//   2. Leave them empty and paste the values into the "Cloud sync" panel on the
//      Dashboard - they are then kept in this browser's localStorage only.
//
// Leaving everything blank keeps the app fully local: no account, no network.

const OVERRIDE_KEY = 'kanjiTrainer.supabase';

const defaults = {
  supabaseUrl: '',      // e.g. https://abcdefgh.supabase.co
  supabaseAnonKey: '',  // the "anon public" key from Settings -> API
};

function overrides() {
  try { return JSON.parse(localStorage.getItem(OVERRIDE_KEY)) || {}; } catch { return {}; }
}

export const CONFIG = {
  ...defaults,
  ...overrides(),
  // supabase-js is pulled from a CDN only when cloud sync is actually used
  clientModule: 'https://esm.sh/@supabase/supabase-js@2',
};

export function saveOverrides({ supabaseUrl, supabaseAnonKey }) {
  localStorage.setItem(OVERRIDE_KEY, JSON.stringify({
    supabaseUrl: supabaseUrl.trim().replace(/\/+$/, ''),
    supabaseAnonKey: supabaseAnonKey.trim(),
  }));
}

export function clearOverrides() {
  localStorage.removeItem(OVERRIDE_KEY);
}

export const isConfigured = () => /^https:\/\/.+\.supabase\.co$/.test(CONFIG.supabaseUrl) && CONFIG.supabaseAnonKey.length > 20;
