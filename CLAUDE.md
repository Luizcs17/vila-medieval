# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Calm isometric medieval village builder. The player controls a protagonist with WASD, gathers wood, stone and iron by hand, hunts for meat, crafts tools, and grows the population only by recruiting NPCs who spawn around the map. Recruits are housed, given jobs, and must be fed. Design decisions, v1 scope and the milestone list (all 10 done, v1.0.0) live in `docs/GDD.md` (Portuguese). Keep features inside that scope unless the user says otherwise. Planned post-v1 work: other towns and conflict (the long-term goal is conquering all villages), farming, seasons, production chains and final art. The user communicates in Brazilian Portuguese, and in-game text is Portuguese.

## Commands

- `npm run dev`: Vite dev server on http://localhost:5173 (also `.claude/launch.json` → "game")
- `npm run check`: typecheck + Biome lint + all tests. Run this before every commit; CI runs it too.
- `npm test` / `npx vitest run tests/npcs.test.ts -t "best-first"`: all tests, or one file / test
- `npm run format`: Biome auto-fix (formatting, import order, safe lint fixes)
- `npm run build`: typecheck + production build to `dist/` (relative `base` so it can be packaged as a desktop app later)

Tooling notes:

- TypeScript is v7 (the native compiler). `typescript-eslint` doesn't support it, which is why lint and format use **Biome** (`biome.json`: 2 spaces, single quotes, 130 columns).
- Biome flags `forEach` callbacks that return a value. Use `for…of` or a braced body instead.

## Workflow

- One branch per milestone or feature (`feat/m7-animals`, `chore/…`), then a `--no-ff` merge into `main`.
- With each change, bump `package.json` (each milestone is a minor version) and add a `CHANGELOG.md` entry.
- There is no git remote yet. `.github/workflows/ci.yml` runs `npm run check` and the build once one exists.

## Architecture

TypeScript + Phaser 3.90 + Vite. No asset files: all art is generated at boot.

### Space, time, rendering

- **Coordinates.** Game logic runs in continuous _grid space_ (tile units; tile `(i,j)` covers `[i,i+1)×[j,j+1)`). Rendering is in _screen space_. `src/iso.ts` converts between them. WASD input is a screen-space direction converted with `screenDirToGrid`, so "W" always moves up on the monitor. Never store screen positions as game state.
- **Depth sorting.** Ground tiles sit at a constant very low depth. Everything standing uses `depth = screen y of its feet`, with origin `(0.5, 1)`. A single depth can't sort a 2×2 building against the player, so `WorldScene.sortBuildingsAroundPlayer` decides exactly near the player. `fadeObjectsInFrontOfPlayer` makes tall things translucent when they cover the player.
- **Two time streams.** The player's movement, gathering and building use real `dt`. World simulation (clock, regrowth, NPC movement and work, animals, hunger, spawners) uses `worldDt`, which holding T multiplies by `FAST_FORWARD`. New simulation code should use `worldDt`.
- **Placeholder art.** `src/gfx/textures.ts` paints every texture into canvases (`fromRows` pixel strings, `isoBuilding` for size×size houses, procedural trees, rocks and animals). Real art should replace a texture by loading an image under the same key. Texture creation is guarded so it can run again after a scene restart.

### Rules (Phaser-free, unit-tested) in `src/game/`

- `map.ts` (in `src/world/`): a deterministic map from a constant seed (a test enforces it). Ground and objects are flat arrays indexed `y * w + x`. `isWalkable` is the single source of truth for collision. Every building tile is `Obj.Building`.
- `inventory.ts`: resource types and `Inventory`, the stockpile's amount bag (`canAfford` / `pay`).
- `items.ts`: `ITEM_DEFS` for every slot item (resources, tools and weapons: weight, stack size, tool type, speed, damage, durability) and `RECIPES`.
- `slots.ts`: `SlotInventory`, the player's Minecraft-style inventory. Capacity is limited by **weight** (`maxWeight`), slots and stack size. `space(item)` is the single "can I pick this up" check. Tools don't stack and carry `durability`; mouse operations, `stow` and `quickMove` preserve it. `takeAllResources` never takes tools.
- `gathering.ts`: `NODE_DEFS` (yield, time, tool type, `needsTool`, depleted form, regrow time), `ResourceNodes` (depletion and regrowth that mutate `map.objects`), `nearestTile` (reach measured to the tile's nearest edge) and `Gatherer`.
- `buildings.ts`: `BUILDING_DEFS` (footprint, cost, build time, `near` requirement, `deposit`, `job`) and `Buildings` (placement `check`, `at(i)`, construction work). The central stockpile is a pre-built `stockpile` building, and every `deposit` building feeds the same stockpile.
- `npcs.ts`: `NpcData` (role, tier, random traits, 1–5 star `skills`, request, home, job, hp, food), `generateWanderer(rng, …)`, `productivity` (rating × traits), `Population` (beds, recruit, assign/unassign workers), `WandererSpawner`, and `payFrom` (inventory first, then stockpile). Portuguese text is gendered, so labels go through `roleLabel`, `tierLabel` and `jobTitle`.
- `needs.ts`: hunger. `updateNeeds` drains satiety, eats stockpile meat and returns `starving` / `died` events. `foodDays` gives the HUD estimate.
- `animals.ts`: `SPECIES` (temper: skittish / defensive / aggressive, stats, population), serializable `AnimalData`, `AnimalSpawner`, `pickAnimalTile`.
- `player.ts`: `PlayerStats` (HP and regen, XP and levels; `carryWeight` and `gatherSpeed` derive from level).
- `crafting.ts`, `time.ts` (`GameClock`, `ambientAt`), `save.ts` (`SaveData`, versioned; `readSave` / `writeSave` take an injectable storage).
- Randomness is injected (`rng` parameters) so tests are deterministic.

### Entities and systems

- `src/world/path.ts`: A* (`findPath` with a goal predicate and a node budget).
- `src/entities/Npc.ts`: movement along A* paths plus the behaviour state machine. Wanderers and the unemployed stroll. Workers loop node → harvest → nearest deposit. Hunters track prey, shoot it and collect carcass meat. Everyone heads home at night, and villagers flee home from hunting predators. It talks to the world only through the `NpcWorld` interface that `WorldScene` implements.
- `src/entities/Animal.ts`: straight-line movement with sliding collision. Skittish animals flee, defensive ones retaliate, aggressive ones chase within `aggroRange` (×1.4 at night) and give up past a leash. Dead animals stay as carcasses.
- `src/systems/Wildlife.ts`: owns all animals (spawning, updates, carcass rot, player melee, hunter shots, meat, HP bars). It talks to the scene through `WildlifeHost`.

### Scenes and UI

- `WorldScene` owns the world and its state, input, interaction priority (NPC > carcass > tile/building), combat, build mode, XP, and save/load. **Phaser reuses the scene instance on `scene.restart`** (loading a save, new game), so all per-game state is rebuilt in `init()`, never in field initialisers. `create()` loads the last save unless started with `{ fresh: true }`. Autosave runs every `AUTOSAVE_SECONDS`, at each new day, and on page hide/close. When a tile's object changes, call `replaceObjectImage(i)`.
- `UIScene` is a screen-space overlay that restarts with the world. It removes the world-event listeners (`popup`, `toast`, `talk`, `building`) left by its previous run before adding new ones. It owns the HUD (resources with days of food, population, clock, HP/level, toasts), the night tint, and the panels in `src/ui/`: inventory/hotbar, build menu (B), crafting (C), NPC card, building panel (workers/residents), minimap (M), and the pause menu (Esc, which pauses `World`). Modal panels set flags on `WorldScene` (`inventoryOpen`, `talkingTo`, `panelBuilding`) that freeze the player.
- Tuning constants live in `src/config.ts`.

## Verifying changes

Put rules in `src/game/` and test them with Vitest. For anything visual, run the dev server and check in the browser:

- In dev builds `window.game` is exposed. For example, `game.scene.getScene('World').stockpile.add('wood', 100)`. Private helpers such as `spawnWanderer()`, `recruit(id)` and `addBuildingView(buildings.place(...))` are reachable from the console for setting up scenarios.
- Simulate keys by dispatching `KeyboardEvent`s on `window` (key, code, keyCode). Holding T fast-forwards world time.
- The browser console keeps errors from earlier hot reloads, so watch for fresh ones with `addEventListener('error', …)`.
- Phaser's WebGL renderer fails with a 0×0 framebuffer if the canvas boots hidden, which is why `src/main.ts` passes explicit fallback sizes to `Scale.RESIZE`.
- The game auto-loads its save, so call `game.scene.getScene('World').newGame()` for a clean state.
