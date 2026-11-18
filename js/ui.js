// Small UI helpers: escaping, icons, pain colors, dates, toasts, bottom sheets, segmented controls.

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const P = {
  cloud: '<path d="M7 18a4 4 0 01-.6-7.95A6 6 0 0118 9a4.5 4.5 0 01-.5 9H7z"/>',
  chev: '<path d="M9 6l6 6-6 6"/>', left: '<path d="M15 6l-6 6 6 6"/>', down: '<path d="M6 9l6 6 6-6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>', x: '<path d="M6 6l12 12M18 6L6 18"/>',
  bolt: '<path d="M13 3L5 13.5h6L10 21l8-10.5h-6L13 3z"/>', wave: '<path d="M3 12h3l2.5-6 4 12 3-9 1.5 3H21"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.5a2.5 2.5 0 014.8 1c0 1.7-2.4 2-2.4 3.5M12 17h.01"/>',
  pill: '<rect x="3.5" y="8.5" width="17" height="7" rx="3.5" transform="rotate(-35 12 12)"/><path d="M9.6 8.6l4.8 6.8"/>',
  pen: '<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>', clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
  clip: '<rect x="5" y="4.5" width="14" height="16.5" rx="2.5"/><path d="M9 4.5h6v3H9zM8.5 12h7M8.5 16h4.5"/>',
  share: '<path d="M12 3v12M7.5 7.5L12 3l4.5 4.5"/><path d="M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7"/>',
  cal: '<rect x="4" y="5.5" width="16" height="15" rx="2.5"/><path d="M4 10h16M9 3.5v4M15 3.5v4"/>',
  print: '<path d="M7 9V4h10v5"/><rect x="4" y="9" width="16" height="8" rx="2"/><path d="M7 14h10v6H7z"/>',
  text: '<path d="M4 7V5h10v2M9 5v14M7 19h4M14 12v-1.5h6V12M17 10.5V19M15.5 19h3"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V8a4 4 0 018 0v2.5"/>',
  phone: '<rect x="7" y="3" width="10" height="18" rx="2.5"/><path d="M11 18h2"/>', laptop: '<rect x="5" y="5" width="14" height="10" rx="1.5"/><path d="M3 19h18"/>',
  download: '<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 20h14"/>', upload: '<path d="M12 15V4M7.5 8.5L12 4l4.5 4.5M5 20h14"/>',
  table: '<rect x="4" y="4.5" width="16" height="15" rx="2"/><path d="M4 9.5h16M4 14.5h16M10 4.5v15"/>',
  refresh: '<path d="M20 12a8 8 0 11-2.3-5.6"/><path d="M20 4v4.5h-4.5"/>', trash: '<path d="M5 7h14M10 7V4.5h4V7M7 7l1 13h8l1-13"/>',
  more: '<circle cx="5.5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="18.5" cy="12" r="1.2"/>',
  spark: '<path d="M12 3.5l1.9 5.6 5.6 1.9-5.6 1.9L12 18.5l-1.9-5.6L4.5 11l5.6-1.9L12 3.5z"/><path d="M19 16.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/>',
  link: '<path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2.5"/><path d="M15.5 8.5V6a1.5 1.5 0 00-1.5-1.5H6A1.5 1.5 0 004.5 6v8A1.5 1.5 0 006 15.5h2.5"/>',
  pin: '<path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0113 0c0 5-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
  user: '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20a7 7 0 0114 0"/>', key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l8-8M16 7l2.5 2.5M14 9l2 2"/>',
  moon: '<path d="M19.5 14.5A8 8 0 019.5 4.5a8 8 0 1010 10z"/>', archive: '<rect x="3.5" y="4.5" width="17" height="4.5" rx="1.5"/><path d="M5 9v9.5A1.5 1.5 0 006.5 20h11a1.5 1.5 0 001.5-1.5V9M10 13h4"/>',
};
export const icon = (name, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${P[name] || ''}</svg>`;

// ---------------------------------------------------------------- pain colors (green → amber → red)
export function sevColor(v) {
  v = Math.max(0, Math.min(10, Number(v) || 0));
  const h = v <= 5 ? 145 - v * 21 : 40 - (v - 5) * 9;
  return `hsl(${h} ${v <= 2 ? 40 : 62}% ${v >= 4 && v <= 6 ? 44 : 42}%)`;
}
export const sevBadge = (v, cls = '') => (v == null ? '' : `<span class="sev ${cls}" style="--sev:${sevColor(v)}">${v}</span>`);

// ---------------------------------------------------------------- dates
const pad = (n) => String(n).padStart(2, '0');
export const dayKey = (d) => { d = new Date(d); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
export const toLocalInput = (d) => { d = new Date(d); return `${dayKey(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
export const startOfDay = (d) => { d = new Date(d); d.setHours(0, 0, 0, 0); return d; };
export const addDays = (d, n) => { d = new Date(d); d.setDate(d.getDate() + n); return d; };
export const daysBetween = (a, b) => Math.round((startOfDay(b) - startOfDay(a)) / 86400000);
export const fmtTime = (d) => new Date(d).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
export const fmtDate = (d, opts = {}) => new Date(d).toLocaleDateString([], { month: 'short', day: 'numeric', ...opts });
export const fmtDateLong = (d) => new Date(d).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: new Date(d).getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined });
export function fmtDay(d) {
  const diff = daysBetween(d, new Date());
  const label = new Date(d).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: new Date(d).getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined });
  if (diff === 0) return `Today · ${label}`;
  if (diff === 1) return `Yesterday · ${label}`;
  return label;
}
export function ago(d) {
  const s = (Date.now() - new Date(d)) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  const days = Math.floor(s / 86400);
  if (days < 7) return days === 1 ? 'yesterday' : `${days} days ago`;
  return fmtDate(d);
}
export function apptWhen(at) {
  const d = new Date(at), diff = daysBetween(new Date(), d);
  const t = fmtTime(d);
  if (diff === 0) return `Today ${t}`;
  if (diff === 1) return `Tomorrow ${t}`;
  if (diff > 1 && diff < 7) return `${d.toLocaleDateString([], { weekday: 'short' })} ${t}`;
  return `${fmtDate(d, { weekday: 'short' })} · ${t}`;
}

// ---------------------------------------------------------------- toast
let toastTimer;
export function toast(msg, { action, onAction, ms = 3200 } = {}) {
  const el = document.getElementById('toast');
  clearTimeout(toastTimer);
  el.innerHTML = `${icon('check', 'sm')}<span>${esc(msg)}</span>${action ? `<button type="button">${esc(action)}</button>` : ''}`;
  el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  const b = el.querySelector('button');
  if (b) b.onclick = () => { el.classList.remove('show'); onAction?.(); };
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

// ---------------------------------------------------------------- bottom sheets (centred dialog on wide screens)
const stack = [];
let pendingPop = null;
window.addEventListener('popstate', () => {
  if (pendingPop) { const r = pendingPop; pendingPop = null; r(); return; }
  const top = stack[stack.length - 1];
  if (top) closeSheet(top, true);
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && stack.length) stack[stack.length - 1].close(); });
export const sheetOpen = () => stack.length > 0;

export function openSheet({ title, body = '', foot = '', right = '', cls = '', onClose } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `<div class="scrim"></div>
    <div class="sheet ${cls}" role="dialog" aria-modal="true" aria-label="${esc(title)}" tabindex="-1">
      <div class="grab-zone"><div class="grab"></div>
        <div class="sheet-head"><button type="button" class="text-btn" data-close>Cancel</button><h2>${esc(title)}</h2><span class="head-r">${right}</span></div>
      </div>
      <div class="sheet-body">${body}</div>
      ${foot ? `<div class="sheet-foot">${foot}</div>` : ''}
    </div>`;
  document.getElementById('sheet-root').appendChild(wrap);
  document.body.classList.add('no-scroll');
  const el = wrap.querySelector('.sheet');
  const api = { el, wrap, closed: false, onClose, close: () => closeSheet(api) };
  wrap.querySelector('.scrim').addEventListener('click', () => api.close());
  wrap.querySelector('[data-close]').addEventListener('click', () => api.close());
  stack.push(api);
  history.pushState({ sheet: stack.length }, '');
  swipeToClose(api);
  requestAnimationFrame(() => el.focus({ preventScroll: true }));
  return api;
}

function closeSheet(api, fromPop = false) {
  if (api.closed) return Promise.resolve();
  api.closed = true;
  const i = stack.indexOf(api);
  if (i >= 0) stack.splice(i, 1);
  api.wrap.classList.add('out');
  api.el.style.transform = '';
  api.onClose?.();
  const popped = fromPop ? Promise.resolve() : new Promise((r) => { pendingPop = r; history.back(); setTimeout(() => { if (pendingPop === r) { pendingPop = null; r(); } }, 600); });
  const anim = new Promise((r) => setTimeout(r, 300));
  return Promise.all([popped, anim]).then(() => {
    api.wrap.remove();
    if (!stack.length) document.body.classList.remove('no-scroll');
  });
}

function swipeToClose(api) {
  const zone = api.el.querySelector('.grab-zone');
  let y0 = null, dy = 0, t0 = 0;
  zone.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button') || matchMedia('(min-width: 720px)').matches) return;
    y0 = e.clientY; dy = 0; t0 = performance.now();
    api.el.style.transition = 'none';
    zone.setPointerCapture(e.pointerId);
  });
  zone.addEventListener('pointermove', (e) => {
    if (y0 == null) return;
    dy = Math.max(0, e.clientY - y0);
    api.el.style.transform = `translateY(${dy}px)`;
  });
  const end = () => {
    if (y0 == null) return;
    const v = dy / Math.max(1, performance.now() - t0);
    y0 = null;
    api.el.style.transition = '';
    if (dy > 110 || v > 0.6) api.close();
    else api.el.style.transform = '';
  };
  zone.addEventListener('pointerup', end);
  zone.addEventListener('pointercancel', end);
}

// ---------------------------------------------------------------- segmented control with sliding thumb
export function initSeg(seg, onPick) {
  const place = (animate) => {
    const on = seg.querySelector('button[aria-pressed="true"]'), t = seg.querySelector('.thumb');
    if (!on || !t) return;
    if (!animate) t.style.transition = 'none';
    t.style.width = `${on.offsetWidth}px`;
    t.style.transform = `translateX(${on.offsetLeft - parseFloat(getComputedStyle(seg).paddingLeft)}px)`;
    if (!animate) { void t.offsetWidth; t.style.transition = ''; }
  };
  seg.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || !seg.contains(b)) return;
    seg.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    seg.dataset.value = b.dataset.v;
    place(true);
    onPick?.(b.dataset.v);
  });
  requestAnimationFrame(() => place(false));
  if ('ResizeObserver' in window) new ResizeObserver(() => place(false)).observe(seg);
  return { place };
}
export const seg = (items, value, cls = '') => `<div class="seg ${cls}" data-value="${esc(value)}"><span class="thumb"></span>${items.map(([v, label]) => `<button type="button" data-v="${esc(v)}" aria-pressed="${v === value}">${label}</button>`).join('')}</div>`;

// two-step confirm for destructive buttons (no blocking dialogs)
export function confirmButton(btn, label, onConfirm) {
  let armed = false, timer;
  const original = btn.innerHTML;
  btn.addEventListener('click', () => {
    if (armed) { clearTimeout(timer); onConfirm(); return; }
    armed = true; btn.classList.add('armed'); btn.innerHTML = esc(label);
    timer = setTimeout(() => { armed = false; btn.classList.remove('armed'); btn.innerHTML = original; }, 3500);
  });
}

export async function copyText(text, input) {
  try { await navigator.clipboard.writeText(text); toast('Copied'); }
  catch { if (input) { input.focus(); input.select(); } toast('Select the text and copy it'); }
}

export function download(name, text, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
