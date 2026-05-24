import json
import urllib.request
import urllib.parse
from concurrent.futures import ThreadPoolExecutor
import time

def fetch_poster(movie):
    title = movie['title']
    safe_title = urllib.parse.quote(title.lower())
    # The IMDb suggests API usually expects the first character
    first_char = safe_title[0] if safe_title else 'a'
    
    # Check if first char is alphanumeric, else fallback
    if not first_char.isalnum():
        first_char = 'a'
        
    url = f"https://v3.sg.media-imdb.com/suggests/{first_char}/{safe_title}.json"
    
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=3) as resp:
            content = resp.read().decode('utf-8')
            start = content.find('(') + 1
            end = content.rfind(')')
            if start > 0 and end > 0:
                data = json.loads(content[start:end])
                for item in data.get('d', []):
                    if 'i' in item and item['i']:
                        # item['i'][0] is the imageUrl
                        img_url = item['i'][0]
                        # get higher quality image if possible
                        if '._V1_' in img_url:
                            img_url = img_url.split('._V1_')[0] + '._V1_SX500.jpg'
                        return img_url
        return None
    except Exception as e:
        return None

if __name__ == '__main__':
    with open('movies_data.json', 'r', encoding='utf-8') as f:
        movies = json.load(f)
        
    print(f"Loaded {len(movies)} movies. Testing first 20...")
    
    start_time = time.time()
    results = []
    
    # Take first 20
    test_movies = movies[:20]
    
    with ThreadPoolExecutor(max_workers=10) as executor:
        posters = list(executor.map(fetch_poster, test_movies))
        
    for m, p in zip(test_movies, posters):
        print(f"{m['title']}: {p}")
        
    print(f"Tested {len(test_movies)} in {time.time() - start_time:.2f} seconds.")
