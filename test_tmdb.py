import urllib.request
import re

url = "https://www.themoviedb.org/movie/19995"
req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'})
try:
    with urllib.request.urlopen(req) as resp:
        html = resp.read().decode('utf-8')
        match = re.search(r'<meta property=\"og:image\" content=\"([^\"]+)\"', html)
        if match:
            print("FOUND:", match.group(1))
        else:
            print("Not found in HTML")
except Exception as e:
    print("Error:", e)
