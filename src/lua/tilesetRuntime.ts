// The fixed Lua helper the studio writes into studio_content.lua when a mod
// extends vanilla tilesets. Each spec from studio_tilesets.lua (tileset id ->
// { first, tiles, blocks, walkable, animated }) patches that tileset in place,
// so every engine check keyed on its id keeps working:
//   image     the sheet the assets_transforms recipe builds on the player's
//             machine (their own imported sheet + the added tiles, see
//             src/core/assets.ts), under save/mod-derived/<mod>/studio/
//   blocks    the tileset's blocks + the added ones
//   walkable  the tileset's walkable tiles + the added ones
//   animatedTiles  only with animated tiles: the tileset's own animations
//             (restated from its animation string, as TileRenderer
//             .defaultAnimatedTiles does: a declared list replaces them) +
//             one "frames" entry per animated tile, its 8x8 frames built by
//             the recipe. Flower frames are the recipe's copies of the
//             player's own; spinner tilesets (GYM, FACILITY) are never given
//             a list (their spinner entry can't be restated).
// RED++ colors (`gbc`: groups = { {tile, group}, ... }, palettes = 8 x 4
// colors for a tileset of the mod's own) have no mod API: the engine reads
// them from its data.palettes_gbc table only (src/render/PaletteFX.lua
// worldPack), so the helper writes them into that table while the mod loads
// (before any map is drawn). The mod carries engine_internals for it. If the
// table ever changes shape, the tiles keep their default colors.
// The lists are built from mod.content.tilesets:get(id) while the mod loads
// (a patch replaces lists), so no vanilla block data is written into the mod.
// Plain Lua 5.1/LuaJIT, and no backticks (it lives in a template string).

export const TILESET_RUNTIME = String.raw`
  -- studio tileset extensions: specs from studio_tilesets.lua -> tileset patches
  local function studioExtendTileset(id, ext, dir)
    local image = dir .. id:lower() .. ".png"
    if ext.first == nil then return end
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
    if #(ext.animated or {}) > 0 and id ~= "GYM" and id ~= "FACILITY" then
      local anims = {}
      if type(base.animatedTiles) == "table" then
        for _, a in ipairs(base.animatedTiles) do anims[#anims + 1] = a end
      else
        if base.animation == "TILEANIM_WATER" or base.animation == "TILEANIM_WATER_FLOWER" then
          anims[#anims + 1] = { tile = 20, kind = "hshift", period = 20, offsets = { 1, 2, 3, 2, 1, 0, 7, 0 } }
        end
        if base.animation == "TILEANIM_WATER_FLOWER" then
          anims[#anims + 1] = { tile = 3, kind = "frames", period = 20, sequence = { 1, 2, 3, 1, 1, 2, 3, 1 },
            images = { dir .. "flower1.png", dir .. "flower2.png", dir .. "flower3.png" } }
        end
      end
      for _, a in ipairs(ext.animated) do
        local images, sequence = {}, {}
        for k = 1, #a.frames do
          images[k] = dir .. id:lower() .. "_" .. a.tile .. "_" .. k .. ".png"
          sequence[k] = k
        end
        anims[#anims + 1] = { tile = a.tile, kind = "frames", period = a.period or 20, images = images, sequence = sequence }
      end
      patch.animatedTiles = anims
    end
    mod.content.tilesets:patch(id, patch)
  end

  local function studioColorTileset(id, gbc)
    if type(gbc) ~= "table" then return end
    for _, name in ipairs({ "data.palettes_gbc", "data.palettes_gbc_yellow" }) do
      local ok, pack = pcall(require, name)
      local w = ok and type(pack) == "table" and pack.world
      if type(w) == "table" and type(w.tileGroups) == "table" then
        -- a tileset of the mod's own: its palettes (base table only; the
        -- Yellow one falls back to it)
        if gbc.palettes and name == "data.palettes_gbc" and type(w.groupColors) == "table" then
          w.groupColors[id] = gbc.palettes
          w.tileGroups[id] = w.tileGroups[id] or {}
        end
        local groups = w.tileGroups[id]
        if type(groups) == "table" then
          for _, pair in ipairs(gbc.groups or {}) do groups[pair[1]] = pair[2] end
        end
      end
    end
  end
`;

// tilesets whose spinner animation can't be restated: no custom animations
export const SPINNER_TILESETS = ["GYM", "FACILITY"];

// the recipe's output for one frame of an extension's animated tile
export function frameRel(id: string, tile: number, k: number): string {
  return `studio/tilesets/${id.toLowerCase()}_${tile}_${k}.png`;
}

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
    `    studioExtendTileset(id, ext, "save/mod-derived/" .. ${JSON.stringify(modId)} .. "/studio/tilesets/")`,
    "    studioColorTileset(id, ext.gbc)",
    "  end",
  ].join("\n");
}
