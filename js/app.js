// Symptom Tracker: screens and routing.
//   #/                     home: injuries, next appointment
//   #/injury/<id>          timeline for one injury
//   #/injury/<id>/visit    visit summary for the doctor
//   #/settings             sync, devices, assistant access, backups
import * as S from './store.js';
import * as Sync from './sync.js';
import * as St from './stats.js';
import { spark, trend } from './charts.js';
import { logSheet, injurySheet, incidentSheet, appointmentSheet, syncSheet, pairSheet, assistantSheet, rangeSheet } from './sheets.js';
import { esc, icon, sevBadge, sevColor, toast, initSeg, seg, fmtDay, fmtTime, fmtDate, fmtDateLong, ago, apptWhen, daysBetween, addDays, startOfDay, dayKey, download, confirmButton } from './ui.js';

const APP_VERSION = 4; // keep in step with VERSION in sw.js
const app = document.getElementById('app');
let route = null, lastKey = '';
const view = { range: '30', filter: 'all', query: '', searching: false, visit: {}, showResolved: false, expanded: new Set() };

function parseRoute() {
  const p = location.hash.replace(/^#\/?/, '').split('/');
  if (p[0] === 'injury' && p[1] && p[2] === 'incident' && p[3]) return { name: 'incident', id: decodeURIComponent(p[1]), inc: decodeURIComponent(p[3]) };
  if (p[0] === 'injury' && p[1]) return { name: p[2] === 'visit' ? 'visit' : 'injury', id: decodeURIComponent(p[1]) };
  if (p[0] === 'settings') return { name: 'settings' };
  return { name: 'home' };
}

function render(why = 'route') {
  const r = parseRoute();
  const key = `${r.name}:${r.id || ''}:${r.inc || ''}`;
  const isNew = key !== lastKey;
  if (isNew) { view.filter = 'all'; view.query = ''; view.searching = false; }
  route = r; lastKey = key;
  const y = window.scrollY;
  let html;
  if (r.name === 'injury' || r.name === 'visit' || r.name === 'incident') {
    const inj = S.injury(r.id);
    if (!inj) { location.replace('#/'); return; }
    if (r.name === 'incident') {
      const inc = S.incident(r.inc);
      if (!inc) { location.replace(`#/injury/${encodeURIComponent(inj.id)}`); return; }
      html = incidentView(inj, inc);
    } else html = r.name === 'injury' ? injuryView(inj) : visitView(inj);
  } else if (r.name === 'settings') html = settingsView();
  else html = homeView();
  app.innerHTML = `<main class="page ${isNew ? 'animate' : 'still'}" data-view="${r.name}">${html}</main>`;
  document.title = r.name === 'home' ? 'Symptom Tracker' : `${(S.injury(r.id)?.name) || 'Settings'} · Symptom Tracker`;
  app.querySelectorAll('.seg').forEach((sg) => initSeg(sg, (v) => onSeg(sg, v)));
  if (isNew && why === 'route') window.scrollTo(0, 0); else window.scrollTo(0, y);
  if (isNew) app.querySelector('main')?.focus?.({ preventScroll: true });
}

// ---------------------------------------------------------------- shared pieces
const syncDot = () => {
  const s = Sync.getStatus().state;
  return `<a class="icon-btn sync-dot ${s === 'idle' ? 'on' : s === 'syncing' ? 'busy' : s === 'off' ? '' : 'warn'}" href="#/settings" aria-label="Sync and backup">${icon('cloud')}</a>`;
};
const typeLabel = (e) => S.TYPE[e.type]?.label || 'Entry';
const dayN = (inj) => { const start = inj.startedOn ? new Date(`${inj.startedOn}T12:00`) : new Date(inj.createdAt); return daysBetween(start, new Date()) + 1; };
const injSub = (inj) => [inj.detail, inj.status === 'resolved' ? 'Resolved' : `Day ${dayN(inj)}`].filter(Boolean).join(' · ');
const st = (i) => `style="--i:${i}"`;

function apptCard(a, i, { compact = false } = {}) {
  const d = new Date(a.at);
  const inj = S.injury(a.injuryId);
  const qs = a.injuryId ? S.entries(a.injuryId).filter((e) => e.ask && !e.askDone).length : 0;
  const sub = [a.provider, a.location].filter(Boolean).join(' · ') || (inj ? inj.name : a.injuryHint ? `For ${a.injuryHint}` : '');
  const past = d < Date.now() - 2 * 3600e3;
  return `<div class="card appt ${past ? 'past' : ''}" ${st(i)}>
    <button type="button" class="appt-main" data-act="appt" data-id="${esc(a.id)}">
      <span class="cal"><small>${d.toLocaleDateString([], { month: 'short' }).toUpperCase()}</small><b>${d.getDate()}</b></span>
      <span class="t"><b>${esc(a.title)}${a.allDay ? '' : `, ${esc(daysBetween(new Date(), d) >= 0 && daysBetween(new Date(), d) < 7 ? apptWhen(a.at) : fmtTime(d))}`}</b>
        <span>${esc(sub)}${a.source === 'assistant' ? ` <span class="by-ai" title="Added by your assistant">${icon('spark', 'xs')}</span>` : ''}</span></span>
    </button>
    ${!compact && a.injuryId && !past ? `<a class="appt-go" href="#/injury/${esc(a.injuryId)}/visit">${icon('clip', 'sm')}<span>Visit summary${qs ? ` · ${qs} question${qs > 1 ? 's' : ''}` : ''}</span>${icon('chev', 'sm')}</a>` : ''}
  </div>`;
}

// ---------------------------------------------------------------- home
function homeView() {
  const all = S.injuries();
  const active = all.filter((i) => i.status !== 'resolved').sort((a, b) => (S.lastActivity(b.id) > S.lastActivity(a.id) ? 1 : -1));
  const resolved = all.filter((i) => i.status === 'resolved');
  const last = S.entries()[0];
  const next = S.upcoming()[0];
  const local = S.getLocal();
  const backupOld = !Sync.configured() && S.entries().length >= 5 && (!local.lastBackupAt || Date.now() - Date.parse(local.lastBackupAt) > 14 * 864e5);
  let i = 0;
  if (!all.length) {
    return `<div class="topbar" ${st(i++)}><span class="brand">${icon('wave')}Symptom Tracker</span>${syncDot()}</div>
      <section class="empty" ${st(i++)}>
        <div class="empty-art">${icon('bolt')}</div>
        <h1>Track an injury</h1>
        <p>Log pain, triggers and questions the moment they happen. Then walk your doctor through a clean timeline at your next visit.</p>
        <button type="button" class="primary-btn lg" data-act="new-injury">${icon('plus')}Add your first injury</button>
        <a class="link-btn" href="#/settings">Already use it on another device? Turn on sync</a>
      </section>`;
  }
  return `
    <div class="topbar" ${st(i++)}><span class="brand">${icon('wave')}Symptom Tracker</span>${syncDot()}</div>
    <div class="hero" ${st(i++)}><h1>Your injuries</h1><p>${active.length} active${last ? ` · last entry ${esc(ago(last.at))}` : ''}</p></div>
    ${backupOld ? `<a class="card nudge" href="#/settings" ${st(i++)}>${icon('download', 'sm')}<span>Your entries are only on this device. Turn on sync or save a backup file.</span>${icon('chev', 'sm')}</a>` : ''}
    ${next ? apptCard(next, i++) : ''}
    <div class="inj-list">${active.map((inj) => injuryCard(inj, i++)).join('')}</div>
    <button type="button" class="new-inj" data-act="new-injury" ${st(i++)}>${icon('plus')}Track a new injury</button>
    ${resolved.length ? `<div class="resolved" ${st(i++)}>
      <button type="button" class="link-btn muted" data-act="toggle-resolved" aria-expanded="${view.showResolved}">${icon('archive', 'xs')}${resolved.length} resolved ${resolved.length > 1 ? 'injuries' : 'injury'}${icon(view.showResolved ? 'down' : 'chev', 'xs')}</button>
      ${view.showResolved ? `<div class="inj-list">${resolved.map((inj) => injuryCard(inj, 0)).join('')}</div>` : ''}</div>` : ''}
    <div class="fade-bottom"></div>
    <button type="button" class="fab" data-act="log">${icon('plus')}Log now</button>`;
}

function injuryCard(inj, i) {
  const es = S.entries(inj.id);
  const s = St.cardStats(es);
  const days = St.daily(es, addDays(startOfDay(new Date()), -13), new Date());
  const lastE = es[0];
  const lastTxt = lastE ? `${typeLabel(lastE)}${lastE.pain != null ? ` ${lastE.pain}` : ''}${lastE.doing?.[0] ? `, ${lastE.doing[0].toLowerCase()}` : ''} · ${ago(lastE.at)}` : 'No entries yet';
  const delta = s.delta == null || Math.abs(s.delta) < 0.05 ? '' : `<small class="${s.delta > 0 ? 'up' : 'down'}">${s.delta > 0 ? '↑' : '↓'}${Math.abs(s.delta).toFixed(1)}</small>`;
  return `<article class="card inj ${inj.status === 'resolved' ? 'resolved-card' : ''}" ${st(i)}>
    <a class="card-link" href="#/injury/${esc(inj.id)}" aria-label="${esc(inj.name)} timeline"></a>
    <div class="inj-head"><div><h2>${esc(inj.name)}</h2><div class="sub">${esc(injSub(inj))}</div>${S.openIncidents(inj.id)[0] ? `<div class="ongoing">${esc(S.openIncidents(inj.id)[0].title)}</div>` : ''}</div>${s.latest ? sevBadge(s.latest.pain) : ''}</div>
    ${spark(days)}
    <div class="inj-stats">
      <div><span class="k">7-day avg</span><span class="v">${s.avg7 == null ? '–' : s.avg7.toFixed(1)} ${delta}</span></div>
      <div><span class="k">Flares ≥7 (30 d)</span><span class="v">${s.flares30}</span></div>
      <div><span class="k">Entries</span><span class="v">${es.length}</span></div>
    </div>
    <div class="inj-foot"><span class="last">${esc(lastTxt)}</span>${inj.status !== 'resolved' ? `<button type="button" class="quick-log" data-act="log" data-inj="${esc(inj.id)}">${icon('plus', 'xs')}Log</button>` : ''}</div>
  </article>`;
}

// ---------------------------------------------------------------- injury timeline
const FILTERS = [
  ['all', 'All', () => true], ['pain', 'Pain', (e) => e.type === 'pain'], ['symptom', 'Symptoms', (e) => e.type === 'symptom'],
  ['trigger', 'Triggers', (e) => e.type === 'trigger' || (e.doing?.length && e.type !== 'treatment')], ['treatment', 'Treatment', (e) => e.type === 'treatment'],
  ['concern', 'Concerns', (e) => e.type === 'concern'], ['ask', 'To ask', (e) => e.ask && !e.askDone], ['note', 'Notes', (e) => e.type === 'note'],
];
const RANGES = [['7', '7D'], ['30', '30D'], ['90', '90D'], ['all', 'All']];

function chartBlock(inj, es, animate = true) {
  const now = new Date();
  const first = es.length ? new Date(es[es.length - 1].at) : now;
  const from = view.range === 'all' ? startOfDay(new Date(Math.min(+first, +addDays(now, -6)))) : addDays(startOfDay(now), -(Number(view.range) - 1));
  const r = St.rated(St.inRange(es, from, now));
  const avg = r.length ? (r.reduce((a, e) => a + e.pain, 0) / r.length).toFixed(1) : '–';
  const worst = r.length ? Math.max(...r.map((e) => e.pain)) : '–';
  return { head: `<span class="big">Avg <b>${avg}</b> · worst <b>${worst}</b></span>`, svg: trend(St.daily(es, from, now), { animate }) };
}

function injuryView(inj) {
  const es = S.entries(inj.id);
  const counts = Object.fromEntries(FILTERS.map(([k, , f]) => [k, es.filter(f).length]));
  const f = FILTERS.find(([k]) => k === view.filter)?.[2] || (() => true);
  const q = view.query.trim().toLowerCase();
  const shown = es.filter(f).filter((e) => !q || [e.note, ...(e.feels || []), ...(e.doing || []), typeLabel(e)].join(' ').toLowerCase().includes(q));
  const ch = chartBlock(inj, es);
  const appts = S.appointments(inj.id);
  const upcoming = appts.filter((a) => new Date(a.at) > Date.now() - 2 * 3600e3);
  let i = 0;
  const grouped = view.filter === 'all' && !q;
  const tl = { j: 0 };
  const body = !shown.length ? `<div class="empty small"><p>${es.length ? 'Nothing matches.' : 'No entries yet. Tap <b>Log now</b> the next time it hurts, clicks or squeaks.'}</p></div>`
    : grouped ? groupedTimeline(inj, es, tl) : dayGroups(shown, es, tl, { showIncident: true });
  return `
    <div class="topbar" ${st(i++)}><a class="back" href="#/">${icon('left')}Injuries</a>
      <div class="tb-r"><button type="button" class="icon-btn" data-act="search" aria-label="Search entries" aria-pressed="${view.searching}">${icon('search')}</button>
      <a class="icon-btn" href="#/injury/${esc(inj.id)}/visit" aria-label="Visit summary">${icon('clip')}</a>
      <button type="button" class="icon-btn" data-act="edit-injury" aria-label="Edit injury">${icon('more')}</button></div></div>
    <div class="hero" ${st(i++)}><span class="eyebrow">${esc(injSub(inj))}</span><h1>${esc(inj.name)}</h1></div>
    ${upcoming.map((a) => apptCard(a, i++)).join('')}
    <div class="card chart-card" ${st(i++)}>
      <div class="chart-top" id="chartHead">${ch.head}${seg(RANGES, view.range, 'sm range-seg')}</div>
      <div id="chartBox">${ch.svg}</div>
    </div>
    <div class="row-actions" ${st(i++)}>
      <a class="action-pill" href="#/injury/${esc(inj.id)}/visit">${icon('clip', 'sm')}Visit summary</a>
      <button type="button" class="action-pill" data-act="new-appt">${icon('cal', 'sm')}Add appointment</button>
      <button type="button" class="action-pill" data-act="new-incident">${icon('plus', 'sm')}New incident</button>
    </div>
    ${view.searching ? `<div class="search" ${st(0)}>${icon('search', 'sm')}<input id="q" type="search" placeholder="Search notes, triggers, feelings" value="${esc(view.query)}" autocomplete="off"><button type="button" class="text-btn" data-act="search">Done</button></div>` : ''}
    <div class="pills" ${st(i++)}>${FILTERS.filter(([k]) => k === 'all' || counts[k]).map(([k, label]) => `<button type="button" class="pill" data-filter="${k}" aria-pressed="${view.filter === k}">${label}<span class="n">${counts[k]}</span></button>`).join('')}</div>
    <div class="timeline" ${st(i++)}>${body}</div>
    ${pastAppts(appts, i++)}
    <div class="fade-bottom"></div>
    ${inj.status !== 'resolved' ? `<button type="button" class="fab" data-act="log" data-inj="${esc(inj.id)}">${icon('plus')}Log now</button>` : ''}`;
}

function pastAppts(appts, i) {
  const past = appts.filter((a) => new Date(a.at) <= Date.now() - 2 * 3600e3).reverse();
  if (!past.length) return '';
  return `<div class="section-h" ${st(i)}><h2>Past appointments</h2><span>${past.length}</span></div>
    <div class="card list" ${st(i)}>${past.map((a) => `<button type="button" class="crow btn-row" data-act="appt" data-id="${esc(a.id)}"><span class="d">${esc(fmtDate(a.at, { year: '2-digit' }))}</span><span>${esc(a.title)}${a.provider ? ` · ${esc(a.provider)}` : ''}</span>${icon('chev', 'sm')}</button>`).join('')}</div>`;
}

function dayGroups(list, es, tl, { asc = false, startDate = null, showIncident = false } = {}) {
  const groups = [];
  for (const e of list) {
    const k = dayKey(e.at);
    if (!groups.length || groups[groups.length - 1].k !== k) {
      const label = startDate ? `Day ${daysBetween(startDate, e.at) + 1} · ${fmtDateLong(e.at)}` : fmtDay(e.at);
      groups.push({ k, label, items: [] });
    }
    groups[groups.length - 1].items.push(e);
  }
  if (asc) groups.forEach((g) => g.items.sort((a, b) => (a.at < b.at ? -1 : 1)));
  return groups.map((g) => `<section class="day"><h3>${esc(g.label)}</h3>${g.items.map((e) => entryRow(e, es, tl.j++, showIncident)).join('')}</section>`).join('');
}

// Incidents as expandable cards, with entries outside any incident in between (newest first).
function groupedTimeline(inj, es, tl) {
  const incs = S.incidents(inj.id);
  const ids = new Set(incs.map((x) => x.id));
  const blocks = incs.map((inc) => ({ t: S.incidentSpan(inc).last, inc }));
  for (const e of es) if (!ids.has(e.incidentId)) blocks.push({ t: e.at, e });
  blocks.sort((a, b) => (a.t < b.t ? 1 : -1));
  let html = '', loose = [];
  const flush = () => { if (loose.length) html += dayGroups(loose, es, tl); loose = []; };
  for (const b of blocks) { if (b.e) loose.push(b.e); else { flush(); html += incidentCard(inj, b.inc, es, tl); } }
  flush();
  return html;
}

function incidentDates(inc) {
  const sp = S.incidentSpan(inc);
  const end = sp.end ? new Date(sp.end) : new Date();
  const days = daysBetween(sp.first, end) + 1;
  const range = `${fmtDate(sp.first, { year: new Date(sp.first).getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined })} – ${sp.end ? fmtDate(sp.end, { year: new Date(sp.end).getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined }) : 'now'}`;
  return { sp, from: startOfDay(sp.first), to: end, days, range };
}

function incidentCard(inj, inc, es, tl) {
  const ies = es.filter((e) => e.incidentId === inc.id);
  const d = incidentDates(inc);
  const r = St.rated(ies);
  const worst = r.length ? Math.max(...r.map((e) => e.pain)) : null;
  const open = view.expanded.has(inc.id);
  const resolved = inc.status === 'resolved';
  return `<section class="card incident ${resolved ? 'resolved' : 'ongoing'} ${open ? 'open' : ''}" data-inc="${esc(inc.id)}">
    <button type="button" class="inc-head" data-act="toggle-inc" data-id="${esc(inc.id)}" aria-expanded="${open}">
      <span class="inc-top"><span class="inc-status">${resolved ? `${icon('check', 'xs')}Resolved` : 'Ongoing'}</span><span class="inc-dates">${esc(d.range)} · ${d.days} day${d.days === 1 ? '' : 's'}</span></span>
      <span class="inc-row"><span class="inc-title">${esc(inc.title)}</span>${worst != null ? `<span class="inc-worst">worst ${sevBadge(worst)}</span>` : ''}</span>
      ${new Set(r.map((e) => dayKey(e.at))).size >= 3 ? spark(St.daily(ies, d.from, d.to)) : ''}
      <span class="inc-meta"><span>${ies.length} entr${ies.length === 1 ? 'y' : 'ies'}${ies[0] ? ` · last ${esc(ago(ies[0].at))}` : ''}</span><span class="inc-chev">${icon('down', 'sm')}</span></span>
    </button>
    <div class="collapse ${open ? '' : 'closed'}" ${open ? '' : 'inert'}><div><div class="inc-body">
      ${inc.summary ? `<p class="inc-sum">${esc(inc.summary)}</p>` : ''}
      ${dayGroups(ies, es, tl)}
      <a class="inc-open" href="#/injury/${esc(inj.id)}/incident/${esc(inc.id)}">${icon('clip', 'sm')}Open this incident on its own${icon('chev', 'sm')}</a>
    </div></div></div>
  </section>`;
}

function incidentView(inj, inc) {
  const all = S.entries(inj.id);
  const ies = S.incidentEntries(inc.id);
  const d = incidentDates(inc);
  const r = St.rated(ies);
  const worst = r.length ? Math.max(...r.map((e) => e.pain)) : null;
  const avg = r.length ? r.reduce((a, e) => a + e.pain, 0) / r.length : null;
  const appts = S.appointments(inj.id).filter((a) => new Date(a.at) >= d.from && (inc.status !== 'resolved' || new Date(a.at) <= addDays(d.to, 1)));
  const resolved = inc.status === 'resolved';
  const tl = { j: 0 };
  let i = 0;
  return `
    <div class="topbar" ${st(i++)}><a class="back" href="#/injury/${esc(inj.id)}">${icon('left')}${esc(inj.name)}</a>
      <div class="tb-r"><button type="button" class="icon-btn" data-act="edit-incident" aria-label="Edit incident">${icon('more')}</button></div></div>
    <div class="hero" ${st(i++)}><span class="eyebrow">${resolved ? 'Resolved incident' : 'Ongoing incident'} · ${esc(d.range)}</span><h1>${esc(inc.title)}</h1>
      ${inc.summary ? `<p class="inc-lead">${esc(inc.summary)}</p>` : ''}</div>
    <div class="tiles four" ${st(i++)}>
      <div class="card tile"><span class="k">Days</span><span class="big">${d.days}</span></div>
      <div class="card tile"><span class="k">Entries</span><span class="big">${ies.length}</span></div>
      <div class="card tile"><span class="k">Worst</span><span class="big" ${worst != null ? `style="color:${sevColor(worst)}"` : ''}>${worst ?? '–'}</span></div>
      <div class="card tile"><span class="k">Average</span><span class="big">${avg == null ? '–' : avg.toFixed(1)}</span></div>
    </div>
    <div class="card chart-card" ${st(i++)}><div class="chart-top"><span class="big">Daily worst pain</span></div>${trend(St.daily(ies, d.from, d.to))}</div>
    ${appts.length ? `<div class="section-h" ${st(i++)}><h2>Appointments</h2><span>during this incident</span></div>
      <div class="card list" ${st(i++)}>${appts.map((a) => `<button type="button" class="crow btn-row" data-act="appt" data-id="${esc(a.id)}"><span class="d">${esc(fmtDate(a.at))}</span><span>${esc(a.title)}${a.provider ? ` · ${esc(a.provider)}` : ''}</span>${icon('chev', 'sm')}</button>`).join('')}</div>` : ''}
    <div class="section-h" ${st(i++)}><h2>How it unfolded</h2><span>oldest first</span></div>
    <div class="timeline" ${st(i++)}>${ies.length ? dayGroups([...ies].reverse(), all, tl, { asc: true, startDate: d.from }) : '<p class="muted-p">No entries yet. Log one and pick this incident under "Part of".</p>'}</div>
    <div class="btns" ${st(i++)}>
      <button type="button" class="btn" data-act="resolve-incident">${icon(resolved ? 'refresh' : 'check', 'sm')}${resolved ? 'Reopen' : 'Mark resolved'}</button>
      <button type="button" class="btn" data-act="edit-incident">${icon('pen', 'sm')}Edit</button>
    </div>
    <div class="fade-bottom"></div>
    ${inj.status !== 'resolved' ? `<button type="button" class="fab" data-act="log" data-inj="${esc(inj.id)}" data-inc="${esc(inc.id)}">${icon('plus')}Log now</button>` : ''}`;
}

function entryRow(e, es, j, showIncident = false) {
  const rx = e.type === 'treatment' ? St.effectFor(es, e) : null;
  const tags = [
    ...(e.ask ? [`<span class="tag flag">${e.askDone ? `${icon('check', 'xs')}Asked` : 'Ask doctor'}</span>`] : []),
    ...(e.feels || []).map((t) => `<span class="tag">${esc(t)}</span>`),
    ...(e.doing || []).map((t) => `<span class="tag ${e.type === 'treatment' ? 'rx' : 'doing'}">${esc(t)}</span>`),
    ...(rx ? [`<span class="tag rx">Pain ${rx[0]} → ${rx[1]}</span>`] : []),
    ...(showIncident && S.incident(e.incidentId) ? [`<span class="tag inc">${esc(S.incident(e.incidentId).title)}</span>`] : []),
  ];
  const node = e.pain != null ? `<span class="node" style="--sev:${sevColor(e.pain)}"></span>` : `<span class="node sq ${e.type}"></span>`;
  return `<button type="button" class="entry" data-act="entry" data-id="${esc(e.id)}" style="--j:${Math.min(j, 12)}">
    <span class="time">${e.noTime ? '' : esc(fmtTime(e.at))}</span>
    <span class="railc">${node}</span>
    <span class="card body">
      <span class="row"><span class="ttl">${icon(S.TYPE[e.type]?.icon || 'pen', 'xs')}${esc(typeLabel(e))}${e.source === 'assistant' ? `<span class="by-ai" title="Added by your assistant">${icon('spark', 'xs')}</span>` : ''}</span>${sevBadge(e.pain)}</span>
      ${tags.length ? `<span class="tags">${tags.join('')}</span>` : ''}
      ${e.note ? `<span class="note-t">${esc(e.note)}</span>` : ''}
    </span>
  </button>`;
}

// ---------------------------------------------------------------- visit summary
function visitRange(inj) {
  const now = new Date();
  const pastAppt = S.appointments(inj.id).filter((a) => new Date(a.at) < now - 2 * 3600e3).pop();
  const es = S.entries(inj.id);
  const first = es.length ? startOfDay(es[es.length - 1].at) : startOfDay(now);
  const presets = [
    ...(pastAppt ? [{ key: 'last', label: 'Since your last visit', sub: `${pastAppt.title} · ${fmtDate(pastAppt.at)}`, from: new Date(pastAppt.at) }] : []),
    { key: '14', label: 'Last 2 weeks', from: addDays(startOfDay(now), -13) },
    { key: '30', label: 'Last 30 days', from: addDays(startOfDay(now), -29) },
    { key: '90', label: 'Last 3 months', from: addDays(startOfDay(now), -89) },
    { key: 'all', label: 'Everything', sub: es.length ? `Since ${fmtDate(first, { year: 'numeric' })}` : '', from: first },
  ];
  const sel = view.visit[inj.id] || { key: pastAppt ? 'last' : '30' };
  if (sel.key === 'custom') return { presets, cur: { key: 'custom', label: 'Custom range', from: new Date(`${sel.from}T00:00`), to: new Date(`${sel.to}T23:59:59`) } };
  const p = presets.find((x) => x.key === sel.key) || presets.find((x) => x.key === '30');
  return { presets, cur: { ...p, to: now } };
}

function visitView(inj) {
  const all = S.entries(inj.id);
  const { cur } = visitRange(inj);
  const s = St.summary(all, cur.from, cur.to);
  const nDays = daysBetween(cur.from, cur.to) + 1;
  const questions = all.filter((e) => e.ask && (!e.askDone || (new Date(e.at) >= cur.from))).sort((a, b) => (a.askDone - b.askDone) || (a.at < b.at ? 1 : -1));
  const open = questions.filter((q) => !q.askDone).length;
  const trend = s.avg != null && s.prevAvg != null && Math.abs(s.avg - s.prevAvg) >= 0.1 ? `<span class="s ${s.avg > s.prevAvg ? 'up' : 'down'}">${s.avg > s.prevAvg ? '↑' : '↓'} from ${s.prevAvg.toFixed(1)} before</span>` : `<span class="s">${s.count} entries</span>`;
  const maxT = s.triggers[0]?.[1] || 1;
  const asc = [...s.entries].reverse();
  const next = S.upcoming(inj.id)[0];
  let i = 0;
  return `
    <div class="topbar no-print" ${st(i++)}><a class="back" href="#/injury/${esc(inj.id)}">${icon('left')}${esc(inj.name)}</a>
      <div class="tb-r"><button type="button" class="icon-btn" data-act="bigtext" aria-pressed="${!!S.getLocal().bigText}" aria-label="Larger text">${icon('text')}</button>
      <button type="button" class="icon-btn" data-act="share" aria-label="Share summary">${icon('share')}</button></div></div>
    <div class="print-head"><b>${esc(inj.name)}</b>${inj.detail ? ` · ${esc(inj.detail)}` : ''}<span>Symptom Tracker visit summary · printed ${esc(fmtDateLong(new Date()))}</span></div>
    <div class="hero" ${st(i++)}><span class="eyebrow">Visit summary · ${esc(inj.name)}</span><h1>${esc(cur.key === 'last' ? 'Since your last visit' : cur.label)}</h1>
      ${inj.detail || inj.startedOn ? `<p>${esc([inj.detail, inj.startedOn ? `Started ${fmtDate(`${inj.startedOn}T12:00`, { year: 'numeric' })}` : ''].filter(Boolean).join(' · '))}</p>` : ''}</div>
    <div class="range" ${st(i++)}><button type="button" class="chip" aria-pressed="true" data-act="range">${icon('cal', 'xs')}${esc(fmtDate(cur.from))} – ${esc(fmtDate(cur.to))}${icon('down', 'xs')}</button><span>${nDays} day${nDays > 1 ? 's' : ''}${next ? ` · next visit ${esc(apptWhen(next.at))}` : ''}</span></div>
    <div class="tiles" ${st(i++)}>
      <div class="card tile"><span class="k">Average pain</span><span class="big">${s.avg == null ? '–' : s.avg.toFixed(1)}<small> /10</small></span>${trend}</div>
      <div class="card tile"><span class="k">Worst</span><span class="big" ${s.worst ? `style="color:${sevColor(s.worst.pain)}"` : ''}>${s.worst ? s.worst.pain : '–'}<small> /10</small></span><span class="s">${s.worst ? esc(`${fmtDate(s.worst.at)}${s.worst.doing?.[0] ? ` · ${s.worst.doing[0].toLowerCase()}` : ''}`) : 'No pain logged'}</span></div>
      <div class="card tile"><span class="k">Flares ≥7</span><span class="big">${s.flares}</span><span class="s">${s.flareTrigger ? `Most after: ${esc(s.flareTrigger.toLowerCase())}` : s.flares ? '' : 'None in this range'}</span></div>
      <div class="card tile"><span class="k">Night pain</span><span class="big">${s.nights}<small> night${s.nights === 1 ? '' : 's'}</small></span><span class="s">Logged 10 PM – 6 AM</span></div>
    </div>
    <div class="card chart-card print-keep" ${st(i++)}>${trendFor(all, cur)}</div>
    ${visitIncidents(inj, cur, i++)}

    <div class="section-h" ${st(i++)}><h2>Questions to ask</h2><span>${open ? `${open} open` : questions.length ? 'All asked' : ''}</span></div>
    ${questions.length ? `<div class="card qs" ${st(i++)}>${questions.map((q) => `<label class="q"><input type="checkbox" data-ask="${esc(q.id)}" ${q.askDone ? 'checked' : ''}><span>${esc(q.note || `${typeLabel(q)}${q.pain != null ? ` (pain ${q.pain})` : ''}`)}<small>Logged ${esc(fmtDate(q.at))}</small></span></label>`).join('')}</div>`
      : `<p class="muted-p" ${st(i++)}>Turn on "Ask my doctor about this" when you log something, and it'll be listed here.</p>`}
    <button type="button" class="link-btn no-print" data-act="log-q" ${st(i++)}>${icon('plus', 'xs')}Add a question</button>

    ${s.triggers.length ? `<div class="section-h" ${st(i++)}><h2>Common triggers</h2><span>times logged</span></div>
    <div class="card bars" ${st(i++)}>${s.triggers.map(([t, n], k) => `<div class="bar-row" style="--k:${k}"><span>${esc(t)}</span><b>${n}</b><span class="track"><span class="fill" style="width:${Math.round((n / maxT) * 100)}%"></span></span></div>`).join('')}</div>` : ''}

    ${s.feels.length ? `<div class="section-h" ${st(i++)}><h2>How it feels</h2><span>times logged</span></div>
    <div class="chips static" ${st(i++)}>${s.feels.map(([t, n]) => `<span class="chip">${esc(t)}<span class="n">${n}</span></span>`).join('')}</div>` : ''}

    ${s.treatments.length ? `<div class="section-h" ${st(i++)}><h2>Treatments</h2><span>pain change within 6 h</span></div>
    <div class="card list" ${st(i++)}>${s.treatments.map((t) => `<div class="crow"><span class="d">${t.count}×</span><span>${esc(t.name)}</span>${t.avg == null ? '<span class="tag">–</span>' : `<span class="tag ${t.avg < -0.05 ? 'rx' : t.avg > 0.05 ? 'worse' : ''}">${t.avg > 0 ? '+' : t.avg < 0 ? '−' : '±'}${Math.abs(t.avg).toFixed(1)}</span>`}</div>`).join('')}</div>` : ''}

    <div class="section-h" ${st(i++)}><h2>All entries</h2><span>oldest first · ${asc.length}</span></div>
    ${asc.length ? `<div class="card list entries-list" ${st(i++)}>${asc.map((e) => `<div class="crow">
      <span class="d">${esc(fmtDate(e.at))}${e.noTime ? '' : `<br>${esc(fmtTime(e.at))}`}</span>
      <span class="ct"><b>${esc(typeLabel(e))}</b>${[...(e.feels || []), ...(e.doing || [])].length ? ` · ${esc([...(e.feels || []), ...(e.doing || [])].join(', '))}` : ''}${e.note ? `<span class="nt">${esc(e.note)}</span>` : ''}</span>
      ${e.pain != null ? sevBadge(e.pain) : e.ask ? '<span class="tag flag">Ask</span>' : '<span></span>'}</div>`).join('')}</div>` : '<p class="muted-p">No entries in this range.</p>'}
    <div class="btns no-print" ${st(i++)}><button type="button" class="btn primary" data-act="print">${icon('print', 'sm')}Print / PDF</button><button type="button" class="btn" data-act="share">${icon('share', 'sm')}Share text</button></div>`;
}

function visitIncidents(inj, cur, i) {
  const list = S.incidents(inj.id).filter((inc) => { const sp = S.incidentSpan(inc); return new Date(sp.first) <= cur.to && (!sp.end || new Date(sp.end) >= cur.from); });
  if (!list.length) return '';
  return `<div class="section-h" ${st(i)}><h2>Incidents</h2><span>in this period</span></div>
    <div class="card list" ${st(i)}>${list.map((inc) => {
      const d = incidentDates(inc);
      const r = St.rated(S.incidentEntries(inc.id));
      const worst = r.length ? Math.max(...r.map((e) => e.pain)) : null;
      return `<a class="crow btn-row inc-row-link" href="#/injury/${esc(inj.id)}/incident/${esc(inc.id)}"><span class="d">${esc(inc.status === 'resolved' ? 'Resolved' : 'Ongoing')}</span><span class="ct"><b>${esc(inc.title)}</b><span class="nt">${esc(d.range)} · ${d.sp.count} entries</span></span>${worst != null ? sevBadge(worst) : icon('chev', 'sm')}</a>`;
    }).join('')}</div>`;
}

function trendFor(all, cur) {
  const days = St.daily(all, cur.from, cur.to);
  return `<div class="chart-top"><span class="big">Daily worst pain</span><span class="legend-mini"><i class="dot-l"></i>worst <i class="line-l"></i>trend</span></div>${trend(days, { animate: true })}`;
}

function shareText(inj) {
  const { cur } = visitRange(inj);
  const all = S.entries(inj.id);
  const s = St.summary(all, cur.from, cur.to);
  const lines = [`${inj.name}${inj.detail ? ` (${inj.detail})` : ''}`, `${fmtDate(cur.from, { year: 'numeric' })} – ${fmtDate(cur.to, { year: 'numeric' })}`, ''];
  lines.push(`Average pain: ${s.avg == null ? '–' : s.avg.toFixed(1)}/10${s.prevAvg != null ? ` (before: ${s.prevAvg.toFixed(1)})` : ''}`);
  if (s.worst) lines.push(`Worst: ${s.worst.pain}/10 on ${fmtDate(s.worst.at)}${s.worst.doing?.length ? ` (${s.worst.doing.join(', ')})` : ''}`);
  lines.push(`Flares 7+: ${s.flares} · Nights with pain: ${s.nights}`);
  const qs = all.filter((e) => e.ask && !e.askDone);
  if (qs.length) { lines.push('', 'Questions:'); qs.forEach((q) => lines.push(`- ${q.note || typeLabel(q)}`)); }
  if (s.triggers.length) { lines.push('', `Triggers: ${s.triggers.map(([t, n]) => `${t} (${n})`).join(', ')}`); }
  if (s.treatments.length) lines.push(`Treatments: ${s.treatments.map((t) => `${t.name} ${t.count}×${t.avg != null ? ` (${t.avg > 0 ? '+' : ''}${t.avg.toFixed(1)})` : ''}`).join(', ')}`);
  lines.push('', 'Entries:');
  [...s.entries].reverse().forEach((e) => lines.push(`${fmtDate(e.at)}${e.noTime ? "" : ` ${fmtTime(e.at)}`} · ${typeLabel(e)}${e.pain != null ? ` ${e.pain}/10` : ''}${[...(e.feels || []), ...(e.doing || [])].length ? ` · ${[...(e.feels || []), ...(e.doing || [])].join(', ')}` : ''}${e.note ? ` · ${e.note}` : ''}`));
  return lines.join('\n');
}

// ---------------------------------------------------------------- settings
function settingsView() {
  const s = Sync.getStatus();
  const c = Sync.getConfig();
  const local = S.getLocal();
  const devs = S.devices();
  const n = S.entries().length;
  let i = 0;
  const statusLine = {
    off: ['', 'Sync is off', 'Entries are saved on this device only.'],
    idle: ['on', c.lastSyncAt ? `Synced ${ago(c.lastSyncAt)}` : 'Synced', `${n} entries · ${devs.length || 1} device${devs.length === 1 ? '' : 's'}`],
    syncing: ['busy', 'Syncing…', `${n} entries`],
    offline: ['warn', 'Offline', 'Changes are saved here and will sync when you are back online.'],
    error: ['err', "Couldn't sync", s.detail],
  }[s.state] || ['', '', ''];
  return `
    <div class="topbar" ${st(i++)}><a class="back" href="#/">${icon('left')}Back</a></div>
    <div class="hero" ${st(i++)}><h1>Sync & backup</h1><p>Your entries live on this device first, so logging works offline.</p></div>
    <div class="card status-card" ${st(i++)}>
      <div class="status-line"><span class="pulse ${statusLine[0]}"></span><div class="grow"><b>${esc(statusLine[1])}</b><small>${esc(statusLine[2])}</small></div>
        ${Sync.configured() ? `<button type="button" class="icon-btn" data-act="sync-now" aria-label="Sync now">${icon('refresh', 'sm')}</button>` : ''}</div>
      ${Sync.configured()
        ? `<div class="lock">${icon('lock', 'sm')}<span>Encrypted with your passphrase before it leaves this device. The sync server only stores data it can't read.</span></div>`
        : `<button type="button" class="primary-btn" data-act="sync-setup">${icon('lock', 'sm')}Turn on encrypted sync</button>`}
      ${s.state === 'error' && Sync.configured() ? `<button type="button" class="secondary-btn" data-act="sync-setup">Set up sync again</button>` : ''}
    </div>
    ${Sync.configured() ? `
    <div class="section-h" ${st(i++)}><h2>Devices</h2><span>using your passphrase</span></div>
    <div class="card list" ${st(i++)}>${(devs.length ? devs : [{ id: local.deviceId, name: Sync.deviceName(), lastSeen: new Date().toISOString() }]).map((d) => `<div class="dev">${icon(/iPhone|Android/.test(d.name) ? 'phone' : 'laptop')}<span class="grow">${esc(d.name)}${d.id === local.deviceId ? ' <span class="tag">This device</span>' : ''}<small>${d.id === local.deviceId ? 'Now' : `Last synced ${esc(ago(d.lastSeen))}`}</small></span></div>`).join('')}</div>
    <button type="button" class="row-btn" data-act="pair" ${st(i++)}>${icon('plus')}<span class="grow">Add another device<small>A link and QR code to open on it</small></span>${icon('chev', 'sm')}</button>
    <div class="section-h" ${st(i++)}><h2>Assistant</h2><span>write-only access</span></div>
    <button type="button" class="row-btn" data-act="assistant" ${st(i++)}>${icon('spark')}<span class="grow">Let an assistant add things<small>Tell Claude about an appointment and it shows up here</small></span>${icon('chev', 'sm')}</button>` : ''}

    <div class="section-h" ${st(i++)}><h2>Backup file</h2><span>${local.lastBackupAt ? `last saved ${esc(fmtDate(local.lastBackupAt))}` : 'never saved'}</span></div>
    <button type="button" class="row-btn" data-act="backup" ${st(i++)}>${icon('download')}<span class="grow">Save backup file<small>One .json file with every injury, entry and appointment</small></span>${icon('chev', 'sm')}</button>
    <label class="row-btn" ${st(i++)}>${icon('upload')}<span class="grow">Restore from file<small>Merges with what's here, without duplicates</small></span>${icon('chev', 'sm')}<input type="file" id="restoreFile" accept=".json,application/json" hidden></label>
    <button type="button" class="row-btn" data-act="csv" ${st(i++)}>${icon('table')}<span class="grow">Export as spreadsheet<small>.csv you can open in Excel, Numbers or Sheets</small></span>${icon('chev', 'sm')}</button>

    <div class="section-h" ${st(i++)}><h2>Appearance</h2><span>this device</span></div>
    <div ${st(i++)}>${seg([['system', 'System'], ['light', 'Light'], ['dark', 'Dark']], local.theme || 'system', 'lg theme-seg')}</div>

    <details class="adv" ${st(i++)}><summary>More</summary>
      <div class="adv-body">
        ${Sync.configured() ? `<p class="hint">Server: <span class="mono">${esc(c.url)}</span></p>
        <button type="button" class="secondary-btn" data-act="sync-off">Turn off sync on this device</button>` : ''}
        <button type="button" class="secondary-btn" data-act="install">Install on your phone</button>
        <button type="button" class="danger-btn" id="eraseLocal">${icon('trash', 'sm')}Erase everything on this device</button>
        <p class="hint">Erasing doesn't touch your synced copy or backup files.</p>
      </div>
    </details>
    <p class="foot-note" ${st(i++)}>Symptom Tracker keeps your health notes private: no accounts, no tracking, no ads.<br>Version ${APP_VERSION}</p>`;
}

// ---------------------------------------------------------------- events
function onSeg(sg, v) {
  if (sg.classList.contains('theme-seg')) {
    document.documentElement.classList.add('theme-fade');
    S.setLocal({ theme: v }).then(applyPrefs);
    setTimeout(() => document.documentElement.classList.remove('theme-fade'), 500);
    return;
  }
  if (sg.classList.contains('range-seg')) {
    view.range = v;
    const inj = S.injury(route.id);
    const ch = chartBlock(inj, S.entries(inj.id));
    const head = app.querySelector('#chartHead .big');
    head.outerHTML = ch.head;
    const box = app.querySelector('#chartBox');
    box.classList.remove('swap'); void box.offsetWidth; box.classList.add('swap');
    box.innerHTML = ch.svg;
  }
}

app.addEventListener('click', async (e) => {
  const pill = e.target.closest('[data-filter]');
  if (pill) {
    view.filter = pill.dataset.filter;
    app.querySelectorAll('[data-filter]').forEach((p) => p.setAttribute('aria-pressed', String(p === pill)));
    rerenderTimeline();
    return;
  }
  const a = e.target.closest('[data-act]');
  if (!a) return;
  const act = a.dataset.act;
  const inj = route?.id ? S.injury(route.id) : null;
  switch (act) {
    case 'log': logSheet({ injuryId: a.dataset.inj || inj?.id, ...(a.dataset.inc ? { incidentId: a.dataset.inc } : {}) }); break;
    case 'toggle-inc': {
      const card = a.closest('.incident');
      const id = a.dataset.id;
      const open = !view.expanded.has(id);
      if (open) view.expanded.add(id); else view.expanded.delete(id);
      card.classList.toggle('open', open);
      a.setAttribute('aria-expanded', String(open));
      const c = card.querySelector('.collapse');
      c.classList.toggle('closed', !open); c.inert = !open;
      if (open) setTimeout(() => { const r = card.getBoundingClientRect(); if (r.bottom > innerHeight - 90) window.scrollBy({ top: Math.min(r.top - 70, r.bottom - innerHeight + 110), behavior: 'smooth' }); }, 380);
      break;
    }
    case 'new-incident': incidentSheet({ injuryId: inj?.id }); break;
    case 'edit-incident': incidentSheet({ incident: S.incident(route.inc) }); break;
    case 'resolve-incident': {
      const inc = S.incident(route.inc);
      const resolving = inc.status !== 'resolved';
      S.save('incidents', { ...inc, status: resolving ? 'resolved' : 'ongoing', resolvedOn: resolving ? dayKey(new Date()) : '' });
      toast(resolving ? 'Marked resolved' : 'Reopened');
      break;
    }
    case 'log-q': logSheet({ injuryId: inj?.id, type: 'concern' }); break;
    case 'entry': logSheet({ entry: S.entry(a.dataset.id) }); break;
    case 'new-injury': injurySheet(); break;
    case 'edit-injury': injurySheet({ injury: inj }); break;
    case 'new-appt': appointmentSheet({ injuryId: inj?.id }); break;
    case 'appt': appointmentSheet({ appt: S.appointment(a.dataset.id) }); break;
    case 'toggle-resolved': view.showResolved = !view.showResolved; render('data'); break;
    case 'search':
      view.searching = !view.searching; if (!view.searching) view.query = '';
      render('data'); if (view.searching) app.querySelector('#q')?.focus();
      break;
    case 'range': {
      const { presets, cur } = visitRange(inj);
      rangeSheet({ presets, current: cur, onPick: (sel) => { view.visit[inj.id] = sel; lastKey = ''; render('data'); } });
      break;
    }
    case 'print': window.print(); break;
    case 'share': {
      const text = shareText(inj);
      if (navigator.share) { try { await navigator.share({ title: `${inj.name} summary`, text }); } catch { /* cancelled */ } }
      else { try { await navigator.clipboard.writeText(text); toast('Summary copied'); } catch { toast("Couldn't copy"); } }
      break;
    }
    case 'bigtext': await S.setLocal({ bigText: !S.getLocal().bigText }); applyPrefs(); a.setAttribute('aria-pressed', String(!!S.getLocal().bigText)); break;
    case 'sync-setup': syncSheet(); break;
    case 'sync-now': Sync.syncNow(); break;
    case 'sync-off': await Sync.disconnect(); toast('Sync is off on this device. Your entries stay here.'); render('data'); break;
    case 'pair': pairSheet(); break;
    case 'assistant': assistantSheet(); break;
    case 'backup':
      download(`symptom-tracker-backup-${dayKey(new Date())}.json`, S.backupJSON());
      await S.setLocal({ lastBackupAt: new Date().toISOString() });
      toast('Backup saved'); render('data');
      break;
    case 'csv': download(`symptom-tracker-${dayKey(new Date())}.csv`, `﻿${S.csv()}`, 'text/csv'); break;
    case 'install': toast(/iPhone|iPad/.test(navigator.userAgent) ? 'In Safari, tap Share, then "Add to Home Screen"' : 'Use your browser menu: "Install app" or "Add to Home screen"', { ms: 6000 }); break;
    default: break;
  }
});

app.addEventListener('change', async (e) => {
  if (e.target.matches('[data-ask]')) {
    const rec = S.entry(e.target.dataset.ask);
    if (rec) { S.save('entries', { ...rec, askDone: e.target.checked }); }
    return;
  }
  if (e.target.id === 'restoreFile') {
    const f = e.target.files?.[0];
    if (!f) return;
    try { const added = S.restoreJSON(await f.text()); toast(added > 0 ? `Restored ${added} entries` : 'Restored. Nothing new to add.'); }
    catch (err) { toast(err.message || "Couldn't read that file"); }
    e.target.value = '';
  }
});
app.addEventListener('input', (e) => {
  if (e.target.id === 'q') { view.query = e.target.value; rerenderTimeline(); }
});

function rerenderTimeline() {
  const inj = S.injury(route.id);
  const tmp = document.createElement('div');
  tmp.innerHTML = injuryView(inj);
  const fresh = tmp.querySelector('.timeline');
  const cur = app.querySelector('.timeline');
  if (fresh && cur) { fresh.classList.add('refilter'); cur.replaceWith(fresh); }
}

function bindErase() {
  const b = document.getElementById('eraseLocal');
  if (b && !b.dataset.bound) {
    b.dataset.bound = '1';
    confirmButton(b, 'Tap again to erase this device', async () => { await S.kvClearAll(); location.hash = '#/'; location.reload(); });
  }
}

function applyPrefs() {
  const root = document.documentElement;
  root.classList.toggle('big-text', !!S.getLocal().bigText);
  const theme = S.getLocal().theme || 'system';
  if (theme === 'system') delete root.dataset.theme; else root.dataset.theme = theme;
  try { localStorage.setItem('st.theme', theme); } catch { /* private mode */ }
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => { m.content = dark ? '#171615' : '#F7F5F2'; m.removeAttribute('media'); });
}

// ---------------------------------------------------------------- startup
async function start() {
  await S.init();
  applyPrefs();
  let cfg = {};
  try { cfg = await (await fetch(`config.json?t=${Date.now()}`, { cache: 'no-store' })).json(); } catch { /* offline: cached in sync settings */ }
  await Sync.init(cfg.syncUrl || '');
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyPrefs);

  window.addEventListener('hashchange', () => {
    if (location.hash.startsWith('#pair=')) return handlePair();
    render('route'); bindErase();
  });
  S.onChange(() => { render('data'); bindErase(); });
  Sync.onStatus(() => {
    if (route?.name === 'settings') { render('data'); bindErase(); }
    else { const d = app.querySelector('.sync-dot'); if (d) d.outerHTML = syncDotHtml(); }
  });
  Sync.onInbox(({ added, failed }) => {
    if (added.length) toast(added.length === 1 ? `Your assistant added: ${added[0]}` : `Your assistant added ${added.length} items`, { ms: 5000 });
    else if (failed.length) toast("An assistant item couldn't be read and was skipped", { ms: 5000 });
  });
  if (location.hash.startsWith('#pair=')) handlePair();
  else if (location.hash === '#/log') { history.replaceState(null, '', `${location.pathname}#/`); render('route'); logSheet(); }
  else render('route');
  bindErase();

  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
}
const syncDotHtml = () => syncDot();

function handlePair() {
  const p = Sync.readPairLink(location.hash);
  history.replaceState(null, '', `${location.pathname}#/settings`);
  render('route'); bindErase();
  if (p) syncSheet(p);
}

start();
