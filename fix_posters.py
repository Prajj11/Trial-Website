"""
Fast poster fixer for CineVault movies.
Uses TMDB API to fetch poster_path by movie ID, then builds full image URL.
Falls back to OMDb + Wikipedia for any that TMDB misses.
"""
import json
import urllib.request
import urllib.parse
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

TMDB_API_KEY = "2a6e79fa3b0306a6a5cf97ef52019b85"  # Public demo key
TMDB_IMG_BASE = "https://image.tmdb.org/t/p/w500"
HEADERS = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120'}

def fetch_tmdb_poster(movie):
    """Fetch poster from TMDB API using the movie's TMDB ID."""
    mid = movie['id']
    url = f"https://api.themoviedb.org/3/movie/{mid}?api_key={TMDB_API_KEY}&language=en-US"
    try:
        req = urllib.request.Request(url, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = json.loads(resp.read())
            poster_path = data.get('poster_path')
            if poster_path:
                return (mid, TMDB_IMG_BASE + poster_path, 'tmdb')
    except Exception:
        pass
    return (mid, None, 'tmdb_fail')

def try_omdb(movie):
    """OMDb fallback."""
    title = movie.get('title', '')
    year = str(movie.get('release_date', '')[:4])
    if not title:
        return None
    q = urllib.parse.quote(title)
    url = f"https://www.omdbapi.com/?t={q}&y={year}&apikey=trilogy"
    try:
        req = urllib.request.Request(url, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read())
            poster = data.get('Poster', '')
            if poster and poster != 'N/A':
                return poster
    except Exception:
        pass
    return None

def try_wikipedia(movie):
    """Wikipedia fallback."""
    title = movie.get('title', '')
    year = str(movie.get('release_date', '')[:4])
    if not title:
        return None
    candidates = [f"{title} ({year} film)", f"{title} (film)", title]
    for candidate in candidates:
        q = urllib.parse.quote(candidate)
        url = f"https://en.wikipedia.org/api/rest_v1/page/summary/{q}"
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=5) as resp:
                data = json.loads(resp.read())
                thumb = data.get('thumbnail', {}).get('source', '')
                if thumb:
                    thumb = re.sub(r'/\d+px-', '/500px-', thumb)
                    return thumb
        except Exception:
            pass
    return None

def fetch_with_fallbacks(movie):
    """Try TMDB first, then OMDb, then Wikipedia."""
    mid = movie['id']
    
    # 1. TMDB API (most reliable since we have TMDB IDs)
    mid, url, src = fetch_tmdb_poster(movie)
    if url:
        return (mid, url, 'tmdb')
    
    # 2. OMDb
    url = try_omdb(movie)
    if url:
        return (mid, url, 'omdb')
    
    # 3. Wikipedia
    url = try_wikipedia(movie)
    if url:
        return (mid, url, 'wiki')
    
    return (mid, None, 'none')

if __name__ == '__main__':
    with open('movies_data.json', 'r', encoding='utf-8') as f:
        movies = json.load(f)

    # Only fetch for movies missing posters (or with None/empty poster_url)
    missing = [m for m in movies if not m.get('poster_url') or m['poster_url'] is None or m['poster_url'] == 'None']
    total = len(missing)
    already_have = len(movies) - total
    
    print(f"[PosterFix] {len(movies)} total entries. {already_have} already have posters.", flush=True)
    print(f"[PosterFix] Fetching posters for {total} entries...", flush=True)
    
    if total == 0:
        print("Nothing to do!")
        sys.exit(0)
    
    poster_map = {}
    done = 0
    found = 0
    hits = {'tmdb': 0, 'omdb': 0, 'wiki': 0}
    
    # Use 15 workers to avoid rate limiting
    with ThreadPoolExecutor(max_workers=15) as ex:
        futures = {ex.submit(fetch_with_fallbacks, m): m for m in missing}
        for fut in as_completed(futures):
            mid, url, src = fut.result()
            done += 1
            if url:
                poster_map[mid] = url
                found += 1
                if src in hits:
                    hits[src] += 1
            if done % 100 == 0 or done == total:
                pct = (found / done * 100) if done else 0
                print(f"  {done}/{total} | Found {found} ({pct:.0f}%) | TMDB:{hits['tmdb']} OMDb:{hits['omdb']} Wiki:{hits['wiki']}", flush=True)
    
    # Update the JSON
    for m in movies:
        if m['id'] in poster_map:
            m['poster_url'] = poster_map[m['id']]
    
    with open('movies_data.json', 'w', encoding='utf-8') as f:
        json.dump(movies, f, ensure_ascii=False, separators=(',', ':'))
    
    still_missing = sum(1 for m in movies if not m.get('poster_url') or m['poster_url'] is None or m['poster_url'] == 'None')
    print(f"\n[PosterFix] Complete! New posters found: {found}/{total}", flush=True)
    print(f"  TMDB: {hits['tmdb']} | OMDb: {hits['omdb']} | Wiki: {hits['wiki']}", flush=True)
    print(f"  Final missing: {still_missing}/{len(movies)}", flush=True)
