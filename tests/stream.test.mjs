import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { createApp, parseRange } from '../torrent-stream-server.js';
import WebTorrent from 'webtorrent';

test('ranges support seeking, suffixes and reject invalid requests', () => {
  assert.deepEqual(parseRange('bytes=2-5', 10), { start: 2, end: 5 });
  assert.deepEqual(parseRange('bytes=-3', 10), { start: 7, end: 9 });
  assert.deepEqual(parseRange('bytes=5-', 10), { start: 5, end: 9 });
  assert.deepEqual(parseRange('bytes=2-99', 10), { start: 2, end: 9 });
  for (const value of ['bytes=10-', 'bytes=5-2', 'bytes=-0', 'bytes=-', 'bytes=0-1,4-5', 'wat'])
    assert.equal(parseRange(value, 10), false);
});

async function serve(t, client, options) {
  const app = createApp(client, options);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { app.locals.cleanup(); server.closeAllConnections(); await new Promise(r => server.close(r)); });
  return `http://127.0.0.1:${server.address().port}`;
}
const hash = 'a'.repeat(40);
const magnet = 'magnet:?xt=urn:btih:' + hash;
const post = (url, value) => fetch(url + '/stream', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ magnet: value }) });

test('video requests preserve bytes, mime type, filenames, status and HEAD', async t => {
  const client = new EventEmitter();
  const torrent = new EventEmitter();
  Object.assign(torrent, { ready: true, infoHash: hash, progress: 0.5, destroy() { this.destroyed = true; },
    files: [{ name: 'sample.mp4', length: 2, createReadStream: () => Readable.from(['ab']) },
      { name: 'main movie.webm', length: 10, createReadStream: ({ start = 0, end = 9 }) => Readable.from([Buffer.from('0123456789').subarray(start, end + 1)]) }] });
  client.get = async () => torrent;
  const base = await serve(t, client);
  assert.equal((await post(base, 'not a magnet')).status, 400);
  const started = await (await post(base, magnet)).json();
  assert.equal(started.fileIndex, 1);
  assert.equal(started.mimeType, 'video/webm');
  const url = base + started.streamUrl;
  const range = await fetch(url, { headers: { Range: 'bytes=-3' } });
  assert.equal(range.status, 206); assert.equal(await range.text(), '789');
  assert.equal(range.headers.get('content-range'), 'bytes 7-9/10');
  assert.equal((await fetch(url, { headers: { Range: 'bytes=99-' } })).status, 416);
  const head = await fetch(url, { method: 'HEAD' });
  assert.equal(head.headers.get('content-length'), '10'); assert.equal(await head.text(), '');
  const download = await fetch(url + '?download=1');
  assert.match(download.headers.get('content-disposition'), /attachment.*main movie.webm/);
  assert.equal(await download.text(), '0123456789');
  assert.equal((await (await fetch(base + '/status/' + hash)).json()).progress, 0.5);
  await fetch(base + '/stream/' + hash, { method: 'DELETE' });
  assert.equal((await fetch(url)).status, 404);
});

test('concurrent starts share metadata lookup; dead swarms time out', async t => {
  const client = new EventEmitter(); let adds = 0;
  client.get = async () => null;
  client.add = () => { adds++; const torrent = new EventEmitter(); torrent.destroy = () => { torrent.destroyed = true; }; return torrent; };
  const base = await serve(t, client, { metadataTimeout: 30 });
  const results = await Promise.all([post(base, magnet), post(base, magnet)]);
  assert.equal(adds, 1);
  for (const res of results) { assert.equal(res.status, 504); assert.match((await res.json()).error, /metadata/); }
});

test('real WebTorrent file can be streamed and downloaded with seek ranges', { timeout: 20000 }, async t => {
  const client = new WebTorrent({ dht: false, tracker: false, lsd: false, natUpnp: false, natPmp: false });
  t.after(() => new Promise(resolve => client.destroy(resolve)));
  const content = Buffer.from('test video bytes: 0123456789'); content.name = 'fixture.mp4';
  const torrent = await new Promise((resolve, reject) => { client.once('error', reject); client.seed(content, { name: 'fixture.mp4', announce: [] }, resolve); });
  const base = await serve(t, client);
  const started = await (await post(base, torrent.magnetURI)).json();
  assert.equal(started.ok, true);
  const response = await fetch(base + started.streamUrl, { headers: { Range: 'bytes=5-10' } });
  assert.equal(response.status, 206);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), content.subarray(5, 11));
});
