// Optional end-to-end check: locally seed the Blender Sintel trailer from W3C.
// Download it to .test-media/trailer.mp4 first. Stop this helper after checking.
import WebTorrent from 'webtorrent';
import { writeFileSync } from 'node:fs';
const client = new WebTorrent({ utp: false, dht: false, tracker: false, lsd: false, natUpnp: false, natPmp: false });
client.on('error', err => { console.error(err.message); process.exitCode = 1; });
client.seed('.test-media/trailer.mp4', { announce: [] }, async torrent => {
  const magnet = torrent.magnetURI + '&x.pe=127.0.0.1:' + client.torrentPort;
  writeFileSync('.test-media/magnet.txt', magnet);
  console.log('Local trailer seed ready. Magnet saved in .test-media/magnet.txt');
  const response = await fetch('http://127.0.0.1:8090/api/torrent-stream/start', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ magnet })
  });
  const data = await response.json();
  if (!data.ok) { console.error(data.error); client.destroy(); return; }
  writeFileSync('.test-media/session.json', JSON.stringify(data));
  const video = await fetch('http://127.0.0.1:8090' + data.streamUrl, { headers: { Range: 'bytes=0-1023' } });
  console.log('Playback endpoint:', video.status, (await video.arrayBuffer()).byteLength, 'bytes', video.headers.get('content-type'));
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => client.destroy(() => process.exit(0)));
