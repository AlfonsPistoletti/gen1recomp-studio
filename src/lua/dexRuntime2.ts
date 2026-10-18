// The fixed Lua helper that lists a mod's new species in Gold's Pokédex,
// written into studio_content.lua when the mod adds a species. The #DEX lists
// only data.gen2Pokedex.entries (gen1recomp src/ui/gen2/PokedexMenu.lua: OLD by
// entry.dex, NEW = newOrder, A-Z = alphabeticalOrder), and PokedexText.apply
// only fills entries pokedex.lua already has (ISSUES #11). game.ready fires
// after both, before the first screen: a species with a dex number and no
// entry gets one from its dexEntry and joins the NEW and A-Z orders. Entries
// another mod built are left alone. Plain Lua, no requires, no backticks.

export const DEX_RUNTIME2 = String.raw`
  -- studio species (Gen 2): Pokedex entries for species pokedex.lua doesn't have
  mod.events:on("game.ready", function(ev)
    local data = ev and ev.game and ev.game.data
    local dex = data and data.gen2Pokedex
    if not (dex and data.pokemon) then return end
    dex.entries = dex.entries or {}
    local added = {}
    for id, def in pairs(data.pokemon) do
      if type(def) == "table" and type(def.dex) == "number" and not dex.entries[id] then
        local e = def.dexEntry or {}
        dex.entries[id] = { id = id, dex = def.dex, kind = e.kind or "", text = e.text or "", text2 = e.text2,
          height = e.height or 0, weight = e.weight or 0 }
        added[#added + 1] = id
      end
    end
    if #added == 0 then return end
    table.sort(added, function(a, b) return data.pokemon[a].dex < data.pokemon[b].dex end)
    local function nameOf(id) return tostring((data.pokemon[id] and data.pokemon[id].name) or id) end
    if dex.newOrder then
      for _, id in ipairs(added) do dex.newOrder[#dex.newOrder + 1] = id end
    end
    -- placed by name, the game's own order kept as it is
    local az = dex.alphabeticalOrder
    if az then
      for _, id in ipairs(added) do
        local at = #az + 1
        for i, other in ipairs(az) do
          if nameOf(other) > nameOf(id) then at = i break end
        end
        table.insert(az, at, id)
      end
    end
  end)
`;
