// "Use an existing text…": search the game's and the mod's texts by their
// words (or key) and pick one, for a sign or person to show instead of a new
// line. Both generations (Gen 1 points a text pointer at it, Gen 2 a script row).
import { store } from "../core/store.ts";
import { h } from "./dom.ts";

const MAX_SHOWN = 120;
const plain = (t: string) => t.replace(/\{(DONE|PROMPT)\}/g, "").replace(/[\n\v\f]+/g, " ").trim();

export function pickText(registry = "text"): Promise<string | null> {
  return new Promise((done) => {
    const texts = Object.entries(store.table(registry)).filter((e): e is [string, string] => typeof e[1] === "string");
    const dialog = h("dialog", { class: "text-pick" });
    const close = (v: string | null) => {
      dialog.close();
      dialog.remove();
      done(v);
    };
    dialog.addEventListener("cancel", (e) => {
      e.preventDefault();
      close(null);
    });
    const search = h("input", { type: "search", placeholder: "Words in the text, or its key…", spellcheck: false });
    const list = h("div", { class: "text-pick-list" });
    const render = () => {
      const q = search.value.trim().toLowerCase();
      const hits = texts.filter(([k, t]) => !q || k.toLowerCase().includes(q) || plain(t).toLowerCase().includes(q));
      list.replaceChildren(
        ...hits.slice(0, MAX_SHOWN).map(([k, t]) =>
          h("button", { class: "text-pick-row", title: k, onclick: () => close(k) }, h("span", { class: "muted mono" }, k), h("span", {}, plain(t).slice(0, 90)))),
        hits.length > MAX_SHOWN ? h("p", { class: "hint" }, `${hits.length - MAX_SHOWN} more: type more words.`) : hits.length ? "" : h("p", { class: "hint" }, "No text has these words."),
      );
    };
    search.addEventListener("input", render);
    dialog.append(
      h("h3", {}, "Use an existing text"),
      search,
      list,
      h("p", { class: "hint" }, "The text is shared: editing it later changes it everywhere it's shown."),
      h("div", { class: "dialog-actions" }, h("button", { class: "btn", onclick: () => close(null) }, "Cancel")),
    );
    document.body.append(dialog);
    dialog.showModal();
    render();
    search.focus();
  });
}
