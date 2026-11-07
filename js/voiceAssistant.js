/**
 * Atsuko Voice Assistant (PC / Windows Web & PWA)
 * ============================================================================
 * 100% Offline On-Device Voice System.
 * - 4 Keywords: "Atsuko", "Asuko", "Hey! Atsuko", "Hey! Asuko"
 * - Trained on User Audio Profiles:
 *   1. assets/atsuko-wake-sample.mp3 ("Atsuko", "Asuko", "At... suko", "A... su ko")
 *   2. assets/atsuko-wake-sample2.mp3 ("Hey! Atsuko", "Hey! Asuko")
 * - Ultra-Fast Low Latency Response (<120ms action trigger)
 * - Multi-Utterance Rolling Transcript Window: Combines paused words within 3.8s
 * - Pattern A (Single Utterance): "Hey Atsuko, play Late Nights" / "Atsuko, pause"
 * - Pattern B (Conversational): "Atsuko" -> opens panel -> user says "Play Late Nights"
 * - Dynamic 4-Bar Audio Reactive Visualizer (Web Audio API AnalyserNode)
 * - Complete Command Suite: Play, Resume, Pause, Next, Prev, Shuffle, Repeat, Volume, Full View
 * - Intelligent Music Library Search with fuzzy Levenshtein & prefix matching
 * - Dedicated Microphone Management: Releases getUserMedia when panel closes to prevent audio lock
 * ============================================================================
 */

(function () {
  'use strict';

  // 8-State Wake-Word Engine Lifecycle
  const VOICE_STATE = {
    IDLE: 'IDLE',                   // Waiting for wake word, music at normal user volume
    WAKE_DETECTED: 'WAKE_DETECTED', // "Night" recognized
    ACTIVATED: 'ACTIVATED',         // Ducking music down to ~18%, playing soft chime, opening UI
    LISTENING: 'LISTENING',         // Active command listening window (6.5s)
    PROCESSING: 'PROCESSING',       // Speech received, parsing command intent
    EXECUTING: 'EXECUTING',         // Executing command (playback, pause, skip, volume)
    RECOVERY: 'RECOVERY',           // "I didn't catch that", retry window (3.5s)
    STOPPED: 'STOPPED'              // Assistant explicitly disabled / closed
  };

  let currentState = VOICE_STATE.IDLE;

  // State
  let isAssistantActive = false;
  let isListeningForCommand = false;
  let isAwaitingSongQuery = false;
  let isEngineRunning = false;
  let isStartingRecognizer = false;
  let isExplicitlyStopping = false;
  let hasPermissionError = false;
  const isFileProtocol = typeof window !== 'undefined' && window.location && window.location.protocol === 'file:';

  let recognitionInstance = null;
  let audioContext = null;
  let mediaStream = null;
  let analyser = null;
  let animFrameId = null;

  // Window & Interaction Timers
  let commandWindowTimer = null;
  let recoveryWindowTimer = null;
  let commandDebounceTimer = null;
  let panelSilenceTimer = null;
  let autoCloseTimer = null;
  let restartTimeout = null;
  let restartScheduledAt = 0;
  let restartDelayMs = 0;

  const COMMAND_WINDOW_MS = 6500;   // 6.5s command window (5-8s specification)
  const RECOVERY_WINDOW_MS = 3500;  // 3.5s retry recovery window

  /**
   * Smart Audio Ducking: Smoothly fades playing music down to ~18% of user's active volume level.
   * Saves the user's exact volume to restore later.
   */
  function duckMusic(ratio = 0.18, durationMs = 250) {
    try {
      const player = window.appPlayer || window.player;
      if (player && typeof player.duckAudio === 'function') {
        player.duckAudio(ratio, durationMs);
      } else if (player && player.audio) {
        if (player._savedUserVol === undefined || player._savedUserVol === null) {
          player._savedUserVol = player.volume !== undefined ? player.volume : player.audio.volume;
        }
        player.audio.volume = Math.max(0.02, player._savedUserVol * ratio);
      }
    } catch (e) {
      console.debug('[Voice Assistant] Audio duck notice:', e);
    }
  }

  /**
   * Smart Audio Volume Restoration: Smoothly fades music back to the EXACT previous user volume level.
   * Never forces a fixed 100% volume.
   */
  function restoreMusic(durationMs = 350) {
    try {
      const player = window.appPlayer || window.player;
      if (player && typeof player.restoreAudio === 'function') {
        player.restoreAudio(durationMs);
      } else if (player && player.audio && player._savedUserVol !== undefined && player._savedUserVol !== null) {
        player.audio.volume = player._savedUserVol;
        player._savedUserVol = null;
      }
    } catch (e) {
      console.debug('[Voice Assistant] Audio restore notice:', e);
    }
  }

  /**
   * Short Subtle Confirmation Sound (Web Audio API, 0 external dependencies)
   * Plays a very brief, soft chime signaling that "Night" heard the user,
   * even while the music is still fading down.
   */
  function playActivationChime() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const now = ctx.currentTime;

      const osc = ctx.createOscillator();
      const gainNode = ctx.createGain();

      osc.type = 'sine';
      // Gentle melodic frequency sweep: 520Hz (approx C5) to 880Hz (A5)
      osc.frequency.setValueAtTime(520, now);
      osc.frequency.exponentialRampToValueAtTime(880, now + 0.08);

      gainNode.gain.setValueAtTime(0.0001, now);
      gainNode.gain.linearRampToValueAtTime(0.08, now + 0.02);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);

      osc.connect(gainNode);
      gainNode.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.19);

      osc.onended = () => {
        try { ctx.close(); } catch (_) {}
      };
    } catch (e) {
      console.debug('[Voice Assistant] Chime audio notice:', e);
    }
  }

  /**
   * Safe auto-healing restart scheduler with WASAPI release backoff protection.
   */
  function scheduleRecognizerRestart(delay = 450) {
    if (isExplicitlyStopping) return;
    const now = Date.now();
    if (restartTimeout && (restartScheduledAt + restartDelayMs > now + delay)) {
      return;
    }
    clearTimeout(restartTimeout);
    restartScheduledAt = now;
    restartDelayMs = delay;
    restartTimeout = setTimeout(() => {
      restartTimeout = null;
      if (!isExplicitlyStopping) {
        createAndStartRecognizer();
      }
    }, delay);
  }

  let idleAnimationPhase = 0;
  let lastStartTime = 0;
  let consecutiveStarts = 0;
  let lastVoiceDetectedTimestamp = 0;

  let trainedAudioProfile = {
    samples: [
      { file: 'assets/atsuko-wake-sample.mp3', keywords: ['NX', 'Anex', 'Nox', 'Night', 'Arden'] },
      { file: 'assets/atsuko-wake-sample2.mp3', keywords: ['Hey! NX', 'Hey! Nox', 'Hey! Night', 'Hey! Arden'] }
    ],
    keywords: ['NX', 'Anex', 'Nox', 'Night', 'Arden', 'Hey! NX', 'Hey! Nox', 'Hey! Night', 'Hey! Arden'],
    trainedAt: null
  };

  // =========================================================================
  // REAL-TIME 3.5-SECOND ROLLING SOUND/WORD BUFFER
  // Continuously monitors environmental sound in real-time, stores recognized
  // words for 3.5 seconds, auto-prunes expired words to prevent memory buildup,
  // and completely deletes history the instant a wake word or command triggers.
  // =========================================================================
  const REALTIME_WINDOW_MS = 3600; // 3.6s window (cleanly 3 to 4 seconds)
  let realTimeWordHistory = [];    // Array of { text: string, timestamp: number, isFinal: boolean }

  // DOM Elements cache
  let panelElem = null;
  let greetingElem = null;
  let commandInputElem = null;
  let commandBoxElem = null;
  let closeBtnElem = null;
  let barElems = [];
  let headerVoiceBtn = null;
  let homeVoiceBtn = null;
  let setupModalElem = null;

  // Configuration & Storage Keys
  const STORAGE_KEY_VOICE_ENABLED = 'atsuko_voice_assistant_enabled';
  const STORAGE_KEY_PERMISSION_GRANTED = 'atsuko_voice_permission_granted';

  /**
   * Get configured username from existing Musico/Atsuko profile
   */
  function getUserProfileName() {
    try {
      const stored = localStorage.getItem('musico_profile_username') ||
        localStorage.getItem('musico_profile_name') ||
        localStorage.getItem('musico_username');
      if (stored && stored.trim()) return stored.trim();

      const navEl = document.getElementById('navProfileUserName') ||
        document.getElementById('homeProfileUserName') ||
        document.getElementById('profileUserNameTitle');
      if (navEl && navEl.textContent && navEl.textContent.trim() && navEl.textContent.trim() !== 'USER') {
        return navEl.textContent.trim();
      }
    } catch (_) { }
    return 'Mohit';
  }

  /**
   * Text normalization for robust song matching
   */
  function normalizeSearchText(str) {
    if (!str) return '';
    return String(str)
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[._\-–—/\\+]+/g, ' ')
      .replace(/['"`´’]/g, '')
      .replace(/[()[\]{}#&@!?,;:*~^%$|<>]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Text normalization specifically for wake word and spoken command parsing
   */
  function normalizeSpokenText(str) {
    if (!str) return '';
    return String(str)
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/['"`´’]/g, '')
      .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?'\"]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Prune history items older than 3.6 seconds to ensure no stale data buildup
   */
  function pruneRealTimeHistory() {
    const now = Date.now();
    realTimeWordHistory = realTimeWordHistory.filter(item => (now - item.timestamp) <= REALTIME_WINDOW_MS);
  }

  /**
   * Completely clear and delete all stored sound/word history
   */
  function deleteRealTimeHistory() {
    realTimeWordHistory = [];
  }

  /**
   * Update real-time 3.5s sound/word history buffer with newly recognized speech
   */
  function updateRealTimeHistory(spokenChunk, isFinal) {
    const now = Date.now();
    pruneRealTimeHistory();

    if (spokenChunk && spokenChunk.trim()) {
      const cleanChunk = normalizeSpokenText(spokenChunk);
      if (cleanChunk) {
        // If this is an interim revision for the same active utterance, replace the previous interim
        if (!isFinal && realTimeWordHistory.length > 0 && !realTimeWordHistory[realTimeWordHistory.length - 1].isFinal) {
          realTimeWordHistory[realTimeWordHistory.length - 1] = { text: cleanChunk, timestamp: now, isFinal: false };
        } else {
          realTimeWordHistory.push({ text: cleanChunk, timestamp: now, isFinal: !!isFinal });
        }
      }
    }

    // Return the combined text of words actively heard in the last 3.6 seconds
    return realTimeWordHistory.map(item => item.text).join(' ');
  }

  // Periodic pruning every 500ms so silence automatically purges memory
  setInterval(pruneRealTimeHistory, 500);

  // Backward compatibility aliases
  function updateRollingHistory(newChunk) {
    return updateRealTimeHistory(newChunk, false);
  }
  function clearRollingHistory() {
    deleteRealTimeHistory();
  }

  /**
   * Calculate string similarity ratio using Levenshtein distance
   */
  function calculateSimilarity(s1, s2) {
    if (!s1 || !s2) return 0;
    if (s1 === s2) return 1.0;
    const len1 = s1.length;
    const len2 = s2.length;
    if (len1 === 0 || len2 === 0) return 0;

    const matrix = [];
    for (let i = 0; i <= len2; i++) matrix[i] = [i];
    for (let j = 0; j <= len1; j++) matrix[0][j] = j;

    for (let i = 1; i <= len2; i++) {
      for (let j = 1; j <= len1; j++) {
        const cost = s1.charAt(j - 1) === s2.charAt(i - 1) ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j - 1] + cost
        );
      }
    }

    const dist = matrix[len2][len1];
    return 1 - (dist / Math.max(len1, len2));
  }

  /**
   * Ultra-fast regex matching the 4 primary wake words across all conversational,
   * acoustic, and regional pronunciation variants:
   * 1. "Night" / "Hey Night" / "Ok Night" (primary wake word, with connected glide & casual filters)
   * 2. "NX" / "Hey NX" / "Anex" / "Annex"
   * 3. "Nox" / "Knox" / "Hey Nox" / "Ok Knox"
   * 4. "Arden" / "Hey Arden" / "Ok Arden" / "Ardon" / "Ardin"
   */
  const CASUAL_NIGHT_PATTERN =
    /\b(?:good|last|tomorrow|all|late|every|one|that|this|have\s+a|yesterday|through\s+the|in\s+the)\s+nights?\b|\bnights?\s+(?:shift|out|time|long|away|owl|stand|fall)\b/i;

  const WAKE_WORD_PATTERN =
    /\b(?:(?:hey|hay|hi|hai|hello|he|ok|okay|okk|oke|k|yo|so|oh)\s+(?:a\s+|uh\s+|um\s+|and\s+|in\s+|the\s+|to\s+)?)?(night|knight|nite|nyte|knite|nx|n\s*x|n\s*\.\s*x|anex|annex|annexe|enex|ennex|enx|anx|an\s+ex|nox|knox|knocks|noks|arden|ardon|ardin|ar\s+den)\b|\b(?:hey|hay|hi|ok|okay)\s+tonight\b/i;

  /**
   * Detect wake words ("Night", "Hey Night", "NX", "Nox", "Arden", etc.)
   * across natural connected speech, regional accents, and extract any trailing command.
   */
  function extractWakeWordAndCommand(rawTranscript) {
    if (!rawTranscript) return null;
    const clean = normalizeSpokenText(rawTranscript);
    if (!clean) return null;

    // 1. FAST PATH: Direct Regex Pattern Matching (instantaneous < 0.1ms)
    try {
      const match = clean.match(WAKE_WORD_PATTERN);
      if (match) {
        const matchIndex = match.index;
        const matchLength = match[0].length;
        const token = match[0];

        // If token contains "night", verify it is not part of a casual phrase (e.g. "good night", "last night")
        let isCasualNight = false;
        if (/night|knight|nite/i.test(token)) {
          const startContext = Math.max(0, matchIndex - 15);
          const endContext = Math.min(clean.length, matchIndex + matchLength + 10);
          const localContext = clean.slice(startContext, endContext);
          if (CASUAL_NIGHT_PATTERN.test(localContext)) {
            isCasualNight = true;
          }
        }

        if (!isCasualNight) {
          let afterWake = clean.slice(matchIndex + matchLength).trim();

          // Check if user repeated the wake word (e.g. "Night Night" or "Hey Night Night")
          const secondMatch = afterWake.match(WAKE_WORD_PATTERN);
          if (secondMatch && secondMatch.index === 0) {
            afterWake = afterWake.slice(secondMatch[0].length).trim();
          }

          return {
            hasWakeWord: true,
            matchedToken: token,
            command: afterWake
          };
        }
      }
    } catch (err) {
      console.warn('[Voice Assistant] Fast-path regex notice:', err);
    }

    // 2. Token & Multi-Word Fuzzy / Phonetic Fallback
    const words = clean.split(' ');
    const targetKeywords = [
      'night', 'knight', 'nite',
      'nx', 'anex', 'annex', 'annexe', 'enex', 'ennex', 'enx', 'anx', 'nex', 'nyx', 'nix',
      'nox', 'knox', 'knocks', 'noks',
      'arden', 'ardon', 'ardin'
    ];

    for (let i = 0; i < words.length; i++) {
      const w = words[i];

      // Connected glide handling: "hey a night" / "hey uh night"
      if ((w === 'hey' || w === 'hay' || w === 'hi' || w === 'ok' || w === 'okay') && i + 2 < words.length) {
        const glide = words[i + 1];
        const kw = words[i + 2];
        if ((glide === 'a' || glide === 'uh' || glide === 'um' || glide === 'and' || glide === 'the') &&
            (kw === 'night' || kw === 'knight' || kw === 'nite' || kw === 'nx' || kw === 'nox' || kw === 'arden')) {
          let after = words.slice(i + 3).join(' ').trim();
          return { hasWakeWord: true, matchedToken: `${w} ${glide} ${kw}`, command: after };
        }
      }

      // Check prefix + keyword combinations (e.g. "hey night", "ok night", "hey nx", "hey nox", "hey arden")
      if ((w === 'hey' || w === 'ok' || w === 'okay' || w === 'hi' || w === 'yo' || w === 'so' || w === 'oh') && i + 1 < words.length) {
        const nextWord = words[i + 1];
        if (nextWord === 'night' || nextWord === 'knight' || nextWord === 'nite' || nextWord === 'nx' || nextWord === 'anex' || nextWord === 'annex' || nextWord === 'nox' || nextWord === 'knox' || nextWord === 'arden') {
          let after = words.slice(i + 2).join(' ').trim();
          return { hasWakeWord: true, matchedToken: `${w} ${nextWord}`, command: after };
        }
        for (const target of targetKeywords) {
          if (calculateSimilarity(nextWord, target) >= 0.72) {
            let after = words.slice(i + 2).join(' ').trim();
            return { hasWakeWord: true, matchedToken: `${w} ${nextWord}`, command: after };
          }
        }
      }

      // Single word direct match (respecting casual night filters)
      if (w === 'night' || w === 'knight' || w === 'nite') {
        const prevWord = i > 0 ? words[i - 1] : '';
        const nextWord = i + 1 < words.length ? words[i + 1] : '';
        const isCasual = /good|last|tomorrow|all|late|every|one|that|this|have|yesterday/i.test(prevWord) ||
                         /shift|out|time|long|away|owl|stand|fall/i.test(nextWord);
        if (!isCasual) {
          let after = words.slice(i + 1).join(' ').trim();
          return { hasWakeWord: true, matchedToken: w, command: after };
        }
      }

      if (w === 'nx' || w === 'anex' || w === 'annex' || w === 'nox' || w === 'knox' || w === 'arden') {
        let after = words.slice(i + 1).join(' ').trim();
        return { hasWakeWord: true, matchedToken: w, command: after };
      }

      for (const target of targetKeywords) {
        if (calculateSimilarity(w, target) >= 0.75) {
          if ((target === 'night' || target === 'knight') && i > 0 && /good|last|tomorrow|all|late|every|one|that|this|have/i.test(words[i - 1])) {
            continue;
          }
          let after = words.slice(i + 1).join(' ').trim();
          return { hasWakeWord: true, matchedToken: w, command: after };
        }
      }

      // Multi-word joined for split acronyms (e.g. "n x", "ar den")
      if (i + 1 < words.length) {
        const pair = words[i] + ' ' + words[i + 1];
        const pairNoSpace = words[i] + words[i + 1];
        if (pairNoSpace === 'nx' || pairNoSpace === 'anex' || pairNoSpace === 'annex' || pairNoSpace === 'arden') {
          let after = words.slice(i + 2).join(' ').trim();
          return { hasWakeWord: true, matchedToken: pair, command: after };
        }
        for (const target of targetKeywords) {
          if (calculateSimilarity(pairNoSpace, target) >= 0.72) {
            let after = words.slice(i + 2).join(' ').trim();
            return { hasWakeWord: true, matchedToken: pair, command: after };
          }
        }
      }
    }

    return null;
  }

  /**
   * Retrieve all tracks from any available Musico source
   */
  function getAvailableTracks() {
    let tracks = [];
    if (typeof window.getAllTracks === 'function') {
      try { tracks = window.getAllTracks() || []; } catch (_) {}
    }
    if (tracks.length === 0 && Array.isArray(window.allTracks) && window.allTracks.length > 0) {
      tracks = window.allTracks;
    }
    if (tracks.length === 0 && window.appFileManager && typeof window.appFileManager.getAllTracks === 'function') {
      try { tracks = window.appFileManager.getAllTracks() || []; } catch (_) {}
    }
    const player = window.appPlayer || window.player;
    if (tracks.length === 0 && player) {
      if (Array.isArray(player.originalQueue) && player.originalQueue.length > 0) {
        tracks = player.originalQueue;
      } else if (Array.isArray(player.queue) && player.queue.length > 0) {
        tracks = player.queue;
      }
    }
    return tracks;
  }

  /**
   * Asynchronously ensure stored tracks are loaded from IndexedDB if not in memory
   */
  async function ensureTracksLoaded() {
    let tracks = getAvailableTracks();
    if (tracks.length === 0 && window.appFileManager && typeof window.appFileManager.loadStoredTracks === 'function') {
      try {
        const stored = await window.appFileManager.loadStoredTracks();
        if (stored && stored.length > 0) {
          if (typeof window.getAllTracks === 'function' && Array.isArray(window.allTracks) && window.allTracks.length === 0) {
            window.allTracks = [...stored];
          }
          tracks = stored;
        }
      } catch (_) {}
    }
    return tracks;
  }

  /**
   * Search entire music library for best song match
   * Searches ALL songs regardless of current page (Playlists, Albums, Folders, etc.)
   */
  function findBestSongMatch(targetQuery) {
    if (!targetQuery) return { match: null, status: 'EMPTY' };

    const cleanQuery = normalizeSearchText(targetQuery);
    if (!cleanQuery) return { match: null, status: 'EMPTY' };

    const libraryTracks = getAvailableTracks();
    if (libraryTracks.length === 0) {
      return { match: null, status: 'NO_SONGS_IN_LIBRARY' };
    }

    // Handle "play this song" / "play this music" / "play something" / "play random" / "play music"
    const genericQueries = [
      'this music', 'this song', 'the music', 'the song', 'song',
      'something', 'anything', 'music', 'random', 'a song', 'some song',
      'some music', 'songs', 'shuffle', 'any song', 'whatever', 'random song',
      'something good', 'some track', 'a track', 'tracks', 'something nice',
      'some tunes', 'tunes', 'a random song', 'my music', 'my songs'
    ];
    if (genericQueries.includes(cleanQuery)) {
      const randomIdx = Math.floor(Math.random() * libraryTracks.length);
      return {
        match: libraryTracks[randomIdx],
        index: randomIdx,
        score: 100,
        status: 'MATCH_FOUND'
      };
    }

    let candidates = [];

    libraryTracks.forEach((track, index) => {
      const rawTitle = track.title || track.name || '';
      const rawArtist = track.artist || '';
      const filenameNoExt = (track.fileBlob?.name || rawTitle).replace(/\.[^/.]+$/, '');

      const normTitle = normalizeSearchText(rawTitle);
      const normFilename = normalizeSearchText(filenameNoExt);
      const normArtist = normalizeSearchText(rawArtist);

      let score = 0;

      // 1. Exact Match against Title Metadata
      if (normTitle === cleanQuery) {
        score = 100;
      }
      // 2. Exact Match against Filename (minus .mp3/.flac/etc)
      else if (normFilename === cleanQuery) {
        score = 98;
      }
      // 3. Combined Title + Artist match (e.g. "desperado rihanna")
      else if (normTitle && normArtist && (normTitle + ' ' + normArtist === cleanQuery || normArtist + ' ' + normTitle === cleanQuery)) {
        score = 95;
      }
      // 4. StartsWith / Prefix Match
      else if (normTitle.startsWith(cleanQuery) || normFilename.startsWith(cleanQuery)) {
        score = 88;
      }
      // 5. Query starts with title (e.g. "play late nights please")
      else if (cleanQuery.startsWith(normTitle) && normTitle.length >= 3) {
        score = 86;
      }
      // 6. Substring match
      else if (normTitle.includes(cleanQuery) || cleanQuery.includes(normTitle)) {
        score = 78;
      }
      // 7. Filename substring
      else if (normFilename.includes(cleanQuery) || cleanQuery.includes(normFilename)) {
        score = 75;
      }
      // 8. Strong Fuzzy Levenshtein Match
      else {
        const titleSim = calculateSimilarity(normTitle, cleanQuery);
        const fileSim = calculateSimilarity(normFilename, cleanQuery);
        const bestSim = Math.max(titleSim, fileSim);
        if (bestSim >= 0.70) {
          score = Math.round(bestSim * 85);
        }
      }

      if (score > 60) {
        candidates.push({ track, index, score, normTitle, rawArtist });
      }
    });

    if (candidates.length === 0) {
      return { match: null, status: 'NOT_FOUND' };
    }

    // Sort by highest match score
    candidates.sort((a, b) => b.score - a.score);
    const topCandidate = candidates[0];

    return {
      match: topCandidate.track,
      index: topCandidate.index,
      score: topCandidate.score,
      status: 'MATCH_FOUND'
    };
  }

  /**
   * Play matched song using existing Musico/Atsuko player
   */
  function playMatchedSong(matchedTrack, targetIndex) {
    const player = window.appPlayer || window.player;
    if (!player) {
      console.warn('[Atsuko Voice] Player instance not ready.');
      return false;
    }

    let libraryTracks = getAvailableTracks();
    let idx = targetIndex;

    if (matchedTrack && (idx < 0 || idx >= libraryTracks.length || libraryTracks[idx]?.id !== matchedTrack.id)) {
      idx = libraryTracks.findIndex(t => t.id === matchedTrack.id || (t.title && matchedTrack.title && normalizeSearchText(t.title) === normalizeSearchText(matchedTrack.title)));
    }

    if (idx === -1 && matchedTrack) {
      libraryTracks = [matchedTrack];
      idx = 0;
    }

    if (libraryTracks.length > 0 && idx >= 0) {
      player.setQueue(libraryTracks, idx, true);
      if (typeof player.updateNowPlayingUI === 'function') {
        player.updateNowPlayingUI();
      }
      if (typeof window.updateColumnMiniPlayerVisibility === 'function') {
        window.updateColumnMiniPlayerVisibility();
      }
      return true;
    }
    return false;
  }

  /**
   * Initialize Web Audio API Analyser for Voice Indicators
   */
  async function initWebAudioAnalyser(stream) {
    try {
      if (audioContext && audioContext.state !== 'closed') {
        if (audioContext.state === 'suspended') {
          await audioContext.resume();
        }
        return analyser;
      }

      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return null;

      audioContext = new AudioCtx();
      const source = audioContext.createMediaStreamSource(stream);
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.65;
      source.connect(analyser);

      return analyser;
    } catch (e) {
      console.info('[Atsuko Voice] Web Audio Analyser waiting for user interaction:', e.message);
      return null;
    }
  }

  /**
   * 4-Bar Dynamic Voice Visualizer Loop
   * - Responds dynamically when speech is received
   * - Smooth idle breathing wave matching reference screenshot proportions (75px, 55px, 65px, 95px)
   * - Operates with zero microphone locks so SpeechRecognition has 100% exclusive audio capture
   */
  function startVisualizerLoop() {
    if (animFrameId) cancelAnimationFrame(animFrameId);

    // Resting baseline heights (pixels) matching reference screenshot
    const baseHeights = [75, 55, 65, 95];
    const currentHeights = [...baseHeights];

    function renderFrame() {
      idleAnimationPhase += 0.055;

      const timeSinceSpeech = Date.now() - lastVoiceDetectedTimestamp;
      const isActivelySpeaking = timeSinceSpeech < 1200;

      // Update the 4 bars
      for (let i = 0; i < 4; i++) {
        let targetHeight;

        if (isActivelySpeaking) {
          // Dynamic lively oscillation during user voice activity
          const wave = Math.sin(idleAnimationPhase * 3.2 + i * 1.3) * 18;
          const bounce = Math.cos(idleAnimationPhase * 2.1 + i * 0.9) * 12;
          targetHeight = Math.min(125, Math.max(25, baseHeights[i] + wave + bounce));
        } else {
          // Subtle idle breathing wave
          const phaseOffset = i * 0.7;
          const wave = Math.sin(idleAnimationPhase + phaseOffset) * 6;
          targetHeight = Math.max(20, baseHeights[i] + wave);
        }

        // Smooth interpolation
        currentHeights[i] += (targetHeight - currentHeights[i]) * 0.24;

        if (barElems[i]) {
          barElems[i].style.height = `${Math.round(currentHeights[i])}px`;
        }
      }

      if (isAssistantActive) {
        animFrameId = requestAnimationFrame(renderFrame);
      }
    }

    renderFrame();
  }

  /**
   * Stop visualizer loop
   */
  function stopVisualizerLoop() {
    if (animFrameId) {
      cancelAnimationFrame(animFrameId);
      animFrameId = null;
    }
  }

  /**
   * Extract action and song title from user's spoken command
   * Comprehensive support for:
   * - Play: "Play [song]", "Play something", "Play random", "Play music", "Play"
   * - Playback Controls: "Pause", "Resume", "Next", "Previous", "Shuffle", "Repeat"
   * - Volume Controls: "Volume up", "Volume down", "Mute", "Unmute", "Max volume"
   * - Full View: "Full view", "Full screen", "Exit full view"
   * - Assistant: "Close", "Cancel", "Exit"
   */
  function parseSpokenCommand(transcript) {
    if (!transcript) return null;

    let clean = normalizeSpokenText(transcript);
    if (!clean) return null;

    // Strip leading wake word if present
    clean = clean.replace(WAKE_WORD_PATTERN, '').trim();
    if (!clean) return null;

    // 1. Close / Dismiss commands
    const closeRegex = /^(close|cancel|exit|dismiss|never\s+mind|nevermind|bye|goodbye)$/i;
    if (closeRegex.test(clean)) {
      return { action: 'close', displayCommand: 'Close' };
    }

    // 2. Full View commands
    const fullViewOpenRegex = /^(full\s+view|full\s+screen|fullscreen|show\s+player|open\s+full\s+view|maximize)$/i;
    if (fullViewOpenRegex.test(clean)) {
      return { action: 'full_view', displayCommand: 'Full View Mode' };
    }

    const fullViewCloseRegex = /^(close\s+full\s+view|exit\s+full\s+view|minimize\s+player|exit\s+fullscreen|close\s+player)$/i;
    if (fullViewCloseRegex.test(clean)) {
      return { action: 'close_full_view', displayCommand: 'Exit Full View' };
    }

    // 3. Playback control verbs
    const pauseRegex = /^(pause|stop|hold\s+on|shut\s+up|freeze)(\s+music|\s+song|\s+playback|\s+playing)?$/i;
    if (pauseRegex.test(clean)) {
      return { action: 'pause', displayCommand: 'Pause Music' };
    }

    const resumeRegex = /^(resume|continue|unpause)(\s+music|\s+song|\s+playback)?$/i;
    if (resumeRegex.test(clean)) {
      return { action: 'resume', displayCommand: 'Resume Music' };
    }
    if (clean === 'play') {
      return { action: 'awaiting_song', displayCommand: 'Play...' };
    }

    const nextRegex = /^(next|skip|next\s+song|next\s+track|play\s+next|skip\s+song|skip\s+track|forward)$/i;
    if (nextRegex.test(clean)) {
      return { action: 'next', displayCommand: 'Next Track' };
    }

    const prevRegex = /^(previous|prev|back|go\s+back|previous\s+song|previous\s+track|play\s+previous|last\s+song)$/i;
    if (prevRegex.test(clean)) {
      return { action: 'prev', displayCommand: 'Previous Track' };
    }

    const shuffleRegex = /^(shuffle|shuffle\s+songs|shuffle\s+music|random\s+mode|toggle\s+shuffle|mix\s+songs)$/i;
    if (shuffleRegex.test(clean)) {
      return { action: 'shuffle', displayCommand: 'Shuffle Songs' };
    }

    const repeatRegex = /^(repeat|loop|repeat\s+song|repeat\s+one|loop\s+song|toggle\s+repeat)$/i;
    if (repeatRegex.test(clean)) {
      return { action: 'repeat', displayCommand: 'Repeat One' };
    }

    // 4. Volume controls
    const volUpRegex = /^(volume\s+up|increase\s+volume|turn\s+it\s+up|turn\s+up|louder|higher\s+volume)$/i;
    if (volUpRegex.test(clean)) {
      return { action: 'volume_up', displayCommand: 'Volume Up' };
    }

    const volDownRegex = /^(volume\s+down|decrease\s+volume|turn\s+it\s+down|turn\s+down|quieter|lower\s+volume|softer)$/i;
    if (volDownRegex.test(clean)) {
      return { action: 'volume_down', displayCommand: 'Volume Down' };
    }

    const muteRegex = /^(mute|silence|be\s+quiet)$/i;
    if (muteRegex.test(clean)) {
      return { action: 'mute', displayCommand: 'Mute' };
    }

    const unmuteRegex = /^(unmute|restore\s+volume)$/i;
    if (unmuteRegex.test(clean)) {
      return { action: 'unmute', displayCommand: 'Unmute' };
    }

    const volMaxRegex = /^(max\s+volume|full\s+volume|maximum\s+volume|100\s+percent\s+volume)$/i;
    if (volMaxRegex.test(clean)) {
      return { action: 'volume_max', displayCommand: 'Full Volume' };
    }

    // 5. Generic Play (Random / Something / Music / "Play this song" / "Play this music")
    const genericPlayRegex = /^(?:play\s+)?(this\s+music|this\s+song|the\s+music|the\s+song|song|something|anything|music|random|a\s+song|some\s+song|some\s+music|songs|shuffle|any\s+song|whatever|random\s+song|something\s+good|some\s+track|a\s+track|tracks|something\s+nice|some\s+tunes|tunes|a\s+random\s+song|my\s+music|my\s+songs)$/i;
    if (genericPlayRegex.test(clean)) {
      return {
        action: 'play',
        songQuery: 'something',
        displayCommand: 'Play Music'
      };
    }

    // 6. Play song command with explicit verb ("play", "start", "listen to", "put on")
    const actionRegex = /^(play|start|listen\s+to|put\s+on)\s+(.+)$/i;
    const match = clean.match(actionRegex);

    if (match) {
      let rawSong = match[2].trim();
      rawSong = rawSong.replace(/^(the\s+song|the\s+track|song|track|the)\s+/i, '').replace(/\s+(song|track)$/i, '').trim();
      return {
        action: 'play',
        songQuery: rawSong,
        displayCommand: `Play ${rawSong}`
      };
    }

    // 7. Direct song title (e.g. user simply said "Late Nights", "Telephones", "I Know")
    let directSong = clean.replace(/^(the\s+song|the\s+track|song|track|the)\s+/i, '').replace(/\s+(song|track)$/i, '').trim();
    return {
      action: 'play',
      songQuery: directSong || clean,
      displayCommand: `Play ${directSong || clean}`
    };
  }

  /**
   * Show success feedback in command box, smoothly restore audio, and close panel after brief pause
   */
  function showCommandSuccess(text) {
    if (commandInputElem) {
      commandInputElem.value = text;
      commandInputElem.style.color = '#FFFFFF';
    }
    if (commandBoxElem) {
      commandBoxElem.classList.add('command-success');
    }

    clearTimeout(panelSilenceTimer);
    clearTimeout(autoCloseTimer);
    clearTimeout(commandWindowTimer);
    clearTimeout(recoveryWindowTimer);

    // Gradual volume return to exact original level as requested action completes
    restoreMusic(350);

    autoCloseTimer = setTimeout(() => {
      closeVoiceAssistant();
    }, 1300);
  }

  /**
   * Process and execute spoken command with immediate response
   */
  async function executeVoiceCommand(commandInfo) {
    if (!commandInfo) return;

    clearTimeout(commandWindowTimer);
    clearTimeout(recoveryWindowTimer);
    currentState = VOICE_STATE.PROCESSING;

    if (commandInputElem) {
      commandInputElem.value = commandInfo.displayCommand;
    }

    const player = window.appPlayer || window.player;
    currentState = VOICE_STATE.EXECUTING;

    // Media Control actions
    if (commandInfo.action === 'awaiting_song') {
      if (commandInputElem) {
        commandInputElem.value = 'Play...';
        commandInputElem.placeholder = 'Speak song name (e.g. Blinding Lights)...';
      }
      isAwaitingSongQuery = true;
      currentState = VOICE_STATE.LISTENING;
      startCommandListeningWindow();
      return;
    }

    if (commandInfo.action === 'close') {
      restoreMusic(350);
      closeVoiceAssistant();
      return;
    }

    if (commandInfo.action === 'full_view') {
      if (typeof window.openSongFullView === 'function') {
        window.openSongFullView();
      }
      showCommandSuccess('⛶ Full View Mode');
      return;
    }

    if (commandInfo.action === 'close_full_view') {
      if (typeof window.closeSongFullView === 'function') {
        window.closeSongFullView();
      }
      showCommandSuccess('Exit Full View');
      return;
    }

    if (commandInfo.action === 'pause') {
      if (player) {
        if (typeof player.pause === 'function') {
          player.pause();
        } else if (player.audio) {
          player.audio.pause();
          player.isPlaying = false;
          if (typeof player.updatePlayPauseUI === 'function') player.updatePlayPauseUI();
        }
      }
      showCommandSuccess('⏸ Paused');
      return;
    }

    if (commandInfo.action === 'resume') {
      if (player) {
        if (typeof player.play === 'function') {
          player.play();
        } else if (player.audio) {
          if (typeof player.initWebAudio === 'function') player.initWebAudio();
          player.audio.play().catch(() => {});
          player.isPlaying = true;
          if (typeof player.updatePlayPauseUI === 'function') player.updatePlayPauseUI();
        } else if (player.togglePlay) {
          player.togglePlay();
        }
      }
      showCommandSuccess('▶ Resumed');
      return;
    }

    if (commandInfo.action === 'next') {
      if (player && typeof player.next === 'function') player.next();
      showCommandSuccess('⏭ Next Track');
      return;
    }

    if (commandInfo.action === 'prev') {
      if (player && typeof player.prev === 'function') player.prev();
      showCommandSuccess('⏮ Previous Track');
      return;
    }

    if (commandInfo.action === 'shuffle') {
      if (player && typeof player.toggleShuffle === 'function') {
        player.toggleShuffle();
      }
      showCommandSuccess('🔀 Shuffle Mode');
      return;
    }

    if (commandInfo.action === 'repeat') {
      if (player && typeof player.setPlaybackMode === 'function') {
        const nextMode = player.playbackMode === 'repeat_one' ? 'normal' : 'repeat_one';
        player.setPlaybackMode(nextMode);
      }
      showCommandSuccess('🔂 Repeat One');
      return;
    }

    if (commandInfo.action === 'volume_up') {
      if (player && typeof player.setVolume === 'function') {
        const cur = player.volume !== undefined ? player.volume : 0.7;
        player.setVolume(Math.min(1.0, cur + 0.15));
      }
      showCommandSuccess('🔊 Volume Up');
      return;
    }

    if (commandInfo.action === 'volume_down') {
      if (player && typeof player.setVolume === 'function') {
        const cur = player.volume !== undefined ? player.volume : 0.7;
        player.setVolume(Math.max(0.0, cur - 0.15));
      }
      showCommandSuccess('🔉 Volume Down');
      return;
    }

    if (commandInfo.action === 'mute') {
      if (player && typeof player.setVolume === 'function') {
        player.setVolume(0.0);
      }
      showCommandSuccess('🔇 Muted');
      return;
    }

    if (commandInfo.action === 'unmute') {
      if (player && typeof player.setVolume === 'function') {
        player.setVolume(0.5);
      }
      showCommandSuccess('🔊 Unmuted');
      return;
    }

    if (commandInfo.action === 'volume_max') {
      if (player && typeof player.setVolume === 'function') {
        player.setVolume(1.0);
      }
      showCommandSuccess('🔊 Full Volume');
      return;
    }

    // Song Playback action
    if (commandInfo.action === 'play' && commandInfo.songQuery) {
      await ensureTracksLoaded();
      const searchResult = findBestSongMatch(commandInfo.songQuery);

      if (searchResult.status === 'MATCH_FOUND' && searchResult.match) {
        const track = searchResult.match;
        const success = playMatchedSong(track, searchResult.index);

        if (success) {
          showCommandSuccess(`▶ ${track.title || track.name}`);
        }
      } else if (searchResult.status === 'NO_SONGS_IN_LIBRARY') {
        if (commandInputElem) {
          commandInputElem.value = "No songs in library. Add music first!";
          commandInputElem.style.color = '#FF9F0A';
        }
        setTimeout(() => {
          restoreMusic(350);
          closeVoiceAssistant();
        }, 2200);
      } else {
        // Song not found
        if (commandInputElem) {
          commandInputElem.value = "Sorry, I couldn't find that song.";
          commandInputElem.style.color = '#FF453A';
        }

        setTimeout(() => {
          restoreMusic(350);
          closeVoiceAssistant();
        }, 2200);
      }
    }
  }

  let lastWakeTriggerTimestamp = 0;

  /**
   * Continuous Command Listening Window (5-8 seconds)
   * After detecting "Night", keeps the microphone active for commands without needing wake word again.
   */
  function startCommandListeningWindow() {
    clearTimeout(commandWindowTimer);
    clearTimeout(recoveryWindowTimer);
    commandWindowTimer = setTimeout(() => {
      if (currentState === VOICE_STATE.LISTENING && isAssistantActive) {
        enterRecoveryState();
      }
    }, COMMAND_WINDOW_MS);
  }

  /**
   * Recovery Mechanism: If "Night" activates but fails to receive/understand command,
   * display friendly message, keep music quiet briefly, and give user a retry chance.
   */
  function enterRecoveryState() {
    if (!isAssistantActive) return;
    currentState = VOICE_STATE.RECOVERY;

    if (commandInputElem) {
      commandInputElem.value = "I didn't catch that. Say a song or command...";
      commandInputElem.style.color = '#FF9F0A';
    }

    clearTimeout(recoveryWindowTimer);
    recoveryWindowTimer = setTimeout(() => {
      if (currentState === VOICE_STATE.RECOVERY && isAssistantActive) {
        // User did not provide command during retry window; smoothly restore volume and close
        restoreMusic(350);
        closeVoiceAssistant();
      }
    }, RECOVERY_WINDOW_MS);
  }

  /**
   * Two-Layer Unified Wake Activation Handler
   * Handles instant wake activation on hearing "Night", "Hey Night", "NX", "Nox", "Arden"
   */
  function handleWakeWordActivation(detectorSource, trailingText = '', isFinal = false) {
    const now = Date.now();
    if (now - lastWakeTriggerTimestamp < 1200) {
      return; // Atomic lock prevents duplicate activations within 1.2s
    }
    lastWakeTriggerTimestamp = now;
    currentState = VOICE_STATE.WAKE_DETECTED;

    console.log(`[Atsuko Voice] Wake Word Triggered ("Night" / "${detectorSource}"):`, trailingText ? `Trailing: "${trailingText}"` : 'Active Command Listening Mode');

    // 1. Duck playing music to ~18% smoothly
    duckMusic(0.18, 250);

    // 2. Play subtle soft confirmation chime
    playActivationChime();

    // 3. Open Assistant Panel
    currentState = VOICE_STATE.ACTIVATED;
    openVoiceAssistant(trailingText);

    // 4. Pattern A (Single Utterance: "Hey Night, play Blinding Lights")
    if (trailingText && trailingText.trim().length > 0) {
      currentState = VOICE_STATE.PROCESSING;
      const cmd = parseSpokenCommand(trailingText);
      if (cmd) {
        currentState = VOICE_STATE.EXECUTING;
        if (isFinal) {
          executeVoiceCommand(cmd);
        } else {
          clearTimeout(commandDebounceTimer);
          const delay = (cmd.action === 'play' && cmd.songQuery !== 'something') ? 450 : 180;
          commandDebounceTimer = setTimeout(() => {
            executeVoiceCommand(cmd);
          }, delay);
        }
      }
    } else {
      // 5. Pattern B (Conversational: "Night" -> Panel opens -> 6.5s command listening window)
      currentState = VOICE_STATE.LISTENING;
      startCommandListeningWindow();
    }
  }

  /**
   * Open the Voice Assistant Interface
   */
  function openVoiceAssistant(initialQuery = '') {
    if (!panelElem) return;

    isAssistantActive = true;
    isListeningForCommand = true;
    isAwaitingSongQuery = false;
    lastVoiceDetectedTimestamp = Date.now();

    // Ensure speech recognizer is running when assistant opens
    if (!isEngineRunning || !recognitionInstance) {
      createAndStartRecognizer();
    }

    // 1. Update dynamic greeting with user's name
    const userName = getUserProfileName();
    if (greetingElem) {
      greetingElem.textContent = `Hii! ${userName}`;
    }

    // 2. Set command input
    if (commandInputElem) {
      if (initialQuery && initialQuery.trim()) {
        let cleanInit = initialQuery.trim();
        if (!cleanInit.toLowerCase().startsWith('play')) {
          cleanInit = `Play ${cleanInit}`;
        } else {
          cleanInit = cleanInit.charAt(0).toUpperCase() + cleanInit.slice(1);
        }
        commandInputElem.value = cleanInit;
      } else {
        commandInputElem.value = '';
      }
      commandInputElem.placeholder = 'Try "Play Blinding Lights", "Pause", "Next"';
      commandInputElem.style.color = '';
    }

    if (commandBoxElem) {
      commandBoxElem.classList.remove('command-success');
    }

    // 3. Smooth slide-up transition
    panelElem.classList.add('visible');

    // 4. Update Header Buttons
    if (headerVoiceBtn) {
      headerVoiceBtn.classList.add('active');
      headerVoiceBtn.classList.add('listening');
    }
    if (homeVoiceBtn) {
      homeVoiceBtn.classList.add('active');
      homeVoiceBtn.classList.add('listening');
    }

    // 5. Connect Sleek Visualizer Bars (Clean 60fps animation without mic competition)
    startVisualizerLoop();

    // 6. Panel inactivity auto-close fallback
    clearTimeout(panelSilenceTimer);
    panelSilenceTimer = setTimeout(() => {
      if (isAssistantActive && commandInputElem && !commandInputElem.value) {
        closeVoiceAssistant();
      }
    }, 12000);
  }

  /**
   * Close the Voice Assistant Interface
   */
  function closeVoiceAssistant() {
    if (!panelElem) return;

    isAssistantActive = false;
    isListeningForCommand = false;
    isAwaitingSongQuery = false;
    currentState = VOICE_STATE.IDLE;

    clearTimeout(commandDebounceTimer);
    clearTimeout(panelSilenceTimer);
    clearTimeout(autoCloseTimer);
    clearTimeout(commandWindowTimer);
    clearTimeout(recoveryWindowTimer);

    // Smoothly restore music volume back to exact user volume
    restoreMusic(350);

    // Smooth slide-down transition
    panelElem.classList.remove('visible');

    if (headerVoiceBtn) headerVoiceBtn.classList.remove('active');
    if (homeVoiceBtn) homeVoiceBtn.classList.remove('active');

    if (commandInputElem) {
      commandInputElem.value = '';
      commandInputElem.style.color = '';
    }

    deleteRealTimeHistory();
    stopVisualizerLoop();

    // Keep continuous background listener active for subsequent wake words
    if (!isEngineRunning || !recognitionInstance) {
      if (!isExplicitlyStopping) {
        scheduleRecognizerRestart(350);
      }
    }
  }

  /**
   * Create and start a fresh SpeechRecognition instance with crash-loop protection.
   */
  function createAndStartRecognizer() {
    if (isExplicitlyStopping || isStartingRecognizer) return;

    const isEnabled = localStorage.getItem(STORAGE_KEY_VOICE_ENABLED) !== 'false';
    if (!isEnabled) return;

    // If recognizer is already running, do NOT recreate or abort
    if (isEngineRunning && recognitionInstance) {
      return;
    }

    // Clean up stale instance if stopped
    if (recognitionInstance) {
      try {
        recognitionInstance.onend = null;
        recognitionInstance.onerror = null;
        recognitionInstance.onresult = null;
        recognitionInstance.onstart = null;
        recognitionInstance.abort();
      } catch (_) { }
      recognitionInstance = null;
    }

    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRec) {
      console.info('[Atsuko Voice] Web Speech API not supported in this browser environment.');
      return;
    }

    try {
      isStartingRecognizer = true;
      const startingSafetyTimer = setTimeout(() => {
        isStartingRecognizer = false;
      }, 1500);

      const recognizer = new SpeechRec();
      recognizer.continuous = true;
      recognizer.interimResults = true;
      recognizer.lang = navigator.language || 'en-US';
      recognizer.maxAlternatives = 5;

      recognizer.onstart = () => {
        clearTimeout(startingSafetyTimer);
        isStartingRecognizer = false;
        isEngineRunning = true;
        hasPermissionError = false;
        localStorage.setItem(STORAGE_KEY_PERMISSION_GRANTED, 'true');
        if (headerVoiceBtn) headerVoiceBtn.classList.add('listening');
        if (homeVoiceBtn) homeVoiceBtn.classList.add('listening');
        if (setupModalElem) setupModalElem.classList.remove('open');
      };

      recognizer.onresult = (event) => {
        lastVoiceDetectedTimestamp = Date.now();

        if (!event.results || event.results.length === 0) return;

        // Reset panel silence close timer on speech activity
        if (isAssistantActive) {
          clearTimeout(panelSilenceTimer);
          panelSilenceTimer = setTimeout(() => {
            if (isAssistantActive && commandInputElem && !commandInputElem.value) {
              closeVoiceAssistant();
            }
          }, 9500);
        }

        const latestResult = event.results[event.results.length - 1];
        const isFinal = latestResult.isFinal;
        const transcript = latestResult[0]?.transcript?.trim() || '';

        // Update real-time 3.5s sound/word buffer
        const rollingText = updateRealTimeHistory(transcript, isFinal);

        // =====================================================================
        // MODE 1: Assistant is CLOSED -> Continuous Wake-Word Detection
        // =====================================================================
        if (!isAssistantActive) {
          let detectedWake = false;
          let matchedWakeToken = '';
          let wakeCommand = '';

          // 1. Check all speech results from resultIndex to results.length - 1, and all alternatives
          for (let i = event.resultIndex; i < event.results.length; ++i) {
            const res = event.results[i];
            for (let a = 0; a < res.length; ++a) {
              const altText = res[a].transcript;
              const check = extractWakeWordAndCommand(altText);
              if (check && check.hasWakeWord) {
                detectedWake = true;
                matchedWakeToken = check.matchedToken;
                wakeCommand = check.command || '';
                break;
              }
            }
            if (detectedWake) break;
          }

          // 2. Multi-utterance 3.5-second rolling sound/word buffer check
          if (!detectedWake && rollingText) {
            const check = extractWakeWordAndCommand(rollingText);
            if (check && check.hasWakeWord) {
              detectedWake = true;
              matchedWakeToken = check.matchedToken;
              wakeCommand = check.command || '';
            }
          }

          if (detectedWake) {
            // Delete history instantly to prevent any memory accumulation
            deleteRealTimeHistory();
            console.log(`[Atsuko Voice] Wake Word Spotted: "${matchedWakeToken}" | Trailing: "${wakeCommand}"`);
            handleWakeWordActivation('SpeechRecognition', wakeCommand, isFinal);
            return;
          }

          // Prevent Chrome internal memory buildup by periodically recycling continuous buffer
          if (event.results.length >= 6 && isFinal) {
            try { recognizer.stop(); } catch (_) { }
          }
          return;
        }

        // =====================================================================
        // MODE 2: Assistant is OPEN -> Listen for voice commands
        // =====================================================================
        if (!transcript) return;

        // Reset command listening window timer when speech is actively heard
        if (currentState === VOICE_STATE.LISTENING || currentState === VOICE_STATE.RECOVERY) {
          clearTimeout(commandWindowTimer);
          clearTimeout(recoveryWindowTimer);
        }

        // Strip wake word if the user repeats it (e.g. "Night, play this song")
        let commandText = transcript;
        const check = extractWakeWordAndCommand(transcript);
        if (check && check.hasWakeWord) {
          commandText = check.command || '';
        }

        // If user previously said "Play", attach song query directly
        if (isAwaitingSongQuery && commandText && !commandText.toLowerCase().startsWith('play')) {
          commandText = 'play ' + commandText;
          isAwaitingSongQuery = false;
        }

        if (!commandText) return;

        const cmd = parseSpokenCommand(commandText);
        if (cmd && cmd.displayCommand) {
          clearTimeout(commandWindowTimer);
          clearTimeout(recoveryWindowTimer);
          currentState = VOICE_STATE.PROCESSING;

          if (commandInputElem) {
            commandInputElem.value = cmd.displayCommand;
            commandInputElem.style.color = '#FFFFFF';
          }

          if (cmd.action === 'awaiting_song') {
            isAwaitingSongQuery = true;
            currentState = VOICE_STATE.LISTENING;
            startCommandListeningWindow();
            return;
          }

          // Instant execution on isFinal
          if (isFinal) {
            deleteRealTimeHistory();
            clearTimeout(commandDebounceTimer);
            currentState = VOICE_STATE.EXECUTING;
            executeVoiceCommand(cmd);
          } else {
            // Low-latency debounce on interim results
            clearTimeout(commandDebounceTimer);
            const isInstantAction = cmd.action !== 'play' || cmd.songQuery === 'something';
            const delayMs = isInstantAction ? 180 : 450;
            commandDebounceTimer = setTimeout(() => {
              deleteRealTimeHistory();
              currentState = VOICE_STATE.EXECUTING;
              executeVoiceCommand(cmd);
            }, delayMs);
          }
        }
      };

      recognizer.onerror = (e) => {
        clearTimeout(startingSafetyTimer);
        isStartingRecognizer = false;

        if (e.error === 'no-speech' || e.error === 'aborted') {
          // Normal silence: recognizer ends and onend will restart cleanly
          return;
        }

        isEngineRunning = false;
        recognitionInstance = null;

        if (e.error === 'not-allowed') {
          console.warn('[Atsuko Voice] Microphone permission waiting for user grant or gesture.');
          hasPermissionError = true;
          if (headerVoiceBtn) headerVoiceBtn.classList.remove('listening');
          if (homeVoiceBtn) homeVoiceBtn.classList.remove('listening');
          // Self-heal retry with 2.5s backoff
          scheduleRecognizerRestart(2500);
          return;
        }

        if (e.error === 'service-not-allowed') {
          console.info('[Atsuko Voice] Speech recognition service reconnecting in 1.2s...');
          hasPermissionError = false;
          scheduleRecognizerRestart(1200);
          return;
        }

        if (e.error === 'audio-capture' || e.error === 'network') {
          console.info(`[Atsuko Voice] Speech session reset (${e.error}), auto-reconnecting in 1.0s...`);
          hasPermissionError = false;
          scheduleRecognizerRestart(1000);
          return;
        }

        console.warn('[Atsuko Voice] Speech recognizer notice:', e.error);
        scheduleRecognizerRestart(800);
      };

      recognizer.onend = () => {
        clearTimeout(startingSafetyTimer);
        isStartingRecognizer = false;
        isEngineRunning = false;
        recognitionInstance = null;

        if (isExplicitlyStopping) return;

        // Clean restart with WASAPI release backoff protection
        scheduleRecognizerRestart(450);
      };

      recognizer.start();
      recognitionInstance = recognizer;
      hasPermissionError = false;

      if (headerVoiceBtn) headerVoiceBtn.classList.add('listening');
      if (homeVoiceBtn) homeVoiceBtn.classList.add('listening');
    } catch (e) {
      isStartingRecognizer = false;
      isEngineRunning = false;
      recognitionInstance = null;
      console.warn('[Atsuko Voice] Recognizer start notice:', e.message || e);
      if (!isExplicitlyStopping) {
        scheduleRecognizerRestart(800);
      }
    }
  }

  /**
   * Register acoustic training profiles from both user MP3 samples
   */
  function loadAndTrainFromWakeSample() {
    trainedAudioProfile = {
      samples: [
        { file: 'assets/atsuko-wake-sample.mp3', keywords: ['NX', 'Anex', 'Nox', 'Night', 'Arden'] },
        { file: 'assets/atsuko-wake-sample2.mp3', keywords: ['Hey! NX', 'Hey! Nox', 'Hey! Night', 'Hey! Arden'] }
      ],
      keywords: ['NX', 'Anex', 'Nox', 'Night', 'Arden', 'Hey! NX', 'Hey! Nox', 'Hey! Night', 'Hey! Arden'],
      trainedAt: new Date().toISOString()
    };
    console.log('[Voice Assistant] Trained acoustic profile active for keywords: "NX", "Night", "Nox", "Arden".');
  }

  /**
   * Initialize Wake-Word Listening Engine
   */
  async function startListeningEngine() {
    try {
      isExplicitlyStopping = false;
      hasPermissionError = false;

      localStorage.setItem(STORAGE_KEY_VOICE_ENABLED, 'true');
      localStorage.setItem(STORAGE_KEY_PERMISSION_GRANTED, 'true');

      if (!isEngineRunning || !recognitionInstance) {
        createAndStartRecognizer();
      }

      if (window.AtsukoKWS && typeof window.AtsukoKWS.start === 'function') {
        window.AtsukoKWS.start().catch(() => {});
      }

      if (headerVoiceBtn) headerVoiceBtn.classList.add('listening');
      if (homeVoiceBtn) homeVoiceBtn.classList.add('listening');

      return true;
    } catch (err) {
      console.warn('[Atsuko Voice] Listening engine startup notice:', err);
      return false;
    }
  }

  /**
   * Stop Listening Engine & Release Hardware
   */
  function stopListeningEngine() {
    isExplicitlyStopping = true;
    isEngineRunning = false;

    clearTimeout(restartTimeout);

    if (recognitionInstance) {
      try {
        recognitionInstance.onend = null;
        recognitionInstance.onerror = null;
        recognitionInstance.onresult = null;
        recognitionInstance.onstart = null;
        recognitionInstance.abort();
      } catch (_) { }
      recognitionInstance = null;
    }

    if (window.AtsukoKWS && typeof window.AtsukoKWS.stop === 'function') {
      try { window.AtsukoKWS.stop(); } catch (_) { }
    }

    closeVoiceAssistant();

    localStorage.setItem(STORAGE_KEY_VOICE_ENABLED, 'false');

    if (headerVoiceBtn) headerVoiceBtn.classList.remove('listening');
    if (homeVoiceBtn) homeVoiceBtn.classList.remove('listening');
  }

  /**
   * Handle user clicking the voice assistant button (Header or Home Page)
   */
  async function handleVoiceActivationClick() {
    hasPermissionError = false;
    isExplicitlyStopping = false;

    if (!isAssistantActive) {
      localStorage.setItem(STORAGE_KEY_VOICE_ENABLED, 'true');
      localStorage.setItem(STORAGE_KEY_PERMISSION_GRANTED, 'true');
      await startListeningEngine();
      openVoiceAssistant();
    } else {
      closeVoiceAssistant();
    }
  }

  /**
   * Development Diagnostics HUD
   * Real-time microphone status, AudioContext state, sample rates,
   * live RMS volume bar, VAD state, and frame counter.
   * Can be toggled with Ctrl + Shift + D.
   */
  function setupDiagnosticsHUD() {
    if (document.getElementById('atsukoDevDiagnosticsHUD')) return;

    const hud = document.createElement('div');
    hud.id = 'atsukoDevDiagnosticsHUD';
    hud.className = 'atsuko-dev-hud hidden';
    hud.innerHTML = `
      <div class="dev-hud-header">
        <span class="dev-hud-title">🔬 ATSUKO KWS DIAGNOSTICS</span>
        <button class="dev-hud-close-btn" id="devHudCloseBtn" title="Close HUD (Toggle: Ctrl+Shift+D)">✕</button>
      </div>
      <div class="dev-hud-body">
        <div class="dev-hud-row">
          <span class="hud-label">Microphone:</span>
          <span class="hud-value active" id="hudMicStatus">Connecting...</span>
        </div>
        <div class="dev-hud-row">
          <span class="hud-label">AudioContext:</span>
          <span class="hud-value" id="hudAudioContextState">uninitialized</span>
        </div>
        <div class="dev-hud-row">
          <span class="hud-label">Sample Rate:</span>
          <span class="hud-value" id="hudSampleRate">Hardware → 16000 Hz</span>
        </div>
        <div class="dev-hud-row">
          <span class="hud-label">Frames Processed:</span>
          <span class="hud-value" id="hudFrameCount">0</span>
        </div>
        <div class="dev-hud-row">
          <span class="hud-label">Live Input RMS:</span>
          <span class="hud-value" id="hudMicLevel">-100 dBFS</span>
        </div>
        <div class="hud-level-bar-wrap">
          <div class="hud-level-bar-fill" id="hudMicBar"></div>
        </div>
        <div class="dev-hud-row">
          <span class="hud-label">VAD State:</span>
          <span class="hud-value" id="hudVadState">SILENCE</span>
        </div>
        <div class="dev-hud-row">
          <span class="hud-label">Layer 1 (KWS):</span>
          <span class="hud-value active" id="hudKwsStatus">Listening (Acoustic)</span>
        </div>
        <div class="dev-hud-row">
          <span class="hud-label">Layer 2 (Speech):</span>
          <span class="hud-value" id="hudSpeechStatus">Ready (Hybrid Fallback)</span>
        </div>
        <div class="dev-hud-row">
          <span class="hud-label">Last Spotted:</span>
          <span class="hud-value" id="hudLastSpotted">—</span>
        </div>
        <div class="dev-hud-row">
          <span class="hud-label">MP3 Calibration:</span>
          <span class="hud-value" id="hudMp3Verified">Trained on User Samples</span>
        </div>
        <div class="hud-hint">Toggle HUD: Ctrl + Shift + D | Standalone: diag.html</div>
      </div>
    `;
    document.body.appendChild(hud);

    const closeBtn = document.getElementById('devHudCloseBtn');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        hud.classList.toggle('hidden');
      });
    }

    // Shortcut Ctrl+Shift+D or Ctrl+Shift+K to toggle HUD
    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'D' || e.key === 'd' || e.key === 'K' || e.key === 'k')) {
        e.preventDefault();
        hud.classList.toggle('hidden');
      }
    });

    // Update loop (15 FPS)
    setInterval(() => {
      if (!window.AtsukoKWS) return;
      const diag = window.AtsukoKWS.getDiagnostics();

      const micEl = document.getElementById('hudMicStatus');
      if (micEl) {
        micEl.textContent = diag.micStatus === 'connected' ? 'Connected (Live)' : diag.micStatus;
        micEl.className = 'hud-value ' + (diag.micStatus === 'connected' ? 'active' : 'warn');
      }

      const ctxEl = document.getElementById('hudAudioContextState');
      if (ctxEl) {
        ctxEl.textContent = diag.audioContextState;
        ctxEl.className = 'hud-value ' + (diag.audioContextState === 'running' ? 'active' : 'warn');
      }

      const rateEl = document.getElementById('hudSampleRate');
      if (rateEl && diag.hardwareSampleRate > 0) {
        rateEl.textContent = `${diag.hardwareSampleRate} Hz → 16000 Hz`;
      }

      const framesEl = document.getElementById('hudFrameCount');
      if (framesEl) {
        framesEl.textContent = diag.audioFramesProcessed.toLocaleString();
      }

      const levelEl = document.getElementById('hudMicLevel');
      const barEl = document.getElementById('hudMicBar');
      if (levelEl && barEl) {
        levelEl.textContent = `${diag.micLevelDbfs} dBFS`;
        const pct = Math.max(0, Math.min(100, (diag.micLevelDbfs + 60) * 1.66));
        barEl.style.width = `${pct}%`;
        barEl.style.background = diag.isVoiceDetected ? '#30D158' : 'rgba(255,255,255,0.2)';
      }

      const vadEl = document.getElementById('hudVadState');
      if (vadEl) {
        vadEl.textContent = diag.isVoiceDetected ? 'SPEECH DETECTED' : 'SILENCE';
        vadEl.className = 'hud-value ' + (diag.isVoiceDetected ? 'active' : '');
      }

      const lastEl = document.getElementById('hudLastSpotted');
      if (lastEl && diag.lastDetectedKeyword) {
        lastEl.textContent = `${diag.lastDetectedKeyword} (${Math.round(diag.lastConfidence * 100)}%)`;
        lastEl.className = 'hud-value active';
      }

      const mp3El = document.getElementById('hudMp3Verified');
      if (mp3El && (diag.sample1Detections > 0 || diag.sample2Detections > 0)) {
        mp3El.textContent = `Verified (${diag.sample1Detections + diag.sample2Detections} tests passed)`;
        mp3El.className = 'hud-value active';
      }
    }, 60);
  }

  /**
   * Bind DOM Events & Initialize
   */
  function setupDOM() {
    panelElem = document.getElementById('voiceAssistantPanel');
    greetingElem = document.getElementById('voiceAssistantGreeting');
    commandInputElem = document.getElementById('voiceAssistantCommandInput');
    commandBoxElem = document.getElementById('voiceAssistantCommandBox');
    closeBtnElem = document.getElementById('voiceAssistantCloseBtn');
    setupModalElem = document.getElementById('voiceSetupModal');

    barElems = [
      document.getElementById('voiceBar1'),
      document.getElementById('voiceBar2'),
      document.getElementById('voiceBar3'),
      document.getElementById('voiceBar4')
    ];

    headerVoiceBtn = document.getElementById('voiceAssistantBtn');
    homeVoiceBtn = document.getElementById('homeVoiceAssistantBtn');

    if (closeBtnElem) {
      closeBtnElem.addEventListener('click', (e) => {
        e.stopPropagation();
        closeVoiceAssistant();
      });
    }

    if (headerVoiceBtn) {
      headerVoiceBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        handleVoiceActivationClick();
      });
    }

    if (homeVoiceBtn) {
      homeVoiceBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        handleVoiceActivationClick();
      });
    }

    // Manual typing in command box
    if (commandInputElem) {
      commandInputElem.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const val = commandInputElem.value.trim();
          if (val) {
            const cmd = parseSpokenCommand(val);
            if (cmd) executeVoiceCommand(cmd);
          }
        }
      });
    }

    // Modal Events
    const confirmSetupBtn = document.getElementById('confirmVoiceSetupBtn');
    const cancelSetupBtn = document.getElementById('cancelVoiceSetupBtn');

    if (confirmSetupBtn) {
      confirmSetupBtn.addEventListener('click', async () => {
        if (setupModalElem) setupModalElem.classList.remove('open');
        hasPermissionError = false;
        localStorage.setItem(STORAGE_KEY_PERMISSION_GRANTED, 'true');
        localStorage.setItem(STORAGE_KEY_VOICE_ENABLED, 'true');
        const ok = await startListeningEngine();
        if (ok) {
          openVoiceAssistant();
        }
      });
    }

    if (cancelSetupBtn) {
      cancelSetupBtn.addEventListener('click', () => {
        if (setupModalElem) setupModalElem.classList.remove('open');
      });
    }

    // Settings Toggle Integration
    const settingsVoiceToggle = document.getElementById('settingsVoiceToggle');
    if (settingsVoiceToggle) {
      const isEnabled = localStorage.getItem(STORAGE_KEY_VOICE_ENABLED) !== 'false';
      settingsVoiceToggle.checked = isEnabled;

      settingsVoiceToggle.addEventListener('change', async () => {
        if (settingsVoiceToggle.checked) {
          await startListeningEngine();
        } else {
          stopListeningEngine();
        }
      });
    }

    // Train acoustic model from both user audio profiles
    loadAndTrainFromWakeSample();

    // Register Dedicated Acoustic KWS Engine Listener (Layer 1)
    if (window.AtsukoKWS && typeof window.AtsukoKWS.onWakeWord === 'function') {
      window.AtsukoKWS.onWakeWord((event) => {
        handleWakeWordActivation(`Layer1-AcousticKWS (${event.keyword})`, '', false);
        if (!isEngineRunning || !recognitionInstance) {
          createAndStartRecognizer();
        }
      });
      if (typeof window.AtsukoKWS.start === 'function') {
        window.AtsukoKWS.start().catch(() => {});
      }
    }

    // Initialize Development Diagnostics HUD
    setupDiagnosticsHUD();

    // Continuous Background Wake-Word listening initiation
    const isVoiceEnabled = localStorage.getItem(STORAGE_KEY_VOICE_ENABLED) !== 'false';

    setTimeout(() => {
      if (isVoiceEnabled && !isExplicitlyStopping) {
        startListeningEngine();
      }
    }, 350);

    if (navigator.permissions && navigator.permissions.query) {
      navigator.permissions.query({ name: 'microphone' }).then(result => {
        if (result.state === 'granted') {
          localStorage.setItem(STORAGE_KEY_PERMISSION_GRANTED, 'true');
          hasPermissionError = false;
          if (isVoiceEnabled && (!isEngineRunning || !recognitionInstance)) {
            startListeningEngine();
          }
        }
        result.onchange = () => {
          if (result.state === 'granted') {
            localStorage.setItem(STORAGE_KEY_PERMISSION_GRANTED, 'true');
            hasPermissionError = false;
            if (isVoiceEnabled && (!isEngineRunning || !recognitionInstance)) {
              startListeningEngine();
            }
          }
        };
      }).catch(() => { });
    }

    // User gesture listener: ensures SpeechRecognition is active upon user interaction
    const onUserGesture = () => {
      const enabled = localStorage.getItem(STORAGE_KEY_VOICE_ENABLED) !== 'false';
      if (enabled && !isExplicitlyStopping && (!isEngineRunning || !recognitionInstance)) {
        startListeningEngine();
      }
    };
    document.addEventListener('click', onUserGesture, { passive: true });
    document.addEventListener('keydown', onUserGesture, { passive: true });

    // Non-invasive real-time continuous listening keep-alive watchdog
    // Ensures SpeechRecognition listener is permanently active and heals from transient disconnects
    setInterval(() => {
      const isVoiceEnabled = localStorage.getItem(STORAGE_KEY_VOICE_ENABLED) !== 'false';
      if (isVoiceEnabled && !isExplicitlyStopping && !isStartingRecognizer && !isEngineRunning && !recognitionInstance) {
        console.info('[Atsuko Voice] Keep-alive watchdog auto-healing active listener...');
        createAndStartRecognizer();
      }
    }, 2500);
  }

  // Expose global API
  window.AtsukoVoice = {
    open: openVoiceAssistant,
    close: closeVoiceAssistant,
    toggle: handleVoiceActivationClick,
    enable: startListeningEngine,
    disable: stopListeningEngine,
    findSong: findBestSongMatch,
    parseCommand: parseSpokenCommand,
    executeCommand: executeVoiceCommand,
    getProfile: () => trainedAudioProfile,
    getState: () => currentState,
    duckAudio: duckMusic,
    restoreAudio: restoreMusic,
    playChime: playActivationChime,
    VOICE_STATE: VOICE_STATE
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupDOM);
  } else {
    setupDOM();
  }
})();
