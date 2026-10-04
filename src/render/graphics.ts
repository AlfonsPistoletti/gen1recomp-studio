// Turns the 2bpp grayscale sheets into colored canvases and caches them: one
// block atlas per (tileset, palette key), one canvas per sprite frame.
// Everything is drawn once and blitted afterwards, which is what keeps the
// editor fast no matter how large the visible world is.

import type { Facing } from "../games/types.ts";
import type { SpriteDef, TilesetDef } from "../core/types.ts";
import { createElement, type IconNode } from "lucide";
import type { Rgb } from "./color.ts";

export const TILE = 8;
export const CELL = 16;
export const BLOCK = 32;
export const ATLAS_COLUMNS = 16;

const INVALID: Rgb = [255, 0, 255];
const GRAY_RAMP = [0, 85, 170, 255];

const imageCache = new Map<string, Promise<HTMLImageElement | null>>();

function loadImage(url: string): Promise<HTMLImageElement | null> {
  if (!url) return Promise.resolve(null);
  let p = imageCache.get(url);
  if (!p) {
    p = new Promise((resolve) => {
      const img = new Image();
      // the desktop shell serves images from its own origin (studio://);
      // CORS keeps the canvas readable for recoloring
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
    });
    imageCache.set(url, p);
  }
  return p;
}

function shadeIndex(gray: number): number {
  let best = 0;
  for (let i = 1; i < 4; i++) if (Math.abs(GRAY_RAMP[i] - gray) < Math.abs(GRAY_RAMP[best] - gray)) best = i;
  return best;
}

// The sheet as shade indices 0 (darkest) .. 3 (lightest); 255 = transparent.
interface Shades {
  width: number;
  height: number;
  px: Uint8Array;
}

function decode(img: HTMLImageElement): Shades {
  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, img.width, img.height).data;
  const px = new Uint8Array(img.width * img.height);
  for (let i = 0; i < px.length; i++) px[i] = data[i * 4 + 3] === 0 ? 255 : shadeIndex(data[i * 4]);
  return { width: img.width, height: img.height, px };
}

const shadeCache = new Map<string, Promise<Shades | null>>();

function shades(url: string): Promise<Shades | null> {
  let p = shadeCache.get(url);
  if (!p) {
    p = loadImage(url).then((img) => (img ? decode(img) : null));
    shadeCache.set(url, p);
  }
  return p;
}

export interface BlockAtlas {
  canvas: HTMLCanvasElement;
  count: number;
}

const atlasCache = new Map<string, Promise<BlockAtlas>>();

// `colorsFor(tile)` gives the four colors (darkest first) one 8x8 tile is
// drawn with, so per-tile palettes (Gen 2) and one map palette (Gen 1) go
// through the same path.
export function blockAtlas(tileset: TilesetDef, url: string, paletteKey: string, colorsFor: (tile: number) => Rgb[]): Promise<BlockAtlas> {
  const key = `${tileset.id}|${paletteKey}|${url}|${tileset.blocks.length}`;
  let p = atlasCache.get(key);
  if (!p) {
    p = buildAtlas(tileset, url, colorsFor);
    atlasCache.set(key, p);
  }
  return p;
}

async function buildAtlas(tileset: TilesetDef, url: string, colorsFor: (tile: number) => Rgb[]): Promise<BlockAtlas> {
  const sheet = await shades(url);
  const blocks = tileset.blocks || [];
  const rows = Math.max(1, Math.ceil(blocks.length / ATLAS_COLUMNS));
  const canvas = document.createElement("canvas");
  canvas.width = ATLAS_COLUMNS * BLOCK;
  canvas.height = rows * BLOCK;
  const ctx = canvas.getContext("2d")!;
  const out = ctx.createImageData(canvas.width, canvas.height);
  const dst = out.data;
  const perRow = tileset.tilesPerRow || (sheet ? Math.floor(sheet.width / TILE) : 16);
  const realTiles = sheet ? Math.floor(sheet.width / TILE) * Math.floor(sheet.height / TILE) : 0;
  blocks.forEach((block, index) => {
    const bx = (index % ATLAS_COLUMNS) * BLOCK;
    const by = Math.floor(index / ATLAS_COLUMNS) * BLOCK;
    (block || []).forEach((tile, slot) => {
      const dx = bx + (slot % 4) * TILE;
      const dy = by + Math.floor(slot / 4) * TILE;
      const valid = sheet && tile < realTiles;
      const colors = valid ? colorsFor(tile) : null;
      const sx = (tile % perRow) * TILE;
      const sy = Math.floor(tile / perRow) * TILE;
      for (let y = 0; y < TILE; y++) {
        for (let x = 0; x < TILE; x++) {
          const o = ((dy + y) * canvas.width + dx + x) * 4;
          // ROM padding past the end of the sheet: obvious on sight
          let c = INVALID;
          if (valid && colors) {
            const shade = sheet!.px[(sy + y) * sheet!.width + sx + x];
            c = colors[shade === 255 ? 3 : shade];
          }
          dst[o] = c[0];
          dst[o + 1] = c[1];
          dst[o + 2] = c[2];
          dst[o + 3] = 255;
        }
      }
    });
  });
  ctx.putImageData(out, 0, 0);
  return { canvas, count: blocks.length };
}

export function atlasRect(block: number): [number, number] {
  return [(block % ATLAS_COLUMNS) * BLOCK, Math.floor(block / ATLAS_COLUMNS) * BLOCK];
}

// ---------------------------------------------------------------- sprites

const spriteCache = new Map<string, HTMLCanvasElement | null>();
const spritePending = new Set<string>();

// Frames are stand down/up/left; right is the left frame mirrored
// (src/render/SpriteRenderer.lua).
function facingFrame(facing: Facing): { frame: number; flip: boolean } {
  switch (facing) {
    case "up": return { frame: 1, flip: false };
    case "left": return { frame: 2, flip: false };
    case "right": return { frame: 2, flip: true };
    default: return { frame: 0, flip: false };
  }
}

// Returns the frame if it is ready; otherwise starts loading it and calls
// `onReady` once it arrives. The lightest shade is transparent.
export function spriteFrame(
  sprite: SpriteDef | undefined, url: string, colors: Rgb[], paletteKey: string, facing: Facing,
  onReady: () => void,
): HTMLCanvasElement | null {
  if (!sprite || !url) return null;
  const { frame, flip } = facingFrame(facing);
  const frames = sprite.frames || 1;
  const f = frame < frames ? frame : 0;
  const key = `${sprite.id}|${paletteKey}|${f}|${flip}`;
  if (spriteCache.has(key)) return spriteCache.get(key)!;
  if (!spritePending.has(key)) {
    spritePending.add(key);
    shades(url).then((sheet) => {
      spritePending.delete(key);
      if (!sheet) {
        spriteCache.set(key, null);
      } else {
        const fw = sprite.frameWidth || 16;
        const fh = sprite.frameHeight || 16;
        const out = document.createElement("canvas");
        out.width = fw;
        out.height = fh;
        const ctx = out.getContext("2d")!;
        const img = ctx.createImageData(fw, fh);
        for (let y = 0; y < fh; y++) {
          for (let x = 0; x < fw; x++) {
            const sx = flip ? fw - 1 - x : x;
            const sy = f * fh + y;
            if (sx >= sheet.width || sy >= sheet.height) continue;
            const shade = sheet.px[sy * sheet.width + sx];
            if (shade === 255 || shade === 3) continue;
            const c = colors[shade];
            const o = (y * fw + x) * 4;
            img.data[o] = c[0];
            img.data[o + 1] = c[1];
            img.data[o + 2] = c[2];
            img.data[o + 3] = 255;
          }
        }
        ctx.putImageData(img, 0, 0);
        spriteCache.set(key, out);
      }
      onReady();
    });
  }
  return null;
}

// ------------------------------------------------------------------ marker icons
// A Lucide icon as an image for the map canvas: drawn in `color` over a dark
// outline so it reads on any tiles, rasterized large enough to stay sharp at
// the highest zoom. Cached per (name, color); null until loaded.

const iconImages = new Map<string, HTMLImageElement>();

export function markerIcon(name: string, node: IconNode, color: string, onReady: () => void): HTMLImageElement | null {
  const key = `${name}|${color}`;
  const hit = iconImages.get(key);
  if (hit) return hit.complete && hit.naturalWidth ? hit : null;
  const draw = (stroke: string, width: number) => {
    const svg = createElement(node, { stroke, "stroke-width": width });
    return svg.innerHTML;
  };
  const markup =
    `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round">` +
    `<g stroke="#1a1020" stroke-width="4.5">${draw("#1a1020", 4.5)}</g>` +
    `<g stroke="${color}" stroke-width="2.2">${draw(color, 2.2)}</g></svg>`;
  const img = new Image();
  img.onload = onReady;
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
  iconImages.set(key, img);
  return null;
}
