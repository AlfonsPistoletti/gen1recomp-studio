// Reverting (or deleting) a map: besides the map record itself (layout,
// warps, NPCs, signs), much of what belongs to a map lives in other tables
// keyed by its id or label: events, music, wild Pokémon, text pointers (NPC
// roles), hidden events and the landing spot (field), prize counters. The
// dialog lists the parts that differ from the game and reverts the ticked
// ones as one undo step.

import { clone, deepEqual } from "../core/merge.ts";
import { store } from "../core/store.ts";
import type { MapDef } from "../core/types.ts";
import { h } from "./dom.ts";

interface Part {
  label: string;
  detail: string;
  revert: () => void;
}

const regExists = (r: string) => store.adapter.content.some((c) => c.registry === r);

// one record of `registry` back to the game's (or gone when the game has none)
function revertRecord(registry: string, id: string): void {
  store.setRecord(registry, id, "Revert map", clone(store.baseTable(registry)[id]));
}

// field tables keyed by map id: hiddenExtras.<kind>, hiddenItems, hiddenCoins, flyWarps
function fieldPaths(): string[][] {
  const t = store.adapter.towns;
  if (!t) return [];
  const paths = t.hidden.map((k) => k.path);
  paths.push(["flyWarps"]);
  return paths;
}

function at(node: unknown, path: string[]): unknown {
  for (const k of path) node = (node as Record<string, unknown> | undefined)?.[k];
  return node;
}

function changedFieldPaths(mapId: string): string[][] {
  const t = store.adapter.towns;
  if (!t) return [];
  const now = store.table(t.fieldRegistry);
  const base = store.baseTable(t.fieldRegistry);
  return fieldPaths().filter((p) => !deepEqual(at(now, [...p, mapId]), at(base, [...p, mapId])));
}

function revertFieldPath(mapId: string, path: string[]): void {
  const t = store.adapter.towns!;
  const [top, ...rest] = path;
  const baseValue = at(store.baseTable(t.fieldRegistry), [...path, mapId]);
  store.editRecord<Record<string, unknown>>(t.fieldRegistry, top, "Revert map", (d) => {
    let node = d;
    for (const k of rest) {
      node[k] = { ...((node[k] as Record<string, unknown> | undefined) ?? {}) };
      node = node[k] as Record<string, unknown>;
    }
    if (baseValue === undefined) delete node[mapId];
    else node[mapId] = clone(baseValue);
  }, { create: () => ({}) });
}

// the parts of the map that differ from the game (layout first)
export function changedParts(map: MapDef, includeLayout: boolean): Part[] {
  const parts: Part[] = [];
  const id = map.id;
  const label = typeof map.label === "string" ? map.label : "";
  if (includeLayout && store.isEdited(id)) {
    parts.push({ label: "Layout", detail: "blocks, size, connections, warps, NPCs and signs", revert: () => {} });
  }
  const ev = store.adapter.events?.registry;
  if (ev) {
    const ids = Object.keys(store.table(ev)).filter((k) => k.startsWith(`${id}:`));
    if (ids.length) {
      const kinds = ids.map((k) => k.split(":")[1]);
      const count = (k: string) => kinds.filter((x) => x === k).length;
      const what = [["talk", "talk"], ["step", "step"], ["enter", "enter"]].filter(([k]) => count(k)).map(([k, n]) => `${count(k)} ${n}`).join(", ");
      parts.push({ label: "Events", detail: `${what} event${ids.length === 1 ? "" : "s"} (trainers' line of sight included)`, revert: () => ids.forEach((k) => store.setRecord(ev, k, "Revert map", undefined)) });
    }
  }
  if (regExists("map_songs") && store.isRecordEdited("map_songs", id)) parts.push({ label: "Music", detail: "the map's song", revert: () => revertRecord("map_songs", id) });
  if (regExists("encounters") && store.isRecordEdited("encounters", id)) parts.push({ label: "Wild Pokémon", detail: "grass and water tables", revert: () => revertRecord("encounters", id) });
  if (label && regExists("text_pointers") && store.isRecordEdited("text_pointers", label)) {
    parts.push({ label: "NPC texts & roles", detail: "which text each NPC/sign says, shop clerks, nurses (the texts themselves stay)", revert: () => revertRecord("text_pointers", label) });
  }
  const fp = changedFieldPaths(id);
  if (fp.length) parts.push({ label: "Hidden events & landing spot", detail: "PCs, bench guys, hidden items/coins, gym statues, landing spot", revert: () => fp.forEach((p) => revertFieldPath(id, p)) });
  const pr = store.adapter.towns?.prizeRegistry;
  if (pr) {
    const ids = [...new Set([...Object.keys(store.table(pr)), ...Object.keys(store.baseTable(pr))])].filter((k) => k.startsWith(`${id}:`) && store.isRecordEdited(pr, k));
    if (ids.length) parts.push({ label: "Prize counters", detail: `${ids.length} counter${ids.length === 1 ? "" : "s"}`, revert: () => ids.forEach((k) => revertRecord(pr, k)) });
  }
  return parts;
}

// Revert (a game map) or delete (a new one) with its attached parts.
export function resetMapDialog(map: MapDef, isNew: boolean, revertLayout: () => void, deleteMap: () => void): void {
  const parts = changedParts(map, !isNew);
  const boxes = parts.map((p) => ({ p, box: h("input", { type: "checkbox", checked: true }) }));
  const dialog = h("dialog", { class: "modal" });
  const close = () => {
    dialog.close();
    dialog.remove();
  };
  const go = h("button", {
    class: "btn danger",
    onclick: () => {
      const chosen = boxes.filter((b) => b.box.checked).map((b) => b.p);
      store.group(isNew ? `Delete ${map.id}` : `Revert ${map.id}`, () => {
        for (const p of chosen) if (p.label !== "Layout") p.revert();
        if (isNew) deleteMap();
        else if (chosen.some((p) => p.label === "Layout")) revertLayout();
      });
      store.seal();
      close();
    },
  }, isNew ? "Delete map" : "Revert");
  dialog.append(
    h("h3", {}, isNew ? `Delete ${map.id}?` : `Revert ${map.id} to the game's version?`),
    isNew ? h("p", { class: "hint" }, "Also delete what belongs to it:") : h("p", { class: "hint" }, "What to put back the way the game has it:"),
    ...(boxes.length
      ? boxes.map(({ p, box }) => h("label", { class: "ai-layer" }, box, h("span", {}, h("strong", {}, p.label), h("span", { class: "hint" }, p.detail))))
      : [h("p", { class: "hint" }, "Nothing else belongs to it.")]),
    h("p", { class: "hint" }, "One undo step (Ctrl+Z brings it all back)."),
    h("div", { class: "dialog-actions" }, h("button", { class: "btn", onclick: close }, "Cancel"), go),
  );
  document.body.append(dialog);
  dialog.showModal();
}
