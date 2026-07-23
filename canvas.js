/* ============================================================
   Playground Infinite Canvas
   - Two-axis drag pan + momentum
   - Wheel zoom (1.0 → 1.5), anchored at cursor
   - Edge-triggered masonry block generation (samples from seed pool)
   - Viewport virtualization (recycles off-screen blocks)
   - Hover overlay (desktop only)
   ------------------------------------------------------------
   Mount point expected in the page:  <div id="playground-canvas"></div>
   Seed data loaded from BLOCKS_URL below.
   ============================================================ */
(function () {
  "use strict";

  /* ---------- Config ---------- */
  const BLOCKS_URL =
    "https://raw.githubusercontent.com/Noyok1vas/website-playground/main/blocks.json";
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

    fetch(BLOCKS_URL)
      .then((r) => r.json())
      .then((data) => {
        seeds = data;
        seedInitial();
        bindEvents();
        render();
        requestAnimationFrame(loop);
      })
      .catch((err) => console.error("[canvas] failed to load blocks.json", err));
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

  /* ---------- Seed pool ---------- */
  function pick() {
    return seeds[Math.floor(Math.random() * seeds.length)];
  }

  function fill() {
    const step = COL_WIDTH + GUTTER;
    const vp = worldViewport();
    const first = Math.floor(vp.left / step);
    const last = Math.ceil(vp.right / step);

    for (let c = first; c <= last; c++) {
      if (!colBottom.has(c)) colBottom.set(c, 0);
      while (colBottom.get(c) < vp.bot) {
        const seed = pick();
        const h = Math.round((COL_WIDTH / seed.w) * seed.h);
        const y = colBottom.get(c);
        addBlock(c * step, y, COL_WIDTH, h, seed);
        colBottom.set(c, y + h + GUTTER);
      }
      if (!colTop.has(c)) colTop.set(c, 0);
      while (colTop.get(c) > vp.top) {
        const seed = pick();
        const h = Math.round((COL_WIDTH / seed.w) * seed.h);
        const y = colTop.get(c) - GUTTER - h;
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
    blocks.push({ el, x, y, w, h, mounted: true });
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
        font-weight: 100;
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
