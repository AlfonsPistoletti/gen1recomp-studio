// The fixed Lua helper for Gen 2 (Gold/Silver) tileset extensions, written
// into studio_content.lua like the Gen 1 one (tilesetRuntime.ts). Each spec
// from studio_tilesets.lua (tileset id -> { first, tiles, blocks, collision,
// palettes }) patches that tileset in place:
//   blocks       the tileset's blocks + the added ones (16 tile ids each)
//   collision    the tileset's collision quads + one per added block
//   tilePalettes the tileset's palette slot per tile + the added tiles' (tile
//                first + i; Crystal's list has gaps, so it is copied by key)
//   anim         the tileset's animation program + the mod's rows (an added
//                tile animated with one of the engine's strip patterns; the
//                program's period stays, so the game's tiles keep their speed)
//   image        the sheet the assets_transforms recipe builds on the
//                player's machine when tiles were added (as for Gen 1):
//                below the sheet, or into its blank slots (Crystal: `first`
//                lies inside the sheet, `sheet` holds the sheet's tile count)
// The lists come from mod.content.tilesets:get(id) while the mod loads (a
// patch replaces lists), so no vanilla data is written into the mod.
// Plain Lua 5.1/LuaJIT, and no backticks (it lives in a template string).

export const TILESET_RUNTIME2 = String.raw`
  -- studio tileset extensions (Gen 2): specs from studio_tilesets.lua -> tileset patches
  local function studioExtendTileset2(id, ext, dir)
    if ext.first == nil then return end
    local base = mod.content.tilesets:get(id)
    if type(base) ~= "table" or type(base.blocks) ~= "table" then return end
    local w, h = tonumber(base.imageWidth), tonumber(base.imageHeight)
    if not w or not h then return end
    local per = base.tilesPerRow or math.floor(w / 8)
    -- the added tiles start right after the sheet's own; a sheet of another
    -- size (another mod replaced it) would shift them all
    if math.floor(w / 8) * math.floor(h / 8) ~= (ext.sheet or ext.first) then
      mod.log:info("tileset " .. id .. " is not the sheet the studio extended; extension skipped")
      return
    end
    local function joined(list, extra)
      local out = {}
      for _, v in ipairs(list or {}) do out[#out + 1] = v end
      for _, v in ipairs(extra or {}) do out[#out + 1] = v end
      return out
    end
    local patch = { blocks = joined(base.blocks, ext.blocks), collision = joined(base.collision, ext.collision) }
    if #(ext.palettes or {}) > 0 then
      local pals = {}
      for k, v in pairs(base.tilePalettes or {}) do pals[k] = v end
      for i, v in ipairs(ext.palettes) do pals[ext.first + i] = v end
      patch.tilePalettes = pals
    end
    if type(ext.anim) == "table" and #ext.anim > 0 and type(base.anim) == "table" then
      patch.anim = { period = base.anim.period, frames = joined(base.anim.frames, ext.anim) }
    end
    local count = #(ext.tiles or {})
    if count > 0 then
      patch.image = dir .. id:lower() .. ".png"
      patch.imageHeight = math.max(h, math.ceil((ext.first + count) / per) * 8)
    end
    mod.content.tilesets:patch(id, patch)
  end
`;

export function tilesetRegistration2(modId: string, file: string): string {
  const module = `mods.${modId}.${file.replace(/\.lua$/, "")}`;
  // the path is joined at run time: written whole, the recipe sync would
  // read it as reused vanilla art
  return [
    `  for id, ext in pairs(require(${JSON.stringify(module)})) do`,
    `    studioExtendTileset2(id, ext, "save/mod-derived/" .. ${JSON.stringify(modId)} .. "/studio/tilesets/")`,
    "  end",
  ].join("\n");
}
