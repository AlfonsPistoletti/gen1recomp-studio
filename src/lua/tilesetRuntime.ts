// The fixed Lua helper the studio writes into studio_content.lua when a mod
// extends vanilla tilesets. Each spec from studio_tilesets.lua (tileset id ->
// { first, tiles, blocks, walkable }) patches that tileset in place, so every
// engine check keyed on its id keeps working:
//   image     the sheet the assets_transforms recipe builds on the player's
//             machine (their own imported sheet + the added tiles, see
//             src/core/assets.ts), under save/mod-derived/<mod>/studio/
//   blocks    the tileset's blocks + the added ones
//   walkable  the tileset's walkable tiles + the added ones
// The lists are built from mod.content.tilesets:get(id) while the mod loads
// (a patch replaces lists), so no vanilla block data is written into the mod.
// Plain Lua 5.1/LuaJIT, and no backticks (it lives in a template string).

export const TILESET_RUNTIME = String.raw`
  -- studio tileset extensions: specs from studio_tilesets.lua -> tileset patches
  local function studioExtendTileset(id, ext, image)
    local base = mod.content.tilesets:get(id)
    if type(base) ~= "table" or type(base.blocks) ~= "table" then return end
    local w, h = tonumber(base.imageWidth), tonumber(base.imageHeight)
    if not w or not h then return end
    local per = base.tilesPerRow or math.floor(w / 8)
    -- the added tiles start right after the sheet's own; a sheet of another
    -- size (another mod replaced it) would shift them all
    if math.floor(w / 8) * math.floor(h / 8) ~= ext.first then
      mod.log:info("tileset " .. id .. " is not the sheet the studio extended; extension skipped")
      return
    end
    local blocks, walkable = {}, {}
    for _, b in ipairs(base.blocks) do blocks[#blocks + 1] = b end
    for _, b in ipairs(ext.blocks or {}) do blocks[#blocks + 1] = b end
    for _, t in ipairs(base.walkable or {}) do walkable[#walkable + 1] = t end
    for _, t in ipairs(ext.walkable or {}) do walkable[#walkable + 1] = t end
    local patch = { blocks = blocks, walkable = walkable }
    -- new tiles: the sheet the recipe built (none: blocks of vanilla tiles only)
    local rows = math.ceil(#(ext.tiles or {}) / per)
    if rows > 0 then
      patch.image = image
      patch.imageHeight = h + rows * 8
    end
    mod.content.tilesets:patch(id, patch)
  end
`;

// the recipe's output for an extended tileset, under save/mod-derived/<mod>/
export function extendedSheetRel(id: string): string {
  return `studio/tilesets/${id.toLowerCase()}.png`;
}

export function tilesetRegistration(modId: string, file: string): string {
  const module = `mods.${modId}.${file.replace(/\.lua$/, "")}`;
  // the path is joined at run time: written whole, the recipe sync would
  // read it as reused vanilla art
  return [
    `  for id, ext in pairs(require(${JSON.stringify(module)})) do`,
    `    studioExtendTileset(id, ext, "save/mod-derived/" .. ${JSON.stringify(modId)} .. "/studio/tilesets/" .. id:lower() .. ".png")`,
    "  end",
  ].join("\n");
}
