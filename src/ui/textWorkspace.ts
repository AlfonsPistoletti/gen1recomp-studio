// Text workspace: every string of the text registry (left), the editor with
// a text-box preview (center), and where the string is used (right).

import { store } from "../core/store.ts";
import { clear, field, h, toast, onFocusLeave } from "./dom.ts";
import { pointerEntry, resolvedKey, usesOfText } from "./mapText.ts";
import { nav } from "./nav.ts";
import { mountRecordList } from "./recordList.ts";
import { textEditor } from "./textField.ts";

const REG = "text";

export function mountTextWorkspace(left: HTMLElement, center: HTMLElement, right: HTMLElement): void {
  let current: string | null = null;
  let onlyMaps = false;

  // keys a map's text pointer leads to (recomputed when pointers change)
  let mapKeys: Set<string> | null = null;
  const keysOnMaps = (): Set<string> => {
    if (mapKeys) return mapKeys;
    mapKeys = new Set();
    for (const perMap of Object.values(store.table("text_pointers")) as Record<string, Parameters<typeof resolvedKey>[0]>[]) {
      for (const entry of Object.values(perMap ?? {})) {
        const k = resolvedKey(entry);
        if (k) mapKeys.add(k);
      }
    }
    return mapKeys;
  };

  const filter = h("select", { title: "Which texts to list" }, h("option", { value: "all" }, "All"), h("option", { value: "maps" }, "On maps"));
  filter.addEventListener("change", () => {
    onlyMaps = filter.value === "maps";
    list.render();
  });
  const newBtn = h("button", { class: "btn small", title: "Add a new text string", onclick: () => showNew() }, "+ New");

  const list = mountRecordList(left, {
    title: "Text",
    placeholder: "Search keys and text…  (Ctrl+F)",
    searchId: "text-search",
    head: [h("div", { class: "row nowrap" }, filter, newBtn)],
    items: () => {
      const text = store.table(REG);
      const onMaps = onlyMaps ? keysOnMaps() : null;
      return Object.keys(text)
        .filter((k) => typeof text[k] === "string" && (!onMaps || onMaps.has(k)))
        .sort()
        .map((k) => ({
          id: k,
          label: k,
          search: String(text[k]),
          edited: store.isRecordEdited(REG, k) && store.baseTable(REG)[k] !== undefined,
          isNew: store.baseTable(REG)[k] === undefined,
        }));
    },
    current: () => current,
    pick: (k) => open(k),
    refreshOn: (reason, id, registry) => {
      if (reason === "content" && registry === "text_pointers") mapKeys = null;
      return reason === "content" && (registry === "text_pointers" || registry === REG) && id !== undefined;
    },
  });

  const main = h("div", { class: "ws-scroll" });
  const side = h("div", { class: "ws-scroll" });
  const title = h("span", { class: "head-title" }, "Text");
  const revert = h("button", { class: "btn small danger", onclick: () => current && store.revertRecord(REG, current, `Revert ${current}`) }, "Revert to base");
  center.append(h("div", { class: "panel-head" }, title, revert), main);
  right.append(h("div", { class: "panel-head" }, h("span", {}, "Used by")), side);

  const open = (key: string) => {
    if (typeof store.table(REG)[key] !== "string") return;
    current = key;
    list.render();
    render(true);
    left.querySelector<HTMLElement>(`.map-row[data-id="${CSS.escape(key)}"]`)?.scrollIntoView({ block: "nearest" });
  };
  nav.openText = (key) => {
    nav.setWorkspace("text");
    open(key);
  };

  const showNew = () => {
    clear(main);
    const input = h("input", { type: "text", value: "_MyNewText", spellcheck: false });
    const create = () => {
      const key = input.value.trim();
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return toast("Use letters, digits and _ (start with a letter or _)", "error");
      if (store.table(REG)[key] !== undefined) return toast(`${key} already exists`, "error");
      store.setRecord(REG, key, `New text ${key}`, "...");
      store.seal();
      open(key);
    };
    input.addEventListener("keydown", (e) => e.key === "Enter" && create());
    main.append(
      h("section", { class: "card" }, h("h4", {}, "New text"), field("Key", input, "Map texts are usually named _MapLabelSomethingText. To give an NPC new text, use Create text in its properties instead."), h("div", { class: "row" }, h("button", { class: "btn primary small", onclick: create }, "Create"))),
    );
    input.focus();
    input.select();
  };

  const render = (force = false) => {
    const text = store.table(REG);
    revert.hidden = !current || !store.isRecordEdited(REG, current);
    if (!current || typeof text[current] !== "string") {
      title.textContent = "Text";
      clear(main);
      clear(side);
      main.append(h("p", { class: "hint empty" }, "Pick a text on the left, or search for words in it."));
      return;
    }
    title.textContent = current;
    const busy = main.contains(document.activeElement) && document.activeElement !== document.body;
    if (force || !busy) {
      clear(main);
      main.append(h("section", { class: "card" }, textEditor(current, { rows: 10, commands: true, revert: false })));
    } else {
      main.dataset.deferred = "1"; // redraw once focus leaves (onFocusLeave)
    }
    clear(side);
    side.append(...usedBy(current));
  };

  let scheduled = false;
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      render();
    });
  };
  onFocusLeave(main, schedule);
  store.on((reason, id, registry) => {
    if (reason === "project") {
      mapKeys = null;
      if (current && typeof store.table(REG)[current] !== "string") current = null;
      render(true);
    } else if (reason === "content" && (registry === REG || registry === "text_pointers") && (registry !== REG || id === current)) {
      schedule();
    } else if (reason === "reveal" && (registry === REG || registry === "text_pointers") && id) {
      if (registry === REG) nav.openText(id);
    }
  });
}

function usedBy(key: string): HTMLElement[] {
  const out: HTMLElement[] = [];
  const uses = usesOfText(key);
  for (const u of uses) {
    const layer = store.adapter.layers.find((l) => l.key === u.layer);
    out.push(
      h(
        "button",
        { class: "use-row", onclick: () => nav.selectEntity(u.mapId, u.layer, u.index), title: "Show on the map" },
        h("span", { class: "use-map" }, u.mapId),
        h("span", { class: "muted" }, `${layer?.singular ?? u.layer} ${u.index + 1} · ${u.textId}`),
        pointerEntry(String(store.maps[u.mapId]?.label ?? ""), u.textId)?.asm ? h("span", { class: "tag edited" }, "script") : null,
      ),
    );
  }
  const pokemon = store.table("pokemon") as Record<string, Record<string, unknown>>;
  for (const [id, mon] of Object.entries(pokemon)) {
    if ((mon.dexEntry as { text?: string } | undefined)?.text !== key) continue;
    out.push(
      h("button", { class: "use-row", onclick: () => nav.openPokemon(id) }, h("span", { class: "use-map" }, String(mon.name ?? id)), h("span", { class: "muted" }, "Pokédex entry")),
    );
  }
  if (!out.length) {
    out.push(
      h(
        "p",
        { class: "hint" },
        "No map NPC, sign or Pokédex entry points here. The game may still use it from battle, menus or a script.",
      ),
    );
  }
  return out;
}
