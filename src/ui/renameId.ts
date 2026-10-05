// Giving a mod's own record a new id (STEELIX -> ICELIX) with every
// reference following: the record, records keyed by the same id (move
// animations, ball numbers, trainer AI), an id-derived text key (the dex
// entry), and references in every other registry and on the maps, found
// through the adapter's RenameSpec fields only. One undo step.
//
// Vanilla ids never change: the game, saves and other mods rely on them. A
// mod's own id is only safe to change before players have saves with it.

import { clone, isPlainObject } from "../core/merge.ts";
import { store } from "../core/store.ts";
import type { RenameSpec } from "../games/types.ts";
import { h, toast } from "./dom.ts";

function spec(registry: string): RenameSpec | undefined {
  return store.adapter?.renames?.[registry];
}

// only records this mod added
export function canRename(registry: string, id: string): boolean {
  return !!spec(registry) && store.table(registry)[id] !== undefined && store.baseTable(registry)[id] === undefined;
}

// the id a display name suggests (ICE LIX -> ICE_LIX, Mr. Mime -> MR_MIME)
export function idFromName(registry: string, name: string): string {
  const s = spec(registry);
  const body = name.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (!body) return "";
  return s?.prefix && !body.startsWith(s.prefix) ? s.prefix + body : body;
}

// why `next` can't be used, or null
export function renameProblem(registry: string, next: string): string | null {
  const s = spec(registry);
  if (!s) return "This kind of record can't be renamed.";
  if (!/^[A-Z][A-Z0-9_]*$/.test(next)) return "Ids are UPPER_SNAKE_CASE: letters, digits and _.";
  if (s.prefix && !next.startsWith(s.prefix)) return `Ids here start with ${s.prefix}.`;
  if (store.table(registry)[next] !== undefined || store.baseTable(registry)[next] !== undefined) return `${next} is already taken.`;
  for (const k of s.keyed) if (store.table(k)[next] !== undefined) return `${next} is already used by ${k}.`;
  return null;
}

// a copy of `value` with the id references swapped, or the same value when
// nothing referred to `from`
function rewrite(value: unknown, s: RenameSpec, registry: string, from: string, to: string, key = ""): unknown {
  if (typeof value === "string") return s.fields.includes(key) && value === from ? to : value;
  if (Array.isArray(value)) {
    let changed = false;
    const out = value.map((v) => {
      const next = s.lists.includes(key) && typeof v === "string" ? (v === from ? to : v) : rewrite(v, s, registry, from, to, key);
      if (next !== v) changed = true;
      return next;
    });
    return changed ? out : value;
  }
  if (isPlainObject(value)) {
    // a reference to another record: { __ref = "battle_anims:<id>" }
    const ref = value.__ref;
    if (typeof ref === "string") {
      const [reg, id] = [ref.slice(0, ref.indexOf(":")), ref.slice(ref.indexOf(":") + 1)];
      return id === from && (reg === registry || s.keyed.includes(reg)) ? { ...value, __ref: `${reg}:${to}` } : value;
    }
    let changed = false;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const next = rewrite(v, s, registry, from, to, k);
      if (next !== v) changed = true;
      out[k] = next;
    }
    return changed ? out : value;
  }
  return value;
}

function getPath(rec: unknown, path: string[]): unknown {
  let node = rec;
  for (const k of path) node = isPlainObject(node) ? node[k] : undefined;
  return node;
}

function setPath(rec: Record<string, unknown>, path: string[], value: unknown): void {
  let node = rec;
  for (const k of path.slice(0, -1)) {
    node[k] = { ...((node[k] as Record<string, unknown> | undefined) ?? {}) };
    node = node[k] as Record<string, unknown>;
  }
  node[path[path.length - 1]] = value;
}

// Renames; returns false (with a message shown) when it can't.
export function renameId(registry: string, from: string, to: string): boolean {
  const s = spec(registry);
  const problem = !canRename(registry, from) ? `${from} is not one of this mod's own records.` : renameProblem(registry, to);
  if (!s || problem) {
    toast(problem ?? "Can't rename", "error");
    return false;
  }
  store.group(`Rename ${from} → ${to}`, () => {
    // the record itself
    const rec = clone(store.table(registry)[from]) as Record<string, unknown>;
    if ("id" in rec) rec.id = to;
    // a text key named after the id (the dex entry) moves along
    if (s.derivedText) {
      const oldKey = s.derivedText.key(from);
      const newKey = s.derivedText.key(to);
      const text = store.table("text");
      if (getPath(rec, s.derivedText.field) === oldKey && typeof text[oldKey] === "string" && text[newKey] === undefined) {
        store.setRecord("text", newKey, "Rename text", text[oldKey]);
        if (store.baseTable("text")[oldKey] === undefined) store.setRecord("text", oldKey, "Rename text", undefined);
        setPath(rec, s.derivedText.field, newKey);
      }
    }
    store.setRecord(registry, from, `Rename ${from}`, undefined);
    store.setRecord(registry, to, `Rename ${from}`, rewrite(rec, s, registry, from, to));
    // records of other registries stored under the same id
    for (const k of s.keyed) {
      const v = store.table(k)[from];
      if (v === undefined) continue;
      store.setRecord(k, to, "Rename", rewrite(clone(v), s, registry, from, to));
      store.setRecord(k, from, "Rename", undefined);
    }
    // references everywhere else (prose in `text` is never touched)
    for (const c of store.adapter.content) {
      if (!c.editable || c.registry === "text") continue;
      for (const [id, value] of Object.entries(store.table(c.registry))) {
        if (c.registry === registry && id === to) continue;
        const next = rewrite(value, s, registry, from, to);
        if (next !== value) store.setRecord(c.registry, id, `Rename ${from}`, next);
      }
    }
    for (const [mapId, map] of Object.entries(store.maps)) {
      const next = rewrite(map, s, registry, from, to) as Record<string, unknown>;
      if (next !== (map as unknown)) store.edit(mapId, `Rename ${from}`, (d) => Object.assign(d, next));
    }
  });
  store.seal();
  return true;
}

// The Id row of an editor: plain for vanilla records; for the mod's own, an
// editable id, plus a one-click rename when the name suggests another id.
export function idRow(registry: string, id: string, name: string, onRenamed: (to: string) => void, extra: HTMLElement[] = []): HTMLElement {
  if (!canRename(registry, id)) return h("div", { class: "kv" }, h("span", {}, "Id"), h("code", {}, id), ...extra);
  const input = h("input", { type: "text", value: id, spellcheck: false, class: "mono id-input" });
  const go = (to: string) => {
    if (to === id) return;
    if (renameId(registry, id, to)) onRenamed(to);
  };
  const button = h("button", { class: "btn small", onclick: () => go(input.value.trim().toUpperCase()) }, "Rename id");
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") go(input.value.trim().toUpperCase());
  });
  const suggested = idFromName(registry, name);
  const offer = suggested && suggested !== id && !renameProblem(registry, suggested)
    ? h("div", { class: "row" }, h("span", { class: "hint" }, `The name suggests the id ${suggested}.`), h("button", { class: "btn small primary-ish", onclick: () => go(suggested) }, `Rename id to ${suggested}`))
    : null;
  return h(
    "div",
    { class: "field" },
    h("span", { class: "field-label" }, "Id"),
    h("div", { class: "row nowrap" }, input, button, ...extra),
    offer,
    h("p", { class: "hint" }, "Renaming updates every reference in the mod. Only rename before players have saves with this mod: a save still holding the old id loses it."),
  );
}
