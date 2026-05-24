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
import sqlite3
import json
import time
import requests
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS

# --- Config ---
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, 'cinevault.db')
PORT = 8090

app = Flask(__name__, static_folder=BASE_DIR)
CORS(app)


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

    app.run(host='0.0.0.0', port=PORT, debug=True)
