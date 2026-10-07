// "Play from here": a small helper mod the studio writes before it starts the
// game. It is experimental (off in normal play) and force-enabled only by
// PLAY_ENV, which the studio sets for the game it starts. It continues the
// player's active save on the picked cell (a new game starts there when
// there is no save) and vetoes every save write (Game:writeSave's
// "save.write" hook), so a test run never touches the player's slot.

import { PLAY_ENV } from "../host/types.ts";

export const PLAYTEST_ID = "studio_playtest";

export interface PlayTarget {
  map: string;
  x: number;
  y: number;
}

export function playtestManifest(game: string): string {
  const manifest = {
    id: PLAYTEST_ID,
    name: "Studio play test",
    version: "1.0.0",
    api: 2,
    entry: "main.lua",
    profile: "content",
    category: "GAMEPLAY",
    priority: 1000,
    dependencies: [],
    optional_dependencies: [],
    conflicts: [],
    incompatible: [],
    games: [game],
    experimental: true,
    force_enable_env: PLAY_ENV,
    // SaveData.load (the title screen's CONTINUE) is engine code
    permissions: ["engine_internals"],
    description: "Written by gen1recomp-studio for Play from here: starts on the picked cell, saving off. Only active when the studio starts the game.",
  };
  return JSON.stringify(manifest, null, 2) + "\n";
}

export function playtestMain(t: PlayTarget): string {
  return `-- Written by gen1recomp-studio for "Play from here", rewritten on every
-- launch. Only active when the studio starts the game (force_enable_env).
local TARGET = { map = ${JSON.stringify(t.map)}, x = ${t.x}, y = ${t.y}, facing = "down" }

return function(mod)
  -- with no save yet, the new game starts on the cell too
  mod.content.field:patch("boot", {
    startMap = TARGET.map, startX = TARGET.x, startY = TARGET.y, startFacing = TARGET.facing,
  })

  -- a test run never writes the player's save (START > SAVE, F1)
  local told = false
  mod.hooks:wrap("save.write", function()
    if not told then
      told = true
      mod.log:info("test run: saving is off")
    end
    return false
  end)

  -- first frame: the title screen's CONTINUE, moved to the cell
  local placed = false
  mod.hooks:wrap("core.update", function(next, game, dt)
    if not placed then
      placed = true
      local SaveData = require("src.core.SaveData")
      local loaded, recovered = SaveData.load()
      if loaded and loaded.player then
        -- the save never knew this helper: list it, so the load report
        -- (Game:restoreSave, mods "newly active") only shows real changes
        loaded.meta = type(loaded.meta) == "table" and loaded.meta or {}
        loaded.meta.mods = type(loaded.meta.mods) == "table" and loaded.meta.mods or {}
        table.insert(loaded.meta.mods, { id = ${JSON.stringify(PLAYTEST_ID)}, version = "1.0.0", api = 2 })
        loaded.player.map = TARGET.map
        loaded.player.x = TARGET.x
        loaded.player.y = TARGET.y
        loaded.player.facing = TARGET.facing
        game:restoreSave(loaded, recovered, { freshBoot = true })
      else
        game:startNewGame({ intro = false })
      end
    end
    return next(game, dt)
  end)
end
`;
}
