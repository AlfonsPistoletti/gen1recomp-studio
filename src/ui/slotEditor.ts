// Slot machine wheels (Global > Slot machines): field.slotWheels, the three
// symbol strips gen1recomp's SlotMachine spins (15 symbols each, then the
// first 3 again so the window can wrap). The win odds themselves (which
// spins may match, payouts) are the engine's code; the strips decide which
// symbols can line up. field is a deep registry: a changed list overrides.

import { store } from "../core/store.ts";
import { h } from "./dom.ts";

export const SLOTS_ID = "slotWheels";
const LEN = 15;

interface Symbols {
  order?: string[];
  symbols?: Record<string, { sheet: string; x: number; y: number; w: number; h: number }>;
}

export function slotsEdited(): boolean {
  return store.isRecordEdited("field", SLOTS_ID);
}

const wheels = (): string[][] => {
  const w = store.table("field")[SLOTS_ID];
  return Array.isArray(w) ? (w as string[][]) : [];
};

export function slotCards(): HTMLElement[] {
  const list = wheels();
  const art = (store.table("field").slotSymbols ?? {}) as Symbols;
  const order = art.order ?? ["7", "BAR", "CHERRY", "FISH", "BIRD", "MOUSE"];
  if (list.length !== 3) return [h("p", { class: "hint" }, "This game has no slot machine wheels.")];
  const { host, version } = store.project;
  // a symbol as its picture (16x16 from the cache's sheet; CSS draws it at 2x)
  const face = (sym: string): HTMLElement => {
    const a = art.symbols?.[sym];
    if (!a) return h("span", { class: "slot-name" }, sym);
    const el = h("span", { class: "slot-face", title: sym });
    el.style.backgroundImage = `url("${host.imageUrl(version, a.sheet)}")`;
    el.style.backgroundPosition = `-${a.x}px -${a.y}px`;
    el.style.width = `${a.w}px`;
    el.style.height = `${a.h}px`;
    return el;
  };
  const set = (w: number, i: number, sym: string) => {
    store.editRecord<string[][]>("field", SLOTS_ID, `Slot wheel ${w + 1}`, (d) => {
      d[w][i] = sym;
      // the wraparound copy of the first three
      d[w] = [...d[w].slice(0, LEN), ...d[w].slice(0, 3)];
    });
    store.seal();
  };
  const cards = list.map((wheel, w) => {
    const strip = wheel.slice(0, LEN).map((sym, i) => {
      const b = h("button", { class: "slot-cell", title: `${sym}: click to pick another symbol` }, face(sym));
      b.addEventListener("click", () => pickSymbol(b, sym, order, face, (next) => set(w, i, next)));
      return b;
    });
    const counts = order.map((sym) => `${sym} ×${wheel.slice(0, LEN).filter((s) => s === sym).length}`).join(" · ");
    return h("section", { class: "card" },
      h("h4", {}, `Wheel ${w + 1}`),
      h("div", { class: "slot-strip" }, ...strip),
      h("p", { class: "hint" }, counts),
    );
  });
  return [
    ...cards,
    h("p", { class: "hint" }, "Click a symbol to swap it. Left to right is the order the wheel turns. More of a symbol on a wheel lets it line up more often. Payouts stay the game's: 7-7-7 pays 300, BAR 100, CHERRY 8, the rest 15; whether a spin may win at all is decided by the engine's luck rolls."),
    slotsEdited()
      ? h("div", {}, h("button", { class: "btn small danger", onclick: () => store.revertRecord("field", SLOTS_ID, "Slot wheels: the game's") }, "Back to the game's wheels"))
      : h("span", {}),
  ];
}

// a floating row of every symbol under `anchor`; picking one replaces the
// cell's. Closes on a pick, a click elsewhere or Escape.
function pickSymbol(anchor: HTMLElement, current: string, order: string[], face: (sym: string) => HTMLElement, onPick: (sym: string) => void): void {
  document.querySelector(".slot-picker")?.remove();
  const close = () => {
    pop.remove();
    document.removeEventListener("pointerdown", outside, true);
    document.removeEventListener("keydown", esc, true);
  };
  const outside = (e: Event) => {
    if (!pop.contains(e.target as Node)) close();
  };
  const esc = (e: KeyboardEvent) => {
    if (e.key === "Escape") close();
  };
  const pop = h("div", { class: "slot-picker" },
    ...order.map((sym) =>
      h("button", {
        class: `slot-cell${sym === current ? " active" : ""}`,
        title: sym,
        onclick: () => {
          close();
          if (sym !== current) onPick(sym);
        },
      }, face(sym)),
    ),
  );
  const r = anchor.getBoundingClientRect();
  pop.style.left = `${r.left}px`;
  pop.style.top = `${r.bottom + 4}px`;
  document.body.append(pop);
  // keep it on screen
  const pr = pop.getBoundingClientRect();
  if (pr.right > window.innerWidth - 8) pop.style.left = `${Math.max(8, window.innerWidth - 8 - pr.width)}px`;
  setTimeout(() => {
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", esc, true);
  });
}
