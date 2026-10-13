// Starter Pokémon (studio_starters.lua: the game's ball species -> { species,
// level }). The Oak's Lab ball scripts (gen1recomp data/scripts/oaks_lab.lua
// starterBall) name their species literally in the Pokédex entry, the
// received lines (the player's and the rival's) and give_pokemon; the
// public script.command hook maps those rows while they run in OAKS_LAB, so
// the game's script stays as it is (no engine_internals). The rival's teams
// follow the EVENT_CHOSE_* flags, not species: they are edited in Trainers.
export const STARTER_RUNTIME = String.raw`
  -- studio starters: the Oak's Lab balls give other Pokémon
  local function studioStarters(starters)
    if type(starters) ~= "table" or next(starters) == nil then return end
    local function swap(s)
      local e = starters[s]
      return e and e.species or s
    end
    mod.hooks:wrap("script.command", function(vanilla, ctx, name, args)
      local map = ctx and ctx.overworld and ctx.overworld.map
      if not (map and map.id == "OAKS_LAB") or type(args) ~= "table" then return vanilla(ctx, name, args) end
      -- copies: the script's own rows stay untouched
      local a = {}
      for i, v in pairs(args) do a[i] = v end
      if name == "give_pokemon" and starters[a[1]] then
        local e = starters[a[1]]
        a[1] = e.species or a[1]
        a[2] = e.level or a[2]
      elseif (name == "push_screen" or name == "show_text") and type(a[2]) == "table" then
        local o = {}
        for k, v in pairs(a[2]) do o[k] = v end
        if type(o.species) == "string" then o.species = swap(o.species) end
        if type(o.RAM) == "string" then o.RAM = swap(o.RAM) end
        a[2] = o
      end
      return vanilla(ctx, name, a)
    end)
  end
`;

export function starterRegistration(modId: string, file: string): string {
  const module = `mods.${modId}.${file.replace(/\.lua$/, "")}`;
  return `  studioStarters(require(${JSON.stringify(module)}))`;
}

// the three balls of Oak's Lab (Red/Blue), the question each asks, and the
// rival's Oak's Lab team (OPP_RIVAL1 party) in which he has this ball's
// Pokémon: he takes Charmander's when the player takes Bulbasaur's (team 3)
export const STARTER_BALLS = [
  { ball: "CHARMANDER", ask: "_OaksLabYouWantCharmanderText", rivalTeam: 3 },
  { ball: "SQUIRTLE", ask: "_OaksLabYouWantSquirtleText", rivalTeam: 1 },
  { ball: "BULBASAUR", ask: "_OaksLabYouWantBulbasaurText", rivalTeam: 2 },
] as const;
