import sqlite3

conn = sqlite3.connect('cinevault.db')
c = conn.cursor()

# Analyze poster URL domains
rows = c.execute("""
    SELECT 
        CASE 
            WHEN poster_url LIKE 'https://image.tmdb.org%' THEN 'tmdb'
            WHEN poster_url LIKE 'https://cdn.myanimelist%' THEN 'mal'
            WHEN poster_url LIKE 'https://upload.wikimedia%' THEN 'wiki'
            WHEN poster_url IS NULL OR poster_url = '' THEN 'none'
            ELSE 'other'
        END as src, 
        COUNT(*) as cnt 
    FROM content 
    GROUP BY src 
    ORDER BY cnt DESC
""").fetchall()
print("=== Poster URL Sources ===")
for r in rows:
    print(f"  {r[0]}: {r[1]}")

total = c.execute('SELECT COUNT(*) FROM content').fetchone()[0]
print(f"\nTotal records: {total}")

# Sample some poster URLs
print("\n=== Sample TMDB URLs ===")
for r in c.execute("SELECT poster_url FROM content WHERE poster_url LIKE 'https://image.tmdb.org%' LIMIT 3").fetchall():
    print(f"  {r[0]}")

print("\n=== Sample MAL URLs ===")
for r in c.execute("SELECT poster_url FROM content WHERE poster_url LIKE 'https://cdn.myanimelist%' LIMIT 3").fetchall():
    print(f"  {r[0]}")

print("\n=== Sample Other URLs ===")
for r in c.execute("SELECT poster_url FROM content WHERE poster_url NOT LIKE 'https://image.tmdb.org%' AND poster_url NOT LIKE 'https://cdn.myanimelist%' AND poster_url NOT LIKE 'https://upload.wikimedia%' AND poster_url IS NOT NULL AND poster_url != '' LIMIT 5").fetchall():
    print(f"  {r[0]}")

# Check TMDB image size patterns
print("\n=== TMDB URL patterns (size tokens) ===")
for r in c.execute("SELECT DISTINCT SUBSTR(poster_url, 32, 10) FROM content WHERE poster_url LIKE 'https://image.tmdb.org%' LIMIT 10").fetchall():
    print(f"  {r[0]}")

conn.close()
