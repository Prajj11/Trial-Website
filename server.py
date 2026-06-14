"""
CineVault — Flask + SQLite Backend Server
==========================================
REST API that serves movie/anime data from SQLite.
Replaces the static JSON file approach with efficient server-side
querying, filtering, sorting, and pagination.

Endpoints:
  GET /api/movies          — Browse/filter/sort/paginate all content
  GET /api/movies/:id      — Single movie/anime details
  GET /api/trending        — Top 15 by popularity
  GET /api/languages       — All languages with counts
  GET /api/genres          — All distinct genres
  GET /api/stats           — Dashboard stats (counts)
  GET /api/search          — Quick search (for autocomplete)
  GET /api/movies/all      — Full dataset (legacy compatibility)

Also serves static files (HTML, CSS, JS) from the same directory.
"""

import os
import sys
import sqlite3
import json
import time
import subprocess
import atexit
import threading
import requests
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS

# --- Config ---
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, 'cinevault.db')
PORT = 8090

app = Flask(__name__, static_folder=BASE_DIR)
CORS(app)

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'api'))
from torrent import torrent_bp
app.register_blueprint(torrent_bp)


# --- Database helpers ---
def get_db():
    """Get a database connection with row factory."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")  # Better concurrent read performance
    return conn


def row_to_dict(row):
    """Convert a sqlite3.Row to a dict."""
    return dict(row)


def enrich_with_genres(conn, items):
    """Attach genre arrays to content items (batch query for performance)."""
    if not items:
        return items

    ids = [item['id'] for item in items]
    placeholders = ','.join('?' * len(ids))
    cursor = conn.execute(
        f'SELECT content_id, genre FROM genres WHERE content_id IN ({placeholders})',
        ids
    )

    genre_map = {}
    for row in cursor:
        cid = row['content_id']
        if cid not in genre_map:
            genre_map[cid] = []
        genre_map[cid].append(row['genre'])

    for item in items:
        item['genres'] = genre_map.get(item['id'], [])

    return items


# ============================================================
# API ENDPOINTS
# ============================================================

@app.route('/api/movies', methods=['GET'])
def get_movies():
    """
    Browse/filter/sort/paginate content.

    Query params:
      - search:   text search (title, original_title)
      - genre:    filter by genre
      - lang:     filter by original_language
      - rating:   minimum vote_average
      - year:     decade filter (e.g. 2020, 2010, 0 = before 1990)
      - type:     'movie' or 'anime'
      - sort:     popularity|rating|year-new|year-old|title-az|title-za|votes
      - page:     page number (1-indexed)
      - limit:    items per page (default 24, max 100)
    """
    conn = get_db()
    try:
        search = request.args.get('search', '').strip()
        genre = request.args.get('genre', '').strip()
        lang = request.args.get('lang', '').strip()
        rating = request.args.get('rating', '').strip()
        year = request.args.get('year', '').strip()
        content_type = request.args.get('type', '').strip()
        sort = request.args.get('sort', 'popularity').strip()
        page = max(1, int(request.args.get('page', 1)))
        limit = min(100, max(1, int(request.args.get('limit', 24))))

        # Build query
        conditions = []
        params = []

        if content_type == 'movie':
            conditions.append("c.content_type = 'movie'")
        elif content_type == 'anime':
            conditions.append("c.content_type = 'anime'")

        if search:
            conditions.append("(c.title LIKE ? OR c.original_title LIKE ?)")
            params.extend([f'%{search}%', f'%{search}%'])

        if lang:
            conditions.append("c.original_language = ?")
            params.append(lang)

        if rating:
            conditions.append("c.vote_average >= ?")
            params.append(float(rating))

        if year:
            if year == '0':
                conditions.append("CAST(SUBSTR(c.release_date, 1, 4) AS INTEGER) < 1990")
            else:
                dec = int(year)
                conditions.append("CAST(SUBSTR(c.release_date, 1, 4) AS INTEGER) BETWEEN ? AND ?")
                params.extend([dec, dec + 9])

        if genre:
            conditions.append("c.id IN (SELECT content_id FROM genres WHERE genre = ?)")
            params.append(genre)

        where_clause = (' WHERE ' + ' AND '.join(conditions)) if conditions else ''

        # Sort
        sort_map = {
            'popularity': 'c.popularity DESC',
            'rating': 'c.vote_average DESC',
            'year-new': "c.release_date DESC",
            'year-old': "c.release_date ASC",
            'title-az': 'c.title ASC',
            'title-za': 'c.title DESC',
            'votes': 'c.vote_count DESC'
        }
        order_by = sort_map.get(sort, 'c.popularity DESC')

        # Count total
        count_sql = f'SELECT COUNT(*) as total FROM content c{where_clause}'
        total = conn.execute(count_sql, params).fetchone()['total']

        # Fetch page
        offset = (page - 1) * limit
        data_sql = f'''
            SELECT c.* FROM content c
            {where_clause}
            ORDER BY {order_by}
            LIMIT ? OFFSET ?
        '''
        rows = conn.execute(data_sql, params + [limit, offset]).fetchall()
        items = [row_to_dict(r) for r in rows]
        items = enrich_with_genres(conn, items)

        return jsonify({
            'data': items,
            'total': total,
            'page': page,
            'limit': limit,
            'totalPages': (total + limit - 1) // limit
        })

    finally:
        conn.close()


@app.route('/api/movies/all', methods=['GET'])
def get_all_movies():
    """
    Return the FULL dataset (legacy compatibility for the frontend).
    The frontend was originally loading the entire JSON, so this endpoint
    replicates that behavior for an easy migration path.
    """
    conn = get_db()
    try:
        rows = conn.execute('SELECT * FROM content ORDER BY popularity DESC').fetchall()
        items = [row_to_dict(r) for r in rows]
        items = enrich_with_genres(conn, items)
        return jsonify(items)
    finally:
        conn.close()


@app.route('/api/movies/<int:movie_id>', methods=['GET'])
def get_movie(movie_id):
    """Get a single movie/anime by ID."""
    conn = get_db()
    try:
        row = conn.execute('SELECT * FROM content WHERE id = ?', (movie_id,)).fetchone()
        if not row:
            return jsonify({'error': 'Not found'}), 404
        item = row_to_dict(row)
        item = enrich_with_genres(conn, [item])[0]
        return jsonify(item)
    finally:
        conn.close()


@app.route('/api/trending', methods=['GET'])
def get_trending():
    """Top 15 most popular items."""
    conn = get_db()
    try:
        limit = min(30, max(1, int(request.args.get('limit', 15))))
        rows = conn.execute(
            'SELECT * FROM content ORDER BY popularity DESC LIMIT ?',
            (limit,)
        ).fetchall()
        items = [row_to_dict(r) for r in rows]
        items = enrich_with_genres(conn, items)
        return jsonify(items)
    finally:
        conn.close()


@app.route('/api/languages', methods=['GET'])
def get_languages():
    """Get all languages with movie counts."""
    conn = get_db()
    try:
        rows = conn.execute('''
            SELECT original_language as code, COUNT(*) as count
            FROM content
            GROUP BY original_language
            ORDER BY count DESC
        ''').fetchall()
        return jsonify([row_to_dict(r) for r in rows])
    finally:
        conn.close()


@app.route('/api/genres', methods=['GET'])
def get_genres():
    """Get all distinct genres with counts."""
    conn = get_db()
    try:
        rows = conn.execute('''
            SELECT genre, COUNT(*) as count
            FROM genres
            GROUP BY genre
            ORDER BY genre ASC
        ''').fetchall()
        return jsonify([row_to_dict(r) for r in rows])
    finally:
        conn.close()


@app.route('/api/stats', methods=['GET'])
def get_stats():
    """Dashboard statistics."""
    conn = get_db()
    try:
        total = conn.execute('SELECT COUNT(*) as c FROM content').fetchone()['c']
        movies = conn.execute("SELECT COUNT(*) as c FROM content WHERE content_type = 'movie'").fetchone()['c']
        anime = conn.execute("SELECT COUNT(*) as c FROM content WHERE content_type = 'anime'").fetchone()['c']
        genres = conn.execute('SELECT COUNT(DISTINCT genre) as c FROM genres').fetchone()['c']
        langs = conn.execute('SELECT COUNT(DISTINCT original_language) as c FROM content').fetchone()['c']
        return jsonify({
            'total': total,
            'movies': movies,
            'anime': anime,
            'genres': genres,
            'languages': langs,
            'torrentSites': 6
        })
    finally:
        conn.close()


@app.route('/api/search', methods=['GET'])
def search_movies():
    """Quick search for autocomplete (returns top 5 matches)."""
    conn = get_db()
    try:
        q = request.args.get('q', '').strip()
        if len(q) < 2:
            return jsonify([])

        rows = conn.execute('''
            SELECT * FROM content
            WHERE title LIKE ? OR original_title LIKE ?
            ORDER BY
                CASE WHEN LOWER(title) LIKE ? THEN 0 ELSE 1 END,
                popularity DESC
            LIMIT 8
        ''', (f'%{q}%', f'%{q}%', f'{q.lower()}%')).fetchall()

        items = [row_to_dict(r) for r in rows]
        items = enrich_with_genres(conn, items)
        return jsonify(items)
    finally:
        conn.close()


@app.route('/api/language/<lang_code>', methods=['GET'])
def get_by_language(lang_code):
    """Get movies for a specific language."""
    conn = get_db()
    try:
        limit = min(50, max(1, int(request.args.get('limit', 24))))
        rows = conn.execute('''
            SELECT * FROM content
            WHERE original_language = ?
            ORDER BY popularity DESC
            LIMIT ?
        ''', (lang_code, limit)).fetchall()
        items = [row_to_dict(r) for r in rows]
        items = enrich_with_genres(conn, items)
        return jsonify(items)
    finally:
        conn.close()


# ============================================================
# ANIKOTO API PROXY
# ============================================================
# Proxies requests to anikotoapi.site to avoid CORS and client-side rate limits.
# Caches responses in memory for 10 minutes.

_anikoto_cache = {}
_ANIKOTO_CACHE_TTL = 600  # 10 minutes
_ANIKOTO_API_BASE = 'https://anikotoapi.site'


def _anikoto_get(path, params=None):
    """Fetch from Anikoto API with caching."""
    cache_key = path + (json.dumps(params, sort_keys=True) if params else '')
    now = time.time()
    if cache_key in _anikoto_cache:
        data, ts = _anikoto_cache[cache_key]
        if now - ts < _ANIKOTO_CACHE_TTL:
            return data

    try:
        resp = requests.get(
            f'{_ANIKOTO_API_BASE}{path}',
            params=params,
            timeout=15,
            headers={'Accept': 'application/json'}
        )
        resp.raise_for_status()
        data = resp.json()
        _anikoto_cache[cache_key] = (data, now)
        return data
    except Exception as e:
        print(f'[Anikoto Proxy] Error fetching {path}: {e}')
        return None


@app.route('/api/anikoto/search', methods=['GET'])
def anikoto_search():
    """
    Search Anikoto for an anime by title.
    Returns matching series from the Anikoto catalog.
    Query params:
      - q: search query (anime title)
    """
    q = request.args.get('q', '').strip()
    if not q:
        return jsonify({'ok': False, 'error': 'Missing query parameter q'}), 400

    # Anikoto uses /recent-anime with search, but we can also search via a filter
    # The API supports keyword search via the terms_by_type or by iterating.
    # Actually the API exposes search via recent-anime listing. Let's use that
    # with a page scan. But for efficiency, we'll match from our own DB first
    # and use the mal_id if available to get the Anikoto series directly.
    
    # Strategy: Fetch recent-anime pages and filter, or use a broader approach.
    # Better: Anikoto lists by page. We'll fetch a generous amount and filter client-side.
    # For best results, fetch multiple pages and match by title.
    
    results = []
    for page in range(1, 4):  # Check first 3 pages (60 entries) for matches
        data = _anikoto_get('/recent-anime', {'page': page, 'per_page': 20})
        if not data or not data.get('ok'):
            break
        for anime in data.get('data', []):
            title_lower = (anime.get('title') or '').lower()
            alt_lower = (anime.get('alternative') or '').lower()
            titles_lower = (anime.get('titles') or '').lower()
            q_lower = q.lower()
            if q_lower in title_lower or q_lower in alt_lower or q_lower in titles_lower:
                results.append(anime)
    
    # If no matches from recent, try fetching by known mal_id from our DB
    if not results:
        conn = get_db()
        try:
            row = conn.execute(
                "SELECT * FROM content WHERE content_type = 'anime' AND (title LIKE ? OR original_title LIKE ?) LIMIT 1",
                (f'%{q}%', f'%{q}%')
            ).fetchone()
            if row:
                item = row_to_dict(row)
                mal_id = item.get('mal_id')
                if mal_id:
                    # Try to find in Anikoto by mal_id
                    for page in range(1, 20):
                        data = _anikoto_get('/recent-anime', {'page': page, 'per_page': 50})
                        if not data or not data.get('ok'):
                            break
                        for anime in data.get('data', []):
                            if str(anime.get('mal_id')) == str(mal_id):
                                results.append(anime)
                                break
                        if results:
                            break
        finally:
            conn.close()
    
    return jsonify({'ok': True, 'results': results})


@app.route('/api/anikoto/series/<int:series_id>', methods=['GET'])
def anikoto_series(series_id):
    """
    Get full series details + episodes with embed URLs from Anikoto.
    """
    data = _anikoto_get(f'/series/{series_id}')
    if not data:
        return jsonify({'ok': False, 'error': 'Failed to fetch series data'}), 502
    return jsonify(data)


@app.route('/api/anikoto/search-title', methods=['GET'])
def anikoto_search_title():
    """
    Smart search: Searches Anikoto catalog by title with fuzzy matching.
    Scans through the Anikoto catalog to find the best match.
    Query params:
      - q: anime title to search
      - mal_id: optional MAL ID for precise matching
    """
    q = request.args.get('q', '').strip()
    mal_id = request.args.get('mal_id', '').strip()

    if not q and not mal_id:
        return jsonify({'ok': False, 'error': 'Missing query'}), 400

    best_match = None
    q_lower = q.lower().strip()

    # Scan pages looking for a match
    for page in range(1, 30):  # Up to 30 pages (600 entries)
        data = _anikoto_get('/recent-anime', {'page': page, 'per_page': 20})
        if not data or not data.get('ok') or not data.get('data'):
            break

        for anime in data['data']:
            # Exact MAL ID match (highest priority)
            if mal_id and str(anime.get('mal_id')) == str(mal_id):
                return jsonify({'ok': True, 'match': anime})

            # Title matching
            a_title = (anime.get('title') or '').lower().strip()
            a_alt = (anime.get('alternative') or '').lower().strip()
            a_titles = (anime.get('titles') or '').lower()

            if a_title == q_lower or a_alt == q_lower:
                best_match = anime
                # Exact match, return immediately
                return jsonify({'ok': True, 'match': best_match})

            if q_lower in a_title or q_lower in a_alt or q_lower in a_titles:
                if not best_match:
                    best_match = anime

    if best_match:
        return jsonify({'ok': True, 'match': best_match})

    return jsonify({'ok': False, 'error': 'No match found', 'query': q})


# ============================================================
# ANILIST ID MAPPING (MAL → AniList)
# ============================================================
# Videasy requires AniList IDs for anime streaming.
# This endpoint converts MAL IDs to AniList IDs via the AniList GraphQL API.

_anilist_cache = {}

@app.route('/api/anilist/mal/<int:mal_id>', methods=['GET'])
def get_anilist_id(mal_id):
    """Convert a MAL ID to an AniList ID."""
    # Check cache first
    if mal_id in _anilist_cache:
        return jsonify({'ok': True, 'mal_id': mal_id, 'anilist_id': _anilist_cache[mal_id]})

    # 1. Try ARM mapping (highly reliable, handles MAL->AniList, from Anivexa logic)
    try:
        arm_resp = requests.get(
            f'https://arm.haglund.dev/api/v2/ids?source=myanimelist&id={mal_id}',
            headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Accept': 'application/json'},
            timeout=5
        )
        if arm_resp.status_code == 200:
            arm_data = arm_resp.json()
            anilist_id = arm_data.get('anilist')
            if anilist_id:
                _anilist_cache[mal_id] = anilist_id
                return jsonify({
                    'ok': True, 
                    'mal_id': mal_id, 
                    'anilist_id': anilist_id
                })
    except Exception as e:
        print(f'[AniList] ARM mapping failed for {mal_id}: {e}')

    # 2. Fallback to AniList GraphQL
    query = '''
    query ($idMal: Int) {
      Media(idMal: $idMal, type: ANIME) {
        id
        title {
          romaji
          english
        }
      }
    }
    '''
    variables = {'idMal': mal_id}

    try:
        resp = requests.post(
            'https://graphql.anilist.co',
            json={'query': query, 'variables': variables},
            timeout=10,
            headers={'Content-Type': 'application/json', 'Accept': 'application/json'}
        )
        resp.raise_for_status()
        data = resp.json()

        media = data.get('data', {}).get('Media')
        if media and media.get('id'):
            anilist_id = media['id']
            _anilist_cache[mal_id] = anilist_id
            return jsonify({
                'ok': True,
                'mal_id': mal_id,
                'anilist_id': anilist_id,
                'title': media.get('title', {})
            })
        else:
            return jsonify({'ok': False, 'error': 'Not found on AniList', 'mal_id': mal_id})

    except Exception as e:
        print(f'[AniList] Error mapping MAL {mal_id}: {e}')
        return jsonify({'ok': False, 'error': str(e), 'mal_id': mal_id})


# ============================================================
# JIKAN (MyAnimeList) API PROXY
# ============================================================
# Proxies requests to the Jikan v4 API (api.jikan.moe) for rich
# anime metadata: episode titles, air dates, MAL scores, synopses.
# Cached in-memory to respect Jikan's rate limits (3 req/s).

_jikan_cache = {}
_JIKAN_CACHE_TTL = 900  # 15 minutes (Jikan data doesn't change often)
_JIKAN_API_BASE = 'https://api.jikan.moe/v4'


def _jikan_get(path, params=None):
    """Fetch from Jikan API with caching and rate-limit awareness."""
    cache_key = 'jikan:' + path + (json.dumps(params, sort_keys=True) if params else '')
    now = time.time()
    if cache_key in _jikan_cache:
        data, ts = _jikan_cache[cache_key]
        if now - ts < _JIKAN_CACHE_TTL:
            return data

    try:
        resp = requests.get(
            f'{_JIKAN_API_BASE}{path}',
            params=params,
            timeout=15,
            headers={'Accept': 'application/json'}
        )
        # Jikan returns 429 on rate limit
        if resp.status_code == 429:
            print(f'[Jikan] Rate limited on {path}, returning cached or None')
            if cache_key in _jikan_cache:
                return _jikan_cache[cache_key][0]
            return None
        resp.raise_for_status()
        data = resp.json()
        _jikan_cache[cache_key] = (data, now)
        return data
    except Exception as e:
        print(f'[Jikan Proxy] Error fetching {path}: {e}')
        # Return stale cache if available
        if cache_key in _jikan_cache:
            return _jikan_cache[cache_key][0]
        return None


@app.route('/api/jikan/search', methods=['GET'])
def jikan_search():
    """
    Search for anime on MAL via Jikan.
    Query params:
      - q: search query (required)
      - limit: max results (default 10, max 25)
    Returns: Jikan search results with MAL metadata.
    """
    q = request.args.get('q', '').strip()
    if not q:
        return jsonify({'ok': False, 'error': 'Missing query parameter q'}), 400

    limit = min(25, max(1, int(request.args.get('limit', 10))))
    data = _jikan_get('/anime', {'q': q, 'limit': limit, 'order_by': 'score', 'sort': 'desc'})

    if not data:
        return jsonify({'ok': False, 'error': 'Jikan API unavailable'}), 502

    results = []
    for item in data.get('data', []):
        results.append({
            'mal_id': item.get('mal_id'),
            'title': item.get('title'),
            'title_english': item.get('title_english'),
            'title_japanese': item.get('title_japanese'),
            'type': item.get('type'),
            'episodes': item.get('episodes'),
            'status': item.get('status'),
            'score': item.get('score'),
            'synopsis': item.get('synopsis'),
            'year': item.get('year'),
            'poster_url': (item.get('images', {}).get('jpg', {}).get('large_image_url')
                          or item.get('images', {}).get('jpg', {}).get('image_url')),
            'url': item.get('url'),
        })

    return jsonify({
        'ok': True,
        'results': results,
        'total': data.get('pagination', {}).get('items', {}).get('total', len(results))
    })


@app.route('/api/jikan/anime/<int:mal_id>', methods=['GET'])
def jikan_anime_details(mal_id):
    """
    Get full anime details from MAL via Jikan.
    Returns: detailed anime info including synopsis, score, genres, studios.
    """
    data = _jikan_get(f'/anime/{mal_id}/full')
    if not data or not data.get('data'):
        return jsonify({'ok': False, 'error': 'Anime not found on MAL', 'mal_id': mal_id}), 404

    anime = data['data']
    return jsonify({
        'ok': True,
        'data': {
            'mal_id': anime.get('mal_id'),
            'title': anime.get('title'),
            'title_english': anime.get('title_english'),
            'title_japanese': anime.get('title_japanese'),
            'type': anime.get('type'),
            'episodes': anime.get('episodes'),
            'status': anime.get('status'),
            'duration': anime.get('duration'),
            'score': anime.get('score'),
            'scored_by': anime.get('scored_by'),
            'rank': anime.get('rank'),
            'popularity': anime.get('popularity'),
            'synopsis': anime.get('synopsis'),
            'year': anime.get('year'),
            'season': anime.get('season'),
            'studios': [s.get('name') for s in (anime.get('studios') or [])],
            'genres': [g.get('name') for g in (anime.get('genres') or [])],
            'themes': [t.get('name') for t in (anime.get('themes') or [])],
            'poster_url': (anime.get('images', {}).get('jpg', {}).get('large_image_url')
                          or anime.get('images', {}).get('jpg', {}).get('image_url')),
            'trailer_url': anime.get('trailer', {}).get('url'),
            'url': anime.get('url'),
            'rating': anime.get('rating'),
            'source': anime.get('source'),
            'relations': [{
                'relation': r.get('relation'),
                'entries': [{'mal_id': e.get('mal_id'), 'type': e.get('type'), 'name': e.get('name')} for e in r.get('entry', [])]
            } for r in (anime.get('relations') or [])],
            'streaming': [{'name': s.get('name'), 'url': s.get('url')} for s in (anime.get('streaming') or [])],
        }
    })


@app.route('/api/jikan/anime/<int:mal_id>/episodes', methods=['GET'])
def jikan_anime_episodes(mal_id):
    """
    Get episodes for an anime from MAL via Jikan.
    Jikan paginates at 100 episodes per page.
    Query params:
      - page: page number (default 1)
    Returns: episode list with titles, air dates, and filler flags.
    """
    page = max(1, int(request.args.get('page', 1)))
    data = _jikan_get(f'/anime/{mal_id}/episodes', {'page': page})

    if not data:
        return jsonify({'ok': False, 'error': 'Failed to fetch episodes', 'mal_id': mal_id}), 502

    episodes = []
    for ep in data.get('data', []):
        episodes.append({
            'mal_id': ep.get('mal_id'),
            'number': ep.get('mal_id'),  # episode number
            'title': ep.get('title'),
            'title_japanese': ep.get('title_japanese'),
            'title_romanji': ep.get('title_romanji'),
            'aired': ep.get('aired'),
            'filler': ep.get('filler', False),
            'recap': ep.get('recap', False),
            'url': ep.get('url'),
        })

    pagination = data.get('pagination', {})
    return jsonify({
        'ok': True,
        'mal_id': mal_id,
        'episodes': episodes,
        'has_next': pagination.get('has_next_page', False),
        'total': pagination.get('items', {}).get('total', len(episodes)),
        'page': page,
    })


@app.route('/api/jikan/anime/<int:mal_id>/episodes/all', methods=['GET'])
def jikan_anime_all_episodes(mal_id):
    """
    Get ALL episodes for an anime (auto-paginates through all pages).
    Useful for building a full episode selector.
    Cached aggressively since episode lists rarely change.
    """
    cache_key = f'jikan_all_eps:{mal_id}'
    now = time.time()
    if cache_key in _jikan_cache:
        cached_data, ts = _jikan_cache[cache_key]
        if now - ts < _JIKAN_CACHE_TTL * 2:  # 30 min cache for full episode lists
            return jsonify(cached_data)

    all_episodes = []
    page = 1
    while True:
        data = _jikan_get(f'/anime/{mal_id}/episodes', {'page': page})
        if not data or not data.get('data'):
            break

        for ep in data['data']:
            all_episodes.append({
                'number': ep.get('mal_id'),
                'title': ep.get('title'),
                'title_japanese': ep.get('title_japanese'),
                'aired': ep.get('aired'),
                'filler': ep.get('filler', False),
                'recap': ep.get('recap', False),
            })

        if not data.get('pagination', {}).get('has_next_page', False):
            break
        page += 1
        # Rate limit safety: Jikan allows 3 req/s
        time.sleep(0.4)

    result = {
        'ok': True,
        'mal_id': mal_id,
        'episodes': all_episodes,
        'total': len(all_episodes)
    }
    _jikan_cache[cache_key] = (result, now)
    return jsonify(result)


# ============================================================
# DIRECT STREAM PROXY (HLS.js compatible)
# ============================================================
# Fetches direct .m3u8 / .mp4 video URLs from Consumet API
# so the client can play them with HLS.js instead of using
# embed iframes that buffer infinitely.

_stream_cache = {}
_STREAM_CACHE_TTL = 300  # 5 minutes

_CONSUMET_BASES = [
    'https://api.consumet.org',
    'https://consumet-api.vercel.app',
]


def _try_consumet(path, params=None):
    """Try multiple Consumet API mirrors."""
    for base in _CONSUMET_BASES:
        try:
            resp = requests.get(
                f'{base}{path}',
                params=params,
                timeout=12,
                headers={'Accept': 'application/json'}
            )
            if resp.status_code == 200:
                return resp.json()
        except Exception:
            continue
    return None


@app.route('/api/stream/<int:anilist_id>/<int:episode>', methods=['GET'])
def get_stream(anilist_id, episode):
    """
    Get a direct .m3u8 or .mp4 streaming URL for an anime episode.
    Uses Consumet (AniList provider) to resolve the video source.
    Returns: { ok, sources: [{ url, quality, isM3U8 }], referer }
    """
    cache_key = f'stream:{anilist_id}:{episode}'
    now = time.time()
    if cache_key in _stream_cache:
        data, ts = _stream_cache[cache_key]
        if now - ts < _STREAM_CACHE_TTL:
            return jsonify(data)

    info = None
    try:
        # Strategy 1: Anivexa API via localhost:4000
        anivexa_url = f'http://localhost:4000/watch/anikoto/{anilist_id}/sub/anikoto-{episode}'
        r = requests.get(anivexa_url, timeout=15)
        if r.status_code == 200:
            info = r.json()
    except Exception as e:
        print(f"[Anivexa] stream failed: {e}")

    sources = []
    
    if info and info.get('ssub') and info['ssub'].get('streams'):
        for src in info['ssub']['streams']:
            url = src.get('url', '')
            quality = '1080p' if '1080' in url else 'auto'
            is_m3u8 = src.get('type') == 'hls' or '.m3u8' in url
            if url:
                sources.append({
                    'url': url,
                    'quality': quality,
                    'isM3U8': is_m3u8
                })

    if not sources:
        return jsonify({
            'ok': False,
            'error': 'No streaming sources found',
            'anilist_id': anilist_id,
            'episode': episode
        })

    # Sort: m3u8 first, then by quality (1080p > 720p > 480p > default)
    quality_order = {'1080p': 0, '720p': 1, '480p': 2, '360p': 3, 'default': 4, 'auto': -1, 'backup': 5}
    sources.sort(key=lambda s: (
        0 if s['isM3U8'] else 1,
        quality_order.get(s['quality'], 3)
    ))

    referer = info.get('headers', {}).get('Referer', '')

    result = {
        'ok': True,
        'sources': sources,
        'referer': referer,
        'anilist_id': anilist_id,
        'episode': episode
    }
    _stream_cache[cache_key] = (result, now)
    return jsonify(result)


@app.route('/api/anikoto/search-fast', methods=['GET'])
def anikoto_search_fast():
    """
    Fast Anikoto search — uses the Anikoto search endpoint directly
    instead of scanning pages sequentially.
    Falls back to the slow page-scan method if needed.
    Query params:
      - q: anime title
      - mal_id: optional MAL ID
    """
    q = request.args.get('q', '').strip()
    mal_id = request.args.get('mal_id', '').strip()

    if not q and not mal_id:
        return jsonify({'ok': False, 'error': 'Missing query'}), 400

    # Try direct search endpoint first
    try:
        search_data = _anikoto_get('/search', {'query': q})
        if search_data and search_data.get('ok') and search_data.get('data'):
            results = search_data['data']
            # If we have a MAL ID, prefer exact match
            if mal_id:
                for anime in results:
                    if str(anime.get('mal_id')) == str(mal_id):
                        return jsonify({'ok': True, 'match': anime})
            # Otherwise return best match
            q_lower = q.lower().strip()
            for anime in results:
                a_title = (anime.get('title') or '').lower().strip()
                if a_title == q_lower:
                    return jsonify({'ok': True, 'match': anime})
            # Partial match
            for anime in results:
                a_title = (anime.get('title') or '').lower().strip()
                a_alt = (anime.get('alternative') or '').lower().strip()
                if q_lower in a_title or q_lower in a_alt:
                    return jsonify({'ok': True, 'match': anime})
            # Return first result as fallback
            if results:
                return jsonify({'ok': True, 'match': results[0]})
    except Exception as e:
        print(f'[Anikoto Fast] Direct search failed: {e}')

    # Fallback: limited page scan (max 5 pages instead of 30)
    best_match = None
    q_lower = q.lower().strip()
    for page in range(1, 6):
        data = _anikoto_get('/recent-anime', {'page': page, 'per_page': 20})
        if not data or not data.get('ok') or not data.get('data'):
            break
        for anime in data['data']:
            if mal_id and str(anime.get('mal_id')) == str(mal_id):
                return jsonify({'ok': True, 'match': anime})
            a_title = (anime.get('title') or '').lower().strip()
            a_alt = (anime.get('alternative') or '').lower().strip()
            if a_title == q_lower or a_alt == q_lower:
                return jsonify({'ok': True, 'match': anime})
            if q_lower in a_title or q_lower in a_alt:
                if not best_match:
                    best_match = anime

    if best_match:
        return jsonify({'ok': True, 'match': best_match})

    return jsonify({'ok': False, 'error': 'No match found', 'query': q})


# ============================================================
# ANIMEPAHE PROXY ENDPOINTS (via local Node API)
# ============================================================

ANIMEPAHE_API_BASE = 'http://localhost:3000/api'
_animepahe_node_ok = None  # Cached availability flag
_animepahe_node_last_check = 0
_ANIMEPAHE_NODE_CHECK_TTL = 30  # Re-check every 30 seconds


def _animepahe_node_available():
    """Quick ping to check if the AnimePahe Node API is up. Cached for 30s."""
    global _animepahe_node_ok, _animepahe_node_last_check
    now = time.time()
    if now - _animepahe_node_last_check < _ANIMEPAHE_NODE_CHECK_TTL:
        return _animepahe_node_ok
    try:
        # Just ping root — fast 1.5s timeout
        r = requests.get('http://localhost:3000/', timeout=1.5)
        _animepahe_node_ok = True  # Even 404 means server is up
    except Exception:
        _animepahe_node_ok = False
    _animepahe_node_last_check = now
    return _animepahe_node_ok


@app.route('/api/animepahe/status', methods=['GET'])
def animepahe_status():
    """Check if the AnimePahe Node API is running."""
    global _animepahe_node_last_check
    _animepahe_node_last_check = 0  # Force re-check
    available = _animepahe_node_available()
    return jsonify({'ok': available, 'node_api': 'http://localhost:3000', 'message': 'AnimePahe Node API is ' + ('running' if available else 'not running')})


@app.route('/api/animepahe/search', methods=['GET'])
def animepahe_search():
    """
    Search AnimePahe for an anime.
    Fuzzy matches the title.
    """
    q = request.args.get('q', '').strip()
    mal_id = request.args.get('mal_id', '').strip()
    if not q:
        return jsonify({'ok': False, 'error': 'Missing query parameter q'}), 400

    # Fast-fail if Node API isn't running
    if not _animepahe_node_available():
        return jsonify({'ok': False, 'error': 'AnimePahe Node API is not running. Start it with: cd animepahe-api--main && node app.js'}), 503

    try:
        # Query the local Node API — fast timeout so fallback to Videasy is instant
        resp = requests.get(f'{ANIMEPAHE_API_BASE}/search', params={'q': q}, timeout=6)
        if resp.status_code != 200:
            return jsonify({'ok': False, 'error': f'Node API returned status {resp.status_code}'}), 502
        
        data = resp.json()
        results = data.get('data', [])
        
        # Smart matching:
        q_lower = q.lower().strip()
        best_match = None
        for anime in results:
            a_title = (anime.get('title') or '').lower().strip()
            if a_title == q_lower:
                best_match = anime
                break
            if q_lower in a_title:
                if not best_match:
                    best_match = anime

        if not best_match and results:
            best_match = results[0]

        if best_match:
            return jsonify({'ok': True, 'match': best_match})
        else:
            return jsonify({'ok': False, 'error': 'No match found'})

    except Exception as e:
        print(f'[AnimePahe Proxy Search] Error: {e}')
        return jsonify({'ok': False, 'error': str(e)}), 500


@app.route('/api/animepahe/episodes', methods=['GET'])
def animepahe_episodes():
    """
    Fetches paginated episodes for an anime session ID.
    """
    session = request.args.get('session', '').strip()
    page = request.args.get('page', '1').strip()
    if not session:
        return jsonify({'ok': False, 'error': 'Missing session parameter'}), 400

    # Fast-fail if Node API isn't running
    if not _animepahe_node_available():
        return jsonify({'ok': False, 'error': 'AnimePahe Node API is not running'}), 503

    try:
        # The Node API route for episodes is /:id/releases (fast timeout for quick fallback)
        resp = requests.get(f'{ANIMEPAHE_API_BASE}/{session}/releases', params={'page': page}, timeout=6)
        if resp.status_code != 200:
            return jsonify({'ok': False, 'error': f'Node API returned status {resp.status_code}'}), 502

        return jsonify(resp.json())

    except Exception as e:
        print(f'[AnimePahe Proxy Episodes] Error: {e}')
        return jsonify({'ok': False, 'error': str(e)}), 500


@app.route('/api/animepahe/stream', methods=['GET'])
def animepahe_stream():
    """
    Resolves the streaming links for an episode.
    Wraps the Kwik .m3u8 links in our local Flask HLS proxy.
    """
    anime_session = request.args.get('anime_session', '').strip()
    ep_session = request.args.get('ep_session', '').strip()
    if not anime_session or not ep_session:
        return jsonify({'ok': False, 'error': 'Missing anime_session or ep_session parameter'}), 400

    # Fast-fail if Node API isn't running
    if not _animepahe_node_available():
        return jsonify({'ok': False, 'error': 'AnimePahe Node API is not running'}), 503

    try:
        resp = requests.get(
            f'{ANIMEPAHE_API_BASE}/play/{anime_session}',
            params={'episodeId': ep_session},
            timeout=10
        )
        if resp.status_code != 200:
            return jsonify({'ok': False, 'error': f'Node API returned status {resp.status_code}'}), 502

        node_data = resp.json()
        sources = node_data.get('sources', [])
        
        formatted_sources = []
        for src in sources:
            url = src.get('url', '')
            quality = src.get('resolution', '720') + 'p'
            is_m3u8 = src.get('isM3U8', True)
            if url:
                # Wrap the m3u8 in our Flask proxy to bypass Referer check
                proxied_url = f'/api/animepahe/hls/manifest?url={requests.utils.quote(url)}'
                formatted_sources.append({
                    'url': proxied_url,
                    'quality': quality,
                    'isM3U8': is_m3u8
                })

        return jsonify({
            'ok': True,
            'sources': formatted_sources,
            'referer': 'https://kwik.cx/'
        })

    except Exception as e:
        print(f'[AnimePahe Proxy Stream] Error: {e}')
        return jsonify({'ok': False, 'error': str(e)}), 500


@app.route('/api/animepahe/hls/manifest')
def animepahe_hls_manifest():
    """
    Proxies the .m3u8 manifest file, rewriting relative segment URLs to go through our proxy.
    """
    from urllib.parse import urljoin
    m3u8_url = request.args.get('url')
    if not m3u8_url:
        return 'Missing url', 400

    try:
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Referer': 'https://kwik.cx/'
        }
        resp = requests.get(m3u8_url, headers=headers, timeout=10)
        if resp.status_code != 200:
            return f'Failed to fetch manifest: {resp.status_code}', 502

        content = resp.text
        lines = content.split('\n')
        for i, line in enumerate(lines):
            line = line.strip()
            if line and not line.startswith('#'):
                resolved_url = urljoin(m3u8_url, line)
                lines[i] = f'/api/animepahe/hls/segment?url={requests.utils.quote(resolved_url)}'

        proxied_content = '\n'.join(lines)
        
        flask_resp = app.make_response(proxied_content)
        flask_resp.headers['Content-Type'] = 'application/x-mpegURL'
        flask_resp.headers['Access-Control-Allow-Origin'] = '*'
        return flask_resp

    except Exception as e:
        return str(e), 500


@app.route('/api/animepahe/hls/segment')
def animepahe_hls_segment():
    """
    Proxies a video segment (.ts or other) attaching the required Referer header.
    """
    segment_url = request.args.get('url')
    if not segment_url:
        return 'Missing url', 400

    try:
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Referer': 'https://kwik.cx/'
        }
        resp = requests.get(segment_url, headers=headers, stream=True, timeout=15)
        if resp.status_code != 200:
            return f'Failed to fetch segment: {resp.status_code}', 502

        def generate():
            for chunk in resp.iter_content(chunk_size=8192):  # 8KB chunks for faster throughput
                yield chunk

        flask_resp = app.make_response(generate())
        flask_resp.headers['Content-Type'] = resp.headers.get('Content-Type', 'video/MP2T')
        flask_resp.headers['Access-Control-Allow-Origin'] = '*'
        return flask_resp

    except Exception as e:
        return str(e), 500



# ============================================================
# TORRENT STREAM PROXY (forwards to Node.js WebTorrent server on :9411)
# ============================================================

TORRENT_STREAM_BASE = 'http://localhost:9411'

def _torrent_server_available():
    """Quick check if the torrent stream server (Node) is up."""
    try:
        r = requests.get(f'{TORRENT_STREAM_BASE}/health', timeout=2)
        return r.status_code == 200
    except Exception:
        return False


@app.route('/api/torrent-stream/start', methods=['POST'])
def torrent_stream_start():
    """
    Start streaming a magnet link via the Node WebTorrent server.
    Body JSON: { magnet: '...' }
    Returns: { ok, streamUrl, fileName, fileSize, infoHash }
    """
    if not _torrent_server_available():
        return jsonify({
            'ok': False,
            'error': 'Torrent stream server not running. Start it with: node torrent-stream-server.js'
        }), 503

    body = request.get_json(silent=True) or {}
    magnet = body.get('magnet', '').strip()
    if not magnet:
        return jsonify({'ok': False, 'error': 'Missing magnet link'}), 400

    try:
        resp = requests.post(
            f'{TORRENT_STREAM_BASE}/stream',
            json={'magnet': magnet},
            timeout=30
        )
        data = resp.json()
        # Rewrite the streamUrl to go through Flask so browser stays on port 8090
        if data.get('ok') and data.get('infoHash') and data.get('fileName'):
            ih = data['infoHash']
            fn = requests.utils.quote(data['fileName'], safe='')
            data['streamUrl'] = f'/api/torrent-stream/play/{ih}/{fn}'
        return jsonify(data)
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500


@app.route('/api/torrent-stream/status/<info_hash>', methods=['GET'])
def torrent_stream_status(info_hash):
    """Proxy torrent progress status from Node server."""
    try:
        resp = requests.get(f'{TORRENT_STREAM_BASE}/status/{info_hash}', timeout=5)
        return jsonify(resp.json())
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500


@app.route('/api/torrent-stream/stop/<info_hash>', methods=['DELETE'])
def torrent_stream_stop(info_hash):
    """Tell the Node server to destroy the torrent and free memory."""
    try:
        resp = requests.delete(f'{TORRENT_STREAM_BASE}/stream/{info_hash}', timeout=5)
        return jsonify(resp.json())
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500


@app.route('/api/torrent-stream/play/<info_hash>/<path:filename>')
def torrent_stream_play(info_hash, filename):
    """
    HTTP-range proxy: forwards video byte ranges from the Node WebTorrent
    server to the browser so the HTML5 <video> player can seek freely.
    """
    node_url = f'{TORRENT_STREAM_BASE}/stream/{info_hash}/{requests.utils.quote(filename, safe="")}'
    headers = {}
    if 'Range' in request.headers:
        headers['Range'] = request.headers['Range']

    try:
        resp = requests.get(node_url, headers=headers, stream=True, timeout=60)
        status = resp.status_code  # 206 or 200

        forward_headers = {
            'Content-Type': resp.headers.get('Content-Type', 'video/mp4'),
            'Accept-Ranges': 'bytes',
            'Access-Control-Allow-Origin': '*',
        }
        if 'Content-Range' in resp.headers:
            forward_headers['Content-Range'] = resp.headers['Content-Range']
        if 'Content-Length' in resp.headers:
            forward_headers['Content-Length'] = resp.headers['Content-Length']

        def generate():
            for chunk in resp.iter_content(chunk_size=65536):
                if chunk:
                    yield chunk

        flask_resp = app.make_response(generate())
        flask_resp.status_code = status
        for k, v in forward_headers.items():
            flask_resp.headers[k] = v
        return flask_resp

    except Exception as e:
        return str(e), 502


# ============================================================
# STATIC FILE SERVING
# ============================================================

@app.route('/')
def serve_index():
    return send_from_directory(BASE_DIR, 'index.html')


@app.route('/<path:filename>')
def serve_static(filename):
    return send_from_directory(BASE_DIR, filename)


# ============================================================
# MAIN
# ============================================================

if __name__ == '__main__':
    if not os.path.exists(DB_PATH):
        print("[Error] Database not found! Run 'python init_db.py' first.")
        exit(1)

    print("=" * 50)
    print("CineVault Backend Server")
    print("=" * 50)
    print(f"   Database: {DB_PATH}")
    print(f"   URL: http://localhost:{PORT}")
    print(f"   API: http://localhost:{PORT}/api/movies")
    print("=" * 50)

    app.run(host='0.0.0.0', port=PORT, debug=False)
