// Gift Pokémon (studio_gifts.lua: "<MAP>:<SPECIES>" -> { species, level }).
// Every gift runs a give_pokemon row (gen1recomp Commands.give_pokemon),
// built by the game's own script; the public script.command hook swaps its
// species and level on that map, so the scripts stay as they are. The
// received line names whatever was given; lines before it are text records.
export const GIFT_RUNTIME = String.raw`
  -- studio gifts: other Pokémon (or levels) for the game's gifts
  local function studioGifts(gifts)
    if type(gifts) ~= "table" or next(gifts) == nil then return end
    mod.hooks:wrap("script.command", function(vanilla, ctx, name, args)
      local map = ctx and ctx.overworld and ctx.overworld.map
      local g = name == "give_pokemon" and map and type(args) == "table" and gifts[map.id .. ":" .. tostring(args[1])]
      if not g then return vanilla(ctx, name, args) end
      local a = {}
      for i, v in pairs(args) do a[i] = v end
      a[1] = g.species or a[1]
      a[2] = g.level or a[2]
      return vanilla(ctx, name, a)
    end)
  end
`;

export function giftRegistration(modId: string, file: string): string {
  const module = `mods.${modId}.${file.replace(/\.lua$/, "")}`;
  return `  studioGifts(require(${JSON.stringify(module)}))`;
}
