// Gen 2 Global settings with no registry: Gold keeps them in module tables the
// engine reads at the moment of use, so the helper sets them on game.ready
// (engine_internals: a require of an engine module, inside the handler so the
// studio can still read the mod back).
//   HM badges     src/world/gen2/FieldMoves.lua BADGE[move] = Johto badge name
//                 (nil: no badge needed; FieldMoves.hasBadge answers yes)
//   slot reels    src/ui/gen2/SlotMachine.lua REELS[1..3]: 15 symbol bytes + the
//                 first three again
// Plain Lua, no backticks.

export const FIELD_RUNTIME2 = "";

export function hmBadgeRegistration2(modId: string, file: string): string {
  const module = `mods.${modId}.${file.replace(/\.lua$/, "")}`;
  return String.raw`
  -- studio HM badges (Gen 2): the badge each field move needs
  do
    local gates = require(${JSON.stringify(module)}).badges
    -- the engine module only exists in the game (not where the mod is read)
    mod.events:on("game.ready", function()
      local FieldMoves = require("src.world.gen2.FieldMoves")
      if type(gates) == "table" and type(FieldMoves.BADGE) == "table" then
        for move in pairs(FieldMoves.BADGE) do
          local g = gates[move]
          FieldMoves.BADGE[move] = type(g) == "table" and g.badge or nil
        end
      end
    end)
  end`;
}

// the Town Map's tile grids: data.gen2MenuGfx.pokegear.maps[region] (Pokegear
// reads them when it opens; plain data, no require)
export function townMapRegistration2(modId: string, file: string): string {
  const module = `mods.${modId}.${file.replace(/\.lua$/, "")}`;
  return String.raw`
  -- studio Town Map (Gen 2): the regions' tile grids
  do
    local grids = require(${JSON.stringify(module)})
    mod.events:on("game.ready", function(ev)
      local gfx = ev and ev.game and ev.game.data and ev.game.data.gen2MenuGfx
      local maps = gfx and gfx.pokegear and gfx.pokegear.maps
      if type(maps) ~= "table" then return end
      for region, grid in pairs(grids) do
        if type(grid) == "table" then maps[region] = grid end
      end
    end)
  end`;
}

// Fruit trees (studio_fruit_trees.lua: record "trees" = the item each tree
// number gives, 1-based like FRUITTREE_*): Apricorns.FRUIT_TREES is a module
// table, set on game.ready. Trees past the game's 30 work too (the daily
// refill clears every tree's picked mark at once).
export function fruitTreeRegistration2(modId: string, file: string): string {
  const module = `mods.${modId}.${file.replace(/\.lua$/, "")}`;
  return String.raw`
  -- studio fruit trees (Gen 2): the item each tree number gives
  do
    local trees = require(${JSON.stringify(module)}).trees
    mod.events:on("game.ready", function()
      local Apricorns = require("src.core.gen2.Apricorns")
      if type(trees) == "table" and type(Apricorns.FRUIT_TREES) == "table" then
        for i, id in ipairs(trees) do Apricorns.FRUIT_TREES[i] = id end
        Apricorns.NUM_FRUIT_TREES = #Apricorns.FRUIT_TREES
      end
    end)
  end`;
}

export function slotRegistration2(modId: string, file: string): string {
  const module = `mods.${modId}.${file.replace(/\.lua$/, "")}`;
  return String.raw`
  -- studio slot reels (Gen 2): the symbols on the three reels
  do
    local reels = require(${JSON.stringify(module)}).reels
    local BYTE = { SEVEN = 0x00, POKEBALL = 0x04, CHERRY = 0x08, PIKACHU = 0x0c, SQUIRTLE = 0x10, STARYU = 0x14 }
    mod.events:on("game.ready", function()
      local SlotMachine = require("src.ui.gen2.SlotMachine")
      if type(reels) == "table" and type(SlotMachine.REELS) == "table" then
        for w, strip in ipairs(reels) do
          local out = {}
          for i, sym in ipairs(strip) do out[i] = BYTE[sym] or 0 end
          SlotMachine.REELS[w] = out
        end
      end
    end)
  end`;
}
