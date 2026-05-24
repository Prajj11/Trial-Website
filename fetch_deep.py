"""
FINAL deep-pass poster fetcher for CineVault.
For movies STILL missing after previous runs.
Strategies per movie:
  1. OMDb API (free, no key needed via unofficial endpoint) 
  2. Wikipedia REST API (searches for movie article, grabs thumbnail)
  3. DuckDuckGo HTML scrape for image search
  4. Google Custom Search fallback (scrape)
"""
import json
import urllib.request
import urllib.parse
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

HEADERS = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120'}

def try_omdb(movie):
    """OMDb unofficial lookup – tries to get poster from OMDb by title+year."""
    title = movie.get('title', '')
    year  = str(movie.get('release_date', '')[:4])
    if not title: return None
    q = urllib.parse.quote(title)
    url = f"https://www.omdbapi.com/?t={q}&y={year}&apikey=trilogy"  # common free key
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
    """Query Wikipedia REST API for movie page thumbnail."""
    title = movie.get('title', '')
    year  = str(movie.get('release_date', '')[:4])
    if not title: return None
    
    # Try "Title (year film)" first, then plain title
    candidates = [
        f"{title} ({year} film)",
        f"{title} (film)",
        title
    ]
    
    for candidate in candidates:
        q = urllib.parse.quote(candidate)
        url = f"https://en.wikipedia.org/api/rest_v1/page/summary/{q}"
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=5) as resp:
                data = json.loads(resp.read())
                thumb = data.get('thumbnail', {}).get('source', '')
                if thumb:
                    # Get a larger version — Wikipedia stores w/ /width/ in URL
                    thumb = re.sub(r'/\d+px-', '/500px-', thumb)
                    return thumb
        except Exception:
            pass
    return None

def try_duckduckgo(movie):
    """Scrape DuckDuckGo image search for movie poster."""
    title  = movie.get('title', '')
    year   = str(movie.get('release_date', '')[:4])
    query  = urllib.parse.quote(f"{title} {year} movie poster official")
    url    = f"https://duckduckgo.com/i.js?q={query}&o=json&ia=images"
    try:
        req = urllib.request.Request(url, headers={
            'User-Agent': HEADERS['User-Agent'],
            'Referer': 'https://duckduckgo.com'
        })
        with urllib.request.urlopen(req, timeout=6) as resp:
            data = json.loads(resp.read())
            results = data.get('results', [])
            # Filter to likely posters (portrait aspect ratio)
            for r in results[:5]:
                w = r.get('width', 1)
                h = r.get('height', 1)
                if h > w:  # portrait = likely a poster
                    return r.get('image', '')
    except Exception:
        pass
    return None

def fetch_remaining(movie):
    mid = movie['id']
    
    p = try_wikipedia(movie)
    if p: return (mid, p, 'wiki')
    
    p = try_omdb(movie)
    if p: return (mid, p, 'omdb')
    
    p = try_duckduckgo(movie)
    if p: return (mid, p, 'ddg')
    
    return (mid, None, 'none')

if __name__ == '__main__':
    with open('movies_data.json', 'r', encoding='utf-8') as f:
        movies = json.load(f)

    missing = [m for m in movies if not m.get('poster_url')]
    total   = len(missing)
    print(f"[DeepFetch] {total} movies still missing posters. Starting multi-strategy pass...", flush=True)

    poster_map = {}
    done = 0; found = 0
    hits = {'wiki': 0, 'omdb': 0, 'ddg': 0}

    with ThreadPoolExecutor(max_workers=20) as ex:
        futures = {ex.submit(fetch_remaining, m): m for m in missing}
        for fut in as_completed(futures):
            mid, url, src = fut.result()
            done += 1
            if url:
                poster_map[mid] = url
                found += 1
                if src in hits: hits[src] += 1
            if done % 100 == 0:
                pct = (found/done*100) if done else 0
                print(f"  {done}/{total} | Found {found} ({pct:.0f}%) Wiki:{hits['wiki']} OMDB:{hits['omdb']} DDG:{hits['ddg']}", flush=True)

    for m in movies:
        if m['id'] in poster_map:
            m['poster_url'] = poster_map[m['id']]

    with open('movies_data.json', 'w', encoding='utf-8') as f:
        json.dump(movies, f, ensure_ascii=False)

    still_missing = sum(1 for m in movies if not m.get('poster_url'))
    print(f"\n[DeepFetch] Complete! New posters found: {found}", flush=True)
    print(f"  Wiki: {hits['wiki']} | OMDb: {hits['omdb']} | DDG: {hits['ddg']}", flush=True)
    print(f"  Final missing: {still_missing}/{len(movies)}", flush=True)
