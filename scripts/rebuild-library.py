"""Rebuild missing metadata without API keys. Never overwrite an existing library."""
import csv
import io
import json
import sqlite3
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import api.network
import requests

ROOT = Path(__file__).resolve().parents[1]
SOURCE = 'https://raw.githubusercontent.com/vamshi121/TMDB-5000-Movie-Dataset/main/tmdb_5000_movies.csv'
def rebuild():
    target = ROOT / 'cinevault.db'
    if target.exists():
        raise SystemExit('cinevault.db already exists; no files changed.')
    response = requests.get(SOURCE, timeout=60)
    response.raise_for_status()
    rows = list(csv.DictReader(io.StringIO(response.text)))
    if not rows or 'id' not in rows[0]:
        raise SystemExit('Movie source returned an unexpected format.')
    temporary = ROOT / 'cinevault.rebuilding.db'
    with sqlite3.connect(temporary) as db:
        db.executescript('''
            CREATE TABLE IF NOT EXISTS content (
              id INTEGER PRIMARY KEY, title TEXT, original_title TEXT, overview TEXT,
              original_language TEXT, release_date TEXT, vote_average REAL, vote_count INTEGER,
              popularity REAL, budget INTEGER, revenue INTEGER, runtime REAL, tagline TEXT,
              poster_url TEXT DEFAULT '', content_type TEXT, episodes INTEGER, anime_link TEXT,
              anilist_id INTEGER);
            CREATE TABLE IF NOT EXISTS genres (content_id INTEGER, genre TEXT, UNIQUE(content_id, genre));
            CREATE INDEX IF NOT EXISTS genre_lookup ON genres(genre, content_id);
            CREATE INDEX IF NOT EXISTS content_popularity ON content(popularity DESC);
        ''')
        fields = ['id', 'title', 'original_title', 'overview', 'original_language', 'release_date',
                  'vote_average', 'vote_count', 'popularity', 'budget', 'revenue', 'runtime', 'tagline']
        for row in rows:
            db.execute('INSERT OR IGNORE INTO content (' + ','.join(fields) + ',content_type) VALUES (' + ','.join('?' for _ in fields) + ',?)',
                       [row.get(k) or (0 if k in ('runtime', 'budget', 'revenue') else '') for k in fields] + ['movie'])
            for genre in json.loads(row['genres']):
                db.execute('INSERT OR IGNORE INTO genres VALUES (?,?)', (row['id'], genre['name']))
        print(f'Recovered metadata for {len(rows)} movies.', flush=True)
        # Jikan is a public, keyless API listed in public-apis/public-apis.
        try:
            r = requests.get('https://api.jikan.moe/v4/top/anime', params={'limit': 25}, timeout=15)
            r.raise_for_status()
            for anime in r.json()['data']:
                ident = 10000000 + anime['mal_id']  # Keep MAL IDs separate from TMDB IDs.
                db.execute('INSERT OR IGNORE INTO content (id,title,original_title,overview,original_language,release_date,vote_average,vote_count,popularity,poster_url,content_type,episodes,anime_link) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
                    (ident, anime.get('title_english') or anime['title'], anime['title'], anime.get('synopsis'), 'ja',
                     (anime.get('aired', {}).get('from') or '')[:10], anime.get('score') or 0, anime.get('scored_by') or 0,
                     anime.get('members') or 0, anime['images']['jpg']['large_image_url'], 'anime', anime.get('episodes'), anime['url']))
                for genre in anime.get('genres', []):
                    db.execute('INSERT OR IGNORE INTO genres VALUES (?,?)', (ident, genre['name']))
            print('Added 25 anime titles.', flush=True)
        except (requests.RequestException, ValueError, KeyError) as exc:
            print('Anime metadata currently unavailable:', type(exc).__name__, flush=True)
        # Recover covers for the initial discovery rows using the existing IMDb metadata source.
        from concurrent.futures import ThreadPoolExecutor
        top = db.execute("SELECT id,title,release_date FROM content WHERE content_type='movie' ORDER BY popularity DESC LIMIT 80").fetchall()
        def poster(row):
            ident, title, date = row
            try:
                q = requests.utils.quote(title.lower(), safe='')
                r = requests.get(f'https://v3.sg.media-imdb.com/suggestion/{q[0]}/{q}.json', timeout=6)
                r.raise_for_status()
                match = next((x for x in r.json().get('d', []) if str(x.get('y')) == date[:4] and x.get('i')), None)
                return ident, match['i']['imageUrl'] if match else ''
            except (requests.RequestException, ValueError, KeyError):
                return ident, ''
        for ident, url in ThreadPoolExecutor(4).map(poster, top):
            if url: db.execute('UPDATE content SET poster_url=? WHERE id=?', (url, ident))
    db.close()
    temporary.rename(target)
    try:
        import importlib.util
        spec = importlib.util.spec_from_file_location('import_anime', ROOT / 'scripts/import-anime.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        module.refresh()
    except Exception as exc:
        print('Anime refresh unavailable; retry python scripts/import-anime.py:', type(exc).__name__)
    (ROOT / 'LIBRARY-SOURCES.md').write_text('# Rebuilt library\n\nMovie metadata: ' + SOURCE + '\n\nHistorical TMDB 5000 dataset, not a current release catalog. Anime metadata: Jikan v4 (when reachable). Initial movie covers: IMDb suggestions. This replaces the missing library; it does not recover the exact original dataset. No API keys are required.\n', encoding='utf-8')
    print('Library ready.', flush=True)
if __name__ == '__main__':
    rebuild()
