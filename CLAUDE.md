# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Calm isometric medieval village builder: the player controls a protagonist with WASD, gathers wood/meat/stone/iron by hand, and grows the population only by recruiting NPCs who spawn around the map. Design decisions, v1 scope and the milestone list live in `docs/GDD.md` (Portuguese). Keep features inside the v1 scope there unless the user says otherwise. The user communicates in Brazilian Portuguese, and in-game text is Portuguese.

## Commands

- `npm run dev`: Vite dev server on http://localhost:5173 (also `.claude/launch.json` → "game")
- `npm run typecheck`: `tsc --noEmit`
- `npm test`: Vitest, all tests
- `npx vitest run tests/world.test.ts -t "is deterministic"`: one file or test
- `npm run build`: typecheck + production build to `dist/` (relative `base` so it can be packaged as a desktop app later)

## Architecture

TypeScript + Phaser 3.90 + Vite. No asset files yet.

- **Coordinates.** Game logic runs in continuous _grid space_ (tile units; tile `(i,j)` covers `[i,i+1)×[j,j+1)`). Rendering is in _screen space_. `src/iso.ts` converts between them (`gridToScreen`, `screenToGrid`). WASD input is a screen-space direction converted with `screenDirToGrid`, so "W" always moves up on the monitor. Never store screen positions as game state.
- **Depth sorting.** Ground tiles sit at a constant very low depth. Every standing thing (objects, characters) uses `depth = screen y of its feet`, with origin `(0.5, 1)`. New entities must follow this or they'll draw in the wrong order. `WorldScene.fadeObjectsInFrontOfPlayer` makes tall objects translucent when they cover the player.
- **Map.** `src/world/map.ts` generates the map from a constant seed (`MAP_SEED` in `src/config.ts`), so the "fixed map" is deterministic. A test enforces this. Changing generation parameters changes the map for everyone, so do it on purpose. Ground (`Ground`) and blocking objects (`Obj`: trees, rocks, iron) are flat arrays indexed `y * w + x`. `isWalkable` is the single source of truth for collision.
- **Placeholder art.** `src/gfx/textures.ts` paints every texture into canvases at boot (ground variants `grass_0..3` etc., `tree`, `pine`, `rock`, `iron`, `player_*`, `shadow`). Real art should replace a texture by loading an image under the same key, without touching game code.
- **Gameplay rules** live in Phaser-free modules under `src/game/`:
  - `inventory.ts`: resource types and `Inventory`, a plain amount bag used for the central stockpile.
  - `slots.ts`: `SlotInventory`, the player's Minecraft-style slot inventory. Slots `[0, hotbarSize)` are the hotbar. Capacity is limited by **total weight** (`maxWeight`, `ITEM_WEIGHT`) as well as by slots and `MAX_STACK`. `space(item)` is the single check for "can I pick this up". Mouse operations (`leftClick` / `rightClick` take and return the stack held on the cursor; `quickMove` is shift+click) never change total weight. `ItemId` is only resources today; tools should extend it.
  - `buildings.ts`: `BUILDING_DEFS` (footprint size, cost, build time, "near" requirement, deposit flag) and `Buildings`, which tracks buildings and construction sites and the tiles they cover (`at(i)`), validates placement (`check`) and applies construction work. Every building tile is `Obj.Building` in `map.objects`, so collision and interaction targeting see buildings generically. Look up which building a tile belongs to with `buildings.at(i)`. The central stockpile is a pre-built `stockpile` building, and any `deposit` building feeds the same shared `stockpile` Inventory. Costs are paid from the stockpile when a site is placed.
  - `gathering.ts`: `NODE_DEFS` (yield, time per unit, depleted form, regrow time per object), `ResourceNodes` (remaining amounts, depletion and regrowth, all mutating `map.objects`), `nearestTile` (interaction targeting) and `Gatherer` (hold-E timer). `ResourceNodes.update` returns the changed tiles. Blocking nodes only respawn when the caller's `canPlace` allows it (the player is not on the tile).
  - `time.ts`: `GameClock` and `ambientAt(hour)`, the day/night tint keyframes.
  - `npcs.ts`: everything about people except rendering. `NpcData` (role `wanderer` | `villager`, tier, traits, request, home), `generateWanderer(rng, …)`, `TRAITS` (data only; effects belong to the job and needs systems), `Population` (beds = built houses × `BEDS_PER_HOUSE`, `check` / `recruit`), `WandererSpawner`, `pickSpawnTile`, and `payFrom` (inventory first, then stockpile). Functions take an injected `rng` so tests are deterministic. Portuguese UI text is gendered, so NPCs carry `gender` and labels go through helpers (`roleLabel`, `tierLabel`).
- **Pathfinding.** `src/world/path.ts` has `findPath` (A*, 8-dir, no corner cutting, goal predicate, node budget) and `pathTo`. `src/entities/Npc.ts` moves NPCs along A* paths between tile centres, idles and strolls around an anchor (spawn point, then home), and re-plans if its next tile becomes blocked. NPC movement uses real `dt`, while wanderer departure (`leavesAt`) uses the game clock.
- **Interaction reach** (`nearestTile`) is measured to the tile's nearest _edge_, not its centre, so large footprints are as reachable as single tiles.
- **Building rendering.** One sprite per building (`WorldScene.buildingViews`), anchored at the footprint's south vertex with origin `(0.5, 1)`. `isoBuilding()` in `textures.ts` paints any size×size box-with-roof to that convention. A single depth value can't sort a 2×2 footprint against the player, so `sortBuildingsAroundPlayer` decides exactly near the player: the player is in front once past the footprint's south-east or south-west edge. Build mode (ghost, footprint outline, `placement` state) lives in `WorldScene`. `UIScene` drives it: the B menu (`src/ui/BuildMenuUI.ts`) and placement clicks on empty screen space.
- **Two time streams.** The player moves in real time. World time (clock, regrowth, and future production and needs) advances `worldDt`, which T fast-forwards by `FAST_FORWARD`. New simulation systems should use `worldDt`.
- **Scenes.** `WorldScene` owns the map, player, camera (integer zoom levels only, to keep pixels crisp), input and the per-frame interaction logic. When a tile's object changes, call `replaceObjectImage(i)` so the sprite matches. `UIScene` runs in parallel as a screen-space overlay. It reads `WorldScene` state (`stockpile`, `inventory`, `clock`, `interaction`), converts world→screen with the world camera, and listens for `'popup'` events on `WorldScene.events`. It owns the night tint rectangle (created first so it sits under the HUD) and `src/ui/InventoryUI.ts` (hotbar + panel + cursor stack). When the panel opens it sets `WorldScene.inventoryOpen`, which freezes movement and gathering. UI text lives here rather than in world space, because world-space text would be blurred by the camera zoom.
- **Talking to NPCs.** NPCs take interaction priority over tiles. E sets `WorldScene.talkingTo` (freezing the player and that NPC) and emits `'talk'`. `UIScene` opens `src/ui/RecruitDialogUI.ts`, which is modal for keys (Enter recruits through `WorldScene.recruit(id)`, Esc/E closes through `stopTalking()`). `WorldScene` also emits `'toast'` events, shown as stacked notifications by `UIScene`.
- **Tuning constants** (tile size, map size, speeds, zooms) live in `src/config.ts`.

## Verifying changes

Pure logic (map, iso math, later economy/NPC rules) belongs in Phaser-free modules so Vitest can test it without a browser. For visual changes, run the dev server and check in the browser. In dev builds `window.game` is exposed, so state can be set from the console, e.g. `game.scene.getScene('World').stockpile.add('wood', 100)`. Keyboard input can be simulated by dispatching `KeyboardEvent`s on `window` (key, code and keyCode). Phaser's WebGL renderer fails with a 0×0 framebuffer if the canvas boots hidden, which is why `src/main.ts` passes explicit fallback sizes to `Scale.RESIZE`.
