// Local-first data store. Everything is kept in IndexedDB on this device, so logging works
// offline and instantly. sync.js merges it with the encrypted copy on the sync server.
//
// Records are merged one by one: the most recent edit (updatedAt) wins, and deletions are
// kept as small "tombstones" so they spread to other devices too.

export const TYPES = [
  { id: 'pain', label: 'Pain', icon: 'bolt' },
  { id: 'symptom', label: 'Symptom', icon: 'wave' },
  { id: 'trigger', label: 'Trigger', icon: 'target' },
  { id: 'concern', label: 'Concern', icon: 'help' },
  { id: 'treatment', label: 'Treatment', icon: 'pill' },
  { id: 'note', label: 'Note', icon: 'pen' },
];
export const TYPE = Object.fromEntries(TYPES.map((t) => [t.id, t]));
export const RATED = new Set(['pain', 'symptom']);

export const FEELS = ['Sharp', 'Dull ache', 'Burning', 'Throbbing', 'Clicking', 'Squeaking', 'Stiff', 'Weak', 'Tingling', 'Swelling'];
export const DOING = ['Lifting', 'Reaching overhead', 'Exercise', 'Sleeping', 'Sitting', 'Walking', 'Desk work'];
export const RX = ['Ice', 'Heat', 'Ibuprofen', 'Acetaminophen', 'PT exercises', 'Stretching', 'Rest', 'Massage'];

export const PAIN_WORDS = [
  ['No pain', 'Feeling fine'], ['Very mild', 'Barely noticeable'], ['Mild', "Noticeable, doesn't get in the way"],
  ['Uncomfortable', 'Distracting at times'], ['Moderate', 'Can push through it'], ['Moderate', 'Hard to ignore for long'],
  ['Distressing', 'Hard to ignore, limits some activity'], ['Severe', 'Hard to concentrate'], ['Intense', 'Limits most activity'],
  ['Very intense', 'Can barely move it'], ['Worst possible', 'Unbearable'],
];

const KINDS = ['injuries', 'entries', 'appointments', 'devices'];
const emptyDoc = () => ({ schema: 1, injuries: {}, entries: {}, appointments: {}, devices: {}, meta: {} });

// ---------------------------------------------------------------- key-value storage (IndexedDB, localStorage fallback)
let dbp = null;
function idb() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open('symptom-tracker', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('kv');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }).catch(() => null);
  }
  return dbp;
}
async function tx(mode, fn) {
  const db = await idb();
  if (!db) return undefined;
  return new Promise((resolve, reject) => {
    const t = db.transaction('kv', mode);
    const req = fn(t.objectStore('kv'));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
  });
}
export async function kvGet(key) {
  try { const db = await idb(); if (db) return await tx('readonly', (s) => s.get(key)); } catch { /* fall through */ }
  try { const v = localStorage.getItem(`st.${key}`); return v ? JSON.parse(v) : undefined; } catch { return undefined; }
}
export async function kvSet(key, value) {
  try { const db = await idb(); if (db) { await tx('readwrite', (s) => s.put(value, key)); return; } } catch { /* fall through */ }
  try { localStorage.setItem(`st.${key}`, JSON.stringify(value)); } catch { /* storage full or blocked */ }
}
export async function kvClearAll() {
  try { await tx('readwrite', (s) => s.clear()); } catch { /* ignore */ }
  try { Object.keys(localStorage).filter((k) => k.startsWith('st.')).forEach((k) => localStorage.removeItem(k)); } catch { /* ignore */ }
}

// ---------------------------------------------------------------- state
let doc = emptyDoc();
let local = {};
let seq = 0;
const subs = new Set();
export const onChange = (fn) => { subs.add(fn); return () => subs.delete(fn); };
const emit = (why) => subs.forEach((fn) => { try { fn(why); } catch (e) { console.error(e); } });

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);

export function normalize(d) {
  const out = emptyDoc();
  if (d && typeof d === 'object') {
    for (const k of KINDS) if (d[k] && typeof d[k] === 'object') out[k] = { ...d[k] };
    if (d.meta && typeof d.meta === 'object') out.meta = { ...d.meta };
  }
  return out;
}

export async function init() {
  doc = normalize(await kvGet('doc'));
  local = { ...((await kvGet('local')) || {}) };
  if (!local.deviceId) { local.deviceId = uid(); await kvSet('local', local); }
  try { await navigator.storage?.persist?.(); } catch { /* not supported */ }
}

export const getDoc = () => doc;
export const getLocal = () => local;
export const changeSeq = () => seq;
export async function setLocal(patch) { Object.assign(local, patch); await kvSet('local', local); }
export const isDirty = () => !!local.dirty;
export async function markClean(atSeq) { if (atSeq === seq) await setLocal({ dirty: false }); }

function changed() {
  seq++;
  local.dirty = true;
  kvSet('doc', doc);
  kvSet('local', local);
  emit('local');
}

// ---------------------------------------------------------------- queries
const live = (m) => Object.values(m).filter((r) => r && !r.deleted);
export const injuries = () => live(doc.injuries);
export const injury = (id) => { const r = doc.injuries[id]; return r && !r.deleted ? r : null; };
export const entry = (id) => { const r = doc.entries[id]; return r && !r.deleted ? r : null; };
export const appointment = (id) => { const r = doc.appointments[id]; return r && !r.deleted ? r : null; };
export const entries = (injuryId) => live(doc.entries).filter((e) => !injuryId || e.injuryId === injuryId).sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
export const appointments = (injuryId) => live(doc.appointments).filter((a) => !injuryId || a.injuryId === injuryId).sort((a, b) => (a.at < b.at ? -1 : 1));
export const upcoming = (injuryId) => appointments(injuryId).filter((a) => new Date(a.at) > Date.now() - 2 * 3600e3);
export const devices = () => live(doc.devices).sort((a, b) => (a.lastSeen < b.lastSeen ? 1 : -1));
export const lastActivity = (injuryId) => entries(injuryId)[0]?.at || injury(injuryId)?.createdAt || '';

// tags used before for an injury (most used first), followed by the defaults
export function tagOptions(field, injuryId, defaults) {
  const counts = new Map();
  for (const e of entries()) {
    const w = e.injuryId === injuryId ? 3 : 1;
    for (const t of e[field] || []) counts.set(t, (counts.get(t) || 0) + w);
  }
  const used = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
  return [...new Set([...used, ...defaults])];
}

// ---------------------------------------------------------------- mutations
function stamp(prev) {
  let t = Date.now();
  if (prev && Date.parse(prev) >= t) t = Date.parse(prev) + 1;
  return new Date(t).toISOString();
}

export function save(kind, rec) {
  const prev = doc[kind][rec.id];
  const now = new Date().toISOString();
  const r = { ...rec, id: rec.id || uid(), createdAt: rec.createdAt || prev?.createdAt || now, updatedAt: stamp(prev?.updatedAt) };
  delete r.deleted;
  doc[kind][r.id] = r;
  changed();
  return r;
}

// returns the removed records so the caller can offer Undo
export function remove(kind, id) {
  const removed = [];
  const tomb = (k, rid) => { const prev = doc[k][rid]; if (!prev || prev.deleted) return; removed.push([k, prev]); doc[k][rid] = { id: rid, deleted: true, updatedAt: stamp(prev.updatedAt) }; };
  tomb(kind, id);
  if (kind === 'injuries') {
    for (const e of live(doc.entries)) if (e.injuryId === id) tomb('entries', e.id);
    for (const a of live(doc.appointments)) if (a.injuryId === id) tomb('appointments', a.id);
  }
  changed();
  return removed;
}
export function restore(removed) {
  for (const [k, rec] of removed) doc[k][rec.id] = { ...rec, updatedAt: stamp(doc[k][rec.id]?.updatedAt) };
  changed();
}

export function setMeta(key, value) {
  doc.meta[key] = { ...value, updatedAt: stamp(doc.meta[key]?.updatedAt) };
  changed();
}

export function touchDevice(name) {
  const id = local.deviceId;
  doc.devices[id] = { id, name, lastSeen: new Date().toISOString(), updatedAt: stamp(doc.devices[id]?.updatedAt) };
  changed();
}

// ---------------------------------------------------------------- merging
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function winner(a, b) {
  if (!a) return b;
  if (!b) return a;
  if (a.updatedAt !== b.updatedAt) return (a.updatedAt || '') > (b.updatedAt || '') ? a : b;
  if (!!a.deleted !== !!b.deleted) return a.deleted ? a : b;
  return JSON.stringify(a) >= JSON.stringify(b) ? a : b;
}

// Merge another copy (from the server or a backup file) into this one.
// localChanged: this device learned something. remoteBehind: the other copy is missing something.
export function merge(other, { fromBackup = false } = {}) {
  other = normalize(other);
  let localChanged = false, remoteBehind = false;
  for (const k of [...KINDS, 'meta']) {
    const ids = new Set([...Object.keys(doc[k]), ...Object.keys(other[k])]);
    for (const id of ids) {
      const l = doc[k][id], r = other[k][id];
      const w = winner(l, r);
      if (!same(w, l)) { doc[k][id] = w; localChanged = true; }
      if (!same(w, r)) remoteBehind = true;
    }
  }
  if (localChanged) {
    if (fromBackup) changed();
    else { seq++; kvSet('doc', doc); emit('remote'); }
  }
  return { localChanged, remoteBehind };
}

// ---------------------------------------------------------------- assistant inbox
// Items an assistant sent through the sync server's write-only inbox (see tools/st.mjs).
const str = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
const strList = (v) => (Array.isArray(v) ? v.map((x) => str(x, 40)).filter(Boolean).slice(0, 12) : []);

export function findInjury(name) {
  const n = str(name, 80).toLowerCase();
  if (!n) return null;
  const all = injuries().sort((a, b) => (a.status === 'resolved') - (b.status === 'resolved'));
  return all.find((i) => i.name.toLowerCase() === n)
    || all.find((i) => i.name.toLowerCase().includes(n) || n.includes(i.name.toLowerCase()))
    || null;
}

function parseWhen(v) {
  if (typeof v !== 'string' || !v) return null;
  const d = new Date(v);
  return Number.isNaN(+d) ? null : d;
}

// returns a short description of what was added, or throws if the item is invalid
export function applyInbox(item, receivedAt) {
  if (!item || typeof item !== 'object') throw new Error('Empty item');
  const id = str(item.id, 80) || uid();
  const base = { id, source: 'assistant', addedAt: receivedAt || new Date().toISOString() };
  if (item.kind === 'delete') {
    const kind = { appointment: 'appointments', entry: 'entries', injury: 'injuries' }[item.target];
    if (!kind || !doc[kind][item.id]) throw new Error('Nothing to delete');
    remove(kind, item.id);
    return 'Removed an item';
  }
  if (item.kind === 'injury') {
    const name = str(item.name, 80);
    if (!name) throw new Error('Injury needs a name');
    const existing = doc.injuries[id] && !doc.injuries[id].deleted ? doc.injuries[id] : findInjury(name);
    save('injuries', { ...(existing || base), name, detail: str(item.detail, 140) || existing?.detail || '', startedOn: str(item.startedOn, 10) || existing?.startedOn || '', status: item.status === 'resolved' ? 'resolved' : existing?.status || 'active' });
    return `Injury: ${name}`;
  }
  if (item.kind === 'appointment') {
    const at = str(item.at, 25);
    if (!/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?/.test(at)) throw new Error('Appointment needs a date');
    const inj = findInjury(item.injury);
    const prev = doc.appointments[id] && !doc.appointments[id].deleted ? doc.appointments[id] : null;
    save('appointments', {
      ...(prev || base), injuryId: inj?.id || prev?.injuryId || '', injuryHint: inj ? '' : str(item.injury, 80),
      at: at.length === 10 ? `${at}T09:00` : at.slice(0, 16), allDay: at.length === 10,
      title: str(item.title, 80) || 'Appointment', provider: str(item.provider, 80), location: str(item.location, 140),
      notes: str(item.notes, 2000),
    });
    return `Appointment: ${str(item.title, 80) || 'Appointment'}`;
  }
  if (item.kind === 'entry') {
    const type = TYPE[item.type] ? item.type : 'note';
    let inj = findInjury(item.injury);
    if (!inj) {
      const name = str(item.injury, 80);
      if (!name) throw new Error('Entry needs an injury');
      inj = save('injuries', { id: uid(), name, detail: '', status: 'active', source: 'assistant', startedOn: '' });
    }
    const when = parseWhen(item.at) || new Date();
    const pain = RATED.has(type) && item.pain != null && item.pain !== '' ? Math.max(0, Math.min(10, Math.round(Number(item.pain)))) : null;
    save('entries', {
      ...base, injuryId: inj.id, type, at: when.toISOString(), pain: Number.isFinite(pain) ? pain : null,
      feels: strList(item.feels), doing: strList(item.doing), note: str(item.note, 4000),
      ask: item.ask === undefined ? type === 'concern' : !!item.ask, askDone: !!item.askDone,
    });
    return `${TYPE[type].label} for ${inj.name}`;
  }
  throw new Error(`Unknown kind "${item.kind}"`);
}

// ---------------------------------------------------------------- backup files
export function backupJSON() {
  return JSON.stringify({ app: 'symptom-tracker', format: 1, exportedAt: new Date().toISOString(), doc }, null, 1);
}
export function restoreJSON(text) {
  const data = JSON.parse(text);
  if (!data || data.app !== 'symptom-tracker' || !data.doc) throw new Error("This isn't a Symptom Tracker backup file.");
  const before = live(doc.entries).length;
  merge(data.doc, { fromBackup: true });
  return live(doc.entries).length - before;
}
export function csv() {
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['Injury', 'Date', 'Time', 'Type', 'Pain (0-10)', 'Feels like', 'Activity / trigger', 'Details', 'Ask doctor']];
  for (const e of entries().reverse()) {
    const d = new Date(e.at);
    rows.push([injury(e.injuryId)?.name || '', d.toLocaleDateString(), d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }), TYPE[e.type]?.label || e.type, e.pain ?? '', (e.feels || []).join('; '), (e.doing || []).join('; '), e.note || '', e.ask ? (e.askDone ? 'Asked' : 'Yes') : '']);
  }
  return rows.map((r) => r.map(q).join(',')).join('\r\n');
}
