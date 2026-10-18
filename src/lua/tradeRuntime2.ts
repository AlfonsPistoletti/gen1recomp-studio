// In-game trades on Gen 2 (Global > In-game trades). Gold's six trades are rows
// of data/generated/events.lua `trades` (gen1recomp src/core/gen2/NpcTrade.lua,
// read by name: give, get, nickname, item, otName, otId, gender, dvs, dialog);
// no registry reaches them, so studio_trades.lua's list replaces the rows on
// game.ready, before any script runs a trade. Plain Lua, no requires, no backticks.

export const TRADE_RUNTIME2 = "";

export function tradeRegistration2(modId: string, file: string): string {
  const module = `mods.${modId}.${file.replace(/\.lua$/, "")}`;
  return String.raw`
  -- studio trades (Gen 2): the NPC trade rows
  local studioTrades = require(${JSON.stringify(module)}).trades
  if type(studioTrades) == "table" then
    mod.events:on("game.ready", function(ev)
      local tables = ev and ev.game and ev.game.data and ev.game.data.gen2EventTables
      local rows = tables and tables.trades
      if type(rows) ~= "table" then return end
      for i, t in ipairs(studioTrades) do rows[i] = t end
    end)
  end`;
}
