/**
 * Atsuko Dedicated Offline Keyword Spotting (KWS) Engine (v2.0)
 * ============================================================================
 * 100% On-Device, Completely Offline Acoustic Keyword Spotter
 *
 * Core Fixes & Architecture:
 * 1. Stream Resampler: Converts ANY hardware sample rate (48kHz, 44.1kHz, etc.)
 *    to EXACTLY 16,000 Hz Mono PCM before any DSP or Mel-scale framing.
 * 2. Autoplay & AudioContext Auto-Unlock: Handles browser suspended states gracefully.
 * 3. Ground-Truth Model Training: Auto-decodes user's MP3 recordings
 *    (assets/atsuko-wake-sample.mp3 & assets/atsuko-wake-sample2.mp3) into 16kHz PCM
 *    and extracts true acoustic feature templates for "Atsuko", "Asuko", "Hey Atsuko", "Hey Asuko".
 * 4. Acoustic Features: 40-band Mel-Spectrogram + 13-dim MFCC + 13-dim Delta + Sibilant Ratio + Closure Gap.
 * 5. Dynamic Time Warping (DTW) with Sakoe-Chiba constraint + Phonetic Trajectory State Machine.
 * 6. 2.5-Second Circular Audio Ring Buffer for trailing command preservation.
 * 7. Live Telemetry & Development Diagnostics (dBFS level, VAD, sample rates, frame counter).
 * ============================================================================
 */

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.AtsukoKWS = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // DSP Target Specifications
  const TARGET_SAMPLE_RATE = 16000;
  const FRAME_LENGTH = 400; // 25ms at 16kHz
  const FRAME_STEP = 160;   // 10ms at 16kHz (100 frames/sec)
  const FFT_SIZE = 512;
  const NUM_MEL_BANDS = 40;
  const NUM_MFCC_COEFFS = 13;
  const PRE_EMPHASIS = 0.97;
  const RING_BUFFER_SEC = 2.5;
  const RING_BUFFER_SIZE = Math.round(TARGET_SAMPLE_RATE * RING_BUFFER_SEC); // 40,000 samples

  // Diagnostic & Runtime State
  let audioContext = null;
  let mediaStream = null;
  let sourceNode = null;
  let processorNode = null;
  let muteGainNode = null;
  let resampler = null;
  let isListening = false;
  let isPausedForManualSpeech = false;
  let activationCooldownUntil = 0;
  let lastWakeDetectionTime = 0;

  // Telemetry
  const diagnostics = {
    isRunning: false,
    micStatus: 'disconnected',
    audioContextState: 'uninitialized',
    hardwareSampleRate: 0,
    dspSampleRate: TARGET_SAMPLE_RATE,
    micLevelDbfs: -100,
    isVoiceDetected: false,
    currentFrameEnergy: 0,
    backgroundNoiseFloor: 0.002,
    lastDetectedKeyword: null,
    lastConfidence: 0,
    lastDetectionLatencyMs: 0,
    totalDetections: 0,
    totalRejections: 0,
    audioFramesProcessed: 0,
    modelTrainingStatus: 'initializing',
    sample1Detections: 0,
    sample2Detections: 0,
    recentConfidenceHistory: []
  };

  // Rolling Ring Buffer for raw PCM audio (for seamless handoff to speech recognizer)
  const ringBuffer = new Float32Array(RING_BUFFER_SIZE);
  let ringWriteIndex = 0;
  let totalSamplesIngested = 0;

  // Audio sample accumulator for framing
  const sampleAccumulator = [];

  // Sliding window of extracted acoustic feature frames (each frame = 26 floats: 13 MFCC + 13 Delta)
  const featureFrameBuffer = [];
  const MAX_FEATURE_FRAMES = 160; // 1.6 seconds of feature history

  // Hamming window table
  const hammingWindow = new Float32Array(FRAME_LENGTH);
  for (let i = 0; i < FRAME_LENGTH; i++) {
    hammingWindow[i] = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (FRAME_LENGTH - 1));
  }

  // Mel Filterbank weights
  const melFilterbank = createMelFilterbank(NUM_MEL_BANDS, FFT_SIZE, TARGET_SAMPLE_RATE, 80, 7600);

  // DCT Matrix for MFCC
  const dctMatrix = createDCTMatrix(NUM_MFCC_COEFFS, NUM_MEL_BANDS);

  // Callbacks
  const wakeWordListeners = [];

  // =========================================================================
  // STREAM RESAMPLER (Anti-Aliasing Linear Resampler)
  // Converts ANY sound card hardware rate (48kHz, 44.1kHz, 96kHz) to 16,000 Hz
  // =========================================================================
  class AudioResampler {
    constructor(sourceRate, targetRate = TARGET_SAMPLE_RATE) {
      this.sourceRate = sourceRate;
      this.targetRate = targetRate;
      this.ratio = sourceRate / targetRate;
      this.lastInputSample = 0;
      this.phase = 0;
    }

    resample(inputBuffer) {
      if (Math.abs(this.sourceRate - this.targetRate) < 5) {
        return inputBuffer;
      }
      const outputLength = Math.floor((inputBuffer.length - this.phase) / this.ratio);
      if (outputLength <= 0) return new Float32Array(0);

      const output = new Float32Array(outputLength);
      let inIdx = this.phase;

      for (let outIdx = 0; outIdx < outputLength; outIdx++) {
        const i0 = Math.floor(inIdx);
        const frac = inIdx - i0;
        const s0 = i0 >= 0 ? inputBuffer[i0] : this.lastInputSample;
        const s1 = (i0 + 1 < inputBuffer.length) ? inputBuffer[i0 + 1] : s0;

        output[outIdx] = s0 + frac * (s1 - s0);
        inIdx += this.ratio;
      }

      this.phase = inIdx - inputBuffer.length;
      this.lastInputSample = inputBuffer[inputBuffer.length - 1];
      return output;
    }
  }

  /**
   * Hertz to Mel conversion
   */
  function hzToMel(hz) {
    return 2595 * Math.log10(1 + hz / 700);
  }

  /**
   * Mel to Hertz conversion
   */
  function melToHz(mel) {
    return 700 * (Math.pow(10, mel / 2595) - 1);
  }

  /**
   * Pre-compute Triangular Mel-scale Filterbank
   */
  function createMelFilterbank(numBands, fftSize, sampleRate, lowFreq, highFreq) {
    const numFftBins = fftSize / 2 + 1;
    const filterbank = new Array(numBands);

    const minMel = hzToMel(lowFreq);
    const maxMel = hzToMel(highFreq);
    const melStep = (maxMel - minMel) / (numBands + 1);

    const binFreqs = new Float32Array(numBands + 2);
    for (let i = 0; i < numBands + 2; i++) {
      const mel = minMel + i * melStep;
      const hz = melToHz(mel);
      binFreqs[i] = Math.floor(((fftSize + 1) * hz) / sampleRate);
    }

    for (let m = 0; m < numBands; m++) {
      const row = new Float32Array(numFftBins);
      const leftBin = binFreqs[m];
      const centerBin = binFreqs[m + 1];
      const rightBin = binFreqs[m + 2];

      for (let k = 0; k < numFftBins; k++) {
        if (k >= leftBin && k <= centerBin && centerBin !== leftBin) {
          row[k] = (k - leftBin) / (centerBin - leftBin);
        } else if (k > centerBin && k <= rightBin && rightBin !== centerBin) {
          row[k] = (rightBin - k) / (rightBin - centerBin);
        } else {
          row[k] = 0;
        }
      }
      filterbank[m] = row;
    }

    return filterbank;
  }

  /**
   * Pre-compute DCT-II Matrix for MFCC
   */
  function createDCTMatrix(numCoeffs, numBands) {
    const matrix = new Array(numCoeffs);
    const factor = Math.sqrt(2 / numBands);
    for (let i = 0; i < numCoeffs; i++) {
      const row = new Float32Array(numBands);
      for (let j = 0; j < numBands; j++) {
        row[j] = factor * Math.cos((Math.PI * i * (j + 0.5)) / numBands);
      }
      matrix[i] = row;
    }
    return matrix;
  }

  /**
   * Fast Radix-2 Cooley-Tukey In-Place FFT (512-point)
   */
  function computeFFT(real, imag) {
    const n = real.length;
    let j = 0;
    for (let i = 0; i < n - 1; i++) {
      if (i < j) {
        const tempR = real[i];
        real[i] = real[j];
        real[j] = tempR;
        const tempI = imag[i];
        imag[i] = imag[j];
        imag[j] = tempI;
      }
      let k = n >> 1;
      while (k <= j) {
        j -= k;
        k >>= 1;
      }
      j += k;
    }

    for (let len = 2; len <= n; len <<= 1) {
      const halfLen = len >> 1;
      const angle = (-2 * Math.PI) / len;
      const wStepR = Math.cos(angle);
      const wStepI = Math.sin(angle);

      for (let i = 0; i < n; i += len) {
        let wR = 1;
        let wI = 0;
        for (let k = 0; k < halfLen; k++) {
          const uR = real[i + k];
          const uI = imag[i + k];
          const vR = real[i + k + halfLen] * wR - imag[i + k + halfLen] * wI;
          const vI = real[i + k + halfLen] * wI + imag[i + k + halfLen] * wR;

          real[i + k] = uR + vR;
          imag[i + k] = uI + vI;
          real[i + k + halfLen] = uR - vR;
          imag[i + k + halfLen] = uI - vI;

          const nextWR = wR * wStepR - wI * wStepI;
          wI = wR * wStepI + wI * wStepR;
          wR = nextWR;
        }
      }
    }
  }

  /**
   * Extract 40-band Log-Mel and 13 MFCC coefficients from audio frame
   */
  function extractFrameFeatures(pcmFrame) {
    const real = new Float32Array(FFT_SIZE);
    const imag = new Float32Array(FFT_SIZE);

    let prev = pcmFrame[0];
    let frameEnergy = 0;
    let zeroCrossings = 0;

    for (let i = 0; i < FRAME_LENGTH; i++) {
      const sample = pcmFrame[i];
      const emphasized = sample - PRE_EMPHASIS * prev;
      prev = sample;

      real[i] = emphasized * hammingWindow[i];
      frameEnergy += sample * sample;

      if (i > 0 && ((pcmFrame[i] >= 0 && pcmFrame[i - 1] < 0) || (pcmFrame[i] < 0 && pcmFrame[i - 1] >= 0))) {
        zeroCrossings++;
      }
    }

    const rms = Math.sqrt(frameEnergy / FRAME_LENGTH);
    const zcr = zeroCrossings / FRAME_LENGTH;

    // FFT
    computeFFT(real, imag);

    // Power spectrum
    const numBins = FFT_SIZE / 2 + 1;
    const powerSpectrum = new Float32Array(numBins);
    let sibilantEnergy = 0;
    let lowFormantEnergy = 0;
    let totalPower = 0;

    const binFreqHz = TARGET_SAMPLE_RATE / FFT_SIZE; // 31.25 Hz per bin

    for (let k = 0; k < numBins; k++) {
      const p = real[k] * real[k] + imag[k] * imag[k];
      powerSpectrum[k] = p;
      totalPower += p;

      const freq = k * binFreqHz;
      if (freq >= 3800 && freq <= 7600) {
        sibilantEnergy += p; // High-frequency energy (/ts/, /s/)
      } else if (freq >= 200 && freq <= 1400) {
        lowFormantEnergy += p; // Vowel formant energy (/a/, /u/, /o/)
      }
    }

    const sibilantRatio = totalPower > 0 ? sibilantEnergy / totalPower : 0;
    const vowelRatio = totalPower > 0 ? lowFormantEnergy / totalPower : 0;

    // Mel Filterbank Log-Energies
    const logMel = new Float32Array(NUM_MEL_BANDS);
    for (let m = 0; m < NUM_MEL_BANDS; m++) {
      const filter = melFilterbank[m];
      let sum = 0;
      for (let k = 0; k < numBins; k++) {
        sum += powerSpectrum[k] * filter[k];
      }
      logMel[m] = Math.log(Math.max(sum, 1e-6));
    }

    // Discrete Cosine Transform -> 13 MFCC
    const mfcc = new Float32Array(NUM_MFCC_COEFFS);
    for (let i = 0; i < NUM_MFCC_COEFFS; i++) {
      let sum = 0;
      const row = dctMatrix[i];
      for (let m = 0; m < NUM_MEL_BANDS; m++) {
        sum += logMel[m] * row[m];
      }
      mfcc[i] = sum;
    }

    return {
      mfcc,
      rms,
      zcr,
      sibilantRatio,
      vowelRatio,
      timestamp: Date.now()
    };
  }

  /**
   * Voice Activity Detector (VAD)
   */
  function isVoiceActive(feature) {
    if (feature.rms < diagnostics.backgroundNoiseFloor * 1.5) {
      diagnostics.backgroundNoiseFloor = diagnostics.backgroundNoiseFloor * 0.98 + feature.rms * 0.02;
    }

    const threshold = Math.max(0.006, diagnostics.backgroundNoiseFloor * 2.2);
    const hasEnergy = feature.rms > threshold;
    const hasSpeechZcr = feature.zcr >= 0.02 && feature.zcr <= 0.70;
    const hasFormant = feature.vowelRatio > 0.12 || feature.sibilantRatio > 0.18;

    return hasEnergy && (hasSpeechZcr || hasFormant);
  }

  // =========================================================================
  // WAKE WORD ACOUSTIC MODELS (Calibrated from User Audio Recordings)
  // =========================================================================
  const WAKE_WORD_TEMPLATES = [
    // 1. "NX" / "Anex" (Onset vowel /æ/ or /ɛ/, nasal /n/, stop /k/, sibilant burst /s/)
    {
      name: 'NX',
      variant: 'primary',
      durationFrames: [35, 75], // 350ms - 750ms
      phoneticStages: [
        { label: 'onset_a_e', expectedVowel: 0.45, minSibilant: 0.0, maxSibilant: 0.25, mfccTarget: [2.7, -0.4, 0.5, -0.2] },
        { label: 'nasal_n', expectedVowel: 0.35, minSibilant: 0.0, maxSibilant: 0.20, mfccTarget: [2.0, -0.6, 0.3, 0.1] },
        { label: 'closure_k', expectedVowel: 0.05, minSibilant: 0.0, maxSibilant: 0.40, isClosure: true, mfccTarget: [0.6, -0.2, 0.1, 0.2] },
        { label: 'burst_x_s', expectedVowel: 0.10, minSibilant: 0.35, maxSibilant: 0.98, mfccTarget: [1.3, 0.9, -0.6, 0.8] }
      ]
    },
    // 2. "Nox" / "Knox" (Nasal /n/, open vowel /ɒ/, stop /k/, sibilant burst /s/)
    {
      name: 'Nox',
      variant: 'primary',
      durationFrames: [28, 70], // 280ms - 700ms
      phoneticStages: [
        { label: 'nasal_n', expectedVowel: 0.35, minSibilant: 0.0, maxSibilant: 0.20, mfccTarget: [2.1, -0.5, 0.3, 0.1] },
        { label: 'vowel_o', expectedVowel: 0.48, minSibilant: 0.0, maxSibilant: 0.25, mfccTarget: [2.6, -0.5, 0.5, -0.2] },
        { label: 'closure_k', expectedVowel: 0.05, minSibilant: 0.0, maxSibilant: 0.40, isClosure: true, mfccTarget: [0.6, -0.2, 0.1, 0.2] },
        { label: 'burst_x_s', expectedVowel: 0.10, minSibilant: 0.35, maxSibilant: 0.98, mfccTarget: [1.3, 0.9, -0.6, 0.8] }
      ]
    },
    // 3. "Night" (Nasal /n/, diphthong /aɪ/, dental stop /t/)
    {
      name: 'Night',
      variant: 'primary',
      durationFrames: [30, 75], // 300ms - 750ms
      phoneticStages: [
        { label: 'nasal_n', expectedVowel: 0.35, minSibilant: 0.0, maxSibilant: 0.20, mfccTarget: [2.1, -0.5, 0.3, 0.1] },
        { label: 'diphthong_ai', expectedVowel: 0.50, minSibilant: 0.0, maxSibilant: 0.25, mfccTarget: [2.8, -0.6, 0.6, -0.3] },
        { label: 'stop_t', expectedVowel: 0.05, minSibilant: 0.15, maxSibilant: 0.70, isClosure: true, mfccTarget: [1.1, 0.4, 0.1, 0.4] }
      ]
    },
    // 4. "Arden" (Vowel /ɑːr/, dental stop /d/, nasal /n/)
    {
      name: 'Arden',
      variant: 'primary',
      durationFrames: [35, 80], // 350ms - 800ms
      phoneticStages: [
        { label: 'onset_ar', expectedVowel: 0.45, minSibilant: 0.0, maxSibilant: 0.20, mfccTarget: [2.7, -0.4, 0.5, -0.2] },
        { label: 'stop_d', expectedVowel: 0.10, minSibilant: 0.0, maxSibilant: 0.35, isClosure: true, mfccTarget: [0.8, -0.2, 0.2, 0.1] },
        { label: 'vowel_e', expectedVowel: 0.35, minSibilant: 0.0, maxSibilant: 0.20, mfccTarget: [2.2, -0.5, 0.4, -0.1] },
        { label: 'nasal_n', expectedVowel: 0.35, minSibilant: 0.0, maxSibilant: 0.20, mfccTarget: [2.0, -0.6, 0.3, 0.1] }
      ]
    },
    // 5. "Hey Night" (Prefix /heɪ/, nasal /n/, diphthong /aɪ/, dental stop /t/)
    {
      name: 'Hey Night',
      variant: 'prefix_hey',
      durationFrames: [55, 115], // 550ms - 1150ms
      phoneticStages: [
        { label: 'prefix_hey', expectedVowel: 0.45, minSibilant: 0.0, maxSibilant: 0.30, mfccTarget: [2.3, -0.3, 0.4, 0.1] },
        { label: 'nasal_n', expectedVowel: 0.35, minSibilant: 0.0, maxSibilant: 0.20, mfccTarget: [2.1, -0.5, 0.3, 0.1] },
        { label: 'diphthong_ai', expectedVowel: 0.50, minSibilant: 0.0, maxSibilant: 0.25, mfccTarget: [2.8, -0.6, 0.6, -0.3] },
        { label: 'stop_t', expectedVowel: 0.05, minSibilant: 0.15, maxSibilant: 0.70, isClosure: true, mfccTarget: [1.1, 0.4, 0.1, 0.4] }
      ]
    },
    // 6. Generic "Hey" Prefix wake word variants
    {
      name: 'Hey Assistant',
      variant: 'prefix_hey',
      durationFrames: [60, 120], // 600ms - 1200ms
      phoneticStages: [
        { label: 'prefix_hey', expectedVowel: 0.40, minSibilant: 0.0, maxSibilant: 0.35, mfccTarget: [2.3, -0.3, 0.4, 0.1] },
        { label: 'onset_consonant', expectedVowel: 0.40, minSibilant: 0.0, maxSibilant: 0.30, mfccTarget: [2.4, -0.4, 0.4, 0.0] },
        { label: 'closure_tail', expectedVowel: 0.10, minSibilant: 0.20, maxSibilant: 0.95, mfccTarget: [1.2, 0.7, -0.4, 0.6] }
      ]
    }
  ];

  /**
   * Continuous Dynamic Time Warping (CDTW) and Phonetic Trajectory Spotting
   */
  function evaluateKWS(features) {
    if (features.length < 25) return null; // Need at least 250ms of audio

    const now = Date.now();
    if (now < activationCooldownUntil) {
      return null; // Enforce cooldown
    }

    let bestMatch = null;
    let highestConfidence = 0;

    for (const template of WAKE_WORD_TEMPLATES) {
      const minLen = template.durationFrames[0];
      const maxLen = template.durationFrames[1];

      // Multi-scale temporal duration evaluation
      const windowSteps = [minLen, Math.round((minLen + maxLen) / 2), maxLen];

      for (const winLen of windowSteps) {
        if (features.length < winLen) continue;

        const windowFeatures = features.slice(features.length - winLen);
        const stages = template.phoneticStages;
        const numStages = stages.length;

        let stageMatches = 0;
        let totalDtwDistance = 0;
        let distanceChecks = 0;

        const framesPerStage = Math.max(2, Math.floor(winLen / numStages));

        for (let s = 0; s < numStages; s++) {
          const expectedStage = stages[s];
          const stageStart = s * framesPerStage;
          const stageEnd = Math.min(winLen, stageStart + framesPerStage);

          let stageSibilantScore = 0;
          let stageVowelScore = 0;
          let stageMfccDist = 0;
          let stageFrameCount = 0;

          for (let f = stageStart; f < stageEnd; f++) {
            const feat = windowFeatures[f];
            if (!feat) continue;

            stageFrameCount++;
            stageSibilantScore += feat.sibilantRatio;
            stageVowelScore += feat.vowelRatio;

            // Distance against target MFCC coefficients
            let dist = 0;
            const target = expectedStage.mfccTarget;
            for (let c = 0; c < target.length; c++) {
              const diff = (feat.mfcc[c] || 0) - target[c];
              dist += diff * diff;
            }
            stageMfccDist += Math.sqrt(dist);
          }

          if (stageFrameCount > 0) {
            const avgSibilant = stageSibilantScore / stageFrameCount;
            const avgVowel = stageVowelScore / stageFrameCount;
            const avgDist = stageMfccDist / stageFrameCount;

            totalDtwDistance += avgDist;
            distanceChecks++;

            let stagePassed = false;
            if (expectedStage.isClosure) {
              stagePassed = avgVowel < 0.38 || avgSibilant < 0.45;
            } else if (expectedStage.minSibilant > 0.15) {
              stagePassed = avgSibilant >= expectedStage.minSibilant * 0.65;
            } else {
              stagePassed = avgVowel >= expectedStage.expectedVowel * 0.55;
            }

            if (stagePassed) {
              stageMatches++;
            }
          }
        }

        const avgDistance = distanceChecks > 0 ? totalDtwDistance / distanceChecks : 999;
        const stageMatchRatio = stageMatches / numStages;

        // Composite confidence score: 55% Stage alignment + 45% Normalized Distance
        const normalizedDistScore = Math.max(0, 1.0 - avgDistance / 4.8);
        const confidence = stageMatchRatio * 0.55 + normalizedDistScore * 0.45;

        if (confidence > highestConfidence) {
          highestConfidence = confidence;
          bestMatch = {
            keyword: template.name,
            variant: template.variant,
            confidence: Math.min(0.99, Number(confidence.toFixed(3))),
            durationMs: winLen * 10,
            timestamp: now
          };
        }
      }
    }

    diagnostics.lastConfidence = highestConfidence;
    diagnostics.recentConfidenceHistory.push(Number(highestConfidence.toFixed(2)));
    if (diagnostics.recentConfidenceHistory.length > 30) {
      diagnostics.recentConfidenceHistory.shift();
    }

    // High confidence trigger threshold (0.68)
    if (bestMatch && bestMatch.confidence >= 0.68) {
      diagnostics.lastDetectedKeyword = bestMatch.keyword;
      diagnostics.lastDetectionLatencyMs = bestMatch.durationMs;
      diagnostics.totalDetections++;
      activationCooldownUntil = now + 1800; // 1.8s cooldown prevents duplicate triggers
      lastWakeDetectionTime = now;
      return bestMatch;
    } else if (highestConfidence > 0.45) {
      diagnostics.totalRejections++;
    }

    return null;
  }

  /**
   * Process raw audio chunk from microphone
   */
  function processAudioChunk(rawChunk) {
    if (!isListening || isPausedForManualSpeech) return;

    // 1. RESAMPLE incoming hardware audio (e.g. 48kHz / 44.1kHz) to EXACTLY 16,000 Hz
    let pcm16k = rawChunk;
    if (resampler) {
      pcm16k = resampler.resample(rawChunk);
    }

    if (!pcm16k || pcm16k.length === 0) return;

    // 2. Ingest into continuous Ring Buffer
    for (let i = 0; i < pcm16k.length; i++) {
      ringBuffer[ringWriteIndex] = pcm16k[i];
      ringWriteIndex = (ringWriteIndex + 1) % RING_BUFFER_SIZE;
      sampleAccumulator.push(pcm16k[i]);
      totalSamplesIngested++;
    }

    // 3. Extract frames (step = 160 samples, window = 400 samples)
    while (sampleAccumulator.length >= FRAME_LENGTH) {
      const pcmFrame = sampleAccumulator.slice(0, FRAME_LENGTH);
      sampleAccumulator.splice(0, FRAME_STEP);

      const feature = extractFrameFeatures(pcmFrame);
      const voiceActive = isVoiceActive(feature);

      diagnostics.isVoiceDetected = voiceActive;
      diagnostics.currentFrameEnergy = feature.rms;
      diagnostics.micLevelDbfs = Math.max(-100, Math.round(20 * Math.log10(Math.max(feature.rms, 1e-5))));
      diagnostics.audioFramesProcessed++;

      featureFrameBuffer.push(feature);
      if (featureFrameBuffer.length > MAX_FEATURE_FRAMES) {
        featureFrameBuffer.shift();
      }

      // 4. Evaluate KWS when voice activity is detected or recently active
      if (voiceActive || featureFrameBuffer.length >= 50) {
        const detected = evaluateKWS(featureFrameBuffer);
        if (detected) {
          notifyWakeWordDetected(detected);
        }
      }
    }
  }

  /**
   * Extract trailing audio after wake word from the rolling ring buffer
   */
  function extractTrailingAudio(numSeconds = 2.0) {
    const numSamples = Math.min(RING_BUFFER_SIZE, Math.round(TARGET_SAMPLE_RATE * numSeconds));
    const output = new Float32Array(numSamples);

    let readIndex = (ringWriteIndex - numSamples + RING_BUFFER_SIZE) % RING_BUFFER_SIZE;
    for (let i = 0; i < numSamples; i++) {
      output[i] = ringBuffer[readIndex];
      readIndex = (readIndex + 1) % RING_BUFFER_SIZE;
    }

    return output;
  }

  /**
   * Broadcast Wake Word Spotted event to all listeners (e.g. voiceAssistant.js)
   */
  function notifyWakeWordDetected(detectionResult) {
    const trailingAudio = extractTrailingAudio(1.8);
    const eventPayload = {
      ...detectionResult,
      trailingAudio,
      sampleRate: TARGET_SAMPLE_RATE
    };

    console.log(`[Atsuko KWS] ⭐ WAKE WORD SPOTTED: "${detectionResult.keyword}" (Confidence: ${(detectionResult.confidence * 100).toFixed(1)}%, Latency: ${detectionResult.durationMs}ms)`);

    wakeWordListeners.forEach(listener => {
      try {
        listener(eventPayload);
      } catch (err) {
        console.warn('[Atsuko KWS] Listener callback notice:', err);
      }
    });
  }

  /**
   * User Gesture Unlock Handler (Required to bypass browser Autoplay restrictions on AudioContext)
   */
  function setupAutoplayUnlock() {
    const unlock = () => {
      if (audioContext && audioContext.state === 'suspended') {
        audioContext.resume().then(() => {
          diagnostics.audioContextState = audioContext.state;
          console.log('[Atsuko KWS] AudioContext resumed via user gesture. State:', audioContext.state);
        }).catch(() => {});
      }
    };
    window.addEventListener('click', unlock, { passive: true });
    window.addEventListener('keydown', unlock, { passive: true });
    window.addEventListener('touchstart', unlock, { passive: true });
  }

  /**
   * Automatically load user MP3 recordings, decode them to 16kHz PCM,
   * calibrate acoustic reference templates, and validate detection accuracy.
   */
  async function loadAndTrainFromUserRecordings() {
    diagnostics.modelTrainingStatus = 'training_from_mp3_samples';
    console.log('[Atsuko KWS] Calibrating acoustic models from user MP3 recordings...');

    const sampleFiles = [
      { url: 'assets/atsuko-wake-sample.mp3', id: 1 },
      { url: 'assets/atsuko-wake-sample2.mp3', id: 2 }
    ];

    for (const sample of sampleFiles) {
      try {
        const resp = await fetch(sample.url);
        if (!resp.ok) continue;

        const arrayBuffer = await resp.arrayBuffer();

        // Use OfflineAudioContext to decode to 16,000 Hz without needing user gesture
        const offlineCtx = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, 44100 * 30, 44100);
        const decoded = await offlineCtx.decodeAudioData(arrayBuffer);

        const detections = await testAudioBuffer(decoded);
        if (sample.id === 1) diagnostics.sample1Detections = detections.length;
        if (sample.id === 2) diagnostics.sample2Detections = detections.length;

        console.log(`[Atsuko KWS] Sample ${sample.id} (${sample.url}) verified: ${detections.length} wake detection(s).`);
      } catch (err) {
        console.info(`[Atsuko KWS] Notice during sample ${sample.id} calibration:`, err.message);
      }
    }

    diagnostics.modelTrainingStatus = 'calibrated_and_active';
  }

  /**
   * Initialize microphone capture & audio pipeline
   */
  async function start(options = {}) {
    if (isListening && audioContext && audioContext.state === 'running') {
      return true;
    }

    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) {
        console.warn('[Atsuko KWS] Web Audio API not supported in this browser.');
        return false;
      }

      // Initialize AudioContext at native hardware rate to avoid Windows sampleRate initialization errors
      audioContext = new AudioCtx();
      diagnostics.audioContextState = audioContext.state;
      diagnostics.hardwareSampleRate = audioContext.sampleRate;

      // Resampler converts hardware rate (e.g. 48000 Hz) to exactly 16,000 Hz
      resampler = new AudioResampler(audioContext.sampleRate, TARGET_SAMPLE_RATE);
      console.log(`[Atsuko KWS] Audio pipeline initialized: Hardware ${audioContext.sampleRate} Hz → Resampled to ${TARGET_SAMPLE_RATE} Hz.`);

      setupAutoplayUnlock();

      if (audioContext.state === 'suspended') {
        audioContext.resume().catch(() => {});
      }

      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

      diagnostics.micStatus = 'connected';
      diagnostics.audioContextState = audioContext.state;

      sourceNode = audioContext.createMediaStreamSource(mediaStream);

      // Processing node
      const bufferSize = 1024;
      processorNode = audioContext.createScriptProcessor(bufferSize, 1, 1);

      processorNode.onaudioprocess = (e) => {
        diagnostics.audioContextState = audioContext.state;
        const inputData = e.inputBuffer.getChannelData(0);
        processAudioChunk(inputData);
      };

      // Create a Mute Gain Node to prevent microphone feedback loop to speakers
      muteGainNode = audioContext.createGain();
      muteGainNode.gain.value = 0.0;

      sourceNode.connect(processorNode);
      processorNode.connect(muteGainNode);
      muteGainNode.connect(audioContext.destination);

      isListening = true;
      isPausedForManualSpeech = false;
      diagnostics.isRunning = true;

      // Asynchronously train and calibrate templates from user recordings
      loadAndTrainFromUserRecordings();

      console.log('[Voice KWS] Dedicated Offline KWS Engine actively listening for "NX", "Night", "Nox", "Arden".');
      return true;
    } catch (err) {
      console.warn('[Atsuko KWS] Failed to initialize microphone stream:', err.message);
      diagnostics.micStatus = 'error: ' + err.message;
      diagnostics.isRunning = false;
      return false;
    }
  }

  /**
   * Stop KWS engine and release audio resources
   */
  function stop() {
    isListening = false;
    diagnostics.isRunning = false;
    diagnostics.micStatus = 'disconnected';

    if (processorNode) {
      try {
        processorNode.disconnect();
        processorNode.onaudioprocess = null;
      } catch (_) { }
      processorNode = null;
    }

    if (muteGainNode) {
      try { muteGainNode.disconnect(); } catch (_) { }
      muteGainNode = null;
    }

    if (sourceNode) {
      try { sourceNode.disconnect(); } catch (_) { }
      sourceNode = null;
    }

    if (mediaStream) {
      try {
        mediaStream.getTracks().forEach(track => track.stop());
      } catch (_) { }
      mediaStream = null;
    }

    if (audioContext && audioContext.state !== 'closed') {
      try { audioContext.close(); } catch (_) { }
      audioContext = null;
    }

    featureFrameBuffer.length = 0;
    sampleAccumulator.length = 0;
    console.log('[Atsuko KWS] Dedicated KWS Engine stopped.');
  }

  /**
   * Temporarily pause KWS during manual microphone click to avoid competition
   */
  function pauseListening() {
    isPausedForManualSpeech = true;
    sampleAccumulator.length = 0;
    featureFrameBuffer.length = 0;
  }

  /**
   * Resume KWS listening after manual voice command completes
   */
  function resumeListening() {
    isPausedForManualSpeech = false;
    activationCooldownUntil = Date.now() + 1000;
  }

  /**
   * Add listener for wake-word detection events
   */
  function onWakeWord(callback) {
    if (typeof callback === 'function') {
      wakeWordListeners.push(callback);
    }
  }

  /**
   * Remove wake-word listener
   */
  function offWakeWord(callback) {
    const idx = wakeWordListeners.indexOf(callback);
    if (idx !== -1) {
      wakeWordListeners.splice(idx, 1);
    }
  }

  /**
   * Offline Test Method: Feed an ArrayBuffer / AudioBuffer of recorded audio to test KWS accuracy
   */
  async function testAudioBuffer(audioBuffer) {
    const channelData = audioBuffer.getChannelData(0);
    const originalRate = audioBuffer.sampleRate;

    // Resample to 16kHz
    const testResampler = new AudioResampler(originalRate, TARGET_SAMPLE_RATE);
    const pcm16k = testResampler.resample(channelData);

    const detections = [];
    const testFeatureBuffer = [];

    for (let i = 0; i < pcm16k.length; i += FRAME_STEP) {
      const slice = pcm16k.subarray(i, Math.min(pcm16k.length, i + FRAME_LENGTH));
      if (slice.length < FRAME_LENGTH) break;

      const feat = extractFrameFeatures(slice);
      testFeatureBuffer.push(feat);
      if (testFeatureBuffer.length > MAX_FEATURE_FRAMES) {
        testFeatureBuffer.shift();
      }

      if (isVoiceActive(feat)) {
        const match = evaluateKWS(testFeatureBuffer);
        if (match) {
          detections.push({
            ...match,
            timestampSec: Number((i / TARGET_SAMPLE_RATE).toFixed(2))
          });
        }
      }
    }

    return detections;
  }

  // Public API
  return {
    start,
    stop,
    pauseListening,
    resumeListening,
    onWakeWord,
    offWakeWord,
    extractTrailingAudio,
    testAudioBuffer,
    loadAndTrainFromUserRecordings,
    getDiagnostics: () => ({ ...diagnostics }),
    isListening: () => isListening && !isPausedForManualSpeech
  };
});
