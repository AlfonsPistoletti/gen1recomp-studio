// Text workspace: every string of the text registry (left), the editor with
// a text-box preview (center), and where the string is used (right). A game
// with several text registries (adapter.textSets: Gen 2's script texts and
// named engine texts) switches between them in the menu next to the search.

import { store } from "../core/store.ts";
import { clear, field, h, toast, onFocusLeave } from "./dom.ts";
import { pointerEntry, resolvedKey, usesOfText } from "./mapText.ts";
import { nav } from "./nav.ts";
import { mountRecordList } from "./recordList.ts";
import { textEditor } from "./textField.ts";

const sets = () => store.adapter?.textSets;

export function mountTextWorkspace(left: HTMLElement, center: HTMLElement, right: HTMLElement): void {
  let current: string | null = null;
  let onlyMaps = false;
  // the registry the list shows ("text" unless the game has textSets)
  let reg = "text";

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

  // games with textSets: where the map people, signs and triggers' scripts
  // show each "text" key (recomputed when a map changes)
  let scriptUses: Map<string, ScriptUse[]> | null = null;
  let labelsStale = false;
  const uses = (): Map<string, ScriptUse[]> => (scriptUses ??= scriptTextUses());

  const filter = h("select", { title: "Which texts to list" });
  // Gen 1: All / On maps; a game with several text registries: one per set
  const fillFilter = () => {
    const s = sets();
    if (s && !s.some((x) => x.registry === reg)) reg = s[0].registry;
    if (!s) reg = "text";
    filter.replaceChildren(...(s
      ? s.map((x) => h("option", { value: x.registry, selected: x.registry === reg }, x.label))
      : [h("option", { value: "all", selected: !onlyMaps }, "All"), h("option", { value: "maps", selected: onlyMaps }, "On maps")]));
    // new keys only where the game's own data can point at them (Gen 1 text pointers)
    newBtn.hidden = !!s;
  };
  filter.addEventListener("change", () => {
    if (sets()) {
      reg = filter.value;
      current = null;
      render(true);
    } else {
      onlyMaps = filter.value === "maps";
    }
    list.render();
  });
  const newBtn = h("button", { class: "btn small", title: "Add a new text string", onclick: () => showNew() }, "+ New");

  const list = mountRecordList(left, {
    title: "Text",
    placeholder: "Search keys and text…  (Ctrl+F)",
    searchId: "text-search",
    head: [h("div", { class: "row nowrap" }, filter, newBtn)],
    items: () => {
      const text = store.table(reg);
      const onMaps = onlyMaps && !sets() ? keysOnMaps() : null;
      const named = sets() && reg === "text" ? uses() : null;
      return Object.keys(text)
        .filter((k) => typeof text[k] === "string" && (!onMaps || onMaps.has(k)))
        .sort()
        .map((k) => ({
          id: k,
          ...(named ? { label: useLabel(named.get(k)?.[0]) ?? firstWords(String(text[k])), meta: k, folded: !named.has(k) } : { label: k }),
          search: String(text[k]),
          edited: store.isRecordEdited(reg, k) && store.baseTable(reg)[k] !== undefined,
          isNew: store.baseTable(reg)[k] === undefined,
        }))
        // named after their use: a map's texts together
        .sort((a, b) => (named ? a.label.localeCompare(b.label, undefined, { numeric: true }) : 0));
    },
    folded: { label: "Not on maps", hint: "No map person, sign or trigger script shows these: phone calls, the radio, items, battles …" },
    current: () => current,
    pick: (k) => open(k),
    refreshOn: (reason, id, registry) => {
      if (reason === "content" && registry === "text_pointers") mapKeys = null;
      // map edits (a script picked, a trainer added) change the labels; while
      // the workspace is hidden they wait until it shows (no rebuild per stroke)
      if (reason === "edit" && sets()) {
        scriptUses = null;
        if (!leftShown) labelsStale = true;
        else return true;
      }
      return reason === "content" && (registry === "text_pointers" || registry === reg) && id !== undefined;
    },
  });

  let leftShown = false;
  new IntersectionObserver((seen) => {
    leftShown = seen.some((e) => e.isIntersecting);
    if (labelsStale && leftShown) {
      labelsStale = false;
      list.render();
      render();
    }
  }).observe(left);

  const main = h("div", { class: "ws-scroll" });
  const side = h("div", { class: "ws-scroll" });
  const title = h("span", { class: "head-title" }, "Text");
  const revert = h("button", { class: "btn small danger", onclick: () => current && store.revertRecord(reg, current, `Revert ${current}`) }, "Revert to base");
  center.append(h("div", { class: "panel-head" }, title, revert), main);
  right.append(h("div", { class: "panel-head" }, h("span", {}, "Used by")), side);

  const open = (key: string, registry?: string) => {
    if (registry && registry !== reg && sets()?.some((x) => x.registry === registry)) {
      reg = registry;
      filter.value = registry;
    }
    if (typeof store.table(reg)[key] !== "string") return;
    current = key;
    list.render();
    render(true);
    left.querySelector<HTMLElement>(`.map-row[data-id="${CSS.escape(key)}"]`)?.scrollIntoView({ block: "nearest" });
  };
  nav.openText = (key, registry) => {
    nav.setWorkspace("text");
    open(key, registry);
  };

  const showNew = () => {
    clear(main);
    const input = h("input", { type: "text", value: "_MyNewText", spellcheck: false });
    const create = () => {
      const key = input.value.trim();
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return toast("Use letters, digits and _ (start with a letter or _)", "error");
      if (store.table(reg)[key] !== undefined) return toast(`${key} already exists`, "error");
      store.setRecord(reg, key, `New text ${key}`, "...");
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
    const text = store.table(reg);
    revert.hidden = !current || !store.isRecordEdited(reg, current);
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
      main.append(h("section", { class: "card" }, textEditor(current, { rows: 10, commands: true, revert: false, registry: reg })));
    } else {
      main.dataset.deferred = "1"; // redraw once focus leaves (onFocusLeave)
    }
    clear(side);
    side.append(...(!sets()
      ? usedBy(current)
      : reg === "text"
        ? scriptUsedBy(uses().get(current) ?? [])
        : [h("p", { class: "hint" }, "Game texts are shown by the engine itself (battles, menus, …), not by map scripts.")]));
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
      scriptUses = null;
      fillFilter();
      if (current && typeof store.table(reg)[current] !== "string") current = null;
      render(true);
    } else if (reason === "content" && (registry === reg || registry === "text_pointers") && (registry !== reg || id === current)) {
      schedule();
    } else if (reason === "reveal" && registry && (registry === "text" || sets()?.some((x) => x.registry === registry)) && id) {
      nav.openText(id, registry);
    }
  });
}

// a use of a script text: a map entity's script (index = list place) or one
// of the map's own scripts (no layer)
interface ScriptUse {
  mapId: string;
  layer?: string;
  index: number;
}

function scriptTextUses(): Map<string, ScriptUse[]> {
  const out = new Map<string, ScriptUse[]>();
  const adapter = store.adapter;
  if (!adapter.scriptTexts) return out;
  const text = store.table("text");
  const add = (key: string, use: ScriptUse) => {
    const list = out.get(key) ?? [];
    if (!list.some((u) => u.mapId === use.mapId && u.layer === use.layer && u.index === use.index)) list.push(use);
    out.set(key, list);
  };
  // every string in `v`: a text key itself (studio trainer lines) or a script
  const collect = (v: unknown, use: ScriptUse) =>
    JSON.stringify(v, (_k, s: unknown) => {
      if (typeof s === "string") {
        if (typeof text[s] === "string") add(s, use);
        else for (const k of adapter.scriptTexts!(store.ctx, s) ?? []) add(k, use);
      }
      return s;
    });
  for (const [mapId, map] of Object.entries(store.maps)) {
    const rest: Record<string, unknown> = { ...map };
    for (const layer of adapter.layers) {
      const list = (map as Record<string, unknown>)[layer.key];
      delete rest[layer.key];
      if (Array.isArray(list)) list.forEach((e, index) => collect(e, { mapId, layer: layer.key, index }));
    }
    collect(rest, { mapId, index: -1 });
  }
  return out;
}

function useLabel(u: ScriptUse | undefined): string | undefined {
  if (!u) return undefined;
  const layer = store.adapter.layers.find((l) => l.key === u.layer);
  // "NPC / object" -> "NPC": the list column is narrow
  return `${u.mapId} · ${layer ? `${layer.singular.split(" / ")[0]} ${u.index + 1}` : "map script"}`;
}

// a label for a text no map script shows: its first words
function firstWords(s: string): string {
  const flat = s.replace(/[\n\v\f]+/g, " ").trim();
  return flat.length > 32 ? `${flat.slice(0, 30)}…` : flat || "(empty)";
}

function scriptUsedBy(list: ScriptUse[]): HTMLElement[] {
  if (!list.length) {
    return [h("p", { class: "hint" }, "No map person, sign or trigger script shows this text. The game may still show it from elsewhere: phone calls, the radio, items, battles.")];
  }
  return list.map((u) => {
    const layer = store.adapter.layers.find((l) => l.key === u.layer);
    const label = layer ? `${layer.singular} ${u.index + 1}` : "Map script (scene, callback)";
    return h(
      "button",
      { class: "use-row", onclick: () => (layer ? nav.selectEntity(u.mapId, layer.key, u.index) : nav.openMap(u.mapId)), title: "Show on the map" },
      h("span", { class: "use-map" }, u.mapId),
      h("span", { class: "muted" }, label),
    );
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
