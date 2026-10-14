// Pokémon workspace: species list (left), stats/evolutions/moves and TM/HM
// (center), Pokédex entry and cry (right). Edits go to the "pokemon" registry (and
// the dex text to "text"); a save writes only the changed fields.

import { addAsset, assetUrl, derivedPath, isCachePath } from "../core/assets.ts";
import { clone } from "../core/merge.ts";
import { canDerive } from "../core/reuse.ts";
import { store } from "../core/store.ts";
import type { PokemonSpec } from "../games/types.ts";
import { importArt, placeholderArt } from "./artImport.ts";
import { clear, comboInput, field, h, numberInput, rerender, selectInput, onFocusLeave, toast } from "./dom.ts";
import { colorSelect, defaultView, monPaletteName, paletteField, picColors } from "./picColors.ts";
import { loadImage, showTinted } from "../render/graphics.ts";
import type { Rgb } from "../render/color.ts";
import { promptNewRecord } from "./newRecord.ts";
import { nav } from "./nav.ts";
import { idRow } from "./renameId.ts";
import { cryCard, cryFor } from "./cryCard.ts";
import { mountRecordList } from "./recordList.ts";
import { sortMenu, type SortOption, type SortState } from "./sortMenu.ts";
import { textEditor } from "./textField.ts";

type Rec = Record<string, unknown>;
type Evolution = { method?: string; level?: number; item?: string; [k: string]: unknown };
type LearnEntry = { level: number; move: string };

const REG = "pokemon";

// a sprite path as a URL: vanilla art from the dataset, a mod's from the
// game folder, freshly imported art from memory until saved
export function spriteUrl(path: string | undefined): string {
  return assetUrl(store.project.host, store.project.version, path);
}

// the Colors choice at the top (null: RED++ while the map view shows RED++,
// else each Pokémon's own palette)
let view: string | null = null;

// the colors a species' battle pics are shown in (lightest first; null: as drawn)
function monColors(id: string, r: Rec): Rgb[] | null {
  const own = store.adapter.pokemon?.monColors;
  if (own) return r.trueColor === true ? null : own(store.ctx, id);
  return picColors(view ?? defaultView(), (redpp) => monPaletteName(id, r, redpp), r.trueColor === true);
}

// record keys that differ by generation (PokemonSpec.keys)
function keys(spec: PokemonSpec | undefined) {
  const k = spec?.keys;
  return {
    levelMoves: k?.levelMoves ?? "learnset",
    startMoves: k?.startMoves === undefined ? "level1Moves" : k.startMoves,
    into: k?.evolveInto ?? "species",
    picSize: k?.picSize ?? "frontSize",
  };
}
const lacks = (spec: PokemonSpec | undefined, what: NonNullable<PokemonSpec["without"]>[number]) => !!spec?.without?.includes(what);

// a battle pic in the chosen colors
function pic(path: string | undefined, pal: Rgb[] | null, attrs: Record<string, unknown>): HTMLImageElement {
  return showTinted(h("img", { alt: "", ...attrs }), spriteUrl(path), pal);
}

function species(): Record<string, Rec> {
  return store.table(REG) as Record<string, Rec>;
}

function dexOrder(): string[] {
  const all = species();
  return Object.keys(all).sort((a, b) => ((all[a].dex as number) ?? 999) - ((all[b].dex as number) ?? 999) || a.localeCompare(b));
}

// the list's sort choices: dex orders, name, type, each base stat and the total
function sortOptions(): SortOption[] {
  // also asked before a project is open (the button is built at start)
  const spec = store.project ? store.adapter.pokemon : undefined;
  const regional = spec?.regionalDex;
  return [
    { id: "dex", label: regional ? "National dex" : "Dex number", group: "Order" },
    ...(regional ? [{ id: "regional", label: regional.label, group: "Order" }] : []),
    { id: "name", label: "Name", group: "Order" },
    { id: "type", label: "Type", group: "Order" },
    ...(spec?.stats ?? []).map((st) => ({ id: `stat:${st.key}`, label: st.label, group: "Base stats", desc: true })),
    { id: "total", label: "Total", group: "Base stats", desc: true },
  ];
}

const statOf = (r: Rec, key: string) => Number((r.baseStats as Rec | undefined)?.[key]) || 0;
const totalOf = (r: Rec) => (store.adapter?.pokemon?.stats ?? []).reduce((n, st) => n + statOf(r, st.key), 0);

// species ids in the chosen order (ties: dex order), and what the list's
// right column shows for each
function sortedSpecies(sort: SortState): { ids: string[]; meta(id: string): string } {
  const all = species();
  const dex = dexOrder();
  const rank = new Map(dex.map((id, i) => [id, i]));
  const dexMeta = (id: string) => `#${String(all[id].dex ?? "?").padStart(3, "0")}`;
  let value: (id: string) => number | string;
  let meta = dexMeta;
  if (sort.id === "regional") {
    const order = store.adapter.pokemon?.regionalDex?.order(store.ctx) ?? [];
    const at = new Map(order.map((id, i) => [id, i]));
    value = (id) => at.get(id) ?? 9999;
    meta = (id) => (at.has(id) ? `#${String(at.get(id)! + 1).padStart(3, "0")}` : "—");
  } else if (sort.id === "name") value = (id) => String(all[id].name ?? id);
  else if (sort.id === "type") {
    const types = (id: string) => [...new Set((all[id].types as string[] | undefined) ?? [])];
    value = (id) => types(id).join(" ");
    meta = (id) => types(id).map((t) => t.replace(/_TYPE$/, "").slice(0, 3)).join("/");
  } else if (sort.id === "total") {
    value = (id) => totalOf(all[id]);
    meta = (id) => String(totalOf(all[id]));
  } else if (sort.id.startsWith("stat:")) {
    const key = sort.id.slice(5);
    value = (id) => statOf(all[id], key);
    meta = (id) => String(statOf(all[id], key));
  } else value = (id) => rank.get(id) ?? 9999;
  const dir = sort.desc ? -1 : 1;
  const ids = [...dex].sort((a, b) => {
    const va = value(a);
    const vb = value(b);
    const c = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb));
    return c * dir || (rank.get(a) ?? 0) - (rank.get(b) ?? 0);
  });
  return { ids, meta };
}

export function mountPokemonWorkspace(left: HTMLElement, center: HTMLElement, right: HTMLElement): void {
  let current: string | null = null;
  const sort = sortMenu("pokemon", sortOptions, () => list.render());

  const newBtn = h("button", { class: "btn small", title: "Add a Pokémon, starting as a copy of one", onclick: () => createSpecies() }, "+ New");
  const list = mountRecordList(left, {
    title: "Pokémon",
    head: [newBtn, sort.el],
    placeholder: "Search Pokémon…  (Ctrl+F)",
    searchId: "pokemon-search",
    items: () => {
      const spec = store.adapter.pokemon;
      const all = species();
      const { ids, meta } = sortedSpecies(sort.state());
      return ids.map((id) => {
        const r = all[id];
        return {
          id,
          label: String(r.name ?? id),
          meta: meta(id),
          search: ((r.types as string[]) ?? []).join(" "),
          icon: spec ? spriteUrl(spec.frontSprite(r)) : undefined,
          edited: store.isRecordEdited(REG, id),
          isNew: store.baseTable(REG)[id] === undefined,
        };
      });
    },
    current: () => current,
    pick: (id) => open(id),
    refreshOn: (reason, _id, registry) => reason === "content" && registry === REG,
  });

  const main = h("div", { class: "ws-scroll" });
  const side = h("div", { class: "ws-scroll" });
  const title = h("span", {}, "Pokémon");
  const revert = h("button", {
    class: "btn small danger",
    onclick: () => {
      if (!current) return;
      if (store.baseTable(REG)[current] === undefined) deleteSpecies(current);
      else store.revertRecord(REG, current, `Revert ${current}`);
    },
  }, "Revert to base");
  const colors = h("span", {});
  center.append(h("div", { class: "panel-head" }, title, h("div", { class: "row nowrap" }, colors, revert)), main);
  const sideTitle = h("span", {}, "Pokédex & cry");
  right.append(h("div", { class: "panel-head" }, sideTitle), side);

  const open = (id: string) => {
    if (!species()[id]) return;
    current = id;
    list.render();
    renderNow();
    const row = left.querySelector<HTMLElement>(`.map-row[data-id="${id}"]`);
    row?.scrollIntoView({ block: "nearest" });
  };
  nav.openPokemon = (id) => {
    nav.setWorkspace("pokemon");
    open(id);
  };

  // re-render on edits, but never under the caret of a field being typed in
  let scheduled = false;
  const renderNow = () => {
    scheduled = false;
    const spec = store.adapter?.pokemon;
    const rec = current ? species()[current] : undefined;
    if (!spec || !rec || !current) {
      clear(main);
      clear(side);
      main.append(h("p", { class: "hint empty" }, spec ? "Pick a Pokémon on the left." : "This game has no Pokémon editor yet."));
      return;
    }
    const id = current;
    rerender(main, () => mainForm(id, rec, spec));
    rerender(side, () => sideForm(id, rec, spec));
    sideTitle.textContent = lacks(spec, "dexEntry") && lacks(spec, "cry") ? "Pokédex" : "Pokédex & cry";
    title.textContent = `#${String(rec.dex ?? "?").padStart(3, "0")} ${String(rec.name ?? current)}`;
    colors.replaceChildren(spec.monColors ? "" : colorSelect(view ?? defaultView(), monPaletteName(id, rec, false), rec.trueColor === true, (v) => {
      view = v;
      renderNow();
    }));
    newBtn.hidden = lacks(spec, "newSpecies");
    const isNew = store.baseTable(REG)[current] === undefined;
    revert.textContent = isNew ? "Delete Pokémon" : "Revert to base";
    revert.hidden = !isNew && !store.isRecordEdited(REG, current);
  };
  const schedule = () => {
    if (!scheduled) {
      scheduled = true;
      requestAnimationFrame(renderNow);
    }
  };

  // a new species as a copy of an existing one: next dex number, the
  // source's cry and menu icon, and its own copy of the dex text
  const createSpecies = async () => {
    const spec = store.adapter?.pokemon;
    if (!spec) return;
    const all = species();
    const res = await promptNewRecord({
      title: "New Pokémon",
      idPrefix: "",
      nameMax: 10,
      taken: (id) => all[id] !== undefined,
      sources: dexOrder().map((id) => ({ id, label: `#${String(all[id].dex ?? "?").padStart(3, "0")} ${String(all[id].name ?? id)}` })),
      source: current ?? dexOrder()[0],
    });
    if (!res) return;
    const src = all[res.source];
    const rec = clone(src) as Rec;
    rec.id = res.id;
    rec.name = res.name;
    rec.dex = Math.max(0, ...Object.values(all).map((m) => Number(m.dex) || 0)) + 1;
    delete rec.index;
    delete rec.source;
    if (typeof rec.cry !== "string") rec.cry = res.source;
    // a mod may not point at the game's own art (modkit MK301): reuse it
    // through the asset-transforms recipe, else start with placeholders
    const mod = store.project.mod;
    if (!mod) return toast("Choose or create a mod first: a new Pokémon is saved into it", "error");
    const front = reusable(rec.spriteFront);
    const back = reusable(rec.spriteBack);
    const size = Number(rec.frontSize ?? 7) * 8;
    rec.spriteFront = front ?? addAsset(mod, `${res.id}_front`, placeholderArt(size, size));
    rec.spriteBack = back ?? addAsset(mod, `${res.id}_back`, placeholderArt(spec.backSize, spec.backSize));
    if (!front || !back) delete rec.trueColor;
    if (rec.icon === undefined) {
      const icon = spec.icon.resolve(store.ctx, src);
      if (icon.name) rec.icon = icon.name;
      else if (icon.image) rec.icon = { image: icon.image, frames: spec.icon.frames };
    }
    const dex = rec.dexEntry as Rec | undefined;
    let textKey: string | undefined;
    if (dex && typeof dex.text === "string") {
      const text = store.table("text");
      const base = `_${res.id.toLowerCase().replace(/(^|_)(\w)/g, (_m, _s, c: string) => c.toUpperCase())}DexEntry`;
      textKey = base;
      for (let n = 2; text[textKey] !== undefined; n++) textKey = `${base}${n}`;
      rec.dexEntry = { ...dex, text: textKey };
    }
    const dexText = dex && typeof dex.text === "string" ? store.table("text")[dex.text] : undefined;
    store.group(`New Pokémon ${res.id}`, () => {
      if (textKey) store.setRecord("text", textKey, "New dex text", typeof dexText === "string" ? dexText : "");
      store.setRecord(REG, res.id, `New Pokémon ${res.id}`, rec);
      // the game plays cries[<species id>]: start with the source's cry
      const cry = cryFor(res.source);
      if (cry) store.setRecord("cries", res.id, "New cry", cry);
    });
    open(res.id);
  };

  // only species this mod adds; anything still pointing at it is listed first
  const deleteSpecies = (id: string) => {
    const uses: string[] = [];
    for (const [mapId, wild] of Object.entries(store.table("encounters") as Record<string, Rec>)) {
      for (const t of Object.values(wild)) if ((t as { slots?: { species: string }[] })?.slots?.some((s) => s.species === id)) uses.push(`wild Pokémon on ${mapId}`);
    }
    const into = keys(store.adapter.pokemon).into;
    for (const [mid, m] of Object.entries(species())) if ((m.evolutions as Evolution[] | undefined)?.some((e) => e[into] === id)) uses.push(`evolution of ${mid}`);
    for (const [tid, t] of Object.entries(store.table("trainers") as Record<string, Rec>)) {
      if ((t.parties as { species: string }[][] | undefined)?.some((p) => p.some((s) => s.species === id))) uses.push(`team of ${tid}`);
    }
    const msg = uses.length ? `${id} is still used by:\n- ${[...new Set(uses)].slice(0, 12).join("\n- ")}\n\nThose would refer to a Pokémon that no longer exists. Delete anyway?` : `Delete ${id}?`;
    if (!confirm(msg)) return;
    const key = (species()[id]?.dexEntry as Rec | undefined)?.text;
    store.group(`Delete ${id}`, () => {
      store.setRecord(REG, id, `Delete ${id}`, undefined);
      if (typeof key === "string" && store.baseTable("text")[key] === undefined) store.setRecord("text", key, "Delete dex text", undefined);
    });
    current = dexOrder()[0] ?? null;
    list.render();
    renderNow();
  };
  for (const el of [main, side]) onFocusLeave(el, schedule);

  store.on((reason, id, registry) => {
    if (reason === "project") {
      if (!current || !species()[current]) current = dexOrder()[0] ?? null;
      schedule();
    } else if (reason === "content" && (registry === REG || registry === "text" || registry === "cries" || registry === "items")) {
      // items: a new or changed TM/HM changes the TM/HM list
      if ((registry === REG || registry === "cries") && id !== current) return;
      schedule();
    } else if (reason === "reveal" && registry === REG && id) {
      nav.openPokemon(id);
    }
  });
}

// ------------------------------------------------------------------ editing

function edit(id: string, label: string, mutate: (r: Rec) => void): void {
  store.editRecord<Rec>(REG, id, label, mutate);
  store.seal();
}

function card(title: string, ...children: (Node | null)[]): HTMLElement {
  return h("section", { class: "card" }, h("h4", {}, title), ...children);
}

function mainForm(id: string, r: Rec, spec: PokemonSpec): HTMLElement[] {
  const ctx = store.ctx;
  const types = (r.types as string[] | undefined) ?? [];
  const typeNames = spec.typeNames(ctx);
  const setType = (slot: number, value: string) =>
    edit(id, "Types", (d) => {
      const next = [...new Set((d.types as string[]) ?? [])];
      if (value) next[slot] = value;
      else next.splice(slot, 1);
      // a dual type of the same type twice is a single type
      const single = next.filter((t, i) => t && next.indexOf(t) === i);
      d.types = spec.typesTwice && single.length === 1 ? [single[0], single[0]] : single;
    });

  const name = h("input", { type: "text", value: String(r.name ?? ""), maxLength: 10, spellcheck: false });
  name.addEventListener("change", () => edit(id, "Name", (d) => (d.name = name.value.toUpperCase() || id)));

  const header = h(
    "div",
    { class: "mon-header" },
    h(
      "div",
      { class: "mon-sprites" },
      spec.frontSprite(r) ? pic(spec.frontSprite(r), monColors(id, r), { class: "mon-sprite", alt: "front" }) : null,
      spec.backSprite(r) ? pic(spec.backSprite(r), monColors(id, r), { class: "mon-sprite back", alt: "back" }) : null,
    ),
    h(
      "div",
      { class: "mon-ident" },
      idRow(REG, id, String(r.name ?? ""), (to) => nav.openPokemon(to), [h("span", { class: "muted" }, `Dex #${String(r.dex ?? "?").padStart(3, "0")}`)]),
      field("Name", name, "Up to 10 characters"),
      h(
        "div",
        { class: "row two" },
        field("Type 1", selectInput(types[0] ?? "", typeNames, (v) => setType(0, v))),
        field("Type 2", selectInput(types[1] === types[0] ? "" : types[1] ?? "", typeNames.filter((t) => t !== types[0]), (v) => setType(1, v), "—")),
      ),
    ),
  );

  // base stats with bars
  const stats = (r.baseStats as Rec | undefined) ?? {};
  const total = spec.stats.reduce((s, st) => s + (Number(stats[st.key]) || 0), 0);
  const statRows = spec.stats.map((st) => {
    const v = Number(stats[st.key]) || 0;
    const bar = h("div", { class: "stat-bar" }, h("div", { class: "stat-fill", style: `width:${Math.min(100, (v / 255) * 100)}%;background:${statColor(v)}` }));
    const input = numberInput(v, (n) => edit(id, `${st.label}`, (d) => ((d.baseStats as Rec)[st.key] = clampInt(n, 1, 255))), 1, 255);
    return h("div", { class: "stat-row" }, h("span", { class: "stat-label" }, st.label), input, bar);
  });

  const growth = selectInput(String(r.growthRate ?? ""), spec.growthRates(ctx), (v) => edit(id, "Growth rate", (d) => (d.growthRate = v)));

  return [
    header,
    artCard(id, r, spec),
    card("Base stats", ...statRows, h("div", { class: "stat-row total" }, h("span", { class: "stat-label" }, "Total"), h("strong", {}, String(total)))),
    card(
      "Battle",
      h(
        "div",
        { class: "row three" },
        field("Catch rate", numberInput(r.catchRate as number, (n) => edit(id, "Catch rate", (d) => (d.catchRate = clampInt(n, 0, 255))), 0, 255), "0–255, higher is easier"),
        field("Base EXP", numberInput(r.baseExp as number, (n) => edit(id, "Base EXP", (d) => (d.baseExp = clampInt(n, 0, 255))), 0, 255), "EXP yield when defeated"),
        field("Growth rate", growth),
      ),
      spec.heldItems ? heldItemsRow(id, r, spec) : null,
    ),
    spec.breeding ? breedingCard(id, r, spec) : null,
    evolutionsCard(id, r, spec),
    // level-up moves and machines side by side (stacked when narrow)
    h("div", { class: "moves-cols" }, learnsetCard(id, r, spec), tmCard(id, r, spec)),
  ].filter((x): x is HTMLElement => !!x);
}

// ------------------------------------------------------------------ art

// art a mod may point at: its own files or its asset-transform copies,
// never the ROM-derived cache (modkit MK301 rejects any assets/generated
// reference in a mod)
export function isModArt(path: unknown): path is string {
  return typeof path === "string" && (path.startsWith("mods/") || path.startsWith("save/mod-derived/"));
}

// a path this mod may use for `path`: its own art as is, vanilla art as a
// derived copy (when the recipe is available), else null
function reusable(path: unknown): string | null {
  if (isModArt(path)) return path;
  if (isCachePath(path) && canDerive()) return derivedPath(store.project.mod!, path);
  return null;
}

function artCard(id: string, r: Rec, spec: PokemonSpec): HTMLElement {
  const mod = store.project.mod;
  const all = species();
  const trueColor = r.trueColor === true;
  const picKey = keys(spec).picSize;
  const frontSize = Number(r[picKey] ?? 7);
  const maxFront = Math.max(...spec.frontSizes) * 8;
  const scales = spec.battleScale;
  const frontScale = typeof r.battleScaleFront === "number" ? r.battleScaleFront : scales.front;
  const backScale = typeof r.battleScaleBack === "number" ? r.battleScaleBack : scales.back;
  // the import dialog preselects what the current back art probably is
  const backPx = backScale < scales.back ? spec.backSizes[1] ?? spec.backSize : spec.backSize;
  // drawn at: the game's scale is dropped rather than saved
  const scaleSelect = (key: "battleScaleFront" | "battleScaleBack", value: number, def: number) => {
    const sel = selectInput(String(value), scales.choices.map(String), (v) =>
      edit(id, "Battle size", (d) => (Number(v) === def ? delete d[key] : (d[key] = Number(v)))),
    );
    for (const o of sel.options) o.textContent = `drawn ${o.value}×${Number(o.value) === def ? " (game)" : ""}`;
    if (!scales.choices.includes(value)) sel.prepend(h("option", { value: String(value), selected: true }, `drawn ${value}×`));
    sel.title = "How big the game draws this sprite in battle";
    return sel;
  };

  const importTo = async (kind: "front" | "back" | "icon") => {
    if (!mod) return toast("Choose or create a mod first: imported art is saved into it", "error");
    const res = await importArt(
      kind === "icon"
        ? { label: "Menu icon", width: spec.icon.width, height: spec.icon.height, frames: spec.icon.frames, align: "center" }
        : kind === "front"
          ? { label: "Front sprite", width: frontSize * 8, height: frontSize * 8, align: "bottom", sizes: spec.frontSizes.map((n) => n * 8), keepTransparent: true }
          : { label: "Back sprite", width: backPx, height: backPx, align: "bottom", sizes: spec.backSizes, keepTransparent: true },
      { trueColor },
    );
    if (!res) return;
    const path = addAsset(mod, `${id}_${kind}`, res.data);
    edit(id, `Import ${kind} art`, (d) => {
      if (kind === "front") {
        d.spriteFront = path;
        d[picKey] = res.size / 8;
      } else if (kind === "back") {
        d.spriteBack = path;
        // 32×32 is drawn doubled like the game; bigger art is drawn 1:1
        if (res.size === spec.backSize || scales.back === 1) delete d.battleScaleBack;
        else d.battleScaleBack = 1;
      }
      else d.icon = { image: path, frames: spec.icon.frames, ...(res.trueColor ? { trueColor: true } : {}) };
      if (kind !== "icon") {
        if (res.trueColor) d.trueColor = true;
        else delete d.trueColor;
      }
    });
  };

  // another species' art: the mod's own as is, vanilla art through the
  // asset-transforms recipe (written on save)
  const borrow = (kind: "front" | "back") => {
    const key = kind === "front" ? "spriteFront" : "spriteBack";
    const owners = dexOrder().filter((s) => s !== id && reusable(all[s][key]) !== null);
    const sel = selectInput("", owners, (v) => {
      const src = all[v];
      const path = src ? reusable(src[key]) : null;
      if (!path) return;
      edit(id, `Use ${String(src.name ?? v)}'s ${kind} art`, (d) => {
        d[key] = path;
        if (kind === "front") d[picKey] = src[picKey];
        // the art's battle scale goes with it
        const scaleKey = kind === "front" ? "battleScaleFront" : "battleScaleBack";
        if (src[scaleKey] !== undefined) d[scaleKey] = src[scaleKey];
        else delete d[scaleKey];
      });
    }, owners.length ? "Use art of…" : "No art to reuse");
    for (const o of sel.options) if (o.value) o.textContent = `${String(all[o.value]?.name ?? o.value)}`;
    sel.disabled = !owners.length;
    sel.title = canDerive()
      ? "Reuses another Pokémon's sprite. Game sprites are copied from the player's own ROM data when the game loads (asset transforms), so the mod ships no ROM art."
      : store.project.mod
        ? "This mod has its own assets_transforms file, so only art inside the mod can be reused."
        : "Choose or create a mod first.";
    return sel;
  };

  const front = spec.frontSprite(r);
  const back = spec.backSprite(r);
  const pal = monColors(id, r);
  const icon = spec.icon.resolve(store.ctx, r);
  const iconPath = icon.image ?? (icon.name ? spec.icon.path(store.ctx, icon.name) : undefined);
  const iconSel = selectInput(icon.name ?? "", spec.icon.names(store.ctx), (v) => edit(id, "Menu icon", (d) => (d.icon = v)), icon.image ? "(own image)" : undefined);
  iconSel.title = "One of the game's menu icon shapes";
  // the dataset names shapes whose art this version lacks (PIKACHU outside
  // Yellow): only offer the ones that load
  for (const o of [...iconSel.options]) {
    const path = o.value ? spec.icon.path(store.ctx, o.value) : undefined;
    if (path) void loadImage(spriteUrl(path)).then((img) => !img && !o.selected && o.remove());
  }

  // the front preview shows the size the game uses: a 40 px Pokémon sits
  // smaller in the 56 px box, bottom-centered like in battle
  const frontPx = Math.round((frontSize * 8 * 112) / maxFront);
  const slot = (title: string, controls: HTMLElement[], preview: HTMLElement | null, note: string) =>
    h(
      "div",
      { class: "art-slot" },
      h("span", { class: "field-label" }, title),
      h("div", { class: "art-controls" }, ...controls),
      h("div", { class: "art-thumb" }, preview ?? h("span", { class: "hint" }, "none")),
      h("span", { class: "hint" }, note),
    );

  const colorBox = h("input", { type: "checkbox", checked: trueColor });
  colorBox.addEventListener("change", () => edit(id, "Full color", (d) => (colorBox.checked ? (d.trueColor = true) : delete d.trueColor)));
  const romArt = [front, back].some((p) => typeof p === "string" && !isModArt(p)) && store.baseTable(REG)[id] === undefined;

  return h(
    "section",
    { class: "card" },
    h("h4", {}, "Art"),
    romArt
      ? h(
          "div",
          { class: "row" },
          h("span", { class: "hint bad" }, "This Pokémon points at the game's own art files, which a mod may not do (validation fails)."),
          canDerive()
            ? h("button", {
                class: "btn small",
                title: "Point it at copies made from the player's own ROM data when the game loads",
                onclick: () =>
                  edit(id, "Reuse art via asset transforms", (d) => {
                    for (const k of ["spriteFront", "spriteBack"]) {
                      const path = reusable(d[k]);
                      if (path) d[k] = path;
                    }
                  }),
              }, "Fix: reuse via asset transforms")
            : null,
        )
      : null,
    front?.startsWith("save/mod-derived/")
      ? h("p", { class: "hint" }, "Reused game art: copied from the player's own ROM data when the game loads (mods/…/studio_transforms.lua).")
      : null,
    h(
      "div",
      { class: "art-grid" },
      slot(
        "Front",
        [h("button", { class: "btn small", onclick: () => importTo("front") }, "Import…"), borrow("front"), scaleSelect("battleScaleFront", frontScale, scales.front)],
        front ? pic(front, pal, { class: "front-art", style: `width:${frontPx}px;height:${frontPx}px` }) : null,
        `${frontSize * 8}×${frontSize * 8}`,
      ),
      slot(
        "Back",
        [h("button", { class: "btn small", onclick: () => importTo("back") }, "Import…"), borrow("back"), scaleSelect("battleScaleBack", backScale, scales.back)],
        back ? pic(back, pal, {}) : null,
        backScale === scales.back && scales.back !== 1 ? `${spec.backSize}×${spec.backSize}, drawn doubled like the game` : "Full resolution",
      ),
      slot(
        "Menu icon",
        lacks(spec, "iconImport") ? [h("span", { class: "muted" }, icon.name ?? "—")] : [h("button", { class: "btn small", onclick: () => importTo("icon") }, "Import…"), iconSel],
        iconPath ? h("div", { class: "icon-frame", style: `background-image:url("${spriteUrl(iconPath)}")` }) : null,
        icon.image ? "Own image, 2 frames" : "Game icon shape",
      ),
    ),
    spec.monColors ? null : field(
      "Battle palette",
      paletteField(r.palette, monPaletteName(id, undefined, false), (v) => edit(id, "Battle palette", (d) => (v ? (d.palette = v) : delete d.palette))),
      "The colors of its battle pictures. In RED++ mode the game uses RED++'s colors for the same palette name.",
    ),
    h("label", { class: "ai-layer" }, colorBox, h("span", {}, h("strong", {}, "Full color"), h("span", { class: "hint" }, "Shows this Pokémon's battle sprites exactly as drawn instead of colouring 4 gray shades with the game's palette."))),
    mod ? h("p", { class: "hint" }, `Imported images are saved into mods/${mod}/assets/studio/ when you save.`) : h("p", { class: "hint warn" }, "Choose or create a mod to import art."),
  );
}

function evolutionsCard(id: string, r: Rec, spec: PokemonSpec): HTMLElement {
  const ctx = store.ctx;
  const into = keys(spec).into;
  const evos = (r.evolutions as Evolution[] | undefined) ?? [];
  const speciesIds = dexOrder();
  const items = spec.itemNames(ctx);
  const editEvo = (i: number, label: string, mutate: (e: Evolution) => void) =>
    edit(id, label, (d) => {
      const list = [...((d.evolutions as Evolution[]) ?? [])];
      list[i] = { ...list[i] };
      mutate(list[i]);
      d.evolutions = list;
    });
  const rows = evos.map((e, i) => {
    const method = spec.evolutionMethods.find((m) => m.id === e.method);
    const methodSelect = selectInput(String(e.method ?? ""), spec.evolutionMethods.map((m) => m.id), (v) =>
      editEvo(i, "Evolution method", (x) => {
        x.method = v;
        const m = spec.evolutionMethods.find((mm) => mm.id === v);
        if (m?.item === true && !x.item) x.item = items.find((it) => it.endsWith("_STONE")) ?? items[0];
        if (!m?.item) delete x.item;
        if (m?.time) x.time ??= m.time[0];
        else delete x.time;
        if (m?.comparison) x.comparison ??= m.comparison[0].id;
        else delete x.comparison;
        if (spec.evolutionLevelAlways) {
          // the importer writes level 1 for non-level methods; keep the shape
          if (typeof x.level !== "number" || !m?.level) x.level = m?.level ? Math.max(2, Number(x.level) || 16) : 1;
        } else if (m?.level) x.level = Math.max(2, Number(x.level) || 16);
        else delete x.level;
      }),
    );
    for (const o of methodSelect.options) o.textContent = spec.evolutionMethods.find((m) => m.id === o.value)?.label ?? o.value;
    const params: HTMLElement[] = [];
    if (method?.level) params.push(numberInput(e.level, (n) => editEvo(i, "Evolution level", (x) => (x.level = clampInt(n, 1, 100))), 1, 100));
    if (method?.item) {
      params.push(method.item === "optional"
        ? selectInput(String(e.item ?? ""), items, (v) => editEvo(i, "Trade item", (x) => (v ? (x.item = v) : delete x.item)), "no held item")
        : comboInput(String(e.item ?? ""), "dl-items", items, (v) => editEvo(i, "Evolution item", (x) => (x.item = v))));
    }
    if (method?.time) {
      const sel = selectInput(String(e.time ?? method.time[0]), method.time, (v) => editEvo(i, "Evolution time", (x) => (x.time = v)));
      for (const o of sel.options) o.textContent = ({ ANYTIME: "any time", MORNDAY: "morning/day", NITE: "night" } as Record<string, string>)[o.value] ?? o.value;
      params.push(sel);
    }
    if (method?.comparison) {
      const choices = method.comparison;
      const sel = selectInput(String(e.comparison ?? choices[0].id), choices.map((c) => c.id), (v) => editEvo(i, "Evolution stats", (x) => (x.comparison = v)));
      for (const o of sel.options) o.textContent = choices.find((c) => c.id === o.value)?.label ?? o.value;
      params.push(sel);
    }
    const targetId = typeof e[into] === "string" ? (e[into] as string) : "";
    const target = comboInput(targetId, "dl-species", speciesIds, (v) => editEvo(i, "Evolves into", (x) => (x[into] = v)));
    target.classList.add("evo-target");
    const goto = targetId && species()[targetId] ? h("button", { class: "btn small ghost", title: `Open ${targetId}`, onclick: () => nav.openPokemon(targetId) }, "→") : null;
    const remove = h("button", { class: "btn small ghost", title: "Remove", onclick: () => edit(id, "Remove evolution", (d) => (d.evolutions = evos.filter((_, j) => j !== i))) }, "✕");
    return h("div", { class: "evo-row" }, methodSelect, ...(params.length ? params : [h("span", { class: "muted" }, "—")]), h("span", { class: "muted" }, "→"), target, goto, remove);
  });
  const first = spec.evolutionMethods[0];
  const add = h(
    "button",
    {
      class: "btn small",
      onclick: () => edit(id, "Add evolution", (d) => (d.evolutions = [...evos, { method: first?.id ?? "LEVEL", level: 16, [into]: id }])),
    },
    "+ Evolution",
  );
  return card("Evolutions", ...(rows.length ? rows : [h("p", { class: "hint" }, "Does not evolve.")]), h("div", { class: "row" }, add));
}

// a list of moves as chips (starting moves, egg moves)
function moveChips(id: string, list: string[], max: number, what: string, moves: string[], set: (d: Rec, next: string[]) => void): HTMLElement {
  return h(
    "div",
    { class: "row" },
    ...list.map((m, i) =>
      h(
        "span",
        { class: "move-chip" },
        comboInput(m, "dl-moves", moves, (v) => edit(id, what, (d) => set(d, list.map((x, j) => (j === i ? v : x))))),
        h("button", { class: "btn small ghost", title: "Remove", onclick: () => edit(id, `Remove ${what.toLowerCase()}`, (d) => set(d, list.filter((_, j) => j !== i))) }, "✕"),
      ),
    ),
    list.length < max
      ? h("button", { class: "btn small", onclick: () => edit(id, `Add ${what.toLowerCase()}`, (d) => set(d, [...list, moves.includes("TACKLE") ? "TACKLE" : moves[0]])) }, "+ Move")
      : null,
  );
}

function learnsetCard(id: string, r: Rec, spec: PokemonSpec): HTMLElement {
  const moves = spec.moveNames(store.ctx);
  const { levelMoves: lvKey, startMoves: startKey } = keys(spec);
  const firstMoves = startKey ? ((r[startKey] as string[] | undefined) ?? []) : [];
  const learnset = (r[lvKey] as LearnEntry[] | undefined) ?? [];

  // the game teaches in list order; keep it sorted by level
  const sorted = (list: LearnEntry[]) => [...list].sort((a, b) => a.level - b.level);
  const rows = learnset.map((e, i) =>
    h(
      "div",
      { class: "learn-row" },
      h("span", { class: "muted" }, "Lv"),
      numberInput(e.level, (n) => edit(id, "Learn level", (d) => (d[lvKey] = sorted(learnset.map((x, j) => (j === i ? { ...x, level: clampInt(n, 1, 100) } : x))))), 1, 100),
      comboInput(e.move, "dl-moves", moves, (v) => edit(id, "Learned move", (d) => (d[lvKey] = learnset.map((x, j) => (j === i ? { ...x, move: v } : x))))),
      h("button", { class: "btn small ghost", title: "Remove", onclick: () => edit(id, "Remove learned move", (d) => (d[lvKey] = learnset.filter((_, j) => j !== i))) }, "✕"),
    ),
  );
  const add = h(
    "button",
    {
      class: "btn small",
      onclick: () =>
        edit(id, "Add learned move", (d) => {
          const level = Math.min(100, (learnset[learnset.length - 1]?.level ?? 1) + 1);
          d[lvKey] = sorted([...learnset, { level, move: moves.includes("TACKLE") ? "TACKLE" : moves[0] }]);
        }),
    },
    "+ Learned move",
  );
  return card(
    "Moves",
    ...(startKey
      ? [
          h("span", { class: "field-label" }, "Known at level 1 (up to 4)"),
          moveChips(id, firstMoves, 4, "Starting move", moves, (d, next) => (d[startKey] = next)),
        ]
      : []),
    h("span", { class: "field-label" }, startKey ? "Learned by level-up" : "Learned by level-up (level 1: known from the start)"),
    ...rows,
    h("div", { class: "row" }, add),
  );
}

// the two items wild ones may hold: gen1recomp Mon.wildItem gives items[1]
// (common) or, rarely, items[2]. A table with only [2] loads as { "2": id }
// and is written back the same way ([2] = id)
function heldItemsRow(id: string, r: Rec, spec: PokemonSpec): HTMLElement {
  const items = spec.itemNames(store.ctx);
  const raw = r.items;
  const slot = (n: 1 | 2): string => {
    const v = Array.isArray(raw) ? raw[n - 1] : (raw as Record<string, unknown> | undefined)?.[String(n)];
    return typeof v === "string" ? v : "";
  };
  const set = (n: 1 | 2, v: string) =>
    edit(id, "Held item", (d) => {
      const common = n === 1 ? v : slot(1);
      const rare = n === 2 ? v : slot(2);
      d.items = common ? (rare ? [common, rare] : [common]) : rare ? { 2: rare } : [];
    });
  return h(
    "div",
    { class: "row two" },
    field("Held item (common)", selectInput(slot(1), items, (v) => set(1, v), "none"), "Wild ones hold it about 1 in 4 times"),
    field("Held item (rare)", selectInput(slot(2), items, (v) => set(2, v), "none"), "About 1 in 50"),
  );
}

// constants/pokemon_data_constants.asm GENDER_* (chance of female, out of 256)
const GENDERS: [number, string][] = [
  [0, "Always male"], [31, "1 in 8 female"], [63, "1 in 4 female"], [127, "Half female"],
  [191, "3 in 4 female"], [254, "Always female"], [255, "Genderless"],
];

function breedingCard(id: string, r: Rec, spec: PokemonSpec): HTMLElement {
  const groups = spec.breeding!.eggGroups;
  const own = (r.eggGroups as string[] | undefined) ?? [];
  const setGroup = (slot: number, v: string) =>
    edit(id, "Egg group", (d) => {
      const next = [own[0] ?? v, own[1] ?? own[0] ?? v];
      next[slot] = v;
      d.eggGroups = next;
      // the engine compares the raw byte (Breeding.isNoEggs): high nibble first
      d.eggGroupsRaw = ((groups.indexOf(next[0]) + 1) << 4) | (groups.indexOf(next[1]) + 1);
    });
  const groupSelect = (slot: number) => {
    const sel = selectInput(own[slot] ?? "", groups, (v) => setGroup(slot, v));
    for (const o of sel.options) o.textContent = o.value === "EGG_NONE" ? "no eggs" : o.value.replace(/^EGG_/, "").replace(/_/g, " ").toLowerCase();
    return sel;
  };
  const ratio = Number(r.genderRatio ?? 127);
  const gender = selectInput(String(ratio), GENDERS.map(([n]) => String(n)), (v) => edit(id, "Gender ratio", (d) => (d.genderRatio = Number(v))));
  for (const o of gender.options) o.textContent = GENDERS.find(([n]) => String(n) === o.value)?.[1] ?? `${o.value} / 256 female`;
  const moves = spec.moveNames(store.ctx);
  const eggMoves = (r.eggMoves as string[] | undefined) ?? [];
  return card(
    "Breeding",
    h(
      "div",
      { class: "row three" },
      field("Egg group 1", groupSelect(0)),
      field("Egg group 2", groupSelect(1), "The same group twice: only that one"),
      field("Gender", gender),
    ),
    field("Egg cycles", numberInput(r.eggSteps as number, (n) => edit(id, "Egg cycles", (d) => (d.eggSteps = clampInt(n, 1, 255))), 1, 255), `Hatches after about ${(Number(r.eggSteps) || 0) * 256} steps`),
    h("span", { class: "field-label" }, "Egg moves (a father can pass them on)"),
    moveChips(id, eggMoves, 99, "Egg move", moves, (d, next) => (d.eggMoves = next)),
  );
}

function tmCard(id: string, r: Rec, spec: PokemonSpec): HTMLElement {
  const machines = spec.machines(store.ctx);
  const has = new Set((r.tmhm as string[] | undefined) ?? []);
  const toggle = (move: string, on: boolean) =>
    edit(id, on ? `Teach ${move}` : `Forget ${move}`, (d) => {
      const set = new Set((d.tmhm as string[]) ?? []);
      if (on) set.add(move);
      else set.delete(move);
      d.tmhm = machines.map((m) => m.move).filter((m) => set.has(m));
    });
  const grid = h(
    "div",
    { class: "tm-grid" },
    ...machines.map((m) => {
      const box = h("input", { type: "checkbox", checked: has.has(m.move) });
      box.addEventListener("change", () => toggle(m.move, box.checked));
      return h("label", { class: `tm${has.has(m.move) ? " on" : ""}`, title: m.move }, box, h("span", { class: "tm-num" }, m.label), h("span", { class: "tm-move" }, m.move.replace(/_/g, " ")));
    }),
  );
  return card(`TM / HM (${has.size})`, grid);
}

function sideForm(id: string, r: Rec, spec: PokemonSpec): HTMLElement[] {
  if (lacks(spec, "dexEntry")) {
    return [card("Pokédex entry", h("p", { class: "hint" }, "Mods can't change this game's Pokédex entries yet: the engine has no way for them (reported to gen1recomp).")), ...(lacks(spec, "cry") ? [] : [cryCard(id)])];
  }
  const dex = r.dexEntry as Rec | undefined;
  const dexFields: HTMLElement[] = [];
  if (dex) {
    const editDex = (label: string, key: string, value: unknown) => edit(id, label, (d) => ((d.dexEntry as Rec)[key] = value));
    const kind = h("input", { type: "text", value: String(dex.kind ?? ""), maxLength: 10, spellcheck: false });
    kind.addEventListener("change", () => editDex("Dex category", "kind", kind.value.toUpperCase()));
    dexFields.push(
      field("Category", kind, `Shown as "${String(dex.kind ?? "")} POKéMON"`),
      h(
        "div",
        { class: "row three" },
        field("Height ft", numberInput(dex.heightFt as number, (n) => editDex("Height", "heightFt", clampInt(n, 0, 99)), 0, 99)),
        field("Height in", numberInput(dex.heightIn as number, (n) => editDex("Height", "heightIn", clampInt(n, 0, 11)), 0, 11)),
        field("Weight", numberInput(dex.weight as number, (n) => editDex("Weight", "weight", clampInt(n, 0, 65535)), 0, 65535), `${((Number(dex.weight) || 0) / 10).toFixed(1)} lb`),
      ),
    );
    if (typeof dex.text === "string") dexFields.push(textEditor(dex.text, { rows: 7, label: `Entry text (${dex.text})` }));
  }

  return [
    dex ? card("Pokédex entry", ...dexFields) : card("Pokédex entry", h("p", { class: "hint" }, "No Pokédex entry.")),
    lacks(spec, "cry") ? null : cryCard(id),
  ].filter((x): x is HTMLElement => !!x);
}

function clampInt(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function statColor(v: number): string {
  if (v < 50) return "#e5534b";
  if (v < 80) return "#e8a33d";
  if (v < 110) return "#d6c94a";
  if (v < 140) return "#5cc46a";
  return "#4fb3e8";
}
