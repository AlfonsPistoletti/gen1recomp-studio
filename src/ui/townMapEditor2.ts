// Graphics > Town Map on Gen 2: the Pokégear's map (gen1recomp
// src/ui/gen2/Pokegear.lua drawMap). Each region is a 20x18 grid of tile ids
// on the pokegear sheet (menu_gfx.lua pokegear.maps.johto / .kanto, written by
// the studio helper on game.ready: no registry reaches them), and the places
// are the `landmarks` registry: a name (two lines, "\n") and a pixel spot on
// that screen. A landmark numbered at or past PALLET_TOWN's is Kanto (the
// FAST_SHIP excepted), like Pokegear:region.

import { deepEqual } from "../core/merge.ts";
import { store } from "../core/store.ts";
import { loadImage, placeMarker, tintPixels, TILE } from "../render/graphics.ts";
import type { Rgb } from "../render/color.ts";
import { field, h, numberInput } from "./dom.ts";
import { mountRecordList } from "./recordList.ts";

const COLS = 20;
const ROWS = 18;
const ZOOM = 3;

type Landmark = { name?: string; x?: number; y?: number; index?: number };
type Spec = NonNullable<NonNullable<typeof store.adapter>["townMap2"]>;

export function mountTownMap2(left: HTMLElement, center: HTMLElement, right: HTMLElement): { shown(): void; open(): void } {
  let current: string | null = null;
  let region = "johto";
  let mode: "move" | "paint" = "move";
  let tile = 0;
  const spec = () => store.adapter?.townMap2 as Spec | undefined;
  const landmarks = () => (spec() ? store.table(spec()!.landmarks) : {}) as Record<string, Landmark>;
  const regionOf = (id: string) => spec()?.regionOf(store.ctx, id) ?? "johto";

  const list = mountRecordList(left, {
    title: "Places",
    placeholder: "Search places…",
    searchId: "townmap2-search",
    items: () => {
      const s = spec();
      if (!s) return [];
      const base = store.baseTable(s.landmarks);
      return Object.entries(landmarks())
        .sort((a, b) => Number(a[1].index ?? 0) - Number(b[1].index ?? 0))
        .map(([id, l]) => ({ id, label: String(l.name ?? id).replace(/\n/g, " "), meta: regionOf(id) === "kanto" ? "Kanto" : "Johto", edited: !deepEqual(base[id], l), isNew: base[id] === undefined }));
    },
    current: () => current,
    pick: (id) => {
      current = id;
      region = regionOf(id);
      mode = "move";
      list.render();
      void render();
    },
    refreshOn: (reason, _id, registry) => reason === "content" && registry === spec()?.landmarks,
  });

  // drawn at the zoomed size, so the place markers (editor marks, not game
  // art) stay thin over the map
  const canvas = h("canvas", { class: "townmap-canvas", width: COLS * TILE * ZOOM, height: ROWS * TILE * ZOOM });
  canvas.style.width = `${COLS * TILE * ZOOM}px`;
  let showPlaces = true;
  const placesToggle = h("input", { type: "checkbox", checked: true, onchange: () => { showPlaces = placesToggle.checked; void render(); } });
  const status = h("p", { class: "hint" });
  const palette = h("div", { class: "townmap-tiles" });
  const regionSel = h("select", {}, h("option", { value: "johto" }, "Johto"), h("option", { value: "kanto" }, "Kanto"));
  regionSel.addEventListener("change", () => {
    region = regionSel.value;
    void render();
  });
  const modeSel = h("select", {}, h("option", { value: "move" }, "Move the selected place"), h("option", { value: "paint" }, "Paint tiles"));
  modeSel.addEventListener("change", () => {
    mode = modeSel.value as "move" | "paint";
    void render();
  });
  const revert = h("button", { class: "btn small danger", title: "The game's map tiles for this region" }, "Back to the game's map");
  revert.addEventListener("click", () => {
    const s = spec();
    if (!s) return;
    store.revertRecord(s.grids, region, `Town Map ${region}: the game's`);
    store.seal();
  });
  center.append(
    h("div", { class: "panel-head" }, h("span", { class: "head-title" }, "Town Map"), h("div", { class: "row nowrap" }, h("label", { class: "inline-check" }, placesToggle, "Show places"), regionSel, modeSel, revert)),
    h("div", { class: "ws-scroll" }, h("div", { class: "townmap-wrap" }, canvas), status, palette),
  );
  const side = h("div", { class: "ws-scroll" });
  right.append(h("div", { class: "panel-head" }, h("span", {}, "Place")), side);

  let sheet: HTMLCanvasElement | null = null;
  let sheetUrl = "";
  // the gray sheet with each tile in its palette (Pokegear:colorsFor)
  const colorSheet = (img: HTMLImageElement): HTMLCanvasElement => {
    const c = h("canvas", { width: img.width, height: img.height });
    const g = c.getContext("2d")!;
    g.drawImage(img, 0, 0);
    const colors = spec()?.colors(store.ctx);
    if (!colors) return c;
    const per = Math.floor(img.width / TILE);
    for (let t = 0; t < per * Math.floor(img.height / TILE); t++) {
      const pal = colors.palettes[t >= colors.fontFrom ? 0 : (colors.palMap[t] ?? 1) - 1] ?? colors.palettes[0];
      if (!pal) continue;
      const x = (t % per) * TILE;
      const y = Math.floor(t / per) * TILE;
      const data = g.getImageData(x, y, TILE, TILE);
      tintPixels(data.data, pal as Rgb[]);
      g.putImageData(data, x, y);
    }
    return c;
  };
  const grid = () => (spec() ? (store.table(spec()!.grids)[region] as number[] | undefined) : undefined) ?? [];

  const render = async () => {
    const s = spec();
    if (!s) return;
    regionSel.value = region;
    modeSel.value = mode;
    const url = store.project.host.imageUrl(store.project.version, s.sheet);
    if (url !== sheetUrl) {
      sheetUrl = url;
      const img = await loadImage(url);
      sheet = img ? colorSheet(img) : null;
    }
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const per = sheet ? Math.floor(sheet.width / TILE) : 16;
    const Z = ZOOM * TILE;
    grid().forEach((t, i) => {
      if (!sheet || typeof t !== "number") return;
      ctx.drawImage(sheet, (t % per) * TILE, Math.floor(t / per) * TILE, TILE, TILE, (i % COLS) * Z, Math.floor(i / COLS) * Z, Z, Z);
    });
    // the places of this region (editor marks, not game art)
    if (showPlaces || mode === "move") {
      for (const [id, l] of Object.entries(landmarks())) {
        if (regionOf(id) !== region || typeof l.x !== "number" || typeof l.y !== "number") continue;
        if (!showPlaces && id !== current) continue;
        placeMarker(ctx, (l.x + 0.5) * ZOOM, (l.y + 0.5) * ZOOM, id === current);
      }
    }
    revert.hidden = !store.isRecordEdited(s.grids, region);
    status.textContent = mode === "move"
      ? current ? "Click the map to put the selected place there." : "Pick a place on the left (or click its dot), then click where it goes."
      : `Click or drag to paint tile ${tile}.`;
    // the tile sheet to paint with
    palette.replaceChildren();
    if (mode === "paint" && sheet) {
      const count = per * Math.floor(sheet.height / TILE);
      for (let t = 0; t < count; t++) {
        const c = h("canvas", { class: `townmap-tile${t === tile ? " active" : ""}`, width: TILE, height: TILE, title: `Tile ${t}`, onclick: () => { tile = t; void render(); } });
        c.getContext("2d")!.drawImage(sheet, (t % per) * TILE, Math.floor(t / per) * TILE, TILE, TILE, 0, 0, TILE, TILE);
        palette.append(c);
      }
    }
    renderSide();
  };

  const renderSide = () => {
    side.replaceChildren();
    const s = spec();
    const l = current ? landmarks()[current] : undefined;
    if (!s || !current || !l) {
      side.append(h("p", { class: "hint empty" }, "Pick a place."));
      return;
    }
    const id = current;
    const edit = (label: string, mutate: (d: Landmark) => void) => {
      store.editRecord<Landmark>(s.landmarks, id, label, mutate);
      store.seal();
    };
    const name = h("textarea", { rows: 2, spellcheck: false }, String(l.name ?? ""));
    name.addEventListener("change", () => {
      const lines = name.value.toUpperCase().split("\n").slice(0, 2).map((x) => x.slice(0, s.nameMax));
      edit("Place name", (d) => (d.name = lines.join("\n")));
    });
    const base = store.baseTable(s.landmarks)[id] as Landmark | undefined;
    side.append(
      field("Name", name, `Two lines of up to ${s.nameMax} letters, as the Pokégear shows it.`),
      h("div", { class: "row two" },
        field("x", numberInput(Number(l.x ?? 0), (v) => edit("Place spot", (d) => (d.x = v)), 0, COLS * TILE - 1)),
        field("y", numberInput(Number(l.y ?? 0), (v) => edit("Place spot", (d) => (d.y = v)), 0, ROWS * TILE - 1))),
      h("p", { class: "hint" }, `${regionOf(id) === "kanto" ? "Kanto" : "Johto"} map. The Fly map and the town map show it at this spot.`),
      ...(base && !deepEqual(base, l) ? [h("button", { class: "btn small danger", onclick: () => (store.revertRecord(s.landmarks, id, `${id}: the game's`), store.seal()) }, "Back to the game's place")] : []),
    );
  };

  // clicks: move the selected place, pick a place by its dot, or paint
  let painting = false;
  const at = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    return { px: Math.floor(((e.clientX - r.left) / r.width) * COLS * TILE), py: Math.floor(((e.clientY - r.top) / r.height) * ROWS * TILE) };
  };
  const paint = (px: number, py: number) => {
    const s = spec();
    if (!s) return;
    const i = Math.floor(py / TILE) * COLS + Math.floor(px / TILE);
    if (grid()[i] === tile) return;
    store.editRecord<number[]>(s.grids, region, `Town Map ${region}: paint`, (d) => (d[i] = tile), { merge: true });
  };
  canvas.addEventListener("pointerdown", (e) => {
    const s = spec();
    if (!s) return;
    const { px, py } = at(e);
    if (mode === "paint") {
      painting = true;
      canvas.setPointerCapture(e.pointerId);
      paint(px, py);
      return;
    }
    // a dot under the click selects its place
    const hit = !showPlaces ? undefined : Object.entries(landmarks()).find(([id, l]) => regionOf(id) === region && Math.abs(Number(l.x) - px) <= 3 && Math.abs(Number(l.y) - py) <= 3)?.[0];
    if (hit && hit !== current) {
      current = hit;
      list.render();
      void render();
      return;
    }
    if (current && regionOf(current) === region) {
      store.editRecord<Landmark>(s.landmarks, current, "Place spot", (d) => ((d.x = px), (d.y = py)));
      store.seal();
    }
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!painting) return;
    const { px, py } = at(e);
    paint(px, py);
  });
  canvas.addEventListener("pointerup", () => {
    if (painting) store.seal();
    painting = false;
  });

  store.on((reason, _id, registry) => {
    if (reason === "project") current = null;
    const s = spec();
    if (!s) return;
    if (reason === "project" || (reason === "content" && (registry === s.landmarks || registry === s.grids))) void render();
  });
  return { shown: () => void render(), open: () => void render() };
}
