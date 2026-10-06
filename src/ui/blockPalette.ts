import { store } from "../core/store.ts";
import { ATLAS_COLUMNS, BLOCK } from "../render/graphics.ts";
import type { MapView } from "../render/mapView.ts";
import { EXTENSIONS, tilesetKey } from "../core/tilesets.ts";
import { h } from "./dom.ts";
import { nav } from "./nav.ts";

// The current map's tileset as a grid of blocks. Click picks one block,
// drag picks a rectangle as a multi-block stamp.
export function mountBlockPalette(host: HTMLElement, view: MapView): void {
  const title = h("span", {}, "Blocks");
  const info = h("span", { class: "muted" }, "");
  const canvas = h("canvas", { class: "palette-canvas" });
  const wrap = h("div", { class: "palette-wrap" }, canvas);
  const zoomLabel = h("span", { class: "zoom-label" }, "Fit");
  const zoomControls = h(
    "div",
    { class: "row nowrap" },
    h("button", { class: "btn small ghost", title: "Zoom out (wheel)", onclick: () => stepZoom(-1) }, "−"),
    zoomLabel,
    h("button", { class: "btn small ghost", title: "Zoom in (wheel)", onclick: () => stepZoom(1) }, "+"),
    h("button", { class: "btn small ghost", title: "Fit the panel width", onclick: () => setZoom("fit") }, "Fit"),
    h("button", { class: "btn small ghost", title: "Edit this tileset: add tiles and blocks", onclick: () => store.map && nav.openTileset(store.map.tileset) }, "Edit"),
  );
  host.append(h("div", { class: "panel-head" }, h("div", { class: "row nowrap" }, title, info), zoomControls), wrap);

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

  function applyZoom(): void {
    if (fit && canvas.width) {
      zoom = Math.max(MIN_ZOOM, (wrap.clientWidth - PAD * 2) / canvas.width);
      offX = PAD;
      offY = PAD;
    }
    clampOffsets();
    canvas.style.width = `${canvas.width * zoom}px`;
    canvas.style.height = `${canvas.height * zoom}px`;
    canvas.style.transform = `translate(${offX}px, ${offY}px)`;
    zoomLabel.textContent = fit ? "Fit" : `${Math.round(zoom * 100)}%`;
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
      const z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, next));
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
    const k = `${tilesetKey(map.tileset)}|${palette}`;
    title.textContent = `Blocks · ${map.tileset}`;
    if (k === key) return draw();
    key = k;
    const atlas = await view.atlasFor(map.tileset, palette);
    if (key !== k) return;
    atlasCanvas = atlas?.canvas ?? null;
    count = atlas?.count ?? 0;
    canvas.width = ATLAS_COLUMNS * BLOCK * SCALE;
    canvas.height = Math.ceil(count / ATLAS_COLUMNS) * BLOCK * SCALE;
    applyZoom();
    draw();
  };

  const updateInfo = () => {
    const s = store.stamp;
    info.textContent = s.w * s.h === 1 ? `#${s.blocks[0]}` : `${s.w}×${s.h} stamp`;
  };

  canvas.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const i = indexAt(e);
    if (i === null) return;
    canvas.setPointerCapture(e.pointerId);
    dragFrom = i;
    draw();
  });
  canvas.addEventListener("pointermove", (e) => {
    hoverIndex = indexAt(e);
    if (hoverIndex !== null) canvas.title = `Block #${hoverIndex}`;
    draw();
  });
  canvas.addEventListener("pointerleave", () => {
    hoverIndex = null;
    draw();
  });
  canvas.addEventListener("pointerup", (e) => {
    if (e.button !== 0) return;
    const to = indexAt(e) ?? hoverIndex;
    if (dragFrom !== null && to !== null) {
      const r = rect(dragFrom, to);
      const blocks: number[] = [];
      for (let y = 0; y < r.h; y++) {
        for (let x = 0; x < r.w; x++) blocks.push(Math.min(count - 1, (r.y + y) * ATLAS_COLUMNS + r.x + x));
      }
      store.setStamp({ w: r.w, h: r.h, blocks });
      if (store.tool === "select" || store.tool === "pick") store.setTool("brush");
    }
    dragFrom = null;
    draw();
  });

  store.on((reason, id, registry) => {
    if (reason === "project" || reason === "map" || reason === "edit" || reason === "colors") refresh();
    if (reason === "content" && (registry === "tilesets" || registry === EXTENSIONS) && id === store.map?.tileset) refresh();
    if (reason === "stamp") {
      updateInfo();
      draw();
    }
  });
  updateInfo();
}

function rect(a: number, b: number): { x: number; y: number; w: number; h: number } {
  const ax = a % ATLAS_COLUMNS, ay = Math.floor(a / ATLAS_COLUMNS);
  const bx = b % ATLAS_COLUMNS, by = Math.floor(b / ATLAS_COLUMNS);
  return { x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(ax - bx) + 1, h: Math.abs(ay - by) + 1 };
}
