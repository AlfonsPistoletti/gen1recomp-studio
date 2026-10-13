import { store } from "../core/store.ts";
import { ATLAS_COLUMNS, BLOCK, TILE } from "../render/graphics.ts";
import { MAX_BLOCKS } from "../core/tileBrush.ts";
import type { MapView } from "../render/mapView.ts";
import { EXTENSIONS, liveTileset, tilesetKey } from "../core/tilesets.ts";
import { h } from "./dom.ts";
import { nav } from "./nav.ts";

// The current map's tileset as a grid of blocks. Click picks one block,
// drag picks a rectangle as a multi-block stamp. The Tiles view shows its
// 8x8 tiles instead, for the tile brush.
export function mountBlockPalette(host: HTMLElement, view: MapView): void {
  const title = h("span", { class: "ellipsis" }, "Blocks");
  const info = h("span", { class: "muted" }, "");
  const canvas = h("canvas", { class: "palette-canvas" });
  const wrap = h("div", { class: "palette-wrap" }, canvas);
  const zoomLabel = h("span", { class: "zoom-label" }, "100%");
  const zoomControls = h(
    "div",
    { class: "row nowrap" },
    h("button", { class: "btn small ghost", title: "Zoom out (wheel)", onclick: () => stepZoom(-1) }, "−"),
    zoomLabel,
    h("button", { class: "btn small ghost", title: "Zoom in (wheel)", onclick: () => stepZoom(1) }, "+"),
    h("button", { class: "btn small ghost", title: "Fit the panel width", onclick: () => setZoom("fit") }, "Fit"),
    h("button", { class: "btn small ghost", title: "Edit this tileset: add tiles and blocks", onclick: () => store.map && nav.openTileset(store.map.tileset) }, "Edit"),
  );
  let mode: "blocks" | "tiles" = "blocks";
  const modeButtons = (["blocks", "tiles"] as const).map((m) =>
    h("button", { class: `toggle${m === mode ? " active" : ""}`, "data-mode": m, title: m === "tiles" ? "The tileset's 8×8 tiles, for the tile brush (T)" : "The tileset's blocks", onclick: () => setMode(m) }, m === "blocks" ? "Blocks" : "Tiles"),
  );
  const setMode = (m: "blocks" | "tiles") => {
    if (m === mode) return;
    mode = m;
    for (const b of modeButtons) b.classList.toggle("active", b.dataset.mode === m);
    key = "";
    updateInfo();
    void refresh();
  };
  // the title gives way (ellipsis) before the controls wrap
  host.append(h("div", { class: "panel-head" }, h("div", { class: "row nowrap shrink" }, h("div", { class: "seg" }, ...modeButtons), title, info), zoomControls), wrap);

  // A free pan/zoom viewport like the map: the canvas is positioned inside
  // `wrap` at (offX, offY) and drawn `zoom` screen pixels per atlas pixel.
  // "Fit" fits the panel width and stays live across resizes until the user
  // zooms or pans.
  const ZOOM_KEY = "studio.paletteZoom";
  const STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4];
  const MIN_ZOOM = 0.25;
  const MAX_ZOOM = 6;
  const PAD = 8;
  let zoom = 1;
  let fit = true;
  let offX = PAD;
  let offY = PAD;
  try {
    const saved = localStorage.getItem(ZOOM_KEY);
    if (saved && saved !== "fit" && Number(saved) > 0) {
      zoom = Number(saved);
      fit = false;
    }
  } catch {
    /* storage unavailable */
  }

  // keep at least a strip of the atlas on screen
  function clampOffsets(): void {
    const cw = canvas.width * zoom;
    const ch = canvas.height * zoom;
    const vw = wrap.clientWidth;
    const vh = wrap.clientHeight;
    const keep = 48;
    offX = Math.min(Math.max(offX, keep - cw), vw - keep);
    offY = Math.min(Math.max(offY, keep - ch), vh - keep);
  }

  function fitZoom(): number {
    return canvas.width ? Math.max(MIN_ZOOM, (wrap.clientWidth - PAD * 2) / canvas.width) : MIN_ZOOM;
  }

  function applyZoom(): void {
    if (fit && canvas.width) {
      zoom = fitZoom();
      offX = PAD;
      offY = PAD;
    } else zoom = Math.max(zoom, fitZoom());
    clampOffsets();
    canvas.style.width = `${canvas.width * zoom}px`;
    canvas.style.height = `${canvas.height * zoom}px`;
    canvas.style.transform = `translate(${offX}px, ${offY}px)`;
    zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
  }

  let saveTimer = 0;
  function remember(): void {
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      try {
        localStorage.setItem(ZOOM_KEY, fit ? "fit" : String(zoom));
      } catch {
        /* storage unavailable */
      }
    }, 300);
  }

  // `anchor` is a client point that stays over the same atlas pixel.
  function setZoom(next: number | "fit", anchor?: { x: number; y: number }): void {
    if (next === "fit") {
      fit = true;
    } else {
      const r = wrap.getBoundingClientRect();
      const ax = (anchor?.x ?? r.left + r.width / 2) - r.left;
      const ay = (anchor?.y ?? r.top + r.height / 2) - r.top;
      // never smaller than fitting the panel width
      const z = Math.max(fitZoom(), Math.min(MAX_ZOOM, next));
      offX = ax - ((ax - offX) * z) / zoom;
      offY = ay - ((ay - offY) * z) / zoom;
      zoom = z;
      fit = false;
    }
    applyZoom();
    remember();
  }

  function stepZoom(dir: 1 | -1, anchor?: { x: number; y: number }): void {
    // buttons step between round levels; the wheel zooms smoothly
    const next = dir > 0 ? STEPS.find((z) => z > zoom + 0.01) : [...STEPS].reverse().find((z) => z < zoom - 0.01);
    if (next !== undefined) setZoom(next, anchor);
  }

  new ResizeObserver(() => applyZoom()).observe(wrap);

  // same feel as the map: wheel zooms around the cursor, middle- or
  // right-drag pans
  wrap.addEventListener("wheel", (e) => {
    e.preventDefault();
    const factor = Math.pow(1.0018, -e.deltaY * (e.deltaMode === 1 ? 33 : 1));
    setZoom(zoom * factor, { x: e.clientX, y: e.clientY });
  }, { passive: false });

  let pan: { x: number; y: number; offX: number; offY: number } | null = null;
  wrap.addEventListener("contextmenu", (e) => e.preventDefault());
  wrap.addEventListener("mousedown", (e) => {
    if (e.button === 1) e.preventDefault(); // no browser autoscroll
  });
  wrap.addEventListener("pointerdown", (e) => {
    if (e.button !== 1 && e.button !== 2) return;
    e.preventDefault();
    wrap.setPointerCapture(e.pointerId);
    pan = { x: e.clientX, y: e.clientY, offX, offY };
    wrap.style.cursor = "grabbing";
  });
  wrap.addEventListener("pointermove", (e) => {
    if (!pan) return;
    offX = pan.offX + (e.clientX - pan.x);
    offY = pan.offY + (e.clientY - pan.y);
    fit = false;
    applyZoom();
  });
  const endPan = () => {
    if (pan) remember();
    pan = null;
    wrap.style.cursor = "";
  };
  wrap.addEventListener("pointerup", endPan);
  wrap.addEventListener("pointercancel", endPan);

  const SCALE = 1;
  let atlasCanvas: HTMLCanvasElement | null = null;
  let count = 0;
  let key = "";
  let dragFrom: number | null = null;
  let hoverIndex: number | null = null;

  // tiles view: the tile under the pointer (the sheet's layout, `per` a row)
  let per = 16;
  const tileAt = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    const scale = canvas.width / r.width;
    const x = Math.floor(((e.clientX - r.left) * scale) / TILE);
    const y = Math.floor(((e.clientY - r.top) * scale) / TILE);
    if (x < 0 || x >= per || y < 0) return null;
    const t = y * per + x;
    return t < count ? t : null;
  };
  const outlineTile = (ctx: CanvasRenderingContext2D, t: number, color: string) => {
    ctx.strokeStyle = color;
    ctx.strokeRect((t % per) * TILE + 0.5, Math.floor(t / per) * TILE + 0.5, TILE - 1, TILE - 1);
  };

  const indexAt = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    const scale = canvas.width / r.width;
    const x = Math.floor(((e.clientX - r.left) * scale) / (BLOCK * SCALE));
    const y = Math.floor(((e.clientY - r.top) * scale) / (BLOCK * SCALE));
    if (x < 0 || x >= ATLAS_COLUMNS) return null;
    const i = y * ATLAS_COLUMNS + x;
    return i >= 0 && i < count ? i : null;
  };

  const draw = () => {
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (atlasCanvas) ctx.drawImage(atlasCanvas, 0, 0, atlasCanvas.width * SCALE, atlasCanvas.height * SCALE);
    if (mode === "tiles") {
      ctx.lineWidth = 1;
      for (const t of new Set(store.tileStamp.blocks)) if (t < count) outlineTile(ctx, t, "#ffd34d");
      if (dragFrom !== null && hoverIndex !== null) {
        const r = rect(dragFrom, hoverIndex, per);
        ctx.strokeStyle = "#4dd2ff";
        ctx.strokeRect(r.x * TILE + 0.5, r.y * TILE + 0.5, r.w * TILE - 1, r.h * TILE - 1);
      } else if (hoverIndex !== null) outlineTile(ctx, hoverIndex, "rgba(255,255,255,0.7)");
      return;
    }
    const s = store.stamp;
    // highlight blocks of the current stamp that form a palette rectangle
    const sel = new Set(s.blocks);
    ctx.lineWidth = 2;
    for (const b of sel) {
      if (b >= count) continue;
      const x = (b % ATLAS_COLUMNS) * BLOCK * SCALE;
      const y = Math.floor(b / ATLAS_COLUMNS) * BLOCK * SCALE;
      ctx.strokeStyle = "#ffd34d";
      ctx.strokeRect(x + 1, y + 1, BLOCK * SCALE - 2, BLOCK * SCALE - 2);
    }
    if (dragFrom !== null && hoverIndex !== null) {
      const r = rect(dragFrom, hoverIndex);
      ctx.strokeStyle = "#4dd2ff";
      ctx.strokeRect(r.x * BLOCK * SCALE + 1, r.y * BLOCK * SCALE + 1, r.w * BLOCK * SCALE - 2, r.h * BLOCK * SCALE - 2);
    } else if (hoverIndex !== null) {
      ctx.strokeStyle = "rgba(255,255,255,0.7)";
      ctx.strokeRect((hoverIndex % ATLAS_COLUMNS) * BLOCK * SCALE + 0.5, Math.floor(hoverIndex / ATLAS_COLUMNS) * BLOCK * SCALE + 0.5, BLOCK * SCALE - 1, BLOCK * SCALE - 1);
    }
  };

  const refresh = async () => {
    const map = store.map;
    if (!map) return;
    const palette = view.paletteKey(store.currentMap);
    const k = `${mode}|${tilesetKey(map.tileset)}|${palette}`;
    title.textContent = map.tileset;
    if (k === key) return draw();
    key = k;
    const tiles = mode === "tiles" ? await view.tileSheetFor(map.tileset, palette) : null;
    const atlas = mode === "tiles" ? null : await view.atlasFor(map.tileset, palette);
    if (key !== k) return;
    atlasCanvas = tiles?.canvas ?? atlas?.canvas ?? null;
    count = tiles?.count ?? atlas?.count ?? 0;
    per = tiles?.per ?? 16;
    updateInfo();
    canvas.width = tiles ? tiles.canvas.width : ATLAS_COLUMNS * BLOCK * SCALE;
    canvas.height = tiles ? tiles.canvas.height : Math.ceil(count / ATLAS_COLUMNS) * BLOCK * SCALE;
    applyZoom();
    draw();
  };

  const updateInfo = () => {
    if (mode === "tiles") {
      // the tile brush adds blocks: how many the tileset has of the 256 a map can use
      const blocks = store.map ? liveTileset(store.map.tileset)?.blocks.length ?? 0 : 0;
      const s = store.tileStamp;
      const what = s.w * s.h === 1 ? `$${s.blocks[0].toString(16).toUpperCase().padStart(2, "0")}` : `${s.w}×${s.h}`;
      info.textContent = `${what} · ${blocks}/${MAX_BLOCKS}`;
      info.title = `${s.w * s.h === 1 ? "Tile" : "Tiles"} ${what}. The tileset has ${blocks} blocks; a map can use ${MAX_BLOCKS}, and the tile brush adds one for each new combination of tiles.`;
      return;
    }
    const s = store.stamp;
    info.title = "";
    info.textContent = s.w * s.h === 1 ? `#${s.blocks[0]}` : `${s.w}×${s.h} stamp`;
  };

  canvas.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const i = mode === "tiles" ? tileAt(e) : indexAt(e);
    if (i === null) return;
    canvas.setPointerCapture(e.pointerId);
    dragFrom = i;
    draw();
  });
  canvas.addEventListener("pointermove", (e) => {
    hoverIndex = mode === "tiles" ? tileAt(e) : indexAt(e);
    if (hoverIndex !== null) canvas.title = mode === "tiles" ? `Tile $${hoverIndex.toString(16).toUpperCase().padStart(2, "0")}` : `Block #${hoverIndex}`;
    draw();
  });
  canvas.addEventListener("pointerleave", () => {
    hoverIndex = null;
    draw();
  });
  canvas.addEventListener("pointerup", (e) => {
    if (e.button !== 0) return;
    if (mode === "tiles") {
      // click: one tile; drag: a rectangle of tiles
      const to = tileAt(e) ?? hoverIndex;
      if (dragFrom !== null && to !== null) {
        const r = rect(dragFrom, to, per);
        const tiles: number[] = [];
        for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) tiles.push(Math.min(count - 1, (r.y + y) * per + r.x + x));
        store.setTileStamp({ w: r.w, h: r.h, blocks: tiles });
        store.setTool("tile");
      }
      dragFrom = null;
      draw();
      return;
    }
    const to = indexAt(e) ?? hoverIndex;
    if (dragFrom !== null && to !== null) {
      const r = rect(dragFrom, to);
      const blocks: number[] = [];
      for (let y = 0; y < r.h; y++) {
        for (let x = 0; x < r.w; x++) blocks.push(Math.min(count - 1, (r.y + y) * ATLAS_COLUMNS + r.x + x));
      }
      store.setStamp({ w: r.w, h: r.h, blocks });
      if (store.tool === "select") store.setTool("brush");
    }
    dragFrom = null;
    draw();
  });

  store.on((reason, id, registry) => {
    if (reason === "project" || reason === "map" || reason === "edit" || reason === "colors") refresh();
    if (reason === "content" && (registry === "tilesets" || registry === EXTENSIONS) && id === store.map?.tileset) refresh();
    if (reason === "content" && registry === "studio_roofs" && id === store.currentMap) refresh();
    if (reason === "content" && registry === "palettes") {
      key = "";
      refresh();
    }
    if (reason === "stamp") {
      updateInfo();
      draw();
    }
    // the palette follows the tool: tiles for the tile brush, blocks for the others
    if (reason === "tool" && store.tool !== "select") setMode(store.tool === "tile" ? "tiles" : "blocks");
  });
  updateInfo();
}

function rect(a: number, b: number, cols = ATLAS_COLUMNS): { x: number; y: number; w: number; h: number } {
  const ax = a % cols, ay = Math.floor(a / cols);
  const bx = b % cols, by = Math.floor(b / cols);
  return { x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(ax - bx) + 1, h: Math.abs(ay - by) + 1 };
}
