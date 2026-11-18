// Symptom Tracker sync server: a Cloudflare Worker with a D1 database (the free plan is plenty).
//
// It only ever stores encrypted data. The app encrypts everything with your passphrase before
// uploading, and the assistant inbox holds items sealed to a key only the app can open.
//
// Setup (Worker → Settings):
//   Bindings → D1 database, variable name: DB
//   Variables and Secrets:
//     SETUP_CODE     (secret) a long code you choose; needed once to create your storage, or to reset it
//     ALLOWED_ORIGIN (text, optional) e.g. https://githintz.github.io
//
// Routes
//   GET    /v1/vault/meta             public: does storage exist, its salt
//   POST   /v1/vault                  create storage (X-Setup-Code)
//   DELETE /v1/vault                  erase everything (X-Setup-Code)
//   GET    /v1/vault?known=<version>  encrypted data if newer than <version> (X-Vault-Auth)
//   PUT    /v1/vault                  upload a new version {base, data} (X-Vault-Auth)
//   PUT    /v1/inbox-key              publish the inbox public key (X-Vault-Auth)
//   GET    /v1/inbox, DELETE /v1/inbox {ids}            read / clear the inbox (X-Vault-Auth)
//   GET|POST /v1/tokens, DELETE /v1/tokens/<id>         assistant keys (X-Vault-Auth)
//   GET    /v1/agent/key              inbox public key (Authorization: Bearer <assistant key>)
//   POST   /v1/agent/inbox            drop a sealed item in the inbox (Authorization: Bearer <assistant key>)

const MAX_VAULT = 1_900_000;   // bytes of encrypted data
const MAX_ITEM = 64_000;       // bytes per inbox item
const MAX_INBOX = 500;         // waiting inbox items
const MAX_TOKENS = 20;

let ready = false;
async function init(db) {
  if (ready) return;
  await db.batch([
    db.prepare('CREATE TABLE IF NOT EXISTS vault (id TEXT PRIMARY KEY, salt TEXT NOT NULL, iterations INTEGER NOT NULL, auth_hash TEXT NOT NULL, data TEXT, version INTEGER NOT NULL DEFAULT 0, updated_at TEXT, inbox_key TEXT)'),
    db.prepare('CREATE TABLE IF NOT EXISTS inbox (id TEXT PRIMARY KEY, data TEXT NOT NULL, token_id TEXT, created_at TEXT NOT NULL)'),
    db.prepare('CREATE TABLE IF NOT EXISTS tokens (id TEXT PRIMARY KEY, hash TEXT NOT NULL UNIQUE, label TEXT, created_at TEXT, last_used TEXT)'),
  ]);
  ready = true;
}

const te = new TextEncoder();
const now = () => new Date().toISOString();
const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
const sha256 = async (s) => hex(await crypto.subtle.digest('SHA-256', te.encode(String(s))));
const randomId = (n = 12) => hex(crypto.getRandomValues(new Uint8Array(n)));
const clean = (s, n = 60) => String(s || '').replace(/[<>\n\r]/g, '').trim().slice(0, n);

// compare two strings in constant time (via their hashes)
async function safeEqual(a, b) {
  const [x, y] = await Promise.all([sha256(a), sha256(b)]);
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return d === 0;
}

function cors(env, request) {
  const origin = request.headers.get('Origin') || '';
  const allowed = env.ALLOWED_ORIGIN ? (origin === env.ALLOWED_ORIGIN || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) ? origin : env.ALLOWED_ORIGIN) : '*';
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Vault-Auth, X-Setup-Code, Authorization',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

async function readJSON(request, max) {
  const text = await request.text();
  if (text.length > max) throw new HttpError(413, 'Too much data');
  try { return JSON.parse(text || '{}'); } catch { throw new HttpError(400, 'Invalid JSON'); }
}

async function getVault(env) { return env.DB.prepare("SELECT * FROM vault WHERE id = 'main'").first(); }

async function requireVault(env, request) {
  const v = await getVault(env);
  if (!v) throw new HttpError(404, 'Sync storage has not been created yet');
  const auth = request.headers.get('X-Vault-Auth') || '';
  if (!auth || !(await safeEqual(await sha256(auth), v.auth_hash))) throw new HttpError(401, 'Wrong passphrase');
  return v;
}

async function requireSetup(env, request) {
  if (!env.SETUP_CODE) throw new HttpError(500, 'SETUP_CODE is not set on the worker');
  const code = request.headers.get('X-Setup-Code') || '';
  if (!(await safeEqual(code, env.SETUP_CODE))) { await new Promise((r) => setTimeout(r, 800)); throw new HttpError(403, 'Wrong setup code'); }
}

async function requireAgent(env, request) {
  const m = /^Bearer\s+(.+)$/i.exec(request.headers.get('Authorization') || '');
  if (!m) throw new HttpError(401, 'Missing assistant key');
  const t = await env.DB.prepare('SELECT * FROM tokens WHERE hash = ?').bind(await sha256(m[1].trim())).first();
  if (!t) throw new HttpError(401, 'Unknown or revoked assistant key');
  await env.DB.prepare('UPDATE tokens SET last_used = ? WHERE id = ?').bind(now(), t.id).run();
  return t;
}

async function inboxCount(env) { return (await env.DB.prepare('SELECT COUNT(*) AS n FROM inbox').first()).n; }

async function handle(request, env) {
  if (!env.DB) throw new HttpError(500, 'The D1 database is not bound as DB');
  await init(env.DB);
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '');
  const m = request.method;

  if (path === '' || path === '/v1') return { ok: true, app: 'symptom-tracker' };

  if (path === '/v1/vault/meta' && m === 'GET') {
    const v = await getVault(env);
    return v ? { exists: true, salt: v.salt, iterations: v.iterations } : { exists: false };
  }

  if (path === '/v1/vault') {
    if (m === 'POST') {
      await requireSetup(env, request);
      if (await getVault(env)) throw new HttpError(409, 'Sync storage already exists');
      const b = await readJSON(request, 4000);
      if (!b.salt || !b.auth || !(b.iterations >= 100000)) throw new HttpError(400, 'Missing salt, iterations or auth');
      await env.DB.prepare("INSERT INTO vault (id, salt, iterations, auth_hash, data, version, updated_at) VALUES ('main', ?, ?, ?, NULL, 0, ?)")
        .bind(String(b.salt), Number(b.iterations), await sha256(b.auth), now()).run();
      return { ok: true, version: 0 };
    }
    if (m === 'DELETE') {
      await requireSetup(env, request);
      await env.DB.batch([env.DB.prepare('DELETE FROM vault'), env.DB.prepare('DELETE FROM inbox'), env.DB.prepare('DELETE FROM tokens')]);
      return { ok: true };
    }
    const v = await requireVault(env, request);
    if (m === 'GET') {
      if (url.searchParams.get('probe')) return { ok: true };
      const known = Number(url.searchParams.get('known'));
      const base = { version: v.version, updatedAt: v.updated_at, inboxKeyX: v.inbox_key ? JSON.parse(v.inbox_key).x : null, inboxCount: await inboxCount(env) };
      return known === v.version ? base : { ...base, data: v.data };
    }
    if (m === 'PUT') {
      const b = await readJSON(request, MAX_VAULT + 2000);
      if (typeof b.data !== 'string' || b.data.length > MAX_VAULT) throw new HttpError(413, 'Your data is too large to sync');
      const next = v.version + 1;
      const r = await env.DB.prepare("UPDATE vault SET data = ?, version = ?, updated_at = ? WHERE id = 'main' AND version = ?")
        .bind(b.data, next, now(), Number(b.base)).run();
      if (!r.meta.changes) throw Object.assign(new HttpError(409, 'Newer data on the server'), { version: v.version });
      return { version: next };
    }
  }

  if (path === '/v1/inbox-key' && m === 'PUT') {
    await requireVault(env, request);
    const b = await readJSON(request, 2000);
    const k = b.publicKey || {};
    if (k.kty !== 'EC' || k.crv !== 'P-256' || !k.x || !k.y) throw new HttpError(400, 'Invalid public key');
    await env.DB.prepare("UPDATE vault SET inbox_key = ? WHERE id = 'main'").bind(JSON.stringify({ kty: 'EC', crv: 'P-256', x: String(k.x), y: String(k.y) })).run();
    return { ok: true };
  }

  if (path === '/v1/inbox') {
    await requireVault(env, request);
    if (m === 'GET') {
      const { results } = await env.DB.prepare('SELECT i.id, i.data, i.created_at, t.label FROM inbox i LEFT JOIN tokens t ON t.id = i.token_id ORDER BY i.created_at LIMIT 200').all();
      return { items: results.map((r) => ({ id: r.id, data: JSON.parse(r.data), createdAt: r.created_at, from: r.label || '' })) };
    }
    if (m === 'DELETE') {
      const b = await readJSON(request, 40000);
      const ids = (Array.isArray(b.ids) ? b.ids : []).map(String).slice(0, 200);
      if (ids.length) await env.DB.batch(ids.map((id) => env.DB.prepare('DELETE FROM inbox WHERE id = ?').bind(id)));
      return { ok: true, removed: ids.length };
    }
  }

  if (path === '/v1/tokens') {
    await requireVault(env, request);
    if (m === 'GET') {
      const { results } = await env.DB.prepare('SELECT id, label, created_at, last_used FROM tokens ORDER BY created_at').all();
      return { tokens: results.map((t) => ({ id: t.id, label: t.label, createdAt: t.created_at, lastUsed: t.last_used })) };
    }
    if (m === 'POST') {
      const b = await readJSON(request, 2000);
      const n = (await env.DB.prepare('SELECT COUNT(*) AS n FROM tokens').first()).n;
      if (n >= MAX_TOKENS) throw new HttpError(400, 'Too many assistant keys. Revoke one first.');
      const token = `st_${randomId(24)}`;
      const id = randomId(6);
      await env.DB.prepare('INSERT INTO tokens (id, hash, label, created_at) VALUES (?, ?, ?, ?)').bind(id, await sha256(token), clean(b.label) || 'Assistant', now()).run();
      return { id, token, label: clean(b.label) || 'Assistant' };
    }
  }
  const tm = /^\/v1\/tokens\/([a-f0-9]+)$/.exec(path);
  if (tm && m === 'DELETE') {
    await requireVault(env, request);
    await env.DB.prepare('DELETE FROM tokens WHERE id = ?').bind(tm[1]).run();
    return { ok: true };
  }

  if (path === '/v1/agent/key' && m === 'GET') {
    await requireAgent(env, request);
    const v = await getVault(env);
    if (!v?.inbox_key) throw new HttpError(409, 'Open the app once with sync turned on to finish setup');
    return { publicKey: JSON.parse(v.inbox_key), waiting: await inboxCount(env) };
  }
  if (path === '/v1/agent/inbox' && m === 'POST') {
    const t = await requireAgent(env, request);
    const b = await readJSON(request, MAX_ITEM);
    if (b.v !== 1 || !b.epk?.x || !b.epk?.y || typeof b.iv !== 'string' || typeof b.ct !== 'string') throw new HttpError(400, 'Items must be sealed with the inbox key (see tools/st.mjs)');
    if ((await inboxCount(env)) >= MAX_INBOX) throw new HttpError(429, 'The inbox is full. Open the app to sync it.');
    const id = randomId(10);
    await env.DB.prepare('INSERT INTO inbox (id, data, token_id, created_at) VALUES (?, ?, ?, ?)')
      .bind(id, JSON.stringify({ v: 1, epk: { x: String(b.epk.x), y: String(b.epk.y) }, iv: b.iv, ct: b.ct }), t.id, now()).run();
    return { ok: true, id, waiting: await inboxCount(env) };
  }

  throw new HttpError(404, 'Not found');
}

export default {
  async fetch(request, env) {
    const headers = cors(env, request);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    try {
      const body = await handle(request, env);
      return Response.json(body, { headers: { ...headers, 'Cache-Control': 'no-store' } });
    } catch (e) {
      const status = e.status || 500;
      return Response.json({ error: e.message || 'Server error', ...(e.version != null ? { version: e.version } : {}) }, { status, headers });
    }
  },
};
