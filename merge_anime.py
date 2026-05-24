"""
Merge animes.csv into movies_data.json.
Anime entries are normalized to match the movie schema,
with content_type='anime' so the UI can treat them differently.
"""
import csv, json, ast, re

# ── Load existing movies ──────────────────────────────────────
with open('movies_data.json', encoding='utf-8') as f:
    movies = json.load(f)

existing_ids = {m['id'] for m in movies}
print(f"Existing movies: {len(movies)}")

# Max existing id so we don't collide
max_id = max(int(m['id']) for m in movies)

# ── Parse animes.csv ─────────────────────────────────────────
anime_entries = []
skipped = 0

def parse_genre(raw):
    """Parse Python-list strings like "['Comedy', 'Drama']" """
    try:
        return ast.literal_eval(raw)
    except Exception:
        # fallback: strip brackets and split
        raw = raw.strip("[]")
        return [g.strip().strip("'\"") for g in raw.split(',') if g.strip()]

def parse_year(aired):
    """Extract 4-digit year from 'Oct 4, 2015 to Mar 27, 2016'"""
    m = re.search(r'\d{4}', aired or '')
    return m.group(0) if m else ''

with open('animes.csv', encoding='utf-8', errors='replace', newline='') as f:
    reader = csv.DictReader(f)
    for row in reader:
        # Extra aggressive filter: check all columns for 'hentai' and 'henati'
        if any('hentai' in str(v).lower() or 'henati' in str(v).lower() for v in row.values()):
            skipped += 1
            continue

        uid = int(row.get('uid', 0))
        title = row.get('title', '').strip()
        if not title:
            skipped += 1
            continue

        # Generate a unique id that won't clash with TMDB ids
        # We use 9_000_000 + uid as a safe namespace
        entry_id = 9_000_000 + uid

        genres  = parse_genre(row.get('genre', '[]'))
        
        # Filter out Hentai
        if any(g.lower() == 'hentai' for g in genres):
            skipped += 1
            continue

        year    = parse_year(row.get('aired', ''))
        score   = row.get('score', '').strip()
        score   = float(score) if score and score != 'nan' else 0.0
        members = row.get('members', '').strip()
        members = int(float(members)) if members else 0
        ranked  = row.get('ranked', '').strip()
        ranked  = int(float(ranked)) if ranked and ranked != 'nan' else 0
        eps     = row.get('episodes', '').strip()
        eps     = int(float(eps)) if eps and eps != 'nan' else 0
        img_url = row.get('img_url', '').strip()
        link    = row.get('link', '').strip()
        synopsis= row.get('synopsis', '').strip()

        entry = {
            "id":                entry_id,
            "title":             title,
            "original_title":    title,
            "overview":          synopsis,
            "genres":            genres,
            "original_language": "ja",          # almost all anime is Japanese
            "release_date":      year + "-01-01" if year else "",
            "vote_average":      round(score, 2),
            "vote_count":        members,
            "popularity":        members / 1000.0,  # normalize for sorting
            "runtime":           0,
            "budget":            0,
            "revenue":           0,
            "tagline":           "",
            "poster_url":        img_url,
            "content_type":      "anime",          # ← new field
            "anime_link":        link,              # MAL page
            "episodes":          eps,
            "ranked":            ranked
        }
        anime_entries.append(entry)

print(f"Parsed anime entries: {len(anime_entries)} | Skipped: {skipped}")

# ── Merge ─────────────────────────────────────────────────────
merged = movies + anime_entries
print(f"Total after merge: {len(merged)}")

with open('movies_data.json', 'w', encoding='utf-8') as f:
    json.dump(merged, f, ensure_ascii=False)

print("Done! movies_data.json updated.")

# Quick sanity check
with open('movies_data.json', encoding='utf-8') as f:
    data = json.load(f)
movies_count = sum(1 for d in data if d.get('content_type') != 'anime')
anime_count  = sum(1 for d in data if d.get('content_type') == 'anime')
print(f"  Movies: {movies_count} | Anime: {anime_count} | Total: {len(data)}")
