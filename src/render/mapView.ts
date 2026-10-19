// The editing canvas. The current map is drawn with every map reachable
// through its connections laid out around it, so the overworld reads as one
// surface. Each map is rendered once into its own canvas (from the block
// atlas) and only re-rendered when its record changes; a frame is a handful
// of drawImage calls plus overlays for the map being edited.

import { extIcon } from "./extIcons.ts";
import { cellAt, cellsOf, extKind, paintCell } from "../core/customCells.ts";
import { blockAt, BLOCK_PX, floodFill, placeConnected, type Placed } from "../core/geometry.ts";
import { store, type Selection, type Stamp } from "../core/store.ts";
import { EXTENSIONS, liveTileset, mapAnimations, perRow, sheetTiles, tilesetKey, tilesetUrl } from "../core/tilesets.ts";
import { blockWithTile } from "../core/tileBrush.ts";
import { liveSprite, playerSprites, spriteUrl } from "../core/sprites.ts";
import { gbcColorsFor, gbcKey, isGbcKey, spriteGbcColors } from "../core/gbc.ts";
import type { EntityRecord, MapDef } from "../core/types.ts";
import type { EntityLayer, FieldSpec, GameAdapter } from "../games/types.ts";
import { Armchair, Coins, DoorOpen, Landmark, Monitor, PlaneLanding, ScanEye, Signpost, Sparkles, Zap, type IconNode } from "lucide";
import { animationFrames, atlasRect, blockAtlas, clearColorCaches, BLOCK, CELL, loadImage, markerIcon, spriteFrame, TILE, type BlockAtlas } from "./graphics.ts";
import { assetUrl } from "../core/assets.ts";

interface CachedMap {
  map: MapDef;
  palette: string;
  canvas: HTMLCanvasElement | null;
  collision: HTMLCanvasElement | null;
  wild: HTMLCanvasElement | null;
  // animated tiles: drawn into `canvas` when their frame changes (undefined:
  // not looked at yet, null: nothing moves)
  anim?: MapAnim | null;
}

interface MapAnim {
  list: { frames: HTMLCanvasElement[]; sequence: number[]; period: number }[];
  // per animation: x, y pairs of its 8x8 cells in the map canvas
  cells: number[][];
  // the frame each animation shows now (-1: the atlas's still one)
  shown: number[];
}

export interface HoverInfo {
  mapId: string;
  bx: number;
  by: number;
  // 8x8 tile coordinates
  tx: number;
  ty: number;
  cx: number;
  cy: number;
  block: number;
  tile: number | undefined;
  walkable: boolean;
  inside: boolean;
}

type Drag =
  | { kind: "pan"; sx: number; sy: number; camX: number; camY: number }
  | { kind: "paint"; lastBx: number; lastBy: number }
  | { kind: "area"; lastCx: number; lastCy: number; erase: boolean }
  | { kind: "tile"; lastTx: number; lastTy: number }
  | { kind: "tilepick"; mapId: string; tx: number; ty: number }
  | { kind: "rect"; bx: number; by: number }
  | { kind: "pick"; mapId: string; bx: number; by: number }
  | { kind: "move"; sel: NonNullable<Selection>; offX: number; offY: number };

const MIN_ZOOM = 0.125;
// marker icons on warps (door) and signs (signpost)
// colors of the marker icons drawn on warps and signs
const WARP_ICON = "#6a3fd8";
const SIGN_ICON = "#a86a00";
// hidden events (field registry): icon and color per kind
const HIDDEN_ICONS: Record<string, [string, IconNode, string]> = {
  pc: ["monitor", Monitor, "#2f7dff"],
  bench: ["armchair", Armchair, "#c0367a"],
  item: ["sparkles", Sparkles, "#0f8f80"],
  coins: ["coins", Coins, "#a8740a"],
  statue: ["landmark", Landmark, "#5b5f6e"],
};
const LANDING_ICON = "#1f9e6b";
const MAX_ZOOM = 8;

export class MapView {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  camX = -40;
  camY = -40;
  zoom = 2;
  private placed: Placed[] = [];
  private cache = new Map<string, CachedMap>();
  private building = new Set<string>();
  private atlases = new Map<string, BlockAtlas>();
  private hover: { wx: number; wy: number } | null = null;
  private drag: Drag | null = null;
  private spaceDown = false;
  private frame = 0;
  private animTimer = 0;
  private animOn = false;
  // the last fit stays live (re-applied on resize) until the user pans or
  // zooms, so a fit made while the page layout is still settling corrects itself
  // re-applied on resize until the user pans or zooms: a fit, or a centered
  // cell (centering while Maps is hidden would use a 0-wide view)
  private liveFit: "map" | "world" | { cx: number; cy: number } | null = "map";
  onHover: (info: HoverInfo | null) => void = () => {};
  onDraw: () => void = () => {};

  constructor(host: HTMLElement) {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "map-canvas";
    this.canvas.tabIndex = 0;
    host.appendChild(this.canvas);
    this.ctx = this.canvas.getContext("2d")!;
    new ResizeObserver(() => this.resize()).observe(host);
    this.bindInput();
    store.on((reason, id, registry) => {
      if (reason === "project") {
        // another mod may bring its own tilesets under the same ids
        this.cache.clear();
        this.atlases.clear();
        this.relayout();
        this.fitMap();
      } else if (reason === "map") {
        this.relayout();
      } else if (reason === "content" && (registry === "tilesets" || registry === EXTENSIONS) && id) {
        this.tilesetChanged(id);
      } else if (reason === "content" && registry === "palettes") {
        clearColorCaches();
        this.cache.clear();
        this.atlases.clear();
        store.refreshPalettes();
      } else if (reason === "colors") {
        this.relayout();
      } else if (reason === "edit") {
        // the cached image stays until a new one replaces it (see mapCanvas),
        // so edits never flash an empty map
        this.relayout();
      }
      this.invalidate();
    });
  }

  // ------------------------------------------------------------ layout

  private relayout(): void {
    this.placed = store.map ? placeConnected(store.adapter, store.maps, store.currentMap) : [];
  }

  private placedOf(id: string): Placed | undefined {
    return this.placed.find((p) => p.id === id);
  }

  private resize(): void {
    const host = this.canvas.parentElement!;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.round(host.clientWidth * dpr));
    this.canvas.height = Math.max(1, Math.round(host.clientHeight * dpr));
    this.canvas.style.width = host.clientWidth + "px";
    this.canvas.style.height = host.clientHeight + "px";
    if (this.liveFit && host.clientWidth > 0 && store.project) {
      if (this.liveFit === "world") this.fitWorld();
      else if (this.liveFit === "map") this.fitMap();
      else this.centerOnCell(this.liveFit.cx, this.liveFit.cy);
    }
    this.invalidate();
  }

  private get viewW(): number {
    return this.canvas.clientWidth;
  }

  private get viewH(): number {
    return this.canvas.clientHeight;
  }

  fitMap(): void {
    const map = store.map;
    if (!map) return;
    this.liveFit = "map";
    this.fitRect(0, 0, map.width * BLOCK_PX, map.height * BLOCK_PX);
  }

  fitWorld(): void {
    if (!this.placed.length) return this.fitMap();
    this.liveFit = "world";
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of this.placed) {
      const m = store.maps[p.id];
      x0 = Math.min(x0, p.x);
      y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x + m.width * BLOCK_PX);
      y1 = Math.max(y1, p.y + m.height * BLOCK_PX);
    }
    this.fitRect(x0, y0, x1 - x0, y1 - y0);
  }

  private fitRect(x: number, y: number, w: number, h: number): void {
    const vw = this.viewW || 800;
    const vh = this.viewH || 600;
    const z = Math.min((vw - 48) / w, (vh - 48) / h);
    // snap to whole or half steps so pixels stay even
    this.zoom = clamp(z >= 1 ? Math.floor(z * 2) / 2 : z, MIN_ZOOM, MAX_ZOOM);
    this.camX = x + w / 2 - vw / 2 / this.zoom;
    this.camY = y + h / 2 - vh / 2 / this.zoom;
    this.invalidate();
  }

  zoomBy(factor: number, sx = this.viewW / 2, sy = this.viewH / 2): void {
    this.liveFit = null;
    const wx = this.camX + sx / this.zoom;
    const wy = this.camY + sy / this.zoom;
    this.zoom = clamp(this.zoom * factor, MIN_ZOOM, MAX_ZOOM);
    this.camX = wx - sx / this.zoom;
    this.camY = wy - sy / this.zoom;
    this.invalidate();
  }

  // Opening a neighbour re-roots the layout at it; shifting the camera by its
  // old offset keeps the world still on screen.
  openMap(id: string): void {
    if (id === store.currentMap) return;
    const known = this.placedOf(id);
    store.openMap(id);
    if (known) {
      this.camX -= known.x;
      this.camY -= known.y;
      this.liveFit = null;
      this.invalidate();
    } else {
      this.fitMap();
    }
  }

  // ------------------------------------------------------------ caching

  // the colors a map is drawn in: its palette, or its RED++ key
  paletteKey(id: string): string {
    if (store.colorMode === "redpp") {
      const map = store.maps[id];
      const key = map ? gbcKey(map.tileset, id) : null;
      if (key) return key;
    }
    return store.palettes[id] || "ROUTE";
  }

  // the map as the view shows it: the open map in the picked scene wears that
  // scene's blocks (a copy, kept while the map record and scene stay the same)
  private sceneView: { map: MapDef; scene: number; view: MapDef } | null = null;
  private viewMap(id: string): MapDef | undefined {
    const map = store.maps[id];
    const scenes = store.adapter?.scenes;
    if (!map || !scenes || id !== store.currentMap || store.scene <= 0) return map;
    const c = this.sceneView;
    if (c && c.map === map && c.scene === store.scene) return c.view;
    const view = { ...map, blocks: scenes.blocksIn(map, store.scene) };
    this.sceneView = { map, scene: store.scene, view };
    return view;
  }

  private mapCanvas(id: string): CachedMap | null {
    const map = this.viewMap(id);
    if (!map) return null;
    const palette = this.paletteKey(id);
    const hit = this.cache.get(id);
    if (hit && hit.palette === palette && hit.canvas) {
      if (hit.map === map) return hit;
      // moving a warp/NPC/sign or editing a field leaves the pixels alone
      if (sameGraphics(hit.map, map)) {
        // where wild Pokémon appear also depends on the outdoor mark and index
        const wildKey = (m: MapDef) => `${(m as { outdoor?: unknown }).outdoor}|${m.index}`;
        if (wildKey(hit.map) !== wildKey(map)) hit.wild = null;
        hit.map = map;
        return hit;
      }
    }
    // with the atlas in memory a redraw is synchronous: no blank frame
    const atlas = this.atlases.get(`${map.tileset}|${palette}`);
    if (atlas) {
      const entry: CachedMap = { map, palette, canvas: this.paint(map, atlas), collision: null, wild: null };
      this.cache.set(id, entry);
      void this.loadAnim(id, entry);
      return entry;
    }
    const buildKey = `${id}|${palette}`;
    if (!this.building.has(buildKey)) {
      this.building.add(buildKey);
      this.atlasFor(map.tileset, palette).finally(() => {
        this.building.delete(buildKey);
        this.invalidate();
      });
    }
    return hit ?? null; // stale canvas while the atlas loads
  }

  // the tileset's sheet, with the tiles the game swaps in for this palette
  // key drawn over it (Gen 2 roofs: gen1recomp World.applyRoofOverlay)
  private overlaid = new Map<string, Promise<string>>();
  private async sheetUrl(tilesetId: string, palette: string): Promise<string> {
    const base = await tilesetUrl(tilesetId);
    const over = store.adapter.sheetOverlay?.(store.ctx, tilesetId, palette);
    if (!over) return base;
    const ts = liveTileset(tilesetId);
    const per = ts ? perRow(ts) : 16;
    const key = `${base}|${over.image}|${over.first}`;
    let p = this.overlaid.get(key);
    if (!p) {
      p = (async () => {
        const [sheet, roof] = await Promise.all([loadImage(base), loadImage(assetUrl(store.project.host, store.project.version, over.image))]);
        if (!sheet || !roof) return base;
        const c = document.createElement("canvas");
        c.width = sheet.width;
        c.height = sheet.height;
        const ctx = c.getContext("2d")!;
        ctx.drawImage(sheet, 0, 0);
        for (let t = 0; t < over.count; t++) {
          const id = over.first + t;
          const x = (id % per) * TILE;
          const y = Math.floor(id / per) * TILE;
          ctx.clearRect(x, y, TILE, TILE);
          ctx.drawImage(roof, t * TILE, 0, TILE, TILE, x, y, TILE, TILE);
        }
        return c.toDataURL("image/png");
      })();
      this.overlaid.set(key, p);
    }
    return p;
  }

  async atlasFor(tilesetId: string, palette: string): Promise<BlockAtlas | null> {
    const ts = liveTileset(tilesetId);
    if (!ts) return null;
    const version = tilesetKey(tilesetId);
    const colorsFor = isGbcKey(palette) ? gbcColorsFor(tilesetId, palette) : store.adapter.tileColors(store.ctx, ts, palette);
    const atlas = await blockAtlas(ts, await this.sheetUrl(tilesetId, palette), palette, colorsFor, version);
    // an edit made while this one was drawing wins
    if (tilesetKey(tilesetId) === version) this.atlases.set(`${tilesetId}|${palette}`, atlas);
    return atlas;
  }

  // The animated tiles of a cached map: their colored frames and where they
  // sit. Attached only while the entry is still the cached one.
  private async loadAnim(id: string, entry: CachedMap): Promise<void> {
    const map = entry.map;
    const ts = liveTileset(map.tileset);
    const anims = ts ? mapAnimations(map.tileset) : [];
    if (!ts || !anims.length) {
      entry.anim = null;
      return;
    }
    const palette = entry.palette;
    const colorsFor = ts.trueColor ? null : isGbcKey(palette) ? gbcColorsFor(map.tileset, palette) : store.adapter.tileColors(store.ctx, ts, palette);
    const url = await tilesetUrl(map.tileset);
    const per = perRow(ts);
    const built = await Promise.all(anims.map((a) => animationFrames(a, url, per, colorsFor ? colorsFor(a.tile) : null)));
    if (this.cache.get(id) !== entry) return;
    const list: MapAnim["list"] = [];
    const index = new Map<number, number>();
    anims.forEach((a, i) => {
      const frames = built[i];
      if (!frames) return;
      index.set(a.tile, list.length);
      list.push({ frames, sequence: a.sequence, period: a.period });
    });
    const cells: number[][] = list.map(() => []);
    // per block: which of its 16 tiles move
    const moving = new Map<number, [number, number][]>();
    const slotsOf = (b: number) => {
      let m = moving.get(b);
      if (!m) {
        m = [];
        (ts.blocks[b] ?? []).forEach((tile, slot) => {
          const k = index.get(tile);
          if (k !== undefined) m!.push([slot, k]);
        });
        moving.set(b, m);
      }
      return m;
    };
    for (let by = 0; by < map.height; by++) {
      for (let bx = 0; bx < map.width; bx++) {
        for (const [slot, k] of slotsOf(map.blocks[by * map.width + bx])) {
          cells[k].push(bx * BLOCK + (slot % 4) * TILE, by * BLOCK + Math.floor(slot / 4) * TILE);
        }
      }
    }
    entry.anim = cells.some((c) => c.length) ? { list, cells, shown: list.map(() => -1) } : null;
    if (entry.anim) this.invalidate();
  }

  // Draws the animated tiles whose frame changed; returns the milliseconds
  // until the next change (Infinity: nothing moves).
  private stepAnim(entry: CachedMap): number {
    const a = entry.anim;
    if (!a || !entry.canvas) return Infinity;
    const ctx = entry.canvas.getContext("2d")!;
    const frame = performance.now() / (1000 / 60);
    let next = Infinity;
    a.list.forEach((anim, k) => {
      const step = Math.floor(frame / anim.period);
      const img = anim.frames[(anim.sequence[step % anim.sequence.length] ?? 1) - 1];
      next = Math.min(next, ((step + 1) * anim.period - frame) * (1000 / 60));
      if (!img || a.shown[k] === step % anim.sequence.length) return;
      a.shown[k] = step % anim.sequence.length;
      const cells = a.cells[k];
      for (let i = 0; i < cells.length; i += 2) ctx.drawImage(img, cells[i], cells[i + 1]);
    });
    return next;
  }

  // Animation turned off: maps that moved are repainted still.
  private stopAnims(): void {
    for (const [id, entry] of [...this.cache]) {
      if (entry.anim?.shown.some((v) => v !== -1)) this.cache.set(id, { ...entry, canvas: null, palette: "", anim: undefined });
    }
  }

  // a tileset was edited: maps on it redraw with the new blocks
  private tilesetChanged(id: string): void {
    for (const k of [...this.atlases.keys()]) if (k.startsWith(`${id}|`)) this.atlases.delete(k);
    for (const [mapId, entry] of [...this.cache]) {
      if (entry.map.tileset === id) this.cache.set(mapId, { ...entry, collision: null, wild: null, palette: "" });
    }
  }

  private paint(map: MapDef, atlas: BlockAtlas): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    canvas.width = map.width * BLOCK;
    canvas.height = map.height * BLOCK;
    const ctx = canvas.getContext("2d")!;
    for (let by = 0; by < map.height; by++) {
      for (let bx = 0; bx < map.width; bx++) {
        const b = map.blocks[by * map.width + bx];
        if (b < atlas.count) {
          const [sx, sy] = atlasRect(b);
          ctx.drawImage(atlas.canvas, sx, sy, BLOCK, BLOCK, bx * BLOCK, by * BLOCK, BLOCK, BLOCK);
        } else {
          ctx.fillStyle = "#f0f";
          ctx.fillRect(bx * BLOCK, by * BLOCK, BLOCK, BLOCK);
        }
      }
    }
    return canvas;
  }

  private collisionCanvas(entry: CachedMap): HTMLCanvasElement {
    if (entry.collision) return entry.collision;
    const map = entry.map;
    const ts = liveTileset(map.tileset);
    const c = document.createElement("canvas");
    c.width = map.width * 2;
    c.height = map.height * 2;
    const ctx = c.getContext("2d")!;
    // blocked red; ledges (hopped down, not walked on) amber
    const ledges = store.adapter.ledgeTiles?.(store.ctx, map.tileset);
    for (let cy = 0; cy < map.height * 2; cy++) {
      for (let cx = 0; cx < map.width * 2; cx++) {
        const cell = store.adapter.cell(map, ts, cx, cy);
        if (cell.walkable) continue;
        ctx.fillStyle = cell.tile !== undefined && ledges?.has(cell.tile) ? "rgba(255, 180, 60, 0.5)" : "rgba(255, 40, 60, 0.42)";
        ctx.fillRect(cx, cy, 1, 1);
      }
    }
    entry.collision = c;
    return c;
  }

  // Cells that roll wild encounters: grass green, surfable water blue, and
  // on maps where every step rolls, every walkable cell amber.
  private wildCanvas(entry: CachedMap): HTMLCanvasElement | null {
    const wildCell = store.adapter.encounters?.wildCell ?? store.adapter.timedEncounters?.wildCell;
    if (!wildCell) return null;
    if (entry.wild) return entry.wild;
    const map = entry.map;
    const ts = liveTileset(map.tileset);
    const c = document.createElement("canvas");
    c.width = map.width * 2;
    c.height = map.height * 2;
    const ctx = c.getContext("2d")!;
    const colors = { grass: "rgba(60, 220, 110, 0.5)", water: "rgba(60, 140, 255, 0.5)", any: "rgba(255, 190, 60, 0.32)" };
    const sctx = store.ctx;
    for (let cy = 0; cy < map.height * 2; cy++) {
      for (let cx = 0; cx < map.width * 2; cx++) {
        const kind = wildCell(map, ts, cx, cy, sctx);
        if (!kind) continue;
        ctx.fillStyle = colors[kind];
        ctx.fillRect(cx, cy, 1, 1);
      }
    }
    entry.wild = c;
    return c;
  }

  // ------------------------------------------------------------ drawing

  invalidate(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  }

  private draw(): void {
    this.onDraw();
    const ctx = this.ctx;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--canvas-bg") || "#15171c";
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const map = store.map;
    if (!map) return;
    const z = this.zoom * dpr;
    ctx.setTransform(z, 0, 0, z, -this.camX * z, -this.camY * z);
    ctx.imageSmoothingEnabled = false;

    const view = { x0: this.camX, y0: this.camY, x1: this.camX + this.viewW / this.zoom, y1: this.camY + this.viewH / this.zoom };
    const showNeighbors = store.overlays.neighbors;
    const labels: Placed[] = [];
    const animate = store.overlays.animate;
    if (!animate && this.animOn) this.stopAnims();
    this.animOn = animate;
    // zoomed out below 50% the animation holds its frame: with that much on
    // screen the redraws cost more than they show
    const stepping = animate && this.zoom >= 0.5;
    let nextAnim = Infinity;
    for (const p of this.placed) {
      if (p.id !== store.currentMap && !showNeighbors) continue;
      const m = store.maps[p.id];
      const w = m.width * BLOCK_PX;
      const h = m.height * BLOCK_PX;
      if (p.x > view.x1 || p.y > view.y1 || p.x + w < view.x0 || p.y + h < view.y0) continue;
      const entry = this.mapCanvas(p.id);
      if (entry && stepping) nextAnim = Math.min(nextAnim, this.stepAnim(entry));
      if (entry?.canvas) ctx.drawImage(entry.canvas, p.x, p.y);
      else {
        ctx.fillStyle = "#222";
        ctx.fillRect(p.x, p.y, w, h);
      }
      if (p.id !== store.currentMap) {
        ctx.fillStyle = "rgba(14, 16, 22, 0.5)";
        ctx.fillRect(p.x, p.y, w, h);
        labels.push(p);
      }
    }
    clearTimeout(this.animTimer);
    if (nextAnim < Infinity) this.animTimer = window.setTimeout(() => this.invalidate(), Math.max(16, nextAnim));
    // labels after every map image, so no neighbour paints over one
    for (const p of labels) this.label(p.x, p.y, p.id, this.mapTag(p.id));

    const mw = map.width * BLOCK_PX;
    const mh = map.height * BLOCK_PX;
    const entry = this.cache.get(store.currentMap);
    if (store.overlays.collision && entry?.canvas && entry.map === map) {
      ctx.drawImage(this.collisionCanvas(entry), 0, 0, mw, mh);
    }
    if (store.overlays.wild && entry?.canvas && entry.map === map) {
      const wild = this.wildCanvas(entry);
      if (wild) ctx.drawImage(wild, 0, 0, mw, mh);
    }
    if (store.overlays.grid) this.drawGrid(mw, mh);
    if (store.overlays.entities) this.drawEntities(map);
    this.drawToolPreview(map);

    ctx.strokeStyle = "rgba(120, 170, 255, 0.95)";
    ctx.lineWidth = 2 / this.zoom;
    ctx.strokeRect(0, 0, mw, mh);
  }

  // edited-vs-base answers cached per record, since records are immutable
  private editedCache = new WeakMap<MapDef, boolean>();

  // Same badges as the map list: NEW for maps the mod registers, EDITED for
  // base maps that differ from the base data.
  private mapTag(id: string): "new" | "edited" | null {
    const map = store.maps[id];
    if (!store.base[id]) return "new";
    let edited = this.editedCache.get(map);
    if (edited === undefined) {
      edited = store.isEdited(id);
      this.editedCache.set(map, edited);
    }
    return edited ? "edited" : null;
  }

  private label(x: number, y: number, text: string, tag: "new" | "edited" | null = null): void {
    const ctx = this.ctx;
    const px = 1 / this.zoom; // one screen pixel in world units
    const size = 11 * px;
    const height = size + 6 * px;
    ctx.font = `600 ${size}px system-ui, sans-serif`;
    ctx.textBaseline = "top";
    const w = ctx.measureText(text).width + 8 * px;
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(x, y, w, height);
    ctx.fillStyle = "#e8ecf4";
    ctx.fillText(text, x + 4 * px, y + 3 * px);
    if (!tag) return;
    const tagSize = 9 * px;
    ctx.font = `700 ${tagSize}px system-ui, sans-serif`;
    const label = tag.toUpperCase();
    const tw = ctx.measureText(label).width + 8 * px;
    const tx = x + w + 3 * px;
    ctx.fillStyle = tag === "new" ? "#1d3a2e" : "#3a3220";
    ctx.fillRect(tx, y, tw, height);
    ctx.fillStyle = tag === "new" ? "#3ecf8e" : "#ffb547";
    ctx.fillText(label, tx + 4 * px, y + (height - tagSize) / 2);
  }

  private drawGrid(mw: number, mh: number): void {
    const ctx = this.ctx;
    ctx.lineWidth = 1 / this.zoom;
    // dark lines: the SGB palettes are light, so a light grid would vanish
    if (this.zoom >= 1.5) {
      ctx.strokeStyle = "rgba(0,0,0,0.16)";
      ctx.beginPath();
      for (let x = CELL; x < mw; x += BLOCK) { ctx.moveTo(x, 0); ctx.lineTo(x, mh); }
      for (let y = CELL; y < mh; y += BLOCK) { ctx.moveTo(0, y); ctx.lineTo(mw, y); }
      ctx.stroke();
    }
    ctx.strokeStyle = "rgba(0,0,0,0.38)";
    ctx.beginPath();
    for (let x = BLOCK; x < mw; x += BLOCK) { ctx.moveTo(x, 0); ctx.lineTo(x, mh); }
    for (let y = BLOCK; y < mh; y += BLOCK) { ctx.moveTo(0, y); ctx.lineTo(mw, y); }
    ctx.stroke();
  }

  private drawEntities(map: MapDef): void {
    const ctx = this.ctx;
    const lw = 1.5 / this.zoom;
    // painted areas of mods' own kinds, under everything else
    for (const [kindId, cells] of Object.entries(cellsOf(map))) {
      const kind = extKind(kindId);
      ctx.fillStyle = kind?.color ?? "#888888";
      ctx.globalAlpha = 0.35;
      for (const c of cells) ctx.fillRect(c.x * CELL, c.y * CELL, CELL, CELL);
      ctx.globalAlpha = 1;
    }
    const cs = store.cellSelection;
    if (cs) {
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2 / this.zoom;
      ctx.strokeRect(cs.x * CELL - 1, cs.y * CELL - 1, CELL + 2, CELL + 2);
    }
    // warps and triggers under signs under NPCs, the way they stack in game
    for (const layer of byKind(store.adapter.layers, ["warp", "trigger", "sign", "npc"])) {
      store.entities(map, layer.key).forEach((e, i) => {
        ctx.lineWidth = lw;
        const kind = layer.custom ? extKind((e.custom as { kind?: unknown } | undefined)?.kind) : undefined;
        if (kind) {
          // a mod's own kind: its icon in its color on a tinted cell
          ctx.globalAlpha = 0.35;
          ctx.fillStyle = kind.color;
          ctx.fillRect(e.x * CELL, e.y * CELL, CELL, CELL);
          ctx.globalAlpha = 1;
          ctx.strokeStyle = kind.color;
          ctx.strokeRect(e.x * CELL + lw / 2, e.y * CELL + lw / 2, CELL - lw, CELL - lw);
          const [name, node] = extIcon(kind.icon);
          this.markerIcon(name, node, kind.color, e);
        } else if (layer.kind === "npc") {
          // an event preview moves NPCs around (and hides or shows them)
          const a = this.preview?.actors[`npc${String(e.index)}`];
          if (!a) this.drawNpc(layer, e);
          else if (!a.hidden) this.drawNpc(layer, { ...e, x: a.x, y: a.y, movement: "STAY", range: a.facing.toUpperCase(), hidden: false });
        }
        else if (layer.marker?.(e) === "item") {
          const [name, icon, color] = HIDDEN_ICONS.item;
          this.markerIcon(name, icon, color, e);
        } else if (layer.kind === "sign") {
          ctx.globalAlpha = 0.5;
          ctx.fillStyle = layer.color;
          ctx.fillRect(e.x * CELL + 3, e.y * CELL + 3, CELL - 6, CELL - 6);
          ctx.globalAlpha = 1;
          ctx.strokeStyle = layer.color;
          ctx.strokeRect(e.x * CELL + 3, e.y * CELL + 3, CELL - 6, CELL - 6);
          this.markerIcon("signpost", Signpost, SIGN_ICON, e);
        } else {
          // Gen 2 step triggers run only in their scene: other scenes' are faint
          const sceneOf = layer.kind === "trigger" && store.adapter.scenes ? Number(e.sceneId ?? 0) : null;
          const faint = sceneOf !== null && map.id === store.currentMap && sceneOf !== store.scene ? 0.35 : 1;
          ctx.globalAlpha = (layer.kind === "warp" ? 0.45 : 0.3) * faint;
          ctx.fillStyle = layer.color;
          ctx.fillRect(e.x * CELL, e.y * CELL, CELL, CELL);
          ctx.globalAlpha = faint;
          ctx.strokeStyle = layer.color;
          if (layer.kind === "trigger") ctx.setLineDash([3 / this.zoom, 2 / this.zoom]);
          ctx.strokeRect(e.x * CELL + lw / 2, e.y * CELL + lw / 2, CELL - lw, CELL - lw);
          ctx.setLineDash([]);
          ctx.globalAlpha = 1;
          if (layer.kind === "warp") this.markerIcon("door-open", DoorOpen, WARP_ICON, e);
          if (sceneOf) this.badge(e.x * CELL + CELL / 2, e.y * CELL, `S${sceneOf}`, layer.color);
        }
        if (layer.numbered) this.badge(e.x * CELL, e.y * CELL, String(i + 1), layer.color);
      });
    }
    // several entities on one cell (Route 22's two rivals): a count in the corner
    const stacked = new Map<string, { x: number; y: number; n: number }>();
    for (const layer of store.adapter.layers) {
      for (const e of store.entities(map, layer.key)) {
        const c = stacked.get(`${e.x},${e.y}`) ?? { x: e.x, y: e.y, n: 0 };
        c.n++;
        stacked.set(`${e.x},${e.y}`, c);
      }
    }
    for (const c of stacked.values()) if (c.n > 1) this.countBadge(c.x, c.y, c.n);
    // Pokémon Center PCs and the town's landing spot (the field registry)
    const towns = store.adapter.towns;
    if (towns) {
      const f = store.table(towns.fieldRegistry) as Record<string, unknown> & { flyWarps?: Record<string, EntityRecord> };
      for (const kind of towns.hidden) {
        let node: unknown = f;
        for (const key of kind.path) node = (node as Record<string, unknown> | undefined)?.[key];
        const list = (node as Record<string, EntityRecord[]> | undefined)?.[map.id] ?? [];
        const [name, icon, color] = HIDDEN_ICONS[kind.id] ?? HIDDEN_ICONS.pc;
        for (const e of list) this.markerIcon(name, icon, color, e);
      }
      // cells with a step event
      const evReg = store.adapter.events?.registry;
      if (evReg) {
        for (const [id, ev] of Object.entries(store.table(evReg) as Record<string, EntityRecord>)) {
          if (!id.startsWith(`${map.id}:step:`) || typeof ev.x !== "number") continue;
          // a trainer's line of sight (built from step events) vs other step events
          if (id.startsWith(`${map.id}:step:trainer`)) this.markerIcon("scan-eye", ScanEye, "#c2410c", ev);
          else this.markerIcon("zap", Zap, "#d4357a", ev);
        }
      }
      const land = f.flyWarps?.[map.id];
      if (land) this.markerIcon("plane-landing", PlaneLanding, LANDING_ICON, land);
    }
    if (this.pathOverlay) this.drawPath(this.pathOverlay);
    if (this.preview) this.drawPreviewExtras(map);
    const sel = store.selection;
    const e = sel ? store.entities(map, sel.layer)[sel.index] : undefined;
    if (e) {
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2 / this.zoom;
      ctx.strokeRect(e.x * CELL - 1, e.y * CELL - 1, CELL + 2, CELL + 2);
      ctx.strokeStyle = "#2f7dff";
      ctx.lineWidth = 1 / this.zoom;
      ctx.strokeRect(e.x * CELL - 1, e.y * CELL - 1, CELL + 2, CELL + 2);
    }
  }

  // a Lucide icon centered on the entity's cell (12 of its 16 pixels)
  private markerIcon(name: string, node: IconNode, color: string, e: EntityRecord): void {
    const img = markerIcon(name, node, color, () => this.invalidate());
    if (!img) return;
    const ctx = this.ctx;
    const prev = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(img, e.x * CELL + 2, e.y * CELL + 2, CELL - 4, CELL - 4);
    ctx.imageSmoothingEnabled = prev;
  }

  private drawNpc(layer: EntityLayer, o: EntityRecord): void {
    const ctx = this.ctx;
    const ref = layer.sprite?.(o, store.currentMap) ?? null;
    // the map's Game Boy palette, or in RED++ the sprite's own palette
    const palette = store.palettes[store.currentMap] || "ROUTE";
    const def = ref ? liveSprite(ref.sprite) : undefined;
    const seed = o.index === undefined ? "player" : `${store.currentMap}_obj_${String(o.index)}`;
    const gbc = store.colorMode === "redpp" && def ? spriteGbcColors(def, seed, /yellow/i.test(store.project.version)) : null;
    // a game that colors each sprite on its own gets the sprite and the object
    const colors = gbc ? gbc.colors : store.adapter.spriteColors(store.ctx, palette, def, o);
    const img = ref
      ? spriteFrame(def, spriteUrl(ref.sprite), colors, gbc ? gbc.key : `${palette}|${colors.flat().join(",")}`, ref.facing, () => this.invalidate())
      : null;
    if (img) {
      // ghosts only appear through scripts
      ctx.globalAlpha = ref?.ghost ? 0.45 : 1;
      ctx.drawImage(img, o.x * CELL, o.y * CELL - 4);
      ctx.globalAlpha = 1;
    } else {
      ctx.fillStyle = layer.color;
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      ctx.arc(o.x * CELL + 8, o.y * CELL + 8, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    if (ref?.moving) {
      ctx.strokeStyle = layer.color;
      ctx.setLineDash([2 / this.zoom, 2 / this.zoom]);
      ctx.strokeRect(o.x * CELL, o.y * CELL, CELL, CELL);
      ctx.setLineDash([]);
    }
  }

  private badge(x: number, y: number, text: string, color: string): void {
    if (this.zoom < 1.5) return;
    const ctx = this.ctx;
    const size = 9 / this.zoom;
    ctx.font = `700 ${size}px system-ui, sans-serif`;
    ctx.textBaseline = "top";
    const w = ctx.measureText(text).width + 4 / this.zoom;
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, size + 2 / this.zoom);
    ctx.fillStyle = "#fff";
    ctx.fillText(text, x + 2 / this.zoom, y + 1 / this.zoom);
  }

  // a filled circle with a number at a cell's top-right corner
  private countBadge(cx: number, cy: number, n: number): void {
    if (this.zoom < 1.5) return;
    const ctx = this.ctx;
    const r = 6 / this.zoom;
    const x = (cx + 1) * CELL - r;
    const y = cy * CELL + r;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = "#e11d48";
    ctx.fill();
    ctx.lineWidth = 1 / this.zoom;
    ctx.strokeStyle = "#fff";
    ctx.stroke();
    ctx.font = `700 ${8 / this.zoom}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#fff";
    ctx.fillText(String(n), x, y + 0.5 / this.zoom);
    ctx.textAlign = "start";
  }

  private drawToolPreview(map: MapDef): void {
    const h = this.hoverInfo();
    const ctx = this.ctx;
    const at = this.strokePos();
    if (this.drag?.kind === "rect" && at) {
      const r = rectOf(this.drag.bx, this.drag.by, clampB(at.bx, map.width), clampB(at.by, map.height));
      this.drawStampFill(r.x, r.y, r.w, r.h, 0.65);
      outline(ctx, r.x * BLOCK, r.y * BLOCK, r.w * BLOCK, r.h * BLOCK, this.zoom, "#ffd34d");
      return;
    }
    if (this.drag?.kind === "tilepick" && h) {
      const origin = this.placedOf(this.drag.mapId);
      const m = store.maps[this.drag.mapId];
      if (origin && m && h.mapId === this.drag.mapId) {
        const r = this.tileRect(this.drag, h, m);
        outline(ctx, origin.x + r.x * TILE, origin.y + r.y * TILE, r.w * TILE, r.h * TILE, this.zoom, "#4dd2ff");
      }
      return;
    }
    if (this.drag?.kind === "pick" && h) {
      const origin = this.placedOf(this.drag.mapId);
      const at = this.blockUnder(this.drag.mapId);
      if (origin && at) {
        const r = rectOf(this.drag.bx, this.drag.by, at.bx, at.by);
        outline(ctx, origin.x + r.x * BLOCK, origin.y + r.y * BLOCK, r.w * BLOCK, r.h * BLOCK, this.zoom, "#4dd2ff");
      }
      return;
    }
    if (!h || !h.inside) return;
    if (store.tool === "brush" || store.tool === "fill" || store.tool === "rect") {
      const s = store.tool === "brush" ? store.stamp : { ...store.stamp, w: 1, h: 1 };
      this.drawStamp(s, h.bx, h.by, 0.7);
      outline(ctx, h.bx * BLOCK, h.by * BLOCK, s.w * BLOCK, s.h * BLOCK, this.zoom, "#ffd34d");
    } else if (store.tool === "tile") {
      outline(ctx, h.tx * TILE, h.ty * TILE, store.tileStamp.w * TILE, store.tileStamp.h * TILE, this.zoom, "#ffd34d");
    } else if (store.tool === "select") {
      outline(ctx, h.cx * CELL, h.cy * CELL, CELL, CELL, this.zoom, "rgba(255,255,255,0.6)");
    }
  }

  private currentAtlas(): BlockAtlas | undefined {
    return this.atlases.get(`${store.map.tileset}|${this.paletteKey(store.currentMap)}`);
  }

  private drawStamp(s: Stamp, bx: number, by: number, alpha: number): void {
    const atlas = this.currentAtlas();
    if (!atlas) return;
    const ctx = this.ctx;
    ctx.globalAlpha = alpha;
    for (let y = 0; y < s.h; y++) {
      for (let x = 0; x < s.w; x++) {
        const b = s.blocks[y * s.w + x];
        if (b === undefined || b >= atlas.count) continue;
        if (bx + x >= store.map.width || by + y >= store.map.height) continue;
        const [sx, sy] = atlasRect(b);
        ctx.drawImage(atlas.canvas, sx, sy, BLOCK, BLOCK, (bx + x) * BLOCK, (by + y) * BLOCK, BLOCK, BLOCK);
      }
    }
    ctx.globalAlpha = 1;
  }

  private drawStampFill(x0: number, y0: number, w: number, h: number, alpha: number): void {
    const s = store.stamp;
    const blocks: number[] = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) blocks.push(s.blocks[(y % s.h) * s.w + (x % s.w)]);
    this.drawStamp({ w, h, blocks }, x0, y0, alpha);
  }

  // ------------------------------------------------------------ hit testing

  private screenToWorld(sx: number, sy: number): { wx: number; wy: number } {
    return { wx: this.camX + sx / this.zoom, wy: this.camY + sy / this.zoom };
  }

  // the pointer in the current map's block / cell / tile coordinates, also
  // outside it (over a neighbor or the void); strokes clamp these to the map
  private strokePos(): { bx: number; by: number; cx: number; cy: number; tx: number; ty: number } | null {
    if (!this.hover) return null;
    const p = this.placedOf(store.currentMap);
    const lx = this.hover.wx - (p?.x ?? 0);
    const ly = this.hover.wy - (p?.y ?? 0);
    return {
      bx: Math.floor(lx / BLOCK_PX),
      by: Math.floor(ly / BLOCK_PX),
      cx: Math.floor(lx / CELL),
      cy: Math.floor(ly / CELL),
      tx: Math.floor(lx / TILE),
      ty: Math.floor(ly / TILE),
    };
  }

  private mapUnder(wx: number, wy: number): Placed | undefined {
    const cur = this.placedOf(store.currentMap);
    const inside = (p: Placed) => {
      const m = store.maps[p.id];
      return wx >= p.x && wy >= p.y && wx < p.x + m.width * BLOCK_PX && wy < p.y + m.height * BLOCK_PX;
    };
    if (cur && inside(cur)) return cur;
    if (!store.overlays.neighbors) return undefined;
    return this.placed.find(inside);
  }

  private blockUnder(mapId: string): { bx: number; by: number } | null {
    if (!this.hover) return null;
    const p = this.placedOf(mapId);
    const m = store.maps[mapId];
    if (!p || !m) return null;
    return {
      bx: clampB(Math.floor((this.hover.wx - p.x) / BLOCK_PX), m.width),
      by: clampB(Math.floor((this.hover.wy - p.y) / BLOCK_PX), m.height),
    };
  }

  hoverInfo(): HoverInfo | null {
    // the pointer can move over the canvas while a project is still loading
    if (!this.hover || !store.project || !store.map) return null;
    const map = store.map;
    const { wx, wy } = this.hover;
    const under = this.mapUnder(wx, wy);
    const id = under?.id ?? store.currentMap;
    const m = store.maps[id];
    const ox = under?.x ?? 0;
    const oy = under?.y ?? 0;
    const lx = wx - ox;
    const ly = wy - oy;
    const bx = Math.floor(lx / BLOCK_PX);
    const by = Math.floor(ly / BLOCK_PX);
    const cx = Math.floor(lx / CELL);
    const cy = Math.floor(ly / CELL);
    const cell = store.adapter.cell(m, liveTileset(m.tileset), cx, cy);
    return {
      mapId: id,
      bx, by, cx, cy,
      tx: Math.floor(lx / TILE),
      ty: Math.floor(ly / TILE),
      block: blockAt(m, bx, by),
      tile: cell.tile,
      walkable: cell.walkable,
      inside: id === store.currentMap && bx >= 0 && by >= 0 && bx < map.width && by < map.height,
    };
  }

  // topmost first: NPCs, signs, triggers, warps
  private entityAt(cx: number, cy: number): NonNullable<Selection> | null {
    const map = store.map;
    for (const layer of byKind(store.adapter.layers, ["npc", "sign", "trigger", "warp"])) {
      const list = store.entities(map, layer.key);
      for (let i = list.length - 1; i >= 0; i--) if (list[i].x === cx && list[i].y === cy) return { layer: layer.key, index: i };
    }
    return null;
  }

  // ------------------------------------------------------------ input

  private bindInput(): void {
    const c = this.canvas;
    c.addEventListener("contextmenu", (e) => e.preventDefault());
    c.addEventListener("pointerdown", (e) => this.pointerDown(e));
    c.addEventListener("pointermove", (e) => this.pointerMove(e));
    c.addEventListener("pointerup", () => this.pointerUp());
    c.addEventListener("pointercancel", () => this.endDrag());
    c.addEventListener("pointerleave", () => {
      if (!this.drag) {
        this.hover = null;
        this.onHover(null);
        this.invalidate();
      }
    });
    c.addEventListener("dblclick", (e) => this.doubleClick(e));
    c.addEventListener("wheel", (e) => {
      e.preventDefault();
      const factor = Math.pow(1.0018, -e.deltaY * (e.deltaMode === 1 ? 33 : 1));
      this.zoomBy(factor, e.offsetX, e.offsetY);
    }, { passive: false });
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.cellPick && !this.pickDone) this.cancelPick();
      if (e.code === "Space" && !isTyping(e)) {
        this.spaceDown = true;
        c.style.cursor = "grab";
      }
    });
    window.addEventListener("keyup", (e) => {
      if (e.code === "Space") {
        this.spaceDown = false;
        c.style.cursor = "";
      }
    });
  }

  private pointerDown(e: PointerEvent): void {
    if (!store.project || !store.map) return;
    this.canvas.focus();
    this.canvas.setPointerCapture(e.pointerId);
    this.hover = this.screenToWorld(e.offsetX, e.offsetY);
    // middle (or Space+left) pans; right picks blocks like the pick tool
    if (e.button === 1 || (e.button === 0 && this.spaceDown)) {
      this.drag = { kind: "pan", sx: e.clientX, sy: e.clientY, camX: this.camX, camY: this.camY };
      this.liveFit = null;
      this.canvas.style.cursor = "grabbing";
      return;
    }
    if (e.button !== 0 && e.button !== 2) return;
    const h = this.hoverInfo();
    if (!h) return;
    // "pick on map": this click answers the inspector instead of the tool
    // drawing a path: right click takes it back (to that cell, or one click)
    if (this.cellPick && this.pickDone && e.button === 2) {
      // outside the map: no cell, so it undoes the last click
      this.pickBack?.(h.inside ? h.cx : -1, h.inside ? h.cy : -1);
      return;
    }
    if (this.cellPick && e.button === 0) {
      const pick = this.cellPick;
      const multi = this.pickDone !== null;
      if (!multi) this.cancelPick();
      else this.cellPick = null;
      if (h.inside) pick(h.cx, h.cy);
      else if (multi) this.cellPick = pick;
      return;
    }
    // a mod's area kind: paint cells with the brush's values, right-drag erases
    if (store.tool === "area" && store.areaBrush && h.inside) {
      const erase = e.button === 2;
      paintCell(store.currentMap, store.areaBrush.kind, erase ? null : store.areaBrush.values, h.cx, h.cy);
      this.drag = { kind: "area", lastCx: h.cx, lastCy: h.cy, erase };
      this.invalidate();
      return;
    }
    // the tile brush picks the tile under the cursor (right-drag: an area)
    if ((e.altKey || e.button === 2) && store.tool === "tile") {
      this.drag = { kind: "tilepick", mapId: h.mapId, tx: h.tx, ty: h.ty };
      this.invalidate();
      return;
    }
    // right-click / right-drag (or Alt+click) picks blocks from any tool
    if (e.altKey || e.button === 2) {
      this.drag = { kind: "pick", mapId: h.mapId, bx: h.bx, by: h.by };
      this.invalidate();
      return;
    }
    const tool = store.tool;
    if (!h.inside) {
      if (tool === "select") store.select(null);
      return;
    }
    if (tool === "select") {
      const hit = this.entityAt(h.cx, h.cy);
      // no entity there: a painted cell of a mod's area kind, if any
      const painted = hit ? null : cellAt(store.map, h.cx, h.cy);
      if (painted) store.selectCell({ kind: painted.kind, x: h.cx, y: h.cy });
      else store.select(hit);
      if (hit) {
        const ent = store.entities(store.map, hit.layer)[hit.index];
        this.drag = { kind: "move", sel: hit, offX: h.cx - ent.x, offY: h.cy - ent.y };
        // like a paint stroke: the panels refresh once the drag is over
        store.brushing = true;
      }
    } else if (store.adapter.scenes && store.scene > 0 && tool !== "brush" && (tool === "tile" || tool === "rect" || tool === "fill")) {
      // (no DOM imports here: main.ts shows notices)
      store.emit("notice", `In a scene only the block brush paints (scene ${store.scene}'s own blocks). Pick Scene 0 to use this tool on the map.`);
    } else if (tool === "brush") {
      store.brushing = true;
      this.paintAt(h.bx, h.by);
      this.drag = { kind: "paint", lastBx: h.bx, lastBy: h.by };
    } else if (tool === "tile") {
      store.brushing = true;
      this.paintTileAt(h.tx, h.ty);
      this.drag = { kind: "tile", lastTx: h.tx, lastTy: h.ty };
    } else if (tool === "rect") {
      this.drag = { kind: "rect", bx: h.bx, by: h.by };
    } else if (tool === "fill") {
      const value = store.stamp.blocks[0];
      store.edit(store.currentMap, "Fill", (d) => {
        d.blocks = floodFill(d, h.bx, h.by, value);
      });
      store.seal();
    }
    this.invalidate();
  }

  private pointerMove(e: PointerEvent): void {
    const d = this.drag;
    if (d?.kind === "pan") {
      this.camX = d.camX - (e.clientX - d.sx) / this.zoom;
      this.camY = d.camY - (e.clientY - d.sy) / this.zoom;
      this.invalidate();
      return;
    }
    this.hover = this.screenToWorld(e.offsetX, e.offsetY);
    const h = this.hoverInfo();
    this.onHover(h);
    if (this.pathOverlay && this.pickDone) this.invalidate();
    // a stroke stays on its map: over a neighbor, the pointer counts in the
    // current map's coordinates (the neighbor's own ones drew a line across)
    const at = this.strokePos();
    if (d?.kind === "paint" && at) {
      // walk the segment so a fast stroke leaves no gaps
      const map = store.map;
      const tx = clampB(at.bx, map.width);
      const ty = clampB(at.by, map.height);
      let x = d.lastBx;
      let y = d.lastBy;
      while (x !== tx || y !== ty) {
        x += Math.sign(tx - x);
        y += Math.sign(ty - y);
        this.paintAt(x, y);
      }
      d.lastBx = tx;
      d.lastBy = ty;
    } else if (d?.kind === "area" && at && store.areaBrush) {
      const map = store.map;
      const tx = Math.max(0, Math.min(at.cx, map.width * 2 - 1));
      const ty = Math.max(0, Math.min(at.cy, map.height * 2 - 1));
      let x = d.lastCx;
      let y = d.lastCy;
      while (x !== tx || y !== ty) {
        x += Math.sign(tx - x);
        y += Math.sign(ty - y);
        paintCell(store.currentMap, store.areaBrush.kind, d.erase ? null : store.areaBrush.values, x, y);
      }
      d.lastCx = tx;
      d.lastCy = ty;
    } else if (d?.kind === "tile" && at) {
      const map = store.map;
      const tx = Math.max(0, Math.min(at.tx, map.width * 4 - 1));
      const ty = Math.max(0, Math.min(at.ty, map.height * 4 - 1));
      let x = d.lastTx;
      let y = d.lastTy;
      while (x !== tx || y !== ty) {
        x += Math.sign(tx - x);
        y += Math.sign(ty - y);
        this.paintTileAt(x, y);
      }
      d.lastTx = tx;
      d.lastTy = ty;
    } else if (d?.kind === "move" && at) {
      const map = store.map;
      const nx = clamp(at.cx - d.offX, 0, map.width * 2 - 1);
      const ny = clamp(at.cy - d.offY, 0, map.height * 2 - 1);
      const ent = store.entities(map, d.sel.layer)[d.sel.index];
      if (ent && (ent.x !== nx || ent.y !== ny)) {
        store.edit(store.currentMap, `Move ${d.sel.layer}`, (draft) => {
          const target = store.entities(draft, d.sel.layer)[d.sel.index];
          target.x = nx;
          target.y = ny;
        }, true);
      }
    }
    this.invalidate();
  }

  private pointerUp(): void {
    store.brushing = false;
    const d = this.drag;
    // skipped during the drag (a position never changes a map's colors)
    if (d?.kind === "move") store.refreshPalettes();
    if (d?.kind === "rect") {
      const at = this.strokePos();
      if (at) {
        const map = store.map;
        const r = rectOf(d.bx, d.by, clampB(at.bx, map.width), clampB(at.by, map.height));
        const s = store.stamp;
        store.edit(store.currentMap, "Rectangle", (draft) => {
          for (let y = 0; y < r.h; y++) {
            for (let x = 0; x < r.w; x++) {
              draft.blocks[(r.y + y) * draft.width + r.x + x] = s.blocks[(y % s.h) * s.w + (x % s.w)];
            }
          }
        });
      }
    } else if (d?.kind === "tilepick") {
      const h = this.hoverInfo();
      const m = store.maps[d.mapId];
      const ts = m && liveTileset(m.tileset);
      if (h && ts && h.mapId === d.mapId) {
        const r = this.tileRect(d, h, m);
        const tiles: number[] = [];
        for (let y = r.y; y < r.y + r.h; y++) {
          for (let x = r.x; x < r.x + r.w; x++) tiles.push(ts.blocks[blockAt(m, Math.floor(x / 4), Math.floor(y / 4))]?.[(y % 4) * 4 + (x % 4)] ?? 0);
        }
        store.setTileStamp({ w: r.w, h: r.h, blocks: tiles });
      }
    } else if (d?.kind === "pick") {
      const at = this.blockUnder(d.mapId);
      const m = store.maps[d.mapId];
      if (at && m) {
        const r = rectOf(d.bx, d.by, at.bx, at.by);
        const blocks: number[] = [];
        for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) blocks.push(blockAt(m, r.x + x, r.y + y));
        store.setStamp({ w: r.w, h: r.h, blocks });
        // like a click in the block palette: the next click paints it
        if (store.tool === "select") store.setTool("brush");
      }
    }
    this.endDrag();
  }

  private endDrag(): void {
    // a cancelled pointer ends a stroke too (the panels wait for it)
    if (store.brushing) {
      store.brushing = false;
      if (this.drag?.kind === "move") store.refreshPalettes();
    }
    if (this.drag && this.drag.kind !== "pan") store.seal();
    this.drag = null;
    this.canvas.style.cursor = this.spaceDown ? "grab" : "";
    this.invalidate();
  }

  private doubleClick(e: MouseEvent): void {
    if (!store.project || !store.map) return;
    const w = this.screenToWorld(e.offsetX, e.offsetY);
    const under = this.mapUnder(w.wx, w.wy);
    if (under && under.id !== store.currentMap) {
      this.openMap(under.id);
      return;
    }
    const h = this.hoverInfo();
    if (h?.inside && store.tool === "select") {
      const hit = this.entityAt(h.cx, h.cy);
      const warp = warpLayer(store.adapter);
      if (hit && warp && hit.layer === warp.layer.key) this.followWarp(hit.index);
    }
  }

  followWarp(index: number): void {
    const w = warpLayer(store.adapter);
    if (!w) return;
    const warp = store.entities(store.map, w.layer.key)[index];
    const destId = warp?.[w.spec.mapKey];
    if (typeof destId !== "string" || !store.maps[destId]) return;
    const destIndex = Number(warp[w.spec.warpKey]) - 1;
    const target = store.entities(store.maps[destId], w.layer.key)[destIndex];
    this.openMap(destId);
    this.fitMap();
    if (target) store.select({ layer: w.layer.key, index: destIndex });
  }

  // one tile: the cell's block becomes one with that tile (tileBrush.ts);
  // the tileset change and the map change are one undo step
  private fullWarned = false;
  // the tile brush found the tileset full (main.ts tells the user)
  onTilesetFull: (tileset: string) => void = () => {};
  // the tiles between a right-drag's start and the pointer, inside the map
  private tileRect(from: { tx: number; ty: number }, h: HoverInfo, m: MapDef): { x: number; y: number; w: number; h: number } {
    const cx = (v: number, n: number) => Math.max(0, Math.min(v, n * 4 - 1));
    const x0 = cx(from.tx, m.width), x1 = cx(h.tx, m.width);
    const y0 = cx(from.ty, m.height), y1 = cx(h.ty, m.height);
    return { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0) + 1, h: Math.abs(y1 - y0) + 1 };
  }

  // the tile stamp with its top-left tile at (tx, ty)
  private paintTileAt(tx: number, ty: number): void {
    const s = store.tileStamp;
    for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) this.paintOneTile(tx + x, ty + y, s.blocks[y * s.w + x]);
  }

  private paintOneTile(tx: number, ty: number, tile: number): void {
    const map = store.map;
    const bx = Math.floor(tx / 4);
    const by = Math.floor(ty / 4);
    if (tx < 0 || ty < 0 || bx >= map.width || by >= map.height) return;
    const res = blockWithTile(store.currentMap, bx, by, (ty % 4) * 4 + (tx % 4), tile);
    if (!res) {
      if (!this.fullWarned) this.onTilesetFull(map.tileset);
      this.fullWarned = true;
      return;
    }
    this.fullWarned = false;
    if (res.write) store.setRecord(res.write.registry, res.write.id, "Tile brush", res.write.next, true);
    store.edit(store.currentMap, "Tile brush", (d) => {
      d.blocks[by * d.width + bx] = res.block;
    }, true);
    store.markMap("Tile brush", store.currentMap);
  }

  // The tiles of a tileset in the map's colors, laid out like its sheet
  // (`per` a row), for the palette: drawn as one-tile blocks, so RED++ and
  // palette colors come out as on the map.
  async tileSheetFor(tilesetId: string, palette: string): Promise<{ canvas: HTMLCanvasElement; count: number; per: number } | null> {
    const ts = liveTileset(tilesetId);
    if (!ts) return null;
    const count = sheetTiles(ts);
    const per = perRow(ts);
    const colorsFor = isGbcKey(palette) ? gbcColorsFor(tilesetId, palette) : store.adapter.tileColors(store.ctx, ts, palette);
    const single = { ...ts, id: `${tilesetId}#tiles`, blocks: Array.from({ length: count }, (_, t) => [t]) };
    const atlas = await blockAtlas(single, await this.sheetUrl(tilesetId, palette), palette, colorsFor, tilesetKey(tilesetId));
    const canvas = document.createElement("canvas");
    canvas.width = per * TILE;
    canvas.height = Math.max(1, Math.ceil(count / per)) * TILE;
    const ctx = canvas.getContext("2d")!;
    for (let t = 0; t < count; t++) {
      const [sx, sy] = atlasRect(t);
      ctx.drawImage(atlas.canvas, sx, sy, TILE, TILE, (t % per) * TILE, Math.floor(t / per) * TILE, TILE, TILE);
    }
    return { canvas, count, per };
  }

  private paintAt(bx: number, by: number): void {
    const s = store.stamp;
    // a scene above 0: its own layer of block changes
    const scenes = store.adapter.scenes;
    if (scenes && store.scene > 0) {
      const n = store.scene;
      store.edit(store.currentMap, `Paint (scene ${n})`, (d) => {
        for (let y = 0; y < s.h; y++) {
          for (let x = 0; x < s.w; x++) {
            const tx = bx + x;
            const ty = by + y;
            if (tx < d.width && ty < d.height) scenes.setBlock(d, n, tx, ty, s.blocks[y * s.w + x]);
          }
        }
      }, true);
      return;
    }
    store.edit(store.currentMap, "Paint", (d) => {
      for (let y = 0; y < s.h; y++) {
        for (let x = 0; x < s.w; x++) {
          const tx = bx + x;
          const ty = by + y;
          if (tx < d.width && ty < d.height) d.blocks[ty * d.width + tx] = s.blocks[y * s.w + x];
        }
      }
    }, true);
  }

  // The next left click on the current map reports its cell instead of
  // using the tool (Escape cancels).
  private cellPick: ((cx: number, cy: number) => void) | null = null;
  private pickEnd: (() => void) | null = null;
  private pickDone: ((keep: boolean) => void) | null = null;
  private pickBack: ((cx: number, cy: number) => void) | null = null;

  // An event preview: where the player and NPCs are right now (cells, may
  // be fractional mid-step) and an emotion bubble over one of them.
  private preview: EventPreviewState | null = null;

  setPreview(state: EventPreviewState | null): void {
    this.preview = state;
    this.invalidate();
  }

  private drawPreviewExtras(map: MapDef): void {
    const p = this.preview!;
    const npcLayer = store.adapter.layers.find((l) => l.kind === "npc");
    const player = p.actors.player;
    if (npcLayer && player && !player.hidden) {
      this.drawNpc(npcLayer, { x: player.x, y: player.y, sprite: p.playerSprite ?? playerSprites().walk, movement: "STAY", range: player.facing.toUpperCase() });
    }
    const who = p.emote ? p.actors[p.emote] : undefined;
    if (who) {
      const ctx = this.ctx;
      const x = who.x * CELL;
      const y = who.y * CELL - CELL - 2;
      ctx.fillStyle = "#ffffff";
      ctx.strokeStyle = "#202020";
      ctx.lineWidth = 1;
      ctx.fillRect(x + 2, y + 2, CELL - 4, CELL - 4);
      ctx.strokeRect(x + 2.5, y + 2.5, CELL - 5, CELL - 5);
      ctx.fillStyle = "#202020";
      ctx.font = "bold 11px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(p.emoteText ?? "!", x + CELL / 2, y + CELL - 4);
      ctx.textAlign = "start";
    }
    void map;
  }

  // An event's walking path, drawn over the map: from a start cell, one
  // cell per direction (up/down/left/right).
  private pathOverlay: { x: number; y: number; dirs: string[] } | null = null;

  setPathOverlay(path: { x: number; y: number; dirs: string[] } | null): void {
    this.pathOverlay = path;
    this.invalidate();
  }

  private drawPath(path: { x: number; y: number; dirs: string[] }): void {
    const ctx = this.ctx;
    const step: Record<string, [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
    const pts: [number, number][] = [[path.x, path.y]];
    for (const d of path.dirs) {
      const [dx, dy] = step[d] ?? [0, 0];
      const [x, y] = pts[pts.length - 1];
      pts.push([x + dx, y + dy]);
    }
    const c = (v: number) => v * CELL + CELL / 2;
    ctx.save();
    ctx.lineWidth = 3 / this.zoom;
    ctx.strokeStyle = "#2f7dff";
    ctx.fillStyle = "#2f7dff";
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(c(x), c(y)) : ctx.moveTo(c(x), c(y))));
    ctx.stroke();
    for (const [x, y] of pts) {
      ctx.beginPath();
      ctx.arc(c(x), c(y), 2.5 / this.zoom + 1, 0, Math.PI * 2);
      ctx.fill();
    }
    // the end of the path: a ring
    const [ex, ey] = pts[pts.length - 1];
    ctx.beginPath();
    ctx.arc(c(ex), c(ey), CELL / 3, 0, Math.PI * 2);
    ctx.stroke();
    // while drawing: where a click would walk (along x, then y)
    const h = this.pickDone ? this.hoverInfo() : null;
    if (h?.inside && (h.cx !== ex || h.cy !== ey)) {
      ctx.globalAlpha = 0.6;
      ctx.setLineDash([4 / this.zoom, 4 / this.zoom]);
      ctx.beginPath();
      ctx.moveTo(c(ex), c(ey));
      ctx.lineTo(c(h.cx), c(ey));
      ctx.lineTo(c(h.cx), c(h.cy));
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  // Picks cell after cell until Escape (then `done`): drawing a path.
  pickCells(onPick: (cx: number, cy: number) => void, done: (keep: boolean) => void, back?: (cx: number, cy: number) => void): void {
    this.pickBack = back ?? null;
    const again = (cx: number, cy: number) => {
      onPick(cx, cy);
      this.cellPick = again;
      this.canvas.style.cursor = "crosshair";
    };
    this.cellPick = again;
    this.pickDone = done;
    this.canvas.style.cursor = "crosshair";
    this.canvas.focus();
  }

  // one cell; `onEnd` runs when picking ends (picked, Escape or cancelPick)
  pickCell(onPick: (cx: number, cy: number) => void, onEnd?: () => void): void {
    this.cellPick = onPick;
    this.pickEnd = onEnd ?? null;
    this.canvas.style.cursor = "crosshair";
    this.canvas.focus();
  }

  // ends picking; a path drawing is kept (Done) unless keep is false
  cancelPick(keep = true): void {
    this.cellPick = null;
    this.pickBack = null;
    const done = this.pickDone;
    this.pickDone = null;
    const end = this.pickEnd;
    this.pickEnd = null;
    this.invalidate();
    done?.(keep);
    end?.();
    this.canvas.style.cursor = "";
  }

  get picking(): boolean {
    return this.cellPick !== null;
  }

  centerOnCell(cx: number, cy: number): void {
    this.camX = cx * CELL + CELL / 2 - this.viewW / 2 / this.zoom;
    this.camY = cy * CELL + CELL / 2 - this.viewH / 2 / this.zoom;
    this.liveFit = { cx, cy };
    this.invalidate();
  }

  // the cell at the middle of the view, clamped into the current map
  centerCell(): { cx: number; cy: number } {
    const map = store.map;
    const h = this.hover ? this.hoverInfo() : null;
    if (h?.inside) return { cx: h.cx, cy: h.cy };
    const w = this.screenToWorld(this.viewW / 2, this.viewH / 2);
    return {
      cx: clamp(Math.floor(w.wx / CELL), 0, map.width * 2 - 1),
      cy: clamp(Math.floor(w.wy / CELL), 0, map.height * 2 - 1),
    };
  }
}

// Whether two records draw the same pixels (and the same collision).
function sameGraphics(a: MapDef, b: MapDef): boolean {
  if (a.tileset !== b.tileset || a.width !== b.width || a.height !== b.height) return false;
  if (a.blocks === b.blocks) return true;
  if (a.blocks.length !== b.blocks.length) return false;
  for (let i = 0; i < a.blocks.length; i++) if (a.blocks[i] !== b.blocks[i]) return false;
  return true;
}

type WarpSpec = Extract<FieldSpec, { kind: "warpTarget" }>;

// The adapter's warp layer and its destination field, if it has one.
export function warpLayer(adapter: GameAdapter): { layer: EntityLayer; spec: WarpSpec } | null {
  for (const layer of adapter.layers) {
    if (layer.kind !== "warp") continue;
    const spec = layer.fields.find((f): f is WarpSpec => f.kind === "warpTarget");
    if (spec) return { layer, spec };
  }
  return null;
}

function byKind(layers: EntityLayer[], order: EntityLayer["kind"][]): EntityLayer[] {
  return [...layers].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function clampB(v: number, size: number): number {
  return clamp(v, 0, size - 1);
}

function rectOf(ax: number, ay: number, bx: number, by: number): { x: number; y: number; w: number; h: number } {
  return { x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(bx - ax) + 1, h: Math.abs(by - ay) + 1 };
}

function outline(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, zoom: number, color: string): void {
  ctx.lineWidth = 2 / zoom;
  ctx.strokeStyle = "rgba(0,0,0,0.6)";
  ctx.strokeRect(x, y, w, h);
  ctx.lineWidth = 1 / zoom;
  ctx.strokeStyle = color;
  ctx.strokeRect(x, y, w, h);
}

export interface EventPreviewState {
  actors: Record<string, { x: number; y: number; facing: string; hidden?: boolean }>;
  playerSprite?: string;
  emote?: string | null; // actor key
  emoteText?: string;
}

export function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  // a ticked checkbox keeps focus but takes no typing: shortcuts (Ctrl+Z) still work
  const box = t instanceof HTMLInputElement && (t.type === "checkbox" || t.type === "radio");
  return !!t && !box && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
}
