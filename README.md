# Symptom Tracker

A private, mobile-first app for tracking injuries over time. Log pain, symptoms, triggers,
treatments and questions the moment they happen, then walk your doctor through a clean
timeline and visit summary.

Plain HTML, CSS and JavaScript with no build step. It's hosted on GitHub Pages, works offline,
installs to your phone's home screen, and syncs between devices through an end-to-end encrypted
Cloudflare Worker.

## What it does

- **Log in two taps.** Tap *Log now*, set the pain level and save. Optional: what it feels like
  (sharp, clicking, squeaking…), what you were doing, details, "ask my doctor", and the time if
  it happened earlier. Chips put your most-used triggers and feelings first.
- **Six entry types**: pain, symptom, trigger, concern, treatment, note.
- **Timeline per injury.** Newest first, grouped by day and colored by pain level, under a
  trend chart (7 days / 30 days / 90 days / all). Filter by type or "to ask", and search.
- **Visit summary.** Pick a range (since your last visit, 2 weeks, 30 days…). It shows average
  and worst pain, flares, night pain, your questions as a checklist, common triggers, how it
  feels, how pain changed after each treatment, and every entry in order. *Print / PDF* gives
  a clean printout. *Share text* copies a plain-text version.
- **Appointments** on the home screen, each linked to its injury's visit summary.
- **Larger text** toggle on the visit summary for the exam room. Dark mode follows your phone.

## Your data

| Where | What |
| --- | --- |
| This device (IndexedDB) | Everything, always. Logging never waits for the network. |
| Sync server (Cloudflare D1) | One encrypted copy. It's encrypted on your device with your passphrase (PBKDF2 → AES-256-GCM), so the server can't read it. |
| Backup file | *Sync & backup → Save backup file* (.json). *Restore from file* merges it without duplicates. |
| Spreadsheet | *Export as spreadsheet* (.csv) for your own records. |

Nothing is stored in this repository. Edits merge record by record (the latest edit wins), so
you can log on two devices offline and they reconcile when they reconnect.

> **iPhone tip:** add the app to your home screen (Safari → Share → *Add to Home Screen*).
> Safari can clear storage for websites you haven't visited in a while; home-screen apps are
> exempt. With sync on, your data is safe either way.

## Setup

### 1. GitHub Pages

Repo → *Settings* → *Pages* → *Deploy from a branch* → pick the branch and `/ (root)` → *Save*.
The app will be at `https://githintz.github.io/SymptomTracker/`.

### 2. Sync server (Cloudflare, about 5 minutes)

1. **Worker**: [dash.cloudflare.com](https://dash.cloudflare.com) → *Workers & Pages* → *Create* →
   *Hello World* → name it `symptom-tracker` → *Deploy* → *Edit code* → paste `worker/worker.js` → *Deploy*.
2. **Database**: *Storage & Databases* → *D1 SQL Database* → *Create* → name `symptom-tracker`.
   You don't need to create tables; the worker does that.
3. **Bind it**: Worker → *Settings* → *Bindings* → *Add* → *D1 database* → variable name `DB`,
   database `symptom-tracker` → *Deploy*.
4. **Setup code**: Worker → *Settings* → *Variables and Secrets* → *Add* → type *Secret*, name
   `SETUP_CODE`, value: a long random code → *Deploy*. It's needed once to create your storage,
   and again only to reset it.
   Optional: add `ALLOWED_ORIGIN` (*Text*) = `https://githintz.github.io`.
5. `config.json` already points to `https://symptom-tracker.githintz.workers.dev`. If your worker
   ends up at another address, change it there, or type it in when you turn on sync.

### 3. Turn on sync

Open the app → cloud button → *Turn on encrypted sync*. Choose a passphrase (or tap *Suggest a
strong one*) and **write it down**: without it, synced data can't be decrypted. The first time,
it also asks for the setup code. On other devices, use *Add another device* (link + QR code),
or enter the same server and passphrase.

## Letting Claude add things

*Sync & backup → Let an assistant add things → Create key.* Then you can tell Claude, for example,
"add my ortho follow-up on Thursday at 10:30 with Dr. Patel to my symptom tracker", and it will
show up in the app at the next sync, marked with a ✦.

- The assistant key is **write-only**: it can add appointments, entries, questions and injuries,
  but it can't read anything.
- Items are sealed with the app's public key (ECDH P-256 + AES-GCM). The server can't read them,
  and only your app can open them.
- Revoke a key any time from the same screen.

Claude uses `tools/st.mjs` (see `CLAUDE.md`). The first time, Claude asks for the key through a
secure credential form for your worker's address. Don't paste it into the chat.

## Files

| Path | What it is |
| --- | --- |
| `index.html`, `manifest.webmanifest`, `sw.js` | Page shell, install info, offline cache |
| `css/styles.css` | All styling and animations |
| `js/app.js` | Screens and routing |
| `js/sheets.js` | Log, injury, appointment, sync and assistant sheets |
| `js/store.js` | Local data, merging, backups, assistant inbox items |
| `js/sync.js`, `js/crypto.js` | Encrypted sync and the inbox |
| `js/stats.js`, `js/charts.js` | Summary numbers and SVG charts |
| `worker/worker.js` | The sync server (Cloudflare Worker + D1) |
| `tools/st.mjs` | Command-line tool for adding items through the assistant inbox |

When you change any app file, bump `VERSION` in `sw.js` so installed copies update.
