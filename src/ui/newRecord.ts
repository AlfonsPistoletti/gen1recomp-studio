// Dialog for a new Pokémon or trainer class: an id, a name and the existing
// record to start from (a copy keeps working right away; its art can be
// replaced afterwards).

import { field, h, selectInput, toast } from "./dom.ts";

export interface NewRecordOptions {
  title: string;
  idPrefix: string; // "" or "OPP_"
  nameMax: number;
  taken: (id: string) => boolean;
  sources: { id: string; label: string }[];
  source: string;
}

export function promptNewRecord(opts: NewRecordOptions): Promise<{ id: string; name: string; source: string } | null> {
  return new Promise((resolve) => {
    const dialog = h("dialog", {});
    const name = h("input", { type: "text", maxLength: opts.nameMax, spellcheck: false, placeholder: "NAME" });
    const id = h("input", { type: "text", spellcheck: false, placeholder: `${opts.idPrefix}MY_ID` });
    let idTouched = false;
    // the id follows the name until edited by hand
    name.addEventListener("input", () => {
      if (!idTouched) id.value = opts.idPrefix + name.value.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    });
    id.addEventListener("input", () => (idTouched = true));
    let source = opts.source;
    const labels = Object.fromEntries(opts.sources.map((s) => [s.id, s.label]));
    const sel = selectInput(source, opts.sources.map((s) => s.id), (v) => (source = v));
    for (const o of sel.options) o.textContent = labels[o.value] ?? o.value;
    const close = (v: { id: string; name: string; source: string } | null) => {
      dialog.close();
      dialog.remove();
      resolve(v);
    };
    const create = () => {
      const newId = id.value.trim().toUpperCase();
      const newName = name.value.trim().toUpperCase();
      if (!newName) return toast("Give it a name", "error");
      if (!/^[A-Z][A-Z0-9_]*$/.test(newId)) return toast("The id may use A-Z, 0-9 and _ and starts with a letter", "error");
      if (opts.taken(newId)) return toast(`${newId} already exists`, "error");
      close({ id: newId, name: newName, source });
    };
    for (const input of [name, id]) input.addEventListener("keydown", (e) => e.key === "Enter" && create());
    dialog.addEventListener("cancel", (e) => {
      e.preventDefault();
      close(null);
    });
    dialog.append(
      h("h3", {}, opts.title),
      field("Name", name, `Up to ${opts.nameMax} characters, as shown in the game.`),
      field("Id", id, "Used by the data and other mods; cannot be changed later."),
      field("Start as a copy of", sel, "Stats, moves and art are copied. Replace the art afterwards."),
      h("div", { class: "dialog-actions" }, h("button", { class: "btn", onclick: () => close(null) }, "Cancel"), h("button", { class: "btn primary", onclick: create }, "Create")),
    );
    document.body.append(dialog);
    dialog.showModal();
    name.focus();
  });
}
