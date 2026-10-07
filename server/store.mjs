/* Where finished reports are kept, so a share link keeps working and a site scanned recently
   is served from the cache instead of being fetched again.

   memoryStore()   tests and short-lived processes
   fileStore(dir)  local runs: one JSON file per site
   blobStore()     Vercel Blob, when BLOB_READ_WRITE_TOKEN is set (the hosted scanner)

   Every store keeps the latest report per site under its slug (example.com is example-com). */
import fs from 'node:fs/promises';
import path from 'node:path';

const valid = slug => typeof slug === 'string' && /^[a-z0-9-]{1,253}$/.test(slug);

export function memoryStore(max = 500) {
  const m = new Map();
  return {
    kind: 'memory',
    async get(slug) { return valid(slug) ? m.get(slug) || null : null; },
    async put(rec) { m.delete(rec.slug); m.set(rec.slug, rec); if (m.size > max) m.delete(m.keys().next().value); return rec; },
    async list(limit = 20) { return [...m.values()].reverse().slice(0, limit).map(entry); },
  };
}

/* What a list of past scans shows: enough to pick one, not the whole report. */
export const entry = r => ({ slug: r.slug, host: r.host, grade: r.grade, verdict: r.verdict, scannedAt: r.scannedAt });
const addTo = (list, rec, max = 200) => [entry(rec), ...(list || []).filter(e => e.slug !== rec.slug)].slice(0, max);

export function fileStore(dir) {
  return {
    kind: 'file',
    async get(slug) {
      if (!valid(slug)) return null;
      try { return JSON.parse(await fs.readFile(path.join(dir, `${slug}.json`), 'utf8')); } catch { return null; }
    },
    async put(rec) {
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, `${rec.slug}.json`), JSON.stringify(rec));
      let idx = []; try { idx = JSON.parse(await fs.readFile(path.join(dir, '_index.json'), 'utf8')); } catch {}
      await fs.writeFile(path.join(dir, '_index.json'), JSON.stringify(addTo(idx, rec)));
      return rec;
    },
    async list(limit = 20) {
      try { return JSON.parse(await fs.readFile(path.join(dir, '_index.json'), 'utf8')).slice(0, limit); } catch { return []; }
    },
  };
}

/* Reports are public pages anyway, so the blob store is public; each read asks for the exact
   version just written (uploadedAt), so the CDN never hands back an older scan. */
export function blobStore(token = process.env.BLOB_READ_WRITE_TOKEN, fetchImpl = fetch) {
  let sdk;
  const lib = async () => (sdk ||= await import('@vercel/blob'));
  const near = memoryStore(200);
  let index = null, indexAt = 0;
  async function readIndex() {
    if (index && Date.now() - indexAt < 30e3) return index;
    try {
      const { head } = await lib();
      const meta = await head('index.json', { token });
      const r = await fetchImpl(`${meta.url}?v=${new Date(meta.uploadedAt).getTime()}`);
      if (r.ok) { index = await r.json(); indexAt = Date.now(); }
    } catch { index ||= []; }
    return index || [];
  }
  return {
    kind: 'blob',
    async get(slug) {
      if (!valid(slug)) return null;
      const hot = await near.get(slug);
      try {
        const { head } = await lib();
        const meta = await head(`reports/${slug}.json`, { token });
        if (hot && new Date(hot.storedAt || 0) >= new Date(meta.uploadedAt)) return hot;
        const r = await fetchImpl(`${meta.url}?v=${new Date(meta.uploadedAt).getTime()}`);
        if (!r.ok) return hot;
        const rec = await r.json(); await near.put(rec); return rec;
      } catch (e) {
        if (!/not.?found/i.test(e?.name + e?.message)) console.error('[store] read', slug, e.message);
        return hot;
      }
    },
    async put(rec) {
      rec = { ...rec, storedAt: new Date().toISOString() };
      await near.put(rec);
      const { put } = await lib();
      const opts = { access: 'public', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json', cacheControlMaxAge: 60, token };
      await put(`reports/${rec.slug}.json`, JSON.stringify(rec), opts);
      // The list of recent scans is one small file, rewritten on each scan. Two scans finishing in
      // the same instant can drop one entry from the list; the reports themselves are never lost.
      index = addTo(await readIndex(), rec);
      indexAt = Date.now();
      try { await put('index.json', JSON.stringify(index), opts); } catch (e) { console.error('[store] index', e.message); }
      return rec;
    },
    async list(limit = 20) { return (await readIndex()).slice(0, limit); },
  };
}

export function storeFromEnv(env = process.env, dir = 'reports') {
  return env.BLOB_READ_WRITE_TOKEN ? blobStore(env.BLOB_READ_WRITE_TOKEN) : fileStore(dir);
}
