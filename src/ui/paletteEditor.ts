// Graphics > Palettes: the Game Boy palettes (4 colors each, lightest first)
// the game colors maps, Pokémon and screens with. A map uses the palette its
// properties name (or the one the game picks for it); a mod can recolor any
// palette or add new ones for its maps. RED++ uses its own colors instead.

import { clone } from "../core/merge.ts";
import { store } from "../core/store.ts";
import { liveTileset, tilesetKey, tilesetUrl } from "../core/tilesets.ts";
import { atlasRect, blockAtlas, BLOCK } from "../render/graphics.ts";
import type { Rgb } from "../render/color.ts";
import { clear, h, toast } from "./dom.ts";
import { mountRecordList } from "./recordList.ts";
import { nav } from "./nav.ts";

const REG = "palettes";
// what each game palette is for
const MAP_PALETTES = ["ROUTE", "PALLET", "VIRIDIAN", "PEWTER", "CERULEAN", "LAVENDER", "VERMILION", "CELADON", "FUCHSIA", "CINNABAR", "INDIGO", "SAFFRON", "CAVE"];
const SHADE_LABELS = ["Lightest (white in the art)", "Light gray", "Dark gray", "Darkest (black in the art)"];
const NAME_RE = /^[A-Z][A-Z0-9_]*$/;

type Palette = Rgb[];
const table = () => store.table(REG) as Record<string, Palette>;
const isBase = (name: string) => store.baseTable(REG)[name] !== undefined;

function kindOf(name: string): string {
  if (!isBase(name)) return "yours";
  if (MAP_PALETTES.includes(name)) return "map";
  if (name.endsWith("MON")) return "Pokémon";
  return "screen";
}

const hex = (c: Rgb) => `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
const rgbOf = (v: string): Rgb => [1, 3, 5].map((k) => parseInt(v.slice(k, k + 2), 16)) as Rgb;

// maps that render with a palette (named in their properties, or picked)
function mapsWith(name: string): string[] {
  return Object.keys(store.maps).filter((m) => store.palettes[m] === name).sort();
}

export function mountPaletteWorkspace(left: HTMLElement, center: HTMLElement, right: HTMLElement): void {
  let current: string | null = null;
  // the map the preview draws (null: one that uses the palette, outdoor first)
  let previewMap: string | null = null;
  const newBtn = h("button", { class: "btn small", title: "A new palette, starting as a copy of the selected one", onclick: () => newPalette() }, "+ New");
  const list = mountRecordList(left, {
    title: "Palettes",
    head: [newBtn],
    placeholder: "Search palettes…",
    searchId: "palettes-search",
    items: () =>
      Object.keys(table())
        .sort((a, b) => ["yours", "map", "Pokémon", "screen"].indexOf(kindOf(a)) - ["yours", "map", "Pokémon", "screen"].indexOf(kindOf(b)) || a.localeCompare(b))
        .map((name) => ({ id: name, label: name, meta: kindOf(name), edited: isBase(name) && store.isRecordEdited(REG, name), isNew: !isBase(name) })),
    current: () => current,
    pick: (name) => open(name),
    refreshOn: (reason, _id, registry) => reason === "content" && registry === REG,
  });

  const title = h("span", { class: "head-title" }, "Palettes");
  const main = h("div", { class: "ws-scroll" });
  const side = h("div", { class: "ws-scroll" });
  center.append(h("div", { class: "panel-head" }, title), main);
  right.append(h("div", { class: "panel-head" }, h("span", {}, "Used by")), side);

  const open = (name: string) => {
    if (!table()[name]) return;
    current = name;
    list.render();
    void render();
  };
  nav.openPalette = (name) => {
    nav.setWorkspace("graphics");
    nav.showGraphics("palettes");
    open(name);
  };

  const setColor = (name: string, i: number, c: Rgb) => {
    store.editRecord<Palette>(REG, name, `${name}: color ${i + 1}`, (d) => {
      d[i] = c;
    });
    store.seal();
  };

  // a map drawn in the palette (the first map that uses it, or Pallet Town)
  let token = 0;
  const preview = async (name: string, holder: HTMLElement) => {
    const my = ++token;
    // an outdoor map shows a palette best
    const users = mapsWith(name);
    const mapId = (previewMap && store.maps[previewMap] ? previewMap : null)
      ?? users.find((m) => store.maps[m]?.tileset === "OVERWORLD") ?? users[0] ?? (store.maps.PALLET_TOWN ? "PALLET_TOWN" : Object.keys(store.maps)[0]);
    const map = store.maps[mapId];
    const ts = map ? liveTileset(map.tileset) : undefined;
    if (!map || !ts) return;
    const colorsFor = store.adapter.tileColors(store.ctx, ts, name);
    const atlas = await blockAtlas(ts, await tilesetUrl(map.tileset), `${name}#preview${JSON.stringify(table()[name])}`, colorsFor, tilesetKey(map.tileset));
    if (my !== token) return;
    const c = h("canvas", { class: "palette-preview" });
    c.width = map.width * BLOCK;
    c.height = map.height * BLOCK;
    const ctx = c.getContext("2d")!;
    map.blocks.forEach((b, i) => {
      if (b >= atlas.count) return;
      const [sx, sy] = atlasRect(b);
      ctx.drawImage(atlas.canvas, sx, sy, BLOCK, BLOCK, (i % map.width) * BLOCK, Math.floor(i / map.width) * BLOCK, BLOCK, BLOCK);
    });
    holder.replaceChildren(c, h("p", { class: "hint" }, `${mapId}${users.includes(mapId) ? "" : " (doesn't use it: shown as an example)"}`));
  };

  // which map to preview: the ones using the palette first, then all others
  const previewPicker = (name: string): HTMLElement => {
    const users = mapsWith(name);
    const others = Object.keys(store.maps).filter((m) => !users.includes(m)).sort();
    const sel = h("select", { title: "The map the preview draws in this palette" },
      h("option", { value: "", selected: !previewMap }, "Preview on: a map that uses it"),
      users.length ? h("optgroup", { label: "Uses this palette" }, ...users.map((m) => h("option", { value: m, selected: previewMap === m }, m))) : null,
      h("optgroup", { label: "Other maps" }, ...others.map((m) => h("option", { value: m, selected: previewMap === m }, m))),
    );
    sel.addEventListener("change", () => {
      previewMap = sel.value || null;
      void render();
    });
    return sel;
  };

  const render = async () => {
    clear(main);
    clear(side);
    const name = current;
    if (!name || !table()[name]) {
      title.textContent = "Palettes";
      main.append(h("p", { class: "hint empty" }, "Pick a palette on the left."));
      return;
    }
    title.textContent = name;
    const pal = table()[name];
    const swatches = pal.map((c, i) => {
      const input = h("input", { type: "color", value: hex(c) });
      input.addEventListener("change", () => setColor(name, i, rgbOf(input.value)));
      return h("label", { class: "palette-swatch" }, input, h("span", { class: "hint" }, SHADE_LABELS[i]));
    });
    const holder = h("div", { class: "palette-preview-box" }, h("p", { class: "hint" }, "Drawing…"));
    main.append(
      h("div", { class: "card" },
        h("div", { class: "card-head" }, h("h4", {}, "Colors"), h("span", { class: "hint" }, kindOf(name) === "yours" ? "Your palette" : `The game's ${kindOf(name)} palette`)),
        h("div", { class: "palette-swatches" }, ...swatches),
        h("p", { class: "hint" }, "The game's art has 4 shades; each takes one of these colors. In the RED++ color mode the game uses its own colors instead (Graphics > Tilesets, RED++)."),
        isBase(name) && store.isRecordEdited(REG, name)
          ? h("button", { class: "btn small danger", onclick: () => store.revertRecord(REG, name, `${name}: the game's colors`) }, "Back to the game's colors")
          : null,
      ),
      h("div", { class: "card" },
        h("div", { class: "card-head" }, h("h4", {}, "Preview"), previewPicker(name)),
        holder,
      ),
    );
    void preview(name, holder);
    const users = mapsWith(name);
    side.append(
      h("div", { class: "card" },
        h("h4", {}, `${users.length} map${users.length === 1 ? "" : "s"}`),
        users.length
          ? h("div", { class: "row wrap" }, ...users.slice(0, 60).map((m) => h("button", { class: "btn small ghost", onclick: () => nav.openMap(m) }, m)), users.length > 60 ? h("span", { class: "hint" }, `+${users.length - 60} more`) : null)
          : h("p", { class: "hint" }, "No map uses it. A map picks its palette in its properties (Palette)."),
      ),
      ...(isBase(name) ? [] : [h("button", {
            class: "btn small danger",
            disabled: users.some((m) => store.maps[m]?.palette === name),
            title: "Maps that name it must pick another palette first",
            onclick: () => {
              store.setRecord(REG, name, `Delete ${name}`, undefined);
              store.seal();
              current = null;
              void render();
            },
          }, "Delete palette")]),
    );
  };

  const newPalette = () => {
    if (!store.project?.mod) return toast("Open a mod first: a new palette is saved into it.", "error");
    const raw = prompt("Name of the new palette (A-Z, 0-9, _), e.g. MY_TOWN:");
    if (!raw) return;
    const name = raw.trim().toUpperCase().replace(/\s+/g, "_");
    if (!NAME_RE.test(name)) return toast("A palette name uses A-Z, 0-9 and _ and starts with a letter", "error");
    if (table()[name]) return toast(`${name} already exists`, "error");
    const from = current && table()[current] ? table()[current] : table().ROUTE;
    store.setRecord(REG, name, `New palette ${name}`, clone(from));
    store.seal();
    open(name);
    toast(`${name}: a copy of ${current ?? "ROUTE"}. Pick it in a map's properties (Palette).`, "ok");
  };

  let queued = false;
  store.on((reason, id, registry) => {
    if (reason === "project") current = current && table()[current] ? current : "ROUTE";
    if (!(reason === "project" || (reason === "content" && (registry === REG || registry === "maps")) || reason === "edit") || queued) {
      if (reason === "reveal" && registry === REG && id) nav.openPalette(id);
      return;
    }
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      if (nav.workspace === "graphics" && nav.graphicsView === "palettes") void render();
    });
  });
  nav.onPalettesShown = () => void render();
}
