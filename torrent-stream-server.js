import express from 'express';
import WebTorrent from 'webtorrent';
import { pathToFileURL } from 'node:url';

export function parseRange(header, size) {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2])) return false;
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] ? (match[2] ? Math.min(Number(match[2]), size - 1) : size - 1) : size - 1;
  return Number.isSafeInteger(start) && Number.isSafeInteger(end) && start <= end && start < size
    ? { start, end } : false;
}
function mime(name) {
  return ({ mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mkv: 'video/x-matroska',
    avi: 'video/x-msvideo', mov: 'video/quicktime' })[name.split('.').pop().toLowerCase()] || 'application/octet-stream';
}
export function createApp(client, { metadataTimeout = 25000 } = {}) {
  const app = express();
  app.use(express.json({ limit: '32kb' }));
  const active = new Map();
  const pending = new Map();
  client.on('error', err => console.error('Torrent client:', err.message));
  const reaper = setInterval(() => {
    for (const [hash, entry] of active) {
      if (!entry.readers && Date.now() - entry.access > 15 * 60 * 1000) {
        active.delete(hash);
        entry.torrent.destroy();
      }
    }
  }, 60000);
  reaper.unref();
  app.locals.cleanup = () => clearInterval(reaper);
  app.get('/health', (req, res) => res.json({ ok: true }));
  app.post('/stream', async (req, res) => {
    const magnet = req.body?.magnet;
    if (typeof magnet !== 'string' || !/^magnet:\?/i.test(magnet))
      return res.status(400).json({ ok: false, error: 'Enter a valid magnet link.' });
    const hash = new URLSearchParams(magnet.slice(magnet.indexOf('?') + 1)).getAll('xt')
      .map(x => /^urn:btih:([a-f\d]{40}|[a-z2-7]{32})$/i.exec(x)?.[1]).find(Boolean);
    if (!hash) return res.status(400).json({ ok: false, error: 'Magnet link needs a valid BitTorrent info hash.' });
    const key = hash.toLowerCase();
    try {
      if (!pending.has(key)) {
        const ready = (async () => {
          let torrent = await client.get(magnet);
          if (torrent?.ready) return torrent;
          if (!torrent) torrent = client.add(magnet);
          return await new Promise((resolve, reject) => {
            const done = err => {
              clearTimeout(timer);
              torrent.off('ready', onReady);
              torrent.off('error', onError);
              if (err) {
                if (!torrent.destroyed) torrent.destroy();
                reject(err);
              } else resolve(torrent);
            };
            const onReady = () => done();
            const onError = err => done(err);
            const timer = setTimeout(() => done(new Error('No torrent metadata received. Try a release with active peers.')), metadataTimeout);
            torrent.once('ready', onReady);
            torrent.once('error', onError);
          });
        })();
        pending.set(key, ready);
        ready.finally(() => pending.delete(key)).catch(() => {});
      }
      const torrent = await pending.get(key);
      const files = torrent.files.filter(f => /\.(mp4|m4v|webm|mkv|avi|mov)$/i.test(f.name));
      files.sort((a, b) => b.length - a.length);
      const file = files[0];
      if (!file) {
        torrent.destroy();
        return res.status(422).json({ ok: false, error: 'This torrent contains no supported video files.' });
      }
      const previous = active.get(torrent.infoHash);
      active.set(torrent.infoHash, { torrent, access: Date.now(), readers: previous?.readers || 0 });
      const index = torrent.files.indexOf(file);
      res.json({ ok: true, infoHash: torrent.infoHash, fileName: file.name, fileIndex: index,
        fileSize: file.length, mimeType: mime(file.name), browserCompatible: /\.(mp4|m4v|webm)$/i.test(file.name),
        streamUrl: `/stream/${torrent.infoHash}/${index}` });
    } catch (err) { res.status(504).json({ ok: false, error: err.message }); }
  });
  app.get('/status/:hash', (req, res) => {
    const entry = active.get(req.params.hash);
    if (!entry || entry.torrent.destroyed) return res.status(404).json({ ok: false, error: 'Torrent session ended.' });
    entry.access = Date.now();
    const t = entry.torrent;
    res.json({ ok: true, progress: t.progress, downloadSpeed: t.downloadSpeed,
      uploadSpeed: t.uploadSpeed, numPeers: t.numPeers, timeRemaining: Number.isFinite(t.timeRemaining) ? t.timeRemaining : null });
  });
  app.delete('/stream/:hash', (req, res) => {
    const entry = active.get(req.params.hash);
    active.delete(req.params.hash);
    if (entry && !entry.torrent.destroyed) entry.torrent.destroy();
    res.json({ ok: true });
  });
  app.get('/stream/:hash/:file', (req, res) => {
    const entry = active.get(req.params.hash);
    if (!entry || entry.torrent.destroyed) return res.status(404).end();
    const file = /^\d+$/.test(req.params.file) ? entry.torrent.files[Number(req.params.file)]
      : entry.torrent.files.find(f => f.name === req.params.file);
    if (!file) return res.status(404).end();
    entry.access = Date.now();
    const range = parseRange(req.headers.range, file.length);
    res.set('Accept-Ranges', 'bytes');
    if (range === false) return res.status(416).set('Content-Range', `bytes */${file.length}`).end();
    res.type(mime(file.name));
    if (req.query.download === '1') res.attachment(file.name);
    res.set('Content-Length', String(range ? range.end - range.start + 1 : file.length));
    if (range) res.status(206).set('Content-Range', `bytes ${range.start}-${range.end}/${file.length}`);
    if (req.method === 'HEAD') return res.end();
    const stream = file.createReadStream(range || {});
    entry.readers++;
    res.once('close', () => { entry.readers--; entry.access = Date.now(); stream.destroy(); });
    stream.once('error', err => { if (!res.headersSent) res.status(502).end(); else res.destroy(err); });
    stream.pipe(res);
  });
  app.use((err, req, res, next) => res.status(400).json({ ok: false, error: 'Invalid request body.' }));
  return app;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // TCP is more reliable than native uTP on Windows and restricted networks.
  const client = new WebTorrent({ utp: false });
  const app = createApp(client);
  const server = app.listen(Number(process.env.TORRENT_PORT || 9411), '127.0.0.1', () => console.log('Torrent helper ready'));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
    app.locals.cleanup(); server.close(); client.destroy(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  });
}
