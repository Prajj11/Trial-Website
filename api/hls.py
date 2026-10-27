"""Rewrite master/media playlists, encryption keys and initialization segments."""
import re
from urllib.parse import urljoin, urlencode, urlparse

def rewrite_manifest(content, base, referer=''):
    if not content.lstrip().startswith('#EXTM3U'):
        raise ValueError('The provider did not return an HLS playlist.')
    def proxy(uri, playlist=False):
        absolute = urljoin(base, uri)
        if urlparse(absolute).scheme not in ('http', 'https'):
            raise ValueError('Unsupported playlist URL.')
        route = 'manifest' if playlist or urlparse(absolute).path.endswith('.m3u8') else 'segment'
        return '/api/proxy/hls/' + route + '?' + urlencode({'url': absolute, 'referer': referer})
    lines = []
    variant = False
    for raw in content.splitlines():
        line = raw.strip()
        if line and not line.startswith('#'):
            line = proxy(line, variant)
            variant = False
        elif line.startswith('#'):
            playlist = line.startswith(('#EXT-X-MEDIA:', '#EXT-X-I-FRAME-STREAM-INF:', '#EXT-X-RENDITION-REPORT:'))
            line = re.sub(r'URI="([^"]+)"', lambda m: 'URI="' + proxy(m[1], playlist) + '"', line)
            if line.startswith('#EXT-X-STREAM-INF:'):
                variant = True
        lines.append(line)
    return '\n'.join(lines) + '\n'
