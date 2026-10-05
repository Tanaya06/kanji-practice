# Kanji Trainer — JLPT N5 / N4 / N3

A single-page, dependency-free web app for learning and recalling JLPT kanji.
No build step and no server code — just static files, deployed free on **Vercel**, with optional
**Supabase** cloud sync so your progress follows you between devices. It works offline after the
first visit, and works perfectly well with no Supabase project at all.

**633 kanji** — N5 (111) and N4 (201) taken from your `Kanji_List.txt` (Nihongo Sō Matome order),
N3 (321) from the modern JLPT kanji tagging in KANJIDIC2.

---

## Features

### Learn
| | |
|---|---|
| **Browse by level** | N5 / N4 / N3 / All, plus filters for *not started · learning · known · due · weak* and a search box (kanji, meaning or reading) |
| **Stroke order** | Animated KanjiVG diagram, a scrubber to step through strokes one by one, stroke numbers, and a **trace mode** where you draw on top of the faded character |
| **Readings** | on'yomi (katakana) and kun'yomi (hiragana, with okurigana shown as `ま.つ`), each with a 🔊 button |
| **Meanings** | Up to six English meanings per kanji |
| **Vocabulary** | Up to 12 real JLPT words per kanji, each with kana reading, English meaning, level tag and audio |
| **Look-alikes** | "Easy to confuse with" — computed from shared KanjiVG components + stroke count, merged with a hand-written list of classic confusions (土/士, 待/持/特, 未/末 …) |
| **Example sentences** | Up to 5 short Japanese sentences per kanji with English translations, filtered so they only use kanji inside N5–N3 |

### Recall (self-marking)
1. **Kanji → Meaning** — kanji shown, type the English meaning
2. **Kanji → Readings** — kanji shown, type on'yomi and kun'yomi
3. **Word → Reading + Meaning** — a word shown, type its kana reading and meaning
4. **Meaning → Kanji** — meaning shown, type the kanji/word (multiple-choice tiles as an IME-free fallback)
5. **Sentence → Meaning** — sentence shown, type the translation
6. **Mixed drill** — a random blend of all five

Choose what goes into the session: **by level**, **all kanji**, **previous mistakes**,
**due for review (SRS)**, **by meaning group** (17 themed groups such as *Time & calendar*,
*Body & health*, *Money & commerce*), or **hand-pick specific kanji**.

Answer checking is forgiving: romaji is converted to kana as you type (`matsu` → `まつ`),
katakana/hiragana are interchangeable, word order in English answers is ignored, and
single-word answers tolerate one typo. Sentence translations are scored on keyword overlap
with a *"I was right / I was wrong"* override.

### Dashboard
* Known / learning / not-started coverage per level
* Overall accuracy and accuracy **per recall section**
* **Kanji to work on** — ranked mistake list, click a kanji to jump straight to its Learn page
* Spaced-repetition queue (`due today`) and one-click "Review due" / "Drill my mistakes"
* Study streak + 18-week activity heatmap
* Export / import / reset progress (JSON)
* **Cloud sync** — sign in with an email magic link to merge progress across devices

Without cloud sync everything is stored in `localStorage` on your device.

---

## Host it for free on Vercel

Vercel's Hobby plan serves this as a plain static site — no build command, no framework.

**Option A — from the CLI**

```powershell
npm i -g vercel
vercel          # first run: link the project, accept the defaults
vercel --prod
```

**Option B — from a Git repo (recommended, gives you auto-deploy on push)**

1. Push this folder to GitHub/GitLab/Bitbucket:
   ```powershell
   git init
   git add .
   git commit -m "Kanji Trainer"
   git branch -M main
   git remote add origin https://github.com/<you>/kanji-trainer.git
   git push -u origin main
   ```
2. On [vercel.com](https://vercel.com) → **Add New → Project** → import the repo.
3. Framework Preset **Other**, Build Command **empty**, Output Directory **empty** (root). Deploy.

That's it — the site is live at `https://<project>.vercel.app`.
[vercel.json](vercel.json) sets long cache headers for `data/`, keeps `sw.js` uncached so
redeploys are picked up, and adds basic security headers. [.vercelignore](.vercelignore) keeps
the build scripts out of the deployment.

All paths are relative, so the app also runs unchanged from a sub-folder on GitHub Pages,
Netlify or Cloudflare Pages if you prefer.

Add it to your phone's home screen and it installs as an offline PWA.

---

## Cloud sync with Supabase (optional)

Free tier, takes about two minutes.

1. Create a project at [supabase.com](https://supabase.com).
2. **SQL Editor** → paste [supabase/schema.sql](supabase/schema.sql) → **Run**.
   This creates one `progress` table (a single `jsonb` row per user) with row level security so
   each account can only ever read and write its own row.
3. **Authentication → URL Configuration** → set *Site URL* to your Vercel URL and add it to
   *Redirect URLs* (add `http://localhost:8080` too if you want to sign in locally).
4. **Project Settings → API** → copy the **Project URL** and the **anon public** key.
5. Open the app → **Dashboard → Cloud sync** → paste both values → **Connect**, then sign in with
   your email. Supabase mails a one-time link; no password to manage.

Alternatively put the same two values in [assets/js/config.js](assets/js/config.js) and redeploy,
so every browser you open the site in is pre-connected.

> The anon key is designed to be public — it only grants what the row level security policies
> allow. Never put the **service role** key in this file.

How syncing behaves:

* on sign-in, the remote copy is **merged** with the local one (per kanji the record with more
  reviews wins, daily counts take the larger value, best streak is kept) and the merged result is
  uploaded;
* after that, every answer schedules an upload a few seconds later;
* **Sync now** on the Dashboard forces a pull-merge-push round trip;
* if Supabase is unreachable the app carries on locally and shows the error on the panel.

Settings (theme, session size…) stay device-local on purpose.

---

## Run it locally

ES modules need a real web server (`file://` is blocked by browsers).

```powershell
pwsh -File tools/serve.ps1          # then open http://localhost:8080/
```

Any other static server works too (`npx serve`, `python -m http.server`, VS Code Live Server…).

---

## Regenerating the data

`data/` is generated — you only need this if you want to change the kanji set or add more
words/sentences.

```powershell
pwsh -File tools/build-data.ps1
```

Downloads are cached in `tools/.cache` (safe to delete). Sources, all freely licensed:

| Data | Source | Licence |
|---|---|---|
| Meanings, readings, stroke counts, JLPT level | [KANJIDIC2](https://www.edrdg.org/wiki/index.php/KANJIDIC_Project) via [davidluzgouveia/kanji-data](https://github.com/davidluzgouveia/kanji-data) | CC BY-SA 4.0 |
| Stroke order SVGs | [KanjiVG](https://kanjivg.tagaini.net/) | CC BY-SA 3.0 |
| Example sentences | [Tanaka Corpus](https://www.edrdg.org/wiki/index.php/Tanaka_Corpus) | CC BY 2.0 FR |
| JLPT vocabulary | [open-anki-jlpt-decks](https://github.com/jamsinclair/open-anki-jlpt-decks) | CC BY 4.0 |

Generated files:

| File | Contents |
|---|---|
| `data/kanji.json` | `char → { l: level, s: strokes, m: meanings, on, kn, sim }` |
| `data/words.json` | `char → [{ w, r, m, l }]` |
| `data/sentences.json` | `char → [{ j, e }]` |
| `data/groups.json` | meaning group → `[chars]` |
| `data/svg/<codepoint>.svg` | stroke paths, one file per kanji |

---

## Keyboard shortcuts

| Key | Action |
|---|---|
| `1` `2` `3` | Learn / Recall / Dashboard |
| `Enter` | Check answer, then move to the next question |

---

## Ideas for later

Things that would fit the app well but are not built yet:

* **Handwriting recognition** for section 4 so you can draw the kanji instead of needing an IME
  (e.g. the free [`hanzi-lookup`](https://github.com/gugray/HanziLookupJS) matcher).
* **Radical / component explorer** — search "which kanji contain 言" and mnemonics per component.
* **Audio for whole sentences from native speakers** (the app currently uses the browser's
  built-in `ja-JP` speech synthesis, quality varies by OS).
* **Daily goal + reminder** via a notification from the service worker.
* **Listening mode** — hear a word, type the kanji.
* **Custom decks** — save a hand-picked set of kanji as a named deck you can re-drill.
* **Typo-tolerant "almost right" grading** that offers half credit instead of a hard fail.
* **Confusion matrix** — which look-alike kanji you actually mix up, built from wrong answers
  in section 4.
