/**
 * Atsuko - Folder Service (Library -> Folders)
 * In-app organizational grouping (PRD Section 6).
 * Rule: One song belongs to at most one Atsuko Folder.
 */

(function (window) {
  'use strict';

  class FolderService {
    constructor() {
      this.folders = [];
      this.listeners = [];
    }

    /**
     * Initialize with folders array from .atu
     * @param {Array} folders 
     */
    init(folders = []) {
      this.folders = Array.isArray(folders) ? [...folders] : [];
    }

    /**
     * Get all active folders
     */
    getAllFolders() {
      return [...this.folders];
    }

    /**
     * Get folder by ID
     */
    getFolderById(id) {
      return this.folders.find(f => f.id === id) || null;
    }

    /**
     * Get folder by Name (case-insensitive)
     */
    getFolderByName(name) {
      if (!name) return null;
      const lower = name.trim().toLowerCase();
      return this.folders.find(f => f.name.trim().toLowerCase() === lower) || null;
    }

    /**
     * Generate smart folder name suggestion based on today's date (e.g. "15 Nov 2026")
     */
    getDateSuggestion() {
      const d = new Date();
      const day = d.getDate();
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const month = months[d.getMonth()];
      const year = d.getFullYear();
      return `${day} ${month} ${year}`;
    }

    /**
     * Validate a folder name
     * Rules: required, trimmed, 1 to 40 characters
     */
    validateName(name) {
      if (!name) return { valid: false, error: 'Folder name is required' };
      const trimmed = name.trim();
      if (trimmed.length < 1 || trimmed.length > 40) {
        return { valid: false, error: 'Folder name must be between 1 and 40 characters' };
      }
      return { valid: true, name: trimmed };
    }

    /**
     * Create a new folder
     */
    createFolder(name) {
      const val = this.validateName(name);
      if (!val.valid) return { success: false, error: val.error };

      const existing = this.getFolderByName(val.name);
      if (existing) {
        return { success: false, error: 'A folder with this name already exists', folder: existing };
      }

      const id = 'f_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 5);
      const newFolder = {
        id: id,
        name: val.name,
        createdAt: new Date().toISOString(),
        songIds: []
      };

      this.folders.push(newFolder);
      this.notify();
      return { success: true, folder: newFolder };
    }

    /**
     * Rename an existing folder
     */
    renameFolder(id, newName) {
      const folder = this.getFolderById(id);
      if (!folder) return { success: false, error: 'Folder not found' };

      const val = this.validateName(newName);
      if (!val.valid) return { success: false, error: val.error };

      const existing = this.getFolderByName(val.name);
      if (existing && existing.id !== id) {
        return { success: false, error: 'Another folder already has this name' };
      }

      folder.name = val.name;
      this.notify();
      return { success: true, folder };
    }

    /**
     * Delete a folder (PRD 6.2: Never deletes songs. Songs stay in All Songs, marked as unsorted)
     * @param {string} id 
     * @param {Array} allSongs All library song objects
     */
    deleteFolder(id, allSongs = []) {
      const index = this.folders.findIndex(f => f.id === id);
      if (index === -1) return false;

      const folder = this.folders[index];
      this.folders.splice(index, 1);

      // Clear folderId from any songs that belonged to this folder
      if (Array.isArray(allSongs)) {
        allSongs.forEach(song => {
          if (song.folderId === id) {
            song.folderId = null;
          }
        });
      }

      this.notify();
      return true;
    }

    /**
     * Assign songs to a folder (One song belongs to at most one Atsuko Folder)
     * @param {string} folderId 
     * @param {Array<string>} songIds 
     * @param {Array} allSongs 
     */
    assignSongsToFolder(folderId, songIds, allSongs = []) {
      const folder = this.getFolderById(folderId);
      if (!folder) return false;

      // 1. Remove these songs from any other folder's songIds array
      this.folders.forEach(f => {
        if (f.id !== folderId && Array.isArray(f.songIds)) {
          f.songIds = f.songIds.filter(id => !songIds.includes(id));
        }
      });

      // 2. Add to target folder if not already present
      if (!Array.isArray(folder.songIds)) folder.songIds = [];
      songIds.forEach(id => {
        if (!folder.songIds.includes(id)) {
          folder.songIds.push(id);
        }
      });

      // 3. Update song objects
      if (Array.isArray(allSongs)) {
        allSongs.forEach(song => {
          if (songIds.includes(song.id)) {
            song.folderId = folderId;
          }
        });
      }

      this.notify();
      return true;
    }

    /**
     * Move a song to another folder
     */
    moveSong(songId, targetFolderId, allSongs = []) {
      return this.assignSongsToFolder(targetFolderId, [songId], allSongs);
    }

    /**
     * Remove a song from its folder (leaving it unsorted)
     */
    removeSongFromFolder(songId, allSongs = []) {
      this.folders.forEach(f => {
        if (Array.isArray(f.songIds)) {
          f.songIds = f.songIds.filter(id => id !== songId);
        }
      });

      if (Array.isArray(allSongs)) {
        const song = allSongs.find(s => s.id === songId);
        if (song) song.folderId = null;
      }

      this.notify();
      return true;
    }

    /**
     * Get songs belonging to a folder
     */
    getSongsInFolder(folderId, allSongs = []) {
      const folder = this.getFolderById(folderId);
      if (!folder || !Array.isArray(folder.songIds)) return [];
      const set = new Set(folder.songIds);
      return allSongs.filter(s => set.has(s.id) || s.folderId === folderId);
    }

    /**
     * Get unsorted songs (songs without a folder)
     */
    getUnsortedSongs(allSongs = []) {
      return allSongs.filter(s => !s.folderId);
    }

    onChange(callback) {
      this.listeners.push(callback);
    }

    notify() {
      this.listeners.forEach(cb => cb(this.folders));
    }
  }

  window.FolderService = FolderService;
  window.folderService = new FolderService();
})(window);

