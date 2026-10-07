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
  animationsOf, canAnimate, CUT_TILES, EXTENSIONS, shoreTilesOf, waterTilesOf, extensionOf, isBaseTileset, liveTileset, ownAnimations, perRow, setOwnAnimations, sheetTiles, SHADE_GRAY,
  tilesetIds, tilesetKey, tilesetUrl, type EngineAnimation, type TilesetExtension,
} from "../core/tilesets.ts";
import { blockAtlas, loadImage, markerIcon, BLOCK, TILE, ATLAS_COLUMNS, type BlockAtlas } from "../render/graphics.ts";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Footprints, Scissors, Waves } from "lucide";
import { MONO, type Rgb } from "../render/color.ts";
import { loadFile, pngBytes } from "./artImport.ts";
import { clear, field, h, toast } from "./dom.ts";
import { mountRecordList } from "./recordList.ts";
import { gbcAvailable, gbcColorsFor, gbcKey, GRAYS, GROUP_NAMES, REDPP, groupColors, groupOf, type GbcColoring } from "../core/gbc.ts";
import { nav } from "./nav.ts";
import { paletteChoices } from "./picColors.ts";

const SHEET_ZOOM = 4;
const BLOCK_ZOOM = 2;
const SLOT = 40; // composer tile size, px
// Gen 1 collision is per 16x16 cell (a quarter of a block): the cell's
// bottom-left tile decides it. Slots of a block, per cell (top-left first).
const COLLISION_SLOTS = [4, 6, 12, 14];
const ARROWS = { up: ArrowUp, down: ArrowDown, left: ArrowLeft, right: ArrowRight };

// a walk / ledge mark on a canvas: the icon on a dark disc (null until the
// icon image has loaded; `ready` redraws then)
const MARKS: Record<string, [typeof Footprints, string]> = {
  walk: [Footprints, "#3cdc6e"],
  water: [Waves, "#5aa8ff"],
  cut: [Scissors, "#ff8a65"],
};

function drawMark(ctx: CanvasRenderingContext2D, kind: string, cx: number, cy: number, size: number, ready: () => void): void {
  const [node, color] = MARKS[kind] ?? [ARROWS[kind as keyof typeof ARROWS], "#ffb340"];
  if (!node) return;
  const img = markerIcon(`tiles-${kind}`, node, color, ready);
  ctx.fillStyle = "rgba(10, 12, 16, 0.72)";
  ctx.beginPath();
  ctx.arc(cx, cy, size * 0.62, 0, Math.PI * 2);
  ctx.fill();
  if (img) ctx.drawImage(img, cx - size / 2, cy - size / 2, size, size);
}
const ANIMATIONS = ["TILEANIM_NONE", "TILEANIM_WATER", "TILEANIM_WATER_FLOWER"];
// the view option without map colors; colors darkest first
// animation speeds: 60ths of a second per frame (20 = the game's water)
const SPEEDS: [number, string][] = [[8, "Fast"], [20, "Normal (like water)"], [40, "Slow"]];

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

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

// per quarter of block `b` (top-left first): surfable water, cuttable
function quarterMarks(id: string, ts: TilesetDef, b: number): { water: boolean; cut: boolean }[] {
  const block = ts.blocks[b] ?? [];
  const wet = surfableTileset(id) ? new Set([...waterTilesOf(ts), ...shoreTilesOf(ts)]) : new Set<number>();
  const cutTiles = (CUT_TILES[id] ?? []).map((c) => c.tile);
  const swaps = (store.table("field").cutTreeSwaps as { before: number }[] | undefined) ?? [];
  const hasSwap = cutTiles.length > 0 && swaps.some((s) => s.before === b);
  return COLLISION_SLOTS.map((slot) => ({ water: wet.has(block[slot]), cut: hasSwap && cutTiles.includes(block[slot]) }));
}

// whether a tileset has surfable water (field.waterTilesets)
function surfableTileset(id: string): boolean {
  return ((store.table("field").waterTilesets as string[] | undefined) ?? []).includes(id);
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
// `colorsFor(tile)`: per tile (RED++ gives each tile its group's colors);
// tile ids count `per` a row
function colorSheet(sheet: Sheet, colorsFor: ((tile: number) => Rgb[]) | null, per = 16): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = sheet.width;
  c.height = sheet.height;
  const ctx = c.getContext("2d")!;
  const out = ctx.createImageData(sheet.width, sheet.height);
  for (let i = 0; i < sheet.width * sheet.height; i++) {
    const o = i * 4;
    if (colorsFor) {
      const x = i % sheet.width;
      const y = Math.floor(i / sheet.width);
      const col = colorsFor(Math.floor(y / TILE) * per + Math.floor(x / TILE))[shadeOf(sheet.rgba[o])];
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

// An imported picture cut into tiles: quantized to the 4 shades unless full
// color, cropped to whole tiles. `grid[ty][tx]` = index into `tiles`.
interface Cut {
  cols: number;
  rows: number;
  tiles: { key: string; px: Uint8ClampedArray }[];
  grid: number[][];
}

// `dedupe`: identical tiles are stored once (else every cell is its own
// tile, in reading order, so the picture's layout survives)
function cutPicture(img: HTMLImageElement, trueColor: boolean, dedupe = true): Cut {
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
      let i = dedupe ? byKey.get(key) : undefined;
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

// A sheet image (`per` tiles a row) from RGBA tiles.
function sheetCanvas(tiles: Uint8ClampedArray[], per = 16): HTMLCanvasElement {
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

// tile key -> id for the tiles a sheet already has (first one wins)
function existingKeys(sheet: Sheet | null, per: number, have: number, trueColor: boolean): Map<string, number> {
  const out = new Map<string, number>();
  if (!sheet) return out;
  for (let t = have - 1; t >= 0; t--) out.set(tileKey(sheet.rgba, sheet.width, (t % per) * TILE, Math.floor(t / per) * TILE, trueColor), t);
  return out;
}

// a white tile: fills the rest of a row when a picture keeps its layout
function blankTile(): Cut["tiles"][number] {
  const px = new Uint8ClampedArray(TILE * TILE * 4).fill(255);
  return { key: "0".repeat(64), px };
}

function tileCanvas(px: Uint8ClampedArray): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = TILE;
  c.height = TILE;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(TILE, TILE);
  img.data.set(px);
  ctx.putImageData(img, 0, 0);
  return c;
}

// what an import adds: new tiles (after the `have` the sheet holds), blocks,
// and animated tiles with their frames
interface ImportPlan {
  have: number;
  sheet: Sheet | null;
  per: number;
  fresh: Cut["tiles"];
  blocks: number[][];
  anims: { tile: number; frames: Cut["tiles"] }[];
  // new tiles that only fill a row (not walkable)
  filler?: Set<number>;
}

function pickFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = h("input", { type: "file", accept: "image/png,image/gif,image/bmp,image/webp" });
    input.addEventListener("change", () => resolve(input.files?.[0] ?? null));
    input.click();
  });
}

// ------------------------------------------------------------------ workspace

export function mountTilesetWorkspace(left: HTMLElement, center: HTMLElement, right: HTMLElement): void {
  let current: string | null = null;
  let selTile: number | null = null;
  let selBlock: number | null = null;
  // the tiles selected in the sheet (drag for several); pasted into a block
  let selRect: Rect | null = null;
  let showCollision = true;
  // palette the tileset is viewed in: "" = a map's on it, GRAYS = none
  // the colors picked in the menu; null = the default (RED++ while the map
  // view is in RED++, else a map's palette)
  let viewPalette: string | null = null;
  // redraws animated tiles in the side panel
  let animTimer: number | null = null;

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
      selRect = null;
      selBlock = null;
    }
    current = id;
    list.render();
    void render();
    left.querySelector<HTMLElement>(`.map-row[data-id="${id}"]`)?.scrollIntoView({ block: "nearest" });
  };
  nav.openTileset = (id) => {
    nav.setWorkspace("graphics");
    nav.showGraphics("tilesets");
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
    if (animTimer !== null) clearInterval(animTimer);
    animTimer = null;
    const ts = liveTileset(id)!;
    const ed = editable(id);
    const per = perRow(ts);
    const auto = paletteKey(id);
    // RED++: the town of a map on it decides the roof colors
    const onIt = store.map?.tileset === id ? store.currentMap : mapsUsing(id)[0] ?? null;
    const redpp = gbcAvailable() ? gbcKey(id, onIt) : null;
    if (viewPalette === REDPP && !redpp) viewPalette = null;
    const chosen = viewPalette ?? (store.colorMode === "redpp" && redpp ? REDPP : "");
    // RED++ only when picked: "a map's" is always the map's own Game Boy palette
    const palette = chosen === REDPP ? redpp! : chosen || auto;
    const colorsFor = palette === GRAYS ? () => MONO : palette === redpp ? gbcColorsFor(id, palette) : store.adapter.tileColors(store.ctx, ts, palette);
    const url = await tilesetUrl(id);
    const sheet = await readSheet(url);
    const atlas = await blockAtlas(ts, url, palette, colorsFor, tilesetKey(id));
    const tint = ts.trueColor ? null : colorsFor;
    // animated tiles: their frames, drawn in the same colors
    const anims = new Map<number, { period: number; frames: HTMLCanvasElement[] }>();
    for (const [tile, a] of animationsOf(id)) {
      const frames = await Promise.all(a.urls.map(async (u) => {
        const f = await readSheet(u);
        return f ? colorSheet(f, tint ? () => tint(tile) : null) : null;
      }));
      if (frames.every((f) => f)) anims.set(tile, { period: a.period, frames: frames as HTMLCanvasElement[] });
    }
    if (my !== token) return;
    title.textContent = id;
    const capacity = sheet ? Math.floor(sheet.width / TILE) * Math.floor(sheet.height / TILE) : 0;
    // an extended sheet ends with the last added tile (the rest of its row is padding)
    const tileCount = ed.own ? capacity : Math.min(capacity, ed.firstTile + (extensionOf(id)?.tiles.length ?? 0));
    if (selTile !== null && selTile >= tileCount) selTile = null;
    if (selBlock !== null && selBlock >= ts.blocks.length) selBlock = null;

    // the colors to view it in (Gen 1 colors a map, not a tileset: each map
    // has its palette, set in the map's properties)
    const paletteNames = paletteChoices();
    const view = h("select", { title: "Gen 1 colors maps, not tilesets: each map has a palette (map properties). This only changes how the tileset is shown here." },
      h("option", { value: "", selected: chosen === "" }, `Colors: a map's (${auto})`),
      ...(redpp ? [h("option", { value: REDPP, selected: chosen === REDPP }, "Colors: RED++ (Game Boy Color)")] : []),
      ...paletteNames.map((n) => h("option", { value: n, selected: chosen === n }, `Colors: ${n}`)),
      h("option", { value: GRAYS, selected: chosen === GRAYS }, "Game Boy grays"),
    );
    view.addEventListener("change", () => {
      viewPalette = view.value;
      void render();
    });
    if (ts.trueColor) view.disabled = true;
    headTools.append(
      view,
      h("button", { class: "btn small", title: "Add tiles (and blocks) from a picture", onclick: () => void importTiles(id) }, "+ Import tiles"),
      h("button", {
        class: "btn small",
        disabled: !canAnimate(id),
        title: canAnimate(id) ? "A block whose tiles move: a picture of its frames, each 32×32, side by side (or stacked)" : "The spinner puzzles' tileset can't get animations of its own",
        onclick: () => void importAnimatedBlock(id),
      }, "+ Animated block"),
      h("button", { class: "btn small", title: "A new block: a copy of the selected one, or empty", onclick: () => addBlock(id) }, "+ New block"),
    );

    const sheetImg = sheet ? colorSheet(sheet, tint, per) : null;
    clear(main);
    main.append(
      tilesCard(ts, ed, sheet, sheetImg, per, tileCount, anims),
      blocksCard(ts, ed, atlas),
      ...(ed.own ? [] : [gameTilesetCard(id, ed)]),
    );
    clear(side);
    side.append(...sidePanel(id, ts, ed, sheetImg, per, tileCount, anims));
  };

  // the frame an animated tile shows now
  const frameNow = (a: { period: number; frames: HTMLCanvasElement[] }) =>
    a.frames[Math.floor(performance.now() / (a.period * (1000 / 60))) % a.frames.length];

  // what a game tileset's additions are (below the blocks, middle panel)
  const gameTilesetCard = (id: string, ed: Editable): HTMLElement => {
    const ext = extensionOf(id);
    return h("div", { class: "card" },
      h("h4", {}, "The game's tileset"),
      h("p", { class: "hint" }, "Your tiles and blocks are added after the game's, so every map keeps working. The game builds the combined sheet from the player's own imported one when the mod loads; the mod ships only your tiles."),
      h("p", { class: "hint" }, "Your tiles use the 4 Game Boy shades and take the map's colors. In the RED++ color mode each tile uses one of the tileset's 8 palettes: pick it in the tile's panel (otherwise it gets the text palette). Setting one gives the mod the engine_internals permission, since the mod writes into the engine's color table."),
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
    );
  };

  // ------------------------------------------------------------- tiles
  const tilesCard = (ts: TilesetDef, ed: Editable, sheet: Sheet | null, sheetImg: HTMLCanvasElement | null, per: number, tileCount: number, anims: Map<number, unknown>): HTMLElement => {
    const card = h("div", { class: "card" });
    const toggle = h("input", { type: "checkbox", checked: showCollision });
    toggle.addEventListener("change", () => {
      showCollision = toggle.checked;
      void render();
    });
    card.append(
      h("div", { class: "card-head" }, h("h4", {}, `Tiles (${tileCount})`), h("label", { class: "inline-check" }, toggle, "Mark walkable, ledge, water and cut tiles")),
    );
    if (!sheet || !sheetImg) {
      card.append(h("p", { class: "hint warn" }, `The sheet ${ts.image} could not be loaded.`));
      return card;
    }
    const walk = new Set((ts.walkable as number[] | undefined) ?? []);
    const ledges = store.adapter.ledgeTiles?.(store.ctx, current ?? "") ?? new Map<number, string>();
    // everything but the selection, drawn once
    const wet = new Set([...waterTilesOf(ts), ...shoreTilesOf(ts)]);
    const surfable = surfableTileset(current ?? "");
    const cuts = new Set((CUT_TILES[current ?? ""] ?? []).map((c) => c.tile));
    const canvas = document.createElement("canvas");
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
      // surfable (water/shore) bottom-left, cuttable top-right
      if (showCollision && surfable && wet.has(t)) drawMark(ctx, "water", x + 9, y + T - 9, 12, schedule);
      if (showCollision && cuts.has(t)) drawMark(ctx, "cut", x + T - 9, y + 9, 12, schedule);
      // animated tiles: a purple corner
      if (anims.has(t)) {
        ctx.fillStyle = "#c792ff";
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + 10, y);
        ctx.lineTo(x, y + 10);
        ctx.fill();
      }
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
    const view = h("canvas", { class: "tile-sheet" });
    view.width = canvas.width;
    view.height = canvas.height;
    const vctx = view.getContext("2d")!;
    const paint = () => {
      vctx.clearRect(0, 0, view.width, view.height);
      vctx.drawImage(canvas, 0, 0);
      const r = selRect ?? (selTile !== null ? { x: selTile % per, y: Math.floor(selTile / per), w: 1, h: 1 } : null);
      if (!r) return;
      vctx.strokeStyle = "#fff";
      vctx.lineWidth = 2;
      vctx.strokeRect(r.x * T + 1, r.y * T + 1, r.w * T - 2, r.h * T - 2);
    };
    paint();
    // click selects a tile, dragging a rectangle of them
    const cellAt = (e: MouseEvent) => {
      const r = view.getBoundingClientRect();
      const tx = Math.max(0, Math.min(per - 1, Math.floor(((e.clientX - r.left) / r.width) * per)));
      const ty = Math.max(0, Math.min(Math.ceil(tileCount / per) - 1, Math.floor(((e.clientY - r.top) / r.height) * (view.height / T))));
      return { tx, ty };
    };
    let anchor: { tx: number; ty: number } | null = null;
    view.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      anchor = cellAt(e);
      if (anchor.ty * per + anchor.tx >= tileCount) return void (anchor = null);
      view.setPointerCapture(e.pointerId);
      selRect = { x: anchor.tx, y: anchor.ty, w: 1, h: 1 };
      paint();
    });
    view.addEventListener("pointermove", (e) => {
      if (!anchor) return;
      const c = cellAt(e);
      selRect = { x: Math.min(anchor.tx, c.tx), y: Math.min(anchor.ty, c.ty), w: Math.abs(c.tx - anchor.tx) + 1, h: Math.abs(c.ty - anchor.ty) + 1 };
      paint();
    });
    view.addEventListener("pointerup", () => {
      if (!anchor || !selRect) return;
      anchor = null;
      selTile = selRect.y * per + selRect.x;
      void render();
    });
    card.append(h("div", { class: "sheet-wrap" }, view));
    card.append(
      h("p", { class: "hint" },
        ed.own
          ? "Click a tile to select it, or drag over several: the panel on the right sets whether you can walk on it, and places them in the selected block. A purple corner marks an animated tile."
          : ed.firstTile < tileCount
            ? "The tiles below the blue line are your mod's; the ones above are the game's (read-only). Drag over several tiles to place them into a block at once; a purple corner marks an animated tile."
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
  const sidePanel = (id: string, ts: TilesetDef, ed: Editable, sheetImg: HTMLCanvasElement | null, per: number, tileCount: number, anims: Map<number, { period: number; frames: HTMLCanvasElement[] }>): HTMLElement[] => {
    const out: HTMLElement[] = [];
    // canvases with animated tiles redraw on a timer
    const live: (() => void)[] = [];
    // the block's card goes below the tile's (like the middle column)
    const blockOut: HTMLElement[] = [];
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
      const drawComposer = () => {
      block.forEach((t, slot) => {
        const a = anims.get(t);
        if (a) ctx.drawImage(frameNow(a), 0, 0, TILE, TILE, (slot % 4) * SLOT, Math.floor(slot / 4) * SLOT, SLOT, SLOT);
        else ctx.drawImage(sheetImg, (t % per) * TILE, Math.floor(t / per) * TILE, TILE, TILE, (slot % 4) * SLOT, Math.floor(slot / 4) * SLOT, SLOT, SLOT);
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
        // one mark per quarter, in its middle: walk, ledge, surf or cut
        const q = quarterMarks(id, ts, b)[cell];
        const mark = walk.has(block[slot]) ? "walk" : ledges.get(block[slot]) ?? (q.water ? "water" : q.cut ? "cut" : undefined);
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
      };
      drawComposer();
      if (block.some((t) => anims.has(t))) live.push(drawComposer);
      const slotAt = (e: MouseEvent) => {
        const r = comp.getBoundingClientRect();
        const sx = Math.floor(((e.clientX - r.left) / r.width) * 4);
        const sy = Math.floor(((e.clientY - r.top) / r.height) * 4);
        return sx >= 0 && sx < 4 && sy >= 0 && sy < 4 ? sy * 4 + sx : null;
      };
      comp.addEventListener("click", (e) => {
        const slot = slotAt(e);
        if (slot === null || !can) return;
        const r = selRect ?? (selTile !== null ? { x: selTile % per, y: Math.floor(selTile / per), w: 1, h: 1 } : null);
        if (!r) return toast("Select a tile in the sheet first (or drag over several), then click where it goes.", "info");
        // the selection lands with its top-left on the clicked slot (what
        // sticks out of the block is left off)
        editTileset(id, r.w * r.h > 1 ? "Block: place tiles" : "Block: place tile", (d) => {
          for (let dy = 0; dy < r.h; dy++) {
            for (let dx = 0; dx < r.w; dx++) {
              const sx = (slot % 4) + dx;
              const sy = Math.floor(slot / 4) + dy;
              const t = (r.y + dy) * per + r.x + dx;
              if (sx < 4 && sy < 4 && t < tileCount) d.blocks[b - ed.firstBlock][sy * 4 + sx] = t;
            }
          }
        });
      });
      comp.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        const slot = slotAt(e);
        if (slot === null) return;
        selTile = block[slot];
        selRect = null;
        void render();
      });
      const isLast = b === ts.blocks.length - 1;
      const used = highestBlockUsed(id) >= b;
      const cutRow = cutSwapRow(id, b, block, ts.blocks.length);
      blockOut.push(
        h("div", { class: "card" },
          h("div", { class: "card-head" }, h("h4", {}, `Block #${b}`), can ? h("span", { class: "tag new" }, "yours") : h("span", { class: "hint" }, "the game's")),
          comp,
          ...cutRow,
          h("p", { class: "hint" }, can
            ? "Click a slot to put the selected tile there (a dragged selection lands with its top-left corner there); right click picks a slot's tile. You walk on a block in quarters: each quarter's bottom-left tile (dashed) decides it. Footprints: walkable; arrow: a ledge you hop down; red: blocked; waves: surfable; scissors: cuttable."
            : "The game's block: read-only. + New block makes an editable copy. You walk on a block in quarters: each quarter's bottom-left tile (dashed) decides it. Footprints: walkable; arrow: a ledge you hop down; red: blocked; waves: surfable; scissors: cuttable."),
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
    // the selected tile(s): a dragged selection edits every tile in it
    if (selTile !== null && sheetImg) {
      const t = selTile;
      const rect = selRect ?? { x: t % per, y: Math.floor(t / per), w: 1, h: 1 };
      const tiles: number[] = [];
      for (let y = rect.y; y < rect.y + rect.h; y++) for (let x = rect.x; x < rect.x + rect.w; x++) if (y * per + x < tileCount) tiles.push(y * per + x);
      if (!tiles.length) tiles.push(t);
      const multi = tiles.length > 1;
      // only the mod's tiles change; the game's in the selection keep theirs
      const mine = tiles.filter((x) => x >= ed.firstTile);
      const can = mine.length > 0;
      const prev = h("canvas", { class: "tile-preview" });
      const scale = Math.max(1, Math.floor((SLOT * 2) / (TILE * Math.max(rect.w, rect.h))));
      prev.width = rect.w * TILE * scale;
      prev.height = rect.h * TILE * scale;
      if (multi) prev.style.width = prev.style.height = "auto";
      const pctx = prev.getContext("2d")!;
      pctx.imageSmoothingEnabled = false;
      const anim = multi ? undefined : anims.get(t);
      const drawPreview = () => {
        if (anim) pctx.drawImage(frameNow(anim), 0, 0, TILE, TILE, 0, 0, prev.width, prev.height);
        else pctx.drawImage(sheetImg, rect.x * TILE, rect.y * TILE, rect.w * TILE, rect.h * TILE, 0, 0, prev.width, prev.height);
      };
      drawPreview();
      if (anim) live.push(drawPreview);
      // animation: speed and stop, or start one from a strip of frames
      const animRow: HTMLElement[] = [];
      if (multi) {
        // one tile at a time
      } else if (anim) {
        const speed = h("select", {}, ...SPEEDS.map(([v, l]) => h("option", { value: String(v), selected: anim.period === v }, l)));
        if (!SPEEDS.some(([v]) => v === anim.period)) speed.append(h("option", { value: String(anim.period), selected: true }, `${anim.period}/60 s a frame`));
        speed.disabled = !can;
        speed.addEventListener("change", () => setAnimation(id, t, (a) => ({ ...a, period: Number(speed.value) })));
        animRow.push(
          h("p", { class: "hint" }, `Animated: ${anim.frames.length} frames. Every place this tile appears animates.`),
          field("Speed", speed),
          h("button", { class: "btn small", disabled: !can, onclick: () => setAnimation(id, t, () => null) }, "Stop animating"),
        );
      } else if (can && canAnimate(id)) {
        animRow.push(h("button", {
          class: "btn small",
          title: "A picture of the tile's frames, each 8×8, side by side (or stacked)",
          onclick: () => void animateTile(id, t),
        }, "Animate…"));
      }
      // a checkbox over the selection: checked when all have it, a dash when
      // some do; a change applies to every tile of the mod's in it
      const setIn = (list: number[], on: boolean) => {
        for (const x of mine) {
          const i = list.indexOf(x);
          if (on && i < 0) list.push(x);
          if (!on && i >= 0) list.splice(i, 1);
        }
        list.sort((a, b) => a - b);
      };
      const box = (has: (x: number) => boolean) => {
        const n = tiles.filter(has).length;
        const cb = h("input", { type: "checkbox", checked: n === tiles.length, disabled: !can });
        cb.indeterminate = n > 0 && n < tiles.length;
        return cb;
      };
      const listToggle = (key: string, label: string, hint: string) => {
        const list0 = (ts[key] as number[] | undefined) ?? [];
        const cb = box((x) => list0.includes(x));
        cb.addEventListener("change", () => {
          editTileset(id, `${multi ? "Tiles" : "Tile"}: ${label.toLowerCase()}`, (d) => {
            const target = key === "walkable" ? d.walkable : ((d.rec![key] as number[] | undefined) ?? (d.rec![key] = []));
            setIn(target as number[], cb.checked);
          });
        });
        return h("label", { class: "inline-check", title: hint }, cb, label);
      };
      const toggles: HTMLElement[] = [listToggle("walkable", "Walkable", "The player and NPCs can step on a cell whose bottom-left tile is walkable.")];
      // water / shore: the tileset's own lists (the engine's defaults until set)
      const wetToggle = (kind: "water" | "shore", label: string, hint: string) => {
        const list0 = kind === "water" ? waterTilesOf(ts) : shoreTilesOf(ts);
        const cb = box((x) => list0.includes(x));
        cb.addEventListener("change", () =>
          editTileset(id, `${multi ? "Tiles" : "Tile"}: ${label.toLowerCase()}`, (d) => {
            let list: number[];
            if (d.rec) {
              const key = kind === "water" ? "waterTiles" : "shoreTiles";
              list = [...(kind === "water" ? waterTilesOf(d.rec) : shoreTilesOf(d.rec))];
              d.rec[key] = list;
            } else {
              const ext = d as unknown as TilesetExtension;
              list = ext[kind] ??= [];
            }
            setIn(list, cb.checked);
          }),
        );
        return h("label", { class: "inline-check", title: hint }, cb, label);
      };
      toggles.push(
        wetToggle("water", "Water (surf)", "Surfable when the cell's bottom-left tile is water, on a tileset with surfable water."),
        wetToggle("shore", "Shore (surf)", "The water's edge: also surfable (like the game's shore tiles)."),
      );
      const cutAs = multi ? undefined : (CUT_TILES[id] ?? []).find((c) => c.tile === t);
      if (cutAs) toggles.push(h("span", { class: "hint", title: "Fixed in the engine" }, `Cuttable ${cutAs.what} (with a block swap)`));
      if (ed.own && !multi) {
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
          h("div", { class: "card-head" },
            h("h4", {}, multi ? `${tiles.length} tiles (#${tiles[0]}–#${tiles[tiles.length - 1]})` : `Tile #${t}`),
            mine.length === tiles.length ? h("span", { class: "tag new" }, "yours") : can ? h("span", { class: "hint" }, "partly yours") : h("span", { class: "hint" }, "the game's")),
          h("div", { class: "row" }, prev, h("div", { class: "tile-flags" }, ...toggles)),
          ...animRow,
          ...gbcRow(id, tiles, mine),
          !can ? h("p", { class: "hint" }, multi ? "The game's tiles: their settings can't change." : "The game's tile: its settings can't change.") : null,
          can && mine.length < tiles.length ? h("p", { class: "hint" }, `Changes apply to your ${mine.length} tile${mine.length === 1 ? "" : "s"}; the game's keep theirs.`) : null,
          multi && ed.own ? h("p", { class: "hint" }, "Door, warp, counter, tall grass and animation: select one tile.") : null,
        ),
      );
    }
    out.push(...blockOut);
    if (live.length) animTimer = window.setInterval(() => live.forEach((f) => f()), 50);
    if (selBlock === null && selTile === null) out.push(h("p", { class: "hint" }, "Select a tile or a block."));
    out.push(...settingsCard(id, ts, ed, tileCount));
    return out;
  };

  const settingsCard = (id: string, ts: TilesetDef, ed: Editable, tileCount: number): HTMLElement[] => {
    const users = mapsUsing(id);
    const surf = h("input", { type: "checkbox", checked: surfableTileset(id) });
    surf.addEventListener("change", () => {
      store.editRecord<string[]>("field", "waterTilesets", surf.checked ? "Surfable water" : "No surfable water", (l) => {
        const i = l.indexOf(id);
        if (surf.checked && i < 0) l.push(id);
        if (!surf.checked && i >= 0) l.splice(i, 1);
      }, { create: () => [] });
      store.seal();
    });
    const surfCard = h("div", { class: "card" },
      h("label", { class: "inline-check" }, surf, "Surfable water"),
      h("p", { class: "hint" }, `The player can surf on its water and shore tiles (${[...waterTilesOf(ts), ...shoreTilesOf(ts)].map((t) => `#${t}`).join(", ") || "none"}).${CUT_TILES[id] ? ` Cuttable: ${CUT_TILES[id].map((c) => `${c.what} #${c.tile}`).join(", ")} (fixed in the engine; each block needs a cut swap, set in the block panel).` : " Nothing on this tileset can be cut (only OVERWORLD and GYM have cuttable tiles in the engine)."}`),
    );
    const usedBy = h("div", { class: "card" },
      h("h4", {}, `Used by ${users.length} map${users.length === 1 ? "" : "s"}`),
      users.length
        ? h("div", { class: "row wrap" }, ...users.slice(0, 40).map((m) => h("button", { class: "btn small ghost", onclick: () => nav.openMap(m) }, m)), users.length > 40 ? h("span", { class: "hint" }, `+${users.length - 40} more`) : null)
        : h("p", { class: "hint" }, "No map uses it yet: pick it as a map's Tileset in the map properties."),
    );
    if (!ed.own) {
      return [
        surfCard,
        usedBy,
      ];
    }
    const anim = h("select", {}, ...ANIMATIONS.map((a) => h("option", { value: a, selected: (ts.animation ?? "TILEANIM_NONE") === a }, a.replace("TILEANIM_", "").replace("_", " + ").toLowerCase())));
    anim.addEventListener("change", () =>
      editTileset(id, "Tileset animation", (d) => {
        d.rec!.animation = anim.value;
        setOwnAnimations(d.rec!, ownAnimations(d.rec!), store.project.mod ?? "");
      }),
    );
    return [
      surfCard,
      ...ownGbcCard(id, ts),
      h("div", { class: "card" },
        h("h4", {}, "Your tileset"),
        h("div", { class: "kv" }, h("span", {}, "Sheet"), h("code", {}, `${tileCount} tiles${ts.trueColor ? ", full color" : ""}`)),
        field("Animation", anim, "Water animates tile #20 like the game's water; flowers tile #3."),
        h("button", {
          class: "btn small danger",
          disabled: users.length > 0,
          title: users.length ? "Maps still use it" : "Delete this tileset",
          onclick: () => {
            // its RED++ colors go with it (they'd color a later tileset of
            // the same name)
            store.group(`Delete ${id}`, () => {
              store.setRecord("tilesets", id, `Delete ${id}`, undefined);
              if (store.table(EXTENSIONS)[id] !== undefined) store.setRecord(EXTENSIONS, id, `Delete ${id}`, undefined);
            });
            store.seal();
            current = tilesetIds()[0] ?? null;
            void render();
          },
        }, "Delete tileset"),
      ),
      usedBy,
    ];
  };

  // ------------------------------------------------------------- cut
  // field.cutTreeSwaps: a cut block turns into `after` (OVERWORLD and GYM
  // share the list, by block number)
  const cutSwapRow = (id: string, b: number, block: number[], count: number): HTMLElement[] => {
    const tiles = CUT_TILES[id];
    if (!tiles) return [];
    const swaps = (store.table("field").cutTreeSwaps as { before: number; after: number }[] | undefined) ?? [];
    const swap = swaps.find((s) => s.before === b);
    const hasCutTile = [4, 6, 12, 14].some((slot) => tiles.some((c) => c.tile === block[slot]));
    const input = h("input", { type: "number", min: 0, max: count - 1, value: swap ? String(swap.after) : "", placeholder: "none" });
    input.addEventListener("change", () => {
      const v = input.value.trim() === "" ? null : Math.max(0, Math.min(count - 1, Math.trunc(Number(input.value))));
      store.editRecord<{ before: number; after: number }[]>("field", "cutTreeSwaps", v === null ? `Block #${b}: not cuttable` : `Block #${b}: cut into #${v}`, (l) => {
        const i = l.findIndex((s) => s.before === b);
        if (v === null) {
          if (i >= 0) l.splice(i, 1);
        } else if (i >= 0) l[i] = { before: b, after: v };
        else l.push({ before: b, after: v });
      }, { create: () => [] });
      store.seal();
    });
    return [
      h("div", { class: "row nowrap" }, h("span", { class: "field-label" }, "When cut, becomes block"), input,
        swap ? h("button", { class: "btn small ghost", title: "Show that block", onclick: () => ((selBlock = swap.after), void render()) }, "→") : null),
      h("p", { class: hasCutTile || !swap ? "hint" : "hint warn" }, hasCutTile
        ? `Cut works on a quarter whose bottom-left tile is the ${tiles.map((c) => `${c.what} (#${c.tile})`).join(" or ")}. Empty: can't be cut. The swap list is shared by OVERWORLD and GYM.`
        : `No quarter of this block has a cuttable tile (${tiles.map((c) => `${c.what} #${c.tile}`).join(", ")}) bottom-left, so Cut does nothing here.`),
    ];
  };

  // ------------------------------------------------------------- RED++
  // Edits a tileset's RED++ coloring: the extension's (game tilesets) or the
  // record holding a mod tileset's colors (dropped when emptied).
  const editColoring = (id: string, label: string, mutate: (g: GbcColoring) => void) => {
    if (isBaseTileset(id)) {
      editTileset(id, label, (d) => {
        const ext = d as unknown as TilesetExtension;
        ext.gbc ??= {};
        mutate(ext.gbc);
        if (!ext.gbc.groups?.length && !ext.gbc.palettes) delete ext.gbc;
      });
    } else {
      const cur = store.table(EXTENSIONS)[id] as { gbc?: GbcColoring } | undefined;
      const next = clone(cur ?? {}) as { gbc?: GbcColoring };
      next.gbc ??= {};
      mutate(next.gbc);
      if (!next.gbc.groups?.length && !next.gbc.palettes) delete next.gbc;
      store.setRecord(EXTENSIONS, id, label, Object.keys(next).length ? next : undefined);
      store.seal();
    }
  };

  const setGroup = (id: string, tiles: number[], group: number) =>
    editColoring(id, tiles.length > 1 ? "Tiles: RED++ palette" : "Tile: RED++ palette", (g) => {
      g.groups = [...(g.groups ?? []).filter(([t]) => !tiles.includes(t)), ...tiles.map((t) => [t, group] as [number, number])].sort((a, b) => a[0] - b[0]);
    });

  // the 8 palettes as swatches; the tiles' one is outlined (when they share it)
  const gbcRow = (id: string, tiles: number[], mine: number[]): HTMLElement[] => {
    const groups = groupColors(id);
    if (!gbcAvailable() || !groups) return [];
    const can = mine.length > 0;
    const all = [...new Set(tiles.map((x) => groupOf(id, x)))];
    const current = all.length === 1 ? all[0] : -1;
    const swatches = groups.map((colors, g) =>
      h("button", {
        class: `gbc-swatch${g === current ? " active" : ""}`,
        title: `${GROUP_NAMES[g] ?? g}${g === 6 ? " (its middle colors follow the town)" : ""}`,
        disabled: !can,
        onclick: () => setGroup(id, mine, g),
      }, ...colors.map((c) => h("span", { style: `background: rgb(${c[0]}, ${c[1]}, ${c[2]})` }))),
    );
    return [
      h("div", { class: "field" },
        h("span", { class: "field-label" }, `RED++ palette: ${current < 0 ? "mixed" : GROUP_NAMES[current] ?? current}`),
        h("div", { class: "gbc-swatches" }, ...swatches),
        h("p", { class: "hint" }, can
          ? "The colors this tile takes in the game's RED++ color mode (Game Boy Color). Your tiles start on Text, which rarely fits."
          : "The game's choice for this tile."),
      ),
    ];
  };

  // a mod tileset's 8 RED++ palettes (gray tilesets only: full-color ones
  // keep their own colors in RED++)
  const ownGbcCard = (id: string, ts: TilesetDef): HTMLElement[] => {
    if (ts.trueColor || !gbcAvailable()) return [];
    const own = (store.table(EXTENSIONS)[id] as { gbc?: GbcColoring } | undefined)?.gbc;
    // the game tilesets whose 8 palettes a mod tileset can take
    const sources = tilesetIds().filter((t) => isBaseTileset(t) && groupColors(t));
    if (!own?.palettes) {
      return [h("div", { class: "card" },
        h("h4", {}, "RED++ colors"),
        h("p", { class: "hint" }, "In the game's RED++ color mode this tileset uses the map's Game Boy palette. Give it 8 palettes of its own, and pick one per tile (in the tile's panel)."),
        h("button", {
          class: "btn small",
          onclick: () => {
            const src = groupColors(sources.includes("OVERWORLD") ? "OVERWORLD" : sources[0]);
            if (!src) return;
            const tiles = sheetTiles(ts);
            editColoring(id, "RED++ colors", (g) => {
              g.palettes = clone(src);
              g.groups = Array.from({ length: tiles }, (_v, t) => [t, 0] as [number, number]);
            });
          },
        }, "Give it RED++ colors"),
      )];
    }
    // which game tileset's palettes these are ("" once a color was changed);
    // switching replaces all 8, the tiles keep their palette numbers
    const same = (a: Rgb[][], b: Rgb[][]) => JSON.stringify(a) === JSON.stringify(b);
    const match = sources.find((t) => same(groupColors(t)!, own.palettes!)) ?? "";
    const from = h("select", { title: "Take all 8 palettes from a game tileset" },
      match ? null : h("option", { value: "", selected: true }, "Your own colors"),
      ...sources.map((t) => h("option", { value: t, selected: t === match }, t)),
    );
    from.addEventListener("change", () => {
      const src = groupColors(from.value);
      if (!src) return;
      editColoring(id, `RED++ palettes of ${from.value}`, (g) => {
        g.palettes = clone(src);
      });
    });
    const rows = own.palettes.map((colors, gi) =>
      h("div", { class: "gbc-row" },
        h("span", { class: "gbc-name" }, GROUP_NAMES[gi] ?? String(gi)),
        ...colors.map((c, ci) => {
          const input = h("input", { type: "color", value: `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`, title: ci === 0 ? "Lightest" : ci === 3 ? "Darkest" : "" });
          input.addEventListener("change", () => {
            const v = input.value;
            const rgb = [1, 3, 5].map((k) => parseInt(v.slice(k, k + 2), 16)) as Rgb;
            editColoring(id, "RED++ palette color", (g) => {
              g.palettes![gi][ci] = rgb;
            });
          });
          return input;
        }),
      ),
    );
    return [h("div", { class: "card" },
      h("h4", {}, "RED++ colors"),
      field("Palettes of", from, match ? "A game tileset's palettes. Change a color below to make your own." : "Pick a game tileset to take its 8 palettes instead (your color changes are replaced)."),
      h("p", { class: "hint" }, "8 palettes, lightest color first; each tile uses one (pick it in the tile's panel)."),
      ...rows,
      h("button", { class: "btn small danger", onclick: () => editColoring(id, "Remove RED++ colors", (g) => { delete g.palettes; delete g.groups; }) }, "Remove RED++ colors"),
    )];
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

  // The sheet as it is now, for an import: tiles it has and their keys.
  const sheetState = async (id: string) => {
    const ts = liveTileset(id)!;
    const per = perRow(ts);
    const sheet = await readSheet(await tilesetUrl(id));
    const ed = editable(id);
    const capacity = sheet ? Math.floor(sheet.width / TILE) * Math.floor(sheet.height / TILE) : 0;
    const have = ed.own ? capacity : ed.firstTile + (extensionOf(id)?.tiles.length ?? 0);
    return { ts, per, sheet, ed, have, trueColor: !!ts.trueColor };
  };

  // Writes an import: new tiles (walkable), blocks and animations as one step.
  const commitImport = (id: string, plan: ImportPlan, label: string) => {
    const ed = editable(id);
    const mod = store.project.mod!;
    const keepFrames = (a: ImportPlan["anims"][number]): EngineAnimation => ({
      tile: a.tile,
      kind: "frames",
      period: 20,
      images: a.frames.map((f, k) => addAsset(mod, `${id.toLowerCase()}_${a.tile}_${k + 1}`, pngBytes(tileCanvas(f.px)))),
      sequence: a.frames.map((_f, k) => k + 1),
    });
    if (ed.own) {
      const all = [...(plan.sheet ? sheetTileList(plan.sheet, plan.per, plan.have) : []), ...plan.fresh.map((f) => f.px)];
      const canvas = sheetCanvas(all, plan.per);
      const path = plan.fresh.length ? addAsset(mod, id.toLowerCase(), pngBytes(canvas)) : null;
      const added = plan.anims.map(keepFrames);
      // with RED++ palettes of its own, new tiles start on the first one (an
      // unassigned tile gets the engine's Text palette: black and white)
      const own = (store.table(EXTENSIONS)[id] as { gbc?: GbcColoring } | undefined)?.gbc;
      const newTiles = Array.from({ length: plan.fresh.length }, (_v, i) => plan.have + i).filter((t) => !plan.filler?.has(t));
      store.group(label, () => {
      if (own?.palettes && newTiles.length) {
        editColoring(id, label, (g) => {
          g.groups = [...(g.groups ?? []).filter(([t]) => !newTiles.includes(t)), ...newTiles.map((t) => [t, 0] as [number, number])].sort((a, b) => a[0] - b[0]);
        });
      }
      editTileset(id, label, (d) => {
        if (path) {
          d.rec!.image = path;
          d.rec!.imageWidth = canvas.width;
          d.rec!.imageHeight = canvas.height;
          d.rec!.tilesPerRow = plan.per;
        }
        d.blocks.push(...plan.blocks);
        for (let t = plan.have; t < plan.have + plan.fresh.length; t++) if (!plan.filler?.has(t)) d.walkable.push(t);
        if (added.length) {
          const tiles = new Set(added.map((a) => a.tile));
          setOwnAnimations(d.rec!, [...ownAnimations(d.rec!).filter((a) => !tiles.has(a.tile!)), ...added], mod);
        }
      });
      });
    } else {
      editTileset(id, label, (d) => {
        const ext = d as unknown as TilesetExtension;
        ext.tiles.push(...plan.fresh.map((f) => f.key));
        ext.blocks.push(...plan.blocks);
        for (let t = plan.have; t < plan.have + plan.fresh.length; t++) if (!plan.filler?.has(t)) ext.walkable!.push(t);
        if (plan.anims.length) {
          const tiles = new Set(plan.anims.map((a) => a.tile));
          ext.animated = [...(ext.animated ?? []).filter((a) => !tiles.has(a.tile)), ...plan.anims.map((a) => ({ tile: a.tile, period: 20, frames: a.frames.map((f) => f.key) }))];
        }
      });
    }
  };

  // Changes (or with null, removes) one tile's animation.
  const setAnimation = (id: string, tile: number, change: (a: { period: number }) => { period: number } | null) => {
    if (isBaseTileset(id)) {
      editTileset(id, "Tile animation", (d) => {
        const ext = d as unknown as TilesetExtension;
        ext.animated = (ext.animated ?? []).flatMap((a) => {
          if (a.tile !== tile) return [a];
          const next = change(a);
          return next ? [{ ...a, period: next.period }] : [];
        });
        if (!ext.animated.length) delete ext.animated;
      });
    } else {
      editTileset(id, "Tile animation", (d) => {
        const mine = ownAnimations(d.rec!).flatMap((a) => {
          if (a.tile !== tile) return [a];
          const next = change({ period: a.period ?? 20 });
          return next ? [{ ...a, period: next.period }] : [];
        });
        setOwnAnimations(d.rec!, mine, store.project.mod ?? "");
      });
    }
  };

  // frames of a strip: whole `size` squares side by side or stacked
  const framesOf = (img: HTMLImageElement, size: number): { n: number; across: boolean } => {
    if (img.height === size && img.width % size === 0 && img.width >= size * 2) return { n: img.width / size, across: true };
    if (img.width === size && img.height % size === 0 && img.height >= size * 2) return { n: img.height / size, across: false };
    throw new Error(`The frames must be ${size}×${size} each, side by side or stacked (at least 2): this picture is ${img.width}×${img.height}.`);
  };

  // One tile's animation from a strip of 8x8 frames; frame 1 becomes the tile.
  const animateTile = async (id: string, tile: number) => {
    if (!store.project.mod) return toast("Open a mod first: the frames are saved into it.", "error");
    const file = await pickFile();
    if (!file) return;
    try {
      const img = await loadFile(file);
      framesOf(img, TILE);
      const st = await sheetState(id);
      const cut = cutPicture(img, st.trueColor);
      const frames = cut.grid.flat().map((i) => cut.tiles[i]);
      const plan: ImportPlan = { have: st.have, sheet: null, per: st.per, fresh: [], blocks: [], anims: [{ tile, frames }] };
      // the sheet's copy of the tile shows frame 1 (where nothing animates)
      if (st.ed.own) {
        const all = sheetTileList(st.sheet!, st.per, st.have);
        all[tile] = frames[0].px;
        const canvas = sheetCanvas(all, st.per);
        const path = addAsset(store.project.mod, id.toLowerCase(), pngBytes(canvas));
        store.group("Animate tile", () => {
          editTileset(id, "Animate tile", (d) => {
            d.rec!.image = path;
            d.rec!.imageWidth = canvas.width;
            d.rec!.imageHeight = canvas.height;
          });
          commitImport(id, plan, "Animate tile");
        });
      } else {
        store.group("Animate tile", () => {
          editTileset(id, "Animate tile", (d) => {
            d.tiles![tile - st.ed.firstTile] = frames[0].key;
          });
          commitImport(id, plan, "Animate tile");
        });
      }
      toast(`Tile #${tile} animates through ${frames.length} frames.`, "ok");
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "error");
    }
  };

  // A block from a strip of 32x32 frames: tiles that stay the same are
  // ordinary (shared) tiles; each tile that changes gets a tile of its own
  // animated through its frames.
  const importAnimatedBlock = async (id: string) => {
    if (!store.project.mod) return toast("Open a mod first: the frames are saved into it.", "error");
    const file = await pickFile();
    if (!file) return;
    try {
      const img = await loadFile(file);
      const { n, across } = framesOf(img, BLOCK);
      const st = await sheetState(id);
      const cut = cutPicture(img, st.trueColor);
      const existing = existingKeys(st.sheet, st.per, st.have, st.trueColor);
      const fresh: Cut["tiles"] = [];
      const anims: ImportPlan["anims"] = [];
      const bySequence = new Map<string, number>();
      const block: number[] = [];
      for (let slot = 0; slot < 16; slot++) {
        const sx = slot % 4;
        const sy = Math.floor(slot / 4);
        const frames = Array.from({ length: n }, (_v, f) => cut.tiles[across ? cut.grid[sy][f * 4 + sx] : cut.grid[f * 4 + sy][sx]]);
        if (frames.every((f) => f.key === frames[0].key)) {
          let t = existing.get(frames[0].key);
          if (t === undefined) {
            t = st.have + fresh.length;
            fresh.push(frames[0]);
            existing.set(frames[0].key, t);
          }
          block.push(t);
        } else {
          const seq = frames.map((f) => f.key).join("|");
          let t = bySequence.get(seq);
          if (t === undefined) {
            t = st.have + fresh.length;
            fresh.push(frames[0]);
            bySequence.set(seq, t);
            anims.push({ tile: t, frames });
          }
          block.push(t);
        }
      }
      if (!anims.length) toast("Nothing changes between the frames: imported as a still block.", "info");
      commitImport(id, { have: st.have, sheet: st.sheet, per: st.per, fresh, blocks: [block], anims }, "Animated block");
      selBlock = (liveTileset(id)?.blocks.length ?? 1) - 1;
      void render();
      if (anims.length) toast(`New block #${selBlock}: ${anims.length} animated tile${anims.length === 1 ? "" : "s"}, ${n} frames each.`, "ok");
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "error");
    }
  };

  // Tiles from a picture: identical tiles are reused (the sheet's own too),
  // each whole 32x32 square becomes a block.
  const importTiles = async (id: string) => {
    if (!store.project.mod) return toast("Open a mod first: imported tiles are saved into it.", "error");
    const res = await promptPicture("Import tiles", "Added below the sheet's tiles. Every whole 32×32 square also becomes a block.");
    if (!res) return;
    try {
      const img = await loadFile(res.file);
      if (img.width < TILE || img.height < TILE) throw new Error("The picture is smaller than one 8×8 tile.");
      const st = await sheetState(id);
      // keep the layout: the picture's rows start on a fresh sheet row, the
      // rest of each row stays blank (only when it fits the sheet's width)
      if (!res.optimize && Math.floor(img.width / TILE) <= st.per) {
        const cut = cutPicture(img, st.trueColor, false);
        const start = Math.ceil(st.have / st.per) * st.per;
        const fresh: Cut["tiles"] = Array.from({ length: start - st.have }, blankTile);
        const filler = new Set<number>(Array.from({ length: start - st.have }, (_v, i) => st.have + i));
        for (let y = 0; y < cut.rows; y++) {
          for (let x = 0; x < st.per; x++) {
            if (x >= cut.cols) filler.add(st.have + fresh.length);
            fresh.push(x < cut.cols ? cut.tiles[cut.grid[y][x]] : blankTile());
          }
        }
        const blocks = blocksOf(cut, (i) => start + Math.floor(i / cut.cols) * st.per + (i % cut.cols));
        commitImport(id, { have: st.have, sheet: st.sheet, per: st.per, fresh, blocks, anims: [], filler }, "Import tiles");
        toast(`${cut.cols * cut.rows} tiles added as laid out (from #${start}), ${blocks.length} new block${blocks.length === 1 ? "" : "s"}. New tiles start walkable.`, "ok");
        return;
      }
      if (!res.optimize) toast(`The picture is wider than the sheet (${st.per} tiles a row), so its tiles were packed.`, "info");
      const cut = cutPicture(img, st.trueColor);
      const have = st.have;
      const existing = existingKeys(st.sheet, st.per, have, st.trueColor);
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
      commitImport(id, { have, sheet: st.sheet, per: st.per, fresh, blocks, anims: [] }, "Import tiles");
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
      const img = await loadFile(res.file);
      if (img.width < TILE || img.height < TILE) throw new Error("The picture is smaller than one 8×8 tile.");
      // as laid out: the picture is the sheet (its own width); optimized:
      // repeats stored once, 16 tiles a row
      const cut = cutPicture(img, res.trueColor, res.optimize);
      const per = res.optimize ? 16 : Math.max(1, cut.cols);
      const canvas = sheetCanvas(cut.tiles.map((t) => t.px), per);
      const path = addAsset(store.project.mod!, res.id.toLowerCase(), pngBytes(canvas));
      let blocks = blocksOf(cut, (i) => i);
      if (!blocks.length) blocks = [new Array<number>(16).fill(0)];
      const record: TilesetDef = {
        id: res.id,
        image: path,
        imageWidth: canvas.width,
        imageHeight: canvas.height,
        tilesPerRow: per,
        ...(res.trueColor ? { trueColor: true } : {}),
        animation: "TILEANIM_NONE",
        walkable: cut.tiles.map((_t, i) => i),
        doorTiles: [],
        warpTiles: [],
        counterTiles: [],
        blocks,
      };
      store.group(`New tileset ${res.id}`, () => {
        // colors left by a deleted tileset of the same name don't belong to it
        if (store.table(EXTENSIONS)[res.id] !== undefined) store.setRecord(EXTENSIONS, res.id, `New tileset ${res.id}`, undefined);
        store.setRecord("tilesets", res.id, `New tileset ${res.id}`, clone(record));
      });
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
      if (nav.workspace === "graphics" && nav.graphicsView === "tilesets") void render();
    });
  };
  store.on((reason, id, registry) => {
    if (reason === "project") {
      if (!current || !tilesetsTable()[current]) current = store.map?.tileset ?? tilesetIds()[0] ?? null;
      selTile = null;
      selBlock = null;
      schedule();
    } else if (reason === "content" && (registry === "tilesets" || registry === EXTENSIONS || registry === "field")) {
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
function promptNewTileset(taken: string[]): Promise<{ id: string; file: File; trueColor: boolean; optimize: boolean } | null> {
  return new Promise((resolve) => {
    const dialog = h("dialog", {});
    const id = h("input", { type: "text", spellcheck: false, placeholder: "MY_TILES" });
    const file = h("input", { type: "file", accept: "image/png,image/gif,image/bmp,image/webp" });
    const color = h("input", { type: "checkbox" });
    const optimize = h("input", { type: "checkbox" });
    const close = (v: { id: string; file: File; trueColor: boolean; optimize: boolean } | null) => {
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
      close({ id: newId, file: f, trueColor: color.checked, optimize: optimize.checked });
    };
    id.addEventListener("keydown", (e) => e.key === "Enter" && create());
    dialog.addEventListener("cancel", (e) => {
      e.preventDefault();
      close(null);
    });
    dialog.append(
      h("h3", {}, "New tileset"),
      field("Id", id, "Maps name their tileset by this id; cannot be changed later."),
      field("Picture", file, "Cut into 8×8 tiles; every whole 32×32 square also becomes a block. A map drawn as one picture works straight away."),
      h("label", { class: "inline-check" }, optimize, "Optimize: store repeated tiles once and pack the sheet (smaller, but your layout isn't kept)"),
      h("label", { class: "inline-check" }, color, "Full color (keep the picture's colors instead of the 4 Game Boy shades the map palette colors)"),
      h("div", { class: "dialog-actions" }, h("button", { class: "btn", onclick: () => close(null) }, "Cancel"), h("button", { class: "btn primary", onclick: create }, "Create")),
    );
    document.body.append(dialog);
    dialog.showModal();
    id.focus();
  });
}

// a picture to import, and whether to optimize it
function promptPicture(title: string, hint: string): Promise<{ file: File; optimize: boolean } | null> {
  return new Promise((resolve) => {
    const dialog = h("dialog", {});
    const file = h("input", { type: "file", accept: "image/png,image/gif,image/bmp,image/webp" });
    const optimize = h("input", { type: "checkbox" });
    const close = (v: { file: File; optimize: boolean } | null) => {
      dialog.close();
      dialog.remove();
      resolve(v);
    };
    const go = () => {
      const f = file.files?.[0];
      if (!f) return toast("Pick a picture", "error");
      close({ file: f, optimize: optimize.checked });
    };
    dialog.addEventListener("cancel", (e) => {
      e.preventDefault();
      close(null);
    });
    dialog.append(
      h("h3", {}, title),
      field("Picture", file, hint),
      h("label", { class: "inline-check" }, optimize, "Optimize: store repeated tiles once, reuse tiles the sheet already has, and pack them (fewer tiles, but your layout isn't kept)"),
      h("p", { class: "hint" }, "Without it, the picture is added as laid out, starting on a new row of the sheet."),
      h("div", { class: "dialog-actions" }, h("button", { class: "btn", onclick: () => close(null) }, "Cancel"), h("button", { class: "btn primary", onclick: go }, "Import")),
    );
    document.body.append(dialog);
    dialog.showModal();
  });
}
