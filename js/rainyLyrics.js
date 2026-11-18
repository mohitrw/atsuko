/**
 * ============================================================================
 * ATSUKO - RAINY WINDOW LYRICS VIEW SYSTEM (v154 - Interactive Hydrodynamic Engine)
 * Exact recreation of real rain on foggy glass:
 * - Proper optical depth: Lyrics in background -> Condensation Fog on window ->
 *   Wet trails wiping mist -> Organic droplets on front glass surface.
 * - Stick-Slip Hydrodynamics: brisk, fluid downward slides (480-740px/s) with ease-out.
 * - Continuous Cascading Rivulets: smooth, flowing downward streams.
 * - Dynamic Teardrop Stretching: drops elongate into teardrops during rapid motion.
 * - Organic Segmented Trajectories: natural angular slips (Â±12Â°) eliminating straight lines & jitter.
 * - Realistic Traveled Path Graphic: cleared mist channel with dual meniscus borders & beads.
 * - Interactive Touch & Mouse: grab, drag, shed water trail, and merge with other droplets!
 * - Punchy Cinematic Lyric Transitions: heavy impact scale punch & shockwave neon flare.
 * - Heavy Rain Mode (Shift + B): realistic rain streaks, intense storm, & slow gradual fade.
 * - Offscreen Cached Lyrics & Selective Optical Refraction for locked 60 FPS performance.
 * - Toggled with "B" key. Shift+B toggles Heavy Rain. Esc exits. "D" toggles tuner.
 * ============================================================================
 */

(function () {
  'use strict';

  // Master Tuned Configuration
  const RAINY_CONFIG = {
    WORD_BY_WORD: false,          // Full line display for authentic cinematic lyric frame
    GLOW_STRENGTH: 0.85,          // Intense neon halo illuminating surrounding fog (0.0 to 1.0)
    FOG_AMOUNT: 0.72,             // Central condensation / living mist intensity (0.0 to 1.0)
    DROP_DENSITY: 1.25,           // Droplet density multiplier (0.2 to 2.5)
    DROP_SIZE: 1.15,              // Droplet size multiplier (0.5 to 2.0)
    TRAIL_COUNT: 4,               // Active sliding streams (1 to 5)
    RAIN_RATE: 1.3,               // Falling rain frequency multiplier (0.2 to 2.5)
    TEXT_SIZE: 0.95,              // Balanced, proportional font scale (0.6 to 2.0)
    FONT_FAMILY: "'RainyDisplayFont', 'RainyDisplayFontWide', 'Impact', 'Arial Black', sans-serif",
    MAX_DPR: 2.0                  // Capped for 60fps performance
  };

  /**
   * Generates organic radial vertex offsets for non-circular water droplets.
   * Simulates natural contact-angle hysteresis, gravitational teardrop sag, and rim asymmetry.
   */
  function generateOrganicVertices(baseR, randFn) {
    const numPoints = 12;
    const vertices = [];
    const a1 = 0.04 + randFn() * 0.08; // primary asymmetry
    const a2 = 0.04 + randFn() * 0.06; // elongation
    const a3 = 0.02 + randFn() * 0.04; // edge variation
    const p1 = randFn() * Math.PI * 2;
    const p2 = randFn() * Math.PI * 2;
    const p3 = randFn() * Math.PI * 2;

    for (let i = 0; i < numPoints; i++) {
      const theta = (i / numPoints) * Math.PI * 2;
      const mod = 1.0 + a1 * Math.cos(theta + p1) + a2 * Math.cos(2 * theta + p2) + a3 * Math.cos(3 * theta + p3);
      // Natural downward gravitational sag
      const sag = Math.sin(theta) > 0 ? 1.0 + 0.08 * Math.sin(theta) : 1.0;
      const r = baseR * mod * sag;
      vertices.push({
        x: Math.cos(theta) * r,
        y: Math.sin(theta) * r,
        r: r
      });
    }
    return vertices;
  }

  /**
   * Draws a closed smooth BÃ©zier spline through an array of relative vertices.
   * If stretch > 1.0, applies hydrodynamic teardrop deformation along Y:
   * upper vertices taper toward an apex, lower vertices bulbously curve.
   */
  function traceDynamicDroplet(ctx, cx, cy, vertices, stretch = 1.0) {
    const n = vertices ? vertices.length : 0;
    if (n < 3) return;

    ctx.beginPath();
    const getP = (v) => {
      let px = v.x;
      let py = v.y;
      if (stretch > 1.02) {
        if (py < 0) {
          // Upper tapered apex
          const taper = Math.max(0.38, 1.0 - (Math.abs(py) / (v.r || 10)) * 0.42);
          px *= taper / Math.sqrt(stretch);
          py *= stretch * 1.16;
        } else {
          // Lower bulbous base
          px *= Math.sqrt(stretch);
          py *= stretch * 0.90;
        }
      }
      return { x: cx + px, y: cy + py };
    };

    const pLast = getP(vertices[n - 1]);
    const p0 = getP(vertices[0]);
    ctx.moveTo((pLast.x + p0.x) * 0.5, (pLast.y + p0.y) * 0.5);

    for (let i = 0; i < n; i++) {
      const curr = getP(vertices[i]);
      const next = getP(vertices[(i + 1) % n]);
      const midX = (curr.x + next.x) * 0.5;
      const midY = (curr.y + next.y) * 0.5;
      ctx.quadraticCurveTo(curr.x, curr.y, midX, midY);
    }
    ctx.closePath();
  }

  class RainyLyricsController {
    constructor() {
      this.isOpen = false;
      this.overlay = null;
      this.canvas = null;
      this.ctx = null;
      this.baseCanvas = null;
      this.baseCtx = null;

      // Offscreen Cached Lyrics Canvases & Royal Line Items
      this.currLyricsCanvas = null;
      this.prevLyricsCanvas = null;
      this.currLineItems = [];
      this.prevLineItems = [];
      this.lyricsBounds = null;
      this.lyricsDirty = true;
      this.animFrameId = null;

      this.currentLyrics = { hasLyrics: false, isSynced: false, lines: [] };
      this.activeLineIndex = -1;
      this.previousLineIndex = -1;
      this.transitionStartTime = 0;
      this.transitionDuration = 820; // 820ms royal fluid transition with cascading stagger

      this.cursorTimer = null;
      this.exitBtnTimer = null;
      this.stormBadgeTimer = null;
      this.isHoveringTopRight = false;
      this.isDebugOpen = false;
      this.isReducedMotion = false;
      this.dpr = 1;

      // Heavy Rainstorm Mode (Shift + B)
      this.isHeavyRain = false;
      this.stormIntensity = 0.0;
      this.lastStormToggleTime = 0; // 0.0 (calm) to 1.0 (heavy storm)
      this.rainStreaks = [];
      this.lastStormToggleTime = 0;

      // Interactive Touch & Drag State
      this.draggedDrop = null;
      this.isDragging = false;
      this.dragLastPos = { x: 0, y: 0 };
      this.dragVelocity = { vx: 0, vy: 0 };
      this.dragDistSinceLastDrop = 0;

      // Simulation State
      this.staticDrops = [];
      this.slidingStreams = [];
      this.splashRipples = [];
      this.fogPlumes = [];
      this.rainSpawnTimer = 0;
      this.lastTimestamp = 0;
      this.globalTime = 0;

      // Bound handlers
      this.boundOnKeyDown = this.onKeyDown.bind(this);
      this.boundOnMouseMove = this.onMouseMove.bind(this);
      this.boundOnPointerDown = this.onPointerDown.bind(this);
      this.boundOnPointerMove = this.onPointerMove.bind(this);
      this.boundOnPointerUp = this.onPointerUp.bind(this);
      this.boundOnResize = this.onResize.bind(this);
      this.boundOnVisibilityChange = this.onVisibilityChange.bind(this);
      this.renderLoop = this.renderLoop.bind(this);
    }

    /**
     * Ensure overlay, canvas and debug UI exist in DOM
     */
    ensureDOM() {
      if (this.overlay) return;

      let overlay = document.getElementById('rainyLyricsOverlay');
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'rainyLyricsOverlay';
        overlay.className = 'rainy-lyrics-overlay';
        overlay.innerHTML = `
          <canvas id="rainyLyricsCanvas" class="rainy-lyrics-canvas"></canvas>
          <div id="rainyStormBadge" class="rainy-storm-badge">â›ˆ Heavy Rain (Shift + B)</div>
          <div id="rainyTopRightZone" class="rainy-top-right-zone">
            <button id="rainyExitBtn" class="rainy-exit-btn" title="Exit Rainy Mode (B / Esc)" aria-label="Exit Rainy Mode">
              <img src="assets/LibraryItems/SongFullView.svg" alt="Exit" />
            </button>
          </div>
          <!-- Real-Time Tuning Panel (Toggle with 'D') -->
          <div id="rainyDebugPanel" class="rainy-debug-panel">
            <div class="rainy-debug-header">
              <span>Rainy Window Tuner</span>
              <span style="font-size: 10px; color: #8E8E93;">[D] Close</span>
            </div>
            <div class="rainy-debug-row">
              <div class="rainy-debug-label">
                <span>Neon Glow</span>
                <span id="dbgValGlow">${Math.round(RAINY_CONFIG.GLOW_STRENGTH * 100)}%</span>
              </div>
              <input type="range" class="rainy-debug-slider" id="dbgSliderGlow" min="0" max="1" step="0.02" value="${RAINY_CONFIG.GLOW_STRENGTH}">
            </div>
            <div class="rainy-debug-row">
              <div class="rainy-debug-label">
                <span>Living Fog</span>
                <span id="dbgValFog">${Math.round(RAINY_CONFIG.FOG_AMOUNT * 100)}%</span>
              </div>
              <input type="range" class="rainy-debug-slider" id="dbgSliderFog" min="0" max="1" step="0.02" value="${RAINY_CONFIG.FOG_AMOUNT}">
            </div>
            <div class="rainy-debug-row">
              <div class="rainy-debug-label">
                <span>Drop Density</span>
                <span id="dbgValDensity">${RAINY_CONFIG.DROP_DENSITY.toFixed(1)}x</span>
              </div>
              <input type="range" class="rainy-debug-slider" id="dbgSliderDensity" min="0.2" max="2.5" step="0.1" value="${RAINY_CONFIG.DROP_DENSITY}">
            </div>
            <div class="rainy-debug-row">
              <div class="rainy-debug-label">
                <span>Drop Size</span>
                <span id="dbgValSize">${RAINY_CONFIG.DROP_SIZE.toFixed(1)}x</span>
              </div>
              <input type="range" class="rainy-debug-slider" id="dbgSliderSize" min="0.5" max="2.0" step="0.1" value="${RAINY_CONFIG.DROP_SIZE}">
            </div>
            <div class="rainy-debug-row">
              <div class="rainy-debug-label">
                <span>Sliding Streams</span>
                <span id="dbgValTrails">${RAINY_CONFIG.TRAIL_COUNT}</span>
              </div>
              <input type="range" class="rainy-debug-slider" id="dbgSliderTrails" min="0" max="5" step="1" value="${RAINY_CONFIG.TRAIL_COUNT}">
            </div>
            <div class="rainy-debug-row">
              <div class="rainy-debug-label">
                <span>Rain Frequency</span>
                <span id="dbgValRain">${RAINY_CONFIG.RAIN_RATE.toFixed(1)}x</span>
              </div>
              <input type="range" class="rainy-debug-slider" id="dbgSliderRain" min="0.2" max="2.5" step="0.1" value="${RAINY_CONFIG.RAIN_RATE}">
            </div>
            <div class="rainy-debug-row">
              <div class="rainy-debug-label">
                <span>Text Scale</span>
                <span id="dbgValText">${Math.round(RAINY_CONFIG.TEXT_SIZE * 100)}%</span>
              </div>
              <input type="range" class="rainy-debug-slider" id="dbgSliderText" min="0.6" max="2.0" step="0.05" value="${RAINY_CONFIG.TEXT_SIZE}">
            </div>
          </div>
        `;
        document.body.appendChild(overlay);
      }

      this.overlay = overlay;
      this.canvas = overlay.querySelector('#rainyLyricsCanvas');
      this.ctx = this.canvas.getContext('2d');
      this.exitBtn = overlay.querySelector('#rainyExitBtn');
      this.topRightZone = overlay.querySelector('#rainyTopRightZone');
      this.debugPanel = overlay.querySelector('#rainyDebugPanel');
      this.stormBadge = overlay.querySelector('#rainyStormBadge');

      if (this.exitBtn) {
        this.exitBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.close();
        });
      }

      if (this.topRightZone) {
        this.topRightZone.addEventListener('mouseenter', () => {
          this.isHoveringTopRight = true;
          if (this.exitBtn) this.exitBtn.classList.add('visible');
        });
        this.topRightZone.addEventListener('mouseleave', () => {
          this.isHoveringTopRight = false;
          if (this.exitBtn) this.exitBtn.classList.remove('visible');
        });
      }

      // Pointer & Touch Interaction
      if (this.canvas) {
        this.canvas.addEventListener('pointerdown', this.boundOnPointerDown);
        this.canvas.addEventListener('pointermove', this.boundOnPointerMove);
        this.canvas.addEventListener('pointerup', this.boundOnPointerUp);
        this.canvas.addEventListener('pointercancel', this.boundOnPointerUp);
      }

      this.wireDebugSliders();
    }

    wireDebugSliders() {
      const panel = this.debugPanel;
      if (!panel) return;

      const bind = (id, prop, valId, format) => {
        const input = panel.querySelector('#' + id);
        const valSpan = panel.querySelector('#' + valId);
        if (input && valSpan) {
          input.addEventListener('input', (e) => {
            const v = parseFloat(e.target.value);
            RAINY_CONFIG[prop] = v;
            valSpan.textContent = format(v);
            if (prop === 'GLOW_STRENGTH' || prop === 'TEXT_SIZE') {
              this.lyricsDirty = true;
            }
            if (prop === 'DROP_DENSITY' || prop === 'TRAIL_COUNT' || prop === 'DROP_SIZE') {
              this.initSimulation();
            }
          });
        }
      };

      bind('dbgSliderGlow', 'GLOW_STRENGTH', 'dbgValGlow', v => `${Math.round(v * 100)}%`);
      bind('dbgSliderFog', 'FOG_AMOUNT', 'dbgValFog', v => `${Math.round(v * 100)}%`);
      bind('dbgSliderDensity', 'DROP_DENSITY', 'dbgValDensity', v => `${v.toFixed(1)}x`);
      bind('dbgSliderSize', 'DROP_SIZE', 'dbgValSize', v => `${v.toFixed(1)}x`);
      bind('dbgSliderTrails', 'TRAIL_COUNT', 'dbgValTrails', v => `${v}`);
      bind('dbgSliderRain', 'RAIN_RATE', 'dbgValRain', v => `${v.toFixed(1)}x`);
      bind('dbgSliderText', 'TEXT_SIZE', 'dbgValText', v => `${Math.round(v * 100)}%`);
    }

    showStormBadge(msg) {
      if (!this.stormBadge) {
        this.stormBadge = document.getElementById('rainyStormBadge');
      }
      if (!this.stormBadge) return;
      this.stormBadge.textContent = msg;
      this.stormBadge.classList.add('visible');
      clearTimeout(this.stormBadgeTimer);
      this.stormBadgeTimer = setTimeout(() => {
        if (this.stormBadge) this.stormBadge.classList.remove('visible');
      }, 2300);
    }

    toggleHeavyRain() {
      const now = performance.now();
      if (this.lastStormToggleTime && (now - this.lastStormToggleTime < 350)) {
        return;
      }
      this.lastStormToggleTime = now;
      this.isHeavyRain = !this.isHeavyRain;
      this.showStormBadge(this.isHeavyRain ? 'â›ˆ Heavy Rain: Active' : 'ðŸŒ§ Rain Calming Down...');
    }

    checkReducedMotion() {
      this.isReducedMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    }

    /**
     * Initialize resolution and offscreen composite canvases
     */
    initCanvases() {
      this.dpr = Math.min(window.devicePixelRatio || 1, RAINY_CONFIG.MAX_DPR);
      const w = Math.round(window.innerWidth * this.dpr);
      const h = Math.round(window.innerHeight * this.dpr);

      this.canvas.width = w;
      this.canvas.height = h;

      if (!this.baseCanvas) {
        this.baseCanvas = document.createElement('canvas');
      }
      this.baseCanvas.width = w;
      this.baseCanvas.height = h;
      this.baseCtx = this.baseCanvas.getContext('2d');

      if (!this.currLyricsCanvas) {
        this.currLyricsCanvas = document.createElement('canvas');
      }
      this.currLyricsCanvas.width = w;
      this.currLyricsCanvas.height = h;

      if (!this.prevLyricsCanvas) {
        this.prevLyricsCanvas = document.createElement('canvas');
      }
      this.prevLyricsCanvas.width = w;
      this.prevLyricsCanvas.height = h;

      this.lyricsDirty = true;
    }

    /**
     * Master initialization of droplets, streams, and living fog
     */
    initSimulation() {
      const w = this.canvas.width;
      const h = this.canvas.height;
      if (!w || !h) return;

      const density = RAINY_CONFIG.DROP_DENSITY;
      const sizeMod = RAINY_CONFIG.DROP_SIZE * this.dpr;

      this.staticDrops = [];
      this.slidingStreams = [];
      this.splashRipples = [];
      this.fogPlumes = [];
      this.rainStreaks = [];

      let seed = 49217;
      const rand = () => {
        seed = (seed * 16807) % 2147483647;
        return (seed - 1) / 2147483646;
      };

      // 1. Living Atmospheric Mist Plumes (wind simulation)
      const plumeCount = 16;
      for (let i = 0; i < plumeCount; i++) {
        const nx = 0.08 + (i % 4) * 0.24 + (rand() - 0.5) * 0.12;
        const ny = 0.12 + Math.floor(i / 4) * 0.24 + (rand() - 0.5) * 0.12;
        this.fogPlumes.push({
          x: nx * w,
          y: ny * h,
          baseY: ny * h,
          r: (Math.min(w, h) * (0.35 + rand() * 0.25)),
          vx: (12 + rand() * 18) * this.dpr,
          baseAlpha: 0.18 + rand() * 0.18,
          phase: rand() * Math.PI * 2,
          pulseSpeed: 0.3 + rand() * 0.4
        });
      }

      // 2. Micro Condensation Vapor Beads (frosted glass surface texture)
      const microCount = Math.round(380 * density);
      for (let i = 0; i < microCount; i++) {
        const nx = 0.02 + rand() * 0.96;
        const ny = 0.02 + rand() * 0.96;
        const r = (0.9 + rand() * 1.8) * sizeMod;
        this.staticDrops.push({
          x: nx * w,
          y: ny * h,
          baseX: nx * w,
          baseY: ny * h,
          r: r,
          vertices: generateOrganicVertices(r, rand),
          specAngle: -0.70 - rand() * 0.25,
          isMicro: true,
          jitterPhase: rand() * Math.PI * 2,
          slipRemaining: 0,
          slipSpeed: 0,
          nextSlipTimer: 4.0 + rand() * 8.0
        });
      }

      // 3. Medium Organic Droplets (3.5px - 8.5px)
      const medCount = Math.round(60 * density);
      for (let i = 0; i < medCount; i++) {
        const nx = 0.08 + rand() * 0.84;
        const ny = 0.10 + rand() * 0.80;
        const r = (3.5 + rand() * 5.2) * sizeMod;
        this.staticDrops.push({
          x: nx * w,
          y: ny * h,
          baseX: nx * w,
          baseY: ny * h,
          r: r,
          vertices: generateOrganicVertices(r, rand),
          specAngle: -0.72 - rand() * 0.20,
          isMicro: false,
          jitterPhase: rand() * Math.PI * 2,
          slipRemaining: 0,
          slipSpeed: 0,
          nextSlipTimer: 1.5 + rand() * 4.5
        });
      }

      // 4. Large Juicy Water Droplets (10px - 19px) - rich optical presence
      const largeCount = Math.round(18 * density);
      for (let i = 0; i < largeCount; i++) {
        const nx = 0.14 + rand() * 0.72;
        const ny = 0.15 + rand() * 0.70;
        const r = (10.0 + rand() * 9.0) * sizeMod;
        this.staticDrops.push({
          x: nx * w,
          y: ny * h,
          baseX: nx * w,
          baseY: ny * h,
          r: r,
          vertices: generateOrganicVertices(r, rand),
          specAngle: -0.75,
          isMicro: false,
          jitterPhase: rand() * Math.PI * 2,
          slipRemaining: 0,
          slipSpeed: 0,
          nextSlipTimer: 2.0 + rand() * 5.0
        });
      }

      // 5. Dedicated Central Lyric Droplets (ensuring water breaks over text)
      const textDropsCount = Math.round(40 * density);
      for (let i = 0; i < textDropsCount; i++) {
        const nx = 0.25 + rand() * 0.50;
        const ny = 0.28 + rand() * 0.44;
        const r = (3.0 + rand() * 7.0) * sizeMod;
        this.staticDrops.push({
          x: nx * w,
          y: ny * h,
          baseX: nx * w,
          baseY: ny * h,
          r: r,
          vertices: generateOrganicVertices(r, rand),
          specAngle: -0.72 - rand() * 0.20,
          isMicro: r < 3.0 * this.dpr,
          jitterPhase: rand() * Math.PI * 2,
          slipRemaining: 0,
          slipSpeed: 0,
          nextSlipTimer: 1.2 + rand() * 3.8
        });
      }

      // 6. Sliding Rivulets with Real-World Timelines & Authentic Kinematics
      const streamColumns = [0.20, 0.48, 0.74, 0.35, 0.62];
      const count = Math.min(RAINY_CONFIG.TRAIL_COUNT, streamColumns.length);

      for (let i = 0; i < count; i++) {
        const startX = streamColumns[i] * w;
        const startY = ((i * 0.22 + 0.08) % 0.85) * h;
        const dropR = (5.5 + (i % 2 === 0 ? 2.5 : 1.2)) * sizeMod;
        const isCascade = (i === 1 || i === 3);
        const stream = this.createSlidingStream(startX, startY, dropR, isCascade ? 'continuous' : 'slip');
        this.slidingStreams.push(stream);
      }
    }

    /**
     * Creates a sliding stream with natural gravity trajectory and smooth fluid motion.
     * Real stick-slip hydrodynamics with fluid velocity and discrete organic deflection angles.
     */
    createSlidingStream(startX, startY, r, streamType = null) {
      const isContinuous = streamType ? (streamType === 'continuous') : (Math.random() < 0.35);
      const initialVy = isContinuous ? (360 + Math.random() * 180) * this.dpr : 0;

      return {
        x: startX,
        y: startY,
        startX: startX,
        curOffsetX: 0,
        r: r,
        vertices: generateOrganicVertices(r, Math.random),
        trailW: Math.max(2.4 * this.dpr, r * 0.52),
        pathPoints: [{ x: startX, y: startY, alpha: 1.0, time: this.globalTime }],
        remnants: [],

        // Real-World Trajectory Mechanics
        isContinuous: isContinuous,
        mode: isContinuous ? 'stream' : 'pinned',
        pinnedTimer: 0.12 + Math.random() * 0.35,

        // Discrete organic heading deflection
        headingAngle: (Math.random() - 0.5) * 0.12, // -3.5 to +3.5 degrees
        segmentDistRemaining: (25 + Math.random() * 55) * this.dpr,
        vy: initialVy,
        peakVy: (460 + Math.random() * 240) * this.dpr,
        stretch: 1.0
      };
    }

    depositRemnant(stream, sizeMod) {
      const remR = (1.0 + Math.random() * 1.8) * sizeMod;
      stream.remnants.push({
        x: stream.x + (Math.random() - 0.5) * stream.trailW * 0.35,
        y: stream.y - 3 * this.dpr,
        r: remR,
        vertices: generateOrganicVertices(remR, Math.random),
        specAngle: -0.75,
        isMicro: false
      });
      if (stream.remnants.length > 25) {
        stream.remnants.shift();
      }
    }

    checkStreamCollisions(stream) {
      for (let i = this.staticDrops.length - 1; i >= 0; i--) {
        const sd = this.staticDrops[i];
        const dist = Math.hypot(sd.x - stream.x, sd.y - stream.y);
        if (dist < stream.r + sd.r) {
          // Volume combines: V = r1^3 + r2^3
          const w1 = Math.pow(stream.r, 3);
          const w2 = Math.pow(sd.r, 3);
          stream.r = Math.min(16 * this.dpr, Math.cbrt(w1 + w2));
          stream.vertices = generateOrganicVertices(stream.r, Math.random);
          stream.trailW = Math.max(stream.trailW, stream.r * 0.55);

          // Lateral nudge toward absorbed drop center
          stream.curOffsetX += (sd.x - stream.x) * 0.32;
          this.staticDrops.splice(i, 1);

          // Speed boost from absorbed fluid mass & surface energy release
          stream.vy = Math.min(750 * this.dpr, stream.vy + (80 + Math.random() * 80) * this.dpr);

          // Heavy droplet cascade transition
          if (stream.r > 7.5 * this.dpr && !stream.isContinuous) {
            stream.isContinuous = true;
            stream.mode = 'stream';
          }
        }
      }
    }

    /**
     * Retrieve and parse current song's lyrics
     */
    loadTrackLyrics() {
      const track = window.player ? window.player.currentTrack : null;
      if (!track) {
        this.currentLyrics = { hasLyrics: false, isSynced: false, lines: [] };
        this.lyricsDirty = true;
        return;
      }

      let synced = null;
      if (typeof window.getTrackSynchronizedLyrics === 'function') {
        synced = window.getTrackSynchronizedLyrics(track);
      }

      if (synced && synced.isSynced && Array.isArray(synced.lines) && synced.lines.length > 0) {
        this.currentLyrics = { hasLyrics: true, isSynced: true, lines: synced.lines };
        this.lyricsDirty = true;
        return;
      }

      // Plain text fallback
      if (track.lyrics && typeof track.lyrics === 'string' && track.lyrics.trim().length > 0) {
        const rawLines = track.lyrics.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
        if (rawLines.length > 0) {
          const dur = (window.player?.audio?.duration) || track.duration || 180;
          const interval = (dur * 0.9) / rawLines.length;
          const estimatedLines = rawLines.map((text, i) => ({
            time: i * interval,
            text: text.replace(/\[\d{1,2}:\d{2}(?:\.\d{1,3})?\]/g, '').trim()
          })).filter(l => l.text.length > 0);

          this.currentLyrics = { hasLyrics: true, isSynced: false, lines: estimatedLines };
          this.lyricsDirty = true;
          return;
        }
      }

      this.currentLyrics = { hasLyrics: false, isSynced: false, lines: [] };
      this.lyricsDirty = true;
    }

    /**
     * Real Water Coalescence Physics & Living Droplet Motion
     */
    updateDropletPhysics(dt) {
      if (this.isReducedMotion) dt *= 0.35;
      const drops = this.staticDrops;
      const time = this.globalTime;

      // 1. Pairwise Coalescence Detection
      for (let i = 0; i < drops.length; i++) {
        const d1 = drops[i];
        if (!d1 || d1.isMicro) continue;

        for (let j = i + 1; j < drops.length; j++) {
          const d2 = drops[j];
          if (!d2 || d2.isMicro) continue;

          const dx = d2.x - d1.x;
          const dy = d2.y - d1.y;
          const dist = Math.hypot(dx, dy);
          const touchDist = (d1.r + d2.r) * 0.96;

          if (dist < touchDist) {
            // MERGE: Volume V = r1^3 + r2^3 (Center-of-mass liquid coalescence)
            const w1 = Math.pow(d1.r, 3);
            const w2 = Math.pow(d2.r, 3);
            const newR = Math.cbrt(w1 + w2);
            d1.x = (d1.x * w1 + d2.x * w2) / (w1 + w2);
            d1.y = (d1.y * w1 + d2.y * w2) / (w1 + w2);
            d1.r = newR;
            d1.vertices = generateOrganicVertices(d1.r, Math.random);

            // Immediate downward surge from surface tension release
            d1.y += (2.5 + Math.random() * 3.5) * this.dpr;
            d1.baseX = d1.x;
            d1.baseY = d1.y;

            // Remove d2
            drops.splice(j, 1);
            j--;

            // Three-tier post-collision dynamics:
            if (d1.r > 7.8 * this.dpr) {
              // Heavy merged droplet: gravity breaks surface pinning -> transforms into cascading stream!
              const targetStreams = Math.min(9, RAINY_CONFIG.TRAIL_COUNT + (this.stormIntensity > 0.1 ? 4 : 1));
              if (this.slidingStreams.length < targetStreams) {
                const newStream = this.createSlidingStream(d1.x, d1.y, d1.r, 'continuous');
                newStream.vy = (420 + Math.random() * 200) * this.dpr;
                this.slidingStreams.push(newStream);
                drops.splice(i, 1);
                i--;
                break;
              } else {
                d1.slipRemaining = (35 + Math.random() * 45) * this.dpr;
                d1.slipSpeed = (220 + Math.random() * 120) * this.dpr;
              }
            } else if (d1.r > 4.6 * this.dpr) {
              // Medium merge: greater speed downward slip
              d1.slipRemaining = (18 + Math.random() * 28) * this.dpr;
              d1.slipSpeed = (150 + Math.random() * 90) * this.dpr;
            } else {
              // Small merge: subtle downward nudge
              d1.slipRemaining = (8 + Math.random() * 14) * this.dpr;
              d1.slipSpeed = (70 + Math.random() * 40) * this.dpr;
            }
          }
        }
      }

      // 2. Living Micro-Motion & Spontaneous Downward Slips
      for (let i = 0; i < drops.length; i++) {
        const d = drops[i];

        // Organic micro-tremble on glass (air currents & acoustic vibration)
        const trembleX = Math.sin(time * 3.8 + d.jitterPhase) * (0.45 * this.dpr);
        const trembleY = Math.cos(time * 3.2 + d.jitterPhase) * (0.35 * this.dpr);

        // Periodic spontaneous slip (gravity overcoming surface pinning)
        d.nextSlipTimer -= dt;
        if (d.nextSlipTimer <= 0) {
          d.nextSlipTimer = 1.0 + Math.random() * 3.2;
          if (!d.isMicro && Math.random() < 0.65) {
            d.slipRemaining = (14 + Math.random() * 26) * this.dpr;
            d.slipSpeed = (120 + Math.random() * 80) * this.dpr;
          }
        }

        // Apply active downward slip smoothly
        if (d.slipRemaining > 0) {
          const step = Math.min(d.slipRemaining, d.slipSpeed * dt);
          d.baseY += step;
          d.slipRemaining -= step;
        }

        d.x = d.baseX + trembleX;
        d.y = d.baseY + trembleY;
      }
    }

    /**
     * Dynamic falling rain: impacts, real-time storm intensity, and gradual calm-down
     */
    updateRainLifecycle(dt) {
      if (this.isReducedMotion) dt *= 0.35;
      const w = this.canvas.width;
      const h = this.canvas.height;
      const sizeMod = RAINY_CONFIG.DROP_SIZE * this.dpr;

      // Heavy Rain Storm Mode Transitions
      if (this.isHeavyRain) {
        this.stormIntensity = Math.min(1.0, this.stormIntensity + dt / 1.0); // 1.0s fast surge into heavy rain!
      } else {
        this.stormIntensity = Math.max(0.0, this.stormIntensity - dt / 4.2); // 4.2s gradual calm-down!
      }

      // Rain Pelting Rate on Window Pane
      const baseRate = RAINY_CONFIG.RAIN_RATE;
      const stormMultiplier = 1.0 + this.stormIntensity * 6.5; // Up to 7.5x pelting intensity
      const rainRate = baseRate * stormMultiplier;
      this.rainSpawnTimer += dt;
      const spawnInterval = Math.max(0.016, 0.22 / rainRate);

      if (this.rainSpawnTimer >= spawnInterval) {
        this.rainSpawnTimer = 0;

        // In heavy storm, spawn multiple raindrops in quick succession across the pane
        const dropsToSpawn = this.stormIntensity > 0.4 ? (Math.random() < 0.65 ? 2 : 3) : 1;

        for (let b = 0; b < dropsToSpawn; b++) {
          const nx = 0.04 + Math.random() * 0.92;
          const ny = 0.05 + Math.random() * 0.90;
          const r = (1.4 + Math.random() * (4.2 + this.stormIntensity * 3.0)) * sizeMod;

          const newDrop = {
            x: nx * w,
            y: ny * h,
            baseX: nx * w,
            baseY: ny * h,
            r: r,
            vertices: generateOrganicVertices(r, Math.random),
            specAngle: -0.72 - Math.random() * 0.20,
            isMicro: r < 2.8 * this.dpr,
            jitterPhase: Math.random() * Math.PI * 2,
            slipRemaining: 0,
            slipSpeed: 0,
            nextSlipTimer: 1.2 + Math.random() * 3.5
          };

          // Check if new drop hits an existing drop
          let absorbed = false;
          for (let i = 0; i < this.staticDrops.length; i++) {
            const ex = this.staticDrops[i];
            const dist = Math.hypot(ex.x - newDrop.x, ex.y - newDrop.y);
            if (dist < (ex.r + newDrop.r) * 1.02) {
              const w1 = Math.pow(ex.r, 3);
              const w2 = Math.pow(newDrop.r, 3);
              ex.r = Math.cbrt(w1 + w2);
              ex.vertices = generateOrganicVertices(ex.r, Math.random);
              ex.baseY += (3.5 + Math.random() * 4.5) * this.dpr;
              ex.y = ex.baseY;

              if (ex.r > 7.8 * this.dpr && this.slidingStreams.length < 8) {
                const stream = this.createSlidingStream(ex.x, ex.y, ex.r, 'continuous');
                stream.vy = (420 + Math.random() * 200) * this.dpr;
                this.slidingStreams.push(stream);
                this.staticDrops.splice(i, 1);
              } else {
                ex.slipRemaining = (16 + Math.random() * 28) * this.dpr;
                ex.slipSpeed = (140 + Math.random() * 90) * this.dpr;
              }
              absorbed = true;
              break;
            }
          }

          if (!absorbed) {
            this.staticDrops.push(newDrop);

            // Impact ripple ring on glass
            this.splashRipples.push({
              x: newDrop.x,
              y: newDrop.y,
              maxR: r * (2.8 + this.stormIntensity * 2.2),
              currentR: r * 0.35,
              alpha: 0.60 + this.stormIntensity * 0.35,
              life: 0.32
            });

            if (this.staticDrops.length > (550 + Math.round(this.stormIntensity * 250))) {
              this.staticDrops.splice(0, 10);
            }
          }
        }
      }

      // Update splash ripples
      for (let i = this.splashRipples.length - 1; i >= 0; i--) {
        const rip = this.splashRipples[i];
        rip.life -= dt;
        rip.currentR += (rip.maxR - rip.currentR) * (dt * 12);
        rip.alpha = Math.max(0, rip.life / 0.32);
        if (rip.life <= 0) {
          this.splashRipples.splice(i, 1);
        }
      }

      // Update Fast Falling Rain Streaks (Outside window during storm)
      if (this.stormIntensity > 0.01) {
        const targetCount = Math.round(85 * this.stormIntensity);
        while (this.rainStreaks.length < targetCount) {
          this.rainStreaks.push({
            x: Math.random() * (w + 250 * this.dpr) - 120 * this.dpr,
            y: -80 * this.dpr - Math.random() * 180 * this.dpr,
            len: (70 + Math.random() * 110) * this.dpr,
            speed: (1300 + Math.random() * 800) * this.dpr,
            windAngle: 0.20 + Math.random() * 0.08, // ~13 degrees wind slant
            alpha: 0.25 + Math.random() * 0.45,
            width: (1.0 + Math.random() * 1.4) * this.dpr
          });
        }

        for (let i = this.rainStreaks.length - 1; i >= 0; i--) {
          const s = this.rainStreaks[i];
          s.y += s.speed * dt;
          s.x -= s.speed * dt * Math.tan(s.windAngle);

          if (s.y > h + 120 * this.dpr || s.x < -150 * this.dpr) {
            if (this.rainStreaks.length > targetCount) {
              this.rainStreaks.splice(i, 1);
            } else {
              s.y = -70 * this.dpr;
              s.x = Math.random() * (w + 250 * this.dpr) - 60 * this.dpr;
              s.speed = (1300 + Math.random() * 800) * this.dpr;
            }
          }
        }
      } else {
        this.rainStreaks = [];
      }
    }

    /**
     * Real-World Droplet Physics: Fluid Stick-Slip, Natural Angular Curvature & Cascading Streams
     */
    updateSlidingStreams(dt) {
      if (this.isReducedMotion) dt *= 0.35;
      const w = this.canvas.width;
      const h = this.canvas.height;
      const sizeMod = RAINY_CONFIG.DROP_SIZE * this.dpr;
      const time = this.globalTime;

      // Ensure appropriate number of active streams (increases significantly in storm)
      const baseStreams = RAINY_CONFIG.TRAIL_COUNT;
      const stormExtra = Math.round(this.stormIntensity * 4); // Up to 7-8 active streams in storm
      const targetStreams = Math.min(9, baseStreams + stormExtra);
      while (this.slidingStreams.length < targetStreams) {
        const nextX = (0.08 + Math.random() * 0.84) * w;
        this.slidingStreams.push(this.createSlidingStream(nextX, -25 * this.dpr, (5.0 + Math.random() * 3.5) * sizeMod, 'continuous'));
      }

      this.slidingStreams.forEach((stream, idx) => {
        // TYPE A: CONTINUOUS CASCADING RIVULET
        if (stream.isContinuous || stream.mode === 'stream') {
          // Continuous fluid stream descent (faster in storm)
          const baseSpeed = (360 + this.stormIntensity * 240) * this.dpr;
          stream.vy += (baseSpeed - stream.vy) * (dt * 5.0);

          // Real-World Trajectory: subtle piecewise deviations (NOT smooth sine-wave curves)
          const angle = stream.headingAngle || 0;
          const step = stream.vy * dt;
          const dy = step * Math.cos(angle);
          const dx = step * Math.sin(angle);

          stream.curOffsetX += dx;
          // Gentle spring keeps rivulet in its vertical glass lane
          const corridorMax = 24 * this.dpr;
          if (Math.abs(stream.curOffsetX) > corridorMax) {
            stream.curOffsetX *= 0.985;
          }
          stream.x = stream.startX + stream.curOffsetX;
          stream.y += dy;

          // When segment distance elapses, pick subtle new micro-deflection (-4 to +4 degrees)
          stream.segmentDistRemaining = (stream.segmentDistRemaining || 40 * this.dpr) - dy;
          if (stream.segmentDistRemaining <= 0) {
            stream.segmentDistRemaining = (28 + Math.random() * 55) * this.dpr;
            const bias = -stream.curOffsetX / (20 * this.dpr);
            stream.headingAngle = (Math.random() - 0.5) * 0.14 + bias * 0.04;
          }

          // Dynamic teardrop stretch based on velocity
          stream.stretch = 1.0 + Math.min(0.42, stream.vy / (800 * this.dpr));

          // Wake path recording
          const lastPt = stream.pathPoints[stream.pathPoints.length - 1];
          if (!lastPt || Math.hypot(stream.x - lastPt.x, stream.y - lastPt.y) > 6 * this.dpr) {
            stream.pathPoints.push({ x: stream.x, y: stream.y, alpha: 1.0, time: time });
            if (stream.pathPoints.length > 28) stream.pathPoints.shift();
          }

          // Check collisions with stationary drops
          this.checkStreamCollisions(stream);

          // Occasional remnant bead
          if (Math.random() < 0.07) {
            this.depositRemnant(stream, sizeMod);
          }
        }
        // TYPE B: STICK-SLIP WATER DROPLET (Real water on window)
        else if (stream.mode === 'pinned') {
          stream.pinnedTimer -= dt;
          // Micro-tremble on glass
          const tremble = Math.sin(time * 6.0 + (stream.phase || 0)) * (0.25 * this.dpr);
          stream.x = stream.startX + stream.curOffsetX + tremble;
          stream.vy = 0;
          stream.stretch = 1.0;

          // When pinned timer expires -> BREAK FREE AND SLIP!
          if (stream.pinnedTimer <= 0) {
            stream.mode = 'slip';
            stream.slipTotalDist = (35 + Math.random() * 75) * this.dpr; // 35px - 110px slip distance
            stream.slipDistRemaining = stream.slipTotalDist;
            const bias = -stream.curOffsetX / (24 * this.dpr);
            stream.slipAngle = (Math.random() - 0.5) * 0.16 + bias * 0.04;
            stream.peakVy = (480 + Math.random() * 240) * this.dpr;
          }
        } else if (stream.mode === 'slip') {
          // In slip mode: fluid acceleration and smooth viscous deceleration (ease-out)
          if (!stream.slipTotalDist || stream.slipTotalDist <= 0) {
            stream.slipTotalDist = (35 + Math.random() * 75) * this.dpr;
            stream.slipDistRemaining = stream.slipTotalDist;
          }
          const progress = 1.0 - Math.max(0, Math.min(1.0, stream.slipDistRemaining / stream.slipTotalDist));
          const speedFactor = Math.sin(Math.pow(progress, 0.6) * Math.PI);
          const currentSpeed = Math.max(140 * this.dpr, (stream.peakVy || (500 * this.dpr)) * Math.max(0.25, speedFactor));

          const step = currentSpeed * dt;
          const actualStep = Math.min(stream.slipDistRemaining, step);

          const angle = stream.slipAngle || 0;
          const dx = Math.sin(angle) * actualStep;
          const dy = Math.cos(angle) * actualStep;

          stream.curOffsetX += dx;
          stream.x = stream.startX + stream.curOffsetX;
          stream.y += dy;
          stream.vy = currentSpeed;
          stream.slipDistRemaining -= actualStep;

          // Dynamic teardrop stretch based on velocity
          stream.stretch = 1.0 + Math.min(0.42, currentSpeed / (700 * this.dpr));

          // Wake recording during slip
          const lastPt = stream.pathPoints[stream.pathPoints.length - 1];
          if (!lastPt || Math.hypot(stream.x - lastPt.x, stream.y - lastPt.y) > 6 * this.dpr) {
            stream.pathPoints.push({ x: stream.x, y: stream.y, alpha: 1.0, time: time });
            if (stream.pathPoints.length > 28) stream.pathPoints.shift();
          }

          // Absorb droplets along slip path
          this.checkStreamCollisions(stream);

          // Slip completed! Drop catches on surface tension
          if (stream.slipDistRemaining <= 0) {
            stream.mode = 'pinned';
            stream.pinnedTimer = 0.12 + Math.random() * 0.38; // Short rest
            stream.stretch = 1.0;
            this.depositRemnant(stream, sizeMod);
          }
        }

        // Bottom boundary recycling
        if (stream.y > h + 30 * this.dpr) {
          if (this.slidingStreams.length > RAINY_CONFIG.TRAIL_COUNT && this.stormIntensity < 0.3) {
            this.slidingStreams.splice(idx, 1);
          } else {
            const nextX = (0.08 + Math.random() * 0.84) * w;
            const fresh = this.createSlidingStream(nextX, -25 * this.dpr, (5.0 + Math.random() * 2.8) * sizeMod);
            Object.assign(stream, fresh);
          }
        }
      });

      // Fade wake paths smoothly over time
      this.slidingStreams.forEach(stream => {
        for (let i = stream.pathPoints.length - 1; i >= 0; i--) {
          const pt = stream.pathPoints[i];
          const age = time - pt.time;
          pt.alpha = Math.max(0, 1.0 - age / 3.8); // 3.8-second natural wake persistence
          if (pt.alpha <= 0.02 && stream.pathPoints.length > 3) {
            stream.pathPoints.splice(i, 1);
          }
        }
      });

      // Also fade wake paths on active dragged drop
      if (this.draggedDrop && this.draggedDrop.pathPoints) {
        for (let i = this.draggedDrop.pathPoints.length - 1; i >= 0; i--) {
          const pt = this.draggedDrop.pathPoints[i];
          const age = time - pt.time;
          pt.alpha = Math.max(0, 1.0 - age / 3.8);
          if (pt.alpha <= 0.02 && this.draggedDrop.pathPoints.length > 3) {
            this.draggedDrop.pathPoints.splice(i, 1);
          }
        }
      }
    }

    /**
     * Update living atmospheric fog currents
     */
    updateFogWind(dt) {
      if (this.isReducedMotion) dt *= 0.3;
      const w = this.canvas.width;
      const h = this.canvas.height;
      this.globalTime += dt;

      const windMult = 1.0 + this.stormIntensity * 1.8;

      this.fogPlumes.forEach(p => {
        p.x += p.vx * windMult * dt;
        p.y = p.baseY + Math.sin(this.globalTime * 0.40 + p.phase) * (18 * this.dpr);
        p.alpha = Math.max(0.08, Math.min(0.48, p.baseAlpha + Math.sin(this.globalTime * p.pulseSpeed + p.phase) * 0.08 + this.stormIntensity * 0.12));

        if (p.x > w + p.r) {
          p.x = -p.r;
          p.baseY = (0.10 + Math.random() * 0.78) * h;
        }
      });
    }

    /**
     * Format active line into a compact stacked block (1-3 words per line)
     */
    formatStackedLyricLines(rawText) {
      const words = rawText.trim().toUpperCase().split(/\s+/).filter(Boolean);
      if (words.length === 0) return [];

      if (words.length === 1) return [words[0]];
      if (words.length === 2) return [words[0], words[1]];
      if (words.length === 3) return [words[0], words[1], words[2]];
      if (words.length === 4) return [`${words[0]} ${words[1]}`, `${words[2]} ${words[3]}`];
      if (words.length === 5) return [`${words[0]} ${words[1]}`, words[2], `${words[3]} ${words[4]}`];
      if (words.length === 6) return [`${words[0]} ${words[1]}`, `${words[2]} ${words[3]}`, `${words[4]} ${words[5]}`];

      const chunk = Math.ceil(words.length / 3);
      return [
        words.slice(0, chunk).join(' '),
        words.slice(chunk, chunk * 2).join(' '),
        words.slice(chunk * 2).join(' ')
      ];
    }

    /**
     * Royal Line-by-Line Typography Engine
     * Decomposes stacked lyrics into individual high-definition offscreen canvases
     * with multi-tier champagne/ice-white neon glow and crisp white cores.
     */
    buildLineItems(activeLine, w, h) {
      const cx = w * 0.5;
      const cy = h * 0.5;
      const glowStrength = RAINY_CONFIG.GLOW_STRENGTH;

      if (!activeLine || !activeLine.text) {
        const fontSize = Math.round(20 * this.dpr);
        const pad = Math.round(fontSize * 1.5);
        const offCanvas = document.createElement('canvas');
        const offCtx = offCanvas.getContext('2d');
        offCtx.font = `700 ${fontSize}px ${RAINY_CONFIG.FONT_FAMILY}`;
        const text = 'NO LYRICS FOUND';
        const tw = offCtx.measureText(text).width;
        offCanvas.width = Math.ceil(tw + pad * 2);
        offCanvas.height = Math.ceil(fontSize * 1.5 + pad * 2);

        offCtx.font = `700 ${fontSize}px ${RAINY_CONFIG.FONT_FAMILY}`;
        offCtx.textAlign = 'center';
        offCtx.textBaseline = 'middle';
        offCtx.letterSpacing = '0.25em';
        offCtx.fillStyle = 'rgba(255, 255, 255, 0.40)';
        offCtx.fillText(text, offCanvas.width * 0.5, offCanvas.height * 0.5);

        this.lyricsBounds = {
          minX: cx - tw * 0.5 - 20 * this.dpr,
          maxX: cx + tw * 0.5 + 20 * this.dpr,
          minY: cy - fontSize * 0.5 - 20 * this.dpr,
          maxY: cy + fontSize * 0.5 + 20 * this.dpr
        };

        return [{
          text,
          canvas: offCanvas,
          width: tw,
          totalW: offCanvas.width,
          totalH: offCanvas.height,
          padX: offCanvas.width * 0.5,
          padY: offCanvas.height * 0.5,
          baseX: cx,
          baseY: cy,
          index: 0
        }];
      }

      const stackedLines = this.formatStackedLyricLines(activeLine.text || '');
      if (stackedLines.length === 0) return [];

      const targetW = w * 0.46;
      const targetH = h * 0.32;

      const baseScale = (RAINY_CONFIG.TEXT_SIZE && Number.isFinite(RAINY_CONFIG.TEXT_SIZE)) ? RAINY_CONFIG.TEXT_SIZE : 1.0;
      let fontSize = Math.min(h * 0.11, 76 * this.dpr) * baseScale;

      const measureCanvas = document.createElement('canvas');
      const mCtx = measureCanvas.getContext('2d');
      mCtx.font = `900 ${fontSize}px ${RAINY_CONFIG.FONT_FAMILY}`;

      for (let iter = 0; iter < 12; iter++) {
        let maxLineW = 0;
        stackedLines.forEach(l => {
          const mw = mCtx.measureText(l).width;
          if (mw > maxLineW) maxLineW = mw;
        });
        const totalBlockH = stackedLines.length * fontSize * 1.06;
        if (maxLineW <= targetW && totalBlockH <= targetH) break;
        const scale = Math.min(targetW / maxLineW, targetH / totalBlockH);
        fontSize = Math.max(18 * this.dpr, Math.floor(fontSize * Math.max(0.70, scale * 0.96)));
        mCtx.font = `900 ${fontSize}px ${RAINY_CONFIG.FONT_FAMILY}`;
      }

      let maxTextW = 0;
      const measuredWidths = stackedLines.map(l => {
        const mw = mCtx.measureText(l).width;
        if (mw > maxTextW) maxTextW = mw;
        return mw;
      });

      const lineHeight = fontSize * 1.05;
      const startY = cy - ((stackedLines.length - 1) * lineHeight * 0.5);

      this.lyricsBounds = {
        minX: cx - maxTextW * 0.5 - 24 * this.dpr,
        maxX: cx + maxTextW * 0.5 + 24 * this.dpr,
        minY: startY - lineHeight * 0.5 - 24 * this.dpr,
        maxY: startY + (stackedLines.length - 0.5) * lineHeight + 24 * this.dpr
      };

      const pad = Math.ceil(fontSize * 1.1);

      return stackedLines.map((lineText, idx) => {
        const textW = measuredWidths[idx];
        const lineCanvas = document.createElement('canvas');
        lineCanvas.width = Math.ceil(textW + pad * 2);
        lineCanvas.height = Math.ceil(fontSize * 1.35 + pad * 2);
        const lCtx = lineCanvas.getContext('2d');
        const lcx = lineCanvas.width * 0.5;
        const lcy = lineCanvas.height * 0.5;

        // 1. Multi-Tiered Royal Neon Glow
        if (glowStrength > 0.02) {
          lCtx.save();
          lCtx.font = `900 ${fontSize}px ${RAINY_CONFIG.FONT_FAMILY}`;
          lCtx.textAlign = 'center';
          lCtx.textBaseline = 'middle';
          lCtx.letterSpacing = '0.04em';

          // A. Wide diffuse ambient aura
          lCtx.shadowColor = `rgba(215, 235, 255, ${0.48 * glowStrength})`;
          lCtx.shadowBlur = Math.round(fontSize * 0.82);
          lCtx.fillStyle = `rgba(215, 235, 255, ${0.48 * glowStrength})`;
          lCtx.fillText(lineText, lcx, lcy);

          // B. Outer neon tube halo
          lCtx.shadowColor = `rgba(255, 255, 255, ${0.82 * glowStrength})`;
          lCtx.shadowBlur = Math.round(fontSize * 0.36);
          lCtx.fillStyle = `rgba(255, 255, 255, ${0.82 * glowStrength})`;
          lCtx.fillText(lineText, lcx, lcy);

          // C. Inner neon core glow
          lCtx.shadowColor = `rgba(255, 255, 255, ${0.95 * glowStrength})`;
          lCtx.shadowBlur = Math.round(fontSize * 0.14);
          lCtx.fillStyle = `rgba(255, 255, 255, ${0.95 * glowStrength})`;
          lCtx.fillText(lineText, lcx, lcy);

          lCtx.restore();
        }

        // 2. Solid Crisp White Text Core (100% sharp letterforms)
        lCtx.save();
        lCtx.font = `900 ${fontSize}px ${RAINY_CONFIG.FONT_FAMILY}`;
        lCtx.textAlign = 'center';
        lCtx.textBaseline = 'middle';
        lCtx.letterSpacing = '0.04em';
        lCtx.shadowBlur = 0;
        lCtx.fillStyle = '#FFFFFF';
        lCtx.fillText(lineText, lcx, lcy);
        lCtx.restore();

        return {
          text: lineText,
          canvas: lineCanvas,
          width: textW,
          totalW: lineCanvas.width,
          totalH: lineCanvas.height,
          padX: lcx,
          padY: lcy,
          baseX: cx,
          baseY: startY + (idx * lineHeight),
          index: idx
        };
      });
    }

    /**
     * Backward-compatible composite helper
     */
    renderLyricsToCanvas(targetCanvas, w, h, activeLine) {
      if (!targetCanvas) return;
      const items = this.buildLineItems(activeLine, w, h);
      const ctx = targetCanvas.getContext('2d');
      ctx.clearRect(0, 0, w, h);
      items.forEach(item => {
        ctx.drawImage(item.canvas, item.baseX - item.padX, item.baseY - item.padY);
      });
    }

    /**
     * Render Layer 1 & 2: True Optical Depth Order
     * 1. Deep Midnight Black Background
     * 2. Fast Falling Rain Streaks (Outside window during storm)
     * 3. Condensation Fog & Volumetric Backlight Bloom (The steamy window pane)
     * 4. Luminous Lyrics with Punchy Transitions (Radiating from behind the glass)
     * 5. Wiped Wet Trails (Water streams wiping the condensation ON the glass)
     */
    renderBaseLayer(currentTime) {
      const ctx = this.baseCtx;
      const w = this.baseCanvas.width;
      const h = this.baseCanvas.height;
      const cx = w * 0.5;
      const cy = h * 0.5;

      // 1. OLED True Black Background
      ctx.fillStyle = '#020305';
      ctx.fillRect(0, 0, w, h);

      // 2. LAYER: FAST DIAGONAL RAIN STREAKS (Outside glass during heavy rain)
      if (this.rainStreaks.length > 0 && this.stormIntensity > 0.02) {
        ctx.save();
        ctx.lineCap = 'round';
        this.rainStreaks.forEach(s => {
          const a = s.alpha * this.stormIntensity * 0.38;
          ctx.strokeStyle = `rgba(215, 230, 255, ${a})`;
          ctx.lineWidth = s.width;
          ctx.beginPath();
          ctx.moveTo(s.x, s.y);
          ctx.lineTo(s.x + Math.sin(s.windAngle) * s.len, s.y + Math.cos(s.windAngle) * s.len);
          ctx.stroke();
        });
        ctx.restore();
      }

      // 3. LAYER: AUTHENTIC STEAMY CONDENSATION FOG
      const fogAmt = RAINY_CONFIG.FOG_AMOUNT;
      const glowStrength = RAINY_CONFIG.GLOW_STRENGTH;

      // A. Smooth Volumetric Backlight Scatter across the mist (from the neon lyrics)
      ctx.save();
      const bloomR = Math.min(w, h) * 0.70;
      const mistBloom = ctx.createRadialGradient(cx, cy, bloomR * 0.05, cx, cy, bloomR);
      mistBloom.addColorStop(0.00, `rgba(205, 225, 250, ${0.46 * fogAmt * glowStrength})`);
      mistBloom.addColorStop(0.25, `rgba(145, 175, 210, ${0.32 * fogAmt * glowStrength})`);
      mistBloom.addColorStop(0.55, `rgba(75, 95, 125, ${0.18 * fogAmt * glowStrength})`);
      mistBloom.addColorStop(0.80, `rgba(25, 35, 50, ${0.08 * fogAmt})`);
      mistBloom.addColorStop(1.00, 'rgba(2, 3, 5, 0.0)');

      ctx.fillStyle = mistBloom;
      ctx.beginPath();
      ctx.arc(cx, cy, bloomR, 0, Math.PI * 2);
      ctx.fill();

      // Atmospheric Center Fog Plume directly surrounding lyrics
      const centerFog = ctx.createRadialGradient(cx, cy, bloomR * 0.10, cx, cy, bloomR * 0.50);
      centerFog.addColorStop(0.0, `rgba(205, 225, 248, ${0.24 * fogAmt})`);
      centerFog.addColorStop(0.5, `rgba(145, 170, 200, ${0.12 * fogAmt})`);
      centerFog.addColorStop(1.0, 'rgba(0, 0, 0, 0.0)');
      ctx.fillStyle = centerFog;
      ctx.beginPath();
      ctx.arc(cx, cy, bloomR * 0.50, 0, Math.PI * 2);
      ctx.fill();

      // B. Living Atmospheric Wind Currents (smooth drifting mist)
      if (this.fogPlumes.length > 0) {
        this.fogPlumes.forEach(p => {
          const plumeGrad = ctx.createRadialGradient(p.x, p.y, p.r * 0.10, p.x, p.y, p.r);
          plumeGrad.addColorStop(0.0, `rgba(180, 205, 230, ${p.alpha * fogAmt * 0.85})`);
          plumeGrad.addColorStop(0.5, `rgba(120, 145, 175, ${p.alpha * 0.45 * fogAmt})`);
          plumeGrad.addColorStop(1.0, 'rgba(0, 0, 0, 0.0)');

          ctx.fillStyle = plumeGrad;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
          ctx.fill();
        });
      }

      // C. Perimeter Vignette (darkening towards the window frame)
      const maxR = Math.hypot(w, h) * 0.50;
      const vignette = ctx.createRadialGradient(cx, cy, maxR * 0.45, cx, cy, maxR);
      vignette.addColorStop(0.0, 'rgba(0, 0, 0, 0.0)');
      vignette.addColorStop(0.7, 'rgba(2, 3, 5, 0.45)');
      vignette.addColorStop(1.0, 'rgba(0, 0, 0, 0.92)');
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();

      // 4. LAYER: ROYAL CINEMATIC LYRICS WITH CASCADING FLUID MOTION
      if (this.currentLyrics.hasLyrics && this.currentLyrics.lines.length > 0) {
        const lines = this.currentLyrics.lines;
        let activeIdx = -1;
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].time <= currentTime + 0.15) {
            activeIdx = i;
          } else {
            break;
          }
        }

        if (activeIdx === -1 && lines[0].time - currentTime < 2.5) {
          activeIdx = 0;
        }

        const lineChanged = (activeIdx !== this.activeLineIndex);
        if (lineChanged || this.lyricsDirty) {
          if (lineChanged) {
            const wasInitial = (this.activeLineIndex === -1);
            this.previousLineIndex = this.activeLineIndex;
            this.activeLineIndex = activeIdx;
            this.transitionStartTime = wasInitial ? (performance.now() - this.transitionDuration) : performance.now();

            this.prevLineItems = this.currLineItems || [];
          }

          const activeLine = activeIdx >= 0 ? lines[activeIdx] : null;
          this.currLineItems = this.buildLineItems(activeLine, w, h);
          this.lyricsDirty = false;
        }
      } else {
        if (this.activeLineIndex !== -2 || this.lyricsDirty) {
          this.activeLineIndex = -2;
          this.prevLineItems = [];
          this.currLineItems = this.buildLineItems(null, w, h);
          this.lyricsDirty = false;
        }
      }

      // Composite Active Royal Lyrics onto this.currLyricsCanvas
      if (this.currLyricsCanvas) {
        const cCtx = this.currLyricsCanvas.getContext('2d');
        cCtx.clearRect(0, 0, w, h);

        const now = performance.now();
        const transElapsed = now - this.transitionStartTime;
        const progress = Math.min(1.0, transElapsed / this.transitionDuration);
        const ambientTime = this.globalTime || (now * 0.001);

        // A. Render Outgoing Lines (Staggered upward float & soft quadratic mist dissolve)
        if (progress < 1.0 && this.prevLineItems && this.prevLineItems.length > 0) {
          this.prevLineItems.forEach((item, i) => {
            const outDelay = i * 0.08;
            const lp = Math.max(0, Math.min(1.0, (progress - outDelay) / (1.0 - outDelay * 0.55)));
            if (lp >= 1.0) return;

            // Velvety quartic ease-out
            const ease = 1.0 - Math.pow(1.0 - lp, 3.8);
            const outAlpha = Math.max(0, Math.pow(1.0 - lp, 1.8));
            if (outAlpha <= 0.005) return;

            const outOffsetY = -ease * (20 * this.dpr);
            const outScale = 1.0 + 0.018 * ease;

            cCtx.save();
            cCtx.globalAlpha = outAlpha;
            cCtx.translate(item.baseX, item.baseY + outOffsetY);
            cCtx.scale(outScale, outScale);
            cCtx.drawImage(item.canvas, -item.padX, -item.padY);
            cCtx.restore();
          });
        }

        // B. Render Incoming Lines (Stately Royal Elevation + Cascading Stagger + Diamond Shimmer)
        if (this.currLineItems && this.currLineItems.length > 0) {
          this.currLineItems.forEach((item, i) => {
            let lineAlpha = 1.0;
            let lineScale = 1.0;
            let lineOffsetY = 0;
            let lineLp = 1.0;

            if (progress < 1.0 && this.previousLineIndex >= 0) {
              const inDelay = i * 0.095;
              lineLp = Math.max(0, Math.min(1.0, (progress - inDelay) / (1.0 - inDelay * 0.45)));

              // Royal Quartic-Quintic Easing: silky, dignified deceleration
              const ease = 1.0 - Math.pow(1.0 - lineLp, 4.6);
              lineOffsetY = (1.0 - ease) * (26 * this.dpr);
              lineScale = 0.965 + 0.035 * ease;
              lineAlpha = Math.min(1.0, Math.pow(lineLp, 0.75) * 1.25);
            }

            // Living harmonic ambient float (continuous royal breathing)
            const floatY = Math.sin(ambientTime * 1.05 + i * 0.65) * (1.3 * this.dpr);
            const floatX = Math.cos(ambientTime * 0.72 + i * 0.45) * (0.6 * this.dpr);

            if (lineAlpha > 0.005) {
              cCtx.save();
              cCtx.globalAlpha = lineAlpha;
              cCtx.translate(item.baseX + floatX, item.baseY + floatY + lineOffsetY);
              cCtx.scale(lineScale, lineScale);
              cCtx.drawImage(item.canvas, -item.padX, -item.padY);

              // Royal Diamond Shimmer Sheen during line arrival
              if (lineLp >= 0.20 && lineLp <= 0.85) {
                const glintT = (lineLp - 0.20) / 0.65; // 0 to 1
                const glintX = -item.width * 0.55 + glintT * (item.width * 1.1);
                const glintR = Math.max(22 * this.dpr, item.width * 0.24);
                const glintGrad = cCtx.createRadialGradient(glintX, 0, 0, glintX, 0, glintR);
                glintGrad.addColorStop(0, 'rgba(255, 255, 255, 0.45)');
                glintGrad.addColorStop(0.35, 'rgba(235, 245, 255, 0.18)');
                glintGrad.addColorStop(1, 'rgba(255, 255, 255, 0.0)');

                cCtx.save();
                cCtx.globalCompositeOperation = 'lighter';
                cCtx.fillStyle = glintGrad;
                cCtx.fillRect(-item.width * 0.6, -item.padY, item.width * 1.2, item.totalH);
                cCtx.restore();
              }

              cCtx.restore();
            }
          });
        }

        // Draw the composited active lyrics canvas directly onto baseCtx
        ctx.drawImage(this.currLyricsCanvas, 0, 0);
      }

      // 5. LAYER: WIPED WET TRAILS (Water streams wiping the condensation ON the glass)
      const renderTrack = (stream, isCustom = false) => {
        const pts = stream.pathPoints;
        const n = pts.length;
        if (n < 2) return;

        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        for (let i = 1; i < n; i++) {
          const progress = i / n;
          const pPrev = pts[i - 1];
          const pCurr = pts[i];
          const ptAlpha = (pCurr.alpha !== undefined ? pCurr.alpha : 1.0);
          const fade = ptAlpha * Math.min(1.0, progress * 1.4);
          if (fade <= 0.01) continue;

          // Natural organic tapering: wider near the sliding drop, narrower near the tail
          const wCore = Math.max(1.8 * this.dpr, stream.trailW * (0.28 + progress * 0.52));

          // A. Clean channel clearing condensation mist from glass (transparent dark channel)
          ctx.beginPath();
          ctx.moveTo(pPrev.x, pPrev.y);
          ctx.lineTo(pCurr.x, pCurr.y);
          ctx.strokeStyle = `rgba(2, 3, 5, ${fade * 0.72})`;
          ctx.lineWidth = wCore;
          ctx.stroke();

          // B. Soft translucent liquid water sheen inside channel
          ctx.strokeStyle = `rgba(195, 222, 255, ${fade * 0.09})`;
          ctx.lineWidth = wCore * 0.68;
          ctx.beginPath();
          ctx.moveTo(pPrev.x, pPrev.y);
          ctx.lineTo(pCurr.x, pCurr.y);
          ctx.stroke();

          // C. Subtle liquid core highlight on fresh wet portion right behind the head
          if (progress > 0.75) {
            const headFade = (progress - 0.75) / 0.25;
            ctx.strokeStyle = `rgba(255, 255, 255, ${fade * headFade * 0.22})`;
            ctx.lineWidth = Math.max(0.6 * this.dpr, wCore * 0.25);
            ctx.beginPath();
            ctx.moveTo(pPrev.x, pPrev.y);
            ctx.lineTo(pCurr.x, pCurr.y);
            ctx.stroke();
          }
        }
        ctx.restore();
      };

      this.slidingStreams.forEach(stream => renderTrack(stream));

      // Also render wake for active dragged drop if user is dragging one!
      if (this.draggedDrop && this.draggedDrop.pathPoints && this.draggedDrop.pathPoints.length >= 2) {
        renderTrack(this.draggedDrop, true);
      }
    }

    /**
     * Render Layer 6: Water Droplets on Front Glass Surface
     * High-speed selective refraction pipeline (locked 60 FPS)
     */
    renderGlassDroplets() {
      const ctx = this.ctx;
      const base = this.baseCanvas;

      // 1. Draw base composite layer onto screen
      ctx.drawImage(base, 0, 0);

      // 2. Draw transient splash ripples
      if (this.splashRipples.length > 0) {
        ctx.save();
        this.splashRipples.forEach(rip => {
          ctx.beginPath();
          ctx.arc(rip.x, rip.y, rip.currentR, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(255, 255, 255, ${rip.alpha * 0.40})`;
          ctx.lineWidth = 1.0 * this.dpr;
          ctx.stroke();
        });
        ctx.restore();
      }

      // 3. Combine droplets: static, sliding remnants, sliding heads, and dragged drop
      const allDrops = [...this.staticDrops];
      this.slidingStreams.forEach(stream => {
        allDrops.push(...stream.remnants);
        allDrops.push({
          x: stream.x,
          y: stream.y,
          r: stream.r,
          vertices: stream.vertices,
          specAngle: -0.75,
          isMicro: false,
          stretch: stream.stretch || 1.0
        });
      });

      // Add user dragged drop if active
      if (this.draggedDrop) {
        allDrops.push(this.draggedDrop);
      }

      const bounds = this.lyricsBounds;
      const activeTextCanvas = this.currLyricsCanvas;

      // 4. Draw Individual Droplets with High-Performance Shader Pipeline
      for (let i = 0; i < allDrops.length; i++) {
        const d = allDrops[i];
        if (!d || !Number.isFinite(d.x) || !Number.isFinite(d.y) || !Number.isFinite(d.r) || d.r <= 0.1) continue;

        if (d.isMicro) {
          // Micro condensation droplet: delicate meniscus & glistening pinpoint
          ctx.beginPath();
          ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(20, 25, 35, 0.22)';
          ctx.lineWidth = Math.max(0.4, d.r * 0.18);
          ctx.stroke();

          ctx.beginPath();
          ctx.arc(d.x - d.r * 0.24, d.y - d.r * 0.24, Math.max(0.5, d.r * 0.38), 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
          ctx.fill();

          ctx.beginPath();
          ctx.arc(d.x + d.r * 0.20, d.y + d.r * 0.20, Math.max(0.3, d.r * 0.22), 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(230, 245, 255, 0.45)';
          ctx.fill();
        } else {
          const stretch = (Number.isFinite(d.stretch) && d.stretch > 0) ? d.stretch : 1.0;
          const inLyricsZone = bounds &&
            d.x >= bounds.minX - d.r && d.x <= bounds.maxX + d.r &&
            d.y >= bounds.minY - d.r && d.y <= bounds.maxY + d.r;

          if (inLyricsZone && activeTextCanvas) {
            // Optical refraction: sample directly from cached lyricsCanvas
            ctx.save();
            traceDynamicDroplet(ctx, d.x, d.y, d.vertices, stretch);
            ctx.clip();

            const srcR = d.r * 0.68;
            const refrX = d.x - d.r * 0.22;
            const refrY = d.y - d.r * 0.22;
            ctx.drawImage(
              activeTextCanvas,
              refrX - srcR, refrY - srcR, srcR * 2, srcR * 2,
              d.x - d.r, d.y - d.r, d.r * 2, d.r * 2
            );

            // Subtle internal liquid gradient
            const innerGrad = ctx.createRadialGradient(d.x, d.y, Math.max(0.1, d.r * 0.25), d.x, d.y, Math.max(0.2, d.r));
            innerGrad.addColorStop(0, 'rgba(255, 255, 255, 0.10)');
            innerGrad.addColorStop(0.70, 'rgba(0, 0, 0, 0.0)');
            innerGrad.addColorStop(1, 'rgba(10, 15, 25, 0.26)');
            ctx.fillStyle = innerGrad;
            ctx.fill();
            ctx.restore();
          } else {
            // High-efficiency procedural liquid shading for drops outside lyrics text
            ctx.save();
            traceDynamicDroplet(ctx, d.x, d.y, d.vertices, stretch);
            const innerGrad = ctx.createRadialGradient(d.x - d.r * 0.2, d.y - d.r * 0.2, Math.max(0.1, d.r * 0.1), d.x, d.y, Math.max(0.2, d.r));
            innerGrad.addColorStop(0, 'rgba(255, 255, 255, 0.06)');
            innerGrad.addColorStop(0.65, 'rgba(15, 20, 30, 0.02)');
            innerGrad.addColorStop(1, 'rgba(8, 12, 20, 0.28)');
            ctx.fillStyle = innerGrad;
            ctx.fill();
            ctx.restore();
          }

          // Delicate Meniscus Rim along the organic contour
          ctx.save();
          traceDynamicDroplet(ctx, d.x, d.y, d.vertices, stretch);
          ctx.strokeStyle = 'rgba(20, 25, 35, 0.26)';
          ctx.lineWidth = Math.max(0.5, Math.min(1.2, d.r * 0.10));
          ctx.stroke();

          // Primary Specular Pinpoint Glint (liquid light catch)
          const angle = d.specAngle || -0.75;
          const hx = d.x + Math.cos(angle) * (d.r * 0.52);
          const hy = d.y + Math.sin(angle) * (d.r * 0.52 * stretch);
          ctx.beginPath();
          ctx.arc(hx, hy, Math.max(0.8, d.r * 0.24), 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(255, 255, 255, 0.98)';
          ctx.fill();

          // Secondary lower crescent caustics rim reflection
          const oppAngle = angle + Math.PI;
          const rx = d.x + Math.cos(oppAngle) * (d.r * 0.55);
          const ry = d.y + Math.sin(oppAngle) * (d.r * 0.55 * stretch);
          ctx.beginPath();
          ctx.arc(rx, ry, Math.max(0.5, d.r * 0.18), 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
          ctx.fill();

          ctx.restore();
        }
      }
    }

    /**
     * Interactive Pointer / Touch Handlers
     */
    onPointerDown(e) {
      if (!this.isOpen || !this.canvas) return;

      const rect = this.canvas.getBoundingClientRect();
      const px = (e.clientX - rect.left) * this.dpr;
      const py = (e.clientY - rect.top) * this.dpr;

      // Find closest droplet within reach
      let bestDrop = null;
      let bestDist = Infinity;
      let bestType = 'static';
      let bestIdx = -1;

      // 1. Check static droplets (medium & large preferred)
      for (let i = 0; i < this.staticDrops.length; i++) {
        const d = this.staticDrops[i];
        if (d.isMicro) continue;
        const dist = Math.hypot(d.x - px, d.y - py);
        const grabRadius = Math.max(18 * this.dpr, d.r + 14 * this.dpr);
        if (dist < grabRadius && dist < bestDist) {
          bestDist = dist;
          bestDrop = d;
          bestType = 'static';
          bestIdx = i;
        }
      }

      // 2. Check sliding stream heads
      for (let i = 0; i < this.slidingStreams.length; i++) {
        const s = this.slidingStreams[i];
        const dist = Math.hypot(s.x - px, s.y - py);
        const grabRadius = Math.max(18 * this.dpr, s.r + 14 * this.dpr);
        if (dist < grabRadius && dist < bestDist) {
          bestDist = dist;
          bestDrop = s;
          bestType = 'stream';
          bestIdx = i;
        }
      }

      if (bestDrop) {
        if (bestType === 'static') {
          this.staticDrops.splice(bestIdx, 1);
        } else {
          this.slidingStreams.splice(bestIdx, 1);
        }

        this.draggedDrop = {
          x: px,
          y: py,
          r: bestDrop.r,
          vertices: generateOrganicVertices(bestDrop.r, Math.random),
          trailW: Math.max(2.5 * this.dpr, bestDrop.r * 0.55),
          pathPoints: [{ x: px, y: py, alpha: 1.0, time: this.globalTime }],
          specAngle: -0.75,
          isMicro: false,
          stretch: 1.0
        };

        this.dragLastPos = { x: px, y: py };
        this.dragVelocity = { vx: 0, vy: 0 };
        this.dragDistSinceLastDrop = 0;
        this.isDragging = true;

        if (this.canvas.setPointerCapture) {
          try {
            this.canvas.setPointerCapture(e.pointerId);
          } catch (err) { }
        }
        this.canvas.classList.add('dragging');
      }
    }

    onPointerMove(e) {
      if (!this.isOpen || !this.isDragging || !this.draggedDrop) return;

      const rect = this.canvas.getBoundingClientRect();
      const nx = (e.clientX - rect.left) * this.dpr;
      const ny = (e.clientY - rect.top) * this.dpr;

      const dDist = Math.hypot(nx - this.dragLastPos.x, ny - this.dragLastPos.y);

      // Track drag velocity
      this.dragVelocity = {
        vx: nx - this.dragLastPos.x,
        vy: ny - this.dragLastPos.y
      };
      this.dragLastPos = { x: nx, y: ny };

      this.draggedDrop.x = nx;
      this.draggedDrop.y = ny;

      // Dynamic teardrop stretch based on drag speed
      const dragSpeed = Math.hypot(this.dragVelocity.vx, this.dragVelocity.vy);
      this.draggedDrop.stretch = 1.0 + Math.min(0.40, dragSpeed / (25 * this.dpr));

      // Wake recording
      const lastPt = this.draggedDrop.pathPoints[this.draggedDrop.pathPoints.length - 1];
      if (!lastPt || Math.hypot(nx - lastPt.x, ny - lastPt.y) > 6 * this.dpr) {
        this.draggedDrop.pathPoints.push({ x: nx, y: ny, alpha: 1.0, time: this.globalTime });
        if (this.draggedDrop.pathPoints.length > 30) this.draggedDrop.pathPoints.shift();
      }

      // Shed water & drop residue beads as droplet moves
      this.dragDistSinceLastDrop += dDist;
      if (this.dragDistSinceLastDrop > 18 * this.dpr) {
        this.dragDistSinceLastDrop = 0;

        // Deposit small bead remnant
        const remR = Math.max(1.0 * this.dpr, Math.min(2.5 * this.dpr, this.draggedDrop.r * 0.22));
        this.staticDrops.push({
          x: nx + (Math.random() - 0.5) * 4 * this.dpr,
          y: ny + (Math.random() - 0.5) * 4 * this.dpr,
          baseX: nx,
          baseY: ny,
          r: remR,
          vertices: generateOrganicVertices(remR, Math.random),
          specAngle: -0.75,
          isMicro: false,
          jitterPhase: Math.random() * Math.PI * 2,
          slipRemaining: 0,
          slipSpeed: 0,
          nextSlipTimer: 2.5 + Math.random() * 3.5
        });

        // Droplet gradually sheds water & becomes slightly smaller
        this.draggedDrop.r = Math.max(3.2 * this.dpr, this.draggedDrop.r * 0.985);
        this.draggedDrop.vertices = generateOrganicVertices(this.draggedDrop.r, Math.random);
      }

      // Coalescence on drag: absorb other droplets touched along the path!
      for (let i = this.staticDrops.length - 1; i >= 0; i--) {
        const sd = this.staticDrops[i];
        const dist = Math.hypot(sd.x - nx, sd.y - ny);
        if (dist < this.draggedDrop.r + sd.r + 2 * this.dpr) {
          // Merge volumes: V = r1^3 + r2^3
          const newR = Math.min(22 * this.dpr, Math.cbrt(Math.pow(this.draggedDrop.r, 3) + Math.pow(sd.r, 3)));
          this.draggedDrop.r = newR;
          this.draggedDrop.vertices = generateOrganicVertices(newR, Math.random);
          this.staticDrops.splice(i, 1);

          // Liquid impact ripple on absorption
          this.splashRipples.push({
            x: nx,
            y: ny,
            maxR: newR * 2.2,
            currentR: newR * 0.5,
            alpha: 0.65,
            life: 0.25
          });
        }
      }
    }

    onPointerUp(e) {
      if (!this.isOpen || !this.isDragging || !this.draggedDrop) return;

      this.isDragging = false;
      if (this.canvas) {
        this.canvas.classList.remove('dragging');
        if (this.canvas.releasePointerCapture && e.pointerId !== undefined) {
          try {
            this.canvas.releasePointerCapture(e.pointerId);
          } catch (err) { }
        }
      }

      const drop = this.draggedDrop;
      this.draggedDrop = null;

      // Heavy droplet or downward flick -> becomes an active falling stream!
      const isHeavy = drop.r > 7.5 * this.dpr;
      const isFlickDown = this.dragVelocity.vy > 6 * this.dpr;

      if (isHeavy || isFlickDown) {
        const stream = this.createSlidingStream(drop.x, drop.y, drop.r, 'continuous');
        stream.vy = Math.max(300 * this.dpr, Math.min(750 * this.dpr, this.dragVelocity.vy * 40));
        stream.pathPoints = [...drop.pathPoints];
        this.slidingStreams.push(stream);
      } else {
        // Light droplet: sticks to glass where released
        this.staticDrops.push({
          x: drop.x,
          y: drop.y,
          baseX: drop.x,
          baseY: drop.y,
          r: drop.r,
          vertices: drop.vertices,
          specAngle: -0.75,
          isMicro: false,
          jitterPhase: Math.random() * Math.PI * 2,
          slipRemaining: 0,
          slipSpeed: 0,
          nextSlipTimer: 1.8 + Math.random() * 3.2
        });
      }
    }

    /**
     * Main 60fps render loop
     * SINGLE RAF LOOP ARCHITECTURE - completely eliminates lag and freezing!
     */
    renderLoop(timestamp) {
      if (!this.isOpen) return;

      if (!this.lastTimestamp) this.lastTimestamp = timestamp;
      const dt = Math.max(0.001, Math.min(0.05, (timestamp - this.lastTimestamp) * 0.001));
      this.lastTimestamp = timestamp;

      // 1. Update living fog wind physics
      this.updateFogWind(dt);

      // 2. Update real water coalescence & downward surge physics
      this.updateDropletPhysics(dt);

      // 3. Update falling rain lifecycle, ripples, storm intensity & streaks
      this.updateRainLifecycle(dt);

      // 4. Update sliding streams (stick-slip & cascading streams - fluid 60fps)
      this.updateSlidingStreams(dt);

      // Playback time
      const curTime = window.player?.audio ? window.player.audio.currentTime : 0;

      // Layer 1 to 5: Background -> Rain Streaks -> Living Fog -> Punchy Lyrics -> Wet Trails
      this.renderBaseLayer(curTime);

      // Layer 6: Organic glass water droplets overlay refracting everything
      this.renderGlassDroplets();

      // Only ONE requestAnimationFrame loop is ever requested!
      this.animFrameId = requestAnimationFrame(this.renderLoop);
    }

    /**
     * Mouse Movement Handler (idle cursor hide & top-right hover zone)
     */
    onMouseMove(e) {
      if (!this.isOpen) return;

      if (this.overlay) {
        this.overlay.classList.remove('rainy-cursor-hidden');
      }

      clearTimeout(this.cursorTimer);
      this.cursorTimer = setTimeout(() => {
        if (this.isOpen && this.overlay && !this.isHoveringTopRight && !this.isDebugOpen && !this.isDragging) {
          this.overlay.classList.add('rainy-cursor-hidden');
        }
      }, 3000);

      // Top-right 120x120px hover zone
      const isInZone = e.clientX >= window.innerWidth - 120 && e.clientY <= 120;
      if (isInZone && !this.isHoveringTopRight) {
        this.isHoveringTopRight = true;
        if (this.exitBtn) this.exitBtn.classList.add('visible');
      } else if (!isInZone && this.isHoveringTopRight) {
        this.isHoveringTopRight = false;
        if (this.exitBtn) this.exitBtn.classList.remove('visible');
      }
    }

    /**
     * Keydown Handler: B/Esc exits; Shift+B toggles Heavy Rain; D toggles Debug Panel
     */
    onKeyDown(e) {
      if (!this.isOpen) return;

      // Toggle Debug Panel with 'D'
      if (e.code === 'KeyD' || e.key === 'd' || e.key === 'D') {
        const active = document.activeElement;
        if (active && (['INPUT', 'TEXTAREA'].includes(active.tagName) || active.isContentEditable)) return;
        e.preventDefault();
        this.isDebugOpen = !this.isDebugOpen;
        if (this.debugPanel) {
          this.debugPanel.classList.toggle('open', this.isDebugOpen);
        }
        if (this.overlay) {
          this.overlay.classList.remove('rainy-cursor-hidden');
        }
        return;
      }

      // Shift + B toggles Heavy Rain Mode
      if (e.code === 'KeyB' || e.key === 'b' || e.key === 'B') {
        const active = document.activeElement;
        if (active && (['INPUT', 'TEXTAREA'].includes(active.tagName) || active.isContentEditable)) return;
        if (e.ctrlKey || e.altKey || e.metaKey) return;
        e.preventDefault();
        e.stopPropagation();
        if (e.stopImmediatePropagation) e.stopImmediatePropagation();

        if (e.shiftKey) {
          this.toggleHeavyRain();
        } else {
          this.close();
        }
        return;
      }

      // Exit on Escape
      if (e.code === 'Escape' || e.key === 'Escape') {
        const active = document.activeElement;
        if (active && (['INPUT', 'TEXTAREA'].includes(active.tagName) || active.isContentEditable)) return;
        e.preventDefault();
        this.close();
      }
    }

    onResize() {
      if (!this.isOpen) return;
      this.initCanvases();
      this.initSimulation();
      this.lyricsDirty = true;
    }

    onVisibilityChange() {
      if (!this.isOpen) return;
      if (document.hidden) {
        if (this.animFrameId) {
          cancelAnimationFrame(this.animFrameId);
          this.animFrameId = null;
        }
      } else {
        if (!this.animFrameId) {
          this.lastTimestamp = performance.now();
          this.animFrameId = requestAnimationFrame(this.renderLoop);
        }
      }
    }

    onTrackChange(track) {
      if (!this.isOpen) return;
      this.loadTrackLyrics();
      this.activeLineIndex = -1;
      this.previousLineIndex = -1;
      this.transitionStartTime = performance.now();
      this.lyricsDirty = true;
    }

    /**
     * Open Rainy Window Lyrics Mode
     */
    open() {
      if (this.isOpen) return;

      this.ensureDOM();
      this.isOpen = true;
      this.activeLineIndex = -1;
      this.previousLineIndex = -1;
      this.lastTimestamp = 0;
      this.globalTime = 0;
      this.lyricsDirty = true;
      this.isHeavyRain = false;
      this.stormIntensity = 0.0;
      this.lastStormToggleTime = 0;
      this.draggedDrop = null;
      this.isDragging = false;
      this.checkReducedMotion();

      // Load current lyrics
      this.loadTrackLyrics();

      // Show overlay
      this.overlay.style.display = 'block';
      this.overlay.classList.remove('rainy-cursor-hidden');

      // Setup canvases, living fog & droplets
      this.initCanvases();
      this.initSimulation();

      // 2-second collapse icon reveal
      if (this.exitBtn) {
        this.exitBtn.classList.add('visible');
        clearTimeout(this.exitBtnTimer);
        this.exitBtnTimer = setTimeout(() => {
          if (this.isOpen && !this.isHoveringTopRight && this.exitBtn) {
            this.exitBtn.classList.remove('visible');
          }
        }, 2000);
      }

      // 3-second cursor hide timer
      clearTimeout(this.cursorTimer);
      this.cursorTimer = setTimeout(() => {
        if (this.isOpen && this.overlay && !this.isHoveringTopRight && !this.isDebugOpen && !this.isDragging) {
          this.overlay.classList.add('rainy-cursor-hidden');
        }
      }, 3000);

      // Listeners
      window.addEventListener('keydown', this.boundOnKeyDown, true);
      window.addEventListener('mousemove', this.boundOnMouseMove, { passive: true });
      window.addEventListener('resize', this.boundOnResize, { passive: true });
      document.addEventListener('visibilitychange', this.boundOnVisibilityChange);

      // Single, Clean 60fps render loop initiation (Immediate first paint + single RAF chain)
      if (this.animFrameId) {
        cancelAnimationFrame(this.animFrameId);
        this.animFrameId = null;
      }
      this.renderLoop(performance.now());
    }

    /**
     * Close Rainy Window Lyrics Mode
     */
    close() {
      if (!this.isOpen) return;
      this.isOpen = false;

      if (this.animFrameId) {
        cancelAnimationFrame(this.animFrameId);
        this.animFrameId = null;
      }

      clearTimeout(this.cursorTimer);
      clearTimeout(this.exitBtnTimer);
      clearTimeout(this.stormBadgeTimer);

      window.removeEventListener('keydown', this.boundOnKeyDown, true);
      window.removeEventListener('mousemove', this.boundOnMouseMove);
      window.removeEventListener('resize', this.boundOnResize);
      document.removeEventListener('visibilitychange', this.boundOnVisibilityChange);

      if (this.overlay) {
        this.overlay.style.display = 'none';
        this.overlay.classList.remove('rainy-cursor-hidden');
      }

      if (this.exitBtn) {
        this.exitBtn.classList.remove('visible');
      }

      if (this.debugPanel) {
        this.debugPanel.classList.remove('open');
      }

      if (this.stormBadge) {
        this.stormBadge.classList.remove('visible');
      }

      this.isHoveringTopRight = false;
      this.isDebugOpen = false;
      this.draggedDrop = null;
      this.isDragging = false;
    }

    toggle() {
      if (this.isOpen) this.close();
      else this.open();
    }
  }

  // Export singleton & config
  window.RainyLyrics = new RainyLyricsController();
  window.RAINY_CONFIG = RAINY_CONFIG;
})();
