// Gen 1 visibility rules (studio_visibility.lua: "<MAP>:<OBJECT NAME>" ->
// { flag, whileSet }): a person is shown only while the flag is set (or only
// while it isn't). Each map with a rule gets an onEnter (map_scripts is a
// compose registry, so it runs beside the game's own) that flips the person's
// switch through the engine's show_object / hide_object verbs (data.commands,
// gen1recomp Commands.toggleObject: save.objectToggles, the live NPC list).
// Plain Lua, no requires, no backticks.

export const VISIBILITY_RUNTIME = String.raw`
  -- studio visibility rules (Gen 1): people shown only while a flag is (not) set
  local function studioVisibility(rules)
    local byMap = {}
    for key, r in pairs(rules or {}) do
      local map, object = string.match(key, "^(.-):(.+)$")
      if map and type(r) == "table" and type(r.flag) == "string" then
        byMap[map] = byMap[map] or {}
        table.insert(byMap[map], { object = object, flag = r.flag, whileSet = r.whileSet ~= false })
      end
    end
    for map, list in pairs(byMap) do
      mod.content.map_scripts:register(map, { onEnter = function(game, ow)
        local cmds = game.data.commands or {}
        local flags = game.save.flags or {}
        local ctx = { game = game, save = game.save, overworld = ow }
        for _, r in ipairs(list) do
          local on = (flags[r.flag] and true or false) == r.whileSet
          local verb = cmds[on and "show_object" or "hide_object"]
          local fn = type(verb) == "table" and verb.fn or verb
          if type(fn) == "function" then fn(ctx, map, r.object) end
        end
      end })
    end
  end
`;

export function visibilityRegistration(modId: string, file: string): string {
  const module = `mods.${modId}.${file.replace(/\.lua$/, "")}`;
  return `  studioVisibility(require(${JSON.stringify(module)}))`;
}
