// A real Lua VM (wasmoon, Lua 5.4) for reading the game's Lua data and for
// running a mod's entry point against a recording stub of the mod API.
// Everything crosses back into JS as JSON produced on the Lua side, so table
// shapes are decided by one encoder rather than by a binding's heuristics.
//
// Runs unchanged in the browser and in Node; the browser passes the URL of
// wasmoon's glue.wasm through configureLua.

import { LuaFactory } from "wasmoon";
import type { RegistryOp } from "../core/types.ts";

let factory: LuaFactory | null = null;

export function configureLua(wasmUrl?: string): void {
  factory = new LuaFactory(wasmUrl);
}

function getFactory(): LuaFactory {
  factory ??= new LuaFactory();
  return factory;
}

const PRELUDE = String.raw`
local DELETE = setmetatable({}, { __name = "mod.DELETE" })
local DUMMY_MT = {}
local dummy = setmetatable({}, DUMMY_MT)
-- numeric keys miss, so ipairs() over a stand-in ends instead of spinning
DUMMY_MT.__index = function(_, k) if type(k) == "number" then return nil end return dummy end
DUMMY_MT.__call = function() return dummy end
DUMMY_MT.__newindex = function() end
DUMMY_MT.__concat = function() return "" end
DUMMY_MT.__tostring = function() return "" end
DUMMY_MT.__len = function() return 0 end
for _, op in ipairs({ "__add", "__sub", "__mul", "__div", "__mod", "__unm", "__idiv", "__pow" }) do
  DUMMY_MT[op] = function() return 0 end
end
DUMMY_MT.__lt = function() return false end
DUMMY_MT.__le = function() return false end
__dummy = dummy
__DELETE = DELETE

-- LuaJIT / Lua 5.1 names mod code may touch (the game runs on LuaJIT)
unpack = unpack or table.unpack
loadstring = loadstring or load
table.getn = table.getn or function(t) return #t end
math.atan2 = math.atan2 or math.atan
math.pow = math.pow or function(a, b) return a ^ b end
math.ldexp = math.ldexp or function(m, e) return m * 2.0 ^ e end
setfenv = setfenv or function(f) return f end
getfenv = getfenv or function() return _ENV end
love = dummy
bit = dummy
jit = nil

local function isArray(t)
  local n = 0
  for k in pairs(t) do
    if math.type(k) ~= "integer" or k < 1 then return false end
    n = n + 1
  end
  for i = 1, n do if t[i] == nil then return false end end
  return true, n
end

local function str(s)
  return '"' .. s:gsub('[%c"\\]', function(c)
    if c == '"' then return '\\"' elseif c == "\\" then return "\\\\"
    elseif c == "\n" then return "\\n" elseif c == "\r" then return "\\r"
    elseif c == "\t" then return "\\t" end
    return string.format("\\u%04x", c:byte())
  end) .. '"'
end

local function enc(v, out, seen)
  local t = type(v)
  if v == DELETE then out[#out + 1] = '{"__delete":true}'
  elseif t == "table" then
    -- a get() stand-in keeps what it read (registry:get marker)
    if getmetatable(v) == DUMMY_MT and type(rawget(v, "__ref")) == "string" then
      out[#out + 1] = '{"__ref":' .. str(rawget(v, "__ref")) .. "}"
      return
    end
    if getmetatable(v) == DUMMY_MT or seen[v] then out[#out + 1] = "null" return end
    seen[v] = true
    local arr, n = isArray(v)
    if arr then
      out[#out + 1] = "["
      for i = 1, n do
        if i > 1 then out[#out + 1] = "," end
        enc(v[i], out, seen)
      end
      out[#out + 1] = "]"
    else
      out[#out + 1] = "{"
      local first = true
      for k, val in pairs(v) do
        local kt = type(k)
        if kt == "string" or kt == "number" then
          if not first then out[#out + 1] = "," end
          first = false
          out[#out + 1] = str(tostring(k))
          out[#out + 1] = ":"
          enc(val, out, seen)
        end
      end
      out[#out + 1] = "}"
    end
    seen[v] = nil
  elseif t == "string" then out[#out + 1] = str(v)
  elseif t == "number" then
    if v ~= v or v == math.huge or v == -math.huge then out[#out + 1] = "null"
    elseif math.type(v) == "integer" then out[#out + 1] = tostring(v)
    else out[#out + 1] = string.format("%.17g", v) end
  elseif t == "boolean" then out[#out + 1] = tostring(v)
  else out[#out + 1] = "null" end
end

function __json(v)
  local out = {}
  enc(v, out, {})
  return table.concat(out)
end
`;

const MOD_RUNNER = String.raw`
local MOD_ID, SKIP, ENTRY = ...
if SKIP == "" then SKIP = nil end
local ops, errors = {}, {}
local dummy, DELETE = __dummy, __DELETE

local loaded = {}
require = function(name)
  if type(name) ~= "string" then return dummy end
  if loaded[name] ~= nil then return loaded[name] end
  if SKIP and name == SKIP then return function() end end
  -- only the mod's own files run; engine modules stay stand-ins
  if not name:match("^mods%.") then return dummy end
  local rel = name:gsub("%.", "/") .. ".lua"
  local src = __read(rel)
  if not src then return dummy end
  local chunk, err = load(src, "@" .. rel, "t", _ENV)
  if not chunk then errors[#errors + 1] = err return dummy end
  local ok, result = pcall(chunk, name)
  if not ok then errors[#errors + 1] = tostring(result) result = dummy end
  if result == nil then result = true end
  loaded[name] = result
  return result
end

local registries = {}
local function registry(name)
  if registries[name] then return registries[name] end
  local reg = setmetatable({}, { __index = function(_, k)
    if k == "patch" or k == "register" or k == "override" or k == "remove" then
      return function(_, id, value)
        ops[#ops + 1] = { registry = name, op = k, id = id, value = value, owner = MOD_ID }
      end
    end
    -- get: a stand-in that also says what it read ({ __ref = "registry:id" }),
    -- so a registration of another record's value is recognised
    if k == "get" then
      return function(_, id) return setmetatable({ __ref = name .. ":" .. tostring(id) }, getmetatable(dummy)) end
    end
    return dummy
  end })
  registries[name] = reg
  return reg
end

local content = setmetatable({}, { __index = function(_, name) return registry(name) end })
local modPath = "mods/" .. MOD_ID
local function own(_, rel) return modPath .. "/" .. tostring(rel) end
local assets = setmetatable({ path = own, image = own }, { __index = function() return dummy end })
-- mod:read(rel): one of the mod's own files (preloaded .lua files only)
local function readOwn(_, rel)
  local text = __read(modPath .. "/" .. tostring(rel))
  if text then return text end
  return nil, "not available to the studio"
end
local mod = setmetatable({ id = MOD_ID, path = modPath, content = content, assets = assets, read = readOwn, DELETE = DELETE },
  { __index = function() return dummy end })

-- as Loader:_loadMod does it: the chunk gets the API as its vararg, and
-- a returned function is called with it too
local src = __read(ENTRY)
if src then
  local chunk, err = load(src, "@" .. ENTRY, "t", _ENV)
  if not chunk then
    errors[#errors + 1] = err
  else
    local ok, result = pcall(chunk, mod)
    if not ok then
      errors[#errors + 1] = tostring(result)
    elseif type(result) == "function" then
      local ok2, err2 = pcall(result, mod)
      if not ok2 then errors[#errors + 1] = tostring(err2) end
    end
  end
end

return __json({ ops = ops, errors = errors })
`;

type Engine = Awaited<ReturnType<LuaFactory["createEngine"]>>;

// `files` maps game-relative paths ("mods/x/y.lua") to their source; Lua's
// require can only read synchronously, so callers preload what it may need.
async function withEngine<T>(files: Map<string, string>, run: (engine: Engine) => Promise<T>, traceAllocations = false): Promise<T> {
  const engine = await getFactory().createEngine({ injectObjects: false, enableProxy: false, traceAllocations });
  try {
    // undefined, not null: wasmoon cannot hand a JS null back to Lua
    engine.global.set("__read", (rel: string) => files.get(rel) ?? undefined);
    await engine.doString(PRELUDE);
    return await run(engine);
  } finally {
    engine.global.close();
  }
}

// Evaluates a data file such as data/generated/maps.lua and returns it as JSON.
export async function loadLuaData<T>(source: string, name: string): Promise<T> {
  return withEngine(new Map(), async (engine) => {
    engine.global.set("__source", source);
    engine.global.set("__name", "@" + name);
    const json: string = await engine.doString(
      `local chunk = assert(load(__source, __name, "t", {})) return __json(chunk())`,
    );
    return JSON.parse(json) as T;
  });
}

export interface ModRun {
  ops: RegistryOp[];
  errors: string[];
}

// Runs `entry` as a mod entry point and records every content-registry call
// it makes. `skip` names a require target that resolves to a no-op, which is
// how the studio's own file is left out of the base it diffs against.
export async function runMod(files: Map<string, string>, modId: string, entry: string, skip: string | null): Promise<ModRun> {
  return withEngine(files, async (engine) => {
    // a mod that misbehaves against the stand-in API must not hang or eat
    // the studio; its registrations so far still count
    engine.global.setMemoryMax(256 * 1024 * 1024);
    engine.global.setTimeout(Date.now() + 5000);
    engine.global.set("__modId", modId);
    engine.global.set("__skip", skip ?? "");
    engine.global.set("__entry", entry);
    engine.global.set("__runner", MOD_RUNNER);
    const json: string = await engine.doString(
      `local f = assert(load(__runner, "=studio_mod_runner")) return f(__modId, __skip, __entry)`,
    );
    const parsed = JSON.parse(json) as { ops: unknown; errors: unknown };
    return {
      ops: Array.isArray(parsed.ops) ? (parsed.ops as RegistryOp[]) : [],
      errors: Array.isArray(parsed.errors) ? (parsed.errors as string[]) : [],
    };
  }, true);
}

// ------------------------------------------------------------------ game events

// What the game's own map scripts (gen1recomp data/scripts, a source
// checkout only) attach to each map: talk entries as command lists, or false
// where the game runs code; which other hooks (onStep, onEnter, ...) are code.
export interface GameScripts {
  [mapId: string]: { talk: Record<string, unknown[][] | false>; code: string[] };
}

const GAME_SCRIPTS_RUNNER = String.raw`
local version = ...
local attached, loaded = {}, {}
-- a list that holds a function (a callback argument) can't be edited as data
local function plain(v, depth)
  if type(v) == "function" then return false end
  if type(v) ~= "table" or depth > 6 then return true end
  for _, x in pairs(v) do if not plain(x, depth + 1) then return false end end
  return true
end
local function attach(mapId, mod)
  if type(mod) ~= "table" then return end
  local m = attached[mapId]
  if not m then m = { talk = {}, code = {} } attached[mapId] = m end
  for k, v in pairs(mod) do
    if k == "talk" and type(v) == "table" then
      for text, script in pairs(v) do
        if type(script) == "table" and plain(script, 0) then m.talk[text] = script else m.talk[text] = false end
      end
    elseif type(v) == "function" then
      m.code[#m.code + 1] = k
    end
  end
end
local GameVersion = setmetatable({
  isYellow = function() return version == "yellow" end,
  isBlue = function() return version == "blue" end,
  isGold = function() return false end,
  get = function() return version end,
  current = version,
}, { __index = function() return function() return false end end })
local stubs = {
  ["src.core.GameVersion"] = GameVersion,
  ["src.script.MapScripts"] = { attachBase = attach },
}
local function req(name)
  if stubs[name] then return stubs[name] end
  if loaded[name] ~= nil then return loaded[name] end
  local rel = string.gsub(name, "%.", "/") .. ".lua"
  local src = __read(rel)
  -- engine modules the scripts only use while the game runs
  if src == nil then return __dummy end
  local env = setmetatable({ require = req }, { __index = _G })
  local chunk = assert(load(src, "@" .. rel, "t", env))
  local result = chunk()
  if result == nil then result = true end
  loaded[name] = result
  return result
end
req("data.scripts.init")
return __json(attached)
`;

// files: "data/scripts/....lua" -> source
export async function loadGameScripts(files: Map<string, string>, version: string): Promise<GameScripts> {
  return withEngine(files, async (engine) => {
    engine.global.setMemoryMax(256 * 1024 * 1024);
    engine.global.setTimeout(Date.now() + 10000);
    engine.global.set("__version", version);
    engine.global.set("__runner", GAME_SCRIPTS_RUNNER);
    const json: string = await engine.doString(`local f = assert(load(__runner, "=studio_game_scripts")) return f(__version)`);
    const parsed = JSON.parse(json) as GameScripts | unknown[];
    return Array.isArray(parsed) ? {} : parsed;
  }, true);
}
