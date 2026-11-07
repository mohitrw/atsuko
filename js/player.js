/**
 * Musico - Audio Player Engine & Web Audio Visualizer
 * Controls audio playback, seek, volume, shuffle, queue, and real-time equalizer bars.
 */

class MusicPlayer {
  constructor() {
    this.audio = new Audio();
    this.audio.preload = 'auto';

    this.queue = [];
    this.originalQueue = [];
    this.currentIndex = -1;
    this.currentTrack = null;
    this.isPlaying = false;
    this.playbackMode = localStorage.getItem('musico-playback-mode') || 'normal';
    this.isShuffle = this.playbackMode === 'shuffle';
    this.repeatMode = this.playbackMode === 'repeat_one' ? 'one' : 'all';
    this.volume = 1.0;
    this.activePlaylistId = null;
    this.activePlaylistName = null;

    // Smart Audio Ducking State for Voice Assistant
    this.isDucked = false;
    this.savedUserVolume = null;
    this._duckRampTimer = null;

    // Web Audio API setup
    this.audioCtx = null;
    this.analyser = null;
    this.sourceNode = null;
    this.gainNode = null;
    this.compressor = null;
    this.isAudioCtxInitialized = false;

    this.setupAudioListeners();
    
    // Dynamically adjust effective volume if screen orientation or viewport changes
    window.addEventListener('resize', () => {
      this.updateEffectiveVolume();
    });
  }

  /**
   * Determine if running in a mobile viewport or mobile device environment
   */
  isMobileDevice() {
    return window.innerWidth <= 900 || /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(navigator.userAgent);
  }

  /**
   * Apply effective volume and amplification.
   * On Mobile: Scale volume up to ~1.6x (160%) gain when slider is at maximum.
   * On PC: Standard 1.0x (100%) maximum output.
   */
  updateEffectiveVolume() {
    const isMobile = this.isMobileDevice();
    const multiplier = isMobile ? 1.6 : 1.0;
    const baseVol = (this.isDucked && this.savedUserVolume !== null)
      ? Math.max(0.02, this.savedUserVolume * 0.18)
      : (this.volume !== undefined ? this.volume : 1.0);
    const effectiveGain = baseVol * multiplier;

    if (this.gainNode && this.audioCtx) {
      try {
        const now = this.audioCtx.currentTime;
        this.gainNode.gain.cancelScheduledValues(now);
        this.gainNode.gain.setValueAtTime(effectiveGain, now);
      } catch (e) {
        console.warn('Could not update gain:', e);
      }
      this.audio.volume = 1.0;
    } else if (this.audio) {
      this.audio.volume = Math.max(0, Math.min(1, baseVol));
    }
  }

  /**
   * Initialize Web Audio API nodes with clean uncompressed bit-perfect signal chain
   */
  initWebAudio() {
    if (this.isAudioCtxInitialized) return;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      this.audioCtx = new AudioContext();
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 64;
      this.analyser.smoothingTimeConstant = 0.8;

      this.gainNode = this.audioCtx.createGain();

      this.sourceNode = this.audioCtx.createMediaElementSource(this.audio);
      this.sourceNode.connect(this.gainNode);
      this.gainNode.connect(this.analyser);
      this.analyser.connect(this.audioCtx.destination);

      this.isAudioCtxInitialized = true;
      this.updateEffectiveVolume();
      this.startVisualizerLoop();
    } catch (e) {
      console.warn('Web Audio API could not be initialized:', e);
    }
  }

  /**
   * Setup audio event listeners
   */
  setupAudioListeners() {
    let lastPlaybackTime = 0;

    const flushListeningTime = () => {
      if (lastPlaybackTime > 0) {
        const elapsed = (Date.now() - lastPlaybackTime) / 1000;
        const fm = window.fileManager || window.appFileManager;
        if (elapsed > 0.5 && this.currentTrack && fm) {
          fm.recordPlaybackSeconds(elapsed, this.currentTrack);
        }
        lastPlaybackTime = Date.now();
      }
    };

    this.audio.addEventListener('play', () => {
      this.isPlaying = true;
      lastPlaybackTime = Date.now();
      const fm = window.fileManager || window.appFileManager;
      if (this.currentTrack && fm) {
        fm.recordSongPlay(this.currentTrack);
        this.currentTrack.playCount = (this.currentTrack.playCount || 0) + 1;
        if (typeof fm.saveTrackToDB === 'function') {
          fm.saveTrackToDB(this.currentTrack);
        }
      }
      if (!this.isAudioCtxInitialized) {
        this.initWebAudio();
      }
      if (this.audioCtx && this.audioCtx.state === 'suspended') {
        this.audioCtx.resume();
      }
      this.updatePlayPauseUI();
    });

    this.audio.addEventListener('pause', () => {
      this.isPlaying = false;
      flushListeningTime();
      lastPlaybackTime = 0;
      this.updatePlayPauseUI();
    });

    this.audio.addEventListener('timeupdate', () => {
      this.updateProgressUI();
      if (this.isPlaying && lastPlaybackTime > 0 && Date.now() - lastPlaybackTime >= 2500) {
        flushListeningTime();
      }
      if (window.updateFullViewLyrics) {
        window.updateFullViewLyrics();
      }
    });

    this.audio.addEventListener('loadedmetadata', () => {
      if (this.currentTrack && (!this.currentTrack.duration || this.currentTrack.isLocal)) {
        this.currentTrack.duration = this.audio.duration;
      }
      this.updateProgressUI();
    });

    this.audio.addEventListener('ended', () => {
      flushListeningTime();
      lastPlaybackTime = 0;
      if (this.repeatMode === 'one') {
        this.audio.currentTime = 0;
        this.audio.play();
      } else {
        this.next();
      }
    });

    this.audio.addEventListener('error', (e) => {
      console.warn('Audio playback error:', e);
      this.isPlaying = false;
      flushListeningTime();
      lastPlaybackTime = 0;
      this.updatePlayPauseUI();
    });
  }

  /**
   * Set playback queue
   */
  setQueue(tracks, startIndex = 0, startPlay = true) {
    this.originalQueue = [...tracks];
    if (this.originalQueue.length === 0) {
      this.queue = [];
      this.currentIndex = -1;
      this.currentTrack = null;
      this.audio.pause();
      this.audio.src = '';
      this.isPlaying = false;
      this.updateNowPlayingUI();
      this.updatePlayPauseUI();
      this.updateProgressUI();
      return;
    }

    if (this.isShuffle) {
      this.queue = this.shuffleArray([...tracks]);
      const currentInShuffled = this.queue.findIndex(t => t.id === tracks[startIndex].id);
      this.currentIndex = currentInShuffled !== -1 ? currentInShuffled : 0;
    } else {
      this.queue = [...tracks];
      this.currentIndex = startIndex;
    }

    if (startPlay && this.queue.length > 0) {
      this.loadAndPlay(this.currentIndex);
    } else if (this.queue.length > 0) {
      this.loadTrack(this.currentIndex);
    }

    if (window.onMusicoQueueChange) {
      window.onMusicoQueueChange();
    }
  }

  /**
   * Load track at index
   */
  async loadTrack(index) {
    if (index < 0 || index >= this.queue.length) return;
    this.currentIndex = index;
    this.currentTrack = this.queue[index];

    // Revoke previous audio blob URL to prevent memory leaks
    if (this.activeAudioUrl) {
      try {
        URL.revokeObjectURL(this.activeAudioUrl);
      } catch (e) {}
      this.activeAudioUrl = null;
    }

    if (this.currentTrack) {
      if (this.currentTrack.fileBlob) {
        this.activeAudioUrl = URL.createObjectURL(this.currentTrack.fileBlob);
        this.audio.src = this.activeAudioUrl;
      } else if (this.currentTrack.audioUrl) {
        this.audio.src = this.currentTrack.audioUrl;
      }
    }
    this.audio.currentTime = 0;

    // Persist last played track ID for app restarts (both Mobile & PC PWA)
    if (this.currentTrack && this.currentTrack.id) {
      try {
        localStorage.setItem('musico-last-played-id', this.currentTrack.id);
      } catch (e) {
        console.warn('Could not save last played song ID:', e);
      }
    }

    // Lazy on-demand lyrics parsing if track does not have lyrics yet
    if (this.currentTrack && this.currentTrack.fileBlob && !this.currentTrack.lyrics && !this.currentTrack._lyricsChecked && window.ID3Parser) {
      this.currentTrack._lyricsChecked = true;
      const trackRef = this.currentTrack;
      window.ID3Parser.parse(trackRef.fileBlob).then(meta => {
        if (meta && meta.lyrics) {
          trackRef.lyrics = meta.lyrics;
          if (window.fileManager) window.fileManager.saveTrackToDB(trackRef);
          if (this.currentTrack && this.currentTrack.id === trackRef.id && window.onMusicoTrackChange) {
            window.onMusicoTrackChange(this.currentTrack);
          }
        }
      }).catch(() => {});
    }

    this.updateNowPlayingUI();
    this.updatePlayPauseUI();
    this.updateProgressUI();
    this.updateEffectiveVolume();
  }

  /**
   * Load and play track at index
   */
  async loadAndPlay(index) {
    this.initWebAudio();
    await this.loadTrack(index);
    this.updateEffectiveVolume();
    try {
      await this.audio.play();
      this.isPlaying = true;
    } catch (err) {
      console.warn('Auto-play error:', err);
    }
    this.updatePlayPauseUI();
    this.updateProgressUI();
  }

  /**
   * Toggle Play / Pause
   */
  async togglePlay() {
    this.initWebAudio();
    if (!this.currentTrack) {
      if (this.queue.length > 0) {
        this.loadAndPlay(0);
      }
      return;
    }

    if (this.audio.paused) {
      this.updateEffectiveVolume();
      try {
        await this.audio.play();
        this.isPlaying = true;
      } catch (e) {
        console.warn('Play error:', e);
      }
    } else {
      this.audio.pause();
      this.isPlaying = false;
    }
    this.updatePlayPauseUI();
  }

  /**
   * Explicit Play (safe wrapper for Voice Assistant & Shortcuts)
   */
  async play() {
    this.initWebAudio();
    if (!this.currentTrack && this.queue.length > 0) {
      await this.loadAndPlay(0);
      return;
    }
    if (this.audio) {
      this.updateEffectiveVolume();
      try {
        await this.audio.play();
        this.isPlaying = true;
      } catch (e) {
        console.warn('Play error:', e);
      }
      this.updatePlayPauseUI();
    }
  }

  /**
   * Explicit Pause (safe wrapper for Voice Assistant & Shortcuts)
   */
  pause() {
    if (this.audio) {
      this.audio.pause();
      this.isPlaying = false;
      this.updatePlayPauseUI();
    }
  }

  /**
   * Next Track
   */
  next() {
    if (this.queue.length === 0) return;
    let nextIndex = this.currentIndex + 1;
    if (nextIndex >= this.queue.length) {
      if (this.repeatMode === 'all') {
        nextIndex = 0;
      } else {
        return;
      }
    }
    this.loadAndPlay(nextIndex);
  }

  /**
   * Previous Track
   */
  prev() {
    if (this.queue.length === 0) return;
    if (this.audio.currentTime > 3) {
      this.audio.currentTime = 0;
      this.updateProgressUI();
      return;
    }
    let prevIndex = this.currentIndex - 1;
    if (prevIndex < 0) {
      prevIndex = this.queue.length - 1;
    }
    this.loadAndPlay(prevIndex);
  }

  /**
   * Seek to position in percentage (0-100)
   */
  seek(percent) {
    if (!this.currentTrack) return;
    const dur = this.audio.duration || this.currentTrack.duration || 1;
    const clampedPercent = Math.max(0, Math.min(100, percent));
    this.audio.currentTime = (clampedPercent / 100) * dur;
    this.updateProgressUI();
  }

  /**
   * Set Volume (0 to 1)
   */
  setVolume(val) {
    const clamped = Math.max(0, Math.min(1, val));
    this.volume = clamped;
    if (this.isDucked) {
      this.savedUserVolume = clamped;
    }
    this.updateEffectiveVolume();
  }

  /**
   * Smooth Smart Audio Ducking for Voice Assistant.
   * Fades music down to ~18% of user's active volume level,
   * saving the user's exact volume to restore later.
   * @param {number} ratio Target volume ratio (0.15 - 0.20, default 0.18)
   * @param {number} durationMs Transition ramp duration in ms (default 250)
   */
  duckAudio(ratio = 0.18, durationMs = 250) {
    if (this.isDucked) return;
    this.isDucked = true;
    this.savedUserVolume = this.volume !== undefined ? this.volume : 1.0;

    const targetVol = Math.max(0.02, this.savedUserVolume * ratio);

    if (this.gainNode && this.audioCtx) {
      try {
        if (this.audioCtx.state === 'suspended') {
          this.audioCtx.resume().catch(() => {});
        }
        const isMobile = this.isMobileDevice();
        const multiplier = isMobile ? 1.6 : 1.0;
        const targetGain = targetVol * multiplier;
        const now = this.audioCtx.currentTime;
        this.gainNode.gain.cancelScheduledValues(now);
        this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, now);
        this.gainNode.gain.linearRampToValueAtTime(targetGain, now + (durationMs / 1000));
        setTimeout(() => {
          if (this.isDucked && this.gainNode && this.audioCtx) {
            try {
              this.gainNode.gain.cancelScheduledValues(this.audioCtx.currentTime);
              this.gainNode.gain.setValueAtTime(targetGain, this.audioCtx.currentTime);
            } catch (_) {}
          }
        }, durationMs + 20);
        this.audio.volume = 1.0;
      } catch (err) {
        console.debug('[Player] Web Audio duck notice:', err);
      }
    } else if (this.audio) {
      clearInterval(this._duckRampTimer);
      const startVol = this.audio.volume;
      const steps = 15;
      const stepTime = Math.max(10, durationMs / steps);
      let step = 0;
      this._duckRampTimer = setInterval(() => {
        step++;
        const progress = step / steps;
        this.audio.volume = Math.max(0, Math.min(1, startVol + (targetVol - startVol) * progress));
        if (step >= steps) {
          clearInterval(this._duckRampTimer);
          this._duckRampTimer = null;
          this.audio.volume = targetVol;
        }
      }, stepTime);
    }
  }

  /**
   * Smooth Smart Audio Volume Restoration.
   * Fades music back up to the EXACT saved user volume (not a fixed 100%).
   * @param {number} durationMs Transition ramp duration in ms (default 300)
   */
  restoreAudio(durationMs = 300) {
    const targetVol = (this.savedUserVolume !== null && this.savedUserVolume !== undefined)
      ? this.savedUserVolume
      : (this.volume !== undefined ? this.volume : 1.0);

    this.isDucked = false;
    this.savedUserVolume = null;
    this.volume = targetVol;

    clearInterval(this._duckRampTimer);
    this._duckRampTimer = null;

    if (this.gainNode && this.audioCtx) {
      try {
        if (this.audioCtx.state === 'suspended') {
          this.audioCtx.resume().catch(() => {});
        }
        const isMobile = this.isMobileDevice();
        const multiplier = isMobile ? 1.6 : 1.0;
        const targetGain = targetVol * multiplier;
        const now = this.audioCtx.currentTime;
        this.gainNode.gain.cancelScheduledValues(now);
        this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, now);
        this.gainNode.gain.linearRampToValueAtTime(targetGain, now + (durationMs / 1000));
        setTimeout(() => {
          if (!this.isDucked && this.gainNode && this.audioCtx) {
            try {
              this.gainNode.gain.cancelScheduledValues(this.audioCtx.currentTime);
              this.gainNode.gain.setValueAtTime(targetGain, this.audioCtx.currentTime);
            } catch (_) {}
          }
        }, durationMs + 20);
        this.audio.volume = 1.0;
      } catch (err) {
        console.debug('[Player] Web Audio unduck notice:', err);
      }
    } else if (this.audio) {
      this.audio.volume = targetVol;
    }
  }

  /**
   * Toggle Shuffle Mode
   */
  toggleShuffle() {
    this.isShuffle = !this.isShuffle;
    if (this.isShuffle) {
      const currentTrackId = this.currentTrack ? this.currentTrack.id : null;
      this.queue = this.shuffleArray([...this.originalQueue]);
      if (currentTrackId) {
        this.currentIndex = this.queue.findIndex(t => t.id === currentTrackId);
      }
    } else {
      const currentTrackId = this.currentTrack ? this.currentTrack.id : null;
      this.queue = [...this.originalQueue];
      if (currentTrackId) {
        this.currentIndex = this.queue.findIndex(t => t.id === currentTrackId);
      }
    }

    const shuffleBtns = [
      document.getElementById('filterShuffleBtn'),
      document.getElementById('mobileFilterShuffleBtn'),
      document.getElementById('mobileFullFilterShuffleBtn')
    ];
    shuffleBtns.forEach(btn => {
      if (btn) btn.classList.toggle('active', this.isShuffle);
    });

    if (window.updateMobileUpNextUI) {
      window.updateMobileUpNextUI();
    }
    if (window.onMusicoQueueChange) {
      window.onMusicoQueueChange();
    }

    return this.isShuffle;
  }

  /**
   * Set 3-Mode Playback Control:
   * 'normal'     -> Play in Line (standard list order)
   * 'shuffle'    -> Shuffle ON (randomized queue)
   * 'repeat_one' -> Repeat One (loop current song)
   */
  setPlaybackMode(mode) {
    this.playbackMode = mode;
    localStorage.setItem('musico-playback-mode', mode);

    if (mode === 'normal') {
      this.isShuffle = false;
      this.repeatMode = 'all';
      const currentTrackId = this.currentTrack ? this.currentTrack.id : null;
      this.queue = [...this.originalQueue];
      if (currentTrackId) {
        const found = this.queue.findIndex(t => t.id === currentTrackId);
        this.currentIndex = found !== -1 ? found : 0;
      }
    } else if (mode === 'shuffle') {
      this.isShuffle = true;
      this.repeatMode = 'all';
      const currentTrackId = this.currentTrack ? this.currentTrack.id : null;
      this.queue = this.shuffleArray([...this.originalQueue]);
      if (currentTrackId) {
        const found = this.queue.findIndex(t => t.id === currentTrackId);
        this.currentIndex = found !== -1 ? found : 0;
      }
    } else if (mode === 'repeat_one') {
      this.isShuffle = false;
      this.repeatMode = 'one';
      const currentTrackId = this.currentTrack ? this.currentTrack.id : null;
      this.queue = [...this.originalQueue];
      if (currentTrackId) {
        const found = this.queue.findIndex(t => t.id === currentTrackId);
        this.currentIndex = found !== -1 ? found : 0;
      }
    }

    this.updatePlaybackModeUI();

    if (window.updateMobileUpNextUI) {
      window.updateMobileUpNextUI();
    }
    if (window.onMusicoQueueChange) {
      window.onMusicoQueueChange();
    }
  }

  /**
   * Cycle through 3 playback modes in exact order:
   * Repeat One -> Shuffle ON -> Play in Line -> Repeat One -> ...
   */
  cyclePlaybackMode() {
    let nextMode = 'repeat_one';
    if (this.playbackMode === 'repeat_one') {
      nextMode = 'shuffle';
    } else if (this.playbackMode === 'shuffle') {
      nextMode = 'normal';
    } else {
      nextMode = 'repeat_one';
    }

    this.setPlaybackMode(nextMode);
    return nextMode;
  }

  updatePlaybackModeUI() {
    const mode = this.playbackMode || (this.isShuffle ? 'shuffle' : (this.repeatMode === 'one' ? 'repeat_one' : 'normal'));

    const pcShuffleBtn = document.getElementById('filterShuffleBtn');
    if (pcShuffleBtn) {
      pcShuffleBtn.classList.toggle('active', mode !== 'normal');
    }

    const mobileBtns = [
      document.getElementById('mobileFilterShuffleBtn'),
      document.getElementById('mobileFullFilterShuffleBtn')
    ];
    mobileBtns.forEach(btn => {
      if (btn) btn.classList.toggle('active', this.isShuffle);
    });
  }

  /**
   * Set Repeat Mode ('off', 'all', 'one')
   */
  setRepeatMode(mode) {
    this.repeatMode = mode;
    if (window.updateMobileUpNextUI) {
      window.updateMobileUpNextUI();
    }
    if (window.onMusicoQueueChange) {
      window.onMusicoQueueChange();
    }
  }

  /**
   * Toggle Repeat Mode
   */
  toggleRepeat() {
    if (this.repeatMode === 'off') {
      this.repeatMode = 'all';
    } else if (this.repeatMode === 'all') {
      this.repeatMode = 'one';
    } else {
      this.repeatMode = 'off';
    }
    if (window.updateMobileUpNextUI) {
      window.updateMobileUpNextUI();
    }
    if (window.onMusicoQueueChange) {
      window.onMusicoQueueChange();
    }
    return this.repeatMode;
  }

  /**
   * Fisher-Yates shuffle
   */
  shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }

  /**
   * Format seconds to string MM:SS or HH:MM:SS
   */
  formatTime(seconds) {
    if (isNaN(seconds) || seconds <= 0) return '0:00';
    const s = Math.floor(seconds);
    const hrs = Math.floor(s / 3600);
    const mins = Math.floor((s % 3600) / 60);
    const secs = s % 60;

    if (hrs > 0) {
      return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  /**
   * Update Play / Pause UI elements across Desktop & Mobile players
   */
  updatePlayPauseUI() {
    const playBtns = [
      document.getElementById('playPauseBtn'),
      document.getElementById('mobilePopupPlayPauseBtn'),
      document.getElementById('mobileFullPlayPauseBtn')
    ];

    const pauseSvg = `
      <svg width="34" height="34" viewBox="0 0 34 34" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="7" y="5" width="6" height="24" rx="3" fill="currentColor"/>
        <rect x="21" y="5" width="6" height="24" rx="3" fill="currentColor"/>
      </svg>
    `;

    const playSvg = `
      <svg width="35" height="37" viewBox="0 0 35 37" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M28.1899 11.144C33.5891 14.2102 33.589 21.9908 28.1899 25.0571L13.9507 33.144C8.61755 36.1726 1.99951 32.3201 1.99951 26.187L1.99951 10.0142C1.99984 3.88133 8.61769 0.0295751 13.9507 3.05811L28.1899 11.144Z" stroke="currentColor" stroke-width="3.5" fill="none"/>
      </svg>
    `;

    playBtns.forEach(btn => {
      if (!btn) return;
      if (this.isPlaying) {
        btn.innerHTML = pauseSvg;
        btn.setAttribute('title', 'Pause');
        btn.setAttribute('aria-label', 'Pause');
      } else {
        btn.innerHTML = playSvg;
        btn.setAttribute('title', 'Play');
        btn.setAttribute('aria-label', 'Play');
      }
    });

    // Artist Section Mini Player Play/Pause Button
    const artistMiniPlayPauseBtn = document.getElementById('artistMiniPlayPauseBtn');
    if (artistMiniPlayPauseBtn) {
      const playIcon = artistMiniPlayPauseBtn.querySelector('.artist-mini-play-icon');
      const pauseIcon = artistMiniPlayPauseBtn.querySelector('.artist-mini-pause-icon');
      if (playIcon && pauseIcon) {
        playIcon.style.display = this.isPlaying ? 'none' : 'block';
        pauseIcon.style.display = this.isPlaying ? 'block' : 'none';
      }
      artistMiniPlayPauseBtn.setAttribute('title', this.isPlaying ? 'Pause' : 'Play');
      artistMiniPlayPauseBtn.setAttribute('aria-label', this.isPlaying ? 'Pause' : 'Play');
    }

    // Expanded Player Play/Pause Button
    const expandedPlayPauseBtn = document.getElementById('expandedPlayPauseBtn');
    if (expandedPlayPauseBtn) {
      const playIcon = expandedPlayPauseBtn.querySelector('.expanded-play-icon');
      const pauseIcon = expandedPlayPauseBtn.querySelector('.expanded-pause-icon');
      if (playIcon && pauseIcon) {
        playIcon.style.display = this.isPlaying ? 'none' : 'block';
        pauseIcon.style.display = this.isPlaying ? 'block' : 'none';
      }
      expandedPlayPauseBtn.setAttribute('title', this.isPlaying ? 'Pause' : 'Play');
      expandedPlayPauseBtn.setAttribute('aria-label', this.isPlaying ? 'Pause' : 'Play');
    }

    // Dedicated Column View Mini Player Play/Pause Button
    const columnMiniPlayPauseBtn = document.getElementById('columnMiniPlayPauseBtn');
    if (columnMiniPlayPauseBtn) {
      const playIcon = columnMiniPlayPauseBtn.querySelector('.column-mini-play-icon');
      const pauseIcon = columnMiniPlayPauseBtn.querySelector('.column-mini-pause-icon');
      if (playIcon && pauseIcon) {
        playIcon.style.display = this.isPlaying ? 'none' : 'block';
        pauseIcon.style.display = this.isPlaying ? 'block' : 'none';
      }
      columnMiniPlayPauseBtn.setAttribute('title', this.isPlaying ? 'Pause' : 'Play');
      columnMiniPlayPauseBtn.setAttribute('aria-label', this.isPlaying ? 'Pause' : 'Play');
    }

    document.querySelectorAll('.song-card').forEach(card => {
      const isCurrent = this.currentTrack && card.dataset.id === this.currentTrack.id;
      card.classList.toggle('active', isCurrent);
      card.classList.toggle('playing', isCurrent && this.isPlaying);
    });

    document.querySelectorAll('.masonry-card').forEach(card => {
      const isCurrent = this.currentTrack && card.dataset.id === this.currentTrack.id;
      card.classList.toggle('is-current', isCurrent);
      card.classList.toggle('playing', isCurrent && this.isPlaying);
    });

    if (window.onMusicoPlaybackChange) {
      window.onMusicoPlaybackChange(this.isPlaying);
    }

    // Toggle compact popup visibility on mobile
    const mobilePopup = document.getElementById('mobileCompactPopup');
    if (mobilePopup) {
      mobilePopup.classList.toggle('visible', Boolean(this.currentTrack));
    }

    if (window.updateArtistMiniPlayerVisibility) {
      window.updateArtistMiniPlayerVisibility();
    }

    if (window.updateColumnMiniPlayerVisibility) {
      window.updateColumnMiniPlayerVisibility();
    }

    if (window.updateFullViewPlayPauseUI) {
      window.updateFullViewPlayPauseUI(this.isPlaying);
    }
  }

  /**
   * Update Progress bar & Time display (Audio Timeline) with EXACT synchronization
   */
  updateProgressUI() {
    const timeDisplay = document.getElementById('playerTimeDisplay');
    const progressPill = document.getElementById('progressPill');
    const mobilePopupTimeDisplay = document.getElementById('mobilePopupTimeDisplay');
    const mobilePopupProgressBar = document.getElementById('mobilePopupProgressBar');
    const mobileFullTimeDisplay = document.getElementById('mobileFullTimeDisplay');
    const mobileFullProgressPill = document.getElementById('mobileFullProgressPill');
    const artistMiniTimeDisplay = document.getElementById('artistMiniTimeDisplay');
    const artistMiniProgressFill = document.getElementById('artistMiniProgressFill');
    const expandedTimeDisplay = document.getElementById('expandedTimeDisplay');
    const expandedProgressFill = document.getElementById('expandedProgressFill');
    const columnMiniTimeDisplay = document.getElementById('columnMiniTimeDisplay');
    const columnMiniProgressFill = document.getElementById('columnMiniProgressFill');

    if (!this.currentTrack) {
      if (timeDisplay) timeDisplay.textContent = '0:00/0:00';
      if (progressPill) progressPill.style.width = '0%';
      if (mobilePopupTimeDisplay) mobilePopupTimeDisplay.textContent = '0:00/0:00';
      if (mobilePopupProgressBar) mobilePopupProgressBar.style.width = '0%';
      if (mobileFullTimeDisplay) mobileFullTimeDisplay.textContent = '0:00/0:00';
      if (mobileFullProgressPill) mobileFullProgressPill.style.width = '0%';
      if (artistMiniTimeDisplay) artistMiniTimeDisplay.textContent = '0:00/0:00';
      if (artistMiniProgressFill) artistMiniProgressFill.style.width = '0%';
      if (expandedTimeDisplay) expandedTimeDisplay.textContent = '0:00/0:00';
      if (expandedProgressFill) expandedProgressFill.style.width = '0%';
      if (columnMiniTimeDisplay) columnMiniTimeDisplay.textContent = '0:00/0:00';
      if (columnMiniProgressFill) columnMiniProgressFill.style.width = '0%';
      return;
    }

    const curTime = this.audio.currentTime || 0;
    const dur = this.audio.duration || this.currentTrack.duration || 0;
    const progressPercent = dur > 0 ? Math.min(100, Math.max(0, (curTime / dur) * 100)) : 0;
    const formattedTime = `${this.formatTime(curTime)}/${this.formatTime(dur)}`;

    // Desktop
    if (timeDisplay) {
      timeDisplay.textContent = formattedTime;
    }
    if (progressPill) {
      progressPill.style.width = `${progressPercent}%`;
    }

    // Artist Section Mini Player
    if (artistMiniTimeDisplay) {
      artistMiniTimeDisplay.textContent = formattedTime;
    }
    if (artistMiniProgressFill) {
      artistMiniProgressFill.style.width = `${progressPercent}%`;
    }

    // Expanded Player
    if (expandedTimeDisplay) {
      expandedTimeDisplay.textContent = formattedTime;
    }
    if (expandedProgressFill) {
      expandedProgressFill.style.width = `${progressPercent}%`;
    }

    // Dedicated Column View Mini Player
    if (columnMiniTimeDisplay) {
      columnMiniTimeDisplay.textContent = formattedTime;
    }
    if (columnMiniProgressFill) {
      columnMiniProgressFill.style.width = `${progressPercent}%`;
    }

    // Mobile Compact Popup
    if (mobilePopupTimeDisplay) {
      mobilePopupTimeDisplay.textContent = formattedTime;
    }
    if (mobilePopupProgressBar) {
      mobilePopupProgressBar.style.width = `${progressPercent}%`;
    }

    // Mobile Full Now Playing
    if (mobileFullTimeDisplay) {
      mobileFullTimeDisplay.textContent = formattedTime;
    }
    if (mobileFullProgressPill) {
      mobileFullProgressPill.style.width = `${progressPercent}%`;
    }

    // Full View Player Progress
    if (window.updateFullViewProgressUI) {
      window.updateFullViewProgressUI(progressPercent, formattedTime);
    }
  }

  /**
   * Update full Now Playing user interface across all views
   */
  updateNowPlayingUI() {
    const artistNameElem = document.getElementById('nowPlayingArtist');
    const titleElem = document.getElementById('nowPlayingTitle');
    const albumArtElem = document.getElementById('nowPlayingAlbumArt');

    const mobilePopupCover = document.getElementById('mobilePopupCoverArt');
    const mobileFullArtist = document.getElementById('mobileFullArtist');
    const mobileFullTitle = document.getElementById('mobileFullTitle');
    const mobileFullAlbumArt = document.getElementById('mobileFullAlbumArt');

    const artistMiniSongTitle = document.getElementById('artistMiniSongTitle');
    const artistMiniCoverImg = document.getElementById('artistMiniCoverImg');
    const expandedSongTitle = document.getElementById('expandedSongTitle');
    const expandedMainCoverImg = document.getElementById('expandedMainCoverImg');
    const columnMiniCoverImg = document.getElementById('columnMiniCoverImg');

    if (!this.currentTrack) {
      if (artistNameElem) artistNameElem.textContent = 'Unknown';
      if (titleElem) titleElem.textContent = 'No Songs';
      if (albumArtElem) {
        albumArtElem.src = 'assets/atsuko.svg';
        albumArtElem.alt = 'Atsuko - No Song Playing';
        albumArtElem.className = 'album-art-img fallback-art';
      }

      if (mobilePopupCover) {
        mobilePopupCover.src = 'assets/atsuko-no-cover-image.svg';
        mobilePopupCover.className = 'mobile-popup-cover fallback-art';
      }
      if (mobileFullArtist) mobileFullArtist.textContent = 'Unknown';
      if (mobileFullTitle) mobileFullTitle.textContent = 'No Songs';
      if (mobileFullAlbumArt) {
        mobileFullAlbumArt.src = 'assets/atsuko.svg';
        mobileFullAlbumArt.className = 'mobile-full-art fallback-art';
      }

      if (artistMiniSongTitle) artistMiniSongTitle.textContent = 'No Songs';
      if (artistMiniCoverImg) {
        artistMiniCoverImg.src = 'assets/atsuko.svg';
        artistMiniCoverImg.className = 'artist-mini-cover-img fallback-art';
      }
      if (expandedSongTitle) expandedSongTitle.textContent = 'No Songs';
      if (expandedMainCoverImg) {
        expandedMainCoverImg.src = 'assets/atsuko.svg';
        expandedMainCoverImg.className = 'expanded-cover-art-img fallback-art';
      }
      if (columnMiniCoverImg) {
        columnMiniCoverImg.src = 'assets/atsuko.svg';
        columnMiniCoverImg.className = 'column-mini-cover-img fallback-art';
      }
      return;
    }

    const artistText = this.currentTrack.artist || 'Unknown';
    const titleText = this.currentTrack.title || 'Unknown Track';

    // Desktop
    if (artistNameElem) artistNameElem.textContent = artistText;
    if (titleElem) titleElem.textContent = titleText;

    // Artist Section Mini Player
    if (artistMiniSongTitle) artistMiniSongTitle.textContent = titleText;

    // Expanded Player
    if (expandedSongTitle) expandedSongTitle.textContent = titleText;

    // Mobile Full
    if (mobileFullArtist) mobileFullArtist.textContent = artistText;
    if (mobileFullTitle) mobileFullTitle.textContent = titleText;

    const isFallback = !this.currentTrack.coverUrl || 
                       this.currentTrack.coverUrl.includes('atsuko-no-cover-image') ||
                       this.currentTrack.coverUrl.includes('Atsuko - NoCoverImg') ||
                       this.currentTrack.coverUrl.includes('atsuko') ||
                       this.currentTrack.coverUrl.includes('M logo for music items') ||
                       this.currentTrack.coverUrl.includes('MlogoforMusicItems') ||
                       this.currentTrack.coverUrl.includes('Mlogo') || 
                       this.currentTrack.coverUrl.includes('Group 4') || 
                       this.currentTrack.coverUrl.trim() === '';

    // Album Arts
    if (albumArtElem) {
      if (isFallback) {
        albumArtElem.src = 'assets/atsuko.svg';
        albumArtElem.alt = titleText;
        albumArtElem.className = 'album-art-img fallback-art';
      } else {
        albumArtElem.src = this.currentTrack.coverUrl;
        albumArtElem.alt = titleText;
        albumArtElem.className = 'album-art-img';
      }
    }

    // Artist Mini Player Cover Art
    if (artistMiniCoverImg) {
      if (isFallback) {
        artistMiniCoverImg.src = 'assets/atsuko.svg';
        artistMiniCoverImg.alt = titleText;
        artistMiniCoverImg.className = 'artist-mini-cover-img fallback-art';
      } else {
        artistMiniCoverImg.src = this.currentTrack.coverUrl;
        artistMiniCoverImg.alt = titleText;
        artistMiniCoverImg.className = 'artist-mini-cover-img';
      }
    }

    // Dedicated Column View Mini Player Cover Art
    if (columnMiniCoverImg) {
      if (isFallback) {
        columnMiniCoverImg.src = 'assets/atsuko.svg';
        columnMiniCoverImg.alt = titleText;
        columnMiniCoverImg.className = 'column-mini-cover-img fallback-art';
      } else {
        columnMiniCoverImg.src = this.currentTrack.coverUrl;
        columnMiniCoverImg.alt = titleText;
        columnMiniCoverImg.className = 'column-mini-cover-img';
      }
    }

    // Expanded Player Cover Art
    if (expandedMainCoverImg) {
      if (isFallback) {
        expandedMainCoverImg.src = 'assets/atsuko.svg';
        expandedMainCoverImg.alt = titleText;
        expandedMainCoverImg.className = 'expanded-cover-art-img fallback-art';
      } else {
        expandedMainCoverImg.src = this.currentTrack.coverUrl;
        expandedMainCoverImg.alt = titleText;
        expandedMainCoverImg.className = 'expanded-cover-art-img';
      }
    }

    if (mobilePopupCover) {
      if (isFallback) {
        mobilePopupCover.src = 'assets/atsuko-no-cover-image.svg';
        mobilePopupCover.className = 'mobile-popup-cover fallback-art';
      } else {
        mobilePopupCover.src = this.currentTrack.coverUrl;
        mobilePopupCover.className = 'mobile-popup-cover';
      }
    }

    if (mobileFullAlbumArt) {
      if (isFallback) {
        mobileFullAlbumArt.src = 'assets/atsuko.svg';
        mobileFullAlbumArt.className = 'mobile-full-art fallback-art';
      } else {
        mobileFullAlbumArt.src = this.currentTrack.coverUrl;
        mobileFullAlbumArt.className = 'mobile-full-art';
      }
    }

    const mobilePopup = document.getElementById('mobileCompactPopup');
    if (mobilePopup) {
      mobilePopup.classList.toggle('visible', Boolean(this.currentTrack));
    }

    if (window.onMusicoTrackChange) {
      window.onMusicoTrackChange(this.currentTrack);
    }

    if (window.updateArtistMiniPlayerVisibility) {
      window.updateArtistMiniPlayerVisibility();
    }

    if (window.updateColumnMiniPlayerVisibility) {
      window.updateColumnMiniPlayerVisibility();
    }

    const playlistCurrentTitle = document.getElementById('playlistCurrentTitle');
    if (playlistCurrentTitle) {
      if (this.activePlaylistName) {
        playlistCurrentTitle.textContent = this.activePlaylistName;
      } else {
        playlistCurrentTitle.textContent = 'No playlist playing right now';
      }
    }

    if (window.updateMobileUpNextUI) {
      window.updateMobileUpNextUI();
    }

    if (window.onMusicoTrackChange) {
      window.onMusicoTrackChange(this.currentTrack);
    }

    if (window.updateFullViewNowPlayingUI) {
      window.updateFullViewNowPlayingUI(this.currentTrack);
    }
  }

  /**
   * Real-time equalizer visualizer animation loop (Now Playing wave indicator)
   */
  startVisualizerLoop() {
    const npSpans = document.querySelectorAll('.artist-now-playing .equalizer-icon-static span');
    const dataArray = new Uint8Array(32);

    const renderVisualizer = () => {
      requestAnimationFrame(renderVisualizer);

      const targetSpans = npSpans.length === 3 ? npSpans : document.querySelectorAll('.artist-now-playing .equalizer-icon-static span');

      if (this.analyser && this.isPlaying) {
        this.analyser.getByteFrequencyData(dataArray);

        const v1 = (dataArray[2] / 255);
        const v2 = (dataArray[6] / 255);
        const v3 = (dataArray[12] / 255);

        // Dynamic 3-line real-time music indicator animation
        if (targetSpans && targetSpans.length >= 3) {
          const npH1 = Math.max(4, Math.min(18, Math.round(4 + v1 * 14)));
          const npH2 = Math.max(4, Math.min(18, Math.round(3 + v2 * 14)));
          const npH3 = Math.max(4, Math.min(18, Math.round(4 + v3 * 14)));
          targetSpans[0].style.height = `${npH1}px`;
          targetSpans[1].style.height = `${npH2}px`;
          targetSpans[2].style.height = `${npH3}px`;
        }
      } else {
        // Reset to original static indicator heights when paused / stopped
        if (targetSpans && targetSpans.length >= 3) {
          targetSpans[0].style.height = '16px';
          targetSpans[1].style.height = '11px';
          targetSpans[2].style.height = '18px';
        }
      }
    };

    renderVisualizer();
  }
}

window.MusicPlayer = MusicPlayer;
