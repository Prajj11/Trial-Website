import re

with open('app.js', 'r', encoding='utf-8') as f:
    content = f.read()

# Define the exact bad snippet to look for
start_marker = "const handleSearchInput = debounce(function (e) {"
end_marker = "if (panel) { panel.style.display = 'block'; panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }\n}"

if start_marker in content and end_marker in content:
    start_idx = content.find(start_marker)
    end_idx = content.find(end_marker, start_idx) + len(end_marker)
    
    correct_code = """const handleSearchInput = debounce(async function (e) {
  const q = e.target.value.trim().toLowerCase();
  const clearBtn = document.getElementById('search-clear');
  const suggBox = document.getElementById('search-suggestions');
  if (clearBtn) clearBtn.style.display = q ? 'flex' : 'none';

  // If we are on the browse catalog page, trigger server-side search
  if (document.getElementById('movies-grid')) {
    applyFilters();
    if (suggBox) suggBox.style.display = 'none';
    return;
  }

  if (!q || q.length < 2) { if (suggBox) suggBox.style.display = 'none'; return; }

  // Home page: use search API
  try {
    const res = await fetch(CONFIG.API_BASE + '/search?q=' + encodeURIComponent(q));
    const suggs = await res.json();
    cacheMovies(suggs);

    if (!suggs.length || !suggBox) { if (suggBox) suggBox.style.display = 'none'; return; }

    suggBox.innerHTML = suggs.map(m => {
      const pUrl = getProxiedPosterUrl(m.poster_url);
      return '<div class="suggestion-item" onclick="openMovieModal(' + m.id + ');document.getElementById(\\'search-suggestions\\').style.display=\\'none\\'">' +
        '<div class="sugg-poster">' + (pUrl ? '<img src="' + pUrl + '" style="width:100%;height:100%;object-fit:cover;border-radius:6px" alt="" referrerpolicy="no-referrer" onerror="this.style.display=\\'none\\'">' : getEmojiForMovie(m)) + '</div>' +
        '<div class="sugg-info">' +
        '<div class="sugg-title">' + escapeHtml(m.title) + '</div>' +
        '<div class="sugg-meta">' + getYear(m.release_date) + ' \\u2022 ' + m.original_language.toUpperCase() + ' \\u2022 \\u2b50 ' + parseFloat(m.vote_average || 0).toFixed(1) + '</div>' +
        '</div></div>';
    }).join('');
    suggBox.style.display = 'block';
  } catch (err) {
    console.error('Search failed:', err);
    if (suggBox) suggBox.style.display = 'none';
  }
}, 300);

// ============================================================
// LANGUAGES SECTION
// ============================================================
function renderLanguagePills(regionFilter) {
  const container = document.getElementById('language-pills');
  if (!container) return;
  const data = appState.languagesData;
  if (!data || !data.length) return;
  let html = '';
  data.forEach(({code, count}) => {
    const info = getLangInfo(code);
    if (regionFilter !== 'all' && info.region !== regionFilter && info.region !== 'all') return;
    html += '<button class="lang-pill " + (appState.activeLanguage === code ? "active" : "") + " onclick=\\"renderLanguageSection('" + code + "')\\">"+
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
    if (gridEl) gridEl.innerHTML = '<div class="empty-state"><span class="empty-icon">\\u26a0\\ufe0f</span><h3>Failed to load</h3></div>';
  }
}"""
    
    new_content = content[:start_idx] + correct_code + content[end_idx:]
    
    with open('app.js', 'w', encoding='utf-8') as f:
        f.write(new_content)
    print("Fixed syntax errors successfully.")
else:
    print("Could not find the exact markers.")
