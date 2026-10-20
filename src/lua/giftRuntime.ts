// Gift Pokémon (studio_gifts.lua: "<MAP>:<SPECIES>" -> { species, level,
// nickname?, otName?, otId? }).
// Every gift runs a give_pokemon row (gen1recomp Commands.give_pokemon),
// built by the game's own script; the public script.command hook swaps its
// species and level on that map, so the scripts stay as they are. The
// received line names whatever was given; lines before it are text records.
// A nickname goes in through the public pokemon.before_give event (the game then
// doesn't ask for one); the original trainer and ID are set on the mon just
// added (the party's last, or the box give_pokemon put it in, ctx.boxNum).
export const GIFT_RUNTIME = String.raw`
  -- studio gifts: other Pokémon (or levels) for the game's gifts
  local function studioGifts(gifts)
    if type(gifts) ~= "table" or next(gifts) == nil then return end
    local giving
    mod.events:on("pokemon.before_give", function(gift)
      if giving and giving.nickname and giving.nickname ~= "" then gift.nickname = giving.nickname end
    end)
    mod.hooks:wrap("script.command", function(vanilla, ctx, name, args)
      local map = ctx and ctx.overworld and ctx.overworld.map
      local g = name == "give_pokemon" and map and type(args) == "table" and gifts[map.id .. ":" .. tostring(args[1])]
      if not g then return vanilla(ctx, name, args) end
      local a = {}
      for i, v in pairs(args) do a[i] = v end
      a[1] = g.species or a[1]
      a[2] = g.level or a[2]
      giving = g
      local ok, res = pcall(vanilla, ctx, name, a)
      giving = nil
      if not ok then error(res, 0) end
      local save = ctx.save
      if g.otName and g.otName ~= "" and save and ctx.lastCheck then
        local list = ctx.addedToParty and save.party or (ctx.boxNum and save.boxes and save.boxes[ctx.boxNum])
        local mon = list and list[#list]
        if mon then
          mon.ot = g.otName
          if g.otId then mon.otId = g.otId end
        end
      end
      return res
    end)
  end
`;

export function giftRegistration(modId: string, file: string): string {
  const module = `mods.${modId}.${file.replace(/\.lua$/, "")}`;
  return `  studioGifts(require(${JSON.stringify(module)}))`;
}
