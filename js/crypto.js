// End-to-end encryption (Web Crypto only, no libraries).
//
// Your sync passphrase is stretched with PBKDF2 into 512 bits: the first half is the AES-GCM key
// that encrypts all your data, the second half is the login token the sync server checks. The
// server never sees the passphrase or the encryption key, only scrambled data.
//
// The assistant inbox uses public-key encryption (ECDH P-256 + HKDF + AES-GCM): an assistant can
// seal an item with the app's public key, but only the app (which keeps the private key inside
// your encrypted data) can open it.

const te = new TextEncoder(), td = new TextDecoder();
export const ITERATIONS = 600000;
const INBOX_INFO = 'symptom-tracker inbox v1';

export function b64(buf) {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
  return btoa(s);
}
export const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export const b64url = (s) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const unb64url = (s) => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));
const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

export const randomSalt = () => b64(crypto.getRandomValues(new Uint8Array(16)));

const ALPHA = 'abcdefghjkmnpqrstuvwxyz23456789';
export function suggestPassphrase() {
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  const chars = Array.from(bytes, (x) => ALPHA[x % ALPHA.length]).join('');
  return chars.match(/.{4}/g).join('-');
}

export async function deriveKeys(passphrase, saltB64, iterations = ITERATIONS) {
  const base = await crypto.subtle.importKey('raw', te.encode(passphrase.normalize('NFKC')), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: unb64(saltB64), iterations, hash: 'SHA-256' }, base, 512));
  const key = await crypto.subtle.importKey('raw', bits.slice(0, 32), 'AES-GCM', false, ['encrypt', 'decrypt']);
  return { key, auth: hex(bits.slice(32)) };
}

async function pipe(bytes, stream) {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
}

export async function seal(key, obj) {
  let bytes = te.encode(JSON.stringify(obj));
  let z = null;
  if (typeof CompressionStream !== 'undefined') {
    try { bytes = await pipe(bytes, new CompressionStream('gzip')); z = 'gzip'; } catch { /* store uncompressed */ }
  }
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes);
  return JSON.stringify({ v: 1, z, iv: b64(iv), ct: b64(ct) });
}

export async function open(key, text) {
  const env = typeof text === 'string' ? JSON.parse(text) : text;
  let bytes = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(env.iv) }, key, unb64(env.ct)));
  if (env.z === 'gzip') {
    if (typeof DecompressionStream === 'undefined') throw new Error('This browser is too old to read the synced data.');
    bytes = await pipe(bytes, new DecompressionStream('gzip'));
  }
  return JSON.parse(td.decode(bytes));
}

export async function newInboxKeys() {
  const kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const pub = await crypto.subtle.exportKey('jwk', kp.publicKey);
  const priv = await crypto.subtle.exportKey('jwk', kp.privateKey);
  return { pub: { kty: pub.kty, crv: pub.crv, x: pub.x, y: pub.y }, priv };
}

export async function openInbox(privJwk, env) {
  if (!env || env.v !== 1 || !env.epk || !env.iv || !env.ct) throw new Error('Not an inbox item');
  const alg = { name: 'ECDH', namedCurve: 'P-256' };
  const priv = await crypto.subtle.importKey('jwk', { ...privJwk, key_ops: ['deriveBits'] }, alg, false, ['deriveBits']);
  const epk = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: env.epk.x, y: env.epk.y }, alg, false, []);
  const shared = await crypto.subtle.deriveBits({ name: 'ECDH', public: epk }, priv, 256);
  const hk = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  const aes = await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: te.encode(INBOX_INFO) }, hk, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(env.iv) }, aes, unb64(env.ct));
  return JSON.parse(td.decode(pt));
}
