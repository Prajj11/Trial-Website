"""
CineVault — Torrent Stream Engine
===================================
Provides magnet links from Nyaa (anime) and YTS (movies) for in-browser
WebTorrent.js streaming. Also handles subtitle conversion SRT/ASS → WebVTT.

Endpoints:
  GET  /api/torrent/trackers      — WSS + UDP tracker list for WebTorrent
  GET  /api/nyaa/search           — Search Nyaa.si RSS for anime torrents
  GET  /api/yts/search            — Search YTS for movie torrents
  POST /api/subtitle/convert      — Convert SRT/ASS text → WebVTT
"""

import time
import re as _re
import xml.etree.ElementTree as ET
import requests
from flask import Blueprint, request, jsonify

torrent_bp = Blueprint('torrent', __name__)

# ── Cache ───────────────────────────────────────────────────────────────────
_cache: dict = {}
_CACHE_TTL = 300  # 5 minutes

# ── Trackers ─────────────────────────────────────────────────────────────────
# WSS = WebRTC trackers (work in browser), UDP = standard (webtorrent-hybrid)
WSS_TRACKERS = [
    'wss://tracker.btorrent.xyz',
    'wss://tracker.openwebtorrent.com',
    'wss://tracker.webtorrent.dev',
    'wss://tracker.files.fm:7073/announce',
]
UDP_TRACKERS = [
    'udp://tracker.opentrackr.org:1337/announce',
    'udp://open.demonii.com:1337/announce',
    'udp://tracker.openbittorrent.com:6969',
    'udp://p4p.arenabg.com:1337',
    'udp://tracker.leechers-paradise.org:6969',
    'udp://tracker.coppersurfer.tk:6969',
]


def _enrich_magnet(magnet: str) -> str:
    """Append WSS and UDP trackers to a magnet URI."""
    extra = ''
    for t in WSS_TRACKERS + UDP_TRACKERS:
        enc = requests.utils.quote(t, safe='')
        if enc not in magnet:
            extra += f'&tr={enc}'
    return magnet + extra


# ── /api/torrent/trackers ────────────────────────────────────────────────────
@torrent_bp.route('/api/torrent/trackers', methods=['GET'])
def get_trackers():
    return jsonify({'ok': True, 'wss': WSS_TRACKERS, 'udp': UDP_TRACKERS})


# ── /api/nyaa/search ─────────────────────────────────────────────────────────
# Nyaa.si sometimes blocks server IPs. We try multiple mirrors in order.
NYAA_MIRRORS = [
    'https://nyaa.si',
    'https://nyaa.land',
    'https://nyaa.ink',
]

@torrent_bp.route('/api/nyaa/search', methods=['GET'])
def nyaa_search():
    """
    Search Nyaa.si anime torrents via RSS.
    Query params: q, ep, quality, limit
    """
    q = request.args.get('q', '').strip()
    ep = request.args.get('ep', '').strip()
    quality = request.args.get('quality', '').strip()
    limit = min(12, max(1, int(request.args.get('limit', 8))))

    if not q:
        return jsonify({'ok': False, 'error': 'Missing q'}), 400

    search_q = q
    if ep and ep.isdigit():
        search_q += f' {ep.zfill(2)}'

    cache_key = f'nyaa:{search_q}:{quality}:{limit}'
    now = time.time()
    if cache_key in _cache:
        data, ts = _cache[cache_key]
        if now - ts < _CACHE_TTL:
            return jsonify(data)

    _NYAA_HEADERS = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'application/rss+xml, text/xml, application/xml, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'DNT': '1',
    }

    last_err = None
    resp = None
    for mirror in NYAA_MIRRORS:
        rss_url = f"{mirror}/?page=rss&q={requests.utils.quote(search_q)}&c=1_2&f=0"
        try:
            r = requests.get(rss_url, timeout=14, headers=_NYAA_HEADERS)
            if r.status_code == 200:
                # Make sure it's actually XML, not a Cloudflare/HTML block page
                ct = r.headers.get('Content-Type', '')
                if 'xml' in ct or r.content[:5] in (b'<?xml', b'<rss '):
                    resp = r
                    break
                else:
                    last_err = f'{mirror} returned HTML (blocked)'
            else:
                last_err = f'HTTP {r.status_code} from {mirror}'
        except Exception as ex:
            last_err = str(ex)

    if resp is None:
        return jsonify({'ok': False, 'error': f'All Nyaa mirrors failed. Last: {last_err}'}), 502

    try:
        resp.raise_for_status()
        root = ET.fromstring(resp.content)
        ns = {'nyaa': 'https://nyaa.si/xmlns/nyaa'}
        items = root.findall('.//item')

        results = []
        for item in items:
            title = item.findtext('title') or ''
            link = item.findtext('link') or ''

            m_el = item.find('nyaa:magnetUri', ns)
            magnet = m_el.text if m_el is not None else ''
            if not magnet:
                continue
            magnet = _enrich_magnet(magnet)

            def _int(el):
                return int(el.text) if el is not None and el.text else 0

            seeders = _int(item.find('nyaa:seeders', ns))
            leechers = _int(item.find('nyaa:leechers', ns))
            sz_el = item.find('nyaa:size', ns)
            size = sz_el.text if sz_el is not None else 'Unknown'
            tr_el = item.find('nyaa:trusted', ns)
            trusted = (tr_el is not None and tr_el.text == 'Yes')

            # Detect quality tag
            detected_q = 'Unknown'
            for qt in ['2160p', '4K', '1080p', '720p', '480p', '360p']:
                if qt.lower() in title.lower():
                    detected_q = qt
                    break

            # Detect episode number
            ep_m = _re.search(r'[-\s_\[](\d{2,3})[-\s_\]\(v]', title)
            detected_ep = int(ep_m.group(1)) if ep_m else None

            results.append({
                'title': title,
                'magnet': magnet,
                'seeders': seeders,
                'leechers': leechers,
                'size': size,
                'quality': detected_q,
                'episode': detected_ep,
                'trusted': trusted,
                'link': link,
            })

        # Sort: trusted first, then most seeders
        results.sort(key=lambda x: (not x['trusted'], -x['seeders']))

        # Filter by episode
        if ep and ep.isdigit():
            ep_int = int(ep)
            ef = [r for r in results if r['episode'] == ep_int]
            if ef:
                results = ef

        # Filter by quality
        if quality:
            qf = [r for r in results if quality.lower() in r['quality'].lower()]
            if qf:
                results = qf

        results = results[:limit]
        out = {'ok': True, 'results': results, 'total': len(results), 'query': search_q}
        _cache[cache_key] = (out, now)
        return jsonify(out)

    except ET.ParseError as exc:
        return jsonify({'ok': False, 'error': f'RSS parse error: {exc}'}), 502
    except Exception as exc:
        print(f'[Nyaa] Error: {exc}')
        return jsonify({'ok': False, 'error': str(exc)}), 500


# ── /api/1337x/search ────────────────────────────────────────────────────────
# 1337x is fully Cloudflare-protected (JS challenge), so we use BTDIG (DHT search)
# and AnimeTosho as alternative scraping-friendly sources.
# BTDIG = BitTorrent DHT crawler — finds magnets without anti-scraping.

_TORRENT_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
}


def _search_btdig(query: str) -> str:
    """Search BTDIG DHT index and return a magnet link or None."""
    try:
        url = f'https://btdig.com/search?q={requests.utils.quote(query)}&p=0&order=0'
        r = requests.get(url, timeout=14, headers=_TORRENT_HEADERS)
        if r.status_code != 200:
            return None
        # Extract info hash from search results
        hashes = _re.findall(r'/([a-f0-9]{40})(?:\?|"|\'|\s)', r.text, _re.IGNORECASE)
        if not hashes:
            return None
        ih = hashes[0].lower()
        return _enrich_magnet(f'magnet:?xt=urn:btih:{ih}&dn={requests.utils.quote(query)}')
    except Exception as ex:
        print(f'[BTDIG] Error: {ex}')
        return None


def _search_animetosho(query: str) -> str:
    """Search AnimeTosho JSON API and return a magnet link or None."""
    try:
        url = f'https://feed.animetosho.org/json?search={requests.utils.quote(query)}&qx=1'
        r = requests.get(url, timeout=14, headers=_TORRENT_HEADERS)
        if r.status_code != 200:
            return None
        items = r.json()
        if not items:
            return None
        for item in items:
            magnet = item.get('magnet_uri', '')
            if magnet:
                return _enrich_magnet(magnet)
        return None
    except Exception as ex:
        print(f'[AnimeTosho] Error: {ex}')
        return None


@torrent_bp.route('/api/1337x/search', methods=['GET'])
def search_1337x():
    """
    Multi-engine anime torrent search.
    Tries AnimeTosho JSON API first, then BTDIG DHT.
    Query params: q, ep
    """
    q = request.args.get('q', '').strip()
    ep = request.args.get('ep', '').strip()

    if not q:
        return jsonify({'ok': False, 'error': 'Missing q'}), 400

    search_q = q
    if ep and ep.isdigit():
        search_q += f' {ep.zfill(2)}'

    cache_key = f'torrent_multi:{search_q}'
    now = time.time()
    if cache_key in _cache:
        data, ts = _cache[cache_key]
        if now - ts < _CACHE_TTL:
            return jsonify(data)

    # Try AnimeTosho first (has a proper JSON API)
    magnet = _search_animetosho(search_q)
    source = 'animetosho'

    # Fall back to BTDIG DHT search
    if not magnet:
        magnet = _search_btdig(search_q)
        source = 'btdig'

    if not magnet:
        out = {'ok': True, 'results': [], 'total': 0, 'error': 'No results from AnimeTosho or BTDIG'}
        _cache[cache_key] = (out, now)
        return jsonify(out)

    out = {
        'ok': True,
        'results': [{'title': search_q, 'magnet': magnet, 'source': source}],
        'total': 1,
    }
    _cache[cache_key] = (out, now)
    return jsonify(out)


# ── /api/yts/search ──────────────────────────────────────────────────────────
@torrent_bp.route('/api/yts/search', methods=['GET'])
def yts_search():
    """
    Search YTS for movie torrents.
    Query params: title, year, quality
    """
    title = request.args.get('title', '').strip()
    year = request.args.get('year', '').strip()
    quality_filter = request.args.get('quality', '').strip()

    if not title:
        return jsonify({'ok': False, 'error': 'Missing title'}), 400

    cache_key = f'yts:{title}:{year}:{quality_filter}'
    now = time.time()
    if cache_key in _cache:
        data, ts = _cache[cache_key]
        if now - ts < _CACHE_TTL * 2:
            return jsonify(data)

    try:
        resp = requests.get(
            'https://yts.mx/api/v2/list_movies.json',
            params={'query_term': title, 'limit': 5, 'sort_by': 'download_count'},
            timeout=10,
            headers={'Accept': 'application/json'},
        )
        resp.raise_for_status()
        movies = (resp.json().get('data') or {}).get('movies') or []
        if not movies:
            return jsonify({'ok': False, 'error': 'No movies found on YTS'}), 404

        best = next(
            (m for m in movies
             if m.get('title', '').lower() == title.lower()
             and (not year or str(m.get('year', '')) == year)),
            movies[0]
        )

        QORD = {'2160p': 0, '1080p': 1, '720p': 2, '480p': 3}
        qualities = []
        for t in (best.get('torrents') or []):
            dn = requests.utils.quote(best.get('title_long') or best.get('title') or title)
            magnet = _enrich_magnet(f"magnet:?xt=urn:btih:{t['hash']}&dn={dn}")
            qualities.append({
                'quality': t.get('quality', 'unknown'),
                'type': t.get('type', 'bluray'),
                'size': t.get('size', 'Unknown'),
                'size_bytes': t.get('size_bytes', 0),
                'seeds': t.get('seeds', 0),
                'peers': t.get('peers', 0),
                'magnet': magnet,
                'hash': t.get('hash', ''),
            })
        qualities.sort(key=lambda q: QORD.get(q['quality'], 9))
        if quality_filter:
            qf = [q for q in qualities if q['quality'] == quality_filter]
            if qf:
                qualities = qf

        out = {
            'ok': True,
            'title': best.get('title'),
            'year': best.get('year'),
            'poster': best.get('medium_cover_image'),
            'qualities': qualities,
        }
        _cache[cache_key] = (out, now)
        return jsonify(out)

    except Exception as exc:
        print(f'[YTS] Error: {exc}')
        return jsonify({'ok': False, 'error': str(exc)}), 500


# ── /api/subtitle/convert ─────────────────────────────────────────────────────
@torrent_bp.route('/api/subtitle/convert', methods=['POST'])
def convert_subtitle():
    """
    Convert SRT or ASS subtitle text to WebVTT.
    Body JSON: { content: str, format: 'srt'|'ass' }
    """
    body = request.json or {}
    content = body.get('content', '').strip()
    fmt = body.get('format', 'srt').lower().strip('.')
    if not content:
        return jsonify({'ok': False, 'error': 'No content'}), 400
    try:
        vtt = _ass_to_vtt(content) if fmt in ('ass', 'ssa') else _srt_to_vtt(content)
        return jsonify({'ok': True, 'vtt': vtt})
    except Exception as exc:
        return jsonify({'ok': False, 'error': str(exc)}), 500


# ── Subtitle converters ───────────────────────────────────────────────────────
def _srt_to_vtt(srt: str) -> str:
    lines = srt.replace('\r\n', '\n').replace('\r', '\n').strip().split('\n')
    out = ['WEBVTT', '']
    i = 0
    while i < len(lines):
        ln = lines[i].strip()
        if ln.isdigit():
            i += 1
            continue
        if '-->' in ln:
            out.append(ln.replace(',', '.'))
            i += 1
            while i < len(lines) and lines[i].strip():
                out.append(_re.sub(r'</?(?!/?(?:b|i|u|c))[^>]+>', '', lines[i]))
                i += 1
            out.append('')
        else:
            i += 1
    return '\n'.join(out)


def _ass_to_vtt(ass: str) -> str:
    out = ['WEBVTT', '']
    in_ev = False
    fmt_cols: list = []
    cue = 0
    for raw in ass.replace('\r\n', '\n').split('\n'):
        ln = raw.strip()
        if ln == '[Events]':
            in_ev = True
            continue
        if in_ev and ln.startswith('['):
            break
        if in_ev and ln.startswith('Format:'):
            fmt_cols = [f.strip() for f in ln[7:].split(',')]
            continue
        if in_ev and ln.startswith('Dialogue:') and fmt_cols:
            try:
                parts = ln[9:].split(',', len(fmt_cols) - 1)
                if len(parts) < len(fmt_cols):
                    continue
                f = dict(zip(fmt_cols, parts))

                def at(t: str) -> str:
                    h, m, s = t.strip().split(':')
                    si, cs = s.split('.')
                    return f'{int(h):02d}:{int(m):02d}:{int(si):02d}.{int(cs) * 10:03d}'

                text = _re.sub(r'\{[^}]*\}', '', f.get('Text', ''))
                text = text.replace('\\N', '\n').replace('\\n', '\n').strip()
                if text:
                    cue += 1
                    out += [str(cue), f"{at(f['Start'])} --> {at(f['End'])}", text, '']
            except Exception:
                continue
    return '\n'.join(out)
