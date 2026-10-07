// Graphics > Palettes: the Game Boy palettes (4 colors each, lightest first)
// the game colors maps, Pokémon and screens with. A map uses the palette its
// properties name (or the one the game picks for it); a mod can recolor any
// palette or add new ones for its maps. RED++ uses its own colors instead.

import { clone } from "../core/merge.ts";
import { store } from "../core/store.ts";
import { liveTileset, tilesetKey, tilesetUrl } from "../core/tilesets.ts";
import { atlasRect, blockAtlas, loadImage, tintPixels, BLOCK } from "../render/graphics.ts";
import { cacheImages } from "./imageEditor.ts";
import { spriteUrl as pokemonArtUrl } from "./pokemonEditor.ts";
import type { Rgb } from "../render/color.ts";
import { clear, h, toast } from "./dom.ts";
import { mountRecordList } from "./recordList.ts";
import { nav } from "./nav.ts";

const REG = "palettes";
// what each game palette is for
const MAP_PALETTES = ["ROUTE", "PALLET", "VIRIDIAN", "PEWTER", "CERULEAN", "LAVENDER", "VERMILION", "CELADON", "FUCHSIA", "CINNABAR", "INDIGO", "SAFFRON", "CAVE"];
const SHADE_LABELS = ["Lightest (white in the art)", "Light gray", "Dark gray", "Darkest (black in the art)"];
const NAME_RE = /^[A-Z][A-Z0-9_]*$/;
// the screen a game palette colors (pokered SGB palettes), for its preview
const SCREEN_IMAGE: Record<string, string> = {
  TOWNMAP: "townmap/tiles.png",
  LOGO1: "title/pokemon_logo.png",
  LOGO2: "title/pokemon_logo.png",
  SLOTS1: "slots/red_slots_1.png",
  SLOTS2: "slots/red_slots_2.png",
  SLOTS3: "slots/symbols.png",
  SLOTS4: "slots/symbols.png",
  BADGE: "trainer_card/badges.png",
  GAMEFREAK: "intro/gamefreak_logo.png",
  GREENBAR: "battle/battle_hud_1.png",
  YELLOWBAR: "battle/battle_hud_1.png",
  REDBAR: "battle/battle_hud_1.png",
  BLACK: "credits/the_end.png",
};

// a gray image in the palette's 4 colors (lightest first), clear stays clear
async function recolor(url: string, pal: Rgb[], zoom: number): Promise<HTMLCanvasElement | null> {
  const img = await loadImage(url);
  if (!img) return null;
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, c.width, c.height);
  tintPixels(data.data, pal);
  ctx.putImageData(data, 0, 0);
  const out = document.createElement("canvas");
  out.width = c.width * zoom;
  out.height = c.height * zoom;
  out.className = "palette-preview";
  const octx = out.getContext("2d")!;
  octx.imageSmoothingEnabled = false;
  octx.drawImage(c, 0, 0, out.width, out.height);
  return out;
}

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
  // the Pokémon / game image the preview shows (null: one the palette colors)
  let previewMon: string | null = null;
  let previewImage: string | null = null;
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
  // species whose battle pictures a palette colors (their own `palette`, else
  // the game's species -> palette table)
  const monsWith = (name: string): string[] => {
    const byGame = ((store.project.data.extra.palettes as { pokemon?: Record<string, string> } | undefined)?.pokemon) ?? {};
    const all = store.table("pokemon") as Record<string, { palette?: unknown; dex?: number }>;
    return Object.keys(all)
      .filter((id) => (typeof all[id]?.palette === "string" ? all[id].palette : byGame[id] ?? "MEWMON") === name)
      .sort((a, b) => (all[a]?.dex ?? 999) - (all[b]?.dex ?? 999));
  };

  const preview = async (name: string, holder: HTMLElement) => {
    const kind = kindOf(name);
    if (kind === "Pokémon") return previewPokemon(name, holder);
    if (kind === "screen") return previewScreen(name, holder);
    return previewOnMap(name, holder);
  };

  const previewPokemon = async (name: string, holder: HTMLElement) => {
    const my = ++token;
    const all = store.table("pokemon") as Record<string, Record<string, unknown>>;
    const users = monsWith(name);
    const id = previewMon && all[previewMon] ? previewMon : users[0] ?? Object.keys(all)[0];
    const rec = all[id];
    const spec = store.adapter.pokemon;
    if (!rec || !spec) return;
    const pal = table()[name];
    const [front, back] = await Promise.all([
      recolor(pokemonArtUrl(spec.frontSprite(rec)), pal, 3),
      // a 32x32 back is drawn doubled in battle, like the game does
      loadImage(pokemonArtUrl(spec.backSprite(rec))).then((img) => recolor(pokemonArtUrl(spec.backSprite(rec)), pal, img && img.width <= 32 ? 6 : 3)),
    ]);
    if (my !== token) return;
    holder.replaceChildren(
      h("div", { class: "row wrap palette-mon" },
        front ? h("div", {}, front, h("p", { class: "hint" }, "Front")) : null,
        back ? h("div", {}, back, h("p", { class: "hint" }, "Back")) : null,
      ),
      h("p", { class: "hint" }, `${String(rec.name ?? id)}${users.includes(id) ? "" : " (doesn't use it: shown as an example)"}`),
    );
  };

  const previewScreen = async (name: string, holder: HTMLElement) => {
    const my = ++token;
    const rel = previewImage ?? SCREEN_IMAGE[name] ?? "title/pokemon_logo.png";
    const url = store.project.host.imageUrl(store.project.version, `assets/generated/${rel}`);
    const img = await recolor(url, table()[name], 3);
    if (my !== token) return;
    holder.replaceChildren(
      img ?? h("p", { class: "hint warn" }, `${rel} isn't in this version's imported files.`),
      h("p", { class: "hint" }, `${rel}${SCREEN_IMAGE[name] === rel ? "" : " (shown as an example)"}`),
    );
  };

  const previewOnMap = async (name: string, holder: HTMLElement) => {
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

  // which Pokémon to preview: the ones the palette colors first
  const monPicker = (name: string): HTMLElement => {
    const all = store.table("pokemon") as Record<string, { name?: unknown; dex?: number }>;
    const users = monsWith(name);
    const others = Object.keys(all).filter((m) => !users.includes(m)).sort((a, b) => (all[a]?.dex ?? 999) - (all[b]?.dex ?? 999));
    const label = (id: string) => String(all[id]?.name ?? id);
    const sel = h("select", { title: "The Pokémon the preview shows in this palette" },
      h("option", { value: "", selected: !previewMon }, "Preview on: a Pokémon that uses it"),
      users.length ? h("optgroup", { label: "Uses this palette" }, ...users.map((m) => h("option", { value: m, selected: previewMon === m }, label(m)))) : null,
      h("optgroup", { label: "Other Pokémon" }, ...others.map((m) => h("option", { value: m, selected: previewMon === m }, label(m)))),
    );
    sel.addEventListener("change", () => {
      previewMon = sel.value || null;
      void render();
    });
    return sel;
  };

  // which game image to preview: the palette's own screen, or any other
  const imagePicker = (name: string): HTMLElement => {
    const sel = h("select", { title: "The game image the preview shows in this palette" },
      h("option", { value: "", selected: !previewImage }, `Preview on: ${SCREEN_IMAGE[name] ?? "the title logo"}`),
    );
    const spec = store.adapter.images;
    if (spec) {
      void cacheImages(spec).then((files) => {
        for (const f of files) sel.append(h("option", { value: f, selected: previewImage === f }, f));
      });
    }
    sel.addEventListener("change", () => {
      previewImage = sel.value || null;
      void render();
    });
    return sel;
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
        h("div", { class: "card-head" }, h("h4", {}, "Preview"), kindOf(name) === "Pokémon" ? monPicker(name) : kindOf(name) === "screen" ? imagePicker(name) : previewPicker(name)),
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
