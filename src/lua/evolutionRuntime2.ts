// Happiness evolutions at a threshold of the mod's own (studio_happiness.lua:
// method id -> { happiness = n }). Gold's EVOLVE_HAPPINESS check has 220 built in
// (gen1recomp src/core/gen2/Evolution.lua), and an evolution row takes no extra
// field (Schemas: pokemon.evolutions is a closed record), so an evolution at
// another number names a method of its own, STUDIO_HAPPINESS_<n>, registered
// here with the game's check and that number: an Everstone stops it, and the
// row's `time` (ANYTIME / MORNDAY / NITE) still applies. The link and stone
// gates are the engine's (Evolution.rowMatches), as for every method.
// Plain Lua, no requires, no backticks.

export const EVOLUTION_RUNTIME2 = "";

export function happinessRegistration2(modId: string, file: string): string {
  const module = `mods.${modId}.${file.replace(/\.lua$/, "")}`;
  return String.raw`
  -- studio happiness evolutions (Gen 2): an own threshold per method id
  do
    for id, e in pairs(require(${JSON.stringify(module)})) do
      local need = tonumber(type(e) == "table" and e.happiness) or 220
      mod.content.evolution_methods:register(id, {
        check = function(entry, mon, ctx)
          if ((mon and mon.happiness) or 0) < need then return false, "happiness" end
          if (mon and mon.item) == "EVERSTONE" then return false, "everstone" end
          local t = ctx and ctx.timeOfDay
          local night = t == "NITE" or t == "NITE_F"
          local window = (entry and entry.time) or "ANYTIME"
          if window == "NITE" and not night then return false, "daytime" end
          if window == "MORNDAY" and night then return false, "night" end
          return true
        end,
      })
    end
  end`;
}
