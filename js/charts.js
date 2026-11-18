// Tiny SVG charts: a sparkline for injury cards and the pain trend chart.
import { sevColor, fmtDate } from './ui.js';

let gid = 0;

export function spark(points) {
  const W = 320, H = 46;
  const vals = points.map((p) => p.max);
  const idx = vals.map((v, i) => (v == null ? null : i)).filter((i) => i != null);
  if (idx.length < 2) return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><line x1="3" x2="${W - 3}" y1="${H - 4}" y2="${H - 4}" stroke="var(--line-2)" stroke-dasharray="3 5" vector-effect="non-scaling-stroke"/></svg>`;
  const x = (i) => 3 + (i * (W - 6)) / (vals.length - 1), y = (v) => H - 4 - (v / 10) * (H - 8);
  const pts = idx.map((i) => `${x(i).toFixed(1)},${y(vals[i]).toFixed(1)}`);
  const last = idx[idx.length - 1];
  const id = `sg${++gid}`;
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
    <defs><linearGradient id="${id}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--accent)" stop-opacity="0.18"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs>
    <path d="M${pts.join(' L')} L${x(last)},${H} L${x(idx[0])},${H}Z" fill="url(#${id})"/>
    <path class="draw" d="M${pts.join(' L')}" fill="none" stroke="var(--accent)" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round" pathLength="1"/>
    <circle cx="${x(last)}" cy="${y(vals[last])}" r="3.5" fill="${sevColor(vals[last])}" stroke="var(--surface)" stroke-width="1.5" vector-effect="non-scaling-stroke"/>
  </svg>`;
}

// days: [{date, max, avg}] — dots are each day's worst, the line is a 3-reading moving average
export function trend(days, { animate = true } = {}) {
  const W = 320, H = 130, L = 18, R = 6, T = 8, B = 18;
  const n = days.length;
  const x = (i) => L + (n === 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (n - 1)), y = (v) => T + (1 - v / 10) * (H - T - B);
  const grid = [0, 5, 10].map((v) => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)" stroke-width="1"/><text x="0" y="${y(v) + 3.5}">${v}</text>`).join('');
  const have = days.map((d, i) => [d, i]).filter(([d]) => d.max != null);
  if (!have.length) {
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="No pain readings in this range">${grid}<text x="${(W + L) / 2}" y="${H / 2}" text-anchor="middle" class="empty-t">No pain logged in this range</text></svg>`;
  }
  const ma = have.map(([d], k) => { const s = have.slice(Math.max(0, k - 2), k + 1); return s.reduce((a, [dd]) => a + dd.avg, 0) / s.length; });
  const line = have.length > 1 ? `<path class="${animate ? 'draw' : ''}" d="M${have.map(([, i], k) => `${x(i).toFixed(1)},${y(ma[k]).toFixed(1)}`).join(' L')}" fill="none" stroke="var(--ink-2)" stroke-opacity="0.45" stroke-width="1.6" stroke-linejoin="round" pathLength="1"/>` : '';
  const r = n > 60 ? 2.2 : n > 20 ? 3 : 4.5;
  const dots = have.map(([d, i], k) => `<circle cx="${x(i).toFixed(1)}" cy="${y(d.max).toFixed(1)}" r="${r}" fill="${sevColor(d.max)}" class="${animate ? 'dot' : ''}" style="--d:${Math.round((k * 320) / have.length)}ms"><title>${fmtDate(d.date)}: worst ${d.max}</title></circle>`).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Pain trend">${grid}${line}${dots}
    <text x="${L}" y="${H - 3}">${fmtDate(days[0].date)}</text><text x="${W - R}" y="${H - 3}" text-anchor="end">${fmtDate(days[n - 1].date)}</text></svg>`;
}
