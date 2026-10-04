// Top-bar "Changes" button: an icon with the number of changed records, and a
// dropdown listing them grouped by registry. Each entry opens its page.

import { FileDiff } from "lucide";
import { store } from "../core/store.ts";
import { h, clear, icon } from "./dom.ts";
import { nav } from "./nav.ts";
import { globalLabelOf, globalSectionOf } from "./globalWorkspace.ts";

// registry -> [heading, singular]; also the display order
const NAMES: Record<string, [string, string]> = {
  maps: ["Maps", "map"],
  encounters: ["Wild tables", "wild table"],
  text_pointers: ["Map text pointers", "text pointer"],
  pokemon: ["Pokémon", "Pokémon"],
  moves: ["Moves", "move"],
  studio_effects: ["Custom move effects", "custom effect"],
  battle_anims: ["Move animations", "move animation"],
  trainers: ["Trainers", "trainer"],
  ai_classes: ["Trainer AI", "trainer AI"],
  text: ["Texts", "text"],
  constants: ["Global settings", "global setting"],
  type_chart: ["Type chart", "type chart entry"],
};

// one line per registry ("3 maps · 1 Pokémon"), for the tooltip
export function changeSummary(): { total: number; text: string } {
  const parts: string[] = [];
  let total = 0;
  for (const [registry, records] of ordered()) {
    const n = Object.keys(records).length;
    total += n;
    const [heading, one] = NAMES[registry] ?? [registry, registry];
    parts.push(`${n} ${n === 1 ? one : heading.toLowerCase()}`);
  }
  return { total, text: parts.join(" · ") };
}

function ordered(): [string, Record<string, unknown>][] {
  const order = Object.keys(NAMES);
  const rank = (r: string) => (order.includes(r) ? order.indexOf(r) : order.length);
  return Object.entries(store.changed()).sort(([a], [b]) => rank(a) - rank(b));
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
    case "moves":
    case "battle_anims":
      return store.table("moves")[id] ? () => nav.openMove(id) : null;
    case "studio_effects": {
      const user = Object.entries(store.table("moves")).find(([, m]) => (m as { effect?: unknown }).effect === id)?.[0];
      return user ? () => nav.openMove(user) : null;
    }
    case "trainers":
      return removed ? null : () => nav.openTrainer(id);
    case "ai_classes":
      return store.table("trainers")[id] ? () => nav.openTrainer(id) : null;
    case "text":
      return removed ? null : () => nav.openText(id);
  }
  return null;
}

function displayName(record: unknown, id: string): string {
  const name = record && typeof record === "object" ? (record as { name?: unknown }).name : undefined;
  return typeof name === "string" && name && name.toUpperCase() !== id.toUpperCase() ? `${id} · ${name}` : id;
}

export function mountChangesMenu(): HTMLElement {
  const badge = h("span", { class: "badge" });
  const dot = h("span", { class: "unsaved-dot", title: "Unsaved" });
  const button = h(
    "button",
    { class: "btn icon changes-btn", "aria-haspopup": "true", "aria-expanded": "false", onclick: () => toggle() },
    icon(FileDiff),
    badge,
    dot,
  );
  const panel = h("div", { class: "changes-menu", hidden: true });
  const root = h("div", { class: "changes" }, button, panel);

  const close = () => {
    panel.hidden = true;
    button.setAttribute("aria-expanded", "false");
  };
  const toggle = () => {
    if (!panel.hidden) return close();
    render();
    panel.hidden = false;
    button.setAttribute("aria-expanded", "true");
  };
  document.addEventListener("mousedown", (e) => {
    if (!panel.hidden && !root.contains(e.target as Node)) close();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !panel.hidden) close();
  });

  const render = () => {
    clear(panel);
    const groups = ordered();
    if (!groups.length) {
      panel.append(h("p", { class: "hint empty" }, "No changes against the game yet."));
      return;
    }
    for (const [registry, records] of groups) {
      const ids = Object.keys(records).sort();
      const [heading] = NAMES[registry] ?? [registry];
      panel.append(h("div", { class: "changes-head" }, h("span", {}, heading), h("span", { class: "muted" }, String(ids.length))));
      for (const id of ids) {
        const record = records[id];
        const removed = record === null;
        const global = globalLabelOf(registry, id);
        // global settings always exist in the game, even when the dataset omits a default
        const added = !removed && !global && !(id in store.baseTable(registry));
        const open = opener(registry, id, removed);
        panel.append(
          h(
            "button",
            {
              class: "changes-row",
              disabled: !open,
              title: open ? "Open" : "Nothing to open",
              onclick: () => {
                close();
                open?.();
              },
            },
            h("span", { class: "changes-name" }, global ?? displayName(record, id)),
            removed ? h("span", { class: "tag removed" }, "removed") : added ? h("span", { class: "tag new" }, "new") : null,
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
  store.on((reason) => {
    if (["edit", "content", "project", "saved", "map"].includes(reason)) refresh();
  });
  refresh();
  return root;
}
