/**
 * Atsuko - First Run Onboarding Wizard & Dialog Controller
 * Manages Welcome Guide, Data Folder Picker, Folder Validation, and Add-to-Folder prompts.
 */

(function (window) {
  'use strict';

  class OnboardingWizard {
    constructor() {
      this.currentStep = 1;
      this.totalSteps = 4;
      this.selectedFolderHandle = null;
      this.onCompleteCallback = null;
      this.onRestoreCallback = null;
      this._listenersInitialized = false;
    }

    /**
     * Check browser compatibility for modern File System Access API
     */
    checkBrowserSupport() {
      if (!window.DataFolderService || !window.DataFolderService.isSupported()) {
        const modal = document.getElementById('browserUnsupportedModal');
        if (modal) {
          modal.style.display = 'flex';
          modal.classList.add('open');
        }
        return false;
      }
      return true;
    }

    /**
     * Initialize DOM event listeners for the welcome guide
     */
    initListeners() {
      if (this._listenersInitialized) return;
      this._listenersInitialized = true;

      const nextBtn = document.getElementById('welcomeNextBtn');
      const backBtn = document.getElementById('welcomeBackBtn');
      const skipBtn = document.getElementById('welcomeSkipBtn');
      const closeBtn = document.getElementById('closeWelcomeBtn');

      if (nextBtn) {
        nextBtn.onclick = () => this.nextStep();
      }
      if (backBtn) {
        backBtn.onclick = () => this.prevStep();
      }
      if (skipBtn) {
        skipBtn.onclick = () => this.skipWizard();
      }
      if (closeBtn) {
        closeBtn.onclick = () => this.closeWelcome();
      }

      for (let i = 1; i <= this.totalSteps; i++) {
        const dot = document.getElementById(`welcomeDot${i}`);
        if (dot) {
          dot.onclick = () => {
            this.currentStep = i;
            this.updateWizardStepUI();
          };
        }
      }

      // Slide 2: Data folder picker button
      const pickDataFolderBtn = document.getElementById('welcomePickDataFolderBtn');
      if (pickDataFolderBtn) {
        pickDataFolderBtn.onclick = async () => {
          const res = await this.pickDataFolder();
          if (res) {
            const statusEl = document.getElementById('welcomeDataFolderStatus');
            if (statusEl) {
              statusEl.textContent = `✓ Connected to: ${res.handle.name}`;
              statusEl.style.color = '#34C759';
            }
            if (res.type === 'restore') {
              this.closeWelcome();
              if (this.onRestoreCallback) this.onRestoreCallback(res.data);
            } else {
              // Proceed smoothly to Slide 3 (Add songs)
              setTimeout(() => {
                this.nextStep();
              }, 400);
            }
          }
        };
      }

      // Slide 3: Audio files picker button
      const pickAudioFilesBtn = document.getElementById('welcomePickAudioFilesBtn');
      if (pickAudioFilesBtn) {
        pickAudioFilesBtn.onclick = async () => {
          await this.handleOnboardingAddFiles();
        };
      }

      // Slide 3: Music folder picker button
      const pickMusicFolderBtn = document.getElementById('welcomePickMusicFolderBtn');
      if (pickMusicFolderBtn) {
        pickMusicFolderBtn.onclick = async () => {
          await this.handleOnboardingAddFolder();
        };
      }

      // Browser unsupported dismiss
      const unsupportedDismiss = document.getElementById('browserUnsupportedDismissBtn');
      if (unsupportedDismiss) {
        unsupportedDismiss.onclick = () => {
          const modal = document.getElementById('browserUnsupportedModal');
          if (modal) {
            modal.classList.remove('open');
            modal.style.display = 'none';
          }
        };
      }
    }

    /**
     * Open the Welcome Guide modal
     * @param {Object} options { isManual: boolean, onComplete: Function, onRestore: Function }
     */
    openWelcome(options = {}) {
      this.initListeners();
      this.currentStep = 1;
      this.isManual = Boolean(options.isManual);
      this.onCompleteCallback = options.onComplete || null;
      this.onRestoreCallback = options.onRestore || null;

      const modal = document.getElementById('atsukoWelcomeModal');
      if (!modal) return;

      // Update statuses if already connected or has songs
      const statusEl = document.getElementById('welcomeDataFolderStatus');
      if (statusEl) {
        if (window.dataFolderService && window.dataFolderService.dirHandle) {
          statusEl.textContent = `✓ Connected: ${window.dataFolderService.dirHandle.name}`;
          statusEl.style.color = '#34C759';
        } else {
          statusEl.textContent = 'Not chosen yet';
          statusEl.style.color = '#8E8E93';
        }
      }

      const songStatusEl = document.getElementById('welcomeAddMusicStatus');
      if (songStatusEl) {
        const count = (window.allTracks || []).length;
        songStatusEl.textContent = `${count} song${count === 1 ? '' : 's'} in library`;
      }

      this.updateWizardStepUI();
      modal.style.display = 'flex';
      modal.classList.add('open');
    }

    closeWelcome() {
      const modal = document.getElementById('atsukoWelcomeModal');
      if (modal) {
        modal.classList.remove('open');
        modal.style.display = 'none';
      }
    }

    nextStep() {
      if (this.currentStep < this.totalSteps) {
        this.currentStep++;
        this.updateWizardStepUI();
      } else {
        this.finishWelcome();
      }
    }

    prevStep() {
      if (this.currentStep > 1) {
        this.currentStep--;
        this.updateWizardStepUI();
      }
    }

    skipWizard() {
      this.finishWelcome();
    }

    finishWelcome() {
      this.closeWelcome();
      localStorage.setItem('atsuko_onboarded', 'true');
      if (!this.isManual && this.onCompleteCallback) {
        this.onCompleteCallback();
      }
    }

    updateWizardStepUI() {
      for (let i = 1; i <= this.totalSteps; i++) {
        const slide = document.getElementById(`welcomeSlide${i}`);
        const dot = document.getElementById(`welcomeDot${i}`);
        if (slide) slide.style.display = (i === this.currentStep) ? 'block' : 'none';
        if (dot) dot.classList.toggle('active', i === this.currentStep);
      }

      const backBtn = document.getElementById('welcomeBackBtn');
      const nextBtn = document.getElementById('welcomeNextBtn');
      const skipBtn = document.getElementById('welcomeSkipBtn');

      if (backBtn) backBtn.style.visibility = (this.currentStep === 1) ? 'hidden' : 'visible';
      if (nextBtn) {
        nextBtn.textContent = (this.currentStep === this.totalSteps) ? 'Open Atsuko' : 'Next';
      }
      if (skipBtn) {
        skipBtn.style.display = (this.currentStep === this.totalSteps || this.isManual) ? 'none' : 'inline-block';
      }
    }

    /**
     * Add Audio Files during Onboarding Slide 3
     */
    async handleOnboardingAddFiles() {
      if (!window.dataFolderService || !window.dataFolderService.dirHandle) {
        alert('Please connect your Atsuko Data Folder in Step 2 first.');
        this.currentStep = 2;
        this.updateWizardStepUI();
        return;
      }

      try {
        let files = [];
        if ('showOpenFilePicker' in window) {
          const handles = await window.showOpenFilePicker({
            multiple: true,
            types: [{
              description: 'Audio Files (*.mp3, *.wav, *.flac, *.m4a, *.aac, *.ogg, *.opus)',
              accept: {
                'audio/*': ['.mp3', '.wav', '.flac', '.m4a', '.aac', '.ogg', '.opus', '.weba', '.webm', '.m4b', '.mpga'],
                'audio/mpeg': ['.mp3', '.mpga'],
                'audio/mp3': ['.mp3']
              }
            }]
          });
          if (handles && handles.length > 0) {
            files = await Promise.all(handles.map(h => h.getFile()));
          }
        } else {
          files = await new Promise(resolve => {
            const input = document.createElement('input');
            input.type = 'file';
            input.multiple = true;
            input.accept = 'audio/*';
            input.onchange = (e) => resolve(Array.from(e.target.files || []));
            input.click();
          });
        }

        const validFiles = (files || []).filter(f => window.FileManager.isAudioFile(f));
        if (validFiles.length === 0) return;

        // Prompt for folder
        const targetFolder = await this.promptAddToFolder(validFiles.length);
        if (!targetFolder) return;

        await this.importFilesIntoFolder(validFiles, targetFolder);
      } catch (err) {
        if (err.name !== 'AbortError') {
          console.warn('Error adding files in onboarding:', err);
        }
      }
    }

    /**
     * Add Music Folder during Onboarding Slide 3
     */
    async handleOnboardingAddFolder() {
      if (!window.dataFolderService || !window.dataFolderService.dirHandle) {
        alert('Please connect your Atsuko Data Folder in Step 2 first.');
        this.currentStep = 2;
        this.updateWizardStepUI();
        return;
      }

      try {
        if (!('showDirectoryPicker' in window)) {
          alert('Folder selection is supported on desktop Chrome and Edge browsers.');
          return;
        }

        const dirHandle = await window.showDirectoryPicker();
        if (!dirHandle) return;

        const fileList = [];
        if (window.fileManager && window.fileManager.scanDirectoryHandle) {
          await window.fileManager.scanDirectoryHandle(dirHandle, fileList);
        }

        const validFiles = fileList.filter(f => window.FileManager.isAudioFile(f));
        if (validFiles.length === 0) {
          alert('No supported audio files found in the chosen folder.');
          return;
        }

        // Prompt for folder
        const targetFolder = await this.promptAddToFolder(validFiles.length);
        if (!targetFolder) return;

        await this.importFilesIntoFolder(validFiles, targetFolder);
      } catch (err) {
        if (err.name !== 'AbortError') {
          console.warn('Error adding music folder in onboarding:', err);
        }
      }
    }

    /**
     * Process, fingerprint, and persist songs into chosen Atsuko Folder
     */
    async importFilesIntoFolder(validFiles, targetFolder) {
      if (!window.fileManager) return;

      const existingKeys = new Set((window.allTracks || []).map(t => `${t.fileBlob?.name || t.title}_${t.fileBlob?.size || 0}`));
      const nonDuplicates = validFiles.filter(f => !existingKeys.has(`${f.name}_${f.size}`));
      const dupCount = validFiles.length - nonDuplicates.length;

      if (nonDuplicates.length === 0) {
        alert('Selected songs were already in your library (duplicates skipped).');
        return;
      }

      const newTracks = await window.fileManager.processAudioFiles(nonDuplicates);

      for (const track of newTracks) {
        track.folderId = targetFolder.folderId;
        if (track.fileBlob && window.SongFingerprint) {
          track.fingerprint = await window.SongFingerprint.compute(track.fileBlob, track.duration, track.fileBlob.name);
        }
      }

      if (window.folderService) {
        window.folderService.assignSongsToFolder(targetFolder.folderId, newTracks.map(t => t.id), window.allTracks || []);
      }

      if (Array.isArray(window.allTracks)) {
        window.allTracks.push(...newTracks);
        window.FileManager.sortTracks(window.allTracks);
      }

      if (window.syncToAtu) {
        window.syncToAtu(true);
      }

      const songStatusEl = document.getElementById('welcomeAddMusicStatus');
      if (songStatusEl) {
        songStatusEl.textContent = `✓ Added ${newTracks.length} song${newTracks.length > 1 ? 's' : ''} to "${targetFolder.folderName}"!`;
        songStatusEl.style.color = '#34C759';
      }

      // Smoothly advance to Slide 4
      setTimeout(() => {
        this.nextStep();
      }, 700);
    }

    /**
     * Trigger system directory picker for Data Folder
     */
    async pickDataFolder() {
      if (!this.checkBrowserSupport()) return null;

      try {
        const handle = await window.showDirectoryPicker({
          id: 'atsuko-data-folder',
          mode: 'readwrite'
        });

        if (!handle) return null;

        // Inspect directory according to Section 5.2
        const inspection = await window.dataFolderService.inspectDirectory(handle);

        if (inspection.status === 'multiple_main_atu') {
          alert('Conflict detected: Multiple "main.atu" files were found in this folder. Please ensure there is only one main.atu file in this directory and try again.');
          return null;
        }

        if (inspection.status === 'has_main_atu' || inspection.status === 'has_atu') {
          const chosenFile = inspection.activeFileName || inspection.atuFiles[0];
          await window.dataFolderService.connectDirectory(handle, chosenFile);
          const readResult = await window.dataFolderService.readAtuFile(chosenFile);

          if (readResult.corrupted) {
            this.showCorruptDialog(handle, readResult.usedBackup);
            return null;
          }

          this.showRestorePrompt(readResult.data, handle);
          return { type: 'restore', data: readResult.data, handle };
        }

        if (inspection.status === 'multiple_atu') {
          // Merge all data into main.atu, notify user with toast, and operate on main.atu exclusively
          const mergeResult = await window.dataFolderService.mergeMultipleAtuFiles(handle, inspection.atuFiles);
          if (mergeResult.success) {
            await window.dataFolderService.connectDirectory(handle, 'main.atu');
            if (window.showToast) {
              window.showToast(`Merged ${inspection.atuFiles.length} .atu files into main.atu`);
            }
            this.showRestorePrompt(mergeResult.mergedData, handle);
            return { type: 'restore', data: mergeResult.mergedData, handle };
          } else {
            this.showMultipleAtuDialog(handle, inspection.atuFiles);
            return null;
          }
        }

        if (inspection.status === 'not_empty_no_atu') {
          // Warning dialog
          const confirmed = await this.showNotEmptyWarningDialog(inspection.otherFileCount);
          if (!confirmed) return null;
        }

        // Empty or recordings_only or confirmed not_empty: create fresh .atu
        await window.dataFolderService.connectDirectory(handle);

        const currentUsername = (typeof localStorage !== 'undefined' && (localStorage.getItem('musico_profile_username') || localStorage.getItem('musico_profile_name'))) || 'USER';
        const currentAvatar = (typeof localStorage !== 'undefined' && (localStorage.getItem('musico_profile_image') || localStorage.getItem('musico_profile_avatar'))) || 'assets/default-avatar.svg';

        const defaultData = window.AtuSchema.createDefaultData({
          username: currentUsername,
          avatar: currentAvatar
        });

        // 1. Preserve current playback stats
        if (window.fileManager && window.fileManager._cachedStats) {
          defaultData.stats = {
            totalListeningSec: Math.round(window.fileManager._cachedStats.totalListeningSeconds || 0),
            songsPlayed: window.fileManager._cachedStats.totalSongsPlayed || 0
          };
        } else if (window.fileManager) {
          try {
            const st = await window.fileManager.getPlaybackStats();
            defaultData.stats = {
              totalListeningSec: Math.round(st.totalListeningSeconds || 0),
              songsPlayed: st.totalSongsPlayed || 0
            };
          } catch (e) {}
        }

        // 2. Preserve in-app playlists
        let prePlaylists = [];
        if (window.fileManager) {
          try {
            prePlaylists = (await window.fileManager.getPlaylists()) || [];
          } catch (e) {}
        }
        if ((!prePlaylists || prePlaylists.length === 0) && Array.isArray(window.playlists)) {
          prePlaylists = window.playlists;
        }
        if (Array.isArray(prePlaylists) && prePlaylists.length > 0) {
          defaultData.playlists = prePlaylists;
          if (window.dataFolderService) {
            window.dataFolderService.originalAtuPlaylists = JSON.parse(JSON.stringify(prePlaylists));
          }
        }

        // 3. Preserve in-app folders
        if (window.folderService) {
          defaultData.folders = window.folderService.getAllFolders();
        }

        // 4. Preserve favourites
        if (typeof window.getFavouriteTrackIds === 'function') {
          defaultData.favourites = window.getFavouriteTrackIds();
        }

        // 5. Preserve songs from window.allTracks (excluding recordings)
        if (Array.isArray(window.allTracks) && window.allTracks.length > 0) {
          const songsList = [];
          window.allTracks.forEach(t => {
            if (t.isRecording || t.source === 'recorded' || (t.id && String(t.id).startsWith('disk_rec_'))) return;
            const fp = t.fingerprint || {
              name: t.title || t.name || '',
              size: t.fileBlob?.size || 0,
              durationSec: Math.round(t.duration || 0),
              lastModified: t.fileBlob?.lastModified || Date.now(),
              hash: `size_${t.fileBlob?.size || 0}_${t.title || ''}`
            };
            songsList.push({
              id: t.id,
              fingerprint: fp,
              relativePath: t.relativePath || t.fileBlob?.name || t.title,
              title: t.title,
              artist: t.artist,
              album: t.album,
              genre: t.genre || 'Unknown',
              lyrics: t.lyrics || '',
              addedAt: t.addedAt ? (typeof t.addedAt === 'number' ? new Date(t.addedAt).toISOString() : t.addedAt) : new Date().toISOString(),
              folderId: t.folderId || null,
              favourite: typeof window.isFavourite === 'function' ? window.isFavourite(t.id) : false,
              playCount: t.playCount || 0,
              lastPlayedAt: t.lastPlayedAt || null,
              source: t.source || 'imported',
              isMissing: Boolean(t.isMissing)
            });
          });
          defaultData.songs = songsList;
          if (window.dataFolderService) {
            window.dataFolderService.originalAtuSongs = JSON.parse(JSON.stringify(songsList));
          }
        }

        await window.dataFolderService.save(defaultData, true);

        return { type: 'new', data: defaultData, handle };
      } catch (err) {
        if (err.name === 'AbortError') {
          // User cancelled picker, return gracefully
          return null;
        }
        if (err.name === 'SecurityError' || (err.message && err.message.includes('sensitive'))) {
          alert('Chrome or Edge blocks selecting system directories like Desktop or Documents. Please choose a dedicated empty folder.');
          return null;
        }
        console.error('[OnboardingWizard] Error picking folder:', err);
        return null;
      }
    }

    /**
     * Warning dialog when chosen folder is not empty
     */
    showNotEmptyWarningDialog(fileCount) {
      return new Promise((resolve) => {
        const modal = document.getElementById('folderWarningModal');
        const countSpan = document.getElementById('folderWarningFileCount');
        const useBtn = document.getElementById('folderWarningUseAnywayBtn');
        const chooseOtherBtn = document.getElementById('folderWarningChooseOtherBtn');

        if (!modal) {
          resolve(confirm(`This folder already contains ${fileCount} other items. Atsuko works best with an empty folder. Use it anyway?`));
          return;
        }

        if (countSpan) countSpan.textContent = fileCount;

        const cleanup = () => {
          modal.classList.remove('open');
          modal.style.display = 'none';
        };

        useBtn.onclick = () => {
          cleanup();
          resolve(true);
        };

        chooseOtherBtn.onclick = () => {
          cleanup();
          resolve(false);
        };

        modal.style.display = 'flex';
        modal.classList.add('open');
      });
    }

    /**
     * Show restore welcome dialog for returning user
     */
    showRestorePrompt(data, handle) {
      const modal = document.getElementById('restoreWelcomeModal');
      const usernameSpan = document.getElementById('restoreUsernameSpan');
      const selectSongsBtn = document.getElementById('restoreSelectSongsBtn');
      const skipRestoreBtn = document.getElementById('restoreSkipBtn');

      let name = (data && data.profile && data.profile.username) || 'User';
      if (name === 'v22' || name === 'V22') {
        name = (typeof localStorage !== 'undefined' && (localStorage.getItem('atsuko_last_valid_username') || localStorage.getItem('atsuko_previous_username'))) ||
          (typeof localStorage !== 'undefined' && localStorage.getItem('musico_profile_username') !== 'current' ? localStorage.getItem('musico_profile_username') : 'new') ||
          'new';
        if (data && data.profile) data.profile.username = name;
      }
      if (usernameSpan) usernameSpan.textContent = name;

      if (!modal) {
        if (this.onRestoreCallback) this.onRestoreCallback(data);
        return;
      }

      const cleanup = () => {
        modal.classList.remove('open');
        modal.style.display = 'none';
      };

      if (selectSongsBtn) {
        selectSongsBtn.onclick = async () => {
          cleanup();
          if (this.onRestoreCallback) {
            this.onRestoreCallback(data, false);
          }
          if (typeof window.openAddMusicModal === 'function') {
            window.openAddMusicModal();
          }
        };
      }

      if (skipRestoreBtn) {
        skipRestoreBtn.onclick = () => {
          cleanup();
          if (this.onRestoreCallback) {
            this.onRestoreCallback(data, false);
          }
        };
      }

      modal.style.display = 'flex';
      modal.classList.add('open');
    }

    /**
     * Dialog when primary .atu is corrupt
     */
    showCorruptDialog(handle, recoveredFromBackup) {
      if (recoveredFromBackup) {
        alert('Notice: Your primary atsuko.atu file was unreadable, but Atsuko successfully restored your data from the automatic rolling backup (atsuko.atu.bak).');
        return;
      }

      const shouldStartFresh = confirm(
        'Warning: The atsuko.atu file in this folder appears corrupt or unreadable.\n\n' +
        'Would you like to start fresh? (Atsuko will rename the broken file to preserve it as atsuko.atu.corrupt-DATE)'
      );

      if (shouldStartFresh) {
        window.dataFolderService.renameCorruptedFile().then(async () => {
          const defaultData = window.AtuSchema.createDefaultData();
          await window.dataFolderService.save(defaultData, true);
          if (this.onCompleteCallback) this.onCompleteCallback();
        });
      }
    }

    /**
     * Dialog when multiple .atu files exist in folder
     */
    showMultipleAtuDialog(handle, files) {
      const chosen = prompt(`This folder contains multiple .atu files: ${files.join(', ')}.\nPlease enter the filename you wish to use:`, files[0]);
      if (chosen && files.includes(chosen)) {
        window.dataFolderService.connectDirectory(handle).then(async () => {
          const res = await window.dataFolderService.readAtuFile(chosen);
          if (res.data) {
            this.showRestorePrompt(res.data, handle);
          }
        });
      }
    }

    /**
     * Ask user: "Which folder should these songs go in?" (PRD Section 5.3 & 6.2)
     * @param {number} songCount Number of songs about to be added
     * @returns {Promise<{ folderId: string, folderName: string } | null>}
     */
    promptAddToFolder(songCount) {
      return new Promise((resolve) => {
        const modal = document.getElementById('addToFolderModal');
        const input = document.getElementById('addToFolderInput');
        const select = document.getElementById('addToFolderExistingSelect');
        const addBtn = document.getElementById('addToFolderConfirmBtn');
        const cancelBtn = document.getElementById('addToFolderCancelBtn');
        const cancelBtn2 = document.getElementById('addToFolderCancelBtn2');
        const countSpan = document.getElementById('addToFolderSongCount');

        if (!modal || !input) {
          // Fallback prompt
          const suggestion = window.folderService.getDateSuggestion();
          const name = prompt(`Adding ${songCount} songs. Enter folder name:`, suggestion);
          if (!name) {
            resolve(null);
            return;
          }
          const res = window.folderService.createFolder(name);
          const f = res.folder || window.folderService.getFolderByName(name);
          resolve(f ? { folderId: f.id, folderName: f.name } : null);
          return;
        }

        // Fill date suggestion
        const suggestion = window.folderService.getDateSuggestion();
        input.value = suggestion;
        if (countSpan) countSpan.textContent = songCount;

        // Populate existing folders
        const existingFolders = window.folderService.getAllFolders();
        if (select) {
          select.innerHTML = '<option value="">-- Or choose an existing folder --</option>' +
            existingFolders.map(f => `<option value="${f.id}">${f.name} (${(f.songIds || []).length} songs)</option>`).join('');
          select.value = '';
          select.onchange = () => {
            if (select.value) {
              const selectedFolder = window.folderService.getFolderById(select.value);
              if (selectedFolder) input.value = selectedFolder.name;
            }
          };
        }

        let isHandled = false;
        const cleanup = () => {
          modal.classList.remove('open');
          modal.style.display = 'none';
        };

        const doResolve = (val) => {
          if (isHandled) return;
          isHandled = true;
          cleanup();
          resolve(val);
        };

        addBtn.onclick = () => {
          const name = (input.value || '').trim();
          if (!name) {
            alert('Please enter a folder name.');
            return;
          }

          let folder = window.folderService.getFolderByName(name);
          if (!folder) {
            const createRes = window.folderService.createFolder(name);
            if (!createRes.success) {
              alert(createRes.error);
              return;
            }
            folder = createRes.folder;
          }

          doResolve({ folderId: folder.id, folderName: folder.name });
        };

        if (cancelBtn) cancelBtn.onclick = () => doResolve(null);
        if (cancelBtn2) cancelBtn2.onclick = () => doResolve(null);

        modal.onclick = (e) => {
          if (e.target === modal) doResolve(null);
        };

        modal.style.display = 'flex';
        modal.classList.add('open');
        input.focus();
        input.select();
      });
    }
  }

  window.OnboardingWizard = OnboardingWizard;
  window.onboardingWizard = new OnboardingWizard();
})(window);
