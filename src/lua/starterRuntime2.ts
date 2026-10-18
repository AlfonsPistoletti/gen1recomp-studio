// Starter Pokémon on Gen 2 (studio_starters.lua: the game's ball species ->
// { species, level }), like the Gen 1 helper (starterRuntime.ts). Elm's Lab
// ball scripts name their species by NUMBER in pokepic, cry, getmonname and
// givepoke (gen1recomp src/script/gen2/Vm.lua; the World gives a mon by its
// record's `index`), so the public script.command hook swaps those numbers
// (and givepoke's level) while they run in ELMS_LAB. The numbers come from the
// merged data, taken on game.ready. A species without an `index` can't be
// given by a script (the editor offers only species with one). The rival's
// teams are trainer data (RIVAL1/RIVAL2), edited in Trainers. Plain Lua, no
// requires, no backticks.

export const STARTER_RUNTIME2 = String.raw`
  -- studio starters (Gen 2): Elm's Lab balls give other Pokemon
  local function studioStarters2(starters)
    if type(starters) ~= "table" or next(starters) == nil then return end
    local data
    mod.events:on("game.ready", function(ev) data = ev and ev.game and ev.game.data end)
    local OPS = { pokepic = true, cry = true, getmonname = true, givepoke = true }
    -- ctx.mapId is the map label only when the World hands the VM one; it
    -- otherwise falls back to "<group>:<number>", so the lab's own numbers
    -- (data.gen2Maps, the table the World loads) are checked as well
    local function inLab(ctx)
      if not ctx then return false end
      if ctx.mapId == "ELMS_LAB" then return true end
      local lab = data.gen2Maps and data.gen2Maps.ELMS_LAB
      return lab ~= nil and ctx.mapGroup == lab.group and ctx.mapNumber == lab.map
    end
    mod.hooks:wrap("script.command", function(vanilla, ctx, name, args, cmd)
      if not (data and data.pokemon and OPS[name] and type(cmd) == "table" and inLab(ctx)) then
        return vanilla(ctx, name, args, cmd)
      end
      local n = cmd.species or cmd.object
      local pick
      for ball, e in pairs(starters) do
        local b = data.pokemon[ball]
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
      return vanilla(ctx, name, a, row)
    end)
  end
`;

export function starterRegistration2(modId: string, file: string): string {
  const module = `mods.${modId}.${file.replace(/\.lua$/, "")}`;
  return `  studioStarters2(require(${JSON.stringify(module)}))`;
}
