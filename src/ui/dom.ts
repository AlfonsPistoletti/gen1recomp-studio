import { createElement, type IconNode } from "lucide";

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

// A text input that offers `options` while typing (one shared <datalist>
// per `listId`) and only accepts values from the list; anything else is
// reported and reverted. Case-insensitive, stored as the option's spelling.
export function comboInput(value: string, listId: string, options: string[], onChange: (v: string) => void, placeholder = ""): HTMLInputElement {
  let list = document.getElementById(listId) as HTMLDataListElement | null;
  if (!list) {
    list = h("datalist", { id: listId });
    document.body.append(list);
  }
  if (list.dataset.key !== String(options.length) + (options[0] ?? "")) {
    clear(list);
    for (const o of options) list.append(h("option", { value: o }));
    list.dataset.key = String(options.length) + (options[0] ?? "");
  }
  const input = h("input", { type: "text", value, spellcheck: false, placeholder, class: "combo" });
  input.setAttribute("list", listId);
  input.addEventListener("change", () => {
    const typed = input.value.trim().toUpperCase();
    const match = options.find((o) => o.toUpperCase() === typed);
    if (!match) {
      if (typed) toast(`Unknown: ${input.value}`, "error");
      input.value = value;
      return;
    }
    input.value = match;
    if (match !== value) onChange(match);
  });
  input.addEventListener("focus", () => input.select());
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
  const host = document.getElementById("toasts")!;
  const el = h("div", { class: `toast ${kind}` }, message);
  host.append(el);
  setTimeout(() => el.classList.add("leaving"), kind === "error" ? 6000 : 2800);
  setTimeout(() => el.remove(), kind === "error" ? 6400 : 3200);
}

// Errors arrive as Error objects from fetch/JS and as plain strings from
// Tauri commands.
export function errorText(err: unknown): string {
  if (err instanceof Error) return err.message;
  return typeof err === "string" ? err : JSON.stringify(err);
}
