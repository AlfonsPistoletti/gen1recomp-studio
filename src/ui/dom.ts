import { createElement, type IconNode } from "lucide";
import { log } from "../core/log.ts";

type Attrs = Record<string, unknown> & { class?: string; style?: string };
type Child = Node | string | number | null | undefined | false;

// Minimal element builder: h("div", { class: "x", onclick: fn }, child...)
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith("on") && typeof value === "function") {
      el.addEventListener(key.slice(2), value as EventListener);
    } else if (key === "class") {
      el.className = String(value);
    } else if (key in el && key !== "list" && key !== "style") {
      (el as unknown as Record<string, unknown>)[key] = value;
    } else {
      el.setAttribute(key, value === true ? "" : String(value));
    }
  }
  append(el, children);
  return el;
}

export function append(el: Element, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
}

// Up/Down on a focused row of a left-panel list opens the previous/next
// row instead of scrolling. Rows are rebuilt when one opens, so the new row
// is focused again after that (by position; an edited record is listed twice).
export function listKeys(list: HTMLElement): void {
  list.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    const rows = () => [...list.querySelectorAll<HTMLElement>(".map-row")].filter((r) => r.offsetParent !== null);
    const all = rows();
    const at = all.indexOf(e.target as HTMLElement);
    if (at < 0) return;
    e.preventDefault();
    e.stopPropagation();
    const next = all[at + (e.key === "ArrowUp" ? -1 : 1)];
    if (!next) return;
    const id = next.dataset.id;
    const index = at + (e.key === "ArrowUp" ? -1 : 1);
    next.click();
    requestAnimationFrame(() => {
      const now = rows();
      const row = now[index]?.dataset.id === id ? now[index] : now.find((r) => r.dataset.id === id);
      row?.focus();
      row?.scrollIntoView({ block: "nearest" });
    });
  });
}

// A list about to be rebuilt: when one of its rows has focus (a click
// focuses the row, then the click's re-render would drop it), the returned
// function focuses the open row again, so Up/Down keep working.
export function listFocus(list: HTMLElement): () => void {
  const rows = () => [...list.querySelectorAll<HTMLElement>(".map-row")];
  const at = rows().indexOf(document.activeElement as HTMLElement);
  if (at < 0) return () => {};
  return () => {
    const now = rows();
    const row = now[at]?.classList.contains("active") ? now[at] : list.querySelector<HTMLElement>(".map-row.active");
    row?.focus({ preventScroll: true });
  };
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function $(selector: string): HTMLElement {
  const el = document.querySelector(selector);
  if (!el) throw new Error(`missing ${selector}`);
  return el as HTMLElement;
}

// a field typed in but not committed yet (no change event) is "dirty"
document.addEventListener("input", (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) e.target.dataset.dirty = "1";
}, true);
document.addEventListener("change", (e) => {
  if (e.target instanceof HTMLElement) delete e.target.dataset.dirty;
}, true);

// A Lucide icon as an inline SVG (bundled; nothing loads at runtime).
export function icon(node: IconNode, size = 16): SVGElement {
  return createElement(node, { width: size, height: size, "stroke-width": 2, "aria-hidden": "true", class: "icon" });
}

// Rebuilds a form in place after an edit, keeping scroll position and the
// focused control (by its position among the form's controls) so Tab/Enter
// flows keep working. Returns false, doing nothing, while the focused field
// has uncommitted typing (live-saving textareas included): it must not be
// recreated under the caret.
let rerendering = false;

// Runs `cb` when focus leaves a form (a held-back re-render can happen
// then), ignoring the focus moves rerender() itself causes.
// Only when a render was actually held back: a spurious one right after
// the user clicks into the next field would replace it under their typing.
export function onFocusLeave(container: HTMLElement, cb: () => void): void {
  container.addEventListener("focusout", () => {
    if (rerendering || !container.dataset.deferred) return;
    delete container.dataset.deferred;
    setTimeout(cb, 0);
  });
}

export function rerender(container: HTMLElement, build: () => Node[]): boolean {
  const active = document.activeElement as HTMLElement | null;
  const inside = !!active && active !== document.body && container.contains(active);
  if (inside && active.dataset.dirty) {
    container.dataset.deferred = "1";
    return false;
  }
  const controls = () => [...container.querySelectorAll<HTMLElement>("input, select, textarea, button")];
  const index = inside ? controls().indexOf(active) : -1;
  const sel = inside && active instanceof HTMLInputElement && active.type === "text" ? [active.selectionStart, active.selectionEnd] : null;
  const scroll = container.scrollTop;
  const nodes = build();
  rerendering = true;
  try {
    container.replaceChildren(...nodes);
    container.scrollTop = scroll;
    if (index >= 0) {
      const el = controls()[index];
      if (el) {
        el.focus({ preventScroll: true });
        if (sel && el instanceof HTMLInputElement && el.type === "text") el.setSelectionRange(sel[0], sel[1]);
      }
    }
  } finally {
    rerendering = false;
  }
  return true;
}

// A dropdown over `options`; a current value missing from the list is kept
// as its own entry so opening a record never silently changes it.
export function selectInput(value: string, options: string[], onChange: (v: string) => void, emptyLabel?: string): HTMLSelectElement {
  const all = [...new Set(options)];
  if (value && !all.includes(value)) all.unshift(value);
  const select = h("select", {});
  if (emptyLabel !== undefined) select.append(h("option", { value: "", selected: !value }, emptyLabel));
  for (const o of all) select.append(h("option", { value: o, selected: o === value }, o));
  select.addEventListener("change", () => onChange(select.value));
  return select;
}

// ------------------------------------------------------------------ combo list

// The studio's own pick list for text inputs (the browser's <datalist> only
// lists what matches the text already in the box). One popup, shown in the
// top layer (popover) so it works inside dialogs too. Focus opens the whole
// list with the current value highlighted; typing filters by id or name;
// arrows, Enter and Escape; a pick sets the text and fires "change", so the
// input's own handlers decide what happens.

// a display name for an option of a list (set by main.ts: Pokémon, move,
// item names); undefined shows the id alone
let comboLabel: (listId: string, id: string) => string | undefined = () => undefined;
export function setComboLabels(fn: (listId: string, id: string) => string | undefined): void {
  comboLabel = fn;
}

let pop: HTMLDivElement | null = null;
// when the last pick happened: the form re-renders after a pick and puts
// focus back into the (new) input, which must not open the list again
let pickedAt = 0;
function popup(): HTMLDivElement {
  if (!pop) {
    pop = h("div", { class: "combo-pop", popover: "manual" });
    document.body.append(pop);
  }
  return pop;
}

export function attachCombo(input: HTMLInputElement, options: () => string[], listId: string): void {
  let open = false;
  let shown: string[] = [];
  let at = -1;
  let before = "";
  const label = (o: string) => {
    const name = comboLabel(listId, o);
    return name && name.toUpperCase() !== o.toUpperCase() ? name : "";
  };
  const highlight = (i: number) => {
    at = Math.max(-1, Math.min(i, shown.length - 1));
    const rows = popup().children;
    for (let k = 0; k < rows.length; k++) rows[k].classList.toggle("active", k === at);
    (rows[at] as HTMLElement | undefined)?.scrollIntoView({ block: "nearest" });
  };
  const render = (query: string) => {
    const q = query.trim().toUpperCase();
    const all = options();
    shown = q ? all.filter((o) => o.toUpperCase().includes(q) || label(o).toUpperCase().includes(q)) : all;
    const p = popup();
    p.replaceChildren(...shown.map((o) => {
      const name = label(o);
      const row = h("div", { class: "combo-row" }, h("span", { class: "combo-id" }, o), name ? h("span", { class: "combo-name" }, name) : null);
      // mousedown, not click: the input keeps focus
      row.addEventListener("mousedown", (e) => {
        e.preventDefault();
        pick(o);
      });
      return row;
    }));
    if (!shown.length) p.append(h("div", { class: "combo-empty" }, "No match"));
  };
  const place = () => {
    const r = input.getBoundingClientRect();
    const p = popup();
    const below = window.innerHeight - r.bottom;
    p.style.left = `${r.left}px`;
    p.style.minWidth = `${Math.max(r.width, 200)}px`;
    p.style.maxHeight = `${Math.max(120, Math.min(320, below > 160 ? below - 8 : r.top - 8))}px`;
    if (below > 160) {
      p.style.top = `${r.bottom + 2}px`;
      p.style.bottom = "";
    } else {
      p.style.top = "";
      p.style.bottom = `${window.innerHeight - r.top + 2}px`;
    }
  };
  const show = () => {
    before = input.value;
    // inside a modal dialog the rest of the page is inert: the list must
    // live in the dialog to get clicks
    const host = input.closest("dialog") ?? document.body;
    const p = popup();
    if (p.parentElement !== host) {
      if (p.matches(":popover-open")) p.hidePopover();
      host.append(p);
    }
    render("");
    place();
    if (!p.matches(":popover-open")) p.showPopover();
    open = true;
    highlight(shown.indexOf(options().find((o) => o.toUpperCase() === input.value.trim().toUpperCase()) ?? ""));
  };
  const hide = () => {
    if (!open) return;
    open = false;
    const p = popup();
    if (p.matches(":popover-open")) p.hidePopover();
  };
  // a pick is a decision: the list closes and the input lets go of focus
  const pick = (o: string) => {
    hide();
    pickedAt = Date.now();
    input.value = o;
    input.dispatchEvent(new Event("change"));
    input.blur();
  };
  input.addEventListener("focus", () => {
    if (Date.now() - pickedAt < 400) return;
    show();
    input.select();
  });
  input.addEventListener("mousedown", () => {
    if (document.activeElement === input && !open) show();
  });
  input.addEventListener("input", () => {
    if (!open) show();
    render(input.value);
    highlight(0);
  });
  input.addEventListener("blur", hide);
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) return show();
      highlight(at + (e.key === "ArrowDown" ? 1 : -1));
    } else if (e.key === "Enter" && open && at >= 0) {
      e.preventDefault();
      pick(shown[at]);
    } else if (e.key === "Escape" && open) {
      e.preventDefault();
      e.stopPropagation();
      input.value = before;
      hide();
    }
  });
}

// A text input that picks one of `options` (attachCombo) and only accepts
// values from the list; anything else is reported and reverted.
// Case-insensitive, stored as the option's spelling.
export function comboInput(value: string, listId: string, options: string[], onChange: (v: string) => void, placeholder = ""): HTMLInputElement {
  const input = h("input", { type: "text", value, spellcheck: false, placeholder, class: "combo" });
  attachCombo(input, () => options, listId);
  input.addEventListener("change", () => {
    const typed = input.value.trim().toUpperCase();
    const match = options.find((o) => o.toUpperCase() === typed);
    if (!match) {
      if (typed) toast(`Unknown: ${input.value}`, "error");
      input.value = value;
      return;
    }
    input.value = match;
    // remembered, so a second change event (Enter, then blur) does nothing
    if (match !== value) {
      value = match;
      onChange(match);
    }
  });
  return input;
}

export function numberInput(value: number | undefined, onChange: (v: number) => void, min?: number, max?: number): HTMLInputElement {
  const input = h("input", { type: "number", value: value ?? "", step: 1 });
  if (min !== undefined) input.min = String(min);
  if (max !== undefined) input.max = String(max);
  input.addEventListener("change", () => {
    const v = Number(input.value);
    if (Number.isFinite(v)) onChange(Math.trunc(v));
  });
  return input;
}

export function field(label: string, control: Node, hint?: string): HTMLElement {
  return h("label", { class: "field" }, h("span", { class: "field-label" }, label), control, hint ? h("span", { class: "hint" }, hint) : null);
}

// A button that opens `panel` (class "menu") below it. It closes on a click
// outside, Escape, or `close()`; `onOpen` fills the panel first.
export function dropdown(button: HTMLButtonElement, panel: HTMLElement, onOpen?: () => void): { root: HTMLElement; close: () => void } {
  const root = h("div", { class: "dropdown" }, button, panel);
  panel.hidden = true;
  button.setAttribute("aria-haspopup", "true");
  button.setAttribute("aria-expanded", "false");
  const close = () => {
    panel.hidden = true;
    button.setAttribute("aria-expanded", "false");
  };
  button.addEventListener("click", () => {
    if (!panel.hidden) return close();
    onOpen?.();
    panel.hidden = false;
    button.setAttribute("aria-expanded", "true");
  });
  document.addEventListener("mousedown", (e) => {
    if (!panel.hidden && !root.contains(e.target as Node)) close();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !panel.hidden) close();
  });
  return { root, close };
}

export function toast(message: string, kind: "info" | "error" | "ok" = "info"): void {
  log(kind, message);
  const host = document.getElementById("toasts")!;
  const el = h("div", { class: `toast ${kind}` }, message);
  host.append(el);
  // re-shown each time so it stacks above a modal dialog opened since
  if (host.matches(":popover-open")) host.hidePopover();
  host.showPopover();
  setTimeout(() => el.classList.add("leaving"), kind === "error" ? 6000 : 2800);
  setTimeout(() => el.remove(), kind === "error" ? 6400 : 3200);
}

// Errors arrive as Error objects from fetch/JS and as plain strings from
// Tauri commands.
export function errorText(err: unknown): string {
  if (err instanceof Error) return err.message;
  return typeof err === "string" ? err : JSON.stringify(err);
}
