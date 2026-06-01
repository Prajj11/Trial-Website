# 🎬 CineVault

CineVault is a premium, high-performance web application for discovering and streaming movies, TV shows, and anime. Built with a robust **Flask + SQLite** backend and a stunning, responsive **vanilla HTML/CSS/JS** frontend, CineVault delivers a beautiful, immersive, and fast cinematic experience.

---

## ✨ Features

### 📺 Advanced Streaming Engine
* **Multiple Stream Providers**: Seamlessly switches between top-tier embed players (**Videasy**, **VidSrc**, and **MultiEmbed**).
* **Direct HLS (m3u8) Playback**: Features a native HLS.js player for direct streaming of anime episodes without external iframes.
* **Auto-Cascade Fallback**: Automatically senses if a streaming source fails to load within 12 seconds and cascades to the next best source.
* **Sub/Dub Selector**: Switch languages on-the-fly for anime streams.

### 🌸 Deep Anime Integration (MyAnimeList & AniList)
* **Jikan API Proxy (v4)**: Real-time metadata integration fetching high-quality MyAnimeList scores, ranks, and popularity statistics.
* **Fast In-Memory Caching**: Implements localized background caching (15-min details TTL, 30-min episode TTL) with thread-safe stale-cache fallbacks to bypass Jikan rate limits.
* **Smart Episode Enrichment**: Dynamically imports episode-specific titles, filler status flags, and descriptions directly into the stream view.
* **AniList Bridge**: Automated MAL-to-AniList ID translation to fetch pre-resolved video assets for smooth anime playback.

### 📥 Desktop Torrent Integration
* **One-Click qBittorrent Download**: Instantly searches YTS indexers for high-quality movie prints, resolves the best magnet link, and opens it directly in your desktop qBittorrent client via native protocol handlers.
* **Kwik/Anikoto Download Engine**: Direct integration for downloading anime episodes with pagination.

### 🔍 Discovery & Personalization
* **Advanced Filters**: Browse by decade, minimum ratings, distinct genres, original languages, or content types (Movies vs. Anime).
* **Instant Autocomplete**: High-performance title/overview text search.
* **Personal Watchlist**: Quick bookmarking that persists across browser sessions using `localStorage`.

---

## 🛠️ Tech Stack

* **Backend**:
  * [Python](https://www.python.org/) & [Flask](https://flask.palletsprojects.com/) (Lightweight micro-framework)
  * [SQLite](https://www.sqlite.org/) (High-performance relational DB with WAL mode enabled for rapid concurrent reads)
  * [Requests](https://requests.readthedocs.io/) (Handling external proxy calls)
* **Frontend**:
  * **Vanilla HTML5 & CSS3**: Custom modern glassmorphism aesthetic with vibrant gradients, custom scrollbars, interactive micro-animations, and full dark-mode support.
  * **Vanilla JavaScript (ES6)**: State management, async loaders, search algorithms, and custom player injections.
  * [HLS.js](https://github.com/video-dev/hls.js/) (For native m3u8 anime feeds)

---

## 🚀 Getting Started

### 1. Prerequisites
Ensure you have Python 3.8+ installed on your system.

### 2. Install Dependencies
Install the required libraries using `pip`:
```bash
pip install flask flask-cors requests
```

### 3. Initialize the Database
Import the movie/anime CSV records and build the SQLite index:
```bash
python init_db.py
```
This generates the core `cinevault.db` file (~18.6 MB).

### 4. Run the Project
Start the Flask dev server:
```bash
python server.py
```

Open your browser and navigate to:
👉 **[http://localhost:8090](http://localhost:8090)**

---

## 🔌 API Documentation

CineVault is fully API-driven. The backend provides high-speed, paginated REST endpoints:

### Content Endpoints
* `GET /api/movies` — Filter, sort, search, and paginate movies and anime.
  * *Parameters:* `search`, `genre`, `lang`, `rating`, `year`, `type`, `sort`, `page`, `limit`
* `GET /api/movies/<id>` — Fetch full SQLite details for a specific entry.
* `GET /api/trending` — Top 15 content items sorted by popularity.
* `GET /api/genres` — Retrieve distinct genres in the library.
* `GET /api/languages` — Retrieve distinct languages with counts.
* `GET /api/stats` — High-level metrics for the home dashboard.

### Anime Proxy Endpoints
* `GET /api/jikan/search?q=<query>` — Quick MAL search query.
* `GET /api/jikan/anime/<mal_id>` — Cached MAL anime metadata details.
* `GET /api/jikan/anime/<mal_id>/episodes/all` — Cached auto-paginated full episode title directory.
* `GET /api/anilist/mal/<mal_id>` — Automated MAL-to-AniList translation.

---

## 🔒 Security & Privacy
* **Ad-Free Embedded Players**: The player containers use sandboxed iframes.
* **No Trackers**: Removed all external tracking scripts, advertising links, or flagged domains (such as *autoembed*) to ensure zero antivirus interference.
