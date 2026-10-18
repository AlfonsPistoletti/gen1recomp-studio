// The fixed Lua helper for Gold's start values (Global > Start values),
// written into studio_content.lua when studio_start.lua differs from the game.
// Gold has no data for them: Save.newGame sets money = 3000, and the World
// starts a new game at data.gen2Landmarks.spawns.SPAWN_HOME (gen1recomp
// src/world/gen2/World.lua; also where a blackout lands before any Pokémon
// Center). So the money goes through the public save.new_game hook (it wraps
// the fresh save), and the spawn is moved on game.ready, after the data is
// loaded and before the World reads it. The record "names" holds the naming
// menu's player names (gen1recomp src/ui/gen2/OakSpeech.lua namePresets).
// Plain Lua, no requires, no backticks.

export const START_RUNTIME2 = "";

export function startRegistration2(modId: string, file: string): string {
  const module = `mods.${modId}.${file.replace(/\.lua$/, "")}`;
  return String.raw`
  -- studio start values (Gen 2): new-game money and the home spawn
  local studioStartFile = require(${JSON.stringify(module)})
  local studioStart = studioStartFile.start
  local studioNames = studioStartFile.names
  if studioStart and studioStart.money then
    mod.hooks:wrap("save.new_game", function(vanilla, save)
      local fresh = vanilla(save)
      if fresh and fresh.player then fresh.player.money = studioStart.money end
      return fresh
    end)
  end
  if studioStart and studioStart.map then
    mod.events:on("game.ready", function(ev)
      local landmarks = ev and ev.game and ev.game.data and ev.game.data.gen2Landmarks
      local spawns = landmarks and landmarks.spawns
      local home = spawns and spawns.SPAWN_HOME
      if home then home.map, home.x, home.y = studioStart.map, studioStart.x, studioStart.y end
    end)
  end
  -- the naming menu's names: OakSpeech reads data.field.boot.namePresets
  -- (the field registry is Gen 1 only, so it is set here)
  if studioNames and studioNames.player then
    mod.events:on("game.ready", function(ev)
      local data = ev and ev.game and ev.game.data
      if not data then return end
      data.field = data.field or {}
      data.field.boot = data.field.boot or {}
      data.field.boot.namePresets = data.field.boot.namePresets or {}
      data.field.boot.namePresets.player = studioNames.player
    end)
  end`;
}
