# CineVault repair notes

## Start

Use Python 3.10+ and Node 24+. Run `python -m pip install -r requirements.txt`, `npm install`, then `python start_cinevault.py`. Open http://127.0.0.1:8090. The launcher rebuilds missing metadata and starts the local helper services without extra console windows.

## Changes

- Rebuilt the missing database; see LIBRARY-SOURCES.md for provenance and limits.
- Python uses the operating system certificate store without disabling verification.
- Movie torrent searches now use the backend and the responding YTS API at `movies-api.accel.li/api/v2`. Override with the `YTS_API_BASE` environment variable if the operator changes it. The API's returned website domain is `yts.gg`.
- Downloads are real release choices, with size, quality and seed count. Magnet links open the user's configured torrent client; they cannot guarantee qBittorrent is installed.
- Nyaa RSS can construct magnets from infoHash, even when magnetUri is absent.
- The torrent helper validates magnets, coalesces duplicate metadata requests, times out dead swarms, chooses the largest video, handles byte ranges and HEAD, reports correct MIME types, and offers attachment downloads. Closing/switching players stops their torrent and polling.
- HLS master playlists, alternate audio, keys and initialization segments are rewritten correctly; ranged segments and disconnected streams are handled.
- Added manual magnet playback, fixed progress percentages, prevented late torrent results from reopening closed players, and stopped using anime catalog IDs as TMDB movie IDs.
- Refined the homepage, card styling, downloads and responsive layouts. Removed the decorative petal animation.
- Private project files and the database are no longer served as static assets.

## Verification and limits

`npm test` covers syntax plus regression checks for ranges, file selection, MIME types, attachment downloads, cleanup, duplicate starts, dead-swarm timeout, an actual local WebTorrent file transfer, Nyaa RSS, YTS matching, Flask error propagation and nested HLS rewriting.

Live checks: movie and anime catalogs load; YTS search returned releases. Nyaa responded initially but later failed, and several anime scraper providers timed out. The public Sintel torrent did not supply metadata within the timeout on this connection. Embedded player loading is not proof that a video plays; cross-origin players must be checked manually, and source availability varies. Browser playback also depends on codecs (MP4/H.264 and WebM are generally the best choices; MKV/HEVC may require VLC).

An additional end-to-end check seeded the Blender Sintel trailer locally, transferred it into the actual torrent helper, played it in the browser (readyState 4, advancing playback time, no media error), and clicked Save video. The downloaded file's SHA-256 matched the source exactly. Videasy also loaded the correct embedded movie page; full playback of that external movie was not verified.

The local stream/download implementation is tested; universal external-provider availability and public-swarm playback are not verified. No third-party service uptime is guaranteed.
