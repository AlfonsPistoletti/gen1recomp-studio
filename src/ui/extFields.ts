// Inputs for studio-extension fields (extensions.ts): one control per field
// type, used by placed kinds, painted cells and mod commands alike.

import { store } from "../core/store.ts";
import type { ExtField, ExtKind } from "../project/extensions.ts";
import { attachCombo, comboInput, field, h, numberInput, selectInput } from "./dom.ts";
import { knownFlags } from "./eventEditor.ts";

const ids = (registry: string) => Object.keys(store.table(registry)).sort();

export function extFieldInput(f: ExtField, value: unknown, set: (v: unknown) => void): HTMLElement {
  const text = typeof value === "string" ? value : value === undefined || value === null ? "" : String(value);
  switch (f.type) {
    case "int":
      return numberInput(typeof value === "number" ? value : undefined, (v) => set(Math.round(Math.max(f.min ?? -Infinity, Math.min(f.max ?? Infinity, v)))), f.min, f.max);
    case "bool": {
      const box = h("input", { type: "checkbox", checked: value === true });
      box.addEventListener("change", () => set(box.checked));
      return h("label", { class: "inline-check" }, box, f.label);
    }
    case "select":
      return selectInput(text, f.options ?? [], (v) => set(v));
    case "species":
      return comboInput(text, "dl-species", ids("pokemon"), (v) => set(v));
    case "item":
      return comboInput(text, "dl-items", ids("items"), (v) => set(v));
    case "move":
      return comboInput(text, "dl-moves", ids("moves"), (v) => set(v));
    case "map":
      return comboInput(text, "dl-maps", Object.keys(store.maps).sort(), (v) => set(v));
    case "sprite":
      return selectInput(text, Object.keys(store.table("sprites")).sort(), (v) => set(v));
    case "flag": {
      const input = h("input", { type: "text", value: text, spellcheck: false, placeholder: "MYMOD_FLAG" });
      attachCombo(input, knownFlags, "flags");
      input.addEventListener("change", () => set(input.value.trim()));
      return input;
    }
    default: {
      const input = h("input", { type: "text", value: text, spellcheck: false });
      input.addEventListener("change", () => set(input.value));
      return input;
    }
  }
}

// A labeled field (a checkbox carries its own label).
export function extField(f: ExtField, value: unknown, set: (v: unknown) => void): HTMLElement {
  const input = extFieldInput(f, value, set);
  return f.type === "bool" ? h("div", { class: "field" }, input, f.hint ? h("span", { class: "hint" }, f.hint) : null) : field(f.label, input, f.hint);
}

// The card of a custom kind's values, `values` being the custom record (or a cell).
export function extKindCard(kind: ExtKind, values: Record<string, unknown>, set: (key: string, v: unknown) => void): HTMLElement {
  return h(
    "div",
    { class: "field-group" },
    h("h4", {}, kind.label),
    h("p", { class: "hint" }, `${kind.hint ? `${kind.hint} ` : ""}Defined by the mod ${kind.from}; its Lua reads these values in the game.`),
    ...kind.fields.map((f) => extField(f, values[f.key], (v) => set(f.key, v))),
  );
}

export { extKind, extKinds } from "../core/customCells.ts";
