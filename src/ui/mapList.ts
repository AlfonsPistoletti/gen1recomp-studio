import { mapChanged } from "./mapReset.ts";
import { store } from "../core/store.ts";
import type { MapView } from "../render/mapView.ts";
import { Swords } from "lucide";
import { clear, h, icon, listFocus, listKeys } from "./dom.ts";
import { hasWild } from "./encounterPanel.ts";

// Left sidebar: searchable list of maps, edited ones first.
export function mountMapList(host: HTMLElement, view: MapView, onNewMap: () => void): void {
  const search = h("input", { type: "search", placeholder: "Search maps…  (Ctrl+F)", spellcheck: false, id: "map-search" });
  const list = h("div", { class: "map-list", role: "listbox" });
  listKeys(list);
  host.append(
    h("div", { class: "panel-head" }, h("span", {}, "Maps"), h("button", { class: "btn small", onclick: onNewMap, title: "Create a new map" }, "+ New")),
    h("div", { class: "panel-pad" }, search),
    list,
  );

  let query = "";
  // height of the pinned "Edited" block, through the "All maps" header
  const pinnedHeight = () => {
    const all = list.querySelector<HTMLElement>(".all-maps");
    return all ? all.offsetTop + all.offsetHeight - list.offsetTop : 0;
  };
  const render = () => {
    const scrollTop = list.scrollTop;
    const pinnedBefore = pinnedHeight();
    const refocus = listFocus(list);
    clear(list);
    if (!store.project) return;
    const q = query.toLowerCase();
    const ids = Object.keys(store.maps)
      .filter((id) => !q || id.toLowerCase().includes(q) || String(store.maps[id].label ?? "").toLowerCase().includes(q))
      .sort();
    // edited maps are listed twice: pinned on top for quick access, and in
    // their usual alphabetical place so they never seem to vanish
    const edited = ids.filter((id) => mapChanged(store.maps[id]));
    const row = (id: string) => {
      const m = store.maps[id];
      const isNew = !store.base[id];
      return h(
        "button",
        {
          class: `map-row${id === store.currentMap ? " active" : ""}`,
          onclick: () => {
            view.openMap(id);
            view.fitMap();
          },
          title: `${id} · ${m.tileset} · ${m.width}×${m.height} blocks`,
          "data-id": id,
        },
        h("span", { class: "map-name" }, id),
        hasWild(id) ? h("span", { class: "wild-icon", title: "Has wild encounters" }, icon(Swords, 12)) : null,
        isNew ? h("span", { class: "tag new" }, "new") : edited.includes(id) ? h("span", { class: "tag edited" }, "edited") : null,
        h("span", { class: "map-meta" }, `${m.width}×${m.height}`),
      );
    };
    if (edited.length) {
      list.append(h("div", { class: "list-section" }, `Edited (${edited.length})`), ...edited.map(row));
      list.append(h("div", { class: "list-section all-maps" }, "All maps"));
    }
    list.append(...ids.map(row));
    // the list never scrolls by itself; keep wherever the user left it, even
    // when the pinned "Edited" section above grows or shrinks
    const shift = scrollTop > pinnedBefore ? pinnedHeight() - pinnedBefore : 0;
    list.scrollTop = scrollTop + shift;
    refocus();
  };

  search.addEventListener("input", () => {
    query = search.value.trim();
    render();
  });
  search.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    // exact id first, then ids starting with the query, then any match
    const q = query.toUpperCase();
    const rows = [...list.querySelectorAll<HTMLButtonElement>(".map-row")];
    const name = (r: HTMLButtonElement) => r.querySelector(".map-name")?.textContent ?? "";
    const best = rows.find((r) => name(r) === q) ?? rows.find((r) => name(r).startsWith(q)) ?? rows[0];
    if (best) {
      best.click();
      search.blur();
    }
  });
  // a brush stroke emits an edit per block; rebuild the list once per frame
  let queued = false;
  store.on((reason, _id, registry) => {
    // events, music, rules, ... of a map count as its changes too
    const wildChanged = reason === "content" && !!registry;
    if (!(["project", "map", "edit", "saved"].includes(reason) || wildChanged) || queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      render();
    });
  });
}
