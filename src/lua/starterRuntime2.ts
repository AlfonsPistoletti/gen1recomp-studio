// Starter and gift Pokémon on Gen 2 (studio_starters.lua: the ball's species ->
// { species, level }, all in ELMS_LAB; studio_gifts.lua: "<MAP>:<SPECIES>" ->
// { species, level }), like the Gen 1 helpers. Gold's scripts name a species by
// NUMBER in pokepic, cry, getmonname and givepoke (gen1recomp
// src/script/gen2/Vm.lua; the World gives a mon by its record's `index`), so
// the public script.command hook swaps those numbers (and givepoke's level)
// while a script runs on that map. The numbers come from the merged data,
// taken on game.ready. A species without an `index` can't be given by a script
// (the editor offers only species with one). A gift may also carry nickname /
// otName ("" = none: the player names it / is its trainer), which set givepoke's
// trainer arm, and otId, set on the mon that just joined the party (the World
// gives a named gift RANDY's 1001; a full party gets nothing).
// Plain Lua, no requires, no backticks.

export const STARTER_RUNTIME2 = String.raw`
  -- studio gifts (Gen 2): a map's scripts give other Pokemon
  -- byMap[MAP][species the game gives] = { species, level }
  local function studioMonSwaps(byMap)
    if type(byMap) ~= "table" or next(byMap) == nil then return end
    local data, game
    mod.events:on("game.ready", function(ev)
      game = ev and ev.game
      data = game and game.data
    end)
    local OPS = { pokepic = true, cry = true, getmonname = true, givepoke = true }
    -- ctx.mapId is the map label only when the World hands the VM one; it
    -- otherwise falls back to "<group>:<number>", so the map's own numbers
    -- (data.gen2Maps, the table the World loads) are checked as well
    local function swapsFor(ctx)
      if not ctx then return nil end
      if byMap[ctx.mapId] then return byMap[ctx.mapId] end
      for id, swaps in pairs(byMap) do
        local m = data.gen2Maps and data.gen2Maps[id]
        if m and ctx.mapGroup == m.group and ctx.mapNumber == m.map then return swaps end
      end
      return nil
    end
    mod.hooks:wrap("script.command", function(vanilla, ctx, name, args, cmd)
      local swaps = data and data.pokemon and OPS[name] and type(cmd) == "table" and swapsFor(ctx)
      if not swaps then return vanilla(ctx, name, args, cmd) end
      local n = cmd.species or cmd.object
      local pick
      for from, e in pairs(swaps) do
        local b = data.pokemon[from]
        if b and b.index ~= nil and b.index == n then pick = e end
      end
      local to = pick and data.pokemon[pick.species]
      if not (to and type(to.index) == "number") then return vanilla(ctx, name, args, cmd) end
      -- copies: the game's own rows stay untouched
      local row = {}
      for k, v in pairs(cmd) do row[k] = v end
      if row.species ~= nil then row.species = to.index end
      if row.object ~= nil then row.object = to.index end
      if name == "cry" and row.id ~= nil then row.id = to.index end
      if name == "givepoke" and pick.level then row.level = pick.level end
      local a = args
      if type(args) == "table" and args[1] == n then
        a = {}
        for i, v in pairs(args) do a[i] = v end
        a[1] = to.index
        row.args = a
      end
      if name ~= "givepoke" then return vanilla(ctx, name, a, row) end
      if pick.nickname ~= nil or pick.otName ~= nil then
        local nick, ot = pick.nickname, pick.otName
        if nick == nil then nick = cmd.trainer ~= 0 and cmd.name or nil end
        if ot == nil then ot = cmd.trainer ~= 0 and cmd.otName or nil end
        if nick == "" then nick = nil end
        if ot == "" then ot = nil end
        row.name, row.otName = nick, ot
        row.trainer = (nick or ot) and 1 or 0
      end
      local save = game and game.save
      local before = save and save.party and #save.party or 0
      local jump = vanilla(ctx, name, a, row)
      local party = save and save.party
      if pick.otId and row.otName and party and #party > before then party[#party].otId = pick.otId end
      return jump
    end)
  end
`;

export function starterRegistration2(modId: string, file: string): string {
  const module = `mods.${modId}.${file.replace(/\.lua$/, "")}`;
  return `  studioMonSwaps({ ELMS_LAB = require(${JSON.stringify(module)}) })`;
}

// "<MAP>:<SPECIES>" records -> the per-map table
export function giftRegistration2(modId: string, file: string): string {
  const module = `mods.${modId}.${file.replace(/\.lua$/, "")}`;
  return String.raw`  do
    local byMap = {}
    for key, e in pairs(require(${JSON.stringify(module)})) do
      local map, species = string.match(key, "^(.-):(.+)$")
      if map then
        byMap[map] = byMap[map] or {}
        byMap[map][species] = e
      end
    end
    studioMonSwaps(byMap)
  end`;
}
