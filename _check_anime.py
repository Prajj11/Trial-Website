import sqlite3
conn = sqlite3.connect('cinevault.db')
rows = conn.execute("SELECT id, title, anime_link, episodes FROM content WHERE content_type='anime' LIMIT 5").fetchall()
for r in rows:
    print(list(r))
conn.close()
