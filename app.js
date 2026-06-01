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

// --- State ---
let appState = {
  movies: [], filtered: [], currentPage: 1,
  watchlist: JSON.parse(getStorage('cv_watchlist', '[]')),
  theme: getStorage('cv_theme', 'dark'),
  viewMode: getStorage('cv_view', 'grid'),
  activeLanguage: null
};

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

function buildAnikotoSearchUrl(title) {
  return 'https://anikototv.to/filter?keyword=' + encodeURIComponent(title);
}

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
  const movie = appState.movies.find(m => m.id == movieId);
  if (!movie) return;
  const title = movie.title;
  openKwikDownload(title, episode);
}

function renderEpisodeDownloadGrid(movieId, startEp, endEp) {
  const movie = appState.movies.find(m => m.id == movieId);
  if (!movie) return;
  const container = document.getElementById('kwik-episode-grid');
  if (!container) return;

  let html = '';
  for (let ep = startEp; ep <= endEp; ep++) {
    html += '<button class="kwik-ep-btn" onclick="downloadAnimeEpisode(' + movieId + ',' + ep + ')">' +
      '<span class="kwik-ep-num">Ep ' + ep + '</span>' +
      '<span class="kwik-ep-icon">⬇</span>' +
      '</button>';
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
  const movie = appState.movies.find(m => m.id == movieId);
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
  const s = (appState.currentPage - 1) * CONFIG.PAGE_SIZE;
  renderGrid(appState.filtered.slice(s, s + CONFIG.PAGE_SIZE), 'movies-grid');
  renderTrending();
  if (appState.activeLanguage) renderLanguageSection(appState.activeLanguage);
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
  const s = (appState.currentPage - 1) * CONFIG.PAGE_SIZE;
  renderGrid(appState.filtered.slice(s, s + CONFIG.PAGE_SIZE), 'movies-grid');
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
  const hasPoster = !!movie.poster_url;
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
    (hasPoster ? '<img src="' + movie.poster_url + '" class="poster-img" alt="' + escapeHtml(movie.title) + '" loading="lazy" referrerpolicy="no-referrer" onerror="handlePosterError(this)">' : '') +
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

function renderTrending() {
  const el = document.getElementById('trending-strip');
  if (!el) return;
  const trending = [...appState.movies].sort((a, b) => b.popularity - a.popularity).slice(0, 15);
  el.innerHTML = trending.map(m => buildMovieCard(m)).join('');
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
    const wlMovies = appState.watchlist.map(id => appState.movies.find(m => m.id == id)).filter(Boolean);
    renderGrid(wlMovies, 'watchlist-grid');
  }
}

// ============================================================
// FILTER & PAGINATION
// ============================================================
function applyFilters() {
  const searchEl = document.getElementById('hero-search');
  const searchQ = searchEl ? searchEl.value.toLowerCase().trim() : '';
  const genreEl = document.getElementById('f-genre');
  const langEl = document.getElementById('f-lang');
  const rankEl = document.getElementById('f-rating');
  const yearEl = document.getElementById('f-year');
  const sortEl = document.getElementById('f-sort');
  const typeEl = document.getElementById('f-type');
  const genre = genreEl ? genreEl.value : '';
  const lang = langEl ? langEl.value : '';
  const rank = rankEl ? rankEl.value : '';
  const yearGroup = yearEl ? yearEl.value : '';
  const sort = sortEl ? sortEl.value : 'popularity';
  const typeFilter = typeEl ? typeEl.value : '';

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
function populateFilterDropdowns() {
  const genres = new Set();
  const langs = {};
  appState.movies.forEach(m => {
    (m.genres || []).forEach(g => genres.add(g));
    langs[m.original_language] = (langs[m.original_language] || 0) + 1;
  });

  const gSelect = document.getElementById('f-genre');
  const gTabs = document.getElementById('genre-quick-tabs');
  Array.from(genres).sort().forEach(g => {
    if (gSelect) gSelect.innerHTML += '<option value="' + g + '">' + (GENRE_ICON[g] || '') + ' ' + g + '</option>';
  });
  if (gTabs) {
    ['Action', 'Comedy', 'Drama', 'Science Fiction', 'Romance', 'Horror'].forEach(g => {
      if (genres.has(g)) gTabs.innerHTML += '<button class="genre-tab" onclick="window.location.href=\'movies.html\'" role="tab">' + (GENRE_ICON[g] || '') + ' ' + g + '</button>';
    });
  }

  const lSelect = document.getElementById('f-lang');
  Object.entries(langs).sort((a, b) => b[1] - a[1]).forEach(([c, num]) => {
    const info = getLangInfo(c);
    if (lSelect) lSelect.innerHTML += '<option value="' + c + '">' + info.flag + ' ' + info.name + ' (' + num + ')</option>';
  });

  renderLanguagePills('all');
}

// ============================================================
// SEARCH SUGGESTIONS
// ============================================================
function handleSearchInput(e) {
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
    '<div class="sugg-meta">' + getYear(m.release_date) + ' • ' + m.original_language.toUpperCase() + ' • ⭐ ' + parseFloat(m.vote_average || 0).toFixed(1) + '</div>' +
    '</div>' +
    '</div>'
  ).join('');
  suggBox.style.display = 'block';
}

// ============================================================
// LANGUAGES SECTION
// ============================================================
function renderLanguagePills(regionFilter) {
  const langs = {};
  appState.movies.forEach(m => { langs[m.original_language] = (langs[m.original_language] || 0) + 1; });
  const container = document.getElementById('language-pills');
  if (!container) return;
  let html = '';
  Object.entries(langs).sort((a, b) => b[1] - a[1]).forEach(([code, count]) => {
    const info = getLangInfo(code);
    if (regionFilter !== 'all' && info.region !== regionFilter && info.region !== 'all') return;
    html += '<button class="lang-pill ' + (appState.activeLanguage === code ? 'active' : '') + '" onclick="renderLanguageSection(\'' + code + '\')">' +
      '<span class="lang-flag">' + info.flag + '</span><span class="lang-name">' + info.name + '</span><span class="lang-count">' + count + '</span>' +
      '</button>';
  });
  container.innerHTML = html || '<p style="grid-column:1/-1;color:var(--text-muted)">No languages found.</p>';
}

function renderLanguageSection(langCode) {
  appState.activeLanguage = langCode;
  document.querySelectorAll('.lang-pill').forEach(el => el.classList.remove('active'));
  const pillIdx = Array.from(document.querySelectorAll('.lang-pill')).findIndex(p => p.textContent.includes(getLangInfo(langCode).name));
  if (pillIdx !== -1) document.querySelectorAll('.lang-pill')[pillIdx].classList.add('active');
  const panel = document.getElementById('lang-movies-panel');
  const title = document.getElementById('panel-title');
  const info = getLangInfo(langCode);
  const movies = appState.movies.filter(m => m.original_language === langCode).sort((a, b) => b.popularity - a.popularity).slice(0, 24);
  if (title) title.innerHTML = info.flag + ' ' + info.name + ' Movies';
  renderGrid(movies, 'lang-movies-grid');
  if (panel) { panel.style.display = 'block'; panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
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
function openMovieModal(id) {
  const movie = appState.movies.find(m => m.id == id);
  if (!movie) return;
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
  const posterHtml = movie.poster_url ? '<img src="' + movie.poster_url + '" class="modal-backdrop-img" alt="" referrerpolicy="no-referrer" onerror="this.style.display=\'none\'">' : '<div style="width:100%;height:100%;background:' + grad + ';display:flex;align-items:center;justify-content:center;font-size:10rem;">' + getEmojiForMovie(movie) + '</div>';
  const posterLgHtml = movie.poster_url ? '<img src="' + movie.poster_url + '" alt="" referrerpolicy="no-referrer" onerror="handlePosterError(this)">' : '<div class="poster-fallback" style="height:100%"><span class="fallback-emoji" style="font-size:5rem">' + getEmojiForMovie(movie) + '</span></div>';

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
      '<button class="qbt-btn stream-source-btn" data-source="autoembed" style="flex:1;background:var(--bg-card2);border:1px solid var(--border);color:var(--text-primary);" onclick="switchStreamSource(\'autoembed\',' + movie.id + ')">▶ AutoEmbed</button>' +
      '<button class="qbt-btn stream-source-btn" data-source="vidsrc" style="flex:1;background:var(--bg-card2);border:1px solid var(--border);color:var(--text-primary);" onclick="switchStreamSource(\'vidsrc\',' + movie.id + ')">▶ VidSrc</button>' +
      '<button class="qbt-btn stream-source-btn" data-source="embed" style="flex:1;background:var(--bg-card2);border:1px solid var(--border);color:var(--text-primary);" onclick="switchStreamSource(\'embed\',' + movie.id + ')">▶ MultiEmbed</button>' +
      '</div>' +
      '<div id="player-container" style="width:100%;aspect-ratio:16/9;background:#000;border-radius:var(--radius-md);overflow:hidden;border:1px solid var(--border);position:relative;box-shadow:0 10px 30px rgba(0,0,0,0.5);">' +
      '<div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;color:var(--text-muted);">' +
      '<span style="font-size:3rem;margin-bottom:10px;">🎬</span>' +
      '<span style="font-weight:600;font-size:0.9rem;">Click a source above to start streaming</span>' +
      '</div>' +
      '</div>' +
      '</div>' : '') +
    (isAnime ? buildAnimeStreamSection(movie) : '') +
    (isAnime ? buildKwikDownloadSection(movie) : '') +
    '<div class="qbt-section">' +
    '<h3 class="modal-section-title" style="margin-bottom:10px;">' + (isAnime ? '🧲 Torrent Download' : '🎬 Download') + '</h3>' +
    '<p style="font-size:0.82rem;color:var(--text-muted);margin-bottom:10px;">' +
    (isAnime ? 'Alternatively, find torrents from Nyaa directly in your Torrent client.' : 'Finds the best available torrent from YTS and opens it directly in your qBittorrent app.') +
    '</p>' +
    '<div id="qbt-torrent-info" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;min-height:26px;"></div>' +
    '<button id="qbt-download-btn" class="qbt-btn" onclick="downloadWithQBittorrent(' + movie.id + ')">' + (isAnime ? '🧲 Search on Nyaa' : '🎬 Open Best in qBittorrent') + '</button>' +
    '<div id="qbt-quality-panel" style="display:flex;flex-wrap:wrap;gap:8px;margin-top:12px;"></div>' +
    '</div>' +
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
    activeAnimeSource = 'videasy';
    currentAnimeMovieId = movie.id;
    activeAnimeAnilistId = null;
    anikotoState = { episodes: [], seriesId: null, currentEp: null, lang: 'sub' };

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
        // Also render the download grid
        renderEpisodeDownloadGrid(movie.id, 1, Math.min(24, totalEps));
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
  // Stop playing video when modal is closed — clear iframe src first
  const player = document.getElementById('player-container');
  if (player) {
    const iframe = player.querySelector('iframe');
    if (iframe) iframe.src = 'about:blank';
    player.innerHTML = '';
  }
  // Clear anime player too
  const animePlayer = document.getElementById('anime-player-container');
  if (animePlayer) {
    const iframe = animePlayer.querySelector('iframe');
    if (iframe) iframe.src = 'about:blank';
    animePlayer.innerHTML = '';
  }
  activeStreamSource = null;
  activeAnimeSource = 'videasy';
  currentAnimeMovieId = null;
  activeAnimeAnilistId = null;
  anikotoState = { episodes: [], seriesId: null, currentEp: null, lang: 'sub' };
}

// --- Active stream source tracker ---
let activeStreamSource = null;

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
        // Fallback: use MAL ID with autoembed instead of broken TV format
        if (malId) {
          return 'https://autoembed.to/anime/mal/' + malId + '/' + ep;
        }
        // Last resort: try title-based search on vidsrc
        return 'https://vidsrc.cc/v2/embed/tv/' + tmdbId + '/1/' + ep;
      }
      return 'https://player.videasy.net/movie/' + tmdbId + '?color=8B5CF6';

    case 'autoembed':
      if (isAnime) {
        if (malId) return 'https://autoembed.to/anime/mal/' + malId + '/' + ep;
        return 'https://autoembed.to/tv/tmdb/' + tmdbId + '-1-' + ep;
      }
      return 'https://autoembed.to/movie/tmdb/' + tmdbId;

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
      if (isAnime && malId) return 'https://autoembed.to/anime/mal/' + malId + '/' + ep;
      return 'https://player.videasy.net/movie/' + tmdbId;
  }
}

function switchStreamSource(source, movieId) {
  const movie = appState.movies.find(m => m.id == movieId);
  if (!movie) return;

  // If source is null, reuse active source (episode change)
  if (!source) source = activeStreamSource || 'videasy';
  activeStreamSource = source;

  const isAnime = movie.content_type === 'anime';
  const container = document.getElementById('player-container');
  if (!container) return;

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

  // Get episode number for anime
  let ep = 1;
  if (isAnime) {
    const epSelect = document.getElementById('anime-ep-select');
    if (epSelect) ep = parseInt(epSelect.value, 10) || 1;
  }

  const streamUrl = buildStreamUrl(source, movie, ep);

  // Show loading then embed iframe
  container.innerHTML =
    '<div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;color:var(--text-muted);z-index:1;">' +
    '<div class="loading-spinner" style="width:40px;height:40px;margin-bottom:10px;"></div>' +
    '<span style="font-size:0.9rem;font-weight:600;">Loading ' + escapeHtml(source) + ' player...</span>' +
    '</div>' +
    '<iframe src="' + streamUrl + '" ' +
    'style="position:absolute;inset:0;width:100%;height:100%;border:none;z-index:2;" ' +
    'allowfullscreen allow="autoplay; encrypted-media; picture-in-picture; fullscreen" ' +
    'referrerpolicy="no-referrer" ' +
    'loading="lazy">' +
    '</iframe>';

  showToast('▶ Loading ' + (isAnime ? movie.title + ' Ep ' + ep : movie.title) + ' via ' + source + '...');

  // Scroll player into view
  setTimeout(() => container.scrollIntoView({ behavior: 'smooth', block: 'center' }), 200);
}


// ============================================================
// ANIKOTO ANIME STREAMING ENGINE
// ============================================================
let anikotoState = { episodes: [], seriesId: null, currentEp: null, lang: 'sub' };
let activeAnimeSource = 'videasy'; // Track the active anime source
let currentAnimeMovieId = null; // Track which anime is open
let activeAnimeAnilistId = null; // AniList ID for Videasy

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
    // Source selector buttons — only reliable sources available
    '<div id="anime-source-buttons" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">' +
    '<button class="qbt-btn anime-src-btn active" data-source="videasy" style="flex:1;min-width:80px;padding:8px 12px;font-size:0.82rem;background:linear-gradient(135deg, #10b981, #059669);color:#fff;" onclick="switchAnimeSource(\'videasy\',' + movie.id + ')">▶ Videasy</button>' +
    '<button class="qbt-btn anime-src-btn" data-source="anikoto" style="flex:1;min-width:80px;padding:8px 12px;font-size:0.82rem;background:var(--bg-card2);border:1px solid var(--border);color:var(--text-primary);" id="anikoto-src-btn" onclick="switchAnimeSource(\'anikoto\',' + movie.id + ')">▶ Anikoto</button>' +
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

  // Try to resolve AniList ID for Videasy
  if (malId) {
    try {
      if (statusEl) statusEl.textContent = 'Resolving anime ID...';
      const res = await fetch('/api/anilist/mal/' + malId);
      const data = await res.json();
      if (data.ok && data.anilist_id) {
        activeAnimeAnilistId = data.anilist_id;
        console.log('[Anime] Resolved AniList ID:', activeAnimeAnilistId, 'for MAL:', malId);
      } else {
        console.warn('[Anime] Could not resolve AniList ID for MAL:', malId);
      }
    } catch (e) {
      console.error('[Anime] AniList resolution failed:', e);
    }
  }

  // Auto-play episode 1 if modal is still open for this movie
  if (currentAnimeMovieId === movie.id) {
    playAnimeEpisodeNow(movie.id);
  }
}

// Switch source for anime streaming
function switchAnimeSource(source, movieId) {
  activeAnimeSource = source;
  currentAnimeMovieId = movieId;

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
  const movie = appState.movies.find(m => m.id == movieId);
  if (!movie) return;

  const source = activeAnimeSource || 'videasy';
  const epSelect = document.getElementById('anime-ep-select');
  const ep = epSelect ? parseInt(epSelect.value, 10) || 1 : 1;

  // If source is anikoto and we have episodes, delegate to Anikoto player
  if (source === 'anikoto' && anikotoState.episodes.length > 0) {
    const anikotoEp = anikotoState.episodes.find(e => parseInt(e.number) === ep);
    if (anikotoEp) {
      playAnikotoEpisode(anikotoEp.episode_embed_id);
      return;
    }
  }

  // Build stream URL using the already-resolved AniList ID (pre-fetched on modal open)
  const streamUrl = buildStreamUrl(source, movie, ep);
  const container = document.getElementById('anime-player-container');
  if (!container) return;

  // Determine display source name
  let displaySource = source;
  if (source === 'videasy' && !activeAnimeAnilistId) {
    // AniList ID unavailable, so buildStreamUrl used a fallback source
    displaySource = movie.anime_link ? 'autoembed' : 'vidsrc';
  }

  container.innerHTML =
    '<div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;color:var(--text-muted);z-index:1;">' +
    '<div class="loading-spinner" style="width:40px;height:40px;margin-bottom:10px;"></div>' +
    '<span style="font-size:0.9rem;font-weight:600;">Loading Episode ' + ep + ' via ' + displaySource + '...</span>' +
    '</div>' +
    '<iframe src="' + streamUrl + '" ' +
    'style="position:absolute;inset:0;width:100%;height:100%;border:none;z-index:2;" ' +
    'allowfullscreen allow="autoplay; encrypted-media; picture-in-picture; fullscreen" ' +
    'referrerpolicy="no-referrer" ' +
    'loading="lazy">' +
    '</iframe>';

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

// Anikoto background search (non-blocking)
async function searchAnikotoForAnime(movie) {
  const anikotoBtn = document.getElementById('anikoto-src-btn');

  // Extract MAL ID from anime_link if available
  let malId = '';
  if (movie.anime_link) {
    const malMatch = movie.anime_link.match(/anime\/(\d+)/);
    if (malMatch) malId = malMatch[1];
  }

  try {
    const searchUrl = '/api/anikoto/search-title?q=' + encodeURIComponent(movie.title) + (malId ? '&mal_id=' + malId : '');
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

  const container = document.getElementById('anime-player-container');
  if (!container) return;

  container.innerHTML =
    '<div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;color:var(--text-muted);z-index:1;">' +
    '<div class="loading-spinner" style="width:40px;height:40px;margin-bottom:10px;"></div>' +
    '<span style="font-size:0.9rem;font-weight:600;">Loading Episode ' + ep.number + ' (' + lang.toUpperCase() + ')...</span>' +
    '</div>' +
    '<iframe src="' + embedUrl + '" ' +
    'style="position:absolute;inset:0;width:100%;height:100%;border:none;z-index:2;" ' +
    'allowfullscreen allow="autoplay; encrypted-media; picture-in-picture; fullscreen" ' +
    'referrerpolicy="no-referrer" ' +
    'loading="lazy">' +
    '</iframe>';

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
// KWIK DOWNLOAD SECTION BUILDER
// ============================================================
function buildKwikDownloadSection(movie) {
  const totalEps = parseInt(movie.episodes) || 0;
  const epsPerPage = 24;
  const totalPages = Math.ceil(totalEps / epsPerPage) || 1;
  const showEps = totalEps > 0;

  let html = '<div class="kwik-section">';
  html += '<div class="kwik-header">';
  html += '<div class="kwik-logo-wrap">';
  html += '<span class="kwik-logo">⬇</span>';
  html += '<div>';
  html += '<h3 class="modal-section-title" style="margin-bottom:2px;">▶️ Watch Anime (Anikoto)</h3>';
  html += '<p style="font-size:0.78rem;color:var(--text-muted);margin:0;">Browser embeds buffer infinitely for anime. Click an episode below to watch or download instantly without buffering.</p>';
  html += '</div>';
  html += '</div>';
  html += '<a href="https://anikototv.to/filter?keyword=' + encodeURIComponent(movie.title) + '" target="_blank" rel="noopener" class="kwik-browse-all" onclick="showToast(\'Opening Anikoto...\')">Browse All ↗</a>';
  html += '</div>';

  if (showEps) {
    // Quick download all button
    html += '<button class="kwik-download-all-btn" onclick="openKwikDownload(\'' + escapeHtml(movie.title).replace(/'/g, "\\'") + '\')">';
    html += '<span class="kwik-dl-icon">📥</span> Open on Anikoto (Kwik)';
    html += '</button>';

    // Episode grid with pagination
    html += '<div class="kwik-ep-controls">';
    html += '<span style="font-size:0.82rem;font-weight:600;color:var(--text-secondary);">' + totalEps + ' Episodes Available</span>';
    if (totalPages > 1) {
      html += '<div class="kwik-ep-nav">';
      html += '<button id="kwik-ep-prev" class="kwik-nav-btn" onclick="changeEpPage(' + movie.id + ',' + totalEps + ',-1)" disabled>◀</button>';
      html += '<span id="kwik-ep-page" class="kwik-page-indicator" data-page="1">Page 1 / ' + totalPages + '</span>';
      html += '<button id="kwik-ep-next" class="kwik-nav-btn" onclick="changeEpPage(' + movie.id + ',' + totalEps + ',1)"' + (totalPages <= 1 ? ' disabled' : '') + '>▶</button>';
      html += '</div>';
    }
    html += '</div>';

    html += '<div id="kwik-episode-grid" class="kwik-episode-grid"></div>';

    // Episode grid is populated by openMovieModal after DOM update
  } else {
    html += '<button class="kwik-download-all-btn" onclick="openKwikDownload(\'' + escapeHtml(movie.title).replace(/'/g, "\\'") + '\')">';
    html += '<span class="kwik-dl-icon">📥</span> Search on Anikoto (Kwik)';
    html += '</button>';
    html += '<p style="font-size:0.8rem;color:var(--text-muted);text-align:center;margin-top:8px;">Episode count not available — browse manually to find episodes.</p>';
  }

  html += '</div>';
  return html;
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
