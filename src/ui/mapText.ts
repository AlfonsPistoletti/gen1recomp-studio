// What an NPC or sign says. Gen 1 chain (src/core/Data.lua resolveText):
//   map object/sign `text` = TEXT_* id
//   -> text_pointers[map.label][TEXT_*] = { text = "_Key" } (or { label })
//   -> text["_Key"] = the string
// A hand-written map script in the game can take over a TEXT_* id; the
// studio cannot see those (release builds pack them into the exe).

import { store } from "../core/store.ts";
import type { EntityRecord, MapDef } from "../core/types.ts";
import { h } from "./dom.ts";
import { nav } from "./nav.ts";
import { textEditor } from "./textField.ts";

export interface PointerEntry {
  text?: string;
  label?: string;
  asm?: boolean | string;
  mart?: unknown;
  nurse?: unknown;
  pc?: unknown;
  cableClub?: unknown;
  [k: string]: unknown;
}

export function hasTextPointers(): boolean {
  return !!store.adapter?.content.some((c) => c.registry === "text_pointers");
}

export function pointerEntry(label: string, textId: string): PointerEntry | undefined {
  const perMap = store.table("text_pointers")[label] as Record<string, PointerEntry> | undefined;
  return perMap?.[textId];
}

// The text key a pointer shows, when it resolves to one.
export function resolvedKey(entry: PointerEntry | undefined): string | undefined {
  if (!entry) return undefined;
  const text = store.table("text");
  if (entry.text && typeof text[entry.text] === "string") return entry.text;
  if (entry.label && typeof text[`_${entry.label}`] === "string") return `_${entry.label}`;
  return entry.text;
}

// Every place on the maps that shows a text key: [map, layer key, index, TEXT_* id].
export function usesOfText(key: string): { mapId: string; layer: string; index: number; textId: string }[] {
  const out: { mapId: string; layer: string; index: number; textId: string }[] = [];
  for (const map of Object.values(store.maps)) {
    const label = typeof map.label === "string" ? map.label : null;
    if (!label) continue;
    for (const layer of store.adapter.layers) {
      store.entities(map, layer.key).forEach((e, index) => {
        if (typeof e.text !== "string") return;
        if (resolvedKey(pointerEntry(label, e.text)) === key) out.push({ mapId: map.id, layer: layer.key, index, textId: e.text });
      });
    }
  }
  return out;
}

function newTextKey(label: string, textId: string): string {
  // TEXT_PALLETTOWN_STUDIO on PalletTown -> _PalletTownStudioText
  const words = textId.replace(/^TEXT_/, "").replace(new RegExp(`^${label.toUpperCase()}_`), "").toLowerCase().split("_").filter(Boolean);
  const base = `_${label}${words.map((w) => w[0].toUpperCase() + w.slice(1)).join("")}Text`;
  const text = store.table("text");
  let key = base;
  for (let n = 2; text[key] !== undefined; n++) key = `${base}${n}`;
  return key;
}

// A TEXT_* id nothing on this map uses yet: TEXT_<MAPLABEL>_<what>, where
// <what> comes from the NPC's name (minus the map prefix) or "SIGN_<n>".
function newTextId(map: MapDef, label: string, base: string): string {
  const prefix = `TEXT_${label.toUpperCase()}_`;
  const clean = base.toUpperCase().replace(/[^A-Z0-9_]/g, "_").replace(/^_+|_+$/g, "") || "TEXT";
  const taken = new Set(Object.keys((store.table("text_pointers")[label] as Record<string, unknown> | undefined) ?? {}));
  for (const layer of store.adapter.layers) for (const e of store.entities(map, layer.key)) if (typeof e.text === "string") taken.add(e.text);
  let id = prefix + clean;
  for (let n = 2; taken.has(id); n++) id = `${prefix}${clean}_${n}`;
  return id;
}

// What a new id is named after: the NPC's own name without the map's
// prefix (VERMILION_CITY_NPC_7 -> NPC_7), or the sign's number.
function idBase(map: MapDef, entity: EntityRecord, kind: string, index: number): string {
  const name = typeof entity.name === "string" ? entity.name : "";
  const stripped = name.replace(new RegExp(`^(${map.id}|${String(map.label ?? "").toUpperCase()})_`), "");
  return stripped || `${kind === "sign" ? "SIGN" : "NPC"}_${index + 1}`;
}

// Points the entity at a brand-new text id and string (one undo step).
// Nothing existing is changed: id, pointer and text key are all fresh.
function createOwnText(map: MapDef, label: string, base: string, initial: string, setTextId: (id: string) => void): void {
  const textId = newTextId(map, label, base);
  const key = newTextKey(label, textId);
  store.group(`Create text ${textId}`, () => {
    setTextId(textId);
    store.editRecord<Record<string, PointerEntry>>("text_pointers", label, "Text pointer", (d) => (d[textId] = { text: key }), { create: () => ({}) });
    store.setRecord("text", key, "New text", initial);
  });
}

// Inspector section under an NPC's/sign's fields: what it says, editable in
// place, or a button that sets everything up for a new line.
export function npcTextSection(
  map: MapDef,
  entity: EntityRecord,
  kind: string,
  index: number,
  setTextId: (id: string) => void,
): HTMLElement | null {
  if (!hasTextPointers()) return null;
  const textId = typeof entity.text === "string" ? entity.text : "";
  const label = typeof map.label === "string" ? map.label : "";
  const wrap = h("div", { class: "field-group npc-text" }, h("h4", {}, "Says"));
  if (!label) {
    wrap.append(h("p", { class: "hint warn" }, "Give the map a Label (map properties) so its texts can be set up."));
    return wrap;
  }
  const base = idBase(map, entity, kind, index);
  const fresh = (text: string) => h("button", { class: "btn small primary-ish", onclick: () => createOwnText(map, label, base, text, setTextId) }, "Create text");
  const validId = /^TEXT_[A-Z0-9_]+$/.test(textId) && textId !== "TEXT_";
  const entry = validId ? pointerEntry(label, textId) : undefined;
  const key = resolvedKey(entry);
  if (!validId || !entry) {
    wrap.append(
      h("p", { class: "hint" }, validId ? `No text set up for ${textId} on ${label} yet.` : `This ${kind === "sign" ? "sign" : "NPC"} has no text yet.`),
      h(
        "div",
        { class: "row" },
        validId
          ? h("button", {
              class: "btn small",
              title: `Creates a new text for ${textId}`,
              onclick: () => {
                const newKey = newTextKey(label, textId);
                store.group(`Create text ${textId}`, () => {
                  store.editRecord<Record<string, PointerEntry>>("text_pointers", label, "Text pointer", (d) => (d[textId] = { text: newKey }), { create: () => ({}) });
                  store.setRecord("text", newKey, "New text", "...{DONE}");
                });
              },
            }, "Create text")
          : fresh("...{DONE}"),
      ),
      h("p", { class: "hint" }, "Makes a new text id and a new line of text. Existing texts are never changed."),
    );
    return wrap;
  }
  if (!key) {
    wrap.append(h("p", { class: "hint" }, `${textId} runs game logic and has no plain text.`));
    return wrap;
  }
  const special = ["mart", "nurse", "pc", "cableClub"].filter((k) => entry[k]);
  if (special.length) wrap.append(h("p", { class: "hint warn" }, `Special: ${special.join(", ")}. The game runs that behaviour after the text.`));
  if (entry.asm) wrap.append(h("p", { class: "hint warn" }, "This text runs game logic (text_asm); the game may show more than this."));
  // an original line may be shown elsewhere too; offer a copy for just this one
  const original = store.baseTable("text")[key] !== undefined;
  const uses = usesOfText(key).length;
  if (original) {
    wrap.append(
      h(
        "div",
        { class: "row" },
        h("span", { class: "hint warn" }, `Original game text${uses > 1 ? `, used in ${uses} places` : ""}: editing it changes it everywhere.`),
        h("button", {
          class: "btn small",
          title: "Gives this one its own copy of the text to edit; the original stays as it is",
          onclick: () => createOwnText(map, label, base, String(store.table("text")[key] ?? ""), setTextId),
        }, "New text for this one"),
      ),
    );
  }
  wrap.append(
    textEditor(key, { rows: 4, compact: true, label: key }),
    h(
      "div",
      { class: "row" },
      h("button", { class: "btn small ghost", onclick: () => nav.openText(key) }, "Open in Text →"),
      h("span", { class: "hint" }, "NPCs with a hand-written script in the game may say something else."),
    ),
  );
  return wrap;
}
