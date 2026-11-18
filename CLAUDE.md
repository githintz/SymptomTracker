# Symptom Tracker: notes for Claude

A static GitHub Pages app (no build step) for tracking injury symptoms. See README.md for the
user-facing overview. The user's health data is never in this repo.

## Adding things for the user (appointments, entries, questions, injuries)

When the user asks you to add something to their symptom tracker, use `tools/st.mjs`. It seals
the item with the app's inbox public key and drops it in the sync server's write-only inbox. The
app merges it at its next sync. Node 18+ is enough; there are no dependencies.

```sh
node tools/st.mjs check      # verify the key and server first
node tools/st.mjs appointment --at 2026-11-20T10:30 --title "Ortho follow-up" --injury "Left shoulder" \
  --provider "Dr. Patel" --location "Bayview Orthopedics, Suite 210" --notes "Bring the MRI disc"
node tools/st.mjs entry --injury "Left shoulder" --type pain --pain 6 --feels Sharp,Squeaking \
  --doing "Reaching overhead" --at 2026-11-18T09:12 --note "Grabbing a mug"
node tools/st.mjs question --injury "Left shoulder" --note "Should I get an MRI?"
node tools/st.mjs injury --name "Right wrist" --detail "Sprain from a fall" --started 2026-11-01
node tools/st.mjs delete --target appointment --id <id from when it was added>
node tools/st.mjs json '[{"kind":"appointment","at":"2026-12-02","title":"MRI"}]'   # batch / anything else
node tools/st.mjs help
```

- Entry types: `pain`, `symptom`, `trigger`, `concern`, `treatment`, `note`. Pain is 0–10 (pain
  and symptom only). The built-in "feels like" chips are Sharp, Dull ache, Burning, Throbbing,
  Clicking, Squeaking, Stiff, Weak, Tingling and Swelling; other words become custom chips.
- `--injury` is matched by name (case-insensitive, partial match OK). An entry for an unknown
  injury creates that injury. An appointment for an unknown injury is kept unlinked, with the
  name shown as a hint.
- Times without a timezone (`2026-11-20T10:30`) are read as local time on the user's phone.
  A date alone (`--at 2026-11-20`) makes an all-day appointment. Resolve relative dates
  ("Thursday") against today's date and confirm them with the user if they're ambiguous.
- Each command prints an id. Re-send with `--id <id>` to update that item (e.g. a rescheduled
  appointment). Keep the id in your reply so the user can ask for changes later.
- Access is write-only: you can't read the user's entries or check what's already there. If they
  ask what's logged, say so and suggest they look in the app.
- After sending, tell the user it appears when they next open the app (it syncs on open).

### Credentials

The server comes from `config.json` (`syncUrl`), or `ST_SYNC_URL` to override it. The key is an
assistant key (`st_…`) the user creates in the app under *Sync & backup → Let an assistant add
things*. It goes in the `Authorization: Bearer` header:

- In a Claude cloud session: if `check` fails with 401 "Missing/Unknown assistant key", or the
  host is blocked, call `request_credential` for the worker host (e.g.
  `symptom-tracker.githintz.workers.dev`, bearer type), then retry. The proxy injects the key,
  so `ST_AGENT_KEY` can stay unset. Never ask the user to paste the key into the chat.
- Elsewhere: `ST_AGENT_KEY=st_… node tools/st.mjs …`.
- 409 "Open the app once with sync turned on": the app hasn't published its inbox key yet.

## Developing

- Plain ES modules; serve the folder with any static server to try it.
- Bump `VERSION` in `sw.js` whenever app files change, or installed copies keep the old cache.
- Data model (js/store.js): `injuries`, `entries`, `appointments`, `devices` are maps of
  id → record with `updatedAt`. Deletes are tombstones. Merging is per record, latest edit wins.
- Sync protocol and inbox format: comments at the top of `worker/worker.js` and `js/crypto.js`.
  Keep `tools/st.mjs`'s sealing (ECDH P-256 → HKDF-SHA256, info "symptom-tracker inbox v1" →
  AES-GCM) in step with `openInbox` in `js/crypto.js`.
- Design follows the TastyTripsPlanner repo: Shippori Mincho + Inter, paper background, teal
  accent, warm colors reserved for the 0–10 pain scale, one ease curve `cubic-bezier(0.22,1,0.36,1)`.
