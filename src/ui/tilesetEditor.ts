// Tilesets workspace: the tile sheet (with which tiles you can walk on), the
// blocks built from it, and a 4x4 composer for one block.
//
// Vanilla tilesets are read-only, but a mod can add tiles and blocks to them
// (the studio_tilesets registry, see src/core/tilesets.ts): the additions go
// after the vanilla ones, so maps keep working and every engine rule tied to
// the tileset's id still applies. The mod's own tilesets (imported from a PNG)
// are records of the tilesets registry and can be edited freely.

import { store } from "../core/store.ts";
import { addAsset } from "../core/assets.ts";
import { clone } from "../core/merge.ts";
import type { TilesetDef } from "../core/types.ts";
import {
  EXTENSIONS, extensionOf, isBaseTileset, liveTileset, perRow, sheetTiles, SHADE_GRAY, tilesetIds, tilesetKey, tilesetUrl,
  type TilesetExtension,
} from "../core/tilesets.ts";
import { blockAtlas, loadImage, markerIcon, BLOCK, TILE, ATLAS_COLUMNS, type BlockAtlas } from "../render/graphics.ts";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Footprints } from "lucide";
import type { Rgb } from "../render/color.ts";
import { clear, field, h, toast } from "./dom.ts";
import { mountRecordList } from "./recordList.ts";
import { nav } from "./nav.ts";

const SHEET_ZOOM = 4;
const BLOCK_ZOOM = 2;
const SLOT = 40; // composer tile size, px
// Gen 1 collision is per 16x16 cell (a quarter of a block): the cell's
// bottom-left tile decides it. Slots of a block, per cell (top-left first).
const COLLISION_SLOTS = [4, 6, 12, 14];
const ARROWS = { up: ArrowUp, down: ArrowDown, left: ArrowLeft, right: ArrowRight };

// a walk / ledge mark on a canvas: the icon on a dark disc (null until the
// icon image has loaded; `ready` redraws then)
function drawMark(ctx: CanvasRenderingContext2D, kind: string, cx: number, cy: number, size: number, ready: () => void): void {
  const walk = kind === "walk";
  const node = walk ? Footprints : ARROWS[kind as keyof typeof ARROWS];
  if (!node) return;
  const img = markerIcon(`tiles-${kind}`, node, walk ? "#3cdc6e" : "#ffb340", ready);
  ctx.fillStyle = "rgba(10, 12, 16, 0.72)";
  ctx.beginPath();
  ctx.arc(cx, cy, size * 0.62, 0, Math.PI * 2);
  ctx.fill();
  if (img) ctx.drawImage(img, cx - size / 2, cy - size / 2, size, size);
}
const ANIMATIONS = ["TILEANIM_NONE", "TILEANIM_WATER", "TILEANIM_WATER_FLOWER"];

// ------------------------------------------------------------------ model

const tilesetsTable = () => store.table("tilesets") as Record<string, TilesetDef>;

// what the editor may change: everything of the mod's own tilesets; for a
// vanilla one only what the mod added
interface Editable {
  own: boolean;
  firstTile: number;
  firstBlock: number;
}

function editable(id: string): Editable {
  const base = tilesetsTable()[id];
  if (!isBaseTileset(id)) return { own: true, firstTile: 0, firstBlock: 0 };
  return { own: false, firstTile: sheetTiles(base), firstBlock: base.blocks.length };
}

function mapsUsing(id: string): string[] {
  return Object.keys(store.maps).filter((m) => store.maps[m].tileset === id).sort();
}

// highest block id any map on this tileset uses
function highestBlockUsed(id: string): number {
  let max = -1;
  for (const m of mapsUsing(id)) {
    const map = store.maps[m];
    for (const b of map.blocks) if (b > max) max = b;
    if (typeof map.borderBlock === "number" && map.borderBlock > max) max = map.borderBlock;
  }
  return max;
}

// Edits the additions of a vanilla tileset (creating them on first use) or
// the mod's own tileset record.
function editTileset(id: string, label: string, mutate: (t: { blocks: number[][]; walkable: number[]; tiles?: string[]; rec?: TilesetDef }) => void): void {
  if (isBaseTileset(id)) {
    const base = tilesetsTable()[id];
    store.editRecord<TilesetExtension>(EXTENSIONS, id, label, (d) => {
      d.walkable ??= [];
      mutate(d as { blocks: number[][]; walkable: number[]; tiles: string[] });
    }, { create: () => ({ first: sheetTiles(base), tiles: [], blocks: [], walkable: [] }) });
  } else {
    store.editRecord<TilesetDef>("tilesets", id, label, (d) => {
      d.walkable ??= [];
      mutate({ blocks: d.blocks, walkable: d.walkable as number[], rec: d });
    });
  }
  store.seal();
}

// ------------------------------------------------------------------ pixels

interface Sheet {
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
}

async function readSheet(url: string): Promise<Sheet | null> {
  const img = await loadImage(url);
  if (!img) return null;
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  return { width: img.width, height: img.height, rgba: ctx.getImageData(0, 0, img.width, img.height).data };
}

// shade index 0 (darkest) .. 3 (lightest) of a gray, like the map renderer
function shadeOf(gray: number): number {
  return gray < 43 ? 0 : gray < 128 ? 1 : gray < 213 ? 2 : 3;
}

// The sheet drawn with the map palette (or as is, for full-color sheets).
function colorSheet(sheet: Sheet, colors: Rgb[] | null): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = sheet.width;
  c.height = sheet.height;
  const ctx = c.getContext("2d")!;
  const out = ctx.createImageData(sheet.width, sheet.height);
  for (let i = 0; i < sheet.width * sheet.height; i++) {
    const o = i * 4;
    if (colors) {
      const col = colors[shadeOf(sheet.rgba[o])];
      out.data[o] = col[0];
      out.data[o + 1] = col[1];
      out.data[o + 2] = col[2];
    } else {
      out.data[o] = sheet.rgba[o];
      out.data[o + 1] = sheet.rgba[o + 1];
      out.data[o + 2] = sheet.rgba[o + 2];
    }
    out.data[o + 3] = 255;
  }
  ctx.putImageData(out, 0, 0);
  return c;
}

// one 8x8 tile as a comparable key: shade digits (0 white .. 3 black), or the
// raw colors of a full-color sheet
function tileKey(rgba: Uint8ClampedArray, stride: number, x0: number, y0: number, trueColor: boolean): string {
  let s = "";
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const o = ((y0 + y) * stride + x0 + x) * 4;
      if (trueColor) s += `${rgba[o]},${rgba[o + 1]},${rgba[o + 2]};`;
      else s += String(3 - shadeOf(rgba[o]));
    }
  }
  return s;
}

function bytesOf(canvas: HTMLCanvasElement): Uint8Array {
  const bin = atob(canvas.toDataURL("image/png").split(",")[1] ?? "");
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// An imported picture cut into tiles: quantized to the 4 shades unless full
// color, cropped to whole tiles. `grid[ty][tx]` = index into `tiles`.
interface Cut {
  cols: number;
  rows: number;
  tiles: { key: string; px: Uint8ClampedArray }[];
  grid: number[][];
}

function cutPicture(img: HTMLImageElement, trueColor: boolean): Cut {
  const cols = Math.floor(img.width / TILE);
  const rows = Math.floor(img.height / TILE);
  const c = document.createElement("canvas");
  c.width = cols * TILE;
  c.height = rows * TILE;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, c.width, c.height);
  const px = data.data;
  if (!trueColor) {
    for (let i = 0; i < px.length; i += 4) {
      const lum = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
      const g = SHADE_GRAY[3 - Math.min(3, Math.floor(lum / 64))];
      px[i] = px[i + 1] = px[i + 2] = g;
      px[i + 3] = 255;
    }
  }
  const tiles: Cut["tiles"] = [];
  const byKey = new Map<string, number>();
  const grid: number[][] = [];
  for (let ty = 0; ty < rows; ty++) {
    const row: number[] = [];
    for (let tx = 0; tx < cols; tx++) {
      const key = tileKey(px, c.width, tx * TILE, ty * TILE, trueColor);
      let i = byKey.get(key);
      if (i === undefined) {
        const one = new Uint8ClampedArray(TILE * TILE * 4);
        for (let y = 0; y < TILE; y++) one.set(px.subarray(((ty * TILE + y) * c.width + tx * TILE) * 4, ((ty * TILE + y) * c.width + tx * TILE + TILE) * 4), y * TILE * 4);
        i = tiles.length;
        tiles.push({ key, px: one });
        byKey.set(key, i);
      }
      row.push(i);
    }
    grid.push(row);
  }
  return { cols, rows, tiles, grid };
}

// every whole 32x32 square of the picture as a block of tile ids
function blocksOf(cut: Cut, idOf: (tile: number) => number): number[][] {
  const out: number[][] = [];
  for (let by = 0; by + 4 <= cut.rows; by += 4) {
    for (let bx = 0; bx + 4 <= cut.cols; bx += 4) {
      const b: number[] = [];
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) b.push(idOf(cut.grid[by + y][bx + x]));
      out.push(b);
    }
  }
  return out;
}

// A sheet image (16 tiles a row) from RGBA tiles.
function sheetCanvas(tiles: Uint8ClampedArray[]): HTMLCanvasElement {
  const per = 16;
  const c = document.createElement("canvas");
  c.width = per * TILE;
  c.height = Math.max(1, Math.ceil(tiles.length / per)) * TILE;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  tiles.forEach((px, i) => {
    const img = ctx.createImageData(TILE, TILE);
    img.data.set(px);
    ctx.putImageData(img, (i % per) * TILE, Math.floor(i / per) * TILE);
  });
  return c;
}

// the tiles of a sheet as RGBA, in id order
function sheetTileList(sheet: Sheet, per: number, count: number): Uint8ClampedArray[] {
  const out: Uint8ClampedArray[] = [];
  for (let t = 0; t < count; t++) {
    const x0 = (t % per) * TILE;
    const y0 = Math.floor(t / per) * TILE;
    const one = new Uint8ClampedArray(TILE * TILE * 4);
    for (let y = 0; y < TILE; y++) {
      if (y0 + y >= sheet.height) break;
      one.set(sheet.rgba.subarray(((y0 + y) * sheet.width + x0) * 4, ((y0 + y) * sheet.width + x0 + TILE) * 4), y * TILE * 4);
    }
    out.push(one);
  }
  return out;
}

function pickFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = h("input", { type: "file", accept: "image/png,image/gif,image/bmp,image/webp" });
    input.addEventListener("change", () => resolve(input.files?.[0] ?? null));
    input.click();
  });
}

function fileImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`${file.name} is not an image the browser can read`));
    img.src = URL.createObjectURL(file);
  });
}

// ------------------------------------------------------------------ workspace

export function mountTilesetWorkspace(left: HTMLElement, center: HTMLElement, right: HTMLElement): void {
  let current: string | null = null;
  let selTile: number | null = null;
  let selBlock: number | null = null;
  let showCollision = true;

  const newBtn = h("button", { class: "btn small", title: "A new tileset from a picture", onclick: () => void newTileset() }, "+ New");
  const list = mountRecordList(left, {
    title: "Tilesets",
    head: [newBtn],
    placeholder: "Search tilesets…",
    searchId: "tilesets-search",
    items: () =>
      tilesetIds().map((id) => {
        const ext = extensionOf(id);
        const own = !isBaseTileset(id);
        return {
          id,
          label: id,
          meta: own ? "mod" : ext ? `+${ext.tiles.length} tiles, +${ext.blocks.length} blocks` : `${mapsUsing(id).length} maps`,
          edited: !own && !!ext,
          isNew: own,
        };
      }),
    current: () => current,
    pick: (id) => open(id),
    refreshOn: (reason, _id, registry) => reason === "content" && (registry === "tilesets" || registry === EXTENSIONS),
  });

  const title = h("span", { class: "head-title" }, "Tilesets");
  const headTools = h("div", { class: "row nowrap" });
  const main = h("div", { class: "ws-scroll tileset-main" });
  const side = h("div", { class: "ws-scroll" });
  center.append(h("div", { class: "panel-head" }, title, headTools), main);
  right.append(h("div", { class: "panel-head" }, h("span", {}, "Tile & block")), side);

  const open = (id: string) => {
    if (!tilesetsTable()[id]) return;
    if (current !== id) {
      selTile = null;
      selBlock = null;
    }
    current = id;
    list.render();
    void render();
    left.querySelector<HTMLElement>(`.map-row[data-id="${id}"]`)?.scrollIntoView({ block: "nearest" });
  };
  nav.openTileset = (id) => {
    nav.setWorkspace("tilesets");
    open(id);
  };

  // the palette blocks are shown in: a map on this tileset (the current one
  // if it is), else the route palette
  const paletteKey = (id: string): string => {
    const onIt = store.map?.tileset === id ? store.currentMap : mapsUsing(id)[0];
    return (onIt && store.palettes[onIt]) || "ROUTE";
  };

  // ---------------------------------------------------------------- render
  let token = 0;
  const render = async () => {
    const my = ++token;
    const id = current;
    clear(headTools);
    if (!id || !store.project) {
      title.textContent = "Tilesets";
      clear(main);
      clear(side);
      main.append(h("p", { class: "hint empty" }, "Pick a tileset on the left."));
      return;
    }
    const ts = liveTileset(id)!;
    const ed = editable(id);
    const per = perRow(ts);
    const palette = paletteKey(id);
    const colorsFor = store.adapter.tileColors(store.ctx, ts, palette);
    const url = await tilesetUrl(id);
    const sheet = await readSheet(url);
    const atlas = await blockAtlas(ts, url, palette, colorsFor, tilesetKey(id));
    if (my !== token) return;
    title.textContent = id;
    const capacity = sheet ? Math.floor(sheet.width / TILE) * Math.floor(sheet.height / TILE) : 0;
    // an extended sheet ends with the last added tile (the rest of its row is padding)
    const tileCount = ed.own ? capacity : Math.min(capacity, ed.firstTile + (extensionOf(id)?.tiles.length ?? 0));
    if (selTile !== null && selTile >= tileCount) selTile = null;
    if (selBlock !== null && selBlock >= ts.blocks.length) selBlock = null;

    headTools.append(
      h("button", { class: "btn small", title: "Add tiles (and blocks) from a picture", onclick: () => void importTiles(id) }, "+ Import tiles"),
      h("button", { class: "btn small", title: "A new block: a copy of the selected one, or empty", onclick: () => addBlock(id) }, "+ New block"),
    );

    const colors = ts.trueColor ? null : colorsFor(0);
    const sheetImg = sheet ? colorSheet(sheet, colors) : null;
    clear(main);
    main.append(
      tilesCard(ts, ed, sheet, sheetImg, per, tileCount),
      blocksCard(ts, ed, atlas),
    );
    clear(side);
    side.append(...sidePanel(id, ts, ed, sheetImg, per, tileCount));
  };

  // ------------------------------------------------------------- tiles
  const tilesCard = (ts: TilesetDef, ed: Editable, sheet: Sheet | null, sheetImg: HTMLCanvasElement | null, per: number, tileCount: number): HTMLElement => {
    const card = h("div", { class: "card" });
    const toggle = h("input", { type: "checkbox", checked: showCollision });
    toggle.addEventListener("change", () => {
      showCollision = toggle.checked;
      void render();
    });
    card.append(
      h("div", { class: "card-head" }, h("h4", {}, `Tiles (${tileCount})`), h("label", { class: "inline-check" }, toggle, "Mark walkable tiles and ledges")),
    );
    if (!sheet || !sheetImg) {
      card.append(h("p", { class: "hint warn" }, `The sheet ${ts.image} could not be loaded.`));
      return card;
    }
    const walk = new Set((ts.walkable as number[] | undefined) ?? []);
    const ledges = store.adapter.ledgeTiles?.(store.ctx, current ?? "") ?? new Map<number, string>();
    const canvas = h("canvas", { class: "tile-sheet" });
    canvas.width = sheet.width * SHEET_ZOOM;
    canvas.height = sheet.height * SHEET_ZOOM;
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(sheetImg, 0, 0, canvas.width, canvas.height);
    const T = TILE * SHEET_ZOOM;
    for (let t = 0; t < tileCount; t++) {
      const x = (t % per) * T;
      const y = Math.floor(t / per) * T;
      // walkable tiles: footprints; ledges: the hop direction
      const mark = walk.has(t) ? "walk" : ledges.get(t);
      if (showCollision && mark) drawMark(ctx, mark, x + T - 9, y + T - 9, 12, schedule);
      if (t < ed.firstTile) {
        // vanilla tiles: read-only, dimmed slightly
        ctx.fillStyle = "rgba(0, 0, 0, 0.08)";
        ctx.fillRect(x, y, T, T);
      }
    }
    // where the added tiles start
    if (ed.firstTile > 0 && ed.firstTile < tileCount) {
      const y = Math.ceil(ed.firstTile / per) * T;
      ctx.strokeStyle = "#4c8dff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
    }
    if (selTile !== null) {
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      ctx.strokeRect((selTile % per) * T + 1, Math.floor(selTile / per) * T + 1, T - 2, T - 2);
    }
    canvas.addEventListener("click", (e) => {
      const r = canvas.getBoundingClientRect();
      const tx = Math.floor(((e.clientX - r.left) / r.width) * (canvas.width / T));
      const ty = Math.floor(((e.clientY - r.top) / r.height) * (canvas.height / T));
      const t = ty * per + tx;
      if (t < 0 || t >= tileCount) return;
      selTile = t;
      void render();
    });
    card.append(h("div", { class: "sheet-wrap" }, canvas));
    card.append(
      h("p", { class: "hint" },
        ed.own
          ? "Click a tile to select it: the panel on the right sets whether you can walk on it, and places it in the selected block."
          : ed.firstTile < tileCount
            ? "The tiles below the blue line are your mod's; the ones above are the game's (read-only)."
            : "These are the game's tiles (read-only). + Import tiles adds your own below them."),
    );
    return card;
  };

  // ------------------------------------------------------------- blocks
  const blocksCard = (ts: TilesetDef, ed: Editable, atlas: BlockAtlas): HTMLElement => {
    const card = h("div", { class: "card" });
    card.append(h("div", { class: "card-head" }, h("h4", {}, `Blocks (${ts.blocks.length})`), h("span", { class: "hint" }, "32×32 pieces maps are painted with")));
    const canvas = h("canvas", { class: "block-sheet" });
    const rows = Math.max(1, Math.ceil(ts.blocks.length / ATLAS_COLUMNS));
    canvas.width = ATLAS_COLUMNS * BLOCK * BLOCK_ZOOM;
    canvas.height = rows * BLOCK * BLOCK_ZOOM;
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#11141a";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(atlas.canvas, 0, 0, atlas.canvas.width * BLOCK_ZOOM, atlas.canvas.height * BLOCK_ZOOM);
    const B = BLOCK * BLOCK_ZOOM;
    ctx.font = "bold 11px sans-serif";
    for (let b = 0; b < ts.blocks.length; b++) {
      const x = (b % ATLAS_COLUMNS) * B;
      const y = Math.floor(b / ATLAS_COLUMNS) * B;
      if (b >= ed.firstBlock && !ed.own) {
        ctx.strokeStyle = "#4c8dff";
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 1, y + 1, B - 2, B - 2);
      }
    }
    if (selBlock !== null) {
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 3;
      ctx.strokeRect((selBlock % ATLAS_COLUMNS) * B + 1.5, Math.floor(selBlock / ATLAS_COLUMNS) * B + 1.5, B - 3, B - 3);
    }
    canvas.addEventListener("click", (e) => {
      const r = canvas.getBoundingClientRect();
      const bx = Math.floor(((e.clientX - r.left) / r.width) * ATLAS_COLUMNS);
      const by = Math.floor(((e.clientY - r.top) / r.height) * rows);
      const b = by * ATLAS_COLUMNS + bx;
      if (b < 0 || b >= ts.blocks.length) return;
      selBlock = b;
      void render();
    });
    card.append(h("div", { class: "sheet-wrap" }, canvas));
    card.append(h("p", { class: "hint" }, ed.own ? "Click a block to edit it on the right." : "Blocks framed in blue are your mod's; click one to edit it. The game's own blocks can be copied: select one, then + New block."));
    return card;
  };

  // ------------------------------------------------------------- side panel
  const sidePanel = (id: string, ts: TilesetDef, ed: Editable, sheetImg: HTMLCanvasElement | null, per: number, tileCount: number): HTMLElement[] => {
    const out: HTMLElement[] = [];
    // the selected block
    if (selBlock !== null && sheetImg) {
      const b = selBlock;
      const block = ts.blocks[b];
      const can = b >= ed.firstBlock;
      const comp = h("canvas", { class: "block-composer" });
      comp.width = SLOT * 4;
      comp.height = SLOT * 4;
      const ctx = comp.getContext("2d")!;
      ctx.imageSmoothingEnabled = false;
      block.forEach((t, slot) => {
        const sx = (t % per) * TILE;
        const sy = Math.floor(t / per) * TILE;
        ctx.drawImage(sheetImg, sx, sy, TILE, TILE, (slot % 4) * SLOT, Math.floor(slot / 4) * SLOT, SLOT, SLOT);
      });
      ctx.strokeStyle = "rgba(255,255,255,0.25)";
      for (let i = 1; i < 4; i++) {
        ctx.beginPath();
        ctx.moveTo(i * SLOT + 0.5, 0);
        ctx.lineTo(i * SLOT + 0.5, comp.height);
        ctx.moveTo(0, i * SLOT + 0.5);
        ctx.lineTo(comp.width, i * SLOT + 0.5);
        ctx.stroke();
      }
      // collision per quarter (16x16 cell): footprints where you can walk,
      // the hop direction on a ledge, a red tint where you can't; the tile
      // that decides (bottom-left) gets a dashed frame
      const walk = new Set((ts.walkable as number[] | undefined) ?? []);
      const ledges = store.adapter.ledgeTiles?.(store.ctx, id) ?? new Map<number, string>();
      COLLISION_SLOTS.forEach((slot, cell) => {
        const x = (cell % 2) * SLOT * 2;
        const y = Math.floor(cell / 2) * SLOT * 2;
        const mark = walk.has(block[slot]) ? "walk" : ledges.get(block[slot]);
        if (!mark) {
          ctx.fillStyle = "rgba(255, 50, 70, 0.22)";
          ctx.fillRect(x, y, SLOT * 2, SLOT * 2);
        }
        ctx.setLineDash([4, 3]);
        ctx.strokeStyle = "rgba(255, 255, 255, 0.55)";
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 1.5, y + SLOT + 1.5, SLOT - 3, SLOT - 3);
        ctx.setLineDash([]);
        if (mark) drawMark(ctx, mark, x + SLOT, y + SLOT, 22, schedule);
      });
      ctx.strokeStyle = "rgba(255, 255, 255, 0.6)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(SLOT * 2 + 0.5, 0);
      ctx.lineTo(SLOT * 2 + 0.5, comp.height);
      ctx.moveTo(0, SLOT * 2 + 0.5);
      ctx.lineTo(comp.width, SLOT * 2 + 0.5);
      ctx.stroke();
      const slotAt = (e: MouseEvent) => {
        const r = comp.getBoundingClientRect();
        const sx = Math.floor(((e.clientX - r.left) / r.width) * 4);
        const sy = Math.floor(((e.clientY - r.top) / r.height) * 4);
        return sx >= 0 && sx < 4 && sy >= 0 && sy < 4 ? sy * 4 + sx : null;
      };
      comp.addEventListener("click", (e) => {
        const slot = slotAt(e);
        if (slot === null || !can) return;
        if (selTile === null) return toast("Select a tile in the sheet first, then click where it goes.", "info");
        const t = selTile;
        editTileset(id, "Block: place tile", (d) => {
          d.blocks[b - ed.firstBlock][slot] = t;
        });
      });
      comp.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        const slot = slotAt(e);
        if (slot === null) return;
        selTile = block[slot];
        void render();
      });
      const isLast = b === ts.blocks.length - 1;
      const used = highestBlockUsed(id) >= b;
      out.push(
        h("div", { class: "card" },
          h("div", { class: "card-head" }, h("h4", {}, `Block #${b}`), can ? h("span", { class: "tag new" }, "yours") : h("span", { class: "hint" }, "the game's")),
          comp,
          h("p", { class: "hint" }, can
            ? "Click a slot to put the selected tile there; right click picks a slot's tile. You walk on a block in quarters: each quarter's bottom-left tile (dashed) decides it. Footprints: walkable; arrow: a ledge you hop down; red: blocked."
            : "The game's block: read-only. + New block makes an editable copy. You walk on a block in quarters: each quarter's bottom-left tile (dashed) decides it. Footprints: walkable; arrow: a ledge you hop down; red: blocked."),
          can
            ? h("div", { class: "row" },
                h("button", {
                  class: "btn small danger",
                  disabled: !isLast || used,
                  title: !isLast ? "Only the last block can be deleted (block numbers must not shift)" : used ? "A map uses this block" : "Delete this block",
                  onclick: () => {
                    editTileset(id, "Delete block", (d) => {
                      d.blocks.pop();
                    });
                    selBlock = null;
                  },
                }, "Delete block"))
            : null,
        ),
      );
    }
    // the selected tile
    if (selTile !== null && sheetImg) {
      const t = selTile;
      const can = t >= ed.firstTile;
      const prev = h("canvas", { class: "tile-preview" });
      prev.width = SLOT * 2;
      prev.height = SLOT * 2;
      const pctx = prev.getContext("2d")!;
      pctx.imageSmoothingEnabled = false;
      pctx.drawImage(sheetImg, (t % per) * TILE, Math.floor(t / per) * TILE, TILE, TILE, 0, 0, prev.width, prev.height);
      const listToggle = (key: string, label: string, hint: string) => {
        const has = ((ts[key] as number[] | undefined) ?? []).includes(t);
        const cb = h("input", { type: "checkbox", checked: has, disabled: !can });
        cb.addEventListener("change", () => {
          editTileset(id, `Tile: ${label.toLowerCase()}`, (d) => {
            const target = key === "walkable" ? d.walkable : ((d.rec![key] as number[] | undefined) ?? (d.rec![key] = []));
            const list = target as number[];
            const i = list.indexOf(t);
            if (cb.checked && i < 0) list.push(t);
            if (!cb.checked && i >= 0) list.splice(i, 1);
            list.sort((a, b) => a - b);
          });
        });
        return h("label", { class: "inline-check", title: hint }, cb, label);
      };
      const toggles: HTMLElement[] = [listToggle("walkable", "Walkable", "The player and NPCs can step on a cell whose bottom-left tile is walkable.")];
      if (ed.own) {
        toggles.push(
          listToggle("doorTiles", "Door", "Stepping onto it from below warps (with a warp on that cell)."),
          listToggle("warpTiles", "Warp tile", "Any warp on a cell with this tile triggers when stepped on (stairs, mats)."),
          listToggle("counterTiles", "Counter", "Talk to an NPC across it (shop counters)."),
        );
        const grass = h("input", { type: "checkbox", checked: ts.grassTile === t, disabled: !can });
        grass.addEventListener("change", () =>
          editTileset(id, "Tile: tall grass", (d) => {
            if (grass.checked) d.rec!.grassTile = t;
            else delete d.rec!.grassTile;
          }),
        );
        toggles.push(h("label", { class: "inline-check", title: "Wild Pokémon appear in it, and it is drawn over the player's legs. One tile per tileset." }, grass, "Tall grass"));
      }
      out.push(
        h("div", { class: "card" },
          h("div", { class: "card-head" }, h("h4", {}, `Tile #${t}`), can ? h("span", { class: "tag new" }, "yours") : h("span", { class: "hint" }, "the game's")),
          h("div", { class: "row" }, prev, h("div", { class: "tile-flags" }, ...toggles)),
          can ? null : h("p", { class: "hint" }, "The game's tile: its settings can't change."),
        ),
      );
    }
    if (selBlock === null && selTile === null) out.push(h("p", { class: "hint" }, "Select a tile or a block."));
    out.push(...settingsCard(id, ts, ed, tileCount));
    return out;
  };

  const settingsCard = (id: string, ts: TilesetDef, ed: Editable, tileCount: number): HTMLElement[] => {
    const users = mapsUsing(id);
    const usedBy = h("div", { class: "card" },
      h("h4", {}, `Used by ${users.length} map${users.length === 1 ? "" : "s"}`),
      users.length
        ? h("div", { class: "row wrap" }, ...users.slice(0, 40).map((m) => h("button", { class: "btn small ghost", onclick: () => nav.openMap(m) }, m)), users.length > 40 ? h("span", { class: "hint" }, `+${users.length - 40} more`) : null)
        : h("p", { class: "hint" }, "No map uses it yet: pick it as a map's Tileset in the map properties."),
    );
    if (!ed.own) {
      const ext = extensionOf(id);
      return [
        h("div", { class: "card" },
          h("h4", {}, "The game's tileset"),
          h("p", { class: "hint" }, "Your tiles and blocks are added after the game's, so every map keeps working. The game builds the combined sheet from the player's own imported one when the mod loads; the mod ships only your tiles."),
          h("p", { class: "hint" }, "Your tiles use the 4 Game Boy shades and take the map's colors. With the RED++ color pack they get its text palette, so they may look different there."),
          ext
            ? h("button", {
                class: "btn small danger",
                onclick: () => {
                  const high = highestBlockUsed(id);
                  if (high >= ed.firstBlock && !confirm(`Maps still use your blocks (up to #${high}). Remove all your tiles and blocks anyway? Those maps will show broken blocks.`)) return;
                  store.setRecord(EXTENSIONS, id, "Remove additions", undefined);
                  store.seal();
                  selTile = null;
                  selBlock = null;
                },
              }, `Remove your ${ext.tiles.length} tiles and ${ext.blocks.length} blocks`)
            : null,
        ),
        usedBy,
      ];
    }
    const anim = h("select", {}, ...ANIMATIONS.map((a) => h("option", { value: a, selected: (ts.animation ?? "TILEANIM_NONE") === a }, a.replace("TILEANIM_", "").replace("_", " + ").toLowerCase())));
    anim.addEventListener("change", () => editTileset(id, "Tileset animation", (d) => (d.rec!.animation = anim.value)));
    return [
      h("div", { class: "card" },
        h("h4", {}, "Your tileset"),
        h("div", { class: "kv" }, h("span", {}, "Sheet"), h("code", {}, `${tileCount} tiles${ts.trueColor ? ", full color" : ""}`)),
        field("Animation", anim, "Water animates tile #20 like the game's water; flowers tile #3."),
        h("button", {
          class: "btn small danger",
          disabled: users.length > 0,
          title: users.length ? "Maps still use it" : "Delete this tileset",
          onclick: () => {
            store.setRecord("tilesets", id, `Delete ${id}`, undefined);
            store.seal();
            current = tilesetIds()[0] ?? null;
            void render();
          },
        }, "Delete tileset"),
      ),
      usedBy,
    ];
  };

  // ------------------------------------------------------------- actions
  const addBlock = (id: string) => {
    const ts = liveTileset(id);
    if (!ts) return;
    const copy = selBlock !== null ? [...ts.blocks[selBlock]] : new Array<number>(16).fill(selTile ?? 0);
    editTileset(id, "New block", (d) => {
      d.blocks.push(copy);
    });
    selBlock = (liveTileset(id)?.blocks.length ?? 1) - 1;
    void render();
  };

  // Tiles from a picture: identical tiles are reused (the sheet's own too),
  // each whole 32x32 square becomes a block.
  const importTiles = async (id: string) => {
    if (!store.project.mod) return toast("Open a mod first: imported tiles are saved into it.", "error");
    const file = await pickFile();
    if (!file) return;
    try {
      const img = await fileImage(file);
      const ts = liveTileset(id)!;
      const ed = editable(id);
      const trueColor = !!ts.trueColor;
      if (img.width < TILE || img.height < TILE) throw new Error("The picture is smaller than one 8×8 tile.");
      const cut = cutPicture(img, trueColor);
      const sheet = await readSheet(await tilesetUrl(id));
      const per = perRow(ts);
      const have = sheet ? Math.floor(sheet.width / TILE) * Math.floor(sheet.height / TILE) : 0;
      const existing = new Map<string, number>();
      if (sheet) {
        for (let t = have - 1; t >= 0; t--) existing.set(tileKey(sheet.rgba, sheet.width, (t % per) * TILE, Math.floor(t / per) * TILE, trueColor), t);
      }
      const fresh: Cut["tiles"] = [];
      const idOf = cut.tiles.map((tile) => {
        const known = existing.get(tile.key);
        if (known !== undefined) return known;
        fresh.push(tile);
        const n = have + fresh.length - 1;
        existing.set(tile.key, n);
        return n;
      });
      const blocks = blocksOf(cut, (i) => idOf[i]);
      if (!fresh.length && !blocks.length) return toast("Every tile of the picture is already in the sheet, and it holds no whole 32×32 block.", "info");
      if (ed.own) {
        const all = [...(sheet ? sheetTileList(sheet, per, have) : []), ...fresh.map((f) => f.px)];
        const canvas = sheetCanvas(all);
        const path = fresh.length ? addAsset(store.project.mod, id.toLowerCase(), bytesOf(canvas)) : null;
        editTileset(id, "Import tiles", (d) => {
          if (path) {
            d.rec!.image = path;
            d.rec!.imageWidth = canvas.width;
            d.rec!.imageHeight = canvas.height;
            d.rec!.tilesPerRow = 16;
          }
          d.blocks.push(...blocks);
          for (let t = have; t < have + fresh.length; t++) d.walkable.push(t);
        });
      } else {
        editTileset(id, "Import tiles", (d) => {
          d.tiles!.push(...fresh.map((f) => f.key));
          d.blocks.push(...blocks);
          for (let t = have; t < have + fresh.length; t++) d.walkable.push(t);
        });
      }
      toast(`${fresh.length} new tile${fresh.length === 1 ? "" : "s"} (${cut.tiles.length - fresh.length} already there), ${blocks.length} new block${blocks.length === 1 ? "" : "s"}. New tiles start walkable.`, "ok");
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "error");
    }
  };

  const newTileset = async () => {
    if (!store.project?.mod) return toast("Open a mod first: a new tileset is saved into it.", "error");
    const res = await promptNewTileset(tilesetIds());
    if (!res) return;
    try {
      const img = await fileImage(res.file);
      if (img.width < TILE || img.height < TILE) throw new Error("The picture is smaller than one 8×8 tile.");
      const cut = cutPicture(img, res.trueColor);
      const canvas = sheetCanvas(cut.tiles.map((t) => t.px));
      const path = addAsset(store.project.mod!, res.id.toLowerCase(), bytesOf(canvas));
      let blocks = blocksOf(cut, (i) => i);
      if (!blocks.length) blocks = [new Array<number>(16).fill(0)];
      const record: TilesetDef = {
        id: res.id,
        image: path,
        imageWidth: canvas.width,
        imageHeight: canvas.height,
        tilesPerRow: 16,
        ...(res.trueColor ? { trueColor: true } : {}),
        animation: "TILEANIM_NONE",
        walkable: cut.tiles.map((_t, i) => i),
        doorTiles: [],
        warpTiles: [],
        counterTiles: [],
        blocks,
      };
      store.setRecord("tilesets", res.id, `New tileset ${res.id}`, clone(record));
      store.seal();
      toast(`${res.id}: ${cut.tiles.length} tiles, ${blocks.length} blocks. All tiles start walkable: mark the ones you can't walk on.`, "ok");
      open(res.id);
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "error");
    }
  };

  // ---------------------------------------------------------------- events
  let queued = false;
  const schedule = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      if (nav.workspace === "tilesets") void render();
    });
  };
  store.on((reason, id, registry) => {
    if (reason === "project") {
      if (!current || !tilesetsTable()[current]) current = store.map?.tileset ?? tilesetIds()[0] ?? null;
      selTile = null;
      selBlock = null;
      schedule();
    } else if (reason === "content" && (registry === "tilesets" || registry === EXTENSIONS)) {
      if (current && !tilesetsTable()[current]) current = tilesetIds()[0] ?? null;
      schedule();
    } else if (reason === "reveal" && (registry === "tilesets" || registry === EXTENSIONS) && id) {
      nav.openTileset(id);
    }
  });
  // drawn when the workspace is shown (sheets load lazily)
  nav.onTilesetsShown = () => void render();
}

// id, picture and color mode of a new tileset
function promptNewTileset(taken: string[]): Promise<{ id: string; file: File; trueColor: boolean } | null> {
  return new Promise((resolve) => {
    const dialog = h("dialog", {});
    const id = h("input", { type: "text", spellcheck: false, placeholder: "MY_TILES" });
    const file = h("input", { type: "file", accept: "image/png,image/gif,image/bmp,image/webp" });
    const color = h("input", { type: "checkbox" });
    const close = (v: { id: string; file: File; trueColor: boolean } | null) => {
      dialog.close();
      dialog.remove();
      resolve(v);
    };
    const create = () => {
      const newId = id.value.trim().toUpperCase();
      if (!/^[A-Z][A-Z0-9_]*$/.test(newId)) return toast("The id may use A-Z, 0-9 and _ and starts with a letter", "error");
      if (taken.includes(newId)) return toast(`${newId} already exists`, "error");
      const f = file.files?.[0];
      if (!f) return toast("Pick a picture", "error");
      close({ id: newId, file: f, trueColor: color.checked });
    };
    id.addEventListener("keydown", (e) => e.key === "Enter" && create());
    dialog.addEventListener("cancel", (e) => {
      e.preventDefault();
      close(null);
    });
    dialog.append(
      h("h3", {}, "New tileset"),
      field("Id", id, "Maps name their tileset by this id; cannot be changed later."),
      field("Picture", file, "Cut into 8×8 tiles (repeats are stored once); every whole 32×32 square also becomes a block. A map drawn as one picture works straight away."),
      h("label", { class: "inline-check" }, color, "Full color (keep the picture's colors instead of the 4 Game Boy shades the map palette colors)"),
      h("div", { class: "dialog-actions" }, h("button", { class: "btn", onclick: () => close(null) }, "Cancel"), h("button", { class: "btn primary", onclick: create }, "Create")),
    );
    document.body.append(dialog);
    dialog.showModal();
    id.focus();
  });
}
