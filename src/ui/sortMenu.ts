// A list's sort button (left panel head): a menu of sort keys, grouped, and
// the direction. Picking the active key again flips the direction. The
// choice is remembered per list (this viewer only).

import { ArrowDown, ArrowDownUp, ArrowUp } from "lucide";
import { dropdown, h, icon } from "./dom.ts";
import { recall, remember } from "./storage.ts";

export interface SortOption {
  id: string;
  label: string;
  group?: string;
  // the direction it starts in (stats: highest first)
  desc?: boolean;
}

export interface SortState {
  id: string;
  desc: boolean;
}

export interface SortMenu {
  el: HTMLElement;
  state(): SortState;
}

// `options()` is read each time the menu opens (they can depend on the game);
// the first option is the default
export function sortMenu(key: string, options: () => SortOption[], onChange: () => void): SortMenu {
  const storeKey = `studio.sort.${key}`;
  let state: SortState | null = null;
  try {
    const saved = JSON.parse(recall(storeKey) ?? "null") as SortState | null;
    if (saved && typeof saved.id === "string") state = { id: saved.id, desc: !!saved.desc };
  } catch {
    state = null;
  }
  const current = (): SortState => {
    const opts = options();
    const found = state && opts.find((o) => o.id === state!.id);
    if (found && state) return state;
    const first = opts[0];
    return { id: first?.id ?? "", desc: !!first?.desc };
  };

  const button = h("button", { class: "btn small icon sort-btn", "aria-label": "Sort" }, icon(ArrowDownUp, 14));
  const panel = h("div", { class: "menu sort-menu" });
  const set = (next: SortState) => {
    state = next;
    remember(storeKey, JSON.stringify(next));
    menu.close();
    refresh();
    onChange();
  };
  const render = () => {
    const opts = options();
    const cur = current();
    panel.replaceChildren();
    let group: string | undefined;
    for (const o of opts) {
      if (o.group !== group) {
        group = o.group;
        if (group) panel.append(h("div", { class: "menu-head" }, group));
      }
      const active = o.id === cur.id;
      const row = h(
        "button",
        {
          class: `menu-row${active ? " active" : ""}`,
          title: active ? "Click again to reverse the order" : "",
          onclick: () => set(active ? { id: o.id, desc: !cur.desc } : { id: o.id, desc: !!o.desc }),
        },
        h("span", { class: "changes-name" }, o.label),
        active ? icon(cur.desc ? ArrowDown : ArrowUp, 14) : null,
      );
      panel.append(row);
    }
  };
  const menu = dropdown(button, panel, render);
  const refresh = () => {
    const opts = options();
    const cur = current();
    const label = opts.find((o) => o.id === cur.id)?.label ?? "";
    button.title = `Sort: ${label}${cur.desc ? " (descending)" : ""}`;
    // anything but the default order is marked
    button.classList.toggle("active", !!opts[0] && (cur.id !== opts[0].id || cur.desc !== !!opts[0].desc));
  };
  refresh();
  return {
    el: menu.root,
    state: () => {
      refresh();
      return current();
    },
  };
}
