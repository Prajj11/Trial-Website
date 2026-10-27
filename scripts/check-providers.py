import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import api.network
import requests
from concurrent.futures import ThreadPoolExecutor

URLS = {
    'Jikan': 'https://api.jikan.moe/v4/top/anime?limit=1',
    'YTS': 'https://yts.mx/api/v2/list_movies.json?limit=1',
    'YTS API': 'https://movies-api.accel.li/api/v2/list_movies.json?limit=1',
    'Nyaa': 'https://nyaa.si/?page=rss&q=Big%20Buck%20Bunny',
    'AnimeTosho': 'https://feed.animetosho.org/json?search=Big%20Buck%20Bunny',
    'Movie dataset': 'https://raw.githubusercontent.com/vamshi121/TMDB-5000-Movie-Dataset/main/tmdb_5000_movies.csv',
}
def check(item):
    name, url = item
    try:
        r = requests.get(url, timeout=15)
        print(name, r.status_code, r.headers.get('Content-Type'), r.text[:80].replace('\n', ' '))
    except requests.RequestException as exc:
        print(name, type(exc).__name__)
if __name__ == '__main__':
    list(ThreadPoolExecutor(6).map(check, URLS.items()))
