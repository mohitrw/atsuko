/**
 * Atsuko - Schema Definition & Migration System (.atu V1)
 * Single source of truth for user data architecture.
 */

(function (window) {
  'use strict';

  const CURRENT_SCHEMA_VERSION = 1;
  const MAX_HISTORY_ITEMS = 5000;
  const MAX_AVATAR_BYTES = 120000; // ~100KB safe ceiling

  const AtuSchema = {
    CURRENT_VERSION: CURRENT_SCHEMA_VERSION,

    /**
     * Create an empty default Atsuko data structure
     */
    createDefaultData(profileOverrides = {}) {
      const now = new Date().toISOString();
      return {
        app: 'Atsuko',
        schemaVersion: CURRENT_SCHEMA_VERSION,
        createdAt: now,
        updatedAt: now,
        profile: {
          username: profileOverrides.username || 'USER',
          avatar: profileOverrides.avatar || 'assets/default-avatar.svg',
          joinedAt: profileOverrides.joinedAt || now
        },
        settings: {
          theme: profileOverrides.theme || 'dark',
          volume: typeof profileOverrides.volume === 'number' ? profileOverrides.volume : 1.0,
          eqPreset: profileOverrides.eqPreset || 'flat',
          voiceAssistant: profileOverrides.voiceAssistant !== undefined ? profileOverrides.voiceAssistant : true
        },
        songs: [],
        folders: [],
        playlists: [],
        favourites: [],
        history: [],
        stats: {
          totalListeningSec: 0,
          songsPlayed: 0
        },
        recordings: []
      };
    },

    /**
     * Validate an imported or loaded .atu data object
     * @param {Object} data 
     * @returns {{ valid: boolean, error?: string, isNewerVersion?: boolean }}
     */
    validate(data) {
      if (!data || typeof data !== 'object') {
        return { valid: false, error: 'Data is not a valid JSON object' };
      }

      if (data.app && data.app !== 'Atsuko' && data.app !== 'Musico') {
        return { valid: false, error: `Unrecognized application signature: ${data.app}` };
      }

      if (typeof data.schemaVersion === 'number' && data.schemaVersion > CURRENT_SCHEMA_VERSION) {
        return {
          valid: false,
          isNewerVersion: true,
          error: `This file was created with a newer version of Atsuko (v${data.schemaVersion}). Please update Atsuko.`
        };
      }

      return { valid: true };
    },

    /**
     * Migrate older data structures forward without losing unknown fields
     * @param {Object} rawData 
     * @returns {Object} Migrated data
     */
    migrate(rawData) {
      if (!rawData || typeof rawData !== 'object') {
        return this.createDefaultData();
      }

      // Preserve all original / unknown fields
      const data = { ...rawData };

      data.app = 'Atsuko';
      data.schemaVersion = data.schemaVersion || 1;
      data.createdAt = data.createdAt || new Date().toISOString();
      data.updatedAt = new Date().toISOString();

      data.profile = data.profile || {};
      let uName = data.profile.username || 'USER';
      if (uName === 'v22' || uName === 'V22') {
        uName = (typeof localStorage !== 'undefined' && (localStorage.getItem('atsuko_last_valid_username') || localStorage.getItem('atsuko_previous_username'))) ||
          (typeof localStorage !== 'undefined' && localStorage.getItem('musico_profile_username') !== 'current' ? localStorage.getItem('musico_profile_username') : 'new') ||
          'new';
      }
      data.profile.username = uName;
      data.profile.avatar = data.profile.avatar || 'assets/default-avatar.svg';
      data.profile.joinedAt = data.profile.joinedAt || data.createdAt;

      data.settings = data.settings || {};
      data.settings.theme = data.settings.theme || 'dark';
      data.settings.volume = typeof data.settings.volume === 'number' ? data.settings.volume : 1.0;
      data.settings.eqPreset = data.settings.eqPreset || 'flat';
      data.settings.voiceAssistant = data.settings.voiceAssistant !== undefined ? data.settings.voiceAssistant : true;

      data.songs = Array.isArray(data.songs) ? data.songs : [];
      data.folders = (Array.isArray(data.folders) ? data.folders : []).map(f => {
        const folder = { ...f };
        folder.songIds = Array.isArray(folder.songIds) ? folder.songIds : (Array.isArray(folder.trackIds) ? folder.trackIds : []);
        return folder;
      });
      data.playlists = (Array.isArray(data.playlists) ? data.playlists : []).map(pl => {
        const p = { ...pl };
        p.trackIds = Array.isArray(p.trackIds) ? p.trackIds : (Array.isArray(p.songIds) ? p.songIds : []);
        p.songIds = p.trackIds;
        return p;
      });
      data.favourites = Array.isArray(data.favourites) ? data.favourites : [];
      data.history = Array.isArray(data.history) ? data.history : [];
      data.stats = data.stats || { totalListeningSec: 0, songsPlayed: 0 };
      data.recordings = Array.isArray(data.recordings) ? data.recordings : [];

      // Future migrations (e.g. if schemaVersion < 2) would go here

      data.schemaVersion = CURRENT_SCHEMA_VERSION;
      return data;
    },

    /**
     * Sanitize data before writing to disk
     * Ensures history cap, removes heavy base64 covers from songs, and verifies integrity
     */
    sanitizeForSave(data) {
      if (!data) return null;
      const clean = { ...data };

      clean.app = 'Atsuko';
      clean.schemaVersion = CURRENT_SCHEMA_VERSION;
      clean.updatedAt = new Date().toISOString();

      if (clean.profile && (clean.profile.username === 'v22' || clean.profile.username === 'V22')) {
        clean.profile.username = (typeof localStorage !== 'undefined' && (localStorage.getItem('atsuko_last_valid_username') || localStorage.getItem('atsuko_previous_username'))) ||
          (typeof localStorage !== 'undefined' && localStorage.getItem('musico_profile_username') !== 'current' ? localStorage.getItem('musico_profile_username') : 'new') ||
          'new';
      }

      // Ensure history doesn't grow unbounded
      if (Array.isArray(clean.history) && clean.history.length > MAX_HISTORY_ITEMS) {
        clean.history = clean.history.slice(-MAX_HISTORY_ITEMS);
      }

      // Ensure playlists store both trackIds and songIds for compatibility
      if (Array.isArray(clean.playlists)) {
        clean.playlists = clean.playlists.map(pl => {
          const p = { ...pl };
          p.trackIds = Array.isArray(p.trackIds) ? p.trackIds : (Array.isArray(p.songIds) ? p.songIds : []);
          p.songIds = p.trackIds;
          return p;
        });
      }

      // Ensure song items do NOT store heavy album art blobs/data URLs in .atu
      if (Array.isArray(clean.songs)) {
        clean.songs = clean.songs.map(song => {
          const s = { ...song };
          // Strip any in-memory blob URLs or heavy data URLs from .atu
          if (s.coverUrl && (s.coverUrl.startsWith('blob:') || s.coverUrl.startsWith('data:'))) {
            delete s.coverUrl;
          }
          if (s.coverBlob) delete s.coverBlob;
          if (s.fileBlob) delete s.fileBlob;
          if (s.audioUrl) delete s.audioUrl;
          return s;
        });
      }

      return clean;
    }
  };

  window.AtuSchema = AtuSchema;
})(window);

