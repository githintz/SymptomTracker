// Numbers for the cards, chart and visit summary.
import { RATED } from './store.js';
import { dayKey, startOfDay, addDays } from './ui.js';

export const rated = (es) => es.filter((e) => RATED.has(e.type) && e.pain != null);
export const inRange = (es, from, to) => es.filter((e) => { const t = new Date(e.at); return (!from || t >= from) && (!to || t <= to); });
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

// one point per calendar day: the day's worst and average pain
export function daily(es, from, to) {
  const map = new Map();
  for (const e of rated(es)) {
    const k = dayKey(e.at);
    const d = map.get(k) || { max: 0, sum: 0, n: 0 };
    d.max = Math.max(d.max, e.pain); d.sum += e.pain; d.n++;
    map.set(k, d);
  }
  const out = [];
  for (let d = startOfDay(from); d <= to; d = addDays(d, 1)) {
    const v = map.get(dayKey(d));
    out.push({ date: new Date(d), max: v ? v.max : null, avg: v ? v.sum / v.n : null });
  }
  return out;
}

export function cardStats(es) {
  const now = new Date();
  const r = rated(es);
  const last7 = inRange(r, addDays(now, -7), now).map((e) => e.pain);
  const prev7 = inRange(r, addDays(now, -14), addDays(now, -7)).map((e) => e.pain);
  const a = mean(last7), b = mean(prev7);
  return {
    avg7: a, delta: a != null && b != null ? a - b : null,
    flares30: inRange(r, addDays(now, -30), now).filter((e) => e.pain >= 7).length,
    latest: r[0] || null,
  };
}

const countTags = (es, field) => {
  const m = new Map();
  for (const e of es) for (const t of e[field] || []) m.set(t, (m.get(t) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
};

// For each treatment: pain shortly before vs shortly after (within 6 hours).
export function treatmentEffects(es) {
  const asc = [...es].sort((a, b) => (a.at < b.at ? -1 : 1));
  const r = rated(asc);
  const W = 6 * 3600e3;
  const m = new Map();
  for (const e of asc) {
    if (e.type !== 'treatment') continue;
    const t = Date.parse(e.at);
    const before = [...r].reverse().find((x) => Date.parse(x.at) <= t && t - Date.parse(x.at) <= W);
    const after = r.find((x) => Date.parse(x.at) > t && Date.parse(x.at) - t <= W);
    const names = e.doing?.length ? e.doing : [e.note?.split('\n')[0].slice(0, 40) || 'Treatment'];
    for (const n of names) {
      const s = m.get(n) || { name: n, count: 0, deltas: [] };
      s.count++;
      if (before && after) s.deltas.push(after.pain - before.pain);
      m.set(n, s);
    }
  }
  return [...m.values()].map((s) => ({ ...s, avg: mean(s.deltas) })).sort((a, b) => b.count - a.count);
}

export function effectFor(es, entryRec) {
  const t = Date.parse(entryRec.at), W = 6 * 3600e3;
  const r = rated(es);
  const before = r.find((x) => Date.parse(x.at) <= t && t - Date.parse(x.at) <= W);
  const after = [...r].reverse().find((x) => Date.parse(x.at) > t && Date.parse(x.at) - t <= W);
  return before && after ? [before.pain, after.pain] : null;
}

export function summary(all, from, to) {
  const es = inRange(all, from, to);
  const r = rated(es);
  const span = to - from;
  const prev = rated(inRange(all, new Date(+from - span), from));
  const worst = r.reduce((w, e) => (!w || e.pain > w.pain ? e : w), null);
  const flares = r.filter((e) => e.pain >= 7);
  const nights = new Set(r.filter((e) => { const h = new Date(e.at).getHours(); return h >= 22 || h < 6; }).map((e) => dayKey(addDays(e.at, new Date(e.at).getHours() < 6 ? -1 : 0))));
  const flareTrig = countTags(flares, 'doing')[0];
  return {
    entries: es, count: es.length,
    avg: mean(r.map((e) => e.pain)), prevAvg: mean(prev.map((e) => e.pain)),
    worst, flares: flares.length, flareTrigger: flareTrig ? flareTrig[0] : null, nights: nights.size,
    triggers: countTags(es.filter((e) => e.type !== 'treatment'), 'doing').slice(0, 6),
    feels: countTags(es, 'feels').slice(0, 8),
    treatments: treatmentEffects(es),
    questions: es.filter((e) => e.ask).sort((a, b) => (a.askDone - b.askDone) || (a.at < b.at ? 1 : -1)),
  };
}
