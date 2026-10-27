import unittest
from unittest.mock import patch, Mock
from api.hls import rewrite_manifest
from server import app

class ApiTests(unittest.TestCase):
    def setUp(self): self.client = app.test_client()

    def test_nested_manifest_and_uri_attributes(self):
        result = rewrite_manifest('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=10\nlow/playlist?token=a&b=c\n#EXT-X-MEDIA:TYPE=AUDIO,URI="audio.m3u8"\n', 'https://cdn.example/master.m3u8')
        self.assertIn('/manifest?url=https%3A%2F%2Fcdn.example%2Flow%2Fplaylist%3Ftoken%3Da%26b%3Dc', result)
        self.assertIn('/manifest?url=https%3A%2F%2Fcdn.example%2Faudio.m3u8', result)
        media = rewrite_manifest('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXT-X-MAP:URI="init.mp4"\npart.ts\n', 'https://cdn.example/sub/media.m3u8')
        self.assertEqual(media.count('/segment?'), 3)
        with self.assertRaises(ValueError): rewrite_manifest('<html>Blocked</html>', 'https://example.com')

    def test_nyaa_infohash_without_magnet_field(self):
        xml = b'<rss xmlns:nyaa="https://nyaa.si/xmlns/nyaa"><channel><item><title>Example - 01 [720p]</title><nyaa:infoHash>aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa</nyaa:infoHash><nyaa:seeders>2</nyaa:seeders></item></channel></rss>'
        response = Mock(status_code=200, content=xml, headers={'Content-Type':'application/xml'})
        with patch('api.torrent.requests.get', return_value=response):
            data = self.client.get('/api/nyaa/search?q=test-fixture&ep=1').get_json()
        self.assertEqual(len(data['results']), 1)
        self.assertTrue(data['results'][0]['magnet'].startswith('magnet:?xt=urn:btih:'))
        self.assertEqual(self.client.get('/api/nyaa/search?q=x&limit=bad').status_code, 400)

    def test_yts_does_not_download_wrong_title(self):
        response = Mock()
        response.json.return_value = {'data': {'movies': [{'title':'Unrelated','year':2000}]}}
        with patch('api.torrent.requests.get', return_value=response):
            result = self.client.get('/api/yts/search?title=Expected-fixture&year=2000')
        self.assertEqual(result.status_code, 404)

    def test_stream_start_preserves_failure_and_index(self):
        response = Mock(status_code=504)
        response.json.return_value = {'ok':False,'error':'No peers'}
        with patch('server._torrent_server_available', return_value=True), patch('server.requests.post', return_value=response):
            self.assertEqual(self.client.post('/api/torrent-stream/start',json={'magnet':'magnet:test'}).status_code,504)
        response.status_code = 200
        response.json.return_value = {'ok':True,'infoHash':'a'*40,'fileName':'video.mp4','fileIndex':2}
        with patch('server._torrent_server_available', return_value=True), patch('server.requests.post', return_value=response):
            data = self.client.post('/api/torrent-stream/start',json={'magnet':'magnet:test'}).get_json()
        self.assertTrue(data['streamUrl'].endswith('/2'))
        self.assertTrue(data['downloadUrl'].endswith('?download=1'))

if __name__ == '__main__': unittest.main()
