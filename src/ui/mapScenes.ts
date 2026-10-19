// The map panel's Scenes card (games with adapter.scenes: Gen 2). A scene is
// the map's story stage: step triggers run only in theirs, entering the map in
// a scene runs that scene's event, and scenes above 0 may change blocks
// (painted with the block brush while the scene is picked in the toolbar).

import { store } from "../core/store.ts";
import type { MapDef } from "../core/types.ts";
import { field, h } from "./dom.ts";
import { createEvent, eventId } from "./eventEditor.ts";
import { nav } from "./nav.ts";

export function mapScenesSection(map: MapDef): HTMLElement[] {
  const scenes = store.adapter.scenes;
  if (!scenes) return [];
  const names = scenes.names(map);
  const edit = (label: string, mutate: (d: MapDef) => void) => {
    store.edit(map.id, label, mutate);
    store.seal();
  };
  const rows = scenes.list(map, store.ctx).map((n) => {
    const name = h("input", { type: "text", value: names[String(n)] ?? "", placeholder: n === 0 ? "The start" : `Scene ${n}`, spellcheck: false });
    name.addEventListener("change", () => edit("Scene name", (d) => scenes.setName(d, n, name.value.trim())));
    const script = scenes.script(map, n);
    const id = eventId(map.id, "enter", `scene${n}`);
    const entering = Array.isArray(script)
      ? h("div", { class: "row" }, h("span", { class: "hint" }, "Entering: its own event"), h("button", { class: "btn small primary-ish", onclick: () => nav.openEvent(id) }, "Edit event →"))
      : h("div", { class: "row" },
          h("span", { class: "hint" }, typeof script === "string" ? "Entering: the game's script" : "Entering: nothing happens"),
          typeof script === "string" ? h("button", { class: "btn small ghost", onclick: () => nav.openEvent(`game:${id}`) }, "Show") : null,
          h("button", { class: "btn small", onclick: () => { const nid = createEvent(map.id, "enter", `scene${n}`); if (nid) nav.openEvent(nid); } }, "Make an event"));
    const changed = n > 0 ? scenes.changedBlocks(map, n) : 0;
    const layout = n > 0
      ? h("div", { class: "row" },
          h("span", { class: "hint" }, changed ? `${changed} block${changed === 1 ? "" : "s"} changed in this scene` : "Same blocks as the map"),
          h("button", { class: "btn small ghost", title: "Show and paint this scene on the map", onclick: () => store.setScene(n) }, store.scene === n ? "Shown" : "Show"),
          changed ? h("button", { class: "btn small danger", onclick: () => edit(`Scene ${n}: the map's blocks`, (d) => scenes.clearBlocks(d, n)) }, "Clear") : null)
      : null;
    return h("div", { class: `scene-row${store.scene === n ? " active" : ""}` },
      field(`Scene ${n}${n === 0 ? " (start)" : ""}`, name),
      entering,
      layout,
    );
  });
  return [
    h("h4", {}, "Scenes"),
    h("p", { class: "hint" }, "A scene is the map's story stage, saved with the game (0 at the start). Step triggers run only in their scene, and events move the map on with Set this map's scene. In a scene above 0, the block brush paints that scene's own blocks (pick it in the toolbar)."),
    ...rows,
  ];
}
