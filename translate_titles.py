import sqlite3
import time
from concurrent.futures import ThreadPoolExecutor
try:
    from deep_translator import GoogleTranslator
except ImportError:
    print("Please install deep-translator")
    import sys
    sys.exit(1)

db_path = 'cinevault.db'

def translate_batch(records):
    conn = sqlite3.connect(db_path, timeout=10)
    cursor = conn.cursor()
    updates = []
    
    translator = GoogleTranslator(source='auto', target='en')
    
    for mid, title in records:
        try:
            english_title = translator.translate(title)
            if english_title and english_title != title:
                updates.append((english_title, mid))
                print(f"Translated: {title} -> {english_title}")
        except Exception as e:
            print(f"Error translating {title}: {e}")

    if updates:
        for _ in range(5):
            try:
                cursor.executemany("UPDATE content SET title = ? WHERE id = ?", updates)
                conn.commit()
                break
            except sqlite3.OperationalError:
                time.sleep(0.5)
    conn.close()

def main():
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    # Get all non-English movies whose title is exactly the original_title
    cursor.execute("SELECT id, title FROM content WHERE original_language != 'en' AND title = original_title")
    records = cursor.fetchall()
    conn.close()

    print(f"Found {len(records)} movies to translate.")
    
    if not records:
        return

    batch_size = 50
    batches = [records[i:i + batch_size] for i in range(0, len(records), batch_size)]
    
    start_time = time.time()
    with ThreadPoolExecutor(max_workers=10) as executor:
        executor.map(translate_batch, batches)
        
    print(f"Done in {time.time() - start_time:.2f} seconds.")

if __name__ == '__main__':
    main()
