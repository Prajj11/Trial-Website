import requests

# Jikan MyAnimeList Unofficial API Python Example
# Jikan is a public API that provides anime and manga data.
# Note: Jikan API no longer requires an API key. 
# Also, we are using the v4 API endpoints here as v3 has been deprecated.

BASE_URL = "https://api.jikan.moe/v4"
HEADERS = {
    "Content-Type": "application/json"
}

def search_anime(query):
    """To search for an anime, we can use the search endpoint."""
    url = f"{BASE_URL}/anime?q={query}"
    response = requests.get(url, headers=HEADERS)
    response.raise_for_status()
    return response.json()

def get_anime_details(anime_id):
    """To retrieve anime details, we can use the anime endpoint."""
    url = f"{BASE_URL}/anime/{anime_id}"
    response = requests.get(url, headers=HEADERS)
    response.raise_for_status()
    return response.json()

def get_anime_episodes(anime_id, page=1):
    """To retrieve anime episodes, we can use the episodes endpoint."""
    # Note: In v4, pagination is handled via query parameters.
    url = f"{BASE_URL}/anime/{anime_id}/episodes?page={page}"
    response = requests.get(url, headers=HEADERS)
    response.raise_for_status()
    return response.json()

if __name__ == "__main__":
    # Example Code
    try:
        print("Searching for Anime: Naruto...")
        search_data = search_anime("naruto")
        # Print just a snippet so the console isn't flooded
        print(f"Found {search_data.get('pagination', {}).get('items', {}).get('total', 0)} results.")
        
        print("\nFetching Anime Details (ID: 20)...")
        details_data = get_anime_details(20)
        print(f"Title: {details_data.get('data', {}).get('title')}")
        
        print("\nFetching Anime Episodes (ID: 20, Page: 1)...")
        episodes_data = get_anime_episodes(20, 1)
        episodes_list = episodes_data.get('data', [])
        print(f"Found {len(episodes_list)} episodes on page 1.")
        
    except requests.exceptions.RequestException as e:
        print(f"An error occurred: {e}")
