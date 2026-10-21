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
  const ext = { first, tiles: [], blocks: [[1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]], collision: [[0, 0, 7, 7]], anim: [{ func: "AnimateWhirlpoolTile", tile: first, sheet: "mods/studio_selftest/assets/studio/x_anim.png", frames: 4 }] };
  // an own animation row joins the game's program (later rows win) and counts as the mod's
  const ownAnims = adapter.tileAnimations!({ data: project.data, maps: base, records: { studio_tilesets: { TILESET_JOHTO: ext } } }, ts, "TILESET_JOHTO");
  const mine = ownAnims.find((x) => x.tile === first);
  check("own tile animation joins the tileset's", !!mine?.own && mine.sequence.join() === "1,2,3,4,1,2,3,4" && ownAnims.some((x) => !x.own), JSON.stringify(mine));
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
  // a trainer's after-battle talk: endifjustbattled first, the text box after it (the game's order)
  const afterBlocks = [{ t: "cmd", row: ["#raw", { op: "endifjustbattled" }] }, { t: "cmd", row: ["faceplayer"] }, { t: "cmd", row: ["writetext", "T_AFTER"] }] as never;
  const afterRows = gcompile(afterBlocks, ctx) as unknown as Record<string, unknown>[];
  check("after-battle talk keeps the game's order", afterRows.slice(0, 3).map((r) => r.op).join() === "endifjustbattled,faceplayer,opentext" && deepEqual(gparse(afterRows as never, ctx), afterBlocks), JSON.stringify(afterRows.slice(0, 4)));
  const newer = [
    { t: "if", cond: ["checktime", 4], not: false, then: [{ t: "cmd", row: ["applymovement", 3, ["up", "left"], 0x0c] }], else: [{ t: "cmd", row: ["givecoins", 50] }] },
    { t: "if", cond: ["checkcoins", 100], not: false, then: [{ t: "cmd", row: ["takecoins", 100] }], else: null },
    { t: "cmd", row: ["follow", 2, 0] },
    { t: "cmd", row: ["stopfollow"] },
  ] as never;
  const newerRows = gcompile(newer, ctx) as unknown as Record<string, unknown>[];
  check("time, coins, walk and follow blocks round-trip", deepEqual(gparse(newerRows as never, ctx), newer), JSON.stringify(gparse(newerRows as never, ctx)).slice(0, 400));
  // the game's own events: New Bark's teacher (three flag checks) reads in
  // with its branches as nested lists, and as If blocks
  const { GEN2_EVENTS } = await import("../src/games/gen2/events.ts");
  const teacher = GEN2_EVENTS.gameRows!(ctx, "48:406f") as unknown as Record<string, unknown>[] | null;
  check("a game script reads in with its branches", !!teacher && teacher.some((r) => r.op === "iftrue" && Array.isArray(r.script)), JSON.stringify(teacher).slice(0, 200));
  const tb = gparse((teacher ?? []) as never, ctx) as { t: string }[];
  check("a game script shows as If blocks", tb.filter((b) => b.t === "if").length >= 1 && !JSON.stringify(tb).includes('"#raw",{"op":"iftrue"'), JSON.stringify(tb).slice(0, 300));
  // animated tiles: the tilesets' anim programs give animations, and their strips exist
  {
    const all = Object.entries(project.data.tilesets).flatMap(([id, t]) => adapter.tileAnimations!(ctx, t, id));
    const paths = [...new Set(all.map((x) => x.strip).filter((x): x is string => !!x))];
    const missing: string[] = [];
    for (const p of paths) {
      const dir = p.replace(/^assets\/generated\//, "assets/generated/").replace(/\/[^/]+$/, "");
      const names = (await nodeHost.list(`cache:${version}`, dir).catch(() => [])).map((e) => `${dir}/${e.name}`);
      if (!names.includes(p)) missing.push(p);
    }
    check("tileset animations and their strips", all.length > 20 && all.some((x) => x.scroll) && !missing.length, `${all.length} animated tiles, ${paths.length} strips; missing ${missing.join(", ")}`);
  }
  // the newer commands: arguments -> row -> arguments again; a game movement reads as a path
  {
    const mapId = Object.keys(base).find((id) => typeof (base[id] as { group?: number }).group === "number" && (base[id] as { group?: number }).group! > 0)!;
    const cases: [string, Record<string, unknown>][] = [
      ["check_time", { time: 4 }], ["check_coins", { amount: 300 }], ["give_coins", { amount: 500 }], ["take_coins", { amount: 50 }],
      ["give_item_quiet", { item: "POTION", quantity: 2 }], ["give_egg", { species: "TOGEPI", level: 5 }], ["random", { count: 3 }],
      ["earthquake", { strength: 80 }], ["fade_music", { song: (project.data.extra as { musicOrder: string[] }).musicOrder[3] }],
      ["follow", { leader: 2, follower: 0 }], ["warp", { map: mapId, x: 4, y: 7 }], ["walk", { who: 3, path: ["up", "up", "left"], speed: 0x08 }],
    ];
    const bad: string[] = [];
    for (const [id, args] of cases) {
      const c = GEN2_EVENTS.commands.find((x) => x.id === id);
      const row = c?.pack ? { op: c.verb, ...c.pack(args, ctx) } : null;
      const back = row && c?.unpack ? c.unpack(row, ctx) : null;
      if (!back || !deepEqual(back, args)) bad.push(`${id}: ${JSON.stringify(back)}`);
    }
    check("new event commands round-trip", !bad.length, bad.join("; "));
    const walk = GEN2_EVENTS.commands.find((x) => x.id === "walk")!;
    check("a game movement reads as a path", deepEqual(walk.unpack!({ op: "applymovement", object: 10, movement: "4a:4868" }, ctx), { who: 10, path: ["left"], speed: 0x0c }));
  }
  // screens: the picture's three rows and a screen special read back; every listed special exists
  {
    const cmd = (id: string) => GEN2_EVENTS.commands.find((c) => c.id === id)!;
    const pic = cmd("show_pic").rows!({ species: "ARTICUNO" }, ctx);
    const scr = cmd("open_screen").rows!({ screen: "OverworldTownMap" }, ctx);
    const order = (project.data.extra as { specialOrder?: string[] }).specialOrder ?? [];
    check("screen commands round-trip", cmd("show_pic").match!(pic, 0, ctx)?.args.species === "ARTICUNO" && cmd("open_screen").match!(scr, 0, ctx)?.args.screen === "OverworldTownMap"
      && (GEN2_EVENTS.screens ?? []).every((x) => order.includes(x.id)), JSON.stringify([pic, scr]));
  }
  // what a Role writes is no event (people's text, nurse, shop, bookshelf)
  const { presetOf } = await import("../src/games/gen2/events.ts");
  check("Role scripts are presets, events are not",
    presetOf([{ op: "jumptextfaceplayer", text: "X" }]) && presetOf([{ op: "jumpstd", std: "PokecenterNurseScript", script: "40:408a" }])
    && presetOf([{ op: "faceplayer" }, { op: "opentext" }, { op: "pokemart", args: [0, 3, 0] }, { op: "closetext" }, { op: "end" }])
    && !presetOf(rows as never));
  // the game's own scripts read the same way: New Bark's fisher only says a text
  {
    const scripts = (project.data.extra as { scripts: Record<string, unknown> }).scripts;
    const fisher = (base.NEW_BARK_TOWN.objects as { sprite?: string; scriptKey?: unknown }[]).find((o) => o.sprite === "SPRITE_FISHER");
    const people = Object.values(base).flatMap((m) => (m.objects ?? []) as { scriptKey?: unknown }[]).filter((o) => typeof o.scriptKey === "string");
    const simple = people.filter((o) => Array.isArray(scripts[o.scriptKey as string]) && presetOf(scripts[o.scriptKey as string] as never)).length;
    check("the game's text people read as roles (fisher)", presetOf(scripts[fisher?.scriptKey as string] as never) && simple > 400, `${simple} of ${people.length} people`);
  }
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
  // the engine builds the #DEX entry from the species' dexEntry (070ca01+): no helper
  const src = studioContentFile("studio_selftest", calls, fieldOrders(adapter));
  check("a new species carries its Pokédex entry", src.includes("dexEntry"));
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
  const kenya = gifts.find((g) => g.species === "SPEAROW");
  check("gift nickname and trainer read (KENYA, RANDY)", kenya?.named?.nickname === "KENYA" && kenya.named.otName === "RANDY", JSON.stringify(kenya?.named));
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

// a fishing day/night pair: a patch of pair 1 alone would read as a Lua list
// (and replace every pair), so it carries an unchanged pair along
{
  const tfg = (content.encounters as Record<string, Record<string, Rec>>).timeFishGroups;
  const one = clone(tfg) as Record<string, Rec>;
  one["1"] = { ...one["1"], day: { species: "MAGIKARP", level: 40 } };
  const d1 = diffRecord(tfg, one) as Record<string, unknown>;
  const eight = clone(tfg) as Record<string, Rec>;
  eight["8"] = { ...eight["8"], nite: { species: "DRAGONAIR", level: 20 } };
  const d8 = diffRecord(tfg, eight) as Record<string, unknown>;
  check("a pair-1 patch keeps a second key (not a list)", Object.keys(d1).length === 2 && "1" in d1, JSON.stringify(Object.keys(d1)));
  check("a pair-8 patch stays one entry", Object.keys(d8).join() === "8", JSON.stringify(Object.keys(d8)));
}

// studio scripts: inline in the editor, registered map_scripts keys on disk,
// and back inline on load (the same maps); movements by their key
{
  const sk = await import("../src/games/gen2/scriptKeys.ts");
  const { GEN2_EVENTS } = await import("../src/games/gen2/events.ts");
  const ctx = { data: project.data, maps: base, records: {} };
  const id = "NEW_BARK_TOWN";
  const m = clone(base[id]) as Rec;
  const talk = [{ op: "faceplayer" }, { op: "opentext" }, { op: "applymovement", object: 0, movement: "studio:13.12.71" }, { op: "closetext" }, { op: "end" }];
  const objs = m.objects as Rec[];
  objs[0] = { ...objs[0], scriptKey: talk };
  objs[1] = { ...objs[1], trainer: { class: 1, member: 1, event: 2000, scriptKey: [{ op: "jumptext", text: "X" }] } };
  m.sceneScripts = { "1": { sceneId: 1, scriptKey: [{ op: "end" }] } };
  m.callbacks = [{ callback: "MAPCALLBACK_TILES", type: 1, scriptKey: [{ op: "checkscene" }, { op: "endcallback" }] }];
  const edited = { [id]: m } as unknown as Record<string, import("../src/core/types.ts").MapDef>;
  const out = sk.outlineScripts(edited);
  const regs = Object.fromEntries(out.registrations.map((r) => [r.id, r.value]));
  const om = out.maps[id] as unknown as Rec;
  check("scripts become keys", (om.objects as Rec[])[0].scriptKey === `STUDIO_${id}_OBJ${objs[0].index}` && ((om.objects as Rec[])[1].trainer as Rec).scriptKey === `STUDIO_${id}_OBJ${objs[1].index}_AFTER`
    && (om.sceneScripts as Record<string, Rec>)["1"].scriptKey === `STUDIO_${id}_SCENE1` && (om.callbacks as Rec[])[0].scriptKey === `STUDIO_${id}_CB_TILES`, JSON.stringify(Object.keys(regs)));
  check("a studio movement is registered by its key", deepEqual(regs["movement:studio:13.12.71"], [13, 12, 71]));
  check("the editor's maps stay inline", Array.isArray(objs[0].scriptKey));
  const { calls } = contentCalls(adapter, { maps: base, ...content }, { maps: out.maps as unknown as Rec });
  for (const r of out.registrations) calls.push({ registry: "map_scripts", op: "register", id: r.id, value: r.value });
  const src = studioContentFile("studio_selftest", calls, fieldOrders(adapter));
  const f = "mods/studio_selftest/studio_content.lua";
  const ran = await runMod(new Map([[f, src]]), "studio_selftest", f, null);
  check("script registrations run", ran.errors.length === 0 && src.includes(`map_scripts:register("STUDIO_${id}_OBJ`), ran.errors.join("; "));
  const own: Record<string, unknown> = {};
  for (const op of ran.ops) if (op.registry === "map_scripts" && sk.ownsScript(op.id)) own[op.id] = op.value;
  const back = clone(out.maps) as Record<string, import("../src/core/types.ts").MapDef>;
  sk.inlineScripts(back, own);
  check("scripts read back inline", deepEqual(back[id], m), JSON.stringify((back[id] as Rec).objects).slice(0, 200));
  check("keys are stable across saves", deepEqual(sk.outlineScripts(back).registrations.map((r) => r.id), out.registrations.map((r) => r.id)));
  const walk = GEN2_EVENTS.commands.find((x) => x.id === "walk")!;
  check("an older walk row (steps) still reads", deepEqual(walk.unpack!({ op: "applymovement", object: 2, movement: "studio:13.71", steps: [13, 71] }, ctx), { who: 2, path: ["up"], speed: 0x0c }));
}

// the phone book: Joey is contact 15 on Route 30, Route 30's NPC 2 gives his
// number, and moving him saves as a patch of the map only
{
  const ctx = { data: project.data, maps: base, records: {} };
  const book = content.phone_contacts as Record<string, Rec>;
  const joey = book.PHONE_YOUNGSTER_JOEY;
  const givers = adapter.globals!.phone!.givers(ctx);
  check("phone contacts load (Joey = 15 on ROUTE_30)", joey?.index === 15 && joey.map === "ROUTE_30" && !("PHONE_UNUSED" in book), JSON.stringify(joey));
  // what fills {STRBUF} in Joey's call: his name in the greeting, his own mon in the chat
  const bufs = adapter.globals!.phone!.buffers(ctx, [String(joey?.callerKey)]);
  check("phone {STRBUF}: caller's name / own Pokémon", [...(bufs.get("41:5989") ?? [])].join() === "a trainer's name" && [...(bufs.get("41:5b0d") ?? [])].join() === "one of the caller's own Pokémon" && [...(bufs.get("41:5cdb") ?? [])].join() === "“ROUTE 30”", JSON.stringify([...bufs].map(([k, v]) => [k, [...v]])));
  check("Joey's number is given on Route 30", (givers.get(15) ?? []).some((g) => g.map === "ROUTE_30"), JSON.stringify(givers.get(15)));
  const { calls } = contentCalls(adapter, { maps: base, ...content }, { maps: base as unknown as Rec, phone_contacts: { PHONE_YOUNGSTER_JOEY: { ...joey, map: "ROUTE_31" } } });
  const src = studioContentFile("studio_selftest", calls, fieldOrders(adapter));
  check("a moved contact is a map patch", src.includes('phone_contacts:patch("PHONE_YOUNGSTER_JOEY"') && src.includes('map = "ROUTE_31"') && !src.includes("calleeKey"), src.split("\n").filter((l) => l.includes("phone") || l.includes("ROUTE_31")).join(" | "));
}

// fruit trees: the restated list matches the trees on the maps, and the helper loads
{
  const { fruitTreeRegistration2 } = await import("../src/lua/fieldRuntime2.ts");
  const { dataFile, studioContentFile: contentFile } = await import("../src/lua/writer.ts");
  const trees = (content.studio_fruit_trees as Record<string, unknown>).trees as string[];
  const scripts = (project.data.extra as { scripts: Record<string, unknown> }).scripts;
  const used = new Set<number>();
  for (const m of Object.values(base)) for (const o of (m.objects ?? []) as { scriptKey?: unknown }[]) {
    const rows = typeof o.scriptKey === "string" ? scripts[o.scriptKey] : null;
    const r = Array.isArray(rows) ? (rows as { op?: string; args?: number[] }[]).find((x) => x?.op === "fruittree") : undefined;
    if (typeof r?.args?.[0] === "number") used.add(r.args[0]);
  }
  check("fruit trees: 30 restated, every map tree number has one", trees.length === 30 && [...used].every((n) => n >= 1 && n <= 30) && used.size >= 25, `${used.size} numbers on maps`);
  check("fruit tree items exist", trees.every((i) => content.items[i] !== undefined), trees.filter((i) => content.items[i] === undefined).join(", "));
  check("apricorn balls restated", Object.keys(content.apricorns ?? {}).length === 7 && Object.values(content.apricorns as Record<string, { ball: string }>).every((r) => content.items[r.ball] !== undefined));
  const f = "mods/studio_selftest/studio_content.lua";
  const data = dataFile("studio_selftest", "fruit trees", { trees: [...trees.slice(0, 29), "GOLD_BERRY"] }, []);
  const ran = await runMod(new Map([[f, contentFile("studio_selftest", [], {}, fruitTreeRegistration2("studio_selftest", "studio_fruit_trees.lua"))], ["mods/studio_selftest/studio_fruit_trees.lua", data]]), "studio_selftest", f, null);
  check("fruit tree helper loads in the studio VM", ran.errors.length === 0, ran.errors.join("; "));
}

// scenes: Elm's lab's scenes, per-scene block layouts in an own TILES callback
// that gives the game's key back once empty
{
  const sc = await import("../src/games/gen2/scenes.ts");
  const scripts = (project.data.extra as { scripts?: Record<string, unknown> }).scripts ?? {};
  const lab = clone(base.ELMS_LAB);
  const scenes = sc.scenesOf(lab, scripts);
  check("Elm's lab scenes", [0, 1, 2, 3].every((n) => scenes.includes(n)), scenes.join(","));
  const tilesMap = Object.keys(base).find((id) => ((base[id] as unknown as { callbacks?: { callback?: string }[] }).callbacks ?? []).some((c) => c.callback === "MAPCALLBACK_TILES"))!;
  for (const id of [tilesMap, "ELMS_LAB"]) {
    const m = clone(base[id]);
    const before = JSON.stringify((m as unknown as { callbacks?: unknown }).callbacks);
    const other = m.blocks[1] === 7 ? 8 : 7;
    sc.setSceneBlock(m, 2, 1, 0, other);
    sc.setSceneBlock(m, 3, 0, 0, other);
    check(`${id}: scene 2 shows its block`, sc.blocksInScene(m, 2)[1] === other && sc.blocksInScene(m, 0)[1] === m.blocks[1]);
    sc.setSceneBlock(m, 2, 1, 0, m.blocks[1]);
    sc.clearSceneBlocks(m, 3);
    check(`${id}: back to the game's callbacks`, JSON.stringify((m as unknown as { callbacks?: unknown }).callbacks) === before, `${before} / ${JSON.stringify((m as unknown as { callbacks?: unknown }).callbacks)}`.slice(0, 300));
  }
}

// scene event commands: Set scene, Set another map's scene, If this map's scene is
{
  const { compile: gcompile, parse: gparse } = await import("../src/games/gen2/events.ts");
  const ctx = { data: project.data, maps: base, records: {} };
  const blocks = [
    { t: "cmd", row: ["setscene", 2] },
    { t: "cmd", row: ["setmapscene", "ELMS_LAB", 1] },
    { t: "if", cond: ["checkscene", 3], not: false, then: [{ t: "cmd", row: ["writetext", "T_A"] }], else: [{ t: "cmd", row: ["writetext", "T_B"] }] },
  ];
  const rows = gcompile(blocks as never, ctx) as unknown as Record<string, unknown>[];
  const flat = JSON.stringify(rows);
  check("scene commands compile", flat.includes('"op":"setscene","scene":2') && flat.includes('"op":"setmapscene","group":24,"map":5,"scene":1') && flat.includes('"op":"checkscene"') && flat.includes('"op":"ifequal","value":3'), flat.slice(0, 300));
  const back = JSON.stringify(gparse(rows as never, ctx));
  check("scene commands parse back", back === JSON.stringify(blocks), back.slice(0, 400));
}

// people the game hides at the start: Olivine's rival (flag 1731, set in a new
// game) is drawn faded, and the inspector says what shows and hides him
{
  const ctx = { data: project.data, maps: base, records: {} };
  const layer = adapter.layers.find((l) => l.key === "objects")!;
  const map = base.OLIVINE_CITY;
  const objs = map.objects as unknown as { index: number; eventFlag?: number }[];
  const at = objs.findIndex((o) => o.eventFlag === 1731);
  const ref = layer.sprite!(objs[at] as never, "OLIVINE_CITY");
  check("Olivine's rival is faded (hidden at the start)", at >= 0 && ref?.ghost === true && layer.sprite!(objs[0] as never, "OLIVINE_CITY")?.ghost === false);
  const info = layer.fields.find((f) => f.kind === "info") as { text(m: unknown, i: number, c: unknown): string | null } | undefined;
  const note = info?.text(map, at, ctx) ?? "";
  check("the rival's note names the start flag and the scene 0 triggers", note.includes("flag 1731 is set in a new game") && note.includes("Shown by: step trigger 13, 12 (scene 0)") && note.includes("Hidden by:"), note);
  check("a plain person has no note", info?.text(map, 0, ctx) === null);
}

// new moves and items: a copied move borrows its source's animation, a copied
// item takes a free number (251-254) and its source's effect as its own
{
  const ctx = { data: project.data, maps: base, records: content as Record<string, Record<string, unknown>> };
  const move: Rec = { ...(clone(content.moves.TACKLE) as Rec), id: "STUDIO_BASH", name: "BASH" };
  delete move.index;
  delete move.source;
  const mx = adapter.moves!.moveExtras!("TACKLE", "STUDIO_BASH", ctx);
  check("new move borrows the animation", mx.length === 1 && (mx[0].value as Rec).STUDIO_BASH === (content.battle_anims.moves as Rec).TACKLE, JSON.stringify(mx.map((x) => x.id)));
  const items = adapter.items!;
  const index = items.newIndex!(ctx);
  check("new item gets number 251", index === 251, String(index));
  const item: Rec = { ...(clone(content.items.POTION) as Rec), id: "STUDIO_TONIC", name: "TONIC", index };
  delete item.source;
  const edits: Record<string, Rec> = { moves: { STUDIO_BASH: move }, items: { STUDIO_TONIC: item }, battle_anims: { moves: mx[0].value as Rec } };
  const { calls } = contentCalls(adapter, { maps: base, ...content }, { maps: base as unknown as Rec, ...edits });
  const src = studioContentFile("studio_selftest", calls, fieldOrders(adapter));
  check("new move and item registered, animation patched", src.includes('moves:register("STUDIO_BASH"') && src.includes('items:register("STUDIO_TONIC"') && /battle_anims:patch\("moves", \{\s+STUDIO_BASH = "/.test(src) && !src.includes("assets/generated"), src.split("\n").filter((l) => /register|battle_anims/.test(l)).join(" | "));
  const f = "mods/studio_selftest/studio_content.lua";
  const ran = await runMod(new Map([[f, src]]), "studio_selftest", f, null);
  check("new move and item file runs", ran.errors.length === 0, ran.errors.join("; "));
}

// map colors: the bg palettes are a record; an edited color reaches the map
// view's tile colors, and the save writes the list
{
  const bg = clone(content.palettes.bg) as unknown as number[][][];
  check("bg palettes load", Array.isArray(bg) && bg.length > 8 && bg[0].length === 4, String(bg?.length));
  const bp = adapter.bgPalettes!;
  const ids = bp.envs({ data: project.data, maps: base, records: {} }).TOWN.DAY;
  bg[ids[0] - 1][0] = [255, 0, 0];
  const records = { ...content, palettes: { ...content.palettes, bg } } as Record<string, Record<string, unknown>>;
  const ts = project.data.tilesets.TILESET_JOHTO;
  const tile = ((ts.tilePalettes as number[] | undefined) ?? []).findIndex((x) => x === 1);
  const colors = adapter.tileColors({ data: project.data, maps: base, records, time: "DAY" }, ts, "TOWN|1|DAY")(tile);
  check("an edited bg color reaches the map colors", JSON.stringify(colors.at(-1)) === "[255,0,0]", JSON.stringify(colors));
  // TOWN's own copy of a shared palette: TOWN changes, CAVE keeps the game's
  const envs = clone(content.palettes.environments) as unknown as Record<string, Record<string, number[]>>;
  const own = [...(clone(content.palettes.bg) as unknown as number[][][]), [[0, 0, 255], [0, 0, 255], [0, 0, 255], [0, 0, 255]]];
  envs.TOWN.DAY = envs.TOWN.DAY.map((x, j) => (j === 0 ? own.length : x));
  const r2 = { ...content, palettes: { ...content.palettes, bg: own, environments: envs } } as unknown as Record<string, Record<string, unknown>>;
  const town = adapter.tileColors({ data: project.data, maps: base, records: r2, time: "DAY" }, ts, "TOWN|1|DAY")(tile);
  const cave = adapter.tileColors({ data: project.data, maps: base, records: r2, time: "DAY" }, ts, "CAVE|1|DAY")(tile);
  check("an environment's own palette copy changes only it", JSON.stringify(town[0]) === "[0,0,255]" && JSON.stringify(cave[0]) !== "[0,0,255]", JSON.stringify([town[0], cave[0]]));
  const { calls } = contentCalls(adapter, { maps: base, ...content }, { maps: base as unknown as Rec, palettes: { bg: bg as unknown as Rec } });
  const src = studioContentFile("studio_selftest", calls, fieldOrders(adapter));
  check("bg palettes saved", /palettes:(patch|override)\("bg"/.test(src), src.split("\n").filter((l) => l.includes("palettes:")).join(" | "));
  const f = "mods/studio_selftest/studio_content.lua";
  const ran = await runMod(new Map([[f, src]]), "studio_selftest", f, null);
  check("bg palettes file runs", ran.errors.length === 0, ran.errors.join("; "));
}

// Town Map: places are landmarks (Johto / Kanto), the regions' grids are 20x18,
// a moved place saves as a patch and the grid helper loads
{
  const { townMapRegistration2 } = await import("../src/lua/fieldRuntime2.ts");
  const { dataFile } = await import("../src/lua/writer.ts");
  const ctx = { data: project.data, maps: base, records: content as Record<string, Record<string, unknown>> };
  const tm = adapter.townMap2!;
  check("Town Map regions", tm.regionOf(ctx, "LANDMARK_NEW_BARK_TOWN") === "johto" && tm.regionOf(ctx, "LANDMARK_PALLET_TOWN") === "kanto" && tm.regionOf(ctx, "LANDMARK_FAST_SHIP") === "johto");
  const grids = content.studio_townmap as Record<string, number[]>;
  check("Town Map grids are 20x18", grids.johto?.length === 360 && grids.kanto?.length === 360, `${grids.johto?.length} ${grids.kanto?.length}`);
  const colors = tm.colors(ctx);
  check("Town Map colors: a palette per tile", !!colors && colors.palMap.length >= 0x60 && colors.palettes.every((p) => p.length === 4), `${colors?.palMap.length} ${colors?.palettes.length}`);
  const nb = { ...(clone(content.landmarks.LANDMARK_NEW_BARK_TOWN) as Rec), x: 120 };
  const { calls } = contentCalls(adapter, { maps: base, ...content }, { maps: base as unknown as Rec, landmarks: { LANDMARK_NEW_BARK_TOWN: nb } });
  const src = studioContentFile("studio_selftest", calls, fieldOrders(adapter));
  check("a moved place is a patch", src.includes('landmarks:patch("LANDMARK_NEW_BARK_TOWN", { x = 120 })'), src.split("\n").filter((l) => l.includes("landmarks")).join(" | "));
  const code = townMapRegistration2("studio_selftest", "studio_townmap.lua");
  const g = { johto: grids.johto.map((t, i) => (i === 0 ? 1 : t)) };
  const f = "mods/studio_selftest/studio_content.lua";
  const ran = await runMod(new Map([[f, studioContentFile("studio_selftest", calls, fieldOrders(adapter), code)], ["mods/studio_selftest/studio_townmap.lua", dataFile("studio_selftest", "Town Map tiles", g, [])]]), "studio_selftest", f, null);
  check("Town Map file runs", ran.errors.length === 0 && !code.includes("`"), ran.errors.join("; "));
}

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);

export {};
