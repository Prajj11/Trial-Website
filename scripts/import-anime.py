"""Refresh anime metadata from the public AniList API without API keys."""
import sys, sqlite3, re
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import api.network
import requests
ROOT = Path(__file__).resolve().parents[1]
QUERY = '{ Page(perPage:50) { media(type:ANIME,sort:POPULARITY_DESC,isAdult:false) { id idMal title { english romaji } description episodes averageScore popularity coverImage { large } genres startDate { year month day } } } }'
def refresh():
    response = requests.post('https://graphql.anilist.co', json={'query': QUERY}, timeout=25)
    response.raise_for_status()
    items = response.json()['data']['Page']['media']
    db = sqlite3.connect(ROOT / 'cinevault.db')
    try:
        if 'anilist_id' not in [r[1] for r in db.execute('PRAGMA table_info(content)')]:
            db.execute('ALTER TABLE content ADD COLUMN anilist_id INTEGER')
        for anime in items:
            if not anime['idMal']: continue
            ident = 10000000 + anime['idMal']
            date = anime['startDate']
            db.execute('INSERT OR REPLACE INTO content (id,title,original_title,overview,original_language,release_date,vote_average,vote_count,popularity,poster_url,content_type,episodes,anime_link,anilist_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                (ident, anime['title']['english'] or anime['title']['romaji'], anime['title']['romaji'],
                 re.sub('<[^>]+>', '', anime.get('description') or ''), 'ja',
                 f"{date['year'] or 0:04d}-{date['month'] or 1:02d}-{date['day'] or 1:02d}",
                 (anime.get('averageScore') or 0) / 10, 0, (anime.get('popularity') or 0) / 1000,
                 anime['coverImage']['large'], 'anime', anime['episodes'], f"https://myanimelist.net/anime/{anime['idMal']}", anime['id']))
            db.execute('DELETE FROM genres WHERE content_id=?', (ident,))
            db.executemany('INSERT INTO genres VALUES (?,?)', [(ident, g) for g in anime['genres']])
        db.commit()
        print(f'Imported {len(items)} anime titles from AniList.')
    finally:
        db.close()
if __name__ == '__main__': refresh()
