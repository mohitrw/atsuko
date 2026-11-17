/**
 * Atsuko - Song Fingerprinting & Fast SHA-256 Matching
 * Meets Section 8.4 of Atsuko PRD (256KB sha256 + size, name+size+duration, relativePath).
 */

(function (window) {
  'use strict';

  const HASH_CHUNK_SIZE = 256 * 1024; // 256 KB

  const SongFingerprint = {
    /**
     * Compute fast fingerprint for an audio file (reads only first 256KB)
     * @param {File|Blob} file 
     * @param {number} durationSec 
     * @param {string} relativePath 
     * @returns {Promise<Object>}
     */
    async compute(file, durationSec = 0, relativePath = '') {
      if (!file) return null;

      const size = file.size || 0;
      const name = file.name || '';
      const lastModified = file.lastModified || Date.now();
      let hash = '';

      try {
        const slice = file.slice(0, Math.min(size, HASH_CHUNK_SIZE));
        const buffer = await slice.arrayBuffer();
        if (window.crypto && window.crypto.subtle) {
          const hashBuffer = await window.crypto.subtle.digest('SHA-256', buffer);
          const hashArray = Array.from(new Uint8Array(hashBuffer));
          const hex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
          hash = `${hex}_${size}`;
        } else {
          // Fallback if subtle crypto is unavailable
          hash = `size_${size}_modified_${lastModified}`;
        }
      } catch (err) {
        console.warn('[SongFingerprint] Failed to compute hash, falling back:', err);
        hash = `size_${size}_name_${name}`;
      }

      return {
        name: name,
        size: size,
        durationSec: Math.round(durationSec || 0),
        lastModified: lastModified,
        hash: hash,
        relativePath: relativePath || name
      };
    },

    /**
     * Check if a candidate file matches a stored song according to PRD 8.4 rules
     * Priority:
     * 1. Exact fingerprint hash
     * 2. Name + Size + Duration (within 1 second)
     * 3. Relative Path + Name
     * @returns {number} 0 if no match, 1 for exact hash, 2 for name+size+dur, 3 for relativePath+name
     */
    getMatchScore(candidate, storedSong) {
      if (!candidate || !storedSong) return 0;

      const storedFp = storedSong.fingerprint || {};
      const candHash = candidate.hash || candidate.fingerprint?.hash;
      const storedHash = storedFp.hash;

      // Rule 1: Exact fingerprint hash
      if (candHash && storedHash && candHash === storedHash) {
        return 1;
      }

      // Rule 2: Name + Size + Duration within 1s
      const candName = (candidate.name || candidate.fingerprint?.name || '').trim().toLowerCase();
      const storedName = (storedFp.name || storedSong.title || '').trim().toLowerCase();
      const candSize = candidate.size || candidate.fingerprint?.size || 0;
      const storedSize = storedFp.size || 0;
      const candDur = candidate.durationSec || candidate.fingerprint?.durationSec || 0;
      const storedDur = storedFp.durationSec || 0;

      if (candName && storedName && candName === storedName && candSize === storedSize) {
        if (storedDur === 0 || candDur === 0 || Math.abs(candDur - storedDur) <= 1) {
          return 2;
        }
      }

      // Rule 3: Relative path + name
      const candRel = (candidate.relativePath || '').trim().toLowerCase();
      const storedRel = (storedSong.relativePath || '').trim().toLowerCase();
      if (candRel && storedRel && candRel === storedRel) {
        return 3;
      }

      return 0;
    },

    /**
     * Match a list of candidate files against stored songs in .atu
     * Ensures 1-to-1 matching (no single file matched twice, no single song matched twice)
     * @param {Array<Object>} candidates Array of { file, fingerprint, relativePath }
     * @param {Array<Object>} storedSongs Array of stored songs from .atu
     * @returns {{ matched: Array<{ candidate: Object, song: Object, score: number }>, unmatchedCandidates: Array<Object>, missingSongIds: Array<string> }}
     */
    matchBatch(candidates, storedSongs) {
      const matched = [];
      const usedSongIds = new Set();
      const matchedCandidateIndices = new Set();

      // Pass 1: Match score 1 (Exact hash)
      for (let i = 0; i < candidates.length; i++) {
        const cand = candidates[i];
        for (let j = 0; j < storedSongs.length; j++) {
          const song = storedSongs[j];
          if (usedSongIds.has(song.id)) continue;

          const score = this.getMatchScore(cand, song);
          if (score === 1) {
            matched.push({ candidate: cand, song: song, score: 1 });
            usedSongIds.add(song.id);
            matchedCandidateIndices.add(i);
            break;
          }
        }
      }

      // Pass 2: Match score 2 (Name + Size + Duration)
      for (let i = 0; i < candidates.length; i++) {
        if (matchedCandidateIndices.has(i)) continue;
        const cand = candidates[i];
        for (let j = 0; j < storedSongs.length; j++) {
          const song = storedSongs[j];
          if (usedSongIds.has(song.id)) continue;

          const score = this.getMatchScore(cand, song);
          if (score === 2) {
            matched.push({ candidate: cand, song: song, score: 2 });
            usedSongIds.add(song.id);
            matchedCandidateIndices.add(i);
            break;
          }
        }
      }

      // Pass 3: Match score 3 (Relative path + name)
      for (let i = 0; i < candidates.length; i++) {
        if (matchedCandidateIndices.has(i)) continue;
        const cand = candidates[i];
        for (let j = 0; j < storedSongs.length; j++) {
          const song = storedSongs[j];
          if (usedSongIds.has(song.id)) continue;

          const score = this.getMatchScore(cand, song);
          if (score === 3) {
            matched.push({ candidate: cand, song: song, score: 3 });
            usedSongIds.add(song.id);
            matchedCandidateIndices.add(i);
            break;
          }
        }
      }

      const unmatchedCandidates = candidates.filter((_, idx) => !matchedCandidateIndices.has(idx));
      const missingSongIds = storedSongs.filter(s => !usedSongIds.has(s.id)).map(s => s.id);

      return {
        matched,
        unmatchedCandidates,
        missingSongIds
      };
    }
  };

  window.SongFingerprint = SongFingerprint;
})(window);

