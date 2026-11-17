/**
 * Atsuko - High-Fidelity Voice Recorder & Client-Side MP3 Encoder
 * Encodes microphone PCM directly to genuine .mp3 using lamejs.
 * Saves to Data Folder (or Recordings subfolder) and registers with Atsuko library.
 */

(function (window) {
  'use strict';

  class RecorderService {
    constructor() {
      this.audioContext = null;
      this.mediaStream = null;
      this.processorNode = null;
      this.sourceNode = null;
      this.pcmChunks = [];
      this.totalSamples = 0;
      this.state = 'idle'; // 'idle' | 'recording' | 'paused'
      this.startTime = 0;
      this.pausedTime = 0;
      this.totalElapsedMs = 0;
      this.timerInterval = null;

      this.listeners = {
        onStateChange: [],
        onTick: []
      };
    }

    /**
     * Check if microphone recording is supported
     */
    static isSupported() {
      return Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.AudioContext);
    }

    /**
     * Start recording from the microphone
     */
    async start() {
      if (this.state === 'recording') return;

      // Ensure data folder is connected before recording
      if (window.dataFolderService && !window.dataFolderService.dirHandle) {
        throw new Error('Please connect your Atsuko Data Folder before recording.');
      }

      try {
        this.mediaStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          }
        });
      } catch (err) {
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          throw new Error('Microphone permission was denied. Please allow microphone access in your browser settings.');
        }
        throw new Error('Could not access microphone: ' + err.message);
      }

      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }
      this.sampleRate = this.audioContext.sampleRate || 44100;

      this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);

      // 4096 buffer size provides smooth audio stream processing
      const bufferSize = 4096;
      this.processorNode = this.audioContext.createScriptProcessor(bufferSize, 1, 1);
      this.pcmChunks = [];
      this.totalSamples = 0;

      this.processorNode.onaudioprocess = (e) => {
        if (this.state !== 'recording') return;
        const inputData = e.inputBuffer.getChannelData(0);
        // Copy chunk
        const chunk = new Float32Array(inputData);
        this.pcmChunks.push(chunk);
        this.totalSamples += chunk.length;
      };

      this.sourceNode.connect(this.processorNode);
      // Mute destination to prevent speaker feedback while keeping processor active
      const muteGain = this.audioContext.createGain();
      muteGain.gain.value = 0;
      this.processorNode.connect(muteGain);
      muteGain.connect(this.audioContext.destination);

      this.state = 'recording';
      this.startTime = Date.now();
      this.totalElapsedMs = 0;
      this.startTimer();
      this.emitState();
    }

    /**
     * Pause active recording
     */
    pause() {
      if (this.state !== 'recording') return;
      this.state = 'paused';
      this.pausedTime = Date.now();
      this.stopTimer();
      this.emitState();
    }

    /**
     * Resume paused recording
     */
    resume() {
      if (this.state !== 'paused') return;
      this.startTime += (Date.now() - this.pausedTime);
      this.state = 'recording';
      this.startTimer();
      this.emitState();
    }

    /**
     * Discard active recording without saving
     */
    discard() {
      this.cleanup();
      this.state = 'idle';
      this.totalElapsedMs = 0;
      this.stopTimer();
      this.emitState();
    }

    /**
     * Stop recording and encode to MP3
     * @returns {Promise<{ mp3Blob: Blob, durationSec: number }>}
     */
    async stop() {
      if (this.state === 'idle') return null;

      const durationSec = Math.max(1, Math.round(this.totalElapsedMs / 1000));
      const chunks = this.pcmChunks;
      const totalSamples = this.totalSamples;
      const sampleRate = this.sampleRate || (this.audioContext ? this.audioContext.sampleRate : 44100);

      this.stopTimer();
      this.cleanup();
      this.state = 'idle';
      this.emitState();

      if (chunks.length === 0 || totalSamples === 0) {
        throw new Error('No audio was recorded.');
      }

      // Encode PCM to real MP3 using sampleRate captured during active recording
      const mp3Blob = await this.encodeMp3(chunks, totalSamples, sampleRate);

      return {
        mp3Blob,
        durationSec
      };
    }

    /**
     * Encode collected Float32 PCM chunks to real MP3 using lamejs
     */
    async encodeMp3(chunks, totalSamples, sampleRate) {
      if (typeof window.lamejs === 'undefined' || typeof window.lamejs.Mp3Encoder !== 'function') {
        throw new Error('MP3 Encoder (lamejs) is not loaded.');
      }

      // Flatten Float32 chunks into Int16 PCM array
      const pcm16 = new Int16Array(totalSamples);
      let offset = 0;
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        for (let j = 0; j < chunk.length; j++) {
          const s = Math.max(-1, Math.min(1, chunk[j]));
          pcm16[offset++] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
      }

      // Initialize lamejs MP3 encoder (1 channel mono, sampleRate, 128 kbps)
      const mp3Encoder = new window.lamejs.Mp3Encoder(1, sampleRate, 128);
      const mp3Data = [];
      const sampleBlockSize = 1152;

      for (let i = 0; i < pcm16.length; i += sampleBlockSize) {
        const sampleChunk = pcm16.subarray(i, i + sampleBlockSize);
        const mp3buf = mp3Encoder.encodeBuffer(sampleChunk);
        if (mp3buf && mp3buf.length > 0) {
          mp3Data.push(new Uint8Array(mp3buf.buffer, mp3buf.byteOffset, mp3buf.length));
        }
      }

      const endBuf = mp3Encoder.flush();
      if (endBuf && endBuf.length > 0) {
        mp3Data.push(new Uint8Array(endBuf.buffer, endBuf.byteOffset, endBuf.length));
      }

      return new Blob(mp3Data, { type: 'audio/mpeg' });
    }

    /**
     * Generate default recording name (e.g. "Recording 2026-11-15 10-14")
     */
    getDefaultRecordingName() {
      const now = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      const yyyy = now.getFullYear();
      const mm = pad(now.getMonth() + 1);
      const dd = pad(now.getDate());
      const hh = pad(now.getHours());
      const min = pad(now.getMinutes());
      return `Recording ${yyyy}-${mm}-${dd} ${hh}-${min}`;
    }

    /**
     * Save encoded MP3 to Data Folder (always inside Recordings subfolder)
     * Meets Section 7 of PRD
     * @param {Blob} mp3Blob 
     * @param {string} customName 
     * @param {number} durationSec 
     */
    async saveRecording(mp3Blob, customName, durationSec = 0) {
      if (!window.dataFolderService || !window.dataFolderService.dirHandle) {
        throw new Error('Data Folder is not connected.');
      }

      const dirService = window.dataFolderService;
      // Guarantee Recordings subfolder exists inside the user's chosen folder
      const targetDir = await dirService.getRecordingsFolder(true);
      if (!targetDir) {
        throw new Error('Could not access or create Recordings folder in your Atsuko Data Folder.');
      }
      const targetPath = 'Recordings/';

      let baseName = (customName || this.getDefaultRecordingName()).trim().replace(/[\\/:*?"<>|]/g, '-');
      if (baseName.toLowerCase().endsWith('.mp3')) {
        baseName = baseName.substring(0, baseName.length - 4);
      }

      let fileName = `${baseName}.mp3`;
      let counter = 2;

      // Find an unused filename (name (2).mp3, etc.)
      while (true) {
        try {
          await targetDir.getFileHandle(fileName, { create: false });
          // If no error, file exists, try next number
          fileName = `${baseName} (${counter++}).mp3`;
        } catch (e) {
          // File does not exist, safe to write
          break;
        }
      }

      const fileHandle = await targetDir.getFileHandle(fileName, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(mp3Blob);
      await writable.close();

      const savedFile = await fileHandle.getFile();

      // Ensure "Recordings" Atsuko Folder exists in FolderService
      let recFolder = window.folderService.getFolderByName('Recordings');
      if (!recFolder) {
        const res = window.folderService.createFolder('Recordings');
        recFolder = res.folder;
      }

      const songId = 'disk_rec_' + fileName.replace(/[^a-zA-Z0-9_-]/g, '_');
      const nowIso = new Date().toISOString();

      // Compute fingerprint
      const fingerprint = await window.SongFingerprint.compute(savedFile, durationSec, targetPath + fileName);

      // Create Atsuko Song object
      const songRecord = {
        id: songId,
        fingerprint: fingerprint,
        relativePath: targetPath + fileName,
        title: baseName,
        artist: 'Voice Recording',
        album: 'Atsuko Recordings',
        genre: 'Recording',
        addedAt: nowIso,
        folderId: recFolder ? recFolder.id : null,
        favourite: false,
        playCount: 0,
        lastPlayedAt: null,
        source: 'recorded',
        duration: durationSec,
        formattedDuration: this.formatTime(durationSec * 1000),
        coverUrl: 'assets/atsuko.svg',
        fileBlob: savedFile,
        fileHandle: fileHandle,
        isLocal: true
      };

      // Add to FolderService
      if (recFolder) {
        window.folderService.assignSongsToFolder(recFolder.id, [songId]);
      }

      // Add to dataFolderService .atu data
      if (dirService.cachedData) {
        if (!Array.isArray(dirService.cachedData.songs)) dirService.cachedData.songs = [];
        if (!Array.isArray(dirService.cachedData.recordings)) dirService.cachedData.recordings = [];
        dirService.cachedData.songs.push(songRecord);
        dirService.cachedData.recordings.push({
          songId: songId,
          fileName: fileName,
          createdAt: nowIso
        });
        await dirService.save(dirService.cachedData, true);
      }

      return {
        song: songRecord,
        fileName: fileName,
        folder: recFolder
      };
    }

    startTimer() {
      this.stopTimer();
      this.timerInterval = setInterval(() => {
        this.totalElapsedMs = Date.now() - this.startTime;
        this.emitTick(this.totalElapsedMs);
      }, 100);
    }

    stopTimer() {
      if (this.timerInterval) {
        clearInterval(this.timerInterval);
        this.timerInterval = null;
      }
    }

    formatTime(ms) {
      const totalSec = Math.floor(ms / 1000);
      const mins = Math.floor(totalSec / 60);
      const secs = totalSec % 60;
      return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }

    cleanup() {
      if (this.mediaStream) {
        this.mediaStream.getTracks().forEach(track => track.stop());
        this.mediaStream = null;
      }
      if (this.sourceNode) {
        try { this.sourceNode.disconnect(); } catch (e) {}
        this.sourceNode = null;
      }
      if (this.processorNode) {
        try { this.processorNode.disconnect(); } catch (e) {}
        this.processorNode = null;
      }
      if (this.audioContext && this.audioContext.state !== 'closed') {
        try { this.audioContext.close(); } catch (e) {}
        this.audioContext = null;
      }
    }

    emitState() {
      this.listeners.onStateChange.forEach(cb => cb(this.state));
    }

    emitTick(ms) {
      const timeStr = this.formatTime(ms);
      this.listeners.onTick.forEach(cb => cb(timeStr, ms));
    }

    onStateChange(cb) {
      this.listeners.onStateChange.push(cb);
    }

    onTick(cb) {
      this.listeners.onTick.push(cb);
    }
  }

  window.RecorderService = RecorderService;
  window.recorderService = new RecorderService();
})(window);

