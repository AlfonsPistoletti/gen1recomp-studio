// Graphics > Town Map: the START menu's TOWN MAP screen (gen1recomp
// src/ui/TownMap.lua). field.townMap.background.map is its 20x18 grid of tile
// numbers on the background.tiles sheet: the game's 16 tiles, then the mod's
// own (studioTiles, 64 shade digits each; the engine ignores the key, the
// assets_transforms recipe builds the sheet from them). locations[MAP] =
// { name, x, y } puts a map on it, at screen tile (x + 2, y + 1) (markerXY).
// A new town's Fly entry is set on the map (Maps: Landing spot, "Fly here");
// the Fly map moves its cursor to the town's place here.

import { assetUrl, CACHE, isCachePath, type SheetRecipe } from "../core/assets.ts";
import { clone, deepEqual } from "../core/merge.ts";
import { store } from "../core/store.ts";
import { compose } from "../core/tilesets.ts";
import { loadImage, placeMarker, tintPixels, TILE } from "../render/graphics.ts";
import { clear, field, h, numberInput, selectInput, toast } from "./dom.ts";
import { nav } from "./nav.ts";
import { namedColors } from "./picColors.ts";
import { mountRecordList } from "./recordList.ts";
import { cutPicture, pickFile } from "./tilesetEditor.ts";

const REG = "field";
const ID = "townMap";
const COLS = 20;
const ROWS = 18;
// tiles a row of the game's sheet (32 px wide)
const PER = 4;
const ZOOM = 4;
const SHEET_REL = "studio/townmap/tiles.png";
// the top row is the banner's background (the place name is written on it)
const BANNER_ROWS = 1;

interface Loc {
  name?: string;
  x: number;
  y: number;
}
interface Tiles {
  path: string;
  width?: number;
  height?: number;
  studioTiles?: string[];
}
interface TownMap {
  background: { map: number[]; tiles: Tiles };
  cursorOrder?: string[];
  locations?: Record<string, Loc>;
}

const live = () => store.table(REG)[ID] as TownMap | undefined;
const base = () => store.baseTable(REG)[ID] as TownMap | undefined;
const ownTiles = (tm: TownMap | undefined) => tm?.background.tiles.studioTiles ?? [];
const gameTileCount = (b: TownMap) => Math.floor((b.background.tiles.width ?? 32) / TILE) * Math.floor((b.background.tiles.height ?? 32) / TILE);

// the sheet the recipe builds: the player's own Town Map tiles + the mod's
export function townMapSheets(): SheetRecipe[] {
  const tiles = ownTiles(live());
  const path = base()?.background.tiles.path;
  if (!tiles.length || !isCachePath(path)) return [];
  return [{ source: path.slice(CACHE.length), out: SHEET_REL, per: PER, tiles }];
}

// own tiles + the sheet the engine draws then (the game's again without any)
function setOwnTiles(draft: TownMap, tiles: string[]): void {
  const b = base()!.background.tiles;
  draft.background.tiles = tiles.length
    ? { ...b, path: `save/mod-derived/${store.project.mod}/${SHEET_REL}`, height: (b.height ?? 32) + Math.ceil(tiles.length / PER) * TILE, studioTiles: tiles }
    : clone(b);
}

export function mountTownMapWorkspace(left: HTMLElement, center: HTMLElement, right: HTMLElement): void {
  let current: string | null = null;
  let tile = 4;
  // like Gen 2's editor: clicks move the selected place, or paint tiles
  let mode: "move" | "paint" = "move";
  let showPlaces = true;

  const isModMap = (id: string) => store.baseTable("maps")[id] === undefined;
  const list = mountRecordList(left, {
    title: "Places",
    placeholder: "Search maps…",
    searchId: "townmap-search",
    items: () => {
      const locs = live()?.locations ?? {};
      const baseLocs = base()?.locations ?? {};
      // the game's place list also names a few maps that don't exist (pokered's
      // unused *_COPY ids): only real maps are listed
      const ids = new Set([...Object.keys(locs).filter((m) => store.maps[m]), ...Object.keys(store.maps).filter(isModMap)]);
      return [...ids].sort().map((id) => ({
        id,
        label: id,
        meta: locs[id] ? locs[id].name ?? "" : "not on the map",
        edited: !deepEqual(locs[id], baseLocs[id]),
        isNew: isModMap(id),
      }));
    },
    current: () => current,
    pick: (id) => {
      current = id;
      mode = "move";
      list.render();
      void render();
    },
    refreshOn: (reason, id, registry) => (reason === "content" && registry === REG && id === ID) || reason === "edit",
  });

  const edit = (label: string, mutate: (d: TownMap) => void, merge = false) => {
    store.editRecord<TownMap>(REG, ID, label, mutate, { merge });
    if (!merge) store.seal();
  };

  // ---------------------------------------------------------------- center
  // drawn at the zoomed size, so the place markers stay thin over the map
  const canvas = h("canvas", { class: "townmap-canvas", width: COLS * TILE * ZOOM, height: ROWS * TILE * ZOOM });
  canvas.style.width = `${COLS * TILE * ZOOM}px`;
  const status = h("p", { class: "hint" });
  const palette = h("div", { class: "townmap-tiles" });
  const placesToggle = h("input", { type: "checkbox", checked: true, onchange: () => { showPlaces = placesToggle.checked; void render(); } });
  const modeSel = h("select", {}, h("option", { value: "move" }, "Move the selected place"), h("option", { value: "paint" }, "Paint tiles"));
  modeSel.addEventListener("change", () => {
    mode = modeSel.value as "move" | "paint";
    void render();
  });
  const head = h("div", { class: "panel-head" },
    h("span", { class: "head-title" }, "Town Map"),
    h("div", { class: "row nowrap" },
      h("label", { class: "inline-check" }, placesToggle, "Show places"),
      modeSel,
      h("button", { class: "btn small", title: "Add tiles cut from a picture (8x8 each, in the 4 shades)", onclick: () => void importTiles() }, "+ Import tiles"),
      h("button", { class: "btn small danger", title: "The game's map, tiles and places again", onclick: () => {
        if (!live() || !store.isRecordEdited(REG, ID)) return;
        if (confirm("Back to the game's Town Map? Your painting, own tiles and places go.")) store.revertRecord(REG, ID, "Back to the game's Town Map");
      } }, "Back to the game's map")),
  );
  center.append(head, h("div", { class: "ws-scroll" },
    h("div", { class: "townmap-wrap" }, canvas),
    status,
    palette,
    h("p", { class: "hint" }, "The top row stays: the game writes the place name on it. The game shows only the cursor and the player on the map, not the rings."),
  ));
  const side = h("div", { class: "ws-scroll" });
  right.append(h("div", { class: "panel-head" }, h("span", {}, "Place")), side);

  // the sheet in the TOWNMAP colors, cached per tiles + colors
  let sheetKey = "";
  let sheet: HTMLCanvasElement | null = null;
  const loadSheet = async (tm: TownMap): Promise<HTMLCanvasElement | null> => {
    const pal = namedColors("TOWNMAP", store.colorMode === "redpp");
    const key = JSON.stringify([ownTiles(tm), pal]);
    if (key === sheetKey && sheet) return sheet;
    const url = assetUrl(store.project.host, store.project.version, base()!.background.tiles.path);
    const tiles = ownTiles(tm);
    const img = await loadImage(tiles.length ? await compose(url, PER, tiles) : url);
    if (!img) return null;
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0);
    if (pal) {
      const data = ctx.getImageData(0, 0, c.width, c.height);
      tintPixels(data.data, pal);
      ctx.putImageData(data, 0, 0);
    }
    sheetKey = key;
    sheet = c;
    return c;
  };
  const tileCount = (tm: TownMap) => gameTileCount(base()!) + ownTiles(tm).length;
  const drawTile = (ctx: CanvasRenderingContext2D, src: HTMLCanvasElement, t: number, x: number, y: number) =>
    ctx.drawImage(src, (t % PER) * TILE, Math.floor(t / PER) * TILE, TILE, TILE, x, y, TILE, TILE);

  let token = 0;
  const render = async () => {
    const tm = live();
    if (!tm?.background?.map || !base()) {
      clear(palette);
      status.textContent = "This version's data has no Town Map.";
      return;
    }
    const my = ++token;
    const src = await loadSheet(tm);
    if (my !== token || !src) return;
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    const Z = TILE * ZOOM;
    tm.background.map.forEach((t, i) => ctx.drawImage(src, (t % PER) * TILE, Math.floor(t / PER) * TILE, TILE, TILE, (i % COLS) * Z, Math.floor(i / COLS) * Z, Z, Z));
    // the banner row can't be painted: shaded
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(0, 0, COLS * Z, BANNER_ROWS * Z);
    if (showPlaces) {
      // places sit on screen tile (x + 2, y + 1): a marker at its center
      const mark = (loc: Loc, selected: boolean) => placeMarker(ctx, (loc.x + 2.5) * Z, (loc.y + 1.5) * Z, selected);
      const sel = current ? tm.locations?.[current] : undefined;
      for (const loc of Object.values(tm.locations ?? {})) if (loc !== sel) mark(loc, false);
      if (sel) mark(sel, true);
    }
    modeSel.value = mode;
    status.textContent = mode === "move"
      ? current ? "Click the map to put the selected place there." : "Pick a place on the left (or click its ring), then click where it goes."
      : `Click or drag to paint tile ${tile}. Right-click picks the tile under the cursor.`;
    // the tiles to paint with
    clear(palette);
    if (mode === "paint") for (let t = 0; t < tileCount(tm); t++) {
      const c = h("canvas", { class: `townmap-tile${t === tile ? " active" : ""}`, width: TILE, height: TILE, title: t < gameTileCount(base()!) ? `Tile ${t}` : `Tile ${t} (yours)`, onclick: () => { tile = t; void render(); } });
      drawTile(c.getContext("2d")!, src, t, 0, 0);
      palette.append(c);
    }
    renderSide(tm);
  };

  // ---------------------------------------------------------------- grid input
  const cellAt = (e: PointerEvent | MouseEvent) => {
    const r = canvas.getBoundingClientRect();
    const cx = Math.floor(((e.clientX - r.left) / r.width) * COLS);
    const cy = Math.floor(((e.clientY - r.top) / r.height) * ROWS);
    return cx >= 0 && cy >= 0 && cx < COLS && cy < ROWS ? { cx, cy } : null;
  };
  const paint = (e: PointerEvent) => {
    const cell = cellAt(e);
    const tm = live();
    if (!cell || !tm) return;
    const i = cell.cy * COLS + cell.cx;
    if (e.button === 2 || e.buttons === 2) {
      tile = tm.background.map[i];
      void render();
      return;
    }
    if (cell.cy < BANNER_ROWS || tm.background.map[i] === tile) return;
    edit("Paint the Town Map", (d) => {
      d.background.map[i] = tile;
    }, true);
    void render();
  };
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  canvas.addEventListener("pointerdown", (e) => {
    const cell = cellAt(e);
    if (mode === "move") {
      if (!cell || e.button !== 0) return;
      // a ring under the click selects its place
      const hit = showPlaces ? Object.entries(live()?.locations ?? {}).find(([, l]) => l.x + 2 === cell.cx && l.y + 1 === cell.cy)?.[0] : undefined;
      if (hit && hit !== current) {
        current = hit;
        list.render();
        void render();
        return;
      }
      if (!current) return;
      if (cell.cx < 2 || cell.cy < 1) return toast("The places start 2 tiles in from the left and 1 down from the top", "error");
      placeAt(current, cell.cx - 2, cell.cy - 1);
      return;
    }
    canvas.setPointerCapture(e.pointerId);
    paint(e);
  });
  canvas.addEventListener("pointermove", (e) => {
    const cell = cellAt(e);
    const tm = live();
    if (cell && tm) {
      const here = Object.entries(tm.locations ?? {}).filter(([, l]) => l.x + 2 === cell.cx && l.y + 1 === cell.cy);
      status.textContent = `Tile ${tm.background.map[cell.cy * COLS + cell.cx]}${here.length ? ` · ${[...new Set(here.map(([, l]) => l.name ?? ""))].join(", ")} (${here.length} map${here.length > 1 ? "s" : ""})` : ""}`;
    }
    if (e.buttons && mode === "paint") paint(e);
  });
  canvas.addEventListener("pointerup", () => store.seal());

  // ---------------------------------------------------------------- places
  const placeAt = (id: string, x: number, y: number) => {
    edit(`${id}: place on the Town Map`, (d) => {
      const locs = (d.locations ??= {});
      locs[id] = { name: locs[id]?.name ?? id.replace(/_/g, " "), x, y };
      // the d-pad only stops at places in cursorOrder
      if (!(d.cursorOrder ??= []).includes(id)) d.cursorOrder.push(id);
    });
    list.render();
    void render();
  };

  const renderSide = (tm: TownMap) => {
    clear(side);
    if (!current) {
      side.append(h("p", { class: "hint" }, "Pick a map on the left to place it on the Town Map or rename its place."));
    } else {
      const id = current;
      const loc = tm.locations?.[id];
      const baseLoc = base()?.locations?.[id];
      const others = Object.keys(tm.locations ?? {}).filter((m) => m !== id).sort();
      side.append(h("h3", {}, id));
      if (loc) {
        const name = h("input", { type: "text", value: loc.name ?? "", onchange: () => edit(`${id}: Town Map name`, (d) => { d.locations![id].name = name.value.trim().toUpperCase(); }) });
        side.append(
          field("Name", name, "The banner shows it. Maps with the same name and square are one place."),
          h("div", { class: "row two" },
            field("X", numberInput(loc.x, (v) => edit(`${id}: Town Map place`, (d) => { d.locations![id].x = v; }), 0, COLS - 3)),
            field("Y", numberInput(loc.y, (v) => edit(`${id}: Town Map place`, (d) => { d.locations![id].y = v; }), 0, ROWS - 2)),
          ),
        );
      } else {
        side.append(h("p", { class: "hint" }, "Not on the Town Map: the map shows no place while the player is here."));
      }
      // where the d-pad cursor stops at it (cursorOrder; a changed order is
      // saved as the whole list)
      const order = tm.cursorOrder ?? [];
      const at = order.indexOf(id);
      if (loc && at >= 0) {
        side.append(field("Cursor comes after…", selectInput(order[at - 1] ?? "", order.filter((m) => m !== id), (after) => {
          edit(`${id}: Town Map cursor order`, (d) => {
            const rest = (d.cursorOrder ?? []).filter((m) => m !== id);
            rest.splice(after ? rest.indexOf(after) + 1 : 0, 0, id);
            d.cursorOrder = rest;
          });
        }, "First"), "Up and down on the Town Map go through the places in this order."));
      }
      side.append(
        ...(loc ? [] : [h("p", { class: "hint" }, "Click the map to put it there (Move the selected place).")]),
        field("Same spot as…", selectInput("", others, (other) => {
          const o = live()?.locations?.[other];
          if (o) edit(`${id}: same spot as ${other}`, (d) => { (d.locations ??= {})[id] = clone(o); });
        }, "Pick a map"), "For a building: it shows its town's place."),
      );
      if (loc && !baseLoc) {
        side.append(h("button", { class: "btn small danger", onclick: () => edit(`${id}: off the Town Map`, (d) => {
          delete d.locations![id];
          if (d.cursorOrder) d.cursorOrder = d.cursorOrder.filter((m) => m !== id);
        }) }, "Remove from the Town Map"));
      } else if (loc && !deepEqual(loc, baseLoc)) {
        side.append(h("button", { class: "btn small danger", onclick: () => edit(`${id}: Town Map place back`, (d) => { d.locations![id] = clone(baseLoc!); }) }, "Back to the game's place"));
      }
    }
    side.append(h("p", { class: "hint" }, "A new town you can fly to (Maps: the town's Landing spot, \"Fly here\") shows up at its place here on the Fly map."));
  };

  // ---------------------------------------------------------------- import
  const importTiles = async () => {
    const tm = live();
    if (!tm || !base()) return;
    const file = await pickFile();
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = await loadImage(url);
    URL.revokeObjectURL(url);
    if (!img || img.width < TILE || img.height < TILE) return toast("That picture is smaller than one 8x8 tile", "error");
    // the game's tiles as digits too, so a picture of the map adds only new ones
    const gameImg = await loadImage(assetUrl(store.project.host, store.project.version, base()!.background.tiles.path));
    const have = new Set([...(gameImg ? cutPicture(gameImg, false, false).tiles.map((t) => t.key) : []), ...ownTiles(tm)]);
    const fresh = cutPicture(img, false).tiles.map((t) => t.key).filter((k) => !have.has(k));
    if (!fresh.length) return toast("All tiles of that picture are already there", "info");
    edit("Import Town Map tiles", (d) => setOwnTiles(d, [...ownTiles(d), ...fresh]));
    tile = tileCount(live()!) - fresh.length;
    toast(`${fresh.length} tile${fresh.length > 1 ? "s" : ""} added`, "ok");
  };

  store.on((reason, id, registry) => {
    if (reason === "project") {
      current = null;
      sheetKey = "";
    }
    const shown = nav.workspace === "graphics" && nav.graphicsView === "townmap";
    if (shown && (reason === "project" || reason === "colors" || (registry === REG && id === ID))) void render();
  });
  nav.openTownMap = (mapId) => {
    nav.setWorkspace("graphics");
    nav.showGraphics("townmap");
    if (mapId) {
      current = mapId;
      list.render();
    }
    void render();
  };
  nav.onTownMapShown = () => void render();
}
