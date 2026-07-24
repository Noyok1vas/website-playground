/* ============================================================
   Simple Vertical Infinite Masonry
   - 仅纵向向下无尽滚动（滚轮 / 触控板 / 触摸拖拽）
   - 边缘触发生成 + 视口虚拟化
   - 无 hover overlay、无点击跳转、无缩放、无横向平移
   Mount point:  <div id="playground-canvas"></div>
   ============================================================ */
(function () {
  "use strict";

  /* ==========================================================
     SEED DATA — w/h 必须是原图比例
     ========================================================== */
  const SEED_DATA = [
    { src: "https://cdn.prod.website-files.com/69954c8c0f8eb8435c19885c/6a615bfd5d480003d2a684b1_Playground-1.png",  w: 1000, h: 1000 },
    { src: "https://cdn.prod.website-files.com/69954c8c0f8eb8435c19885c/6a615bfc4744edba3224da25_Playground-2.png",  w: 1000, h: 1000 },
    { src: "https://cdn.prod.website-files.com/69954c8c0f8eb8435c19885c/6a615bfc409f1fdb7f5d3609_Playground-3.png",  w: 1000, h: 1000 },
    { src: "https://cdn.prod.website-files.com/69954c8c0f8eb8435c19885c/6a615bfc22dad98433ad5e54_Playground-4.png",  w: 1000, h: 1000 },
    { src: "https://cdn.prod.website-files.com/69954c8c0f8eb8435c19885c/6a615bfc09a38d01e4350854_Playground-5.png",  w: 1000, h: 1000 },
    { src: "https://cdn.prod.website-files.com/69954c8c0f8eb8435c19885c/6a615bfcf595ae3342bedd93_Playground-6.png",  w: 1000, h: 1000 },
    { src: "https://cdn.prod.website-files.com/69954c8c0f8eb8435c19885c/6a615bfccde09d40acc84507_Playground-7.png",  w: 1000, h: 1000 },
    { src: "https://cdn.prod.website-files.com/69954c8c0f8eb8435c19885c/6a615bfc48003d2a684b4_Playground-8.png",     w: 1000, h: 1500 },
    { src: "https://cdn.prod.website-files.com/69954c8c0f8eb8435c19885c/6a615bfca6e0c118244768d1_Playground-9.png",  w: 1000, h: 1500 },
    { src: "https://cdn.prod.website-files.com/69954c8c0f8eb8435c19885c/6a615bfc6fb79d9b5b6c1ff3761_Playground-10.png", w: 1000, h: 1500 },
    { src: "https://cdn.prod.website-files.com/69954c8c0f8eb8435c19885c/6a615bfcc57d9851e84de2a5_Playground-11.png", w: 1000, h: 1500 },
    { src: "https://cdn.prod.website-files.com/69954c8c0f8eb8435c19885c/6a615bfc43e1172472097e6f_Playground-12.png", w: 1000, h: 1500 }
  ];

  /* ---------- Config ---------- */
  const COL_WIDTH = 300;
  const GUTTER = 24;
  const FRICTION = 0.92;
  const BUFFER = 600;
  const MIN_VELOCITY = 0.05;
  const MIN_SEED_DISTANCE = 2200;

  /* ---------- State ---------- */
  let seeds = [];
  let mount, world;
  let offsetY = 0;      // 只有纵向
  let velY = 0;
  let dragging = false;
  let lastY = 0;
  let cols = 0;         // 列数，随视口宽度算

  const colBottom = new Map();
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
    layoutColumns();
    fill();
    bindEvents();
    render();
    requestAnimationFrame(loop);
  }

  /* ---------- 列布局：横向居中，不可横向移动 ---------- */
  function layoutColumns() {
    const step = COL_WIDTH + GUTTER;
    const vw = mount.clientWidth;
    cols = Math.max(1, Math.floor((vw + GUTTER) / step));
    const totalW = cols * step - GUTTER;
    world.style.left = Math.round((vw - totalW) / 2) + "px";
  }

  /* ---------- 视口（世界坐标，仅纵向） ---------- */
  function worldViewport() {
    const vh = mount.clientHeight;
    return {
      top: -offsetY - BUFFER,
      bot: vh - offsetY + BUFFER
    };
  }

  /* ---------- 去重分散：只按纵向距离算 ---------- */
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
        if (nearest <= 1) break;
      }
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

  /* ---------- 只向下生成 ---------- */
  function fill() {
    const step = COL_WIDTH + GUTTER;
    const vp = worldViewport();

    for (let c = 0; c < cols; c++) {
      if (!colBottom.has(c)) colBottom.set(c, 0);
      while (colBottom.get(c) < vp.bot) {
        const y = colBottom.get(c);
        const seed = pick(c * step, y);
        const h = Math.round((COL_WIDTH / seed.w) * seed.h);
        addBlock(c * step, y, COL_WIDTH, h, seed);
        colBottom.set(c, y + h + GUTTER);
      }
    }
  }

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

    world.appendChild(el);
    blocks.push({ el, x, y, w, h, seed, mounted: true });
  }

  function recycle() {
    const vp = worldViewport();
    for (const b of blocks) {
      const visible = b.y + b.h > vp.top && b.y < vp.bot;
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
    world.style.transform = `translateY(${offsetY}px)`;
  }

  /* ---------- 顶部夹紧：不能往上超出起点 ---------- */
  function clamp() {
    if (offsetY > 0) {
      offsetY = 0;
      velY = 0;
    }
  }

  /* ---------- Loop (momentum) ---------- */
  function loop() {
    if (!dragging && Math.abs(velY) > MIN_VELOCITY) {
      offsetY += velY;
      velY *= FRICTION;
      clamp();
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
    window.addEventListener("resize", onResize);
  }

  function onDown(e) {
    dragging = true;
    velY = 0;
    lastY = e.clientY;
    mount.style.cursor = "grabbing";
    mount.setPointerCapture && mount.setPointerCapture(e.pointerId);
  }

  function onMove(e) {
    if (!dragging) return;
    const dy = e.clientY - lastY;
    offsetY += dy;
    velY = dy;
    lastY = e.clientY;
    clamp();
    fill();
    recycle();
    render();
  }

  function onUp() {
    if (!dragging) return;
    dragging = false;
    mount.style.cursor = "grab";
  }

  function onWheel(e) {
    e.preventDefault();
    offsetY -= e.deltaY;
    velY = -e.deltaY * 0.3;
    clamp();
    fill();
    recycle();
    render();
  }

  function onResize() {
    layoutColumns();
    fill();
    recycle();
  }

  /* ---------- Styles ---------- */
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
