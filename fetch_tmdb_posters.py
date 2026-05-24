import json
import urllib.request
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
import time
import sys

def fetch_tmdb_poster(movie):
    if movie.get('poster_url'):
        return (movie['id'], movie['poster_url'])
        
    url = f"https://www.themoviedb.org/movie/{movie['id']}"
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'})
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            html = resp.read().decode('utf-8')
            match = re.search(r'<meta property=\"og:image\" content=\"([^\"]+)\"', html)
            if match:
                return (movie['id'], match.group(1))
    except Exception:
        pass
    return (movie['id'], None)

if __name__ == '__main__':
    with open('movies_data.json', 'r', encoding='utf-8') as f:
        movies = json.load(f)
        
    missing = [m for m in movies if not m.get('poster_url')]
    print(f"Loaded {len(movies)} movies. Fetching {len(missing)} missing posters using TMDB HTML scraping...")
    
    start_time = time.time()
    poster_dict = {}
    completed = 0
    total = len(missing)
    found = 0
    
    with ThreadPoolExecutor(max_workers=20) as executor:
        future_to_movie = {executor.submit(fetch_tmdb_poster, m): m for m in missing}
        
        for future in as_completed(future_to_movie):
            m_id, p_url = future.result()
            if p_url:
                poster_dict[m_id] = p_url
                found += 1
            completed += 1
            if completed % 100 == 0:
                print(f"Processed {completed}/{total} (Found {found} new)...")
                sys.stdout.flush()

    # Update JSON
    for m in movies:
        if m['id'] in poster_dict:
            m['poster_url'] = poster_dict[m['id']]
            
    with open('movies_data.json', 'w', encoding='utf-8') as f:
        json.dump(movies, f, ensure_ascii=False)
        
    print(f"\nCompleted! Found {found} new posters in {time.time() - start_time:.2f} seconds.")
