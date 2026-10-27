# Rebuilt library

The original database was absent. The replacement contains 4,803 historical movie records from the [TMDB 5000 dataset](https://github.com/vamshi121/TMDB-5000-Movie-Dataset/blob/main/tmdb_5000_movies.csv), plus 50 popular anime records from [AniList](https://docs.anilist.co/).

Initial movie covers are matched through the existing IMDb suggestion API. Titles without covers use a designed placeholder. Movie metadata is historical; this is not a current release catalog or an exact restoration of the missing library.

The [public-apis directory](https://github.com/public-apis/public-apis) lists Jikan and AniList metadata APIs. It does not supply private credentials or guarantee video availability. This rebuild requires no API keys.

Run `python scripts/rebuild-library.py` only when the database is missing. It refuses to overwrite an existing library. Run `python scripts/import-anime.py` to refresh the anime selection.
