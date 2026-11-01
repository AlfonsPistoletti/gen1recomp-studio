// Gold's Pokédex footprints, per species (Pokémon workspace). The game draws a
// species' 16x16 footprint from one strip of the player's imported art; a mod
// keeps only its own: `studio_footprints` species -> { pixels } (256 "0"/"1",
// 1 = ink, row by row) or { copy } (another species' footprint in the game).
// The asset recipe builds the strip (game rows + the mod's below them, in
// sorted id order, footprintSheets) and the helper points the Pokédex at it
// (src/lua/footprintRuntime2.ts). No ROM pixels go into a mod: a drawing equal
// to one of the game's footprints is kept as a copy of it.

import { assetUrl, type SheetRecipe } from "../core/assets.ts";
import { store } from "../core/store.ts";
import { FEATURES } from "../features.ts";
import { loadImage } from "../render/graphics.ts";
import { importArt } from "./artImport.ts";
import { comboInput, h, toast } from "./dom.ts";
import { FOOTPRINT_SHEET, FOOTPRINT_SIZE, footprintRecord, footprintTiles, type Footprint } from "../games/gen2/footprints.ts";

const SHEET = FOOTPRINT_SHEET;
const SIZE = FOOTPRINT_SIZE;
const BLANK = "0".repeat(SIZE * SIZE);

const registry = () => (FEATURES.gen2 && store.project ? store.adapter.pokemon?.footprints?.registry : undefined);
const order = () => (store.ctx.data.extra.footprintOrder as string[] | undefined) ?? [];
const prints = () => (registry() ? (store.table(registry()!) as Record<string, Footprint>) : {});

// the game's footprints, one 256-char string per row of the player's strip
let game: { version: string; rows: string[] } | null = null;
async function gameRows(): Promise<string[]> {
  const version = store.project.version;
  if (game?.version === version) return game.rows;
  const img = await loadImage(assetUrl(store.project.host, version, `assets/generated/${SHEET}`));
  const rows: string[] = [];
  if (img) {
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    const px = ctx.getImageData(0, 0, c.width, c.height).data;
    for (let r = 0; r < Math.floor(img.height / SIZE); r++) {
      let s = "";
      // the strip holds the print white on black
      for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) s += px[((r * SIZE + y) * c.width + x) * 4] >= 128 ? "1" : "0";
      rows.push(s);
    }
  }
  game = { version, rows };
  return rows;
}

// what a species' footprint looks like now (its own, a copy, the game's, else blank)
function pixelsOf(species: string, rows: string[]): string {
  const p = prints()[species];
  if (p?.pixels) return p.pixels;
  const from = p?.copy ?? species;
  return rows[order().indexOf(from)] ?? BLANK;
}

function save(species: string, label: string, rec: Footprint | undefined): void {
  const reg = registry();
  if (!reg) return;
  store.setRecord(reg, species, label, rec);
  store.seal();
}

// The recipe's sheet: the player's strip with the mod's footprints below it
export function footprintSheets(): SheetRecipe[] {
  if (!registry() || !Object.keys(prints()).length) return [];
  return [{ source: SHEET, out: `studio/${SHEET}`, per: 2, tiles: footprintTiles(prints(), order()) }];
}

// The Footprint card's content for a species (Gold), or null for games without
export function footprintRow(species: string): HTMLElement | null {
  if (!registry()) return null;
  const SCALE = 8;
  const canvas = h("canvas", { width: SIZE * SCALE, height: SIZE * SCALE, class: "footprint-grid", title: "Left button draws, right button erases" }) as HTMLCanvasElement;
  canvas.style.cursor = "crosshair";
  canvas.style.imageRendering = "pixelated";
  const box = h("div", { class: "footprint" }, canvas);
  let rows: string[] = [];
  let px = BLANK;
  const draw = () => {
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#000";
    for (let i = 0; i < px.length; i++) if (px[i] === "1") ctx.fillRect((i % SIZE) * SCALE, Math.floor(i / SIZE) * SCALE, SCALE, SCALE);
    ctx.strokeStyle = "rgba(128,128,128,0.25)";
    for (let k = 1; k < SIZE; k++) {
      ctx.beginPath();
      ctx.moveTo(k * SCALE + 0.5, 0);
      ctx.lineTo(k * SCALE + 0.5, canvas.height);
      ctx.moveTo(0, k * SCALE + 0.5);
      ctx.lineTo(canvas.width, k * SCALE + 0.5);
      ctx.stroke();
    }
  };
  const commit = (label: string, next: string) => save(species, label, footprintRecord(species, next, rows, order()));
  // drawing: left button the print, right button erases; one stroke, one undo step
  let ink: string | null = null;
  const cellAt = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * SIZE);
    const y = Math.floor(((e.clientY - r.top) / r.height) * SIZE);
    return x >= 0 && y >= 0 && x < SIZE && y < SIZE ? y * SIZE + x : -1;
  };
  const paint = (e: PointerEvent) => {
    const i = cellAt(e);
    if (i < 0 || ink === null || px[i] === ink) return;
    px = px.slice(0, i) + ink + px.slice(i + 1);
    draw();
  };
  canvas.addEventListener("pointerdown", (e) => {
    const i = cellAt(e);
    if (i < 0) return;
    ink = e.button === 2 ? "0" : "1";
    canvas.setPointerCapture(e.pointerId);
    paint(e);
  });
  canvas.addEventListener("pointermove", (e) => ink !== null && paint(e));
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  canvas.addEventListener("pointerup", () => {
    if (ink === null) return;
    ink = null;
    commit("Draw footprint", px);
  });

  const others = () => order().filter((s) => s !== species);
  const same = comboInput("", "dl-footprint-species", others(), (v) => {
    if (!order().includes(v)) return;
    const rec = order().indexOf(species) >= 0 && v === species ? undefined : { copy: v };
    save(species, "Footprint like another", rec);
  });
  same.placeholder = "Same as…";
  same.title = "Use another species' footprint from the game";
  const importBtn = h("button", {
    class: "btn small",
    title: "A 16×16 picture; dark pixels become the print",
    onclick: async () => {
      const res = await importArt({ label: "Footprint", width: SIZE, height: SIZE, align: "center" }, { trueColor: false });
      if (!res) return;
      const url = URL.createObjectURL(new Blob([res.data as Uint8Array<ArrayBuffer>], { type: "image/png" }));
      const img = await loadImage(url);
      URL.revokeObjectURL(url);
      if (!img) return void toast("Could not read the picture", "error");
      const c = document.createElement("canvas");
      c.width = c.height = SIZE;
      const ctx = c.getContext("2d")!;
      ctx.drawImage(img, 0, 0, SIZE, SIZE);
      const d = ctx.getImageData(0, 0, SIZE, SIZE).data;
      let s = "";
      for (let i = 0; i < SIZE * SIZE; i++) s += d[i * 4] < 128 ? "1" : "0";
      commit("Import footprint", s);
    },
  }, "Import…");
  const clearBtn = h("button", { class: "btn small ghost", title: "An empty footprint (some Pokémon leave none)", onclick: () => commit("Clear footprint", BLANK) }, "Clear");
  const own = prints()[species];
  const isGame = order().includes(species);
  // always there (disabled when it has nothing to undo): the row must not move under the pointer
  const back = isGame ? h("button", { class: "btn small danger", disabled: !own, onclick: () => save(species, "Back to the game's footprint", undefined) }, "Back to the game's") : null;
  const note = h("p", { class: "hint" },
    own?.copy ? `Same as ${own.copy}'s.` : own ? "Drawn for your mod." : isGame ? "The game's footprint." : "No footprint yet: draw one, import one, or use another's.");
  void gameRows().then((r) => {
    rows = r;
    px = pixelsOf(species, rows);
    draw();
  });
  draw();
  return h("div", {},
    h("div", { class: "row" }, box, h("div", { class: "col" }, note, same, h("div", { class: "row wrap" }, importBtn, clearBtn, back))),
    h("p", { class: "hint" }, "Shown on the Pokédex page. 16×16, black and white."));
}
