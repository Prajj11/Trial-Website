import express from 'express';
import WebTorrent from 'webtorrent';
import cors from 'cors';

const app = express();
const client = new WebTorrent();

app.use(cors());
app.use(express.json());

const activeTorrents = new Map();

// Healthcheck
app.get('/health', (req, res) => res.sendStatus(200));

// Start streaming a magnet link
app.post('/stream', (req, res) => {
    const { magnet } = req.body;
    if (!magnet) return res.status(400).json({ ok: false, error: 'Missing magnet link' });

    client.add(magnet, (torrent) => {
        activeTorrents.set(torrent.infoHash, torrent);

        // Find the largest video file
        const file = torrent.files.find(f => f.name.endsWith('.mp4') || f.name.endsWith('.mkv')) || torrent.files.reduce((a, b) => a.length > b.length ? a : b);
        if (!file) return res.status(404).json({ ok: false, error: 'No video file found in torrent' });

        res.json({
            ok: true,
            infoHash: torrent.infoHash,
            fileName: file.name,
            fileSize: file.length,
            streamUrl: `http://localhost:9411/stream/${torrent.infoHash}/${encodeURIComponent(file.name)}`
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
    if (!torrent) return res.status(404).json({ ok: false, error: 'Torrent not found' });

    res.json({
        ok: true,
        progress: torrent.progress,
        downloadSpeed: torrent.downloadSpeed,
        uploadSpeed: torrent.uploadSpeed,
        numPeers: torrent.numPeers,
        timeRemaining: torrent.timeRemaining
    });
});

// Stop and destroy torrent
app.delete('/stream/:infoHash', (req, res) => {
    const { infoHash } = req.params;
    const torrent = activeTorrents.get(infoHash);
    if (torrent) {
        torrent.destroy(() => {
            activeTorrents.delete(infoHash);
            res.json({ ok: true });
        });
    } else {
        res.json({ ok: true, message: 'Already destroyed' });
    }
});

// HTTP Range proxy for the video stream
app.get('/stream/:infoHash/:filename', (req, res) => {
    const { infoHash, filename } = req.params;
    const torrent = activeTorrents.get(infoHash);
    if (!torrent) return res.status(404).send('Torrent not found');

    const file = torrent.files.find(f => f.name === filename);
    if (!file) return res.status(404).send('File not found');

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
