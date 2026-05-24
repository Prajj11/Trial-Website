"""
CineVault — SQLite Database Initializer
========================================
Reads movies_data.json and imports all records into a SQLite database.
Creates separate tables for movies and genres with proper indexing.
"""

import json
import sqlite3
import os
import sys

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'cinevault.db')
JSON_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'movies_data.json')

def create_tables(conn):
    """Create the database schema."""
    cursor = conn.cursor()

    # Main content table (movies + anime)
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS content (
            id INTEGER PRIMARY KEY,
            title TEXT NOT NULL,
            original_title TEXT,
            overview TEXT,
            original_language TEXT,
            release_date TEXT,
            vote_average REAL DEFAULT 0,
            vote_count INTEGER DEFAULT 0,
            popularity REAL DEFAULT 0,
            runtime REAL DEFAULT 0,
            budget INTEGER DEFAULT 0,
            revenue INTEGER DEFAULT 0,
            tagline TEXT,
            poster_url TEXT,
            content_type TEXT DEFAULT 'movie',
            anime_link TEXT,
            episodes INTEGER DEFAULT 0,
            ranked INTEGER DEFAULT 0
        )
    ''')

    # Genres junction table (many-to-many)
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS genres (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            content_id INTEGER NOT NULL,
            genre TEXT NOT NULL,
            FOREIGN KEY (content_id) REFERENCES content(id)
        )
    ''')

    # Performance indexes
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_content_type ON content(content_type)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_content_language ON content(original_language)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_content_popularity ON content(popularity DESC)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_content_vote_avg ON content(vote_average DESC)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_content_release ON content(release_date)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_content_title ON content(title)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_genres_content ON genres(content_id)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_genres_genre ON genres(genre)')

    conn.commit()
    print("✅ Tables and indexes created.")


def import_data(conn):
    """Import data from movies_data.json into SQLite."""
    print(f"📂 Loading {JSON_PATH}...")

    with open(JSON_PATH, 'r', encoding='utf-8') as f:
        data = json.load(f)

    print(f"📊 Found {len(data)} records to import.")

    cursor = conn.cursor()

    # Clear existing data
    cursor.execute('DELETE FROM genres')
    cursor.execute('DELETE FROM content')
    conn.commit()

    # Batch insert for performance
    content_rows = []
    genre_rows = []

    for item in data:
        content_id = int(item.get('id', 0))
        content_rows.append((
            content_id,
            item.get('title', ''),
            item.get('original_title', ''),
            item.get('overview', ''),
            item.get('original_language', ''),
            item.get('release_date', ''),
            float(item.get('vote_average', 0) or 0),
            int(item.get('vote_count', 0) or 0),
            float(item.get('popularity', 0) or 0),
            float(item.get('runtime', 0) or 0),
            int(item.get('budget', 0) or 0),
            int(item.get('revenue', 0) or 0),
            item.get('tagline', ''),
            item.get('poster_url', None),
            item.get('content_type', 'movie'),
            item.get('anime_link', None),
            int(item.get('episodes', 0) or 0),
            int(item.get('ranked', 0) or 0)
        ))

        for genre in (item.get('genres') or []):
            genre_rows.append((content_id, genre))

    # Use INSERT OR REPLACE to handle duplicate IDs
    cursor.executemany('''
        INSERT OR REPLACE INTO content (
            id, title, original_title, overview, original_language,
            release_date, vote_average, vote_count, popularity,
            runtime, budget, revenue, tagline, poster_url,
            content_type, anime_link, episodes, ranked
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ''', content_rows)

    cursor.executemany('''
        INSERT INTO genres (content_id, genre) VALUES (?, ?)
    ''', genre_rows)

    conn.commit()

    # Stats
    cursor.execute('SELECT COUNT(*) FROM content')
    total = cursor.fetchone()[0]
    cursor.execute("SELECT COUNT(*) FROM content WHERE content_type = 'movie'")
    movies = cursor.fetchone()[0]
    cursor.execute("SELECT COUNT(*) FROM content WHERE content_type = 'anime'")
    anime = cursor.fetchone()[0]
    cursor.execute('SELECT COUNT(DISTINCT genre) FROM genres')
    genres = cursor.fetchone()[0]
    cursor.execute('SELECT COUNT(DISTINCT original_language) FROM content')
    langs = cursor.fetchone()[0]

    print(f"\n✅ Import complete!")
    print(f"   📽️  Total records: {total:,}")
    print(f"   🎬 Movies: {movies:,}")
    print(f"   🎌 Anime: {anime:,}")
    print(f"   🏷️  Genres: {genres}")
    print(f"   🌍 Languages: {langs}")
    print(f"   💾 Database: {DB_PATH}")


def main():
    if not os.path.exists(JSON_PATH):
        print(f"❌ Error: {JSON_PATH} not found!")
        sys.exit(1)

    print("🎬 CineVault SQLite Initializer")
    print("=" * 40)

    conn = sqlite3.connect(DB_PATH)
    try:
        create_tables(conn)
        import_data(conn)
    finally:
        conn.close()

    # Show file size
    size_mb = os.path.getsize(DB_PATH) / (1024 * 1024)
    print(f"\n   📦 Database size: {size_mb:.1f} MB")
    print("\n🚀 Ready! Run 'python server.py' to start the backend.")


if __name__ == '__main__':
    main()
