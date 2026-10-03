# Lua

Idiomatic Lua. Locals win, tables are the primary data structure,
metatables are OO, `pcall` guards side effects, indexing starts at 1.

## Naming

Lua has no single community convention — **follow the host runtime's**, and hold
it repo-wide. Neovim and the LuaRocks world are snake_case; Roblox/Luau is the
opposite, PascalCase for functions and methods with camelCase locals, matching
the engine API (`Instance:FindFirstChild`). Read the runtime's docs rather than
re-deriving, as the engine-integration section below already says.

Where the runtime leaves it open, this is the default:

- `snake_case` — variables, functions.
- `PascalCase` — classes / modules (the table returned by a module).
- `UPPERCASE` — constants.
- `_leading_underscore` — private functions and variables.

## Locals over globals

- `local` every declaration that doesn't need to be exposed. Globals are
  a table lookup on `_G`; locals are a register.
- Cache library functions used in a hot loop: `local ipairs = ipairs`,
  `local math_floor = math.floor`.
- Module-private helpers are `local function name()`; only the module's
  returned table is exposed.

## Tables

- One table type covers arrays, records, sets, and hashes. Reach for
  metatables when a table needs custom behavior — not for a plain
  record.
- Pre-allocate when the size is known: `table.new(n, 0)` (LuaJIT) or
  reuse a scratch table across iterations.
- Choose `ipairs` vs `pairs` deliberately — `ipairs` for arrays (stops
  at the first `nil`), `pairs` for hash maps. Never mix.
- 1-based indexing throughout. Never write `for i = 0, #t` — off-by-one
  in disguise.

## Metatables + OOP

- Class shape: a module table + `__index` on instance metatable pointing
  back at the class.
    ```lua
    local Player = {}
    Player.__index = Player

    function Player.new(name)
        return setmetatable({ name = name, hp = 100 }, Player)
    end

    function Player:take_damage(amount)
        self.hp = self.hp - amount
    end

    return Player
    ```
- `__index` for inheritance / method lookup.
- `__newindex` for property validation or freezing.
- `__call`, `__tostring`, `__eq` when they make sense — never overload
  for cleverness.

## Errors

- `pcall(fn, ...)` / `xpcall(fn, handler, ...)` for anything with a
  fallible external boundary (I/O, JSON, network, deserialization).
- `assert(cond, "message")` for preconditions — cheap failure with a
  message.
- Nil is not an error type — check explicitly:
  `if x == nil then return nil, "not found" end`.
- Return `nil, err` pairs from library-shaped functions; use `error()`
  only for programmer errors or protected boundaries.

## Modules

```lua
-- one file, one module
local M = {}

local function _internal_helper(x) end   -- private
function M.public_thing(x) end            -- exported

return M
```

- `require("path.to.module")` — no manual filesystem paths.
- No side effects at module top level beyond building the returned
  table.

## Performance

- Locals over globals (already stated — this is the biggest single win).
- Cache repeated field lookups outside loops: `local t_insert = table.insert`.
- Minimize table creation inside tight loops — pre-allocate or reuse.
- Weak tables (`{ __mode = "k" }` or `"v"` or `"kv"`) when caching
  something that GC should be allowed to reclaim.
- String concatenation in a loop → `table.concat(parts, "")`.

## Comments

Same discipline as every other language: comments explain WHY, never
WHAT. Function names, module names, and types carry the WHAT.

## Testing

- `busted` or the project's chosen framework — put tests alongside
  source as `<name>_spec.lua` (busted convention) or `<name>_test.lua`
  (adjust to project).
- Cover critical functions and every `pcall`-guarded boundary.
- Runtime-mock only what you must; prefer real dependencies for
  in-process code.

## Game / engine integration

When embedding Lua in a game engine (Love2D, Corona, Roblox) or a host
runtime (Go's gopher-lua, Redis' EVAL, Neovim):

- Keep the game loop shape the engine dictates; don't invent a scheduler
  on top.
- Separate frame-tick logic (`update(dt)`) from render (`draw()`).
- Manage state as plain tables; the engine does not need your OO layer
  to be clever.
- Input, physics, and asset loading follow the engine's conventions —
  read the engine's docs, don't re-derive.
