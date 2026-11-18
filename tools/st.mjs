#!/usr/bin/env node
// Add things to Symptom Tracker from the command line (meant for an assistant such as Claude).
//
// Items are sealed with the app's inbox public key, so the sync server can't read them. The app
// opens and merges them the next time it syncs. Access is write-only: this tool can't read data.
//
//   node tools/st.mjs check
//   node tools/st.mjs appointment --at 2026-11-20T10:30 --title "Ortho follow-up" --injury "Left shoulder" \
//        --provider "Dr. Patel" --location "Bayview Orthopedics, Suite 210" --notes "Bring MRI disc"
//   node tools/st.mjs entry --injury "Left shoulder" --type pain --pain 6 --feels Sharp,Squeaking \
//        --doing "Reaching overhead" --at 2026-11-18T09:12 --note "Grabbing a mug"
//   node tools/st.mjs question --injury "Left shoulder" --note "Should I get an MRI?"
//   node tools/st.mjs injury --name "Right wrist" --detail "Sprain from a fall" --started 2026-11-01
//   node tools/st.mjs incident --injury "Left shoulder" --title "Flare after hike" --summary "…" [--resolved 2026-12-01]
//        (then add --incident <incident id> to entry/question commands to file them under it)
//   node tools/st.mjs patch --target entry --id <id> --set '{"incident":"<incident id>","ask":false}'
//        (changes only those fields, keeping anything the user edited in the app)
//   node tools/st.mjs delete --target appointment --id <id printed when it was added>
//   node tools/st.mjs json '{"kind":"appointment","at":"2026-11-20T10:30","title":"Physio"}'
//
// Re-using --id with appointment/entry/injury updates that item instead of adding a new one.
// Times without a timezone are read as local time on the phone.
//
// Config: the server comes from ST_SYNC_URL or config.json's syncUrl. The assistant key comes
// from ST_AGENT_KEY. In a Claude cloud session the key is injected by the network proxy, so
// ST_AGENT_KEY can stay unset.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { webcrypto as crypto } from 'node:crypto';

// Node's built-in fetch ignores HTTPS_PROXY unless NODE_USE_ENV_PROXY is set (Node >= 22.21).
// Behind a proxy (e.g. a Claude cloud session), re-run this script with it turned on.
if ((process.env.HTTPS_PROXY || process.env.https_proxy) && !process.env.NODE_USE_ENV_PROXY) {
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync(process.execPath, ['--no-warnings', ...process.argv.slice(1)], { stdio: 'inherit', env: { ...process.env, NODE_USE_ENV_PROXY: '1' } });
  process.exit(r.status ?? 1);
}

const here = dirname(fileURLToPath(import.meta.url));
const te = new TextEncoder();
const b64 = (buf) => Buffer.from(buf instanceof Uint8Array ? buf : new Uint8Array(buf)).toString('base64');

function die(msg) { console.error(`error: ${msg}`); process.exit(1); }

function syncUrl() {
  if (process.env.ST_SYNC_URL) return process.env.ST_SYNC_URL.replace(/\/+$/, '');
  try { return JSON.parse(readFileSync(join(here, '..', 'config.json'), 'utf8')).syncUrl.replace(/\/+$/, ''); }
  catch { return die('No sync server: set ST_SYNC_URL or syncUrl in config.json'); }
}
// A placeholder works when a proxy injects the real key into the Authorization header.
const agentKey = () => process.env.ST_AGENT_KEY || 'st_injected_by_proxy';

async function call(method, path, body) {
  const res = await fetch(syncUrl() + path, {
    method,
    headers: { Authorization: `Bearer ${agentKey()}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  }).catch((e) => die(`can't reach ${syncUrl()}: ${e.cause?.code || e.message}`));
  const data = await res.json().catch(() => ({}));
  if (!res.ok) die(`${res.status} ${data.error || res.statusText}`);
  return data;
}

async function sealItem(item) {
  const { publicKey } = await call('GET', '/v1/agent/key');
  const alg = { name: 'ECDH', namedCurve: 'P-256' };
  const pub = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: publicKey.x, y: publicKey.y }, alg, false, []);
  const eph = await crypto.subtle.generateKey(alg, true, ['deriveBits']);
  const shared = await crypto.subtle.deriveBits({ name: 'ECDH', public: pub }, eph.privateKey, 256);
  const hk = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  const aes = await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: te.encode('symptom-tracker inbox v1') }, hk, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aes, te.encode(JSON.stringify(item)));
  const epk = await crypto.subtle.exportKey('jwk', eph.publicKey);
  return { v: 1, epk: { x: epk.x, y: epk.y }, iv: b64(iv), ct: b64(ct) };
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, inline] = a.slice(2).split(/=(.*)/s);
      const next = argv[i + 1];
      if (inline !== undefined) out[k] = inline;
      else if (next === undefined || next.startsWith('--')) out[k] = true;
      else { out[k] = next; i++; }
    } else out._.push(a);
  }
  return out;
}
const list = (v) => (typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : []);
const need = (o, k, hint) => { if (!o[k] || o[k] === true) die(`--${k} is required${hint ? ` (${hint})` : ''}`); return o[k]; };
const dateLike = (v, k) => { if (v && !/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?)?([+-]\d{2}:?\d{2}|Z)?$/.test(v)) die(`--${k} should look like 2026-11-20T10:30`); return v ? v.replace(' ', 'T') : v; };

function build(cmd, o) {
  const id = typeof o.id === 'string' ? o.id : crypto.randomUUID();
  switch (cmd) {
    case 'appointment': case 'appt':
      return { kind: 'appointment', id, at: dateLike(need(o, 'at', 'YYYY-MM-DDTHH:MM, or a date for all day'), 'at'), title: o.title || 'Appointment', injury: o.injury || '', provider: o.provider || '', location: o.location || '', notes: o.notes || '' };
    case 'entry': {
      const type = o.type || 'note';
      if (!['pain', 'symptom', 'trigger', 'concern', 'treatment', 'note'].includes(type)) die('--type must be pain, symptom, trigger, concern, treatment or note');
      if (o.pain !== undefined && !(Number(o.pain) >= 0 && Number(o.pain) <= 10)) die('--pain must be 0 to 10');
      return { kind: 'entry', id, injury: need(o, 'injury'), type, at: dateLike(o.at, 'at') || new Date().toISOString(), pain: o.pain !== undefined ? Number(o.pain) : null, feels: list(o.feels), doing: list(o.doing), note: o.note || '', ...(o.ask !== undefined ? { ask: !!o.ask } : {}), ...(o.answered ? { askDone: true } : {}), incident: typeof o.incident === 'string' ? o.incident : '' };
    }
    case 'question': case 'concern':
      return { kind: 'entry', id, injury: need(o, 'injury'), type: 'concern', at: dateLike(o.at, 'at') || new Date().toISOString(), note: need(o, 'note', 'the question'), ask: true, incident: typeof o.incident === 'string' ? o.incident : '' };
    case 'incident':
      return { kind: 'incident', id, injury: need(o, 'injury'), title: need(o, 'title'), summary: o.summary || '', status: o.resolved ? 'resolved' : 'ongoing', resolvedOn: typeof o.resolved === 'string' ? dateLike(o.resolved, 'resolved') : '' };
    case 'patch': {
      if (!['appointment', 'entry', 'incident'].includes(o.target)) die('--target must be appointment, entry or incident');
      let set; try { set = JSON.parse(need(o, 'set', 'a JSON object of fields')); } catch { die('--set must be JSON'); }
      return { kind: 'patch', target: o.target, id: need(o, 'id'), set };
    }
    case 'injury':
      return { kind: 'injury', id, name: need(o, 'name'), detail: o.detail || '', startedOn: dateLike(o.started, 'started') || '', status: o.resolved ? 'resolved' : 'active' };
    case 'delete':
      if (!['appointment', 'entry', 'injury', 'incident'].includes(o.target)) die('--target must be appointment, entry, injury or incident');
      return { kind: 'delete', target: o.target, id: need(o, 'id') };
    case 'json': {
      try { const v = JSON.parse(o._[1] || ''); return Array.isArray(v) ? v.map((x) => ({ id: crypto.randomUUID(), ...x })) : { id, ...v }; }
      catch { return die('json needs one JSON object (or an array of them) as its argument'); }
    }
    default: return null;
  }
}

const args = parseArgs(process.argv.slice(2));
const cmd = args._[0];
if (!cmd || cmd === 'help' || args.help) {
  console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n'));
  process.exit(0);
}
if (cmd === 'check') {
  const r = await call('GET', '/v1/agent/key');
  console.log(`ok: ${syncUrl()} accepts this assistant key; ${r.waiting} item(s) waiting for the app to sync`);
  process.exit(0);
}
const item = build(cmd, args);
if (!item) die(`unknown command "${cmd}" (try: help)`);
if (args['dry-run']) { console.log(JSON.stringify(item, null, 2)); process.exit(0); }
const r = await call('POST', '/v1/agent/inbox', await sealItem(item));
const ids = Array.isArray(item) ? item.map((x) => x.id) : [item.id];
console.log(`sent: ${cmd} (id ${ids.join(', ')}); ${r.waiting} item(s) waiting. It appears in the app at its next sync.`);
