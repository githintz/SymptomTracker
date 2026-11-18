// Encrypted sync with the Symptom Tracker sync server (worker/worker.js on Cloudflare).
//
// The whole data set is encrypted on this device and stored as one blob with a version
// number. Each sync: download any newer version → merge record by record → upload if this
// device has something the server doesn't. Items an assistant dropped in the inbox are
// opened and merged on the way.

import * as S from './store.js';
import * as C from './crypto.js';

let cfg = { url: '', auth: '', passphrase: '', salt: '', iterations: C.ITERATIONS, version: 0, lastSyncAt: '' };
let key = null;
let defaultUrl = '';
let status = { state: 'off', detail: '' };
let running = null, again = false, timer = null;
const subs = new Set();
const inboxListeners = new Set();

export const onStatus = (fn) => { subs.add(fn); return () => subs.delete(fn); };
export const onInbox = (fn) => { inboxListeners.add(fn); return () => inboxListeners.delete(fn); };
const setStatus = (state, detail = '') => { status = { state, detail }; subs.forEach((fn) => fn(status)); };
export const getStatus = () => status;
export const getConfig = () => ({ ...cfg, passphrase: undefined, auth: undefined, hasPassphrase: !!cfg.passphrase });
export const configured = () => !!(cfg.url && cfg.auth);
export const getDefaultUrl = () => defaultUrl;
const clean = (u) => String(u || '').trim().replace(/\/+$/, '');

export function deviceName() {
  const ua = navigator.userAgent;
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad|Macintosh.*Mobile/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) ? 'iPad'
    : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'Device';
  const br = /Edg\//.test(ua) ? 'Edge' : /Firefox|FxiOS/.test(ua) ? 'Firefox' : /Chrome|CriOS/.test(ua) ? 'Chrome' : /Safari/.test(ua) ? 'Safari' : '';
  const app = matchMedia('(display-mode: standalone)').matches || navigator.standalone ? 'app' : br;
  return app ? `${os} · ${app}` : os;
}

export async function init(urlFromConfig) {
  defaultUrl = clean(urlFromConfig);
  cfg = { ...cfg, ...((await S.kvGet('sync')) || {}) };
  S.onChange((why) => { if (why === 'local') soon(1500); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) soon(300); });
  window.addEventListener('online', () => soon(300));
  setInterval(() => { if (!document.hidden) soon(0); }, 60000);
  if (configured()) {
    setStatus('idle');
    soon(200);
  }
}

async function getKey() {
  if (!key) key = (await C.deriveKeys(cfg.passphrase, cfg.salt, cfg.iterations)).key;
  return key;
}

async function api(method, path, { body, headers = {}, base = cfg.url, auth = true } = {}) {
  let res;
  try {
    res = await fetch(base + path, {
      method, cache: 'no-store',
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(auth && cfg.auth ? { 'X-Vault-Auth': cfg.auth } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    const err = new Error(navigator.onLine === false ? "You're offline" : "Can't reach the sync server");
    err.offline = true;
    throw err;
  }
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) {
    const err = new Error(data?.error || `Sync server error (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data || {};
}

export function soon(ms = 1000) {
  if (!configured()) return;
  clearTimeout(timer);
  timer = setTimeout(() => { syncNow().catch(() => {}); }, ms);
}

export async function syncNow() {
  if (!configured()) return;
  if (running) { again = true; return running; }
  running = (async () => {
    setStatus('syncing');
    try {
      do { again = false; await syncOnce(); } while (again);
      cfg.lastSyncAt = new Date().toISOString();
      await S.kvSet('sync', cfg);
      setStatus('idle');
    } catch (e) {
      if (e.status === 401) setStatus('error', 'The sync passphrase no longer matches. The server may have been reset. Set up sync again.');
      else setStatus(e.offline ? 'offline' : 'error', e.message);
    } finally { running = null; }
  })();
  return running;
}

async function syncOnce() {
  const k = await getKey();
  let inboxIds = [];
  for (let attempt = 0; attempt < 4; attempt++) {
    // 1. pull
    const res = await api('GET', `/v1/vault?known=${cfg.version}`);
    let remoteBehind = res.version === 0;
    if (res.data) {
      const remote = await C.open(k, res.data);
      remoteBehind = S.merge(remote).remoteBehind;
    }
    cfg.version = res.version;

    // 2. keep the inbox key and this device's entry up to date
    const doc = S.getDoc();
    if (!doc.meta.inboxKey?.priv) S.setMeta('inboxKey', await C.newInboxKeys());
    const dev = doc.devices[S.getLocal().deviceId];
    if (!dev || Date.now() - Date.parse(dev.lastSeen) > 6 * 3600e3 || dev.name !== deviceName()) S.touchDevice(deviceName());

    // 3. open anything an assistant left in the inbox
    if (attempt === 0 && res.inboxCount > 0) inboxIds = await pullInbox();

    // 4. push if the server is missing something
    if (remoteBehind || S.isDirty()) {
      const at = S.changeSeq();
      const data = await C.seal(k, S.getDoc());
      try {
        const put = await api('PUT', '/v1/vault', { body: { base: cfg.version, data } });
        cfg.version = put.version;
        await S.markClean(at);
      } catch (e) {
        if (e.status === 409) continue; // someone else synced first: pull again and re-merge
        throw e;
      }
    }
    await S.kvSet('sync', cfg);

    // 5. finish inbox and publish the inbox key if the server has a different one
    if (inboxIds.length) await api('DELETE', '/v1/inbox', { body: { ids: inboxIds } });
    const pub = S.getDoc().meta.inboxKey?.pub;
    if (pub && res.inboxKeyX !== pub.x) await api('PUT', '/v1/inbox-key', { body: { publicKey: pub } });
    return;
  }
  throw new Error('Sync kept conflicting. It will try again shortly.');
}

async function pullInbox() {
  const { items = [] } = await api('GET', '/v1/inbox');
  const priv = S.getDoc().meta.inboxKey?.priv;
  const done = [], added = [], failed = [];
  for (const it of items) {
    try {
      const item = await C.openInbox(priv, it.data);
      const list = Array.isArray(item) ? item : [item];
      for (const one of list) added.push(S.applyInbox(one, it.createdAt));
    } catch (e) { failed.push(e.message); }
    done.push(it.id);
  }
  if (added.length || failed.length) inboxListeners.forEach((fn) => fn({ added, failed }));
  return done;
}

// ---------------------------------------------------------------- setup

export async function serverInfo(url) {
  return api('GET', '/v1/vault/meta', { base: clean(url), auth: false });
}

// Connect this device. Creates the vault on the first device (needs the setup code).
export async function connect({ url, passphrase, setupCode }) {
  url = clean(url);
  passphrase = String(passphrase || '').trim();
  if (!/^https:\/\//.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1)/.test(url)) throw new Error('The server address should start with https://');
  if (passphrase.length < 12) throw new Error('Use a passphrase of at least 12 characters.');
  const meta = await serverInfo(url);
  let salt = meta.salt, iterations = meta.iterations || C.ITERATIONS;
  let created = false;
  if (!meta.exists) {
    if (!setupCode) { const e = new Error('This sync server is new. Enter its setup code to create your encrypted storage.'); e.needSetup = true; throw e; }
    salt = C.randomSalt();
    iterations = C.ITERATIONS;
  }
  const keys = await C.deriveKeys(passphrase, salt, iterations);
  if (!meta.exists) {
    await api('POST', '/v1/vault', { base: url, auth: false, body: { salt, iterations, auth: keys.auth }, headers: { 'X-Setup-Code': setupCode.trim() } });
    created = true;
  } else {
    try { await api('GET', '/v1/vault?known=-1&probe=1', { base: url, auth: false, headers: { 'X-Vault-Auth': keys.auth } }); }
    catch (e) { if (e.status === 401) throw new Error("That passphrase doesn't match the one used on your other devices."); throw e; }
  }
  cfg = { url, auth: keys.auth, passphrase, salt, iterations, version: 0, lastSyncAt: '' };
  key = keys.key;
  await S.kvSet('sync', cfg);
  await S.setLocal({ dirty: true });
  await syncNow();
  return { created };
}

export async function disconnect() {
  cfg = { url: '', auth: '', passphrase: '', salt: '', iterations: C.ITERATIONS, version: 0, lastSyncAt: '' };
  key = null;
  await S.kvSet('sync', cfg);
  setStatus('off');
}

export async function resetServer(url, setupCode) {
  await api('DELETE', '/v1/vault', { base: clean(url || cfg.url), auth: false, headers: { 'X-Setup-Code': String(setupCode || '').trim() } });
  if (clean(url || cfg.url) === cfg.url) await disconnect();
}

export const pairLink = () => `${location.origin}${location.pathname}#pair=${C.b64url(JSON.stringify({ u: cfg.url, p: cfg.passphrase }))}`;
export function readPairLink(hash) {
  try { const o = JSON.parse(C.unb64url(hash.replace(/^#pair=/, ''))); return { url: o.u || '', passphrase: o.p || '' }; } catch { return null; }
}

// ---------------------------------------------------------------- assistant keys
export const listTokens = () => api('GET', '/v1/tokens');
export const createToken = (label) => api('POST', '/v1/tokens', { body: { label } });
export const revokeToken = (id) => api('DELETE', `/v1/tokens/${encodeURIComponent(id)}`);
