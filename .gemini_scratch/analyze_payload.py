import sqlite3, json

conn = sqlite3.connect('cinevault.db')
c = conn.cursor()

movies = c.execute("SELECT COUNT(*) FROM content WHERE content_type = 'movie'").fetchone()[0]
anime = c.execute("SELECT COUNT(*) FROM content WHERE content_type = 'anime'").fetchone()[0]
no_poster = c.execute("SELECT COUNT(*) FROM content WHERE poster_url IS NULL OR poster_url = ''").fetchone()[0]

print(f"Movies: {movies}")
print(f"Anime: {anime}")
print(f"No poster: {no_poster}")
print(f"Total: {movies + anime}")

# Check response size of /api/movies/all equivalent
rows = c.execute("SELECT * FROM content ORDER BY popularity DESC").fetchall()
cols = [d[0] for d in c.description]
items = [dict(zip(cols, r)) for r in rows]
data = json.dumps(items)
print(f"\nJSON payload size for all content: {len(data) / 1024 / 1024:.1f} MB")
print(f"Record count: {len(items)}")

# Check MAL poster hotlink issue
print("\n=== MAL poster URL samples (check if they have hotlink protection) ===")
for r in c.execute("SELECT title, poster_url FROM content WHERE poster_url LIKE 'https://cdn.myanimelist%' LIMIT 5").fetchall():
    print(f"  {r[0]}: {r[1]}")

conn.close()
