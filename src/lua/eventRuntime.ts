// The fixed Lua helper the studio writes into studio_content.lua when a mod
// has events. studio_events.lua holds them as plain data:
//   ["<MAP_ID>:talk:<TEXT_ID>"] = { rows = {...} }
//   ["<MAP_ID>:step:<name>"]    = { x = 5, y = 7, once = true, rows = {...} }
//   ["<MAP_ID>:enter:<name>"]   = { once = true, rows = {...} }
// rows are gen1recomp script rows ({ "show_text", "..." }, ...).
//
// Talk events go into map_scripts talk (a mod's talk wins over the game's
// for that TEXT id). Step and enter events become one onStep/onEnter per map
// that starts the rows on the overworld's script runner, the way the game's
// own step triggers do; "once" ones remember themselves with a flag.
//
// One small script command is registered for choices of 3+ options
// ("the player picked option N"). Plain Lua, no engine modules, no
// backticks (it lives in a template string).

export const EVENT_RUNTIME = String.raw`
  -- studio events: talk / step / enter events from studio_events.lua
  local function studioEvents(events)
    local byMap = {}
    for id, ev in pairs(events) do
      local map, kind, key = string.match(id, "^([^:]+):([^:]+):(.+)$")
      if map and type(ev) == "table" and type(ev.rows) == "table" then
        local m = byMap[map]
        if not m then
          m = { talk = {}, steps = {}, enters = {} }
          byMap[map] = m
        end
        local flag = "STUDIO_EVENT_" .. string.upper((string.gsub(id, "[^%w]", "_")))
        if kind == "talk" then
          m.talk[key] = ev.rows
        elseif kind == "step" then
          m.steps[#m.steps + 1] = { x = ev.x, y = ev.y, once = ev.once, flag = flag, rows = ev.rows }
        elseif kind == "enter" then
          m.enters[#m.enters + 1] = { once = ev.once, flag = flag, rows = ev.rows }
        end
      end
    end
    return byMap
  end

  -- start an event on the overworld's script runner; false when it can't run
  local function runEvent(game, ow, ev)
    if not ow or not ow.runner or ow.runner:isRunning() then return false end
    local flags = game.save.flags
    if ev.once then
      if flags[ev.flag] then return false end
      flags[ev.flag] = true
    end
    ow.runner:run(ev.rows, {})
    return true
  end

  local function registerStudioEvents(events)
    mod.content.commands:register("studio:check_choice", {
      fn = function(ctx, n)
        ctx.lastCheck = ctx.lastChoice ~= nil and ctx.lastChoice.index == n
      end,
    })
    -- Game Corner coins (the engine has take_coins only); 9999 is the
    -- coin case's cap (MAX_COINS)
    mod.content.commands:register("studio:give_coins", {
      fn = function(ctx, n)
        ctx.save.coins = math.min(9999, (ctx.save.coins or 0) + (n or 0))
      end,
    })
    mod.content.commands:register("studio:check_coins", {
      fn = function(ctx, n)
        ctx.lastCheck = (ctx.save.coins or 0) >= (n or 0)
      end,
    })
    for map, m in pairs(studioEvents(events)) do
      local value = { talk = m.talk }
      if #m.steps > 0 then
        local steps = m.steps
        value.onStep = function(game, ow, x, y)
          for _, ev in ipairs(steps) do
            if ev.x == x and ev.y == y and runEvent(game, ow, ev) then return true end
          end
          return false
        end
      end
      if #m.enters > 0 then
        local enters = m.enters
        value.onEnter = function(game, ow)
          for _, ev in ipairs(enters) do
            if runEvent(game, ow, ev) then return end
          end
        end
      end
      mod.content.map_scripts:register(map, value)
    end
  end
`;

export function eventRegistration(modId: string, file: string): string {
  const module = `mods.${modId}.${file.replace(/\.lua$/, "")}`;
  return `  registerStudioEvents(require(${JSON.stringify(module)}))`;
}
