// Gen 2 round-trip checks on an imported Gold/Silver/Crystal dataset, through
// the same project code the browser runs, without touching mods/:
//   1. every vanilla map diffs to nothing against itself
//   2. edited content records -> studio_content.lua -> run through the Lua VM
//      -> applied over the base give back exactly the edited records
// Run: npm run selftest:gen2

// Gen 2 is behind src/features.ts (a Vite define, absent in Node): on here,
// before the modules that read it load (dynamic imports run in order)
(globalThis as { __EXPERIMENTAL__?: boolean }).__EXPERIMENTAL__ = true;
const { applyOps, clone, deepEqual, diffRecord } = await import("../src/core/merge.ts");
const { adapterFor } = await import("../src/games/index.ts");
const { runMod } = await import("../src/lua/vm.ts");
const { studioContentFile } = await import("../src/lua/writer.ts");
const { contentCalls, fieldOrders, isDeep, openProject } = await import("../src/project/project.ts");
const { nodeHost } = await import("./nodeHost.ts");

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

const info = await nodeHost.info();
const version = info.versions.find((v) => v.available && adapterFor(v.version)?.id === "gen2")?.version;
if (!version) {
  console.log("FAIL no Gen 2 dataset imported (or the Gen 2 feature is off)");
  process.exit(1);
}
const adapter = adapterFor(version)!;

const t0 = Date.now();
const project = await openProject(nodeHost, version, adapter, null);
const base = project.data.maps;
check(`load ${version} project`, Object.keys(base).length > 200, `${Object.keys(base).length} maps in ${Date.now() - t0} ms`);
const nonEmpty = Object.values(base).filter((m) => diffRecord(m, clone(m)) !== undefined);
check("vanilla maps diff to nothing", nonEmpty.length === 0, nonEmpty.map((m) => m.id).join(", "));

const content = project.data.content;
type Rec = Record<string, unknown>;
check("type chart has Gold's types", ["DARK", "STEEL", "PSYCHIC_TYPE"].every((t) => t in content.type_chart));
check("Foresight rows are matchups", "NORMAL>GHOST" in content.type_chart);

const edited: Record<string, Rec> = {};
const chikorita = clone(content.pokemon.CHIKORITA) as Rec;
(chikorita.baseStats as Rec).specialAttack = 99;
(chikorita.levelMoves as Rec[]).push({ level: 55, move: "PETAL_DANCE" });
chikorita.eggMoves = ["VINE_WHIP"];
(chikorita.evolutions as Rec[])[0].level = 14;
chikorita.eggGroups = ["EGG_DRAGON", "EGG_PLANT"];
chikorita.eggGroupsRaw = 0xe7;
chikorita.types = ["FIRE", "FIRE"];
// only the rare held item: a sparse table, { [2] = id } in Lua
const chansey = clone(content.pokemon.CHANSEY) as Rec;
check("sparse held items load as { 2: id }", deepEqual(chansey.items, { 2: "LUCKY_EGG" }), JSON.stringify(chansey.items));
chansey.items = { 2: "BERRY" };
check("Pokédex entries loaded into the records", typeof (chikorita.dexEntry as Rec | undefined)?.text === "string");
(chikorita.dexEntry as Rec).kind = "TESTLEAF";
edited.pokemon = { CHIKORITA: chikorita, CHANSEY: chansey };
edited.moves = { TACKLE: { ...(clone(content.moves.TACKLE) as Rec), power: 40 } };
edited.items = { POTION: { ...(clone(content.items.POTION) as Rec), price: 250 } };
edited.type_chart = { "FIRE>STEEL": { multiplier: 10 } };
// encounters: kind records holding every map; one map's entries change
{
  const enc = content.encounters as Record<string, Record<string, Rec>>;
  const grass = clone(enc.grass) as Record<string, Rec>;
  ((grass.ROUTE_29.slots as Record<string, Rec[]>).DAY[0]).species = "PIKACHU";
  delete grass.ROUTE_30;
  const fish = clone(enc.fishGroups) as Record<string, Record<string, Rec[]>>;
  const group = Object.keys(fish)[0];
  fish[group].old[0].level = 42;
  // headbutt trees: a map's set, and a row of a shared set; a swarm table
  const trees = clone(enc.trees) as Record<string, unknown>;
  trees.ROUTE_29 = "TREEMON_SET_FOREST";
  delete trees.ROUTE_30;
  const sets = clone(enc.treeSets) as Record<string, Record<string, Rec[]>>;
  sets.TREEMON_SET_FOREST.common[0].chance = 40;
  const swarm = clone(enc.swarmGrass) as Record<string, Rec>;
  const swarmMap = Object.keys(swarm)[0];
  ((swarm[swarmMap].slots as Record<string, Rec[]>).DAY[0]).level = 33;
  edited.encounters = { grass, fishGroups: fish, trees, treeSets: sets, swarmGrass: swarm };
}
// menu icons: a species names another sheet, or a sheet the studio made for it;
// cries: borrowed from another species
check("icons hold species and sheets", typeof content.icons.CHIKORITA === "string" && typeof content.icons.ICON_BULBASAUR === "object");
edited.icons = {
  CHIKORITA: "ICON_STUDIO_CHIKORITA",
  ICON_STUDIO_CHIKORITA: { id: "ICON_STUDIO_CHIKORITA", image: "assets/studio/chikorita_icon_0123abcd.png", width: 16, height: 32, frames: 2 },
  CYNDAQUIL: "ICON_BULBASAUR",
};
edited.cries = { CHIKORITA: { base: "BAYLEEF" } };
// the two text sets: a script text (ROM pointer key) and a named engine text
{
  // a map person's script leads to the texts it shows (Text workspace labels)
  const nb = base.NEW_BARK_TOWN as unknown as { objects: { scriptKey?: string }[] };
  const shown = adapterFor(version)!.scriptTexts!({ data: project.data, maps: base, records: {} }, nb.objects[0].scriptKey!) ?? [];
  check("script texts are found through map scripts", shown.length > 0 && shown.every((k) => typeof content.text[k] === "string"), shown.join(", "));
}
check("rom_text loaded", typeof content.rom_text?._BallDontBeAThiefText === "string");
edited.rom_text = { _BallDontBeAThiefText: "Hands off that" + String.fromCharCode(10) + "ball!{PROMPT}" };
edited.map_songs = { NEW_BARK_TOWN: Object.values(content.map_songs).find((s) => s !== content.map_songs.NEW_BARK_TOWN) as string };

// maps, the way the map tools edit them (through the adapter)
type Ent = Record<string, unknown>;
const newBark = clone(base.NEW_BARK_TOWN);
newBark.blocks[0] = 1;
(newBark.objects as Ent[])[0].x = Number((newBark.objects as Ent[])[0].x) + 1;
(newBark.warps as Ent[]).push(adapter.layers.find((l) => l.kind === "warp")!.create(newBark, 2, 2, { data: project.data, maps: base, records: {} }));
adapter.setConnection(newBark, "north", "ROUTE_29", 3);
const fresh = adapter.newMap({ id: "STUDIO_TEST_MAP", tileset: "TILESET_JOHTO", width: 4, height: 3, fill: 1, index: 1000 });
adapter.setConnection(fresh, "south", "NEW_BARK_TOWN", 0);
const editedMaps: Record<string, Rec> = { NEW_BARK_TOWN: newBark as unknown as Rec, STUDIO_TEST_MAP: fresh as unknown as Rec };
check("new warp leads back the way the player came", (newBark.warps as Ent[]).at(-1)!.destWarp === 255);
check("vanilla warps carry no map-group numbers", !JSON.stringify(base).includes("destGroup"));

// trainers: a class's trainers through the adapter's team accessors
{
  const teams = adapter.trainers!.teams!;
  const beauty = clone(content.trainers.BEAUTY) as Rec;
  const parties = teams.read(beauty).map((p) => p.map((m) => ({ ...m })));
  parties[0][0] = { species: "MEOWTH", level: 12, item: "BERRY", moves: ["SCRATCH", "BITE"] };
  teams.write(beauty, parties);
  teams.setName(beauty, 0, "VICKY");
  check("trainer type follows the slots", (beauty.trainers as Rec[])[0].trainerType === "TRAINERTYPE_ITEM_MOVES");
  // a new trainer in the class, fought by a map person with its own record
  teams.write(beauty, [...teams.read(beauty), [{ species: "PIDGEY", level: 7 }]]);
  check("new trainer gets the next member number", (beauty.trainers as Rec[]).at(-1)!.index === (beauty.trainers as Rec[]).length);
  const ot = adapter.trainers!.objectTrainer!;
  const ctx = { data: project.data, maps: base, records: {} };
  const flag = ot.freeFlag(ctx);
  check("a free event flag above the game's", flag !== null && flag > 1931 && flag < 2048, String(flag));
  const room = newBark.objects as Ent[];
  room.push({ x: 4, y: 4, sprite: "SPRITE_YOUNGSTER", movement: 6, type: ot.typeValue, sight: 3, trainer: { class: ot.classIndex(ctx, "BEAUTY"), member: (beauty.trainers as Rec[]).length, event: flag, seenText: "STUDIO_TRAINER_1_SEEN", winText: "STUDIO_TRAINER_1_WIN" } });
  edited.text = { STUDIO_TRAINER_1_SEEN: "Let's battle!{DONE}", STUDIO_TRAINER_1_WIN: "I lost…{DONE}" };
  // a new class: the next number, the source's first trainer, its colors
  const s = adapter.trainers!;
  const indexes = Object.values(content.trainers).map((t) => Number((t as Rec).index)).filter(Number.isFinite);
  const fresh = { ...(clone(content.trainers.BEAUTY) as Rec), id: "STUDIO_CLASS", name: "TESTER", index: Math.max(...indexes) + 1 };
  teams.write(fresh, teams.read(fresh).slice(0, 1));
  check("new class number within the engine's limit", (fresh.index as number) <= s.limits!.classIndex);
  const extras = s.classExtras!("BEAUTY", "STUDIO_CLASS", ctx);
  check("new class gets the source's colors", extras.length === 1 && !!((extras[0].value as Rec).STUDIO_CLASS));
  edited.palettes = { trainers: extras[0].value as Rec };
  // the AI in the attribute bytes (move layers 4-5, switching 6-7) and the items list
  const ai = adapter.trainers!.aiAttributes!;
  const attrs = [...(beauty.attributes as number[])];
  attrs[ai.aiByte] = 0x1f; attrs[ai.aiByte + 1] = 0x02; attrs[ai.switchByte] = (attrs[ai.switchByte] & ~0x07) | 0x01;
  beauty.attributes = attrs;
  beauty.items = ["FULL_RESTORE", "X_SPEED"];
  edited.trainers = { BEAUTY: beauty, STUDIO_CLASS: fresh };
}
const { calls } = contentCalls(adapter, { maps: base, ...content }, { maps: editedMaps, ...edited });
const source = studioContentFile("studio_selftest", calls, fieldOrders(adapter));
const file = "mods/studio_selftest/studio_content.lua";
const run = await runMod(new Map([[file, source]]), "studio_selftest", file, null);
check("generated Lua runs", run.errors.length === 0, run.errors.join("; "));
check("no game paths written", !source.includes("assets/generated"));
check("sparse held item written as [2]", source.includes('[2] = "BERRY"'));
check("encounters patched per map, not whole", /encounters:patch\("grass", \{\s+ROUTE_29 = /.test(source) && source.includes("ROUTE_30 = mod.DELETE") && !source.includes("ROUTE_31 ="));
check("dex entry saved as a patch of what changed", /dexEntry = \{ kind = "TESTLEAF" \}/.test(source));
check("icons: species overridden by name, own sheet registered", source.includes('icons:override("CYNDAQUIL", "ICON_BULBASAUR")') && source.includes('icons:register("ICON_STUDIO_CHIKORITA"'));
check("rom_text saved as an override", source.includes('rom_text:override("_BallDontBeAThiefText"'));
check("pokemon saved as a patch", source.includes('pokemon:patch("CHIKORITA"') && !source.includes("spriteFront"));

{
  const working = clone(base);
  applyOps(working, run.ops, "maps");
  for (const id of Object.keys(editedMaps)) check(`round-trip map ${id}`, deepEqual(adapter.normalizeMap(working[id]), adapter.normalizeMap(clone(editedMaps[id] as never))));
  check("untouched map unchanged", deepEqual(working.ROUTE_30, base.ROUTE_30));
  check("new map registered", source.includes('maps:register("STUDIO_TEST_MAP"'));
}

for (const [registry, records] of Object.entries(edited)) {
  const table = { ...content[registry] };
  applyOps(table, run.ops, registry, isDeep(adapter, registry));
  for (const [id, value] of Object.entries(records)) {
    const got = table[id];
    const want = typeof value === "object" && value && "id" in (content[registry]?.[id] as Rec ?? {}) && !("id" in value) ? { ...value, id } : value;
    check(`round-trip ${registry} ${id}`, deepEqual(got, want), deepEqual(got, want) ? "" : JSON.stringify(got).slice(0, 300));
  }
}

// a tileset extension (blocks + their collision quads): the data file reads
// back, and the helper runs (the studio's VM hands out stand-ins for get(),
// so it only checks that the code loads and registers nothing broken)
{
  const { dataFile, studioContentFile: contentFile } = await import("../src/lua/writer.ts");
  const { loadLuaData } = await import("../src/lua/vm.ts");
  const { TILESET_RUNTIME2, tilesetRegistration2 } = await import("../src/lua/tilesetRuntime2.ts");
  const ts = project.data.tilesets.TILESET_JOHTO;
  const first = Math.floor(Number(ts.imageWidth) / 8) * Math.floor(Number(ts.imageHeight) / 8);
  const ext = { first, tiles: [], blocks: [[1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]], collision: [[0, 0, 7, 7]] };
  const dataSrc = dataFile("studio_selftest", "tileset extensions", { TILESET_JOHTO: ext });
  const back = await loadLuaData<Record<string, unknown>>(dataSrc, "studio_tilesets.lua");
  check("studio_tilesets.lua round-trips", deepEqual(back.TILESET_JOHTO, ext), JSON.stringify(back.TILESET_JOHTO));
  const src = contentFile("studio_selftest", [], {}, TILESET_RUNTIME2 + "\n" + tilesetRegistration2("studio_selftest", "studio_tilesets.lua"));
  const f = "mods/studio_selftest/studio_content.lua";
  const ran = await runMod(new Map([[f, src], ["mods/studio_selftest/studio_tilesets.lua", dataSrc]]), "studio_selftest", f, null);
  check("Gen 2 tileset helper runs", ran.errors.length === 0, ran.errors.join("; "));
  check("Gen 2 tileset helper has no backticks", !TILESET_RUNTIME2.includes("`"));

  // Crystal: a 256-slot sheet (both VRAM banks); added tiles go into its blank
  // slots 0xE0.. and the recipe paints them there, not below the sheet
  const { newExtension } = await import("../src/core/tilesets.ts");
  const { recipe } = await import("../src/core/assets.ts");
  const crystal = { ...ts, imageWidth: 128, imageHeight: 128, tileAttrs: { 1: { palette: 1, vramBank: 0 } } };
  const cext = newExtension(crystal, true);
  check("Crystal tiles are added from slot 0xE0", cext.first === 0xe0 && cext.sheet === 256, JSON.stringify(cext));
  check("Gold tiles are added below the sheet", newExtension(ts, true).first === first && newExtension(ts, true).sheet === undefined);
  const lua = recipe("studio_selftest", [], [{ source: "tilesets/johto.png", out: "studio/tilesets/x.png", per: 16, first: 0xe0, tiles: ["0".repeat(64)] }]);
  check("recipe places Crystal tiles inside the sheet", lua.includes("first = 224,") && lua.includes("local first = s.first or"));
  const cdata = dataFile("studio_selftest", "tileset extensions", { TILESET_JOHTO: { ...cext, tiles: ["0".repeat(64)], palettes: [3], blocks: [[0xe0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]], collision: [[0, 0, 0, 0]] } });
  const cran = await runMod(new Map([[f, src], ["mods/studio_selftest/studio_tilesets.lua", cdata]]), "studio_selftest", f, null);
  check("Gen 2 tileset helper runs a Crystal extension", cran.errors.length === 0, cran.errors.join("; "));
}

// Gold events (inline script lists): blocks -> rows -> blocks, and the
// script tested in the game (2026-10-18) reads as the blocks it was made of
{
  const { compile: gcompile, parse: gparse } = await import("../src/games/gen2/events.ts");
  const ctx = { data: project.data, maps: base, records: {} };
  const blocks = [
    { t: "cmd", row: ["faceplayer"] },
    { t: "if", cond: ["checkevent", 2030], not: false, then: [{ t: "cmd", row: ["writetext", "T_AGAIN"] }], else: [
      { t: "if", cond: ["yesorno", "T_ASK"], not: false, then: [{ t: "cmd", row: ["writetext", "T_YES"] }, { t: "cmd", row: ["verbosegiveitem", "POTION", 1] }, { t: "cmd", row: ["setevent", 2030] }], else: [{ t: "cmd", row: ["writetext", "T_NO"] }] },
    ] },
    { t: "cmd", row: ["pause", 10] },
  ] as never;
  const rows = gcompile(blocks, ctx) as unknown as Record<string, unknown>[];
  check("Gold event opens the text box after facing the player", rows[0].op === "faceplayer" && rows[1].op === "opentext", JSON.stringify(rows.slice(0, 3)));
  check("Gold event items are numbers", JSON.stringify(rows).includes('"op":"verbosegiveitem","item":18'), JSON.stringify(rows));
  const back = gparse(rows as never, ctx);
  check("Gold event blocks round-trip", deepEqual(back, blocks), JSON.stringify(back));
  check("Gold event rows round-trip", deepEqual(gcompile(back, ctx), rows));
  // the second set of commands: battles (several rows each), money with its
  // own If row, people, sounds
  const more = [
    { t: "if", cond: ["checkmoney", 1000], not: false, then: [
      { t: "cmd", row: ["takemoney", 1000] },
      { t: "cmd", row: ["#trainerbattle", "YOUNGSTER", 2, "T_WIN"] },
      { t: "cmd", row: ["#heal"] },
    ], else: [{ t: "cmd", row: ["showemote", 2, "question", 15] }] },
    { t: "cmd", row: ["#wildbattle", "SUDOWOODO", 20] },
    { t: "cmd", row: ["turnobject", 0, "left"] },
    { t: "cmd", row: ["playsound", "Sfx_Item"] },
    { t: "cmd", row: ["playmusic", "Music_Route1"] },
  ] as never;
  const moreRows = gcompile(more, ctx) as unknown as Record<string, unknown>[];
  const text = JSON.stringify(moreRows);
  check("Has money reads HAVE_LESS (ifnotequal 2)", text.includes('"op":"ifnotequal","value":2'), text.slice(0, 200));
  check("a trainer battle closes the text box around its rows", text.includes('{"op":"closetext"},{"op":"winlosstext","winText":"T_WIN"},{"op":"loadtrainer"'));
  check("money is 3 big-endian bytes", text.includes('"op":"takemoney","args":[0,0,3,232]'));
  check("Gold event battles, money and people round-trip", deepEqual(gparse(moreRows as never, ctx), more), JSON.stringify(gparse(moreRows as never, ctx)).slice(0, 400));
  // the game's own events: New Bark's teacher (three flag checks) reads in
  // with its branches as nested lists, and as If blocks
  const { GEN2_EVENTS } = await import("../src/games/gen2/events.ts");
  const teacher = GEN2_EVENTS.gameRows!(ctx, "48:406f") as unknown as Record<string, unknown>[] | null;
  check("a game script reads in with its branches", !!teacher && teacher.some((r) => r.op === "iftrue" && Array.isArray(r.script)), JSON.stringify(teacher).slice(0, 200));
  const tb = gparse((teacher ?? []) as never, ctx) as { t: string }[];
  check("a game script shows as If blocks", tb.filter((b) => b.t === "if").length >= 1 && !JSON.stringify(tb).includes('"#raw",{"op":"iftrue"'), JSON.stringify(tb).slice(0, 300));
  // what a Role writes is no event (people's text, nurse, shop, bookshelf)
  const { presetOf } = await import("../src/games/gen2/events.ts");
  check("Role scripts are presets, events are not",
    presetOf([{ op: "jumptextfaceplayer", text: "X" }]) && presetOf([{ op: "jumpstd", std: "PokecenterNurseScript", script: "40:408a" }])
    && presetOf([{ op: "faceplayer" }, { op: "opentext" }, { op: "pokemart", args: [0, 3, 0] }, { op: "closetext" }, { op: "end" }])
    && !presetOf(rows as never));
  const std = (project.data.extra as { stdScripts?: Record<string, string> }).stdScripts ?? {};
  check("the game's std scripts are known by name", typeof std.PokecenterNurseScript === "string" && typeof std.PictureBookshelfScript === "string", JSON.stringify(std).slice(0, 120));
  check("the game's shops are loaded", ((project.data.extra as { marts?: unknown[] }).marts ?? []).length > 20);
}

// custom move effects: Gold's helper is plain Lua, and the game's stat and
// status effects start from their blocks
{
  const { EFFECT_RUNTIME2 } = await import("../src/lua/effectRuntime2.ts");
  const { gen2EffectTemplate } = await import("../src/games/gen2/moveEffects.ts");
  check("Gen 2 effect helper has no backticks", !EFFECT_RUNTIME2.includes("`"));
  const growl = gen2EffectTemplate("EFFECT_ATTACK_DOWN");
  check("Growl's effect has a template", growl?.kind === "status" && growl.steps[0]?.stat === "attack" && growl.steps[0]?.delta === -1, JSON.stringify(growl));
}

// custom item effects: the helper is plain Lua, the game's party items start
// from their blocks, and the ids the helper overrides are the dataset's items
{
  const { ITEM_EFFECT_RUNTIME2, itemEffectRegistration2 } = await import("../src/lua/itemEffectRuntime2.ts");
  const { gen2ItemTemplate, gen2EffectItems } = await import("../src/games/gen2/items.ts");
  check("Gen 2 item effect helper has no backticks", !(ITEM_EFFECT_RUNTIME2 + itemEffectRegistration2("m", "f.lua")).includes("`"));
  const restore = gen2ItemTemplate("FULL_RESTORE");
  check("Full Restore's effect has a template", restore?.steps[0]?.act === "heal" && restore.steps[1]?.act === "cure", JSON.stringify(restore));
  const missing = gen2EffectItems().filter((id) => !content.items[id]);
  check("item effect ids are dataset items", !missing.length, missing.join(", "));
  // Used by: records = the dataset's (no edits)
  const uctx = { data: project.data, maps: base, records: project.data.content as Record<string, Record<string, unknown>> };
  const potion = adapter.items?.uses?.(uctx, "POTION").map((u) => u.label) ?? [];
  const hyper = adapter.items?.uses?.(uctx, "HYPER_POTION").map((u) => u.label) ?? [];
  const berry = adapter.items?.uses?.(uctx, "BERRY").map((u) => u.label) ?? [];
  check("Potion is sold at clerks, once each", potion.some((l) => l.startsWith("Shop: ")) && new Set(potion).size === potion.length, potion.join("; "));
  check("Hyper Potion is a trainer's battle item", hyper.some((l) => l.startsWith("Trainer AI: ")), hyper.join("; "));
  check("Berry is held by trainers and wild Pokémon", berry.some((l) => l.startsWith("Held: ")) && berry.some((l) => l.startsWith("Wild ")), berry.slice(0, 8).join("; "));
}

// a new species: registered whole, with its icon row and colors, and the
// helper that gives it a Pokédex entry
{
  const ctx = { data: project.data, maps: base, records: content as Record<string, Record<string, unknown>> };
  const mon: Rec = { ...(clone(content.pokemon.RATTATA) as Rec), id: "STUDIO_MON", name: "MOUSEY", dex: 252 };
  delete mon.index;
  delete mon.source;
  const extras = adapter.pokemon!.speciesExtras!("RATTATA", "STUDIO_MON", ctx);
  check("new species takes its source's icon and colors", extras.some((x) => x.registry === "icons" && x.value === content.icons.RATTATA) && extras.some((x) => x.registry === "palettes" && !!(x.value as Rec).STUDIO_MON), JSON.stringify(extras.map((x) => x.registry)));
  const edits: Record<string, Rec> = { pokemon: { STUDIO_MON: mon } };
  for (const x of extras) edits[x.registry] = { ...(edits[x.registry] ?? {}), [x.id]: x.value };
  const { calls } = contentCalls(adapter, { maps: base, ...content }, { maps: base as unknown as Rec, ...edits });
  const helper = adapter.saveHelpers!(edits, content as Record<string, Record<string, unknown>>);
  check("Pokédex helper written for a new species", helper.includes("game.ready") && !helper.includes("`"));
  check("no Pokédex helper without one", adapter.saveHelpers!({ pokemon: { RATTATA: content.pokemon.RATTATA as Rec } }, content as Record<string, Record<string, unknown>>) === "");
  const src = studioContentFile("studio_selftest", calls, fieldOrders(adapter), helper);
  const f = "mods/studio_selftest/studio_content.lua";
  const ran = await runMod(new Map([[f, src]]), "studio_selftest", f, null);
  check("new species file runs", ran.errors.length === 0, ran.errors.join("; "));
  check("new species registered, colors patched", src.includes('pokemon:register("STUDIO_MON"') && /palettes:patch\("pokemon", \{\s+STUDIO_MON = /.test(src) && src.includes('icons:register("STUDIO_MON"'));
  const dropped = adapter.pokemon!.dropExtras!("STUDIO_MON", { ...ctx, records: { ...ctx.records, ...edits } });
  check("deleting it drops its icon row and colors", dropped.some((x) => x.registry === "icons" && x.value === undefined) && dropped.some((x) => x.registry === "palettes" && !("STUDIO_MON" in (x.value as Rec))));
}

// start values: the helper wraps save.new_game and moves the home spawn
{
  const { startRegistration2 } = await import("../src/lua/startRuntime2.ts");
  const { dataFile } = await import("../src/lua/writer.ts");
  const code = startRegistration2("studio_selftest", "studio_start.lua");
  check("start helper has no backticks", !code.includes("`"));
  const data = dataFile("studio_selftest", "start values", { start: { map: "NEW_BARK_TOWN", x: 6, y: 4, money: 12345 }, names: { player: ["ETHAN", "HIRO", "TAYLOR", "KARL"] } }, ["map", "x", "y", "money", "player"]);
  const f = "mods/studio_selftest/studio_content.lua";
  const ran = await runMod(new Map([[f, studioContentFile("studio_selftest", [], {}, code)], ["mods/studio_selftest/studio_start.lua", data]]), "studio_selftest", f, null);
  check("start helper runs", ran.errors.length === 0, ran.errors.join("; "));
}

// starters: the three balls are found in Elm's lab scripts, with the question
// before their yes/no; the helper loads
{
  const { STARTER_RUNTIME2, starterRegistration2 } = await import("../src/lua/starterRuntime2.ts");
  const { dataFile } = await import("../src/lua/writer.ts");
  const ctx = { data: project.data, maps: base, records: content as Record<string, Record<string, unknown>> };
  const balls = adapter.globals!.starters!.balls(ctx);
  const ids = balls.map((b) => b.ball).sort().join(",");
  check("the three starter balls", ids === "CHIKORITA,CYNDAQUIL,TOTODILE" && balls.every((b) => typeof content.text[b.ask] === "string" && b.level === 5), JSON.stringify(balls));
  const code = STARTER_RUNTIME2 + "\n" + starterRegistration2("studio_selftest", "studio_starters.lua");
  check("starter helper has no backticks", !code.includes("`"));
  const data = dataFile("studio_selftest", "starter Pokémon", { CYNDAQUIL: { species: "PIKACHU", level: 7 } }, ["species", "level"]);
  const f = "mods/studio_selftest/studio_content.lua";
  const ran = await runMod(new Map([[f, studioContentFile("studio_selftest", [], {}, code)], ["mods/studio_selftest/studio_starters.lua", data]]), "studio_selftest", f, null);
  check("starter helper runs", ran.errors.length === 0, ran.errors.join("; "));
}

// Oak's speech: the game's texts load as the text registry's base, every game
// step names a text that exists, and both helpers load
{
  const { INTRO_RUNTIME } = await import("../src/lua/introRuntime.ts");
  const { introRegistration2, introTextRegistration2 } = await import("../src/lua/introRuntime2.ts");
  const { dataFile } = await import("../src/lua/writer.ts");
  const texts = content.studio_intro_text as Record<string, unknown>;
  const intro = adapter.globals!.intro!;
  const missing = intro.steps.filter((st) => st.textKey && typeof texts[st.textKey] !== "string").map((st) => st.id);
  check("Oak's speech texts load", typeof texts._OakText1 === "string" && !missing.length, missing.join(", "));
  const code = INTRO_RUNTIME + "\n" + introRegistration2("studio_selftest", "studio_intro.lua") + "\n" + introTextRegistration2("studio_selftest", "studio_intro_text.lua");
  check("intro helpers have no backticks", !code.includes("`"));
  const spec = dataFile("studio_selftest", "Oak's speech", { speech: { steps: intro.steps.map((st) => ({ id: st.id })) }, demo: { species: "PIKACHU" } }, ["steps", "id", "species"]);
  const txt = dataFile("studio_selftest", "Oak's speech texts", { _OakText1: "Hi there!" }, []);
  const f = "mods/studio_selftest/studio_content.lua";
  const ran = await runMod(new Map([[f, studioContentFile("studio_selftest", [], {}, code)], ["mods/studio_selftest/studio_intro.lua", spec], ["mods/studio_selftest/studio_intro_text.lua", txt]]), "studio_selftest", f, null);
  check("intro helpers run", ran.errors.length === 0, ran.errors.join("; "));
}

// weekday people: Route 40's Monica is there on Mondays (the map's objects
// callback); the studio's own callback changes it and gives the game's back
{
  const { weekdaysOf, setWeekdays } = await import("../src/games/gen2/weekdays.ts");
  const scripts = (project.data.extra as { scripts?: Record<string, unknown> }).scripts ?? {};
  const r40 = clone(base.ROUTE_40);
  const objs = r40.objects as unknown as { index: number; sprite: string }[];
  const found = objs.map((o) => ({ index: o.index, days: weekdaysOf(r40, o.index, scripts) })).filter((x) => x.days);
  check("Monica: Mondays on Route 40", found.length === 1 && JSON.stringify(found[0].days) === "[1]", JSON.stringify(found));
  const monica = found[0]?.index ?? 0;
  const before = JSON.stringify(r40.callbacks);
  setWeekdays(r40, monica, [1, 3], scripts);
  check("Monica: Mondays and Wednesdays", JSON.stringify(weekdaysOf(r40, monica, scripts)) === "[1,3]");
  setWeekdays(r40, objs[0].index === monica ? objs[1].index : objs[0].index, [5], scripts);
  check("a second person on Fridays, Monica kept", JSON.stringify(weekdaysOf(r40, monica, scripts)) === "[1,3]");
  setWeekdays(r40, objs[0].index === monica ? objs[1].index : objs[0].index, null, scripts);
  setWeekdays(r40, monica, [1], scripts);
  check("back to the game's callback", JSON.stringify(r40.callbacks) === before, JSON.stringify(r40.callbacks).slice(0, 200));
}

// gift Pokémon: found in the map people's scripts; the starter + gift helpers
// load side by side (one shared function, defined twice)
{
  const { STARTER_RUNTIME2, starterRegistration2, giftRegistration2 } = await import("../src/lua/starterRuntime2.ts");
  const { dataFile } = await import("../src/lua/writer.ts");
  const ctx = { data: project.data, maps: base, records: content as Record<string, Record<string, unknown>> };
  const gifts = adapter.globals!.gifts!(ctx);
  console.log("     gifts: " + gifts.map((g) => `${g.species}@${g.map} L${g.level}`).join(", "));
  check("gift Pokémon found (Eevee from Bill)", gifts.some((g) => g.species === "EEVEE") && !gifts.some((g) => g.map === "ELMS_LAB"), String(gifts.length));
  const code = [STARTER_RUNTIME2, starterRegistration2("studio_selftest", "studio_starters.lua"), STARTER_RUNTIME2, giftRegistration2("studio_selftest", "studio_gifts.lua")].join("\n");
  check("gift helper has no backticks", !code.includes("`"));
  const st = dataFile("studio_selftest", "starter Pokémon", { CYNDAQUIL: { species: "PIKACHU", level: 7 } }, ["species", "level"]);
  const gf = dataFile("studio_selftest", "gift Pokémon", { "BILLS_FAMILYS_HOUSE:EEVEE": { species: "PIKACHU", level: 20 } }, ["species", "level"]);
  const f = "mods/studio_selftest/studio_content.lua";
  const ran = await runMod(new Map([[f, studioContentFile("studio_selftest", [], {}, code)], ["mods/studio_selftest/studio_starters.lua", st], ["mods/studio_selftest/studio_gifts.lua", gf]]), "studio_selftest", f, null);
  check("starter + gift helpers run", ran.errors.length === 0, ran.errors.join("; "));
}

// in-game trades: events.lua's six rows as one list, offered by map people
{
  const { tradeRegistration2 } = await import("../src/lua/tradeRuntime2.ts");
  const { dataFile } = await import("../src/lua/writer.ts");
  const list = (content.studio_trades as Record<string, unknown>).trades as Record<string, unknown>[];
  check("six trades load", list?.length === 6 && typeof list[0].give === "string", String(list?.length));
  const ctx = { data: project.data, maps: base, records: content as Record<string, Record<string, unknown>> };
  const offers = adapter.globals!.trades!.offers(ctx);
  check("every trade is offered by someone", [1, 2, 3, 4, 5, 6].every((n) => (offers.get(n) ?? []).length > 0), JSON.stringify([...offers].map(([n, o]) => [n, o.map((x) => x.map)])));
  const line = adapter.globals!.trades!.offerLine(ctx, list[0]);
  check("a trade's offer line names its Pokémon", line.includes("DROWZEE") && line.includes("MACHOP") && !line.includes("{"), line);
  const code = tradeRegistration2("studio_selftest", "studio_trades.lua");
  check("trade helper has no backticks", !code.includes("`"));
  const edited = list.map((t, i) => (i === 0 ? { ...t, get: "PIKACHU", nickname: "SPARKY" } : t));
  const df = dataFile("studio_selftest", "in-game trades", { trades: edited }, ["give", "get", "nickname"]);
  const f = "mods/studio_selftest/studio_content.lua";
  const ran = await runMod(new Map([[f, studioContentFile("studio_selftest", [], {}, code)], ["mods/studio_selftest/studio_trades.lua", df]]), "studio_selftest", f, null);
  check("trade helper runs", ran.errors.length === 0, ran.errors.join("; "));
}

// the rest of Global: status numbers patch the game's records; HM badges and
// slot reels are helpers the studio can read back (requires inside game.ready)
{
  const { hmBadgeRegistration2, slotRegistration2 } = await import("../src/lua/fieldRuntime2.ts");
  const { dataFile } = await import("../src/lua/writer.ts");
  const st = clone(content.statuses) as Record<string, Rec>;
  st.burn = { ...st.burn, statPenalty: { stat: "attack", div: 3 } };
  st.sleep = { ...st.sleep, catchBonus: 20 };
  const { calls } = contentCalls(adapter, { maps: base, ...content }, { maps: base as unknown as Rec, statuses: st });
  const src = studioContentFile("studio_selftest", calls, fieldOrders(adapter));
  check("status numbers saved as patches", src.includes('statuses:patch("sleep"') && src.includes('statuses:patch("burn"') && !src.includes("statuses:override"), src.split("\n").filter((l) => l.includes("statuses")).join(" | "));
  const reels = (content.studio_slots as Record<string, unknown>).reels as string[][];
  check("slot reels: 3 x (15 + 3)", reels.length === 3 && reels.every((r) => r.length === 18 && r[15] === r[0]));
  const code = hmBadgeRegistration2("studio_selftest", "studio_field_moves.lua") + "\n" + slotRegistration2("studio_selftest", "studio_slots.lua");
  check("field helpers have no backticks", !code.includes("`"));
  const hm = dataFile("studio_selftest", "HM badges", { badges: { CUT: { badge: "ZEPHYR" } } }, ["badge"]);
  const sl = dataFile("studio_selftest", "slot machine reels", { reels }, []);
  const f = "mods/studio_selftest/studio_content.lua";
  const ran = await runMod(new Map([[f, studioContentFile("studio_selftest", [], {}, code)], ["mods/studio_selftest/studio_field_moves.lua", hm], ["mods/studio_selftest/studio_slots.lua", sl]]), "studio_selftest", f, null);
  check("field helpers load in the studio", ran.errors.length === 0, ran.errors.join("; "));
}

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);

export {};
