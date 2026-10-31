/**
 * Musico - ID3 & Audio Metadata Parser (High-Speed & Low-Memory Optimized)
 * Optimized slicing, fast header inspection, and smart image compression.
 */

const ID3Parser = {
  /**
   * Fast cover compression only for very large raw images (>150KB)
   */
  async compressImageBlob(rawBlob, maxDim = 320) {
    if (!rawBlob || rawBlob.size < 150000) return rawBlob; // Already lightweight, skip canvas overhead
    try {
      if ('createImageBitmap' in window) {
        const bitmap = await createImageBitmap(rawBlob);
        const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
        if (scale >= 1) {
          bitmap.close();
          return rawBlob;
        }
        const w = Math.round(bitmap.width * scale);
        const h = Math.round(bitmap.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(bitmap, 0, 0, w, h);
          bitmap.close();
          return new Promise((resolve) => {
            canvas.toBlob((resizedBlob) => {
              resolve(resizedBlob || rawBlob);
            }, 'image/jpeg', 0.80);
          });
        }
        bitmap.close();
      }
    } catch (e) {
      // Silently return rawBlob if compression fails
    }
    return rawBlob;
  },

  /**
   * Parse metadata with minimal I/O slicing
   * @param {File|Blob} file 
   * @returns {Promise<Object>} Metadata object
   */
  async parse(file) {
    const fallback = this.getFallbackMetadata(file.name || 'Unknown Track');
    try {
      const lowerName = (file.name || '').toLowerCase();

      // 1. Fast ID3v2 inspection (Scan first 2KB for ID3 header)
      const checkLen = Math.min(file.size, 2048);
      if (checkLen >= 10) {
        const headerBuf = await file.slice(0, checkLen).arrayBuffer();
        const bytes = new Uint8Array(headerBuf);
        let id3Offset = -1;
        for (let i = 0; i <= bytes.length - 10; i++) {
          if (bytes[i] === 0x49 && bytes[i + 1] === 0x44 && bytes[i + 2] === 0x33) { // 'ID3'
            id3Offset = i;
            break;
          }
        }

        if (id3Offset !== -1) {
          const view10 = new DataView(headerBuf, id3Offset);
          const tagSize = this.readSynchsafeInt(view10, 6);
          const fullTagSize = Math.min(file.size, id3Offset + 10 + tagSize);
          // Slice only the exact ID3 tag buffer
          const id3Buffer = await file.slice(id3Offset, fullTagSize).arrayBuffer();
          const id3v2 = this.parseID3v2(id3Buffer);

          if (id3v2 && (id3v2.title || id3v2.artist || id3v2.coverBlob || id3v2.lyrics)) {
            let coverBlob = id3v2.coverBlob;
            let coverUrl = null;
            if (coverBlob) {
              coverBlob = await this.compressImageBlob(coverBlob, 320);
              coverUrl = URL.createObjectURL(coverBlob);
            }

            return {
              title: id3v2.title || fallback.title,
              artist: id3v2.artist || fallback.artist,
              album: id3v2.album || fallback.album,
              year: id3v2.year || '',
              lyrics: id3v2.lyrics || '',
              coverUrl: coverUrl,
              coverBlob: coverBlob,
              duration: 0
            };
          }
        }
      }

      // 2. FLAC / OGG tags
      if (lowerName.endsWith('.flac') || lowerName.endsWith('.ogg') || lowerName.endsWith('.oga') || lowerName.endsWith('.opus')) {
        const flacBuffer = await file.slice(0, Math.min(file.size, 524288)).arrayBuffer();
        const flacMeta = this.parseFLAC(flacBuffer);
        if (flacMeta) {
          let coverBlob = flacMeta.coverBlob;
          let coverUrl = null;
          if (coverBlob) {
            coverBlob = await this.compressImageBlob(coverBlob, 320);
            coverUrl = URL.createObjectURL(coverBlob);
          }
          return {
            title: flacMeta.title || fallback.title,
            artist: flacMeta.artist || fallback.artist,
            album: flacMeta.album || fallback.album,
            year: flacMeta.year || '',
            lyrics: flacMeta.lyrics || '',
            coverUrl: coverUrl,
            coverBlob: coverBlob,
            duration: 0
          };
        }
      }

      // 3. M4A / MP4 / AAC tags
      if (lowerName.endsWith('.m4a') || lowerName.endsWith('.aac') || lowerName.endsWith('.mp4') || lowerName.endsWith('.m4b')) {
        const m4aBuffer = await file.slice(0, Math.min(file.size, 524288)).arrayBuffer();
        const m4aMeta = this.parseM4A(m4aBuffer);
        if (m4aMeta) {
          let coverBlob = m4aMeta.coverBlob;
          let coverUrl = null;
          if (coverBlob) {
            coverBlob = await this.compressImageBlob(coverBlob, 320);
            coverUrl = URL.createObjectURL(coverBlob);
          }
          return {
            title: m4aMeta.title || fallback.title,
            artist: m4aMeta.artist || fallback.artist,
            album: m4aMeta.album || fallback.album,
            year: m4aMeta.year || '',
            lyrics: m4aMeta.lyrics || '',
            coverUrl: coverUrl,
            coverBlob: coverBlob,
            duration: 0
          };
        }
      }

      // 4. ID3v1 (last 128 bytes)
      if (file.size > 128) {
        const footerBuffer = await file.slice(file.size - 128).arrayBuffer();
        const id3v1 = this.parseID3v1(footerBuffer);
        if (id3v1 && (id3v1.title || id3v1.artist)) {
          return {
            title: id3v1.title || fallback.title,
            artist: id3v1.artist || fallback.artist,
            album: id3v1.album || fallback.album,
            year: id3v1.year || '',
            lyrics: '',
            coverUrl: null,
            coverBlob: null,
            duration: 0
          };
        }
      }

      return fallback;
    } catch (err) {
      return fallback;
    }
  },

  /**
   * Parse ID3v2 headers and frames (v2.2, v2.3, v2.4)
   */
  parseID3v2(buffer) {
    const view = new DataView(buffer);
    if (buffer.byteLength < 10) return null;

    const id3 = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2));
    if (id3 !== 'ID3') return null;

    const majorVersion = view.getUint8(3);
    const tagSize = this.readSynchsafeInt(view, 6);
    let offset = 10;
    const maxOffset = Math.min(buffer.byteLength, 10 + tagSize);

    const result = {
      title: '',
      artist: '',
      album: '',
      year: '',
      lyrics: '',
      coverBlob: null
    };

    // ID3v2.2
    if (majorVersion === 2) {
      while (offset < maxOffset - 6) {
        let frameId = '';
        for (let i = 0; i < 3; i++) {
          const charCode = view.getUint8(offset + i);
          if (charCode >= 32 && charCode <= 126) frameId += String.fromCharCode(charCode);
        }
        if (frameId.length < 3) break;

        const frameSize = (view.getUint8(offset + 3) << 16) | (view.getUint8(offset + 4) << 8) | view.getUint8(offset + 5);
        if (frameSize <= 0 || offset + 6 + frameSize > maxOffset) break;

        const frameBuffer = buffer.slice(offset + 6, offset + 6 + frameSize);
        if (frameId === 'TT2') result.title = this.decodeTextFrame(frameBuffer);
        else if (frameId === 'TP1') result.artist = this.decodeTextFrame(frameBuffer);
        else if (frameId === 'TAL') result.album = this.decodeTextFrame(frameBuffer);
        else if (frameId === 'TYE') result.year = this.decodeTextFrame(frameBuffer);
        else if (frameId === 'ULT' && !result.lyrics) result.lyrics = this.decodeLyricsFrame(frameBuffer);
        else if (frameId === 'SLT' && !result.lyrics) result.lyrics = this.decodeSYLTFrame(frameBuffer);
        else if (frameId === 'PIC' && !result.coverBlob) {
          const apic = this.decodeAPICFrame(frameBuffer);
          if (apic && apic.coverBlob) result.coverBlob = apic.coverBlob;
        }

        offset += 6 + frameSize;
      }
      return result;
    }

    // ID3v2.3 & ID3v2.4
    while (offset < maxOffset - 10) {
      let frameId = '';
      for (let i = 0; i < 4; i++) {
        const charCode = view.getUint8(offset + i);
        if (charCode >= 32 && charCode <= 126) {
          frameId += String.fromCharCode(charCode);
        }
      }

      if (frameId.length < 4) break;

      let frameSize = 0;
      if (majorVersion === 4) {
        frameSize = this.readSynchsafeInt(view, offset + 4);
      } else {
        frameSize = view.getUint32(offset + 4);
      }

      if (frameSize <= 0 || offset + 10 + frameSize > maxOffset) break;

      const frameDataOffset = offset + 10;
      const frameBuffer = buffer.slice(frameDataOffset, frameDataOffset + frameSize);

      if (frameId === 'TIT2') {
        result.title = this.decodeTextFrame(frameBuffer);
      } else if (frameId === 'TPE1' || frameId === 'TPE2') {
        if (!result.artist) result.artist = this.decodeTextFrame(frameBuffer);
      } else if (frameId === 'TALB') {
        result.album = this.decodeTextFrame(frameBuffer);
      } else if (frameId === 'TYER' || frameId === 'TDRC') {
        result.year = this.decodeTextFrame(frameBuffer);
      } else if (frameId === 'USLT' && !result.lyrics) {
        result.lyrics = this.decodeLyricsFrame(frameBuffer);
      } else if (frameId === 'SYLT' && !result.lyrics) {
        result.lyrics = this.decodeSYLTFrame(frameBuffer);
      } else if (frameId === 'TXXX' && !result.lyrics) {
        const txxx = this.decodeTXXXFrame(frameBuffer);
        if (txxx && txxx.description) {
          const desc = txxx.description.toUpperCase().trim();
          if (desc === 'LYRICS' || desc === 'UNSYNCEDLYRICS' || desc === 'UNSYNCED LYRICS' || desc === 'LYRIC' || desc === 'TEXT') {
            result.lyrics = txxx.value;
          }
        }
      } else if (frameId === 'APIC' && !result.coverBlob) {
        const apic = this.decodeAPICFrame(frameBuffer);
        if (apic && apic.coverBlob) {
          result.coverBlob = apic.coverBlob;
        }
      }

      offset += 10 + frameSize;
    }

    return result;
  },

  /**
   * Universal text decoder helper
   */
  decodeEncodedText(bytes, encoding) {
    if (!bytes || bytes.length === 0) return '';
    try {
      if (encoding === 0) {
        return new TextDecoder('windows-1252').decode(bytes).replace(/\0/g, '').trim();
      } else if (encoding === 1) {
        return new TextDecoder('utf-16').decode(bytes).replace(/\0/g, '').trim();
      } else if (encoding === 2) {
        return new TextDecoder('utf-16be').decode(bytes).replace(/\0/g, '').trim();
      } else if (encoding === 3) {
        return new TextDecoder('utf-8').decode(bytes).replace(/\0/g, '').trim();
      }
      return new TextDecoder('utf-8').decode(bytes).replace(/\0/g, '').trim();
    } catch (e) {
      try {
        return new TextDecoder('iso-8859-1').decode(bytes).replace(/\0/g, '').trim();
      } catch (err) {
        let str = '';
        for (let i = 0; i < bytes.length; i++) {
          if (bytes[i] >= 32 || bytes[i] === 10 || bytes[i] === 13 || bytes[i] === 9) {
            str += String.fromCharCode(bytes[i]);
          }
        }
        return str.trim();
      }
    }
  },

  /**
   * Decode USLT / ULT unsynchronized lyrics frame
   */
  decodeLyricsFrame(buffer) {
    try {
      const bytes = new Uint8Array(buffer);
      if (bytes.length < 5) return '';
      const encoding = bytes[0];
      // Skip 3-byte language code (bytes[1..3])
      let offset = 4;

      // Skip content descriptor null-terminated string
      if (encoding === 0 || encoding === 3) {
        while (offset < bytes.length && bytes[offset] !== 0) offset++;
        if (offset < bytes.length) offset++;
      } else {
        let found = false;
        for (let i = offset; i < bytes.length - 1; i++) {
          if (bytes[i] === 0 && bytes[i + 1] === 0) {
            offset = i + 2;
            found = true;
            break;
          }
        }
        if (!found) {
          offset = 4;
        }
      }

      if (offset >= bytes.length) {
        offset = 4;
      }

      const textBytes = bytes.slice(offset);
      return this.decodeEncodedText(textBytes, encoding);
    } catch (e) {
      return '';
    }
  },

  /**
   * Decode SYLT synchronized lyrics frame
   */
  decodeSYLTFrame(buffer) {
    try {
      const bytes = new Uint8Array(buffer);
      if (bytes.length < 6) return '';
      const encoding = bytes[0];
      const timeFormat = bytes[4]; // 1 = MPEG frames, 2 = milliseconds
      let offset = 6;

      if (encoding === 0 || encoding === 3) {
        while (offset < bytes.length && bytes[offset] !== 0) offset++;
        if (offset < bytes.length) offset++;
      } else {
        while (offset < bytes.length - 1 && !(bytes[offset] === 0 && bytes[offset + 1] === 0)) {
          offset += 2;
        }
        if (offset < bytes.length - 1) offset += 2;
      }

      const lines = [];
      while (offset < bytes.length) {
        let textEnd = offset;
        let tsOffset = 0;
        let text = '';

        if (encoding === 0 || encoding === 3) {
          while (textEnd < bytes.length && bytes[textEnd] !== 0) textEnd++;
          text = this.decodeEncodedText(bytes.slice(offset, textEnd), encoding);
          tsOffset = textEnd + 1;
          offset = tsOffset + 4;
        } else {
          while (textEnd < bytes.length - 1 && !(bytes[textEnd] === 0 && bytes[textEnd + 1] === 0)) {
            textEnd += 2;
          }
          text = this.decodeEncodedText(bytes.slice(offset, textEnd), encoding);
          tsOffset = textEnd + 2;
          offset = tsOffset + 4;
        }

        if (tsOffset + 4 <= bytes.length) {
          const ms = ((bytes[tsOffset] << 24) | (bytes[tsOffset + 1] << 16) | (bytes[tsOffset + 2] << 8) | bytes[tsOffset + 3]) >>> 0;
          const totalSecs = timeFormat === 1 ? ms / 38.28 : ms / 1000;
          const mins = Math.floor(totalSecs / 60);
          const secs = Math.floor(totalSecs % 60);
          const centis = Math.floor((totalSecs % 1) * 100);
          const timeTag = `[${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(centis).padStart(2, '0')}]`;
          if (text && text.trim()) {
            lines.push(`${timeTag} ${text.trim()}`);
          }
        } else if (text && text.trim()) {
          lines.push(text.trim());
        }
      }
      return lines.join('\n');
    } catch (e) {
      return '';
    }
  },

  /**
   * Decode TXXX (User-defined text information) frame
   */
  decodeTXXXFrame(buffer) {
    try {
      const bytes = new Uint8Array(buffer);
      if (bytes.length < 2) return null;
      const encoding = bytes[0];
      let offset = 1;
      let descEnd = offset;

      if (encoding === 0 || encoding === 3) {
        while (descEnd < bytes.length && bytes[descEnd] !== 0) descEnd++;
        const desc = this.decodeEncodedText(bytes.slice(offset, descEnd), encoding);
        const valOffset = descEnd < bytes.length ? descEnd + 1 : descEnd;
        const val = this.decodeEncodedText(bytes.slice(valOffset), encoding);
        return { description: desc, value: val };
      } else {
        while (descEnd < bytes.length - 1 && !(bytes[descEnd] === 0 && bytes[descEnd + 1] === 0)) {
          descEnd += 2;
        }
        const desc = this.decodeEncodedText(bytes.slice(offset, descEnd), encoding);
        const valOffset = descEnd < bytes.length - 1 ? descEnd + 2 : descEnd;
        const val = this.decodeEncodedText(bytes.slice(valOffset), encoding);
        return { description: desc, value: val };
      }
    } catch (e) {
      return null;
    }
  },

  /**
   * Decode APIC (Attached Picture) frame to Blob
   */
  decodeAPICFrame(buffer) {
    try {
      const bytes = new Uint8Array(buffer);
      if (bytes.length < 10) return null;

      const encoding = bytes[0];
      let offset = 1;

      // Read MIME type
      let mimeType = '';
      while (offset < bytes.length && bytes[offset] !== 0) {
        mimeType += String.fromCharCode(bytes[offset]);
        offset++;
      }
      offset++; // skip null terminator

      if (!mimeType || mimeType === 'image/') mimeType = 'image/jpeg';

      const pictureType = bytes[offset];
      offset++; // skip picture type

      // Skip description
      if (encoding === 0 || encoding === 3) {
        while (offset < bytes.length && bytes[offset] !== 0) offset++;
        offset++;
      } else {
        // UTF-16
        while (offset < bytes.length - 1 && !(bytes[offset] === 0 && bytes[offset + 1] === 0)) {
          offset += 2;
        }
        offset += 2;
      }

      if (offset >= bytes.length) return null;

      const imgBytes = bytes.slice(offset);
      const blob = new Blob([imgBytes], { type: mimeType });
      return {
        coverBlob: blob
      };
    } catch (e) {
      return null;
    }
  },

  /**
   * Parse FLAC Picture & Vorbis Comments (Title, Artist, Album, Year, Lyrics)
   */
  parseFLAC(buffer) {
    try {
      const view = new DataView(buffer);
      const str = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
      if (str !== 'fLaC') return null;

      let offset = 4;
      let isLast = false;
      const result = {
        title: '',
        artist: '',
        album: '',
        year: '',
        lyrics: '',
        coverBlob: null
      };

      while (offset < buffer.byteLength - 4 && !isLast) {
        const header = view.getUint8(offset);
        isLast = (header & 0x80) !== 0;
        const blockType = header & 0x7F;
        const blockSize = (view.getUint8(offset + 1) << 16) | (view.getUint8(offset + 2) << 8) | view.getUint8(offset + 3);
        offset += 4;

        if (blockType === 4) {
          // VORBIS_COMMENT block
          try {
            const commentView = new DataView(buffer, offset, blockSize);
            let commentOffset = 0;
            if (commentOffset + 4 <= blockSize) {
              const vendorLen = commentView.getUint32(commentOffset, true);
              commentOffset += 4 + vendorLen;
              if (commentOffset + 4 <= blockSize) {
                const numComments = commentView.getUint32(commentOffset, true);
                commentOffset += 4;
                for (let c = 0; c < numComments && commentOffset < blockSize; c++) {
                  if (commentOffset + 4 > blockSize) break;
                  const commentLen = commentView.getUint32(commentOffset, true);
                  commentOffset += 4;
                  if (commentOffset + commentLen > blockSize) break;
                  const commentBytes = new Uint8Array(buffer, offset + commentOffset, commentLen);
                  const commentStr = new TextDecoder('utf-8').decode(commentBytes);
                  commentOffset += commentLen;

                  const eqIdx = commentStr.indexOf('=');
                  if (eqIdx !== -1) {
                    const key = commentStr.substring(0, eqIdx).toUpperCase().trim();
                    const val = commentStr.substring(eqIdx + 1).trim();
                    if (key === 'TITLE' && !result.title) result.title = val;
                    else if ((key === 'ARTIST' || key === 'ALBUMARTIST' || key === 'ARTISTNAME') && !result.artist) result.artist = val;
                    else if (key === 'ALBUM' && !result.album) result.album = val;
                    else if ((key === 'DATE' || key === 'YEAR') && !result.year) result.year = val;
                    else if ((key === 'LYRICS' || key === 'UNSYNCEDLYRICS' || key === 'SYNCEDLYRICS' || key === 'LYRIC' || key === 'UNSYNCED LYRICS') && !result.lyrics) {
                      result.lyrics = val;
                    }
                  }
                }
              }
            }
          } catch (e) {
            // Silently ignore comment parse errors
          }
        } else if (blockType === 6) {
          // PICTURE block
          try {
            const mimeLen = view.getUint32(offset + 4);
            let mime = '';
            for (let i = 0; i < mimeLen; i++) {
              mime += String.fromCharCode(view.getUint8(offset + 8 + i));
            }
            const descLen = view.getUint32(offset + 8 + mimeLen);
            const dataOffset = offset + 8 + mimeLen + 4 + descLen + 16;
            const dataLen = view.getUint32(dataOffset - 4);

            const imgBytes = new Uint8Array(buffer, dataOffset, dataLen);
            result.coverBlob = new Blob([imgBytes], { type: mime || 'image/jpeg' });
          } catch (e) {
            // Silently ignore picture parse errors
          }
        }
        offset += blockSize;
      }

      if (result.title || result.artist || result.coverBlob || result.lyrics) {
        return result;
      }
    } catch (e) {
      // Silently ignore
    }
    return null;
  },

  /**
   * Parse M4A / MP4 / AAC tags (Title, Artist, Album, Year, Lyrics, Cover Art)
   */
  parseM4A(buffer) {
    try {
      const bytes = new Uint8Array(buffer);
      const result = {
        title: '',
        artist: '',
        album: '',
        year: '',
        lyrics: '',
        coverBlob: null
      };

      const atoms = [
        { fourcc: [0xA9, 0x6C, 0x79, 0x72], key: 'lyrics' }, // ©lyr
        { fourcc: [0xA9, 0x6E, 0x61, 0x6D], key: 'title' },  // ©nam
        { fourcc: [0xA9, 0x41, 0x52, 0x54], key: 'artist' }, // ©ART
        { fourcc: [0x61, 0x41, 0x52, 0x54], key: 'artist' }, // aART
        { fourcc: [0xA9, 0x61, 0x6C, 0x62], key: 'album' },  // ©alb
        { fourcc: [0xA9, 0x64, 0x61, 0x79], key: 'year' }    // ©day
      ];

      // 1. Scan for text atoms
      for (const atom of atoms) {
        const [b0, b1, b2, b3] = atom.fourcc;
        for (let i = 0; i < bytes.length - 16; i++) {
          if (bytes[i] === b0 && bytes[i + 1] === b1 && bytes[i + 2] === b2 && bytes[i + 3] === b3) {
            let dataOffset = i + 4;
            const searchLimit = Math.min(bytes.length - 8, i + 64);
            while (dataOffset < searchLimit) {
              if (bytes[dataOffset] === 0x64 && bytes[dataOffset + 1] === 0x61 && bytes[dataOffset + 2] === 0x74 && bytes[dataOffset + 3] === 0x61) { // 'data'
                const dataLen = (bytes[dataOffset - 4] << 24) | (bytes[dataOffset - 3] << 16) | (bytes[dataOffset - 2] << 8) | bytes[dataOffset - 1];
                const textStart = dataOffset + 12;
                const textLen = dataLen - 16;
                if (textLen > 0 && textStart + textLen <= bytes.length) {
                  const textBytes = bytes.slice(textStart, textStart + textLen);
                  const str = new TextDecoder('utf-8').decode(textBytes).trim();
                  if (str && !result[atom.key]) {
                    result[atom.key] = str;
                  }
                }
                break;
              }
              dataOffset++;
            }
          }
        }
      }

      // 2. Scan for 'covr' image atom
      for (let i = 0; i < bytes.length - 16; i++) {
        if (bytes[i] === 0x63 && bytes[i + 1] === 0x6F && bytes[i + 2] === 0x76 && bytes[i + 3] === 0x72) { // 'covr'
          let dataOffset = i + 4;
          while (dataOffset < bytes.length - 16) {
            if (bytes[dataOffset] === 0x64 && bytes[dataOffset + 1] === 0x61 && bytes[dataOffset + 2] === 0x74 && bytes[dataOffset + 3] === 0x61) { // 'data'
              const dataLen = (bytes[dataOffset - 4] << 24) | (bytes[dataOffset - 3] << 16) | (bytes[dataOffset - 2] << 8) | bytes[dataOffset - 1];
              const flags = (bytes[dataOffset + 4] << 24) | (bytes[dataOffset + 5] << 16) | (bytes[dataOffset + 6] << 8) | bytes[dataOffset + 7];
              const mimeType = (flags === 14) ? 'image/png' : 'image/jpeg';
              const imgStart = dataOffset + 12;
              const imgLen = dataLen - 16;
              if (imgLen > 0 && imgStart + imgLen <= bytes.length) {
                const imgBytes = bytes.slice(imgStart, imgStart + imgLen);
                result.coverBlob = new Blob([imgBytes], { type: mimeType });
              }
              break;
            }
            dataOffset++;
          }
          break;
        }
      }

      if (result.title || result.artist || result.coverBlob || result.lyrics) {
        return result;
      }
    } catch (e) {
      // Silently ignore
    }
    return null;
  },

  /**
   * Parse ID3v1 tags (last 128 bytes)
   */
  parseID3v1(buffer) {
    const bytes = new Uint8Array(buffer);
    const tag = String.fromCharCode(bytes[0], bytes[1], bytes[2]);
    if (tag !== 'TAG') return null;

    const decode = (start, length) => {
      let str = '';
      for (let i = start; i < start + length; i++) {
        if (bytes[i] === 0) break;
        str += String.fromCharCode(bytes[i]);
      }
      return str.trim();
    };

    return {
      title: decode(3, 30),
      artist: decode(33, 30),
      album: decode(63, 30),
      year: decode(93, 4)
    };
  },

  /**
   * Decode text frame based on ID3 encoding byte
   */
  decodeTextFrame(buffer) {
    try {
      const bytes = new Uint8Array(buffer);
      if (bytes.length === 0) return '';
      const encoding = bytes[0];
      const textBytes = bytes.slice(1);
      return this.decodeEncodedText(textBytes, encoding);
    } catch (e) {
      return '';
    }
  },

  /**
   * Synchsafe integer conversion
   */
  readSynchsafeInt(view, offset) {
    return (
      (view.getUint8(offset) & 0x7F) << 21 |
      (view.getUint8(offset + 1) & 0x7F) << 14 |
      (view.getUint8(offset + 2) & 0x7F) << 7 |
      (view.getUint8(offset + 3) & 0x7F)
    );
  },

  /**
   * Filename based fallback
   */
  getFallbackMetadata(filename) {
    const cleanName = filename.replace(/\.[^/.]+$/, '').trim();
    
    if (cleanName.includes(' - ')) {
      const parts = cleanName.split(' - ');
      const artist = parts[0].trim();
      const title = parts.slice(1).join(' - ').trim();
      return {
        title: title || cleanName,
        artist: artist || 'Unknown',
        album: 'Unknown Album',
        year: '',
        lyrics: '',
        coverUrl: null,
        coverBlob: null,
        duration: 0
      };
    }

    return {
      title: cleanName,
      artist: 'Unknown',
      album: 'Unknown Album',
      year: '',
      lyrics: '',
      coverUrl: null,
      coverBlob: null,
      duration: 0
    };
  }
};

window.ID3Parser = ID3Parser;

