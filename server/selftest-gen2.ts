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
  edited.encounters = { grass, fishGroups: fish };
}
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

const { calls } = contentCalls(adapter, { maps: base, ...content }, { maps: editedMaps, ...edited });
const source = studioContentFile("studio_selftest", calls, fieldOrders(adapter));
const file = "mods/studio_selftest/studio_content.lua";
const run = await runMod(new Map([[file, source]]), "studio_selftest", file, null);
check("generated Lua runs", run.errors.length === 0, run.errors.join("; "));
check("no game paths written", !source.includes("assets/generated"));
check("sparse held item written as [2]", source.includes('[2] = "BERRY"'));
check("encounters patched per map, not whole", /encounters:patch\("grass", \{\s+ROUTE_29 = /.test(source) && source.includes("ROUTE_30 = mod.DELETE") && !source.includes("ROUTE_31 ="));
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

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);

export {};
