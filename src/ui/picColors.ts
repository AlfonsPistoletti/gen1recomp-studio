// The "Colors" choice of the Pokémon and Trainers workspaces: battle pics are
// 4 gray shades the game colors with a palette (gen1recomp BattleState
// monPalette / trainerPalette). A view is "" (the pic's own palette, what the
// game uses), REDPP (that palette in RED++ colors), GRAYS (as drawn) or a
// palette name.

import { gbcAvailable, gbcMonPalette, gbcPalette, GRAYS, REDPP } from "../core/gbc.ts";
import { store } from "../core/store.ts";
import type { Rgb } from "../render/color.ts";
import { h } from "./dom.ts";

// the palette names the game offers (a map's palette choices)
export function paletteChoices(): string[] {
  const f = store.adapter.mapFields.find((x) => x.kind === "select" && x.key === "palette");
  return f && f.kind === "select" ? f.options(store.ctx) : [];
}

// a palette's colors, lightest first: the game's (as the mod edits them), or
// RED++'s when `redpp` (falling back to the game's for names RED++ lacks)
export function namedColors(name: string, redpp: boolean): Rgb[] | null {
  const own = store.table("palettes")[name] as Rgb[] | undefined;
  return (redpp ? gbcPalette(name) : null) ?? (own?.length === 4 ? own : null);
}

// a species' palette name (PaletteFX.monPalName): its own `palette`, else
// the game's species table (RED++'s when `redpp`), else MEWMON
export function monPaletteName(species: string, rec: Record<string, unknown> | undefined, redpp: boolean): string {
  if (typeof rec?.palette === "string" && store.table("palettes")[rec.palette]) return rec.palette;
  const byGame = (store.project.data.extra.palettes as { pokemon?: Record<string, string> } | undefined)?.pokemon ?? {};
  return (redpp ? gbcMonPalette(species) : undefined) ?? byGame[species] ?? "MEWMON";
}

// A record's battle palette (its `palette` field): any palette of the game
// or the mod; empty = the game's choice, named in `gameLabel`.
export function paletteField(value: unknown, gameLabel: string, onChange: (name: string) => void): HTMLSelectElement {
  const sel = h("select", { title: "The palette the game colors these battle pictures with" },
    h("option", { value: "", selected: typeof value !== "string" }, `The game's (${gameLabel})`),
    ...paletteChoices().map((n) => h("option", { value: n, selected: value === n }, n)),
  );
  sel.addEventListener("change", () => onChange(sel.value));
  return sel;
}

// the view a workspace starts in: RED++ when the map view shows RED++
export function defaultView(): string {
  return store.colorMode === "redpp" && gbcAvailable() ? REDPP : "";
}

// The colors (lightest first) to show a pic in, or null for as drawn.
// `own(redpp)`: the pic's own palette name.
export function picColors(view: string, own: (redpp: boolean) => string, trueColor = false): Rgb[] | null {
  if (trueColor || view === GRAYS) return null;
  if (view === REDPP) return namedColors(own(true), true);
  return namedColors(view || own(false), false);
}

// The dropdown. `ownLabel`: the pic's own palette, shown in its first choice.
export function colorSelect(view: string, ownLabel: string, disabled: boolean, onChange: (view: string) => void): HTMLSelectElement {
  const redpp = gbcAvailable();
  const sel = h(
    "select",
    { title: "How the pictures are shown here; in battle the game uses their own palette", disabled },
    h("option", { value: "", selected: view === "" }, `Colors: its own (${ownLabel})`),
    ...(redpp ? [h("option", { value: REDPP, selected: view === REDPP }, "Colors: RED++ (Game Boy Color)")] : []),
    ...paletteChoices().map((n) => h("option", { value: n, selected: view === n }, `Colors: ${n}`)),
    h("option", { value: GRAYS, selected: view === GRAYS }, "Game Boy grays"),
  );
  sel.addEventListener("change", () => onChange(sel.value));
  return sel;
}
