// Tilesets as the editor sees them: the dataset's, the mod's own (records of
// the "tilesets" registry) and vanilla ones the mod extends (studio_tilesets:
// tiles and blocks appended to a vanilla tileset).
//
// The engine draws a map from exactly one image, so an extension becomes one
// sheet: the player's own imported sheet with the added tiles below it, built
// on their machine by the assets_transforms recipe (assets.ts) and patched in
// by src/lua/tilesetRuntime.ts. The editor builds the same sheet in memory.

import type { TilesetDef } from "./types.ts";
import type { GbcColoring } from "./gbc.ts";
import { store } from "./store.ts";
import { assetUrl, CACHE, type SheetRecipe } from "./assets.ts";
import { extendedSheetRel, frameRel, SPINNER_TILESETS } from "../lua/tilesetRuntime.ts";
import { loadImage, TILE } from "../render/graphics.ts";

export interface TilesetExtension {
  // the first added tile's id: the vanilla sheet's tile count
  first: number;
  // 64 digits per tile, row by row: the importer's shades, 0 white .. 3 black;
  // or "<TILESET>:<tile>", a tile of another game tileset the recipe copies
  // from the player's own sheet (no ROM pixels in the mod)
  tiles: string[];
  blocks: number[][];
  walkable?: number[];
  // animated tiles: the tile's frames (shade digits), `period` 60ths of a
  // second each; the sheet holds frame 1
  animated?: AnimatedTile[];
  // RED++ palette groups of the added tiles (see gbc.ts)
  gbc?: GbcColoring;
  // added tiles that are water / shore (surfable), appended to the tileset's
  water?: number[];
  shore?: number[];
}

// Surfing (gen1recomp src/world/Map.lua): a cell is surfable when its
// tileset is in field.waterTilesets and its bottom-left tile is a water or
// shore tile; a tileset without its own lists uses these (no shore on
// SHIP_PORT, where $32 is the dock).
export const DEFAULT_WATER = [0x14];
export const DEFAULT_SHORE = [0x32, 0x48];

export function waterTilesOf(ts: TilesetDef): number[] {
  return (ts.waterTiles as number[] | undefined) ?? DEFAULT_WATER;
}

export function shoreTilesOf(ts: TilesetDef): number[] {
  return (ts.shoreTiles as number[] | undefined) ?? (ts.id === "SHIP_PORT" ? [] : DEFAULT_SHORE);
}

// Cut (OverworldController tryCut): only these tilesets and tiles can be
// cut, fixed in the engine; the faced cell's block also needs an entry in
// field.cutTreeSwaps (shared by both tilesets, by block number).
export const CUT_TILES: Record<string, { tile: number; what: string }[]> = {
  OVERWORLD: [{ tile: 0x3d, what: "tree" }, { tile: 0x52, what: "tall grass" }],
  GYM: [{ tile: 0x50, what: "plant" }],
};

export interface AnimatedTile {
  tile: number;
  period: number;
  frames: string[];
}

// An entry of the engine's animatedTiles list (src/render/TileRenderer.lua).
export interface EngineAnimation {
  tile?: number;
  tiles?: number[];
  kind: string;
  period?: number;
  images?: string[];
  sequence?: number[];
  offsets?: number[];
}

export const EXTENSIONS = "studio_tilesets";

// an added tile copied from another game tileset: "CAVERN:37"
export function parseTileRef(t: string): { tileset: string; tile: number } | null {
  const m = /^([A-Z0-9_]+):(\d+)$/.exec(t);
  return m ? { tileset: m[1], tile: Number(m[2]) } : null;
}

// game tilesets whose original tiles can be copied: drawn from the player's
// own imported sheet
export function canCopyFrom(id: string): boolean {
  const ts = store.baseTable("tilesets")[id] as TilesetDef | undefined;
  return !!ts && typeof ts.image === "string" && ts.image.startsWith(CACHE);
}

// where tile `tile` sits on its sheet, in pixels
function tileOrigin(ts: TilesetDef, tile: number): { x: number; y: number } {
  const per = perRow(ts);
  return { x: (tile % per) * TILE, y: Math.floor(tile / per) * TILE };
}
export const SHADE_GRAY = [255, 170, 85, 0];

// what the mod adds to a game tileset (a mod tileset's studio_tilesets
// record holds only its RED++ colors, see gbc.ts)
export function extensionOf(id: string): TilesetExtension | undefined {
  if (!isBaseTileset(id)) return undefined;
  return store.table(EXTENSIONS)[id] as TilesetExtension | undefined;
}

// the tiles a sheet holds (whole 8x8 cells)
export function sheetTiles(ts: TilesetDef): number {
  const w = Number(ts.imageWidth) || 0;
  const h = Number(ts.imageHeight) || 0;
  return Math.floor(w / TILE) * Math.floor(h / TILE);
}

export function perRow(ts: TilesetDef): number {
  return ts.tilesPerRow || Math.max(1, Math.floor((Number(ts.imageWidth) || 128) / TILE));
}

// whether a tileset comes from the dataset (or the mod's main.lua), not the studio
export function isBaseTileset(id: string): boolean {
  return store.baseTable("tilesets")[id] !== undefined;
}

const live = new WeakMap<object, WeakMap<object, TilesetDef>>();

// The tileset with its extension applied (what the engine ends up with).
export function liveTileset(id: string): TilesetDef | undefined {
  const base = store.table("tilesets")[id] as TilesetDef | undefined;
  if (!base) return undefined;
  const ext = extensionOf(id);
  if (!ext) return base;
  let byExt = live.get(base);
  if (!byExt) live.set(base, (byExt = new WeakMap()));
  let out = byExt.get(ext);
  if (!out) {
    const rows = Math.ceil(ext.tiles.length / perRow(base));
    out = {
      ...base,
      imageHeight: (Number(base.imageHeight) || 0) + rows * TILE,
      blocks: [...base.blocks, ...ext.blocks],
      walkable: [...((base.walkable as number[] | undefined) ?? []), ...(ext.walkable ?? [])],
      ...(ext.water?.length ? { waterTiles: [...waterTilesOf(base), ...ext.water] } : {}),
      ...(ext.shore?.length ? { shoreTiles: [...shoreTilesOf(base), ...ext.shore] } : {}),
    };
    byExt.set(ext, out);
  }
  return out;
}

export function tilesetIds(): string[] {
  return Object.keys(store.table("tilesets")).sort();
}

// A key that changes whenever the tileset or its extension is edited (each
// edit replaces the record), for caches of drawn blocks.
const ids = new WeakMap<object, number>();
let nextId = 1;
function objId(o: object | undefined): number {
  if (!o) return 0;
  let n = ids.get(o);
  if (!n) ids.set(o, (n = nextId++));
  return n;
}
export function tilesetKey(id: string): string {
  return `${id}#${objId(store.table("tilesets")[id] as object | undefined)}.${objId(store.table(EXTENSIONS)[id] as object | undefined)}`;
}

// ------------------------------------------------------------------ sheets


// What the assets_transforms recipe builds for the extensions with tiles:
// the vanilla sheet the extension was made on, plus the added tiles. An
// extension of a tileset that no longer draws from the player's sheet (the
// mod's own code replaced it) gets none.
export function sheetRecipes(): SheetRecipe[] {
  const out: SheetRecipe[] = [];
  for (const [id, value] of Object.entries(store.table(EXTENSIONS))) {
    const ext = value as TilesetExtension;
    const base = store.baseTable("tilesets")[id] as TilesetDef | undefined;
    if (!ext || !base || !base.image.startsWith(CACHE)) continue;
    const animated = canAnimate(id) ? ext.animated ?? [] : [];
    if (!ext.tiles?.length && !animated.length) continue;
    out.push({
      source: base.image.slice(CACHE.length),
      out: extendedSheetRel(id),
      per: perRow(base),
      tiles: (ext.tiles ?? []).map((t) => {
        const ref = parseTileRef(t);
        const src = ref && (store.baseTable("tilesets")[ref.tileset] as TilesetDef | undefined);
        return ref && src ? { from: src.image.slice(CACHE.length), ...tileOrigin(src, ref.tile) } : t;
      }),
      frames: animated.flatMap((a) => a.frames.map((tile, k) => ({ out: frameRel(id, a.tile, k + 1), tile }))),
      // restating the flower animation needs the player's flower frames
      copies: animated.length && base.animation === "TILEANIM_WATER_FLOWER" && !Array.isArray(base.animatedTiles) ? FLOWERS : [],
    });
  }
  return out.sort((a, b) => a.out.localeCompare(b.out));
}

const FLOWERS = ["tilesets/flower1.png", "tilesets/flower2.png", "tilesets/flower3.png"];

// custom animations replace a tileset's built-in ones, which are restated;
// the spinner puzzles' can't be
export function canAnimate(id: string): boolean {
  return !SPINNER_TILESETS.includes(id);
}

// The built-in animations of a tileset's `animation` string, as the engine
// derives them, for a mod tileset that adds its own (flower frames: the
// recipe's copies of the player's own).
export function builtinAnimations(animation: unknown, modId: string): EngineAnimation[] {
  const out: EngineAnimation[] = [];
  if (animation === "TILEANIM_WATER" || animation === "TILEANIM_WATER_FLOWER") {
    out.push({ tile: 20, kind: "hshift", period: 20, offsets: [1, 2, 3, 2, 1, 0, 7, 0] });
  }
  if (animation === "TILEANIM_WATER_FLOWER") {
    out.push({ tile: 3, kind: "frames", period: 20, sequence: [1, 2, 3, 1, 1, 2, 3, 1], images: FLOWERS.map((f) => `save/mod-derived/${modId}/studio/${f}`) });
  }
  return out;
}

// a mod tileset's own animated tiles (frames are images of the mod)
export function ownAnimations(rec: TilesetDef): EngineAnimation[] {
  const list = Array.isArray(rec.animatedTiles) ? (rec.animatedTiles as EngineAnimation[]) : [];
  return list.filter((a) => a.kind === "frames" && typeof a.tile === "number" && (a.images ?? []).every((i) => i.startsWith("mods/")));
}

// rewrites a mod tileset's animatedTiles: the built-ins of its animation
// string + its own (none: the key goes, the engine derives the built-ins)
export function setOwnAnimations(rec: TilesetDef, mine: EngineAnimation[], modId: string): void {
  if (mine.length) rec.animatedTiles = [...builtinAnimations(rec.animation, modId), ...mine];
  else delete rec.animatedTiles;
}

// Animated tiles of a tileset for the editor: tile -> frames as image URLs
// (extension frames are painted from their digits).
export function animationsOf(id: string): Map<number, { period: number; urls: string[] }> {
  const out = new Map<number, { period: number; urls: string[] }>();
  const rec = store.table("tilesets")[id] as TilesetDef | undefined;
  if (!rec) return out;
  if (isBaseTileset(id)) {
    for (const a of extensionOf(id)?.animated ?? []) out.set(a.tile, { period: a.period, urls: a.frames.map(digitsUrl) });
  } else {
    for (const a of ownAnimations(rec)) out.set(a.tile!, { period: a.period ?? 20, urls: (a.images ?? []).map((p) => assetUrl(store.project.host, store.project.version, p)) });
  }
  return out;
}

const digitUrls = new Map<string, string>();
function digitsUrl(digits: string): string {
  let u = digitUrls.get(digits);
  if (!u) {
    const c = document.createElement("canvas");
    c.width = TILE;
    c.height = TILE;
    const ctx = c.getContext("2d")!;
    const img = ctx.createImageData(TILE, TILE);
    paintTile(img.data, digits);
    ctx.putImageData(img, 0, 0);
    u = c.toDataURL("image/png");
    digitUrls.set(digits, u);
  }
  return u;
}

const composites = new Map<string, Promise<string>>();

export function baseSheetUrl(ts: TilesetDef): string {
  return assetUrl(store.project.host, store.project.version, ts.image);
}

// The sheet image a tileset draws from: an extension's is the vanilla sheet
// with the added tiles painted below it (a data URL, cached per content).
export function tilesetUrl(id: string): Promise<string> {
  const base = store.table("tilesets")[id] as TilesetDef | undefined;
  if (!base) return Promise.resolve("");
  const url = baseSheetUrl(base);
  const ext = extensionOf(id);
  if (!ext?.tiles.length) return Promise.resolve(url);
  const key = `${url}|${perRow(base)}|${ext.tiles.join(",")}`;
  let p = composites.get(key);
  if (!p) {
    p = compose(url, perRow(base), ext.tiles);
    composites.set(key, p);
  }
  return p;
}

export async function compose(url: string, per: number, tiles: string[]): Promise<string> {
  const img = await loadImage(url);
  const width = img?.width || per * TILE;
  const top = img?.height ?? 0;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = top + Math.ceil(tiles.length / per) * TILE;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (img) ctx.drawImage(img, 0, 0);
  const out = ctx.createImageData(TILE, TILE);
  for (const [i, t] of tiles.entries()) {
    const x = (i % per) * TILE;
    const y = top + Math.floor(i / per) * TILE;
    const ref = parseTileRef(t);
    const src = ref && (store.baseTable("tilesets")[ref.tileset] as TilesetDef | undefined);
    if (ref && src) {
      // a copied tile: drawn from the other tileset's sheet, like the recipe
      const sheet = await loadImage(baseSheetUrl(src));
      const o = tileOrigin(src, ref.tile);
      if (sheet) ctx.drawImage(sheet, o.x, o.y, TILE, TILE, x, y, TILE, TILE);
      continue;
    }
    paintTile(out.data, t);
    ctx.putImageData(out, x, y);
  }
  return canvas.toDataURL("image/png");
}

// one tile's shade digits into RGBA
export function paintTile(rgba: Uint8ClampedArray, digits: string): void {
  for (let p = 0; p < 64; p++) {
    const g = SHADE_GRAY[Number(digits[p]) || 0] ?? 255;
    rgba[p * 4] = rgba[p * 4 + 1] = rgba[p * 4 + 2] = g;
    rgba[p * 4 + 3] = 255;
  }
}

// What moves on a map drawn with this tileset, as the engine animates it
// (TileRenderer defaultAnimatedTiles + the mod's own): water shifts tile 20
// sideways, flowers cycle the cache's three frames, added tiles their own.
// `sequence` holds 1-based frame numbers (for a shift: offset + 1).
export interface MapAnimation {
  tile: number;
  period: number;
  sequence: number[];
  shift?: boolean;
  urls?: string[];
}

export function mapAnimations(id: string): MapAnimation[] {
  const rec = store.table("tilesets")[id] as TilesetDef | undefined;
  if (!rec) return [];
  const byTile = new Map<number, MapAnimation>();
  const anim = rec.animation;
  if (anim === "TILEANIM_WATER" || anim === "TILEANIM_WATER_FLOWER") {
    byTile.set(20, { tile: 20, period: 20, sequence: [1, 2, 3, 2, 1, 0, 7, 0].map((o) => o + 1), shift: true });
  }
  if (anim === "TILEANIM_WATER_FLOWER") {
    const { host, version } = store.project;
    byTile.set(3, { tile: 3, period: 20, sequence: [1, 2, 3, 1, 1, 2, 3, 1], urls: FLOWERS.map((f) => host.imageUrl(version, `assets/generated/${f}`)) });
  }
  for (const [tile, a] of animationsOf(id)) byTile.set(tile, { tile, period: a.period, sequence: a.urls.map((_u, k) => k + 1), urls: a.urls });
  return [...byTile.values()];
}
