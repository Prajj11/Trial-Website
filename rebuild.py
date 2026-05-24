import csv, json, ast

movies = []
with open('tmdb_5000_movies.csv', encoding='utf-8') as f:
    reader = csv.DictReader(f)
    for row in reader:
        try:
            g = [x['name'] for x in ast.literal_eval(row['genres'])]
        except:
            g = []
        movies.append({
            'id': row['id'], 
            'title': row['title'], 
            'original_title': row['original_title'], 
            'overview': row['overview'], 
            'genres': g, 
            'original_language': row['original_language'], 
            'release_date': row['release_date'], 
            'vote_average': float(row['vote_average'] or 0), 
            'vote_count': int(row['vote_count'] or 0), 
            'popularity': float(row['popularity'] or 0), 
            'runtime': float(row['runtime'] or 0), 
            'budget': int(row['budget'] or 0), 
            'revenue': int(row['revenue'] or 0), 
            'tagline': row['tagline'], 
            'poster_url': None, 
            'content_type': 'movie'
        })

with open('movies_data.json', 'w', encoding='utf-8') as f:
    json.dump(movies, f)
print("Rebuilt movies_data.json.")
