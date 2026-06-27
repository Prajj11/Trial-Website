import express from 'express';
import WebTorrent from 'webtorrent';
import cors from 'cors';

const app = express();
const client = new WebTorrent();

app.use(cors());
app.use(express.json());

const activeTorrents = new Map();
// Track last access time for each torrent to enable idle cleanup
const torrentLastAccess = new Map();

const IDLE_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

// --- Idle Reaper ---
// Periodically destroys torrents that haven't been accessed in 15 minutes.
// Without this, torrents stay seeding in memory/disk indefinitely if a user
// closes their browser without triggering the DELETE endpoint.
const reaperInterval = setInterval(() => {
    const now = Date.now();
    for (const [infoHash, lastAccess] of torrentLastAccess.entries()) {
        if (now - lastAccess > IDLE_TIMEOUT_MS) {
            const torrent = activeTorrents.get(infoHash);
            if (torrent) {
                console.log(`[Reaper] Destroying idle torrent: ${infoHash} (idle ${Math.round((now - lastAccess) / 1000)}s)`);
                activeTorrents.delete(infoHash);
                torrentLastAccess.delete(infoHash);
                try {
                    torrent.destroy();
                } catch (e) {
                    console.error('Error destroying torrent:', e);
                }
            } else {
                torrentLastAccess.delete(infoHash);
            }
        }
    }
}, 60 * 1000); // Check every 60 seconds

// --- Graceful shutdown ---
// Destroy all active torrents on SIGINT so we don't leave orphaned downloads.
process.on('SIGINT', () => {
    console.log('\n[Shutdown] Cleaning up active torrents...');
    clearInterval(reaperInterval);
    const promises = [];
    for (const [infoHash, torrent] of activeTorrents.entries()) {
        promises.push(new Promise(resolve => {
            torrent.destroy(() => {
                console.log(`  Destroyed: ${infoHash}`);
                resolve();
            });
        }));
    }
    Promise.all(promises).then(() => {
        console.log('[Shutdown] All torrents cleaned up.');
        process.exit(0);
    });
    // Force exit after 5s if cleanup hangs
    setTimeout(() => process.exit(1), 5000);
});

// Healthcheck
app.get('/health', (req, res) => res.sendStatus(200));

// Start streaming a magnet link
app.post('/stream', (req, res) => {
    const { magnet } = req.body;
    if (!magnet) return res.status(400).json({ ok: false, error: 'Missing magnet link' });

    client.add(magnet, (torrent) => {
        activeTorrents.set(torrent.infoHash, torrent);
        torrentLastAccess.set(torrent.infoHash, Date.now());

        // Find the largest video file
        const file = torrent.files.find(f => f.name.endsWith('.mp4') || f.name.endsWith('.mkv')) || torrent.files.reduce((a, b) => a.length > b.length ? a : b);
        if (!file) return res.status(404).json({ ok: false, error: 'No video file found in torrent' });

        // Derive the stream URL from the request's Host header so the URL
        // works when accessed from other devices on the network (e.g. a phone).
        // Falls back to localhost:PORT only if no Host header is present.
        const host = req.headers.host || `localhost:${PORT}`;
        const protocol = req.protocol || 'http';

        res.json({
            ok: true,
            infoHash: torrent.infoHash,
            fileName: file.name,
            fileSize: file.length,
            streamUrl: `${protocol}://${host}/stream/${torrent.infoHash}/${encodeURIComponent(file.name)}`
        });
    });

    client.on('error', (err) => {
        console.error('WebTorrent Error:', err);
    });
});

// Get torrent status
app.get('/status/:infoHash', (req, res) => {
    const { infoHash } = req.params;
    const torrent = activeTorrents.get(infoHash);
    if (!torrent || torrent.destroyed) return res.status(404).json({ ok: false, error: 'Torrent not found' });

    // Update last access time on status check
    torrentLastAccess.set(infoHash, Date.now());

    try {
        res.json({
            ok: true,
            progress: torrent.progress,
            downloadSpeed: torrent.downloadSpeed,
            uploadSpeed: torrent.uploadSpeed,
            numPeers: torrent.numPeers,
            timeRemaining: torrent.timeRemaining
        });
    } catch (e) {
        res.status(500).json({ ok: false, error: 'Failed to read torrent status' });
    }
});

// Stop and destroy torrent
app.delete('/stream/:infoHash', (req, res) => {
    const { infoHash } = req.params;
    const torrent = activeTorrents.get(infoHash);
    if (torrent) {
        activeTorrents.delete(infoHash);
        torrentLastAccess.delete(infoHash);
        try {
            torrent.destroy(() => {
                res.json({ ok: true });
            });
        } catch (e) {
            res.json({ ok: false, error: e.message });
        }
    } else {
        torrentLastAccess.delete(infoHash);
        res.json({ ok: true, message: 'Already destroyed' });
    }
});

// HTTP Range proxy for the video stream
app.get('/stream/:infoHash/:filename', (req, res) => {
    const { infoHash, filename } = req.params;
    const torrent = activeTorrents.get(infoHash);
    if (!torrent || torrent.destroyed) return res.status(404).send('Torrent not found');

    const file = torrent.files.find(f => f.name === filename);
    if (!file) return res.status(404).send('File not found');

    // Update last access time on every stream request
    torrentLastAccess.set(infoHash, Date.now());

    const range = req.headers.range;
    if (!range) {
        res.writeHead(200, {
            'Content-Length': file.length,
            'Content-Type': 'video/mp4'
        });
        const stream = file.createReadStream();
        stream.pipe(res).on('error', (err) => {
            // Ignore premature close errors (client disconnected)
        });
        return;
    }

    const positions = range.replace(/bytes=/, "").split("-");
    const start = parseInt(positions[0], 10);
    const end = positions[1] ? parseInt(positions[1], 10) : file.length - 1;
    const chunksize = (end - start) + 1;

    res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${file.length}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': 'video/mp4'
    });

    const stream = file.createReadStream({ start, end });
    stream.pipe(res).on('error', (err) => {
        // Ignore premature close errors (client disconnected)
    });
});

const PORT = 9411;
app.listen(PORT, () => {
    console.log(`Torrent Stream Server running on http://localhost:${PORT}`);
});

