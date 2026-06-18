import sqlite3
import requests
import time
import urllib.parse
from concurrent.futures import ThreadPoolExecutor

db_path = 'cinevault.db'

def get_imdb_poster(title):
    try:
        # First letter of title for the URL path
        q = urllib.parse.quote(title.lower())
        first_letter = q[0] if q else 'a'
        url = f"https://v3.sg.media-imdb.com/suggestion/{first_letter}/{q}.json"
        r = requests.get(url, headers={'User-Agent': 'Mozilla/5.0'}, timeout=5)
        if r.status_code == 200:
            data = r.json()
            if 'd' in data and len(data['d']) > 0:
                for item in data['d']:
                    if 'i' in item and 'imageUrl' in item['i']:
                        return item['i']['imageUrl']
    except Exception as e:
        pass
    return None

def process_batch(records):
    conn = sqlite3.connect(db_path, timeout=10)
    cursor = conn.cursor()
    updates = []
    for mid, title in records:
        url = get_imdb_poster(title)
        if url:
            updates.append((url, mid))
    
    # Retry logic for DB locking
    if updates:
        for _ in range(5):
            try:
                cursor.executemany("UPDATE content SET poster_url = ? WHERE id = ?", updates)
                conn.commit()
                break
            except sqlite3.OperationalError:
                time.sleep(0.5)
    conn.close()

def main():
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    cursor.execute('SELECT id, title FROM content WHERE poster_url IS NULL')
    records = cursor.fetchall()
    conn.close()

    print(f"Found {len(records)} movies missing posters. Fetching...")
    
    batch_size = 50
    batches = [records[i:i + batch_size] for i in range(0, len(records), batch_size)]
    
    start_time = time.time()
    with ThreadPoolExecutor(max_workers=20) as executor:
        executor.map(process_batch, batches)
        
    print(f"Done in {time.time() - start_time:.2f} seconds.")

if __name__ == '__main__':
    main()
