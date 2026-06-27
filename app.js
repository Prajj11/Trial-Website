/* ======================================================
   CINEVAULT — ADVANCED APP LOGIC (v3 — qBittorrent Edition)
   ====================================================== */

// --- Config ---
const CONFIG = { PAGE_SIZE: 24, API_BASE: '/api', JSON_URL: '/api/movies/all' };

// --- Image fallback helper ---
// Tries to build a working poster URL when the primary one fails.
function handlePosterError(img) {
  // Prevent infinite loops
  if (img.dataset.fallbackAttempted) {
    img.style.display = 'none';
    if (img.nextElementSibling) img.nextElementSibling.style.display = 'flex';
    return;
  }
  img.dataset.fallbackAttempted = 'true';

  // If the original URL was MAL or Wikipedia, try without referrer via a proxy-less approach
  // The referrerpolicy attribute already handles most cases, so just show fallback
  img.style.display = 'none';
  if (img.nextElementSibling) img.nextElementSibling.style.display = 'flex';
}

const LANG_MAP = {
  en: { name: 'English', flag: '🇺🇸', region: 'am' }, hi: { name: 'Hindi', flag: '🇮🇳', region: 'as' },
  fr: { name: 'French', flag: '🇫🇷', region: 'eu' }, de: { name: 'German', flag: '🇩🇪', region: 'eu' },
  es: { name: 'Spanish', flag: '🇪🇸', region: 'eu' }, it: { name: 'Italian', flag: '🇮🇹', region: 'eu' },
  ja: { name: 'Japanese / Anime', flag: '🇯🇵', region: 'as' }, ko: { name: 'Korean', flag: '🇰🇷', region: 'as' },
  zh: { name: 'Chinese', flag: '🇨🇳', region: 'as' }, pt: { name: 'Portuguese', flag: '🇧🇷', region: 'am' },
  ru: { name: 'Russian', flag: '🇷🇺', region: 'eu' }, ar: { name: 'Arabic', flag: '🇸🇦', region: 'me' },
  ta: { name: 'Tamil', flag: '🇮🇳', region: 'as' }, te: { name: 'Telugu', flag: '🇮🇳', region: 'as' },
  th: { name: 'Thai', flag: '🇹🇭', region: 'as' }, tr: { name: 'Turkish', flag: '🇹🇷', region: 'me' },
  nl: { name: 'Dutch', flag: '🇳🇱', region: 'eu' }, sv: { name: 'Swedish', flag: '🇸🇪', region: 'eu' },
  da: { name: 'Danish', flag: '🇩🇰', region: 'eu' }, pl: { name: 'Polish', flag: '🇵🇱', region: 'eu' },
  cn: { name: 'Cantonese', flag: '🇭🇰', region: 'as' }
};

const GENRE_ICON = {
  Action: '⚔️', Adventure: '🗺️', Animation: '🎨', Comedy: '😂', Crime: '🕵️‍♂️',
  Documentary: '📽️', Drama: '🎭', Family: '👨‍👩‍👧', Fantasy: '🧙', History: '📜',
  Horror: '👻', Music: '🎵', Mystery: '🔎', Romance: '❤️', Science: '🔬',
  'Science Fiction': '🚀', Thriller: '😱', War: '🪖', Western: '🤠'
};

// --- Storage Helper ---
function getStorage(key, def) { try { return localStorage.getItem(key) || def; } catch (e) { return def; } }

let cinevaultEpisodes = null;

// --- State ---
let appState = {
  movies: [], filtered: [], currentPage: 1,
  watchlist: JSON.parse(getStorage('cv_watchlist', '[]')),
  theme: getStorage('cv_theme', 'dark'),
  viewMode: getStorage('cv_view', 'grid'),
  activeLanguage: null,
  movieGenres: new Set(),
  animeGenres: new Set(),
  moviesById: {},
  languagesData: [],
  serverTotal: 0,
  serverTotalPages: 0
};

// --- Data cache helpers ---
function cacheMovies(items) {
  items.forEach(m => { appState.moviesById[m.id] = m; });
}

function getProxiedPosterUrl(url) {
  if (!url) return '';
  try {
    const u = new URL(url);
    const proxyDomains = ['cdn.myanimelist.net', 'm.media-amazon.com'];
    if (proxyDomains.some(d => u.hostname === d || u.hostname.endsWith('.' + d))) {
      return CONFIG.API_BASE + '/poster-proxy?url=' + encodeURIComponent(url);
    }
  } catch (e) { }
  return url;
}

// ============================================================
// TORRENT ENGINE — YTS API + qBittorrent Integration
// ============================================================
const TRACKERS = [
  'udp://open.demonii.com:1337/announce',
  'udp://tracker.openbittorrent.com:6969',
  'udp://tracker.coppersurfer.tk:6969',
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://p4p.arenabg.com:1337',
  'udp://tracker.leechers-paradise.org:6969'
].map(t => '&tr=' + encodeURIComponent(t)).join('');

// ============================================================
// KWIK.CX / ANIKOTO DOWNLOAD ENGINE
// ============================================================
// kwik.cx is a video host used by Anikoto. Since kwik.cx has no public API
// and uses anti-scraping measures (JS obfuscation, session tokens, referer checks),
// we link users to Anikoto which provides the kwik-hosted downloads with a
// proper UI, and also offer direct kwik.cx search fallbacks.

function buildAnikotoUrl(title) {
  // Anikoto search page
  return 'https://anikototv.to/filter?keyword=' + encodeURIComponent(title);
}

function buildKwikSearchUrl(title, episode) {
  // Since kwik.cx doesn't have a search — link to Anikoto which hosts on kwik
  const q = episode ? title + ' Episode ' + episode : title;
  return 'https://anikototv.to/filter?keyword=' + encodeURIComponent(title);
}

function openKwikDownload(title, episode) {
  const url = buildAnikotoUrl(title);
  window.open(url, '_blank', 'noopener');
  showToast('🔗 Opening Anikoto (Kwik) for ' + title + (episode ? ' Ep ' + episode : '') + '...');
}

function downloadAnimeEpisode(movieId, episode) {
  const movie = appState.moviesById[movieId];
  if (!movie) return;
  const title = movie.title;
  openKwikDownload(title, episode);
}

function renderEpisodeDownloadGrid(movieId, startEp, endEp) {
  const movie = appState.moviesById[movieId];
  if (!movie) return;
  const container = document.getElementById('kwik-episode-grid');
  if (!container) return;

  let html = '';
  for (let ep = startEp; ep <= endEp; ep++) {
    html += '<div class="ep-action-group" style="display:flex;gap:4px;margin-bottom:4px;">' +
      '<button class="kwik-ep-btn" onclick="downloadAnimeEpisode(' + movieId + ',' + ep + ')"><span class="kwik-ep-num">Ep ' + ep + '</span><span class="kwik-ep-icon">⬇</span></button>' +
      '<button class="kwik-ep-play-btn" onclick="playTorrentEpisode(' + movieId + ',' + ep + ')"><span class="kwik-ep-num">▶ ' + ep + '</span></button>' +
      '</div>';
  }
  container.innerHTML = html;
}

function changeEpPage(movieId, totalEps, direction) {
  const pageEl = document.getElementById('kwik-ep-page');
  if (!pageEl) return;
  let page = parseInt(pageEl.dataset.page || '1');
  const epsPerPage = 24;
  const totalPages = Math.ceil(totalEps / epsPerPage);
  page += direction;
  if (page < 1) page = 1;
  if (page > totalPages) page = totalPages;
  pageEl.dataset.page = page;
  pageEl.textContent = 'Page ' + page + ' / ' + totalPages;
  const start = (page - 1) * epsPerPage + 1;
  const end = Math.min(page * epsPerPage, totalEps);
  renderEpisodeDownloadGrid(movieId, start, end);
  // Update button states
  const prevBtn = document.getElementById('kwik-ep-prev');
  const nextBtn = document.getElementById('kwik-ep-next');
  if (prevBtn) prevBtn.disabled = page <= 1;
  if (nextBtn) nextBtn.disabled = page >= totalPages;
}

const QUALITY_ORDER = ['2160p', '1080p', '720p', '480p'];

function buildMagnet(hash, title) {
  return 'magnet:?xt=urn:btih:' + hash + '&dn=' + encodeURIComponent(title) + TRACKERS;
}

async function fetchYTSTorrents(movie) {
  const title = encodeURIComponent(movie.title);
  const year = getYear(movie.release_date);
  const url = 'https://yts.mx/api/v2/list_movies.json?query_term=' + title + '&limit=5&sort_by=download_count';
  try {
    const res = await fetch(url);
    const data = await res.json();
    const list = (data.data && data.data.movies) || [];
    let best = null;
    for (const m of list) {
      if (m.title.toLowerCase() === movie.title.toLowerCase() && String(m.year) === String(year)) { best = m; break; }
    }
    if (!best && list.length) best = list[0];
    if (!best) return null;
    const torrents = (best.torrents || []).slice().sort((a, b) => {
      const ai = QUALITY_ORDER.indexOf(a.quality); const bi = QUALITY_ORDER.indexOf(b.quality);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });
    return { ytsMovie: best, torrents };
  } catch (e) { return null; }
}

// Opens magnet link directly in the qBittorrent desktop app via OS protocol handler.
// qBittorrent registers itself as the magnet: handler when installed on Windows.
function openInQBittorrent(magnetUrl, label) {
  // Create a hidden anchor and click it — avoids navigation away from page
  const a = document.createElement('a');
  a.href = magnetUrl;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => document.body.removeChild(a), 500);
  showToast('🧲 Opening "' + label + '" in qBittorrent...');
}

async function downloadWithQBittorrent(movieId) {
  const movie = appState.moviesById[movieId];
  if (!movie) return;

  const btn = document.getElementById('qbt-download-btn');
  const infoEl = document.getElementById('qbt-torrent-info');
  const panel = document.getElementById('qbt-quality-panel');

  if (btn) { btn.disabled = true; btn.innerHTML = '⏳ Searching YTS...'; }
  if (infoEl) infoEl.innerHTML = '';

  const result = await fetchYTSTorrents(movie);

  if (!result || !result.torrents.length) {
    showToast('❌ No torrents found on YTS. Try manual sources below.');
    if (btn) { btn.disabled = false; btn.innerHTML = '🎬 Open Best in qBittorrent'; }
    return;
  }

  const best = result.torrents[0];
  const magnet = buildMagnet(best.hash, movie.title);

  // Show quality badges + all available qualities
  if (infoEl) {
    infoEl.innerHTML =
      '<span class="modal-badge mb-rating">📦 Best: ' + best.quality + '</span>' +
      '<span class="modal-badge mb-rating">💾 ' + best.size + '</span>' +
      '<span class="modal-badge mb-lang">✅ YTS</span>';
  }

  // Show all available quality options
  if (panel) {
    panel.innerHTML = '<p style="font-size:0.8rem;color:var(--text-muted);margin-bottom:8px;">Or choose a specific quality:</p>' +
      result.torrents.map(t =>
        '<button class="quality-btn" onclick="openInQBittorrent(\'' + buildMagnet(t.hash, movie.title) + '\',\'' + escapeHtml(movie.title) + ' ' + t.quality + '\')">' +
        '📦 ' + t.quality + ' <span style="opacity:0.6;font-size:0.75rem">' + t.size + '</span>' +
        '</button>'
      ).join('');
  }

  if (btn) { btn.disabled = false; btn.innerHTML = '🎬 Open Best in qBittorrent'; }

  // Auto-open the best quality
  openInQBittorrent(magnet, movie.title + ' ' + best.quality);
}


function generateFallbackLinks(movie) {
  const title = encodeURIComponent(movie.title);
  const year = getYear(movie.release_date);
  const ty = encodeURIComponent(movie.title + ' ' + year);
  const raw = movie.title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const isAnime = movie.content_type === 'anime';

  if (isAnime) {
    return [
      { id: 'kwik', name: 'Anikoto (Kwik)', url: 'https://anikototv.to/filter?keyword=' + title },
      { id: 'nyaa', name: 'Nyaa', url: 'https://nyaa.si/?f=0&c=1_0&q=' + title },
      { id: '1337', name: '1337x', url: 'https://1337x.to/search/' + ty + '/1/' },
      { id: 'mal', name: 'MyAnimeList', url: movie.anime_link || ('https://myanimelist.net/search/all?q=' + title) },
      { id: 'piratebay', name: 'Pirate Bay', url: 'https://thepiratebay.org/search.php?q=' + ty + '&cat=200' }
    ];
  }
  return [
    { id: 'yts', name: 'YTS', url: 'https://yts.mx/movies/' + raw + '-' + year },
    { id: '1337', name: '1337x', url: 'https://1337x.to/search/' + ty + '/1/' },
    { id: 'piratebay', name: 'Pirate Bay', url: 'https://thepiratebay.org/search.php?q=' + ty + '&cat=200' },
    { id: 'nyaa', name: 'Nyaa', url: 'https://nyaa.si/?f=0&c=1_0&q=' + title }
  ];
}

// ============================================================
// THEME & WATCHLIST
// ============================================================
function initTheme() {
  document.documentElement.setAttribute('data-theme', appState.theme);

  // Update navbar icons
  const icons = document.querySelectorAll('.theme-icon, #theme-icon');
  icons.forEach(icon => {
    icon.textContent = appState.theme === 'dark' ? '☀️' : '🌙';
  });

  // Update drawer button
  const drawerBtn = document.getElementById('drawer-theme-btn');
  if (drawerBtn) {
    drawerBtn.innerHTML = appState.theme === 'dark' ? '☀️ Toggle Theme' : '🌙 Toggle Theme';
  }
}

function toggleTheme() {
  appState.theme = appState.theme === 'dark' ? 'light' : 'dark';
  try { localStorage.setItem('cv_theme', appState.theme); } catch (e) { console.warn("Could not save theme", e); }
  initTheme();
}

function toggleWatchlist(id) {
  const numId = parseInt(id, 10);
  const idx = appState.watchlist.indexOf(numId);
  if (idx > -1) { appState.watchlist.splice(idx, 1); showToast('Removed from Watchlist'); }
  else { appState.watchlist.push(numId); showToast('Added to Watchlist'); }
  localStorage.setItem('cv_watchlist', JSON.stringify(appState.watchlist));
  updateWatchlistUI();
  // Re-render current view
  if (document.getElementById('movies-grid')) renderGrid(appState.filtered, 'movies-grid');
  renderTrending();
}

function updateWatchlistUI() {
  const badge = document.getElementById('nav-wl-badge');
  if (badge) {
    badge.textContent = appState.watchlist.length;
    badge.style.display = appState.watchlist.length > 0 ? 'inline-block' : 'none';
  }
  renderWatchlistSection();
}

function clearWatchlist() {
  if (!confirm('Clear your entire watchlist?')) return;
  appState.watchlist = [];
  localStorage.setItem('cv_watchlist', '[]');
  updateWatchlistUI();
  if (document.getElementById('movies-grid')) renderGrid(appState.filtered, 'movies-grid');
  renderTrending();
  showToast('Watchlist cleared');
}

// ============================================================
// DATA HELPERS
// ============================================================
function getLangInfo(code) { return LANG_MAP[code] || { name: code.toUpperCase(), flag: '🌍', region: 'all' }; }
function getEmojiForMovie(m) { return (!m.genres || !m.genres.length) ? '🎬' : (GENRE_ICON[m.genres[0]] || '🎬'); }
function getYear(d) { return d ? d.split('-')[0] : ''; }

// ============================================================
// RENDERING
// ============================================================
function buildMovieCard(movie) {
  const isAnime = movie.content_type === 'anime';
  const inWl = appState.watchlist.includes(parseInt(movie.id, 10));
  const wlIcon = inWl ? '❤️' : '🤍';
  const year = getYear(movie.release_date);
  const rating = parseFloat(movie.vote_average || 0).toFixed(1);
  const lang = getLangInfo(movie.original_language).flag;
  const emoji = getEmojiForMovie(movie);
  const numId = parseInt(movie.id) || 0;
  const h1 = numId % 360;
  const h2 = (h1 + 60) % 360;
  const grad = 'linear-gradient(135deg, hsl(' + h1 + ',80%,30%), hsl(' + h2 + ',80%,20%))';
  const posterUrl = getProxiedPosterUrl(movie.poster_url);
  const hasPoster = !!posterUrl;
  const genresHtml = (movie.genres || []).slice(0, 2).map(g => '<span class="card-genre">' + g + '</span>').join('');
  const raw = movie.title.toLowerCase().replace(/[^a-z0-9]+/g, '-');

  // Anime → Anikoto (Kwik) link; Movie → YTS link
  const dlUrl = isAnime
    ? 'https://anikototv.to/filter?keyword=' + encodeURIComponent(movie.title)
    : 'https://yts.mx/movies/' + raw + '-' + year;

  const typeBadge = isAnime ? '<span class="badge-type anime-badge">🎌 Anime</span>' : '';
  const episodeBadge = isAnime && movie.episodes ? '<span class="badge-type ep-badge">' + movie.episodes + ' eps</span>' : '';

  return '<div class="movie-card ' + (isAnime ? 'anime-card' : '') + '" role="button" tabindex="0" aria-label="View ' + escapeHtml(movie.title) + '" onclick="openMovieModal(' + movie.id + ')">' +
    '<div class="card-poster">' +
    (hasPoster ? '<img src="' + posterUrl + '" class="poster-img" alt="' + escapeHtml(movie.title) + '" loading="lazy" referrerpolicy="no-referrer" onerror="handlePosterError(this)">' : '') +
    '<div class="poster-fallback" style="' + (hasPoster ? 'display:none;' : 'display:flex;') + 'background:' + grad + '">' +
    '<span class="fallback-emoji" style="text-shadow:0 4px 10px rgba(0,0,0,0.5)">' + emoji + '</span>' +
    '<span class="fallback-title" style="text-align:center;padding:0 10px;font-weight:800;font-size:1.1rem;line-height:1.2;text-shadow:0 2px 4px rgba(0,0,0,0.5)">' + escapeHtml(movie.title.substring(0, 40)) + '</span>' +
    '</div>' +
    '<div class="card-badges"><span class="badge-rating">⭐ ' + rating + '</span>' + typeBadge + episodeBadge + '</div>' +
    '<div class="card-overlay">' +
    '<a href="' + dlUrl + '" target="_blank" rel="noopener" class="overlay-dl-btn ' + (isAnime ? 'kwik-overlay-btn' : '') + '" onclick="event.stopPropagation();showToast(\'Opening ' + (isAnime ? 'Kwik' : 'download') + '...\')">' + (isAnime ? '⬇ Kwik Download' : 'Download ↗') + '</a>' +
    '</div>' +
    '</div>' +
    '<div class="card-info">' +
    '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">' +
    '<h3 class="card-title">' + escapeHtml(movie.title) + '</h3>' +
    '<button class="btn-watchlist ' + (inWl ? 'in-list' : '') + '" onclick="event.stopPropagation();toggleWatchlist(' + movie.id + ')" aria-label="Toggle watchlist">' + wlIcon + '</button>' +
    '</div>' +
    '<div class="card-meta"><span>📅 ' + (year || 'N/A') + '</span><span>' + lang + ' ' + movie.original_language.toUpperCase() + '</span>' +
    (isAnime ? (movie.episodes ? '<span>📺 ' + movie.episodes + ' eps</span>' : '') : (movie.runtime ? '<span>⏱ ' + movie.runtime + 'm</span>' : '')) +
    '</div>' +
    '<div class="card-genres">' + genresHtml + '</div>' +
    '</div>' +
    '</div>';
}

function renderGrid(movies, containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (!movies.length) {
    el.innerHTML = '<div class="empty-state"><span class="empty-icon">😢</span><h3>No movies found</h3><p>Try adjusting your search or filters.</p></div>';
    return;
  }
  el.innerHTML = movies.map(m => buildMovieCard(m)).join('');
}

function renderTrending(data) {
  const el = document.getElementById('trending-strip');
  if (!el) return;
  if (data) { appState.trending = data; cacheMovies(data); }
  if (!appState.trending) return;
  el.innerHTML = appState.trending.map(m => buildMovieCard(m)).join('');
}

function renderWatchlistSection() {
  const container = document.getElementById('watchlist-grid');
  const emptyState = document.getElementById('wl-empty');
  if (!container) return;
  if (!appState.watchlist.length) {
    container.innerHTML = '';
    if (emptyState) { container.appendChild(emptyState); emptyState.style.display = 'flex'; }
  } else {
    if (emptyState) emptyState.style.display = 'none';
    const wlMovies = appState.watchlist.map(id => appState.moviesById[id]).filter(Boolean);
    renderGrid(wlMovies, 'watchlist-grid');
  }
}

// ============================================================
// FILTER & PAGINATION
// ============================================================
function applyFilters() {
  const typeEl = document.getElementById('f-type');
  const typeFilter = typeEl ? typeEl.value : '';

  updateGenreDropdown(typeFilter);

  const searchEl = document.getElementById('hero-search');
  const searchQ = searchEl ? searchEl.value.toLowerCase().trim() : '';
  const genreEl = document.getElementById('f-genre');
  const langEl = document.getElementById('f-lang');
  const rankEl = document.getElementById('f-rating');
  const yearEl = document.getElementById('f-year');
  const sortEl = document.getElementById('f-sort');
  const genre = genreEl ? genreEl.value : '';
  const lang = langEl ? langEl.value : '';
  const rank = rankEl ? rankEl.value : '';
  const yearGroup = yearEl ? yearEl.value : '';
  const sort = sortEl ? sortEl.value : 'popularity';

  let result = appState.movies.filter(m => {
    if (typeFilter === 'movie' && m.content_type === 'anime') return false;
    if (typeFilter === 'anime' && m.content_type !== 'anime') return false;
    if (searchQ) {
      const match = m.title.toLowerCase().includes(searchQ) ||
        (m.original_title && m.original_title.toLowerCase().includes(searchQ)) ||
        (m.genres && m.genres.some(g => g.toLowerCase().includes(searchQ)));
      if (!match) return false;
    }
    if (genre && (!m.genres || !m.genres.includes(genre))) return false;
    if (lang && m.original_language !== lang) return false;
    if (rank && parseFloat(m.vote_average || 0) < parseFloat(rank)) return false;
    if (yearGroup) {
      const y = parseInt(getYear(m.release_date));
      if (isNaN(y)) return false;
      if (yearGroup === '0') { if (y >= 1990) return false; }
      else { const dec = parseInt(yearGroup); if (y < dec || y > dec + 9) return false; }
    }
    return true;
  });

  switch (sort) {
    case 'rating': result.sort((a, b) => b.vote_average - a.vote_average); break;
    case 'year-new': result.sort((a, b) => new Date(b.release_date || '1970') - new Date(a.release_date || '1970')); break;
    case 'year-old': result.sort((a, b) => new Date(a.release_date || '2030') - new Date(b.release_date || '2030')); break;
    case 'title-az': result.sort((a, b) => a.title.localeCompare(b.title)); break;
    case 'title-za': result.sort((a, b) => b.title.localeCompare(a.title)); break;
    case 'votes': result.sort((a, b) => (b.vote_count || 0) - (a.vote_count || 0)); break;
    default: result.sort((a, b) => b.popularity - a.popularity); break;
  }

  appState.filtered = result;
  appState.currentPage = 1;
  updateBrowseUI();
}

function updateBrowseUI() {
  if (!document.getElementById('movies-grid')) return;
  const totalPages = Math.ceil(appState.filtered.length / CONFIG.PAGE_SIZE);
  if (appState.currentPage > totalPages && totalPages > 0) appState.currentPage = totalPages;
  const s = (appState.currentPage - 1) * CONFIG.PAGE_SIZE;
  const e = s + CONFIG.PAGE_SIZE;
  renderGrid(appState.filtered.slice(s, e), 'movies-grid');
  const countEl = document.getElementById('result-count');
  if (countEl) countEl.textContent = 'Showing ' + (s + 1) + '–' + Math.min(e, appState.filtered.length) + ' of ' + appState.filtered.length + ' movies';
  renderPagination(totalPages);
}

function renderPagination(totalPages) {
  const wrap = document.getElementById('pagination-wrap');
  const numBox = document.getElementById('page-numbers');
  const prevBtn = document.getElementById('page-prev');
  const nextBtn = document.getElementById('page-next');
  if (!wrap) return;
  if (totalPages <= 1) { wrap.style.display = 'none'; return; }
  wrap.style.display = 'flex';
  prevBtn.disabled = appState.currentPage === 1;
  nextBtn.disabled = appState.currentPage === totalPages;

  let startP = Math.max(1, appState.currentPage - 2);
  let endP = Math.min(totalPages, appState.currentPage + 2);
  if (appState.currentPage <= 3) endP = Math.min(5, totalPages);
  if (appState.currentPage >= totalPages - 2) startP = Math.max(1, totalPages - 4);

  let html = '';
  if (startP > 1) {
    html += '<button class="page-btn" onclick="goToPage(1)">1</button>';
    if (startP > 2) html += '<span style="color:var(--text-muted);padding:8px">...</span>';
  }
  for (let i = startP; i <= endP; i++) {
    html += '<button class="page-btn ' + (i === appState.currentPage ? 'active' : '') + '" onclick="goToPage(' + i + ')">' + i + '</button>';
  }
  if (endP < totalPages) {
    if (endP < totalPages - 1) html += '<span style="color:var(--text-muted);padding:8px">...</span>';
    html += '<button class="page-btn" onclick="goToPage(' + totalPages + ')">' + totalPages + '</button>';
  }
  numBox.innerHTML = html;
  prevBtn.onclick = () => { if (appState.currentPage > 1) goToPage(appState.currentPage - 1); };
  nextBtn.onclick = () => { if (appState.currentPage < totalPages) goToPage(appState.currentPage + 1); };
}

function goToPage(p) {
  appState.currentPage = p;
  updateBrowseUI();
  const browseEl = document.getElementById('browse');
  if (browseEl) browseEl.scrollIntoView({ behavior: 'smooth' });
}

function resetFilters() {
  const safe = id => document.getElementById(id);
  if (safe('f-type')) safe('f-type').value = '';
  if (safe('f-genre')) safe('f-genre').value = '';
  if (safe('f-lang')) safe('f-lang').value = '';
  if (safe('f-rating')) safe('f-rating').value = '';
  if (safe('f-year')) safe('f-year').value = '';
  if (safe('f-sort')) safe('f-sort').value = 'popularity';
  if (safe('hero-search')) safe('hero-search').value = '';
  if (safe('search-clear')) safe('search-clear').style.display = 'none';
  if (safe('search-suggestions')) safe('search-suggestions').style.display = 'none';
  const activeTab = document.querySelector('.genre-tab[data-genre=""]');
  if (activeTab) { document.querySelectorAll('.genre-tab').forEach(t => t.classList.remove('active')); activeTab.classList.add('active'); }
  applyFilters();
}

// ============================================================
// FILTER DROPDOWNS
// ============================================================
function updateGenreDropdown(typeFilter) {
  const gSelect = document.getElementById('f-genre');
  if (!gSelect) return;

  const currentVal = gSelect.value;
  let genresToDraw = new Set();

  if (typeFilter === 'anime') {
    genresToDraw = appState.animeGenres;
  } else {
    // If format is movie or empty, strictly show movie genres.
    genresToDraw = appState.movieGenres;
  }

  let html = '<option value="">All Genres</option>';
  Array.from(genresToDraw).sort().forEach(g => {
    html += '<option value="' + g + '">' + (GENRE_ICON[g] || '') + ' ' + g + '</option>';
  });
  gSelect.innerHTML = html;

  if (genresToDraw.has(currentVal)) {
    gSelect.value = currentVal;
  } else {
    gSelect.value = '';
  }
}

async function populateFilterDropdowns() {
  try {
    const [movieGenresRes, animeGenresRes, langsRes] = await Promise.all([
      fetch(CONFIG.API_BASE + '/genres?type=movie'),
      fetch(CONFIG.API_BASE + '/genres?type=anime'),
      fetch(CONFIG.API_BASE + '/languages')
    ]);

    const movieGenresData = await movieGenresRes.json();
    const animeGenresData = await animeGenresRes.json();
    appState.languagesData = await langsRes.json();

    appState.movieGenres.clear();
    appState.animeGenres.clear();
    movieGenresData.forEach(g => appState.movieGenres.add(g.genre));
    animeGenresData.forEach(g => appState.animeGenres.add(g.genre));

    const typeEl = document.getElementById('f-type');
    const typeFilter = typeEl ? typeEl.value : '';
    updateGenreDropdown(typeFilter);

    // Language dropdown (browse page)
    const lSelect = document.getElementById('f-lang');
    if (lSelect) {
      lSelect.innerHTML = '<option value="">All Languages</option>';
      appState.languagesData.forEach(l => {
        const info = getLangInfo(l.code);
        lSelect.innerHTML += '<option value="' + l.code + '">' + info.flag + ' ' + info.name + ' (' + l.count + ')</option>';
      });
    }

    // Genre quick tabs (home page)
    const gTabs = document.getElementById('genre-quick-tabs');
    if (gTabs) {
      ['Action', 'Comedy', 'Drama', 'Science Fiction', 'Romance', 'Horror'].forEach(g => {
        if (appState.movieGenres.has(g)) {
          gTabs.innerHTML += '<button class="genre-tab" onclick="window.location.href=\'movies.html\'" role="tab">' + (GENRE_ICON[g] || '') + ' ' + g + '</button>';
        }
      });
    }

    // Language pills (home page)
    if (document.getElementById('language-pills')) {
      renderLanguagePills('all');
    }
  } catch (err) {
    console.error('Failed to populate filter dropdowns:', err);
  }
}

// ============================================================
// SEARCH SUGGESTIONS
// ============================================================
// Debounce helper — delays fn execution until typing stops for `delay` ms
function debounce(fn, delay) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

const handleSearchInput = debounce(function (e) {
  const q = e.target.value.trim().toLowerCase();
  const clearBtn = document.getElementById('search-clear');
  const suggBox = document.getElementById('search-suggestions');
  if (clearBtn) clearBtn.style.display = q ? 'flex' : 'none';

  // If we are on the browse catalog page, filter the grid natively and hide the dropdown
  if (document.getElementById('movies-grid')) {
    applyFilters();
    if (suggBox) suggBox.style.display = 'none';
    return;
  }

  if (!q || q.length < 2) { if (suggBox) suggBox.style.display = 'none'; return; }

  const suggs = appState.movies
    .filter(m => m.title.toLowerCase().startsWith(q) || m.title.toLowerCase().includes(q))
    .sort((a, b) => b.popularity - a.popularity)
    .slice(0, 5);

  if (!suggs.length || !suggBox) return;

  suggBox.innerHTML = suggs.map(m =>
    '<div class="suggestion-item" onclick="openMovieModal(' + m.id + ');document.getElementById(\'search-suggestions\').style.display=\'none\'">' +
    '<div class="sugg-poster">' + (m.poster_url ? '<img src="' + m.poster_url + '" style="width:100%;height:100%;object-fit:cover;border-radius:6px" alt="" referrerpolicy="no-referrer" onerror="this.style.display=\'none\'">' : getEmojiForMovie(m)) + '</div>' +
    '<div class="sugg-info">' +
    '<div class="sugg-title">' + escapeHtml(m.title) + '</div>' +
    '<div class="sugg-meta">' + getYear(m.release_date) + ' • ' + m.original_language.toUpperCase() + '</div>' +
    '</div></div>'
  ).join('');
  suggBox.style.display = 'block';
}, 300);

// --- Languages & Regions ---
function renderLanguagePills(regionFilter) {
  const container = document.getElementById('language-pills');
  if (!container) return;
  const data = appState.languagesData;
  if (!data || !data.length) return;
  let html = '';
  data.forEach(({ code, count }) => {
    const info = getLangInfo(code);
    if (regionFilter !== 'all' && info.region !== regionFilter && info.region !== 'all') return;
    html += '<button class="lang-pill ' + (appState.activeLanguage === code ? 'active' : '') + '" onclick="renderLanguageSection(\'' + code + '\')">' +
      '<span class="lang-flag">' + info.flag + '</span><span class="lang-name">' + info.name + '</span><span class="lang-count">' + count + '</span>' +
      '</button>';
  });
  container.innerHTML = html || '<p style="grid-column:1/-1;color:var(--text-muted)">No languages found.</p>';
}

async function renderLanguageSection(langCode) {
    appState.activeLanguage = langCode;
    document.querySelectorAll('.lang-pill').forEach(el => el.classList.remove('active'));
    const pillIdx = Array.from(document.querySelectorAll('.lang-pill')).findIndex(p => p.textContent.includes(getLangInfo(langCode).name));
    if (pillIdx !== -1) document.querySelectorAll('.lang-pill')[pillIdx].classList.add('active');
    const panel = document.getElementById('lang-movies-panel');
    const title = document.getElementById('panel-title');
    const info = getLangInfo(langCode);
    if (title) title.innerHTML = info.flag + ' ' + info.name + ' Movies';

    // Show loading state
    const gridEl = document.getElementById('lang-movies-grid');
    if (gridEl) gridEl.innerHTML = '<div class="loading-skeleton-grid">' + Array(6).fill('<div class="skeleton-card"></div>').join('') + '</div>';
    if (panel) { panel.style.display = 'block'; panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }

    try {
      const res = await fetch(CONFIG.API_BASE + '/language/' + langCode + '?limit=24');
      const movies = await res.json();
      cacheMovies(movies);
      renderGrid(movies, 'lang-movies-grid');
    } catch (err) {
      console.error('Failed to load language movies:', err);
      if (gridEl) gridEl.innerHTML = '<div class="empty-state"><span class="empty-icon">\u26a0\ufe0f</span><h3>Failed to load</h3></div>';
    }

}

function closeLanguageSection() {
  appState.activeLanguage = null;
  const panel = document.getElementById('lang-movies-panel');
  if (panel) panel.style.display = 'none';
  document.querySelectorAll('.lang-pill').forEach(el => el.classList.remove('active'));
}

// ============================================================
// MODAL
// ============================================================
async function openMovieModal(id) {
  let movie = appState.moviesById[id];
  if (!movie) {
    // Fetch from API if not in cache
    try {
      const _res = await fetch(CONFIG.API_BASE + '/movies/' + id);
      if (!_res.ok) { showToast('Movie not found'); return; }
      movie = await _res.json();
      cacheMovies([movie]);
    } catch (_err) { showToast('Failed to load movie details'); return; }
  }
  const modal = document.getElementById('modal-overlay');
  const body = document.getElementById('modal-body');
  const inWl = appState.watchlist.includes(parseInt(movie.id, 10));
  const wlIcon = inWl ? '❤️' : '🤍 Add to Watchlist';
  const rating = parseFloat(movie.vote_average || 0).toFixed(1);
  const year = getYear(movie.release_date);
  const info = getLangInfo(movie.original_language);
  const budget = parseInt(movie.budget) || 0;
  const rev = parseInt(movie.revenue) || 0;
  const bStr = budget > 0 ? '$' + (budget / 1e6).toFixed(1) + 'M' : 'Unknown';
  const rStr = rev > 0 ? '$' + (rev / 1e6).toFixed(1) + 'M' : 'Unknown';
  const isAnime = movie.content_type === 'anime';
  const rt = isAnime ? (movie.episodes ? movie.episodes + ' eps' : 'Unknown eps') : (movie.runtime ? movie.runtime + 'm' : 'Unknown');
  const dIcon = isAnime ? '📺' : '⏱';

  const fallbackLinks = generateFallbackLinks(movie);
  const fallbackHtml = fallbackLinks.map(t =>
    '<a href="' + t.url + '" target="_blank" rel="noopener" class="torrent-card tl-' + t.id + '" onclick="showToast(\'Opening ' + t.name + '...\')">' +
    '<div class="t-name"><span>' + t.name + '</span><span>↗</span></div>' +
    '</a>'
  ).join('');

  const numId = parseInt(movie.id) || 0;
  const h1 = numId % 360; const h2 = (h1 + 60) % 360;
  const grad = 'linear-gradient(135deg,hsl(' + h1 + ',80%,30%),hsl(' + h2 + ',80%,20%))';
  const modalPosterUrl = getProxiedPosterUrl(movie.poster_url);
  const posterHtml = modalPosterUrl ? '<img src="' + modalPosterUrl + '" class="modal-backdrop-img" alt="" referrerpolicy="no-referrer" onerror="this.style.display=\'none\'">' : '<div style="width:100%;height:100%;background:' + grad + ';display:flex;align-items:center;justify-content:center;font-size:10rem;">' + getEmojiForMovie(movie) + '</div>';
  const posterLgHtml = modalPosterUrl ? '<img src="' + modalPosterUrl + '" alt="" referrerpolicy="no-referrer" onerror="handlePosterError(this)">' : '<div class="poster-fallback" style="height:100%"><span class="fallback-emoji" style="font-size:5rem">' + getEmojiForMovie(movie) + '</span></div>';

  body.innerHTML =
    '<div class="modal-backdrop-wrap">' + posterHtml + '<div class="modal-backdrop-grad"></div></div>' +
    '<div class="modal-content-inner">' +
    '<div class="modal-left">' +
    '<div class="modal-poster-lg">' + posterLgHtml + '</div>' +
    '<button class="overlay-dl-btn" style="margin-top:16px;border:1px solid var(--border);background:var(--bg-card2);color:var(--text-primary);" onclick="toggleWatchlist(' + movie.id + ');document.getElementById(\'modal-overlay\').click()">' + wlIcon + '</button>' +
    '</div>' +
    '<div class="modal-right">' +
    '<div class="modal-title-wrap">' +
    '<h2 class="modal-title-main">' + escapeHtml(movie.title) + '</h2>' +
    (movie.tagline ? '<div class="modal-tagline">"' + escapeHtml(movie.tagline) + '"</div>' : '') +
    '</div>' +
    '<div class="modal-badges">' +
    '<span class="modal-badge mb-rating">⭐ ' + rating + ' / 10</span>' +
    '<span class="modal-badge mb-rating">📅 ' + year + '</span>' +
    '<span class="modal-badge mb-rating">' + dIcon + ' ' + rt + '</span>' +
    '<span class="modal-badge mb-lang">' + info.flag + ' ' + info.name + '</span>' +
    '</div>' +
    '<p class="modal-overview">' + escapeHtml(movie.overview || 'No overview available.') + '</p>' +
    '<div class="modal-metadata">' +
    '<div class="meta-item"><span class="meta-label">Genres</span><span class="meta-value">' + ((movie.genres || []).join(', ') || 'N/A') + '</span></div>' +
    '<div class="meta-item"><span class="meta-label">Votes</span><span class="meta-value">' + parseInt(movie.vote_count || 0).toLocaleString() + '</span></div>' +
    (!isAnime ? '<div class="meta-item"><span class="meta-label">Budget</span><span class="meta-value">' + bStr + '</span></div>' +
      '<div class="meta-item"><span class="meta-label">Revenue</span><span class="meta-value">' + rStr + '</span></div>' : '') +
    '</div>' +
    (!isAnime ?
      '<div class="stream-section" style="margin-bottom:24px;">' +
      '<h3 class="modal-section-title">▶️ Watch Now</h3>' +
      '<p style="font-size:0.82rem;color:var(--text-muted);margin-bottom:10px;">Stream instantly in your browser — pick a source below.</p>' +
      '<div class="stream-controls" style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px;">' +
      '<button class="qbt-btn stream-source-btn active" data-source="videasy" style="flex:1;background:linear-gradient(135deg, #10b981, #059669);" onclick="switchStreamSource(\'videasy\',' + movie.id + ')">▶ Videasy</button>' +
      '<button class="qbt-btn stream-source-btn" data-source="vidsrc" style="flex:1;background:var(--bg-card2);border:1px solid var(--border);color:var(--text-primary);" onclick="switchStreamSource(\'vidsrc\',' + movie.id + ')">▶ VidSrc</button>' +
      '<button class="qbt-btn stream-source-btn" data-source="embed" style="flex:1;background:var(--bg-card2);border:1px solid var(--border);color:var(--text-primary);" onclick="switchStreamSource(\'embed\',' + movie.id + ')">▶ MultiEmbed</button>' +
      '<button class="qbt-btn stream-source-btn" data-source="torrent" style="flex:1;background:var(--bg-card2);border:1px solid var(--border);color:var(--text-primary);" onclick="switchStreamSource(\'torrent\',' + movie.id + ')">🧲 Torrent</button>' +
      '</div>' +
      '<div id="player-container" style="width:100%;aspect-ratio:16/9;background:#000;border-radius:var(--radius-md);overflow:hidden;border:1px solid var(--border);position:relative;box-shadow:0 10px 30px rgba(0,0,0,0.5);">' +
      '<div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;color:var(--text-muted);">' +
      '<span style="font-size:3rem;margin-bottom:10px;">🎬</span>' +
      '<span style="font-weight:600;font-size:0.9rem;">Click a source above to start streaming</span>' +
      '</div>' +
      '</div>' +
      '</div>' : '') +
    (isAnime ? buildAnimeStreamSection(movie) : '') +
    '' +
    '<h3 class="modal-section-title" style="margin-top:22px;">🔍 Browse Manually</h3>' +
    '<div class="torrent-grid">' + fallbackHtml + '</div>' +
    '</div>' +
    '</div>';

  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';

  // Initialize anime episode grid and streaming for anime
  if (isAnime) {
    const totalEps = parseInt(movie.episodes) || 0;

    // Reset anime streaming state for this new modal
    activeAnimeSource = 'direct';
    currentAnimeMovieId = movie.id;
    activeAnimeAnilistId = null;
    anikotoState = { episodes: [], seriesId: null, currentEp: null, lang: 'sub' };
    jikanState = { episodes: [], malId: null, animeInfo: null, loaded: false };
    animepaheState = { session: null, episodes: {}, loading: false };

    // Build the episode number grid (quick-click buttons)
    if (totalEps > 0) {
      setTimeout(function () {
        // Render clickable episode grid
        const epGrid = document.getElementById('anime-ep-grid');
        if (epGrid) {
          let gridHtml = '';
          for (let ep = 1; ep <= totalEps; ep++) {
            gridHtml += '<button class="kwik-ep-btn anime-ep-grid-btn" data-ep="' + ep + '" onclick="playEpFromGrid(' + ep + ',' + movie.id + ')" style="padding:6px 4px;font-size:0.78rem;">' +
              '<span class="kwik-ep-num">Ep ' + ep + '</span>' +
              '</button>';
          }
          epGrid.innerHTML = gridHtml;
        }
      }, 50);
    }

    // Pre-fetch AniList ID for Videasy (critical for anime playback)
    // Then auto-play episode 1 once the ID is resolved
    resolveAnilistAndAutoplay(movie);

    // Search Anikoto in background (non-blocking — doesn't hold up the player)
    setTimeout(function () {
      searchAnikotoForAnime(movie);
    }, 100);
  }
}

function closeMovieModal() {
  const modal = document.getElementById('modal-overlay');
  modal.style.display = 'none';
  document.body.style.overflow = '';
  // Cleanly destroy all active players and torrent client
  _destroyCurrentPlayer('player-container');
  _destroyCurrentPlayer('anime-player-container');
  if (_torrentClient) { _torrentClient.destroy(); _torrentClient = null; }
  const player = document.getElementById('player-container');
  if (player) player.innerHTML = '';
  const animePlayer = document.getElementById('anime-player-container');
  if (animePlayer) animePlayer.innerHTML = '';
  activeStreamSource = null;
  activeAnimeSource = 'direct';
  currentAnimeMovieId = null;
  activeAnimeAnilistId = null;
  anikotoState = { episodes: [], seriesId: null, currentEp: null, lang: 'sub' };
  jikanState = { episodes: [], malId: null, animeInfo: null, loaded: false };
  animepaheState = { session: null, episodes: {}, loading: false };
}

// --- Active stream source tracker ---
let activeStreamSource = null;
let _torrentClient = null; // Holds current WebTorrent client
let _iframeLoadTimer = null; // Tracks iframe load timeout for auto-fallback
let _hlsInstance = null; // HLS.js instance for direct player

// Source priority for auto-cascade when one fails
const ANIME_SOURCE_PRIORITY = ['direct', 'videasy', 'vidsrc', 'embed'];
const MOVIE_SOURCE_PRIORITY = ['videasy', 'vidsrc', 'embed'];

function _destroyCurrentPlayer(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  // Kill any active HLS instance
  if (_hlsInstance) { try { _hlsInstance.destroy(); } catch (e) { } _hlsInstance = null; }
  // Blank out iframe src before removing to stop network requests
  const iframe = container.querySelector('iframe');
  if (iframe) { try { iframe.src = 'about:blank'; } catch (e) { } }
  // Kill any running video element
  const video = container.querySelector('video');
  if (video) { try { video.pause(); video.src = ''; video.load(); } catch (e) { } }
  // Clear load timer
  if (_iframeLoadTimer) { clearTimeout(_iframeLoadTimer); _iframeLoadTimer = null; }
}

function _injectIframeWithTimeout(container, streamUrl, displayLabel, fallbackFn) {
  // Inject iframe WITHOUT loading=lazy so it loads immediately
  container.innerHTML =
    '<div class="stream-loading-overlay" style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;color:var(--text-muted);z-index:1;">' +
    '<div class="loading-spinner" style="width:40px;height:40px;margin-bottom:10px;"></div>' +
    '<span style="font-size:0.9rem;font-weight:600;">Loading ' + escapeHtml(displayLabel) + '...</span>' +
    '</div>' +
    '<iframe src="' + streamUrl + '" ' +
    'style="position:absolute;inset:0;width:100%;height:100%;border:none;z-index:2;" ' +
    'allowfullscreen="true" webkitallowfullscreen="true" mozallowfullscreen="true" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" ' +
    'referrerpolicy="no-referrer">' +
    '</iframe>';

  const iframe = container.querySelector('iframe');

  // Hide loading spinner once iframe loads
  if (iframe) {
    iframe.addEventListener('load', function () {
      const overlay = container.querySelector('.stream-loading-overlay');
      if (overlay) overlay.style.display = 'none';
      if (_iframeLoadTimer) { clearTimeout(_iframeLoadTimer); _iframeLoadTimer = null; }
    });
  }

  // Auto-fallback: if iframe hasn't loaded in 12 seconds, try next source
  if (fallbackFn) {
    _iframeLoadTimer = setTimeout(function () {
      console.warn('[Stream] Iframe load timeout for ' + displayLabel + ', trying fallback...');
      fallbackFn();
    }, 12000);
  }
}

function buildStreamUrl(source, movie, episode) {
  const tmdbId = movie.id;
  const isAnime = movie.content_type === 'anime';

  // For anime, try to extract MAL ID from anime_link
  let malId = null;
  if (isAnime && movie.anime_link) {
    const malMatch = movie.anime_link.match(/anime\/(\d+)/);
    if (malMatch) malId = malMatch[1];
  }

  const ep = episode || 1;

  switch (source) {
    case 'videasy':
      if (isAnime) {
        // Best option: use AniList ID (pre-resolved on modal open)
        if (activeAnimeAnilistId) {
          return 'https://player.videasy.net/anime/' + activeAnimeAnilistId + '/' + ep + '?color=8B5CF6&episodeSelector=true&nextEpisode=true&autoplayNextEpisode=true';
        }
        // Fallback: use MAL ID with vidsrc instead of broken TV format
        if (malId) {
          return 'https://vidsrc.cc/v2/embed/anime/mal/' + malId + '/' + ep;
        }
        // Last resort: try title-based search on vidsrc
        return 'https://vidsrc.cc/v2/embed/tv/' + tmdbId + '/1/' + ep;
      }
      return 'https://player.videasy.net/movie/' + tmdbId + '?color=8B5CF6';

    case 'vidsrc':
      if (isAnime) {
        if (malId) return 'https://vidsrc.cc/v2/embed/anime/mal/' + malId + '/' + ep;
        return 'https://vidsrc.cc/v2/embed/tv/' + tmdbId + '/1/' + ep;
      }
      return 'https://vidsrc.cc/v2/embed/movie/' + tmdbId;

    case 'embed':
      if (isAnime) {
        return 'https://multiembed.mov/?video_id=' + tmdbId + '&tmdb=1&s=1&e=' + ep;
      }
      return 'https://multiembed.mov/?video_id=' + tmdbId + '&tmdb=1';

    default:
      if (isAnime && activeAnimeAnilistId) return 'https://player.videasy.net/anime/' + activeAnimeAnilistId + '/' + ep + '?color=8B5CF6&episodeSelector=true&nextEpisode=true&autoplayNextEpisode=true';
      if (isAnime && malId) return 'https://vidsrc.cc/v2/embed/anime/mal/' + malId + '/' + ep;
      return 'https://player.videasy.net/movie/' + tmdbId;
  }
}

function switchStreamSource(source, movieId) {
  const movie = appState.moviesById[movieId];
  if (!movie) return;

  // If source is null, reuse active source (episode change)
  if (!source) source = activeStreamSource || 'videasy';
  activeStreamSource = source;

  const isAnime = movie.content_type === 'anime';
  const container = document.getElementById('player-container');
  if (!container) return;

  // Destroy previous player cleanly before creating new
  _destroyCurrentPlayer('player-container');
  if (_torrentClient) { _torrentClient.destroy(); _torrentClient = null; }

  // Update button active states
  document.querySelectorAll('.stream-source-btn').forEach(btn => {
    const isCurrent = btn.getAttribute('data-source') === source;
    btn.classList.toggle('active', isCurrent);
    if (isCurrent) {
      btn.style.background = 'linear-gradient(135deg, #10b981, #059669)';
      btn.style.color = '#fff';
      btn.style.borderColor = 'transparent';
    } else {
      btn.style.background = 'var(--bg-card2)';
      btn.style.color = 'var(--text-primary)';
      btn.style.borderColor = 'var(--border)';
    }
  });

  if (source === 'torrent') {
    playMovieTorrent(movieId);
    return;
  }

  // Get episode number for anime
  let ep = 1;
  if (isAnime) {
    const epSelect = document.getElementById('anime-ep-select');
    if (epSelect) ep = parseInt(epSelect.value, 10) || 1;
  }

  const streamUrl = buildStreamUrl(source, movie, ep);

  // Build fallback function: try next source in priority list
  const priorities = isAnime ? ANIME_SOURCE_PRIORITY : MOVIE_SOURCE_PRIORITY;
  const currentIdx = priorities.indexOf(source);
  const fallbackFn = (currentIdx >= 0 && currentIdx < priorities.length - 1) ? function () {
    const nextSource = priorities[currentIdx + 1];
    showToast('⏳ ' + source + ' timed out, trying ' + nextSource + '...');
    switchStreamSource(nextSource, movieId);
  } : null;

  _injectIframeWithTimeout(container, streamUrl, source + ' player', fallbackFn);

  showToast('▶ Loading ' + (isAnime ? movie.title + ' Ep ' + ep : movie.title) + ' via ' + source + '...');

  // Scroll player into view
  setTimeout(() => container.scrollIntoView({ behavior: 'smooth', block: 'center' }), 200);
}


// ============================================================
// ANIKOTO ANIME STREAMING ENGINE
// ============================================================
let anikotoState = { episodes: [], seriesId: null, currentEp: null, lang: 'sub' };
let activeAnimeSource = 'direct'; // Track the active anime source
let currentAnimeMovieId = null; // Track which anime is open
let activeAnimeAnilistId = null; // AniList ID for Videasy
let animepaheState = { session: null, episodes: {}, loading: false };

// ============================================================
// JIKAN (MyAnimeList) INTEGRATION
// ============================================================
// Fetches rich episode metadata (titles, air dates, filler flags)
// from the Jikan/MAL API to enhance the episode grid.
let jikanState = { episodes: [], malId: null, animeInfo: null, loaded: false };

async function fetchJikanEpisodes(movie) {
  // Extract MAL ID from anime_link
  let malId = null;
  if (movie.anime_link) {
    const malMatch = movie.anime_link.match(/anime\/(\d+)/);
    if (malMatch) malId = malMatch[1];
  }
  if (!malId) return;
  jikanState.malId = malId;

  try {
    // Fetch anime details and episodes in parallel
    const [detailsRes, episodesRes] = await Promise.all([
      fetch('/api/jikan/anime/' + malId),
      fetch('/api/jikan/anime/' + malId + '/episodes/all')
    ]);
    const detailsData = await detailsRes.json();
    const episodesData = await episodesRes.json();

    if (detailsData.ok && detailsData.data) {
      jikanState.animeInfo = detailsData.data;
      // Update modal with MAL info badge
      renderJikanInfoBadge(detailsData.data);
    }

    if (episodesData.ok && episodesData.episodes) {
      jikanState.episodes = episodesData.episodes;
      jikanState.loaded = true;
      // Enrich the episode grid with titles
      enrichEpisodeGridWithJikan();
      console.log('[Jikan] Loaded ' + episodesData.episodes.length + ' episode titles for MAL:' + malId);
    }
  } catch (err) {
    console.warn('[Jikan] Failed to fetch episode data:', err);
  }
}

function renderJikanInfoBadge(info) {
  const container = document.getElementById('jikan-info-panel');
  if (!container) return;

  let html = '';
  if (info.score) {
    html += '<span class="modal-badge mb-rating" style="background:linear-gradient(135deg,#f59e0b,#d97706);color:#fff;">\u2b50 MAL ' + info.score + '/10</span>';
  }
  if (info.rank) {
    html += '<span class="modal-badge mb-rating">#' + info.rank + ' Ranked</span>';
  }
  if (info.studios && info.studios.length) {
    html += '<span class="modal-badge mb-lang">\ud83c\udfac ' + escapeHtml(info.studios[0]) + '</span>';
  }
  if (info.source) {
    html += '<span class="modal-badge mb-lang">\ud83d\udcd6 ' + escapeHtml(info.source) + '</span>';
  }
  if (info.season && info.year) {
    html += '<span class="modal-badge mb-lang">\ud83d\udcc5 ' + escapeHtml(info.season.charAt(0).toUpperCase() + info.season.slice(1)) + ' ' + info.year + '</span>';
  }
  if (info.status) {
    var statusColor = info.status === 'Currently Airing' ? '#10b981' : (info.status === 'Finished Airing' ? '#6366f1' : '#f59e0b');
    html += '<span class="modal-badge" style="background:' + statusColor + ';color:#fff;">' + escapeHtml(info.status) + '</span>';
  }
  // Streaming links from MAL
  if (info.streaming && info.streaming.length) {
    info.streaming.forEach(function (s) {
      html += '<a href="' + s.url + '" target="_blank" rel="noopener" class="modal-badge mb-lang" style="text-decoration:none;cursor:pointer;" onclick="showToast(\'Opening ' + escapeHtml(s.name) + '...\')">' + escapeHtml(s.name) + ' \u2197</a>';
    });
  }

  container.innerHTML = html;
  container.style.display = html ? 'flex' : 'none';
}

function enrichEpisodeGridWithJikan() {
  if (!jikanState.loaded || !jikanState.episodes.length) return;

  // Enrich the episode grid buttons with titles
  document.querySelectorAll('.anime-ep-grid-btn').forEach(function (btn) {
    var epNum = parseInt(btn.dataset.ep);
    var jikanEp = jikanState.episodes.find(function (e) { return e.number === epNum; });
    if (jikanEp && jikanEp.title) {
      btn.title = 'Ep ' + epNum + ': ' + jikanEp.title + (jikanEp.filler ? ' [FILLER]' : '') + (jikanEp.recap ? ' [RECAP]' : '');
      // Add filler/recap visual indicator
      if (jikanEp.filler) {
        btn.style.borderLeft = '3px solid #f59e0b';
      }
      if (jikanEp.recap) {
        btn.style.borderLeft = '3px solid #6366f1';
      }
    }
  });

  // Also enrich the episode dropdown with titles
  var select = document.getElementById('anime-ep-select');
  if (select) {
    Array.from(select.options).forEach(function (opt) {
      var epNum = parseInt(opt.value);
      var jikanEp = jikanState.episodes.find(function (e) { return e.number === epNum; });
      if (jikanEp && jikanEp.title) {
        var label = 'Episode ' + epNum + ' \u2014 ' + jikanEp.title;
        if (jikanEp.filler) label += ' \u26a0\ufe0fFILLER';
        if (jikanEp.recap) label += ' \ud83d\udd04RECAP';
        opt.textContent = label;
      }
    });
  }
}

function renderCinevaultProviders() {
  const container = document.getElementById('anime-source-buttons');
  if (!container || !cinevaultEpisodes) return;

  const validProviders = ['animepahe', 'reanime', 'anikoto', 'animegg', 'anineko', 'anidbapp'];
  let firstProvider = null;

  for (const p of validProviders) {
    if (cinevaultEpisodes[p] && cinevaultEpisodes[p].episodes) {
      const subLen = (cinevaultEpisodes[p].episodes.sub || []).length;
      const dubLen = (cinevaultEpisodes[p].episodes.dub || []).length;
      if (subLen > 0 || dubLen > 0) {
        if (!firstProvider) firstProvider = 'cv_' + p;

        const btn = container.querySelector(`[data-source="cv_${p}"]`);
        if (btn) {
          btn.title = `${subLen + dubLen} episodes available`;
          // Add a subtle badge or styling if desired, but for now just marking it as loaded
          btn.style.borderColor = 'rgba(16, 185, 129, 0.4)';
        }
      }
    }
  }

  if (activeAnimeSource === 'direct' && firstProvider) {
    activeAnimeSource = firstProvider;
  }

  if (activeAnimeSource) switchAnimeSource(activeAnimeSource, currentAnimeMovieId);
}

function buildAnimeStreamSection(movie) {
  const totalEps = parseInt(movie.episodes) || 24;
  currentAnimeMovieId = movie.id;

  // Build episode dropdown options
  let epOptions = '';
  for (let i = 1; i <= totalEps; i++) {
    epOptions += '<option value="' + i + '">Episode ' + i + '</option>';
  }

  return '<div class="stream-section anime-stream-section" style="margin-bottom:24px;">' +
    '<div class="kwik-header" style="margin-bottom:12px;">' +
    '<div class="kwik-logo-wrap">' +
    '<span class="kwik-logo" style="font-size:1.5rem;">▶️</span>' +
    '<div>' +
    '<h3 class="modal-section-title" style="margin-bottom:2px;">Watch Now</h3>' +
    '<p style="font-size:0.78rem;color:var(--text-muted);margin:0;">Select an episode and source to start streaming instantly.</p>' +
    '</div>' +
    '</div>' +
    '</div>' +
    // Source selector buttons — reliable sources + direct HLS.js player
    '<div id="anime-source-buttons" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">' +
    '<button class="qbt-btn anime-src-btn active" data-source="direct" style="flex:1;min-width:80px;padding:8px 12px;font-size:0.82rem;background:linear-gradient(135deg, #10b981, #059669);color:#fff;" onclick="switchAnimeSource(\'direct\',' + movie.id + ')">▶ CineVault (Native)</button>' +
    '<button class="qbt-btn anime-src-btn" data-source="videasy" style="flex:1;min-width:80px;padding:8px 12px;font-size:0.82rem;background:var(--bg-card2);border:1px solid var(--border);color:var(--text-primary);" onclick="switchAnimeSource(\'videasy\',' + movie.id + ')">▶ Videasy</button>' +
    '<button class="qbt-btn anime-src-btn" data-source="vidsrc" style="flex:1;min-width:80px;padding:8px 12px;font-size:0.82rem;background:var(--bg-card2);border:1px solid var(--border);color:var(--text-primary);" onclick="switchAnimeSource(\'vidsrc\',' + movie.id + ')">▶ VidSrc</button>' +
    '<button class="qbt-btn anime-src-btn" data-source="animepahe" style="flex:1;min-width:80px;padding:8px 12px;font-size:0.82rem;background:var(--bg-card2);border:1px solid var(--border);color:var(--text-primary);" onclick="switchAnimeSource(\'animepahe\',' + movie.id + ')">🌸 AnimePahe</button>' +
    '<button class="qbt-btn anime-src-btn" data-source="cv_reanime" style="flex:1;min-width:80px;padding:8px 12px;font-size:0.82rem;background:var(--bg-card2);border:1px solid var(--border);color:var(--text-primary);" onclick="switchAnimeSource(\'cv_reanime\',' + movie.id + ')">🔥 Reanime</button>' +
    '<button class="qbt-btn anime-src-btn" data-source="anikoto" style="flex:1;min-width:80px;padding:8px 12px;font-size:0.82rem;background:var(--bg-card2);border:1px solid var(--border);color:var(--text-primary);" id="anikoto-src-btn" onclick="switchAnimeSource(\'anikoto\',' + movie.id + ')">▶ Anikoto</button>' +
    '<button class="qbt-btn anime-src-btn" data-source="cv_animegg" style="flex:1;min-width:80px;padding:8px 12px;font-size:0.82rem;background:var(--bg-card2);border:1px solid var(--border);color:var(--text-primary);" onclick="switchAnimeSource(\'cv_animegg\',' + movie.id + ')">⚡ AnimeGG</button>' +
    '<button class="qbt-btn anime-src-btn" data-source="cv_anineko" style="flex:1;min-width:80px;padding:8px 12px;font-size:0.82rem;background:var(--bg-card2);border:1px solid var(--border);color:var(--text-primary);" onclick="switchAnimeSource(\'cv_anineko\',' + movie.id + ')">🐱 AniNeko</button>' +
    '<button class="qbt-btn anime-src-btn" data-source="cv_anidbapp" style="flex:1;min-width:80px;padding:8px 12px;font-size:0.82rem;background:var(--bg-card2);border:1px solid var(--border);color:var(--text-primary);" onclick="switchAnimeSource(\'cv_anidbapp\',' + movie.id + ')">📺 AniDB App</button>' +
    '<button class="qbt-btn anime-src-btn" data-source="torrent" style="flex:1;min-width:80px;padding:8px 12px;font-size:0.82rem;background:var(--bg-card2);border:1px solid var(--border);color:var(--text-primary);" onclick="switchAnimeSource(\'torrent\',' + movie.id + ')">🧲 Torrent Player</button>' +
    '</div>' +
    // Episode controls: dropdown + sub/dub
    '<div id="anime-stream-controls" style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px;align-items:center;">' +
    '<div id="anime-ep-selector" style="flex:1;min-width:200px;">' +
    '<select id="anime-ep-select" style="width:100%;padding:10px 14px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--bg-card2);color:var(--text-primary);font-size:0.9rem;font-weight:600;cursor:pointer;" onchange="onAnimeEpChange(this.value,' + movie.id + ')">' +
    epOptions +
    '</select>' +
    '</div>' +
    '<div style="display:flex;gap:6px;">' +
    '<button id="anime-lang-sub" class="qbt-btn anime-lang-btn active" style="padding:6px 16px;font-size:0.82rem;background:linear-gradient(135deg, #8b5cf6, #6d28d9);" onclick="switchAnimeLang(\'sub\')">🇯🇵 SUB</button>' +
    '<button id="anime-lang-dub" class="qbt-btn anime-lang-btn" style="padding:6px 16px;font-size:0.82rem;background:var(--bg-card2);border:1px solid var(--border);color:var(--text-primary);" onclick="switchAnimeLang(\'dub\')">🇺🇸 DUB</button>' +
    '</div>' +
    '</div>' +
    // Player container with loading state
    '<div id="anime-player-container" style="width:100%;aspect-ratio:16/9;background:#000;border-radius:var(--radius-md);overflow:hidden;border:1px solid var(--border);position:relative;box-shadow:0 10px 30px rgba(0,0,0,0.5);">' +
    '<div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;color:var(--text-muted);">' +
    '<div class="loading-spinner" style="width:40px;height:40px;margin-bottom:12px;"></div>' +
    '<span id="anime-player-status" style="font-weight:600;font-size:0.9rem;">Preparing player... Episode 1 will auto-play</span>' +
    '</div>' +
    '</div>' +
    // Episode number grid for quick selection
    '<div id="anime-ep-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(60px,1fr));gap:6px;margin-top:12px;max-height:200px;overflow-y:auto;"></div>' +
    '</div>';
}

// Resolve AniList ID and auto-play episode 1 when modal opens
async function resolveAnilistAndAutoplay(movie) {
  const statusEl = document.getElementById('anime-player-status');

  // Extract MAL ID from anime_link
  let malId = null;
  if (movie.anime_link) {
    const malMatch = movie.anime_link.match(/anime\/(\d+)/);
    if (malMatch) malId = malMatch[1];
  }

  // Kick off Jikan episode data fetch in background (non-blocking)
  fetchJikanEpisodes(movie);

  // Resolve AniList ID FIRST (fast — usually <1s), then auto-play
  if (malId) {
    if (statusEl) statusEl.textContent = 'Resolving anime ID...';
    try {
      const res = await fetch('/api/anilist/mal/' + malId);
      const data = await res.json();
      if (data.ok && data.anilist_id) {
        activeAnimeAnilistId = data.anilist_id;
        console.log('[Anime] Resolved AniList ID:', activeAnimeAnilistId, 'for MAL:', malId);

        if (statusEl) statusEl.textContent = 'Fetching streams...';
        const epRes = await fetch('/api/episodes/' + activeAnimeAnilistId);
        if (epRes.ok) {
          cinevaultEpisodes = await epRes.json();
          renderCinevaultProviders();
        }
      } else {
        console.warn('[Anime] Could not resolve AniList ID for MAL:', malId);
      }
    } catch (e) {
      console.error('[Anime] AniList resolution failed:', e);
    }
  }

  // Now start playing episode 1 with the resolved AniList ID
  if (currentAnimeMovieId === movie.id) {
    if (statusEl) statusEl.textContent = 'Starting Episode 1...';
    playAnimeEpisodeNow(movie.id);
  }
}

async function searchNyaa(title, episode) {
  try {
    const url = `/api/nyaa/search?q=${encodeURIComponent(title)}&ep=${episode}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.ok && data.results && data.results.length > 0) {
      return data.results[0].magnet;
    }
    return null;
  } catch (e) {
    console.error('Nyaa search error', e);
    return null;
  }
}

async function search1337x(title, episode) {
  try {
    const url = `/api/1337x/search?q=${encodeURIComponent(title)}&ep=${episode}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.ok && data.results && data.results.length > 0) {
      return data.results[0].magnet;
    }
    return null;
  } catch (e) {
    console.error('1337x search error', e);
    return null;
  }
}

/**
 * streamMagnet — Backend-based torrent HTTP streaming
 * =====================================================
 * Sends the magnet link to the Flask /api/torrent-stream/start endpoint,
 * which forwards it to our Node.js WebTorrent server (port 9411).
 * The Node server downloads pieces over real UDP/TCP and exposes the
 * video file as a range-capable HTTP stream that the browser <video> can play.
 */
let _activeTorrentInfoHash = null;
let _torrentStatusInterval = null;

async function streamMagnet(magnet, containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  // Cancel any existing torrent
  if (_activeTorrentInfoHash) {
    fetch('/api/torrent-stream/stop/' + _activeTorrentInfoHash, { method: 'DELETE' }).catch(() => { });
    clearInterval(_torrentStatusInterval);
    _activeTorrentInfoHash = null;
  }

  // Loading UI with spinner + status bar
  container.innerHTML =
    '<div id="torrent-loading-wrap" style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;color:var(--text-muted);gap:12px;z-index:5;">' +
    '<div class="loading-spinner" style="width:48px;height:48px;border:3px solid rgba(139,92,246,0.3);border-top-color:#8b5cf6;border-radius:50%;animation:spin 0.8s linear infinite;"></div>' +
    '<span id="ts-status-line" style="font-size:0.92rem;font-weight:600;color:var(--text-primary);">🔗 Connecting to torrent network...</span>' +
    '<div id="ts-progress-bar-wrap" style="width:min(340px,90%);background:rgba(255,255,255,0.08);border-radius:999px;height:6px;overflow:hidden;display:none;">' +
    '  <div id="ts-progress-fill" style="height:100%;width:0%;background:linear-gradient(90deg,#8b5cf6,#a78bfa);border-radius:999px;transition:width 0.4s;"></div>' +
    '</div>' +
    '<span id="ts-peers-line" style="font-size:0.78rem;opacity:0.6;"></span>' +
    '</div>';

  const statusLine = () => document.getElementById('ts-status-line');
  const peersLine = () => document.getElementById('ts-peers-line');
  const fillEl = () => document.getElementById('ts-progress-fill');
  const barWrap = () => document.getElementById('ts-progress-bar-wrap');

  try {
    // Ask Flask to start the torrent in the Node.js backend
    const res = await fetch('/api/torrent-stream/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ magnet })
    });
    const data = await res.json();

    if (!data.ok) {
      // Torrent server not running or failed
      const errMsg = data.error || 'Failed to start torrent stream';
      const isNotRunning = errMsg.includes('not running') || res.status === 503;
      container.innerHTML =
        '<div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;color:var(--text-muted);gap:12px;text-align:center;padding:24px;">' +
        '<span style="font-size:2.5rem;">🖥️</span>' +
        '<span style="font-weight:700;font-size:1rem;color:var(--text-primary);">' + (isNotRunning ? 'Start the Torrent Server' : 'Stream Error') + '</span>' +
        '<span style="font-size:0.82rem;max-width:320px;">' + escapeHtml(errMsg) + '</span>' +
        (isNotRunning ? '<code style="font-size:0.78rem;background:rgba(0,0,0,0.3);padding:6px 12px;border-radius:6px;color:#a78bfa;">node torrent-stream-server.js</code>' : '') +
        '<span style="font-size:0.76rem;opacity:0.6;">Run the above command in a separate terminal, then retry.</span>' +
        '</div>';
      return;
    }

    _activeTorrentInfoHash = data.infoHash;
    const streamUrl = data.streamUrl; // Flask proxy URL e.g. /api/torrent-stream/play/abc123/file.mp4

    // Build the video player immediately — streaming works even with 0% progress
    container.innerHTML =
      '<video id="torrent-video-player" style="width:100%;height:100%;background:#000;" controls autoplay playsinline>' +
      '  <source src="' + streamUrl + '" type="video/mp4">' +
      '  Your browser does not support video playback.' +
      '</video>' +
      '<div id="torrent-hud" style="position:absolute;top:8px;right:8px;background:rgba(0,0,0,0.65);color:#a78bfa;padding:4px 10px;border-radius:6px;font-size:0.72rem;font-weight:600;pointer-events:none;z-index:5;">⬇ 0% · 0 peers</div>';

    const video = document.getElementById('torrent-video-player');
    const hud = document.getElementById('torrent-hud');

    video.addEventListener('canplay', () => {
      showToast('▶ Streaming anime via torrent backend!');
    });
    video.addEventListener('error', (e) => {
      console.error('[TorrentStream] Video error:', e);
      showToast('⚠️ Playback error — stream may not have enough data yet. Please wait a moment and retry.');
    });

    // Poll progress every 2 seconds and update HUD
    _torrentStatusInterval = setInterval(async () => {
      if (!_activeTorrentInfoHash) { clearInterval(_torrentStatusInterval); return; }
      try {
        const sr = await fetch('/api/torrent-stream/status/' + _activeTorrentInfoHash);
        const sd = await sr.json();
        if (sd.ok && hud) {
          const pct = sd.progress || 0;
          const peers = sd.numPeers || 0;
          const speed = sd.downloadSpeed ? (sd.downloadSpeed / 1024).toFixed(0) + ' KB/s' : '';
          hud.textContent = '⬇ ' + pct.toFixed(1) + '% · ' + peers + ' peers' + (speed ? ' · ' + speed : '');
          if (pct >= 100) {
            hud.textContent = '✅ 100% downloaded';
            setTimeout(() => { if (hud) hud.style.display = 'none'; }, 4000);
            clearInterval(_torrentStatusInterval);
          }
        }
      } catch (e) { /* ignore status poll errors */ }
    }, 2000);

  } catch (err) {
    console.error('[TorrentStream] Fatal error:', err);
    container.innerHTML =
      '<div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;color:var(--text-muted);gap:10px;">' +
      '<span style="font-size:2rem;">❌</span>' +
      '<span style="font-weight:600;">' + escapeHtml(err.message) + '</span>' +
      '<span style="font-size:0.78rem;opacity:0.6;">Make sure <code>node torrent-stream-server.js</code> is running</span>' +
      '</div>';
  }
}

async function playTorrentEpisode(movieId, ep) {
  const movie = appState.moviesById[movieId];
  if (!movie) return;
  const title = movie.title;

  // Scroll to player
  const container = document.getElementById('anime-player-container');
  if (container) setTimeout(() => container.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);

  showToast('🔎 Searching Nyaa for "' + title + '" episode ' + ep + '...');
  let magnet = await searchNyaa(title, ep);
  if (!magnet) {
    showToast('🔎 Nyaa not found, trying 1337x...');
    magnet = await search1337x(title, ep);
  }
  if (!magnet) {
    showToast('❌ No torrent found for episode ' + ep);
    if (container) {
      container.innerHTML =
        '<div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;color:var(--text-muted);gap:10px;">' +
        '<span style="font-size:2.5rem;">🔍</span>' +
        '<span style="font-weight:700;font-size:0.95rem;color:var(--text-primary);">No torrent found for Episode ' + ep + '</span>' +
        '<span style="font-size:0.8rem;max-width:300px;text-align:center;">Could not find "' + escapeHtml(title) + '" Episode ' + ep + ' on Nyaa or 1337x. Try another episode or use AnimePahe/Videasy.</span>' +
        '</div>';
    }
    return;
  }
  await streamMagnet(magnet, 'anime-player-container');
}

async function playMovieTorrent(movieId) {
  const movie = appState.moviesById[movieId];
  if (!movie) return;
  const title = movie.title;

  const container = document.getElementById('player-container');
  if (container) setTimeout(() => container.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);

  showToast('🔎 Searching YTS for "' + title + '"...');
  const result = await fetchYTSTorrents(movie);

  if (!result || !result.torrents.length) {
    showToast('❌ No torrent found for movie');
    if (container) {
      container.innerHTML =
        '<div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;color:var(--text-muted);gap:10px;">' +
        '<span style="font-size:2.5rem;">🔍</span>' +
        '<span style="font-weight:700;font-size:0.95rem;color:var(--text-primary);">No torrent found</span>' +
        '<span style="font-size:0.8rem;max-width:300px;text-align:center;">Could not find "' + escapeHtml(title) + '" on YTS. Try another source.</span>' +
        '</div>';
    }
    return;
  }

  const best = result.torrents[0];
  const magnet = buildMagnet(best.hash, movie.title);
  await streamMagnet(magnet, 'player-container');
}

// Switch source for anime streaming
function switchAnimeSource(source, movieId) {
  activeAnimeSource = source;
  currentAnimeMovieId = movieId;

  // Destroy current player and any torrent before switching
  _destroyCurrentPlayer('anime-player-container');
  if (_torrentClient) { _torrentClient.destroy(); _torrentClient = null; }

  // Update button active states
  document.querySelectorAll('.anime-src-btn').forEach(btn => {
    const isCurrent = btn.getAttribute('data-source') === source;
    btn.classList.toggle('active', isCurrent);
    if (isCurrent) {
      btn.style.background = 'linear-gradient(135deg, #10b981, #059669)';
      btn.style.color = '#fff';
      btn.style.borderColor = 'transparent';
    } else {
      btn.style.background = 'var(--bg-card2)';
      btn.style.color = 'var(--text-primary)';
      btn.style.borderColor = 'var(--border)';
    }
  });

  // Torrent player
  if (source === 'torrent') {
    const epSelect = document.getElementById('anime-ep-select');
    const ep = epSelect ? parseInt(epSelect.value, 10) || 1 : 1;
    playTorrentEpisode(movieId, ep);
    return;
  }

  // AnimePahe player
  if (source === 'animepahe') {
    const epSelect = document.getElementById('anime-ep-select');
    const ep = epSelect ? parseInt(epSelect.value, 10) || 1 : 1;
    playAnimepaheEpisode(movieId, ep);
    return;
  }

  // Direct HLS.js player
  if (source === 'direct') {
    playDirectHLS(movieId);
    return;
  }

  if (source.startsWith('cv_')) {
    const epSelect = document.getElementById('anime-ep-select');
    const ep = epSelect ? parseInt(epSelect.value, 10) || 1 : 1;
    playCinevaultProvider(source.replace('cv_', ''), movieId, ep);
    return;
  }

  // If switching to Anikoto and we have Anikoto episodes loaded, use those
  if (source === 'anikoto' && anikotoState.episodes.length > 0) {
    const epSelect = document.getElementById('anime-ep-select');
    const epNum = epSelect ? parseInt(epSelect.value, 10) || 1 : 1;
    // Find the matching Anikoto episode
    const anikotoEp = anikotoState.episodes.find(e => parseInt(e.number) === epNum);
    if (anikotoEp) {
      playAnikotoEpisode(anikotoEp.episode_embed_id);
      return;
    }
  }

  // For non-Anikoto sources (or if Anikoto not loaded), play via fallback
  if (source !== 'anikoto') {
    playAnimeEpisodeNow(movieId);
  } else {
    // Anikoto not loaded, show message
    const container = document.getElementById('anime-player-container');
    if (container) {
      if (anikotoState.episodes.length === 0) {
        container.innerHTML =
          '<div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;color:var(--text-muted);">' +
          '<div class="loading-spinner" style="width:40px;height:40px;margin-bottom:12px;"></div>' +
          '<span style="font-weight:600;font-size:0.9rem;">Loading Anikoto episodes...</span>' +
          '<span style="font-size:0.78rem;opacity:0.6;margin-top:4px;">If this takes long, try another source</span>' +
          '</div>';
      }
    }
  }
}

// Play the currently selected episode via the active source
async function playAnimeEpisodeNow(movieId) {
  const movie = appState.moviesById[movieId];
  if (!movie) return;

  const source = activeAnimeSource || 'direct';
  const epSelect = document.getElementById('anime-ep-select');
  const ep = epSelect ? parseInt(epSelect.value, 10) || 1 : 1;

  // Torrent player
  if (source === 'torrent') {
    playTorrentEpisode(movieId, ep);
    return;
  }

  // AnimePahe player
  if (source === 'animepahe') {
    playAnimepaheEpisode(movieId, ep);
    return;
  }

  // Direct HLS player
  if (source === 'direct') {
    playDirectHLS(movieId);
    return;
  }

  if (source.startsWith('cv_')) {
    playCinevaultProvider(source.replace('cv_', ''), movieId, ep);
    return;
  }

  // If source is anikoto and we have episodes, delegate to Anikoto player
  if (source === 'anikoto' && anikotoState.episodes.length > 0) {
    const anikotoEp = anikotoState.episodes.find(e => parseInt(e.number) === ep);
    if (anikotoEp) {
      playAnikotoEpisode(anikotoEp.episode_embed_id);
      return;
    }
  }

  // Destroy previous player before creating new
  _destroyCurrentPlayer('anime-player-container');

  // Build stream URL using the already-resolved AniList ID (pre-fetched on modal open)
  const streamUrl = buildStreamUrl(source, movie, ep);
  const container = document.getElementById('anime-player-container');
  if (!container) return;

  // Determine display source name
  let displaySource = source;
  if (source === 'videasy' && !activeAnimeAnilistId) {
    // AniList ID unavailable, so buildStreamUrl used a fallback source
    displaySource = 'vidsrc';
  }

  // Build auto-fallback: try next source if iframe doesn't load
  const animeSources = ['direct', 'videasy', 'vidsrc', 'embed'];
  const srcIdx = animeSources.indexOf(source);
  const fallbackFn = (srcIdx >= 0 && srcIdx < animeSources.length - 1) ? function () {
    const nextSrc = animeSources[srcIdx + 1];
    showToast('⏳ ' + displaySource + ' timed out, trying ' + nextSrc + '...');
    activeAnimeSource = nextSrc;
    // Update button active states
    document.querySelectorAll('.anime-src-btn').forEach(btn => {
      const isCurrent = btn.getAttribute('data-source') === nextSrc;
      btn.classList.toggle('active', isCurrent);
      btn.style.background = isCurrent ? 'linear-gradient(135deg, #10b981, #059669)' : 'var(--bg-card2)';
      btn.style.color = isCurrent ? '#fff' : 'var(--text-primary)';
      btn.style.borderColor = isCurrent ? 'transparent' : 'var(--border)';
    });
    playAnimeEpisodeNow(movieId);
  } : null;

  _injectIframeWithTimeout(container, streamUrl, 'Episode ' + ep + ' via ' + displaySource, fallbackFn);

  // Update episode grid active state
  updateEpGridActive(ep);

  showToast('▶ Playing ' + movie.title + ' — Episode ' + ep + ' via ' + displaySource);
  setTimeout(() => container.scrollIntoView({ behavior: 'smooth', block: 'center' }), 200);
}

// Update the episode grid button highlighting
function updateEpGridActive(epNum) {
  document.querySelectorAll('.anime-ep-grid-btn').forEach(btn => {
    const btnEp = parseInt(btn.dataset.ep);
    const isActive = btnEp === epNum;
    btn.classList.toggle('active', isActive);
    btn.style.background = isActive ? 'linear-gradient(135deg, #8b5cf6, #6d28d9)' : '';
    btn.style.color = isActive ? '#fff' : '';
  });
}

// Anikoto background search (non-blocking) — uses fast search endpoint
async function searchAnikotoForAnime(movie) {
  const anikotoBtn = document.getElementById('anikoto-src-btn');

  // Extract MAL ID from anime_link if available
  let malId = '';
  if (movie.anime_link) {
    const malMatch = movie.anime_link.match(/anime\/(\d+)/);
    if (malMatch) malId = malMatch[1];
  }

  try {
    // Use the fast search endpoint (direct search, max 5 page fallback instead of 30)
    const searchUrl = '/api/anikoto/search-fast?q=' + encodeURIComponent(movie.title) + (malId ? '&mal_id=' + malId : '');
    const res = await fetch(searchUrl);
    const data = await res.json();

    if (!data.ok || !data.match) {
      if (anikotoBtn) {
        anikotoBtn.style.opacity = '0.4';
        anikotoBtn.title = 'Not found on Anikoto';
      }
      return;
    }

    const anikotoAnime = data.match;
    anikotoState.seriesId = anikotoAnime.id;

    const seriesRes = await fetch('/api/anikoto/series/' + anikotoAnime.id);
    const seriesData = await seriesRes.json();

    if (!seriesData.ok || !seriesData.data || !seriesData.data.episodes || !seriesData.data.episodes.length) {
      if (anikotoBtn) {
        anikotoBtn.style.opacity = '0.4';
        anikotoBtn.title = 'No episodes on Anikoto';
      }
      return;
    }

    const episodes = seriesData.data.episodes;
    anikotoState.episodes = episodes;

    // Anikoto loaded! Update the button to show it's available
    if (anikotoBtn) {
      anikotoBtn.innerHTML = '▶ Anikoto ✓';
      anikotoBtn.title = episodes.length + ' episodes available on Anikoto';
    }

    // Check if dub is available
    const hasDub = episodes.some(ep => ep.embed_url && ep.embed_url.dub);
    const dubBtn = document.getElementById('anime-lang-dub');
    if (dubBtn && !hasDub) {
      dubBtn.disabled = true;
      dubBtn.style.opacity = '0.4';
      dubBtn.title = 'Dub not available';
    }

  } catch (err) {
    console.error('Anikoto search error:', err);
    if (anikotoBtn) {
      anikotoBtn.style.opacity = '0.4';
      anikotoBtn.title = 'Anikoto unavailable';
    }
  }
}

function playAnikotoEpisode(embedId) {
  const ep = anikotoState.episodes.find(e => String(e.episode_embed_id) === String(embedId));
  if (!ep) return;

  anikotoState.currentEp = ep;
  const lang = anikotoState.lang;
  const embedUrl = ep.embed_url && ep.embed_url[lang] ? ep.embed_url[lang] : (ep.embed_url && ep.embed_url.sub ? ep.embed_url.sub : null);

  if (!embedUrl) {
    showToast('❌ No ' + lang.toUpperCase() + ' stream available for Episode ' + ep.number + '. Try another source.');
    return;
  }

  // Destroy previous player before creating new
  _destroyCurrentPlayer('anime-player-container');

  const container = document.getElementById('anime-player-container');
  if (!container) return;

  _injectIframeWithTimeout(container, embedUrl, 'Episode ' + ep.number + ' (' + lang.toUpperCase() + ')', function () {
    // Fallback: switch to videasy if Anikoto embed fails
    showToast('⏳ Anikoto timed out, switching to Videasy...');
    switchAnimeSource('videasy', currentAnimeMovieId);
  });

  // Update dropdown to match
  const select = document.getElementById('anime-ep-select');
  if (select) select.value = String(ep.number);

  // Update grid button active state
  updateEpGridActive(parseInt(ep.number));

  showToast('▶ Playing Episode ' + ep.number + (ep.title ? ' — ' + ep.title.substring(0, 30) : '') + ' (' + lang.toUpperCase() + ')');
  setTimeout(() => container.scrollIntoView({ behavior: 'smooth', block: 'center' }), 200);
}

function switchAnimeLang(lang) {
  anikotoState.lang = lang;

  // Update button styles
  const subBtn = document.getElementById('anime-lang-sub');
  const dubBtn = document.getElementById('anime-lang-dub');
  if (subBtn) {
    subBtn.classList.toggle('active', lang === 'sub');
    subBtn.style.background = lang === 'sub' ? 'linear-gradient(135deg, #8b5cf6, #6d28d9)' : 'var(--bg-card2)';
    subBtn.style.color = lang === 'sub' ? '#fff' : 'var(--text-primary)';
    subBtn.style.borderColor = lang === 'sub' ? 'transparent' : 'var(--border)';
  }
  if (dubBtn) {
    dubBtn.classList.toggle('active', lang === 'dub');
    dubBtn.style.background = lang === 'dub' ? 'linear-gradient(135deg, #8b5cf6, #6d28d9)' : 'var(--bg-card2)';
    dubBtn.style.color = lang === 'dub' ? '#fff' : 'var(--text-primary)';
    dubBtn.style.borderColor = lang === 'dub' ? 'transparent' : 'var(--border)';
  }

  // Re-play current episode with new language if Anikoto is active
  if (activeAnimeSource === 'anikoto' && anikotoState.currentEp) {
    playAnikotoEpisode(anikotoState.currentEp.episode_embed_id);
  } else if (currentAnimeMovieId) {
    playAnimeEpisodeNow(currentAnimeMovieId);
  }
}

// Handler when episode dropdown changes — immediately plays the episode
function onAnimeEpChange(value, movieId) {
  currentAnimeMovieId = movieId;
  const epNum = parseInt(value, 10) || 1;

  // Update the grid active state
  updateEpGridActive(epNum);

  // If using Anikoto, find the matching episode
  if (activeAnimeSource === 'anikoto' && anikotoState.episodes.length > 0) {
    const anikotoEp = anikotoState.episodes.find(e => parseInt(e.number) === epNum);
    if (anikotoEp) {
      playAnikotoEpisode(anikotoEp.episode_embed_id);
      return;
    }
  }

  // Play via the active source
  playAnimeEpisodeNow(movieId);
}

// When clicking an episode in the grid
function playEpFromGrid(epNum, movieId) {
  currentAnimeMovieId = movieId;

  // Update the dropdown to match
  const select = document.getElementById('anime-ep-select');
  if (select) select.value = String(epNum);

  // Update grid active state
  updateEpGridActive(epNum);

  // If using Anikoto
  if (activeAnimeSource === 'anikoto' && anikotoState.episodes.length > 0) {
    const anikotoEp = anikotoState.episodes.find(e => parseInt(e.number) === epNum);
    if (anikotoEp) {
      playAnikotoEpisode(anikotoEp.episode_embed_id);
      return;
    }
  }

  // Play via active source
  playAnimeEpisodeNow(movieId);
}

// Legacy function kept for compatibility
function playAnimeViaFallback(source, movieId) {
  switchAnimeSource(source, movieId);
}

// ============================================================
// LAZY HLS.js LOADER — loads hls.js from CDN on first use only
// ============================================================
// Load HLS.js lazily
let _hlsJsLoading = false;
let _hlsJsLoaded = typeof Hls !== 'undefined';

function loadHlsJs() {
  return new Promise((resolve, reject) => {
    if (_hlsJsLoaded) { resolve(); return; }
    if (_hlsJsLoading) {
      // Already loading — poll until done
      const poll = setInterval(() => {
        if (typeof Hls !== 'undefined') { clearInterval(poll); _hlsJsLoaded = true; resolve(); }
      }, 100);
      return;
    }
    _hlsJsLoading = true;
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/hls.js@1/dist/hls.min.js';
    s.onload = () => { _hlsJsLoaded = true; resolve(); };
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

// ============================================================
// LAZY WEBTORRENT LOADER — loads webtorrent.min.js from CDN on first use
// ============================================================
let _webtorrentLoading = false;
let _webtorrentLoaded = typeof WebTorrent !== 'undefined';

function loadWebTorrent() {
  return new Promise((resolve, reject) => {
    if (_webtorrentLoaded || window.WebTorrent) { _webtorrentLoaded = true; resolve(); return; }
    if (_webtorrentLoading) {
      const poll = setInterval(() => {
        if (typeof WebTorrent !== 'undefined') { clearInterval(poll); _webtorrentLoaded = true; resolve(); }
      }, 100);
      return;
    }
    _webtorrentLoading = true;
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/webtorrent@latest/webtorrent.min.js';
    s.onload = () => { _webtorrentLoaded = true; resolve(); };
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

// ============================================================
// ANIMEPAHE DIRECT PLAYER (via Flask Manifest Proxy)
// ============================================================
async function playAnimepaheEpisode(movieId, ep) {
  const movie = appState.moviesById[movieId];
  if (!movie) return;

  const container = document.getElementById('anime-player-container');
  if (!container) return;

  // Show loading
  container.innerHTML =
    '<div class="stream-loading-overlay" style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;color:var(--text-muted);z-index:3;">' +
    '<div class="loading-spinner" style="width:40px;height:40px;margin-bottom:10px;"></div>' +
    '<span id="animepahe-loading-text" style="font-size:0.9rem;font-weight:600;">Connecting to AnimePahe...</span>' +
    '<span style="font-size:0.78rem;opacity:0.6;margin-top:4px;">Preparing stream for Episode ' + ep + '</span>' +
    '</div>';

  const loadingText = document.getElementById('animepahe-loading-text');

  // Step 1: Resolve AnimePahe session if not done yet
  if (!animepaheState.session) {
    if (loadingText) loadingText.textContent = 'Searching AnimePahe...';
    try {
      let malId = '';
      if (movie.anime_link) {
        const malMatch = movie.anime_link.match(/anime\/(\d+)/);
        if (malMatch) malId = malMatch[1];
      }

      const searchUrl = '/api/animepahe/search?q=' + encodeURIComponent(movie.title) + (malId ? '&mal_id=' + malId : '');
      const res = await fetch(searchUrl);
      const data = await res.json();

      if (!data.ok || !data.match) {
        throw new Error('Not found in AnimePahe catalog');
      }

      animepaheState.session = data.match.session;
      console.log('[AnimePahe] Resolved anime session:', animepaheState.session);
    } catch (err) {
      console.error('[AnimePahe] Search failed:', err);
      showToast('⚠️ AnimePahe search failed, falling back to Videasy...');
      switchAnimeSource('videasy', movieId);
      return;
    }
  }

  // Step 2: Fetch the page of episodes containing the requested episode
  const page = Math.floor((ep - 1) / 30) + 1;
  if (!animepaheState.episodes[page]) {
    if (loadingText) loadingText.textContent = 'Fetching episodes list (Page ' + page + ')...';
    try {
      const epUrl = '/api/animepahe/episodes?session=' + animepaheState.session + '&page=' + page;
      const res = await fetch(epUrl);
      const data = await res.json();

      if (!data || !data.data || !data.data.length) {
        throw new Error('No episode data returned');
      }

      animepaheState.episodes[page] = data.data;
    } catch (err) {
      console.error('[AnimePahe] Fetching episodes failed:', err);
      showToast('⚠️ Failed to load episodes from AnimePahe, falling back to Videasy...');
      switchAnimeSource('videasy', movieId);
      return;
    }
  }

  // Step 3: Find the specific episode session
  const pageEps = animepaheState.episodes[page];
  const matchedEp = pageEps.find(item => parseInt(item.episode) === ep);
  if (!matchedEp || !matchedEp.session) {
    console.warn('[AnimePahe] Episode ' + ep + ' not found in page data. Trying fallback...');
    showToast('⚠️ Episode ' + ep + ' not found on AnimePahe, falling back to Videasy...');
    switchAnimeSource('videasy', movieId);
    return;
  }

  const epSession = matchedEp.session;

  // Step 4: Resolve stream URLs (.m3u8 from Kwik via Flask proxy)
  if (loadingText) loadingText.textContent = 'Resolving video stream...';
  try {
    const streamUrl = '/api/animepahe/stream?anime_session=' + animepaheState.session + '&ep_session=' + epSession;
    const res = await fetch(streamUrl);
    const data = await res.json();

    if (!data.ok || !data.sources || !data.sources.length) {
      throw new Error('No stream sources found');
    }

    // Pick the best source
    const bestSource = data.sources[0];
    const videoUrl = bestSource.url;
    const isM3U8 = bestSource.isM3U8;

    // Build native video player
    container.innerHTML =
      '<video id="hls-direct-video" style="width:100%;height:100%;background:#000;" controls autoplay playsinline></video>' +
      '<div id="hls-quality-bar" style="position:absolute;bottom:0;left:0;right:0;padding:6px 12px;background:linear-gradient(transparent, rgba(0,0,0,0.8));display:flex;gap:6px;align-items:center;z-index:5;flex-wrap:wrap;"></div>';

    const video = document.getElementById('hls-direct-video');
    const qualityBar = document.getElementById('hls-quality-bar');

    // Lazy-load HLS.js
    await loadHlsJs();

    if (isM3U8 && typeof Hls !== 'undefined' && Hls.isSupported()) {
      const hls = new Hls({
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
        startLevel: -1,
        capLevelToPlayerSize: true,
        enableWorker: true,
      });
      _hlsInstance = hls;

      hls.loadSource(videoUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, function (event, data) {
        video.play().catch(e => console.log('[AnimePahe HLS] Autoplay blocked:', e));

        // Quality bar
        if (qualityBar && data.levels.length > 1) {
          let qHtml = '<span style="color:#aaa;font-size:0.72rem;font-weight:600;margin-right:4px;">Quality:</span>';
          qHtml += '<button class="hls-q-btn" style="padding:3px 8px;font-size:0.72rem;border-radius:4px;border:1px solid rgba(255,255,255,0.2);background:rgba(139,92,246,0.6);color:#fff;cursor:pointer;" onclick="if(_hlsInstance)_hlsInstance.currentLevel=-1">AUTO</button>';
          data.levels.forEach(function (level, idx) {
            qHtml += '<button class="hls-q-btn" style="padding:3px 8px;font-size:0.72rem;border-radius:4px;border:1px solid rgba(255,255,255,0.2);background:rgba(255,255,255,0.1);color:#fff;cursor:pointer;" onclick="if(_hlsInstance)_hlsInstance.currentLevel=' + idx + '">' + level.height + 'p</button>';
          });
          qualityBar.innerHTML = qHtml;
        } else if (qualityBar) {
          qualityBar.style.display = 'none';
        }
      });

      hls.on(Hls.Events.ERROR, function (event, data) {
        console.error('[AnimePahe HLS] Error:', data.type, data.details);
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              hls.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              hls.recoverMediaError();
              break;
            default:
              showToast('❌ AnimePahe stream failed, switching to Videasy...');
              hls.destroy();
              _hlsInstance = null;
              switchAnimeSource('videasy', movieId);
              break;
          }
        }
      });

    } else {
      // Direct load
      video.src = videoUrl;
      video.play().catch(e => console.log('[AnimePahe Direct] Autoplay blocked:', e));
      if (qualityBar) qualityBar.style.display = 'none';
    }

    // Update episode grid active state
    updateEpGridActive(ep);
    showToast('🌸 Playing Episode ' + ep + ' via AnimePahe — ' + bestSource.quality);
    setTimeout(() => container.scrollIntoView({ behavior: 'smooth', block: 'center' }), 200);

  } catch (err) {
    console.error('[AnimePahe] Stream failed:', err);
    showToast('⚠️ AnimePahe playback error, falling back to Videasy...');
    switchAnimeSource('videasy', movieId);
  }
}

// ============================================================
// DIRECT HLS.js PLAYER (Legacy - redirects to Cinevault Provider)
// ============================================================
async function playDirectHLS(movieId) {
  playCinevaultProvider('anikoto', movieId, 1);
}

async function playCinevaultProvider(provider, movieId, ep) {
  const movie = appState.moviesById[movieId];
  if (!movie) return;

  const epSelect = document.getElementById('anime-ep-select');
  if (!ep) ep = epSelect ? parseInt(epSelect.value, 10) || 1 : 1;

  // Destroy previous player
  _destroyCurrentPlayer('anime-player-container');

  const container = document.getElementById('anime-player-container');
  if (!container) return;

  const lang = anikotoState.lang || 'sub';

  // Check if we have the provider and episode ID
  if (!cinevaultEpisodes || !cinevaultEpisodes[provider]) {
    container.innerHTML =
      '<div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;color:var(--text-muted);">' +
      '<span style="font-size:2rem;margin-bottom:10px;">❌</span>' +
      '<span style="font-weight:600;font-size:0.9rem;">Provider not available for this anime</span>' +
      '</div>';
    return;
  }

  const epList = cinevaultEpisodes[provider].episodes[lang] || [];
  const epData = epList.find(e => parseInt(e.number) === parseInt(ep));

  if (!epData) {
    container.innerHTML =
      '<div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;color:var(--text-muted);">' +
      '<span style="font-size:2rem;margin-bottom:10px;">❌</span>' +
      '<span style="font-weight:600;font-size:0.9rem;">Episode ' + ep + ' (' + lang.toUpperCase() + ') not found on ' + provider + '</span>' +
      '<span style="font-size:0.78rem;opacity:0.6;margin-top:4px;">Try switching to SUB/DUB or another provider.</span>' +
      '</div>';
    return;
  }

  // The id from CineVault API looks like: "watch/anikoto/123/sub/anikoto-1"
  // We need to extract the provider_ep_id from the end.
  const idParts = epData.id.split('/');
  const providerEpId = idParts[idParts.length - 1];

  // Show loading
  container.innerHTML =
    '<div class="stream-loading-overlay" style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;color:var(--text-muted);z-index:3;">' +
    '<div class="loading-spinner" style="width:40px;height:40px;margin-bottom:10px;"></div>' +
    '<span style="font-size:0.9rem;font-weight:600;">Fetching stream for Episode ' + ep + ' from ' + provider + '...</span>' +
    '</div>';

  try {
    const res = await fetch('/api/stream/provider/' + provider + '/' + activeAnimeAnilistId + '/' + lang + '/' + providerEpId);
    const data = await res.json();

    if (!data.ok || !data.sources || !data.sources.length) {
      container.innerHTML =
        '<div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;color:var(--text-muted);">' +
        '<span style="font-size:2rem;margin-bottom:10px;">❌</span>' +
        '<span style="font-weight:600;font-size:0.9rem;">No stream sources found for Episode ' + ep + '</span>' +
        '<span style="font-size:0.78rem;opacity:0.6;margin-top:4px;">Try Videasy or another source instead</span>' +
        '</div>';
      return;
    }

    // Pick the best source
    let bestSource = data.sources[0];

    // AnimeGG MP4s are often protected by anti-hotlinking. If embed is available, prefer it.
    if (provider === 'animegg') {
      const embedSrc = data.sources.find(s => s.type === 'embed' || String(s.url).includes('embed'));
      if (embedSrc) bestSource = embedSrc;
    }

    const videoUrl = bestSource.url;
    const isM3U8 = bestSource.isM3U8;
    const streamType = bestSource.type;

    if (streamType === 'embed' || String(videoUrl).includes('embed')) {
      _injectIframeWithTimeout(container, videoUrl, 'Episode ' + ep + ' via ' + provider);
      updateEpGridActive(ep);
      showToast('▶ Playing Episode ' + ep + ' via ' + provider);
      setTimeout(() => container.scrollIntoView({ behavior: 'smooth', block: 'center' }), 200);
      return;
    }

    // Build a native video player
    container.innerHTML =
      '<video id="hls-direct-video" style="width:100%;height:100%;background:#000;" controls autoplay playsinline></video>' +
      '<div id="hls-quality-bar" style="position:absolute;bottom:0;left:0;right:0;padding:6px 12px;background:linear-gradient(transparent, rgba(0,0,0,0.8));display:flex;gap:6px;align-items:center;z-index:5;flex-wrap:wrap;"></div>';

    const video = document.getElementById('hls-direct-video');
    const qualityBar = document.getElementById('hls-quality-bar');

    // Lazy-load HLS.js if not yet loaded
    await loadHlsJs();

    if (isM3U8 && typeof Hls !== 'undefined' && Hls.isSupported()) {
      // Use HLS.js to play .m3u8
      const hls = new Hls({
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
        startLevel: -1, // auto quality
        capLevelToPlayerSize: true,
        enableWorker: true,
      });
      _hlsInstance = hls;

      hls.loadSource(videoUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, function (event, data) {
        console.log('[HLS] Manifest parsed, levels:', data.levels.length);
        video.play().catch(e => console.log('[HLS] Autoplay blocked:', e));

        // Build quality selector buttons
        if (qualityBar && data.levels.length > 1) {
          let qHtml = '<span style="color:#aaa;font-size:0.72rem;font-weight:600;margin-right:4px;">Quality:</span>';
          qHtml += '<button class="hls-q-btn" style="padding:3px 8px;font-size:0.72rem;border-radius:4px;border:1px solid rgba(255,255,255,0.2);background:rgba(139,92,246,0.6);color:#fff;cursor:pointer;" onclick="if(_hlsInstance)_hlsInstance.currentLevel=-1">AUTO</button>';
          data.levels.forEach(function (level, idx) {
            qHtml += '<button class="hls-q-btn" style="padding:3px 8px;font-size:0.72rem;border-radius:4px;border:1px solid rgba(255,255,255,0.2);background:rgba(255,255,255,0.1);color:#fff;cursor:pointer;" onclick="if(_hlsInstance)_hlsInstance.currentLevel=' + idx + '">' + level.height + 'p</button>';
          });
          qualityBar.innerHTML = qHtml;
        } else if (qualityBar) {
          qualityBar.style.display = 'none';
        }
      });

      hls.on(Hls.Events.ERROR, function (event, data) {
        console.error('[HLS] Error:', data.type, data.details);
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              console.log('[HLS] Fatal network error, trying recovery...');
              hls.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              console.log('[HLS] Fatal media error, trying recovery...');
              hls.recoverMediaError();
              break;
            default:
              showToast('❌ HLS playback failed. Switching to Videasy...');
              hls.destroy();
              _hlsInstance = null;
              switchAnimeSource('videasy', movieId);
              break;
          }
        }
      });

    } else if (isM3U8 && video.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari native HLS
      video.src = videoUrl;
      video.play().catch(e => console.log('[HLS] Safari autoplay blocked:', e));
      if (qualityBar) qualityBar.style.display = 'none';
    } else if (!isM3U8) {
      // Direct MP4
      video.src = videoUrl;
      video.play().catch(e => console.log('[Direct] Autoplay blocked:', e));
      if (qualityBar) qualityBar.style.display = 'none';
    } else {
      container.innerHTML =
        '<div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;color:var(--text-muted);">' +
        '<span style="font-size:2rem;margin-bottom:10px;">⚠️</span>' +
        '<span style="font-weight:600;font-size:0.9rem;">HLS.js not available in this browser</span>' +
        '<span style="font-size:0.78rem;opacity:0.6;margin-top:4px;">Try Videasy or Autoembed instead</span>' +
        '</div>';
      return;
    }

    // Update episode grid active state
    updateEpGridActive(ep);
    showToast('▶ Playing Episode ' + ep + ' via Direct HLS — ' + bestSource.quality);
    setTimeout(() => container.scrollIntoView({ behavior: 'smooth', block: 'center' }), 200);

  } catch (err) {
    console.error('[Direct HLS] Failed:', err);
    container.innerHTML =
      '<div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;color:var(--text-muted);">' +
      '<span style="font-size:2rem;margin-bottom:10px;">❌</span>' +
      '<span style="font-weight:600;font-size:0.9rem;">Direct stream failed</span>' +
      '<span style="font-size:0.78rem;opacity:0.6;margin-top:4px;">' + escapeHtml(err.message) + '</span>' +
      '</div>';
  }
}

// ============================================================
// UTILITIES
// ============================================================
function escapeHtml(s) {
  return (s || '').toString().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

let toastTimer;
function showToast(msg) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3000);
}

function initParticles() {
  const canvas = document.getElementById('particles-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let width, height, particles;
  function resize() { width = canvas.width = window.innerWidth; height = canvas.height = window.innerHeight; }
  class Particle {
    constructor() { this.x = Math.random() * width; this.y = Math.random() * height; this.size = Math.random() * 2 + 0.5; this.speedY = Math.random() * -0.5 - 0.1; this.speedX = (Math.random() - 0.5) * 0.5; this.alpha = Math.random() * 0.5 + 0.1; }
    update() { this.x += this.speedX; this.y += this.speedY; if (this.y < 0) { this.y = height; this.x = Math.random() * width; } }
    draw() { ctx.fillStyle = 'rgba(124,58,237,' + this.alpha + ')'; ctx.beginPath(); ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2); ctx.fill(); }
  }
  function createParticles() { particles = []; const n = window.innerWidth < 768 ? 30 : 80; for (let i = 0; i < n; i++) particles.push(new Particle()); }
  function animate() { ctx.clearRect(0, 0, width, height); particles.forEach(p => { p.update(); p.draw(); }); requestAnimationFrame(animate); }
  window.addEventListener('resize', () => { resize(); createParticles(); });
  resize(); createParticles(); animate();
}

function animateNumbers() {
  document.querySelectorAll('.count-up').forEach(el => {
    const target = parseInt(el.getAttribute('data-target'));
    const inc = Math.ceil(target / 80);
    let curr = 0;
    const timer = setInterval(() => {
      curr += inc;
      if (curr >= target) { el.textContent = target.toLocaleString(); clearInterval(timer); }
      else el.textContent = curr.toLocaleString();
    }, 25);
  });
}

function toggleDrawer() {
  const d = document.getElementById('mobile-drawer');
  d.classList.toggle('open');
  document.body.style.overflow = d.classList.contains('open') ? 'hidden' : '';
}
function closeDrawer() { document.getElementById('mobile-drawer').classList.remove('open'); document.body.style.overflow = ''; }

// ============================================================
// MAIN INIT
// ============================================================
async function mountApp() {
  initTheme();
  initParticles();

  // Core listeners
  const on = (id, ev, fn) => { const el = document.getElementById(id); if (el) el.addEventListener(ev, fn); };
  on('theme-toggle', 'click', toggleTheme);
  on('drawer-theme-btn', 'click', toggleTheme);
  on('mobile-menu-btn', 'click', toggleDrawer);
  on('drawer-close', 'click', closeDrawer);
  on('drawer-backdrop', 'click', closeDrawer);
  on('modal-close-btn', 'click', closeMovieModal);
  on('hero-search', 'input', handleSearchInput);
  on('search-clear', 'click', resetFilters);
  on('reset-filters', 'click', resetFilters);
  on('clear-wl-btn', 'click', clearWatchlist);
  on('close-panel-btn', 'click', closeLanguageSection);

  const modal = document.getElementById('modal-overlay');
  if (modal) modal.addEventListener('click', e => { if (e.target === e.currentTarget) closeMovieModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMovieModal(); });

  ['f-type', 'f-genre', 'f-lang', 'f-rating', 'f-year', 'f-sort'].forEach(id => { const el = document.getElementById(id); if (el) el.addEventListener('change', applyFilters); });

  // View toggles
  const vGrid = document.getElementById('view-grid');
  const vList = document.getElementById('view-list');
  const grid = document.getElementById('movies-grid');
  if (vGrid && vList && grid) {
    vGrid.addEventListener('click', () => { grid.classList.remove('list-view'); vGrid.classList.add('active'); vList.classList.remove('active'); localStorage.setItem('cv_view', 'grid'); });
    vList.addEventListener('click', () => { grid.classList.add('list-view'); vList.classList.add('active'); vGrid.classList.remove('active'); localStorage.setItem('cv_view', 'list'); });
    if (appState.viewMode === 'list') vList.click();
  }

  // Strip nav
  const sLeft = document.getElementById('strip-left');
  const sRight = document.getElementById('strip-right');
  const strip = document.getElementById('trending-strip');
  if (sLeft && strip) sLeft.addEventListener('click', () => strip.scrollBy({ left: -600, behavior: 'smooth' }));
  if (sRight && strip) sRight.addEventListener('click', () => strip.scrollBy({ left: 600, behavior: 'smooth' }));

  // Region tabs
  const rTabs = document.getElementById('lang-region-tabs');
  if (rTabs) rTabs.addEventListener('click', e => {
    if (!e.target.classList.contains('region-tab')) return;
    document.querySelectorAll('.region-tab').forEach(t => t.classList.remove('active'));
    e.target.classList.add('active');
    renderLanguagePills(e.target.dataset.region);
  });

  // Scroll behaviour
  const nav = document.getElementById('navbar');
  const btt = document.getElementById('back-to-top');
  if (btt) btt.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
  window.addEventListener('scroll', () => {
    if (nav) nav.classList.toggle('scrolled', window.scrollY > 50);
    if (btt) btt.classList.toggle('visible', window.scrollY > 500);
  });

  // Show loading state
  const loadingOverlay = document.getElementById('loading-overlay');
  if (loadingOverlay) loadingOverlay.style.display = 'flex';
  const gridEl = document.getElementById('movies-grid');
  if (gridEl) gridEl.innerHTML = '<div class="loading-skeleton-grid">' + Array(12).fill('<div class="skeleton-card"></div>').join('') + '</div>';

  // Load data from SQLite backend API
  try {
    const res = await fetch(CONFIG.JSON_URL);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    appState.movies = data;

    // Hide loading overlay
    if (loadingOverlay) { loadingOverlay.style.opacity = '0'; setTimeout(() => { loadingOverlay.style.display = 'none'; }, 400); }

    const statEl = document.getElementById('stat-movies');
    if (statEl) { statEl.setAttribute('data-target', String(appState.movies.length)); animateNumbers(); }

    populateFilterDropdowns();
    updateWatchlistUI();

    // Check URL for specific content type (e.g. ?type=anime)
    const urlParams = new URLSearchParams(window.location.search);
    const cType = urlParams.get('type');
    if (cType && document.getElementById('f-type')) {
      document.getElementById('f-type').value = cType;
      const browseTitle = document.getElementById('browse-title');
      if (browseTitle && cType === 'anime') browseTitle.textContent = 'Anime Catalog';
      else if (browseTitle && cType === 'movie') browseTitle.textContent = 'Movie Catalog';
    }

    if (document.getElementById('trending-strip')) renderTrending();
    if (document.getElementById('movies-grid')) applyFilters();
  } catch (err) {
    console.error('Failed to load movie data:', err);
    if (loadingOverlay) loadingOverlay.style.display = 'none';
    const g = document.getElementById('movies-grid');
    if (g) g.innerHTML = '<div class="empty-state" style="color:var(--error,#f66);border-color:var(--error,#f66)"><span class="empty-icon">⚠️</span><h3>Failed to load movies dataset</h3><p>Make sure the backend is running: <code>python server.py</code> (SQLite powered)</p></div>';
  }
}

document.addEventListener('DOMContentLoaded', mountApp);
