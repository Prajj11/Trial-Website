import urllib.request
import json
import urllib.parse
title = 'The Matrix'
url = 'https://itunes.apple.com/search?term=' + urllib.parse.quote(title) + '&entity=movie&limit=1'
req = urllib.request.Request(url)
try:
    with urllib.request.urlopen(req) as response:
        data = json.loads(response.read().decode('utf-8'))
        if data['resultCount'] > 0:
            poster = data['results'][0]['artworkUrl100'].replace('100x100bb', '600x600bb')
            print('Found Poster:', poster)
            print('Title:', data['results'][0]['trackName'])
            print('Year:', data['results'][0]['releaseDate'])
except Exception as e:
    print('Error:', e)
