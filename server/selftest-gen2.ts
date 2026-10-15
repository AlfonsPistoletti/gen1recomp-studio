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
}

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);

export {};
