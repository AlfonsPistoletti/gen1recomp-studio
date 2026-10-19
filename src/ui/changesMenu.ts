// Top-bar "Changes" button: an icon with the number of changed records, and a
// dropdown listing them grouped by registry. Each entry opens its page.

import { FileDiff } from "lucide";
import { afterStroke, store } from "../core/store.ts";
import { h, clear, dropdown, icon } from "./dom.ts";
import { nav } from "./nav.ts";
import { eventTitle, splitEventId } from "./eventEditor.ts";
import { globalLabelOf, globalSectionOf } from "./globalWorkspace.ts";

// registry -> [heading, singular]; also the display order
const NAMES: Record<string, [string, string]> = {
  maps: ["Maps", "map"],
  encounters: ["Wild tables", "wild table"],
  text_pointers: ["Map text pointers", "text pointer"],
  pokemon: ["Pokémon", "Pokémon"],
  cries: ["Cries", "cry"],
  icons: ["Menu icons", "menu icon"],
  moves: ["Moves", "move"],
  studio_effects: ["Custom move effects", "custom effect"],
  battle_anims: ["Move animations", "move animation"],
  items: ["Items", "item"],
  studio_item_effects: ["Custom item effects", "custom item effect"],
  balls: ["Ball catch numbers", "ball"],
  studio_events: ["Events", "event"],
  map_songs: ["Map music", "map's music"],
  music: ["Songs", "song"],
  sfx: ["Sound effects", "sound effect"],
  tilesets: ["Tilesets", "tileset"],
  sprites: ["Sprites", "sprite"],
  image_overrides: ["Replaced images", "replaced image"],
  palettes: ["Palettes", "palette"],
  studio_roofs: ["RED++ roofs", "RED++ roof"],
  studio_tilesets: ["Tiles added to the game's tilesets", "tileset addition"],
  field: ["Hidden events and landing spots", "field setting"],
  prize_counters: ["Game Corner prizes", "prize counter"],
  trainers: ["Trainers", "trainer"],
  ai_classes: ["Trainer AI", "trainer AI"],
  text: ["Texts", "text"],
  rom_text: ["Game texts", "game text"],
  constants: ["Global settings", "global setting"],
  type_chart: ["Type chart", "type chart entry"],
};

// one line per registry ("3 maps · 1 Pokémon"), for the tooltip
export function changeSummary(): { total: number; text: string } {
  const parts: string[] = [];
  let total = 0;
  for (const [group, changes] of grouped()) {
    const n = changes.length;
    total += n;
    const [heading, one] = NAMES[group] ?? [group, group];
    parts.push(`${n} ${n === 1 ? one : heading.toLowerCase()}`);
  }
  return { total, text: parts.join(" · ") };
}

interface Change {
  registry: string;
  id: string;
  record: unknown; // null: removed
  // one entry of a record that maps ids to values (Gen 2's move animations):
  // the game's value of that entry (undefined: the entry is new)
  part?: { base: unknown };
  // what the line says and opens, and what DIFFERENCES.md writes for a change
  label?: string;
  open?: () => void;
  note?: string;
}

// records listed per changed entry instead of as one: Gen 2's move -> animation table
function splitRecord(registry: string, id: string): boolean {
  const t = store.adapter?.moves?.animTable;
  return !!t && t.registry === registry && t.id === id;
}

// the changed records in display groups: one per registry, except that
// everything edited in Global (new game, names, trades, ...) joins "Global
// settings" (the constants group) whatever registry stores it
function grouped(): [string, Change[]][] {
  const groups = new Map<string, Change[]>();
  let mapColors = false;
  for (const [registry, records] of Object.entries(store.changed())) {
    for (const id of Object.keys(records).sort()) {
      const group = globalLabelOf(registry, id) ? "constants" : registry;
      if (!groups.has(group)) groups.set(group, []);
      if (splitRecord(registry, id)) {
        const cur = (records[id] ?? {}) as Record<string, unknown>;
        const base = (store.baseTable(registry)[id] ?? {}) as Record<string, unknown>;
        for (const k of [...new Set([...Object.keys(cur), ...Object.keys(base)])].sort()) {
          if (cur[k] !== base[k]) groups.get(group)!.push({ registry, id: k, record: k in cur ? cur[k] : null, part: { base: base[k] }, note: "plays another move's animation" });
        }
        continue;
      }
      // Gen 2's palettes: map colors per environment and time, colors per trainer / species
      const bp = store.adapter?.bgPalettes;
      if (bp && registry === bp.registry) {
        if (id === bp.id || id === bp.envsId) {
          mapColors = true;
          continue;
        }
        if (id === "trainers" || id === "pokemon") {
          const cur = (records[id] ?? {}) as Record<string, unknown>;
          const base = (store.baseTable(registry)[id] ?? {}) as Record<string, unknown>;
          for (const k of [...new Set([...Object.keys(cur), ...Object.keys(base)])].sort()) {
            if (JSON.stringify(cur[k]) === JSON.stringify(base[k])) continue;
            // a new class's / species' colors came with it: its own "new" line covers them
            const owner = id === "trainers" ? "trainers" : "pokemon";
            if (base[k] === undefined && store.table(owner)[k] !== undefined && store.baseTable(owner)[k] === undefined) continue;
            const open = id === "trainers" ? (store.table("trainers")[k] ? () => nav.openTrainer(k) : undefined) : store.table("pokemon")[k] ? () => nav.openPokemon(k) : undefined;
            groups.get(group)!.push({ registry, id: k, record: k in cur ? cur[k] : null, part: { base: base[k] }, label: `${k} · colors`, open, note: base[k] === undefined ? "new colors" : "colors changed" });
          }
          continue;
        }
      }
      groups.get(group)!.push({ registry, id, record: records[id] });
    }
  }
  // the environments and times whose map colors differ from the game's
  const bp = store.adapter?.bgPalettes;
  if (bp && mapColors) {
    const cur = (store.table(bp.registry)[bp.id] ?? []) as unknown[];
    const base = (store.baseTable(bp.registry)[bp.id] ?? []) as unknown[];
    const envs = bp.envs(store.ctx);
    const baseEnvs = (store.baseTable(bp.registry)[bp.envsId] ?? {}) as Record<string, Record<string, number[]>>;
    const list = groups.get(bp.registry) ?? [];
    for (const env of Object.keys(envs).sort()) {
      for (const t of bp.times) {
        const ids = envs[env]?.[t.key];
        if (!ids) continue;
        const moved = JSON.stringify(ids) !== JSON.stringify(baseEnvs[env]?.[t.key]);
        const recolored = ids.some((n) => JSON.stringify(cur[n - 1]) !== JSON.stringify(base[n - 1]));
        if (!moved && !recolored) continue;
        const key = `${env}|${t.key}`;
        list.push({ registry: bp.registry, id: key, record: true, part: { base: true }, label: `${env} · ${t.label}`, open: () => nav.openPalette(key), note: moved ? "own palettes" : "colors changed" });
      }
    }
    if (list.length) groups.set(bp.registry, list);
  }
  const order = Object.keys(NAMES);
  const rank = (r: string) => (order.includes(r) ? order.indexOf(r) : order.length);
  return [...groups].sort(([a], [b]) => rank(a) - rank(b));
}

const mapIdOfLabel = (label: string): string | undefined =>
  Object.keys(store.maps).find((id) => store.maps[id].label === label) ?? (store.maps[label] ? label : undefined);

// how to open a changed record; null when there is nothing left to show
function opener(registry: string, id: string, removed: boolean): (() => void) | null {
  const global = globalSectionOf(registry, id);
  if (global) return () => nav.openGlobal(global);
  switch (registry) {
    case "maps":
      return removed ? null : () => nav.openMap(id);
    case "encounters":
      return store.maps[id]
        ? () => {
            nav.openMap(id);
            nav.showPropsTab("encounters");
          }
        : null;
    case "text_pointers": {
      const mapId = mapIdOfLabel(id);
      return mapId ? () => nav.openMap(mapId) : null;
    }
    case "pokemon":
      return removed ? null : () => nav.openPokemon(id);
    case "cries":
      return store.table("pokemon")[id] ? () => nav.openPokemon(id) : null;
    case "icons": {
      // a species' icon, or the sheet the studio made for one
      const species = id.replace(/^ICON_STUDIO_/, "");
      return store.table("pokemon")[species] ? () => nav.openPokemon(species) : null;
    }
    case "moves":
    case "battle_anims":
      return store.table("moves")[id] ? () => nav.openMove(id) : null;
    case "studio_effects": {
      const user = Object.entries(store.table("moves")).find(([, m]) => (m as { effect?: unknown }).effect === id)?.[0];
      return user ? () => nav.openMove(user) : removed ? null : removeUnused(registry, id);
    }
    case "items":
    case "balls":
      return store.table("items")[id] ? () => nav.openItem(id) : null;
    case "studio_item_effects": {
      const user = Object.entries(store.table("items")).find(([, m]) => (m as { effect?: unknown }).effect === id)?.[0];
      return user ? () => nav.openItem(user) : removed ? null : removeUnused(registry, id);
    }
    case "studio_events":
      return removed ? null : () => nav.openEvent(id);
    case "map_songs":
      return store.maps[id] ? () => nav.openMap(id) : null;
    case "field":
      if (id === "townMap") return () => nav.openTownMap();
      if (id === "playerSprites") return () => nav.openSprite(String((store.table("field").playerSprites as { walk?: string } | undefined)?.walk ?? "SPRITE_RED"));
      // hiddenExtras (PC tiles) and flyWarps (landing spots): the maps say which
      return () => nav.setWorkspace("maps");
    case "trainers":
      return removed ? null : () => nav.openTrainer(id);
    case "ai_classes":
      return store.table("trainers")[id] ? () => nav.openTrainer(id) : null;
    case "text":
    case "rom_text":
      return removed ? null : () => nav.openText(id, registry);
    case "palettes": {
      // Gen 2: the bg palettes open the first environment / time they changed
      const bp = store.adapter?.bgPalettes;
      if (bp && (id === bp.id || id === bp.envsId)) {
        const cur = (store.table(bp.registry)[bp.id] ?? []) as unknown[];
        const base = (store.baseTable(bp.registry)[bp.id] ?? []) as unknown[];
        const envs = bp.envs(store.ctx);
        const hit = Object.keys(envs).sort().flatMap((e) => bp.times.map((t) => `${e}|${t.key}`)).find((k) => {
          const [e, t] = k.split("|");
          return (envs[e]?.[t] ?? []).some((n) => JSON.stringify(cur[n - 1]) !== JSON.stringify(base[n - 1]));
        });
        return () => nav.openPalette(hit ?? "TOWN|DAY");
      }
      if (bp) return null;
      return store.table("palettes")[id] ? () => nav.openPalette(id) : null;
    }
    case "landmarks":
    case "studio_townmap":
      return () => nav.openTownMap();
    case "image_overrides":
      return () => nav.openImage(id);
    case "sprites":
      return store.table("sprites")[id] ? () => nav.openSprite(id) : null;
    case "studio_roofs":
      return store.maps[id] ? () => nav.openMap(id) : null;
    case "tilesets":
    case "studio_tilesets":
      return store.table("tilesets")[id] ? () => nav.openTileset(id) : null;
  }
  return null;
}

// a custom effect nothing uses any more: its row removes it
const unusedEffect = (registry: string, id: string, record: unknown): boolean =>
  record !== null && (registry === "studio_effects" || registry === "studio_item_effects")
  && !Object.values(store.table(registry === "studio_effects" ? "moves" : "items")).some((r) => (r as { effect?: unknown }).effect === id);
const removeUnused = (registry: string, id: string) => () => {
  store.setRecord(registry, id, "Remove unused custom effect", undefined);
  store.seal();
};

// field keys the studio edits
const FIELD_NAMES: Record<string, string> = { townMap: "Town Map", flyWarps: "Landing spots", hiddenExtras: "PCs, bench guys, gym statues", hiddenItems: "Hidden items", hiddenCoins: "Hidden coins", playerSprites: "The player's sprites", superRod: "Super Rod lists", trades: "In-game trades", fishing: "Old Rod and Good Rod" };

function displayName(record: unknown, id: string, registry = ""): string {
  if (registry === "field" && FIELD_NAMES[id]) return FIELD_NAMES[id];
  if (registry === store.adapter?.events?.registry) return `${splitEventId(id).mapId} · ${eventTitle(id)}`;
  const name = record && typeof record === "object" ? (record as { name?: unknown }).name : undefined;
  return typeof name === "string" && name && name.toUpperCase() !== id.toUpperCase() ? `${id} · ${name}` : id;
}

// what a record's fields are called in DIFFERENCES.md (the rest: "baseStats"
// -> "base stats")
const KEY_NAMES: Record<string, string> = {
  blocks: "layout", objects: "people and objects", warps: "warps", signs: "signs", borderBlock: "border",
  tmhm: "TM/HM moves", level1Moves: "starting moves", dexEntry: "Pokédex entry", spriteFront: "front sprite",
  spriteBack: "back sprite", trueColor: "full color", aiMods: "AI", basePic: "portrait", pic: "portrait",
};
const fieldName = (k: string) => KEY_NAMES[k] ?? k.replace(/([a-z])([A-Z0-9])/g, "$1 $2").replace(/_/g, " ").toLowerCase();

// which top-level fields of a record differ from the game's
function changedFields(base: unknown, now: unknown): string[] {
  if (!base || !now || typeof base !== "object" || typeof now !== "object" || Array.isArray(now)) return [];
  const b = base as Record<string, unknown>;
  const n = now as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(b), ...Object.keys(n)])].filter((k) => k !== "id" && JSON.stringify(b[k]) !== JSON.stringify(n[k]));
  return [...new Set(keys.map(fieldName))];
}

// DIFFERENCES.md: everything the mod adds, changes or removes compared with
// the game (and the mod's hand-written main.lua), grouped like the changes
// menu, written on every save
export function differencesMarkdown(modName: string): string {
  const lines = [
    `# ${modName}: what it changes`,
    "",
    "Everything this mod adds or changes compared with the original game. Written by G1R Studio on every save.",
    "",
  ];
  const groups = grouped();
  if (!groups.length) lines.push("Nothing yet.", "");
  for (const [group, changes] of groups) {
    const [heading] = NAMES[group] ?? [group];
    lines.push(`## ${heading}`, "");
    for (const { registry, id, record, part, label, note } of changes) {
      const base = store.baseTable(registry);
      const name = label ?? globalLabelOf(registry, id) ?? displayName(record, id, registry);
      if (part) lines.push(`- ${name}: ${part.base === undefined ? "new" : record === null ? "removed" : note ?? "changed"}`);
      else if (record === null) lines.push(`- ${name}: removed`);
      else if (!(id in base) && !globalLabelOf(registry, id)) lines.push(`- ${name}: new`);
      else {
        const fields = changedFields(base[id], record);
        lines.push(`- ${name}${fields.length ? `: ${fields.join(", ")}` : ": changed"}`);
      }
    }
    lines.push("");
  }
  return lines.join("\n");
}

export function mountChangesMenu(): HTMLElement {
  const badge = h("span", { class: "badge" });
  const dot = h("span", { class: "unsaved-dot", title: "Unsaved" });
  const button = h(
    "button",
    { class: "btn icon changes-btn" },
    icon(FileDiff),
    badge,
    dot,
  );
  const panel = h("div", { class: "menu" });
  const { root, close } = dropdown(button, panel, () => render());

  const render = () => {
    clear(panel);
    const groups = grouped();
    if (!groups.length) {
      panel.append(h("p", { class: "hint empty" }, "No changes against the game yet."));
      return;
    }
    for (const [group, changes] of groups) {
      const [heading] = NAMES[group] ?? [group];
      panel.append(h("div", { class: "menu-head" }, h("span", {}, heading), h("span", { class: "muted" }, String(changes.length))));
      for (const { registry, id, record, part, label, open: own } of changes) {
        const removed = record === null;
        const global = label ?? globalLabelOf(registry, id);
        // global settings always exist in the game, even when the dataset omits a default
        const added = !removed && !global && (part ? part.base === undefined : !(id in store.baseTable(registry)));
        const open = label ? own ?? null : opener(registry, id, removed);
        panel.append(
          h(
            "button",
            {
              class: "menu-row",
              disabled: !open,
              title: unusedEffect(registry, id, record) ? "Not used by any move or item: click to remove it" : open ? "Open" : "Nothing to open",
              onclick: () => {
                close();
                open?.();
              },
            },
            h("span", { class: "changes-name" }, global ?? displayName(record, id, registry)),
            unusedEffect(registry, id, record) ? h("span", { class: "tag removed" }, "unused · remove")
              : removed ? h("span", { class: "tag removed" }, "removed") : added ? h("span", { class: "tag new" }, "new") : null,
          ),
        );
      }
    }
  };

  const refresh = () => {
    const { total, text } = store.project ? changeSummary() : { total: 0, text: "" };
    root.hidden = !store.project;
    badge.textContent = total ? String(total > 999 ? "999+" : total) : "";
    badge.hidden = !total;
    dot.hidden = !store.unsaved;
    const label = total ? `${text} changed` : "No changes";
    button.title = `${label}${store.unsaved ? " · unsaved" : ""}\nClick to list them`;
    button.setAttribute("aria-label", `Changes: ${label}`);
    if (!panel.hidden) render();
  };
  const afterBrush = afterStroke(refresh);
  store.on((reason) => {
    if (store.midStroke(reason)) afterBrush();
    else if (["edit", "content", "project", "saved", "map"].includes(reason)) refresh();
  });
  refresh();
  return root;
}
