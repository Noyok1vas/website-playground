/* ============================================================
   Simple Vertical Infinite Masonry — Responsive
   - 仅纵向向下无尽滚动（滚轮 / 触控板 / 触摸拖拽）
   - 响应式列数：桌面 4 列 / 平板 3 列 / 手机 2 列
   - 边缘触发生成 + 视口虚拟化
   - 无 hover overlay、无点击跳转、无缩放、无横向平移
   Mount point:  <div id="playground-canvas"></div>
   ============================================================ */
(function () {
  "use strict";

  /* ==========================================================
     SEED DATA — w/h 必须是原图比例
     ⚠️ Playground-8 / -10 / -11 的 URL hash 段长度与其它不一致，
        若显示破图请回 Webflow Assets 重新复制完整链接。
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
  const MIN_COLS = 2;
  const MAX_COLS = 4;

  const BP_MOBILE = 640;      // < 640  → 2 列
  const BP_TABLET = 1024;     // < 1024 → 3 列，其余 4 列

  const GUTTER_DESKTOP = 24;
  const GUTTER_MOBILE = 12;
  const PAD_DESKTOP = 24;     // 画布左右留白
  const PAD_MOBILE = 12;

  const FRICTION = 0.92;      // 惯性衰减
  const BUFFER = 600;         // 视口外预生成 / 保留范围
  const MIN_VELOCITY = 0.05;
  const MIN_SEED_DISTANCE = 2200;
  const RESIZE_DEBOUNCE = 150;

  /* ---------- State ---------- */
  let seeds = [];
  let mount, world;
  let offsetY = 0;            // 只有纵向
  let velY = 0;
  let dragging = false;
  let lastY = 0;

  let cols = 0;
  let colWidth = 300;
  let gutter = GUTTER_DESKTOP;
  let sidePad = PAD_DESKTOP;

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

  /* ---------- 响应式列布局 ----------
     按视口宽度选列数（2–4），再反推列宽填满可用区域。 */
  function targetCols(vw) {
    if (vw < BP_MOBILE) return 2;
    if (vw < BP_TABLET) return 3;
    return 4;
  }

  function layoutColumns() {
    const vw = mount.clientWidth;
    const next = Math.max(MIN_COLS, Math.min(MAX_COLS, targetCols(vw)));

    gutter = vw < BP_MOBILE ? GUTTER_MOBILE : GUTTER_DESKTOP;
    sidePad = vw < BP_MOBILE ? PAD_MOBILE : PAD_DESKTOP;

    const avail = vw - sidePad * 2;
    colWidth = Math.max(1, Math.floor((avail - gutter * (next - 1)) / next));

    cols = next;
    world.style.left = sidePad + "px";
  }

  /* ---------- 视口（世界坐标，仅纵向） ---------- */
  function worldViewport() {
    const vh = mount.clientHeight;
    return {
      top: -offsetY - BUFFER,
      bot: vh - offsetY + BUFFER
    };
  }

  /* ---------- 去重分散 ----------
     遍历种子池，算每张图「最近的同款副本距离」，取最大者。
     超过 MIN_SEED_DISTANCE 的都算等价，随机选，保证布局有变化。 */
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
    const step = colWidth + gutter;
    const vp = worldViewport();

    for (let c = 0; c < cols; c++) {
      if (!colBottom.has(c)) colBottom.set(c, 0);
      while (colBottom.get(c) < vp.bot) {
        const y = colBottom.get(c);
        const seed = pick(c * step, y);
        const h = Math.round((colWidth / seed.w) * seed.h);
        addBlock(c * step, y, colWidth, h, seed);
        colBottom.set(c, y + h + gutter);
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

  /* ---------- 列宽变化后整体重建 ---------- */
  function rebuild() {
    for (const b of blocks) if (b.mounted) b.el.remove();
    blocks.length = 0;
    colBottom.clear();
    offsetY = 0;
    velY = 0;
    fill();
    render();
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
    window.addEventListener("pointercancel", onUp);
    mount.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
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

  // 只平移，不缩放。preventDefault 同时拦掉 Mac 捏合触发的浏览器页面缩放。
  function onWheel(e) {
    e.preventDefault();
    offsetY -= e.deltaY;
    velY = -e.deltaY * 0.3;
    clamp();
    fill();
    recycle();
    render();
  }

  let resizeTimer;
  function onResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      layoutColumns();
      rebuild();   // 列宽随视口连续变化，无条件重建
    }, RESIZE_DEBOUNCE);
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
