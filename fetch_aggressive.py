"""
Aggressive multi-strategy poster fetcher for CineVault.
Strategy order per movie:
  1. Already has poster -> skip
  2. IMDb Suggest API  (fast, instant)
  3. TMDB HTML scrape  (using TMDB movie ID)
  4. DuckDuckGo Image  (last resort — searches "{title} {year} movie poster")
"""

import json
import urllib.request
import urllib.parse
import re
import time
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed

HEADERS = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}

def try_imdb(movie):
    title = movie.get('title', '')
    if not title:
        return None
    safe = urllib.parse.quote(title.lower())
    first = safe[0] if safe and safe[0].isalnum() else 'a'
    url = f"https://v3.sg.media-imdb.com/suggests/{first}/{safe}.json"
    try:
        req = urllib.request.Request(url, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=5) as resp:
            text = resp.read().decode('utf-8')
            start = text.find('(') + 1
            end   = text.rfind(')')
            if start > 0 and end > 0:
                data = json.loads(text[start:end])
                year = str(movie.get('release_date', '')[:4])
                for item in data.get('d', []):
                    # prefer items whose year matches
                    item_year = str(item.get('y', ''))
                    if 'i' in item and item['i']:
                        img = item['i'][0]
                        if year and item_year == year:
                            if '._V1_' in img:
                                img = img.split('._V1_')[0] + '._V1_SX500.jpg'
                            return img
                # fallback: first result with image
                for item in data.get('d', []):
                    if 'i' in item and item['i']:
                        img = item['i'][0]
                        if '._V1_' in img:
                            img = img.split('._V1_')[0] + '._V1_SX500.jpg'
                        return img
    except Exception:
        pass
    return None

def try_tmdb(movie):
    mid = movie.get('id')
    if not mid:
        return None
    url = f"https://www.themoviedb.org/movie/{mid}"
    try:
        req = urllib.request.Request(url, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=6) as resp:
            html = resp.read().decode('utf-8')
            m = re.search(r'<meta property="og:image" content="([^"]+)"', html)
            if m:
                return m.group(1)
    except Exception:
        pass
    return None

def try_ddg(movie):
    title = movie.get('title', '')
    year  = str(movie.get('release_date', '')[:4])
    q = urllib.parse.quote(f"{title} {year} movie poster")
    url = f"https://duckduckgo.com/?q={q}&iax=images&ia=images&format=json"
    # DDG doesn't have a clean image JSON so skip for now — placeholder
    return None

def fetch_poster_for(movie):
    mid = movie['id']
    # Strategy 1: IMDb
    p = try_imdb(movie)
    if p:
        return (mid, p, 'imdb')
    # Strategy 2: TMDB HTML
    p = try_tmdb(movie)
    if p:
        return (mid, p, 'tmdb')
    return (mid, None, 'none')

if __name__ == '__main__':
    with open('movies_data.json', 'r', encoding='utf-8') as f:
        movies = json.load(f)

    missing = [m for m in movies if not m.get('poster_url')]
    total   = len(missing)
    print(f"[AggressiveFetch] {total} movies missing posters. Starting...", flush=True)

    poster_map = {}
    done  = 0
    found = 0
    imdb_hits = 0
    tmdb_hits = 0

    with ThreadPoolExecutor(max_workers=30) as ex:
        futures = {ex.submit(fetch_poster_for, m): m for m in missing}
        for fut in as_completed(futures):
            mid, url, src = fut.result()
            done += 1
            if url:
                poster_map[mid] = url
                found += 1
                if src == 'imdb': imdb_hits += 1
                elif src == 'tmdb': tmdb_hits += 1
            if done % 200 == 0:
                print(f"  {done}/{total} processed | {found} found (IMDb:{imdb_hits} TMDB:{tmdb_hits})", flush=True)

    # Write back
    for m in movies:
        if m['id'] in poster_map:
            m['poster_url'] = poster_map[m['id']]

    with open('movies_data.json', 'w', encoding='utf-8') as f:
        json.dump(movies, f, ensure_ascii=False)

    still_missing = sum(1 for m in movies if not m.get('poster_url'))
    print(f"\n[AggressiveFetch] Done! Found {found} new posters.", flush=True)
    print(f"  IMDb: {imdb_hits} | TMDB: {tmdb_hits}", flush=True)
    print(f"  Still missing: {still_missing}/{len(movies)}", flush=True)
