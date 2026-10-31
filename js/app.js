/**
 * Musico - Main Application Controller
 * Handles local folder loading, UI rendering, search, modals, and events.
 */

document.addEventListener('DOMContentLoaded', async () => {
  const fileManager = new FileManager();
  const player = new MusicPlayer();
  window.appPlayer = player;
  window.appFileManager = fileManager;
  window.fileManager = fileManager;
  window.player = player;

  // App State
  let allTracks = [];
  let currentFilter = 'all';
  let isGridView = false;
  let currentView = 'all_songs'; // 'all_songs', 'playlists', 'playlist_songs', 'explore', 'artist_main', 'artist_detail'
  let currentArtistPcMode = 1; // 1 = List View, 2 = Grid View (Artist Section only)
  let currentArtistDetailMode = 1; // 1 = About/Default, 2 = Lyrics, 3 = Top Songs Grid, 4 = Up Next (Individual Artist View)
  let currentAlbumsPcMode = 1; // 1 = List View, 2 = Grid View (Albums Section only)
  let currentAlbumDetailMode = 1; // 1 = Songs List, 2 = Lyrics, 3 = Grid View, 4 = Up Next (Individual Album View)
  let currentFavouritesMode = 1; // 1 = List View, 2 = Lyrics, 3 = Grid View, 4 = Up Next (Favourites View)
  let currentGenreMode = 1; // 1 = List View, 2 = Lyrics, 3 = Grid View, 4 = Up Next (Genre View)
  let currentFoldersPcMode = 1; // 1 = List View, 2 = Lyrics, 3 = Grid View, 4 = Up Next (Folder View)
  let currentPlaylistSongsMode = 1; // 1 = Songs List, 2 = Lyrics, 3 = Grid View, 4 = Up Next (Playlist Songs View)
  let activePlaylistId = null;
  let selectedArtistName = null;
  let selectedAlbumName = null;
  let selectedGenre = 'Melancholic';
  let selectedFolderName = 'All Songs';
  let playlists = [];
  let isSelectMode = false;
  let selectedTrackIds = new Set();
  let modalPendingTrackIds = [];
  let playlistContextMenuTargetId = null;
  let artistContextMenuTargetName = null;
  let albumContextMenuTargetName = null;
  let searchQuery = '';
  let isSearchHistoryActive = false;
  let currentTheme = localStorage.getItem('musico-theme') || 'dark';

  // Song Full View State
  let isSongFullViewOpen = false;
  let fullViewAutoHideTimer = null;
  let fullViewLyricColorMode = localStorage.getItem('musico-fullview-lyric-mode') || 'light';
  let lastFullViewLyricIndex = -1;
  let lastFullViewTrackId = null;
  let isFullViewControlsVisible = true;

  // =========================================================================
  // FAVOURITES PERSISTENCE HELPERS
  // =========================================================================
  const FAVOURITES_STORAGE_KEY = 'musico_favourites';

  function getFavouriteTrackIds() {
    try {
      return JSON.parse(localStorage.getItem(FAVOURITES_STORAGE_KEY) || '[]');
    } catch (e) {
      return [];
    }
  }

  function isFavourite(trackId) {
    if (!trackId) return false;
    return getFavouriteTrackIds().includes(trackId);
  }

  function toggleFavourite(trackId) {
    if (!trackId) return false;
    let favs = getFavouriteTrackIds();
    const exists = favs.includes(trackId);
    if (exists) {
      favs = favs.filter(id => id !== trackId);
    } else {
      favs.push(trackId);
    }
    try {
      localStorage.setItem(FAVOURITES_STORAGE_KEY, JSON.stringify(favs));
    } catch (e) {}
    
    updateMiniPlayerFavUI();
    if (typeof updateAlbumDetailFavSongs === 'function' && currentView === 'album_detail' && selectedAlbumName) {
      updateAlbumDetailFavSongs(selectedAlbumName);
    }
    return !exists;
  }

  function updateMiniPlayerFavUI() {
    const favBtn = document.getElementById('artistMiniFavBtn');
    if (!favBtn) return;
    const isFav = player.currentTrack && isFavourite(player.currentTrack.id);
    favBtn.classList.toggle('active', Boolean(isFav));
  }

  // =========================================================================
  // 100% OFFLINE 2-LEVEL GENRE CLASSIFICATION ENGINE
  // =========================================================================
  const MUSICO_GENRES = ['Melancholic', 'Sad', 'Chill', 'Dreamy', 'Romantic', 'Heartbreak', 'Nostalgic', 'Energetic'];

  const GENRE_KEYWORD_MAP = {
    'melancholic': ['melanchol', 'blues', 'dark', 'gloomy', 'somber', 'sadness', 'depress', 'moody', 'rain', 'acoustic'],
    'sad': ['sad', 'slow', 'sorrow', 'crying', 'cry', 'alone', 'broken', 'grief', 'pain', 'tear'],
    'chill': ['chill', 'lo-fi', 'lofi', 'ambient', 'lounge', 'relax', 'easy', 'peaceful', 'calm', 'downtempo', 'soft', 'jazz'],
    'dreamy': ['dream', 'shoegaze', 'ethereal', 'synth', 'psychedelic', 'space', 'cloud', 'float', 'atmospheric', 'chillwave'],
    'romantic': ['romantic', 'romance', 'love', 'ballad', 'soul', 'r&b', 'rnb', 'passion', 'kiss', 'valentine', 'sweet'],
    'heartbreak': ['heartbreak', 'breakup', 'heart', 'hurts', 'lost', 'lonely', 'goodbye', 'miss', 'betray'],
    'nostalgic': ['nostalgic', 'nostalgia', 'retro', '80s', '90s', 'vintage', 'classic', 'memories', 'oldies', 'folk', 'country', 'indie'],
    'energetic': ['energetic', 'energy', 'rock', 'pop', 'dance', 'edm', 'electro', 'hip hop', 'hip-hop', 'rap', 'metal', 'workout', 'fast', 'upbeat', 'party']
  };

  function classifyTrackGenre(track) {
    if (!track) return 'Melancholic';
    try {
      const cache = JSON.parse(localStorage.getItem('musico_genre_cache') || '{}');
      if (cache[track.id]) {
        return cache[track.id];
      }
    } catch (e) {}

    let matchedGenre = null;
    const rawMeta = `${track.genre || ''} ${track.tag || ''} ${track.title || ''} ${track.album || ''} ${track.artist || ''}`.toLowerCase();
    
    for (const [genreKey, keywords] of Object.entries(GENRE_KEYWORD_MAP)) {
      if (keywords.some(kw => rawMeta.includes(kw))) {
        matchedGenre = MUSICO_GENRES.find(g => g.toLowerCase() === genreKey);
        break;
      }
    }

    if (!matchedGenre) {
      const seedStr = `${track.id || ''}_${track.title || ''}_${track.duration || 0}_${track.artist || ''}`;
      let hash = 0;
      for (let i = 0; i < seedStr.length; i++) {
        hash = ((hash << 5) - hash) + seedStr.charCodeAt(i);
        hash |= 0;
      }
      const idx = Math.abs(hash) % MUSICO_GENRES.length;
      matchedGenre = MUSICO_GENRES[idx];
    }

    try {
      const cache = JSON.parse(localStorage.getItem('musico_genre_cache') || '{}');
      cache[track.id] = matchedGenre;
      localStorage.setItem('musico_genre_cache', JSON.stringify(cache));
    } catch (e) {}

    return matchedGenre;
  }

  // Clear any residual search history state from previous reloads
  if (window.history && window.history.state && window.history.state.isSearch) {
    try {
      window.history.replaceState(null, '');
    } catch (e) {}
  }

  function enterSearchHistory() {
    if (!isSearchHistoryActive) {
      try {
        window.history.pushState({ isSearch: true }, '');
        isSearchHistoryActive = true;
      } catch (e) {}
    }
  }

  function exitSearchToAllSongs() {
    searchQuery = '';
    if (searchInput) searchInput.value = '';
    if (searchOverlay) searchOverlay.classList.remove('open');
    isSearchHistoryActive = false;
    if (window.history && window.history.state && window.history.state.isSearch) {
      try {
        window.history.replaceState(null, '');
      } catch (e) {}
    }
    setAllFilter();
  }

  // DOM Elements
  const songsListContainer = document.getElementById('songsListContainer');
  const pcLyricsContainer = document.getElementById('pcLyricsContainer');
  let currentPcMode = 1; // 1: All Songs, 2: Lyrics, 3: Column/Grid, 4: Up Next/Queue
  const addFolderBtn = document.getElementById('addFolderBtn');
  const searchBtn = document.getElementById('searchBtn');
  const searchOverlay = document.getElementById('searchOverlay');
  const searchInput = document.getElementById('searchInput');
  const closeSearchBtn = document.getElementById('closeSearchBtn');
  const settingsBtn = document.getElementById('settingsBtn');
  const settingsModal = document.getElementById('settingsModal');
  const closeSettingsBtn = document.getElementById('closeSettingsBtn');
  const playPauseBtn = document.getElementById('playPauseBtn');
  const prevBtn = document.getElementById('prevBtn');
  const nextBtn = document.getElementById('nextBtn');
  const filterAllBtn = document.getElementById('filterAllBtn');
  const filterColumnBtn = document.getElementById('filterColumnBtn');
  const filterShuffleBtn = document.getElementById('filterShuffleBtn');
  const topSliderTrack = document.getElementById('topSliderTrack');
  const topSliderThumb = document.getElementById('topSliderThumb');
  const progressPill = document.getElementById('progressPill');
  const progressBarContainer = document.getElementById('progressBarContainer');
  const viewSelectorPill = document.getElementById('viewSelectorPill');
  const viewDropdownMenu = document.getElementById('viewDropdownMenu');
  const contextMenu = document.getElementById('songContextMenu');
  const toastMessage = document.getElementById('toastMessage');

  /**
   * Synchronize the view selector label across all headers (desktop player & home)
   */
  function updateViewSelectorLabel(labelText) {
    const mainLabel = document.getElementById('viewSelectorLabel');
    if (mainLabel) mainLabel.textContent = labelText;
    const homeLabel = document.getElementById('homeViewSelectorLabel');
    if (homeLabel) homeLabel.textContent = labelText;
  }

  // Loading Progress Popup Elements
  const loadingProgressPopup = document.getElementById('loadingProgressPopup');
  const loadingProgressCount = document.getElementById('loadingProgressCount');
  const loadingProgressBarFill = document.getElementById('loadingProgressBarFill');

  /**
   * Display and update the Loading Progress Popup
   * Communicates actual progress with remaining count and percentage fill
   */
  function showLoadingProgress(remaining, percent) {
    if (!loadingProgressPopup) return;
    loadingProgressPopup.classList.add('visible');
    if (loadingProgressCount) {
      loadingProgressCount.textContent = `${remaining} song${remaining === 1 ? '' : 's'} remaining`;
    }
    if (loadingProgressBarFill) {
      loadingProgressBarFill.style.width = `${Math.min(100, Math.max(0, percent))}%`;
    }
  }

  /**
   * Automatically hide Loading Progress Popup after completion
   */
  function hideLoadingProgress() {
    if (!loadingProgressPopup) return;
    if (loadingProgressBarFill) {
      loadingProgressBarFill.style.width = '100%';
    }
    if (loadingProgressCount) {
      loadingProgressCount.textContent = '0 songs remaining';
    }
    setTimeout(() => {
      loadingProgressPopup.classList.remove('visible');
      setTimeout(() => {
        if (loadingProgressBarFill) loadingProgressBarFill.style.width = '0%';
      }, 300);
    }, 450);
  }

  /**
   * High-speed in-place DOM metadata updater for large libraries
   * Updates song cards directly without re-rendering or resetting scroll position
   */
  function updateVisibleSongCardMetadata(updatedTracks) {
    if (!songsListContainer || !updatedTracks || updatedTracks.length === 0) return;
    for (let i = 0; i < updatedTracks.length; i++) {
      const track = updatedTracks[i];
      const card = songsListContainer.querySelector(`.song-card[data-id="${track.id}"]`);
      if (card) {
        const titleElem = card.querySelector('.song-title');
        const artistElem = card.querySelector('.song-artist');
        const thumbElem = card.querySelector('.song-thumb');

        if (titleElem && track.title) titleElem.textContent = track.title;
        if (artistElem && track.artist) artistElem.textContent = `//${track.artist}`;
        if (thumbElem && track.hasEmbeddedCover && track.coverUrl) {
          thumbElem.src = track.coverUrl;
          thumbElem.classList.remove('fallback-logo');
        }
      }
    }
  }

  // Initialize Library from IndexedDB
  async function initLibrary() {
    playlists = await fileManager.getPlaylists();
    const savedTracks = await fileManager.loadStoredTracks();
    if (savedTracks && savedTracks.length > 0) {
      allTracks = [...savedTracks];
      FileManager.sortTracks(allTracks);
      renderSongList();

      // Restore last played song if it exists in the library, otherwise default to first song
      const lastPlayedId = localStorage.getItem('musico-last-played-id');
      let targetIndex = 0;
      if (lastPlayedId) {
        const foundIdx = allTracks.findIndex(t => t.id === lastPlayedId);
        if (foundIdx !== -1) {
          targetIndex = foundIdx;
        }
      }
      player.setQueue(allTracks, targetIndex, false);
    } else {
      allTracks = [];
      renderSongList();
      player.setQueue([], 0, false);
    }
  }

  // Generate Song Card HTML
  function generateSongCardHTML(track, idx, isInsidePlaylist = false) {
    const isCurrent = player.currentTrack && player.currentTrack.id === track.id;
    const isPlaying = isCurrent && player.isPlaying;
    const isSelected = selectedTrackIds.has(track.id);
    const isFallback = !track.coverUrl || 
                       track.coverUrl.includes('atsuko-no-cover-image') ||
                       track.coverUrl.includes('Atsuko - NoCoverImg') ||
                       track.coverUrl.includes('atsuko') ||
                       track.coverUrl.includes('M logo') ||
                       track.coverUrl.includes('MlogoforMusicItems') ||
                       track.coverUrl.includes('Mlogo.png') || 
                       track.coverUrl.includes('Group 4') || 
                       track.coverUrl.trim() === '';
    const coverSrc = isFallback ? 'assets/atsuko-no-cover-image.svg' : track.coverUrl;

    return `
      <div class="song-card ${isCurrent ? 'active' : ''} ${isPlaying ? 'playing' : ''} ${isSelected ? 'selected' : ''}" data-id="${track.id}" data-index="${idx}" ${isInsidePlaylist ? 'data-playlist-song="true"' : ''}>
        <div class="song-checkbox-wrapper">
          <div class="song-checkbox"></div>
        </div>
        <div class="song-card-left">
          <div class="song-thumb-wrapper">
            <img src="${coverSrc}" alt="${escapeHtml(track.title)}" class="song-thumb ${isFallback ? 'fallback-logo' : ''}" loading="lazy" onerror="this.onerror=null;this.src='assets/atsuko-no-cover-image.svg';this.className='song-thumb fallback-logo';" />
          </div>
          <div class="song-info">
            <span class="song-title">${escapeHtml(track.title)}</span>
            <span class="song-artist">//${escapeHtml(track.artist || 'Unknown')}</span>
          </div>
        </div>
        <button class="song-options-btn" data-id="${track.id}" ${isInsidePlaylist ? 'data-in-playlist="true"' : ''} aria-label="Song options" title="Options">
          <img src="${currentTheme === 'dark' ? 'assets/Dark Mode/DarkModeOptionsbtn.svg' : 'assets/OptionsThreeDots.svg'}" alt="Options" class="options-icon" />
        </button>
      </div>
    `;
  }

  // Generate Playlist Card HTML (No cover images in list, matching reference design)
  function generatePlaylistCardHTML(playlist) {
    const trackCount = playlist.trackIds ? playlist.trackIds.length : 0;
    const countText = trackCount === 1 ? '1 Song' : `${trackCount} Songs`;
    return `
      <div class="playlist-card" data-playlist-id="${playlist.id}">
        <div class="playlist-card-left">
          <span class="playlist-card-title">${escapeHtml(playlist.name)}</span>
          <span class="playlist-card-count">//${countText}</span>
        </div>
        <button class="playlist-options-btn" data-playlist-id="${playlist.id}" aria-label="Playlist options" title="Options">
          <img src="${currentTheme === 'dark' ? 'assets/Dark Mode/DarkModeOptionsbtn.svg' : 'assets/OptionsThreeDots.svg'}" alt="Options" class="options-icon" />
        </button>
      </div>
    `;
  }

  // Render song cards in right panel (High-Performance Windowed Virtualization for 1,000–5,000+ songs)
  function renderSongList() {
    if (!songsListContainer) return;

    if (window.innerWidth > 900) {
      if (currentPcMode === 2) {
        if (pcLyricsContainer) pcLyricsContainer.style.display = 'flex';
        songsListContainer.style.display = 'none';
        songsListContainer.className = 'songs-list';
        renderPcLyricsView();
        return;
      }
      if (currentPcMode === 3) {
        if (pcLyricsContainer) pcLyricsContainer.style.display = 'none';
        songsListContainer.style.display = 'flex';
        renderPcMasonryGridView();
        return;
      }
      if (currentPcMode === 4) {
        if (pcLyricsContainer) pcLyricsContainer.style.display = 'none';
        songsListContainer.className = 'songs-list';
        songsListContainer.style.display = 'flex';
        renderPcQueueView();
        return;
      }
    }

    if (pcLyricsContainer) pcLyricsContainer.style.display = 'none';
    songsListContainer.style.display = 'flex';

    let filtered = allTracks;

    // Apply search filter if query is present
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      filtered = filtered.filter(t => 
        t.title.toLowerCase().includes(q) || 
        (t.artist && t.artist.toLowerCase().includes(q)) ||
        (t.album && t.album.toLowerCase().includes(q))
      );
    }

    // When there are no songs or no folder selected -> Show 'No Songs' empty state
    if (filtered.length === 0) {
      songsListContainer.className = 'songs-list empty-container';
      songsListContainer.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">
            <img src="assets/ADD button with no BG.png" alt="Add Music" class="empty-state-img" />
          </div>
          <h3 class="empty-title">No Songs</h3>
          <p class="empty-subtitle">Click <strong>+</strong> or the button below to select a music folder from your computer.</p>
          <button class="empty-add-btn" id="emptyAddBtn">+ Select Music Folder</button>
        </div>
      `;
      const emptyAdd = document.getElementById('emptyAddBtn');
      if (emptyAdd) emptyAdd.onclick = handleAddMusic;
      return;
    }

    songsListContainer.className = isGridView ? 'songs-list grid-view' : 'songs-list';
    if (isSelectMode) songsListContainer.classList.add('select-mode');

    const isMobile = window.innerWidth <= 900;
    const rowHeight = isMobile ? 60 : 64;
    const VIRTUAL_THRESHOLD = 50;

    if (isGridView || filtered.length <= VIRTUAL_THRESHOLD) {
      songsListContainer.innerHTML = filtered.map((track, idx) => generateSongCardHTML(track, idx)).join('');
    } else {
      // List Virtualization: only renders cards in viewport + buffer
      const scrollTop = songsListContainer.scrollTop || 0;
      const viewportHeight = songsListContainer.clientHeight || 600;
      const visibleCount = Math.ceil(viewportHeight / rowHeight);
      const buffer = 15;

      const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - buffer);
      const endIndex = Math.min(filtered.length, startIndex + visibleCount + buffer * 2);

      const topHeight = startIndex * rowHeight;
      const bottomHeight = Math.max(0, (filtered.length - endIndex) * rowHeight);

      const visibleCards = [];
      for (let i = startIndex; i < endIndex; i++) {
        visibleCards.push(generateSongCardHTML(filtered[i], i));
      }

      songsListContainer.innerHTML = `
        <div style="height:${topHeight}px; width:100%; flex-shrink:0; pointer-events:none;"></div>
        ${visibleCards.join('')}
        <div style="height:${bottomHeight}px; width:100%; flex-shrink:0; pointer-events:none;"></div>
      `;
    }

    // Update custom mobile scrollbar position
    requestAnimationFrame(() => {
      updateMobileScrollbarThumb();
      if (typeof updateAlphabetScrollIndicator === 'function') {
        updateAlphabetScrollIndicator(false);
      }
    });
  }

  // =========================================================================
  // PC 4-MODE VIEW CONTROLLER & RENDERERS (DESKTOP VIEW ONLY)
  // =========================================================================

  // Mode 2: PC Lyrics View
  function renderPcLyricsView() {
    if (!pcLyricsContainer) return;

    if (!player.currentTrack) {
      pcLyricsContainer.innerHTML = `
        <div class="lyrics-offline-fallback">
          <div class="lyrics-offline-title">No Song Playing</div>
          <div class="lyrics-offline-artist">//Select a song to view lyrics</div>
        </div>
      `;
      return;
    }

    const track = player.currentTrack;
    let lyricsText = track.lyrics ? track.lyrics.trim() : '';

    if (!lyricsText) {
      if (track.fileBlob && !track._lyricsChecked) {
        track._lyricsChecked = true;
        ID3Parser.parse(track.fileBlob).then(meta => {
          if (meta && meta.lyrics && meta.lyrics.trim()) {
            track.lyrics = meta.lyrics.trim();
            if (fileManager) fileManager.saveTrackToDB(track);
            if (player.currentTrack && player.currentTrack.id === track.id && currentPcMode === 2) {
              renderPcLyricsView();
            }
          }
        }).catch(() => {});
      }

      pcLyricsContainer.innerHTML = `
        <div class="lyrics-offline-fallback">
          <div class="lyrics-offline-title">${escapeHtml(track.title)}</div>
          <div class="lyrics-offline-artist">//${escapeHtml(track.artist || 'Unknown Artist')}</div>
          <div class="lyrics-offline-badge">Offline Lyrics Not Available</div>
          <p class="lyrics-offline-sub">Embedded lyrics (USLT/ID3, FLAC, M4A) will automatically be displayed here when found in your local audio files.</p>
        </div>
      `;
      return;
    }

    // Split lyrics by line and format
    const rawLines = lyricsText.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
    const parsedLines = [];
    let isSynced = false;

    for (let i = 0; i < rawLines.length; i++) {
      const line = rawLines[i];
      const match = line.match(/^\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\](.*)$/);
      if (match) {
        isSynced = true;
        const mins = parseInt(match[1], 10);
        const secs = parseInt(match[2], 10);
        const ms = match[3] ? parseInt(match[3].padEnd(3, '0').slice(0, 3), 10) : 0;
        const totalSecs = mins * 60 + secs + ms / 1000;
        const text = match[4].trim();
        if (text) {
          parsedLines.push({ time: totalSecs, text });
        }
      } else {
        const clean = line.replace(/^\[.*?\]\s*/g, '').trim();
        if (clean) {
          parsedLines.push({ time: -1, text: clean });
        }
      }
    }

    if (parsedLines.length === 0) {
      pcLyricsContainer.innerHTML = `
        <div class="lyrics-offline-fallback">
          <div class="lyrics-offline-title">${escapeHtml(track.title)}</div>
          <div class="lyrics-offline-artist">//${escapeHtml(track.artist || 'Unknown Artist')}</div>
          <div class="lyrics-offline-badge">Offline Lyrics Not Available</div>
        </div>
      `;
      return;
    }

    const linesHTML = parsedLines.map((item, idx) => {
      const timeAttr = item.time >= 0 ? `data-time="${item.time}"` : '';
      return `<div class="lyrics-line" id="lyricsLine_${idx}" ${timeAttr}>${escapeHtml(item.text)}</div>`;
    }).join('');

    pcLyricsContainer.innerHTML = `
      <div class="pc-lyrics-scroll-area" id="pcLyricsScrollArea">
        ${linesHTML}
      </div>
    `;

    if (isSynced) {
      syncPcLyricsHighlight();
    }
  }

  function syncPcLyricsHighlight() {
    if (currentPcMode !== 2 || !player.audio || !pcLyricsContainer) return;
    const curTime = player.audio.currentTime || 0;
    const timedLines = pcLyricsContainer.querySelectorAll('.lyrics-line[data-time]');
    if (!timedLines || timedLines.length === 0) return;

    let activeLine = null;
    timedLines.forEach(line => {
      const t = parseFloat(line.dataset.time);
      if (t <= curTime + 0.25) {
        activeLine = line;
      }
    });

    timedLines.forEach(line => {
      line.classList.toggle('highlight', line === activeLine);
    });

    if (activeLine) {
      const scrollArea = document.getElementById('pcLyricsScrollArea');
      if (scrollArea) {
        const top = activeLine.offsetTop - scrollArea.clientHeight / 2 + activeLine.clientHeight / 2;
        scrollArea.scrollTo({ top, behavior: 'smooth' });
      }
    }
  }

  // Mode 3: PC 3-Column Masonry Grid View
  function renderPcMasonryGridView() {
    if (!songsListContainer) return;
    songsListContainer.className = 'songs-list pc-masonry-grid';

    let filtered = allTracks;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      filtered = filtered.filter(t => 
        t.title.toLowerCase().includes(q) || 
        (t.artist && t.artist.toLowerCase().includes(q)) ||
        (t.album && t.album.toLowerCase().includes(q))
      );
    }

    if (filtered.length === 0) {
      songsListContainer.className = 'songs-list empty-container';
      songsListContainer.innerHTML = `
        <div class="empty-state">
          <h3 class="empty-title">No Songs</h3>
          <p class="empty-subtitle">Click <strong>+</strong> to select a music folder.</p>
        </div>
      `;
      return;
    }

    // Varied aspect ratio heights matching reference design (~2.5 cards visible per column)
    const aspectRatios = [
      '3 / 4',    // Track 0 (Col 1, Row 1): Portrait (~1.33x)
      '4 / 5',    // Track 1 (Col 2, Row 1): Medium-tall portrait (~1.25x)
      '16 / 10',  // Track 2 (Col 3, Row 1): Short landscape (~0.62x)
      '16 / 11',  // Track 3 (Col 1, Row 2): Short landscape (~0.69x)
      '1 / 1',    // Track 4 (Col 2, Row 2): Square (1.0x)
      '3 / 4.2',  // Track 5 (Col 3, Row 2): Tall portrait (~1.4x)
      '16 / 10',  // Track 6 (Col 1, Row 3): Short landscape (~0.62x)
      '4 / 5',    // Track 7 (Col 2, Row 3): Medium-tall portrait (~1.25x)
      '4 / 3.2',  // Track 8 (Col 3, Row 3): Medium landscape (~0.8x)
      '4 / 5',    // Track 9 (Col 1, Row 4): Medium-tall portrait (~1.25x)
      '16 / 11',  // Track 10 (Col 2, Row 4): Short landscape (~0.69x)
      '1 / 1'     // Track 11 (Col 3, Row 4): Square (1.0x)
    ];

    const columns = [[], [], []];

    filtered.forEach((track, idx) => {
      const isCurrent = player.currentTrack && player.currentTrack.id === track.id;
      const isFallback = !track.coverUrl || 
                         track.coverUrl.includes('atsuko-no-cover-image') ||
                         track.coverUrl.includes('Atsuko - NoCoverImg') ||
                         track.coverUrl.includes('atsuko') ||
                         track.coverUrl.includes('M logo') ||
                         track.coverUrl.includes('MlogoforMusicItems') ||
                         track.coverUrl.includes('Mlogo.png') || 
                         track.coverUrl.includes('Group 4') || 
                         track.coverUrl.trim() === '';
      const coverSrc = isFallback ? 'assets/atsuko-no-cover-image.svg' : track.coverUrl;
      const ratio = aspectRatios[idx % aspectRatios.length];

      const cardHTML = `
        <div class="masonry-card ${isCurrent ? 'is-current' : ''}" data-id="${track.id}" data-index="${idx}">
          <div class="masonry-cover-wrapper" style="aspect-ratio: ${ratio};">
            <img src="${coverSrc}" alt="${escapeHtml(track.title)}" class="masonry-cover-img" loading="lazy" onerror="this.onerror=null;this.src='assets/atsuko-no-cover-image.svg';" />
            <div class="masonry-playing-overlay">
              <div class="masonry-play-indicator">
                <svg width="42" height="42" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M7.05 8.28c0-1.78 1.93-2.9 3.47-2.01l7.85 4.53c1.54.89 1.54 3.13 0 4.02l-7.85 4.53c-1.54.89-3.47-.23-3.47-2.01V8.28z"/>
                </svg>
              </div>
            </div>
            <div class="masonry-bottom-pill">
              <span class="masonry-song-title">${escapeHtml(track.title)}</span>
              <button class="masonry-options-btn" data-id="${track.id}" title="Options" aria-label="Options">
                <img src="${currentTheme === 'dark' ? 'assets/Dark Mode/DarkModeOptionsbtn.svg' : 'assets/OptionsThreeDots.svg'}" alt="Options" />
              </button>
            </div>
          </div>
        </div>
      `;

      columns[idx % 3].push(cardHTML);
    });

    songsListContainer.innerHTML = columns.map(colCards => `
      <div class="pc-masonry-col">
        ${colCards.join('')}
      </div>
    `).join('');
  }

  // Dedicated Column View (PC View Only - 5-Column Unified Masonry Grid + Dedicated Mini Player - Image 1 & Image 2)
  let isColumnViewActive = false;

  function renderColumnView() {
    if (window.innerWidth <= 900) return;
    const unifiedScroll = document.getElementById('columnViewUnifiedScroll');
    const leftGrid = document.getElementById('columnViewLeftGrid');
    const rightGrid = document.getElementById('columnViewRightGrid');
    if (!unifiedScroll || !leftGrid || !rightGrid) return;

    isColumnViewActive = true;
    currentView = 'all_songs';

    // Update Player Body & Filter Buttons
    const playerBody = document.querySelector('.player-body');
    if (playerBody) {
      playerBody.classList.add('column-view-active');
    }

    if (filterColumnBtn) {
      filterColumnBtn.classList.add('active');
    }
    if (filterAllBtn) {
      filterAllBtn.classList.remove('active');
    }

    // Single bar indicator under Songs
    const libraryEq = document.querySelector('.library-equalizer-bars');
    if (libraryEq) libraryEq.style.display = 'none';

    const columnViewSingleBar = document.getElementById('columnViewSingleBar');
    if (columnViewSingleBar) columnViewSingleBar.style.display = 'flex';

    if (pcLyricsContainer) pcLyricsContainer.style.display = 'none';
    const exploreRightNav = document.getElementById('exploreRightNav');
    if (exploreRightNav) exploreRightNav.style.display = 'none';
    const expandedRight = document.getElementById('expandedPlayerRightSection');
    if (expandedRight) expandedRight.style.display = 'none';

    if (songsListContainer) songsListContainer.style.display = 'none';
    unifiedScroll.style.display = 'flex';

    let filtered = allTracks;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      filtered = filtered.filter(t => 
        t.title.toLowerCase().includes(q) || 
        (t.artist && t.artist.toLowerCase().includes(q)) ||
        (t.album && t.album.toLowerCase().includes(q))
      );
    }

    if (filtered.length === 0) {
      leftGrid.innerHTML = '';
      rightGrid.innerHTML = `
        <div class="empty-state" style="width: 100%; text-align: center; padding: 60px 0;">
          <h3 class="empty-title">No Songs</h3>
          <p class="empty-subtitle">Click <strong>+</strong> to select a music folder.</p>
        </div>
      `;
      if (window.updateColumnMiniPlayerVisibility) window.updateColumnMiniPlayerVisibility();
      return;
    }

    // Varied aspect ratio heights matching reference design (~2.5 cards visible per column)
    const aspectRatios = [
      '3 / 4',    // Portrait (~1.33x)
      '4 / 5',    // Medium-tall portrait (~1.25x)
      '16 / 10',  // Short landscape (~0.62x)
      '16 / 11',  // Short landscape (~0.69x)
      '1 / 1',    // Square (1.0x)
      '3 / 4.2',  // Tall portrait (~1.4x)
      '16 / 10',  // Short landscape (~0.62x)
      '4 / 5',    // Medium-tall portrait (~1.25x)
      '4 / 3.2',  // Medium landscape (~0.8x)
      '4 / 5',    // Medium-tall portrait (~1.25x)
      '16 / 11',  // Short landscape (~0.69x)
      '1 / 1'     // Square (1.0x)
    ];

    const columns = [[], [], [], [], []];

    filtered.forEach((track, idx) => {
      const isCurrent = player.currentTrack && player.currentTrack.id === track.id;
      const isFallback = !track.coverUrl || 
                         track.coverUrl.includes('atsuko-no-cover-image') ||
                         track.coverUrl.includes('Atsuko - NoCoverImg') ||
                         track.coverUrl.includes('atsuko') ||
                         track.coverUrl.includes('M logo') ||
                         track.coverUrl.includes('MlogoforMusicItems') ||
                         track.coverUrl.includes('Mlogo.png') || 
                         track.coverUrl.includes('Group 4') || 
                         track.coverUrl.trim() === '';
      const coverSrc = isFallback ? 'assets/atsuko-no-cover-image.svg' : track.coverUrl;
      const ratio = aspectRatios[idx % aspectRatios.length];

      const cardHTML = `
        <div class="masonry-card ${isCurrent ? 'is-current' : ''}" data-id="${track.id}" data-index="${idx}">
          <div class="masonry-cover-wrapper" style="aspect-ratio: ${ratio};">
            <img src="${coverSrc}" alt="${escapeHtml(track.title)}" class="masonry-cover-img" loading="lazy" onerror="this.onerror=null;this.src='assets/atsuko-no-cover-image.svg';" />
            <div class="masonry-playing-overlay">
              <div class="masonry-play-indicator">
                <svg width="42" height="42" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M7.05 8.28c0-1.78 1.93-2.9 3.47-2.01l7.85 4.53c1.54.89 1.54 3.13 0 4.02l-7.85 4.53c-1.54.89-3.47-.23-3.47-2.01V8.28z"/>
                </svg>
              </div>
            </div>
            <div class="masonry-bottom-pill">
              <span class="masonry-song-title">${escapeHtml(track.title)}</span>
              <button class="masonry-options-btn" data-id="${track.id}" title="Options" aria-label="Options">
                <img src="${currentTheme === 'dark' ? 'assets/Dark Mode/DarkModeOptionsbtn.svg' : 'assets/OptionsThreeDots.svg'}" alt="Options" />
              </button>
            </div>
          </div>
        </div>
      `;

      columns[idx % 5].push(cardHTML);
    });

    // Populate Left 2 Columns
    leftGrid.innerHTML = `
      <div class="pc-masonry-col">
        ${columns[0].join('')}
      </div>
      <div class="pc-masonry-col">
        ${columns[1].join('')}
      </div>
    `;

    // Populate Right 3 Columns
    rightGrid.innerHTML = `
      <div class="pc-masonry-col">
        ${columns[2].join('')}
      </div>
      <div class="pc-masonry-col">
        ${columns[3].join('')}
      </div>
      <div class="pc-masonry-col">
        ${columns[4].join('')}
      </div>
    `;

    // Attach card click handlers for the unified grid
    unifiedScroll.querySelectorAll('.masonry-card').forEach(card => {
      card.addEventListener('click', (e) => {
        const optBtn = e.target.closest('.masonry-options-btn');
        if (optBtn) {
          e.stopPropagation();
          const trackId = optBtn.dataset.id;
          showContextMenu(e, trackId);
          return;
        }
        const trackId = card.dataset.id;
        const targetTrackIndex = allTracks.findIndex(t => t.id === trackId);
        if (targetTrackIndex !== -1) {
          if (player.currentTrack && player.currentTrack.id === trackId) {
            player.togglePlay();
          } else {
            player.activePlaylistId = null;
            player.activePlaylistName = null;
            player.setQueue(allTracks, targetTrackIndex, true);
            player.updateNowPlayingUI();
          }
        }
      });
    });

    updateSliderThumbFromSongListScroll();

    if (window.updateColumnMiniPlayerVisibility) {
      window.updateColumnMiniPlayerVisibility();
    }
  }

  function exitColumnView() {
    isColumnViewActive = false;

    const playerBody = document.querySelector('.player-body');
    if (playerBody) {
      playerBody.classList.remove('column-view-active');
    }

    const unifiedScroll = document.getElementById('columnViewUnifiedScroll');
    if (unifiedScroll) unifiedScroll.style.display = 'none';

    const columnViewSingleBar = document.getElementById('columnViewSingleBar');
    if (columnViewSingleBar) columnViewSingleBar.style.display = 'none';

    const columnMiniPlayer = document.getElementById('columnMiniPlayer');
    if (columnMiniPlayer) columnMiniPlayer.style.display = 'none';

    if (filterColumnBtn) {
      filterColumnBtn.classList.remove('active');
    }

    const libraryEq = document.querySelector('.library-equalizer-bars');
    if (libraryEq && currentView === 'all_songs') {
      libraryEq.style.display = 'flex';
    }

    if (currentView === 'all_songs') {
      if (songsListContainer) songsListContainer.style.display = 'flex';
      if (filterAllBtn) filterAllBtn.classList.add('active');
      if (currentPcMode === 3) {
        renderPcMasonryGridView();
      } else if (currentPcMode === 2) {
        renderPcLyricsView();
      } else if (currentPcMode === 4) {
        renderPcQueueView();
      } else {
        songsListContainer.className = 'songs-list';
        renderSongList();
      }
    }
  }

  // Mode 4: PC Up Next / Queue View
  function renderPcQueueView() {
    if (!songsListContainer) return;
    songsListContainer.className = 'songs-list';

    let upcoming = getUpcomingTracks();
    if (currentView === 'playlist_songs' && activePlaylistId) {
      const pl = playlists.find(p => p.id === activePlaylistId);
      const playlistTrackIds = new Set((pl?.trackIds) || []);
      if (player.activePlaylistId === activePlaylistId) {
        upcoming = upcoming.filter(t => playlistTrackIds.has(t.id));
      } else {
        upcoming = [];
      }
    }

    let contentHTML = `<div class="pc-queue-subheader">Up Next</div>`;

    if (upcoming.length === 0) {
      contentHTML += `<div class="pc-queue-empty">No upcoming songs in queue</div>`;
    } else {
      contentHTML += upcoming.map((track, idx) => generateSongCardHTML(track, idx, currentView === 'playlist_songs')).join('');
    }

    songsListContainer.innerHTML = contentHTML;
  }

  function updateArtistEqualizerBars() {
    const eqBar1 = document.getElementById('eqBar1');
    const eqBar2 = document.getElementById('eqBar2');
    const eqBar3 = document.getElementById('eqBar3');
    const eqBar4 = document.getElementById('eqBar4');

    if (eqBar1) {
      eqBar1.style.display = '';
      eqBar1.classList.toggle('active', currentArtistPcMode === 1);
      eqBar1.setAttribute('title', 'Artist List View (A/D)');
      eqBar1.setAttribute('aria-label', 'Artist List View');
    }
    if (eqBar2) {
      eqBar2.style.display = '';
      eqBar2.classList.toggle('active', currentArtistPcMode === 2);
      eqBar2.setAttribute('title', 'Artist Grid View (A/D)');
      eqBar2.setAttribute('aria-label', 'Artist Grid View');
    }
    if (eqBar3) eqBar3.style.display = 'none';
    if (eqBar4) eqBar4.style.display = 'none';
  }

  function updateArtistDetailEqualizerBars() {
    const eqBar1 = document.getElementById('eqBar1');
    const eqBar2 = document.getElementById('eqBar2');
    const eqBar3 = document.getElementById('eqBar3');
    const eqBar4 = document.getElementById('eqBar4');

    if (eqBar1) {
      eqBar1.style.display = '';
      eqBar1.classList.toggle('active', currentArtistDetailMode === 1);
      eqBar1.setAttribute('title', 'Artist About / Default View (A/D)');
      eqBar1.setAttribute('aria-label', 'Artist About');
    }
    if (eqBar2) {
      eqBar2.style.display = '';
      eqBar2.classList.toggle('active', currentArtistDetailMode === 2);
      eqBar2.setAttribute('title', 'Lyrics View (A/D)');
      eqBar2.setAttribute('aria-label', 'Lyrics');
    }
    if (eqBar3) {
      eqBar3.style.display = '';
      eqBar3.classList.toggle('active', currentArtistDetailMode === 3);
      eqBar3.setAttribute('title', 'Top Songs Grid View (A/D)');
      eqBar3.setAttribute('aria-label', 'Top Songs Grid');
    }
    if (eqBar4) {
      eqBar4.style.display = '';
      eqBar4.classList.toggle('active', currentArtistDetailMode === 4);
      eqBar4.setAttribute('title', 'Up Next View (A/D)');
      eqBar4.setAttribute('aria-label', 'Up Next');
    }
  }

  function updateAlbumsEqualizerBars() {
    const eqBar1 = document.getElementById('eqBar1');
    const eqBar2 = document.getElementById('eqBar2');
    const eqBar3 = document.getElementById('eqBar3');
    const eqBar4 = document.getElementById('eqBar4');

    if (eqBar1) {
      eqBar1.style.display = '';
      eqBar1.classList.toggle('active', currentAlbumsPcMode === 1);
      eqBar1.setAttribute('title', 'Albums List View (A/D)');
      eqBar1.setAttribute('aria-label', 'Albums List View');
    }
    if (eqBar2) {
      eqBar2.style.display = '';
      eqBar2.classList.toggle('active', currentAlbumsPcMode === 2);
      eqBar2.setAttribute('title', 'Albums Grid View (A/D)');
      eqBar2.setAttribute('aria-label', 'Albums Grid View');
    }
    if (eqBar3) eqBar3.style.display = 'none';
    if (eqBar4) eqBar4.style.display = 'none';
  }

  function updateAlbumDetailEqualizerBars() {
    const eqBar1 = document.getElementById('eqBar1');
    const eqBar2 = document.getElementById('eqBar2');
    const eqBar3 = document.getElementById('eqBar3');
    const eqBar4 = document.getElementById('eqBar4');

    if (eqBar1) {
      eqBar1.style.display = '';
      eqBar1.classList.toggle('active', currentAlbumDetailMode === 1);
      eqBar1.setAttribute('title', 'Album Songs List (A/D)');
      eqBar1.setAttribute('aria-label', 'Album Songs List');
    }
    if (eqBar2) {
      eqBar2.style.display = '';
      eqBar2.classList.toggle('active', currentAlbumDetailMode === 2);
      eqBar2.setAttribute('title', 'Lyrics View (A/D)');
      eqBar2.setAttribute('aria-label', 'Lyrics');
    }
    if (eqBar3) {
      eqBar3.style.display = '';
      eqBar3.classList.toggle('active', currentAlbumDetailMode === 3);
      eqBar3.setAttribute('title', 'Album Songs Grid (A/D)');
      eqBar3.setAttribute('aria-label', 'Album Songs Grid');
    }
    if (eqBar4) {
      eqBar4.style.display = '';
      eqBar4.classList.toggle('active', currentAlbumDetailMode === 4);
      eqBar4.setAttribute('title', 'Up Next View (A/D)');
      eqBar4.setAttribute('aria-label', 'Up Next');
    }
  }

  function updateFavouritesEqualizerBars() {
    const eqBar1 = document.getElementById('eqBar1');
    const eqBar2 = document.getElementById('eqBar2');
    const eqBar3 = document.getElementById('eqBar3');
    const eqBar4 = document.getElementById('eqBar4');

    if (eqBar1) {
      eqBar1.style.display = '';
      eqBar1.classList.toggle('active', currentFavouritesMode === 1);
      eqBar1.setAttribute('title', 'Favourites List (A/D)');
      eqBar1.setAttribute('aria-label', 'Favourites List');
    }
    if (eqBar2) {
      eqBar2.style.display = '';
      eqBar2.classList.toggle('active', currentFavouritesMode === 2);
      eqBar2.setAttribute('title', 'Lyrics View (A/D)');
      eqBar2.setAttribute('aria-label', 'Lyrics');
    }
    if (eqBar3) {
      eqBar3.style.display = '';
      eqBar3.classList.toggle('active', currentFavouritesMode === 3);
      eqBar3.setAttribute('title', 'Favourites Grid (A/D)');
      eqBar3.setAttribute('aria-label', 'Favourites Grid');
    }
    if (eqBar4) {
      eqBar4.style.display = '';
      eqBar4.classList.toggle('active', currentFavouritesMode === 4);
      eqBar4.setAttribute('title', 'Up Next View (A/D)');
      eqBar4.setAttribute('aria-label', 'Up Next');
    }
  }

  function updatePlaylistSongsEqualizerBars() {
    const eqBar1 = document.getElementById('eqBar1');
    const eqBar2 = document.getElementById('eqBar2');
    const eqBar3 = document.getElementById('eqBar3');
    const eqBar4 = document.getElementById('eqBar4');

    if (eqBar1) {
      eqBar1.style.display = '';
      eqBar1.classList.toggle('active', currentPlaylistSongsMode === 1);
      eqBar1.setAttribute('title', 'Playlist Songs List (A/D)');
      eqBar1.setAttribute('aria-label', 'Playlist Songs List');
    }
    if (eqBar2) {
      eqBar2.style.display = '';
      eqBar2.classList.toggle('active', currentPlaylistSongsMode === 2);
      eqBar2.setAttribute('title', 'Lyrics View (A/D)');
      eqBar2.setAttribute('aria-label', 'Lyrics');
    }
    if (eqBar3) {
      eqBar3.style.display = '';
      eqBar3.classList.toggle('active', currentPlaylistSongsMode === 3);
      eqBar3.setAttribute('title', 'Playlist Songs Grid (A/D)');
      eqBar3.setAttribute('aria-label', 'Playlist Songs Grid');
    }
    if (eqBar4) {
      eqBar4.style.display = '';
      eqBar4.classList.toggle('active', currentPlaylistSongsMode === 4);
      eqBar4.setAttribute('title', 'Up Next View (A/D)');
      eqBar4.setAttribute('aria-label', 'Up Next');
    }
  }

  function updateGenreEqualizerBars() {
    const eqBar1 = document.getElementById('eqBar1');
    const eqBar2 = document.getElementById('eqBar2');
    const eqBar3 = document.getElementById('eqBar3');
    const eqBar4 = document.getElementById('eqBar4');

    if (eqBar1) {
      eqBar1.style.display = '';
      eqBar1.classList.toggle('active', currentGenreMode === 1);
      eqBar1.setAttribute('title', 'Genre Songs List (A/D)');
      eqBar1.setAttribute('aria-label', 'Genre Songs List');
    }
    if (eqBar2) {
      eqBar2.style.display = '';
      eqBar2.classList.toggle('active', currentGenreMode === 2);
      eqBar2.setAttribute('title', 'Lyrics View (A/D)');
      eqBar2.setAttribute('aria-label', 'Lyrics');
    }
    if (eqBar3) {
      eqBar3.style.display = '';
      eqBar3.classList.toggle('active', currentGenreMode === 3);
      eqBar3.setAttribute('title', 'Genre Songs Grid (A/D)');
      eqBar3.setAttribute('aria-label', 'Genre Songs Grid');
    }
    if (eqBar4) {
      eqBar4.style.display = '';
      eqBar4.classList.toggle('active', currentGenreMode === 4);
      eqBar4.setAttribute('title', 'Up Next View (A/D)');
      eqBar4.setAttribute('aria-label', 'Up Next');
    }
  }

  function updateFoldersEqualizerBars() {
    const eqBar1 = document.getElementById('eqBar1');
    const eqBar2 = document.getElementById('eqBar2');
    const eqBar3 = document.getElementById('eqBar3');
    const eqBar4 = document.getElementById('eqBar4');

    if (eqBar1) {
      eqBar1.style.display = '';
      eqBar1.classList.toggle('active', currentFoldersPcMode === 1);
      eqBar1.setAttribute('title', 'Folder Songs List (A/D)');
      eqBar1.setAttribute('aria-label', 'Folder Songs List');
    }
    if (eqBar2) {
      eqBar2.style.display = '';
      eqBar2.classList.toggle('active', currentFoldersPcMode === 2);
      eqBar2.setAttribute('title', 'Lyrics View (A/D)');
      eqBar2.setAttribute('aria-label', 'Lyrics');
    }
    if (eqBar3) {
      eqBar3.style.display = '';
      eqBar3.classList.toggle('active', currentFoldersPcMode === 3);
      eqBar3.setAttribute('title', 'Folder Songs Grid (A/D)');
      eqBar3.setAttribute('aria-label', 'Folder Songs Grid');
    }
    if (eqBar4) {
      eqBar4.style.display = '';
      eqBar4.classList.toggle('active', currentFoldersPcMode === 4);
      eqBar4.setAttribute('title', 'Up Next View (A/D)');
      eqBar4.setAttribute('aria-label', 'Up Next');
    }
  }

  function switchArtistDetailMode(modeNum) {
    if (window.innerWidth <= 900) return;
    if (modeNum < 1) modeNum = 4;
    if (modeNum > 4) modeNum = 1;
    currentArtistDetailMode = modeNum;
    renderArtistDetailView(selectedArtistName);
  }

  function switchAlbumDetailMode(modeNum) {
    if (window.innerWidth <= 900) return;
    if (modeNum < 1) modeNum = 4;
    if (modeNum > 4) modeNum = 1;
    currentAlbumDetailMode = modeNum;
    renderAlbumDetailView(selectedAlbumName);
  }

  function switchFavouritesMode(modeNum) {
    if (window.innerWidth <= 900) return;
    if (modeNum < 1) modeNum = 4;
    if (modeNum > 4) modeNum = 1;
    currentFavouritesMode = modeNum;
    renderFavouritesView();
  }

  function switchPlaylistSongsMode(modeNum) {
    if (window.innerWidth <= 900) return;
    if (modeNum < 1) modeNum = 4;
    if (modeNum > 4) modeNum = 1;
    currentPlaylistSongsMode = modeNum;
    renderPlaylistSongsView(activePlaylistId);
  }

  function switchGenreMode(modeNum) {
    if (window.innerWidth <= 900) return;
    if (modeNum < 1) modeNum = 4;
    if (modeNum > 4) modeNum = 1;
    currentGenreMode = modeNum;
    renderGenreView(selectedGenre);
  }

  function switchFolderDetailMode(modeNum) {
    if (window.innerWidth <= 900) return;
    if (modeNum < 1) modeNum = 4;
    if (modeNum > 4) modeNum = 1;
    currentFoldersPcMode = modeNum;
    renderFolderDetailView(selectedFolderName);
  }

  function restoreAllSongsEqualizerBars() {
    const eqBar1 = document.getElementById('eqBar1');
    const eqBar2 = document.getElementById('eqBar2');
    const eqBar3 = document.getElementById('eqBar3');
    const eqBar4 = document.getElementById('eqBar4');

    if (eqBar1) {
      eqBar1.style.display = '';
      eqBar1.setAttribute('title', 'All Songs (A/D)');
      eqBar1.setAttribute('aria-label', 'All Songs View');
      eqBar1.classList.toggle('active', currentPcMode === 1);
    }
    if (eqBar2) {
      eqBar2.style.display = '';
      eqBar2.setAttribute('title', 'Lyrics View (A/D)');
      eqBar2.setAttribute('aria-label', 'Lyrics View');
      eqBar2.classList.toggle('active', currentPcMode === 2);
    }
    if (eqBar3) {
      eqBar3.style.display = '';
      eqBar3.setAttribute('title', 'Column / Grid View (A/D)');
      eqBar3.setAttribute('aria-label', 'Grid View');
      eqBar3.classList.toggle('active', currentPcMode === 3);
    }
    if (eqBar4) {
      eqBar4.style.display = '';
      eqBar4.setAttribute('title', 'Up Next / Queue View (A/D)');
      eqBar4.setAttribute('aria-label', 'Up Next View');
      eqBar4.classList.toggle('active', currentPcMode === 4);
    }
  }

  // =========================================================================
  // VIEW TRANSITION CONTROLLER & STATE CLEANUP
  // =========================================================================
  const PLAYER_BODY_VIEW_CLASSES = [
    'explore-view-active',
    'playlist-view-active',
    'playlist-songs-active',
    'artist-view-active',
    'artist-main-active',
    'albums-view-active',
    'albums-main-active',
    'favourites-view-active',
    'genre-view-active',
    'folders-view-active',
    'folders-main-active',
    'folder-detail-active',
    'recorder-view-active',
    'expanded-player-view-active',
    'column-view-active'
  ];

  const LEFT_SECTION_IDS = [
    'exploreLeftSection',
    'playlistLeftSection',
    'artistLeftSection',
    'albumsLeftSection',
    'favouritesLeftSection',
    'genreLeftSection',
    'foldersLeftSection',
    'recorderLeftSection',
    'expandedPlayerLeftSection'
  ];

  function hideHomePageContainer() {
    const homeContainer = document.getElementById('homePageContainer');
    if (homeContainer) homeContainer.style.display = 'none';
    const playerSection = document.querySelector('.player-section');
    const librarySection = document.querySelector('.library-section');
    if (playerSection) playerSection.style.display = '';
    if (librarySection) librarySection.style.display = '';
  }

  function prepareViewTransition(activeLeftSectionId = null, playerBodyClassesToAdd = []) {
    // 1. Restore normal layout if home was active
    hideHomePageContainer();

    // 2. Reset Column View if active
    if (isColumnViewActive && typeof exitColumnView === 'function') {
      exitColumnView();
    }

    // 3. Stop audio recording if navigating away from recorder
    if (isRecordingAudio && typeof stopAudioRecording === 'function') {
      stopAudioRecording();
    }

    // 4. Clean up expanded player right section if open
    const expandedPlayerRight = document.getElementById('expandedPlayerRightSection');
    if (expandedPlayerRight) expandedPlayerRight.style.display = 'none';
    const libraryHeader = document.querySelector('.library-header');
    if (libraryHeader) libraryHeader.style.display = 'flex';

    // 5. Clean up ALL view classes on playerBody and add only current view classes
    const playerBody = document.querySelector('.player-body');
    if (playerBody) {
      PLAYER_BODY_VIEW_CLASSES.forEach(cls => playerBody.classList.remove(cls));
      playerBodyClassesToAdd.forEach(cls => playerBody.classList.add(cls));
    }

    // 6. Explicitly control left sections display
    LEFT_SECTION_IDS.forEach(id => {
      const elem = document.getElementById(id);
      if (!elem) return;
      if (activeLeftSectionId && id === activeLeftSectionId) {
        elem.style.display = 'flex';
      } else {
        elem.style.display = 'none';
      }
    });

    // 7. Ensure unified scroll and single bar controls from column view are hidden
    const columnViewUnifiedScroll = document.getElementById('columnViewUnifiedScroll');
    if (columnViewUnifiedScroll) columnViewUnifiedScroll.style.display = 'none';
    const columnViewSingleBar = document.getElementById('columnViewSingleBar');
    if (columnViewSingleBar) columnViewSingleBar.style.display = 'none';
    const columnMiniPlayer = document.getElementById('columnMiniPlayer');
    if (columnMiniPlayer) columnMiniPlayer.style.display = 'none';

    // 8. Trigger smooth refresh animation for player filter buttons
    triggerFilterButtonsRefreshAnimation();
  }

  /**
   * Triggers a smooth, unified refresh animation on the player filter buttons (All, Column / Add New, Shuffle / Now Playing)
   */
  function triggerFilterButtonsRefreshAnimation() {
    const row = document.querySelector('.player-section .filter-pills-row');
    if (!row) return;
    row.classList.remove('refreshing');
    requestAnimationFrame(() => {
      void row.offsetWidth;
      row.classList.add('refreshing');
    });
  }

  // Switch between 4 PC modes (All Songs) or isolated modes across library sections
  function switchPcMode(modeNum) {
    if (window.innerWidth <= 900) return; // Desktop PC view only

    if (isColumnViewActive) {
      exitColumnView();
    }

    // If currently inside Individual Artist view
    if (currentView === 'artist_detail') {
      switchArtistDetailMode(modeNum);
      return;
    }

    // If currently inside Artist section
    if (currentView === 'artist_main') {
      if (modeNum === 1 || modeNum === 2) {
        currentArtistPcMode = modeNum;
      } else {
        currentArtistPcMode = currentArtistPcMode === 1 ? 2 : 1;
      }
      renderArtistMainView();
      return;
    }

    // If currently inside Albums Main section
    if (currentView === 'albums_main') {
      if (modeNum === 1 || modeNum === 2) {
        currentAlbumsPcMode = modeNum;
      } else {
        currentAlbumsPcMode = currentAlbumsPcMode === 1 ? 2 : 1;
      }
      renderAlbumsMainView();
      return;
    }

    // If currently inside Individual Album view
    if (currentView === 'album_detail') {
      switchAlbumDetailMode(modeNum);
      return;
    }

    // If currently inside Favourites section
    if (currentView === 'favourites') {
      switchFavouritesMode(modeNum);
      return;
    }

    // If currently inside Genre section
    if (currentView === 'genre') {
      switchGenreMode(modeNum);
      return;
    }

    // If currently inside Folder Detail section
    if (currentView === 'folder_detail') {
      switchFolderDetailMode(modeNum);
      return;
    }

    // If currently inside Recorder section
    if (currentView === 'recorder') {
      if (modeNum === 1 || modeNum === 2) {
        currentRecorderPcMode = modeNum;
      } else {
        currentRecorderPcMode = currentRecorderPcMode === 1 ? 2 : 1;
      }
      renderRecorderView();
      return;
    }

    // Circular loop (1 <-> 2 <-> 3 <-> 4)
    if (modeNum < 1) modeNum = 4;
    if (modeNum > 4) modeNum = 1;

    currentPcMode = modeNum;

    // Reset all special views and left sections cleanly
    prepareViewTransition(null, []);

    const exploreRightNav = document.getElementById('exploreRightNav');
    if (exploreRightNav) exploreRightNav.style.display = 'none';
    currentView = 'all_songs';
    activePlaylistId = null;
    document.querySelectorAll('.menu-item-btn').forEach(b => b.classList.toggle('active', b.dataset.action === 'all-songs'));
    updateViewSelectorLabel('Home / All Songs');
    if (filterAllBtn) filterAllBtn.textContent = 'All';
    if (filterColumnBtn) {
      filterColumnBtn.style.display = '';
      filterColumnBtn.textContent = 'Column';
      filterColumnBtn.classList.remove('active');
    }
    if (filterShuffleBtn) filterShuffleBtn.textContent = 'Shuffle';

    // Restore 4 vertical bars for All Songs
    restoreAllSongsEqualizerBars();

    if (window.updateArtistMiniPlayerVisibility) {
      window.updateArtistMiniPlayerVisibility();
    }

    // 2. Update library header title (Lyrics when mode 2, Songs for others)
    const libraryHeading = document.querySelector('.library-heading');
    if (libraryHeading) {
      if (modeNum === 2) {
        libraryHeading.textContent = 'Lyrics';
      } else {
        libraryHeading.textContent = 'Songs';
      }
    }

    // 3. Switch visible views
    if (modeNum === 1) {
      if (pcLyricsContainer) pcLyricsContainer.style.display = 'none';
      if (songsListContainer) {
        songsListContainer.className = 'songs-list';
        songsListContainer.style.display = 'flex';
      }
      renderSongList();
    } else if (modeNum === 2) {
      if (songsListContainer) {
        songsListContainer.style.display = 'none';
        songsListContainer.className = 'songs-list';
      }
      if (pcLyricsContainer) {
        pcLyricsContainer.style.display = 'flex';
        renderPcLyricsView();
      }
    } else if (modeNum === 3) {
      if (pcLyricsContainer) pcLyricsContainer.style.display = 'none';
      if (songsListContainer) {
        songsListContainer.style.display = 'flex';
        renderPcMasonryGridView();
      }
    } else if (modeNum === 4) {
      if (pcLyricsContainer) pcLyricsContainer.style.display = 'none';
      if (songsListContainer) {
        songsListContainer.className = 'songs-list';
        songsListContainer.style.display = 'flex';
        renderPcQueueView();
      }
    }
  }

  // =========================================================================
  // PLAYLIST SYSTEM VIEW CONTROLLER (PC & MOBILE)
  // =========================================================================

  function getRandomCoverFromPlaylist(playlist) {
    if (!playlist || !playlist.trackIds || playlist.trackIds.length === 0) return 'assets/atsuko.svg';
    const randomTrackId = playlist.trackIds[Math.floor(Math.random() * playlist.trackIds.length)];
    const track = allTracks.find(t => t.id === randomTrackId);
    if (track && track.coverUrl && !track.coverUrl.includes('M logo for music items') && !track.coverUrl.includes('Group 4')) {
      return track.coverUrl;
    }
    return 'assets/atsuko.svg';
  }

  function renderPlaylistFeaturedCards() {
    const featuredCard1 = document.getElementById('featuredCard1');
    const featuredCard2 = document.getElementById('featuredCard2');
    const featuredImg1 = document.getElementById('featuredImg1');
    const featuredImg2 = document.getElementById('featuredImg2');
    const featuredTitle1 = document.getElementById('featuredTitle1');
    const featuredTitle2 = document.getElementById('featuredTitle2');
    const playlistCurrentTitle = document.getElementById('playlistCurrentTitle');

    // Update status title
    if (playlistCurrentTitle) {
      if (player.activePlaylistName) {
        playlistCurrentTitle.textContent = player.activePlaylistName;
      } else {
        playlistCurrentTitle.textContent = 'Playlists';
      }
    }

    if (!playlists || playlists.length === 0) {
      if (featuredTitle1) featuredTitle1.textContent = 'No Playlist';
      if (featuredTitle2) featuredTitle2.textContent = 'No Playlist';
      if (featuredImg1) featuredImg1.src = 'assets/atsuko.svg';
      if (featuredImg2) featuredImg2.src = 'assets/atsuko.svg';
      return;
    }

    // Pick 2 distinct random playlists (or repeat if only 1)
    const p1 = playlists[Math.floor(Math.random() * playlists.length)];
    const remaining = playlists.filter(p => p.id !== p1.id);
    const p2 = remaining.length > 0 ? remaining[Math.floor(Math.random() * remaining.length)] : p1;

    if (featuredTitle1) featuredTitle1.textContent = p1.name;
    if (featuredImg1) featuredImg1.src = getRandomCoverFromPlaylist(p1);
    if (featuredCard1) {
      featuredCard1.onclick = () => renderPlaylistSongsView(p1.id);
    }
    if (featuredTitle1) {
      featuredTitle1.onclick = () => renderPlaylistSongsView(p1.id);
    }

    if (featuredTitle2) featuredTitle2.textContent = p2.name;
    if (featuredImg2) featuredImg2.src = getRandomCoverFromPlaylist(p2);
    if (featuredCard2) {
      featuredCard2.onclick = () => renderPlaylistSongsView(p2.id);
    }
    if (featuredTitle2) {
      featuredTitle2.onclick = () => renderPlaylistSongsView(p2.id);
    }
  }

  function renderPlaylistFavSection() {
    const favList = document.getElementById('playlistFavList');
    if (!favList) return;

    const playedPlaylists = playlists.filter(p => (p.playCount || 0) > 0)
      .sort((a, b) => (b.playCount || 0) - (a.playCount || 0));

    if (playedPlaylists.length === 0) {
      favList.innerHTML = `<span class="playlist-fav-empty">No favorite playlist till now</span>`;
      return;
    }

    const top2 = playedPlaylists.slice(0, 2);
    favList.innerHTML = top2.map(p => `
      <span class="playlist-fav-item" data-fav-id="${p.id}" title="Open ${escapeHtml(p.name)}">${escapeHtml(p.name)}</span>
    `).join('');

    favList.querySelectorAll('.playlist-fav-item').forEach(item => {
      item.onclick = () => {
        const id = item.dataset.favId;
        renderPlaylistSongsView(id);
      };
    });
  }

  function hideHomePageContainer() {
    const homeContainer = document.getElementById('homePageContainer');
    if (homeContainer) homeContainer.style.display = 'none';
    const playerSection = document.querySelector('.player-section');
    const librarySection = document.querySelector('.library-section');
    if (playerSection) playerSection.style.display = '';
    if (librarySection) librarySection.style.display = '';
  }

  async function renderPlaylistsView() {
    prepareViewTransition('playlistLeftSection', ['playlist-view-active']);
    currentView = 'playlists';
    activePlaylistId = null;
    currentPlaylistSongsMode = 1;

    // Reset search state if active
    searchQuery = '';
    if (searchInput) searchInput.value = '';
    if (searchOverlay) searchOverlay.classList.remove('open');
    if (isSearchHistoryActive) {
      isSearchHistoryActive = false;
      try {
        window.history.back();
      } catch (e) {}
    }

    playlists = await fileManager.getPlaylists();

    // Synchronize navbar active states
    document.querySelectorAll('.menu-item-btn').forEach(b => b.classList.toggle('active', b.dataset.action === 'playlists'));
    document.querySelectorAll('.mobile-nav-btn').forEach(b => b.classList.toggle('active', b.dataset.action === 'playlists'));

    // Update Header
    updateViewSelectorLabel('Playlists');
    const libraryHeading = document.querySelector('.library-heading');
    if (libraryHeading) libraryHeading.textContent = 'Playlist';

    if (filterAllBtn) {
      filterAllBtn.textContent = 'All';
      filterAllBtn.classList.add('active');
    }
    if (filterColumnBtn) {
      filterColumnBtn.style.display = 'none';
      filterColumnBtn.classList.remove('active');
    }
    if (filterShuffleBtn) {
      filterShuffleBtn.textContent = 'Shuffle';
      filterShuffleBtn.classList.remove('active');
    }

    const exploreRightNav = document.getElementById('exploreRightNav');
    if (exploreRightNav) exploreRightNav.style.display = 'none';
    const libraryEq = document.querySelector('.library-equalizer-bars');
    if (libraryEq) libraryEq.style.display = 'none';
    if (pcLyricsContainer) pcLyricsContainer.style.display = 'none';

    // Render PC Featured Cards & Fav Section
    renderPlaylistFeaturedCards();
    renderPlaylistFavSection();

    if (window.updateArtistMiniPlayerVisibility) {
      window.updateArtistMiniPlayerVisibility();
    }

    // Render Right side playlist list
    if (!songsListContainer) return;
    const hasMini = Boolean(player && player.currentTrack && window.innerWidth > 900);
    songsListContainer.className = `songs-list playlist-mode ${hasMini ? 'has-mini-player' : ''}`;
    songsListContainer.style.display = 'flex';

    if (playlists.length === 0) {
      songsListContainer.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">
            <img src="assets/ADD button with no BG.png" alt="Create Playlist" class="empty-state-img" />
          </div>
          <h3 class="empty-title">No Playlists</h3>
          <p class="empty-subtitle">Create your first playlist to organize your favorite songs.</p>
          <button class="empty-add-btn" id="emptyCreatePlaylistBtn">+ Create New Playlist</button>
        </div>
      `;
      const btn = document.getElementById('emptyCreatePlaylistBtn');
      if (btn) btn.onclick = () => openCreatePlaylistModal();
      return;
    }

    const cardsHTML = playlists.map(p => generatePlaylistCardHTML(p)).join('');
    songsListContainer.innerHTML = `
      <div style="width:100%; margin-bottom: 8px;">
        <button class="playlist-new-btn" id="playlistNewBtn">+ New Playlist</button>
      </div>
      ${cardsHTML}
    `;

    const newBtn = document.getElementById('playlistNewBtn');
    if (newBtn) newBtn.onclick = () => openCreatePlaylistModal();
  }

  async function renderPlaylistSongsView(playlistId) {
    prepareViewTransition(null, ['playlist-songs-active']);
    currentView = 'playlist_songs';
    activePlaylistId = playlistId;

    if (window.updateArtistMiniPlayerVisibility) {
      window.updateArtistMiniPlayerVisibility();
    }

    playlists = await fileManager.getPlaylists();
    const playlist = playlists.find(p => p.id === playlistId);
    if (!playlist) {
      renderPlaylistsView();
      return;
    }

    // Update Library Header with Playlist Name & Back Button
    updateViewSelectorLabel('Playlists');
    const libraryHeading = document.querySelector('.library-heading');
    if (libraryHeading) {
      libraryHeading.innerHTML = `
        <button class="playlist-back-btn" id="playlistBackBtn" title="Back to Playlists">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="19" y1="12" x2="5" y2="12"></line>
            <polyline points="12 19 5 12 12 5"></polyline>
          </svg>
          ${escapeHtml(playlist.name)}
        </button>
      `;
      const backBtn = document.getElementById('playlistBackBtn');
      if (backBtn) {
        backBtn.onclick = (e) => {
          e.stopPropagation();
          currentPlaylistSongsMode = 1;
          renderPlaylistsView();
        };
      }
    }

    if (filterAllBtn) {
      filterAllBtn.textContent = 'All';
      filterAllBtn.classList.add('active');
    }
    if (filterColumnBtn) {
      filterColumnBtn.style.display = 'none';
      filterColumnBtn.classList.remove('active');
    }
    if (filterShuffleBtn) {
      filterShuffleBtn.textContent = 'Shuffle';
      filterShuffleBtn.classList.remove('active');
    }

    const exploreRightNav = document.getElementById('exploreRightNav');
    if (exploreRightNav) exploreRightNav.style.display = 'none';

    // Show 4-Bar Equalizer in PC View
    const libraryEq = document.querySelector('.library-equalizer-bars');
    if (libraryEq) libraryEq.style.display = 'flex';
    updatePlaylistSongsEqualizerBars();

    // Filter songs belonging to this playlist
    const playlistTracks = (playlist.trackIds || []).map(id => allTracks.find(t => t.id === id)).filter(Boolean);

    // Mode 2: Lyrics View
    if (currentPlaylistSongsMode === 2) {
      if (songsListContainer) songsListContainer.style.display = 'none';
      if (pcLyricsContainer) {
        pcLyricsContainer.style.display = 'flex';
        renderPcLyricsView();
      }
      return;
    }

    // Mode 4: Up Next / Queue View
    if (currentPlaylistSongsMode === 4) {
      if (pcLyricsContainer) pcLyricsContainer.style.display = 'none';
      if (songsListContainer) {
        songsListContainer.className = 'songs-list';
        songsListContainer.style.display = 'flex';
        renderPcQueueView();
      }
      return;
    }

    // Mode 3: 3-Column Grid View of this Playlist
    if (currentPlaylistSongsMode === 3) {
      if (pcLyricsContainer) pcLyricsContainer.style.display = 'none';
      if (!songsListContainer) return;
      songsListContainer.style.display = 'flex';
      songsListContainer.className = 'songs-list pc-masonry-grid album-songs-grid-mode playlist-songs-grid-mode';

      if (playlistTracks.length === 0) {
        songsListContainer.className = 'songs-list empty-container';
        songsListContainer.innerHTML = `
          <div class="empty-state">
            <div class="empty-state-icon">
              <img src="assets/ADD button with no BG.png" alt="Add Songs" class="empty-state-img" />
            </div>
            <h3 class="empty-title">Empty Playlist</h3>
            <p class="empty-subtitle">Use <strong>Three-Dots → Add to Playlist</strong> or <strong>Select</strong> from All Songs to add music here.</p>
          </div>
        `;
        return;
      }

      const isDark = document.body.getAttribute('data-theme') === 'dark';
      const dotsIconSrc = isDark ? 'assets/Dark Mode/DarkModeOptionsbtn.svg' : 'assets/OptionsThreeDots.svg';
      const aspectRatios = ['3 / 4', '4 / 5', '16 / 10', '16 / 11', '1 / 1', '3 / 4.2', '16 / 10', '4 / 5', '4 / 3.2', '4 / 5', '16 / 11', '1 / 1'];
      const columns = [[], [], []];

      playlistTracks.forEach((track, idx) => {
        const isCurrent = player.currentTrack && track.id === player.currentTrack.id;
        const coverSrc = track.coverUrl || 'assets/atsuko-no-cover-image.svg';
        const ratio = aspectRatios[idx % aspectRatios.length];

        const cardHTML = `
          <div class="masonry-card ${isCurrent ? 'is-current' : ''}" data-id="${track.id}" data-index="${idx}">
            <div class="masonry-cover-wrapper" style="aspect-ratio: ${ratio};">
              <img src="${coverSrc}" alt="${escapeHtml(track.title)}" class="masonry-cover-img" loading="lazy" onerror="this.onerror=null;this.src='assets/atsuko-no-cover-image.svg';" />
              <div class="masonry-playing-overlay">
                <div class="masonry-play-indicator" title="Play">
                  <svg width="42" height="42" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M7.05 8.28c0-1.78 1.93-2.9 3.47-2.01l7.85 4.53c1.54.89 1.54 3.13 0 4.02l-7.85 4.53c-1.54.89-3.47-.23-3.47-2.01V8.28z"/>
                  </svg>
                </div>
              </div>
              <div class="masonry-bottom-pill">
                <span class="masonry-song-title">${escapeHtml(track.title)}</span>
                <button class="masonry-options-btn" data-id="${track.id}" title="Options" aria-label="Options">
                  <img src="${dotsIconSrc}" alt="Options" />
                </button>
              </div>
            </div>
          </div>
        `;
        columns[idx % 3].push(cardHTML);
      });

      songsListContainer.innerHTML = columns.map(colCards => `
        <div class="pc-masonry-col">
          ${colCards.join('')}
        </div>
      `).join('');

      songsListContainer.querySelectorAll('.masonry-card').forEach(card => {
        card.onclick = async (e) => {
          if (e.target.closest('.masonry-options-btn')) return;
          const trackId = card.dataset.id;
          const targetTrackIndex = playlistTracks.findIndex(t => t.id === trackId);
          if (targetTrackIndex !== -1) {
            player.activePlaylistId = playlist.id;
            player.activePlaylistName = playlist.name;
            await fileManager.incrementPlaylistPlayCount(playlist.id);
            playlists = await fileManager.getPlaylists();
            player.setQueue(playlistTracks, targetTrackIndex, true);
            player.updateNowPlayingUI();
          }
        };
      });

      songsListContainer.querySelectorAll('.masonry-options-btn').forEach(btn => {
        btn.onclick = (e) => {
          e.stopPropagation();
          const trackId = btn.dataset.id;
          showContextMenu(e, trackId, true);
        };
      });
      return;
    }

    // Mode 1: Default Songs List View
    if (pcLyricsContainer) pcLyricsContainer.style.display = 'none';
    if (!songsListContainer) return;
    songsListContainer.style.display = 'flex';
    songsListContainer.className = (isGridView ? 'songs-list grid-view' : 'songs-list') + ' playlist-songs-mode';
    if (isSelectMode) songsListContainer.classList.add('select-mode');

    if (playlistTracks.length === 0) {
      songsListContainer.className = 'songs-list empty-container';
      songsListContainer.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">
            <img src="assets/ADD button with no BG.png" alt="Add Songs" class="empty-state-img" />
          </div>
          <h3 class="empty-title">Empty Playlist</h3>
          <p class="empty-subtitle">Use <strong>Three-Dots → Add to Playlist</strong> or <strong>Select</strong> from All Songs to add music here.</p>
        </div>
      `;
      return;
    }

    songsListContainer.innerHTML = playlistTracks.map((track, idx) => generateSongCardHTML(track, idx, true)).join('');
    requestAnimationFrame(updateMobileScrollbarThumb);
  }

  // =========================================================================
  // MASTER MUSICO HOME PAGE CONTROLLER (PC VIEW ONLY)
  // Matching Image 1 (Viewport) & Image 2 (Complete Scrollable Page)
  // =========================================================================

  let selectedHomeGenre = 'Melancholic';

  async function renderHomePage() {
    prepareViewTransition(null, []);
    currentView = 'home';
    activePlaylistId = null;
    selectedArtistName = null;
    selectedAlbumName = null;

    // Reset search state if active
    searchQuery = '';
    if (searchInput) searchInput.value = '';
    if (searchOverlay) searchOverlay.classList.remove('open');
    if (isSearchHistoryActive) {
      isSearchHistoryActive = false;
      try {
        window.history.back();
      } catch (e) {}
    }

    // Close mobile full player if open
    const mobileFullPlayer = document.getElementById('mobileFullPlayer');
    if (mobileFullPlayer) mobileFullPlayer.classList.remove('open');

    // Synchronize navbar active states
    document.querySelectorAll('.menu-item-btn').forEach(b => b.classList.toggle('active', b.dataset.action === 'home'));
    document.querySelectorAll('.mobile-nav-btn').forEach(b => b.classList.toggle('active', b.dataset.action === 'home'));

    // Update view selector labels
    updateViewSelectorLabel('Home');

    // Hide middle player, library section, column view, full view overlay
    const playerSection = document.querySelector('.player-section');
    const librarySection = document.querySelector('.library-section');
    const columnViewUnifiedScroll = document.getElementById('columnViewUnifiedScroll');
    const columnViewSingleBar = document.getElementById('columnViewSingleBar');
    const artistMiniPlayer = document.getElementById('artistMiniPlayer');
    const homePageContainer = document.getElementById('homePageContainer');

    if (playerSection) playerSection.style.display = 'none';
    if (librarySection) librarySection.style.display = 'none';
    if (columnViewUnifiedScroll) columnViewUnifiedScroll.style.display = 'none';
    if (columnViewSingleBar) columnViewSingleBar.style.display = 'none';
    if (artistMiniPlayer) {
      artistMiniPlayer.classList.remove('visible');
      artistMiniPlayer.style.display = 'none';
    }

    if (homePageContainer) {
      homePageContainer.style.display = 'flex';
      homePageContainer.scrollTop = 0;
    }

    // Dedicated fixed Mini Player visibility for Home
    if (window.updateColumnMiniPlayerVisibility) {
      window.updateColumnMiniPlayerVisibility();
    }

    // Populate all 10 ordered sections
    renderHomeGreeting();
    renderHomeRandomSection();
    await renderHomePlaylistsSection();
    renderHomeGenreSection(selectedHomeGenre);
    renderHomeTopArtistsSection();
    renderHomeTopAlbumsSection();
    renderHomeRecentPlaysSection();
    renderHomeFavouriteSection();
    await renderHomeRecorderSection();
    renderHomeFoldersSection();
    enableHomeHorizontalWheelScroll();
  }

  function renderHomeGreeting() {
    const profileName = localStorage.getItem('musico_profile_username') || localStorage.getItem('musico_profile_name') || 'USER';
    const profileAvatar = localStorage.getItem('musico_profile_image') || localStorage.getItem('musico_profile_avatar') || 'assets/default-avatar.svg';

    const greetingUsername = document.getElementById('homeGreetingUsername');
    if (greetingUsername) greetingUsername.textContent = profileName;

    const profileUsername = document.getElementById('homeProfileUserName');
    if (profileUsername) profileUsername.textContent = profileName;

    const greetingAvatar = document.getElementById('homeGreetingAvatarImg');
    if (greetingAvatar) {
      greetingAvatar.src = profileAvatar;
      greetingAvatar.style.cursor = 'pointer';
      greetingAvatar.title = 'User Profile / Settings';
      greetingAvatar.onclick = (e) => {
        e.stopPropagation();
        if (typeof openProfileModal === 'function') {
          openProfileModal();
        } else if (window.openProfileModal) {
          window.openProfileModal();
        } else if (profileModal) {
          profileModal.classList.add('open');
        }
      };
    }

    const profileAvatarImg = document.getElementById('homeProfileAvatarImg');
    if (profileAvatarImg) profileAvatarImg.src = profileAvatar;

    // Three Action Pills
    const pillAllSongs = document.getElementById('homePillAllSongs');
    if (pillAllSongs) {
      pillAllSongs.onclick = () => {
        setAllFilter();
        showToast('All Songs');
      };
    }

    const pillGenre = document.getElementById('homePillGenre');
    if (pillGenre) {
      pillGenre.onclick = () => {
        renderGenreView();
        showToast('Genre');
      };
    }

    const pillShuffle = document.getElementById('homePillShuffle');
    if (pillShuffle) {
      pillShuffle.onclick = () => {
        const newMode = player.cyclePlaybackMode();
        if (newMode === 'repeat_one') {
          showToast('Playback: Repeat One');
        } else if (newMode === 'shuffle') {
          showToast('Playback: Shuffle ON');
        } else if (newMode === 'normal') {
          showToast('Playback: Play in Line');
        }
      };
    }

    // Home Header Actions
    const homeSearchBtn = document.getElementById('homeSearchBtn');
    if (homeSearchBtn) {
      homeSearchBtn.onclick = (e) => {
        e.stopPropagation();
        if (typeof openSearchOverlay === 'function') {
          openSearchOverlay(true);
        } else if (searchOverlay) {
          searchOverlay.classList.add('open');
          enterSearchHistory();
          if (searchInput) {
            searchInput.focus();
            searchInput.value = searchQuery;
          }
        }
      };
    }

    const homeSettingsBtn = document.getElementById('homeSettingsBtn');
    if (homeSettingsBtn && settingsModal) {
      homeSettingsBtn.onclick = (e) => {
        e.stopPropagation();
        settingsModal.classList.add('open');
      };
    }

    const homeProfileBadge = document.getElementById('homeProfileBadge');
    if (homeProfileBadge) {
      homeProfileBadge.title = `User Profile: ${profileName}`;
      homeProfileBadge.onclick = (e) => {
        e.stopPropagation();
        if (typeof openProfileModal === 'function') {
          openProfileModal();
        } else if (window.openProfileModal) {
          window.openProfileModal();
        } else if (profileModal) {
          profileModal.classList.add('open');
        }
      };
    }

    // Ensure async profile data from IndexedDB is loaded & applied
    if (typeof initUserProfile === 'function') {
      initUserProfile().catch(() => {});
    }

    // Home view selector dropdown
    const homeViewSelectorPill = document.getElementById('homeViewSelectorPill');
    const homeViewDropdownMenu = document.getElementById('homeViewDropdownMenu');
    if (homeViewSelectorPill && homeViewDropdownMenu) {
      homeViewSelectorPill.onclick = (e) => {
        e.stopPropagation();
        homeViewDropdownMenu.classList.toggle('open');
      };

      homeViewDropdownMenu.querySelectorAll('.dropdown-item').forEach(item => {
        item.onclick = (e) => {
          e.stopPropagation();
          const view = item.dataset.view;
          const text = item.textContent.trim();
          homeViewDropdownMenu.classList.remove('open');

          if (view === 'home') {
            renderHomePage();
          } else if (view === 'explore') {
            renderExploreView();
          } else if (view === 'playlists') {
            renderPlaylistsView();
          } else if (view === 'albums') {
            renderAlbumsMainView();
          } else if (view === 'favorites') {
            renderFavouritesView();
          } else {
            setAllFilter();
          }
          showToast(`View: ${text}`);
        };
      });
    }
  }

  function renderHomeRandomSection() {
    const grid = document.getElementById('homeRandomGrid');
    if (!grid) return;

    if (allTracks.length === 0) {
      grid.innerHTML = Array(12).fill(0).map(() => `
        <div class="home-random-song-card">
          <img src="assets/atsuko-no-cover-image.svg" alt="Random Track" />
        </div>
      `).join('');
      return;
    }

    // Shuffle and pick 12 tracks
    const shuffled = [...allTracks].sort(() => 0.5 - Math.random());
    const randomTracks = shuffled.slice(0, 12);

    grid.innerHTML = randomTracks.map(t => {
      const isFallback = !t.coverUrl || t.coverUrl.includes('M logo') || t.coverUrl.includes('Group 4');
      const coverSrc = isFallback ? 'assets/atsuko-no-cover-image.svg' : t.coverUrl;
      return `
        <div class="home-random-song-card" data-id="${t.id}" title="${escapeHtml(t.title)} - ${escapeHtml(t.artist || 'Unknown')}">
          <img src="${coverSrc}" alt="${escapeHtml(t.title)}" onerror="this.onerror=null;this.src='assets/atsuko-no-cover-image.svg';" />
        </div>
      `;
    }).join('');

    grid.querySelectorAll('.home-random-song-card').forEach(card => {
      card.onclick = () => {
        const id = card.dataset.id;
        const trackIdx = allTracks.findIndex(t => t.id === id);
        if (trackIdx !== -1) {
          player.setQueue(allTracks, trackIdx, true);
          player.updateNowPlayingUI();
          if (window.updateColumnMiniPlayerVisibility) window.updateColumnMiniPlayerVisibility();
        }
      };
    });
  }

  async function renderHomePlaylistsSection() {
    const wrap = document.getElementById('homePlaylistsZigzagWrap');
    if (!wrap) return;

    const allPlaylists = await fileManager.getPlaylists();
    const shuffled = [...allPlaylists].sort(() => 0.5 - Math.random());
    const pl = shuffled.slice(0, 4);

    const p1 = pl[0] || { name: 'Late Nights', id: null };
    const p2 = pl[1] || { name: 'Teleph..', id: null };
    const p3 = pl[2] || { name: 'Playlist 3', id: null };
    const p4 = pl[3] || { name: 'Playlist 4', id: null };

    const c1 = p1.id ? getRandomCoverFromPlaylist(p1) : (allTracks[0]?.coverUrl || 'assets/atsuko.svg');
    const c2 = p2.id ? getRandomCoverFromPlaylist(p2) : (allTracks[1]?.coverUrl || 'assets/atsuko.svg');
    const c3 = p3.id ? getRandomCoverFromPlaylist(p3) : (allTracks[2]?.coverUrl || 'assets/atsuko.svg');
    const c4 = p4.id ? getRandomCoverFromPlaylist(p4) : (allTracks[3]?.coverUrl || 'assets/atsuko.svg');

    wrap.innerHTML = `
      <svg class="home-playlist-zigzag-svg" viewBox="0 0 1000 240" fill="none" preserveAspectRatio="none">
        <path d="M 0 110 L 80 110 L 250 170 L 520 60 L 780 40 L 1000 40" />
      </svg>
      <div class="home-playlist-card-item vert-1" data-id="${p1.id || ''}" title="${escapeHtml(p1.name)}">
        <div class="playlist-art-wrap">
          <img src="${c1}" alt="${escapeHtml(p1.name)}" onerror="this.onerror=null;this.src='assets/atsuko.svg';" />
        </div>
        <span class="playlist-title">${escapeHtml(p1.name)}</span>
      </div>
      <div class="home-playlist-card-item horiz-2" data-id="${p2.id || ''}" title="${escapeHtml(p2.name)}">
        <div class="playlist-art-wrap">
          <img src="${c2}" alt="${escapeHtml(p2.name)}" onerror="this.onerror=null;this.src='assets/atsuko.svg';" />
        </div>
        <span class="playlist-title">${escapeHtml(p2.name)}</span>
      </div>
      <div class="home-playlist-card-item vert-3" data-id="${p3.id || ''}" title="${escapeHtml(p3.name)}">
        <div class="playlist-art-wrap">
          <img src="${c3}" alt="${escapeHtml(p3.name)}" onerror="this.onerror=null;this.src='assets/atsuko.svg';" />
        </div>
        <span class="playlist-title">${escapeHtml(p3.name)}</span>
      </div>
      <div class="home-playlist-card-item horiz-4" data-id="${p4.id || ''}" title="${escapeHtml(p4.name)}">
        <div class="playlist-art-wrap">
          <img src="${c4}" alt="${escapeHtml(p4.name)}" onerror="this.onerror=null;this.src='assets/atsuko.svg';" />
        </div>
        <span class="playlist-title">${escapeHtml(p4.name)}</span>
      </div>
    `;

    wrap.querySelectorAll('.home-playlist-card-item').forEach(item => {
      item.onclick = () => {
        const id = item.dataset.id;
        if (id) {
          renderPlaylistSongsView(id);
        } else {
          renderPlaylistsView();
        }
      };
    });
  }

  function renderHomeGenreSection(selectedGenre = 'Melancholic') {
    selectedHomeGenre = selectedGenre;
    const chipsScroll = document.getElementById('homeGenreChipsScroll');
    const songsGrid = document.getElementById('homeGenreSongsGrid');

    const genres = ['Melancholic', 'Energetic', 'Nostalgic', 'Heartbreak', 'Dreamy', 'Chill', 'Romantic', 'Sad'];

    if (chipsScroll) {
      chipsScroll.innerHTML = genres.map(g => `
        <button class="home-genre-chip ${g === selectedHomeGenre ? 'active' : ''}" data-genre="${g}">${g}</button>
      `).join('');

      chipsScroll.querySelectorAll('.home-genre-chip').forEach(btn => {
        btn.onclick = () => {
          renderHomeGenreSection(btn.dataset.genre);
        };
      });
    }

    if (songsGrid) {
      const isDark = (document.body.getAttribute('data-theme') || currentTheme) === 'dark';
      const dotsIconSrc = isDark ? 'assets/Dark Mode/DarkModeOptionsbtn.svg' : 'assets/OptionsThreeDots.svg';

      const genreTracks = allTracks.filter(t => classifyTrackGenre(t) === selectedHomeGenre);
      const displayTracks = genreTracks.length > 0 ? genreTracks.slice(0, 6) : allTracks.slice(0, 6);

      if (displayTracks.length === 0) {
        songsGrid.innerHTML = `<div style="grid-column: 1 / -1; opacity: 0.6; font-size: 14px; padding: 12px 0;">No songs available for ${selectedHomeGenre}</div>`;
      } else {
        songsGrid.innerHTML = displayTracks.map(t => {
          const isFallback = !t.coverUrl || t.coverUrl.includes('M logo') || t.coverUrl.includes('Group 4');
          const coverSrc = isFallback ? 'assets/atsuko-no-cover-image.svg' : t.coverUrl;
          return `
            <div class="home-genre-song-row" data-id="${t.id}">
              <div class="home-genre-song-left">
                <img src="${coverSrc}" alt="${escapeHtml(t.title)}" class="home-genre-song-thumb" onerror="this.onerror=null;this.src='assets/atsuko-no-cover-image.svg';" />
                <div class="home-genre-song-info">
                  <span class="home-genre-song-title">${escapeHtml(t.title)}</span>
                  <span class="home-genre-song-artist">//${escapeHtml(t.artist || 'Unknown')}</span>
                </div>
              </div>
              <button class="home-genre-song-options-btn" data-id="${t.id}" title="Options" aria-label="Options">
                <img src="${dotsIconSrc}" alt="Options" />
              </button>
            </div>
          `;
        }).join('');

        songsGrid.querySelectorAll('.home-genre-song-row').forEach(row => {
          row.onclick = (e) => {
            const optBtn = e.target.closest('.home-genre-song-options-btn');
            if (optBtn) {
              e.stopPropagation();
              showContextMenu(e, optBtn.dataset.id);
              return;
            }
            const id = row.dataset.id;
            const idx = allTracks.findIndex(t => t.id === id);
            if (idx !== -1) {
              player.setQueue(allTracks, idx, true);
              player.updateNowPlayingUI();
              if (window.updateColumnMiniPlayerVisibility) window.updateColumnMiniPlayerVisibility();
            }
          };
        });
      }
    }
  }

  function renderHomeTopArtistsSection() {
    const scroll = document.getElementById('homeTopArtistsScroll');
    if (!scroll) return;

    const topArtists = getTopArtists(7);
    if (topArtists.length === 0) {
      scroll.innerHTML = `<span style="opacity: 0.6; font-size: 14px; padding: 10px;">No artists available</span>`;
      return;
    }

    scroll.innerHTML = topArtists.map(a => {
      const coverSrc = a.coverUrl || (a.tracks[0]?.coverUrl) || 'assets/atsuko.svg';
      return `
        <div class="home-top-artist-card" data-artist="${escapeHtml(a.name)}" title="${escapeHtml(a.name)}">
          <img src="${coverSrc}" alt="${escapeHtml(a.name)}" class="home-top-artist-center-art" onerror="this.onerror=null;this.src='assets/atsuko.svg';" />
        </div>
      `;
    }).join('');

    scroll.querySelectorAll('.home-top-artist-card').forEach(card => {
      card.onclick = () => {
        const name = card.dataset.artist;
        if (name) renderArtistDetailView(name);
      };
    });
  }

  function renderHomeTopAlbumsSection() {
    const scroll = document.getElementById('homeTopAlbumsScroll');
    if (!scroll) return;

    const topAlbums = getTopAlbums(10);
    if (topAlbums.length === 0) {
      scroll.innerHTML = `<span style="opacity: 0.6; font-size: 14px; padding: 10px;">No albums available</span>`;
      return;
    }

    scroll.innerHTML = topAlbums.map(alb => {
      const isFallback = !alb.coverUrl || alb.coverUrl.includes('M logo') || alb.coverUrl.includes('Group 4');
      const coverSrc = isFallback ? 'assets/atsuko-no-cover-image.svg' : alb.coverUrl;
      return `
        <div class="home-top-album-card" data-album="${escapeHtml(alb.name)}" title="${escapeHtml(alb.name)}">
          <img src="${coverSrc}" alt="${escapeHtml(alb.name)}" onerror="this.onerror=null;this.src='assets/atsuko-no-cover-image.svg';" />
        </div>
      `;
    }).join('');

    scroll.querySelectorAll('.home-top-album-card').forEach(card => {
      card.onclick = () => {
        const name = card.dataset.album;
        if (name) renderAlbumDetailView(name);
      };
    });
  }

  function renderHomeRecentPlaysSection() {
    const layout = document.getElementById('homeRecentPlaysLayout');
    if (!layout) return;

    const history = player.playbackHistory || [];
    const recentTracks = history.length > 0 ? history.slice(0, 3) : allTracks.slice(0, 3);

    if (recentTracks.length === 0) {
      layout.innerHTML = `<span style="opacity: 0.6; font-size: 14px;">No recently played songs</span>`;
      return;
    }

    const featured = recentTracks[0];
    const stacked1 = recentTracks[1] || featured;
    const stacked2 = recentTracks[2] || stacked1;

    const featCover = featured.coverUrl || 'assets/atsuko-no-cover-image.svg';
    const s1Cover = stacked1.coverUrl || 'assets/atsuko-no-cover-image.svg';
    const s2Cover = stacked2.coverUrl || 'assets/atsuko-no-cover-image.svg';

    layout.innerHTML = `
      <div class="home-recent-featured-wrap" data-id="${featured.id}" title="${escapeHtml(featured.title)}">
        <div class="home-recent-featured-art">
          <img src="${featCover}" alt="${escapeHtml(featured.title)}" onerror="this.onerror=null;this.src='assets/atsuko-no-cover-image.svg';" />
        </div>
        <span class="home-recent-featured-title">${escapeHtml(featured.title)}</span>
      </div>
      <div class="home-recent-stacked-group">
        <div class="home-recent-stacked-card" data-id="${stacked1.id}" title="${escapeHtml(stacked1.title)}">
          <img src="${s1Cover}" alt="${escapeHtml(stacked1.title)}" onerror="this.onerror=null;this.src='assets/atsuko-no-cover-image.svg';" />
        </div>
        <div class="home-recent-stacked-card" data-id="${stacked2.id}" title="${escapeHtml(stacked2.title)}">
          <img src="${s2Cover}" alt="${escapeHtml(stacked2.title)}" onerror="this.onerror=null;this.src='assets/atsuko-no-cover-image.svg';" />
        </div>
      </div>
    `;

    layout.querySelectorAll('[data-id]').forEach(el => {
      el.onclick = () => {
        const id = el.dataset.id;
        const idx = allTracks.findIndex(t => t.id === id);
        if (idx !== -1) {
          player.setQueue(allTracks, idx, true);
          player.updateNowPlayingUI();
          if (window.updateColumnMiniPlayerVisibility) window.updateColumnMiniPlayerVisibility();
        }
      };
    });
  }

  function renderHomeFavouriteSection() {
    const row = document.getElementById('homeFavouriteCardsRow');
    if (!row) return;

    const favIds = getFavouriteTrackIds();
    const favTracks = favIds.map(id => allTracks.find(t => t.id === id)).filter(Boolean).slice(0, 5);
    const displayTracks = favTracks.length > 0 ? favTracks : allTracks.slice(0, 5);

    if (displayTracks.length === 0) {
      row.innerHTML = `<span style="opacity: 0.6; font-size: 14px;">No favourite songs available</span>`;
      return;
    }

    row.innerHTML = displayTracks.map((t, idx) => {
      const coverSrc = t.coverUrl || 'assets/atsuko-no-cover-image.svg';
      return `
        <div class="home-fav-card fav-${idx + 1}" data-id="${t.id}" title="${escapeHtml(t.title)}">
          <img src="${coverSrc}" alt="${escapeHtml(t.title)}" onerror="this.onerror=null;this.src='assets/atsuko-no-cover-image.svg';" />
        </div>
      `;
    }).join('');

    row.querySelectorAll('.home-fav-card').forEach(card => {
      card.onclick = () => {
        const id = card.dataset.id;
        const idx = allTracks.findIndex(t => t.id === id);
        if (idx !== -1) {
          player.setQueue(allTracks, idx, true);
          player.updateNowPlayingUI();
          if (window.updateColumnMiniPlayerVisibility) window.updateColumnMiniPlayerVisibility();
        }
      };
    });
  }

  async function renderHomeRecorderSection() {
    const layout = document.getElementById('homeRecorderLayout');
    if (!layout) return;

    const isDark = (document.body.getAttribute('data-theme') || currentTheme) === 'dark';
    const dotsIconSrc = isDark ? 'assets/Dark Mode/DarkModeOptionsbtn.svg' : 'assets/OptionsThreeDots.svg';

    const recordings = await fileManager.getRecordings();
    const recent4 = (recordings || []).slice(0, 4);

    layout.innerHTML = `
      <div class="home-recorder-widget-card" id="homeRecorderCassetteWidget" tabindex="0" role="button" title="Open Recorder">
        <svg viewBox="0 0 446 418" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M39 10.3C39 4.6 45.5 0 53.5 0L382.5 0C390.5 0 397 4.6 397 10.3V243.7C397 249.4 390.5 254 382.5 254H53.5C45.5 254 39 249.4 39 243.7V10.3Z" fill="${isDark ? '#F5F5F5' : '#1E1E22'}"/>
          <path d="M0 174.3C0 168.6 8.1 164 18.1 164H427.9C437.9 164 446 168.6 446 174.3V407.7C446 413.4 437.9 418 427.9 418H18.1C8.1 418 0 413.4 0 407.7L0 174.3Z" fill="${isDark ? '#000000' : '#FFFFFF'}"/>
          <g style="transform-origin: 134.5px 290.5px;">
            <circle cx="134.5" cy="290.5" r="57.5" fill="${isDark ? 'white' : '#111'}"/>
            <circle cx="134.5" cy="290.5" r="15.5" fill="${isDark ? 'black' : 'white'}"/>
          </g>
          <g style="transform-origin: 311.5px 290.5px;">
            <circle cx="311.5" cy="290.5" r="57.5" fill="${isDark ? 'white' : '#111'}"/>
            <circle cx="312" cy="291" r="39" fill="${isDark ? 'black' : 'white'}"/>
          </g>
          <circle cx="60" cy="380" r="12" fill="#E53935" />
        </svg>
      </div>
      <div class="home-recordings-list">
        ${recent4.length === 0 ? `
          <div class="home-recording-row" style="cursor: default;">
            <div class="home-recording-info">
              <span class="home-recording-name">No recordings yet</span>
              <span class="home-recording-meta">Click recorder widget to record audio</span>
            </div>
          </div>
        ` : recent4.map((rec, idx) => `
          <div class="home-recording-row" data-id="${rec.id}">
            <div class="home-recording-info">
              <span class="home-recording-name">Rec. ${idx + 1} — ${escapeHtml(rec.name || 'Voice Note')}</span>
              <span class="home-recording-meta">${escapeHtml(rec.date || 'Recent')} • ${escapeHtml(rec.duration || '0:00')}</span>
            </div>
            <button class="home-recording-options-btn" data-id="${rec.id}" title="Options" aria-label="Options">
              <img src="${dotsIconSrc}" alt="Options" />
            </button>
          </div>
        `).join('')}
      </div>
    `;

    const cassette = document.getElementById('homeRecorderCassetteWidget');
    if (cassette) cassette.onclick = () => renderRecorderView();

    layout.querySelectorAll('.home-recording-row').forEach(row => {
      row.onclick = (e) => {
        const optBtn = e.target.closest('.home-recording-options-btn');
        if (optBtn) {
          e.stopPropagation();
          return;
        }
        const id = row.dataset.id;
        const rec = (recordings || []).find(r => r.id === id);
        if (rec) {
          playRecordingItem(rec);
        }
      };
    });
  }

  function renderHomeFoldersSection() {
    const grid = document.getElementById('homeFoldersGrid');
    if (!grid) return;

    const folders = getFoldersList();
    const folderNames = folders.map(f => f.name).filter(n => n !== 'All Songs');
    const displayFolders = folderNames.length > 0 ? folderNames.slice(0, 6) : ['Downloads', 'Music', 'Recordings', 'Documents', 'Audio', 'Favorites'];

    while (displayFolders.length < 6) {
      const fallbacks = ['Downloads', 'Music', 'Recordings', 'Documents', 'Audio', 'Favorites'];
      const next = fallbacks.find(f => !displayFolders.includes(f)) || `Folder ${displayFolders.length + 1}`;
      displayFolders.push(next);
    }

    grid.innerHTML = displayFolders.slice(0, 6).map(name => `
      <div class="home-folder-item" data-folder="${escapeHtml(name)}" title="Open ${escapeHtml(name)}">
        <div class="home-folder-icon-wrap">
          <svg class="home-folder-icon-svg" viewBox="0 0 72 58" xmlns="http://www.w3.org/2000/svg">
            <path d="M0 8C0 3.58 3.58 0 8 0H26.5C29.2 0 31.7 1.34 33.2 3.6L37.8 10.4C39.3 12.66 41.8 14 44.5 14H64C68.42 14 72 17.58 72 22V50C72 54.42 68.42 58 64 58H8C3.58 58 0 54.42 0 50V8Z" />
          </svg>
        </div>
        <span class="home-folder-name">${escapeHtml(name)}</span>
      </div>
    `).join('');

    grid.querySelectorAll('.home-folder-item').forEach(item => {
      item.onclick = () => {
        const name = item.dataset.folder;
        if (name) renderFolderDetailView(name);
      };
    });
  }

  function enableHomeHorizontalWheelScroll() {
    document.querySelectorAll('.home-horizontal-scroll').forEach(container => {
      if (container._hasWheelListener) return;
      container._hasWheelListener = true;
      container.addEventListener('wheel', (e) => {
        if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
          e.preventDefault();
          container.scrollLeft += e.deltaY * 0.8;
        }
      }, { passive: false });
    });
  }

  // =========================================================================
  // EXPLORE / LIBRARY SYSTEM VIEW CONTROLLER (PC VIEW ONLY)
  // =========================================================================

  async function renderExploreView() {
    prepareViewTransition('exploreLeftSection', ['explore-view-active']);
    currentView = 'explore';
    activePlaylistId = null;

    // Reset search state if active
    searchQuery = '';
    if (searchInput) searchInput.value = '';
    if (searchOverlay) searchOverlay.classList.remove('open');
    if (isSearchHistoryActive) {
      isSearchHistoryActive = false;
      try {
        window.history.back();
      } catch (e) {}
    }

    // Synchronize navbar active states
    document.querySelectorAll('.menu-item-btn').forEach(b => b.classList.toggle('active', b.dataset.action === 'explore'));
    document.querySelectorAll('.mobile-nav-btn').forEach(b => b.classList.toggle('active', b.dataset.action === 'explore'));

    // Update Header labels
    updateViewSelectorLabel('Explore / Library');

    const libraryHeading = document.querySelector('.library-heading');
    if (libraryHeading) libraryHeading.textContent = 'Library';

    // Set 3 buttons text: All | Add New | Now Playing
    if (filterAllBtn) {
      filterAllBtn.textContent = 'All';
      filterAllBtn.classList.add('active');
    }
    if (filterColumnBtn) {
      filterColumnBtn.style.display = '';
      filterColumnBtn.textContent = 'Add New';
      filterColumnBtn.classList.remove('active');
    }
    if (filterShuffleBtn) {
      filterShuffleBtn.textContent = 'Now Playing';
      filterShuffleBtn.classList.remove('active');
    }

    // Right side: Hide songs list, equalizer bars, lyrics, and show Explore Right Nav
    if (songsListContainer) songsListContainer.style.display = 'none';
    if (pcLyricsContainer) pcLyricsContainer.style.display = 'none';
    const libraryEq = document.querySelector('.library-equalizer-bars');
    if (libraryEq) libraryEq.style.display = 'none';

    const exploreRightNav = document.getElementById('exploreRightNav');
    if (exploreRightNav) exploreRightNav.style.display = 'flex';

    // Populate Dynamic Library Artwork
    populateExploreDynamicData();

    if (window.updateArtistMiniPlayerVisibility) {
      window.updateArtistMiniPlayerVisibility();
    }
  }

  function populateExploreDynamicData() {
    // 1. Artist random circular artwork
    const exploreArtistImg = document.getElementById('exploreArtistImg');
    if (exploreArtistImg) {
      const tracksWithCover = allTracks.filter(t => t.coverUrl && !t.coverUrl.includes('M logo') && !t.coverUrl.includes('Group 4'));
      if (tracksWithCover.length > 0) {
        const randTrack = tracksWithCover[Math.floor(Math.random() * tracksWithCover.length)];
        exploreArtistImg.src = randTrack.coverUrl;
      } else if (allTracks.length > 0 && allTracks[0].coverUrl) {
        exploreArtistImg.src = allTracks[0].coverUrl;
      } else {
        exploreArtistImg.src = 'assets/atsuko.svg';
      }
    }

    // 2. Playlist 2 random playlist covers
    const explorePlaylistImg1 = document.getElementById('explorePlaylistImg1');
    const explorePlaylistImg2 = document.getElementById('explorePlaylistImg2');
    if (explorePlaylistImg1 && explorePlaylistImg2) {
      if (playlists && playlists.length > 0) {
        const p1 = playlists[Math.floor(Math.random() * playlists.length)];
        const remaining = playlists.filter(p => p.id !== p1.id);
        const p2 = remaining.length > 0 ? remaining[Math.floor(Math.random() * remaining.length)] : p1;
        explorePlaylistImg1.src = getRandomCoverFromPlaylist(p1);
        explorePlaylistImg2.src = getRandomCoverFromPlaylist(p2);
      } else {
        const covers = allTracks.filter(t => t.coverUrl && !t.coverUrl.includes('M logo')).map(t => t.coverUrl);
        explorePlaylistImg1.src = covers[0] || 'assets/atsuko.svg';
        explorePlaylistImg2.src = covers[1] || covers[0] || 'assets/atsuko.svg';
      }
    }

    // 3. Folders 4 random covers
    const folderImgs = [
      document.getElementById('exploreFolderImg1'),
      document.getElementById('exploreFolderImg2'),
      document.getElementById('exploreFolderImg3'),
      document.getElementById('exploreFolderImg4')
    ];

    const availableCovers = allTracks.filter(t => t.coverUrl && !t.coverUrl.includes('M logo')).map(t => t.coverUrl);
    // Shuffle available covers for variety
    const shuffledCovers = [...availableCovers].sort(() => 0.5 - Math.random());

    folderImgs.forEach((img, idx) => {
      if (img) {
        if (shuffledCovers.length > idx) {
          img.src = shuffledCovers[idx];
        } else if (availableCovers.length > 0) {
          img.src = availableCovers[idx % availableCovers.length];
        } else {
          img.src = 'assets/atsuko.svg';
        }
      }
    });
  }

  // =========================================================================
  // ARTIST SYSTEM VIEW CONTROLLERS (PC VIEW ONLY)
  // Matching Image 1 (Main), Image 2 (Detail), Image 3 (Detail + Now Playing)
  // =========================================================================

  function getUniqueArtists() {
    const artistMap = new Map();
    allTracks.forEach(t => {
      const rawName = (t.artist || 'Unknown').trim();
      const name = rawName.length > 0 ? rawName : 'Unknown';
      const key = name.toLowerCase();
      if (!artistMap.has(key)) {
        artistMap.set(key, {
          name: name,
          tracks: [],
          totalPlayCount: 0,
          coverUrl: t.coverUrl && !t.coverUrl.includes('M logo') && !t.coverUrl.includes('Group 4') ? t.coverUrl : null,
          bio: t.artistBio || t.comment || ''
        });
      }
      const entry = artistMap.get(key);
      entry.tracks.push(t);
      entry.totalPlayCount += (t.playCount || 0);
      if (!entry.coverUrl && t.coverUrl && !t.coverUrl.includes('M logo') && !t.coverUrl.includes('Group 4')) {
        entry.coverUrl = t.coverUrl;
      }
    });
    return Array.from(artistMap.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  function getTopArtists(count = 2) {
    const artists = getUniqueArtists();
    artists.sort((a, b) => (b.totalPlayCount - a.totalPlayCount) || (b.tracks.length - a.tracks.length));
    return artists.slice(0, count);
  }

  function getArtistTopSongs(artistName, count = 3) {
    const key = (artistName || 'Unknown').trim().toLowerCase();
    const songs = allTracks.filter(t => (t.artist || 'Unknown').trim().toLowerCase() === key);
    songs.sort((a, b) => (b.playCount || 0) - (a.playCount || 0));
    return songs.slice(0, count);
  }

  function populateArtistMainArtwork() {
    const artistMainCoverImg = document.getElementById('artistMainCoverImg');
    if (artistMainCoverImg) {
      const topArtists = getTopArtists(1);
      if (topArtists.length > 0 && topArtists[0].coverUrl) {
        artistMainCoverImg.src = topArtists[0].coverUrl;
      } else {
        const tracksWithCover = allTracks.filter(t => t.coverUrl && !t.coverUrl.includes('M logo') && !t.coverUrl.includes('Group 4'));
        if (tracksWithCover.length > 0) {
          artistMainCoverImg.src = tracksWithCover[0].coverUrl;
        } else {
          artistMainCoverImg.src = 'assets/atsuko.svg';
        }
      }
    }
  }

  function populateFavArtists() {
    const artistFavList = document.getElementById('artistFavList');
    if (!artistFavList) return;

    const topArtists = getTopArtists(2);
    if (topArtists.length === 0) {
      artistFavList.innerHTML = '<span class="artist-fav-empty">No favorite artists yet</span>';
      return;
    }

    artistFavList.innerHTML = topArtists.map(artist => `
      <div class="artist-fav-item" data-artist-name="${escapeHtml(artist.name)}" tabindex="0" role="button">
        ${escapeHtml(artist.name)}
      </div>
    `).join('');

    artistFavList.querySelectorAll('.artist-fav-item').forEach(item => {
      item.addEventListener('click', () => {
        const name = item.dataset.artistName;
        if (name) renderArtistDetailView(name);
      });
    });
  }

  function populateArtistFavSongs(artistName) {
    const artistFavSongsList = document.getElementById('artistFavSongsList');
    if (!artistFavSongsList) return;

    const topSongs = getArtistTopSongs(artistName, 3);
    if (topSongs.length === 0) {
      artistFavSongsList.innerHTML = '<span class="artist-fav-empty">No songs found</span>';
      return;
    }

    artistFavSongsList.innerHTML = topSongs.map(song => `
      <div class="artist-fav-song-item" data-song-id="${escapeHtml(song.id)}" tabindex="0" role="button">
        ${escapeHtml(song.title)}
      </div>
    `).join('');

    artistFavSongsList.querySelectorAll('.artist-fav-song-item').forEach(item => {
      item.addEventListener('click', () => {
        const songId = item.dataset.songId;
        const track = allTracks.find(t => t.id === songId);
        if (track) {
          const artistSongs = allTracks.filter(t => (t.artist || 'Unknown').trim().toLowerCase() === artistName.trim().toLowerCase());
          const trackIdx = artistSongs.findIndex(t => t.id === songId);
          player.setQueue(artistSongs, trackIdx !== -1 ? trackIdx : 0, true);
          player.updateNowPlayingUI();
        }
      });
    });
  }

  // 1. Artist Main View (Image 1 & Image 2)
  function renderArtistMainView() {
    prepareViewTransition('artistLeftSection', ['artist-view-active', 'artist-main-active']);
    currentView = 'artist_main';
    selectedArtistName = null;
    activePlaylistId = null;

    // Synchronize navbar active states
    document.querySelectorAll('.menu-item-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.mobile-nav-btn').forEach(b => b.classList.remove('active'));

    updateViewSelectorLabel('Explore / Library');

    // Header Back Button in right pane: ← Library
    const libraryHeading = document.querySelector('.library-heading');
    if (libraryHeading) {
      libraryHeading.innerHTML = `
        <button class="playlist-back-btn" id="artistMainBackBtn" title="Back to Library">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="19" y1="12" x2="5" y2="12"></line>
            <polyline points="12 19 5 12 12 5"></polyline>
          </svg>
          Library
        </button>
      `;
      const backBtn = document.getElementById('artistMainBackBtn');
      if (backBtn) {
        backBtn.onclick = (e) => {
          e.stopPropagation();
          renderExploreView();
        };
      }
    }

    // Toggle Left Section Sub-views
    const artistMainLeft = document.getElementById('artistMainLeft');
    const artistDetailLeft = document.getElementById('artistDetailLeft');
    if (artistMainLeft) artistMainLeft.style.display = 'flex';
    if (artistDetailLeft) artistDetailLeft.style.display = 'none';

    // Filter pills (All | Shuffle) - Now Playing button removed from Artist main view
    if (filterAllBtn) {
      filterAllBtn.textContent = 'All';
      filterAllBtn.classList.add('active');
    }
    if (filterColumnBtn) {
      filterColumnBtn.style.display = 'none';
      filterColumnBtn.classList.remove('active');
    }
    if (filterShuffleBtn) {
      filterShuffleBtn.textContent = 'Shuffle';
      filterShuffleBtn.classList.remove('active');
    }

    const exploreRightNav = document.getElementById('exploreRightNav');
    if (exploreRightNav) exploreRightNav.style.display = 'none';
    const libraryEq = document.querySelector('.library-equalizer-bars');
    if (libraryEq) libraryEq.style.display = 'flex';
    if (pcLyricsContainer) pcLyricsContainer.style.display = 'none';

    // Configure 2-bar vertical mode selector for Artist section (List | Grid)
    updateArtistEqualizerBars();

    // Populate dynamic graphics & favorite artists
    populateArtistMainArtwork();
    populateFavArtists();

    // Render Right side based on active Artist PC Mode (1 = List, 2 = Grid)
    if (currentArtistPcMode === 2) {
      renderArtistMainGridView();
    } else {
      renderArtistMainListView();
    }

    // Update Artist Mini Player visibility
    if (window.updateArtistMiniPlayerVisibility) {
      window.updateArtistMiniPlayerVisibility();
    }
  }

  // 1.a Artist List View (Image 1)
  function renderArtistMainListView() {
    if (!songsListContainer) return;
    songsListContainer.style.display = 'flex';
    const hasMini = Boolean(player && player.currentTrack && window.innerWidth > 900);
    songsListContainer.className = `songs-list artist-mode ${hasMini ? 'has-mini-player' : ''}`;

    const uniqueArtists = getUniqueArtists();
    if (uniqueArtists.length === 0) {
      songsListContainer.innerHTML = `
        <div class="empty-state">
          <h3 class="empty-title">No Artists Found</h3>
          <p class="empty-subtitle">Add music to your library to see your artists here.</p>
        </div>
      `;
      return;
    }

    const isDark = (document.body.getAttribute('data-theme') || currentTheme) === 'dark';
    const dotsIconSrc = isDark ? 'assets/Dark Mode/DarkModeOptionsbtn.svg' : 'assets/OptionsThreeDots.svg';

    songsListContainer.innerHTML = uniqueArtists.map(artist => {
      const songCount = artist.tracks ? artist.tracks.length : 0;
      const uniqueAlbumsSet = new Set(
        (artist.tracks || [])
          .map(t => (t.album || '').trim())
          .filter(a => a.length > 0 && a.toLowerCase() !== 'unknown' && a.toLowerCase() !== 'unknown album')
      );
      const albumCount = uniqueAlbumsSet.size;
      const songsText = songCount === 1 ? '1 song' : `${songCount} songs`;
      const albumsText = albumCount === 1 ? '1 album' : `${albumCount} albums`;
      const subText = `//${songsText} · ${albumsText}`;

      return `
        <div class="artist-card-item" data-artist-name="${escapeHtml(artist.name)}" tabindex="0" role="button">
          <div class="artist-card-info">
            <span class="artist-card-title">${escapeHtml(artist.name)}</span>
            <span class="artist-card-sub">${subText}</span>
          </div>
          <button class="artist-card-dots" data-artist-name="${escapeHtml(artist.name)}" title="Artist options" aria-label="Artist options">
            <img src="${dotsIconSrc}" alt="Options" class="options-icon" />
          </button>
        </div>
      `;
    }).join('');

    // Attach click listeners to artist cards
    songsListContainer.querySelectorAll('.artist-card-item').forEach(card => {
      card.addEventListener('click', (e) => {
        const dotsBtn = e.target.closest('.artist-card-dots');
        if (dotsBtn) {
          e.stopPropagation();
          const artistName = dotsBtn.dataset.artistName || card.dataset.artistName;
          if (artistName) showArtistContextMenu(e, artistName);
          return;
        }
        const artistName = card.dataset.artistName;
        if (artistName) renderArtistDetailView(artistName);
      });
    });
  }

  // 1.b Artist Grid View (Image 2) - 3-Column Masonry Grid of Unique Artists
  function renderArtistMainGridView() {
    if (!songsListContainer) return;
    songsListContainer.style.display = 'flex';
    const hasMini = Boolean(player && player.currentTrack && window.innerWidth > 900);
    songsListContainer.className = `songs-list pc-masonry-grid artist-grid-mode ${hasMini ? 'has-mini-player' : ''}`;

    const uniqueArtists = getUniqueArtists();
    if (uniqueArtists.length === 0) {
      songsListContainer.className = 'songs-list empty-container';
      songsListContainer.innerHTML = `
        <div class="empty-state">
          <h3 class="empty-title">No Artists Found</h3>
          <p class="empty-subtitle">Add music to your library to see your artists here.</p>
        </div>
      `;
      return;
    }

    const isDark = document.body.getAttribute('data-theme') === 'dark';
    const dotsIconSrc = isDark ? 'assets/Dark Mode/DarkModeOptionsbtn.svg' : 'assets/OptionsThreeDots.svg';

    // Varied aspect ratio heights matching reference design (~2.5 cards visible per column)
    const aspectRatios = [
      '3 / 4',    // Portrait (~1.33x)
      '4 / 5',    // Medium-tall portrait (~1.25x)
      '16 / 10',  // Short landscape (~0.62x)
      '16 / 11',  // Short landscape (~0.69x)
      '1 / 1',    // Square (1.0x)
      '3 / 4.2',  // Tall portrait (~1.4x)
      '16 / 10',  // Short landscape (~0.62x)
      '4 / 5',    // Medium-tall portrait (~1.25x)
      '4 / 3.2',  // Medium landscape (~0.8x)
      '4 / 5',    // Medium-tall portrait (~1.25x)
      '16 / 11',  // Short landscape (~0.69x)
      '1 / 1'     // Square (1.0x)
    ];

    const columns = [[], [], []];

    uniqueArtists.forEach((artist, idx) => {
      const isCurrent = player.currentTrack && (player.currentTrack.artist || 'Unknown').trim().toLowerCase() === artist.name.trim().toLowerCase();
      const isFallback = !artist.coverUrl || 
                         artist.coverUrl.includes('atsuko-no-cover-image') ||
                         artist.coverUrl.includes('Atsuko - NoCoverImg') ||
                         artist.coverUrl.includes('atsuko') ||
                         artist.coverUrl.includes('M logo') ||
                         artist.coverUrl.includes('MlogoforMusicItems') ||
                         artist.coverUrl.includes('Mlogo.png') || 
                         artist.coverUrl.includes('Group 4') || 
                         artist.coverUrl.trim() === '';
      const coverSrc = isFallback ? 'assets/atsuko-no-cover-image.svg' : artist.coverUrl;
      const ratio = aspectRatios[idx % aspectRatios.length];

      const cardHTML = `
        <div class="masonry-card artist-grid-card ${isCurrent ? 'is-current' : ''}" data-artist-name="${escapeHtml(artist.name)}" data-index="${idx}">
          <div class="masonry-cover-wrapper" style="aspect-ratio: ${ratio};">
            <img src="${coverSrc}" alt="${escapeHtml(artist.name)}" class="masonry-cover-img" loading="lazy" onerror="this.onerror=null;this.src='assets/atsuko-no-cover-image.svg';" />
            <div class="masonry-playing-overlay">
              <div class="masonry-play-indicator" title="Play ${escapeHtml(artist.name)}">
                <svg width="42" height="42" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M7.05 8.28c0-1.78 1.93-2.9 3.47-2.01l7.85 4.53c1.54.89 1.54 3.13 0 4.02l-7.85 4.53c-1.54.89-3.47-.23-3.47-2.01V8.28z"/>
                </svg>
              </div>
            </div>
            <div class="masonry-bottom-pill">
              <span class="masonry-song-title">${escapeHtml(artist.name)}</span>
              <button class="masonry-options-btn" data-artist-name="${escapeHtml(artist.name)}" title="Options" aria-label="Options">
                <img src="${dotsIconSrc}" alt="Options" />
              </button>
            </div>
          </div>
        </div>
      `;

      columns[idx % 3].push(cardHTML);
    });

    songsListContainer.innerHTML = columns.map(colCards => `
      <div class="pc-masonry-col">
        ${colCards.join('')}
      </div>
    `).join('');

    // Attach click listeners to artist grid cards
    songsListContainer.querySelectorAll('.artist-grid-card').forEach(card => {
      card.addEventListener('click', (e) => {
        const optionsBtn = e.target.closest('.masonry-options-btn');
        if (optionsBtn) {
          e.stopPropagation();
          const artistName = optionsBtn.dataset.artistName || card.dataset.artistName;
          if (artistName) showArtistContextMenu(e, artistName);
          return;
        }
        const artistName = card.dataset.artistName;
        if (!artistName) return;

        if (e.target.closest('.masonry-play-indicator')) {
          e.stopPropagation();
          const artist = uniqueArtists.find(a => a.name.toLowerCase() === artistName.toLowerCase());
          if (artist && artist.tracks.length > 0) {
            player.setQueue(artist.tracks, 0, true);
            player.updateNowPlayingUI();
          }
          return;
        }

        renderArtistDetailView(artistName);
      });
    });
  }

  // 1.b Artist Main Now Playing View
  function renderArtistMainNowPlayingView() {
    currentView = 'artist_main_now_playing';

    // Switch Left side to normal Now Playing view
    const playerBody = document.querySelector('.player-body');
    if (playerBody) {
      playerBody.classList.remove('explore-view-active', 'playlist-view-active', 'artist-view-active', 'artist-main-active');
    }

    // Filter pills (All | Artist | Shuffle)
    if (filterAllBtn) filterAllBtn.textContent = 'All';
    if (filterColumnBtn) {
      filterColumnBtn.style.display = '';
      filterColumnBtn.textContent = 'Artist';
    }
    if (filterShuffleBtn) filterShuffleBtn.textContent = 'Shuffle';

    const libraryHeading = document.querySelector('.library-heading');
    if (libraryHeading) libraryHeading.textContent = 'Artist';

    const exploreRightNav = document.getElementById('exploreRightNav');
    if (exploreRightNav) exploreRightNav.style.display = 'none';
    const libraryEq = document.querySelector('.library-equalizer-bars');
    if (libraryEq) libraryEq.style.display = 'flex';
    if (pcLyricsContainer) pcLyricsContainer.style.display = 'none';
  }

  function getArtistAlbums(artistName, maxCount = 10) {
    const artistSongs = allTracks.filter(t => (t.artist || 'Unknown').trim().toLowerCase() === (artistName || 'Unknown').trim().toLowerCase());
    const albumMap = new Map();

    artistSongs.forEach(track => {
      const rawAlbum = (track.album || '').trim();
      const albumName = (rawAlbum && rawAlbum.toLowerCase() !== 'unknown' && rawAlbum.toLowerCase() !== 'unknown album') ? rawAlbum : track.title;
      if (!albumMap.has(albumName)) {
        albumMap.set(albumName, {
          name: albumName,
          coverUrl: (track.coverUrl && !track.coverUrl.includes('M logo') && !track.coverUrl.includes('Group 4')) ? track.coverUrl : 'assets/atsuko.svg',
          tracks: []
        });
      }
      const alb = albumMap.get(albumName);
      alb.tracks.push(track);
      if ((!alb.coverUrl || alb.coverUrl.includes('M logo')) && track.coverUrl && !track.coverUrl.includes('M logo') && !track.coverUrl.includes('Group 4')) {
        alb.coverUrl = track.coverUrl;
      }
    });

    return Array.from(albumMap.values()).slice(0, maxCount);
  }

  // 2. Individual Artist View (Image 1 & Image 2)
  function renderArtistDetailView(artistName) {
    if (!artistName) {
      renderArtistMainView();
      return;
    }
    prepareViewTransition('artistLeftSection', ['artist-view-active']);
    currentView = 'artist_detail';
    selectedArtistName = artistName;
    activePlaylistId = null;

    // Synchronize navbar active states
    document.querySelectorAll('.menu-item-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.mobile-nav-btn').forEach(b => b.classList.remove('active'));

    // Update Header
    updateViewSelectorLabel('Explore / Library');

    // Header Back Button in right pane: ← Artist Name... (Matched to Selected-Playlist Back Button)
    const libraryHeading = document.querySelector('.library-heading');
    if (libraryHeading) {
      libraryHeading.innerHTML = `
        <button class="playlist-back-btn artist-back-btn" id="artistBackBtn" title="Back to Artists">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="19" y1="12" x2="5" y2="12"></line>
            <polyline points="12 19 5 12 12 5"></polyline>
          </svg>
          ${escapeHtml(artistName)}
        </button>
      `;
      const backBtn = document.getElementById('artistBackBtn');
      if (backBtn) {
        backBtn.onclick = (e) => {
          e.stopPropagation();
          currentArtistDetailMode = 1;
          renderArtistMainView();
        };
      }
    }

    // Toggle Left Section Sub-views
    const artistMainLeft = document.getElementById('artistMainLeft');
    const artistDetailLeft = document.getElementById('artistDetailLeft');
    if (artistMainLeft) artistMainLeft.style.display = 'none';
    if (artistDetailLeft) artistDetailLeft.style.display = 'flex';

    // Top Filter pills: Only Two (All | Shuffle)
    if (filterAllBtn) {
      filterAllBtn.textContent = 'All';
      filterAllBtn.classList.remove('active');
    }
    if (filterColumnBtn) {
      filterColumnBtn.style.display = 'none';
    }
    if (filterShuffleBtn) {
      filterShuffleBtn.textContent = 'Shuffle';
    }

    const exploreRightNav = document.getElementById('exploreRightNav');
    if (exploreRightNav) exploreRightNav.style.display = 'none';
    const libraryEq = document.querySelector('.library-equalizer-bars');
    if (libraryEq) libraryEq.style.display = 'flex';

    // Update 4 isolated vertical mode bars for Artist Detail section
    updateArtistDetailEqualizerBars();

    // Populate Left Detail Heading & Artwork
    const artistDetailHeading = document.getElementById('artistDetailHeading');
    if (artistDetailHeading) artistDetailHeading.textContent = artistName;

    const artistDetailCoverImg = document.getElementById('artistDetailCoverImg');
    const artistSongs = allTracks.filter(t => (t.artist || 'Unknown').trim().toLowerCase() === artistName.trim().toLowerCase());
    const coverTrack = artistSongs.find(t => t.coverUrl && !t.coverUrl.includes('M logo') && !t.coverUrl.includes('Group 4')) || artistSongs[0];
    if (artistDetailCoverImg) {
      artistDetailCoverImg.src = coverTrack?.coverUrl || 'assets/atsuko.svg';
    }

    // Populate Fav. Songs (up to 3) in left pane
    populateArtistFavSongs(artistName);

    // Update Mini Player visibility
    if (window.updateArtistMiniPlayerVisibility) {
      window.updateArtistMiniPlayerVisibility();
    }

    // Mode 2: Lyrics View (Offline lyrics for currently playing song)
    if (currentArtistDetailMode === 2) {
      if (songsListContainer) songsListContainer.style.display = 'none';
      if (pcLyricsContainer) {
        pcLyricsContainer.style.display = 'flex';
        renderPcLyricsView();
      }
      return;
    }

    // Mode 4: Up Next / Queue View
    if (currentArtistDetailMode === 4) {
      if (pcLyricsContainer) pcLyricsContainer.style.display = 'none';
      if (songsListContainer) {
        const hasMini = Boolean(player && player.currentTrack && window.innerWidth > 900);
        songsListContainer.className = `songs-list ${hasMini ? 'has-mini-player' : ''}`;
        songsListContainer.style.display = 'flex';
        renderPcQueueView();
      }
      return;
    }

    // Mode 1: Default / About View OR Mode 3: Top Songs Grid View
    if (pcLyricsContainer) pcLyricsContainer.style.display = 'none';
    if (!songsListContainer) return;
    songsListContainer.style.display = 'flex';
    const hasMini = Boolean(player && player.currentTrack && window.innerWidth > 900);
    songsListContainer.className = `songs-list ${hasMini ? 'has-mini-player' : ''}`;

    // 1. Bio & Stats (Only display if genuinely present in local MP3 metadata)
    const bioText = (coverTrack?.artistBio || coverTrack?.comment || '').trim();
    const isRealBio = Boolean(bioText && !bioText.startsWith('00000') && !bioText.startsWith('ExactAudioCopy'));
    const bioHTML = isRealBio ? `<p class="artist-bio-text">${escapeHtml(bioText)}</p>` : '';

    const listeners = coverTrack?.listeners ? String(coverTrack.listeners).trim() : '';
    const scrobbles = coverTrack?.scrobbles ? String(coverTrack.scrobbles).trim() : '';

    let statsHTML = '';
    if (listeners && scrobbles) {
      statsHTML = `<div class="artist-stats-row"><span>Listeners : ${escapeHtml(listeners)}</span><span>Scrobbles : ${escapeHtml(scrobbles)}</span></div>`;
    } else if (listeners) {
      statsHTML = `<div class="artist-stats-row"><span>Listeners : ${escapeHtml(listeners)}</span></div>`;
    } else if (scrobbles) {
      statsHTML = `<div class="artist-stats-row"><span>Scrobbles : ${escapeHtml(scrobbles)}</span></div>`;
    }

    const hasArtistInfo = Boolean(bioHTML || statsHTML);

    // 2. Divider line (Only show if valid artist information exists)
    const dividerHTML = hasArtistInfo ? `<div class="artist-section-divider"></div>` : '';

    // 3. Top Albums
    const albums = getArtistAlbums(artistName);
    let albumsHTML = '';
    if (albums.length > 0) {
      albumsHTML = `
        <div class="artist-albums-section">
          <h3 class="artist-albums-heading">Top Albums</h3>
          <div class="artist-albums-row">
            ${albums.map((alb, idx) => `
              <div class="artist-album-card" data-album-index="${idx}" tabindex="0" role="button" title="Play album: ${escapeHtml(alb.name)}">
                <img src="${alb.coverUrl}" alt="${escapeHtml(alb.name)}" class="artist-album-cover" loading="lazy" onerror="this.onerror=null;this.src='assets/atsuko.svg';" />
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }

    // 4. Top Songs: List View (Mode 1) vs 3-Column Grid View (Mode 3)
    let songsSectionHTML = '';
    if (currentArtistDetailMode === 1) {
      const topSongsHTML = artistSongs.map((track, idx) => generateSongCardHTML(track, idx)).join('');
      songsSectionHTML = `
        <div class="artist-top-songs-section">
          <h3 class="artist-top-songs-heading">Top Songs</h3>
          <div class="artist-songs-wrap" style="width: 100%; display: flex; flex-direction: column; gap: 8px;">
            ${topSongsHTML || '<div class="pc-queue-empty">No songs found for this artist</div>'}
          </div>
        </div>
      `;
    } else {
      // Mode 3: 3-Column Grid View (Image 2)
      const isDark = (document.body.getAttribute('data-theme') || currentTheme) === 'dark';
      const dotsIconSrc = isDark ? 'assets/Dark Mode/DarkModeOptionsbtn.svg' : 'assets/OptionsThreeDots.svg';
      const aspectRatios = [
        '3 / 4',
        '4 / 5',
        '16 / 10',
        '16 / 11',
        '1 / 1',
        '3 / 4.2',
        '16 / 10',
        '4 / 5',
        '4 / 3.2',
        '4 / 5',
        '16 / 11',
        '1 / 1'
      ];
      const columns = [[], [], []];

      artistSongs.forEach((track, idx) => {
        const isCurrent = player.currentTrack && track.id === player.currentTrack.id;
        const isFallback = !track.coverUrl || 
                           track.coverUrl.includes('atsuko-no-cover-image') ||
                           track.coverUrl.includes('Atsuko - NoCoverImg') ||
                           track.coverUrl.includes('atsuko') ||
                           track.coverUrl.includes('M logo') ||
                           track.coverUrl.includes('MlogoforMusicItems') ||
                           track.coverUrl.includes('Mlogo.png') || 
                           track.coverUrl.includes('Group 4') || 
                           track.coverUrl.trim() === '';
        const coverSrc = isFallback ? 'assets/atsuko-no-cover-image.svg' : track.coverUrl;
        const ratio = aspectRatios[idx % aspectRatios.length];

        const cardHTML = `
          <div class="masonry-card ${isCurrent ? 'is-current' : ''}" data-id="${track.id}" data-index="${idx}">
            <div class="masonry-cover-wrapper" style="aspect-ratio: ${ratio};">
              <img src="${coverSrc}" alt="${escapeHtml(track.title)}" class="masonry-cover-img" loading="lazy" onerror="this.onerror=null;this.src='assets/atsuko-no-cover-image.svg';" />
              <div class="masonry-playing-overlay">
                <div class="masonry-play-indicator" title="Play">
                  <svg width="42" height="42" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M7.05 8.28c0-1.78 1.93-2.9 3.47-2.01l7.85 4.53c1.54.89 1.54 3.13 0 4.02l-7.85 4.53c-1.54.89-3.47-.23-3.47-2.01V8.28z"/>
                  </svg>
                </div>
              </div>
              <div class="masonry-bottom-pill">
                <span class="masonry-song-title">${escapeHtml(track.title)}</span>
                <button class="masonry-options-btn" data-id="${track.id}" title="Options" aria-label="Options">
                  <img src="${dotsIconSrc}" alt="Options" />
                </button>
              </div>
            </div>
          </div>
        `;
        columns[idx % 3].push(cardHTML);
      });

      songsSectionHTML = `
        <div class="artist-top-songs-section">
          <h3 class="artist-top-songs-heading">Top Songs</h3>
          <div class="pc-masonry-grid" style="display: flex; gap: 14px; width: 100%; align-items: flex-start;">
            ${columns.map(colCards => `
              <div class="pc-masonry-col" style="flex: 1; display: flex; flex-direction: column; gap: 14px; min-width: 0;">
                ${colCards.join('')}
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }

    songsListContainer.innerHTML = `
      <div class="artist-about-container">
        ${bioHTML}
        ${statsHTML}
        ${dividerHTML}
        ${albumsHTML}
        ${songsSectionHTML}
      </div>
    `;

    // Attach click listeners to Album cards
    songsListContainer.querySelectorAll('.artist-album-card').forEach(card => {
      card.addEventListener('click', (e) => {
        e.stopPropagation();
        const albumIndex = parseInt(card.dataset.albumIndex, 10);
        const album = albums[albumIndex];
        if (album && album.tracks.length > 0) {
          player.setQueue(album.tracks, 0, true);
          player.updateNowPlayingUI();
        }
      });
    });

    // Attach click listeners to Grid cards in Mode 3
    if (currentArtistDetailMode === 3) {
      songsListContainer.querySelectorAll('.masonry-card').forEach(card => {
        card.addEventListener('click', (e) => {
          const optionsBtn = e.target.closest('.masonry-options-btn');
          if (optionsBtn) {
            e.stopPropagation();
            const trackId = optionsBtn.dataset.id || card.dataset.id;
            if (trackId) showContextMenu(e, trackId);
            return;
          }
          const trackId = card.dataset.id;
          if (!trackId) return;
          const trackIdx = artistSongs.findIndex(t => t.id === trackId);
          if (trackIdx !== -1) {
            player.setQueue(artistSongs, trackIdx, true);
            player.updateNowPlayingUI();
          }
        });
      });
    }
  }

  // =========================================================================
  // ALBUMS SYSTEM VIEW CONTROLLERS (PC VIEW ONLY)
  // Matching Image 1 (Albums Main) & Image 2 (Individual Album)
  // =========================================================================

  function getUniqueAlbums() {
    const albumMap = new Map();
    allTracks.forEach(t => {
      const rawAlbum = (t.album || '').trim();
      const albumName = (rawAlbum && rawAlbum.toLowerCase() !== 'unknown' && rawAlbum.toLowerCase() !== 'unknown album') ? rawAlbum : (t.title || 'Unknown');
      const key = albumName.toLowerCase();
      if (!albumMap.has(key)) {
        albumMap.set(key, {
          name: albumName,
          artist: t.artist || 'Unknown',
          coverUrl: (t.coverUrl && !t.coverUrl.includes('M logo') && !t.coverUrl.includes('Group 4')) ? t.coverUrl : null,
          tracks: [],
          totalPlayCount: 0
        });
      }
      const alb = albumMap.get(key);
      alb.tracks.push(t);
      alb.totalPlayCount += (t.playCount || 0);
      if (!alb.coverUrl && t.coverUrl && !t.coverUrl.includes('M logo') && !t.coverUrl.includes('Group 4')) {
        alb.coverUrl = t.coverUrl;
      }
    });
    return Array.from(albumMap.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  function getTopAlbums(count = 2) {
    const albums = getUniqueAlbums();
    albums.sort((a, b) => (b.totalPlayCount - a.totalPlayCount) || (b.tracks.length - a.tracks.length));
    return albums.slice(0, count);
  }

  function getAlbumTopSongs(albumName, count = 2) {
    const albSongs = allTracks.filter(t => (t.album || t.title || '').trim().toLowerCase() === (albumName || '').trim().toLowerCase());
    albSongs.sort((a, b) => (b.playCount || 0) - (a.playCount || 0));
    return albSongs.slice(0, count);
  }

  function populateAlbumsMainArtwork() {
    const uniqueAlbums = getUniqueAlbums();
    const topImg = document.getElementById('albumMainImgTop');
    const centerImg = document.getElementById('albumMainImgCenter');
    const bottomImg = document.getElementById('albumMainImgBottom');
    const centerTitle = document.getElementById('albumMainCenterTitle');
    const centerArtist = document.getElementById('albumMainCenterArtist');
    const topCard = document.getElementById('albumMainCardTop');
    const centerCard = document.getElementById('albumMainCardCenter');
    const bottomCard = document.getElementById('albumMainCardBottom');
    const albumMainBgImg = document.getElementById('albumMainBgImg');

    const isDark = (document.body.getAttribute('data-theme') || currentTheme) === 'dark';
    if (albumMainBgImg) {
      albumMainBgImg.src = isDark ? 'assets/LibraryItems/AlbumGraphicalThing-DarkMode.svg' : 'assets/LibraryItems/AlbumGraphicalThing.svg';
    }

    if (uniqueAlbums.length === 0) {
      if (topImg) { topImg.src = 'assets/atsuko-no-cover-image.svg'; topImg.className = 'album-arc-img fallback-logo'; }
      if (centerImg) { centerImg.src = 'assets/atsuko-no-cover-image.svg'; centerImg.className = 'album-arc-img fallback-logo'; }
      if (bottomImg) { bottomImg.src = 'assets/atsuko-no-cover-image.svg'; bottomImg.className = 'album-arc-img fallback-logo'; }
      if (centerTitle) centerTitle.textContent = 'No Albums';
      if (centerArtist) centerArtist.textContent = 'Unknown';
      if (topCard) topCard.onclick = null;
      if (centerCard) centerCard.onclick = null;
      if (bottomCard) bottomCard.onclick = null;
      return;
    }

    // Select 3 random distinct albums
    const shuffled = [...uniqueAlbums].sort(() => Math.random() - 0.5);
    const a1 = shuffled[0]; // Top
    const a2 = shuffled.length > 1 ? shuffled[1] : a1; // Center (featured)
    const a3 = shuffled.length > 2 ? shuffled[2] : (shuffled.length > 1 ? shuffled[0] : a1); // Bottom

    if (topImg) {
      topImg.src = a1.coverUrl || 'assets/atsuko-no-cover-image.svg';
      topImg.className = `album-arc-img ${(!a1.coverUrl || a1.coverUrl.includes('M logo')) ? 'fallback-logo' : ''}`;
    }
    if (topCard) {
      topCard.title = `Open ${a1.name}`;
      topCard.onclick = () => renderAlbumDetailView(a1.name);
    }

    // Center is featured: show its name and artist (no // prefix)
    if (centerImg) {
      centerImg.src = a2.coverUrl || 'assets/atsuko-no-cover-image.svg';
      centerImg.className = `album-arc-img ${(!a2.coverUrl || a2.coverUrl.includes('M logo')) ? 'fallback-logo' : ''}`;
    }
    if (centerTitle) centerTitle.textContent = a2.name;
    if (centerArtist) centerArtist.textContent = a2.artist || 'Unknown';
    if (centerCard) {
      centerCard.title = `Open ${a2.name}`;
      centerCard.onclick = () => renderAlbumDetailView(a2.name);
    }

    if (bottomImg) {
      bottomImg.src = a3.coverUrl || 'assets/atsuko-no-cover-image.svg';
      bottomImg.className = `album-arc-img ${(!a3.coverUrl || a3.coverUrl.includes('M logo')) ? 'fallback-logo' : ''}`;
    }
    if (bottomCard) {
      bottomCard.title = `Open ${a3.name}`;
      bottomCard.onclick = () => renderAlbumDetailView(a3.name);
    }
  }

  function populateFavAlbums() {
    const albumsFavList = document.getElementById('albumsFavList');
    if (!albumsFavList) return;

    const topAlbums = getTopAlbums(2);
    if (topAlbums.length === 0) {
      albumsFavList.innerHTML = '<span class="albums-fav-empty">No favorite albums yet</span>';
      return;
    }

    albumsFavList.innerHTML = topAlbums.map(album => `
      <div class="albums-fav-item" data-album-name="${escapeHtml(album.name)}" tabindex="0" role="button">
        ${escapeHtml(album.name)}
      </div>
    `).join('');

    albumsFavList.querySelectorAll('.albums-fav-item').forEach(item => {
      item.addEventListener('click', () => {
        const name = item.dataset.albumName;
        if (name) renderAlbumDetailView(name);
      });
    });
  }

  function renderAlbumsMainView() {
    prepareViewTransition('albumsLeftSection', ['albums-view-active', 'albums-main-active']);
    currentView = 'albums_main';
    selectedAlbumName = null;
    activePlaylistId = null;

    // Synchronize navbar active states
    document.querySelectorAll('.menu-item-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.mobile-nav-btn').forEach(b => b.classList.remove('active'));

    // Header label
    updateViewSelectorLabel('Albums');

    // Header Back Button in right pane: ← Library
    const libraryHeading = document.querySelector('.library-heading');
    if (libraryHeading) {
      libraryHeading.innerHTML = `
        <button class="playlist-back-btn" id="albumsBackBtn" title="Back to Library">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="19" y1="12" x2="5" y2="12"></line>
            <polyline points="12 19 5 12 12 5"></polyline>
          </svg>
          Library
        </button>
      `;
      const backBtn = document.getElementById('albumsBackBtn');
      if (backBtn) {
        backBtn.onclick = (e) => {
          e.stopPropagation();
          renderExploreView();
        };
      }
    }

    // Toggle Left Section Sub-views
    const albumsMainLeft = document.getElementById('albumsMainLeft');
    const albumDetailLeft = document.getElementById('albumDetailLeft');
    if (albumsMainLeft) albumsMainLeft.style.display = 'flex';
    if (albumDetailLeft) albumDetailLeft.style.display = 'none';

    // Filter pills (All | Shuffle)
    if (filterAllBtn) {
      filterAllBtn.textContent = 'All';
      filterAllBtn.classList.add('active');
    }
    if (filterColumnBtn) {
      filterColumnBtn.style.display = 'none';
      filterColumnBtn.classList.remove('active');
    }
    if (filterShuffleBtn) {
      filterShuffleBtn.textContent = 'Shuffle';
      filterShuffleBtn.classList.remove('active');
    }

    const exploreRightNav = document.getElementById('exploreRightNav');
    if (exploreRightNav) exploreRightNav.style.display = 'none';
    const libraryEq = document.querySelector('.library-equalizer-bars');
    if (libraryEq) libraryEq.style.display = 'flex';
    if (pcLyricsContainer) pcLyricsContainer.style.display = 'none';

    // 2-Bar Equalizer: List | Grid
    updateAlbumsEqualizerBars();

    // Populate Graphics & Favorites
    populateAlbumsMainArtwork();
    populateFavAlbums();

    // Render Right side based on active Albums PC Mode (1 = List, 2 = Grid)
    if (currentAlbumsPcMode === 2) {
      renderAlbumsMainGridView();
    } else {
      renderAlbumsMainListView();
    }

    if (window.updateArtistMiniPlayerVisibility) {
      window.updateArtistMiniPlayerVisibility();
    }
  }

  function renderAlbumsMainListView() {
    if (!songsListContainer) return;
    songsListContainer.style.display = 'flex';
    const hasMini = Boolean(player && player.currentTrack && window.innerWidth > 900);
    songsListContainer.className = `songs-list albums-list-mode ${hasMini ? 'has-mini-player' : ''}`;

    const uniqueAlbums = getUniqueAlbums();
    if (uniqueAlbums.length === 0) {
      songsListContainer.className = 'songs-list empty-container';
      songsListContainer.innerHTML = `
        <div class="empty-state">
          <h3 class="empty-title">No Albums Found</h3>
          <p class="empty-subtitle">Add music to your library to see your albums here.</p>
        </div>
      `;
      return;
    }

    const isDark = (document.body.getAttribute('data-theme') || currentTheme) === 'dark';
    const dotsIconSrc = isDark ? 'assets/Dark Mode/DarkModeOptionsbtn.svg' : 'assets/OptionsThreeDots.svg';

    songsListContainer.innerHTML = uniqueAlbums.map(album => {
      return `
        <div class="album-list-card" data-album-name="${escapeHtml(album.name)}" tabindex="0" role="button">
          <div class="album-list-info">
            <span class="album-list-title">${escapeHtml(album.name)}</span>
            <span class="album-list-artist">${escapeHtml(album.artist || 'Unknown')}</span>
          </div>
          <button class="album-list-options-btn" data-album-name="${escapeHtml(album.name)}" title="Album options" aria-label="Album options">
            <img src="${dotsIconSrc}" alt="Options" class="options-icon" />
          </button>
        </div>
      `;
    }).join('');

    songsListContainer.querySelectorAll('.album-list-card').forEach(card => {
      card.addEventListener('click', (e) => {
        const dotsBtn = e.target.closest('.album-list-options-btn');
        if (dotsBtn) {
          e.stopPropagation();
          const albumName = dotsBtn.dataset.albumName || card.dataset.albumName;
          if (albumName) showAlbumContextMenu(e, albumName);
          return;
        }
        const albumName = card.dataset.albumName;
        if (albumName) renderAlbumDetailView(albumName);
      });
    });
  }

  function renderAlbumsMainGridView() {
    if (!songsListContainer) return;
    songsListContainer.style.display = 'flex';
    const hasMini = Boolean(player && player.currentTrack && window.innerWidth > 900);
    songsListContainer.className = `songs-list pc-masonry-grid album-grid-mode ${hasMini ? 'has-mini-player' : ''}`;

    const uniqueAlbums = getUniqueAlbums();
    if (uniqueAlbums.length === 0) {
      songsListContainer.className = 'songs-list empty-container';
      songsListContainer.innerHTML = `
        <div class="empty-state">
          <h3 class="empty-title">No Albums Found</h3>
          <p class="empty-subtitle">Add music to your library to see your albums here.</p>
        </div>
      `;
      return;
    }

    const isDark = document.body.getAttribute('data-theme') === 'dark';
    const dotsIconSrc = isDark ? 'assets/Dark Mode/DarkModeOptionsbtn.svg' : 'assets/OptionsThreeDots.svg';

    const aspectRatios = [
      '3 / 4', '4 / 5', '16 / 10', '16 / 11', '1 / 1', '3 / 4.2',
      '16 / 10', '4 / 5', '4 / 3.2', '4 / 5', '16 / 11', '1 / 1'
    ];

    const columns = [[], [], []];

    uniqueAlbums.forEach((album, idx) => {
      const isCurrent = player.currentTrack && (player.currentTrack.album || '').trim().toLowerCase() === album.name.trim().toLowerCase();
      const coverSrc = album.coverUrl || 'assets/atsuko-no-cover-image.svg';
      const ratio = aspectRatios[idx % aspectRatios.length];

      const cardHTML = `
        <div class="masonry-card album-grid-card ${isCurrent ? 'is-current' : ''}" data-album-name="${escapeHtml(album.name)}" data-index="${idx}">
          <div class="masonry-cover-wrapper" style="aspect-ratio: ${ratio};">
            <img src="${coverSrc}" alt="${escapeHtml(album.name)}" class="masonry-cover-img" loading="lazy" onerror="this.onerror=null;this.src='assets/atsuko-no-cover-image.svg';" />
            <div class="masonry-playing-overlay">
              <div class="masonry-play-indicator" title="Play ${escapeHtml(album.name)}">
                <svg width="42" height="42" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M7.05 8.28c0-1.78 1.93-2.9 3.47-2.01l7.85 4.53c1.54.89 1.54 3.13 0 4.02l-7.85 4.53c-1.54.89-3.47-.23-3.47-2.01V8.28z"/>
                </svg>
              </div>
            </div>
            <div class="masonry-bottom-pill">
              <span class="masonry-song-title">${escapeHtml(album.name)}</span>
              <button class="masonry-options-btn" data-album-name="${escapeHtml(album.name)}" title="Options" aria-label="Options">
                <img src="${dotsIconSrc}" alt="Options" />
              </button>
            </div>
          </div>
        </div>
      `;

      columns[idx % 3].push(cardHTML);
    });

    songsListContainer.innerHTML = columns.map(colCards => `
      <div class="pc-masonry-col">
        ${colCards.join('')}
      </div>
    `).join('');

    songsListContainer.querySelectorAll('.album-grid-card').forEach(card => {
      card.addEventListener('click', (e) => {
        const optionsBtn = e.target.closest('.masonry-options-btn');
        if (optionsBtn) {
          e.stopPropagation();
          const albumName = optionsBtn.dataset.albumName || card.dataset.albumName;
          if (albumName) showAlbumContextMenu(e, albumName);
          return;
        }
        const albumName = card.dataset.albumName;
        if (!albumName) return;

        if (e.target.closest('.masonry-play-indicator')) {
          e.stopPropagation();
          const album = uniqueAlbums.find(a => a.name.toLowerCase() === albumName.toLowerCase());
          if (album && album.tracks.length > 0) {
            player.setQueue(album.tracks, 0, true);
            player.updateNowPlayingUI();
          }
          return;
        }

        renderAlbumDetailView(albumName);
      });
    });
  }

  function updateAlbumDetailFavSongs(albumName) {
    const albumDetailFavList = document.getElementById('albumDetailFavList');
    if (!albumDetailFavList) return;

    const albumTracks = allTracks.filter(t => (t.album || t.title || '').trim().toLowerCase() === (albumName || '').trim().toLowerCase());
    const favTrackIds = new Set(getFavouriteTrackIds());
    const favAlbumSongs = albumTracks.filter(t => favTrackIds.has(t.id)).slice(0, 2);

    if (favAlbumSongs.length === 0) {
      albumDetailFavList.innerHTML = '';
      return;
    }

    albumDetailFavList.innerHTML = favAlbumSongs.map(s => `
      <div class="albums-fav-item" data-song-id="${escapeHtml(s.id)}" tabindex="0" role="button" title="Play ${escapeHtml(s.title)}">
        ${escapeHtml(s.title)}
      </div>
    `).join('');

    albumDetailFavList.querySelectorAll('.albums-fav-item').forEach(item => {
      item.addEventListener('click', () => {
        const sId = item.dataset.songId;
        const targetIdx = albumTracks.findIndex(t => t.id === sId);
        if (targetIdx !== -1) {
          player.setQueue(albumTracks, targetIdx, true);
          player.updateNowPlayingUI();
        }
      });
    });
  }

  // 2. Individual Album View (Image 1 / Figma)
  function renderAlbumDetailView(albumName) {
    if (!albumName) {
      renderAlbumsMainView();
      return;
    }
    prepareViewTransition('albumsLeftSection', ['albums-view-active']);
    currentView = 'album_detail';
    selectedAlbumName = albumName;
    activePlaylistId = null;

    // Synchronize navbar active states
    document.querySelectorAll('.menu-item-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.mobile-nav-btn').forEach(b => b.classList.remove('active'));

    updateViewSelectorLabel('Albums');

    // Header Back Button: ← Album
    const libraryHeading = document.querySelector('.library-heading');
    if (libraryHeading) {
      libraryHeading.innerHTML = `
        <button class="playlist-back-btn album-back-btn" id="albumDetailBackBtn" title="Back to Albums">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="19" y1="12" x2="5" y2="12"></line>
            <polyline points="12 19 5 12 12 5"></polyline>
          </svg>
          Album
        </button>
      `;
      const backBtn = document.getElementById('albumDetailBackBtn');
      if (backBtn) {
        backBtn.onclick = (e) => {
          e.stopPropagation();
          currentAlbumDetailMode = 1;
          renderAlbumsMainView();
        };
      }
    }

    // Toggle Left Section Sub-views
    const albumsMainLeft = document.getElementById('albumsMainLeft');
    const albumDetailLeft = document.getElementById('albumDetailLeft');
    if (albumsMainLeft) albumsMainLeft.style.display = 'none';
    if (albumDetailLeft) albumDetailLeft.style.display = 'flex';

    if (filterAllBtn) {
      filterAllBtn.textContent = 'All';
      filterAllBtn.classList.remove('active');
    }
    if (filterColumnBtn) {
      filterColumnBtn.style.display = 'none';
    }
    if (filterShuffleBtn) {
      filterShuffleBtn.textContent = 'Shuffle';
    }

    const exploreRightNav = document.getElementById('exploreRightNav');
    if (exploreRightNav) exploreRightNav.style.display = 'none';
    const libraryEq = document.querySelector('.library-equalizer-bars');
    if (libraryEq) libraryEq.style.display = 'flex';

    // 4-Bar Equalizer: List, Lyrics, Grid, Queue
    updateAlbumDetailEqualizerBars();

    // Set dynamic theme SVG
    const isDark = (document.body.getAttribute('data-theme') || currentTheme) === 'dark';
    const albumDetailBgImg = document.getElementById('albumDetailBgImg');
    if (albumDetailBgImg) {
      albumDetailBgImg.src = isDark ? 'assets/LibraryItems/AlbumGraphicalThing-DarkMode.svg' : 'assets/LibraryItems/AlbumGraphicalThing.svg';
    }

    // Populate Left Detail Artwork & Info
    const albumDetailHeading = document.getElementById('albumDetailHeading');
    if (albumDetailHeading) albumDetailHeading.textContent = 'Album';
    const albumDetailSubTitle = document.getElementById('albumDetailSubTitle');
    if (albumDetailSubTitle) albumDetailSubTitle.textContent = albumName;

    const albumTracks = allTracks.filter(t => (t.album || t.title || '').trim().toLowerCase() === albumName.trim().toLowerCase());
    const albumArtist = albumTracks.length > 0 ? (albumTracks[0].artist || 'Unknown') : 'Unknown';
    const albumDetailSubArtist = document.getElementById('albumDetailSubArtist');
    if (albumDetailSubArtist) albumDetailSubArtist.textContent = albumArtist;

    const albumCoverTrack = albumTracks.find(t => t.coverUrl && !t.coverUrl.includes('M logo') && !t.coverUrl.includes('Group 4')) || albumTracks[0];
    const albumDetailCoverImg = document.getElementById('albumDetailCoverImg');
    if (albumDetailCoverImg) {
      const coverUrl = albumCoverTrack?.coverUrl;
      const isFallback = !coverUrl || coverUrl.includes('M logo');
      albumDetailCoverImg.src = coverUrl || 'assets/atsuko-no-cover-image.svg';
      albumDetailCoverImg.className = `album-arc-img ${isFallback ? 'fallback-logo' : ''}`;
    }

    const albumDetailCard = document.getElementById('albumDetailCard');
    if (albumDetailCard) {
      albumDetailCard.title = `Play ${albumName}`;
      albumDetailCard.onclick = () => {
        if (albumTracks.length > 0) {
          player.setQueue(albumTracks, 0, true);
          player.updateNowPlayingUI();
        }
      };
    }

    // Fav. Songs in Left Pane for this Album (up to 2 favorite songs)
    updateAlbumDetailFavSongs(albumName);

    if (window.updateArtistMiniPlayerVisibility) {
      window.updateArtistMiniPlayerVisibility();
    }

    // Mode 2: Lyrics View
    if (currentAlbumDetailMode === 2) {
      if (songsListContainer) songsListContainer.style.display = 'none';
      if (pcLyricsContainer) {
        pcLyricsContainer.style.display = 'flex';
        renderPcLyricsView();
      }
      return;
    }

    // Mode 4: Up Next / Queue View
    if (currentAlbumDetailMode === 4) {
      if (pcLyricsContainer) pcLyricsContainer.style.display = 'none';
      if (songsListContainer) {
        const hasMini = Boolean(player && player.currentTrack && window.innerWidth > 900);
        songsListContainer.className = `songs-list ${hasMini ? 'has-mini-player' : ''}`;
        songsListContainer.style.display = 'flex';
        renderPcQueueView();
      }
      return;
    }

    // Mode 3: 3-Column Grid View of this Album
    if (currentAlbumDetailMode === 3) {
      if (pcLyricsContainer) pcLyricsContainer.style.display = 'none';
      if (!songsListContainer) return;
      songsListContainer.style.display = 'flex';
      const hasMini = Boolean(player && player.currentTrack && window.innerWidth > 900);
      songsListContainer.className = `songs-list pc-masonry-grid album-songs-grid-mode ${hasMini ? 'has-mini-player' : ''}`;

      const isDark = document.body.getAttribute('data-theme') === 'dark';
      const dotsIconSrc = isDark ? 'assets/Dark Mode/DarkModeOptionsbtn.svg' : 'assets/OptionsThreeDots.svg';

      const aspectRatios = ['3 / 4', '4 / 5', '16 / 10', '16 / 11', '1 / 1', '3 / 4.2', '16 / 10', '4 / 5', '4 / 3.2', '4 / 5', '16 / 11', '1 / 1'];
      const columns = [[], [], []];

      albumTracks.forEach((track, idx) => {
        const isCurrent = player.currentTrack && track.id === player.currentTrack.id;
        const coverSrc = track.coverUrl || 'assets/atsuko-no-cover-image.svg';
        const ratio = aspectRatios[idx % aspectRatios.length];

        const cardHTML = `
          <div class="masonry-card ${isCurrent ? 'is-current' : ''}" data-id="${track.id}" data-index="${idx}">
            <div class="masonry-cover-wrapper" style="aspect-ratio: ${ratio};">
              <img src="${coverSrc}" alt="${escapeHtml(track.title)}" class="masonry-cover-img" loading="lazy" onerror="this.onerror=null;this.src='assets/atsuko-no-cover-image.svg';" />
              <div class="masonry-playing-overlay">
                <div class="masonry-play-indicator" title="Play">
                  <svg width="42" height="42" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M7.05 8.28c0-1.78 1.93-2.9 3.47-2.01l7.85 4.53c1.54.89 1.54 3.13 0 4.02l-7.85 4.53c-1.54.89-3.47-.23-3.47-2.01V8.28z"/>
                  </svg>
                </div>
              </div>
              <div class="masonry-bottom-pill">
                <span class="masonry-song-title">${escapeHtml(track.title)}</span>
                <button class="masonry-options-btn" data-id="${track.id}" title="Options" aria-label="Options">
                  <img src="${dotsIconSrc}" alt="Options" />
                </button>
              </div>
            </div>
          </div>
        `;
        columns[idx % 3].push(cardHTML);
      });

      songsListContainer.innerHTML = columns.map(colCards => `
        <div class="pc-masonry-col">
          ${colCards.join('')}
        </div>
      `).join('');

      songsListContainer.querySelectorAll('.masonry-card').forEach(card => {
        card.addEventListener('click', (e) => {
          const optionsBtn = e.target.closest('.masonry-options-btn');
          if (optionsBtn) {
            e.stopPropagation();
            const trackId = optionsBtn.dataset.id || card.dataset.id;
            if (trackId) showContextMenu(e, trackId);
            return;
          }
          const trackId = card.dataset.id;
          if (!trackId) return;
          const trackIdx = albumTracks.findIndex(t => t.id === trackId);
          if (trackIdx !== -1) {
            player.setQueue(albumTracks, trackIdx, true);
            player.updateNowPlayingUI();
          }
        });
      });
      return;
    }

    // Mode 1: List View of songs in this album
    if (pcLyricsContainer) pcLyricsContainer.style.display = 'none';
    if (!songsListContainer) return;
    songsListContainer.style.display = 'flex';
    const hasMini = Boolean(player && player.currentTrack && window.innerWidth > 900);
    songsListContainer.className = `songs-list album-songs-mode ${hasMini ? 'has-mini-player' : ''}`;

    if (albumTracks.length === 0) {
      songsListContainer.innerHTML = `
        <div class="empty-state">
          <h3 class="empty-title">No Songs in this Album</h3>
        </div>
      `;
      return;
    }

    songsListContainer.innerHTML = albumTracks.map((track, idx) => generateSongCardHTML(track, idx)).join('');
  }

  // =========================================================================
  // FAVOURITES SYSTEM VIEW CONTROLLER (PC VIEW ONLY - Image 3)
  // =========================================================================

  function populateFavouritesArtwork() {
    const favTrackIds = getFavouriteTrackIds();
    const favTracks = allTracks.filter(t => favTrackIds.includes(t.id));
    const sampleCovers = favTracks.filter(t => t.coverUrl && !t.coverUrl.includes('M logo') && !t.coverUrl.includes('Group 4')).map(t => t.coverUrl);
    const libraryCovers = allTracks.filter(t => t.coverUrl && !t.coverUrl.includes('M logo')).map(t => t.coverUrl);
    const pool = sampleCovers.length >= 5 ? sampleCovers : [...sampleCovers, ...libraryCovers];

    for (let i = 1; i <= 5; i++) {
      const img = document.getElementById(`favPillImg${i}`);
      const pill = document.getElementById(`favPill${i}`);
      if (img) {
        if (pool.length >= i) {
          img.src = pool[i - 1];
        } else if (pool.length > 0) {
          img.src = pool[(i - 1) % pool.length];
        } else {
          img.src = 'assets/atsuko.svg';
        }
      }
      if (pill && favTracks.length >= i) {
        pill.onclick = () => {
          player.setQueue(favTracks, i - 1, true);
          player.updateNowPlayingUI();
        };
      }
    }
  }

  function populateFavouritesFavAlbums() {
    const favouritesFavList = document.getElementById('favouritesFavList');
    if (!favouritesFavList) return;

    const topAlbums = getTopAlbums(2);
    if (topAlbums.length === 0) {
      favouritesFavList.innerHTML = '<span class="favourites-fav-empty">No favorite albums yet</span>';
      return;
    }

    favouritesFavList.innerHTML = topAlbums.map(album => `
      <div class="favourites-fav-item" data-album-name="${escapeHtml(album.name)}" tabindex="0" role="button">
        ${escapeHtml(album.name)}
      </div>
    `).join('');

    favouritesFavList.querySelectorAll('.favourites-fav-item').forEach(item => {
      item.addEventListener('click', () => {
        const name = item.dataset.albumName;
        if (name) renderAlbumDetailView(name);
      });
    });
  }

  function renderFavouritesView() {
    prepareViewTransition('favouritesLeftSection', ['favourites-view-active']);
    currentView = 'favourites';
    selectedAlbumName = null;
    selectedArtistName = null;
    activePlaylistId = null;

    // Synchronize navbar active states
    document.querySelectorAll('.menu-item-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.mobile-nav-btn').forEach(b => b.classList.remove('active'));

    // Header Back Button: ← Library
    updateViewSelectorLabel('Favorites');
    const libraryHeading = document.querySelector('.library-heading');
    if (libraryHeading) {
      libraryHeading.innerHTML = `
        <button class="playlist-back-btn" id="favBackBtn" title="Back to Library">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="19" y1="12" x2="5" y2="12"></line>
            <polyline points="12 19 5 12 12 5"></polyline>
          </svg>
          Library
        </button>
      `;
      const backBtn = document.getElementById('favBackBtn');
      if (backBtn) {
        backBtn.onclick = (e) => {
          e.stopPropagation();
          renderExploreView();
        };
      }
    }

    if (filterAllBtn) {
      filterAllBtn.textContent = 'All';
      filterAllBtn.classList.add('active');
    }
    if (filterColumnBtn) {
      filterColumnBtn.style.display = 'none';
    }
    if (filterShuffleBtn) {
      filterShuffleBtn.textContent = 'Shuffle';
    }

    const exploreRightNav = document.getElementById('exploreRightNav');
    if (exploreRightNav) exploreRightNav.style.display = 'none';
    const libraryEq = document.querySelector('.library-equalizer-bars');
    if (libraryEq) libraryEq.style.display = 'flex';

    // 4-Bar Equalizer
    updateFavouritesEqualizerBars();

    // Populate Left Pane Graphics & Fav Albums
    populateFavouritesArtwork();
    populateFavouritesFavAlbums();

    const favTrackIds = getFavouriteTrackIds();
    const favTracks = allTracks.filter(t => favTrackIds.includes(t.id));

    if (window.updateArtistMiniPlayerVisibility) {
      window.updateArtistMiniPlayerVisibility();
    }

    // Mode 2: Lyrics
    if (currentFavouritesMode === 2) {
      if (songsListContainer) songsListContainer.style.display = 'none';
      if (pcLyricsContainer) {
        pcLyricsContainer.style.display = 'flex';
        renderPcLyricsView();
      }
      return;
    }

    // Mode 4: Queue
    if (currentFavouritesMode === 4) {
      if (pcLyricsContainer) pcLyricsContainer.style.display = 'none';
      if (songsListContainer) {
        const hasMini = Boolean(player && player.currentTrack && window.innerWidth > 900);
        songsListContainer.className = `songs-list ${hasMini ? 'has-mini-player' : ''}`;
        songsListContainer.style.display = 'flex';
        renderPcQueueView();
      }
      return;
    }

    // Mode 3: 3-Column Grid View of Favourites
    if (currentFavouritesMode === 3) {
      if (pcLyricsContainer) pcLyricsContainer.style.display = 'none';
      if (!songsListContainer) return;
      songsListContainer.style.display = 'flex';
      const hasMini = Boolean(player && player.currentTrack && window.innerWidth > 900);
      songsListContainer.className = `songs-list pc-masonry-grid fav-songs-grid-mode ${hasMini ? 'has-mini-player' : ''}`;

      if (favTracks.length === 0) {
        songsListContainer.className = 'songs-list empty-container';
        songsListContainer.innerHTML = `
          <div class="empty-state">
            <h3 class="empty-title">No Favourites Yet</h3>
            <p class="empty-subtitle">Click the <strong>Fav.</strong> button in the player or song options to add songs here.</p>
          </div>
        `;
        return;
      }

      const isDark = document.body.getAttribute('data-theme') === 'dark';
      const dotsIconSrc = isDark ? 'assets/Dark Mode/DarkModeOptionsbtn.svg' : 'assets/OptionsThreeDots.svg';

      const aspectRatios = ['3 / 4', '4 / 5', '16 / 10', '16 / 11', '1 / 1', '3 / 4.2', '16 / 10', '4 / 5', '4 / 3.2', '4 / 5', '16 / 11', '1 / 1'];
      const columns = [[], [], []];

      favTracks.forEach((track, idx) => {
        const isCurrent = player.currentTrack && track.id === player.currentTrack.id;
        const coverSrc = track.coverUrl || 'assets/atsuko-no-cover-image.svg';
        const ratio = aspectRatios[idx % aspectRatios.length];

        const cardHTML = `
          <div class="masonry-card ${isCurrent ? 'is-current' : ''}" data-id="${track.id}" data-index="${idx}">
            <div class="masonry-cover-wrapper" style="aspect-ratio: ${ratio};">
              <img src="${coverSrc}" alt="${escapeHtml(track.title)}" class="masonry-cover-img" loading="lazy" onerror="this.onerror=null;this.src='assets/atsuko-no-cover-image.svg';" />
              <div class="masonry-playing-overlay">
                <div class="masonry-play-indicator" title="Play">
                  <svg width="42" height="42" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M7.05 8.28c0-1.78 1.93-2.9 3.47-2.01l7.85 4.53c1.54.89 1.54 3.13 0 4.02l-7.85 4.53c-1.54.89-3.47-.23-3.47-2.01V8.28z"/>
                  </svg>
                </div>
              </div>
              <div class="masonry-bottom-pill">
                <span class="masonry-song-title">${escapeHtml(track.title)}</span>
                <button class="masonry-options-btn" data-id="${track.id}" title="Options" aria-label="Options">
                  <img src="${dotsIconSrc}" alt="Options" />
                </button>
              </div>
            </div>
          </div>
        `;
        columns[idx % 3].push(cardHTML);
      });

      songsListContainer.innerHTML = columns.map(colCards => `
        <div class="pc-masonry-col">
          ${colCards.join('')}
        </div>
      `).join('');

      songsListContainer.querySelectorAll('.masonry-card').forEach(card => {
        card.addEventListener('click', (e) => {
          const optionsBtn = e.target.closest('.masonry-options-btn');
          if (optionsBtn) {
            e.stopPropagation();
            const trackId = optionsBtn.dataset.id || card.dataset.id;
            if (trackId) showContextMenu(e, trackId);
            return;
          }
          const trackId = card.dataset.id;
          if (!trackId) return;
          const trackIdx = favTracks.findIndex(t => t.id === trackId);
          if (trackIdx !== -1) {
            player.setQueue(favTracks, trackIdx, true);
            player.updateNowPlayingUI();
          }
        });
      });
      return;
    }

    // Mode 1: List View of Favourites
    if (pcLyricsContainer) pcLyricsContainer.style.display = 'none';
    if (!songsListContainer) return;
    songsListContainer.style.display = 'flex';
    const hasMini = Boolean(player && player.currentTrack && window.innerWidth > 900);
    songsListContainer.className = `songs-list fav-songs-mode ${hasMini ? 'has-mini-player' : ''}`;

    if (favTracks.length === 0) {
      songsListContainer.innerHTML = `
        <div class="empty-state">
          <h3 class="empty-title">No Favourites Yet</h3>
          <p class="empty-subtitle">Click the <strong>Fav.</strong> button in the player or song options to add songs here.</p>
        </div>
      `;
      return;
    }

    songsListContainer.innerHTML = favTracks.map((track, idx) => generateSongCardHTML(track, idx)).join('');
  }

  // =========================================================================
  // GENRE SYSTEM VIEW CONTROLLER (PC VIEW ONLY - Image 4)
  // =========================================================================

  function populateGenreArtwork(genreName) {
    const genreTracks = allTracks.filter(t => classifyTrackGenre(t) === genreName);
    const coversWithArt = genreTracks.filter(t => t.coverUrl && !t.coverUrl.includes('M logo') && !t.coverUrl.includes('Group 4')).map(t => t.coverUrl);
    const libraryCovers = allTracks.filter(t => t.coverUrl && !t.coverUrl.includes('M logo')).map(t => t.coverUrl);
    const pool = coversWithArt.length >= 3 ? coversWithArt : [...coversWithArt, ...libraryCovers];

    for (let i = 1; i <= 3; i++) {
      const img = document.getElementById(`genreCardImg${i}`);
      const card = document.getElementById(`genreCard${i}`);
      if (img) {
        if (pool.length >= i) {
          img.src = pool[i - 1];
        } else if (pool.length > 0) {
          img.src = pool[(i - 1) % pool.length];
        } else {
          img.src = 'assets/atsuko.svg';
        }
      }
      if (card && genreTracks.length >= i) {
        card.onclick = () => {
          player.setQueue(genreTracks, i - 1, true);
          player.updateNowPlayingUI();
        };
      }
    }
  }

  function renderGenreView(genreName = selectedGenre) {
    prepareViewTransition('genreLeftSection', ['genre-view-active']);
    currentView = 'genre';
    selectedGenre = genreName;
    selectedAlbumName = null;
    selectedArtistName = null;
    activePlaylistId = null;

    // Synchronize navbar active states
    document.querySelectorAll('.menu-item-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.mobile-nav-btn').forEach(b => b.classList.remove('active'));

    // Header Back Button: ← Library
    updateViewSelectorLabel('Explore / Library');
    const libraryHeading = document.querySelector('.library-heading');
    if (libraryHeading) {
      libraryHeading.innerHTML = `
        <button class="playlist-back-btn" id="genreBackBtn" title="Back to Library">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="19" y1="12" x2="5" y2="12"></line>
            <polyline points="12 19 5 12 12 5"></polyline>
          </svg>
          Library
        </button>
      `;
      const backBtn = document.getElementById('genreBackBtn');
      if (backBtn) {
        backBtn.onclick = (e) => {
          e.stopPropagation();
          renderExploreView();
        };
      }
    }

    if (filterAllBtn) {
      filterAllBtn.textContent = 'All';
      filterAllBtn.classList.add('active');
    }
    if (filterColumnBtn) {
      filterColumnBtn.style.display = 'none';
    }
    if (filterShuffleBtn) {
      filterShuffleBtn.textContent = 'Shuffle';
    }

    const exploreRightNav = document.getElementById('exploreRightNav');
    if (exploreRightNav) exploreRightNav.style.display = 'none';
    const libraryEq = document.querySelector('.library-equalizer-bars');
    if (libraryEq) libraryEq.style.display = 'flex';

    // 4-Bar Equalizer
    updateGenreEqualizerBars();

    // Populate Left Pane 3 Cards Artwork
    populateGenreArtwork(genreName);

    // Update Genre Chips Active State and attach click listeners
    const chips = document.querySelectorAll('.genre-chip');
    chips.forEach(chip => {
      const g = chip.dataset.genre;
      chip.classList.toggle('active', g === genreName);
      chip.onclick = () => {
        renderGenreView(g);
      };
    });

    const genreTracks = allTracks.filter(t => classifyTrackGenre(t) === genreName);

    if (window.updateArtistMiniPlayerVisibility) {
      window.updateArtistMiniPlayerVisibility();
    }

    // Mode 2: Lyrics
    if (currentGenreMode === 2) {
      if (songsListContainer) songsListContainer.style.display = 'none';
      if (pcLyricsContainer) {
        pcLyricsContainer.style.display = 'flex';
        renderPcLyricsView();
      }
      return;
    }

    // Mode 4: Queue
    if (currentGenreMode === 4) {
      if (pcLyricsContainer) pcLyricsContainer.style.display = 'none';
      if (songsListContainer) {
        const hasMini = Boolean(player && player.currentTrack && window.innerWidth > 900);
        songsListContainer.className = `songs-list ${hasMini ? 'has-mini-player' : ''}`;
        songsListContainer.style.display = 'flex';
        renderPcQueueView();
      }
      return;
    }

    // Mode 3: 3-Column Grid View of Genre
    if (currentGenreMode === 3) {
      if (pcLyricsContainer) pcLyricsContainer.style.display = 'none';
      if (!songsListContainer) return;
      songsListContainer.style.display = 'flex';
      const hasMini = Boolean(player && player.currentTrack && window.innerWidth > 900);
      songsListContainer.className = `songs-list pc-masonry-grid genre-songs-grid-mode ${hasMini ? 'has-mini-player' : ''}`;

      if (genreTracks.length === 0) {
        songsListContainer.className = 'songs-list empty-container';
        songsListContainer.innerHTML = `
          <div class="empty-state">
            <h3 class="empty-title">No Songs in ${escapeHtml(genreName)}</h3>
            <p class="empty-subtitle">Songs matching this genre will appear here automatically.</p>
          </div>
        `;
        return;
      }

      const isDark = document.body.getAttribute('data-theme') === 'dark';
      const dotsIconSrc = isDark ? 'assets/Dark Mode/DarkModeOptionsbtn.svg' : 'assets/OptionsThreeDots.svg';

      const aspectRatios = ['3 / 4', '4 / 5', '16 / 10', '16 / 11', '1 / 1', '3 / 4.2', '16 / 10', '4 / 5', '4 / 3.2', '4 / 5', '16 / 11', '1 / 1'];
      const columns = [[], [], []];

      genreTracks.forEach((track, idx) => {
        const isCurrent = player.currentTrack && track.id === player.currentTrack.id;
        const coverSrc = track.coverUrl || 'assets/atsuko-no-cover-image.svg';
        const ratio = aspectRatios[idx % aspectRatios.length];

        const cardHTML = `
          <div class="masonry-card ${isCurrent ? 'is-current' : ''}" data-id="${track.id}" data-index="${idx}">
            <div class="masonry-cover-wrapper" style="aspect-ratio: ${ratio};">
              <img src="${coverSrc}" alt="${escapeHtml(track.title)}" class="masonry-cover-img" loading="lazy" onerror="this.onerror=null;this.src='assets/atsuko-no-cover-image.svg';" />
              <div class="masonry-playing-overlay">
                <div class="masonry-play-indicator" title="Play">
                  <svg width="42" height="42" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M7.05 8.28c0-1.78 1.93-2.9 3.47-2.01l7.85 4.53c1.54.89 1.54 3.13 0 4.02l-7.85 4.53c-1.54.89-3.47-.23-3.47-2.01V8.28z"/>
                  </svg>
                </div>
              </div>
              <div class="masonry-bottom-pill">
                <span class="masonry-song-title">${escapeHtml(track.title)}</span>
                <button class="masonry-options-btn" data-id="${track.id}" title="Options" aria-label="Options">
                  <img src="${dotsIconSrc}" alt="Options" />
                </button>
              </div>
            </div>
          </div>
        `;
        columns[idx % 3].push(cardHTML);
      });

      songsListContainer.innerHTML = columns.map(colCards => `
        <div class="pc-masonry-col">
          ${colCards.join('')}
        </div>
      `).join('');

      songsListContainer.querySelectorAll('.masonry-card').forEach(card => {
        card.addEventListener('click', (e) => {
          const optionsBtn = e.target.closest('.masonry-options-btn');
          if (optionsBtn) {
            e.stopPropagation();
            const trackId = optionsBtn.dataset.id || card.dataset.id;
            if (trackId) showContextMenu(e, trackId);
            return;
          }
          const trackId = card.dataset.id;
          if (!trackId) return;
          const trackIdx = genreTracks.findIndex(t => t.id === trackId);
          if (trackIdx !== -1) {
            player.setQueue(genreTracks, trackIdx, true);
            player.updateNowPlayingUI();
          }
        });
      });
      return;
    }

    // Mode 1: List View of Genre Songs
    if (pcLyricsContainer) pcLyricsContainer.style.display = 'none';
    if (!songsListContainer) return;
    songsListContainer.style.display = 'flex';
    const hasMini = Boolean(player && player.currentTrack && window.innerWidth > 900);
    songsListContainer.className = `songs-list genre-songs-mode ${hasMini ? 'has-mini-player' : ''}`;

    if (genreTracks.length === 0) {
      songsListContainer.innerHTML = `
        <div class="empty-state">
          <h3 class="empty-title">No Songs in ${escapeHtml(genreName)}</h3>
          <p class="empty-subtitle">Songs categorized under ${escapeHtml(genreName)} will appear here.</p>
        </div>
      `;
      return;
    }

    songsListContainer.innerHTML = genreTracks.map((track, idx) => generateSongCardHTML(track, idx)).join('');
  }

  // Album context menu for 3-dots on album cards
  const albumContextMenu = document.getElementById('albumContextMenu');
  function showAlbumContextMenu(e, albumName) {
    albumContextMenuTargetName = albumName;
    if (!albumContextMenu) return;

    let clientX = e.clientX;
    let clientY = e.clientY;
    if ((clientX === undefined || clientY === undefined) && e.touches && e.touches[0]) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    }
    if (clientX === undefined || clientY === undefined) {
      const target = e.currentTarget || e.target;
      if (target && target.getBoundingClientRect) {
        const r = target.getBoundingClientRect();
        clientX = r.left + r.width / 2;
        clientY = r.bottom;
      } else {
        clientX = window.innerWidth / 2;
        clientY = window.innerHeight / 2;
      }
    }

    const x = Math.min(window.innerWidth - 190, Math.max(10, clientX - 80));
    const y = Math.min(window.innerHeight - 150, Math.max(10, clientY + 8));

    albumContextMenu.style.left = `${x}px`;
    albumContextMenu.style.top = `${y}px`;
    albumContextMenu.classList.add('open');
  }

  // =========================================================================
  // FOLDERS SYSTEM VIEW CONTROLLERS (PC VIEW ONLY)
  // Matching Master Folders Specification & UI Reference
  // =========================================================================

  function getFoldersList() {
    // Initial folder: All Songs contains all library tracks
    const allSongsPlayCount = allTracks.reduce((sum, t) => sum + (t.playCount || 0), 0);
    const folders = [
      {
        id: 'all_songs',
        name: 'All Songs',
        isSystem: true,
        tracks: allTracks,
        playCount: allSongsPlayCount
      }
    ];
    return folders;
  }

  function getTopFolders(count = 2) {
    const folders = getFoldersList();
    folders.sort((a, b) => (b.playCount - a.playCount) || (b.tracks.length - a.tracks.length));
    return folders.slice(0, count);
  }

  function getFolderTopSongs(folderName, count = 2) {
    const folders = getFoldersList();
    const folder = folders.find(f => f.name.toLowerCase() === (folderName || '').toLowerCase()) || folders[0];
    const songs = [...(folder ? folder.tracks : allTracks)];
    songs.sort((a, b) => (b.playCount || 0) - (a.playCount || 0));
    return songs.slice(0, count);
  }

  function populateFoldersMainArtwork() {
    const folderImgs = [
      document.getElementById('folderMainImg1'),
      document.getElementById('folderMainImg2'),
      document.getElementById('folderMainImg3'),
      document.getElementById('folderMainImg4')
    ];

    const availableCovers = allTracks.filter(t => t.coverUrl && !t.coverUrl.includes('M logo')).map(t => t.coverUrl);
    const shuffledCovers = [...availableCovers].sort(() => 0.5 - Math.random());

    folderImgs.forEach((img, idx) => {
      if (img) {
        if (shuffledCovers.length > idx) {
          img.src = shuffledCovers[idx];
        } else if (availableCovers.length > 0) {
          img.src = availableCovers[idx % availableCovers.length];
        } else {
          img.src = 'assets/atsuko.svg';
        }
      }
    });
  }

  function populateFolderDetailArtwork(folderName) {
    const folderImgs = [
      document.getElementById('folderDetailImg1'),
      document.getElementById('folderDetailImg2'),
      document.getElementById('folderDetailImg3'),
      document.getElementById('folderDetailImg4')
    ];

    const folders = getFoldersList();
    const folder = folders.find(f => f.name.toLowerCase() === (folderName || '').toLowerCase()) || folders[0];
    const tracks = folder ? folder.tracks : allTracks;
    const availableCovers = tracks.filter(t => t.coverUrl && !t.coverUrl.includes('M logo')).map(t => t.coverUrl);
    const shuffledCovers = [...availableCovers].sort(() => 0.5 - Math.random());

    folderImgs.forEach((img, idx) => {
      if (img) {
        if (shuffledCovers.length > idx) {
          img.src = shuffledCovers[idx];
        } else if (availableCovers.length > 0) {
          img.src = availableCovers[idx % availableCovers.length];
        } else {
          img.src = 'assets/atsuko.svg';
        }
      }
    });
  }

  function populateFavFolders() {
    const favList = document.getElementById('foldersFavList');
    if (!favList) return;

    const topFolders = getTopFolders(2);
    if (topFolders.length === 0) {
      favList.innerHTML = '<span class="folders-fav-item" style="cursor: default; opacity: 0.6;">No folders available</span>';
      return;
    }

    favList.innerHTML = topFolders.map(folder => `
      <span class="folders-fav-item" data-folder-name="${escapeHtml(folder.name)}">${escapeHtml(folder.name)}</span>
    `).join('');

    favList.querySelectorAll('.folders-fav-item').forEach(item => {
      item.addEventListener('click', (e) => {
        const name = e.currentTarget.dataset.folderName;
        if (name) renderFolderDetailView(name);
      });
    });
  }

  function renderFoldersMainView() {
    currentView = 'folders_main';
    selectedFolderName = null;
    activePlaylistId = null;

    // Synchronize navbar active states
    document.querySelectorAll('.menu-item-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.mobile-nav-btn').forEach(b => b.classList.remove('active'));

    // Header label
    updateViewSelectorLabel('Explore / Library');

    // Header Back Button in right pane: ← Library
    const libraryHeading = document.querySelector('.library-heading');
    if (libraryHeading) {
      libraryHeading.innerHTML = `
        <button class="playlist-back-btn" id="foldersBackBtn" title="Back to Library">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="19" y1="12" x2="5" y2="12"></line>
            <polyline points="12 19 5 12 12 5"></polyline>
          </svg>
          Library
        </button>
      `;
      const backBtn = document.getElementById('foldersBackBtn');
      if (backBtn) {
        backBtn.onclick = (e) => {
          e.stopPropagation();
          renderExploreView();
        };
      }
    }

    // Toggle Folders view active on player body & left sections
    prepareViewTransition('foldersLeftSection', ['folders-view-active', 'folders-main-active']);

    const foldersMainLeft = document.getElementById('foldersMainLeft');
    const folderDetailLeft = document.getElementById('folderDetailLeft');
    if (foldersMainLeft) foldersMainLeft.style.display = 'flex';
    if (folderDetailLeft) folderDetailLeft.style.display = 'none';

    // Filter pills (All | Shuffle)
    if (filterAllBtn) {
      filterAllBtn.textContent = 'All';
      filterAllBtn.classList.add('active');
    }
    if (filterColumnBtn) {
      filterColumnBtn.style.display = 'none';
      filterColumnBtn.classList.remove('active');
    }
    if (filterShuffleBtn) {
      filterShuffleBtn.textContent = 'Shuffle';
      filterShuffleBtn.classList.remove('active');
    }

    const exploreRightNav = document.getElementById('exploreRightNav');
    if (exploreRightNav) exploreRightNav.style.display = 'none';
    const libraryEq = document.querySelector('.library-equalizer-bars');
    if (libraryEq) libraryEq.style.display = 'none';
    if (pcLyricsContainer) pcLyricsContainer.style.display = 'none';

    // Populate Left Graphics & Favorites
    populateFoldersMainArtwork();
    populateFavFolders();

    // Render Right side 3-column folder grid
    renderFoldersGridView();

    if (window.updateArtistMiniPlayerVisibility) {
      window.updateArtistMiniPlayerVisibility();
    }
  }

  function renderFoldersGridView() {
    if (!songsListContainer) return;
    songsListContainer.style.display = 'flex';
    const hasMini = Boolean(player && player.currentTrack && window.innerWidth > 900);
    songsListContainer.className = `songs-list folders-grid ${hasMini ? 'has-mini-player' : ''}`;

    const folders = getFoldersList();
    if (folders.length === 0) {
      songsListContainer.className = 'songs-list empty-container';
      songsListContainer.innerHTML = `
        <div class="empty-state">
          <h3 class="empty-title">No Folders Found</h3>
          <p class="empty-subtitle">Your library folders will appear here.</p>
        </div>
      `;
      return;
    }

    const isDark = (document.body.getAttribute('data-theme') || currentTheme) === 'dark';
    const dotsIconSrc = isDark ? 'assets/Dark Mode/DarkModeOptionsbtn.svg' : 'assets/OptionsThreeDots.svg';

    songsListContainer.innerHTML = folders.map(folder => {
      const hasSongs = folder.tracks && folder.tracks.length > 0;
      return `
        <div class="folder-card-item" data-folder-id="${escapeHtml(folder.id)}" data-folder-name="${escapeHtml(folder.name)}" tabindex="0" role="button" title="${escapeHtml(folder.name)} (${folder.tracks.length} songs)">
          <div class="folder-card-graphic">
            <div class="folder-svg-stack card-stack">
              <img src="assets/LibraryItems/FolderBg.svg" class="folder-layer folder-layer-bg" alt="Folder Background" />
              ${hasSongs ? '<img src="assets/LibraryItems/FolderFilled.svg" class="folder-layer folder-layer-filled" alt="Folder Filled" />' : ''}
              <img src="assets/LibraryItems/FolderTop.svg" class="folder-layer folder-layer-top" alt="Folder Top" />
            </div>
          </div>
          <div class="folder-card-meta">
            <span class="folder-card-name">${escapeHtml(folder.name)}</span>
            <button class="folder-card-options-btn" data-folder-id="${escapeHtml(folder.id)}" title="Folder options" aria-label="Folder options">
              <img src="${dotsIconSrc}" alt="Options" style="width: 14px; height: 14px; display: block;" />
            </button>
          </div>
        </div>
      `;
    }).join('');

    // Attach click and double-click listeners
    songsListContainer.querySelectorAll('.folder-card-item').forEach(card => {
      card.addEventListener('click', (e) => {
        const optBtn = e.target.closest('.folder-card-options-btn');
        if (optBtn) {
          e.stopPropagation();
          const folderId = optBtn.dataset.folderId || card.dataset.folderId;
          showFolderContextMenu(e, folderId);
          return;
        }
        const name = card.dataset.folderName;
        if (name) renderFolderDetailView(name);
      });

      card.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        const name = card.dataset.folderName;
        if (name) renderFolderDetailView(name);
      });
    });
  }

  // Folder Context Menu
  let activeContextFolderId = null;
  const folderContextMenu = document.getElementById('folderContextMenu');

  function showFolderContextMenu(e, folderId) {
    activeContextFolderId = folderId;
    if (!folderContextMenu) return;

    let clientX = e.clientX;
    let clientY = e.clientY;
    if (clientX === undefined || clientY === undefined) {
      const rect = e.currentTarget ? e.currentTarget.getBoundingClientRect() : { left: 100, top: 100 };
      clientX = rect.left;
      clientY = rect.top;
    }

    folderContextMenu.style.left = `${Math.min(clientX, window.innerWidth - 180)}px`;
    folderContextMenu.style.top = `${Math.min(clientY, window.innerHeight - 120)}px`;
    folderContextMenu.classList.add('open');
  }

  if (folderContextMenu) {
    folderContextMenu.addEventListener('click', (e) => {
      const item = e.target.closest('.context-item');
      if (!item) return;
      const action = item.dataset.action;
      const folders = getFoldersList();
      const folder = folders.find(f => f.id === activeContextFolderId) || folders[0];

      if (action === 'play-folder') {
        if (folder && folder.tracks && folder.tracks.length > 0) {
          player.setQueue(folder.tracks, 0, true);
          player.updateNowPlayingUI();
          showToast(`Playing ${folder.name}`);
        } else {
          showToast('Folder has no songs');
        }
      } else if (action === 'delete-folder') {
        if (folder && folder.isSystem) {
          showToast('All Songs is a protected system folder and cannot be deleted');
        } else {
          showToast('Folder deleted');
        }
      }
      folderContextMenu.classList.remove('open');
    });
  }

  function renderFolderDetailView(folderName = 'All Songs') {
    currentView = 'folder_detail';
    selectedFolderName = folderName;
    activePlaylistId = null;

    // Header Back Button in right pane: ← Folders
    const libraryHeading = document.querySelector('.library-heading');
    if (libraryHeading) {
      libraryHeading.innerHTML = `
        <button class="playlist-back-btn" id="folderDetailBackBtn" title="Back to Folders">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="19" y1="12" x2="5" y2="12"></line>
            <polyline points="12 19 5 12 12 5"></polyline>
          </svg>
          Folders
        </button>
      `;
      const backBtn = document.getElementById('folderDetailBackBtn');
      if (backBtn) {
        backBtn.onclick = (e) => {
          e.stopPropagation();
          renderFoldersMainView();
        };
      }
    }

    // Left side: Toggle folders detail view active on player body & left sections
    prepareViewTransition('foldersLeftSection', ['folders-view-active', 'folder-detail-active']);

    const foldersMainLeft = document.getElementById('foldersMainLeft');
    const folderDetailLeft = document.getElementById('folderDetailLeft');
    if (foldersMainLeft) foldersMainLeft.style.display = 'none';
    if (folderDetailLeft) folderDetailLeft.style.display = 'flex';

    // Filter pills (All | Shuffle)
    if (filterAllBtn) {
      filterAllBtn.textContent = 'All';
      filterAllBtn.classList.add('active');
    }
    if (filterColumnBtn) {
      filterColumnBtn.style.display = 'none';
    }
    if (filterShuffleBtn) {
      filterShuffleBtn.textContent = 'Shuffle';
    }

    const exploreRightNav = document.getElementById('exploreRightNav');
    if (exploreRightNav) exploreRightNav.style.display = 'none';
    const libraryEq = document.querySelector('.library-equalizer-bars');
    if (libraryEq) libraryEq.style.display = 'flex';

    // 4-Bar Equalizer
    updateFoldersEqualizerBars();

    // Populate Left Pane graphics & Fav songs
    const folders = getFoldersList();
    const folder = folders.find(f => f.name.toLowerCase() === folderName.toLowerCase()) || folders[0];
    const folderTracks = folder ? folder.tracks : allTracks;
    const hasSongs = folderTracks.length > 0;

    populateFolderDetailArtwork(folderName);

    const favSongsList = document.getElementById('folderDetailFavList');
    if (favSongsList) {
      const topSongs = getFolderTopSongs(folderName, 2);
      if (topSongs.length === 0) {
        favSongsList.innerHTML = '<span class="folders-fav-item" style="cursor: default; opacity: 0.6;">No songs available</span>';
      } else {
        favSongsList.innerHTML = topSongs.map(t => `
          <span class="folders-fav-item" data-track-id="${escapeHtml(t.id)}">${escapeHtml(t.title)}</span>
        `).join('');

        favSongsList.querySelectorAll('.folders-fav-item').forEach(item => {
          item.addEventListener('click', (e) => {
            const trackId = e.currentTarget.dataset.trackId;
            const idx = folderTracks.findIndex(t => t.id === trackId);
            if (idx !== -1) {
              player.setQueue(folderTracks, idx, true);
              player.updateNowPlayingUI();
            }
          });
        });
      }
    }

    if (window.updateArtistMiniPlayerVisibility) {
      window.updateArtistMiniPlayerVisibility();
    }

    // Mode 2: Lyrics
    if (currentFoldersPcMode === 2) {
      if (songsListContainer) songsListContainer.style.display = 'none';
      if (pcLyricsContainer) {
        pcLyricsContainer.style.display = 'flex';
        renderPcLyricsView();
      }
      return;
    }

    // Mode 4: Queue
    if (currentFoldersPcMode === 4) {
      if (pcLyricsContainer) pcLyricsContainer.style.display = 'none';
      if (songsListContainer) {
        const hasMini = Boolean(player && player.currentTrack && window.innerWidth > 900);
        songsListContainer.className = `songs-list ${hasMini ? 'has-mini-player' : ''}`;
        songsListContainer.style.display = 'flex';
        renderPcQueueView();
      }
      return;
    }

    // Mode 3: 3-Column Grid View of Folder
    if (currentFoldersPcMode === 3) {
      if (pcLyricsContainer) pcLyricsContainer.style.display = 'none';
      if (!songsListContainer) return;
      songsListContainer.style.display = 'flex';
      const hasMini = Boolean(player && player.currentTrack && window.innerWidth > 900);
      songsListContainer.className = `songs-list pc-masonry-grid folder-songs-grid-mode ${hasMini ? 'has-mini-player' : ''}`;

      if (folderTracks.length === 0) {
        songsListContainer.className = 'songs-list empty-container';
        songsListContainer.innerHTML = `
          <div class="empty-state">
            <h3 class="empty-title">No Songs in ${escapeHtml(folderName)}</h3>
            <p class="empty-subtitle">Songs in this folder will appear here automatically.</p>
          </div>
        `;
        return;
      }

      const isDark = (document.body.getAttribute('data-theme') || currentTheme) === 'dark';
      const dotsIconSrc = isDark ? 'assets/Dark Mode/DarkModeOptionsbtn.svg' : 'assets/OptionsThreeDots.svg';

      const aspectRatios = ['3 / 4', '4 / 5', '16 / 10', '16 / 11', '1 / 1', '3 / 4.2', '16 / 10', '4 / 5', '4 / 3.2', '4 / 5', '16 / 11', '1 / 1'];
      const columns = [[], [], []];

      folderTracks.forEach((track, idx) => {
        const isCurrent = player.currentTrack && track.id === player.currentTrack.id;
        const coverSrc = track.coverUrl || 'assets/atsuko-no-cover-image.svg';
        const ratio = aspectRatios[idx % aspectRatios.length];
        const isLandscape = ratio.startsWith('16');
        const cardHtml = `
          <div class="masonry-card ${isCurrent ? 'is-current' : ''}" data-id="${track.id}" style="aspect-ratio: ${ratio};">
            <img src="${coverSrc}" alt="${escapeHtml(track.title)}" class="masonry-card-img" />
            <div class="masonry-overlay">
              <div class="masonry-play-btn" data-id="${track.id}">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                  <polygon points="6 3 20 12 6 21 6 3"/>
                </svg>
              </div>
              ${isLandscape ? `
                <div class="masonry-card-info">
                  <span class="masonry-card-title">${escapeHtml(track.title)}</span>
                  <span class="masonry-card-artist">${escapeHtml(track.artist || 'Unknown')}</span>
                </div>
              ` : ''}
              <button class="masonry-options-btn" data-id="${track.id}" title="Options" aria-label="Options">
                <img src="${dotsIconSrc}" alt="Options" />
              </button>
            </div>
          </div>
        `;
        columns[idx % 3].push(cardHtml);
      });

      songsListContainer.innerHTML = `
        <div class="masonry-column">${columns[0].join('')}</div>
        <div class="masonry-column">${columns[1].join('')}</div>
        <div class="masonry-column">${columns[2].join('')}</div>
      `;

      songsListContainer.querySelectorAll('.masonry-card').forEach(card => {
        card.addEventListener('click', (e) => {
          const optionsBtn = e.target.closest('.masonry-options-btn');
          if (optionsBtn) {
            e.stopPropagation();
            const trackId = optionsBtn.dataset.id || card.dataset.id;
            if (trackId) showContextMenu(e, trackId);
            return;
          }
          const trackId = card.dataset.id;
          if (!trackId) return;
          const trackIdx = folderTracks.findIndex(t => t.id === trackId);
          if (trackIdx !== -1) {
            player.setQueue(folderTracks, trackIdx, true);
            player.updateNowPlayingUI();
          }
        });
      });
      return;
    }

    // Mode 1: Standard List View of Folder
    if (pcLyricsContainer) pcLyricsContainer.style.display = 'none';
    if (!songsListContainer) return;
    songsListContainer.style.display = 'flex';
    const hasMini = Boolean(player && player.currentTrack && window.innerWidth > 900);
    songsListContainer.className = `songs-list folder-songs-list-mode ${hasMini ? 'has-mini-player' : ''}`;

    if (folderTracks.length === 0) {
      songsListContainer.className = 'songs-list empty-container';
      songsListContainer.innerHTML = `
        <div class="empty-state">
          <h3 class="empty-title">No Songs in ${escapeHtml(folderName)}</h3>
          <p class="empty-subtitle">Songs in this folder will appear here automatically.</p>
        </div>
      `;
      return;
    }

    songsListContainer.innerHTML = folderTracks.map(track => {
      const isCurrent = player.currentTrack && track.id === player.currentTrack.id;
      const isSelected = selectedTrackIds.has(track.id);
      return renderSongItemHTML(track, isCurrent, isSelected);
    }).join('');

    attachSongItemEventListeners(songsListContainer, folderTracks);
  }

  // =========================================================================
  // RECORDER SYSTEM CONTROLLER (PC VIEW ONLY)
  // Matching Master Specification & UI Reference (media_1789734607757.png)
  // =========================================================================
  let currentRecorderPcMode = 1; // 1 = List View, 2 = Grid / Column View
  let isRecordingAudio = false;
  let audioMediaRecorder = null;
  let audioRecordStream = null;
  let recordedAudioChunks = [];
  let recordingIndicatorInterval = null;
  let recordingIndicatorState = false;
  let recordingStartTime = null;
  let activeRecordingContextMenuId = null;

  // Verify permission on directory handle
  async function verifyDirectoryPermission(fileHandle, readWrite = true) {
    if (!fileHandle) return false;
    const options = {};
    if (readWrite) {
      options.mode = 'readwrite';
    }
    try {
      if ((await fileHandle.queryPermission(options)) === 'granted') {
        return true;
      }
      if ((await fileHandle.requestPermission(options)) === 'granted') {
        return true;
      }
    } catch (e) {
      console.warn('Error querying permission on handle:', e);
    }
    return false;
  }

  // Get or prompt user for recordings directory handle
  async function getRecordingDirectoryHandle(forcePrompt = false) {
    try {
      if (!forcePrompt && 'showDirectoryPicker' in window) {
        const savedHandle = await fileManager.getSetting('recorder_directory_handle');
        if (savedHandle) {
          const hasPerm = await verifyDirectoryPermission(savedHandle, true);
          if (hasPerm) return savedHandle;
        }
      }

      if ('showDirectoryPicker' in window) {
        const handle = await window.showDirectoryPicker({
          id: 'musico_recordings_folder',
          mode: 'readwrite',
          startIn: 'music'
        });
        if (handle) {
          await fileManager.saveSetting('recorder_directory_handle', handle);
          return handle;
        }
      }
    } catch (err) {
      if (err && err.name !== 'AbortError') {
        console.warn('Directory picker error:', err);
      }
    }
    return null;
  }

  async function selectRecordingFolder() {
    const handle = await getRecordingDirectoryHandle(true);
    if (handle) {
      showToast(`Selected folder: ${handle.name}`);
      if (currentView === 'recorder') {
        renderRecorderView();
      }
    }
  }

  // Calculate collision-free sequential recording file name: Recording 1.mp3, Recording 2.mp3, etc.
  async function getNextRecordingFileName() {
    const recordings = await fileManager.getRecordings();
    let maxNumber = 0;
    recordings.forEach(r => {
      const match = (r.title || '').match(/(?:Recording|Rec\.?)\s*(\d+)/i);
      if (match && match[1]) {
        const num = parseInt(match[1], 10);
        if (num > maxNumber) maxNumber = num;
      }
    });
    const nextNum = maxNumber + 1;
    return {
      fileName: `Recording ${nextNum}.mp3`,
      title: `Rec. ${nextNum}`,
      number: nextNum
    };
  }

  // Format date: e.g. "27 July 2026"
  function formatRecordingDate(date = new Date()) {
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`;
  }

  async function startAudioRecording() {
    if (isRecordingAudio) return;

    try {
      // 1. Request microphone access
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        showToast('Microphone access is not supported on this browser.');
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioRecordStream = stream;

      // 2. Determine best supported audio format
      let mimeType = 'audio/webm;codecs=opus';
      if (typeof MediaRecorder !== 'undefined') {
        if (!MediaRecorder.isTypeSupported(mimeType)) {
          if (MediaRecorder.isTypeSupported('audio/webm')) mimeType = 'audio/webm';
          else if (MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')) mimeType = 'audio/ogg;codecs=opus';
          else if (MediaRecorder.isTypeSupported('audio/mp4')) mimeType = 'audio/mp4';
          else mimeType = '';
        }
      }

      recordedAudioChunks = [];
      audioMediaRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      recordingStartTime = Date.now();

      audioMediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          recordedAudioChunks.push(event.data);
        }
      };

      audioMediaRecorder.onstop = async () => {
        const recordingDuration = Math.max(1, Math.round((Date.now() - recordingStartTime) / 1000));
        const audioBlob = new Blob(recordedAudioChunks, { type: audioMediaRecorder.mimeType || 'audio/webm' });
        
        // Stop all audio tracks
        if (audioRecordStream) {
          audioRecordStream.getTracks().forEach(track => track.stop());
          audioRecordStream = null;
        }

        const { fileName, title } = await getNextRecordingFileName();
        const dateStr = formatRecordingDate(new Date());

        // Attempt to save to local folder if handle is available
        let savedToDisk = false;
        try {
          const dirHandle = await getRecordingDirectoryHandle(false);
          if (dirHandle) {
            const fileHandle = await dirHandle.getFileHandle(fileName, { create: true });
            const writable = await fileHandle.createWritable();
            await writable.write(audioBlob);
            await writable.close();
            savedToDisk = true;
          }
        } catch (err) {
          console.warn('Could not write recording directly to folder handle:', err);
        }

        // Create Musico track & recording record
        const recordId = 'rec_' + Date.now();
        const recordingObj = {
          id: recordId,
          title: title,
          artist: 'Voice Recording',
          album: 'Recordings',
          duration: recordingDuration,
          date: dateStr,
          timestamp: Date.now(),
          fileName: fileName,
          fileBlob: audioBlob,
          isRecording: true
        };

        await fileManager.saveRecording(recordingObj);
        await fileManager.saveTrack(recordingObj);

        // Add to active library
        allTracks.unshift(recordingObj);

        showToast(`Saved ${title} (${savedToDisk ? 'Folder & Library' : 'Library'})`);

        if (currentView === 'recorder') {
          renderRecorderView();
        }
      };

      // 3. Update UI to recording state
      isRecordingAudio = true;
      const widget = document.getElementById('recorderGraphicWidget');
      if (widget) widget.classList.add('is-recording');

      const actionBtnImg = document.getElementById('recorderActionBtnImg');
      if (actionBtnImg) {
        actionBtnImg.src = 'assets/LibraryItems/RecordingsUI/StopRecordingBtn.svg';
      }

      const actionBtn = document.getElementById('recorderActionBtn');
      if (actionBtn) {
        actionBtn.title = 'Stop Recording';
        actionBtn.setAttribute('aria-label', 'Stop Recording');
      }

      const indicatorImg = document.getElementById('recorderIndicatorImg');
      recordingIndicatorState = false;
      if (recordingIndicatorInterval) clearInterval(recordingIndicatorInterval);
      recordingIndicatorInterval = setInterval(() => {
        recordingIndicatorState = !recordingIndicatorState;
        if (indicatorImg) {
          indicatorImg.src = recordingIndicatorState
            ? 'assets/LibraryItems/RecordingsUI/RedCircleWhileRecording.svg'
            : 'assets/LibraryItems/RecordingsUI/NormalRedCircle.svg';
        }
      }, 500);

      audioMediaRecorder.start(250);
      showToast('Recording started...');
    } catch (err) {
      console.warn('Microphone start error:', err);
      showToast(err.name === 'NotAllowedError' ? 'Microphone permission denied.' : 'Could not access microphone.');
      stopAudioRecordingUI();
    }
  }

  function stopAudioRecordingUI() {
    isRecordingAudio = false;
    const widget = document.getElementById('recorderGraphicWidget');
    if (widget) widget.classList.remove('is-recording');

    const actionBtnImg = document.getElementById('recorderActionBtnImg');
    if (actionBtnImg) {
      actionBtnImg.src = 'assets/LibraryItems/RecordingsUI/StartRecordingBtn.svg';
    }

    const actionBtn = document.getElementById('recorderActionBtn');
    if (actionBtn) {
      actionBtn.title = 'Start Recording';
      actionBtn.setAttribute('aria-label', 'Start Recording');
    }

    if (recordingIndicatorInterval) {
      clearInterval(recordingIndicatorInterval);
      recordingIndicatorInterval = null;
    }

    const indicatorImg = document.getElementById('recorderIndicatorImg');
    if (indicatorImg) {
      indicatorImg.src = 'assets/LibraryItems/RecordingsUI/NormalRedCircle.svg';
    }
  }

  function stopAudioRecording() {
    if (!isRecordingAudio) return;
    stopAudioRecordingUI();
    if (audioMediaRecorder && audioMediaRecorder.state !== 'inactive') {
      audioMediaRecorder.stop();
    }
  }

  // Update 2-Bar Equalizer for Recorder: Bar 1 (List), Bar 2 (Grid)
  function updateRecorderEqualizerBars() {
    const eqBarsContainer = document.querySelector('.library-equalizer-bars') || document.getElementById('libraryEqualizerBars');
    if (eqBarsContainer) eqBarsContainer.style.display = 'flex';

    const eqBar1 = document.getElementById('eqBar1');
    const eqBar2 = document.getElementById('eqBar2');
    const eqBar3 = document.getElementById('eqBar3');
    const eqBar4 = document.getElementById('eqBar4');

    if (eqBar1) {
      eqBar1.style.display = '';
      eqBar1.classList.toggle('active', currentRecorderPcMode === 1);
      eqBar1.setAttribute('title', 'Recorder List View (A/D)');
      eqBar1.setAttribute('aria-label', 'Recorder List View');
    }
    if (eqBar2) {
      eqBar2.style.display = '';
      eqBar2.classList.toggle('active', currentRecorderPcMode === 2);
      eqBar2.setAttribute('title', 'Recorder Grid View (A/D)');
      eqBar2.setAttribute('aria-label', 'Recorder Grid View');
    }
    if (eqBar3) eqBar3.style.display = 'none';
    if (eqBar4) eqBar4.style.display = 'none';
  }

  async function renderRecorderView() {
    currentView = 'recorder';
    selectedArtistName = null;
    selectedAlbumName = null;
    selectedFolderName = null;
    selectedGenre = null;
    activePlaylistId = null;

    // Synchronize navbar active states
    document.querySelectorAll('.menu-item-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.mobile-nav-btn').forEach(b => b.classList.remove('active'));

    // Header label
    updateViewSelectorLabel('Explore / Library');

    // Header Back Button in right pane: ← Library
    const libraryHeading = document.querySelector('.library-heading');
    if (libraryHeading) {
      libraryHeading.innerHTML = `
        <button class="playlist-back-btn" id="recorderBackBtn" title="Back to Library">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="19" y1="12" x2="5" y2="12"></line>
            <polyline points="12 19 5 12 12 5"></polyline>
          </svg>
          Library
        </button>
      `;
      const backBtn = document.getElementById('recorderBackBtn');
      if (backBtn) {
        backBtn.onclick = (e) => {
          e.stopPropagation();
          renderExploreView();
        };
      }
    }

    // Left side: Toggle recorder view active on player body & left sections
    prepareViewTransition('recorderLeftSection', ['recorder-view-active']);

    // Filter pills (All | Shuffle)
    if (filterAllBtn) {
      filterAllBtn.textContent = 'All';
      filterAllBtn.classList.add('active');
    }
    if (filterColumnBtn) {
      filterColumnBtn.style.display = 'none';
    }
    if (filterShuffleBtn) {
      filterShuffleBtn.textContent = 'Shuffle';
      filterShuffleBtn.classList.remove('active');
    }

    const exploreRightNav = document.getElementById('exploreRightNav');
    if (exploreRightNav) exploreRightNav.style.display = 'none';
    if (pcLyricsContainer) pcLyricsContainer.style.display = 'none';

    // Equalizer bars: 2 bars (Mode 1: List, Mode 2: Grid)
    updateRecorderEqualizerBars();

    // Render Right side based on active Mode
    if (currentRecorderPcMode === 2) {
      await renderRecorderGridView();
    } else {
      await renderRecorderListView();
    }

    if (window.updateArtistMiniPlayerVisibility) {
      window.updateArtistMiniPlayerVisibility();
    }
  }

  async function renderRecorderListView() {
    if (!songsListContainer) return;
    songsListContainer.style.display = 'flex';
    const hasMini = Boolean(player && player.currentTrack && window.innerWidth > 900);
    songsListContainer.className = `songs-list recorder-list-mode ${hasMini ? 'has-mini-player' : ''}`;

    const recordings = await fileManager.getRecordings();
    const savedHandle = await fileManager.getSetting('recorder_directory_handle');

    let folderBannerHTML = '';
    if (!savedHandle && 'showDirectoryPicker' in window) {
      folderBannerHTML = `
        <div class="recorder-folder-banner" id="recorderFolderBanner">
          <div class="recorder-folder-banner-text">
            <h4>Save recordings locally</h4>
            <p>Choose a folder on your PC where audio files will be automatically saved.</p>
          </div>
          <button class="recorder-choose-folder-btn" id="recorderChooseFolderBtn">Choose Folder</button>
        </div>
      `;
    }

    if (recordings.length === 0) {
      songsListContainer.innerHTML = `
        ${folderBannerHTML}
        <div class="empty-state" style="padding-top: 40px;">
          <h3 class="empty-title">No Recordings Yet</h3>
          <p class="empty-subtitle">Click the white Record button on the cassette to start recording audio.</p>
        </div>
      `;
      const chooseBtn = document.getElementById('recorderChooseFolderBtn');
      if (chooseBtn) {
        chooseBtn.addEventListener('click', selectRecordingFolder);
      }
      return;
    }

    const isDark = (document.body.getAttribute('data-theme') || currentTheme) === 'dark';
    const dotsIconSrc = isDark ? 'assets/Dark Mode/DarkModeOptionsbtn.svg' : 'assets/OptionsThreeDots.svg';

    const cardsHTML = recordings.map(rec => {
      const isPlaying = player.currentTrack && player.currentTrack.id === rec.id;
      return `
        <div class="recording-list-card ${isPlaying ? 'is-playing' : ''}" data-recording-id="${escapeHtml(rec.id)}" tabindex="0" role="button" title="Play ${escapeHtml(rec.title)}">
          <div class="recording-list-info">
            <span class="recording-list-title">${escapeHtml(rec.title)}</span>
            <span class="recording-list-date">${escapeHtml(rec.date || formatRecordingDate(new Date(rec.timestamp || Date.now())))}</span>
          </div>
          <div class="recording-list-actions">
            <button class="recording-list-options-btn" data-recording-id="${escapeHtml(rec.id)}" title="Recording options" aria-label="Recording options">
              <img src="${dotsIconSrc}" alt="Options" class="options-icon" />
            </button>
          </div>
        </div>
      `;
    }).join('');

    songsListContainer.innerHTML = folderBannerHTML + cardsHTML;

    const chooseBtn = document.getElementById('recorderChooseFolderBtn');
    if (chooseBtn) {
      chooseBtn.addEventListener('click', selectRecordingFolder);
    }

    songsListContainer.querySelectorAll('.recording-list-card').forEach(card => {
      card.addEventListener('click', (e) => {
        const optBtn = e.target.closest('.recording-list-options-btn');
        if (optBtn) {
          e.stopPropagation();
          const recId = optBtn.dataset.recordingId || card.dataset.recordingId;
          showRecordingContextMenu(e, recId);
          return;
        }

        const recId = card.dataset.recordingId;
        const rec = recordings.find(r => r.id === recId);
        if (rec) {
          player.setQueue([rec], 0, true);
          player.updateNowPlayingUI();
          renderRecorderListView();
        }
      });
    });
  }

  async function renderRecorderGridView() {
    if (!songsListContainer) return;
    songsListContainer.style.display = 'grid';
    const hasMini = Boolean(player && player.currentTrack && window.innerWidth > 900);
    songsListContainer.className = `songs-list recorder-grid-mode ${hasMini ? 'has-mini-player' : ''}`;

    const recordings = await fileManager.getRecordings();

    if (recordings.length === 0) {
      songsListContainer.style.display = 'flex';
      songsListContainer.className = 'songs-list empty-container';
      songsListContainer.innerHTML = `
        <div class="empty-state">
          <h3 class="empty-title">No Recordings Found</h3>
          <p class="empty-subtitle">Click the white Record button on the cassette to record your first track.</p>
        </div>
      `;
      return;
    }

    const isDark = (document.body.getAttribute('data-theme') || currentTheme) === 'dark';
    const dotsIconSrc = isDark ? 'assets/Dark Mode/DarkModeOptionsbtn.svg' : 'assets/OptionsThreeDots.svg';

    songsListContainer.innerHTML = recordings.map(rec => {
      return `
        <div class="recording-grid-card" data-recording-id="${escapeHtml(rec.id)}" tabindex="0" role="button" title="Play ${escapeHtml(rec.title)}">
          <div class="recording-grid-cover-wrap">
            <img src="assets/LibraryItems/RecorderWholeGraphicalInterface.svg" class="recording-grid-cassette-icon" alt="Recording" />
          </div>
          <div class="recording-grid-body">
            <div>
              <div class="recording-grid-title">${escapeHtml(rec.title)}</div>
              <div class="recording-grid-date">${escapeHtml(rec.date || formatRecordingDate(new Date(rec.timestamp || Date.now())))}</div>
            </div>
            <button class="recording-list-options-btn" data-recording-id="${escapeHtml(rec.id)}" title="Options" aria-label="Options">
              <img src="${dotsIconSrc}" alt="Options" style="width: 14px; height: 14px;" />
            </button>
          </div>
        </div>
      `;
    }).join('');

    songsListContainer.querySelectorAll('.recording-grid-card').forEach(card => {
      card.addEventListener('click', (e) => {
        const optBtn = e.target.closest('.recording-list-options-btn');
        if (optBtn) {
          e.stopPropagation();
          const recId = optBtn.dataset.recordingId || card.dataset.recordingId;
          showRecordingContextMenu(e, recId);
          return;
        }

        const recId = card.dataset.recordingId;
        const rec = recordings.find(r => r.id === recId);
        if (rec) {
          player.setQueue([rec], 0, true);
          player.updateNowPlayingUI();
        }
      });
    });
  }

  // Recording Context Menu Handler
  const recordingContextMenu = document.getElementById('recordingContextMenu');
  function showRecordingContextMenu(e, recordingId) {
    activeRecordingContextMenuId = recordingId;
    if (!recordingContextMenu) return;

    let clientX = e.clientX;
    let clientY = e.clientY;
    if (clientX === undefined || clientY === undefined) {
      const rect = e.currentTarget ? e.currentTarget.getBoundingClientRect() : { left: 100, top: 100 };
      clientX = rect.left;
      clientY = rect.top;
    }

    recordingContextMenu.style.left = `${Math.min(clientX, window.innerWidth - 180)}px`;
    recordingContextMenu.style.top = `${Math.min(clientY, window.innerHeight - 120)}px`;
    recordingContextMenu.classList.add('open');
  }

  if (recordingContextMenu) {
    recordingContextMenu.addEventListener('click', async (e) => {
      const item = e.target.closest('.context-item');
      if (!item) return;
      const action = item.dataset.action;
      const recId = activeRecordingContextMenuId;
      const recordings = await fileManager.getRecordings();
      const rec = recordings.find(r => r.id === recId);

      if (action === 'play-recording') {
        if (rec) {
          player.setQueue([rec], 0, true);
          player.updateNowPlayingUI();
          showToast(`Playing ${rec.title}`);
        }
      } else if (action === 'delete-recording') {
        if (rec && confirm(`Delete "${rec.title}"?`)) {
          await fileManager.deleteRecording(recId);
          await fileManager.deleteTrackFromDB(recId);
          allTracks = allTracks.filter(t => t.id !== recId);
          if (player.currentTrack && player.currentTrack.id === recId) {
            player.stop();
          }
          showToast(`Deleted ${rec.title}`);
          if (currentView === 'recorder') {
            renderRecorderView();
          }
        }
      }
      recordingContextMenu.classList.remove('open');
    });
  }

  // Record Action Button Click Listener
  const recorderActionBtn = document.getElementById('recorderActionBtn');
  if (recorderActionBtn) {
    recorderActionBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (isRecordingAudio) {
        stopAudioRecording();
      } else {
        startAudioRecording();
      }
    });
  }

  // Smooth scroll listener for Virtual List updates
  if (songsListContainer) {
    let isVirtualScrollPending = false;
    songsListContainer.addEventListener('scroll', () => {
      if (!isVirtualScrollPending) {
        isVirtualScrollPending = true;
        requestAnimationFrame(() => {
          isVirtualScrollPending = false;
          if (currentView === 'all_songs' && !isGridView && allTracks.length > 50) {
            renderSongList();
          }
        });
      }
    }, { passive: true });
  }

  // Delegated Event Listener for song cards, playlist cards, and options
  if (songsListContainer) {
    songsListContainer.addEventListener('click', async (e) => {
      // 1. In Multi-Selection Mode
      if (isSelectMode) {
        const card = e.target.closest('.song-card');
        if (card) {
          e.stopPropagation();
          const trackId = card.dataset.id;
          if (selectedTrackIds.has(trackId)) {
            selectedTrackIds.delete(trackId);
          } else {
            selectedTrackIds.add(trackId);
          }
          updateMultiSelectUI();
        }
        return;
      }

      // 2. Playlist 3-dot options
      const playlistOptionsBtn = e.target.closest('.playlist-options-btn');
      if (playlistOptionsBtn) {
        e.stopPropagation();
        const playlistId = playlistOptionsBtn.dataset.playlistId;
        showPlaylistContextMenu(e, playlistId);
        return;
      }

      // 3. Playlist Card Click (opens playlist songs view)
      const playlistCard = e.target.closest('.playlist-card');
      if (playlistCard) {
        const playlistId = playlistCard.dataset.playlistId;
        renderPlaylistSongsView(playlistId);
        return;
      }

      // 3.b Artist 3-dot options
      const artistOptionsBtn = e.target.closest('.artist-card-dots');
      if (artistOptionsBtn) {
        e.stopPropagation();
        const artistName = artistOptionsBtn.dataset.artistName;
        if (artistName) showArtistContextMenu(e, artistName);
        return;
      }

      // 3.c Artist Card Click (opens individual artist view)
      const artistCard = e.target.closest('.artist-card-item');
      if (artistCard) {
        const artistName = artistCard.dataset.artistName;
        if (artistName) renderArtistDetailView(artistName);
        return;
      }

      // 3.d Album 3-dot options
      const albumOptionsBtn = e.target.closest('.album-card-dots');
      if (albumOptionsBtn) {
        e.stopPropagation();
        const albumName = albumOptionsBtn.dataset.albumName;
        if (albumName) showAlbumContextMenu(e, albumName);
        return;
      }

      // 3.e Album Card Click (opens individual album view)
      const albumCard = e.target.closest('.album-card-item');
      if (albumCard) {
        const albumName = albumCard.dataset.albumName;
        if (albumName) renderAlbumDetailView(albumName);
        return;
      }

      // 4. Song 3-dot options
      const optionsBtn = e.target.closest('.song-options-btn');
      if (optionsBtn) {
        e.stopPropagation();
        const trackId = optionsBtn.dataset.id;
        const isInPlaylist = optionsBtn.dataset.inPlaylist === 'true';
        showContextMenu(e, trackId, isInPlaylist);
        return;
      }

      // 5. Masonry Grid 3-dot options (Mode 3, Artist Grid Mode & Album Grid Mode)
      const masonryOptionsBtn = e.target.closest('.masonry-options-btn');
      if (masonryOptionsBtn) {
        e.stopPropagation();
        const albumName = masonryOptionsBtn.dataset.albumName;
        const artistName = masonryOptionsBtn.dataset.artistName;
        const trackId = masonryOptionsBtn.dataset.id;
        if (albumName) {
          showAlbumContextMenu(e, albumName);
        } else if (artistName) {
          showArtistContextMenu(e, artistName);
        } else if (trackId) {
          showContextMenu(e, trackId);
        }
        return;
      }

      // 6. Masonry Grid Card Click (Mode 3 Playback)
      const masonryCard = e.target.closest('.masonry-card');
      if (masonryCard) {
        const trackId = masonryCard.dataset.id;
        const targetTrackIndex = allTracks.findIndex(t => t.id === trackId);
        if (targetTrackIndex !== -1) {
          if (player.currentTrack && player.currentTrack.id === trackId) {
            player.togglePlay();
          } else {
            player.activePlaylistId = null;
            player.activePlaylistName = null;
            player.setQueue(allTracks, targetTrackIndex, true);
            player.updateNowPlayingUI();
          }
        }
        return;
      }

      // 7. Song Card Click (Playback)
      const card = e.target.closest('.song-card');
      if (card) {
        const trackId = card.dataset.id;
        const isInsidePlaylist = card.dataset.playlistSong === 'true';

        // PC Mode 4: Play from upcoming queue
        if (window.innerWidth > 900 && (currentPcMode === 4 || currentArtistDetailMode === 4 || currentAlbumDetailMode === 4 || currentFavouritesMode === 4 || currentGenreMode === 4 || (currentView === 'playlist_songs' && currentPlaylistSongsMode === 4))) {
          const queueIndex = player.queue.findIndex(t => t.id === trackId);
          if (queueIndex !== -1) {
            if (player.currentTrack && player.currentTrack.id === trackId) {
              player.togglePlay();
            } else {
              player.loadAndPlay(queueIndex);
            }
          }
          return;
        }

        // Inside Individual Artist View (Image 2 & 3)
        if ((currentView === 'artist_detail' || currentView === 'artist_detail_now_playing') && selectedArtistName) {
          const artistSongs = allTracks.filter(t => (t.artist || 'Unknown').trim().toLowerCase() === selectedArtistName.trim().toLowerCase());
          const targetTrackIndex = artistSongs.findIndex(t => t.id === trackId);
          if (targetTrackIndex !== -1) {
            if (player.currentTrack && player.currentTrack.id === trackId) {
              player.togglePlay();
            } else {
              player.activePlaylistId = null;
              player.activePlaylistName = null;
              player.setQueue(artistSongs, targetTrackIndex, true);
              player.updateNowPlayingUI();
            }
            return;
          }
        }

        // Inside Individual Album View
        if (currentView === 'album_detail' && selectedAlbumName) {
          const albumTracks = allTracks.filter(t => (t.album || t.title || '').trim().toLowerCase() === selectedAlbumName.trim().toLowerCase());
          const targetTrackIndex = albumTracks.findIndex(t => t.id === trackId);
          if (targetTrackIndex !== -1) {
            if (player.currentTrack && player.currentTrack.id === trackId) {
              player.togglePlay();
            } else {
              player.activePlaylistId = null;
              player.activePlaylistName = null;
              player.setQueue(albumTracks, targetTrackIndex, true);
              player.updateNowPlayingUI();
            }
            return;
          }
        }

        // Inside Favourites View
        if (currentView === 'favourites') {
          const favTrackIds = getFavouriteTrackIds();
          const favTracks = allTracks.filter(t => favTrackIds.includes(t.id));
          const targetTrackIndex = favTracks.findIndex(t => t.id === trackId);
          if (targetTrackIndex !== -1) {
            if (player.currentTrack && player.currentTrack.id === trackId) {
              player.togglePlay();
            } else {
              player.activePlaylistId = null;
              player.activePlaylistName = null;
              player.setQueue(favTracks, targetTrackIndex, true);
              player.updateNowPlayingUI();
            }
            return;
          }
        }

        // Inside Genre View
        if (currentView === 'genre') {
          const genreTracks = allTracks.filter(t => classifyTrackGenre(t) === selectedGenre);
          const targetTrackIndex = genreTracks.findIndex(t => t.id === trackId);
          if (targetTrackIndex !== -1) {
            if (player.currentTrack && player.currentTrack.id === trackId) {
              player.togglePlay();
            } else {
              player.activePlaylistId = null;
              player.activePlaylistName = null;
              player.setQueue(genreTracks, targetTrackIndex, true);
              player.updateNowPlayingUI();
            }
            return;
          }
        }

        if (isInsidePlaylist && activePlaylistId) {
          const playlist = playlists.find(p => p.id === activePlaylistId);
          if (playlist) {
            const playlistTracks = (playlist.trackIds || []).map(id => allTracks.find(t => t.id === id)).filter(Boolean);
            const targetTrackIndex = playlistTracks.findIndex(t => t.id === trackId);
            if (targetTrackIndex !== -1) {
              if (player.currentTrack && player.currentTrack.id === trackId) {
                player.togglePlay();
              } else {
                player.activePlaylistId = playlist.id;
                player.activePlaylistName = playlist.name;
                await fileManager.incrementPlaylistPlayCount(playlist.id);
                playlists = await fileManager.getPlaylists();
                player.setQueue(playlistTracks, targetTrackIndex, true);
                player.updateNowPlayingUI();
              }
            }
          }
        } else {
          const targetTrackIndex = allTracks.findIndex(t => t.id === trackId);
          if (targetTrackIndex !== -1) {
            if (player.currentTrack && player.currentTrack.id === trackId) {
              player.togglePlay();
            } else {
              player.activePlaylistId = null;
              player.activePlaylistName = null;
              player.setQueue(allTracks, targetTrackIndex, true);
              player.updateNowPlayingUI();
            }
          }
        }
      }
    });
  }

  // Show Toast notification
  function showToast(msg) {
    if (!toastMessage) return;
    toastMessage.textContent = msg;
    toastMessage.classList.add('visible');
    setTimeout(() => {
      toastMessage.classList.remove('visible');
    }, 3000);
  }

  // Handle Adding Music folder or files from local storage (Non-destructive combined library)
  async function handleAddMusic() {
    try {
      let initialRendered = false;

      const newTracks = await fileManager.selectDirectory({
        onScanStart: () => {
          showLoadingProgress(0, 0);
        },
        onInitialTracksReady: (initialBatch) => {
          if (initialBatch && initialBatch.length > 0) {
            // MERGE with existing without wiping previous tracks
            const existingIds = new Set(allTracks.map(t => t.id));
            const existingKeys = new Set(allTracks.map(t => `${t.fileBlob?.name || t.title}_${t.fileBlob?.size || 0}`));
            const uniqueBatch = initialBatch.filter(t => {
              const key = `${t.fileBlob?.name || t.title}_${t.fileBlob?.size || 0}`;
              return !existingIds.has(t.id) && !existingKeys.has(key);
            });
            allTracks = [...allTracks, ...uniqueBatch];
            FileManager.sortTracks(allTracks);
            if (currentView === 'all_songs') {
              renderSongList();
            }
            initialRendered = true;

            // Prepare first track if queue is empty
            if (!player.currentTrack && allTracks.length > 0) {
              player.setQueue(allTracks, 0, false);
            }
          }
        },
        onProgress: ({ processed, total, remaining, percent }) => {
          showLoadingProgress(remaining, percent);
        },
        onBatchMetadataUpdated: (updatedChunk) => {
          updateVisibleSongCardMetadata(updatedChunk);
          if (player.currentTrack && updatedChunk.some(t => t.id === player.currentTrack.id)) {
            player.updateNowPlayingUI();
          }
        }
      });

      hideLoadingProgress();

      if (!initialRendered && newTracks && newTracks.length > 0) {
        const existingIds = new Set(allTracks.map(t => t.id));
        const existingKeys = new Set(allTracks.map(t => `${t.fileBlob?.name || t.title}_${t.fileBlob?.size || 0}`));
        const uniqueNew = newTracks.filter(t => {
          const key = `${t.fileBlob?.name || t.title}_${t.fileBlob?.size || 0}`;
          return !existingIds.has(t.id) && !existingKeys.has(key);
        });
        allTracks = [...allTracks, ...uniqueNew];
        FileManager.sortTracks(allTracks);
        if (currentView === 'all_songs') {
          renderSongList();
        }
        if (!player.currentTrack && allTracks.length > 0) {
          player.setQueue(allTracks, 0, false);
        }
      }

      if (newTracks && newTracks.length > 0) {
        showToast(`Imported ${newTracks.length} song${newTracks.length > 1 ? 's' : ''}!`);
      }
    } catch (err) {
      hideLoadingProgress();
      console.warn('Folder selection canceled or error:', err);
    }
  }

  if (addFolderBtn) {
    addFolderBtn.addEventListener('click', handleAddMusic);
  }

  // Player control buttons (Desktop & Mobile)
  const allPlayPauseBtns = [playPauseBtn, document.getElementById('mobilePopupPlayPauseBtn'), document.getElementById('mobileFullPlayPauseBtn')];
  allPlayPauseBtns.forEach(btn => {
    if (btn) {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (allTracks.length === 0) {
          handleAddMusic();
        } else {
          player.togglePlay();
        }
      });
    }
  });

  const allPrevBtns = [prevBtn, document.getElementById('mobilePopupPrevBtn'), document.getElementById('mobileFullPrevBtn')];
  allPrevBtns.forEach(btn => {
    if (btn) {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        player.prev();
      });
    }
  });

  const allNextBtns = [nextBtn, document.getElementById('mobilePopupNextBtn'), document.getElementById('mobileFullNextBtn')];
  allNextBtns.forEach(btn => {
    if (btn) {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        player.next();
      });
    }
  });

  // Filter Pill Buttons: All, Column, Shuffle (Desktop & Mobile Synchronized)
  function setAllFilter() {
    currentFilter = 'all';
    isGridView = false;
    currentView = 'all_songs';
    activePlaylistId = null;

    // Reset search state & input
    searchQuery = '';
    document.querySelectorAll('.search-input').forEach(input => { input.value = ''; });
    document.querySelectorAll('.search-overlay').forEach(overlay => { overlay.classList.remove('open'); });
    if (searchInput) searchInput.value = '';
    if (searchOverlay) searchOverlay.classList.remove('open');
    isSearchHistoryActive = false;
    if (window.history && window.history.state && window.history.state.isSearch) {
      try {
        window.history.replaceState(null, '');
      } catch (e) {}
    }

    // Close mobile full player and up-next panel if open
    const mobileFullPlayer = document.getElementById('mobileFullPlayer');
    if (mobileFullPlayer) mobileFullPlayer.classList.remove('open');
    const mobileUpNextPanel = document.getElementById('mobileUpNextPanel');
    if (mobileUpNextPanel) mobileUpNextPanel.classList.remove('open');

    // Close any open modals/overlays
    const playlistModal = document.getElementById('playlistModal');
    if (playlistModal) playlistModal.classList.remove('open');
    const settingsModal = document.getElementById('settingsModal');
    if (settingsModal) settingsModal.classList.remove('open');
    const songContextMenu = document.getElementById('songContextMenu');
    if (songContextMenu) songContextMenu.classList.remove('open');
    const playlistContextMenu = document.getElementById('playlistContextMenu');
    if (playlistContextMenu) playlistContextMenu.classList.remove('open');
    const artistContextMenu = document.getElementById('artistContextMenu');
    if (artistContextMenu) artistContextMenu.classList.remove('open');

    // Exit selection mode if active
    if (isSelectMode && typeof exitSelectMode === 'function') {
      exitSelectMode();
    }

    // Hide Home page and restore normal layout
    const homePageContainer = document.getElementById('homePageContainer');
    if (homePageContainer) homePageContainer.style.display = 'none';
    const playerSection = document.querySelector('.player-section');
    const librarySection = document.querySelector('.library-section');
    if (playerSection) playerSection.style.display = '';
    if (librarySection) librarySection.style.display = '';

    // Synchronize navbar active states
    document.querySelectorAll('.menu-item-btn').forEach(b => b.classList.toggle('active', b.dataset.action === 'all-songs'));
    document.querySelectorAll('.mobile-nav-btn').forEach(b => b.classList.toggle('active', b.dataset.action === 'all-songs'));

    // Reset Library Heading
    const libraryHeading = document.querySelector('.library-heading');
    if (libraryHeading) libraryHeading.textContent = 'Songs';

    // PC Left side: Show normal player body & reset all subview left sections
    prepareViewTransition(null, []);

    selectedArtistName = null;
    selectedAlbumName = null;
    selectedGenre = null;
    const exploreRightNav = document.getElementById('exploreRightNav');
    if (exploreRightNav) exploreRightNav.style.display = 'none';
    if (songsListContainer) songsListContainer.style.display = 'flex';

    // Reset view selector label if present
    updateViewSelectorLabel('Home / All Songs');

    // Active state for All buttons, Column buttons remain inactive
    ['filterAllBtn', 'mobileFilterAllBtn', 'mobileFullFilterAllBtn'].forEach(id => {
      const b = document.getElementById(id);
      if (b) b.classList.add('active');
    });
    ['filterColumnBtn', 'mobileFilterColumnBtn', 'mobileFullFilterColumnBtn'].forEach(id => {
      const b = document.getElementById(id);
      if (b) {
        b.classList.remove('active');
        b.style.display = '';
      }
    });
    if (filterAllBtn) filterAllBtn.textContent = 'All';
    if (filterColumnBtn) filterColumnBtn.textContent = 'Column';
    if (filterShuffleBtn) filterShuffleBtn.textContent = 'Shuffle';

    // PC Desktop View: Always reset to Mode 1 (List View) with 1st vertical bar active
    if (window.innerWidth > 900) {
      currentPcMode = 1;
      const libraryEq = document.querySelector('.library-equalizer-bars');
      if (libraryEq) libraryEq.style.display = 'flex';
      restoreAllSongsEqualizerBars();
      if (pcLyricsContainer) pcLyricsContainer.style.display = 'none';
      if (songsListContainer) {
        songsListContainer.className = 'songs-list';
        songsListContainer.style.display = 'flex';
      }
    }

    if (window.updateArtistMiniPlayerVisibility) {
      window.updateArtistMiniPlayerVisibility();
    }

    renderSongList();
  }

  function toggleShuffleFilter() {
    const isShuffled = player.toggleShuffle();
    showToast(isShuffled ? 'Shuffle: ON' : 'Shuffle: OFF');
    if (window.updateMobileUpNextUI) window.updateMobileUpNextUI();
  }

  // Global "All" navigation buttons
  ['filterAllBtn', 'mobileFilterAllBtn', 'mobileFullFilterAllBtn'].forEach(id => {
    const b = document.getElementById(id);
    if (b) b.addEventListener('click', setAllFilter);
  });

  // Middle button: Toggle between views on PC
  if (filterColumnBtn) {
    filterColumnBtn.addEventListener('click', (e) => {
      e.preventDefault();
      // PC View Only
      if (window.innerWidth <= 900) return;

      if (currentView === 'all_songs') {
        if (isColumnViewActive) {
          exitColumnView();
        } else {
          renderColumnView();
        }
        return;
      }

      if (currentView === 'explore') {
        return; // UI only for now
      }

      if (currentView === 'artist_main') {
        renderArtistMainNowPlayingView();
        return;
      }

      if (currentView === 'artist_main_now_playing') {
        renderArtistMainView();
        return;
      }

      if (currentView === 'artist_detail' || currentView === 'artist_detail_now_playing') {
        renderArtistMainView();
        return;
      }

      if (currentView === 'playlists') {
        const playerBody = document.querySelector('.player-body');
        if (!playerBody) return;

        if (playerBody.classList.contains('playlist-view-active')) {
          // Switch Left side to existing Now Playing view
          playerBody.classList.remove('playlist-view-active');
          filterColumnBtn.textContent = 'Playlists';
        } else {
          // Switch Left side back to Playlist graphical interface
          playerBody.classList.add('playlist-view-active');
          filterColumnBtn.textContent = 'Now Playing';
          renderPlaylistFeaturedCards();
          renderPlaylistFavSection();
        }
      } else if (currentView === 'playlist_songs') {
        renderPlaylistsView();
      }
    });
  }

  // Mobile middle filter buttons keep default non-functional behavior
  ['mobileFilterColumnBtn', 'mobileFullFilterColumnBtn'].forEach(id => {
    const b = document.getElementById(id);
    if (b) {
      b.addEventListener('click', (e) => {
        e.preventDefault();
      });
    }
  });

  // PC 3-Mode Playback Control: Single-click direct cycling (Repeat One -> Shuffle ON -> Play in Line)
  const pcShuffleBtn = document.getElementById('filterShuffleBtn');
  if (pcShuffleBtn) {
    pcShuffleBtn.addEventListener('click', (e) => {
      e.preventDefault();
      if (window.innerWidth <= 900) {
        toggleShuffleFilter();
        return;
      }
      if (currentView === 'explore') {
        return; // UI only for now
      }
      if (currentView === 'playlist_songs' && activePlaylistId) {
        const pl = playlists.find(p => p.id === activePlaylistId);
        if (pl && (!player.activePlaylistId || player.activePlaylistId !== activePlaylistId || !player.isPlaying)) {
          const playlistTracks = (pl.trackIds || []).map(id => allTracks.find(t => t.id === id)).filter(Boolean);
          if (playlistTracks.length > 0) {
            player.activePlaylistId = pl.id;
            player.activePlaylistName = pl.name;
            const shuffled = player.shuffleArray([...playlistTracks]);
            player.setQueue(shuffled, 0, true);
            player.setPlaybackMode('shuffle');
            player.updateNowPlayingUI();
            showToast(`Shuffling playlist: ${pl.name}`);
            return;
          }
        }
      }
      const newMode = player.cyclePlaybackMode();
      if (newMode === 'repeat_one') {
        showToast('Playback: Repeat One');
      } else if (newMode === 'shuffle') {
        showToast('Playback: Shuffle ON');
      } else if (newMode === 'normal') {
        showToast('Playback: Play in Line');
      }
    });
  }

  // Mobile shuffle buttons keep existing mobile toggle
  ['mobileFilterShuffleBtn', 'mobileFullFilterShuffleBtn'].forEach(id => {
    const b = document.getElementById(id);
    if (b) b.addEventListener('click', toggleShuffleFilter);
  });

  // =========================================================================
  // PC 4-MODE INTERACTION & KEYBOARD SHORTCUTS (DESKTOP VIEW ONLY)
  // =========================================================================

  // 1. PC 4-Mode Vertical Buttons Click Listeners (| | | |)
  for (let i = 1; i <= 4; i++) {
    const bar = document.getElementById(`eqBar${i}`);
    if (bar) {
      bar.addEventListener('click', () => {
        if (currentView === 'playlist_songs') {
          switchPlaylistSongsMode(i);
        } else if (currentView === 'artist_detail') {
          switchArtistDetailMode(i);
        } else if (currentView === 'artist_main') {
          if (i === 1 || i === 2) {
            currentArtistPcMode = i;
            renderArtistMainView();
          }
        } else if (currentView === 'albums_main') {
          if (i === 1 || i === 2) {
            currentAlbumsPcMode = i;
            renderAlbumsMainView();
          }
        } else if (currentView === 'album_detail') {
          switchAlbumDetailMode(i);
        } else if (currentView === 'favourites') {
          switchFavouritesMode(i);
        } else if (currentView === 'genre') {
          switchGenreMode(i);
        } else if (currentView === 'folder_detail') {
          switchFolderDetailMode(i);
        } else if (currentView === 'recorder') {
          if (i === 1 || i === 2) {
            currentRecorderPcMode = i;
            updateRecorderEqualizerBars();
            if (currentRecorderPcMode === 2) {
              renderRecorderGridView();
            } else {
              renderRecorderListView();
            }
          }
        } else {
          switchPcMode(i);
        }
      });
    }
  }

  // 2. Global Keyboard Navigation: A = Previous Mode, D = Next Mode (Circular Loop)
  window.addEventListener('keydown', (e) => {
    // Only in PC/Desktop view
    if (window.innerWidth <= 900) return;

    // Do NOT trigger when user is actively typing in text input, textarea, or contenteditable
    const active = document.activeElement;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) {
      return;
    }

    // Ignore if modifier keys are held
    if (e.ctrlKey || e.altKey || e.metaKey) return;

    if (e.key === 'a' || e.key === 'A') {
      e.preventDefault();
      if (currentView === 'playlists') {
        return; // Main playlists page: do nothing on A/D
      } else if (currentView === 'playlist_songs') {
        switchPlaylistSongsMode(currentPlaylistSongsMode - 1);
      } else if (currentView === 'artist_detail') {
        switchArtistDetailMode(currentArtistDetailMode - 1);
      } else if (currentView === 'artist_main') {
        currentArtistPcMode = currentArtistPcMode === 1 ? 2 : 1;
        renderArtistMainView();
      } else if (currentView === 'albums_main') {
        currentAlbumsPcMode = currentAlbumsPcMode === 1 ? 2 : 1;
        renderAlbumsMainView();
      } else if (currentView === 'album_detail') {
        switchAlbumDetailMode(currentAlbumDetailMode - 1);
      } else if (currentView === 'favourites') {
        switchFavouritesMode(currentFavouritesMode - 1);
      } else if (currentView === 'genre') {
        switchGenreMode(currentGenreMode - 1);
      } else if (currentView === 'folder_detail') {
        switchFolderDetailMode(currentFoldersPcMode - 1);
      } else if (currentView === 'recorder') {
        currentRecorderPcMode = currentRecorderPcMode === 1 ? 2 : 1;
        updateRecorderEqualizerBars();
        if (currentRecorderPcMode === 2) {
          renderRecorderGridView();
        } else {
          renderRecorderListView();
        }
      } else {
        switchPcMode(currentPcMode - 1);
      }
    } else if (e.key === 'd' || e.key === 'D') {
      e.preventDefault();
      if (currentView === 'playlists') {
        return; // Main playlists page: do nothing on A/D
      } else if (currentView === 'playlist_songs') {
        switchPlaylistSongsMode(currentPlaylistSongsMode + 1);
      } else if (currentView === 'artist_detail') {
        switchArtistDetailMode(currentArtistDetailMode + 1);
      } else if (currentView === 'artist_main') {
        currentArtistPcMode = currentArtistPcMode === 1 ? 2 : 1;
        renderArtistMainView();
      } else if (currentView === 'albums_main') {
        currentAlbumsPcMode = currentAlbumsPcMode === 1 ? 2 : 1;
        renderAlbumsMainView();
      } else if (currentView === 'album_detail') {
        switchAlbumDetailMode(currentAlbumDetailMode + 1);
      } else if (currentView === 'favourites') {
        switchFavouritesMode(currentFavouritesMode + 1);
      } else if (currentView === 'genre') {
        switchGenreMode(currentGenreMode + 1);
      } else if (currentView === 'folder_detail') {
        switchFolderDetailMode(currentFoldersPcMode + 1);
      } else if (currentView === 'recorder') {
        currentRecorderPcMode = currentRecorderPcMode === 1 ? 2 : 1;
        updateRecorderEqualizerBars();
        if (currentRecorderPcMode === 2) {
          renderRecorderGridView();
        } else {
          renderRecorderListView();
        }
      } else {
        switchPcMode(currentPcMode + 1);
      }
    }
  });

  // 3. Player Synchronizations for Lyrics, Grid, and Queue Views
  window.onMusicoTrackChange = (track) => {
    updateMiniPlayerFavUI();
    if (window.innerWidth > 900) {
      if (currentView === 'playlist_songs') {
        if (currentPlaylistSongsMode === 2) renderPcLyricsView();
        else if (currentPlaylistSongsMode === 3) {
          document.querySelectorAll('.masonry-card').forEach(card => {
            card.classList.toggle('is-current', player.currentTrack && card.dataset.id === player.currentTrack.id);
          });
        } else if (currentPlaylistSongsMode === 4) renderPcQueueView();
      } else if (currentView === 'artist_detail') {
        if (currentArtistDetailMode === 2) renderPcLyricsView();
        else if (currentArtistDetailMode === 3) {
          document.querySelectorAll('.masonry-card').forEach(card => {
            card.classList.toggle('is-current', player.currentTrack && card.dataset.id === player.currentTrack.id);
          });
        } else if (currentArtistDetailMode === 4) renderPcQueueView();
      } else if (currentView === 'album_detail') {
        if (currentAlbumDetailMode === 2) renderPcLyricsView();
        else if (currentAlbumDetailMode === 3) {
          document.querySelectorAll('.masonry-card').forEach(card => {
            card.classList.toggle('is-current', player.currentTrack && card.dataset.id === player.currentTrack.id);
          });
        } else if (currentAlbumDetailMode === 4) renderPcQueueView();
      } else if (currentView === 'favourites') {
        if (currentFavouritesMode === 2) renderPcLyricsView();
        else if (currentFavouritesMode === 3) {
          document.querySelectorAll('.masonry-card').forEach(card => {
            card.classList.toggle('is-current', player.currentTrack && card.dataset.id === player.currentTrack.id);
          });
        } else if (currentFavouritesMode === 4) renderPcQueueView();
      } else if (currentView === 'genre') {
        if (currentGenreMode === 2) renderPcLyricsView();
        else if (currentGenreMode === 3) {
          document.querySelectorAll('.masonry-card').forEach(card => {
            card.classList.toggle('is-current', player.currentTrack && card.dataset.id === player.currentTrack.id);
          });
        } else if (currentGenreMode === 4) renderPcQueueView();
      } else if (currentView === 'folder_detail') {
        if (currentFoldersPcMode === 2) renderPcLyricsView();
        else if (currentFoldersPcMode === 3) {
          document.querySelectorAll('.masonry-card').forEach(card => {
            card.classList.toggle('is-current', player.currentTrack && card.dataset.id === player.currentTrack.id);
          });
        } else if (currentFoldersPcMode === 4) renderPcQueueView();
      } else {
        if (currentPcMode === 2) {
          renderPcLyricsView();
        } else if (currentPcMode === 3) {
          renderPcMasonryGridView();
        } else if (currentPcMode === 4) {
          renderPcQueueView();
        }
      }
    }
  };

  if (player && player.audio) {
    player.audio.addEventListener('timeupdate', () => {
      if (window.innerWidth > 900) {
        if (currentView === 'expanded_player') {
          updateExpandedCoverLyrics();
        } else {
          const isLyricsActive = (currentView === 'artist_detail' && currentArtistDetailMode === 2) ||
                                 (currentView === 'album_detail' && currentAlbumDetailMode === 2) ||
                                 (currentView === 'favourites' && currentFavouritesMode === 2) ||
                                 (currentView === 'genre' && currentGenreMode === 2) ||
                                 (currentView === 'folder_detail' && currentFoldersPcMode === 2) ||
                                 (currentView === 'playlist_songs' && currentPlaylistSongsMode === 2) ||
                                 (currentView === 'all_songs' && currentPcMode === 2);
          if (isLyricsActive) {
            syncPcLyricsHighlight();
          }
        }
      }
    });

    player.audio.addEventListener('seeked', () => {
      if (window.innerWidth > 900 && currentView === 'expanded_player') {
        updateExpandedCoverLyrics(true);
      }
    });
  }

  window.onMusicoPlaybackChange = (isPlaying) => {
    if (window.innerWidth > 900) {
      const isGridActive = (currentView === 'artist_detail' && currentArtistDetailMode === 3) ||
                           (currentView === 'album_detail' && currentAlbumDetailMode === 3) ||
                           (currentView === 'favourites' && currentFavouritesMode === 3) ||
                           (currentView === 'genre' && currentGenreMode === 3) ||
                           (currentView === 'folder_detail' && currentFoldersPcMode === 3) ||
                           (currentView === 'playlist_songs' && currentPlaylistSongsMode === 3) ||
                           (currentView === 'all_songs' && currentPcMode === 3);
      if (isGridActive) {
        document.querySelectorAll('.masonry-card').forEach(card => {
          const isCurrent = player.currentTrack && card.dataset.id === player.currentTrack.id;
          card.classList.toggle('is-current', isCurrent);
        });
      }
    }
  };

  window.onMusicoQueueChange = () => {
    if (typeof isSongFullViewOpen !== 'undefined' && isSongFullViewOpen) {
      renderFullViewUpNext();
    }
    if (window.innerWidth > 900) {
      const isQueueActive = (currentView === 'artist_detail' && currentArtistDetailMode === 4) ||
                            (currentView === 'album_detail' && currentAlbumDetailMode === 4) ||
                            (currentView === 'favourites' && currentFavouritesMode === 4) ||
                            (currentView === 'genre' && currentGenreMode === 4) ||
                            (currentView === 'folder_detail' && currentFoldersPcMode === 4) ||
                            (currentView === 'playlist_songs' && currentPlaylistSongsMode === 4) ||
                            (currentView === 'all_songs' && currentPcMode === 4);
      if (isQueueActive) {
        renderPcQueueView();
      }
    }
  };

  // Mobile Side Controls (Black = Add Folder, Gray = Settings)
  const mobileSideAddBtn = document.getElementById('mobileSideAddBtn');
  if (mobileSideAddBtn) {
    mobileSideAddBtn.addEventListener('click', handleAddMusic);
  }

  const mobileSideSettingsBtn = document.getElementById('mobileSideSettingsBtn');
  if (mobileSideSettingsBtn) {
    mobileSideSettingsBtn.addEventListener('click', () => {
      if (settingsModal) settingsModal.classList.add('open');
    });
  }

  // Mobile Compact Popup (IMAGE 3) -> Opens Full Player on tap
  const mobileCompactPopup = document.getElementById('mobileCompactPopup');
  const mobileFullPlayer = document.getElementById('mobileFullPlayer');
  if (mobileCompactPopup && mobileFullPlayer) {
    mobileCompactPopup.addEventListener('click', (e) => {
      // Don't open if clicked on controls or progress bar
      if (e.target.closest('.mobile-popup-ctrl-btn') || e.target.closest('.mobile-popup-progress-track')) {
        return;
      }
      mobileFullPlayer.classList.add('open');
      requestAnimationFrame(() => {
        if (window.updateMobileUpNextUI) window.updateMobileUpNextUI();
      });
    });
  }

  // =========================================================================
  // RESPONSIVE UP NEXT SECTION & FULL-SCREEN PANEL (Images 2 & 3)
  // =========================================================================
  const mobileUpNextSection = document.getElementById('mobileUpNextSection');
  const mobileUpNextList = document.getElementById('mobileUpNextList');
  const mobileUpNextPanel = document.getElementById('mobileUpNextPanel');
  const mobileUpNextPanelHandle = document.getElementById('mobileUpNextPanelHandle');
  const mobileUpNextFullList = document.getElementById('mobileUpNextFullList');
  const mobileFullMainContent = document.getElementById('mobileFullMainContent');
  const mobileFullBody = document.getElementById('mobileFullBody');

  function getUpcomingTracks() {
    if (!player.queue || player.queue.length === 0 || !player.currentTrack) return [];
    
    // 1. REPEAT ONE SONG MODE: Show ONLY the currently playing song
    if (player.repeatMode === 'one') {
      return [player.currentTrack];
    }

    const currentIdx = player.currentIndex;
    if (currentIdx === -1) return player.queue;
    
    // 2. NORMAL MODE / SHUFFLE MODE: Songs following current song in active queue
    let upcoming = player.queue.slice(currentIdx + 1);
    
    // 3. REPEAT ALL MODE: Loop from beginning if at end of queue
    if (player.repeatMode === 'all' && upcoming.length === 0 && player.queue.length > 1) {
      upcoming = player.queue.slice(0, currentIdx);
    }
    
    return upcoming;
  }

  function renderUpNextCard(track) {
    const isFallback = !track.coverUrl || 
                       track.coverUrl.includes('atsuko-no-cover-image') ||
                       track.coverUrl.includes('Atsuko - NoCoverImg') ||
                       track.coverUrl.includes('atsuko') ||
                       track.coverUrl.includes('M logo') ||
                       track.coverUrl.includes('MlogoforMusicItems') ||
                       track.coverUrl.includes('Mlogo.png') || 
                       track.coverUrl.includes('Group 4') || 
                       track.coverUrl.trim() === '';
    const coverSrc = isFallback ? 'assets/atsuko-no-cover-image.svg' : track.coverUrl;

    return `
      <div class="mobile-up-next-card" data-id="${track.id}">
        <div class="song-card-left">
          <div class="song-thumb-wrapper">
            <img src="${coverSrc}" alt="${escapeHtml(track.title)}" class="song-thumb ${isFallback ? 'fallback-logo' : ''}" onerror="this.onerror=null;this.src='assets/atsuko-no-cover-image.svg';this.className='song-thumb fallback-logo';" />
          </div>
          <div class="song-info">
            <span class="song-title">${escapeHtml(track.title)}</span>
            <span class="song-artist">//${escapeHtml(track.artist || 'Unknown')}</span>
          </div>
        </div>
        <button class="song-options-btn" data-id="${track.id}" aria-label="Song options" title="Options">
          <img src="assets/OptionsThreeDots.svg" alt="Options" class="options-icon" />
        </button>
      </div>
    `;
  }

  function attachUpNextCardListeners(container) {
    if (!container) return;
    container.querySelectorAll('.mobile-up-next-card').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('.song-options-btn')) return;
        const trackId = card.dataset.id;
        const targetIdx = player.queue.findIndex(t => t.id === trackId);
        if (targetIdx !== -1) {
          player.loadAndPlay(targetIdx);
          if (mobileUpNextPanel) {
            mobileUpNextPanel.classList.remove('open');
          }
        }
      });
    });

    container.querySelectorAll('.song-options-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const trackId = btn.dataset.id;
        showContextMenu(e, trackId);
      });
    });
  }

  function updateMobileUpNextUI() {
    if (!mobileUpNextSection || !mobileUpNextList || !mobileFullMainContent || !mobileFullBody) return;

    const upcoming = getUpcomingTracks();

    // 1. Populate Full-Screen Up Next Panel
    if (mobileUpNextFullList) {
      if (upcoming.length === 0) {
        mobileUpNextFullList.innerHTML = `<div class="up-next-empty">No upcoming songs in queue</div>`;
      } else {
        mobileUpNextFullList.innerHTML = upcoming.map(t => renderUpNextCard(t)).join('');
        attachUpNextCardListeners(mobileUpNextFullList);
      }
    }

    // 2. Calculate dynamic available vertical space for in-place section
    const bodyHeight = mobileFullBody.clientHeight;
    const mainHeight = mobileFullMainContent.offsetHeight;
    const availableHeight = bodyHeight - mainHeight;

    const isShortScreen = window.innerHeight <= 680;
    const cardHeightWithGap = isShortScreen ? 48 : 60;
    const headerHeight = isShortScreen ? 24 : 34;
    const minCardHeight = isShortScreen ? 42 : 52;

    if (upcoming.length === 0 || availableHeight < (headerHeight + minCardHeight)) {
      // STATE B: Compact "UP NEXT" bar (IMAGE 3)
      mobileUpNextSection.classList.add('compact-state');
      mobileUpNextList.innerHTML = '';
      return;
    }

    // STATE A: Enough Space -> Display as many items as comfortably fit (IMAGE 2)
    mobileUpNextSection.classList.remove('compact-state');
    const maxItemsFit = Math.max(1, Math.floor((availableHeight - headerHeight - 10) / cardHeightWithGap));
    const visibleUpcoming = upcoming.slice(0, maxItemsFit);

    mobileUpNextList.innerHTML = visibleUpcoming.map(t => renderUpNextCard(t)).join('');
    attachUpNextCardListeners(mobileUpNextList);
  }

  window.updateMobileUpNextUI = updateMobileUpNextUI;

  // Swipe Up gesture on Up Next section to open full-screen panel
  if (mobileUpNextSection && mobileUpNextPanel) {
    let upNextStartY = 0;
    let upNextCurrentY = 0;
    let isSwipingUpNext = false;

    mobileUpNextSection.addEventListener('touchstart', (e) => {
      upNextStartY = e.touches[0].clientY;
      upNextCurrentY = upNextStartY;
      isSwipingUpNext = true;
    }, { passive: true });

    mobileUpNextSection.addEventListener('touchmove', (e) => {
      if (!isSwipingUpNext) return;
      upNextCurrentY = e.touches[0].clientY;
    }, { passive: true });

    mobileUpNextSection.addEventListener('touchend', () => {
      if (isSwipingUpNext && (upNextStartY - upNextCurrentY > 35)) {
        mobileUpNextPanel.classList.add('open');
      }
      isSwipingUpNext = false;
      upNextStartY = 0;
      upNextCurrentY = 0;
    });

    // Tap anywhere on the Up Next bar opens the full Up Next panel (Change 4)
    mobileUpNextSection.addEventListener('click', (e) => {
      if (e.target.closest('.song-options-btn') || e.target.closest('.mobile-up-next-card')) {
        return;
      }
      mobileUpNextPanel.classList.add('open');
    });
  }

  // Swipe Down gesture on Full-Screen Up Next Panel to close it
  if (mobileUpNextPanel) {
    let panelStartY = 0;
    let panelCurrentY = 0;
    let isSwipingPanel = false;

    mobileUpNextPanel.addEventListener('touchstart', (e) => {
      if (!mobileUpNextFullList || mobileUpNextFullList.scrollTop <= 5) {
        panelStartY = e.touches[0].clientY;
        panelCurrentY = panelStartY;
        isSwipingPanel = true;
      } else {
        isSwipingPanel = false;
      }
    }, { passive: true });

    mobileUpNextPanel.addEventListener('touchmove', (e) => {
      if (!isSwipingPanel) return;
      panelCurrentY = e.touches[0].clientY;
      const deltaY = panelCurrentY - panelStartY;
      if (deltaY > 0) {
        mobileUpNextPanel.style.transform = `translateY(${Math.min(deltaY, 250)}px)`;
      }
    }, { passive: true });

    mobileUpNextPanel.addEventListener('touchend', () => {
      if (!isSwipingPanel) return;
      const deltaY = panelCurrentY - panelStartY;
      mobileUpNextPanel.style.transform = '';
      if (deltaY > 60) {
        mobileUpNextPanel.classList.remove('open');
      }
      isSwipingPanel = false;
      panelStartY = 0;
      panelCurrentY = 0;
    });

    if (mobileUpNextPanelHandle) {
      mobileUpNextPanelHandle.addEventListener('click', () => {
        mobileUpNextPanel.classList.remove('open');
      });
    }
  }

  // Mobile Swipe Down to Dismiss Full Player (IMAGE 2)
  const mobileSwipeHandle = document.getElementById('mobileSwipeHandle');
  if (mobileSwipeHandle && mobileFullPlayer) {
    mobileSwipeHandle.addEventListener('click', () => {
      mobileFullPlayer.classList.remove('open');
      if (mobileUpNextPanel) mobileUpNextPanel.classList.remove('open');
    });
  }

  if (mobileFullPlayer) {
    let startY = 0;
    let currentY = 0;
    let isSwiping = false;

    mobileFullPlayer.addEventListener('touchstart', (e) => {
      // Allow swipe down when at the top of scroll or touching header/art
      if (mobileFullPlayer.scrollTop <= 5 && (!mobileUpNextPanel || !mobileUpNextPanel.classList.contains('open'))) {
        startY = e.touches[0].clientY;
        isSwiping = true;
      } else {
        isSwiping = false;
      }
    }, { passive: true });

    mobileFullPlayer.addEventListener('touchmove', (e) => {
      if (!isSwiping) return;
      currentY = e.touches[0].clientY;
      const deltaY = currentY - startY;
      if (deltaY > 0) {
        mobileFullPlayer.style.transform = `translateY(${Math.min(deltaY, 200)}px)`;
      }
    }, { passive: true });

    mobileFullPlayer.addEventListener('touchend', () => {
      if (!isSwiping) return;
      const deltaY = currentY - startY;
      mobileFullPlayer.style.transform = '';
      if (deltaY > 70) {
        mobileFullPlayer.classList.remove('open');
        if (mobileUpNextPanel) mobileUpNextPanel.classList.remove('open');
      }
      isSwiping = false;
      startY = 0;
      currentY = 0;
    });
  }

  // Mobile Bottom Navigation Bar Action Handling
  document.querySelectorAll('.mobile-bottom-nav').forEach(nav => {
    nav.querySelectorAll('.mobile-nav-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action;

        // If inside full player and tapped all-songs or playlists, close full player
        if (mobileFullPlayer && (action === 'all-songs' || action === 'playlists')) {
          mobileFullPlayer.classList.remove('open');
        }

        if (action === 'delete') {
          if (allTracks.length > 0 && confirm('Clear all songs from library?')) {
            fileManager.clearAllTracks();
            allTracks = [];
            player.setQueue([], 0, false);
            renderSongList();
            showToast('Library cleared. No Songs.');
          } else if (allTracks.length === 0) {
            showToast('Library is already empty.');
          }
        } else if (action === 'all-songs') {
          setAllFilter();
          showToast('All Songs');
        } else if (action === 'home') {
          renderHomePage();
          showToast('Home');
        } else if (action === 'playlists') {
          renderPlaylistsView();
          showToast('Playlists');
        } else if (action === 'explore') {
          renderExploreView();
          showToast('Library');
        }
      });
    });
  });

  // View selector dropdown
  if (viewSelectorPill && viewDropdownMenu) {
    viewSelectorPill.addEventListener('click', (e) => {
      e.stopPropagation();
      viewDropdownMenu.classList.toggle('open');
    });

    document.addEventListener('click', () => {
      viewDropdownMenu.classList.remove('open');
    });

    viewDropdownMenu.querySelectorAll('.dropdown-item').forEach(item => {
      item.addEventListener('click', (e) => {
        const view = item.dataset.view;
        const text = item.textContent.trim();
        viewDropdownMenu.classList.remove('open');

        if (view === 'home') {
          renderHomePage();
        } else if (view === 'explore') {
          renderExploreView();
        } else if (view === 'playlists') {
          renderPlaylistsView();
        } else if (view === 'albums') {
          renderAlbumsMainView();
        } else if (view === 'favorites') {
          renderFavouritesView();
        } else {
          setAllFilter();
        }
        showToast(`View: ${text}`);
      });
    });
  }

  // Left Sidebar Menu Items navigation
  document.querySelectorAll('.menu-item-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      if (action === 'delete') {
        if (allTracks.length > 0 && confirm('Clear all songs from library?')) {
          fileManager.clearAllTracks();
          allTracks = [];
          player.setQueue([], 0, false);
          renderSongList();
          showToast('Library cleared. No Songs.');
        } else if (allTracks.length === 0) {
          showToast('Library is already empty.');
        }
      } else if (action === 'explore') {
        renderExploreView();
      } else if (action === 'playlists') {
        renderPlaylistsView();
      } else if (action === 'home') {
        renderHomePage();
      } else if (action === 'all-songs') {
        setAllFilter();
      }
    });
  });

  const sidebarAllSongsBtn = document.getElementById('sidebarAllSongsBtn');
  if (sidebarAllSongsBtn) {
    sidebarAllSongsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      setAllFilter();
    });
  }

  const logoBtn = document.getElementById('logoBtn');
  if (logoBtn) {
    logoBtn.addEventListener('click', () => {
      renderHomePage();
    });
  }

  // Top Horizontal Slider: Vertical Song-List Scroll Control
  let isDraggingSlider = false;

  function updateSongListScrollFromSlider(e) {
    if (!topSliderTrack || !songsListContainer) return;
    const rect = topSliderTrack.getBoundingClientRect();
    const clientX = e.clientX !== undefined ? e.clientX : (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
    const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
    const percent = rect.width > 0 ? (x / rect.width) * 100 : 0;
    
    // Update thumb position on the horizontal bar
    if (topSliderThumb) {
      const thumbWidth = topSliderThumb.offsetWidth || 32;
      const maxLeft = Math.max(0, rect.width - thumbWidth - 4);
      const leftPx = (percent / 100) * maxLeft + 2;
      topSliderThumb.style.left = `${leftPx}px`;
    }

    // Scroll songs list vertically
    if (isColumnViewActive) {
      const unifiedScroll = document.getElementById('columnViewUnifiedScroll');
      if (unifiedScroll) {
        const maxScroll = Math.max(0, unifiedScroll.scrollHeight - unifiedScroll.clientHeight);
        if (maxScroll > 0) {
          unifiedScroll.scrollTop = (percent / 100) * maxScroll;
        }
      }
    } else if (songsListContainer) {
      const maxScroll = Math.max(0, songsListContainer.scrollHeight - songsListContainer.clientHeight);
      if (maxScroll > 0) {
        songsListContainer.scrollTop = (percent / 100) * maxScroll;
        updateAlphabetScrollIndicator();
      }
    }
  }

  function updateSliderThumbFromSongListScroll() {
    if (isDraggingSlider || !topSliderTrack || !topSliderThumb) return;
    const target = isColumnViewActive ? document.getElementById('columnViewUnifiedScroll') : songsListContainer;
    if (!target) return;
    const maxScroll = target.scrollHeight - target.clientHeight;
    const scrollPercent = maxScroll > 0 ? Math.min(100, Math.max(0, (target.scrollTop / maxScroll) * 100)) : 0;
    const trackWidth = topSliderTrack.clientWidth || 300;
    const thumbWidth = topSliderThumb.offsetWidth || 32;
    const maxLeft = Math.max(0, trackWidth - thumbWidth - 4);
    const leftPx = (scrollPercent / 100) * maxLeft + 2;
    topSliderThumb.style.left = `${leftPx}px`;
  }

  // Mobile Vertical Scrollbar Logic (FIX 2: Real Mobile Custom Scrollbar with Black Track & Gray Thumb)
  const mobileScrollbarTrack = document.getElementById('mobileScrollbarTrack');
  const mobileScrollbarThumb = document.getElementById('mobileScrollbarThumb');
  let isDraggingMobileScrollbar = false;

  function updateMobileScrollbarThumb() {
    if (!mobileScrollbarTrack || !mobileScrollbarThumb || !songsListContainer) return;
    const maxScroll = songsListContainer.scrollHeight - songsListContainer.clientHeight;
    const trackHeight = mobileScrollbarTrack.clientHeight;

    if (maxScroll <= 0 || trackHeight <= 0) {
      mobileScrollbarThumb.style.height = `${Math.round(Math.min(58, Math.max(36, trackHeight * 0.22 * 1.8)))}px`;
      mobileScrollbarThumb.style.top = '2px';
      return;
    }

    // Thumb height scaled by 1.8x
    const visibleRatio = songsListContainer.clientHeight / songsListContainer.scrollHeight;
    const baseThumbHeight = Math.max(20, Math.min(trackHeight * 0.28, Math.max(24, visibleRatio * trackHeight * 0.32)));
    const thumbHeight = Math.round(baseThumbHeight * 1.8);
    mobileScrollbarThumb.style.height = `${thumbHeight}px`;

    const maxTop = Math.max(0, trackHeight - thumbHeight - 4);
    const scrollPercent = Math.min(1, Math.max(0, songsListContainer.scrollTop / maxScroll));
    const topPx = 2 + scrollPercent * maxTop;
    mobileScrollbarThumb.style.top = `${topPx}px`;
  }

  function handleMobileScrollbarMove(clientY) {
    if (!mobileScrollbarTrack || !songsListContainer) return;
    const rect = mobileScrollbarTrack.getBoundingClientRect();
    const trackHeight = rect.height;
    const thumbHeight = mobileScrollbarThumb ? mobileScrollbarThumb.clientHeight : 50;
    const maxTop = Math.max(1, trackHeight - thumbHeight - 4);
    
    // Position relative to track top, center thumb under finger
    const relativeY = clientY - rect.top - thumbHeight / 2;
    const clampedY = Math.max(0, Math.min(maxTop, relativeY));
    const scrollPercent = clampedY / maxTop;

    const maxScroll = songsListContainer.scrollHeight - songsListContainer.clientHeight;
    if (maxScroll > 0) {
      songsListContainer.scrollTop = scrollPercent * maxScroll;
    }
  }

  if (mobileScrollbarTrack) {
    mobileScrollbarTrack.addEventListener('touchstart', (e) => {
      isDraggingMobileScrollbar = true;
      handleMobileScrollbarMove(e.touches[0].clientY);
    }, { passive: false });

    mobileScrollbarTrack.addEventListener('mousedown', (e) => {
      isDraggingMobileScrollbar = true;
      handleMobileScrollbarMove(e.clientY);
    });
  }

  // Alphabetical Scroll Indicator for PC/Desktop view
  let alphabetFadeTimeout = null;

  function getVisibleAlphabetLetter() {
    if (!songsListContainer) return '';

    const containerRect = songsListContainer.getBoundingClientRect();
    const cards = songsListContainer.querySelectorAll('.song-card');

    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      const cardRect = card.getBoundingClientRect();
      // The first card whose bottom is below container top and top is within container
      if (cardRect.bottom > containerRect.top + 6 && cardRect.top < containerRect.bottom - 6) {
        const titleEl = card.querySelector('.song-title');
        let title = titleEl ? titleEl.textContent : '';
        if (!title) {
          const id = card.getAttribute('data-id');
          const t = allTracks.find(x => x.id === id);
          if (t) title = t.title || '';
        }
        if (title) {
          const clean = title.trim().replace(/^[^a-zA-Z0-9]+/, '');
          const char = (clean.charAt(0) || title.trim().charAt(0)).toUpperCase();
          if (char >= 'A' && char <= 'Z') return char;
          if (char >= '0' && char <= '9') return char;
          return '#';
        }
      }
    }

    // Fallback: direct index estimation based on scroll position in allTracks
    if (allTracks && allTracks.length > 0) {
      const maxScroll = Math.max(1, songsListContainer.scrollHeight - songsListContainer.clientHeight);
      const ratio = Math.max(0, Math.min(1, songsListContainer.scrollTop / maxScroll));
      const idx = Math.min(allTracks.length - 1, Math.floor(ratio * allTracks.length));
      const track = allTracks[idx];
      if (track && track.title) {
        const clean = track.title.trim().replace(/^[^a-zA-Z0-9]+/, '');
        const char = (clean.charAt(0) || track.title.trim().charAt(0)).toUpperCase();
        if (char >= 'A' && char <= 'Z') return char;
        if (char >= '0' && char <= '9') return char;
        return '#';
      }
    }

    return '';
  }

  function updateAlphabetScrollIndicator(isScrolling = true) {
    const alphabetIndicator = document.getElementById('alphabetScrollIndicator');
    if (!alphabetIndicator || !songsListContainer || window.innerWidth <= 768) return;

    if (currentView !== 'all_songs' || !allTracks || allTracks.length === 0) {
      alphabetIndicator.classList.remove('visible', 'scrolling');
      return;
    }

    const letter = getVisibleAlphabetLetter();
    if (letter) {
      alphabetIndicator.textContent = letter;
      alphabetIndicator.classList.add('visible');
      if (isScrolling) {
        alphabetIndicator.classList.add('scrolling');
      }

      if (alphabetFadeTimeout) {
        clearTimeout(alphabetFadeTimeout);
      }
      alphabetFadeTimeout = setTimeout(() => {
        alphabetIndicator.classList.remove('scrolling');
        alphabetIndicator.classList.remove('visible');
      }, 1500);
    }
  }

  if (songsListContainer) {
    songsListContainer.addEventListener('scroll', () => {
      updateSliderThumbFromSongListScroll();
      updateMobileScrollbarThumb();
      updateAlphabetScrollIndicator(true);
    }, { passive: true });

    songsListContainer.addEventListener('wheel', () => {
      updateAlphabetScrollIndicator(true);
    }, { passive: true });

    songsListContainer.addEventListener('mouseenter', () => {
      updateAlphabetScrollIndicator(false);
    });
  }

  window.addEventListener('resize', () => {
    updateSliderThumbFromSongListScroll();
    updateMobileScrollbarThumb();
    if (window.updateMobileUpNextUI) window.updateMobileUpNextUI();
  });

  if (topSliderTrack) {
    topSliderTrack.addEventListener('mousedown', (e) => {
      isDraggingSlider = true;
      updateSongListScrollFromSlider(e);
    });

    topSliderTrack.addEventListener('touchstart', (e) => {
      isDraggingSlider = true;
      updateSongListScrollFromSlider(e);
    }, { passive: true });
  }

  window.addEventListener('mousemove', (e) => {
    if (isDraggingSlider) updateSongListScrollFromSlider(e);
    if (isDraggingMobileScrollbar) handleMobileScrollbarMove(e.clientY);
  });

  window.addEventListener('touchmove', (e) => {
    if (isDraggingSlider) updateSongListScrollFromSlider(e);
    if (isDraggingMobileScrollbar) {
      e.preventDefault();
      handleMobileScrollbarMove(e.touches[0].clientY);
    }
  }, { passive: false });

  window.addEventListener('mouseup', () => {
    if (isDraggingSlider) isDraggingSlider = false;
    if (isDraggingMobileScrollbar) isDraggingMobileScrollbar = false;
  });

  window.addEventListener('touchend', () => {
    if (isDraggingSlider) isDraggingSlider = false;
    if (isDraggingMobileScrollbar) isDraggingMobileScrollbar = false;
  });

  // Dedicated Audio Timeline Seek Handlers (Desktop & Mobile)
  if (progressBarContainer) {
    progressBarContainer.addEventListener('click', (e) => {
      const rect = progressBarContainer.getBoundingClientRect();
      const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
      const percent = (x / rect.width) * 100;
      player.seek(percent);
    });
  }

  const mobilePopupProgressTrack = document.getElementById('mobilePopupProgressTrack');
  if (mobilePopupProgressTrack) {
    mobilePopupProgressTrack.addEventListener('click', (e) => {
      e.stopPropagation();
      const rect = mobilePopupProgressTrack.getBoundingClientRect();
      const clientX = e.clientX !== undefined ? e.clientX : (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
      const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
      const percent = (x / rect.width) * 100;
      player.seek(percent);
    });
  }

  const mobileFullProgressBarContainer = document.getElementById('mobileFullProgressBarContainer');
  if (mobileFullProgressBarContainer) {
    mobileFullProgressBarContainer.addEventListener('click', (e) => {
      const rect = mobileFullProgressBarContainer.getBoundingClientRect();
      const clientX = e.clientX !== undefined ? e.clientX : (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
      const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
      const percent = (x / rect.width) * 100;
      player.seek(percent);
    });
  }

  // Dedicated Artist Mini Player Timeline Seek & Controls Handlers (Image 2)
  const artistMiniProgressTrack = document.getElementById('artistMiniProgressTrack');
  if (artistMiniProgressTrack) {
    artistMiniProgressTrack.addEventListener('click', (e) => {
      e.stopPropagation();
      const rect = artistMiniProgressTrack.getBoundingClientRect();
      const clientX = e.clientX !== undefined ? e.clientX : (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
      const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
      const percent = (x / rect.width) * 100;
      player.seek(percent);
    });
  }

  const artistMiniPrevBtn = document.getElementById('artistMiniPrevBtn');
  if (artistMiniPrevBtn) {
    artistMiniPrevBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      player.prev();
    });
  }

  const artistMiniPlayPauseBtn = document.getElementById('artistMiniPlayPauseBtn');
  if (artistMiniPlayPauseBtn) {
    artistMiniPlayPauseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (allTracks.length === 0) {
        handleAddMusic();
      } else {
        player.togglePlay();
      }
    });
  }

  const artistMiniNextBtn = document.getElementById('artistMiniNextBtn');
  if (artistMiniNextBtn) {
    artistMiniNextBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      player.next();
    });
  }

  // Dedicated Artist / Library Mini Player Fav Button Handler
  const artistMiniFavBtn = document.getElementById('artistMiniFavBtn');
  if (artistMiniFavBtn) {
    artistMiniFavBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!player.currentTrack) {
        showToast('No song playing');
        return;
      }
      const added = toggleFavourite(player.currentTrack.id);
      showToast(added ? 'Added to Favourites' : 'Removed from Favourites');
      if (currentView === 'favourites') {
        renderFavouritesView();
      }
    });
  }

  // Dedicated Column View Mini Player Controls & Seeking (Image 2)
  const columnMiniPrevBtn = document.getElementById('columnMiniPrevBtn');
  if (columnMiniPrevBtn) {
    columnMiniPrevBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      player.prev();
    });
  }

  const columnMiniPlayPauseBtn = document.getElementById('columnMiniPlayPauseBtn');
  if (columnMiniPlayPauseBtn) {
    columnMiniPlayPauseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (allTracks.length === 0) {
        handleAddMusic();
      } else {
        player.togglePlay();
      }
    });
  }

  const columnMiniNextBtn = document.getElementById('columnMiniNextBtn');
  if (columnMiniNextBtn) {
    columnMiniNextBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      player.next();
    });
  }

  const columnMiniProgressTrack = document.getElementById('columnMiniProgressTrack');
  if (columnMiniProgressTrack) {
    columnMiniProgressTrack.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!player || !player.audio || !player.currentTrack) return;
      const rect = columnMiniProgressTrack.getBoundingClientRect();
      const clickX = e.clientX !== undefined ? e.clientX : (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
      const x = Math.max(0, Math.min(rect.width, clickX - rect.left));
      const percent = (x / rect.width) * 100;
      player.seek(percent);
    });
  }

  const columnMiniCoverWrapper = document.getElementById('columnMiniCoverWrapper');
  if (columnMiniCoverWrapper) {
    columnMiniCoverWrapper.addEventListener('click', (e) => {
      e.stopPropagation();
      renderExpandedPlayerView();
    });
  }

  // Unified Scroll Listener for Column View (PC View Only)
  const columnViewUnifiedScroll = document.getElementById('columnViewUnifiedScroll');
  if (columnViewUnifiedScroll) {
    columnViewUnifiedScroll.addEventListener('scroll', () => {
      if (!isColumnViewActive) return;
      updateSliderThumbFromSongListScroll();
    }, { passive: true });
  }

  // ==========================================================================
  // EXPANDED PLAYER / FULL PLAYER VIEW (PC VIEW ONLY - Artist1.png & Artist2.png)
  // ==========================================================================
  let previousViewBeforeExpanded = 'all_songs';
  let previousSelectedArtist = null;
  let previousSelectedAlbum = null;
  let previousSelectedGenre = null;
  let previousActivePlaylistId = null;
  let previousWasColumnView = false;

  function renderExpandedPlayerView() {
    if (!player || !player.currentTrack) {
      showToast('No song playing');
      return;
    }

    previousWasColumnView = isColumnViewActive;
    if (isColumnViewActive) {
      exitColumnView();
    }

    if (currentView !== 'expanded_player') {
      previousViewBeforeExpanded = currentView || 'all_songs';
      previousSelectedArtist = selectedArtistName;
      previousSelectedAlbum = selectedAlbumName;
      previousSelectedGenre = selectedGenre;
      previousActivePlaylistId = activePlaylistId;
    }

    currentView = 'expanded_player';

    // Synchronize navbar active states
    document.querySelectorAll('.menu-item-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.mobile-nav-btn').forEach(b => b.classList.remove('active'));

    updateViewSelectorLabel('Explore / Library');

    prepareViewTransition('expandedPlayerLeftSection', ['expanded-player-view-active']);

    // Toggle Right Section Sub-views
    const exploreRightNav = document.getElementById('exploreRightNav');
    const libraryEq = document.querySelector('.library-equalizer-bars');
    const libraryHeader = document.querySelector('.library-header');
    const expandedPlayerRightSection = document.getElementById('expandedPlayerRightSection');
    const miniPlayer = document.getElementById('artistMiniPlayer');
    const columnMiniPlayer = document.getElementById('columnMiniPlayer');
    const columnViewSingleBar = document.getElementById('columnViewSingleBar');

    if (exploreRightNav) exploreRightNav.style.display = 'none';
    if (libraryEq) libraryEq.style.display = 'none';
    if (libraryHeader) libraryHeader.style.display = 'none';
    if (songsListContainer) songsListContainer.style.display = 'none';
    if (pcLyricsContainer) pcLyricsContainer.style.display = 'none';
    if (columnViewSingleBar) columnViewSingleBar.style.display = 'none';
    if (expandedPlayerRightSection) expandedPlayerRightSection.style.display = 'flex';
    if (miniPlayer) {
      miniPlayer.classList.remove('visible');
      miniPlayer.style.display = 'none';
    }
    if (columnMiniPlayer) {
      columnMiniPlayer.style.display = 'none';
    }

    // Filter pills (All | Shuffle) in left panel
    if (filterAllBtn) {
      filterAllBtn.textContent = 'All';
      filterAllBtn.classList.add('active');
    }
    if (filterColumnBtn) {
      filterColumnBtn.style.display = 'none';
    }
    if (filterShuffleBtn) {
      filterShuffleBtn.textContent = 'Shuffle';
      filterShuffleBtn.classList.remove('active');
    }

    // 1. Populate Left: Top Albums of current artist
    populateExpandedTopAlbums();

    // 2. Populate Left: User Playlists
    populateExpandedPlaylists();

    // 3. Populate Right: Artist Bio & Stats
    populateExpandedArtistDetails();

    // 4. Populate Right: Favourite State
    updateExpandedFavButtonState();

    // 5. Populate Right: Large Artwork & Visual Lyrics
    updateExpandedMediaUI();
    updateExpandedCoverLyrics(true);

    // 6. Populate Right: Up Next Queue
    renderExpandedPlayerUpNext();

    // 7. Update Controls & Progress
    if (player) {
      player.updatePlayPauseUI();
      player.updateProgressUI();
    }
  }

  function collapseExpandedPlayerView() {
    const expandedPlayerLeftSection = document.getElementById('expandedPlayerLeftSection');
    const expandedPlayerRightSection = document.getElementById('expandedPlayerRightSection');
    const libraryHeader = document.querySelector('.library-header');
    const libraryEq = document.querySelector('.library-equalizer-bars');

    if (expandedPlayerLeftSection) expandedPlayerLeftSection.style.display = 'none';
    if (expandedPlayerRightSection) expandedPlayerRightSection.style.display = 'none';
    if (libraryHeader) libraryHeader.style.display = 'flex';
    if (libraryEq) libraryEq.style.display = 'flex';

    const playerBody = document.querySelector('.player-body');
    if (playerBody) {
      playerBody.classList.remove('expanded-player-view-active');
    }

    if (previousWasColumnView) {
      previousWasColumnView = false;
      renderColumnView();
      return;
    }

    // Restore previous view
    const targetView = previousViewBeforeExpanded || 'all_songs';
    if (targetView === 'artist_main') {
      renderArtistMainView();
    } else if (targetView === 'artist_detail') {
      renderArtistDetailView(previousSelectedArtist);
    } else if (targetView === 'albums_main') {
      renderAlbumsMainView();
    } else if (targetView === 'album_detail') {
      renderAlbumDetailView(previousSelectedAlbum);
    } else if (targetView === 'favourites') {
      renderFavouritesView();
    } else if (targetView === 'genre') {
      renderGenreView(previousSelectedGenre);
    } else if (targetView === 'playlists') {
      renderPlaylistsView();
    } else if (targetView === 'playlist_songs') {
      renderPlaylistSongsView(previousActivePlaylistId);
    } else if (targetView === 'explore') {
      renderExploreView();
    } else if (targetView === 'folders_main') {
      renderFoldersMainView();
    } else if (targetView === 'folder_detail') {
      renderFolderDetailView(selectedFolderName);
    } else if (targetView === 'recorder') {
      renderRecorderView();
    } else if (targetView === 'home') {
      renderHomePage();
    } else {
      setAllFilter();
    }

    if (window.updateArtistMiniPlayerVisibility) {
      window.updateArtistMiniPlayerVisibility();
    }
  }

  function populateExpandedTopAlbums() {
    const grid = document.getElementById('expandedTopAlbumsGrid');
    if (!grid) return;

    const currentArtist = player?.currentTrack?.artist || 'Unknown';
    const albums = getArtistAlbums(currentArtist);

    if (albums.length === 0) {
      grid.innerHTML = '<span style="color:#8E8E93;font-size:13px;grid-column:span 2;padding:10px 0;">No albums found for this artist</span>';
      return;
    }

    grid.innerHTML = albums.map(alb => `
      <div class="expanded-album-card" data-album-name="${escapeHtml(alb.name)}" tabindex="0" role="button" title="Open album: ${escapeHtml(alb.name)}">
        <img src="${alb.coverUrl}" alt="${escapeHtml(alb.name)}" class="expanded-album-cover" loading="lazy" onerror="this.onerror=null;this.src='assets/atsuko.svg';" />
      </div>
    `).join('');

    grid.querySelectorAll('.expanded-album-card').forEach(card => {
      card.addEventListener('click', () => {
        const albumName = card.dataset.albumName;
        if (albumName) {
          collapseExpandedPlayerView();
          renderAlbumDetailView(albumName);
        }
      });
    });
  }

  function populateExpandedPlaylists() {
    const list = document.getElementById('expandedPlaylistsList');
    if (!list) return;

    if (!playlists || playlists.length === 0) {
      list.innerHTML = '<span style="color:#8E8E93;font-size:13px;padding:10px 0;">No playlists created yet</span>';
      return;
    }

    list.innerHTML = playlists.map(pl => {
      const songCount = pl.trackIds ? pl.trackIds.length : (pl.songs ? pl.songs.length : 0);
      return `
        <div class="expanded-playlist-card" data-playlist-id="${escapeHtml(pl.id)}" tabindex="0" role="button" title="Open playlist: ${escapeHtml(pl.name)}">
          <span class="expanded-playlist-title">${escapeHtml(pl.name)}</span>
          <span class="expanded-playlist-subtitle">//${escapeHtml(pl.creator || (songCount + ' songs'))}</span>
        </div>
      `;
    }).join('');

    list.querySelectorAll('.expanded-playlist-card').forEach(card => {
      card.addEventListener('click', () => {
        const plId = card.dataset.playlistId;
        if (plId) {
          collapseExpandedPlayerView();
          renderPlaylistSongsView(plId);
        }
      });
    });
  }

  function populateExpandedArtistDetails() {
    const artistNameElem = document.getElementById('expandedArtistName');
    const artistBioTextElem = document.getElementById('expandedArtistBioText');
    const artistStatsElem = document.getElementById('expandedArtistStats');

    const currentTrack = player?.currentTrack;
    const artistName = currentTrack?.artist || 'Unknown Artist';

    if (artistNameElem) artistNameElem.textContent = artistName;

    const bioText = (currentTrack?.artistBio || currentTrack?.comment || '').trim();
    const isRealBio = Boolean(bioText && !bioText.startsWith('00000') && !bioText.startsWith('ExactAudioCopy'));

    if (artistBioTextElem) {
      if (isRealBio) {
        artistBioTextElem.innerHTML = `${escapeHtml(bioText)} <strong class="expanded-artist-more-link">more..</strong>`;
      } else {
        artistBioTextElem.textContent = 'No details available for this artist.';
      }
    }

    const listeners = currentTrack?.listeners ? String(currentTrack.listeners).trim() : '';
    const scrobbles = currentTrack?.scrobbles ? String(currentTrack.scrobbles).trim() : '';

    if (artistStatsElem) {
      if (listeners && scrobbles) {
        artistStatsElem.innerHTML = `<span>Listeners : ${escapeHtml(listeners)}</span><span>Scrobbles : ${escapeHtml(scrobbles)}</span>`;
      } else if (listeners) {
        artistStatsElem.innerHTML = `<span>Listeners : ${escapeHtml(listeners)}</span>`;
      } else if (scrobbles) {
        artistStatsElem.innerHTML = `<span>Scrobbles : ${escapeHtml(scrobbles)}</span>`;
      } else {
        artistStatsElem.innerHTML = '';
      }
    }
  }

  function updateExpandedFavButtonState() {
    const favBtn = document.getElementById('expandedFavBtn');
    if (!favBtn) return;
    const isFav = player?.currentTrack && isFavourite(player.currentTrack.id);
    favBtn.classList.toggle('active', Boolean(isFav));
  }

  function updateExpandedMediaUI() {
    const currentTrack = player?.currentTrack;
    const titleText = currentTrack?.title || 'No Songs';
    const songTitleElem = document.getElementById('expandedSongTitle');
    const coverImg = document.getElementById('expandedMainCoverImg');

    if (songTitleElem) songTitleElem.textContent = titleText;

    if (coverImg) {
      const isFallback = !currentTrack?.coverUrl || 
                         currentTrack.coverUrl.includes('M logo') || 
                         currentTrack.coverUrl.includes('Group 4');
      coverImg.src = (!isFallback && currentTrack?.coverUrl) ? currentTrack.coverUrl : 'assets/atsuko.svg';
      coverImg.alt = titleText;
      coverImg.className = `expanded-cover-art-img ${isFallback ? 'fallback-art' : ''}`;
    }
  }

  // --- Creative Synchronized Lyrics Inside Expanded Player Cover Art ---
  let lastCoverActiveLyricIndex = -1;
  let lastCoverTrackId = null;

  function parseSynchronizedLyrics(lyricsText) {
    if (!lyricsText || typeof lyricsText !== 'string') {
      return { isSynced: false, lines: [] };
    }

    const rawLines = lyricsText.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
    const timedLines = [];

    for (let i = 0; i < rawLines.length; i++) {
      const line = rawLines[i];
      const timeRegex = /\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g;
      let match;
      const timestamps = [];
      while ((match = timeRegex.exec(line)) !== null) {
        const mins = parseInt(match[1], 10);
        const secs = parseInt(match[2], 10);
        const ms = match[3] ? parseInt(match[3].padEnd(3, '0').slice(0, 3), 10) : 0;
        timestamps.push(mins * 60 + secs + ms / 1000);
      }

      const text = line.replace(/\[\d{1,2}:\d{2}(?:\.\d{1,3})?\]/g, '').trim();
      if (timestamps.length > 0 && text) {
        for (const time of timestamps) {
          timedLines.push({ time, text });
        }
      }
    }

    if (timedLines.length === 0) {
      return { isSynced: false, lines: [] };
    }

    timedLines.sort((a, b) => a.time - b.time);
    return { isSynced: true, lines: timedLines };
  }

  function getTrackSynchronizedLyrics(track) {
    if (!track) return { isSynced: false, lines: [] };
    if (track._parsedSyncedLyrics !== undefined) {
      return track._parsedSyncedLyrics;
    }

    if (track.lyrics && track.lyrics.trim()) {
      track._parsedSyncedLyrics = parseSynchronizedLyrics(track.lyrics);
      return track._parsedSyncedLyrics;
    }

    // Lazy load if not checked yet
    if (track.fileBlob && !track._lyricsChecked && window.ID3Parser) {
      track._lyricsChecked = true;
      window.ID3Parser.parse(track.fileBlob).then(meta => {
        if (meta && meta.lyrics) {
          track.lyrics = meta.lyrics.trim();
          track._parsedSyncedLyrics = parseSynchronizedLyrics(track.lyrics);
          if (window.fileManager) window.fileManager.saveTrackToDB(track);
          if (player && player.currentTrack && player.currentTrack.id === track.id) {
            updateExpandedCoverLyrics(true);
          }
        }
      }).catch(() => {});
    }

    track._parsedSyncedLyrics = { isSynced: false, lines: [] };
    return track._parsedSyncedLyrics;
  }

  function groupLyricWords(words) {
    const chunks = [];
    const connectors = new Set([
      'to', 'the', 'a', 'an', 'in', 'on', 'at', 'of', 'for', 'with', 'by', 'from',
      'up', 'down', 'what', 'you', 'me', 'my', 'your', 'his', 'her', 'our', 'their',
      'we', 'i', 'it', 'is', 'am', 'are', 'was', 'were', 'be', 'so', 'and', 'or',
      'but', 'if', 'as', 'that', 'this', 'no', 'not', 'can', 'could', 'would', 'should'
    ]);

    let i = 0;
    let largeUsed = 0;

    while (i < words.length) {
      const remaining = words.length - i;
      const word = words[i];
      const cleanWord = word.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
      const isConnector = connectors.has(cleanWord);
      const nextWord = i + 1 < words.length ? words[i + 1] : null;
      const nextClean = nextWord ? nextWord.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() : '';
      const nextIsConnector = connectors.has(nextClean);

      // Case 1: First word or anchor word (len >= 5 or strong word) -> standalone large
      if ((i === 0 || (word.length >= 6 && remaining <= 3)) && largeUsed < 2 && chunks.length < 5) {
        chunks.push({ text: word, type: 'large' });
        largeUsed++;
        i++;
        continue;
      }

      // Case 2: If next word starts a connector phrase and this word is solo -> standalone medium
      if (nextIsConnector && remaining >= 3 && chunks.length < 5 && !isConnector) {
        chunks.push({ text: word, type: 'medium' });
        i++;
        continue;
      }

      // Case 3: Next words phrase
      let groupSize = 2;
      if (isConnector && remaining >= 4) {
        groupSize = 3;
        if (remaining >= 5 && connectors.has(words[i + 2]?.replace(/[^a-zA-Z0-9]/g, '').toLowerCase())) {
          groupSize = 4;
        }
      } else if (remaining === 3) {
        groupSize = 3;
      } else if (remaining === 1) {
        groupSize = 1;
      }

      // Check if within this group there's a strong anchor word that deserves to be standalone
      if (groupSize >= 2 && remaining > groupSize) {
        const lastInGroup = words[i + groupSize - 1];
        if (lastInGroup.length >= 7 && largeUsed < 2) {
          groupSize = groupSize - 1;
        }
      }

      const phrase = words.slice(i, i + groupSize).join(' ');
      const type = (groupSize === 1 && word.length >= 6 && largeUsed < 2) ? 'large' : 'medium';
      if (type === 'large') largeUsed++;
      chunks.push({ text: phrase, type });
      i += groupSize;
    }

    // Cap at 6 visual chunks max so it never exceeds the cover height
    while (chunks.length > 6) {
      let minIdx = 0;
      let minLen = 999;
      for (let c = 0; c < chunks.length - 1; c++) {
        const len = chunks[c].text.length + chunks[c + 1].text.length;
        if (len < minLen) {
          minLen = len;
          minIdx = c;
        }
      }
      chunks[minIdx] = {
        text: `${chunks[minIdx].text} ${chunks[minIdx + 1].text}`,
        type: chunks[minIdx].type === 'large' || chunks[minIdx + 1].type === 'large' ? 'large' : 'medium'
      };
      chunks.splice(minIdx + 1, 1);
    }

    return chunks;
  }

  function formatCreativeLyricLine(rawText, isFullScreen = false) {
    if (!rawText) return '';
    const clean = rawText.replace(/^\[.*?\]\s*/g, '').replace(/\[\d+:\d+(?:\.\d+)?\]/g, '').trim();
    if (!clean) return '';

    const words = clean.split(/\s+/).filter(Boolean);
    if (words.length === 0) return '';

    let chunks = [];
    if (words.length === 1) {
      chunks = [{ text: words[0], type: 'huge' }];
    } else if (words.length === 2) {
      chunks = [
        { text: words[0], type: 'large' },
        { text: words[1], type: 'medium' }
      ];
    } else if (words.length === 3) {
      if (words[0].length <= 3) {
        chunks = [
          { text: `${words[0]} ${words[1]}`, type: 'medium' },
          { text: words[2], type: 'large' }
        ];
      } else {
        chunks = [
          { text: words[0], type: 'large' },
          { text: `${words[1]} ${words[2]}`, type: 'medium' }
        ];
      }
    } else {
      chunks = groupLyricWords(words);
    }

    if (isFullScreen) {
      return chunks.map(chunk => `<span class="full-view-lyric-chunk lyric-chunk-${chunk.type}">${escapeHtml(chunk.text)}</span>`).join('');
    }

    const totalChunks = chunks.length;
    return chunks.map((chunk) => {
      let baseFontSize = 18;
      let fontWeight = 600;
      let color = '#D6DCE1';

      if (chunk.type === 'huge') {
        baseFontSize = totalChunks === 1 ? 44 : 38;
        fontWeight = 800;
        color = '#FFFFFF';
      } else if (chunk.type === 'large') {
        if (totalChunks <= 2) baseFontSize = 36;
        else if (totalChunks <= 4) baseFontSize = 30;
        else if (totalChunks <= 5) baseFontSize = 26;
        else baseFontSize = 22;
        fontWeight = 800;
        color = '#F2F5F8';
      } else {
        if (totalChunks <= 2) baseFontSize = 24;
        else if (totalChunks <= 4) baseFontSize = 19;
        else if (totalChunks <= 5) baseFontSize = 17;
        else baseFontSize = 15;
        fontWeight = chunk.text.split(' ').length === 1 ? 700 : 600;
        color = '#D6DCE1';
      }

      // Safety scale for long text to ensure it never overflows 214px container width
      const textLen = chunk.text.length;
      const maxSafeSize = Math.floor(214 / Math.max(textLen * 0.56, 1));
      const finalSize = Math.max(13, Math.min(baseFontSize, maxSafeSize));

      return `<span class="lyric-word-chunk lyric-chunk-${chunk.type}" style="font-size: ${finalSize}px; font-weight: ${fontWeight}; color: ${color};">${escapeHtml(chunk.text)}</span>`;
    }).join('');
  }

  function updateExpandedCoverLyrics(forceUpdate = false) {
    if (currentView !== 'expanded_player') return;
    const overlay = document.getElementById('expandedLyricsVisualOverlay');
    const textContainer = document.getElementById('expandedLyricsTextLines');
    if (!overlay || !textContainer) return;

    const currentTrack = player?.currentTrack;
    if (!currentTrack) {
      overlay.style.display = 'none';
      overlay.classList.add('hidden');
      textContainer.innerHTML = '';
      lastCoverActiveLyricIndex = -1;
      lastCoverTrackId = null;
      return;
    }

    if (currentTrack.id !== lastCoverTrackId) {
      lastCoverTrackId = currentTrack.id;
      lastCoverActiveLyricIndex = -1;
      textContainer.innerHTML = '';
    }

    const { isSynced, lines } = getTrackSynchronizedLyrics(currentTrack);
    if (!isSynced || lines.length === 0) {
      overlay.style.display = 'none';
      overlay.classList.add('hidden');
      textContainer.innerHTML = '';
      lastCoverActiveLyricIndex = -1;
      return;
    }

    // Track has synchronized lyrics: compute active line from player.audio.currentTime
    const curTime = player?.audio ? player.audio.currentTime : 0;
    let activeIndex = -1;

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].time <= curTime + 0.2) {
        activeIndex = i;
      } else {
        break;
      }
    }

    // If before first line
    if (activeIndex === -1) {
      if (lines[0].time - curTime < 2.5) {
        activeIndex = 0;
      } else {
        overlay.style.display = 'flex';
        overlay.classList.remove('hidden');
        textContainer.innerHTML = '';
        lastCoverActiveLyricIndex = -1;
        return;
      }
    }

    if (activeIndex === lastCoverActiveLyricIndex && !forceUpdate) {
      return;
    }

    lastCoverActiveLyricIndex = activeIndex;
    overlay.style.display = 'flex';
    overlay.classList.remove('hidden');

    const activeLine = lines[activeIndex];
    const html = formatCreativeLyricLine(activeLine.text);

    // Update 3-dots indicator
    const dotIdx = activeIndex % 3;
    const dots = document.querySelectorAll('#expandedLyricsDots span');
    dots.forEach((dot, idx) => {
      dot.classList.toggle('active', idx === dotIdx);
    });

    if (forceUpdate || textContainer.innerHTML.trim() === '') {
      textContainer.innerHTML = html;
      textContainer.classList.remove('transitioning-out');
      textContainer.classList.add('transitioning-in');
      requestAnimationFrame(() => {
        textContainer.classList.remove('transitioning-in');
      });
      return;
    }

    // Smooth transition
    textContainer.classList.add('transitioning-out');
    setTimeout(() => {
      if (lastCoverActiveLyricIndex === activeIndex) {
        textContainer.innerHTML = html;
        textContainer.classList.remove('transitioning-out');
        textContainer.classList.add('transitioning-in');
        requestAnimationFrame(() => {
          textContainer.classList.remove('transitioning-in');
        });
      }
    }, 160);
  }

  function renderExpandedPlayerUpNext() {
    const list = document.getElementById('expandedUpNextList');
    if (!list || !player) return;

    const queue = player.queue || [];
    const currentIndex = player.currentIndex || 0;
    const upcomingSongs = queue.slice(currentIndex + 1);

    if (upcomingSongs.length === 0) {
      list.innerHTML = '<div style="color:#8E8E93;font-size:13px;padding:12px 10px;">No upcoming tracks in queue</div>';
      return;
    }

    const dotsIconSrc = 'assets/Dark Mode/DarkModeOptionsbtn.svg';

    list.innerHTML = upcomingSongs.map((track, relativeIdx) => {
      const actualQueueIdx = currentIndex + 1 + relativeIdx;
      const isFallback = !track.coverUrl || track.coverUrl.includes('M logo') || track.coverUrl.includes('Group 4');
      const coverSrc = (!isFallback && track.coverUrl) ? track.coverUrl : 'assets/atsuko-no-cover-image.svg';

      return `
        <div class="expanded-queue-item" data-queue-index="${actualQueueIdx}" tabindex="0" role="button" title="Play ${escapeHtml(track.title)}">
          <img src="${coverSrc}" alt="${escapeHtml(track.title)}" class="expanded-queue-thumb ${isFallback ? 'fallback-logo' : ''}" loading="lazy" onerror="this.onerror=null;this.src='assets/atsuko-no-cover-image.svg';" />
          <div class="expanded-queue-info">
            <span class="expanded-queue-title">${escapeHtml(track.title)}</span>
            <span class="expanded-queue-artist">//${escapeHtml(track.artist || 'Unknown')}</span>
          </div>
          <button class="expanded-queue-options-btn" data-song-id="${track.id}" title="Options" aria-label="Options">
            <img src="${dotsIconSrc}" alt="Options" width="14" height="14" />
          </button>
        </div>
      `;
    }).join('');

    list.querySelectorAll('.expanded-queue-item').forEach(item => {
      item.addEventListener('click', (e) => {
        const optionsBtn = e.target.closest('.expanded-queue-options-btn');
        if (optionsBtn) {
          e.stopPropagation();
          const songId = optionsBtn.dataset.songId;
          const song = allTracks.find(t => t.id === songId);
          if (song) showSongContextMenu(e, song);
          return;
        }
        const idx = parseInt(item.dataset.queueIndex, 10);
        if (!isNaN(idx)) {
          player.playTrackAt(idx);
          renderExpandedPlayerUpNext();
          updateExpandedMediaUI();
          populateExpandedTopAlbums();
          populateExpandedArtistDetails();
        }
      });
    });
  }

  window.updateExpandedPlayerUpNext = renderExpandedPlayerUpNext;

  // Mini Player Cover Art Click -> Open Expanded Player View
  const artistMiniCoverCard = document.getElementById('artistMiniCoverCard');
  if (artistMiniCoverCard) {
    artistMiniCoverCard.addEventListener('click', (e) => {
      e.stopPropagation();
      renderExpandedPlayerView();
    });
  }

  // Expanded Player Back Button (← Player)
  const expandedPlayerBackBtn = document.getElementById('expandedPlayerBackBtn');
  if (expandedPlayerBackBtn) {
    expandedPlayerBackBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      collapseExpandedPlayerView();
    });
  }

  // Up Next Collapse Button (v)
  const expandedUpNextCollapseBtn = document.getElementById('expandedUpNextCollapseBtn');
  if (expandedUpNextCollapseBtn) {
    expandedUpNextCollapseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      collapseExpandedPlayerView();
    });
  }

  // Expanded Favourite Button
  const expandedFavBtn = document.getElementById('expandedFavBtn');
  if (expandedFavBtn) {
    expandedFavBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!player?.currentTrack) {
        showToast('No song playing');
        return;
      }
      const added = toggleFavourite(player.currentTrack.id);
      showToast(added ? 'Added to Favourites' : 'Removed from Favourites');
      updateExpandedFavButtonState();
      updateMiniPlayerFavUI();
    });
  }

  // Expanded Play Next Button
  const expandedPlayNextBtn = document.getElementById('expandedPlayNextBtn');
  if (expandedPlayNextBtn) {
    expandedPlayNextBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!player?.currentTrack) {
        showToast('No song playing');
        return;
      }
      // Insert current track after current index in queue
      if (player.queue) {
        const curIdx = player.currentIndex || 0;
        player.queue.splice(curIdx + 1, 0, player.currentTrack);
        showToast('Playing next in queue');
        renderExpandedPlayerUpNext();
      }
    });
  }

  // Expanded Player Transport Buttons
  const expandedPrevBtn = document.getElementById('expandedPrevBtn');
  if (expandedPrevBtn) {
    expandedPrevBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      player.prev();
    });
  }

  const expandedPlayPauseBtn = document.getElementById('expandedPlayPauseBtn');
  if (expandedPlayPauseBtn) {
    expandedPlayPauseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      player.togglePlay();
    });
  }

  const expandedNextBtn = document.getElementById('expandedNextBtn');
  if (expandedNextBtn) {
    expandedNextBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      player.next();
    });
  }

  // Expanded Progress Track Seeking
  const expandedProgressTrack = document.getElementById('expandedProgressTrack');
  if (expandedProgressTrack) {
    expandedProgressTrack.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!player || !player.audio || !player.currentTrack) return;
      const rect = expandedProgressTrack.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const width = rect.width;
      const percent = Math.max(0, Math.min(1, clickX / width));
      const dur = player.audio.duration || player.currentTrack.duration || 0;
      if (dur > 0) {
        player.seek(percent * dur);
      }
    });
  }

  // Horizontal Wheel Scrolling for Genre Chips
  const expandedGenresScrollContainer = document.getElementById('expandedGenresScrollContainer');
  if (expandedGenresScrollContainer) {
    expandedGenresScrollContainer.addEventListener('wheel', (e) => {
      if (e.deltaY !== 0) {
        e.preventDefault();
        expandedGenresScrollContainer.scrollLeft += e.deltaY;
      }
    }, { passive: false });
  }

  // Genre Chips selection in Expanded Player
  document.querySelectorAll('.expanded-genre-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.expanded-genre-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
    });
  });

  // Track Change hook to keep Expanded Player, Column View & PC Views fresh
  window.onMusicoTrackChange = function(track) {
    updateMiniPlayerFavUI();
    if (currentView === 'expanded_player') {
      populateExpandedTopAlbums();
      populateExpandedArtistDetails();
      updateExpandedFavButtonState();
      updateExpandedMediaUI();
      updateExpandedCoverLyrics(true);
      renderExpandedPlayerUpNext();
    } else if (window.innerWidth > 900) {
      if (currentView === 'playlist_songs') {
        if (currentPlaylistSongsMode === 2) renderPcLyricsView();
        else if (currentPlaylistSongsMode === 3) {
          document.querySelectorAll('.masonry-card').forEach(card => {
            card.classList.toggle('is-current', player.currentTrack && card.dataset.id === player.currentTrack.id);
          });
        } else if (currentPlaylistSongsMode === 4) renderPcQueueView();
      } else if (currentView === 'artist_detail') {
        if (currentArtistDetailMode === 2) renderPcLyricsView();
        else if (currentArtistDetailMode === 3) {
          document.querySelectorAll('.masonry-card').forEach(card => {
            card.classList.toggle('is-current', player.currentTrack && card.dataset.id === player.currentTrack.id);
          });
        } else if (currentArtistDetailMode === 4) renderPcQueueView();
      } else if (currentView === 'album_detail') {
        if (currentAlbumDetailMode === 2) renderPcLyricsView();
        else if (currentAlbumDetailMode === 3) {
          document.querySelectorAll('.masonry-card').forEach(card => {
            card.classList.toggle('is-current', player.currentTrack && card.dataset.id === player.currentTrack.id);
          });
        } else if (currentAlbumDetailMode === 4) renderPcQueueView();
      } else if (currentView === 'favourites') {
        if (currentFavouritesMode === 2) renderPcLyricsView();
        else if (currentFavouritesMode === 3) {
          document.querySelectorAll('.masonry-card').forEach(card => {
            card.classList.toggle('is-current', player.currentTrack && card.dataset.id === player.currentTrack.id);
          });
        } else if (currentFavouritesMode === 4) renderPcQueueView();
      } else if (currentView === 'genre') {
        if (currentGenreMode === 2) renderPcLyricsView();
        else if (currentGenreMode === 3) {
          document.querySelectorAll('.masonry-card').forEach(card => {
            card.classList.toggle('is-current', player.currentTrack && card.dataset.id === player.currentTrack.id);
          });
        } else if (currentGenreMode === 4) renderPcQueueView();
      } else if (currentView === 'folder_detail') {
        if (currentFoldersPcMode === 2) renderPcLyricsView();
        else if (currentFoldersPcMode === 3) {
          document.querySelectorAll('.masonry-card').forEach(card => {
            card.classList.toggle('is-current', player.currentTrack && card.dataset.id === player.currentTrack.id);
          });
        } else if (currentFoldersPcMode === 4) renderPcQueueView();
      } else if (currentView === 'home') {
        renderHomeRecentPlaysSection();
        if (window.updateColumnMiniPlayerVisibility) {
          window.updateColumnMiniPlayerVisibility();
        }
      } else {
        if (currentPcMode === 2) {
          renderPcLyricsView();
        } else if (currentPcMode === 3) {
          renderPcMasonryGridView();
        } else if (currentPcMode === 4) {
          renderPcQueueView();
        }
      }
    }

    if (isColumnViewActive || currentView === 'home') {
      if (isColumnViewActive) {
        document.querySelectorAll('.masonry-card').forEach(card => {
          card.classList.toggle('is-current', player.currentTrack && card.dataset.id === player.currentTrack.id);
        });
      }
      if (window.updateColumnMiniPlayerVisibility) {
        window.updateColumnMiniPlayerVisibility();
      }
    }
  };

  // Global helper to manage Artist / Library Mini Player slide-up entrance animation & visibility
  window.updateArtistMiniPlayerVisibility = function() {
    const miniPlayer = document.getElementById('artistMiniPlayer');
    if (!miniPlayer) return;

    if (isColumnViewActive) {
      miniPlayer.classList.remove('visible');
      miniPlayer.style.display = 'none';
      if (window.updateColumnMiniPlayerVisibility) {
        window.updateColumnMiniPlayerVisibility();
      }
      return;
    }

    const isMiniPlayerActiveView = ['explore', 'playlists', 'artist_main', 'artist_detail', 'artist_detail_now_playing', 'albums_main', 'album_detail', 'favourites', 'genre', 'folders_main', 'folder_detail', 'recorder'].includes(currentView);
    const hasTrack = Boolean(player && player.currentTrack);
    const isPC = window.innerWidth > 900;

    if (currentView === 'expanded_player') {
      miniPlayer.classList.remove('visible');
      miniPlayer.style.display = 'none';
      return;
    }

    if (isMiniPlayerActiveView && hasTrack && isPC) {
      miniPlayer.style.display = 'flex';
      requestAnimationFrame(() => {
        miniPlayer.classList.add('visible');
      });
      if (songsListContainer) {
        songsListContainer.classList.add('has-mini-player');
      }
      updateMiniPlayerFavUI();
    } else {
      miniPlayer.classList.remove('visible');
      if (songsListContainer) {
        songsListContainer.classList.remove('has-mini-player');
      }
      setTimeout(() => {
        if (!miniPlayer.classList.contains('visible')) {
          miniPlayer.style.display = 'none';
        }
      }, 450);
    }
  };

  // Dedicated Column View & Home Page Mini Player Visibility Helper
  window.updateColumnMiniPlayerVisibility = function() {
    const colMini = document.getElementById('columnMiniPlayer');
    const artistMini = document.getElementById('artistMiniPlayer');
    if (!colMini) return;

    const isPC = window.innerWidth > 900;
    const hasTrack = Boolean(player && player.currentTrack);
    const isHomeOrColumn = isColumnViewActive || currentView === 'home';

    if (isHomeOrColumn && hasTrack && isPC) {
      if (artistMini) {
        artistMini.classList.remove('visible');
        artistMini.style.display = 'none';
      }
      colMini.style.display = 'flex';
    } else {
      colMini.style.display = 'none';
    }
  };

  // Search Modal / Input (Desktop, Mobile & Home buttons)
  let wasSearchOpenedFromHome = false;

  function openSearchOverlay(fromHome = false) {
    wasSearchOpenedFromHome = fromHome || (currentView === 'home');
    if (wasSearchOpenedFromHome) {
      setAllFilter();
    }
    if (searchOverlay) {
      searchOverlay.classList.add('open');
      enterSearchHistory();
      if (searchInput) {
        searchInput.focus();
        searchInput.value = searchQuery;
      }
    }
  }

  function closeSearchOverlay() {
    if (searchOverlay) searchOverlay.classList.remove('open');
    if (wasSearchOpenedFromHome && !searchQuery.trim()) {
      wasSearchOpenedFromHome = false;
      renderHomePage();
    }
  }

  const allSearchBtns = [searchBtn, document.getElementById('mobileSearchBtn'), document.getElementById('homeSearchBtn')].filter(Boolean);
  allSearchBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openSearchOverlay(btn.id === 'homeSearchBtn');
    });
  });

  if (closeSearchBtn && searchOverlay) {
    closeSearchBtn.addEventListener('click', () => {
      closeSearchOverlay();
    });
  }

  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      searchQuery = e.target.value;
      renderSongList();
      if (searchQuery.trim().length > 0) {
        enterSearchHistory();
      }
    });
  }

  // Settings Modal (Desktop, Mobile Side Button & Home Button)
  const allSettingsBtns = [settingsBtn, document.getElementById('mobileSideSettingsBtn'), document.getElementById('homeSettingsBtn')].filter(Boolean);
  allSettingsBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (settingsModal) settingsModal.classList.add('open');
    });
  });

  if (closeSettingsBtn && settingsModal) {
    closeSettingsBtn.addEventListener('click', () => {
      settingsModal.classList.remove('open');
    });
  }

  // Theme Switching Logic
  function applyTheme(theme) {
    currentTheme = theme === 'dark' ? 'dark' : 'light';
    document.body.setAttribute('data-theme', currentTheme);
    localStorage.setItem('musico-theme', currentTheme);

    const themeLightBtn = document.getElementById('themeLightBtn');
    const themeDarkBtn = document.getElementById('themeDarkBtn');
    if (themeLightBtn) themeLightBtn.classList.toggle('active', currentTheme === 'light');
    if (themeDarkBtn) themeDarkBtn.classList.toggle('active', currentTheme === 'dark');

    const isDark = currentTheme === 'dark';

    // Update Search icons
    document.querySelectorAll('#searchBtn img, #mobileSearchBtn img, #homeSearchBtn img').forEach(img => {
      img.src = isDark ? 'assets/Dark Mode/DarkModeSearchIcon.png' : 'assets/Search.png';
    });

    // Update Settings icon in desktop header
    document.querySelectorAll('#settingsBtn img, #homeSettingsBtn img').forEach(img => {
      img.src = isDark ? 'assets/Dark Mode/DarkModeSettings.png' : 'assets/Settings.png';
    });

    // Update Now Playing cover 3-dots
    document.querySelectorAll('#nowPlayingOptionsBtn img, #mobileFullOptionsBtn img').forEach(img => {
      img.src = isDark ? 'assets/Dark Mode/DarkModeOptions 3 Dots.svg' : 'assets/Options 3 Dots.svg';
    });

    // Update Prev buttons
    document.querySelectorAll('#prevBtn img, #mobileFullPrevBtn img, #mobilePopupPrevBtn img').forEach(img => {
      img.src = isDark ? 'assets/Dark Mode/DarkModePrevBtn.svg' : 'assets/Prevbtn.svg';
    });

    // Update Next buttons
    document.querySelectorAll('#nextBtn img, #mobileFullNextBtn img, #mobilePopupNextBtn img').forEach(img => {
      img.src = isDark ? 'assets/Dark Mode/DarkModeNxtBtn.svg' : 'assets/Nxtbtn.svg';
    });

    // Update Explore / Library SVGs for Dark / Light mode
    const exploreArtistBgImg = document.getElementById('exploreArtistBgImg');
    if (exploreArtistBgImg) {
      exploreArtistBgImg.src = isDark ? 'assets/LibraryItems/ArtistGraphicalBg-DarkMode.svg' : 'assets/LibraryItems/ArtistGraphicalBg.svg';
    }
    const exploreArtistMiddleImg = document.getElementById('exploreArtistMiddleImg');
    if (exploreArtistMiddleImg) {
      exploreArtistMiddleImg.src = isDark ? 'assets/LibraryItems/ArtistGraphicalMiddleCircle-DarkMode.svg' : 'assets/LibraryItems/ArtistGraphicalMiddleCircle.svg';
    }
    const exploreRecorderImg = document.getElementById('exploreRecorderImg');
    if (exploreRecorderImg) {
      exploreRecorderImg.src = isDark ? 'assets/LibraryItems/RecorderWholeGraphicalInterface-DarkMode.svg' : 'assets/LibraryItems/RecorderWholeGraphicalInterface.svg';
    }

    // Update Artist Main and Detail SVGs for Dark / Light mode
    const artistMainBgImg = document.getElementById('artistMainBgImg');
    if (artistMainBgImg) {
      artistMainBgImg.src = isDark ? 'assets/LibraryItems/ArtistGraphicalBg-DarkMode.svg' : 'assets/LibraryItems/ArtistGraphicalBg.svg';
    }
    const artistMainMiddleImg = document.getElementById('artistMainMiddleImg');
    if (artistMainMiddleImg) {
      artistMainMiddleImg.src = isDark ? 'assets/LibraryItems/ArtistGraphicalMiddleCircle-DarkMode.svg' : 'assets/LibraryItems/ArtistGraphicalMiddleCircle.svg';
    }
    const artistDetailBgImg = document.getElementById('artistDetailBgImg');
    if (artistDetailBgImg) {
      artistDetailBgImg.src = isDark ? 'assets/LibraryItems/ArtistGraphicalBg-DarkMode.svg' : 'assets/LibraryItems/ArtistGraphicalBg.svg';
    }
    const artistDetailMiddleImg = document.getElementById('artistDetailMiddleImg');
    if (artistDetailMiddleImg) {
      artistDetailMiddleImg.src = isDark ? 'assets/LibraryItems/ArtistGraphicalMiddleCircle-DarkMode.svg' : 'assets/LibraryItems/ArtistGraphicalMiddleCircle.svg';
    }

    // Update Albums Main & Detail SVGs for Dark / Light mode
    const albumMainBgImg = document.getElementById('albumMainBgImg');
    if (albumMainBgImg) {
      albumMainBgImg.src = isDark ? 'assets/LibraryItems/AlbumGraphicalThing-DarkMode.svg' : 'assets/LibraryItems/AlbumGraphicalThing.svg';
    }
    const albumDetailBgImg = document.getElementById('albumDetailBgImg');
    if (albumDetailBgImg) {
      albumDetailBgImg.src = isDark ? 'assets/LibraryItems/AlbumGraphicalThing-DarkMode.svg' : 'assets/LibraryItems/AlbumGraphicalThing.svg';
    }

    // Update Song Full View Options 3-dots icon
    const fullViewOptionsIcon = document.getElementById('fullViewOptionsIcon');
    if (fullViewOptionsIcon) {
      fullViewOptionsIcon.src = isDark ? 'assets/OptionsThreeDots.svg' : 'assets/Dark Mode/DarkModeOptionsbtn.svg';
    }

    if (isColumnViewActive) {
      renderColumnView();
    } else if (currentView === 'artist_main') {
      renderArtistMainView();
    } else if (currentView === 'artist_detail') {
      renderArtistDetailView(selectedArtistName);
    } else if (currentView === 'albums_main') {
      renderAlbumsMainView();
    } else if (currentView === 'album_detail') {
      renderAlbumDetailView(selectedAlbumName);
    } else if (currentView === 'favourites') {
      renderFavouritesView();
    } else if (currentView === 'genre') {
      renderGenreView(selectedGenre);
    } else if (currentView === 'folders_main') {
      renderFoldersMainView();
    } else if (currentView === 'folder_detail') {
      renderFolderDetailView(selectedFolderName);
    } else if (currentView === 'playlists') {
      renderPlaylistsView();
    } else if (currentView === 'expanded_player') {
      renderExpandedPlayerView();
    } else if (currentView === 'explore') {
      renderExploreView();
    } else if (currentView === 'recorder') {
      renderRecorderView();
    } else if (currentView === 'home') {
      renderHomePage();
    } else {
      renderSongList();
    }
  }

  // Explore / Library target click bindings
  document.querySelectorAll('[data-explore-target="artists"]').forEach(item => {
    item.addEventListener('click', () => {
      renderArtistMainView();
    });
  });

  document.querySelectorAll('[data-explore-target="albums"]').forEach(item => {
    item.addEventListener('click', () => {
      renderAlbumsMainView();
    });
  });

  document.querySelectorAll('[data-explore-target="favourite"]').forEach(item => {
    item.addEventListener('click', () => {
      renderFavouritesView();
    });
  });

  document.querySelectorAll('[data-explore-target="folders"]').forEach(item => {
    item.addEventListener('click', () => {
      renderFoldersMainView();
    });
  });

  document.querySelectorAll('[data-explore-target="genre"]').forEach(item => {
    item.addEventListener('click', () => {
      renderGenreView();
    });
  });

  document.querySelectorAll('[data-explore-target="recorder"]').forEach(item => {
    item.addEventListener('click', () => {
      renderRecorderView();
    });
  });

  const exploreArtistItem = document.getElementById('exploreArtistItem');
  if (exploreArtistItem) {
    exploreArtistItem.addEventListener('click', () => {
      renderArtistMainView();
    });
  }

  const explorePlaylistItem = document.getElementById('explorePlaylistItem');
  if (explorePlaylistItem) {
    explorePlaylistItem.addEventListener('click', () => {
      renderPlaylistsView();
    });
  }

  const exploreFoldersItem = document.getElementById('exploreFoldersItem');
  if (exploreFoldersItem) {
    exploreFoldersItem.addEventListener('click', () => {
      renderFoldersMainView();
    });
  }

  const exploreRecorderItem = document.getElementById('exploreRecorderItem');
  if (exploreRecorderItem) {
    exploreRecorderItem.addEventListener('click', () => {
      renderRecorderView();
    });
  }

  const themeLightBtn = document.getElementById('themeLightBtn');
  const themeDarkBtn = document.getElementById('themeDarkBtn');
  if (themeLightBtn) {
    themeLightBtn.addEventListener('click', () => {
      applyTheme('light');
      showToast('Switched to Light Mode');
    });
  }
  if (themeDarkBtn) {
    themeDarkBtn.addEventListener('click', () => {
      applyTheme('dark');
      showToast('Switched to Dark Mode');
    });
  }

  // Close modals when clicking backdrop
  window.addEventListener('click', (e) => {
    if (e.target === searchOverlay) closeSearchOverlay();
    if (e.target === settingsModal) settingsModal.classList.remove('open');
    if (playlistModal && e.target === playlistModal) closePlaylistModal();
    if (contextMenu) contextMenu.classList.remove('open');
    if (playlistContextMenu) playlistContextMenu.classList.remove('open');
    if (artistContextMenu) artistContextMenu.classList.remove('open');
    if (albumContextMenu) albumContextMenu.classList.remove('open');
    if (folderContextMenu) folderContextMenu.classList.remove('open');
    if (recordingContextMenu) recordingContextMenu.classList.remove('open');

    const homeDropdown = document.getElementById('homeViewDropdownMenu');
    if (homeDropdown && !e.target.closest('#homeViewSelectorPill') && !e.target.closest('#homeViewDropdownMenu')) {
      homeDropdown.classList.remove('open');
    }
  });

  // Mobile Back Button / Gesture Navigation (Search Results -> Back -> All Songs)
  window.addEventListener('popstate', () => {
    if (isSearchHistoryActive || (searchOverlay && searchOverlay.classList.contains('open')) || searchQuery.trim().length > 0) {
      isSearchHistoryActive = false;
      setAllFilter();
    }
  });

  // Context Menu for song options
  let contextTrackId = null;
  let contextIsInPlaylist = false;

  function showContextMenu(e, trackId, isInPlaylist = false) {
    contextTrackId = trackId;
    contextIsInPlaylist = isInPlaylist || (currentView === 'playlist_songs');
    if (!contextMenu) return;

    const removeFromPlBtn = document.getElementById('contextRemoveFromPlaylistBtn');
    if (removeFromPlBtn) {
      removeFromPlBtn.style.display = contextIsInPlaylist ? 'block' : 'none';
    }

    let clientX = e.clientX;
    let clientY = e.clientY;
    if ((clientX === undefined || clientY === undefined) && e.touches && e.touches[0]) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    }
    if (clientX === undefined || clientY === undefined) {
      const target = e.currentTarget || e.target;
      if (target && target.getBoundingClientRect) {
        const r = target.getBoundingClientRect();
        clientX = r.left + r.width / 2;
        clientY = r.bottom;
      } else {
        clientX = window.innerWidth / 2;
        clientY = window.innerHeight / 2;
      }
    }

    const x = Math.min(window.innerWidth - 190, Math.max(10, clientX - 80));
    const y = Math.min(window.innerHeight - 250, Math.max(10, clientY + 8));

    contextMenu.style.left = `${x}px`;
    contextMenu.style.top = `${y}px`;
    contextMenu.classList.add('open');
  }

  // Playlist context menu for 3-dots on playlist cards
  const playlistContextMenu = document.getElementById('playlistContextMenu');
  function showPlaylistContextMenu(e, playlistId) {
    playlistContextMenuTargetId = playlistId;
    if (!playlistContextMenu) return;

    let clientX = e.clientX;
    let clientY = e.clientY;
    if ((clientX === undefined || clientY === undefined) && e.touches && e.touches[0]) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    }
    if (clientX === undefined || clientY === undefined) {
      const target = e.currentTarget || e.target;
      if (target && target.getBoundingClientRect) {
        const r = target.getBoundingClientRect();
        clientX = r.left + r.width / 2;
        clientY = r.bottom;
      } else {
        clientX = window.innerWidth / 2;
        clientY = window.innerHeight / 2;
      }
    }

    const x = Math.min(window.innerWidth - 190, Math.max(10, clientX - 80));
    const y = Math.min(window.innerHeight - 200, Math.max(10, clientY + 8));

    playlistContextMenu.style.left = `${x}px`;
    playlistContextMenu.style.top = `${y}px`;
    playlistContextMenu.classList.add('open');
  }

  // Now Playing cover image 3-dot options buttons (PC & Mobile)
  const nowPlayingOptionsBtn = document.getElementById('nowPlayingOptionsBtn');
  const mobileFullOptionsBtn = document.getElementById('mobileFullOptionsBtn');
  [nowPlayingOptionsBtn, mobileFullOptionsBtn].forEach(btn => {
    if (btn) {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (player.currentTrack) {
          showContextMenu(e, player.currentTrack.id, currentView === 'playlist_songs');
        } else {
          showToast('No song is currently playing');
        }
      });
    }
  });

  // Song Context Menu Actions
  document.querySelectorAll('#songContextMenu .context-item').forEach(item => {
    item.addEventListener('click', async () => {
      const action = item.dataset.action;
      if (!contextTrackId) return;

      const track = allTracks.find(t => t.id === contextTrackId);
      if (!track) return;

      if (action === 'select') {
        openSelectMode(contextTrackId);
      } else if (action === 'add-to-playlist') {
        openAddToPlaylistModal([contextTrackId]);
      } else if (action === 'remove-from-playlist') {
        if (activePlaylistId) {
          const playlist = playlists.find(p => p.id === activePlaylistId);
          await fileManager.removeTrackFromPlaylist(activePlaylistId, contextTrackId);
          playlists = await fileManager.getPlaylists();
          renderPlaylistSongsView(activePlaylistId);
          showToast(`Removed "${track.title}" from "${playlist ? playlist.name : 'playlist'}"`);
        }
      } else if (action === 'play-next') {
        const currentIdx = player.currentIndex;
        const targetIdx = allTracks.findIndex(t => t.id === contextTrackId);
        if (targetIdx !== -1) {
          const [moved] = allTracks.splice(targetIdx, 1);
          allTracks.splice(currentIdx + 1, 0, moved);
          player.setQueue(allTracks, player.currentIndex, false);
          if (currentView === 'all_songs') renderSongList();
          showToast(`"${track.title}" will play next`);
        }
      } else if (action === 'info') {
        alert(`Title: ${track.title}\nArtist: ${track.artist || 'Unknown'}\nAlbum: ${track.album || 'Unknown'}\nDuration: ${track.formattedDuration || 'Unknown'}`);
      } else if (action === 'delete') {
        if (confirm(`Remove "${track.title}" from library?`)) {
          fileManager.deleteTrackFromDB(track.id);
          if (track.id === localStorage.getItem('musico-last-played-id')) {
            localStorage.removeItem('musico-last-played-id');
          }
          allTracks = allTracks.filter(t => t.id !== track.id);
          if (allTracks.length === 0) {
            player.setQueue([], 0, false);
          }
          if (currentView === 'all_songs') renderSongList();
          showToast(`Removed "${track.title}"`);
        }
      }
      contextMenu.classList.remove('open');
    });
  });

  // Playlist Context Menu Actions
  if (playlistContextMenu) {
    playlistContextMenu.querySelectorAll('.context-item').forEach(item => {
      item.addEventListener('click', async () => {
        const action = item.dataset.action;
        if (!playlistContextMenuTargetId) return;

        const playlist = playlists.find(p => p.id === playlistContextMenuTargetId);
        if (!playlist) return;

        if (action === 'play-playlist') {
          const playlistTracks = (playlist.trackIds || []).map(id => allTracks.find(t => t.id === id)).filter(Boolean);
          if (playlistTracks.length === 0) {
            showToast('Playlist is empty');
          } else {
            player.activePlaylistId = playlist.id;
            player.activePlaylistName = playlist.name;
            await fileManager.incrementPlaylistPlayCount(playlist.id);
            playlists = await fileManager.getPlaylists();
            player.setQueue(playlistTracks, 0, true);
            player.updateNowPlayingUI();
            showToast(`Playing playlist "${playlist.name}"`);
          }
        } else if (action === 'rename-playlist') {
          const newName = prompt('Enter new playlist name:', playlist.name);
          if (newName && newName.trim() && newName.trim() !== playlist.name) {
            playlist.name = newName.trim();
            await fileManager.savePlaylist(playlist);
            playlists = await fileManager.getPlaylists();
            renderPlaylistsView();
            showToast(`Renamed to "${playlist.name}"`);
          }
        } else if (action === 'delete-playlist') {
          if (confirm(`Delete playlist "${playlist.name}"? (Songs will remain in your library)`)) {
            await fileManager.deletePlaylist(playlist.id);
            playlists = await fileManager.getPlaylists();
            renderPlaylistsView();
            showToast(`Deleted playlist "${playlist.name}"`);
          }
        }
        playlistContextMenu.classList.remove('open');
      });
    });
  }

  // Artist context menu for 3-dots on artist cards
  const artistContextMenu = document.getElementById('artistContextMenu');
  function showArtistContextMenu(e, artistName) {
    artistContextMenuTargetName = artistName;
    if (!artistContextMenu) return;

    let clientX = e.clientX;
    let clientY = e.clientY;
    if ((clientX === undefined || clientY === undefined) && e.touches && e.touches[0]) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    }
    if (clientX === undefined || clientY === undefined) {
      const target = e.currentTarget || e.target;
      if (target && target.getBoundingClientRect) {
        const r = target.getBoundingClientRect();
        clientX = r.left + r.width / 2;
        clientY = r.bottom;
      } else {
        clientX = window.innerWidth / 2;
        clientY = window.innerHeight / 2;
      }
    }

    const x = Math.min(window.innerWidth - 190, Math.max(10, clientX - 80));
    const y = Math.min(window.innerHeight - 150, Math.max(10, clientY + 8));

    artistContextMenu.style.left = `${x}px`;
    artistContextMenu.style.top = `${y}px`;
    artistContextMenu.classList.add('open');
  }

  // Artist Context Menu Actions (Play this Artist, Delete Artist)
  if (artistContextMenu) {
    artistContextMenu.querySelectorAll('.context-item').forEach(item => {
      item.addEventListener('click', async () => {
        const action = item.dataset.action;
        if (!artistContextMenuTargetName) return;

        const targetArtistName = artistContextMenuTargetName;
        const artistTracks = allTracks.filter(t => (t.artist || 'Unknown').trim().toLowerCase() === targetArtistName.trim().toLowerCase());

        if (action === 'play-artist') {
          if (artistTracks.length === 0) {
            showToast(`No songs found for "${targetArtistName}"`);
          } else {
            player.activePlaylistId = null;
            player.activePlaylistName = null;
            player.setQueue(artistTracks, 0, true);
            player.updateNowPlayingUI();
            showToast(`Playing ${targetArtistName}`);
          }
        } else if (action === 'delete-artist') {
          if (confirm(`Delete artist "${targetArtistName}" and all associated songs from library?`)) {
            const deletedTrackIds = artistTracks.map(t => t.id);

            // Delete each track belonging to this artist from IndexedDB
            for (const track of artistTracks) {
              await fileManager.deleteTrackFromDB(track.id);
              if (track.id === localStorage.getItem('musico-last-played-id')) {
                localStorage.removeItem('musico-last-played-id');
              }
            }

            // Clean up playlists referencing deleted tracks
            for (const pl of playlists) {
              if (pl.trackIds && pl.trackIds.some(id => deletedTrackIds.includes(id))) {
                pl.trackIds = pl.trackIds.filter(id => !deletedTrackIds.includes(id));
                await fileManager.savePlaylist(pl);
              }
            }
            playlists = await fileManager.getPlaylists();

            // Filter out of memory
            allTracks = allTracks.filter(t => (t.artist || 'Unknown').trim().toLowerCase() !== targetArtistName.trim().toLowerCase());

            // Handle current playing song if it was in the deleted artist
            if (player.currentTrack && deletedTrackIds.includes(player.currentTrack.id)) {
              if (allTracks.length === 0) {
                player.setQueue([], 0, false);
              } else {
                player.setQueue(allTracks, 0, false);
              }
            }

            // Immediately re-render view
            if (currentView === 'artist_detail' && selectedArtistName && selectedArtistName.toLowerCase() === targetArtistName.toLowerCase()) {
              renderArtistMainView();
            } else if (currentView === 'artist_main' || currentView === 'artist_main_list' || currentView === 'artist_main_grid' || currentView === 'artists') {
              renderArtistMainView();
            } else if (currentView === 'all_songs') {
              renderSongList();
            } else if (currentView === 'playlists') {
              renderPlaylistsView();
            }

            showToast(`Deleted artist "${targetArtistName}"`);
          }
        }
        artistContextMenu.classList.remove('open');
      });
    });
  }

  // Album Context Menu Actions (Play Album, Delete Album)
  if (albumContextMenu) {
    albumContextMenu.querySelectorAll('.context-item').forEach(item => {
      item.addEventListener('click', async () => {
        const action = item.dataset.action;
        if (!albumContextMenuTargetName) return;

        const targetAlbumName = albumContextMenuTargetName;
        const albumTracks = allTracks.filter(t => (t.album || t.title || '').trim().toLowerCase() === targetAlbumName.trim().toLowerCase());

        if (action === 'play-album') {
          if (albumTracks.length === 0) {
            showToast(`No songs found for "${targetAlbumName}"`);
          } else {
            player.activePlaylistId = null;
            player.activePlaylistName = null;
            player.setQueue(albumTracks, 0, true);
            player.updateNowPlayingUI();
            showToast(`Playing album "${targetAlbumName}"`);
          }
        } else if (action === 'delete-album') {
          if (confirm(`Delete album "${targetAlbumName}" and all associated songs from library?`)) {
            const deletedTrackIds = albumTracks.map(t => t.id);

            for (const track of albumTracks) {
              await fileManager.deleteTrackFromDB(track.id);
              if (track.id === localStorage.getItem('musico-last-played-id')) {
                localStorage.removeItem('musico-last-played-id');
              }
            }

            for (const pl of playlists) {
              if (pl.trackIds && pl.trackIds.some(id => deletedTrackIds.includes(id))) {
                pl.trackIds = pl.trackIds.filter(id => !deletedTrackIds.includes(id));
                await fileManager.savePlaylist(pl);
              }
            }
            playlists = await fileManager.getPlaylists();

            allTracks = allTracks.filter(t => (t.album || t.title || '').trim().toLowerCase() !== targetAlbumName.trim().toLowerCase());

            if (player.currentTrack && deletedTrackIds.includes(player.currentTrack.id)) {
              if (allTracks.length === 0) {
                player.setQueue([], 0, false);
              } else {
                player.setQueue(allTracks, 0, false);
              }
            }

            if (currentView === 'album_detail' && selectedAlbumName && selectedAlbumName.toLowerCase() === targetAlbumName.toLowerCase()) {
              renderAlbumsMainView();
            } else if (currentView === 'albums_main') {
              renderAlbumsMainView();
            } else if (currentView === 'all_songs') {
              renderSongList();
            } else if (currentView === 'playlists') {
              renderPlaylistsView();
            }

            showToast(`Deleted album "${targetAlbumName}"`);
          }
        }
        albumContextMenu.classList.remove('open');
      });
    });
  }

  // =========================================================================
  // MULTI-SELECTION MODE CONTROLS
  // =========================================================================
  function openSelectMode(initialTrackId) {
    isSelectMode = true;
    selectedTrackIds.clear();
    if (initialTrackId) {
      selectedTrackIds.add(initialTrackId);
    }
    updateMultiSelectUI();
  }

  function exitSelectMode() {
    isSelectMode = false;
    selectedTrackIds.clear();
    updateMultiSelectUI();
  }

  function updateMultiSelectUI() {
    const bar = document.getElementById('multiSelectActionBar');
    const count = document.getElementById('multiSelectCount');
    if (bar) bar.classList.toggle('visible', isSelectMode);
    if (count) count.textContent = selectedTrackIds.size;

    if (songsListContainer) {
      songsListContainer.classList.toggle('select-mode', isSelectMode);
      songsListContainer.querySelectorAll('.song-card').forEach(card => {
        const id = card.dataset.id;
        card.classList.toggle('selected', selectedTrackIds.has(id));
      });
    }
  }

  const multiSelectAllBtn = document.getElementById('multiSelectAllBtn');
  if (multiSelectAllBtn) {
    multiSelectAllBtn.addEventListener('click', () => {
      let currentList = allTracks;
      if (currentView === 'playlist_songs' && activePlaylistId) {
        const pl = playlists.find(p => p.id === activePlaylistId);
        if (pl) currentList = (pl.trackIds || []).map(id => allTracks.find(t => t.id === id)).filter(Boolean);
      }
      if (selectedTrackIds.size === currentList.length) {
        selectedTrackIds.clear();
      } else {
        currentList.forEach(t => selectedTrackIds.add(t.id));
      }
      updateMultiSelectUI();
    });
  }

  const multiSelectCancelBtn = document.getElementById('multiSelectCancelBtn');
  if (multiSelectCancelBtn) {
    multiSelectCancelBtn.addEventListener('click', () => {
      exitSelectMode();
    });
  }

  const multiSelectAddBtn = document.getElementById('multiSelectAddBtn');
  if (multiSelectAddBtn) {
    multiSelectAddBtn.addEventListener('click', () => {
      if (selectedTrackIds.size === 0) {
        showToast('Please select at least one song');
        return;
      }
      openAddToPlaylistModal(Array.from(selectedTrackIds));
    });
  }

  // =========================================================================
  // ADD TO PLAYLIST MODAL & QUICK CREATE CONTROLS
  // =========================================================================
  const playlistModal = document.getElementById('playlistModal');
  const closePlaylistModalBtn = document.getElementById('closePlaylistModalBtn');
  const showCreatePlaylistBtn = document.getElementById('showCreatePlaylistBtn');
  const createPlaylistInputBox = document.getElementById('createPlaylistInputBox');
  const newPlaylistNameInput = document.getElementById('newPlaylistNameInput');
  const confirmCreatePlaylistBtn = document.getElementById('confirmCreatePlaylistBtn');
  const cancelCreatePlaylistBtn = document.getElementById('cancelCreatePlaylistBtn');
  const playlistSelectList = document.getElementById('playlistSelectList');

  function openAddToPlaylistModal(trackIds = []) {
    modalPendingTrackIds = Array.isArray(trackIds) ? trackIds : [trackIds];
    if (!playlistModal) return;

    if (createPlaylistInputBox) createPlaylistInputBox.style.display = 'none';
    if (showCreatePlaylistBtn) showCreatePlaylistBtn.style.display = 'block';
    if (newPlaylistNameInput) newPlaylistNameInput.value = '';

    renderPlaylistSelectList();
    playlistModal.classList.add('open');
  }

  function closePlaylistModal() {
    if (playlistModal) playlistModal.classList.remove('open');
    modalPendingTrackIds = [];
  }

  function renderPlaylistSelectList() {
    if (!playlistSelectList) return;
    if (playlists.length === 0) {
      playlistSelectList.innerHTML = `<div class="playlist-select-empty">No playlists created yet.<br>Click the button above to create one!</div>`;
      return;
    }

    playlistSelectList.innerHTML = playlists.map(p => {
      const count = p.trackIds ? p.trackIds.length : 0;
      return `
        <div class="playlist-select-item" data-playlist-id="${p.id}">
          <span class="playlist-select-name">${escapeHtml(p.name)}</span>
          <span class="playlist-select-count">${count} song${count === 1 ? '' : 's'}</span>
        </div>
      `;
    }).join('');

    playlistSelectList.querySelectorAll('.playlist-select-item').forEach(item => {
      item.addEventListener('click', async () => {
        const id = item.dataset.playlistId;
        const targetPl = playlists.find(p => p.id === id);
        if (targetPl && modalPendingTrackIds.length > 0) {
          await fileManager.addTracksToPlaylist(id, modalPendingTrackIds);
          playlists = await fileManager.getPlaylists();
          closePlaylistModal();
          exitSelectMode();
          showToast(`Added ${modalPendingTrackIds.length} song${modalPendingTrackIds.length > 1 ? 's' : ''} to "${targetPl.name}"`);
          if (currentView === 'playlists') {
            renderPlaylistsView();
          } else if (currentView === 'playlist_songs' && activePlaylistId === id) {
            renderPlaylistSongsView(id);
          }
        }
      });
    });
  }

  function openCreatePlaylistModal() {
    openAddToPlaylistModal([]);
    if (showCreatePlaylistBtn) showCreatePlaylistBtn.style.display = 'none';
    if (createPlaylistInputBox) {
      createPlaylistInputBox.style.display = 'flex';
      if (newPlaylistNameInput) {
        newPlaylistNameInput.focus();
      }
    }
  }

  if (closePlaylistModalBtn) {
    closePlaylistModalBtn.addEventListener('click', closePlaylistModal);
  }

  if (showCreatePlaylistBtn && createPlaylistInputBox) {
    showCreatePlaylistBtn.addEventListener('click', () => {
      showCreatePlaylistBtn.style.display = 'none';
      createPlaylistInputBox.style.display = 'flex';
      if (newPlaylistNameInput) {
        newPlaylistNameInput.value = '';
        newPlaylistNameInput.focus();
      }
    });
  }

  if (cancelCreatePlaylistBtn && showCreatePlaylistBtn && createPlaylistInputBox) {
    cancelCreatePlaylistBtn.addEventListener('click', () => {
      createPlaylistInputBox.style.display = 'none';
      showCreatePlaylistBtn.style.display = 'block';
    });
  }

  async function handleConfirmCreatePlaylist() {
    if (!newPlaylistNameInput) return;
    const name = newPlaylistNameInput.value.trim();
    if (!name) {
      showToast('Please enter a playlist name');
      return;
    }

    const newPlaylist = {
      id: 'pl_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
      name: name,
      trackIds: [...modalPendingTrackIds],
      playCount: 0,
      createdAt: Date.now()
    };

    await fileManager.savePlaylist(newPlaylist);
    playlists = await fileManager.getPlaylists();
    closePlaylistModal();
    exitSelectMode();

    if (modalPendingTrackIds.length > 0) {
      showToast(`Created playlist "${name}" with ${modalPendingTrackIds.length} song${modalPendingTrackIds.length > 1 ? 's' : ''}`);
    } else {
      showToast(`Created playlist "${name}"`);
    }

    if (currentView === 'playlists') {
      renderPlaylistsView();
    }
  }

  if (confirmCreatePlaylistBtn) {
    confirmCreatePlaylistBtn.addEventListener('click', handleConfirmCreatePlaylist);
  }

  if (newPlaylistNameInput) {
    newPlaylistNameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        handleConfirmCreatePlaylist();
      }
    });
  }

  // Settings Preset controls
  const eqPresets = document.querySelectorAll('.eq-preset-btn');
  eqPresets.forEach(btn => {
    btn.addEventListener('click', () => {
      eqPresets.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      showToast(`Equalizer Preset: ${btn.textContent.trim()}`);
    });
  });

  const clearLibraryBtn = document.getElementById('clearLibrarySettingsBtn');
  if (clearLibraryBtn) {
    clearLibraryBtn.addEventListener('click', async () => {
      if (confirm('Clear all imported songs?')) {
        await fileManager.clearAllTracks();
        localStorage.removeItem('musico-last-played-id');
        allTracks = [];
        player.setQueue([], 0, false);
        renderSongList();
        settingsModal.classList.remove('open');
        showToast('Library cleared. No Songs.');
      }
    });
  }

  // Volume slider in settings
  const settingsVolumeSlider = document.getElementById('settingsVolumeSlider');
  if (settingsVolumeSlider) {
    settingsVolumeSlider.value = player.volume * 100;
    settingsVolumeSlider.addEventListener('input', (e) => {
      player.setVolume(e.target.value / 100);
    });
  }

  // Drag and drop audio files onto window (Combined library)
  window.addEventListener('dragover', (e) => {
    e.preventDefault();
    document.body.classList.add('drag-over');
  });

  window.addEventListener('dragleave', (e) => {
    if (e.clientX === 0 || e.clientY === 0) {
      document.body.classList.remove('drag-over');
    }
  });

  window.addEventListener('drop', async (e) => {
    e.preventDefault();
    document.body.classList.remove('drag-over');

    const rawFiles = Array.from(e.dataTransfer.files || []);
    const files = rawFiles.filter(f => FileManager.isAudioFile(f));

    if (files.length > 0) {
      showToast(`Importing ${files.length} audio file${files.length > 1 ? 's' : ''}...`);
      const imported = await fileManager.processAudioFiles(files);
      if (imported.length > 0) {
        const existingIds = new Set(allTracks.map(t => t.id));
        const existingKeys = new Set(allTracks.map(t => `${t.fileBlob?.name || t.title}_${t.fileBlob?.size || 0}`));
        const uniqueImported = imported.filter(t => {
          const key = `${t.fileBlob?.name || t.title}_${t.fileBlob?.size || 0}`;
          return !existingIds.has(t.id) && !existingKeys.has(key);
        });
        allTracks = [...allTracks, ...uniqueImported];
        FileManager.sortTracks(allTracks);
        if (currentView === 'all_songs') {
          renderSongList();
        }
        showToast(`Added ${uniqueImported.length} song${uniqueImported.length > 1 ? 's' : ''}!`);
        if (!player.currentTrack && allTracks.length > 0) {
          player.setQueue(allTracks, 0, false);
        }
      }
    }
  });

  // Global Keyboard Shortcuts
  window.addEventListener('keydown', (e) => {
    const active = document.activeElement;
    if (active && (['INPUT', 'TEXTAREA'].includes(active.tagName) || active.isContentEditable)) return;

    // Keyboard Shortcut — L (Open / Exit Full View)
    if (e.code === 'KeyL' || e.key === 'l' || e.key === 'L') {
      const active = document.activeElement;
      if (active && (['INPUT', 'TEXTAREA'].includes(active.tagName) || active.isContentEditable)) return;
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      e.preventDefault();
      if (isSongFullViewOpen) {
        closeSongFullView();
      } else {
        if (!player || !player.currentTrack || !isSongTrackPlayable(player.currentTrack)) {
          return;
        }
        openSongFullView();
      }
      return;
    }

    if (e.code === 'Space') {
      e.preventDefault();
      if (typeof isSongFullViewOpen !== 'undefined' && isSongFullViewOpen) {
        handleFullViewSpaceOrScreenClick();
        return;
      }
      if (allTracks.length === 0) {
        handleAddMusic();
      } else {
        player.togglePlay();
      }
    } else if (e.code === 'ArrowRight') {
      e.preventDefault();
      player.seek(Math.min(100, ((player.audio.currentTime + 5) / (player.audio.duration || 1)) * 100));
    } else if (e.code === 'ArrowLeft') {
      e.preventDefault();
      player.seek(Math.max(0, ((player.audio.currentTime - 5) / (player.audio.duration || 1)) * 100));
    } else if (e.code === 'KeyN') {
      player.next();
    } else if (e.code === 'KeyP') {
      player.prev();
    } else if (e.code === 'KeyS') {
      filterShuffleBtn && filterShuffleBtn.click();
    } else if (currentView === 'recorder') {
      if (e.code === 'KeyA') {
        currentRecorderPcMode = 1;
        updateRecorderEqualizerBars();
        renderRecorderListView();
      } else if (e.code === 'KeyD') {
        currentRecorderPcMode = 2;
        updateRecorderEqualizerBars();
        renderRecorderGridView();
      } else if (e.code === 'KeyR') {
        if (isRecordingAudio) {
          stopAudioRecording();
        } else {
          startAudioRecording();
        }
      }
    }
  });

  // Helper to escape HTML strings
  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Start app
  applyTheme(currentTheme);
  await initLibrary();
  player.updatePlaybackModeUI();

  // =========================================================================
  // SINGLE-INSTANCE WINDOW COORDINATOR (PC / Windows PWA)
  // Prevents opening duplicate windows when user launches Musico again.
  // =========================================================================
  if ('launchQueue' in window && 'setConsumer' in window.launchQueue) {
    window.launchQueue.setConsumer(() => {
      window.focus();
    });
  }

  // =========================================================================
  // =========================================================================
  // PROFILE & MUSICO STATS CONTROLLER (PC VIEW ONLY) - HIGH PERFORMANCE
  // =========================================================================
  const profileBadge = document.getElementById('profileBadge');
  const profileModal = document.getElementById('profileModal');
  const closeProfileBtn = document.getElementById('closeProfileBtn');
  const profileTabBtn = document.getElementById('profileTabBtn');
  const statsTabBtn = document.getElementById('statsTabBtn');
  const profileTabContent = document.getElementById('profileTabContent');
  const statsTabContent = document.getElementById('statsTabContent');

  const profileImageFileInput = document.getElementById('profileImageFileInput');
  const changeProfileImageBtn = document.getElementById('changeProfileImageBtn');
  const profileAvatarEditBadge = document.getElementById('profileAvatarEditBadge');
  const profileAvatarWrap = document.getElementById('profileAvatarWrap');
  const profileModalAvatarImg = document.getElementById('profileModalAvatarImg');

  const sendFeedbackBtn = document.getElementById('sendFeedbackBtn');
  const feedbackModal = document.getElementById('feedbackModal');
  const closeFeedbackBtn = document.getElementById('closeFeedbackBtn');
  const cancelFeedbackBtn = document.getElementById('cancelFeedbackBtn');
  const submitFeedbackBtn = document.getElementById('submitFeedbackBtn');
  const feedbackTextarea = document.getElementById('feedbackTextarea');

  const userManualBtn = document.getElementById('userManualBtn');
  const userManualModal = document.getElementById('userManualModal');
  const closeUserManualBtn = document.getElementById('closeUserManualBtn');

  // Performance cache flags
  let _isProfileTabRendered = false;
  let _isStatsTabRendered = false;
  let _statsDataDirty = true;
  let _profileDataDirty = true;
  let _profileModalOpen = false;
  let _realtimeUpdateTimeout = null;

  // Load and apply initial profile data
  async function initUserProfile() {
    const fm = window.fileManager || window.appFileManager || fileManager;
    let profile = null;
    if (fm && typeof fm.getProfileData === 'function') {
      try {
        profile = await fm.getProfileData();
      } catch (_) {}
    }

    const currentAvatar = (profile && profile.avatarUrl) || localStorage.getItem('musico_profile_image') || localStorage.getItem('musico_profile_avatar') || 'assets/default-avatar.svg';
    const currentName = (profile && (profile.username || profile.name)) || localStorage.getItem('musico_profile_username') || localStorage.getItem('musico_profile_name') || 'USER';

    // 1. Update avatars across all badges, greeting, and modal
    const navAvatar = document.querySelector('#profileBadge .profile-avatar-img');
    if (navAvatar && navAvatar.src !== currentAvatar) {
      navAvatar.src = currentAvatar;
    }
    const homeAvatar = document.getElementById('homeProfileAvatarImg');
    if (homeAvatar && homeAvatar.src !== currentAvatar) {
      homeAvatar.src = currentAvatar;
    }
    const homeGreetingAvatar = document.getElementById('homeGreetingAvatarImg');
    if (homeGreetingAvatar && homeGreetingAvatar.src !== currentAvatar) {
      homeGreetingAvatar.src = currentAvatar;
    }
    if (profileModalAvatarImg && profileModalAvatarImg.src !== currentAvatar) {
      profileModalAvatarImg.src = currentAvatar;
    }

    // 2. Update username everywhere (Default: USER)
    const profileUserNameTitle = document.getElementById('profileUserNameTitle');
    if (profileUserNameTitle && !profileUserNameTitle.querySelector('input') && profileUserNameTitle.textContent !== currentName) {
      profileUserNameTitle.textContent = currentName;
    }
    const aboutYouUsername = document.getElementById('aboutYouUsername');
    if (aboutYouUsername && aboutYouUsername.textContent !== currentName) {
      aboutYouUsername.textContent = currentName;
    }
    const navProfileUserName = document.getElementById('navProfileUserName') || document.querySelector('#profileBadge .profile-user-name');
    if (navProfileUserName && navProfileUserName.textContent !== currentName) {
      navProfileUserName.textContent = currentName;
    }
    const homeProfileUserName = document.getElementById('homeProfileUserName');
    if (homeProfileUserName && homeProfileUserName.textContent !== currentName) {
      homeProfileUserName.textContent = currentName;
    }
    const homeGreetingUsername = document.getElementById('homeGreetingUsername');
    if (homeGreetingUsername && homeGreetingUsername.textContent !== currentName) {
      homeGreetingUsername.textContent = currentName;
    }
    const profileBadgePill = document.getElementById('profileBadge');
    if (profileBadgePill) profileBadgePill.title = `User Profile: ${currentName}`;
    const homeProfileBadge = document.getElementById('homeProfileBadge');
    if (homeProfileBadge) homeProfileBadge.title = `User Profile: ${currentName}`;

    // Ensure synchronized keys in localStorage
    try {
      localStorage.setItem('musico_profile_username', currentName);
      localStorage.setItem('musico_profile_name', currentName);
      if (currentAvatar && !currentAvatar.includes('default-avatar.svg')) {
        localStorage.setItem('musico_profile_image', currentAvatar);
        localStorage.setItem('musico_profile_avatar', currentAvatar);
      }
    } catch (_) {}

    // 3. Days using Musico
    const days = Math.max(1, Math.floor((Date.now() - ((profile && profile.firstLaunchDate) || Date.now())) / (1000 * 60 * 60 * 24)));
    const profileDaysLabel = document.getElementById('profileDaysLabel');
    if (profileDaysLabel) {
      const daysText = `Using Atsuko for ${days} days`;
      if (profileDaysLabel.textContent !== daysText) {
        profileDaysLabel.textContent = daysText;
      }
    }

    // 4. Joined date in About You
    const aboutYouJoined = document.getElementById('aboutYouJoined');
    if (aboutYouJoined) {
      const dateObj = new Date((profile && profile.firstLaunchDate) || Date.now());
      const joinedStr = dateObj.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
      if (aboutYouJoined.textContent !== joinedStr) {
        aboutYouJoined.textContent = joinedStr;
      }
    }
  }

  // Double-click / Edit button to change username inline
  function startEditingUserName() {
    const titleEl = document.getElementById('profileUserNameTitle');
    if (!titleEl || titleEl.querySelector('input')) return;

    const currentName = titleEl.textContent.trim() || 'USER';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'profile-name-edit-input';
    input.value = currentName === 'USER' ? '' : currentName;
    input.placeholder = 'Enter name...';
    input.maxLength = 28;

    let isSaved = false;

    const saveName = async () => {
      if (isSaved) return;
      isSaved = true;

      const rawVal = input.value.trim();
      const newName = rawVal ? rawVal : 'USER';
      titleEl.textContent = newName;

      // Update in DOM everywhere
      const aboutYou = document.getElementById('aboutYouUsername');
      if (aboutYou) aboutYou.textContent = newName;
      const navName = document.getElementById('navProfileUserName') || document.querySelector('#profileBadge .profile-user-name');
      if (navName) navName.textContent = newName;
      const homeName = document.getElementById('homeProfileUserName');
      if (homeName) homeName.textContent = newName;
      const homeGreeting = document.getElementById('homeGreetingUsername');
      if (homeGreeting) homeGreeting.textContent = newName;
      const profileBadgePill = document.getElementById('profileBadge');
      if (profileBadgePill) profileBadgePill.title = `User Profile: ${newName}`;
      const homeProfileBadge = document.getElementById('homeProfileBadge');
      if (homeProfileBadge) homeProfileBadge.title = `User Profile: ${newName}`;

      // Persist to storage across both keys
      try {
        localStorage.setItem('musico_profile_username', newName);
        localStorage.setItem('musico_profile_name', newName);
      } catch (_) {}

      const fm = window.fileManager || window.appFileManager || fileManager;
      if (fm && typeof fm.saveProfileUsername === 'function') {
        await fm.saveProfileUsername(newName);
      } else {
        localStorage.setItem('musico_profile_username', newName);
      }

      showToast(`Username updated to "${newName}"`);
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        input.blur();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        isSaved = true;
        titleEl.textContent = currentName;
      }
    });

    input.addEventListener('blur', () => {
      saveName();
    });

    titleEl.textContent = '';
    titleEl.appendChild(input);
    input.focus();
    input.select();
  }

  const profileUserNameTitle = document.getElementById('profileUserNameTitle');
  if (profileUserNameTitle) {
    profileUserNameTitle.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      startEditingUserName();
    });
  }

  const editUserNameBtn = document.getElementById('editUserNameBtn');
  if (editUserNameBtn) {
    editUserNameBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      startEditingUserName();
    });
  }

  const aboutYouUsername = document.getElementById('aboutYouUsername');
  if (aboutYouUsername) {
    aboutYouUsername.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      startEditingUserName();
    });
  }

  initUserProfile();

  // Instant Tab switching inside Profile Modal
  function switchProfileModalTab(tabName) {
    if (tabName === 'stats') {
      if (profileTabBtn) profileTabBtn.classList.remove('active');
      if (statsTabBtn) statsTabBtn.classList.add('active');
      if (profileTabContent) profileTabContent.style.display = 'none';
      if (statsTabContent) statsTabContent.style.display = 'flex';
      
      if (!_isStatsTabRendered || _statsDataDirty) {
        renderMusicoStats();
        _isStatsTabRendered = true;
        _statsDataDirty = false;
      }
    } else {
      if (profileTabBtn) profileTabBtn.classList.add('active');
      if (statsTabBtn) statsTabBtn.classList.remove('active');
      if (profileTabContent) profileTabContent.style.display = 'flex';
      if (statsTabContent) statsTabContent.style.display = 'none';

      if (!_isProfileTabRendered || _profileDataDirty) {
        renderProfileTab();
        _isProfileTabRendered = true;
        _profileDataDirty = false;
      }
    }
  }

  if (profileTabBtn) {
    profileTabBtn.addEventListener('click', () => switchProfileModalTab('profile'));
  }
  if (statsTabBtn) {
    statsTabBtn.addEventListener('click', () => switchProfileModalTab('stats'));
  }

  function openProfileModal() {
    _profileModalOpen = true;
    initUserProfile();
    renderProfileTab();
    _isProfileTabRendered = true;
    _profileDataDirty = false;
    switchProfileModalTab('profile');
    if (profileModal) profileModal.classList.add('open');

    // Pre-render stats in the next idle animation frame for instant zero-lag switching
    requestAnimationFrame(() => {
      renderMusicoStats();
      _isStatsTabRendered = true;
      _statsDataDirty = false;
    });
  }
  window.openProfileModal = openProfileModal;

  // Open & Close Profile Modal
  const allProfileBadges = [profileBadge, document.getElementById('homeProfileBadge')].filter(Boolean);
  allProfileBadges.forEach(badge => {
    badge.addEventListener('click', (e) => {
      e.stopPropagation();
      openProfileModal();
    });
  });

  if (closeProfileBtn && profileModal) {
    closeProfileBtn.addEventListener('click', () => {
      _profileModalOpen = false;
      profileModal.classList.remove('open');
    });
  }

  if (profileModal) {
    profileModal.addEventListener('click', (e) => {
      if (e.target === profileModal) {
        _profileModalOpen = false;
        profileModal.classList.remove('open');
      }
    });
  }

  // Change Profile Picture Handler
  function triggerProfileImagePicker() {
    if (profileImageFileInput) profileImageFileInput.click();
  }

  if (changeProfileImageBtn) changeProfileImageBtn.addEventListener('click', triggerProfileImagePicker);
  if (profileAvatarEditBadge) profileAvatarEditBadge.addEventListener('click', (e) => { e.stopPropagation(); triggerProfileImagePicker(); });
  if (profileAvatarWrap) profileAvatarWrap.addEventListener('click', triggerProfileImagePicker);

  if (profileImageFileInput) {
    profileImageFileInput.addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;

      if (!file.type.startsWith('image/')) {
        showToast('Please select a valid image file');
        return;
      }

      const reader = new FileReader();
      reader.onload = async (event) => {
        const dataUrl = event.target.result;
        const fm = window.fileManager || window.appFileManager || fileManager;
        if (fm && typeof fm.saveProfileImage === 'function') {
          await fm.saveProfileImage(dataUrl);
        }

        try {
          localStorage.setItem('musico_profile_image', dataUrl);
          localStorage.setItem('musico_profile_avatar', dataUrl);
        } catch (_) {}

        const navAvatar = document.querySelector('#profileBadge .profile-avatar-img');
        if (navAvatar) navAvatar.src = dataUrl;
        const homeAvatar = document.getElementById('homeProfileAvatarImg');
        if (homeAvatar) homeAvatar.src = dataUrl;
        const homeGreetingAvatar = document.getElementById('homeGreetingAvatarImg');
        if (homeGreetingAvatar) homeGreetingAvatar.src = dataUrl;
        if (profileModalAvatarImg) profileModalAvatarImg.src = dataUrl;

        showToast('Profile image updated');
      };
      reader.readAsDataURL(file);
    });
  }

  // Feedback Modal handlers
  if (sendFeedbackBtn && feedbackModal) {
    sendFeedbackBtn.addEventListener('click', () => {
      if (feedbackTextarea) feedbackTextarea.value = '';
      feedbackModal.classList.add('open');
    });
  }
  if (closeFeedbackBtn && feedbackModal) {
    closeFeedbackBtn.addEventListener('click', () => feedbackModal.classList.remove('open'));
  }
  if (cancelFeedbackBtn && feedbackModal) {
    cancelFeedbackBtn.addEventListener('click', () => feedbackModal.classList.remove('open'));
  }
  if (feedbackModal) {
    feedbackModal.addEventListener('click', (e) => {
      if (e.target === feedbackModal) feedbackModal.classList.remove('open');
    });
  }
  if (submitFeedbackBtn && feedbackModal) {
    submitFeedbackBtn.addEventListener('click', async () => {
      const text = feedbackTextarea ? feedbackTextarea.value.trim() : '';
      if (!text) {
        showToast('Please enter your feedback first');
        return;
      }
      try {
        const existing = JSON.parse(localStorage.getItem('musico_user_feedback') || '[]');
        existing.push({ text, timestamp: Date.now() });
        localStorage.setItem('musico_user_feedback', JSON.stringify(existing));
      } catch (e) {}

      showToast('Thank you for your feedback!');
      feedbackModal.classList.remove('open');
    });
  }

  // User Manual Modal handlers
  if (userManualBtn && userManualModal) {
    userManualBtn.addEventListener('click', () => userManualModal.classList.add('open'));
  }
  if (closeUserManualBtn && userManualModal) {
    closeUserManualBtn.addEventListener('click', () => userManualModal.classList.remove('open'));
  }
  if (userManualModal) {
    userManualModal.addEventListener('click', (e) => {
      if (e.target === userManualModal) userManualModal.classList.remove('open');
    });
  }

  // Render Profile Tab Details (O(1) from in-memory cache)
  async function renderProfileTab() {
    const fm = window.fileManager || window.appFileManager || fileManager;
    if (!fm) return;
    const stats = await fm.getPlaybackStats();

    const totalSecs = Math.round(stats.totalListeningSeconds || 0);
    const hours = Math.floor(totalSecs / 3600);
    const mins = Math.floor((totalSecs % 3600) / 60);
    const secs = totalSecs % 60;
    let timeStr = '0 Minutes';
    if (hours > 0) {
      timeStr = mins > 0 ? `${hours} h ${mins} min` : `${hours} Hour${hours === 1 ? '' : 's'}`;
    } else if (mins > 0) {
      timeStr = `${mins} Minute${mins === 1 ? '' : 's'}`;
    } else if (secs > 0) {
      timeStr = `${secs} Seconds`;
    }

    const aboutYouListeningTime = document.getElementById('aboutYouListeningTime');
    if (aboutYouListeningTime && aboutYouListeningTime.textContent !== timeStr) {
      aboutYouListeningTime.textContent = timeStr;
    }

    // Recover songsPlayed count from tracks playCount if totalSongsPlayed is currently 0
    let totalSongs = stats.totalSongsPlayed || 0;
    if (totalSongs === 0 && allTracks && allTracks.length > 0) {
      let sumPlays = 0;
      allTracks.forEach(t => { if (t.playCount) sumPlays += t.playCount; });
      if (sumPlays > 0) {
        totalSongs = sumPlays;
        stats.totalSongsPlayed = sumPlays;
        fm.savePlaybackStats(stats);
      }
    }

    const songsPlayedStr = totalSongs.toLocaleString();
    const aboutYouSongsPlayed = document.getElementById('aboutYouSongsPlayed');
    if (aboutYouSongsPlayed && aboutYouSongsPlayed.textContent !== songsPlayedStr) {
      aboutYouSongsPlayed.textContent = songsPlayedStr;
    }
  }

  // Render Musico Stats Tab Details (Optimized single-pass O(N) / O(1) calculations)
  async function renderMusicoStats() {
    const fm = window.fileManager || window.appFileManager || fileManager;
    if (!fm) return;
    const stats = await fm.getPlaybackStats();

    // 1. Total Listening Time
    const totalSecs = Math.round(stats.totalListeningSeconds || 0);
    const hours = Math.floor(totalSecs / 3600);
    const mins = Math.floor((totalSecs % 3600) / 60);
    const secs = totalSecs % 60;
    let timeStr = '0 Minutes';
    if (hours > 0) {
      timeStr = mins > 0 ? `${hours} h ${mins} min` : `${hours} Hour${hours === 1 ? '' : 's'}`;
    } else if (mins > 0) {
      timeStr = `${mins} Minute${mins === 1 ? '' : 's'}`;
    } else if (secs > 0) {
      timeStr = `${secs} Seconds`;
    }
    const statsTotalListeningTime = document.getElementById('statsTotalListeningTime');
    if (statsTotalListeningTime && statsTotalListeningTime.textContent !== timeStr) {
      statsTotalListeningTime.textContent = timeStr;
    }

    // 2. Songs Played (Recover from track playCounts if totalSongsPlayed is 0)
    let totalSongs = stats.totalSongsPlayed || 0;
    if (totalSongs === 0 && allTracks && allTracks.length > 0) {
      let sumPlays = 0;
      allTracks.forEach(t => { if (t.playCount) sumPlays += t.playCount; });
      if (sumPlays > 0) {
        totalSongs = sumPlays;
        stats.totalSongsPlayed = sumPlays;
        fm.savePlaybackStats(stats);
      }
    }
    const songsPlayedStr = totalSongs.toLocaleString();
    const statsTotalSongsPlayed = document.getElementById('statsTotalSongsPlayed');
    if (statsTotalSongsPlayed && statsTotalSongsPlayed.textContent !== songsPlayedStr) {
      statsTotalSongsPlayed.textContent = songsPlayedStr;
    }

    // 3. Days Using Musico
    const days = Math.max(1, Math.floor((Date.now() - (stats.firstLaunchDate || Date.now())) / (1000 * 60 * 60 * 24)));
    const statsDaysUsing = document.getElementById('statsDaysUsing');
    const daysText = `${days} Days`;
    if (statsDaysUsing && statsDaysUsing.textContent !== daysText) {
      statsDaysUsing.textContent = daysText;
    }

    // 4. Most Played Song (Single-pass lookup)
    let mostPlayedTrack = null;
    let maxPlays = 0;
    let topTrackId = null;
    const trackPlayCounts = stats.trackPlayCounts || {};
    for (const id in trackPlayCounts) {
      if (trackPlayCounts[id] > maxPlays) {
        maxPlays = trackPlayCounts[id];
        topTrackId = id;
      }
    }

    if (topTrackId && allTracks && allTracks.length > 0) {
      for (let i = 0; i < allTracks.length; i++) {
        if (allTracks[i].id === topTrackId || allTracks[i].name === topTrackId) {
          mostPlayedTrack = allTracks[i];
          break;
        }
      }
    }

    if (!mostPlayedTrack && allTracks && allTracks.length > 0) {
      let fallbackMax = 0;
      for (let i = 0; i < allTracks.length; i++) {
        const pc = allTracks[i].playCount || 0;
        if (pc > fallbackMax) {
          fallbackMax = pc;
          mostPlayedTrack = allTracks[i];
        }
      }
    }

    const statsMostPlayedTitle = document.getElementById('statsMostPlayedTitle');
    const statsMostPlayedArtist = document.getElementById('statsMostPlayedArtist');
    const statsMostPlayedThumb = document.getElementById('statsMostPlayedThumb');
    if (mostPlayedTrack) {
      const title = mostPlayedTrack.title || mostPlayedTrack.name || 'Untitled';
      const artist = mostPlayedTrack.artist || 'Unknown Artist';
      const cover = mostPlayedTrack.coverUrl || 'assets/atsuko.svg';
      if (statsMostPlayedTitle && statsMostPlayedTitle.textContent !== title) statsMostPlayedTitle.textContent = title;
      if (statsMostPlayedArtist && statsMostPlayedArtist.textContent !== artist) statsMostPlayedArtist.textContent = artist;
      if (statsMostPlayedThumb && statsMostPlayedThumb.src !== cover) statsMostPlayedThumb.src = cover;
    } else {
      if (statsMostPlayedTitle && statsMostPlayedTitle.textContent !== 'No songs played yet') statsMostPlayedTitle.textContent = 'No songs played yet';
      if (statsMostPlayedArtist && statsMostPlayedArtist.textContent !== '—') statsMostPlayedArtist.textContent = '—';
      if (statsMostPlayedThumb && !statsMostPlayedThumb.src.includes('M%20logo.png')) statsMostPlayedThumb.src = 'assets/atsuko.svg';
    }

    // 5. Favorite Artist (Single-pass lookup)
    let topArtist = null;
    let topArtistPlays = 0;
    const artistPlayCounts = stats.artistPlayCounts || {};
    for (const art in artistPlayCounts) {
      if (artistPlayCounts[art] > topArtistPlays) {
        topArtistPlays = artistPlayCounts[art];
        topArtist = art;
      }
    }

    if (!topArtist && allTracks && allTracks.length > 0) {
      const artMap = Object.create(null);
      let maxArtScore = 0;
      for (let i = 0; i < allTracks.length; i++) {
        const t = allTracks[i];
        const a = (t.artist || '').trim();
        if (a && a !== 'Unknown Artist' && a !== 'Unknown') {
          const score = (artMap[a] || 0) + (t.isFavorite ? 3 : 1) + (t.playCount || 0);
          artMap[a] = score;
          if (score > maxArtScore) {
            maxArtScore = score;
            topArtist = a;
          }
        }
      }
    }

    const statsFavArtistTitle = document.getElementById('statsFavArtistTitle');
    const statsFavArtistSub = document.getElementById('statsFavArtistSub');
    const statsFavArtistThumb = document.getElementById('statsFavArtistThumb');
    if (topArtist) {
      if (statsFavArtistTitle && statsFavArtistTitle.textContent !== topArtist) {
        statsFavArtistTitle.textContent = topArtist;
      }
      let artistSongCount = 0;
      let coverUrl = null;
      const lowerArt = topArtist.toLowerCase();
      if (allTracks) {
        for (let i = 0; i < allTracks.length; i++) {
          const t = allTracks[i];
          if ((t.artist || '').toLowerCase() === lowerArt) {
            artistSongCount++;
            if (!coverUrl && t.coverUrl && !t.coverUrl.includes('M logo')) {
              coverUrl = t.coverUrl;
            }
          }
        }
      }
      const countStr = `${artistSongCount} song${artistSongCount === 1 ? '' : 's'}`;
      if (statsFavArtistSub && statsFavArtistSub.textContent !== countStr) statsFavArtistSub.textContent = countStr;
      const finalThumb = coverUrl || 'assets/atsuko.svg';
      if (statsFavArtistThumb && statsFavArtistThumb.src !== finalThumb) statsFavArtistThumb.src = finalThumb;
    } else {
      if (statsFavArtistTitle && statsFavArtistTitle.textContent !== 'No artist data yet') statsFavArtistTitle.textContent = 'No artist data yet';
      if (statsFavArtistSub && statsFavArtistSub.textContent !== '—') statsFavArtistSub.textContent = '—';
      if (statsFavArtistThumb && !statsFavArtistThumb.src.includes('M%20logo.png')) statsFavArtistThumb.src = 'assets/atsuko.svg';
    }

    // 6. Favorite Album (Single-pass lookup)
    let topAlbum = null;
    let topAlbumPlays = 0;
    const albumPlayCounts = stats.albumPlayCounts || {};
    for (const alb in albumPlayCounts) {
      if (albumPlayCounts[alb] > topAlbumPlays) {
        topAlbumPlays = albumPlayCounts[alb];
        topAlbum = alb;
      }
    }

    if (!topAlbum && allTracks && allTracks.length > 0) {
      const albMap = Object.create(null);
      let maxAlbScore = 0;
      for (let i = 0; i < allTracks.length; i++) {
        const t = allTracks[i];
        const a = (t.album || '').trim();
        if (a && a !== 'Unknown Album' && a !== 'Unknown') {
          const score = (albMap[a] || 0) + (t.isFavorite ? 3 : 1) + (t.playCount || 0);
          albMap[a] = score;
          if (score > maxAlbScore) {
            maxAlbScore = score;
            topAlbum = a;
          }
        }
      }
    }

    const statsFavAlbumTitle = document.getElementById('statsFavAlbumTitle');
    const statsFavAlbumSub = document.getElementById('statsFavAlbumSub');
    const statsFavAlbumThumb = document.getElementById('statsFavAlbumThumb');
    if (topAlbum) {
      if (statsFavAlbumTitle && statsFavAlbumTitle.textContent !== topAlbum) {
        statsFavAlbumTitle.textContent = topAlbum;
      }
      let albArtist = 'Various Artists';
      let coverUrl = null;
      const lowerAlb = topAlbum.toLowerCase();
      if (allTracks) {
        for (let i = 0; i < allTracks.length; i++) {
          const t = allTracks[i];
          if ((t.album || '').toLowerCase() === lowerAlb) {
            if (t.artist && albArtist === 'Various Artists') albArtist = t.artist;
            if (!coverUrl && t.coverUrl && !t.coverUrl.includes('M logo')) {
              coverUrl = t.coverUrl;
            }
          }
        }
      }
      if (statsFavAlbumSub && statsFavAlbumSub.textContent !== albArtist) statsFavAlbumSub.textContent = albArtist;
      const finalThumb = coverUrl || 'assets/atsuko-no-cover-image.svg';
      if (statsFavAlbumThumb && statsFavAlbumThumb.src !== finalThumb) statsFavAlbumThumb.src = finalThumb;
    } else {
      if (statsFavAlbumTitle && statsFavAlbumTitle.textContent !== 'No album data yet') statsFavAlbumTitle.textContent = 'No album data yet';
      if (statsFavAlbumSub && statsFavAlbumSub.textContent !== '—') statsFavAlbumSub.textContent = '—';
      if (statsFavAlbumThumb && !statsFavAlbumThumb.src.includes('M%20logo%20for%20music%20items.png')) statsFavAlbumThumb.src = 'assets/atsuko-no-cover-image.svg';
    }

    // 7. Favorite Genre (O(1))
    let topGenre = null;
    let topGenrePlays = 0;
    const genrePlayCounts = stats.genrePlayCounts || {};
    for (const gen in genrePlayCounts) {
      if (genrePlayCounts[gen] > topGenrePlays) {
        topGenrePlays = genrePlayCounts[gen];
        topGenre = gen;
      }
    }
    if (!topGenre) topGenre = 'Melancholic';
    const statsFavGenre = document.getElementById('statsFavGenre');
    if (statsFavGenre && statsFavGenre.textContent !== topGenre) statsFavGenre.textContent = topGenre;

    // 8. Favorite Language (O(1))
    let topLanguage = null;
    let topLangPlays = 0;
    const langPlayCounts = stats.languagePlayCounts || {};
    for (const lang in langPlayCounts) {
      if (langPlayCounts[lang] > topLangPlays) {
        topLangPlays = langPlayCounts[lang];
        topLanguage = lang;
      }
    }
    if (!topLanguage) topLanguage = 'Offline Local';
    const statsFavLanguage = document.getElementById('statsFavLanguage');
    if (statsFavLanguage && statsFavLanguage.textContent !== topLanguage) statsFavLanguage.textContent = topLanguage;

    // 9. Most Active Listening Time Period (O(1))
    const dist = stats.timeDistribution || { morning: 0, afternoon: 0, evening: 0, night: 0 };
    const totalDistSecs = (dist.morning || 0) + (dist.afternoon || 0) + (dist.evening || 0) + (dist.night || 0);

    const periods = [
      { name: 'Morning', sub: '(6 AM – 12 PM)', val: dist.morning || 0 },
      { name: 'Afternoon', sub: '(12 PM – 6 PM)', val: dist.afternoon || 0 },
      { name: 'Evening', sub: '(6 PM – 12 AM)', val: dist.evening || 0 },
      { name: 'Night', sub: '(12 AM – 6 AM)', val: dist.night || 0 }
    ];

    periods.sort((a, b) => b.val - a.val);
    const topPeriod = periods[0].val > 0 ? periods[0] : { name: 'Evening', sub: '(6 PM – 12 AM)' };

    const statsMostActivePeriod = document.getElementById('statsMostActivePeriod');
    const statsMostActivePeriodSub = document.getElementById('statsMostActivePeriodSub');
    if (statsMostActivePeriod && statsMostActivePeriod.textContent !== topPeriod.name) statsMostActivePeriod.textContent = topPeriod.name;
    if (statsMostActivePeriodSub && statsMostActivePeriodSub.textContent !== topPeriod.sub) statsMostActivePeriodSub.textContent = topPeriod.sub;

    // 10. Listening Time Distribution Percentages (O(1))
    let mPct = 0, aPct = 0, ePct = 0, nPct = 0;
    if (totalDistSecs > 0) {
      mPct = Math.round(((dist.morning || 0) / totalDistSecs) * 100);
      aPct = Math.round(((dist.afternoon || 0) / totalDistSecs) * 100);
      ePct = Math.round(((dist.evening || 0) / totalDistSecs) * 100);
      nPct = Math.max(0, 100 - mPct - aPct - ePct);
    }

    const distMorningPct = document.getElementById('distMorningPct');
    const distAfternoonPct = document.getElementById('distAfternoonPct');
    const distEveningPct = document.getElementById('distEveningPct');
    const distNightPct = document.getElementById('distNightPct');

    const distMorningFill = document.getElementById('distMorningFill');
    const distAfternoonFill = document.getElementById('distAfternoonFill');
    const distEveningFill = document.getElementById('distEveningFill');
    const distNightFill = document.getElementById('distNightFill');

    const mStr = `${mPct}%`, aStr = `${aPct}%`, eStr = `${ePct}%`, nStr = `${nPct}%`;
    if (distMorningPct && distMorningPct.textContent !== mStr) distMorningPct.textContent = mStr;
    if (distAfternoonPct && distAfternoonPct.textContent !== aStr) distAfternoonPct.textContent = aStr;
    if (distEveningPct && distEveningPct.textContent !== eStr) distEveningPct.textContent = eStr;
    if (distNightPct && distNightPct.textContent !== nStr) distNightPct.textContent = nStr;

    if (distMorningFill && distMorningFill.style.width !== mStr) distMorningFill.style.width = mStr;
    if (distAfternoonFill && distAfternoonFill.style.width !== aStr) distAfternoonFill.style.width = aStr;
    if (distEveningFill && distEveningFill.style.width !== eStr) distEveningFill.style.width = eStr;
    if (distNightFill && distNightFill.style.width !== nStr) distNightFill.style.width = nStr;
  }

  // Real-time debounced updates when tracks change while modal is open
  const origOnMusicoTrackChange = window.onMusicoTrackChange;
  window.onMusicoTrackChange = function(track) {
    if (typeof origOnMusicoTrackChange === 'function') {
      origOnMusicoTrackChange(track);
    }
    _statsDataDirty = true;
    _profileDataDirty = true;
    if (_profileModalOpen && profileModal && profileModal.classList.contains('open')) {
      if (_realtimeUpdateTimeout) clearTimeout(_realtimeUpdateTimeout);
      _realtimeUpdateTimeout = setTimeout(() => {
        if (!_profileModalOpen) return;
        if (statsTabContent && statsTabContent.style.display !== 'none') {
          renderMusicoStats();
          _statsDataDirty = false;
        } else {
          renderProfileTab();
          _profileDataDirty = false;
        }
      }, 500);
    }
  };

  // ==========================================================================
  // MASTER SONG FULL VIEW / IMMERSIVE PLAYER (PC VIEW ONLY)
  // ==========================================================================

  const songFullViewOverlay = document.getElementById('songFullViewOverlay');
  const fullViewBgArtwork = document.getElementById('fullViewBgArtwork');
  const fullViewOptionsBtn = document.getElementById('fullViewOptionsBtn');
  const fullViewOptionsIcon = document.getElementById('fullViewOptionsIcon');
  const fullViewExitBtn = document.getElementById('fullViewExitBtn');
  const fullViewCenterControl = document.getElementById('fullViewCenterControl');
  const fullViewCenterPlayPauseBtn = document.getElementById('fullViewCenterPlayPauseBtn');
  const fullViewLyricColorToggle = document.getElementById('fullViewLyricColorToggle');
  const fullViewLyricsContainer = document.getElementById('fullViewLyricsContainer');
  const fullViewLyricsTextLines = document.getElementById('fullViewLyricsTextLines');
  const fullViewBottomControls = document.getElementById('fullViewBottomControls');
  const fullViewMiniPlayerCard = document.getElementById('fullViewMiniPlayerCard');
  const fullViewMiniPrevBtn = document.getElementById('fullViewMiniPrevBtn');
  const fullViewMiniPlayPauseBtn = document.getElementById('fullViewMiniPlayPauseBtn');
  const fullViewMiniNextBtn = document.getElementById('fullViewMiniNextBtn');
  const fullViewTimeDisplay = document.getElementById('fullViewTimeDisplay');
  const fullViewProgressTrack = document.getElementById('fullViewProgressTrack');
  const fullViewProgressFill = document.getElementById('fullViewProgressFill');
  const fullViewProgressHandle = document.getElementById('fullViewProgressHandle');
  const fullViewUpNextStrip = document.getElementById('fullViewUpNextStrip');

  function isSongTrackPlayable(track) {
    if (!track) return false;
    if (track.isRecording) return false;
    if (track.album === 'Recordings' || track.artist === 'Voice Recording') return false;
    return true;
  }

  function openSongFullView() {
    if (!player || !player.currentTrack || !isSongTrackPlayable(player.currentTrack)) {
      return;
    }

    isSongFullViewOpen = true;
    lastFullViewLyricIndex = -1;
    lastFullViewTrackId = player.currentTrack.id;

    const overlay = songFullViewOverlay || document.getElementById('songFullViewOverlay');
    if (overlay) {
      overlay.style.display = 'flex';
      requestAnimationFrame(() => {
        overlay.classList.add('active');
      });
    }

    // Background Artwork
    updateFullViewArtwork(player.currentTrack);

    // Options icon theme check
    if (fullViewOptionsIcon) {
      fullViewOptionsIcon.src = currentTheme === 'dark' ? 'assets/OptionsThreeDots.svg' : 'assets/Dark Mode/DarkModeOptionsbtn.svg';
    }

    // Lyric Color toggle
    applyFullViewLyricColorMode();

    // Play/pause states
    updateFullViewPlayPauseUI(player.isPlaying);

    // Mini Player Progress and Time
    updateFullViewProgressUI();

    // Up Next Thumbnails
    renderFullViewUpNext();

    // Show initial State A controls
    showFullViewBottomControls(true);

    // Prepare lyrics
    updateFullViewLyrics(true);
  }

  function closeSongFullView() {
    isSongFullViewOpen = false;
    if (fullViewAutoHideTimer) {
      clearTimeout(fullViewAutoHideTimer);
      fullViewAutoHideTimer = null;
    }

    if (songFullViewOverlay) {
      songFullViewOverlay.classList.remove('active');
      setTimeout(() => {
        if (!isSongFullViewOpen) {
          songFullViewOverlay.style.display = 'none';
        }
      }, 300);
    }
  }

  function updateFullViewArtwork(track) {
    if (!fullViewBgArtwork) return;
    if (!track) {
      fullViewBgArtwork.src = 'assets/atsuko.svg';
      return;
    }
    const isFallback = !track.coverUrl || 
                       track.coverUrl.includes('M logo') || 
                       track.coverUrl.includes('Group 4') || 
                       track.coverUrl.trim() === '';
    fullViewBgArtwork.src = isFallback ? 'assets/atsuko.svg' : track.coverUrl;
  }

  function applyFullViewLyricColorMode() {
    if (fullViewLyricColorToggle) {
      fullViewLyricColorToggle.classList.toggle('is-dark', fullViewLyricColorMode === 'dark');
    }
    if (fullViewLyricsContainer) {
      fullViewLyricsContainer.classList.toggle('lyrics-dark-theme', fullViewLyricColorMode === 'dark');
    }
  }

  function toggleFullViewLyricColor() {
    fullViewLyricColorMode = fullViewLyricColorMode === 'light' ? 'dark' : 'light';
    try {
      localStorage.setItem('musico-fullview-lyric-mode', fullViewLyricColorMode);
    } catch (e) {}
    applyFullViewLyricColorMode();
  }

  function showFullViewBottomControls(autoHide = true) {
    if (!isSongFullViewOpen) return;
    if (fullViewBottomControls) {
      fullViewBottomControls.classList.remove('controls-hidden');
    }
    isFullViewControlsVisible = true;

    // When bottom controls are visible, hide creative lyrics to prevent overlap
    if (fullViewLyricsContainer) {
      fullViewLyricsContainer.style.display = 'none';
    }

    // Reset center control state
    if (fullViewCenterControl) {
      if (player && player.isPlaying) {
        fullViewCenterControl.classList.add('hidden-center');
      } else {
        fullViewCenterControl.classList.remove('hidden-center');
      }
    }

    if (fullViewAutoHideTimer) {
      clearTimeout(fullViewAutoHideTimer);
      fullViewAutoHideTimer = null;
    }

    if (autoHide && player && player.isPlaying) {
      fullViewAutoHideTimer = setTimeout(() => {
        hideFullViewBottomControls();
      }, 2500);
    }
  }

  function hideFullViewBottomControls() {
    if (!isSongFullViewOpen) return;
    if (fullViewBottomControls) {
      fullViewBottomControls.classList.add('controls-hidden');
    }
    isFullViewControlsVisible = false;

    if (player && player.isPlaying) {
      // State B: Controls hidden, creative lyrics appear
      if (fullViewCenterControl) {
        fullViewCenterControl.classList.add('hidden-center');
      }
      if (fullViewLyricsContainer) {
        fullViewLyricsContainer.style.display = 'flex';
        updateFullViewLyrics(true);
      }
    } else {
      // State C: Controls hidden & Paused -> Center play button visible, lyrics hidden
      if (fullViewCenterControl) {
        fullViewCenterControl.classList.remove('hidden-center');
      }
      if (fullViewLyricsContainer) {
        fullViewLyricsContainer.style.display = 'none';
      }
    }
  }

  function handleFullViewSpaceOrScreenClick() {
    if (!isSongFullViewOpen || !player) return;
    if (player.isPlaying) {
      // Pause song
      player.audio.pause();
      // State C: hide creative lyrics, show center play button
      if (fullViewLyricsContainer) fullViewLyricsContainer.style.display = 'none';
      if (fullViewCenterControl) fullViewCenterControl.classList.remove('hidden-center');
      updateFullViewPlayPauseUI(false);
    } else {
      // Resume song
      player.audio.play().then(() => {
        updateFullViewPlayPauseUI(true);
        if (!isFullViewControlsVisible) {
          if (fullViewLyricsContainer) {
            fullViewLyricsContainer.style.display = 'flex';
            updateFullViewLyrics(true);
          }
          if (fullViewCenterControl) fullViewCenterControl.classList.add('hidden-center');
        }
      }).catch(() => {});
    }
  }

  function renderFullViewUpNext() {
    if (!fullViewUpNextStrip || !player) return;
    const queue = player.queue || [];
    const currentIndex = player.currentIndex >= 0 ? player.currentIndex : 0;
    const upcoming = queue.slice(currentIndex + 1);

    if (upcoming.length === 0) {
      fullViewUpNextStrip.innerHTML = '';
      return;
    }

    fullViewUpNextStrip.innerHTML = upcoming.map((track, idx) => {
      const isFirst = idx === 0;
      const cardClass = isFirst ? 'full-view-next-card-large' : 'full-view-next-card-small';
      const isFallback = !track.coverUrl || 
                         track.coverUrl.includes('M logo') || 
                         track.coverUrl.includes('Group 4') || 
                         track.coverUrl.trim() === '';
      const imgSrc = isFallback ? 'assets/atsuko.svg' : track.coverUrl;
      const targetIndex = currentIndex + 1 + idx;

      return `
        <div class="${cardClass}" data-track-index="${targetIndex}" title="${escapeHtml(track.title || 'Track')}">
          <img src="${escapeHtml(imgSrc)}" alt="${escapeHtml(track.title || 'Track')}" />
        </div>
      `;
    }).join('');
  }

  function updateFullViewLyrics(forceUpdate = false) {
    if (!isSongFullViewOpen) return;
    if (!fullViewLyricsContainer || !fullViewLyricsTextLines) return;
    if (!player || !player.isPlaying || isFullViewControlsVisible) {
      return;
    }

    const currentTrack = player.currentTrack;
    if (!currentTrack) {
      fullViewLyricsContainer.style.display = 'none';
      fullViewLyricsTextLines.innerHTML = '';
      lastFullViewLyricIndex = -1;
      lastFullViewTrackId = null;
      return;
    }

    if (currentTrack.id !== lastFullViewTrackId) {
      lastFullViewTrackId = currentTrack.id;
      lastFullViewLyricIndex = -1;
      fullViewLyricsTextLines.innerHTML = '';
    }

    const { isSynced, lines } = getTrackSynchronizedLyrics(currentTrack);
    if (!isSynced || lines.length === 0) {
      fullViewLyricsContainer.style.display = 'none';
      fullViewLyricsTextLines.innerHTML = '';
      lastFullViewLyricIndex = -1;
      return;
    }

    const curTime = player.audio ? player.audio.currentTime : 0;
    let activeIndex = -1;

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].time <= curTime + 0.2) {
        activeIndex = i;
      } else {
        break;
      }
    }

    if (activeIndex === -1) {
      if (lines[0].time - curTime < 2.5) {
        activeIndex = 0;
      } else {
        fullViewLyricsContainer.style.display = 'flex';
        fullViewLyricsTextLines.innerHTML = '';
        lastFullViewLyricIndex = -1;
        return;
      }
    }

    if (activeIndex === lastFullViewLyricIndex && !forceUpdate) {
      return;
    }

    lastFullViewLyricIndex = activeIndex;
    fullViewLyricsContainer.style.display = 'flex';

    const activeLine = lines[activeIndex];
    const html = formatCreativeLyricLine(activeLine.text, true);

    if (forceUpdate || fullViewLyricsTextLines.innerHTML.trim() === '') {
      fullViewLyricsTextLines.innerHTML = html;
      fullViewLyricsTextLines.classList.remove('transitioning-out');
      fullViewLyricsTextLines.classList.add('transitioning-in');
      requestAnimationFrame(() => {
        fullViewLyricsTextLines.classList.remove('transitioning-in');
      });
      return;
    }

    fullViewLyricsTextLines.classList.add('transitioning-out');
    setTimeout(() => {
      if (lastFullViewLyricIndex === activeIndex) {
        fullViewLyricsTextLines.innerHTML = html;
        fullViewLyricsTextLines.classList.remove('transitioning-out');
        fullViewLyricsTextLines.classList.add('transitioning-in');
        requestAnimationFrame(() => {
          fullViewLyricsTextLines.classList.remove('transitioning-in');
        });
      }
    }, 160);
  }

  // Global hooks for player.js
  window.updateFullViewPlayPauseUI = function(isPlaying) {
    const playSvg = document.querySelector('.full-view-center-play-svg');
    const pauseSvg = document.querySelector('.full-view-center-pause-svg');
    if (playSvg) playSvg.style.display = isPlaying ? 'none' : 'block';
    if (pauseSvg) pauseSvg.style.display = isPlaying ? 'block' : 'none';

    const miniPlayIcon = document.querySelector('.full-view-mini-play-icon');
    const miniPauseIcon = document.querySelector('.full-view-mini-pause-icon');
    if (miniPlayIcon) miniPlayIcon.style.display = isPlaying ? 'none' : 'block';
    if (miniPauseIcon) miniPauseIcon.style.display = isPlaying ? 'block' : 'none';

    if (isSongFullViewOpen) {
      if (!isPlaying) {
        // Paused -> show center play button
        if (fullViewCenterControl) fullViewCenterControl.classList.remove('hidden-center');
        if (fullViewLyricsContainer) fullViewLyricsContainer.style.display = 'none';
      } else {
        if (!isFullViewControlsVisible) {
          if (fullViewCenterControl) fullViewCenterControl.classList.add('hidden-center');
          if (fullViewLyricsContainer) {
            fullViewLyricsContainer.style.display = 'flex';
            updateFullViewLyrics(true);
          }
        }
      }
    }
  };

  window.updateFullViewProgressUI = function(progressPercent, formattedTime) {
    if (!timeDisplayProgressPercent(progressPercent)) {
      const curTime = player?.audio ? player.audio.currentTime : 0;
      const dur = player?.audio ? (player.audio.duration || player.currentTrack?.duration || 0) : 0;
      progressPercent = dur > 0 ? Math.min(100, Math.max(0, (curTime / dur) * 100)) : 0;
      formattedTime = `${player?.formatTime ? player.formatTime(curTime) : '0:00'}/${player?.formatTime ? player.formatTime(dur) : '0:00'}`;
    }

    if (fullViewTimeDisplay) {
      fullViewTimeDisplay.textContent = formattedTime;
    }
    if (fullViewProgressFill) {
      fullViewProgressFill.style.width = `${progressPercent}%`;
    }
    if (fullViewProgressHandle) {
      fullViewProgressHandle.style.left = `${progressPercent}%`;
    }
  };

  function timeDisplayProgressPercent(p) {
    return typeof p === 'number' && !isNaN(p);
  }

  window.updateFullViewNowPlayingUI = function(track) {
    if (!isSongFullViewOpen) return;
    if (!track || !isSongTrackPlayable(track)) {
      closeSongFullView();
      return;
    }
    updateFullViewArtwork(track);
    renderFullViewUpNext();
    updateFullViewLyrics(true);
  };

  window.updateFullViewLyrics = function() {
    updateFullViewLyrics(false);
  };

  // Event Listeners for Song Full View
  if (fullViewExitBtn) {
    fullViewExitBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeSongFullView();
    });
  }

  if (fullViewOptionsBtn) {
    fullViewOptionsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (player && player.currentTrack) {
        showContextMenu(e, player.currentTrack.id, false);
      } else {
        showToast('No song is currently playing');
      }
    });
  }

  if (fullViewCenterPlayPauseBtn) {
    fullViewCenterPlayPauseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      handleFullViewSpaceOrScreenClick();
    });
  }

  if (fullViewLyricColorToggle) {
    fullViewLyricColorToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleFullViewLyricColor();
    });
  }

  if (fullViewMiniPrevBtn) {
    fullViewMiniPrevBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      player.prev();
    });
  }

  if (fullViewMiniPlayPauseBtn) {
    fullViewMiniPlayPauseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      player.togglePlay();
    });
  }

  if (fullViewMiniNextBtn) {
    fullViewMiniNextBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      player.next();
    });
  }

  if (fullViewProgressTrack) {
    const handleSeek = (e) => {
      const rect = fullViewProgressTrack.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const percent = Math.max(0, Math.min(100, (clickX / rect.width) * 100));
      player.seek(percent);
    };

    fullViewProgressTrack.addEventListener('click', (e) => {
      e.stopPropagation();
      handleSeek(e);
    });
  }

  if (fullViewUpNextStrip) {
    fullViewUpNextStrip.addEventListener('click', (e) => {
      e.stopPropagation();
      const card = e.target.closest('[data-track-index]');
      if (!card) return;
      const targetIdx = parseInt(card.dataset.trackIndex, 10);
      if (!isNaN(targetIdx) && targetIdx >= 0 && targetIdx < (player.queue?.length || 0)) {
        player.loadAndPlay(targetIdx);
      }
    });
  }

  if (songFullViewOverlay) {
    // Screen click toggles playback
    songFullViewOverlay.addEventListener('click', (e) => {
      if (
        e.target.closest('.full-view-top-bar') ||
        e.target.closest('.full-view-bottom-controls') ||
        e.target.closest('.full-view-lyric-toggle-wrap') ||
        e.target.closest('.full-view-center-control')
      ) {
        return;
      }
      handleFullViewSpaceOrScreenClick();
    });

    // Mouse movement near bottom reveals controls; away starts auto-hide
    songFullViewOverlay.addEventListener('mousemove', (e) => {
      if (!isSongFullViewOpen) return;
      const isNearBottom = e.clientY >= window.innerHeight - 150;
      if (isNearBottom) {
        if (fullViewAutoHideTimer) {
          clearTimeout(fullViewAutoHideTimer);
          fullViewAutoHideTimer = null;
        }
        showFullViewBottomControls(false);
      } else {
        if (isFullViewControlsVisible && !fullViewAutoHideTimer && player && player.isPlaying) {
          fullViewAutoHideTimer = setTimeout(() => {
            hideFullViewBottomControls();
          }, 2500);
        }
      }
    });
  }

  window.isSongFullViewOpen = () => isSongFullViewOpen;
  window.openSongFullView = openSongFullView;
  window.closeSongFullView = closeSongFullView;

  if ('BroadcastChannel' in window) {
    try {
      const instanceChannel = new BroadcastChannel('musico_single_instance_coordinator');
      // Announce this launch event to any already-running instance
      instanceChannel.postMessage({ type: 'MUSICO_PING', timestamp: Date.now() });

      instanceChannel.onmessage = (event) => {
        if (!event.data) return;
        if (event.data.type === 'MUSICO_PING') {
          // Existing active window receives ping -> Focus window to bring it to front
          window.focus();
          // Inform the new window that an active instance already exists
          instanceChannel.postMessage({ type: 'MUSICO_ACTIVE_INSTANCE_EXISTS' });
        } else if (event.data.type === 'MUSICO_ACTIVE_INSTANCE_EXISTS') {
          // This duplicate window should close itself to enforce a single window
          window.close();
        }
      };
    } catch (e) {
      console.warn('Single-instance coordinator initialization error:', e);
    }
  }

  // Register PWA Service Worker for Offline / Standalone Installation
  if ('serviceWorker' in navigator && (window.location.protocol === 'http:' || window.location.protocol === 'https:')) {
    const registerServiceWorker = () => {
      navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(err => {
        console.warn('ServiceWorker registration error:', err);
      });
    };

    if (document.readyState === 'complete') {
      registerServiceWorker();
    } else {
      window.addEventListener('load', registerServiceWorker);
    }
  }
});
