// Pokédex footprints of the mod's own (studio_footprints.lua: species id ->
// { pixels } or { copy }). gen1recomp PokedexMenu:drawFootprint takes a
// species' 16x16 from one strip (gen2MenuGfx.pokedex.footprints), at the place
// of the species in footprintOrder. The asset recipe builds the strip the
// player's game has with the mod's footprints in rows below it, in sorted id
// order (src/ui/footprints.ts footprintSheets); here the order gets those
// species at those rows, and a game species drawn anew loses its old place.
// Registration only (no requires, no backticks).

export const FOOTPRINT_RUNTIME2 = "";

export const footprintStrip = (modId: string) => `save/mod-derived/${modId}/studio/pokedex/footprints.png`;

export function footprintRegistration2(modId: string, file: string): string {
  const module = `mods.${modId}.${file.replace(/\.lua$/, "")}`;
  return String.raw`
  -- studio Pokédex footprints (Gen 2): the built strip and each species' row in it
  do
    local prints = require(${JSON.stringify(module)})
    mod.events:on("game.ready", function(ev)
      local gfx = ev and ev.game and ev.game.data and ev.game.data.gen2MenuGfx
      local dex = gfx and gfx.pokedex
      if type(dex) ~= "table" or type(dex.footprintOrder) ~= "table" or dex.studioFootprints then return end
      dex.studioFootprints = true
      local ids = {}
      for id in pairs(prints) do ids[#ids + 1] = id end
      table.sort(ids)
      local order = dex.footprintOrder
      local rows = #order
      local mine = {}
      for _, id in ipairs(ids) do mine[id] = true end
      for i = 1, rows do
        if mine[order[i]] then order[i] = false end
      end
      for k, id in ipairs(ids) do order[rows + k] = id end
      dex.footprints = ${JSON.stringify(footprintStrip(modId))}
    end)
  end`;
}
