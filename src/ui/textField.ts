import { fromEditable, lineMode, lineWidth, preview, TEXT_COMMANDS, toEditable, withEnding, BOX_WIDTH } from "../core/gbtext.ts";
import { store } from "../core/store.ts";
import { h } from "./dom.ts";

// Editor for one string of the text registry: plain lines, a blank line
// between pages, and a live Game Boy text-box preview. Typing is one undo
// step per pause (merged edits, sealed on blur). With `commands`, buttons
// insert {PLAYER}, {DONE}, ... and a legend explains them.

// `revert` (default on): a "Back to the game's text" button while a game text is changed
// `registry`: the text registry the key lives in (default "text"; Gen 2 also has "rom_text")
export function textEditor(key: string, opts: { rows?: number; label?: string; compact?: boolean; commands?: boolean; revert?: boolean; registry?: string } = {}): HTMLElement {
  const reg = opts.registry ?? "text";
  const current = store.table(reg)[key];
  const original = typeof current === "string" ? current : "";
  const mode = lineMode(original);
  const shown = toEditable(original);
  const area = h("textarea", { rows: opts.rows ?? 6, spellcheck: false, class: "mono gb-text" });
  area.value = shown;
  const boxes = h("div", { class: "gb-preview" });
  const warn = h("p", { class: "hint warn" });

  const renderPreview = () => {
    const { pages, tooWide, ending } = preview(area.value);
    const raw = area.value.replace(/\r\n?/g, "\n").split(/\n{2,}/).map((p) => p.split("\n"));
    boxes.replaceChildren(
      ...pages.map((lines, pi) =>
        h(
          "div",
          { class: `gb-box${mode === "plain" ? " plain" : ""}` },
          ...lines.map((l, li) => h("div", { class: `gb-line${lineWidth(raw[pi]?.[li] ?? "") > BOX_WIDTH ? " wide" : ""}` }, l || " ")),
          // what happens after the page: ▼ = waits for A/B
          pi < pages.length - 1 || ending === "prompt" ? h("span", { class: "gb-arrow", title: "Waits for A/B" }, "▼") : null,
        ),
      ),
    );
    if (ending === null) boxes.append(h("span", { class: "hint" }, "No {DONE} or {PROMPT} at the end."));
    warn.textContent = tooWide.length
      ? `${tooWide.length} line${tooWide.length === 1 ? "" : "s"} can get wider than the ${BOX_WIDTH}-character text box (up to ${Math.max(...tooWide.map((t) => t.length))}, counting names at their longest).`
      : "";
  };
  renderPreview();

  const base = store.baseTable(reg)[key];
  const back = h("button", {
    class: "btn small danger",
    onclick: () => {
      if (typeof base !== "string") return;
      store.revertRecord(reg, key, `${key}: the game's text`);
      store.seal();
      area.value = toEditable(base);
      renderPreview();
      showBack();
    },
  }, "Back to the game's text");
  const showBack = () => (back.hidden = opts.revert === false || typeof base !== "string" || store.table(reg)[key] === base);
  showBack();

  const save = () => {
    renderPreview();
    // untouched strings keep their exact separators
    const next = area.value === shown ? original : fromEditable(area.value, mode);
    store.setRecord(reg, key, `Edit text ${key}`, next, true);
    showBack();
  };
  area.addEventListener("input", save);
  area.addEventListener("blur", () => store.seal());

  let toolbar: HTMLElement | null = null;
  let legend: HTMLElement | null = null;
  if (opts.commands) {
    // Replaces [from, to) with `text` the way typing does, so Ctrl+Z in the
    // box undoes it (setting area.value would wipe the box's undo history).
    const replace = (from: number, to: number, text: string) => {
      area.focus();
      area.setSelectionRange(from, to);
      if (!document.execCommand("insertText", false, text)) {
        area.value = area.value.slice(0, from) + text + area.value.slice(to);
        area.setSelectionRange(from + text.length, from + text.length);
      }
    };
    // inserting keeps the caret where it was and counts as typing
    const insert = (token: string, end: boolean) => {
      const { selectionStart: a, selectionEnd: b, value } = area;
      if (end) {
        // swap only the part that differs: the old ending (if any) at the end
        const next = withEnding(value, token);
        let common = 0;
        while (common < value.length && common < next.length && value[common] === next[common]) common++;
        replace(common, value.length, next.slice(common));
      } else {
        // never after the ending: {DONE}/{PROMPT} must stay last
        const endAt = value.search(/\s*\{(DONE|PROMPT)\}\s*$/);
        const at = endAt >= 0 && a > endAt ? endAt : a;
        const to = endAt >= 0 && b > endAt ? endAt : b;
        replace(at, to, token);
      }
      area.dataset.dirty = "1";
      save();
    };
    toolbar = h(
      "div",
      { class: "row text-tools" },
      ...TEXT_COMMANDS.filter((c) => c.button).map((c) =>
        h("button", { class: `btn small${c.end ? " end" : ""}`, title: `${c.token}: ${c.about}`, onmousedown: (e: Event) => e.preventDefault(), onclick: () => insert(c.token, !!c.end) }, c.label),
      ),
      h("button", { class: "btn small", title: "Blank line: waits for A/B, then clears the box", onmousedown: (e: Event) => e.preventDefault(), onclick: () => insert("\n\n", false) }, "New page"),
    );
    legend = h(
      "details",
      { class: "text-legend" },
      h("summary", {}, "What the commands do"),
      h(
        "dl",
        {},
        ...TEXT_COMMANDS.flatMap((c) => [h("dt", {}, h("code", {}, c.token)), h("dd", {}, c.about)]),
        h("dt", {}, h("code", {}, "blank line")),
        h("dd", {}, "New page: the box waits for A/B (▼), then clears."),
        h("dt", {}, h("code", {}, "line break")),
        h("dd", {}, `Next line. The box shows two lines at a time and scrolls for more. Each line fits ${BOX_WIDTH} characters.`),
      ),
    );
  }

  return h(
    "div",
    { class: `text-editor${opts.compact ? " compact" : ""}` },
    opts.label ? h("span", { class: "field-label" }, opts.label) : null,
    toolbar,
    area,
    h("span", { class: "hint" }, "One line per row; a blank line starts a new page. {PLAYER}, {RIVAL} … are filled in by the game."),
    warn,
    boxes,
    back,
    legend,
  );
}
