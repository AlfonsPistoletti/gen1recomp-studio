// Tilesets as the editor sees them: the dataset's, the mod's own (records of
// the "tilesets" registry) and vanilla ones the mod extends (studio_tilesets:
// tiles and blocks appended to a vanilla tileset).
//
// The engine draws a map from exactly one image, so an extension becomes one
// sheet: the player's own imported sheet with the added tiles below it, built
// on their machine by the assets_transforms recipe (assets.ts) and patched in
// by src/lua/tilesetRuntime.ts. The editor builds the same sheet in memory.

import type { TilesetDef } from "./types.ts";
import { store } from "./store.ts";
import { assetUrl, type SheetRecipe } from "./assets.ts";
import { extendedSheetRel } from "../lua/tilesetRuntime.ts";
import { loadImage, TILE } from "../render/graphics.ts";

export interface TilesetExtension {
  // the first added tile's id: the vanilla sheet's tile count
  first: number;
  // 64 digits per tile, row by row: the importer's shades, 0 white .. 3 black
  tiles: string[];
  blocks: number[][];
  walkable?: number[];
}

export const EXTENSIONS = "studio_tilesets";
export const SHADE_GRAY = [255, 170, 85, 0];

export function extensionOf(id: string): TilesetExtension | undefined {
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
  return `${id}#${objId(store.table("tilesets")[id] as object | undefined)}.${objId(extensionOf(id))}`;
}

// ------------------------------------------------------------------ sheets

const CACHE = "assets/generated/";

// What the assets_transforms recipe builds for the extensions with tiles:
// the vanilla sheet the extension was made on, plus the added tiles. An
// extension of a tileset that no longer draws from the player's sheet (the
// mod's own code replaced it) gets none.
export function sheetRecipes(): SheetRecipe[] {
  const out: SheetRecipe[] = [];
  for (const [id, value] of Object.entries(store.table(EXTENSIONS))) {
    const ext = value as TilesetExtension;
    const base = store.baseTable("tilesets")[id] as TilesetDef | undefined;
    if (!ext?.tiles?.length || !base || !base.image.startsWith(CACHE)) continue;
    out.push({ source: base.image.slice(CACHE.length), out: extendedSheetRel(id), per: perRow(base), tiles: ext.tiles });
  }
  return out.sort((a, b) => a.out.localeCompare(b.out));
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

async function compose(url: string, per: number, tiles: string[]): Promise<string> {
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
  tiles.forEach((t, i) => {
    paintTile(out.data, t);
    ctx.putImageData(out, (i % per) * TILE, top + Math.floor(i / per) * TILE);
  });
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
