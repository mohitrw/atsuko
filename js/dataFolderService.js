/**
 * Atsuko - Data Folder & .atu Storage Service
 * Handles File System Access API, handle persistence in IndexedDB,
 * atomic safe writes, rolling backups (.bak), and multi-tab coordination.
 */

(function (window) {
  'use strict';

  const ATU_FILE_NAME = 'atsuko.atu';
  const ATU_BAK_FILE_NAME = 'atsuko.atu.bak';
  const DB_NAME = 'AtsukoStorageDB';
  const DB_VERSION = 1;
  const HANDLE_STORE = 'handles';
  const CACHE_STORE = 'cache';
  const DATA_HANDLE_KEY = 'data_directory_handle';
  const DATA_CACHE_KEY = 'cached_atu_data';

  class DataFolderService {
    constructor() {
      this.dirHandle = null;
      this.cachedData = null;
      this.db = null;
      this.hasWritePermission = false;
      this.isSaving = false;
      this.pendingSave = false;
      this.saveDebounceTimer = null;
      this.broadcastChannel = null;
      this.listeners = {
        onSave: [],
        onPermissionChange: [],
        onRemoteUpdate: []
      };

      this.initBroadcastChannel();
    }

    /**
     * Check if current browser supports the File System Access API
     */
    static isSupported() {
      return typeof window.showDirectoryPicker === 'function';
    }

    /**
     * Initialize IndexedDB for handle & local data caching
     */
    async initDB() {
      if (this.db) return this.db;

      return new Promise((resolve) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains(HANDLE_STORE)) {
            db.createObjectStore(HANDLE_STORE);
          }
          if (!db.objectStoreNames.contains(CACHE_STORE)) {
            db.createObjectStore(CACHE_STORE);
          }
        };

        req.onsuccess = (e) => {
          this.db = e.target.result;
          resolve(this.db);
        };

        req.onerror = (e) => {
          console.warn('[DataFolderService] IndexedDB init error:', e);
          resolve(null);
        };
      });
    }

    /**
     * Setup BroadcastChannel for multi-tab notification and conflict safety
     */
    initBroadcastChannel() {
      if ('BroadcastChannel' in window) {
        try {
          this.broadcastChannel = new BroadcastChannel('atsuko_data_channel');
          this.broadcastChannel.onmessage = (event) => {
            const msg = event.data;
            if (msg && msg.type === 'DATA_UPDATED') {
              console.log('[DataFolderService] Received update notification from another tab');
              this.listeners.onRemoteUpdate.forEach(cb => cb(msg.updatedAt));
            }
          };
        } catch (e) {
          console.warn('[DataFolderService] BroadcastChannel unavailable:', e);
        }
      }
    }

    /**
     * Store directory handle in IndexedDB
     */
    async saveDirectoryHandle(handle) {
      await this.initDB();
      if (!this.db || !handle) return;

      return new Promise((resolve) => {
        try {
          const tx = this.db.transaction(HANDLE_STORE, 'readwrite');
          tx.objectStore(HANDLE_STORE).put(handle, DATA_HANDLE_KEY);
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
        } catch (err) {
          console.warn('[DataFolderService] Error saving handle:', err);
          resolve();
        }
      });
    }

    /**
     * Retrieve directory handle from IndexedDB
     */
    async loadSavedDirectoryHandle() {
      await this.initDB();
      if (!this.db) return null;

      return new Promise((resolve) => {
        try {
          const tx = this.db.transaction(HANDLE_STORE, 'readonly');
          const req = tx.objectStore(HANDLE_STORE).get(DATA_HANDLE_KEY);
          req.onsuccess = () => resolve(req.result || null);
          req.onerror = () => resolve(null);
        } catch (err) {
          console.warn('[DataFolderService] Error loading handle:', err);
          resolve(null);
        }
      });
    }

    /**
     * Save local snapshot of .atu data to IndexedDB cache for instant startup
     */
    async saveLocalCache(data) {
      await this.initDB();
      if (!this.db || !data) return;

      return new Promise((resolve) => {
        try {
          const tx = this.db.transaction(CACHE_STORE, 'readwrite');
          tx.objectStore(CACHE_STORE).put(data, DATA_CACHE_KEY);
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
        } catch (err) {
          resolve();
        }
      });
    }

    /**
     * Load cached .atu data from IndexedDB
     */
    async loadLocalCache() {
      await this.initDB();
      if (!this.db) return null;

      return new Promise((resolve) => {
        try {
          const tx = this.db.transaction(CACHE_STORE, 'readonly');
          const req = tx.objectStore(CACHE_STORE).get(DATA_CACHE_KEY);
          req.onsuccess = () => {
            const res = req.result || null;
            if (res && res.profile && (res.profile.username === 'v22' || res.profile.username === 'V22')) {
              res.profile.username = (typeof localStorage !== 'undefined' && (localStorage.getItem('atsuko_last_valid_username') || localStorage.getItem('atsuko_previous_username'))) || 'new';
            }
            resolve(res);
          };
          req.onerror = () => resolve(null);
        } catch (err) {
          resolve(null);
        }
      });
    }

    /**
     * Check permissions on a directory handle without prompting
     */
    async checkPermission(handle) {
      if (!handle || typeof handle.queryPermission !== 'function') return false;
      try {
        const state = await handle.queryPermission({ mode: 'readwrite' });
        this.hasWritePermission = (state === 'granted');
        return this.hasWritePermission;
      } catch (err) {
        return false;
      }
    }

    /**
     * Request permissions on a directory handle (must be called from a user gesture)
     */
    async requestPermission(handle) {
      const h = handle || this.dirHandle;
      if (!h || typeof h.requestPermission !== 'function') return false;
      try {
        const state = await h.requestPermission({ mode: 'readwrite' });
        this.hasWritePermission = (state === 'granted');
        this.emitPermissionChange(this.hasWritePermission);
        return this.hasWritePermission;
      } catch (err) {
        console.warn('[DataFolderService] Permission request failed/denied:', err);
        return false;
      }
    }

    emitPermissionChange(granted) {
      this.listeners.onPermissionChange.forEach(cb => cb(granted));
    }

    /**
     * Inspect a newly picked directory according to PRD Section 5.2
     * @param {FileSystemDirectoryHandle} dirHandle 
     * @returns {Promise<{
     *   status: 'empty' | 'recordings_only' | 'has_atu' | 'not_empty_no_atu' | 'multiple_atu',
     *   atuFiles: string[],
     *   hasRecordingsSubfolder: boolean,
     *   otherFileCount: number
     * }>}
     */
    async inspectDirectory(dirHandle) {
      const result = {
        status: 'empty',
        atuFiles: [],
        mainAtuCount: 0,
        hasRecordingsSubfolder: false,
        otherFileCount: 0,
        activeFileName: null
      };

      try {
        for await (const entry of dirHandle.values()) {
          const name = entry.name;
          const lower = name.toLowerCase();

          if (entry.kind === 'directory') {
            if (lower === 'recordings') {
              result.hasRecordingsSubfolder = true;
            } else {
              result.otherFileCount++;
            }
          } else if (entry.kind === 'file') {
            if (lower.endsWith('.atu')) {
              result.atuFiles.push(name);
              if (lower === 'main.atu') {
                result.mainAtuCount++;
              }
            } else {
              result.otherFileCount++;
            }
          }
        }
      } catch (e) {
        console.warn('[DataFolderService] Error inspecting directory:', e);
      }

      if (result.mainAtuCount > 1) {
        result.status = 'multiple_main_atu';
        return result;
      }

      if (result.mainAtuCount === 1) {
        result.status = 'has_main_atu';
        result.activeFileName = result.atuFiles.find(f => f.toLowerCase() === 'main.atu');
        return result;
      }

      if (result.atuFiles.length === 1) {
        result.status = 'has_atu';
        result.activeFileName = result.atuFiles[0];
      } else if (result.atuFiles.length > 1) {
        result.status = 'multiple_atu';
      } else if (result.otherFileCount === 0) {
        result.status = result.hasRecordingsSubfolder ? 'recordings_only' : 'empty';
      } else {
        result.status = 'not_empty_no_atu';
      }

      return result;
    }

    /**
     * Connect to a directory handle as the active Data Folder
     */
    async connectDirectory(dirHandle, activeFileName = null) {
      this.dirHandle = dirHandle;
      if (activeFileName) {
        this.activeFileName = activeFileName;
      } else {
        let foundAtu = null;
        try {
          for await (const entry of dirHandle.values()) {
            if (entry.kind === 'file' && entry.name.toLowerCase().endsWith('.atu')) {
              if (entry.name.toLowerCase() === 'main.atu') {
                foundAtu = entry.name;
                break;
              } else if (entry.name.toLowerCase() === 'atsuko.atu') {
                foundAtu = entry.name;
              } else if (!foundAtu) {
                foundAtu = entry.name;
              }
            }
          }
        } catch (_) { }
        this.activeFileName = foundAtu || ATU_FILE_NAME;
      }
      if (dirHandle && dirHandle.name) {
        localStorage.setItem('atsuko_current_folder_name', dirHandle.name);
      }
      await this.saveDirectoryHandle(dirHandle);
      await this.checkPermission(dirHandle);
    }

    /**
     * Merge multiple .atu files found in directory into a single unified main.atu
     */
    async mergeMultipleAtuFiles(dirHandle, fileNames) {
      if (!dirHandle || !Array.isArray(fileNames) || fileNames.length === 0) {
        return { success: false, error: 'No files provided' };
      }

      const sources = [];
      for (const name of fileNames) {
        try {
          const h = await dirHandle.getFileHandle(name, { create: false });
          const f = await h.getFile();
          const text = await f.text();
          const parsed = JSON.parse(text);
          const val = window.AtuSchema.validate(parsed);
          if (val.valid || parsed.songs || parsed.playlists) {
            const migrated = window.AtuSchema.migrate(parsed);
            sources.push({ fileName: name, data: migrated, fileObj: f });
          }
        } catch (e) {
          console.warn(`[DataFolderService] Could not read ${name} for merge:`, e);
        }
      }

      if (sources.length === 0) {
        return { success: false, error: 'Could not read any valid .atu files' };
      }

      const merged = window.AtuSchema ? window.AtuSchema.createDefaultData() : {
        app: 'Atsuko',
        schemaVersion: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        profile: { username: 'USER', avatar: 'assets/default-avatar.svg', joinedAt: new Date().toISOString() },
        settings: { theme: 'dark', volume: 1.0, eqPreset: 'flat', voiceAssistant: true },
        songs: [],
        folders: [],
        playlists: [],
        history: [],
        stats: { totalListeningSec: 0, songsPlayed: 0 },
        recordings: []
      };
      merged.updatedAt = new Date().toISOString();

      // 1. Playlists (Deduplicate by name & ID, union trackIds)
      const plMap = new Map();
      for (const src of sources) {
        const pls = Array.isArray(src.data.playlists) ? src.data.playlists : [];
        for (const pl of pls) {
          const key = (pl.name || '').trim().toLowerCase();
          if (plMap.has(key)) {
            const existing = plMap.get(key);
            const combinedTids = Array.from(new Set([...(existing.trackIds || existing.songIds || []), ...(pl.trackIds || pl.songIds || [])]));
            existing.trackIds = combinedTids;
            existing.songIds = combinedTids;
          } else {
            plMap.set(key, { ...pl });
          }
        }
      }
      merged.playlists = Array.from(plMap.values());

      // 2. Folders (Deduplicate by name, union songIds)
      const folderMap = new Map();
      for (const src of sources) {
        const folders = Array.isArray(src.data.folders) ? src.data.folders : [];
        for (const f of folders) {
          const key = (f.name || '').trim().toLowerCase();
          if (folderMap.has(key)) {
            const existing = folderMap.get(key);
            existing.songIds = Array.from(new Set([...(existing.songIds || []), ...(f.songIds || [])]));
          } else {
            folderMap.set(key, { ...f });
          }
        }
      }
      merged.folders = Array.from(folderMap.values());

      // 3. Favourites (Union of favourite IDs)
      const favSet = new Set();
      for (const src of sources) {
        const favs = Array.isArray(src.data.favourites) ? src.data.favourites : [];
        favs.forEach(id => favSet.add(id));
      }
      merged.favourites = Array.from(favSet);

      // 4. Songs (Deduplicate by title + size)
      const songMap = new Map();
      for (const src of sources) {
        const songs = Array.isArray(src.data.songs) ? src.data.songs : [];
        for (const s of songs) {
          const size = s.fingerprint?.size || 0;
          const key = `${(s.title || '').trim().toLowerCase()}_${size}`;
          if (!songMap.has(key)) {
            songMap.set(key, { ...s });
          }
        }
      }
      merged.songs = Array.from(songMap.values());

      // 5. Stats (Sum totalListeningSec and songsPlayed)
      let totalSec = 0;
      let totalPlays = 0;
      for (const src of sources) {
        if (src.data.stats) {
          totalSec += (src.data.stats.totalListeningSec || 0);
          totalPlays += (src.data.stats.songsPlayed || 0);
        }
      }
      merged.stats = { totalListeningSec: totalSec, songsPlayed: totalPlays };

      // 6. Profile (Pick first non-default user name and avatar)
      for (const src of sources) {
        if (src.data.profile && src.data.profile.username && src.data.profile.username !== 'USER' && merged.profile.username === 'USER') {
          merged.profile.username = src.data.profile.username;
        }
        if (src.data.profile && src.data.profile.avatar && !src.data.profile.avatar.includes('default-avatar.svg') && merged.profile.avatar.includes('default-avatar.svg')) {
          merged.profile.avatar = src.data.profile.avatar;
        }
      }

      // 7. Write to main.atu
      const targetFileName = 'main.atu';
      const fileHandle = await dirHandle.getFileHandle(targetFileName, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(JSON.stringify(merged, null, 2));
      await writable.close();

      this.activeFileName = targetFileName;
      this.cachedData = merged;
      this.multiFileSources = sources;
      this.originalAtuPlaylists = JSON.parse(JSON.stringify(merged.playlists));
      this.originalAtuSongs = JSON.parse(JSON.stringify(merged.songs));
      await this.saveLocalCache(merged);

      return {
        success: true,
        mainFileName: targetFileName,
        mergedData: merged,
        sources: sources
      };
    }

    /**
     * Read the .atu file from the connected Data Folder
     * Falls back to .bak if primary file is corrupted.
     * @param {string} fileName (default: 'atsuko.atu')
     * @returns {Promise<{ data: Object|null, corrupted: boolean, usedBackup: boolean, error?: string }>}
     */
    async readAtuFile(fileName = null) {
      if (!this.dirHandle) {
        // Fallback to local cache if no folder connected
        const cached = await this.loadLocalCache();
        return { data: cached, corrupted: false, usedBackup: false };
      }

      let targetFileName = fileName || this.activeFileName || ATU_FILE_NAME;
      let bakFileName = targetFileName + '.bak';

      let primaryText = null;
      let primaryCorrupted = false;

      // 1. Try reading primary .atu
      try {
        const fileHandle = await this.dirHandle.getFileHandle(targetFileName, { create: false });
        const file = await fileHandle.getFile();
        primaryText = await file.text();
      } catch (err) {
        if (err.name !== 'NotFoundError') {
          console.warn('[DataFolderService] Error reading primary .atu:', err);
        }
      }

      // If primary was not found, check if another .atu file exists in this directory before giving up!
      if (!primaryText && this.dirHandle) {
        try {
          for await (const entry of this.dirHandle.values()) {
            if (entry.kind === 'file' && entry.name.toLowerCase().endsWith('.atu') && entry.name !== targetFileName) {
              try {
                const altHandle = await this.dirHandle.getFileHandle(entry.name, { create: false });
                const altFile = await altHandle.getFile();
                const altText = await altFile.text();
                if (altText && altText.length > 10) {
                  targetFileName = entry.name;
                  this.activeFileName = entry.name;
                  bakFileName = targetFileName + '.bak';
                  primaryText = altText;
                  break;
                }
              } catch (_) { }
            }
          }
        } catch (_) { }
      }

      if (primaryText) {
        try {
          const parsed = JSON.parse(primaryText);
          const val = window.AtuSchema.validate(parsed);
          if (val.valid) {
            const migrated = window.AtuSchema.migrate(parsed);
            if (migrated.profile && (migrated.profile.username === 'v22' || migrated.profile.username === 'V22')) {
              migrated.profile.username = (typeof localStorage !== 'undefined' && (localStorage.getItem('atsuko_last_valid_username') || localStorage.getItem('atsuko_previous_username'))) ||
                (typeof localStorage !== 'undefined' && localStorage.getItem('musico_profile_username') !== 'current' ? localStorage.getItem('musico_profile_username') : 'new') ||
                'new';
            }
            this.cachedData = migrated;
            this.activeFileName = targetFileName;
            if (Array.isArray(migrated.songs) && migrated.songs.length > 0) {
              this.originalAtuSongs = JSON.parse(JSON.stringify(migrated.songs));
            }
            if (Array.isArray(migrated.playlists) && migrated.playlists.length > 0) {
              this.originalAtuPlaylists = JSON.parse(JSON.stringify(migrated.playlists));
            }
            await this.saveLocalCache(migrated);
            return { data: migrated, corrupted: false, usedBackup: false };
          } else if (val.isNewerVersion) {
            return { data: parsed, corrupted: false, usedBackup: false, isNewerVersion: true, error: val.error };
          } else {
            primaryCorrupted = true;
          }
        } catch (e) {
          primaryCorrupted = true;
        }
      }

      // 2. If primary is missing and not corrupted, return null (never leak stale local cache as folder data)
      if (!primaryCorrupted && !primaryText) {
        return { data: null, corrupted: false, usedBackup: false, notFound: true };
      }

      // 3. Try reading backup .bak if primary was corrupted
      console.warn('[DataFolderService] Primary .atu corrupted, attempting recovery from .bak');
      try {
        const bakHandle = await this.dirHandle.getFileHandle(bakFileName, { create: false });
        const bakFile = await bakHandle.getFile();
        const bakText = await bakFile.text();
        const bakParsed = JSON.parse(bakText);
        const val = window.AtuSchema.validate(bakParsed);
        if (val.valid) {
          const migrated = window.AtuSchema.migrate(bakParsed);
          this.cachedData = migrated;
          await this.saveLocalCache(migrated);
          return { data: migrated, corrupted: true, usedBackup: true };
        }
      } catch (bakErr) {
        console.warn('[DataFolderService] Backup .bak unreadable or missing:', bakErr);
      }

      return { data: null, corrupted: true, usedBackup: false, error: 'Both atsuko.atu and backup are unreadable' };
    }

    /**
     * Rename a corrupt file to preserve user data before starting fresh
     */
    async renameCorruptedFile() {
      if (!this.dirHandle) return;
      try {
        const fileHandle = await this.dirHandle.getFileHandle(ATU_FILE_NAME, { create: false });
        const file = await fileHandle.getFile();
        const text = await file.text();
        const corruptName = `atsuko.atu.corrupt-${Date.now()}`;
        const newHandle = await this.dirHandle.getFileHandle(corruptName, { create: true });
        const writable = await newHandle.createWritable();
        await writable.write(text);
        await writable.close();
      } catch (err) {
        console.warn('[DataFolderService] Could not rename corrupted file:', err);
      }
    }

    /**
     * Save .atu data to disk atomically with rolling backup (.bak)
     * Meets Section 8.5 of PRD
     * @param {Object} data 
     * @param {boolean} immediate Whether to skip debounce
     */
    async save(data, immediate = false) {
      if (!data) return;
      this.cachedData = data;
      await this.saveLocalCache(data);

      if (!immediate) {
        if (this.saveDebounceTimer) clearTimeout(this.saveDebounceTimer);
        this.saveDebounceTimer = setTimeout(() => {
          this.executeDiskSave();
        }, 1200);
        return;
      }

      if (this.saveDebounceTimer) {
        clearTimeout(this.saveDebounceTimer);
        this.saveDebounceTimer = null;
      }
      return this.executeDiskSave();
    }

    /**
     * Atomic write implementation
     */
    async executeDiskSave() {
      if (this.isSaving) {
        this.pendingSave = true;
        return;
      }

      if (!this.dirHandle) {
        return;
      }

      if (!this.hasWritePermission) {
        await this.checkPermission(this.dirHandle);
      }

      if (!this.hasWritePermission) {
        try {
          await this.requestPermission(this.dirHandle);
        } catch (_) { }
      }

      if (!this.hasWritePermission) {
        return;
      }

      const raw = this.cachedData;
      if (!raw) return;

      const sanitized = window.AtuSchema.sanitizeForSave(raw);
      if (!sanitized) return;

      if (sanitized.profile && (sanitized.profile.username === 'v22' || sanitized.profile.username === 'V22')) {
        sanitized.profile.username = (typeof localStorage !== 'undefined' && (localStorage.getItem('atsuko_last_valid_username') || localStorage.getItem('atsuko_previous_username'))) ||
          (typeof localStorage !== 'undefined' && localStorage.getItem('musico_profile_username') !== 'current' ? localStorage.getItem('musico_profile_username') : 'new') ||
          'new';
      }

      // Safety check: Never write an empty song list over a previously loaded large library
      // unless user explicitly wiped it
      if (this.previousSongCount && this.previousSongCount > 5 && sanitized.songs.length === 0 && !this._allowEmptyOverride) {
        console.error('[DataFolderService] Refusing to overwrite populated library with 0 songs');
        return;
      }

      this.isSaving = true;

      try {
        const jsonText = JSON.stringify(sanitized, null, 2);

        const targetFileName = this.activeFileName || ATU_FILE_NAME;
        const bakFileName = targetFileName + '.bak';

        // 1. Maintain rolling backup .bak of previous file
        try {
          const currentFileHandle = await this.dirHandle.getFileHandle(targetFileName, { create: false });
          const currentFile = await currentFileHandle.getFile();
          const currentText = await currentFile.text();
          if (currentText && currentText.length > 20) {
            const bakHandle = await this.dirHandle.getFileHandle(bakFileName, { create: true });
            const bakWritable = await bakHandle.createWritable();
            await bakWritable.write(currentText);
            await bakWritable.close();
          }
        } catch (e) {
          // File might not exist yet (first run) - ignore
        }

        // 2. Atomically write new file
        const fileHandle = await this.dirHandle.getFileHandle(targetFileName, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(jsonText);
        await writable.close();

        this.previousSongCount = sanitized.songs.length;
        this.cachedData = sanitized;

        // Broadcast to other tabs
        if (this.broadcastChannel) {
          try {
            this.broadcastChannel.postMessage({ type: 'DATA_UPDATED', updatedAt: sanitized.updatedAt });
          } catch (e) {}
        }

        this.listeners.onSave.forEach(cb => cb(sanitized));
      } catch (err) {
        console.error('[DataFolderService] Error writing .atu to disk:', err);
      } finally {
        this.isSaving = false;
        if (this.pendingSave) {
          this.pendingSave = false;
          this.executeDiskSave();
        }
      }
    }

    /**
     * Completely wipe and reset .atu data to fresh schema
     */
    async resetData() {
      const freshData = window.AtuSchema ? window.AtuSchema.createDefaultData() : {
        app: 'Atsuko',
        schemaVersion: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        profile: { username: 'USER', avatar: 'assets/default-avatar.svg', joinedAt: new Date().toISOString() },
        settings: { theme: 'dark', volume: 1.0, eqPreset: 'flat', voiceAssistant: true },
        songs: [],
        folders: [],
        playlists: [],
        history: [],
        stats: { totalListeningSec: 0, songsPlayed: 0 },
        recordings: []
      };

      if (this.saveDebounceTimer) {
        clearTimeout(this.saveDebounceTimer);
        this.saveDebounceTimer = null;
      }

      this.cachedData = freshData;
      this.originalAtuSongs = [];
      this.originalAtuPlaylists = [];
      this.previousSongCount = 0;
      this._allowEmptyOverride = true;

      // 1. Wipe local cache in IndexedDB
      await this.saveLocalCache(freshData);

      // 2. Force write to disk if folder handle exists
      if (this.dirHandle) {
        try {
          if (!this.hasWritePermission) {
            await this.checkPermission(this.dirHandle);
          }
        } catch (e) {}

        if (this.hasWritePermission) {
          try {
            const targetName = this.activeFileName || ATU_FILE_NAME;
            const targetBakName = targetName.endsWith('.atu') ? targetName.replace(/\.atu$/i, '.bak') : `${targetName}.bak`;
            const jsonText = JSON.stringify(freshData, null, 2);
            const fileHandle = await this.dirHandle.getFileHandle(targetName, { create: true });
            const writable = await fileHandle.createWritable();
            await writable.write(jsonText);
            await writable.close();

            try {
              const bakHandle = await this.dirHandle.getFileHandle(targetBakName, { create: true });
              const bakWritable = await bakHandle.createWritable();
              await bakWritable.write(jsonText);
              await bakWritable.close();
            } catch (e) {}
          } catch (err) {
            console.error('[DataFolderService] Error writing reset to disk:', err);
          }
        }
      }

      this._allowEmptyOverride = false;
      this.listeners.onSave.forEach(cb => cb(freshData));
      return freshData;
    }

    /**
     * Get or create a subfolder inside the Data Folder
     * @param {string} name 
     * @returns {Promise<FileSystemDirectoryHandle|null>}
     */
    async getSubfolder(name) {
      if (!this.dirHandle) return null;
      try {
        return await this.dirHandle.getDirectoryHandle(name, { create: false });
      } catch (e) {
        return null;
      }
    }

    /**
     * Find Recordings folder (case-insensitive) or create if createIfMissing is true
     * @param {boolean} createIfMissing
     * @returns {Promise<FileSystemDirectoryHandle|null>}
     */
    async getRecordingsFolder(createIfMissing = false) {
      if (!this.dirHandle) return null;
      try {
        for await (const entry of this.dirHandle.values()) {
          if (entry.kind === 'directory' && entry.name.toLowerCase() === 'recordings') {
            return entry;
          }
        }
        if (createIfMissing) {
          return await this.dirHandle.getDirectoryHandle('Recordings', { create: true });
        }
      } catch (e) {
        if (createIfMissing) {
          try {
            return await this.dirHandle.getDirectoryHandle('Recordings', { create: true });
          } catch (err) {
            console.warn('[DataFolderService] Could not create Recordings folder:', err);
          }
        }
      }
      return null;
    }

    /**
     * Retrieve all audio recordings directly from disk
     * Reads from Recordings/ subfolder (and root data folder fallback)
     * Reads directly from disk handles so fileBlob is always a live File object.
     * @returns {Promise<Array<Object>>}
     */
    async getDiskRecordings() {
      if (!this.dirHandle) return [];
      const list = [];
      const seenNames = new Set();

      const scanDirectory = async (dirHandle, pathPrefix = 'Recordings/') => {
        try {
          for await (const entry of dirHandle.values()) {
            if (entry.kind === 'file') {
              const lower = entry.name.toLowerCase();
              if (lower.endsWith('.mp3') || lower.endsWith('.wav') || lower.endsWith('.m4a') || lower.endsWith('.ogg')) {
                if (seenNames.has(entry.name)) continue;
                seenNames.add(entry.name);
                try {
                  const file = await entry.getFile();
                  const baseName = entry.name.replace(/\.[^/.]+$/, '');
                  const songId = 'disk_rec_' + entry.name.replace(/[^a-zA-Z0-9_-]/g, '_');
                  const lastModified = file.lastModified || Date.now();
                  const dateStr = new Date(lastModified).toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric'
                  });

                  list.push({
                    id: songId,
                    title: baseName,
                    artist: 'Voice Recording',
                    album: 'Atsuko Recordings',
                    genre: 'Recording',
                    fileName: entry.name,
                    relativePath: pathPrefix + entry.name,
                    fileBlob: file, // Live File object!
                    fileHandle: entry,
                    isLocal: true,
                    source: 'recorded',
                    date: dateStr,
                    timestamp: lastModified,
                    addedAt: new Date(lastModified).toISOString(),
                    coverUrl: 'assets/atsuko.svg'
                  });
                } catch (err) {
                  console.warn('[DataFolderService] Error reading recording file:', entry.name, err);
                }
              }
            }
          }
        } catch (e) {
          console.warn('[DataFolderService] Error scanning directory:', e);
        }
      };

      // 1. Scan Recordings subfolder (primary)
      const recDir = await this.getRecordingsFolder(false);
      if (recDir) {
        await scanDirectory(recDir, 'Recordings/');
      }

      // 2. Also scan root dir for any Recording *.mp3 files (fallback for previously saved)
      try {
        for await (const entry of this.dirHandle.values()) {
          if (entry.kind === 'file' && entry.name.toLowerCase().endsWith('.mp3')) {
            if (entry.name.toLowerCase().startsWith('recording') && !seenNames.has(entry.name)) {
              seenNames.add(entry.name);
              try {
                const file = await entry.getFile();
                const baseName = entry.name.replace(/\.[^/.]+$/, '');
                const songId = 'disk_rec_' + entry.name.replace(/[^a-zA-Z0-9_-]/g, '_');
                const lastModified = file.lastModified || Date.now();
                const dateStr = new Date(lastModified).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric'
                });
                list.push({
                  id: songId,
                  title: baseName,
                  artist: 'Voice Recording',
                  album: 'Atsuko Recordings',
                  genre: 'Recording',
                  fileName: entry.name,
                  relativePath: entry.name,
                  fileBlob: file,
                  fileHandle: entry,
                  isLocal: true,
                  source: 'recorded',
                  date: dateStr,
                  timestamp: lastModified,
                  addedAt: new Date(lastModified).toISOString(),
                  coverUrl: 'assets/atsuko.svg'
                });
              } catch (err) {}
            }
          }
        }
      } catch (e) {}

      // Sort newest first
      list.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      return list;
    }

    /**
     * Add event listener
     */
    on(event, callback) {
      if (this.listeners[event]) {
        this.listeners[event].push(callback);
      }
    }
  }

  window.DataFolderService = DataFolderService;
  window.dataFolderService = new DataFolderService();
})(window);

