// The fixed Lua helper the studio writes into studio_content.lua when a mod
// edits or adds Game Corner prize counters. Each spec from studio_prizes.lua
// ("<MAP_ID>:<TEXT_ID>" -> { prizes = {...} }) becomes that map's talk handler
// for the counter's TEXT id, a port of gen1recomp data/scripts/story3.lua
// prizeCounter (engine/events/prize_menu.asm): Coin Case check, the real
// prize window, "So, you want ...?", coins, bag/box full.
//
// It uses engine modules (the prize window, text box, bag), so the mod needs
// the engine_internals permission; they are required inside the handler only,
// never while the mod loads. The window always shows three prizes. Plain Lua
// 5.1/LuaJIT, and no backticks (it lives in a template string).

export const PRIZE_RUNTIME = String.raw`
  -- studio prize counters: specs from studio_prizes.lua -> map_scripts talk handlers
  local function studioPrizeCounter(spec)
    return function(game, ow, npc, done)
      local PrizeCounter = require("src.ui.PrizeCounter")
      local TextBox = require("src.render.TextBox")
      local t = game.data.text
      -- IsItemInBag COIN_CASE: without the case, deny and open no window
      if not game.save.inventory.COIN_CASE then
        game.stack:push(TextBox.new(game, t._RequireCoinCaseText or "A COIN CASE is\nrequired!", done))
        return
      end
      game.stack:push(TextBox.new(game,
        t._ExchangeCoinsForPrizesText or "We exchange your\ncoins for prizes.",
        function()
          local rows = {}
          for _, p in ipairs(spec.prizes or {}) do
            local def = p.species and game.data.pokemon[p.species] or (p.item and game.data.items[p.item])
            rows[#rows + 1] = { name = def and def.name or (p.species or p.item or "?"), cost = p.cost, prize = p }
          end
          local whichBox, menu
          local function close()
            local st = game.stack
            while st:top() == menu or st:top() == whichBox do st:pop() end
          end
          local function endTalk()
            if ow then ow.prizeWindow = nil end
            done()
          end
          local function finish(msg)
            game.stack:push(TextBox.new(game, msg, endTalk))
          end
          local function buy(p)
            if (game.save.coins or 0) < p.cost then
              finish(t._SorryNeedMoreCoinsText or "Sorry, you need\nmore coins.")
              return
            end
            -- hand the prize over first; coins only go once it landed
            if p.species then
              ow.runner:run({
                { "give_pokemon", p.species, p.level or 5, false, true },
                { "jump_if_false", "boxfull" },
                { "take_coins", p.cost },
                { "jump", "out" },
                { "label", "boxfull" },
                { "show_text", "_BoxIsFullText" },
                { "label", "out" },
              }, { onDone = endTalk })
              return
            end
            if not require("src.inventory.Bag").add(game.save, p.item, 1, game.data) then
              finish(t._OopsYouDontHaveEnoughRoomText or "Oops! You don't\nhave enough room.")
              return
            end
            game.save.coins = game.save.coins - p.cost
            endTalk()
          end
          whichBox = TextBox.new(game, t._WhichPrizeText or "Which prize do\nyou want?", nil, {
            instant = true,
            stay = { onShown = function()
              menu = PrizeCounter.new(game, rows, {
                onCancel = function()
                  close()
                  done()
                end,
                onPick = function(row, idx)
                  if not row then
                    close()
                    done()
                    return
                  end
                  local p = row.prize
                  if ow then ow.prizeWindow = { prizes = rows, index = idx } end
                  close()
                  local ask = (t._SoYouWantPrizeText or "So, you want\n{RAM:wNameBuffer}?")
                    :gsub("{RAM:wNameBuffer}", row.name)
                  game.stack:push(TextBox.new(game, ask, nil, {
                    instant = true,
                    choice = function(yes)
                      if not yes then
                        finish(t._OhFineThenText or "Oh, fine then.")
                        return
                      end
                      buy(p)
                    end,
                  }))
                end,
              })
              game.stack:push(menu)
            end },
          })
          game.stack:push(whichBox)
        end, { instant = true }))
    end
  end
`;

// the registration after the helper: one talk table per map
export function prizeRegistration(modId: string, file: string): string {
  const module = `mods.${modId}.${file.replace(/\.lua$/, "")}`;
  return [
    "  do",
    "    local byMap = {}",
    `    for id, spec in pairs(require(${JSON.stringify(module)})) do`,
    '      local map, text = id:match("^([^:]+):(.+)$")',
    "      if map then",
    "        byMap[map] = byMap[map] or {}",
    "        byMap[map][text] = studioPrizeCounter(spec)",
    "      end",
    "    end",
    "    for map, talk in pairs(byMap) do",
    "      mod.content.map_scripts:register(map, { talk = talk })",
    "    end",
    "  end",
  ].join("\n");
}
