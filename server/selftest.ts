// Round-trip checks against the real dataset, through the same project code
// the browser runs (on the Node host), without touching mods/:
//   1. every vanilla map diffs to nothing against itself
//   2. edited maps -> studio_content.lua -> run through the Lua VM -> applied
//      over the base gives back exactly the edited records
//   3. bills_garden's hand-written patch is part of its base
// Run: npm run selftest

import { brokenWarps } from "../src/core/checks.ts";
import { applyOps, clone, deepEqual, diffRecord } from "../src/core/merge.ts";
import type { EntityRecord, MapDef } from "../src/core/types.ts";
import { adapterFor } from "../src/games/index.ts";
import { EFFECT_RUNTIME, effectRegistration } from "../src/lua/effectRuntime.ts";
import { ITEM_EFFECT_RUNTIME, itemEffectRegistration } from "../src/lua/itemEffectRuntime.ts";
import { PRIZE_RUNTIME, prizeRegistration } from "../src/lua/prizeRuntime.ts";
import { EVENT_RUNTIME, eventRegistration } from "../src/lua/eventRuntime.ts";
import { compile, parse } from "../src/core/eventBlocks.ts";
import { gameEvents } from "../src/project/gameEvents.ts";
import { loadLuaData, runMod } from "../src/lua/vm.ts";
import { dataFile, studioContentFile } from "../src/lua/writer.ts";
import { contentCalls, fieldOrders, isDeep, keptOps, listMods, openProject } from "../src/project/project.ts";
import { nodeHost } from "./nodeHost.ts";

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

const info = await nodeHost.info();
const version = info.versions.find((v) => v.available && adapterFor(v.version))?.version;
if (!version) {
  console.log("FAIL no supported dataset imported");
  process.exit(1);
}
const adapter = adapterFor(version)!;

const t0 = Date.now();
const project = await openProject(nodeHost, version, adapter, null);
const base = project.data.maps;
check(`load ${version} project`, Object.keys(base).length > 200, `${Object.keys(base).length} maps in ${Date.now() - t0} ms`);

const nonEmpty = Object.values(base).filter((m) => diffRecord(m, clone(m)) !== undefined);
check("vanilla maps diff to nothing", nonEmpty.length === 0, nonEmpty.map((m) => m.id).join(", "));

const badSize = Object.values(base).filter((m) => m.blocks.length !== m.width * m.height);
check("blocks == width*height", badSize.length === 0, badSize.map((m) => m.id).join(", "));

// --- edit a few maps the way the UI does, through the adapter
const list = (m: MapDef, key: string) => m[key] as EntityRecord[];
const edited: Record<string, MapDef> = {};

const pallet = clone(base.PALLET_TOWN);
pallet.blocks[0] = 11;
list(pallet, "objects")[0].x += 1;
list(pallet, "warps").push(adapter.layers.find((l) => l.kind === "warp")!.create(pallet, 2, 2, { data: project.data, maps: base, records: {} }));
pallet.palette = "CERULEAN";
edited.PALLET_TOWN = pallet;

const route1 = clone(base.ROUTE_1);
adapter.setConnection(route1, "north", null, 0);
route1.signs = [];
edited.ROUTE_1 = route1;

const fresh = adapter.newMap({ id: "STUDIO_TEST_MAP", tileset: "OVERWORLD", width: 4, height: 3, fill: 10, index: 1000 });
adapter.setConnection(fresh, "north", "PALLET_TOWN", 2);
edited.STUDIO_TEST_MAP = fresh;

// --- and other registries, the way their editors do
const content = project.data.content;
type Rec = Record<string, unknown>;
const editedContent: Record<string, Rec> = {};

const bulbasaur = clone(content.pokemon.BULBASAUR) as Rec;
(bulbasaur.baseStats as Rec).attack = 99;
(bulbasaur.learnset as Rec[]).push({ level: 50, move: "SOLARBEAM" });
bulbasaur.types = ["GRASS"];
editedContent.pokemon = { BULBASAUR: bulbasaur };

const route1Wild = clone(content.encounters.ROUTE_1) as Rec;
(route1Wild.grass as Rec).rate = 30;
((route1Wild.grass as Rec).slots as Rec[])[0] = { level: 5, species: "PIKACHU" };
const freshWild: Rec = { grass: { rate: 20, slots: Array.from({ length: 10 }, () => ({ level: 3, species: "RATTATA" })) } };
editedContent.encounters = { ROUTE_1: route1Wild, PALLET_TOWN: freshWild };

const textKey = Object.keys(content.text).find((k) => typeof content.text[k] === "string")!;
editedContent.text = { [textKey]: "HELLO\nSTUDIO!", _StudioSelftestText: "NEW TEXT" };

const { calls } = contentCalls(adapter, { maps: base, ...content }, { maps: edited, ...editedContent });
const source = studioContentFile("studio_selftest", calls, fieldOrders(adapter));
const file = "mods/studio_selftest/studio_content.lua";
const run = await runMod(new Map([[file, source]]), "studio_selftest", file, null);
check("generated Lua runs", run.errors.length === 0, run.errors.join("; "));
check("one registry call per edited record", run.ops.length === 8, `${run.ops.length} ops`);

const working = clone(base);
applyOps(working, run.ops, "maps");
for (const id of Object.keys(edited)) {
  check(`round-trip ${id}`, deepEqual(adapter.normalizeMap(working[id]), adapter.normalizeMap(clone(edited[id]))));
}
check("untouched map unchanged", deepEqual(working.VIRIDIAN_CITY, base.VIRIDIAN_CITY));
check("deleted connection emitted as mod.DELETE", source.includes("north = mod.DELETE"));
// the engine indexes def.warps without a nil check (Warp.lua): a new map must
// keep its empty lists
{
  const reg = source.slice(source.indexOf('maps:register("STUDIO_TEST_MAP"'));
  const body = reg.slice(0, reg.indexOf("\n  })"));
  check("new map keeps empty warps/objects/signs", ["warps = {}", "objects = {}", "signs = {}"].every((k) => body.includes(k)));
}
const vanillaBroken = brokenWarps(adapter, base);
check("no broken warps in vanilla", vanillaBroken.length === 0, vanillaBroken.slice(0, 3).map((p) => p.message).join(" | "));
{
  const towerless = { ...base, VERMILION_CITY: clone(base.VERMILION_CITY), STUDIO_TEST_MAP: fresh };
  list(towerless.VERMILION_CITY, "warps").push({ x: 1, y: 1, destMap: "STUDIO_TEST_MAP", destWarp: 1 });
  check("warp into a map without warps is reported", brokenWarps(adapter, towerless, ["VERMILION_CITY"]).length === 1);
}

for (const [registry, records] of Object.entries(editedContent)) {
  const table = { ...content[registry] };
  applyOps(table, run.ops, registry, isDeep(adapter, registry));
  for (const [id, value] of Object.entries(records)) {
    const got = table[id] as Rec | string;
    const carriesId = Object.values(content[registry] ?? {}).some((r) => typeof r === "object" && r !== null && "id" in r);
    const want = carriesId && typeof value === "object" && value && !("id" in value) && typeof got === "object" ? { ...value, id } : value;
    check(`round-trip ${registry} ${id}`, deepEqual(got, want));
  }
}
check("pokemon saved as a minimal patch", /pokemon:patch\("BULBASAUR", \{\n(?:(?!spriteFront).)*\}\)/s.test(source) && !source.includes("spriteFront"));
check("new encounter table registered", source.includes('encounters:register("PALLET_TOWN"'));
check("text saved as override", source.includes(`text:override("${textKey}", "HELLO\\nSTUDIO!")`));

// custom move effects: the data file plus the generated helper register the
// effect, and the data file reads back unchanged
{
  const spec = { kind: "damaging", hits: "2-5", recoil: 25, steps: [{ act: "status", who: "target", status: "BRN", chance: 77 }] };
  const dataSrc = dataFile("studio_selftest", "custom move effects", { STUDIO_TEST_EFFECT: spec });
  const contentSrc = studioContentFile("studio_selftest", [], {}, EFFECT_RUNTIME + "\n" + effectRegistration("studio_selftest", "studio_effects.lua"));
  const files = new Map([[file, contentSrc], ["mods/studio_selftest/studio_effects.lua", dataSrc]]);
  const fxRun = await runMod(files, "studio_selftest", file, null);
  check("custom effect helper runs", fxRun.errors.length === 0, fxRun.errors.join("; "));
  check("custom effect registered", fxRun.ops.some((o) => o.registry === "move_effects" && o.id === "STUDIO_TEST_EFFECT"));
  const back = await loadLuaData<Record<string, unknown>>(dataSrc, "studio_effects.lua");
  check("studio_effects.lua round-trips", deepEqual(back.STUDIO_TEST_EFFECT, spec), JSON.stringify(back.STUDIO_TEST_EFFECT));
  check("generated helper has no backticks", !EFFECT_RUNTIME.includes("`"));
}

// a re-loaded text_pointers patch (a record without an id) saves back without one
{
  const ops = [{ registry: "text_pointers", op: "patch", id: "ViridianMart", value: { TEXT_VIRIDIANMART_CLERK: { mart: ["POKE_BALL"] } } }] as Parameters<typeof applyOps>[1];
  const table = clone(content.text_pointers) as Record<string, Rec>;
  applyOps(table, ops, "text_pointers");
  check("text_pointers record gets no id", !("id" in table.ViridianMart));
  applyOps(table, [{ registry: "text_pointers", op: "patch", id: "ViridianMart", value: { id: "ViridianMart" } }] as Parameters<typeof applyOps>[1], "text_pointers");
  check("a stray stamped id is dropped on load", !("id" in table.ViridianMart));
}

// shop stock lives in text_pointers, which the engine merges "deep": a patched
// list appends, so adding writes only the new tail and removing overrides
{
  const shop = content.text_pointers.ViridianMart as Record<string, { mart?: string[] }>;
  const stock = shop.TEXT_VIRIDIANMART_CLERK.mart ?? [];
  const added = { ...clone(shop), TEXT_VIRIDIANMART_CLERK: { ...shop.TEXT_VIRIDIANMART_CLERK, mart: [...stock, "MAX_POTION"] } };
  const addCalls = contentCalls(adapter, { maps: base, ...content }, { text_pointers: { ViridianMart: added } }).calls;
  check("shop addition is a patch with only the new item", addCalls.length === 1 && addCalls[0].op === "patch" && deepEqual((addCalls[0].value as typeof shop).TEXT_VIRIDIANMART_CLERK.mart, ["MAX_POTION"]), JSON.stringify(addCalls[0]?.value));
  const table = clone(content.text_pointers) as Record<string, unknown>;
  applyOps(table, addCalls.map((c) => ({ ...c, value: c.value })) as Parameters<typeof applyOps>[1], "text_pointers", true);
  check("shop addition reads back without duplicates", deepEqual((table.ViridianMart as typeof shop).TEXT_VIRIDIANMART_CLERK.mart, [...stock, "MAX_POTION"]));
  const removed = { ...clone(shop), TEXT_VIRIDIANMART_CLERK: { ...shop.TEXT_VIRIDIANMART_CLERK, mart: stock.slice(1) } };
  const rmCalls = contentCalls(adapter, { maps: base, ...content }, { text_pointers: { ViridianMart: removed } }).calls;
  check("shop removal overrides the map's pointers", rmCalls.length === 1 && rmCalls[0].op === "override");
}

// a map's song is a plain string record: written as override
{
  check("vanilla map songs loaded", typeof content.map_songs?.PALLET_TOWN === "string" && Object.keys(content.music ?? {}).length > 20);
  const calls = contentCalls(adapter, { maps: base, ...content }, { map_songs: { PALLET_TOWN: "Music_Routes1" } }).calls;
  const src = studioContentFile("studio_selftest", calls, fieldOrders(adapter));
  check("map song written as override", src.includes('map_songs:override("PALLET_TOWN", "Music_Routes1")'), src.slice(-200));
}

// cries: switching between chip data and a file is an override
{
  check("vanilla cries loaded", !!(content.cries?.ONIX as { header?: unknown } | undefined)?.header);
  const calls = contentCalls(adapter, { maps: base, ...content }, { cries: { ONIX: { file: "mods/studio_selftest/assets/studio/onix_cry_00000000.wav" }, STEELIX: { base: "ONIX" } } }).calls;
  const src = studioContentFile("studio_selftest", calls, fieldOrders(adapter));
  check("cry file written as override", src.includes('cries:override("ONIX", { file = "mods/studio_selftest/assets/studio/onix_cry_00000000.wav" })'), src.slice(-300));
  check("new species' cry registered", src.includes('cries:register("STEELIX", { base = "ONIX" })') || src.includes('cries:override("STEELIX", { base = "ONIX" })'));
}

// events: blocks <-> rows, data file + helper register talk/step/enter
{
  const spec = adapter.events!;
  const verbs = { checks: new Set(spec.commands.filter((c) => c.condition).map((c) => c.verb)), choiceVerb: spec.choiceVerb };
  const rows = compile([
    { t: "cmd", row: ["face_player"] },
    { t: "if", cond: ["check_flag", "STUDIO_SELFTEST_GOT"], not: true, then: [{ t: "cmd", row: ["give_item", "POTION", 1] }, { t: "cmd", row: ["set_flag", "STUDIO_SELFTEST_GOT"] }], else: [{ t: "cmd", row: ["show_text", "Bye!"] }] },
    { t: "choice", labels: ["A", "B", "C"], branches: [[{ t: "cmd", row: ["show_text", "a"] }], [], [{ t: "stop" }]] },
  ], verbs);
  check("event blocks round-trip", deepEqual(compile(parse(rows, verbs), verbs), rows));
  const walk = compile([{ t: "follow", npc: 1, path: ["down", "down", "right"], from: "up" }, { t: "follow", npc: 2, path: [], from: "left" }], verbs);
  const walkBack = parse(walk, verbs);
  check("follow block round-trips (also with no steps yet)", deepEqual(walkBack, [{ t: "follow", npc: 1, path: ["down", "down", "right"], from: "up" }, { t: "follow", npc: 2, path: [], from: "left" }]), JSON.stringify(walkBack));
  check("the follower steps into the leader's cell first", deepEqual(walk[1], ["walk_npc", "player", ["down", "down", "down"]]), JSON.stringify(walk[1]));
  const events = {
    "PALLET_TOWN:talk:TEXT_PALLETTOWN_GIRL": { rows },
    "PALLET_TOWN:step:gate": { x: 10, y: 1, once: true, rows: [["show_text", "Stop!"], ["move_player", "down", 1]] },
    "PALLET_TOWN:enter:welcome": { rows: [["show_text", "Welcome!"]] },
  };
  const dataSrc = dataFile("studio_selftest", "map events", events, ["x", "y", "once", "rows"]);
  const contentSrc = studioContentFile("studio_selftest", [], {}, EVENT_RUNTIME + "\n" + eventRegistration("studio_selftest", "studio_events.lua"));
  const evRun = await runMod(new Map([[file, contentSrc], ["mods/studio_selftest/studio_events.lua", dataSrc]]), "studio_selftest", file, null);
  check("event helper runs", evRun.errors.length === 0, evRun.errors.join("; "));
  check("events registered", evRun.ops.some((o) => o.registry === "map_scripts" && o.id === "PALLET_TOWN") && evRun.ops.some((o) => o.registry === "commands" && o.id === "studio:check_choice"), evRun.ops.map((o) => `${o.registry}:${o.id}`).join(", "));
  const back = await loadLuaData<Record<string, unknown>>(dataSrc, "studio_events.lua");
  check("studio_events.lua round-trips", deepEqual(back, events), JSON.stringify(back).slice(0, 200));
  check("event helper has no backticks or ${", !EVENT_RUNTIME.includes("`") && !EVENT_RUNTIME.includes("${"));
  // saving again must not copy what the helper registered (it holds functions)
  check("helper registrations are never kept on save", keptOps(adapter, evRun.ops).length === 0, keptOps(adapter, evRun.ops).map((c) => `${c.registry}:${c.id}`).join(", "));
}

// the game's own events (checkout): Oak's talk is a list, cutscenes are code
{
  const game = await gameEvents(nodeHost, version);
  if (game) {
    const oak = game.PALLET_TOWN?.talk?.TEXT_PALLETTOWN_OAK;
    check("game events: Oak's talk is a command list", Array.isArray(oak) && (oak as unknown[][]).some((r) => r[0] === "start_battle"), JSON.stringify(oak)?.slice(0, 80));
    const maps = Object.keys(game).length;
    const lists = Object.values(game).reduce((n, m) => n + Object.values(m.talk).filter(Boolean).length, 0);
    const code = Object.values(game).reduce((n, m) => n + Object.values(m.talk).filter((t) => !t).length + m.code.length, 0);
    check("game events loaded", maps > 50 && lists > 20, `${maps} maps, ${lists} talk lists, ${code} code`);
  } else console.log("skip game events (no data/scripts)");
}

// prize counters: data file + helper register a talk handler per counter
{
  const id = "GAME_CORNER_PRIZE_ROOM:TEXT_GAMECORNERPRIZEROOM_PRIZE_VENDOR_1";
  check("vanilla prize counters restated", Array.isArray((content.prize_counters?.[id] as { prizes?: unknown[] } | undefined)?.prizes));
  const spec = { prizes: [{ species: "MEW", level: 5, cost: 9999 }, { item: "MASTER_BALL", cost: 5000 }, { item: "RARE_CANDY", cost: 100 }] };
  const dataSrc = dataFile("studio_selftest", "Game Corner prize counters", { [id]: spec, "STUDIO_TOWN:TEXT_STUDIOTOWN_PRIZES": spec });
  const contentSrc = studioContentFile("studio_selftest", [], {}, PRIZE_RUNTIME + "\n" + prizeRegistration("studio_selftest", "studio_prizes.lua"));
  const files = new Map([[file, contentSrc], ["mods/studio_selftest/studio_prizes.lua", dataSrc]]);
  const pzRun = await runMod(files, "studio_selftest", file, null);
  check("prize helper runs", pzRun.errors.length === 0, pzRun.errors.join("; "));
  check("prize counters registered per map", ["GAME_CORNER_PRIZE_ROOM", "STUDIO_TOWN"].every((m) => pzRun.ops.some((o) => o.registry === "map_scripts" && o.id === m)), pzRun.ops.map((o) => `${o.registry}:${o.id}`).join(", "));
  const back = await loadLuaData<Record<string, unknown>>(dataSrc, "studio_prizes.lua");
  check("studio_prizes.lua round-trips", deepEqual(back[id], spec), JSON.stringify(back[id]));
  check("prize helper has no backticks or ${", !PRIZE_RUNTIME.includes("`") && !PRIZE_RUNTIME.includes("${"));
}

// field (deep): a landing spot and a PC tile are patches that read back
{
  const field = content.field as Record<string, Record<string, unknown>>;
  const flyWarps = { ...clone(field.flyWarps), STUDIO_TOWN: { x: 5, y: 7 } };
  const extras = clone(field.hiddenExtras) as { pcTiles: Record<string, unknown[]> };
  extras.pcTiles = { ...extras.pcTiles, STUDIO_CENTER: [{ x: 0, y: 3, facing: "up" }] };
  const fCalls = contentCalls(adapter, { maps: base, ...content }, { field: { flyWarps, hiddenExtras: extras } }).calls;
  check("field edits are patches", fCalls.length === 2 && fCalls.every((c) => c.op === "patch"), fCalls.map((c) => `${c.op} ${c.id}`).join(", "));
  const src = studioContentFile("studio_selftest", fCalls, fieldOrders(adapter));
  const fRun = await runMod(new Map([[file, src]]), "studio_selftest", file, null);
  const table = clone(content.field) as Record<string, unknown>;
  applyOps(table, fRun.ops, "field", true);
  check("field edits read back", deepEqual(table.flyWarps, flyWarps) && deepEqual(table.hiddenExtras, extras));
}

// custom item effects: same design, registered as item_effects before the
// item records that name them
{
  const spec = { target: "party", steps: [{ act: "heal", amount: 100 }, { act: "cure" }] };
  const dataSrc = dataFile("studio_selftest", "custom item effects", { STUDIO_MEGA_POTION: spec });
  const itemCalls = contentCalls(adapter, { maps: base, ...content }, {
    items: { MEGA_POTION: { id: "MEGA_POTION", name: "MEGA POTION", price: 1500, effect: "STUDIO_MEGA_POTION", needsTarget: true } },
    balls: { POKE_BALL: { ...(content.balls?.POKE_BALL as Rec), randMax: 240 } },
  });
  const contentSrc = studioContentFile("studio_selftest", itemCalls.calls, fieldOrders(adapter), ITEM_EFFECT_RUNTIME + "\n" + itemEffectRegistration("studio_selftest", "studio_item_effects.lua"));
  const files = new Map([[file, contentSrc], ["mods/studio_selftest/studio_item_effects.lua", dataSrc]]);
  const itRun = await runMod(files, "studio_selftest", file, null);
  check("item effect helper runs", itRun.errors.length === 0, itRun.errors.join("; "));
  const order = itRun.ops.map((o) => `${o.registry}:${o.id}`);
  check("item effect registered before the item", order.indexOf("item_effects:STUDIO_MEGA_POTION") >= 0 && order.indexOf("item_effects:STUDIO_MEGA_POTION") < order.indexOf("items:MEGA_POTION"), order.join(", "));
  check("ball written with override", contentSrc.includes('balls:override("POKE_BALL"') && contentSrc.includes("randMax = 240"));
  const back = await loadLuaData<Record<string, unknown>>(dataSrc, "studio_item_effects.lua");
  check("studio_item_effects.lua round-trips", deepEqual(back.STUDIO_MEGA_POTION, spec), JSON.stringify(back.STUDIO_MEGA_POTION));
  check("item helper has no backticks or ${", !ITEM_EFFECT_RUNTIME.includes("`") && !ITEM_EFFECT_RUNTIME.includes("${"));
  check("vanilla balls restated", !!content.balls?.GREAT_BALL);
}

// a reference to another record (a move borrowing an animation) is written as
// a get() call and comes back as the same reference
{
  const refCalls = contentCalls(adapter, { maps: base, ...content }, { battle_anims: { STUDIO_MOVE: { __ref: "battle_anims:TACKLE" } } });
  const refSource = studioContentFile("studio_selftest", refCalls.calls, fieldOrders(adapter));
  check("reference written as get()", refSource.includes('battle_anims:override("STUDIO_MOVE", mod.content.battle_anims:get("TACKLE") or { seq = {} })'));
  const refRun = await runMod(new Map([[file, refSource]]), "studio_selftest", file, null);
  check("reference read back", deepEqual(refRun.ops[0]?.value, { __ref: "battle_anims:TACKLE" }), JSON.stringify(refRun.ops[0]?.value));
  // loading it (applyOps) and saving again keeps the reference intact
  const loaded: Record<string, unknown> = {};
  applyOps(loaded, refRun.ops, "battle_anims");
  const again = studioContentFile("studio_selftest", contentCalls(adapter, { maps: base, ...content }, { battle_anims: loaded }).calls, fieldOrders(adapter));
  check("reference survives load + save", again.includes('mod.content.battle_anims:get("TACKLE")') && !again.includes("__ref"));
}

// --- a hand-written mod is part of its base
const mods = await listMods(nodeHost);
if (mods.some((m) => m.id === "bills_garden")) {
  const bills = await openProject(nodeHost, version, adapter, "bills_garden");
  check("bills_garden's patch is in its base", bills.data.maps.ROUTE_25.width !== base.ROUTE_25.width || !deepEqual(bills.data.maps.ROUTE_25.blocks, base.ROUTE_25.blocks), `ROUTE_25 width ${bills.data.maps.ROUTE_25.width}`);
  check("no warnings running bills_garden", bills.warnings.length === 0, bills.warnings.join("; "));
}

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
