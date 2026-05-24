import json
import urllib.request
import urllib.parse
from concurrent.futures import ThreadPoolExecutor, as_completed
import time
import sys

def fetch_poster(movie):
    # Returns (movie_id, img_url)
    title = movie.get('title', '')
    if not title:
        return (movie['id'], None)
    
    # Try searching with title + year for better accuracy in suggestive API?
    # Suggestive API is mostly by title prefix.
    safe_title = urllib.parse.quote(title.lower())
    first_char = safe_title[0] if safe_title else 'a'
    if not first_char.isalnum():
        first_char = 'a'
        
    url = f"https://v3.sg.media-imdb.com/suggests/{first_char}/{safe_title}.json"
    
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=5) as resp:
            content = resp.read().decode('utf-8')
            start = content.find('(') + 1
            end = content.rfind(')')
            if start > 0 and end > 0:
                data = json.loads(content[start:end])
                for item in data.get('d', []):
                    # We might want to match EXACT title or just take the first movie
                    if 'i' in item and item['i']:
                        img_url = item['i'][0]
                        # get higher quality image
                        if '._V1_' in img_url:
                            img_url = img_url.split('._V1_')[0] + '._V1_SX500.jpg'
                        return (movie['id'], img_url)
        return (movie['id'], None)
    except Exception as e:
        return (movie['id'], None)

if __name__ == '__main__':
    with open('movies_data.json', 'r', encoding='utf-8') as f:
        movies = json.load(f)
        
    print(f"Loaded {len(movies)} movies. Starting fetch with 50 threads...")
    
    start_time = time.time()
    
    poster_dict = {}
    completed = 0
    total = len(movies)
    
    with ThreadPoolExecutor(max_workers=50) as executor:
        future_to_movie = {executor.submit(fetch_poster, m): m for m in movies}
        
        for future in as_completed(future_to_movie):
            m_id, p_url = future.result()
            poster_dict[m_id] = p_url
            completed += 1
            if completed % 500 == 0:
                print(f"Processed {completed}/{total}...")
                sys.stdout.flush()

    for m in movies:
        new_url = poster_dict.get(m['id'])
        if new_url:  # Only update if we actually found a poster
            m['poster_url'] = new_url
        
    with open('movies_data.json', 'w', encoding='utf-8') as f:
        json.dump(movies, f, ensure_ascii=False)
        
    print(f"\nCompleted! Saved updated movies_data.json in {time.time() - start_time:.2f} seconds.")
