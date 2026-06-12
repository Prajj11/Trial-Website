/**
 * CineVault — Torrent Stream Server
 * ====================================
 * A lightweight Node.js HTTP server that uses WebTorrent to download
 * torrent pieces from real UDP/TCP peers (like qBittorrent seeders) and
 * streams the video file over HTTP so the browser player can play it.
 *
 * Port: 9411
 *
 * Endpoints:
 *   POST /stream  { magnet: '...' }   → starts streaming, returns { streamUrl, fileUrl }
 *   GET  /stream/:infoHash/:filename  → serves the video file as a stream
 *   GET  /status/:infoHash            → returns download progress info
 *   DELETE /stream/:infoHash          → destroys the torrent and frees memory
 *   GET  /health                      → health check
 */

const http = require('http');
const url = require('url');
const path = require('path');

let WebTorrent;
try {
  WebTorrent = require('webtorrent');
} catch (e) {
  console.error('[TorrentServer] WebTorrent not installed. Run: npm install webtorrent');
  process.exit(1);
}

const PORT = 9411;
const client = new WebTorrent();
const activeTorrents = new Map(); // hex-infoHash → torrent

// ── Global client error handler (registered ONCE at startup) ──────────────
// Must be here — NOT inside per-request handlers — to avoid ERR_HTTP_HEADERS_SENT.
client.on('error', err => {
  console.error('[TorrentServer] WebTorrent client error:', err.message);
});

// ── Decode base32 infoHash → hex (magnets can use either encoding) ─────────
function toHexHash(raw) {
  // If already 40-char hex, lowercase and return
  if (/^[0-9a-f]{40}$/i.test(raw)) return raw.toLowerCase();
  // If 32-char base32 (RFC 4648), convert to hex
  if (/^[A-Z2-7]{32}$/i.test(raw)) {
    const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let bits = '';
    for (const c of raw.toUpperCase()) {
      const idx = ALPHA.indexOf(c);
      if (idx === -1) return null;
      bits += idx.toString(2).padStart(5, '0');
    }
    let hex = '';
    for (let i = 0; i + 8 <= bits.length; i += 8) {
      hex += parseInt(bits.slice(i, i + 8), 2).toString(16).padStart(2, '0');
    }
    return hex;
  }
  return null;
}

// ── CORS helper ────────────────────────────────────────────────────────────
function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// ── JSON response helpers ──────────────────────────────────────────────────
function jsonOk(res, data) {
  setCors(res);
  res.setHeader('Content-Type', 'application/json');
  res.writeHead(200);
  res.end(JSON.stringify(data));
}

function jsonErr(res, code, msg) {
  setCors(res);
  res.setHeader('Content-Type', 'application/json');
  res.writeHead(code);
  res.end(JSON.stringify({ ok: false, error: msg }));
}

// ── Pick the biggest video file in a torrent ───────────────────────────────
function pickVideoFile(torrent) {
  const VIDEO_EXTS = /\.(mp4|mkv|webm|avi|mov|m4v|ts)$/i;
  const videos = torrent.files.filter(f => VIDEO_EXTS.test(f.name));
  if (!videos.length) return null;
  return videos.reduce((a, b) => (a.length > b.length ? a : b));
}

// ── Server request handler ─────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  // Handle preflight
  if (req.method === 'OPTIONS') {
    setCors(res);
    res.writeHead(204);
    res.end();
    return;
  }

  // ── GET /health
  if (req.method === 'GET' && pathname === '/health') {
    return jsonOk(res, { ok: true, activeTorrents: activeTorrents.size, port: PORT });
  }

  // ── POST /stream  { magnet }
  if (req.method === 'POST' && pathname === '/stream') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      let magnet;
      try {
        magnet = JSON.parse(body).magnet;
      } catch (e) {
        return jsonErr(res, 400, 'Invalid JSON body');
      }
      if (!magnet || !magnet.startsWith('magnet:')) {
        return jsonErr(res, 400, 'Missing or invalid magnet link');
      }

      // Extract infoHash from magnet and normalise to 40-char hex
      const hashMatch = magnet.match(/xt=urn:btih:([A-Za-z0-9]{32,40})/i);
      if (!hashMatch) return jsonErr(res, 400, 'Could not extract infoHash from magnet');
      const infoHash = toHexHash(hashMatch[1]);
      if (!infoHash) return jsonErr(res, 400, 'Unrecognised infoHash encoding');

      // ── Reuse existing torrent if already loaded ──────────────────────────
      if (activeTorrents.has(infoHash)) {
        const existing = activeTorrents.get(infoHash);
        const file = pickVideoFile(existing);
        if (!file) return jsonErr(res, 404, 'No video file in cached torrent');
        const fname = encodeURIComponent(file.name);
        return jsonOk(res, {
          ok: true, infoHash,
          streamUrl: `http://localhost:${PORT}/stream/${infoHash}/${fname}`,
          fileName: file.name, fileSize: file.length,
          progress: existing.progress, status: 'cached'
        });
      }

      // ── Also check by the WebTorrent client's own list ────────────────────
      // (catches cases where the hash was added but not yet in our map)
      const existing2 = client.get(infoHash);
      if (existing2) {
        activeTorrents.set(infoHash, existing2);
        const file = pickVideoFile(existing2);
        if (!file) return jsonErr(res, 404, 'No video file in existing torrent');
        const fname = encodeURIComponent(file.name);
        return jsonOk(res, {
          ok: true, infoHash,
          streamUrl: `http://localhost:${PORT}/stream/${infoHash}/${fname}`,
          fileName: file.name, fileSize: file.length,
          progress: existing2.progress, status: 'existing'
        });
      }

      // ── Add new torrent ───────────────────────────────────────────────────
      console.log(`[TorrentServer] Adding torrent: ${infoHash}`);
      let responded = false;

      try {
        client.add(magnet, { path: path.join(__dirname, '.torrent-cache') }, (torrent) => {
          activeTorrents.set(torrent.infoHash, torrent);
          console.log(`[TorrentServer] Metadata ready: ${torrent.name}`);

          const file = pickVideoFile(torrent);
          if (!file) {
            torrent.destroy();
            activeTorrents.delete(torrent.infoHash);
            if (!responded) { responded = true; jsonErr(res, 404, 'No video file found in torrent'); }
            return;
          }

          // Prioritise streaming — only download the video file
          torrent.files.forEach(f => { if (f !== file) f.deselect(); });
          file.select();

          const fname = encodeURIComponent(file.name);
          const streamUrl = `http://localhost:${PORT}/stream/${torrent.infoHash}/${fname}`;
          console.log(`[TorrentServer] Ready to stream: ${streamUrl}`);

          if (!responded) {
            responded = true;
            jsonOk(res, {
              ok: true,
              infoHash: torrent.infoHash,
              streamUrl,
              fileName: file.name,
              fileSize: file.length,
              progress: torrent.progress,
              status: 'ready'
            });
          }

          torrent.on('error', err => {
            console.error(`[TorrentServer] Torrent error (${torrent.infoHash}):`, err.message);
            activeTorrents.delete(torrent.infoHash);
          });
        });
      } catch (addErr) {
        console.error('[TorrentServer] client.add error:', addErr.message);
        if (!responded) { responded = true; jsonErr(res, 500, addErr.message); }
      }
    });
    return;
  }

  // ── GET /stream/:infoHash/:filename  — range-capable HTTP video stream
  const streamMatch = pathname.match(/^\/stream\/([a-f0-9]{40})\/(.+)$/i);
  if (req.method === 'GET' && streamMatch) {
    const [, infoHash, encodedName] = streamMatch;
    const torrent = activeTorrents.get(infoHash.toLowerCase());
    if (!torrent) return jsonErr(res, 404, 'Torrent not found. Call POST /stream first.');

    const fileName = decodeURIComponent(encodedName);
    const file = torrent.files.find(f => f.name === fileName) || pickVideoFile(torrent);
    if (!file) return jsonErr(res, 404, 'Video file not found in torrent');

    const fileSize = file.length;
    const rangeHeader = req.headers.range;

    setCors(res);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', getContentType(file.name));

    if (rangeHeader) {
      const [startStr, endStr] = rangeHeader.replace(/bytes=/, '').split('-');
      const start = parseInt(startStr, 10);
      const end = endStr ? parseInt(endStr, 10) : Math.min(start + 1024 * 1024 - 1, fileSize - 1);
      const chunkSize = end - start + 1;

      res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
      res.setHeader('Content-Length', chunkSize);
      res.writeHead(206);
      const stream = file.createReadStream({ start, end });
      stream.pipe(res);
      stream.on('error', err => { console.error('[TorrentServer] Stream error:', err.message); res.end(); });
    } else {
      res.setHeader('Content-Length', fileSize);
      res.writeHead(200);
      const stream = file.createReadStream();
      stream.pipe(res);
      stream.on('error', err => { console.error('[TorrentServer] Stream error:', err.message); res.end(); });
    }
    return;
  }

  // ── GET /status/:infoHash
  const statusMatch = pathname.match(/^\/status\/([a-f0-9]{40})$/i);
  if (req.method === 'GET' && statusMatch) {
    const torrent = activeTorrents.get(statusMatch[1].toLowerCase());
    if (!torrent) return jsonErr(res, 404, 'Torrent not found');
    return jsonOk(res, {
      ok: true,
      name: torrent.name,
      infoHash: torrent.infoHash,
      progress: Math.round(torrent.progress * 10000) / 100,
      downloadSpeed: torrent.downloadSpeed,
      uploadSpeed: torrent.uploadSpeed,
      numPeers: torrent.numPeers,
      downloaded: torrent.downloaded,
      total: torrent.length,
      timeRemaining: torrent.timeRemaining
    });
  }

  // ── DELETE /stream/:infoHash
  const deleteMatch = pathname.match(/^\/stream\/([a-f0-9]{40})$/i);
  if (req.method === 'DELETE' && deleteMatch) {
    const hash = deleteMatch[1].toLowerCase();
    const torrent = activeTorrents.get(hash);
    if (!torrent) return jsonErr(res, 404, 'Torrent not found');
    torrent.destroy(() => {
      activeTorrents.delete(hash);
      console.log(`[TorrentServer] Destroyed torrent: ${hash}`);
      jsonOk(res, { ok: true, message: 'Torrent destroyed' });
    });
    return;
  }

  // 404
  jsonErr(res, 404, 'Unknown endpoint');
});

// ── Mime types ─────────────────────────────────────────────────────────────
function getContentType(filename) {
  const ext = path.extname(filename).toLowerCase();
  const types = { '.mp4': 'video/mp4', '.mkv': 'video/x-matroska', '.webm': 'video/webm', '.avi': 'video/x-msvideo', '.mov': 'video/quicktime', '.ts': 'video/mp2t' };
  return types[ext] || 'application/octet-stream';
}

// ── Start ──────────────────────────────────────────────────────────────────
server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n╔═══════════════════════════════════════════╗`);
  console.log(`║   CineVault Torrent Stream Server         ║`);
  console.log(`║   Listening on http://localhost:${PORT}      ║`);
  console.log(`╚═══════════════════════════════════════════╝\n`);
});

server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[TorrentServer] Port ${PORT} already in use.`);
  } else {
    console.error('[TorrentServer] Server error:', err);
  }
  process.exit(1);
});

process.on('SIGINT', () => {
  console.log('\n[TorrentServer] Shutting down...');
  client.destroy(() => process.exit(0));
});
