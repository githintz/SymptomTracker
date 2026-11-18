// Bottom sheets: log entry, injury, appointment, sync setup, pairing, assistant keys, date range.
import * as S from './store.js';
import * as Sync from './sync.js';
import { suggestPassphrase } from './crypto.js';
import { esc, icon, openSheet, toast, sevColor, toLocalInput, fmtTime, fmtDate, ago, confirmButton, copyText, initSeg, seg, dayKey } from './ui.js';

const go = (hash) => { if (location.hash !== hash) location.hash = hash; };

// ---------------------------------------------------------------- shared bits
function chipGroup(field, options, selected) {
  const all = [...new Set([...selected, ...options])];
  return `${all.map((t) => `<button type="button" class="chip" data-tag="${esc(t)}" aria-pressed="${selected.includes(t)}">${esc(t)}</button>`).join('')}
    <button type="button" class="chip add" data-add="${field}">${icon('plus', 'xs')}New</button>`;
}
function wireChips(box, onChange) {
  box.addEventListener('click', (e) => {
    const c = e.target.closest('.chip');
    if (!c) return;
    if (c.dataset.add) {
      const inp = document.createElement('input');
      inp.className = 'chip-input'; inp.maxLength = 40; inp.placeholder = 'Type and press Enter';
      c.replaceWith(inp); inp.focus();
      const done = () => {
        const v = inp.value.trim().replace(/\s+/g, ' ');
        const exists = v && [...box.querySelectorAll('[data-tag]')].find((x) => x.dataset.tag.toLowerCase() === v.toLowerCase());
        if (exists) exists.setAttribute('aria-pressed', 'true');
        else if (v) {
          const b = document.createElement('button');
          b.type = 'button'; b.className = 'chip pop'; b.dataset.tag = v; b.setAttribute('aria-pressed', 'true'); b.textContent = v;
          inp.before(b);
        }
        inp.replaceWith(c);
        onChange?.();
      };
      inp.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); done(); } if (ev.key === 'Escape') { ev.stopPropagation(); inp.value = ''; done(); } });
      inp.addEventListener('blur', done, { once: true });
      return;
    }
    c.setAttribute('aria-pressed', String(c.getAttribute('aria-pressed') !== 'true'));
    onChange?.();
  });
}
const selectedTags = (box) => [...box.querySelectorAll('[data-tag][aria-pressed="true"]')].map((c) => c.dataset.tag);
function shake(el) { el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); }
const injuryOptions = (selectedId, { allowNone = false, includeResolved = false } = {}) => {
  const list = S.injuries().filter((i) => includeResolved || i.status !== 'resolved' || i.id === selectedId).sort((a, b) => a.name.localeCompare(b.name));
  return `${allowNone ? `<option value="">Not linked to an injury</option>` : ''}${list.map((i) => `<option value="${esc(i.id)}" ${i.id === selectedId ? 'selected' : ''}>${esc(i.name)}</option>`).join('')}`;
};
function collapse(el, open) { el.classList.toggle('closed', !open); el.inert = !open; }

// ---------------------------------------------------------------- log an entry
export function logSheet({ injuryId, entry: existing, type } = {}) {
  if (!S.injuries().length) { injurySheet({ thenLog: true }); return; }
  const local = S.getLocal();
  const injId = existing?.injuryId || injuryId || (S.injury(local.lastInjury)?.status !== 'resolved' && S.injury(local.lastInjury) ? local.lastInjury : null)
    || S.injuries().filter((i) => i.status !== 'resolved').sort((a, b) => (S.lastActivity(b.id) > S.lastActivity(a.id) ? 1 : -1))[0]?.id || S.injuries()[0].id;
  const lastPain = S.entries(injId).find((e) => e.pain != null)?.pain;
  const st = existing
    ? { ...existing, feels: [...(existing.feels || [])], doing: [...(existing.doing || [])] }
    : { injuryId: injId, type: type || 'pain', pain: lastPain ?? 5, feels: [], doing: [], note: '', ask: type === 'concern', at: null };
  if (st.pain == null) st.pain = lastPain ?? 5;

  const sh = openSheet({
    title: existing ? 'Edit entry' : 'Log',
    cls: 'log-sheet',
    body: `
      ${existing?.source === 'assistant' ? `<div class="hint info">${icon('spark', 'sm')}Added by your assistant ${esc(ago(existing.addedAt || existing.createdAt))}</div>` : ''}
      <div class="sec first"><div class="lbl">What happened?</div>
        <div class="types">${S.TYPES.map((t) => `<button type="button" class="type" data-type="${t.id}" aria-pressed="${t.id === st.type}">${icon(t.icon)}${t.label}</button>`).join('')}</div>
      </div>
      <div class="collapse" data-for="rated"><div><div class="sec">
        <div class="card pain-card">
          <div class="pain-read"><span class="pain-num" id="painNum">${st.pain}</span><span class="pain-word" id="painWord"></span></div>
          <input class="slider" id="painSlider" type="range" min="0" max="10" step="1" value="${st.pain}" aria-label="Pain level, 0 to 10">
          <div class="ticks" aria-hidden="true">${Array.from({ length: 11 }, (_, i) => `<span>${i}</span>`).join('')}</div>
        </div>
      </div></div></div>
      <div class="collapse" data-for="feels"><div><div class="sec"><div class="lbl">Feels like</div><div class="chips" id="feels"></div></div></div></div>
      <div class="collapse" data-for="doing"><div><div class="sec"><div class="lbl"><span id="doingLbl">What were you doing?</span><span class="lbl-r" id="doingHint">Your usual ones first</span></div><div class="chips" id="doing"></div></div></div></div>
      <div class="sec"><div class="lbl"><span id="noteLbl">Details</span><span class="lbl-r" id="noteHint">Optional</span></div>
        <textarea class="input note" id="note" rows="3" maxlength="4000" placeholder="">${esc(st.note)}</textarea></div>
      <div class="sec"><div class="card toggle-row">
        <span class="flag-i">${icon('help')}</span>
        <label class="grow" for="askSw">Ask my doctor about this<small>Adds it to the questions in your visit summary</small></label>
        <button type="button" class="switch" id="askSw" aria-pressed="${!!st.ask}" aria-label="Ask my doctor about this"></button>
      </div></div>
      <div class="sec"><div class="lbl">When</div>
        <div class="when">
          <button type="button" class="chip" id="whenNow" aria-pressed="${!st.at || !existing}">${icon('clock', 'xs')}<span id="nowLbl">${existing ? fmtTime(st.at) : `Now · ${fmtTime(new Date())}`}</span></button>
          <input type="datetime-local" class="input when-input" id="whenInput" value="${toLocalInput(st.at || new Date())}" max="${toLocalInput(new Date(Date.now() + 864e5))}" aria-label="Date and time">
        </div>
      </div>`,
    foot: `${existing ? `<button type="button" class="danger-btn round" id="delBtn" aria-label="Delete entry">${icon('trash')}</button>` : ''}<button type="button" class="save" id="saveBtn">${icon('check')}${existing ? 'Save changes' : 'Save entry'}</button>`,
  });
  const el = sh.el;
  // injury picker in the header
  el.querySelector('.sheet-head h2').innerHTML = `<label class="inj-pick">${S.injuries().length > 1 ? '' : ''}<select id="injSel" aria-label="Injury">${injuryOptions(st.injuryId)}</select>${icon('down', 'sm')}</label>`;
  const $ = (s) => el.querySelector(s);
  const sel = $('#injSel'), slider = $('#painSlider'), num = $('#painNum'), word = $('#painWord'), note = $('#note');
  const feels = $('#feels'), doing = $('#doing');
  const whenNow = $('#whenNow'), whenInput = $('#whenInput');
  if (existing) { whenNow.setAttribute('aria-pressed', 'false'); whenInput.classList.add('show'); whenNow.hidden = true; }

  const setPain = (v, tick) => {
    st.pain = v;
    num.textContent = v; num.style.color = sevColor(v);
    if (tick) { num.classList.remove('tick'); void num.offsetWidth; num.classList.add('tick'); }
    word.innerHTML = `${esc(S.PAIN_WORDS[v][0])}<small>${esc(S.PAIN_WORDS[v][1])}</small>`;
    slider.style.setProperty('--thumb', sevColor(v));
  };
  setPain(st.pain);
  slider.addEventListener('input', () => { setPain(+slider.value, true); if (navigator.vibrate) navigator.vibrate(4); });

  const renderTags = () => {
    const isRx = st.type === 'treatment';
    feels.innerHTML = chipGroup('feels', S.tagOptions('feels', st.injuryId, S.FEELS), st.feels);
    const doingSel = st.doing;
    const opts = isRx ? S.tagOptions('doing', st.injuryId, S.RX).filter((t) => S.RX.includes(t) || S.entries().some((e) => e.type === 'treatment' && e.doing?.includes(t)))
      : S.tagOptions('doing', st.injuryId, S.DOING).filter((t) => !S.RX.includes(t) || doingSel.includes(t));
    doing.innerHTML = chipGroup('doing', opts.slice(0, 14), doingSel);
  };
  const applyType = () => {
    el.querySelectorAll('.type').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.type === st.type)));
    const t = st.type;
    collapse($('[data-for="rated"]'), S.RATED.has(t));
    collapse($('[data-for="feels"]'), S.RATED.has(t));
    collapse($('[data-for="doing"]'), t !== 'note' && t !== 'concern');
    $('#doingLbl').textContent = t === 'treatment' ? 'What did you do?' : t === 'trigger' ? 'What set it off?' : 'What were you doing?';
    $('#doingHint').textContent = t === 'trigger' || t === 'treatment' ? 'Pick one or add your own' : 'Your usual ones first';
    $('#noteLbl').textContent = t === 'concern' ? 'Your question or concern' : t === 'treatment' ? 'Dose or details' : t === 'note' ? 'Note' : 'Details';
    $('#noteHint').textContent = t === 'concern' || t === 'note' ? '' : 'Optional';
    note.placeholder = { pain: 'e.g. grabbing a mug from the top shelf, pain shot down to the elbow', symptom: 'e.g. joint squeaks when I rotate my arm', trigger: 'e.g. carried groceries in my left hand', concern: 'e.g. Is the clicking a sign of a tear?', treatment: 'e.g. 400 mg, or 15 minutes', note: 'Anything worth remembering' }[t];
    renderTags();
  };
  el.querySelector('.types').addEventListener('click', (e) => {
    const b = e.target.closest('.type');
    if (!b) return;
    st.feels = selectedTags(feels); st.doing = selectedTags(doing);
    const prev = st.type;
    st.type = b.dataset.type;
    if ((prev === 'treatment') !== (st.type === 'treatment')) st.doing = [];
    if (st.type === 'concern' && !existing) { st.ask = true; $('#askSw').setAttribute('aria-pressed', 'true'); }
    applyType();
  });
  wireChips(feels); wireChips(doing);
  applyType();

  sel.addEventListener('change', () => { st.injuryId = sel.value; st.feels = selectedTags(feels); st.doing = selectedTags(doing); renderTags(); });
  $('#askSw').addEventListener('click', (e) => { const b = e.currentTarget; b.setAttribute('aria-pressed', String(b.getAttribute('aria-pressed') !== 'true')); });
  whenNow.addEventListener('click', () => {
    const on = whenInput.classList.toggle('show');
    whenNow.setAttribute('aria-pressed', String(!on));
    $('#nowLbl').textContent = on ? 'Use now' : `Now · ${fmtTime(new Date())}`;
    if (on) whenInput.focus();
  });

  $('#saveBtn').addEventListener('click', async () => {
    st.feels = selectedTags(feels); st.doing = selectedTags(doing);
    st.note = note.value.trim();
    st.ask = $('#askSw').getAttribute('aria-pressed') === 'true';
    if ((st.type === 'concern' || st.type === 'note') && !st.note) { shake(note); note.focus(); return; }
    if ((st.type === 'trigger' || st.type === 'treatment') && !st.doing.length && !st.note) { shake(doing); return; }
    const custom = whenInput.classList.contains('show') && whenInput.value;
    const at = custom ? new Date(whenInput.value) : existing ? new Date(existing.at) : new Date();
    const rec = {
      ...(existing || {}), injuryId: st.injuryId, type: st.type, at: at.toISOString(),
      pain: S.RATED.has(st.type) ? st.pain : null, feels: S.RATED.has(st.type) ? st.feels : [],
      doing: st.type === 'note' || st.type === 'concern' ? [] : st.doing, note: st.note, ask: st.ask, askDone: st.ask ? !!existing?.askDone : false,
    };
    const saved = S.save('entries', rec);
    S.setLocal({ lastInjury: st.injuryId });
    await sh.close();
    const what = S.RATED.has(st.type) ? `${S.TYPE[st.type].label} ${st.pain}` : S.TYPE[st.type].label;
    if (existing) toast('Saved');
    else toast(`Logged · ${what}`, { action: 'Undo', onAction: () => { S.remove('entries', saved.id); toast('Removed'); } });
  });
  const del = $('#delBtn');
  if (del) confirmButton(del, 'Delete?', async () => {
    const removed = S.remove('entries', existing.id);
    await sh.close();
    toast('Entry deleted', { action: 'Undo', onAction: () => S.restore(removed) });
  });
}

// ---------------------------------------------------------------- injury
export function injurySheet({ injury: existing, thenLog = false } = {}) {
  const st = existing || { status: 'active' };
  const sh = openSheet({
    title: existing ? 'Edit injury' : 'New injury',
    body: `
      <div class="field"><label for="injName">Name</label><input class="input" id="injName" maxlength="80" placeholder="e.g. Left shoulder" value="${esc(st.name)}" autocomplete="off"></div>
      <div class="field"><label for="injDetail">What happened or the diagnosis <span class="opt">Optional</span></label><input class="input" id="injDetail" maxlength="140" placeholder="e.g. Rotator cuff strain from swimming" value="${esc(st.detail)}"></div>
      <div class="field"><label for="injStart">Started on <span class="opt">Optional</span></label><input type="date" class="input" id="injStart" value="${esc(st.startedOn || '')}" max="${dayKey(new Date())}"></div>
      ${existing ? `<div class="field"><span class="label">Status</span>${seg([['active', 'Active'], ['resolved', 'Resolved']], st.status || 'active', 'lg')}<span class="hint">Resolved injuries move to the bottom of the home screen. Their history stays.</span></div>
      <button type="button" class="danger-btn" id="delInj">${icon('trash', 'sm')}Delete injury and its ${S.entries(existing.id).length} entries</button>` : ''}`,
    foot: `<button type="button" class="save" id="saveInj">${icon('check')}${existing ? 'Save changes' : 'Add injury'}</button>`,
  });
  const $ = (s) => sh.el.querySelector(s);
  let status = st.status || 'active';
  const sg = sh.el.querySelector('.seg');
  if (sg) initSeg(sg, (v) => { status = v; });
  if (!existing) setTimeout(() => $('#injName').focus(), 350);
  $('#saveInj').addEventListener('click', async () => {
    const name = $('#injName').value.trim();
    if (!name) { shake($('#injName')); $('#injName').focus(); return; }
    const rec = S.save('injuries', { ...(existing || {}), name, detail: $('#injDetail').value.trim(), startedOn: $('#injStart').value, status });
    await sh.close();
    if (!existing) { go(`#/injury/${rec.id}`); if (thenLog) setTimeout(() => logSheet({ injuryId: rec.id }), 250); }
    else toast('Saved');
  });
  const del = $('#delInj');
  if (del) confirmButton(del, 'Tap again to delete everything', async () => {
    const removed = S.remove('injuries', existing.id);
    await sh.close();
    go('#/');
    toast(`Deleted ${existing.name}`, { action: 'Undo', onAction: () => S.restore(removed) });
  });
}

// ---------------------------------------------------------------- appointment
export function appointmentSheet({ appt: existing, injuryId } = {}) {
  const st = existing || { injuryId: injuryId || '', title: '', at: '' };
  const d = st.at ? new Date(st.at) : null;
  const sh = openSheet({
    title: existing ? 'Appointment' : 'New appointment',
    body: `
      ${existing?.source === 'assistant' ? `<div class="hint info">${icon('spark', 'sm')}Added by your assistant ${esc(ago(existing.addedAt || existing.createdAt))}</div>` : ''}
      <div class="field"><label for="apTitle">What</label><input class="input" id="apTitle" maxlength="80" placeholder="e.g. Ortho follow-up" value="${esc(st.title)}">
        <div class="chips sm" id="apSuggest">${['Follow-up', 'Physical therapy', 'MRI', 'X-ray', 'Specialist', 'GP'].map((t) => `<button type="button" class="chip">${t}</button>`).join('')}</div></div>
      <div class="field-row">
        <div class="field"><label for="apDate">Date</label><input type="date" class="input" id="apDate" value="${d ? dayKey(d) : ''}"></div>
        <div class="field"><label for="apTime">Time</label><input type="time" class="input" id="apTime" value="${d && !st.allDay ? toLocalInput(d).slice(11) : ''}"></div>
      </div>
      <div class="field"><label for="apInj">Injury</label><div class="select-wrap"><select class="input" id="apInj">${injuryOptions(st.injuryId, { allowNone: true, includeResolved: true })}</select>${icon('down', 'sm')}</div>
        ${st.injuryHint ? `<span class="hint">Your assistant said it's for "${esc(st.injuryHint)}"</span>` : ''}</div>
      <div class="field"><label for="apProv">With <span class="opt">Optional</span></label><input class="input" id="apProv" maxlength="80" placeholder="e.g. Dr. Patel" value="${esc(st.provider)}"></div>
      <div class="field"><label for="apLoc">Where <span class="opt">Optional</span></label><input class="input" id="apLoc" maxlength="140" placeholder="Clinic name or address" value="${esc(st.location)}">
        ${st.location ? `<a class="link-btn" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(st.location)}" target="_blank" rel="noopener">${icon('pin', 'xs')}Open in Maps</a>` : ''}</div>
      <div class="field"><label for="apNotes">Notes <span class="opt">Optional</span></label><textarea class="input" id="apNotes" rows="3" maxlength="2000" placeholder="Things to bring, prep instructions">${esc(st.notes)}</textarea></div>
      ${existing ? `<button type="button" class="danger-btn" id="delAp">${icon('trash', 'sm')}Delete appointment</button>` : ''}`,
    foot: `<button type="button" class="save" id="saveAp">${icon('check')}${existing ? 'Save changes' : 'Add appointment'}</button>`,
  });
  const $ = (s) => sh.el.querySelector(s);
  $('#apSuggest').addEventListener('click', (e) => { const c = e.target.closest('.chip'); if (c) { $('#apTitle').value = c.textContent; } });
  $('#saveAp').addEventListener('click', async () => {
    const date = $('#apDate').value;
    if (!date) { shake($('#apDate')); return; }
    const time = $('#apTime').value;
    S.save('appointments', {
      ...(existing || {}), title: $('#apTitle').value.trim() || 'Appointment', at: `${date}T${time || '09:00'}`, allDay: !time,
      injuryId: $('#apInj').value, injuryHint: $('#apInj').value ? '' : st.injuryHint || '', provider: $('#apProv').value.trim(), location: $('#apLoc').value.trim(), notes: $('#apNotes').value.trim(),
    });
    await sh.close();
    toast(existing ? 'Saved' : 'Appointment added');
  });
  const del = $('#delAp');
  if (del) confirmButton(del, 'Tap again to delete', async () => {
    const removed = S.remove('appointments', existing.id);
    await sh.close();
    toast('Appointment deleted', { action: 'Undo', onAction: () => S.restore(removed) });
  });
}

// ---------------------------------------------------------------- sync setup
export function syncSheet({ url = '', passphrase = '' } = {}) {
  const sh = openSheet({
    title: 'Turn on sync',
    body: `
      <p class="lead">Sync keeps your entries on all your devices. Everything is encrypted with your passphrase on this device first, so the sync server only stores data it can't read.</p>
      <div class="field"><label for="syUrl">Sync server</label><input class="input" id="syUrl" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="https://symptom-tracker.you.workers.dev" value="${esc(url || Sync.getDefaultUrl())}"></div>
      <div class="field"><label for="syPass">Passphrase</label>
        <div class="input-row"><input class="input mono" id="syPass" type="password" autocomplete="new-password" autocapitalize="off" spellcheck="false" minlength="12" value="${esc(passphrase)}" placeholder="At least 12 characters">
          <button type="button" class="icon-btn" id="syShow" aria-label="Show passphrase">${icon('lock', 'sm')}</button></div>
        <div class="row-links"><button type="button" class="link-btn" id="sySuggest">${icon('key', 'xs')}Suggest a strong one</button></div>
        <span class="hint">Use the same passphrase on every device. Write it down somewhere safe: if you lose it, synced data can't be recovered (your backup files still work).</span></div>
      <div class="collapse closed" id="setupBox"><div><div class="field" style="padding-top:4px"><label for="sySetup">Setup code</label><input class="input mono" id="sySetup" type="password" autocomplete="off" autocapitalize="off" placeholder="The SETUP_CODE you saved on Cloudflare">
        <span class="hint">Only needed once, on the first device, to create your encrypted storage.</span></div></div></div>
      <div class="hint err" id="syErr" hidden></div>`,
    foot: `<button type="button" class="save" id="syGo">${icon('lock')}Turn on sync</button>`,
  });
  const $ = (s) => sh.el.querySelector(s);
  const err = $('#syErr');
  const setupBox = $('#setupBox');
  collapse(setupBox, false);
  $('#syShow').addEventListener('click', () => { const p = $('#syPass'); p.type = p.type === 'password' ? 'text' : 'password'; });
  $('#sySuggest').addEventListener('click', () => { const p = $('#syPass'); p.value = suggestPassphrase(); p.type = 'text'; });
  const checkServer = async () => {
    const u = $('#syUrl').value.trim();
    if (!u) return;
    try { const m = await Sync.serverInfo(u); collapse(setupBox, !m.exists); err.hidden = true; } catch { /* reported on submit */ }
  };
  $('#syUrl').addEventListener('change', checkServer);
  checkServer();
  $('#syGo').addEventListener('click', async () => {
    const btn = $('#syGo');
    err.hidden = true;
    btn.disabled = true; btn.innerHTML = `<span class="spinner"></span>Connecting…`;
    try {
      const { created } = await Sync.connect({ url: $('#syUrl').value, passphrase: $('#syPass').value, setupCode: $('#sySetup').value });
      await sh.close();
      toast(created ? 'Sync is on. Your encrypted storage is ready.' : 'Sync is on');
    } catch (e) {
      if (e.needSetup) { collapse(setupBox, true); $('#sySetup').focus(); }
      err.textContent = e.message; err.hidden = false;
      btn.disabled = false; btn.innerHTML = `${icon('lock')}Turn on sync`;
    }
  });
}

// ---------------------------------------------------------------- add a device
export function pairSheet() {
  const link = Sync.pairLink();
  const sh = openSheet({
    title: 'Add a device',
    body: `
      <p class="lead">Open this link on your other phone, tablet or computer. It fills in the server and passphrase for you.</p>
      <div class="qr" id="qr"><span class="spinner"></span></div>
      <div class="field"><label for="pairLink">Link</label><div class="input-row"><input class="input mono sm" id="pairLink" readonly value="${esc(link)}"><button type="button" class="icon-btn" id="pairCopy" aria-label="Copy link">${icon('copy', 'sm')}</button></div></div>
      <div class="hint warn">The link contains your passphrase. Only open it on your own devices, and don't post it anywhere.</div>`,
  });
  sh.el.querySelector('#pairCopy').addEventListener('click', () => copyText(link, sh.el.querySelector('#pairLink')));
  loadQR().then((qrcode) => {
    const q = qrcode(0, 'M'); q.addData(link); q.make();
    sh.el.querySelector('#qr').innerHTML = q.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  }).catch(() => { sh.el.querySelector('#qr').hidden = true; });
}
let qrP;
function loadQR() {
  if (window.qrcode) return Promise.resolve(window.qrcode);
  qrP ||= new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js';
    s.onload = () => (window.qrcode ? res(window.qrcode) : rej());
    s.onerror = rej;
    document.head.appendChild(s);
  });
  return qrP;
}

// ---------------------------------------------------------------- assistant keys
export function assistantSheet() {
  const host = (() => { try { return new URL(Sync.getConfig().url).host; } catch { return ''; } })();
  const sh = openSheet({
    title: 'Assistant access',
    body: `
      <p class="lead">Let an assistant like Claude add appointments, entries and questions for you. Just tell it what to add, then open the app.</p>
      <ul class="facts">
        <li>${icon('lock', 'sm')}<span>Write-only. An assistant key can add things but can't read anything you've logged.</span></li>
        <li>${icon('spark', 'sm')}<span>What it sends is encrypted to this app, and shows up here at the next sync, marked as added by your assistant.</span></li>
        <li>${icon('x', 'sm')}<span>Revoke a key any time.</span></li>
      </ul>
      <div id="tokList" class="tok-list"><div class="skeleton"></div></div>
      <div class="field"><label for="tokLabel">New key name</label><div class="input-row"><input class="input" id="tokLabel" maxlength="40" value="Claude"><button type="button" class="primary-btn" id="tokNew">Create key</button></div></div>
      <div id="tokMade"></div>
      <div class="hint err" id="tokErr" hidden></div>`,
  });
  const $ = (s) => sh.el.querySelector(s);
  const showErr = (e) => { $('#tokErr').textContent = e.message; $('#tokErr').hidden = false; };
  const load = async () => {
    try {
      const { tokens } = await Sync.listTokens();
      $('#tokList').innerHTML = tokens.length ? tokens.map((t) => `<div class="tok-row"><span class="grow"><b>${esc(t.label)}</b><small>Created ${esc(fmtDate(t.createdAt))} · ${t.lastUsed ? `last used ${esc(ago(t.lastUsed))}` : 'not used yet'}</small></span><button type="button" class="text-btn danger" data-revoke="${esc(t.id)}">Revoke</button></div>`).join('') : '<p class="muted-p">No assistant keys yet.</p>';
    } catch (e) { $('#tokList').innerHTML = ''; showErr(e); }
  };
  load();
  $('#tokList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-revoke]');
    if (!b || b.dataset.armed) { if (b) Sync.revokeToken(b.dataset.revoke).then(() => { toast('Key revoked'); load(); }).catch(showErr); return; }
    b.dataset.armed = '1'; b.textContent = 'Tap to revoke';
  });
  $('#tokNew').addEventListener('click', async () => {
    try {
      const r = await Sync.createToken($('#tokLabel').value.trim() || 'Assistant');
      $('#tokMade').innerHTML = `<div class="made">
        <span class="label">Your new key. It's shown only once.</span>
        <div class="input-row"><input class="input mono sm" id="tokVal" readonly value="${esc(r.token)}"><button type="button" class="icon-btn" id="tokCopy" aria-label="Copy key">${icon('copy', 'sm')}</button></div>
        <span class="hint">In Claude, ask it to add something to your Symptom Tracker. When it asks for the key, paste it into the secure form${host ? ` for <b>${esc(host)}</b>` : ''}. Don't paste it into the chat itself.</span></div>`;
      $('#tokCopy').addEventListener('click', () => copyText(r.token, $('#tokVal')));
      load();
    } catch (e) { showErr(e); }
  });
}

// ---------------------------------------------------------------- visit range
export function rangeSheet({ presets, current, onPick }) {
  const sh = openSheet({
    title: 'Date range',
    body: `<div class="range-list">${presets.map((p) => `<button type="button" class="row-btn" data-k="${esc(p.key)}" aria-pressed="${p.key === current.key}"><span class="grow">${esc(p.label)}<small>${esc(p.sub || '')}</small></span>${p.key === current.key ? icon('check') : ''}</button>`).join('')}</div>
      <div class="field"><span class="label">Custom range</span><div class="field-row"><input type="date" class="input" id="rgFrom" aria-label="From" value="${dayKey(current.from)}"><input type="date" class="input" id="rgTo" aria-label="To" value="${dayKey(current.to)}"></div></div>`,
    foot: `<button type="button" class="save" id="rgApply">Use custom range</button>`,
  });
  sh.el.querySelector('.range-list').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-k]');
    if (!b) return;
    await sh.close();
    onPick({ key: b.dataset.k });
  });
  sh.el.querySelector('#rgApply').addEventListener('click', async () => {
    const f = sh.el.querySelector('#rgFrom').value, t = sh.el.querySelector('#rgTo').value;
    if (!f || !t) return;
    await sh.close();
    onPick({ key: 'custom', from: f < t ? f : t, to: f < t ? t : f });
  });
}
