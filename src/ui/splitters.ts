import { h } from "./dom.ts";
import { recall, remember } from "./storage.ts";

// Drag handles on the inner edges of the side panels (.side-left and
// .side-right of every workspace). Widths live in CSS variables on #layout,
// so all workspaces share them, and are remembered per browser;
// double-click resets.

const CENTER_MIN = 320;

interface Side {
  cls: string;
  cssVar: string;
  key: string;
  min: number;
  max: number;
  // +1 when dragging right widens the panel (left side), -1 otherwise
  dir: 1 | -1;
}

const SIDES: Side[] = [
  { cls: "side-left", cssVar: "--left-w", key: "studio.leftWidth", min: 160, max: 640, dir: 1 },
  { cls: "side-right", cssVar: "--right-w", key: "studio.rightWidth", min: 260, max: 760, dir: -1 },
];

export function mountSplitters(layout: HTMLElement): void {
  // the visible panel of a side (the active workspace's)
  const panel = (s: Side): HTMLElement | null =>
    [...layout.querySelectorAll<HTMLElement>(`:scope > .${s.cls}`)].find((p) => !p.hidden) ?? null;
  const width = (s: Side): number => panel(s)?.getBoundingClientRect().width ?? 0;

  // keep the main area usable: a side may only take what the other leaves over
  const clamp = (s: Side, w: number): number => {
    const other = SIDES.find((o) => o !== s)!;
    const room = layout.clientWidth - width(other) - CENTER_MIN;
    return Math.round(Math.max(s.min, Math.min(s.max, room, w)));
  };

  const apply = (s: Side, w: number): void => {
    layout.style.setProperty(s.cssVar, `${clamp(s, w)}px`);
  };

  for (const s of SIDES) {
    const saved = Number(recall(s.key));
    if (saved) layout.style.setProperty(s.cssVar, `${saved}px`);

    for (const p of layout.querySelectorAll<HTMLElement>(`:scope > .${s.cls}`)) {
      const handle = h("div", { class: `splitter ${s.dir === 1 ? "on-right" : "on-left"}`, title: "Drag to resize, double-click to reset" });
      p.append(handle);

      handle.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        handle.setPointerCapture(e.pointerId);
        const startX = e.clientX;
        const startW = width(s);
        document.body.classList.add("resizing");
        const move = (ev: PointerEvent): void => apply(s, startW + (ev.clientX - startX) * s.dir);
        const up = (): void => {
          handle.removeEventListener("pointermove", move);
          handle.removeEventListener("pointerup", up);
          handle.removeEventListener("pointercancel", up);
          document.body.classList.remove("resizing");
          remember(s.key, String(Math.round(width(s))));
        };
        handle.addEventListener("pointermove", move);
        handle.addEventListener("pointerup", up);
        handle.addEventListener("pointercancel", up);
      });

      handle.addEventListener("dblclick", () => {
        layout.style.removeProperty(s.cssVar);
        remember(s.key, null);
      });
    }
  }

  // a smaller window must not squeeze the main area away
  window.addEventListener("resize", () => {
    for (const s of SIDES) if (layout.style.getPropertyValue(s.cssVar)) apply(s, width(s));
  });
}

// Drag handle under the map view's block palette: its height lives in
// --palette-h on the pane (the first grid row), remembered per browser.
const PALETTE_KEY = "studio.paletteHeight";
const PALETTE_MIN = 160;
const PROPS_MIN = 120;

export function mountPaletteSplitter(pane: HTMLElement, palette: HTMLElement): void {
  const apply = (px: number): void => {
    const max = Math.max(PALETTE_MIN, pane.clientHeight - PROPS_MIN);
    pane.style.setProperty("--palette-h", `${Math.round(Math.max(PALETTE_MIN, Math.min(max, px)))}px`);
  };
  const saved = Number(recall(PALETTE_KEY));
  if (saved) pane.style.setProperty("--palette-h", `${saved}px`);

  const handle = h("div", { class: "splitter on-bottom", title: "Drag to resize, double-click to reset" });
  palette.append(handle);
  handle.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    const startY = e.clientY;
    const startH = palette.getBoundingClientRect().height;
    document.body.classList.add("resizing", "rows");
    const move = (ev: PointerEvent): void => apply(startH + ev.clientY - startY);
    const up = (): void => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      document.body.classList.remove("resizing", "rows");
      remember(PALETTE_KEY, String(Math.round(palette.getBoundingClientRect().height)));
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  });
  handle.addEventListener("dblclick", () => {
    pane.style.removeProperty("--palette-h");
    remember(PALETTE_KEY, null);
  });
}
