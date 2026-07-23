/* ============================================================
   Playground Infinite Canvas
   - Two-axis drag pan + momentum
   - Wheel zoom (1.0 → 1.5), anchored at cursor
   - Edge-triggered masonry block generation (samples from seed pool)
   - Viewport virtualization (recycles off-screen blocks)
   - Hover overlay (desktop only)
   ------------------------------------------------------------
   Mount point expected in the page:  <div id="playground-canvas"></div>
   To update images: edit SEED_DATA below, push to GitHub,
   then update the commit hash in the Webflow Code Embed src.
   ============================================================ */
(function () {
  "use strict";

  /* ==========================================================
     SEED DATA — edit this list to change images in the canvas.
     w/h = original image dimensions (ratio must be correct).
     ========================================================== */
  const SEED_DATA = [
    { src: "https://cdn.prod.website-files.com/69954c8c0f8eb8435c19885c/6a615bfd5d480003d2a684b1_Playground-1.png",  w: 1000, h: 1000, name: "Ossyn",               desc: "2024 | Lighting" },
    { src: "https://cdn.prod.website-files.com/69954c8c0f8eb8435c19885c/6a615bfc4744edda3224da25_Playground-2.png", w: 1000, h: 1000, name: "Morph",               desc: "2025 | Bluetooth Mouse" },
    { src: "https://cdn.prod.website-files.com/69954c8c0f8eb8435c19885c/6a615bfc409f1fdb7f5d3609_Playground-3.png", w: 1000, h: 1000, name: "Soma",                desc: "2025 | CMF Strategy" },
    { src: "https://cdn.prod.website-files.com/69954c8c0f8eb8435c19885c/6a615bfc22dad98433ad5e54_Playground-4.png", w: 1000, h: 1000, name: "YANG Design CMF Lab", desc: "2024 | CMF Internship" },
    { src: "https://cdn.prod.website-files.com/69954c8c0f8eb8435c19885c/6a615bfc09a38d01e4350854_Playground-5.png", w: 1000, h: 1000, name: "Collage-04",          desc: "2025 | Form Study" },
    { src: "https://cdn.prod.website-files.com/69954c8c0f8eb8435c19885c/6a615bfcf595ae3342bedd93_Playground-6.png", w: 1000, h: 1000, name: "Nijimu",              desc: "2026 | Website, Interactive Experience" },
    { src: "https://cdn.prod.website-files.com/69954c8c0f8eb8435c19885c/6a615bfccde09d40acc84507_Playground-7.png", w: 1000, h: 1000, name: "Orbit of Emotion",    desc: "2025 | Interactive Experience" },
    { src: "https://cdn.prod.website-files.com/69954c8c0f8eb8435c19885c/6a615bfd5d480003d2a684b4_Playground-8.png",   w: 1000, h: 1500, name: "Speedform",            desc: "2025 | Form Study" },
    { src: "https://cdn.prod.website-files.com/69954c8c0f8eb8435c19885c/6a615bfca6e0c118244768d1_Playground-9.png",w: 1000, h: 1500, name: "Collage-01",           desc: "Photography" },
    { src: "https://cdn.prod.website-files.com/69954c8c0f8eb8435c19885c/6a615bfd79d9b5b6c1ff3761_Playground-10.png", w: 1000, h: 1500, name: "Collage-02",      desc: "Photography" },
    { src: "https://cdn.prod.website-files.com/69954c8c0f8eb8435c19885c/6a615bfcc57d9851e84de2a5_Playground-11.png",   w: 1000, h: 1500, name: "Collage-03",       desc: "Photography" },
    { src: "https://cdn.prod.website-files.com/69954c8c0f8eb8435c19885c/6a615bfc43e1172472097e6f_Playground-12.png",  w: 1000, h: 1500, name: "Vroom-vroom",       desc: "2025 | Formula-e RC Car" }
  ];

  /* ---------- Config ---------- */
  const COL_WIDTH = 300;      // px, width of one masonry column
  const GUTTER = 24;          // px, gap between blocks
  const FRICTION = 0.92;      // momentum decay per frame (0.9 loose … 0.95 slippery)
  const BUFFER = 600;         // px, how far beyond viewport (world units) to keep/generate
  const MIN_VELOCITY = 0.05;  // px/frame, below this momentum stops
  const ZOOM_MIN = 1.0;       // no zooming out past default
  const ZOOM_MAX = 1.5;       // max zoom in
  const ZOOM_SPEED = 0.0015;  // wheel delta -> scale change

  /* ---------- State ---------- */
  let seeds = [];
  let mount, world;
  let offsetX = 0, offsetY = 0;   // world translation in *screen* px
  let scale = 1;                  // current zoom
  let velX = 0, velY = 0;
  let dragging = false;
  let lastX = 0, lastY = 0;
  let moved = false;

  const colBottom = new Map();
  const colTop = new Map();
  const blocks = [];

  /* ---------- Boot ---------- */
  function init() {
    mount = document.getElementById("playground-canvas");
    if (!mount) {
      console.warn("[canvas] #playground-canvas not found");
      return;
    }
    injectStyles();

    world = document.createElement("div");
    world.className = "pg-world";
    mount.appendChild(world);

    seeds = SEED_DATA;
    seedInitial();
    bindEvents();
    render();
    requestAnimationFrame(loop);
  }

  /* ---------- Coordinate helpers ----------
     A point at world coord (wx, wy) shows on screen at:
       sx = wx * scale + offsetX
     So the world coords currently visible span:
       wx in [ (0 - offsetX)/scale , (vw - offsetX)/scale ]
     BUFFER is applied in world units. */
  function worldViewport() {
    const vw = mount.clientWidth;
    const vh = mount.clientHeight;
    return {
      left: (-offsetX) / scale - BUFFER,
      right: (vw - offsetX) / scale + BUFFER,
      top: (-offsetY) / scale - BUFFER,
      bot: (vh - offsetY) / scale + BUFFER,
    };
  }

  /* ---------- Seed pool ----------
     Instead of picking at random (which lets the same image land next to
     itself), score every seed by how far away its nearest existing copy is
     and take the best. Ties are broken randomly so the layout still varies.
     MIN_SEED_DISTANCE is the radius we actively try to keep clear; any seed
     whose nearest copy is beyond that is considered equally good.        */
  const MIN_SEED_DISTANCE = 2200; // world px — raise to spread copies further

  function pick(x, y) {
    let best = [];
    let bestDist = -1;

    for (const seed of seeds) {
      let nearest = Infinity;
      for (const b of blocks) {
        if (b.seed !== seed) continue;
        const dx = b.x - x;
        const dy = b.y - y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < nearest) nearest = d;
        if (nearest <= 1) break; // already on top of a copy, can't get worse
      }
      // Everything past the threshold counts as "far enough" so we don't
      // always favour the single most-distant image.
      const score = Math.min(nearest, MIN_SEED_DISTANCE);
      if (score > bestDist) {
        bestDist = score;
        best = [seed];
      } else if (score === bestDist) {
        best.push(seed);
      }
    }

    if (!best.length) return seeds[Math.floor(Math.random() * seeds.length)];
    return best[Math.floor(Math.random() * best.length)];
  }

  function fill() {
    const step = COL_WIDTH + GUTTER;
    const vp = worldViewport();
    const first = Math.floor(vp.left / step);
    const last = Math.ceil(vp.right / step);

    for (let c = first; c <= last; c++) {
      if (!colBottom.has(c)) colBottom.set(c, 0);
      while (colBottom.get(c) < vp.bot) {
        const y = colBottom.get(c);
        const seed = pick(c * step, y);
        const h = Math.round((COL_WIDTH / seed.w) * seed.h);
        addBlock(c * step, y, COL_WIDTH, h, seed);
        colBottom.set(c, y + h + GUTTER);
      }
      if (!colTop.has(c)) colTop.set(c, 0);
      while (colTop.get(c) > vp.top) {
        const probeY = colTop.get(c);
        const seed = pick(c * step, probeY);
        const h = Math.round((COL_WIDTH / seed.w) * seed.h);
        const y = probeY - GUTTER - h;
        addBlock(c * step, y, COL_WIDTH, h, seed);
        colTop.set(c, y);
      }
    }
  }

  function seedInitial() { fill(); }

  /* ---------- Block DOM ---------- */
  function addBlock(x, y, w, h, seed) {
    const el = document.createElement("div");
    el.className = "pg-block";
    el.style.width = w + "px";
    el.style.height = h + "px";
    el.style.transform = `translate(${x}px, ${y}px)`;

    const img = document.createElement("img");
    img.className = "pg-img";
    img.loading = "lazy";
    img.src = seed.src;
    el.appendChild(img);

    if (seed.name || seed.desc) {
      const ov = document.createElement("div");
      ov.className = "pg-overlay";
      ov.innerHTML =
        (seed.name ? `<div class="pg-name">${escapeHtml(seed.name)}</div>` : "") +
        (seed.desc ? `<div class="pg-desc">${escapeHtml(seed.desc)}</div>` : "");
      el.appendChild(ov);
    }

    world.appendChild(el);
    blocks.push({ el, x, y, w, h, seed, mounted: true });
  }

  function recycle() {
    const vp = worldViewport();
    for (const b of blocks) {
      const visible =
        b.x + b.w > vp.left && b.x < vp.right &&
        b.y + b.h > vp.top && b.y < vp.bot;
      if (visible && !b.mounted) {
        world.appendChild(b.el);
        b.mounted = true;
      } else if (!visible && b.mounted) {
        b.el.remove();
        b.mounted = false;
      }
    }
  }

  /* ---------- Render ---------- */
  function render() {
    world.style.transform =
      `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
  }

  /* ---------- Loop (momentum) ---------- */
  function loop() {
    if (!dragging && (Math.abs(velX) > MIN_VELOCITY || Math.abs(velY) > MIN_VELOCITY)) {
      offsetX += velX;
      offsetY += velY;
      velX *= FRICTION;
      velY *= FRICTION;
      fill();
      recycle();
      render();
    }
    requestAnimationFrame(loop);
  }

  /* ---------- Input ---------- */
  function bindEvents() {
    mount.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    mount.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("resize", () => { fill(); recycle(); });
  }

  function onDown(e) {
    dragging = true;
    moved = false;
    velX = velY = 0;
    lastX = e.clientX;
    lastY = e.clientY;
    mount.style.cursor = "grabbing";
    mount.setPointerCapture && mount.setPointerCapture(e.pointerId);
  }

  function onMove(e) {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) moved = true;
    offsetX += dx;
    offsetY += dy;
    velX = dx;
    velY = dy;
    lastX = e.clientX;
    lastY = e.clientY;
    fill();
    recycle();
    render();
  }

  function onUp() {
    if (!dragging) return;
    dragging = false;
    mount.style.cursor = "grab";
  }

  // Wheel = zoom, anchored at cursor. Clamped to [ZOOM_MIN, ZOOM_MAX].
  // wheel event carries two intents, distinguished by ctrlKey:
  //   ctrlKey === true  -> ZOOM  (Mac trackpad pinch, or PC Ctrl + wheel)
  //   ctrlKey === false -> PAN   (Mac trackpad two-finger slide, or PC mouse wheel)
  function onWheel(e) {
    e.preventDefault();

    if (e.ctrlKey) {
      // ----- Zoom, anchored at cursor -----
      const rect = mount.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;

      const prev = scale;
      let next = scale - e.deltaY * ZOOM_SPEED;
      next = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, next));
      if (next === prev) return;

      // Keep the world point under the cursor fixed through the zoom.
      const wx = (cx - offsetX) / prev;
      const wy = (cy - offsetY) / prev;
      scale = next;
      offsetX = cx - wx * scale;
      offsetY = cy - wy * scale;
      velX = velY = 0;
    } else {
      // ----- Pan (both axes) -----
      offsetX -= e.deltaX;
      offsetY -= e.deltaY;
      // light momentum carry so trackpad flicks glide a little
      velX = -e.deltaX * 0.3;
      velY = -e.deltaY * 0.3;
    }

    fill();
    recycle();
    render();
  }

  /* ---------- Utils ---------- */
  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function injectStyles() {
    const css = `
      #playground-canvas {
        position: fixed; inset: 0; overflow: hidden;
        touch-action: none; cursor: grab; background: #141414;
        user-select: none; -webkit-user-select: none;
      }
      .pg-world {
        position: absolute; top: 0; left: 0;
        transform-origin: 0 0; will-change: transform;
      }
      .pg-block {
        position: absolute; top: 0; left: 0;
        overflow: hidden; background: #1c1c1c;
        border: 1px solid rgba(255,255,255,0.12);
        will-change: transform;
      }
      .pg-img {
        width: 100%; height: 100%; object-fit: cover; display: block;
        pointer-events: none; -webkit-user-drag: none;
      }
      .pg-overlay {
        position: absolute; left: 0; right: 0; bottom: 0; height: 40%;
        display: flex; flex-direction: column; justify-content: flex-end;
        padding: 16px;
        background: linear-gradient(to top, rgba(0,0,0,0.85), rgba(0,0,0,0));
        opacity: 0; transition: opacity 0.3s ease;
        pointer-events: none;
        font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
        font-weight: 300;
      }
      .pg-name { color: #fff; font-size: 1.333rem; line-height: 1.2; }
      .pg-desc { color: rgba(255,255,255,0.75); font-size: 0.75rem; margin-top: 4px; }
      @media (hover: hover) {
        .pg-block:hover .pg-overlay { opacity: 1; }
      }
    `;
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
  }

  /* ---------- Go ---------- */
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
