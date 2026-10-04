// The tab bar at the bottom of the Maps workspace's right panel:
//   BASE        block palette + properties of the map / selection
//   ENCOUNTERS  the map's wild Pokémon
// Picking an entity on the map brings BASE back; undo/redo of a wild table
// opens its map on ENCOUNTERS.

import { store } from "../core/store.ts";
import type { MapView } from "../render/mapView.ts";
import { h } from "./dom.ts";
import { nav, type PropsTab } from "./nav.ts";
import { recall, remember } from "./storage.ts";

const TAB_KEY = "studio.propsTab";

export function mountRightTabs(bar: HTMLElement, panes: Record<PropsTab, HTMLElement>, onShow: (tab: PropsTab) => void, view: MapView): void {
  const buttons: Record<PropsTab, HTMLButtonElement> = {
    base: h("button", { class: "tab", onclick: () => show("base"), title: "Blocks and properties" }, "Base"),
    encounters: h("button", { class: "tab", onclick: () => show("encounters"), title: "Wild Pokémon on this map" }, "Encounters"),
  };
  bar.append(buttons.base, buttons.encounters);

  let tab: PropsTab = "base";
  const show = (next: PropsTab) => {
    tab = next;
    remember(TAB_KEY, tab);
    for (const k of Object.keys(panes) as PropsTab[]) {
      panes[k].hidden = k !== tab;
      buttons[k].classList.toggle("active", k === tab);
    }
    onShow(tab);
  };
  nav.showPropsTab = show;
  show(recall(TAB_KEY) === "encounters" ? "encounters" : "base");

  store.on((reason, id, registry) => {
    if (reason === "selection" && store.selection && tab !== "base") show("base");
    if (reason === "reveal" && registry === "encounters" && id) {
      nav.setWorkspace("maps");
      view.openMap(id);
      show("encounters");
    }
  });
}
