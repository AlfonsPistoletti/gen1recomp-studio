import { store } from "../core/store.ts";
import { clear, h, listFocus, listKeys } from "./dom.ts";

// Left-panel list for a workspace: search box, edited records pinned on
// top (and kept in their usual place too), never scrolls by itself. Shares
// the look of the map list.

export interface ListItem {
  id: string;
  label: string;
  meta?: string;
  // extra text the search matches (besides id and label)
  search?: string;
  icon?: string; // image URL
  edited: boolean;
  isNew?: boolean;
  // listed in the collapsed `folded` section at the bottom
  folded?: boolean;
  // extra labels after the name ("player")
  tags?: string[];
}

export interface RecordListOptions {
  title: string;
  placeholder: string;
  searchId: string;
  head?: HTMLElement[];
  items(): ListItem[];
  current(): string | null;
  pick(id: string): void;
  // a collapsed section at the end for rarely wanted records
  folded?: { label: string; hint: string };
  // store events that change the list (besides project/saved)
  refreshOn(reason: string, id?: string, registry?: string): boolean;
}

export interface RecordList {
  render(): void;
  search: HTMLInputElement;
}

export function mountRecordList(host: HTMLElement, opts: RecordListOptions): RecordList {
  const search = h("input", { type: "search", placeholder: opts.placeholder, spellcheck: false, id: opts.searchId });
  const list = h("div", { class: "map-list", role: "listbox" });
  listKeys(list);
  host.append(h("div", { class: "panel-head" }, h("span", {}, opts.title), opts.head?.length ? h("div", { class: "row nowrap" }, ...opts.head) : null), h("div", { class: "panel-pad" }, search), list);

  let query = "";
  let foldOpen = false;
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
    const items = opts.items().filter((it) => !q || `${it.id}\n${it.label}\n${it.search ?? ""}`.toLowerCase().includes(q));
    const current = opts.current();
    const row = (it: ListItem) =>
      h(
        "button",
        { class: `map-row${it.id === current ? " active" : ""}`, onclick: () => opts.pick(it.id), title: it.id, "data-id": it.id },
        it.icon ? h("img", { class: "row-icon", src: it.icon, alt: "", loading: "lazy" }) : null,
        h("span", { class: "map-name" }, it.label),
        ...(it.tags ?? []).map((t) => h("span", { class: "tag role" }, t)),
        it.isNew ? h("span", { class: "tag new" }, "new") : it.edited ? h("span", { class: "tag edited" }, "edited") : null,
        it.meta ? h("span", { class: "map-meta" }, it.meta) : null,
      );
    const edited = items.filter((it) => it.edited || it.isNew);
    if (edited.length) {
      list.append(h("div", { class: "list-section" }, `Edited (${edited.length})`), ...edited.map(row));
      list.append(h("div", { class: "list-section all-maps" }, "All"));
    }
    const plain = items.filter((it) => !it.folded);
    const folded = items.filter((it) => it.folded);
    // very long lists (all text) render in chunks so typing stays snappy
    const LIMIT = 600;
    list.append(...plain.slice(0, LIMIT).map(row));
    if (plain.length > LIMIT) {
      const more = h("button", { class: "btn small ghost more-rows" }, `Show ${plain.length - LIMIT} more…`);
      more.addEventListener("click", () => {
        more.replaceWith(...plain.slice(LIMIT).map(row));
      });
      list.append(more);
    }
    if (folded.length && opts.folded) {
      // open while searching, or when the user opened it, or it holds the current record
      const open = foldOpen || !!q || folded.some((it) => it.id === current);
      const fold = h(
        "details",
        { class: "list-fold", open },
        h("summary", { class: "list-section" }, `${opts.folded.label} (${folded.length})`),
        h("p", { class: "hint fold-hint" }, opts.folded.hint),
        ...folded.map(row),
      );
      fold.addEventListener("toggle", () => {
        if (!q) foldOpen = fold.open;
      });
      list.append(fold);
    }
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
    const q = query.toUpperCase();
    const rows = [...list.querySelectorAll<HTMLButtonElement>(".map-row")];
    const best = rows.find((r) => r.dataset.id === q) ?? rows.find((r) => (r.dataset.id ?? "").startsWith(q)) ?? rows[0];
    if (best) {
      best.click();
      search.blur();
    }
  });
  let queued = false;
  store.on((reason, id, registry) => {
    if (queued || !(reason === "project" || reason === "saved" || opts.refreshOn(reason, id, registry))) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      render();
    });
  });
  return { render, search };
}
