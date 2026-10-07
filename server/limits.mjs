/* Basic abuse limits. A fresh scan fetches someone else's site and, with a key, spends a shared
   Google PageSpeed quota, so fresh scans are counted per visitor and in total. A site scanned in
   the last day is served from the cache and costs nothing, so it is never counted.

   The counts live in memory, per server instance: a floor, not a wall. For a busy deployment add
   a rate-limit rule in the Vercel firewall too (see the README). */
export const DEFAULT_LIMITS = { perTenMin: 6, perDay: 30, totalPerDay: 2000, pagespeedPerDay: 1500 };

export function limiter(limits = {}, now = () => Date.now()) {
  const L = { ...DEFAULT_LIMITS, ...limits };
  const seen = new Map();
  let day = '', total = 0, psi = 0;
  const roll = () => { const d = new Date(now()).toISOString().slice(0, 10); if (d !== day) { day = d; total = 0; psi = 0; seen.clear(); } };
  return {
    limits: L,
    /* null when the scan may go ahead, otherwise the reason in plain words */
    check(ip, n = 1) {
      roll();
      if (total + n > L.totalPerDay) return 'The scanner has done all the scans it can for today. Try again tomorrow.';
      if (!ip) return null;
      const t = now(), a = (seen.get(ip) || []).filter(x => t - x < 864e5);
      if (a.filter(x => t - x < 600e3).length + n > L.perTenMin) return 'That is a lot of scans at once. Give it ten minutes.';
      if (a.length + n > L.perDay) return 'That is the most scans one visitor can run in a day. Try again tomorrow.';
      return null;
    },
    take(ip, n = 1) {
      roll(); total += n;
      if (!ip) return;
      const t = now(), a = (seen.get(ip) || []).filter(x => t - x < 864e5);
      for (let i = 0; i < n; i++) a.push(t);
      seen.set(ip, a); if (seen.size > 20000) seen.clear();
    },
    /* PageSpeed has its own daily ceiling, below Google's, so the key's quota is never emptied. */
    pagespeed() { roll(); if (psi >= L.pagespeedPerDay) return false; psi++; return true; },
  };
}
